importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

fetch('/api/config').then(r=>r.json()).then(config=>{
  if(!config.notificationsEnabled || !config.firebase) return;
  firebase.initializeApp(config.firebase);
  const messaging=firebase.messaging();
  messaging.onBackgroundMessage(payload=>{
    const n=payload.notification||{};
    self.registration.showNotification(n.title||'FlipSheet',{body:n.body||'Your spreadsheet automation finished.',icon:'/assets/icon-128.png',data:payload.data||{}});
  });
}).catch(()=>{});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'/';
  event.waitUntil(clients.openWindow(url));
});
