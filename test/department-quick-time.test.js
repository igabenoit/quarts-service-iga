import test from 'node:test';
import assert from 'node:assert/strict';
import {parseShiftTimes,quickTimeLabel,parseTime} from '../public/departments-core.js';

test('saisie rapide : après-midi déduit de la fin abrégée et minutes conservées',()=>{
  for(const [start,end,s,e]of [['7','4',420,960],['7h30','4h30',450,990],['730','430',450,990],['7:30','16:30',450,990],['07:00','16:00',420,960],['7','11',420,660],['12','8',720,1200],['16','24',960,1440],['16','12',960,1440],['0','4',0,240]])assert.deepEqual(parseShiftTimes(start,end),{start:s,end:e},`${start} → ${end}`);
  assert.equal(quickTimeLabel(420),'7');assert.equal(quickTimeLabel(990),'16h30');assert.equal(quickTimeLabel(1440),'24');
  assert.equal(parseTime('7'),null,'La saisie abrégée ne change pas l’interprétation des disponibilités.');
});
test('saisie rapide : heures explicites et saisies invalides ne sont pas corrigées silencieusement',()=>{
  for(const [start,end]of [['7','04'],['7','04:00'],['7','0430'],['20','4'],['19','7'],['24','4'],['7','25'],['7','24:30'],['7h75','16'],['7,5','16'],['abc','4'],['','4'],['7','']])assert.throws(()=>parseShiftTimes(start,end),undefined,`${start} → ${end}`);
});
