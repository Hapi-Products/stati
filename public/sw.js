// Cache only public install assets. Accounts, application code, files and version checks use the network.
const CACHE='stati-install-assets-v3';
const ASSETS=['/brand-icon.png','/icon-192.png','/icon-512.png','/apple-touch-icon-stati-v3.png','/apple-touch-icon.png','/apple-touch-icon-precomposed.png','/favicon-stati-v3-16.png','/favicon-stati-v3-32.png','/favicon.ico','/icon-stati-v3-192.png','/icon-stati-v3-512.png','/icon-stati-v3-maskable-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin===self.location.origin&&ASSETS.includes(url.pathname))event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));});
