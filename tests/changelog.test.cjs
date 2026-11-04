const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const changelog=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/shared/changelog.json'),'utf8'));

test('public changelog contains bounded, plain published release content',()=>{
  assert.equal(changelog.schema,1);
  assert.ok(changelog.releases.length>0&&changelog.releases.length<=100);
  assert.ok(Buffer.byteLength(JSON.stringify(changelog))<=100_000);
  const text=(value,max)=>{assert.equal(typeof value,'string');assert.ok(value.length>0&&value.length<=max);assert.doesNotMatch(value,/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/);};
  const seen=new Set();let previous=Infinity,previousNumber=Infinity;
  for(const release of changelog.releases){
    assert.match(release.version,/^0\.1\.0-preview\.\d+$/);
    assert.ok(!seen.has(release.version));seen.add(release.version);
    const preview=Number(release.version.split('.').at(-1));assert.ok(preview<previousNumber);previousNumber=preview;
    assert.match(release.publishedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const timestamp=Date.parse(release.publishedAt);assert.ok(Number.isFinite(timestamp)&&timestamp<=previous);previous=timestamp;
    assert.equal(release.label,'Preview '+preview);text(release.title,100);
    assert.ok(release.areas.length>0&&release.areas.length<=3);for(const area of release.areas)assert.ok(['Windows','Website','Server','Android'].includes(area));
    assert.ok(release.highlights.length>0&&release.highlights.length<=8);for(const highlight of release.highlights)text(highlight,500);
    assert.equal(release.url,'https://github.com/markusciani/stati-releases/releases/tag/v'+release.version);
  }
});

test('changelog render is public content without account requests or executable HTML',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/web/Changelog.tsx'),'utf8');
  assert.doesNotMatch(source,/dangerouslySetInnerHTML|innerHTML|\bapi\(|\bfetch\(|\blocalStorage\b|\bsessionStorage\b/);
  assert.match(source,/timeZone:\s*'UTC'/);
  assert.match(source,/rel="noopener noreferrer"/);
});
