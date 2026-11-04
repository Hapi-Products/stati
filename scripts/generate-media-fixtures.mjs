// Development-only synthetic media. Never uploads anything to Stați.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const temporary=await mkdtemp(path.join(tmpdir(),'stati-media-fixtures-')),ffmpeg=process.env.STATI_FFMPEG||'/opt/homebrew/bin/ffmpeg';
const video=[['mp4','video/mp4',['-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']],['m4v','video/mp4',['-c:v','libx264','-pix_fmt','yuv420p','-f','mp4','-brand','M4V ','-movflags','+faststart']],['mov','video/quicktime',['-c:v','libx264','-pix_fmt','yuv420p']],['webm','video/webm',['-c:v','libvpx-vp9']]];
const audio=[['mp3','audio/mpeg',['-c:a','libmp3lame']],['m4a','audio/mp4',['-c:a','aac']],['wav','audio/wav',['-c:a','pcm_s16le']],['ogg','audio/ogg',['-c:a','vorbis','-strict','-2']],['opus','audio/ogg',['-c:a','libopus']],['flac','audio/flac',['-c:a','flac']],['aac','audio/aac',['-c:a','aac','-f','adts']]];
const fixtures=[];
try{
 for(const [extension,mime,options] of [...video,...audio]){
  const isVideo=video.some(format=>format[0]===extension),file=path.join(temporary,'fixture.'+extension),args=['-hide_banner','-loglevel','error','-f','lavfi','-i',isVideo?'testsrc=size=128x96:rate=5':'sine=frequency=440:sample_rate=48000',...(!isVideo?['-ac','2']:[]),'-t','0.4',...options,file];
  execFileSync(ffmpeg,args);const bytes=await readFile(file);
  fixtures.push({extension,mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),completePlayableFile:true,ffmpegArguments:args.slice(4,-1)});
 }
 // The installed FFmpeg has no Theora encoder. Keep upstream's MIT-licensed
 // 256-byte signature fixture explicit: this is NOT a playback test or sample.
 const gitBlob='6c72c8fd749b79bd74509d0815034b0cc48f4875',blob=JSON.parse(execFileSync('gh',['api','repos/sindresorhus/file-type/git/blobs/'+gitBlob],{encoding:'utf8'})),bytes=Buffer.from(blob.content,'base64');
 if(bytes.length!==256)throw Error('Unexpected upstream OGV detection sample.');
 fixtures.push({extension:'ogv',mime:'video/ogg',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),completePlayableFile:false,origin:'file-type22.2.0 fixture/fixture.ogv; upstream truncated detection sample, not playback evidence',gitBlob});
 await writeFile('tests/fixtures/media-formats.json',JSON.stringify({description:'Eleven synthetic0.4-second test patterns/tones plus an upstream truncated OGV signature. No user files or production accounts.',generator:'ffmpeg',fixtures},null,2)+'\n');
 console.log(JSON.stringify(fixtures.map(({extension,mime,bytes,completePlayableFile})=>({extension,mime,bytes,completePlayableFile}))));
}finally{await rm(temporary,{recursive:true,force:true});}
