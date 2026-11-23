import PDFLib from './tuac/pdf-lib.min.cjs';
import {letterDuplexPreferences} from './letter-print.js';
export {letterDuplexPreferences} from './letter-print.js';
const {rgb,StandardFonts}=PDFLib;
export const generalSstSignatureZones={employee:{page:0,left:130,bottom:163,width:420,height:23},supervisor:{page:1,left:130,bottom:44,width:420,height:23}};
export async function createGeneralSstLayout(){
 const pdf=await PDFLib.PDFDocument.create(),form=pdf.getForm();
 const font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.08,.13,.18),muted=rgb(.27,.31,.35),line=rgb(.65,.69,.72),shade=rgb(.94,.95,.96);
 let page;
 const y=top=>792-top;
 function text(value,x,top,size=9,heavy=false){page.drawText(value,{x,y:y(top),font:heavy?bold:font,size,color:ink});}
 function rule(top){page.drawLine({start:{x:36,y:y(top)},end:{x:576,y:y(top)},thickness:.6,color:line});}
 function section(value,top){text(value,36,top,10.5,true);rule(top+5);}
 function header(title,subtitle,index){
  page=pdf.addPage([612,792]);text('IGA EXTRA FAMILLE BENOIT  |  ALIMENTATION SOGESCO INC.',36,29,8,true);
  text(title,36,50,16,true);text(subtitle,36,65,8.5);
  text(index+' / 2',552,773,8);return page;
 }
 function field(key,label,x,top,width,height=22,multiline=false){
  if(label)text(label,x,top-5,8,true);
  const f=form.createTextField(key);f.addToPage(page,{x,y:y(top+height),width,height,borderWidth:.6,borderColor:line,backgroundColor:rgb(1,1,1),textColor:ink,font});
  if(multiline)f.enableMultiline();f.setFontSize(9);f.setMaxLength(200);return f;
 }
 function check(key,label,x,top,size=9){
  const f=form.createCheckBox(key);f.addToPage(page,{x,y:y(top+11),width:11,height:11,borderWidth:.7,borderColor:muted,backgroundColor:rgb(1,1,1),textColor:ink});
  if(label)text(label,x+17,top+9,size);return f;
 }
 header('Programme d’accueil général SST - 2026','Une présentation concrète des consignes essentielles, quel que soit le nombre d’heures travaillées.',1);
 section('1. Identification',86);
 field('employe_nom','Nom et prénom',36,111,258);field('departement_poste','Département / poste',306,111,270);
 field('responsable_accueil','Personne responsable de l’accueil',36,151,330);field('date_accueil','Date de l’accueil (AAAA-MM-JJ)',378,151,198);
 section('2. Sujets présentés à l’employé',196);
 text('Cocher après explication réelle.',36,213,8.5);
 const topics=[
  ['Urgences et premiers soins','Secouriste, trousse, accident ou malaise : qui aviser et quoi faire.'],
  ['Évacuation et sécurité des lieux','Sorties, point de rassemblement et consignes d’urgence.'],
  ['Risques courants dans le magasin','Chutes, manutention, circulation, coupures, chaleur et produits selon les tâches.'],
  ['Formation et utilisation des équipements','Ne pas utiliser un appareil ou accomplir une tâche risquée sans formation préalable.'],
  ['Signalement, respect et droits','Danger, incident, harcèlement, violence et droit de refuser un travail dangereux.'],
  ['Comité SST et personnes-ressources','Où trouver les représentants, le babillard et les consignes de prévention.']
 ];
 topics.forEach(([title,description],i)=>{const top=229+i*35;check('accueil_sujet_'+(i+1),'',36,top-8);text(title,54,top,9.5,true);text(description,54,top+13,8.5);});
 field('accueil_points_a_reprendre','Points à reprendre ou précisions',36,451,540,39,true);
 text('Cocher uniquement ce qui a été présenté. La validation des compétences se fait au poste (verso).',36,505,8.5);
 section('3. Confirmation de l’employé',529);
 text('Je confirme les explications reçues et sais à qui demander de l’aide.',36,547,9);
 field('signature_nom_employe','Nom de l’employé',36,569,348);field('signature_date_employe','Date de la signature (AAAA-MM-JJ)',396,569,180);
 text('Signature de l’employé :',36,625,8.5);page.drawLine({start:{x:130,y:162},end:{x:576,y:162},thickness:.7,color:muted});
 section('Règles de gestion du programme',657);
 [
  '1. L’accueil général se fait avant l’exposition aux risques; il s’adapte à l’âge et au poste.',
  '2. Le responsable montre les méthodes et observe la pratique avant toute autonomie à risque.',
  '3. Un changement de tâche, de machine ou de département peut nécessiter une autre formation.',
  '4. Conserver cette fiche au dossier; ne jamais attester une formation non réalisée.'
 ].forEach((value,i)=>text(value,36,677+i*16,8.7));
 text('À remplir avec votre gérant, dans votre département. Les deux côtés forment un seul document.',36,750,8.5,true);

 header('Formation au poste et validation SST','Une démonstration et une observation sont nécessaires pour les tâches présentant des risques.',2);
 field('poste_employe','Employé',36,85,258);field('poste_formateur','Responsable / formateur',306,85,270);
 section('4. Risques présents dans ce poste',125);
 const risks=[['risque_caisse','Caisse / ergonomie'],['risque_manutention','Manutention et charges'],['risque_chariots','Escabeaux / chariots'],['risque_transpalette','Transpalettes / manutention'],['risque_couteaux','Couteaux / outils coupants'],['risque_machines','Trancheurs / machines'],['risque_chaleur','Surfaces chaudes / froid'],['risque_chimique','Produits de nettoyage / SIMDUT']];
 risks.forEach(([key,label],i)=>check(key,label,36+(i%2)*270,140+Math.floor(i/2)*18,8.8));
 section('5. Tâches ou équipements effectivement formés',223);
 page.drawRectangle({x:36,y:y(251),width:540,height:20,color:shade});
 text('Tâche / équipement',42,245,8.5,true);text('Expliqué',370,245,8.5,true);text('Pratiqué',440,245,8.5,true);text('Autorisé',511,245,8.5,true);
 for(let i=1;i<=5;i++){
  const top=253+(i-1)*31;field('tache_'+i,'',36,top,316,29,true);
  for(const [suffix,x] of [['_explique',386],['_pratique',456],['_autorise',527]])check('tache_'+i+suffix,'',x,top+9);
 }
 text('« Autorisé » signifie qu’une pratique sécuritaire a été vérifiée pour cette tâche.',36,421,8.5);
 text('Une case vide signifie que cette autorisation n’est pas attestée par ce document.',36,433,8.5);
 field('poste_restrictions','Formation à compléter / restrictions / suivi',36,454,540,29,true);
 field('date_suivi','Date prévue de suivi',36,505,180);field('responsable_suivi','Responsable du suivi',228,505,348);
 section('6. État du parcours et suivi',547);
 check('accueil_complete','Accueil général terminé',36,560,8.8);check('formation_complete','Formation pratique terminée',306,560,8.8);
 check('formation_a_poursuivre','Formation pratique à poursuivre (préciser ci-dessous)',36,579,8.8);
 field('remarques_suivi_final','Remarques / mesures avant le prochain quart',36,611,540,29,true);
 section('7. Confirmation du responsable de l’accueil / formation',658);
 text('Je confirme les sujets présentés, les tâches vérifiées et les suivis indiqués.',36,675,8.8);
 field('signature_nom_responsable','Nom du responsable',36,698,348);field('signature_date_responsable','Date de la signature',396,698,180);
 text('Signature du responsable :',36,744,8.2);page.drawLine({start:{x:130,y:43},end:{x:576,y:43},thickness:.7,color:muted});
 text('Cette fiche ne remplace pas les formations obligatoires propres aux tâches.',36,763,8);
 letterDuplexPreferences(pdf);
 return {pdf,form,font};
}

export function fitGeneralSstField(field,value,font){
 field.setText(value);
 const {width,height}=field.acroField.getWidgets()[0].getRectangle();
 let size=9;
 if(!field.isMultiline())size=Math.min(size,(width-6)/Math.max(1,font.widthOfTextAtSize(value,1)));
 else{
  const fits=size=>{const layout=PDFLib.layoutMultilineText(value,{alignment:PDFLib.TextAlignment.Left,font,fontSize:size,bounds:{x:0,y:0,width:width-6,height:height-4}});return layout.lines.every(line=>line.y>=0&&line.width<=width-6);};
  while(size>1&&!fits(size))size-=.25;
 }
 field.setFontSize(size);
}
