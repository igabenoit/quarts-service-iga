// Server authorization remains authoritative. This also clears a page left open.
export function watchAccess(mode,{active=false}={}){
  let running=false,revoked=false;
  async function check(){
    if(running||revoked||document.hidden)return;
    running=true;
    try{
      const response=await fetch('/api/access-session?mode='+mode,{cache:'no-store'});
      if(response.ok)active=true;
      else if(response.status===401&&active){
        revoked=true;
        document.body.replaceChildren();
        location.replace(mode==='manager'?'/connexion?access=revoked':'/horaires-departements?access=revoked');
      }
    }catch{/* A network failure does not prove that access was revoked. */}
    finally{running=false;}
  }
  const timer=setInterval(check,5000);
  document.addEventListener('visibilitychange',check);
  window.addEventListener('focus',check);
  window.addEventListener('pageshow',check);
  check();
  return {activate(){active=true;},check,stop(){clearInterval(timer);revoked=true;}};
}
