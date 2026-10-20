import crypto from 'node:crypto';
import {installFamilyGoogleCalendar} from './family-google-calendar.js';
import {isDate,monday,today} from './public/departments-core.js';
import {personalDays} from './public/portal-weeks.js';
import {serviceShiftTiming} from './public/service-rules.js';

const iso=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const owner=person=>Number(person.portalPersonId||person.id);
const normalizeCode=value=>typeof value==='string'?value.toUpperCase().replace(/[\s-]/g,''):'';
const newCode=()=>Array.from(crypto.randomBytes(16),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('').match(/.{4}/g).join('-');

// Family identities are independent of employee records and manager accounts.
export async function installFamilyPortal(app,pool,{requireManager,sameOrigin,directory,readPublishedWeek}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_family_access(
    id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,code_hash TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS schedule_family_members(
      access_id BIGINT NOT NULL REFERENCES schedule_family_access(id) ON DELETE CASCADE,
      person_id BIGINT NOT NULL REFERENCES schedule_store_people(id),PRIMARY KEY(access_id,person_id));`);
  const digest=value=>crypto.createHmac('sha256',process.env.SESSION_SECRET).update(value).digest('base64url');
  const hash=code=>digest('family-code-v1:'+normalizeCode(code));
  const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
  const endpoint=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Accès familial temporairement indisponible. Réessayez.'});}};
  const admin=fn=>endpoint(async(req,res)=>{if(req.manager?.kind!=='admin')fail('Accès réservé à l’administration.',req.manager?403:401);await fn(req,res);});
  const cookie=(value,maxAge)=>`family_portal=${value}; Path=/api/family-portal; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`;
  async function identity(req){
    const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('family_portal='))?.slice(14)||'';
    const [id,expires,version,sig,...extra]=raw.split('.');
    if(extra.length||!/^\d+$/.test(id||'')||!/^\d+$/.test(expires||'')||!/^\d+$/.test(version||'')||Number(expires)<=Date.now()||!sig)return null;
    if(!equal(sig,digest(`family:${id}:${expires}:${version}`)))return null;
    const account=(await pool.query('SELECT id,name,version FROM schedule_family_access WHERE id=$1 AND active AND version=$2',[id,version])).rows[0];
    if(!account)return null;
    const members=(await pool.query('SELECT person_id FROM schedule_family_members WHERE access_id=$1',[id])).rows;
    return {...account,personIds:members.map(r=>Number(r.person_id))};
  }
  const requireFamily=fn=>endpoint(async(req,res)=>{req.family=await identity(req);if(!req.family)fail('Entre ton code familial pour voir les horaires.',401);await fn(req,res);});
  const attempts=new Map();
  app.post('/api/family-portal/access',sameOrigin,endpoint(async(req,res)=>{
    const now=Date.now(),ip=req.ip||'unknown';for(const [key,value] of attempts)if(now-value.since>=900000)attempts.delete(key);
    const attempt=attempts.get(ip)||{count:0,since:now};if(attempt.count>=10)fail('Trop d’essais. Réessaie dans 15 minutes.',429);
    const code=normalizeCode(req.body?.code);
    const account=/^[A-HJ-NP-Z2-9]{16}$/.test(code)?(await pool.query('SELECT id,version FROM schedule_family_access WHERE code_hash=$1 AND active',[hash(code)])).rows[0]:null;
    if(!account){attempt.count++;attempts.set(ip,attempt);fail('Code familial incorrect ou accès désactivé.',401);}
    attempts.delete(ip);const expires=now+12*60*60*1000,value=`${account.id}.${expires}.${account.version}`;
    res.setHeader('Set-Cookie',cookie(`${value}.${digest(`family:${account.id}:${expires}:${account.version}`)}`,43200));res.json({ok:true});
  }));
  app.post('/api/family-portal/logout',sameOrigin,endpoint(async(_req,res)=>{res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});}));

  async function members(family,people){
    const roots=people.filter(p=>p.active&&family.personIds.includes(p.id));
    const ids=new Set(roots.map(p=>p.id));
    return {roots,people:people.filter(p=>p.active&&ids.has(owner(p)))};
  }
  app.get('/api/family-portal',requireFamily(async(req,res)=>{
    const group=await members(req.family,await directory(pool)),ids=new Set(group.people.map(p=>p.id));
    const published=(await pool.query('SELECT week_start,published FROM schedule_department_weeks WHERE published IS NOT NULL')).rows;
    const weeks=published.filter(w=>w.published.rows.some(r=>ids.has(r.personId))).map(w=>iso(w.week_start));
    if(group.people.some(p=>p.serviceEmployeeId))weeks.push(...(await pool.query('SELECT week_start FROM schedule_public_links')).rows.map(w=>iso(w.week_start)));
    res.json({name:req.family.name,today:today(),people:group.roots.map(({id,name})=>({id,name})),weeks:[...new Set(weeks)].sort().reverse()});
  }));
  async function readFamilyWeek(family,start){
    if(!isDate(start)||monday(start)!==start)fail('Choisissez le lundi de la semaine.');
    const all=await directory(pool,start),group=await members(family,all),published=await readPublishedWeek(start,all),service=[];
    const serviceIds=group.people.map(p=>p.serviceEmployeeId).filter(Boolean);
    if(serviceIds.length&&(await pool.query('SELECT 1 FROM schedule_public_links WHERE week_start=$1',[start])).rows.length){
      const records=(await pool.query(`SELECT e.id,s.day_index,s.start_minute,s.end_minute,s.absence,s.role
        FROM schedule_employees e LEFT JOIN schedule_assignments a ON a.employee_id=e.id AND a.shift_id IN(SELECT id FROM schedule_shifts WHERE week_start=$1)
        LEFT JOIN schedule_shifts s ON s.id=a.shift_id WHERE e.id=ANY($2::bigint[]) AND e.active AND e.departed_at IS NULL
        ORDER BY e.id,s.day_index,s.start_minute`,[start,serviceIds])).rows;
      for(const id of serviceIds)service.push({id,shifts:records.filter(r=>Number(r.id)===id&&r.day_index!==null).map(r=>({dayIndex:Number(r.day_index),startMinute:Number(r.start_minute),endMinute:Number(r.end_minute),role:r.role,...serviceShiftTiming(Number(r.start_minute),Number(r.end_minute),r.absence)}))});
    }
    const people=group.roots.map(person=>{
      const records=group.people.filter(p=>owner(p)===person.id),ids=new Set(records.map(p=>p.id)),results=[];
      for(const data of published){const rows=data.schedule.rows.filter(r=>ids.has(r.personId));if(rows.length)results.push({kind:'department',data:{department:data.department,weekStart:start,schedule:{rows,notes:''}}});}
      const employees=service.filter(s=>records.some(p=>p.serviceEmployeeId===s.id));if(employees.length)results.push({kind:'service',data:{weekStart:start,employees}});
      return {id:person.id,name:person.name,published:results.length>0,days:personalDays(start,results)};
    });
    // Deliberately no writes to employee consultation tracking.
    return {name:family.name,today:today(),weekStart:start,people};
  }
  app.get('/api/family-portal/weeks/:week',requireFamily(async(req,res)=>res.json(await readFamilyWeek(req.family,req.params.week))));
  const googleCalendar=await installFamilyGoogleCalendar(app,pool,{requireFamily,sameOrigin,readFamilyWeek});

  app.get('/api/family-accounts',requireManager,admin(async(_req,res)=>{
    const accounts=(await pool.query(`SELECT a.id,a.name,a.active,a.version,COALESCE(jsonb_agg(m.person_id ORDER BY m.person_id) FILTER(WHERE m.person_id IS NOT NULL),'[]') AS "personIds"
      FROM schedule_family_access a LEFT JOIN schedule_family_members m ON m.access_id=a.id GROUP BY a.id ORDER BY a.name,a.id`)).rows;
    const people=(await directory(pool)).filter(p=>!p.portalPersonId).map(({id,name,active})=>({id,name,active}));res.json({accounts,people});
  }));
  const save=admin(async(req,res)=>{
    const b=req.body||{},name=typeof b.name==='string'?b.name.trim():'';
    if(name.length<2||name.length>100||typeof b.active!=='boolean'||!Array.isArray(b.personIds)||b.personIds.length>20||b.personIds.some(id=>!Number.isSafeInteger(id)))fail('Indiquez un nom et les employés autorisés.');
    const ids=[...new Set(b.personIds)];if(b.active&&!ids.length)fail('Choisissez au moins un employé.');
    const people=await directory(pool);if(ids.some(id=>!people.some(p=>p.id===id&&(!b.active||p.active)&&!p.portalPersonId)))fail('Choisissez des fiches principales actives.');
    if(req.params.id&&!Number.isSafeInteger(b.version))fail('Actualisez les accès.',409);
    const client=await pool.connect();let code,id;
    try{
      await client.query('BEGIN');
      if(req.params.id){const saved=await client.query('UPDATE schedule_family_access SET name=$1,active=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING id',[name,b.active,req.params.id,b.version]);if(!saved.rows.length)fail('Cet accès a changé. Actualisez la liste.',409);id=saved.rows[0].id;}
      else{code=newCode();id=(await client.query('INSERT INTO schedule_family_access(name,active,code_hash) VALUES($1,$2,$3) RETURNING id',[name,b.active,hash(code)])).rows[0].id;}
      await client.query('DELETE FROM schedule_family_members WHERE access_id=$1',[id]);
      for(const personId of ids)await client.query('INSERT INTO schedule_family_members(access_id,person_id) VALUES($1,$2)',[id,personId]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    res.json({id:Number(id),...(code?{code}:{})});
  });
  app.post('/api/family-accounts',requireManager,sameOrigin,save);
  app.put('/api/family-accounts/:id',requireManager,sameOrigin,save);
  app.post('/api/family-accounts/:id/code',requireManager,sameOrigin,admin(async(req,res)=>{
    if(!Number.isSafeInteger(req.body?.version))fail('Actualisez les accès.',409);
    const code=newCode(),saved=await pool.query('UPDATE schedule_family_access SET code_hash=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING id',[hash(code),req.params.id,req.body.version]);
    if(!saved.rows.length)fail('Cet accès a changé. Actualisez la liste.',409);res.json({code});
  }));
  return {identity,googleCalendar};
}

