import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RADAR } from '../public/radar-rules.js';
import {importPublicModule} from './helpers/public-modules.mjs';

const {createWorld,createRadar,createSupplyCrate,SUPPLY_BEACON,supplyBeaconFlash}=await importPublicModule('world.js');
const {sharedEffects}=await importPublicModule('fx.js');
const canvasDocument={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({measureText:value=>({width:value.length*20})},{get:(object,key)=>key in object?object[key]:()=>{}})})};

test('the radar bonus model creates no lights and stays within the pickup footprint',()=>{
  const radar=createRadar(),bounds=new THREE.Box3().setFromObject(radar),epsilon=1e-7;
  assert.ok(bounds.min.x>=-.5-epsilon&&bounds.max.x<=.5+epsilon);
  assert.ok(bounds.min.z>=-.5-epsilon&&bounds.max.z<=.5+epsilon);
  assert.ok(bounds.min.y>=-epsilon&&bounds.max.y<=.6+epsilon);
  radar.traverse(node=>assert.equal(Boolean(node.isLight),false));
});

test('the crate has no physical radar reward and keeps its activation indicator across the unlock wave',()=>{
  const previous=globalThis.document;globalThis.document=canvasDocument;
  let world;try {world=createWorld(new THREE.Scene());}finally {globalThis.document=previous;}
  assert.equal(world.radarDevice,undefined,'no appliance follows the snapshot anymore');
  assert.equal(world.supplyCrate.getObjectByName('bonus-radar'),undefined,'reward models no longer hang over the crate');
  const state={wave:RADAR.unlockWave-1,players:[],spawnWarnings:[],supplyCrate:{id:'supply-fixed',wave:RADAR.unlockWave-1,active:false,x:15,y:0,z:-11,claimed:[]}};
  world.update(1,{snapshot:state,active:true,myId:'me'});
  assert.equal(world.supplyCrate.visible,true,'the permanent crate remains visible while inactive');
  assert.equal(world.supplyCrate.userData.indicator.material.color.getHex(),0x61776b);
  assert.equal(world.supplyCrate.userData.beacon.glow.material.opacity,0,'inactive offers do not flash');
  state.wave=RADAR.unlockWave;state.supplyCrate.active=true;world.update(2,{snapshot:state,active:true,myId:'me'});
  assert.equal(world.supplyCrate.userData.indicator.material.color.getHex(),0xe2c47d,'an active offer still lights the crate indicator');
  assert.equal(world.supplyCrate.getObjectByName('bonus-radar'),undefined,'unlocking the menu does not add a physical reward model');
});

test('the supply crate strobes a fog-free red beacon and breathes a smoke column',()=>{
  const previous=globalThis.document;globalThis.document=canvasDocument;
  let world;try {world=createWorld(new THREE.Scene());}finally {globalThis.document=previous;}
  const crate=world.supplyCrate,lens=crate.getObjectByName('crateBeaconLens'),glow=crate.getObjectByName('crateBeaconGlow');
  assert.ok(lens&&glow,'the beacon exists');
  crate.traverse(node=>assert.equal(Boolean(node.isLight),false,'no real lights ride the crate'));
  assert.equal(lens.material.fog,false,'the lens ignores fog so it stays visible from the porch');
  // Strobe pattern: bright inside the two flashes, dark between them.
  assert.equal(supplyBeaconFlash(0),true);assert.equal(supplyBeaconFlash(SUPPLY_BEACON.firstFlash),false);
  assert.equal(supplyBeaconFlash(SUPPLY_BEACON.secondAt+.01),true);
  assert.equal(supplyBeaconFlash(SUPPLY_BEACON.secondAt+SUPPLY_BEACON.secondFlash),false);
  assert.equal(supplyBeaconFlash(SUPPLY_BEACON.period),true,'the pattern repeats every period');
  assert.equal(supplyBeaconFlash(0,true),false,'a claimed crate stops calling');
  const state={wave:4,players:[],spawnWarnings:[],myId:'me',supplyCrate:{id:'supply-4',wave:4,x:15,y:0,z:-11,claimed:[]}};
  const fx=sharedEffects();fx.clear();
  world.update(.01,{snapshot:state,active:true});
  assert.equal(lens.material.color.getHex(),SUPPLY_BEACON.bright);
  assert.ok(glow.material.opacity>0,'the additive halo lights up with the lens');
  const puffsAfterFirst=fx.count();
  assert.ok(puffsAfterFirst>=1,'the column starts as soon as the crate exists');
  world.update(.17,{snapshot:state,active:true});
  assert.equal(lens.material.color.getHex(),SUPPLY_BEACON.dim,'dark between the two flashes');
  assert.equal(glow.material.opacity,0);
  world.update(SUPPLY_BEACON.period+.01,{snapshot:state,active:true});
  assert.equal(lens.material.color.getHex(),SUPPLY_BEACON.bright,'the strobe repeats');
  world.update(SUPPLY_BEACON.period*2+.02,{snapshot:{...state,supplyCrate:{...state.supplyCrate,claimed:['me']}},myId:'me',active:true});
  assert.equal(lens.material.color.getHex(),SUPPLY_BEACON.claimed,'once claimed by me, the call stops');
  assert.equal(glow.material.opacity,0);
  const beforeColumn=fx.count();
  for (let step=.2;step<=3.01;step+=.2) world.update(SUPPLY_BEACON.period*3+step,{snapshot:state,active:true});
  assert.ok(fx.count()>beforeColumn,'smoke keeps rising over time');
  world.update(1,{snapshot:{...state,supplyCrate:null},active:true});
  assert.equal(crate.visible,false);
});
