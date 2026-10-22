import {isTimedCell,PAM_POSTS,KITCHEN_POSTS} from './departments-core.js';

export const CUISINE_START='2026-10-26';
// Historical PAM sheets keep their original accounting.
export function cuisineCell(cell,source,week){
  const c={...cell};
  if(week<CUISINE_START||!isTimedCell(c))return c;
  let target=c.workDepartment||source;
  if((c.kind==='kitchen'||Object.hasOwn(KITCHEN_POSTS,c.post))&&target==='pam')target='cuisine';
  if(target==='cuisine'&&(Object.hasOwn(PAM_POSTS,c.post)||c.kind==='buffet'))target='pam';
  if(target==='cuisine'&&c.kind==='shift')c.kind='kitchen';
  if(target===source)delete c.workDepartment;else c.workDepartment=target;
  return c;
}
export const cuisineDraft=(draft,key,week)=>({...draft,rows:draft.rows.map(r=>({...r,cells:r.cells.map(c=>cuisineCell(c,key,week))}))});
