import {phoneEnrollmentDevices} from './phone-enrollment';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {HttpError,now} from './core';
// RFC 6238 dynamic truncation, 30-second steps. Each paired PC has a derived key.
export function timeCode(secret:Uint8Array,seconds:number,digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(seconds/30)));const mac=createHmac('sha1',secret).update(counter).digest();const offset=mac[mac.length-1]&15;return String((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function computerCode(master:string,id:string,seconds=now()){const key=createHmac('sha256',Buffer.from(master,'hex')).update('stati-enrollment:'+id).digest();return{code:timeCode(key,seconds),expiresAt:(Math.floor(seconds/30)+1)*30,serverTime:seconds};}
export async function verifyEnrollment(env:Env,code:string){if(!env.ENROLLMENT_SECRET||!/^[a-f0-9]{64}$/i.test(env.ENROLLMENT_SECRET))throw new HttpError(503,'The computer authenticator is not configured.');const devices=await env.DB.prepare("SELECT d.id FROM devices d JOIN users u ON u.id=d.owner_id WHERE d.revoked_at IS NULL AND d.last_seen>? AND u.status='active' LIMIT 100").bind(now()-45).all<{id:string}>();const provided=Buffer.from(code);let matched:string|null=null;for(const device of devices.results){const expected=Buffer.from(computerCode(env.ENROLLMENT_SECRET,device.id).code);if(provided.length===expected.length&&timingSafeEqual(provided,expected))matched=device.id;}if(!matched)throw new HttpError(401,'That code expired or did not match. Enter the current code shown on the computer.');return matched;}

export async function matchPhoneEnrollment(env:Env,code:string){
 if(!env.ENROLLMENT_SECRET||!/^[a-f0-9]{64}$/i.test(env.ENROLLMENT_SECRET))return null;
 const given=Buffer.from(code);let matched:string|null=null;
 for(const id of await phoneEnrollmentDevices(env)){const expected=Buffer.from(computerCode(env.ENROLLMENT_SECRET,id).code);if(given.length===expected.length&&timingSafeEqual(given,expected))matched=id;}
 return matched;
}
