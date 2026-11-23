import {readFile} from 'node:fs/promises';
import PDFLib from './tuac/pdf-lib.min.cjs';
import {signedGeneralSst,generalSstTextKeys} from './sst-general.js';
import {letterDuplexCopy} from './letter-print.js';
const name=PDFLib.PDFName.of;
const decode=stream=>Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString();
const commands=(pdf,page)=>{const content=page.node.Contents();return content instanceof PDFLib.PDFArray?content.asArray().map(ref=>decode(pdf.context.lookup(ref))).join('\n'):decode(content);};
const invalid=()=>{throw Error('Ce PDF SST ne correspond pas au modèle reconnu. L’original signé reste disponible.');};

// Only the exact historical three-page generator is recognized. Read its
// existing field appearances and signature paths; never change the archive.
export async function generalSstPrintCopy(bytes){
 const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
 if(pdf.getPageCount()===2)return letterDuplexCopy(bytes);
 if(pdf.getPageCount()!==3||pdf.getPages().some(p=>p.getWidth()!==612||p.getHeight()!==792))invalid();
 const template=await PDFLib.PDFDocument.load(await readFile(new URL('./sst-general/form.pdf',import.meta.url)),{updateMetadata:false});
 const expected=template.getForm().getFields(),answers={confirmation:'yes'};
 let signatureTail='';
 for(const [index,page] of pdf.getPages().entries()){
  const content=commands(pdf,page),sourcePage=template.getPage(index);
  if(!content.includes(commands(template,sourcePage).trim()))invalid();
  const paint=[...content.matchAll(/q\s+1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+1 0 0 1 0 0 cm\s+1 0 0 1 0 0 cm\s+\/(FlatWidget-\d+) Do\s+Q/g)];
  const fields=expected.filter(f=>f.acroField.getWidgets()[0].P()?.toString()===sourcePage.ref.toString());
  const objects=page.node.Resources().lookupMaybe(name('XObject'),PDFLib.PDFDict);
  if(paint.length!==fields.length||objects?.entries().length!==fields.length)invalid();
  for(let i=0;i<fields.length;i++){
   const f=fields[i],widget=f.acroField.getWidgets()[0],rect=widget.getRectangle(),[,x,y,key]=paint[i];
   if(Math.abs(Number(x)-rect.x)>1e-6||Math.abs(Number(y)-rect.y)>1e-6)invalid();
   const appearance=decode(objects.lookup(name(key)));
   if(generalSstTextKeys.includes(f.getName())){
    const text=[...appearance.matchAll(/<([A-Fa-f0-9]*)> Tj/g)];
    if(!text.length||!/\/Helvetica [\d.]+ Tf/.test(appearance))invalid();
    answers[f.getName()]=text.map(m=>new TextDecoder('windows-1252').decode(Buffer.from(m[1],'hex'))).join('\n');
    if(answers[f.getName()].length>200)invalid();
   }else{
    const normal=widget.getAppearances().normal;
    if(appearance===decode(normal.lookup(widget.getOnValue())))answers[f.getName()]='yes';
    else if(appearance===decode(normal.lookup(name('Off'))))answers[f.getName()]='';
    else invalid();
   }
  }
  const last=paint.at(-1),tail=content.slice(last.index+last[0].length);
  if(index===2)signatureTail=tail;
  else if(tail.replace(/[Q\s]/g,''))invalid();
 }
 const number='(-?\\d+(?:\\.\\d+)?)';
 const pattern=new RegExp('q\\s+0\\.03 0\\.16 0\\.4 RG\\s+0\\.85 w\\s+\\[\\] 0 d\\s+'+number+' '+number+' m\\s+'+number+' '+number+' m\\s+'+number+' '+number+' l\\s+S\\s+Q','g');
 const segments=[...signatureTail.matchAll(pattern)];
 if(!segments.length||signatureTail.replace(pattern,'').replace(/[Q\s]/g,''))invalid();
 const employee=[],supervisor=[];
 for(const m of segments){
  if(m[1]!==m[3]||m[2]!==m[4])invalid();
  const points=[[Number(m[1]),Number(m[2])],[Number(m[5]),Number(m[6])]];
  const employeeZone=points.every(([x,y])=>x>=98-1e-6&&x<=288+1e-6&&y>=172-1e-6&&y<=192+1e-6);
  const supervisorZone=points.every(([x,y])=>x>=391-1e-6&&x<=560+1e-6&&y>=172-1e-6&&y<=192+1e-6);
  if(!employeeZone&&!supervisorZone)invalid();
  const lines=employeeZone?employee:supervisor,left=employeeZone?98:391;
  // The signature renderer's input canvas has a 4:1 ratio. Preserve the
  // physical shape, independently of where the original stroke was drawn.
  const [a,b]=points.map(([x,y])=>[Math.max(0,(x-left)/800),Math.max(0,(192-y)/200)]);
  const last=lines.at(-1),end=last?.at(-1);
  if(end&&Math.hypot(end[0]-a[0],end[1]-a[1])<1e-9&&last.length<4000)last.push(b);else lines.push([a,b]);
 }
 return signedGeneralSst(answers,employee,{onsite:true,supervisorStrokes:supervisor});
}
