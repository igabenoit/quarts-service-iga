import {installDocumentUploads} from '../document-uploads.js';
import {sstFileMime} from '../sst.js';
import {chequeLink,chequeMimeTypes,chequeMaxBytes} from '../public/cheque-schema.js';
import PDFLib from './tuac/pdf-lib.min.cjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};

export function installChequeSubmission(app,{pool,origin,wrap,transaction,employeeCase,publishedPolicy,saveOriginal,event}){
 const path='/api/accueil-employe/specimen-cheque';
 const auth=(req,res,next)=>wrap(async()=>{res.set('Cache-Control','private, no-store');req.onboarding=await employeeCase(pool,req,false);next();})(req,res);
 function options(req){
  const b=req.body||{};
  if(!Number.isInteger(b.version)||b.version<0||typeof b.policy!=='string'||b.confirmed!==true)fail('Confirmez la politique de confidentialité avant de transmettre le spécimen.');
  return {version:b.version,policy:b.policy};
 }
 async function authorize(db,req,metadata){
  const row=await employeeCase(db,req),policy=await publishedPolicy(db);
  if(!policy||String(policy.id)!==metadata.policy)fail('Rechargez le dossier et confirmez la politique de confidentialité.',428);
  const doc=(await db.query("SELECT version,original_id FROM onboarding_docs WHERE employee_key=$1 AND kind='cheque' AND invited FOR UPDATE",[row.employee_key])).rows[0];
  if(!doc)fail('Le spécimen de chèque n’est pas demandé dans ce dossier.',404);
  return {row,doc};
 }
 async function save(db,req,{row,doc},bytes,name,metadata,link=false){
  if(doc.original_id||doc.version!==metadata.version||row.completed_at)fail('Ce dossier a changé. Rechargez-le avant de poursuivre.',409);
  if(!bytes.length||bytes.length>chequeMaxBytes)fail('Choisissez un fichier de 12 Mo ou moins.');
  let mime='text/uri-list';
  if(!link){
   try{mime=sstFileMime(bytes,name);}catch{fail('Formats acceptés : PDF et photos JPG, PNG ou WebP.');}
   if(!chequeMimeTypes.includes(mime))fail('Formats acceptés : PDF et photos JPG, PNG ou WebP.');
   if(mime==='application/pdf')try{const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});if(!pdf.getPageCount())throw Error();}catch{fail('Ce PDF est illisible ou protégé par un mot de passe. Choisissez un PDF qui peut être ouvert.');}
  }
  const receipt={type:link?'link':'file',name,mime,receivedAt:new Date().toISOString()};
  const actor={audit:{kind:'invitation',generation:row.generation,policy:metadata.policy}};
  const original=await saveOriginal(db,actor,{key:row.employee_key},'payroll',bytes,{name,mime,provenance:link?'Lien du spécimen transmis par l’employé':'Spécimen transmis par l’employé',documentDate:null,signatureKind:'supporting'});
  await db.query("UPDATE onboarding_docs SET draft=$3,original_id=$2,version=version+1 WHERE employee_key=$1 AND kind='cheque'",[row.employee_key,original.id,JSON.stringify({_attachment:receipt})]);
  await db.query('UPDATE onboarding_cases SET activity=now(),completed_at=CASE WHEN invited_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM onboarding_docs WHERE employee_key=$1 AND invited AND original_id IS NULL) THEN now() ELSE completed_at END WHERE employee_key=$1',[row.employee_key]);
  if(event)await event(db,actor,'onboarding.submitted',{employeeKey:row.employee_key,kind:'cheque',originalId:original.id,submissionType:receipt.type});
  return original.id;
 }
 installDocumentUploads(app,{path,auth,origin,wrap,transaction,pool,
  owner:req=>'onboarding:'+req.onboarding.token_hash,
  target:req=>'cheque:'+req.onboarding.employee_key+':'+req.onboarding.generation,
  options,authorize,save});
 app.post(path+'/link',auth,origin,wrap(async(req,res)=>{
  const metadata=options(req);let url;try{url=chequeLink(req.body.url);}catch(error){fail(error.message);}
  const id=await transaction(async db=>save(db,req,await authorize(db,req,metadata),Buffer.from(url+'\n'),'Spécimen de chèque - lien.txt',metadata,true));
  res.status(201).json({id});
 }));
}
