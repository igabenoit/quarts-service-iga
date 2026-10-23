import {assertDepartment} from './manager-access.js';
import {normalizeDepartmentBudget} from './public/department-budget.js';
import {forecastWeekDates,normalizeInitialForecasts} from './public/sales-forecast.js';

const SOURCE='https://releve-quotidien-iga.onrender.com';
export function installSalesForecasts(app,{requireManager,pool,fetchImpl=fetch,token=process.env.SCHEDULE_FORECAST_TOKEN,timeoutMs=15000}){
  app.get('/api/sales-forecasts/:weekStart',requireManager,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {weekStart}=req.params;
    if(!forecastWeekDates(weekStart))return res.status(400).json({error:'Choisissez le lundi de la semaine.'});
    if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'La liaison avec les prévisions n’est pas configurée.'});
    try{
      let department;
      if(req.query?.department!==undefined){
        const id=Number(req.query.department);
        if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Département invalide.'});
        assertDepartment(req,id);
        department=(await pool.query('SELECT schedule_key AS code FROM schedule_leave_departments WHERE id=$1 AND active=TRUE',[id])).rows[0];
        if(!department)return res.status(404).json({error:'Département introuvable.'});
      }
      const response=await fetchImpl(`${SOURCE}/api/integrations/quarts-service/initial-sales/${weekStart}`,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)
      });
      if(!response.ok)throw Error('Source indisponible.');
      const source=await response.json(),data=normalizeInitialForecasts(source,weekStart);
      if(department){
        const hours=source.departmentBudgets?.[department.code];
        data.departmentBudget=normalizeDepartmentBudget({department:department.code,hours:hours??null},department.code);
      }
      res.json(data);
    }catch(error){
      if(error.status===403)return res.status(403).json({error:error.message});
      res.status(503).json({error:'Prévisions temporairement indisponibles. Vous pouvez continuer à préparer l’horaire.'});
    }
  });
}
