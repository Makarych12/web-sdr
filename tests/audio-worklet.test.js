import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function player(){
  let Processor;
  const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},sampleRate:48000,registerProcessor:(_,value)=>Processor=value};
  vm.runInNewContext(readFileSync(new URL('../public/audio-worklet.js',import.meta.url),'utf8'),context);
  return new Processor();
}
test('PCM jitter buffer survives a 140ms main-thread delivery delay without underrun',()=>{
  const p=player();let next=0,queued=[];const input=new Float32Array(512).fill(.25);
  for(let frame=0;frame<1800;frame++){
    const ms=frame*128/48000*1000;
    while(ms>=next){queued.push(input.slice());next+=512/12000*1000;}
    if(ms<1000||ms>1140){for(const samples of queued)p.port.onmessage({data:{samples,rate:12000}});queued=[];}
    p.process([],[[new Float32Array(128)]]);
  }
  assert.ok(p.playedFrames>180000);
  assert.equal(p.underflowFrames,0);
  assert.ok(p.buffered<12000*.75);
});
test('catching up from an audio burst retains queued live samples instead of restarting',()=>{
  const p=player();const input=new Float32Array(512).fill(.25);
  for(let i=0;i<24;i++)p.port.onmessage({data:{samples:input.slice(),rate:12000}});
  const output=new Float32Array(128);p.process([],[[output]]);
  assert.ok(output.every(v=>v===.25));assert.equal(p.underflowFrames,0);assert.ok(p.buffered<12000*.75);
  p.port.onmessage({data:{reset:true}});const stopped=new Float32Array(128);p.process([],[[stopped]]);assert.ok(stopped.every(v=>v===0));
});
