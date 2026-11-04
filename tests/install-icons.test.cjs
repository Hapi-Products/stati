const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom'),{imageSize}=require('image-size');
const html=fs.readFileSync('index.html','utf8'),{document}=parseHTML(html),manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));
function asset(url){assert.match(url,/^\/[a-z0-9.-]+$/);const file=path.join('public',url.slice(1));assert.equal(fs.statSync(file).isFile(),true);return fs.readFileSync(file);}
test('iPhone has an explicit 180px app icon and root fallback copies of the same real artwork',()=>{
 const icon=document.querySelector('link[rel="apple-touch-icon"]');assert.ok(icon);assert.equal(icon.getAttribute('sizes'),'180x180');assert.equal(document.querySelector('meta[name="apple-mobile-web-app-title"]').getAttribute('content'),'Stați');
 const bytes=asset(icon.getAttribute('href')),size=imageSize(bytes);assert.equal(size.type,'png');assert.equal(size.width,180);assert.equal(size.height,180);assert.ok(bytes.length>10000,'The icon must include the supplied artwork.');
 for(const fallback of ['/apple-touch-icon.png','/apple-touch-icon-precomposed.png'])assert.deepEqual(asset(fallback),bytes);
});
test('web app and favicon metadata point to real PNGs at their declared sizes, with a separate maskable icon',()=>{
 assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.short_name,'Stați');
 assert.equal(manifest.icons.filter(icon=>icon.purpose==='maskable').length,1);assert.equal(manifest.icons.filter(icon=>icon.purpose==='any').length,2);
 for(const icon of [...manifest.icons,...[...document.querySelectorAll('link[rel="icon"]')].map(link=>({src:link.getAttribute('href'),sizes:link.getAttribute('sizes'),type:link.getAttribute('type')}))]){assert.equal(icon.type,'image/png');const [width,height]=icon.sizes.split('x').map(Number),size=imageSize(asset(icon.src));assert.equal(size.type,'png');assert.equal(size.width,width);assert.equal(size.height,height);}
 const ico=asset(document.querySelector('link[rel="shortcut icon"]').getAttribute('href'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),2);
 for(let index=0;index<2;index++){const offset=6+index*16,bytes=ico.subarray(ico.readUInt32LE(offset+12),ico.readUInt32LE(offset+12)+ico.readUInt32LE(offset+8)),size=imageSize(bytes);assert.equal(size.width,index===0?16:32);assert.equal(size.height,size.width);}
 assert.doesNotMatch(html,/icon\.svg/);assert.ok(!manifest.icons.some(icon=>icon.src.endsWith('.svg')));
});
test('the install cache covers every referenced icon without caching signed-in app pages',()=>{
 const context={self:{addEventListener(){}},URL};vm.createContext(context);vm.runInContext(fs.readFileSync('public/sw.js','utf8')+'\nglobalThis.assets=ASSETS;globalThis.cacheName=CACHE;',context);assert.equal(context.cacheName,'stati-install-assets-v3');
 for(const link of document.querySelectorAll('link[rel*="icon"]'))assert.ok(context.assets.includes(link.getAttribute('href')));for(const icon of manifest.icons)assert.ok(context.assets.includes(icon.src));assert.ok(context.assets.includes('/manifest.webmanifest'));assert.ok(!context.assets.includes('/'));assert.ok(!context.assets.some(url=>url.startsWith('/api/')));
});
