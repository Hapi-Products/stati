export type ChordSuggestion={line:number;original:string;replacement:string;kind:'inline'|'line';count:number};
export function chordRemovalSuggestions(text:string):ChordSuggestion[];
export function applyChordRemoval(text:string,suggestions:ChordSuggestion[],selected:number[]):string;
