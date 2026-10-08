import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('artifacts', {recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({hasTouch:true,viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[],logs=[],checks=[],samples=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{ if(m.text().includes('WebSDR lifecycle')) logs.push(m.text()); });
await page.addInitScript(()=>{
  window.__sockets=[];window.__closes=[];window.__raw=[];window.__contexts=[];window.__cls=0;window.__longTasks=[];
  const Socket=WebSocket;window.WebSocket=class extends Socket {
    constructor(...args){super(...args);window.__sockets.push(this);this.addEventListener('close',e=>window.__closes.push({at:Date.now(),url:this.url,code:e.code,reason:e.reason,clean:e.wasClean}));}
    send(value){if(typeof value==='string' && !value.includes('keepalive')){window.__raw.push(value);if(window.__raw.length>256)window.__raw.shift();}super.send(value);}
  };
  const Audio=AudioContext;window.AudioContext=class extends Audio {constructor(...args){super(...args);window.__contexts.push(this);}};
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(...args){
    if(this instanceof AudioWorkletNode){this.port.addEventListener('message',e=>{if(e.data.type==='playback')window.__playback=e.data;});this.port.start();}
    if(this instanceof GainNode && (args[0]===this.context.destination || args[0] instanceof MediaStreamAudioDestinationNode)){window.__analyser=this.context.createAnalyser();connect.call(this,window.__analyser);}
    return connect.apply(this,args);
  };
  new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__cls+=e.value;}).observe({type:'layout-shift',buffered:true});
  new PerformanceObserver(list=>{for(const e of list.getEntries())window.__longTasks.push(e.duration);}).observe({type:'longtask',buffered:true});
});
const receiver=()=>page.locator('#receiver').inputValue();
async function healthy(){await page.waitForFunction(()=>{
  const m=document.querySelector('footer')?.textContent.match(/(\d+) PCM · (\d+) WF/);
  if(!m || +m[1]<5 || +m[2]<3 || !document.querySelector('.header-right')?.textContent.includes('В эфире') || !window.__analyser)return false;
  const values=new Float32Array(window.__analyser.fftSize);window.__analyser.getFloatTimeDomainData(values);return values.some(v=>Math.abs(v)>1e-6);
},null,{timeout:90000});}
async function settled(){await page.waitForFunction(()=>!document.querySelector('.view-readout')?.textContent.includes('Ожидаем'),null,{timeout:15000});await page.waitForTimeout(120);}
async function view(){return page.locator('.visual').evaluate(el=>({start:+el.dataset.start,span:+el.dataset.span,zoom:+el.dataset.zoom}));}
async function range(label,value){await page.getByLabel(label,{exact:true}).evaluate((el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(v));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function touch(canvas,from,to){
  await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();const cdp=await context.newCDPSession(page);
  const pt=x=>({x:b.x+b.width*x,y:b.y+b.height*.5,id:1});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt(from)]});
  if(to!==undefined)for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pt(from+(to-from)*i/8)]});await page.waitForTimeout(25);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function snapshot(){return page.evaluate(()=>{
  const m=document.querySelector('footer')?.textContent.match(/(\d+) PCM · (\d+) WF/),a=window.__analyser,values=new Float32Array(a?.fftSize||1);a?.getFloatTimeDomainData(values);
  return {at:Date.now(),receiver:document.querySelector('#receiver').value,status:document.querySelector('.header-right').textContent,packets:m?[+m[1],+m[2]]:[0,0],rms:Math.sqrt(values.reduce((n,v)=>n+v*v,0)/values.length),sockets:window.__sockets.length,closes:window.__closes.slice(),audioContexts:window.__contexts.length,playback:window.__playback,historyRows:+document.querySelector('.fall canvas').dataset.rows,cls:window.__cls};
});}
try{
  const url=process.env.TEST_APP_URL||'https://web-sdr.vercel.app';await page.goto(url);
  await page.waitForFunction(()=>+document.querySelector('.receiver-choice')?.dataset.count>20);
  await page.getByRole('button',{name:'Приёмник',exact:true}).click();
  await page.waitForTimeout(250);
  const first=await page.locator('.catalog-dialog').boundingBox();
  assert.equal(await page.locator('.catalog-item').count(),60);
  await page.getByRole('button',{name:'Закрыть список серверов'}).click();
  await page.getByRole('button',{name:'Серверы',exact:true}).click();
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('.catalog-dialog').boundingBox(),first);
  await page.getByRole('textbox',{name:'Поиск приёмников'}).fill('Niendorf');
  await page.locator('.catalog-item').first().click();
  assert.equal(await receiver(),'niendorf');checks.push('identical shared receiver/server dialog and lazy catalog');
  await page.locator('.hero-cta').click();await healthy();await settled();
  let started=Date.now(); const initialReceiver=await receiver();
  const loadingCls=await page.evaluate(()=>window.__cls);
  await page.evaluate(()=>{window.__canvases=[...document.querySelectorAll('.scope canvas,.fall canvas')];});
  assert.equal(await page.evaluate(()=>window.__sockets.length),2);
  checks.push('real direct Kiwi WSS audio/spectrum/waterfall');
  await page.locator('#frequency').fill('7074');await page.getByRole('button',{name:'Настроить',exact:true}).click();await page.getByRole('button',{name:'USB',exact:true}).click();await settled();
  assert.equal(await page.locator('#frequency').inputValue(),'7074');
  const rows=await page.locator('.fall canvas').evaluate(el=>+el.dataset.rows);
  await range('Масштаб waterfall',7);await settled();const zoomed=await view();assert.equal(zoomed.zoom,7);
  assert.ok(Math.abs(zoomed.span-30000/128)<.01);
  await range('Центр waterfall',7090);await settled();assert.ok(Math.abs((await view()).start+(await view()).span/2-7090)<.01);
  assert.ok(await page.locator('.fall canvas').evaluate(el=>+el.dataset.rows)>=rows);
  assert.ok(await page.evaluate(()=>window.__canvases.every((el,i)=>el===document.querySelectorAll('.scope canvas,.fall canvas')[i])));
  assert.equal(await page.evaluate(()=>window.__sockets.length),2);checks.push('accurate zoom/pan sliders preserve history/canvases/stream');
  await page.setViewportSize({width:390,height:844});await settled();
  let before=await view();await touch(page.locator('.scope canvas'),.3,.65);
  assert.ok(Math.abs(+(await page.locator('#frequency').inputValue())-(before.start+before.span*.65))<.002);
  await settled();before=await view();await touch(page.locator('.fall canvas'),.4,.6);
  assert.ok(Math.abs(+(await page.locator('#frequency').inputValue())-(before.start+before.span*.6))<.002);
  await settled();checks.push('real touch drag tunes spectrum and waterfall accurately');
  await page.getByRole('button',{name:'↔ Панорама',exact:true}).click();before=await view();const tuned=await page.locator('#frequency').inputValue();
  await touch(page.locator('.fall canvas'),.4,.55);await settled();assert.equal(await page.locator('#frequency').inputValue(),tuned);assert.ok(Math.abs((await view()).start-before.start+before.span*.15)<.01);
  await page.getByRole('button',{name:'☝ Настройка',exact:true}).click();
  before=await view();await touch(page.locator('.frequency-scale'),.7);assert.ok(Math.abs(+(await page.locator('#frequency').inputValue())-(before.start+before.span*.7))<.002);await settled();
  const canvas=page.locator('.scope canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox(),cdp=await context.newCDPSession(page);
  const points=(a,z)=>[{x:b.x+b.width*a,y:b.y+b.height*.5,id:1},{x:b.x+b.width*z,y:b.y+b.height*.5,id:2}];
  before=await view();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(.35,.65)});
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(.35-.15*i/8,.65+.15*i/8)});await page.waitForTimeout(25);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await settled();assert.equal((await view()).zoom,before.zoom+1);checks.push('touch pan/pinch and visible frequency scale');
  await range('Масштаб waterfall',+(await page.getByLabel('Масштаб waterfall',{exact:true}).getAttribute('max')));await settled();const labels=await page.locator('.frequency-scale span').allTextContents();assert.equal(new Set(labels).size,5);assert.ok(labels.every(v=>v.includes('kHz')));
  await range('Масштаб waterfall',7);await settled();
  for(const [width,height] of [[360,800],[390,844],[430,932],[820,1180],[844,390]]){
    await page.setViewportSize({width,height});await page.locator('.landing-hero').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}x${height}`);
    const qsl=await page.locator('.qsl-preview').boundingBox(),hero=await page.locator('.landing-hero').boundingBox();assert.ok(qsl.x>=0 && qsl.x+qsl.width<=width+1 && qsl.y>=hero.y && qsl.y+qsl.height<=hero.y+hero.height+1);
    const targets=await page.locator('.modes button,.gesture-toolbar button,.view-sliders input').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.ok(targets.every(h=>h>=44));
    await page.screenshot({path:`artifacts/quality-${width}x${height}.png`,fullPage:true});
  }
  checks.push('360/390/430/tablet/landscape: QSL contained, no overflow, 44px SDR targets');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.visual').scrollIntoViewIfNeeded();
  const perf=await context.newCDPSession(page);await perf.send('Emulation.setCPUThrottlingRate',{rate:4});
  const fps=await page.evaluate(()=>new Promise(resolve=>{let n=0;const start=performance.now();function frame(){n++;if(performance.now()-start<5000)requestAnimationFrame(frame);else resolve(n*1000/(performance.now()-start));}requestAnimationFrame(frame);}));
  await perf.send('Emulation.setCPUThrottlingRate',{rate:1});await perf.detach();console.log('FPS with 4x CPU slowdown:',fps);
  const soakBaseline=await snapshot(); started=Date.now();
  checks.push(`Chromium mobile 4x CPU slowdown: ${fps.toFixed(1)} rAF FPS`);
  while(Date.now()-started<(+(process.env.TEST_SOAK_SECONDS||620))*1000){
    await page.waitForTimeout(15000);const sample=await snapshot();samples.push(sample);console.log('SOAK',Math.round((Date.now()-started)/1000),JSON.stringify(sample));
    assert.equal(sample.receiver,initialReceiver);assert.equal(sample.sockets,2);assert.equal(sample.closes.length,0);assert.equal(sample.audioContexts,1);assert.ok(sample.status.includes('В эфире'));assert.ok(sample.rms>1e-6);
    const prev=samples.at(-2);if(prev){assert.ok(sample.packets[0]>prev.packets[0]);assert.ok(sample.packets[1]>prev.packets[1]);}
  }
  const duration=(Date.now()-started)/1000;checks.push(`${duration.toFixed(1)} seconds without socket close, receiver switch or audio-context recreation`);
  const beforeReconnect=await snapshot();await page.evaluate(()=>window.__sockets.filter(s=>s.readyState===1).at(-1).close());
  await page.waitForFunction(()=>window.__sockets.length>=4,null,{timeout:20000});await healthy();await page.waitForTimeout(2500);
  assert.equal(await receiver(),initialReceiver);assert.equal(await page.evaluate(()=>window.__contexts.length),1);assert.ok(await page.evaluate(()=>window.__canvases.every((el,i)=>el===document.querySelectorAll('.scope canvas,.fall canvas')[i])));
  checks.push('forced reconnect restores current Kiwi/settings and preserves canvas/audio context');
  await page.getByRole('button',{name:'Отключиться',exact:false}).click();await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(()=>window.__sockets.filter(s=>s.readyState===1).length),0);
  assert.equal(await page.evaluate(()=>window.__contexts[0].state),'suspended');
  assert.equal(errors.length,0,errors.join('\n'));
  const end=await snapshot();const steadyCls = end.cls - soakBaseline.cls;
  assert.ok(loadingCls < .1, `loading CLS ${loadingCls}`);
  assert.ok(steadyCls < .1, `steady CLS ${steadyCls}`);
  writeFileSync('artifacts/quality-production-report.json',JSON.stringify({url,testedAt:new Date().toISOString(),checks,duration,fps,loadingCls,steadyCls,soakBaseline,initialReceiver,final:end,samples,logs,errors,beforeReconnect},null,2));
  console.log('PASS QUALITY PRODUCTION',checks);
}catch(error){console.error('FAIL STATE',await snapshot().catch(()=>null));await page.screenshot({path:'artifacts/quality-failure.png',fullPage:true});writeFileSync('artifacts/quality-failure.json',JSON.stringify({checks,samples,logs,errors,error:String(error)},null,2));throw error;}
finally{await browser.close();}
