import {logEvent} from './runtime-diagnostics.js';

export async function installScheduleNotifications(app,pool,{requireManager,sameOrigin,push}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_notice_resends(
    week_start DATE PRIMARY KEY,last_sent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())`);
  const valid=week=>/^20\d{2}-\d{2}-\d{2}$/.test(week||'')&&!Number.isNaN(Date.parse(week+'T12:00:00Z'));
  const publication=async(client,week)=>(await client.query(`SELECT p.published_at FROM schedule_service_publications p
    JOIN schedule_public_links l USING(week_start) WHERE week_start=$1`,[week])).rows[0];
  app.get('/api/weeks/:weekStart/notifications',requireManager,async(req,res)=>{
    try{
      if(!valid(req.params.weekStart))return res.status(400).json({error:'Semaine invalide.'});
      const published=await publication(pool,req.params.weekStart);
      res.set('Cache-Control','no-store').json({...await push.scheduleInventory(req.params.weekStart,{includeRecipients:true}),published:!!published});
    }catch{res.status(503).json({error:'Suivi des notifications temporairement indisponible.'});}
  });
  app.post('/api/weeks/:weekStart/notifications',requireManager,sameOrigin,async(req,res)=>{
    if(!valid(req.params.weekStart))return res.status(400).json({error:'Semaine invalide.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
      if(!await publication(client,req.params.weekStart))throw Object.assign(Error('Publiez cette semaine avant de renvoyer son avis.'),{status:409});
      const allowed=(await client.query(`INSERT INTO schedule_service_notice_resends(week_start) VALUES($1)
        ON CONFLICT(week_start) DO UPDATE SET last_sent_at=clock_timestamp()
        WHERE schedule_service_notice_resends.last_sent_at<clock_timestamp()-interval '1 minute' RETURNING week_start`,[req.params.weekStart])).rows.length;
      if(!allowed)throw Object.assign(Error('Attendez une minute avant de renvoyer cet avis.'),{status:429});
      const queued=await push.enqueueSchedule(client,req.params.weekStart,'published');
      await client.query('COMMIT');push.kick();
      logEvent('schedule_push_resent',{component:'service_schedule',status:queued});
      res.json({ok:true,queued});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(error.status||503).json({error:error.status?error.message:'Impossible de préparer les avis. Réessayez.'});}
    finally{client.release();}
  });
}
