import {readFile} from 'node:fs/promises';
import PDFLib from './tuac/pdf-lib.min.cjs';
import {signedTuac,employer} from './tuac.js';
const name=PDFLib.PDFName.of;
const decode=stream=>Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
const invalid=()=>{throw Error('Ce PDF TUAC ne correspond pas à un modèle d’impression reconnu. L’original signé reste disponible.');};

// Read-only print derivative for the former two-copy generator. Never replace
// an archived signed PDF. Recognize the exact template, fields and signature
// operators before reproducing its existing content on the calibrated sheet.
export async function tuacPrintCopy(bytes){
 const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
 if(pdf.getPageCount()!==1)invalid();
 const page=pdf.getPage(0),size=page.getSize();
 if(size.width!==612||size.height!==792)invalid();
 const objects=page.node.Resources().lookupMaybe(name('XObject'),PDFLib.PDFDict);
 if(!objects?.entries().length&&pdf.catalog.getOrCreateViewerPreferences().getDuplex()===PDFLib.Duplex.Simplex)return Buffer.from(bytes);
 const entries=objects?.entries();if(entries?.length!==2||new Set(entries.map(([,ref])=>ref.toString())).size!==1)invalid();
 const form=pdf.context.lookup(entries[0][1]);
 if(form.dict.get(name('Subtype'))?.toString()!=='/Form'||form.dict.get(name('BBox'))?.toString()!=='[ 0 0 792 472 ]')invalid();
 const fields=form.dict.lookup(name('Resources')).lookup(name('XObject'));
 const content=decode(form),paint=[...content.matchAll(/q\s+1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+1 0 0 1 0 0 cm\s+1 0 0 1 0 0 cm\s+\/(FlatWidget-\d+) Do\s+Q/g)];
 const template=await PDFLib.PDFDocument.load(await readFile(new URL('./tuac/form.pdf',import.meta.url)),{updateMetadata:false});
 const expected=template.getForm().getFields();
 if(paint.length!==expected.length||fields.entries().length!==expected.length+1)invalid();
 const answers={};
 for(let i=0;i<expected.length;i++){
  const f=expected[i],rect=f.acroField.getWidgets()[0].getRectangle(),[,x,y,key]=paint[i];
  if(Math.abs(Number(x)-rect.x)>1e-6||Math.abs(Number(y)-rect.y)>1e-6)invalid();
  const appearance=decode(fields.lookup(name(key))),text=[...appearance.matchAll(/<([A-Fa-f0-9]*)> Tj/g)];
  if(['Local antérieur','Affilié depuis'].includes(f.getName())&&!/\b(Tj|TJ|'|")\b/.test(appearance)){answers[f.getName()]='';continue;}
  if(text.length!==1||text[0][1].length>400||!/\/Helvetica [\d.]+ Tf/.test(appearance))invalid();
  answers[f.getName()]=new TextDecoder('windows-1252').decode(Buffer.from(text[0][1],'hex'));
 }
 if(answers['Local antérieur']||answers['Affilié depuis'])invalid();
 for(const [key,value] of Object.entries(employer))if(answers[key]!==value)invalid();
 for(const key of ['Naissance','Emploi','Signature'])answers[key]=[answers[key+' année'],answers[key+' mois'],answers[key+' jour']].join('-');
 const last=paint.at(-1),tail=content.slice(last.index+last[0].length);
 const number='(-?\\d+(?:\\.\\d+)?)';
 const pattern=new RegExp('q\\s+0 0 0 RG\\s+0\\.7 w\\s+\\[\\] 0 d\\s+'+number+' '+number+' m\\s+'+number+' '+number+' m\\s+'+number+' '+number+' l\\s+S\\s+Q','g');
 const segments=[...tail.matchAll(pattern)];if(!segments.length||tail.replace(pattern,'').replace(/[Q\s]/g,''))invalid();
 const strokes=segments.map(m=>{
  if(m[1]!==m[3]||m[2]!==m[4])invalid();
  return [[m[1],m[2]],[m[5],m[6]]].map(([x,y])=>{
   const p=[(Number(x)-164)/146,1-(Number(y)-136)/34];
   if(p.some(n=>!Number.isFinite(n)||n<-.000001||n>1.000001))invalid();
   return p.map(n=>Math.max(0,Math.min(1,n)));
  });
 });
 // The earlier generator stores every segment independently; combine connected
 // segments to preserve long signatures without imposing a new stroke limit.
 const lines=[];
 for(const [a,b] of strokes){const last=lines.at(-1),end=last?.at(-1);if(end&&Math.hypot(end[0]-a[0],end[1]-a[1])<1e-9&&last.length<4000)last.push(b);else lines.push([a,b]);}
 return signedTuac({...answers,_employerPrepared:true},lines);
}
