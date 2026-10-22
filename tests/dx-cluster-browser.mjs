import { chromium } from '@playwright/test';import assert from 'node:assert/strict';import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { parseDxSpots,freshDx,dxBand,DX_URL } from '../src/dxCluster.ts';
const dir='artifacts/dx-cluster';mkdirSync(dir,{recursive:true});
const catalog=JSON.parse(readFileSync('.cache/catalog.json','utf8')).receivers;
const receiver=catalog.find(r=>r.minFrequency===0&&r.maxFrequency>=30000);
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});const report={};
async function setup(context){
 await context.route('**/api/receivers',route=>route.fulfill({json:catalog}));
 await context.addInitScript(id=>{localStorage.setItem('wave.receiver',JSON.stringify(id));localStorage.setItem('wave.frequencyHz','14080000');localStorage.setItem('wave.center','14080');localStorage.setItem('wave.mode',JSON.stringify('USB'));},receiver.id);
}
try{
 // Check 4: one real browser CORS request, actual spots, panel/markers/tuning/geometry.
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await setup(context);if(process.env.DX_REPLAY === "1")await context.route(DX_URL,route=>route.fulfill({json:JSON.parse(readFileSync(`${dir}/browser-live.json`,"utf8")),headers:{"Access-Control-Allow-Origin":"*"}}));const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0;page.on('request',r=>{if(r.url()===DX_URL)requests++;});
 await page.goto('http://127.0.0.1:5173/#listen');await page.locator('.dx-launch').scrollIntoViewIfNeeded();assert.equal(requests,0,'no cluster request before opt-in');
 const before=await page.locator('.frequency-scale').getAttribute('aria-valuenow');
 const responsePromise=page.waitForResponse(DX_URL);await page.locator('.dx-launch').click();const response=await responsePromise;assert.equal(response.status(),200);const live=await response.json();writeFileSync(`${dir}/browser-live.json`,JSON.stringify(live,null,2));
 const parsed=freshDx(parseDxSpots(live),Date.now());assert.ok(parsed.length>0);await page.waitForFunction(()=>document.querySelectorAll('.dx-list article').length>0);
 const dialog=page.getByRole('dialog',{name:'DX CLUSTER',exact:true});assert.equal(await dialog.locator('article').count(),parsed.length);
 await dialog.getByRole('checkbox').check();const currentBand=dxBand(14080);const expected=parsed.filter(s=>s.band===currentBand);assert.equal(await dialog.locator('article').count(),expected.length);
 await dialog.getByRole('checkbox').uncheck();const target=parsed.find(s=>s.band!==currentBand&&s.frequency<30000);assert.ok(target);
 await dialog.getByRole('button',{name:`${target.call} · ${target.frequency} kHz`,exact:true}).first().click();
 assert.equal(await page.locator('.frequency-scale').getAttribute('aria-valuenow'),String(Math.round(target.frequency*1000)));assert.equal(await page.getByRole('button',{name:'USB',exact:true}).getAttribute('class'),'selected');
 await page.waitForFunction(()=>document.querySelectorAll('.scope .dx-markers button').length>0);
 async function geometry(){return page.locator('.scope .dx-markers').evaluate(e=>{const view=e.closest('.visual');return {width:e.clientWidth,start:+view.dataset.start,span:+view.dataset.span,items:[...e.querySelectorAll('button')].map(b=>({frequency:+b.dataset.dxFrequency,x:+b.dataset.dxX}))};});}
 function checkGeometry(v){assert.ok(v.items.length>0);for(const s of v.items)assert.ok(Math.abs(s.x-(s.frequency-v.start)/v.span*v.width)<.01);}
 const geometryBefore=await geometry();checkGeometry(geometryBefore);
 const marker=page.locator('.scope .dx-markers button:enabled').first();const markerFrequency=+(await marker.getAttribute('data-dx-frequency'));await marker.scrollIntoViewIfNeeded();await marker.click();assert.equal(await page.locator('.frequency-scale').getAttribute('aria-valuenow'),String(Math.round(markerFrequency*1000)));
 await page.getByRole('button',{name:'Увеличить масштаб',exact:true}).click();const geometryAfter=await geometry();checkGeometry(geometryAfter);assert.equal(geometryAfter.span,geometryBefore.span/2);assert.ok(await page.locator('.fall .dx-markers button').count()>0);
 assert.equal(requests,1,'filter and zoom must not hammer API');await page.locator('.visual').screenshot({path:`${dir}/desktop.png`});assert.deepEqual(errors,[]);
 report.live={replayed:process.env.DX_REPLAY === "1",status:response.status(),cors:response.headers()['access-control-allow-origin'],spots:parsed.length,target,markerFrequency,geometryBefore,geometryAfter,requests,errors};
 await context.close();
 // Reuse that real response for mobile/layout and deterministic error/rate checks. No invented callsigns.
 const mobile=await browser.newContext({viewport:{width:390,height:1000}});await setup(mobile);await mobile.route(DX_URL,route=>route.fulfill({json:live}));const mp=await mobile.newPage();await mp.goto('http://127.0.0.1:5173/#listen');
 await mp.locator('.dx-launch').scrollIntoViewIfNeeded();await mp.evaluate(()=>document.fonts.ready);
 const positions=()=>mp.evaluate(()=>['.tuner','.frequency-scale','.fall','.vfo-dial','.eq-launch','.log-launch'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();const e=document.querySelector(s);return[s,e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight];}));
 const layout=await positions();await mp.locator('.dx-launch').evaluate(e=>e.style.display='none');assert.deepEqual(await positions(),layout);await mp.locator('.dx-launch').evaluate(e=>e.style.display='');await mp.locator('.dx-launch').click();await mp.waitForFunction(()=>document.querySelectorAll('.dx-list article').length>0);assert.ok(await mp.locator('.dx-panel').evaluate(e=>e.scrollWidth<=e.clientWidth));await mp.screenshot({path:`${dir}/mobile.png`});await mobile.close();
 // Check 5: real-response replay after HTTP 503/Retry-After; virtual clock never hits upstream.
 const failureContext=await browser.newContext({viewport:{width:1440,height:1000}});await setup(failureContext);let count=0,fail=true;
 await failureContext.route(DX_URL,route=>{count++;return route.fulfill(fail?{status:503,headers:{'Retry-After':'180','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Retry-After'},json:{detail:'Source temporarily unavailable'}}:{json:live,headers:{'Access-Control-Allow-Origin':'*'}});});
 const fp=await failureContext.newPage();const failureErrors=[];fp.on('pageerror',e=>failureErrors.push(e.message));await fp.clock.install({time:new Date()});await fp.goto('http://127.0.0.1:5173/#listen');await fp.locator('.dx-launch').click();await fp.getByRole('dialog',{name:'DX CLUSTER',exact:true}).getByRole('alert').waitFor();assert.equal(count,1);assert.ok((await fp.locator('.dx-panel [role=alert]').textContent()).includes('HTTP 503'));
 assert.equal(await fp.locator('.dx-markers button').count(),0);assert.equal(await fp.locator('.frequency-scale').getAttribute('aria-valuenow'),before);
 await fp.clock.fastForward(179000);assert.equal(count,1);fail=false;let next=fp.waitForResponse(DX_URL);await fp.clock.fastForward(2000);await next;await fp.waitForFunction(()=>document.querySelectorAll('.dx-list article').length>0);assert.equal(count,2);
 await fp.clock.fastForward(59000);assert.equal(count,2);next=fp.waitForResponse(DX_URL);await fp.clock.fastForward(2000);await next;assert.equal(count,3);
 await fp.evaluate(()=>{window.__dxHidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__dxHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await fp.clock.fastForward(180000);assert.equal(count,3);
 next=fp.waitForResponse(DX_URL);await fp.evaluate(()=>{window.__dxHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await fp.clock.fastForward(1);await next;assert.equal(count,4);assert.deepEqual(failureErrors,[]);
 report.failure={retryAfterSeconds:180,normalIntervalSeconds:60,noRequestsHidden:true,recovery:true,requestsSimulated:count,errors:failureErrors};
 await fp.screenshot({path:`${dir}/recovered.png`});await failureContext.close();writeFileSync(`${dir}/browser-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
