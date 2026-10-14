import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installLeave} from '../leave.js';
import {installDepartmentSchedules} from '../department-schedules.js';
import {installUndoSchema} from '../undo.js';
export async function departmentFixture({fetchImpl,photoTimeoutMs}={}){
  const db=new PGlite(),pool={release(){},async query(sql,args){const r=args?await db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};return {...r,rowCount:r.rows.length||r.affectedRows||0};}};pool.connect=async()=>pool;
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8'),ddl=source.slice(source.indexOf('await pool.query(`'),source.indexOf('app.disable('));await new Function('pool','return (async()=>{'+ddl+'})();')(pool);
  const routes=new Map(),app={use(){}};for(const verb of ['get','post','put','patch','delete'])app[verb]=(path,...handlers)=>routes.set(verb+' '+path,handlers);
  const manager=(_q,_s,next)=>next(),origin=(_q,_s,next)=>next(),staff=(_q,_s,next)=>next();
  const oldKey=process.env.RESEND_API_KEY,timer=globalThis.setInterval;process.env.RESEND_API_KEY='';globalThis.setInterval=()=>({unref(){}});
  try{await installLeave(app,pool,{requireManager:manager,sameOrigin:origin,hasStaffAccess:()=>false});await installUndoSchema(pool);}finally{globalThis.setInterval=timer;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;}
  const options={requireManager:manager,sameOrigin:origin,requireStaff:staff,fetchImpl,photoTimeoutMs};
  const service=await installDepartmentSchedules(app,pool,options);
  const call=async(method,path,req={})=>{const res={code:200,body:null,set(){return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await routes.get(method+' '+path).at(-1)({body:{},params:{},query:{},headers:{},...req},res);return res;};
  return {db,pool,routes,app,options,service,call};
}
