import express from 'express';
import {createHash,timingSafeEqual} from 'node:crypto';

const expected='2ae98cd7cd73c4da36a4de104f5365de098b481e55968e039abb95d2c7e9ab3a';
const digest=bytes=>createHash('sha256').update(bytes).digest();
let db;
export async function ethicsSource(){
 const row=(await db.query('SELECT document FROM onboarding_ethics_source WHERE sha256=$1',[expected])).rows[0];
 if(!row)throw Error('Code d’éthique indisponible.');
 return Buffer.from(row.document);
}
export async function installEthicsSource(app,pool){
 db=pool;
 await db.query('CREATE TABLE IF NOT EXISTS onboarding_ethics_source(sha256 text PRIMARY KEY,document bytea NOT NULL)');
 // Limited to the initial deployment and to the exact approved PDF.
 app.post('/api/onboarding-setup/ethics-source',(req,res,next)=>{
  const supplied=digest(req.get('authorization')||'');
  if(Date.now()>Date.parse('2026-11-10T19:47:57.368098+00:00')||!timingSafeEqual(supplied,Buffer.from('5162fc4f234a2410ee745b94b61df804e9bb46a52cf82153a36efd22edc8c5c6','hex')))return res.sendStatus(403);
  next();
 },express.raw({type:'application/pdf',limit:'4mb'}),async(req,res,next)=>{
  try{
   if(!Buffer.isBuffer(req.body)||digest(req.body).toString('hex')!==expected)return res.sendStatus(422);
   await db.query('INSERT INTO onboarding_ethics_source(sha256,document) VALUES($1,$2) ON CONFLICT DO NOTHING',[expected,req.body]);
   res.sendStatus(204);
  }catch(error){next(error);}
 });
}
