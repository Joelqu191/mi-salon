/* Mi Salón: recibir notificaciones push aunque la página esté en segundo plano. */
self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
 let data={};try{data=event.data?event.data.json():{};}catch{}
 const title=typeof data.title==='string'?data.title:'Mi Salón · Nuevo mensaje';
 const body=typeof data.body==='string'?data.body:'Hay un mensaje nuevo en el chat.';
 event.waitUntil(self.registration.showNotification(title,{
  body,icon:'/icon-192.png',badge:'/icon-192.png',tag:'mi-salon-chat-'+(data.id||Date.now()),
  data:{url:'/?chat=1'},silent:false
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.navigate('/?chat=1');return client.focus();}}
  return self.clients.openWindow('/?chat=1');
 })());
});
