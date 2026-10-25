import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('supermarket renderer shares authority volumes and retains barricade and equipment state', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import * as THREE from 'three';
    import { WORLD } from './simulation.mjs';
    import { LEVEL } from './public/level-config.js';
    import { importPublicModule } from './test/helpers/public-modules.mjs';
    globalThis.document = { createElement() { return { width:0, height:0, getContext:()=> new Proxy({ measureText:value=>({width:value.length*24}) },{get:(o,k)=>o[k]??(()=>{})}) }; } };
    const { createWorld, createExtraction } = await importPublicModule('world.js');
    const extraction=createExtraction(new THREE.Scene());extraction.update(6);
    const helicopter=new THREE.Box3().setFromObject(extraction.root.children[0]);
    assert.ok(helicopter.max.z < -LEVEL.halfDepth,'helicopter must clear enlarged north facade');
    assert.equal(extraction.cameraPosition.z,-22);
    const scene = new THREE.Scene(), world = createWorld(scene, { quality:{shadows:false}, loadDecor:async()=>new THREE.Group() });
    assert.equal(await world.ready,true);
    assert.equal(world.root.userData.artLoaded,true);
    assert.equal(world.doors.size,4);
    for (const spec of LEVEL.doors) {
      const door=world.doors.get(spec.id);door.updateWorldMatrix(true,false);
      const point=door.getWorldPosition(new THREE.Vector3());
      assert.deepEqual([point.x,point.z],[spec.x,spec.z]);
      world.setDoor(spec.id,.4,[60,0,60,0,0],false);
      assert.deepEqual(door.userData.boards.map(b=>b.visible),[true,false,true,false,false]);
      world.setDoor(spec.id,1,[60,60,60,60,60],true);
      assert.equal(door.userData.seal.visible,true);assert.equal(door.userData.frame.visible,false);
      world.setDoor(spec.id,1,[60,60,60,60,60],false);
    }
    world.root.updateMatrixWorld(true);
    for (const source of WORLD.covers) for (const cover of source.parts??[source]) {
      assert.ok(world.rayBlockers.some(mesh=>{
        const b=new THREE.Box3().setFromObject(mesh);
        return Math.abs(b.min.x-cover.minX)<1e-5&&Math.abs(b.max.x-cover.maxX)<1e-5&&Math.abs(b.min.z-cover.minZ)<1e-5&&Math.abs(b.max.z-cover.maxZ)<1e-5&&Math.abs(b.max.y-((cover.baseY??0)+cover.height))<1e-5;
      }),cover.id+' rendered proxy must match authority');
    }
    const backpack=new THREE.Group();
    world.update(1,{active:true,myId:'p',survivors:new Map([['p',{userData:{backpack}}]]),snapshot:{players:[{id:'p',x:0,y:0,z:0,backpack:false}],wave:1,supplyCrate:{x:-22,y:0,z:10,active:true,claimed:[]}}});
    assert.equal(backpack.visible,false);assert.equal(world.supplyCrate.visible,true);
    assert.deepEqual(world.supplyCrate.position.toArray(),[-22,0,10]);
    world.update(2,{});assert.equal(world.supplyCrate.visible,false);
    assert.equal(world.rayBlockers.filter(m=>m.material.visible===false).length>10,true);
    world.expedition.rainSeeds.set([11.2,2.4,5,8.6,2.4,.5],0);
    world.update(0,{active:true,snapshot:{players:[],expedition:{enabled:true,generator:{power:1}}}});
    const drops=world.expedition.rain.geometry.attributes.position.array;
    assert.ok(Math.abs(drops[1]+1)<1e-5,'rain reaches the exposed stair below ground level');
    assert.equal(drops[7],-20,'ground slab shields cellar from rain');
  `], { cwd: new URL('..',import.meta.url), env: {...process.env,DEADWOOD_LEVEL:'supermarket'}, encoding:'utf8',timeout:30000 });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
