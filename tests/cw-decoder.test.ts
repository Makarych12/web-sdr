import test from 'node:test';import assert from 'node:assert/strict';import {CwDecoder} from '../src/cwDecoder';
const codes:Record<string,string>={V:'...-',C:'-.-.',Q:'--.-',D:'-..',E:'.',T:'-',S:'...',U:'..-',R:'.-.','4':'....-',M:'--',N:'-.'};
function signal(text:string,wpm:number,tone=700){const rate=12000,dot=1.2/wpm,values:number[]=[];let phase=0;function add(seconds:number,on=false){for(let i=0;i<Math.round(seconds*rate);i++){values.push(on?.5*Math.sin(phase):0);phase+=2*Math.PI*tone/rate;}}add(.5);for(const word of text.split(' ')){for(const char of word){for(const symbol of codes[char]){add(dot*(symbol==='.'?1:3),true);add(dot);}add(dot*2);}add(dot*4);}add(2);return Float32Array.from(values);}
function run(x:Float32Array,auto:boolean,wpm:number){const decoder=new CwDecoder({tone:700,auto,wpm});for(let i=0;i<x.length;i+=512)decoder.push(x.subarray(i,i+512),12000);return decoder.snapshot();}
test('sample-driven timing, manual 5/20/40 WPM, auto speed, pauses and noise rejection',()=>{
 for(const wpm of [5,20,40]){const result=run(signal('VVV CQ DE UR4MTN TEST',wpm),false,wpm);console.log({wpm,...result});assert.ok(result.text.includes('CQ DE UR4MTN TEST'),result.text);assert.equal(result.tonePresent,false);}
 for(const wpm of [5,20,40]){const automatic=run(signal('VVV VVV CQ DE UR4MTN TEST',wpm),true,20);console.log({autoWpm:wpm,...automatic});assert.ok(automatic.text.includes('CQ DE UR4MTN TEST'),automatic.text);assert.ok(Math.abs(automatic.wpm-wpm)<=2);}
 let seed=17;const noise=Float32Array.from({length:12000*8},()=>{seed=(1664525*seed+1013904223)>>>0;return(seed/2**32-.5)*.2;});const rejected=run(noise,true,20);assert.equal(rejected.text,'');assert.equal(run(new Float32Array(12000*8),true,20).text,'');
});
