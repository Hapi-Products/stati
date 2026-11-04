// Local Apple Silicon preview. Never select a certificate from the keychain.
const base=require('./builder.json');
const path=require('node:path');
const {readdirSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
function matchHelperBundleNames(context){
 if(context.electronPlatformName!=='darwin')throw Error('The Mac preview hook only accepts a Mac application.');
 const application=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
 // electron-builder 26 normalizes helper names to NFD but writes CFBundleName
 // from the NFC display name. Electron resolves helpers by that exact string.
 // Keep the visible display name and match the actual on-disk helper base.
 // Upstream fix: electron-userland/electron-builder#9962 (v27).
 const helpers=readdirSync(path.join(application,'Contents/Frameworks')).filter(name=>name.endsWith(' Helper.app'));
 if(helpers.length!==1)throw Error('Expected exactly one base Mac helper bundle.');
 const helperBase=helpers[0].slice(0,-' Helper.app'.length);
 const result=spawnSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleName '+helperBase,path.join(application,'Contents/Info.plist')],{encoding:'utf8'});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Mac helper name alignment failed: '+result.stderr);
}
module.exports={...base,directories:{output:'builds/mac-preview'},publish:null,artifactName:'Stati-Mac-${version}-${arch}.${ext}',afterPack:matchHelperBundleNames,mac:{target:[{target:'dmg',arch:['arm64']},{target:'zip',arch:['arm64']}],category:'public.app-category.productivity',identity:null,hardenedRuntime:false,notarize:false,minimumSystemVersion:'13.0',icon:'public/icon-512.png',extendInfo:{NSHumanReadableCopyright:'Hapi Products',NSHighResolutionCapable:true}},dmg:{title:'Stați — Mac Preview',sign:false,contents:[{x:145,y:180,type:'file'},{x:430,y:180,type:'link',path:'/Applications'}],window:{width:580,height:360}}};
