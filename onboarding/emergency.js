import PDFLib from './tuac/pdf-lib.min.cjs';

export const emergencyFields=[
 'employeeName','departmentRole',
 'contact1Name','contact1Relationship','contact1Phone','contact1OtherPhone',
 'contact2Name','contact2Relationship','contact2Phone','contact2OtherPhone',
 'foodAllergy','foodDetails','medicineAllergy','medicineDetails',
 'urgentCondition','conditionDetails','symptoms','carePlan','accessConsent'
];

const responses=new Set(['yes','no','undisclosed']);
const navy=PDFLib.rgb(.098,.20,.314),blue=PDFLib.rgb(.137,.482,.682),muted=PDFLib.rgb(.39,.48,.55),light=PDFLib.rgb(.933,.965,.984),border=PDFLib.rgb(.72,.80,.86),white=PDFLib.rgb(1,1,1);
const letter=[612,792];
const clean=v=>String(v??'').replace(/[^\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u20ac\u2013\u2014\u2018\u2019\u201c\u201d]/g,' ').replace(/\s+/g,' ').trim();
function validSignature(strokes){
 if(!Array.isArray(strokes)||strokes.length>200||!strokes.some(line=>Array.isArray(line)&&line.length>1))throw Error('Signature requise');
 for(const line of strokes){if(!Array.isArray(line)||line.length>4000)throw Error('Signature invalide');for(const p of line){if(!Array.isArray(p)||p.length!==2||!p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Signature invalide');}}
}
function wrap(font,str,size,width,limit=2){
 const words=clean(str).split(' '),rows=[];let current='';
 for(const word of words){let next=current?current+' '+word:word;
  if(font.widthOfTextAtSize(next,size)<=width){current=next;continue;}
  if(current)rows.push(current);current='';
  if(font.widthOfTextAtSize(word,size)>width){let chunk='';for(const ch of word){if(font.widthOfTextAtSize(chunk+ch,size)>width){rows.push(chunk);chunk='';}chunk+=ch;}current=chunk;}
  else current=word;
 }
 if(current)rows.push(current);
 if(rows.length>limit){const visible=rows.slice(0,limit);let last=visible.pop();while(last && font.widthOfTextAtSize(last+'...',size)>width)last=last.slice(0,-1);visible.push(last+'...');return visible;}
 return rows;
}
export async function signedEmergency(a,strokes){
 for(const key of ['employeeName','contact1Name','contact1Relationship','contact1Phone','contact2Name','contact2Relationship','contact2Phone'])if(!String(a[key]||'').trim())throw Error('Champ obligatoire : '+key);
 for(const key of ['foodAllergy','medicineAllergy','urgentCondition'])if(!responses.has(a[key]))throw Error('Précisez votre réponse : '+key);
 if(a.accessConsent!=='yes')throw Error('L’autorisation de traitement en situation d’urgence doit être confirmée.');
 for(const [flag,detail] of [['foodAllergy','foodDetails'],['medicineAllergy','medicineDetails'],['urgentCondition','conditionDetails']]){
  if(a[flag]==='yes'&&!String(a[detail]||'').trim())throw Error('Précisions requises : '+detail);
 }
 validSignature(strokes);
 const pdf=await PDFLib.PDFDocument.create();let page=pdf.addPage(letter);
 const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),bold=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
 const top=(y)=>792-y;
 function rect(x,y,w,h,color=white,stroke=border){page.drawRectangle({x,y:top(y+h),width:w,height:h,color,borderColor:stroke,borderWidth:.7});}
 function txt(value,x,y,size=9,fb=false,c=navy){page.drawText(clean(value),{x,y:top(y),size,font:fb?bold:font,color:c});}
 function section(n,label,y){rect(39,y,24,19,blue,blue);txt(n,46,y+13.3,9,true,white);txt(label,75,y+14,10,true);}
 function field(label,value,x,y,w,h=29,lines=1){txt(label,x,y-6,8,true,muted);rect(x,y,w,h);const parts=wrap(font,value||'',9.5,w-14,lines);parts.forEach((s,i)=>txt(s,x+7,y+13+i*12,9.5));}
 function tag(label,value,x,y){txt(label,x,y,9.2,true);txt(value,x+210,y,9.2,false,blue);}
 const answer=v=>({yes:'Oui',no:'Non',undisclosed:'Préfère ne pas répondre'})[v]||'Non précisé';
 page.drawRectangle({x:0,y:0,width:6,height:792,color:blue});
 txt('IGA EXTRA · FAMILLE BENOIT',39,43,10,true);
 txt('SANTÉ ET SÉCURITÉ AU TRAVAIL',39,61,9,true,blue);
 txt('Informations en cas d’urgence',39,88,20,true);
 txt('DOCUMENT CONFIDENTIEL',453,40,8,true,muted);
 page.drawLine({start:{x:39,y:top(98)},end:{x:574,y:top(98)},color:blue,thickness:1.3});
 section('01','IDENTIFICATION DE L’EMPLOYÉ',107);
 field('Nom et prénom',a.employeeName,39,143,330);
 field('Département / fonction',a.departmentRole,378,143,196);
 section('02','PERSONNES À CONTACTER',193);
 rect(39,220,535,17,light,light);txt('CONTACT 1 · PRIORITAIRE',47,232,8.5,true,blue);
 field('Nom complet',a.contact1Name,39,260,243);
 field('Lien',a.contact1Relationship,291,260,115);
 field('Téléphone',a.contact1Phone,415,260,159);
 field('Autre téléphone',a.contact1OtherPhone,39,307,243);
 rect(39,348,535,17,light,light);txt('CONTACT 2 · SI LE PREMIER EST INJOIGNABLE',47,360,8.5,true,blue);
 field('Nom complet',a.contact2Name,39,390,243);
 field('Lien',a.contact2Relationship,291,390,115);
 field('Téléphone',a.contact2Phone,415,390,159);
 field('Autre téléphone',a.contact2OtherPhone,39,437,243);
 section('03','ALLERGIES ET INTERVENTION RAPIDE',485);
 tag('Allergies alimentaires',answer(a.foodAllergy),39,523);
 if(a.foodAllergy==='yes')field('Aliments et réaction possible',a.foodDetails,39,546,535,32,2);
 else field('Précisions (facultatif)',a.foodAllergy==='undisclosed'?'Non divulgué':'Aucune déclarée',39,546,535,32);
 tag('Allergies aux médicaments',answer(a.medicineAllergy),39,598);
 if(a.medicineAllergy==='yes')field('Médicaments et réaction possible',a.medicineDetails,39,620,535,32,2);
 else field('Précisions (facultatif)',a.medicineAllergy==='undisclosed'?'Non divulgué':'Aucune déclarée',39,620,535,32);
 section('04','CONDITION NÉCESSITANT DES SOINS RAPIDES',665);
 txt('Asthme, épilepsie, diabète, anaphylaxie, etc. : '+answer(a.urgentCondition),39,702,8.8);
 const supplement=['foodAllergy','medicineAllergy','urgentCondition'].some(k=>a[k]==='yes')?'Informations complémentaires : voir page 2.':'';
 if(supplement)wrap(font,supplement,8.1,535,2).forEach((line,i)=>txt(line,39,717+i*11,8.1));
 txt('Signature de l’employé :',39,752,8.5,true);
 page.drawLine({start:{x:164,y:top(771)},end:{x:425,y:top(771)},color:border,thickness:.8});
 const now=new Intl.DateTimeFormat('fr-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 txt('Date : '+now,471,756,8,true);
 for(const stroke of strokes){let previous;for(const [x,y] of stroke){const next={x:165+x*245,y:top(742+y*28)};if(previous)page.drawLine({start:previous,end:next,thickness:.85,color:navy});previous=next;}}
 const hasDetails=['foodAllergy','medicineAllergy','urgentCondition'].some(k=>a[k]==='yes');
 if(hasDetails){
  page=pdf.addPage(letter);
  page.drawRectangle({x:0,y:0,width:6,height:792,color:blue});
  txt('IGA EXTRA · FAMILLE BENOIT',39,43,10,true);
  txt('SANTÉ ET SÉCURITÉ AU TRAVAIL · ANNEXE CONFIDENTIELLE',39,62,9,true,blue);
  txt('Consignes d’urgence · informations détaillées',39,91,17,true);
  page.drawLine({start:{x:39,y:top(103)},end:{x:574,y:top(103)},color:blue,thickness:1.3});
  txt('Employé : '+a.employeeName,39,133,10,true);
  let pos=171;
  function detail(label,value){
   txt(label,39,pos,10,true,blue);
   pos+=17;
   const rows=wrap(font,value||'Non précisé',9,515,24);
   for(const row of rows){txt(row,42,pos,9);pos+=13;}
   pos+=18;
  }
  if(a.foodAllergy==='yes')detail('Allergies alimentaires · aliments et réactions',a.foodDetails);
  if(a.medicineAllergy==='yes')detail('Allergies aux médicaments · médicaments et réactions',a.medicineDetails);
  if(a.urgentCondition==='yes'){
   detail('Condition médicale nécessitant une intervention rapide',a.conditionDetails);
   detail('Symptômes à surveiller',a.symptoms);
   detail('Soins prévus / médication prescrite / emplacement',a.carePlan);
  }
  txt('Ces renseignements sont fournis volontairement pour la prise en charge d’une urgence.',39,723,8,false,muted);
  txt('Ils ne constituent pas une ordonnance ni une autorisation d’administrer un médicament.',39,737,8,false,muted);
  txt('Annexe liée à la fiche signée en page 1.',39,755,8,true,blue);
 }
 return Buffer.from(await pdf.save());
}
