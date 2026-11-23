import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {liveAppFixture} from './live-app-fixture.mjs';
import {tuacFields} from '../onboarding/tuac.js';
import {sendInvitation,invitationToken,invitationEmailReady} from '../onboarding/mail.js';
import {onboardingForm} from '../public/employee-onboarding.js';

test('une fiche importée peut recevoir tous les documents sans perdre les signatures', {timeout:90000},async()=>{
 const f=await liveAppFixture({employeeVault:true,onboardingEmail:true});
 try{
  const cookie=(await f.call('POST','/api/login',{body:{code:'audit-admin-test'}})).cookie;
  const headers={Origin:f.base,'X-Employee-Files':'1'};
  const must=(r,code=200)=>{assert.equal(r.status,code,JSON.stringify(r.body).slice(0,400));return r.body;};
  const admin=(method,path,body)=>f.call(method,'/api/employee-files/'+path,{cookie,headers,body});
  const dep=must(await f.call('GET','/api/departments/meta',{cookie})).departments.find(d=>d.key==='boulangerie');
  must(await f.call('POST','/api/departments/people',{cookie,body:{name:'Nouvelle Fictive',group:'regular',active:true,departments:[dep.id],availability:{},employeeCode:'887761'}}));
  const key=must(await admin('GET','state')).employees.find(e=>e.name==='Nouvelle Fictive').key;
  await f.query('UPDATE schedule_store_people SET onboarding_new=false WHERE id=$1',[key.split(':')[1]]);
  const route=(op='')=>'onboarding'+(op?'/'+op:'')+'?key='+key+'&view=direction';
  assert.equal(must(await admin('GET',route())).eligible,false);
  must(await f.call('POST','/api/employee-files/'+route('start'),{body:{},headers}),401);
  must(await f.call('POST','/api/employee-files/'+route('start'),{body:{},cookie}),403);
  must(await admin('POST',route('start'),{}));
  const draft=must(await admin('GET',route()));assert.equal(draft.eligible,true);
  assert.deepEqual(draft.defaultDocuments,['renseignements','tuac','retraite','urgence','ethique','sst_general']);
  const selection={documents:['tuac'],email:'employee@example.invalid',managerEmail:'rh@example.invalid',days:3,due:'2030-01-01'};
  must(await admin('POST',route('invite'),selection),428);
  must(await admin('POST','policy?view=direction',{text:'Politique fictive de confidentialité. '.repeat(12),confirmed:true}),201);
  const invite=must(await admin('POST',route('invite'),selection));let token=invite.path.split('#')[1];
  const execute=(action,body={},useToken=token)=>f.call('POST','/api/accueil-employe/'+action,{headers:{...headers,Authorization:'Bearer '+useToken},body});
  const initial=must(await execute('state'));
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Nom:'Fictif',Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid'});
  must(await execute('sign',{kind:'tuac',version:0,policy:initial.policy.id,answers,strokes:[[[0,0],[0.5,0.8],[1,0.2]]]}));
  const signed=must(await admin('GET',route()));assert.ok(signed.completed_at);const original=signed.documents[0].original_id;
  await f.query(null,null,{invitationMessages:true,fail:true});
  const expanded=must(await admin('POST',route('invite'),{...selection,documents:draft.defaultDocuments,delivery:'email'}));
  assert.equal(expanded.path,invite.path);assert.equal(expanded.delivery.status,'failed');
  const state=must(await execute('state'));assert.equal(state.documents.length,6);assert.equal(state.documents.find(d=>d.kind==='tuac').done,true);
  const updated=must(await admin('GET',route()));assert.equal(updated.completed_at,null);assert.equal(updated.documents.find(d=>d.kind==='tuac').original_id,original);
  assert.equal(updated.lastDelivery.status,'failed');
  const failed=await f.query(null,null,{invitationMessages:true,fail:false});assert.equal(failed.length,1);
  const retried=must(await admin('POST',route('send'),{}));assert.equal(retried.delivery.status,'sent');assert.equal(retried.path,invite.path);
  const sent=await f.query(null,null,{invitationMessages:true});assert.equal(sent.length,1);assert.equal(sent[0].id,failed[0].id);
  assert.deepEqual(sent[0].payload.to,['employee@example.invalid']);assert.equal(sent[0].payload.attachments,undefined);
  assert.equal(must(await admin('GET',route())).lastDelivery.status,'sent');
  const events=await f.query("SELECT data FROM employee_file_events WHERE action='onboarding.delivery'",[],{vault:true});assert.ok(!JSON.stringify(events).includes(token));
  must(await admin('POST',route('invite'),{...selection,documents:['unknown']}),400);
  const corrected=must(await admin('POST',route('invite'),{...selection,documents:draft.defaultDocuments,email:'correct@example.invalid'}));
  must(await execute('state'),404);token=corrected.path.split('#')[1];must(await execute('state'));
  assert.equal(must(await admin('GET',route())).lastDelivery.status,null);
  must(await admin('POST',route('revoke'),{}));must(await execute('state'),404);
  must(await admin('POST',route('send'),{}),409);
  token=must(await admin('POST',route('renew'),{})).path.split('#')[1];assert.equal(must(await execute('state')).documents.length,6);
 }finally{await f.close();}
});

test('invitation : un courriel, six titres, lien personnel et reprise sans doublon',async t=>{
 const previous=process.env.SESSION_SECRET;process.env.SESSION_SECRET='fiction-test-only';
 t.after(()=>{if(previous===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=previous;});
 const token=invitationToken('test-nonce'),row={employee_key:'store:1',generation:1,nonce:'test-nonce',token_hash:createHash('sha256').update(token).digest('hex'),employee_email:'employee@example.invalid',due:'2030-01-01'};
 const titles=['Informations personnelles','TUAC','Retraite','Urgence','Éthique','SST 2026'],sent=[],options={site:'https://portail.example.invalid',from:'rh@example.invalid',send:async(payload,id)=>sent.push({payload,id})};
 assert.equal((await sendInvitation(row,titles,options)).status,'sent');await sendInvitation(row,titles,options);
 assert.equal(sent.length,2);assert.equal(sent[0].id,sent[1].id);
 assert.deepEqual(sent[0].payload.to,['employee@example.invalid']);assert.equal(sent[0].payload.attachments,undefined);
 for(const title of titles)assert.ok(sent[0].payload.text.includes(title));
 assert.ok(sent[0].payload.text.includes('https://portail.example.invalid/accueil-employe.html#'+token));
 await assert.rejects(()=>sendInvitation({...row,token_hash:null},titles,options));
 await assert.rejects(()=>sendInvitation(row,titles,{...options,send:async()=>{throw Error('Simulated provider failure');}}));
 assert.equal(sent.length,2);
});

test('formulaire : six documents présélectionnés, ancien SST exclu, signature conservée',()=>{
 const catalog={renseignements:'Informations personnelles',tuac:'TUAC',retraite:'Retraite',urgence:'Urgence',ethique:'Éthique',sst_general:'SST 2026',sst:'Ancien SST'};
 const html=onboardingForm({catalog,defaultDocuments:['renseignements','tuac','retraite','urgence','ethique','sst_general'],documents:[{kind:'tuac',done:true,invited:true}],employee_email:'test@example.invalid',emailReady:true});
 assert.equal((html.match(/name="doc"/g)||[]).length,6);assert.ok(!html.includes('Ancien SST'));
 assert.match(html,/value="tuac" checked disabled/);assert.ok(html.includes('Envoyer les documents par courriel'));
 const existing=onboardingForm({catalog,defaultDocuments:['renseignements','tuac'],invited_at:'2026-11-20',documents:[{kind:'tuac',done:true,invited:true},{kind:'renseignements',invited:false}],emailReady:true});
 assert.match(existing,/value="renseignements" checked><span>Informations personnelles <span class="badge warn">À ajouter à l’envoi/);
 assert.match(existing,/value="tuac" checked disabled/);
 const escaped=onboardingForm({catalog:{tuac:'<script>faux</script>'},defaultDocuments:['tuac'],documents:[],employee_email:'" onfocus="evil'});
 assert.ok(!escaped.includes('<script>'));assert.ok(escaped.includes('&quot; onfocus=&quot;evil'));
 assert.ok(!escaped.includes('value="email">'));assert.equal(typeof invitationEmailReady(),'boolean');
});
