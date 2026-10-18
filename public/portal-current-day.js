// Keep today's heading below the sticky week banner, including on small screens.
export function scrollToToday(schedule,banner){
  const day=schedule.querySelector('.is-today');
  if(!day)return;
  day.style.scrollMarginTop=`${Math.ceil(banner.getBoundingClientRect().height)+16}px`;
  day.scrollIntoView({block:'start',behavior:'instant'});
}
