// Shared codes and cookies no longer authorize employee operations.
export async function installLeaveAccess(app,pool,{sameOrigin,employeeIdentity}){
  const requireStaff=async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    try{
      req.employee=await employeeIdentity?.(req);
      if(!req.employee)return res.status(401).json({error:'Entrez votre code employé personnel de six chiffres.'});
      next();
    }catch{res.status(500).json({error:'Impossible de vérifier l’accès.'});}
  };
  const retired=(_req,res)=>{
    res.set('Cache-Control','no-store');
    res.setHeader('Set-Cookie',[
      `leave_access=; Path=/api/leave; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`,
      `schedule_view=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`
    ]);
    res.status(410).json({error:'L’accès par code commun a été retiré. Utilisez votre code employé personnel de six chiffres.'});
  };
  app.post('/api/leave/access',sameOrigin,retired);
  app.get('/api/leave/access-settings',retired);
  app.put('/api/leave/access-settings',sameOrigin,retired);
  app.get('/conges',(_req,res)=>res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).sendFile('conges.html',{root:'public'}));
  return {requireStaff};
}
