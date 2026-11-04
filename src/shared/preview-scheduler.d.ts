export function createPreviewQueue(options?:{concurrency?:number;maxWaiting?:number}):{run<T>(key:string,task:()=>T|Promise<T>):Promise<T>;clear:()=>void};
