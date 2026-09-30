export async function installDepartments(app,pool,{requireManager,sameOrigin}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schedule_leave_departments (
    id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL,
    recipient TEXT NOT NULL DEFAULT '', mail_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
  INSERT INTO schedule_leave_departments(code,name) VALUES('service','Service') ON CONFLICT(code) DO NOTHING;
  ALTER TABLE schedule_leave_requests ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES schedule_leave_departments(id);
  ALTER TABLE schedule_leave_requests ADD COLUMN IF NOT EXISTS department_name TEXT NOT NULL DEFAULT 'Service';
  UPDATE schedule_leave_requests SET department_id=(SELECT id FROM schedule_leave_departments WHERE code='service') WHERE department_id IS NULL;`);
  const list=async()=> (await pool.query('SELECT * FROM schedule_leave_departments ORDER BY name,id')).rows;
  app.get('/api/leave/departments',requireManager,async(_req,res)=>res.set('Cache-Control','no-store').json({departments:await list()}));
  const save=async(req,res)=>{
    const b=req.body||{},name=typeof b.name==='string'?b.name.trim():'',email=typeof b.recipient==='string'?b.recipient.trim():'';
    if(!name||name.length>80||typeof b.active!=='boolean'||typeof b.mailEnabled!=='boolean'||email.length>254||((email||b.mailEnabled)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return res.status(400).json({error:'Vérifiez le nom et le courriel du département.'});
    try{
      if(req.params.id){
        const r=await pool.query('UPDATE schedule_leave_departments SET name=$1,recipient=$2,mail_enabled=$3,active=$4 WHERE id=$5 RETURNING id',[name,email,b.mailEnabled,b.active,req.params.id]);
        if(!r.rowCount)return res.status(404).json({error:'Département introuvable.'});
      }else{
        if((await list()).some(d=>d.name.toLocaleLowerCase('fr-CA')===name.toLocaleLowerCase('fr-CA')))return res.status(409).json({error:'Ce département existe déjà.'});
        await pool.query('INSERT INTO schedule_leave_departments(name,recipient,mail_enabled,active) VALUES($1,$2,$3,$4)',[name,email,b.mailEnabled,b.active]);
      }
      res.json({ok:true,departments:await list()});
    }catch{res.status(500).json({error:'Impossible d’enregistrer ce département.'});}
  };
  app.post('/api/leave/departments',requireManager,sameOrigin,save);
  app.put('/api/leave/departments/:id',requireManager,sameOrigin,save);
  return {list};
}
