
import {createHash,timingSafeEqual} from 'node:crypto';

const expected='f43bbef52d7c1eab87bb90e70cc101674cb93aa1e4d5623526c951fd08bc640c';
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
 app.post('/api/onboarding-setup/direction-template',(req,res,next)=>{
  const supplied=digest(req.get('authorization')||'');
  if(Date.now()>Date.parse('2026-11-12T00:00:00Z')||!timingSafeEqual(supplied,Buffer.from('c8ee0b097756541f6571c1796ec1a977ae910cab37b4203619c50543a2a66c62','hex')))return res.sendStatus(403);
  next();
 },express.raw({type:'application/pdf',limit:'4mb'}),async(req,res,next)=>{
  try{
   if(!Buffer.isBuffer(req.body)||digest(req.body).toString('hex')!==expected)return res.sendStatus(422);
   await db.query('INSERT INTO onboarding_ethics_source(sha256,document) VALUES($1,$2) ON CONFLICT DO NOTHING',[expected,req.body]);
   res.sendStatus(204);
  }catch(error){next(error);}
 });
}

