import {storedShiftAbsence} from './public/approved-shift-leave.js';

export async function saveShiftLeave(client, before, after) {
  const absence=storedShiftAbsence(after);
  if(JSON.stringify(storedShiftAbsence(before))!==JSON.stringify(absence))
    await client.query('UPDATE schedule_shifts SET absence=$1, updated_at=NOW() WHERE id=$2',[absence,after.id]);
  return after;
}
