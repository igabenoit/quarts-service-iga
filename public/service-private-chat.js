export function createPrivateControls({api,json,getUser,receipts}){
  const panel=document.querySelector('#privateChat'),contacts=panel.querySelector('select'),messages=panel.querySelector('.private-messages');
  const form=panel.querySelector('form'),body=form.querySelector('textarea'),feedback=panel.querySelector('[role=status]'),alerts=document.querySelector('#leaveQuestions');
  let peer=new URLSearchParams(location.search).get('private')||'',generation=0,pending=null,replyTo=null,loading=false,sending=false,first=null,history=false;
  if(peer)panel.open=true;
  const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;};
  function reset(){generation++;peer='';pending=null;replyTo=null;contacts.replaceChildren();messages.replaceChildren();alerts.replaceChildren();body.value='';history=false;}
  function choose(key){peer=key;contacts.value=peer;generation++;pending=null;replyTo=null;body.value='';history=false;first=null;feedback.textContent='';messages.replaceChildren();panel.open=true;load();}
  function render(message){
    const article=document.createElement('article');article.className='message'+(message.authorKey===getUser().key?' mine':'');
    const heading=document.createElement('strong');heading.textContent=message.authorName+' · '+new Date(message.createdAt).toLocaleString('fr-CA');article.append(heading);
    if(message.leaveId){const context=document.createElement('p');context.textContent=(message.replyTo?'Réponse — ':'Question — ')+'Congé n° '+message.leaveId;article.append(context);}
    const text=document.createElement('p');text.textContent=message.body;article.append(text);
    if(message.leaveId&&!message.replyTo&&message.recipientKey===getUser().key)article.append(button('Répondre à cette question',()=>{replyTo=message.id;pending=null;feedback.textContent='Réponse à la question sur le congé n° '+message.leaveId;body.focus();}));
    receipts.attach(article,message,'private');
    return article;
  }
  async function load(older=false){
    if(!peer||!getUser())return;
    const current=generation;
    try{
      const data=await api('/api/service-chat/private/messages?peer='+encodeURIComponent(peer)+(older&&first?'&before='+first:''));
      if(current!==generation||!getUser())return;
      const scroll=messages.scrollTop,height=messages.scrollHeight,bottom=height-scroll-messages.clientHeight<70;
      if(older)history=true;
      panel.querySelector('[data-latest-private]').hidden=!history;
      if(older)messages.prepend(...data.messages.map(render));else messages.replaceChildren(...data.messages.map(render));
      first=data.messages[0]?.id;panel.querySelector('[data-older-private]').hidden=!data.more;
      if(older)messages.scrollTop=scroll+messages.scrollHeight-height;else if(bottom)messages.scrollTop=messages.scrollHeight;
      const incoming=data.messages.filter(m=>m.recipientKey===getUser().key).at(-1);
      if(incoming&&panel.open&&!document.hidden&&document.hasFocus()&&!older&&bottom)await api('/api/service-chat/private/read',json({lastId:incoming.id}));
    }catch(error){feedback.textContent=error.message;}
  }
  async function refresh(){
    if(loading||sending||!getUser())return;loading=true;const current=generation;
    try{
      const data=await api('/api/service-chat/private');if(current!==generation||!getUser())return;
      const empty=new Option('Choisir une personne…','');contacts.replaceChildren(empty,...data.contacts.map(p=>new Option(p.name+(p.unread?' · '+p.unread+' non lu(s)':''),p.key)));
      if(peer&&!data.contacts.some(p=>p.key===peer)){choose('');feedback.textContent='Ce destinataire n’est plus disponible.';}
      contacts.value=peer;
      panel.querySelector('summary').textContent='Messages privés'+(data.contacts.some(p=>p.unread)?' · Nouveaux messages':'');
      alerts.replaceChildren(...data.questions.map(q=>{
        const card=document.createElement('div');card.className='leave-question';
        const title=document.createElement('h2');title.textContent='Réponse requise — congé n° '+q.leaveId;
        const text=document.createElement('p');text.textContent=q.authorName+' : '+q.body;
        card.append(title,text,button('Répondre',()=>{choose(q.authorKey);replyTo=q.id;feedback.textContent='Réponse au congé n° '+q.leaveId;body.focus();panel.scrollIntoView({block:'center',behavior:'smooth'});}));return card;
      }));
      if(peer&&panel.open&&!history)await load();
    }catch(error){feedback.textContent=error.message;}finally{loading=false;}
  }
  contacts.onchange=()=>choose(contacts.value);
  panel.querySelector('[data-older-private]').onclick=()=>load(true);
  panel.querySelector('[data-latest-private]').onclick=()=>{history=false;load();};
  body.oninput=()=>pending=null;
  form.onsubmit=async event=>{
    event.preventDefault();if(sending||!peer)return;sending=true;
    const current=generation,controls=[...form.elements,contacts];controls.forEach(c=>c.disabled=true);
    try{
      pending??={peer,body:body.value,replyTo,requestId:crypto.randomUUID()};
      await api('/api/service-chat/private/messages',json(pending));
      if(current!==generation)return;
      body.value='';pending=null;replyTo=null;history=false;feedback.textContent='Message privé envoyé.';
    }catch(error){feedback.textContent=error.message;}finally{sending=false;controls.forEach(c=>c.disabled=false);}
    await refresh();
  };
  return {refresh,reset};
}
