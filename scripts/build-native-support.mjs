import {build} from 'vite';
// Compile the canonical splitter; the native frontend never approximates it.
await build({configFile:false,build:{outDir:'desktop/native-support',emptyOutDir:true,lib:{entry:'src/shared/slides.ts',formats:['cjs'],fileName:()=> 'slides.cjs'},minify:false}});
