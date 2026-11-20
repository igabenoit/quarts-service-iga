import {logEvent} from './runtime-diagnostics.js';

export async function installScheduleNotifications(app,pool,{requireManager,sameOrigin,push}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_notice_resends(
    week_start DATE PRIMARY KEY,last_sent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
    ALTER TABLE schedule_service_notice_resends ADD COLUMN IF NOT EXISTS store_id text;
    UPDATE schedule_service_notice_resends n SET store_id=w.store_id FROM schedule_weeks w WHERE n.week_start=w.week_start AND n.store_id IS NULL;
    UPDATE schedule_service_notice_resends SET store_id='principal' WHERE store_id IS NULL;
    ALTER TABLE schedule_service_notice_resends ALTER COLUMN store_id SET NOT NULL, ALTER COLUMN store_id SET DEFAULT 'principal';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='schedule_service_notice_resends'::regclass AND contype='p' AND cardinality(conkey)=1) THEN
      ALTER TABLE schedule_service_notice_resends DROP CONSTRAINT schedule_service_notice_resends_pkey, ADD PRIMARY KEY(week_start,store_id); END IF; END $$`);
  const valid=week=>/^20\d{2}-\d{2}-\d{2}$/.test(week||'')&&!Number.isNaN(Date.parse(week+'T12:00:00Z'));
  const publication=async(client,week,store='principal')=>(await client.query(`SELECT p.published_at FROM schedule_service_publications p
    JOIN schedule_public_links l USING(week_start,store_id) WHERE week_start=$1 AND p.store_id=$2`,[week,store])).rows[0];
  app.get('/api/weeks/:weekStart/notifications',requireManager,async(req,res)=>{
    try{
      if(!valid(req.params.weekStart))return res.status(400).json({error:'Semaine invalide.'});
      const published=await publication(pool,req.params.weekStart,req.storeId);
      res.set('Cache-Control','no-store').json({...await push.scheduleInventory(req.params.weekStart,{includeRecipients:true,store:req.storeId}),published:!!published});
    }catch{res.status(503).json({error:'Suivi des notifications temporairement indisponible.'});}
  });
  app.post('/api/weeks/:weekStart/notifications',requireManager,sameOrigin,async(req,res)=>{
    if(!valid(req.params.weekStart))return res.status(400).json({error:'Semaine invalide.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
      if(!await publication(client,req.params.weekStart,req.storeId))throw Object.assign(Error('Publiez cette semaine avant de renvoyer son avis.'),{status:409});
      const allowed=(await client.query(`INSERT INTO schedule_service_notice_resends(week_start,store_id) VALUES($1,$2)
        ON CONFLICT(week_start,store_id) DO UPDATE SET last_sent_at=clock_timestamp()
        WHERE schedule_service_notice_resends.last_sent_at<clock_timestamp()-interval '1 minute' RETURNING week_start`,[req.params.weekStart,req.storeId??'principal'])).rows.length;
      if(!allowed)throw Object.assign(Error('Attendez une minute avant de renvoyer cet avis.'),{status:429});
      const queued=await push.enqueueSchedule(client,req.params.weekStart,'published',req.storeId);
      await client.query('COMMIT');push.kick();
      logEvent('schedule_push_resent',{component:'service_schedule',status:queued});
      res.json({ok:true,queued});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(error.status||503).json({error:error.status?error.message:'Impossible de préparer les avis. Réessayez.'});}
    finally{client.release();}
  });
}
