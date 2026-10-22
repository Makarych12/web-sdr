import {chromium} from '@playwright/test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const dir='artifacts/cw-decoder';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});const report=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__cw_real',r=>r.fulfill({body:readFileSync(`${dir}/cw-real.f32`),contentType:'application/octet-stream'}));
 await page.goto('http://127.0.0.1:5173/#listen');await page.locator('.cw-dec-launch').scrollIntoViewIfNeeded();
 const geometry=()=>page.evaluate(()=>['.tuner','.frequency-scale','.fall','.vfo-dial','.dx-launch','.eq-launch','.log-launch'].map(s=>{const e=document.querySelector(s);return[s,e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight];}));
 const before=await geometry();await page.locator('.cw-dec-launch').evaluate(e=>e.style.display='none');assert.deepEqual(await geometry(),before);await page.locator('.cw-dec-launch').evaluate(e=>e.style.display='');
 // Render the real panel with an isolated PCM reference, avoiding an artificial SDR connection.
 await page.evaluate(async()=>{
  const React=await import('/node_modules/.vite/deps/react.js');const ReactDom=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=ReactDom.createRoot??ReactDom.default.createRoot;const {CwDecoderPanel}=await import('/src/CwDecoderPanel.tsx');
  window.cwTestRef={current:null};const root=document.createElement('div');root.id='cw-test-root';document.body.append(root);createRoot(root).render((React.createElement??React.default.createElement)(CwDecoderPanel,{input:window.cwTestRef}));
 });
 const launch=page.locator('#cw-test-root .cw-dec-launch');await launch.click();const dialog=page.getByRole('dialog',{name:'CW DECODER',exact:true});
 assert.equal(await page.evaluate(()=>window.cwTestRef.current),null);await dialog.getByRole('button',{name:'COPY',exact:true}).isDisabled().then(v=>assert.equal(v,true));
 await dialog.getByRole('checkbox',{name:'AUTO TONE',exact:true}).uncheck();
 const tone=dialog.getByLabel('Тон CW',{exact:true});await tone.focus();await tone.press('Home');for(let i=0;i<22;i++)await tone.press('ArrowRight');assert.equal(await tone.inputValue(),'410');
 await dialog.getByRole('button',{name:'CW DEC OFF',exact:true}).click();assert.equal(await page.evaluate(()=>!!window.cwTestRef.current),true);
 const expected=await page.evaluate(async()=>{const pcm=new Float32Array(await(await fetch('/__cw_real')).arrayBuffer());window.cwTestPcm=pcm;const d=window.cwTestRef.current;for(let i=0;i<pcm.length;i+=512)d.push(pcm.subarray(i,i+512),12000);d.push(new Float32Array(36000),12000);return d.snapshot().text;});
 assert.ok(expected.includes('WB3DOM'));await page.waitForFunction(text=>document.querySelector('#cw-test-root textarea').value===text,expected);
 await dialog.getByRole('button',{name:'COPY',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);
 await dialog.getByRole('button',{name:'CW DEC ON',exact:true}).click();assert.equal(await page.evaluate(()=>window.cwTestRef.current),null);
 const textBefore=await dialog.getByLabel('Декодированный CW текст',{exact:true}).inputValue();await page.evaluate(()=>{for(let i=0;i<100;i++)window.cwTestRef.current?.push(window.cwTestPcm.subarray(0,512),12000);});assert.equal(await dialog.getByLabel('Декодированный CW текст',{exact:true}).inputValue(),textBefore);
 await dialog.getByRole('checkbox',{name:'AUTO WPM',exact:true}).uncheck();await dialog.getByLabel('Скорость CW WPM',{exact:true}).fill('5');await dialog.getByRole('button',{name:'CW DEC OFF',exact:true}).click();assert.equal(await page.evaluate(()=>window.cwTestRef.current.snapshot().wpm),5);
 await dialog.getByLabel('Закрыть CW DEC',{exact:true}).click();assert.equal(await page.evaluate(()=>window.cwTestRef.current),null);
 await launch.click();assert.equal(await dialog.getByLabel('Декодированный CW текст',{exact:true}).inputValue(),textBefore);
 assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));await page.screenshot({path:`${dir}/${width}.png`});assert.deepEqual(errors,[]);
 report.push({width,layoutPreserved:true,pcmDerivedText:true,copiedExact:true,offConsumerNull:true,closeStops:true,tone:410,manualWpm:5,errors});await context.close();
}writeFileSync(`${dir}/browser-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}finally{await browser.close();}
