import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
const digest=createHash('sha256');for(const directory of ['src/web','src/shared','src/desktop'])for(const name of readdirSync(directory).filter(name=>/\.(tsx?|js|json|css)$/.test(name)).sort()){const file=directory+'/'+name;digest.update(file+'\0');digest.update(readFileSync(file));}for(const file of ['index.html','public/sw.js','public/manifest.webmanifest','package-lock.json','vite.config.ts']){digest.update(file+'\0');digest.update(readFileSync(file));}const buildId=digest.digest('hex').slice(0,20);const version=JSON.parse(readFileSync('package.json','utf8')).version;
export default defineConfig({plugins:[react(),{name:'stati-client-version',generateBundle(){this.emitFile({type:'asset',fileName:'app-version.json',source:JSON.stringify({buildId,version})});}}],define:{__STATI_BUILD_ID__:JSON.stringify(buildId)},build:{outDir:'dist',chunkSizeWarningLimit:1000},server:{proxy:{'/api':'http://localhost:8787'}}});
