function privatePath(value){
  if(typeof value!=='string')return null;
  try{const url=new URL(value,self.location.origin),peer=url.searchParams.get('private');
    if(url.origin!==self.location.origin||url.pathname!=='/discussion'||!(/^(admin|(?:employee|manager):[1-9][0-9]{0,17})$/.test(peer||'')))return null;
    return '/discussion?'+(url.searchParams.get('mode')==='manager'?'mode=manager&':'')+'private='+encodeURIComponent(peer);
  }catch{return null;}
}
// No fetch handler or message cache: private conversation data remains on the server.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const schedule=['schedule-published','schedule-updated'].includes(data.kind)&&/^20\d{2}-\d{2}-\d{2}$/.test(data.week||'')&&!Number.isNaN(Date.parse(data.week+'T12:00:00Z'));
  const privateUrl=['leave-question','private-message'].includes(data.kind)?privatePath(data.url):null;
  const question=!!privateUrl&&data.kind==='leave-question';
  const url=privateUrl|| (schedule?'/horaires-departements?week='+data.week:data.url==='/discussion?mode=manager'?data.url:'/discussion');
  const week=schedule?new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(data.week+'T12:00:00Z')):'';
  event.waitUntil(self.registration.showNotification(
    privateUrl?(question?'🔴 Réponse requise — congé':'Nouveau message privé'):schedule?(data.kind==='schedule-published'?'Nouvel horaire du Service':'Horaire du Service modifié'):data.title==='Notifications activées'?data.title:'Discussion du Service',
    {body:privateUrl?(question?'Une question sur ton congé attend ta réponse. Ouvre pour répondre.':'Un message privé t’attend. Ouvre pour répondre.'):schedule?`Semaine du ${week} : ${data.kind==='schedule-published'?'ton horaire est disponible.':'des changements ont été publiés. Consulte ton horaire à jour.'}`:data.title==='Notifications activées'?'Ce téléphone peut recevoir les notifications du Service.':'Un nouveau message attend l’équipe du Service.',
      icon:'/portal-icon-192.png',badge:'/portal-icon-192.png',
      tag:typeof data.tag==='string'?data.tag.slice(0,100):'service-chat',
      requireInteraction:question,actions:privateUrl?[{action:'reply',title:'Répondre'}]:[],
      data:{url}}
  ));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url;
  const path=privatePath(target)|| (/^\/horaires-departements\?week=20\d{2}-\d{2}-\d{2}$/.test(target||'')?target:target==='/discussion?mode=manager'?'/discussion?mode=manager':'/discussion');
  const url=new URL(path,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(client.url===url){await client.focus();return;}
    }
    await self.clients.openWindow(url);
  })());
});
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
