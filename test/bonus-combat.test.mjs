import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';
import { MAX_WAVES, waveBalance, waveAtDifficultyLevel } from '../public/rules.js';
import { BRUTE_HEALTH, enemyHealth } from '../public/enemies.js';
import { settleBallisticFlight, advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

function room({ weapon = 'rifle', random = () => 0.5 } = {}) {
  const events = [];
  const simulation = new RoomSimulation('BONUS1', { random, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice');
  simulation.start(player.id);
  // Fixtures equip a purchased bonus without coupling combat to crate pricing.
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 });
  if (weapon === 'minigun') { assert.equal(simulation.setMinigunSpin(player.id, true), true); simulation.time += MINIGUN_WINDUP; }
  return { simulation, player, events };
}

function target(simulation, id, options = {}) {
  const zombie = { id, x: 0, y: 0.4, z: -2, hp: 1000, maxHp: 1000, kind: 'walker', scale: 1, ...options };
  simulation.zombies.set(id, zombie);
  return zombie;
}

function spawnBrute(simulation, wave = waveAtDifficultyLevel(5)) {
  simulation.wave = wave - 1;
  simulation.beginWave();
  while (simulation.toSpawn > 0) {
    const zombie = simulation.spawnZombie();
    simulation.toSpawn--;
    if (zombie.kind === 'brute') return zombie;
  }
  throw new Error('The wave must contain a brute');
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 2e-4, `Expected ${actual} to equal ${expected}`);
}

test('wave quotas deterministically introduce one late brute at wave 4 and two at wave 6', () => {
  for (const players of [1, 4]) {
    for (const random of [() => 0, () => 0.99]) {
      for (const wave of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 20]) {
        const { simulation } = room({ random });
        for (let i = 1; i < players; i++) simulation.addPlayer(`p${i}`);
        simulation.wave = wave - 1;
        simulation.beginWave();
        const total = simulation.toSpawn;
        assert.equal(total, waveBalance(wave, players).total, 'Brutes replace ordinary zombies in the established wave size');
        const quota = wave >= 6 ? 2 : wave >= 4 ? 1 : 0;
        const indices = [];
        for (let index = 1; index <= total; index++) {
          const zombie = simulation.spawnZombie();
          simulation.toSpawn--;
          if (zombie.kind === 'brute') indices.push(index);
        }
        assert.deepEqual(indices, [0.55, 0.8].slice(0, quota).map(fraction => Math.ceil(total * fraction)), `wave ${wave}, ${players} players`);
        assert.equal(simulation.brutesToSpawn, 0);
        assert.equal(simulation.zombies.size, total);
      }
    }
  }
});

test('brutes use a fixed health family, attack harder and fit through a breached doorway', () => {
  const { simulation, player } = room();
  const brute = spawnBrute(simulation, 8);
  assert.equal(brute.hp, enemyHealth(8, simulation.waveSpawned, 'brute'));
  assert.ok(BRUTE_HEALTH.includes(brute.hp), 'The brute belongs to one of the fixed visible health families');
  assert.equal(brute.maxHp, brute.hp);
  assert.equal(brute.speed, 0.8);
  assert.equal(brute.scale, 1.22);
  assert.equal(brute.damage, 32);
  assert.equal(brute.barricadeDamage, 36);
  assert.equal(brute.attackInterval, 1.2);
  assert.ok(1.82 * brute.scale < 2.8, 'The brute hitbox must fit under the rendered door lintel');
  assert.ok(0.64 * brute.scale < 2.6, 'The brute hitbox must fit between the door posts');
  Object.assign(brute, { x: 0, z: -6.68, doorId: 'north', attackAfter: 0 });
  const door = simulation.doors.find(door => door.id === 'north');
  door.sealed = false; // This geometry fixture exercises an ordinary active barricade.
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(door.hp, door.maxHp - 36);
  simulation.time = 1.19;
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(door.hp, door.maxHp - 36, 'A brute must respect its barricade attack interval');
  // Reinforced 300-HP barricade: nine 36-damage blows instead of four.
  const blows = Math.ceil(door.maxHp / 36);
  assert.equal(blows, 9);
  for (let blow = 1; blow < blows; blow++) {
    simulation.time = brute.attackAfter;
    simulation.updateZombie(brute, 1 / 30, [player]);
  }
  assert.equal(door.hp, 0);
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(brute.entered, true);
  for (let tick = 0; tick < 90; tick++) simulation.updateZombie(brute, 1 / 30, [player]);
  assert.ok(brute.z > -5.5, 'The brute must actually pass through the opening after breaking it');
});

test('a brute deals 32 melee damage every 1.2 seconds', () => {
  const { simulation, player } = room();
  const brute = spawnBrute(simulation);
  Object.assign(brute, { x: 0.4, z: 1, y: 0, entered: true, entryTarget: null, attackAfter: 0 });
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(player.hp, 68);
  simulation.time = 1.19;
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(player.hp, 68);
  simulation.time = 1.2;
  simulation.updateZombie(brute, 1 / 30, [player]);
  assert.equal(player.hp, 36);
});

test('the finite golden Magnum kills a full-health brute on arrival and stops there', () => {
  const { simulation, player, events } = room({ weapon: 'magnum' });
  const brute = target(simulation, 'brute', { kind: 'brute', scale: 1.22, y: 0, hp: 1400, maxHp: 1400 });
  const rear = target(simulation, 'rear', { z: -4 });
  assert.equal(simulation.shoot(player.id), true);
  assert.equal(brute.hp, 1400, 'no damage before arrival');
  assert.equal(simulation.shoot(player.id), false, 'cadence blocks a duplicate before flight is advanced');
  settleBallisticFlight(simulation);
  assert.ok(brute.hp <= 0);
  assert.equal(simulation.zombies.has(brute.id), false);
  assert.equal(rear.hp, 1000);
  assert.equal(player.inventory.magnum.ammo, 5);
  assert.equal(player.kills, 1);
  assert.equal(player.score, 1400, 'the score is the health removed: the 1400 HP it had (owner, 18 October)');
  assert.equal(player.points, 0);
  assert.equal(simulation.snapshot().pickups[0].amount, 60);
  assert.equal(events.find(event => event.event === 'kill').headshot, false);
  assert.equal(simulation.shoot(player.id), false);
});

test('the golden magnum still cannot kill through a solid exterior wall', () => {
  const { simulation, player } = room({ weapon: 'magnum' });
  Object.assign(player, { x: 3, z: -3 });
  const brute = target(simulation, 'brute', { x: 3, z: -8, y: 0, kind: 'brute', scale: 1.22, hp: 625 });
  simulation.shoot(player.id);
  settleBallisticFlight(simulation);
  assert.equal(brute.hp, 625);
  assert.equal(player.kills, 0);
});

test('brute hitboxes and headshots follow their larger visible scale', () => {
  const { simulation, player, events } = room();
  Object.assign(player, { x: 0.38, y: 0.55 });
  const brute = target(simulation, 'brute', { x: 0, z: -2, y: 0, kind: 'brute', scale: 1.22, hp: 50 });
  const ordinary = target(simulation, 'ordinary', { x: 0, z: -4, y: 0 });
  simulation.shoot(player.id);
  settleBallisticFlight(simulation);
  assert.equal(simulation.zombies.has(brute.id), false, 'The enlarged head and shoulders must accept a visible hit');
  assert.equal(ordinary.hp, 1000, 'An ordinary zombie has neither the same width nor the same height');
  assert.equal(events.find(event => event.event === 'kill').headshot, true);
  assert.equal(player.score, 50, 'its last 50 HP, without a head-shot score');
  assert.equal(player.points, 0);
  assert.equal(simulation.snapshot().pickups[0].amount, 90);
});

test('the minigun penetrates four bodies with decreasing damage and server cooldown', () => {
  const { simulation, player, events } = room({ weapon: 'minigun' });
  // Keep all five bodies in a clear outdoor lane, with the same impact distances.
  Object.assign(player, { x: -10, z: 5 });
  const targets = [2, 0, -2, -4, -6].map((z, index) => target(simulation, `z${index}`, { x: -10, z }));
  assert.ok([player, ...targets].every(body => simulation.canOccupy(body, body.x, body.z, body.y, .25)));
  assert.equal(simulation.shoot(player.id), true);
  assert.equal(simulation.shoot(player.id), false);
  const hits = settleBallisticFlight(simulation).impacts.filter(hit => hit.stop === 'zombie');
  for (let index = 0; index < 4; index++) close(targets[index].hp, 1000 - WEAPONS.minigun.damage * damageFalloff(WEAPONS.minigun, 2.68 + 2 * index) * 0.7 ** index);
  assert.equal(targets[4].hp, 1000);
  assert.equal(events.find(event => event.event === 'shot').hits, 0);
  assert.equal(hits.length, 4);
  assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.magazine - 1);
  assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.magazine - 1);
});

test('the minigun empties its magazine, waits for reload and consumes finite reserve', () => {
  const { simulation, player } = room({ weapon: 'minigun' });
  for (let shot = 0; shot < WEAPONS.minigun.magazine; shot++) {
    assert.equal(simulation.shoot(player.id), true);
    advanceBallisticFlight(simulation, WEAPONS.minigun.interval + 0.00001);
  }
  assert.equal(player.inventory.minigun.ammo, 0);
  assert.equal(player.inventory.minigun.reserve, WEAPONS.minigun.reserve);
  assert.equal(simulation.shoot(player.id), false);
  assert.equal(player.reloadUntil, simulation.time + WEAPONS.minigun.reloadTime);
  assert.equal(simulation.shoot(player.id), false);
  simulation.time = player.reloadUntil;
  simulation.tick(0);
  assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.reserve);
  assert.equal(player.inventory.minigun.reserve, 0);
  assert.equal(simulation.setMinigunSpin(player.id, true), true); simulation.time += MINIGUN_WINDUP;
  assert.equal(simulation.shoot(player.id), true);
  assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.reserve - 1);
});

function finalBoss(simulation) {
  simulation.wave = MAX_WAVES - 1;
  simulation.beginWave();
  while (simulation.toSpawn > 0) {
    const zombie = simulation.spawnZombie();
    simulation.toSpawn--;
    if (zombie.boss) return zombie;
  }
  throw new Error('The final wave must contain its boss');
}

test('only the final wave replaces its second brute with one late boss without increasing enemy counts', () => {
  for (const players of [1, 4]) {
    for (const wave of [MAX_WAVES - 1, MAX_WAVES]) {
      const { simulation } = room();
      for (let index = 1; index < players; index++) simulation.addPlayer(`p${index}`);
      simulation.wave = wave - 1;
      simulation.beginWave();
      const balance = waveBalance(wave, players);
      const bosses = [];
      for (let spawn = 1; spawn <= balance.total; spawn++) {
        const zombie = simulation.spawnZombie();
        simulation.toSpawn--;
        if (zombie.boss) bosses.push({ zombie, spawn });
      }
      assert.equal(simulation.zombies.size, balance.total);
      assert.equal([...simulation.zombies.values()].filter(zombie => zombie.kind === 'brute').length, 2);
      assert.equal(bosses.length, wave === MAX_WAVES ? 1 : 0);
      if (wave === MAX_WAVES) {
        assert.equal(bosses[0].spawn, Math.ceil(balance.total * .8));
        assert.equal(bosses[0].zombie.hp, 6000);
        assert.equal(bosses[0].zombie.scale, 1.32);
        assert.equal(bosses[0].zombie.kind, 'brute');
        assert.equal(simulation.snapshot().zombies.filter(zombie => zombie.boss).length, 1);
      }
    }
  }
});

test('the final boss deals 40 melee damage every 1.3 seconds and fits through a cleared doorway', () => {
  const { simulation, player } = room();
  const boss = finalBoss(simulation);
  Object.assign(boss, { x: .4, z: 1, y: 0, entered: true, attackAfter: 0 });
  simulation.updateZombie(boss, 1 / 30, [player]);
  assert.equal(player.hp, 60);
  simulation.time = 1.29;
  simulation.updateZombie(boss, 1 / 30, [player]);
  assert.equal(player.hp, 60);
  simulation.time = 1.3;
  simulation.updateZombie(boss, 1 / 30, [player]);
  assert.equal(player.hp, 20);
  assert.ok(1.82 * boss.scale < 2.8);
  assert.ok(.64 * boss.scale < 2.6);
  const door = simulation.doors[0];
  door.sealed = false; // Boss clearance through an active doorway, independent of party seals.
  door.boards = [0, 0, 0, 0, 24];
  assert.equal(simulation.doorPassable(door, 0, 1.82 * boss.scale), false);
  door.hp = 0;
  assert.equal(simulation.canOccupy(boss, 0, -6, 0, .32 * boss.scale), true);
  Object.assign(player, { x: 0, y: 0, z: -4, hp: 100 });
  Object.assign(boss, { x: 0, y: 0, z: -6.75, entered: false, portalRoute: null, navigation: null });
  for (let tick = 0; tick < 90; tick++) simulation.updateZombie(boss, 1 / 30, [player]);
  assert.ok(boss.z > -5.5, 'The larger boss must actually traverse the cleared portal');
});

test('finite 2000-power Magnum rounds defeat the boss in four close body hits and preserve remaining stock', () => {
  const { simulation, player, events } = room({ weapon: 'magnum' });
  const boss = finalBoss(simulation);
  simulation.zombies.clear();
  player.x = -4.4;
  Object.assign(boss, { x: -4.4, y: 0, z: -3 });
  simulation.zombies.set(boss.id, boss);
  assert.equal(boss.hp, 6000);
  const range = 4 - .32 * boss.scale;
  const damage = WEAPONS.magnum.damage * Math.exp(-2 * WEAPONS.magnum.bulletPhysics.drag * range);
  for (let shot = 1; shot <= 4; shot++) {
    simulation.time = Math.max(simulation.time, player.shotAfter);
    assert.equal(simulation.shoot(player.id), true);
    settleBallisticFlight(simulation);
    close(boss.hp, 6000 - shot * damage);
    assert.equal(simulation.zombies.has(boss.id), shot < 4, 'the first three body rounds leave the boss alive');
  }
  assert.ok(boss.hp < 0);
  assert.equal(simulation.zombies.size, 0);
  assert.equal(player.inventory.magnum.ammo, 2);
  assert.equal(player.inventory.magnum.reserve, 0);
  const kill = events.find(event => event.event === 'kill');
  assert.equal(kill.boss, true);
  assert.equal(kill.headshot, false);
});

test('the visible upper boss helmet accepts headshots while shots above it still miss', () => {
  const { simulation, player } = room();
  const boss = finalBoss(simulation);
  simulation.zombies.clear();
  player.x = -4.4;
  Object.assign(boss, { x: -4.4, y: 0, z: -3 });
  simulation.zombies.set(boss.id, boss);
  // The helmet reaches 2.515 m; its upper face is above the movement body.
  player.pitch = Math.atan2(2.47 - 1.55, 3.7822);
  assert.equal(simulation.shoot(player.id), true);
  const hit = settleBallisticFlight(simulation).impacts.find(hit => hit.zombieId === boss.id);
  assert.equal(hit.headshot, true);
  const k = WEAPONS.rifle.bulletPhysics.drag, v = WEAPONS.rifle.bulletPhysics.muzzleSpeed;
  const distance = Math.log1p(k * v * hit.age) / k;
  close(boss.hp, boss.maxHp - WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, distance) * waveBalance(MAX_WAVES, 1).headshotMultiplier);
  const damagedHp = boss.hp;
  simulation.time = Math.max(simulation.time, player.shotAfter);
  player.pitch = Math.atan2(2.63 - 1.55, 3.7822);
  assert.equal(simulation.shoot(player.id), true);
  settleBallisticFlight(simulation);
  assert.equal(boss.hp, damagedHp, 'The taller head hitbox must not accept shots above the helmet');
  assert.equal(player.inventory.rifle.ammo, WEAPONS.rifle.magazine - 2);
});
