import crypto from 'node:crypto';
import {activePersonSQL,installEmployeeRevocation} from './employee-access.js';

export function employeeCode(value){
  if(value===undefined)return undefined;
  if(typeof value!=='string'||value&&!/^\d{6}$/.test(value))throw Error('Le code employé doit contenir exactement six chiffres. Conservez les zéros au début.');
  return value||null;
}
export async function saveEmployeeCode(client,personId,value){
  const code=employeeCode(value);if(code===undefined)return;
  if(code&&(await client.query('SELECT portal_person_id FROM schedule_store_people WHERE id=$1',[personId])).rows[0]?.portal_person_id)throw Error('Cette fiche utilise déjà un accès personnel partagé. Détachez cet accès avant d’attribuer un autre code.');
  if(code&&(await client.query('SELECT id FROM schedule_store_people WHERE employee_code=$1 AND id<>$2',[code,personId])).rows.length)throw Error('Ce code est déjà attribué à une autre fiche. Vérifiez la correspondance avant de poursuivre.');
  await client.query('UPDATE schedule_store_people SET employee_code=$1 WHERE id=$2',[code,personId]);
}
export const employeePersonIds=employee=>employee?.portalPersonIds||[Number(employee?.id)];
export async function installEmployeePortal(app,pool,{sameOrigin,requireManager}){
  await pool.query(`ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS employee_code TEXT;
    ALTER TABLE schedule_store_people ADD COLUMN IF NOT EXISTS portal_person_id BIGINT REFERENCES schedule_store_people(id) CHECK(portal_person_id<>id);
    CREATE INDEX IF NOT EXISTS schedule_portal_person_link ON schedule_store_people(portal_person_id) WHERE portal_person_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS schedule_employee_code_unique ON schedule_store_people(employee_code) WHERE employee_code IS NOT NULL;
    CREATE TABLE IF NOT EXISTS schedule_department_views(department_id BIGINT NOT NULL,week_start DATE NOT NULL,person_id BIGINT NOT NULL,published_at TIMESTAMPTZ NOT NULL,first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),view_count INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(department_id,week_start,person_id,published_at));`);
  await installEmployeeRevocation(pool);
  const sign=s=>crypto.createHmac('sha256',process.env.SESSION_SECRET).update(s).digest('base64url');
  const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
  const activeSQL=`SELECT p.*,e.active AS service_active,e.departed_at FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id WHERE p.employee_code IS NOT NULL AND p.portal_person_id IS NULL AND ${activePersonSQL()}`;
  async function identity(req){
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('employee_portal='))?.slice(16)||'';
    const [id,expires,sig]=cookie.split('.');if(!/^\d+$/.test(id||'')||!/^\d+$/.test(expires||'')||Number(expires)<=Date.now()||!sig)return null;
    const row=(await pool.query(activeSQL+' AND p.id=$1',[id])).rows[0];
    if(!row)return null;
    const payload=`employee:${id}:${expires}:${row.employee_code}`;
    // Pre-migration personal sessions remain valid only until the first revocation.
    if(!equal(sig,sign(`${payload}:${row.access_version}`))&&!(row.access_version===1&&equal(sig,sign(payload))))return null;
    // Resolve explicitly linked records on every request, including existing sessions.
    const linked=(await pool.query('SELECT id FROM schedule_store_people WHERE portal_person_id=$1 AND active AND service_employee_id IS NULL AND employee_code IS NULL',[row.id])).rows;
    return {...row,portalPersonIds:[Number(row.id),...linked.map(p=>Number(p.id))]};
  }
  const requireEmployee=async(req,res,next)=>{try{req.employee=await identity(req);if(!req.employee)return res.status(401).json({error:'Entre ton code employé de six chiffres.'});res.set('Cache-Control','no-store');next();}catch{res.status(500).json({error:'Accès temporairement indisponible.'});}};
  const attempts=new Map();
  const login=async(req,res)=>{try{
    const now=Date.now(),ip=req.ip||'unknown';for(const [k,v] of attempts)if(now-v.since>=900000)attempts.delete(k);
    const entry=attempts.get(ip)||{count:0,since:now};if(entry.count>=10)return res.status(429).json({error:'Trop d’essais. Réessaie dans 15 minutes.'});
    const code=typeof req.body?.code==='string'?req.body.code.trim():'';
    const row=/^\d{6}$/.test(code)?(await pool.query(activeSQL+' AND p.employee_code=$1',[code])).rows[0]:null;
    if(!row){entry.count++;attempts.set(ip,entry);return res.status(401).json({error:'Code incorrect ou fiche inactive. Communique avec ton gérant.'});}
    attempts.delete(ip);const expires=now+12*60*60*1000,id=String(row.id);
    res.setHeader('Set-Cookie',`employee_portal=${id}.${expires}.${sign(`employee:${id}:${expires}:${row.employee_code}:${row.access_version}`)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`);
    res.set('Cache-Control','no-store').json({ok:true});
  }catch{res.status(500).json({error:'Impossible de vérifier le code.'});}};
  app.post('/api/employee-portal/access',sameOrigin,login);
  app.post('/api/employee-portal/logout',sameOrigin,(_req,res)=>{res.setHeader('Set-Cookie',`employee_portal=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);res.json({ok:true});});
  return {requireEmployee,login,identity};
}
