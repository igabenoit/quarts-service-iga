import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/access-session.js',import.meta.url),'utf8').replace('export function','function');

for(const mode of ['employee','manager'])test(`open ${mode} page clears on revocation, but not on network failure or initial login`,async()=>{
  const redirects=[],events={};let status=401,clears=0;
  const context=vm.createContext({
    document:{hidden:false,body:{replaceChildren(){clears++;}},addEventListener:(key,fn)=>events[key]=fn},
    window:{addEventListener:(key,fn)=>events[key]=fn},location:{replace:path=>redirects.push(path)},
    fetch:async()=>{if(status===0)throw Error('offline');return {status,ok:status===200};},
    setInterval:(fn,ms)=>{assert.equal(ms,5000);events.timer=fn;return 1;},clearInterval(){}
  });
  vm.runInContext(source+`;globalThis.guard=watchAccess('${mode}');`,context);
  await new Promise(setImmediate);
  assert.equal(clears,0,'a visitor can still sign in');
  status=200;await context.guard.check();
  for(const failure of [0,503]){status=failure;await context.guard.check();assert.equal(clears,0);}
  context.document.hidden=true;status=401;await context.guard.check();assert.equal(clears,0);
  context.document.hidden=false;await events.visibilitychange();
  assert.equal(clears,1);
  assert.deepEqual(redirects,[mode==='manager'?'/connexion?access=revoked':'/horaires-departements?access=revoked']);
  await events.timer();assert.equal(clears,1);
});
