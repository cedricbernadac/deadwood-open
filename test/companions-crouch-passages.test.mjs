import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { doorwayPassage, doorwayOpen, wayOut, rainCost, shutOut } from '../companions/outdoors.mjs';
import { PLAYER_POSTURE } from '../public/movement.js';

const LOW = [0, 0, 60, 60, 60], STANDING = [0, 0, 0, 0, 60];
const outside = player => Math.abs(player.x) > 8 || Math.abs(player.z) > 6;
function fixture({ doorId = 'west', boards = LOW } = {}) {
  const events = [], sim = new RoomSimulation('LOWDOOR', { random: () => .5, onEvent: event => events.push(event) });
  const human = sim.addPlayer('human', 'Human'), bot = sim.addPlayer('bot', 'Bot', undefined, { companion: true });
  sim.start(human.id); Object.assign(sim, { phase: 'intermission', wave: 2, timeLeft: 1e9 });
  for (const door of sim.doors) Object.assign(door, { sealed: door.id !== doorId, sealPending: false });
  const door = sim.doors.find(door => door.id === doorId); door.boards = [...boards];
  Object.assign(human, { x: -2.8, y: 0, z: 2.7 });
  Object.assign(bot, { x: door.x - door.outX * 2, y: 0, z: door.z - door.outZ * 2 });
  sim.beginSupplyWave();
  const body = createCompanionBody(sim, bot.id, { random: () => .5 });
  const commands = [], input = sim.setInput.bind(sim);
  sim.setInput = (id, command) => { if (id === bot.id) commands.push({ ...command }); return input(id, command); };
  let left = false;
  const run = (seconds, until = () => false, each = () => {}) => {
    for (let tick = 0; tick < seconds * 30; tick++) {
      body.tick(1 / 30); sim.tick(1 / 30); left ||= outside(bot); each();
      if (until()) return true;
    }
    return false;
  };
  return { sim, human, bot, door, body, events, commands, run, get left() { return left; } };
}

test('the exact two-lower-plank opening is physically crouchable, never standing or sealed', () => {
  const { sim, door, bot } = fixture();
  assert.equal(door.hp, 180);
  assert.equal(sim.doorPassable(door, 0, PLAYER_POSTURE.standingHeight), false);
  assert.equal(sim.doorPassable(door, 0, PLAYER_POSTURE.crouchedHeight), true);
  assert.deepEqual(doorwayPassage(sim, door), { crouch: true, height: 1.05 });
  assert.equal(sim.canOccupy(bot, door.x, door.z, 0, .25), false);
  assert.equal(sim.canOccupy({ ...bot, crouched: true }, door.x, door.z, 0, .25), true);
  door.sealPending = true; assert.equal(doorwayPassage(sim, door), null);
  door.sealPending = false; door.sealed = true; assert.equal(doorwayOpen(sim, door), false);
});

test('crouched passage adds real travel time to rain affordability without inventing walking distance', () => {
  const { sim, door, bot } = fixture();
  const low = wayOut(sim, sim.supplyCrate, [door]);
  assert.equal(low.crouch, true);
  door.boards = [...STANDING];
  const standing = wayOut(sim, sim.supplyCrate, [door]);
  assert.equal(standing.crouch, false); assert.equal(low.distance, standing.distance);
  const normal = rainCost(sim, bot, standing.distance, standing), slow = rainCost(sim, bot, low.distance, low);
  assert.ok(slow.seconds > normal.seconds);
  bot.umbrella.remaining = 0;
  assert.ok(rainCost(sim, bot, low.distance, low).burn > rainCost(sim, bot, standing.distance, standing).burn);
  bot.hp = 1; assert.equal(rainCost(sim, bot, low.distance, low).affordable, false);
});

test('a real body collects outside and returns crouching through each of the four low doorways', () => {
  for (const doorId of ['west', 'east', 'north', 'south']) {
    const scene = fixture({ doorId }), { sim, bot, door, body, commands, events, run } = scene;
    bot.inventory.pistol.ammo = 0; bot.inventory.pistol.reserve = 0;
    const pickup = { id: 'ammo-low', kind: 'ammo', x: door.x + door.outX * 3.2, y: 0,
      z: door.z + door.outZ * 3.2, expiresAt: 100 };
    sim.pickups.set(pickup.id, pickup); body.setOrder({ kind: 'collect', pickupId: pickup.id });
    assert.ok(run(18, () => body.status === 'done'), `${doorId}: collection and return finish`);
    assert.equal(scene.left, true, doorId); assert.equal(sim.pickups.has(pickup.id), false);
    assert.equal(outside(bot), false); assert.equal(bot.crouched, false);
    assert.ok(commands.some(command => command.crouch), doorId);
    assert.ok(commands.every(command => !command.jump), 'ordinary player movement only');
    assert.deepEqual(door.boards, LOW, 'does not destroy planks to enlarge a usable opening');
    assert.equal(events.filter(event => event.event === 'shot' && event.id === bot.id).length, 0);
  }
});

test('a real crate trip crosses the low opening, claims its free bonus and comes safely back', () => {
  const scene = fixture(), { sim, bot, door, body, run } = scene;
  body.setOrder({ kind: 'claim', bonus: 'grenadier' });
  assert.ok(run(30, () => body.status === 'done'));
  assert.equal(scene.left, true); assert.equal(sim.supplyCrate.claimed.has(bot.id), true);
  assert.equal(bot.bonus.grenadier, 1); assert.equal(outside(bot), false); assert.equal(bot.crouched, false);
  assert.deepEqual(door.boards, LOW); assert.equal(bot.hp, 100);
});

test('an empty-handed return through a low opening never shoots its intact upper planks', () => {
  const { bot, door, body, commands, events, run } = fixture();
  Object.assign(bot, { x: -10.5, z: 0 }); bot.inventory.pistol.ammo = 0; bot.inventory.pistol.reserve = 0;
  body.setOrder({ kind: 'hold' });
  assert.ok(run(12, () => bot.x > -7 && !bot.crouched));
  assert.ok(commands.some(command => command.crouch)); assert.deepEqual(door.boards, LOW);
  assert.equal(events.filter(event => event.event === 'shot').length, 0);
});

test('interrupting a trip in the low threshold returns inside before standing up', () => {
  const { bot, door, body, run } = fixture();
  body.setOrder({ kind: 'claim', bonus: 'grenadier' });
  assert.ok(run(8, () => Math.abs(bot.x - door.x) < .2 && bot.crouched));
  body.setOrder({ kind: 'hold' });
  assert.ok(run(8, () => bot.x > -7 && !bot.crouched));
  assert.deepEqual(door.boards, LOW);
});

test('repeated repair orders at the reproduced outside threshold wait until the bot has returned', () => {
  const { sim, bot, door, body, events, run } = fixture();
  Object.assign(bot, { x: -9.007608487106232, z: 0 });
  sim.supplyCrate.claimed.add(bot.id);
  bot.inventory.pistol.ammo = 0; bot.inventory.pistol.reserve = 0;
  let ticks = 0;
  const repaired = { kind: 'repair', doorId: door.id };
  body.setOrder(repaired);
  assert.ok(run(4, () => bot.x > -6.85, () => {
    if (++ticks % 6 === 0) body.setOrder(repaired);
    assert.deepEqual(door.boards, LOW, 'never repairs or shoots its own return passage from outside');
  }));
  assert.equal(events.some(event => event.event === 'shot' && event.id === bot.id), false);
  run(2);
  assert.equal(bot.crouched, false);
  assert.ok(door.hp > 180, 'the same repair order works once safely inside');
});

test('changing orders after a real claim never interrupts clearing the low return passage', () => {
  const { sim, human, bot, door, body, run } = fixture();
  body.setOrder({ kind: 'claim', bonus: 'reinforced' });
  assert.ok(run(15, () => sim.supplyCrate.claimed.has(bot.id)));
  let ticks = 0;
  const orders = [{ kind: 'follow', playerId: human.id }, { kind: 'repair', doorId: door.id },
    { kind: 'defend', doorId: door.id }, { kind: 'hold' }];
  body.setOrder(orders[0]);
  assert.ok(run(12, () => bot.x > -6.85, () => {
    if (++ticks % 9 === 0) body.setOrder(orders[Math.floor(ticks / 9) % orders.length]);
    assert.deepEqual(door.boards, LOW);
  }));
  assert.equal(bot.bonus.reinforced, 1); assert.equal(bot.hp, 100);
});

test('returning under low planks still allows reflex shots while a new repair order waits', () => {
  const { sim, bot, door, body, events, run } = fixture();
  Object.assign(bot, { x: -9.007608487106232, z: 0 });
  sim.supplyCrate.claimed.add(bot.id);
  Object.assign(sim.spawnZombie(), { x: -9.8, y: 0, z: 1.5, speed: 0, hp: 10000, maxHp: 10000,
    entered: true, attackAfter: Infinity });
  body.setOrder({ kind: 'repair', doorId: door.id });
  assert.ok(run(4, () => bot.x > -6.85));
  assert.deepEqual(door.boards, LOW);
  assert.ok(events.some(event => event.event === 'shot' && event.id === bot.id), 'reacts without stopping the return');
});

test('a newly blocked low opening cancels the outward trip without crossing planks', () => {
  const { sim, bot, door, body, run } = fixture();
  body.setOrder({ kind: 'claim', bonus: 'grenadier' });
  run(.1); door.boards[1] = 60;
  run(4);
  assert.equal(body.status, 'failed'); assert.equal(outside(bot), false);
  assert.equal(sim.supplyCrate.claimed.has(bot.id), false); assert.equal(doorwayPassage(sim, door), null);
});

test('repair cannot shut out a human who can return only while crouched', () => {
  const { sim, human, bot, door, body, run } = fixture();
  Object.assign(human, { x: -10, z: 0 });
  sim.supplyCrate.claimed.add(bot.id); body.setOrder({ kind: 'repair', doorId: door.id });
  assert.deepEqual(shutOut(sim, door, bot.id).map(player => player.id), [human.id]);
  run(4); assert.deepEqual(door.boards, LOW);
});

test('an old repair order preserves the only affordable crate route for a companion, then repairs after its claim', () => {
  const { sim, bot, door, body, run } = fixture({ boards: STANDING });
  body.setOrder({ kind: 'repair', doorId: door.id }); run(.1);
  assert.equal(body.status, 'failed'); assert.deepEqual(door.boards, STANDING);
  sim.supplyCrate.claimed.add(bot.id); body.setOrder({ kind: 'repair', doorId: door.id }); run(2);
  assert.ok(door.hp > 60, 'unused human claim alone never locks a repair indefinitely');
});

test('a visible immediate threat keeps repairing legal even with an unclaimed companion bonus', () => {
  const { sim, bot, door, body, run } = fixture({ boards: STANDING });
  Object.assign(bot, { x: -6.8, z: .8 });
  Object.assign(sim.spawnZombie(), { x: -5.8, y: 0, z: .8, speed: 0, hp: 10000, maxHp: 10000, entered: true, attackAfter: Infinity });
  body.setOrder({ kind: 'repair', doorId: door.id }); run(.1);
  assert.ok(door.hp > 60); assert.notEqual(body.status, 'failed');
});

test('repair remains legal when a different open doorway keeps the crate trip affordable', () => {
  const { sim, door, body, run } = fixture({ boards: STANDING });
  // Move the real crate to the north-west yard so both routes are in reach.
  Object.assign(sim.supplyCrate, { x: -10, z: -9 });
  const north = sim.doors.find(item => item.id === 'north');
  Object.assign(north, { sealed: false, boards: [...LOW] });
  assert.ok(wayOut(sim, sim.supplyCrate, [north]));
  body.setOrder({ kind: 'repair', doorId: door.id }); run(.1);
  assert.ok(door.hp > 60); assert.notEqual(body.status, 'failed');
});

test('a crate trip the companion cannot afford in rain does not lock a repair', () => {
  const { sim, bot, door, body, run } = fixture({ boards: STANDING });
  bot.umbrella.remaining = 0; bot.hp = 21;
  const way = wayOut(sim, sim.supplyCrate, [door]);
  assert.equal(rainCost(sim, bot, way.distance, way).affordable, false);
  body.setOrder({ kind: 'repair', doorId: door.id }); run(.1);
  assert.ok(door.hp > 60); assert.notEqual(body.status, 'failed');
});

test('recent damage at the doorway keeps an ongoing emergency repair legal', () => {
  const { sim, bot, door, body, run } = fixture({ boards: STANDING });
  sim.supplyCrate.claimed.add(bot.id);
  body.setOrder({ kind: 'repair', doorId: door.id }); run(1 / 30);
  assert.ok(door.hp > 60);
  // The bonus window is now available, but the doorway has just taken damage.
  sim.supplyCrate.claimed.delete(bot.id); door.boards = [0, 0, 0, 0, 20];
  run(.6);
  assert.ok(door.hp > 20); assert.notEqual(body.status, 'failed');
});
