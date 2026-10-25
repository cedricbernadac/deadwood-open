import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, MAX_WAVES, waveBalance, killCash, waveAtDifficultyLevel } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { ENEMY_HEALTH, enemyHealth, enemyProfile, enemyVariant, enemyHitbox, enemyHeadshot } from '../public/enemies.js';
import { formationTrial, idealUnlockedLoadout } from '../validation/balance-report.mjs';

function room(wave = 1, players = 1, random = () => .5) {
  const events = [];
  const simulation = new RoomSimulation('VAR123', { random, onEvent: event => events.push(event) });
  for (let index = 0; index < players; index++) simulation.addPlayer(`p${index}`);
  simulation.start('p0'); simulation.wave = wave - 1; simulation.beginWave();
  return { simulation, player: simulation.players.get('p0'), events };
}

function target(kind, { hp = 1000, z = -2 } = {}) {
  return { id: kind, x: -4.4, y: 0, z, hp, maxHp: hp, kind, scale: 1, speed: 1, yaw: 0, attackAfter: 0, entered: true };
}

function shot(kind, height, weapon = 'rifle', hp = 1000) {
  const { simulation, player, events } = room();
  Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: Math.atan2(height - 1.55, 3), weapon });
  player.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } };
  const zombie = target(kind, { hp }); zombie.x = player.x; simulation.zombies.set(zombie.id, zombie);
  assert.equal(simulation.shoot(player.id), true); advanceBallisticFlight(simulation, .1);
  return { simulation, player, events, zombie };
}

// The score is the useful damage (owner, 18 October): whole points, the
// fraction of a point carried to the next hit.
const points = removed => Math.floor(removed.reduce((sum, amount) => sum + amount, 0) + 1e-9);

test('crawler and armored replace walkers progressively without changing runners or brute quotas', () => {
  for (const players of [1, 4]) {
    for (const wave of [1, 2, 3, 4, 5, 6, 10, MAX_WAVES]) {
      const { simulation } = room(wave, players);
      const balance = waveBalance(wave, players), spawned = [];
      for (let count = 0; count < balance.total; count++) spawned.push(simulation.spawnZombie());
      assert.equal(spawned.length, balance.total);
      assert.equal(spawned.filter(zombie => zombie.kind === 'brute').length, balance.brutes);
      assert.equal(spawned.filter(zombie => zombie.boss).length, balance.bosses);
      const crawlers = spawned.filter(zombie => zombie.kind === 'crawler'), armored = spawned.filter(zombie => zombie.kind === 'armored');
      assert.equal(crawlers.length > 0, wave >= waveAtDifficultyLevel(4));
      assert.equal(armored.length > 0, wave >= waveAtDifficultyLevel(7));
      assert.ok(crawlers.length <= Math.ceil(balance.total * .12));
      assert.ok(armored.length <= Math.ceil(balance.total * .12));
      for (const [index, zombie] of spawned.entries()) {
        assert.equal(zombie.hp, enemyHealth(wave, index + 1, zombie.kind, zombie.boss));
        assert.equal(zombie.maxHp, zombie.hp);
      }
      assert.ok(crawlers.every(zombie => ENEMY_HEALTH.some(hp => zombie.hp === Math.round(hp * .45)) && zombie.damage === 8 && zombie.attackInterval === .65));
      assert.ok(armored.every(zombie => ENEMY_HEALTH.includes(zombie.hp)));
      for (const heads of [false, true]) {
        const actual = spawned.reduce((sum, zombie) => sum + killCash(zombie, heads), 0);
        const ordinary = (balance.total - balance.brutes) * (heads ? 24 : 18)
          + (balance.brutes - balance.bosses) * (heads ? 90 : 60) + balance.bosses * (heads ? 150 : 100);
        assert.equal(actual, ordinary, 'Variants introduce no additional cash');
      }
    }
  }
  for (let ordinal = 1; ordinal <= waveBalance(MAX_WAVES, 4).total; ordinal++) assert.equal(enemyVariant(MAX_WAVES, ordinal, true), 'runner');
  const { simulation } = room(MAX_WAVES, 1, () => 0);
  const spawned = Array.from({ length: waveBalance(MAX_WAVES).total }, () => simulation.spawnZombie());
  assert.equal(spawned.filter(zombie => zombie.kind === 'runner').length, waveBalance(MAX_WAVES).total - waveBalance(MAX_WAVES).brutes, 'Real runner selection takes priority over all replacement slots');
  assert.ok(spawned.filter(zombie => zombie.kind === 'runner').every(zombie => ENEMY_HEALTH.includes(zombie.hp) && zombie.damage === 14));
});

test('armored keeps the exposed head and its health family while reducing body damage only', () => {
  const body = shot('armored', 1.1), normalBody = shot('walker', 1.1);
  assert.ok(Math.abs((1000 - body.zombie.hp) / (1000 - normalBody.zombie.hp) - .65) < 1e-10);
  const head = shot('armored', 1.65), normalHead = shot('walker', 1.65);
  assert.equal(head.zombie.hp, normalHead.zombie.hp);
  assert.equal(head.player.score, points([1000 - head.zombie.hp]), 'the damage dealt, without a head-shot score');
  assert.equal(body.player.points, 0);
  for (const height of [1.1, 1.65]) {
    const kill = shot('armored', height, 'magnum');
    assert.equal(kill.simulation.zombies.size, 0, 'A close finite Magnum hit still kills this armored target');
    assert.equal(kill.simulation.snapshot().pickups[0].amount, height > 1.48 ? 24 : 18);
  }
});

test('crawler silhouette, head threshold and real bullet intersections require low aim', () => {
  const miss = shot('crawler', 1.55);
  assert.equal(miss.zombie.hp, 1000, 'A standing-height headshot passes above the low body');
  assert.equal(miss.player.score, 0);
  const body = shot('crawler', .38), head = shot('crawler', .66);
  assert.ok(body.zombie.hp < 1000);
  assert.ok(Math.abs((1000 - head.zombie.hp) / (1000 - body.zombie.hp) - waveBalance(1).headshotMultiplier) < .001, 'head multiplier with the small difference in slanted flight distance');
  assert.equal(enemyHitbox(target('crawler')).maxY, .82);
  assert.equal(enemyHeadshot(target('crawler'), .58), false);
  assert.equal(enemyHeadshot(target('crawler'), .581), true);
  const kill = shot('crawler', .66, 'rifle', 1);
  assert.equal(kill.simulation.snapshot().pickups[0].amount, 24);
  assert.equal(kill.events.find(event => event.event === 'kill').headshot, true);
});

test('mixed-height penetration still resolves the physical order and independently applies armor and heads', () => {
  const { simulation, player, events } = room();
  Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: Math.atan2(.66 - 1.55, 3), weapon: 'rifle' });
  player.inventory = { rifle: { ammo: 30, reserve: 90 } };
  const front = target('crawler'), rear = target('armored', { z: -4 });
  simulation.zombies.set(rear.id, rear); simulation.zombies.set(front.id, front);
  simulation.shoot(player.id); advanceBallisticFlight(simulation, .1);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie').length, 2);
  assert.ok(front.hp < rear.hp, 'The first low head gets full damage; the rear armored torso gets retained and reduced damage');
  assert.equal(player.score, points([1000 - front.hp, 1000 - rear.hp]));
  assert.equal(player.points, 0);
});

test('crawler melee is weaker and quicker, and its real height can use two broken lower planks', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 0, y: 0, z: 1 });
  const crawler = target('crawler', { z: 1 }); crawler.x = .4;
  simulation.zombies.set(crawler.id, crawler);
  simulation.updateZombie(crawler, 1 / 30, [player]);
  assert.equal(player.hp, 92);
  simulation.time = .64; simulation.updateZombie(crawler, 1 / 30, [player]);
  assert.equal(player.hp, 92);
  simulation.time = .65; simulation.updateZombie(crawler, 1 / 30, [player]);
  assert.equal(player.hp, 84);
  player.y = 1; simulation.time = 1.3; simulation.updateZombie(crawler, 1 / 30, [player]);
  assert.equal(player.hp, 84, 'A low crawler cannot bite through an elevated player foot position');
  player.y = 0;
  const door = simulation.doors[0]; door.sealed = false; // Ordinary active plank-height fixture.
  door.boards[0] = 0; door.boards[1] = 0;
  assert.equal(simulation.doorPassable(door, 0, enemyProfile(crawler).height), true);
  assert.equal(simulation.doorPassable(door, 0, enemyProfile({kind: 'walker'}).height), false);
  Object.assign(crawler, { x: 0, y: 0, z: -6.7, portalRoute: null, navigation: null });
  Object.assign(player, { x: 0, z: -4.5 });
  for (let index = 0; index < 120; index++) simulation.moveZombieThroughDoor(crawler, player, 1 / 30);
  assert.ok(crawler.z > -5.5, `Crawler must cross the visible lower gap, actual z=${crawler.z}`);
  const state = simulation.snapshot().zombies[0];
  assert.equal(state.kind, 'crawler'); assert.equal(state.height, .82); assert.equal(state.headHeight, .66);
});

test('real mixed composition retains a finite aligned-head route with hypothetically financed but unlocked loadouts', () => {
  for (const players of [1, 2, 3, 4]) {
    for (let wave = 1; wave <= MAX_WAVES; wave++) {
      // This is an enemy-composition ammunition fixture, not an economy test:
      // assume the selected legal guns were financed; never bypass their gate.
      const weapons = idealUnlockedLoadout(wave);
      const trial = formationTrial({ wave, players, variants: true, weapons });
      assert.equal(trial.remaining, 0, `${players} players, wave ${wave}: ${JSON.stringify(trial)}`);
      assert.ok(trial.ammoLeft > 0);
      assert.equal(trial.enemies, waveBalance(wave, players).total);
      assert.equal(trial.composition.brute, waveBalance(wave, players).brutes);
      assert.deepEqual(trial.weapons, weapons);
      assert.ok(weapons.every(weapon => wave >= ARMORY.find(rack => rack.weapon === weapon).unlockWave));
    }
    assert.ok(formationTrial({ players, variants: true, pickups: false }).remaining > 0, 'Variants do not remove the need to collect ammunition late');
    assert.ok(formationTrial({ players, variants: true, heads: false }).remaining > 0, 'Lower crawler HP does not make body shots alone sufficient late');
  }
});

const { createZombie, animateZombie } = await importPublicModule('world.js');

test('real models distinguish crawling bodies and torso plates without enlarging the armored head', () => {
  const walker = createZombie(), armored = createZombie('armored'), crawler = createZombie('crawler');
  const height = group => new THREE.Box3().setFromObject(group).max.y;
  assert.ok(height(crawler) <= .825);
  assert.ok(height(walker) > 1.8);
  assert.equal(armored.userData.head.position.y, walker.userData.head.position.y);
  // Scavenged plates and their straps are merged meshes of their own.
  assert.ok(armored.getObjectByName('zombieArmor') && armored.getObjectByName('zombieArmorStraps'));
  assert.equal(walker.getObjectByName('zombieArmor'), undefined);
  for (const time of [0, .1, .2, .3, .4, .5]) {
    crawler.userData.phase = 0; crawler.userData.attackAt = 0;
    animateZombie(crawler, time, true);
    assert.ok(height(crawler) < .85, 'Attack and locomotion keep the crawler low');
  }
  assert.notEqual(crawler.userData.leftLeg.rotation.x, walker.userData.leftLeg.rotation.x);
});
