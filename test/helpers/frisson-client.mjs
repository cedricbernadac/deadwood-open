// The browser client (public/client.js) in a vm without a GPU, for the Frisson
// tests: its imports are the real modules, except three, world, audio and
// graphics (stubs) and the ambiance loader (injected). Moved out of
// frisson-plumbing-client.test.mjs so other tests can drive the same client.
// The world's effects record each impact burst with its options, and what is
// appended to the page's head is kept (a pack's stylesheet).
// Another source can run in the same harness (prepareClient): the online
// build, or a copy without some lines, for the blood's plumbing tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Vector3 as RenderVector3, Euler as RenderEuler } from 'three';
import { RoomSimulation } from '../../simulation.mjs';
import { createAmbianceLoader } from '../../public/ambiance.js';
import { DEFAULT_MUSIC_THEME } from '../../public/music-themes.js';
import { importPublicModule } from './public-modules.mjs';

// The pickup kinds the client's restylePickups drops (world.js, stubbed here:
// the constant is the real module's, so the plumbing reads the same list).
const { STYLED_PICKUP_KINDS } = await importPublicModule('world.js');

const clientUrl = new URL('../../public/client.js', import.meta.url);
export const CLIENT_SOURCE = readFileSync(clientUrl, 'utf8');
// The online build's status badge is a page element: stubbed like the world.
const STUBBED = new Set(['/vendor/three.module.js', './world.js', './audio.js', './graphics.js', './ambiance.js', './online/ui.js', './ballistic-visuals.js']);
// The real modules a source imports, and its body without the imports.
export async function prepareClient(source = CLIENT_SOURCE) {
  const imports = {};
  for (const [, names, from] of source.matchAll(/^import \{ ([^}]+) \} from '([^']+)';\r?$/gm)) {
    if (STUBBED.has(from)) continue;
    const module = await import(new URL(from, clientUrl));
    for (const name of names.split(',').map(value => value.trim())) { assert.ok(name in module, `${from} ${name}`); imports[name] = module[name]; }
  }
  return { imports, body: source.replace(/^import .*;\r?\n/gm, '') };
}
const LAN_CLIENT = await prepareClient();
export const HOOKS = ['impact', 'death', 'frame', 'hurt'];
export const settle = () => new Promise(resolve => setImmediate(resolve));
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const NO_HOOKS = Object.freeze({ impact: null, death: null, frame: null, hurt: null });
export const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// A pack that records what the client gives it. `importer` counts imports.
export function recordingPack(log, { gate = null, fail = false } = {}) {
  const pack = { events: [], contexts: [], imports: 0 };
  pack.module = {
    async install(ctx) {
      log.push('install'); pack.contexts.push(ctx);
      if (gate) await gate;
      // Copied into this realm: the client's objects come from its vm.
      for (const name of HOOKS) ctx.hooks[name] = event => { pack.events.push([name, { ...event }]); };
      return { uninstall() { log.push('uninstall'); for (const name of HOOKS) ctx.hooks[name] = null; } };
    },
  };
  pack.importer = () => { pack.imports++; log.push('import'); return fail ? Promise.reject(new Error('pack missing')) : Promise.resolve(pack.module); };
  return pack;
}

// `storage` replaces the browser's localStorage (one that throws, or forgets).
// `survivorStyle()` is what world.js getSurvivorStyle answers (null: Famille);
// with one, the stub survivors and raiders it would dress carry a character.
// `sounds`, an array, gets every sound call as [name, ...arguments].
// `client` is a prepareClient() result (the LAN client by default); `tracer`
// adds fields to each stub tracer (its `travel`); `session` is the online
// build's session on the joined socket (its timeline draws the enemies).
export function clientHarness({ id = 'guest', locked = false, importer = null, log = [], loader: loaderOptions, storage = null, survivorStyle = () => null, sounds = null,
  client = LAN_CLIENT, tracer = null, ballisticTracer = null, session = undefined } = {}) {
  const nodes = new Map(), sent = [], sockets = [], stored = new Map(locked ? [['deadwood-family-lock', '1']] : []), writes = [];
  const zombies = [], disposed = [], loaderCalls = [], timers = [], fetched = [], windowListeners = [], survivors = [], raiders = [], impacts = [], linked = [];
  const guns = [], weaponCalls = [], groundWeapons = [], heatCalls = [], pickups = [];
  let clock = 0;
  const node = name => {
    if (!nodes.has(name)) nodes.set(name, {
      hidden: ['lobby', 'hud', 'pause', 'gameover', 'menu-error', 'reload-page', 'supply-menu', 'sniper-scope', 'admission-panel', 'room-share-panel', 'join-field'].includes(name),
      textContent: '', value: '', title: '', style: { setProperty(key, value) { this[key] = value; } }, dataset: {}, disabled: false, checked: false,
      firstElementChild: { textContent: '' }, lastElementChild: { textContent: '' }, attributes: {},
      classList: { values: new Set(), add(...names) { names.forEach(item => this.values.add(item)); }, remove(...names) { names.forEach(item => this.values.delete(item)); },
        toggle(item, force) { const on = force ?? !this.values.has(item); if (on) this.values.add(item); else this.values.delete(item); return on; }, contains(item) { return this.values.has(item); } },
      append(...children) { this.children = [...(this.children ?? []), ...children]; }, replaceChildren(...children) { this.children = children; },
      getContext() { return new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} }); },
      addEventListener() {}, setAttribute(key, value) { this.attributes[key] = value; }, select() {}, focus() {}, remove() {}, scrollIntoView() {},
      click() { if (!this.disabled) this.onclick?.({ target: this }); },
      getClientRects() { return this.hidden ? [] : [{}]; }, closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; },
    });
    return nodes.get(name);
  };
  const object3D = () => ({ position: new RenderVector3(), rotation: new RenderEuler(), target: { position: { set() {} } },
    scale: { x: 1, y: 1, z: 1, setScalar(value) { this.x = this.y = this.z = value; } }, userData: {}, add() {}, remove() {}, visible: true });
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); sockets.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    emit(name, event = {}) { this.listeners.get(name)?.(event); }
    send(message) { sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; }
  }
  const loader = createAmbianceLoader(loaderOptions);
  const renderer = { shadowMap: {}, compile() {}, render() {}, setSize() {}, setPixelRatio() {} };
  const world = { setDoor() {}, setLanguage() {}, update() {}, prewarm() { log.push('prewarm'); },
    effects: { impact(point, options) { impacts.push({ x: point.x, y: point.y, z: point.z, ...options }); }, muzzle() {}, particles: { clear() {} } } };
  const context = vm.createContext({
    ...client.imports, console,
    createOnlineUI: () => ({ set() {}, text: key => key, render() {} }),
    performance: { now: () => clock }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    THREE: { Scene: class { add() {} remove() {} }, PerspectiveCamera: class { constructor() { Object.assign(this, object3D()); } lookAt() {} updateMatrixWorld() {} updateProjectionMatrix() {} },
      SpotLight: class { constructor() { Object.assign(this, object3D()); } }, PointLight: class { constructor() { Object.assign(this, object3D()); } },
      Vector3: RenderVector3, MathUtils: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) } },
    createGraphics: () => ({ renderer, preset: { id: 'medium' }, choice: 'auto', hints: {}, render() {}, resize() {}, setChoice: value => ({ choice: value, reloadRequired: false }), pixelRatio: () => 1 }),
    createWorld: () => world,
    createExtraction: () => ({ cameraPosition: new RenderVector3(), cameraTarget: new RenderVector3(), update() {}, reset() {} }),
    createZombie: (kind, boss, maxHp, zombieId) => { const mesh = object3D(); mesh.userData = { kind, boss, maxHp, id: zombieId }; zombies.push(mesh); return mesh; },
    disposeZombie: mesh => disposed.push(mesh),
    createRaider: ({ weapon, maxHp, id: raiderId = null } = {}) => {
      const mesh = object3D(), style = survivorStyle();
      mesh.userData = { raider: true, kind: 'raider', boss: false, maxHp, weaponType: weapon, id: raiderId, ...(style?.plan?.({ identity: { id: raiderId }, raider: true }) ? { character: 'Raider' } : {}) };
      raiders.push(mesh); return mesh;
    },
    startZombieDeath(mesh, death) { mesh.userData.death = death; }, startRaiderDeath(mesh, death) { mesh.userData.death = death; },
    animateZombieDeath: () => true, animateRaiderDeath: () => true, animateZombie() {}, animateRaider() {},
    createSurvivor: (color, options = {}) => {
      const mesh = object3D(), style = survivorStyle();
      mesh.userData = { color, identity: options.identity ?? null, ...(style?.plan?.({ color, identity: options.identity, raider: false }) ? { character: 'Survivor' } : {}) };
      survivors.push(mesh); return mesh;
    },
    getSurvivorStyle: () => survivorStyle(), animateSurvivor() {}, fireSurvivor() {}, survivorMuzzle: () => null,
    STYLED_PICKUP_KINDS,
    // Records every arming as [mesh, type] and keeps userData.weaponType in
    // step, as world.js setSurvivorWeapon does (restyleWeapons reads it).
    setSurvivorWeapon(mesh, type = 'pistol') { weaponCalls.push([mesh, type]); mesh.userData.weaponType = type ?? null; },
    // Every first-person gun made, in order; the minigun keeps its rotor.
    createWeapon: type => { const model = object3D(); model.userData = { type, muzzle: new RenderVector3(0, 0, -.7) };
      if (type === 'minigun') model.userData.rotor = object3D();
      model.localToWorld = value => value; guns.push(model); return model; },
    animateMeleeWeapon() {}, animateWeaponMechanism() {}, setWeaponHeat(mesh, level) { heatCalls.push([mesh, level]); }, setZombieBurn() {}, setZombieHealth() {},
    setZombieFrost() {}, setSurvivorSecondaryWeapon() {},
    // Every pickup made, in order, with the kind and special world.js would
    // put in userData (restylePickups reads them) and the fill it is given.
    createPickup: (kind, special, bonus) => { const mesh = object3D(); mesh.userData = { kind, special: Boolean(special), ...(kind === 'bonus' ? { bonus } : {}) }; pickups.push(mesh); return mesh; },
    setPickupFill(mesh, fill = 1) { mesh.userData.fill = fill; }, animatePickup() {},
    createGroundWeapon: type => { const mesh = object3D(); mesh.userData = { kind: 'weapon', weapon: type }; groundWeapons.push(mesh); return mesh; }, setGroundWeaponPose() {},
    createGrenadeProjectile: object3D, animateGrenadeProjectile() {}, createGrenadeExplosion: () => ({ mesh: {}, update: () => false, dispose() {} }),
    createFlameStream: () => ({ mesh: {}, aim() {}, stop() {}, update: () => false, dispose() {} }),
    createBallisticTracer: (projectile, options) => ballisticTracer?.(projectile, options) ?? { mesh: {}, id: projectile.id, update: () => false, contact() {}, dispose() {} },
    createTracer: (start, end, options) => ({ mesh: {}, update: () => false, dispose() {}, ...(tracer?.(start, end, options) ?? {}) }), createStragglerMarker: () => ({ ...object3D(), material: { dispose() {} } }),
    // Every sound is a no-op (recorded in `sounds` when asked); the music theme keeps its getter.
    SoundEngine: class { constructor() { return new Proxy({ musicTheme: DEFAULT_MUSIC_THEME, setMusicTheme: () => true }, { get: (target, key) => key in target ? target[key] : (...args) => { sounds?.push([key, ...args]); } }); } },
    applyAmbiance: (ambiance, ctx) => { loaderCalls.push(ambiance); return loader.apply(ambiance, ctx, importer ?? (() => { throw new Error('no importer'); })); },
    document: {
      pointerLockElement: null, hidden: false, hasFocus: () => true, activeElement: null, getElementById: node,
      body: { append() {}, classList: { add() {}, remove() {}, toggle() {} } }, head: { appendChild(child) { linked.push(child); return child; } },
      querySelectorAll: selector => selector === '[data-slot]' ? [1, 2, 3, 4].map(index => node(`weapon-slot-${index}`)) : [],
      createElement: () => node(Symbol()), addEventListener() {}, exitPointerLock() {},
    },
    window: { addEventListener(name, callback) { windowListeners.push([name, callback]); }, dispatchEvent() {} },
    fetch: url => { fetched.push(String(url)); return Promise.resolve({ json: () => Promise.resolve({}) }); },
    localStorage: storage ?? { getItem: key => stored.get(key) ?? null, setItem(key, value) { stored.set(key, value); writes.push([key, value]); } },
    history: { replaceState() {} }, location: { origin: 'http://localhost:3100', hostname: 'localhost', host: 'localhost:3100', protocol: 'http:', href: 'http://localhost:3100/' },
    URL, setTimeout: (callback, ms) => timers.push({ callback, ms }), clearTimeout() {}, requestAnimationFrame() {}, Event,
    navigator: { getGamepads: () => [], clipboard: { async writeText() {} } }, WebSocket: Socket,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  });
  for (let index = 0; index < 4; index++) node(`weapon-slot-${index + 1}`).dataset.slot = String(index);
  vm.runInContext(`${client.body}
    globalThis.fixture = {
      join(id) { myId = id; room = 'ABC123'; websocket = { readyState: WebSocket.OPEN, send: message => recordSend(message), close() {}, ...(harnessSession === undefined ? {} : { session: harnessSession }) }; $('menu').hidden = true; $('lobby').hidden = false; },
      fallen() { return typeof fallenIds === 'undefined' ? [] : fallenIds.filter(id => id !== null); }, camera() { return [camera.position.x, camera.position.y, camera.position.z]; }, cueHooks() { return pendingCues.map(cue => cue.hook ?? null); },
      update(state) { const previous = myPlayer(); snapshot = state; refreshState(previous); },
      event(message) { onEvent(message); }, frame(now) { frame(now); }, enter() { enterGame(); }, leave() { leave(); }, connect(options) { connect(options); },
      hooks() { return { ...ambianceHooks }; }, feedbackStyle() { return feedback.style; }, state() { return { inGame, ambianceWanted, ambianceReady, homeAmbiance, familyLocked, zombieIds: [...zombieMeshes.keys()], playerIds: [...playerMeshes.keys()], pickupIds: [...pickupMeshes.keys()], cues: pendingCues.length, cuePlays: new Set(pendingCues.map(cue => cue.play)).size }; },
      ballisticState() { return { ids: [...ballisticTracers.keys()], hitSoundGroups: ballisticHitSounds.size, time: ballisticTime, visualTime }; },
      gun() { return gun; }, gunType() { return gunType; },
    };`, Object.assign(context, { recordSend: message => sent.push(JSON.parse(message)), harnessSession: session }));
  const fixture = context.fixture;
  return { ...fixture, node, sent, sockets, stored, writes, zombies, disposed, loaderCalls, log, world, timers, fetched, survivors, raiders, impacts, guns, weaponCalls, groundWeapons, heatCalls, pickups,
    linked: () => linked.map(child => child.id ?? null),
    // Plain objects of this realm, so deepEqual compares values only.
    hooks: () => ({ ...fixture.hooks() }), state: () => JSON.parse(JSON.stringify(fixture.state())),
    ballisticState: () => JSON.parse(JSON.stringify(fixture.ballisticState())),
    fallen: () => [...fixture.fallen()], camera: () => [...fixture.camera()], cueHooks: () => [...fixture.cueHooks()],
    time(value) { clock = value; },
    // Another tab of this browser wrote to localStorage.
    storage(key, value) { if (value === null) stored.delete(key); else stored.set(key, value); for (const [name, callback] of windowListeners) if (name === 'storage') callback({ key, newValue: value }); } };
}

export function snapshotFor({ ambiance = 'family', phase = 'lobby', zombies = [] } = {}) {
  const simulation = new RoomSimulation('ABC123', { ambiance });
  simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité');
  simulation.phase = phase;
  const state = simulation.snapshot();
  state.zombies = zombies; state.remaining = 9;
  return state;
}
// What one click on the home screen sends: open sends the join, close ends the attempt.
export function joinMessage(client, options) {
  client.connect(options);
  const socket = client.sockets.at(-1); socket.emit('open');
  const message = client.sent.at(-1); socket.emit('close');
  assert.equal(message.type, 'join');
  return message;
}
export const walker = (id, x = 2) => ({ id, kind: 'walker', boss: false, x, y: 0, z: -4, yaw: 0, hp: 60, maxHp: 60 });
