const digits=value=>typeof value==='string'&&/^\+?[\d\s().-]*$/.test(value.trim())?value.replace(/\D/g,''):null;
const fullNumber=value=>{
 const number=digits(value);
 return number?.length===10?number:number?.length===11&&number.startsWith('1')?number.slice(1):null;
};

export function normalizeTuacPhone(answers,preferred='Téléphone'){
 const result={...answers};
 const full=fullNumber(answers[preferred])||fullNumber(answers[preferred==='Téléphone'?'Indicatif':'Téléphone']);
 if(full){result.Indicatif=full.slice(0,3);result.Téléphone=full.slice(3);}
 else for(const [key,length] of [['Indicatif',3],['Téléphone',7]]){
  const value=digits(answers[key]);if(value?.length===length)result[key]=value;
 }
 return result;
}

export function configureTuacFields(fields){
 const area=fields.get('Indicatif'),phone=fields.get('Téléphone');
 const normalize=preferred=>{
  const values=normalizeTuacPhone({Indicatif:area.value,Téléphone:phone.value},preferred);
  if(area.value!==values.Indicatif)area.value=values.Indicatif;
  if(phone.value!==values.Téléphone)phone.value=values.Téléphone;
 };
 for(const [key,input,autocomplete,pattern,placeholder] of [
  ['Indicatif',area,'tel-area-code','[0-9]{3}','450'],
  ['Téléphone',phone,'tel-local','[0-9]{7}','5550123']
 ]){
  input.type='tel';input.inputMode='tel';input.autocomplete=autocomplete;
  input.name=autocomplete;input.id='tuac-'+autocomplete;input.pattern=pattern;input.placeholder=placeholder;
  // Accepter le numéro complet avant de le répartir : maxlength=3/7 le tronquerait.
  input.maxLength=30;input.title=key==='Indicatif'?'Indicatif régional de 3 chiffres':'Numéro de téléphone de 7 chiffres, sans l’indicatif';
  for(const event of ['input','change','blur'])input.addEventListener(event,()=>normalize(key));
 }
 fields.get('Appartement').required=false;
 normalize();
 return ()=>normalize();
}
