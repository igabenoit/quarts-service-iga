import {isDate,monday} from './public/departments-core.js';
const serviceWrite=req=>req?.route&&/^[A-Z]+$/.test(req.method||'')&&/^\/api\/(weeks\/|shifts\/|employees(?:\/|$))/.test(req.route.path);
export async function serviceRevision(client,week){
  // Hash in PostgreSQL: no employee details or credentials leave the database.
  return (await client.query(`SELECT md5(jsonb_build_object(
    'week',(SELECT to_jsonb(w) FROM schedule_weeks w WHERE week_start=$1),
    'shifts',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM schedule_shifts s WHERE week_start=$1),
    'assignments',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY shift_id),'[]') FROM schedule_assignments a JOIN schedule_shifts s ON s.id=a.shift_id WHERE s.week_start=$1),
    'employees',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM schedule_employees e),
    'people',(SELECT COALESCE(jsonb_agg(jsonb_build_array(id,employee_code,birthday) ORDER BY id),'[]') FROM schedule_store_people WHERE service_employee_id IS NOT NULL),
    'publication',(SELECT to_jsonb(p) FROM schedule_service_publications p WHERE week_start=$1),
    'link',(SELECT token FROM schedule_public_links WHERE week_start=$1),
    'timeOff',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY employee_id,day_index),'[]') FROM schedule_time_off t WHERE week_start=$1),
    'exceptions',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY employee_id),'[]') FROM schedule_day_exceptions x WHERE week_start=$1)
  )::text) AS revision`,[week])).rows[0].revision;
}
export async function assertServiceRevision(client,week,req){
  if(!serviceWrite(req))return;
  const displayed=req.headers?.['x-service-week'],expected=req.headers?.['x-service-revision'];
  const fail=()=>{throw Object.assign(Error('La feuille a changé ou doit être actualisée. Rechargez la semaine avant de réessayer; aucun changement n’a été enregistré.'),{status:409});};
  if(!isDate(displayed)||monday(displayed)!==displayed||week&&String(week).slice(0,10)!==displayed||!/^[a-f0-9]{32}$/.test(expected||''))fail();
  if(await serviceRevision(client,displayed)!==expected)fail();
  req.serviceRevisionWeek=displayed;
}
export async function commitServiceTransaction(client,req){
  const revision=req?.serviceRevisionWeek?await serviceRevision(client,req.serviceRevisionWeek):null;
  await client.query('COMMIT');
  if(revision)req.res.set('X-Service-Revision',revision);
}
