import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_SOURCE, clientHarness, prepareClient, recordingPack, settle, snapshotFor, walker } from './helpers/frisson-client.mjs';
import { deriveOnlineClient } from '../online-client-build.mjs';

// The visual module has geometry/flight tests of its own. Here the real client
// drives a recording handle, so these tests check event ordering, clocks and
// resource ownership rather than reimplementing the trajectory.
const onlineClient = await prepareClient(deriveOnlineClient(CLIENT_SOURCE));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const projectile = id => ({ id, x: 0, y: 1.5, z: 0, vx: 0, vy: 0, vz: -170, gravity: 9.81, maxAge: 1 });
const shot = (id = 'p1', extra = {}) => ({ event: 'shot', id: 'guest', weapon: 'assault', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0,
  ballistic: true, projectiles: [projectile(id)], hits: 0, kills: 0, pellets: [], ...extra });
const contact = (id = 'p1', extra = {}) => ({ event: 'bullet-impact', id: 'guest', projectileId: id, weapon: 'assault',
  x: 0, y: 1.5, z: -4, dirX: 0, dirY: -.01, dirZ: -1, age: .024, stop: 'zombie', terminal: true,
  remainingTargets: 0, zombieId: 'z1', headshot: false, killed: false, damage: 15, power: 30, feet: [0, 0, -4], ...extra });
const kill = (extra = {}) => ({ event: 'kill', id: 'guest', projectileId: 'p1', ballistic: true, weapon: 'assault',
  zombieId: 'z1', x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, headshot: true, ...extra });

async function night(clientSource) {
  const log = [], sounds = [], handles = [], legacy = [], pack = recordingPack(log);
  const client = clientHarness({ client: clientSource, importer: pack.importer, log, sounds,
    tracer(start, end, options) { legacy.push({ start, end, options }); return { travel: .5 }; },
    ballisticTracer(shot, options) {
      const handle = { mesh: {}, id: shot.id, options: { ...options }, contacts: [], updates: [], disposed: 0, terminalAt: null,
        contact(event, time) { log.push('contact'); this.contacts.push({ ...event, time }); if (event.terminal) this.terminalAt = time; },
        update(time) { this.updates.push(time); return this.terminalAt === null || time - this.terminalAt < .045; },
        dispose() { this.disposed++; },
      };
      handles.push(handle); return handle;
    },
  });
  client.join('guest');
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker('z1', 0)] });
  client.update(state); await settle(); await settle(); client.enter(); client.update(state);
  return { client, state, handles, legacy, pack, log, sounds,
    blood: () => pack.events.filter(([name]) => name === 'impact').map(([, event]) => event),
  };
}

for (const [label, source] of [['LAN', undefined], ['online', onlineClient]]) {
  test(`${label}: ballistic fire has no early hit; physical contact delivers immediate feedback and terminal fade`, async () => {
    const { client, handles, legacy, sounds, blood } = await night(source);
    client.event(shot('p1', { hits: 1, headshots: 1, pellets: [{ distance: 4, stop: 'zombie' }] }));
    assert.equal(handles.length, 1); assert.equal(handles[0].options.weapon, 'assault'); assert.equal(handles[0].options.local, true);
    assert.equal(legacy.length, 0, 'ballistic fire never starts the old straight tracer');
    assert.equal(client.impacts.length, 0); assert.equal(blood().length, 0);
    assert.equal(client.node('hit-marker').hidden, true); assert.equal(sounds.some(([name]) => name === 'hit'), false);
    client.time(24); client.frame(24);
    client.event(contact('p1', { headshot: true }));
    const handle = handles[0], wound = blood()[0];
    assert.equal(handle.contacts.length, 1); near(handle.contacts[0].time, .024);
    assert.equal(client.node('hit-marker').hidden, false); assert.equal(client.node('hit-marker').classList.contains('tier-headshot'), true);
    assert.equal(sounds.filter(([name]) => name === 'hit').length, 1); assert.equal(sounds.filter(([name]) => name === 'headshot').length, 1);
    assert.equal(client.impacts.length, 1); near(client.impacts[0].time, .024);
    assert.equal(wound.delay, 0); assert.equal(wound.kill, false); assert.equal(wound.damage, 30); assert.equal(wound.mode, 'bullet');
    assert.deepEqual(client.ballisticState().ids, ['p1'], 'terminal contact retains the handle for its short fade');
    client.time(50); client.frame(50); assert.equal(handle.disposed, 0);
    client.time(70); client.frame(70); assert.equal(handle.disposed, 1); assert.deepEqual(client.ballisticState().ids, []);
  });

  test(`${label}: fatal contact precedes death, bleeds once with no added delay, and does not destroy its fading tracer`, async () => {
    const { client, handles, sounds, blood, pack, log } = await night(source);
    client.event(shot()); client.time(24); client.frame(24);
    client.event(contact('p1', { killed: true, headshot: true })); client.event(kill());
    assert.equal(handles[0].contacts.length, 1); assert.equal(handles[0].disposed, 0);
    assert.equal(blood().length, 1, 'kill does not add legacy blood even when a ballistic event omits range');
    assert.equal(blood()[0].delay, 0); assert.equal(blood()[0].kill, true);
    const relevant = pack.events.filter(([name]) => name === 'impact' || name === 'death');
    assert.deepEqual(relevant.map(([name]) => name), ['impact', 'death']);
    assert.ok(log.includes('contact')); assert.equal(client.zombies.find(mesh => mesh.userData.id === 'z1' && mesh.userData.death).userData.death.time, .024);
    assert.equal(client.state().cues, 0, 'physical contact has no cosmetic arrival timer');
    assert.equal(sounds.find(([name]) => name === 'kill')?.[4], 0);
    assert.equal(client.node('hit-marker').classList.contains('tier-headshotKill'), true);
    client.time(80); client.frame(80); assert.equal(handles[0].disposed, 1);
  });
}

test('perforation keeps flying; solid contact has one surface burst and range expiration invents no impact', async () => {
  const { client, handles, blood, sounds } = await night();
  client.event(shot());
  client.event(contact('p1', { terminal: false, remainingTargets: 1 }));
  client.time(40); client.frame(40);
  assert.equal(handles[0].disposed, 0); assert.equal(handles[0].updates.length, 1); assert.deepEqual(client.ballisticState().ids, ['p1']);
  client.event(contact('p1', { stop: 'solid', x: 5, y: 1, z: -4, age: .04, zombieId: undefined, damage: undefined }));
  assert.equal(handles[0].contacts.length, 2); assert.equal(client.impacts.length, 2); assert.equal(blood().length, 1);
  client.event(shot('range')); const impacts = client.impacts.length, wounds = blood().length, hits = sounds.filter(([name]) => name === 'hit').length;
  client.event(contact('range', { stop: 'range', age: 1, zombieId: undefined, damage: undefined }));
  assert.equal(handles[1].contacts.length, 1); assert.equal(client.impacts.length, impacts); assert.equal(blood().length, wounds);
  assert.equal(sounds.filter(([name]) => name === 'hit').length, hits);
});

test('ballistic flight ignores local hit-stop, freezes during collective pause, and resumes without catch-up', async () => {
  const { client, handles } = await night();
  client.event(shot()); client.event(kill());
  client.time(10); client.frame(10);
  const clock = client.ballisticState(); near(clock.time, .01); assert.ok(clock.visualTime < clock.time, 'local kill slows only the presentation clock');
  near(handles[0].updates[0], .01);
  client.event({ event: 'pause', paused: true }); client.time(510); client.frame(510);
  client.event(contact()); assert.equal(handles[0].contacts.length, 0, 'combat events are ignored while the authoritative game is paused');
  near(client.ballisticState().time, .01); assert.equal(handles[0].updates.length, 1);
  client.event({ event: 'pause', paused: false }); client.time(526); client.frame(526);
  near(client.ballisticState().time, .026); near(handles[0].updates.at(-1), .026);
});

test('victory, restart and leaving dispose live bullet handles; legacy shots keep their established renderer', async () => {
  for (const phase of ['victory', 'countdown']) {
    const { client, handles, state } = await night(); client.event(shot());
    client.update({ ...state, phase }); assert.equal(handles[0].disposed, 1); assert.deepEqual(client.ballisticState().ids, []);
  }
  const { client, handles, legacy } = await night();
  client.event(shot()); client.time(20); client.frame(20); client.leave();
  assert.equal(handles[0].disposed, 1); assert.deepEqual(client.ballisticState().ids, []); near(client.ballisticState().time, 0);
  const other = await night(); other.client.event(shot('old', { ballistic: false, pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'solid' }] }));
  assert.equal(other.handles.length, 0); assert.equal(other.legacy.length, 1); assert.equal(legacy.length, 0);
});


test('cabin barricade contact produces wood impact feedback on arrival without a hit marker', async () => {
  const { client, handles, blood, sounds } = await night();
  client.event(shot());
  assert.equal(client.impacts.length, 0);
  client.event(contact('p1', { stop: 'board', x: 0, y: 1.5, z: -6, damage: 0, zombieId: undefined }));
  assert.equal(handles[0].contacts.length, 1);
  assert.equal(client.impacts.length, 1);
  assert.equal(client.impacts[0].kind, 'wood');
  assert.equal(blood().length, 0);
  assert.equal(sounds.filter(([name]) => name === 'hit').length, 0);
  assert.equal(client.node('hit-marker').hidden, true);
});


test('one shell keeps a shared blood spray identity across separate pellet contacts', async () => {
  const { client, blood }=await night();
  client.event(shot('shell', {weapon:'shotgun',projectiles:[projectile('a'),projectile('b'),projectile('c')]}));
  client.event(contact('a',{weapon:'shotgun'})); client.event(contact('b',{weapon:'shotgun'})); client.event(contact('c',{weapon:'shotgun'}));
  assert.equal(blood().length,3); assert.equal(new Set(blood().map(wound=>wound.shot)).size,1);
  client.event(shot('next',{weapon:'shotgun'})); client.event(contact('next',{weapon:'shotgun'}));
  assert.notEqual(blood()[0].shot,blood().at(-1).shot,'the next trigger remains another spray');
});

for (const [label, source] of [['LAN', undefined], ['online', onlineClient]]) {
  test(`${label}: same-shell corpse wound adds blood without moving the projectile or claiming another damage hit`, async () => {
    const { client, handles, sounds, blood } = await night(source);
    client.event(shot('sibling', { weapon: 'shotgun' }));
    client.event(contact('sibling', { weapon: 'shotgun', visualOnly: true, terminal: false, damage: 0, power: 50, killed: true }));
    assert.equal(handles[0].contacts.length, 0, 'visual-only wound cannot re-anchor or stop the live projectile');
    assert.equal(blood().length, 1); assert.equal(blood()[0].damage, 50); assert.equal(blood()[0].kill, true);
    assert.equal(client.node('hit-marker').hidden, true);
    assert.equal(sounds.filter(([name]) => name === 'hit' || name === 'headshot').length, 0);
    client.event(contact('sibling', { stop: 'solid', zombieId: undefined, damage: undefined }));
    assert.equal(handles[0].contacts.length, 1, 'the next physical contact still owns projectile reconciliation');
  });
}

for (const [label, source] of [['LAN', undefined], ['online', onlineClient]]) {
  test(`${label}: six shell contacts keep six wounds but only one hit sound and one later headshot confirmation`, async () => {
    const { client, sounds, blood, handles } = await night(source);
    const ids = Array.from({ length: 6 }, (_, i) => `pellet-${i}`);
    client.event(shot('shell', { weapon: 'shotgun', shotGroupId: 'shell-a', projectiles: ids.map(projectile) }));
    assert.equal(sounds.filter(([name]) => name === 'hit').length, 0);
    for (const [i, id] of ids.entries()) {
      if (i === 1) { client.time(60); client.frame(60); assert.equal(handles[0].disposed, 1); }
      client.event(contact(id, { weapon: 'shotgun', shotGroupId: 'shell-a', headshot: i >= 2 }));
      assert.equal(sounds.filter(([name]) => name === 'hit').length, 1, 'first contact confirms immediately, siblings do not repeat it');
      assert.equal(sounds.filter(([name]) => name === 'headshot').length, Number(i >= 2), 'first later head contact confirms once');
    }
    assert.equal(blood().length, 6); assert.equal(client.impacts.length, 6);
    assert.equal(handles.reduce((count, handle) => count + handle.contacts.length, 0), 6);
    assert.equal(client.ballisticState().hitSoundGroups, 1);
    client.event(shot('another', { shotGroupId: 'shell-b' })); client.event(contact('another', { shotGroupId: 'shell-b' }));
    assert.equal(sounds.filter(([name]) => name === 'hit').length, 2, 'another trigger has its own confirmation');
    client.time(5000); client.frame(5000);
    assert.equal(client.ballisticState().hitSoundGroups, 0, 'audio groups expire even after their tracer has gone');
  });

  test(`${label}: hit sound groups survive a collective pause and clear on restart, victory and leave`, async () => {
    for (const phase of ['countdown', 'victory', 'leave']) {
      const { client, state, sounds } = await night(source);
      client.event(shot('first', { shotGroupId: 'group' })); client.event(contact('first', { shotGroupId: 'group' }));
      client.event({ event: 'pause', paused: true }); client.time(6000); client.frame(6000);
      assert.equal(client.ballisticState().hitSoundGroups, 1);
      client.event({ event: 'pause', paused: false }); client.time(6016); client.frame(6016);
      client.event(contact('second', { shotGroupId: 'group', headshot: true }));
      assert.equal(sounds.filter(([name]) => name === 'hit').length, 1);
      assert.equal(sounds.filter(([name]) => name === 'headshot').length, 1);
      if (phase === 'leave') client.leave(); else client.update({ ...state, phase });
      assert.equal(client.ballisticState().hitSoundGroups, 0, phase);
    }
  });
}
