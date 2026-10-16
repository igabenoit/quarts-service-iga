import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {calendarEvents,familyEventColors,familyEventLabels,encryptToken,decryptToken,installFamilyGoogleCalendar} from '../family-google-calendar.js';
import {today,monday,addDays} from '../public/departments-core.js';
const secret='test-secret-never-production',env={SESSION_SECRET:secret,GOOGLE_CALENDAR_CLIENT_ID:'client',GOOGLE_CALENDAR_CLIENT_SECRET:'secret'};

test('family colors cover the seven requested people without affecting other calendars or unknown names',()=>{
  const date=addDays(today(),1),names=['Édouard Benoit','Antoine Benoit','Charles Benoit','Émile Benoit','Laura Benoit','Cassandra Corriveau','Marc-André Benoit','Autre Benoit'];
  const weeks=[{people:names.map((name,id)=>({id,name,days:[{date,entries:[{start:480,end:960,department:'Service'}]}]}))}];
  assert.deepEqual(calendarEvents(weeks,today(),familyEventColors).map(e=>e.body.colorId),['7','11','3','10',undefined,'4','9',undefined]);
  const laura=calendarEvents(weeks,today(),familyEventColors,familyEventLabels)[4].body;
  assert.equal(laura.eventLabelId,'504ca736-ddc3-4a13-bc7c-bc71b503296b');assert.ok(!('colorId' in laura));
  assert.ok(calendarEvents(weeks).every(e=>!('colorId' in e.body)));
});
test('published shifts use presence times, overnight dates and DST-aware timezone; tokens are encrypted',()=>{
  const date=addDays(today(),1),weeks=[{people:[{id:1,name:'Enfant',days:[{date,entries:[{start:1320,end:1830,department:'Service',detail:'Caisse',minutes:450},{start:null,end:null,department:'Congé'}]}]}]}];
  const event=calendarEvents(weeks)[0];assert.equal(event.body.start.dateTime,date+'T22:00:00');assert.equal(event.body.end.dateTime,addDays(date,1)+'T06:30:00');assert.equal(event.body.start.timeZone,'America/Toronto');assert.equal(calendarEvents(weeks,addDays(date,1)).length,0);
  const encrypted=encryptToken('refresh-token',secret);assert.ok(!encrypted.includes('refresh-token'));assert.equal(decryptToken(encrypted,secret),'refresh-token');assert.throws(()=>decryptToken(encrypted,'wrong'));
});
test('sync is idempotent, updates changed shifts, deletes only its own cancelled shifts, retries ambiguous inserts and preserves past events',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE TABLE schedule_family_access(id BIGINT PRIMARY KEY,name TEXT,active BOOLEAN,version INTEGER);
    INSERT INTO schedule_family_access VALUES(1,'Famille',TRUE,1),(2,'Other',TRUE,1);
    CREATE TABLE schedule_family_members(access_id BIGINT,person_id BIGINT);INSERT INTO schedule_family_members VALUES(1,11),(2,22);
    CREATE TABLE schedule_department_weeks(week_start DATE,published JSONB);CREATE TABLE schedule_public_links(week_start DATE);`);
    const first=monday(today()),date=addDays(first,7);await db.query("INSERT INTO schedule_department_weeks VALUES($1,'{}')",[date]);
    const pool={async query(sql,args){if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('pg_advisory_unlock'))return {rows:[]};if(!args)return (await db.exec(sql)).at(-1);return db.query(sql,args);},async connect(){return {...this,release(){}};}};
    const routes=new Map(),app={get(path,...handlers){routes.set('get '+path,handlers.at(-1));},post(path,...handlers){routes.set('post '+path,handlers.at(-1));}};
    const events=new Map(),deleted=new Set(),writes=[];let failInsert=false,failRead=false;
    const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
    const fetchImpl=async(url,options={})=>{
      if(url.includes('oauth2.googleapis.com'))return response({access_token:'access'});
      const id=decodeURIComponent(url.split('/').at(-1)),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
      if(method==='GET')return events.has(id)?response(events.get(id)):response({},deleted.has(id)?410:404);
      writes.push(method);
      if(method==='POST'){if(events.has(body.id))return response({},409);events.set(body.id,body);if(failInsert){failInsert=false;throw Error('connection lost after insert');}return response(body);}
      if(method==='PATCH'){events.set(id,{...events.get(id),...body});return response(events.get(id));}
      if(method==='DELETE'){events.delete(id);deleted.add(id);return response({},204);}
      throw Error('unexpected request');
    };
    let entries=[{start:480,end:960,department:'Boulangerie',detail:'Four',minutes:420}];
    const service=await installFamilyGoogleCalendar(app,pool,{sameOrigin:()=>{},requireFamily:fn=>fn,env,startTimer:false,fetchImpl,readFamilyWeek:async family=>{if(failRead)throw Error('source unavailable');assert.deepEqual(family.personIds,[11]);return {people:[{id:11,name:'Enfant',days:[{date,entries}]}]};}});
    const res=()=>({headers:{},code:200,set(){},setHeader(key,value){this.headers[key]=value;},json(body){this.body=body;},status(code){this.code=code;return this;},redirect(url){this.url=url;}});
    const auth=res();await routes.get('post /api/family-portal/google/connect')({family:{id:1,version:1}},auth);
    const state=new URL(auth.body.url).searchParams.get('state'),cookie=auth.headers['Set-Cookie'].split(';')[0];assert.match(auth.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);
    const bad=res();await routes.get('get /api/family-portal/google/callback')({headers:{cookie:'family_google_nonce=wrong'},query:{state,error:'access_denied'}},bad);assert.equal(bad.code,400);
    const denied=res();await routes.get('get /api/family-portal/google/callback')({headers:{cookie},query:{state,error:'access_denied'}},denied);assert.equal(denied.url,'/horaire-famille?google=cancelled');
    const replay=res();await routes.get('get /api/family-portal/google/callback')({headers:{cookie},query:{state,error:'access_denied'}},replay);assert.equal(replay.code,400);
    await db.query('INSERT INTO schedule_family_google(access_id,token,calendar_id,enabled) VALUES(1,$1,$2,TRUE)',[encryptToken('refresh',secret),'family']);
    await service.sync(1);assert.equal(events.size,1);assert.deepEqual(writes,['POST']);
    await service.sync(1);assert.deepEqual(writes,['POST']);
    entries=[{...entries[0],end:1020}];await service.sync(1);assert.equal(events.size,1);assert.equal(writes.at(-1),'PATCH');assert.match([...events.values()][0].end.dateTime,/17:00/);
    events.set('unrelated',{summary:'Family birthday'});
    failRead=true;await assert.rejects(()=>service.sync(1));assert.equal(events.size,2);failRead=false;
    entries=[];await service.sync(1);assert.equal(events.size,1);assert.ok(events.has('unrelated'));
    entries=[{start:600,end:900,department:'Service',detail:'Caisse'}];failInsert=true;await assert.rejects(()=>service.sync(1));assert.equal(events.size,2);await service.sync(1);assert.equal(events.size,2);
    await db.query("INSERT INTO schedule_family_google_events VALUES(1,'past','past',$1,'hash')",[addDays(today(),-1)]);events.set('past',{summary:'Past shift'});entries=[];await service.sync(1);assert.ok(events.has('past'));assert.ok(events.has('unrelated'));
    await db.query('UPDATE schedule_family_access SET active=FALSE WHERE id=1');const count=writes.length;await service.sync(1);assert.equal(writes.length,count);
    const other=res();await routes.get('get /api/family-portal/google')({family:{id:2}},other);assert.equal(other.body.connected,false);assert.ok(!JSON.stringify(other.body).includes('refresh'));
  }finally{await db.close();}
});

