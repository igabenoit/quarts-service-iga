// Run once from a trusted administrative terminal, after in-person identity verification.
// No public bootstrap route; no email or SMS is sent. Link is printed once to the operator.
import pg from 'pg';
import {invite,transaction} from '../passkey-store.js';
const [person,flag,...reasonParts]=process.argv.slice(2),id=Number(person),reason=reasonParts.join(' ');
const designated=(process.env.EMPLOYEE_PASSKEY_ADMIN_IDS||'').split(',').map(Number);
if(!Number.isSafeInteger(id)||!designated.includes(id)||flag!=='--verified-in-person'||reason.length<10||reason.length>500)throw Error('Usage: node scripts/bootstrap-passkey.mjs PERSON_ID --verified-in-person "Motif vérifié". The person must be explicitly designated in EMPLOYEE_PASSKEY_ADMIN_IDS.');
const url=new URL(process.env.DATABASE_URL),origin=new URL(process.env.EMPLOYEE_PASSKEY_ORIGIN);
if(origin.protocol!=='https:')throw Error('Canonical HTTPS origin required.');
for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(key);
const pool=new pg.Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,...(process.env.DATABASE_CA_PEM?{ca:process.env.DATABASE_CA_PEM}:{})},max:1});
try{
  const secret=await transaction(pool,async c=>{
    if((await c.query('SELECT id FROM schedule_passkey_credentials WHERE person_id=$1',[id])).rows.length)throw Error('Bootstrap is only for the first direction key. Existing accounts require the documented recovery process.');
    return invite(c,{personId:id,actor:'bootstrap:direction:'+id,reason,recover:false});
  });
  console.log('One-use link; hand directly to the verified person; expires in 15 minutes:');
  console.log(origin.origin+'/connexion-employe?retour=%2Fcles-employes#activation='+secret);
}finally{await pool.end();}
