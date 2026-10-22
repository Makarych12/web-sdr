import test from 'node:test';import assert from 'node:assert/strict';import{dxMode}from'../src/dxMode';import{parseDxSpots}from'../src/dxCluster';
test('DX mode: reported modes, Region 1 phone/CW/DATA, ambiguity and 60m exception',()=>{
 const at=(frequency:number,mode?:string)=>dxMode({frequency,mode},'AM');
 for(const [f,m]of [[21270,'USB'],[14227,'USB'],[7175,'LSB'],[3700,'LSB'],[1845,'LSB']] as const){assert.equal(at(f,'SSB').mode,m);assert.equal(at(f).mode,m);}
 assert.equal(at(7025).mode,'CW');assert.equal(at(10120).mode,'CW');assert.equal(at(21270,'CW').mode,'CW');assert.equal(at(7175,'USB').mode,'USB');
 assert.equal(at(5357,'SSB').mode,'USB');assert.equal(at(7074,'FT8').mode,'USB');
 for(const [f,m]of [[7045,undefined],[7074,'DIGI'],[14105,undefined],[14100,undefined],[29100,undefined],[7025,'SSB'],[5357,undefined],[7025,'UNKNOWN']] as const){const decision=at(f,m);assert.equal(decision.mode,'AM');assert.equal(decision.uncertain,true);}
 const source={spots:[{dxcall:'UR4MTN',spotter:'UR4MTN',freq:21270,time:'2026-10-22T10:00:00Z',mode:'SSB'}]};assert.equal(parseDxSpots(source)[0].mode,'SSB');
});
