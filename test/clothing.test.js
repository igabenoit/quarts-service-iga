import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {departmentFixture} from './department-fixture.js';
import {installClothing} from '../clothing.js';
import {normalizeItems,supplierRows,orderTotal} from '../public/clothing-core.js';
import {supplierWorkbook} from '../clothing-xlsx.js';
test('clothing: validate variants, merge duplicate lines, use server prices and omit cancelled orders',()=>{
  const item={model:'3320',color:'Vert forêt',size:'XXL',quantity:2,unitPrice:1};
  const rows=normalizeItems([item,item]);assert.equal(rows[0].quantity,4);assert.equal(orderTotal(rows),16000);
  assert.throws(()=>normalizeItems([{...item,size:'XXXL'}]));assert.throws(()=>normalizeItems([{...item,quantity:21}]));assert.throws(()=>normalizeItems([{...item,quantity:1.5}]));
  const summary=supplierRows([{employee_name:'Private Name',items:rows},{items:rows,cancelled:true}]);assert.equal(summary[0].quantity,4);assert.doesNotMatch(JSON.stringify(summary),/Private Name|employee/);
  const xlsx=supplierWorkbook('Test & <titre>',summary);assert.equal(xlsx.subarray(0,2).toString(),'PK');assert.doesNotMatch(xlsx.toString(),/Private Name/);assert.match(xlsx.toString(),/Test &amp; &lt;titre&gt;/);
});
test('clothing HTTP: access, campaign locks, durable orders, duplicate retries, supplier export and cancellation',async()=>{
  const f=await departmentFixture(),app=express();app.use(express.json());let calls=0,failMail=true;
  const guard=(req,res,next)=>{if(req.headers['x-test-role']!=='admin')return res.status(403).json({error:'admin'});req.manager={kind:'admin'};next();};
  const staff=(req,res,next)=>req.headers['x-test-role']==='staff'?next():res.status(401).json({error:'staff'});
  const origin=(req,res,next)=>req.headers.origin==='https://evil.example'?res.status(403).json({error:'origin'}):next();
  const old=process.env.RESEND_API_KEY;process.env.RESEND_API_KEY='test-only';
  await installClothing(app,f.pool,{requireStaff:staff,requireManager:guard,sameOrigin:origin,fetchImpl:async(_url,options)=>{calls++;assert.match(options.headers['Idempotency-Key'],/^clothing-/);return {ok:!failMail,json:async()=>failMail?{}:{id:'simulated-only'}};}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const call=async(path,{role='admin',method='GET',body,origin}={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{'Content-Type':'application/json','x-test-role':role,...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return {code:r.status,body:r.headers.get('Content-Type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};};
  try{
    assert.equal((await call('/api/leave/clothing',{role:''})).code,401);assert.equal((await call('/api/clothing/campaigns',{role:'staff'})).code,403);
    let c=(await call('/api/clothing/campaigns')).body.campaigns[0];assert.equal(c.opened,false);
    const settings={title:'Test campagne',deadline:'2099-12-31',opened:true,recipients:['test@example.com'],version:c.version};
    const route='/api/clothing/campaigns/'+c.id;assert.equal((await call(route,{method:'PUT',body:settings,origin:'https://evil.example'})).code,403);
    c=(await call(route,{method:'PUT',body:settings})).body;assert.equal(c.opened,true);assert.equal((await call(route,{method:'PUT',body:settings})).code,409);
    const info=(await call('/api/leave/clothing',{role:'staff'})).body;assert.equal(info.campaign.accepting,true);assert.equal(info.campaign.recipients,undefined);
    const body={requestId:crypto.randomUUID(),campaignId:Number(c.id),campaignVersion:c.version,name:'Employé Test',departmentId:Number(info.departments[0].id),items:[{model:'3331',color:'Noir',size:'M',quantity:2,unitPrice:1}]};
    const orderPath='/api/leave/clothing/orders';assert.equal((await call(orderPath,{role:'staff',method:'POST',body:{...body,items:[{...body.items[0],size:'bad'}]}})).code,400);
    const first=await call(orderPath,{role:'staff',method:'POST',body});assert.equal(first.code,200);assert.equal(first.body.total,8000);assert.equal(first.body.mailStatus,'error');
    failMail=false;assert.equal((await call(orderPath,{role:'staff',method:'POST',body})).body.mailStatus,'sent');assert.equal((await call(orderPath,{role:'staff',method:'POST',body})).code,200);assert.equal(calls,2);
    assert.equal((await call(orderPath,{role:'staff',method:'POST',body:{...body,name:'Different'}})).code,409);
    let detail=(await call(route+'/orders')).body;assert.equal(detail.orders.length,1);assert.equal(detail.supplier[0].quantity,2);
    assert.equal((await call(route+'/orders',{role:'staff'})).code,403);assert.equal((await call(route+'/supplier.xlsx',{role:'staff'})).code,403);
    const xlsx=(await call(route+'/supplier.xlsx')).body;assert.equal(xlsx.subarray(0,2).toString(),'PK');assert.doesNotMatch(xlsx.toString(),/Employé Test|test@example/);
    await call('/api/clothing/orders/'+body.requestId,{method:'PATCH',body:{cancelled:true,version:1}});detail=(await call(route+'/orders')).body;assert.equal(detail.supplier.length,0);
    assert.equal((await call('/api/clothing/orders/'+body.requestId,{method:'PATCH',body:{cancelled:false,version:1}})).code,409);
    await call('/api/clothing/orders/'+body.requestId,{method:'PATCH',body:{cancelled:false,version:2}});assert.equal((await call(route+'/orders')).body.supplier[0].quantity,2);
    c=(await call(route,{method:'PUT',body:{...settings,opened:false,version:c.version}})).body;
    assert.equal((await call(orderPath,{role:'staff',method:'POST',body:{...body,requestId:crypto.randomUUID()}})).code,409);
    assert.equal((await call(orderPath,{role:'staff',method:'POST',body})).body.id,body.requestId);
    const newCampaign=await call('/api/clothing/campaigns',{method:'POST',body:{...settings,title:'Saison suivante',opened:false}});assert.equal((await call('/api/clothing/campaigns/'+newCampaign.body.id+'/orders')).body.orders.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));await f.db.close();if(old===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=old;}
});
