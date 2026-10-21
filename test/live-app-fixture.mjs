import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
export async function liveAppFixture(){
  const directory=await mkdtemp(join(tmpdir(),'quart-platform-audit-'));
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await new Promise(r=>socket.once('listening',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base=`http://127.0.0.1:${port}`;let child,logs='';
  async function start(){
    logs='';child=spawn(process.execPath,['test/startup-fixture.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),NODE_ENV:'test',PORT:String(port),DATABASE_URL:'postgres://unused.test/test',SESSION_SECRET:'isolated-platform-audit-secret',MANAGER_CODE:'audit-admin-test',TEST_STARTUP_DB:join(directory,'db'),RESEND_API_KEY:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clean();reject(Error('Startup timeout: '+logs));},30000);
      const data=()=>{if(logs.includes('"phase":"ready"')){clean();resolve();}};
      const exit=code=>{clean();reject(Error('Startup failed '+code+': '+logs));};
      const clean=()=>{clearTimeout(timer);child.stdout.off('data',data);child.off('exit',exit);};
      child.stdout.on('data',data);child.once('exit',exit);
    });
  }
  async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}child=null;}
  async function call(method,path,{cookie,body,headers={}}={}){
    const r=await fetch(base+path,{method,redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:r.status,body:data,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
  }
  try{await start();}catch(error){await stop();await rm(directory,{recursive:true,force:true});throw error;}
  return {base,call,stop,start,logs:()=>logs,async close(){await stop();await rm(directory,{recursive:true,force:true});}};
}
