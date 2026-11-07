import pg from 'pg';

// Never fall back to the scheduling database. No production files are written
// until a separate Canadian database and its hosting review are configured.
export async function employeeFilesStorage(env=process.env){
 const url=env.EMPLOYEE_FILES_DATABASE_URL;
 const isolated=env.NODE_ENV==='test'&&!!env.TEST_STARTUP_DB&&url==='postgres://employee-files.test/test';
 if(!url)return {pool:null,status:{ready:false,region:null,message:'Le coffre documentaire canadien n’est pas encore connecté. Les nouvelles saisies et les dépôts sont désactivés; le personnel existant reste consultable.'}};
 let u;try{u=new URL(url);}catch{throw Error('EMPLOYEE_FILES_DATABASE_URL invalide');}
 if(!isolated){
  if(!['postgres:','postgresql:'].includes(u.protocol)||url===env.DATABASE_URL||u.hostname.includes('render.com')||u.hostname.startsWith('dpg-'))throw Error('Le coffre employé doit utiliser une base distincte de Render.');
  if(env.EMPLOYEE_FILES_REGION!=='ca-central-1'||env.EMPLOYEE_FILES_HOSTING_REVIEWED!=='yes')throw Error('Confirmez la région Canada Central et la revue d’hébergement avant activation.');
  // Connection-string SSL parameters must not override certificate validation.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])u.searchParams.delete(key);
 }
 const pool=new pg.Pool({connectionString:isolated?url:u.toString(),ssl:isolated?false:{rejectUnauthorized:true,...(env.EMPLOYEE_FILES_CA_PEM?{ca:env.EMPLOYEE_FILES_CA_PEM}:{})},options:'-c search_path=employee_files_private',max:3,connectionTimeoutMillis:5000});
 pool.on('error',()=>{});
 try{await pool.query('CREATE SCHEMA IF NOT EXISTS employee_files_private');}catch(error){await pool.end();throw error;}
 return {pool,status:{ready:true,region:isolated?'test-local':'ca-central-1',message:isolated?'Base fictive isolée.':'Coffre documentaire distinct · Canada Central. Le traitement par l’application Render reste couvert par l’EFVP.'}};
}
