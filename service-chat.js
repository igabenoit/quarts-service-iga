import express from 'express';
import {ensureChatGuests,isChatGuest} from './service-chat-guests.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const id=value=>{
  if(typeof value!=='string'||!/^[1-9]\d{0,17}$/.test(value))fail('Message invalide.');
  return value;
};
const fields=`id::text,author_key AS "authorKey",author_name AS "authorName",body,
  photo IS NOT NULL AS "hasPhoto",pinned,created_at AS "createdAt"`;
export function chatPayload(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Message invalide.');
  const body=typeof input.body==='string'?input.body.trim():'';
  if(body.length>4000)fail('Le message est limité à 4 000 caractères.');
  const requestId=input.requestId;
  if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))fail('Identifiant d’envoi invalide.');
  const photo=input.photo||null;
  if(photo!==null){
    if(typeof photo!=='string'||photo.length>2_800_000)fail('La photo doit faire au plus 2 Mo.');
    const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if(!match)fail('Utilise une photo JPEG, PNG ou WebP.');
    const bytes=Buffer.from(match[2],'base64');
    const valid=match[1]==='jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):
      match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid||bytes.length>2*1024*1024||bytes.toString('base64')!==match[2])fail('Photo invalide ou trop volumineuse.');
  }
  if(!body&&!photo)fail('Écris un message ou ajoute une photo.');
  return {body,photo,requestId};
}

export async function installServiceChat(app,pool,{employeePortal,managerAccess,sameOrigin,pushFactory}){
  await ensureChatGuests(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_messages(
    id BIGSERIAL PRIMARY KEY,author_key TEXT NOT NULL,author_name TEXT NOT NULL,
    request_id UUID NOT NULL,body TEXT NOT NULL CHECK(length(body)<=4000),photo TEXT,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(author_key,request_id));
    CREATE INDEX IF NOT EXISTS schedule_service_messages_author ON schedule_service_messages(author_key,created_at);
    CREATE TABLE IF NOT EXISTS schedule_service_reads(
    reader_key TEXT PRIMARY KEY,last_id BIGINT NOT NULL DEFAULT 0);`);
  const push=pushFactory?await pushFactory(pool):null;
  async function identity(req){
    const employee=req.query.mode==='manager'?null:await employeePortal.identity(req);
    if(employee){
      const member=(await pool.query(`SELECT 1 FROM schedule_store_people p
        LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
        WHERE p.id=ANY($1::bigint[]) AND (
          (e.active=TRUE AND e.departed_at IS NULL) OR
          (p.service_employee_id IS NULL AND p.active=TRUE AND EXISTS(
            SELECT 1 FROM schedule_store_memberships m JOIN schedule_leave_departments d ON d.id=m.department_id
            WHERE m.person_id=p.id AND d.code='service' AND d.active=TRUE))) LIMIT 1`,
      [employee.portalPersonIds||[employee.id]])).rows.length;
      if(!member&&!await isChatGuest(pool,employee.id))fail('La discussion est réservée à l’équipe du Service.',403);
      return {key:`employee:${employee.id}`,name:employee.name,manager:false};
    }
    const manager=await managerAccess.identity(req);
    if(!manager)fail('Connecte-toi avec ton code employé.',401);
    const service=(await pool.query("SELECT id FROM schedule_leave_departments WHERE code='service' AND active=TRUE")).rows[0];
    if(manager.kind!=='admin'&&!manager.departments.includes(Number(service?.id)))fail('Accès réservé aux gestionnaires du Service.',403);
    return {key:manager.kind==='admin'?'admin':`manager:${manager.id}`,name:manager.name,manager:true};
  }
  const auth=async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{req.chatUser=await identity(req);next();}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Discussion temporairement indisponible.'});}
  };
  const endpoint=fn=>async(req,res)=>{
    try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Impossible de charger ou enregistrer la discussion. Réessaie.'});}
  };
  const admin=async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{
      const manager=await managerAccess.identity(req);
      if(!manager)fail('Connexion administrateur requise.',401);
      if(manager.kind!=='admin')fail('Accès réservé à l’administration.',403);
      next();
    }catch(error){res.status(error.status||500).json({error:error.status?error.message:'Accès indisponible.'});}
  };
  app.get('/api/service-chat/guests',admin,endpoint(async(_req,res)=>{
    const people=(await pool.query(`SELECT p.id::text,p.name,g.expires_at AS "expiresAt"
      FROM schedule_store_people p LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
      LEFT JOIN schedule_service_chat_guests g ON g.person_id=p.id
      WHERE p.employee_code IS NOT NULL AND
      ((p.service_employee_id IS NULL AND p.active) OR (e.active AND e.departed_at IS NULL))
      ORDER BY p.name,p.id`)).rows;
    res.json({people});
  }));
  app.put('/api/service-chat/guests/:id',admin,sameOrigin,endpoint(async(req,res)=>{
    const personId=id(req.params.id);
    if(typeof req.body?.enabled!=='boolean')fail('Choisis si cet accès est autorisé.');
    if(req.body.enabled){
      const result=await pool.query(`INSERT INTO schedule_service_chat_guests(person_id,expires_at)
        SELECT p.id,clock_timestamp()+interval '7 days' FROM schedule_store_people p
        LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
        WHERE p.id=$1 AND p.employee_code IS NOT NULL AND
        ((p.service_employee_id IS NULL AND p.active) OR (e.active AND e.departed_at IS NULL))
        ON CONFLICT(person_id) DO UPDATE SET expires_at=excluded.expires_at RETURNING person_id`,[personId]);
      if(!result.rows.length)fail('Fiche active avec code personnel introuvable.',404);
    }else await pool.query('DELETE FROM schedule_service_chat_guests WHERE person_id=$1',[personId]);
    res.json({ok:true});
  }));
  push?.installRoutes(app,{auth,sameOrigin});
  app.get('/api/service-chat',auth,endpoint(async(req,res)=>{
    const unread=(await pool.query(`SELECT count(*)::int AS count FROM schedule_service_messages
      WHERE id>COALESCE((SELECT last_id FROM schedule_service_reads WHERE reader_key=$1),0) AND author_key<>$1`,[req.chatUser.key])).rows[0].count;
    res.json({user:req.chatUser,unread});
  }));
  app.get('/api/service-chat/messages',auth,endpoint(async(req,res)=>{
    if(req.query.before&&req.query.after)fail('Choisis une seule direction.');
    const before=req.query.before&&id(req.query.before),after=req.query.after&&id(req.query.after);
    const rows=(await pool.query(`SELECT ${fields} FROM schedule_service_messages
      ${before?'WHERE id<$1':after?'WHERE id>$1':''} ORDER BY schedule_service_messages.id ${after?'ASC':'DESC'} LIMIT 51`,before?[before]:after?[after]:[])).rows;
    const more=rows.length>50,messages=rows.slice(0,50);if(!after)messages.reverse();
    res.json({messages,more});
  }));
  app.get('/api/service-chat/pins',auth,endpoint(async(_req,res)=>{
    res.json({messages:(await pool.query(`SELECT ${fields} FROM schedule_service_messages WHERE pinned ORDER BY schedule_service_messages.id DESC LIMIT 10`)).rows});
  }));
  app.get('/api/service-chat/messages/:id/photo',auth,endpoint(async(req,res)=>{
    const row=(await pool.query('SELECT photo FROM schedule_service_messages WHERE id=$1',[id(req.params.id)])).rows[0];
    if(!row?.photo)fail('Photo introuvable.',404);
    const [header,encoded]=row.photo.split(',');
    res.set('Content-Type',header.slice(5,-7)).set('X-Content-Type-Options','nosniff').send(Buffer.from(encoded,'base64'));
  }));
  // Installed after the default JSON parser: this dedicated raw parser handles only image uploads.
  app.post('/api/service-chat/messages',auth,sameOrigin,express.text({type:'application/vnd.iga.chat+json',limit:'3mb'}),endpoint(async(req,res)=>{
    let input=req.body;
    if(typeof input==='string'){try{input=JSON.parse(input);}catch{fail('Message invalide.');}}
    const payload=chatPayload(input),client=await pool.connect();
    try{
      await client.query('BEGIN');
      // Commit in ID order so cursor polling cannot skip a slower concurrent sender.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('service-chat-messages'))");
      const existing=(await client.query(`SELECT ${fields},photo FROM schedule_service_messages WHERE author_key=$1 AND request_id=$2`,[req.chatUser.key,payload.requestId])).rows[0];
      if(existing){
        if(existing.body!==payload.body||existing.photo!==payload.photo)fail('Cet envoi a déjà été utilisé pour un autre message.',409);
        delete existing.photo;await client.query('COMMIT');return res.json(existing);
      }
      const recent=(await client.query("SELECT count(*)::int AS count FROM schedule_service_messages WHERE author_key=$1 AND created_at>clock_timestamp()-interval '1 minute'",[req.chatUser.key])).rows[0].count;
      if(recent>=20)fail('Trop de messages. Attends une minute avant de réessayer.',429);
      const row=(await client.query(`INSERT INTO schedule_service_messages(author_key,author_name,request_id,body,photo)
        VALUES($1,$2,$3,$4,$5) RETURNING ${fields}`,[req.chatUser.key,req.chatUser.name,payload.requestId,payload.body,payload.photo])).rows[0];
      if(push)await push.enqueue(client,row);
      await client.query('COMMIT');res.status(201).json(row);push?.kick();
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.post('/api/service-chat/read',auth,sameOrigin,endpoint(async(req,res)=>{
    const last=id(req.body?.lastId);
    if(!(await pool.query('SELECT 1 FROM schedule_service_messages WHERE id=$1',[last])).rows.length)fail('Message introuvable.',404);
    await pool.query(`INSERT INTO schedule_service_reads(reader_key,last_id) VALUES($1,$2)
      ON CONFLICT(reader_key) DO UPDATE SET last_id=GREATEST(schedule_service_reads.last_id,excluded.last_id)`,[req.chatUser.key,last]);
    res.json({ok:true});
  }));
  app.put('/api/service-chat/messages/:id/pin',auth,sameOrigin,endpoint(async(req,res)=>{
    if(!req.chatUser.manager)fail('Seuls les gestionnaires peuvent épingler une annonce.',403);
    if(typeof req.body?.pinned!=='boolean')fail('Choisis si le message doit être épinglé.');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('service-chat-pins'))");
      if(req.body.pinned&&(await client.query('SELECT count(*)::int AS count FROM schedule_service_messages WHERE pinned AND id<>$1',[id(req.params.id)])).rows[0].count>=10)fail('Retire une annonce avant d’en épingler une autre (maximum 10).');
      const row=(await client.query(`UPDATE schedule_service_messages SET pinned=$1 WHERE id=$2 RETURNING ${fields}`,[req.body.pinned,id(req.params.id)])).rows[0];
      if(!row)fail('Message introuvable.',404);
      await client.query('COMMIT');res.json(row);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  app.use('/api/service-chat',(error,_req,res,_next)=>res.status(error.type==='entity.too.large'?413:400).json({error:'Le message ou la photo est trop volumineux ou invalide.'}));
  push?.kick();
  return push;
}
