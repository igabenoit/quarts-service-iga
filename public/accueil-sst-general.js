const topics=[
 'Urgences et premiers soins : secouriste, trousse et signalement',
 'Évacuation : sorties et point de rassemblement',
 'Risques courants : chutes, manutention, circulation et outils',
 'Équipements : aucune tâche risquée sans formation préalable',
 'Signalement : incidents, respect, harcèlement et droits',
 'Comité SST : représentants, babillard et ressources'
];
const risks=[
 ['risque_caisse','Caisse et ergonomie'],['risque_manutention','Manutention et charges'],
 ['risque_chariots','Escabeaux et chariots'],['risque_transpalette','Transpalettes'],
 ['risque_couteaux','Couteaux et outils coupants'],['risque_machines','Trancheurs et machines'],
 ['risque_chaleur','Surfaces chaudes ou froid'],['risque_chimique','Produits de nettoyage et SIMDUT']
];
function node(parent,tag,text){
 const el=document.createElement(tag);
 if(text)el.textContent=text;
 parent.append(el);
 return el;
}
function field(parent,fields,draft,key,title,type='text',required=false){
 const label=node(parent,'label',title),input=document.createElement('input');
 input.name=key;input.type=type;input.required=required;input.maxLength=200;
 if(type==='checkbox'){label.classList.add('check');input.checked=draft[key]==='yes';label.prepend(input);}
 else{input.value=draft[key]||'';label.append(input);}
 fields.set(key,input);
}
function notes(parent,fields,draft,key,title){
 const label=node(parent,'label',title),textarea=node(label,'textarea');
 textarea.name=key;textarea.maxLength=200;textarea.value=draft[key]||'';
 fields.set(key,textarea);
}
export function buildGeneralSst(form,draft,fields,onsite){
 node(form,'p','À remplir uniquement après un véritable accueil SST chez IGA. La signature confirme les explications reçues, et non une compétence sur une machine.');
 const identity=node(form,'fieldset');node(identity,'legend','1. Identification');
 field(identity,fields,draft,'employe_nom','Nom et prénom de l’employé','text',true);
 field(identity,fields,draft,'departement_poste','Département / poste','text',true);
 if(onsite){
  field(identity,fields,draft,'responsable_accueil','Responsable de l’accueil');
  field(identity,fields,draft,'date_accueil','Date de l’accueil','date');
 }
 const general=node(form,'fieldset');node(general,'legend','2. Accueil général — sujets réellement présentés');
 topics.forEach((title,i)=>field(general,fields,draft,'accueil_sujet_'+(i+1),title,'checkbox',true));
 notes(general,fields,draft,'accueil_points_a_reprendre','Points à reprendre ou précisions');
 if(onsite){
  const practical=node(form,'fieldset');node(practical,'legend','3. Formation pratique — réservée au responsable');
  node(practical,'p','Cocher seulement les risques présents et les compétences réellement observées. Une case « autorisé » doit reposer sur une démonstration et une observation.');
  field(practical,fields,draft,'poste_employe','Employé concerné');
  field(practical,fields,draft,'poste_formateur','Responsable / formateur');
  const r=node(practical,'fieldset');node(r,'legend','Risques présents dans le poste');
  for(const [key,label] of risks)field(r,fields,draft,key,label,'checkbox');
  for(let i=1;i<=5;i++){
   const row=node(practical,'fieldset');node(row,'legend','Tâche ou équipement '+i);
   field(row,fields,draft,'tache_'+i,'Tâche / équipement');
   for(const [key,title] of [['_explique','Expliqué'],['_pratique','Pratiqué devant le responsable'],['_autorise','Autorisé à effectuer en autonomie']])
    field(row,fields,draft,'tache_'+i+key,title,'checkbox');
  }
  notes(practical,fields,draft,'poste_restrictions','Formations à compléter, restrictions et suivi');
  field(practical,fields,draft,'date_suivi','Date prévue du suivi','date');
  field(practical,fields,draft,'responsable_suivi','Responsable du suivi');
  const validation=node(form,'fieldset');node(validation,'legend','4. Validation par le responsable');
  field(validation,fields,draft,'accueil_complete','Accueil général terminé','checkbox');
  field(validation,fields,draft,'formation_complete','Formation pratique terminée','checkbox');
  field(validation,fields,draft,'formation_a_poursuivre','Formation pratique à poursuivre','checkbox');
  notes(validation,fields,draft,'remarques_suivi_final','Mesures avant le prochain quart');
  field(validation,fields,draft,'signature_nom_responsable','Nom du responsable qui valide');
  field(validation,fields,draft,'signature_date_responsable','Date de sa signature','date');
 }
 const employee=node(form,'fieldset');node(employee,'legend','5. Confirmation de l’employé');
 field(employee,fields,draft,'signature_nom_employe','Nom de l’employé','text',true);
 field(employee,fields,draft,'signature_date_employe','Date de la signature','date',true);
 field(employee,fields,draft,'confirmation','Je confirme avoir reçu les explications cochées et sais à qui demander de l’aide.','checkbox',true);
 if(!onsite)node(form,'p','La formation pratique et les autorisations des machines seront validées séparément chez IGA par un responsable, en personne. Ce formulaire ne vaut pas autorisation d’utiliser un équipement.');
}
