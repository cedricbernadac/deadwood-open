// The Frisson blood spray (art/frisson/BLOOD-SPRAY.md 5.1): the recipe
// (blood-spray.js) pinned to the worked examples of 2.7, and the blood part
// fed with synthetic hook events shaped as the client makes them (4.2).
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';
import { SHOTS, ROWS, STREAMS, SCALES, MOVE, shotWounds, shotEvents, rowSpray, woundEvent } from './helpers/blood-wounds.mjs';

const recipe = await importPublicModule('frisson/blood-spray.js');
const { SPRAY, BLOOD_INTENSITY, knob, intensity, rawBurst, rawSpots, kindFactor, effectiveDistance, distanceFactor, puffsFor, sprayPlan, cellsFor, skinRadius } = recipe;
const { install, BLOOD_BUDGETS, BLOOD_PALETTE, BLOOD_LAYERS } = await importPublicModule('frisson/blood.js');
const { ARC_SOLIDS, OPEN_WINDOWS, squareRests, openWindowAt, restingSurface } = await importPublicModule('frisson/blood-floor.js');

const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const spread = seed => seeded(seed * 2654435761 >>> 0);
const DEG = Math.PI / 180;
const PRESETS = ['low', 'medium', 'high'];
const totalOf = (plan, wounds) => Math.min(plan.puffsMax, wounds * plan.puffsPerWound) + plan.burst + plan.fountain + plan.kill;
const plan = (spray, quality = 'high', B = 1) => sprayPlan(spray, quality, B, {});
const norm = ([x, y, z]) => { const length = Math.hypot(x, y, z); return [x / length, y / length, z / length]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;

function cameraAt(x, y, z, fov = 76) {
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, .05, 200);
  camera.position.set(x, y, z);
  return camera;
}
// The part with a recorder: every droplet (onDroplet) and every spray
// (onSpray) copied at once, with the frame it was thrown in.
async function part({ quality = 'high', random = seeded(7), camera = null, intensity: bloodIntensity, document = null } = {}) {
  const scene = new THREE.Scene(), hooks = {}, droplets = [], sprays = [], clock = { frame: 0, now: 0 };
  const handle = await install({ THREE, scene, camera, hooks, quality, random, bloodIntensity, document, base: '/frisson/',
    onDroplet: info => droplets.push({ ...info, frame: clock.frame, now: clock.now }), onSpray: info => sprays.push({ ...info, frame: clock.frame, now: clock.now }) });
  const frame = (delta = 1 / 60, extra = {}) => { clock.frame++; clock.now += delta; hooks.frame({ delta, ...extra }); };
  const run = (seconds, delta = 1 / 60) => { for (let left = seconds; left > 1e-9; left -= delta) frame(Math.min(delta, left)); };
  const group = scene.getObjectByName('frissonBlood');
  const meshes = { droplets: group.getObjectByName('frissonBloodDroplets'), stains: group.getObjectByName('frissonBloodStains'), spots: group.getObjectByName('frissonBloodSpots') };
  return { hooks, handle, droplets, sprays, frame, run, clock, scene, group, meshes, camera };
}
// A recorded shot moved to the shot tool's spot, the camera at the shooter's eye.
async function shotPart(name, { kind = 'walker', local = true, shot = 1, ...options } = {}) {
  const move = MOVE(name), eye = SHOTS[name].eye;
  const camera = cameraAt(eye[0] + move[0], eye[1] + move[1], eye[2] + move[2]);
  const blood = await part({ camera, ...options });
  return { ...blood, events: shotEvents(name, { kind, local, shot, move }), move };
}
// A wound built by hand: the hit point, its direction, the body's feet.
const wound = ({ x, y, z, dir, power, head = false, kill = false, id = 'z1', shot = 1, mode = 'bullet', kind = 'walker', scale = SCALES[kind] ?? 1,
  axis = [x, z], local = true, delay = 0, boss = false, weapon = 'pistol' }) => {
  const [dx, dy, dz] = norm(dir);
  return { x, y, z, dirX: dx, dirY: dy, dirZ: dz, headshot: head, kill, zombieId: id, damage: power, weapon, mode, shot, kind, boss, scale,
    axisX: axis[0], axisZ: axis[1], local, delay };
};
// Shown instances of an instanced pool: any non-zero in the 3×3 part.
function shown(mesh) {
  const out = [], array = mesh.instanceMatrix.array;
  for (let index = 0; index < mesh.count; index++) {
    const at = index * 16;
    let any = false;
    for (let k = 0; k < 11; k++) if (array[at + k] !== 0) any = true;
    if (!any) continue;
    const face = array[at + 5] === 1 ? 0 : array[at + 4] === 1 ? 1 : array[at + 4] === -1 ? 2 : array[at + 6] === 1 ? 3 : 4;
    const size = face === 0 || face >= 3 ? array[at] : Math.abs(array[at + 1]);
    out.push({ index, face, size, x: array[at + 12], y: array[at + 13], z: array[at + 14] });
  }
  return out;
}
const linear = BLOOD_PALETTE.map(hex => new THREE.Color().setHex(hex));
const colourOf = (mesh, index) => {
  const array = mesh.instanceColor.array;
  return linear.findIndex(colour => Math.abs(colour.r - array[index * 3]) < 1e-6 && Math.abs(colour.g - array[index * 3 + 1]) < 1e-6);
};
// Every point of a droplet's solved arc, densely.
function arcGap(drop, camera) {
  let best = Infinity;
  for (let k = 0; k <= 200; k++) {
    const t = drop.time * k / 200, x = drop.x + drop.vx * t, y = drop.y + drop.vy * t - 4.5 * t * t, z = drop.z + drop.vz * t;
    best = Math.min(best, Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z));
  }
  return best;
}
// The largest size on screen (px at 1080p) of a droplet's cube along its
// arc, wherever it is in the camera's view (the cone through the frame's
// corners, as blood.js takes it): its side over its depth.
function screenPx(drop, camera) {
  const forward = camera.getWorldDirection(new THREE.Vector3()), tanV = Math.tan(camera.fov / 2 * DEG), wide = tanV * Math.hypot(1, camera.aspect), focal = 540 / tanV;
  let best = 0;
  for (let k = 0; k <= 400; k++) {
    const t = drop.time * k / 400, d = [drop.x + drop.vx * t - camera.position.x, drop.y + drop.vy * t - 4.5 * t * t - camera.position.y, drop.z + drop.vz * t - camera.position.z];
    const depth = dot(d, [forward.x, forward.y, forward.z]);
    if (depth <= 0 || dot(d, d) - depth * depth > depth * depth * wide * wide) continue;
    best = Math.max(best, drop.cells * .025 * focal / depth);
  }
  return best;
}
function approach(drop, camera) {
  const c = [camera.position.x - drop.x, camera.position.y - drop.y, camera.position.z - drop.z], distance = Math.hypot(...c);
  return { speed: dot([drop.vx, drop.vy, drop.vz], c) / distance, cap: Math.min(.5 * distance, 3.5) };
}

test('the recipe gives every row of the 2.7 table, for every preset, from the real simulation\'s wounds', () => {
  for (const row of ROWS) {
    const spray = rowSpray(row), heads = typeof row.source === 'string' ? shotWounds(row.source).filter(item => item.head).length : 0;
    const high = plan(spray, 'high'), medium = plan(spray, 'medium'), low = plan(spray, 'low');
    const got = { wounds: spray.wounds, heads, D: Math.round(spray.damage * 10) / 10, I: Math.round(high.intensity * 100) / 100,
      puffs: Math.min(high.puffsMax, spray.wounds * high.puffsPerWound), burst: high.burst, back: high.back, exit: high.exit, globs: high.globs,
      fountain: high.fountain, kill: high.kill, total: totalOf(high, spray.wounds), medium: totalOf(medium, spray.wounds), low: totalOf(low, spray.wounds), spots: high.spots };
    assert.deepEqual(got, { ...row.expect }, row.label);
    assert.equal(high.back + high.exit, high.burst);
  }
  // His case is the largest surviving spray; a kill takes it to the top.
  const total = label => { const row = ROWS.find(item => item.label.startsWith(label)); return row.expect.total; };
  const surviving = ROWS.filter(row => row.expect.kill === 0).map(row => row.expect.total);
  assert.equal(Math.max(...surviving), total('Shotgun, colossus head'));
  assert.equal(Math.max(...ROWS.map(row => row.expect.total)), total('The same, 700-HP colossus'));
});

test('the stream table: each round gets its share of the zombie\'s recent damage', () => {
  for (const stream of STREAMS) {
    const q = Math.exp(-stream.interval / SPRAY.recent), A = stream.power * q / (1 - q);
    assert.equal(Math.round(A), stream.A, stream.label);
    const result = plan({ damage: stream.power, recent: A, headShare: stream.head ? 1 : 0, wounds: 1, kind: stream.kind, boss: false, mode: 'bullet',
      kill: false, killDone: false, distance: 6, local: true, carry: 0, spotCarry: 0 });
    const burst = result.burst + result.carry, spots = result.spots + result.spotCarry;
    assert.ok(Math.abs(burst - stream.burst) < .006, `${stream.label}: ${burst}`);
    assert.equal(result.puffsPerWound, stream.puffs);
    assert.equal(Math.round((stream.puffs + burst) * 10) / 10, stream.perRound, stream.label);
    assert.equal(Math.round((stream.puffs + burst) / stream.interval), stream.perSecond, stream.label);
    assert.equal(Math.round(spots / stream.interval), stream.spotsPerSecond, stream.label);
  }
});

test('the formulas: I, R, S, K, L, d_eff and the knob', () => {
  assert.equal(BLOOD_INTENSITY, 1, 'shipped at 1');
  assert.ok(Math.abs(intensity(25) - 1.17) < .005 && Math.abs(intensity(380) - 4.32) < .005 && Math.abs(intensity(835) - 5.42) < .005);
  assert.equal(rawBurst(0), 0); assert.equal(rawSpots(0), 0);
  assert.ok(Math.abs(rawBurst(25) - (3 + 6 * intensity(25))) < 1e-12 && Math.abs(rawSpots(2) - (4 * .4 + 3 * intensity(2))) < 1e-12);
  assert.deepEqual(['crawler', 'walker', 'runner', 'armored', 'brute', 'boss', 'raider', null].map(kind => kindFactor(kind, false)), [.75, 1, 1, 1, 1.35, 1.6, 1, 1]);
  assert.equal(kindFactor('brute', true), 1.6);
  assert.deepEqual([0, 8, 8.01, 18, 18.01, 35, 35.01].map(distanceFactor), [1, 1, .7, .7, .45, .45, 0]);
  assert.equal(effectiveDistance(10, 76), 10);
  assert.ok(Math.abs(effectiveDistance(29, 30) - 29 * Math.tan(15 * DEG) / Math.tan(38 * DEG)) < 1e-12);
  assert.ok(Math.abs(29 / effectiveDistance(29, 30) - 2.92) < .01, 'the sniper scope brings blood about 2.9 times nearer');
  assert.deepEqual([knob(), knob(.1), knob(5), knob(.5), knob(Number.NaN), knob('2'), knob(undefined)], [1, .25, 2, .5, 1, 1, 1]);
  assert.deepEqual([puffsFor(3, 'bullet', 1), puffsFor(12, 'bullet', 1), puffsFor(40, 'bullet', 1), puffsFor(3, 'blast', 1), puffsFor(3, 'legacy', 1)], [2, 1, 0, 0, 0]);
  assert.deepEqual([puffsFor(3, 'bullet', .5), puffsFor(3, 'bullet', 2), puffsFor(12, 'bullet', .25)], [1, 3, 1], 'puffs follow √B');
});

test('monotonic: the total, the burst, the fountain, the kill and the spots never drop as damage rises', () => {
  let checked = 0;
  for (const kind of ['crawler', 'walker', 'brute', 'boss']) for (const headShare of [0, 1]) for (const kill of [false, true]) for (const distance of [3, 12, 25])
    for (const quality of PRESETS) for (const recent of [0, 200]) {
      let last = null;
      for (let damage = 1; damage <= 3000; damage++) {
        const result = plan({ damage, recent, headShare, wounds: 1, kind, boss: false, mode: 'bullet', kill, killDone: false, distance, local: true, carry: .5, spotCarry: .5 }, quality);
        const now = { total: totalOf(result, 1), burst: result.burst, fountain: result.fountain, kill: result.kill, spots: result.spots };
        assert.equal(result.back + result.exit, result.burst);
        if (last) for (const key of Object.keys(now)) if (now[key] < last[key]) assert.fail(`${key} drops at ${damage} HP: ${kind} head ${headShare} kill ${kill} ${distance} m ${quality} A ${recent}`);
        last = now; checked++;
      }
    }
  assert.ok(checked > 800000);
});

test('the knob: half the blood at .5, double at 2 up to doubled caps, puffs by its square root', () => {
  for (const row of ROWS) {
    const spray = rowSpray(row);
    for (const quality of PRESETS) {
      const one = plan(spray, quality, 1), half = plan(spray, quality, .5), two = plan(spray, quality, 2);
      for (const key of ['burst', 'kill', 'spots']) {
        assert.ok(Math.abs(half[key] - one[key] / 2) <= 1, `${row.label} ${quality} ${key} at .5: ${half[key]} against ${one[key]}`);
        assert.ok(Math.abs(two[key] - one[key] * 2) <= 1, `${row.label} ${quality} ${key} at 2: ${two[key]} against ${one[key]}`);
      }
      assert.equal(two.puffsMax, Math.round(18 * Math.SQRT2)); assert.equal(half.puffsMax, Math.round(18 * Math.SQRT1_2));
      // Speeds and cones never change with it.
      assert.equal(two.vmax, one.vmax); assert.equal(two.theta, one.theta);
    }
  }
  // A cap doubles with it: a hit beyond the high cap at 1 stays within twice it at 2.
  const huge = { damage: 50000, recent: 0, headShare: 1, wounds: 1, kind: 'boss', boss: true, mode: 'bullet', kill: false, killDone: false, distance: 2, local: true, carry: .5, spotCarry: .5 };
  assert.equal(plan(huge, 'high', 1).burst, Math.round(64 * 1.6));
  assert.equal(plan(huge, 'high', 2).burst, Math.round(64 * 2 * 1.6));
});

test('the knob through ctx.bloodIntensity: pools and caps grow with it, values outside .25–2 are clamped', async () => {
  const pools = async intensity => (await part({ intensity })).handle.stats();
  const one = await pools(undefined), double = await pools(2), half = await pools(.5), wild = await pools(9), tiny = await pools(.01);
  assert.equal(one.knob, 1); assert.deepEqual(one.pools, { droplets: 512, spots: 640, perFrame: 128 });
  assert.equal(double.knob, 2); assert.deepEqual(double.pools, { droplets: 1024, spots: 1280, perFrame: 256 });
  assert.equal(half.knob, .5); assert.deepEqual(half.pools, one.pools, 'pools never shrink');
  assert.equal(wild.knob, 2); assert.equal(tiny.knob, .25);
  // The part throws its plan at that knob.
  for (const B of [.5, 1, 2]) {
    const blood = await shotPart('shotgunColossusHead', { kind: 'brute', intensity: B });
    blood.frame();
    for (const event of blood.events) blood.hooks.impact(event);
    blood.run(.2);
    const spray = rowSpray(ROWS.find(row => row.source === 'shotgunColossusHead')), expected = plan(spray, 'high', B);
    assert.equal(blood.sprays.length, 1);
    assert.equal(blood.sprays[0].want, expected.burst + expected.fountain + expected.kill, `B ${B}`);
    assert.equal(blood.droplets.filter(drop => drop.layer === 'puff').length, Math.min(expected.puffsMax, 9 * expected.puffsPerWound), `B ${B} puffs`);
  }
});

test('cells: 1 or 2 near by intensity, 2 to 16 m, 3 beyond; puffs and the near back spray are 1 cell; the scope counts', async () => {
  const random = seeded(99);
  for (const [I, oneShare] of [[1, .6], [2, .45], [4, .35]]) {
    let ones = 0;
    for (let draw = 0; draw < 10000; draw++) if (cellsFor(I, 5, random) === 1) ones++;
    assert.ok(Math.abs(ones / 10000 - oneShare) < .03, `I ${I}: ${ones / 10000}`);
  }
  for (let draw = 0; draw < 200; draw++) {
    assert.equal(cellsFor(5, 8.5, random), 2); assert.equal(cellsFor(1, 16, random), 2);
    assert.equal(cellsFor(1, 16.5, random), 3); assert.ok([1, 2].includes(cellsFor(5, 8, random)));
  }
  // In the part: a point-blank shell's puffs and back spray are 1 cell; its exit spray mixes 1 and 2.
  const near = await shotPart('shotgunColossusHead', { kind: 'brute', random: seeded(4) });
  near.frame();
  for (const event of near.events) near.hooks.impact(event);
  near.run(.1);
  const layer = name => near.droplets.filter(drop => drop.layer === name && !drop.dropped);
  assert.ok(layer('puff').length > 0 && layer('puff').every(drop => drop.cells === 1));
  assert.ok(layer('back').length > 0 && layer('back').every(drop => drop.cells === 1));
  assert.ok(near.droplets.every(drop => drop.cells <= 2), 'nothing over 5 cm within 16 m');
  // The same shell seen at 24 m: 3 cells; through a 30° scope it is nearer than 16 m: no 3-cell droplets.
  for (const [fov, three] of [[76, true], [30, false]]) {
    // A witness 24 m to the side of the shot (outside, through the door: the blood does not care).
    const camera = cameraAt(2.6 - 24, 1.55, -4.6, fov);
    const far = await part({ camera, random: seeded(5) });
    far.frame();
    for (const event of shotEvents('shotgunColossusHead', { kind: 'brute', move: MOVE('shotgunColossusHead'), local: false })) far.hooks.impact(event);
    far.run(.1);
    const exit = far.droplets.filter(drop => drop.layer !== 'puff' && !drop.dropped);
    assert.ok(exit.length > 0);
    assert.equal(exit.some(drop => drop.cells === 3), three, `fov ${fov}`);
    if (!three) assert.ok(Math.abs(far.sprays[0].distance - effectiveDistance(24, 30)) < .2, `d_eff ${far.sprays[0].distance}`);
  }
});

test('puffs are thrown on the frame their wound is due, never earlier; the spray flushes with its latest wound', async () => {
  const camera = cameraAt(2.6, 1.55, -1.6);
  const blood = await part({ camera });
  blood.frame();
  blood.hooks.impact(wound({ x: 2.6, y: 1.2, z: -4.28, dir: [0, 0, -1], power: 25, axis: [2.6, -4.6], delay: .1 }));
  blood.hooks.impact(wound({ x: 2.6, y: 1.25, z: -4.28, dir: [0, 0, -1], power: 25, axis: [2.6, -4.6], delay: .15 }));
  const start = blood.clock.now;
  blood.run(.3);
  const puffs = blood.droplets.filter(drop => drop.layer === 'puff');
  assert.equal(puffs.length, 4);
  for (const drop of puffs) assert.ok(drop.now >= start + .1 - 1e-9 && drop.now < start + .1 + 1 / 60 + 1e-9 || drop.now >= start + .15 - 1e-9 && drop.now < start + .15 + 1 / 60 + 1e-9, `puff at ${drop.now - start}`);
  assert.equal(new Set(puffs.map(drop => drop.frame)).size, 2, 'each wound on its own frame');
  assert.equal(blood.sprays.length, 1, 'one spray: the same zombie and server event');
  assert.ok(blood.sprays[0].now >= start + .15 - 1e-9 && blood.sprays[0].now < start + .15 + 1 / 60, 'flushed when the latest wound is due');
  assert.equal(blood.sprays[0].wounds, 2);
});

test('the 9 wounds of one shell are one burst and 18 puffs, whatever the frame phase, at 60 and 144 Hz', async () => {
  const row = ROWS.find(item => item.source === 'shotgunColossusHead'), expected = plan(rowSpray(row), 'high');
  for (const hz of [60, 144]) for (let phase = 0; phase < 1; phase += .125) {
    const blood = await shotPart('shotgunColossusHead', { kind: 'brute' });
    blood.frame(1 / hz);
    for (const event of blood.events) blood.hooks.impact(event);
    blood.frame(phase / hz);
    blood.run(.2, 1 / hz);
    assert.equal(blood.sprays.length, 1, `${hz} Hz, phase ${phase}`);
    assert.equal(blood.sprays[0].wounds, 9);
    assert.equal(blood.sprays[0].burst, expected.burst);
    assert.equal(blood.droplets.filter(drop => drop.layer === 'puff').length, 18);
  }
  // A shell through two walkers in line (3 and 4 m, the rest to the wall at 8 m): one burst per body.
  const line = await part({ camera: cameraAt(...SHOTS.shotgunTwoWalkers.eye) });
  line.frame();
  const events = shotEvents('shotgunTwoWalkers');
  assert.deepEqual([...new Set(events.map(event => event.zombieId))].sort(), ['A', 'B']);
  for (const event of events) line.hooks.impact(event);
  line.run(.2);
  assert.deepEqual(line.sprays.map(spray => spray.id).sort(), ['A', 'B']);
  assert.equal(line.sprays.reduce((sum, spray) => sum + spray.wounds, 0), events.length);
});

test('a kill throws one kill burst per death, its posthumous wounds included, whatever the frame phase', async () => {
  const wounds = shotWounds('shotgunWalkerKill');
  assert.equal(wounds.filter(item => item.killed).length, 9, 'the killing wound and 8 posthumous ones');
  for (let phase = 0; phase < 1; phase += .25) {
    const blood = await shotPart('shotgunWalkerKill');
    blood.frame();
    for (const event of blood.events) blood.hooks.impact(event);
    blood.frame(phase / 60);
    blood.run(.2);
    // The next shell on the dead body (its fall still drawn) throws no second kill burst.
    for (const event of shotEvents('shotgunWalkerKill', { shot: 2, move: blood.move })) blood.hooks.impact(event);
    blood.run(.2);
    assert.equal(blood.sprays.length, 2);
    assert.ok(blood.sprays[0].killBurst > 0 && blood.sprays[1].killBurst === 0, JSON.stringify(blood.sprays.map(spray => spray.killBurst)));
    assert.equal(blood.droplets.filter(drop => drop.layer === 'kill').length, blood.sprays[0].killBurst);
  }
});

test('streams add up: one frame of sprays on one body is one spray of their sum; each round of a stream bursts by its share', async () => {
  const camera = cameraAt(2.6, 1.55, -4.6 + 6);
  const at = { x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], axis: [2.6, -4.6], id: 'z9' };
  const blood = await part({ camera });
  blood.frame();
  for (let shot = 1; shot <= 5; shot++) blood.hooks.impact(wound({ ...at, power: 42.2, shot }));
  blood.run(.1);
  const one = plan({ damage: 5 * 42.2, recent: 0, headShare: 0, wounds: 1, kind: 'walker', mode: 'bullet', distance: blood.sprays[0].distance, local: true, carry: .5, spotCarry: .5 });
  const sum = blood.sprays.reduce((total, spray) => total + spray.burst, 0);
  assert.equal(blood.sprays.length, 5);
  assert.ok(Math.abs(sum - one.burst) <= 1, `${sum} against ${one.burst}`);
  // The stream table: steady per-round counts within one droplet.
  for (const stream of STREAMS) {
    const fresh = await part({ camera: cameraAt(2.6, 1.55, -4.6 + 6) });
    let next = 0, shot = 0;
    const rounds = [];
    for (let frame = 0; frame < 60 * 3; frame++) {
      const now = frame / 60;
      while (next <= now) {
        shot++;
        fresh.hooks.impact(wound({ ...at, id: 'stream', y: stream.head ? 1.68 : 1.1, power: stream.power, head: stream.head, kind: stream.kind, scale: SCALES[stream.kind], shot }));
        rounds.push(shot); next += stream.interval;
      }
      fresh.frame();
    }
    const late = fresh.sprays.filter(spray => spray.now >= 1);
    const perRound = late.reduce((total, spray) => total + spray.allotted + spray.puffs, 0) / late.length;
    assert.ok(Math.abs(perRound - stream.perRound) <= 1, `${stream.label}: ${perRound.toFixed(2)} a round against ${stream.perRound}`);
    assert.ok(fresh.sprays[0].burst > late[0].burst, 'the first round bursts whole, the next by their share');
  }
  // A second point-blank shell .85 s after the first bleeds almost afresh.
  const shells = await shotPart('shotgunColossusHead', { kind: 'brute' });
  shells.frame();
  for (const event of shells.events) shells.hooks.impact(event);
  shells.run(.85);
  for (const event of shotEvents('shotgunColossusHead', { kind: 'brute', shot: 2, move: shells.move })) shells.hooks.impact(event);
  shells.run(.1);
  assert.equal(shells.sprays.length, 2);
  assert.ok(shells.sprays[1].burst >= .9 * shells.sprays[0].burst, `${shells.sprays[1].burst} after ${shells.sprays[0].burst}`);
});

test('modes: bullet, melee, blast and legacy as the event says; no damage is legacy; the old-shape call still bleeds', async () => {
  const camera = cameraAt(2.6, 1.55, -1.6);
  const one = async event => {
    const blood = await part({ camera });
    blood.frame();
    blood.hooks.impact(event);
    blood.run(.3);
    return blood;
  };
  const at = { x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], axis: [2.6, -4.6] };
  const melee = await one(wound({ ...at, power: 120, mode: 'melee' }));
  assert.equal(melee.sprays[0].mode, 'melee');
  assert.ok(melee.droplets.some(drop => drop.layer === 'puff') && melee.droplets.some(drop => drop.layer === 'back'));
  const blast = await one(wound({ ...at, power: 225, mode: 'blast' }));
  assert.equal(blast.sprays[0].mode, 'blast');
  assert.ok(!blast.droplets.some(drop => drop.layer === 'puff' || drop.layer === 'back'), 'a blast has no entry puffs and no back spray');
  assert.ok(blast.droplets.some(drop => drop.layer === 'exit'));
  for (const [damage, kill, D] of [[null, false, 25], [Number.NaN, true, 40], [undefined, false, 25]]) {
    const legacy = await one(wound({ ...at, power: damage, kill }));
    assert.equal(legacy.sprays[0].mode, 'legacy');
    assert.equal(legacy.sprays[0].damage, D);
    assert.ok(legacy.droplets.length > 0 && !legacy.droplets.some(drop => drop.layer === 'puff'));
    assert.equal(legacy.droplets.some(drop => drop.layer === 'kill'), kill);
  }
  // The feedback-shot page's call (art/frisson/tools/feedback-shot/page/effects.js): no damage, mode or shot.
  for (const kill of [false, true]) {
    const old = await one({ x: 2.6, y: 1.2, z: -4.3, dirX: -1, dirZ: 0, headshot: false, kill, zombieId: 'z7' });
    assert.equal(old.sprays.length, 1);
    assert.equal(old.sprays[0].mode, 'legacy');
    assert.ok(old.droplets.length >= (kill ? 15 : 8), `${old.droplets.length} droplets`);
  }
  // Two old-shape calls on one id are two sprays (no shot: each its own).
  const twice = await part({ camera });
  twice.frame();
  twice.hooks.impact({ x: 2.6, y: 1.2, z: -4.3, zombieId: 4 }); twice.hooks.impact({ x: 2.6, y: 1.2, z: -4.3, zombieId: 4 });
  twice.run(.1);
  assert.equal(twice.sprays.length, 2);
});

test('the frame split: the cap holds, local sprays first, each keeps a droplet; every due wound throws one', async () => {
  // A rocket into six walkers, his own: 6 × 36 wanted, over the cap.
  const camera = cameraAt(2.6, 1.55, 0);
  const rocket = await part({ camera });
  rocket.frame();
  for (let index = 0; index < 6; index++) {
    rocket.hooks.impact(wound({ x: 1 + index * .6, y: .95, z: -6 + 1.4 + (index % 2) * .4, dir: [index - 2.5, 0, -1], power: 700, kill: true, mode: 'blast', id: `w${index}`, axis: [NaN, NaN] }));
  }
  rocket.frame();
  const cap = BLOOD_BUDGETS.high.perFrame;
  assert.equal(rocket.sprays.length, 6);
  assert.ok(rocket.sprays.every(spray => spray.allotted >= 1));
  assert.equal(rocket.handle.stats().thrown, cap, 'exactly the frame cap');
  assert.equal(rocket.sprays.reduce((sum, spray) => sum + spray.allotted, 0), cap);
  // Local sprays first: they fit, the others share what is left.
  const mixed = await part({ camera });
  mixed.frame();
  for (let index = 0; index < 6; index++) {
    mixed.hooks.impact(wound({ x: 1 + index * .6, y: .95, z: -4.6, dir: [0, 0, -1], power: 700, kill: true, mode: 'blast', id: `m${index}`, local: index < 3, axis: [NaN, NaN] }));
  }
  mixed.frame();
  const local = mixed.sprays.filter(spray => spray.local), others = mixed.sprays.filter(spray => !spray.local);
  assert.ok(local.every(spray => spray.allotted === spray.want), JSON.stringify(local.map(spray => [spray.want, spray.allotted])));
  assert.ok(others.every(spray => spray.allotted >= 1 && spray.allotted < spray.want));
  assert.ok(mixed.handle.stats().thrown <= cap);
  // Thirty teammates' shells in one frame on the low preset: every wound still throws a puff.
  const crowd = await part({ camera, quality: 'low' });
  crowd.frame();
  let wounds = 0;
  const base = MOVE('shotgunBody5');
  for (let index = 0; index < 28; index++) {
    for (const event of shotEvents('shotgunBody5', { local: false, shot: index + 1, move: [base[0] + (index % 4) * .3, 0, base[2] + (index % 7) * .2] })) {
      crowd.hooks.impact({ ...event, zombieId: `c${index}`, delay: 0 }); wounds++;
    }
  }
  crowd.frame();
  const puffs = crowd.droplets.filter(drop => drop.layer === 'puff').length;
  assert.ok(puffs >= wounds, `${puffs} puffs for ${wounds} wounds`);
  assert.ok(crowd.droplets.filter(drop => drop.layer !== 'puff').length <= Math.max(0, BLOOD_BUDGETS.low.perFrame - puffs), 'bursts take only what the cap leaves');
});

test('the governor holds streams at Pool/2.5 per second; local sprays keep half; rests shorten; puffs shrink under pressure', async () => {
  const target = BLOOD_BUDGETS.high.droplets / 2.5;
  const stream = async ({ rate, event, local = false, seconds = 3 }) => {
    const blood = await part({ camera: cameraAt(2.6, 1.55, -4.6 + 6), random: seeded(11) });
    let due = 0, shot = 0;
    for (let frame = 0; frame < seconds * 60; frame++) {
      due += rate / 60;
      for (; due >= 1; due--) { shot++; blood.hooks.impact({ ...event, shot, zombieId: null, local }); }
      blood.frame();
    }
    const window = blood.droplets.filter(drop => drop.now > seconds - 1 + 1e-9);
    return { blood, perSecond: window.length, governor: blood.handle.stats().governor };
  };
  const blast = wound({ x: 2.6, y: .95, z: -4.6, dir: [0, 0, -1], power: 225, mode: 'blast', axis: [NaN, NaN] });
  const want = plan({ damage: 225, recent: 0, headShare: 0, wounds: 1, kind: 'walker', mode: 'blast', distance: 6, carry: .5, spotCarry: .5 }).burst;
  for (const times of [2, 4.5]) {
    const { perSecond } = await stream({ rate: times * target / want, event: blast });
    assert.ok(Math.abs(perSecond / target - 1) < .1, `blasts at ${times}×: ${perSecond}/s against ${target}`);
  }
  // Bullets at twice the target, a third of it puffs (2 puffs and 4 burst droplets a wound).
  const bullet = wound({ x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], power: 4, axis: [2.6, -4.6] });
  assert.equal(plan({ damage: 4, recent: 0, headShare: 0, wounds: 1, kind: 'walker', mode: 'bullet', distance: 6, carry: .5, spotCarry: .5 }).burst, 4);
  // Under pressure (g < .5) a teammate's wound keeps one puff (3.3, review
  // round 2), so g settles near (target − 68 puffs) / 273 wanted ≈ .5.
  const bullets = await stream({ rate: 2 * target / 6, event: bullet });
  assert.ok(Math.abs(bullets.perSecond / target - 1) < .1, `bullets: ${bullets.perSecond}/s`);
  assert.ok(bullets.governor > .4 && bullets.governor < .6, `g ${bullets.governor}`);
  const pressed = bullets.blood.sprays.filter(spray => spray.now > 2 && spray.governor < SPRAY.governor.press);
  assert.ok(pressed.length > 10 && pressed.every(spray => spray.puffs === SPRAY.puffs.pressed), `one puff a wound under pressure: ${pressed.map(spray => spray.puffs).slice(0, 12)}`);
  // His own wounds keep both puffs whatever the pressure.
  const mine = await stream({ rate: 2 * target / 6, event: bullet, local: true });
  assert.ok(mine.blood.sprays.filter(spray => spray.now > 2).every(spray => spray.puffs === 2));
  // Puffs under pressure skip their rest; bursts rest shorter.
  const late = bullets.blood.droplets.filter(drop => drop.now > 2 && !drop.dropped && !drop.stuck);
  for (const drop of late.filter(item => item.layer === 'puff')) assert.ok(Math.abs(drop.end - drop.land - SPRAY.governor.pressShrink) < 1e-5, 'a puff shrinks as it lands');
  const governorOf = new Map(bullets.blood.sprays.map(spray => [spray.serial, spray.governor]));
  for (const drop of late.filter(item => item.layer !== 'puff')) {
    const rest = drop.end - drop.land - .6, range = drop.cells === 1 ? SPRAY.rest.small : SPRAY.rest.large;
    const scale = Math.max(SPRAY.governor.rest, governorOf.get(drop.spray));
    assert.ok(scale < 1 && rest >= range[0] * scale - 1e-5 && rest <= range[1] * scale + 1e-5, `rest ${rest} at g ${scale}`);
  }
  // His own stream at 4.5×: g floors at .5 for him.
  const own = await stream({ rate: 4.5 * target / want, event: blast, local: true });
  const sprays = own.blood.sprays.filter(spray => spray.now > 2);
  assert.ok(sprays.every(spray => spray.governor < .5));
  const kept = sprays.reduce((sum, spray) => sum + spray.allotted, 0) / sprays.reduce((sum, spray) => sum + spray.want, 0);
  assert.ok(kept > .45 && kept < .56, `his sprays keep ${kept}`);
  // A calm half second: his point-blank kill passes whole (only the frame cap could cut it).
  const calm = await shotPart('shotgunColossusKill', { kind: 'brute' });
  calm.frame();
  for (const event of calm.events) calm.hooks.impact(event);
  calm.run(.1);
  assert.equal(calm.sprays[0].allotted, calm.sprays[0].want);
  assert.equal(calm.droplets.length, ROWS.find(row => row.source === 'shotgunColossusKill').expect.total);
});

test('directions: the hollow cone around -u, the exit cone around e, a shell wider than a jet, the crawler\'s exit kept up, the fountain behind', async () => {
  // No camera: no camera rule bends a velocity; the open floor of the shot tool's spot.
  const throwAt = async (event, seed = 3) => {
    const blood = await part({ random: seeded(seed) });
    blood.frame();
    blood.hooks.impact(event);
    blood.run(.2);
    return blood;
  };
  // Shot toward -z (down a little): puffs and back spray come back up the open room.
  const u = norm([0, -.2, -1]), back = u.map(value => -value);
  const shot = await throwAt(wound({ x: 2.6, y: 1.3, z: -4.3, dir: u, power: 92.4, head: true, axis: [NaN, NaN] }));
  const cone = shot.droplets.filter(drop => drop.layer === 'puff' || drop.layer === 'back');
  assert.ok(cone.length >= 10);
  for (const drop of cone) {
    const off = angle([drop.vx, drop.vy - SPRAY.cone.lift, drop.vz], back);
    assert.ok(off >= 25 - 1e-6 && off <= 65 + 1e-6, `${drop.layer} ${off.toFixed(2)}° off -u`);
  }
  // It leans up: the half of the cone below the axis is squeezed (.6) toward
  // the horizontal, so fewer droplets leave steeply down (17 %) than steeply up (25 %).
  const side = norm([-back[2], 0, back[0]]), upward = norm([back[1] * side[2], back[2] * side[0] - back[0] * side[2], -back[1] * side[0]]).map((value, index, all) => all[1] < 0 ? -value : value);
  const many = await part({ random: seeded(31) });
  many.frame();
  for (let shot = 1; shot <= 400; shot++) { many.hooks.impact(wound({ x: 2.6, y: 1.3, z: -4.3, dir: u, power: 92.4, id: `lean${shot}`, shot, axis: [NaN, NaN] })); many.frame(); }
  let steepUp = 0, steepDown = 0, total = 0;
  for (const drop of many.droplets.filter(item => item.layer === 'puff' || item.layer === 'back')) {
    const v = norm([drop.vx, drop.vy - SPRAY.cone.lift, drop.vz]), across = v.map((value, index) => value - dot(v, back) * back[index]);
    const up = dot(norm(across), upward);
    total++; if (up > Math.SQRT1_2) steepUp++; else if (up < -Math.SQRT1_2) steepDown++;
  }
  assert.ok(total > 2000 && Math.abs(steepUp / total - .25) < .03 && Math.abs(steepDown / total - .172) < .03, `${steepUp / total} up, ${steepDown / total} down of ${total}`);
  // His own spray within 3 m opens sideways (review round 2, A13): 30°-65°
  // off -u, the azimuth within ±60° of the horizontal, so nothing rises over
  // the reticle to fall back through it. Droplets the camera rule slowed are
  // left out (their direction was bent toward the side by the cap).
  const own = await part({ camera: cameraAt(2.6, 1.3, -4.3 + 2.9), random: seeded(5) });
  own.frame();
  for (let shot = 1; shot <= 30; shot++) { own.hooks.impact(wound({ x: 2.6, y: 1.3, z: -4.3, dir: [0, 0, -1], power: 92.4, id: `own${shot}`, shot, axis: [NaN, NaN] })); own.frame(); }
  let sideways = 0;
  for (const drop of own.droplets.filter(item => !item.dropped && (item.layer === 'puff' || item.layer === 'back'))) {
    const cap = Math.min(.5 * Math.hypot(2.6 - drop.x, 1.3 - drop.y, -1.4 - drop.z), 3.5);
    if (drop.vz >= cap - 1e-3) continue;
    const v = [drop.vx, drop.vy - SPRAY.cone.lift, drop.vz], off = angle(v, [0, 0, 1]);
    assert.ok(off >= SPRAY.cone.nearInner - 1e-6 && off <= SPRAY.cone.outer + 1e-6, `${drop.layer} ${off.toFixed(2)}° off -u`);
    assert.ok(Math.abs(v[0]) / Math.hypot(v[0], v[1]) >= Math.cos(SPRAY.cone.nearFan * DEG) - 1e-6, `${drop.layer} leaves at ${(Math.atan2(v[1], Math.abs(v[0])) / DEG).toFixed(1)}° from the horizontal`);
    sideways++;
  }
  assert.ok(sideways >= 100, `${sideways} droplets checked`);
  const meanAngle = (blood, axis) => {
    const exit = blood.droplets.filter(drop => drop.layer === 'exit');
    const mean = norm(exit.reduce((sum, drop) => { const v = norm([drop.vx, drop.vy, drop.vz]); return [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]]; }, [0, 0, 0]));
    return { dot: dot(mean, axis), spread: exit.reduce((sum, drop) => sum + angle([drop.vx, drop.vy, drop.vz], axis), 0) / exit.length, mean };
  };
  const forward = norm([0, 0, 1]);
  const shell = await part({ random: seeded(8) }), jet = await throwAt(wound({ x: 2.6, y: 1.1, z: -4.3, dir: forward, power: 770, axis: [NaN, NaN] }), 8);
  shell.frame();
  for (let pellet = 0; pellet < 9; pellet++) shell.hooks.impact(wound({ x: 2.6 + (pellet - 4) * .03, y: 1.1, z: -4.3, dir: forward, power: 42.2, axis: [NaN, NaN] }));
  shell.run(.2);
  const wide = meanAngle(shell, forward), thin = meanAngle(jet, forward);
  assert.ok(wide.dot >= .8 && thin.dot >= .8, `${wide.dot} ${thin.dot}`);
  assert.ok(wide.spread > thin.spread * 2, `shell ${wide.spread.toFixed(1)}° against jet ${thin.spread.toFixed(1)}°`);
  // A crawler shot from above at 1.2 m: the exit skids out at -15°, not into the floor.
  const down = norm([0, -Math.tan(40 * DEG), 1]);
  const crawler = await throwAt(wound({ x: 2.6, y: .5, z: -4.3, dir: down, power: 92.8, kind: 'crawler', axis: [NaN, NaN] }), 6);
  const skid = meanAngle(crawler, forward);
  assert.ok(Math.asin(skid.mean[1]) / DEG >= -15, `exit pitch ${(Math.asin(skid.mean[1]) / DEG).toFixed(1)}°`);
  // The fountain leans out of the back of the head; a kill spray has none.
  const head = await throwAt(wound({ x: 2.6, y: 1.68, z: -4.3, dir: forward, power: 770, head: true, axis: [NaN, NaN] }), 9);
  const fountain = head.droplets.filter(drop => drop.layer === 'fountain');
  assert.ok(fountain.length > 0);
  assert.ok(fountain.every(drop => drop.vz > 0 && drop.vy > 1.4), 'out of the back, rising');
  const killed = await throwAt(wound({ x: 2.6, y: 1.68, z: -4.3, dir: forward, power: 770, head: true, kill: true, axis: [NaN, NaN] }), 9);
  assert.ok(!killed.droplets.some(drop => drop.layer === 'fountain'));
  assert.ok(killed.droplets.some(drop => drop.layer === 'kill'));
});

test('the camera rule: no arc within .45 m of the camera, no approach over min(.5·dist, 3.5) m/s, for every shooter and layer', async () => {
  const feet = [2.6, 0, -4.6];
  const melee = (distance, power, kind = 'walker', height = 1.1) => {
    const scale = SCALES[kind] ?? 1;
    return { camera: [feet[0], 1.55, feet[2] + distance], events: [wound({ x: feet[0], y: height * scale, z: feet[2] + .32 * scale, dir: [0, 0, -1], power, kill: true,
      mode: 'melee', kind, axis: [feet[0], feet[2]] })] };
  };
  const cases = {
    S5: { name: 'shotgunColossusHead', kind: 'brute' },
    S6: { name: 'shotgunColossusKill', kind: 'brute' },
    'sniper head kill, walker at 1.2 m': (() => {
      const point = [feet[0], 1.68, feet[2] + .32], eye = [feet[0], 1.55, feet[2] + 1.2];
      return { camera: eye, events: [wound({ x: point[0], y: point[1], z: point[2], dir: [0, point[1] - eye[1], point[2] - eye[2]], power: 770, head: true, kill: true, axis: [feet[0], feet[2]] })] };
    })(),
    'hammer heavy kill, colossus': melee(1.5, 900, 'brute'),
    'katana heavy kill, walker': melee(1.3, 504),
    'bat kill at 1 m': melee(1, 200),
    'crawler melee kill': melee(1, 120, 'crawler', .5),
    // His point-blank kill on low, looking up at the head as he aims: the back
    // spray falling past the frame's lower corners (review round 2, A13).
    'S6 on low, looking up': { name: 'shotgunColossusKill', kind: 'brute', quality: 'low', pitch: .35, seeds: 8 },
    // A teammate fires from 3 m behind a walker standing .8 m in front of the local camera: his exit spray comes at it.
    'teammate from 3 m, walker .8 m from the camera': { camera: [feet[0], 1.55, feet[2] + .8], events:
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map(pellet => wound({ x: feet[0] + (pellet - 4) * .04, y: 1.1 + (pellet % 3) * .1, z: feet[2] - .32, dir: [0, 0, 1], power: 36.7, id: 'mate', local: false, axis: [feet[0], feet[2]] })) },
  };
  let corner = 0;
  for (const [label, scenario] of Object.entries(cases)) for (let seed = 1; seed <= (scenario.seeds ?? 3); seed++) {
    let blood, camera;
    if (scenario.name) {
      blood = await shotPart(scenario.name, { kind: scenario.kind, random: spread(seed), quality: scenario.quality ?? 'high' }); camera = blood.camera;
      if (scenario.pitch) { camera.rotation.set(scenario.pitch, 0, 0, 'YXZ'); camera.updateMatrixWorld(true); }
    } else { camera = cameraAt(...scenario.camera); blood = await part({ camera, random: spread(seed) }); }
    blood.frame();
    for (const event of scenario.events ?? blood.events) blood.hooks.impact(event);
    blood.run(1.5);
    const thrown = blood.droplets.filter(drop => !drop.dropped);
    assert.ok(thrown.length > 10, `${label}: ${thrown.length}`);
    for (const drop of thrown) {
      const gap = arcGap(drop, camera), { speed, cap } = approach(drop, camera);
      assert.ok(gap >= .45 - 1e-6, `${label} seed ${seed}: a ${drop.layer} droplet passes ${gap.toFixed(3)} m from the camera`);
      assert.ok(speed <= cap + 1e-6, `${label} seed ${seed}: ${drop.layer} comes at ${speed.toFixed(2)} m/s, cap ${cap.toFixed(2)}`);
      if (gap < 1.2) assert.equal(drop.cells, 1, `${label}: a ${drop.cells}-cell droplet passes ${gap.toFixed(2)} m from the camera`);
      // By size on screen too (A13): a cube at most 40 px, 30 px for 2 cells (1080p).
      const px = screenPx(drop, camera);
      assert.ok(px <= (drop.cells === 1 ? SPRAY.eye.screen.one : SPRAY.eye.screen.two) + .5, `${label} seed ${seed}: a ${drop.cells}-cell ${drop.layer} droplet reaches ${px.toFixed(1)} px`);
    }
    if (scenario.pitch) corner += blood.droplets.filter(drop => drop.dropped && drop.closest >= .45).length;
    assert.ok(blood.handle.stats().closest >= .45);
  }
});

test('the inset: a wound on the hitbox face starts on the drawn skin, by kind and height over the feet, the head its own; none without an axis', async () => {
  const centre = async (event, snapshot = null, camera = cameraAt(2.6, 1.55, -1.6)) => {
    const blood = await part({ camera });
    blood.frame(1 / 60, snapshot ? { snapshot } : {});
    blood.hooks.impact(event);
    blood.run(.05);
    return blood.sprays[0];
  };
  const table = SPRAY.inset;
  // Unknown feet (no snapshot): the torso's skin of the kind; a head hit the head's.
  for (const [kind, scale, boss] of [['walker', 1, false], ['armored', 1, false], ['crawler', 1, false], ['brute', 1.22, false], ['brute', 1.32, true]]) {
    const face = -4.6 + table.max * scale, entry = boss ? table.boss : table[kind];
    const body = await centre(wound({ x: 2.6, y: .6 * scale, z: face, dir: [0, -.1, -1], power: 30, kind, boss, scale, axis: [2.6, -4.6] }));
    assert.ok(Math.abs(body.bodyZ - (-4.6 + Math.min(entry.body, table.max) * scale)) < .001, `${kind}${boss ? ' (boss)' : ''} body ${body.bodyZ}`);
    const head = await centre(wound({ x: 2.6, y: 1.68 * scale, z: face, dir: [0, 0, -1], power: 66, head: true, kind, boss, scale, axis: [2.6, -4.6] }));
    assert.ok(Math.abs(head.headZ - (-4.6 + entry.head * scale)) < .001, `${kind} head ${head.headZ}`);
  }
  // With the body in the snapshot, the hit's height picks the skin: a walker's
  // shin, its chest, a colossus's plate (the blocker of review round 2: the
  // blood starts on the plate, not 10 cm inside it).
  const feetY = .4;
  for (const [kind, scale, share, expected] of [['walker', 1, .3, .065], ['walker', 1, .6, .145], ['walker', 1, .64, .1525], ['brute', 1.22, .3, .07],
    ['brute', 1.22, .65, .265], ['brute', 1.22, .52, .1825], ['crawler', 1, .5, .2]]) {
    const tall = (kind === 'crawler' ? table.heights.crawler : table.heights.standing) * scale, y = feetY + share * tall;
    assert.ok(Math.abs(skinRadius(kind, false, share, false) - expected) < 1e-9, `skinRadius ${kind} ${share}`);
    const snapshot = { zombies: [{ id: 'z1', kind, x: 2.6, y: feetY, z: -4.6, scale }] };
    const body = await centre(wound({ x: 2.6, y, z: -4.6 + table.max * scale, dir: [0, 0, -1], power: 30, kind, scale, axis: [2.6, -4.6] }), snapshot);
    assert.ok(Math.abs(body.bodyZ - (-4.6 + expected * scale)) < .001, `${kind} at ${share} of its height: ${body.bodyZ} against ${-4.6 + expected * scale}`);
  }
  // Seen at an angle the move is along the shot: horizontally the inset.
  const slant = norm([-.5, 0, -1]), start = [2.6, 1.1, -4.6 + .32];
  const angled = await centre(wound({ x: start[0], y: start[1], z: start[2], dir: slant, power: 30, axis: [2.6, -4.6] }));
  const a = ((2.6 - start[0]) * slant[0] + (-4.6 - start[2]) * slant[2]) / Math.hypot(slant[0], slant[2]), move = Math.max(0, a - table.walker.body);
  assert.ok(Math.abs(angled.bodyX - (start[0] + slant[0] * move)) < 1e-6 && Math.abs(angled.bodyZ - (start[2] + slant[2] * move)) < 1e-6);
  const loose = await centre(wound({ x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], power: 30, axis: [NaN, NaN] }));
  assert.equal(loose.bodyZ, -4.28, 'no axis, no inset');
  // The exit spray leaves from the far side of the body at its skin (centre + e·2r): a colossus's chest 2 × .265 × 1.22 on.
  const blood = await part({ camera: cameraAt(2.6, 1.55, -3.4) });
  blood.frame(1 / 60, { snapshot: { zombies: [{ id: 'z1', kind: 'brute', x: 2.6, y: 0, z: -4.6, scale: 1.22 }] } });
  blood.hooks.impact(wound({ x: 2.6, y: .65 * 1.82 * 1.22, z: -4.6 + .32 * 1.22, dir: [0, 0, -1], power: 42, kind: 'brute', axis: [2.6, -4.6] }));
  blood.run(.2);
  const exits = blood.droplets.filter(drop => drop.layer === 'exit');
  assert.ok(exits.length > 0 && exits.every(drop => Math.abs(drop.z - (-4.6 + .265 * 1.22 - 2 * .265 * 1.22)) < 1e-6), `exit from ${exits[0]?.z}`);
  // A blast wound starts on the far side's skin from the blast, at the chest (not the belt).
  const blast = await part({ camera: cameraAt(2.6, 1.55, -1.6) });
  blast.frame();
  blast.hooks.impact(wound({ x: 2.6, y: .935, z: -4.6, dir: [0, 0, -1], power: 450, mode: 'blast', axis: [2.6, -4.6] }));
  blast.run(.2);
  const from = blast.droplets.filter(drop => drop.layer === 'exit');
  assert.ok(from.length > 0 && from.every(drop => Math.abs(drop.z - (-4.6 - table.walker.body)) < 1e-6 && Math.abs(drop.y - (.935 + SPRAY.blastOrigin.lift)) < 1e-6),
    `blast exit from (${from[0]?.y}, ${from[0]?.z})`);
});

test('sub-bursts: a shell split between head and body bleeds from both centres, never between them', async () => {
  const wounds = shotWounds('shotgunColossusMixed'), heads = wounds.filter(item => item.head).length;
  assert.ok(heads >= 2 && wounds.length - heads >= 2, `${heads} head and ${wounds.length - heads} body pellets`);
  const blood = await shotPart('shotgunColossusMixed', { kind: 'brute', random: seeded(13) });
  blood.frame();
  for (const event of blood.events) blood.hooks.impact(event);
  blood.run(.1);
  const spray = blood.sprays[0];
  assert.ok(spray.headShare >= .2 && spray.headShare <= .8);
  const u = norm(blood.events.reduce((sum, event) => [sum[0] + event.damage * event.dirX, sum[1] + event.damage * event.dirY, sum[2] + event.damage * event.dirZ], [0, 0, 0]));
  const from = centre => [centre[0] - u[0] * .03, centre[1] - u[1] * .03, centre[2] - u[2] * .03];
  const head = from([spray.headX, spray.headY, spray.headZ]), body = from([spray.bodyX, spray.bodyY, spray.bodyZ]);
  assert.ok(head[1] - body[1] > .05, 'the head centre sits above the body centre');
  let atHead = 0, atBody = 0;
  for (const drop of blood.droplets.filter(item => item.layer === 'back')) {
    const near = centre => Math.hypot(drop.x - centre[0], drop.y - centre[1], drop.z - centre[2]) < 1e-4;
    if (near(head)) atHead++; else if (near(body)) atBody++;
    else assert.fail(`a back droplet from (${drop.x}, ${drop.y}, ${drop.z}), between the centres`);
  }
  assert.ok(atHead > 0 && atBody > 0, `${atHead} from the head, ${atBody} from the body`);
  assert.ok(Math.abs(atHead / (atHead + atBody) - spray.headShare) < .15);
});

test('floor pixels: on the grid, whole on one surface, within the spray\'s spots and layer shares, from the landing for 15-30 s', async () => {
  const lift = .004, grid = .025;
  for (let seed = 1; seed <= 4; seed++) {
    const blood = await shotPart('shotgunColossusKill', { kind: 'brute', random: spread(seed) });
    blood.frame();
    for (const event of blood.events) blood.hooks.impact(event);
    const spray = () => blood.sprays[0];
    let previous = 0;
    for (let frame = 0; frame < 120; frame++) {
      blood.frame();
      if (!spray()) continue;
      const floor = shown(blood.meshes.spots).filter(spot => spot.face === 0).length;
      const landed = blood.droplets.filter(drop => drop.spot && !drop.stuck && drop.start + drop.land <= blood.clock.now + 1e-6).length;
      assert.ok(floor <= landed, `seed ${seed}: ${floor} floor pixels before ${landed} droplets landed`);
      previous = floor;
    }
    assert.ok(previous > 0);
    const spotted = blood.droplets.filter(drop => drop.spot), total = spray().spots;
    assert.ok(spotted.length <= total, `${spotted.length} pixels for ${total} spots`);
    const by = layer => spotted.filter(drop => drop.layer === layer).length;
    assert.ok(by('back') <= Math.round(.3 * total) && by('kill') + by('fountain') <= Math.round(.2 * total) && by('puff') === 0);
    for (const spot of shown(blood.meshes.spots).filter(item => item.face === 0)) {
      const cells = Math.round(spot.size / grid);
      assert.ok([1, 2, 3].includes(cells));
      const offset = cells % 2 ? .5 : 0;
      for (const value of [spot.x, spot.z]) assert.ok(Math.abs(value / grid - offset - Math.round(value / grid - offset)) < 1e-3, `off the grid: ${value} (${cells} cells)`);
      assert.ok(squareRests(spot.x, spot.z, spot.size / 2, spot.y - lift), `(${spot.x}, ${spot.y}, ${spot.z}) hangs off its surface`);
      assert.ok(colourOf(blood.meshes.spots, spot.index) >= 1, 'never the darkest red: it would vanish in the floor\'s stains');
    }
    blood.run(13);
    assert.ok(shown(blood.meshes.spots).length > 0, 'still there after 15 s');
    blood.run(18);
    assert.equal(shown(blood.meshes.spots).length, 0, 'gone after 30 s');
    assert.equal(blood.meshes.spots.visible, false);
  }
  // The same cell twice darkens it a step, never below index 1.
  const still = await part({ camera: cameraAt(2.6, 1.55, -1.6), random: () => .5 });
  still.frame();
  for (let shot = 1; shot <= 6; shot++) still.hooks.impact(wound({ x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], power: 120, axis: [2.6, -4.6], id: `same${shot}`, shot }));
  still.run(2);
  const spots = shown(still.meshes.spots), colours = spots.map(spot => colourOf(still.meshes.spots, spot.index));
  assert.ok(spots.length > 0 && spots.length < still.droplets.filter(drop => drop.spot).length, 'pixels on one cell merged');
  assert.ok(colours.every(colour => colour >= 1) && colours.includes(1), JSON.stringify(colours));
});

test('wall pixels: 8 mm off the face, inside it, never in an open window, never through; drips below in their colour', async () => {
  const partition = ARC_SOLIDS.find(solid => solid.top === 3.05 && solid.minX <= 0 && solid.maxX >= 0);
  assert.ok(partition, 'the partition behind the living room');
  let stuck = 0, drips = 0, atFoot = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const camera = cameraAt(0, 1.55, partition.maxZ + 2.4);
    const blood = await part({ camera, random: spread(seed) });
    blood.frame();
    // A point-blank shell into a colossus .6 m in front of the wall.
    for (let pellet = 0; pellet < 9; pellet++) {
      blood.hooks.impact(wound({ x: (pellet - 4) * .05, y: 1.3 + (pellet % 3) * .12, z: partition.maxZ + .6 + .39, dir: [(pellet - 4) * .02, -.05, -1], power: 92.8,
        head: pellet % 2 === 0, kind: 'brute', axis: [0, partition.maxZ + .6], id: 'wall', shot: 1 }));
    }
    for (let frame = 0; frame < 120; frame++) {
      blood.frame();
      for (const drop of shown(blood.meshes.droplets)) assert.ok(drop.z - drop.size / 2 >= partition.maxZ - 1e-4, `seed ${seed}: a droplet in the wall at z ${drop.z}`);
    }
    const walls = shown(blood.meshes.spots).filter(spot => spot.face !== 0);
    for (const spot of walls) {
      assert.equal(spot.face, 3, 'the partition\'s +z face');
      assert.ok(Math.abs(spot.z - (partition.maxZ + .008)) < 1e-5, `8 mm off the face: ${spot.z}`);
      assert.ok(spot.x - spot.size / 2 >= partition.minX - 1e-6 && spot.x + spot.size / 2 <= partition.maxX + 1e-6);
      assert.ok(spot.y - spot.size / 2 >= partition.bottom - 1e-6 && spot.y + spot.size / 2 <= partition.top + 1e-6);
    }
    const big = walls.filter(spot => spot.size > .03);
    stuck += big.length;
    for (const spot of walls.filter(item => item.size < .03)) {
      const above = walls.find(item => item.size > .03 && Math.abs(item.x - spot.x) < 1e-6 && item.y > spot.y);
      if (!above) continue;
      drips++;
      assert.equal(colourOf(blood.meshes.spots, spot.index), colourOf(blood.meshes.spots, above.index), 'a drip in its pixel\'s colour');
      assert.ok(Math.abs((above.y - above.size / 2 - (spot.y + .0125)) / .025 - Math.round((above.y - above.size / 2 - (spot.y + .0125)) / .025)) < 1e-3, 'a cell lower each');
      assert.ok(spot.y - .0125 >= restingSurface(spot.x, spot.z, spot.y) + .02 - 1e-6);
    }
    atFoot += blood.droplets.filter(drop => !drop.stuck && !drop.dropped && drop.z + drop.vz * drop.time <= partition.maxZ + .05).length;
  }
  assert.ok(stuck >= 6 && drips >= 1 && atFoot >= 1, `${stuck} stuck, ${drips} drips, ${atFoot} at the foot`);
  // The north wall's glassless window: blood flies through or drops, it never hangs there.
  const window = OPEN_WINDOWS.find(item => item.wall === 'north'), face = window.fixed + .135;
  let reached = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const camera = cameraAt(window.center, 1.55, -3);
    const blood = await part({ camera, random: spread(seed) });
    blood.frame();
    for (let pellet = 0; pellet < 9; pellet++) {
      blood.hooks.impact(wound({ x: window.center + (pellet - 4) * .05, y: 1.75 + (pellet % 3) * .1, z: -5.1, dir: [0, .05, -1], power: 92.8, head: true,
        kind: 'brute', axis: [window.center, -5.4], id: 'window', shot: 1 }));
    }
    blood.run(2);
    for (const spot of shown(blood.meshes.spots)) assert.ok(!openWindowAt(spot.x, spot.y, spot.z), `seed ${seed}: a pixel in the open window`);
    // A droplet may stick on the wall under the sill or beside the frame, never in the window.
    for (const drop of blood.droplets.filter(item => item.stuck)) {
      const t = drop.time, x = drop.x + drop.vx * t, y = drop.y + drop.vy * t - 4.5 * t * t, z = drop.z + drop.vz * t;
      assert.ok(!openWindowAt(x, y, z), `seed ${seed}: a droplet stuck in the open window at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
    }
    reached += blood.droplets.filter(drop => !drop.dropped && drop.z + drop.vz * drop.time < face + .05 && drop.cells >= 2).length;
  }
  assert.ok(reached >= 10, `${reached} big droplets reached the window`);
});

test('colours by layer: each layer\'s palette weights within 5 %', async () => {
  const counts = Object.fromEntries(BLOOD_LAYERS.map(layer => [layer, [0, 0, 0, 0]]));
  const blood = await part({ random: seeded(21) });
  blood.frame();
  for (let shot = 1; shot <= 500; shot++) {
    for (let pellet = 0; pellet < 9; pellet++) {
      blood.hooks.impact(wound({ x: 2.6 + (pellet - 4) * .03, y: 1.68, z: -4.3, dir: [0, 0, 1], power: 92.8, head: true, kill: shot % 2 === 0, id: `c${shot}`, shot, axis: [NaN, NaN] }));
    }
    blood.run(.05);
  }
  for (const drop of blood.droplets) counts[drop.layer][drop.colour]++;
  for (const layer of BLOOD_LAYERS) {
    const total = counts[layer].reduce((sum, count) => sum + count, 0);
    assert.ok(total >= 700, `${layer}: ${total}`);
    SPRAY.colours[layer].forEach((weight, colour) => assert.ok(Math.abs(counts[layer][colour] / total - weight) < .05, `${layer} colour ${colour}: ${counts[layer][colour] / total}`));
  }
});

test('raiders never bleed: an id seen as a raider, or a point beside a snapshot raider', async () => {
  const camera = cameraAt(0, 1.55, 3);
  const blood = await part({ camera });
  const snapshot = { zombies: [{ id: 'r1', x: 2, y: 0, z: 3, kind: 'raider', height: 1.8 }, { id: 'z1', x: -2, y: 0, z: 3, kind: 'walker', height: 1.82 }] };
  blood.frame(1 / 60, { snapshot });
  blood.hooks.impact(wound({ x: 2, y: 1.2, z: 2.7, dir: [0, 0, -1], power: 92.8, id: 'r1' }));
  blood.hooks.impact({ ...wound({ x: 2.1, y: 1.3, z: 3.2, dir: [1, 0, 0], power: 30 }), zombieId: null });
  blood.run(.5);
  assert.equal(blood.droplets.length + blood.sprays.length, 0);
  blood.hooks.impact(wound({ x: -2, y: 1.2, z: 2.7, dir: [0, 0, -1], power: 30, id: 'z1' }));
  blood.run(.1);
  assert.ok(blood.droplets.length > 0, 'a zombie beside them still bleeds');
});

test('past half the frame cap, his own due wounds keep both puffs before nearer teammates\' wounds, which keep one each', async () => {
  const camera = cameraAt(2.6, 1.55, 2);
  const blood = await part({ camera, random: seeded(21) });
  blood.frame();
  // 40 teammate wounds 2-3 m off, 40 of his own 5-6 m off, all due on the same frame.
  for (let index = 0; index < 80; index++) {
    const local = index >= 40, far = local ? 5 + (index - 40) * .025 : 2 + index * .025;
    blood.hooks.impact(wound({ x: 2.6 + (index % 5 - 2) * .1, y: 1.1, z: 2 - far, dir: [0, 0, -1], power: 25, id: `cap${index}`, local, axis: [NaN, NaN] }));
  }
  blood.frame();
  const localOf = new Map(blood.sprays.map(spray => [spray.serial, spray.local]));
  const puffs = new Map();
  for (const drop of blood.droplets.filter(item => item.layer === 'puff')) puffs.set(drop.spray, (puffs.get(drop.spray) ?? 0) + 1);
  const mine = [...puffs].filter(([serial]) => localOf.get(serial) === true).map(([, count]) => count);
  const theirs = [...puffs].filter(([serial]) => localOf.get(serial) === false).map(([, count]) => count);
  assert.equal(mine.length, 40); assert.equal(theirs.length, 40);
  const half = BLOOD_BUDGETS.high.perFrame >> 1;
  assert.equal(mine.filter(count => count === 2).length, half / 2, 'his first 32 wounds fill the half cap with 2 puffs each');
  assert.ok(mine.every(count => count >= 1) && theirs.every(count => count === 1), `mine ${mine}, theirs ${theirs}`);
});

test('a droplet\'s first 40 ms run at double speed along its arc; after that, at its own pace', async () => {
  const blood = await part({ random: seeded(4) });
  blood.frame();
  blood.hooks.impact(wound({ x: 2.6, y: 1.2, z: -3.4, dir: [0, 0, -1], power: 30, axis: [NaN, NaN] }));
  blood.frame();
  const thrownAt = blood.clock.now;
  const at = (drop, age) => { const warped = age + Math.min(age, SPRAY.snap); return [drop.x + drop.vx * warped, drop.y + drop.vy * warped - 4.5 * warped * warped, drop.z + drop.vz * warped]; };
  for (const frames of [1, 2, 4]) {
    blood.frame();
    const now = blood.clock.now, drawn = shown(blood.meshes.droplets);
    let checked = 0;
    for (const drop of blood.droplets.filter(item => !item.dropped && item.start <= now && now - item.start < item.land)) {
      const age = now - drop.start, [x, y, z] = at(drop, age), size = drop.cells * .025;
      assert.ok(drawn.some(item => Math.abs(item.x - x) < 1e-5 && Math.abs(item.y - y) < 1e-5 && Math.abs(item.z - z) < 1e-5 && Math.abs(item.size - size) < 1e-6),
        `${drop.layer} at age ${age.toFixed(3)} s not drawn at its warped arc point`);
      checked++;
    }
    assert.ok(checked >= 5 || frames > 1, `${checked} droplets checked ${(now - thrownAt).toFixed(3)} s after the throw`);
  }
});

test('under the torch: a droplet thrown near the camera takes its palette colour × max(.4, distance / 2.6), farther ones the palette itself', async () => {
  const palette = BLOOD_PALETTE.map(hex => new THREE.Color().setHex(hex));
  for (const [distance, factor] of [[1.2, 1.2 / SPRAY.torch.full], [.9, SPRAY.torch.floor], [4, 1]]) {
    const blood = await part({ camera: cameraAt(2.6, 1.2, -4.3 + .18 + distance), random: seeded(17) });
    blood.frame();
    blood.hooks.impact(wound({ x: 2.6, y: 1.2, z: -4.3 + .32, dir: [0, 0, -1], power: 30, axis: [2.6, -4.3] }));
    blood.frame();
    const colours = blood.meshes.droplets.instanceColor.array, drawn = shown(blood.meshes.droplets);
    assert.ok(drawn.length >= 4, `${drawn.length} droplets`);
    for (const { index } of drawn) {
      const [r, g, b] = [colours[index * 3], colours[index * 3 + 1], colours[index * 3 + 2]];
      const match = palette.find(colour => Math.abs(r / colour.r - g / colour.g) < 1e-3 && Math.abs(r / colour.r - b / colour.b) < 1e-3);
      assert.ok(match, `a palette colour, scaled: ${r} ${g} ${b}`);
      assert.ok(Math.abs(r / match.r - factor) < .03, `at ${distance} m: × ${(r / match.r).toFixed(3)} against ${factor.toFixed(3)}`);
    }
  }
});

test('a melee blow splashes from where it lands, wide and slower; a bullet\'s exit leaves by the body\'s far side', async () => {
  const blood = await part({ random: seeded(23) });
  blood.frame();
  blood.hooks.impact(wound({ x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], power: 900, mode: 'melee', weapon: 'hammer', kind: 'brute', axis: [2.6, -4.6], id: 'm1' }));
  blood.hooks.impact(wound({ x: 2.6, y: 1.1, z: -4.28, dir: [0, 0, -1], power: 900, weapon: 'magnum', kind: 'brute', axis: [2.6, -4.6], id: 'b1' }));
  blood.run(.2);
  const [blow, bullet] = ['m1', 'b1'].map(id => blood.sprays.find(spray => spray.id === id));
  assert.deepEqual([blow.theta, bullet.theta], [SPRAY.exit.melee.angle, SPRAY.exit.jet.angle]);
  assert.ok(blow.vmax < bullet.vmax * .7, `${blow.vmax} against ${bullet.vmax}`);
  const exitOf = spray => blood.droplets.filter(drop => drop.spray === spray.serial && drop.layer === 'exit');
  assert.ok(exitOf(blow).length > 5 && exitOf(blow).every(drop => Math.abs(drop.z - blow.bodyZ) < 1e-6), 'the blow\'s exit from the wound');
  const far = bullet.bodyZ - 2 * SPRAY.inset.brute.body * 1.22;
  assert.ok(exitOf(bullet).length > 5 && exitOf(bullet).every(drop => Math.abs(drop.z - far) < 1e-6), 'the bullet\'s from the far side');
});

test('a blast or a legacy call that the formulas round to nothing still throws one burst droplet within 35 m (A1)', () => {
  for (const mode of ['blast', 'legacy']) for (const preset of PRESETS) {
    const result = plan({ damage: .5, recent: 0, headShare: 0, wounds: 1, kind: 'crawler', boss: false, mode, kill: false, killDone: false, distance: 30, local: false, carry: .5, spotCarry: .5 }, preset);
    assert.equal(result.puffsPerWound, 0, mode);
    assert.equal(result.burst, 1, `${mode} at 30 m, ${preset}`);
    assert.equal(plan({ damage: .5, recent: 0, headShare: 0, wounds: 1, kind: 'crawler', boss: false, mode, kill: false, killDone: false, distance: 36, local: false, carry: .5, spotCarry: .5 }, preset).burst, 0, 'nothing past 35 m');
  }
});

test('an x-facing wall: pixels 8 mm off the east wall\'s inner face, each a palette step darker than its droplet (never below index 1)', async () => {
  const east = ARC_SOLIDS.find(solid => solid.minX === 7.865 && solid.minZ === 1.3);
  assert.ok(east, 'the east wall south of the door');
  let stuck = 0, compared = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const camera = cameraAt(5.4, 1.55, 3.5);
    const blood = await part({ camera, random: spread(seed) });
    blood.frame();
    // A point-blank shell into a colossus .6 m in front of the wall, fired toward +x.
    for (let pellet = 0; pellet < 9; pellet++) {
      blood.hooks.impact(wound({ x: east.minX - .6 - .39, y: 1.3 + (pellet % 3) * .12, z: 3.5 + (pellet - 4) * .05, dir: [1, -.05, (pellet - 4) * .02], power: 92.8,
        head: pellet % 2 === 0, kind: 'brute', axis: [east.minX - .6, 3.5], id: 'east', shot: 1 }));
    }
    blood.run(2);
    const walls = shown(blood.meshes.spots).filter(spot => spot.face !== 0);
    for (const spot of walls) {
      assert.equal(spot.face, 2, 'the wall\'s -x face');
      assert.ok(Math.abs(spot.x - (east.minX - .008)) < 1e-5, `8 mm off the face: ${spot.x}`);
      assert.ok(spot.z - spot.size / 2 >= east.minZ - 1e-6 && spot.z + spot.size / 2 <= east.maxZ + 1e-6);
    }
    const drops = blood.droplets.filter(drop => drop.stuck), big = walls.filter(spot => spot.size > .03);
    stuck += drops.length;
    if (drops.length && drops.length === big.length) {
      const expected = drops.map(drop => Math.max(SPRAY.spots.minColour, drop.colour - 1)).sort(), got = big.map(spot => colourOf(blood.meshes.spots, spot.index)).sort();
      assert.deepEqual(got, expected, `seed ${seed}: wall pixel colours`);
      compared++;
    }
  }
  assert.ok(stuck >= 4 && compared >= 2, `${stuck} stuck, ${compared} seeds compared`);
});

test('rings: 64 zombies keep their own damage; a full spray table flushes its farthest; a full pending ring throws the oldest puffs', async () => {
  const camera = cameraAt(0, 1.55, 4);
  const blood = await part({ camera });
  blood.frame();
  const hit = (index, shot) => blood.hooks.impact(wound({ x: -6 + (index % 16) * .8, y: 1.1, z: -2.5 - Math.floor(index / 16) * .8, dir: [0, 0, -1], power: 100, id: `z${index}`, shot, axis: [NaN, NaN] }));
  for (let index = 0; index < 64; index++) hit(index, 1);
  blood.frame();
  for (let index = 0; index < 64; index++) hit(index, 2);
  blood.frame();
  const second = blood.sprays.slice(64);
  assert.equal(second.length, 64);
  for (const spray of second) assert.ok(Math.abs(spray.recent - 100 * Math.exp(-1 / 60 / SPRAY.recent)) < 1e-6, `${spray.id}: A ${spray.recent}`);
  // A 65th open spray: the farthest one bleeds at once.
  const table = await part({ camera });
  table.frame();
  for (let index = 0; index < 64; index++) table.hooks.impact(wound({ x: -2 + (index % 8) * .5, y: 1.1, z: 3 - Math.floor(index / 8) * 1.1, dir: [0, 0, -1], power: 30, id: `t${index}`, delay: 1, axis: [NaN, NaN] }));
  assert.equal(table.sprays.length, 0);
  table.hooks.impact(wound({ x: 0, y: 1.1, z: 2, dir: [0, 0, -1], power: 30, id: 't64', delay: 1, axis: [NaN, NaN] }));
  assert.equal(table.sprays.length, 1);
  assert.equal(table.sprays[0].id, 't56', 'the farthest open spray');
  assert.equal(table.handle.stats().sprays, 64);
  // 29 shells pending (261 wounds): the oldest wounds throw their puffs at once.
  const ring = await part({ camera });
  ring.frame();
  let wounds = 0;
  for (let index = 0; index < 29; index++) {
    for (let pellet = 0; pellet < 9; pellet++, wounds++) {
      ring.hooks.impact(wound({ x: -2 + (index % 8) * .5, y: 1.1, z: 2 - Math.floor(index / 8), dir: [0, 0, -1], power: 30, id: `p${index}`, shot: 1, delay: 2, axis: [NaN, NaN] }));
    }
  }
  assert.equal(wounds, 261);
  assert.equal(ring.handle.stats().pending, 256);
  assert.equal(ring.droplets.filter(drop => drop.layer === 'puff').length, 5 * 2, 'five oldest wounds threw their two puffs');
});

test('nothing is allocated per hit or per frame: zero minor collections with a 1 MB young generation, full tables included', () => {
  const child = fileURLToPath(new URL('./helpers/blood-gc-child.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--max-semi-space-size=1', '--expose-gc', child], { encoding: 'utf8', timeout: 240000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.ok(report.calls >= 100000 && report.frames >= 6000 && report.lightFrames >= 30000, JSON.stringify(report));
  assert.ok(report.full.flushed > 100 && report.full.pending > 100, `the floods filled the spray table and the pending ring: ${JSON.stringify(report.full)}`);
  assert.ok(report.thrown > 100000, `only ${report.thrown} droplets thrown`);
  assert.equal(report.minor, 0, `minor collections: ${JSON.stringify(report)}`);
});

test('current Frisson shots preserve recorded wound geometry and owners while finite energy determines power and real deaths', async () => {
  const { RoomSimulation, WEAPONS, damageFalloff } = await import('../simulation.mjs');
  const { enemyDamageMultiplier } = await import('../public/enemies.js');
  const { settleBallisticFlight } = await import('./helpers/ballistic-flight.mjs');
  const { ballisticShotView } = await import('./helpers/ballistic-wounds.mjs');
  const record = (weapon, targets, pitch, shooterZ = 4) => {
    const events = [];
    let s = 7;
    const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const sim = new RoomSimulation('BLOOD', { random, onEvent: event => events.push(event), ambiance: 'frisson' });
    const player = sim.addPlayer('a', 'A', weapon); sim.start('a');
    player.weapon = weapon; player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
    Object.assign(player, { x: -4.4, y: 0, z: shooterZ, yaw: 0, pitch: 0, minigunSpinning: true, minigunSpinUntil: -1 });
    for (const [id, target, distance] of targets) {
      sim.zombies.set(id, { id, x: -4.4, y: 0, z: player.z - distance, hp: 1000, maxHp: 1000, kind: 'walker', scale: target.kind === 'brute' ? 1.22 : 1, ...target });
    }
    player.pitch = pitch; assert.equal(sim.shoot('a'), true);
    const launch = events.find(event => event.event === 'shot');
    assert.equal(launch.ballistic, true); assert.ok(!events.some(event => event.event === 'bullet-impact'), 'no contact at launch');
    settleBallisticFlight(sim);
    const shot = ballisticShotView(events, launch);
    assert.ok(shot, 'a real authoritative shot exists'); assert.equal(shot.id, 'a');
    return { eye: [shot.x, shot.y, shot.z].map(value => Math.round(value * 1000) / 1000), pellets: shot.pellets.map(pellet => [pellet.yaw, pellet.pitch, pellet.distance, pellet.stop, pellet.wounds ?? []]),
      shot: launch, events, headshotMultiplier: sim.currentWaveBalance().headshotMultiplier };
  };
  const T = (target, distance) => [['T', target, distance]];
  const scenarios = {
    pistolBody3: ['pistol', T({ hp: 400, maxHp: 400 }, 3), -.05], pistolHead3: ['pistol', T({ hp: 400, maxHp: 400 }, 3), .03],
    pistolBody10: ['pistol', T({ hp: 400, maxHp: 400 }, 10), -.06], rifleBody6: ['rifle', T({ hp: 400, maxHp: 400 }, 6), -.03],
    assaultHead6: ['assault', T({ hp: 400, maxHp: 400 }, 6), .015], shotgunBody10: ['shotgun', T({ hp: 5000, maxHp: 5000 }, 10), -.07],
    shotgunBody5: ['shotgun', T({ hp: 5000, maxHp: 5000 }, 5), -.09], shotgunBody12: ['shotgun', T({ hp: 5000, maxHp: 5000 }, 1.2), -.15],
    shotgunColossusBody: ['shotgun', T({ kind: 'brute', hp: 1400, maxHp: 1400 }, 1.2), -.1], shotgunColossusHead: ['shotgun', T({ kind: 'brute', hp: 1400, maxHp: 1400 }, 1.2), .35],
    shotgunColossusKill: ['shotgun', T({ kind: 'brute', hp: 500, maxHp: 700 }, 1.2), .35], shotgunWalkerKill: ['shotgun', T({ hp: 40, maxHp: 80 }, 1.2), .1],
    sniperWalkerKill: ['sniper', T({ hp: 400, maxHp: 400 }, 8), .01], sniperColossusHead: ['sniper', T({ kind: 'brute', hp: 1400, maxHp: 1400 }, 8), .04],
    magnumColossusKill: ['magnum', T({ kind: 'brute', hp: 1400, maxHp: 1400 }, 6), -.02], magnumWalkerKill: ['magnum', T({ hp: 80, maxHp: 80 }, 6), -.02],
    shotgunCrawler3: ['shotgun', T({ kind: 'crawler', hp: 5000, maxHp: 5000 }, 3), -.25], shotgunColossusMixed: ['shotgun', T({ kind: 'brute', hp: 5000, maxHp: 5000 }, 1.2), .27],
  };
  const killNames = new Set(['shotgunColossusKill', 'shotgunWalkerKill', 'sniperWalkerKill', 'magnumColossusKill', 'magnumWalkerKill']);
  const check = (name, weapon, targets, recorded) => {
    const historical = SHOTS[name];
    assert.deepEqual(recorded.eye, [...historical.eye], name);
    assert.equal(recorded.pellets.length, historical.pellets.length, name);
    const kills = recorded.events.filter(event => event.event === 'kill'), killedIds = new Set(kills.map(event => event.zombieId));
    assert.equal(kills.length, killNames.has(name) ? 1 : 0, `${name}: actual deaths`);
    for (const kill of kills) {
      assert.equal(kill.id, 'a'); assert.equal(kill.zombieId, 'T');
      const killIndex = recorded.events.indexOf(kill), shotIndex = recorded.events.indexOf(recorded.shot);
      assert.ok(killIndex >= 0 && shotIndex >= 0 && killIndex > shotIndex && recorded.events.slice(shotIndex, killIndex).some(event => event.event === 'bullet-impact' && event.killed), `${name}: real ordered events`);
    }
    recorded.pellets.forEach((pellet, i) => {
      const before = historical.pellets[i];
      for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(pellet[axis] - before[axis]) < .00051, `${name}: seeded direction`);
      const geometry = list => list.map(w => [w[0], w[3], ...w.slice(5).map(v => Math.round(v * 1000) / 1000)]);
      assert.deepEqual(geometry(pellet[4]), geometry(before[4]), `${name}: wound owners, head flags and feet`);
      for (let j = 0; j < pellet[4].length; j++) assert.ok(Math.abs(pellet[4][j][1] - before[4][j][1]) < .015, `${name}: close-range curved entry stays within 1.5 cm of historical ray`);
      pellet[4].forEach((wound, index) => {
        const target = targets.find(([id]) => id === wound[0]); assert.ok(target, `${name}: intended owner`);
        const expected = WEAPONS[weapon].damage * damageFalloff(WEAPONS[weapon], wound[1])
          * WEAPONS[weapon].penetrationRetention ** index * (wound[3] ? recorded.headshotMultiplier : 1) * enemyDamageMultiplier(target[1], wound[3] === 1);
        assert.ok(Math.abs(wound[2] - expected) < .06, `${name}: finite power ${wound[2]} vs ${expected}`);
        if (wound[4]) assert.ok(killedIds.has(wound[0]), `${name}: killed wound has a real death`);
      });
    });
    for (const id of killedIds) {
      const wounds = recorded.pellets.flatMap(pellet => pellet[4]).filter(wound => wound[0] === id);
      assert.ok(wounds.length > 0 && wounds.at(-1)[4] === 1, `${name}: final wound marks the real death`);
    }
  };
  for (const [name, [weapon, targets, pitch]] of Object.entries(scenarios)) check(name, weapon, targets, record(weapon, targets, pitch));
  const pair = [['A', { hp: 5000, maxHp: 5000 }, 3], ['B', { hp: 5000, maxHp: 5000 }, 4]];
  check('shotgunTwoWalkers', 'shotgun', pair, record('shotgun', pair, -.06, 2.1));
});
