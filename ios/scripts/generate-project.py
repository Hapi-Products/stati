import plistlib
from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[1]
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
def q(s): return '"'+str(s).replace('\\','\\\\').replace('"','\\"')+'"'
objects={}
def obj(name,value): objects[uid(name)]=value;return uid(name)
swifts=sorted((root/'Stati').rglob('*.swift'))
refs=[];build=[]
for p in swifts:
 rel=p.relative_to(root);ref=obj(str(rel),f'{{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {q(rel)}; sourceTree = SOURCE_ROOT; }}');refs.append(ref)
 build.append(obj('build'+str(rel),f'{{isa = PBXBuildFile; fileRef = {ref}; }}'))
resources=[]
for rel,typ in [('Stati/Assets.xcassets','folder.assetcatalog'),('Stati/PrivacyInfo.xcprivacy','text.xml'),('Stati/AppShortcuts.xcstrings','text.json.xcstrings'),('Stati/Settings.bundle','wrapper.plug-in')]:
 ref=obj(rel,f'{{isa = PBXFileReference; lastKnownFileType = {typ}; path = {q(rel)}; sourceTree = SOURCE_ROOT; }}');refs.append(ref);resources.append(obj('build'+rel,f'{{isa = PBXBuildFile; fileRef = {ref}; }}'))
product=obj('product','{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Stati.app; sourceTree = BUILT_PRODUCTS_DIR; }')
activity_source='StatiLiveActivity/StatiLiveActivity.swift'
activity_ref=obj(activity_source,f'{{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {q(activity_source)}; sourceTree = SOURCE_ROOT; }}')
refs.append(activity_ref)
activity_product=obj('live-product','{isa = PBXFileReference; explicitFileType = wrapper.app-extension; includeInIndex = 0; path = StatiLiveActivity.appex; sourceTree = BUILT_PRODUCTS_DIR; }')
products=obj('products',f'{{isa = PBXGroup; children = ({product},{activity_product},); name = Products; sourceTree = "<group>"; }}')
group=obj('group',f'{{isa = PBXGroup; children = ({",".join(refs)},{products},); sourceTree = "<group>"; }}')
sources=obj('sources',f'{{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(build)},); runOnlyForDeploymentPostprocessing = 0; }}')
res=obj('resources',f'{{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(resources)},); runOnlyForDeploymentPostprocessing = 0; }}')
frameworks=obj('frameworks','{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }')
settings={'SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'26.3','SWIFT_VERSION':'6.0','SWIFT_STRICT_CONCURRENCY':'complete','SWIFT_APPROACHABLE_CONCURRENCY':'YES','SWIFT_DEFAULT_ACTOR_ISOLATION':'MainActor','PRODUCT_BUNDLE_IDENTIFIER':'org.hapiproducts.stati.ios','DEVELOPMENT_TEAM':'T9F657VHPQ','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'NO','INFOPLIST_FILE':'Stati/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES':'AppIconWhite AppIconGold AppIconGreen AppIconGreyscale AppIconRed','ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME':'AccentColor','TARGETED_DEVICE_FAMILY':'1,2','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','PRODUCT_NAME':'$(TARGET_NAME)','ENABLE_USER_SCRIPT_SANDBOXING':'YES','CLANG_ENABLE_MODULES':'YES','MARKETING_VERSION':'0.1.0','CURRENT_PROJECT_VERSION':'62','SWIFT_EMIT_LOC_STRINGS':'YES'}
notes=(root/'Stati/Features/Account/AppUpdate.swift').read_text()
if f"static let current = AppUpdate(id: {settings['CURRENT_PROJECT_VERSION']}," not in notes:
    raise SystemExit("Update AppUpdate.current to match CURRENT_PROJECT_VERSION.")
settings_plist = root/'Stati/Settings.bundle/Root.plist'
preferences = plistlib.loads(settings_plist.read_bytes())
version = next(row for row in preferences['PreferenceSpecifiers'] if row.get('Key') == 'stati.settings.appVersion')
version['DefaultValue'] = f"{settings['MARKETING_VERSION']} ({settings['CURRENT_PROJECT_VERSION']})"
settings_plist.write_bytes(plistlib.dumps(preferences, sort_keys=False))
config_names = ['Debug', 'Release', 'Beta']
configs=[];projectconfigs=[]
for name in config_names:
 s=dict(settings);s['SWIFT_OPTIMIZATION_LEVEL']='-Onone' if name=='Debug' else '-O';s['SWIFT_ACTIVE_COMPILATION_CONDITIONS']='DEBUG' if name=='Debug' else '';s['DEBUG_INFORMATION_FORMAT']='dwarf' if name=='Debug' else 'dwarf-with-dsym'
 s['STATI_DISPLAY_NAME'] = 'Stazi Beta' if name == 'Beta' else 'Stați'
 s['STATI_IPAD_DISPLAY_NAME'] = 'Stazi Beta' if name == 'Beta' else 'Stați Worship'
 if name == 'Beta':
    s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'STATI_BETA'
    s['ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES'] = ''
 configs.append(obj('config'+name,'{isa = XCBuildConfiguration; buildSettings = {'+''.join(f'{k} = {q(v)};' for k,v in s.items())+'}; name = '+name+'; }'))
 projectconfigs.append(obj('project'+name,'{isa = XCBuildConfiguration; buildSettings = {}; name = '+name+'; }'))
cl=obj('configs','{isa = XCConfigurationList; buildConfigurations = ('+','.join(configs)+',); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }')
pcl=obj('pconfigs','{isa = XCConfigurationList; buildConfigurations = ('+','.join(projectconfigs)+',); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }')
activity_build=obj('live-build',f'{{isa = PBXBuildFile; fileRef = {activity_ref}; }}')
shared_ref=uid('Stati/Core/ServiceActivityAttributes.swift')
activity_shared=obj('live-shared',f'{{isa = PBXBuildFile; fileRef = {shared_ref}; }}')
activity_sources=obj('live-sources',f'{{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({activity_build},{activity_shared},); runOnlyForDeploymentPostprocessing = 0; }}')
activity_configs=[]
for name in config_names:
 s={key: settings[key] for key in ['SDKROOT','IPHONEOS_DEPLOYMENT_TARGET','SWIFT_VERSION','SWIFT_STRICT_CONCURRENCY','SWIFT_APPROACHABLE_CONCURRENCY','DEVELOPMENT_TEAM','CODE_SIGN_STYLE','TARGETED_DEVICE_FAMILY','SUPPORTED_PLATFORMS','MARKETING_VERSION','CURRENT_PROJECT_VERSION']}
 s.update({'PRODUCT_BUNDLE_IDENTIFIER':settings['PRODUCT_BUNDLE_IDENTIFIER']+'.LiveActivity','PRODUCT_NAME':'StatiLiveActivity','INFOPLIST_FILE':'StatiLiveActivity/Info.plist','APPLICATION_EXTENSION_API_ONLY':'YES','SKIP_INSTALL':'YES','GENERATE_INFOPLIST_FILE':'NO','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if name=='Debug' else '-O'})
 activity_configs.append(obj('live-config'+name,'{isa = XCBuildConfiguration; buildSettings = {'+''.join(f'{k} = {q(v)};' for k,v in s.items())+'}; name = '+name+'; }'))
activity_cl=obj('live-configs','{isa = XCConfigurationList; buildConfigurations = ('+','.join(activity_configs)+',); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }')
activity_target=obj('live-target',f'{{isa = PBXNativeTarget; buildConfigurationList = {activity_cl}; buildPhases = ({activity_sources},); buildRules = (); dependencies = (); name = StatiLiveActivity; productName = StatiLiveActivity; productReference = {activity_product}; productType = "com.apple.product-type.app-extension"; }}')
embedded_activity=obj('embed-live-build',f'{{isa = PBXBuildFile; fileRef = {activity_product}; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy,); }}; }}')
embed_phase=obj('embed-live',f'{{isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = ({embedded_activity},); name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0; }}')
proxy=obj('live-proxy',f'{{isa = PBXContainerItemProxy; containerPortal = {uid("project")}; proxyType = 1; remoteGlobalIDString = {activity_target}; remoteInfo = StatiLiveActivity; }}')
dependency=obj('live-dependency',f'{{isa = PBXTargetDependency; target = {activity_target}; targetProxy = {proxy}; }}')
target=obj('target',f'{{isa = PBXNativeTarget; buildConfigurationList = {cl}; buildPhases = ({sources},{frameworks},{res},{embed_phase},); buildRules = (); dependencies = ({dependency},); name = Stati; productName = Stati; productReference = {product}; productType = "com.apple.product-type.application"; }}')
project=obj('project',f'{{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = YES; LastSwiftUpdateCheck = 2700; LastUpgradeCheck = 2700; TargetAttributes = {{{target} = {{CreatedOnToolsVersion = 27.0; DevelopmentTeam = T9F657VHPQ; ProvisioningStyle = Automatic; }};}}; }}; buildConfigurationList = {pcl}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base,); mainGroup = {group}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = ({target},{activity_target},); }}')
(root/'Stati.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'+ '\n'.join(f'{k} = {v};' for k,v in objects.items())+'\n}; rootObject = '+project+';}\n')
scheme=f'''<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Stati.app" BlueprintName="Stati" ReferencedContainer="container:Stati.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="Stati.app" BlueprintName="Stati" ReferencedContainer="container:Stati.xcodeproj"/></BuildableProductRunnable></LaunchAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>'''
(root/'Stati.xcodeproj/xcshareddata/xcschemes/Stati.xcscheme').write_text(scheme)
beta_scheme = scheme.replace('buildConfiguration="Debug"', 'buildConfiguration="Beta"').replace('buildConfiguration="Release"', 'buildConfiguration="Beta"')
(root/'Stati.xcodeproj/xcshareddata/xcschemes/Stazi Beta.xcscheme').write_text(beta_scheme)
print(f'Generated Stati project with {len(swifts)} Swift files.')
