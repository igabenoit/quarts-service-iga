export const sections = [
  ['Politiques en santé et sécurité du travail', []],
  ['Respect au travail et programme de prévention', []],
  ['Babillard SST', ['Programme de prévention', 'Secouristes', 'Membres et dernier compte rendu du comité SST']],
  ['Premiers soins', ['Registre des incidents', 'Formulaires d’assignation temporaire', 'Trousses de premiers soins', 'Douche oculaire', 'Fiches de données de sécurité (SIMDUT)']],
  ['Mesures d’urgence', ['Plan et consignes d’évacuation', 'Point de rassemblement', 'Sorties de secours et extincteurs']],
  ['Présentation au parrain', ['Présentation au parrain et grille d’accompagnement du département']],
  ['Équipements de protection individuelle', []]
];
export function buildSst(form,draft,fields,onsite){
  function append(parent,tag,text){
    const el=document.createElement(tag);
    el.textContent=text;
    parent.append(el);
    return el;
  }
  function field(parent,key,title,type='text',required=false,max=100){
    const label=append(parent,'label',title);
    const input=document.createElement('input');
    input.type=type;
    input.name=key;
    input.required=required;
    input.maxLength=max;
    if(type==='checkbox'){
      input.checked=draft[key]==='yes';
      label.prepend(input);
    }else{
      input.value=draft[key]||'';
      label.append(input);
    }
    if(type==='number'){input.min='0';input.max='168';input.step='any';}
    fields.set(key,input);
  }
  field(form,'Nom','Nom du travailleur','text',true);
  field(form,'Poste','Emploi occupé','text',true);
  let index=0;
  sections.forEach(([title,items],i)=>{
    const group=append(form,'fieldset','');
    append(group,'legend',title);
    for(const item of items)field(group,'case'+index++,item,'checkbox');
    if(onsite)field(group,'initiales'+i,'Initiales du responsable','text',false,8);
    else if(draft['initiales'+i])append(group,'p','Initiales du responsable : '+draft['initiales'+i]);
  });
  for(const week of [1,2]){
    const group=append(form,'fieldset','');
    append(group,'legend','Suivi de formation · semaine '+week);
    field(group,'date'+week,'Date de formation','date');
    field(group,'heures'+week,'Nombre d’heures','number');
  }
  field(form,'Signature','Date de signature','date',true);
  field(form,'confirmation','Je confirme avoir pris connaissance des documents indiqués et en avoir discuté avec le superviseur.','checkbox',true);
}
