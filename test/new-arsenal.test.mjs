import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, FLAMETHROWER, PICKUPS, FIRE_INTERVALS } from '../public/rules.js';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

function fixture(weapon = 'flamethrower', wave = 14) {
  const events = [], simulation = new RoomSimulation('ARSENAL', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.wave = wave - 1; simulation.beginWave(); simulation.spawnTimer = 999;
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon });
  player.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } };
  return { simulation, player, events };
}
function target(simulation, id, options = {}) {
  const zombie = { id, x: 12, y: 0, z: 5, yaw: 0, hp: 1000, maxHp: 1000, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...options };
  simulation.zombies.set(id, zombie); return zombie;
}
function burnFor(simulation, seconds, hz = 30) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) { simulation.time += 1 / hz; simulation.updateBurns(1 / hz); }
}

test('assault uses its own precise cadence, stock, range and two-target penetration without changing head multipliers', () => {
  const { simulation, player, events } = fixture('assault');
  const first = target(simulation, 'first'), second = target(simulation, 'second', { z: 3 }), third = target(simulation, 'third', { z: 1 });
  player.pitch = -.2;
  // A level body shot at feet raised .4m avoids the regular head zone.
  player.pitch = 0; for (const zombie of [first, second, third]) zombie.y = .4;
  assert.equal(simulation.shoot('a'), true);
  assert.equal(player.inventory.assault.ammo, 23); assert.equal(simulation.shoot('a'), false);
  assert.equal(first.hp, 1000, 'damage waits for arrival');
  advanceBallisticFlight(simulation, .1);
  assert.ok(Math.abs(1000 - first.hp - sampleBulletAtDistance(WEAPONS.assault, 2.68).damage) < 1e-5);
  assert.ok(Math.abs(1000 - second.hp - sampleBulletAtDistance(WEAPONS.assault, 4.68).damage * .6) < .01); assert.equal(third.hp, 1000);
  simulation.time = FIRE_INTERVALS.assault; assert.equal(simulation.shoot('a'), true);
  assert.equal(events.filter(event => event.event === 'shot').length, 2);
  assert.equal(simulation.snapshot().headshotMultiplier, 2.2);
  assert.equal(WEAPONS.assault.reloadTime, 1.6); assert.ok(WEAPONS.assault.range > 55, 'flight continues past the former damage cutoff');
});

test('a flame sweep ignites an exposed group, with 6.25 immediate and exactly 700 deferred damage at 30 and 10 Hz', () => {
  for (const hz of [30, 10]) {
    const { simulation, player, events } = fixture();
    // These bodies survive the complete burn so overkill cannot hide its integral.
    const first = target(simulation, 'first', { hp: 3000, maxHp: 3000 }), second = target(simulation, 'second', { x: 12.65, hp: 3000, maxHp: 3000 });
    const outsideCone = target(simulation, 'side', { x: 14 }), beyondRange = target(simulation, 'far', { z: 2 });
    assert.equal(simulation.shoot('a'), true);
    assert.equal(first.hp, 2993.75); assert.equal(second.hp, 2993.75);
    assert.equal(outsideCone.hp, 1000); assert.equal(beyondRange.hp, 1000);
    assert.equal(player.inventory.flamethrower.ammo, 79);
    assert.equal(simulation.snapshot().zombies.find(zombie => zombie.id === 'first').burnLeft, 4);
    burnFor(simulation, 4.2, hz);
    assert.ok(Math.abs(first.hp - 2293.75) < 1e-7, `${hz} Hz`); assert.ok(Math.abs(second.hp - 2293.75) < 1e-7);
    assert.equal(first.burnUntil, undefined); assert.equal(events.filter(event => event.event === 'kill').length, 0);
  }
});

test('fivefold original flame damage preserves cone, range, fuel, cadence, armor and a single refreshed burn', () => {
  assert.deepEqual([FLAMETHROWER.contactDps, FLAMETHROWER.burnDps], [10 * 5, 35 * 5], 'multiply the original damage once, never the previous experimental values');
  assert.deepEqual(FLAMETHROWER, { range: 6, fullDamageRange: 5, coneAngle: 40 * Math.PI / 180, contactDps: 50, burnDps: 175, burnDuration: 4 });
  assert.equal(FIRE_INTERVALS.flamethrower, .125);
  assert.deepEqual([WEAPONS.flamethrower.damage, WEAPONS.flamethrower.magazine, WEAPONS.flamethrower.reserve, WEAPONS.flamethrower.reloadTime], [6.25, 80, 40, 3]);
  const { simulation, player, events } = fixture();
  const normal = target(simulation, 'normal', { hp: 3000, maxHp: 3000 });
  const armored = target(simulation, 'armor', { x: 12.65, kind: 'armored', hp: 3000, maxHp: 3000 });
  assert.equal(simulation.shoot('a'), true);
  assert.equal(normal.hp, 2993.75); assert.equal(armored.hp, 2995.9375);
  assert.equal(simulation.shoot('a'), false); assert.equal(player.inventory.flamethrower.ammo, 79);
  burnFor(simulation, .1, 10);
  simulation.time += .025; simulation.updateBurns(.025);
  assert.equal(simulation.shoot('a'), true); assert.equal(player.inventory.flamethrower.ammo, 78);
  burnFor(simulation, 4.2);
  // Two contact pulses and 4.125 seconds of one burn, with 65% body damage
  // on armor. Refresh extends duration without adding a second burn stack.
  assert.ok(Math.abs(normal.hp - (3000 - 12.5 - 175 * 4.125)) < 1e-7);
  assert.ok(Math.abs(armored.hp - (3000 - (12.5 + 175 * 4.125) * .65)) < 1e-7);
  assert.equal(events.filter(event => event.event === 'shot').length, 2);
  assert.equal(events.filter(event => event.event === 'kill').length, 0);
  assert.equal(normal.burnUntil, undefined); assert.equal(armored.burnUntil, undefined);
});

test('repeat sweeps and two flamethrowers refresh one burn, retain the first igniter and award a death once', () => {
  const { simulation, player, events } = fixture();
  const teammate = simulation.addPlayer('b'); Object.assign(teammate, { x: player.x, z: player.z, weapon: 'flamethrower', yaw: 0, pitch: 0 });
  teammate.inventory = { flamethrower: { ammo: 80, reserve: 40 } };
  const zombie = target(simulation, 'shared', { hp: 375, maxHp: 375 });
  simulation.shoot('a'); simulation.shoot('b');
  assert.equal(zombie.hp, 362.5); assert.equal(zombie.burnOwnerId, 'a');
  burnFor(simulation, 1); assert.ok(Math.abs(zombie.hp - 187.5) < 1e-7);
  simulation.shoot('b'); assert.ok(Math.abs(zombie.burnUntil - simulation.time - 4) < 1e-8);
  burnFor(simulation, 2); simulation.updateBurns(.1);
  assert.equal(simulation.zombies.has(zombie.id), false); assert.equal(player.kills, 1); assert.equal(teammate.kills, 0);
  assert.equal(events.filter(event => event.event === 'kill').length, 1);
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'points').length, 1);
  assert.equal(events.find(event => event.event === 'kill').headshot, false);
});

test('flame damage does not cross the interior partition, a barricade or the loft floor', () => {
  for (const scenario of ['partition', 'board', 'floor']) {
    const { simulation, player, events } = fixture();
    let zombie;
    if (scenario === 'partition') { Object.assign(player, { x: -1, z: -1 }); zombie = target(simulation, 'hidden', { x: -1, z: -3 }); }
    if (scenario === 'board') { Object.assign(player, { x: 0, z: -4.5, crouched: true }); zombie = target(simulation, 'hidden', { x: 0, z: -7 }); }
    if (scenario === 'floor') { Object.assign(player, { x: 6, z: 3, pitch: Math.PI / 2 }); zombie = target(simulation, 'hidden', { x: 6, y: 3.4, z: 3 }); }
    simulation.shoot('a'); burnFor(simulation, 4);
    assert.equal(zombie.hp, 1000, scenario); assert.equal(zombie.burnUntil, undefined, scenario);
    if (scenario !== 'board') {
      const jet = events.find(event => event.event === 'shot').pellets[0];
      assert.equal(jet.stop, 'solid', scenario);
      assert.ok(jet.distance > 0 && jet.distance < FLAMETHROWER.range, `${scenario}: visible jet stops at the solid`);
    }
  }
});

test('the flame cone follows pitched aim through low and high body heights instead of the shooter eye level', () => {
  for (const pitch of [-.5, .5]) {
    const { simulation, player, events } = fixture();
    player.pitch = pitch;
    const zombie = target(simulation, 'pitched', { z: 6, y: pitch < 0 ? 0 : 2.2 });
    assert.equal(simulation.shoot('a'), true);
    assert.equal(zombie.hp, 993.75, `body crossed by the ${pitch < 0 ? 'descending' : 'ascending'} aim`);
    assert.equal(zombie.burnUntil, simulation.time + FLAMETHROWER.burnDuration);
    assert.equal(events.find(event => event.event === 'shot').hits, 1);
  }
  const { simulation, player } = fixture(); player.pitch = -.5;
  const missed = target(simulation, 'missed', { x: 14.5, z: 6 });
  simulation.shoot('a'); assert.equal(missed.hp, 1000); assert.equal(missed.burnUntil, undefined);
});

test('a burn continues without firing and clears on a new night; terminal phases never apply delayed damage', () => {
  const { simulation, player } = fixture(); const zombie = target(simulation, 'burning');
  simulation.shoot('a'); simulation.tick(.1);
  assert.ok(zombie.hp < 993.75, 'production tick applies the deferred burn');
  simulation.endGame(); const before = zombie.hp; simulation.tick(.1); assert.equal(zombie.hp, before);
  assert.equal(simulation.snapshot().zombies[0].burning, false);
  simulation.start(player.id); assert.equal(simulation.zombies.size, 0); assert.equal(player.weapon, 'pistol');
  assert.deepEqual(Object.keys(player.inventory), ['pistol']);
});

test('a rocket hits the authoritative aim, damages a group with radial falloff and never harms teammates', () => {
  const { simulation, player, events } = fixture('rocket');
  const first = target(simulation, 'first'), second = target(simulation, 'second', { x: 13 }), edge = target(simulation, 'edge', { x: 15 });
  const teammate = simulation.addPlayer('b'); Object.assign(teammate, { x: 12, z: 5 });
  assert.equal(simulation.shoot('a', { x: -999, z: -999 }), true);
  assert.equal(first.hp, 300); assert.equal(second.hp, 300);
  assert.ok(edge.hp > 300 && edge.hp < 1000); assert.equal(teammate.hp, 100); assert.equal(player.hp, 100);
  assert.equal(player.inventory.rocket.ammo, 0); assert.equal(player.inventory.rocket.reserve, 2);
  const shot = events.find(event => event.event === 'shot');
  assert.equal(shot.weapon, 'rocket'); assert.ok(shot.impact.z > first.z); assert.equal(shot.hits, 3);
  assert.equal(events.filter(event => event.event === 'explosion').length, 1);
  assert.equal(events.find(event => event.event === 'explosion').weapon, 'rocket');
  simulation.time = player.shotAfter; assert.equal(simulation.shoot('a'), false); assert.equal(player.reloadUntil, simulation.time + 2.8);
  simulation.time = player.reloadUntil; simulation.tick(0); assert.equal(player.inventory.rocket.ammo, 1); assert.equal(player.inventory.rocket.reserve, 1);
});

test('rocket blast protection includes walls, boards and floors, and one direct plank hit does not remove the barricade', () => {
  for (const scenario of ['partition', 'board', 'floor']) {
    const { simulation, player, events } = fixture('rocket');
    let zombie;
    if (scenario === 'partition') { Object.assign(player, { x: -1, z: -1 }); zombie = target(simulation, 'hidden', { x: -1, z: -3 }); }
    if (scenario === 'board') {
      simulation.doors.find(door => door.id === 'north').sealed = false; // Ordinary destructible barricade.
      Object.assign(player, { x: 0, z: -4.5, pitch: Math.atan2(1.34 - 1.55, 2.5) }); zombie = target(simulation, 'hidden', { x: 0, z: -7 });
    }
    if (scenario === 'floor') { Object.assign(player, { x: 6, z: 3, pitch: Math.PI / 2 }); zombie = target(simulation, 'hidden', { x: 6, y: 3.4, z: 3 }); }
    simulation.shoot('a'); assert.equal(zombie.hp, 1000, scenario);
    assert.equal(events.filter(event => event.event === 'explosion').length, 1, scenario);
    if (scenario === 'board') assert.equal(simulation.doors.find(door => door.id === 'north').boards.filter(hp => hp === 0).length, 1);
  }
});

test('rockets fired into open sky expire at range without creating a remote blast', () => {
  const { simulation, player, events } = fixture('rocket'); player.pitch = Math.PI / 3;
  simulation.shoot('a'); assert.equal(events.filter(event => event.event === 'explosion').length, 0);
  assert.equal(events.find(event => event.event === 'shot').pellets[0].stop, 'range');
});

test('new racks gate purchases, preserve two slots and drop exact stock for a teammate', () => {
  for (const weapon of ['assault', 'rocket', 'flamethrower']) {
    const crate = ARMORY.find(item => item.weapon === weapon), { simulation, player } = fixture('pistol', crate.unlockWave - 1);
    Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.2, z: crate.z + Math.cos(crate.facing) * 1.2, y: crate.y, points: 9999 });
    player.inventory.rifle = { ammo: 7, reserve: 19 }; player.weapon = 'rifle';
    assert.equal(simulation.buyWeapon('a', crate.id), false); assert.equal(player.points, 9999);
    simulation.wave = crate.unlockWave;
    simulation.time = player.interactAfter;
    assert.equal(simulation.buyWeapon('a', crate.id), true, weapon);
    assert.equal(player.points, 9999 - crate.price); assert.equal(player.weapon, weapon); assert.equal(Object.keys(player.inventory).length, 2);
    const dropped = [...simulation.pickups.values()].find(pickup => pickup.kind === 'weapon');
    assert.equal(dropped.weapon, 'rifle'); assert.equal(dropped.ammo, 7); assert.equal(dropped.reserve, 19);
    const teammate = simulation.addPlayer('b'); Object.assign(teammate, { x: dropped.x, y: dropped.y, z: dropped.z });
    assert.equal(simulation.takeGroundWeapon('b', dropped.id), true); assert.deepEqual(teammate.inventory.rifle, { ammo: 7, reserve: 19 });
  }
});

test('special ammunition is scarce during waves, partial fuel boxes remain and ordinary paired refill remains unchanged', () => {
  assert.equal(PICKUPS.ammo.rocket, 0); assert.equal(PICKUPS.ammo.flamethrower, 0);
  const { simulation, player } = fixture(); Object.assign(player, { x: 0, z: 2 });
  player.inventory = { flamethrower: { ammo: 80, reserve: 38 }, rocket: { ammo: 1, reserve: 2 } };
  const box = { id: 'fuel', kind: 'ammo', x: 0, y: 0, z: 2, special: true, amount: 1, charge: PICKUPS.ammoCharge, expiresAt: simulation.time + 90 };
  simulation.pickups.set(box.id, box); simulation.collectPickups();
  assert.equal(player.inventory.flamethrower.reserve, 40); assert.equal(box.charge, PICKUPS.ammoCharge - 2 * (PICKUPS.ammoCharge / 12));
  assert.equal(simulation.pickups.has(box.id), true);
  player.inventory.flamethrower.reserve = 0; player.inventory.rocket.reserve = 0;
  simulation.finishWave(); assert.deepEqual(player.inventory.flamethrower, { ammo: 80, reserve: 40 });
  assert.deepEqual(player.inventory.rocket, { ammo: 1, reserve: 2 });
});

test('the Gatling still penetrates four bodies and special ammunition adds no unlimited damage stack', () => {
  assert.equal(WEAPONS.minigun.penetrationTargets, 4); assert.equal(WEAPONS.minigun.penetrationRetention, .7);
  assert.equal(FLAMETHROWER.burnDps * FLAMETHROWER.burnDuration, 700);
  const { simulation } = fixture('minigun');
  const bodies = Array.from({ length: 5 }, (_, index) => target(simulation, `body${index}`, { y: .4, z: 6 - index * 2 }));
  simulation.setMinigunSpin('a', true); simulation.time += 1;
  assert.equal(simulation.shoot('a'), true);
  advanceBallisticFlight(simulation, .2);
  const damage = bodies.map(zombie => 1000 - zombie.hp);
  assert.ok(damage.slice(0, 4).every(amount => amount > 0)); assert.equal(damage[4], 0);
  for (let index = 1; index < 4; index++) assert.ok(damage[index] / damage[index - 1] < .7 && damage[index] / damage[index - 1] > .68,
    '70% retained energy, then smooth distance decay');
});

test('deferred burning integrates each interval once and preserves credit if its igniter leaves', () => {
  const { simulation, events } = fixture(), zombie = target(simulation, 'orphan', { hp: 350, maxHp: 350 });
  simulation.addPlayer('b'); simulation.shoot('a'); simulation.time += .1; simulation.updateBurns(.1);
  const once = zombie.hp; simulation.updateBurns(.1); assert.equal(zombie.hp, once);
  simulation.removePlayer('a'); burnFor(simulation, 3);
  assert.equal(simulation.zombies.size, 0); assert.equal(events.filter(event => event.event === 'kill').length, 1);
  assert.equal(events.find(event => event.event === 'kill').id, 'a');
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'points').length, 1);
});

test('a rocket group kill awards exactly one drop per enemy and carries no headshot or ally damage bonus', () => {
  const { simulation, player, events } = fixture('rocket');
  const first = target(simulation, 'first', { hp: 700 }), second = target(simulation, 'second', { x: 13, hp: 700 });
  simulation.shoot('a');
  assert.equal(simulation.zombies.has(first.id), false); assert.equal(simulation.zombies.has(second.id), false);
  assert.equal(player.kills, 2); assert.equal(events.filter(event => event.event === 'kill').length, 2);
  assert.ok(events.filter(event => event.event === 'kill').every(event => event.headshot === false));
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'points').length, 2);
});

test('empty, reloading, downed, dead and terminal new weapons cannot spend ammunition or ignite an enemy', () => {
  for (const weapon of ['assault', 'rocket', 'flamethrower']) for (const scenario of ['empty', 'reload', 'downed', 'dead', 'lobby', 'gameover', 'extraction', 'victory']) {
    const { simulation, player, events } = fixture(weapon), zombie = target(simulation, 'untouched');
    if (scenario === 'empty') player.inventory[weapon].ammo = 0;
    if (scenario === 'reload') player.reloadUntil = 99;
    if (scenario === 'downed') player.downed = true;
    if (scenario === 'dead') player.alive = false;
    if (['lobby', 'gameover', 'extraction', 'victory'].includes(scenario)) simulation.phase = scenario;
    const stock = structuredClone(player.inventory[weapon]);
    assert.equal(simulation.shoot('a'), false, `${weapon} ${scenario}`);
    assert.deepEqual(player.inventory[weapon], stock); assert.equal(zombie.hp, 1000); assert.equal(zombie.burnUntil, undefined);
    assert.equal(events.filter(event => event.event === 'shot' || event.event === 'explosion').length, 0);
  }
});

test('all three new guns can be dropped and exchanged without losing their exact separate stock', () => {
  for (const weapon of ['assault', 'rocket', 'flamethrower']) {
    const { simulation, player } = fixture(weapon), teammate = simulation.addPlayer('b');
    player.inventory[weapon] = { ammo: 1, reserve: 2 };
    assert.equal(simulation.dropWeapon('a'), true);
    const pickup = [...simulation.pickups.values()].find(pickup => pickup.kind === 'weapon');
    assert.equal(pickup.weapon, weapon); assert.equal(pickup.ammo, 1); assert.equal(pickup.reserve, 2);
    Object.assign(teammate, { x: pickup.x, y: pickup.y, z: pickup.z });
    assert.equal(simulation.takeGroundWeapon('b', pickup.id), true); assert.deepEqual(teammate.inventory[weapon], { ammo: 1, reserve: 2 });
    assert.equal(simulation.takeGroundWeapon('b', pickup.id), false);
  }
});
