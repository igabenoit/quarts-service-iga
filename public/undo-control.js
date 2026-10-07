window.createUndoControl=function({onUndo,beforeUndo=async()=>false}){
  const button=document.querySelector('#undoLastAction'),status=document.querySelector('#undoStatus');
  let action=null,busy=false,pending=0,revision=0;
  const render=()=>{button.disabled=busy||pending>0||!action;button.title=action?'Annuler : '+action.label:'Aucune action à annuler';};
  async function refresh(){
    const turn=++revision;
    try{
      const res=await fetch('/api/undo',{cache:'no-store'});if(!res.ok)throw Error();
      const data=await res.json();if(turn!==revision)return;
      action=data.action;
      status.textContent=action?`À annuler : ${action.label}${action.week_start?' · semaine du '+String(action.week_start).slice(0,10):''}`:'Aucune action à annuler. Les actions antérieures à cette option ne sont pas disponibles.';
    }catch{if(turn===revision){action=null;status.textContent='Connectez-vous pour annuler une action.';}}
    render();
  }
  async function request(url,options={}){
    const mutation=options.method&&options.method!=='GET';
    if(mutation){pending++;render();}
    try{return await fetch(url,options);}
    finally{if(mutation){pending--;await refresh();}}
  }
  button.onclick=async()=>{
    if(busy||pending||!action)return;
    let expected=action;busy=true;render();
    try{
      if(await beforeUndo()){await refresh();expected=action;}
      if(!expected)return;
      status.textContent='Annulation en cours…';
      const res=await fetch('/api/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actionId:expected.id})});
      const data=await res.json();if(!res.ok)throw Error(data.error);
      await onUndo(data.action);
      await refresh();
      status.textContent=`Action annulée : ${data.action.label}. `+status.textContent;
    }catch(error){await refresh();status.textContent=error.message;}
    finally{busy=false;render();}
  };
  document.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.shiftKey||event.altKey||event.key.toLowerCase()!=='z')return;
    if(event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
    if(!button.disabled){event.preventDefault();button.click();}
  });
  window.addEventListener('focus',()=>refresh());
  refresh();
  return {request,refresh};
};
