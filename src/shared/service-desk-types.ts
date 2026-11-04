export type DeskCheck={kind:'song'|'font'|'resource'|'playlist'|'manual';title:string;reference?:string;status:'passed'|'warning'|'failed';message:string};
export type DeskReport={versionId:string;contentHash:string;checks:DeskCheck[]};
export type DeskComputer={deviceId:string;name:string;serviceId:string|null;revision:number|null;approvedRevision:number|null;matches:boolean;stale:boolean;checkedAt:number|null;checks:DeskCheck[];ambiguous?:boolean};
export type ServiceDeskSnapshot={serviceId:string;approvedVersionId:string|null;approvedRevision:number|null;currentRevision:number;computers:DeskComputer[];canCheck:boolean};
export type OfflinePrepared={path:string;filename:string;bytes:number;sha256:string;createdAt:number;expiresAt:number};
export type ServiceDeskBridge={listServiceReadiness?:(id:string)=>Promise<ServiceDeskSnapshot>;checkServiceReadiness?:(id:string)=>Promise<ServiceDeskSnapshot>;prepareOfflineService?:(input:{id:string;versionId:string;passphrase:string;includeAudio:boolean})=>Promise<OfflinePrepared|{canceled:true}>;openOfflineDesk?:()=>Promise<unknown>;onIdentityRequired?:(callback:()=>void)=>(()=>void)};
