import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LOG_KEY, parseLog, saveLog, exportAdif, exportCsv, type SwlEntry } from '../src/swlLogbook';
// Fixtures are isolated tests; no stations are inserted into the user's journal.
const entry: SwlEntry = {id:'fixture-1',call:'UR4MTN/P',frequencyHz:7143149,mode:'LSB',utc:'2026-10-21T23:59:58.000Z',rst:'59',comment:'Тихо, "слышно" & <тест>\nвторая строка'};
test('SWL storage round-trip preserves observations and rejects corrupt records or failed writes', () => {
  const map=new Map<string,string>();const storage={setItem:(k:string,v:string)=>{map.set(k,v);}};
  saveLog(storage,[entry]);assert.deepEqual(parseLog(map.get(LOG_KEY)!),[entry]);
  const edited={...entry,call:'UR4MTN',rst:'57',comment:'Изменено'};saveLog(storage,[edited]);
  assert.deepEqual(parseLog(map.get(LOG_KEY)!),[edited]);saveLog(storage,[]);assert.deepEqual(parseLog(map.get(LOG_KEY)!),[]);
  assert.throws(()=>parseLog('{broken'));
  assert.throws(()=>parseLog(JSON.stringify([{...entry,utc:'2026-02-30T00:00:00.000Z'}])));
  assert.throws(()=>parseLog(JSON.stringify([entry,entry])));
  assert.throws(()=>saveLog({setItem(){throw new Error('QuotaExceededError');}},[entry]));
});
test('export UTF-8 ADIF3 ADX and quoted CSV with exact MHz, UTC, SSB submode and SWL semantics', () => {
  const entries=[entry,{...entry,id:'fixture-2',call:'UT0TEST',mode:'CW' as const,rst:'599'}];
  const adx=exportAdif(entries),csv=exportCsv(entries);
  assert.ok(adx.includes('<ADIF_VER>3.1.8</ADIF_VER>'));
  assert.ok(adx.includes('<FREQ>7.143149</FREQ>'));
  assert.ok(adx.includes('<MODE>SSB</MODE><SUBMODE>LSB</SUBMODE>'));
  assert.equal((adx.match(/<SWL>Y<\/SWL>/g)||[]).length,2);
  assert.ok(!adx.includes('RST_SENT')&&!adx.includes('RST_RCVD'));
  assert.ok(adx.includes('<QSO_DATE>20261021</QSO_DATE><TIME_ON>235958</TIME_ON>'));
  assert.ok(csv.startsWith('\uFEFF"CALL","FREQ_MHZ"'));
  mkdirSync('artifacts/swl-logbook',{recursive:true});writeFileSync('artifacts/swl-logbook/fixture.adx',adx);writeFileSync('artifacts/swl-logbook/fixture.csv',csv);
});
