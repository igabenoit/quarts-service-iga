import PDFLib from './tuac/pdf-lib.min.cjs';
import {personalFields,personalLabels,personalEmployerFields,validatePersonalInformation} from '../public/personal-information-schema.js';
export {personalFields};
const clean=value=>String(value??'').replace(/[^\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u20ac\u2013\u2014\u2018\u2019\u201c\u201d]/g,' ').replace(/\s+/g,' ').trim();
export async function signedPersonalInformation(answers,strokes,options={}){
 validatePersonalInformation(answers,options);
 if(options.employeeOnly)answers={...answers,...Object.fromEntries(personalEmployerFields.map(k=>[k,'']))};
 if(!Array.isArray(strokes)||strokes.length>200||!strokes.some(line=>Array.isArray(line)&&line.length>1))throw Error('Signature de l’employé requise.');
 for(const line of strokes){if(!Array.isArray(line)||line.length>4000)throw Error('Signature invalide.');for(const point of line)if(!Array.isArray(point)||point.length!==2||!point.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Signature invalide.');}
 const pdf=await PDFLib.PDFDocument.create(),page=pdf.addPage([612,792]);
 const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),bold=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
 const navy=PDFLib.rgb(.13,.20,.30),red=PDFLib.rgb(.73,.12,.18),gray=PDFLib.rgb(.38,.43,.49),lineColor=PDFLib.rgb(.79,.82,.86),pale=PDFLib.rgb(.95,.96,.98);
 const text=(value,x,y,size=10,strong=false,color=navy)=>page.drawText(clean(value),{x,y:792-y,size,font:strong?bold:font,color});
 const box=(x,y,width,height,color=PDFLib.rgb(1,1,1))=>page.drawRectangle({x,y:792-y-height,width,height,color,borderColor:lineColor,borderWidth:.65});
 const section=(title,y)=>{box(38,y,536,23,pale);text(title,47,y+16,10,true);};
 function field(key,x,y,width){
  text(personalLabels[key],x,y-5,8.2,true,gray);box(x,y,width,31);
  const value=clean(answers[key]);let size=10;
  while(size>6.5&&font.widthOfTextAtSize(value,size)>width-14)size-=.25;
  if(font.widthOfTextAtSize(value,size)>width-14)throw Error('Le champ « '+personalLabels[key]+' » est trop long pour le document.');
  text(value,x+7,y+20,size);
 }
 text('IGA EXTRA · FAMILLE BENOIT',38,43,11,true,red);
 text('Formulaire d’informations personnelles',38,74,22,true);
 text('DOCUMENT CONFIDENTIEL · DOSSIER D’EMBAUCHE',38,94,8,true,gray);
 section('À COMPLÉTER PAR L’EMPLOYÉ',109);
 field('lastName',38,153,260);field('firstName',314,153,260);
 field('birthDate',38,202,260);field('sin',314,202,260);
 field('street',38,251,416);field('apartment',470,251,104);
 field('city',38,300,244);field('province',298,300,156);field('postalCode',470,300,104);
 field('homePhone',38,349,260);field('mobilePhone',314,349,260);
 field('email',38,398,536);
 section('À COMPLÉTER PAR L’EMPLOYEUR',449);
 field('employerDepartment',38,493,260);field('employerPosition',314,493,260);
 field('employerStartDate',38,542,170);field('employerSalary',224,542,170);field('employerScale',410,542,164);
 text('Signature de l’employé',38,615,10,true);box(38,625,340,64);
 field('signatureDate',410,642,164);
 for(const stroke of strokes){let previous;for(const point of stroke){const next={x:47+point[0]*322,y:792-634-point[1]*46};if(previous)page.drawLine({start:previous,end:next,thickness:.9,color:navy});previous=next;}}
 text('Formulaire d’embauche · Original signé conservé au dossier de l’employé',38,733,8,false,gray);
 text('1 / 1',550,754,8,false,gray);
 return Buffer.from(await pdf.save());
}
