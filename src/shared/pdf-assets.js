/** Resolve from the executing module, since the inbox page itself uses file:.
 * Both entry modules and shared chunks must use the same local asset root. */
export function pdfAssetOptions(moduleUrl){
 const base=new URL(moduleUrl);base.pathname='/pdf/';base.search='';base.hash='';
 const directory=name=>new URL(name+'/',base).href;
 return{cMapUrl:directory('cmaps'),cMapPacked:true,standardFontDataUrl:directory('standard_fonts'),wasmUrl:directory('wasm'),iccUrl:directory('iccs'),useWorkerFetch:true};
}
