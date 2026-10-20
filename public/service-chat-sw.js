// No fetch handler or message cache: private conversation data remains on the server.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const url=data.url==='/discussion?mode=manager'?data.url:'/discussion';
  event.waitUntil(self.registration.showNotification(
    data.title==='Notifications activées'?data.title:'Discussion du Service',
    {body:data.title==='Notifications activées'?'Ce téléphone peut recevoir les notifications du Service.':'Un nouveau message attend l’équipe du Service.',
      icon:'/portal-icon-192.png',badge:'/portal-icon-192.png',
      tag:typeof data.tag==='string'?data.tag.slice(0,100):'service-chat',
      data:{url}}
  ));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const path=event.notification.data?.url==='/discussion?mode=manager'?'/discussion?mode=manager':'/discussion';
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
