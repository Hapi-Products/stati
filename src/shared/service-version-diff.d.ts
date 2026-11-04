import type {ServicePlan,ServiceVersionSnapshot,ServiceVersionLyrics} from '../desktop/service-plan-types';
export function serviceVersionChanges(approved:ServiceVersionSnapshot|null,draft:ServicePlan,currentLyrics?:ServiceVersionLyrics[]):{added:string[];removed:string[];files:string[];arrangements:string[];words:string[];order:boolean;notes:boolean;details:boolean};
export function changedWordRange(before:string,after:string):{approved:{before:string;changed:string;after:string};current:{before:string;changed:string;after:string}};
