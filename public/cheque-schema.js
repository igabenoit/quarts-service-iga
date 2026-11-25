export const chequeMaxBytes=12*1024*1024;
export const chequeMimeTypes=['application/pdf','image/jpeg','image/png','image/webp'];
export function chequeLink(value){
 if(typeof value!=='string'||value.trim().length>4000)throw Error('Inscrivez le lien HTTPS vers votre spécimen de chèque.');
 let url;try{url=new URL(value.trim());}catch{throw Error('Inscrivez un lien complet commençant par https://.');}
 if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.'))throw Error('Utilisez un lien HTTPS vers le document, sans identifiant ni mot de passe dans l’adresse.');
 return url.href;
}
