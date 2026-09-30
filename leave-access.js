import crypto from 'node:crypto';

export async function installLeaveAccess(app,pool,{requireManager,sameOrigin}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_access (
    id INTEGER PRIMARY KEY CHECK(id=1), code_hash TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO schedule_leave_access(id,code_hash)
    VALUES(1,COALESCE((SELECT access_code_hash FROM schedule_public_links ORDER BY created_at DESC LIMIT 1),''))
    ON CONFLICT DO NOTHING;`);
  const sign=v=>crypto.createHmac('sha256',process.env.SESSION_SECRET).update(v).digest('base64url');
  const codeHash=v=>crypto.createHmac('sha256',process.env.SESSION_SECRET).update(`staff-code:${v}`).digest('hex');
  const equal=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
  const current=async()=> (await pool.query('SELECT code_hash FROM schedule_leave_access WHERE id=1')).rows[0].code_hash;
  const attempts=new Map();
  async function requireStaff(req,res,next){
    try{
      const stored=await current();
      if(!stored)return res.status(503).json({error:'Le formulaire permanent attend son code d’accès. Veuillez contacter la gérante.'});
      const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('leave_access='))?.slice(13)||'';
      const [expires,signature]=cookie.split('.');
      if(!/^\d{13}$/.test(expires)||Number(expires)<=Date.now()||!signature||!equal(signature,sign(`leave-access:${stored}:${expires}`)))return res.status(401).json({error:'Entrez le code commun des employés pour remplir votre demande.'});
      next();
    }catch{res.status(500).json({error:'Impossible de vérifier l’accès.'});}
  }
  app.get('/api/leave/access-settings',requireManager,async(_req,res)=>res.json({path:'/conges',configured:Boolean(await current())}));
  app.put('/api/leave/access-settings',requireManager,sameOrigin,async(req,res)=>{
    const code=String(req.body?.code||'').trim();
    if(!/^\d{6,12}$/.test(code))return res.status(400).json({error:'Choisissez un code de 6 à 12 chiffres.'});
    await pool.query('UPDATE schedule_leave_access SET code_hash=$1 WHERE id=1',[codeHash(code)]);
    res.json({ok:true,path:'/conges'});
  });
  app.post('/api/leave/access',sameOrigin,async(req,res)=>{
    const now=Date.now(),key=req.ip||'unknown';
    for(const [ip,entry] of attempts)if(now-entry.since>900000)attempts.delete(ip);
    const entry=attempts.get(key)||{count:0,since:now};
    if(entry.count>=15)return res.status(429).json({error:'Trop d’essais. Réessayez dans 15 minutes.'});
    const stored=await current();
    if(!stored)return res.status(503).json({error:'Le code d’accès doit d’abord être configuré par la gérante.'});
    const code=String(req.body?.code||'').trim();
    if(!/^\d{6,12}$/.test(code)||!equal(codeHash(code),stored)){entry.count++;attempts.set(key,entry);return res.status(401).json({error:'Code incorrect.'});}
    attempts.delete(key);const expires=now+30*24*60*60*1000;
    res.setHeader('Set-Cookie',`leave_access=${expires}.${sign(`leave-access:${stored}:${expires}`)}; Path=/api/leave; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);
    res.json({ok:true});
  });
  app.get('/conges',(_req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile('conges.html',{root:'public'}));
  return requireStaff;
}
