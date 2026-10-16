import {assertDepartment} from './manager-access.js';
import {plannedSummary,normalizeSummaryActual} from './public/department-summary.js';
import {serviceShiftTiming} from './public/service-rules.js';

export async function installDepartmentHoursSummary(app,pool,{requireManager,sameOrigin,getWeek,departmentFor,weekFor}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_department_hour_summaries(department_id BIGINT NOT NULL REFERENCES schedule_leave_departments(id),week_start DATE NOT NULL,actual JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(department_id,week_start))`);
  const endpoint=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||400).json({error:error.code?'Le sommaire n’a pas pu être enregistré.':error.message});}};
  async function planned(req){
    const department=await departmentFor(req.params.id),start=weekFor(req.params.week);assertDepartment(req,department.id);
    if(department.key!=='service')return plannedSummary(await getWeek(department.id,start));
    const shifts=(await pool.query('SELECT role,start_minute,end_minute FROM schedule_shifts WHERE week_start=$1',[start])).rows.filter(row=>['cashier','supervisor','packer','manager','orders'].includes(row.role));
    const byRole=role=>shifts.filter(s=>s.role===role).reduce((n,s)=>n+serviceShiftTiming(Number(s.start_minute),Number(s.end_minute)).paidMinutes,0);
    const checkout=byRole('cashier')+byRole('supervisor')+byRole('packer')+byRole('manager'),orders=byRole('orders'),total=checkout+orders;
    return {department,weekStart:start,totals:{shift:checkout,training:0,buffet:0,kitchen:0,orders},total,serviceBreakdown:{checkout,orders,manager:byRole('manager'),cashier:byRole('cashier'),supervisor:byRole('supervisor'),packer:byRole('packer')},empty:!shifts.length,detail:'Caissières '+(byRole('cashier')/60)+' h · Superviseurs '+(byRole('supervisor')/60)+' h · Emballeurs '+(byRole('packer')/60)+' h'};
  }
  async function read(summary){const row=(await pool.query('SELECT actual,version,updated_at FROM schedule_department_hour_summaries WHERE department_id=$1 AND week_start=$2',[summary.department.id,summary.weekStart])).rows[0];return {...summary,actual:row?.actual||{minutes:null,note:''},version:row?.version||0,updatedAt:row?.updated_at||null};}
  app.get('/api/departments/:id/weeks/:week/hours-summary',requireManager,endpoint(async(req,res)=>res.json(await read(await planned(req)))));
  app.put('/api/departments/:id/weeks/:week/hours-summary',requireManager,sameOrigin,endpoint(async(req,res)=>{
    const summary=await planned(req),body=req.body||{},actual=normalizeSummaryActual(body.actual);
    if(!Number.isSafeInteger(body.version)||body.version<0)throw Error('Rechargez le sommaire avant de l’enregistrer.');
    const saved=await pool.query(`INSERT INTO schedule_department_hour_summaries(department_id,week_start,actual) VALUES($1,$2,$3) ON CONFLICT(department_id,week_start) DO UPDATE SET actual=EXCLUDED.actual,version=schedule_department_hour_summaries.version+1,updated_at=clock_timestamp() WHERE schedule_department_hour_summaries.version=$4 RETURNING actual,version,updated_at`,[summary.department.id,summary.weekStart,JSON.stringify(actual),body.version]);
    if(!saved.rowCount)throw Object.assign(Error('Ce sommaire a été modifié ailleurs. Rechargez-le avant de réessayer; votre saisie reste affichée.'),{status:409});
    const row=saved.rows[0];res.json({...summary,actual:row.actual,version:row.version,updatedAt:row.updated_at});
  }));
}

