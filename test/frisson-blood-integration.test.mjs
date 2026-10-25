// The two halves of the blood spray together (art/frisson/BLOOD-SPRAY.md
// section 4.8, step 3): a real Frisson room's shot (RoomSimulation, the
// wounds of 4.1) goes through the real browser client (client.js in its vm,
// 4.2) into the real blood part (public/frisson/blood.js with three's Node
// build, 4.4-4.6). Current calibrated wounds have their own regression
// captures; the old 2.7 table is preserved separately as artistic replay data.
// The pack here installs the blood part only, as index.js would among the
// others, on the client's own camera, hooks and quality preset (medium in
// the harness).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { importPublicModule } from './helpers/public-modules.mjs';
import { settle, clientHarness } from './helpers/frisson-client.mjs';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticShotView } from './helpers/ballistic-wounds.mjs';
import { PHYSICAL_SPRAYS } from './helpers/blood-physical.mjs';

const { install } = await importPublicModule('frisson/blood.js');

// The brief's measuring setup (2.7), the shooter being this PC ('guest'):
// a Lehmer random, the survivor at (-4.4, 0, 4) looking down -z, the target
// straight ahead. Every event the room sends, in order.
function fire(weapon, target, distance, pitch) {
  const events = [];
  let state = 7; const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const simulation = new RoomSimulation('BLOOD', { random, onEvent: event => events.push(event), ambiance: 'frisson' });
  const player = simulation.addPlayer('guest', 'Invité', weapon); simulation.addPlayer('host', 'Hôte'); simulation.start('guest');
  player.weapon = weapon; player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch, minigunSpinning: true, minigunSpinUntil: -1 });
  const enemy = { id: 'T', x: -4.4, y: 0, z: 4 - distance, kind: 'walker', scale: 1, boss: false, yaw: 0, pushX: 0, pushZ: 0, pushLeft: 0, ...target };
  simulation.zombies.set('T', enemy);
  // Capture the displayed bodies before their authoritative flight contacts.
  const snapshot = simulation.snapshot();
  assert.equal(simulation.shoot('guest'), true);
  assert.equal(events.some(event=>event.event==='bullet-impact'),false,'launch has no early wound');
  advanceBallisticFlight(simulation,.2);
  return { events: events.map(event => ({ type: 'event', ...event })), snapshot, enemy };
}

// A Frisson night on this PC with the real blood part as the pack, the
// survivor standing where the shot was fired. The blood's own draws are
// seeded, so a run is the same every time. The closest arc is that of the
// droplets kept: one the camera rule dropped never flies, and it is dropped
// precisely because its arc came nearer than .45 m.
async function night(state, seed = 7) {
  const sprays = [], droplets = { thrown: 0, dropped: 0, closest: Infinity };
  let handle = null, draws = seed;
  const random = () => (draws = (draws * 16807) % 2147483647) / 2147483647;
  const module = {
    async install(ctx) {
      handle = await install({ THREE, scene: new THREE.Scene(), camera: ctx.camera, hooks: ctx.hooks, quality: ctx.quality, random,
        onSpray: info => sprays.push({ ...info }),
        onDroplet: info => {
          if (info.dropped) { droplets.dropped++; return; }
          droplets.thrown++; droplets.closest = Math.min(droplets.closest, info.closest);
        } });
      return handle;
    },
  };
  const client = clientHarness({ importer: () => Promise.resolve(module) });
  client.join('guest');
  client.update(state); await settle(); await settle();
  client.enter(); client.update(state);
  let now = 0;
  const run = seconds => { for (const end = now + seconds * 1000; now < end;) { now += 1000 / 60; client.time(now); client.frame(now); } };
  run(.2);
  assert.ok(client.hooks().impact, 'the blood part is installed through the loader');
  return { client, sprays, droplets, run, stats: () => handle.stats() };
}

function shotWounds(events, snapshot) {
  const shot = ballisticShotView(events);
  assert.ok(shot, 'a real authoritative shot exists');
  assert.equal(shot.id, 'guest'); assert.equal(shot.ballistic, true);
  const wounds = shot.pellets.flatMap(pellet => pellet.wounds ?? []);
  for (const wound of wounds) {
    assert.equal(wound[0], 'T', 'the intended body owns every wound');
    const nominal = WEAPONS[shot.weapon].damage * damageFalloff(WEAPONS[shot.weapon], wound[1]) * (wound[3] ? snapshot.headshotMultiplier : 1);
    assert.ok(Math.abs(wound[2] - nominal) < .05, `finite power ${wound[2]} vs ${nominal}`);
  }
  return wounds;
}
function assertKillAfterImpact(events) {
  const kills = events.filter(event => event.event === 'kill');
  assert.equal(kills.length, 1, 'one real kill must exist');
  assert.equal(kills[0].id, 'guest'); assert.equal(kills[0].zombieId, 'T');
  const killIndex = events.findIndex(event => event.event === 'kill'), shotIndex = events.findIndex(event => event.event === 'shot');
  assert.ok(killIndex >= 0 && shotIndex >= 0, 'both events exist; -1 must never pass ordering');
  const impactIndex=events.findIndex(event=>event.event==='bullet-impact'&&event.killed&&!event.visualOnly);
  assert.ok(shotIndex<impactIndex&&impactIndex<killIndex,'launch then fatal physical contact then kill');
}

test('the owner\'s case through the whole chain: a point-blank shotgun into a 1,400-HP colossus\'s head makes one calibrated spray of 82 droplets at medium, from the real server and client', async () => {
  for (const seed of [7, 11, 13, 17, 19, 23]) await ownersCase(seed);
});
async function ownersCase(seed) {
  const { events, snapshot } = fire('shotgun', { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400 }, 1.2, .35);
  const { client, sprays, droplets, run, stats } = await night(snapshot, seed);
  const camera = client.camera();
  assert.deepEqual(camera.map(value => Math.round(value * 100) / 100), [-4.4, 1.55, 4], 'the camera at the shooter\'s eye');
  for (const event of events) client.event(event);
  run(.5);
  assert.equal(sprays.length, 1, 'nine pellets on one body: one spray');
  const [spray] = sprays, expect = PHYSICAL_SPRAYS.colossusHead;
  const wounds = shotWounds(events, snapshot);
  assert.equal(wounds.length, 9); assert.equal(wounds.filter(wound => wound[3]).length, 7);
  assert.equal(events.some(event => event.event === 'kill'), false);
  assert.deepEqual([spray.id, spray.mode, spray.wounds, spray.local, spray.kill], ['T', 'bullet', 9, true, false]);
  assert.ok(Math.abs(spray.damage - expect.D) < .1, `D ${spray.damage}`);
  assert.deepEqual([spray.burst, spray.back, spray.exit, spray.globs, spray.fountain, spray.killBurst, spray.puffs],
    [expect.burst, expect.back, expect.exit, expect.globs, expect.fountain, expect.kill, expect.puffs]);
  // Every droplet thrown or dropped by the camera rule; none kept came near the eye.
  assert.equal(droplets.thrown + droplets.dropped, expect.medium, 'the current calibrated total at medium');
  assert.ok(droplets.closest >= .45, `seed ${seed}: closest kept arc ${droplets.closest} m`);
  assert.ok(droplets.thrown > expect.medium / 2, `seed ${seed}: ${droplets.thrown} of ${expect.medium} kept`);
  assert.equal(stats().thrownTotal, expect.medium);
  assert.ok(stats().closest >= .45);
}

test('a wounded colossus at 500 of 700 HP is really killed: one corpse, one current spray and one kill burst (103 at medium)', async () => {
  const { events, snapshot } = fire('shotgun', { kind: 'brute', scale: 1.22, hp: 500, maxHp: 700 }, 1.2, .35);
  assertKillAfterImpact(events);
  assert.equal(shotWounds(events, snapshot).length, 9);
  const { client, sprays, droplets, run } = await night(snapshot);
  for (const event of events) client.event(event);
  run(.5);
  const expect = PHYSICAL_SPRAYS.colossusKill;
  assert.equal(sprays.length, 1);
  assert.deepEqual([sprays[0].kill, sprays[0].killBurst, sprays[0].fountain, sprays[0].burst], [true, expect.kill, 0, expect.burst]);
  assert.equal(droplets.thrown + droplets.dropped, expect.medium);
  assert.deepEqual(client.fallen(), ['T'], 'the corpse kept for its wounds');
});

test('a calibrated pistol hit and a wounded 80-HP walker killed by the first pellet retain their current blood volumes', async () => {
  for (const [label, weapon, target, distance, pitch] of [
    ['pistolBody3', 'pistol', { hp: 5000, maxHp: 5000 }, 3, -.15],
    ['walkerHeadKill', 'shotgun', { hp: 40, maxHp: 80 }, 1.2, .1],
  ]) {
    const { events, snapshot } = fire(weapon, target, distance, pitch);
    const { client, sprays, droplets, run } = await night(snapshot);
    for (const event of events) client.event(event);
    run(.5);
    const expect = PHYSICAL_SPRAYS[label];
    const wounds = shotWounds(events, snapshot);
    assert.equal(wounds.length, expect.wounds);
    if (expect.kill) { assertKillAfterImpact(events); assert.ok(wounds.every(wound => wound[4] === 1)); }
    else assert.equal(events.some(event => event.event === 'kill'), false);
    assert.equal(sprays.length, 1, label);
    assert.ok(Math.abs(sprays[0].damage - expect.D) < .01, `${label}: current calibrated wound power`);
    assert.deepEqual([sprays[0].wounds, sprays[0].burst, sprays[0].killBurst], [expect.wounds, expect.burst, expect.kill], label);
    assert.equal(droplets.thrown + droplets.dropped, expect.medium, label);
  }
});

test('the real cabin blood chain stays quiet at launch and bleeds only on the authoritative arrival', async () => {
  const { events, snapshot }=fire('pistol',{hp:5000,maxHp:5000},3,-.15);
  const { client,sprays,run }=await night(snapshot);
  client.event(events.find(event=>event.event==='shot')); run(.03);
  assert.equal(sprays.length,0,'a confirmed launch still causes no wound');
  for(const event of events.filter(event=>event.event==='bullet-impact'))client.event(event);
  run(.5); assert.equal(sprays.length,1); assert.equal(sprays[0].wounds,1);
});

test('the full 700-HP colossus survives this finite shell rather than inheriting a historical forced death', () => {
  const { events, snapshot, enemy } = fire('shotgun', { kind: 'brute', scale: 1.22, hp: 700, maxHp: 700 }, 1.2, .35);
  const wounds = shotWounds(events, snapshot);
  assert.equal(wounds.length, 9); assert.equal(events.some(event => event.event === 'kill'), false);
  assert.ok(enemy.hp > 0); assert.ok(Math.abs(enemy.hp - (700 - PHYSICAL_SPRAYS.colossusHead.D)) < .01);
});
