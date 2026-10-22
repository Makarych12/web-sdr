import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir='artifacts/band-plan';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const report=[];
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('wave.frequencyHz','7070000');localStorage.setItem('wave.center','7070');
   localStorage.setItem('wave.mode',JSON.stringify('LSB'));localStorage.setItem('wave.zoom','6');
  });
  await page.goto('http://127.0.0.1:5173/#listen');
  const scale=page.locator('.frequency-scale');await scale.scrollIntoViewIfNeeded();
  await page.waitForSelector('.band-plan-segment');
  const height=await scale.evaluate(e=>e.getBoundingClientRect().height);
  const baseline=await page.locator('.band-plan').evaluate(e=>{e.style.display='none';const h=e.parentElement.getBoundingClientRect().height;e.style.display='';return h;});
  assert.equal(height,baseline,'overlay must not resize scale');
  const colors=await page.locator('.band-plan-segment').evaluateAll(es=>es.map(e=>({usage:e.dataset.usage,color:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()})));
  assert.ok(new Set(colors.map(c=>c.color)).size>=3);
  const cases=[];
  for(const [frequency,usage] of [[7025,'CW'],[7045,'DATA'],[7100,'SSB']]) {
   const view=await page.locator('.visual').evaluate(e=>({start:+e.dataset.start,span:+e.dataset.span}));
   const rect=await scale.boundingBox();const x=rect.x+(frequency-view.start)/view.span*rect.width;
   const y=rect.y+rect.height-5;
   const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-usage]')?.getAttribute('data-usage'),{x,y});
   assert.equal(hit,usage);
   if(width===390)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
   const actual=+(await scale.getAttribute('aria-valuenow'));
   console.log({width,usage,view,rect,actual});
   assert.ok(Math.abs(actual-frequency*1000)<20,`click ${usage}: ${actual}`);
   assert.equal(await page.getByRole('button',{name:'LSB',exact:true}).getAttribute('class'),'selected','click preserves current mode');
   cases.push({usage,targetHz:frequency*1000,actualHz:actual});
  }
  await scale.focus();const before=+(await scale.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowRight');
  assert.ok(+(await scale.getAttribute('aria-valuenow'))>before,'existing scale keyboard tuning');
  await page.getByRole('button',{name:'Увеличить масштаб',exact:true}).click();
  const segments=await page.locator('.band-plan-segment').evaluateAll(es=>es.map(e=>({left:parseFloat(e.style.left),width:parseFloat(e.style.width)})));
  assert.ok(segments.every(s=>s.left>=0&&s.width>0&&s.left+s.width<=100.000001));
  await scale.scrollIntoViewIfNeeded();await page.locator('.visual').screenshot({path:`${dir}/${width}.png`});
  assert.deepEqual(errors,[]);
  report.push({width,height,cases,segments,errors});await context.close();
 }
 writeFileSync(`${dir}/browser-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
