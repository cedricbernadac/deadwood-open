// The blood's plumbing in the browser client (art/frisson/BLOOD-SPRAY.md
// sections 4.2, 4.3, 4.7 and 5.1): every wound the server sends becomes one
// `impact` hook event, moved with the body this PC draws, with its damage,
// its spray number and when it lands; raiders never reach the hook; a kill
// without a wound of its own (fire) bleeds once, as a legacy spray. A Famille
// room and a PC locked to Famille call no hook and draw exactly what the
// client drew before these lines (a stripped copy of client.js).
// client.js runs in a vm (test/helpers/frisson-client.mjs) with a recording pack.
import assert from 'node:assert/strict';
import test from 'node:test';
import { settle, recordingPack, clientHarness, snapshotFor, prepareClient, CLIENT_SOURCE } from './helpers/frisson-client.mjs';
import { deriveOnlineClient } from '../online-client-build.mjs';
import { enemyProfile } from '../public/enemies.js';

const near = (actual, expected, label, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} against ${expected}`);
const IMPACT_KEYS = ['axisX', 'axisZ', 'boss', 'damage', 'delay', 'dirX', 'dirY', 'dirZ', 'headshot', 'kill', 'kind', 'local', 'mode', 'scale', 'shot', 'weapon', 'x', 'y', 'z', 'zombieId'];
const enemy = (id, x, z, extra = {}) => ({ id, kind: 'walker', boss: false, x, y: 0, z, yaw: 0, hp: 400, maxHp: 400, scale: 1, ...extra });
// The tracer stub flies at 100 m/s: its travel is its length / 100.
const tracer = (start, end) => ({ travel: start.distanceTo(end) / 100 });
// A Frisson night with the recording pack on, this PC the guest.
async function frissonNight(zombies, options = {}) {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log, tracer, ...options });
  client.join('guest');
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies });
  client.update(state); await settle(); await settle();
  client.enter(); client.update(state);
  const impacts = () => pack.events.filter(([name]) => name === 'impact').map(([, event]) => event);
  return { client, pack, state, impacts };
}
const mesh = (client, id) => client.zombies.filter(body => body.userData.id === id && !client.disposed.includes(body)).at(-1);
// A teammate's shot from (0, 1.5, 0) straight down -z.
const shot = (pellets, extra = {}) => ({ type: 'event', event: 'shot', id: 'host', weapon: 'shotgun', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0, pellets, ...extra });
const pellet = (distance, stop, wounds) => ({ yaw: 0, pitch: 0, distance, stop, ...(wounds ? { wounds } : {}) });
// The travel the client gives a pellet stopping at `distance` from that eye.
const travelTo = distance => (distance - Math.min(.5, distance * .25)) / 100;

test('a shot with wounds: one impact per wound, one spray number per event, the point on the drawn body, the delay of the bullet, every field of the contract', async () => {
  const { client, impacts } = await frissonNight([enemy('z5', 0, -4), enemy('b1', 0, -6, { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400 })]);
  // This PC draws the walker 10 cm off where the server hit it (the mesh trails).
  mesh(client, 'z5').position.set(.1, 0, -3.9);
  client.event(shot([
    pellet(8, 'solid', [['z5', 3.68, 25.2, 0, 0, 0, 0, -4], ['b1', 5.61, 92.777, 1, 0, 0, 0, -6]]),
    pellet(8, 'solid', [['z5', 3.7, 25.2, 1, 0, 0, 0, -4]]),
  ]));
  const [first, second, third] = impacts();
  assert.equal(impacts().length, 3, 'one per wound, none for the stops');
  assert.deepEqual(Object.keys(first).sort(), IMPACT_KEYS);
  assert.equal(first.shot, second.shot); assert.equal(first.shot, third.shot);
  // eye + dir × hitAt, then moved by (mesh − feet).
  near(first.x, .1, 'x'); near(first.y, 1.5, 'y'); near(first.z, -3.68 + .1, 'z');
  near(first.axisX, .1, 'axisX'); near(first.axisZ, -3.9, 'axisZ');
  assert.deepEqual([first.dirX, first.dirY, first.dirZ].map(value => Math.round(value * 1e9) / 1e9 + 0), [0, 0, -1]);
  near(first.delay, travelTo(8) * 3.68 / 8, 'delay = travel × hitAt / distance');
  assert.deepEqual({ ...first, x: 0, y: 0, z: 0, axisX: 0, axisZ: 0, dirX: 0, dirY: 0, dirZ: 0, delay: 0, shot: 0 },
    { x: 0, y: 0, z: 0, axisX: 0, axisZ: 0, dirX: 0, dirY: 0, dirZ: 0, delay: 0, shot: 0,
      headshot: false, kill: false, zombieId: 'z5', damage: 25.2, weapon: 'shotgun', mode: 'bullet', kind: 'walker', boss: false, scale: 1, local: false });
  // The colossus: where the server hit it (its mesh has not moved), its kind and size.
  assert.deepEqual([second.zombieId, second.kind, second.scale, second.headshot, second.damage], ['b1', 'brute', 1.22, true, 92.777]);
  near(second.z, -5.61, 'z'); near(second.delay, travelTo(8) * 5.61 / 8, 'its own delay');
  assert.equal(third.headshot, true);
  // The next event is another spray.
  client.event(shot([pellet(8, 'solid', [['z5', 3.68, 25.2, 0, 0, 0, 0, -4]])]));
  assert.equal(impacts()[3].shot, first.shot + 1);
  // A stop in a body without wounds (an old server) draws its sparks and bleeds nothing.
  const sparks = client.impacts.length;
  client.event(shot([pellet(4, 'zombie')], { weapon: 'pistol' }));
  assert.equal(impacts().length, 4); assert.equal(client.impacts.length, sparks + 1); assert.equal(client.impacts.at(-1).kind, 'zombie');
});

test('a body the shot has just killed: its kill came first and took the mesh away, its wounds still move with the corpse', async () => {
  const { client, impacts } = await frissonNight([enemy('z5', 0, -4, { hp: 80, maxHp: 80 })]);
  mesh(client, 'z5').position.set(.2, 0, -3.8);
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 'z5', headshot: true, boss: false, x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'shotgun', score: 10, chain: 1, range: 3.68 });
  assert.equal(client.state().zombieIds.includes('z5'), false, 'the mesh left the living');
  assert.deepEqual(impacts(), [], 'a hitscan kill bleeds from its wounds, not as a burst');
  client.event(shot([pellet(8, 'solid', [['z5', 3.68, 92.8, 1, 1, 0, 0, -4]]), pellet(8, 'solid', [['z5', 3.7, 42.2, 0, 1, 0, 0, -4]])], { kills: 1 }));
  const [killing, after] = impacts();
  for (const wound of [killing, after]) {
    assert.equal(wound.kill, true); assert.equal(wound.kind, 'walker');
    near(wound.x, .2, 'x'); near(wound.axisX, .2, 'axisX'); near(wound.axisZ, -3.8, 'axisZ');
  }
  near(killing.z, -3.68 + .2, 'z');
  assert.deepEqual(client.fallen(), ['z5']);
  // Gone from the snapshot too: the corpse's mesh still tells its kind and size.
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [] }));
  client.event(shot([pellet(8, 'solid', [['z5', 3.68, 30, 0, 1, 0, 0, -4]])]));
  assert.deepEqual([impacts()[2].kind, impacts()[2].scale], ['walker', 1]); near(impacts()[2].x, .2, 'x');
});

test('the fallen ring: an id killed again (a new night, ids restart) bleeds on its new corpse; a rocket felling eleven keeps all eleven; leaving empties it; a body on a step moves the wound up', async () => {
  const { client, impacts } = await frissonNight([enemy('z1', 0, -4, { hp: 80, maxHp: 80 })]);
  const killZ1 = (x, z) => client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 'z1', headshot: false, boss: false, x, y: 0, z, dirX: 0, dirZ: -1, weapon: 'shotgun', score: 10, chain: 1, range: 3 });
  mesh(client, 'z1').position.set(.1, 0, -4);
  killZ1(0, -4);
  // The next night (restart after the results): ids start at z1 again, by the east wall.
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'gameover', zombies: [] }));
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [enemy('z1', 3, -1.5, { hp: 80, maxHp: 80 })] }));
  mesh(client, 'z1').position.set(3.2, 0, -1.5);
  killZ1(3, -1.5);
  client.event(shot([pellet(8, 'solid', [['z1', 1.5, 92.8, 1, 1, 3, 0, -1.5]])]));
  near(impacts().at(-1).x, .2, 'on tonight\'s corpse, not on last night\'s 3 m away'); near(impacts().at(-1).axisX, 3.2, 'its axis');
  assert.deepEqual(client.fallen(), ['z1'], 'one entry for the id');
  // A rocket felling eleven: every wound lands on its own corpse.
  const crowd = Array.from({ length: 11 }, (_, index) => enemy(`r${index}`, index - 5, -6));
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: crowd }));
  for (const body of crowd) mesh(client, body.id).position.set(body.x + .4, 0, -6);
  for (const body of crowd) client.event({ type: 'event', event: 'kill', id: 'host', zombieId: body.id, headshot: false, boss: false, x: body.x, y: 0, z: -6, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain: 1 });
  const before = impacts().length;
  client.event({ type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 0, y: 1, z: -7, radius: 4, hits: 11, kills: 11, wounds: crowd.map(body => [body.id, body.x, .935, -6, 700, 1]) });
  const blasts = impacts().slice(before);
  assert.equal(blasts.length, 11);
  for (const [index, wound] of blasts.entries()) { near(wound.x, crowd[index].x + .4, `${wound.zombieId} on its corpse`); near(wound.axisX, crowd[index].x + .4, `${wound.zombieId} axis`); }
  // A body drawn on a step .5 m above the feet the server hit it at: the wound moves up with it.
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [enemy('s1', 0, -4)] }));
  mesh(client, 's1').position.set(0, .5, -4);
  client.event(shot([pellet(8, 'solid', [['s1', 3.68, 25, 0, 0, 0, 0, -4]])], { weapon: 'pistol' }));
  near(impacts().at(-1).y, 1.5 + .5, 'y moves with the drawn body');
  // Leaving the room empties the ring.
  client.leave();
  assert.deepEqual(client.fallen(), []);
});

test('online: a runner drawn by the timeline .25 m from the feet the server rewound to bleeds on the drawn body', async () => {
  const online = await prepareClient(deriveOnlineClient(CLIENT_SOURCE));
  let drawn = { id: 'run', x: .25, y: 0, z: -4, yaw: 0 };
  const session = { connected: true, predictedPlayer: null, update: () => ({ commands: [] }), cameraPlayer: self => self, consumeShotEcho: () => true,
    timeline: { sample: () => ({ zombies: [drawn], players: [] }) } };
  const { client, impacts } = await frissonNight([enemy('run', 0, -4, { kind: 'runner' })], { client: online, session });
  client.time(16); client.frame(16);
  const body = mesh(client, 'run');
  assert.deepEqual([body.position.x, body.position.z], [.25, -4], 'the timeline places the body');
  // The server hit the rewound pose (0, 0, -4) on its front face, 3.68 m out.
  client.event(shot([pellet(8, 'solid', [['run', 3.68, 25, 0, 0, 0, 0, -4]])], { weapon: 'pistol' }));
  const [wound] = impacts();
  assert.ok(Math.abs(wound.x - body.position.x) <= .32 && Math.abs(wound.z - body.position.z) <= .32 + 1e-9, `inside the drawn hitbox: ${wound.x}, ${wound.z}`);
  near(wound.x, .25, 'x'); near(wound.z, -3.68, 'z'); assert.equal(wound.kind, 'runner');
  drawn = { ...drawn, x: -.4 };
  client.time(32); client.frame(32);
  client.event(shot([pellet(8, 'solid', [['run', 3.68, 25, 0, 0, 0, 0, -4]])], { weapon: 'pistol' }));
  near(impacts()[1].x, -.4, 'follows the timeline');
});

test('raiders never reach the hook: not a wound, a kill or a blow; a raider bullet that stops in a zombie bleeds exactly once, as a teammate\'s', async () => {
  const { client, impacts } = await frissonNight([enemy('r1', 2, -4, { kind: 'raider', hp: 80, maxHp: 80, weapon: 'smg' }), enemy('z5', 0, -4)]);
  client.event(shot([pellet(8, 'solid', [['r1', 3.68, 25, 0, 0, 2, 0, -4]])], { weapon: 'sniper' }));
  client.event({ type: 'event', event: 'melee-hit', id: 'host', weapon: 'bat', attack: 'light', hits: 1, kills: 0, impacts: [{ zombieId: 'r1', x: 2, y: 1.2, z: -3.7, damage: 80, dirX: 0, dirZ: -1, power: 120, feet: [2, 0, -4], killed: true }] });
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 'r1', headshot: false, boss: false, x: 2, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'flamethrower', score: 10, chain: 1, raider: true });
  client.event({ type: 'event', event: 'explosion', id: 'host', grenadeId: 'g1', x: 2, y: .2, z: -3, hits: 1, kills: 1, wounds: [['r1', 2, .9, -4, 450, 1]] });
  assert.deepEqual(impacts(), []);
  const sparks = client.impacts.length;
  client.event({ type: 'event', event: 'raider-shot', raiderId: 'r9', weapon: 'smg', x: 0, y: 1.5, z: -8, yaw: Math.PI, pitch: 0, hits: 0,
    pellets: [{ yaw: Math.PI, pitch: 0, distance: 3.68, stop: 'zombie', wounds: [['z5', 3.68, 7.7, 0, 0, 0, 0, -4]] }] });
  assert.equal(impacts().length, 1, 'once: its wound, not also its stop');
  assert.deepEqual([impacts()[0].zombieId, impacts()[0].local, impacts()[0].mode, impacts()[0].weapon], ['z5', false, 'bullet', 'smg']);
  near(impacts()[0].z, -8 + 3.68, 'from the raider\'s barrel');
  assert.equal(client.impacts.length, sparks + 1, 'its sparks are drawn as before');
});

test('kills: hitscan, melee, blast and raider kills call no impact; a fire kill calls one legacy burst at the body\'s middle, toward the killer, or the camera for a burn', async () => {
  const { client, impacts } = await frissonNight(['k1', 'k2', 'k3', 'k4', 'k5', 'f1', 'f2'].map((id, index) => enemy(id, index - 3, -4)).concat(enemy('f3', 4, -4, { kind: 'brute', scale: 1.22 })));
  const kill = (zombieId, weapon, extra = {}) => client.event({ type: 'event', event: 'kill', id: 'host', zombieId, headshot: false, boss: false, x: mesh(client, zombieId)?.position.x ?? 0, y: 0, z: -4, dirX: 0, dirZ: -1, weapon, score: 10, chain: 1, ...extra });
  kill('k1', 'rifle', { range: 4 }); kill('k2', 'katana'); kill('k3', 'rocket'); kill('k4', 'grenade'); kill('k5', 'raider', { id: null });
  assert.deepEqual(impacts(), []);
  for (let now = 16; now < 1000; now += 16) { client.time(now); client.frame(now); }
  assert.deepEqual(impacts(), [], 'not after the rocket lands either');
  // Flame contact: toward the killer (the kill's direction is from the killer).
  kill('f1', 'flamethrower');
  const [contact] = impacts(), height = enemyProfile({ kind: 'walker' }).height;
  assert.deepEqual([contact.mode, contact.damage, contact.kill, contact.zombieId, contact.weapon], ['legacy', null, true, 'f1', 'flamethrower']);
  near(contact.x, 2, 'x'); near(contact.y, .55 * height, 'the body\'s middle'); near(contact.z, -4 + .25, '.25 toward the killer');
  // A burn: no direction, so toward the camera.
  const camera = client.camera();
  kill('f2', 'flamethrower', { dirX: 0, dirZ: 0 });
  const burn = impacts()[1], away = Math.hypot(camera[0] - 3, camera[2] + 4);
  assert.ok(away > 1, 'the camera is away from the body');
  near(burn.x, 3 + .25 * (camera[0] - 3) / away, 'toward the camera x', 1e-6); near(burn.z, -4 + .25 * (camera[2] + 4) / away, 'toward the camera z', 1e-6);
  // A colossus: its middle and its .25 grow with its size.
  kill('f3', 'flamethrower');
  near(impacts()[2].y, .55 * height * 1.22, 'a colossus\'s middle'); near(impacts()[2].z, -4 + .25 * 1.22, 'its front');
  assert.equal(impacts()[2].kind, 'brute');
});

test('melee: the blow\'s power when the server sends it, else its damage; the point moves with the drawn body', async () => {
  const { client, impacts } = await frissonNight([enemy('m1', 0, -2), enemy('m2', 1, -2)]);
  mesh(client, 'm1').position.set(.05, 0, -1.9);
  client.event({ type: 'event', event: 'melee-hit', id: 'guest', weapon: 'hammer', attack: 'heavy', hits: 2, kills: 1, impacts: [
    { zombieId: 'm1', x: 0, y: 1.2, z: -1.68, damage: 400, dirX: 0, dirZ: -1, power: 900, feet: [0, 0, -2], killed: true },
    { zombieId: 'm2', x: 1, y: 1.2, z: -1.68, damage: 450, dirX: .6, dirZ: -.8, killed: false }] });
  const [blow, old] = impacts();
  assert.deepEqual([blow.damage, blow.mode, blow.local, blow.kill, blow.weapon, blow.dirY], [900, 'melee', true, true, 'hammer', 0]);
  near(blow.x, .05, 'x'); near(blow.z, -1.68 + .1, 'z'); near(blow.y, 1.2, 'y');
  assert.deepEqual([old.damage, old.dirX, old.dirZ, old.x, old.z], [450, .6, -.8, 1, -1.68], 'no feet: where the server put it');
  assert.equal(blow.shot, old.shot);
});

test('blasts: each wound bleeds outward from the blast, a rocket\'s when it lands, a grenade\'s at once', async () => {
  const { client, impacts, state } = await frissonNight([enemy('g1', 0, -4), enemy('g2', 1, -5)]);
  const host = state.players.find(player => player.id === 'host');
  client.event({ type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 0, y: 1, z: -5, radius: 4, hits: 2, kills: 1,
    wounds: [['g1', 0, .935, -4, 700, 1], ['g2', 1, .935, -5, 350, 0]] });
  const [first, second] = impacts(), arrival = Math.min(.6, Math.hypot(host.x - 0, host.y + 1.5 - 1, host.z + 5) / 170);
  assert.deepEqual([first.mode, first.damage, first.kill, first.weapon, first.dirX, first.dirY, first.dirZ], ['blast', 700, true, 'rocket', 0, 0, 1]);
  assert.deepEqual([second.dirX, second.dirZ, second.kill], [1, 0, false]);
  near(first.delay, arrival, 'the rocket\'s arrival'); assert.ok(first.delay > 0);
  near(first.y, .935, 'the hitbox middle'); assert.equal(first.shot, second.shot);
  client.event({ type: 'event', event: 'explosion', id: 'guest', grenadeId: 'g7', x: 0, y: .2, z: -4, hits: 1, kills: 0, wounds: [['g2', 1, .935, -5, 225, 0]] });
  assert.deepEqual([impacts()[2].weapon, impacts()[2].delay, impacts()[2].local], ['grenade', 0, true]);
  near(impacts()[2].dirX, Math.SQRT1_2, 'radial'); near(impacts()[2].dirZ, -Math.SQRT1_2, 'radial');
});

test('one refilled object for every impact; impacts never wait in the cue list, a rocket\'s death still does', async () => {
  const seen = [];
  const client = clientHarness({ tracer, importer: () => Promise.resolve({ install(ctx) {
    ctx.hooks.impact = event => seen.push(event); ctx.hooks.death = () => {}; ctx.hooks.frame = () => {};
    return { uninstall() {} };
  } }) });
  client.join('guest');
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [enemy('z5', 0, -4), enemy('z7', 4, -2)] });
  Object.assign(state.players.find(player => player.id === 'host'), { x: 4, y: 0, z: 13.5 });
  client.update(state); await settle(); await settle(); client.enter();
  client.event(shot([pellet(8, 'solid', [['z5', 3.68, 25, 0, 0, 0, 0, -4]]), pellet(8, 'solid', [['z5', 3.7, 25, 0, 0, 0, 0, -4]])]));
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 'z7', headshot: false, boss: false, x: 4, y: 0, z: -2, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain: 1 });
  client.event({ type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 4, y: 1, z: -2.5, radius: 4, hits: 1, kills: 1, wounds: [['z7', 4, .935, -2, 700, 1]] });
  assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 1, 'one object, refilled');
  assert.deepEqual(client.cueHooks().filter(hook => hook !== null), ['death'], 'only the rocket\'s death waits among the hooks');
  assert.ok(seen[0].delay > 0, 'the delay travels in the event');
});

// The 4.2 lines of client.js, each with what stood there before: the copy
// without them is the client before the blood's plumbing.
const CLIENT_LINES = [
  [`// hook reads what it needs at once; a hit says itself when it lands).
const ambianceFrame = { delta: 0, time: 0, self: null, snapshot: null };
const ambianceImpactEvent = { x: 0, y: 0, z: 0, dirX: 0, dirY: 0, dirZ: 0, headshot: false, kill: false, zombieId: null,
  damage: null, weapon: null, mode: 'legacy', shot: 0, kind: null, boss: false, scale: 1, axisX: NaN, axisZ: NaN, local: false, delay: 0 };
// One number per server event: the wounds of one shot, blow or blast on one
// body make one spray (art/frisson/BLOOD-SPRAY.md 2.1).
let ambianceShot = 0;
// The last bodies killed: a kill removes the mesh before its own shot's
// wounds arrive, and they still bleed where that body is drawn. Room for
// every kill one event can make (a rocket into a horde); searched newest
// first, an id killed again (ids restart each night and room) replaces its
// older entry, and leaving the room empties it.
const fallenIds = new Array(64).fill(null), fallenBodies = new Array(64).fill(null);
let fallenNext = 0;
function rememberFallen(zombieId, body) {
  for (let index = 0; index < fallenIds.length; index++) if (fallenIds[index] === zombieId) { fallenIds[index] = null; fallenBodies[index] = null; }
  fallenIds[fallenNext] = zombieId; fallenBodies[fallenNext] = body; fallenNext = (fallenNext + 1) % fallenIds.length;
}
// A wound, or a kill burst without one, for the pack's blood
// (art/frisson/BLOOD-SPRAY.md section 4.2). The event says when it lands
// (delay, on the visual clock) and which spray it belongs to (shot). The
// enemy's kind and size come from the snapshot current on arrival (a killed
// enemy is still in it) or its mesh. The server hit the body at its feet
// then; this PC draws it elsewhere (LAN: the mesh trails; online: the
// timeline), so the wound moves with the drawn body. Raiders never reach the hook.
function ambianceImpact(delay, x, y, z, dirX, dirY, dirZ, headshot, kill, zombieId, damage, weapon, mode, local, feetX, feetY, feetZ, shot = ambianceShot) {
  if (raiderSeen(zombieId)) return;
  let enemy = null, mesh = null;
  if (zombieId != null) {
    const enemies = snapshot?.zombies;
    if (Array.isArray(enemies)) for (let index = 0; index < enemies.length; index++) if (enemies[index]?.id === zombieId) { enemy = enemies[index]; break; }
    mesh = zombieMeshes.get(zombieId) ?? null;
    if (!mesh) for (let back = 1; back <= fallenIds.length; back++) {
      const index = (fallenNext - back + fallenIds.length) % fallenIds.length;
      if (fallenIds[index] === zombieId) { mesh = fallenBodies[index]; break; }
    }
  }
  if (enemy?.kind === 'raider' || mesh?.userData.raider === true) return;
  const at = mesh?.position, known = Number.isFinite(feetX) && Number.isFinite(feetZ);
  if (at && known) { x += at.x - feetX; z += at.z - feetZ; if (Number.isFinite(feetY)) y += at.y - feetY; }
  const event = ambianceImpactEvent;
  event.x = x; event.y = y; event.z = z; event.dirX = dirX; event.dirY = dirY; event.dirZ = dirZ;
  event.headshot = headshot === true; event.kill = kill === true; event.zombieId = zombieId ?? null;
  event.damage = Number.isFinite(damage) ? damage : null; event.weapon = weapon ?? null;
  event.mode = event.damage === null ? 'legacy' : mode; event.shot = shot;
  event.kind = enemy?.kind ?? mesh?.userData.kind ?? null; event.boss = enemy ? enemy.boss === true : mesh?.userData.boss === true;
  event.scale = Number.isFinite(enemy?.scale) ? enemy.scale : Number.isFinite(mesh?.scale?.x) ? mesh.scale.x : 1;
  event.axisX = at ? at.x : known ? feetX : NaN; event.axisZ = at ? at.z : known ? feetZ : NaN;
  event.local = local === true; event.delay = delay > 0 ? delay : 0;
  callAmbianceHook('impact', event);
}
`, `// hook reads what it needs at once; a delayed hit gets its own).
const ambianceFrame = { delta: 0, time: 0, self: null, snapshot: null };
const ambianceImpactEvent = { x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, headshot: false, kill: false, zombieId: null };
function ambianceImpact(delay, x, y, z, dirX, dirZ, headshot, kill, zombieId) {
  if (delay > 0) { ambianceHook('impact', { x, y, z, dirX, dirZ, headshot, kill, zombieId }, delay); return; }
  const event = ambianceImpactEvent;
  event.x = x; event.y = y; event.z = z; event.dirX = dirX; event.dirZ = dirZ; event.headshot = headshot; event.kill = kill; event.zombieId = zombieId;
  callAmbianceHook('impact', event);
}
`],
  [`  if (ambianceHooks.impact) ambianceShot = (ambianceShot + 1) | 0;
`, ''],
  [`    for(const impact of event.impacts??[])if(Number.isFinite(impact.x)&&Number.isFinite(impact.y)&&Number.isFinite(impact.z)){impactEffect(impact.x,impact.y,impact.z,false,0,{kill:impact.killed===true,zombieId:impact.zombieId,dirX:impact.dirX,dirZ:impact.dirZ});if(ambianceHooks.impact)ambianceImpact(0,impact.x,impact.y,impact.z,impact.dirX??0,0,impact.dirZ??0,false,impact.killed===true,impact.zombieId,Number.isFinite(impact.power)?impact.power:impact.damage,event.weapon,'melee',local,impact.feet?.[0],impact.feet?.[1],impact.feet?.[2]);}
`, `    for(const impact of event.impacts??[])if(Number.isFinite(impact.x)&&Number.isFinite(impact.y)&&Number.isFinite(impact.z))impactEffect(impact.x,impact.y,impact.z,false,0,{kill:impact.killed===true,zombieId:impact.zombieId,dirX:impact.dirX,dirZ:impact.dirZ});
`],
  [`      if (ambianceHooks.impact) rememberFallen(event.zombieId, body);
`, ''],
  [`  fallenIds.fill(null); fallenBodies.fill(null); fallenNext = 0;
`, ''],
  [`    // Blood for a kill without a wound of its own (fire, burning): at the
    // body's middle, a little toward the killer (or the camera), where the
    // torso cannot hide it. Shots, raider bullets, blows and blasts bleed
    // from their wounds (BLOOD-SPRAY.md 4.2).
    if (audible && ambianceHooks.impact && !(event.ballistic === true || Number.isFinite(event.range) || MELEE_WEAPONS[event.weapon] || event.weapon === 'rocket' || event.weapon === 'grenade' || event.weapon === 'raider')
      && Number.isFinite(event.x) && Number.isFinite(event.y) && Number.isFinite(event.z)) {
      const size = body?.scale?.y || 1, height = body ? enemyProfile(body.userData).height * size : 2;
      const dirX = Number.isFinite(event.dirX) ? event.dirX : 0, dirZ = Number.isFinite(event.dirZ) ? event.dirZ : 0;
      let towardX = -dirX, towardZ = -dirZ;
      if (Math.hypot(towardX, towardZ) < 1e-6) { towardX = camera.position.x - event.x; towardZ = camera.position.z - event.z; }
      const across = Math.hypot(towardX, towardZ) || 1, front = .25 * size;
      ambianceImpact(killDelay, event.x + towardX / across * front, event.y + .55 * height, event.z + towardZ / across * front,
        dirX, 0, dirZ, event.headshot === true, true, event.zombieId, null, event.weapon ?? null, 'legacy', local, event.x, event.y, event.z);
    }
`, ''],
  [`    // Every body the blast reached bleeds from its middle, outward, when it lands.
    if (ambianceHooks.impact && Array.isArray(event.wounds)) for (let index = 0; index < event.wounds.length; index++) {
      const wound = event.wounds[index], x = Number(wound?.[1]), y = Number(wound?.[2]), z = Number(wound?.[3]);
      const dx = x - event.x, dz = z - event.z, across = Math.hypot(dx, dz);
      ambianceImpact(delay, x, y, z, across > 1e-6 ? dx / across : 0, 0, across > 1e-6 ? dz / across : 0,
        false, wound?.[5] === 1, wound?.[0], Number(wound?.[4]), event.weapon ?? 'grenade', 'blast', local, x, NaN, z);
    }
`, ''],
  [`    // Every body this pellet entered bleeds where it entered, when the bullet gets there.
    if (ambianceHooks.impact && Array.isArray(pellet.wounds) && event.weapon !== 'rocket') {
      for (let index = 0; index < pellet.wounds.length; index++) {
        const wound = pellet.wounds[index], hitAt = Number(wound?.[1]);
        if (!Number.isFinite(hitAt) || hitAt < 0) continue;
        ambianceImpact(Number.isFinite(distance) && distance > 0 ? travel * Math.min(1, hitAt / distance) : travel,
          eye.x + direction.x * hitAt, eye.y + direction.y * hitAt, eye.z + direction.z * hitAt,
          direction.x, direction.y, direction.z, wound[3] === 1, wound[4] === 1, wound[0], Number(wound[2]), event.weapon ?? null, 'bullet', local,
          Number(wound[5]), Number(wound[6]), Number(wound[7]));
      }
    }
`, ''],
  [`  world.effects?.impact(point, { kind: 'zombie', direction, time: visualSeconds() + delay, raider: raiderNear(point) });
}
`, `  world.effects?.impact(point, { kind: 'zombie', direction, time: visualSeconds() + delay, raider: raiderNear(point) });
  if (ambianceHooks.impact) ambianceImpact(delay, point.x, point.y, point.z, direction?.x ?? 0, direction?.z ?? 0, false, false, null);
}
`],
  [`  world.effects?.impact({ x, y, z }, { kind: headshot ? 'headshot' : 'kill', time: visualSeconds() + delay, kill: hit?.kill ?? true, raider: hit?.raider === true || raiderSeen(hit?.zombieId), dirX, dirZ, top: hit?.top ?? null });
}
`, `  world.effects?.impact({ x, y, z }, { kind: headshot ? 'headshot' : 'kill', time: visualSeconds() + delay, kill: hit?.kill ?? true, raider: hit?.raider === true || raiderSeen(hit?.zombieId), dirX, dirZ, top: hit?.top ?? null });
  if (ambianceHooks.impact) ambianceImpact(delay, x, y, z, dirX, dirZ, headshot, hit?.kill ?? true, hit?.zombieId ?? null);
}
`],
];
function stripClient(source) {
  source = source.replace(/\r\n/g, '\n');
  for (const [anchor, replacement] of CLIENT_LINES) {
    assert.equal(source.split(anchor).length - 1, 1, anchor.trim().split('\n')[0]);
    source = source.replace(anchor, () => replacement);
  }
  return source;
}
const STRIPPED = await prepareClient(stripClient(CLIENT_SOURCE));

// A night's events, wounds included, as a Frisson server sends them.
async function woundedNight(client, ambiance) {
  client.join('guest');
  const zombies = [enemy('z5', 0, -4), enemy('z6', 1, -4, { hp: 80, maxHp: 80 }), enemy('r1', -2, -4, { kind: 'raider', weapon: 'smg' }), enemy('b1', 2, -6, { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400 })];
  const state = snapshotFor({ ambiance, phase: 'wave', zombies });
  Object.assign(state.players.find(player => player.id === 'host'), { x: 4, y: 0, z: 13.5 });
  client.update(state); await settle(); await settle();
  client.enter(); client.update(state);
  const events = [
    { type: 'event', event: 'kill', id: 'host', zombieId: 'z6', headshot: true, boss: false, x: 1, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'shotgun', score: 10, chain: 1, range: 3.68 },
    shot([pellet(8, 'solid', [['z5', 3.68, 42.2, 0, 0, 0, 0, -4], ['b1', 5.61, 92.8, 1, 0, 2, 0, -6]]), pellet(4, 'zombie', [['z6', 3.68, 92.8, 1, 1, 1, 0, -4]]), pellet(4, 'zombie')]),
    { type: 'event', event: 'melee-hit', id: 'guest', weapon: 'bat', attack: 'light', hits: 1, kills: 0, impacts: [{ zombieId: 'z5', x: 0, y: 1.2, z: -3.68, damage: 120, dirX: 0, dirZ: -1, power: 120, feet: [0, 0, -4], killed: false }] },
    { type: 'event', event: 'raider-shot', raiderId: 'r1', weapon: 'smg', x: -2, y: 1.5, z: -8, yaw: Math.PI, pitch: 0, hits: 0, pellets: [{ yaw: Math.PI, pitch: 0, distance: 3.68, stop: 'zombie', wounds: [['z5', 3.68, 7.7, 0, 0, 0, 0, -4]] }] },
    { type: 'event', event: 'kill', id: 'host', zombieId: 'b1', headshot: false, boss: false, x: 2, y: 0, z: -6, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain: 1 },
    { type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 2, y: 1, z: -6.5, radius: 4, hits: 1, kills: 1, wounds: [['b1', 2, 1.1, -6, 700, 1]] },
    { type: 'event', event: 'kill', id: 'host', zombieId: 'z5', headshot: false, boss: false, x: 0, y: 0, z: -4, dirX: 0, dirZ: 0, weapon: 'flamethrower', score: 10, chain: 1 },
    { type: 'event', event: 'kill', id: 'host', zombieId: 'r1', headshot: false, boss: false, x: -2, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'pistol', score: 10, chain: 1, range: 4, raider: true },
  ];
  for (const event of events) client.event(event);
  for (let now = 16; now < 1000; now += 16) { client.time(now); client.frame(now); }
}

test('Famille, and a PC locked to Famille in a Frisson room: the wounds arrive, no hook is called, nothing waits, and the effects are exactly those of the client before the blood', async () => {
  for (const [ambiance, locked] of [['family', false], ['frisson', true]]) {
    const runs = [];
    for (const client of [CLIENT_SOURCE, null]) {
      const log = [], pack = recordingPack(log);
      const harness = clientHarness({ importer: pack.importer, log, locked, tracer, ...(client ? {} : { client: STRIPPED }) });
      await woundedNight(harness, ambiance);
      runs.push({ harness, pack });
    }
    const [now, before] = runs, label = `${ambiance}${locked ? ', locked' : ''}`;
    assert.equal(now.pack.imports, 0, label); assert.deepEqual(now.pack.events, [], `${label}: no hook call`);
    assert.deepEqual(now.harness.fallen(), [], `${label}: the fallen ring stays empty`);
    assert.equal(now.harness.state().cues, before.harness.state().cues, `${label}: nothing more waits`);
    assert.ok(now.harness.impacts.length >= 6, `${label}: ${now.harness.impacts.length} bursts`);
    assert.deepEqual(now.harness.impacts, before.harness.impacts, `${label}: the same effects, the same arguments, in the same order`);
  }
});

test('the same night in a Frisson room bleeds: every wound once, the fire kill as a legacy burst, the raider never', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log, tracer });
  await woundedNight(client, 'frisson');
  const impacts = pack.events.filter(([name]) => name === 'impact').map(([, event]) => event);
  assert.deepEqual(impacts.map(event => [event.zombieId, event.mode]), [
    ['z5', 'bullet'], ['b1', 'bullet'], ['z6', 'bullet'], ['z5', 'melee'], ['z5', 'bullet'], ['b1', 'blast'], ['z5', 'legacy']]);
  assert.equal(impacts.some(event => event.zombieId === 'r1'), false);
  // The shot's wounds share a number; every other event has its own.
  const shots = impacts.map(event => event.shot);
  assert.equal(shots[0], shots[1]); assert.equal(shots[1], shots[2]);
  assert.equal(new Set(shots.slice(2)).size, 5);
  // The killed walker's posthumous mesh is in the ring.
  assert.ok(client.fallen().includes('z6'));
});
