import {scheduleEmailHtml} from './schedule-email-template.js';
import {campusEmployeeEmail} from './campus-training.js';
import {tuacSender} from './tuac-reminders.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export async function scheduleAccess(sourcePool,e){
 const code=!e.issue&&/^\d{6}$/.test(e.matricule||'')?e.matricule:'';
 const row=e.personId?(await sourcePool.query('SELECT required FROM schedule_passkey_users WHERE person_id=$1',[e.personId])).rows[0]:null;
 return {code,requiresPasskey:process.env.EMPLOYEE_PASSKEY_MODE==='required'||row?.required===true};
}
export function scheduleEmailPayload(email,isTest=false,access={code:'',requiresPasskey:true}){
 const code=/^\d{6}$/.test(access.code||'')?access.code:'';
 const instructions=access.requiresPasskey?'Ta connexion nécessite une clé d’accès. Ton matricule ci-dessus sert à identifier ton dossier; il ne remplace pas ta clé d’accès. Utilise « Me connecter avec ma clé d’accès ». Pour une première activation ou un nouvel appareil, demande un lien personnel à la direction.':'Ouvre le lien « Voir mon horaire », saisis les six chiffres ci-dessus dans « Code employé — 6 chiffres », puis appuie sur « Voir mon horaire ». Conserve les zéros au début du code. Garde ton code confidentiel.';
 let html=scheduleEmailHtml;
 const card='<tr><td style="padding:0 28px 24px"><div style="background:#eaf5ef;border-radius:8px;padding:22px"><strong>'+ (access.requiresPasskey?'Ton matricule':'Ton code d’accès personnel')+'</strong><p style="font-size:30px;letter-spacing:5px;font-weight:bold;margin:12px 0">'+code+'</p><p style="font-size:16px;line-height:1.6;margin:0">'+instructions+'</p></div></td></tr>';
 html=html.replace('<tr><td style="padding:0 28px 24px">',card+'<tr><td style="padding:0 28px 24px">');
 if(!access.requiresPasskey){html=html.replace('Demande à la direction de vérifier ton identité et de te remettre ton lien d’activation personnel. Suis les étapes sur ton appareil pour créer ta clé d’accès, puis reviens consulter ton horaire.','Utilise le code personnel indiqué ci-dessus. Si le portail te demande plutôt une clé d’accès, utilise ta clé ou communique avec la direction.').replace('Ton accès est déjà activé?','Pour consulter ton horaire').replace('Si une connexion est demandée, choisis <strong>« Me connecter avec ma clé d’accès »</strong>, puis utilise le déverrouillage habituel de ton appareil.','Saisis ton <strong>code employé à six chiffres</strong>, puis appuie sur <strong>« Voir mon horaire »</strong>.');}

 return {from:tuacSender(),to:[email],subject:(isTest?'[TEST] ':'')+'Ton horaire en ligne — IGA Famille Benoit',html,text:'Bonjour!\n\nVoici ton accès à ton horaire en ligne :\nhttps://quartservice.igabenoit.com/horaires-departements?vue=employe\n\n'+(access.requiresPasskey?'Ton matricule : ':'Ton code d’accès personnel : ')+code+'\n\n'+instructions+'\n\nConsulte tes quarts dans « Mon horaire ». Vérifie les dates et les heures affichées. Garde ce courriel ou ajoute la page à tes favoris. Si tu as besoin d’aide, communique avec ton gérant ou la direction.\n\nL’équipe IGA Famille Benoit'};
}
export function installScheduleEmail(app,{pool,sourcePool,auth,origin,wrap,transaction,directory}){
 const base='/api/employee-files/schedule-email';
 async function employee(req){
  if(!req.ef.admin||req.ef.view!=='direction')fail('Envoi réservé à la direction.',403);
  const dir=await directory(),e=dir.employees.find(e=>e.key===req.query.key&&e.active);
  if(!e)fail('Employé actif introuvable.',404);
  const dep=e.departments.find(id=>dir.departments.some(d=>Number(d.id)===Number(id)&&d.active));
  if(!dep)fail('Attribuez un département actif à cet employé.');
  return {e,dep};
 }
 app.get(base,auth,wrap(async(req,res)=>{
  const {e}=await employee(req),access=await scheduleAccess(sourcePool,e);
  const history=(await pool.query("SELECT id,status,created_at,sent_at,provider_id,payload->'to' AS recipients,payload->>'subject' AS subject FROM training_mail WHERE dedupe LIKE $1 ORDER BY created_at DESC LIMIT 10",['schedule:'+e.key+':%'])).rows;
  res.set('Cache-Control','no-store').json({email:await campusEmployeeEmail(pool,sourcePool,e),employeeName:e.name,emailReady:!!process.env.RESEND_API_KEY,html:scheduleEmailPayload('',false,access).html,access,history});
 }));
 for(const isTest of [false,true])app.post(base+(isTest?'/test':'/send'),auth,origin,wrap(async(req,res)=>{
  const {e,dep}=await employee(req),b=req.body||{};
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.requestId||''))fail('Référence d’envoi invalide.');
  if(!process.env.RESEND_API_KEY)fail('Le service courriel est indisponible.',503);
  const result=await transaction(async db=>{
   const dedupe='schedule:'+e.key+':'+(isTest?'test:':'employee:')+b.requestId;
   const existing=(await db.query("SELECT id,dedupe,status,payload->'to' AS recipients FROM training_mail WHERE id=$1",[b.requestId])).rows[0];
   if(existing){if(existing.dedupe!==dedupe)fail('Cette référence correspond à un autre envoi.',409);return {id:existing.id,status:existing.status,to:existing.recipients[0]};}
   const email=isTest?'igabenoit@gmail.com':await campusEmployeeEmail(db,sourcePool,e);
   if(!email)fail('Complétez le courriel du dossier employé avant l’envoi.');
   if(!isTest&&b.email!==email)fail('Le courriel du dossier a changé. Actualisez le destinataire avant l’envoi.',409);
   const access=await scheduleAccess(sourcePool,e);
   if(!access.code)fail('Vérifiez le code à six chiffres dans la liste du personnel avant l’envoi.');
   if(b.code!==access.code)fail('Le code a changé. Actualisez les accès avant l’envoi.',409);
   await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[b.requestId,dedupe,dep,JSON.stringify(scheduleEmailPayload(email,isTest,access))]);
   await db.query('INSERT INTO employee_file_events(action,actor,data) VALUES($1,$2,$3)',[isTest?'schedule.test.queued':'schedule.email.queued',JSON.stringify(req.ef.audit),JSON.stringify({employeeKey:e.key,mailId:b.requestId,email})]);
   return {id:b.requestId,status:'pending',to:email};
  });res.json(result);
 }));
}
