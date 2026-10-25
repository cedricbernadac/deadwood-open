import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { ARMORY, STARTER_WEAPON, STARTER_WEAPONS, ARMORY_REACH, ARMORY_HEIGHT_REACH, ECONOMY, killCash } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

const STARTERS = ['pistol', 'rifle', 'shotgun', 'smg'];

function room(startingWeapon = STARTER_WEAPON) {
  const events = [];
  const simulation = new RoomSimulation('BUY123', { random: () => 0.5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice', startingWeapon);
  simulation.start('a');
  return { simulation, player, events };
}

function crateFor(weapon) { return ARMORY.find(crate => crate.weapon === weapon); }

function approach(player, crate) {
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1 });
  // Approach the two southwest racks from separate sides of their corner.
  if (crate.weapon === 'minigun') Object.assign(player, { x: crate.x + .67, z: crate.z - 1.05 });
  // Approach the pistol directly from the room, clear of both nearby racks.
  if (crate.weapon === 'pistol') player.x = crate.x + .8;
}

function inventoryState(player) {
  return structuredClone({ points: player.points, score: player.score, weapon: player.weapon, inventory: player.inventory });
}

// The score is the health removed (owner, 18 October): a 1000-HP body
// killed by the Magnum is 1000 points whatever it is and wherever it is hit.
test('fixed cash rewards distinguish body, head, brute and final boss; the score is the health removed', () => {
  assert.deepEqual(ECONOMY, { kill: 18, headshot: 24, brute: 60, bruteHeadshot: 90, boss: 100, bossHeadshot: 150, repair: 1, revive: 25 });
  for (const [kind, boss, headshot, cash, score] of [
    ['walker', false, false, 18, 1000], ['walker', false, true, 24, 1000],
    ['brute', false, false, 60, 1000], ['brute', false, true, 90, 1000],
    ['brute', true, false, 100, 1000], ['brute', true, true, 150, 1000],
  ]) {
    const { simulation, player } = room();
    player.weapon = 'magnum';
    player.inventory.magnum = { ammo: 6, reserve: 0 };
    Object.assign(player, { x: 0, y: headshot && kind === 'brute' ? .55 : 0, z: 1, yaw: 0, pitch: 0 });
    const zombie = { id: 'reward', x: 0, y: !headshot && kind === 'walker' ? .4 : 0, z: -2, hp: 1000, maxHp: boss ? 6000 : 1000, kind, boss, scale: boss ? 1.32 : kind === 'brute' ? 1.22 : 1 };
    simulation.zombies.set(zombie.id, zombie);
    assert.equal(killCash(zombie, headshot), cash);
    assert.equal(simulation.shoot(player.id), true); advanceBallisticFlight(simulation, .1);
    assert.equal(player.score, score);
    assert.equal(player.points, 0, 'Cash still has to be collected physically');
    assert.equal(simulation.snapshot().pickups[0].amount, cash);
  }
});

test('extra wounds and shotgun pellets increase score but cannot print additional spendable cash', () => {
  for (const name of ['pistol', 'rifle', 'shotgun']) {
    for (const shots of [0, 3]) {
      const { simulation, player } = room();
      player.weapon = name;
      player.inventory = Object.fromEntries([name, 'magnum'].map(weapon => [weapon, { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve }]));
      Object.assign(player, { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 });
      const zombie = { id: 'wounded', x: 0, y: .4, z: -2, hp: 10000, maxHp: 10000, kind: 'walker' };
      simulation.zombies.set(zombie.id, zombie);
      for (let shot = 0; shot < shots; shot++) {
        Object.assign(zombie, { x: 0, z: -2 });
        simulation.time = player.shotAfter;
        assert.equal(simulation.shoot(player.id), true); advanceBallisticFlight(simulation, .1);
        assert.equal(simulation.pickups.size, 0);
        assert.equal(player.points, 0);
      }
      // Every pellet's damage, in whole points; the fractions are carried.
      const dealt = 10000 - zombie.hp;
      assert.ok(Math.abs(player.score + player.scoreCarry - dealt) < 1e-6, `${name}: ${player.score} for ${dealt} HP`);
      if (shots) assert.ok(player.score > 0);
      const before = player.score;
      simulation.chooseWeapon(player.id, 'magnum');
      simulation.time = player.shotAfter;
      Object.assign(zombie, { x: 0, z: -2, hp: 1000 }); // Finite Magnum finishing blow; earlier wounds only exercised score.
      assert.equal(simulation.shoot(player.id), true); advanceBallisticFlight(simulation, .1);
      assert.ok(player.score - before >= 999 && player.score - before <= 1000, 'the finishing blow scores the 1000 HP left');
      assert.equal(simulation.snapshot().pickups[0].amount, 18, `${name}, ${shots} previous shots: only the final body-kill cash drops`);
    }
  }
});

test('shared armory preserves rack locations and explicitly defines the twenty-wave price ladder', () => {
  assert.deepEqual(WORLD.armory, ARMORY);
  assert.equal(ARMORY.length, 14);
  assert.equal(new Set(ARMORY.map(crate => crate.id)).size, 14);
  for (const [weapon, price, x, z, y, unlockWave] of [
    ['pistol', 200, -6.3, 5.82, 0, 1], ['shotgun', 350, 7.82, -5.15, 0, 2], ['bat', 250, -7.82, -3.6, 0, 3], ['katana', 1200, 5.6, 5.82, 3.4, 9],
    ['smg', 900, 7.82, 5.15, 0, 4], ['assault', 1400, 3, -5.82, 3.4, 6], ['rifle', 1800, -7.82, -5.15, 0, 8],
    ['flamethrower', 2600, 3, 5.82, 3.4, 10], ['minigun', 2800, -7.82, 5.15, 0, 12],
    ['magnum', 3500, 7.82, -4.1, 3.4, 14], ['rocket', 5000, 7.82, 0, 3.4, 16],
    ['hammer', 1000, 5.6, -5.82, 3.4, 7], ['sniper', 3200, 7.82, 4.1, 3.4, 13],
    ['fireaxe', 600, 4.8, -5.79, 0, 5],
  ]) {
    const crate = crateFor(weapon);
    assert.ok(crate);
    assert.equal(crate.price, price);
    assert.equal(crate.x, x);
    assert.equal(crate.z, z);
    assert.equal(crate.y, y);
    assert.equal(crate.unlockWave ?? 0, unlockWave ?? 0);
  }
});

test('everyone starts with the same free pistol despite a legacy weapon selection', () => {
  assert.equal(STARTER_WEAPON, 'pistol');
  assert.deepEqual(STARTER_WEAPONS, ['pistol']);
  for (const weapon of STARTERS) {
    const { simulation, player } = room(weapon);
    assert.equal(player.startingWeapon, 'pistol');
    assert.equal(player.weapon, 'pistol');
    assert.deepEqual(Object.keys(player.inventory), ['pistol']);
    assert.equal(player.points, 0);
    assert.equal(player.score, 0);
    assert.deepEqual(player.inventory.pistol, { ammo: WEAPONS.pistol.magazine, reserve: WEAPONS.pistol.reserve });
    const publicPlayer = simulation.snapshot().players[0];
    assert.equal(publicPlayer.points, 0);
    assert.deepEqual(publicPlayer.ownedWeapons, ['pistol']);
    const locked = 'rifle';
    assert.equal(simulation.chooseWeapon(player.id, locked), false);
    assert.equal(player.weapon, 'pistol');
  }
});

test('forged, malformed and purchased weapon names cannot change the free starting pistol', () => {
  for (const weapon of ['rifle', 'shotgun', 'smg', 'minigun', 'magnum', '__proto__', 'constructor', null, {}, 123]) {
    const { player } = room(weapon);
    assert.equal(player.startingWeapon, 'pistol');
    assert.equal(player.weapon, 'pistol');
    assert.deepEqual(Object.keys(player.inventory), ['pistol']);
    assert.equal(player.points, 0);
  }
});

test('combat earns score immediately but money must be collected before purchases; help pays directly', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: -4.4, y: 0, z: 1.5, yaw: 0, pitch: 0 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: -4.4, y: 0, z: -3, hp: 40, entered: true, entryTarget: null });
  assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .1);
  assert.equal(player.points, 0);
  assert.equal(player.score, 40, 'the 40 HP it had, no kill or head-shot score');
  assert.equal(simulation.snapshot().pickups[0].amount, 24);
  Object.assign(player, { z: -2.5 });
  simulation.tick(0);
  assert.equal(player.points, 24);
  Object.assign(player, { x: 0, y: 0, z: -5 });
  simulation.doors[0].hp = 30;
  assert.equal(simulation.interact('a'), true);
  assert.equal(player.points, 25);
  assert.equal(player.score, 65, 'a repair scores the 25 HP the zombies broke and it put back');
  simulation.time += 1;
  const teammate = simulation.addPlayer('b', 'Bob');
  Object.assign(teammate, { x: 0, y: 0, z: -4, hp: 0, alive: true, downed: true, bleedOutAt: simulation.time + 25 });
  assert.equal(completeRevive(simulation, 'a'), true);
  assert.equal(player.points, 50);
  assert.equal(player.score, 65, 'the revive bonus waits for the end of the wave');
  assert.deepEqual(simulation.reviveCredits.map(({ reviverId, revivedId, open }) => [reviverId, revivedId, open]), [['a', 'b', true]]);
  assert.equal(simulation.snapshot().players.find(item => item.id === 'a').points, 50);
});

test('E buys the nearby crate weapon at its server price while score is preserved', () => {
  for (const crate of ARMORY) {
    if (crate.weapon === 'pistol') continue;
    const starter = 'pistol';
    const { simulation, player, events } = room(starter);
    simulation.wave = crate.unlockWave ?? 1;
    player.points = crate.price + 127;
    player.score = crate.price + 127;
    approach(player, crate);
    assert.equal(simulation.interact('a'), true);
    assert.equal(player.points, 127);
    assert.equal(player.score, crate.price + 127);
    assert.equal(player.weapon, crate.weapon);
    assert.deepEqual(Object.keys(player.inventory).sort(), [starter, crate.weapon].sort());
    assert.deepEqual(player.inventory[crate.weapon], { ammo: WEAPONS[crate.weapon].magazine, reserve: WEAPONS[crate.weapon].reserve });
    const purchase = events.find(event => event.event === 'purchase');
    assert.ok(purchase);
    assert.equal(purchase.id, player.id);
    assert.equal(purchase.crateId, crate.id);
    assert.equal(purchase.weapon, crate.weapon);
    assert.equal(purchase.price, crate.price);
    assert.equal(purchase.points, 127);
  }
});

test('an acquired weapon can be equipped again without another charge or free ammunition', () => {
  const { simulation, player } = room();
  const crate = crateFor('shotgun');
  simulation.wave = crate.unlockWave;
  approach(player, crate);
  player.points = crate.price + 300;
  player.score = 2000;
  assert.equal(simulation.buyWeapon('a', crate.id), true);
  Object.assign(player.inventory.shotgun, { ammo: 3, reserve: 9 });
  simulation.time += 1;
  assert.equal(simulation.chooseWeapon('a', 'pistol'), true);
  assert.equal(simulation.buyWeapon('a', crate.id), true);
  assert.equal(player.weapon, 'shotgun');
  assert.equal(player.points, 300);
  assert.equal(player.score, 2000);
  assert.deepEqual(player.inventory.shotgun, { ammo: 3, reserve: 9 });
});

test('purchases reject insufficient points, wrong floor, distance, incapacity and invalid crates', () => {
  const crate = crateFor('shotgun');
  for (const scenario of ['funds', 'distance', 'floor', 'downed', 'dead', 'lobby', 'gameover', 'invalid']) {
    const { simulation, player, events } = room();
    simulation.wave = crate.unlockWave;
    approach(player, crate);
    player.points = crate.price;
    player.score = 2000;
    if (scenario === 'funds') player.points = crate.price - 1;
    if (scenario === 'distance') player.x += 4;
    if (scenario === 'floor') player.y = WORLD.loftY;
    if (scenario === 'downed') player.downed = true;
    if (scenario === 'dead') player.alive = false;
    if (scenario === 'lobby' || scenario === 'gameover') simulation.phase = scenario;
    const before = inventoryState(player);
    assert.equal(simulation.buyWeapon('a', scenario === 'invalid' ? '__proto__' : crate.id), false, scenario);
    assert.deepEqual(inventoryState(player), before, scenario);
    if (scenario === 'funds') {
      const denied = events.find(event => event.event === 'purchase-denied');
      assert.ok(denied);
      assert.equal(denied.id, 'a');
      assert.equal(typeof denied.message, 'string');
      assert.ok(denied.message.length > 0);
    }
  }
  const { simulation } = room();
  assert.equal(simulation.buyWeapon('missing', crate.id), false);
});

test('two survivors buy independently from the same permanent crate', () => {
  const { simulation, player } = room();
  const teammate = simulation.addPlayer('b', 'Bob');
  const crate = crateFor('shotgun');
  simulation.wave = crate.unlockWave;
  for (const survivor of [player, teammate]) {
    approach(survivor, crate);
    survivor.points = crate.price;
    survivor.score = crate.price;
    assert.equal(simulation.buyWeapon(survivor.id, crate.id), true);
    assert.equal(survivor.points, 0);
    assert.equal(survivor.score, crate.price);
    assert.ok(Object.hasOwn(survivor.inventory, 'shotgun'));
  }
  assert.equal(WORLD.armory.length, 14);
});

test('every gated crate preserves points and stocks until its exact unlock wave', () => {
  for (const weapon of ARMORY.filter(crate => crate.unlockWave > 1).map(crate => crate.weapon)) {
    const crate = crateFor(weapon);
    const { simulation, player, events } = room();
    approach(player, crate);
    player.points = crate.price + 123;
    player.score = 9000;
    simulation.wave = crate.unlockWave - 1;
    const before = inventoryState(player);
    simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, wave: 999, points: 999999, weapon });
    assert.equal(simulation.wave, crate.unlockWave - 1);
    assert.equal(simulation.buyWeapon('a', crate.id), false);
    assert.deepEqual(inventoryState(player), before);
    const denied = events.find(event => event.event === 'purchase-denied');
    assert.ok(denied);
    assert.equal(denied.id, 'a');
    assert.match(denied.message, /vague/i);
    simulation.time += 1;
    simulation.wave = crate.unlockWave;
    assert.equal(simulation.buyWeapon('a', crate.id), true);
    assert.equal(player.points, 123);
    assert.equal(player.score, 9000);
    assert.equal(player.weapon, weapon);
    assert.ok(Object.hasOwn(player.inventory, weapon));
  }
});

test('unlocked bonus crates still require both horizontal proximity and the correct floor', () => {
  for (const weapon of ['minigun', 'magnum']) {
    const crate = crateFor(weapon);
    for (const location of ['distant', 'wrong-floor']) {
      const { simulation, player } = room();
      approach(player, crate);
      simulation.wave = crate.unlockWave;
      player.points = crate.price;
      if (location === 'distant') player.x += 4;
      else player.y = crate.y === 0 ? WORLD.loftY : 0;
      const before = inventoryState(player);
      assert.equal(simulation.buyWeapon('a', crate.id), false, `${weapon} ${location}`);
      assert.deepEqual(inventoryState(player), before);
    }
  }
});

test('reviving a teammate takes priority over a weapon crate', () => {
  const { simulation, player } = room();
  const crate = crateFor('shotgun');
  simulation.wave = crate.unlockWave;
  approach(player, crate);
  player.points = crate.price;
  const teammate = simulation.addPlayer('b', 'Bob');
  Object.assign(teammate, { x: player.x, y: player.y, z: player.z + .5, hp: 0, alive: true, downed: true, bleedOutAt: simulation.time + 25 });
  assert.equal(completeRevive(simulation, 'a'), true);
  assert.equal(teammate.downed, false);
  assert.equal(player.points, crate.price + 25);
  assert.equal(player.score, 0, 'The coins at once; the score at the end of the wave');
  simulation.finishWave();
  assert.equal(player.score, 150, 'Revival still earns at least 150 score despite the smaller cash reward');
  assert.deepEqual(Object.keys(player.inventory), ['pistol']);
});

test('wave resupply refills only owned weapons and preserves points and cumulative score', () => {
  const { simulation, player } = room();
  const crate = crateFor('shotgun');
  simulation.wave = crate.unlockWave;
  approach(player, crate);
  player.points = crate.price + 123;
  player.score = 3000;
  assert.equal(simulation.buyWeapon('a', crate.id), true);
  for (const stock of Object.values(player.inventory)) Object.assign(stock, { ammo: 0, reserve: 0 });
  simulation.finishWave();
  assert.equal(player.weapon, 'shotgun');
  assert.equal(player.points, 123);
  assert.equal(player.score, 3000);
  assert.deepEqual(Object.keys(player.inventory).sort(), ['pistol', 'shotgun']);
  for (const weapon of Object.keys(player.inventory)) {
    assert.deepEqual(player.inventory[weapon], { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve });
  }
  assert.equal(simulation.chooseWeapon('a', 'smg'), false);
});

test('restart clears the economy and returns every survivor to the same pistol', () => {
  const { simulation, player } = room('smg');
  const crate = crateFor('rifle');
  simulation.wave = crate.unlockWave;
  approach(player, crate);
  player.points = 2000;
  player.score = 5000;
  player.kills = 19;
  assert.equal(simulation.buyWeapon('a', crate.id), true);
  assert.equal(player.weapon, 'rifle');
  simulation.endGame();
  assert.equal(simulation.start('a'), true);
  assert.equal(player.startingWeapon, 'pistol');
  assert.equal(player.weapon, 'pistol');
  assert.equal(player.points, 0);
  assert.equal(player.score, 0);
  assert.equal(player.kills, 0);
  assert.deepEqual(Object.keys(player.inventory), ['pistol']);
  assert.deepEqual(player.inventory.pistol, { ammo: WEAPONS.pistol.magazine, reserve: WEAPONS.pistol.reserve });
});

test('only two freely chosen weapons fit and a purchase replaces the held slot without reordering', () => {
  const { simulation, player, events } = room();
  player.points = 20000;
  const buy = name => {
    const crate = crateFor(name);
    simulation.wave = Math.max(simulation.wave, crate.unlockWave);
    approach(player, crate);
    simulation.time += 1;
    return simulation.buyWeapon(player.id, crate.id);
  };
  assert.equal(buy('rifle'), true);
  player.inventory.rifle = { ammo: 7, reserve: 43 };
  assert.equal(simulation.chooseWeapon(player.id, 'pistol'), true);
  assert.equal(buy('shotgun'), true);
  assert.deepEqual(Object.keys(player.inventory), ['shotgun', 'rifle']);
  assert.equal(player.inventory.pistol, undefined, 'Discarded weapons have no hidden ammunition stock');
  assert.deepEqual(player.inventory.rifle, { ammo: 7, reserve: 43 });
  assert.equal(simulation.chooseWeapon(player.id, 'pistol'), false);
  assert.equal(simulation.chooseWeapon(player.id, 'rifle'), true);
  assert.equal(buy('smg'), true);
  assert.deepEqual(Object.keys(player.inventory), ['shotgun', 'smg']);
  assert.equal(player.weapon, 'smg');
  const publicPlayer = simulation.snapshot().players[0];
  assert.equal(simulation.snapshot().maxWeaponSlots, 2);
  assert.deepEqual(publicPlayer.weapons.map(stock => stock.weapon), ['shotgun', 'smg']);
  assert.equal(publicPlayer.weapons[1].equipped, true);
  assert.equal(events.filter(event => event.event === 'purchase').at(-1).replacedWeapon, 'rifle');
  const before = inventoryState(player);
  assert.equal(buy('rifle'), false, 'A discarded weapon cannot be rebought to farm ammunition in the same wave');
  assert.deepEqual(inventoryState(player), before);
  assert.match(events.at(-1).message, /abandonnée/);
  simulation.finishWave();
  assert.equal(buy('rifle'), true, 'A later resupply unlocks buying the discarded weapon again');
  assert.deepEqual(Object.keys(player.inventory), ['shotgun', 'rifle']);
});

test('switching between the two slots preserves separate ammunition and cancels reloads', () => {
  const { simulation, player } = room();
  const crate = crateFor('rifle');
  simulation.wave = crate.unlockWave;
  approach(player, crate);
  player.points = crate.price;
  assert.equal(simulation.buyWeapon(player.id, crate.id), true);
  player.inventory.rifle = { ammo: 3, reserve: 40 };
  player.inventory.pistol = { ammo: 5, reserve: 11 };
  assert.equal(simulation.reload(player.id), true);
  assert.equal(simulation.chooseWeapon(player.id, 'pistol'), true);
  assert.equal(player.reloadUntil, 0);
  assert.equal(simulation.chooseWeapon(player.id, 'rifle'), true);
  assert.deepEqual(player.inventory.rifle, { ammo: 3, reserve: 40 });
  assert.deepEqual(player.inventory.pistol, { ammo: 5, reserve: 11 });
});

test('every crate has an unobstructed indoor approach with a distinct interaction target', () => {
  for (const crate of ARMORY) {
    const { simulation, player } = room();
    approach(player, crate);
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, crate.id);
    assert.ok(player.x >= WORLD.bounds.minX && player.x <= WORLD.bounds.maxX);
    assert.ok(player.z >= WORLD.bounds.minZ && player.z <= WORLD.bounds.maxZ);
    const targets = ARMORY.filter(item => Math.hypot(player.x - item.x, player.z - item.z) < ARMORY_REACH
      && Math.abs(player.y - item.y) < ARMORY_HEIGHT_REACH);
    assert.deepEqual(targets.map(item => item.id), [crate.id]);
  }
});

test('an abandoned pistol can be bought again at its own crate after the next resupply', () => {
  const { simulation, player } = room();
  player.points = 20000;
  for (const weapon of ['rifle', 'shotgun']) {
    if (weapon === 'shotgun') simulation.chooseWeapon(player.id, 'pistol');
    const crate = crateFor(weapon);
    simulation.wave = Math.max(simulation.wave, crate.unlockWave);
    approach(player, crate);
    simulation.time += 1;
    assert.equal(simulation.buyWeapon(player.id, weapon), true);
  }
  assert.equal(player.inventory.pistol, undefined);
  simulation.finishWave();
  approach(player, crateFor('pistol'));
  simulation.time += .61;
  const before = player.points;
  assert.equal(simulation.interact(player.id), true);
  assert.equal(player.points, before - 200);
  assert.equal(player.weapon, 'pistol');
  assert.deepEqual(Object.keys(player.inventory), ['pistol', 'rifle']);
  assert.deepEqual(player.inventory.pistol, { ammo: 12, reserve: 36 });
});
