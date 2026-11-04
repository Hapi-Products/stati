const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
test('profile ledger migration preserves existing active/removed photo references and leaves accounts unchanged',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const name of fs.readdirSync('migrations').filter(name=>name.endsWith('.sql')&&name<'0009').sort())db.exec(fs.readFileSync('migrations/'+name,'utf8'));
  const insert=db.prepare('INSERT INTO users(id,first_name,last_initial,role,status,photo_key,created_at) VALUES(?,?,?,?,?,?,?)');
  const active='00000000-0000-4000-8000-000000000001',removed='00000000-0000-4000-8000-000000000002',plain='00000000-0000-4000-8000-000000000003';
  for(const [id,status,key]of[[active,'active','profiles/'+active+'/00000000-0000-4000-8000-000000000011'],[removed,'removed','profiles/'+removed+'/00000000-0000-4000-8000-000000000012'],[plain,'pending',null]])insert.run(id,'Local migration fixture','T','member',status,key,123);
  const before=db.prepare('SELECT * FROM users ORDER BY id').all();db.exec(fs.readFileSync('migrations/0009_profile_photo_objects.sql','utf8'));assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),before);
  const objects=db.prepare('SELECT * FROM profile_photo_objects ORDER BY user_id').all();assert.equal(objects.length,2);assert.ok(objects.every(row=>row.state==='current'&&row.expires_at===0&&row.expected_key===null));assert.deepEqual(objects.map(row=>row.object_key),before.filter(row=>row.photo_key).map(row=>row.photo_key));assert.ok(db.prepare('EXPLAIN QUERY PLAN SELECT id FROM users WHERE photo_key=?').all(objects[0].object_key).some(row=>row.detail.includes('users_photo_key')));
  db.prepare('DELETE FROM users WHERE id=?').run(removed);const retained=db.prepare('SELECT * FROM profile_photo_objects WHERE object_key=?').get(objects[1].object_key);assert.equal(retained.user_id,null);assert.equal(retained.object_key,objects[1].object_key);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
