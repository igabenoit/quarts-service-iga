import assert from 'node:assert/strict';
import test from 'node:test';
import {signedTuac,tuacFields} from '../onboarding/tuac.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';

test('TUAC fictif signé, deux impressions de la même copie sur une page lettre',async()=>{
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid'});
  await assert.rejects(()=>signedTuac(answers,[]),/Signature/);
  const pdf=await PDFLib.PDFDocument.load(await signedTuac(answers,[[[0,1],[0.4,0.2],[1,0.8]]]));
  assert.equal(pdf.getPageCount(),1);
  const page=pdf.getPages()[0];
  assert.deepEqual(page.getSize(),{width:612,height:792});
  const stream=page.node.Contents().lookup(0);
  const operators=Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
  assert.equal(operators.match(/ Do\b/g)?.length,2);
});
