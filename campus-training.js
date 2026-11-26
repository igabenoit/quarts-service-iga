import {normalizeEmail} from './employee-contacts.js';
import {tuacSender} from './tuac-reminders.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const isGoService=i=>i.platform==='campus'&&/^(?:formation\s+)?go\s+service(?:\s*[-–—]\s*rayon\s+du\s+service)?$/i.test(i.title.trim());
export function campusItems(items,dir,employee,departmentId){
 const serviceIds=dir.departments.filter(d=>d.code==='service'||d.name.toLocaleLowerCase('fr').trim()==='service').map(d=>Number(d.id));
 const service=serviceIds.includes(Number(departmentId))||employee.departments.some(id=>serviceIds.includes(Number(id)));
 return items.map(i=>isGoService(i)?{...i,title:service?'Formation GO Service - Rayon du Service':'Formation GO Service',url:'https://sobeys.csod.com/'}:i);
}
export function campusInstructions(items){
 const go=items.find(isGoService);
 const steps=['Ouvrez https://sobeys.csod.com/ et connectez-vous avec votre identifiant et le mot de passe indiqués dans ce courriel.','Sur la page d’accueil de Campus Sobeys, cliquez sur la loupe en haut à droite.'];
 if(go)steps.push('Écrivez « Go service » dans le champ de recherche, puis lancez la recherche.','Dans les résultats, sélectionnez exactement « '+go.title+' » (type : Curriculum, avec l’icône de livres empilés). Ne choisissez pas « GO Service Marchands », un atelier ou la formation pour gestionnaires.','Ouvrez ce parcours et suivez toutes les capsules. Faites défiler la liste vers le bas pour voir la suite et poursuivez les capsules au fur et à mesure de leur déverrouillage.','Complétez aussi l’évaluation des connaissances à la fin : elle est nécessaire pour terminer le parcours. Vérifiez que Campus indique que la formation est terminée.');
 else steps.push('Recherchez le titre exact de chaque formation indiquée dans ce courriel, puis ouvrez le résultat correspondant.','Complétez les activités et les évaluations demandées dans le parcours.');
 if(go&&items.some(i=>!isGoService(i)))steps.push('Pour les autres formations indiquées dans ce courriel, utilisez de nouveau la loupe et recherchez leur titre exact.');
 steps.push('Remettez votre attestation ou une capture du résultat terminé à votre gérant afin qu’il mette votre suivi à jour. Si vous ne trouvez pas le parcours ou si l’accès est bloqué, communiquez avec votre gérant.');
 return steps;
}
export function campusLogin(employee){
 if(!employee?.active||employee.issue||!/^\d{6}$/.test(employee.matricule||''))fail('Vérifiez le matricule à six chiffres dans le dossier de cet employé.');
 return 'm08327e'+employee.matricule;
}
export function campusLink(value){
 if(!value)return 'https://sobeys.csod.com/';
 let url;try{url=new URL(value);}catch{fail('Lien Campus invalide.');}
 if(url.protocol!=='https:'||url.hostname!=='sobeys.csod.com'||url.port||url.username||url.password||/targetUser/i.test(url.href))fail('Utilisez un lien Campus partageable sans targetUser, ou laissez le lien vide pour ouvrir la connexion Campus.');
 return url.href;
}
export function campusEmailPayload(p,login,items,email){
 return {from:tuacSender(),to:[email],subject:'Campus Alimentor — vos accès et formations',text:`Bonjour ${p.employee_name},\n\nVoici vos accès à Campus Alimentor de Sobeys.\n\nConnexion : https://sobeys.csod.com/\nIdentifiant : ${login}\nMot de passe : Campus2027\n\nFormations à suivre avant le ${p.due_date} :\n${items.map(i=>'• '+i.title+'\n'+campusLink(i.url)).join('\n\n')}\n\nCOMMENT ACCÉDER À VOTRE FORMATION\n\n${campusInstructions(items).map((step,index)=>(index+1)+'. '+step).join('\n\n')}\n\nIGA Famille Benoit 300-425`};
}
export function installCampusTraining(app,{base,pool,sourcePool,auth,origin,wrap,transaction,directory,plan,audit}){
 const owner=a=>{if(!a.admin||a.view!=='direction')fail('La direction doit confirmer la réinitialisation et envoyer les accès.',403);};
 async function preview(req,db=pool){
  owner(req.ef);const p=await plan(req.ef,req.params.id,db),items=p.items.filter(i=>i.platform==='campus');if(!items.length)fail('Ce parcours ne contient aucune formation Campus.');
  const dir=await directory(),employee=dir.employees.find(e=>e.key===p.employee_key),login=campusLogin(employee);
  const contact=employee.personId?(await sourcePool.query("SELECT COALESCE(NULLIF(c.email,''),p.email,'') AS email FROM schedule_store_people p LEFT JOIN schedule_employee_contacts c ON c.employee_id=p.service_employee_id WHERE p.id=$1",[employee.personId])).rows[0]:null;
  return {p,login,email:normalizeEmail(contact?.email),items:campusItems(items,dir,employee,p.department_id)};
 }
 app.get(base+'/plans/:id/campus',auth,wrap(async(req,res)=>{
  const {p,login,email,items}=await preview(req);
  const confirmations=(await pool.query("SELECT actor,created_at,data FROM training_events WHERE plan_id=$1 AND action='campus.reset.confirmed' ORDER BY id DESC LIMIT 1",[p.id])).rows;
  res.json({employeeName:p.employee_name,login,email,password:'Campus2027',version:p.version,items,instructions:campusInstructions(items),dueDate:p.due_date,lastConfirmation:confirmations[0]||null});
 }));
 app.post(base+'/plans/:id/campus/test-email',auth,origin,wrap(async(req,res)=>{
  owner(req.ef);const b=req.body||{};
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.requestId||''))fail('Référence de test invalide.');
  if(!process.env.RESEND_API_KEY)fail('Le service courriel est indisponible.',503);
  const result=await transaction(async db=>{
   const {p,login,items}=await preview(req,db);
   if(p.version!==b.version||login!==b.login)fail('Le parcours ou le matricule a changé. Rouvrez la préparation du courriel.',409);
   const email='igabenoit@gmail.com',dedupe='campus-test:'+p.id+':'+p.version+':'+login+':'+b.requestId;
   const old=(await db.query('SELECT id,dedupe,status FROM training_mail WHERE id=$1',[b.requestId])).rows[0];
   if(old){if(old.dedupe!==dedupe)fail('Cette référence correspond à un autre envoi.',409);return {queued:true,id:old.id,status:old.status,to:email,alreadyQueued:true};}
   const payload=campusEmailPayload(p,login,items,email);payload.subject='[TEST] '+payload.subject;
   await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[b.requestId,dedupe,p.department_id,JSON.stringify(payload)]);
   await audit(db,req.ef,'campus.test.queued',{mailId:b.requestId,email},p.id);
   return {queued:true,id:b.requestId,status:'pending',to:email};
  });res.json(result);
 }));
 app.post(base+'/plans/:id/campus/email',auth,origin,wrap(async(req,res)=>{
  owner(req.ef);const b=req.body||{};
  if(b.resetConfirmed!==true)fail('Confirmez avoir réinitialisé le mot de passe dans Campus à Campus2027 avant l’envoi.');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.requestId||''))fail('Référence d’envoi invalide.');
  const email=normalizeEmail(b.email);if(!email)fail('Indiquez le courriel de cet employé.');
  if(!process.env.RESEND_API_KEY)fail('Le service courriel est indisponible.',503);
  const result=await transaction(async db=>{
   const {p,login,items}=await preview(req,db);if(p.version!==b.version||login!==b.login)fail('Le parcours ou le matricule a changé. Rouvrez la préparation du courriel.',409);
   const dedupe='campus:'+p.id+':'+p.version+':'+login+':'+email+':guide-v2';
   const existing=(await db.query('SELECT id,dedupe,status FROM training_mail WHERE id=$1 OR dedupe=$2',[b.requestId,dedupe])).rows;
   if(existing.some(e=>e.id===b.requestId&&e.dedupe!==dedupe))fail('Cette référence correspond à un autre envoi.',409);
   if(existing.length)return {queued:true,id:existing[0].id,status:existing[0].status,alreadyQueued:true};
   const payload=campusEmailPayload(p,login,items,email);
   await audit(db,req.ef,'campus.reset.confirmed',{login,employeeKey:p.employee_key},p.id);
   await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[b.requestId,dedupe,p.department_id,JSON.stringify(payload)]);
   await audit(db,req.ef,'campus.email.queued',{mailId:b.requestId,email,login},p.id);
   return {queued:true,id:b.requestId,status:'pending'};
  });res.json(result);
 }));
}
