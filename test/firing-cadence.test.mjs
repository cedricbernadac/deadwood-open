import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, TICK_RATE, damageFalloff } from '../simulation.mjs';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { FIRE_INTERVALS, firingSchedule, fireTolerance } from '../public/rules.js';

function fixture() {
  const events = [];
  const simulation = new RoomSimulation('FIRING', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start('a');
  Object.assign(player, { x: -4.4, z: 2, y: 0, yaw: 0, pitch: 0, weapon: 'rifle', inventory: { rifle: { ammo: 30, reserve: 90 } } });
  const zombie = { id: 'target', x: -4.4, y: .4, z: -3, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1 };
  simulation.zombies.set(zombie.id, zombie);
  return { simulation, player, zombie, events };
}

test('all weapon cooldowns share the client cadence, with actual machine-gun fire doubled', () => {
  for (const [name, interval] of Object.entries(FIRE_INTERVALS)) assert.equal(WEAPONS[name].interval, interval);
  assert.equal(FIRE_INTERVALS.rifle, .09);
  assert.equal(.18 / FIRE_INTERVALS.rifle, 2);
});

test('server subtick timing accepts 60/144-Hz trigger requests without dropping real bullets at 30 Hz', () => {
  for (const fps of [60, 144]) {
    const { simulation, player, zombie, events } = fixture();
    let lastSent = -Infinity, requests = 0;
    for (let frame = 0; frame < fps * 2; frame++) {
      const clock = frame / fps;
      // The real socket reads a trusted monotonic clock between physics ticks.
      simulation.time = Math.floor(clock * TICK_RATE + 1e-8) / TICK_RATE;
      if (clock - lastSent < FIRE_INTERVALS.rifle - 1e-8) continue;
      lastSent = clock; requests++;
      assert.equal(simulation.shoot(player.id, clock - simulation.time), true, `${fps} Hz, t=${clock}`);
    }
    const shots = events.filter(event => event.event === 'shot');
    assert.ok(shots.length >= 20 && shots.length <= 23);
    assert.equal(shots.length, requests);
    assert.equal(player.inventory.rifle.ammo, 30 - shots.length);
    assert.equal(zombie.hp, 10000, 'launch confirmation does not apply early damage');
    const { impacts } = settleBallisticFlight(simulation);
    const contacts = impacts.filter(impact => impact.stop === 'zombie');
    const damage = WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, 4.68);
    assert.ok(Math.abs(zombie.hp - (10000 - shots.length * damage)) < 1e-5);
    assert.equal(contacts.length, shots.length, 'every accepted round physically arrives');
    assert.ok(shots.every(shot => shot.projectiles.length === 1 && shot.hits === 0));
    assert.deepEqual(new Set(contacts.map(impact => impact.projectileId)), new Set(shots.flatMap(shot => shot.projectiles.map(projectile => projectile.id))));
  }
});

test('cooldown rejects duplicate or premature shots and bounds the server subtick offset', () => {
  const { simulation, player, events } = fixture();
  simulation.time = 1;
  assert.equal(simulation.shoot(player.id, .02), true);
  for (const offset of [0, .02, 1e9, NaN, Infinity, -.1]) assert.equal(simulation.shoot(player.id, offset), false);
  assert.equal(events.filter(event => event.event === 'shot').length, 1);
  assert.equal(player.inventory.rifle.ammo, 29);
  simulation.time = 1.1;
  assert.equal(simulation.shoot(player.id, .01), true, 'Floating-point equality must not discard an on-time bullet');
  assert.equal(player.inventory.rifle.ammo, 28);
});

test('minigun phase survives 30/60/144-FPS requests against an independent 30-Hz server clock', () => {
  for (const fps of [30, 60, 144]) {
    const { simulation, player, events } = fixture();
    player.weapon = 'minigun'; player.inventory.minigun = { ammo: WEAPONS.minigun.magazine, reserve: WEAPONS.minigun.reserve };
    player.minigunSpinning = true; player.minigunSpinUntil = 1;
    let nextAt = null, sent = 0, tick = 1;
    for (let frame = 0; frame < fps * 2; frame++) {
      const clock = 1 + frame / fps;
      while (tick + 1 / TICK_RATE <= clock + 1e-8) tick += 1 / TICK_RATE;
      simulation.time = tick;
      const schedule = firingSchedule(clock, nextAt, FIRE_INTERVALS.minigun); nextAt = schedule.nextAt;
      if (!schedule.fire) continue;
      sent++;
      assert.ok(clock + 1e-8 >= player.shotAfter, `${fps} FPS cannot ask before the authoritative deadline`);
      assert.equal(simulation.shoot(player.id, clock - tick), true, `${fps} FPS, clock=${clock}, tick=${tick}`);
      assert.equal(simulation.shoot(player.id, clock - tick), false, 'a duplicate in the same frame remains rejected');
    }
    assert.equal(sent, fps === 30 ? 36 : 37);
    assert.equal(events.filter(event => event.event === 'shot').length, sent);
    assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.magazine - sent);
  }
});

test('minigun spam cannot fire before its deadline or exceed the shared round budget', () => {
  const { simulation, player, events } = fixture();
  player.weapon = 'minigun'; player.inventory.minigun = { ammo: WEAPONS.minigun.magazine, reserve: WEAPONS.minigun.reserve };
  player.minigunSpinning = true; player.minigunSpinUntil = 1;
  let accepted = 0;
  for (let millisecond = 0; millisecond < 2000; millisecond++) {
    const clock = 1 + millisecond / 1000;
    simulation.time = Math.floor(clock * TICK_RATE + 1e-8) / TICK_RATE;
    // A round may arrive up to fireTolerance().early ahead of its slot (delivery
    // jitter), never earlier, and the slots keep one round per interval.
    const premature = clock + 1e-8 < player.shotAfter - fireTolerance(FIRE_INTERVALS.minigun).early;
    const fired = simulation.shoot(player.id, clock - simulation.time);
    if (premature) assert.equal(fired, false);
    if (fired) accepted++;
  }
  assert.ok(accepted >= 37 && accepted <= Math.floor(2 / FIRE_INTERVALS.minigun) + 1, `${accepted} rounds in 2 s`);
  assert.equal(events.filter(event => event.event === 'shot').length, accepted);
  simulation.time = 10;assert.equal(simulation.shoot(player.id), true);
  assert.equal(player.shotAfter, 10 + FIRE_INTERVALS.minigun, 'a long idle interval cannot accumulate catch-up shots');
  assert.equal(simulation.shoot(player.id), false);
});

test('the minigun client schedule carries short frame lateness but drops old frames after a stall', () => {
  const interval = FIRE_INTERVALS.minigun;
  assert.deepEqual(firingSchedule(1, null, interval), { fire: true, nextAt: 1 + interval });
  assert.deepEqual(firingSchedule(1.06, 1.055, interval), { fire: true, nextAt: 1.055 + interval });
  assert.deepEqual(firingSchedule(1.06, 1.11, interval), { fire: false, nextAt: 1.11 });
  assert.deepEqual(firingSchedule(5, 1.11, interval), { fire: true, nextAt: 5 + interval });
  assert.deepEqual(firingSchedule(5, 5 + interval, interval), { fire: false, nextAt: 5 + interval });
  for (const invalid of [NaN, Infinity, -1, 0]) assert.equal(firingSchedule(1, null, invalid).fire, false);
});

// Owner report (12 October 2026): a held assault trigger fired unevenly. The
// client sent a steady 133 ms rhythm but the server dropped every other round
// whenever delivery jitter made one arrive a few milliseconds early.
const jitter = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
for (const weapon of ['assault', 'rifle', 'smg', 'pistol', 'minigun', 'shotgun']) test(`a held ${weapon} trigger keeps every round despite delivery jitter at 30, 60 and 144 FPS`, () => {
  for (const fps of [30, 60, 144]) {
    const { simulation, player, events } = fixture(), random = jitter(fps * 31 + weapon.length);
    player.weapon = weapon; player.inventory[weapon] = { ammo: 500, reserve: 0 };
    if (weapon === 'minigun') { player.minigunSpinning = true; player.minigunSpinUntil = 1; }
    let nextAt = null, sent = 0;
    const deliveries = [];
    for (let frame = 0; frame < fps * 3; frame++) {
      const clock = 1 + frame / fps, schedule = firingSchedule(clock, nextAt, FIRE_INTERVALS[weapon]); nextAt = schedule.nextAt;
      // Each request reaches the server later by up to the absorbed jitter, in order.
      if (schedule.fire) { sent++; deliveries.push(Math.max(deliveries.at(-1) ?? 0, clock + random() * fireTolerance(FIRE_INTERVALS[weapon]).early)); }
    }
    let accepted = 0;
    for (const arrival of deliveries) {
      const tick = Math.floor(arrival * TICK_RATE + 1e-8) / TICK_RATE;
      simulation.time = tick;
      if (simulation.shoot(player.id, arrival - tick)) accepted++;
    }
    assert.equal(accepted, sent, `${weapon} at ${fps} FPS: ${accepted} of ${sent} rounds kept`);
    assert.equal(events.filter(event => event.event === 'shot').length, sent);
    const expected = 3 / FIRE_INTERVALS[weapon];
    assert.ok(sent >= expected - 2 && sent <= expected + 1, `${weapon} at ${fps} FPS keeps its cadence: ${sent} rounds in 3 s (${expected.toFixed(1)} expected)`);
  }
});

test('spamming requests can never beat one round per interval over time', () => {
  for (const weapon of ['assault', 'smg', 'minigun', 'pistol']) {
    const { simulation, player } = fixture();
    player.weapon = weapon; player.inventory[weapon] = { ammo: 5000, reserve: 0 };
    if (weapon === 'minigun') { player.minigunSpinning = true; player.minigunSpinUntil = 1; }
    let accepted = 0;
    for (let millisecond = 0; millisecond < 10000; millisecond++) {
      const clock = 1 + millisecond / 1000;
      simulation.time = Math.floor(clock * TICK_RATE + 1e-8) / TICK_RATE;
      if (simulation.shoot(player.id, clock - simulation.time)) accepted++;
    }
    // At most one round per interval, plus the edge of the window that one early round can reach.
    assert.ok(accepted <= Math.floor((10 + fireTolerance(FIRE_INTERVALS[weapon]).early) / FIRE_INTERVALS[weapon]) + 1, `${weapon}: ${accepted} rounds in 10 s`);
  }
});

test('the shared schedule carries up to one tick of lateness and restarts after a longer stall', () => {
  const interval = FIRE_INTERVALS.assault;
  assert.deepEqual(firingSchedule(1.02, 1, interval), { fire: true, nextAt: 1 + interval }, '20 ms late keeps the slot');
  assert.deepEqual(firingSchedule(1.05, 1, interval), { fire: true, nextAt: 1.05 + interval }, '50 ms late starts afresh');
  for (const weapon of Object.keys(FIRE_INTERVALS)) {
    const { early, carry } = fireTolerance(FIRE_INTERVALS[weapon]);
    assert.ok(early >= 0 && early <= 1 / 30 + 1e-12 && carry + early < FIRE_INTERVALS[weapon], `${weapon}: two rounds can never land together`);
  }
  assert.ok(fireTolerance(FIRE_INTERVALS.assault).early > .03, 'the assault rifle absorbs a full tick of jitter');
});
