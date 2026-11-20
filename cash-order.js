import {needsSchema} from './preview-schema.js';
import {orderWorkbooks} from './cash-xlsx.js';
import {cashAccess} from './depot-access.js';
import {createHash} from 'node:crypto';
import lib from './onboarding/tuac/pdf-lib.min.cjs';
import {items,totals} from './public/numeraire-calcul.js';
const bank='caisse.t90044@desjardins.com';
export function orderLines(b){
 if(!Array.isArray(b.lockers)||b.lockers.length!==2)throw Error('Vérifie les casiers.');
 const lines=[];
 b.lockers.forEach((q,i)=>{
  const {bills,total,error}=totals(q);
  if(error)throw Error('Casier '+(24+i)+' · '+error);
  if(!total)return;
  lines.push('Casier '+(24+i));
  q.forEach((n,j)=>{if(n)lines.push(items[j][0]+' : '+n+' x '+items[j][1]+' $ = '+n*items[j][1]+' $');});
  lines.push('Billets : '+bills+' $    |    Boîtes : '+(total-bills)+' $    |    Total : '+total+' $','');
 });
 if(!lines.length)throw Error('Ajoute au moins une quantité.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date))||new Date(b.date).toISOString().slice(0,10)!==b.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time))throw Error('Vérifie la date et l’heure.');
 if(b.time!=='11:00'||!['Marc-André Benoit','Badia Felhi'].includes(b.name))throw Error('Vérifie le commissionnaire autorisé et la cueillette à 11 h.');
 for(const s of [b.name,b.notes])if(typeof s!=='string'||s.length>100||/[\x00-\x1f]/.test(s))throw Error('Vérifie les renseignements de cueillette.');
 if(!Array.isArray(b.ink)||b.ink.length>180||!b.ink.every(l=>Array.isArray(l)&&l.length<=4000&&l.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))||!b.ink.some(l=>l.some(p=>Math.hypot(p[0]-l[0][0],p[1]-l[0][1])>.01)))throw Error('Trace ta signature.');
 return lines;
}
export async function orderPdf(b,lines,folio){
 const pdf=await lib.PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(lib.StandardFonts.Helvetica);
 let y=747;
 function write(s,size=11){page.drawText(s,{x:46,y,font,size:Math.min(size,510/Math.max(1,font.widthOfTextAtSize(s,1)))});y-=18;}
 write('Commande de numéraire | CAD',19);
 write('ALIMENTATION SOGESCO INC.');write('Transit 815-90044   |   Folio '+folio);
 write('Centre de services Les Salines, 3050 boulevard Laframboise, Saint-Hyacinthe');
 write('Cueillette : '+b.date+' à '+b.time);
 if(b.name.trim())write('Commissionnaire : '+b.name.trim());
 for(const line of lines)write(line);
 if(b.notes.trim())write('Besoins supplémentaires : '+b.notes.trim());
 write('Signature');
 for(const line of b.ink){let start;for(const [u,v] of line){const end={x:48+220*u,y:y-48+55*(1-v)};if(start)page.drawLine({start,end,thickness:1,color:lib.rgb(.05,.16,.4)});start=end;}}
 return Buffer.from(await pdf.save());
}
export async function installCash(app,pool,auth,origin){
 if (needsSchema(pool)) await pool.query('CREATE TABLE IF NOT EXISTS cash_order_mail (id uuid PRIMARY KEY, fingerprint text NOT NULL, attachment bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), sent boolean NOT NULL DEFAULT false)');
 if (needsSchema(pool)) await pool.query(`ALTER TABLE cash_order_mail ADD COLUMN IF NOT EXISTS pickup date,
  ADD COLUMN IF NOT EXISTS lockers smallint[], ADD COLUMN IF NOT EXISTS recipient text, ADD COLUMN IF NOT EXISTS excel24 bytea, ADD COLUMN IF NOT EXISTS excel25 bytea`);
 const access=cashAccess(auth,origin);
 const paths=(suffix='')=>['/api/numeraire'+suffix,'/api/depot/numeraire'+suffix];
 app.get(paths('/config'),access,(req,res)=>{
  if(req.manager?.kind!=='admin')return res.sendStatus(403);
  res.set('Cache-Control','no-store').json({recipient:bank,mode:"production"});
 });
 app.get(paths('/historique'),access,async(req,res)=>{
  if(req.manager?.kind!=='admin')return res.sendStatus(403);
  try{
   const result=await pool.query(`SELECT id,pickup::text,lockers,created_at,recipient,(excel24 IS NOT NULL) AS x24,(excel25 IS NOT NULL) AS x25 FROM cash_order_mail
    WHERE sent ORDER BY pickup DESC NULLS LAST,created_at DESC`);
   res.set('Cache-Control','no-store').json(result.rows.map(r=>({...r,recipient:r.recipient||bank})));
  }catch{res.status(503).json({error:'Historique temporairement indisponible.'});}
 });
 app.get(paths('/pdf/:id'),access,async(req,res)=>{
  if(req.manager?.kind!=='admin')return res.sendStatus(403);
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.params.id))return res.sendStatus(404);
  try{
   const {rows:[row]}=await pool.query('SELECT attachment FROM cash_order_mail WHERE id=$1 AND sent',[req.params.id]);
   if(!row)return res.sendStatus(404);
   res.set({'Cache-Control':'private, no-store','Content-Disposition':(req.query.download?'attachment':'inline')+'; filename="Commande-'+req.params.id+'.pdf"'}).type('pdf').send(row.attachment);
  }catch{res.sendStatus(503);}
 });
 app.get(paths('/excel/:id/:locker'),access,async(req,res)=>{
  if(req.manager?.kind!=='admin')return res.sendStatus(403);
  const {id,locker}=req.params;if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!['24','25'].includes(locker))return res.sendStatus(404);
  try{const {rows:[row]}=await pool.query('SELECT pickup::text,excel'+locker+' AS file FROM cash_order_mail WHERE id=$1 AND sent',[id]);
   if(!row?.file)return res.sendStatus(404);
   res.set({'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="Casier-'+locker+'-'+row.pickup+'.xlsx"'}).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(row.file);
  }catch{res.sendStatus(503);}
 });
 // The first version archived only the PDF. Recover the fields from its printed text.
 if (needsSchema(pool)) {
   const old=await pool.query('SELECT id FROM cash_order_mail WHERE pickup IS NULL AND sent');
   for(const {id} of old.rows){
    const {rows:[row]}=await pool.query('SELECT attachment FROM cash_order_mail WHERE id=$1',[id]);
    const pdf=await lib.PDFDocument.load(row.attachment);
    const streams=pdf.getPage(0).node.Contents();
    const lines=[];
    for(let i=0;i<streams.size();i++){
     const content=Buffer.from(lib.decodePDFRawStream(streams.lookup(i)).decode()).toString('ascii');
     for(const match of content.matchAll(/<([0-9A-F]+)> Tj/gi))lines.push(Buffer.from(match[1],'hex').toString('latin1'));
    }
    const date=lines.find(l=>l.startsWith('Cueillette : '))?.slice('Cueillette : '.length,'Cueillette : '.length+10);
    const lockers=lines.filter(l=>/^Casier (24|25)$/.test(l)).map(l=>Number(l.slice(-2)));
    if(date&&lockers.length)await pool.query('UPDATE cash_order_mail SET pickup=$2,lockers=$3,recipient=$4 WHERE id=$1',[id,date,lockers,bank]);
   }
 }
 app.post(paths(),access,async(req,res)=>{
  if(req.manager?.kind!=='admin')return res.sendStatus(403);
  const b=req.body||{};
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.id||''))return res.status(400).json({error:'Référence invalide.'});
  if(b.recipient!==bank)return res.status(409).json({error:'Recharge la page pour vérifier le destinataire.'});
  let lines;try{lines=orderLines(b);}catch(e){return res.status(400).json({error:e.message});}
  const copyEmail=process.env.CASH_ORDER_COPY_EMAIL?.trim();
  const configuredFrom=process.env.RESEND_FROM_EMAIL||process.env.RESEND_FROM||process.env.EMAIL_FROM;
  const address=configuredFrom?.match(/<([^<>]+)>\s*$/)?.[1]||configuredFrom;
  const from=address&&/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(address)?'IGA Extra Famille Benoit <'+address+'>':null;
  if(!copyEmail||!from||!process.env.RESEND_API_KEY||!process.env.CASH_ORDER_FOLIO)return res.status(503).json({error:'L’envoi de commandes est temporairement indisponible.'});
  try{
   const fingerprint=createHash('sha256').update(JSON.stringify([b.lockers,b.date,b.time,b.name,b.notes,b.ink])).digest('hex');
   const pdf=await orderPdf(b,lines,process.env.CASH_ORDER_FOLIO);
   const excel=await orderWorkbooks(b);
   await pool.query('INSERT INTO cash_order_mail(id,fingerprint,attachment,pickup,lockers,recipient,excel24,excel25) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[b.id,fingerprint,pdf,b.date,b.lockers.flatMap((q,i)=>q.some(Boolean)?[24+i]:[]),bank,...excel]);
   const {rows:[row]}=await pool.query('SELECT * FROM cash_order_mail WHERE id=$1',[b.id]);
   if(row.recipient!==bank||row.fingerprint!==fingerprint)return res.status(409).json({error:'Cette référence correspond déjà à une autre commande.'});
   if(!row.sent){
    if(!row.excel24&&!row.excel25)return res.status(409).json({error:"Cette ancienne tentative ne contient pas de fichier Excel. Vérifie sa réception avant de recommencer."});
    if(Date.now()-Number(row.created_at)>23*3600000)return res.status(409).json({error:'Vérifie la réception auprès de la caisse avant de refaire cette commande.'});
    const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'cash-'+b.id},signal:AbortSignal.timeout(15000),body:JSON.stringify({from,to:[bank],cc:[copyEmail],subject:'Commande de numéraire CAD · '+b.date+' · ALIMENTATION SOGESCO INC.',text:'Bonjour,\n\nVeuillez trouver ci-joint notre commande signée pour le centre Les Salines.\n\n'+lines.join('\n'),attachments:[24,25].flatMap(n=>row['excel'+n]?[{filename:'Commande-Casier-'+n+'-'+b.date+'.xlsx',content:row['excel'+n].toString('base64')}]:[])})});
    if(!mail.ok)throw Error('Mail');
    await pool.query('UPDATE cash_order_mail SET sent=true WHERE id=$1',[b.id]);
   }
   res.json({sent:true});
  }catch{res.status(503).json({error:'Envoi non confirmé. Réessaie avec la même commande.'});}
 });
}
