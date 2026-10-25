import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const blood = await importPublicModule('frisson/blood.js');
const { install, BLOOD, BLOOD_BUDGETS, BLOOD_PALETTE, BLOOD_EMISSIVE, BLOOD_DROPLET_EMISSIVE, STAIN_SHAPES, SPLATS, bloodBudget } = blood;
const { sprayPlan } = await importPublicModule('frisson/blood-spray.js');
const { restingSurface, blockedAt, ARC_SOLIDS } = await importPublicModule('frisson/blood-floor.js');
const { STAIRS, STAIR_WELL, LOFT, stairTreadY } = await importPublicModule('rules.js');
const { createZombie, startZombieDeath } = await importPublicModule('zombies.js');

const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const inRect = (x, z, rect, margin = 0) => x >= rect.minX - margin && x <= rect.maxX + margin && z >= rect.minZ - margin && z <= rect.maxZ + margin;
// How deep a droplet's cube (half its size, in all three axes) is in a solid box.
const depthIn = (drop, solid) => Math.min(drop.x + drop.size / 2 - solid.minX, solid.maxX - (drop.x - drop.size / 2), drop.z + drop.size / 2 - solid.minZ,
  solid.maxZ - (drop.z - drop.size / 2), drop.y + drop.size / 2 - solid.bottom, solid.top - (drop.y - drop.size / 2));
// The corners of a flat stain square, 0.1 mm in.
const corners = pixel => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [pixel.x + sx * (pixel.size / 2 - 1e-4), pixel.z + sz * (pixel.size / 2 - 1e-4)]);
const TABLE = { minX: -2, maxX: .2, minZ: -1, maxZ: .2 };
const PARTITION_SOUTH = -1.88;

// A document stand-in: canvases record their 2D calls.
function fakeDocument({ width = 1920, height = 1080 } = {}) {
  const body = {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; return node; },
  };
  const created = [];
  const pen = () => ({
    calls: [], globalAlpha: 1, fillStyle: '#000', imageSmoothingEnabled: true,
    clearRect(...args) { this.calls.push(['clearRect', ...args]); },
    fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); },
    drawImage(image, x, y) { this.calls.push(['drawImage', image, x, y, this.globalAlpha]); },
  });
  return {
    body, created, defaultView: { innerWidth: width, innerHeight: height },
    createElement(tag) {
      const canvas = { tag, width: 300, height: 150, style: {}, attributes: {}, parentNode: null,
        setAttribute(key, value) { this.attributes[key] = value; },
        getContext(kind) { return kind === '2d' ? (this.pen ??= pen()) : null; },
        remove() { this.parentNode?.removeChild(this); } };
      created.push(canvas);
      return canvas;
    },
  };
}

async function setup({ quality = 'high', random = seeded(7), document = null, camera = null, three = THREE, onSpray = null } = {}) {
  const scene = new three.Scene();
  const hooks = { impact: null, death: null, frame: null, hurt: null };
  const handle = await install({ THREE: three, scene, camera, hooks, quality, random, document, base: '/frisson/', ...(onSpray ? { onSpray } : {}) });
  const group = scene.getObjectByName('frissonBlood');
  const droplets = group.getObjectByName('frissonBloodDroplets'), stains = group.getObjectByName('frissonBloodStains'), spots = group.getObjectByName('frissonBloodSpots');
  const step = (seconds, extra = {}) => { for (let left = seconds; left > 1e-9; left -= 1 / 60) hooks.frame({ delta: Math.min(1 / 60, left), ...extra }); };
  return { scene, hooks, handle, group, droplets, stains, spots, step };
}

// Translation and scale of every shown instance. Droplets and stains never
// rotate; floor pixels neither (wall pixels do: frisson-blood-spray.test.mjs).
function shown(mesh) {
  const out = [], array = mesh.instanceMatrix.array;
  for (let index = 0; index < mesh.count; index++) {
    const at = index * 16;
    if (array[at] > 0) out.push({ index, size: array[at], height: array[at + 5], x: array[at + 12], y: array[at + 13], z: array[at + 14] });
  }
  return out;
}
// A wound as the client sends it in a Frisson room (BLOOD-SPRAY.md 4.3).
const wound = ({ x, y, z, dirX = 1, dirY = 0, dirZ = 0, damage = 25.2, headshot = false, kill = false, zombieId = 'z1', shot = 1, mode = 'bullet', kind = 'walker',
  axisX = NaN, axisZ = NaN, local = true, delay = 0 }) => ({ x, y, z, dirX, dirY, dirZ, headshot, kill, zombieId, damage, weapon: 'pistol', mode, shot, kind, boss: false,
  scale: 1, axisX, axisZ, local, delay });

const walkerBody = ({ x, y = 0, z, yaw = 0, kind = 'walker', boss = false, raider = false } = {}) => ({
  position: { x, y, z }, rotation: { y: yaw }, scale: { x: kind === 'brute' ? (boss ? 1.32 : 1.22) : 1 },
  userData: { kind, boss, ...(raider ? { raider: true } : {}) },
});

test('three pools (droplets, stains, floor and wall pixels), sized by the quality, start hidden and fill the part\'s own hook slots', async () => {
  assert.deepEqual(Object.fromEntries(Object.entries(BLOOD_BUDGETS).map(([key, budget]) => [key, { ...budget }])), {
    low: { droplets: 384, perFrame: 80, spots: 256, stains: 8, splats: 6, pending: 256, sprays: 64, zombies: 64 },
    medium: { droplets: 448, perFrame: 112, spots: 448, stains: 14, splats: 8, pending: 256, sprays: 64, zombies: 64 },
    high: { droplets: 512, perFrame: 128, spots: 640, stains: 20, splats: 10, pending: 256, sprays: 64, zombies: 64 },
  }, 'BLOOD-SPRAY.md 3.1');
  for (const quality of ['low', 'medium', 'high']) {
    const { hooks, group, droplets, stains, spots, scene } = await setup({ quality });
    const budget = BLOOD_BUDGETS[quality];
    assert.equal(group.parent, scene);
    assert.equal(group.children.length, 3);
    assert.ok(droplets.isInstancedMesh && stains.isInstancedMesh && spots.isInstancedMesh);
    assert.equal(droplets.count, budget.droplets);
    assert.equal(stains.count, budget.stains * BLOOD.stain.pixels);
    assert.equal(spots.count, budget.spots);
    assert.equal(shown(droplets).length + shown(stains).length + shown(spots).length, 0);
    assert.equal(droplets.visible || stains.visible || spots.visible, false, 'empty pools issue no draw call');
    assert.ok(droplets.instanceColor && stains.instanceColor && spots.instanceColor, 'colours are allocated at install');
    // Floor and wall pixels share the stains' material (the same program, one
    // more draw) but have their own copy of the flat square: two instanced
    // meshes on one geometry make three re-point the vertex arrays at every draw.
    assert.equal(spots.material, stains.material); assert.notEqual(spots.geometry, stains.geometry);
    assert.deepEqual([...spots.geometry.attributes.position.array], [...stains.geometry.attributes.position.array]);
    assert.equal(spots.renderOrder, stains.renderOrder);
    assert.equal(droplets.material.emissive.getHex(), BLOOD_DROPLET_EMISSIVE); assert.equal(stains.material.emissive.getHex(), BLOOD_EMISSIVE);
    for (const mesh of [droplets, stains, spots]) {
      assert.equal(mesh.frustumCulled, false); assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, true);
      assert.ok(mesh.material.isMeshLambertMaterial, 'lit like the set');
      assert.equal(mesh.material.fog, true); assert.equal(mesh.material.toneMapped, true); assert.equal(mesh.material.transparent, false);
    }
    assert.equal(stains.material.polygonOffset, true);
    assert.equal(stains.material.depthWrite, false, 'stains never fight each other in depth');
    assert.ok(stains.renderOrder > 0, 'drawn after the set (render order 0), so the floor is under them');
    assert.equal(stains.material.depthTest, true); assert.equal(droplets.material.depthWrite, true);
    for (const name of ['impact', 'death', 'frame', 'hurt']) assert.equal(typeof hooks[name], 'function', name);
  }
  assert.ok(BLOOD_BUDGETS.low.droplets < BLOOD_BUDGETS.medium.droplets && BLOOD_BUDGETS.medium.droplets < BLOOD_BUDGETS.high.droplets);
  assert.ok(BLOOD_BUDGETS.low.stains < BLOOD_BUDGETS.medium.stains && BLOOD_BUDGETS.medium.stains < BLOOD_BUDGETS.high.stains);
  assert.equal(bloodBudget({ id: 'low' }), BLOOD_BUDGETS.low);
  assert.equal(bloodBudget('ultra'), BLOOD_BUDGETS.medium);
  assert.equal(bloodBudget(undefined), BLOOD_BUDGETS.medium);
});

test('the palette is dark red only: no bright cartoon red', () => {
  for (const hex of BLOOD_PALETTE) {
    const r = hex >> 16 & 255, g = hex >> 8 & 255, b = hex & 255;
    assert.ok(r >= 0x4a && r <= 0x8c, hex.toString(16));
    assert.ok(g <= r * .2 && b <= r * .2, hex.toString(16));
  }
});

test('a hit throws its plan (BLOOD-SPRAY.md 2.2): puffs and a burst sized by the damage, 2.5 or 5 cm cubes near the camera, the exit along the shot', async () => {
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 100); camera.position.set(-4, 1.55, 1.5);
  const cases = [[{ damage: 25.2 }, 'body'], [{ damage: 55.4, headshot: true }, 'head'], [{ damage: 120, kill: true }, 'kill'], [{ damage: 770, kill: true, headshot: true }, 'head kill']];
  let previous = 0;
  for (const [flags, label] of cases) {
    for (let seed = 1; seed <= 8; seed++) {
      let info = null;
      const { hooks, droplets, step, handle } = await setup({ camera, random: seeded(seed * 2654435761 >>> 0), onSpray: spray => { info = { ...spray }; } });
      step(1 / 60);
      hooks.impact(wound({ x: -1, y: flags.headshot ? 1.68 : 1.2, z: 1.5, ...flags }));
      step(1 / 60);
      const plan = sprayPlan({ damage: flags.damage, recent: 0, headShare: flags.headshot ? 1 : 0, wounds: 1, kind: 'walker', boss: false, mode: 'bullet',
        kill: flags.kill === true, killDone: false, distance: info.distance, local: true, carry: .5, spotCarry: .5 }, 'high', 1, {});
      assert.equal(info.want, plan.burst + plan.fountain + plan.kill, label);
      assert.equal(handle.stats().thrown, plan.puffsPerWound + info.want, `${label}: thrown`);
      step(.3);
      const live = shown(droplets);
      assert.ok(live.length > 0);
      for (const drop of live) assert.ok(drop.size <= .05 + 1e-6, `size ${drop.size}`);
      const meanX = live.reduce((sum, drop) => sum + drop.x, 0) / live.length;
      if (!flags.kill) assert.ok(meanX > -1.3, `${label}: the exit spray carries the blood along the shot (${meanX})`);
      if (seed === 1) { assert.ok(info.want > previous, `${label}: more damage, more blood`); previous = info.want; }
    }
  }
});

test('droplets land on what is under them: the ground, the loft, the table top, or through the stair well', async () => {
  // A constant random: every droplet of a layer alike, one cell (2.5 cm) here.
  const land = async (event, random = () => .5) => {
    const { hooks, droplets, step } = await setup({ random });
    hooks.impact(event);
    step(1.2);
    const live = shown(droplets);
    assert.ok(live.length > 0);
    return live;
  };
  for (const drop of await land({ x: -1, y: 1.2, z: 1.5 })) assert.ok(Math.abs(drop.y - drop.size / 2) < 1e-5, 'ground');
  for (const drop of await land({ x: 5, y: LOFT.y + 1.2, z: -4 })) assert.ok(Math.abs(drop.y - (LOFT.y + drop.size / 2)) < 1e-5, 'loft');
  for (const drop of await land({ x: -.5, y: 1.3, z: -.4 })) {
    assert.ok(inRect(drop.x, drop.z, TABLE));
    assert.ok(Math.abs(drop.y - (.8 + drop.size / 2)) < 1e-5, 'table top');
  }
  // Straight along the shot (a random near 0: no angle off the exit axis), down the well's 30 cm strip.
  for (const drop of await land({ x: 4.75, y: LOFT.y + 1, z: -1.5, dirX: 0, dirZ: 1 }, () => .001)) {
    assert.ok(inRect(drop.x, drop.z, STAIR_WELL) && !inRect(drop.x, drop.z, STAIRS), 'fell into the well beside the treads');
    assert.ok(Math.abs(drop.y - drop.size / 2) < 1e-5, 'down to the ground floor');
  }
  // Seeded spreads: every droplet rests exactly on the surface under it.
  for (let seed = 1; seed <= 20; seed++) {
    const { hooks, droplets, step } = await setup({ random: seeded(seed) });
    hooks.impact({ x: -.6, y: 1.25, z: -.3, kill: true });
    hooks.impact({ x: 3.8, y: stairTreadY(0) + 1, z: 0, dirX: 0, dirZ: -1, kill: true });
    step(1.3);
    for (const drop of shown(droplets)) {
      const from = drop.x > 2 ? stairTreadY(0) + 1 : 1.25;
      assert.ok(Math.abs(drop.y - (restingSurface(drop.x, drop.z, from) + drop.size / 2)) < 1e-4, `seed ${seed}: (${drop.x}, ${drop.y}, ${drop.z})`);
    }
  }
});

test('droplets never fly through a wall: they stick on its face or drop at its foot', async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { hooks, droplets, step } = await setup({ random: seeded(seed) });
    hooks.impact({ x: 0, y: 1.2, z: -1.6, dirX: 0, dirZ: -1, kill: true, headshot: true });
    for (let frame = 0; frame < 80; frame++) {
      step(1 / 60);
      for (const drop of shown(droplets)) assert.ok(drop.z > PARTITION_SOUTH, `seed ${seed}: z ${drop.z}`);
    }
  }
  // Pixels stuck on it stay on its face: 8 mm out, never behind it.
  let stuck = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { hooks, spots, step } = await setup({ random: seeded(seed) });
    hooks.impact(wound({ x: 0, y: 1.2, z: -1.3, dirX: 0, dirZ: -1, damage: 380, headshot: true, kill: true }));
    step(1.5);
    const array = spots.instanceMatrix.array;
    for (let index = 0; index < spots.count; index++) {
      if (array[index * 16 + 15] !== 1 || array[index * 16 + 5] === 1) continue;
      let any = false;
      for (let k = 0; k < 11; k++) if (array[index * 16 + k] !== 0) any = true;
      if (!any) continue;
      stuck++;
      assert.ok(Math.abs(array[index * 16 + 14] - (PARTITION_SOUTH + .008)) < 1e-5, `seed ${seed}: z ${array[index * 16 + 14]}`);
    }
  }
  assert.ok(stuck > 0, 'some blood sticks on the partition');
});

test('droplets never pass through the waist-high wall: they land on its top, stick on it or drop at its foot', async () => {
  const wall = ARC_SOLIDS.find(solid => solid.top === 1.15 && solid.minX === .78);
  assert.ok(wall, 'the living-room low wall');
  let onTop = 0, atFoot = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { hooks, droplets, step } = await setup({ random: seeded(seed * 2654435761 >>> 0) });
    // 35 cm in front of it, the shot toward it, from higher than its top.
    hooks.impact({ x: wall.minX - .35, y: 1.3, z: 3.6, dirX: 1, dirZ: 0, kill: seed % 2 === 0 });
    for (let frame = 0; frame < 144; frame++) {
      step(1 / 120);
      for (const drop of shown(droplets)) assert.ok(depthIn(drop, wall) < 1e-4, `seed ${seed}: (${drop.x}, ${drop.y}, ${drop.z}) in the wall`);
    }
    for (const drop of shown(droplets)) {
      // A kill burst throws half its droplets all around: some pass beside the wall's end.
      const beside = drop.z + drop.size / 2 < wall.minZ || drop.z - drop.size / 2 > wall.maxZ;
      if (Math.abs(drop.y - drop.size / 2 - wall.top) < 1e-4) onTop++;
      else if (drop.x + drop.size / 2 <= wall.minX) atFoot++;
      else assert.ok(beside || drop.x - drop.size / 2 >= wall.maxX, `seed ${seed}: (${drop.x}, ${drop.y}, ${drop.z}) neither before, on, beside nor over the wall`);
      assert.ok(Math.abs(restingSurface(drop.x, drop.z, drop.y) - (drop.y - drop.size / 2)) < 1e-4, `seed ${seed}: rests on its surface`);
    }
  }
  assert.ok(onTop > 0 && atFoot > 0, `${onTop} on its top, ${atFoot} at its foot`);
});

test('droplets thrown off the loft edge never pass through the partition below', async () => {
  const partition = ARC_SOLIDS.find(solid => solid.top === 3.05);
  for (let seed = 1; seed <= 30; seed++) {
    const { hooks, droplets, step } = await setup({ random: seeded(seed) });
    hooks.impact({ x: .7, y: 3.92, z: -1.11, dirX: -.7, dirZ: -.7, kill: true });
    hooks.impact({ x: .6, y: 4.4, z: -1.3, dirX: -.2, dirZ: -1, kill: true, headshot: true });
    for (let frame = 0; frame < 180; frame++) {
      step(1 / 120);
      for (const drop of shown(droplets)) assert.ok(depthIn(drop, partition) < 1e-4, `seed ${seed}: (${drop.x}, ${drop.y}, ${drop.z}) in the partition`);
    }
  }
});

test('a droplet thrown under a wall rack never rises into it', async () => {
  const rack = ARC_SOLIDS.find(solid => solid.bottom === .9 && inRect(-6.3, 5.7, solid));
  for (let seed = 1; seed <= 20; seed++) {
    const { hooks, droplets, step } = await setup({ random: seeded(seed) });
    hooks.impact({ x: -6.3, y: .75, z: 5.5, dirX: 0, dirZ: 1, kill: true, headshot: true });
    for (let frame = 0; frame < 120; frame++) {
      step(1 / 120);
      for (const drop of shown(droplets)) for (const solid of ARC_SOLIDS) {
        if (depthIn(drop, solid) >= 1e-4) assert.fail(`seed ${seed}: (${drop.x}, ${drop.y}, ${drop.z}) in ${solid === rack ? 'the rack' : JSON.stringify(solid)}`);
      }
    }
  }
});

test('no droplet ever enters a wall, furniture, the loft floor or a tread, and each comes to rest on a surface', async () => {
  const random = seeded(2024);
  let throws = 0;
  for (let trial = 0; trial < 160; trial++) {
    const where = random();
    let x, z, base;
    if (where < .35) { x = LOFT.minX + random() * 7.5; z = -6 + random() * 12; base = LOFT.y; if (inRect(x, z, STAIR_WELL)) continue; }
    else if (where < .5) { x = STAIRS.minX + random() * (STAIRS.maxX - STAIRS.minX); z = STAIRS.minZ + random() * (STAIRS.maxZ - STAIRS.minZ); base = stairTreadY(z); }
    else { x = -7.8 + random() * 15.6; z = -5.8 + random() * 11.6; base = restingSurface(x, z, .5); }
    const y = base + .3 + random() * 1.7, angle = random() * Math.PI * 2, headshot = random() < .5;
    // A hit point already touching a solid starts against it: left out.
    if (ARC_SOLIDS.some(solid => inRect(x, z, solid, .016) && y > solid.bottom - .016 && y < solid.top + .016)) continue;
    throws++;
    const { hooks, droplets, step } = await setup({ random: seeded(trial + 1) });
    hooks.impact({ x, y, z, dirX: Math.cos(angle), dirZ: Math.sin(angle), kill: true, headshot });
    for (let frame = 0; frame < 200; frame++) {
      step(1 / 120);
      for (const drop of shown(droplets)) for (const solid of ARC_SOLIDS) {
        if (depthIn(drop, solid) >= 1e-4) assert.fail(`throw ${trial} from (${x}, ${y}, ${z}): (${drop.x}, ${drop.y}, ${drop.z}) in ${JSON.stringify(solid)}`);
      }
    }
    for (const drop of shown(droplets)) {
      const bottom = drop.y - drop.size / 2;
      assert.ok(Math.abs(restingSurface(drop.x, drop.z, bottom + 1e-4) - bottom) < 1e-4, `throw ${trial}: (${drop.x}, ${drop.y}, ${drop.z}) rests on nothing`);
    }
  }
  assert.ok(throws > 100, `${throws} throws`);
});

test('droplets land, rest, shrink in pixel steps and are gone within a few seconds', async () => {
  const { hooks, droplets, handle, step } = await setup({ random: seeded(3) });
  hooks.impact(wound({ x: -1, y: 1.2, z: 1.5, dirX: 0, dirZ: 1, damage: 30 }));
  const sizes = new Map(), seen = new Map();
  step(1 / 60);
  assert.ok(droplets.visible && shown(droplets).length >= 3);
  let time = 1 / 60, gone = null;
  while (time < 6) {
    const live = shown(droplets);
    // The exit spray is staggered: a droplet's full size is its size when it first shows.
    for (const drop of live) if (!sizes.has(drop.index)) { sizes.set(drop.index, drop.size); seen.set(drop.index, new Set()); }
    for (const drop of live) seen.get(drop.index).add(Math.round(drop.size / sizes.get(drop.index) * 3));
    step(1 / 60); time += 1 / 60;
    if (!live.length && gone === null) gone = time;
  }
  // A 1-cell cube rests 1.1-2 s, a 2-cell one .3-.6 s (BLOOD-SPRAY.md 2.4), then .6 s of shrinking.
  assert.ok(gone !== null && gone > 1.5 && gone < 3.6, `gone at ${gone}`);
  for (const steps of seen.values()) assert.deepEqual([...steps].sort(), [1, 2, 3], 'full size, then two thirds, then one third');
  assert.equal(droplets.visible, false);
  assert.equal(handle.stats().droplets, 0);
});

test('a full droplet pool reuses its oldest throws and never grows; one frame throws a bounded number', async () => {
  const { hooks, droplets, group, scene, step, handle } = await setup({ quality: 'low', random: seeded(11) });
  const capacity = droplets.count, matrixLength = droplets.instanceMatrix.array.length, colorLength = droplets.instanceColor.array.length;
  hooks.impact({ x: -6, y: 1, z: -.5, kill: true });
  step(1 / 60);
  assert.ok(shown(droplets).some(drop => drop.x < -5));
  for (let burst = 0; burst < 40; burst++) {
    hooks.impact(wound({ x: -1 + burst * .02, y: 1.2, z: 1.5, damage: 380, kill: true, zombieId: `p${burst}` }));
    step(1 / 60);
    assert.ok(handle.stats().thrown <= BLOOD_BUDGETS.low.perFrame, 'the frame cap holds');
  }
  assert.ok(shown(droplets).length > capacity * .8, `the pool is nearly full: ${shown(droplets).length}`);
  assert.ok(!shown(droplets).some(drop => drop.x < -5), 'the oldest throw was recycled before its time');
  assert.equal(droplets.count, capacity);
  assert.equal(droplets.instanceMatrix.array.length, matrixLength);
  assert.equal(droplets.instanceColor.array.length, colorLength);
  assert.equal(group.children.length, 3);
  assert.equal(scene.children.length, 1);
  // A grenade kill group in one frame: capped at the per-frame budget, one droplet each at least.
  const fresh = await setup({ quality: 'low', random: seeded(12) });
  fresh.step(1 / 60);
  for (let kill = 0; kill < 30; kill++) fresh.hooks.impact(wound({ x: -1, y: 1, z: 1.5 + kill * .01, damage: 450, kill: true, zombieId: kill, mode: 'blast' }));
  fresh.step(1 / 60);
  assert.equal(fresh.handle.stats().thrown, BLOOD_BUDGETS.low.perFrame);
});

test('far sprays thin out by L(d_eff): all within 8 m, .7 to 18 m, .45 to 35 m, none deep in the fog', async () => {
  const counts = [];
  for (const distance of [5, 12, 25, 50]) {
    const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 100); camera.position.set(-distance, 1.2, 0);
    let info = null;
    const { hooks, step, handle } = await setup({ camera, random: () => .5, onSpray: spray => { info = { ...spray }; } });
    step(1 / 60);
    hooks.impact(wound({ x: 0, y: 1.2, z: 0, damage: 120, kill: true, local: false }));
    step(1 / 60);
    const plan = sprayPlan({ damage: 120, recent: 0, headShare: 0, wounds: 1, kind: 'walker', boss: false, mode: 'bullet', kill: true, killDone: false,
      distance, local: false, carry: .5, spotCarry: .5 }, 'high', 1, {});
    if (info) assert.ok(Math.abs(info.distance - distance) < .3);
    assert.equal(handle.stats().thrown, plan.puffsPerWound + plan.burst + plan.kill, `${distance} m`);
    counts.push(handle.stats().thrown);
  }
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[3] === 0, JSON.stringify(counts));
});

test('a delayed wound (a bullet still in flight) waits in the pending ring and bleeds when it lands', async () => {
  const { hooks, droplets, step, handle } = await setup({ random: () => .5 });
  step(1 / 60);
  hooks.impact(wound({ x: -1, y: 1.2, z: 1.5, delay: .2 }));
  assert.equal(handle.stats().pending, 1);
  step(.15);
  assert.equal(shown(droplets).length, 0);
  assert.equal(handle.stats().sprays, 1, 'its spray waits too');
  step(.1);
  assert.ok(shown(droplets).length > 0);
  assert.equal(handle.stats().pending + handle.stats().sprays, 0);
});

test('no THREE object or DOM element is made per hit, death, hurt or frame (arrays: the GC test of frisson-blood-spray)', async () => {
  const created = new Map();
  const counting = { ...THREE };
  for (const name of ['Vector2', 'Vector3', 'Vector4', 'Matrix3', 'Matrix4', 'Quaternion', 'Euler', 'Color', 'Box3', 'Sphere', 'Object3D', 'Group',
    'Mesh', 'InstancedMesh', 'BufferGeometry', 'BoxGeometry', 'PlaneGeometry', 'MeshLambertMaterial', 'MeshBasicMaterial', 'BufferAttribute', 'InstancedBufferAttribute']) {
    counting[name] = class extends THREE[name] { constructor(...args) { super(...args); created.set(name, (created.get(name) ?? 0) + 1); } };
  }
  const document = fakeDocument(), camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.6, 4);
  const { hooks, droplets, stains, spots, group, step, handle } = await setup({ three: counting, document, camera, random: seeded(5), quality: 'medium' });
  const total = () => [...created.values()].reduce((sum, count) => sum + count, 0);
  const atInstall = total(), elements = document.created.length;
  const sizes = () => [droplets.count, stains.count, spots.count, droplets.instanceMatrix.array.length, stains.instanceMatrix.array.length,
    spots.instanceMatrix.array.length, droplets.instanceColor.array.length, stains.instanceColor.array.length, spots.instanceColor.array.length, group.children.length];
  const before = sizes();
  assert.ok(atInstall > 0, 'the counting module is the one the part uses');
  const snapshot = { zombies: [{ id: 1, x: 0, y: 0, z: 0, kind: 'walker', height: 1.82 }, { id: 2, x: 3, y: 0, z: 3, kind: 'raider', height: 1.8 }] };
  const real = createZombie('walker', false, 80, 'alloc');
  let pixels = 0;
  for (let round = 0; round < 600; round++) {
    const x = -3 + (round % 30) * .2, z = -1 + (round % 7) * .5;
    hooks.impact({ x, y: 1.2, z, dirX: 1, dirZ: .2, headshot: round % 3 === 0, kill: round % 5 === 0, zombieId: round % 9 });
    hooks.impact({ x: 3, y: 1, z: 3 });
    // A shell (9 wounds), a stream round, a blast and a shot into the partition (wall and floor pixels).
    for (let pellet = 0; pellet < 9; pellet++) hooks.impact(wound({ x: x + pellet * .02, y: 1.3, z, dirX: 1, damage: 92.8, headshot: pellet % 2 === 0, kill: round % 11 === 0, zombieId: `s${round % 13}`, shot: round }));
    hooks.impact(wound({ x: 2, y: 1.1, z: 1, damage: 30.1, zombieId: 'stream', shot: 1000 + round, local: false }));
    if (round % 6 === 0) hooks.impact(wound({ x: 1, y: .95, z: 2, dirX: 0, dirZ: 1, damage: 450, kill: true, mode: 'blast', zombieId: `b${round}`, shot: 2000 + round }));
    if (round % 4 === 0) hooks.impact(wound({ x: 0, y: 1.3, z: -1.3, dirX: 0, dirZ: -1, damage: 380, headshot: true, zombieId: 'w', shot: 3000 + round }));
    if (round % 4 === 0) {
      real.position.set(x, 0, z); real.userData.death = undefined;
      startZombieDeath(real, { time: round / 60, directionX: 1, directionZ: 0 });
      hooks.death({ mesh: real, x, y: 0, z, dirX: 1, dirZ: 0, boss: false });
      hooks.death({ mesh: null, x: x + .5, y: 0, z, dirX: 0, dirZ: 0, boss: round % 8 === 0 });
    }
    if (round % 10 === 0) hooks.hurt({ amount: 11, hp: round % 20 ? 70 : 20, maxHp: 100 });
    hooks.frame({ delta: 1 / 60, time: round / 60, snapshot });
    pixels = Math.max(pixels, handle.stats().spots);
  }
  step(45);
  assert.equal(total(), atInstall, JSON.stringify(Object.fromEntries(created)));
  assert.equal(document.created.length, elements, 'no canvas is created after install');
  assert.deepEqual(sizes(), before, 'the pools never grow');
  assert.ok(handle.stats().thrownTotal > 10000 && pixels > 0, `blood was thrown (${handle.stats().thrownTotal}), pixels left (${pixels})`);
});

test('a death leaves a small pixel stain on the 2.5 cm world grid, at floor height, under the fallen torso, after the fall', async () => {
  const { hooks, stains, step } = await setup({ random: seeded(21) });
  hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  step(.5);
  assert.equal(shown(stains).length, 0, 'not before the body is down');
  step(1);
  const pixels = shown(stains);
  assert.ok(pixels.length >= STAIN_SHAPES.walker.core[0] && pixels.length <= 32, `${pixels.length} pixels`);
  for (const pixel of pixels) {
    assert.ok([BLOOD.grid, BLOOD.grid * 2].some(size => Math.abs(pixel.size - size) < 1e-6), `size ${pixel.size}`);
    assert.equal(pixel.height, 1, 'flat');
    const edge = (pixel.x - pixel.size / 2) / BLOOD.grid, edgeZ = (pixel.z - pixel.size / 2) / BLOOD.grid;
    assert.ok(Math.abs(edge - Math.round(edge)) < 1e-3 && Math.abs(edgeZ - Math.round(edgeZ)) < 1e-3, 'snapped to the grid');
    assert.ok(pixel.y > 0 && pixel.y < .01, `y ${pixel.y}`);
  }
  const meanX = pixels.reduce((sum, pixel) => sum + pixel.x, 0) / pixels.length;
  assert.ok(meanX > -.6 && meanX < 0, `centred under the torso, ahead of the feet: ${meanX}`);
  const extent = Math.max(...pixels.map(pixel => Math.hypot(pixel.x - meanX, pixel.z - 1.5)));
  assert.ok(extent < .5, `small: ${extent} m`);
});

test('a knocked-back body bleeds where it lands (real zombie and death data)', async () => {
  const { hooks, stains, step } = await setup({ random: seeded(4) });
  const zombie = createZombie('walker', false, 80, 'knock');
  zombie.position.set(-3, 0, 1.5);
  startZombieDeath(zombie, { time: 10, directionX: 1, directionZ: 0, knockback: { distance: 1.2, hop: .2, fall: .5 } });
  hooks.frame({ delta: 1 / 60, time: 10 });
  hooks.death({ mesh: zombie, x: -3, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  step(1.5);
  const pixels = shown(stains), meanX = pixels.reduce((sum, pixel) => sum + pixel.x, 0) / pixels.length;
  assert.ok(pixels.length > 0);
  assert.ok(meanX > -3 + 1.2, `past the slide: ${meanX}`);
});

test('a rocket kill waits for the rocket: the death starts ahead of the frame clock', async () => {
  const { hooks, stains, step } = await setup({ random: seeded(4) });
  const zombie = createZombie('walker', false, 80, 'rocket');
  zombie.position.set(-1, 0, 1.5);
  hooks.frame({ delta: 1 / 60, time: 20 });
  startZombieDeath(zombie, { time: 20.8, directionX: 1, directionZ: 0 });
  hooks.death({ mesh: zombie, x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  step(1);
  assert.equal(shown(stains).length, 0);
  step(1);
  assert.ok(shown(stains).length > 0);
});

test('stains rest on the loft, stop at its edge and at the stair well, and stay on the ground floor under it', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { hooks, stains, step } = await setup({ random: seeded(seed) });
    hooks.death({ mesh: walkerBody({ x: .75, y: LOFT.y, z: -4, yaw: -Math.PI / 2 }), x: .75, y: LOFT.y, z: -4, dirX: -1, dirZ: 0, headshot: true });
    hooks.death({ mesh: walkerBody({ x: 2.3, y: LOFT.y, z: 0 }), x: 2.3, y: LOFT.y, z: 0, dirX: 1, dirZ: 0 });
    hooks.death({ mesh: walkerBody({ x: 6, y: 0, z: -3 }), x: 6, y: 0, z: -3, dirX: 0, dirZ: 1 });
    step(1.5);
    const pixels = shown(stains);
    const loft = pixels.filter(pixel => pixel.y > 1), ground = pixels.filter(pixel => pixel.y < 1);
    assert.ok(loft.length > 0 && ground.length > 0);
    for (const pixel of loft) {
      assert.ok(pixel.y > LOFT.y && pixel.y < LOFT.y + .01, `seed ${seed}: y ${pixel.y}`);
      assert.ok(inRect(pixel.x, pixel.z, LOFT) && !inRect(pixel.x, pixel.z, STAIR_WELL), `seed ${seed}: (${pixel.x}, ${pixel.z}) hangs over the edge`);
    }
    for (const pixel of ground) assert.ok(pixel.y < .01 && pixel.x > 5, `seed ${seed}: ground pixel (${pixel.x}, ${pixel.y})`);
  }
});

test('stains on the ground floor keep out of furniture and never show through a wall; on the stairs they follow the treads', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const { hooks, stains, step } = await setup({ random: seeded(seed) });
    hooks.death({ mesh: walkerBody({ x: -1, z: .55, yaw: Math.PI }), x: -1, y: 0, z: .55, dirX: 0, dirZ: -1 });
    hooks.death({ mesh: walkerBody({ x: .5, z: -1.6, yaw: Math.PI }), x: .5, y: 0, z: -1.6, dirX: 0, dirZ: -1, headshot: true });
    step(1.5);
    for (const pixel of shown(stains)) {
      assert.ok(!inRect(pixel.x, pixel.z, TABLE, -1e-6), `seed ${seed}: under the table (${pixel.x}, ${pixel.z})`);
      assert.ok(pixel.z > PARTITION_SOUTH, `seed ${seed}: through the partition (${pixel.x}, ${pixel.z})`);
      assert.ok(pixel.y < .01);
    }
    const stairs = await setup({ random: seeded(seed) });
    const feet = stairTreadY(.5);
    stairs.hooks.death({ mesh: walkerBody({ x: 3.8, y: feet - .05, z: .5, yaw: Math.PI }), x: 3.8, y: feet - .05, z: .5, dirX: 0, dirZ: -1 });
    stairs.step(1.5);
    const pixels = shown(stairs.stains);
    assert.ok(pixels.length > 0);
    for (const pixel of pixels) {
      assert.ok(inRect(pixel.x, pixel.z, STAIRS), `seed ${seed}: off the flight (${pixel.x}, ${pixel.z})`);
      const lift = pixel.y - stairTreadY(pixel.z);
      assert.ok(lift > 0 && lift < .01, `seed ${seed}: on its tread, ${lift}`);
    }
  }
});

test('a stain block never hangs over the loft edge, even one centred on it', async () => {
  // A death that once put a 5 cm block centred on the edge (x 0.5), half over the drop.
  const dirX = -.7175630858036305, dirZ = .696493516044458;
  const { hooks, stains, step } = await setup({ random: seeded(1018) });
  hooks.death({ mesh: walkerBody({ x: .86, y: LOFT.y, z: -.25, yaw: Math.atan2(dirX, dirZ) }), x: .86, y: LOFT.y, z: -.25, dirX, dirZ });
  step(1.5);
  const pixels = shown(stains);
  assert.ok(pixels.length > 0);
  for (const pixel of pixels) assert.ok(pixel.x - pixel.size / 2 >= LOFT.minX - 1e-6, `(${pixel.x}, ${pixel.z}) size ${pixel.size} hangs over the edge`);
});

test('every stain square lies whole on one surface: by the loft edge, the stair well, on the flight or the ground', async () => {
  const random = seeded(77);
  let deaths = 0, squares = 0;
  for (let trial = 0; trial < 240; trial++) {
    const where = random();
    let x, z, y;
    if (where < .2) { x = LOFT.minX + random() * 1.1; z = -5.5 + random() * 11; y = LOFT.y; }
    else if (where < .4) { x = STAIR_WELL.minX - .8 + random() * 3.8; z = STAIR_WELL.minZ - .8 + random() * 6.1; y = LOFT.y; if (inRect(x, z, STAIR_WELL)) continue; }
    else if (where < .65) { x = STAIRS.minX + random() * (STAIRS.maxX - STAIRS.minX); z = STAIRS.minZ + random() * (STAIRS.maxZ - STAIRS.minZ); y = stairTreadY(z); }
    else { x = -7.5 + random() * 15; z = -5.5 + random() * 11; y = restingSurface(x, z, .01); }
    const yaw = random() * Math.PI * 2, kind = random() < .3 ? 'brute' : 'walker';
    if (blockedAt(x, z, y + .05, y + 1.5)) continue;
    deaths++;
    const { hooks, stains, step } = await setup({ random: seeded(trial + 3) });
    hooks.death({ mesh: walkerBody({ x, y, z, yaw, kind }), x, y, z, dirX: Math.sin(yaw), dirZ: Math.cos(yaw) });
    step(1.5);
    for (const pixel of shown(stains)) {
      const surface = pixel.y - BLOOD.stain.lift;
      squares++;
      for (const [cx, cz] of corners(pixel)) {
        if (Math.abs(restingSurface(cx, cz, surface + .05) - surface) >= 1e-4) assert.fail(`death ${trial} at (${x}, ${y}, ${z}): corner (${cx}, ${cz}) of a ${pixel.size} square is off its surface ${surface}`);
        if (blockedAt(cx, cz, surface + .05, surface + .25)) assert.fail(`death ${trial}: corner (${cx}, ${cz}) under furniture or in a wall`);
      }
    }
  }
  assert.ok(deaths > 180 && squares > 1500, `${deaths} deaths, ${squares} squares`);
});

test('stains overlapping on one spot layer in a fixed order instead of fighting in depth', async () => {
  const { hooks, stains, step } = await setup({ random: seeded(9) });
  for (let death = 0; death < 6; death++) hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  step(1.5);
  const pixels = shown(stains), slot = pixel => Math.floor(pixel.index / BLOOD.stain.pixels);
  assert.equal(new Set(pixels.map(slot)).size, 6);
  const overlap = pixels.some(a => pixels.some(b => slot(a) < slot(b) && Math.abs(a.x - b.x) < (a.size + b.size) / 2 && Math.abs(a.z - b.z) < (a.size + b.size) / 2));
  assert.ok(overlap, 'the stains overlap');
  // Depth cannot separate them: they draw in instance order over the floor.
  assert.equal(stains.material.depthWrite, false);
  assert.ok(stains.renderOrder > 0);
  assert.equal(new Set(pixels.map(pixel => pixel.y.toFixed(6))).size, 1, 'one lift for every stain');
});

test('bosses leave a larger stain than brutes, brutes than walkers, walkers than crawlers', async () => {
  const area = {};
  for (const [name, kind, boss] of [['crawler', 'crawler', false], ['walker', 'walker', false], ['brute', 'brute', false], ['boss', 'brute', true]]) {
    area[name] = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const { hooks, stains, step } = await setup({ random: seeded(seed) });
      hooks.death({ mesh: walkerBody({ x: -1, z: 1.5, kind, boss }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0, boss });
      step(1.5);
      area[name] += shown(stains).reduce((sum, pixel) => sum + pixel.size ** 2, 0);
    }
  }
  assert.ok(area.crawler < area.walker && area.walker < area.brute && area.brute < area.boss, JSON.stringify(area));
  assert.ok(area.boss / 16 < .07, 'even a boss stain stays small (under 0.07 m²)');
});

test('raiders never bleed: their deaths, their kills and the hits on them', async () => {
  const { hooks, droplets, stains, step } = await setup();
  hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0, raider: true });
  hooks.death({ mesh: walkerBody({ x: -2, z: 1.5, raider: true }), x: -2, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  hooks.impact({ x: -1, y: 1.2, z: 1.5, kill: true, raider: true });
  const snapshot = { zombies: [{ id: 'r1', x: 2, y: 0, z: 3, kind: 'raider', height: 1.8 }, { id: 'z1', x: -2, y: 0, z: 3, kind: 'walker', height: 1.82 }] };
  hooks.frame({ delta: 1 / 60, snapshot });
  hooks.impact({ x: 2, y: 2.2, z: 3, kill: true, zombieId: 'r1' });
  hooks.impact({ x: 2.1, y: 1.3, z: 3.2, dirX: 1, dirZ: 0 });
  step(2);
  assert.equal(shown(droplets).length + shown(stains).length, 0);
  hooks.impact({ x: -2.1, y: 1.3, z: 3, dirX: 1, dirZ: 0 });
  hooks.impact({ x: -2, y: 2, z: 3, kill: true, zombieId: 'z1' });
  step(.1);
  assert.ok(shown(droplets).length >= 10, 'a zombie beside them still bleeds');
});

test('a raider gone from the latest snapshot still never bleeds (a rocket kill lands after it is gone)', async () => {
  const { hooks, droplets, step } = await setup();
  hooks.frame({ delta: 1 / 60, snapshot: { zombies: [{ id: 'r7', x: 2, y: 0, z: 3, kind: 'raider', height: 1.8 }, { id: 3, x: -2, y: 0, z: 3, kind: 'walker', height: 1.82 }] } });
  hooks.frame({ delta: 1 / 60, snapshot: { zombies: [{ id: 3, x: -2, y: 0, z: 3, kind: 'walker', height: 1.82 }] } });
  hooks.impact({ x: 2, y: 2.2, z: 3, kill: true, zombieId: 'r7' });
  step(.2);
  assert.equal(shown(droplets).length, 0);
  hooks.impact({ x: -2, y: 2.2, z: 3, kill: true, zombieId: 3 });
  step(1 / 60);
  assert.ok(shown(droplets).length > 0, 'the zombie still bleeds');
});

test('a death whose start is on another clock than the frame time is not held back', async () => {
  const { hooks, stains, step } = await setup({ random: seeded(4) });
  const zombie = createZombie('walker', false, 80, 'clock');
  zombie.position.set(-1, 0, 1.5);
  // The frame time here is far behind the death's start: two different clocks.
  hooks.frame({ delta: 1 / 60, time: 1 });
  startZombieDeath(zombie, { time: 500, directionX: 1, directionZ: 0 });
  hooks.death({ mesh: zombie, x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  step(1.5, { time: 1 });
  assert.ok(shown(stains).length > 0, 'spread after the fall, not 3 s later');
});

test('a new night after the results starts on a clean floor; a wave break keeps the blood', async () => {
  const document = fakeDocument();
  const { hooks, handle, droplets, stains, spots, step } = await setup({ document, random: seeded(6) });
  const at = phase => ({ phase, zombies: [] });
  const bleed = () => {
    hooks.impact({ x: -1, y: 1.2, z: 1.5, kill: true });
    for (let pellet = 0; pellet < 9; pellet++) hooks.impact(wound({ x: -1, y: 1.2 + pellet * .02, z: 1.5, damage: 92.8, zombieId: 'night' }));
    hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
    hooks.hurt({ amount: 30, hp: 20, maxHp: 100 });
  };
  const all = () => { const stats = handle.stats(); return stats.droplets > 0 && stats.stainPixels > 0 && stats.splats > 0 && stats.spots > 0; };
  const none = () => { const { droplets: drops, stainPixels, splats, spots: pixels, pending, sprays } = handle.stats(); return { drops, stainPixels, splats, pixels, pending, sprays }; };
  const clean = { drops: 0, stainPixels: 0, splats: 0, pixels: 0, pending: 0, sprays: 0 };
  step(1 / 60, { snapshot: at('wave') });
  bleed();
  step(1.2, { snapshot: at('intermission') });
  assert.ok(all(), JSON.stringify(handle.stats()));
  step(.3, { snapshot: at('wave') });
  bleed();
  step(1.2, { snapshot: at('gameover') });
  assert.ok(all(), JSON.stringify(handle.stats()));
  // A wound still in flight when the night ends never lands on the next one.
  hooks.impact(wound({ x: -1, y: 1.2, z: 1.5, damage: 50, zombieId: 'late', delay: 2, shot: 9 }));
  step(1 / 60, { snapshot: at('countdown') });
  assert.deepEqual(none(), clean);
  assert.equal(droplets.visible || stains.visible || spots.visible, false);
  assert.equal(document.body.children[0].style.visibility, 'hidden');
  step(60, { snapshot: at('wave') });
  assert.deepEqual(none(), clean, 'nothing comes back');
});

test('only wounds bleed on screen: no splat for the rain, a fall or a raider\'s blow; a bite in the rain still does', async () => {
  const document = fakeDocument();
  const { hooks, handle, step } = await setup({ document, random: seeded(3) });
  hooks.hurt({ amount: 11, hp: 89, maxHp: 100, source: 'outside' });
  hooks.hurt({ amount: 25, hp: 64, maxHp: 100, source: 'fall' });
  hooks.hurt({ amount: 20, hp: 44, maxHp: 100, source: 'raider' });
  step(.5);
  assert.equal(handle.stats().splats, 0);
  // No source given: while the rain hurts, a drop no bigger than its tick is the rain.
  const rain = { snapshot: { phase: 'wave', outsideDamagePerSecond: 3, zombies: [] }, self: { outsideDamageActive: true } };
  step(1 / 60, rain);
  for (let tick = 0; tick < 6; tick++) { hooks.hurt({ amount: 3, hp: 40 - tick * 3, maxHp: 100 }); step(1, rain); }
  assert.equal(handle.stats().splats, 0);
  hooks.hurt({ amount: 17, hp: 5, maxHp: 100 });
  step(1 / 60, rain);
  assert.ok(handle.stats().splats > 0, 'a bite in the rain');
  // Out of the rain, small drops add up to a splat as before.
  const dry = await setup({ document: fakeDocument(), random: seeded(3) });
  dry.step(1 / 60, { snapshot: rain.snapshot, self: { outsideDamageActive: false } });
  dry.hooks.hurt({ amount: 3, hp: 97, maxHp: 100 }); dry.hooks.hurt({ amount: 3, hp: 94, maxHp: 100 });
  dry.step(1 / 60);
  assert.equal(dry.handle.stats().splats, 1);
});

test('a stain stays for 20 to 40 seconds, dissolves pixel by pixel, and is gone', async () => {
  const ends = [];
  for (let seed = 1; seed <= 10; seed++) {
    const { hooks, stains, step } = await setup({ random: seeded(seed * 7) });
    hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
    step(2);
    const full = shown(stains).length;
    let time = 2, previous = full, dissolving = false;
    while (shown(stains).length) {
      step(.25); time += .25;
      const count = shown(stains).length;
      assert.ok(count <= previous, 'pixels only ever leave');
      if (count < full && count > 0) dissolving = true;
      previous = count;
      assert.ok(time < 45, 'gone in time');
    }
    assert.ok(time > 15, `stayed ${time} s`);
    assert.ok(dissolving, 'went pixel by pixel');
    assert.equal(stains.visible, false);
    ends.push(time);
  }
  assert.ok(Math.min(...ends) >= 20 && Math.max(...ends) <= 41, JSON.stringify(ends));
});

test('a full stain pool reuses the oldest stain', async () => {
  const { hooks, stains, step } = await setup({ quality: 'low', random: seeded(8) });
  const length = stains.instanceMatrix.array.length;
  for (let index = 0; index <= BLOOD_BUDGETS.low.stains; index++) {
    const x = -6 + index * .9;
    hooks.death({ mesh: walkerBody({ x, z: 1 }), x, y: 0, z: 1, dirX: 0, dirZ: 1 });
    step(.1);
  }
  step(1);
  const pixels = shown(stains);
  assert.ok(!pixels.some(pixel => pixel.x < -5.5), 'the first stain made room');
  for (let index = 1; index <= BLOOD_BUDGETS.low.stains; index++) {
    const x = -6 + index * .9;
    assert.ok(pixels.some(pixel => Math.abs(pixel.x - x) < .4), `stain ${index} is there`);
  }
  assert.equal(stains.instanceMatrix.array.length, length);
});

test('hurt: a few pixel splats on a low-resolution overlay under the HUD, at the screen edges, more at low health, fading out', async () => {
  const document = fakeDocument();
  const { hooks, handle, step } = await setup({ document, random: seeded(2) });
  const overlay = document.body.children[0];
  assert.equal(document.body.children.length, 1);
  assert.equal(overlay.width, SPLATS.width); assert.equal(overlay.height, 90);
  assert.equal(overlay.style.position, 'fixed'); assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.style.imageRendering, 'pixelated'); assert.equal(overlay.style.width, '100%'); assert.equal(overlay.style.height, '100%');
  assert.ok(Number(overlay.style.zIndex) < 6, 'under the HUD (#hud is z-index 6)');
  assert.equal(overlay.style.visibility, 'hidden');
  assert.equal(overlay.attributes['aria-hidden'], 'true');
  const draws = () => { const calls = overlay.pen.calls, last = calls.findLastIndex(call => call[0] === 'clearRect'); return calls.slice(last + 1).filter(call => call[0] === 'drawImage'); };

  hooks.hurt({ amount: 11, hp: 89, maxHp: 100 });
  step(1 / 60);
  assert.equal(draws().length, 1);
  assert.equal(overlay.style.visibility, 'visible');
  const [, sprite, x, y] = draws()[0], middleX = x + SPLATS.sprite / 2, middleY = y + SPLATS.sprite / 2;
  assert.ok(middleX <= 28 || middleX >= SPLATS.width - 28 || middleY <= 18 || middleY >= 90 - 18, `at an edge: ${middleX}, ${middleY}`);
  const fills = sprite.pen.calls.filter(call => call[0] === 'fillRect');
  assert.ok(fills.length > 10);
  for (const [, style] of fills) assert.ok(BLOOD_PALETTE.map(hex => `#${hex.toString(16).padStart(6, '0')}`).includes(style), style);

  step(.5);
  hooks.hurt({ amount: 11, hp: 20, maxHp: 100 });
  step(1 / 60);
  assert.equal(draws().length, 1 + 3, 'low health throws three at once');
  assert.equal(handle.stats().splats, 4);
  const alphas = new Set();
  for (let time = 0; time < 4; time += 1 / 60) { step(1 / 60); for (const call of draws()) alphas.add(Number(call[4].toFixed(3))); }
  assert.ok(alphas.size >= 4, 'fades in steps');
  assert.equal(draws().length, 0);
  assert.equal(overlay.style.visibility, 'hidden');

  // Small ticks add up before a splat; a stream of hits is spaced.
  hooks.hurt({ amount: 3, hp: 97, maxHp: 100 });
  step(.3);
  assert.equal(handle.stats().splats, 0);
  hooks.hurt({ amount: 3, hp: 94, maxHp: 100 });
  hooks.hurt({ amount: 30, hp: 64, maxHp: 100 });
  step(1 / 60);
  assert.equal(handle.stats().splats, 1);
  hooks.hurt({ amount: 0, hp: 64, maxHp: 100 });
  hooks.hurt(null);
});

test('without a document (or a 2D canvas) blood still works and hurt does nothing', async () => {
  const { hooks, droplets, step } = await setup({ document: null });
  hooks.hurt({ amount: 40, hp: 10, maxHp: 100 });
  hooks.impact({ x: -1, y: 1.2, z: 1.5, kill: true });
  step(.1);
  assert.ok(shown(droplets).length > 0);
  const blind = { ...fakeDocument(), createElement: () => ({ style: {}, getContext: () => null }) };
  const other = await setup({ document: blind });
  other.hooks.hurt({ amount: 40, hp: 10, maxHp: 100 });
  other.step(.1);
  assert.equal(blind.body.children.length, 0);
});

test('uninstall leaves nothing behind: scene, GPU resources, overlay and hook slots', async () => {
  const document = fakeDocument();
  const scene = new THREE.Scene(), before = new THREE.Group(); scene.add(before);
  const hooks = { impact: null, death: null, frame: null, hurt: null };
  const handle = await install({ THREE, scene, hooks, quality: 'medium', document, random: seeded(1) });
  const group = scene.getObjectByName('frissonBlood'), disposed = new Set();
  const handlers = { ...hooks };
  const counts = new Map();
  for (const mesh of group.children) for (const item of new Set([mesh, mesh.geometry, mesh.material])) {
    if (counts.has(item)) continue;
    counts.set(item, 0);
    item.addEventListener('dispose', () => { disposed.add(item); counts.set(item, counts.get(item) + 1); });
  }
  hooks.impact({ x: -1, y: 1.2, z: 1.5, kill: true });
  hooks.death({ mesh: walkerBody({ x: -1, z: 1.5 }), x: -1, y: 0, z: 1.5, dirX: 1, dirZ: 0 });
  hooks.hurt({ amount: 20, hp: 50, maxHp: 100 });
  hooks.frame({ delta: 1 });
  handle.uninstall();
  assert.deepEqual(scene.children, [before]);
  assert.equal(group.parent, null);
  assert.equal(disposed.size, 8, 'three meshes, three geometries and two materials (the spots share the stains\' material), each once');
  assert.ok([...counts.values()].every(count => count === 1), JSON.stringify([...counts.values()]));
  assert.equal(document.body.children.length, 0);
  assert.deepEqual(hooks, { impact: null, death: null, frame: null, hurt: null });
  // A late call from a stale reference changes nothing.
  handlers.impact({ x: -1, y: 1.2, z: 1.5, kill: true }); handlers.frame({ delta: 1 }); handlers.hurt({ amount: 50 });
  handlers.death({ x: 0, y: 0, z: 0 });
  handle.uninstall();
  // A slot already taken by someone else is left alone.
  const shared = { impact: null, death: null, frame: null, hurt: null };
  const second = await install({ THREE, scene, hooks: shared, quality: 'low' });
  const replacement = () => {}; shared.frame = replacement;
  second.uninstall();
  assert.equal(shared.frame, replacement);
  assert.equal(shared.impact, null);
  assert.deepEqual(scene.children, [before]);
});

test('the same random gives the same blood, floor and wall pixels included', async () => {
  const run = async () => {
    const document = fakeDocument();
    const { hooks, droplets, stains, spots, step } = await setup({ random: seeded(42), document });
    hooks.impact({ x: -1, y: 1.2, z: 1.5, dirX: .6, dirZ: .8, headshot: true });
    hooks.impact(wound({ x: 0, y: 1.3, z: -1.3, dirX: 0, dirZ: -1, damage: 380, headshot: true, kill: true }));
    hooks.death({ mesh: walkerBody({ x: 5, y: LOFT.y, z: -4 }), x: 5, y: LOFT.y, z: -4, dirX: 0, dirZ: 1, boss: true });
    hooks.hurt({ amount: 25, hp: 30, maxHp: 100 });
    step(1.2);
    hooks.impact({ x: .7, y: 1, z: -1.5, kill: true });
    step(.4);
    return JSON.stringify([[...droplets.instanceMatrix.array], [...droplets.instanceColor.array], [...stains.instanceMatrix.array], [...stains.instanceColor.array],
      [...spots.instanceMatrix.array], [...spots.instanceColor.array],
      document.created.map(canvas => canvas.pen?.calls.map(call => call.map(value => typeof value === 'object' ? 'canvas' : value)))]);
  };
  assert.equal(await run(), await run());
});
