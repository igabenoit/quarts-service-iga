import {scheduleEmailHtml} from './schedule-email-template.js';
import {campusEmployeeEmail} from './campus-training.js';
import {tuacSender} from './tuac-reminders.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function scheduleEmailPayload(email,isTest=false){
 return {from:tuacSender(),to:[email],subject:(isTest?'[TEST] ':'')+'Ton horaire en ligne — IGA Famille Benoit',html:scheduleEmailHtml,text:'Bonjour!\n\nBienvenue dans l’équipe! Consulte ton horaire sur ton téléphone :\nhttps://quartservice.igabenoit.com/horaire\n\nPREMIÈRE CONNEXION\nDemande à la direction de vérifier ton identité et de te remettre ton lien d’activation personnel. Suis les étapes sur ton appareil pour créer ta clé d’accès, puis reviens consulter ton horaire.\n\nTON ACCÈS EST DÉJÀ ACTIVÉ?\n1. Ouvre le lien ci-dessus.\n2. Si une connexion est demandée, choisis « Me connecter avec ma clé d’accès », puis utilise le déverrouillage habituel de ton appareil.\n3. Consulte tes quarts dans « Mon horaire ». Vérifie bien les dates et les heures affichées.\n\nGarde ce courriel ou ajoute la page à tes favoris. Si tu n’arrives pas à te connecter ou si ton horaire ne s’affiche pas, demande de l’aide à ton gérant ou à la direction.\n\nÀ bientôt!\nL’équipe IGA Famille Benoit'};
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
  const {e}=await employee(req);
  const history=(await pool.query("SELECT id,status,created_at,sent_at,provider_id,payload->'to' AS recipients,payload->>'subject' AS subject FROM training_mail WHERE dedupe LIKE $1 ORDER BY created_at DESC LIMIT 10",['schedule:'+e.key+':%'])).rows;
  res.set('Cache-Control','no-store').json({email:await campusEmployeeEmail(pool,sourcePool,e),employeeName:e.name,emailReady:!!process.env.RESEND_API_KEY,html:scheduleEmailHtml,history});
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
   await db.query('INSERT INTO training_mail(id,dedupe,department_id,payload) VALUES($1,$2,$3,$4)',[b.requestId,dedupe,dep,JSON.stringify(scheduleEmailPayload(email,isTest))]);
   await db.query('INSERT INTO employee_file_events(action,actor,data) VALUES($1,$2,$3)',[isTest?'schedule.test.queued':'schedule.email.queued',JSON.stringify(req.ef.audit),JSON.stringify({employeeKey:e.key,mailId:b.requestId,email})]);
   return {id:b.requestId,status:'pending',to:email};
  });res.json(result);
 }));
}
