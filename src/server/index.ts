import {worshipClicker,worshipLiveReader} from './worship-live-reader';
import {buildPauseAdmin,buildPauseStatus} from './build-pause';
import {sendSupportReport} from './support-reports';
import {issuePhoneEnrollment} from './phone-enrollment';
import {songComments,readSongComment} from './song-comments';
export {TaskEvents} from './task-events';
import {workspaceMutation} from '../shared/workspace-events';
import {notifyWorkspaceChange,notifyTaskChange,subscribeTaskEvents} from './task-events';
import {recentAvailability} from './recent-availability';
import {exportSongSlides} from './song-reader-export';
import {worshipGroupCandidates,worshipGroupsRoute} from './worship-groups';
import {fileEditRoute,cleanupFileEdits} from './file-edits';
import {mobileSession} from './mobile-session';
import {webSongCommand,nativeSongCommands} from './song-commands';
import {taskImageRoute,cleanupTaskImageUploads} from './task-images';
import {connectedStationPeople} from './station-people';
import {changeGroupMaterialSongLink} from './group-material-links';
import {assignGroupMaterial,listGroupMaterials,uploadGroupMaterial,readGroupMaterial,deleteGroupMaterial,cleanupGroupMaterialUploads} from './group-materials';
import {readFeedbackTasks,changeFeedbackTask} from './feedback-tasks';
import {renameAccountComputer,disconnectAccountComputer} from './account-computers';
import {readStationServices,changeStationService,readStationServiceVersions,saveStationServiceVersion} from './station-services';
import {readServiceRequests,changeServiceRequest} from './service-requests';
import {readServiceReadiness,changeServiceReadiness} from './service-readiness';
import {publishStationCatalog,readStationCatalog,requireStationMinistry} from './station-catalog';
import {expectedTransferChecksum,storeTransfer,transferResponse} from './transfer-integrity';
import {prepareUploadStream} from './upload-stream';
import {readProfilePhoto,profilePhotoResponse} from './profile-photo';
import {storeProfilePhoto,cleanupProfilePhotos} from './profile-photo-storage';
import {cleanupTransfers} from './transfer-cleanup';
import {UPLOAD_PROTOCOL,uploadFingerprint,uploadReceipt,replayUpload,storeIntentUpload,transferInsert,cleanupUploadAttempts} from './upload-intents';
import {timingSafeEqual} from 'node:crypto';
import {pinDigest,adminOptions,verifyAdminPasskey,operatorVerified,requireOperator,issueOperator,selectLegacyMemberOperator,beginLegacyPhoneOperator,resetLegacyOperator,issueLegacyPhoneOperator} from './operator-auth';
import {accountSetupWindow} from '../shared/services';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransport } from '@simplewebauthn/server';
import { z } from 'zod';
import {allowed,verifyAccess,bootstrapAllowed,enrollmentGrant} from './access';
import {registrationOptions,completeRegistration} from './registration';
import {connectedAdmin,connectionState,requireConnection,connectionRequests,decideConnection} from './connections';
import {connectionPresenceSchema,renewConnectionPresence} from './connection-presence';
import {senderDeliveries} from './sender-deliveries';
import {OPERATOR_LEASE_PROTOCOL,operatorDeviceContext,selectMemberOperator,selectPinOperator,beginPhoneOperator,activatePhoneOperator,renewOperatorSelection,resetOperatorSelection,requireSelectedOperator} from './operator-selection';
import {transferStatusInput,lookupTransferStatuses} from './transfer-status';
import {changeMember,listMinistryMembers,memberChangeSchema,ministryProfile,ministryAuthorityGuard,readMinistryRole,requireMinistryCapability,requireMinistryAuthority,type MinistryRole} from './ministry-roles';
import {androidUpdate} from './app-updates';
import {download,releaseList} from './downloads';
import {availability} from './availability';
import {computerCode} from './enrollment';
import { body, cookie, Device, fileType, hash, HttpError, json, MAX_FILE, now, profileSchema, safeFilename, setCookie, token, User } from './core';

async function user(r:Request,env:Env,active=true){const raw=cookie(r,'stati_session');if(!raw)throw new HttpError(401,'Sign in to continue.');const u=await env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(raw),now()).first<User>();if(!u||u.status==='removed')throw new HttpError(401,'Please sign in again.');if(active&&u.status!=='active')throw new HttpError(403,'Your church administrator needs to approve your account.');return u;}
async function admin(r:Request,env:Env){const u=await user(r,env);if(u.role!=='admin')throw new HttpError(403,'An administrator is required.');return u;}
async function device(r:Request,env:Env){const raw=r.headers.get('authorization')?.replace(/^Bearer /,'');if(!raw)throw new HttpError(401,'Pair this computer first.');const d=await env.DB.prepare("SELECT d.* FROM devices d JOIN users u ON d.owner_id=u.id WHERE d.token_hash=? AND d.revoked_at IS NULL AND u.status='active'").bind(await hash(raw)).first<Device>();if(!d)throw new HttpError(401,'Computer access has been revoked. Pair it again.');return d;}
async function audit(env:Env,u:User,action:string,id:string){await env.DB.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),u.id,action,id,now()).run();}
async function startChallenge(env:Env,kind:string,challenge:string,payload:unknown){const id=token();await env.DB.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)').bind(await hash(id),kind,challenge,JSON.stringify(payload),now()+300).run();return id;}
async function consumeChallenge(r:Request,env:Env,kind:string){const raw=cookie(r,'stati_challenge');if(!raw)throw new HttpError(400,'Start sign-in again.');const row=await env.DB.prepare('DELETE FROM challenges WHERE id=? AND kind=? AND expires_at>? RETURNING *').bind(await hash(raw),kind,now()).first<{challenge:string;payload:string}>();if(!row)throw new HttpError(400,'Sign-in expired. Please try again.');return row;}
async function signIn(env:Env,id:string){const raw=token();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(raw),id,now()+60*60*24*30).run();return json({ok:true},200,{'Set-Cookie':setCookie('stati_session',raw,60*60*24*30,env.APP_ORIGIN)});}
const webauthnPayload=z.object({response:z.record(z.string(),z.unknown())});
async function routes(r:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
 const url=new URL(r.url),p=url.pathname,m=r.method;
 if(p==='/api/support/reports'&&m==='POST')return sendSupportReport(r,env,(await user(r,env)).id);
 if(p==='/api/mobile/authorization')return mobileSession(r,env,true);
 if(p==='/api/mobile/session')return mobileSession(r,env,false);
 const fileEdit=p.match(/^\/api\/file-edits\/(group|task)\/([0-9a-f-]{36})$/i);if(fileEdit){const kind=fileEdit[1].toLowerCase() as 'group'|'task',response=await fileEditRoute(r,env,kind,fileEdit[2]);if(kind==='task'&&m==='PUT'&&response.ok)ctx.waitUntil(notifyTaskChange(env));return response;}
 if(p==='/api/recents/availability'&&m==='POST')return recentAvailability(r,env);
 const teamPage=p.match(/^\/api\/station\/team\/(tasks|groups|files)(?:\/([0-9a-f-]{36}))?$/i);
 if(teamPage&&m==='GET'){
  const station=await device(r,env),page=teamPage[1].toLowerCase(),id=teamPage[2];
  if(page==='tasks')return readFeedbackTasks(r,env,id,station.id);
  if(page==='groups')return worshipGroupsRoute(r,env,id,station.id);
  if(!id&&!url.searchParams.has('computerId')&&!url.searchParams.has('songId')&&url.searchParams.has('groupId'))return listGroupMaterials(r,env,station.id);
  throw new HttpError(400,'Choose a worship group.');
 }
 if(p==='/api/worship-groups/candidates')return worshipGroupCandidates(r,env);
 if(p==='/api/worship-groups')return worshipGroupsRoute(r,env);
 const worshipGroup=p.match(/^\/api\/worship-groups\/([0-9a-f-]{36})$/i);if(worshipGroup)return worshipGroupsRoute(r,env,worshipGroup[1]);
 if(p==='/api/group-materials'){if(m==='GET')return listGroupMaterials(r,env);if(m==='POST')return uploadGroupMaterial(r,env);}
 const groupAssignment=p.match(/^\/api\/group-materials\/([0-9a-f-]{36})\/group$/i);if(groupAssignment&&m==='POST')return assignGroupMaterial(r,env,groupAssignment[1]);
 const groupMaterialLink=p.match(/^\/api\/group-materials\/([0-9a-f-]{36})\/song-links$/i);if(groupMaterialLink&&m==='POST')return changeGroupMaterialSongLink(r,env,groupMaterialLink[1]);
 const groupMaterial=p.match(/^\/api\/group-materials\/([0-9a-f-]{36})(\/file)?$/i);if(groupMaterial){if(m==='GET'&&groupMaterial[2])return readGroupMaterial(r,env,groupMaterial[1]);if(m==='DELETE'&&!groupMaterial[2])return deleteGroupMaterial(r,env,groupMaterial[1]);}
 const songComment=p.match(/^\/api\/song-comments\/([0-9a-f-]{36})$/i);if(songComment&&m==='GET')return readSongComment(r,env,songComment[1]);
 const songCommentsRoute=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/song-comments$/i);if(songCommentsRoute){const response=await songComments(r,env,songCommentsRoute[1]);if(m==='POST'&&response.ok)ctx.waitUntil(notifyTaskChange(env));return response;}
 if(p==='/api/tasks/events'&&m==='GET')return subscribeTaskEvents(r,env);
 const taskImages=p.match(/^\/api\/tasks\/([0-9a-f-]{36})\/images(?:\/([0-9a-f-]{36}))?$/i);if(taskImages){const response=await taskImageRoute(r,env,taskImages[1],taskImages[2]);if(m!=='GET'&&response.ok)ctx.waitUntil(notifyTaskChange(env));return response;}
 const webSongCommands=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/song-commands(?:\/([a-f0-9]{64}))?$/i);if(webSongCommands)return webSongCommand(r,env,webSongCommands[1],webSongCommands[2]);
 const stationSongCommands=p.match(/^\/api\/station\/song-commands(?:\/([0-9a-f-]{36}))?$/i);if(stationSongCommands){const d=await device(r,env);return nativeSongCommands(r,env,d.id,stationSongCommands[1]);}
 if(p==='/api/tasks'){if(m==='GET')return readFeedbackTasks(r,env);if(m==='POST'){const response=await changeFeedbackTask(r,env);if(response.ok)ctx.waitUntil(notifyTaskChange(env));return response;}}
 const feedbackTask=p.match(/^\/api\/tasks\/([0-9a-f-]{36})$/i);if(feedbackTask&&m==='GET')return readFeedbackTasks(r,env,feedbackTask[1]);
 const readerRoute=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/worship-live\/([0-9a-f-]{36})$/i);
 if(readerRoute&&['GET','PUT','PATCH','DELETE'].includes(m))return worshipLiveReader(r,env,readerRoute[1],readerRoute[2]);
 const clickerRoute=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/live-clicker$/i);
 if(clickerRoute&&['GET','POST'].includes(m))return worshipClicker(r,env,clickerRoute[1]);
 const serviceTool=p.match(/^\/api\/(computers\/([0-9a-f-]{36})|station)\/services\/([0-9a-f-]{36})\/(versions|requests|readiness)$/i);
 if(serviceTool){const native=serviceTool[1]==='station',id=native?(await device(r,env)).id:serviceTool[2],serviceId=serviceTool[3],tool=serviceTool[4];if(m==='GET')return(tool==='versions'?readStationServiceVersions:tool==='requests'?readServiceRequests:readServiceReadiness)(r,env,id,serviceId,native);if(m==='POST')return(tool==='versions'?saveStationServiceVersion:tool==='requests'?changeServiceRequest:changeServiceReadiness)(r,env,id,serviceId,native);}
 const serviceRoute=p.match(/^\/api\/(computers\/([0-9a-f-]{36})|station)\/services$/i);
 if(serviceRoute){const native=serviceRoute[1]==='station',id=native?(await device(r,env)).id:serviceRoute[2];if(m==='GET')return readStationServices(r,env,id,native);if(m==='POST')return changeStationService(r,env,id,native);}
 if(p==='/api/station/catalog'&&m==='POST')return publishStationCatalog(r,env,await device(r,env),()=>ctx.waitUntil(notifyWorkspaceChange(env,'catalog-changed')));
 if(p==='/api/station/workspace'&&m==='GET'){const d=await device(r,env),authority=await requireStationMinistry(r,env,d.id,'readSongs',true);return json({deviceId:d.id,userId:authority.user.id,capabilities:authority.capabilities});}
 const songExport=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/songs\/([a-f0-9]{64})\/export$/i);if(songExport&&m==='GET')return exportSongSlides(r,env,songExport[1],songExport[2]);
 const songs=p.match(/^\/api\/computers\/([0-9a-f-]{36})\/songs(?:\/([a-f0-9]{64}))?$/i);
 if(songs&&m==='GET')return readStationCatalog(r,env,songs[1],songs[2]);

 if(p==='/api/access/status'&&m==='GET'){const state=await availability(env),grant=await enrollmentGrant(r,env);return json({allowed:await allowed(r,env,grant),open:state.open,...(grant?{registrationExpiresAt:grant.expires_at}:{})});}
 if(p==='/api/access/setup'&&m==='POST'){if(await env.DB.prepare("SELECT id FROM users WHERE role='admin' AND status='active' LIMIT 1").first())throw new HttpError(410,'Owner setup is already complete.');const data=await body(r,z.object({token:z.string().min(40).max(100)}));const stored=await env.DB.prepare("SELECT value FROM settings WHERE key='bootstrap_invite'").first<{value:string}>();if(!stored)throw new HttpError(410,'This setup invitation expired.');const [digest,expires]=stored.value.split(':');if(Number(expires)<=now()||digest!==await hash(data.token))throw new HttpError(410,'This setup invitation expired.');const used=await env.DB.prepare("DELETE FROM settings WHERE key='bootstrap_invite' AND value=? RETURNING key").bind(stored.value).first();if(!used)throw new HttpError(410,'This setup invitation was already used.');const raw=token();await env.DB.batch([env.DB.prepare('INSERT INTO access_grants VALUES(?,?,?)').bind(await hash(raw),now(),now()+31536000),env.DB.prepare("INSERT INTO settings(key,value) VALUES('bootstrap_grant',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await hash(raw)+':'+(now()+900))]);return json({ok:true},200,{'Set-Cookie':setCookie('stati_access',raw,31536000,env.APP_ORIGIN)});}
 if(p==='/api/access'&&m==='POST'){const data=await body(r,z.object({code:z.string().regex(/^\d{6}$/,'Enter the six-digit computer passcode.')}));return verifyAccess(r,env,data.code);}
 if(p==='/api/health')return json({service:'Stați',status:'ok'});
 if(p==='/api/build-status'&&m==='GET')return json({version:1,allowed:(await buildPauseStatus(env)).allowed});
 if(p==='/api/admin/build-pause'&&['GET','PUT'].includes(m))return buildPauseAdmin(r,env,await admin(r,env));
 if(p==='/api/auth/register/options'&&m==='POST')return registrationOptions(r,env);
 if(p==='/api/auth/register/verify'&&m==='POST')return signIn(env,await completeRegistration(r,env));
 if(p==='/api/auth/login/options'&&m==='POST'){
  const options=await generateAuthenticationOptions({rpID:env.RP_ID,userVerification:'required'});const challenge=await startChallenge(env,'login',options.challenge,{});return json(options,200,{'Set-Cookie':setCookie('stati_challenge',challenge,300,env.APP_ORIGIN)});
 }
 if(p==='/api/auth/login/verify'&&m==='POST'){
  const data=await body(r,webauthnPayload),c=await consumeChallenge(r,env,'login');const response=data.response as unknown as AuthenticationResponseJSON;const pk=await env.DB.prepare("SELECT p.* FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.id=? AND u.status!='removed'").bind(response.id).first<{id:string;user_id:string;public_key:string;counter:number;transports:string}>();if(!pk)throw new HttpError(401,'This passkey is not registered.');
  const result=await verifyAuthenticationResponse({response,expectedChallenge:c.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:env.RP_ID,requireUserVerification:true,credential:{id:pk.id,publicKey:Uint8Array.from(atob(pk.public_key),c=>c.charCodeAt(0)),counter:pk.counter,transports:JSON.parse(pk.transports) as AuthenticatorTransport[]}});if(!result.verified)throw new HttpError(401,'Sign-in could not be verified.');await env.DB.prepare('UPDATE passkeys SET counter=? WHERE id=?').bind(result.authenticationInfo.newCounter,pk.id).run();return signIn(env,pk.user_id);
 }
 if(p==='/api/auth/logout'&&m==='POST'){const raw=cookie(r,'stati_session');if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();return json({ok:true},200,{'Set-Cookie':setCookie('stati_session','',0,env.APP_ORIGIN)});}
 if(p==='/api/app-updates/android'&&m==='GET')return androidUpdate();
 if(p==='/api/downloads'&&m==='GET'){await admin(r,env);return releaseList(env);}
 const build=p.match(/^\/api\/downloads\/(windows-test|android-test)$/);if(build&&['GET','HEAD'].includes(m)){const u=await admin(r,env);return download(r,env,build[1]);}
 if(p==='/api/workspace'&&m==='GET'){const state=await availability(env);const grant=await enrollmentGrant(r,env);if(await bootstrapAllowed(r,env)||grant){state.accountCreationAllowed=true;state.skipAccountSetup=false;}if(grant)state.accountCodeRequired=false;return json({name:env.ORG_NAME,...state,...(grant?{registrationExpiresAt:grant.expires_at}:{})});}
 if(p==='/api/me/station-pin/options'&&m==='POST'){const u=await admin(r,env);const options=await adminOptions(env,u.id);const challenge=await startChallenge(env,'station-pin',options.challenge,{userId:u.id});return json(options,200,{'Set-Cookie':setCookie('stati_challenge',challenge,300,env.APP_ORIGIN)});}
 if(p==='/api/me/station-pin'&&m==='POST'){const u=await admin(r,env);const data=await body(r,z.object({pin:z.string().regex(/^\d{4}$/),response:z.record(z.string(),z.unknown())}));const c=await consumeChallenge(r,env,'station-pin');if(JSON.parse(c.payload).userId!==u.id)throw new HttpError(403,'Use your own passkey.');await verifyAdminPasskey(env,u.id,c.challenge,data.response as unknown as AuthenticationResponseJSON);const salt=token();await env.DB.batch([env.DB.prepare('INSERT INTO account_pins VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,digest=excluded.digest').bind(u.id,salt,await pinDigest(data.pin,salt)),env.DB.prepare('DELETE FROM operator_sessions WHERE user_id=?').bind(u.id)]);return json({ok:true});}
 if(p==='/api/station/operator/unlock'&&m==='POST'){
  const d=await device(r,env),data=await body(r,z.object({userId:z.string().uuid()}));
  const currentProtocol=r.headers.get('X-Stati-Operator-Protocol')===OPERATOR_LEASE_PROTOCOL;
  const u=await env.DB.prepare(`SELECT id FROM users WHERE id=? AND status='active' AND (role='admin' OR (?=1 AND role='member'))`).bind(data.userId,currentProtocol?1:0).first();
  if(!u)throw new HttpError(403,'Choose an active account.');
  const options=await adminOptions(env,data.userId);
  if(currentProtocol){
   const selected=await beginPhoneOperator(env,await operatorDeviceContext(r,d.id),data.userId,options.challenge);
   return json({...selected,url:env.APP_ORIGIN+'/unlock/'+selected.token});
  }
  const pending=await beginLegacyPhoneOperator(env,await operatorDeviceContext(r,d.id),data.userId,options.challenge);
  return json({...pending,url:env.APP_ORIGIN+'/unlock/'+pending.token});
 }
 const unlock=p.match(/^\/api\/operator-unlock\/([\w-]+)(\/verify)?$/);
 if(unlock){
  const eligibility=`d.revoked_at IS NULL AND u.status='active' AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=d.owner_id AND owner.status='active')
   AND (u.role='admin' OR (u.role='member' AND EXISTS(SELECT 1 FROM operator_selections selected
    WHERE selected.device_id=x.device_id AND selected.user_id=x.user_id AND selected.unlock_hash=x.token_hash AND selected.proof_kind='passkey' AND selected.status='pending' AND selected.expires_at>? AND ((selected.ministry_role IS NULL AND NOT EXISTS(SELECT 1 FROM user_ministry_roles ministry WHERE ministry.user_id=u.id)) OR EXISTS(SELECT 1 FROM user_ministry_roles ministry WHERE ministry.user_id=u.id AND ministry.role=selected.ministry_role)))))`;
  const row=await env.DB.prepare(`SELECT x.*,d.name,u.first_name,u.last_initial FROM operator_unlocks x JOIN devices d ON d.id=x.device_id JOIN users u ON u.id=x.user_id WHERE x.token_hash=? AND x.expires_at>? AND x.approved=0 AND ${eligibility}`).bind(await hash(unlock[1]),now(),now()).first<{token_hash:string;device_id:string;user_id:string;challenge:string;name:string;first_name:string;last_initial:string}>();
  if(!row)throw new HttpError(410,'Unlock request expired or already used.');
  if(m==='GET'&&!unlock[2]){const options=await adminOptions(env,row.user_id);options.challenge=row.challenge;return json({name:row.name,person:row.first_name+' '+row.last_initial+'.',options});}
  if(m==='POST'&&unlock[2]){
   const data=await body(r,webauthnPayload);await verifyAdminPasskey(env,row.user_id,row.challenge,data.response as unknown as AuthenticationResponseJSON);
   const changed=await env.DB.prepare(`UPDATE operator_unlocks SET approved=1 WHERE token_hash=? AND challenge=? AND approved=0 AND expires_at>? AND EXISTS(SELECT 1 FROM operator_unlocks x JOIN devices d ON d.id=x.device_id JOIN users u ON u.id=x.user_id WHERE x.token_hash=operator_unlocks.token_hash AND ${eligibility})`).bind(row.token_hash,row.challenge,now(),now()).run();
   if(!changed.meta.changes)throw new HttpError(410,'Unlock already used or account access changed.');return json({ok:true});
  }
 }
 if(p==='/api/station/operator/unlock/status'&&m==='POST'){
  const d=await device(r,env),data=await body(r,z.object({token:z.string().min(32).max(100),userId:z.string().uuid().optional()}));
  if(r.headers.get('X-Stati-Operator-Protocol')===OPERATOR_LEASE_PROTOCOL){
   if(!data.userId)throw new HttpError(400,'Choose the account for this phone request.');
   const selected=await activatePhoneOperator(env,await operatorDeviceContext(r,d.id),{userId:data.userId,lease:r.headers.get('X-Stati-Operator-Lease')||'',token:data.token});
   return json(selected?{approved:true,...selected}:{approved:false});
  }
  const context=await operatorDeviceContext(r,d.id),proof=await issueLegacyPhoneOperator(env,d.id,context.deviceTokenHash,data.token);
  return json(proof?{approved:true,proof}:{approved:false});
 }
 if(p==='/api/me'&&m==='GET'){const u=await user(r,env,false);return json({user:{...ministryProfile(u,await readMinistryRole(env,u.id)),photo_key:undefined,photoUrl:u.photo_key?'/api/members/'+u.id+'/photo?v='+(await hash(u.photo_key)).slice(0,16):null},organization:env.ORG_NAME});}
 if(p==='/api/me'&&m==='PATCH'){const u=await user(r,env,false),data=await body(r,profileSchema);await env.DB.prepare('UPDATE users SET first_name=?,last_initial=? WHERE id=?').bind(data.firstName,data.lastInitial.toUpperCase(),u.id).run();return json({ok:true});}
 if(p==='/api/me/photo'&&m==='PUT'){const u=await user(r,env,false),{bytes,type}=await readProfilePhoto(r);return json(await storeProfilePhoto(env,{userId:u.id,previousKey:u.photo_key,sessionHash:await hash(cookie(r,'stati_session')!),bytes,type,signal:r.signal}));}
 const photo=p.match(/^\/api\/members\/([\w-]+)\/photo$/);
 if(photo&&m==='GET'){const viewer=await user(r,env,false);if(viewer.status!=='active'&&photo[1]!==viewer.id)throw new HttpError(403,'Membership approval required.');const target=await env.DB.prepare("SELECT photo_key FROM users WHERE id=? AND (status='active' OR id=?)").bind(photo[1],viewer.id).first<{photo_key:string|null}>();if(!target?.photo_key)throw new HttpError(404,'Photo unavailable.');const object=await env.FILES.get(target.photo_key);if(!object)throw new HttpError(404,'Photo unavailable.');return profilePhotoResponse(object);}
 if(p==='/api/members'&&m==='GET')return json(await listMinistryMembers(r,env));
 const member=p.match(/^\/api\/members\/([\w-]+)$/);
 if(member&&m==='PATCH'){const authority=await requireMinistryAuthority(r,env),data=await body(r,memberChangeSchema);return json(await changeMember(env,authority,member[1],data));}
 if(p==='/api/audit'&&m==='GET'){await admin(r,env);return json((await env.DB.prepare('SELECT a.*,u.first_name,u.last_initial FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100').all()).results);}
 const phoneInvite=p.match(/^\/api\/devices\/([\w-]+)\/enrollment-code$/);if(phoneInvite&&m==='GET')return issuePhoneEnrollment(r,env,phoneInvite[1]);
 if(p==='/api/devices/pair'&&m==='POST'){
  const data=await body(r,z.object({name:z.string().trim().min(1).max(60)}));const id=crypto.randomUUID(),raw=token(),code=token(12);await env.DB.prepare('INSERT INTO devices(id,token_hash,pair_code,name,created_at,pair_expires) VALUES(?,?,?,?,?,?)').bind(id,await hash(raw),code,data.name,now(),now()+600).run();return json({id,credential:raw,code,expiresAt:now()+600,url:env.APP_ORIGIN+'/pair/'+code});
 }
 if(p==='/api/devices/claim'&&m==='POST'){const u=await user(r,env),data=await body(r,z.object({code:z.string().min(8).max(50)}));const row=await env.DB.prepare('UPDATE devices SET owner_id=?,pair_code=NULL WHERE pair_code=? AND pair_expires>? AND owner_id IS NULL AND revoked_at IS NULL RETURNING id,name').bind(u.id,data.code,now()).first();if(!row)throw new HttpError(410,'This pairing link expired or has already been used.');await audit(env,u,'pair-computer',String(row.id));return json(row);}
 if(p==='/api/devices/pair/status'&&m==='GET'){const raw=r.headers.get('authorization')?.replace(/^Bearer /,'');if(!raw)throw new HttpError(401,'Missing pairing credential.');const d=await env.DB.prepare('SELECT id,name,owner_id,pair_code,pair_expires,revoked_at FROM devices WHERE token_hash=?').bind(await hash(raw)).first<Device>();if(!d||d.revoked_at||(!d.owner_id&&d.pair_expires<now()))throw new HttpError(410,'Pairing expired.');return json({id:d.id,name:d.name,paired:!!d.owner_id,...(!d.owner_id&&d.pair_code?{url:env.APP_ORIGIN+'/pair/'+d.pair_code,expiresAt:d.pair_expires}:{})});}
 if(p==='/api/devices'&&m==='GET'){const viewer=await user(r,env,false);return json((await env.DB.prepare("SELECT d.id,d.name,d.last_seen,d.owner_id,d.operator_id FROM devices d WHERE d.owner_id IS NOT NULL AND d.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=d.id AND removed.user_id=?) AND ((?='admin' AND ?='active') OR EXISTS(SELECT 1 FROM station_memberships sm WHERE sm.device_id=d.id AND sm.user_id=? AND sm.status='approved')) ORDER BY d.name").bind(viewer.id,viewer.role,viewer.status,viewer.id).all()).results);}
 const disconnect=p.match(/^\/api\/devices\/([\w-]+)\/disconnect$/);
 if(disconnect&&m==='POST')return json(await disconnectAccountComputer(env,await user(r,env),disconnect[1],await hash(cookie(r,'stati_session')!)));
 const revoke=p.match(/^\/api\/devices\/([\w-]+)$/);
 if(revoke&&m==='PATCH'){const u=await user(r,env),data=await body(r,z.object({name:z.string().trim().min(1).max(60)}));const result=await renameAccountComputer(env,u,revoke[1],data.name,await hash(cookie(r,'stati_session')!));await audit(env,u,'rename-computer',revoke[1]);return json(result);}
 if(revoke&&m==='DELETE'){const u=await admin(r,env);const d=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(revoke[1]).first<Device>();if(!d|| (u.role!=='admin'&&d.owner_id!==u.id))throw new HttpError(403,'Only its owner or an administrator can revoke this computer.');await env.DB.batch([env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),d.id),env.DB.prepare('UPDATE receivers SET closed_at=? WHERE device_id=?').bind(now(),d.id)]);await audit(env,u,'revoke-computer',d.id);return json({ok:true});}
 if(p==='/api/station/device'&&m==='PATCH'){const d=await device(r,env);await requireOperator(r,env,d.id);const data=await body(r,z.object({name:z.string().trim().min(1).max(60)}));await env.DB.prepare('UPDATE devices SET name=? WHERE id=?').bind(data.name,d.id).run();return json({ok:true,name:data.name});}
 if(p==='/api/station/device'&&m==='DELETE'){const d=await device(r,env);await requireOperator(r,env,d.id);await env.DB.batch([env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now(),d.id),env.DB.prepare('UPDATE receivers SET closed_at=? WHERE device_id=? AND closed_at IS NULL').bind(now(),d.id)]);return json({ok:true});}
 if(p==='/api/station/state'&&m==='GET'){const d=await device(r,env);await env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),d.id).run();const results=await env.DB.batch<Record<string,unknown>>([env.DB.prepare("SELECT u.id,u.first_name,u.last_initial,u.role,u.status,u.photo_key IS NOT NULL AS has_photo,m.role AS ministry_role FROM users u LEFT JOIN user_ministry_roles m ON m.user_id=u.id WHERE u.status='active' AND (m.role IS NULL OR m.role NOT IN ('pastor','commenter')) ORDER BY u.first_name,u.id"),env.DB.prepare("SELECT t.id,t.filename,t.bytes,t.content_type,t.status,t.created_at,t.rejection_reason,CASE WHEN u.status='active' THEN u.role ELSE NULL END AS sender_role,u.id AS sender_id,u.first_name,u.last_initial,u.photo_key IS NOT NULL AS has_photo FROM transfers t LEFT JOIN users u ON u.id=t.sender_id WHERE t.device_id=? AND t.expires_at>? ORDER BY CASE WHEN t.status='queued' THEN 0 ELSE 1 END,t.created_at DESC,t.id DESC LIMIT 100").bind(d.id,now()),env.DB.prepare('SELECT r.id,r.message,r.created_at,u.first_name,u.last_initial FROM requests r JOIN users u ON u.id=r.user_id WHERE r.device_id=? AND r.acknowledged_at IS NULL ORDER BY r.created_at DESC LIMIT 50').bind(d.id)]);const accessRequests=await connectionRequests(env,d.id);return json({connectedPeople:await connectedStationPeople(r,env,d),operatorLeaseProtocol:OPERATOR_LEASE_PROTOCOL,adminUnlocked:await operatorVerified(r,env,d.id),accessRequests,accessApprover:await connectedAdmin(env,d.id)?'admin':'operator',device:d,organization:env.ORG_NAME,...await availability(env),members:results[0].results.map(row=>{const {ministry_role,...person}=row;return ministryProfile({...person,role:person.role==='admin'?'admin':'member',status:'active'},ministry_role as MinistryRole|null,{native:true});}),transfers:results[1].results,requests:results[2].results});}
 const stationPhoto=p.match(/^\/api\/station\/senders\/([\w-]+)\/photo$/);
 if(stationPhoto&&m==='GET'){const d=await device(r,env);const target=await env.DB.prepare("SELECT u.photo_key FROM users u WHERE u.id=? AND (u.status='active' OR EXISTS(SELECT 1 FROM delivery_records t WHERE t.sender_id=u.id AND t.device_id=?))").bind(stationPhoto[1],d.id).first<{photo_key:string|null}>();if(!target?.photo_key)throw new HttpError(404,'Photo unavailable.');const image=await env.FILES.get(target.photo_key);if(!image)throw new HttpError(404,'Photo unavailable.');return profilePhotoResponse(image);}
 const dismissal=p.match(/^\/api\/transfers\/([\w-]+)\/dismiss$/);
 if(dismissal&&m==='POST'){const u=await user(r,env,false);const row=await env.DB.prepare('SELECT status FROM delivery_records WHERE id=? AND sender_id=?').bind(dismissal[1],u.id).first<{status:string}>();if(!row)throw new HttpError(404,'Delivery unavailable.');if(!['rejected','delivered'].includes(row.status))throw new HttpError(409,'This delivery has not finished.');await env.DB.prepare('INSERT INTO delivery_dismissals(transfer_id,user_id,dismissed_at) SELECT id,sender_id,? FROM delivery_records WHERE id=? AND sender_id=? AND status IN (\'rejected\',\'delivered\') ON CONFLICT(transfer_id,user_id) DO NOTHING').bind(now(),dismissal[1],u.id).run();return json({ok:true});}
 if(p==='/api/transfers/clear-history'&&m==='POST'){const u=await user(r,env,false);await env.DB.prepare("UPDATE delivery_records SET history_hidden_at=? WHERE sender_id=? AND history_hidden_at IS NULL AND (status!='queued' OR COALESCE((SELECT expires_at FROM transfers live WHERE live.id=delivery_records.id AND live.sender_id=delivery_records.sender_id AND live.device_id=delivery_records.device_id),created_at+86400)<=?) AND EXISTS(SELECT 1 FROM users actor JOIN sessions session ON session.user_id=actor.id WHERE actor.id=delivery_records.sender_id AND actor.status!='removed' AND session.token_hash=? AND session.expires_at>?)").bind(now(),u.id,now(),await hash(cookie(r,'stati_session')!),now()).run();return json({ok:true});}
 if(p==='/api/transfers'&&m==='GET'){const u=await user(r,env,false);return json(await senderDeliveries(env,u.id));}
 if(p==='/api/station/receiver'&&m==='PATCH'){const d=await device(r,env);const data=await body(r,z.object({id:z.string().uuid()}));const row=await env.DB.prepare('UPDATE receivers SET expires_at=? WHERE id=? AND device_id=? AND closed_at IS NULL AND expires_at>? RETURNING expires_at').bind(now()+300,data.id,d.id,now()).first<{expires_at:number}>();if(!row)throw new HttpError(410,'Receiver closed.');return json({expiresAt:row.expires_at});}
 if(p==='/api/station/enrollment-code'&&m==='GET'){const d=await device(r,env);await requireOperator(r,env,d.id);if(!d.operator_id||!await env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active' AND role='admin'").bind(d.operator_id).first())throw new HttpError(403,'Choose an administrator to show the joining code.');if(!env.ENROLLMENT_SECRET)throw new HttpError(503,'The computer authenticator is not configured.');return json(computerCode(env.ENROLLMENT_SECRET,d.id));}
 if(p==='/api/station/operator/presence'&&m==='POST'){
  const d=await device(r,env),data=await body(r,z.object({userId:z.string().uuid()}));
  return json(await renewOperatorSelection(r,env,d.id,data.userId));
 }
 if(p==='/api/station/operator'&&m==='POST'){
  const d=await device(r,env),data=await body(r,z.object({userId:z.string().uuid().nullable(),pin:z.string().regex(/^\d{4}$/).optional()}));
  const currentProtocol=r.headers.get('X-Stati-Operator-Protocol')===OPERATOR_LEASE_PROTOCOL;
  if(!data.userId){if(currentProtocol)return json({ok:true,...await resetOperatorSelection(r,env,d.id)});await resetLegacyOperator(env,await operatorDeviceContext(r,d.id));return json({ok:true});}
  const u=await env.DB.prepare("SELECT id,role FROM users WHERE id=? AND status='active'").bind(data.userId).first<{id:string;role:string}>();
  if(!u)throw new HttpError(400,'Choose a registered member.');
  if(u.role==='admin'){
   
   const pin=await env.DB.prepare('SELECT salt,digest FROM account_pins WHERE user_id=?').bind(u.id).first<{salt:string;digest:string}>();
   if(!pin||!data.pin)throw new HttpError(401,'Enter your account PIN or use your phone passkey.');
   const digest=await pinDigest(data.pin,pin.salt);
   if(!timingSafeEqual(new TextEncoder().encode(digest),new TextEncoder().encode(pin.digest)))throw new HttpError(401,'Incorrect PIN.');
   await env.DB.batch([env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind('operator-pin-v2:'+u.id),env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind('operator-pin-device-v2:'+d.id)]);
   return json(currentProtocol?{ok:true,...await selectPinOperator(env,await operatorDeviceContext(r,d.id),u.id,pin)}:{ok:true,proof:await issueOperator(env,await operatorDeviceContext(r,d.id),u.id,pin)});
  }
  if(currentProtocol){if(await readMinistryRole(env,u.id))throw new HttpError(401,'Use your phone passkey to unlock this account.');return json({ok:true,...await selectMemberOperator(env,await operatorDeviceContext(r,d.id),u.id)});}
  await selectLegacyMemberOperator(env,await operatorDeviceContext(r,d.id),u.id);return json({ok:true});
 }
 if(p==='/api/station/receiver'&&m==='POST'){const d=await device(r,env);const id=crypto.randomUUID(),raw=token(18),time=now();await env.DB.batch([env.DB.prepare('UPDATE receivers SET closed_at=? WHERE device_id=? AND closed_at IS NULL').bind(time,d.id),env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(time,d.id),env.DB.prepare('INSERT INTO receivers VALUES(?,?,?,?,NULL,?)').bind(id,d.id,await hash(raw),time+300,time)]);return json({id,url:env.APP_ORIGIN+'/send/'+raw,token:raw,expiresAt:time+300});}
 if(p==='/api/station/receiver'&&m==='DELETE'){const d=await device(r,env);await env.DB.prepare('UPDATE receivers SET closed_at=? WHERE device_id=? AND closed_at IS NULL').bind(now(),d.id).run();return json({ok:true});}
 if(p==='/api/connections/presence'&&m==='POST'){const u=await user(r,env,false),data=r.body?await body(r,connectionPresenceSchema):{deviceIds:[]};return json(await renewConnectionPresence(env,{userId:u.id,sessionHash:await hash(cookie(r,'stati_session')!),deviceIds:data.deviceIds}));}
 const connect=p.match(/^\/api\/connections\/(device:)?([\w-]+)$/);
 if(connect&&m==='POST'){
  const u=await user(r,env,false),sessionHash=await hash(cookie(r,'stati_session')!),time=now();
  const row=await env.DB.prepare(`SELECT r.id,r.device_id FROM receivers r JOIN devices d ON d.id=r.device_id JOIN users owner ON owner.id=d.owner_id WHERE ${connect[1]?'d.id':'r.token_hash'}=? AND r.closed_at IS NULL AND r.expires_at>? AND d.last_seen>? AND d.revoked_at IS NULL AND owner.status='active'`).bind(connect[1]?connect[2]:await hash(connect[2]),time,time-45).first<{id:string;device_id:string}>();
  const liveSession="EXISTS(SELECT 1 FROM sessions session JOIN users person ON person.id=session.user_id WHERE session.token_hash=? AND session.user_id=? AND session.expires_at>? AND person.status!='removed')";
  if(!row){
   if(connect[1]&&u.role==='admin'&&u.status==='active'){
    const target=await env.DB.prepare("SELECT d.id FROM devices d JOIN users owner ON owner.id=d.owner_id WHERE d.id=? AND d.revoked_at IS NULL AND owner.status='active' AND EXISTS(SELECT 1 FROM sessions session JOIN users actor ON actor.id=session.user_id WHERE session.token_hash=? AND actor.id=? AND actor.role='admin' AND actor.status='active' AND session.expires_at>?)").bind(connect[2],sessionHash,u.id,time).first();
    if(target){await env.DB.prepare("DELETE FROM station_disconnections WHERE device_id=? AND user_id=? AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=station_disconnections.user_id AND actor.role='admin' AND actor.status='active') AND "+liveSession).bind(connect[2],u.id,sessionHash,u.id,time).run();const current=await env.DB.prepare("SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=? AND removed.user_id=?) AND EXISTS(SELECT 1 FROM sessions session JOIN users actor ON actor.id=session.user_id WHERE session.token_hash=? AND actor.id=? AND actor.role='admin' AND actor.status='active' AND session.expires_at>?)").bind(connect[2],u.id,sessionHash,u.id,time).first();if(!current)throw new HttpError(409,'Your connection changed. Sign in and connect again.');return json({connection:{status:'approved'},approver:'operator'});}
   }
   throw new HttpError(410,'The receiver is closed.');
  }
  const results=await env.DB.batch([
   env.DB.prepare('DELETE FROM station_disconnections WHERE device_id=? AND user_id=? AND '+liveSession).bind(row.device_id,u.id,sessionHash,u.id,time),
   env.DB.prepare(`INSERT INTO computer_connections(id,receiver_id,device_id,user_id,status,last_seen,created_at)
    SELECT ?,receiver.id,receiver.device_id,requester.id,CASE WHEN requester.role='admin' AND requester.status='active' OR EXISTS(SELECT 1 FROM station_memberships member WHERE member.device_id=receiver.device_id AND member.user_id=requester.id AND member.status='approved') THEN 'approved' ELSE 'pending' END,?,?
    FROM receivers receiver JOIN devices computer ON computer.id=receiver.device_id JOIN users owner ON owner.id=computer.owner_id JOIN users requester ON requester.id=? JOIN sessions session ON session.user_id=requester.id
    WHERE receiver.id=? AND receiver.closed_at IS NULL AND receiver.expires_at>? AND computer.revoked_at IS NULL AND computer.last_seen>? AND owner.status='active' AND requester.status!='removed' AND session.token_hash=? AND session.expires_at>?
     AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=computer.id AND removed.user_id=requester.id)
    ON CONFLICT(receiver_id,user_id) DO UPDATE SET last_seen=excluded.last_seen`).bind(crypto.randomUUID(),time,time,u.id,row.id,time,time-45,sessionHash,time),
  ]);
  if(!results[1].meta.changes)throw new HttpError(409,'Your connection changed. Scan the computer code again.');
  return json(await connectionState(env,u,row));
 }

 const decision=p.match(/^\/api\/(station\/)?connections\/([\w-]+)\/decision$/);
 if(decision&&m==='POST'){const data=await body(r,z.object({status:z.enum(['approved','denied'])}));if(decision[1]){const d=await device(r,env);await decideConnection(env,decision[2],data.status,null,d.id,await requireSelectedOperator(r,env,d.id));}else await decideConnection(env,decision[2],data.status,await user(r,env));return json({ok:true});}
 if(p==='/api/connections/pending'&&m==='GET'){const u=await admin(r,env);const devices=await env.DB.prepare("SELECT DISTINCT c.device_id FROM computer_connections c JOIN receivers r ON r.id=c.receiver_id WHERE c.user_id=? AND c.status='approved' AND c.last_seen>? AND r.closed_at IS NULL AND r.expires_at>?").bind(u.id,now()-45,now()).all<{device_id:string}>();const requests=[];for(const d of devices.results)requests.push(...await connectionRequests(env,d.device_id));return json(requests);}
 if(p==='/api/receivers'&&m==='GET'){const viewer=await user(r,env,false);return json((await env.DB.prepare("SELECT d.id,d.name,MAX(r.expires_at) AS expiresAt,CASE WHEN d.last_seen>? AND MAX(r.expires_at)>? THEN 1 ELSE 0 END AS online FROM devices d LEFT JOIN receivers r ON r.device_id=d.id AND r.closed_at IS NULL AND r.expires_at>? JOIN users u ON u.id=d.owner_id WHERE d.revoked_at IS NULL AND u.status='active' AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=d.id AND removed.user_id=?) AND ((?='admin' AND ?='active') OR (d.last_seen>? AND r.id IS NOT NULL AND EXISTS(SELECT 1 FROM station_memberships sm WHERE sm.device_id=d.id AND sm.user_id=? AND sm.status='approved'))) GROUP BY d.id,d.name ORDER BY d.name").bind(now()-45,now(),now(),viewer.id,viewer.role,viewer.status,now()-45,viewer.id).all()).results);}
 const parseUploadId=(value:unknown)=>{const parsed=z.string().uuid().safeParse(value);if(!parsed.success)throw new HttpError(400,'Invalid upload or computer ID.');return parsed.data;};
 const lookup=p.match(/^\/api\/uploads\/([\w-]+)$/);
 if(lookup&&m==='GET'){const sender=await user(r,env,false),intentId=parseUploadId(lookup[1]),deviceId=parseUploadId(url.searchParams.get('deviceId'));const receipt=await uploadReceipt(env,sender.id,deviceId,intentId);if(!receipt)throw new HttpError(404,'This send is not confirmed yet.');return json(receipt);}
 const receive=p.match(/^\/api\/receive\/([\w:-]+)(?:\/uploads\/([\w-]+))?$/);
 if(receive){const byDevice=receive[1].startsWith('device:');const sender=await user(r,env,false);const intentId=receive[2]?parseUploadId(receive[2]):null;const fingerprint=intentId&&m==='POST'?uploadFingerprint(r):null;if(intentId&&m!=='POST')throw new HttpError(405,'Use POST to send file bytes.');if(intentId&&fingerprint){const targetId=byDevice?receive[1].slice(7):(await env.DB.prepare('SELECT device_id FROM receivers WHERE token_hash=?').bind(await hash(receive[1])).first<{device_id:string}>())?.device_id;if(targetId){const receipt=await replayUpload(env,sender.id,targetId,intentId,fingerprint);if(receipt)return json(receipt);}}let receiver=await env.DB.prepare(`SELECT r.*,d.name FROM receivers r JOIN devices d ON d.id=r.device_id JOIN users u ON u.id=d.owner_id WHERE ${byDevice?'r.device_id':'r.token_hash'}=? AND r.expires_at>? AND r.closed_at IS NULL AND d.revoked_at IS NULL AND d.last_seen>? AND u.status='active'`).bind(byDevice?receive[1].slice(7):await hash(receive[1]),now(),now()-45).first<{id:string;device_id:string;name:string;expires_at:number}>();if(!receiver&&byDevice&&sender.role==='admin'&&sender.status==='active'){const target=await env.DB.prepare("SELECT d.id,d.name FROM devices d JOIN users owner ON owner.id=d.owner_id WHERE d.id=? AND d.revoked_at IS NULL AND owner.status='active'").bind(receive[1].slice(7)).first<{id:string;name:string}>();if(target){receiver=await env.DB.prepare('SELECT id,device_id,expires_at FROM receivers WHERE device_id=? ORDER BY created_at DESC LIMIT 1').bind(target.id).first<{id:string;device_id:string;name:string;expires_at:number}>();if(!receiver){const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO receivers VALUES(?,?,?,?,?,?)').bind(id,target.id,await hash(token()),now(),now(),now()).run();receiver={id,device_id:target.id,name:target.name,expires_at:now()};}receiver.name=target.name;}}if(!receiver)throw new HttpError(410,'The computer is closed. Members can send when it resumes receiving.');if(m==='GET')return json({sendingAllowed:sender.role==='admin'||accountSetupWindow().accountCreationAllowed,name:receiver.name,expiresAt:receiver.expires_at,maxBytes:MAX_FILE,deviceId:receiver.device_id,uploadProtocol:UPLOAD_PROTOCOL,...await connectionState(env,sender,receiver)});if(m==='POST'){await requireFileSender(r,env);if(sender.role!=='admin'&&!accountSetupWindow().accountCreationAllowed)throw new HttpError(403,'Members can send during service and the two hours before and after.');await requireConnection(env,sender,receiver.id);
   const sessionHash=await hash(cookie(r,'stati_session')!);if(intentId&&fingerprint){const result=await storeIntentUpload(r,env,{senderId:sender.id,deviceId:receiver.device_id,receiverId:receiver.id,sessionHash,intentId,fingerprint,beforeCommit:async()=>{await requireFileSender(r,env);const current=await user(r,env,false);if(current.role!=='admin'&&!accountSetupWindow().accountCreationAllowed)throw new HttpError(403,'The service sending window has ended.');await requireConnection(env,current,receiver!.id);}});return json(result.receipt,result.created?201:200);}const len=Number(r.headers.get('content-length'));if(!Number.isSafeInteger(len)||len<=0||len>MAX_FILE||!r.body)throw new HttpError(413,'Choose a non-empty file up to 50 MB.');const checksum=expectedTransferChecksum(r.headers);const filename=safeFilename(decodeURIComponent(r.headers.get('x-filename')||'file'));const {contentType:type,stream}=await prepareUploadStream(r.body,filename,len);
   const id=crypto.randomUUID(),key='transfers/'+id;await storeTransfer(env.FILES,key,stream,len,type,checksum);
   try{await requireFileSender(r,env);const current=await user(r,env,false);if(current.role!=='admin'&&!accountSetupWindow().accountCreationAllowed)throw new HttpError(403,'The service sending window has ended.');await requireConnection(env,current,receiver.id);const result=await env.DB.batch([transferInsert(env,{id,key,senderId:sender.id,receiverId:receiver.id,sessionHash,filename,bytes:len,contentType:type}),env.DB.prepare('INSERT INTO delivery_records(id,device_id,sender_id,filename,bytes,status,rejection_reason,created_at,updated_at) SELECT id,device_id,sender_id,filename,bytes,status,NULL,created_at,created_at FROM transfers WHERE id=?').bind(id)]);if(!result[0].meta.changes)throw new HttpError(410,'The receiver closed or your access changed before the upload finished. Request access again.');return json({id,status:'queued',filename,...(checksum?{sha256:checksum}:{})},201);}catch(error){let committed;try{committed=await env.DB.prepare('SELECT id FROM transfers WHERE id=? AND object_key=? AND device_id=? AND sender_id=?').bind(id,key,receiver.device_id,sender.id).first();}catch{throw new HttpError(503,'The send result is not confirmed. Check Your files before retrying.');}if(committed)return json({id,status:'queued',filename,...(checksum?{sha256:checksum}:{})},201);await env.FILES.delete(key);throw error;}
 }}
 if(p==='/api/station/transfers/status'&&m==='POST'){const d=await device(r,env),data=await body(r,transferStatusInput);return json(await lookupTransferStatuses(env,d.id,data.ids));}
 const file=p.match(/^\/api\/station\/transfers\/([\w-]+)(\/delivered|\/reject)?$/);
 if(file){
  const d=await device(r,env),automaticDownload=m==='GET'&&r.headers.get('X-Stati-Delivery-Mode')==='automatic';
  const f=await env.DB.prepare(`SELECT * FROM transfers WHERE id=? AND device_id=? AND expires_at>?
   AND (?=0 OR EXISTS(SELECT 1 FROM users sender WHERE sender.id=transfers.sender_id AND sender.status='active' AND sender.role='admin'))`)
   .bind(file[1],d.id,now(),automaticDownload?1:0).first<{object_key:string;filename:string;content_type:string;bytes:number;status:string}>();
  if(!f)throw new HttpError(404,'Transfer unavailable.');
  if(m==='GET'&&!file[2]){if(f.status!=='queued')throw new HttpError(410,'Transfer is no longer queued.');const object=await env.FILES.get(f.object_key);if(!object)throw new HttpError(410,'The temporary file expired.');return transferResponse(object,f.filename,f.bytes);}
  if(m==='POST'&&file[2]){
   const status=file[2]==='/delivered'?'delivered':'rejected';
   const data=r.body?await body(r,z.object({reason:z.string().trim().max(500).optional(),automatic:z.boolean().optional()})):{reason:undefined,automatic:false};
   if(f.status!==status&&f.status!=='queued')throw new HttpError(409,'This file has already been decided.');
   const context=await operatorDeviceContext(r,d.id),automatic=status==='delivered'&&data.automatic===true;
   await env.DB.batch([
    env.DB.prepare(`UPDATE transfers SET status=?,delivered_at=?,rejection_reason=? WHERE id=? AND device_id=? AND status='queued'
     AND EXISTS(SELECT 1 FROM devices station JOIN users owner ON owner.id=station.owner_id WHERE station.id=transfers.device_id AND station.token_hash=? AND station.revoked_at IS NULL AND owner.status='active')
     AND (?=0 OR EXISTS(SELECT 1 FROM users sender WHERE sender.id=transfers.sender_id AND sender.status='active' AND sender.role='admin'))`)
     .bind(status,now(),status==='rejected'?data.reason||null:null,file[1],d.id,context.deviceTokenHash,automatic?1:0),
    env.DB.prepare('UPDATE delivery_records SET status=(SELECT status FROM transfers WHERE id=?),rejection_reason=(SELECT rejection_reason FROM transfers WHERE id=?),updated_at=? WHERE id=? AND device_id=? AND EXISTS(SELECT 1 FROM transfers WHERE id=? AND status=?)')
     .bind(file[1],file[1],now(),file[1],d.id,file[1],status)
   ]);
   const decided=await env.DB.prepare('SELECT status FROM transfers WHERE id=? AND device_id=?').bind(file[1],d.id).first<{status:string}>();
   if(decided?.status!==status)throw new HttpError(409,'The sender or connection changed. Refresh and let the computer operator review this file.');
   await env.FILES.delete(f.object_key);return json({ok:true});
  }
 }
 if(p==='/api/requests'&&m==='POST'){const authority=await requireMinistryCapability(r,env,'sendFiles'),u=authority.user,guard=ministryAuthorityGuard(authority,'sendFiles'),data=await body(r,z.object({deviceId:z.string().uuid(),message:z.string().trim().min(1).max(240)}));if(!await env.DB.prepare('SELECT id FROM devices WHERE id=? AND revoked_at IS NULL AND owner_id IS NOT NULL').bind(data.deviceId).first())throw new HttpError(404,'Computer unavailable.');const result=await env.DB.prepare('INSERT INTO requests SELECT ?,?,?,?,?,NULL WHERE '+guard.sql).bind(crypto.randomUUID(),data.deviceId,u.id,data.message,now(),...guard.params).run();if(!result.meta.changes)throw new HttpError(409,'Your access changed.');return json({ok:true},201);}
 const ack=p.match(/^\/api\/station\/requests\/([\w-]+)\/ack$/);
 if(ack&&m==='POST'){const d=await device(r,env);await env.DB.prepare('UPDATE requests SET acknowledged_at=? WHERE id=? AND device_id=?').bind(now(),ack[1],d.id).run();return json({ok:true});}
 if(p.startsWith('/api/'))throw new HttpError(404,'This endpoint does not exist.');
 return env.ASSETS.fetch(r);
}
const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
async function requireFileSender(request:Request,env:Env){
 const sender=await user(request,env,false);
 if(sender.role!=='admin'&&await readMinistryRole(env,sender.id)==='commenter')throw new HttpError(403,'Your role allows song comments only.');
 return sender;
}

export default {
 async fetch(r,env,ctx){let response:Response;try{const u=new URL(r.url);if(u.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(r.method)){const origin=r.headers.get('origin');if(origin&&origin!==env.APP_ORIGIN)throw new HttpError(403,'This request came from another site.');if(!origin&&!r.headers.get('authorization')&&!['/api/devices/pair'].includes(u.pathname))throw new HttpError(403,'A same-origin request is required.');}const path=u.pathname;const stationPath=path.startsWith('/api/station/')||path==='/api/devices/pair/status';const publicPath=['/api/access','/api/access/setup','/api/access/status','/api/health','/api/build-status','/api/auth/login/options','/api/auth/login/verify','/api/mobile/session','/api/devices/pair'].includes(path)||path.startsWith('/api/operator-unlock/');if(path.startsWith('/api/')&&!publicPath&&!stationPath&&!await allowed(r,env))throw new HttpError(403,'Enter the computer passcode first.');response=await routes(r,env,ctx);if(response.ok){const change=workspaceMutation(r.method,path);if(change)ctx.waitUntil(notifyWorkspaceChange(env,change));}}catch(e){if(e instanceof HttpError)response=json({error:e.message},e.status);else{console.error(JSON.stringify({event:'request_error',path:new URL(r.url).pathname.split('/').slice(0,3).join('/'),type:e instanceof Error?e.name:'unknown'}));response=json({error:'The request could not be completed. Please try again.'},500);}}const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Content-Security-Policy',CSP);headers.set('Permissions-Policy','camera=(self), microphone=(), geolocation=()');if(env.APP_ORIGIN.startsWith('https:'))headers.set('Strict-Transport-Security','max-age=31536000');if(new URL(r.url).pathname.startsWith('/api/')||new URL(r.url).pathname==='/app-version.json')headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers,...(response.webSocket?{webSocket:response.webSocket}:{})});},
 async scheduled(_event,env){const time=now();const transfers=await cleanupTransfers(env,time);const materials=await cleanupGroupMaterialUploads(env);const edits=await cleanupFileEdits(env,time);await cleanupTaskImageUploads(env);let failed=transfers.failed+materials.failed+edits.failed;const attempts=await cleanupUploadAttempts(env,time);failed+=attempts.failed;const photos=await cleanupProfilePhotos(env,time);failed+=photos.failed;await env.DB.batch([env.DB.prepare('UPDATE delivery_records SET status=\'expired\',updated_at=? WHERE status=\'queued\' AND created_at<?').bind(time,time-86400),env.DB.prepare('DELETE FROM delivery_records WHERE created_at<?').bind(time-604800),env.DB.prepare('DELETE FROM operator_unlocks WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM operator_sessions WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM enrollment_tickets WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM access_grants WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM challenges WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(time),env.DB.prepare('DELETE FROM devices WHERE owner_id IS NULL AND pair_expires<?').bind(time),env.DB.prepare('DELETE FROM requests WHERE created_at<?').bind(time-604800)]);if(failed){console.error(JSON.stringify({event:'transfer_cleanup_failed',failed,attempted:transfers.attempted,profilePhotosAttempted:photos.attempted,profilePhotosFailed:photos.failed}));throw new Error('Temporary transfer cleanup needs retry: '+failed);}}
} satisfies ExportedHandler<Env>;
