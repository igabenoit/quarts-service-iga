import assert from 'node:assert/strict';
import test from 'node:test';
import {signedTuac,tuacFields} from '../onboarding/tuac.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';

test('TUAC fictif signé, trois fiches sans fond sur une page lettre',async()=>{
  const answers=Object.fromEntries(tuacFields.map(k=>[k,'Exemple']));
  Object.assign(answers,{Naissance:'1990-01-01',Emploi:'2026-11-08',Signature:'2026-11-08',Courriel:'test@example.invalid'});
  await assert.rejects(()=>signedTuac(answers,[]),/Signature/);
  const pdf=await PDFLib.PDFDocument.load(await signedTuac(answers,[[[0,1],[0.4,0.2],[1,0.8]]]));
  assert.equal(pdf.getPageCount(),1);
  const page=pdf.getPages()[0];
  assert.deepEqual(page.getSize(),{width:612,height:792});
  const stream=page.node.Contents().lookup(0);
  const operators=Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
  assert.doesNotMatch(operators,/ Do\b/); // Aucun fond de page importé.
  assert.equal(operators.match(/ Tj\b/g)?.length,63);
  assert.equal(operators.match(/^S$/gm)?.length,3); // Tracé réel reproduit sur les trois fiches.
  const positions = [...operators.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map(m=>[Number(m[1]),Number(m[2])]);
  const mm = 72 / 25.4;
  for (const [i, row] of [118.7,382.2,646.2].entries()) {
    const contactY = 792 - row + 4 - 3 * mm;
    const [emailX,emailY] = positions[i*21+12];
    assert.ok(Math.abs(emailX-(234.5+2*mm+[0,.25,.35][i]))<.001);
    assert.ok(Math.abs(emailY-contactY)<.001);
    assert.ok(Math.abs(positions[i*21+10][1]-(contactY+7.4-2*mm))<.001);
  }
});
