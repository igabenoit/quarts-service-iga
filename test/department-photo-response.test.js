import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {sendDepartmentPhoto} from '../department-photo-response.js';

test('consultation d’une grande photo sans mise en mémoire tampon de la réponse HTTP',async()=>{
  const large='data:image/jpeg;base64,'+Buffer.alloc(5*1024*1024,0xff).toString('base64');
  const state={id:12,name:'Équipe de soir « A »',candidate:null};
  const app=express();
  app.get('/photo',(_req,res)=>sendDepartmentPhoto(res,state,large));
  const server=app.listen(0,'127.0.0.1');
  try {
    await once(server,'listening');
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/photo');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('transfer-encoding'),'chunked');
    assert.equal(response.headers.get('content-length'),null);
    assert.deepEqual(await response.json(),{...state,dataUrl:large});
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});
