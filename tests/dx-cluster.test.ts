import test from 'node:test';import assert from 'node:assert/strict';import { readFileSync } from 'node:fs';
import { parseDxSpots,freshDx,dxBand,dxAvailable,projectDx,DX_MAX_AGE } from '../src/dxCluster';
// Captured live HamQTH response only: no fictitious stations are created.
test('real spots: parse kHz/UTC, freshness, current band, range and zoom projection',()=>{
 const raw=JSON.parse(readFileSync(new URL('./fixtures/hamqth-spots.json',import.meta.url),'utf8'));const spots=parseDxSpots(raw);assert.ok(spots.length>0);
 const newest=spots[0],reported=raw.spots.find((v:any)=>v.dxcall===newest.call&&v.freq===newest.frequency&&Date.parse(v.time)===newest.time);
 assert.ok(reported);assert.equal(newest.frequency,reported.freq);assert.equal(newest.time,Date.parse(reported.time));
 assert.ok(freshDx(spots,newest.time).length>0);assert.equal(freshDx(spots,newest.time+DX_MAX_AGE+1).length,0);
 const band=dxBand(newest.frequency);assert.ok(band);assert.ok(freshDx(spots,newest.time,band).every(s=>s.band===band));
 assert.equal(dxAvailable(newest,{min:newest.frequency-1,max:newest.frequency+1}),true);assert.equal(dxAvailable(newest,{min:0,max:newest.frequency-1}),false);assert.equal(dxAvailable(newest,null),false);
 const near=projectDx([newest],{start:newest.frequency-5,span:10},400);assert.equal(near[0].x,200);
 assert.equal(projectDx([newest],{start:newest.frequency+1,span:10},400).length,0);
 assert.equal(projectDx([newest,newest],{start:newest.frequency-5,span:10},400).length,1);
 assert.throws(()=>parseDxSpots({broken:raw.spots}));assert.deepEqual(parseDxSpots({spots:[]}),[]);
});
