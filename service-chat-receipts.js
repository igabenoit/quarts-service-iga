const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function messageIds(value){
  if(!Array.isArray(value)||!value.length||value.length>50||value.some(id=>typeof id!=='string'||!/^[1-9]\d{0,17}$/.test(id)))fail('Messages invalides (maximum 50).');
  return [...new Set(value)];
}

export async function installChatReceipts(app,pool,{auth,sameOrigin,endpoint}){
  // Table names are fixed here, never supplied by a request.
  for(const privateChat of [false,true]){
    const messages=privateChat?'schedule_service_private_messages':'schedule_service_messages';
    const views=privateChat?'schedule_service_private_views':'schedule_service_message_views';
    const path='/api/service-chat'+(privateChat?'/private':'')+'/views';
    await pool.query(`CREATE TABLE IF NOT EXISTS ${views}(
      message_id BIGINT NOT NULL REFERENCES ${messages}(id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,viewer_name TEXT NOT NULL,viewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(message_id,viewer_key));`);
    app.post(path,auth,sameOrigin,endpoint(async(req,res)=>{
      const ids=messageIds(req.body?.messageIds),user=req.chatUser;
      const available=(await pool.query(`SELECT id FROM ${messages} WHERE id=ANY($1::bigint[])${privateChat?' AND recipient_key=$2':''}`,
        privateChat?[ids,user.key]:[ids])).rows;
      if(available.length!==ids.length)fail('Message introuvable.',404);
      // Only actual visible messages are submitted; unread cursors are not read receipts.
      await pool.query(`INSERT INTO ${views}(message_id,viewer_key,viewer_name)
        SELECT id,$3,$4 FROM ${messages} WHERE id=ANY($1::bigint[]) AND author_key<>$2${privateChat?' AND recipient_key=$2':''}
        ON CONFLICT(message_id,viewer_key) DO NOTHING`,[ids,user.key,user.personId?'person:'+user.personId:user.key,user.name]);
      res.json({ok:true});
    }));
    app.get(path,auth,endpoint(async(req,res)=>{
      if(!req.chatUser.manager)fail('Consultations réservées aux gestionnaires.',403);
      const ids=messageIds(typeof req.query.messageIds==='string'?req.query.messageIds.split(','):null);
      const own=(await pool.query(`SELECT id FROM ${messages} WHERE id=ANY($1::bigint[]) AND author_key=$2`,[ids,req.chatUser.key])).rows;
      if(own.length!==ids.length)fail('Consultations disponibles seulement pour vos propres messages.',404);
      const rows=(await pool.query(`SELECT message_id::text AS id,viewer_name AS name,viewed_at AS "viewedAt"
        FROM ${views} WHERE message_id=ANY($1::bigint[]) ORDER BY viewed_at,viewer_key`,[ids])).rows;
      res.json({messages:ids.map(id=>({id,viewers:rows.filter(r=>r.id===id).map(({name,viewedAt})=>({name,viewedAt}))}))});
    }));
  }
}
