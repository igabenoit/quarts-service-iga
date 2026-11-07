import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
test('programme privé : sauvegarde, conflit, historique, export et original intact',async()=>{
 const f=await liveAppFixture();try{
 const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-SST-Request':'1'};
 const rec=await f.call('POST','/api/sst/records',{cookie,headers,body:{kind:'document',title:'Programme FICTIF',status:'draft',fields:{}}});
 const binary=Buffer.from('%PDF-1.4\nDocument original fictif\n%%EOF');
 const upload=await fetch(f.base+'/api/sst/documents?recordId='+rec.body.id,{method:'POST',headers:{cookie,...headers,'Content-Type':'application/octet-stream','X-Filename':'Programme-fictif.pdf'},body:binary});assert.equal(upload.status,201);const id=(await upload.json()).id,path='/api/sst/prevention/'+id;
 assert.equal((await f.call('GET',path)).status,401);
 assert.equal((await f.call('POST',path,{cookie,body:{version:0,values:{p0:'Test'}}})).status,403);
 assert.deepEqual((await f.call('GET',path,{cookie})).body,{version:0,values:{}});
 const save=values=>f.call('POST',path,{cookie,headers,body:values});
 assert.equal((await save({version:0,values:{p0:'Responsable fictif',p2:'2027-05'}})).status,200);
 assert.equal((await save({version:0,values:{p0:'Écrasement concurrent'}})).status,409);
 assert.equal((await save({version:1,values:{p0:'Responsable corrigé',p2:'2027-05'},actor:'Auteur falsifié',created_at:'2000-01-01'})).status,200);
 assert.equal((await save({version:2,values:{bad:'Texte'}})).status,400);
 assert.equal((await f.call('GET',path,{cookie})).body.values.p0,'Responsable corrigé');
 const backup=(await f.call('GET','/api/sst/export',{cookie})).body;
 assert.equal(backup.preventionRevisions.length,2);assert.equal(backup.preventionRevisions[0].values_json.p0,'Responsable fictif');assert.equal(backup.preventionRevisions[1].actor,'Administration');assert.ok(!backup.preventionRevisions[1].created_at.startsWith('2000'));
 assert.equal(backup.events.filter(e=>e.action==='prevention.saved').length,2);
 assert.deepEqual(Buffer.from(await (await fetch(f.base+'/api/sst/documents/'+id,{headers:{cookie}})).arrayBuffer()),binary);
 }finally{await f.close();}
});

