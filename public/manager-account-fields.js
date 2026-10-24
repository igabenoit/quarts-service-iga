// Mirror the server requirements so refusals are visible beside the save button.
export function accountValidation(values,editing=false){
  const name=values.name.trim(),login=values.login.trim().toLowerCase();
  if(name.length<2||name.length>100)return 'Indiquez le nom du gérant (2 à 100 caractères).';
  if(!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(login))return 'L’identifiant doit contenir de 3 à 100 caractères, sans espace ni accent. Exemple : gerant.fruits. Le nom du gérant peut contenir des espaces et accents.';
  if((!editing||values.password)&& (values.password.length<12||values.password.length>128))return 'Le mot de passe doit contenir de 12 à 128 caractères. Le compte n’est pas encore enregistré.';
  if(values.active&&!values.departments.length)return 'Cochez au moins un département pour ce gérant avant d’enregistrer.';
  if(values.active&&(!Number.isSafeInteger(values.personId)||values.personId<=0))return 'Choisissez la fiche employé correspondant à ce gérant. Son départ coupera automatiquement ses accès.';
  return '';
}
