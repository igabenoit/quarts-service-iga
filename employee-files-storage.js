import pg from 'pg';

// Never fall back to the scheduling database. No production files are written
// until a separate Canadian database and its hosting review are configured.
export async function employeeFilesStorage(env=process.env){
 const url=env.EMPLOYEE_FILES_DATABASE_URL;
 const isolated=env.NODE_ENV==='test'&&!!env.TEST_STARTUP_DB&&url==='postgres://employee-files.test/test';
 if(!url)return {pool:null,status:{ready:false,region:null,message:'Le coffre documentaire canadien n’est pas encore connecté. Les nouvelles saisies et les dépôts sont désactivés; le personnel existant reste consultable.'}};
 let u;try{u=new URL(url);}catch{throw Error('EMPLOYEE_FILES_DATABASE_URL invalide');}
 if(env.EMPLOYEE_FILES_DATABASE_PASSWORD)u.password=encodeURIComponent(env.EMPLOYEE_FILES_DATABASE_PASSWORD);
 if(!isolated){
  if(!['postgres:','postgresql:'].includes(u.protocol)||url===env.DATABASE_URL||u.hostname.includes('render.com')||u.hostname.startsWith('dpg-'))throw Error('Le coffre employé doit utiliser une base distincte de Render.');
  if(env.EMPLOYEE_FILES_REGION!=='ca-central-1')throw Error('Confirmez la région Canada Central avant connexion.');
  if(!u.password)throw Error('Le mot de passe du coffre est absent.');
  // Connection-string SSL parameters must not override certificate validation.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])u.searchParams.delete(key);
 }
 const trial=env.EMPLOYEE_FILES_SINGLE_TRIAL==='yes';
 const schema=trial?'employee_files_single_trial':'employee_files_private';
 const pool=new pg.Pool({connectionString:isolated?url:u.toString(),ssl:isolated?false:{rejectUnauthorized:true,...(env.EMPLOYEE_FILES_CA_PEM?{ca:env.EMPLOYEE_FILES_CA_PEM}:{})},options:'-c search_path='+schema,max:3,connectionTimeoutMillis:5000});
 pool.on('error',()=>{});
 // Verify only the connection and session configuration while collection is
 // closed. Never create a schema, read employee records, or return a usable
 // pool until the hosting review is explicitly recorded.
 if(trial){
  try{
   const recipients=[env.EMPLOYEE_TRIAL_EMAIL,env.EMPLOYEE_TRIAL_MANAGER_EMAIL];
   if(!recipients.every(s=>typeof s==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))throw Error('Boîtes de test requises.');
   await pool.query('CREATE SCHEMA IF NOT EXISTS employee_files_single_trial; REVOKE ALL ON SCHEMA employee_files_single_trial FROM PUBLIC');
   const check=await pool.query("SELECT current_schema() AS name");
   if(check.rows[0]?.name!==schema)throw Error('Schéma d’essai inaccessible.');
   return {pool:null,trialPool:pool,status:{ready:false,singleTrial:true,message:'Essai limité à la fiche fictive. Le coffre RH général demeure fermé.'}};
  }catch(e){await pool.end();throw e;}
 }
 if(!isolated&&env.EMPLOYEE_FILES_HOSTING_REVIEWED!=='yes'){
  let status;
  try{
   const result=await pool.query("SELECT 1 AS connected, current_setting('search_path') AS search_path");
   if(result.rows[0]?.connected!==1||result.rows[0]?.search_path!=='employee_files_private')throw Error('session_configuration');
   status={ready:false,connected:true,region:'ca-central-1',reason:'hosting_review',message:'Connexion chiffrée à la base Canada Central vérifiée. La collecte demeure désactivée jusqu’à la validation de la revue d’hébergement par le responsable.'};
  }catch(error){
   const code=String(error?.code||'');
   const reason=code==='28P01'?'authentication':/CERT|TLS|SSL/.test(code)?'tls':'connection';
   status={ready:false,connected:false,region:'ca-central-1',reason,message:reason==='authentication'?'La base canadienne refuse les identifiants. Vérifiez le mot de passe dans les secrets Render.':reason==='tls'?'La connexion sécurisée à la base canadienne doit être vérifiée. La validation du certificat reste obligatoire.':'La connexion à la base canadienne n’a pas pu être vérifiée. Les nouvelles saisies restent désactivées.'};
  }finally{await pool.end();}
  return {pool:null,status};
 }
 try{await pool.query('CREATE SCHEMA IF NOT EXISTS employee_files_private');}catch(error){await pool.end();throw error;}
 return {pool,status:{ready:true,region:isolated?'test-local':'ca-central-1',message:isolated?'Base fictive isolée.':'Coffre documentaire distinct · Canada Central. Le traitement par l’application Render reste couvert par l’EFVP.'}};
}
