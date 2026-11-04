const {lyricFontSize,LYRIC_BOUNDS,layoutLyricSlides,lyricQualityIssues}=require('../src/shared/lyric-layout.js');
const {songEnding}=require('../src/shared/song-language.js');
const {songEndingSize,songEndingBounds,MIN_ENDING_SIZE,MAX_ENDING_SIZE}=require('../src/shared/song-ending-style.js');
const protobuf=require('protobufjs/light');const schema=require('../src/shared/propresenter-schema.json');const crypto=require('node:crypto');
const root=protobuf.Root.fromJSON(schema);const Presentation=root.lookupType('rv.data.Presentation');
const uuid=()=>({string:crypto.randomUUID()});
function rtfText(s){return Array.from(s).map(c=>c==='\n'?'\\par ':c==='\r'?'':'\\{}'.includes(c)?'\\'+c:c.charCodeAt(0)>127?c.split('').map(u=>'\\u'+(u.charCodeAt(0)>32767?u.charCodeAt(0)-65536:u.charCodeAt(0))+'?').join(''):c).join('');}
function validate(data){
 if(!data||typeof data.title!=='string'||!data.title.trim()||data.title.length>300||!Array.isArray(data.slides)||!data.slides.length||data.slides.length>500)throw new Error('Choose a title and between 1 and 500 slides.');
 for(const slide of data.slides)if(!slide||typeof slide.text!=='string'||slide.text.length>10000||typeof slide.section!=='string'||slide.section.length>100)throw new Error('Invalid slide content.');
 if(data.layoutCopy!==undefined&&!['church','stream-lyrics','stream-translation'].includes(data.layoutCopy))throw new Error('Choose a valid presentation output copy.');
 if(data.language!==undefined&&!['auto','eng','ron'].includes(data.language))throw new Error('Choose English or Romanian for the song.');
 if(data.fontSize!==undefined&&(!Number.isFinite(data.fontSize)||data.fontSize<32||data.fontSize>160))throw new Error('Choose a lyric font size from 32 to 160 points.');
 if(data.amenFontSize!==undefined&&(!Number.isFinite(data.amenFontSize)||data.amenFontSize<MIN_ENDING_SIZE||data.amenFontSize>MAX_ENDING_SIZE))throw new Error('Choose an Amen / Amin size from 16 to 96.');
 if(data.linesPerSlide!==undefined&&(!Number.isInteger(data.linesPerSlide)||data.linesPerSlide<2||data.linesPerSlide>8))throw new Error('Choose between 2 and 8 lines per slide.');
 return data;
}
function preparePresentation(input,mediaFiles){
 const data=validate(input);
 if(mediaFiles.length)return data;
 const slides=layoutLyricSlides(data.slides,data.fontSize,data.linesPerSlide),issues=lyricQualityIssues(slides,data.fontSize);
 if(issues.length)throw Error(issues[0].message);
 return {...data,slides};
}
function buildPresentation(input,mediaFiles=[]){const data=preparePresentation(input,mediaFiles),endingSize=songEndingSize(data.amenFontSize),endingBounds=songEndingBounds(endingSize);const color={red:.32,green:.34,blue:.85,alpha:1};const groups=[];const cues=data.slides.map((slide,i)=>{const id=uuid();let group=groups.at(-1);if(!group||group.group.name!==slide.section){group={group:{uuid:uuid(),name:slide.section,color},cueIdentifiers:[]};groups.push(group);}group.cueIdentifiers.push(id);const element={uuid:uuid(),name:'Lyrics',bounds:{origin:{x:LYRIC_BOUNDS.x,y:LYRIC_BOUNDS.y},size:{width:LYRIC_BOUNDS.width,height:LYRIC_BOUNDS.height}},opacity:1,path:{closed:true,shape:{type:1}},fill:{enable:true,color:{alpha:0}},text:{verticalAlignment:1,scaleBehavior:2,rtfData:Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\uc1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green255\\blue255;}\\pard\\qc\\f0\\fs'+Math.round(lyricFontSize(slide.text,data.fontSize)*2)+'\\b\\cf1 '+rtfText(slide.text)+'}','ascii')}};if(mediaFiles[i]){element.name='Slide image';element.bounds={origin:{x:0,y:0},size:{width:1920,height:1080}};delete element.text;element.fill={enable:true,media:{uuid:uuid(),url:{platform:2,absoluteString:require('node:url').pathToFileURL(mediaFiles[i]).href},image:{drawing:{scaleBehavior:0,scaleAlignment:0,naturalSize:{width:1920,height:1080}}}}};}const elements=[{element}];if(!mediaFiles.length&&i===data.slides.length-1){elements.push({element:{uuid:uuid(),name:'Song ending',bounds:{origin:{x:endingBounds.x,y:endingBounds.y},size:{width:endingBounds.width,height:endingBounds.height}},opacity:1,path:{closed:true,shape:{type:1}},fill:{enable:true,color:{alpha:0}},text:{verticalAlignment:1,scaleBehavior:2,rtfData:Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\uc1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green255\\blue255;}\\pard\\qr\\f0\\fs'+Math.round(endingSize*2)+'\\b0\\i\\cf1 '+songEnding(data.slides.map(s=>s.text).join('\n'),data.language)+'}','ascii')}}});}return{uuid:id,name:String(i+1),isEnabled:true,actions:[{uuid:uuid(),name:'Slide '+(i+1),isEnabled:true,type:11,label:{text:slide.section,color},slide:{presentation:{baseSlide:{uuid:uuid(),size:{width:1920,height:1080},drawsBackgroundColor:true,backgroundColor:{red:0,green:0,blue:0,alpha:1},elements}}}}]};});const doc={uuid:uuid(),name:data.title,applicationInfo:{platform:2,application:1,applicationVersion:{majorVersion:7,minorVersion:11,patchVersion:0}},category:'Stați',notes:'Prepared in Stați · Hapi Products',cues,cueGroups:groups};const err=Presentation.verify(doc);if(err)throw new Error(err);return Buffer.from(Presentation.encode(Presentation.create(doc)).finish());}
function revisePresentation(original,input){const before=Presentation.decode(original),after=Presentation.decode(buildPresentation({...input,title:before.name||input.title}));after.uuid=before.uuid;after.category=before.category;after.name=before.name||input.title;for(const field of ['notes','ccli','musicKey','contentDestination','lastDateUsed'])if(Object.hasOwn(before,field))after[field]=before[field];return Buffer.from(Presentation.encode(after).finish());}
function clonePresentation(original,title){
 if(typeof title!=='string'||!title.trim()||title.length>300)throw Error('Choose a valid title for the group version.');
 const doc=Presentation.decode(original),identities=new Map();
 const walk=(value,visit)=>{if(!value||typeof value!=='object'||ArrayBuffer.isView(value))return;visit(value);for(const child of Object.values(value))if(child&&typeof child==='object')walk(child,visit);};
 walk(doc,value=>{if(value.uuid?.string&&!identities.has(value.uuid.string))identities.set(value.uuid.string,crypto.randomUUID());});
 walk(doc,value=>{if(typeof value.string==='string'&&identities.has(value.string))value.string=identities.get(value.string);});
 doc.name=title;return Buffer.from(Presentation.encode(doc).finish());
}
module.exports={buildPresentation,revisePresentation,clonePresentation,validate,decode:buffer=>Presentation.toObject(Presentation.decode(buffer),{bytes:String})};
