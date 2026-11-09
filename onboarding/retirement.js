import {readFile} from 'node:fs/promises';
import PDFLib from './tuac/pdf-lib.min.cjs';
import {retirementFields,visibleGroup} from '../public/retirement-fields.js';
export {retirementKeys} from '../public/retirement-fields.js';

const scale=72/95;
const color=PDFLib.rgb(0.035,0.16,0.43);
function dateParts(v){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T12:00Z').toISOString().slice(0,10)!==v)throw Error('Date invalide');
 return v.slice(8)+v.slice(5,7)+v.slice(0,4);
}
export async function signedRetirement(answers,strokes){
 const {mode,count,signed,consent}=answers;
 if(consent!=='yes'||!['estate','persons'].includes(mode))throw Error('Autorisation et désignation requises');
 dateParts(signed);
 if(mode==='persons'){
  if(!['1','2','3'].includes(count))throw Error('Nombre de bénéficiaires invalide');
  const shares=Array.from({length:Number(count)},(_,i)=>Number(answers['b'+i+'_part']));
  if(shares.some(v=>!Number.isInteger(v)||v<=0)||shares.reduce((a,b)=>a+b,0)!==100)throw Error('Les parts doivent totaliser 100 %');
 }
 if(!Array.isArray(strokes)||strokes.length>200||!strokes.some(line=>Array.isArray(line)&&line.length>1))throw Error('Signature requise');
 const pdf=await PDFLib.PDFDocument.load(await readFile(new URL('./retraite/form.pdf',import.meta.url)));
 const pages=pdf.getPages(),font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
 function text(page,value,x,y,size=10){page.drawText(value,{x:x*scale,y:page.getHeight()-y*scale,size,font,color});}
 function cross(page,[x,y]){text(page,'X',x-4,y+4,8);}
 if(mode==='estate')cross(pages[0],[40,713]);
 for(const f of retirementFields){
  if(!visibleGroup(f.group,answers))continue;
  let v=(answers[f.id]||'').trim();
  if(!v){if(f.req)throw Error(f.label);continue;}
  const page=pages[['b1','b2'].includes(f.group)?1:0];
  if(f.choices){if(!Object.hasOwn(f.choices,v))throw Error(f.label);cross(page,f.choices[v]);continue;}
  if(f.type==='date')v=dateParts(v);
  if(f.format==='tel'||f.format==='digits'){
   v=v.replace(/[\s().-]/g,'');if(!/^\d+$/.test(v)||v.length!==f.n)throw Error(f.label);
  }else if(f.pattern&&!new RegExp('^(?:'+f.pattern+')$').test(v))throw Error(f.label);
  if(f.format==='postal')v=v.replace(/ /g,'').toUpperCase();
  const step=f.step||16;
  if(v.length>f.n){
   if(!f.flex)throw Error(f.label);
   text(page,v,f.x+2,f.y+4,Math.min(9.5,(f.n*step-4)*scale/font.widthOfTextAtSize(v,1)));continue;
  }
  Array.from(v).forEach((ch,i)=>{
   const offset=f.format==='tel'&&i>=3?1:0;
   text(page,ch,f.x+(i+offset+.5)*step-font.widthOfTextAtSize(ch,9.5)/(2*scale),f.y+4,9.5);
  });
 }
 for(const line of strokes){
  if(!Array.isArray(line)||line.length>4000)throw Error('Signature invalide');
  let previous;
  for(const point of line){
   if(!Array.isArray(point)||point.length!==2||!point.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Signature invalide');
   const next={x:(46+point[0]*300)*scale,y:792-(786+point[1]*49)*scale};
   if(previous)pages[1].drawLine({start:previous,end:next,thickness:1,color});
   previous=next;
  }
 }
 text(pages[1],signed,510,833);
 return Buffer.from(await pdf.save());
}
