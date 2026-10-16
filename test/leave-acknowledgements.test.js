import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installLeave} from '../leave.js';
import {installApprovalMail,queueApprovalMail} from '../leave-approval-mail.js';
import {installEmployeeNotices,queueEmployeeNotice} from '../leave-employee-notices.js';
import {createAcknowledgement} from '../leave-acknowledgements.js';
import {acknowledgementStatus} from '../public/leave-acknowledgement-status.js';

test('prises de connaissance : trois courriels, clic explicite, historique et absence de changement de décision',async t=>{
  const db=new PGlite(),pool={release(){},async query(sql,args){const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};return {...r,rowCount:r.affectedRows??r.rows.length};}};
  pool.connect=async()=>pool;
  const key=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='';
  try{
    const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
    await new Function('pool','return (async()=>{'+source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('))+'})();')(pool);
    const routes=new Map(),app={use(){}};for(const method of ['get','post','put','patch'])app[method]=(path,...handlers)=>routes.set(method+' '+path,handlers);
    const manager=()=>{},origin=()=>{},timer=globalThis.setInterval;
    globalThis.setInterval=()=>({unref(){}});
    try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});}finally{globalThis.setInterval=timer;}
    const dept=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service'")).rows[0].id;
    const periods=[{date:'2030-10-18',allDay:true,startMinute:0,endMinute:1440}];
    const snapshot={employee_name:'Camille',email:'employee@example.com',department_name:'Service',periods,decision_note:'Trouver un remplacement.'};
    for(const [i,kind] of ['approved','refused','conditional'].entries()){
      await pool.query(`INSERT INTO schedule_leave_requests(id,submission_key,employee_name,email,reason,periods,first_date,last_date,status,department_id,department_name,decision_note)
        VALUES($1,$2,'Camille','employee@example.com','MOTIF PRIVÉ',$3,'2030-10-18','2030-10-18',$4,$5,'Service','Trouver un remplacement.')`,[i+1,'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),JSON.stringify(periods),kind,dept]);
      if(kind==='approved')await queueApprovalMail(pool,i+1);else await queueEmployeeNotice(pool,i+1,kind);
    }
    const sent=[];const fetchImpl=async(_u,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({id:'fake-'+sent.length})};};
    const approvals=await installApprovalMail(pool,{autoStart:false,fetchImpl}),notices=await installEmployeeNotices(pool,{autoStart:false,fetchImpl});
    const run=async()=>{await pool.query("UPDATE schedule_leave_approval_mail SET available_at=clock_timestamp()-interval '1 minute'; UPDATE schedule_leave_employee_notices SET available_at=clock_timestamp()-interval '1 minute'");process.env.RESEND_API_KEY='fake';try{await approvals.run();await notices.run();}finally{process.env.RESEND_API_KEY='';}};
    const call=async(path,body={},extra={})=>{const res={code:200,body:null,headers:{},set(h){Object.assign(this.headers,h);return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await routes.get(path).at(-1)({body,params:{},query:{},headers:{},...extra},res);return res;};
    const preview=token=>call('post /api/leave/acknowledgements/preview',{token});
    const confirm=(token,confirmed=true)=>call('post /api/leave/acknowledgements/confirm',{token,confirmed});
    const ackRows=async()=>(await pool.query('SELECT * FROM schedule_leave_acknowledgements ORDER BY id')).rows;
    let tokens;
    await t.test('chaque courriel comporte un lien unique, persistant lors des reprises, sans motif privé',async()=>{
      await run();assert.equal(sent.length,3);
      tokens=sent.map(p=>{assert.match(p.html,/>J’ai pris connaissance<\/a>/);assert.doesNotMatch(p.html,/MOTIF PRIVÉ/);const url=p.text.match(/https:\/\/[^\s]+\/conge-lecture#[A-Za-z0-9_-]{43}/)?.[0];assert.ok(url);return new URL(url).hash.slice(1);});
      assert.equal(new Set(tokens).size,3);assert.equal((await ackRows()).length,3);
      for(const row of await ackRows()){assert.match(row.token_hash,/^[0-9a-f]{64}$/);assert.equal(row.snapshot.reason,undefined);assert.equal(row.acknowledged_at,null);}
      assert.equal((await ackRows())[0].snapshot.decision_note,'');
      await run();assert.equal(sent.length,3);assert.equal((await ackRows()).length,3);
    });
    await t.test('prévisualiser ne confirme jamais; tous les POST passent par sameOrigin',async()=>{
      for(const name of ['preview','confirm'])assert.equal(routes.get('post /api/leave/acknowledgements/'+name)[0],origin);
      assert.equal(routes.has('get /api/leave/acknowledgements/confirm'),false);
      for(const token of tokens){const res=await preview(token);assert.equal(res.code,200);assert.equal(res.body.acknowledgedAt,null);assert.equal(res.headers['Cache-Control'],'no-store');}
      assert.equal((await confirm(tokens[0],false)).code,400);assert.equal((await confirm(tokens[0],'true')).code,400);
      assert.ok((await ackRows()).every(r=>r.acknowledged_at===null));
    });
    await t.test('confirmation idempotente : première heure conservée, décision et horaire inchangés',async()=>{
      const before=(await pool.query('SELECT * FROM schedule_leave_requests ORDER BY id')).rows;
      const assignments=(await pool.query('SELECT * FROM schedule_assignments')).rows;
      for(const token of tokens){const result=await confirm(token);assert.equal(result.code,200);assert.ok(result.body.acknowledgedAt);const again=await confirm(token);assert.deepEqual(again.body.acknowledgedAt,result.body.acknowledgedAt);}
      assert.deepEqual((await pool.query('SELECT * FROM schedule_leave_requests ORDER BY id')).rows,before);
      assert.deepEqual((await pool.query('SELECT * FROM schedule_assignments')).rows,assignments);
    });
    await t.test('dates accessibles au gérant du département, aucun jeton ni motif dans le suivi de lecture',async()=>{
      assert.equal(routes.get('get /api/leave/requests')[0],manager);
      const data=await call('get /api/leave/requests',{}, {manager:{kind:'account',departments:[Number(dept)]}});assert.equal(data.code,200);
      assert.equal(data.body.requests.length,3);assert.ok(data.body.requests.every(r=>r.acknowledgements[0].acknowledgedAt));
      for(const request of data.body.requests){assert.deepEqual(Object.keys(request.acknowledgements[0]).sort(),['acknowledgedAt','kind','version']);assert.match(acknowledgementStatus(request),/Prise de connaissance confirmée/);}
      const other=await call('get /api/leave/requests',{}, {manager:{kind:'account',departments:[999]}});assert.equal(other.body.requests.length,0);
    });
    await t.test('conditions modifiées : ancien lien refusé, nouvelle confirmation attendue et historique conservé',async()=>{
      await pool.query("UPDATE schedule_leave_requests SET version=2,decision_note='Nouvelles conditions' WHERE id=3");
      assert.equal((await preview(tokens[2])).code,409);assert.equal((await confirm(tokens[2])).code,409);
      await queueEmployeeNotice(pool,3,'conditional');await run();assert.equal(sent.length,4);
      const token=new URL(sent[3].text.match(/https:\/\/[^\s]+\/conge-lecture#[A-Za-z0-9_-]{43}/)[0]).hash.slice(1);
      assert.notEqual(token,tokens[2]);assert.equal((await preview(token)).body.acknowledgedAt,null);
      const current=(await call('get /api/leave/requests')).body.requests.find(r=>Number(r.id)===3);
      assert.match(acknowledgementStatus(current),/En attente de prise de connaissance/);assert.match(acknowledgementStatus(current),/Prises de connaissance précédentes/);
      assert.equal((await confirm(token)).code,200);assert.equal((await pool.query('SELECT status,version FROM schedule_leave_requests WHERE id=3')).rows[0].status,'conditional');
    });
    await t.test('archives et liens invalides ne peuvent pas enregistrer de confirmation',async()=>{
      await pool.query('UPDATE schedule_leave_requests SET archived_at=clock_timestamp() WHERE id=2');
      assert.equal((await confirm(tokens[1])).code,410);
      for(const token of ['', 'invalid',randomBytes(32).toString('base64url')])assert.equal((await confirm(token)).code,404);
      assert.equal((await ackRows()).length,4);
    });
    await t.test('liens locaux de démonstration admis, origines non sécurisées refusées',async()=>{
      await assert.rejects(()=>createAcknowledgement(pool,{request_id:1,request_version:99},'approved',snapshot,{baseUrl:'http://example.com'}),/Adresse publique/);
      await pool.query('BEGIN');const link=await createAcknowledgement(pool,{request_id:1,request_version:99},'approved',snapshot,{baseUrl:'http://127.0.0.1:4457'});assert.match(link,/^http:\/\/127.0.0.1:4457\/conge-lecture#/);await pool.query('ROLLBACK');
    });
  }finally{if(key===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=key;await db.close();}
});

test('l’affichage utilise l’heure du Québec, sans transformer une ancienne lecture en confirmation actuelle',()=>{
  const row={status:'approved',version:2,acknowledgements:[{kind:'approved',version:2,acknowledgedAt:'2026-10-16T18:05:00Z'}]};
  assert.match(acknowledgementStatus(row),/16 octobre 2026 à 14 h 05/);assert.match(acknowledgementStatus(row),/Québec/);
  const changed={...row,version:3,status:'conditional'};assert.doesNotMatch(acknowledgementStatus(changed),/class="leave-acknowledgement seen"/);
});
