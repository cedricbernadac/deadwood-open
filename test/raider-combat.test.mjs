import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { RAIDS, RAIDER_LOADOUTS, RAIDER_PLANK_DAMAGE, enemyPosture } from '../public/rules.js';
import { RAIDER_AIM_TUNING } from '../public/raids.js';
import { seededRandom } from '../validation/balance-report.mjs';

const TICK = 1 / 30;
// Wave 14 carries no raid plan; raiders are placed by hand in a quiet wave.
function arena({ players = 1, random = () => .5, sturdy = true } = {}) {
  const events = [], simulation = new RoomSimulation('RAIDC1', { random, onEvent: event => events.push(event) });
  for (let index = 0; index < players; index++) simulation.addPlayer(String.fromCharCode(97 + index));
  simulation.start('a');
  simulation.wave = 13; simulation.beginWave(); simulation.spawnTimer = 999;
  if (sturdy) for (const player of simulation.players.values()) player.hp = 1e6;
  return { simulation, events, player: simulation.players.get('a') };
}
function raiderAt(simulation, { x, z, y = 0, loadout = 'smg', index = 1, damageScale = 1, door = 'west', state = 'engage', drill = false }) {
  const raider = simulation.createRaider(1, { id: null, doorId: door, x, z }, { index, damageScale }, { point: { x, z }, loadout, drill });
  raider.y = y;
  simulation.zombies.set(raider.id, raider);
  // A steady engage: no strafe and no breach unless a test asks for one.
  if (state === 'engage') Object.assign(raider.ai, { state, engagedAt: simulation.time, engageUntil: Infinity, holdUntil: Infinity });
  else raider.ai.state = state;
  return raider;
}
function advance(simulation, seconds) {
  for (let step = 0; step < Math.round(seconds / TICK); step++) simulation.tick(TICK);
}
function until(simulation, done, seconds = 10) {
  for (let step = 0; step < Math.round(seconds / TICK); step++) { simulation.tick(TICK); if (done()) return true; }
  return false;
}
const named = (events, name) => events.filter(event => event.event === name);
const place = (player, x, z, options = {}) => Object.assign(player, { x, y: 0, z, crouched: false, vy: 0, grounded: true, ...options });
// Keep a survivor crouched (or standing) through movePlayer's fresh-input rule.
const hold = (simulation, crouch) => simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, crouch });
const bearing = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const views = (simulation, raider, player) => Object.fromEntries([false, true].map(crouched => [crouched ? 'crouched' : 'standing',
  [.62, .35, .92].map(share => {
    const point = { x: player.x, y: player.y + (player.crouched ? 1.05 : 1.75) * share, z: player.z };
    return simulation.raiderLineClear(simulation.raiderMuzzle(raider, point, crouched), point);
  })]));

test('raider sight uses the bullet solids: open windows and real board gaps, never walls, boarded windows, sealed plates or the loft slab', () => {
  const { simulation, player } = arena();
  const raider = raiderAt(simulation, { x: -17, z: 3.9 });
  // West-b window, sill 1.15: standing muzzle sees chest and head; crouched only the head.
  place(player, -5, 3.9);
  assert.deepEqual(views(simulation, raider, player), { standing: [true, false, true], crouched: [false, false, true] });
  assert.deepEqual(simulation.raiderTargetPoint(raider, player), { share: .62, point: { x: -5, y: 1.085, z: 3.9 }, crouchSees: false },
    'the chest wins, and it is not visible from the crouched muzzle');
  // One metre inside the window only the head clears the sill.
  place(player, -7, 3.9);
  assert.deepEqual(simulation.raiderTargetPoint(raider, player).share, .92);
  // The barricaded doorway: rays pass the gaps between planks and stop on them.
  assert.equal(simulation.raiderLineClear({ x: -12, y: 1.58, z: 0 }, { x: -4, y: 1.58, z: 0 }), true, 'gap between planks 3 and 4');
  assert.equal(simulation.raiderLineClear({ x: -12, y: 1.34, z: 0 }, { x: -4, y: 1.34, z: 0 }), false, 'plank 3');
  Object.assign(raider, { z: 0 }); place(player, -4, 0);
  assert.deepEqual(views(simulation, raider, player), { standing: [false, false, true], crouched: [true, true, false] });
  simulation.doors.find(door => door.id === 'west').boards.fill(0);
  assert.deepEqual(views(simulation, raider, player).standing, [true, true, true], 'a stripped doorway is open');
  for (const [z, wall] of [[-5, 'solid wall'], [-3.5, 'nailed-shut west-a window']]) {
    Object.assign(raider, { z }); place(player, -5, z);
    assert.deepEqual(views(simulation, raider, player), { standing: [false, false, false], crouched: [false, false, false] }, wall);
  }
  // Solo: the north door is sealed by a steel plate; four players keep it barricaded.
  assert.equal(simulation.doors.find(door => door.id === 'north').sealed, true);
  Object.assign(raider, { x: 0, z: -15 }); place(player, 0, -4);
  assert.equal(simulation.raiderTargetPoint(raider, player), null, 'sealed plate');
  const group = arena({ players: 4 }), open = raiderAt(group.simulation, { x: 0, z: -15, door: 'north' });
  place(group.player, 0, -4);
  assert.equal(group.simulation.raiderTargetPoint(open, group.player).share, .62);
  // The loft slab stops sight from below.
  Object.assign(raider, { x: 6, z: 0 }); place(player, 6, -4, { y: 3.4 });
  assert.equal(simulation.raiderTargetPoint(raider, player), null);
});

test('a survivor crouched under a sill is invisible; downed survivors are never targets', () => {
  const { simulation, player } = arena({ players: 2 });
  const raider = raiderAt(simulation, { x: -17, z: 3.9 }), teammate = simulation.players.get('b');
  place(teammate, 40, 40);
  place(player, -7, 3.9, { crouched: true });
  assert.equal(simulation.raiderTargetPoint(raider, player), null);
  assert.equal(simulation.updateRaiderSight(raider, simulation.livingPlayers()), null);
  player.crouched = false;
  assert.equal(simulation.updateRaiderSight(raider, simulation.livingPlayers()).id, 'a');
  // Going down drops the target at once; a downed body neither draws sight nor stops bullets.
  Object.assign(player, { downed: true, bleedOutAt: Infinity });
  simulation.raiderValidateTarget(raider);
  assert.deepEqual([raider.ai.targetId, raider.ai.sight], [null, null]);
  assert.equal(simulation.updateRaiderSight(raider, [player]), null);
  place(teammate, -3, 3.9);
  const shot = simulation.traceRaiderShot(raider, simulation.raiderMuzzle(raider, { x: -3, y: 1.61, z: 3.9 }), { x: -3, y: 1.61, z: 3.9 });
  assert.deepEqual([shot.pellets[0].stop, [...shot.damaged.keys()].map(survivor => survivor.id)], ['player', ['b']], 'the bullet flies over the downed survivor');
});

test('reaction, the visible tell and the quicker peek re-acquisition', () => {
  const { simulation, events, player } = arena();
  const raider = raiderAt(simulation, { x: -17, z: 3.9 });
  place(player, -5, 3.9); hold(simulation, false);
  const before = raider.yaw;
  simulation.tick(TICK);
  const ai = raider.ai, acquired = simulation.time;
  assert.equal(ai.targetId, 'a');
  const fullReaction = RAIDER_AIM_TUNING.reaction[0] + RAIDER_AIM_TUNING.reaction[1] * .5;
  assert.ok(Math.abs(ai.reactionUntil - acquired - fullReaction) < 1e-9, 'new acquisition retains a finite reaction window');
  assert.ok(fullReaction >= .4 && fullReaction <= .7, 'enough time to read the tell');
  assert.equal(ai.settleAmplitude, RAIDER_AIM_TUNING.settle);
  assert.ok(angleGap(before, bearing(raider, player)) > .2, 'it first faced the cabin');
  while (simulation.time + TICK < ai.reactionUntil) {
    assert.ok(angleGap(raider.yaw, bearing(raider, player)) < .05, 'the tell: the body turns during the reaction');
    assert.equal(simulation.snapshot().zombies.find(zombie => zombie.id === raider.id).aimingAt, 'a');
    assert.equal(named(events, 'raider-shot').length, 0, 'no shot before reactionUntil');
    hold(simulation, false); simulation.tick(TICK);
  }
  assert.ok(raider.pitch < 0, 'the gun points down at the chest');
  until(simulation, () => named(events, 'raider-shot').length, 1);
  assert.ok(named(events, 'raider-shot')[0].time >= ai.reactionUntil - 1e-9 && named(events, 'raider-shot')[0].time < ai.reactionUntil + TICK + 1e-9);
  // Ducking for 0.6 s and standing again: a short peek reaction and a smaller settle.
  advance(simulation, .5);
  for (let step = 0; step < 17; step++) { hold(simulation, true); simulation.tick(TICK); }
  assert.equal(ai.sight.visible, false);
  const shots = named(events, 'raider-shot').length, seen = ai.seenAt;
  until(simulation, () => (hold(simulation, false), ai.seenAt > seen), 1);
  assert.equal(ai.sight.visible, true);
  assert.ok(simulation.time - seen <= 1 + 1e-6, 'seen within the last second');
  const peekReaction = RAIDER_AIM_TUNING.peek[0] + RAIDER_AIM_TUNING.peek[1] * .5;
  assert.ok(Math.abs(ai.reactionUntil - simulation.time - peekReaction) < 1e-9, 'peek is quicker but never instant');
  assert.ok(peekReaction >= .2 && peekReaction < fullReaction);
  assert.deepEqual([ai.acquiredAt, ai.settleAmplitude], [simulation.time, RAIDER_AIM_TUNING.peekSettle]);
  const regained = named(events, 'raider-shot').length;
  while (simulation.time + TICK < ai.reactionUntil) { hold(simulation, false); simulation.tick(TICK); }
  assert.equal(named(events, 'raider-shot').slice(regained).filter(shot => !shot.suppress).length, 0, 'no aimed shot during the peek reaction');
  assert.ok(regained >= shots);
  // Hidden for more than a second: a full new reaction.
  for (let step = 0; step < 40; step++) { hold(simulation, true); simulation.tick(TICK); }
  const lost = ai.seenAt;
  until(simulation, () => (hold(simulation, false), ai.seenAt > lost), 1);
  assert.ok(simulation.time - lost > 1);
  assert.ok(Math.abs(ai.reactionUntil - simulation.time - fullReaction) < 1e-9);
  assert.equal(ai.settleAmplitude, RAIDER_AIM_TUNING.settle);
  // Raid-3 raiders react faster.
  const veteran = arena(), quick = raiderAt(veteran.simulation, { x: -17, z: 3.9, index: 3, loadout: 'rifle' });
  place(veteran.player, -5, 3.9); veteran.simulation.tick(TICK);
  assert.ok(Math.abs(quick.ai.reactionUntil - veteran.simulation.time - (RAIDER_AIM_TUNING.reactionRaid3[0] + RAIDER_AIM_TUNING.reactionRaid3[1] * .5)) < 1e-9);
});

test('aim error settles with time, grows with the smoothed lateral speed, and left-right tapping averages low', () => {
  const { simulation, player } = arena();
  const raider = raiderAt(simulation, { x: 20, z: 0 }), ai = raider.ai;
  place(player, 20, 12);
  const point = { x: 20, y: 1.085, z: 12 }, origin = simulation.raiderMuzzle(raider, point), spread = RAIDER_LOADOUTS.smg.spread;
  Object.assign(ai, { acquiredAt: simulation.time, settleAmplitude: RAIDER_AIM_TUNING.settle, flinchUntil: 0, moving: null });
  const sigma = (seconds, target = player, suppress = false) => {
    const now = simulation.time; simulation.time = ai.acquiredAt + seconds;
    const value = simulation.raiderAimError(raider, target, origin, point, suppress); simulation.time = now; return value;
  };
  const settling = [0, .6, 1.2, 3.6].map(seconds => sigma(seconds));
  settling.forEach((value, index) => assert.ok(Math.abs(value - spread - RAIDER_AIM_TUNING.settle * Math.exp(-[0, .6, 1.2, 3.6][index] / RAIDER_AIM_TUNING.settleTime)) < 1e-12));
  assert.ok(settling.every((value, index) => !index || value < settling[index - 1]));
  // Only the component across the line of fire counts, capped at motionMax.
  const range = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  Object.assign(player, { motionX: 0, motionZ: 3.5 });
  assert.ok(Math.abs(sigma(40) - spread) < 1e-9, 'running straight at the raider adds nothing');
  Object.assign(player, { motionX: 3.5, motionZ: 0 });
  assert.ok(Math.abs(sigma(40) - spread - RAIDER_AIM_TUNING.motionGain * 3.5 / range) < 1e-9);
  Object.assign(player, { motionX: 60 });
  assert.ok(Math.abs(sigma(40) - spread - RAIDER_AIM_TUNING.motionMax) < 1e-9);
  // Running, strafing, flinching and suppressing add their fixed terms.
  ai.moving = 'run'; Object.assign(player, { motionX: 0 });
  assert.ok(Math.abs(sigma(40) - spread - RAIDER_AIM_TUNING.running) < 1e-9); ai.moving = 'strafe';
  assert.ok(Math.abs(sigma(40) - spread - RAIDER_AIM_TUNING.strafing) < 1e-9); ai.moving = null;
  assert.ok(Math.abs(sigma(40, null, true) - sigma(40, null) - .03) < 1e-12);
  ai.flinchUntil = Infinity; assert.ok(Math.abs(sigma(40) - spread - .08) < 1e-9); ai.flinchUntil = 0;

  // The EMA is kept by movePlayer from real displacements (tau 0.4 s).
  const walk = arena(), walker = walk.player;
  place(walker, 20, 12);
  for (let step = 0; step < 60; step++) { walk.simulation.setInput('a', { forward: 0, strafe: 1, yaw: 0, pitch: 0 }); walk.simulation.tick(TICK); }
  const pace = 3.5 * walk.simulation.playerMovementMultiplier(walker);
  assert.ok(Math.abs(walker.motionX - pace) < .05 && Math.abs(walker.motionZ) < 1e-9, `walking ${walker.motionX}`);
  const tap = arena(), tapper = tap.player;
  place(tapper, 20, 12);
  const speeds = [];
  for (let step = 0; step < 180; step++) {
    tap.simulation.setInput('a', { forward: 0, strafe: Math.floor(step / 9) % 2 ? -1 : 1, yaw: 0, pitch: 0 });
    tap.simulation.tick(TICK);
    if (step >= 60) speeds.push(Math.abs(tapper.motionX));
  }
  const mean = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
  assert.ok(mean < .3 * pace, `tapping averages ${mean.toFixed(2)} m/s`);
  const term = target => Math.min(RAIDER_AIM_TUNING.motionMax, RAIDER_AIM_TUNING.motionGain * Math.abs(target.motionX) / range);
  assert.ok(term({ motionX: mean }) < term(walker) / 3);

  // Seeded hit rates over many traced shots: settled > walking target > fresh acquisition.
  const rate = ({ seconds, motionX = 0 }) => {
    const room = arena({ random: seededRandom(1234) }), shooter = raiderAt(room.simulation, { x: 20, z: 0 });
    place(room.player, 20, 12, { motionX, motionZ: 0 });
    Object.assign(shooter.ai, { acquiredAt: room.simulation.time - seconds, settleAmplitude: RAIDER_AIM_TUNING.settle });
    const muzzle = room.simulation.raiderMuzzle(shooter, point);
    let hits = 0;
    for (let shot = 0; shot < 400; shot++) {
      hits += room.simulation.traceRaiderShot(shooter, muzzle, point, { sigma: room.simulation.raiderAimError(shooter, room.player, muzzle, point) }).hits;
    }
    return hits / 400;
  };
  const settled = rate({ seconds: 10 }), walking = rate({ seconds: 10, motionX: 3.5 }), fresh = rate({ seconds: 0 });
  assert.ok(settled > walking * 1.2 && walking > fresh, `settled ${settled}, walking ${walking}, fresh ${fresh}`);
  assert.ok(settled < .9 && fresh > 0, 'a seeded spread really misses and hits');
});

test('flinch: real hits push the next shot once, burns never flinch, and SMG fire cannot stun-lock a raider', () => {
  const { simulation } = arena();
  const raider = raiderAt(simulation, { x: 20, z: 0, state: 'advance' }), ai = raider.ai;
  ai.nextShotAt = simulation.time + .05;
  raider.hp -= 10;
  assert.equal(simulation.raiderFlinch(raider, TICK), true);
  assert.ok(Math.abs(ai.nextShotAt - simulation.time - .35) < 1e-9 && Math.abs(ai.flinchUntil - simulation.time - .6) < 1e-9);
  assert.equal(ai.state, 'advance', 'wounded with no target within advanceFireRange, it keeps running in');
  const pushed = ai.nextShotAt;
  simulation.time += .1; raider.hp -= 10;
  assert.equal(simulation.raiderFlinch(raider, TICK), true);
  assert.equal(ai.nextShotAt, pushed, 'already flinching: no second delay');
  assert.ok(Math.abs(ai.flinchUntil - simulation.time - .6) < 1e-9, 'but the flinch window refreshes');
  // Four seconds of burning take health without a flinch.
  simulation.time = ai.flinchUntil + 1;
  Object.assign(raider, { hp: 1e4, maxHp: 1e4, burnUntil: simulation.time + 4, burnStartedAt: simulation.time, burnOwnerId: 'a' });
  ai.lastHp = raider.hp;
  const before = raider.hp;
  for (let step = 0; step < 150; step++) {
    simulation.time += TICK; simulation.updateBurns(TICK);
    assert.equal(simulation.raiderFlinch(raider, TICK), false);
  }
  assert.ok(raider.hp < before - 600);

  // A survivor emptying an SMG into a raider: it flinches throughout and still fires back.
  const fight = arena(), events = fight.events, gunner = raiderAt(fight.simulation, { x: 20, z: 0 });
  Object.assign(gunner, { hp: 1e6, maxHp: 1e6 }); gunner.ai.lastHp = 1e6;
  place(fight.player, 20, 10, { weapon: 'smg' });
  fight.player.inventory = { smg: { ammo: 1000, reserve: 0 } };
  advance(fight.simulation, 1);
  const start = named(events, 'raider-shot').length;
  let flinching = 0, landed = 0;
  for (let step = 0; step < 120; step++) {
    const aim = { x: gunner.x, y: gunner.y + enemyPosture(gunner).height * .6, z: gunner.z }, eye = fight.player.y + 1.55;
    fight.simulation.setInput('a', { forward: 0, strafe: 0, yaw: bearing(fight.player, aim),
      pitch: Math.atan2(aim.y - eye, Math.hypot(aim.x - fight.player.x, aim.z - fight.player.z)) });
    const hp = gunner.hp;
    fight.simulation.shoot('a');
    fight.simulation.tick(TICK);
    if (gunner.hp < hp) landed++;
    if (fight.simulation.time < gunner.ai.flinchUntil) flinching++;
  }
  assert.ok(landed > 30, `the survivor kept hitting (${landed})`);
  assert.ok(flinching > 100, 'the raider flinched almost the whole time');
  assert.ok(named(events, 'raider-shot').length - start >= 8, `it still fired ${named(events, 'raider-shot').length - start} shots in 4 s`);
});

test('bursts, magazines and reloads keep the table cadence at 30 Hz with carry-over scheduling', () => {
  for (const [key, gun] of Object.entries(RAIDER_LOADOUTS)) {
    const { simulation, events, player } = arena();
    const raider = raiderAt(simulation, { x: 20, z: 0, loadout: key });
    place(player, 20, 8);
    let reloadSeen = false;
    for (let step = 0; step < 30 * 16; step++) {
      simulation.tick(TICK);
      if (raider.reloadUntil > simulation.time) {
        reloadSeen = true;
        assert.equal(raider.crouched, true, `${key} crouches to reload`);
        assert.equal(simulation.snapshot().zombies.find(zombie => zombie.id === raider.id).reloading, true);
      }
    }
    assert.ok(reloadSeen, key);
    const times = named(events, 'raider-shot').map(shot => shot.time);
    assert.ok(times.length > gun.magazine, `${key} fired a second magazine`);
    // random() = .5: the middle burst length and pause.
    const burst = gun.burst[0] + Math.floor(.5 * (gun.burst[1] - gun.burst[0] + 1)), pause = (gun.pause[0] + gun.pause[1]) / 2;
    const cycle = burst * gun.interval + pause;
    for (let shot = 0; shot < gun.magazine; shot++) {
      const scheduled = times[0] + Math.floor(shot / burst) * cycle + shot % burst * gun.interval;
      assert.ok(times[shot] >= scheduled - 1e-6 && times[shot] < scheduled + TICK + 1e-6, `${key} shot ${shot}: ${times[shot]} vs ${scheduled}`);
    }
    // Shots per simulated second inside the magazine match the table exactly.
    const span = times[gun.magazine - 1] - times[0], expected = Math.floor((gun.magazine - 1) / burst) * cycle + (gun.magazine - 1) % burst * gun.interval;
    assert.ok(Math.abs(span - expected) < TICK + 1e-6, `${key} magazine span ${span} vs ${expected}`);
    const reload = times[gun.magazine] - times[gun.magazine - 1];
    assert.ok(reload >= gun.reload - 1e-6 && reload < gun.reload + TICK + 1e-6, `${key} reload ${reload}`);
    assert.equal(named(events, 'raider-shot').every(shot => shot.pellets.length === gun.pellets && shot.weapon === gun.model && shot.sound === gun.sound), true);
  }
});

test('suppressive fire keeps bursts on the last seen point for 1.5 s, over a survivor crouched under the sill', () => {
  const { simulation, events, player } = arena();
  const raider = raiderAt(simulation, { x: -17, z: 3.9, loadout: 'rifle' });
  place(player, -6.5, 3.9); hold(simulation, false);
  until(simulation, () => named(events, 'raider-shot').length >= 2, 3);
  for (let step = 0; step < 90; step++) { hold(simulation, true); simulation.tick(TICK); }
  const shots = named(events, 'raider-shot'), suppressive = shots.filter(shot => shot.suppress);
  const seen = raider.ai.seenAt;
  assert.ok(suppressive.length >= 3, `suppressive shots ${suppressive.length}`);
  assert.ok(suppressive.every(shot => shot.time > seen && shot.time <= seen + 1.5 + 1e-9), 'only within 1.5 s of losing sight');
  assert.ok(shots.at(-1).time <= seen + 1.5 + 1e-9, 'then the raider stops');
  assert.ok(suppressive.every(shot => shot.pellets.every(pellet => pellet.stop !== 'player')), 'tracers pass over the crouched survivor');
  assert.ok(suppressive.every(shot => Math.abs(shot.y - 1.5) < 1e-9), 'a suppressing raider stands to fire through the window');
  assert.equal(raider.ai.targetId, null, 'after 1.5 s unseen the target is dropped');
});

test('raider bullets: 8 plank damage once per shot with repair credit, zombies take the bullet, raiders block it', () => {
  const { simulation, events, player } = arena({ random: seededRandom(77) });
  const shotgun = raiderAt(simulation, { x: -12, z: 0, loadout: 'shotgun' }), door = simulation.doors.find(item => item.id === 'west');
  place(player, 40, 40);
  const origin = { x: -11.7, y: 1.34, z: 0 }, plank = { x: -4, y: 1.34, z: 0 };
  const shot = simulation.traceRaiderShot(shotgun, origin, plank, { sigma: .02 });
  assert.ok(shot.pellets.filter(pellet => pellet.stop === 'board').length >= 4, 'most pellets strike planks');
  assert.equal(door.hp, door.maxHp - RAIDER_PLANK_DAMAGE, 'one shot, one plank hit');
  assert.equal(door.repairCredit, RAIDER_PLANK_DAMAGE);
  const boardEvents = named(events, 'board');
  assert.deepEqual(boardEvents.map(event => [event.zombieId, event.doorId, Object.hasOwn(event, 'bash')]), [[shotgun.id, 'west', false]]);
  assert.equal(named(events, 'raider-shot').at(-1).pellets.length, 8);

  // A walker between the raider and a survivor takes the bullet without crediting anyone.
  place(player, 20, 8);
  const rifle = raiderAt(simulation, { x: 20, z: 0, loadout: 'rifle' });
  const walker = { id: 'z90', x: 20, y: 0, z: 4, yaw: 0, hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false, speed: 0, attackAfter: Infinity,
    entered: false, doorId: 'east', stairState: null, pushX: 0, pushZ: 0, pushLeft: 0 };
  simulation.zombies.set(walker.id, walker);
  const target = { x: 20, y: 1.085, z: 8 }, muzzle = simulation.raiderMuzzle(rifle, target), score = player.score;
  let traced = simulation.traceRaiderShot(rifle, muzzle, target);
  assert.equal(traced.pellets[0].stop, 'zombie');
  assert.ok(Math.abs(80 - walker.hp - 9 * Math.min(1.15, damageFalloff(WEAPONS.rifle, traced.pellets[0].distance))) < .01);
  assert.equal(named(events, 'hit').length, 0);
  walker.hp = 1;
  simulation.traceRaiderShot(rifle, muzzle, target);
  assert.equal(simulation.zombies.has(walker.id), false);
  assert.deepEqual([named(events, 'kill').at(-1).id, named(events, 'kill').at(-1).weapon, player.score], [null, 'raider', score]);
  assert.ok([...simulation.pickups.values()].some(pickup => pickup.kind === 'points'), 'normal zombie loot');
  // A squad-mate in the way stops the pellet and takes nothing.
  const mate = raiderAt(simulation, { x: 20, z: 4 });
  traced = simulation.traceRaiderShot(rifle, muzzle, target);
  assert.deepEqual([traced.pellets[0].stop, mate.hp, named(events, 'hit').length], ['raider', mate.maxHp, 0]);
  // And the live fire control holds the shot while that mate masks the line.
  assert.equal(simulation.raiderLineBlocked(rifle, muzzle, target), true);
  mate.x = 22;
  assert.equal(simulation.raiderLineBlocked(rifle, muzzle, target), false, '2 m off the line no longer masks it');
});

test('a shotgun blast sums its pellets into one damagePlayer call per survivor; hits carry the origin, armour absorbs, damageScale applies', () => {
  const { simulation, events, player } = arena({ players: 2, sturdy: false, random: seededRandom(5) });
  const raider = raiderAt(simulation, { x: 20, z: 0, loadout: 'shotgun', damageScale: .7 }), teammate = simulation.players.get('b');
  place(player, 19.8, 3); place(teammate, 20.3, 3);
  player.armor = 5;
  const calls = [], damagePlayer = simulation.damagePlayer.bind(simulation);
  simulation.damagePlayer = (...args) => { calls.push(args); return damagePlayer(...args); };
  const point = { x: 20, y: 1.085, z: 3 };
  const shot = simulation.traceRaiderShot(raider, simulation.raiderMuzzle(raider, point), point, { sigma: .08 });
  const struck = shot.pellets.filter(pellet => pellet.stop === 'player');
  assert.ok(struck.length >= 6, 'nearly every pellet lands at 3 m');
  assert.deepEqual(calls.map(([survivor]) => survivor.id).sort(), ['a', 'b'], 'one call per survivor');
  const hits = named(events, 'hit');
  assert.equal(hits.length, 2);
  const total = struck.reduce((sum, pellet) => sum + 5 * Math.min(1.15, damageFalloff(WEAPONS.shotgun, pellet.distance)), 0) * .7;
  assert.ok(Math.abs(hits.reduce((sum, hit) => sum + hit.damage, 0) - total) < .02);
  const mine = hits.find(hit => hit.id === 'a');
  assert.deepEqual(mine, { ...mine, source: 'raider', raiderId: raider.id, fromX: 20, fromZ: 0, absorbed: 5, armor: 0 });
  assert.equal(Object.hasOwn(mine, 'zombieId'), false);
  assert.ok(Math.abs(player.hp - (100 - (mine.damage - 5))) < 1e-9, 'the vest takes the first 5');
  assert.equal(named(events, 'raider-shot').at(-1).hits, struck.length);
  // Damage per hit before the scale, at 1.15 at most for the point-blank shotgun boost.
  assert.ok(struck.every(pellet => pellet.distance < 4));
  assert.ok(Math.abs(Math.max(...hits.map(hit => hit.damage))) <= 8 * 5 * 1.15 * .7 + 1e-9);
});

test('the drill reports hits without harm: drill-hit and no hit/down, planks and targets untouched, two presses leave two raiders', () => {
  const events = [], simulation = new RoomSimulation('PRACT9', { practice: true, random: seededRandom(9), onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  const press = () => { simulation.time += .25; return simulation.practiceAction('a', { action: 'raiders' }); };
  assert.equal(press(), true); assert.equal(press(), true); assert.equal(press(), true);
  const raiders = () => [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
  assert.equal(raiders().length, 2);
  assert.ok(raiders().every(raider => raider.drill && raider.x < 0), 'third press: back on the west side');
  // Stand in the west-b window where both drill raiders can see the survivor.
  place(player, -6.5, 3.9);
  const targets = [...simulation.zombies.values()].filter(zombie => zombie.kind !== 'raider').map(zombie => [zombie.id, zombie.hp]);
  for (let step = 0; step < 30 * 20; step++) { simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); simulation.tick(TICK); }
  assert.ok(named(events, 'raider-shot').length > 5, 'drill raiders fire normally');
  assert.ok(named(events, 'drill-hit').length > 0, 'and report their hits');
  assert.ok(named(events, 'drill-hit').every(hit => hit.id === 'a' && /^r\d+$/.test(hit.raiderId) && Number.isFinite(hit.fromX) && hit.damage > 0));
  assert.equal(events.some(event => event.event === 'hit' || event.event === 'down'), false);
  assert.deepEqual([player.hp, player.downed], [100, false]);
  assert.ok(raiders().every(raider => ['advance', 'engage'].includes(raider.ai.state)), 'never a breach');
  assert.ok(simulation.doors.every(door => door.hp === door.maxHp), 'planks untouched');
  assert.equal(events.some(event => (event.event === 'board' || event.event === 'door') && event.bash), false, 'never a bash');
  assert.deepEqual([...simulation.zombies.values()].filter(zombie => zombie.kind !== 'raider').map(zombie => [zombie.id, zombie.hp]), targets);
  // A drill pellet through a practice target or a plank stops there harmlessly.
  const [raider] = raiders(), target = simulation.zombies.get(targets[0][0]);
  const through = (from, point) => simulation.traceRaiderShot(raider, { ...from, y: point.y }, point).pellets[0].stop;
  assert.equal(through({ x: -7, z: target.z }, { x: target.x, y: 1, z: target.z }), 'zombie');
  assert.equal(target.hp, target.maxHp);
  assert.equal(through({ x: -12, z: 0 }, { x: -4, y: 1.34, z: 0 }), 'board');
  assert.ok(simulation.doors.every(door => door.hp === door.maxHp));
});

test('running in, a raider holds fire beyond advanceFireRange and opens fire inside it before engaging', () => {
  assert.equal(RAIDER_AIM_TUNING.advanceFireRange, 16);
  // The shotgun's 15 m range already sits inside the hold; every other gun reaches beyond it.
  for (const loadout of ['pistol', 'smg', 'assault', 'rifle']) {
    const { simulation, events, player } = arena();
    place(player, 30, 14);
    const raider = raiderAt(simulation, { x: 30, z: -14, loadout, state: 'advance' });
    Object.assign(raider.ai, { stagingX: 30, stagingZ: 60 });
    let far = 0, near = 0, seenFar = false;
    for (let step = 0; step < 8 / TICK && raider.ai.state === 'advance'; step++) {
      hold(simulation, false);
      const before = events.length;
      simulation.tick(TICK);
      if (raider.ai.state !== 'advance') break;
      const gap = Math.hypot(raider.x - player.x, raider.z - player.z), shots = named(events.slice(before), 'raider-shot').length;
      if (gap > RAIDER_AIM_TUNING.advanceFireRange + .5) {
        far += shots;
        seenFar ||= raider.ai.sight?.visible === true && simulation.time >= raider.ai.reactionUntil && gap < RAIDER_LOADOUTS[loadout].range - .5;
      } else if (gap < RAIDER_AIM_TUNING.advanceFireRange - .5) near += shots;
    }
    assert.ok(seenFar, `${loadout}: in sight, reacted and within range while still beyond the hold`);
    assert.equal(far, 0, `${loadout} never fires while running in from beyond advanceFireRange`);
    assert.ok(near > 0, `${loadout} fires inside advanceFireRange while still advancing`);
  }
});

test('survivors beyond targetRadius are never targeted, hunted or shot', () => {
  const { simulation, events, player } = arena();
  const raider = raiderAt(simulation, { x: -17, z: 0, loadout: 'assault' });
  // Within reach of the gun and in plain view: only the 45 m radius excludes him.
  place(player, -52, 0);
  assert.ok(Math.hypot(player.x, player.z) > RAIDS.targetRadius && Math.hypot(raider.x - player.x, raider.z - player.z) < RAIDER_LOADOUTS.assault.range);
  assert.ok(simulation.raiderTargetPoint(raider, player), 'a clear line');
  assert.equal(simulation.updateRaiderSight(raider, simulation.livingPlayers()), null);
  assert.equal(simulation.raiderQuarry(raider, simulation.livingPlayers()), null);
  // Inside the radius he is seen, and a target walking out past it is dropped at once.
  place(player, -44, 0);
  assert.equal(simulation.updateRaiderSight(raider, simulation.livingPlayers()).id, 'a');
  assert.equal(simulation.raiderQuarry(raider, simulation.livingPlayers()).id, 'a');
  assert.equal(simulation.raiderValidateTarget(raider), false);
  place(player, -46, 0);
  assert.equal(simulation.raiderValidateTarget(raider), true);
  assert.deepEqual([raider.ai.targetId, raider.ai.sight], [null, null]);
  // Left alone there for six seconds, the raider neither shoots nor goes after him.
  place(player, -52, 0);
  for (let step = 0; step < 6 / TICK; step++) { hold(simulation, false); simulation.tick(TICK); }
  assert.equal(named(events, 'raider-shot').length, 0);
  assert.equal(raider.ai.targetId, null);
  assert.ok(raider.x > -17.5, `it stayed by the cabin: ${raider.x.toFixed(2)}`);
});

test('a squad-mate on the aim line holds the shot, then the raider fires once the line clears', () => {
  const { simulation, events, player } = arena({ random: seededRandom(11) });
  place(player, 12, 0);
  const rear = raiderAt(simulation, { x: 20, z: 0, loadout: 'rifle' }), mate = raiderAt(simulation, { x: 16.5, z: 0 });
  mate.ai.nextShotAt = Infinity;
  const own = () => named(events, 'raider-shot').filter(shot => shot.raiderId === rear.id);
  const masked = until(simulation, () => (hold(simulation, false), Number.isFinite(rear.ai.blockedAt)), 3);
  assert.ok(masked, 'the mate masked the line');
  assert.equal(rear.ai.blockedAt, simulation.time);
  assert.ok(Math.abs(rear.ai.nextShotAt - simulation.time - .15) < 1e-9, 'a short retry, never a banked shot');
  assert.equal(own().length, 0, 'no shot into the mate');
  assert.equal(simulation.raiderLineMasked(rear), true);
  // Masked, it moves along the facade instead of freezing; it never fires into its mate's back.
  for (let step = 0; step < 30; step++) { hold(simulation, false); simulation.tick(TICK); }
  assert.ok(rear.ai.strafeLeft > 0 || rear.ai.moving === 'strafe' || Math.abs(rear.z) > .5, 'it shifted to clear the line');
  assert.ok(own().every(shot => shot.pellets.every(pellet => pellet.stop !== 'raider')));
  // Once the mate steps away, the rifle fires within half a second.
  Object.assign(mate, { x: 30, z: 8 });
  const fired = own().length;
  assert.ok(until(simulation, () => (hold(simulation, false), own().length > fired), .5), 'it fires once the line is clear');
  assert.ok(own().every(shot => shot.pellets.every(pellet => pellet.stop !== 'raider')));
});
