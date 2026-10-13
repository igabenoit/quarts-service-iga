import crypto from 'node:crypto';
import {normalizeEmail} from './employee-contacts.js';
import {MODELS,COLORS,SIZES,PRICE,normalizeItems,orderTotal,supplierRows,money} from './public/clothing-core.js';
import {supplierWorkbook,internalWorkbook} from './clothing-xlsx.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'});
const open=c=>c?.opened&&(!c.deadline||c.deadline>=today());
const endpoint=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Impossible de terminer cette action. Réessayez sans créer une nouvelle commande.'});}};
export async function installClothing(app,pool,{requireStaff,requireManager,sameOrigin,fetchImpl=fetch}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_clothing_campaigns(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,deadline TEXT NOT NULL DEFAULT '',opened BOOLEAN NOT NULL DEFAULT FALSE,recipients JSONB NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
  CREATE TABLE IF NOT EXISTS schedule_clothing_orders(id UUID PRIMARY KEY,campaign_id BIGINT NOT NULL REFERENCES schedule_clothing_campaigns(id),campaign_title TEXT NOT NULL,employee_name TEXT NOT NULL,department_name TEXT NOT NULL,items JSONB NOT NULL,total_cents INTEGER NOT NULL,digest TEXT NOT NULL,recipients JSONB NOT NULL,cancelled BOOLEAN NOT NULL DEFAULT FALSE,version INTEGER NOT NULL DEFAULT 1,mail_status TEXT NOT NULL DEFAULT 'pending',mail_attempt TIMESTAMPTZ,provider_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
  INSERT INTO schedule_clothing_campaigns(title) SELECT 'Chandails 2026 — noir et vert forêt' WHERE NOT EXISTS(SELECT 1 FROM schedule_clothing_campaigns);`);
  async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(734882)');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  await pool.query(`ALTER TABLE schedule_clothing_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ; ALTER TABLE schedule_clothing_orders ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;`);
  const campaign=async(id,db=pool)=>(await db.query('SELECT * FROM schedule_clothing_campaigns WHERE id=$1',[id])).rows[0];
  const orders=async id=>(await pool.query('SELECT id,campaign_id,employee_name,department_name,items,total_cents,cancelled,version,mail_status,created_at,paid_at,collected_at FROM schedule_clothing_orders WHERE campaign_id=$1 ORDER BY created_at,id',[id])).rows;
  async function deliver(id){
    if(!process.env.RESEND_API_KEY)return 'error';
    const job=(await pool.query(`UPDATE schedule_clothing_orders SET mail_status='sending',mail_attempt=clock_timestamp() WHERE id=$1 AND cancelled=FALSE AND created_at>clock_timestamp()-interval '20 hours' AND (mail_status IN ('pending','error') OR (mail_status='sending' AND mail_attempt<clock_timestamp()-interval '1 minute')) RETURNING *`,[id])).rows[0];
    if(!job)return (await pool.query('SELECT mail_status FROM schedule_clothing_orders WHERE id=$1',[id])).rows[0]?.mail_status;
    const lines=job.items.map(i=>`${i.quantity} × ${MODELS.find(m=>m.id===i.model).name} (${i.model}) — ${i.color} — ${i.size} — ${money(i.quantity*i.unitPrice)}`);
    try{
      const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'clothing-'+id},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM||'Quarts Service <onboarding@resend.dev>',to:job.recipients,subject:`Commande de chandails — ${job.employee_name}`,text:`${job.campaign_title}\nBon de commande ${id}\n${job.employee_name} — ${job.department_name}\n\n${lines.join('\n')}\n\nTotal employé : ${money(job.total_cents)}\nCommande enregistrée dans la gestion des chandails. Aucun paiement en ligne.`})});
      const result=await response.json();if(!response.ok||!result.id)throw Error('provider');
      await pool.query("UPDATE schedule_clothing_orders SET mail_status='sent',provider_id=$2 WHERE id=$1",[id,result.id]);return 'sent';
    }catch{await pool.query("UPDATE schedule_clothing_orders SET mail_status='error' WHERE id=$1",[id]);return 'error';}
  }
  app.get('/api/leave/clothing',requireStaff,endpoint(async(_req,res)=>{
    const c=(await pool.query('SELECT id,title,deadline,opened,version FROM schedule_clothing_campaigns ORDER BY opened DESC,id DESC LIMIT 1')).rows[0];
    res.json({campaign:{...c,accepting:open(c)},models:MODELS,colors:COLORS,sizes:SIZES,price:PRICE,departments:(await pool.query('SELECT id,name FROM schedule_leave_departments WHERE active=TRUE ORDER BY name')).rows});
  }));
  app.post('/api/leave/clothing/orders',requireStaff,sameOrigin,endpoint(async(req,res)=>{
    const b=req.body||{},name=typeof b.name==='string'?b.name.trim():'';
    if(!uuid(b.requestId)||name.length<2||name.length>100||!Number.isSafeInteger(b.departmentId)||!Number.isSafeInteger(b.campaignId))fail('Indiquez votre nom complet et votre département.');
    let items;try{items=normalizeItems(b.items);}catch(e){fail(e.message);}
    const digest=crypto.createHash('sha256').update(JSON.stringify([b.campaignId,name,b.departmentId,items])).digest('hex');
    const order=await transaction(async db=>{
      const existing=(await db.query('SELECT * FROM schedule_clothing_orders WHERE id=$1',[b.requestId])).rows[0];
      if(existing){if(existing.digest!==digest)fail('Cette référence est déjà utilisée. Retrouvez la confirmation avant de recommencer.',409);return existing;}
      const c=await campaign(b.campaignId,db);if(!open(c))fail('Les commandes sont fermées pour cette campagne.',409);
      if(c.version!==b.campaignVersion)fail('La campagne a changé. Actualisez la page avant de confirmer.',409);
      const d=(await db.query('SELECT name FROM schedule_leave_departments WHERE id=$1 AND active=TRUE',[b.departmentId])).rows[0];if(!d)fail('Département invalide.');
      return (await db.query('INSERT INTO schedule_clothing_orders(id,campaign_id,employee_name,department_name,items,total_cents,digest,recipients,campaign_title) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[b.requestId,c.id,name,d.name,JSON.stringify(items),orderTotal(items),digest,JSON.stringify(c.recipients),c.title])).rows[0];
    });
    const mail=order.mail_status==='sent'?'sent':await deliver(order.id);
    res.json({ok:true,id:order.id,total:order.total_cents,items:order.items,cancelled:order.cancelled,mailStatus:mail});
  }));
  // requireManager denies these new routes to scoped accounts; explicit check also protects reuse.
  const admin=(req,res,next)=>req.manager?.kind==='account'?res.status(403).json({error:'Réservé à l’administration.'}):next();
  app.get('/api/clothing/campaigns',requireManager,admin,endpoint(async(_req,res)=>res.json({campaigns:(await pool.query('SELECT * FROM schedule_clothing_campaigns ORDER BY id DESC')).rows,mailConfigured:Boolean(process.env.RESEND_API_KEY)})));
  const save=endpoint(async(req,res)=>{
    const b=req.body||{},title=typeof b.title==='string'?b.title.trim():'',deadline=b.deadline||'';
    if(title.length<2||title.length>100||typeof b.opened!=='boolean'||typeof deadline!=='string'||deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||Number.isNaN(Date.parse(deadline))||new Date(deadline).toISOString().slice(0,10)!==deadline))fail('Vérifiez le nom et la date limite.');
    if(!Array.isArray(b.recipients)||b.recipients.length>10)fail('Indiquez au plus 10 destinataires.');
    const recipients=[...new Set(b.recipients.map(normalizeEmail))];if(recipients.some(v=>!v))fail('Adresse courriel invalide.');
    if(b.opened&&(!recipients.length||!process.env.RESEND_API_KEY))fail('Enregistrez un destinataire et configurez le service courriel avant d’ouvrir les commandes.');
    if(b.opened&&deadline&&deadline<today())fail('La date limite est passée.');
    const c=await transaction(async db=>{
      if(b.opened&&(await db.query('SELECT id FROM schedule_clothing_campaigns WHERE opened=TRUE AND id<>$1',[req.params.id||0])).rows.length)fail('Fermez la campagne ouverte avant d’en ouvrir une autre.',409);
      if(!req.params.id)return (await db.query('INSERT INTO schedule_clothing_campaigns(title,deadline,opened,recipients) VALUES($1,$2,$3,$4) RETURNING *',[title,deadline,b.opened,JSON.stringify(recipients)])).rows[0];
      if(!Number.isInteger(b.version))fail('Actualisez la campagne.',409);
      const row=(await db.query('UPDATE schedule_clothing_campaigns SET title=$1,deadline=$2,opened=$3,recipients=$4,version=version+1 WHERE id=$5 AND version=$6 RETURNING *',[title,deadline,b.opened,JSON.stringify(recipients),req.params.id,b.version])).rows[0];if(!row)fail('La campagne a changé. Actualisez.',409);return row;
    });res.json(c);
  });
  app.post('/api/clothing/campaigns',requireManager,admin,sameOrigin,save);
  app.put('/api/clothing/campaigns/:id',requireManager,admin,sameOrigin,save);
  app.get('/api/clothing/campaigns/:id/orders',requireManager,admin,endpoint(async(req,res)=>{const c=await campaign(req.params.id);if(!c)fail('Campagne introuvable.',404);const list=await orders(c.id);res.json({campaign:c,orders:list,supplier:supplierRows(list)});}));
  app.patch('/api/clothing/orders/:id',requireManager,admin,sameOrigin,endpoint(async(req,res)=>{
    if(!uuid(req.params.id)||typeof req.body.cancelled!=='boolean'||!Number.isInteger(req.body.version))fail('Commande invalide.');
    const r=await pool.query('UPDATE schedule_clothing_orders SET cancelled=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING id',[req.body.cancelled,req.params.id,req.body.version]);if(!r.rowCount)fail('Commande modifiée entre-temps. Actualisez.',409);res.json({ok:true});
  }));
  app.patch('/api/clothing/orders/:id/tracking',requireManager,admin,sameOrigin,endpoint(async(req,res)=>{
    const b=req.body||{};if(!uuid(req.params.id)||!Number.isInteger(b.version)||!['paid','collected'].includes(b.field)||typeof b.value!=='boolean')fail('Suivi invalide.');
    const column=b.field==='paid'?'paid_at':'collected_at';
    const r=await pool.query(`UPDATE schedule_clothing_orders SET ${column}=CASE WHEN $1 THEN COALESCE(${column},clock_timestamp()) ELSE NULL END,version=version+1 WHERE id=$2 AND version=$3 AND cancelled=FALSE RETURNING id`,[b.value,req.params.id,b.version]);
    if(!r.rowCount)fail('Commande annulée ou modifiée entre-temps. Actualisez.',409);res.json({ok:true});
  }));
  app.get('/api/clothing/campaigns/:id/internal.xlsx',requireManager,admin,endpoint(async(req,res)=>{const c=await campaign(req.params.id);if(!c)fail('Campagne introuvable.',404);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="suivi-employes-${c.id}.xlsx"`}).send(internalWorkbook(c.title,await orders(c.id)));}));
  app.post('/api/clothing/orders/:id/retry-mail' ,requireManager,admin,sameOrigin,endpoint(async(req,res)=>{if(!uuid(req.params.id))fail('Commande invalide.');const row=(await pool.query('SELECT * FROM schedule_clothing_orders WHERE id=$1',[req.params.id])).rows[0];if(!row)fail('Commande introuvable.',404);if(row.cancelled)fail('Commande annulée.');if(row.mail_status!=='sent'&&Date.now()-new Date(row.created_at).getTime()>20*3600000)fail('Envoi ancien : vérifiez la boîte de réception. La commande demeure disponible ici.');res.json({status:await deliver(row.id)});}));
  app.get('/api/clothing/campaigns/:id/supplier.xlsx',requireManager,admin,endpoint(async(req,res)=>{const c=await campaign(req.params.id);if(!c)fail('Campagne introuvable.',404);res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="commande-fournisseur-${c.id}.xlsx"`}).send(supplierWorkbook(c.title,supplierRows(await orders(c.id))));}));
}
