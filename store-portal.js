import {isDate,monday,today,addDays} from './public/departments-core.js';
import {leadershipRoster,presenceWeek} from './public/leadership-presence-core.js';
import {personalDays} from './public/portal-weeks.js';
import {serviceShiftTiming} from './public/service-rules.js';

const iso=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const identity=person=>Number(person.portalPersonId||person.id);

// Build exactly the published personal view, grouping only explicitly linked records.
export function storePeople(weekStart,people,departments,results){
  const groups=new Map();
  for(const person of people.filter(p=>p.active)){
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
  return [...groups.values()].map(({results,...person})=>({...person,published:results.length>0,days:personalDays(weekStart,results)})).sort((a,b)=>a.name.localeCompare(b.name,'fr-CA'));
}

export function installStorePortal(app,pool,{requireManager,directory,listDepartments,readPublishedWeek}){
  async function serviceResult(start){
    const records=(await pool.query(`SELECT e.id,e.name,e.role,s.day_index,s.start_minute,s.end_minute,s.role AS shift_role
      FROM schedule_employees e LEFT JOIN schedule_assignments a ON a.employee_id=e.id AND a.shift_id IN (SELECT id FROM schedule_shifts WHERE week_start=$1)
      LEFT JOIN schedule_shifts s ON s.id=a.shift_id WHERE e.active=TRUE AND e.departed_at IS NULL ORDER BY e.name,s.day_index,s.start_minute`,[start])).rows;
    const employees=new Map();
    for(const row of records){
      const id=Number(row.id);
      if(!employees.has(id))employees.set(id,{id,name:row.name,role:row.role,shifts:[]});
      if(row.day_index!==null)employees.get(id).shifts.push({dayIndex:Number(row.day_index),startMinute:Number(row.start_minute),endMinute:Number(row.end_minute),...serviceShiftTiming(Number(row.start_minute),Number(row.end_minute)),role:row.shift_role});
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
    // Do not accept employee sessions, scoped managers, or an invented employee ID.
    if(req.manager?.kind!=='admin')return res.status(req.manager?403:401).json({error:'Cette vue est réservée à l’administrateur du magasin.'});
    try{await fn(req,res);}catch(error){res.status(error.status||500).json({error:error.status?error.message:'Impossible de charger les horaires du magasin. Réessayez.'});}
  };
  app.get('/api/store-portal',requireManager,endpoint(async(_req,res)=>{
    const departments=(await listDepartments(pool)).filter(d=>d.active).map(({id,name,key})=>({id,name,key}));
    const weeks=(await pool.query(`SELECT week_start FROM schedule_department_weeks WHERE published IS NOT NULL UNION SELECT week_start FROM schedule_public_links ORDER BY week_start DESC`)).rows.map(r=>iso(r.week_start));
    res.json({today:today(),departments,weeks});
  }));
  app.get('/api/store-portal/weeks/:week',requireManager,endpoint(async(req,res)=>{
    const start=req.params.week;
    if(!isDate(start)||monday(start)!==start)return res.status(400).json({error:'Choisissez le lundi de la semaine.'});
    const departments=(await listDepartments(pool)).filter(d=>d.active),people=await directory(pool,start),results=[],publications=[];
    // The callback shares the employee portal projection, without recording views.
    const published=await readPublishedWeek(start,people);
    for(const department of departments.filter(d=>d.key!=='service')){
      const data=published.find(p=>p.department.id===department.id);
      publications.push({key:department.key,name:department.name,published:!!data});
      if(data)results.push({kind:'department',data});
    }
    const servicePublished=(await pool.query('SELECT 1 FROM schedule_public_links WHERE week_start=$1',[start])).rows.length>0;
    publications.push({key:'service',name:'Service',published:servicePublished});
    if(servicePublished){
      results.push(await serviceResult(start));
    }
    res.json({today:today(),weekStart:start,publications,employees:storePeople(start,people,departments,results)});
  }));
}
