import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {departmentFixture} from './department-fixture.js';
import {installSST} from '../sst.js';
import {validateSSTIntake,importSSTIntake} from '../sst-intake.js';
const bytes=Buffer.from('%PDF-1.4\noriginal test only\n%%EOF');
function payload(){return {format:'iga-sst-intake-v1',id:randomUUID(),label:'Import isolé de test',records:[{key:'reference',files:['one'],kind:'document',title:'Modèle vierge',status:'open',departmentKey:'charcuterie',relatedKey:'visit',details:'Aucune activité attestée.'},{key:'visit',files:[],kind:'inspection',title:'Visite CNESST test',status:'open',eventDate:'2026-11-10'},{key:'bilan',files:[],kind:'document',title:'Bilan',status:'open'}],documents:[{key:'one',name:'original.pdf',dataBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}]}}
test('import SST : validation complète avant toute écriture',()=>{
 for(const change of [p=>p.documents[0].sha256='0'.repeat(64),p=>p.documents[0].name='../privé.pdf',p=>p.records[0].employeeKey='service:1',p=>p.records[0].kind='training',p=>p.records[0].files=['one','one'],p=>p.records[1].relatedKey='reference',p=>p.documents[0].key='orphan']){const v=payload();change(v);assert.throws(()=>validateSSTIntake(v))}
});
test('import SST : originaux, liens, audit, atomicité et réexécution sans toucher aux saisies',async()=>{
 const f=await departmentFixture();try{
  await installSST(f.app,f.pool,{identity:()=>null});const p=payload(),first=await importSSTIntake(f.pool,p);assert.equal(first.document_count,1);assert.equal(first.record_count,3);
  const record=(await f.pool.query("SELECT * FROM sst_records WHERE title='Modèle vierge'")).rows[0];assert.ok(record.related_id);assert.equal(record.employee_key,null);assert.equal(record.event_date,null);
  const file=(await f.pool.query('SELECT * FROM sst_documents')).rows[0];assert.deepEqual(Buffer.from(file.data),bytes);assert.equal(file.record_id,record.id);
  assert.equal(Number((await f.pool.query('SELECT count(*) n FROM sst_events')).rows[0].n),4);
  await f.pool.query("UPDATE sst_records SET title='Version corrigée par l’administration',version=2,archived_at=clock_timestamp() WHERE id=$1",[record.id]);
  assert.equal((await importSSTIntake(f.pool,p)).alreadyImported,true);const kept=(await f.pool.query('SELECT * FROM sst_records WHERE id=$1',[record.id])).rows[0];assert.equal(kept.version,2);assert.ok(kept.archived_at);assert.match(kept.title,/corrigée/);
  const tampered=structuredClone(p);tampered.records[0].title='Écrasement';await assert.rejects(()=>importSSTIntake(f.pool,tampered));
  const bad=payload();bad.records.push({key:'bad',files:[],kind:'document',title:'Doit annuler le lot',status:'open',departmentKey:'unknown'});await assert.rejects(()=>importSSTIntake(f.pool,bad));assert.equal(Number((await f.pool.query('SELECT count(*) n FROM sst_records')).rows[0].n),3);assert.equal(Number((await f.pool.query('SELECT count(*) n FROM sst_imports')).rows[0].n),1);
  const second=payload();second.documents[0].dataBase64=Buffer.from('%PDF-1.4 autre').toString('base64');second.documents[0].sha256=createHash('sha256').update(Buffer.from('%PDF-1.4 autre')).digest('hex');const two=await importSSTIntake(f.pool,second);assert.equal(two.record_count,2);assert.equal(Number((await f.pool.query("SELECT count(*) n FROM sst_records WHERE kind='inspection'")).rows[0].n),1);
 }finally{await f.db.close()}
});

test('import SST : transmission privée avec contrôle de session et origine',async()=>{
 const {liveAppFixture}=await import('./live-app-fixture.mjs');const f=await liveAppFixture();try{
  const p=payload(),body=Buffer.from(JSON.stringify(p));const send=async(cookie,origin=f.base,raw=body)=>{const r=await fetch(f.base+'/api/sst/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-SST-Request':'1',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:raw});return {status:r.status,body:await r.json()}};
  assert.equal((await send()).status,401);const admin=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;assert.equal((await send(admin,'https://other.example')).status,403);assert.equal((await send(admin,f.base,Buffer.from('{invalid'))).status,400);
  const first=await send(admin);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.documents,1);const repeat=await send(admin);assert.equal(repeat.status,200);assert.equal(repeat.body.alreadyImported,true);
  const saved=(await f.call('GET','/api/sst/export',{cookie:admin})).body;assert.equal(saved.documents[0].dataBase64,bytes.toString('base64'));assert.equal(saved.imports.length,1);
 }finally{await f.close()}
});

test('lots et grilles de 16 Mio : dépôt par blocs, relecture et reprise',async()=>{
 const {liveAppFixture}=await import('./live-app-fixture.mjs');
 const {PART_BYTES,sendBlocks}=await import('../public/file-blocks.js');
 const f=await liveAppFixture();
 const direct=globalThis.fetch;
 const base=new URL(f.base);
 const max=16*1024*1024;
 const pdf=Buffer.concat([bytes,Buffer.alloc(9*1024*1024,32),Buffer.from('\n%%EOF')]);
 const sha=createHash('sha256').update(pdf).digest('hex');
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Cookie:cookie,Origin:base.origin,'X-SST-Request':'1'};
  const lot=payload();
  lot.documents[0]={key:'one',name:'lot-fictif.pdf',dataBase64:pdf.toString('base64'),sha256:sha};
  const template={format:'iga-sst-grid-template-v1',title:'Grille fictive',sourceVersion:'v1',sourceName:'grille.pdf',pdfBase64:pdf.toString('base64'),
   pages:[{number:1,title:'Visite',blocks:[{type:'item',id:'sol',text:'Vérifier le sol'}]}]};
  for(const [path,object] of [['/api/sst/import',lot],['/api/sst/grid/templates',template]]){
   const json=Buffer.from(JSON.stringify(object));
   const file=new File([json,Buffer.alloc(max-json.length,32)],'essai.json');
   const url=base.origin+path+'/uploads/'+randomUUID();
   let parts=0;
   globalThis.location=base;
   globalThis.fetch=async(target,options)=>{
    assert.equal(new URL(target).origin,base.origin);
    if(options.method==='PUT'){assert.ok(options.body.size<=PART_BYTES);parts++;}
    return direct(target,{...options,headers:{...options.headers,...headers}});
   };
   const receipt=await sendBlocks(file,url,{'X-SST-Request':'1'},{name:file.name});
   assert.equal(parts,8);
   assert.ok(receipt.id);
   const replay=await direct(url+'/complete',{method:'POST',headers});
   assert.equal(replay.status,201);
   assert.deepEqual(await replay.json(),receipt);
   const otherPath=path==='/api/sst/import'?'/api/sst/grid/templates':'/api/sst/import';
   assert.equal((await direct(url.replace(path,otherPath)+'/complete',{method:'POST',headers})).status,404);
   let doc;
   if(path==='/api/sst/import'){
    assert.equal(receipt.documents,1);assert.equal(receipt.records,3);assert.ok(receipt.reportId);
    doc=(await f.query('SELECT id FROM sst_documents WHERE name=$1',['lot-fictif.pdf'])).rows[0].id;
   }else{
    doc=(await f.query('SELECT document_id FROM sst_grid_templates WHERE id=$1',[receipt.id])).rows[0].document_id;
   }
   const download=await direct(base.origin+'/api/sst/documents/'+doc,{headers});
   assert.equal(download.status,200);
   assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),sha);
   const staging=(await f.query('SELECT octet_length(content) AS remaining FROM sst_import_uploads WHERE original_id=$1',[receipt.id])).rows;
   assert.deepEqual(staging,[{remaining:0}]);
  }
 }finally{globalThis.fetch=direct;delete globalThis.location;await f.close()}
});
