// No fetch handler or message cache: private conversation data remains on the server.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const schedule=['schedule-published','schedule-updated'].includes(data.kind)&&/^20\d{2}-\d{2}-\d{2}$/.test(data.week||'')&&!Number.isNaN(Date.parse(data.week+'T12:00:00Z'));
  const url=schedule?'/horaires-departements?week='+data.week:data.url==='/discussion?mode=manager'?data.url:'/discussion';
  const week=schedule?new Intl.DateTimeFormat('fr-CA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(data.week+'T12:00:00Z')):'';
  event.waitUntil(self.registration.showNotification(
    schedule?(data.kind==='schedule-published'?'Nouvel horaire du Service':'Horaire du Service modifié'):data.title==='Notifications activées'?data.title:'Discussion du Service',
    {body:schedule?`Semaine du ${week} : ${data.kind==='schedule-published'?'ton horaire est disponible.':'des changements ont été publiés. Consulte ton horaire à jour.'}`:data.title==='Notifications activées'?'Ce téléphone peut recevoir les notifications du Service.':'Un nouveau message attend l’équipe du Service.',
      icon:'/portal-icon-192.png',badge:'/portal-icon-192.png',
      tag:typeof data.tag==='string'?data.tag.slice(0,100):'service-chat',
      data:{url}}
  ));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url;
  const path=/^\/horaires-departements\?week=20\d{2}-\d{2}-\d{2}$/.test(target||'')?target:target==='/discussion?mode=manager'?'/discussion?mode=manager':'/discussion';
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
