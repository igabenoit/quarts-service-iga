import test from 'node:test';import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {incidentGroups} from '../public/incident-groups-model.js';
import {emptyReport} from '../public/incident-report-schema.js';
test('Regroupement explicite, filtre sur une pièce et dates inconnues conservées',()=>{
 const records=[{id:'a',kind:'incident',title:'Déclaration · Exemple',event_date:'2026-05-20',event_group_id:'a'},{id:'b',kind:'incident',title:'Enquête · Exemple',event_date:'2026-05-19',event_group_id:'a'},{id:'c',kind:'incident',title:'Autre événement',event_date:null},{id:'d',kind:'incident',title:'Déclaration · Exemple',event_date:'2026-05-20'}];
 assert.equal(incidentGroups(records).length,3,'Même nom/date ne fusionne pas deux incidents');
 const filtered=incidentGroups(records,[records[1]]);assert.equal(filtered.length,1);assert.deepEqual(filtered[0].rows.map(r=>r.id),['a','b']);assert.equal(records[1].event_date,'2026-05-19');
});
test('Suivi collectif et regroupement : autorisations, atomicité, originaux, historique et export',async()=>{
 const f=await liveAppFixture();try{
 const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-SST-Request':'1'};
 const call=(path,body)=>f.call(body?'POST':'GET','/api/sst/'+path,{cookie:admin,headers,body});
 const make=async(title,eventDate=null,kind='incident',fields={})=>{const r=await call('records',{kind,title,eventDate,status:'draft',fields});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.id;};
 const signed=emptyReport();signed.answers.witnessName='Témoin fictif';signed.signatures.witness=[[[4,8],[12,22]]];
 const a=await make('Déclaration fictive','2026-05-20','incident',{accidentReport:signed}),b=await make('Enquête fictive','2026-05-19'),unknown=await make('Date inconnue'),other=await make('Document hors incident',null,'document');
 const get=async()=> (await call('state')).body.records;
 const batch=async(ids)=>(await get()).filter(r=>ids.includes(r.id)).map(r=>({id:r.id,version:r.version}));
 const upload=await fetch(f.base+'/api/sst/documents?recordId='+b,{method:'POST',headers:{...headers,Cookie:admin,'Content-Type':'application/octet-stream','X-Filename':'preuve-fictive.pdf'},body:Buffer.from('%PDF-1.4\nOriginal fictif\n%%EOF')});assert.equal(upload.status,201);const docId=(await upload.json()).id;
 const initial=await batch([a,b,unknown]);
 for(const path of ['incidents/followup','incidents/group']){assert.equal((await f.call('POST','/api/sst/'+path,{body:{}})).status,401);assert.equal((await f.call('POST','/api/sst/'+path,{cookie:admin,body:{}})).status,403);assert.equal((await f.call('POST','/api/sst/'+path,{cookie:admin,headers:{...headers,Origin:'https://autre.invalid'},body:{}})).status,403);}
 assert.equal((await call('incidents/followup',{records:await batch([a,other]),status:'done'})).status,400);assert.equal((await get()).find(r=>r.id===a).status,'draft');
 assert.equal((await call('incidents/followup',{records:initial,status:'done',owner:'Direction fictive'})).status,200);
 let rows=await get();assert.equal(rows.find(r=>r.id===unknown).event_date,null);assert.equal(rows.find(r=>r.id===unknown).status,'done');assert.deepEqual(rows.find(r=>r.id===a).fields.accidentReport,signed);
 assert.equal((await call('incidents/followup',{records:initial,status:'progress'})).status,409);assert.equal(rows.find(r=>r.id===a).status,'done');
 assert.equal((await call('incidents/group',{operation:'group',anchorId:a,records:await batch([a,b])})).status,200);
 rows=await get();assert.equal(rows.find(r=>r.id===b).event_group_id,a);assert.equal(String(rows.find(r=>r.id===b).event_date).slice(0,10),'2026-05-19');
 assert.equal((await call('incidents/group',{operation:'group',anchorId:unknown,records:await batch([b,unknown])})).status,409,'Un regroupement ne peut être déplacé en partie');
 assert.equal((await call('incidents/group',{operation:'group',anchorId:other,records:await batch([a,b])})).status,400);
 const backup=(await call('export')).body;assert.equal(backup.records.find(r=>r.id===b).event_group_id,a);assert.equal(backup.documents.find(d=>d.id===docId).record_id,b);assert.equal(Buffer.from(backup.documents.find(d=>d.id===docId).dataBase64,'base64').toString(),'%PDF-1.4\nOriginal fictif\n%%EOF');
 const events=backup.events.filter(e=>e.record_id===a);assert.ok(events.some(e=>e.action==='incident.grouped'&&e.before_value.event_group_id===null&&e.after_value.event_group_id===a));assert.ok(events.some(e=>e.action==='incident.followup.updated'&&e.before_value.status==='draft'&&e.after_value.status==='done'&&e.actor&&e.created_at));
 assert.equal((await call('incidents/group',{operation:'ungroup',records:await batch([a,b])})).status,200);assert.equal((await get()).find(r=>r.id===b).event_group_id,null);
 // A manager remains unable to modify or group confidential SST records.
 const meta=(await f.call('GET','/api/departments/meta',{cookie:admin})).body,dept=meta.departments[0];
 const person=await f.call('POST','/api/departments/people',{cookie:admin,body:{name:'Gestion fictive groupes',group:'regular',active:true,departments:[dept.id],availability:{},employeeCode:'887763'}});
 const account={name:'Gestion fictive',login:'group.test',password:'Example-test-12345',active:true,departments:[dept.id],personId:person.body.id};
 assert.equal((await f.call('POST','/api/manager-accounts',{cookie:admin,headers:{Origin:f.base},body:account})).status,200);
 const manager=(await f.call('POST','/api/manager-login',{body:{login:account.login,password:account.password}})).cookie;
 for(const path of ['incidents/followup','incidents/group'])assert.equal((await f.call('POST','/api/sst/'+path,{cookie:manager,headers,body:{records:await batch([a,b]),operation:'group',anchorId:a,status:'done'}})).status,403);
 }finally{await f.close();}
});
