export type TaskStatus='new'|'in-progress'|'complete';
export type FeedbackTask={id:string;title:string;body:string;status:TaskStatus;urgent:boolean;revision:number;authorId:string;authorName:string;authorPhotoUrl?:string;createdAt:number;updatedAt:number;noteCount:number;canManage:boolean;canDelete:boolean};
export type TaskNote={id:string;authorId:string;authorName:string;authorPhotoUrl?:string;body:string;createdAt:number;canDelete:boolean};
export type TaskBoardSnapshot={items:FeedbackTask[];total:number;offset:number;counts:Record<TaskStatus,number>};
export type TaskImage={id:string;filename:string;bytes:number;sha256?:string;uploadFilename?:string;uploadBytes?:number;uploadSha256?:string;url:string;canRemove:boolean};
export type TaskDetail={task:FeedbackTask;notes:TaskNote[];noteTotal:number;images?:TaskImage[]};
export type DeletedTask={deleted:true;id:string;revision:number};
