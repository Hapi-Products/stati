const {test}=require('node:test'),assert=require('node:assert/strict');
const {songLanguage,songEnding}=require('../src/shared/song-language.js'),{buildPresentation,decode}=require('../desktop/presentation.cjs');
test('Romanian diacritics and worship words keep Amin even when English matching sees are',()=>{
 for(const text of ['Laudăm','Cântările înălțărilor','Dumnezeu are putere','Dumnezeu are','Laudam, laudam','Sfânt, sfânt, sfânt','Isus Hristos','Cântec de credinţă']){assert.equal(songLanguage(text),'ron',text);assert.equal(songEnding(text),'Amin',text);}
 for(const text of ['We sing your glory, Lord','God, you are our hope','You are the love of our heart','Short ambiguous lyric'])assert.equal(songLanguage(text),'eng',text);
});
test('manual language overrides and automatic detection reach the native small italic ending',()=>{
 for(const [text,language,ending] of [['Laudăm Domnul','auto','Amin'],['Laudăm Domnul','eng','Amen'],['We sing your glory','ron','Amin']]){
  const doc=decode(buildPresentation({title:'Preserved song title',language,slides:[{section:'Verse',text}]})),element=doc.cues.at(-1).actions[0].slide.presentation.baseSlide.elements.find(item=>item.element.name==='Song ending').element,rtf=Buffer.from(element.text.rtfData,'base64').toString('latin1');
  assert.equal(doc.name,'Preserved song title');assert.ok(rtf.includes('\\fs72\\b0\\i\\cf1 '+ending));
  assert.ok(rtf.includes('\\qr'));assert.deepEqual(element.bounds,{origin:{x:1520,y:960},size:{width:320,height:80}});
 }
});
