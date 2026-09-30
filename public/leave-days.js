import {addDays} from './leave-calendar.js';
export function datesBetween(start,end){
 const valid=d=>/^20\d{2}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 if(!valid(start)||!valid(end)||end<start)throw new Error('Vérifiez les dates de début et de fin.');
 const days=[];for(let d=start;d<=end;d=addDays(d,1)){if(days.length===366)throw new Error('Maximum de 366 journées par demande.');days.push(d);}return days;
}
export function dayPeriods(days){
 const result=[];for(const d of days){
 const p={startDate:d.date,endDate:d.date,allDay:d.allDay,...(!d.allDay?{startTime:d.startTime,endTime:d.endTime}:{})};
 if(!p.allDay&&(!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(p.startTime)||!/^(([01]\d|2[0-3]):(00|15|30|45)|24:00)$/.test(p.endTime)||p.endTime<=p.startTime))throw new Error('Le '+d.date+' : choisissez une heure de fin après le début de votre absence.');
 const prev=result.at(-1);if(prev&&addDays(prev.endDate,1)===p.startDate&&prev.allDay===p.allDay&&prev.startTime===p.startTime&&prev.endTime===p.endTime)prev.endDate=p.endDate;else result.push(p);
 }if(!result.length)throw new Error('Choisissez les dates de votre congé.');if(result.length>31)throw new Error('Cette demande contient trop de changements d’heures. Divisez-la en deux demandes.');return result;
}
export const quarterHours=Array.from({length:97},(_,i)=>String(Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0'));
export const hourLabel=t=>t.replace(/^0/,'').replace(':',' h ');
