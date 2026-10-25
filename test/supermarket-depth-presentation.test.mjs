import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('cellar presentation retains real negative surfaces and smooths both stair flights',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {SPACE,spaceTreadY,spaceRampY} from './public/level-space.js';
  import {RADAR_PLAN} from './public/radar-ui.js';
  assert.equal(RADAR_PLAN.flights,SPACE.flights);
  import {cameraSupportHeight} from './public/camera-motion.js';
  import {restingSurface,arcContact,CONTACT,squareRests} from './public/frisson/blood-floor.js';
  assert.equal(restingSurface(8.6,.5,-1),-3.4);
  assert.equal(restingSurface(8.6,.5,1),0);
  assert.equal(squareRests(8.6,.5,.08,-3.4),true);
  const hit=arcContact(8.6,-1,.5,0,6,0,18,.02,1,{});
  assert.equal(hit.kind,CONTACT.CEILING);
  assert.ok(Math.abs(hit.low-(-.26))<1e-8);
  for(const f of SPACE.flights)for(let i=0;i<100;i++){
   const z=f.minZ+(i+.5)*(f.maxZ-f.minZ)/100,y=spaceTreadY(f,z);
   const pose={x:(f.minX+f.maxX)/2,y,z,grounded:true};
   assert.ok(Math.abs(cameraSupportHeight(pose)-spaceRampY(f,z))<1e-9);
   assert.ok(Math.abs(cameraSupportHeight({...pose,y:y+.08},pose)-(spaceRampY(f,z)+.08))<1e-9);
   assert.equal(cameraSupportHeight({...pose,grounded:false}),y);
  }
 `],{cwd:new URL('..',import.meta.url),env:{...process.env,DEADWOOD_LEVEL:'supermarket'},encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
