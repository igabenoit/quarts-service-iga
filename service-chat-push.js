import crypto from 'node:crypto';
import webpush from 'web-push';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function validateSubscription(value){
  let url;try{url=new URL(value?.endpoint);}catch{fail('Abonnement aux notifications invalide.');}
  const host=url.hostname;
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||url.href.length>2048||
    !(host==='fcm.googleapis.com'||host==='web.push.apple.com'||host==='updates.push.services.mozilla.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host)))
    fail('Service de notifications non pris en charge.');
  for(const [key,length] of [['p256dh',65],['auth',16]]){
    const encoded=value?.keys?.[key];
    if(typeof encoded!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)||Buffer.from(encoded,'base64url').length!==length)fail('Clé de notification invalide.');
  }
  if(Buffer.from(value.keys.p256dh,'base64url')[0]!==4)fail('Clé de notification invalide.');
  try{crypto.ECDH.convertKey(Buffer.from(value.keys.p256dh,'base64url'),'prime256v1');}catch{fail('Clé de notification invalide.');}
  return {endpoint:url.href,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
export function encryptPushKey(value,secret){
  const key=crypto.createHash('sha256').update('service-chat-vapid:'+secret).digest(),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function decryptPushKey(value,secret){
  const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64url'));
  const key=crypto.createHash('sha256').update('service-chat-vapid:'+secret).digest();
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}
const deviceCookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('service_push_device='))?.slice(20)||'';
const validDevice=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value);

export async function createServiceChatPush(pool,{secret,send=webpush.sendNotification.bind(webpush),subject='https://quarts-service-iga.onrender.com',startWorker=true}={}){
  if(!secret)throw Error('SESSION_SECRET requis pour les notifications.');
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_push_config(
    id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key_encrypted TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule_service_push_subscriptions(
    id UUID PRIMARY KEY,owner_key TEXT NOT NULL,credential_hash TEXT NOT NULL,endpoint_hash TEXT NOT NULL UNIQUE,
    subscription JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),last_test_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS schedule_service_push_owner ON schedule_service_push_subscriptions(owner_key);
    CREATE TABLE IF NOT EXISTS schedule_service_push_jobs(
    id BIGSERIAL PRIMARY KEY,subscription_id UUID NOT NULL REFERENCES schedule_service_push_subscriptions(id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL REFERENCES schedule_service_messages(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,due_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_until TIMESTAMPTZ,lease_token UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(subscription_id,message_id));
    CREATE INDEX IF NOT EXISTS schedule_service_push_due ON schedule_service_push_jobs(due_at);`);
  let config=(await pool.query('SELECT * FROM schedule_service_push_config WHERE id=1')).rows[0];
  if(!config){
    const keys=webpush.generateVAPIDKeys();
    await pool.query('INSERT INTO schedule_service_push_config(id,public_key,private_key_encrypted) VALUES(1,$1,$2) ON CONFLICT DO NOTHING',[keys.publicKey,encryptPushKey(keys.privateKey,secret)]);
    config=(await pool.query('SELECT * FROM schedule_service_push_config WHERE id=1')).rows[0];
  }
  const vapidDetails={subject,publicKey:config.public_key,privateKey:decryptPushKey(config.private_key_encrypted,secret)};
  const fingerprint=value=>crypto.createHmac('sha256',secret).update('service-push-credential:'+value).digest('hex');
  async function credential(owner){
    if(owner==='admin')return fingerprint('admin:'+process.env.MANAGER_CODE);
    const [kind,id]=owner.split(':');if(!/^\d+$/.test(id||''))return null;
    if(kind==='manager'){
      const row=(await pool.query(`SELECT a.version FROM schedule_manager_accounts a WHERE a.id=$1 AND a.active AND EXISTS(
        SELECT 1 FROM schedule_leave_departments d WHERE d.code='service' AND d.active AND a.departments @> to_jsonb(d.id))`,[id])).rows[0];
      return row?fingerprint(owner+':'+row.version):null;
    }
    if(kind!=='employee')return null;
    const row=(await pool.query(`SELECT p.employee_code FROM schedule_store_people p
      LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
      WHERE p.id=$1 AND p.employee_code IS NOT NULL AND
      ((p.service_employee_id IS NULL AND p.active) OR (e.active AND e.departed_at IS NULL))
      AND EXISTS(SELECT 1 FROM schedule_store_people m LEFT JOIN schedule_employees se ON se.id=m.service_employee_id
        WHERE (m.id=p.id OR (m.portal_person_id=p.id AND m.active AND m.service_employee_id IS NULL AND m.employee_code IS NULL))
        AND ((se.active AND se.departed_at IS NULL) OR (m.service_employee_id IS NULL AND m.active AND EXISTS(
          SELECT 1 FROM schedule_store_memberships sm JOIN schedule_leave_departments d ON d.id=sm.department_id
          WHERE sm.person_id=m.id AND d.code='service' AND d.active))))`,[id])).rows[0];
    return row?fingerprint(owner+':'+row.employee_code):null;
  }
  function cookie(res,id,maxAge=31536000){
    res.append('Set-Cookie',`service_push_device=${id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);
  }
  async function logout(req,res){
    const device=deviceCookie(req);
    if(validDevice(device))await pool.query('DELETE FROM schedule_service_push_subscriptions WHERE id=$1',[device]);
    cookie(res,'',0);
  }
  async function enqueue(client,message){
    await client.query(`INSERT INTO schedule_service_push_jobs(subscription_id,message_id)
      SELECT id,$1 FROM schedule_service_push_subscriptions WHERE owner_key<>$2 ON CONFLICT DO NOTHING`,[message.id,message.authorKey]);
  }
  const payload=(messageId,owner,test=false)=>JSON.stringify({
    title:test?'Notifications activées':'Discussion du Service',
    body:test?'Ce téléphone peut recevoir les notifications, même lorsque le site est fermé.':'Un nouveau message attend l’équipe du Service.',
    tag:test?'service-chat-test':'service-chat-'+messageId,
    url:owner.startsWith('employee:')?'/discussion':'/discussion?mode=manager'
  });
  let running=false,stopped=false;
  async function drain(){
    if(running||stopped)return;running=true;
    try{
      await pool.query("DELETE FROM schedule_service_push_jobs WHERE created_at<clock_timestamp()-interval '24 hours' OR attempts>=8");
      // Short leased batches prevent two instances from normally sending the same job.
      for(let batch=0;batch<10;batch++){
        const token=crypto.randomUUID();
        const jobs=(await pool.query(`UPDATE schedule_service_push_jobs SET lease_until=clock_timestamp()+interval '2 minutes',lease_token=$1,attempts=attempts+1
          WHERE id IN(SELECT id FROM schedule_service_push_jobs WHERE due_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`,[token])).rows;
        if(!jobs.length)break;
        await Promise.all(jobs.map(async job=>{
          const subscription=(await pool.query('SELECT * FROM schedule_service_push_subscriptions WHERE id=$1',[job.subscription_id])).rows[0];
          if(!subscription)return;
          try{
            if(await credential(subscription.owner_key)!==subscription.credential_hash){
              await pool.query('DELETE FROM schedule_service_push_subscriptions WHERE id=$1',[subscription.id]);return;
            }
            // Generic payload deliberately contains no employee name, message text or photo.
            const age=Math.floor((Date.now()-new Date(job.created_at).getTime())/1000);
            await send(subscription.subscription,payload(job.message_id,subscription.owner_key),{vapidDetails,TTL:Math.max(0,86400-age),urgency:'high',timeout:10000});
            await pool.query('DELETE FROM schedule_service_push_jobs WHERE id=$1 AND lease_token=$2',[job.id,token]);
          }catch(error){
            if(error.statusCode===404||error.statusCode===410){await pool.query('DELETE FROM schedule_service_push_subscriptions WHERE id=$1',[subscription.id]);return;}
            const delay=Math.min(3600,30*2**job.attempts);
            await pool.query("UPDATE schedule_service_push_jobs SET due_at=clock_timestamp()+$3*interval '1 second',lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",[job.id,token,delay]);
          }
        }));
      }
    }catch{console.error('Reprise des notifications du Service nécessaire.');}finally{running=false;}
  }
  function kick(){void drain();}
  function installRoutes(app,{auth,sameOrigin}){
    const endpoint=fn=>async(req,res)=>{
      try{await fn(req,res);}catch(error){res.status(error.status||503).json({error:error.status?error.message:'Notifications temporairement indisponibles. Réessaie.'});}
    };
    app.get('/api/service-chat/push',auth,endpoint(async(req,res)=>{
      const device=deviceCookie(req);
      const row=validDevice(device)?(await pool.query('SELECT owner_key,credential_hash FROM schedule_service_push_subscriptions WHERE id=$1',[device])).rows[0]:null;
      res.json({publicKey:vapidDetails.publicKey,enabled:!!row&&row.owner_key===req.chatUser.key&&row.credential_hash===await credential(req.chatUser.key)});
    }));
    app.post('/api/service-chat/push',auth,sameOrigin,endpoint(async(req,res)=>{
      const subscription=validateSubscription(req.body),owner=req.chatUser.key,credentialHash=await credential(owner);
      if(!credentialHash)fail('Cet accès au Service n’est plus actif.',403);
      const device=crypto.randomUUID(),endpointHash=hash(subscription.endpoint),client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('service-push-subscribe'))");
        const existing=(await client.query('SELECT subscription FROM schedule_service_push_subscriptions WHERE endpoint_hash=$1',[endpointHash])).rows[0];
        if(existing&&(existing.subscription.keys.auth!==subscription.keys.auth||existing.subscription.keys.p256dh!==subscription.keys.p256dh))fail('Abonnement différent. Désactive puis réactive les notifications.',409);
        await client.query('DELETE FROM schedule_service_push_subscriptions WHERE endpoint_hash=$1',[endpointHash]);
        const old=deviceCookie(req);if(validDevice(old))await client.query('DELETE FROM schedule_service_push_subscriptions WHERE id=$1',[old]);
        const count=(await client.query('SELECT count(*)::int AS count FROM schedule_service_push_subscriptions WHERE owner_key=$1',[owner])).rows[0].count;
        if(count>=10)fail('Maximum de 10 appareils atteint pour ce compte.');
        await client.query('INSERT INTO schedule_service_push_subscriptions(id,owner_key,credential_hash,endpoint_hash,subscription) VALUES($1,$2,$3,$4,$5)',[device,owner,credentialHash,endpointHash,JSON.stringify(subscription)]);
        await client.query('COMMIT');cookie(res,device);res.json({ok:true});
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }));
    app.delete('/api/service-chat/push',auth,sameOrigin,endpoint(async(req,res)=>{
      // The HttpOnly device token is a capability scoped to this browser, not an arbitrary endpoint.
      await logout(req,res);res.json({ok:true});
    }));
    app.post('/api/service-chat/push/test',auth,sameOrigin,endpoint(async(req,res)=>{
      const device=deviceCookie(req);if(!validDevice(device))fail('Active les notifications sur cet appareil.');
      const row=(await pool.query(`UPDATE schedule_service_push_subscriptions SET last_test_at=clock_timestamp()
        WHERE id=$1 AND owner_key=$2 AND (last_test_at IS NULL OR last_test_at<clock_timestamp()-interval '1 minute') RETURNING *`,[device,req.chatUser.key])).rows[0];
      if(!row)fail('Active les notifications, ou attends une minute avant un nouveau test.',429);
      if(row.credential_hash!==await credential(req.chatUser.key))fail('Réactive les notifications avec ton accès actuel.',403);
      try{await send(row.subscription,payload('test',row.owner_key,true),{vapidDetails,TTL:300,urgency:'high',timeout:10000});}
      catch(error){
        if(error.statusCode===404||error.statusCode===410){await pool.query('DELETE FROM schedule_service_push_subscriptions WHERE id=$1',[device]);fail('Abonnement expiré. Réactive les notifications.',410);}
        throw error;
      }
      res.json({ok:true});
    }));
  }
  const timer=startWorker?setInterval(kick,30000):null;timer?.unref();
  return {enqueue,kick,drain,installRoutes,logout,credential,publicKey:vapidDetails.publicKey,stop(){stopped=true;if(timer)clearInterval(timer);}};
}
