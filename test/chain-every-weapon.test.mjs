import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { KILL_CHAIN } from '../public/rules.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

// The owner wants the chain names for every weapon (12 October): a reload,
// or the recovery of a melee blow that killed, never counts against the
// chain's 2.5 s. Same firing line as kill-chain.test.mjs.
function combat(weapon) {
  const events = [];
  const simulation = new RoomSimulation('EVERY', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice', weapon);
  simulation.start('a');
  simulation.timeLeft = 999; // a long countdown: no wave spawns
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: 60 };
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  return { simulation, player, events };
}
const kills = events => events.filter(event => event.event === 'kill');
const ticks = (simulation, seconds) => {
  for (let step = 0; step < Math.ceil(seconds * 30); step++) {
    for (const player of simulation.players.values()) player.lastInputAt = simulation.time;
    simulation.tick(1 / 30);
  }
};
function target(simulation, id, options = {}) {
  const zombie = { id, x: -4.4, y: .4, z: 1, hp: 19, maxHp: 19, kind: 'walker', ...options };
  simulation.zombies.set(id, zombie);
  return zombie;
}
// One kill per shot, waiting for each shot slot in real ticks. Like a held
// trigger, an empty weapon starts its reload only at its next shot slot.
function spree(weapon, count) {
  const fixture = combat(weapon), { simulation, player } = fixture;
  for (let index = 0; index < count; index++) {
    if (player.inventory[weapon].ammo <= 0) {
      while (simulation.time < player.shotAfter) ticks(simulation, 1 / 30);
      assert.equal(simulation.reload('a'), true, `${weapon} reloads`);
      ticks(simulation, WEAPONS[weapon].reloadTime + 1 / 30);
    }
    while (simulation.time < player.shotAfter) ticks(simulation, 1 / 30);
    target(simulation, `${weapon}${index}`);
    assert.equal(simulation.shoot('a'), true, `${weapon} shot ${index}`);
    advanceBallisticFlight(simulation, .05);
  }
  return fixture;
}

for (const weapon of ['sniper', 'rocket', 'shotgun', 'magnum']) {
  test(`${weapon}: a spree keeps one chain across its reloads`, () => {
    // The golden magnum has no reserve: special ammo boxes stand in for it here.
    const count = weapon === 'magnum' ? 9 : 12;
    const { events } = spree(weapon, count);
    const chain = kills(events);
    assert.equal(chain.length, count);
    assert.deepEqual(chain.map(event => event.chain), Array.from({ length: count }, (_, index) => index + 1));
    assert.equal(new Set(chain.map(event => event.chainId)).size, 1, 'one chain number');
  });
}

test('a reload never revives a chain that had already ended, and a cancelled reload stops holding it', () => {
  const late = combat('sniper');
  target(late.simulation, 'first'); late.simulation.shoot('a'); advanceBallisticFlight(late.simulation, .05);
  ticks(late.simulation, KILL_CHAIN.window + .2);
  late.player.inventory.sniper.ammo = 0;
  assert.equal(late.simulation.reload('a'), true);
  ticks(late.simulation, WEAPONS.sniper.reloadTime + .1);
  target(late.simulation, 'second'); late.simulation.shoot('a'); advanceBallisticFlight(late.simulation, .05);
  assert.deepEqual(kills(late.events).map(event => event.chain), [1, 1], 'the chain had ended before the reload');

  const cancelled = combat('sniper');
  target(cancelled.simulation, 'first'); cancelled.simulation.shoot('a'); advanceBallisticFlight(cancelled.simulation, .05);
  cancelled.player.inventory.sniper.ammo = 0;
  cancelled.simulation.reload('a');
  ticks(cancelled.simulation, 1);
  cancelled.player.reloadUntil = 0; // what a weapon switch or a death does
  ticks(cancelled.simulation, KILL_CHAIN.window + .1);
  cancelled.player.inventory.sniper.ammo = 5; cancelled.player.shotAfter = 0;
  target(cancelled.simulation, 'second'); cancelled.simulation.shoot('a'); advanceBallisticFlight(cancelled.simulation, .05);
  assert.deepEqual(kills(cancelled.events).map(event => event.chain), [1, 1], 'only the reload time itself is held');
});

test('missing on purpose never keeps a chain alive: only reloads and killing blows hold it', () => {
  const { simulation, player, events } = combat('assault');
  target(simulation, 'first'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  for (let time = 0; time < KILL_CHAIN.window + .3; time += WEAPONS.assault.interval) {
    ticks(simulation, WEAPONS.assault.interval);
    simulation.shoot('a'); advanceBallisticFlight(simulation, .05); // into the empty line
  }
  player.shotAfter = 0;
  target(simulation, 'second'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 1]);
});

// The spiked mace's heavy blow recovers for 2.2 s: the chain waits for it.
function maceRoom() {
  const events = [], simulation = new RoomSimulation('MACE', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.zombies.clear();
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: 'hammer', inventory: { hammer: { ammo: 0, reserve: 0 }, pistol: { ammo: 7, reserve: 11 } } });
  return { simulation, player, events };
}

test('spiked mace heavy blows keep their chain when the next click comes a second after the recovery', () => {
  const { simulation, player, events } = maceRoom(), heavy = WEAPONS.hammer.attacks.heavy;
  for (let index = 0; index < 5; index++) {
    simulation.zombies.set(`m${index}`, { id: `m${index}`, x: 12, y: 0, z: 6.65, yaw: 0, hp: 50, maxHp: 50, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true });
    assert.equal(simulation.shoot('a', 0, 'heavy'), true, `blow ${index}`);
    ticks(simulation, heavy.windup + .05);
    ticks(simulation, heavy.duration - heavy.windup + 1); // a slow, human re-click
    player.lastInputAt = simulation.time;
  }
  const chain = kills(events);
  assert.equal(chain.length, 5);
  assert.deepEqual(chain.map(event => event.chain), [1, 2, 3, 4, 5]);
});

test('a grenade kill during the mace recovery keeps the hold: the next heavy blow still chains', () => {
  const { simulation, events } = maceRoom(), heavy = WEAPONS.hammer.attacks.heavy;
  const body = id => ({ id, x: 12, y: 0, z: 6.65, yaw: 0, hp: 50, maxHp: 50, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true });
  simulation.zombies.set('m0', body('m0'));
  simulation.shoot('a', 0, 'heavy'); ticks(simulation, heavy.windup + .05);
  const pack = { ...body('b'), x: 14, z: 3 };
  simulation.zombies.set('b', pack);
  assert.equal(simulation.damageSpecialZombie(pack, 1e6, 'a', { x: 0, y: 0, z: -1 }, 'grenade'), true, 'a grenade kill in the recovery');
  ticks(simulation, heavy.duration - heavy.windup + 1);
  simulation.zombies.set('m1', body('m1'));
  simulation.shoot('a', 0, 'heavy'); ticks(simulation, heavy.windup + .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 2, 3]);
});

test('cancelling reloads over and over never keeps a chain alive past window + holdMax', () => {
  const { simulation, player, events } = combat('sniper');
  target(simulation, 'first'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  for (let cycle = 0; cycle < Math.ceil(KILL_CHAIN.window + KILL_CHAIN.holdMax) + 1; cycle++) {
    player.inventory.sniper.ammo = 2;
    assert.equal(simulation.reload('a'), true);
    ticks(simulation, 1);
    player.reloadUntil = 0; // a weapon switch cancels it
  }
  player.inventory.sniper.ammo = 5; player.shotAfter = 0;
  target(simulation, 'second'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 1]);
});

test('nothing holds a chain during the break between waves', () => {
  const { simulation, player, events } = combat('sniper');
  target(simulation, 'first'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  simulation.phase = 'intermission'; simulation.timeLeft = 999;
  player.inventory.sniper.ammo = 0; simulation.reload('a');
  ticks(simulation, WEAPONS.sniper.reloadTime + .1);
  simulation.phase = 'countdown';
  player.shotAfter = 0;
  target(simulation, 'second'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 1]);
});

test('reload tricks hold a chain for holdMax at most, even with a cancel timed on the last tick', () => {
  const { simulation, player, events } = combat('sniper');
  target(simulation, 'first'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  const start = simulation.time;
  // Restart the reload in the last tick of each one, never letting it finish.
  while (simulation.time - start < KILL_CHAIN.window + KILL_CHAIN.holdMax + .5) {
    player.inventory.sniper.ammo = 2;
    if (!(player.reloadUntil > simulation.time)) simulation.reload('a');
    if (player.reloadUntil - simulation.time <= 1 / 30 + 1e-9) { player.reloadUntil = 0; simulation.reload('a'); }
    ticks(simulation, 1 / 30);
  }
  assert.ok(player.chainHeld <= KILL_CHAIN.holdMax + 1e-9, `held ${player.chainHeld}`);
  player.inventory.sniper.ammo = 5; player.shotAfter = 0; player.reloadUntil = 0;
  target(simulation, 'second'); simulation.shoot('a'); advanceBallisticFlight(simulation, .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 1]);
});

test('a reload during the mace recovery, then cancelled, keeps the recovery held', () => {
  const { simulation, player, events } = maceRoom(), heavy = WEAPONS.hammer.attacks.heavy;
  const body = id => ({ id, x: 12, y: 0, z: 6.65, yaw: 0, hp: 50, maxHp: 50, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true });
  simulation.zombies.set('m0', body('m0'));
  simulation.shoot('a', 0, 'heavy'); ticks(simulation, heavy.windup + .05);
  assert.equal(simulation.chooseWeapon('a', 'pistol'), true);
  player.inventory.pistol.ammo = 3; simulation.reload('a');
  ticks(simulation, .6);
  assert.equal(simulation.chooseWeapon('a', 'hammer'), true); // cancels the pistol reload
  ticks(simulation, heavy.duration - heavy.windup - .6 + .8);
  simulation.zombies.set('m1', body('m1'));
  simulation.shoot('a', 0, 'heavy'); ticks(simulation, heavy.windup + .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 2]);
});

test('gatling: the spin-up after a reload is held too, so a manual reload keeps the chain', () => {
  const { simulation, player, events } = combat('minigun');
  player.inventory.minigun.ammo = 1;
  assert.equal(simulation.setMinigunSpin('a', true), true); ticks(simulation, 1.05);
  target(simulation, 'first'); assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .05);
  simulation.setMinigunSpin('a', false);
  ticks(simulation, 1); // the player lets go, then presses R a second later
  assert.equal(simulation.reload('a'), true); ticks(simulation, WEAPONS.minigun.reloadTime + .05);
  ticks(simulation, .5); // and presses the trigger half a second after the reload
  assert.equal(simulation.setMinigunSpin('a', true), true); ticks(simulation, 1.05);
  target(simulation, 'second'); assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .05);
  assert.deepEqual(kills(events).map(event => event.chain), [1, 2]);
});
