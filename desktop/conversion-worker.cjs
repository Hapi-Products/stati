const {parentPort,workerData}=require('node:worker_threads');
const searchCache=new Map();
async function execute(task,args){
 if(task==='playlist-references')return require('./playlist-library.cjs').playlistReferences(...args);
 if(task==='playlist-attachment-references')return require('./playlist-library.cjs').playlistAttachmentReferences(...args);
 if(task==='search')return require('./library.cjs').findSong(args[0],args[1],args[2]||'',searchCache);
 if(task==='catalog-snapshot')return require('./catalog-publisher.cjs').catalogSnapshot(...args);
 if(task==='catalog-search')return require('./song-catalog.cjs').searchCatalog(...args);
 if(task==='catalog-open')return require('./song-catalog.cjs').openCatalogSong(...args);
 if(task==='catalog-preview'){const {id,title,contentHash,fontSize,firstSlide}=await require('./song-catalog.cjs').catalogSong(...args);return{id,title,contentHash,fontSize,firstSlide};}
 if(task==='catalog-info')return require('./song-catalog.cjs').songReference(...args);
 if(task==='service-readiness')return require('./song-catalog.cjs').checkServiceSongs(...args);
 if(task==='document-preview')return require('./document-preview.cjs').documentPreview(...args);
 if(task==='pptx-lyrics')return require('./pptx-lyrics.cjs').readPptxLyrics(...args);
 if(task==='pro-powerpoint-source')return require('./propresenter-powerpoint-batch.cjs').readPowerPointSource(...args);
 if(task==='output-layout-pro')return require('./output-layouts.cjs').buildOutputPresentation(...args);
 if(task==='output-layout-pptx')return require('./output-layouts.cjs').buildOutputPowerPoint(...args);
 if(task==='pptx-build')return require('./powerpoint-export.cjs').buildPowerPointLyrics(...args);
 if(task==='revise-build')return require('./presentation.cjs').revisePresentation(...args);
 if(task==='clone-build')return require('./presentation.cjs').clonePresentation(...args);
 if(task==='build')return require('./presentation.cjs').buildPresentation(...args);
 throw Error('Unknown conversion task.');
}
async function respond({id,task,args}){try{parentPort.postMessage({id,result:await execute(task,args)});}catch(error){parentPort.postMessage({id,error:error.message,...(typeof error.code==='string'?{code:error.code}:{})});}}
if(workerData.persistent){let queue=Promise.resolve();parentPort.on('message',message=>{queue=queue.then(()=>respond(message));});}
else void respond(workerData);
