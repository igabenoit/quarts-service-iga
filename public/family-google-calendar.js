const $=s=>document.querySelector(s);
let status;
async function request(path,body){const response=await fetch('/api/family-portal/google'+path,{cache:'no-store',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),data=await response.json();if(!response.ok)throw Error(data.error||'Connexion Google indisponible.');return data;}
const message=text=>{$('#googleStatus').textContent=text;};
export async function refreshGoogleCalendar(){
  try{
    status=await request('');
    $('#googleConnect').hidden=!status.configured;
    $('#googleConnect').textContent=status.connected?'Reconnecter Google':'Connecter Google';
    $('#googleChoose').hidden=!status.connected;
    $('#googleSync').hidden=!status.enabled;
    $('#googleDisconnect').hidden=!status.connected;
    let text='Connectez le compte Google qui peut modifier votre calendrier familial.';
    if(!status.configured)text='Connexion Google à configurer par l’administration. La synchronisation n’est pas encore active.';
    else if(status.error)text=status.error;
    else if(status.enabled)text=`Synchronisation active vers « ${status.calendarName} ». ${status.lastSync?'Dernière mise à jour : '+new Date(status.lastSync).toLocaleString('fr-CA'):''}`;
    else if(status.connected)text='Google est connecté. Choisissez votre calendrier familial pour activer la synchronisation.';
    message(text);
    if(status.connected){const data=await request('/calendars'),select=$('#googleCalendar');select.replaceChildren(...data.calendars.map(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.name;return option;}));const family=data.calendars.find(c=>c.name==='Famille');select.value=status.calendarId||family?.id||data.calendars[0]?.id||'';}
  }catch(error){message(error.message);}
}
async function action(button,fn){button.disabled=true;try{await fn();}catch(error){message(error.message);}finally{button.disabled=false;}}
$('#googleConnect').onclick=event=>action(event.currentTarget,async()=>{const data=await request('/connect',{});location.assign(data.url);});
$('#googleEnable').onclick=event=>action(event.currentTarget,async()=>{message('Première synchronisation…');await request('/enable',{calendarId:$('#googleCalendar').value});await refreshGoogleCalendar();});
$('#googleSync').onclick=event=>action(event.currentTarget,async()=>{message('Mise à jour…');await request('/sync',{});await refreshGoogleCalendar();});
$('#googleDisconnect').onclick=event=>action(event.currentTarget,async()=>{await request('/disconnect',{});await refreshGoogleCalendar();});

