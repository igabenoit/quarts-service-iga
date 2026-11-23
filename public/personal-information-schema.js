export const personalEmployeeFields=['lastName','firstName','birthDate','sin','street','apartment','city','province','postalCode','homePhone','mobilePhone','email','signatureDate'];
export const personalEmployerFields=['employerDepartment','employerPosition','employerStartDate','employerSalary','employerScale'];
export const personalFields=[...personalEmployeeFields,...personalEmployerFields];
export const personalLabels={lastName:'Nom',firstName:'Prénom',birthDate:'Date de naissance',sin:'Numéro d’assurance sociale',street:'Numéro civique et rue',apartment:'Appartement',city:'Ville',province:'Province',postalCode:'Code postal',homePhone:'Téléphone à la maison',mobilePhone:'Téléphone cellulaire',email:'Adresse courriel',signatureDate:'Date de signature',employerDepartment:'Département',employerPosition:'Poste occupé',employerStartDate:'Date d’entrée en fonction',employerSalary:'Salaire',employerScale:'Échelle salariale'};
export const personalLimits={lastName:60,firstName:60,birthDate:10,sin:11,street:120,apartment:20,city:60,province:40,postalCode:7,homePhone:25,mobilePhone:25,email:200,signatureDate:10,employerDepartment:60,employerPosition:80,employerStartDate:10,employerSalary:50,employerScale:60};
export const personalEmployerReady=answers=>personalEmployerFields.every(key=>typeof answers?.[key]==='string'&&answers[key].trim());
export function personalAnswers(input,previous={},employer=false){
 const editable=new Set(employer?personalEmployerFields:personalEmployeeFields);
 return Object.fromEntries(personalFields.map(key=>{
  const raw=editable.has(key)?input[key]??'':previous[key]??'';
  if(typeof raw!=='string'||raw.length>personalLimits[key])throw Error('Vérifiez le champ « '+personalLabels[key]+' ».');
  return [key,raw.trim()];
 }));
}
const dateValid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export function validatePersonalInformation(answers){
 if(!personalEmployerReady(answers))throw Error('L’employeur doit compléter sa section avant la signature. Vous pouvez enregistrer vos renseignements et revenir plus tard.');
 for(const key of personalFields.filter(key=>!['apartment','homePhone','mobilePhone'].includes(key)))if(!answers[key]?.trim())throw Error('Veuillez compléter le champ « '+personalLabels[key]+' ».');
 for(const key of ['birthDate','signatureDate','employerStartDate'])if(!dateValid(answers[key]))throw Error('Vérifiez la date « '+personalLabels[key]+' ».');
 if(!/^\d{3}[ -]?\d{3}[ -]?\d{3}$/.test(answers.sin))throw Error('Le numéro d’assurance sociale doit comporter neuf chiffres.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email))throw Error('Vérifiez l’adresse courriel.');
 if(!/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(answers.postalCode))throw Error('Vérifiez le code postal.');
 if(![answers.homePhone,answers.mobilePhone].some(value=>value?.replace(/\D/g,'').length>=10))throw Error('Indiquez au moins un numéro de téléphone complet.');
 for(const key of ['homePhone','mobilePhone'])if(answers[key]&&!/^[\d+(). #xext-]{7,25}$/i.test(answers[key]))throw Error('Vérifiez le numéro de téléphone.');
 return answers;
}
