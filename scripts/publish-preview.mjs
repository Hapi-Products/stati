import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {publicationPlatform,publicationArtifacts,hashArtifact,mapUploads,runCommand,verifyReleaseAssets} from './publish-utils.mjs';
import buildGuard from '../desktop/build-release-guard.cjs';

export async function verifyWindowsPreview({cwd,preview}) {
  const source=join(cwd,'desktop/powerpoint.ps1'),unpacked=join(cwd,'release/win-unpacked/resources/app.asar.unpacked/desktop/powerpoint.ps1');
  if(!existsSync(unpacked)||(await readFile(unpacked)).compare(await readFile(source))!==0)throw Error('PowerPoint script must exist outside ASAR and match source.');
  const require=createRequire(join(cwd,'package.json')),asar=join(cwd,'release/win-unpacked/resources/app.asar');
  const packagedBuild=JSON.parse(require('@electron/asar').extractFile(asar,'desktop/preview-build.json').toString());
  if(packagedBuild.number!==Number(preview))throw Error('Packaged preview number does not match publication. Set desktop/preview-build.json before building.');
  if(existsSync(join(cwd,'.dev.vars'))) {
    const secret=(await readFile(join(cwd,'.dev.vars'),'utf8')).match(/^ENROLLMENT_SECRET="?([a-f0-9]{64})"?$/m)?.[1];
    if(secret&&(await readFile(asar)).includes(Buffer.from(secret)))throw Error('Authenticator secret detected in app package.');
  }
}

export async function verifyAndroidPreview({cwd,version,env,run}) {
  const sdk=env.ANDROID_HOME||env.ANDROID_SDK_ROOT||join(homedir(),'Library/Android/sdk');
  const tools=(await readdir(join(sdk,'build-tools'))).filter(v=>/^\d+\.\d+\.\d+$/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
  if(!tools)throw Error('Android build tools are required to inspect the preview identity.');
  const result=await run(join(sdk,'build-tools',tools,process.platform==='win32'?'aapt.exe':'aapt'),['dump','badging',`release/Stati-Android-${version}-test.apk`],{cwd,env});
  if(result.status!==0||!result.stdout.includes("package: name='org.hapiproducts.stati.debug'")||!result.stdout.includes("versionName='"+version+"-test'"))throw Error('Only the separate Android debug identity can be published as a preview.');
}

async function listReleases({repository,cwd,env,run}) {
  const result=await run('gh',['api',`repos/${repository}/releases?per_page=100`,'--paginate','--slurp'],{cwd,env});
  if(result.status!==0)throw Error('Could not confirm the preview release list. Check GitHub authentication and connectivity before publishing.');
  let pages;try{pages=JSON.parse(result.stdout);}catch{throw Error('GitHub returned an invalid preview release list.');}
  if(!Array.isArray(pages)||!pages.length||!pages.every(page=>Array.isArray(page)&&page.every(release=>Number.isSafeInteger(release?.id)&&release.id>0&&typeof release.tag_name==='string'&&typeof release.draft==='boolean')))throw Error('GitHub returned an invalid preview release list.');
  return pages.flat();
}

function verifyReleaseIdentity(release,{tag,id,draft}) {
  if(!Number.isSafeInteger(release?.id)||release.id<1||release.tag_name!==tag||release.draft!==draft||release.prerelease!==true||(id!==undefined&&release.id!==id))throw Error('GitHub preview release identity did not match the expected draft or tag.');
  return release.id;
}

export async function publishPreview({argv=process.argv.slice(2),cwd=process.cwd(),env=process.env,run=runCommand,verifyWindows=verifyWindowsPreview,verifyAndroid=verifyAndroidPreview,checkBuilds=buildGuard.requireBuildsAllowed}={}) {
  const platform=publicationPlatform(argv),version=JSON.parse(await readFile(join(cwd,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Use a stable app version.');
  const preview=argv.find(arg=>arg.startsWith('--preview='))?.slice(10)||'1';
  if(!/^[1-9]\d{0,3}$/.test(preview))throw Error('Use a numeric preview number from 1 to 9999.');
  const notesPath=argv.find(arg=>arg.startsWith('--notes-file='))?.slice(13);
  const extraNotes=notesPath?await readFile(resolve(cwd,notesPath),'utf8'):'';
  if(extraNotes.length>16000)throw Error('Preview notes are too long.');
  const artifacts=publicationArtifacts(version,platform,{blockmap:true});
  const expected=await mapUploads(artifacts,artifact=>hashArtifact(join(cwd,artifact.path)));
  if(platform!=='android')await verifyWindows({cwd,version,preview,env,run});
  if(platform!=='windows')await verifyAndroid({cwd,version,preview,env,run});
  const repository='markusciani/stati-releases',tag=`v${version}-preview.${preview}`,endpoint=`repos/${repository}/releases/tags/${tag}`;
  const existing=await run('gh',['api',endpoint,'--include'],{cwd,env});
  if(existing.status===0)throw Error('This preview tag already exists. Keep published artifacts immutable and use a new version.');
  if(!/^HTTP\/[\d.]+ 404\b/m.test(existing.stdout))throw Error('Could not confirm that the preview tag is unused. Check GitHub authentication and connectivity before publishing.');
  // By-tag lookup only covers published releases. Drafts appear in the list only
  // for a caller with push access, so a public/read-only listing is insufficient.
  const access=await run('gh',['api',`repos/${repository}`],{cwd,env});
  let repo;try{repo=JSON.parse(access.stdout);}catch{}
  if(access.status!==0||repo?.permissions?.push!==true)throw Error('Could not confirm GitHub push access to inspect existing preview drafts.');
  if((await listReleases({repository,cwd,env,run})).some(release=>release.tag_name===tag))throw Error('This preview tag already exists, including a draft. Keep published artifacts immutable and use a new version.');
  const directory=await mkdtemp(join(tmpdir(),'stati-public-preview-'));let created=false;
  try {
    const checksums=join(directory,'SHA256SUMS.txt'),notes=join(directory,'notes.md');
    await writeFile(checksums,expected.map(file=>file.sha256+'  '+file.name).join('\n')+'\n');
    const warnings=[platform!=='android'?'Windows is unsigned.':'',platform!=='windows'?'Android uses a separate debug app identity and development signature.':''].filter(Boolean).join(' ');
    await writeFile(notes,'Stați by Hapi Products — preview builds for device testing.\n\n'+warnings+' These are not production releases. Stable automatic updates remain gated on signing and target-device verification.\n\nThis release contains the selected app installers, any Windows update block map and checksums only. It contains no workspace archive, account database, user files or signing keys.'+(extraNotes?'\n\n'+extraNotes:''));
    expected.push(await hashArtifact(checksums));
    const creationFile=join(directory,'create-release.json');
    await writeFile(creationFile,JSON.stringify({tag_name:tag,target_commitish:'main',draft:true,prerelease:true,name:`Stați ${version} preview ${preview}`,body:await readFile(notes,'utf8')})+'\n');
    // Capture the ID from the creation response. Newly created drafts can be
    // temporarily missing from the list endpoint even for an authenticated writer.
    await checkBuilds();
    created=true;
    const creation=await run('gh',['api',`repos/${repository}/releases`,'--method','POST','--input',creationFile],{cwd,env});
    if(creation.status!==0)throw Error('Could not confirm preview draft creation.');
    let createdRelease;try{createdRelease=JSON.parse(creation.stdout);}catch{throw Error('GitHub returned an invalid created preview draft.');}
    const releaseId=verifyReleaseIdentity(createdRelease,{tag,draft:true}),draftEndpoint=`repos/${repository}/releases/${releaseId}`;
    await mapUploads([...artifacts.map(artifact=>join(cwd,artifact.path)),checksums],async file=>{
      const result=await run('gh',['api',`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(basename(file))}`,'--method','POST','--header','Content-Type: application/octet-stream','--input',file],{cwd,env});
      if(result.status!==0)throw Error('Preview upload failed.');
      let asset;try{asset=JSON.parse(result.stdout);}catch{throw Error('GitHub returned an invalid uploaded preview asset.');}
      const expectedAsset=expected.find(item=>item.name===basename(file));
      if(!expectedAsset||asset.name!==expectedAsset.name||asset.size!==expectedAsset.bytes||asset.digest?.toLowerCase()!=='sha256:'+expectedAsset.sha256)throw Error('GitHub uploaded asset checksum or size did not match.');
    });
    const uploaded=await run('gh',['api',draftEndpoint],{cwd,env});
    if(uploaded.status!==0)throw Error('Could not verify uploaded preview assets.');
    const draft=JSON.parse(uploaded.stdout);
    verifyReleaseIdentity(draft,{tag,id:releaseId,draft:true});
    verifyReleaseAssets(draft,expected,{draft:true});
    const publicationFile=join(directory,'publish-release.json');await writeFile(publicationFile,JSON.stringify({draft:false})+'\n');
    await checkBuilds();
    const publication=await run('gh',['api',draftEndpoint,'--method','PATCH','--input',publicationFile],{cwd,env});
    if(publication.status!==0)throw Error('Preview assets verified, but publishing the draft did not finish.');
    const published=await run('gh',['api',endpoint],{cwd,env});
    if(published.status!==0)throw Error('Could not confirm the published preview. Inspect GitHub before retrying.');
    const release=JSON.parse(published.stdout);
    verifyReleaseIdentity(release,{tag,id:releaseId,draft:false});
    verifyReleaseAssets(release,expected,{draft:false});
    return {tag,releaseId,platform,url:release.html_url,artifacts:expected};
  } catch(error) {
    if(created)throw new Error(error.message+' Inspect the existing release before retrying. Do not overwrite or delete published assets.',{cause:error});
    throw error;
  } finally {await rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.includes('--help'))console.log('Usage: node scripts/publish-preview.mjs --preview=N [--platform=windows|android|all] [--notes-file=path]\nDefault platform: all. Publishes a new verified preview; existing tags are never overwritten.');
  else {
    const result=await publishPreview();
    console.log('Verified preview published: '+result.url);
  }
}
