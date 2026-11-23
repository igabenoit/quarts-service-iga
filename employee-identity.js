// A single identity check for hiring from HR, department schedules and Service.
// Names are only candidates: never merge a personnel record automatically.
export const identityNameKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)?.sort().join(' ')||'';
export async function employeeIdentityMatches(client,input,{partial=false}={}){
 const rows=(await client.query(`SELECT p.id,p.portal_person_id,p.service_employee_id,
  COALESCE(e.name,p.name) AS name,p.employee_code,COALESCE(c.email,p.email) AS email
  FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
  LEFT JOIN schedule_employee_contacts c ON c.employee_id=e.id
  UNION ALL SELECT NULL,NULL,e.id,e.name,NULL,c.email FROM schedule_employees e
  LEFT JOIN schedule_employee_contacts c ON c.employee_id=e.id
  WHERE NOT EXISTS(SELECT 1 FROM schedule_store_people p WHERE p.service_employee_id=e.id)`)).rows;
 const root=row=>{const seen=new Set();while(row.portal_person_id&&!seen.has(String(row.id))){seen.add(String(row.id));const parent=rows.find(p=>String(p.id)===String(row.portal_person_id));if(!parent)break;row=parent;}return row;};
 const key=identityNameKey(input.name),code=typeof input.employeeCode==='string'&&/^\d{6}$/.test(input.employeeCode)?input.employeeCode:'',email=String(input.email||'').trim().toLowerCase();
 const matches=new Map();
 for(const row of rows){
  const person=root(row),reasons=[];
  if(code&&person.employee_code===code)reasons.push('code');
  if(key&&identityNameKey(row.name)===key)reasons.push('name');
  else if(partial&&key.length>=3&&key.split(' ').every(term=>identityNameKey(row.name).split(' ').some(word=>word.startsWith(term))))reasons.push('similar');
  if(email&&String(row.email||'').trim().toLowerCase()===email)reasons.push('email');
  if(!reasons.length)continue;
  const employeeKey=person.service_employee_id?'service:'+person.service_employee_id:'store:'+person.id,previous=matches.get(employeeKey);
  matches.set(employeeKey,{employeeKey,personId:person.id?Number(person.id):null,serviceEmployeeId:person.service_employee_id?Number(person.service_employee_id):null,name:person.name,reasons:[...new Set([...(previous?.reasons||[]),...reasons])]});
 }
 return [...matches.values()];
}
export async function assertNewEmployeeIdentity(client,input){
 const matches=await employeeIdentityMatches(client,input);
 const coded=matches.some(m=>m.reasons.includes('code'));
 if(coded||matches.length&&input.distinctPerson!==true)throw Object.assign(Error(coded?
  'Ce matricule appartient déjà à une fiche employé. Ouvrez la fiche existante au lieu de la recréer.':
  'Une fiche correspond déjà à ce nom ou à ce courriel. Ouvrez le dossier existant, ou confirmez après vérification qu’il s’agit d’une autre personne.'),{status:409});
}
