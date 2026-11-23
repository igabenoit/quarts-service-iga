import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pdfBytes,pdfPrintUrl} from '../public/pdf-print-link.js';
import {tuacPrintCopy} from '../onboarding/tuac-print.js';
import {ethicsSignatureExcerpt} from '../onboarding/ethics-print.js';
import PDFLib from '../onboarding/tuac/pdf-lib.min.cjs';

test('impression : URL PDF locale sans navigation vers le point d’accès privé, octets et réglages inchangés',async()=>{
 const calibrated=await tuacPrintCopy(await readFile(new URL('./fixtures/tuac-two-copy-fictitious.pdf',import.meta.url)));
 const book=await PDFLib.PDFDocument.create();for(let n=0;n<52;n++)book.addPage([612,792]);
 const signatures=await ethicsSignatureExcerpt(await book.save());
 for(const original of [calibrated,signatures]){
  const response=new Response(original,{headers:{'Content-Type':'application/pdf','Content-Security-Policy':"sandbox; default-src 'none'"}});
  const bytes=await pdfBytes(response),url=pdfPrintUrl(bytes);
  assert.match(url,/^blob:/);
  // Model PDF.js transferring its input buffer to the worker.
  structuredClone(bytes,{transfer:[bytes.buffer]});assert.equal(bytes.byteLength,0);
  const local=await fetch(url);assert.equal(local.headers.get('content-type'),'application/pdf');
  assert.deepEqual(Buffer.from(await local.arrayBuffer()),Buffer.from(original));
  URL.revokeObjectURL(url);
 }
});

test('impression : réponse refusée, HTML et contenu non PDF ne créent pas de document local',async()=>{
 for(const response of [new Response('%PDF-',{status:403,headers:{'Content-Type':'application/pdf'}}),new Response('<html>Connexion</html>',{headers:{'Content-Type':'text/html'}}),new Response('<html>Erreur</html>',{headers:{'Content-Type':'application/pdf'}})])await assert.rejects(()=>pdfBytes(response));
});
