import type {Slide} from './slides';
export type OutputProfile='church'|'stream-lyrics'|'stream-translation';
export type OutputCue=Slide&{key:string;churchIndex:number};
export const OUTPUT_LAYOUT_BOUNDS:Readonly<Record<OutputProfile,Readonly<{x:number;y:number;width:number;height:number}>>>;
export function outputTextFontSize(text:string,requested?:number,profile?:OutputProfile):number;
export function buildOutputLayouts(source:Slide[],options?:{fontSize?:number;translations?:Record<string,string>}):{church:Slide[];stream:OutputCue[];translation:OutputCue[];missingTranslations:number};
export function outputLayoutIssues(slides:Slide[],profile:OutputProfile,fontSize?:number):string[];
