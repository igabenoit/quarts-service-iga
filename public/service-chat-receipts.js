// A receipt means the message was displayed in the foreground, not merely downloaded.
export function messageVisible(article){
  if(!article.isConnected||article.closest('details:not([open])'))return false;
  const rect=article.getBoundingClientRect(),container=article.closest('#messages,#pins,.private-messages')?.getBoundingClientRect();
  if(!container||rect.width<=0||rect.height<=0)return false;
  const height=Math.min(rect.bottom,container.bottom,window.innerHeight)-Math.max(rect.top,container.top,0);
  const width=Math.min(rect.right,container.right,window.innerWidth)-Math.max(rect.left,container.left,0);
  return width>0&&height>=Math.min(80,rect.height/2);
}

export function createReadReceipts({api,json,getUser,onError}){
  const entries=new Map(),recorded=new Set(),expanded=new Set();let generation=0,running=false,lastRefresh=0;
  const endpoint=scope=>'/api/service-chat'+(scope==='private'?'/private':'')+'/views';
  function reset(){generation++;entries.clear();recorded.clear();expanded.clear();lastRefresh=0;}
  function attach(article,message,scope='group'){
    const own=message.authorKey===getUser()?.key,entry={id:message.id,scope,own,since:null};
    if(own&&getUser()?.manager){
      const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
      details.className='message-views';summary.textContent='Voir les consultations';details.append(summary,list);article.append(details);
      const key=scope+':'+message.id;details.open=expanded.has(key);
      details.addEventListener('toggle',()=>{if(details.open){expanded.add(key);lastRefresh=0;tick();}else expanded.delete(key);});
      Object.assign(entry,{summary,list});
    }
    entries.set(article,entry);
  }
  function show(entry,viewers){
    entry.summary.textContent=!viewers.length?'Aucune consultation enregistrée':viewers.length===1?'Vu par '+viewers[0].name:`Vu par ${viewers.length} personnes`;
    entry.list.replaceChildren(...viewers.map(viewer=>{
      const item=document.createElement('li');item.textContent=viewer.name+' · '+new Date(viewer.viewedAt).toLocaleString('fr-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});return item;
    }));
  }
  async function tick(){
    if(document.hidden||!document.hasFocus()||!getUser()){
      for(const entry of entries.values())entry.since=null;
      return;
    }
    if(running)return;
    running=true;const current=generation,now=Date.now(),visible=[];
    try{
      for(const [article,entry] of entries){
        if(!article.isConnected){entries.delete(article);continue;}
        if(!messageVisible(article)){entry.since=null;continue;}
        entry.since??=now;visible.push(entry);
      }
      for(const scope of ['group','private']){
        const pending=[...new Set(visible.filter(e=>e.scope===scope&&!e.own&&now-e.since>=1000&&!recorded.has(scope+':'+e.id)).map(e=>e.id))].slice(0,50);
        if(pending.length){
          await api(endpoint(scope),json({messageIds:pending}));
          if(current!==generation)return;
          pending.forEach(id=>recorded.add(scope+':'+id));
        }
        if(now-lastRefresh<5000||!getUser()?.manager)continue;
        const own=[...new Set(visible.filter(e=>e.scope===scope&&e.summary).map(e=>e.id))].slice(0,50);
        if(own.length){
          const data=await api(endpoint(scope)+'?messageIds='+own.join(','));
          if(current!==generation)return;
          for(const result of data.messages)for(const entry of entries.values())if(entry.scope===scope&&entry.id===result.id&&entry.summary)show(entry,result.viewers);
        }
      }
      if(now-lastRefresh>=5000)lastRefresh=now;
    }catch(error){
      if(current!==generation)return;
      for(const entry of visible)if(entry.summary){entry.summary.textContent='Consultations indisponibles';entry.list.replaceChildren();}
      onError(error);
    }finally{running=false;}
  }
  setInterval(tick,1000);
  document.addEventListener('visibilitychange',tick);
  window.addEventListener('focus',tick);
  window.addEventListener('blur',()=>{for(const entry of entries.values())entry.since=null;});
  document.addEventListener('scroll',()=>{for(const entry of entries.values())entry.since=null;},{capture:true,passive:true});
  return {attach,reset,tick};
}
