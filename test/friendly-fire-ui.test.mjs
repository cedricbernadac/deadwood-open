import { createMapContext, mapForRoomCode } from '../public/map-context.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { LEVEL, IS_SUPERMARKET } from '../public/level-config.js';
import { Vector3 as RenderVector3, Euler as RenderEuler, PerspectiveCamera as RealPerspectiveCamera } from 'three';
import { applyWeaponViewPose, copyWeaponMuzzleInView } from '../public/weapon-view.js';
import { shotMuzzleFromView, safeTracerStart } from '../public/shot-visuals.js';
import { scopeTargetDistance } from '../public/scope-rangefinder.js';
import { BALLISTICS, ballisticRange } from '../public/ballistics.js';
import { cameraSupportHeight, cameraSmoothingAlpha, normalizeCameraSmoothing, CAMERA_SMOOTHING_KEY, CAMERA_SMOOTHING_DEFAULTS } from '../public/camera-motion.js';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, TICK_RATE } from '../simulation.mjs';
import { ARMORY, ARMORY_REACH, ARMORY_HEIGHT_REACH, STARTER_WEAPON, WEAPON_MOVEMENT, FIRE_INTERVALS, ECONOMY, PLAYER_POSTURE, ENEMY_HEALTH, BRUTE_HEALTH, enemyAppearance, PICKUPS, GRENADES, ROCKET, FLAMETHROWER, MELEE, MELEE_WEAPONS, MINIGUN_TIMING, minigunRotorSpeed, firingSchedule, MAX_WAVES, WINDOWS, RAIDS, DIFFICULTY_LEVELS, FRIENDLY_FIRE_LEVELS, friendlyFireAllowed, REVIVE, COIN_GIFT, AMBIANCES, ambianceOf, isFrissonLike } from '../public/rules.js';
import { SUPPLY_BONUSES, LATE_SUPPLIES, BACKPACK, MAX_BONUS_LEVEL, perforatingTargets, reinforcedMeleeTargets, reinforcedDamagePercent } from '../public/weapon-upgrades.js';
import { readMusicTheme, saveMusicTheme, isMusicTheme, MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME, readMusicVolume, saveMusicVolume } from '../public/music-themes.js';
import { RADAR, radarBlipSeconds, reconLevel, radarInformation, radarPulseIndex } from '../public/radar-rules.js';
import { GENERATOR } from '../public/expedition.js';
import { createRadarUI, radarSupplyStatus } from '../public/radar-ui.js';
import { createAimDiagnostics } from '../public/aim-diagnostics.js';
import { createGamepadControls, GAMEPAD_BUTTONS } from '../public/gamepad-controls.js';
import { createAimAssist } from '../public/aim-assist.js';
import { readRawMouse, saveRawMouse, rawMovementScale, warpEcho, warpEchoSized, WARP_ECHO, requestMouseLock, RAW_MOUSE_KEY } from '../public/mouse-look.js';
import { enemyProfile } from '../public/enemies.js';
import { meleeDirection, meleeWillLand, trackMotion, sightClear, sightDoors } from '../public/melee-reach.js';
import { readControllerSettings, saveControllerSettings, navigateControllerMenu, CONTROLLER_SETTINGS_KEY, CONTROLLER_DEFAULTS } from '../public/controller-ui.js';
import { rumbleEffect, playRumble, stopRumble } from '../public/haptics.js';
import { resolveGraphicsPreset, normalizeGraphicsQuality } from '../public/graphics-quality.js';
import { createFeedbackHud } from '../public/feedback-hud.js';
import { createDamageNumbers, IMPACT_FLAGS } from '../public/damage-numbers.js';
import { reviveCardItems, reviveToastLines, reviveCountUp, REVIVE_COUNT_MS, REVIVE_STAGGER_MS } from '../public/revive-bonus.js';
import { bonusIcon } from '../public/bonus-icons.js';
import { CHARACTER_BONUSES, characterStats, characterBonusDescription } from '../public/character-bonuses.js';
import { bonusHudCard, sheetMalusEffect } from '../public/bonus-hud.js';
import { readSheetShown, saveSheetShown, survivorSheetModel, survivorSheetKey, renderSurvivorSheet, measureSheetRegion, placeSurvivorSheet, sheetFeedPlace, sheetBreachRight, sheetRegion, SURVIVOR_SHEET_KEY } from '../public/survivor-sheet.js';
import { claimStep, effectiveBonusLevel, bonusDebt } from '../public/character-sheet.js';
import { createCharacterPicker, characterLabel, characterChips, signedValue } from '../public/character-sheet-ui.js';
import { activeWeaponId } from '../public/weapon-inventory.js';
import { COMPANION_PROFILE_CHOICES, companionArchetype } from '../public/companion-profiles.js';
import { saveFileName, saveSummary, readSaves, keepSave, forgetSave, saveDateLabel, uploadPlan, downloadText, SAVE_STORAGE_KEY } from '../public/save-game.js';
import { createCameraShake, explosionTrauma, SHOT_TRAUMA, createHitStop, createSlowMotion, knockbackFor, clampSlide, createBarrelHeat, casingPort } from '../public/combat-feel.js';
import { buildOnlineClient } from '../online-client-build.mjs';

// The client harness below mirrors test/client-flow.test.mjs (no shared
// module exists): client.js runs in a vm with its imports injected, a fake
// DOM and a recorded send(). Two accessors are added for this feature:
// predictMelee (the client's meleeWillHit) and friendlyArcs (the damage-arc
// pool). The i18n harness mirrors test/i18n.test.mjs.
const clientSource = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const i18nSource = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function clientHarness(id = 'guest', { savedMusic = null, storageBlocked = false, savedMusicVolume = null, savedCamera = null, cameraStorageBlocked = storageBlocked, savedController = null, savedRawMouse = null, clipboardBlocked = false, weaponMuzzle = null, href = 'http://localhost:3000', fakeNow=null, servedBuild, aimAssistFactory = createAimAssist, realCamera = false, savesBlocked = false, downloadFails = false, savedSurvivorSheet = null, savedValues = [], absentNodes = [], multiMap = false, mapId = LEVEL.id, mapStorageBlocked = storageBlocked, sessionData = new Map(), windowName = '', allStorageBlocked = false } = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const sent = [];
  const replacedUrls = [], redirectedUrls = [];
  const musicWrites = [];
  const cameraWrites = [], storedValues = new Map([[CAMERA_SMOOTHING_KEY, savedCamera], [CONTROLLER_SETTINGS_KEY, savedController], [RAW_MOUSE_KEY, savedRawMouse], [SURVIVOR_SHEET_KEY, savedSurvivorSheet], ...savedValues]);
  const clipboardWrites = [], gamepads = [], warnings = [], downloads = [];
  const musicStorage = { getItem() { if (storageBlocked) throw new Error('blocked'); return savedMusic; }, setItem(key, value) { if (storageBlocked) throw new Error('blocked'); musicWrites.push([key, value]); } };
  const musicVolumeWrites = [];
  const musicVolumeStorage = { getItem() { if (storageBlocked) throw new Error('blocked'); return savedMusicVolume; }, setItem(key, value) { if (storageBlocked) throw new Error('blocked'); musicVolumeWrites.push([key, value]); } };
  const sockets = [];
  const extractionCalls = { updates: [], resets: 0 };
  const boardCalls = [];
  const soundCalls = { explosions: [], extraction: 0, victory: 0, hurt: 0, repair: 0, boardBreak: 0, shoot: 0, minigunStarts: 0, hit: 0, revive: 0, reload: 0, reloadArgs: [], reloadReleases: 0, activeReload: null, kill: 0, killArgs: [], purchase: 0, unlocks: 0, scenes: [], footsteps: [], groans: [], singles: [], releases: [], activeBursts: { rifle: false, smg: false, minigun: false, assault: false, flamethrower: false }, stops: 0, musicVolumes: [] };
  const zombieCalls = [], pickupCalls = [], survivorCalls = [], flameCalls = [], tracerCalls = [], ballisticCalls = [], surfaceImpacts = [], disposedZombies = [];
  const raiderCalls = [], raiderFrames = [], raiderCorpses = [], compiles = [], tracerDisposals = { count: 0 };
  Object.assign(soundCalls, { raiderShots: [], raiderReleases: [], raidAlarms: [], raiderDowns: 0 });
  const meleeCalls=[];soundCalls.melee=[];soundCalls.meleeReleases=[];soundCalls.meleeConfirms=[];
  const worldLanguages = [], worldFrames = [], worldOptions = [];
  const graphicsRenderCalls = [], graphicsChoiceCalls = [];
  soundCalls.shotOptions = [];
  soundCalls.shotVoiceIds = []; soundCalls.singleOptions = []; soundCalls.assaultReleases = []; soundCalls.pumpReleases = []; soundCalls.activePumps = new Set();
  let renderCount = 0;
  let pointerExits = 0;
  function node(name) {
    if (absentNodes.includes(name)) return null;
    if (!nodes.has(name)) nodes.set(name, {
      hidden: ['lobby', 'hud', 'pause', 'gameover', 'menu-error', 'reload-page', 'supply-menu', 'sniper-scope','weapon-slot-3','weapon-slot-4','backpack-status','aim-diagnostic-output','admission-panel','room-share-panel',
        'load-panel','load-status','lobby-load-status','admission-seats','save-game-button','save-game-hint','save-game-status'].includes(name),
      textContent: '', value: '', style: { setProperty(name, value) { this[name] = value; } }, dataset: {},
      ...(typeof name === 'string' && name.startsWith('companions-profiles') ? { children: [] } : {}),
      tagName: 'BUTTON', type: 'button', disabled: false, checked: false,
      firstElementChild: { textContent: '' }, lastElementChild: { textContent: '' },
      classList: { values: new Set(), add(...names) { names.forEach(name => this.values.add(name)); }, remove(...names) { names.forEach(name => this.values.delete(name)); }, toggle(name, force) { const enabled = force ?? !this.values.has(name); if (enabled) this.values.add(name); else this.values.delete(name); return enabled; }, contains(name) { return this.values.has(name); } },
      append(...children) { this.children = [...(this.children || []), ...children]; }, replaceChildren(...children) { this.children = children; },
      getContext() { return new Proxy({}, { get: (target,key) => key in target ? target[key] : () => {} }); },
      addEventListener(name, callback) { (this.listeners ||= new Map()).set(name, callback); },
      dispatchEvent(event) { this[`on${event.type}`]?.({ ...event, target: this }); this.listeners?.get(event.type)?.(event); return true; },
      setAttribute(name, value) { (this.attributes ||= {})[name] = value; },
      select() { this.selected = true; }, focus() { context.document.activeElement = this; }, remove() {},
      click() { if (!this.disabled) this.onclick?.({ target: this }); },
      getClientRects() { return this.hidden ? [] : [{}]; }, closest() { return this.hidden ? this : null; },
      querySelectorAll() { return this.controls ?? []; }, querySelector() { return null; }, scrollIntoView() {},
    });
    return nodes.get(name);
  }
  const object3D = () => ({
    position: new RenderVector3(),
    target: { position: { set() {} } }, rotation: new RenderEuler(), scale: { x: 1, y: 1, z: 1, setScalar(value) { this.value = value; this.x = this.y = this.z = value; } }, userData: {}, add() {}, remove() {},
  });
  class Scene { add() {} remove() {} }
  class Camera { constructor(fov) { Object.assign(this, object3D()); this.fov=fov; } lookAt() {} updateMatrixWorld() {} updateProjectionMatrix() {} }
  class Renderer { constructor() { this.shadowMap = {}; } setPixelRatio() {} setSize() {} render() { renderCount++; } compile() { compiles.push(raiderCalls.map(call => call.mesh.userData.flash.visible)); } }
  class Light { constructor() { Object.assign(this, object3D()); } }
  class Clock { getElapsedTime() { return 0; } }
  class Vector3 extends RenderVector3 {}
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = Socket.OPEN; this.listeners = new Map(); sockets.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    emit(name, event = {}) { this.listeners.get(name)?.(event); }
    send(message) { sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const context = vm.createContext({
    LEVEL: { ...LEVEL, id: mapId }, IS_SUPERMARKET, createMapContext: options => createMapContext({ ...options, document: context.document, location: context.location, window: context.window }), mapForRoomCode,
    performance:fakeNow===null?performance:{now:()=>fakeNow}, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    THREE: { Scene, PerspectiveCamera: realCamera ? RealPerspectiveCamera : Camera, WebGLRenderer: Renderer,
      SpotLight: Light, PointLight: Light, Clock, Vector3, MathUtils:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))} },
    bonusIcon, CHARACTER_BONUSES, characterStats, characterBonusDescription, reconLevel, radarInformation, radarPulseIndex,
    ARMORY, ARMORY_REACH, ARMORY_HEIGHT_REACH, STARTER_WEAPON, WEAPON_MOVEMENT, FIRE_INTERVALS, PLAYER_POSTURE, ENEMY_HEALTH, BRUTE_HEALTH, enemyAppearance, PICKUPS, GRENADES, ROCKET, FLAMETHROWER, MELEE, MELEE_WEAPONS, SUPPLY_BONUSES, LATE_SUPPLIES, BACKPACK, MAX_BONUS_LEVEL, perforatingTargets, reinforcedMeleeTargets, reinforcedDamagePercent, MINIGUN_TIMING, minigunRotorSpeed, firingSchedule, MAX_WAVES, WINDOWS, RAIDS, DIFFICULTY_LEVELS, FRIENDLY_FIRE_LEVELS, friendlyFireAllowed, REVIVE, COIN_GIFT, AMBIANCES, ambianceOf, isFrissonLike, applyWeaponViewPose, copyWeaponMuzzleInView,
    RADAR, radarBlipSeconds, createRadarUI, radarSupplyStatus, GENERATOR, rumbleEffect, playRumble, stopRumble,
    createAimDiagnostics, cameraSupportHeight, cameraSmoothingAlpha, normalizeCameraSmoothing, CAMERA_SMOOTHING_KEY, CAMERA_SMOOTHING_DEFAULTS,
    createGamepadControls, createAimAssist: aimAssistFactory, enemyProfile, readControllerSettings, saveControllerSettings, navigateControllerMenu,
    readRawMouse, saveRawMouse, rawMovementScale, warpEcho, warpEchoSized, WARP_ECHO, requestMouseLock,
    meleeDirection, meleeWillLand, trackMotion, sightClear, sightDoors,
    shotMuzzleFromView, safeTracerStart, scopeTargetDistance, BALLISTICS, ballisticRange,
    createBallisticTracer: (projectile, options) => { const trace = { ...projectile, options, contacts: [], mesh: {}, update: () => true, contact(event) { this.contacts.push(event); }, dispose() {} }; ballisticCalls.push(trace); return trace; },
    saveFileName, saveSummary, readSaves, keepSave, forgetSave, saveDateLabel, uploadPlan,
    // The browser download, recorded (a real Blob URL needs no checking here).
    downloadText: (document, text, name) => { if (downloadFails) return false; downloads.push({ text, name }); return true; },
    readSheetShown, saveSheetShown, survivorSheetModel, survivorSheetKey, renderSurvivorSheet, measureSheetRegion, placeSurvivorSheet, sheetFeedPlace, sheetBreachRight,
    bonusHudCard, sheetMalusEffect, claimStep, effectiveBonusLevel, bonusDebt, createCharacterPicker, characterLabel, characterChips, signedValue, activeWeaponId, COMPANION_PROFILE_CHOICES, companionArchetype, createFeedbackHud, createDamageNumbers, IMPACT_FLAGS, reviveCardItems, reviveToastLines, reviveCountUp, REVIVE_COUNT_MS, REVIVE_STAGGER_MS, createCameraShake, explosionTrauma, SHOT_TRAUMA, createHitStop, createSlowMotion, knockbackFor, clampSlide, createBarrelHeat, casingPort,
    setWeaponHeat() {},
    readMusicTheme: () => readMusicTheme(musicStorage), saveMusicTheme: value => saveMusicTheme(value, musicStorage),
    readMusicVolume: () => readMusicVolume(musicVolumeStorage), saveMusicVolume: value => saveMusicVolume(value, musicVolumeStorage),
    createWorld: (scene, options) => { worldOptions.push(options); return { setDoor(id, ratio, boards) { boardCalls.push({ id, ratio, boards }); }, setLanguage(language) { worldLanguages.push(language); }, update(time) { worldFrames.push(time); } }; },
    // Wraps the stub Renderer above, so render/compile assertions keep their meaning.
    createGraphics: ({ scene: graphicsScene, camera: graphicsCamera } = {}) => {
      const renderer = new Renderer();
      return {
        renderer, preset: resolveGraphicsPreset('auto', {}), choice: 'auto', hints: {},
        render(delta, options) { graphicsRenderCalls.push({ delta, measure: options?.measure === true }); renderer.render(graphicsScene, graphicsCamera); },
        resize(width, height) { renderer.setSize(width, height); },
        setChoice(value) { graphicsChoiceCalls.push(value); return { choice: normalizeGraphicsQuality(value), reloadRequired: true }; },
        pixelRatio() { return 1; },
      };
    },
    createWeapon(type) { const model = object3D(); model.userData.type = type; model.userData.muzzle = new Vector3(0, 0, -.7); model.localToWorld = value => weaponMuzzle?.clone() ?? value; if (type === 'minigun') model.userData.rotor = { rotation: { z: 0 } }; return model; },
    animateMeleeWeapon(model,pose){meleeCalls.push(pose);},
    animateWeaponMechanism() {},
    createExtraction: () => ({ cameraPosition: new Vector3(-11, 6.8, -17), cameraTarget: new Vector3(1, 3.5, -8.5),
      update(elapsed, duration) { extractionCalls.updates.push({ elapsed, duration }); }, reset() { extractionCalls.resets++; } }),
    createZombie: (kind, boss, maxHp, id) => { const mesh = object3D(); mesh.userData = { kind, boss, maxHp }; zombieCalls.push({ kind, boss, maxHp, id, mesh }); return mesh; },
    disposeZombie(mesh) { disposedZombies.push(mesh); },
    createRaider: ({ weapon, maxHp } = {}) => { const mesh = object3D(); mesh.userData = { raider: true, kind: 'raider', boss: false, maxHp, weaponType: weapon, flash: { visible: false, parent: {} } }; raiderCalls.push({ weapon, maxHp, mesh }); return mesh; },
    animateRaider(mesh, state) { raiderFrames.push({ mesh, state, rotationY: mesh.rotation.y }); },
    startRaiderDeath(mesh, death) { mesh.userData.raiderDeath = death; }, animateRaiderDeath(mesh) { raiderCorpses.push(mesh); return true; },
    setZombieFrost(mesh, slow) { mesh.userData.frostSlow = slow; }, animateZombie() {}, setZombieBurn(mesh, burning) { mesh.userData.burning = burning; }, setZombieHealth(mesh,hp,maxHp) { mesh.userData.hp=hp;mesh.userData.maxHp=maxHp; }, createSurvivor: object3D, getSurvivorStyle: () => null,
    createFlameStream: () => { const stream = { mesh: {}, aims: [], stopped: false, disposed: false, aim(start, end, time) { this.aims.push({ start: start.clone(), end: end.clone(), time }); this.stopped = false; }, update: () => false, dispose() { this.disposed = true; } }; flameCalls.push(stream); return stream; },
    setSurvivorSecondaryWeapon(mesh, weapon) { mesh.userData.secondaryType = weapon; }, setSurvivorWeapon(mesh, weapon) { mesh.userData.weaponType = weapon; }, animateSurvivor(mesh, state) { survivorCalls.push(state); }, fireSurvivor(mesh, time) { if (mesh.userData.raider) mesh.userData.firedAt = time; }, survivorMuzzle: mesh => mesh.userData.raider ? new Vector3(mesh.position.x, 1.4, mesh.position.z) : null,
    createTracer: (start, end, options) => { tracerCalls.push({ start, end, options }); return { mesh: {}, update: () => false, dispose() { tracerDisposals.count++; } }; },
    startZombieDeath(mesh) { mesh.userData.dying = true; }, animateZombieDeath: () => true,
    createStragglerMarker: () => { const marker = object3D(); marker.material = { dispose() {} }; return marker; },
    createPickup: (kind, special, bonus) => { const mesh = object3D(); mesh.userData = { kind, special, ...(kind==='bonus'?{bonus}: {}) }; pickupCalls.push({ kind, special, mesh }); return mesh; }, setPickupFill(mesh, fill = 1) { mesh.userData.fill = fill; }, animatePickup() {},
    createGroundWeapon: weapon => { const mesh = object3D(); mesh.userData = { kind: 'weapon', weapon }; pickupCalls.push({ kind: 'weapon', weapon, mesh }); return mesh; },
    setGroundWeaponPose(mesh, pose) { mesh.userData.pose = { yaw: pose.yaw ?? 0, pitch: pose.pitch ?? 0, modelLift: pose.modelLift ?? 0 }; },
    createGrenadeProjectile: object3D, animateGrenadeProjectile() {},
    createGrenadeExplosion: () => ({ mesh: {}, update: () => false, dispose() {} }),
    SoundEngine: class {
      burstVoices = new Map(); reloadVoices = new Map();
      musicTheme = DEFAULT_MUSIC_THEME; setMusicTheme(value) { if (!isMusicTheme(value)) return false; this.musicTheme = value; return true; }
      musicVolume = 1; setMusicVolume(value) { this.musicVolume = value; soundCalls.musicVolumes.push(value); }
      setVolume(value) { (soundCalls.volumes ||= []).push(value); }
      unlock() { soundCalls.unlocks++; } wave() {}
      shoot(type, options) { soundCalls.shoot++; soundCalls.shotOptions.push({ type, held: options?.held === true }); soundCalls.shotVoiceIds.push(options?.voiceId); if (type === 'shotgun') soundCalls.activePumps.add(options?.voiceId); if (type in soundCalls.activeBursts) { soundCalls.burstVoices = this.burstVoices; this.burstVoices.set(`${options?.voiceId ?? 'local'}:${type}`, { voiceId: options?.voiceId ?? 'local', type }); soundCalls.activeBursts[type] = true; } }
      startMinigun() { soundCalls.minigunStarts++; }
      singleShot(type, options) { soundCalls.singles.push(type); soundCalls.singleOptions.push(options); }
      releaseAssault(id) { soundCalls.assaultReleases.push(id); }
      melee(attack,volume,id,weapon,timing){soundCalls.melee.push({attack,volume,id,weapon,timing});}releaseMelee(id){soundCalls.meleeReleases.push(id);}confirmMelee(id,attackId,hits){soundCalls.meleeConfirms.push({id,attackId,hits});}
      releaseFire(type, voiceId) { soundCalls.releases.push(type); for (const [key, voice] of this.burstVoices) if ((type === undefined || voice.type === type) && (voiceId === undefined || voice.voiceId === voiceId)) this.burstVoices.delete(key); for (const key of Object.keys(soundCalls.activeBursts)) soundCalls.activeBursts[key] = [...this.burstVoices.values()].some(voice => voice.type === key); }
      releasePump(id) { soundCalls.pumpReleases.push(id); if (id === undefined) soundCalls.activePumps.clear(); else soundCalls.activePumps.delete(id); }
      hit() { soundCalls.hit++; } revive() { soundCalls.revive++; }
      reload(type, duration, { voiceId = 'local' } = {}) { soundCalls.reload++; const args = { type, duration }; soundCalls.reloadArgs.push(args); (soundCalls.reloadVoices ||= []).push({ ...args, voiceId }); this.reloadVoices.set(voiceId, args); if (!voiceId.endsWith(':secondary')) soundCalls.activeReload = args; }
      releaseReload(voiceId) { soundCalls.reloadReleases++; if (voiceId === undefined) this.reloadVoices.clear(); else this.reloadVoices.delete(voiceId); if (!voiceId?.endsWith(':secondary')) soundCalls.activeReload = null; }
      explosion(gain, options) { soundCalls.explosions.push({gain, ...options}); }
      kill(...args) { soundCalls.kill++; soundCalls.killArgs.push(args); } purchase() { soundCalls.purchase++; }
      extraction() { soundCalls.extraction++; } victory() { soundCalls.victory++; }
      hurt() { soundCalls.hurt++; } repair() { soundCalls.repair++; } boardBreak() { soundCalls.boardBreak++; }
      groan(volume) { soundCalls.groans.push(volume); }
      raiderShot(kind, options) { soundCalls.raiderShots.push({ kind, ...options }); } releaseRaider(id) { soundCalls.raiderReleases.push(id); }
      raidAlarm(options) { soundCalls.raidAlarms.push(options ?? {}); } raiderDown() { soundCalls.raiderDowns++; }
      updateScene(state, inGame) { soundCalls.scenes.push({ phase: state?.phase ?? null, wave: state?.wave ?? null, inGame, boss: state?.zombies?.some(zombie => zombie.boss) ?? false }); }
      updateFootsteps(self, enabled) { soundCalls.footsteps.push({ id: self?.id ?? null, x: self?.x, z: self?.z, enabled }); }
      stop() { soundCalls.stops++; }
    },
    document: {
      pointerLockElement: null, hidden: false, focused: true, hasFocus() { return this.focused; },
      getElementById: node, activeElement: null, body: { append() {}, classList: { add() {}, remove() {}, toggle() {} } },
      querySelector: selector => selector === 'meta[name="deadwood-multi-map"]' && multiMap ? { content: 'true' } : null,
      querySelectorAll: selector => selector === '[data-slot]' ? [...nodes.values()].filter(element => Object.hasOwn(element.dataset, 'slot')) : [], createElement: tag => { const element = node(Symbol()); element.tagName = String(tag).toUpperCase(); return element; },
      addEventListener: (name, listener) => listeners.set(name, listener),
      exitPointerLock: () => { pointerExits++; context.document.pointerLockElement = null; },
    },
    window: { name: windowName, sessionStorage: { getItem(key) { if (mapStorageBlocked) throw Error('blocked'); return sessionData.get(key) ?? null; }, setItem(key,value) { if (mapStorageBlocked) throw Error('blocked'); sessionData.set(key,value); }, removeItem(key) { if (mapStorageBlocked) throw Error('blocked'); sessionData.delete(key); } }, addEventListener: (name, listener) => windowListeners.set(name, listener), dispatchEvent: event => windowListeners.get(event.type)?.(event) },
    // /world.json publishes the base weapon table, as both servers do.
    fetch: url => Promise.resolve({ json: () => Promise.resolve(url === '/version.json' && servedBuild !== undefined ? { build: servedBuild } : url === '/world.json' ? { weapons: JSON.parse(JSON.stringify(WEAPONS)) } : {}) }),
    localStorage: {
      getItem(key) { if (allStorageBlocked) throw Error('blocked'); if (key === CAMERA_SMOOTHING_KEY && cameraStorageBlocked || key === SAVE_STORAGE_KEY && savesBlocked) throw new Error('blocked'); return storedValues.get(key) ?? null; },
      setItem(key, value) { if (allStorageBlocked) throw Error('blocked'); if (key === CAMERA_SMOOTHING_KEY && cameraStorageBlocked || key === SAVE_STORAGE_KEY && savesBlocked) throw new Error('blocked'); storedValues.set(key, value); if (key === CAMERA_SMOOTHING_KEY) cameraWrites.push([key, value]); },
    }, history: { replaceState(_, __, url) { replacedUrls.push(String(url)); } },
    location: { origin: new URL(href).origin, hostname: new URL(href).hostname, pathname: new URL(href).pathname, protocol: new URL(href).protocol, host: new URL(href).host, href, assign(url) { redirectedUrls.push(url); } },
    URL, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
    console: { warn: (...args) => warnings.push(args) },
    Event,
    navigator: { getGamepads: () => gamepads, clipboard: { async writeText(value) { if (clipboardBlocked) throw new Error('clipboard unavailable'); clipboardWrites.push(value); } } },
    WebSocket: Socket,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fixtureId: id, recordSend: message => sent.push(JSON.parse(message)),
    recordSurfaceImpact: (point, wood) => surfaceImpacts.push({ point: point.clone(), wood }),
  });
  for(let index=0;index<4;index++)node(`weapon-slot-${index+1}`).dataset.slot=String(index);
  vm.runInContext(`${i18nSource}\n${clientSource}\n
    myId = fixtureId; room = 'ABC123';
    websocket = { readyState: WebSocket.OPEN, send: recordSend, close() {} };
    refreshShareAddress();
    $('menu').hidden = true; $('lobby').hidden = false;
    // Particle and tracer GPU objects are outside this transition harness.
    const productionShotEffect = shotEffect;
    shotEffect = () => {}; impactEffect = () => {};
    surfaceImpact = (point, wood) => recordSurfaceImpact(point, wood);
    globalThis.fixture = {
      update(state) { const previous = myPlayer(); snapshot = state; refreshState(previous); },
      event(message) { onEvent(message); },
      impacts(message) { onImpacts(message); },
      renderShot(message) { productionShotEffect(message); },
      enableShotVisuals() { shotEffect = productionShotEffect; }, muzzleIntensity() { return muzzleLight.intensity; },
      enter() { enterGame(); }, pause() { showPause(); }, serverMessage(message) { onSaveMessage(message); },
      lock() { pointerLocked = true; document.pointerLockElement = canvas; inputFocused = true; document.focused = true; document.hidden = false; $('pause').hidden = true; },
      domLock(value) { document.pointerLockElement = value ? canvas : null; },
      focus(value) { document.focused = value; },
      activity() { return { keys: keys.size, firing }; },
      input() { return inputMessage(); },
      frame(now) { frame(now); }, connect() { connect(); }, leave() { leave(); },
      pickupCount() { return pickupMeshes.size; }, stragglerCount() { return stragglerMarkers.size; }, pickupMesh(id) { return pickupMeshes.get(id); },
      language(value) { setLanguage(value); },
      hidden(value) { document.hidden = value; },
      cameraY() { return camera.position.y; },
      cameraPosition() { return { x:camera.position.x, y:camera.position.y, z:camera.position.z }; },
      cameraSettings() { return JSON.parse(JSON.stringify(cameraSmoothing)); },
      aim() { return {yaw,pitch,fov:camera.fov,scoped}; },
      bonusUsable(kind) { return bonusUsable(kind); },
      gunType() { return gunType; }, grenadeCount() { return grenadeMeshes.size; }, explosionCount() { return explosions.length; },
      rotorRotation() { return gun?.userData.rotor?.rotation.z; },
      models() { return { primary: gun, secondary: secondaryGun }; }, restyleWeapons() { restyleWeapons(); },
      visualTime() { return visualSeconds(); },
      controller() { return { playing: controllerPlaying, state: controllerState, settings: { ...controllerSettings }, captured: controlsCaptured() }; },
      avatars() { return [...playerMeshes.keys()]; },
      mouseLook() { return mouseLookState(); },
      sheetRect(value) { survivorSheetRect = value; }, placePlaque() { placeInteraction(); },
      placeFeed(region, cards = []) { survivorSheetCards = cards; placeTeamFeed(region); },
      predictMelee(id, weapon, attack, contact) { return meleeWillHit(id, weapon, attack, contact); },
      friendlyArcs() { return damageArcs.map(arc => ({ raiderId: arc.raiderId, fromX: arc.fromX, fromZ: arc.fromZ })); },
    };`, context);
  return {
    ...context.fixture, node, sent, sockets, extractionCalls, soundCalls, boardCalls, zombieCalls, disposedZombies, pickupCalls, survivorCalls, flameCalls, tracerCalls, ballisticCalls, surfaceImpacts, worldLanguages, worldFrames, worldOptions, musicWrites, musicVolumeWrites, cameraWrites, replacedUrls,meleeCalls,
    raiderCalls, raiderFrames, raiderCorpses, compiles, tracerDisposals, clipboardWrites, storedValues, graphicsRenderCalls, graphicsChoiceCalls, warnings, downloads,
    pad: value => { gamepads.splice(0, gamepads.length, ...(value ? [value] : [])); },
    redirectedUrls, sessionData, windowName: () => context.window.name,
    activeElement: () => context.document.activeElement,
    dispatch: (name, event) => { if (name === 'pointerlockchange') context.document.pointerLockElement = null; return listeners.get(name)?.(event); },
    dispatchWindow: (name, event) => { if (name === 'blur' || name === 'focus') context.document.focused = name === 'focus'; return windowListeners.get(name)?.(event); },
    enablePointerRequest: () => { node('game').requestPointerLock = () => {}; },
    gainCapture: () => { context.document.pointerLockElement = node('game'); listeners.get('pointerlockchange')?.(); },
    pointerExits: () => pointerExits,
    mouseLook: () => ({ ...context.fixture.mouseLook() }), // a plain object of this realm
    // Window size and pixel ratio are read live, like the browser globals.
    viewport: ({ width, height, pixelRatio } = {}) => { if (width) context.innerWidth = width; if (height) context.innerHeight = height; if (pixelRatio) context.devicePixelRatio = pixelRatio; },
    time:value=>{fakeNow=value;},
    renders: () => renderCount,
  };
}

function room() {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Hôte');
  simulation.addPlayer('guest', 'Invité');
  return simulation;
}

// The i18n harness mirrors test/i18n.test.mjs.
function i18nHarness(saved = null) {
  const document = {
    documentElement: { lang: 'fr' },
    querySelectorAll: () => [],
    querySelector: query => query === '#language-select' ? { value: '' } : null,
  };
  const context = vm.createContext({ document,
    localStorage: { getItem() { return saved; }, setItem() {} },
    window: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type, detail: options.detail }); } },
  });
  vm.runInContext(`${i18nSource}\nglobalThis.api={getLanguage,setLanguage,t};`, context);
  return context.api;
}

const save = (wave = 12, players = [{ name: 'Jules' }, { name: 'Léa' }]) => ({ format: 'deadwood-save', version: 1, wave, ambiance: 'family', difficulty: 'hard', savedAt: '2026-10-18T19:40:00.000Z', players });
function storage({ limit = Infinity, blocked = false } = {}) {
  const values = new Map();
  return { values, getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked || value.length > limit) throw new Error('QuotaExceededError'); values.set(key, value); } };
}

test('the lobby shows three friendly fire buttons, off selected; only the host picks', () => {
  const simulation = room(), host = clientHarness('host', { fakeNow: 0 }), guest = clientHarness('guest', { fakeNow: 0 });
  const state = simulation.snapshot();
  for (const client of [host, guest]) { client.node('lobby').hidden = false; client.update(state); }
  const buttons = client => client.node('friendly-fire-options').children;
  assert.deepEqual(buttons(host).map(button => button.textContent), ['DÉSACTIVÉ', 'RÉDUIT', 'RÉALISTE']);
  assert.equal(buttons(host).find(button => button.dataset.level === 'off').className, 'difficulty-option selected');
  assert.equal(buttons(host).find(button => button.dataset.level === 'off').attributes['aria-pressed'], 'true');
  assert.equal(host.node('advanced-summary-detail').textContent, '', 'no level in the summary while off');
  assert.equal(host.node('advanced-options').open, undefined, 'the section is never forced open');
  assert.equal(buttons(host).every(button => !button.disabled), true);
  buttons(host).find(button => button.dataset.level === 'reduced').onclick();
  assert.deepEqual(host.sent.at(-1), { type: 'friendly-fire', level: 'reduced' });
  const sentCount = host.sent.length;
  buttons(host).find(button => button.dataset.level === 'off').onclick();
  assert.equal(host.sent.length, sentCount, 'clicking the current level sends nothing');
  assert.equal(buttons(guest).every(button => button.disabled), true);
  buttons(guest).find(button => button.dataset.level === 'reduced').click();
  assert.equal(guest.sent.length, 0, 'a non-host never sends');
  assert.match(guest.node('friendly-fire-detail').textContent, /L’hôte choisit le tir ami\./);
  simulation.setFriendlyFire('host', 'reduced');
  guest.update(simulation.snapshot());
  assert.equal(buttons(guest).find(button => button.dataset.level === 'reduced').className, 'difficulty-option selected');
  assert.match(guest.node('friendly-fire-detail').textContent, /quart des dégâts/);
  assert.equal(guest.node('advanced-summary-detail').textContent, ' · Tir ami : réduit', 'the closed section still shows the level');
});

test('the results screen offers the same picker, and practice rooms hide both', () => {
  const simulation = room(), host = clientHarness('host', { fakeNow: 0 });
  const gameover = phase => { const state = simulation.snapshot(); state.phase = phase; return state; };
  host.update(gameover('gameover'));
  const buttons = host.node('friendly-fire-options-results').children;
  assert.deepEqual(buttons.map(button => button.dataset.level), ['off', 'reduced', 'full']);
  buttons.find(button => button.dataset.level === 'full').onclick();
  assert.deepEqual(host.sent.at(-1), { type: 'friendly-fire', level: 'full' });
  simulation.setFriendlyFire('host', 'full');
  host.update(gameover('gameover'));
  assert.equal(host.node('friendly-fire-options-results').children.find(button => button.dataset.level === 'full').className, 'difficulty-option selected');
  assert.equal(host.node('advanced-summary-detail-results').textContent, ' · Tir ami : réaliste');
  const practice = clientHarness('guest', { fakeNow: 0 });
  const range = gameover('lobby'); range.practice = true;
  practice.update(range);
  assert.equal(practice.node('advanced-options').hidden, true, 'no friendly fire at the range');
  const rangeOver = gameover('gameover'); rangeOver.practice = true;
  practice.update(rangeOver);
  assert.equal(practice.node('advanced-options-results').hidden, true);
});

test('the pause badge appears only when friendly fire is on and follows the language', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot());
  assert.equal(client.node('pause-friendly-fire').hidden, true);
  simulation.setFriendlyFire('host', 'full');
  client.update(simulation.snapshot());
  assert.equal(client.node('pause-friendly-fire').hidden, false);
  assert.equal(client.node('pause-friendly-fire-value').textContent, 'Réaliste');
  client.language('en');
  assert.equal(client.node('pause-friendly-fire-value').textContent, 'Realistic');
});

test('a friendly hit on the local survivor draws an arc toward the shooter and names them, throttled per shooter', () => {
  const simulation = room(); simulation.start('host');
  const guest = clientHarness('guest', { fakeNow: 0 });
  guest.update(simulation.snapshot()); guest.enter();
  const hurtBefore = guest.soundCalls.hurt;
  const hit = { event: 'hit', id: 'guest', damage: 8, absorbed: 0, armor: 0, source: 'friendly', shooterId: 'host', weapon: 'pistol', fromX: 2, fromZ: 1 };
  guest.event(hit);
  assert.equal(guest.soundCalls.hurt, hurtBefore + 1, 'the same hurt cue as a raider hit');
  assert.equal(guest.node('toast').textContent, 'Hôte t’a touché !');
  const arc = guest.friendlyArcs().find(arc => arc.raiderId === 'friendly:host');
  assert.ok(arc && arc.fromX === 2 && arc.fromZ === 1, 'a friendly shooter gets an arc of their own');
  guest.event({ event: 'join', name: 'Léa' });
  assert.equal(guest.node('toast').textContent, 'Léa a rejoint le refuge.');
  guest.event(hit);
  assert.equal(guest.node('toast').textContent, 'Léa a rejoint le refuge.', 'at most one toast per 2 s per shooter');
  guest.time(2500);
  guest.event(hit);
  assert.equal(guest.node('toast').textContent, 'Hôte t’a touché !');
  guest.time(5000);
  guest.event({ ...hit, shooterId: 'guest', weapon: 'grenade', fromX: 0, fromZ: 0 });
  assert.equal(guest.node('toast').textContent, 'Ta propre explosion t’a blessé !', "one's own blast has its own words");
  const own = guest.friendlyArcs().find(arc => arc.raiderId === 'friendly:guest');
  assert.ok(own && own.fromX === 0 && own.fromZ === 0);
});

test('the shooter sees a red skull, a red number over the teammate and a callout that varies, at most every 2.5 s', () => {
  const simulation = room(); simulation.start('host'); simulation.timeLeft = 999;
  const host = clientHarness('host', { fakeNow: 0, realCamera: true });
  const state = simulation.snapshot();
  Object.assign(state.players.find(player => player.id === 'host'), { x: 0, y: 0, z: 0 });
  Object.assign(state.players.find(player => player.id === 'guest'), { x: 0, y: 0, z: -4 });
  host.update(state); host.enter(); host.frame(0);
  // Not local for the shooter: the event arrives on the victim's id.
  const hit = { event: 'hit', id: 'guest', damage: 8.4, absorbed: 0, armor: 0, source: 'friendly', shooterId: 'host', weapon: 'pistol', fromX: 0, fromZ: 0 };
  const toastBefore = host.node('toast').textContent;
  host.event(hit);
  const marker = host.node('hit-marker'), callout = host.node('friendly-callout');
  assert.equal(marker.hidden, false); assert.equal(marker.textContent, '☠'); assert.ok(marker.classList.values.has('tier-friendly'));
  assert.equal(callout.hidden, false);
  assert.equal(host.node('friendly-callout-title').textContent, 'Hé ! C’est Invité !');
  assert.equal(host.node('friendly-callout-line').textContent, 'Ne tire pas sur tes copains !');
  assert.equal(callout.classList.values.has('downed'), false);
  assert.equal(host.node('toast').textContent, toastBefore, 'the callout replaces the old toast');
  const numbers = () => (host.node('damage-numbers').children ?? []).filter(element => element.className.includes('damage-friendly')).map(element => element.textContent);
  assert.deepEqual(numbers(), ['−8'], 'a red number over the teammate');
  // A second round within the window: the same callout, the number adds up.
  host.time(100); host.event(hit);
  assert.equal(host.node('friendly-callout-line').textContent, 'Ne tire pas sur tes copains !');
  assert.deepEqual(numbers(), ['−16']);
  // The callout leaves after its time; the next one, 2.5 s on, says something else.
  host.time(1900); host.frame(1900);
  assert.equal(callout.hidden, true);
  host.time(2600); host.event(hit);
  assert.equal(callout.hidden, false);
  assert.equal(host.node('friendly-callout-line').textContent, 'Vise les zombies, pas les copains !');
  // A zombie's marker in the same moment never hides the skull.
  host.event({ event: 'bullet-impact', id: 'host', stop: 'zombie', zombieId: 'z1', damage: 10, x: 0, y: 1, z: -6, projectileId: 'b1' });
  assert.equal(marker.textContent, '☠');
  // Downing them: at once, bigger, and no toast on top.
  host.time(2700);
  host.event({ event: 'down', id: 'guest', seconds: 25, source: 'friendly', shooterId: 'host' });
  assert.equal(host.node('friendly-callout-title').textContent, 'Tu as mis Invité à terre !');
  assert.equal(host.node('friendly-callout-line').textContent, 'Va l’aider : maintiens E à côté de Invité.');
  assert.ok(callout.classList.values.has('downed'));
  assert.equal(host.node('toast').textContent, toastBefore);
  // English follows the language.
  host.language('en');
  assert.equal(host.node('friendly-callout-title').textContent, 'You downed Invité!');
});

test('a teammate’s hit seen by a third survivor shows no skull, number or callout', () => {
  const simulation = room(); simulation.addPlayer('third', 'Tiers'); simulation.start('host');
  const third = clientHarness('third', { fakeNow: 0, realCamera: true });
  third.update(simulation.snapshot()); third.enter(); third.frame(0);
  third.event({ event: 'hit', id: 'guest', damage: 8, absorbed: 0, armor: 0, source: 'friendly', shooterId: 'host', weapon: 'pistol', fromX: 0, fromZ: 0 });
  assert.equal(third.node('friendly-callout').hidden, true);
  assert.notEqual(third.node('hit-marker').textContent, '☠');
  assert.equal((third.node('damage-numbers').children ?? []).length, 0);
});

test('a friendly down names the shooter, except a self-inflicted blast which keeps the plain words', () => {
  const simulation = room(); simulation.start('host');
  const guest = clientHarness('guest', { fakeNow: 0 }), host = clientHarness('host', { fakeNow: 0 });
  for (const client of [guest, host]) { client.update(simulation.snapshot()); client.enter(); }
  guest.event({ event: 'down', id: 'guest', seconds: 30, source: 'friendly', shooterId: 'host' });
  assert.equal(guest.node('toast').textContent, 'Tu es à terre, touché par Hôte. Appelle un coéquipier !');
  // The one who fired gets the big callout instead of a toast; anyone else the toast.
  host.event({ event: 'down', id: 'guest', seconds: 30, source: 'friendly', shooterId: 'host' });
  assert.equal(host.node('toast').textContent, '');
  assert.equal(host.node('friendly-callout-title').textContent, 'Tu as mis Invité à terre !');
  simulation.addPlayer('third', 'Tiers');
  const third = clientHarness('third', { fakeNow: 0 }); third.update(simulation.snapshot()); third.enter();
  third.event({ event: 'down', id: 'guest', seconds: 30, source: 'friendly', shooterId: 'host' });
  assert.equal(third.node('toast').textContent, 'Invité est à terre, touché par Hôte.');
  guest.event({ event: 'down', id: 'guest', seconds: 30, source: 'friendly', shooterId: 'guest' });
  assert.equal(guest.node('toast').textContent, 'Tu es à terre. Appelle un coéquipier !');
  guest.event({ event: 'down', id: 'guest', seconds: 30 });
  assert.equal(guest.node('toast').textContent, 'Tu es à terre. Appelle un coéquipier !', 'a zombie down is unchanged');
});

test('the friendly-fire event toasts every client but the host who clicked', () => {
  const guest = clientHarness('guest', { fakeNow: 0 }), host = clientHarness('host', { fakeNow: 0 });
  guest.event({ event: 'friendly-fire', id: 'host', level: 'reduced' });
  assert.equal(guest.node('toast').textContent, 'Tir ami : réduit');
  host.event({ event: 'friendly-fire', id: 'host', level: 'reduced' });
  assert.equal(host.node('toast').textContent, '', 'the host just clicked it');
  guest.language('en');
  guest.event({ event: 'friendly-fire', id: 'host', level: 'full' });
  assert.equal(guest.node('toast').textContent, 'Friendly fire: realistic');
});

test('the melee prediction hears a blow that will land on a teammate only when friendly fire is on', () => {
  // Directly: a teammate in front is a target only when passed as a survivor.
  const profile = { range: 1.8, coneAngle: 40 * Math.PI / 180, maxTargets: 1 };
  const eye = { x: 0, y: 1.6, z: 0 }, ahead = meleeDirection(0, 0), clear = () => true;
  const mate = { id: 'host', x: 0, y: 0, z: -1.2 };
  assert.equal(meleeWillLand(eye, ahead, profile, [], clear, .1), false);
  assert.equal(meleeWillLand(eye, ahead, profile, [], clear, .1, [mate]), true);
  // Through the client: the swinger's snapshot teammates are passed only when on.
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 });
  const state = simulation.snapshot();
  const self = state.players.find(player => player.id === 'guest'), other = state.players.find(player => player.id === 'host');
  Object.assign(self, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, downed: false, waiting: false, weapon: 'bat' });
  Object.assign(other, { x: 0, y: 0, z: -1.2, alive: true, downed: false, waiting: false });
  client.update(state);
  assert.equal(client.predictMelee('guest', 'bat', 'light', state.time + .05), false, 'off: identical behaviour');
  state.friendlyFire = 'reduced'; client.update(state);
  assert.equal(client.predictMelee('guest', 'bat', 'light', state.time + .05), true, 'a teammate in reach keeps the impact sound');
  other.downed = true; client.update(state);
  assert.equal(client.predictMelee('guest', 'bat', 'light', state.time + .05), false, 'a downed teammate is not a target');
});

test('save summaries carry friendly fire only when it was on, and the load list labels it', () => {
  const plain = saveSummary(save(12));
  assert.deepEqual(plain, { wave: 12, ambiance: 'family', difficulty: 'hard', players: ['Jules', 'Léa'], savedAt: '2026-10-18T19:40:00.000Z' }, 'the historical summary is unchanged');
  assert.deepEqual(saveSummary({ ...save(12), friendlyFire: 'off' }), plain, "'off' adds nothing");
  assert.deepEqual(saveSummary({ ...save(12), friendlyFire: 'weird' }), plain, 'an unknown level adds nothing');
  assert.deepEqual(saveSummary({ ...save(12), friendlyFire: 'reduced' }), { ...plain, friendlyFire: 'reduced' });
  assert.deepEqual(saveSummary({ ...save(12), friendlyFire: 'full' }), { ...plain, friendlyFire: 'full' });
  const kept = storage();
  assert.equal(keepSave(kept, { ...save(12), friendlyFire: 'full' }, { id: 'ff', now: new Date(2026, 9, 23) }), true);
  assert.equal(readSaves(kept)[0].friendlyFire, 'full');
  assert.equal(keepSave(kept, save(11), { id: 'plain', now: new Date(2026, 9, 24) }), true);
  assert.equal(Object.hasOwn(readSaves(kept).find(entry => entry.id === 'plain'), 'friendlyFire'), false, 'kept only when present');
  const entries = [
    { id: 'ff', savedAt: '2026-10-23T20:30:00.000Z', wave: 12, ambiance: 'family', difficulty: 'hard', players: ['Jules', 'Léa'], friendlyFire: 'reduced', save: { ...save(12), friendlyFire: 'reduced' } },
    { id: 'plain', savedAt: '2026-10-22T20:30:00.000Z', wave: 11, ambiance: 'family', difficulty: 'hard', players: ['Jules', 'Léa'], save: save(11) },
  ];
  const client = clientHarness('guest', { savedValues: [[SAVE_STORAGE_KEY, JSON.stringify(entries)]] });
  client.node('load-game-button').onclick();
  const labels = client.node('load-saves').children.map(item => item.children[0].textContent);
  assert.equal(labels.length, 2);
  assert.ok(labels[0].includes('Tir ami : réduit'), labels[0]);
  assert.ok(!labels[1].includes('Tir ami'), labels[1]);
});

test('every friendly fire string exists in French and English, with its placeholders', () => {
  const keys = ['advanced.title', 'friendlyFire.title', 'friendlyFire.off', 'friendlyFire.reduced', 'friendlyFire.full',
    'friendlyFire.short.reduced', 'friendlyFire.short.full', 'friendlyFire.detail.off', 'friendlyFire.detail.reduced',
    'friendlyFire.detail.full', 'friendlyFire.hostOnly', 'friendlyFire.changed', 'friendlyFire.hitBy', 'friendlyFire.hitSelf',
    'friendlyFire.calloutHit', 'friendlyFire.calloutLine0', 'friendlyFire.calloutLine1', 'friendlyFire.calloutLine2', 'friendlyFire.calloutDown', 'friendlyFire.calloutDownLine',
    'friendlyFire.downedBy', 'friendlyFire.downedSelf'];
  const api = i18nHarness(), french = {};
  for (const language of ['fr', 'en']) {
    api.setLanguage(language);
    for (const key of keys) {
      assert.notEqual(api.t(key), key, `Missing ${language}: ${key}`);
      if (language === 'fr') french[key] = api.t(key);
      else assert.notEqual(api.t(key), french[key], `${key} is translated`);
    }
  }
  assert.equal(i18nHarness().t('friendlyFire.changed', { level: 'réduit' }), 'Tir ami : réduit');
  assert.equal(i18nHarness().t('friendlyFire.hitBy', { name: 'Max' }), 'Max t’a touché !');
  const english = i18nHarness('en');
  assert.equal(english.t('friendlyFire.downedBy', { name: 'Max', shooter: 'Léa' }), 'Max is down, hit by Léa.');
  assert.equal(english.t('friendlyFire.calloutHit', { name: 'Max' }), 'Hey! That’s Max!');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<details id="advanced-options" class="advanced-options">/);
  assert.match(html, /<details id="advanced-options-results" class="advanced-options">/);
  assert.ok(html.includes('id="friendly-fire-picker"') && html.includes('id="friendly-fire-picker-results"'));
  assert.ok(html.includes('id="pause-friendly-fire"') && html.includes('data-i18n="advanced.title"') && html.includes('data-i18n="friendlyFire.title"'));
});

test('the generated online client and page carry the friendly fire UI', async () => {
  await buildOnlineClient(undefined, { check: true });
  const online = await readFile(new URL('../public/online-client.js', import.meta.url), 'utf8');
  assert.ok(online.includes('function renderFriendlyFire('));
  assert.ok(online.includes("send({ type: 'friendly-fire', level })"));
  assert.ok(online.includes('friendlyFire.downedBy') && online.includes('friendlyFire.hitBy'));
  const page = await readFile(new URL('../public/online.html', import.meta.url), 'utf8');
  assert.ok(page.includes('id="friendly-fire-picker"') && page.includes('id="pause-friendly-fire"'));
});
