export function validateServiceArrangement(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||!Array.isArray(value.slides)||!value.slides.length||value.slides.length>500||value.slides.some(index=>!Number.isInteger(index)||index<1||index>500)||Object.keys(value).some(key=>!['name','slides'].includes(key)))throw Error('Choose an arrangement name and between 1 and 500 saved slide numbers.');
 return {name:value.name.trim(),slides:[...value.slides]};
}
// Service-only sequence: original library slides are immutable. Their content
// hash binds every stored 1-based index to the reviewed source arrangement.
export function applyServiceArrangement(slides,arrangement){
 const selected=validateServiceArrangement(arrangement);if(!Array.isArray(slides)||slides.length>500)throw Error('This song has too many source slides for a service arrangement.');
 if(!selected)return structuredClone(slides);
 if(selected.slides.some(index=>index>slides.length))throw Error('This arrangement refers to a slide that is no longer available. Review its source song.');
 const ending=[...slides].reverse().find(slide=>slide.ending),result=selected.slides.map(index=>structuredClone(slides[index-1]));
 for(const slide of result){delete slide.ending;delete slide.endingFontSize;}
 if(ending&&result.length){result.at(-1).ending=ending.ending;if(ending.endingFontSize!==undefined)result.at(-1).endingFontSize=ending.endingFontSize;}
 return result;
}
