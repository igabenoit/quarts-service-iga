import {ethicsSource,directionSignature} from './ethics-source.js';
import PDFLib from './tuac/pdf-lib.min.cjs';

export const ethicsKeys=['Prénom','Nom','Poste','Signature','Respect','Vente','Réception'];

const ink=PDFLib.rgb(.035,.16,.43);
// Rectangles measured on the original at 84 dpi, from its top left.
const regions=[
 [40,'Respect - prénom',38,264,150,16,'first'],
 [40,'Respect - nom',197,264,150,16,'last'],
 [40,'Respect - signature',357,264,151,16,'ink'],
 [40,'Respect - date',516,264,150,16,'date'],
 [51,'Vente - déclaration',276,194,320,25,'full'],
 [51,'Vente - jour',154,662,31,19,'day'],
 [51,'Vente - mois',286,662,185,19,'month'],
 [51,'Vente - année (deux chiffres)',553,662,50,19,'year'],
 [51,'Vente - nom',106,704,244,28,'full'],
 [51,'Vente - signature',106,770,244,47,'ink'],
 [52,'Réception - nom',139,162,278,25,'full'],
 [52,'Réception - date',158,257,278,24,'date'],
 [52,'Réception - poste',150,306,283,22,'role'],
 [52,'Réception - signature employé',68,370,359,51,'ink'],
];
function validate(a,lines){
 for(const k of ['Prénom','Nom','Poste'])if(!a[k]?.trim()||a[k].length>100)throw Error(k);
 if(['Respect','Vente','Réception'].some(k=>a[k]!=='yes'))throw Error('Confirmez chaque attestation.');
 const date=a.Signature;
 if(!/^20\d\d-\d\d-\d\d$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Date invalide');
 if(!Array.isArray(lines)||lines.length>200||!lines.some(l=>Array.isArray(l)&&l.length>1))throw Error('Signature requise');
 for(const l of lines)if(!Array.isArray(l)||l.length>4000||l.some(p=>!Array.isArray(p)||p.length!==2||!p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw Error('Signature invalide');
}
async function makePDF(values,strokes){
 const pdf=await PDFLib.PDFDocument.load(await ethicsSource());
 const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),form=pdf.getForm();
 const receipt=pdf.getPage(51);
 const height=receipt.getHeight();
 for(const [x,top,width,text] of [
  [294,69,245,'ALIMENTATION SOGESCO INC.'],
  [179,83,350,'3000 boul. Laframboise, Saint-Hyacinthe, J2S 4Z4']
 ]){
  receipt.drawRectangle({x,y:height-top-13,width,height:13,color:PDFLib.rgb(1,1,1)});
  receipt.drawText(text,{x:x+1,y:height-top-10,size:11,font});
 }
 receipt.drawText('Marc-Andre Benoit',{x:126,y:height-412,size:11,font,color:ink});
 const signature=await directionSignature();
 if(signature){
  const points=signature.flat().map(([u,v])=>[u*4,v]);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=xs.reduce((a,b)=>Math.min(a,b)),maxX=xs.reduce((a,b)=>Math.max(a,b));
  const minY=ys.reduce((a,b)=>Math.min(a,b)),maxY=ys.reduce((a,b)=>Math.max(a,b));
  const scale=Math.min(182/Math.max(.01,maxX-minX),34/Math.max(.01,maxY-minY));
  for(const line of signature){
   let previous;
   for(const [u,v] of line){
    const next={x:68+(4*u-minX)*scale,y:height-480+(maxY-v)*scale};
    if(previous)receipt.drawLine({start:previous,end:next,thickness:1,color:ink});
    previous=next;
   }
  }
 }else{
 const signatureFont=await pdf.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic);
 receipt.drawText('Marc-Andre Benoit',{x:66,y:height-477,size:18,font:signatureFont,color:ink});
 }
 receipt.drawText('Direction  |  ALIMENTATION SOGESCO INC.',{x:67,y:height-491,size:8,font,color:ink});
 for(const [number,label,left,top,width,height,kind] of regions){
  const page=pdf.getPage(number-1),scale=72/84;
  const x=left*scale,y=page.getHeight()-(top+height)*scale,w=width*scale,h=height*scale;
  if(!values){
   const field=form.createTextField(label);
   field.addToPage(page,{x,y,width:w,height:h,borderWidth:0,borderColor:undefined,backgroundColor:undefined,textColor:ink,font});
   field.setFontSize(0);
  }else if(kind==='ink'){
   for(const line of strokes){
    let previous;
    for(const [u,v] of line){
     const next={x:x+u*Math.min(w,h*4),y:y+(1-v)*h};
     if(previous)page.drawLine({start:previous,end:next,thickness:.9,color:ink});
     previous=next;
    }
   }
  }else{
   const text=values[kind],size=Math.min(11,h*.76,(w-3)/font.widthOfTextAtSize(text,1));
   page.drawText(text,{x:x+1,y:y+2,size,font,color:ink});
  }
 }
 form.updateFieldAppearances(font);
 return Buffer.from(await pdf.save());
}
export function blankEthics(){return makePDF();}
export async function signedEthics(a,strokes){
 validate(a,strokes);
 const date=a.Signature;
 return makePDF({first:a.Prénom.toLocaleUpperCase('fr-CA'),last:a.Nom.toLocaleUpperCase('fr-CA'),full:a.Prénom+' '+a.Nom,role:a.Poste,date,day:date.slice(8),month:new Intl.DateTimeFormat('fr-CA',{month:'long',timeZone:'UTC'}).format(new Date(date+'T12:00Z')),year:date.slice(2,4)},strokes);
}
