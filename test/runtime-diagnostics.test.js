import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {installHealth,requestDiagnostics,logEvent,errorCode,mailResult} from '../runtime-diagnostics.js';

test('health verifies the database and returns 503 instead of a false success; logs omit secrets',async()=>{
  const saved=process.env.RENDER_GIT_COMMIT,write=console.error,lines=[];
  process.env.RENDER_GIT_COMMIT='a'.repeat(40);console.error=line=>lines.push(line);
  let failure=false,query;
  const app=express();app.use(requestDiagnostics);
  installHealth(app,{query:async arg=>{query=arg;if(failure)throw Object.assign(Error('secret://database-password'),{code:'08006',detail:'employee-private-data'});return {rows:[{healthy:1}]};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/health`;
  try{
    const good=await fetch(url);assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');
    assert.equal((await good.json()).commit,'a'.repeat(40));assert.equal(query.query_timeout,1000);
    failure=true;const bad=await fetch(url);assert.equal(bad.status,503);assert.equal((await bad.json()).database,'unavailable');
    assert.ok(bad.headers.get('x-request-id'));assert.ok(lines.some(line=>JSON.parse(line).event==='health_failed'));
    logEvent('test',{code:errorCode(Error('password')),password:'do-not-log',sql:'private-query'},'error');
    mailResult('test',123,{ok:false,status:429},{id:null,message:'private-provider-response',to:'private@example.test'});
    assert.ok(lines.some(line=>JSON.parse(line).status===429&&JSON.parse(line).jobId==='123'));
    assert.doesNotMatch(lines.join(''),/secret:|database-password|employee-private-data|do-not-log|private-query/);
    assert.doesNotMatch(lines.join(''),/private-provider-response|private@example/);
  }finally{await new Promise(resolve=>server.close(resolve));console.error=write;if(saved===undefined)delete process.env.RENDER_GIT_COMMIT;else process.env.RENDER_GIT_COMMIT=saved;}
});
