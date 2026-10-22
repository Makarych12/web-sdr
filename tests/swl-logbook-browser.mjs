import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
const dir='artifacts/swl-logbook';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
const results=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'Europe/Sofia',acceptDownloads:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(localStorage.getItem('wave.frequencyHz')===null){localStorage.setItem('wave.frequencyHz','7143149');localStorage.setItem('wave.center','7143.149');localStorage.setItem('wave.mode',JSON.stringify('LSB'));}
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(k==='ur4mtn.swl-log.v1'&&window.__failLog)throw new DOMException('test quota','QuotaExceededError');return original.call(this,k,v);};
 });
 await page.clock.setFixedTime(new Date('2026-10-22T23:59:58.000Z'));
 await page.goto('http://127.0.0.1:5173/#listen');
 const log=page.locator('.log-launch');await log.scrollIntoViewIfNeeded();
 const layout=()=>page.evaluate(()=>['.tuner','.steps','.mode','.frequency-scale','.nr-widget','.notch-widget'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,w:r.width,h:r.height};}));
 const visibleLayout=await layout();await log.evaluate(e=>e.style.display='none');assert.deepEqual(await layout(),visibleLayout);await log.evaluate(e=>e.style.display='');
 await log.click();const dialog=page.getByRole('dialog',{name:'DX LOGBOOK · SWL'});
 assert.equal(await dialog.locator('article').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('ur4mtn.swl-log.v1')),null,'opening is not automatic logging');
 await page.getByLabel('Позывной SWL',{exact:true}).fill('ur4mtn/p');await page.getByLabel('RST наблюдения',{exact:true}).fill('59');
 const comment='Тихо, "слышно" & <тест>\nокончание фразы';await page.getByLabel('Комментарий SWL',{exact:true}).fill(comment);
 await page.getByRole('button',{name:'ADD',exact:true}).click();
 let entries=await page.evaluate(()=>JSON.parse(localStorage.getItem('ur4mtn.swl-log.v1')));
 assert.equal(entries.length,1);assert.equal(entries[0].frequencyHz,7143149);assert.equal(entries[0].mode,'LSB');assert.equal(entries[0].utc,'2026-10-22T23:59:58.000Z');assert.equal(entries[0].call,'UR4MTN/P');
 const id=entries[0].id;
 await page.reload();await log.click();assert.equal(await dialog.locator('article').count(),1);
 await page.getByLabel('Поиск SWL по позывному',{exact:true}).fill('unmatched');assert.equal(await dialog.locator('article').count(),0);
 await page.getByLabel('Поиск SWL по позывному',{exact:true}).fill('ur4mtn');assert.equal(await dialog.locator('article').count(),1);
 await page.getByRole('button',{name:'Редактировать UR4MTN/P',exact:true}).click();
 await page.getByLabel('Позывной SWL',{exact:true}).fill('UR4MTN');await page.getByLabel('RST наблюдения',{exact:true}).fill('57');
 await page.getByLabel('Частота записи kHz',{exact:true}).fill('14074.125');await page.getByLabel('Режим записи',{exact:true}).selectOption('USB');
 await page.getByLabel('Дата и время записи UTC',{exact:true}).fill('2026-10-21T00:00:01');
 await page.getByRole('button',{name:'Сохранить запись',exact:true}).click();
 entries=await page.evaluate(()=>JSON.parse(localStorage.getItem('ur4mtn.swl-log.v1')));
 assert.equal(entries.length,1);assert.equal(entries[0].id,id);assert.equal(entries[0].frequencyHz,14074125);assert.equal(entries[0].mode,'USB');assert.equal(entries[0].utc,'2026-10-21T00:00:01.000Z');assert.equal(entries[0].rst,'57');
 for(const [button,ext] of [['Экспорт ADIF 3 (.adx)','adx'],['Экспорт CSV','csv']]){
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();const download=await wait;
  await download.saveAs(`${dir}/${width}.${ext}`);
 }
 const adx=readFileSync(`${dir}/${width}.adx`,'utf8');
 const parsed=await page.evaluate(xml=>{const d=new DOMParser().parseFromString(xml,'application/xml');return {errors:d.querySelectorAll('parsererror').length,records:d.querySelectorAll('RECORD').length,call:d.querySelector('CALL')?.textContent,swl:d.querySelector('SWL')?.textContent,mode:d.querySelector('MODE')?.textContent,sub:d.querySelector('SUBMODE')?.textContent,comment:d.querySelector('COMMENT_INTL')?.textContent};},adx);
 assert.equal(parsed.errors,0);assert.equal(parsed.records,1);assert.equal(parsed.call,'UR4MTN');assert.equal(parsed.swl,'Y');assert.equal(parsed.mode,'SSB');assert.equal(parsed.sub,'USB');assert.ok(parsed.comment.includes(comment));
 await page.getByRole('button',{name:'Настроить 14074.125 kHz USB',exact:true}).click();assert.equal(await dialog.isVisible(),false);
 assert.equal(await page.locator('.frequency-scale').getAttribute('aria-valuenow'),'14074125');assert.equal(await page.getByRole('button',{name:'USB',exact:true}).getAttribute('class'),'selected');
 await log.click();await page.evaluate(()=>window.__failLog=true);await page.getByLabel('Позывной SWL',{exact:true}).fill('UT0TEST');await page.getByRole('button',{name:'ADD',exact:true}).click();
 assert.equal(await dialog.locator('article').count(),1);assert.ok((await dialog.getByRole('alert').textContent()).includes('не сохранено'));
 await page.evaluate(()=>window.__failLog=false);
 await page.screenshot({path:`${dir}/${width}.png`});
 assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),'no horizontal dialog overflow');
 await page.getByRole('button',{name:'Удалить UR4MTN',exact:true}).click();assert.equal(await dialog.locator('article').count(),0);
 await page.reload();await log.click();assert.equal(await dialog.locator('article').count(),0);
 assert.deepEqual(errors,[]);results.push({width,entryBeforeDelete:entries[0],xml:parsed,layoutPreserved:true,quotaFailureHandled:true,deleteSurvivesReload:true,errors});await context.close();
}writeFileSync(`${dir}/browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}finally{await browser.close();}
