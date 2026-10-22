import {nameKey,isTimedCell} from './public/departments-core.js';
import {CUISINE_START,cuisineDraft} from './public/cuisine-routing.js';
import {assertTransferSlots} from './department-transfers.js';

const migration='cuisine-2026-10-26';
const names=['Nicole Morin','Amina Ait Hammou','Fatima Zahra Oufary'];
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);

export function splitCuisine(schedule,ids){
  if(!schedule)return {pam:null,cuisine:null};
  const moved=schedule.rows.filter(r=>ids.includes(Number(r.personId))).map(r=>({...r,cells:r.cells.map(c=>{
    if(!isTimedCell(c))return {...c};
    // Retain the original workplace for all non-kitchen work.
    return {...c,workDepartment:c.workDepartment||((c.kind==='kitchen'||c.post==='kitchen_salads')?'cuisine':'pam')};
  })}));
  return {pam:cuisineDraft({...schedule,rows:schedule.rows.filter(r=>!ids.includes(Number(r.personId)))},'pam',CUISINE_START),
    cuisine:cuisineDraft({...schedule,notes:'',rows:moved},'cuisine',CUISINE_START)};
}

export async function installCuisineMigration(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_department_migrations(key TEXT PRIMARY KEY,effective_week DATE NOT NULL,previous_memberships JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(8675309)');
    if((await client.query('SELECT key FROM schedule_department_migrations WHERE key=$1',[migration])).rows.length){await client.query('COMMIT');return;}
    const departments=(await client.query('SELECT id,schedule_key AS key FROM schedule_leave_departments')).rows;
    const pam=departments.find(d=>d.key==='pam'),cuisine=departments.find(d=>d.key==='cuisine');
    const people=(await client.query('SELECT id,name FROM schedule_store_people WHERE active=TRUE AND service_employee_id IS NULL')).rows;
    const matches=names.map(name=>people.filter(p=>nameKey(p.name)===nameKey(name)));
    // Never guess an identity, or partially transfer a team.
    if(!pam||!cuisine||matches.some(m=>m.length!==1)){await client.query('COMMIT');return;}
    const ids=matches.map(m=>Number(m[0].id));
    const memberships=(await client.query('SELECT * FROM schedule_store_memberships WHERE person_id=ANY($1::bigint[])',[ids])).rows;
    if(ids.some(id=>!memberships.some(m=>Number(m.person_id)===id&&Number(m.department_id)===Number(pam.id))))throw Error('Séparation Cuisine : vérifier le rattachement des trois employées au PAM.');
    const weeks=(await client.query('SELECT w.*,d.schedule_key AS key FROM schedule_department_weeks w JOIN schedule_leave_departments d ON d.id=w.department_id WHERE week_start >= $1 ORDER BY week_start',[CUISINE_START])).rows;
    const changes=[];
    for(const start of new Set(weeks.map(w=>iso(w.week_start)))){
      const group=weeks.filter(w=>iso(w.week_start)===start),source=group.find(w=>w.key==='pam');
      const changed=group.map(w=>({...w,draft:cuisineDraft(w.draft,w.key,start),published:w.published?cuisineDraft(w.published,w.key,start):null}));
      if(source){
        const draft=splitCuisine(source.draft,ids),published=splitCuisine(source.published,ids);
        const sourceNew=changed.find(w=>w.key==='pam');sourceNew.draft=draft.pam;sourceNew.published=published.pam;
        let destination=changed.find(w=>w.key==='cuisine');
        if(!destination){destination={department_id:cuisine.id,key:'cuisine',week_start:start,revision:0,draft:{manager:source.draft.manager||'',notes:'',rows:[]},published:null,published_at:null};changed.push(destination);}
        for(const [field,addition] of [['draft',draft.cuisine],['published',published.cuisine]]){
          if(!addition?.rows.length)continue;
          if(destination[field]?.rows.some(r=>ids.includes(Number(r.personId))))throw Error('Séparation Cuisine : un horaire Cuisine existe déjà pour ces employées.');
          destination[field]={...(destination[field]||addition),rows:[...(destination[field]?.rows||[]),...addition.rows]};
          if(field==='published')destination.published_at=source.published_at;
        }
      }
      assertTransferSlots(changed);
      for(const next of changed){const old=group.find(w=>Number(w.department_id)===Number(next.department_id));
        if(!old&& !next.draft.rows.length&&!next.published)continue;
        if(old&&JSON.stringify(old.draft)===JSON.stringify(next.draft)&&JSON.stringify(old.published)===JSON.stringify(next.published))continue;
        changes.push({old,next});
      }
    }
    for(const {old,next} of changes){
      if(old)await client.query('INSERT INTO schedule_department_history(department_id,week_start,revision,draft,published,action) VALUES($1,$2,$3,$4,$5,$6)',[old.department_id,iso(old.week_start),old.revision,JSON.stringify(old.draft),JSON.stringify(old.published),'Séparation Cuisine — original conservé']);
      await client.query(`INSERT INTO schedule_department_weeks(department_id,week_start,draft,revision,published,published_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(department_id,week_start) DO UPDATE SET draft=EXCLUDED.draft,revision=EXCLUDED.revision,published=EXCLUDED.published,published_at=EXCLUDED.published_at,updated_at=clock_timestamp()`,[next.department_id,iso(next.week_start),JSON.stringify(next.draft),Number(next.revision)+1,next.published?JSON.stringify(next.published):null,next.published_at]);
    }
    for(const id of ids){
      const rank=memberships.find(m=>Number(m.person_id)===id&&Number(m.department_id)===Number(pam.id)).display_order;
      await client.query('DELETE FROM schedule_store_memberships WHERE person_id=$1 AND department_id=$2',[id,pam.id]);
      await client.query('INSERT INTO schedule_store_memberships(person_id,department_id,display_order) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,cuisine.id,rank]);
      await client.query('UPDATE schedule_store_people SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',[id]);
    }
    await client.query('INSERT INTO schedule_department_migrations(key,effective_week,previous_memberships) VALUES($1,$2,$3)',[migration,CUISINE_START,JSON.stringify(memberships)]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function membershipsAt(client,memberships,weekStart){
  if(!weekStart)return memberships;
  const migrations=(await client.query('SELECT previous_memberships FROM schedule_department_migrations WHERE effective_week>$1 ORDER BY effective_week DESC',[weekStart])).rows;
  for(const migration of migrations){const ids=new Set(migration.previous_memberships.map(m=>Number(m.person_id)));memberships=[...memberships.filter(m=>!ids.has(Number(m.person_id))),...migration.previous_memberships];}
  return memberships;
}
