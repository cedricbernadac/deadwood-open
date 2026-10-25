// Frisson plumbing in the browser client: the home picker and the per-browser
// "Famille uniquement" lock, the loader called only for a Frisson room on an
// unlocked PC, the gated start, the zombie rebuild, the uninstall on leaving,
// a load called off (leaving, 20 s) leaving nothing on, and the hooks the
// pack listens to (art/frisson/DESIGN.md).
// client.js runs in a vm without a GPU (test/helpers/frisson-client.mjs): its
// imports are the real modules, except three, world, audio and graphics
// (stubs) and the loader (injected).
import assert from 'node:assert/strict';
import test from 'node:test';
import { HOOKS, NO_HOOKS, settle, pause, deferred, recordingPack, clientHarness, snapshotFor, joinMessage, walker } from './helpers/frisson-client.mjs';
import { t } from '../public/i18n.js';
import { ENEMY_HEALTH, BRUTE_HEALTH, enemyAppearance } from '../public/rules.js';


test('home picker: Famille on every load, Frisson only for a room made here, hidden for joining, never saved', () => {
  const client = clientHarness();
  assert.equal(client.node('ambiance-family').classList.contains('selected'), true);
  assert.equal(client.node('ambiance-family').attributes['aria-pressed'], 'true');
  assert.equal(client.node('ambiance-frisson').attributes['aria-pressed'], 'false');
  assert.equal(client.node('ambiance-picker').hidden, false);
  client.node('ambiance-frisson').click();
  assert.equal(client.node('ambiance-frisson').classList.contains('selected'), true);
  assert.equal(client.node('ambiance-family').classList.contains('selected'), false);
  const created = joinMessage(client);
  assert.equal(created.ambiance, 'frisson'); assert.equal(created.room, undefined);
  // The stand from the create tab uses the picker too.
  const stand = joinMessage(client, { practice: true });
  assert.equal(stand.practice, true); assert.equal(stand.ambiance, 'frisson');
  // Joining hides the picker and never asks for an ambiance (nor does the stand from there).
  client.node('join-tab').onclick();
  assert.equal(client.node('ambiance-picker').hidden, true);
  client.node('room-code').value = 'abc123';
  const joined = joinMessage(client);
  assert.equal(joined.room, 'ABC123'); assert.equal('ambiance' in joined, false);
  const standFromJoin = joinMessage(client, { practice: true });
  assert.equal(standFromJoin.practice, true); assert.equal('ambiance' in standFromJoin, false);
  client.node('create-tab').onclick();
  assert.equal(client.node('ambiance-picker').hidden, false);
  // Back to Famille: nothing sent.
  client.node('ambiance-family').click();
  assert.equal('ambiance' in joinMessage(client), false);
  assert.deepEqual(client.writes.filter(([key]) => key !== 'deadwood-name'), [], 'the choice is never stored');
  // A new page starts on Famille whatever was chosen before.
  assert.equal(clientHarness().state().homeAmbiance, 'family');
});

test('"Famille uniquement": stored per browser, Frisson cannot be chosen, the lock survives a reload', () => {
  const client = clientHarness();
  client.node('ambiance-frisson').click();
  client.node('family-lock').checked = true; client.node('family-lock').onchange({ target: client.node('family-lock') });
  assert.deepEqual(client.writes.at(-1), ['deadwood-family-lock', '1']);
  assert.equal(client.node('ambiance-frisson').disabled, true); assert.notEqual(client.node('ambiance-frisson').title, '');
  assert.equal(client.node('ambiance-family').classList.contains('selected'), true, 'locking falls back to Famille');
  client.node('ambiance-frisson').onclick();
  assert.equal(client.state().homeAmbiance, 'family');
  assert.equal('ambiance' in joinMessage(client), false);
  const reloaded = clientHarness({ locked: true });
  assert.equal(reloaded.state().familyLocked, true); assert.equal(reloaded.node('family-lock').checked, true);
  assert.equal(reloaded.node('ambiance-frisson').disabled, true);
  reloaded.node('family-lock').checked = false; reloaded.node('family-lock').onchange({ target: reloaded.node('family-lock') });
  assert.equal(reloaded.stored.get('deadwood-family-lock'), '0'); assert.equal(reloaded.node('ambiance-frisson').disabled, false);
});

test('a Famille room never calls the loader; hooks stay empty and nothing is queued for them', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(snapshotFor({ zombies: [walker(5)] }));
  assert.equal(client.node('ambiance-value').textContent, 'Famille'); assert.equal(client.node('ambiance-note').hidden, true);
  assert.equal(client.node('start-button').disabled, false);
  client.enter();
  const wave = snapshotFor({ phase: 'wave', zombies: [walker(5), walker(6, 3)] });
  client.update(wave);
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 5, headshot: true, boss: false, x: 2, y: 0, z: -4, dirX: 1, dirZ: 0, weapon: 'pistol', score: 10, chain: 1 });
  // Events carrying the Frisson wounds (art/frisson/BLOOD-SPRAY.md 4.1) change nothing here.
  client.event({ type: 'event', event: 'shot', id: 'host', weapon: 'shotgun', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0,
    pellets: [{ yaw: 0, pitch: 0, distance: 8, stop: 'solid', wounds: [[6, 3.68, 42.2, 0, 0, 3, 0, -4]] }] });
  client.event({ type: 'event', event: 'melee-hit', id: 'host', weapon: 'bat', attack: 'light', hits: 1, kills: 0, impacts: [{ zombieId: 6, x: 3, y: 1.2, z: -3.7, damage: 120, dirX: 0, dirZ: -1, power: 120, feet: [3, 0, -4], killed: false }] });
  client.event({ type: 'event', event: 'explosion', id: 'host', grenadeId: 'g1', x: 3, y: .2, z: -3, hits: 1, kills: 0, wounds: [[6, 3, .935, -4, 225, 0]] });
  wave.players.find(player => player.id === 'guest').hp = 60; client.update(wave);
  for (let now = 16; now < 400; now += 16) { client.time(now); client.frame(now); }
  assert.deepEqual(client.fallen(), []);
  client.leave();
  await settle();
  assert.deepEqual(client.loaderCalls, []); assert.equal(pack.imports, 0);
  assert.deepEqual(log, ['prewarm']);
  assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
  assert.equal(client.state().cues, 0);
  assert.equal(client.fetched.filter(url => /frisson/i.test(url)).length, 0);
});

test('the infected guide describes the Frisson markers once the pack is on in a Frisson room, Famille elsewhere', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  const marker = index => client.node('enemy-guide-families').children[index].children[3].textContent;
  assert.equal(marker(1), 'Bande au front');
  assert.match(client.node('enemy-guide-hulks').textContent, /gabarit massif et plaques distinctes/);
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  assert.equal(marker(1), 'Bandages souillés'); assert.equal(marker(5), 'Peau calcinée, braises');
  assert.match(client.node('enemy-guide-hulks').textContent, /chaînes, masque de fer, cage/);
  client.leave(); await settle();
  assert.equal(marker(1), 'Bande au front');
  assert.match(client.node('enemy-guide-hulks').textContent, /gabarit massif et plaques distinctes/);
});

test('a PC locked to Famille never imports Frisson, even inside a Frisson room, and says so', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ locked: true, importer: pack.importer, log });
  client.join('guest');
  client.update(snapshotFor({ ambiance: 'frisson', zombies: [walker(5)] }));
  assert.equal(client.node('ambiance-value').textContent, 'Frisson (15+)');
  assert.equal(client.node('ambiance-note').hidden, false); assert.equal(client.node('ambiance-note').textContent, 'Cet ordinateur reste en Famille.');
  assert.equal(client.node('start-button').disabled, false);
  client.enter(); client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] }));
  for (let now = 16; now < 200; now += 16) { client.time(now); client.frame(now); }
  client.leave(); await settle();
  assert.deepEqual(client.loaderCalls, []); assert.equal(pack.imports, 0);
  assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
});

test('a Frisson room imports once, holds the start while loading, installs before the prewarm, rebuilds zombies and comes off on leaving', async () => {
  const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('host');
  client.update(snapshotFor({ ambiance: 'frisson', zombies: [walker(5), walker(6, 3)] }));
  client.update(snapshotFor({ ambiance: 'frisson', zombies: [walker(5), walker(6, 3)] }));
  await settle();
  assert.deepEqual(client.loaderCalls, ['frisson'], 'one request, whatever the snapshot rate');
  assert.equal(pack.imports, 1);
  // While loading: the start is held and says so; entering waits.
  assert.equal(client.node('start-button').disabled, true); assert.equal(client.node('start-button').textContent, 'Chargement…');
  assert.equal(client.node('ambiance-note').textContent, 'Chargement…');
  client.node('start-button').onclick();
  assert.equal(client.sent.some(message => message.type === 'start'), false);
  client.enter();
  assert.equal(client.state().inGame, false);
  const before = new Set(client.zombies.filter(mesh => !mesh.userData.raider));
  gate.resolve(); await settle(); await settle();
  // Installed, then the pending entry went in: prewarm after install.
  assert.deepEqual(log, ['import', 'install', 'prewarm']);
  assert.equal(client.state().inGame, true); assert.equal(client.node('start-button').disabled, false);
  assert.equal(client.node('ambiance-note').hidden, true);
  // The zombies standing before the install were made again.
  assert.deepEqual(new Set(client.disposed), before);
  assert.deepEqual(client.state().zombieIds.sort(), [5, 6]);
  assert.equal(client.zombies.length, 4);
  // The context of DESIGN.md.
  const ctx = pack.contexts[0];
  for (const key of ['THREE', 'world', 'scene', 'renderer', 'camera', 'sound', 'feedback', 'hooks', 'quality', 'base', 'document', 'fetchAsset']) assert.ok(ctx[key] !== undefined, key);
  // The HUD, for the feedback look (art/frisson/UI-SOUND.md section 4.6).
  assert.equal(typeof ctx.feedback.setStyle, 'function'); assert.equal(ctx.feedback.style, null);
  assert.equal(ctx.world, client.world); assert.equal(ctx.quality, 'medium'); assert.equal(ctx.base, '/frisson/'); assert.equal(typeof ctx.fetchAsset, 'function');
  assert.deepEqual(Object.keys(ctx.hooks).sort(), [...HOOKS].sort());
  // Leaving takes the pack off; a later Famille room in this tab is Famille.
  client.leave(); await settle();
  assert.deepEqual(log, ['import', 'install', 'prewarm', 'uninstall']);
  assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
  client.join('host'); client.update(snapshotFor({ zombies: [walker(8)] })); await settle();
  assert.deepEqual(client.loaderCalls, ['frisson', 'family']);
  assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
  // Another Frisson room: installed again, not imported again.
  client.leave(); client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  assert.equal(pack.imports, 1); assert.deepEqual(log.filter(entry => entry === 'install'), ['install', 'install']);
});

test('leaving while Frisson still loads: the late install takes itself off', async () => {
  const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
  client.leave();
  gate.resolve(); await settle(); await settle();
  assert.deepEqual(log, ['import', 'install', 'uninstall']);
  assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
  assert.equal(client.state().ambianceReady, true);
});

test('a pack that cannot load falls back to Famille with a toast and a note, and the night can start', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const log = [], pack = recordingPack(log, { fail: true }), client = clientHarness({ importer: pack.importer, log });
    client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
    assert.equal(client.node('toast').hidden, false); assert.match(client.node('toast').textContent, /Frisson n’a pas pu se charger/);
    assert.match(client.node('ambiance-note').textContent, /Famille sur cet ordinateur/);
    assert.equal(client.node('start-button').disabled, false);
    client.node('start-button').onclick();
    assert.ok(client.sent.some(message => message.type === 'start'));
    assert.equal(client.state().inGame, true);
    assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
    // No retry at every snapshot.
    client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
    assert.equal(pack.imports, 1);
  } finally { console.warn = warn; }
});

test('a pack that never arrives: called off after 20 s, Famille once the grace is over, and the late install takes itself off', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log, loader: { grace: 20 } });
    client.join('host'); client.update(snapshotFor({ ambiance: 'frisson', zombies: [walker(5)] })); await settle();
    client.enter();
    assert.equal(client.state().inGame, false);
    const timeout = client.timers.filter(timer => timer.ms === 20000);
    assert.equal(timeout.length, 1);
    timeout[0].callback(); await settle();
    // Its install might still land and come off within the grace: held until then.
    assert.equal(client.state().inGame, false); assert.equal(client.node('start-button').disabled, true);
    await pause(60);
    assert.match(client.node('toast').textContent, /Frisson n’a pas pu se charger/);
    assert.equal(client.node('start-button').disabled, false);
    assert.equal(client.state().inGame, true, 'the waiting entry goes in, in Famille');
    assert.deepEqual(log, ['import', 'install', 'prewarm']);
    // No new attempt at the next snapshots.
    client.update(snapshotFor({ ambiance: 'frisson', zombies: [walker(5)] })); await settle();
    assert.deepEqual(client.loaderCalls, ['frisson', 'family']);
    gate.resolve(); await settle(); await settle();
    assert.deepEqual(log, ['import', 'install', 'prewarm', 'uninstall']);
    assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null });
  } finally { console.warn = warn; }
});

test('the hooks fire with the documented fields: impact, death, frame and hurt', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5), walker(6, 3), walker(7, 4)] }));
  await settle(); await settle();
  client.enter();
  const events = name => pack.events.filter(([kind]) => kind === name).map(([, event]) => event);
  // A bullet that entered a zombie (a teammate's pistol): its wound
  // (art/frisson/BLOOD-SPRAY.md 4.3), not a kill.
  client.event({ type: 'event', event: 'shot', id: 'host', weapon: 'pistol', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0,
    pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'zombie', wounds: [[5, 3.68, 25.2, 0, 0, 2, 0, -4]] }] });
  const [hit] = events('impact');
  assert.deepEqual(Object.keys(hit).sort(), ['axisX', 'axisZ', 'boss', 'damage', 'delay', 'dirX', 'dirY', 'dirZ', 'headshot', 'kill', 'kind', 'local', 'mode', 'scale', 'shot', 'weapon', 'x', 'y', 'z', 'zombieId']);
  assert.equal(hit.kill, false); assert.equal(hit.headshot, false); assert.equal(hit.zombieId, 5);
  assert.deepEqual([hit.damage, hit.weapon, hit.mode, hit.kind, hit.boss, hit.scale, hit.local, hit.axisX, hit.axisZ, hit.delay], [25.2, 'pistol', 'bullet', 'walker', false, 1, false, 2, -4, 0]);
  assert.ok(Number.isInteger(hit.shot));
  assert.ok(Math.abs(hit.z + 3.68) < 1e-9); assert.ok(Math.abs(hit.dirZ + 1) < 1e-9); assert.ok(Math.abs(hit.dirX) < 1e-9); assert.ok(Math.abs(hit.dirY) < 1e-9);
  // A kill: the death with its body; a bullet's kill bleeds from its wounds, so no burst.
  const body = client.zombies.find(mesh => mesh.userData.id === 5 && !client.disposed.includes(mesh));
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 5, headshot: true, boss: false, x: 2, y: 0, z: -4, dirX: .6, dirZ: -.8, weapon: 'pistol', score: 10, chain: 1, range: 3.68 });
  const [death] = events('death');
  assert.deepEqual(Object.keys(death).sort(), ['boss', 'dirX', 'dirZ', 'headshot', 'mesh', 'raider', 'x', 'y', 'z']);
  assert.deepEqual({ ...death, mesh: death.mesh === body }, { mesh: true, x: 2, y: 0, z: -4, dirX: .6, dirZ: -.8, headshot: true, boss: false, raider: false });
  assert.equal(events('impact').length, 1);
  // A melee blow carries its zombie, its damage and whether it killed.
  client.event({ type: 'event', event: 'melee-hit', id: 'host', weapon: 'bat', attack: 'light', hits: 1, kills: 0, impacts: [{ zombieId: 6, x: 3, y: 1.2, z: -4, damage: 20, dirX: 1, dirZ: 0, killed: false }] });
  const blow = events('impact')[1];
  assert.deepEqual([blow.x, blow.y, blow.z, blow.dirX, blow.dirY, blow.dirZ, blow.headshot, blow.kill, blow.zombieId, blow.damage, blow.mode, blow.weapon], [3, 1.2, -4, 1, 0, 0, false, false, 6, 20, 'melee', 'bat']);
  assert.notEqual(blow.shot, hit.shot);
  // A rocket: its death waits for the rocket, on the visual clock; its blast's
  // wounds say themselves when they land.
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(6, 3), walker(7, 4)] });
  const host = state.players.find(player => player.id === 'host'); Object.assign(host, { x: 4, y: 0, z: 13.5 });
  client.update(state);
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 7, headshot: false, boss: false, x: 4, y: 0, z: -2, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain: 1 });
  assert.equal(events('death').length, 1); assert.equal(events('impact').length, 2);
  client.event({ type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 4, y: 1, z: -2.5, radius: 4, hits: 1, kills: 1, wounds: [[7, 4, .935, -2, 700, 1]] });
  const blast = events('impact')[2];
  assert.deepEqual([blast.mode, blast.kill, blast.zombieId, blast.damage, blast.dirX, blast.dirZ], ['blast', true, 7, 700, 0, 1]);
  assert.ok(blast.delay > 0, 'when the rocket lands');
  let now = 0;
  const step = () => { now += 16; client.time(now); client.frame(now); };
  step();
  assert.equal(events('death').length, 1, 'not before the rocket lands');
  while (now < 300) step();
  assert.equal(events('death').length, 2); assert.equal(events('impact').length, 3);
  // A kill by fire has no wound: one legacy burst.
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 6, headshot: false, boss: false, x: 3, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'flamethrower', score: 10, chain: 1 });
  const fire = events('impact')[3];
  assert.deepEqual([fire.mode, fire.damage, fire.kill, fire.zombieId], ['legacy', null, true, 6]);
  // Frames, while in game, on the visual clock.
  const frames = events('frame');
  assert.ok(frames.length >= 18);
  assert.deepEqual(Object.keys(frames[0]).sort(), ['delta', 'self', 'snapshot', 'time']);
  assert.equal(frames.at(-1).self.id, 'guest'); assert.equal(frames.at(-1).snapshot.ambiance, 'frisson');
  assert.ok(frames.at(-1).time > frames[0].time); assert.ok(frames.every(frame => frame.delta >= 0 && frame.delta <= .05));
  // The local player's health drops: hurt.
  const hurt = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(6, 3)] });
  hurt.players.find(player => player.id === 'guest').hp = 64;
  client.update(hurt);
  // No hit heard before this drop: the source is unknown (frisson-tune-int-hurt test).
  assert.deepEqual(events('hurt'), [{ amount: 36, hp: 64, maxHp: 100, source: null }]);
  client.update(hurt);
  hurt.players.find(player => player.id === 'host').hp = 10; client.update(hurt);
  assert.equal(events('hurt').length, 1, 'only drops of the local player');
});

test('a hook that throws never breaks the game', async () => {
  const warn = console.warn, warnings = []; console.warn = (...args) => warnings.push(args);
  try {
    const client = clientHarness({ importer: () => Promise.resolve({ install(ctx) {
      for (const name of HOOKS) ctx.hooks[name] = () => { throw new Error(`${name} broke`); };
      return { uninstall() {} };
    } }) });
    client.join('guest');
    client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5), walker(6, 3)] }));
    await settle(); await settle();
    client.enter();
    client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 5, headshot: false, boss: false, x: 2, y: 0, z: -4, dirX: 1, dirZ: 0, weapon: 'pistol', score: 10, chain: 1 });
    for (let now = 16; now < 100; now += 16) { client.time(now); client.frame(now); }
    const hurt = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(6, 3)] });
    hurt.players.find(player => player.id === 'guest').hp = 50; client.update(hurt);
    assert.deepEqual(client.state().zombieIds, [6]);
    assert.equal(Number(client.node('hp-value').textContent), 50);
    // One warning per hook, not one per frame.
    assert.deepEqual(warnings.map(([label]) => label).sort(), ['Ambiance death:', 'Ambiance frame:', 'Ambiance hurt:', 'Ambiance impact:']);
  } finally { console.warn = warn; }
});

// Shaped like frisson/index.js: the slots are filled and a first part (the
// mood) is in place before the next part waits, by default for heads.glb
// through ctx.fetchAsset.
function indexLikePack(log, { wait = ctx => ctx.fetchAsset('heads.glb') } = {}) {
  const pack = { imports: 0 };
  pack.module = {
    async install(ctx) {
      log.push('install');
      const undo = () => { ctx.world.mood = null; for (const name of HOOKS) if (ctx.hooks[name]?.frisson) ctx.hooks[name] = null; log.push('undo'); };
      for (const name of HOOKS) { const fan = () => log.push(`hook:${name}`); fan.frisson = true; ctx.hooks[name] = fan; }
      ctx.world.mood = 'frisson';
      try { await wait(ctx); } catch (error) { undo(); throw error; }
      log.push('installed');
      return { uninstall: undo };
    },
  };
  pack.importer = () => { pack.imports++; log.push('import'); return Promise.resolve(pack.module); };
  return pack;
}
// The network never answers; a cut request fails as fetch does.
async function withStalledNetwork(run) {
  const before = globalThis.fetch, urls = [];
  globalThis.fetch = (url, { signal } = {}) => { urls.push(url); return new Promise((resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))); };
  try { return await run(urls); } finally { globalThis.fetch = before; }
}
const hookCalls = log => log.filter(entry => entry.startsWith('hook:')).length;
const play = (client, until = 120) => { for (let now = 16; now < until; now += 16) { client.time(now); client.frame(now); } };

test('after a room, the home picker is back on Famille, also when the connection drops', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.node('ambiance-frisson').click();
  assert.equal(joinMessage(client).ambiance, 'frisson');
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  client.leave(); await settle();
  assert.equal(client.state().homeAmbiance, 'family');
  assert.equal(client.node('ambiance-family').classList.contains('selected'), true); assert.equal(client.node('ambiance-frisson').attributes['aria-pressed'], 'false');
  assert.equal('ambiance' in joinMessage(client), false, 'the next room made here is Famille');
  // Frisson again, then the server goes away.
  client.node('ambiance-frisson').click();
  client.connect();
  const socket = client.sockets.at(-1);
  socket.emit('open'); assert.equal(client.sent.at(-1).ambiance, 'frisson');
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'host', room: 'ABC123' }) });
  socket.emit('message', { data: JSON.stringify(snapshotFor({ ambiance: 'frisson' })) });
  await settle(); await settle();
  socket.emit('close');
  assert.equal(client.node('menu').hidden, false);
  assert.equal(client.state().homeAmbiance, 'family');
  assert.equal('ambiance' in joinMessage(client), false);
});

test('leaving while a part waits for its asset: the fetch is cut, what was on comes off at once, the next Famille night has none of it', () => withStalledNetwork(async urls => {
  const log = [], pack = indexLikePack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
  assert.deepEqual(urls, ['/frisson/heads.glb']); assert.equal(client.world.mood, 'frisson');
  assert.deepEqual(client.hooks(), NO_HOOKS, 'a load in progress never reaches the game');
  client.leave(); await settle();
  assert.equal(client.world.mood, null); assert.deepEqual(log, ['import', 'install', 'undo']);
  client.join('host'); client.update(snapshotFor({ phase: 'wave', zombies: [walker(9)] })); await settle();
  assert.equal(client.node('start-button').disabled, false);
  client.enter(); play(client);
  assert.equal(client.state().inGame, true);
  assert.deepEqual(client.hooks(), NO_HOOKS); assert.equal(hookCalls(log), 0); assert.equal(client.world.mood, null);
}));

test('a load stuck on its asset is called off after 20 s: nothing of it stays on while this PC says Famille', () => withStalledNetwork(async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const log = [], pack = indexLikePack(log), client = clientHarness({ importer: pack.importer, log });
    client.join('host'); client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] })); await settle();
    client.enter();
    const standing = client.zombies.filter(mesh => mesh.userData.id === 5);
    client.timers.filter(timer => timer.ms === 20000)[0].callback(); await settle(); await settle();
    assert.equal(client.state().inGame, true);
    assert.equal(client.node('ambiance-note').textContent, 'Frisson n’a pas pu se charger : Famille sur cet ordinateur.');
    // Off before the prewarm, and the zombies made again without it.
    assert.deepEqual(log, ['import', 'install', 'undo', 'prewarm']);
    assert.equal(client.world.mood, null); assert.ok(standing.every(mesh => client.disposed.includes(mesh)));
    play(client);
    assert.deepEqual(client.hooks(), NO_HOOKS); assert.equal(hookCalls(log), 0);
  } finally { console.warn = warn; }
}));

test('a part stuck on something else than a fetch: never in the game\'s hooks, the next Famille night waits for it to come off', async () => {
  const log = [], gate = deferred(), pack = indexLikePack(log, { wait: () => gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
  client.leave(); await settle();
  assert.deepEqual(client.hooks(), NO_HOOKS);
  client.join('host'); client.update(snapshotFor({ phase: 'wave', zombies: [walker(9)] })); await settle();
  assert.equal(client.node('start-button').disabled, true); assert.equal(client.node('start-button').textContent, 'Chargement…');
  client.enter(); assert.equal(client.state().inGame, false);
  const made = client.zombies.filter(mesh => mesh.userData.id === 9);
  play(client); assert.equal(hookCalls(log), 0);
  gate.resolve(); for (let step = 0; step < 4; step++) await settle();
  assert.deepEqual(log, ['import', 'install', 'installed', 'undo', 'prewarm']);
  assert.equal(client.state().inGame, true); assert.equal(client.world.mood, null);
  assert.ok(made.length > 0 && made.every(mesh => client.disposed.includes(mesh)), 'a zombie made while it was on is made again');
  play(client, 200);
  assert.deepEqual(client.hooks(), NO_HOOKS); assert.equal(hookCalls(log), 0);
});

test('a load that never lands holds the next Frisson room for the grace only', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const log = [];
    let installs = 0;
    const module = { async install(ctx) {
      installs++; log.push('install');
      if (installs === 1) await new Promise(() => {});
      for (const name of HOOKS) ctx.hooks[name] = () => {};
      return { uninstall() { log.push('uninstall'); } };
    } };
    const client = clientHarness({ importer: () => Promise.resolve(module), log, loader: { grace: 20 } });
    client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
    client.timers.filter(timer => timer.ms === 20000)[0].callback();
    await pause(60);
    assert.equal(client.node('start-button').disabled, false);
    client.leave(); await pause(60);
    client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' }));
    await pause(60);
    assert.equal(installs, 2); assert.equal(client.state().ambianceReady, true);
    assert.equal(client.node('start-button').disabled, false); assert.notEqual(client.node('start-button').textContent, 'Chargement…');
    assert.equal(typeof client.hooks().frame, 'function');
  } finally { console.warn = warn; }
});

test('"Famille uniquement" set in another tab applies here at once, and is read again on making a room', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.node('ambiance-frisson').click();
  client.storage('deadwood-family-lock', '1');
  assert.equal(client.state().familyLocked, true); assert.equal(client.node('family-lock').checked, true);
  assert.equal(client.node('ambiance-frisson').disabled, true); assert.equal(client.node('ambiance-family').classList.contains('selected'), true);
  assert.equal('ambiance' in joinMessage(client), false);
  // Taken off there: this tab follows.
  client.storage('deadwood-family-lock', '0');
  assert.equal(client.node('ambiance-frisson').disabled, false);
  // Written without this tab hearing of it: read again when the room is made.
  client.node('ambiance-frisson').click();
  client.stored.set('deadwood-family-lock', '1');
  assert.equal('ambiance' in joinMessage(client), false); assert.equal(client.node('ambiance-frisson').disabled, true);
  // Inside a Frisson room with the pack on: Famille at once.
  const inside = clientHarness({ importer: pack.importer, log });
  inside.join('guest'); inside.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] })); await settle(); await settle();
  assert.equal(typeof inside.hooks().frame, 'function');
  inside.storage('deadwood-family-lock', '1'); await settle(); await settle();
  assert.deepEqual(inside.hooks(), NO_HOOKS); assert.equal(log.at(-1), 'uninstall');
  assert.equal(inside.node('ambiance-note').textContent, 'Cet ordinateur reste en Famille.');
  inside.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] })); await settle();
  assert.equal(pack.imports, 1); assert.equal(log.filter(entry => entry === 'install').length, 1);
});

test('hurt is for the night only: no hook while this PC is not in the game', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  const lobby = snapshotFor({ ambiance: 'frisson' }); lobby.players.find(player => player.id === 'guest').hp = 70; client.update(lobby);
  assert.equal(client.state().inGame, false);
  assert.equal(pack.events.filter(([name]) => name === 'hurt').length, 0);
});

test('frames and hits refill one event; a hit says its own delay, and only deaths wait on the visual clock', async () => {
  const frames = [], impacts = [];
  const client = clientHarness({ importer: () => Promise.resolve({ install(ctx) {
    ctx.hooks.frame = event => frames.push(event); ctx.hooks.impact = event => impacts.push(event); ctx.hooks.death = () => {};
    return { uninstall() {} };
  } }) });
  client.join('guest');
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5), walker(6, 3), walker(7, 4)] });
  Object.assign(state.players.find(player => player.id === 'host'), { x: 4, y: 0, z: 13.5 });
  client.update(state); await settle(); await settle();
  client.enter();
  play(client, 200);
  assert.ok(frames.length >= 10); assert.equal(new Set(frames).size, 1, 'one frame event, refilled');
  const shot = { type: 'event', event: 'shot', id: 'host', weapon: 'pistol', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0,
    pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'zombie', wounds: [[5, 3.68, 25.2, 0, 0, 2, 0, -4]] }] };
  client.event(shot); client.event(shot);
  assert.equal(impacts.length, 2); assert.equal(impacts[0], impacts[1], 'one impact event, refilled');
  // A rocket: its death waits on the visual clock; its blast's wound comes at
  // once, refilled, and says when it lands.
  client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 7, headshot: false, boss: false, x: 4, y: 0, z: -2, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain: 1 });
  assert.equal(client.state().cues, 1); assert.deepEqual(client.cueHooks(), ['death']);
  client.event({ type: 'event', event: 'explosion', id: 'host', weapon: 'rocket', x: 4, y: 1, z: -2.5, radius: 4, hits: 1, kills: 1, wounds: [[7, 4, .935, -2, 700, 1]] });
  assert.equal(impacts.length, 3); assert.equal(impacts[2], impacts[0]); assert.equal(impacts[2].kill, true); assert.equal(impacts[2].zombieId, 7);
  assert.ok(impacts[2].delay > 0);
  assert.deepEqual(client.cueHooks().filter(hook => hook !== null), ['death'], 'impacts never wait in the cue list');
  play(client, 1000);
  assert.equal(impacts.length, 3);
});

// The kill sound of a look (art/frisson/KILL-SOUND.md 1.3 and 3.2): it hears a
// rocket's flight at once, holds the sound until its frame hook reaches the
// landing on the visual clock, and lines the chain jingle up on it. So in the
// landing frame the client asks for the jingle before it calls the frame hook.
test('a local rocket kill: the kill sound hears its flight at once; on landing the chain jingle comes before the frame hook', async () => {
  const calls = [];
  const client = clientHarness({ sounds: calls, importer: () => Promise.resolve({ install(ctx) {
    ctx.hooks.frame = event => { calls.push(['frame', event.time]); }; ctx.hooks.impact = () => {}; ctx.hooks.death = () => {};
    return { uninstall() {} };
  } }) });
  client.join('guest');
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5), walker(6, 3)] });
  Object.assign(state.players.find(player => player.id === 'guest'), { x: 0, y: 0, z: 30 });
  client.update(state); await settle(); await settle();
  client.enter();
  let now = 0;
  const step = () => { now += 16; client.time(now); client.frame(now); };
  step();
  const named = name => calls.filter(([kind]) => kind === name);
  // Two kills of one rocket, the second a double.
  for (const [zombieId, chain] of [[5, 1], [6, 2]]) client.event({ type: 'event', event: 'kill', id: 'guest', zombieId, headshot: false, boss: false, x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'rocket', score: 10, chain, chainBonus: 0, chainId: 1 });
  const flight = Math.min(.6, Math.hypot(0, 1.5, 34) / 170);
  assert.equal(named('kill').length, 2);
  for (const [, headshot, kind, heavy, delay] of named('kill')) { assert.deepEqual([headshot, kind, heavy], [false, 'blast', false]); assert.ok(Math.abs(delay - flight) < 1e-12, `flight ${delay}`); }
  const landing = named('frame').at(-1)[1] + flight;
  step();
  assert.equal(named('chain').length, 0, 'not before the rocket lands');
  while (named('chain').length === 0 && now < 1000) step();
  assert.deepEqual(named('chain').map(([, count]) => count), [2], 'the double, once');
  const jingle = calls.findIndex(([kind]) => kind === 'chain'), next = calls.findIndex(([kind], index) => kind === 'frame' && index > jingle);
  assert.ok(next > jingle, 'the frame hook of the landing frame comes after the jingle');
  assert.ok(calls[next][1] >= landing - 1e-9, `that frame has reached the landing: ${calls[next][1]} >= ${landing}`);
  assert.ok(calls.slice(0, jingle).filter(([kind]) => kind === 'frame').every(([, time]) => time < landing - 1e-9), 'no frame before it had reached the landing');
});

// The feedback look (art/frisson/UI-SOUND.md section 4.6): the results line in
// the pack's words, the impact bursts told whether a blow killed and whether
// it struck a raider, and the infected guide in this PC's own words.
const guideFor = frisson => ({
  markers: ENEMY_HEALTH.map(maxHp => t(`enemyGuide.${frisson ? 'frisson.' : ''}${enemyAppearance({ kind: 'walker', maxHp }).marker}`)),
  hulks: t(frisson ? 'enemyGuide.frisson.hulks' : 'enemyGuide.hulks', { health: BRUTE_HEALTH.join(' / ') }),
});
const guide = client => ({ markers: client.node('enemy-guide-families').children.map(row => row.children[3].textContent), hulks: client.node('enemy-guide-hulks').textContent });
const resultsLines = client => client.node('results-list').children.map(item => item.children[2].textContent);
// A night over, with each survivor's kills and score.
function results(ambiance) {
  const state = snapshotFor({ ambiance, phase: 'gameover' });
  Object.assign(state.players.find(player => player.id === 'host'), { kills: 12, score: 340 });
  Object.assign(state.players.find(player => player.id === 'guest'), { kills: 3, score: 45 });
  return state;
}
const FAMILLE_RESULTS = ['12 élim. · ★ 340', '3 élim. · ★ 45'];
const raider = (id, x = 2) => ({ id, kind: 'raider', boss: false, x, y: 0, z: -4, yaw: 0, hp: 80, maxHp: 80, weapon: 'smg' });
// A teammate's pistol bullet stopping 4 m ahead of (0, 1.5, 0): at (0, 1.5, -4).
const SHOT = Object.freeze({ type: 'event', event: 'shot', id: 'host', weapon: 'pistol', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0, pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'zombie' }] });
const kill = (zombieId, extra = {}) => ({ type: 'event', event: 'kill', id: 'host', zombieId, headshot: false, boss: false, x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, weapon: 'bat', score: 10, chain: 1, ...extra });
const blow = (zombieId, killed) => ({ type: 'event', event: 'melee-hit', id: 'host', attack: 'light', hits: 1, kills: killed ? 1 : 0, impacts: [{ zombieId, x: 0, y: 1.2, z: -4, damage: 30, dirX: 0, dirZ: -1, killed }] });
const looks = client => client.impacts.map(({ kind, kill: killed, raider: living }) => [kind, killed, living]);

test('a Famille night: the Famille results line and infected guide, and bursts that carry kill and raider for a look that is not there', () => {
  const client = clientHarness();
  assert.deepEqual(guide(client), guideFor(false), 'the home screen');
  client.join('guest');
  client.update(snapshotFor({ phase: 'wave', zombies: [walker(5, 0), walker(6, 3)] }));
  client.enter();
  client.event(SHOT);
  client.event(kill(5, { headshot: true, weapon: 'pistol' }));
  client.event(blow(6, false));
  assert.deepEqual(looks(client), [['zombie', undefined, false], ['headshot', true, false], ['kill', false, false]]);
  assert.equal(client.feedbackStyle(), null);
  assert.deepEqual(guide(client), guideFor(false));
  client.update(results('family'));
  assert.deepEqual(resultsLines(client), FAMILLE_RESULTS);
  assert.deepEqual(client.linked(), []);
});

test('a look answering text gives the results line its words; with no look again, the Famille line at the next render', async () => {
  let hud = null;
  const style = { text: (key, params) => key === 'results.player' ? `${params.kills} abattus · ${params.score} pts` : null };
  const client = clientHarness({ importer: () => Promise.resolve({ install(ctx) {
    hud = ctx.feedback; hud.setStyle(style);
    return { uninstall() { if (hud.style === style) hud.setStyle(null); } };
  } }) });
  client.join('guest'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  assert.equal(client.feedbackStyle(), style, 'the HUD the client draws with');
  const over = results('frisson');
  client.update(over);
  assert.deepEqual(resultsLines(client), ['12 abattus · 340 pts', '3 abattus · 45 pts']);
  hud.setStyle(null); client.update(over);
  assert.deepEqual(resultsLines(client), FAMILLE_RESULTS);
  // A look that throws, or answers something else than a line: Famille's.
  for (const broken of [{ text() { throw new Error('broken'); } }, { text: () => 42 }, { text: () => null }]) {
    hud.setStyle(broken); client.update(over);
    assert.deepEqual(resultsLines(client), FAMILLE_RESULTS);
  }
  hud.setStyle(style);
  client.leave(); await settle();
  assert.equal(client.feedbackStyle(), null, 'off with the pack');
});

test('raiders are told apart for every burst: a bullet hit, a blow that does not kill, a melee kill after its kill event, a rocket; zombies at the same places are not', () => {
  for (const [enemy, living] of [[raider('r1', 0), true], [walker('z1', 0), false]]) {
    const client = clientHarness(), label = enemy.kind;
    client.join('guest');
    const state = snapshotFor({ phase: 'wave', zombies: [enemy] });
    Object.assign(state.players.find(player => player.id === 'host'), { x: 4, y: 0, z: 13.5 });
    client.update(state);
    client.enter();
    // A bullet stops next to it: the nearest enemy of the snapshot.
    client.event(SHOT);
    // A blow that does not kill it: known from the snapshots alone.
    client.event(blow(enemy.id, false));
    // Killed in melee: the kill event (its mesh goes), then the blow.
    client.event(kill(enemy.id, living ? { raider: true } : {}));
    client.event(blow(enemy.id, true));
    assert.deepEqual(looks(client), [['zombie', undefined, living], ['kill', false, living], ['kill', true, living], ['kill', true, living]], label);
    // One never in a snapshot, known by its kill event only: then its blow.
    client.event(kill(`${enemy.id}-gone`, living ? { raider: true } : {}));
    client.event(blow(`${enemy.id}-gone`, true));
    assert.deepEqual(looks(client).slice(4), [['kill', true, living], ['kill', true, living]], label);
    // A rocket: a delayed kill burst.
    client.event(kill(`${enemy.id}-rocket`, { weapon: 'rocket', x: 4, z: -2, ...(living ? { raider: true } : {}) }));
    const burst = client.impacts.at(-1);
    assert.deepEqual([burst.kind, burst.kill, burst.raider], ['kill', true, living], label);
    assert.ok(burst.time > 0, `${label}: drawn when the rocket lands`);
  }
});

test('a kill burst carries the kill\'s direction and the body\'s crown, a blow its direction only; Famille draws them as before', () => {
  const client = clientHarness();
  client.join('guest');
  const crawler = { ...walker('c1', 2), kind: 'crawler' }, brute = { ...walker('b1', -2), kind: 'brute', maxHp: 1000 }, boss = { ...walker('o1', 4), kind: 'brute', boss: true, maxHp: 6000 };
  client.update(snapshotFor({ phase: 'wave', zombies: [walker('w1', 0), crawler, brute, boss] }));
  client.enter();
  // zombies.js scales a brute's group by 1.22 and the overlord's by 1.32.
  client.zombies.find(mesh => mesh.userData.id === 'b1').scale.y = 1.22;
  client.zombies.find(mesh => mesh.userData.id === 'o1').scale.y = 1.32;
  for (const id of ['w1', 'c1', 'b1', 'o1']) client.event(kill(id, { y: .5, dirX: .6, dirZ: -.8, headshot: id === 'c1' }));
  client.event(blow('gone', false));
  const bursts = client.impacts.map(({ kind, y, dirX, dirZ, top }) => ({ kind, y, dirX, dirZ, top: top === null ? null : Number(top.toFixed(4)) }));
  assert.deepEqual(bursts, [
    { kind: 'kill', y: 1.5, dirX: .6, dirZ: -.8, top: 2.32 },
    { kind: 'headshot', y: 1.5, dirX: .6, dirZ: -.8, top: 1.32 },
    { kind: 'kill', y: 1.5, dirX: .6, dirZ: -.8, top: Number((.5 + 1.82 * 1.22).toFixed(4)) },
    { kind: 'kill', y: 1.5, dirX: .6, dirZ: -.8, top: Number((.5 + 1.91 * 1.32).toFixed(4)) },
    { kind: 'kill', y: 1.2, dirX: 0, dirZ: -1, top: null },
  ]);
  // A kill whose body was never drawn: no crown to give.
  client.event(kill('never', { dirX: Number.NaN }));
  assert.deepEqual([client.impacts.at(-1).top, client.impacts.at(-1).dirX], [null, 0]);
});

test('the infected guide follows what this PC shows: Famille words on a PC kept on Famille in a Frisson room, Frisson ones once the pack is on', async () => {
  const lockedLog = [], lockedPack = recordingPack(lockedLog), locked = clientHarness({ importer: lockedPack.importer, log: lockedLog, locked: true });
  locked.join('guest'); locked.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] })); await settle(); await settle();
  locked.enter(); locked.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] }));
  assert.deepEqual(guide(locked), guideFor(false));
  assert.equal(lockedPack.imports, 0);
  const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('guest'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle();
  client.update(snapshotFor({ ambiance: 'frisson' }));
  assert.deepEqual(guide(client), guideFor(false), 'while the pack loads');
  gate.resolve(); await settle(); await settle();
  assert.deepEqual(guide(client), guideFor(true), 'the pack is on');
  // Locked from another tab: Famille words at once, as the pack comes off.
  client.storage('deadwood-family-lock', '1'); await settle(); await settle();
  assert.deepEqual(guide(client), guideFor(false));
  // Unlocked again, then leaving: the home screen has the Famille words again.
  client.storage('deadwood-family-lock', '0'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  assert.deepEqual(guide(client), guideFor(true));
  client.leave(); await settle(); await settle();
  assert.deepEqual(guide(client), guideFor(false));
});
