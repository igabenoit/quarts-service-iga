import crypto from 'node:crypto';
import {logEvent,errorCode} from './runtime-diagnostics.js';

// Separate queue: chat workers from an older deployment cannot consume schedule alerts.
export async function createSchedulePush(pool,{tables,pushTables,credential,send,vapidDetails}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_service_schedule_push_jobs(
    id BIGSERIAL PRIMARY KEY,origin TEXT NOT NULL,subscription_id UUID NOT NULL,
    week_start DATE NOT NULL,kind TEXT NOT NULL CHECK(kind IN('published','updated')),event_id UUID NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,due_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_until TIMESTAMPTZ,lease_token UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(origin,subscription_id,week_start));
    CREATE INDEX IF NOT EXISTS schedule_service_schedule_push_due ON schedule_service_schedule_push_jobs(origin,due_at)`);
  async function enqueue(client,week,kind){
    if(!['published','updated'].includes(kind))return;
    const event=crypto.randomUUID();
    let queued=0;
    const origins=(await client.query('SELECT origin FROM schedule_service_push_origins')).rows;
    for(const {origin} of origins){
      const destination=pushTables(origin);
      const result=await client.query(`INSERT INTO schedule_service_schedule_push_jobs(origin,subscription_id,week_start,kind,event_id)
        SELECT $1,id,$2,$3,$4 FROM ${destination.subscriptions} WHERE owner_key LIKE 'employee:%' OR owner_key='admin' OR owner_key LIKE 'manager:%'
        ON CONFLICT(origin,subscription_id,week_start) DO UPDATE SET
        kind=EXCLUDED.kind,event_id=EXCLUDED.event_id,attempts=0,due_at=clock_timestamp(),
        lease_until=NULL,lease_token=NULL,created_at=clock_timestamp() RETURNING id`,[origin,week,kind,event]);
      if(origin===tables.scope)queued=result.rows.length;
    }
    return queued;
  }
  async function inventory(week,{includeRecipients=false}={}){
    const subs=(await pool.query(`SELECT owner_key,credential_hash FROM ${tables.subscriptions}`)).rows;
    let employees=0,managers=0,inactive=0;
    const recipients=new Map();
    for(const sub of subs){
      const current=await credential(sub.owner_key,{includeGuests:false});
      if(!current||current!==sub.credential_hash){inactive++;continue;}
      const employee=sub.owner_key.startsWith('employee:');
      if(employee)employees++;else managers++;
      if(includeRecipients){
        if(!recipients.has(sub.owner_key)){
          let name='Accès gestionnaire partagé';
          if(sub.owner_key!=='admin'){
            const id=sub.owner_key.split(':')[1];
            const table=employee?'schedule_store_people':'schedule_manager_accounts';
            name=(await pool.query(`SELECT name FROM ${table} WHERE id=$1`,[id])).rows[0]?.name||(employee?'Employé':'Gestionnaire');
          }
          recipients.set(sub.owner_key,{name,kind:employee?'employee':'manager',devices:0});
        }
        recipients.get(sub.owner_key).devices++;
      }
    }
    const pending=week?Number((await pool.query('SELECT count(*) AS n FROM schedule_service_schedule_push_jobs WHERE origin=$1 AND week_start=$2',[tables.scope,week])).rows[0].n):0;
    return {employees,managers,inactive,pending,...(includeRecipients?{recipients:[...recipients.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name,'fr'))}:{})};
  }
  async function drain(){
    await pool.query(`DELETE FROM schedule_service_schedule_push_jobs WHERE origin=$1 AND (created_at<clock_timestamp()-interval '24 hours' OR attempts>=8)`,[tables.scope]);
    for(let batch=0;batch<10;batch++){
      const token=crypto.randomUUID();
      const jobs=(await pool.query(`UPDATE schedule_service_schedule_push_jobs SET lease_until=clock_timestamp()+interval '2 minutes',lease_token=$2,attempts=attempts+1
        WHERE id IN(SELECT id FROM schedule_service_schedule_push_jobs WHERE origin=$1 AND due_at<=clock_timestamp()
        AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`,[tables.scope,token])).rows;
      if(!jobs.length)break;
      await Promise.all(jobs.map(async job=>{
        const remove=()=>pool.query('DELETE FROM schedule_service_schedule_push_jobs WHERE id=$1 AND lease_token=$2',[job.id,token]);
        try{
          const sub=(await pool.query(`SELECT * FROM ${tables.subscriptions} WHERE id=$1`,[job.subscription_id])).rows[0];
          // Active Service managers receive the same notices; temporary guests remain excluded.
          if(!sub||await credential(sub.owner_key,{includeGuests:false})!==sub.credential_hash){await remove();return;}
          if(!(await pool.query('SELECT 1 FROM schedule_public_links WHERE week_start=$1',[job.week_start])).rows.length){await remove();return;}
          const week=typeof job.week_start==='string'?job.week_start.slice(0,10):job.week_start.toISOString().slice(0,10);
          const payload=JSON.stringify({kind:'schedule-'+job.kind,week,tag:'service-schedule-'+job.event_id});
          const age=Math.floor((Date.now()-new Date(job.created_at).getTime())/1000);
          await send(sub.subscription,payload,{vapidDetails,TTL:Math.max(0,86400-age),urgency:'high',timeout:10000});
          logEvent('schedule_push_sent',{component:'service_schedule',jobId:Number(job.id)});
          await remove();
        }catch(error){
          logEvent('schedule_push_failed',{component:'service_schedule',jobId:Number(job.id),status:error.statusCode,code:errorCode(error)},'error');
          if(error.statusCode===404||error.statusCode===410){await pool.query(`DELETE FROM ${tables.subscriptions} WHERE id=$1`,[job.subscription_id]);await remove();return;}
          await pool.query(`UPDATE schedule_service_schedule_push_jobs SET due_at=clock_timestamp()+$3*interval '1 second',lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`,[job.id,token,Math.min(3600,30*2**job.attempts)]);
        }
      }));
    }
  }
  const counts=await inventory();
  logEvent('schedule_push_inventory',{component:'service_schedule',code:`employees=${counts.employees};managers=${counts.managers};inactive=${counts.inactive}`});
  return {enqueue,drain,inventory};
}
