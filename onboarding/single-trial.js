import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {installOnboarding} from './routes.js';

export async function installSingleTrial(app,pool,{managerAccess,wrap,date}){
 const router=express.Router();
 const key='trial:unique';
 const policy=await readFile(new URL('./politique-essai.txt',import.meta.url),'utf8');
 const trial={key,policy,policyId:createHash('sha256').update(policy).digest('hex'),employeeEmail:process.env.EMPLOYEE_TRIAL_EMAIL,managerEmail:process.env.EMPLOYEE_TRIAL_MANAGER_EMAIL};
 const employee={key,name:'Jo Blo · Essai fictif',active:true};
 const auth=async(req,res,next)=>{try{
  const manager=await managerAccess.identity(req);
  if(manager?.kind!=='admin')return res.status(403).json({error:'Direction requise.'});
  req.ef={view:'direction'};res.set('Cache-Control','no-store');next();
 }catch{res.sendStatus(503);}};
 const origin=(req,res,next)=>req.get('origin')===req.protocol+'://'+req.get('host')&&req.get('x-employee-files')==='1'?next():res.sendStatus(403);
 const transaction=async fn=>{
  const db=await pool.connect();
  try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}
  catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 };
 await pool.query("CREATE TABLE IF NOT EXISTS employee_file_originals(id uuid PRIMARY KEY, employee_key text UNIQUE NOT NULL CHECK(employee_key='trial:unique'), data bytea NOT NULL)");
 await installOnboarding(router,{
  pool,auth,wrap,origin,date,trial,transaction,directory:async()=>({employees:[employee]}),
  person:(_a,_d,k)=>{if(k!==key)throw Object.assign(Error('Fiche hors essai.'),{status:404});return employee;},
  content:()=>true,publishedPolicy:async()=>({id:trial.policyId,text:policy}),
  saveOriginal:async(db,_a,e,_category,data)=>{
   const id=randomUUID();await db.query('INSERT INTO employee_file_originals(id,employee_key,data) VALUES($1,$2,$3)',[id,e.key,data]);return {id};
  }
 });
 router.get('/api/employee-files/originals/:id',auth,wrap(async(req,res)=>{
  const result=await pool.query('SELECT data FROM employee_file_originals WHERE id::text=$1 AND employee_key=$2',[req.params.id,key]);
  if(!result.rows.length)return res.sendStatus(404);
  res.set({'Content-Type':'application/pdf','Content-Disposition':'inline; filename="TUAC-essai.pdf"','X-Content-Type-Options':'nosniff'}).send(Buffer.from(result.rows[0].data));
 }));
 app.use(router);
}
