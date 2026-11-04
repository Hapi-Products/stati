const {test}=require('node:test'),assert=require('node:assert/strict');
const {chordRemovalSuggestions,applyChordRemoval}=require('../src/shared/chord-review.js');
test('chord removal is a review proposal and preserves English/Romanian lyrics and section labels',()=>{
 const input='[Verse 1]\nC     G/B    Am7    F\n[C]Amazing [G]grace\n[Am]Împreună [F]cântăm\nA\nAm\n[Chorus]\nA child is born\nDoamne, Tu ești bun';
 const suggestions=chordRemovalSuggestions(input);
 assert.deepEqual(suggestions.map(edit=>edit.line),[1,2,3]);
 assert.equal(input.split('\n')[1],'C     G/B    Am7    F','analysis never changes the input');
 const selected=applyChordRemoval(input,suggestions,[1,3]);
 assert.equal(selected,'[Verse 1]\n\n[C]Amazing [G]grace\nÎmpreună cântăm\nA\nAm\n[Chorus]\nA child is born\nDoamne, Tu ești bun');
 assert.equal(applyChordRemoval(input,suggestions,[]),input);
});
test('slash chords, chord qualities and bar separators are recognized while lyric prose is kept',()=>{
 const input='| Cmaj7 G7 Am D/F# |\nDsus4  Cadd9\nCome and see\nA mighty fortress\n[Bridge]\n[G7(b9)]Holy [C/E]One';
 const edits=chordRemovalSuggestions(input);
 assert.deepEqual(edits.map(edit=>edit.line),[0,1,5]);
 assert.equal(edits.at(-1).replacement,'Holy One');
 assert.equal(chordRemovalSuggestions('A\nAm\nC\nG\nF\nD\nE\nB').length,0);
});
test('a changed lyric line refuses a stale removal and unbounded input is rejected',()=>{
 const original='[C]Original words',edits=chordRemovalSuggestions(original);
 assert.throws(()=>applyChordRemoval('[C]Changed words',edits,[0]),/lyrics changed/);
 assert.throws(()=>chordRemovalSuggestions('x'.repeat(100001)),/100,000/);
});
