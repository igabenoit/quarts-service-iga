import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/departments.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let photoLoadSequence='),source.indexOf('let photoApplying='));
function fixture(){
  const elements=new Map(),timers=new Map();let next=0,starts=0,reads=0;
  const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,hidden:false});return elements.get(id);};
  const context=vm.createContext({$,meta:{visionConfigured:true},activePhoto:{id:1,state:'saved',busy:false,attempts:0,attemptLimit:5,remainingAttempts:5},analyzingPhotoId:null,photoApplying:false,view:'photos',AbortSignal,post:async()=>{},renderCandidate(){},
    setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    api:async(path,options={})=>{if(options.method==='POST'){starts++;return {id:1,state:'processing',phase:'reading',busy:true,elapsedSeconds:0,attempts:1,attemptLimit:5,remainingAttempts:4};}reads++;return context.serverState;}
  });context.serverState={...context.activePhoto,state:'processing',busy:true,attempts:1,remainingAttempts:4,phase:'reading'};vm.runInContext(code,context);
  return {$,context,timers,get starts(){return starts;},get reads(){return reads;},click:()=>$('#analyzePhoto').onclick(),async tick(){const [id,timer]=[...timers][0];timers.delete(id);await timer.fn();}};
}

test('lecture : clic rendu immédiatement, suivi automatique, première proposition puis déblocage sans recharger',async()=>{
  const f=fixture();await f.click();assert.equal(f.starts,1);assert.equal(f.$('#analyzePhoto').disabled,true);assert.match(f.$('#photoStatus').textContent,/automatiquement/);assert.equal(f.timers.size,1);
  await f.click();assert.equal(f.starts,1);
  f.context.serverState={...f.context.serverState,phase:'verifying',elapsedSeconds:65,candidate:{rows:[{name:'Exemple'}]}};
  await f.tick();assert.match(f.$('#photoStatus').textContent,/Première transcription enregistrée/);assert.match(f.$('#photoStatus').textContent,/1 min 5 s/);assert.equal(f.$('#applyCandidate').disabled,true);
  f.context.serverState={...f.context.serverState,busy:false,state:'ready',phase:''};await f.tick();assert.equal(f.starts,1);assert.equal(f.$('#analyzePhoto').disabled,false);assert.equal(f.$('#applyCandidate').disabled,false);assert.equal(f.timers.size,0);assert.match(f.$('#photoStatus').textContent,/Transcription disponible/);
});

test('lecture : rouvrir une photo en cours reprend son suivi sans lancer un nouvel essai',async()=>{
  const f=fixture();await vm.runInContext('openPhoto(1)',f.context);assert.equal(f.timers.size,1);assert.equal(f.starts,0);
  f.context.serverState={...f.context.serverState,busy:false,state:'saved',lastError:'Lecture interrompue après le délai.'};await f.tick();assert.match(f.$('#photoStatus').textContent,/interrompue/);assert.equal(f.$('#analyzePhoto').disabled,false);assert.equal(f.timers.size,0);
});

test('lecture : perte de connexion au suivi affichée puis récupération; aucune relance IA automatique',async()=>{
  const f=fixture();await f.click();const api=f.context.api;f.context.api=async()=>{throw Error('network');};await f.tick();assert.match(f.$('#photoStatus').textContent,/momentanément indisponible/);assert.equal([...f.timers.values()][0].delay,6000);
  f.context.api=api;f.context.serverState={...f.context.serverState,busy:false,state:'ready',candidate:{rows:[]}};await f.tick();assert.equal(f.starts,1);assert.equal(f.timers.size,0);
});

test('lecture : changer de photo ou d’onglet arrête les actualisations de l’ancienne photo',async()=>{
  const f=fixture();await f.click();const reads=f.reads;f.context.activePhoto={id:2};await f.tick();assert.equal(f.reads,reads);assert.equal(f.timers.size,0);
  const g=fixture();await g.click();g.context.view='schedule';await g.tick();assert.equal(g.timers.size,0);
});
