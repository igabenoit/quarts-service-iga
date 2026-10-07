import {beginUndo} from './undo.js';

// Called inside a transaction. Existing shifts are deliberately preserved.
export async function recordDeparture(client,id,request={}){
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Employé invalide.');
  await beginUndo(client,'Retirer un employé — départ définitif',null,request);
  const employee=(await client.query('SELECT * FROM schedule_employees WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!employee)throw new Error('Employé introuvable.');
  if(employee.departed_at)throw new Error('Cet employé est déjà retiré de la liste.');
  return (await client.query(`UPDATE schedule_employees SET active=FALSE,departed_at=clock_timestamp()
    WHERE id=$1 RETURNING *`,[id])).rows[0];
}
