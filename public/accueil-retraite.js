import {retirementFields,visibleGroup} from './retirement-fields.js';

export function buildRetirement(form,draft,fields){
 function create(tag,text){const el=document.createElement(tag);el.textContent=text||'';return el;}
 function group(title){const box=create('fieldset');box.append(create('legend',title));form.append(box);return box;}
 function control(parent,id,label,options={}){
  const wrap=create('label',label);
  const el=create(options.choices?'select':'input');
  if(options.choices){
   el.add(new Option('Choisir…',''));
   for(const [value,title] of Object.entries(options.choices))el.add(new Option(title,value));
  }else{el.type=options.type||'text';el.maxLength=options.flex||options.format?200:options.n||200;}
  if(options.pattern)el.pattern=options.pattern;
  el.value=draft[id]??options.value??'';
  el.required=!!options.req;el.name=id;fields.set(id,el);wrap.append(el);parent.append(wrap);
  return el;
 }
 const boxes={};
 function section(id,title){
  const box=group(title);boxes[id]=box;
  for(const f of retirementFields.filter(item=>item.group===id)){
   control(box,f.id,f.label,{...f,choices:f.choices&&Object.fromEntries(Object.keys(f.choices).map(k=>[k,k]))});
  }
 }
 section('p','1 · Renseignements sur le participant');
 const spouse=control(form,'spouse','Ajouter un conjoint ou une conjointe ?',{choices:{no:'Non',yes:'Oui'},value:'no'});
 section('c','2 · Renseignements sur le conjoint');
 const mode=control(form,'mode','3 · Désignation de bénéficiaire',{choices:{estate:'Ma succession',persons:'Un ou plusieurs bénéficiaires'},req:true});
 const count=control(form,'count','Nombre de bénéficiaires',{choices:{1:'1',2:'2',3:'3'},value:'1'});
 for(let i=0;i<3;i++)section('b'+i,'Bénéficiaire '+(i+1));
 function update(){
  count.parentElement.hidden=mode.value!=='persons';count.disabled=count.parentElement.hidden;
  count.required=!count.disabled;
  const values={mode:mode.value,count:count.value,spouse:spouse.value};
  for(const [id,box] of Object.entries(boxes)){box.hidden=!visibleGroup(id,values);box.disabled=box.hidden;}
 }
 spouse.onchange=mode.onchange=count.onchange=update;update();
 const auth=group('4 · Autorisation du participant');
 const img=create('img');img.src='/retraite-autorisation.png';img.alt='Autorisation de la section 4 du formulaire original';img.className='retirement-authorization';auth.append(img);
 control(auth,'consent','J’ai lu l’autorisation de la section 4 et je consens à signer ce formulaire.',{choices:{yes:'Je confirme'},req:true});
 control(auth,'signed','Date de signature',{type:'date',req:true});
 mode.addEventListener('change',()=>fields.get('b0_part').setCustomValidity(''));
 form.addEventListener('input',()=>fields.get('b0_part').setCustomValidity(''));
 return ()=>{
  if(mode.value!=='persons')return;
  const total=Array.from({length:Number(count.value)},(_,i)=>Number(fields.get('b'+i+'_part').value)).reduce((a,b)=>a+b,0);
  fields.get('b0_part').setCustomValidity(total===100?'':'Les parts des bénéficiaires doivent totaliser 100 %.');
 };
}
