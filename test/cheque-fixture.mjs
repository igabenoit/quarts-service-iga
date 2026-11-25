import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
export async function chequeFixture(){
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie,headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,code=200)=>{assert.equal(r.status,code,JSON.stringify(r.body).slice(0,300));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  const policy=must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201).id;
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');let next=0;
  async function createCase(documents=['cheque']){
   const name='Spécimen Fictif '+(++next);
   must(await f.call('POST','/api/departments/people',{cookie,body:{name,active:true,group:'regular',departments:[dep.id],availability:{}}}));
   const key=must(await admin('GET','state?view=direction')).employees.find(e=>e.name===name).key;
   const route=op=>'onboarding'+(op?'/'+op:'')+'?view=direction&key='+key;
   must(await admin('GET',route('')));
   const invitation=must(await admin('POST',route('invite'),{documents,email:'employee@example.invalid',managerEmail:'rh@example.invalid',due:'2030-01-01',days:3}));
   const token=invitation.path.split('#')[1],employeeHeaders={...headers,Authorization:'Bearer '+token};
   const call=(action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:employeeHeaders,body});
   return {key,name,route,token,employeeHeaders,call,policy:String(policy),path:invitation.path};
  }
  return {f,cookie,headers,must,admin,createCase,dep};
 }catch(error){await f.close();throw error;}
}
