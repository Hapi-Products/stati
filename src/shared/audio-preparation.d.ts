export const AUDIO_CHECK_LIMITS:{files:number;fileBytes:number;batchBytes:number;seconds:number;sampleRate:number;chunkBytes:number;wavBytes:number};
export type AudioReport={duration:number;frames:number;sampleRate:number;channels:number;rmsDbfs:number|null;activeRmsDbfs:number|null;samplePeakDbfs:number|null;samplePeak:number;nearFullScaleSamples:number;leadingSilence:number;trailingSilence:number;channelRmsDbfs:(number|null)[];correlation:number|null;warnings:string[]};
export function analyzeAudio(channels:Float32Array[],sampleRate:number,options?:{checkActive?:()=>void;yieldWork?:()=>Promise<void>}):Promise<AudioReport>;
export function comparisonTarget(reports:AudioReport[]):number;
export function matchedGain(report:AudioReport,target?:number):number;
export function wavHeader(input:{frames:number;sampleRate:number;channels:number}):Uint8Array;
export function adjustedWavChunks(channels:Float32Array[],sampleRate:number,gainDb:number):Generator<{offset:number;bytes:ArrayBuffer}>;
