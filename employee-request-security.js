import {activePersonSQL} from './employee-access.js';

// Identity comes exclusively from the authenticated personal session.
// A department or service ID in the request is a selector, never an authority.
export function employeeRequestSecurity(pool) {
  return async (req,res,next) => {
    try {
      if(!req.employee)return res.status(401).json({error:'Connexion personnelle requise.'});
      const ids=req.employee.portalPersonIds||[Number(req.employee.id)];
      const people=(await pool.query(`SELECT p.id,p.service_employee_id,COALESCE(e.name,p.name) AS name,
        m.department_id,d.code FROM schedule_store_people p
        LEFT JOIN schedule_employees e ON e.id=p.service_employee_id
        JOIN schedule_store_memberships m ON m.person_id=p.id
        JOIN schedule_leave_departments d ON d.id=m.department_id AND d.active
        WHERE p.id=ANY($1::bigint[]) AND ${activePersonSQL()}`,[ids])).rows;
      const departments=[...new Set(people.map(p=>Number(p.department_id)))];
      if(req.method==='GET') {
        // This projection applies only to the personal forms protected by this middleware.
        const send=res.json.bind(res);
        res.json=data=>send({...data,
          ...(Array.isArray(data.departments)?{departments:data.departments.filter(d=>departments.includes(Number(d.id)))}:{}),
          ...(Array.isArray(data.employees)?{employees:data.employees.filter(e=>people.some(p=>p.service_employee_id&&Number(p.service_employee_id)===Number(e.id)))}:{}),
          employeeName:people.find(p=>Number(p.id)===Number(req.employee.id))?.name||req.employee.name
        });
        return next();
      }
      const b=req.body;
      if(!b||typeof b!=='object'||Array.isArray(b))return res.status(400).json({error:'Formulaire invalide.'});
      const departmentId=b.departmentId==null?people.find(p=>p.code==='service')?.department_id:Number(b.departmentId);
      const selected=people.find(p=>Number(p.department_id)===Number(departmentId)&&
        (b.employeeId==null||Number(p.service_employee_id)===Number(b.employeeId)));
      const submittedName=b.employeeName??b.name;
      if(!selected||(submittedName!==undefined&&(typeof submittedName!=='string'||submittedName.trim().normalize('NFC')!==selected.name.normalize('NFC'))))
        return res.status(403).json({error:'Cette demande doit concerner votre propre fiche et un de vos départements.'});
      req.requestPerson={personId:Number(req.employee.id),serviceEmployeeId:selected.code==='service'&&selected.service_employee_id?Number(selected.service_employee_id):null};
      req.body={...b,departmentId:Number(selected.department_id),employeeId:req.requestPerson.serviceEmployeeId,employeeName:selected.name,...('name' in b?{name:selected.name}:{})};
      next();
    } catch {res.status(503).json({error:'Impossible de vérifier la fiche personnelle. Aucun envoi effectué.'});}
  };
}
