import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD, damageFalloff } from '../simulation.mjs';
import { FLAMETHROWER, FIRE_INTERVALS } from '../public/rules.js';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

function fixture() {
  const events = [], simulation = new RoomSimulation('PRACT1', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  return { simulation, player, events };
}
function advance(simulation, seconds, hz = 30) {
  for (let step = 0; step < Math.round(seconds * hz); step++) simulation.tick(1 / hz);
}
function action(simulation, type, weapon, id = 'a') {
  simulation.time += .25;
  return simulation.practiceAction(id, { action: type, weapon });
}

test('practice is an explicit isolated room mode, with five readable real targets and two stocked weapons', () => {
  for (const practice of [undefined, false, 1, 'true', {}]) {
    const normal = new RoomSimulation('NORMAL', { practice }); normal.addPlayer('a');
    assert.equal(normal.snapshot().practice, false); assert.equal(normal.phase, 'lobby');
    assert.equal(normal.zombies.size, 0); assert.equal(normal.practiceAction('a', { action: 'weapon', weapon: 'rocket' }), false);
    assert.deepEqual(Object.keys(normal.players.get('a').inventory), ['pistol']);
    assert.equal(normal.start('a'), true);
  }
  const { simulation, player } = fixture(), state = simulation.snapshot();
  assert.equal(state.practice, true); assert.equal(state.phase, 'wave'); assert.equal(state.wave, 0);
  assert.equal(state.practiceTargets, 5); assert.equal(state.toSpawn, 0);
  assert.deepEqual(state.zombies.map(zombie => zombie.maxHp), [80, 165, 400, 700, 1400]);
  assert.deepEqual([player.x, player.y, player.z, player.yaw], [-5, 0, 1.7, 0]);
  assert.equal(player.weapon, 'assault'); assert.deepEqual(Object.keys(player.inventory), ['assault', 'rocket']);
  for (const weapon of Object.keys(player.inventory)) assert.deepEqual(player.inventory[weapon], { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve });
  for (const zombie of simulation.zombies.values()) assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29 * zombie.scale), true);
});

test('practice actions validate weapons, preserve the other slot, enforce cooldown and affect only their caller', () => {
  const { simulation, player } = fixture(); const teammate = simulation.addPlayer('b');
  player.inventory.rocket.ammo = 0; player.inventory.rocket.reserve = 1;
  for (const message of [null, [], {}, { action: 'other' }, { action: 'weapon', weapon: 'constructor' }, { action: 'weapon', weapon: {} }])
    assert.equal(simulation.practiceAction('a', message), false);
  assert.equal(simulation.practiceAction('missing', { action: 'refill' }), false);
  assert.equal(simulation.practiceAction('a', { action: 'weapon', weapon: 'flamethrower', id: 'b' }), true);
  assert.deepEqual(Object.keys(player.inventory), ['flamethrower', 'rocket']);
  assert.deepEqual(player.inventory.rocket, { ammo: 0, reserve: 1 });
  assert.equal(teammate.weapon, 'assault'); assert.deepEqual(Object.keys(teammate.inventory), ['assault', 'rocket']);
  assert.equal(simulation.practiceAction('a', { action: 'refill' }), false);
  assert.equal(player.inventory.rocket.ammo, 0);
  assert.equal(action(simulation, 'weapon', 'rocket'), true);
  assert.equal(player.inventory.rocket.ammo, 0, 'equipping an owned weapon never refills it');
  for (const weapon of Object.keys(WEAPONS)) {
    assert.equal(action(simulation, 'weapon', weapon), true, weapon);
    assert.equal(player.weapon, weapon); assert.ok(Object.keys(player.inventory).length <= 2);
  }
  assert.equal(player.points, 0); assert.equal(simulation.pickups.size, 0);
});

test('practice shooting uses real headshots, penetration, cadence and timed reload; refill cancels reload', () => {
  const { simulation, player, events } = fixture(); const targets = [...simulation.zombies.values()];
  assert.equal(simulation.shoot('a'), true);
  assert.equal(player.inventory.assault.ammo, 23); assert.equal(simulation.shoot('a'), false);
  assert.equal(targets[0].hp, 80, 'practice uses the real flight delay');
  advanceBallisticFlight(simulation, .1);
  assert.equal(simulation.zombies.has(targets[0].id), false, '80 HP front walker dies to a real headshot');
  assert.ok(Math.abs(targets[3].hp - (700 - sampleBulletAtDistance(WEAPONS.assault, 5.5 - .32 * 1.22).damage * .6)) < .01,
    'second body receives retained damage');
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie').length, 2); assert.equal(simulation.pickups.size, 0);
  simulation.time += FIRE_INTERVALS.assault;
  assert.equal(simulation.shoot('a'), true);
  assert.equal(simulation.reload('a'), true); assert.equal(simulation.shoot('a'), false);
  const finish = player.reloadUntil; simulation.tick(.1); assert.ok(player.reloadUntil > simulation.time);
  simulation.time = finish; simulation.tick(0);
  assert.deepEqual(player.inventory.assault, { ammo: 24, reserve: 70 });
  player.inventory.assault.ammo = 2; player.inventory.assault.reserve = 3;
  simulation.reload('a'); assert.equal(action(simulation, 'refill'), true);
  assert.equal(player.reloadUntil, 0); assert.deepEqual(player.inventory.assault, { ammo: 24, reserve: 72 });
  assert.deepEqual(player.inventory.rocket, { ammo: 1, reserve: 2 });
});

test('practice flame burns in production ticks, targets reset removes old burns and killed targets never auto-respawn', () => {
  for (const hz of [30, 10]) {
    const { simulation, player, events } = fixture(); action(simulation, 'weapon', 'flamethrower'); simulation.time = player.shotAfter;
    assert.equal(simulation.shoot('a'), true);
    const burning = [...simulation.zombies.values()].filter(zombie => zombie.burnUntil > simulation.time);
    assert.equal(burning.length, 5, 'the extra 5–6 m fringe now reaches the two rear brutes');
    const fullDamage = FLAMETHROWER.contactDps * FIRE_INTERVALS.flamethrower
      + FLAMETHROWER.burnDps * FLAMETHROWER.burnDuration;
    const expectedDamage = new Map(burning.map(zombie => {
      // Every practice body contains the horizontal eye ray. Range is therefore
      // its horizontal centre distance; no armor or head multiplier applies.
      const range = Math.hypot(zombie.x - player.x, zombie.z - player.z);
      const u = Math.max(0, Math.min(1, 6 - range));
      return [zombie.id, fullDamage * (6 * u ** 5 - 15 * u ** 4 + 10 * u ** 3)];
    }));
    const doomed = burning.filter(zombie => zombie.maxHp < expectedDamage.get(zombie.id));
    assert.equal(doomed.length, 3, 'the three front targets still die to one exposure');
    advance(simulation, 4.2, hz);
    for (const zombie of doomed) assert.equal(simulation.zombies.has(zombie.id), false, `${zombie.maxHp} HP target dies`);
    assert.deepEqual(events.filter(event => event.event === 'kill').map(event => event.zombieId).sort(),
      doomed.map(zombie => zombie.id).sort(), 'one real death per target, without respawn');
    assert.equal(simulation.zombies.size, 2); assert.equal(simulation.pickups.size, 0);
    for (const zombie of simulation.zombies.values()) assert.ok(Math.abs(zombie.hp - (zombie.maxHp - expectedDamage.get(zombie.id))) < 1e-7, 'rear brutes survive the independently calculated fringe burn');
    assert.equal(simulation.phase, 'wave'); assert.equal(simulation.wave, 0);

    // Aim at the existing 1,400 HP brute from inside the real five-metre range.
    // Its normal HP lets production ticks integrate the whole burn without an
    // immortal target, altered rules or an early reset hiding damage.
    const resistant = [...simulation.zombies.values()].find(zombie => zombie.maxHp === 1400);
    const hpBeforeNearContact = resistant.hp;
    Object.assign(player, { x: resistant.x, z: resistant.z + 4.5, yaw: 0, pitch: 0 });
    assert.equal(simulation.shoot('a'), true);
    assert.ok(resistant.burnUntil > simulation.time);
    advance(simulation, 4.2, hz);
    assert.equal(simulation.zombies.has(resistant.id), true);
    assert.ok(Math.abs(resistant.hp - (hpBeforeNearContact - fullDamage)) < 1e-7, 'full contact + four-second burn at both tick rates');
    assert.equal(resistant.burnUntil, undefined);
    assert.equal(simulation.pickups.size, 0); assert.equal(player.points, 0);

    assert.equal(simulation.shoot('a'), true);
    assert.ok(resistant.burnUntil > simulation.time, 'reset is exercised with a live burn');
    assert.equal(action(simulation, 'targets'), true); assert.equal(simulation.zombies.size, 5);
    assert.equal(simulation.zombies.has(resistant.id), false);
    assert.ok([...simulation.zombies.values()].every(zombie => zombie.hp === zombie.maxHp && zombie.burnUntil === undefined));
    advance(simulation, 5, hz); assert.ok([...simulation.zombies.values()].every(zombie => zombie.hp === zombie.maxHp));
    simulation.zombies.clear(); advance(simulation, 20, hz);
    assert.equal(simulation.zombies.size, 0); assert.equal(simulation.phase, 'wave'); assert.equal(simulation.wave, 0);
  }
});

test('practice rocket explodes at impact against the real group, with real magazine and no friendly damage', () => {
  const { simulation, player, events } = fixture(); const teammate = simulation.addPlayer('b');
  assert.equal(action(simulation, 'weapon', 'rocket'), true); simulation.time = player.shotAfter;
  assert.equal(simulation.shoot('a'), true); assert.equal(player.inventory.rocket.ammo, 0);
  assert.equal(events.filter(event => event.event === 'explosion' && event.weapon === 'rocket').length, 1);
  assert.ok(simulation.zombies.size < 5); assert.equal(simulation.pickups.size, 0);
  assert.equal(player.hp, 100); assert.equal(teammate.hp, 100);
  assert.equal(simulation.reload('a'), true); assert.equal(player.reloadUntil - simulation.time, 2.8);
  advance(simulation, 2.9); assert.deepEqual(player.inventory.rocket, { ammo: 1, reserve: 1 });
});

test('practice targets never navigate or attack, while movement keeps solid collisions and survivors are invulnerable', () => {
  const { simulation, player, events } = fixture(); const before = simulation.snapshot().zombies;
  advance(simulation, 30);
  assert.deepEqual(simulation.snapshot().zombies, before); assert.equal(player.hp, 100);
  assert.ok(simulation.doors.every(door => door.hp === door.maxHp));
  const startZ = player.z;
  simulation.setInput('a', { forward: .5, strafe: 0, yaw: 0, pitch: 0 }); advance(simulation, .5);
  assert.ok(player.z < startZ, 'same server movement as the game');
  Object.assign(player, { x: 0, y: 0, z: -1.4, grounded: true });
  for (let step = 0; step < 30; step++) {
    simulation.setInput('a', { forward: 1, strafe: 0, yaw: 0, pitch: 0 }); simulation.tick(1 / 30);
  }
  assert.ok(player.z > -2, 'central screen still blocks movement');
  simulation.damagePlayer(player, 1000, { source: 'fall' }); assert.equal(player.hp, 100); assert.equal(player.downed, false);
  Object.assign(player, { x: 10, z: 8, y: 0 }); advance(simulation, 10);
  assert.equal(simulation.outsideDamageActive(player), false); assert.equal(player.hp, 100);
  Object.assign(player, { x: -5, z: 1.7, y: WORLD.loftY, vy: 0, grounded: false, fallStartY: WORLD.loftY });
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); advance(simulation, 2);
  assert.equal(player.y, 0); assert.equal(player.hp, 100);
  assert.equal(events.some(event => event.event === 'hit' || event.event === 'down'), false);
});

test('practice cannot enter progression or terminal phases, including an empty stand', () => {
  const { simulation } = fixture();
  for (const change of [() => simulation.start('a'), () => simulation.beginWave(), () => simulation.finishWave(), () => simulation.beginExtraction(), () => simulation.endGame(), () => simulation.spawnZombie()]) assert.equal(change(), false);
  simulation.zombies.clear(); simulation.removePlayer('a'); advance(simulation, 20);
  assert.equal(simulation.phase, 'wave'); assert.equal(simulation.wave, 0); assert.equal(simulation.toSpawn, 0);
  assert.equal(simulation.zombies.size, 0); assert.equal(simulation.pickups.size, 0);
});

test('the raider drill is a practice-only, idempotent squad of two that alternates west and east', () => {
  const normal = new RoomSimulation('NORMAL'); normal.addPlayer('a'); normal.start('a');
  assert.equal(normal.practiceAction('a', { action: 'raiders' }), false, 'campaign rooms reject the drill');
  assert.equal([...normal.zombies.values()].some(zombie => zombie.kind === 'raider'), false);
  const { simulation, events } = fixture();
  const raiders = () => [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
  assert.equal(action(simulation, 'raiders'), true);
  let squad = raiders();
  assert.deepEqual(squad.map(raider => [raider.id, raider.loadout, raider.drill, raider.x, raider.z]),
    [['r1', 'smg', true, -24, -2.5], ['r2', 'assault', true, -24, 2.5]], '16 m outside the west door');
  const raid = events.filter(event => event.event === 'raid').at(-1);
  assert.deepEqual([raid.drill, raid.side, raid.total], [true, 'west', 2]);
  assert.deepEqual(events.at(-1), { ...events.at(-1), event: 'practice', id: 'a', action: 'raiders' });
  let state = simulation.snapshot();
  assert.equal(state.practiceTargets, 5, 'raiders are not practice targets');
  assert.deepEqual(state.zombies.filter(zombie => zombie.faction === 'raider').map(zombie => zombie.weapon), ['smg', 'assault']);
  assert.equal(simulation.practiceAction('a', { action: 'raiders' }), false, 'the shared practice cooldown applies');
  assert.equal(action(simulation, 'raiders'), true);
  squad = raiders();
  assert.deepEqual(squad.map(raider => [raider.id, raider.x, raider.z]), [['r3', 24, -2.5], ['r4', 24, 2.5]], 'a new press replaces the squad on the east side');
  assert.equal(events.filter(event => event.event === 'raid').at(-1).side, 'east');
  assert.equal(action(simulation, 'raiders'), true); assert.equal(raiders().length, 2);
  assert.ok(raiders().every(raider => raider.x < 0), 'back to the west');
  advance(simulation, 5);
  assert.ok(simulation.doors.every(door => door.hp === door.maxHp)); assert.equal(simulation.phase, 'wave');
  assert.ok([...simulation.zombies.values()].filter(zombie => zombie.kind !== 'raider').every(zombie => zombie.hp === zombie.maxHp));
  assert.equal(action(simulation, 'targets'), true);
  assert.deepEqual([raiders().length, simulation.zombies.size, simulation.raidWarnings.size], [0, 5, 0], 'the targets reset removes the drill');
  state = simulation.snapshot();
  assert.deepEqual([state.raid, state.practiceTargets], [null, 5]);
});

test('drill raiders report hits without harm, never touch health and drop no loot when killed', () => {
  const { simulation, player, events } = fixture();
  action(simulation, 'raiders');
  const [raider] = [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
  simulation.damagePlayer(player, 7, raider);
  const hit = events.at(-1);
  assert.deepEqual(hit, { ...hit, event: 'drill-hit', id: 'a', raiderId: raider.id, fromX: -24, fromZ: -2.5, damage: 7 });
  simulation.damagePlayer(player, 7, { ...raider, drill: false });
  assert.equal(events.at(-1), hit, 'only drill raiders report in the stand');
  assert.deepEqual([player.hp, player.armor, player.downed], [100, 0, false]);
  assert.equal(events.some(event => event.event === 'hit' || event.event === 'down'), false);
  assert.equal(simulation.damageSpecialZombie(raider, 1e4, 'a', { x: -1, z: 0 }, 'assault', true, true), true);
  assert.equal(events.filter(event => event.event === 'kill').at(-1).raider, true);
  assert.equal(simulation.pickups.size, 0); assert.equal(player.points, 0);
});

test('a survivor who drops both practice weapons can equip again without losing the two-slot limit', () => {
  const { simulation, player } = fixture();
  assert.equal(simulation.dropWeapon('a'), true); simulation.time += 1;
  assert.equal(simulation.dropWeapon('a'), true); assert.equal(player.weapon, null);
  assert.equal(action(simulation, 'weapon', 'assault'), true);
  assert.equal(player.weapon, 'assault'); assert.deepEqual(Object.keys(player.inventory), ['assault']);
  assert.deepEqual(player.inventory.assault, { ammo: 24, reserve: 72 });
});
