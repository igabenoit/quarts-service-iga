import {forecastWeekDates,normalizeInitialForecasts} from './public/sales-forecast.js';

const SOURCE='https://releve-quotidien-iga.onrender.com';
export function installSalesForecasts(app,{requireManager,fetchImpl=fetch,token=process.env.SCHEDULE_FORECAST_TOKEN,timeoutMs=15000}){
  app.get('/api/sales-forecasts/:weekStart',requireManager,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {weekStart}=req.params;
    if(!forecastWeekDates(weekStart))return res.status(400).json({error:'Choisissez le lundi de la semaine.'});
    if(typeof token!=='string'||token.length<32)return res.status(503).json({error:'La liaison avec les prévisions n’est pas configurée.'});
    try{
      const response=await fetchImpl(`${SOURCE}/api/integrations/quarts-service/initial-sales/${weekStart}`,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)
      });
      if(!response.ok)throw Error('Source indisponible.');
      res.json(normalizeInitialForecasts(await response.json(),weekStart));
    }catch{
      res.status(503).json({error:'Prévisions temporairement indisponibles. Vous pouvez continuer à préparer l’horaire.'});
    }
  });
}
