export function addLeaveQuestions(container,requests,departments,employees,api){
  for(const card of container.querySelectorAll('.request')){
    const request=requests.find(r=>String(r.id)===card.dataset.id);
    if(!request||request.is_test||request.archived_at||departments.find(d=>String(d.id)===String(request.department_id))?.code!=='service')continue;
    const section=document.createElement('details'),title=document.createElement('summary');title.textContent='Poser une question en privé sur ce congé';section.append(title);
    const help=document.createElement('p');help.textContent='La question apparaît en rouge dans le chat de l’employé, avec une notification si son téléphone est activé. Le bouton « Répondre par courriel » reste disponible; cette question privée n’envoie pas de courriel.';section.append(help);
    let select=null;
    if(!request.employee_id){
      const label=document.createElement('label');label.textContent='Vérifier le nom et choisir le destinataire';select=document.createElement('select');
      select.append(new Option('Choisir l’employé…',''),...employees.filter(e=>e.active).map(e=>new Option(e.name,e.id)));label.append(select);section.append(label);
    }
    const label=document.createElement('label');label.textContent='Question à l’employé';const input=document.createElement('textarea');input.rows=3;input.maxLength=4000;label.append(input);section.append(label);
    const button=document.createElement('button');button.type='button';button.textContent='Envoyer la question en privé';section.append(button);
    const status=document.createElement('p');status.setAttribute('role','status');section.append(status);
    let pending=null;input.oninput=()=>pending=null;if(select)select.onchange=()=>pending=null;
    button.onclick=async()=>{
      if(!input.value.trim()){status.textContent='Écrivez votre question.';return;}
      if(select&&!select.value){status.textContent='Choisissez l’employé après avoir vérifié son nom.';return;}
      button.disabled=true;input.disabled=true;if(select)select.disabled=true;
      try{
        pending??={body:input.value,leaveId:String(request.id),employeeId:select?.value,requestId:crypto.randomUUID()};
        const message=await api('/api/service-chat/private/messages?mode=manager',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
        pending=null;input.value='';status.textContent='Question enregistrée. Notification prévue sur les appareils activés. ';
        const link=document.createElement('a');link.href='/discussion?mode=manager&private='+encodeURIComponent(message.recipientKey);link.textContent='Ouvrir l’échange privé et consulter la réponse';status.append(link);
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;input.disabled=false;if(select)select.disabled=false;}
    };
    card.append(section);
  }
}
