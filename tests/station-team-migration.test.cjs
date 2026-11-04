const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

test('station role migration preserves identities and grants only explicit local ownership',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of fs.readdirSync('migrations').filter(name=>name.endsWith('.sql')&&name<'0034').sort())db.exec(fs.readFileSync('migrations/'+name,'utf8'));
  for(const id of ['owner','global-admin','member','denied-owner','disconnected-owner','revoked-owner']){
   db.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Migration','T',?,'active',100)").run(id,id==='member'?'member':'admin');
  }
  db.prepare("INSERT INTO user_ministry_roles(user_id,role,updated_at) VALUES('global-admin','pastor',101)").run();
  for(const [id,owner] of [['a','owner'],['b','denied-owner'],['c','disconnected-owner'],['d','revoked-owner']]){
   db.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires) VALUES(?,?,?,?,100,0)').run(id,'synthetic-'+id,'Migration PC',owner);
  }
  for(const [device,user,status] of [['a','global-admin','approved'],['a','member','approved'],['b','denied-owner','denied']]){
   db.prepare('INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,?,101)').run(device,user,status);
  }
  db.prepare("INSERT INTO station_disconnections VALUES('c','disconnected-owner',102,'synthetic-disconnect')").run();
  db.prepare("UPDATE devices SET revoked_at=103 WHERE id='d'").run();
  const identities=db.prepare('SELECT * FROM users ORDER BY id').all();
  const ministry=db.prepare('SELECT * FROM user_ministry_roles ORDER BY user_id').all();
  const memberships=db.prepare('SELECT * FROM station_memberships ORDER BY device_id,user_id').all();
  db.exec(fs.readFileSync('migrations/0034_station_team_roles.sql','utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),identities);
  assert.deepEqual(db.prepare('SELECT * FROM user_ministry_roles ORDER BY user_id').all(),ministry);
  assert.deepEqual(db.prepare('SELECT device_id,user_id,status,updated_at FROM station_memberships WHERE user_id!=? ORDER BY device_id,user_id').all('owner'),memberships);
  for(const id of ['global-admin','member'])assert.deepEqual({...db.prepare("SELECT role,ministry_role FROM station_memberships WHERE device_id='a' AND user_id=?").get(id)},{role:'member',ministry_role:null});
  assert.deepEqual({...db.prepare("SELECT status,role,ministry_role FROM station_memberships WHERE device_id='a' AND user_id='owner'").get()},{status:'approved',role:'admin',ministry_role:null});
  assert.deepEqual({...db.prepare("SELECT status,role FROM station_memberships WHERE device_id='b'").get()},{status:'denied',role:'member'});
  assert.equal(db.prepare("SELECT count(*) AS n FROM station_memberships WHERE device_id IN ('c','d')").get().n,0);
  assert.throws(()=>db.prepare("UPDATE station_memberships SET role='superadmin'").run(),/CHECK constraint failed/);
  assert.throws(()=>db.prepare("UPDATE station_memberships SET ministry_role='unknown'").run(),/CHECK constraint failed/);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
