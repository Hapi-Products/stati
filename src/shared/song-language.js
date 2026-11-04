const romanian=new Set(['dumnezeu','isus','doamne','domnul','hristos','slava','iubire','dragoste','inima','cantam','impreuna','esti','sunt','tine','tau','ta','ne','noi','si','sa','prin','pentru','amin','lauda','laudam','lumina','putere','credinta','sfant','sfanta','mantuitor','viata','har','cruce','crucea','mila','aleluia','osana']);
const distinctRomanian=new Set(['dumnezeu','doamne','domnul','isus','hristos','amin','sfant','mantuitor','aleluia','osana','laudam']);
const english=new Set(['god','jesus','lord','glory','love','heart','sing','together','you','your','are','the','and','we','our','for','with','amen']);
export function songLanguage(text,choice='auto'){
 if(choice==='eng'||choice==='ron')return choice;
 const original=String(text).normalize('NFC').toLowerCase().match(/\p{L}+/gu)||[],words=original.map(word=>word.normalize('NFKD').replace(/\p{M}/gu,''));
 let ron=0,eng=0;
 for(let index=0;index<words.length;index++){if(romanian.has(words[index])||/[ăâîșțşţ]/.test(original[index]))ron++;if(english.has(words[index]))eng++;}
 // "are" is also a Romanian word. A tie containing an unambiguous Romanian
 // worship word must not switch that song's ending to English.
 return ron>eng||ron===eng&&ron>0&&words.some(word=>distinctRomanian.has(word))?'ron':'eng';
}
export function songEnding(text,choice='auto'){return songLanguage(text,choice)==='ron'?'Amin':'Amen';}
