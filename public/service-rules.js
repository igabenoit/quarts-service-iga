// Service only: paid rest breaks never reduce paid hours.
export function serviceShiftTiming(startMinute,endMinute){
  const elapsedMinutes=endMinute-startMinute;
  if(!Number.isInteger(startMinute)||!Number.isInteger(endMinute)||startMinute<0||endMinute>1440||elapsedMinutes<=0)throw Error('Vérifiez le début et la fin du quart.');
  const paidBreakCount=elapsedMinutes>=360?2:elapsedMinutes>=180?1:0;
  const breakMinutes=elapsedMinutes>=480?60:0;
  return {breakMinutes,paidBreakCount,paidBreakMinutes:paidBreakCount*15,paidMinutes:elapsedMinutes-breakMinutes};
}
