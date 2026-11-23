import assert from 'node:assert/strict';
import test from 'node:test';
import {signedTuac,tuacFields} from '../onboarding/tuac.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';
import {normalizeTuacPhone} from '../public/tuac-phone.js';

test('TUAC : saisie automatique complète, +1, indicatif séparé et absence de troncature',()=>{
 for(const value of ['4505550123','(450) 555-0123','+1 450 555 0123','1-450-555-0123']){
  assert.deepEqual(normalizeTuacPhone({Indicatif:'',Téléphone:value}),{Indicatif:'450',Téléphone:'5550123'});
  assert.deepEqual(normalizeTuacPhone({Indicatif:value,Téléphone:''}),{Indicatif:'450',Téléphone:'5550123'});
 }
 assert.deepEqual(normalizeTuacPhone({Indicatif:'(450)',Téléphone:'555-0123'}),{Indicatif:'450',Téléphone:'5550123'});
 assert.deepEqual(normalizeTuacPhone({Indicatif:'5145550199',Téléphone:'4505550123'},'Indicatif'),{Indicatif:'514',Téléphone:'5550199'});
 for(const value of ['450555012345','+33 1 23 45 67 89','4505550123 poste 4','555'])assert.equal(normalizeTuacPhone({Indicatif:'450',Téléphone:value}).Téléphone,value,'ne jamais tronquer ni deviner un numéro incomplet');
});

test('TUAC signé : trois fiches calibrées sur la feuille originale, aucun fond ni ajustement',async()=>{
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid',Indicatif:'',Téléphone:'+1 (450) 555-0123'});
  delete answers.Appartement;answers._employerPrepared=true;
  await assert.rejects(()=>signedTuac({...answers,Téléphone:'450555012345'},[[[0,0],[1,1]]]),/indicatif/);
  await assert.rejects(()=>signedTuac(answers,[]),/Signature/);
  const pdf=await PDFLib.PDFDocument.load(await signedTuac(answers,[[[0,1],[0.4,0.2],[1,0.8]]]),{updateMetadata:false});
  assert.equal(pdf.getPageCount(),1);
  const page=pdf.getPages()[0];
  assert.deepEqual(page.getSize(),{width:612,height:792});
  const streams=page.node.Contents();
  const operators=Array.from({length:streams.size()},(_,i)=>Buffer.from(PDFLib.decodePDFRawStream(streams.lookup(i)).decode()).toString()).join('\n');
  assert.equal(operators.match(/ Do\b/g),null,'aucun fond de formulaire réimprimé');
  assert.equal(operators.match(/ Tj\b/g)?.length,63,'les 21 valeurs, dont les dates séparées, sur chacune des trois fiches');
  assert.equal(operators.match(/^S$/gm)?.length,3,'la même signature sur chacune des fiches');
  assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(),PDFLib.PrintScaling.None);
  assert.equal(pdf.catalog.getOrCreateViewerPreferences().getDuplex(),PDFLib.Duplex.Simplex);
  assert.equal(pdf.context.trailerInfo.Info,undefined);
});
