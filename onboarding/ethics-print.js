import PDFLib from './tuac/pdf-lib.min.cjs';
import {ethicsPageCount,ethicsSignaturePages} from '../public/ethics-pages.js';

// Extrait de consultation uniquement : le cahier signé conservé reste intact.
export async function ethicsSignatureExcerpt(bytes){
 const source=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
 if(source.getPageCount()!==ethicsPageCount)throw Object.assign(Error('Cette version du cahier ne permet pas l’extraction automatique des signatures. Ouvrez le PDF original.'),{status:409});
 const pdf=await PDFLib.PDFDocument.create();
 for(const page of await pdf.copyPages(source,ethicsSignaturePages.map(p=>p.number-1)))pdf.addPage(page);
 delete pdf.context.trailerInfo.Info;
 return Buffer.from(await pdf.save());
}
