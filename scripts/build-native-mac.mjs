import {cp, mkdir, readFile, writeFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const supportedOptions = new Set(['--engine-app', '--output', '--signing-identity']);
const options = new Map();
const usage = 'Usage: node scripts/build-native-mac.mjs --engine-app /absolute/engine.app --output /absolute/new-directory [--signing-identity APPLE_DEVELOPMENT_SHA1]';
if (args.length % 2 !== 0) throw Error(usage);
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (!supportedOptions.has(name) || options.has(name) || !args[index + 1]) throw Error(usage);
  options.set(name, args[index + 1]);
}
const engine = options.get('--engine-app');
const output = options.get('--output');
const signingIdentity = options.get('--signing-identity')?.toUpperCase();
if (!engine || !output || !path.isAbsolute(engine) || !path.isAbsolute(output)) throw Error(usage);
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build this preview on an Apple Silicon Mac.');
const env = {...process.env, DEVELOPER_DIR: '/Applications/Xcode-beta.app/Contents/Developer'};
function run(command, parameters, {includeStderr = false} = {}) {
  const result = spawnSync(command, parameters, {encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed: ${result.stderr || result.stdout}`);
  return (includeStderr ? result.stdout + result.stderr : result.stdout).trim();
}
if (signingIdentity) {
  const validIdentity = /^([A-F0-9]{40})$/.test(signingIdentity)
    && run('/usr/bin/security', ['find-identity', '-p', 'codesigning', '-v']).split('\n')
      .some(line => line.trim().match(/^\d+\) ([A-F0-9]{40}) "Apple Development:/)?.[1] === signingIdentity);
  if (!validIdentity) throw Error('Choose the SHA-1 fingerprint of a valid Apple Development code-signing identity already in Keychain.');
}
const signer = signingIdentity ?? '-';
function developmentRequirement(bundle, expectedIdentifier) {
  const details = run('/usr/bin/codesign', ['-dvv', '-r-', bundle], {includeStderr: true});
  const requirement = details.match(/^designated => (.+)$/m)?.[1];
  if (!requirement || requirement.includes('cdhash') || !details.split('\n').includes('Identifier=' + expectedIdentifier)
    || !/^Authority=Apple Development:/m.test(details) || !/^TeamIdentifier=[A-Z0-9]+$/m.test(details)) {
    throw Error('The local development signature did not retain the bundle identity or a stable designated requirement.');
  }
  run('/usr/bin/codesign', ['--verify', '--strict', '-R=' + requirement, bundle]);
  return createHash('sha256').update(requirement).digest('hex');
}
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const enginePlist = path.join(engine, 'Contents/Info.plist');
const engineExecutable = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', enginePlist]);
const engineIdentifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', enginePlist]);
await stat(path.join(engine, 'Contents/MacOS', engineExecutable));
const engineArchive = path.join(engine, 'Contents/Resources/app.asar');
const archiveHash = await hash(engineArchive);
// mkdir without recursive deliberately refuses any previously produced directory.
await mkdir(output);
const app = path.join(output, 'Stați Native Preview.app');
const contents = path.join(app, 'Contents');
for (const directory of ['MacOS', 'Resources', 'Helpers']) await mkdir(path.join(contents, directory), {recursive: true});
const sourceDirectory = path.join(root, 'macos/Sources');
const sources = (await readdir(sourceDirectory)).filter(name => name.endsWith('.swift')).sort();
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [name, await hash(path.join(sourceDirectory, name))])));
const checks = path.join(output, '.checks');
await mkdir(checks);
const transportBinary = path.join(checks, 'native-transport-tests');
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-warnings-as-errors', '-target', 'arm64-apple-macos14.0', '-parse-as-library', path.join(sourceDirectory, 'JSONValue.swift'), path.join(sourceDirectory, 'EngineClient.swift'), path.join(root, 'macos/Tests/EngineClientTests.swift'), '-o', transportBinary]);
const transportLog = run(transportBinary, []);
if (!transportLog.includes('11 checks passed')) throw Error('The native transport checks did not complete.');
await writeFile(path.join(output, 'native-transport-tests.txt'), transportLog + '\n', {flag: 'wx'});
const draftBinary = path.join(checks, 'native-draft-tests');
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-warnings-as-errors', '-target', 'arm64-apple-macos14.0', '-parse-as-library', ...['JSONValue.swift', 'EngineClient.swift', 'Destination.swift', 'PrepareDraftSnapshot.swift', 'WorkspaceModel.swift', 'DiagnosticReport.swift'].map(name => path.join(sourceDirectory, name)), path.join(root, 'macos/Tests/WorkspaceModelTests.swift'), '-o', draftBinary]);
const draftLog = run(draftBinary, []);
if (!draftLog.includes('4 checks passed') || !draftLog.includes('Native startup regression passed') || !draftLog.includes('Native profile regression passed') || !draftLog.includes('Native diagnostics regression passed')) throw Error('The native draft regression checks did not complete.');
await writeFile(path.join(output, 'native-draft-tests.txt'), draftLog + '\n', {flag: 'wx'});

const executable = path.join(contents, 'MacOS/StatiNative');
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-warnings-as-errors', '-O', '-target', 'arm64-apple-macos14.0', '-parse-as-library', ...sources.map(name => path.join(sourceDirectory, name)), '-o', executable]);
const iconset = path.join(output, 'Stati.iconset');
await mkdir(iconset);
const icon = path.join(root, 'public/icon-512.png');
for (const size of [16, 32, 128, 256, 512]) {
  run('/usr/bin/sips', ['-z', String(size), String(size), icon, '--out', path.join(iconset, `icon_${size}x${size}.png`)]);
  run('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), icon, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)]);
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(contents, 'Resources/Stati.icns')]);
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.hapiproducts.stati.mac.native</string>
<key>CFBundleName</key><string>Stați Native Preview</string>
<key>CFBundleDisplayName</key><string>Stați Native Preview</string>
<key>CFBundleExecutable</key><string>StatiNative</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>${Date.now()}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleIconFile</key><string>Stati.icns</string>
<key>NSHumanReadableCopyright</key><string>Hapi Products</string>
</dict></plist>\n`);
const bundledEngine = path.join(contents, 'Helpers/Stati Engine.app');
await cp(engine, bundledEngine, {recursive: true, force: false, errorOnExist: true, dereference: false, verbatimSymlinks: true});
if (await hash(path.join(bundledEngine, 'Contents/Resources/app.asar')) !== archiveHash) throw Error('The bundled engine archive changed during copying.');
// Each nested item keeps its existing identifier, entitlements and runtime options.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', signer, '--preserve-metadata=identifier,entitlements,flags,runtime', '--timestamp=none', bundledEngine]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundledEngine]);
run('/usr/bin/codesign', ['--force', '--sign', signer, '--timestamp=none', app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const designatedRequirements = signingIdentity ? {
  engine: developmentRequirement(bundledEngine, engineIdentifier),
  application: developmentRequirement(app, 'org.hapiproducts.stati.mac.native')
} : undefined;
const architecture = run('/usr/bin/file', ['-b', executable]);
if (!architecture.includes('arm64')) throw Error('The native executable must be arm64.');
for (const [name, expected] of Object.entries(sourceHashes)) if (await hash(path.join(sourceDirectory, name)) !== expected) throw Error('Native source changed during the build. Preserve this output and build again.');
const manifest = {createdAt: new Date().toISOString(), application: app, bundleId: 'org.hapiproducts.stati.mac.native', nativeUI: 'SwiftUI/AppKit/PDFKit/AVKit', architecture, minimumMacOS: '14.0', signing: signingIdentity ? 'apple-development' : 'ad-hoc', notarized: false, designatedRequirements, engineApplication: engine, engineArchiveSHA256: archiveHash, executableSHA256: await hash(executable), iconSHA256: await hash(icon), sources: sourceHashes, buildScriptSHA256: await hash(fileURLToPath(import.meta.url)), transportTestsSHA256: await hash(path.join(root, 'macos/Tests/EngineClientTests.swift')), transportLog, draftTestsSHA256: await hash(path.join(root, 'macos/Tests/WorkspaceModelTests.swift')), draftLog, verified: ['Swift 6 compilation with warnings as errors', '11 native child-process transport checks', '4 concurrent draft-save regression checks', 'Native startup and profile regression checks', 'Engine archive copy hash', 'Inner and outer codesign --verify --deep --strict', 'Native executable ARM64 architecture'], limitations: ['Fresh pairing required; existing Electron state is not migrated.', 'Local preview only. No Developer ID signing or notarization.', 'Physical target-device and authenticated organization acceptance remain separate.', 'Advanced library edits, running-order edits, packages, rehearsal and sync tools remain in the existing desktop app.', 'Task editing/deletion/uploads and group creation/membership/uploads/song attachments remain in the existing desktop app.']};
await writeFile(path.join(output, 'native-preview-verification.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(manifest, null, 2));
