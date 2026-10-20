const $=s=>document.querySelector(s);
const mode=new URLSearchParams(location.search).get('mode')==='manager'?'manager':'employee';
let user=null,busy=false,sending=false,first=null,last=null,pending=null,epoch=0;
const seen=new Set(),box=$('#messages'),status=text=>$('#status').textContent=text;
async function api(path,options={}){
  const response=await fetch(path+(path.includes('?')?'&':'?')+'mode='+mode,{cache:'no-store',...options});
  let data;try{data=await response.json();}catch{throw Error('Connexion interrompue. Réessaie.');}
  if(!response.ok)throw Object.assign(Error(data.error||'Discussion indisponible.'),{status:response.status});
  return data;
}
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const atBottom=()=>box.scrollHeight-box.scrollTop-box.clientHeight<70;
function clearChat(){
  epoch++;user=null;seen.clear();first=last=null;pending=null;
  box.replaceChildren();$('#pins').replaceChildren();$('#body').value='';$('#photo').value='';
  $('#chat').hidden=true;$('#pinned').hidden=true;$('#older').hidden=true;$('#newMessages').hidden=true;
}
function failed(error){
  status(error.message);
  if(error.status===401||error.status===403){clearChat();$('#login').hidden=error.status===403;}
}
function card(message){
  const article=document.createElement('article');article.className='message'+(message.authorKey===user.key?' mine':'');article.dataset.id=message.id;
  const meta=document.createElement('div');meta.className='meta';
  const name=document.createElement('strong');name.textContent=message.authorName;
  const date=document.createElement('time');date.dateTime=message.createdAt;date.textContent=new Date(message.createdAt).toLocaleString('fr-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  meta.append(name,date);article.append(meta);
  if(message.body){const p=document.createElement('p');p.textContent=message.body;article.append(p);}
  if(message.hasPhoto){const image=document.createElement('img');image.src=`/api/service-chat/messages/${message.id}/photo?mode=${mode}`;image.alt='Photo partagée par '+message.authorName;image.loading='lazy';article.append(image);}
  if(user.manager){
    const pin=document.createElement('button');pin.type='button';pin.className='quiet';pin.dataset.pinned=String(message.pinned);pin.textContent=message.pinned?'Désépingler':'Épingler';
    pin.onclick=async()=>{
      pin.disabled=true;
      try{
        await api(`/api/service-chat/messages/${message.id}/pin`,{...json({pinned:pin.dataset.pinned!=='true'}),method:'PUT'});
        await pins();
      }catch(error){failed(error);}finally{pin.disabled=false;}
    };article.append(pin);
  }
  return article;
}
async function pins(){
  const generation=epoch,data=await api('/api/service-chat/pins');if(generation!==epoch||!user)return;
  $('#pins').replaceChildren(...data.messages.map(card));$('#pinned').hidden=!data.messages.length;
  const pinnedIds=new Set(data.messages.map(m=>m.id));
  box.querySelectorAll('article').forEach(article=>{
    const button=article.querySelector('button');if(!button)return;
    const pinned=pinnedIds.has(article.dataset.id);button.dataset.pinned=String(pinned);button.textContent=pinned?'Désépingler':'Épingler';
  });
}
async function markRead(){
  if(!user||!last||document.hidden||!document.hasFocus()||!atBottom())return;
  try{await api('/api/service-chat/read',json({lastId:last}));$('#newMessages').hidden=true;}catch(error){failed(error);}
}
function add(messages,older=false){
  const fresh=messages.filter(m=>!seen.has(m.id));fresh.forEach(m=>seen.add(m.id));
  const cards=fresh.map(card);
  if(older)box.prepend(...cards);else box.append(...cards);
  if(fresh.length){
    const ids=[first,last,...fresh.map(m=>m.id)].filter(Boolean).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    first=ids[0];last=ids.at(-1);
  }
}
async function refresh(initial=false){
  if(busy||sending||document.hidden||(!initial&&!user))return;
  busy=true;const generation=epoch;
  try{
    const meta=await api('/api/service-chat');
    if(generation!==epoch)return;
    if(user&&user.key!==meta.user.key){clearChat();location.reload();return;}
    user=meta.user;$('#identity').textContent=user.name+(user.manager?' · Gestionnaire':'');$('#login').hidden=true;$('#chat').hidden=false;
    const bottom=initial||atBottom();
    let more=true,received=0;
    while(more){
      const data=await api('/api/service-chat/messages'+(last?'?after='+last:''));
      if(generation!==epoch)return;
      const wasEmpty=!last;add(data.messages);received+=data.messages.length;
      if(wasEmpty){$('#older').hidden=!data.more;more=false;}else more=data.more;
    }
    await pins();if(generation!==epoch)return;
    if(bottom){box.scrollTop=box.scrollHeight;await markRead();}
    else if(received)$('#newMessages').hidden=false;
    status(seen.size?'':'Aucun message pour le moment. Lance la discussion !');
  }catch(error){failed(error);}finally{busy=false;}
}
$('#login').onsubmit=async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{await api('/api/employee-portal/access',json({code:$('#code').value}));$('#code').value='';if(mode==='manager'){location.assign('/discussion');return;}await refresh(true);}catch(error){failed(error);}finally{button.disabled=false;}
};
$('#older').onclick=async()=>{
  if(busy||!first)return;busy=true;const generation=epoch,height=box.scrollHeight;
  try{const data=await api('/api/service-chat/messages?before='+first);if(generation!==epoch)return;add(data.messages,true);box.scrollTop+=box.scrollHeight-height;$('#older').hidden=!data.more;}catch(error){failed(error);}finally{busy=false;}
};
function photoChanged(){
  $('#photoName').textContent=$('#photo').files[0]?.name||'';$('#removePhoto').hidden=!$('#photo').files.length;pending=null;
}
$('#photo').onchange=photoChanged;
$('#removePhoto').onclick=()=>{$('#photo').value='';photoChanged();};
$('#body').oninput=()=>{pending=null;};
function readPhoto(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Impossible de lire cette photo.'));reader.readAsDataURL(file);});}
$('#compose').onsubmit=async event=>{
  event.preventDefault();if(sending||!user)return;sending=true;
  const generation=epoch,controls=[...event.target.querySelectorAll('button,input,textarea')];controls.forEach(c=>c.disabled=true);
  try{
    if(!pending){
      const file=$('#photo').files[0];
      if(file&&(file.size>2*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)))throw Error('Choisis une photo JPEG, PNG ou WebP de 2 Mo maximum.');
      pending={body:$('#body').value,photo:file?await readPhoto(file):null,requestId:crypto.randomUUID()};
    }
    await api('/api/service-chat/messages',{method:'POST',headers:{'Content-Type':'application/vnd.iga.chat+json'},body:JSON.stringify(pending)});
    if(generation!==epoch)return;
    pending=null;$('#body').value='';$('#photo').value='';photoChanged();status('Message envoyé.');box.scrollTop=box.scrollHeight;
  }catch(error){failed(error);}finally{sending=false;controls.forEach(c=>c.disabled=false);}
  if(user)await refresh();
};
$('#newMessages').onclick=()=>{box.scrollTop=box.scrollHeight;markRead();};
box.addEventListener('scroll',()=>{if(atBottom())markRead();},{passive:true});
$('#logout').onclick=async()=>{
  try{await api(user.manager?'/api/logout':'/api/employee-portal/logout',{method:'POST'});clearChat();location.assign(mode==='manager'?'/connexion':'/discussion');}catch(error){failed(error);}
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',()=>refresh());
window.addEventListener('pageshow',event=>{if(event.persisted){clearChat();refresh(true);}});
setInterval(()=>refresh(),5000);
await refresh(true);
