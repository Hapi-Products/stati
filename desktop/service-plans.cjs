const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {validateServiceArrangement}=require('../src/shared/service-arrangement.js');
const validId=id=>typeof id==='string'&&/^[\w-]{20,60}$/.test(id);
const validTime=time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
const statuses=plan=>!plan.tasks.length||!plan.tasks.some(task=>task.done)?'Not started':plan.tasks.some(task=>!task.done)?'Preparing':'Ready';
function validateContent(value){
 if(typeof value.notes!=='string'||value.notes.length>5000||!Array.isArray(value.tasks)||value.tasks.length>50)throw Error('Invalid service details.');
 if(value.songs===undefined)value.songs=[];
 if(!Array.isArray(value.songs)||value.songs.length>1000)throw Error('Use up to 1000 songs per local service.');
 const songIds=new Set();for(const song of value.songs){if(!song||!validId(song.id)||songIds.has(song.id)||! /^[a-f0-9]{64}$/.test(song.songId)||! /^[a-f0-9]{64}$/.test(song.contentHash)||typeof song.title!=='string'||!song.title.trim()||song.title.length>300||typeof song.filename!=='string'||song.filename.length>255||typeof song.reviewed!=='boolean')throw Error('Choose valid songs from Lyrics.');validateServiceArrangement(song.arrangement);songIds.add(song.id);}
 const ids=new Set();for(const task of value.tasks){if(!task||!validId(task.id)||ids.has(task.id)||typeof task.text!=='string'||!task.text.trim()||task.text.length>120||typeof task.done!=='boolean')throw Error('Use unique checklist items up to 120 characters.');ids.add(task.id);}
 return value;
}
function validate(plan){
 if(!plan||!validId(plan.id)||typeof plan.title!=='string'||!plan.title.trim()||plan.title.length>80||typeof plan.date!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(plan.date)||!validTime(plan.time))throw Error('Enter a service name, date and time.');
 const date=new Date(plan.date+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==plan.date)throw Error('Choose a valid calendar date.');
 if(typeof plan.reviewed!=='boolean'||typeof plan.archived!=='boolean'||plan.templateId!==undefined&&!validId(plan.templateId))throw Error('Invalid service details.');
 if(plan.revision===undefined)plan.revision=0;
 if(!Number.isSafeInteger(plan.revision)||plan.revision<0||plan.revision>=Number.MAX_SAFE_INTEGER)throw Error('Invalid service revision.');
 return validateContent(plan);
}
function validateTemplate(template){
 if(!template||!validId(template.id)||typeof template.name!=='string'||!template.name.trim()||template.name.length>80||!validTime(template.time)||template.weekday!==null&&(!Number.isInteger(template.weekday)||template.weekday<0||template.weekday>6)||typeof template.archived!=='boolean')throw Error('Choose a template name, weekday and time.');
 return validateContent(template);
}
const resetContent=source=>({notes:source.notes,tasks:source.tasks.map(task=>({...task,id:crypto.randomUUID(),done:false})),songs:source.songs.map(song=>({...song,id:crypto.randomUUID(),reviewed:false}))});
function serviceExpired(plan,retention,at=Date.now()){
 if(!['never','day','week'].includes(retention)||!Number.isFinite(at))throw Error('Choose a valid service retention setting.');
 if(retention==='never')return false;
 const today=new Date(at-7*3600000).toISOString().slice(0,10);
 if(retention==='day')return today>plan.date;
 const end=new Date(plan.date+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+(7-end.getUTCDay())%7);
 return today>end.toISOString().slice(0,10);
}
function servicePlans(directory,protection){
 const pending=new Map();
 const location=user=>{if(!validId(user))throw Error('Choose your profile first.');return path.join(directory,'service-plans-'+user+'.bin');};
 function secure(){if(!protection.isEncryptionAvailable()||protection.getSelectedStorageBackend?.()==='basic_text')throw Error('Protected storage is unavailable.');}
 async function read(user){secure();try{
  const raw=await fs.readFile(location(user));if(raw.length>2*1024*1024)throw Error('Too much service data.');
  const data=JSON.parse(protection.decryptString(raw));if(data.templates===undefined)data.templates=[];
  if(data.version!==1||!Array.isArray(data.plans)||data.plans.length>100||!Array.isArray(data.templates)||data.templates.length>50)throw Error('Invalid service data.');
  for(const [items,validator] of [[data.plans,validate],[data.templates,validateTemplate]]){const ids=new Set();for(const item of items){validator(item);if(ids.has(item.id))throw Error('Duplicate service identifiers.');ids.add(item.id);}}
  if(data.activeServiceId===undefined)data.activeServiceId=null;
  if(data.activeServiceId!==null&&(!validId(data.activeServiceId)||!data.plans.some(plan=>plan.id===data.activeServiceId&&!plan.archived)))throw Error('Invalid selected service.');
  return data;
 }catch(error){if(error.code==='ENOENT')return {version:1,plans:[],templates:[],activeServiceId:null};throw Error('Saved service plans could not be opened. They have been preserved.');}}
 async function write(target,data){const bytes=protection.encryptString(JSON.stringify(data));if(bytes.length>2*1024*1024)throw Error('Local service plans have reached their storage limit. The previous plans are unchanged.');const temporary=target+'.'+crypto.randomUUID()+'.tmp';await fs.mkdir(directory,{recursive:true,mode:0o700});try{const output=await fs.open(temporary,'wx',0o600);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}}
 return {
  async list(user){await pending.get(user);return (await read(user)).plans;},
  async active(user){await pending.get(user);return (await read(user)).activeServiceId;},
  async state(user){await pending.get(user);const data=await read(user);return{activeServiceId:data.activeServiceId,plans:data.plans.map(plan=>({...plan,active:plan.id===data.activeServiceId}))};},
  async templates(user){await pending.get(user);return (await read(user)).templates;},
  async isShared(user){await pending.get(user);return (await read(user)).sharedCache===true;},
  replaceSharedSnapshot(user,snapshot){const target=location(user);secure();
   const operation=(pending.get(user)||Promise.resolve()).catch(()=>{}).then(async()=>{
    if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.plans)||snapshot.plans.length>100||snapshot.activeServiceId!==null&&!validId(snapshot.activeServiceId))throw Error('The shared service snapshot is invalid. The previous cache was preserved.');
    const data=await read(user),ids=new Set(),plans=snapshot.plans.map(source=>{
     if(!source||typeof source!=='object')throw Error('The shared service snapshot is invalid.');
     const value=validate(structuredClone({id:source.id,revision:source.revision,title:source.title,date:source.date,time:source.time,notes:source.notes,reviewed:source.reviewed,archived:source.archived,tasks:source.tasks,songs:source.songs,...(source.templateId?{templateId:source.templateId}:{})}));
     if(ids.has(value.id))throw Error('The shared service snapshot has duplicate identifiers.');ids.add(value.id);return value;
    });
    if(snapshot.activeServiceId!==null&&!plans.some(plan=>plan.id===snapshot.activeServiceId&&!plan.archived))throw Error('The selected shared service is unavailable. The previous cache was preserved.');
    const activeServiceId=snapshot.activeServiceId;
    if(!data.sharedCache||data.activeServiceId!==activeServiceId||JSON.stringify(data.plans)!==JSON.stringify(plans)){
     await write(target,{...data,sharedCache:true,plans,activeServiceId});
    }
    return{activeServiceId,plans:plans.map(plan=>({...plan,active:plan.id===activeServiceId}))};
   });pending.set(user,operation);return operation.finally(()=>{if(pending.get(user)===operation)pending.delete(user);});
  },
  change(user,action){const target=location(user);secure();if(!action||typeof action!=='object'||!['create','save','duplicate','archive','select','delete','attach-songs','template-save','template-create','template-archive'].includes(action.type))throw Error('Choose a valid service action.');
   const operation=(pending.get(user)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const data=await read(user),{plans,templates}=data;
    const capacity=()=>{if(plans.length>=100)throw Error('You can keep up to 100 local service plans.');};
    if(action.type==='template-save'){
     const source=plans.find(plan=>plan.id===action.id);if(!source)throw Error('Service plan unavailable.');if(templates.length>=50)throw Error('You can keep up to 50 local service templates.');
     if(typeof action.name==='string'&&templates.some(template=>template.name.toLocaleLowerCase()===action.name.trim().toLocaleLowerCase()))throw Error('A template already has this name. Choose another name.');
     templates.push(validateTemplate({id:crypto.randomUUID(),name:typeof action.name==='string'?action.name.trim():action.name,time:source.time,weekday:action.weekday,archived:false,...resetContent(source)}));
    }else if(action.type==='template-create'){
     capacity();const template=templates.find(template=>template.id===action.templateId&&!template.archived);if(!template)throw Error('Template unavailable.');
     plans.push(validate({id:crypto.randomUUID(),revision:1,title:action.title===undefined?template.name:action.title,date:action.date,time:action.time===undefined?template.time:action.time,reviewed:false,archived:false,templateId:template.id,...resetContent(template)}));
     data.activeServiceId=plans.at(-1).id;
    }else if(action.type==='template-archive'){
     const template=templates.find(template=>template.id===action.id);if(!template||typeof action.archived!=='boolean')throw Error('Template unavailable.');template.archived=action.archived;
    }else if(action.type==='create'){
     capacity();plans.push(validate({id:crypto.randomUUID(),revision:1,title:action.title,date:action.date,time:action.time,notes:'',reviewed:false,archived:false,songs:[],tasks:['Check lyrics','Download presentations','Test display outputs'].map(text=>({id:crypto.randomUUID(),text,done:false}))}));
     data.activeServiceId=plans.at(-1).id;
    }else if(action.type==='select'&&action.id===null){
     data.activeServiceId=null;
    }else{
     if(action.type==='attach-songs'&&Object.hasOwn(action,'expectedActiveServiceId')&&action.expectedActiveServiceId!==data.activeServiceId)throw Error('The selected service changed while the songs were being prepared. Choose the service again.');
     const index=plans.findIndex(plan=>plan.id===(action.id||action.type==='attach-songs'&&data.activeServiceId));if(index<0)throw Error('Service plan unavailable.');
     if(action.type==='select'){if(plans[index].archived)throw Error('Choose an active service.');data.activeServiceId=plans[index].id;}
     else if(action.type==='delete'){plans.splice(index,1);if(data.activeServiceId===action.id)data.activeServiceId=[...plans].reverse().find(plan=>!plan.archived)?.id||null;}
     else if(action.type==='attach-songs'){
      if(plans[index].archived||!Array.isArray(action.songs)||action.songs.length>1000)throw Error('Choose up to 1000 saved Lyrics songs for an active service.');
      const songs=plans[index].songs.map(song=>({...song}));let changed=false;
      for(const source of action.songs){const songId=source?.songId||source?.id,old=songs.find(song=>song.songId===songId);const next={id:old?.id||crypto.randomUUID(),songId,contentHash:source?.contentHash,title:source?.title,filename:source?.filename,reviewed:old?.contentHash===source?.contentHash?old.reviewed:false};validateContent({notes:'',tasks:[],songs:[next]});if(old){if(JSON.stringify(old)!==JSON.stringify(next)){Object.assign(old,next);changed=true;}}else{songs.push(next);changed=true;}}
      if(changed)plans[index]=validate({...plans[index],songs,reviewed:false,revision:plans[index].revision+1});
     }
     else if(action.type==='duplicate'){capacity();const source=plans[index];plans.push(validate({...source,id:crypto.randomUUID(),revision:1,title:source.title.slice(0,73)+' (copy)',date:action.date||source.date,archived:false,reviewed:false,...resetContent(source)}));data.activeServiceId=plans.at(-1).id;}
     else if(action.type==='save'){const patch=action.plan;if(!patch||typeof patch!=='object')throw Error('Choose valid service details.');if(patch.revision!==plans[index].revision)throw Error('This service changed while it was being edited. Reload the latest service before saving.');const next=validate({...plans[index],title:patch.title,date:patch.date,time:patch.time,notes:patch.notes,reviewed:patch.reviewed,tasks:patch.tasks,songs:patch.songs===undefined?plans[index].songs:patch.songs});if(JSON.stringify(next)!==JSON.stringify(plans[index]))next.revision++;plans[index]=validate(next);}
     else{if(typeof action.archived!=='boolean')throw Error('Invalid archive action.');if(plans[index].archived!==action.archived)plans[index].revision++;plans[index].archived=action.archived;validate(plans[index]);if(action.archived&&data.activeServiceId===plans[index].id)data.activeServiceId=[...plans].reverse().find(plan=>!plan.archived)?.id||null;}
    }
    await write(target,data);return plans;
   });pending.set(user,operation);return operation.finally(()=>{if(pending.get(user)===operation)pending.delete(user);});
  },
  async flush(){await Promise.all([...pending.values()]);}
 };
}
module.exports={servicePlans,serviceStatus:statuses,serviceExpired};
