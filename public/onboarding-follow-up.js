export function parseFollowUpEmails(value){
 if(typeof value!=='string'||value.length>12800)throw Error('Inscrivez de 1 à 50 adresses courriel pour le suivi.');
 const addresses=value.split(/[,;\r\n]/).map(email=>email.trim()).filter(Boolean);
 if(!addresses.length)throw Error('Inscrivez au moins une adresse courriel pour le suivi.');
 if(addresses.some(email=>email.length>254||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)))throw Error('Une adresse de suivi est invalide. Séparez les adresses par une virgule ou un point-virgule.');
 const seen=new Set(),unique=addresses.filter(email=>{const key=email.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
 if(unique.length>50)throw Error('Le suivi est limité à 50 adresses courriel.');
 return unique;
}
