// A manager's regular supervision work belongs to her primary position.
// Other explicit functions (cashier, packing, orders) keep their own labels.
export function defaultServiceRole(shiftRole,employeeRole){
  return employeeRole==='manager'&&shiftRole==='supervisor'?'manager':shiftRole;
}

// Call only after validating an assignment, within its existing transaction.
export async function applyServiceRoleDefault(client,shift,employee){
  const role=defaultServiceRole(shift.role,employee.role);
  if(role!==shift.role){
    await client.query('UPDATE schedule_shifts SET role=$1,updated_at=NOW() WHERE id=$2',[role,shift.id]);
  }
  return {...shift,role};
}

// Copy needs only, just like the original copy workflow. Legacy supervision
// shifts occupied by a manager become manager needs in the destination week.
export async function copyServiceShifts(client,weekStart,previous){
  await client.query(`INSERT INTO schedule_shifts
    (week_start,area,role,day_index,start_minute,end_minute,break_minutes,source_department,notes,sort_order)
    SELECT $1,s.area,CASE WHEN e.role='manager' AND s.role='supervisor' THEN 'manager' ELSE s.role END,
      s.day_index,s.start_minute,s.end_minute,s.break_minutes,s.source_department,s.notes,s.sort_order
    FROM schedule_shifts s
    LEFT JOIN schedule_assignments a ON a.shift_id=s.id
    LEFT JOIN schedule_employees e ON e.id=a.employee_id
    WHERE s.week_start=$2 ORDER BY s.id`,[weekStart,previous]);
}
