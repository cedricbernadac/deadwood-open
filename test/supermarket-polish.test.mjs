import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = code => spawnSync(process.execPath, ['--input-type=module', '-e', code],
  { cwd: new URL('..', import.meta.url), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 60000 });

test('supermarket tube flicker is a gentle stutter, never a strobe, and steady with reduced motion', async () => {
  const { flickerLevel, FLICKER } = await import('../public/supermarket-lights.js');
  const step = 1 / 120, samples = [];
  for (let time = 0; time < 600; time += step) samples.push(flickerLevel(time));
  assert.ok(Math.min(...samples) >= FLICKER.floor - 1e-9, 'never below the floor');
  assert.ok(samples.some(level => level < .75), 'the stutter is visible');
  // A dip is a local minimum under .9; count them in every one-second window.
  const dips = [];
  for (let index = 1; index < samples.length - 1; index++)
    if (samples[index] < .9 && samples[index] <= samples[index - 1] && samples[index] < samples[index + 1]) dips.push(index * step);
  for (let first = 0, last = 0; last < dips.length; last++) {
    while (dips[last] - dips[first] >= 1) first++;
    assert.ok(last - first + 1 <= 3, `at most three dips per second (${dips[last].toFixed(2)} s)`);
  }
  for (const time of [0, 1.3, 77.7, 451.2]) assert.equal(flickerLevel(time, true), 1);
});

test('supermarket light plan stays within the old budget on low and aims every spot at the floor', async () => {
  const { LAMPS, lampsFor, SHOP_TUBES, CELLAR_TUBES } = await import('../public/supermarket-lights.js');
  assert.equal(lampsFor({ id: 'low' }).length, 11, 'low keeps the eleven lights of the first release');
  assert.ok(lampsFor({ id: 'medium' }).length <= 19);
  assert.ok(lampsFor({ id: 'high' }).length <= 21);
  for (const lamp of LAMPS) if (!lamp.point) {
    const target = lamp.target ?? [lamp.x, lamp.y - 3, lamp.z];
    assert.ok(target[1] < lamp.y, 'spots look down');
    assert.ok((lamp.angle ?? 1.05) < Math.PI / 2, 'a cone narrower than a hemisphere lights nothing above its plane');
  }
  // Every shop light sits under a working tube; dead tubes carry none.
  const shopLamps = LAMPS.filter(lamp => lamp.y > 5 && Math.abs(lamp.x) < 14 && Math.abs(lamp.z) < 11);
  for (const lamp of shopLamps) {
    const tube = SHOP_TUBES.find(tube => tube.x === lamp.x && tube.z === lamp.z);
    assert.ok(tube && tube.state !== 'dead', `shop light at ${lamp.x},${lamp.z} hangs under a working tube`);
  }
  const dead = SHOP_TUBES.filter(tube => tube.state === 'dead').length;
  assert.ok(dead >= 6 && dead <= 9, 'roughly half the shop tubes are dead');
  assert.equal(SHOP_TUBES.filter(tube => tube.state === 'flicker').length, 1);
  assert.equal(CELLAR_TUBES.filter(tube => tube.state === 'flicker').length, 1);
});

test('indoors the moon fades smoothly and comes back outside', async () => {
  const { indoorTarget, INDOOR } = await import('../public/supermarket-lights.js');
  assert.equal(indoorTarget({ x: -4, y: 1.7, z: 0 }), 1, 'shop');
  assert.equal(indoorTarget({ x: 8.5, y: -1.7, z: -8 }), 1, 'cellar');
  assert.equal(indoorTarget({ x: 11, y: 1.7, z: -6 }), 0, 'terrace is open sky');
  assert.equal(indoorTarget({ x: 0, y: 1.7, z: 20 }), 0, 'parking');
  assert.equal(indoorTarget(null), 0);
  assert.ok(INDOOR.moon > 0 && INDOOR.moon < 1 && INDOOR.ambient >= 1);
});

test('stair direction signs, the courtyard cable and its pendants are attached in the exported GLB', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { SPACE } from './public/level-space.js';
    const bytes = readFileSync('./public/levels/supermarket.glb'), length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length)), offset = 20 + length, binary = bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32LE(offset));
    const positions = name => {
      const node = json.nodes.find(node => node.name === name); assert.ok(node, name + ' exists');
      // Joined batches keep their active object's transform: apply it (top-level nodes only).
      const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0], [sx, sy, sz] = node.scale ?? [1, 1, 1];
      const world = ([x, y, z]) => {
        x *= sx; y *= sy; z *= sz;
        const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
        return [ix * qw + iw * -qx + iy * -qz - iz * -qy + tx, iy * qw + iw * -qy + iz * -qx - ix * -qz + ty, iz * qw + iw * -qz + ix * -qy - iy * -qx + tz];
      };
      const points = [];
      for (const primitive of json.meshes[node.mesh].primitives) {
        const accessor = json.accessors[primitive.attributes.POSITION], view = json.bufferViews[accessor.bufferView];
        for (let row = 0; row < accessor.count; row++) {
          const at = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + row * (view.byteStride ?? 12);
          points.push(world([0, 1, 2].map(axis => binary.readFloatLE(at + axis * 4))));
        }
      }
      return points;
    };
    // Ink is shared by many signs: look only at the vertical slabs right above each parapet.
    const ink = positions('Market__Ink');
    for (const flight of SPACE.flights) {
      const rail = SPACE.rails.find(rail => rail.id === flight.id + '-west'), top = rail.baseY + rail.height + .015;
      const mid = (rail.minX + rail.maxX) / 2;
      const panel = ink.filter(([x, y, z]) => Math.abs(x - mid) < .02 && y > top + .05 && y < top + .65 && z > rail.minZ - .1 && z < rail.maxZ + .1);
      assert.ok(panel.length >= 8, flight.id + ': the upper sign stands on its parapet');
      const zs = panel.map(point => point[2]);
      assert.ok(Math.min(...zs) >= rail.minZ - 1e-3 && Math.max(...zs) <= rail.maxZ + 1e-3, flight.id + ': the sign never overhangs the parapet');
      assert.ok(Math.min(...panel.map(point => point[1])) - top < .12, flight.id + ': the sign is close enough to its posts');
    }
    // The courtyard cable starts on the partition and ends on the terrace wall, under its cap.
    const rubber = positions('Market__Rubber').filter(([x, y, z]) => Math.abs(z + 6.6) < .03 && y > 2.5);
    const xs = rubber.map(point => point[0]);
    assert.ok(Math.min(...xs) <= 8.15 && Math.max(...xs) >= 13.84, 'cable anchored on both walls');
    assert.ok(Math.max(...rubber.filter(point => point[0] > 13.8).map(point => point[1])) <= 3.2, 'terrace end stays under the 3.2 m wall top');
  `);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});

test('the Blender source assigns the same dead and flickering tubes as the runtime plan', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const { SHOP_TUBES, CELLAR_TUBES } = await import('../public/supermarket-lights.js');
  const source = readFileSync(new URL('../art/levels/supermarket/build_supermarket.py', import.meta.url), 'utf8');
  const set = name => {
    const match = source.match(new RegExp(name + '=\\{([^}]*)\\}'));
    assert.ok(match, name + ' is declared');
    return new Set([...match[1].matchAll(/\(([-\d.]+),([-\d.]+)\)/g)].map(([, x, z]) => `${Number(x)},${Number(z)}`));
  };
  const keys = (tubes, state) => new Set(tubes.filter(tube => tube.state === state).map(tube => `${tube.x},${tube.z}`));
  assert.deepEqual(set('SHOP_DEAD_TUBES'), keys(SHOP_TUBES, 'dead'));
  assert.deepEqual(set('SHOP_FLICKER_TUBES'), keys(SHOP_TUBES, 'flicker'));
  assert.deepEqual(set('SHOP_AGED_TUBES'), keys(SHOP_TUBES, 'aged'));
  assert.deepEqual(set('CELLAR_DEAD'), keys(CELLAR_TUBES, 'dead'));
  assert.deepEqual(set('CELLAR_FLICKER'), keys(CELLAR_TUBES, 'flicker'));
});

test('supermarket outdoors keeps every solid-looking prop outside the walkable clearing', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import * as THREE from 'three';
    import { importPublicModule } from './test/helpers/public-modules.mjs';
    globalThis.document = { createElement() { return { width:0, height:0, getContext:()=> new Proxy({ measureText:value=>({width:value.length*24}) },{get:(o,k)=>o[k]??(()=>{})}) }; } };
    const { EXTERIOR, FUEL_CACHES, FAR_SPAWN_ENTRIES } = await import('./public/rules.js');
    const { createSupermarketOutdoors, supermarketDecorAllowed, PARKING, fuelTrailStart } = await importPublicModule('supermarket-outdoors.js');
    for (const id of ['low', 'high']) {
      const scene = new THREE.Scene(), root = new THREE.Group();
      const { group, decor } = createSupermarketOutdoors(scene, root, { quality: { id, groundDetail: 1 } });
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), b = EXTERIOR.bounds;
      for (const name of ['forestTrunks', 'forestRocks']) {
        const mesh = group.getObjectByName(name);
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix); position.setFromMatrixPosition(matrix);
          assert.ok(position.x < b.minX || position.x > b.maxX || position.z < b.minZ || position.z > b.maxZ, name + ' outside the clearing');
        }
      }
      group.traverse(node => { if (node.name === 'parking-curb') assert.ok(node.geometry.parameters.height <= .05, 'curb stays flush'); });
      for (const name of ['grass-north', 'grass-south', 'grass-west', 'grass-east']) {
        const box = new THREE.Box3().setFromObject(group.getObjectByName(name));
        const overlap = box.max.x > PARKING.minX + 1e-6 && box.min.x < PARKING.maxX - 1e-6 && box.max.z > PARKING.minZ + 1e-6 && box.min.z < PARKING.maxZ - 1e-6;
        assert.equal(overlap, false, name + ' never covers the asphalt or the stairwells');
      }
      assert.ok(decor.userData.counts.tufts > 100, 'grass tufts grow around the parking');
    }
    assert.equal(supermarketDecorAllowed(0, 0), false);
    assert.equal(supermarketDecorAllowed(20, 20), false);
    for (const cache of FUEL_CACHES) {
      const start = fuelTrailStart(cache);
      assert.equal(supermarketDecorAllowed((start.x + cache.x) / 2, (start.z + cache.z) / 2), false, 'trails stay clear');
    }
    assert.equal(supermarketDecorAllowed(-80, 50), true);
  `);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});

test('supermarket world keeps the sky on the camera and dims its tubes with the mood', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import * as THREE from 'three';
    import { importPublicModule } from './test/helpers/public-modules.mjs';
    globalThis.document = { createElement() { return { width:0, height:0, getContext:()=> new Proxy({ measureText:value=>({width:value.length*24}) },{get:(o,k)=>o[k]??(()=>{})}) }; } };
    const { createWorld } = await importPublicModule('world.js');
    const decor = new THREE.Group();
    for (const name of ['Market__Floor_grime_shop', 'Market__Floor_grime_cellar']) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ transparent: true })); decal.name = name; decal.material.name = name.replace('Market__', ''); decor.add(decal);
    }
    for (const name of ['Market__Fluorescent_cold', 'Market__Fluorescent_flicker']) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1, .05, .05), new THREE.MeshStandardMaterial({ emissive: 0xaaffee, emissiveIntensity: 2.4 }));
      tube.name = name; tube.material.name = name.replace('Market__', ''); decor.add(tube);
    }
    const scene = new THREE.Scene(), world = createWorld(scene, { quality: { id: 'medium', shadows: false }, loadDecor: async () => decor });
    assert.equal(await world.ready, true);
    for (const name of ['Market__Floor_grime_shop', 'Market__Floor_grime_cellar']) assert.equal(world.decor.getObjectByName(name).renderOrder, -1, name + ' draws first');
    const camera = new THREE.PerspectiveCamera(); camera.position.set(-60, 1.7, 30); camera.updateMatrixWorld(true);
    world.update(3, { camera, active: false, snapshot: { players: [] } });
    assert.deepEqual(world.atmosphere.sky.position.toArray(), [-60, 1.7, 30]);
    const cold = world.decor.getObjectByName('Market__Fluorescent_cold').material;
    assert.ok(Math.abs(cold.emissiveIntensity - 2.4) < 1e-9);
    world.setMood({ lamps: .5, exposure: 1 });
    world.update(4, { camera, active: false, snapshot: { players: [] } });
    assert.ok(Math.abs(cold.emissiveIntensity - 1.2) < 1e-9, 'tubes follow the mood lamp factor');
    world.setMood(null);
    world.update(5, { camera, active: false, snapshot: { players: [] } });
    assert.ok(Math.abs(cold.emissiveIntensity - 2.4) < 1e-9);
    // Stepping inside eases the moon down, never in one frame.
    const outsideMoon = world.atmosphere.moon.intensity;
    camera.position.set(-4, 1.7, 0); world.update(5.1, { camera, active: false, snapshot: { players: [] } });
    const easing = world.atmosphere.moon.intensity;
    assert.ok(easing < outsideMoon && easing > outsideMoon * .3, 'the moon fades gradually');
    for (let t = 5.2; t < 9; t += .1) world.update(t, { camera, active: false, snapshot: { players: [] } });
    assert.ok(Math.abs(world.atmosphere.moon.intensity - outsideMoon * .3) < .01, 'and settles indoors');
    // Frisson colours apply and restore.
    const fill = world.atmosphere.fill.color.getHex();
    world.setMood({ colors: { fill: 0x768c7d } }); assert.equal(world.atmosphere.fill.color.getHex(), 0x768c7d);
    world.setMood(null); assert.equal(world.atmosphere.fill.color.getHex(), fill);
    // The expedition's teammate torches (existing, shared with the cabin) are not decor lights.
    const lights = []; world.root.traverse(node => { if (node.isLight && !world.expedition.root.getObjectById(node.id)) lights.push(node); });
    assert.equal(lights.length, 19, 'medium quality builds nineteen decor lights');
    assert.ok(lights.filter(light => light.isSpotLight).every(light => light.target.position.y < light.position.y));
  `);
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});
