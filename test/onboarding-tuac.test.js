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

test('TUAC fictif signé, deux impressions de la même copie sur une page lettre',async()=>{
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid',Indicatif:'',Téléphone:'+1 (450) 555-0123'});
  delete answers.Appartement;
  await assert.rejects(()=>signedTuac({...answers,Téléphone:'450555012345'},[[[0,0],[1,1]]]),/indicatif/);
  await assert.rejects(()=>signedTuac(answers,[]),/Signature/);
  const pdf=await PDFLib.PDFDocument.load(await signedTuac(answers,[[[0,1],[0.4,0.2],[1,0.8]]]));
  assert.equal(pdf.getPageCount(),1);
  const page=pdf.getPages()[0];
  assert.deepEqual(page.getSize(),{width:612,height:792});
  const stream=page.node.Contents().lookup(0);
  const operators=Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
  assert.equal(operators.match(/ Do\b/g)?.length,2);
});
