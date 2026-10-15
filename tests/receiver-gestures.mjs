import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});const page=await context.newPage();const checks=[];
try{
 await page.goto((process.env.TEST_APP_URL||'http://localhost:8787')+'/#listen');
 const field=page.locator('#frequency');await field.fill('7074.25');await field.press('Enter');
 await page.getByRole('button',{name:'USB',exact:true}).click();
 await page.locator('.visual').scrollIntoViewIfNeeded();const canvas=page.locator('.scope canvas');await canvas.scrollIntoViewIfNeeded();
 const b=await canvas.boundingBox();const y=b.y+b.height*.65;const x=f=>b.x+b.width*f;
 const cdp=await context.newCDPSession(page);
 const view=()=>page.locator('.visual').evaluate(e=>({start:+e.dataset.start,span:+e.dataset.span,zoom:+e.dataset.zoom}));
 async function touch(from,to){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x(from),y,id:1}]});if(to!==undefined)for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x(from+(to-from)*i/12),y,id:1}]});}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(80);}
 let v=await view();await touch(.2);assert.ok(Math.abs(+(await field.inputValue())-(v.start+v.span*.2))<.001);checks.push('touch tap tunes to RF coordinate');
 let f=await field.inputValue();v=await view();await touch(.8,.6);assert.equal(await field.inputValue(),f);assert.ok(Math.abs((await view()).start-v.start-v.span*.2)<.01);checks.push('background touch pans without tuning');
 await page.getByRole('button',{name:'К частоте',exact:true}).click();
 v=await view();f=await field.inputValue();await touch(.5,.55);assert.notEqual(await field.inputValue(),f);assert.equal((await view()).start,v.start);checks.push('VFO touch tunes without panning');
 v=await view();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x(.4),y,id:1},{x:x(.6),y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x(.25),y,id:1},{x:x(.75),y,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
 const after=await view();assert.equal(after.zoom,v.zoom+1);assert.ok(Math.abs(after.start+after.span/2-v.start-v.span/2)<.01);checks.push('two-finger pinch preserves midpoint RF anchor');
 await canvas.scrollIntoViewIfNeeded(); const wb=await canvas.boundingBox(); await page.mouse.move(wb.x+wb.width*.7,wb.y+wb.height*.65);v=await view();const anchor=v.start+v.span*.7;await page.mouse.wheel(0,-100);await page.waitForTimeout(100);const z=await view();assert.ok(Math.abs(z.start+z.span*.7-anchor)<v.span/wb.width);checks.push('wheel preserves cursor RF anchor');
} finally {await browser.close();writeFileSync('artifacts/receiver-gestures.json',JSON.stringify(checks,null,2));console.log(checks);}
