import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { CompanionDirector } from '../companions/director.mjs';
import { describeSituation } from '../companions/situation.mjs';

function setup() {
  let director, draws = 0;
  const sim = new RoomSimulation('PROFILE', { random: () => .5, onEvent: event => director?.onEvent(event) });
  sim.addPlayer('host', 'Papa');
  const hub = { connected: true };
  director = new CompanionDirector(sim, hub, { random: () => (++draws % 10) / 10,
    createBody: (sim, id, options) => ({ profile: options.profile, setOrder() {}, setProfile(profile) { this.profile = profile; } }) });
  return { sim, hub, director, draws: () => draws };
}
const selection = ['veteran', 'timid', 'veteran'];
const bots = sim => [...sim.players.values()].filter(player => player.companion);

test('host chooses repeated archetypes atomically; invalid input never changes roster or selections', () => {
  const { sim, hub, director } = setup();
  assert.equal(director.setCount(3, 'host', selection), true);
  assert.deepEqual(bots(sim).map(player => player.companionProfile.archetype), selection);
  const original = bots(sim).map(player => player.companionProfile);
  for (const invalid of [null, [], ['veteran'], ['veteran', 'bogus', 'timid'], {}, ['random', 'random', { aim: 0 }]]) {
    assert.equal(director.setCount(0, 'host', invalid), false);
    assert.equal(director.count, 3);
    assert.deepEqual(sim.companionSelections, selection);
  }
  assert.equal(director.setCount(0, 'guest', ['random', 'random', 'random']), false);
  hub.connected = false;
  assert.equal(director.setCount(3, 'host', ['timid', 'timid', 'timid']), false);
  assert.equal(director.setCount(1, 'host'), true, 'old count-only messages keep working offline');
  assert.equal(bots(sim)[0].companionProfile, original[0]);
});

test('preview stays exact for first night, stable across waves, then rerolls once for next night', () => {
  const { sim, director, draws } = setup();
  director.setCount(2, 'host', selection);
  const initial = bots(sim).map(player => player.companionProfile), before = draws();
  sim.start('host');
  assert.equal(draws(), before, 'first night uses the lobby preview');
  for (const event of ['wave', 'resupply', 'down', 'revive']) director.onEvent({ type: 'event', event });
  assert.deepEqual(bots(sim).map(player => player.companionProfile), initial);
  sim.phase = 'intermission';
  assert.equal(director.setCount(0, 'host', selection), false, 'cannot edit between waves');
  sim.phase = 'gameover'; sim.start('host');
  assert.ok(draws() > before);
  bots(sim).forEach((player, index) => {
    assert.notEqual(player.companionProfile, initial[index]);
    assert.equal(player.companionProfile.archetype, selection[index]);
    assert.equal(director.entries.get(player.id).body.profile, player.companionProfile);
  });
  const rerolled = draws();
  director.onEvent({ type: 'event', event: 'wave' });
  assert.equal(draws(), rerolled);
});

test('changing a profile cancels stale plans/decisions without altering money or inventory', () => {
  const { sim, director, draws } = setup();
  director.setCount(1, 'host', selection);
  const player = bots(sim)[0], entry = director.entries.get(player.id);
  player.points = 1419;
  const inventory = structuredClone(player.inventory);
  let cancelled = 0;
  entry.ticket = { request: { cancel() { cancelled++; } } };
  director.teamPlanTicket = { request: { cancel() { cancelled++; } } };
  sim.companionTeamPlan = { revision: 7 };
  assert.equal(director.setCount(1, 'host', ['sharpshooter', 'timid', 'veteran']), true);
  assert.equal(cancelled, 2); assert.equal(sim.companionTeamPlan, null);
  assert.equal(player.points, 1419); assert.deepEqual(player.inventory, inventory);
  assert.equal(player.companionProfile.archetype, 'sharpshooter');
  const current = draws();
  director.setCount(1, 'host', ['sharpshooter', 'timid', 'veteran']);
  assert.equal(draws(), current, 'repeated snapshots/commands do not reroll');
});

test('selections and stable named slots survive removal, a human replacement and brain reconnect', () => {
  const { sim, director } = setup();
  director.setCount(3, 'host', selection);
  const max = bots(sim)[0]; max.downed = true;
  director.makeRoomForHuman();
  assert.deepEqual(bots(sim).map(player => player.companionSlot), [1, 2]);
  director.setCount(3, 'host');
  assert.deepEqual(bots(sim).map(player => player.companionSlot), [1, 2, 0]);
  assert.equal(bots(sim).at(-1).name, 'Max');
  assert.equal(bots(sim).at(-1).companionProfile.archetype, 'veteran');
  director.removeAll(); director.setCount(3, 'host');
  assert.deepEqual(sim.companionSelections, selection);
  assert.deepEqual(bots(sim).map(player => player.companionProfile.archetype), selection);
});

test('network snapshots expose chosen identity only, never private skill configuration', () => {
  const { sim, director } = setup();
  director.setCount(1, 'host', selection);
  const snapshot = sim.snapshot(), bot = snapshot.players.find(player => player.companion);
  assert.deepEqual(bot.companionProfile, { selection: 'veteran', archetype: 'veteran' });
  assert.equal(bot.companionSlot, 0);
  assert.equal(snapshot.players.find(player => !player.companion).companionProfile, undefined);
  assert.doesNotMatch(JSON.stringify(bot), /tremor|traits|variation|teamwork/);
  snapshot.companionSelections[0] = 'timid';
  assert.equal(sim.companionSelections[0], 'veteran');
});

test('a delayed keep answer is revalidated when its weapon runs completely out of ammunition', () => {
  const { sim, director } = setup();
  director.setCount(1, 'host', selection);
  const player = bots(sim)[0], entry = director.entries.get(player.id);
  sim.phase = 'wave'; sim.wave = 1;
  sim.zombies.set('enemy', { id: 'enemy', kind: 'walker', x: 0, y: 0, z: 2, hp: 100 });
  entry.order = { kind: 'shoot', zombieId: 'enemy' }; entry.value = 'shoot:enemy';
  director.describe = describeSituation;
  const before = describeSituation(sim, player.id, { order: entry.order });
  assert.ok(Object.hasOwn(before.orders, 'keep'));
  const ticket = { at: sim.time, generation: director.generation, epoch: entry.epoch,
    wave: sim.wave, phase: sim.phase, orders: before.orders };
  entry.ticket = ticket;
  player.inventory[player.weaponId].ammo = 0; player.inventory[player.weaponId].reserve = 0;
  assert.equal(director.apply(entry, ticket, { action: 'keep', confidence: 1 }), 'gone');
  assert.equal(entry.triggered, true);
});
