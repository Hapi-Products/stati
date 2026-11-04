'use strict';
const crypto=require('node:crypto'),protobuf=require('protobufjs/light');
const {validate}=require('./presentation.cjs');
const {OUTPUT_LAYOUT_BOUNDS,outputTextFontSize,outputLayoutIssues}=require('../src/shared/output-layout.js');
const Presentation=protobuf.Root.fromJSON(require('../src/shared/propresenter-schema.json')).lookupType('rv.data.Presentation');
const uuid=()=>({string:crypto.randomUUID()});
const rtf=text=>Array.from(text).map(c=>c==='\n'?'\\par ':c==='\r'?'':'\\{}'.includes(c)?'\\'+c:c.charCodeAt(0)>127?c.split('').map(u=>'\\u'+(u.charCodeAt(0)>32767?u.charCodeAt(0)-65536:u.charCodeAt(0))+'?').join(''):c).join('');
function input(data){validate(data);if(!Object.hasOwn(OUTPUT_LAYOUT_BOUNDS,data.layoutCopy))throw Error('Choose a separate church or online output copy.');const issues=outputLayoutIssues(data.slides,data.layoutCopy,data.fontSize);if(issues.length)throw Error(issues[0]);return data;}
function buildOutputPresentation(value){
 const data=input(value),bounds=OUTPUT_LAYOUT_BOUNDS[data.layoutCopy],color={red:.32,green:.34,blue:.85,alpha:1},groups=[];
 const cues=data.slides.map((slide,index)=>{const id=uuid();let group=groups.at(-1);if(!group||group.group.name!==slide.section){group={group:{uuid:uuid(),name:slide.section,color},cueIdentifiers:[]};groups.push(group);}group.cueIdentifiers.push(id);
  const element={uuid:uuid(),name:data.layoutCopy==='stream-translation'?'Translation':'Lyrics',bounds:{origin:{x:bounds.x,y:bounds.y},size:{width:bounds.width,height:bounds.height}},opacity:1,path:{closed:true,shape:{type:1}},fill:{enable:true,color:{alpha:0}},text:{verticalAlignment:1,scaleBehavior:2,rtfData:Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\uc1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red255\\green255\\blue255;}\\pard\\qc\\f0\\fs'+Math.round(outputTextFontSize(slide.text,data.fontSize,data.layoutCopy)*2)+'\\b\\cf1 '+rtf(slide.text)+'}','ascii')}};
  return{uuid:id,name:String(index+1),isEnabled:true,actions:[{uuid:uuid(),name:'Output cue '+(index+1),isEnabled:true,type:11,label:{text:slide.section,color},slide:{presentation:{baseSlide:{uuid:uuid(),size:{width:1920,height:1080},drawsBackgroundColor:data.layoutCopy==='church',backgroundColor:{red:0,green:0,blue:0,alpha:data.layoutCopy==='church'?1:0},elements:[{element}]}}}}]};
 });
 const doc={uuid:uuid(),name:data.title,applicationInfo:{platform:2,application:1,applicationVersion:{majorVersion:7,minorVersion:11,patchVersion:0}},category:'Stați output copies',notes:'Separate '+data.layoutCopy+' copy prepared by Stați. Verify cue timing, output routing and transparency on the church computer.',cues,cueGroups:groups};
 const error=Presentation.verify(doc);if(error)throw Error(error);return Buffer.from(Presentation.encode(Presentation.create(doc)).finish());
}
async function buildOutputPowerPoint(value){
 const data=input(value),PptxGenJS=require('pptxgenjs'),deck=new PptxGenJS(),bounds=OUTPUT_LAYOUT_BOUNDS[data.layoutCopy],units=144;
 deck.defineLayout({name:'STATI_OUTPUT',width:1920/units,height:1080/units});deck.layout='STATI_OUTPUT';deck.author='Stați';deck.company='Hapi Products';deck.title=data.title;deck.subject='Separate output layout review copy';
 for(const source of data.slides){const slide=deck.addSlide();slide.background={color:'000000'};if(source.text)slide.addText(source.text,{x:bounds.x/units,y:bounds.y/units,w:bounds.width/units,h:bounds.height/units,fontFace:'Arial',fontSize:outputTextFontSize(source.text,data.fontSize,data.layoutCopy)/2,color:'FFFFFF',bold:true,align:'center',valign:'middle',margin:0,lineSpacingMultiple:1.2,paraSpaceAfter:0,paraSpaceBefore:0,wrap:false,fit:'none'});}
 return Buffer.from(await deck.write({outputType:'nodebuffer',compression:true}));
}
module.exports={buildOutputPresentation,buildOutputPowerPoint};
