const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const delay=()=>new Promise(resolve=>setImmediate(resolve));
const modules=Promise.all([import('../scripts/publish-utils.mjs'),import('../scripts/publish-preview.mjs'),import('../scripts/publish-test-builds.mjs')]);
async function fixture(t,{android=true,windows=true}={}) {
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'stati-publish-test-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  await fs.mkdir(path.join(cwd,'release'));await fs.mkdir(path.join(cwd,'desktop'));
  await fs.writeFile(path.join(cwd,'package.json'),JSON.stringify({version:'0.1.0'}));
  await fs.writeFile(path.join(cwd,'desktop/preview-build.json'),JSON.stringify({number:23}));
  const files=[...(windows?['Stati-Setup-0.1.0-x64.exe','Stati-Setup-0.1.0-x64.exe.blockmap']:[]),...(android?['Stati-Android-0.1.0-test.apk']:[])];
  for(const file of files)await fs.writeFile(path.join(cwd,'release',file),'Local test fixture: '+file);
  return cwd;
}
function githubAdapter({hashArtifact},{corrupt=false,corruptReadback=false,existing=false,existingDraft=false,lookupError=false,accessError=false,push=true,listError=false,listResponse,createdListError=false,createdMatches=1,creationError=false,creationResponse,creationWrongTag=false,draftLookupError=false,wrongDraftId=false,wrongPublishedId=false,failUpload=false}={}) {
 const calls=[],assets=[],repository='repos/markusciani/stati-releases',tag='v0.1.0-preview.23',id=417825008;let active=0,peak=0,draft=true,created=false,drained=false;
 const identity=()=>({id,tag_name:tag,draft,prerelease:true});
 return {calls,assets,get peak(){return peak;},get draft(){return draft;},get drained(){return drained;},async run(command,args){
  assert.equal(command,'gh');assert.equal(args[0],'api');calls.push(args);
  const endpoint=args[1],method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET',input=args.includes('--input')?args[args.indexOf('--input')+1]:null;
  if(endpoint===repository)return accessError?{status:1,stdout:'HTTP/2.0 401 Unauthorized\n'}:{status:0,stdout:JSON.stringify({permissions:{push}})};
  if(endpoint===repository+'/releases?per_page=100'){
   assert(args.includes('--paginate'));assert(args.includes('--slurp'));
   if(listError||created&&createdListError)return{status:1,stdout:'HTTP/2.0 401 Unauthorized\n'};
   if(!created&&listResponse!==undefined)return{status:0,stdout:listResponse};
   const first=[{id:100,tag_name:'v0.1.0-preview.1',draft:false,prerelease:true}],matches=created?Array.from({length:createdMatches},(_,index)=>({...identity(),id:id+index})):existingDraft?[identity()]:[];
   return{status:0,stdout:JSON.stringify([first,matches])};
  }
  if(endpoint===repository+'/releases'&&method==='POST'){
   const payload=JSON.parse(await fs.readFile(input,'utf8'));assert.equal(payload.tag_name,tag);assert.equal(payload.draft,true);assert.equal(payload.prerelease,true);assert.equal(payload.target_commitish,'main');assert.match(payload.body,/not production releases/);created=true;
   if(creationError)return{status:1,stderr:'Lost creation response'};
   return{status:0,stdout:creationResponse??JSON.stringify({...identity(),tag_name:creationWrongTag?'wrong-tag':tag})};
  }
  if(endpoint.startsWith('https://uploads.github.com/')){
   assert(created&&draft);assert.equal(method,'POST');assert.equal(new URL(endpoint).pathname,'/'+repository+'/releases/'+id+'/assets');assert.equal(new URL(endpoint).searchParams.get('name'),path.basename(input));assert(!args.includes('--clobber'));active++;peak=Math.max(peak,active);
   try{await delay();if(failUpload&&input.endsWith('.exe'))return{status:1};const artifact=await hashArtifact(input),asset={name:artifact.name,size:artifact.bytes,digest:'sha256:'+artifact.sha256};assets.push(asset);return{status:0,stdout:JSON.stringify({...asset,digest:corrupt?'sha256:'+'0'.repeat(64):asset.digest})};}finally{active--;drained=active===0;}
  }
  if(endpoint===repository+'/releases/'+id&&method==='PATCH'){assert.equal(active,0);assert.deepEqual(JSON.parse(await fs.readFile(input,'utf8')),{draft:false});draft=false;return{status:0,stdout:JSON.stringify({...identity(),assets})};}
  if(endpoint===repository+'/releases/tags/'+tag){if(!created||draft){if(existing)return{status:0,stdout:'{}'};return{status:1,stdout:lookupError?'HTTP/2.0 401 Unauthorized\n':'HTTP/2.0 404 Not Found\n'};}}
  else{assert.equal(endpoint,repository+'/releases/'+id,'draft readback must use the creation response ID');if(draftLookupError)return{status:1,stdout:'HTTP/2.0 404 Not Found\n'};}
  assert.equal(active,0);const remote=assets.map((asset,index)=>({...asset,digest:corruptReadback&&index===0?'sha256:'+'0'.repeat(64):asset.digest}));
  return{status:0,stdout:JSON.stringify({...identity(),id:id+(draft&&wrongDraftId||!draft&&wrongPublishedId?1:0),assets:remote,html_url:'https://example.test/verified-release'})};
 }};
}
function guards() {
  const checked=[];
  return {checked,verifyWindows:async()=>{checked.push('windows');},verifyAndroid:async()=>{checked.push('android');}};
}
function metadataRows(sql) {
  return [...sql.matchAll(/VALUES\('([^']+)','((?:''|[^'])*)'\)/g)].map(match=>({key:match[1],value:match[2].replaceAll("''","'")}));
}

test('publication platform defaults preserve both platforms and reject ambiguous selections',async()=>{
  const [utils]=await modules;
  assert.equal(utils.publicationPlatform([]),'all');
  assert.equal(utils.publicationPlatform(['--platform=windows']),'windows');
  assert.equal(utils.publicationPlatform(['--platform=android']),'android');
  assert.throws(()=>utils.publicationPlatform(['--platform=linux']),/Use --platform/);
  assert.throws(()=>utils.publicationPlatform(['--platform=']),/Use --platform/);
  assert.throws(()=>utils.publicationPlatform(['--platform','windows']),/Use --platform/);
  assert.throws(()=>utils.publicationPlatform(['--platform=windows','--platform=all']),/only once/);
});

test('failed parallel uploads drain already started work and do not start another artifact',async()=>{
  const [utils]=await modules;let release;const pending=new Promise(resolve=>{release=resolve;});const started=[],finished=[];
  const publication=utils.mapUploads([0,1,2],async index=>{started.push(index);if(index===0)throw Error('first failed');await pending;finished.push(index);});
  await delay();assert.deepEqual(started,[0,1]);let settled=false;publication.catch(()=>{settled=true;});await delay();assert.equal(settled,false);
  release();await assert.rejects(publication,/first failed/);assert.deepEqual(finished,[1]);
});

test('Windows-only GitHub publication requires no APK or Android SDK and verifies a draft before visibility',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t,{android:false}),checks=guards(),adapter=githubAdapter(utils);
  const result=await preview.publishPreview({cwd,argv:['--preview=23','--platform=windows'],env:{},...checks,run:adapter.run});
  assert.deepEqual(checks.checked,['windows']);assert.equal(result.platform,'windows');assert.equal(adapter.draft,false);assert.equal(adapter.peak,2);
  assert.deepEqual(adapter.assets.map(asset=>asset.name).sort(),['SHA256SUMS.txt','Stati-Setup-0.1.0-x64.exe','Stati-Setup-0.1.0-x64.exe.blockmap']);
  assert.equal(result.releaseId,417825008);assert.equal(adapter.calls.filter(args=>args[0]==='api').length,10);
  const numeric=adapter.calls.findIndex(args=>args[0]==='api'&&/\/releases\/417825008$/.test(args[1])),edit=adapter.calls.findIndex(args=>args.includes('PATCH'));
  assert(numeric>0&&numeric<edit,'verify the draft by numeric ID before publishing');
  assert.equal(adapter.calls.filter(args=>args[0]==='api'&&args[1].includes('/releases/tags/')).length,2,'by-tag readback is only preflight and published confirmation');
});

test('default GitHub publication includes both guarded platforms with at most two concurrent uploads',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t),checks=guards(),adapter=githubAdapter(utils);
  const result=await preview.publishPreview({cwd,argv:['--preview=23'],...checks,run:adapter.run});
  assert.deepEqual(checks.checked,['windows','android']);assert.equal(result.artifacts.length,4);assert.equal(adapter.peak,2);
});

test('Android-only GitHub publication does not require Windows packaging files',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t,{windows:false}),checks=guards(),adapter=githubAdapter(utils);
  await preview.publishPreview({cwd,argv:['--preview=23','--platform=android'],...checks,run:adapter.run});
  assert.deepEqual(checks.checked,['android']);assert.deepEqual(adapter.assets.map(asset=>asset.name).sort(),['SHA256SUMS.txt','Stati-Android-0.1.0-test.apk']);
});

test('mismatched GitHub checksum leaves a draft and never replaces or deletes assets',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t),adapter=githubAdapter(utils,{corrupt:true});
  await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/checksum or size/);
  assert.equal(adapter.draft,true);assert(!adapter.calls.some(args=>args.includes('PATCH')||args[1]==='delete'));
});

test('failed GitHub upload finishes in-flight work without publishing',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t),adapter=githubAdapter(utils,{failUpload:true});
  await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/upload failed/);
  assert.equal(adapter.drained,true);assert.equal(adapter.draft,true);assert(!adapter.calls.some(args=>args.includes('PATCH')));
});

test('existing GitHub tags, paginated drafts and lookup authentication errors cannot reach any mutation',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t);
  for(const options of [{existing:true},{existingDraft:true},{lookupError:true},{accessError:true},{push:false},{listError:true}]) {
    const adapter=githubAdapter(utils,options);
    await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),options.existing||options.existingDraft?/already exists/:/Could not confirm/);
    assert(adapter.calls.every(args=>args[0]==='api'&&!args.includes('--method')));
  }
});

test('invalid or incomplete GitHub draft lists fail closed before creation',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t);
  for(const listResponse of ['not JSON','{}','[]','[{}]','[[null]]','[[{"id":1,"draft":true}]]','[[{"id":"1","tag_name":"old","draft":true}]]']) {
    const adapter=githubAdapter(utils,{listResponse});
    await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/invalid preview release list/);
    assert(adapter.calls.every(args=>args[0]==='api'&&!args.includes('--method')));
  }
});

test('failed or invalid creation responses preserve the uncertain draft and never upload or publish',async t=>{
 const [utils,preview]=await modules,cwd=await fixture(t);
 for(const options of [{creationError:true},{creationResponse:'not JSON'},{creationResponse:'{}'},{creationWrongTag:true}]){
  const adapter=githubAdapter(utils,options);await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/Inspect the existing release before retrying/);
  assert.equal(adapter.draft,true);assert(!adapter.calls.some(args=>args[1].startsWith('https://uploads.github.com/')||args.includes('PATCH')));
 }
});
test('creation uses its returned numeric ID even when a newly created draft is absent from listings',async t=>{
 const [utils,preview]=await modules,cwd=await fixture(t),adapter=githubAdapter(utils,{createdListError:true,createdMatches:0});
 const result=await preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run});assert.equal(result.releaseId,417825008);assert.equal(adapter.calls.filter(args=>args[1].endsWith('/releases?per_page=100')).length,1);assert.equal(adapter.draft,false);
});

test('numeric draft readback failure or identity mismatch never publishes the draft',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t);
  for(const options of [{draftLookupError:true},{wrongDraftId:true}]) {
    const adapter=githubAdapter(utils,options);
    await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/Inspect the existing release before retrying/);
    assert.equal(adapter.draft,true);assert(!adapter.calls.some(args=>args.includes('PATCH')||args[1]==='delete'));
  }
});

test('published by-tag readback must identify the same release verified as a draft',async t=>{
  const [utils,preview]=await modules,cwd=await fixture(t),adapter=githubAdapter(utils,{wrongPublishedId:true});
  await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23'],...guards(),run:adapter.run}),/release identity did not match/);
  assert.equal(adapter.draft,false);assert.equal(adapter.calls.filter(args=>args.includes('PATCH')).length,1);assert(!adapter.calls.some(args=>args[1]==='delete'));
});

test('selected platform safety checks still stop publication before remote calls',async t=>{
  const [,preview]=await modules,cwd=await fixture(t);
  let calls=0;
  await assert.rejects(preview.publishPreview({cwd,argv:['--preview=23','--platform=windows'],run:async()=>{calls++;},verifyWindows:async()=>{throw Error('Wrong packaged preview');}}),/Wrong packaged preview/);
  assert.equal(calls,0);
});

test('Android preview guard rejects production identity while accepting the separate debug version',async t=>{
  const [,preview]=await modules,cwd=await fixture(t),sdk=path.join(cwd,'sdk');
  await fs.mkdir(path.join(sdk,'build-tools/36.0.0'),{recursive:true});
  const options={cwd,version:'0.1.0',env:{ANDROID_HOME:sdk}};
  await assert.rejects(preview.verifyAndroidPreview({...options,run:async()=>({status:0,stdout:"package: name='org.hapiproducts.stati' versionName='0.1.0'"})}),/separate Android debug identity/);
  await preview.verifyAndroidPreview({...options,run:async()=>({status:0,stdout:"package: name='org.hapiproducts.stati.debug' versionName='0.1.0-test'"})});
});

test('Windows-only website download publication leaves Android metadata untouched',async t=>{
  const [,,downloads]=await modules,cwd=await fixture(t,{android:false}),checks=guards(),calls=[];let sql,query;
  const result=await downloads.publishTestBuilds({cwd,argv:['--platform=windows'],env:{},...checks,run:async(command,args)=>{
    calls.push(args);assert.equal(command,process.execPath);
    if(args.includes('--file')&&args.includes('d1'))sql=await fs.readFile(args[args.indexOf('--file')+1],'utf8');
    if(args.includes('--command')) {query=args[args.indexOf('--command')+1];return {status:0,stdout:JSON.stringify([{success:true,results:metadataRows(sql)}])};}
    return {status:0};
  }});
  assert.deepEqual(checks.checked,['windows']);assert.equal(calls.length,3);assert.equal(result.records.length,1);assert.equal(result.metadataVerified,true);
  assert.match(sql,/release_windows-test/);assert(!sql.includes('release_android-test'));
  assert.match(query,/release_windows-test/);assert(!query.includes('release_android-test'));
  assert(calls.every(args=>args.includes('--remote')&&args.includes('production')));
});

test('both website artifacts upload concurrently before the one metadata publication',async t=>{
  const [,,downloads]=await modules,cwd=await fixture(t),checks=guards();let active=0,peak=0,finished=0,metadata=0,sql;
  await downloads.publishTestBuilds({cwd,...checks,run:async(command,args)=>{
    if(args.includes('r2')) {active++;peak=Math.max(peak,active);await delay();active--;finished++;return {status:0};}
    assert.equal(active,0);assert.equal(finished,2);
    if(args.includes('--command'))return {status:0,stdout:JSON.stringify([{success:true,results:metadataRows(sql).reverse()}])};
    metadata++;sql=await fs.readFile(args[args.indexOf('--file')+1],'utf8');return {status:0};
  }});
  assert.equal(peak,2);assert.equal(metadata,1);assert.deepEqual(checks.checked,['windows','android']);
});

test('website metadata readback mismatch fails publication confirmation after its write',async t=>{
  const [,,downloads]=await modules,cwd=await fixture(t,{android:false});let sql,writes=0;
  await assert.rejects(downloads.publishTestBuilds({cwd,argv:['--platform=windows'],...guards(),run:async(command,args)=>{
    if(args.includes('--command')) {
      const rows=metadataRows(sql),actual=JSON.parse(rows[0].value);actual.sha256='0'.repeat(64);rows[0].value=JSON.stringify(actual);
      return {status:0,stdout:JSON.stringify([{success:true,results:rows}])};
    }
    if(args.includes('d1')) {writes++;sql=await fs.readFile(args[args.indexOf('--file')+1],'utf8');}
    return {status:0};
  }}),/readback did not match/);
  assert.equal(writes,1);
});

test('metadata readback validates all fields, exact selected platforms and query success',async()=>{
  const [,,downloads]=await modules,record={id:'windows-test',filename:'local.exe',version:'0.1.0',objectKey:'releases/test/local.exe',bytes:25,sha256:'a'.repeat(64),test:true};
  const rows=[{key:'release_windows-test',value:JSON.stringify(record)}],response=results=>[{success:true,results}];
  assert.deepEqual(downloads.verifyDownloadMetadata(response(rows),[record]),[record]);
  for(const [field,value] of Object.entries({bytes:26,objectKey:'wrong',test:false,filename:'wrong.exe',version:'0.2.0',id:'android-test',sha256:'b'.repeat(64)}))assert.throws(()=>downloads.verifyDownloadMetadata(response([{key:rows[0].key,value:JSON.stringify({...record,[field]:value})}]),[record]),/readback did not match/);
  assert.throws(()=>downloads.verifyDownloadMetadata(response([]),[record]),/every selected platform/);
  assert.throws(()=>downloads.verifyDownloadMetadata(response([{key:'release_android-test',value:rows[0].value}]),[record]),/unexpected or duplicate/);
  assert.throws(()=>downloads.verifyDownloadMetadata([{success:false,results:rows}],[record]),/invalid result/);
});

test('one failed website upload cannot publish either metadata key and drains the other upload',async t=>{
  const [,,downloads]=await modules,cwd=await fixture(t);let finished=0,metadata=0;
  await assert.rejects(downloads.publishTestBuilds({cwd,...guards(),run:async(command,args)=>{
    if(args.includes('d1')) {metadata++;return {status:0};}
    await delay();finished++;return {status:args.some(arg=>arg.endsWith('.exe'))?1:0};
  }}),/published metadata was preserved/);
  assert.equal(finished,2);assert.equal(metadata,0);
});

test('artifact mutation during website upload prevents metadata publication',async t=>{
  const [,,downloads]=await modules,cwd=await fixture(t,{android:false});let metadata=0;
  await assert.rejects(downloads.publishTestBuilds({cwd,argv:['--platform=windows'],...guards(),run:async(command,args)=>{
    if(args.includes('d1'))metadata++;
    else await fs.appendFile(path.join(cwd,'release/Stati-Setup-0.1.0-x64.exe'),'Changed after upload');
    return {status:0};
  }}),/changed during upload/);
  assert.equal(metadata,0);
});

test('command adapter preserves process exit status and treats arguments literally',async()=>{
  const [utils]=await modules;
  const result=await utils.runCommand(process.execPath,['-e','process.stdout.write(process.argv[1]);process.exit(7)','$(do-not-execute); literal']);
  assert.equal(result.status,7);assert.equal(result.stdout,'$(do-not-execute); literal');
});
