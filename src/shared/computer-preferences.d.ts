export type ComputerPreferences={favorites:string[];recent:Record<string,number>};
export function normalizeComputerPreferences(value:unknown):ComputerPreferences;
export function loadComputerPreferences(storage:Pick<Storage,'getItem'>,userId:string):ComputerPreferences;
export function saveComputerPreferences(storage:Pick<Storage,'setItem'>,userId:string,value:ComputerPreferences):boolean;
export function rankComputers<T extends {id:string;name:string}>(computers:T[],preferences:ComputerPreferences):T[];
