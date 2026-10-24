import {chatPayload} from './service-chat.js';
import {activeManagerSQL} from './employee-access.js';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const validId=value=>/^[1-9]\d{0,17}$/.test(String(value||''));
const fields=`id::text,author_key AS "authorKey",author_name AS "authorName",recipient_key AS "recipientKey",body,
  created_at AS "createdAt",leave_request_id::text AS "leaveId",reply_to::text AS "replyTo"`;

export async function installPrivateChat(app,pool,{auth,sameOrigin,endpoint,push}){
  // Directory uses the same canonical identities and Service membership as chat authentication.
  async function people(db=pool){
    const employees=(await db.query(`SELECT 'employee:'||p.id AS key,p.name FROM schedule_store_people p
      LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
      WHERE p.employee_code IS NOT NULL AND ((p.service_employee_id IS NULL AND p.active) OR (e.active AND e.departed_at IS NULL))
      AND (EXISTS(SELECT 1 FROM schedule_service_chat_guests g WHERE g.person_id=p.id AND g.expires_at>clock_timestamp())
      OR EXISTS(SELECT 1 FROM schedule_store_people m LEFT JOIN schedule_employees se ON se.id=m.service_employee_id
        WHERE (m.id=p.id OR (m.portal_person_id=p.id AND m.active AND m.service_employee_id IS NULL AND m.employee_code IS NULL))
        AND ((se.active AND se.departed_at IS NULL) OR (m.service_employee_id IS NULL AND m.active AND EXISTS(
          SELECT 1 FROM schedule_store_memberships sm JOIN schedule_leave_departments d ON d.id=sm.department_id
          WHERE sm.person_id=m.id AND d.code='service' AND d.active))))) ORDER BY p.name,p.id`)).rows;
    const managers=(await db.query(`SELECT 'manager:'||a.id AS key,a.name FROM schedule_manager_accounts a
      WHERE a.active AND ${activeManagerSQL()} AND EXISTS(SELECT 1 FROM schedule_leave_departments d WHERE d.code='service' AND d.active AND a.departments @> to_jsonb(d.id)) ORDER BY a.name`)).rows;
    return [...employees,...managers,{key:'admin',name:'Administration'}];
  }
  app.get('/api/service-chat/private',auth,endpoint(async(req,res)=>{
    const contacts=(await people()).filter(p=>p.key!==req.chatUser.key);
    const unread=(await pool.query(`SELECT author_key AS key,count(*)::int AS count FROM schedule_service_private_messages m
      WHERE recipient_key=$1 AND id>COALESCE((SELECT last_id FROM schedule_service_private_reads WHERE reader_key=$1 AND peer_key=m.author_key),0)
      GROUP BY author_key`,[req.chatUser.key])).rows;
    const questions=(await pool.query(`SELECT ${fields} FROM schedule_service_private_messages m WHERE recipient_key=$1 AND leave_request_id IS NOT NULL AND reply_to IS NULL
      AND NOT EXISTS(SELECT 1 FROM schedule_service_private_messages r WHERE r.reply_to=m.id AND r.author_key=$1) ORDER BY id`,[req.chatUser.key])).rows;
    res.json({contacts:contacts.map(p=>({...p,unread:unread.find(u=>u.key===p.key)?.count||0})),questions});
  }));
  app.get('/api/service-chat/private/messages',auth,endpoint(async(req,res)=>{
    const peer=req.query.peer;
    if(typeof peer!=='string'||peer.length>80)fail('Choisis une personne.');
    if(req.query.before&&!validId(req.query.before))fail('Message invalide.');
    const messages=(await pool.query(`SELECT ${fields} FROM schedule_service_private_messages
      WHERE ((author_key=$1 AND recipient_key=$2) OR (author_key=$2 AND recipient_key=$1))
      AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT 51`,[req.chatUser.key,peer,req.query.before||null])).rows;
    res.json({messages:messages.slice(0,50).reverse(),more:messages.length>50});
  }));
  app.post('/api/service-chat/private/read',auth,sameOrigin,endpoint(async(req,res)=>{
    if(!validId(req.body?.lastId))fail('Message invalide.');
    const row=(await pool.query('SELECT author_key FROM schedule_service_private_messages WHERE id=$1 AND recipient_key=$2',[req.body.lastId,req.chatUser.key])).rows[0];
    if(!row)fail('Message introuvable.',404);
    await pool.query(`INSERT INTO schedule_service_private_reads(reader_key,peer_key,last_id) VALUES($1,$2,$3)
      ON CONFLICT(reader_key,peer_key) DO UPDATE SET last_id=GREATEST(schedule_service_private_reads.last_id,excluded.last_id)`,[req.chatUser.key,row.author_key,req.body.lastId]);
    res.json({ok:true});
  }));
  app.post('/api/service-chat/private/messages',auth,sameOrigin,endpoint(async(req,res)=>{
    const payload=chatPayload(req.body);
    if(payload.photo||!payload.body)fail('Écris un message texte.');
    let peer=req.body.peer,leaveId=null,replyTo=null;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('service-chat-messages'))");
      if(req.body.leaveId){
        if(!req.chatUser.manager)fail('Accès gestionnaire requis.',403);
        if(!validId(req.body.leaveId))fail('Demande invalide.');
        const leave=(await client.query(`SELECT r.* FROM schedule_leave_requests r JOIN schedule_leave_departments d ON d.id=r.department_id
          WHERE r.id=$1 AND d.code='service' AND NOT r.is_test AND r.archived_at IS NULL FOR SHARE OF r`,[req.body.leaveId])).rows[0];
        if(!leave)fail('Demande du Service introuvable.',404);
        const employeeId=leave.employee_id||req.body.employeeId;
        if(!validId(employeeId))fail('Choisis l’employé après vérification de son nom.');
        const person=(await client.query(`SELECT COALESCE(portal_person_id,id)::text AS id FROM schedule_store_people WHERE service_employee_id=$1`,[employeeId])).rows[0];
        if(!person)fail('Cet employé n’a pas encore de compte dans le chat. Utilise le courriel.');
        peer='employee:'+person.id;leaveId=String(leave.id);
      }
      if(req.body.replyTo){
        if(!validId(req.body.replyTo)||leaveId)fail('Réponse invalide.');
        const question=(await client.query(`SELECT * FROM schedule_service_private_messages WHERE id=$1 AND recipient_key=$2 AND leave_request_id IS NOT NULL AND reply_to IS NULL`,[req.body.replyTo,req.chatUser.key])).rows[0];
        if(!question)fail('Question introuvable.',404);
        peer=question.author_key;leaveId=String(question.leave_request_id);replyTo=String(question.id);
      }
      if(peer===req.chatUser.key||!(await people(client)).some(p=>p.key===peer))fail('Destinataire indisponible. Utilise le courriel.');
      const existing=(await client.query(`SELECT ${fields} FROM schedule_service_private_messages WHERE author_key=$1 AND request_id=$2`,[req.chatUser.key,payload.requestId])).rows[0];
      if(existing){
        if(existing.body!==payload.body||existing.recipientKey!==peer||existing.leaveId!==leaveId||existing.replyTo!==replyTo)fail('Cet envoi a déjà été utilisé.',409);
        await client.query('COMMIT');return res.json(existing);
      }
      const recent=(await client.query("SELECT count(*)::int AS n FROM schedule_service_private_messages WHERE author_key=$1 AND created_at>clock_timestamp()-interval '1 minute'",[req.chatUser.key])).rows[0].n;
      if(recent>=20)fail('Trop de messages. Attends une minute.',429);
      const row=(await client.query(`INSERT INTO schedule_service_private_messages(author_key,author_name,request_id,body,recipient_key,leave_request_id,reply_to)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${fields}`,[req.chatUser.key,req.chatUser.name,payload.requestId,payload.body,peer,leaveId,replyTo])).rows[0];
      if(push)await push.enqueue(client,row);
      await client.query('COMMIT');push?.kick();res.status(201).json(row);
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
}
