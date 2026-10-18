import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollToToday} from '../public/portal-current-day.js';

test('today remains below the measured sticky banner, including when its text wraps',()=>{
  const calls=[],day={style:{},scrollIntoView:options=>calls.push(options)};
  const schedule={querySelector:selector=>{assert.equal(selector,'.is-today');return day;}};
  for(const height of [126,192.5]){
    scrollToToday(schedule,{getBoundingClientRect:()=>({height})});
    assert.equal(day.style.scrollMarginTop,`${Math.ceil(height)+16}px`);
  }
  assert.deepEqual(calls,[{block:'start',behavior:'instant'},{block:'start',behavior:'instant'}]);
});

test('an unpublished or different week has no today target and does not move the reader',()=>{
  scrollToToday({querySelector:()=>null},{getBoundingClientRect(){assert.fail('No banner measurement without today');}});
});
