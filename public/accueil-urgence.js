export const emergencyFields=[
 'employeeName','departmentRole',
 'contact1Name','contact1Relationship','contact1Phone','contact1OtherPhone',
 'contact2Name','contact2Relationship','contact2Phone','contact2OtherPhone',
 'foodAllergy','foodDetails','medicineAllergy','medicineDetails',
 'urgentCondition','conditionDetails','symptoms','carePlan','accessConsent'
];

export function buildEmergency(form,draft,fields){
 const make=(tag,text='')=>{const el=document.createElement(tag);el.textContent=text;return el;};
 const section=title=>{const box=make('fieldset');box.append(make('legend',title));form.append(box);return box;};
 const field=(parent,id,title,options={})=>{
  const label=make('label',title);
  const input=options.choices?make('select'):make(options.multi?'textarea':'input');
  if(options.choices){
   input.add(new Option('Choisir…',''));
   for(const [value,text] of Object.entries(options.choices))input.add(new Option(text,value));
  }else if(options.multi){input.rows=2;input.maxLength=200;}
  else{input.type=options.checkbox?'checkbox':options.phone?'tel':'text';input.maxLength=200;}
  input.name=id;
  if(options.phone){input.autocomplete='tel';input.pattern='[0-9+(). -]{7,25}';}
  if(options.checkbox)input.checked=draft[id]==='yes';
  else input.value=draft[id]??'';
  input.required=!!options.required;
  fields.set(id,input);label.append(input);parent.append(label);return input;
 };
 const identity=section('1 · Identification');
 field(identity,'employeeName','Nom et prénom de l’employé',{required:true});
 field(identity,'departmentRole','Département / fonction');
 for(let n=1;n<=2;n++){
  const box=section('2 · Contact '+n+(n===1?' (prioritaire)':' (si le premier est injoignable)'));
  field(box,'contact'+n+'Name','Nom et prénom',{required:true});
  field(box,'contact'+n+'Relationship','Lien avec l’employé',{required:true});
  field(box,'contact'+n+'Phone','Téléphone principal',{phone:true,required:true});
  field(box,'contact'+n+'OtherPhone','Autre téléphone',{phone:true});
 }
 const health=section('3 · Allergies et soins d’urgence · renseignements facultatifs');
 health.append(make('p','Ces renseignements sont demandés uniquement pour faciliter une intervention d’urgence. Tu peux choisir de ne pas divulguer tes informations de santé.'));
 const choices={no:'Non',yes:'Oui',undisclosed:'Je préfère ne pas répondre'};
 const groups=[
  ['foodAllergy','Allergies alimentaires','foodDetails','Aliments concernés et réactions possibles'],
  ['medicineAllergy','Allergies aux médicaments','medicineDetails','Médicaments concernés et réactions possibles'],
  ['urgentCondition','Maladie nécessitant rapidement des soins ou une médication (asthme, épilepsie, diabète, etc.)','conditionDetails','Condition / maladie']
 ];
 for(const [key,title,extra,desc] of groups){
  const selection=field(health,key,title,{choices,required:true});
  const detail=field(health,extra,desc,{multi:true});
  const update=()=>{const enabled=selection.value==='yes';detail.disabled=!enabled;detail.required=enabled;detail.parentElement.hidden=!enabled;};
  selection.onchange=update;update();
 }
 const symptoms=field(health,'symptoms','Signes ou symptômes à surveiller',{multi:true});
 const care=field(health,'carePlan','Soins immédiats prévus, médication prescrite et emplacement (si pertinents)',{multi:true});
 const condition=fields.get('urgentCondition');
 const updateCare=()=>{const enabled=condition.value==='yes';for(const el of [symptoms,care]){el.disabled=!enabled;el.parentElement.hidden=!enabled;}};
 condition.addEventListener('change',updateCare);updateCare();
 const consent=section('4 · Utilisation et confidentialité');
 consent.append(make('p','Je comprends que les renseignements de santé transmis sont facultatifs, limités aux besoins d’urgence et ne constituent pas une autorisation d’administrer des médicaments.'));
 field(consent,'accessConsent','J’autorise l’utilisation des renseignements fournis exclusivement en cas d’urgence par les personnes habilitées.',{checkbox:true,required:true});
 return ()=>{for(const [key,input] of fields){if(input.type==='checkbox'&&input.required&&!input.checked){input.setCustomValidity('Autorisation requise pour soumettre cette fiche.');return;}if(input.type==='checkbox')input.setCustomValidity('');} };
}
