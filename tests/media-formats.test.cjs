const {test}=require('node:test'),assert=require('node:assert/strict');
const {MEDIA_FORMATS,mediaUploadFormat,UPLOAD_ACCEPT}=require('../src/shared/media-formats.js'),{previewFormat}=require('../desktop/preview-formats.cjs');
test('every media file accepted by the sender has the same kind and MIME in the shipped desktop preview',()=>{
 for(const [extension,format] of Object.entries(MEDIA_FORMATS)){
  assert.ok(UPLOAD_ACCEPT.split(',').includes('.'+extension));assert.ok(UPLOAD_ACCEPT.split(',').includes(format.mime));
  assert.deepEqual(previewFormat('Song.'+extension.toUpperCase()),{kind:'media',mediaType:format.kind,mime:format.mime});assert.equal(mediaUploadFormat('Song.'+extension.toUpperCase()),format);
 }
 for(const name of ['file.exe','constructor','file.__proto__','file.toString'])assert.equal(mediaUploadFormat(name),undefined);
 for(const extension of ['pdf','pptx','docx','txt','jpg','jpeg','png','webp'])assert.ok(UPLOAD_ACCEPT.split(',').includes('.'+extension));
});
