import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';
import { ARMORY, MAX_WAVES } from '../public/rules.js';

function setup() {
  const events = [], simulation = new RoomSimulation('SPIN01', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  const crate = ARMORY.find(item => item.weapon === 'minigun');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing), y: crate.y, z: crate.z + Math.cos(crate.facing), points: crate.price });
  assert.equal(simulation.buyWeapon('a', crate.id), true);
  Object.assign(player, { x: 0, y: 0, z: 1, yaw: 0, pitch: 0 });
  simulation.time = player.shotAfter;
  const target = { id: 'target', x: 0, y: .4, z: -2, hp: 1000, maxHp: 1000, kind: 'walker', scale: 1 };
  simulation.zombies.set(target.id, target);
  return { simulation, player, target, events };
}

test('the authoritative minigun windup rejects bypass shots and consumes nothing before one second', () => {
  const { simulation, player, target, events } = setup();
  assert.equal(MINIGUN_WINDUP, 1);
  assert.equal(simulation.shoot('a'), false);
  assert.equal(simulation.setMinigunSpin('a', { spinning: true, ready: true, time: -999 }), false);
  assert.equal(simulation.setMinigunSpin('a', true, { ready: true, until: -999 }), true);
  const deadline = player.minigunSpinUntil;
  simulation.time += .5;
  assert.equal(simulation.setMinigunSpin('a', true), true);
  assert.equal(player.minigunSpinUntil, deadline, 'repeated spin requests do not restart or skip charge');
  simulation.time = deadline - .001;
  assert.equal(simulation.shoot('a'), false);
  assert.equal(player.inventory.minigun.ammo, 75); assert.equal(target.hp, 1000); assert.equal(player.points, 0);
  assert.equal(events.some(event => event.event === 'shot'), false);
  const state = simulation.snapshot();
  assert.equal(state.minigunSpinDuration, 1); assert.equal(state.players[0].minigunReady, false);
  assert.equal(state.players[0].minigunSpinLeft, .001);
  simulation.time = deadline;
  assert.equal(simulation.snapshot().players[0].minigunReady, true);
  assert.equal(simulation.shoot('a'), true); assert.equal(target.hp, 1000); assert.equal(player.inventory.minigun.ammo, 74);
  assert.equal(simulation.shoot('a'), false, 'normal per-round cooldown remains authoritative');
  advanceBallisticFlight(simulation, .02);
  assert.ok(Math.abs(target.hp - (1000 - WEAPONS.minigun.damage * damageFalloff(WEAPONS.minigun, 2.68))) < 1e-6);
  simulation.time += WEAPONS.minigun.interval + 1e-5;
  assert.equal(simulation.shoot('a'), true);
});

test('release and retrigger require a fresh full windup for the same survivor', () => {
  const { simulation, player } = setup();
  simulation.setMinigunSpin('a', true); simulation.time += .8;
  assert.equal(simulation.setMinigunSpin('a', false), true);
  simulation.time += 2;
  assert.equal(simulation.shoot('a'), false);
  simulation.setMinigunSpin('a', true); simulation.time += .999;
  assert.equal(simulation.shoot('a'), false);
  simulation.time += .001; assert.equal(simulation.shoot('a'), true);
  assert.equal(player.inventory.minigun.ammo, 74);
});

test('spin validates ownership, weapon, ammunition, incapacity, reload and phase', () => {
  for (const change of [
    (simulation, player) => { player.weapon = 'pistol'; },
    (simulation, player) => { delete player.inventory.minigun; },
    (simulation, player) => { player.inventory.minigun.ammo = 0; },
    (simulation, player) => { player.downed = true; },
    (simulation, player) => { player.alive = false; },
    (simulation, player) => { player.reloadUntil = simulation.time + 2; },
    ...['lobby', 'extraction', 'victory', 'gameover'].map(phase => simulation => { simulation.phase = phase; }),
  ]) {
    const { simulation, player } = setup(); change(simulation, player);
    assert.equal(simulation.setMinigunSpin('a', true), false);
    assert.equal(player.minigunSpinning, false);
  }
  const { simulation } = setup();
  assert.equal(simulation.setMinigunSpin('missing', true), false);
  for (const invalid of [1, 'true', null, [], {}]) assert.equal(simulation.setMinigunSpin('a', invalid), false);
});

test('reload, weapon change, incapacity, resupply and terminal transitions cancel a charge', () => {
  const actions = [
    (simulation, player) => { player.inventory.minigun.ammo--; assert.equal(simulation.reload('a'), true); },
    simulation => simulation.chooseWeapon('a', 'pistol'),
    (simulation, player) => simulation.damagePlayer(player, 100),
    simulation => simulation.finishWave(),
    simulation => simulation.endGame(),
    simulation => simulation.removePlayer('a'),
    simulation => { simulation.phase = 'wave'; simulation.wave = MAX_WAVES; simulation.toSpawn = 0; simulation.zombies.clear(); assert.equal(simulation.beginExtraction(), true); },
  ];
  for (const action of actions) {
    const { simulation, player } = setup(); simulation.setMinigunSpin('a', true);
    action(simulation, player);
    assert.equal(player.minigunSpinning, false); assert.equal(player.minigunSpinUntil, 0);
    simulation.time += 2;
    if (player.weapon === 'minigun') assert.equal(simulation.shoot('a'), false);
  }
});

test('empty minigun auto-reloads its finite reserve and needs another charge afterwards', () => {
  const { simulation, player } = setup();
  player.inventory.minigun.ammo = 1;
  simulation.setMinigunSpin('a', true); simulation.time += MINIGUN_WINDUP;
  assert.equal(simulation.shoot('a'), true); assert.equal(player.minigunSpinning, false);
  simulation.time += WEAPONS.minigun.interval;
  assert.equal(simulation.shoot('a'), false); assert.equal(player.reloadUntil, simulation.time + WEAPONS.minigun.reloadTime);
  simulation.time = player.reloadUntil; simulation.tick(0);
  assert.equal(player.inventory.minigun.ammo, 75); assert.equal(player.inventory.minigun.reserve, 0);
  assert.equal(simulation.shoot('a'), false);
  simulation.setMinigunSpin('a', true); simulation.time += MINIGUN_WINDUP;
  assert.equal(simulation.shoot('a'), true); assert.equal(player.inventory.minigun.ammo, 74);
});

test('other firearms keep their immediate shots and player charges are independent', () => {
  for (const weapon of Object.keys(WEAPONS).filter(name => name !== 'minigun' && !WEAPONS[name].melee)) {
    const { simulation, player } = setup();
    player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
    simulation.chooseWeapon('a', weapon); simulation.time = player.shotAfter;
    assert.equal(simulation.shoot('a'), true, weapon);
  }
  const { simulation } = setup(), other = simulation.addPlayer('b');
  other.weapon = 'minigun'; other.inventory.minigun = { ammo: 75, reserve: 75 };
  simulation.setMinigunSpin('a', true); simulation.time += 1;
  assert.equal(simulation.snapshot().players.find(player => player.id === 'b').minigunReady, false);
  assert.equal(simulation.shoot('b'), false);
});
