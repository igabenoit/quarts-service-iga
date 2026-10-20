// This link is shown only after the server has checked current Service membership.
const link=document.querySelector('[data-service-chat]');
let running=false;
async function update(){
  if(!link||document.hidden||running)return;
  running=true;
  try{
    const response=await fetch('/api/service-chat',{cache:'no-store'});
    if(!response.ok){link.hidden=true;return;}
    const data=await response.json();link.hidden=false;
    link.textContent='Discussion du Service'+(data.unread?` (${data.unread} non lu${data.unread>1?'s':''})`:'');
  }catch{link.hidden=true;}finally{running=false;}
}
document.addEventListener('visibilitychange',update);
window.addEventListener('focus',update);
document.querySelector('#accessForm')?.addEventListener('submit',()=>setTimeout(update,1000));
setInterval(update,15000);
update();
