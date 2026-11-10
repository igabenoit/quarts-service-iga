import PDFLib from './tuac/pdf-lib.min.cjs';
import {sections} from '../public/accueil-sst.js';
import {annexSource} from './ethics-source.js';

const blue=PDFLib.rgb(.03,.16,.40);
const fields=[
  ['Nom',155,115,128,10], ['Poste',363,115,116,10],
  ...[209,248,301,366,429,467,509].map((center,i)=>['initiales'+i,420,center-6,62,12]),
  ...[1,2].flatMap((week,i)=>[['date'+week,183,578+14*i,92,12],['heures'+week,284,578+14*i,125,12]]),
  ['Signature',333,622,160,18]
];
const boxes=[290,303,316,344,356,368,380,393,419,431,442,456];
export const annexKeys=[...fields.map(f=>f[0]),...boxes.map((_,i)=>'case'+i),'confirmation'];
const validDate=value=>/^\d{4}-\d\d-\d\d$/.test(value)&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
export async function annexPdf(source,answers,strokes){
  const pdf=await PDFLib.PDFDocument.load(source);
  const page=pdf.getPage(0), form=pdf.getForm(), font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  for(const [key,x,top,width,height] of fields){
    const name=key.startsWith('initiales')?'Initiales - '+sections[Number(key.slice(9))][0]:key;
    const field=form.createTextField(name);
    field.addToPage(page,{x,y:792-top-height,width,height,borderWidth:0,borderColor:undefined,backgroundColor:undefined,textColor:blue,font});
    field.setFontSize(0);
    if(answers?.[key])field.setText(answers[key].trim());
  }
  const labels=sections.flatMap(s=>s[1]);
  boxes.forEach((top,i)=>{
    const box=form.createCheckBox(labels[i]);
    box.addToPage(page,{x:100.4,y:792-top-7.4,width:6.5,height:6.5,borderWidth:0,borderColor:undefined,backgroundColor:undefined,textColor:blue});
    if(answers?.['case'+i]==='yes')box.check();
  });
  form.updateFieldAppearances(font);
  if(answers){
    form.flatten();
    page.node.delete(PDFLib.PDFName.of('Annots'));
    if(!Array.isArray(strokes)||strokes.length>200||!strokes.some(line=>Array.isArray(line)&&line.length>1))throw Error('Signature requise');
    for(const line of strokes){
      if(!Array.isArray(line)||line.length>4000)throw Error('Signature invalide');
      let previous;
      for(const point of line){
        if(!Array.isArray(point)||point.length!==2||!point.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Signature invalide');
        const next={x:68+point[0]*94,y:151+(1-point[1])*23.5};
        if(previous)page.drawLine({start:previous,end:next,color:blue,thickness:.85});
        previous=next;
      }
    }
  }
  return Buffer.from(await pdf.save());
}
export async function signedAnnex(answers,strokes){
  if(!answers.Nom?.trim()||!answers.Poste?.trim()||!validDate(answers.Signature)||answers.confirmation!=='yes')throw Error('Attestation incomplète');
  for(const week of [1,2]){
    if(answers['date'+week]&&!validDate(answers['date'+week]))throw Error('Date invalide');
    const hours=answers['heures'+week];
    if(hours&&(!Number.isFinite(Number(hours))||Number(hours)<0||Number(hours)>168))throw Error('Heures invalides');
  }
  return annexPdf(await annexSource(),answers,strokes);
}

