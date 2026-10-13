import test from 'node:test';
import assert from 'node:assert/strict';
import {transcribePhoto,validateCandidate,auditCandidate,DEFAULT_VISION_MODEL} from '../department-photo.js';
import {DAY_NAMES,blankCell,cellDetail,normalizeCell} from '../public/departments-core.js';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ3sAAAAASUVORK5CYII=';
const shift={kind:'shift',start:420,end:960,breakMinutes:0,note:'',post:null,workDepartment:null,uncertain:false};
const proposal=()=>({weekText:'12 au 18 octobre 2026',departmentText:'PAM',warnings:[],rows:[{name:'Exemple fictif',writtenTotal:'9',days:DAY_NAMES.map((day,d)=>({...blankCell(),...(d===0?shift:{}),day,rawText:d===0?'7 / 4':'',uncertain:false}))}]});
const response=value=>({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
const input={dataUrl:photo,department:'PAM',weekStart:'2026-10-12',names:['Exemple fictif']};

test('relecture sur la photo originale, correction du jour et lecture littérale conservée',async()=>{
  const first=proposal(),second=proposal(),sent=[];
  // First reading has incorrectly put Monday's shift on Tuesday; the verifier fixes it.
  [first.rows[0].days[0],first.rows[0].days[1]]=[{...first.rows[0].days[1],day:'Lundi'},{...first.rows[0].days[0],day:'Mardi'}];
  const result=await transcribePhoto(input,{key:'test',model:DEFAULT_VISION_MODEL,fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));return response(sent.length===1?first:second);}});
  assert.equal(sent.length,2);assert.equal(result.rows[0].days[0].start,420);assert.equal(result.rows[0].days[1].kind,'blank');
  assert.equal(result.rows[0].readings[0],'7 / 4');assert.equal(result.analysis.verification,'complete');
  for(const request of sent){assert.equal(request.store,false);assert.equal(request.model,DEFAULT_VISION_MODEL);assert.equal(request.reasoning.effort,'high');assert.equal(request.input[0].content[1].image_url,photo);assert.equal(request.input[0].content[1].detail,'original');assert.equal(request.text.format.strict,true);}
  assert.match(sent[1].input[0].content[2].text,/Première proposition/);
});

test('jours réordonnés par étiquette; doublon refusé; incertitude jamais convertie en quart',()=>{
  const value=proposal();value.rows[0].days.reverse();
  assert.equal(validateCandidate(value).rows[0].days[0].start,420);
  value.rows[0].days[6].uncertain=true;assert.equal(validateCandidate(value).rows[0].days[0].kind,'review');
  value.rows[0].days[0].day='Lundi';assert.throws(()=>validateCandidate(value),/colonnes/);
});

test('totaux nets : signaler la différence sans inventer de pause ni altérer les heures',()=>{
  const value=proposal();value.rows[0].writtenTotal='8 h';
  const candidate=validateCandidate(value),result=auditCandidate(candidate);
  assert.match(result.warnings[0],/total manuscrit 8 h, quarts lus 9 h/);
  assert.deepEqual(result.rows,candidate.rows);assert.equal(result.rows[0].days[0].breakMinutes,0);
  for(const kind of ['training','buffet','kitchen']){
    const special=structuredClone(candidate);special.rows[0].days[0].kind=kind;special.rows[0].writtenTotal='9h00';assert.deepEqual(auditCandidate(special).warnings,[]);
  }
  const uncertain=structuredClone(candidate);uncertain.rows[0].days[0]={...blankCell(),kind:'review',note:'illisible'};assert.deepEqual(auditCandidate(uncertain).warnings,[]);
});

test('relecture indisponible ou ligne perdue : résultat initial explicitement non revérifié',async()=>{
  for(const failure of [()=>{throw Error('network');},()=>response({...proposal(),rows:[]})]){
    let calls=0;const result=await transcribePhoto(input,{key:'test',fetchImpl:async()=>++calls===1?response(proposal()):failure()});
    assert.equal(calls,2);assert.equal(result.analysis.verification,'partial');assert.equal(result.rows.length,1);assert.match(result.warnings[0],/seconde vérification n’a pas abouti/);
  }
});

test('override GPT-4.1 compatible, échec API et sortie incomplète explicites',async()=>{
  const sent=[];
  await transcribePhoto(input,{key:'test',model:'gpt-4.1',fetchImpl:async(_url,options)=>{sent.push(JSON.parse(options.body));return response(proposal());}});
  for(const request of sent){assert.equal(request.reasoning,undefined);assert.equal(request.input[0].content[1].detail,'high');}
  await assert.rejects(()=>transcribePhoto(input,{key:'test',fetchImpl:async()=>({ok:false,status:404})}),/SCHEDULE_VISION_MODEL/);
  await assert.rejects(()=>transcribePhoto(input,{key:'test',fetchImpl:async()=>({ok:false,status:429})}),/crédit/);
  const value=proposal();delete value.rows[0].days[0].day;
  await assert.rejects(()=>transcribePhoto(input,{key:'test',fetchImpl:async()=>response(value)}),/incomplets/);
  await assert.rejects(()=>transcribePhoto(input,{key:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})})}),/terminée/);
});

test('ancien poste RS-SS conservé en stockage et renommé dans les quarts existants',()=>{
  const cell=normalizeCell({...shift,post:'rs_ss'});
  assert.equal(cell.post,'rs_ss');assert.equal(cellDetail(cell),'Commandes Sandwich');
});
