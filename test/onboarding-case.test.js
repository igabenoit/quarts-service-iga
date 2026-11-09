import test from 'node:test';
import assert from 'node:assert/strict';
import {liveAppFixture} from './live-app-fixture.mjs';
import {tuacFields} from '../onboarding/tuac.js';

test('parcours de deux nouvelles embauches isolées', {timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,code=200)=>{assert.equal(r.status,code,JSON.stringify(r.body).slice(0,400));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  const tokens=[],routes=[];
  for(const [n,code] of [['Alice Exemple','887751'],['Bob Exemple','887752']]){
   must(await f.call('POST','/api/departments/people',{cookie,body:{name:n,group:'regular',active:true,departments:[dep.id],availability:{},employeeCode:code}}));
   const key=must(await admin('GET','state')).employees.find(e=>e.name===n).key;
   const route=(op='')=>'onboarding'+(op?'/'+op:'')+'?key='+key+'&view=direction';routes.push(route);
   const draft=must(await admin('GET',route()));assert.ok(draft.eligible);assert.equal(draft.invited_at,null);
   const invite=must(await admin('POST',route('invite'),{documents:['tuac'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-01-01'}));tokens.push(invite.path.split('#')[1]);
  }
  const execute=(i,action,body={})=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+tokens[i]},body});
  assert.deepEqual(await f.onboardingMail(),[]);
  const reminders=[...await f.onboardingMail(true),...await f.onboardingMail()];
  assert.equal(reminders.length,2);
  for(const item of reminders){assert.equal(item.payload.subject,'Rappel de votre accueil');assert.ok(tokens.some(t=>item.payload.text.endsWith(t)));assert.equal(item.payload.attachments,undefined);}
  assert.deepEqual(await f.onboardingMail(),[]);
  const initial=must(await execute(0,'state'));
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Nom:'Fictif',Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid'});
  const body={kind:'tuac',version:0,policy:initial.policy.id,answers};
  must(await execute(0,'save',body));assert.equal(must(await execute(0,'state')).documents[0].draft.Nom,'Fictif');
  assert.deepEqual(must(await execute(1,'state',{employeeKey:'store:1'})).documents[0].draft,{});
  must(await admin('POST',routes[0]('revoke'),{}));must(await execute(0,'state'),404);
  tokens[0]=must(await admin('POST',routes[0]('renew'),{})).path.split('#')[1];
  assert.equal(must(await execute(0,'state')).documents[0].version,1);
  must(await execute(0,'sign',{...body,version:1,strokes:[[[0,0],[0.5,0.8],[1,0.2]]]}));
  const status=must(await admin('GET',routes[0]()));assert.ok(status.completed_at);assert.ok(status.activity);
  const notifications=await f.onboardingMail(true);assert.equal(notifications.length,1);
  assert.deepEqual(notifications[0].payload.to,['rh@example.invalid']);assert.equal(notifications[0].payload.subject,'Dossier d’accueil complété');
  assert.equal(notifications[0].payload.attachments,undefined);assert.deepEqual(await f.onboardingMail(),[]);
  const original='originals/'+status.documents[0].original_id;
  const pdf=await admin('GET',original);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok(pdf.body.startsWith('%PDF-'));
  assert.equal((await f.call('GET','/api/employee-files/'+original,{headers:{Authorization:'Bearer '+tokens[1]}})).status,401);
  assert.equal(must(await execute(1,'state')).documents[0].done,false);
 }finally{await f.close();}
});

