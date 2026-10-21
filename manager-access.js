import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const isScoped=req=>req.manager?.kind==='account';
export const ownsDepartment=(req,id)=>!isScoped(req)||req.manager.departments.includes(Number(id));
export function assertDepartment(req,id){if(!ownsDepartment(req,id))fail('Ce département ne fait pas partie de vos accès.',403);}
export async function passwordHash(password){
  if(typeof password!=='string'||password.length<12||password.length>128)fail('Le mot de passe doit contenir de 12 à 128 caractères.');
  const salt=crypto.randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
export async function passwordMatches(password,encoded){
  if(typeof password!=='string'||password.length>128)return false;
  const [salt,key]=encoded.split(':');const actual=await scrypt(password,salt,64);
  const expected=Buffer.from(key,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
}
const endpoint=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Impossible de gérer les accès. Réessayez.'});}};

export async function installManagerAccess(app,pool,{readSession,issueSession,sameOrigin,production,credentialSecret=process.env.SESSION_SECRET}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_manager_accounts(
    id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,login TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
    departments JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    ALTER TABLE schedule_manager_accounts ADD COLUMN IF NOT EXISTS password_encrypted TEXT;`);
  // Authentication still uses scrypt. Only the administrator can request this encrypted copy.
  const credentialKey=()=>{if(!credentialSecret)fail('La clé de protection des accès est indisponible.',503);return crypto.createHmac('sha256',credentialSecret).update('manager-password-v1').digest();};
  const seal=(password,hash)=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',credentialKey(),iv);cipher.setAAD(Buffer.from(hash));const encrypted=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');};
  const unseal=(value,hash)=>{try{const [version,iv,tag,encrypted]=value.split('.');if(version!=='v1')throw Error();const decipher=crypto.createDecipheriv('aes-256-gcm',credentialKey(),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(hash));decipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8');}catch{fail('Ce mot de passe ne peut plus être affiché. Redéfinissez-le depuis Modifier les accès.',409);}};
  const dummy=await passwordHash(crypto.randomBytes(32).toString('hex'));
  async function identity(req){
    let session;try{session=readSession(req);}catch{return null;}
    if(!session)return null;
    if(!session.accountId)return {kind:'admin',name:'Administration'};
    const row=(await pool.query('SELECT id,name,departments,active,version FROM schedule_manager_accounts WHERE id=$1',[session.accountId])).rows[0];
    if(!row?.active||row.version!==session.accountVersion)return null;
    return {kind:'account',id:Number(row.id),name:row.name,departments:row.departments};
  }
  const admin=endpoint(async(req,res)=>{req.manager=await identity(req);if(!req.manager)fail('Connectez-vous à l’administration.',401);if(req.manager.kind!=='admin')fail('Accès réservé à l’administration.',403);});
  const requireAdmin=async(req,res,next)=>{await admin(req,res);if(!res.headersSent)next();};
  const list=async()=>({accounts:(await pool.query('SELECT id,name,login,departments,active,version,password_encrypted IS NOT NULL AS "passwordAvailable" FROM schedule_manager_accounts ORDER BY name,id')).rows,departments:(await pool.query('SELECT id,name FROM schedule_leave_departments WHERE active=TRUE ORDER BY name')).rows});
  app.get('/api/manager-accounts',requireAdmin,endpoint(async(_req,res)=>res.set('Cache-Control','no-store').json(await list())));
  app.post('/api/manager-accounts/:id/password',requireAdmin,sameOrigin,endpoint(async(req,res)=>{
    res.set('Cache-Control','no-store');
    const row=(await pool.query('SELECT password_hash,password_encrypted FROM schedule_manager_accounts WHERE id=$1',[req.params.id])).rows[0];
    if(!row)fail('Compte introuvable.',404);
    if(!row.password_encrypted)fail('Ancien mot de passe non récupérable. Il deviendra affichable après la prochaine connexion du gérant ou après sa redéfinition.',409);
    res.json({password:unseal(row.password_encrypted,row.password_hash)});
  }));
  const save=endpoint(async(req,res)=>{
    const b=req.body||{},name=typeof b.name==='string'?b.name.trim():'',login=typeof b.login==='string'?b.login.trim().toLowerCase():'';
    if(name.length<2||name.length>100||!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(login)||typeof b.active!=='boolean')fail('Indiquez un nom et un identifiant valide (3 à 100 caractères, sans espace ni accent).');
    if(!Array.isArray(b.departments)||b.departments.some(id=>!Number.isSafeInteger(id)))fail('Choisissez les départements autorisés.');
    const ids=[...new Set(b.departments)];
    if(b.active&&!ids.length)fail('Un compte actif doit avoir au moins un département.');
    const valid=(await pool.query('SELECT id FROM schedule_leave_departments WHERE id=ANY($1::bigint[]) AND active=TRUE',[ids])).rows;
    if(valid.length!==ids.length)fail('Département inconnu ou inactif.');
    const hash=b.password?await passwordHash(b.password):null;
    const encrypted=hash?seal(b.password,hash):null;
    try{
      if(req.params.id){
        if(!Number.isInteger(b.version))fail('Actualisez la liste des comptes.',409);
        const saved=await pool.query(`UPDATE schedule_manager_accounts SET name=$1,login=$2,departments=$3,active=$4,password_hash=COALESCE($5,password_hash),password_encrypted=COALESCE($8,password_encrypted),version=version+1,updated_at=clock_timestamp() WHERE id=$6 AND version=$7 RETURNING id`,[name,login,JSON.stringify(ids),b.active,hash,req.params.id,b.version,encrypted]);
        if(!saved.rowCount)fail('Ce compte a changé. Actualisez la liste.',409);
      }else{
        if(!hash)fail('Choisissez un mot de passe pour ce compte.');
        await pool.query('INSERT INTO schedule_manager_accounts(name,login,departments,active,password_hash,password_encrypted) VALUES($1,$2,$3,$4,$5,$6)',[name,login,JSON.stringify(ids),b.active,hash,encrypted]);
      }
    }catch(error){if(error.code==='23505')fail('Cet identifiant est déjà utilisé.',409);throw error;}
    res.set('Cache-Control','no-store').json({ok:true,...await list()});
  });
  app.post('/api/manager-accounts',requireAdmin,sameOrigin,save);
  app.put('/api/manager-accounts/:id',requireAdmin,sameOrigin,save);
  const attempts=new Map();
  app.post('/api/manager-login',sameOrigin,endpoint(async(req,res)=>{
    const now=Date.now(),login=String(req.body?.login||'').trim().toLowerCase(),keys=['ip:'+req.ip,'login:'+login.slice(0,100)];
    if(login.length>100)fail('Identifiant ou mot de passe incorrect.',401);
    for(const [key,v] of attempts)if(now-v.since>900000)attempts.delete(key);
    if(keys.some(k=>(attempts.get(k)?.count||0)>=10))fail('Trop d’essais. Attendez 15 minutes.',429);
    for(const k of keys){const v=attempts.get(k)||{count:0,since:now};v.count++;attempts.set(k,v);}
    const row=(await pool.query('SELECT * FROM schedule_manager_accounts WHERE login=$1',[login.slice(0,100)])).rows[0];
    const correct=await passwordMatches(req.body?.password,row?.password_hash||dummy);
    if(!correct||!row?.active)fail('Identifiant ou mot de passe incorrect.',401);
    if(!row.password_encrypted&&credentialSecret)await pool.query('UPDATE schedule_manager_accounts SET password_encrypted=$1 WHERE id=$2 AND password_hash=$3 AND password_encrypted IS NULL',[seal(req.body.password,row.password_hash),row.id,row.password_hash]);
    keys.forEach(k=>attempts.delete(k));
    res.setHeader('Set-Cookie',`schedule_session=${encodeURIComponent(issueSession({accountId:Number(row.id),accountVersion:row.version}))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${production?'; Secure':''}`);
    const service=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0];
    res.json({ok:true,path:row.departments.every(id=>id===Number(service?.id))?'/':'/departements'});
  }));
  async function authorize(req){
    req.manager=await identity(req);if(!req.manager)fail('Connexion gestionnaire requise.',401);
    if(!isScoped(req))return;
    // Prefix middleware authenticates before reading large request bodies. Route checks follow parsing.
    if(!req.route)return;
    const path=req.route.path;
    if(path==='/api/sales-forecasts/:weekStart'&&req.method==='GET')return;
    // The collection filters publications to the account's departments.
    if(path==='/api/departments/publication-status'&&req.method==='GET')return;
    if(path==='/api/departments/meta'||path==='/api/departments/people'||path==='/api/departments/people/:id')return;
    if(path.startsWith('/api/departments/')){
      let id;
      if(path.startsWith('/api/departments/:id/')||path==='/api/departments/document-mail/:id')id=req.params.id;
      else if(path==='/api/departments/photos')id=req.method==='GET'?req.query.departmentId:req.body.departmentId;
      else if(path.startsWith('/api/departments/photos/:id'))id=(await pool.query('SELECT department_id FROM schedule_department_photos WHERE id=$1',[req.params.id])).rows[0]?.department_id;
      else fail('Accès réservé à l’administration.',403);
      assertDepartment(req,id);return;
    }
    if(path==='/api/leave/departments'&&req.method==='GET'||path==='/api/leave/requests'||path==='/api/leave/availability/requests')return;
    if(path==='/api/leave/departments/:id'){assertDepartment(req,req.params.id);return;}
    if(path.startsWith('/api/leave/requests/:id')){const row=(await pool.query('SELECT department_id FROM schedule_leave_requests WHERE id=$1',[req.params.id])).rows[0];assertDepartment(req,row?.department_id);return;}
    if(path.startsWith('/api/leave/availability/requests/:id')){const row=(await pool.query('SELECT department_id FROM schedule_availability_requests WHERE id=$1',[req.params.id])).rows[0];assertDepartment(req,row?.department_id);return;}
    const service=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0];
    const serviceOnly=/^\/api\/(employees(?:\/|$)|weeks\/|shifts\/)/.test(path)||path.startsWith('/api/leave/week/');
    if(serviceOnly&&ownsDepartment(req,service?.id))return;
    fail('Accès réservé à l’administration ou au département concerné.',403);
  }
  return {identity,authorize};
}
