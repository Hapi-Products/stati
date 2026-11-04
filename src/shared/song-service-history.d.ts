import type {ServicePlan} from '../desktop/service-plan-types';
export type SongServiceHistoryEntry={id:string;title:string;date:string;time:string;archived:boolean;positions:number[];version:'matching'|'different'};
export function songServiceHistory(plans:ServicePlan[],songId:string,contentHash:string):SongServiceHistoryEntry[];
