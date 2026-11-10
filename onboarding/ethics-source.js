
import {createHash,timingSafeEqual} from 'node:crypto';

const expected='2ae98cd7cd73c4da36a4de104f5365de098b481e55968e039abb95d2c7e9ab3a';
const digest=bytes=>createHash('sha256').update(bytes).digest();
let db;
const annexHash="9be2e26f3a496fdc4fae57a3da5552a6ecb4d0d5ab638c5ff6f155359af24506";
export const annexSource=()=>source(annexHash);
export const ethicsSource=()=>source(expected);
async function source(hash){
 const row=(await db.query('SELECT document FROM onboarding_ethics_source WHERE sha256=$1',[hash])).rows[0];
 if(!row)throw Error('Document indisponible.');
 return Buffer.from(row.document);
}
export async function installEthicsSource(app,pool){
 const {default:express}=await import('express');
 db=pool;
 await db.query('CREATE TABLE IF NOT EXISTS onboarding_ethics_source(sha256 text PRIMARY KEY,document bytea NOT NULL)');
 // Limited to the initial deployment and to the exact approved PDF.
 app.post('/api/onboarding-setup/annex-source',(req,res,next)=>{
  const supplied=digest(req.get('authorization')||'');
  if(Date.now()>Date.parse('2026-11-12T00:00:00Z')||!timingSafeEqual(supplied,Buffer.from('13b2c3ea5807c8f70fe738f48fb62c722c1e67a1b7cf2f4f1281151d9aab7be2','hex')))return res.sendStatus(403);
  next();
 },express.raw({type:'application/pdf',limit:'4mb'}),async(req,res,next)=>{
  try{
   if(!Buffer.isBuffer(req.body)||digest(req.body).toString('hex')!==annexHash)return res.sendStatus(422);
   await db.query('INSERT INTO onboarding_ethics_source(sha256,document) VALUES($1,$2) ON CONFLICT DO NOTHING',[annexHash,req.body]);
   res.sendStatus(204);
  }catch(error){next(error);}
 });
}

