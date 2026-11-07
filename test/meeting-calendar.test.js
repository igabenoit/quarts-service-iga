import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarHTML,monthDays,meetingState} from '../public/meeting-calendar.js';
test('calendrier : douze mois, années bissextiles et lundi en première colonne',()=>{
 assert.equal(monthDays(2026,0)[3],'2026-01-01');
 assert.equal(monthDays(2026,1).filter(Boolean).length,28);
 assert.equal(monthDays(2028,1).filter(Boolean).length,29);
 const html=calendarHTML([{id:'x',title:'<script>test</script>',event_date:'2026-11-06',status:'open'},{id:'y',title:'Autre année',event_date:'2025-01-01',status:'done'},{id:'z',title:'Date inconnue',event_date:null,status:'draft'}],2026,'2026-11-07');
 assert.equal((html.match(/class="mc-month"/g)||[]).length,12);
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('Autre année'));assert.ok(!html.includes('Date inconnue'));
 assert.equal(meetingState({status:'open',event_date:'2026-01-01'},'2026-11-07')[0],'overdue');
 assert.equal(meetingState({status:'done',event_date:'2026-01-01'},'2026-11-07')[0],'done');
});

