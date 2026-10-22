import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
const dir='artifacts/audio-eq';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const report={};
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/');
 await page.exposeFunction('saveEqRender',(name,encoded)=>{assert.ok(['original','flat','voice','dx','music'].includes(name));writeFileSync(`${dir}/${name}.f32`,Buffer.from(encoded,'base64'));});
 await page.route('**/__eq_input',route=>route.fulfill({body:readFileSync('artifacts/dsp/ssb-input.f32'),contentType:'application/octet-stream'}));
 const results=await page.evaluate(async()=>{
  const {AudioEq,EQ_PRESETS,eqHeadroom}=await import('/src/audioEq.ts');const sr=48000;
  const rms=(x,start=0)=>Math.sqrt(x.slice(start).reduce((s,v)=>s+v*v,0)/(x.length-start));
  async function render(x,settings,transition=false){
   const ctx=new OfflineAudioContext(1,x.length,sr),source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,x.length,sr);source.buffer.copyToChannel(x,0);
   const eq=new AudioEq(ctx,settings);source.connect(eq.input);eq.output.connect(ctx.destination);source.start();
   if(transition){const paused=ctx.suspend(.25);const completed=ctx.startRendering();await paused;eq.update(transition === "off" ? {...settings,enabled:false} : {...settings,enabled:true,bass:12,mid:12,treble:12});await ctx.resume();return (await completed).getChannelData(0);}
   return (await ctx.startRendering()).getChannelData(0);
  }
  // Check 2: actual rendered tones and sample-exact OFF / FLAT.
  const frequency=[];
  for(const band of ['bass','mid','treble'])for(const value of [-12,12]){
   const settings={enabled:true,bass:0,mid:0,treble:0,[band]:value},row={band,value,headroomDb:20*Math.log10(eqHeadroom(settings)),tones:[]};
   const referenceContext=new OfflineAudioContext(1,1,sr),referenceEq=new AudioEq(referenceContext,settings);
   const frequencies=new Float32Array([80,1250,6000]),response=new Float32Array(3).fill(eqHeadroom(settings)),phase=new Float32Array(3),magnitude=new Float32Array(3);
   for(const filter of [referenceEq.bass,referenceEq.mid,referenceEq.treble]){filter.getFrequencyResponse(frequencies,magnitude,phase);for(let i=0;i<3;i++)response[i]*=magnitude[i];}
   for(const hz of [80,1250,6000]){
    const x=Float32Array.from({length:sr/2},(_,i)=>.1*Math.sin(2*Math.PI*hz*i/sr));const y=await render(x,settings);
    row.tones.push({hz,referenceDb:20*Math.log10(response[[80,1250,6000].indexOf(hz)]),actualDb:20*Math.log10(rms(y,sr/4)/rms(x,sr/4)),shapeDb:20*Math.log10(rms(y,sr/4)/rms(x,sr/4)/eqHeadroom(settings))});
   }frequency.push(row);
  }
  let seed=73;const bounded=Float32Array.from({length:sr},()=>{seed=(seed*1664525+1013904223)>>>0;return (seed/2**32-.5)*1.98;});
  const off=await render(bounded,{enabled:false,bass:12,mid:-12,treble:12});const flat=await render(bounded,{enabled:true,bass:0,mid:0,treble:0});
  const difference=(a,b)=>a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
  // Check 3: full-scale waveform stresses and a live-scheduled ON transition.
  const clipping=[];
  const signals={noise:bounded,steps:Float32Array.from({length:sr},(_,i)=>(i%4800<2400?.99:-.99)),tone:Float32Array.from({length:sr},(_,i)=>.99*Math.sin(2*Math.PI*1250*i/sr))};
  for(const [name,x]of Object.entries(signals))for(const bands of [{bass:12,mid:12,treble:12},{bass:-12,mid:12,treble:-12},{bass:12,mid:-12,treble:12}]){
   const y=await render(x,{enabled:true,...bands});clipping.push({name,bands,peak:y.reduce((m,v)=>Math.max(m,Math.abs(v)),0),finite:y.every(Number.isFinite)});
  }
  const transitioned=await render(signals.tone,{enabled:false,bass:0,mid:0,treble:0},true);
  const runtimeOff=await render(bounded,{enabled:true,bass:12,mid:-12,treble:12},"off");
  const runtimeOffMaxError=difference(bounded.slice(sr/2),runtimeOff.slice(sr/2));
  // Check 4: real 105.74-second LSB, EQ alone, same input for every preset.
  const raw=await(await fetch('/__eq_input')).arrayBuffer(),speech=new Float32Array(raw),lsb=[];
  async function save(name,x){const bytes=new Uint8Array(x.buffer,x.byteOffset,x.byteLength);let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));await window.saveEqRender(name,btoa(str));}
  await save('original',speech);
  for(const [preset,bands]of Object.entries(EQ_PRESETS)){
   const y=await render(speech,{enabled:true,...bands});await save(preset.toLowerCase(),y);
   lsb.push({preset,peak:y.reduce((m,v)=>Math.max(m,Math.abs(v)),0),rms:rms(y),finite:y.every(Number.isFinite)});
  }
  return {frequency,runtimeOffMaxError,offMaxError:difference(bounded,off),flatMaxError:difference(bounded,flat),clipping,transitionPeak:transitioned.reduce((m,v)=>Math.max(m,Math.abs(v)),0),lsb};
 });
 assert.equal(results.runtimeOffMaxError,0);assert.equal(results.offMaxError,0);assert.equal(results.flatMaxError,0);
 for(const row of results.frequency){const target=row.band==='bass'?0:row.band==='mid'?1:2;assert.ok(Math.abs(row.tones[target].shapeDb)>8);for(const tone of row.tones)assert.ok(Math.abs(tone.actualDb-tone.referenceDb)<.03);}
 assert.ok(results.clipping.every(v=>v.finite&&v.peak<1));assert.ok(results.transitionPeak<1);assert.ok(results.lsb.every(v=>v.finite&&v.peak<1));report.dsp=results;
 await page.close();
 // Check 5: UI persistence, presets and unchanged layout at desktop/mobile sizes.
 report.ui=[];
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:5173/#listen');
  const launch=p.locator('.eq-launch');await launch.scrollIntoViewIfNeeded();
  const positions=()=>p.evaluate(()=>['.tuner','.steps','.mode','.frequency-scale','.vfo-dial','.fall','.log-launch','.nr-widget','.notch-widget'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,r.x,r.y,r.width,r.height];}));
  const before=await positions();await launch.evaluate(e=>e.style.display='none');assert.deepEqual(await positions(),before);await launch.evaluate(e=>e.style.display='');
  await launch.click();const dialog=p.getByRole('dialog',{name:'AUDIO EQ',exact:true});await dialog.getByRole('button',{name:'EQ OFF',exact:true}).click();await dialog.getByRole('button',{name:'DX',exact:true}).click();
  const settings=await p.evaluate(()=>JSON.parse(localStorage.getItem('ur4mtn.audio-eq.v1')));assert.deepEqual(settings,{enabled:true,bass:-12,mid:5,treble:-6});
  await p.getByLabel('EQ TREBLE',{exact:true}).focus();await p.keyboard.press('End');assert.equal(await p.getByLabel('EQ TREBLE',{exact:true}).inputValue(),'12');
  await p.getByLabel('Закрыть AUDIO EQ',{exact:true}).click();await p.reload();assert.equal(await launch.getAttribute('aria-pressed'),'true');await launch.click();assert.equal(await p.getByLabel('EQ BASS',{exact:true}).inputValue(),'-12');assert.equal(await p.getByLabel('EQ TREBLE',{exact:true}).inputValue(),'12');
  await dialog.getByRole('button',{name:'FLAT',exact:true}).click();for(const band of ['BASS','MID','TREBLE'])assert.equal(await p.getByLabel(`EQ ${band}`,{exact:true}).inputValue(),'0');
  await dialog.getByRole('button',{name:'EQ ON',exact:true}).click();await p.screenshot({path:`${dir}/${width}.png`});assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));assert.deepEqual(errors,[]);
  report.ui.push({width,persistence:true,presets:true,off:true,layoutPreserved:true,errors});await context.close();
 }
 writeFileSync(`${dir}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
