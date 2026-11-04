const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const fixturePath=path.resolve(__dirname,'background-receiver.test.cjs'),source=fs.readFileSync(fixturePath,'utf8');
const {fixture,drain}=vm.runInThisContext('(function(require,__dirname){'+source.slice(0,source.indexOf('\ntest('))+'\nreturn{fixture,drain};})',{filename:fixturePath})(createRequire(fixturePath),path.dirname(fixturePath));
test('admin invitation QR carries the current joining grant rather than opening an empty entry form',async()=>{
 let encoded;const f=fixture({startup:false,route:({endpoint})=>endpoint==='/station/enrollment-code'?Response.json({code:'123456',expiresAt:200,serverTime:100}):undefined,modules:{qrcode:{toDataURL:async url=>{encoded=url;return 'synthetic-qr';}}}});
 await f.start();await drain();f.selectOperator({id:'invite-admin-fixture-0001',role:'admin',capabilities:{}});const result=await f.invoke('enrollment-code');assert.equal(new URL(encoded).origin,'https://stati.ciani01.org');assert.equal(new URL(encoded).hash,'#join=123456');assert.equal(result.qr,'synthetic-qr');
});
