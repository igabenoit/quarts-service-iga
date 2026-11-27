import {installDocumentUploads} from './document-uploads.js';
import {sstFileMime} from './sst.js';
import {sendPrivateBytes} from './private-response.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function installEmployeeAttachments(app,{pool,auth,origin,wrap,transaction,directory,person,saveOriginal,event}){
 const base='/api/employee-files/attachments';
 async function access(req){
  if(!req.ef.admin||req.ef.view!=='direction')fail('Fichiers réservés à la direction.',403);
  if(!pool)fail('Le coffre des dossiers est indisponible.',503);
  return person(req.ef,await directory(),req.query.key);
 }
 const linked="(SELECT ev.action FROM employee_file_events ev WHERE ev.action IN ('attachment.added','attachment.removed') AND ev.data->>'originalId'=o.id::text AND ev.data->>'employeeKey'=o.employee_key ORDER BY ev.id DESC LIMIT 1)='attachment.added'";
 app.get(base,auth,wrap(async(req,res)=>{
  const e=await access(req);
  const files=(await pool.query('SELECT o.id,o.name,o.mime,o.size,o.created_at FROM employee_file_originals o WHERE o.employee_key=$1 AND '+linked+' ORDER BY o.created_at DESC,o.id',[e.key])).rows;
  res.set('Cache-Control','private, no-store').json({files});
 }));
 if(pool)installDocumentUploads(app,{path:base,auth,origin,wrap,transaction,pool,
  owner:req=>JSON.stringify([req.ef.audit.kind,req.ef.audit.id,req.ef.view]),
  target:req=>'employee-attachment:'+req.query.key,options:()=>({}),authorize:(_db,req)=>access(req),
  save:async(db,req,e,bytes,name)=>{
   const original=await saveOriginal(db,req.ef,e,'rh',bytes,{name,mime:sstFileMime(bytes,name),provenance:'Fichier ajouté au dossier par la direction',documentDate:null,signatureKind:'supporting'});
   const prior=await db.query("SELECT action FROM employee_file_events WHERE action IN ('attachment.added','attachment.removed') AND data->>'originalId'=$1 AND data->>'employeeKey'=$2 ORDER BY id DESC LIMIT 1",[original.id,e.key]);
   if(prior.rows[0]?.action!=='attachment.added')await event(db,req.ef,'attachment.added',{employeeKey:e.key,originalId:original.id,name:original.name});
   return original.id;
  }
 });
 app.post(base+'/:id/remove',auth,origin,wrap(async(req,res)=>{
  const e=await access(req);
  if(req.body?.confirmed!==true)fail('Confirmez le retrait du fichier.');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.params.id))fail('Fichier introuvable.',404);
  await transaction(async db=>{
   const o=(await db.query('SELECT o.id,o.name FROM employee_file_originals o WHERE o.id=$1 AND o.employee_key=$2 AND '+linked,[req.params.id,e.key])).rows[0];
   if(!o)fail('Fichier introuvable ou déjà retiré.',404);
   await event(db,req.ef,'attachment.removed',{employeeKey:e.key,originalId:o.id,name:o.name});
  });res.json({removed:true});
 }));
 app.get(base+'/:id',auth,wrap(async(req,res)=>{
  const e=await access(req);
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.params.id))fail('Fichier introuvable.',404);
  const o=(await pool.query('SELECT o.* FROM employee_file_originals o WHERE o.id=$1 AND o.employee_key=$2 AND '+linked,[req.params.id,e.key])).rows[0];
  if(!o?.data)fail('Fichier introuvable.',404);
  await event(pool,req.ef,'attachment.read',{employeeKey:e.key,originalId:o.id});
  const inline=['application/pdf','image/jpeg','image/png','image/webp'].includes(o.mime)&&!req.query.download;
  res.set({'Content-Type':o.mime,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(o.name)}`,'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'});
  await sendPrivateBytes(res,o.data);
 }));
}
