const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {installedFonts,resourcesAndFonts,inspectServiceCompatibility}=require('../desktop/service-compatibility.cjs'),{buildPresentation,decode}=require('../desktop/presentation.cjs'),{searchCatalog}=require('../desktop/song-catalog.cjs'),{readServiceRehearsal}=require('../desktop/service-rehearsal.cjs');
const protobuf=require('protobufjs/light'),Presentation=protobuf.Root.fromJSON(require('../src/shared/propresenter-schema.json')).lookupType('rv.data.Presentation');
const generated=()=>buildPresentation({title:'Împreună cântăm',slides:[{section:'Verse',text:'Sing together\nYour love is kind'}]});
async function fixture(check){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'stati-compatibility-'));try{await check(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
async function service(directory,bytes=generated()){
 await fs.writeFile(path.join(directory,'song.pro'),bytes);const song=(await searchCatalog(directory)).items[0],plan={id:crypto.randomUUID(),title:'Sunday',date:'2026-11-01',time:'09:25',revision:2,notes:'',songs:[{id:crypto.randomUUID(),songId:song.id,contentHash:song.contentHash,title:song.title,filename:song.filename,reviewed:true}]};
 return{plan,snapshot:await readServiceRehearsal(directory,plan)};
}
test('Windows inventory accepts a single family and lists, and uses a fixed bounded native command',async()=>{
 for(const data of ['"Arial"','["Arial","Times New Roman"]']){let call;const result=await installedFonts({platform:'win32',run:async(...args)=>{call=args;return{stdout:data};}});assert.equal(result.known,true);assert.ok(result.fonts.has('arial'));assert.equal(result.fonts.has('a'),false);assert.equal(call[0],'powershell.exe');assert.ok(call[1].includes('-NoProfile'));assert.equal(call[2].windowsHide,true);assert.equal(call[2].timeout,10000);}
});
test('macOS inventory collects actual font family fields and unavailable inventories remain warnings',async()=>{
 const result=await installedFonts({platform:'darwin',run:async()=>({stdout:JSON.stringify({SPFontsDataType:[{_name:'Font collection',typefaces:[{family:'Arial',full_name:'Arial Bold'}]}]})})});assert.equal(result.known,true);assert.ok(result.fonts.has('arial'));assert.ok(result.fonts.has('arialbold'));
 for(const run of [async()=>{throw Error('Not available');},async()=>({stdout:'invalid json'})])assert.equal((await installedFonts({platform:'win32',run})).known,false);assert.equal((await installedFonts({platform:'linux'})).known,false);
});
test('generated native lyric RTF exposes its actual Arial family and no invented resources',()=>{assert.deepEqual(resourcesAndFonts(generated()),{fonts:['Arial'],resources:[]});});
test('a compatibility report checks every exact appearance and reports installed and missing fonts honestly',()=>fixture(async directory=>{
 const data=await service(directory),repeat={...data.plan.songs[0],id:crypto.randomUUID()};data.plan.songs.push(repeat);data.snapshot=await readServiceRehearsal(directory,data.plan);
 const passed=await inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:true,fonts:new Set(['arial'])}});assert.equal(passed.filter(item=>item.kind==='song').length,2);assert.deepEqual(passed.filter(item=>item.kind==='song').map(item=>item.reference),data.plan.songs.map(song=>song.id));assert.equal(passed.find(item=>item.kind==='font').status,'passed');assert.equal(passed.at(-1).kind,'manual');assert.equal(passed.at(-1).status,'warning');assert.match(passed.at(-1).message,/connected equipment/);
 const unavailable=await inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:false,fonts:new Set()}});assert.match(unavailable.find(item=>item.kind==='font').message,/inventory is unavailable/);
 const missing=await inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:true,fonts:new Set(['other'])}});assert.match(missing.find(item=>item.kind==='font').message,/substitution/);assert.equal(missing.find(item=>item.kind==='font').status,'warning');
}));
test('linked resources produce filename-only warnings without opening, copying or disclosing outside paths or query tokens',()=>fixture(async directory=>{
 const doc=decode(generated());doc.cues[0].actions[0].slide.presentation.baseSlide.elements.push({element:{uuid:{string:crypto.randomUUID()},fill:{enable:true,media:{url:{absoluteString:'file:///private/hidden/never-read/background.png?token=secret'}}}}});
 const bytes=Buffer.from(Presentation.encode(Presentation.fromObject(doc)).finish()),data=await service(directory,bytes),before=await fs.readdir(directory),report=await inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:true,fonts:new Set(['arial'])}});
 const resource=report.find(item=>item.kind==='resource');assert.equal(resource.status,'warning');assert.match(resource.message,/background.png/);assert.doesNotMatch(JSON.stringify(report),/private|hidden|never-read|token=secret/);assert.deepEqual(await fs.readdir(directory),before);assert.deepEqual(await fs.readFile(path.join(directory,'song.pro')),bytes);
}));
test('a presentation replaced after rehearsal cannot pass its checksum-based resource inspection',()=>fixture(async directory=>{
 const data=await service(directory);await fs.writeFile(path.join(directory,'song.pro'),buildPresentation({title:'Changed',slides:[{section:'Verse',text:'Different words'}]}));const report=await inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:true,fonts:new Set(['arial'])}});assert.ok(report.some(item=>item.kind==='resource'&&item.status==='failed'));assert.equal(report.some(item=>item.kind==='font'&&item.status==='passed'),false);
}));
test('cancellation and asynchronous authority revocation reject the whole compatibility check, including during font inventory',()=>fixture(async directory=>{
 const data=await service(directory),controller=new AbortController();controller.abort();await assert.rejects(inspectServiceCompatibility(directory,data.plan,data.snapshot,{signal:controller.signal}),{name:'AbortError'});
 let active=true;await assert.rejects(installedFonts({platform:'win32',checkActive:async()=>{if(!active)throw Error('Operator changed');},run:async()=>{active=false;return{stdout:'"Arial"'};}}),/Operator changed/);
 let calls=0;await assert.rejects(inspectServiceCompatibility(directory,data.plan,data.snapshot,{fontInventory:{known:true,fonts:new Set(['arial'])},checkActive:async()=>{if(++calls>=3)throw Error('Operator changed');}}),/Operator changed/);assert.ok(calls>=3);
}));
