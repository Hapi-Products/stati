export type ServiceArrangement={name:string;slides:number[]};
export function validateServiceArrangement(value:unknown):ServiceArrangement|undefined;
export function applyServiceArrangement<T extends {section:string;text:string;ending?:string;endingFontSize?:number}>(slides:T[],arrangement?:ServiceArrangement):T[];
