import {randomUUID} from 'node:crypto';

const startedAt=new Date().toISOString();
let phase='module_import';
export const release=()=>/^[a-f0-9]{40}$/i.test(process.env.RENDER_GIT_COMMIT||'')?process.env.RENDER_GIT_COMMIT:null;
export function logEvent(event,details={},level='info'){
  // Never serialize an Error, request, SQL statement, cookie, URL, or payload.
  const record={time:new Date().toISOString(),level,event,phase,commit:release()};
  for(const key of ['component','code','method','route','requestId','jobId','status','durationMs']){
    const value=details[key];
    if(typeof value==='number'&&Number.isFinite(value))record[key]=value;
    else if(typeof value==='string')record[key]=value.slice(0,160);
  }
  (level==='error'?console.error:console.log)(JSON.stringify(record));
}
export function errorCode(error){
  return /^[A-Z0-9_]{2,60}$/.test(error?.code||'')?error.code:
    ['SyntaxError','TypeError','ReferenceError','RangeError','TimeoutError','AbortError'].includes(error?.name)?error.name:'INTERNAL_ERROR';
}
export function mailResult(component,jobId,response,data){
  const accepted=response.ok&&Boolean(data?.id);
  logEvent('mail_provider_result',{component,jobId:String(jobId),status:response.status,
    code:accepted?'ACCEPTED':response.ok?'INVALID_RESPONSE':'REJECTED'},accepted?'info':'error');
}
export function startupPhase(value){phase=value;logEvent('startup_phase');}
export function requestDiagnostics(req,res,next){
  const start=performance.now(),requestId=randomUUID();
  res.setHeader('X-Request-Id',requestId);
  res.once('finish',()=>{
    if(res.statusCode<400&&['GET','HEAD','OPTIONS'].includes(req.method))return;
    logEvent('http_result',{method:req.method,route:typeof req.route?.path==='string'?req.route.path:'unmatched',
      status:res.statusCode,requestId,durationMs:Math.round(performance.now()-start)},res.statusCode>=500?'error':'info');
  });
  next();
}
export function installHealth(app,pool){
  app.get('/health',async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      // Pool connection timeout (3 s) + query timeout (1 s) stays below Render's 5 s deadline.
      await pool.query({text:'SELECT 1 AS healthy',query_timeout:1000});
      res.json({ok:true,database:'ok',commit:release(),startedAt});
    }catch(error){
      logEvent('health_failed',{component:'database',code:errorCode(error)},'error');
      res.status(503).json({ok:false,database:'unavailable',commit:release()});
    }
  });
}
