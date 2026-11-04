export type WorshipGroupMember={id:string;name:string;photoUrl:string|null;ministryRole:string|null};
export type WorshipGroup={id:string;name:string;ownerId:string;revision:number;memberCount:number;canManage:boolean;createdAt:number;updatedAt:number};
export type WorshipGroupDetail=WorshipGroup&{members:WorshipGroupMember[]};
export type WorshipGroupList={groups:WorshipGroup[];nextCursor:string|null;canCreate:boolean};
