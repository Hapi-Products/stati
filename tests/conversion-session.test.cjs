const {test}=require('node:test'),assert=require('node:assert/strict');
const work=require('../desktop/conversion-work.cjs');
test('one conversion session handles successive jobs and reports failures without poisoning the next job',async()=>{
 const session=work.createSession();try{
  await assert.rejects(session.run('unknown'),/Unknown conversion/);
  const bytes=await session.run('build',{title:'First',slides:[{section:'Verse',text:'Together we sing'}]});assert.ok(Buffer.isBuffer(bytes));
  const second=await session.run('revise-build',bytes,{title:'Must not change',slides:[{section:'Verse',text:'Updated lyrics'}]});assert.equal(require('../desktop/presentation.cjs').decode(second).name,'First');
 }finally{await session.close();}await assert.rejects(session.run('build',{}),/closed/);
});
