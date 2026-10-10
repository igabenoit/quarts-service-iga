// Parent tables precede children when rows are restored; deletions use reverse order.
const keys={schedule_weeks:['week_start'],schedule_employees:['id'],schedule_leave_requests:['id'],schedule_availability_requests:['id'],
  schedule_shifts:['id'],schedule_time_off:['week_start','employee_id','day_index'],
  schedule_day_exceptions:['week_start','employee_id'],schedule_assignments:['shift_id']};
const tables=Object.keys(keys);
const latestSQL=`SELECT a.id,a.label,a.week_start FROM schedule_undo_actions a WHERE a.undone_at IS NULL
  AND EXISTS (SELECT 1 FROM schedule_undo_rows r WHERE r.action_id=a.id AND r.before_row IS DISTINCT FROM r.after_row)
  ORDER BY a.id DESC LIMIT 1`;

export async function installUndoSchema(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_undo_actions (
    id BIGSERIAL PRIMARY KEY,label TEXT NOT NULL,week_start DATE,group_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),undone_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS schedule_undo_rows (
    action_id BIGINT NOT NULL REFERENCES schedule_undo_actions(id),table_name TEXT NOT NULL,
    row_key JSONB NOT NULL,before_row JSONB,after_row JSONB,PRIMARY KEY(action_id,table_name,row_key)
  );
  UPDATE schedule_undo_rows SET
    before_row=CASE WHEN before_row IS NOT NULL AND NOT before_row ? 'departed_at' THEN before_row||'{"departed_at":null}'::jsonb ELSE before_row END,
    after_row=CASE WHEN after_row IS NOT NULL AND NOT after_row ? 'departed_at' THEN after_row||'{"departed_at":null}'::jsonb ELSE after_row END
    WHERE table_name='schedule_employees';
  UPDATE schedule_undo_rows SET
    before_row=CASE WHEN before_row IS NOT NULL AND NOT before_row ? 'availability_history' THEN before_row||'{"availability_history":[]}'::jsonb ELSE before_row END,
    after_row=CASE WHEN after_row IS NOT NULL AND NOT after_row ? 'availability_history' THEN after_row||'{"availability_history":[]}'::jsonb ELSE after_row END
    WHERE table_name='schedule_employees';
  CREATE OR REPLACE FUNCTION schedule_record_undo() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE action BIGINT; previous JSONB; following JSONB; identity JSONB='{}'; field TEXT;
  BEGIN
    action=NULLIF(current_setting('schedule.undo_action',true),'')::bigint;
    IF action IS NULL THEN RETURN NULL; END IF;
    -- Keep the week container and its public links; only its settings are undoable.
    IF TG_TABLE_NAME='schedule_weeks' AND TG_OP<>'UPDATE' THEN RETURN NULL; END IF;
    IF TG_OP<>'INSERT' THEN previous=to_jsonb(OLD); END IF;
    IF TG_OP<>'DELETE' THEN following=to_jsonb(NEW); END IF;
    IF (previous-'updated_at') IS NOT DISTINCT FROM (following-'updated_at') THEN RETURN NULL; END IF;
    FOREACH field IN ARRAY TG_ARGV LOOP identity=identity||jsonb_build_object(field,COALESCE(following,previous)->field); END LOOP;
    INSERT INTO schedule_undo_rows(action_id,table_name,row_key,before_row,after_row)
      VALUES(action,TG_TABLE_NAME,identity,previous,following)
      ON CONFLICT(action_id,table_name,row_key) DO UPDATE SET after_row=EXCLUDED.after_row;
    RETURN NULL;
  END $$;`);
  for(const table of tables)await pool.query(`DROP TRIGGER IF EXISTS schedule_undo_capture ON ${table};
    CREATE TRIGGER schedule_undo_capture AFTER INSERT OR UPDATE OR DELETE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION schedule_record_undo(${keys[table].map(k=>`'${k}'`).join(',')});`);
}

export async function beginUndo(client,label,weekStart=null,request={}){
  await client.query('SELECT pg_advisory_xact_lock(8675309)');
  const supplied=request.headers?.['x-undo-group'];
  const group=typeof supplied==='string'&&/^[a-f0-9-]{36}$/i.test(supplied)?supplied:null;
  let action=group?(await client.query(`SELECT id FROM schedule_undo_actions WHERE id=(SELECT MAX(id) FROM schedule_undo_actions)
    AND group_key=$1 AND undone_at IS NULL`,[group])).rows[0]:null;
  if(!action)action=(await client.query('INSERT INTO schedule_undo_actions(label,week_start,group_key) VALUES ($1,$2,$3) RETURNING id',[label,weekStart,group])).rows[0];
  else if(weekStart)await client.query('UPDATE schedule_undo_actions SET week_start=COALESCE(week_start,$1) WHERE id=$2',[weekStart,action.id]);
  await client.query("SELECT set_config('schedule.undo_action',$1,true)",[String(action.id)]);
}

export async function undoLast(client,expectedId){
  await client.query('SELECT pg_advisory_xact_lock(8675309)');
  const action=(await client.query(latestSQL)).rows[0];
  if(!action)throw new Error('Aucune action à annuler.');
  if(String(action.id)!==String(expectedId))throw new Error('Une autre action a été enregistrée. Vérifiez le libellé du bouton puis réessayez.');
  const changes=(await client.query(`SELECT * FROM schedule_undo_rows WHERE action_id=$1 AND before_row IS DISTINCT FROM after_row`,[action.id])).rows;
  for(const change of changes){
    if(!tables.includes(change.table_name))throw new Error('Action non prise en charge.');
    const current=(await client.query(`SELECT to_jsonb(t) AS row,
      (to_jsonb(t)-'updated_at'-'version')=($2::jsonb-'updated_at'-'version') AS matches
      FROM ${change.table_name} t WHERE to_jsonb(t) @> $1::jsonb FOR UPDATE`,[JSON.stringify(change.row_key),change.after_row===null?null:JSON.stringify(change.after_row)])).rows[0];
    if(change.after_row===null?!!current:!current?.matches)
      throw new Error('Ces données ont changé depuis cette action. L’annulation est bloquée pour préserver les changements plus récents.');
    if(['schedule_leave_requests','schedule_availability_requests'].includes(change.table_name)&&change.before_row)change.before_row.version=Number(current.row.version)+1;
  }
  // Recording stays disabled during an undo; the original history remains available.
  await client.query("SELECT set_config('schedule.undo_action','',true)");
  for(const c of changes.filter(c=>c.table_name==='schedule_employees'&&!c.before_row)){
    const views=await client.query('SELECT 1 FROM schedule_schedule_views WHERE employee_id=$1 LIMIT 1',[c.row_key.id]);
    if(views.rows.length)throw new Error('Cet employé a déjà consulté son horaire. Son ajout ne peut plus être annulé; désactivez sa fiche au besoin.');
  }
  for(const table of [...tables].reverse())for(const c of changes.filter(c=>c.table_name===table&&!c.before_row))
    await client.query(`DELETE FROM ${table} t WHERE to_jsonb(t) @> $1::jsonb`,[JSON.stringify(c.row_key)]);
  for(const table of tables)for(const c of changes.filter(c=>c.table_name===table&&c.before_row)){
    const columns=Object.keys(c.before_row);
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    const updates=columns.filter(k=>!keys[table].includes(k)).map(k=>`${quote(k)}=EXCLUDED.${quote(k)}`).join(',');
    await client.query(`INSERT INTO ${table} (${columns.map(quote).join(',')})
      SELECT ${columns.map(quote).join(',')} FROM jsonb_populate_record(NULL::${table},$1::jsonb)
      ON CONFLICT (${keys[table].join(',')}) DO ${updates?'UPDATE SET '+updates:'NOTHING'}`,[JSON.stringify(c.before_row)]);
    if(table==='schedule_availability_requests')await client.query('INSERT INTO schedule_availability_events(request_id,status,note) VALUES ($1,$2,$3)',[c.before_row.id,c.before_row.status,'Dernière action annulée : '+action.label+'.']);
    if(table==='schedule_leave_requests')await client.query('INSERT INTO schedule_leave_events(request_id,status,note) VALUES ($1,$2,$3)',
      [c.before_row.id,c.before_row.status,'Dernière action annulée : '+action.label+'. État précédent rétabli.']);
  }
  await client.query('UPDATE schedule_undo_actions SET undone_at=clock_timestamp() WHERE id=$1',[action.id]);
  return action;
}

export async function installUndo(app,pool,{requireManager,sameOrigin}){
  await installUndoSchema(pool);
  app.get('/api/undo',requireManager,async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json({action:(await pool.query(latestSQL)).rows[0]||null});}
    catch{res.status(500).json({error:'Impossible de charger la dernière action.'});}
  });
  app.post('/api/undo',requireManager,sameOrigin,async(req,res)=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const action=await undoLast(client,req.body?.actionId);
      await client.query('COMMIT');res.json({ok:true,action});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(409).json({error:error.code?'Cette action ne peut plus être annulée car d’autres données en dépendent. Aucun changement effectué.':error.message});}
    finally{client.release();}
  });
}
