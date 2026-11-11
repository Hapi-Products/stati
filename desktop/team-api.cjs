'use strict';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const task=new RegExp('^/tasks(?:/'+uuid+')?$','i');
const images=new RegExp('^/tasks/'+uuid+'/images(?:/'+uuid+')?$','i');
const imageFile=new RegExp('^/tasks/'+uuid+'/images/'+uuid+'$','i');
const materialFile=new RegExp('^/group-materials/'+uuid+'/file$','i');
function pathOf(path){
 if(typeof path!=='string'||path.length>2048||!path.startsWith('/')||/[\\#\x00-\x20]/.test(path)||/%(?:2f|5c|2e)/i.test(path))throw Error('Unsupported team path.');
 const url=new URL(path,'https://team.invalid');if(url.origin!=='https://team.invalid'||url.pathname!==path.split('?')[0])throw Error('Unsupported team path.');for(const [key,value] of url.searchParams){if(!['offset','before','groupId','groupName','title','filename','computerId','songId','download','v'].includes(key)||value.length>512)throw Error('Unsupported team query.');}return url;
}
function createTeamAPI({request,read,upload,operator,assertIdentity}){
 async function run(work){const actor=operator();if(!actor||!Number.isSafeInteger(actor.generation))throw Error('Choose your authenticated profile first.');assertIdentity(actor.generation);const result=await work(actor);assertIdentity(actor.generation);return result;}
 return {
  request(input){const url=pathOf(input?.path),method=input?.method||'GET';
   const allowed=task.test(url.pathname)?(url.pathname==='/tasks'?['GET','POST']:['GET']):images.test(url.pathname)?(imageFile.test(url.pathname)?['DELETE','POST']:['GET']):/^\/worship-groups(?:\/candidates|\/[a-f0-9-]{36})?$/i.test(url.pathname)?['GET','POST','PATCH','DELETE']:/^\/group-materials(?:\/[a-f0-9-]{36}(?:\/group|\/song-links)?)?$/i.test(url.pathname)?['GET','POST','DELETE']:[];
   if(!allowed.includes(method)||input.body!==undefined&&(!['POST','PUT','PATCH'].includes(method)||typeof input.body!=='object'||input.body===null||Array.isArray(input.body)))throw Error('Unsupported team request.');
   if(Buffer.byteLength(JSON.stringify(input.body??null))>32768)throw Error('Team request is too large.');
   return run(actor=>request({path:input.path,method,...(input.body!==undefined?{body:input.body}:{})},actor));
  },
  read(path){const url=pathOf(path);if(!imageFile.test(url.pathname)&&!materialFile.test(url.pathname)&&!new RegExp('^/members/'+uuid+'/photo$','i').test(url.pathname))throw Error('Unsupported team asset.');return run(actor=>read(path,actor));},
  upload(input){const url=pathOf(input?.path),isImage=imageFile.test(url.pathname),isMaterial=url.pathname==='/group-materials';
   if(!isImage&&!isMaterial||!['image/jpeg','image/png','image/webp',...(isMaterial?['application/pdf']:[])].includes(input.contentType)||typeof input.base64!=='string'||input.base64.length>Math.ceil((isImage?8:12)*1024*1024/3)*4||input.base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw Error('Choose an allowed team file.');
   const bytes=Buffer.from(input.base64,'base64');if(bytes.toString('base64')!==input.base64||!bytes.length||bytes.length>(isImage?8:12)*1024*1024)throw Error('Team file is too large.');
   const filename=input.filename??url.searchParams.get('filename')??'image.png';if(typeof filename!=='string'||filename.length>180||/[\\/\x00-\x1f]/.test(filename)||!new RegExp(isImage?'\\.(png|jpe?g|webp)$':'\\.(pdf|png|jpe?g|webp)$','i').test(filename))throw Error('Choose a valid team filename.');
   return run(actor=>upload({path:input.path,contentType:input.contentType,base64:input.base64,filename,method:isImage?'PUT':'POST'},actor));
  }
 };
}
module.exports={createTeamAPI};
