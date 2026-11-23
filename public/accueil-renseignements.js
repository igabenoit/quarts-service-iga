import {personalEmployeeFields,personalEmployerFields,personalLabels,personalLimits,personalEmployerReady} from './personal-information-schema.js';
export function buildPersonalInformation(form,draft,fields,employer){
 const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
 const section=node('fieldset');section.append(node('legend',employer?'Section employeur':'Vos renseignements personnels'));form.append(section);
 section.append(node('p',employer?'Complétez les renseignements d’emploi, puis enregistrez. L’employé remplit ses coordonnées et signe depuis son lien personnel.':'Remplissez vos coordonnées. La section employeur est préparée par votre équipe de gestion et ne peut pas être modifiée ici.'));
 for(const key of employer?personalEmployerFields:personalEmployeeFields){
  const label=node('label',personalLabels[key]+(['apartment','homePhone','mobilePhone'].includes(key)?' (facultatif)':'')),input=node('input');
  input.name=key;input.maxLength=personalLimits[key];input.value=draft[key]||'';input.required=!['apartment','homePhone','mobilePhone'].includes(key);
  input.type=key.endsWith('Date')?'date':key==='email'?'email':key.endsWith('Phone')?'tel':'text';
  input.autocomplete={lastName:'family-name',firstName:'given-name',birthDate:'bday',street:'address-line1',apartment:'address-line2',city:'address-level2',province:'address-level1',postalCode:'postal-code',email:'email',homePhone:'tel',mobilePhone:'tel'}[key]||'off';
  if(key==='sin'){input.inputMode='numeric';input.pattern='[0-9]{3}[ -]?[0-9]{3}[ -]?[0-9]{3}';input.setAttribute('aria-describedby','sin-help');}
  if(key==='employerSalary')input.placeholder='Ex. 18,50 $ / heure';
  if(key==='employerScale')input.placeholder='Échelon applicable ou Sans objet';
  label.append(input);section.append(label);fields.set(key,input);
  if(key==='mobilePhone')section.append(node('p','Indiquez au moins un numéro de téléphone : maison ou cellulaire.'));
  if(key==='sin'){const note=node('p','Votre NAS est conservé avec ce formulaire dans votre dossier RH; il n’est pas envoyé par courriel.');note.id='sin-help';note.className='muted';section.append(note);}
 }
 if(!employer){
  const info=node('fieldset');info.append(node('legend','Section employeur · lecture seule'));
  for(const key of personalEmployerFields){const label=node('label',personalLabels[key]),input=node('input');input.value=draft[key]||'À compléter par l’employeur';input.readOnly=true;input.setAttribute('aria-readonly','true');label.append(input);info.append(label);}
  form.append(info);
  if(!personalEmployerReady(draft)){const note=node('p','L’employeur doit terminer sa section avant votre signature. Vous pouvez déjà remplir vos renseignements et les enregistrer.');note.className='personal-pending';note.setAttribute('role','status');form.append(note);}
 }
 return {ready:personalEmployerReady(draft)};
}
