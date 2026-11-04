const {test}=require('node:test'),assert=require('node:assert/strict'),{rtfPlain}=require('../desktop/rtf-text.cjs');
test('ProPresenter formatting destinations never leak symbols or metadata into lyric text',()=>{
 const raw=String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}{\f1 Times New Roman;}}{\colortbl;\red255\green255\blue255;}{\*\listtable{\list\listid1;}}{\*\unknown ;\{\}\\\*;}\pard\f0 Our Father everlasting\par The all creating One}`;
 assert.equal(rtfPlain(raw),'Our Father everlasting\nThe all creating One');
});
test('RTF decoding respects Unicode fallback, nested scope, escaped punctuation and Windows code pages',()=>{
 assert.equal(rtfPlain(String.raw`{\rtf1\uc1 \u536?i \u539?ar\u259? {\uc0 \u238n} \{lyrics\} \\ today}`),'Și țară în {lyrics} \\ today');
 assert.equal(rtfPlain(String.raw`{\rtf1\ansicpg1252 \'93Together\'94}`),'“Together”');
 assert.equal(rtfPlain(String.raw`{\rtf1\ansicpg65001 \'c8\'98i}`),'Și');
 assert.equal(rtfPlain(String.raw`{\rtf1 {\field{\*\fldinst HYPERLINK "ignored"}{\fldrslt Displayed words}}}`),'Displayed words');
});
