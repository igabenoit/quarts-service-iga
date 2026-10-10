export const nameKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[-’']/g,' ').replace(/\s+/g,' ').trim();
export function normalizeEmail(value){
  const email=typeof value==='string'?value.trim().toLowerCase():'';
  return email.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)?email:'';
}
const groupKey=r=>JSON.stringify([String(r.department_id||''),nameKey(r.employee_name),normalizeEmail(r.email)||String(r.email).trim()]);

// Rebuilt from the private request history, including archives. No guessed/fuzzy matches.
export function buildContactDirectory(employees,requests,preferences=[]){
  const byId=new Map(employees.map(e=>[String(e.id),e]));
  const byName=new Map();
  for(const e of employees){const k=nameKey(e.name);byName.set(k,[...(byName.get(k)||[]),e]);}
  const active=employees.filter(e=>e.active&&!e.departed_at);
  const contacts=new Map(active.map(e=>[String(e.id),{id:Number(e.id),name:e.name,role:e.role,addresses:[],email:'',status:'missing',source:'',lastReceivedAt:null}]));
  const prefs=new Map(preferences.map(p=>[String(p.employee_id),p]));
  const aliases=new Map();
  for(const r of requests.filter(r=>!r.is_test&&r.contact_employee_id)){
    const k=groupKey(r);if(!aliases.has(k))aliases.set(k,new Set());aliases.get(k).add(String(r.contact_employee_id));
  }
  const unmatched=new Map(),excluded=new Set(),received=new Map();
  for(const r of requests.filter(r=>!r.is_test)){
    const email=normalizeEmail(r.email),alias=aliases.get(groupKey(r));
    let id=r.employee_id||r.contact_employee_id||(alias?.size===1?[...alias][0]:null),source=id?'Demande reliée':'Nom correspondant';
    if(!id&&r.department_code==='service'){
      const matches=byName.get(nameKey(r.employee_name))||[];
      if(matches.length===1)id=matches[0].id;
    }
    const entry=contacts.get(String(id));
    const historicalKey=JSON.stringify([String(id||''),groupKey(r)]);
    if(!received.has(historicalKey))received.set(historicalKey,{name:byId.get(String(id))?.name||r.employee_name,email:email||r.email,department:r.department_name||'Service',status:entry?'Employé actif':id&&byId.has(String(id))?'Employé inactif ou retiré':'À relier',requestIds:[]});
    received.get(historicalKey).requestIds.push(String(r.id));
    if(id&&byId.has(String(id))&&!entry){excluded.add(String(id));continue;}
    if(entry&&email){
      let address=entry.addresses.find(a=>a.email===email);
      if(!address){address={email,requestIds:[],source,lastReceivedAt:r.submitted_at};entry.addresses.push(address);}
      address.requestIds.push(String(r.id));
      if(new Date(r.submitted_at)>new Date(address.lastReceivedAt))address.lastReceivedAt=r.submitted_at;
      if(!entry.lastReceivedAt||new Date(r.submitted_at)>new Date(entry.lastReceivedAt))entry.lastReceivedAt=r.submitted_at;
    }else{
      const k=groupKey(r);
      if(!unmatched.has(k))unmatched.set(k,{name:r.employee_name,email:email||r.email,valid:!!email,department:r.department_name||'Service',requestIds:[],lastReceivedAt:r.submitted_at});
      const item=unmatched.get(k);item.requestIds.push(String(r.id));
      if(new Date(r.submitted_at)>new Date(item.lastReceivedAt))item.lastReceivedAt=r.submitted_at;
    }
  }
  for(const entry of contacts.values()){
    entry.addresses.sort((a,b)=>new Date(b.lastReceivedAt)-new Date(a.lastReceivedAt));
    const preferred=normalizeEmail(prefs.get(String(entry.id))?.email);
    if(preferred){entry.email=preferred;entry.source='Adresse choisie par la gestion';}
    else if(entry.addresses.length===1){entry.email=entry.addresses[0].email;entry.source=entry.addresses[0].source;}
    entry.status=entry.email?'ready':entry.addresses.length?'review':'missing';
  }
  const rows=[...contacts.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr-CA'));
  const counts=new Map();for(const r of rows)if(r.email)counts.set(r.email,(counts.get(r.email)||0)+1);
  for(const r of rows)r.shared=!!r.email&&counts.get(r.email)>1;
  return {employees:rows,received:[...received.values()],unmatched:[...unmatched.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr-CA')),emails:[...counts.keys()].sort(),
    summary:{total:rows.length,withEmail:rows.filter(r=>r.status==='ready').length,missing:rows.filter(r=>r.status==='missing').length,review:rows.filter(r=>r.status==='review').length,unmatched:unmatched.size,uniqueEmails:counts.size,excluded:excluded.size}};
}

export async function loadContactDirectory(pool){
  const [employees,requests,preferences]=await Promise.all([
    pool.query('SELECT id,name,role,active,departed_at FROM schedule_employees'),
    pool.query(`SELECT r.id,r.employee_id,r.employee_name,r.email,r.submitted_at,r.department_id,r.department_name,r.is_test,
      d.code AS department_code,l.employee_id AS contact_employee_id FROM schedule_leave_requests r
      LEFT JOIN schedule_leave_departments d ON d.id=r.department_id LEFT JOIN schedule_leave_contact_links l ON l.request_id=r.id WHERE r.is_test=FALSE`),
    pool.query('SELECT employee_id,email FROM schedule_employee_contacts')
  ]);
  return buildContactDirectory(employees.rows,requests.rows,preferences.rows);
}

export async function installContacts(app,pool,{requireManager,sameOrigin}){
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_employee_contacts (
    employee_id BIGINT PRIMARY KEY REFERENCES schedule_employees(id) ON DELETE CASCADE,
    email TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );CREATE TABLE IF NOT EXISTS schedule_leave_contact_links (
    request_id BIGINT PRIMARY KEY REFERENCES schedule_leave_requests(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES schedule_employees(id) ON DELETE CASCADE
  );`);
  app.get('/api/employee-contacts',requireManager,async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json({...await loadContactDirectory(pool),updatedAt:new Date().toISOString()});}
    catch{res.status(500).json({error:'Impossible de charger les courriels.'});}
  });
  app.put('/api/employee-contacts/:id',requireManager,sameOrigin,async(req,res)=>{
    const id=Number(req.params.id),email=normalizeEmail(req.body?.email);
    if(!Number.isSafeInteger(id)||id<=0||!email)return res.status(400).json({error:'Employé ou adresse courriel invalide.'});
    try{
      const saved=await pool.query(`INSERT INTO schedule_employee_contacts(employee_id,email)
        SELECT id,$2 FROM schedule_employees WHERE id=$1 AND active=TRUE AND departed_at IS NULL
        ON CONFLICT(employee_id) DO UPDATE SET email=EXCLUDED.email,updated_at=clock_timestamp() RETURNING employee_id`,[id,email]);
      if(!saved.rows.length)return res.status(404).json({error:'Employé actif introuvable.'});
      res.json({ok:true});
    }catch{res.status(500).json({error:'Impossible d’enregistrer le courriel.'});}
  });
  app.post('/api/employee-contacts/link',requireManager,sameOrigin,async(req,res)=>{
    const employeeId=Number(req.body?.employeeId),ids=req.body?.requestIds;
    if(!Number.isSafeInteger(employeeId)||employeeId<=0||!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>!/^\d+$/.test(String(id)))||new Set(ids.map(String)).size!==ids.length)
      return res.status(400).json({error:'Sélectionnez les adresses et l’employé à relier.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const employee=await client.query('SELECT id FROM schedule_employees WHERE id=$1 AND active=TRUE AND departed_at IS NULL FOR SHARE',[employeeId]);
      if(!employee.rows.length)throw new Error('Employé actif introuvable.');
      const requests=await client.query('SELECT id,employee_id FROM schedule_leave_requests WHERE id=ANY($1::bigint[]) AND is_test=FALSE FOR SHARE',[ids]);
      if(requests.rows.length!==ids.length||requests.rows.some(r=>r.employee_id&&String(r.employee_id)!==String(employeeId)))throw new Error('Une demande est déjà reliée à un autre employé ou ne peut pas être utilisée.');
      for(const id of ids)await client.query(`INSERT INTO schedule_leave_contact_links(request_id,employee_id) VALUES($1,$2)
        ON CONFLICT(request_id) DO UPDATE SET employee_id=EXCLUDED.employee_id`,[id,employeeId]);
      await client.query('COMMIT');res.json({ok:true});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});res.status(400).json({error:error.code?'Impossible de relier ces adresses.':error.message});}
    finally{client.release();}
  });
  app.get('/courriels',(_req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile('courriels.html',{root:'public'}));
}
