import {isDate,monday,today,addDays} from './public/departments-core.js';
import {leadershipRoster,presenceWeek} from './public/leadership-presence-core.js';
import {personalDays} from './public/portal-weeks.js';
import {serviceShiftTiming} from './public/service-rules.js';
import {publishedServiceResult} from './service-publication.js';

const iso=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const identity=person=>Number(person.portalPersonId||person.id);

// Build exactly the published personal view, grouping only explicitly linked records.
export function storePeople(weekStart,people,departments,results,allowed=null){
  const groups=new Map();
  for(const person of people.filter(p=>p.employmentEndedOn?p.employmentEndedOn>weekStart:p.active)){
    const id=identity(person),owner=people.find(p=>p.id===id)||person;
    if(!groups.has(id))groups.set(id,{id,name:owner.name,departmentKeys:[],results:[]});
    const group=groups.get(id);
    for(const departmentId of person.departments) {
      const key=departments.find(d=>d.id===departmentId)?.key;
      if(key&&!group.departmentKeys.includes(key))group.departmentKeys.push(key);
    }
  }
  for(const result of results){
    const records=result.kind==='service'?result.data.employees:result.data.schedule.rows;
    const perPerson=new Map();
    for(const row of records){
      const person=people.find(p=>result.kind==='service'?p.serviceEmployeeId===row.id:p.id===row.personId);
      if(!person||!groups.has(identity(person)))continue;
      const id=identity(person);if(!perPerson.has(id))perPerson.set(id,[]);perPerson.get(id).push(row);
    }
    for(const [id,rows] of perPerson)groups.get(id).results.push({kind:result.kind,data:{...result.data,...(result.kind==='service'?{employees:rows}:{schedule:{rows,notes:''}})}});
  }
  return [...groups.values()].map(({results,...person})=>({...person,published:results.length>0,days:personalDays(weekStart,results,allowed)})).sort((a,b)=>a.name.localeCompare(b.name,'fr-CA'));
}

export function installStorePortal(app,pool,{requireManager,directory,listDepartments,readPublishedWeek}){
  async function serviceResult(start){
    const records=(await pool.query(`SELECT e.id,e.name,e.role,s.day_index,s.start_minute,s.end_minute,s.absence,s.role AS shift_role
      FROM schedule_employees e LEFT JOIN schedule_assignments a ON a.employee_id=e.id AND a.shift_id IN (SELECT id FROM schedule_shifts WHERE week_start=$1)
      LEFT JOIN schedule_shifts s ON s.id=a.shift_id WHERE e.active=TRUE AND e.departed_at IS NULL ORDER BY e.name,s.day_index,s.start_minute`,[start])).rows;
    const employees=new Map();
    for(const row of records){
      const id=Number(row.id);
      if(!employees.has(id))employees.set(id,{id,name:row.name,role:row.role,shifts:[]});
      if(row.day_index!==null)employees.get(id).shifts.push({dayIndex:Number(row.day_index),startMinute:Number(row.start_minute),endMinute:Number(row.end_minute),...serviceShiftTiming(Number(row.start_minute),Number(row.end_minute),row.absence),role:row.shift_role});
    }
    return {kind:'service',data:{weekStart:start,employees:[...employees.values()]}};
  }
  app.get('/api/weeks/:week/leadership-presence',requireManager,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const departments=(await listDepartments(pool)).filter(d=>d.active),service=departments.find(d=>d.key==='service');
      if(req.manager?.kind!=='admin'&&!(req.manager?.kind==='account'&&req.manager.departments.includes(service?.id)))return res.status(req.manager?403:401).json({error:'Accès réservé à l’administration et au Service.'});
      const start=req.params.week;
      if(!isDate(start)||monday(start)!==start)return res.status(400).json({error:'Choisissez le lundi de la semaine.'});
      const people=await directory(pool,start),currentService=await serviceResult(start),previousStart=addDays(start,-7);
      const roster=leadershipRoster(people,departments,currentService.data.employees);
      const leaders=people.filter(p=>roster.some(r=>r.id===identity(p)));
      const project=async(week,serviceData)=>{
        const published=await readPublishedWeek(week,people);
        return {employees:storePeople(week,leaders,departments,[...published.map(data=>({kind:'department',data})),serviceData]),publications:departments.map(d=>({key:d.key,name:d.name,published:d.key==='service'||published.some(p=>p.department.id===d.id)}))};
      };
      const current=await project(start,currentService),previous=await project(previousStart,await serviceResult(previousStart));
      res.json(presenceWeek(start,roster,current,previous));
    }catch(error){res.status(500).json({error:'Impossible de charger les présences. Réessayez avant d’imprimer.'});}
  });
  const endpoint=fn=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!['admin','account'].includes(req.manager?.kind))return res.status(req.manager?403:401).json({error:'Une connexion de gestion est requise.'});
    try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Impossible de charger les horaires du magasin. Réessayez.'});}
  };
  const visibleDepartments=async req=>(await listDepartments(pool)).filter(d=>d.active&&(req.manager.kind==='admin'||req.manager.departments.includes(d.id)));
  app.get('/api/store-portal',requireManager,endpoint(async(req,res)=>{
    const departments=(await visibleDepartments(req)).map(({id,name,key})=>({id,name,key}));
    const weeks=(await pool.query(`SELECT week_start FROM schedule_department_weeks WHERE published IS NOT NULL AND (department_id=ANY($1::bigint[])
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(published->'rows') r,jsonb_array_elements(r->'cells') c WHERE c->>'workDepartment'=ANY($2::text[])))
      UNION SELECT week_start FROM schedule_public_links WHERE $3::boolean
      ORDER BY week_start DESC`,[departments.map(d=>d.id),departments.map(d=>d.key),departments.some(d=>d.key==='service')])).rows.map(r=>iso(r.week_start));
    res.json({today:today(),departments,weeks});
  }));
  app.get('/api/store-portal/weeks/:week',requireManager,endpoint(async(req,res)=>{
    const start=req.params.week;
    if(!isDate(start)||monday(start)!==start)return res.status(400).json({error:'Choisissez le lundi de la semaine.'});
    const departments=await visibleDepartments(req),people=await directory(pool,start),results=[],publications=[];
    // The callback shares the employee portal projection, without recording views.
    const published=await readPublishedWeek(start,people);
    for(const department of departments.filter(d=>d.key!=='service')){
      const data=published.find(p=>p.department.id===department.id);
      publications.push({key:department.key,name:department.name,published:!!data});
      if(data)results.push({kind:'department',data});
    }
    if(departments.some(d=>d.key==='service')){
      const service=await publishedServiceResult(pool,start);
      publications.push({key:'service',name:'Service',published:!!service});
      if(service)results.push(service);
    }
    const scoped=req.manager.kind==='account',allowed=scoped?new Set(departments.map(d=>d.key)):null;
    const employees=storePeople(start,people,departments,results,allowed)
      .filter(p=>!scoped||p.departmentKeys.length||p.days.some(day=>day.entries.length));
    res.json({today:today(),weekStart:start,publications,employees});
  }));
}
