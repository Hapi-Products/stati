const {test}=require('node:test'),assert=require('node:assert/strict'),{capturePrimaryBackdrop}=require('../desktop/identity-backdrop.cjs');
const screen={getPrimaryDisplay:()=>({id:4,bounds:{width:3840,height:2160}})},image='data:image/png;base64,YQ==';
test('identity captures only a bounded primary-display thumbnail, with a deadline and no disk or network adapter',async()=>{
 let options;const result=await capturePrimaryBackdrop({screen,capturer:{getSources:async value=>{options=value;return[{display_id:'4',thumbnail:{isEmpty:()=>false,toDataURL:()=>image}},{display_id:'5',thumbnail:{isEmpty:()=>false,toDataURL:()=>{throw Error('Projector must not be used');}}}];}}});
 assert.equal(result,image);assert.deepEqual(options,{types:['screen'],thumbnailSize:{width:1600,height:900}});
 assert.equal(await capturePrimaryBackdrop({screen,capturer:{getSources:()=>new Promise(()=>{})},timeout:10}),null);
 assert.equal(await capturePrimaryBackdrop({screen,capturer:{getSources:async()=>{throw Error('Unavailable');}}}),null);
});
