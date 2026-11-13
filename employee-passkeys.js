import {needsSchema} from './preview-schema.js';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {token,digest,fail,activePerson,transaction,installPasskeySchema,invite,log,requireMatricule} from './passkey-store.js';

const endpoint=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Connexion indisponible. Réessayez ou communiquez avec la direction.'});}};
const cookie=(req,name)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
const validToken=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const personId=v=>{if(!Number.isSafeInteger(v)||v<1)fail('Fiche invalide.');return v;};
function topLevel(response){try{const d=JSON.parse(Buffer.from(response.response.clientDataJSON,'base64url').toString());if(d.crossOrigin===true||d.topOrigin)throw Error();}catch{fail('Ouvrez le portail directement dans votre navigateur.');}}
export async function installEmployeePasskeys(app,pool,{requireManager}){
  if (needsSchema(pool)) await installPasskeySchema(pool);
  const mode=process.env.EMPLOYEE_PASSKEY_MODE||'off';
  if(!['off','pilot','required'].includes(mode))throw Error('Invalid EMPLOYEE_PASSKEY_MODE');
  const enabled=mode!=='off',origin=process.env.EMPLOYEE_PASSKEY_ORIGIN||'';
  let rpID;
  if(enabled){
    const u=new URL(origin);rpID=u.hostname;
    if(u.origin!==origin||u.username||u.password||u.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(rpID)))throw Error('A canonical HTTPS EMPLOYEE_PASSKEY_ORIGIN is required');
  }
  const admins=(process.env.EMPLOYEE_PASSKEY_ADMIN_IDS||'').split(',').filter(Boolean).map(v=>Number(v.trim()));
  if(admins.some(v=>!Number.isSafeInteger(v)||v<=0))throw Error('Invalid EMPLOYEE_PASSKEY_ADMIN_IDS');
  const setCookie=(res,name,value,age)=>res.append('Set-Cookie',`${name}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`);
  function checkOrigin(req,res,next){
    if(!enabled)return res.status(503).json({error:'Les clés d’accès ne sont pas encore activées.'});
    if(req.headers.origin!==origin||req.headers['x-passkey-request']!=='1'||!req.is('application/json'))return res.status(403).json({error:'Requête refusée.'});
    res.set('Cache-Control','no-store');next();
  }
  async function rate(req){
    const bucket=crypto.createHmac('sha256',process.env.SESSION_SECRET).update('passkey-ip:'+req.ip).digest('hex');
    const r=(await pool.query(`INSERT INTO schedule_passkey_limits(bucket,count,expires_at) VALUES($1,1,clock_timestamp()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN schedule_passkey_limits.expires_at<clock_timestamp() THEN 1 ELSE schedule_passkey_limits.count+1 END,
      expires_at=CASE WHEN schedule_passkey_limits.expires_at<clock_timestamp() THEN clock_timestamp()+interval '15 minutes' ELSE schedule_passkey_limits.expires_at END RETURNING count`,[bucket])).rows[0];
    if(r.count>300)fail('Trop d’essais. Réessayez dans 15 minutes.',429);
    await pool.query('DELETE FROM schedule_passkey_limits WHERE expires_at<clock_timestamp()');
  }
  async function flow(res,kind,challenge,invitationHash=null,shared=false){
    const secret=token();
    await pool.query('DELETE FROM schedule_passkey_flows WHERE expires_at<clock_timestamp()');
    await pool.query('DELETE FROM schedule_passkey_sessions WHERE expires_at<clock_timestamp()');
    await pool.query('INSERT INTO schedule_passkey_flows(hash,kind,challenge,invitation_hash,shared) VALUES($1,$2,$3,$4,$5)',[digest(secret),kind,challenge,invitationHash,shared]);
    setCookie(res,'passkey_flow',secret,300);
  }
  async function consume(req,res,kind){
    const secret=cookie(req,'passkey_flow');setCookie(res,'passkey_flow','',0);
    if(!validToken(secret))fail('Cette demande a expiré. Recommencez.',400);
    // Consume before verification, including failures. Parallel requests cannot reuse a challenge.
    const row=(await pool.query('DELETE FROM schedule_passkey_flows WHERE hash=$1 AND kind=$2 AND expires_at>clock_timestamp() RETURNING *',[digest(secret),kind])).rows[0];
    if(!row)fail('Cette demande a expiré ou a déjà été utilisée. Recommencez.');return row;
  }
  async function readInvitation(c,hash,lock=false){
    const inv=(await c.query('SELECT * FROM schedule_passkey_invitations WHERE hash=$1 AND used_at IS NULL AND expires_at>clock_timestamp()',[hash])).rows[0];
    if(!inv)fail('Lien expiré ou déjà utilisé. Demandez un nouveau lien à la direction.');
    const p=(await c.query(activePerson+' AND p.id=$1'+(lock?' FOR UPDATE OF p':''),[inv.person_id])).rows[0];
    const fresh=(await c.query('SELECT * FROM schedule_passkey_invitations WHERE hash=$1 AND used_at IS NULL AND expires_at>clock_timestamp()',[hash])).rows[0];
    if(!p||!fresh||p.access_version!==inv.access_version)fail('Lien expiré ou accès retiré.');
    if(fresh.add_device&&!(await c.query('SELECT id FROM schedule_passkey_credentials WHERE id=$1 AND person_id=$2 AND revoked_at IS NULL',[fresh.authorized_credential_id,p.id])).rows.length)fail('La clé ayant autorisé cet appareil n’est plus active.');
    await requireMatricule(c,p);return {...p,addingDevice:fresh.add_device};
  }
  async function createSession(c,p,key,shared){
    const secret=token(),seconds=shared?1800:43200;
    await c.query(`INSERT INTO schedule_passkey_sessions(hash,person_id,credential_id,access_version,shared,expires_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 second')`,[digest(secret),p.id,key,p.access_version,shared,seconds]);
    return {secret,seconds};
  }
  function sessionCookie(res,s){setCookie(res,'employee_portal','pk_'+s.secret,s.seconds);}
  async function sessionIdentity(req){
    const value=cookie(req,'employee_portal');if(!value.startsWith('pk_')||!validToken(value.slice(3)))return null;
    const row=(await pool.query(`SELECT s.person_id,s.created_at,s.shared,s.credential_id FROM schedule_passkey_sessions s,
      schedule_store_people p,schedule_passkey_credentials k
      WHERE s.hash=$1 AND p.id=s.person_id AND k.id=s.credential_id AND k.revoked_at IS NULL
      AND p.access_version=s.access_version AND s.expires_at>clock_timestamp()
      AND s.last_seen_at>clock_timestamp()-(CASE WHEN s.shared THEN interval '5 minutes' ELSE interval '2 hours' END)`,[digest(value.slice(3))])).rows[0];
    if(!row)return null;
    const p=(await pool.query(activePerson+' AND p.id=$1',[row.person_id])).rows[0];
    return p?{...p,authentication:'passkey',authenticatedAt:row.created_at,sharedDevice:row.shared,credentialId:row.credential_id}:null;
  }
  async function directionIdentity(req){
    if(!enabled)return null;
    const p=await sessionIdentity(req);
    return p&&admins.includes(Number(p.id))?{kind:'admin',id:Number(p.id),personId:Number(p.id),name:p.name,authentication:'passkey'}:null;
  }
  async function logout(req,res){
    const secret=cookie(req,'employee_portal');
    if(secret.startsWith('pk_')&&validToken(secret.slice(3)))await pool.query('DELETE FROM schedule_passkey_sessions WHERE hash=$1',[digest(secret.slice(3))]);
    setCookie(res,'employee_portal','',0);
  }
  async function blocksLegacy(id){
    if(mode==='required')return true;
    // Never silently downgrade enrolled people when the feature switch is turned off.
    return Boolean((await pool.query('SELECT required FROM schedule_passkey_users WHERE person_id=$1',[id])).rows[0]?.required);
  }
  const admin=async(req,res,next)=>{
    try{
      if(!enabled)fail('Les clés d’accès ne sont pas encore activées.',503);
      const p=await sessionIdentity(req);
      if(req.manager?.kind!=='admin'||!p||!admins.includes(Number(p.id)))fail('Accès réservé à une personne de la direction désignée, connectée avec sa clé d’accès et son accès administrateur.',403);
      if(Date.now()-new Date(p.authenticatedAt).getTime()>300000)fail('Confirmez de nouveau votre clé d’accès avant de gérer les accès.',401);
      req.passkeyAdmin=p;res.set('Cache-Control','no-store');next();
    }catch(e){res.status(e.status||503).json({error:e.status?e.message:'Accès indisponible.'});}
  };
  app.get('/api/employee-passkeys/config',(_req,res)=>res.set('Cache-Control','no-store').json({enabled,required:mode==='required',directionRequired:process.env.NODE_ENV==='production'||process.env.DIRECTION_PASSKEY_REQUIRED==='yes'}));
  app.get('/api/employee-passkeys/session',endpoint(async(req,res)=>{const p=await sessionIdentity(req);res.json({authenticated:Boolean(p),shared:p?.sharedDevice||false});}));
  app.post('/api/employee-passkeys/activity',checkOrigin,endpoint(async(req,res)=>{
    const p=await sessionIdentity(req);if(!p)fail('Session expirée.',401);
    await pool.query('UPDATE schedule_passkey_sessions SET last_seen_at=clock_timestamp() WHERE hash=$1',[digest(cookie(req,'employee_portal').slice(3))]);res.json({ok:true});
  }));
  if (!process.env.VERCEL) app.get('/vendor/simplewebauthn.js',(_req,res)=>res.sendFile(fileURLToPath(new URL('./node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js',import.meta.url))));
  app.post('/api/employee-passkeys/register/options',checkOrigin,endpoint(async(req,res)=>{
    await rate(req);if(!validToken(req.body?.token))fail('Lien invalide.');
    if(req.body.shared===true)fail('Créez la clé sur votre appareil personnel ou avec votre clé de sécurité individuelle.');
    const hash=digest(req.body.token),p=await readInvitation(pool,hash),user=(await pool.query('SELECT handle FROM schedule_passkey_users WHERE person_id=$1',[p.id])).rows[0];
    const existing=(await pool.query('SELECT id,transports FROM schedule_passkey_credentials WHERE person_id=$1',[p.id])).rows;
    const options=await generateRegistrationOptions({rpName:'IGA Extra Famille Benoit',rpID,userName:p.name,userDisplayName:p.name,userID:Buffer.from(user.handle,'base64url'),attestationType:'none',excludeCredentials:existing,authenticatorSelection:{residentKey:'required',userVerification:'required'},supportedAlgorithmIDs:[-7,-257]});
    await flow(res,'register',options.challenge,hash);res.json(options);
  }));
  app.post('/api/employee-passkeys/register/verify',checkOrigin,endpoint(async(req,res)=>{
    await rate(req);const f=await consume(req,res,'register');
    topLevel(req.body.response);
    let result;try{result=await verifyRegistrationResponse({response:req.body.response,expectedChallenge:f.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,requireUserPresence:true,supportedAlgorithmIDs:[-7,-257]});}catch{fail('La clé n’a pas pu être vérifiée. Recommencez.');}
    if(!result.verified)fail('La clé n’a pas pu être vérifiée.');
    const s=await transaction(pool,async c=>{
      const p=await readInvitation(c,f.invitation_hash,true),info=result.registrationInfo,k=info.credential;
      if((await c.query('SELECT id FROM schedule_passkey_credentials WHERE id=$1',[k.id])).rows.length)fail('Cette clé est déjà enregistrée.');
      await c.query('INSERT INTO schedule_passkey_credentials(id,person_id,public_key,counter,transports,device_type,backed_up) VALUES($1,$2,$3,$4,$5,$6,$7)',[k.id,p.id,Buffer.from(k.publicKey),k.counter,JSON.stringify((k.transports||[]).filter(t=>['internal','usb','nfc','ble','hybrid','smart-card'].includes(t))),info.credentialDeviceType,info.credentialBackedUp]);
      await c.query('UPDATE schedule_passkey_invitations SET used_at=clock_timestamp() WHERE hash=$1',[f.invitation_hash]);
      await c.query('UPDATE schedule_passkey_users SET required=TRUE WHERE person_id=$1',[p.id]);
      if(!p.addingDevice){
        await c.query('UPDATE schedule_store_people SET access_version=access_version+1 WHERE id=$1',[p.id]);p.access_version++;
        await c.query('DELETE FROM schedule_passkey_sessions WHERE person_id=$1',[p.id]);
      }
      await log(c,p.id,'employee:'+p.id,p.addingDevice?'additional_device_registered':'key_registered');return createSession(c,p,k.id,false);
    });sessionCookie(res,s);res.json({ok:true});
  }));
  app.post('/api/employee-passkeys/authenticate/options',checkOrigin,endpoint(async(req,res)=>{
    await rate(req);if(typeof req.body?.shared!=='boolean')fail('Choisissez le type d’appareil.');
    const options=await generateAuthenticationOptions({rpID,userVerification:'required'});
    await flow(res,'authenticate',options.challenge,null,req.body.shared);res.json(options);
  }));
  app.post('/api/employee-passkeys/authenticate/verify',checkOrigin,endpoint(async(req,res)=>{
    await rate(req);const f=await consume(req,res,'authenticate'),r=req.body?.response;
    if(typeof r?.id!=='string'||r.id.length>2048)fail('Connexion refusée.');
    topLevel(r);
    const s=await transaction(pool,async c=>{
      const initial=(await c.query('SELECT person_id FROM schedule_passkey_credentials WHERE id=$1',[r.id])).rows[0];if(!initial)fail('Connexion refusée.');
      const p=(await c.query(activePerson+' AND p.id=$1 FOR UPDATE OF p',[initial.person_id])).rows[0];
      const k=(await c.query('SELECT k.*,u.handle FROM schedule_passkey_credentials k JOIN schedule_passkey_users u ON u.person_id=k.person_id WHERE k.id=$1 AND k.revoked_at IS NULL',[r.id])).rows[0];
      if(!p||!k||r.response?.userHandle!==k.handle)fail('Connexion refusée.');
      let result;try{result=await verifyAuthenticationResponse({response:r,expectedChallenge:f.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:k.id,publicKey:new Uint8Array(k.public_key),counter:Number(k.counter),transports:k.transports}});}catch{fail('La clé n’a pas pu être vérifiée. Recommencez.');}
      if(!result.verified)fail('Connexion refusée.');
      await c.query('UPDATE schedule_passkey_credentials SET counter=$1,backed_up=$2 WHERE id=$3',[result.authenticationInfo.newCounter,result.authenticationInfo.credentialBackedUp,k.id]);
      await log(c,p.id,'employee:'+p.id,'authenticated');return createSession(c,p,k.id,f.shared);
    });sessionCookie(res,s);res.json({ok:true,shared:f.shared});
  }));
  app.get('/api/employee-passkeys/admin',requireManager,admin,endpoint(async(req,res)=>{
    const people=(await pool.query(`SELECT p.id,p.name,p.employee_code AS matricule,
      COALESCE(u.required,FALSE) AS required,
      (SELECT count(*)::int FROM schedule_passkey_credentials k WHERE k.person_id=p.id AND k.revoked_at IS NULL) AS keys,
      (SELECT expires_at FROM schedule_passkey_invitations i WHERE i.person_id=p.id AND i.used_at IS NULL AND i.expires_at>clock_timestamp() LIMIT 1) AS invitation
      FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id LEFT JOIN schedule_passkey_users u ON u.person_id=p.id
      WHERE p.id IN (SELECT id FROM (${activePerson}) active_people) ORDER BY p.name,p.id`)).rows;
    res.json({people,currentPerson:{id:Number(req.passkeyAdmin.id),name:req.passkeyAdmin.name}});
  }));
  app.post('/api/employee-passkeys/admin/invitations',requireManager,checkOrigin,admin,endpoint(async(req,res)=>{
    const b=req.body, id=personId(b?.personId);
    if(b.identityConfirmed!==true||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>500||typeof b.recover!=='boolean')fail('Confirmez l’identité en personne et indiquez le motif (10 à 500 caractères).');
    if(b.recover&&id===Number(req.passkeyAdmin.id))fail('Votre propre récupération doit être effectuée par une autre personne désignée ou par la procédure de reprise contrôlée.');
    const secret=await transaction(pool,c=>invite(c,{personId:id,actor:'direction:'+req.passkeyAdmin.id,reason:b.reason.trim(),recover:b.recover}));
    res.json({url:origin+'/connexion-employe#activation='+secret,expiresInMinutes:15});
  }));
  app.post('/api/employee-passkeys/admin/my-device',requireManager,checkOrigin,admin,endpoint(async(req,res)=>{
    await rate(req);
    // Derive the target and authorizing credential from the verified session, never the body.
    const p=req.passkeyAdmin;
    const secret=await transaction(pool,c=>invite(c,{personId:Number(p.id),actor:'direction:'+p.id,reason:'Ajout de mon appareil personnel après confirmation de ma clé existante',addDevice:true,authorizedCredentialId:p.credentialId}));
    const url=origin+'/connexion-employe?retour=%2Fhoraires-departements%3Fvue%3Dmagasin#activation='+secret;
    // Encode locally; the bearer link is never sent to an external QR provider.
    res.json({url,qr:await QRCode.toDataURL(url,{width:320,margin:4,errorCorrectionLevel:'M'}),expiresInMinutes:15});
  }));
  return {sessionIdentity,blocksLegacy,directionIdentity,logout};
}
