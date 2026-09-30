export async function installLeaveArchive(app,pool,{requireManager,sameOrigin}){
 await pool.query('ALTER TABLE schedule_leave_requests ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');
 app.get('/api/leave/reset-preview',requireManager,async(_req,res)=>{
 const rows=(await pool.query('SELECT id,is_test,status FROM schedule_leave_requests WHERE archived_at IS NULL ORDER BY id')).rows;
 res.set('Cache-Control','no-store').json({ids:rows.map(r=>String(r.id)),total:rows.length,real:rows.filter(r=>!r.is_test).length,tests:rows.filter(r=>r.is_test).length,allowed:rows.every(r=>r.is_test||!['pending','approved'].includes(r.status))});
 });
 app.post('/api/leave/reset',requireManager,sameOrigin,async(req,res)=>{
 const ids=req.body?.ids;
 if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>!/^\d+$/.test(String(id))))return res.status(400).json({error:'Liste de demandes invalide.'});
 const client=await pool.connect();try{
 await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
 const rows=(await client.query('SELECT id,is_test,status FROM schedule_leave_requests WHERE id=ANY($1::bigint[]) AND archived_at IS NULL FOR UPDATE',[ids])).rows;
 if(rows.some(r=>!r.is_test&&['pending','approved'].includes(r.status))){await client.query('ROLLBACK');return res.status(409).json({error:'Une demande réelle est encore en attente ou approuvée. Traitez-la avant la remise à zéro.'});}
 await client.query('UPDATE schedule_leave_requests SET archived_at=clock_timestamp() WHERE id=ANY($1::bigint[]) AND archived_at IS NULL',[ids]);
 await client.query('COMMIT');res.json({ok:true,archived:rows.length});
 }catch{await client.query('ROLLBACK');res.status(500).json({error:'Impossible de remettre les statistiques à zéro.'});}finally{client.release();}
 });
}
