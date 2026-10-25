// The blood part's allocation test (art/frisson/BLOOD-SPRAY.md 5.1), run by
// frisson-blood-spray.test.mjs as a child: node --max-semi-space-size=1
// --expose-gc. Every event is built in advance (shells, kill shells,
// minigun streams, blasts, melee kills, legacy kills, shots into a wall, a
// teammate's shot past the camera); the part warms up with 10,000 hook calls
// and 600 frames, then runs 100,000 hook calls and 6,000 frames under a
// PerformanceObserver for 'gc'. With a 1 MB young generation, 10 bytes per
// call would already show as minor collections. Then 30,000 more frames with a
// light stream, so 35 bytes a frame would show too. Every 4 s a flood of 100
// bodies hit with a 2.5 s delay fills the open-spray table (a full table
// flushes its farthest spray at once) and the pending ring (a full ring
// throws the oldest wound's puffs at once), both inside the hook. Prints one
// JSON line.
// The warm-up is longer than that: 600 frames that step the visual clock by
// 1/20 s (30 s, so floor pixels reach their end), then the measured schedule
// once. A code path met for the first time sends its function back to the
// interpreter for a few hundred calls, and a pool loop running there boxes
// every number it reads: a first-time cost of the engine, not a per-hit one.
import { PerformanceObserver, constants } from 'node:perf_hooks';
import * as THREE from 'three';
import { importPublicModule } from './public-modules.mjs';
import { shotEvents, MOVE } from './blood-wounds.mjs';

const { install } = await importPublicModule('frisson/blood.js');
const { ARC_SOLIDS } = await importPublicModule('frisson/blood-floor.js');

// A random that allocates nothing (Math.random refills its cache by allocating).
const seed = new Uint32Array(1); seed[0] = 20261014;
const random = () => { seed[0] = seed[0] * 1664525 + 1013904223; return seed[0] / 4294967296; };
const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 200);
camera.position.set(2.6, 1.55, -3.4);
const scene = new THREE.Scene(), hooks = {};
const handle = await install({ THREE, scene, camera, hooks, quality: 'high', random, base: '/frisson/' });

// One shape for every event, as the client's refilled object.
const event = (fields) => ({ x: 0, y: 0, z: 0, dirX: 0, dirY: 0, dirZ: 0, headshot: false, kill: false, zombieId: null, damage: 0, weapon: 'minigun',
  mode: 'bullet', shot: 0, kind: 'walker', boss: false, scale: 1, axisX: 0, axisZ: 0, local: false, delay: 0, ...fields });
const ids = Array.from({ length: 512 }, (_, index) => `g${index}`);
const zombies = Array.from({ length: 60 }, (_, index) => ({ id: ids[index], x: -6 + (index % 12) * 1.1, y: 0, z: -1.4 + Math.floor(index / 12) * 1.2, kind: index % 9 === 0 ? 'brute' : 'walker', height: 1.82 }));
zombies.push({ id: 'raider1', x: 6, y: 0, z: 4, kind: 'raider', height: 1.78 });
const snapshot = { phase: 'wave', zombies };
const moved = (name, kind) => shotEvents(name, { kind, move: MOVE(name) }).map(item => event(item));
const shell = moved('shotgunColossusHead', 'brute'), killShell = moved('shotgunColossusKill', 'brute'), walkerKill = moved('shotgunWalkerKill', 'walker');
const partition = ARC_SOLIDS.find(solid => solid.top === 3.05 && solid.minX <= 0 && solid.maxX >= 0);
const wall = Array.from({ length: 9 }, (_, pellet) => event({ x: (pellet - 4) * .05, y: 1.3 + (pellet % 3) * .12, z: partition.maxZ + .99, dirX: (pellet - 4) * .02, dirY: -.05, dirZ: -1,
  headshot: pellet % 2 === 0, damage: 92.8, weapon: 'shotgun', kind: 'brute', scale: 1.22, axisX: 0, axisZ: partition.maxZ + .6, local: true }));
const stream = Array.from({ length: 4 }, (_, gunner) => event({ y: 1.1, dirZ: -1, damage: 30.1, local: gunner === 0 }));
const blast = Array.from({ length: 3 }, (_, index) => event({ x: 1 + index * .7, y: .95, z: -4.4, dirX: index - 1, dirZ: -1, damage: 450, kill: index === 1, mode: 'blast', weapon: 'grenade', axisX: NaN, axisZ: NaN }));
const melee = event({ x: 2.6, y: 1.1, z: -4.28, dirZ: -1, damage: 200, kill: true, mode: 'melee', weapon: 'bat', axisX: 2.6, axisZ: -4.6, local: true });
const legacy = event({ x: 2.6, y: 1, z: -4.4, dirX: 0, dirZ: -1, damage: null, kill: true, mode: 'legacy', weapon: 'flamethrower', axisX: 2.6, axisZ: -4.6 });
const flood = Array.from({ length: 4 }, () => event({ y: 1.2, dirZ: -1, damage: 25, delay: 2.5, axisX: NaN, axisZ: NaN }));
const mate = Array.from({ length: 9 }, (_, pellet) => event({ x: 2.6 + (pellet - 4) * .04, y: 1.1 + (pellet % 3) * .1, z: -4.92, dirZ: 1, damage: 36.7, weapon: 'shotgun', axisX: 2.6, axisZ: -4.6 }));
for (const item of [...stream, ...blast, melee, legacy, ...mate]) { const length = Math.hypot(item.dirX, item.dirY, item.dirZ); item.dirX /= length; item.dirY /= length; item.dirZ /= length; }
const frameEvent = { delta: 1 / 60, time: .5, self: null, snapshot };
const counts = new Float64Array(4); // calls, frames, shot number, next id

function fire(list, id) {
  counts[2]++;
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    item.shot = counts[2]; item.zombieId = id;
    hooks.impact(item); counts[0]++;
  }
}
function step(frame, delta = 1 / 60) {
  const fresh = ids[60 + (frame % 452)];
  for (let gunner = 0; gunner < 4; gunner++) {
    const item = stream[gunner], target = zombies[(frame * 7 + gunner * 13) % 60];
    item.x = target.x; item.z = target.z + .32; item.axisX = target.x; item.axisZ = target.z; item.shot = ++counts[2]; item.zombieId = target.id;
    for (let wound = 0; wound < 2; wound++) { hooks.impact(item); counts[0]++; item.x += .02; }
  }
  if (frame % 2 === 0) fire(shell, ids[frame % 3]);
  if (frame % 7 === 0) fire(killShell, fresh);
  if (frame % 9 === 0) fire(walkerKill, ids[60 + ((frame + 200) % 452)]);
  if (frame % 5 === 0) fire(wall, ids[3 + frame % 2]);
  if (frame % 11 === 0) fire(blast, ids[5 + frame % 3]);
  if (frame % 13 === 0) { melee.shot = ++counts[2]; melee.zombieId = ids[8]; hooks.impact(melee); counts[0]++; }
  if (frame % 17 === 0) { legacy.shot = ++counts[2]; legacy.zombieId = ids[9]; hooks.impact(legacy); counts[0]++; }
  if (frame % 19 === 0) fire(mate, ids[10]);
  if (frame % 240 === 120) for (let body = 0; body < 100; body++) {
    const target = zombies[body % 60];
    for (let index = 0; index < flood.length; index++) { flood[index].x = target.x + index * .02; flood[index].z = target.z + .32; }
    fire(flood, ids[300 + body]);
  }
  frameEvent.time += delta; frameEvent.delta = delta;
  hooks.frame(frameEvent); counts[1]++;
}

// The light stream of the long run: one teammate's round a frame.
function light(frame) {
  const item = stream[1], target = zombies[(frame * 7) % 60];
  item.x = target.x; item.z = target.z + .32; item.axisX = target.x; item.axisZ = target.z; item.shot = ++counts[2]; item.zombieId = target.id;
  hooks.impact(item); counts[0]++;
  frameEvent.time += 1 / 60; frameEvent.delta = 1 / 60;
  hooks.frame(frameEvent); counts[1]++;
}
// Each regime (the heavy schedule, the light stream) is warmed up twice in
// turn, so the code each optimizes is stable before the measured run passes
// from one to the other (a first switch deoptimizes a few functions once).
for (let frame = 0; frame < 600 || counts[0] < 10000; frame++) step(frame, 1 / 20);
for (let round = 0; round < 2; round++) {
  for (let frame = 0; frame < 6000; frame++) step(frame + 600);
  for (let frame = 0; frame < 3000; frame++) light(frame);
}
globalThis.gc();
let minor = 0, major = 0;
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor++; else major++;
  }
});
observer.observe({ entryTypes: ['gc'] });
const before = handle.stats();
const full = { flushed: before.flushedFull, pending: before.pendingFull };
counts[0] = 0; counts[1] = 0;
for (let frame = 0; frame < 6000 || counts[0] < 100000; frame++) step(frame + 600);
const heavy = { calls: counts[0], frames: counts[1] };
for (let frame = 0; frame < 30000; frame++) light(frame);
await new Promise(resolve => setTimeout(resolve, 200));
observer.disconnect();
const after = handle.stats();
full.flushed = after.flushedFull - full.flushed; full.pending = after.pendingFull - full.pending;
console.log(JSON.stringify({ calls: heavy.calls, frames: heavy.frames, lightFrames: counts[1] - heavy.frames, full, minor, major, thrown: after.thrownTotal - before.thrownTotal, dropped: after.dropped - before.dropped,
  recycledInAir: after.recycledInAir - before.recycledInAir, spots: after.spots, governor: after.governor }));
