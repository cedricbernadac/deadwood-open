import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Euler, Vector3 } from 'three';
import { cameraSupportHeight, cameraSmoothingAlpha, CAMERA_SMOOTHING_DEFAULTS } from '../public/camera-motion.js';
import { shotMuzzleFromView, safeTracerStart } from '../public/shot-visuals.js';
import { sightClear, sightDoors } from '../public/melee-reach.js';
import { stairContactY, stairRampY } from '../public/stairs.js';
import { RoomSimulation } from '../simulation.mjs';
import { OnlineSession } from '../public/online/session.js';
import { activeWeaponId } from '../public/weapon-inventory.js';
import { createDamageNumbers } from '../public/damage-numbers.js';
import { deriveOnlineClient, deriveOnlineHtml, replaceExactlyOnce, buildOnlineClient } from '../online-client-build.mjs';

const client = await readFile(new URL('../public/client.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
test('generated online assets match their preserved LAN sources deterministically', async () => {
  await buildOnlineClient(undefined, { check: true });
  assert.equal(deriveOnlineClient(client), deriveOnlineClient(client.replace(/\r?\n/g, '\r\n')));
  assert.equal(deriveOnlineHtml(html), deriveOnlineHtml(html.replace(/\r?\n/g, '\r\n')));
  assert.equal(await readFile(new URL('../public/client.js', import.meta.url), 'utf8'), client);
  assert.equal(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), html);
});
test('derivation refuses missing or ambiguous integration seams instead of silently patching', () => {
  assert.throws(() => replaceExactlyOnce('abc', 'missing', 'x', 'guard'), /exactly one anchor, found 0/);
  assert.throws(() => replaceExactlyOnce('abc abc', 'abc', 'x', 'guard'), /exactly one anchor, found 2/);
  assert.throws(() => deriveOnlineClient(client.replace('const canvas =', 'const changedCanvas =')), /online presentation helpers/);
  assert.throws(() => deriveOnlineClient(client + "\nimport { createAimDiagnostics } from './aim-diagnostics.js';"), /online imports/);
  assert.throws(() => deriveOnlineHtml(html.replace('/client.js', '/different-client.js')), /online module entry/);
});
test('online page advertises Internet play in FR/EN and never loads the LAN entry point', async () => {
  const online = deriveOnlineHtml(html), ui = await readFile(new URL('../public/online/ui.js', import.meta.url), 'utf8');
  assert.ok(online.includes("import('/online-client.js')")); assert.ok(!online.includes("import('/client.js')"));
  assert.ok(online.includes('/online/online.css')); assert.ok(online.includes('id="online-subtitle"'));
  assert.ok(!online.includes('data-i18n="setup.subtitle"')); assert.ok(!online.includes('sur le même réseau'));
  assert.match(ui, /Joue sur Internet/); assert.match(ui, /Play online/);
});
test('online derivative changes transport and position while preserving native aim and confirmed hits', () => {
  const online = deriveOnlineClient(client);
  assert.equal((online.match(/new OnlineTransport\(/g) ?? []).length, 1); assert.ok(!online.includes('new WebSocket('));
  assert.ok(online.includes('onlineSession?.update(frameSeconds, inputMessage())'));
  assert.ok(online.includes('new THREE.Vector3(onlinePose.x, cameraSupportHeight(onlinePose, onlineSession?.predictedPlayer) + onlineEyeHeight, onlinePose.z)'));
  assert.ok(online.includes("camera.rotation.set(pitch + cameraRecoil * .18, yaw, 0, 'YXZ')"));
  assert.ok(online.includes('const onlineView = onlineSession?.timeline.sample(now)'));
  assert.ok(online.includes("if (event.ballistic !== true && event.hits > 0) { if (localAudio) { sound.hit(); if (event.headshots > 0) sound.headshot?.(); } feedback.hit("));
  const feedback = online.slice(online.indexOf('function onlineLocalShot('), online.indexOf('const sound ='));
  assert.ok(!feedback.includes('hit-marker')); assert.ok(!feedback.includes('feedback.hit')); assert.ok(!feedback.includes('self.hp =')); assert.ok(!feedback.includes('self.ammo ='));
  assert.ok(online.includes('consumeShotEcho(event)')); assert.ok(online.includes('markShotPlayed(shot.shotId)'));
});

function cameraHarness(source, online, settings = CAMERA_SMOOTHING_DEFAULTS) {
  const start = source.indexOf(online ? '    const onlineEyeHeight =' : '    const eyeHeight = self.downed');
  const end = source.indexOf('    const movement = inputMessage();', start);
  assert.ok(start > 0 && end > start);
  const sandbox = { THREE: { Vector3 }, Math, Number, cameraSupportHeight, cameraSmoothingAlpha, cameraSmoothing: { ...settings }, delta: 1 / 60,
    PLAYER_POSTURE: { standingEye: 1.55, crouchedEye: .9 },
    cameraReady: false, cameraRecoil: 0, cameraBasePosition: new Vector3(), camera: { position: new Vector3() },
    recordAim() {}, self: { alive: true, downed: false, crouched: false, eyeHeight: 1.55, x: 0, y: 0, z: 0 } };
  const context = vm.createContext(sandbox), script = new vm.Script(`{\n${source.slice(start, end)}\n}`);
  return { sandbox, frame(pose, dt, supportPose = null) {
    Object.assign(sandbox.self, pose); sandbox.onlinePose = sandbox.self;
    sandbox.onlineSession = { predictedPlayer: supportPose ?? sandbox.self }; sandbox.delta = dt;
    script.runInContext(context); return sandbox.camera.position.clone();
  } };
}

test('actual online camera recognizes raw tread support while retaining a reconciliation offset', () => {
  const online = cameraHarness(deriveOnlineClient(client), true);
  const raw = { x: 3.8, y: stairContactY(.1), z: .1, grounded: true };
  const corrected = { ...raw, x: raw.x + .03, y: raw.y + .08, z: raw.z + .02 };
  const rendered = online.frame(corrected, 1 / 60, raw);
  assert.equal(rendered.y, stairRampY(raw.z) + .08 + 1.55);
  assert.equal(rendered.x, corrected.x); assert.equal(rendered.z, corrected.z);
  assert.equal(raw.y, stairContactY(.1));
});

for (const fps of [60, 144]) test(`actual online camera keeps LAN height damping and immediate horizontal prediction at ${fps} FPS`, () => {
  const lan = cameraHarness(client, false), online = cameraHarness(deriveOnlineClient(client), true);
  const dt = 1 / fps, initial = { x: 3.8, y: 0, z: 2.9 };
  assert.deepEqual(online.frame(initial, dt).toArray(), lan.frame(initial, dt).toArray());
  let previousY = online.sandbox.camera.position.y, maxRise = 0;
  for (let frame = 1; frame <= fps * 2; frame++) {
    const pose = { x: 3.8, y: Math.min(16, Math.floor(frame * 16 / (fps * 1.5))) * 3.4 / 16,
      z: 2.9 - Math.min(4.9, 3.5 * frame * dt) };
    const before = { ...pose }, rendered = online.frame(pose, dt);
    assert.equal(rendered.y, lan.frame(pose, dt).y, 'same vertical response as LAN');
    assert.equal(rendered.x, pose.x); assert.equal(rendered.z, pose.z, 'horizontal prediction stays immediate');
    assert.deepEqual(pose, before, 'camera damping cannot modify authoritative/predicted movement');
    assert.ok(rendered.y >= previousY - 1e-10 && rendered.y <= pose.y + 1.55 + 1e-10, 'no height overshoot');
    maxRise = Math.max(maxRise, rendered.y - previousY); previousY = rendered.y;
  }
  assert.ok(maxRise < .1, `a 21.25 cm tread must be eased, got ${maxRise} m/frame`);
  assert.ok(Math.abs(previousY - 4.95) < .001, 'camera settles at the landing');
});

for (const fps of [60, 144]) test(`actual LAN and online recoil ease the camera kick, never mouse aim or weapon recoil, at ${fps} FPS`, () => {
  for (const source of [client, deriveOnlineClient(client)]) {
    const start = source.indexOf('    cameraRecoil +='), end = source.indexOf('\n', source.indexOf('    camera.rotation.set(', start));
    assert.ok(start > 0 && end > start);
    const sandbox = { cameraRecoil: 0, recoil: .06, delta: 1 / fps, yaw: 1.2, pitch: -.4, cameraSmoothingAlpha, cameraSmoothing: { ...CAMERA_SMOOTHING_DEFAULTS },
      camera: { rotation: { set(x, y) { this.x = x; this.y = y; } } }, Math };
    const context = vm.createContext(sandbox), script = new vm.Script(source.slice(start, end));
    let peak = 0, maxChange = 0, previous = 0;
    for (let frame = 0; frame < fps; frame++) {
      const raw = sandbox.recoil;
      script.runInContext(context);
      const kick = sandbox.camera.rotation.x - sandbox.pitch;
      peak = Math.max(peak, kick); maxChange = Math.max(maxChange, Math.abs(kick - previous)); previous = kick;
      assert.equal(sandbox.yaw, 1.2); assert.equal(sandbox.pitch, -.4);
      assert.equal(sandbox.camera.rotation.y, 1.2, 'mouse yaw remains immediate');
      assert.equal(sandbox.recoil, raw, 'weapon recoil and firing cadence are untouched');
      sandbox.recoil *= Math.exp(-sandbox.delta * 16);
    }
    assert.ok(peak > .06 * .18 * .3 && peak < .06 * .18 * .9, 'retain a visible kick with a gentler peak');
    assert.ok(maxChange < .006, 'no full one-frame angular impulse');
    assert.ok(previous < 1e-7, 'no accumulated camera drift after a shot');
  }
});

test('personal height smoothing changes only the vertical response in actual LAN and generated online camera code', () => {
  for (const online of [false, true]) {
    const source = online ? deriveOnlineClient(client) : client;
    const direct = cameraHarness(source, online, { heightMs: 0, recoilMs: 31 });
    const soft = cameraHarness(source, online, { heightMs: 150, recoilMs: 31 });
    const start = Object.freeze({ x: 0, y: 0, z: 0, grounded: true });
    const destination = Object.freeze({ x: 1, y: 3.4, z: -1, grounded: true });
    direct.frame(start, 1 / 60); soft.frame(start, 1 / 60);
    const directView = direct.frame(destination, 1 / 60), softView = soft.frame(destination, 1 / 60);
    assert.equal(directView.y, destination.y + 1.55, 'zero disables vertical easing immediately');
    assert.ok(softView.y > 1.55 && softView.y < directView.y, 'maximum gives a bounded softer response');
    assert.equal(directView.x, softView.x); assert.equal(directView.z, softView.z, 'vertical preference cannot change horizontal camera latency');
    if (online) { assert.equal(softView.x, destination.x); assert.equal(softView.z, destination.z); }
    else assert.ok(Math.abs(softView.x - (1 - Math.exp(-22 / 60))) < 1e-12, 'LAN retains its historical horizontal smoothing');
    assert.deepEqual(destination, { x: 1, y: 3.4, z: -1, grounded: true });
  }
});

test('actual adjustable LAN and online recoil is immediate at zero and independent of frame rate at maximum', () => {
  for (const source of [client, deriveOnlineClient(client)]) {
    const start = source.indexOf('    cameraRecoil +='), end = source.indexOf('\n', source.indexOf('    camera.rotation.set(', start));
    const script = new vm.Script(source.slice(start, end));
    for (const recoilMs of [0, 31, 100]) {
      const kicks = [60, 144].map(fps => {
        const sandbox = { cameraRecoil: 0, recoil: .06, delta: 1 / fps, yaw: 1.2, pitch: -.4, cameraSmoothingAlpha,
          cameraSmoothing: { heightMs: 45, recoilMs }, camera: { rotation: { set(x, y) { this.x = x; this.y = y; } } }, Math };
        const context = vm.createContext(sandbox);
        for (let frame = 0; frame < fps / 4; frame++) {
          script.runInContext(context);
          assert.equal(sandbox.yaw, 1.2); assert.equal(sandbox.pitch, -.4); assert.equal(sandbox.recoil, .06);
          assert.equal(sandbox.camera.rotation.y, 1.2);
        }
        const expected = recoilMs === 0 ? .06 : .06 * (1 - Math.exp(-250 / recoilMs));
        assert.ok(Math.abs(sandbox.cameraRecoil - expected) < 1e-12);
        return sandbox.camera.rotation.x - sandbox.pitch;
      });
      assert.ok(Math.abs(kicks[0] - kicks[1]) < 1e-12, 'same elapsed-time response at both FPS');
    }
  }
});

test('generated enemy presentation uses the buffered raider yaw and posture, never the latest authority twice', () => {
  const online = deriveOnlineClient(client);
  const start = online.indexOf('  const onlineView = onlineSession?.timeline.sample(now);');
  const end = online.indexOf('  for (const [id,mesh] of playerMeshes)', start);
  assert.ok(start > 0 && end > start);
  const mesh = raider => ({ visible: true, position: { set(x, y, z) { this.pose = { x, y, z }; } }, rotation: { y: 0 },
    userData: { raider, yaw: 2, renderYaw: 1.9, state: { pitch: .9, crouched: false, reloading: false } } });
  const raider = mesh(true), walker = mesh(false), newborn = mesh(true), animations = [];
  const actors = [{ id: 'r1', x: 1, y: 0, z: 3, yaw: .2, pitch: -.1, crouched: true, reloading: true },
    { id: 'z1', x: -2, y: 0, z: 4, yaw: -.5 }];
  const sandbox = { Map, now: 1000, elapsed: 1, delta: 1 / 60,
    zombieMeshes: new Map([['r1', raider], ['z1', walker], ['r2', newborn]]),
    onlineSession: { timeline: { sample: () => ({ zombies: actors, players: [] }) } },
    animateRaider(body, state) { animations.push({ body, state }); },
    animateZombie(body) { animations.push({ body }); } };
  vm.runInNewContext(online.slice(start, end), sandbox);
  assert.deepEqual(raider.position.pose, { x: 1, y: 0, z: 3 });
  assert.equal(raider.rotation.y, .2); assert.equal(raider.userData.renderYaw, .2);
  assert.equal(animations[0].state.pitch, -.1); assert.equal(animations[0].state.crouched, true);
  assert.equal(animations[0].state.reloading, true);
  assert.equal(walker.rotation.y, -.5); assert.equal(animations[1].body, walker);
  assert.equal(newborn.visible, false); assert.equal(animations.length, 2);
});

function generatedFeedbackHarness({ actualTracers = false } = {}) {
  const online = deriveOnlineClient(client);
  const declaration = name => {
    const start = online.indexOf(`function ${name}(`), end = online.indexOf('\n}', start) + 2;
    assert.ok(start > 0 && end > start, name); return online.slice(start, end);
  };
  const helperStart = online.indexOf('const onlineShotReservations ='), helperEnd = online.indexOf('const sound =');
  const room = new RoomSimulation('TEST01', { practice: true }); room.addPlayer('a'); room.phase = 'wave'; room.zombies.clear();
  const snapshot = room.snapshot(); snapshot.net = { epoch: 'one', serverTime: 1000, acks: { a: 0 } };
  const self = snapshot.players[0]; Object.assign(self, { weapon: 'rocket', ammo: 1, reloading: false });
  let now = 1000;
  const session = new OnlineSession({ playerId: 'a', now: () => now }); session.ingestSnapshot(snapshot);
  const elements = new Map(), calls = { shots: 0, sounds: [], hits: 0, tracers: 0, packets: [], traces: [], physical: [], impacts: [], muzzleCaptures: 0, markers: [], flashes: [], cosmetics: [], shakes: [] };
  const sandbox = { Map, Number, performance: { now: () => now }, snapshot, myId: 'a', myPlayer: () => self,
    pointerLocked: true, controllerPlaying: false, controllerState: null, inputFocused: true,
    inGame: true, document: { hidden: false, focused: true, hasFocus() { return this.focused; } }, firing: true, triggerSoundPlayed: false,
    fireAudioWeapon: 'rocket', yaw: 0, pitch: 0, recoil: 0, muzzleUntil: 0, muzzleLight: { intensity: 0 }, gun: null, gunType: 'rocket', secondaryGun: null, secondaryFiring: false, scoped: false,
    dualStock: player => player?.dualWield ? player.hands?.secondary ?? null : null,
    THREE: { Vector3 }, shotMuzzleFromView, safeTracerStart, sightClear, sightDoors, selectedWeaponId: activeWeaponId,
    camera: { position: new Vector3(), rotation: new Euler(), updateMatrixWorld() { throw new Error('confirmed tracer read the current camera'); } },
    viewMuzzle: new Vector3(.2, -.15, -.7),
    copyWeaponMuzzleInView(_gun, target) { calls.muzzleCaptures++; return target.copy(sandbox.viewMuzzle); },
    playerMeshes: new Map(), zombieMeshes: new Map(), tracers: [], MAX_TRACERS: 128,
    ballisticTracers: new Map(), ballisticShotGroups: new Map(), ballisticTime: 0, ambianceShot: 0,
    survivorMuzzle() { throw new Error('confirmed tracer read a newer actor muzzle'); },
    scene: { add() {}, remove() {} },
    createTracer(start, end, options) {
      calls.tracers++; calls.traces.push({ start: start.clone(), end: end.clone(), options });
      return { mesh: {}, dispose() {} };
    },
    createBallisticTracer(projectile, options) {
      const handle = { ...projectile, options, contacts: [], mesh: {}, dispose() {},
        contact(event) { this.contacts.push(event); } };
      calls.physical.push(handle); return handle;
    },
    surfaceImpact(point, wood) { calls.impacts.push({ point: point.clone(), wood }); }, inBoardedWindow: () => false,
    shotFlash(point, event, local, time) { calls.flashes.push({ point: new Vector3(point.x, point.y, point.z), local, time }); }, zombieImpact() {},
    shotCosmetics(id, weapon, time) { calls.cosmetics.push({ id, weapon, time }); },
    cameraShake: { add(amount) { calls.shakes.push(amount); } }, SHOT_TRAUMA: { rocket: .22 },
    shotRumble(weapon) { (calls.rumbles ||= []).push(weapon); },
    feedback: { hit(kind) { calls.markers.push(kind); } },
    damageNumbers: createDamageNumbers({ document: null, layer: null }), damagePoint() { return null; },
    visualSeconds: () => now / 1000, meleeProfile: () => null, automaticWeapons: [],
    sound: { shoot(weapon, options) { calls.shots++; calls.sounds.push({ weapon, options }); }, hit() { calls.hits++; } },
    shotEffect() { calls.tracers++; },
    $(id) { if (!elements.has(id)) elements.set(id, { hidden: true }); return elements.get(id); },
    WebSocket: { OPEN: 1 }, websocket: { readyState: 1, session, send(raw) { calls.packets.push(JSON.parse(raw)); } },
    // Famille: no pack hooks (the blood's call sites read them, art/frisson/BLOOD-SPRAY.md 4.2).
    ambianceHooks: { impact: null, death: null, frame: null, hurt: null },
  };
  const ackStart = online.indexOf("    else if (message.type === 'shot-ack'"), ackEnd = online.indexOf('\n', ackStart);
  assert.ok(ackStart > 0 && ackEnd > ackStart);
  const ackHandler = online.slice(ackStart, ackEnd).trim().replace(/^else /, '');
  const captureGuard = online.match(/^function controlsCaptured\(\).*$/m)?.[0];
  assert.ok(captureGuard, 'exercise the generated controller/mouse capture predicate');
  vm.runInNewContext(captureGuard + '\n' + online.slice(helperStart, helperEnd) + '\n' + declaration('send') + '\n' + declaration('onEvent')
    + (actualTracers ? '\n' + declaration('shotEffect') + '\nglobalThis.actualShotEffect = shotEffect;' : '')
    + `\nglobalThis.actualAck = message => { ${ackHandler} };`
    + '\nglobalThis.actualSend = send; globalThis.actualEvent = onEvent; globalThis.localFeedback = onlineLocalShot; globalThis.release = onlineReleaseReservations; globalThis.reservations = onlineShotReservations;', sandbox);
  sandbox.release(snapshot);
  return { sandbox, self, snapshot, calls, elements, setNow(value) { now = value; } };
}
test('actual generated fire path plays immediate feedback once, spends no authoritative ammo and confirms hits only from server events', () => {
  const f = generatedFeedbackHarness(), originalAmmo = f.self.ammo, originalHp = f.self.hp;
  f.sandbox.actualSend({ type: 'shoot' });
  assert.equal(f.calls.shots, 1); assert.equal(f.calls.hits, 0); assert.equal(f.calls.tracers, 0);
  assert.equal(f.self.ammo, originalAmmo); assert.equal(f.self.hp, originalHp);
  const packet = f.calls.packets[0];
  assert.equal(packet.type, 'shoot'); assert.equal(packet.shotId, 1); assert.ok(Number.isFinite(packet.viewTime));
  assert.equal(packet.yaw, 0); assert.equal(packet.pitch, 0);
  f.sandbox.actualEvent({ type: 'event', event: 'shot', id: 'a', weapon: 'rocket', shotId: 1, hits: 0, time: 0 });
  assert.equal(f.calls.shots, 1, 'echo does not repeat the shot sound'); assert.equal(f.calls.hits, 0);
  assert.equal(f.calls.tracers, 1, 'projectile/tracer waits for the authority');
  f.sandbox.actualEvent({ type: 'event', event: 'shot', id: 'a', weapon: 'rocket', shotId: 2, hits: 1, time: .1 });
  assert.equal(f.calls.hits, 1); assert.deepEqual(f.calls.markers, ['hit'], 'the confirmed hit shows the hit marker');
  assert.deepEqual(f.calls.shakes, [.22, .22], 'the rocket kick comes once per shot: at the click, or at an unplayed confirmation');
  assert.deepEqual(f.calls.rumbles, ['rocket', 'rocket'], 'and so does the controller rumble');
  assert.equal(f.self.ammo, originalAmmo); assert.equal(f.self.hp, originalHp);
});

test('unconfirmed shots reserve the selected copy only when two slots carry the same weapon', () => {
  const f = generatedFeedbackHarness();
  Object.assign(f.self, { weapon: 'rocket', weaponId: 'rocket', ammo: 1,
    weapons: [{ id: 'rocket', weapon: 'rocket', ammo: 1, reserve: 0 }, { id: 'rocket#2', weapon: 'rocket', ammo: 1, reserve: 3 }] });
  assert.equal(f.sandbox.localFeedback(1, f.self), true);
  assert.equal(f.sandbox.localFeedback(2, f.self), false, 'the first copy has its only cosmetic shot reserved');
  f.self.weaponId = 'rocket#2';
  assert.equal(f.sandbox.localFeedback(3, f.self), true, 'the second copy has its own loaded round');
  assert.equal(f.sandbox.localFeedback(4, f.self), false);
  f.self.weaponId = 'rocket';
  assert.equal(f.sandbox.localFeedback(5, f.self), false, 'switching back does not erase an outstanding reservation');
  assert.deepEqual([...f.sandbox.reservations.values()].map(shot => shot.weaponId), ['rocket', 'rocket#2']);
  assert.equal(f.self.ammo, 1, 'prediction spends no authoritative stock');
});

test('generated online Xbox feedback uses controller capture and waits for authority for hits and trajectories', () => {
  const f = generatedFeedbackHarness(), originalAmmo = f.self.ammo;
  Object.assign(f.sandbox, { pointerLocked: false, controllerPlaying: true,
    controllerState: { connected: true, supported: true } });
  f.sandbox.actualSend({ type: 'shoot' });
  assert.equal(f.calls.shots, 1, 'Xbox gets the same immediate report as captured mouse');
  assert.equal(f.calls.tracers, 0); assert.equal(f.calls.hits, 0); assert.equal(f.self.ammo, originalAmmo);
  const packet = f.calls.packets[0];
  assert.equal(packet.shotId, 1); assert.equal(packet.yaw, 0); assert.equal(packet.pitch, 0);
  f.sandbox.actualEvent({ type: 'event', event: 'shot', id: 'a', weapon: 'rocket', shotId: packet.shotId, hits: 1, time: .1 });
  assert.equal(f.calls.shots, 1, 'server confirmation never doubles controller audio');
  assert.equal(f.calls.tracers, 1); assert.equal(f.calls.hits, 1); assert.equal(f.self.ammo, originalAmmo);
});

for (const interruption of ['disconnected', 'unsupported', 'blur', 'hidden', 'menu', 'not-playing', 'waiting', 'reloading']) test(`generated online Xbox ${interruption} cannot produce local fire feedback`, () => {
  const f = generatedFeedbackHarness();
  Object.assign(f.sandbox, { pointerLocked: false, controllerPlaying: true,
    controllerState: { connected: true, supported: true } });
  if (interruption === 'disconnected') f.sandbox.controllerState.connected = false;
  if (interruption === 'unsupported') f.sandbox.controllerState.supported = false;
  if (interruption === 'blur') { f.sandbox.inputFocused = false; f.sandbox.document.focused = false; }
  if (interruption === 'hidden') f.sandbox.document.hidden = true;
  if (interruption === 'menu') f.sandbox.$('pause').hidden = false;
  if (interruption === 'not-playing') f.sandbox.controllerPlaying = false;
  if (interruption === 'waiting') { f.self.waiting = true; f.self.alive = false; }
  if (interruption === 'reloading') f.self.reloading = true;
  assert.equal(f.sandbox.localFeedback(1, f.self), false);
  assert.equal(f.calls.shots, 0); assert.equal(f.calls.hits, 0); assert.equal(f.calls.tracers, 0);
  assert.equal(f.sandbox.reservations.size, 0);
});
test('generated raider fire stays authoritative and cannot consume a local shot reservation', () => {
  const f = generatedFeedbackHarness(), hostileSounds = [], beforeAmmo = f.self.ammo;
  f.sandbox.zombieMeshes = new Map();
  f.sandbox.sound.raiderShot = (weapon, options) => hostileSounds.push({ weapon, options });
  let consumed = 0;
  f.sandbox.websocket.session.consumeShotEcho = () => { consumed++; return false; };
  assert.equal(f.sandbox.localFeedback(1, f.self), true);
  f.sandbox.actualEvent({ type: 'event', event: 'raider-shot', raiderId: 'r1', weapon: 'smg',
    x: f.self.x + 3, y: 1.4, z: f.self.z - 4, yaw: 0, pitch: 0, pellets: [], time: .1 });
  assert.equal(f.calls.tracers, 1); assert.equal(hostileSounds.length, 1);
  assert.equal(hostileSounds[0].weapon, 'smg'); assert.equal(hostileSounds[0].options.voiceId, 'r1');
  assert.equal(consumed, 0); assert.equal(f.sandbox.reservations.size, 1);
  assert.equal(f.self.ammo, beforeAmmo); assert.equal(f.calls.hits, 0);
});
test('actual reservation cleanup restores one-round rocket feedback after pause, epoch/phase changes or a missing ack', () => {
  for (const scenario of ['pause', 'epoch', 'phase', 'timeout', 'confirmed']) {
    const f = generatedFeedbackHarness();
    assert.equal(f.sandbox.localFeedback(1, f.self), true);
    assert.equal(f.sandbox.localFeedback(2, f.self), false, 'one unconfirmed cosmetic round exhausts the displayed stock');
    const next = { ...f.snapshot, net: { ...f.snapshot.net } };
    if (scenario === 'pause') next.paused = true;
    if (scenario === 'epoch') next.net.epoch = 'new-night';
    if (scenario === 'phase') next.phase = 'intermission';
    if (scenario === 'timeout') f.setNow(3001);
    if (scenario === 'confirmed') { f.sandbox.reservations.get(1).time = .2; next.time = .2; }
    f.sandbox.release(next);
    assert.equal(f.sandbox.reservations.size, 0, scenario);
    assert.equal(f.sandbox.localFeedback(3, f.self), true, scenario);
    assert.equal(f.self.ammo, 1, 'cleanup is cosmetic and never adds ammunition');
  }
});

const assertPointNear = (actual, expected, label) => {
  assert.ok(actual.distanceTo(expected) < 1e-10, `${label}: ${actual.toArray()} differs from ${expected.toArray()}`);
};
const confirmedShot = (fields = {}) => ({ type: 'event', event: 'shot', id: 'a', weapon: 'rifle', shotId: 1,
  x: 7, y: 2, z: -4, yaw: .23, pitch: -.1, hits: 0, time: .2,
  pellets: [{ yaw: .23, pitch: -.1, distance: 70, stop: 'range' }], ...fields });
const shotDirection = (yaw, pitch) => new Vector3(0, 0, -1).applyEuler(new Euler(pitch, yaw, 0, 'YXZ'));
function prepareRifleFeedback(fixture) {
  Object.assign(fixture.self, { weapon: 'rifle', ammo: 45 });
  Object.assign(fixture.sandbox, { gunType: 'rifle', fireAudioWeapon: 'rifle', gun: { userData: {} }, yaw: .23, pitch: -.1 });
}

function confirmedPhysicalShot(fields = {}) {
  const events = [], simulation = new RoomSimulation('BALLQA', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.phase = 'wave'; simulation.wave = 8; simulation.time = .2;
  Object.assign(player, { x: -4, y: 0, z: 0, yaw: .23, pitch: -.1, weapon: 'rifle', weaponId: 'rifle',
    inventory: { rifle: { ammo: 45, reserve: 90 } } });
  for (const key of ['x', 'z', 'yaw', 'pitch']) if (Object.hasOwn(fields, key)) player[key] = fields[key];
  assert.equal(simulation.shoot('a'), true);
  return { ...events.find(event => event.event === 'shot'), shotId: 1, ...fields };
}

function preparePhysicalFeedback(fixture, event) {
  prepareRifleFeedback(fixture);
  Object.assign(fixture.self, { weaponId: 'rifle', weapons: [{ id: 'rifle', weapon: 'rifle', ammo: 45, reserve: 90 }] });
  fixture.sandbox.camera.position.set(event.x, event.y, event.z);
  fixture.sandbox.camera.rotation.set(event.pitch, event.yaw, 0, 'YXZ');
  fixture.sandbox.camera.updateMatrixWorld = () => {};
  const origin = shotMuzzleFromView(event, event.yaw, event.pitch, fixture.sandbox.viewMuzzle);
  const barrel = new Vector3(origin.x, origin.y, origin.z);
  fixture.sandbox.gun = { userData: { muzzle: new Vector3(0, 0, -.7) }, localToWorld: () => barrel.clone() };
  fixture.sandbox.actualSend({ type: 'shoot' });
}

test('generated physical bullets use the captured local barrel after movement while server flight and impacts stay exact', () => {
  const f = generatedFeedbackHarness({ actualTracers: true }), event = confirmedPhysicalShot(), before = structuredClone(event);
  preparePhysicalFeedback(f, event);
  assert.equal(f.calls.muzzleCaptures, 1);
  assert.equal(f.calls.flashes.length, 1, 'click feedback already flashed at the weapon');
  f.setNow(1120);
  f.sandbox.camera.position.add(new Vector3(.6, 0, -.36));
  f.sandbox.camera.rotation.set(event.pitch + .02, event.yaw + .1, 0, 'YXZ');
  f.sandbox.yaw = event.yaw + .1; f.sandbox.pitch = event.pitch + .02;
  f.sandbox.camera.updateMatrixWorld = () => { throw new Error('confirmation resampled the current camera matrix'); };
  f.sandbox.gun = new Proxy({}, { get() { throw new Error('confirmation resampled the current gun'); } });
  f.sandbox.actualShotEffect(event);
  assert.equal(f.calls.physical.length, 1, 'exercise the physical branch rather than the legacy tracer');
  assert.equal(f.calls.traces.length, 0);
  const trace = f.calls.physical[0], expected = shotMuzzleFromView(f.sandbox.camera.position, event.yaw, event.pitch, f.sandbox.viewMuzzle);
  assert.ok(trace.options.muzzle, 'the corrected predicted barrel reaches the physical renderer');
  assertPointNear(new Vector3(trace.options.muzzle.x, trace.options.muzzle.y, trace.options.muzzle.z), new Vector3(expected.x, expected.y, expected.z), 'shot-time barrel on the newer predicted body');
  assert.deepEqual([trace.x, trace.y, trace.z], [event.x, event.y, event.z], 'physics remains anchored to its server origin');
  assert.deepEqual([trace.vx, trace.vy, trace.vz], [event.projectiles[0].vx, event.projectiles[0].vy, event.projectiles[0].vz]);
  assert.deepEqual(event, before);
  assert.equal(f.calls.flashes.length, 1, 'confirmation does not duplicate the click flash');
  const impact = { type: 'event', event: 'bullet-impact', id: 'a', projectileId: event.projectiles[0].id,
    x: -4.8, y: 1.3, z: -5.88, age: .04, terminal: true, stop: 'solid' };
  f.sandbox.actualEvent(impact);
  assert.equal(trace.contacts.length, 1);
  assert.deepEqual([trace.contacts[0].x, trace.contacts[0].y, trace.contacts[0].z], [impact.x, impact.y, impact.z]);
  assertPointNear(f.calls.impacts[0].point, new Vector3(impact.x, impact.y, impact.z), 'impact remains at the authoritative point');
  assert.equal(f.self.ammo, 45, 'cosmetics do not change ammunition');
});

for (const scenario of ['scope', 'changed weapon', 'changed instance', 'late 180-degree turn', 'distant eye', 'close wall', 'door boards', 'remote', 'hostile']) {
  test(`generated physical bullets keep the server origin without a visual barrel for ${scenario}`, () => {
    const f = generatedFeedbackHarness({ actualTracers: true });
    const event = confirmedPhysicalShot(scenario === 'close wall' ? { x: -1, z: -1.5, yaw: 0, pitch: 0 }
      : scenario === 'door boards' ? { x: 0, z: -5.4, yaw: 0, pitch: 0 } : {});
    if (scenario === 'close wall') {
      f.sandbox.viewMuzzle.set(.2, -.15, -1.4);
    }
    if (scenario === 'door boards') f.sandbox.viewMuzzle.set(.2, -.15, -.9);
    preparePhysicalFeedback(f, event);
    if (scenario === 'scope') f.sandbox.scoped = true;
    if (scenario === 'changed weapon') { f.sandbox.gunType = 'shotgun'; f.self.weapon = 'shotgun'; }
    if (scenario === 'changed instance') {
      f.self.weaponId = 'rifle#2';
      f.self.weapons.push({ id: 'rifle#2', weapon: 'rifle', ammo: 45, reserve: 90 });
    }
    if (scenario === 'late 180-degree turn') {
      f.sandbox.yaw = event.yaw + Math.PI;
      f.sandbox.camera.rotation.set(event.pitch, f.sandbox.yaw, 0, 'YXZ');
    }
    if (scenario === 'distant eye') f.sandbox.camera.position.x += 10;
    if (scenario === 'remote') event.id = 'other';
    if (scenario === 'hostile') { event.event = 'raider-shot'; event.raiderId = 'raider-old'; }
    const before = structuredClone(event);
    f.sandbox.actualShotEffect(event);
    assert.equal(f.calls.physical.length, 1);
    assert.equal(f.calls.physical[0].options.muzzle ?? null, null);
    assert.deepEqual(event, before);
  });
}

for (const rotation of [Math.PI / 2, Math.PI]) test(`generated confirmed tracer retains the shot-time barrel after ${rotation === Math.PI ? 180 : 90} degree turn, movement and weapon switch`, () => {
  const f = generatedFeedbackHarness({ actualTracers: true }); prepareRifleFeedback(f);
  const capturedOffset = f.sandbox.viewMuzzle.clone();
  f.sandbox.actualSend({ type: 'shoot' });
  assert.equal(f.calls.muzzleCaptures, 1); assert.equal(f.calls.tracers, 0, 'a local reservation never invents a hit trajectory');
  const event = confirmedShot(), before = structuredClone(event);
  f.setNow(1200);
  f.sandbox.yaw += rotation; f.sandbox.pitch = .7;
  f.sandbox.camera.position.set(100, 40, -100); f.sandbox.camera.rotation.set(.7, f.sandbox.yaw, 0, 'YXZ');
  Object.assign(f.self, { x: 100, y: 40, z: -100, weapon: 'minigun' });
  f.sandbox.gunType = 'minigun'; f.sandbox.fireAudioWeapon = 'minigun'; f.sandbox.viewMuzzle.set(8, 9, -10);
  f.sandbox.gun = new Proxy({}, { get() { throw new Error('confirmed old shot read the newly equipped gun'); } });
  f.sandbox.actualEvent(event);
  assert.equal(f.calls.traces.length, 1); assert.equal(f.calls.muzzleCaptures, 1, 'confirmation never samples the newer barrel');
  const eye = new Vector3(event.x, event.y, event.z), rotationAtShot = new Euler(event.pitch, event.yaw, 0, 'YXZ');
  assertPointNear(f.calls.traces[0].start, capturedOffset.applyEuler(rotationAtShot).add(eye), 'historical barrel anchored to authoritative shot eye');
  assertPointNear(f.calls.traces[0].end, eye.clone().addScaledVector(shotDirection(event.yaw, event.pitch), 70), 'confirmed 70 metre endpoint');
  assert.deepEqual(event, before, 'visual repair never modifies confirmed ballistics');
  assert.equal(f.self.ammo, 45); assert.equal(f.calls.hits, 0); assert.equal(f.calls.shots, 1, 'echo retains immediate-feedback deduplication');
});

test('generated shots of a running survivor leave the gun on screen at the click, then fly from the predicted body', () => {
  const f = generatedFeedbackHarness({ actualTracers: true }); prepareRifleFeedback(f);
  // A real first-person gun: the click shows its flash, casing and heat at once.
  const barrel = new Vector3(.3, 1.2, -.9);
  f.sandbox.gun = { userData: { muzzle: new Vector3(0, 0, -.7) }, localToWorld: () => barrel.clone() };
  f.sandbox.camera.updateMatrixWorld = () => {};
  f.setNow(1000); f.sandbox.actualSend({ type: 'shoot' });
  assert.equal(f.calls.flashes.length, 1); assert.equal(f.calls.flashes[0].local, true); assertPointNear(f.calls.flashes[0].point, barrel, 'flash at the gun on screen');
  assert.deepEqual(f.calls.cosmetics, [{ id: 'a', weapon: 'rifle', time: 1 }]); assert.equal(f.calls.tracers, 0);
  // The confirmation arrives 120 ms later; the survivor ran 0.7 m meanwhile.
  f.setNow(1120);
  f.sandbox.camera.updateMatrixWorld = () => { throw new Error('confirmed tracer read the current camera matrix'); };
  const event = confirmedShot({ pellets: [{ yaw: .23, pitch: -.1, distance: 70, stop: 'range' }, { yaw: .23, pitch: -.1, distance: 12, stop: 'zombie' }] });
  const eye = new Vector3(event.x, event.y, event.z), body = eye.clone().add(new Vector3(.6, 0, -.36));
  f.sandbox.camera.position.copy(body);
  f.sandbox.gun = new Proxy({}, { get() { throw new Error('confirmation read the gun'); } });
  f.sandbox.actualShotEffect(event);
  assert.equal(f.calls.flashes.length, 1, 'no second flash'); assert.equal(f.calls.cosmetics.length, 1, 'no second casing');
  const rotationAtShot = new Euler(event.pitch, event.yaw, 0, 'YXZ'), direction = shotDirection(event.yaw, event.pitch);
  const barrelAtBody = f.sandbox.viewMuzzle.clone().applyEuler(rotationAtShot).add(body);
  assert.equal(f.calls.traces.length, 2);
  for (const trace of f.calls.traces) {
    assertPointNear(trace.start, barrelAtBody, 'the bullet leaves the predicted body, with the shot-time barrel');
    assert.equal(trace.options.time, 1.12, 'the bullet is drawn at the confirmation');
    assert.equal(trace.options.lead, 0, 'and starts at the muzzle, never already on its way');
  }
  assertPointNear(f.calls.traces[0].end, body.clone().addScaledVector(direction, 70), 'a miss keeps its direction from the body');
  assertPointNear(f.calls.traces[1].end, eye.clone().addScaledVector(direction, 12), 'a hit keeps its authoritative point');
  assert.deepEqual(f.calls.markers, [], 'no hit was confirmed');
});

test('generated tracer safely uses the confirmed ray when its captured barrel is missing, expired, refused or cleared', () => {
  for (const scenario of ['missing', 'expired', 'refused', 'phase', 'epoch', 'paused', 'confirmed', 'wrong-weapon', 'uncaptured']) {
    const f = generatedFeedbackHarness({ actualTracers: true }); prepareRifleFeedback(f);
    if (scenario === 'uncaptured') f.sandbox.gunType = 'pistol';
    if (scenario !== 'missing') assert.equal(f.sandbox.localFeedback(1, f.self), true);
    if (scenario === 'expired') { f.setNow(3001); f.sandbox.release(f.snapshot); }
    if (scenario === 'refused') f.sandbox.actualAck({ type: 'shot-ack', shotId: 1, accepted: false });
    if (scenario === 'phase') f.sandbox.release({ ...f.snapshot, phase: 'intermission' });
    if (scenario === 'epoch') f.sandbox.release({ ...f.snapshot, net: { ...f.snapshot.net, epoch: 'later-night' } });
    if (scenario === 'paused') f.sandbox.release({ ...f.snapshot, paused: true });
    if (scenario === 'confirmed') { f.sandbox.reservations.get(1).time = .2; f.sandbox.release({ ...f.snapshot, time: .2 }); }
    if (scenario === 'wrong-weapon') f.sandbox.reservations.get(1).weapon = 'pistol';
    f.sandbox.gun = new Proxy({}, { get() { throw new Error(`fallback ${scenario} read the current gun`); } });
    const event = confirmedShot(), eye = new Vector3(event.x, event.y, event.z), direction = shotDirection(event.yaw, event.pitch);
    f.sandbox.actualShotEffect(event);
    assert.equal(f.calls.traces.length, 1, scenario);
    assertPointNear(f.calls.traces[0].start, eye.clone().addScaledVector(direction, .5), `${scenario} origin stays on confirmed ray`);
    assertPointNear(f.calls.traces[0].end, eye.clone().addScaledVector(direction, 70), `${scenario} endpoint stays authoritative`);
    if (!['wrong-weapon', 'uncaptured'].includes(scenario)) assert.equal(f.sandbox.reservations.size, 0, scenario);
  }
});

test('generated remote and hostile tracer geometry ignores interpolated actor models', () => {
  for (const hostile of [false, true]) {
    const f = generatedFeedbackHarness({ actualTracers: true });
    const event = confirmedShot({ id: 'remote', ...(hostile ? { event: 'raider-shot', raiderId: 'r1' } : {}) });
    const models = hostile ? f.sandbox.zombieMeshes : f.sandbox.playerMeshes;
    models.set(hostile ? 'r1' : 'remote', { position: new Vector3(100, 100, 100) });
    f.sandbox.actualShotEffect(event);
    assert.equal(f.calls.traces.length, 1);
    const eye = new Vector3(event.x, event.y, event.z), direction = shotDirection(event.yaw, event.pitch);
    assertPointNear(f.calls.traces[0].start, eye.clone().addScaledVector(direction, hostile ? 0 : .5), hostile ? 'raider true barrel origin' : 'remote confirmed ray origin');
    assertPointNear(f.calls.traces[0].end, eye.clone().addScaledVector(direction, 70), 'unchanged remote endpoint');
  }
});

test('generated delayed near-wall shots never draw backwards, keep exact impacts and omit zero-length trails', () => {
  for (const distance of [0, .01, .05, .06, .2, .8, 1, 70]) {
    const f = generatedFeedbackHarness({ actualTracers: true }); prepareRifleFeedback(f);
    assert.equal(f.sandbox.localFeedback(1, f.self), true);
    const event = confirmedShot({ x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0,
      pellets: [{ yaw: 0, pitch: 0, distance, stop: 'solid' }] });
    f.sandbox.actualShotEffect(event);
    const eye = new Vector3(event.x, event.y, event.z), expectedEnd = eye.clone().add(new Vector3(0, 0, -distance));
    assert.equal(f.calls.impacts.length, 1, `impact at ${distance} m remains authoritative`);
    assertPointNear(f.calls.impacts[0].point, expectedEnd, 'exact wall impact');
    if (distance <= .05) assert.equal(f.calls.traces.length, 0, `${distance} m stopped ray has no visible trail`);
    else {
      assert.equal(f.calls.traces.length, 1);
      const trace = f.calls.traces[0], visible = trace.end.clone().sub(trace.start), forward = new Vector3(0, 0, -1);
      assert.ok(visible.dot(forward) > 0, `${distance} m trail points forwards`);
      assert.ok(visible.dot(forward) + 1e-12 >= Math.hypot(visible.x, visible.y), `${distance} m trail cannot turn sharply sideways`);
      assertPointNear(trace.end, expectedEnd, 'exact tracer endpoint');
    }
  }
});

test('generated rocket tracer keeps its explicit authoritative impact rather than pellet range', () => {
  const f = generatedFeedbackHarness({ actualTracers: true });
  const event = confirmedShot({ weapon: 'rocket', impact: { x: 8, y: 2.2, z: -8 }, pellets: [{ yaw: 0, pitch: 0, distance: 70, stop: 'solid' }] });
  const before = structuredClone(event);
  f.sandbox.actualShotEffect(event);
  assert.equal(f.calls.traces.length, 1); assert.equal(f.calls.traces[0].options.rocket, true);
  assertPointNear(f.calls.traces[0].end, new Vector3(8, 2.2, -8), 'rocket explicit impact');
  assert.deepEqual(event, before); assert.equal(f.calls.impacts.length, 0, 'rocket explosion handles its own impact effect');
});


test('generated online dual wield sends and reserves each real instance independently, with its own sound and confirmed trajectory', () => {
  const f = generatedFeedbackHarness();
  Object.assign(f.self, { weapon: 'pistol', weaponId: 'pistol', ammo: 1, dualWield: true, secondaryWeaponId: 'pistol#2',
    weapons: [{ id: 'pistol', weapon: 'pistol', ammo: 1, magazine: 12, reserve: 6 }, { id: 'pistol#2', weapon: 'pistol', ammo: 1, magazine: 12, reserve: 7 }],
    hands: { secondary: { weapon: 'pistol', weaponId: 'pistol#2', ammo: 1, reserve: 7, reloading: false } } });
  Object.assign(f.sandbox, { secondaryFiring: true, fireAudioWeapon: 'pistol', gunType: 'pistol' });
  f.sandbox.websocket.session.reset({ snapshot: f.snapshot });
  f.sandbox.actualSend({ type: 'shoot' }); f.sandbox.actualSend({ type: 'shoot', hand: 'secondary' });
  assert.deepEqual(f.calls.packets.map(packet => packet.hand ?? 'primary'), ['primary', 'secondary']);
  assert.deepEqual([...f.sandbox.reservations.values()].map(shot => [shot.weaponId, shot.hand]), [['pistol', 'primary'], ['pistol#2', 'secondary']]);
  assert.deepEqual(f.calls.sounds.map(({ weapon, options }) => [weapon, options.voiceId]), [['pistol', 'a'], ['pistol', 'a:secondary']]);
  assert.equal(f.sandbox.localFeedback(9, f.self, 'primary'), false); assert.equal(f.sandbox.localFeedback(10, f.self, 'secondary'), false);
  assert.equal(f.self.ammo, 1); assert.equal(f.self.hands.secondary.ammo, 1);
  for (const packet of f.calls.packets) f.sandbox.actualEvent({ event: 'shot', id: 'a', weapon: 'pistol', weaponId: packet.hand ? 'pistol#2' : 'pistol', hand: packet.hand, shotId: packet.shotId, time: .1, hits: 0 });
  assert.equal(f.calls.shots, 2, 'both authority echoes retain the one-shot audio contract');
  assert.equal(f.calls.tracers, 2, 'each authority confirmation produces its own trajectory');
  f.self.hands.secondary.reloading = true;
  assert.equal(f.sandbox.localFeedback(11, f.self, 'secondary'), false, 'the secondary reload blocks only its own local feedback');
  f.sandbox.release({ ...f.snapshot, phase: 'intermission' });
  assert.equal(f.sandbox.localFeedback(12, f.self, 'primary'), true);
  f.self.dualWield = false; assert.equal(f.sandbox.localFeedback(13, f.self, 'secondary'), false);
});
