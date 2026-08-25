const CACHE='tp-terminal-v1.9';
const ASSETS=['./terminal.html','./css/terminal.css','./js/terminal-app.js','./js/nfc-utils.js','./js/firebase.js','./terminal-manifest.webmanifest','./assets/tp-logo.png','./assets/terminal-icon-192.png','./assets/terminal-icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return resp;})));});
