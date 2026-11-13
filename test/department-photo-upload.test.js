import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {PHOTO_PART_BYTES} from '../public/department-photo-upload.js';

test('blocs de photo privés, reprise, intégrité et nettoyage', {timeout:90000}, async () => {
  const f=await liveAppFixture();
  try {
    const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
    const deps=(await f.call('GET','/api/departments/meta',{cookie})).body.departments;
    const id=deps.find(d=>d.key==='boulangerie').id;
    const other=deps.find(d=>d.key==='viande').id;
    async function manager(index) {
      const name='Gérant photo '+index,login='photo-'+index,password='photo-test-local-'+index;
      const person=await f.call('POST','/api/departments/people',{cookie,body:{name,email:'',group:'regular',active:true,departments:[id],availability:{}}});
      assert.equal(person.status,200);
      const saved=await f.call('POST','/api/manager-accounts',{cookie,body:{name,login,password,departments:[id],active:true,personId:person.body.id}});
      assert.equal(saved.status,200,JSON.stringify(saved.body));
      return (await f.call('POST','/api/manager-login',{body:{login,password}})).cookie;
    }
    const owner=await manager(1),peer=await manager(2);
    const bytes=Buffer.alloc(PHOTO_PART_BYTES+39,71);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const metadata={weekStart:'2027-01-04',name:'Fictive.png',mime:'image/png',size:bytes.length,sha256};
    const path='/api/departments/'+id+'/photo-uploads/'+randomUUID();
    const request=(method,suffix='',body,session=owner)=>f.call(method,path+suffix,{cookie:session,body});
    const part=(offset,body,session=owner)=>fetch(f.base+path+'/parts/'+offset,{method:'PUT',headers:{cookie:session,'content-type':'application/octet-stream'},body});
    assert.equal((await f.call('POST',path,{body:metadata})).status,401);
    assert.equal((await f.call('POST',path.replace('/'+id+'/', '/'+other+'/'),{cookie:owner,body:metadata})).status,403);
    assert.equal((await request('POST','',metadata)).status,201);
    assert.equal((await request('POST','',metadata)).status,201);
    assert.equal((await part(PHOTO_PART_BYTES,bytes.subarray(PHOTO_PART_BYTES))).status,409);
    assert.equal((await part(0,bytes.subarray(0,PHOTO_PART_BYTES),peer)).status,409);
    assert.equal((await request('POST','/complete')).status,409);
    assert.equal((await part(0,bytes.subarray(0,PHOTO_PART_BYTES))).status,200);
    assert.equal((await part(0,bytes.subarray(0,PHOTO_PART_BYTES))).status,200);
    assert.equal((await part(0,Buffer.alloc(PHOTO_PART_BYTES))).status,409);
    assert.equal((await part(PHOTO_PART_BYTES,bytes.subarray(PHOTO_PART_BYTES))).status,200);
    assert.equal((await request('POST','/complete',undefined,peer)).status,404);
    const completed=await request('POST','/complete');
    assert.equal(completed.status,201,JSON.stringify(completed.body));
    assert.deepEqual((await request('POST','/complete')).body,completed.body);
    const get=await f.call('GET','/api/departments/photos/'+completed.body.id,{cookie:owner});
    assert.equal(createHash('sha256').update(Buffer.from(get.body.dataUrl.split(',')[1],'base64')).digest('hex'),sha256);
    const abandoned='/api/departments/'+id+'/photo-uploads/'+randomUUID();
    assert.equal((await f.call('POST',abandoned,{cookie:owner,body:{...metadata,size:39,sha256:'0'.repeat(64)}})).status,201);
    assert.equal((await fetch(f.base+abandoned+'/parts/0',{method:'PUT',headers:{cookie:owner,'content-type':'application/octet-stream'},body:bytes.subarray(0,39)})).status,200);
    assert.equal((await f.call('POST',abandoned+'/complete',{cookie:owner})).status,409);
    await f.call('DELETE',abandoned,{cookie:owner});
    const {rows:[counts]}=await f.query('SELECT count(*)::int AS total,sum(octet_length(content))::int AS stored FROM schedule_department_photo_uploads');
    assert.deepEqual(counts,{total:1,stored:0});
  } finally { await f.close(); }
});
