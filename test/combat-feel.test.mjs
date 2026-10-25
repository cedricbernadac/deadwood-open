import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublicModule } from './helpers/public-modules.mjs';
import { EXTERIOR_WALLS, INTERIOR_WALLS } from '../public/layout.js';

const {
  SHAKE, createCameraShake, explosionTrauma, SHOT_TRAUMA,
  HIT_STOP, createHitStop, KNOCKBACK, knockbackFor, clampSlide,
  HEAT, createBarrelHeat, CASING_PORTS, casingPort,
} = await importPublicModule('combat-feel.js');
const { emitBarrelSmoke } = await importPublicModule('shot-fx.js');
const { sharedEffects } = await importPublicModule('fx.js');
const { createWeapon, setWeaponHeat } = await importPublicModule('world.js');
const { CASING_KINDS } = await importPublicModule('casings.js');

// Offsets are multiplied by a possibly negative sine sum, so a dead shake
// legitimately reports -0; zero-ness must not depend on the sign bit.
const zero = value => value === 0;

const north = EXTERIOR_WALLS.find(wall => wall.id === 'north');
const east = EXTERIOR_WALLS.find(wall => wall.id === 'east');
const partition = INTERIOR_WALLS.find(wall => wall.id === 'rear-front-panel-end');

test('a calm camera reports exactly zero offsets and add() only accepts positive finite trauma', () => {
  const shake = createCameraShake();
  const calm = shake.sample(.016);
  assert.ok(zero(calm.x) && zero(calm.y) && zero(calm.roll), 'no trauma, no offsets');
  shake.add(NaN); shake.add(-.5); shake.add(0); shake.add(Infinity);
  assert.equal(shake.trauma, 0, 'NaN, negative, zero and infinite amounts are ignored');
  shake.add(.6); shake.add(.6);
  assert.equal(shake.trauma, 1, 'trauma caps at 1');
});

test('a full trauma shake stays inside its offset and roll bounds at every step', () => {
  const shake = createCameraShake();
  shake.add(1);
  const peak = { x: 0, y: 0, roll: 0 };
  for (let step = 0; step < 30; step++) {
    const out = shake.sample(.02);
    assert.ok(Math.abs(out.x) <= SHAKE.maxOffset + 1e-12, `x ${out.x} at step ${step}`);
    assert.ok(Math.abs(out.y) <= SHAKE.maxOffset + 1e-12, `y ${out.y} at step ${step}`);
    assert.ok(Math.abs(out.roll) <= SHAKE.maxRoll + 1e-12, `roll ${out.roll} at step ${step}`);
    peak.x = Math.max(peak.x, Math.abs(out.x)); peak.y = Math.max(peak.y, Math.abs(out.y)); peak.roll = Math.max(peak.roll, Math.abs(out.roll));
  }
  assert.ok(peak.x > 0 && peak.y > 0 && peak.roll > 0, 'a full trauma really moves the camera');
});

test('trauma drains at the configured rate and the shake dies out completely', () => {
  const shake = createCameraShake();
  shake.add(1);
  for (let step = 0; step < 5; step++) shake.sample(.04);
  assert.ok(Math.abs(shake.trauma - (1 - .2 * SHAKE.decay)) < 1e-12, `trauma ${shake.trauma} after 0.2 s`);
  for (let step = 0; step < 20; step++) shake.sample(.1);
  assert.equal(shake.trauma, 0);
  const out = shake.sample(.05);
  assert.ok(zero(out.x) && zero(out.y) && zero(out.roll), 'no trauma, no offsets');
});

test('the strength setting scales the offsets while the trauma still drains', () => {
  const full = createCameraShake(), half = createCameraShake(), muted = createCameraShake();
  full.add(1); half.add(1); muted.add(1);
  for (const delta of [.03, .017, .05]) {
    const a = full.sample(delta, 1), b = half.sample(delta, .5), c = muted.sample(delta, 0);
    assert.ok(Math.abs(2 * b.x - a.x) < 1e-12 && Math.abs(2 * b.y - a.y) < 1e-12 && Math.abs(2 * b.roll - a.roll) < 1e-12, 'half strength halves every offset');
    assert.ok(zero(c.x) && zero(c.y) && zero(c.roll), 'strength 0 mutes the shake');
  }
  assert.ok(muted.trauma > 0 && Math.abs(muted.trauma - full.trauma) < 1e-12, 'a muted shake still drains its trauma');
});

test('one huge frame delta is capped to a tenth of a second of decay', () => {
  const shake = createCameraShake();
  shake.add(1);
  shake.sample(10);
  assert.ok(Math.abs(shake.trauma - (1 - .1 * SHAKE.decay)) < 1e-12, `trauma ${shake.trauma} after sample(10)`);
});

test('reset() clears the trauma at once', () => {
  const shake = createCameraShake();
  shake.add(.8);
  shake.reset();
  assert.equal(shake.trauma, 0);
  const out = shake.sample(.05);
  assert.ok(zero(out.x) && zero(out.y) && zero(out.roll), 'no trauma, no offsets');
});

test('explosion trauma fades with distance, respects each reach and favours rockets', () => {
  assert.equal(explosionTrauma(17), 0, 'a grenade at its reach is only heard');
  assert.equal(explosionTrauma(40), 0, 'far beyond the reach');
  assert.equal(explosionTrauma(24, { rocket: true }), 0, 'a rocket at its reach');
  assert.equal(explosionTrauma(20, { rocket: true }) > 0, true, 'the rocket reach is longer');
  assert.equal(explosionTrauma(NaN), 0);
  assert.equal(explosionTrauma(-3), 0);
  assert.ok(explosionTrauma(2) > explosionTrauma(8) && explosionTrauma(8) > explosionTrauma(15), 'a nearer grenade rattles more');
  assert.ok(explosionTrauma(6, { rocket: true }) > explosionTrauma(6), 'a rocket hits harder than a grenade at the same distance');
  assert.ok(explosionTrauma(0) > .5 && explosionTrauma(0, { rocket: true }) > .5, 'a point-blank blast is a hard shock');
});

test('only the heavy weapons carry a shot trauma, each a gentle nudge', () => {
  assert.deepEqual(Object.keys(SHOT_TRAUMA).sort(), ['magnum', 'rocket', 'shotgun', 'sniper']);
  for (const [weapon, trauma] of Object.entries(SHOT_TRAUMA)) assert.ok(trauma > 0 && trauma < .3, `${weapon}: ${trauma}`);
});

test('a kill trigger starts a hit-stop that ends on time', () => {
  const stop = createHitStop();
  assert.equal(stop.trigger('kill', 10), true);
  assert.equal(stop.scale(10.01), HIT_STOP.scale);
  assert.equal(stop.scale(10 + HIT_STOP.kill - 1e-9), HIT_STOP.scale, 'still stopped just before the end');
  assert.equal(stop.scale(10 + HIT_STOP.kill + 1e-6), 1, 'time flows again right after');
});

test('the cooldown refuses overlapping stops without extending the running one', () => {
  const stop = createHitStop();
  assert.equal(stop.trigger('kill', 10), true);
  assert.equal(stop.trigger('headshotKill', 10.02), false, 'inside the cooldown');
  assert.equal(stop.scale(10 + HIT_STOP.kill + .001), 1, 'the refused trigger did not stretch the first stop');
  assert.equal(stop.trigger('kill', 10 + HIT_STOP.cooldown + .01), true, 'after the cooldown a stop starts again');
});

test('unknown kinds, reserved keys and NaN times never start a stop, and reset() ends one', () => {
  const stop = createHitStop();
  assert.equal(stop.trigger('boom', 1), false);
  assert.equal(stop.trigger('cooldown', 1), false, 'the cooldown setting is not a stop kind');
  assert.equal(stop.trigger('scale', 1), false, 'the scale setting is not a stop kind');
  assert.equal(stop.trigger('kill', NaN), false);
  assert.equal(stop.scale(NaN), 1);
  assert.equal(stop.trigger('kill', 5), true);
  stop.reset();
  assert.equal(stop.scale(5.01), 1, 'reset() ends the running stop');
  assert.equal(stop.trigger('kill', 5.01), true, 'reset() also clears the cooldown');
});

test('every hit-stop is shorter than a tenth of a second', () => {
  for (const kind of ['kill', 'headshot', 'headshotKill', 'heavy']) assert.ok(HIT_STOP[kind] > 0 && HIT_STOP[kind] < .1, `${kind}: ${HIT_STOP[kind]} s`);
});

test('knockback profiles cover blasts and heavy hits and nothing else', () => {
  assert.deepEqual(knockbackFor({ weapon: 'grenade' }), { distance: 1.5, hop: .3, fall: .34 });
  assert.deepEqual(knockbackFor({ weapon: 'rocket' }), { distance: 1.7, hop: .36, fall: .32 });
  assert.deepEqual(knockbackFor({ weapon: 'sniper' }), { distance: .7, hop: .04, fall: .42 });
  assert.deepEqual(knockbackFor({ weapon: 'hammer' }), { distance: 1.1, hop: .14, fall: .36 });
  assert.deepEqual(knockbackFor({ weapon: 'bat' }), { distance: 1, hop: .1, fall: .38 });
  assert.deepEqual(knockbackFor({ weapon: 'fireaxe' }), { distance: .7, hop: .04, fall: .42 });
  for (const event of [{ weapon: 'pistol' }, { weapon: 'assault' }, { weapon: 'minigun' }, { weapon: 'flamethrower' }, {}, null, undefined])
    assert.equal(knockbackFor(event), null, `${event?.weapon ?? event} has no knockback`);
});

test('shotgun and magnum knockback scales with range inside their reach', () => {
  const blank = knockbackFor({ weapon: 'shotgun', range: 0 });
  assert.ok(Math.abs(blank.distance - KNOCKBACK.shotgun.distance) < 1e-12, 'point blank pushes the full distance');
  const edge = knockbackFor({ weapon: 'shotgun', range: KNOCKBACK.shotgun.range });
  assert.ok(Math.abs(edge.distance - KNOCKBACK.shotgun.distance * .45) < 1e-12, `at the edge only 45 % remains (${edge.distance})`);
  assert.ok(Math.abs(edge.hop - KNOCKBACK.shotgun.hop * .45) < 1e-12, 'the hop scales the same way');
  assert.equal(edge.fall, KNOCKBACK.shotgun.fall, 'the fall speed never scales');
  const mid = knockbackFor({ weapon: 'magnum', range: 6 });
  assert.ok(Math.abs(mid.distance - KNOCKBACK.magnum.distance * (1 - .55 * 6 / 12)) < 1e-12);
  assert.equal(knockbackFor({ weapon: 'shotgun', range: 6.5 }), null, 'beyond the range');
  assert.equal(knockbackFor({ weapon: 'magnum', range: 13 }), null, 'beyond the range');
  assert.equal(knockbackFor({ weapon: 'shotgun' }), null, 'a missing range means no knockback');
  assert.equal(knockbackFor({ weapon: 'magnum', range: NaN }), null);
});

test('knockback results are fresh copies that never leak into the profiles', () => {
  const result = knockbackFor({ weapon: 'rocket' });
  result.distance = 99; result.hop = 99; result.fall = 99;
  assert.equal(KNOCKBACK.rocket.distance, 1.7);
  assert.deepEqual(knockbackFor({ weapon: 'rocket' }), { distance: 1.7, hop: .36, fall: .32 });
});

test('a slide in the open keeps its full distance', () => {
  assert.equal(clampSlide(20, 20, 1, 1, 2), 2);
  assert.equal(clampSlide(-30, 15, -2, 3, 1.25), 1.25, 'directions need not be normalised');
});

test('a body pushed at the north wall stops a margin short of its outer face', () => {
  const result = clampSlide(3, -7.4, 0, 1, 1), face = north.fixed - .27 / 2;
  assert.ok(Math.abs(result - ((face - .35) - -7.4)) < 1e-12, `stops at ${result} m, a margin before the wall face at z=${face}`);
  assert.equal(clampSlide(3, -6.4, 0, 1, 1), 0, 'already within the margin: no slide towards the wall');
});

test('the toppling body counts: a slide stops its reach short of a wall', () => {
  const face = north.fixed - .27 / 2;
  const result = clampSlide(3, -9.5, 0, 1, 1.5, { reach: 1.8 });
  assert.ok(Math.abs(result - Math.max(0, (face - .35 - 1.8) - -9.5)) < 1e-12, `slide ${result}`);
  assert.ok(Math.abs(clampSlide(3, -8.5, 0, 1, 1.5, { reach: 1.8 }) - .215) < 1e-9, 'a body 2.5 m out slides only 0.215 m');
  assert.equal(clampSlide(3, -8, 0, 1, 1.5, { reach: 1.8 }), 0, 'a body 2 m out would fall into the wall: no slide');
  assert.equal(clampSlide(3, -8, 0, -1, 1.5, { reach: 1.8 }), 1.5, 'pushed away it slides fully');
});

test('a body pressed against the partition or standing in a doorway never slides through', () => {
  assert.equal(clampSlide(0, -1.59, 0, -1, 1.7), 0, 'touching the partition and pushed into it');
  assert.equal(clampSlide(1.31, 3.5, -1, 0, 1.7), 0, 'touching the low wall and pushed into it');
  assert.equal(clampSlide(1, -6.05, 1, 0, 1.7), 0, 'in the north doorway, pushed along the wall');
  assert.equal(clampSlide(0, -1.59, 0, 1, 1.7), 1.7, 'pushed away from the partition');
});

test('a grazing push into a wall never leaves the body inside the wall', () => {
  for (const degrees of [5, 10, 15, 20, 30]) {
    const angle = degrees * Math.PI / 180, distance = clampSlide(3, -6.6, Math.sin(angle), Math.cos(angle), 1.7);
    const endZ = -6.6 + Math.cos(angle) * distance;
    assert.ok(endZ <= north.fixed - .27 / 2 - .35 + 1e-9 || distance === 0, `${degrees} degrees ends at z=${endZ}`);
  }
});

test('a body pushed away from a wall or along it keeps its full distance', () => {
  assert.equal(clampSlide(3, -6.6, 0, -1, 1), 1, 'pushed away from the north wall');
  assert.equal(clampSlide(3, -6.7, 1, 0, 2), 2, 'sliding parallel to the north wall');
});

test('a body inside the cabin stops before the east wall and before the interior partition', () => {
  const toEast = clampSlide(5, 0, 1, 0, 10);
  assert.ok(Math.abs(toEast - (east.fixed - .27 / 2 - 5 - .35)) < 1e-12, `east wall at ${toEast}`);
  const toPartition = clampSlide(0, -4, 0, 1, 2);
  const expected = partition.minZ - .35 - (-4);
  assert.ok(Math.abs(toPartition - expected) < 1e-12, `partition: stops at ${toPartition}, before the grown box at ${expected}`);
  assert.ok(toPartition < partition.minZ - (-4), 'the body never reaches the partition itself');
});

test('clampSlide rejects zero directions, NaN inputs and non-positive distances', () => {
  assert.equal(clampSlide(0, 0, 0, 0, 1), 0, 'zero direction');
  assert.equal(clampSlide(NaN, 0, 0, 1, 1), 0);
  assert.equal(clampSlide(0, 0, NaN, 1, 1), 0);
  assert.equal(clampSlide(0, 0, 0, 1, NaN), 0);
  assert.equal(clampSlide(0, 0, 0, 1, 0), 0, 'a zero distance');
  assert.equal(clampSlide(0, 0, 0, 1, -2), 0, 'a negative distance');
});

test('clampSlide never returns a negative or an overshoot over a grid of starts and directions', () => {
  const starts = [-12, -9, -6.6, -3, 0, 3, 6.6, 9, 12];
  let cases = 0;
  for (const x of starts) for (const z of starts) {
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2, distance = .4 + (index % 5) * .5;
      const result = clampSlide(x, z, Math.cos(angle), Math.sin(angle), distance);
      assert.ok(Number.isFinite(result) && result >= 0 && result <= distance, `(${x}, ${z}) at ${angle}: ${result} of ${distance}`);
      cases++;
    }
  }
  assert.ok(cases > 1000, `${cases} start/direction pairs checked`);
});

test('barrel heat builds per shot, cools exponentially and caps at one', () => {
  const heat = createBarrelHeat();
  assert.equal(heat.level(0), 0, 'cold before any shot');
  heat.shot('pistol', 1);
  assert.ok(Math.abs(heat.level(1) - HEAT.perShot.pistol) < 1e-12, 'one pistol shot');
  assert.ok(Math.abs(heat.level(2.5) - HEAT.perShot.pistol * Math.exp(-1.5 / HEAT.cool)) < 1e-12, 'exponential cooling');
  for (let shot = 0; shot < 50; shot++) heat.shot('minigun', 5);
  assert.equal(heat.level(5), 1, 'a minigun burst saturates the barrel');
});

test('unknown weapons add no heat', () => {
  const heat = createBarrelHeat();
  heat.shot('flamethrower', 2); heat.shot('katana', 2); heat.shot('hammer', 2);
  assert.equal(heat.level(2), 0);
  heat.shot('pistol', NaN);
  assert.equal(heat.level(2), 0, 'a shot without a time is ignored');
});

test('a hot barrel breathes a bounded stream of wisps only once the trigger rests', () => {
  const heat = createBarrelHeat();
  heat.shot('sniper', 0);
  assert.equal(heat.wisps(.1, 1 / 60), 0, 'still firing: no smoke yet');
  const cold = createBarrelHeat();
  cold.shot('pistol', 0);
  assert.equal(cold.wisps(1, 1 / 60), 0, 'a barely warm barrel does not smoke');
  let total = 0;
  for (let frame = 1; frame <= 60; frame++) {
    const count = heat.wisps(HEAT.idle + frame / 60, 1 / 60);
    assert.ok(Number.isInteger(count) && count >= 0 && count <= 4, `frame ${frame}: ${count} wisps`);
    total += count;
  }
  assert.ok(total > 0, 'a hot barrel at rest does smoke');
  assert.ok(total >= 2 && total <= 2 + HEAT.maxWisps, `${total} wisps over one second, inside the rate band`);
  assert.equal(heat.wisps(1.3, 5), 4, 'even a huge frame never emits more than four wisps');
});

test('reset() cools the barrel', () => {
  const heat = createBarrelHeat();
  heat.shot('shotgun', 3);
  assert.ok(heat.level(3) > 0);
  heat.reset();
  assert.equal(heat.level(3), 0);
  assert.equal(heat.wisps(4, 1), 0, 'no smoke from a cold barrel');
});

test('the pump shotgun and the bolt rifle eject late, the minigun drops its casings, some guns have no port', () => {
  const shotgun = casingPort('shotgun');
  assert.equal(shotgun.kind, 'shell');
  assert.ok(shotgun.delay > .2, `the pump cycles after ${shotgun.delay} s`);
  const sniper = casingPort('sniper');
  assert.equal(sniper.kind, 'sniper');
  assert.ok(sniper.delay > .3, `the bolt cycles after ${sniper.delay} s`);
  assert.equal(casingPort('minigun').drop, true, 'the minigun drops its casings straight down');
  for (const weapon of ['magnum', 'rocket', 'flamethrower', 'hammer', 'bat', 'fireaxe', 'katana', 'cannon'])
    assert.equal(casingPort(weapon), null, `${weapon} ejects nothing`);
});

test('every casing port sits near the gun origin with a known casing kind', () => {
  for (const [weapon, entry] of Object.entries(CASING_PORTS)) {
    assert.ok(Array.isArray(entry.port) && entry.port.length === 3, `${weapon} port is a 3-vector`);
    for (const coordinate of entry.port)
      assert.ok(Number.isFinite(coordinate) && Math.abs(coordinate) <= .3, `${weapon} port coordinate ${coordinate} within 30 cm of the gun origin`);
    assert.ok(entry.kind in CASING_KINDS, `${weapon} ejects a '${entry.kind}' casing that casings.js knows`);
  }
});

test('barrel smoke adds exactly one rising particle and hotter barrels smoke more', () => {
  const fx = sharedEffects();
  fx.clear();
  emitBarrelSmoke({ x: 1, y: 1.5, z: -2 }, 3, .25);
  assert.equal(fx.pools.smoke.particles.length, 1, 'exactly one smoke particle');
  const wisp = fx.pools.smoke.particles[0];
  assert.equal(wisp.start, 3);
  assert.ok(wisp.vy > 0 || wisp.gravity < 0, `the wisp rises (vy ${wisp.vy}, gravity ${wisp.gravity})`);
  emitBarrelSmoke({ x: 1, y: 1.5, z: -2 }, 3, .9);
  const hotter = fx.pools.smoke.particles[1];
  assert.ok(hotter.alpha > wisp.alpha, `hotter barrel, denser smoke (${hotter.alpha} > ${wisp.alpha})`);
  // Tuning values are art; only their bounds are pinned here.
  for (const particle of [wisp, hotter]) assert.ok(particle.alpha > 0 && particle.alpha < .6, `a thin, translucent wisp (${particle.alpha})`);
});

test('barrel smoke ignores missing or NaN points and times', () => {
  const fx = sharedEffects();
  fx.clear();
  emitBarrelSmoke(null, 1);
  emitBarrelSmoke({ x: NaN, y: 0, z: 0 }, 1);
  emitBarrelSmoke({ x: 0, y: Infinity, z: 0 }, 1);
  emitBarrelSmoke({ x: 0, y: 0, z: 0 }, NaN);
  assert.equal(fx.pools.smoke.particles.length, 0);
});

test('a hot minigun glows through one material shared by its six barrels only', () => {
  const gun = createWeapon('minigun');
  assert.equal(setWeaponHeat(gun, 0), false, 'a cold minigun keeps sharing the ordinary material');
  assert.equal(gun.userData.heatMaterial, undefined);
  assert.equal(setWeaponHeat(gun, 1), true);
  const hot = gun.userData.heatMaterial;
  assert.ok(hot, 'the first hot call gives this gun its own barrel material');
  assert.ok(gun.userData.heatMaterial.emissiveIntensity > 1, `a fully hot barrel glows (${gun.userData.heatMaterial.emissiveIntensity})`);
  const barrels = [];
  gun.userData.rotor.traverse(node => { if (node.isMesh && /^minigunBarrel/.test(node.name)) barrels.push(node); });
  assert.equal(barrels.length, 6, 'six barrels');
  for (const barrel of barrels) assert.equal(barrel.material, hot, `${barrel.name} shares the one hot material`);
  const other = createWeapon('minigun');
  const otherBarrels = [];
  other.userData.rotor.traverse(node => { if (node.isMesh && /^minigunBarrel/.test(node.name)) otherBarrels.push(node); });
  for (const barrel of otherBarrels) assert.notEqual(barrel.material, hot, 'the glow never leaks to another minigun');
  assert.equal(other.userData.heatMaterial, undefined, 'the other minigun was never heated');
  assert.equal(setWeaponHeat(gun, .5), true);
  assert.equal(gun.userData.heatMaterial, hot, 'repeated calls reuse the same material');
  assert.equal(setWeaponHeat(gun, 0), true); assert.equal(hot.emissiveIntensity, 0, 'cooled down, it stops glowing');
  for (const barrel of barrels) assert.equal(barrel.material, hot, 'still one shared material');
  assert.equal(setWeaponHeat(createWeapon('pistol'), 1), false, 'a pistol has no barrel cluster to heat');
  assert.equal(setWeaponHeat(null, 1), false);
});

test('a late-drawn tracer starts part-way along its path, but its head is always seen', async () => {
  const THREE = await import('three');
  const { createTracer } = await importPublicModule('world.js');
  const { BULLET_SPEED } = await importPublicModule('shot-fx.js');
  const start = new THREE.Vector3(0, 1.5, 0), end = new THREE.Vector3(0, 1.5, -17), flight = 17 / BULLET_SPEED;
  assert.equal(createTracer(start, end, { time: 10 }).startedAt, 10, 'LAN: no lead');
  assert.ok(Math.abs(createTracer(start, end, { time: 10, lead: .02 }).startedAt - 9.98) < 1e-12, 'a small lead is kept');
  assert.ok(Math.abs(createTracer(start, end, { time: 10, lead: 5 }).startedAt - (10 - .45 * flight)) < 1e-12, 'a long round trip is capped at 45 % of the flight');
  assert.equal(createTracer(start, end, { time: 10, lead: NaN }).startedAt, 10);
});

test('the katana edge runs along the convex side of its curve, the spine along the concave one', async () => {
  const THREE = await import('three');
  const { createWeapon } = await importPublicModule('world.js');
  const blade = createWeapon('katana').getObjectByName('katanaBlade'), positions = blade.geometry.getAttribute('position');
  const { sections, cuttingSide } = blade.userData;
  assert.equal(cuttingSide, 'negative-X');
  const x = (section, key) => positions.getX(section[key]);
  const base = sections[0], middle = sections[12], tip = sections[24];
  for (const key of ['edge', 'spineTop']) {
    const chord = (x(base, key) + x(tip, key)) / 2;
    assert.ok(x(middle, key) < chord - .003, `${key}: the curve bulges towards the edge side (${x(middle, key)} < ${chord})`);
  }
  for (const section of sections.slice(0, 25)) assert.ok(x(section, 'edge') < x(section, 'spineTop'), 'the edge stays on local -X');
  // The point (kissaki): over the last 10 cm the edge sweeps up to the tip
  // while the spine runs on nearly straight, as on a real katana.
  const point = sections[25];
  assert.ok(x(point, 'edge') - x(tip, 'edge') > .06, 'the edge curves up into the point');
  assert.ok(Math.abs(x(point, 'spineTop') - x(tip, 'spineTop')) < .015, 'the spine stays nearly straight to the point');
});

test('the mace is a ball bristling with spikes, none pointing back at the shaft, and every melee weapon has a swoosh point', async () => {
  const THREE = await import('three');
  const { createWeapon } = await importPublicModule('world.js');
  const mace = createWeapon('hammer'), head = mace.getObjectByName('hammerHead'), spikes = [];
  mace.getObjectByName('hammerStrikingSpikes').traverse(node => { if (node.name === 'maceSpike') spikes.push(node); });
  assert.ok(head.geometry.type === 'SphereGeometry' && spikes.length >= 14, `${spikes.length} spikes`);
  for (const spike of spikes) {
    const outward = spike.position.clone().sub(head.position).normalize();
    assert.ok(outward.z <= .62 + 1e-9, 'no spike points back along the shaft');
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(spike.quaternion).dot(outward) > .999, 'each spike points straight out');
  }
  for (const type of ['katana', 'bat', 'fireaxe', 'hammer']) assert.ok(createWeapon(type).userData.trailTip?.isVector3, `${type} swoosh point`);
});

test('a swoosh segment is one still ribbon whose ends are pulled in to meet its neighbours', async () => {
  const THREE = await import('three');
  const { emitSwingTrail, SWING_TRAILS } = await importPublicModule('shot-fx.js');
  const fx = sharedEffects(); fx.clear();
  const from = new THREE.Vector3(0, 1.5, -1), to = new THREE.Vector3(.4, 1.5, -1);
  emitSwingTrail(from, to, 2, { weapon: 'katana' });
  assert.equal(fx.pools.streak.particles.length, 1);
  const ribbon = fx.pools.streak.particles[0], half = SWING_TRAILS.katana.width / 2;
  assert.ok(Math.abs(ribbon.x - (.4 - half)) < 1e-9 && Math.abs(ribbon.tx - half) < 1e-9, 'both ends trimmed by half the ribbon width');
  fx.update(2.05); assert.equal(fx.pools.streak.particles.length, 1); fx.update(2.5); assert.equal(fx.pools.streak.particles.length, 0, 'it fades in a blink');
  emitSwingTrail(from, from.clone(), 3); emitSwingTrail(null, to, 3); emitSwingTrail(from, to, NaN);
  assert.equal(fx.pools.streak.particles.length, 0);
});

test('a teammate keeps the original, head-clear heavy swing of the mace and the axe', async () => {
  const THREE = await import('three');
  const { createSurvivor, setSurvivorWeapon, animateSurvivor } = await importPublicModule('world.js');
  const { MELEE_WEAPONS } = await import('../public/rules.js');
  for (const type of ['hammer', 'fireaxe']) {
    const survivor = createSurvivor(); setSurvivorWeapon(survivor, type);
    const d = survivor.userData, profile = MELEE_WEAPONS[type].heavy, point = new THREE.Vector3(), inverse = new THREE.Matrix4();
    let deepest = 0;
    for (let time = 0; time <= profile.duration; time += .025) {
      animateSurvivor(survivor, { pitch: 0, delta: 0, meleeAttack: 'heavy', meleeElapsed: time });
      survivor.updateMatrixWorld(true); inverse.copy(d.head.matrixWorld).invert();
      d.gun.traverse(node => {
        if (!node.isMesh) return;
        const positions = node.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index += 3) {
          point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
          const inside = 1 - Math.hypot(point.x / (.19 * .9), point.y / (.19 * 1.1), point.z / (.19 * .9));
          deepest = Math.max(deepest, inside);
        }
      });
    }
    assert.ok(deepest <= 1e-6, `${type}: the heavy swing stays outside the teammate's head (${deepest})`);
  }
});

test('the last kill of a wave runs the world at 30 % for most of a second, then eases back to full speed', async () => {
  const { createSlowMotion, LAST_KILL_SLOWMO } = await import('../public/combat-feel.js');
  const slow = createSlowMotion();
  assert.equal(slow.scale(10), 1, 'idle');
  slow.trigger(10.2); // a rocket still in flight for 0.2 s
  assert.equal(slow.scale(10.1), 1, 'not before the body falls');
  assert.equal(slow.scale(10.2), LAST_KILL_SLOWMO.scale);
  assert.equal(slow.scale(10.6), LAST_KILL_SLOWMO.scale);
  const easing = [10.8, 10.9, 11, 11.08].map(time => slow.scale(time));
  for (let index = 1; index < easing.length; index++) assert.ok(easing[index] > easing[index - 1], `eases back: ${easing}`);
  assert.ok(easing.at(-1) > .9);
  assert.equal(slow.scale(11.1), 1, 'over after 0.9 s');
  slow.trigger(20); slow.reset();
  assert.equal(slow.scale(20.1), 1, 'reset clears it');
  assert.equal(slow.trigger(NaN), false);
});
