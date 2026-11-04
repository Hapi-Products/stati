const fs=require('node:fs/promises'),path=require('node:path'),JSZip=require('jszip');
const {DOMParser}=require('linkedom');
const first=(node,name)=>node?.getElementsByTagName(name)[0];
const direct=(node,name)=>[...(node?.children||[])].find(child=>child.tagName===name);
const placeholder=shape=>first(first(shape,'p:nvSpPr'),'p:ph');
const placeholderType=shape=>placeholder(shape)?.getAttribute('type')||'obj';
const sizeOf=node=>{const value=Number(node?.getAttribute('sz'));return Number.isFinite(value)&&value>0?value:0;};
// Read editable PPTX text and explicit inherited placeholder defaults. Unknown
// layout/group geometry still uses Office rather than guessing lyric positions.
async function readPptxLyrics(file,{simpleSongOnly=false,sourceBytes}={}){
 if(path.extname(file).toLowerCase()!=='.pptx')return null;
 if(sourceBytes!==undefined&&(!Buffer.isBuffer(sourceBytes)||sourceBytes.length>50*1024*1024))return null;
 if(sourceBytes===undefined){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>50*1024*1024)return null;}
 try{
  const zip=await JSZip.loadAsync(sourceBytes===undefined?await fs.readFile(file):sourceBytes);let expanded=0;const documents=new Map();
  async function xml(name){if(documents.has(name))return documents.get(name);const entry=zip.file(name),size=entry?._data?.uncompressedSize;if(!entry||!Number.isSafeInteger(size)||size<0||expanded+size>10*1024*1024)throw Error('Unsupported PowerPoint package.');expanded+=size;const text=await entry.async('string');if(text.length>size||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Unsupported PowerPoint XML.');const document=new DOMParser().parseFromString(text,'text/xml');documents.set(name,document);return document;}
  function resolveTarget(part,target,kind){if(!target||target.includes('\\'))throw Error('Unsupported PowerPoint relationship.');const name=path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(path.posix.dirname(part),target));if(!new RegExp('^ppt/'+kind+'/[^/]+\\.xml$').test(name))throw Error('Unsupported PowerPoint relationship.');return name;}
  async function related(part,kind,folder){const relation=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');if(!zip.file(relation))return null;const rels=await xml(relation),matches=[...rels.getElementsByTagName('Relationship')].filter(rel=>rel.getAttribute('TargetMode')!=='External'&&(rel.getAttribute('Type')||'').endsWith('/'+kind));if(!matches.length)return null;if(matches.length!==1)throw Error('Ambiguous PowerPoint relationship.');const name=resolveTarget(part,matches[0].getAttribute('Target'),folder);return{name,document:await xml(name)};}
  const doc=await xml('ppt/presentation.xml'),size=first(doc,'p:sldSz'),width=Number(size?.getAttribute('cx')),height=Number(size?.getAttribute('cy'));
  if(!(width>0&&height>0))return null;
  const rels=await xml('ppt/_rels/presentation.xml.rels'),targets=new Map();
  for(const rel of rels.getElementsByTagName('Relationship'))if(rel.getAttribute('TargetMode')!=='External')targets.set(rel.getAttribute('Id'),rel.getAttribute('Target'));
  const ids=[...doc.getElementsByTagName('p:sldId')];if(!ids.length||ids.length>500)return null;
  const slides=[];
  for(const [index,id] of ids.entries()){
   const name=resolveTarget('ppt/presentation.xml',targets.get(id.getAttribute('r:id')),'slides'),page=await xml(name);
   if(!simpleSongOnly&&(page.getElementsByTagName('p:grpSp').length||page.getElementsByTagName('mc:AlternateContent').length))return null;
   let layout,master,loadedInheritance=false;
   async function loadInheritance(){if(!loadedInheritance){loadedInheritance=true;layout=await related(name,'slideLayout','slideLayouts');master=layout?await related(layout.name,'slideMaster','slideMasters'):null;}}
   if(simpleSongOnly)await loadInheritance();
   async function inheritance(shape){const ph=placeholder(shape);if(!ph)return{shapes:[shape],master:null,type:'other'};
    await loadInheritance();
    const shapes=[shape],idx=ph.getAttribute('idx')||'0';
    const layoutMatches=layout?[...layout.document.getElementsByTagName('p:sp')].filter(candidate=>placeholder(candidate)&&(placeholder(candidate).getAttribute('idx')||'0')===idx):[];
    if(layoutMatches.length>1)throw Error('Ambiguous PowerPoint placeholder.');if(layoutMatches.length)shapes.push(layoutMatches[0]);
    const type=placeholderType(shapes.at(-1)),masterMatches=master?[...master.document.getElementsByTagName('p:sp')].filter(candidate=>placeholder(candidate)&&placeholderType(candidate)===type):[];
    if(masterMatches.length===1)shapes.push(masterMatches[0]);
    return{shapes,master:master?.document||null,type:['title','ctrTitle'].includes(type)?'title':['body','obj','subTitle'].includes(type)?'body':'other'};
   }
   const shapes=[];
   for(const shape of page.getElementsByTagName('p:sp')){
    const body=first(shape,'p:txBody');if(!body)continue;
    const inherited=await inheritance(shape),paragraphs=[];let largest=0;
    for(const paragraph of body.getElementsByTagName('a:p')){
     let text='';const properties=direct(paragraph,'a:pPr'),level=Number(properties?.getAttribute('lvl')||0);if(!Number.isInteger(level)||level<0||level>8)return null;
     let defaultSize=sizeOf(direct(properties,'a:defRPr'));
     if(!defaultSize)for(const [position,parentShape] of inherited.shapes.entries()){
      const parentBody=first(parentShape,'p:txBody');let value=0;
      if(position){const matching=[...(parentBody?.getElementsByTagName('a:p')||[])].filter(item=>Number(direct(item,'a:pPr')?.getAttribute('lvl')||0)===level);const sizes=[...new Set(matching.map(item=>sizeOf(direct(direct(item,'a:pPr'),'a:defRPr'))).filter(Boolean))];if(sizes.length===1)value=sizes[0];else if(sizes.length>1&&!simpleSongOnly)return null;}
      defaultSize=value||sizeOf(direct(direct(first(parentBody,'a:lstStyle'),'a:lvl'+(level+1)+'pPr'),'a:defRPr'));if(defaultSize)break;
     }
     if(!defaultSize)defaultSize=sizeOf(direct(direct(first(first(inherited.master,'p:txStyles'),'p:'+inherited.type+'Style'),'a:lvl'+(level+1)+'pPr'),'a:defRPr'));
     if(!defaultSize)defaultSize=sizeOf(direct(direct(first(doc,'p:defaultTextStyle'),'a:lvl'+(level+1)+'pPr'),'a:defRPr'));
     for(const run of paragraph.children){
      if(run.tagName==='a:br'){text+='\n';continue;}
      if(!['a:r','a:fld'].includes(run.tagName))continue;
      const words=[...run.getElementsByTagName('a:t')].map(node=>node.textContent).join('');if(!words)continue;
      const points=sizeOf(direct(run,'a:rPr'))||defaultSize;if(!points&&!simpleSongOnly)return null;
      largest=Math.max(largest,points/100);text+=words;
     }
     paragraphs.push(text);
    }
    const text=paragraphs.join('\n');if(!text.trim())continue;
    if(simpleSongOnly){shapes.push({text});continue;}
    const transforms=inherited.shapes.map(parent=>first(first(parent,'p:spPr'),'a:xfrm')).filter(Boolean);
    if(!transforms.length||transforms.some(transform=>Number(transform.getAttribute('rot'))))return null;
    const offset=transforms.map(transform=>direct(transform,'a:off')).find(Boolean),extent=transforms.map(transform=>direct(transform,'a:ext')).find(Boolean);
    if(!offset||!extent||!offset.hasAttribute('x')||!offset.hasAttribute('y')||!extent.hasAttribute('cx')||!extent.hasAttribute('cy'))return null;
    const x=Number(offset.getAttribute('x')),y=Number(offset.getAttribute('y')),cx=Number(extent.getAttribute('cx')),cy=Number(extent.getAttribute('cy'));
    if(![x,y,cx,cy].every(Number.isFinite)||cx<=0||cy<=0)return null;
    shapes.push({text,fontSize:largest,x:x/width,y:y/height,width:cx/width,height:cy/height});
   }
   const additionalTextBoxes=simpleSongOnly?[layout?.document,master?.document].filter(Boolean).flatMap(document=>[...document.getElementsByTagName('p:sp')]).filter(shape=>!placeholder(shape)&&[...(first(shape,'p:txBody')?.getElementsByTagName('a:t')||[])].some(text=>text.textContent.trim())).length:0;
   slides.push({number:index+1,shapes,additionalTextBoxes});
  }
  return require('./powerpoint-lyrics.cjs').extractLyrics({slides},{simpleSongOnly});
 }catch(error){if(error.code==='SONG_LAYOUT_EXCLUDED')throw error;return null;}
}
module.exports={readPptxLyrics};
