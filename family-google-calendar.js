import crypto from 'node:crypto';
import {addDays,monday,today} from './public/departments-core.js';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const scopes=['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const callbackPath='/api/family-portal/google/callback';
const zone='America/Toronto';
const dateTime=(date,minutes)=>`${addDays(date,Math.floor(minutes/1440))}T${String(Math.floor(minutes%1440/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00`;
export function calendarEvents(weeks,from=today()){
  const events=[];
  for(const week of weeks)for(const person of week.people)for(const day of person.days){
    if(day.date<from)continue;
    const entries=day.entries.filter(c=>Number.isInteger(c.start)&&Number.isInteger(c.end)&&c.end>c.start).sort((a,b)=>a.start-b.start||a.end-b.end||a.department.localeCompare(b.department));
    entries.forEach((c,index)=>events.push({key:`${person.id}:${day.date}:${index}`,date:day.date,body:{summary:`${person.name} · Travail`,description:[c.department,c.detail,'Horaire publié · IGA Famille Benoit','Les heures correspondent à la présence au travail.'].filter(Boolean).join('\n'),start:{dateTime:dateTime(day.date,c.start),timeZone:zone},end:{dateTime:dateTime(day.date,c.end),timeZone:zone}}}));
  }
  return events;
}
export const googleEventId=(familyId,key)=>'iga'+sha(`family-calendar-v1:${familyId}:${key}`);
export function encryptToken(value,secret){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv);
  return [iv.toString('base64url'),Buffer.concat([cipher.update(value,'utf8'),cipher.final()]).toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptToken(value,secret){const [iv,data,tag]=value.split('.'),cipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(iv,'base64url'));cipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8');}

export async function installFamilyGoogleCalendar(app,pool,{requireFamily,sameOrigin,readFamilyWeek,fetchImpl=fetch,env=process.env,startTimer=true}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_family_google(
    access_id BIGINT PRIMARY KEY REFERENCES schedule_family_access(id) ON DELETE CASCADE,
    token TEXT NOT NULL,calendar_id TEXT,calendar_name TEXT,enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync TIMESTAMPTZ,last_error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS schedule_family_google_states(
    hash TEXT PRIMARY KEY,access_id BIGINT NOT NULL REFERENCES schedule_family_access(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,expires TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule_family_google_events(
    access_id BIGINT NOT NULL REFERENCES schedule_family_access(id) ON DELETE CASCADE,
    shift_key TEXT NOT NULL,event_id TEXT NOT NULL,shift_date DATE NOT NULL,body_hash TEXT NOT NULL,
    PRIMARY KEY(access_id,shift_key));`);
  const redirect=env.GOOGLE_CALENDAR_REDIRECT_URI||'https://quarts-service-iga.onrender.com'+callbackPath;
  const configured=Boolean(env.GOOGLE_CALENDAR_CLIENT_ID&&env.GOOGLE_CALENDAR_CLIENT_SECRET&&env.SESSION_SECRET);
  const configuredOrFail=()=>{if(!configured)fail('La connexion Google doit être configurée par l’administration avant l’activation.',503);};
  const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'La synchronisation Google est momentanément indisponible.'});}};
  async function tokenRequest(values){
    const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...values,client_id:env.GOOGLE_CALENDAR_CLIENT_ID,client_secret:env.GOOGLE_CALENDAR_CLIENT_SECRET}),signal:AbortSignal.timeout(20000)});
    const data=await response.json();if(!response.ok||!data.access_token)fail('La connexion Google a expiré ou a été refusée. Reconnectez Google.',502);return data;
  }
  const accessToken=async row=>(await tokenRequest({grant_type:'refresh_token',refresh_token:decryptToken(row.token,env.SESSION_SECRET)})).access_token;
  async function google(token,path,{method='GET',body,allow=[]}={}){
    const response=await fetchImpl('https://www.googleapis.com/calendar/v3'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(allow.includes(response.status))return {status:response.status};
    if(!response.ok)fail(response.status===401||response.status===403?'Google a refusé l’accès au calendrier. Vérifiez la connexion et les droits de modification.':'Google Agenda est temporairement indisponible. Une nouvelle tentative sera faite.',502);
    return response.status===204?{}:response.json();
  }
  async function calendars(token){let pageToken,items=[];do{const page=await google(token,'/users/me/calendarList?maxResults=250'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));items.push(...(page.items||[]));pageToken=page.nextPageToken;}while(pageToken);return items.filter(c=>['owner','writer'].includes(c.accessRole)).map(c=>({id:c.id,name:c.summary}));}
  async function locked(id,fn){const client=await pool.connect();let lock=false;try{lock=(await client.query('SELECT pg_try_advisory_lock(71943,$1::int) AS locked',[id])).rows[0].locked;if(!lock)fail('Une synchronisation est déjà en cours. Réessayez dans un instant.',409);return await fn(client);}finally{if(lock)await client.query('SELECT pg_advisory_unlock(71943,$1::int)',[id]);client.release();}}
  async function sync(id){
    return locked(id,async client=>{
      const row=(await client.query('SELECT g.* FROM schedule_family_google g JOIN schedule_family_access a ON a.id=g.access_id WHERE g.access_id=$1 AND g.enabled AND a.active',[id])).rows[0];
      if(!row)return;
      try{
        const family=(await client.query('SELECT id,name FROM schedule_family_access WHERE id=$1 AND active',[id])).rows[0];
        family.personIds=(await client.query('SELECT person_id FROM schedule_family_members WHERE access_id=$1',[id])).rows.map(r=>Number(r.person_id));
        const from=today(),first=monday(from),until=addDays(first,91);
        const starts=(await client.query('SELECT week_start FROM schedule_department_weeks WHERE published IS NOT NULL AND week_start BETWEEN $1 AND $2 UNION SELECT week_start FROM schedule_public_links WHERE week_start BETWEEN $1 AND $2 ORDER BY week_start',[first,until])).rows.map(r=>r.week_start instanceof Date?r.week_start.toISOString().slice(0,10):String(r.week_start).slice(0,10));
        const weeks=[];for(const start of starts)weeks.push(await readFamilyWeek(family,start));
        // Reconcile only after every source week has been read successfully.
        const desired=calendarEvents(weeks,from),token=await accessToken(row),base='/calendars/'+encodeURIComponent(row.calendar_id)+'/events';
        const previous=(await client.query('SELECT * FROM schedule_family_google_events WHERE access_id=$1 AND shift_date>=$2 AND shift_date<=$3',[id,from,addDays(until,6)])).rows;
        for(const event of desired){
          const marker=sha(`family:${id}`),body={...event.body,extendedProperties:{private:{igaFamily:marker,igaShift:sha(event.key)}}},hash=sha(JSON.stringify(body)),old=previous.find(r=>r.shift_key===event.key);
          if(old?.body_hash===hash)continue;
          let eventId=old?.event_id||googleEventId(id,event.key),existing=await google(token,base+'/'+eventId,{allow:[404,410]});
          if(existing.status===410||existing.status==='cancelled'){eventId=googleEventId(id,event.key)+crypto.randomBytes(8).toString('hex');existing={status:404};}
          // Persist a pending ID before the external write. An ambiguous response retries that same ID.
          await client.query("INSERT INTO schedule_family_google_events(access_id,shift_key,event_id,shift_date,body_hash) VALUES($1,$2,$3,$4,'') ON CONFLICT(access_id,shift_key) DO UPDATE SET event_id=EXCLUDED.event_id,body_hash=''",[id,event.key,eventId,event.date]);
          if(existing.status===404){const inserted=await google(token,base,{method:'POST',body:{id:eventId,...body},allow:[409]});if(inserted.status===409)existing=await google(token,base+'/'+eventId);}
          if(existing.status!==404){if(existing.extendedProperties?.private?.igaFamily!==marker)fail('Un événement ne correspond pas à cette synchronisation.',409);await google(token,base+'/'+eventId,{method:'PATCH',body});}
          await client.query('UPDATE schedule_family_google_events SET body_hash=$3 WHERE access_id=$1 AND shift_key=$2',[id,event.key,hash]);
        }
        for(const old of previous.filter(r=>!desired.some(e=>e.key===r.shift_key))){const path=base+'/'+old.event_id,current=await google(token,path,{allow:[404,410]});if(!current.status){if(current.extendedProperties?.private?.igaFamily!==sha(`family:${id}`))fail('Un événement ne correspond pas à cette synchronisation.',409);await google(token,path,{method:'DELETE',allow:[404,410]});}await client.query('DELETE FROM schedule_family_google_events WHERE access_id=$1 AND shift_key=$2',[id,old.shift_key]);}
        await client.query("UPDATE schedule_family_google SET last_sync=clock_timestamp(),last_error='' WHERE access_id=$1",[id]);
      }catch(error){await client.query('UPDATE schedule_family_google SET last_error=$2 WHERE access_id=$1',[id,error.status?error.message:'Synchronisation interrompue. Nouvelle tentative automatique dans quelques minutes.']);throw error;}
    });
  }
  app.get('/api/family-portal/google',requireFamily(async(req,res)=>{
    const row=(await pool.query("SELECT calendar_id,calendar_name,enabled,last_sync,last_error,token<>'' AS connected FROM schedule_family_google WHERE access_id=$1",[req.family.id])).rows[0];res.json({configured,connected:Boolean(row?.connected),calendarId:row?.calendar_id||'',calendarName:row?.calendar_name||'',enabled:row?.enabled||false,lastSync:row?.last_sync||null,error:row?.last_error||''});
  }));
  app.post('/api/family-portal/google/connect',sameOrigin,requireFamily(async(req,res)=>{
    configuredOrFail();const state=crypto.randomBytes(32).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM schedule_family_google_states WHERE expires<clock_timestamp()');
    await pool.query("INSERT INTO schedule_family_google_states(hash,access_id,version,expires) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')",[sha(state+':'+nonce),req.family.id,req.family.version]);
    res.setHeader('Set-Cookie',`family_google_nonce=${nonce}; Path=${callbackPath}; HttpOnly; SameSite=Lax; Max-Age=600${env.NODE_ENV==='production'?'; Secure':''}`);
    const params=new URLSearchParams({client_id:env.GOOGLE_CALENDAR_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state});res.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
  }));
  app.get(callbackPath,wrap(async(req,res)=>{
    configuredOrFail();const nonce=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('family_google_nonce='))?.slice(20)||'';
    const state=typeof req.query.state==='string'?req.query.state:'';
    const saved=(await pool.query('DELETE FROM schedule_family_google_states WHERE hash=$1 AND expires>clock_timestamp() RETURNING access_id,version',[sha(state+':'+nonce)])).rows[0];
    res.setHeader('Set-Cookie',`family_google_nonce=; Path=${callbackPath}; HttpOnly; SameSite=Lax; Max-Age=0${env.NODE_ENV==='production'?'; Secure':''}`);
    if(!saved||!(await pool.query('SELECT id FROM schedule_family_access WHERE id=$1 AND active AND version=$2',[saved.access_id,saved.version])).rows.length)fail('La demande de connexion a expiré. Recommencez depuis le portail familial.');
    if(req.query.error||typeof req.query.code!=='string')return res.redirect('/horaire-famille?google=cancelled');
    const tokens=await tokenRequest({grant_type:'authorization_code',code:req.query.code,redirect_uri:redirect});
    if(!tokens.refresh_token||!scopes.every(s=>(tokens.scope||'').split(' ').includes(s)))fail('Autorisez la consultation de la liste des calendriers et la modification des événements pour continuer.');
    await locked(saved.access_id,async client=>client.query("INSERT INTO schedule_family_google(access_id,token) VALUES($1,$2) ON CONFLICT(access_id) DO UPDATE SET token=EXCLUDED.token,last_error=''",[saved.access_id,encryptToken(tokens.refresh_token,env.SESSION_SECRET)]));
    res.redirect('/horaire-famille?google=connected');
  }));
  app.get('/api/family-portal/google/calendars',requireFamily(async(req,res)=>{
    configuredOrFail();const row=(await pool.query('SELECT * FROM schedule_family_google WHERE access_id=$1',[req.family.id])).rows[0];if(!row)fail('Connectez Google d’abord.');res.json({calendars:await calendars(await accessToken(row))});
  }));
  app.post('/api/family-portal/google/enable',sameOrigin,requireFamily(async(req,res)=>{
    configuredOrFail();await locked(req.family.id,async client=>{const row=(await client.query('SELECT * FROM schedule_family_google WHERE access_id=$1',[req.family.id])).rows[0];if(!row)fail('Connectez Google d’abord.');const selected=(await calendars(await accessToken(row))).find(c=>c.id===req.body?.calendarId);if(!selected)fail('Choisissez un calendrier que vous pouvez modifier.');if(row.calendar_id&&row.calendar_id!==selected.id)fail('Reconnectez le même calendrier pour éviter de laisser des événements dans deux calendriers.');await client.query("UPDATE schedule_family_google SET calendar_id=$2,calendar_name=$3,enabled=TRUE,last_error='' WHERE access_id=$1",[req.family.id,selected.id,selected.name]);});
    await sync(req.family.id);res.json({ok:true});
  }));
  app.post('/api/family-portal/google/sync',sameOrigin,requireFamily(async(req,res)=>{await sync(req.family.id);res.json({ok:true});}));
  app.post('/api/family-portal/google/disconnect',sameOrigin,requireFamily(async(req,res)=>{
    await locked(req.family.id,async client=>client.query("UPDATE schedule_family_google SET enabled=FALSE,token='' WHERE access_id=$1",[req.family.id]));res.json({ok:true});
  }));
  let running=false;
  async function run(){if(running||!configured)return;running=true;try{const rows=(await pool.query('SELECT g.access_id FROM schedule_family_google g JOIN schedule_family_access a ON a.id=g.access_id WHERE g.enabled AND a.active')).rows;for(const row of rows)try{await sync(Number(row.access_id));}catch{ /* Visible status is stored per family; tokens never enter logs. */ }}finally{running=false;}}
  const timer=startTimer?setInterval(()=>void run().catch(()=>{}),120000):null;timer?.unref();
  if(startTimer)void run().catch(()=>{});
  return {sync,run,stop:()=>clearInterval(timer)};
}

