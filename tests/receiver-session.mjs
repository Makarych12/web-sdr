import { chromium } from '@playwright/test';
import {writeFileSync, mkdirSync} from 'node:fs';
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const report={url:process.env.TEST_APP_URL||'http://localhost:5173',started:new Date().toISOString(),samples:[],errors:[]};
page.on('pageerror', e=>report.errors.push(e.message));
await page.addInitScript(()=>{
 window.probe={sockets:[],commands:[],playback:null,contexts:0};
 const W=WebSocket; window.WebSocket=class extends W {constructor(...args){super(...args);window.probe.sockets.push(this);} send(v){if(typeof v==='string' && !v.includes('keepalive'))window.probe.commands.push(v);super.send(v);}};
 const A=AudioContext;window.AudioContext=class extends A {constructor(...args){super(...args);window.probe.contexts++;}};
 const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(...args){if(this instanceof AudioWorkletNode){this.port.addEventListener('message',e=>{window.probe.playback=e.data;});this.port.start();}return connect.apply(this,args);};
});
mkdirSync('artifacts',{recursive:true});
const save=()=>writeFileSync(process.env.TEST_REPORT||'artifacts/receiver-session.json',JSON.stringify(report,null,2));
try {
 await page.goto(report.url+'/?debug#listen');
 await page.waitForFunction(()=>+document.querySelector('.receiver-choice')?.dataset.count>0);
 await page.locator('#frequency').fill('7.074250 MHz');await page.locator('#frequency').press('Enter');
 await page.getByRole('button',{name:'USB',exact:true}).click();
 await page.getByRole('button',{name:'▶ Слушать эфир',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.header-right')?.textContent.includes('В эфире'),null,{timeout:90000});
 report.liveAt=new Date().toISOString();
 const seconds=Number(process.env.TEST_SECONDS||900);
 for(let elapsed=0;elapsed<=seconds;elapsed+=10){
  const sample=await page.evaluate(()=>({at:Date.now(),status:document.querySelector('.header-right').textContent,receiver:document.querySelector('#receiver').value,playback:window.probe.playback,contexts:window.probe.contexts,openSockets:window.probe.sockets.filter(s=>s.readyState===1).map(s=>s.url),rows:document.querySelector('.fall canvas').dataset.rows}));
  report.samples.push(sample); save(); console.log(JSON.stringify(sample));
  if(elapsed<seconds) await page.waitForTimeout(10000);
 }
 await page.evaluate(()=>window.probe.sockets.find(s=>s.readyState===1)?.close());
 await page.waitForTimeout(8000);
 report.reconnect=await page.evaluate(()=>({status:document.querySelector('.header-right').textContent,contexts:window.probe.contexts,openSockets:window.probe.sockets.filter(s=>s.readyState===1).length,commands:window.probe.commands.slice(-12)}));
 for(const [width,height] of [[360,800],[390,844],[844,390]]){await page.setViewportSize({width,height});await page.locator('.visual').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/receiver-${width}x${height}.png`});report[`mobile${width}`]=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));}
} catch(e){report.errors.push(String(e));console.error(e);process.exitCode=1;} finally {report.finished=new Date().toISOString();save();await browser.close();}
