import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { fireTolerance } from '../public/rules.js';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';

const angles = shot => shot.projectiles.map(p => ({ yaw: Math.atan2(-p.vx, -p.vz), pitch: Math.asin(p.vy / Math.hypot(p.vx, p.vy, p.vz)) }));
const bodyHits = simulation => settleBallisticFlight(simulation).impacts.filter(hit => hit.stop === 'zombie' && !hit.visualOnly);
const shellDamage = distance => 9 * WEAPONS.shotgun.damage * Math.exp(-2 * WEAPONS.shotgun.bulletPhysics.drag * distance);

function range(random = () => .5) {
  const events = [];
  const simulation = new RoomSimulation('CONE', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  Object.assign(player, { weapon: 'shotgun', x: 12, y: 0, z: 10, yaw: 0, pitch: 0 });
  player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve };
  simulation.random = random;
  const fire = () => {
    assert.equal(simulation.shoot(player.id), true);
    return events.filter(event => event.event === 'shot').at(-1);
  };
  return { simulation, player, events, fire };
}

function target(simulation, id, x, z, hp = 10000) {
  const zombie = { id, x, y: .4, z, kind: 'walker', scale: 1, hp, maxHp: hp, speed: 0, attackAfter: Infinity };
  simulation.zombies.set(id, zombie);
  return zombie;
}

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('the heavier shotgun blast keeps one shell, slow cadence and two-body penetration', () => {
  const weapon = WEAPONS.shotgun;
  assert.equal(weapon.pellets, 9);
  assert.ok(Math.abs(weapon.damage * Math.exp(-2 * weapon.bulletPhysics.drag * 10) - 16.457142815816333) < 1e-8);
  assert.equal(weapon.spread, .11);
  assert.equal(weapon.interval, .85);
  assert.equal(weapon.penetrationTargets, 2);
  assert.ok(Math.abs(weapon.penetrationRetention - .45) < 1e-15);
  const { simulation, player, events, fire } = range();
  const initial = { ...player.inventory.shotgun };
  assert.equal(fire().projectiles.length, 9);
  assert.equal(player.inventory.shotgun.ammo, initial.ammo - 1);
  assert.equal(player.inventory.shotgun.reserve, initial.reserve);
  // Delivery jitter up to fireTolerance().early is absorbed; anything earlier
  // is refused, and the slot still holds the slow cadence over time.
  const { early } = fireTolerance(weapon.interval);
  simulation.time += weapon.interval - early - .001;
  assert.equal(simulation.shoot(player.id), false);
  assert.equal(player.inventory.shotgun.ammo, initial.ammo - 1);
  assert.equal(events.filter(event => event.event === 'shot').length, 1);
  simulation.time += .001;
  assert.equal(fire().projectiles.length, 9);
  assert.equal(player.inventory.shotgun.ammo, initial.ammo - 2);
});

test('shotgun corner samples stay inside a disk and the exact center stays on aim', () => {
  for (const [horizontal, vertical] of [[.5, .5], [.999999, .999999], [.000001, .999999], [.000001, .000001], [.999999, .000001]]) {
    let index = 0;
    const samples = [horizontal, vertical];
    const { player, fire } = range(() => samples[index++ % 2]);
    Object.assign(player, { yaw: .4, pitch: -.2 });
    for (const pellet of angles(fire())) {
      const angularRadius = Math.hypot(pellet.yaw - player.yaw, pellet.pitch - player.pitch);
      assert.ok(angularRadius <= WEAPONS.shotgun.spread + .0008, `angular radius ${angularRadius}`);
      if (horizontal === .5 && vertical === .5) assert.ok(angularRadius < 1e-15);
    }
  }
});

test('seeded shotgun pellets fill both axes and disk area without a center bias', () => {
  const { simulation, player, fire } = range(seeded(20261009));
  const samples = [];
  for (let shot = 0; shot < 300; shot++) {
    player.inventory.shotgun.ammo = WEAPONS.shotgun.magazine;
    samples.push(...angles(fire()));
    settleBallisticFlight(simulation, { step: 1 / 30 });
    simulation.time = Math.max(simulation.time, player.shotAfter);
  }
  const spread = WEAPONS.shotgun.spread;
  const radialSquared = samples.map(pellet => (pellet.yaw ** 2 + pellet.pitch ** 2) / spread ** 2);
  assert.ok(radialSquared.every(value => value <= 1.015), 'rounded network angles stay within the cone');
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(mean(radialSquared) - .5) < .035, 'uniform disk area has mean normalized radius squared 1/2');
  assert.ok(Math.abs(mean(samples.map(pellet => pellet.yaw))) < .004);
  assert.ok(Math.abs(mean(samples.map(pellet => pellet.pitch))) < .004);
  assert.ok(samples.some(pellet => pellet.yaw > .095) && samples.some(pellet => pellet.yaw < -.095));
  assert.ok(samples.some(pellet => pellet.pitch > .095) && samples.some(pellet => pellet.pitch < -.095));
  for (const horizontal of [-1, 1]) for (const vertical of [-1, 1]) {
    const count = samples.filter(pellet => Math.sign(pellet.yaw) === horizontal && Math.sign(pellet.pitch) === vertical).length;
    assert.ok(count > samples.length * .21 && count < samples.length * .29, 'all quadrants receive pellets');
  }
  const center = radialSquared.filter(value => value < .25).length / samples.length;
  assert.ok(center > .21 && center < .29, 'a quarter of pellets occupy the inner quarter of disk area');
});

test('one wider shell can hit a close crowd on both sides of the reticle', () => {
  // Nine positions across the blast, sampled deterministically. The flank
  // bodies start beyond the previous .075 rad horizontal spread at 5.8 m.
  const pairs = [[.001, .5], [.999, .5], [.5, .5], [.05, .45], [.95, .45], [.05, .55], [.95, .55], [.5, .4], [.5, .6]];
  let index = 0;
  const draws = pairs.flat();
  const { simulation, fire } = range(() => draws[index++ % draws.length]);
  const crowd = [11.15, 12, 12.85].map((x, id) => target(simulation, `crowd-${id}`, x, 4.2));
  const shot = fire();
  const hits = bodyHits(simulation);
  assert.ok(crowd.every(zombie => zombie.hp < zombie.maxHp), 'left, middle and right bodies all receive real damage');
  assert.equal(shot.hits, 0, 'shot only launches pellets');
  assert.equal(hits.length, 9);
  assert.ok(hits.every(hit => !hit.killed));
  assert.ok(crowd[0].x + .32 < 12 - Math.tan(.075) * 5.48, 'left flank is outside the old spread');
  assert.ok(crowd[2].x - .32 > 12 + Math.tan(.075) * 5.48, 'right flank is outside the old spread');
});

test('full close body impacts hit harder while distant pellets retain their steep falloff', () => {
  const near = range(), far = range();
  const close = target(near.simulation, 'near', 12, 7);
  const distant = target(far.simulation, 'far', 12, -10);
  near.fire(); far.fire();
  bodyHits(near.simulation); bodyHits(far.simulation);
  const closeDamage = close.maxHp - close.hp, farDamage = distant.maxHp - distant.hp;
  assert.ok(Math.abs(closeDamage - shellDamage(2.68)) < 1e-4);
  assert.ok(closeDamage > 250, 'full close shell retains heavy contact power');
  assert.ok(Math.abs(farDamage - shellDamage(19.68)) < 1e-4, `${farDamage} vs ${shellDamage(19.68)}`);
  assert.ok(farDamage < closeDamage * .4);
});

test('real shotgun shells follow one smooth exponential from contact through medium range', () => {
  let previous = Infinity;
  for (const distance of [.5, 1, 2.5, 4, 6, 10]) {
    const { simulation, fire } = range();
    // Distance is measured to the entry face of the body, not its centre.
    const zombie = target(simulation, 'body', 12, 10 - distance - .32);
    fire(); const hits = bodyHits(simulation);
    assert.equal(hits.length, 9);
    const damage = zombie.maxHp - zombie.hp;
    assert.ok(Math.abs(damage - shellDamage(distance)) < 1e-4, `${distance} m`);
    assert.ok(damage < previous); previous = damage;
  }
  for (const boundary of [1, 4]) {
    assert.ok(Math.abs(damageFalloff(WEAPONS.shotgun, boundary - .0001)
      - damageFalloff(WEAPONS.shotgun, boundary + .0001)) < .00002, 'no damage step at former bonus boundaries');
  }
});

test('each penetrated shotgun body loses energy and keeps the two-body limit', () => {
  const { simulation, fire } = range();
  const targets = [.5, 4, 6].map((distance, id) => target(simulation, `body-${id}`, 12, 10 - distance - .32));
  fire(); const hits = bodyHits(simulation);
  assert.equal(hits.length, 18);
  assert.ok(Math.abs(targets[0].maxHp - targets[0].hp - shellDamage(.5)) < 1e-4);
  assert.ok(Math.abs(targets[1].maxHp - targets[1].hp - .45 * shellDamage(4)) < .001, 'rear body retains only 45 percent at its own distance');
  assert.equal(targets[2].hp, targets[2].maxHp);
});

test('single-projectile weapons retain their previous independent-axis dispersion', () => {
  for (const name of ['pistol', 'rifle', 'smg', 'magnum']) {
    const { player, fire } = range(() => .999999);
    player.weapon = name;
    player.inventory[name] = { ammo: WEAPONS[name].magazine, reserve: WEAPONS[name].reserve };
    const shot = fire(), pellet = angles(shot)[0];
    assert.equal(shot.projectiles.length, 1);
    assert.ok(Math.abs(pellet.yaw - WEAPONS[name].spread) <= .00051);
    assert.ok(Math.abs(pellet.pitch - WEAPONS[name].spread) <= .00051);
  }
});
