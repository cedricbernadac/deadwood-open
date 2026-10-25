import { createMapContext, mapForRoomCode } from '../public/map-context.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import { importPublicModule } from './helpers/public-modules.mjs';
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
import { t as translate } from '../public/i18n.js';

// Exercise the browser client's transition handlers without a GPU or a live server.
// Rendering is stubbed; snapshots and DOM visibility remain observable.
const clientSource = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const i18nSource = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function clientHarness(id = 'guest', { savedMusic = null, storageBlocked = false, savedMusicVolume = null, savedCamera = null, cameraStorageBlocked = storageBlocked, savedController = null, savedRawMouse = null, clipboardBlocked = false, weaponMuzzle = null, href = 'http://localhost:3000', fakeNow=null, servedBuild, aimAssistFactory = createAimAssist, realCamera = false, savesBlocked = false, downloadFails = false, savedSurvivorSheet = null, savedValues = [], absentNodes = [], multiMap = false, maps, mapId = LEVEL.id, mapStorageBlocked = storageBlocked, sessionData = new Map(), windowName = '', allStorageBlocked = false } = {}) {
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
    // ready: the hospital page (HAS_SPACE) waits for its level artwork.
    createWorld: (scene, options) => { worldOptions.push(options); return { ready: Promise.resolve(true), setDoor(id, ratio, boards) { boardCalls.push({ id, ratio, boards }); }, setLanguage(language) { worldLanguages.push(language); }, update(time) { worldFrames.push(time); } }; },
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
    createFlameStream: () => { const stream = { mesh: {}, aims: [], stopped: false, disposed: false, aim(start, end, time) { this.aims.push({ start: start.clone(), end: end.clone(), time }); this.stopped = false; }, stop() { this.stopped = true; }, update: () => false, dispose() { this.disposed = true; } }; flameCalls.push(stream); return stream; },
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
      // maps: the LAN gateway's deadwood-maps tag; undefined leaves it absent, as online.html.
      querySelector: selector => selector === 'meta[name="deadwood-multi-map"]' && multiMap ? { content: 'true' }
        : selector === 'meta[name="deadwood-maps"]' && maps !== undefined ? { content: maps } : null,
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
  // #level-choice starts as in index.html; append() moves an option and remove() detaches it, as in the DOM.
  const levelChoice = node('level-choice');
  const attach = option => Object.assign(option, { remove() { levelChoice.children = levelChoice.children.filter(child => child !== option); } });
  levelChoice.children = [['cabin', 'La cabane'], ['supermarket', 'Le Dernier Panier']].map(([value, textContent]) => attach(Object.assign(node(Symbol()), { tagName: 'OPTION', value, textContent, dataset: { i18n: 'levels.' + value } })));
  levelChoice.append = (...options) => { for (const option of options) { option.remove(); levelChoice.children.push(attach(option)); } };
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

function xboxPad() {
  return { index: 0, id: 'Xbox Wireless Controller', connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
}
function controllerClient({ weapon = 'pistol', settings = {}, ...options } = {}) {
  const simulation = room(); simulation.phase = 'wave'; simulation.wave = 4;
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { weapon, ammo: WEAPONS[weapon].magazine, magazine: WEAPONS[weapon].magazine,
    reserve: 50, alive: true, downed: false, reloading: false, yaw: 0, pitch: 0 });
  const pad = xboxPad(), client = clientHarness('guest', { fakeNow: 0,
    savedController: JSON.stringify({ ...CONTROLLER_DEFAULTS, ...settings }), ...options });
  client.update(state); client.pad(pad); client.frame(0); client.enter();
  let now = 0;
  const step = (milliseconds = 16) => { now += milliseconds; client.time(now); client.frame(now); };
  const button = (action, held = true) => {
    pad.buttons[GAMEPAD_BUTTONS[action]] = { value: held ? 1 : 0, pressed: held }; step();
  };
  step(); // First neutral sample after explicit entry arms the controller edges.
  return { client, simulation, state, self, pad, step, button };
}

test('the actual Xbox client sends radial analog movement and correctly signed look without Pointer Lock', () => {
  const f = controllerClient({ settings: { aimAssist: 'off' } });
  assert.equal(f.client.controller().playing, true); assert.equal(f.client.controller().captured, true);
  f.pad.axes = [.5, -.5, .6, -.5]; f.step();
  const input = f.client.input(), aim = f.client.aim();
  assert.ok(input.forward > 0 && input.forward < 1); assert.equal(input.forward, input.strafe);
  assert.ok(Math.hypot(input.forward, input.strafe) <= 1);
  assert.ok(aim.yaw < 0, 'right stick right turns the view right in Three YXZ');
  assert.ok(aim.pitch > 0, 'right stick up raises the view');
  assert.equal(input.yaw, aim.yaw); assert.equal(input.pitch, aim.pitch);
  const before = f.client.aim(); f.client.dispatch('mousemove', { movementX: 200, movementY: 200 });
  assert.deepEqual(f.client.aim(), before, 'mouse deltas cannot alter controller aim without capture');
  f.button('sprint'); assert.equal(f.client.input().sprint, true);
  f.button('crouch'); assert.equal(f.client.input().crouch, true); assert.equal(f.client.input().sprint, false);
  f.button('crouch', false); assert.equal(f.client.input().crouch, true, 'R3 is a toggle');
  f.button('crouch'); assert.equal(f.client.input().crouch, false);
  f.button('jump'); assert.equal(f.client.input().jump, true);
  f.button('jump', false); assert.equal(f.client.input().jump, false);
});

test('Xbox RT uses the real fire path and authoritative sounds; release and X reload stop the trigger', () => {
  const f = controllerClient({ weapon: 'assault' }), ammo = f.self.ammo;
  f.button('fire');
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, 1);
  assert.equal(f.client.soundCalls.shoot, 0, 'LAN never invents a shot before the server');
  f.client.event({ event: 'shot', id: 'guest', weapon: 'assault', hits: 0, time: .04, pellets: [] });
  assert.equal(f.client.soundCalls.shoot, 1); assert.equal(f.client.soundCalls.shotOptions.at(-1).held, true);
  f.step(180); assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, 2);
  f.button('fire', false); const count = f.client.sent.filter(message => message.type === 'shoot').length;
  f.step(200); assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, count);
  assert.equal(f.client.activity().firing, false); assert.ok(f.client.soundCalls.releases.length > 0);
  f.button('reload'); assert.equal(f.client.sent.at(-1).type, 'reload');
  assert.equal(f.client.soundCalls.reload, 0, 'reload audio waits for its acknowledgement');
  f.step(200); assert.equal(f.client.sent.filter(message => message.type === 'reload').length, 1, 'holding X sends one reload');
  assert.equal(f.self.ammo, ammo, 'all local presentation keeps authoritative ammo untouched');
});

test('Xbox sniper caps normal and strong assistance at Light only while scoped', () => {
  for (const level of ['off', 'light', 'normal', 'strong']) {
    const samples = [];
    const f = controllerClient({ weapon: 'sniper', settings: { aimAssist: level }, aimAssistFactory: () => {
      const real = createAimAssist();
      return { reset: () => real.reset(), update(args) { samples.push(args.level); return real.update(args); } };
    } });
    assert.equal(samples.at(-1), level);
    f.button('alternate');
    assert.equal(samples.at(-1), ['normal', 'strong'].includes(level) ? 'light' : level);
    assert.equal(f.client.node('gamepad-aim-assist').value, level, 'scope must not rewrite the saved preference');
    f.button('alternate', false);
    assert.equal(samples.at(-1), level, 'unscoping restores the selected level');
  }
});

test('Xbox LT scopes the sniper but starts exactly one real heavy melee attack with a melee weapon', () => {
  const sniper = controllerClient({ weapon: 'sniper', settings: { aimAssist: 'off' } });
  sniper.button('alternate'); assert.equal(sniper.client.aim().scoped, true);
  sniper.pad.axes[2] = 1; const before = sniper.client.aim().yaw; sniper.step();
  const scopedStep = Math.abs(sniper.client.aim().yaw - before);
  sniper.button('alternate', false); assert.equal(sniper.client.aim().scoped, false);
  const beforeNormal = sniper.client.aim().yaw; sniper.step();
  assert.ok(Math.abs(sniper.client.aim().yaw - beforeNormal) > scopedStep * 2, 'zoom slows only look sensitivity');
  assert.equal(sniper.client.sent.filter(message => message.type === 'shoot').length, 0, 'LT scope never fires');
  const melee = controllerClient({ weapon: 'hammer' });
  melee.button('alternate');
  assert.deepEqual(melee.client.sent.at(-1), { type: 'shoot', attack: 'heavy' });
  melee.step(50); melee.step(50);
  assert.equal(melee.client.sent.filter(message => message.type === 'shoot').length, 1, 'held LT does not repeat a heavy swing');
  assert.equal(melee.client.aim().scoped, false); assert.equal(melee.client.soundCalls.shoot, 0);
});

for (const interruption of ['menu', 'blur', 'hidden', 'disconnect', 'team-pause']) test(`Xbox ${interruption} clears RT, aim and movement and requires an explicit resume plus trigger release`, () => {
  const f = controllerClient({ weapon: 'assault' }); f.pad.axes[1] = -1; f.button('fire');
  assert.equal(f.client.activity().firing, true);
  if (interruption === 'menu') f.button('menu');
  if (interruption === 'blur') f.client.dispatchWindow('blur');
  if (interruption === 'hidden') { f.client.hidden(true); f.client.dispatch('visibilitychange'); }
  if (interruption === 'disconnect') { f.client.pad(null); f.step(); }
  if (interruption === 'team-pause') { f.state.paused = true; f.client.update(f.state); }
  assert.equal(f.client.activity().firing, false); assert.equal(f.client.input().forward, 0);
  assert.equal(f.client.input().sprint, false); assert.equal(f.client.aim().scoped, false);
  const count = f.client.sent.filter(message => message.type === 'shoot').length, aim = f.client.aim();
  f.pad.axes[2] = 1;
  if (interruption === 'blur') f.client.dispatchWindow('focus');
  if (interruption === 'hidden') { f.client.hidden(false); f.client.dispatch('visibilitychange'); }
  if (interruption === 'disconnect') f.client.pad(f.pad);
  if (interruption === 'team-pause') { f.state.paused = false; f.client.update(f.state); }
  f.step(200);
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, count, 'returning focus/device never resumes held fire');
  assert.deepEqual(f.client.aim(), aim, 'menus consume input without turning gameplay aim');
  f.client.node('resume-button').click(); f.step(200);
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, count, 'a trigger held across resume remains blocked');
  f.button('fire', false); f.button('fire');
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, count + 1);
});

test('mouse mode preserves Pointer Lock keyboard/mouse input despite a connected Xbox controller', () => {
  const f = controllerClient({ settings: { mode: 'mouse' } }); f.client.lock();
  assert.equal(f.client.controller().playing, false);
  f.pad.axes = [1, -1, 1, 1]; f.button('fire');
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, 0);
  assert.equal(f.client.input().forward, 0); assert.equal(f.client.input().strafe, 0);
  const before = f.client.aim(); f.client.dispatch('mousemove', { movementX: 10, movementY: -5 });
  assert.equal(f.client.aim().yaw, before.yaw - .018); assert.equal(f.client.aim().pitch, before.pitch + .009);
  f.client.dispatch('keydown', { code: 'KeyW' }); assert.equal(f.client.input().forward, 1);
  f.client.dispatch('mousedown', { button: 0 }); f.step(200);
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, 1);
});

test('controller settings synchronize startup/pause and persist locally without a gameplay command', () => {
  const client = clientHarness('guest', { fakeNow: 0 });
  client.node('input-mode-start').onchange({ target: { value: 'gamepad' } });
  client.node('gamepad-sensitivity').oninput({ target: { value: '999' } });
  client.node('gamepad-deadzone').oninput({ target: { value: '-1' } });
  client.node('gamepad-aim-assist').onchange({ target: { value: 'light' } });
  client.node('gamepad-invert-y').onchange({ target: { checked: true } });
  assert.equal(client.node('input-mode').value, 'gamepad'); assert.equal(client.node('input-mode-start').value, 'gamepad');
  assert.equal(client.node('gamepad-sensitivity').value, '360'); assert.equal(client.node('gamepad-deadzone').value, '0.05');
  const saved = JSON.parse(client.storedValues.get(CONTROLLER_SETTINGS_KEY));
  assert.deepEqual(saved, { mode: 'gamepad', sensitivity: 360, deadzone: .05, aimAssist: 'light', invertY: true, rumble: 'normal' });
  assert.equal(client.sent.length, 0);
  const restored = clientHarness('guest', { savedController: JSON.stringify(saved) });
  assert.equal(restored.node('input-mode-start').value, 'gamepad'); assert.equal(restored.node('gamepad-invert-y').checked, true);
  client.language('en'); assert.equal(client.node('gamepad-sensitivity-value').textContent, '360°/s');
});

test('late joining displays readiness, denies Xbox gameplay and creates no waiting teammate avatar', () => {
  const f = controllerClient();
  Object.assign(f.self, { waiting: true, ready: false, alive: false });
  f.client.update(f.state); f.pad.axes = [1, -1, 1, -1];
  const count = f.client.sent.length, aim = f.client.aim();
  f.button('fire'); f.button('alternate'); f.button('reload'); f.client.enter();
  assert.equal(f.client.node('admission-panel').hidden, false); assert.equal(f.client.node('lobby').hidden, false);
  assert.equal(f.client.node('hud').hidden, true); assert.equal(f.client.input().forward, 0);
  assert.deepEqual(f.client.aim(), aim); assert.equal(f.client.sent.length, count, 'waiting controls cannot move, shoot or reload');
  f.client.node('admission-ready').click(); assert.deepEqual(f.client.sent.at(-1), { type: 'ready' });
  f.self.ready = true; f.client.update(f.state);
  assert.equal(f.client.node('admission-ready').disabled, true);
  const readyCount = f.client.sent.length; f.client.node('admission-ready').click(); assert.equal(f.client.sent.length, readyCount);
  const observer = clientHarness('host'); observer.update(f.state);
  assert.equal(observer.avatars().includes('guest'), false);
  const waitingRow = observer.node('team-list').children.find(row => row.children[1].textContent.includes('Invité'));
  assert.doesNotMatch(waitingRow.children[2].textContent, /K\.O\.|élimin|mort|dead/i);
  assert.equal(waitingRow.className.includes('downed'), false, 'readiness does not present a waiting teammate as a casualty');
  const admitted = structuredClone(f.state);
  Object.assign(admitted.players.find(player => player.id === 'guest'), { waiting: false, ready: false, alive: true, yaw: .7, pitch: -.2 }); f.client.update(admitted);
  assert.equal(f.client.node('admission-panel').hidden, true); assert.equal(f.client.aim().yaw, .7);
  f.client.enter(); f.step(); f.button('fire', false); f.button('fire');
  assert.ok(f.client.sent.some(message => message.type === 'shoot'), 'admitted player can explicitly enter and play');
});

test('pause room code and invite are copied only on click and remain selectable when clipboard fails', async () => {
  for (const clipboardBlocked of [false, true]) {
    const f = controllerClient({ clipboardBlocked });
    assert.equal(f.client.clipboardWrites.length, 0); f.client.node('hud-room').click();
    assert.equal(f.client.node('pause').hidden, false); assert.equal(f.client.node('room-share-panel').hidden, false);
    assert.equal(f.client.node('pause-room-code').textContent, 'ABC123');
    assert.equal(f.client.node('room-share-address').value, 'http://localhost:3000/?room=ABC123');
    await f.client.node('copy-room-code').onclick(); await f.client.node('copy-room-link').onclick();
    if (clipboardBlocked) {
      assert.equal(f.client.clipboardWrites.length, 0); assert.equal(f.client.activeElement(), f.client.node('room-share-address'));
      assert.equal(f.client.node('room-share-address').selected, true);
      assert.match(f.client.node('room-share-status').textContent, /Sélectionne/);
    } else assert.deepEqual(f.client.clipboardWrites, ['ABC123', 'http://localhost:3000/?room=ABC123']);
    f.client.language('en');
    assert.match(f.client.node('room-share-status').textContent, clipboardBlocked ? /Select/ : /copied/);
  }
});

test('Xbox menus use real DOM navigation, A activates a focused button and B resumes explicitly', () => {
  const f = controllerClient(); f.button('menu'); f.button('menu', false);
  const resume = f.client.node('resume-button'), copy = f.client.node('copy-room-code');
  f.client.node('pause').controls = [copy, resume];
  assert.equal(f.client.activeElement(), resume);
  f.button('radar'); assert.equal(f.client.activeElement(), copy);
  f.button('radar', false); f.button('drop'); assert.equal(f.client.activeElement(), resume);
  f.button('drop', false); f.button('jump'); assert.equal(f.client.node('pause').hidden, true);
  assert.equal(f.client.controller().playing, true);
  f.button('jump', false); f.button('menu'); f.button('menu', false);
  f.button('umbrella'); assert.equal(f.client.node('pause').hidden, true);
  assert.equal(f.client.sent.some(message => message.type === 'umbrella'), false, 'B in a menu never toggles the gameplay umbrella');
});

test('Xbox Y and D-pad cycle the four authoritative backpack slots, while LB and down request finite grenade/drop actions', () => {
  const f = controllerClient();
  Object.assign(f.self, { backpack: true, weaponSlots: 4, grenades: 1,
    ownedWeapons: ['pistol', 'assault', 'rifle', 'hammer'],
    weapons: ['pistol', 'assault', 'rifle', 'hammer'].map(weapon => ({ weapon, ammo: 1, reserve: 0 })) });
  f.client.update(f.state); f.button('cycle');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'weapon').at(-1), { type: 'weapon', weapon: 'assault' });
  f.step(300); assert.equal(f.client.sent.filter(message => message.type === 'weapon').length, 1, 'held Y never cycles repeatedly');
  f.button('cycle', false); f.button('previous');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'weapon').at(-1), { type: 'weapon', weapon: 'hammer' });
  f.button('previous', false); f.button('next');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'weapon').at(-1), { type: 'weapon', weapon: 'assault' });
  assert.equal(f.self.weapon, 'pistol', 'weapon selection waits for a server snapshot');
  f.button('grenade'); f.step(300);
  assert.equal(f.client.sent.filter(message => message.type === 'grenade').length, 1); assert.equal(f.self.grenades, 1);
  f.button('grenade', false); f.self.grenades = 0; f.button('grenade');
  assert.equal(f.client.sent.filter(message => message.type === 'grenade').length, 1, 'an empty grenade stock sends nothing');
  f.button('drop'); f.step(300);
  assert.equal(f.client.sent.filter(message => message.type === 'drop-weapon').length, 1);
});

test('Xbox B toggles the expedition umbrella and D-pad up drops coins once a radar is carried', () => {
  const f = controllerClient(); f.state.expedition = { enabled: true };
  f.self.umbrella = { open: false, durability: 100 }; f.client.update(f.state);
  f.button('umbrella');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'umbrella').at(-1), { type: 'umbrella', open: true });
  assert.equal(f.self.umbrella.open, false);
  f.self.umbrella.open = true; f.client.update(f.state); f.button('fire');
  assert.equal(f.client.sent.filter(message => message.type === 'shoot').length, 0, 'open umbrella occupies the shooting hand');
  f.button('umbrella', false); f.button('umbrella');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'umbrella').at(-1), { type: 'umbrella', open: false });
  f.self.umbrella.open = false; f.self.points = 500; f.self.bonus = { radar: 1 }; f.client.update(f.state); f.button('radar');
  assert.equal(f.client.sent.filter(message => message.type === 'radar-deploy').length, 0, 'the personal radar deploys nothing');
  assert.equal(f.client.sent.filter(message => message.type === 'drop-coins').length, 1, 'D-pad up falls through to a coin gift');
});

test('holding Xbox RB through an acknowledged rack replacement cannot reclaim the newly dropped weapon', () => {
  const events = [], simulation = new RoomSimulation('ABC123', { onEvent: event => events.push(event) });
  simulation.addPlayer('host'); const player = simulation.addPlayer('guest'); simulation.start('host');
  Object.assign(simulation, { phase: 'wave', wave: 12, toSpawn: 1, spawnTimer: 999 });
  const rack = ARMORY.find(crate => crate.weapon === 'shotgun');
  Object.assign(player, { x: rack.x + Math.sin(rack.facing) * 1.1, y: rack.y,
    z: rack.z + Math.cos(rack.facing) * 1.1, points: rack.price, weapon: 'rifle',
    inventory: { pistol: { ammo: 3, reserve: 4 }, rifle: { ammo: 2, reserve: 7 } } });
  player.issuedWeapons.add('rifle');
  const client = clientHarness('guest', { fakeNow: 0 }), pad = xboxPad();
  client.update(simulation.snapshot()); client.pad(pad); client.frame(0); client.enter(); client.frame(16);
  pad.buttons[GAMEPAD_BUTTONS.interact] = { value: 1, pressed: true }; client.time(32); client.frame(32);
  assert.equal(client.sent.filter(message => message.type === 'interact').length, 1);
  events.length = 0; assert.equal(simulation.interact('guest'), true);
  for (const event of events) client.event(event);
  client.update(simulation.snapshot()); assert.equal(player.weapon, 'shotgun');
  for (const now of [700, 1400, 2100]) { client.time(now); client.frame(now); }
  assert.equal(client.sent.filter(message => message.type === 'interact').length, 1);
  pad.buttons[GAMEPAD_BUTTONS.interact] = { value: 0, pressed: false }; client.frame(2116);
  pad.buttons[GAMEPAD_BUTTONS.interact] = { value: 1, pressed: true }; client.frame(2132);
  assert.equal(client.sent.filter(message => message.type === 'interact').length, 2, 'release and a fresh press allow the next exchange');
});

test('the range creates a fresh practice room even from Join and enters only after an authoritative practice state', () => {
  const client = clientHarness('guest', { href: 'http://localhost:3000/?practice=1' });
  assert.equal(client.sockets.length, 0, 'a practice link never joins without a click');
  client.node('join-tab').onclick(); client.node('room-code').value = 'bad';
  client.node('practice-button').onclick();
  assert.equal(client.node('practice-button').disabled, true);
  const socket = client.sockets.at(-1); socket.emit('open');
  const join = client.sent.at(-1);
  assert.equal(join.practice, true); assert.equal(join.type, 'join'); assert.equal(join.weapon, 'pistol');
  assert.equal(Object.hasOwn(join, 'room'), false, 'practice must not mutate the room entered in Join');
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'TRY123', practice: true }) });
  assert.equal(client.soundCalls.unlocks, 0, 'welcome alone has no usable targets or inventory');
  const simulation = new RoomSimulation('TRY123', { practice: true }); simulation.addPlayer('guest', 'Invité');
  socket.emit('message', { data: JSON.stringify(simulation.snapshot()) });
  assert.equal(client.node('hud').hidden, false); assert.equal(client.node('lobby').hidden, true);
  assert.equal(client.soundCalls.unlocks, 1); assert.equal(client.node('practice-controls').hidden, false);
  assert.equal(client.gunType(), 'assault'); assert.match(client.node('weapon-slot-2').textContent, /LANCE-ROQUETTES/);
  assert.equal(client.node('phase-label').textContent, 'STAND D’ESSAI');
  assert.equal(client.node('wave-number').textContent, 'INVULNÉRABLE');
  assert.match(client.node('wave-details').textContent, /5 cibles.*Échap/);
  assert.equal(client.node('practice-weapon').children.length, Object.keys(WEAPONS).length);
  const url = new URL(client.replacedUrls.at(-1)); assert.equal(url.searchParams.get('practice'), '1'); assert.equal(url.searchParams.has('room'), false);
  assert.equal(client.node('practice-button').disabled, false);
});

test('range controls use acknowledged server actions, preserve two real stocks and translate with the HUD', () => {
  const client = clientHarness(), simulation = new RoomSimulation('TRY123', { practice: true }); simulation.addPlayer('guest', 'Invité');
  client.update(simulation.snapshot()); client.enter(); client.pause();
  client.node('practice-flamethrower').onclick();
  let message = client.sent.at(-1);
  assert.deepEqual(message, { type: 'practice', action: 'weapon', weapon: 'flamethrower' });
  assert.equal(client.gunType(), 'assault', 'no local grant before server confirmation');
  assert.equal(client.node('practice-status').textContent, '');
  assert.equal(simulation.practiceAction('guest', message), true); client.update(simulation.snapshot());
  assert.equal(client.gunType(), 'flamethrower');
  assert.match(client.node('weapon-slot-2').textContent, /LANCE-ROQUETTES/);
  client.event({ event: 'practice', id: 'guest', action: 'weapon', weapon: 'flamethrower' });
  assert.equal(client.node('practice-status').textContent, 'LANCE-FLAMMES équipée.');
  assert.equal(client.node('practice-weapon').value, 'flamethrower', 'quick selection updates the dropdown after the server acknowledgement');
  client.language('en');
  assert.equal(client.node('phase-label').textContent, 'PRACTICE RANGE');
  assert.equal(client.node('wave-number').textContent, 'INVULNERABLE');
  assert.equal(client.node('pause-title').textContent, 'PRACTICE RANGE');
  assert.equal(client.node('practice-status').textContent, 'FLAMETHROWER equipped.');
  assert.match(client.node('practice-weapon').children.find(option => option.value === 'rifle').textContent, /MACHINE GUN/);
  const player = simulation.players.get('guest'); player.inventory.flamethrower.ammo = 1; player.inventory.flamethrower.reserve = 0;
  simulation.time += .3; client.update(simulation.snapshot());
  client.node('practice-refill').onclick(); message = client.sent.at(-1);
  assert.deepEqual(message, { type: 'practice', action: 'refill' });
  assert.equal(client.node('ammo-value').textContent, 1);
  assert.equal(simulation.practiceAction('guest', message), true); client.update(simulation.snapshot());
  assert.equal(client.node('ammo-value').textContent, WEAPONS.flamethrower.magazine);
  client.node('practice-targets').onclick(); assert.deepEqual(client.sent.at(-1), { type: 'practice', action: 'targets' });
  client.node('practice-weapon').value = 'smg'; client.node('practice-equip').onclick();
  assert.deepEqual(client.sent.at(-1), { type: 'practice', action: 'weapon', weapon: 'smg' });
  client.leave(); const count = client.sent.length; client.node('practice-rocket').onclick(); assert.equal(client.sent.length, count);
  assert.equal(client.node('practice-controls').hidden, true);
  assert.doesNotThrow(()=>client.language('fr'),'switching language after leaving must not read a destroyed snapshot');
  assert.equal(client.node('hud').hidden,true);assert.equal(client.node('practice-controls').hidden,true);
});

test('leaving a paused night reaches the home menu when the optional radar controls are absent', () => {
  const simulation = room(); simulation.start('host');
  const client = clientHarness('guest', { absentNodes: ['radar-controls'] });
  client.update(simulation.snapshot()); client.enter(); client.pause();
  assert.equal(client.node('radar-controls'), null, 'the production page has no radar-controls element');
  assert.equal(client.node('hud').hidden, false); assert.equal(client.node('pause').hidden, false);
  assert.equal(client.node('menu').hidden, true);
  assert.doesNotThrow(() => client.node('leave-game').click());
  assert.equal(client.node('menu').hidden, false);
  for (const id of ['hud', 'pause', 'lobby', 'gameover']) assert.equal(client.node(id).hidden, true, id);
  assert.equal(client.soundCalls.stops, 1);
  client.connect(); client.sockets.at(-1).emit('open');
  assert.equal(client.sent.at(-1).type, 'join', 'another room can be opened after quitting');
});

test('leaving the range clears pending entry, rejects late socket states and keeps normal games unchanged', () => {
  const client = clientHarness(); client.node('practice-button').onclick(); const previous = client.sockets.at(-1);
  client.leave(); client.node('create-tab').onclick(); client.connect(); const normal = client.sockets.at(-1); normal.emit('open');
  assert.equal(Object.hasOwn(client.sent.at(-1), 'practice'), false);
  previous.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'OLD123', practice: true }) });
  const practice = new RoomSimulation('OLD123', { practice: true }); practice.addPlayer('guest', 'Invité');
  previous.emit('message', { data: JSON.stringify(practice.snapshot()) });
  assert.equal(client.soundCalls.unlocks, 0);
  normal.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123' }) });
  normal.emit('message', { data: JSON.stringify(room().snapshot()) });
  assert.equal(client.node('hud').hidden, true); assert.equal(client.node('lobby').hidden, false);
  assert.equal(client.node('practice-controls').hidden, true); assert.equal(client.node('wave-number').textContent, '01/20');
  client.enter(); const sent = client.sent.length;
  for (const id of ['practice-rocket', 'practice-refill', 'practice-targets', 'practice-equip']) client.node(id).onclick();
  assert.equal(client.sent.length, sent, 'normal rooms never send practice actions');
});

test('home and pause share a local music choice, with the owner\'s pick as default and no room message', () => {
  const client = clientHarness();
  assert.equal(client.node('music-theme').value, DEFAULT_MUSIC_THEME);
  assert.equal(client.node('pause-music-theme').value, DEFAULT_MUSIC_THEME);
  for (const [id, value] of [['music-theme', 'tactical-a'], ['pause-music-theme', 'tactical-b']]) {
    client.node(id).onchange({ target: { value } });
    assert.equal(client.node('music-theme').value, value);
    assert.equal(client.node('pause-music-theme').value, value);
  }
  assert.deepEqual(client.musicWrites, [['deadwood-music-theme', 'tactical-a'], ['deadwood-music-theme', 'tactical-b']]);
  assert.equal(client.sent.length, 0);
  assert.equal(client.soundCalls.unlocks, 0, 'selecting music must not bypass a listening activation');
  client.language('en'); assert.equal(client.node('music-theme').value, 'tactical-b');
  for (const value of ['bad', 'original']) client.node('music-theme').onchange({ target: { value } });
  assert.equal(client.node('music-theme').value, 'tactical-b');
  assert.equal(client.musicWrites.length, 2, 'the removed original is refused like any unknown value');
  const restored = clientHarness('guest', { savedMusic: 'tactical-a' });
  assert.equal(restored.node('music-theme').value, 'tactical-a');
  const former = clientHarness('guest', { savedMusic: 'original' });
  assert.equal(former.node('music-theme').value, DEFAULT_MUSIC_THEME, 'a saved original now opens on the default');
  assert.equal(former.node('pause-music-theme').value, DEFAULT_MUSIC_THEME);
  const blocked = clientHarness('guest', { storageBlocked: true });
  assert.equal(blocked.node('music-theme').value, DEFAULT_MUSIC_THEME);
  assert.doesNotThrow(() => blocked.node('music-theme').onchange({ target: { value: 'tactical-a' } }));
  assert.equal(blocked.node('pause-music-theme').value, 'tactical-a');
});

test('the pause menu music volume applies at startup, persists per browser and survives blocked storage', () => {
  const client = clientHarness();
  assert.equal(client.node('music-volume').value, '1', 'no saved level: the original mix');
  assert.deepEqual(client.soundCalls.musicVolumes, [1], 'applied to the engine at startup');
  client.node('music-volume').oninput({ target: { value: '0.35' } });
  assert.equal(client.soundCalls.musicVolumes.at(-1), .35);
  assert.deepEqual(client.musicVolumeWrites, [['deadwood.musicVolume', '0.35']]);
  assert.equal(client.sent.length, 0, 'a personal listening level never reaches the room');
  const restored = clientHarness('guest', { savedMusicVolume: '0.2' });
  assert.equal(restored.node('music-volume').value, '0.2');
  assert.deepEqual(restored.soundCalls.musicVolumes, [.2]);
  const blocked = clientHarness('guest', { storageBlocked: true });
  assert.equal(blocked.node('music-volume').value, '1');
  assert.doesNotThrow(() => blocked.node('music-volume').oninput({ target: { value: '0.5' } }));
  assert.equal(blocked.soundCalls.musicVolumes.at(-1), .5, 'a blocked storage still lets the slider work');
  assert.equal(blocked.musicVolumeWrites.length, 0);
});

test('camera smoothing controls apply immediately, persist personally and reset without a room command', () => {
  const client = clientHarness(), simulation = room();
  client.update(simulation.snapshot()); client.enter(); client.pause();
  const authorityBefore = JSON.stringify(simulation.snapshot()), aimBefore = client.aim(), messagesBefore = client.sent.length;
  assert.deepEqual(normalizeCameraSmoothing(client.cameraSettings()), CAMERA_SMOOTHING_DEFAULTS);
  assert.equal(client.node('camera-height-smoothing').value, '45');
  assert.equal(client.node('camera-recoil-smoothing-value').textContent, '31 ms');
  client.node('camera-height-smoothing').oninput({ target: { value: '0' } });
  client.node('camera-recoil-smoothing').oninput({ target: { value: '100' } });
  assert.deepEqual(normalizeCameraSmoothing(client.cameraSettings()), { heightMs: 0, recoilMs: 100 });
  assert.equal(client.node('camera-height-smoothing-value').textContent, '0 ms');
  assert.equal(client.node('camera-recoil-smoothing-value').textContent, '100 ms');
  assert.equal(client.cameraWrites.length, 2);
  assert.equal(client.cameraWrites.at(-1)[0], CAMERA_SMOOTHING_KEY);
  assert.deepEqual(JSON.parse(client.cameraWrites.at(-1)[1]), { heightMs: 0, recoilMs: 100 });
  assert.equal(client.sent.length, messagesBefore, 'personal camera controls send no multiplayer command');
  assert.deepEqual(client.aim(), aimBefore, 'adjusting smoothing never changes mouse aim or scope');
  assert.equal(JSON.stringify(simulation.snapshot()), authorityBefore, 'camera preferences cannot change gameplay state');
  const restored = clientHarness('guest', { savedCamera: client.cameraWrites.at(-1)[1] });
  assert.deepEqual(normalizeCameraSmoothing(restored.cameraSettings()), { heightMs: 0, recoilMs: 100 });
  client.language('en');
  assert.equal(client.node('camera-height-smoothing-value').textContent, '0 ms');
  client.leave();
  assert.deepEqual(normalizeCameraSmoothing(client.cameraSettings()), { heightMs: 0, recoilMs: 100 }, 'leaving a room keeps personal preferences');
  client.node('camera-smoothing-reset').onclick();
  assert.deepEqual(normalizeCameraSmoothing(client.cameraSettings()), CAMERA_SMOOTHING_DEFAULTS);
  assert.equal(client.node('camera-height-smoothing-value').textContent, '45 ms');
  assert.equal(client.node('camera-recoil-smoothing').value, '31');
  assert.deepEqual(JSON.parse(client.cameraWrites.at(-1)[1]), CAMERA_SMOOTHING_DEFAULTS);
});

test('graphics quality preset reaches the world, render measurement follows the game state and the pause menu persists the choice', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 });
  assert.equal(client.worldOptions.length, 1);
  assert.deepEqual({ ...client.worldOptions[0] }, { quality: { ...resolveGraphicsPreset('auto', {}) } }, 'createWorld receives the resolved graphics preset');
  assert.equal(client.node('graphics-quality').value, 'auto', 'the select shows the stored choice at startup');
  assert.equal(client.node('graphics-quality-status').textContent, 'Actuel : moyenne (auto)');
  simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave';
  client.update(state); client.enter(); client.lock();
  let now = 0;
  const step = (milliseconds = 16) => { now += milliseconds; client.time(now); client.frame(now); };
  step();
  assert.equal(client.graphicsRenderCalls.at(-1).measure, true, 'in game, frames feed the auto pixel-ratio governor');
  state.paused = true; client.update(state); step();
  assert.equal(client.graphicsRenderCalls.at(-1).measure, false, 'the paused branch renders without measuring');
  state.paused = false; client.update(state); step();
  assert.equal(client.graphicsRenderCalls.at(-1).measure, true, 'measuring resumes with the game');
  const select = client.node('graphics-quality');
  select.value = 'low';
  select.dispatchEvent({ type: 'change' });
  assert.deepEqual(client.graphicsChoiceCalls, ['low'], 'changing the select calls graphics.setChoice');
  const status = client.node('graphics-quality-status').textContent;
  assert.ok(status.includes('Actuel : moyenne'), status);
  assert.ok(status.includes('Les ombres et le décor changeront au prochain chargement de la page.'), status);
  client.language('en');
  const english = client.node('graphics-quality-status').textContent;
  assert.ok(english.includes('Current: medium'), english);
  assert.ok(english.includes('Shadows and scenery will change the next time the page loads.'), english);
  client.language('fr');
  assert.ok(client.node('graphics-quality-status').textContent.includes('Actuel : moyenne'));
});

test('corrupt or blocked camera storage cannot prevent play, and control values stay bounded', () => {
  for (const savedCamera of [null, '', '{broken', 'null', '[]', '42', '{"heightMs":"100","recoilMs":null}']) {
    const client = clientHarness('guest', { savedCamera });
    assert.deepEqual(normalizeCameraSmoothing(client.cameraSettings()), CAMERA_SMOOTHING_DEFAULTS, String(savedCamera));
    assert.equal(client.node('camera-height-smoothing').value, '45');
  }
  const bounded = clientHarness('guest', { savedCamera: '{"heightMs":999,"recoilMs":-1,"other":123}' });
  assert.deepEqual(normalizeCameraSmoothing(bounded.cameraSettings()), { heightMs: 150, recoilMs: 0 });
  bounded.node('camera-height-smoothing').oninput({ target: { value: 'not-a-number' } });
  assert.deepEqual(normalizeCameraSmoothing(bounded.cameraSettings()), { heightMs: 45, recoilMs: 0 });
  bounded.node('camera-recoil-smoothing').oninput({ target: { value: '999' } });
  assert.equal(bounded.node('camera-recoil-smoothing-value').textContent, '100 ms');
  const blocked = clientHarness('guest', { cameraStorageBlocked: true });
  assert.doesNotThrow(() => blocked.node('camera-height-smoothing').oninput({ target: { value: '80' } }));
  assert.deepEqual(normalizeCameraSmoothing(blocked.cameraSettings()), { heightMs: 80, recoilMs: 31 });
  assert.doesNotThrow(() => blocked.node('camera-smoothing-reset').onclick());
  blocked.update(room().snapshot()); blocked.enter(); blocked.lock();
  assert.equal(blocked.node('hud').hidden, false, 'blocked persistence never prevents entering the game');
  assert.deepEqual(normalizeCameraSmoothing(blocked.cameraSettings()), CAMERA_SMOOTHING_DEFAULTS);
});

function katanaRange({fakeNow=0}={}){
  const client=clientHarness('guest',{fakeNow}),simulation=new RoomSimulation('KATANA',{practice:true});simulation.addPlayer('guest','Invité');
  simulation.practiceAction('guest',{action:'weapon',weapon:'katana'});simulation.time=.3;
  const player=simulation.players.get('guest');player.z=.1;
  client.update(simulation.snapshot());client.enter();client.lock();
  const events=[];simulation.onEvent=event=>{events.push(event);client.event(event);};
  return {client,simulation,player,events};
}

test('overlapping west-rack hints and E purchases choose the same nearest bat or rifle', () => {
  for (const weapon of ['bat', 'rifle']) {
    const simulation = room(), client = clientHarness(); simulation.start('host');
    const player = simulation.players.get('guest'), rack = ARMORY.find(item => item.weapon === weapon);
    simulation.wave = rack.unlockWave;
    Object.assign(player, { x: -7.2, y: 0, z: rack.z, points: rack.price + 120 });
    client.update(simulation.snapshot()); client.enter(); client.lock(); client.update(simulation.snapshot());
    assert.equal(client.node('interaction').hidden, false);
    assert.match(client.node('interaction-text').textContent, weapon === 'bat' ? /Acheter batte en bois/ : /Acheter mitrailleuse/);
    client.dispatch('keydown', { code: 'KeyE', repeat: false });
    assert.deepEqual(client.sent.at(-1), { type: 'interact' });
    assert.equal(simulation.interact('guest'), true); assert.equal(player.weapon, weapon);
    assert.equal(player.points, 120);
  }
});

test('a right click starts one real heavy cut, uses its numeric server id and never creates a bullet or muzzle flash',()=>{
  const {client,simulation,events}=katanaRange();
  let prevented=0;
  client.dispatch('contextmenu',{preventDefault(){prevented++;}});assert.equal(prevented,1);
  client.dispatch('mousedown',{button:2,preventDefault(){prevented++;}});
  const request=client.sent.at(-1);assert.deepEqual(request,{type:'shoot',attack:'heavy'});
  assert.equal(simulation.shoot('guest',0,request.attack),true);
  const started=events.find(event=>event.event==='melee-start');assert.equal(typeof started.attackId,'number');
  assert.equal(client.soundCalls.melee.length,1);assert.equal(client.soundCalls.melee[0].attack,'heavy');
  client.event(started);assert.equal(client.soundCalls.melee.length,1,'the same start is audible once');
  client.time(700);client.frame(700);assert.equal(client.meleeCalls.at(-1).windup,.7);
  simulation.time+=MELEE.heavy.windup;simulation.updateMelee();client.update(simulation.snapshot());
  const hit=events.find(event=>event.event==='melee-hit');assert.ok(hit.hits>0);assert.equal(hit.attackId,started.attackId);
  assert.equal(client.soundCalls.hit,1);assert.equal(client.soundCalls.shoot,0);assert.equal(client.tracerCalls.length,0);
  simulation.time+=2;client.update(simulation.snapshot());client.time(3000);client.frame(3000);
  client.dispatch('mousedown',{button:2,preventDefault(){}});client.frame(3100);
  assert.equal(client.sent.filter(item=>item.type==='shoot').length,1,'holding right cannot repeat after recovery');
  client.dispatch('mouseup',{button:2});client.dispatch('mousedown',{button:2,preventDefault(){}});
  assert.equal(client.sent.filter(item=>item.type==='shoot').length,2,'release and another click can start another heavy cut');
});

test('held left click repeats light cuts with authoritative recovery, while R and ammo HUD are irrelevant',()=>{
  const {client,simulation}=katanaRange();
  client.dispatch('mousedown',{button:0});let request=client.sent.at(-1);assert.equal(request.attack,'light');assert.equal(simulation.shoot('guest',0,request.attack),true);
  client.update(simulation.snapshot());client.time(300);client.frame(300);assert.equal(client.sent.filter(item=>item.type==='shoot').length,1);
  simulation.time+=MELEE.light.duration;simulation.updateMelee();client.update(simulation.snapshot());
  client.time(600);client.frame(600);request=client.sent.at(-1);assert.equal(request.attack,'light');assert.equal(simulation.shoot('guest',0,request.attack),true);
  assert.equal(client.sent.filter(item=>item.type==='shoot').length,2);
  const messages=client.sent.length;client.dispatch('keydown',{code:'KeyR',repeat:false});assert.equal(client.sent.length,messages);
  assert.equal(client.soundCalls.reload,0);assert.equal(client.node('weapon-panel').classList.contains('melee'),true);assert.equal(client.node('weapon-panel').classList.contains('empty'),false);
  assert.equal(client.node('weapon-slot-1').textContent,'1 KATANA');assert.doesNotMatch(client.node('weapon-slot-1').textContent,/0\/0/);
  client.language('en');assert.equal(client.node('weapon-slot-1').textContent,'1 KATANA');assert.match(client.node('reload-status').textContent,/RECOVERY|WIND-UP|LEFT CLICK/);
  client.dispatch('mouseup',{button:0});client.time(1600);client.frame(1600);assert.equal(client.sent.filter(item=>item.type==='shoot').length,2);
});

test('a melee hit-stop never slows the next swing: the swing gate gets the frozen time back',()=>{
  const {client,simulation}=katanaRange();
  client.dispatch('mousedown',{button:0});const request=client.sent.at(-1);assert.equal(request.attack,'light');assert.equal(simulation.shoot('guest',0,request.attack),true);
  for(let now=16;now<=176;now+=16){client.time(now);client.frame(now);}
  // The cut lands: the server reports a hit, which freezes the picture briefly.
  client.event({event:'melee-hit',id:'guest',weapon:'katana',attack:'light',attackId:1,hits:1,kills:0,impacts:[]});
  simulation.time+=MELEE.light.duration;simulation.updateMelee();client.update(simulation.snapshot());
  const before=client.sent.filter(item=>item.type==='shoot').length;
  for(let now=192;now<=576;now+=16){client.time(now);client.frame(now);}
  assert.equal(client.sent.filter(item=>item.type==='shoot').length,before+1,'the held button cuts again on time');
});

test('a killing melee blow freezes the picture the longest, even though its kill event arrives first',()=>{
  const lost=kills=>{
    const {client,simulation}=katanaRange();client.dispatch('mousedown',{button:0});simulation.shoot('guest',0,'light');
    for(let now=16;now<=160;now+=16){client.time(now);client.frame(now);}
    const before=client.visualTime();
    if(kills)client.event({event:'kill',id:'guest',zombieId:'z1',weapon:'katana',x:0,y:0,z:-1,dirX:0,dirZ:-1,headshot:false,score:100,chain:1,chainBonus:0});
    client.event({event:'melee-hit',id:'guest',weapon:'katana',attack:'light',attackId:1,hits:1,kills,impacts:[]});
    for(let now=176;now<=336;now+=16){client.time(now);client.frame(now);}
    return .176-(client.visualTime()-before);
  };
  const plain=lost(0),killing=lost(1);
  assert.ok(plain>.04,`a light hit freezes briefly (${plain})`);
  assert.ok(killing>plain+.02,`the killing blow freezes longer (${killing} > ${plain})`);
});

test('pausing cancels a pending cut on the real server, silences its voice and rejects late starts until a new click',()=>{
  const {client,simulation,events}=katanaRange();client.dispatch('mousedown',{button:2,preventDefault(){}});simulation.shoot('guest',0,'heavy');
  client.pause();const cancel=client.sent.findLast(item=>item.type==='melee-cancel');assert.ok(cancel);assert.equal(simulation.cancelMelee('guest'),true);
  assert.equal(client.soundCalls.meleeReleases.includes('guest'),true);
  const ready=simulation.players.get('guest').meleeAfter;simulation.time+=MELEE.heavy.windup;simulation.updateMelee();assert.equal(events.some(event=>event.event==='melee-hit'),false);
  assert.equal(simulation.players.get('guest').meleeAfter,ready,'cancel preserves recovery');
  client.event({event:'melee-start',id:'guest',attack:'heavy',attackId:99,windup:.7,duration:1.5,time:simulation.time});assert.equal(client.soundCalls.melee.length,1);
  let prevented=0;client.dispatch('contextmenu',{preventDefault(){prevented++;}});assert.equal(prevented,0,'pause keeps the browser context menu');
  client.lock();client.event({event:'melee-start',id:'guest',attack:'light',attackId:100,windup:.16,duration:.55,time:simulation.time});assert.equal(client.soundCalls.melee.length,1);
  client.time(2000);client.frame(2000);assert.equal(client.meleeCalls.at(-1).elapsed,Infinity);
});

test('V drops only once per press, stops firing and safely displays an empty inventory in both languages', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'); Object.assign(player.inventory.pistol, { ammo: 7, reserve: 19 });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.dispatch('mousedown', { button: 0 });
  client.dispatch('keydown', { code: 'KeyV', repeat: false }); client.dispatch('keydown', { code: 'KeyV', repeat: true });
  assert.equal(client.sent.filter(item => item.type === 'drop-weapon').length, 1);
  assert.equal(client.activity().firing, false);
  assert.equal(simulation.dropWeapon('guest'), true); client.update(simulation.snapshot());
  assert.equal(client.gunType(), null); assert.equal(client.node('weapon-name').textContent, 'MAINS VIDES');
  assert.match(client.node('reload-status').textContent, /RAMASSER UNE ARME/);
  assert.equal(client.pickupCalls.at(-1).weapon, 'pistol');
  const count = client.pickupCalls.length; client.update(simulation.snapshot());
  assert.equal(client.pickupCalls.length, count, 'stable dropped models are reused');
  const posedState = simulation.snapshot(), ground = posedState.pickups.find(item => item.kind === 'weapon');
  Object.assign(ground, { yaw: Math.PI / 2, pitch: .6, modelLift: .15 }); client.update(posedState);
  assert.deepEqual(client.pickupCalls.at(-1).mesh.userData.pose, { yaw: Math.PI / 2, pitch: .6, modelLift: .15 });
  client.language('en'); assert.equal(client.node('weapon-name').textContent, 'UNARMED');
  assert.match(client.node('reload-status').textContent, /PICK UP A WEAPON/);
  client.dispatch('keydown', { code: 'KeyV', repeat: false });
  assert.equal(client.sent.filter(item => item.type === 'drop-weapon').length, 1);
  client.pause(); client.dispatch('keydown', { code: 'KeyV', repeat: false });
  assert.equal(client.sent.filter(item => item.type === 'drop-weapon').length, 1);
  client.event({ event: 'weapon-drop-denied', id: 'guest', reason: 'space' });
  assert.equal(client.node('toast').textContent, 'Not enough room: step back a little to put this weapon down.');
  client.language('fr');
  assert.equal(client.node('toast').textContent, 'Pas assez de place : recule un peu pour poser cette arme.');
});

test('E uses the server-visible ground weapon and holding it cannot repeatedly swap guns', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest');
  player.inventory.rifle = { ammo: 11, reserve: 23 }; player.weapon = 'rifle';
  player.inventory.shotgun = { ammo: 3, reserve: 5 };
  delete player.inventory.pistol;
  simulation.pickups.set('floor', { id: 'floor', kind: 'weapon', weapon: 'pistol', ammo: 7, reserve: 19, x: player.x, y: player.y, z: player.z - .5, expiresAt: Infinity });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.update(simulation.snapshot());
  assert.match(client.node('interaction-text').textContent, /Échanger MITRAILLEUSE contre PISTOLET · 7 chargées \+ 19/);
  client.language('en'); assert.match(client.node('interaction-text').textContent, /Swap MACHINE GUN for PISTOL/);
  client.dispatch('keydown', { code: 'KeyE', repeat: false });
  assert.equal(simulation.interact('guest'), true); client.update(simulation.snapshot());
  assert.equal(player.weapon, 'pistol'); assert.deepEqual(player.inventory.pistol, { ammo: 7, reserve: 19 });
  const commands = client.sent.filter(item => item.type === 'interact').length;
  client.frame(performance.now() + 2000); client.frame(performance.now() + 4000);
  assert.equal(client.sent.filter(item => item.type === 'interact').length, commands);
  client.dispatch('keyup', { code: 'KeyE' }); client.dispatch('keydown', { code: 'KeyE', repeat: false });
  assert.equal(client.sent.filter(item => item.type === 'interact').length, commands + 1);
  const state = simulation.snapshot(); state.players.find(item => item.id === 'guest').nearbyWeaponId = null;
  client.update(state); assert.doesNotMatch(client.node('interaction-text').textContent, /Swap/);
});

test('holding E through a rack replacement cannot reclaim the newly dropped gun until release and another press', () => {
  for (const feedback of ['both', 'purchase-only', 'drop-only']) {
    const events = [], simulation = new RoomSimulation('ABC123', { onEvent: event => events.push(event) });
    simulation.addPlayer('host'); const player = simulation.addPlayer('guest'); simulation.start('host');
    Object.assign(simulation, { phase: 'wave', wave: 12, toSpawn: 1, spawnTimer: 999 });
    const rack = ARMORY.find(crate => crate.weapon === 'shotgun');
    Object.assign(player, { x: rack.x + Math.sin(rack.facing) * 1.1, y: rack.y,
      z: rack.z + Math.cos(rack.facing) * 1.1, points: rack.price, weapon: 'rifle',
      inventory: { pistol: { ammo: 3, reserve: 4 }, rifle: { ammo: 2, reserve: 7 } } });
    player.issuedWeapons.add('rifle');
    const client = clientHarness(); client.update(simulation.snapshot()); client.enter(); client.lock();
    client.update(simulation.snapshot());
    assert.equal(simulation.snapshot().pickups.length, 0, 'The initial press sees only the rack, not a ground gun');
    client.dispatch('keydown', { code: 'KeyE', repeat: false });
    assert.equal(client.sent.filter(item => item.type === 'interact').length, 1);
    events.length = 0;
    assert.equal(simulation.interact(player.id), true);
    assert.equal(player.weapon, 'shotgun');
    assert.equal(simulation.snapshot().pickups.find(pickup => pickup.kind === 'weapon').weapon, 'rifle');
    for (const event of events) {
      if (event.event === 'purchase' && feedback !== 'drop-only'
        || event.event === 'weapon-drop' && feedback !== 'purchase-only') client.event(event);
    }
    // The newly created drop reaches the client after purchase feedback,
    // matching ordinary WebSocket event/snapshot delivery.
    client.update(simulation.snapshot());
    const now = performance.now();
    for (const offset of [700, 1400, 2100]) client.frame(now + offset);
    assert.equal(client.sent.filter(item => item.type === 'interact').length, 1, `${feedback}: held E must not undo the purchase`);
    assert.equal(player.weapon, 'shotgun');

    client.dispatch('keyup', { code: 'KeyE' }); simulation.time += 1;
    client.dispatch('keydown', { code: 'KeyE', repeat: false });
    assert.equal(client.sent.filter(item => item.type === 'interact').length, 2);
    events.length = 0;
    assert.equal(simulation.interact(player.id), true, 'An intentional second press may take the old weapon back');
    assert.equal(player.weapon, 'rifle');
    assert.deepEqual(player.inventory.rifle, { ammo: 2, reserve: 7 });
    for (const event of events) client.event(event);
    client.update(simulation.snapshot());
    client.frame(now + 3500);
    assert.equal(client.sent.filter(item => item.type === 'interact').length, 2, 'The intentional exchange also stays stable while E remains held');
  }
});

test('holding E still repeats ordinary barricade repairs when no weapon exchange occurs', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'); Object.assign(player, { x: 0, y: 0, z: -5 });
  simulation.doors[0].hp = 25;
  client.update(simulation.snapshot()); client.enter(); client.lock();
  client.dispatch('keydown', { code: 'KeyE', repeat: false });
  assert.equal(simulation.interact(player.id), true);
  client.event({ event: 'repair', id: player.id }); client.update(simulation.snapshot());
  const now = performance.now();
  for (const offset of [700, 1400]) {
    simulation.time += 1; client.frame(now + offset);
    assert.equal(simulation.interact(player.id), true);
    client.event({ event: 'repair', id: player.id }); client.update(simulation.snapshot());
  }
  assert.equal(client.sent.filter(item => item.type === 'interact').length, 3);
});

test('G sends current aim once, obeys stock and incapacitation, and grenade effects clear on restart', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'); player.grenades = 2;
  client.update(simulation.snapshot()); client.enter(); client.lock();
  assert.equal(client.node('grenade-count').textContent, '2/2');
  client.dispatch('keydown', { code: 'KeyG', repeat: false }); client.dispatch('keydown', { code: 'KeyG', repeat: true });
  assert.equal(client.sent.at(-1).type, 'grenade'); assert.equal(client.sent.at(-2).type, 'input');
  assert.equal(client.sent.filter(item => item.type === 'grenade').length, 1);
  assert.equal(simulation.throwGrenade('guest'), true); client.update(simulation.snapshot());
  assert.equal(client.grenadeCount(), 1); assert.equal(client.node('grenade-count').textContent, '1/2');
  const grenadeId = simulation.snapshot().grenades[0].id;
  client.event({ event: 'explosion', id: 'guest', grenadeId, x: -1, y: .1, z: 1 });
  assert.equal(client.grenadeCount(), 0); assert.equal(client.explosionCount(), 1);
  player.downed = true; client.update(simulation.snapshot()); client.dispatch('keydown', { code: 'KeyG', repeat: false });
  assert.equal(client.sent.filter(item => item.type === 'grenade').length, 1);
  player.downed = false; player.grenades = 0; client.update(simulation.snapshot()); client.dispatch('keydown', { code: 'KeyG', repeat: false });
  assert.equal(client.sent.filter(item => item.type === 'grenade').length, 1);
  client.event({ event: 'pickup', id: 'guest', kind: 'grenade', grenades: 1 });
  assert.equal(client.node('pickup-notice').textContent, 'GRENADE RAMASSÉE · 1/2');
  client.language('en'); assert.equal(client.node('pickup-notice').textContent, 'GRENADE COLLECTED · 1/2');
  simulation.endGame(); client.update(simulation.snapshot()); assert.equal(client.explosionCount(), 0);
  client.dispatch('keydown', { code: 'KeyG', repeat: false }); assert.equal(client.sent.filter(item => item.type === 'grenade').length, 1);
  client.leave(); assert.equal(client.grenadeCount(), 0);
});

test('the compact infected guide uses production health families and changes language without audio', () => {
  const client = clientHarness();
  const rows = client.node('enemy-guide-families').children;
  assert.equal(rows.length, ENEMY_HEALTH.length);
  for (const [index, row] of rows.entries()) {
    const family = enemyAppearance({ kind: 'walker', maxHp: ENEMY_HEALTH[index] });
    assert.equal(row.dataset.family, family.id);
    assert.equal(row.children[0].style.backgroundColor, `#${family.color.toString(16).padStart(6, '0')}`);
    assert.equal(row.children[1].textContent, family.label.fr);
    assert.equal(row.children[2].textContent, `${ENEMY_HEALTH[index]} PV`);
  }
  assert.ok(client.node('enemy-guide-hulks').textContent.includes(BRUTE_HEALTH.join(' / ')));
  client.language('en');
  const english = client.node('enemy-guide-families').children;
  assert.equal(english[0].children[1].textContent, enemyAppearance({ maxHp: ENEMY_HEALTH[0] }).label.en);
  assert.equal(english[0].children[2].textContent, `${ENEMY_HEALTH[0]} HP`);
  assert.equal(english[1].children[3].textContent, 'Brow binding');
  assert.match(client.node('enemy-guide-hulks').textContent, /^Hulks:/);
  assert.equal(client.soundCalls.unlocks, 0);
});

test('English HUD, weapon slots, pickups and crate prices follow the local language', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.wave = 8;
  client.language('en'); client.update(simulation.snapshot()); client.enter(); client.lock();
  assert.equal(client.node('weapon-name').textContent, 'PISTOL');
  assert.equal(client.node('weapon-slot-1').textContent, '1 PISTOL', 'the held weapon only shows its name');
  assert.equal(client.node('weapon-slot-2').textContent, '2 EMPTY · GROUND WEAPON / RACK');
  assert.equal(client.node('weapon-mobility').textContent, 'MOVEMENT +8%');
  assert.match(client.node('combat-tip').textContent, /^HEAD ×/);
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'rifle');
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: 20 });
  client.update(simulation.snapshot());
  assert.equal(client.node('interaction-text').textContent, 'Buy machine gun · 1800 coins · need 1780 more');
  player.points = 1800; assert.equal(simulation.buyWeapon('guest', 'rifle'), true); client.update(simulation.snapshot());
  assert.equal(player.points, 0);
  assert.equal(client.node('weapon-name').textContent, 'MACHINE GUN');
  assert.equal(client.node('weapon-slot-2').textContent, '2 MACHINE GUN');
  assert.equal(client.node('weapon-slot-1').textContent, '1 PISTOL · 12/12 · RESERVE 36', 'the other weapon keeps its counts on one line');
  const shotgun = ARMORY.find(item => item.weapon === 'shotgun');
  Object.assign(player, { x: shotgun.x + Math.sin(shotgun.facing) * 1.1, y: shotgun.y, z: shotgun.z + Math.cos(shotgun.facing) * 1.1, points: 350 }); client.update(simulation.snapshot());
  assert.equal(client.node('interaction-text').textContent, 'Buy shotgun · 350 coins · replaces machine gun');
  client.event({ event: 'pickup', id: 'guest', kind: 'points', amount: 110 });
  assert.equal(client.node('pickup-notice').textContent, '+110 COINS COLLECTED');
  client.event({ event: 'pickup', id: 'guest', kind: 'ammo', ammo: [{ weapon: 'rifle', amount: 10 }, { weapon: 'magnum', amount: 1 }] });
  assert.equal(client.node('pickup-notice').textContent, 'AMMO · MACHINE GUN +10 · GOLDEN MAGNUM +1');
  const scenes = client.soundCalls.scenes.length, shots = client.soundCalls.shoot;
  client.language('fr');
  assert.equal(client.node('weapon-name').textContent, 'MITRAILLEUSE');
  assert.equal(client.node('pickup-notice').textContent, 'MUNITIONS · MITRAILLEUSE +10 · MAGNUM DORÉ +1');
  assert.equal(client.soundCalls.scenes.length, scenes); assert.equal(client.soundCalls.shoot, shots);
  assert.deepEqual(client.worldLanguages, ['en', 'fr']);
});

test('the ammunition panel keeps the big counts and slim magazine icons without repeating them in text', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { ammo: 7, reserve: self.magazine * 3 + 5 });
  Object.assign(self.weapons[0], { ammo: self.ammo, reserve: self.reserve });
  client.update(state);
  assert.equal(client.node('ammo-value').textContent, 7);
  assert.equal(client.node('magazine-value').textContent, self.magazine);
  assert.equal(client.node('reserve-value').textContent, self.reserve);
  assert.equal(client.node('reserve-summary').textContent, '');
  assert.equal(client.node('reserve-summary').hidden, true);
  const icons = client.node('reserve-magazines').children;
  assert.equal(icons.length, 4); assert.equal(icons.filter(icon => icon.className === 'magazine-icon').length, 3);
  assert.equal(icons.at(-1).className, 'magazine-icon partial');
  assert.equal(icons.at(-1).style['--fill'], `${100 * 5 / self.magazine}%`);
  assert.equal(client.node('weapon-slot-1').textContent, '1 PISTOLET');
  client.language('en');
  assert.equal(client.node('reserve-summary').textContent, '');
  assert.equal(client.node('weapon-slot-1').textContent, '1 PISTOL');
  assert.equal(client.node('reserve-value').textContent, self.reserve);

  self.reserve = self.magazine * 100 + 5; self.weapons[0].reserve = self.reserve; client.update(state);
  const capped = client.node('reserve-magazines').children;
  assert.equal(capped.filter(icon => icon.className.startsWith('magazine-icon')).length, 6);
  assert.equal(capped.filter(icon => icon.className === 'magazine-icon partial').length, 1);
  assert.equal(capped.at(-1).textContent, '+95');
  assert.equal(client.node('reserve-summary').textContent, '');
});

test('empty and reloading ammunition stay clear while switching preserves both independent stocks', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'rifle');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  Object.assign(player.inventory.pistol, { ammo: 4, reserve: 17 });
  Object.assign(player.inventory.rifle, { ammo: 0, reserve: 5 });
  client.update(simulation.snapshot()); client.enter(); client.lock();
  assert.equal(client.node('ammo-value').textContent, 0);
  assert.equal(client.node('magazine-value').textContent, WEAPONS.rifle.magazine);
  assert.equal(client.node('reserve-magazines').children.length, 1, 'one partial magazine icon');
  assert.equal(client.node('reload-status').textContent, 'CHARGEUR VIDE · R POUR RECHARGER');
  assert.equal(client.node('weapon-panel').classList.contains('empty'), true);
  simulation.chooseWeapon('guest', 'pistol'); client.update(simulation.snapshot());
  assert.equal(client.node('ammo-value').textContent, 4);
  assert.equal(client.node('reserve-value').textContent, 17);
  assert.equal(client.node('weapon-panel').classList.contains('empty'), false);
  assert.equal(client.node('weapon-slot-2').textContent, `2 MITRAILLEUSE · 0/${WEAPONS.rifle.magazine} · RÉSERVE 5`);
  simulation.chooseWeapon('guest', 'rifle'); client.update(simulation.snapshot());
  assert.equal(client.node('reserve-value').textContent, 5);
  const reloading = simulation.snapshot(), self = reloading.players.find(item => item.id === 'guest');
  Object.assign(self, { reloading: true, reloadLeft: 1.2 }); client.update(reloading);
  assert.equal(client.node('weapon-panel').classList.contains('reloading'), true);
  assert.equal(client.node('reload-status').textContent, 'RECHARGEMENT · 1.2 s');
  client.language('en'); assert.equal(client.node('reload-status').textContent, 'RELOADING · 1.2 s');
  Object.assign(self, { reloading: false, reserve: 0 }); client.update(reloading);
  assert.equal(client.node('reserve-magazines').children.length, 0);
  assert.equal(client.node('reserve-value').textContent, 0);
  assert.equal(client.node('reload-status').textContent, 'EMPTY · FIND AN AMMO BOX');
  client.language('fr'); assert.equal(client.node('reload-status').textContent, 'ÉPUISÉE · CHERCHE UNE BOÎTE DE MUNITIONS');
});

test('English notifications preserve real names, server errors and local language independence', () => {
  const simulation = room(), english = clientHarness(), french = clientHarness();
  simulation.players.get('host').name = 'Un survivant';
  simulation.players.get('guest').name = '<b>PISTOLET</b>';
  english.language('en'); english.update(simulation.snapshot()); french.update(simulation.snapshot());
  assert.equal(english.node('lobby-players').children[0].children[1].textContent, 'Un survivant');
  assert.equal(english.node('lobby-players').children[1].children[1].textContent, '<b>PISTOLET</b> · you');
  assert.equal(french.node('lobby-players').children[1].children[1].textContent, '<b>PISTOLET</b> · toi');
  english.event({ event: 'revive', id: 'guest', targetId: 'host' });
  assert.equal(english.node('toast').textContent, 'Un survivant is back on their feet.');
  english.event({ event: 'down', id: 'host', source: 'outside' });
  assert.equal(english.node('toast').textContent, 'Un survivant is down outside. Get close and press E to revive them.');
  english.event({ event: 'purchase-denied', id: 'guest', message: 'Il te manque 430 pièces pour pistolet-mitrailleur.' });
  assert.equal(english.node('toast').textContent, 'You need 430 more coins for the smg.');
  english.event({ event: 'join', name: '<b>PISTOLET</b>' });
  assert.equal(english.node('toast').textContent, '<b>PISTOLET</b> joined the shelter.');
  english.language('fr'); assert.equal(english.node('toast').textContent, '<b>PISTOLET</b> a rejoint le refuge.');
  english.language('en'); english.connect(); english.sockets.at(-1).emit('message', { data: JSON.stringify({ type: 'error', message: 'Salle introuvable. Vérifie le code et le serveur.' }) });
  assert.equal(english.node('menu-error').textContent, 'Room not found. Check the code and server.');
});

test('English pause, extraction and victory remain translated without repeating transitions', () => {
  const simulation = room(), client = clientHarness('host');
  client.language('en'); client.update(simulation.snapshot()); client.enter(); client.pause();
  assert.equal(client.node('pause-title').textContent, 'The night awaits.');
  assert.equal(client.node('pause-description').textContent, 'Your team is ready. Start the night when you want.');
  simulation.start('host'); client.update(simulation.snapshot());
  assert.equal(client.node('pause-description').textContent, 'The game continues while this menu is open. P or “Pause game” stops time for the whole team; only the host can do this.');
  simulation.wave = MAX_WAVES; simulation.phase = 'extraction'; simulation.timeLeft = 12;
  client.update(simulation.snapshot());
  assert.equal(client.node('phase-label').textContent, 'RESCUE IS HERE');
  assert.equal(client.node('wave-details').textContent, '12 s · The helicopter is coming for you');
  assert.equal(client.node('banner-kicker').textContent, `YOU SURVIVED ALL ${MAX_WAVES} WAVES`);
  assert.equal(client.soundCalls.extraction, 1);
  simulation.phase = 'victory'; simulation.players.get('host').kills = 12; simulation.players.get('host').score = 300;
  client.update(simulation.snapshot());
  assert.equal(client.node('gameover-title').textContent, 'You made it home.');
  assert.equal(client.node('gameover-result').textContent, `${MAX_WAVES} waves survived. The helicopter brought you to safety. 12 kills · team score 300.`);
  client.language('fr'); assert.equal(client.node('gameover-title').textContent, 'Vous êtes rentrés.');
  client.language('en'); assert.equal(client.node('gameover-title').textContent, 'You made it home.');
  assert.equal(client.soundCalls.extraction, 1); assert.equal(client.soundCalls.victory, 1);
});

test('the menu presents the common pistol and every join requests that starter', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /PISTOLET · ÉQUIPEMENT COMMUN/);
  assert.match(html, /Deux armes au choix ; sac à quatre emplacements dès la vague 10/);
  assert.match(html, /Touches 1–4 ou molette/);
  assert.match(html, /Pompe dès la vague 2, batte 3, hache 5, masse 7, katana 9/);
  assert.doesNotMatch(html, /CARABINE/);
  assert.doesNotMatch(html, /class="weapon-choice/);
  const client = clientHarness();
  client.node('player-name').value = 'Pistolet';
  client.connect(); client.sockets.at(-1).emit('open');
  assert.equal(client.sent.at(-1).type, 'join');
  assert.equal(client.sent.at(-1).weapon, 'pistol');
});

test('two slot keys follow the carried guns and mobility follows the equipped weapon', () => {
  for (const crate of ARMORY.filter(crate => crate.weapon !== 'pistol')) {
    const simulation = room(), client = clientHarness();
    simulation.start('host'); simulation.wave = Math.max(8, crate.unlockWave ?? 0);
    client.update(simulation.snapshot()); client.enter(); client.lock();
    assert.equal(client.node('weapon-name').textContent, 'PISTOLET');
    assert.equal(client.node('weapon-mobility').textContent, 'DÉPLACEMENT +8 %');
    const player = simulation.players.get('guest');
    Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
    assert.equal(simulation.buyWeapon('guest', crate.id), true);
    client.update(simulation.snapshot());
    client.dispatch('keydown', { code: 'Digit1', repeat: false });
    assert.equal(client.sent.at(-1).weapon, 'pistol');
    simulation.chooseWeapon('guest', 'pistol'); client.update(simulation.snapshot());
    client.dispatch('keydown', { code: 'Digit2', repeat: false });
    const weapon = crate.weapon;
    assert.equal(client.sent.at(-1).weapon, weapon);
    assert.equal(simulation.chooseWeapon('guest', weapon), true); client.update(simulation.snapshot());
    if (weapon === 'rifle') assert.equal(client.node('weapon-name').textContent, 'MITRAILLEUSE');
    assert.match(client.node('weapon-slot-1').textContent, /^1 PISTOLET · 12\/12 · RÉSERVE 36$/);
    assert.ok(client.node('weapon-slot-2').textContent.startsWith('2 '));
    const mobility = Math.round((WEAPON_MOVEMENT[weapon] - 1) * 100);
    assert.equal(client.node('weapon-mobility').textContent, mobility === 0 ? 'DÉPLACEMENT NORMAL' : `DÉPLACEMENT ${mobility > 0 ? '+' : '−'}${Math.abs(mobility)} %`);
  }
});

test('holding fire respects the pistol cadence', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
  client.dispatch('mousedown', { button: 0 });
  client.frame(10000);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, 1);
  client.frame(10249);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, 1);
  client.frame(10250);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, 2);
});

test('every confirmed assault bullet drives one sound, tracer and flash, including a late single confirmation', () => {
  const events = [], simulation = new RoomSimulation('ASSAULT', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('guest'), client = clientHarness();
  Object.assign(player, { x: 20, y: 0, z: 20, yaw: 0, pitch: 0, crouched: true });
  simulation.zombies.clear();
  const target = { id: 'durable', x: 20, y: 0, z: 16, hp: 100000, maxHp: 100000, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true };
  simulation.zombies.set(target.id, target);
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.enableShotVisuals();
  client.dispatch('mousedown', { button: 0 });
  for (let index = 0; index < 12; index++) {
    simulation.time = index * (FIRE_INTERVALS.assault + 1e-7);
    assert.equal(simulation.shoot('guest'), true);
    const shot = events.findLast(event => event.event === 'shot');
    simulation.time += .05; simulation.updateBullets(.05);
    client.update(simulation.snapshot()); client.event(shot);
    assert.equal(client.soundCalls.shoot, index + 1);
    assert.equal(client.ballisticCalls.length, index + 1);
    assert.equal(client.soundCalls.shotVoiceIds.at(-1), 'guest');
    assert.equal(client.muzzleIntensity(), 7);
  }
  assert.equal(player.inventory.assault.ammo, WEAPONS.assault.magazine - 12);
  assert.ok(target.hp < target.maxHp, 'those confirmations also applied real authoritative damage');
  client.pause();
  const heard = client.soundCalls.shoot; client.event(events.findLast(event => event.event === 'shot'));
  assert.equal(client.soundCalls.shoot, heard, 'a shot delivered while paused cannot restart assault sound');

  const late = clientHarness(); late.update(simulation.snapshot()); late.enter(); late.lock();
  late.dispatch('mousedown', { button: 0 }); late.dispatch('mouseup', { button: 0 });
  late.event(events.findLast(event => event.event === 'shot'));
  assert.deepEqual(late.soundCalls.singles, ['assault']);
  assert.equal(late.soundCalls.singleOptions[0].voiceId, 'guest');
  late.event({ event: 'leave', id: 'guest' });
  assert.ok(late.soundCalls.assaultReleases.includes('guest'));
});

test('flamethrower HUD identifies fuel, reserve duration and both slots in French and English', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.wave = 14;
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'flamethrower');
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  client.update(simulation.snapshot()); client.enter(); client.lock();
  assert.equal(client.node('weapon-name').textContent, 'LANCE-FLAMMES');
  assert.equal(client.node('ammo-unit').textContent, 'UNITÉS DE CARBURANT');
  assert.equal(client.node('ammo-value').textContent, 80);
  assert.equal(client.node('reserve-value').textContent, 40);
  assert.equal(client.node('reserve-summary').textContent, '5.0 s de flamme en réserve', 'the only reserve detail not shown by the big numbers');
  assert.equal(client.node('reserve-summary').hidden, false);
  assert.equal(client.node('weapon-panel').classList.contains('fuel'), true);
  assert.equal(client.node('weapon-slot-2').textContent, '2 LANCE-FLAMMES');
  assert.equal(client.node('weapon-slot-1').textContent, '1 PISTOLET · 12/12 · RÉSERVE 36');
  assert.match(client.node('combat-tip').textContent, /BRÛLURE 4 S/);
  assert.ok(client.node('reserve-magazines').children[0].className.includes('fuel-canister'));
  client.language('en');
  assert.equal(client.node('weapon-name').textContent, 'FLAMETHROWER');
  assert.equal(client.node('ammo-unit').textContent, 'FUEL UNITS');
  assert.equal(client.node('reserve-summary').textContent, '5.0 s of flame in reserve');
  assert.equal(client.node('reload-status').textContent, 'R · REFILL TANK');
  assert.equal(client.node('weapon-slot-2').textContent, '2 FLAMETHROWER');
  assert.match(client.node('combat-tip').textContent, /4 S BURN/);
  simulation.chooseWeapon('guest', 'pistol'); client.update(simulation.snapshot());
  assert.equal(client.node('ammo-unit').textContent, 'ROUNDS');
  assert.equal(client.node('weapon-panel').classList.contains('fuel'), false);
  assert.equal(client.node('weapon-slot-2').textContent, '2 FLAMETHROWER · 80/80 · FUEL 40');
  assert.equal(client.node('reserve-summary').hidden, true);
  assert.match(client.node('combat-tip').textContent, /HEAD/);
});

test('burning visuals follow authoritative zombies and are cleared when the burn expires', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); const state = simulation.snapshot();
  state.zombies = [{ id: 'burn-test', kind: 'walker', maxHp: 80, hp: 70, x: 0, y: 0, z: 0, yaw: 0, burning: true, burnLeft: 3 }];
  client.update(state);
  const mesh = client.zombieCalls.at(-1).mesh;
  assert.equal(mesh.userData.burning, true);
  state.zombies[0].burnLeft = 0; client.update(state);
  assert.equal(mesh.userData.burning, false, 'no stale burning beyond the server expiry');
  state.zombies[0].burnLeft = 2; client.update(state);
  client.event({ event: 'kill', zombieId: 'burn-test', id: 'host' });
  assert.equal(mesh.userData.burning, false, 'dead zombies stop their flame effect');
});

test('confirmed flame ticks reuse one stream per shooter and cancelled local triggers cannot revive it', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.wave = 14;
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'flamethrower');
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  client.update(simulation.snapshot()); client.enter(); client.lock();
  const shot = { event: 'shot', id: 'guest', weapon: 'flamethrower', x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0, pellets: [{ distance: 5 }] };
  client.dispatch('mousedown', { button: 0 });
  for (let index = 0; index < 50; index++) client.renderShot(shot);
  assert.equal(client.flameCalls.length, 1); assert.equal(client.flameCalls[0].aims.length, 50);
  assert.equal(client.tracerCalls.length, 0, 'flame ticks do not spawn ballistic tracer objects');
  assert.equal(client.flameCalls[0].aims[0].end.z, -5);
  client.renderShot({ ...shot, id: 'host', x: 1 });
  assert.equal(client.flameCalls.length, 2, 'the remote shooter owns its own bounded stream');
  client.dispatch('mouseup', { button: 0 }); assert.equal(client.flameCalls[0].stopped, true);
  client.renderShot(shot); assert.equal(client.flameCalls[0].aims.length, 50);
  client.dispatch('mousedown', { button: 0 }); client.renderShot(shot);
  client.dispatch('keydown', { code: 'KeyR', repeat: false }); assert.equal(client.flameCalls[0].stopped, true);
  client.renderShot(shot); assert.equal(client.flameCalls[0].aims.length, 51, 'reload invalidates local visual fire before its acknowledgement');
  client.pause(); client.renderShot(shot); assert.equal(client.flameCalls[0].aims.length, 51);
  client.leave(); assert.ok(client.flameCalls.every(stream => stream.disposed));
});

test('a wall before the true flamethrower muzzle stops an existing stream and cannot create a backwards jet', async () => {
  const THREE = await import('three');
  const world = await importPublicModule('world.js');
  const simulation = room(), events = [];
  simulation.onEvent = event => events.push(event);
  simulation.start('host'); simulation.wave = 14;
  const player = simulation.players.get('guest');
  Object.assign(player, { x: -1, y: 0, z: -1.5, yaw: 0, pitch: 0, weapon: 'flamethrower' });
  player.inventory = { flamethrower: { ammo: 80, reserve: 40 } };
  assert.equal(simulation.shoot('guest'), true);
  const blocked = events.find(event => event.event === 'shot');
  assert.equal(blocked.pellets[0].stop, 'solid');
  assert.equal(blocked.pellets[0].distance, .38, 'the production wall stops the ray 38cm ahead of the eye');

  const camera = new THREE.PerspectiveCamera(), gun = world.createWeapon('flamethrower');
  camera.position.set(blocked.x, blocked.y, blocked.z); camera.add(gun); camera.updateMatrixWorld(true);
  const muzzle = gun.localToWorld(gun.userData.muzzle.clone());
  assert.ok(muzzle.z < -2.12, 'the true view model muzzle extends beyond the near wall');
  const client = clientHarness('guest', { weaponMuzzle: muzzle });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.dispatch('mousedown', { button: 0 });
  client.renderShot(blocked);
  assert.equal(client.flameCalls.length, 0, 'a blocked first tick creates no visual stream');
  client.renderShot({ ...blocked, pellets: [{ distance: 5, stop: 'range' }] });
  assert.equal(client.flameCalls.length, 1); assert.equal(client.flameCalls[0].aims.length, 1);
  assert.equal(client.flameCalls[0].stopped, false);
  client.renderShot(blocked);
  assert.equal(client.flameCalls[0].stopped, true, 'approaching the wall immediately stops an existing stream');
  assert.equal(client.flameCalls[0].aims.length, 1, 'the jet is never aimed backwards through the wall');
});

test('rocket streak stops at the authoritative impact and uses a smoke trail instead of bullet surface sparks', () => {
  const client = clientHarness(), simulation = room();
  client.update(simulation.snapshot());
  client.renderShot({ event: 'shot', id: 'host', weapon: 'rocket', x: 1, y: 1.55, z: 0, yaw: 0, pitch: 0, impact: { x: 1, y: 1.2, z: -4 }, pellets: [{ yaw: 0, pitch: 0, distance: 60, stop: 'solid' }] });
  assert.equal(client.tracerCalls.length, 1);
  assert.equal(client.tracerCalls[0].options.rocket, true);
  assert.deepEqual(client.tracerCalls[0].end.toArray(), [1, 1.2, -4]);
});

test('physical bullets launch visually at the local barrel while their server flight and contacts remain unchanged', () => {
  const simulation = room(), events = []; simulation.onEvent = event => events.push(event);
  simulation.start('host');
  Object.assign(simulation.players.get('guest'), { x: -1, y: 0, z: 0, yaw: 0, pitch: 0 });
  assert.equal(simulation.shoot('guest'), true);
  const shot = events.find(event => event.event === 'shot'), original = structuredClone(shot);
  const muzzle = new RenderVector3(shot.x + .3, shot.y - .2, shot.z - .9);
  assert.equal(sightClear(shot, muzzle, sightDoors(simulation.snapshot().doors)), true, 'the real barrel line is unobstructed');
  const client = clientHarness('guest', { weaponMuzzle: muzzle });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.frame(0);
  client.renderShot(shot);
  assert.equal(client.ballisticCalls.length, 1);
  const trace = client.ballisticCalls[0];
  assert.ok(trace.options.muzzle, 'physical flight receives the barrel rather than discarding it');
  assert.deepEqual([trace.options.muzzle.x, trace.options.muzzle.y, trace.options.muzzle.z], muzzle.toArray());
  assert.deepEqual([trace.x, trace.y, trace.z], [shot.x, shot.y, shot.z], 'physical origin remains the authoritative eye');
  assert.deepEqual(shot, original, 'the draw path cannot mutate the server projectile');
  simulation.time += .1; simulation.updateBullets(.1);
  const contact = events.find(event => event.event === 'bullet-impact');
  assert.ok(contact?.terminal, 'the real bullet eventually hits the cabin wall');
  client.event(contact);
  assert.equal(trace.contacts.length, 1);
  assert.deepEqual([trace.contacts[0].x, trace.contacts[0].y, trace.contacts[0].z], [contact.x, contact.y, contact.z]);
  assert.deepEqual(client.surfaceImpacts.at(-1).point.toArray(), [contact.x, contact.y, contact.z], 'impact effects retain their exact physical location');
});

for (const scenario of ['scope', 'changed weapon', 'changed instance', 'late 180-degree turn', 'distant eye', 'remote', 'hostile']) {
  test(`physical bullets omit the local barrel offset for ${scenario}`, () => {
    const simulation = room(), events = []; simulation.onEvent = event => events.push(event);
    simulation.start('host');
    const player = simulation.players.get('guest'), weapon = scenario === 'scope' ? 'sniper' : 'pistol';
    Object.assign(player, { x: -4, y: 0, z: 0, yaw: 0, pitch: 0, weapon, weaponId: weapon,
      inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
    assert.equal(simulation.shoot('guest'), true);
    const shot = events.find(event => event.event === 'shot');
    const muzzle = new RenderVector3(shot.x + .3, shot.y - .2, shot.z - .9);
    const client = clientHarness('guest', { weaponMuzzle: muzzle });
    if (scenario === 'changed weapon') {
      Object.assign(player, { weapon: 'shotgun', weaponId: 'shotgun', inventory: { shotgun: { ammo: 8, reserve: 24 } } });
    }
    if (scenario === 'changed instance') {
      player.inventory['pistol#2'] = { ammo: 12, reserve: 48 };
      player.weaponId = 'pistol#2';
    }
    if (scenario === 'late 180-degree turn') { player.yaw = Math.PI; muzzle.z = shot.z + .9; }
    client.update(simulation.snapshot()); client.enter(); client.lock(); client.frame(0);
    if (scenario === 'scope') {
      client.dispatch('mousedown', { button: 2 });
      assert.equal(client.aim().scoped, true, 'exercise the real scope control');
    }
    if (scenario === 'distant eye') {
      shot.x += 10;
      shot.projectiles = shot.projectiles.map(projectile => ({ ...projectile, x: projectile.x + 10 }));
    }
    if (scenario === 'remote') shot.id = 'host';
    if (scenario === 'hostile') { shot.event = 'raider-shot'; shot.raiderId = 'raider-old'; }
    const original = structuredClone(shot);
    client.renderShot(shot);
    assert.equal(client.ballisticCalls.length, 1);
    assert.equal(client.ballisticCalls[0].options.muzzle ?? null, null);
    assert.deepEqual(shot, original, 'falling back leaves the physical flight intact');
  });
}

test('physical shotgun pellets begin at the eye and preserve every confirmed close wall contact', () => {
  const simulation = room(), events = []; simulation.onEvent = event => events.push(event);
  simulation.start('host');
  const player = simulation.players.get('guest');
  Object.assign(player, { x: -1, y: 0, z: -1.5, yaw: 0, pitch: 0, weapon: 'shotgun' });
  player.inventory = { shotgun: { ammo: 8, reserve: 24 } };
  assert.equal(simulation.shoot('guest'), true);
  const shot = events.find(event => event.event === 'shot');
  assert.equal(shot.projectiles.length, 9);
  assert.equal(events.filter(event => event.event === 'bullet-impact').length, 0);
  assert.ok(new Set(shot.projectiles.map(p => p.vx + '/' + p.vy)).size > 3);
  const client = clientHarness('guest', { weaponMuzzle: new RenderVector3(shot.x + .35, shot.y - .36, shot.z - 1.4) });
  client.update(simulation.snapshot()); client.enter(); client.renderShot(shot);
  assert.equal(client.ballisticCalls.length, 9); assert.equal(client.surfaceImpacts.length, 0);
  for(const p of client.ballisticCalls) {
    assert.deepEqual([p.x,p.y,p.z],[shot.x,shot.y,shot.z], 'the physical ray stays at the eye');
    assert.equal(p.options.muzzle ?? null, null, 'a protruding FPS barrel cannot launch a visual bullet beyond the close wall');
  }
  simulation.time += .02; simulation.updateBullets(.02);
  const contacts = events.filter(event => event.event === 'bullet-impact');
  assert.equal(contacts.length, 9);
  for(const event of contacts) {
    assert.equal(event.stop, 'solid');
    assert.ok(Math.hypot(event.x-shot.x,event.y-shot.y,event.z-shot.z)<.4);
    client.event(event);
    const trace=client.ballisticCalls.find(p=>p.id===event.projectileId);
    assert.equal(trace.contacts.length,1);
    assert.deepEqual([trace.contacts[0].x,trace.contacts[0].y,trace.contacts[0].z],[event.x,event.y,event.z]);
    assert.ok(client.surfaceImpacts.at(-1).point.distanceTo(new RenderVector3(event.x,event.y,event.z))<1e-12);
  }
  assert.equal(client.surfaceImpacts.length,9);
});

test('the real shot handler preserves zero-distance and short wall impacts instead of drawing a 12 metre fallback', () => {
  const client = clientHarness('guest', { weaponMuzzle: new RenderVector3(.4, 1.2, -1.5) });
  client.update(room().snapshot()); client.enter();
  const event = { event: 'shot', id: 'guest', weapon: 'rifle', x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0 };
  for (const distance of [0, .02, .05]) {
    client.renderShot({ ...event, pellets: [{ yaw: 0, pitch: 0, distance, stop: 'solid' }] });
    assert.equal(client.tracerCalls.length, 0, `${distance}: no visible trail for a stopped ray this short`);
    assert.ok(client.surfaceImpacts.at(-1).point.distanceTo(new RenderVector3(0, 1.55, -distance)) < 1e-12);
  }
  client.renderShot({ ...event, pellets: [{ yaw: 0, pitch: 0, distance: .15, stop: 'solid' }] });
  assert.equal(client.tracerCalls.length, 1);
  const trace = client.tracerCalls[0];
  assert.deepEqual(trace.end.toArray(), [0, 1.55, -.15]);
  assert.equal(trace.start.x, 0); assert.equal(trace.start.y, 1.55);
  assert.ok(trace.start.z < 0 && trace.start.z > -.15);
});

test('the real shot handler keeps a sniper impact at 70 metres rather than moving its trail and spark to 60', () => {
  const client = clientHarness(); client.update(room().snapshot());
  const event = { event: 'shot', id: 'host', weapon: 'sniper', x: 3, y: 4.95, z: 2, yaw: .31, pitch: -.12,
    pellets: [{ yaw: .311, pitch: -.119, distance: 70, stop: 'solid' }] };
  client.renderShot(event);
  assert.equal(client.tracerCalls.length, 1); assert.equal(client.surfaceImpacts.length, 1);
  const aim = new RenderVector3(0, 0, -1).applyEuler(new RenderEuler(-.119, .311, 0, 'YXZ'));
  const expected = new RenderVector3(event.x, event.y, event.z).addScaledVector(aim, 70);
  assert.ok(client.tracerCalls[0].end.distanceTo(expected) < 1e-12);
  assert.ok(client.surfaceImpacts[0].point.distanceTo(expected) < 1e-12);
});

test('the real shot handler clips a near rocket trail before its protruding barrel while retaining the exact blast position', () => {
  const client = clientHarness('guest', { weaponMuzzle: new RenderVector3(.4, 1.2, -1.6) });
  client.update(room().snapshot()); client.enter();
  const impact = { x: 0, y: 1.55, z: -.38 };
  client.renderShot({ event: 'shot', id: 'guest', weapon: 'rocket', x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0, impact,
    pellets: [{ yaw: 0, pitch: 0, distance: .3801, stop: 'solid' }] });
  assert.equal(client.tracerCalls.length, 1); assert.equal(client.surfaceImpacts.length, 0);
  const trace = client.tracerCalls[0];
  assert.equal(trace.options.rocket, true); assert.deepEqual(trace.end.toArray(), [impact.x, impact.y, impact.z]);
  assert.equal(trace.start.x, 0); assert.equal(trace.start.y, 1.55);
  assert.ok(trace.start.z < 0 && trace.start.z > impact.z);
});

test('held C and Ctrl aliases request crouching before sprint and cancel delivered DOM events only during FPS controls', () => {
  for (const control of ['KeyC', 'ControlLeft', 'ControlRight']) {
    const ctrlKey = control !== 'KeyC';
    const simulation = room(), client = clientHarness(); simulation.start('host'); client.update(simulation.snapshot());
    let prevented = 0;
    client.dispatch('keydown', { code: control, ctrlKey, preventDefault() { prevented++; } });
    client.dispatch('keydown', { code: 'KeyW', ctrlKey, preventDefault() { prevented++; } });
    assert.equal(prevented, 0, 'lobby shortcuts stay available');
    client.enter(); client.lock();
    client.dispatch('keydown', { code: 'ShiftLeft', preventDefault() { prevented++; } });
    assert.equal(client.input().sprint, true);
    client.dispatch('keydown', { code: control, ctrlKey, preventDefault() { prevented++; } });
    client.dispatch('keydown', { code: 'KeyW', ctrlKey, preventDefault() { prevented++; } });
    assert.equal(prevented, ctrlKey ? 2 : 1); assert.equal(client.input().crouch, true);
    assert.equal(client.input().sprint, false); assert.equal(client.input().forward, 1);
    assert.equal(client.sent.at(-1).crouch, true, 'the posture press is sent immediately');
    client.dispatch('keyup', { code: control });
    assert.equal(client.input().crouch, false); assert.equal(client.sent.at(-1).crouch, false);
    assert.equal(client.input().sprint, true);
    const state = simulation.snapshot(); state.players.find(player => player.id === 'guest').crouched = true;
    client.update(state); assert.equal(client.input().sprint, false, 'server-enforced crouching cannot sprint');
    client.pause(); const before = prevented;
    client.dispatch('keydown', { code: 'KeyW', ctrlKey: true, preventDefault() { prevented++; } });
    assert.equal(prevented, before, 'the pause menu keeps normal browser shortcuts');
    assert.equal(client.activity().keys, 0);
  }
});

test('C is held rather than toggled and overlapping crouch aliases release independently', () => {
  for (const first of ['KeyC', 'ControlLeft', 'ControlRight']) {
    const second = first === 'KeyC' ? 'ControlRight' : 'KeyC';
    const simulation = room(), client = clientHarness(); simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
    client.dispatch('keydown', { code: first, repeat: false, preventDefault() {} });
    client.dispatch('keydown', { code: first, repeat: true, preventDefault() {} });
    assert.equal(client.input().crouch, true, 'keyboard repetition never toggles crouching off');
    client.dispatch('keydown', { code: second, preventDefault() {} });
    client.dispatch('keyup', { code: first });
    assert.equal(client.input().crouch, true, 'the other held alias keeps the posture');
    assert.equal(client.sent.at(-1).crouch, true);
    client.dispatch('keyup', { code: second });
    assert.equal(client.input().crouch, false); assert.equal(client.sent.at(-1).crouch, false);
  }
});

test('crouch and sprint requests release on pause, blur, hidden tabs, terminal phases and leaving', () => {
  const actions = [
    client => client.pause(), client => client.dispatchWindow('blur', {}),
    client => { client.hidden(true); client.dispatch('visibilitychange', {}); },
    (client, simulation) => { simulation.phase = 'gameover'; client.update(simulation.snapshot()); },
    client => client.leave(),
  ];
  for (const control of ['KeyC', 'ControlLeft', 'ControlRight']) for (const action of actions) {
    const simulation = room(), client = clientHarness(); simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
    client.dispatch('keydown', { code: control, preventDefault() {} });
    client.dispatch('keydown', { code: 'ShiftRight', preventDefault() {} });
    assert.equal(client.input().crouch, true);
    action(client, simulation);
    assert.equal(client.input().crouch, false); assert.equal(client.input().sprint, false);
    assert.equal(client.activity().keys, 0);
    if (client.sent.at(-1)?.type === 'input') assert.equal(client.sent.at(-1).crouch, false);
  }
});

test('camera and posture feedback follow the server eye height, with standing compatibility and teammate crouch', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
  client.frame(10000); assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.standingEye) < 1e-6);
  client.dispatch('keydown', { code: 'ControlLeft', preventDefault() {} });
  client.frame(10016); assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.standingEye) < 1e-6, 'no client-only height prediction');
  const crouched = simulation.snapshot(), self = crouched.players.find(player => player.id === 'guest');
  Object.assign(self, { crouched: true, eyeHeight: PLAYER_POSTURE.crouchedEye });
  crouched.players.find(player => player.id === 'host').crouched = true;
  client.update(crouched); client.frame(10032);
  assert.ok(client.cameraY() > PLAYER_POSTURE.crouchedEye && client.cameraY() < PLAYER_POSTURE.standingEye, 'eye lowering is interpolated');
  for (let index = 1; index <= 60; index++) client.frame(10032 + index * 1000 / 60);
  assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.crouchedEye) < 1e-6);
  assert.equal(client.node('posture-status').textContent, 'ACCROUPI');
  assert.equal(client.survivorCalls.at(-1).crouched, true);
  client.language('en'); assert.equal(client.node('posture-status').textContent, 'CROUCHED');
  delete self.crouched; delete self.eyeHeight; client.update(crouched);
  for (let index = 1; index <= 60; index++) client.frame(12000 + index * 1000 / 60);
  assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.standingEye) < 1e-6, 'older snapshots use shared standing dimensions');
  assert.equal(client.node('posture-status').textContent, 'HOLD C · CROUCH');
});

test('downed and eliminated camera height overrides the standing eye height in authoritative snapshots', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host'); simulation.phase = 'wave';
  const player = simulation.players.get('guest');
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.frame(10000);
  assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.standingEye) < 1e-6);
  simulation.damagePlayer(player, 100);
  const downed = simulation.snapshot();
  assert.equal(downed.players.find(item => item.id === 'guest').eyeHeight, PLAYER_POSTURE.standingEye);
  client.update(downed);
  for (let index = 1; index <= 60; index++) client.frame(10000 + index * 1000 / 60);
  assert.ok(Math.abs(client.cameraY() - .5) < 1e-6, 'a downed survivor views the room near floor level');
  player.alive = false; client.update(simulation.snapshot());
  for (let index = 1; index <= 60; index++) client.frame(11000 + index * 1000 / 60);
  assert.ok(Math.abs(client.cameraY() - .5) < 1e-6, 'elimination does not raise the camera');
  Object.assign(player, { downed: false, alive: true, hp: 55 }); client.update(simulation.snapshot());
  for (let index = 1; index <= 60; index++) client.frame(12000 + index * 1000 / 60);
  assert.ok(Math.abs(client.cameraY() - PLAYER_POSTURE.standingEye) < 1e-6, 'reviving restores the authoritative standing view');
});

test('held machine-gun input follows shared cadence without catching up multiple shots per frame', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'rifle');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  assert.equal(WEAPONS.rifle.interval, FIRE_INTERVALS.rifle);
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.dispatch('mousedown', { button: 0 });
  for (let frame = 0; frame < 60; frame++) client.frame(10000 + frame * 1000 / 60);
  const shots = client.sent.filter(message => message.type === 'shoot').length;
  assert.ok(shots >= 10, `${shots} commands at 60 FPS`);
  assert.ok(shots <= Math.ceil(1 / FIRE_INTERVALS.rifle));
  client.frame(30000);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, shots + 1, 'a long frame sends only one shot');
  client.dispatch('mouseup', { button: 0 }); client.frame(31000);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, shots + 1);
});

function spinningClient() {
  const simulation = room(), client = clientHarness();
  simulation.start('host');
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'minigun');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  simulation.time = player.shotAfter;
  client.update(simulation.snapshot()); client.enter(); client.lock();
  simulation.onEvent = event => client.event(event);
  let cursor = client.sent.length;
  const drain = (subTick = 0) => {
    while (cursor < client.sent.length) {
      const message = client.sent[cursor++];
      if (message.type === 'minigun-spin') simulation.setMinigunSpin('guest', message.spinning);
      else if (message.type === 'shoot') simulation.shoot('guest', subTick);
      else if (message.type === 'reload') simulation.reload('guest');
      else if (message.type === 'weapon') simulation.chooseWeapon('guest', message.weapon);
      else if (message.type === 'input') simulation.setInput('guest', message);
    }
  };
  return { simulation, client, player, drain };
}

test('held minigun input preserves 18 rounds per second across render rates and the real 30-Hz simulation clock', () => {
  for (const fps of [30, 60, 144]) {
    const { simulation, client, player, drain } = spinningClient();
    client.dispatch('mousedown', { button: 0 }); drain();
    simulation.time += MINIGUN_WINDUP; const start = simulation.time;
    for (let frame = 0; frame < fps * 2; frame++) {
      const elapsed = frame / fps, tick = Math.floor(elapsed * TICK_RATE + 1e-8) / TICK_RATE;
      simulation.time = start + tick; client.update(simulation.snapshot());
      client.frame(10000 + elapsed * 1000); drain(elapsed - tick);
    }
    const shots = client.sent.filter(message => message.type === 'shoot').length;
    assert.equal(shots, fps === 30 ? 36 : 37);
    assert.equal(client.soundCalls.shoot, shots, 'each accepted projectile confirms one firing audio event');
    assert.equal(player.inventory.minigun.ammo, WEAPONS.minigun.magazine - shots);
    client.pause(); drain(); const stopped = player.inventory.minigun.ammo;
    client.frame(20000); drain(); assert.equal(player.inventory.minigun.ammo, stopped);
  }
});

test('the local minigun rotor rests, accelerates with authoritative charge and stops when released', () => {
  const { simulation, client, drain } = spinningClient();
  client.frame(10000); assert.equal(client.rotorRotation(), 0);
  client.dispatch('mousedown', { button: 0 }); drain();
  simulation.time += MINIGUN_WINDUP / 2; client.update(simulation.snapshot()); client.frame(10050);
  assert.ok(Math.abs(client.rotorRotation() + MINIGUN_TIMING.rotorSpeed * .5 * .05) < 1e-8);
  simulation.time += MINIGUN_WINDUP / 2; client.update(simulation.snapshot());
  const halfway = client.rotorRotation();client.frame(10100);drain();
  assert.ok(Math.abs(client.rotorRotation() - halfway + MINIGUN_TIMING.rotorSpeed * .05) < 1e-8);
  client.dispatch('mouseup', { button: 0 }); drain(); client.update(simulation.snapshot());
  const stopped = client.rotorRotation(); client.frame(10150);assert.equal(client.rotorRotation(), stopped);
});

test('the minigun waits for authoritative readiness, shows its charge and cancels on interruption', () => {
  const { simulation, client, player, drain } = spinningClient();
  client.dispatch('mousedown', { button: 0 }); drain();
  assert.equal(client.soundCalls.minigunStarts, 1);
  for (let index = 0; index < 10; index++) client.frame(10000 + index * 10);
  assert.equal(client.sent.filter(message => message.type === 'minigun-spin' && message.spinning).length, 1);
  assert.equal(client.sent.filter(message => message.type === 'shoot').length, 0);
  simulation.time += .5; client.update(simulation.snapshot()); client.frame(10200); drain();
  assert.equal(client.node('reload-status').textContent, 'ROTATION · 0,5 s');
  assert.equal(player.inventory.minigun.ammo, 75); assert.equal(client.soundCalls.shoot, 0);
  simulation.time += .5; client.update(simulation.snapshot()); client.frame(10300); drain();
  assert.equal(player.inventory.minigun.ammo, 74); assert.equal(client.soundCalls.shoot, 1);
  client.dispatch('mouseup', { button: 0 }); drain();
  assert.equal(player.minigunSpinning, false); assert.equal(client.soundCalls.activeBursts.minigun, false);
  client.update(simulation.snapshot()); client.dispatch('mousedown', { button: 0 }); drain();
  assert.equal(player.minigunSpinUntil, simulation.time + MINIGUN_WINDUP);
  client.pause(); drain(); assert.equal(player.minigunSpinning, false);

  for (const action of [
    client => client.dispatch('keydown', { code: 'KeyR', repeat: false }),
    client => client.dispatch('keydown', { code: 'Digit1', repeat: false }),
    client => client.dispatchWindow('blur', {}),
    client => client.dispatch('pointerlockchange', {}),
    client => client.leave(),
  ]) {
    const fixture = spinningClient();
    fixture.client.dispatch('mousedown', { button: 0 }); fixture.drain();
    action(fixture.client); fixture.drain();
    assert.equal(fixture.player.minigunSpinning, false);
  }
});

test('holding an empty minigun auto-reloads, then charges again before spending its finite reserve', () => {
  const { simulation, client, player, drain } = spinningClient();
  player.inventory.minigun.ammo = 1; client.update(simulation.snapshot());
  client.dispatch('mousedown', { button: 0 }); drain();
  simulation.time += MINIGUN_WINDUP; client.update(simulation.snapshot()); client.frame(10000); drain();
  assert.equal(player.inventory.minigun.ammo, 0); assert.equal(player.minigunSpinning, false);
  simulation.time += WEAPONS.minigun.interval + .001;
  client.update(simulation.snapshot()); client.frame(10100); drain();
  assert.equal(player.reloadUntil, simulation.time + WEAPONS.minigun.reloadTime);
  client.update(simulation.snapshot());
  simulation.time = player.reloadUntil; simulation.tick(0); client.update(simulation.snapshot());
  client.frame(10200); drain();
  assert.equal(player.inventory.minigun.ammo, 75); assert.equal(player.inventory.minigun.reserve, 0);
  assert.equal(player.minigunSpinUntil, simulation.time + MINIGUN_WINDUP);
  assert.equal(client.soundCalls.minigunStarts, 2);
  simulation.time += .999; client.update(simulation.snapshot()); client.frame(10300); drain();
  assert.equal(player.inventory.minigun.ammo, 75);
  simulation.time += .001; client.update(simulation.snapshot()); client.frame(10400); drain();
  assert.equal(player.inventory.minigun.ammo, 74); assert.equal(client.soundCalls.shoot, 2);
});

test('a rejected full-magazine reload does not deadlock a held minigun charge', () => {
  const { simulation, client, player, drain } = spinningClient();
  client.dispatch('mousedown', { button: 0 }); drain();
  client.dispatch('keydown', { code: 'KeyR', repeat: false }); drain();
  assert.equal(player.reloadUntil, 0);
  client.frame(10000); drain();
  assert.equal(player.minigunSpinning, true);
  simulation.time += MINIGUN_WINDUP; client.update(simulation.snapshot()); client.frame(10100); drain();
  assert.equal(player.inventory.minigun.ammo, 74);
  client.update(simulation.snapshot()); simulation.time += WEAPONS.minigun.interval + .001;
  client.frame(10200); drain();
  assert.equal(client.soundCalls.shoot, 1, 'confirmed ammunition change restores held-trigger audio after the rejected reload');
});

test('accepted reload sounds use the authoritative weapon and duration once across stable snapshots', () => {
  for (const weapon of Object.keys(WEAPONS).filter(weapon=>!WEAPONS[weapon].melee)) {
    const simulation = room(), client = clientHarness();
    simulation.start('host'); simulation.wave = 8;
    const player = simulation.players.get('guest');
    if (weapon !== 'pistol') {
      const crate = ARMORY.find(item => item.weapon === weapon);
      simulation.wave = Math.max(simulation.wave, crate.unlockWave ?? 0);
      Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
      assert.equal(simulation.buyWeapon('guest', crate.id), true);
    }
    player.inventory[weapon].ammo--;
    if (player.inventory[weapon].reserve === 0) player.inventory[weapon].reserve = 1;
    client.update(simulation.snapshot()); client.enter(); client.lock();
    simulation.onEvent = event => client.event(event);
    client.dispatch('keydown', { code: 'KeyR', repeat: false });
    assert.equal(simulation.reload('guest'), true);
    assert.deepEqual(client.soundCalls.reloadArgs, [{ type: weapon, duration: WEAPONS[weapon].reloadTime }]);
    assert.equal(client.soundCalls.reloadReleases, 0, 'the accepted event may precede its first reloading snapshot');
    client.event({ event: 'reload', id: 'guest', weapon, duration: WEAPONS[weapon].reloadTime });
    for (let index = 0; index < 20; index++) client.update(simulation.snapshot());
    assert.equal(client.soundCalls.reload, 1, 'duplicates and snapshots must not restart or stutter the sample');
    assert.equal(client.soundCalls.reloadReleases, 0);
    simulation.time += WEAPONS[weapon].reloadTime;
    simulation.tick(.001); client.update(simulation.snapshot());
    assert.equal(client.soundCalls.activeReload, null);
    assert.equal(client.soundCalls.reloadReleases, 1);
    client.update(simulation.snapshot()); assert.equal(client.soundCalls.reloadReleases, 1, 'stable completion is idempotent');
  }
});

test('reload audio cancels on local actions or authoritative incapacity and never resumes from stable snapshots', () => {
  const actions = {
    'requested switch': (client) => client.dispatch('keydown', { code: 'Digit2', repeat: false }),
    'confirmed switch': (client, simulation) => { simulation.chooseWeapon('guest', 'rifle'); client.update(simulation.snapshot()); },
    pause: client => client.pause(),
    blur: client => client.dispatchWindow('blur', {}),
    'pointer loss': client => client.dispatch('pointerlockchange', {}),
    'down event': client => client.event({ event: 'down', id: 'guest' }),
    'down snapshot': (client, simulation) => { simulation.players.get('guest').downed = true; client.update(simulation.snapshot()); },
    'dead snapshot': (client, simulation) => { simulation.players.get('guest').alive = false; client.update(simulation.snapshot()); },
    extraction: (client, simulation) => { simulation.phase = 'extraction'; client.update(simulation.snapshot()); },
    leave: client => client.leave(),
  };
  for (const [action, run] of Object.entries(actions)) {
    const simulation = room(), client = clientHarness();
    simulation.start('host');
    const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'rifle');
    simulation.wave = crate.unlockWave;
    Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
    assert.equal(simulation.buyWeapon('guest', crate.id), true); simulation.chooseWeapon('guest', 'pistol');
    player.inventory.pistol.ammo--;
    client.update(simulation.snapshot()); client.enter(); client.lock();
    simulation.onEvent = event => client.event(event);
    client.dispatch('keydown', { code: 'KeyR', repeat: false });
    assert.equal(simulation.reload('guest'), true); client.update(simulation.snapshot());
    assert.equal(client.soundCalls.activeReload.type, 'pistol', action);
    run(client, simulation);
    assert.equal(client.soundCalls.activeReload, null, action);
    client.event({ event: 'reload', id: 'guest', weapon: 'pistol', duration: WEAPONS.pistol.reloadTime });
    for (let index = 0; index < 5; index++) client.update(simulation.snapshot());
    assert.equal(client.soundCalls.reload, 1, `${action} must not resume an interrupted sample`);
  }
});

for (const weapon of ['rifle', 'smg', 'assault', 'flamethrower']) test(`the sustained ${weapon} burst releases immediately on input and weapon transitions`, () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host');
  const player = simulation.players.get('guest');
  const crate = ARMORY.find(item => item.weapon === weapon);
  simulation.wave = Math.max(1, crate.unlockWave ?? 0);
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  client.update(simulation.snapshot()); client.enter(); client.lock();
  const shoot = () => {
    client.dispatch('mousedown', { button: 0 });
    client.event({ event: 'shot', id: 'guest', weapon, hits: 0 });
    assert.equal(client.soundCalls.activeBursts[weapon], true);
  };
  shoot();
  client.update(simulation.snapshot());
  assert.equal(client.soundCalls.activeBursts[weapon], true, 'an unchanged held weapon does not interrupt the burst on every snapshot');
  client.dispatch('mouseup', { button: 2 });
  assert.equal(client.soundCalls.activeBursts[weapon], true, 'the right button does not release the left-hand trigger');
  client.dispatch('mouseup', { button: 0 });
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  assert.equal(client.activity().firing, false);
  shoot(); client.dispatch('keydown', { code: 'KeyR', repeat: false });
  assert.equal(client.sent.at(-1).type, 'reload');
  assert.equal(client.soundCalls.activeBursts[weapon], false, 'reload releases before the server acknowledgement');
  shoot(); client.event({ event: 'reload', id: 'guest' });
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  shoot(); client.dispatch('keydown', { code: 'Digit1', repeat: false });
  assert.equal(client.sent.at(-1).weapon, 'pistol');
  assert.equal(client.soundCalls.activeBursts[weapon], false, 'weapon selection releases before the snapshot arrives');
  shoot(); simulation.chooseWeapon('guest', 'pistol'); client.update(simulation.snapshot());
  assert.equal(client.soundCalls.activeBursts[weapon], false, 'authoritative weapon replacement also releases the old sustained weapon');
  simulation.chooseWeapon('guest', weapon); client.update(simulation.snapshot());
  shoot(); client.pause();
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  client.lock(); shoot(); client.dispatchWindow('blur', {});
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  client.lock(); shoot(); client.dispatch('pointerlockchange', {});
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  client.lock(); shoot(); client.leave();
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  assert.ok(client.soundCalls.releases.length >= 8);
  assert.ok(client.soundCalls.releases.some(type => type === weapon), 'switches release the actual previous weapon');
  assert.ok(client.soundCalls.releases.some(type => type === undefined), 'input resets release every sustained voice');
  assert.ok(client.soundCalls.releases.every(type => type === weapon || type === undefined));
});

for (const weapon of ['rifle', 'smg', 'minigun', 'assault', 'flamethrower']) test(`late ${weapon} shot acknowledgements cannot resurrect a released or cancelled burst`, () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.wave = 5;
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === weapon);
  simulation.wave = Math.max(5, crate.unlockWave ?? 0);
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
  assert.equal(simulation.buyWeapon('guest', crate.id), true);
  client.update(simulation.snapshot()); client.enter(); client.lock();
  const shot = () => client.event({ event: 'shot', id: 'guest', weapon, hits: 1 });
  const press = () => client.dispatch('mousedown', { button: 0 });
  const release = () => client.dispatch('mouseup', { button: 0 });
  press(); release(); shot();
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  assert.deepEqual(client.soundCalls.singles, [weapon], 'an accepted brief click retains one short, non-looping report');
  shot(); assert.equal(client.soundCalls.singles.length, 1, 'batched late shots do not stack more reports after the same release');
  assert.equal(client.node('hit-marker').hidden, false);
  press(); shot(); assert.equal(client.soundCalls.activeBursts[weapon], true);
  release(); shot();
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  assert.equal(client.soundCalls.singles.length, 1, 'a burst already heard does not restart after release');
  press(); client.dispatch('keydown', { code: 'KeyR', repeat: false });
  const beforeReload = client.soundCalls.shoot; shot();
  assert.equal(client.soundCalls.shoot, beforeReload, 'reload invalidates the trigger before its acknowledgement');
  assert.equal(client.soundCalls.singles.length, 1);
  const reloading = simulation.snapshot(); reloading.players.find(item => item.id === 'guest').reloading = true;
  client.update(reloading); shot(); assert.equal(client.soundCalls.shoot, beforeReload);
  client.update(simulation.snapshot()); shot();
  assert.equal(client.soundCalls.shoot, beforeReload + 1, 'holding the trigger resumes audio after confirmed reload completion');
  release(); press(); client.dispatch('keydown', { code: 'Digit1', repeat: false });
  const beforeSwitch = client.soundCalls.shoot; shot(); assert.equal(client.soundCalls.shoot, beforeSwitch);
  simulation.chooseWeapon('guest', 'pistol'); client.update(simulation.snapshot()); shot();
  assert.equal(client.soundCalls.shoot, beforeSwitch);
  simulation.chooseWeapon('guest', weapon); client.update(simulation.snapshot()); press();
  client.dispatch('keydown', { code: 'KeyR', repeat: false });
  assert.equal(simulation.reload('guest'), false, 'a full magazine rejects a redundant reload');
  const beforeRejectedReload = client.soundCalls.shoot;
  simulation.time += 1;
  if (weapon === 'minigun') { simulation.setMinigunSpin('guest', true); simulation.time += MINIGUN_WINDUP; }
  assert.equal(simulation.shoot('guest'), true); client.update(simulation.snapshot()); shot();
  assert.equal(client.soundCalls.shoot, beforeRejectedReload + 1, 'fresh accepted ammunition consumption restores audio after a rejected reload');
  client.pause();
  const beforePause = client.soundCalls.shoot; shot();
  assert.equal(client.soundCalls.shoot, beforePause);
  assert.equal(client.soundCalls.activeBursts[weapon], false);
  assert.equal(client.soundCalls.singles.length, 1, 'pause and switching suppress both the loop and brief report');
  assert.equal(client.node('hit-marker').hidden, false, 'accepted hit feedback remains available');
});

test('scene audio follows entry, pause, terminal phases and leaving the room', () => {
  const simulation = room(), client = clientHarness();
  client.update(simulation.snapshot());
  assert.equal(client.soundCalls.scenes.at(-1).inGame, false);
  client.enter(); client.lock();
  assert.equal(client.soundCalls.scenes.at(-1).inGame, true);
  simulation.start('host'); client.update(simulation.snapshot()); client.pause();
  assert.equal(client.soundCalls.scenes.at(-1).phase, 'countdown');
  assert.equal(client.soundCalls.scenes.at(-1).inGame, true, 'pause keeps the shared night audible');
  extract(simulation); client.update(simulation.snapshot());
  assert.equal(client.soundCalls.scenes.at(-1).phase, 'extraction');
  finishExtraction(simulation); client.update(simulation.snapshot());
  assert.equal(client.soundCalls.scenes.at(-1).phase, 'victory');
  client.leave();
  assert.deepEqual(client.soundCalls.scenes.at(-1), { phase: null, wave: null, inGame: false, boss: false });
  assert.equal(client.soundCalls.stops, 1);
});

test('returning to an active room keeps the lobby silent after audio was already unlocked', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.phase = 'wave';
  client.update(simulation.snapshot()); client.enter();
  client.event({ event: 'hit', id: 'guest', source: 'zombie', damage: 11 });
  client.event({ event: 'revive', id: 'host', targetId: 'guest' });
  assert.ok(client.soundCalls.unlocks > 0);
  assert.equal(client.soundCalls.hurt, 1); assert.equal(client.soundCalls.revive, 1);
  client.leave(); client.connect();
  const socket = client.sockets.at(-1); socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123' }) });
  socket.emit('message', { data: JSON.stringify(simulation.snapshot()) });
  assert.equal(client.node('lobby').hidden, false);
  for (const event of [
    { event: 'shot', id: 'guest', weapon: 'pistol', hits: 1, x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0 },
    { event: 'shot', id: 'host', weapon: 'rifle', hits: 1, x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0 },
    { event: 'hit', id: 'guest', source: 'zombie', damage: 11 },
    { event: 'reload', id: 'guest' },
    { event: 'revive', id: 'host', targetId: 'guest' },
    { event: 'repair', id: 'guest' },
    { event: 'kill', id: 'guest', x: 0, y: 0, z: 0 },
    { event: 'door', hp: 0 },
  ]) client.event(event);
  assert.equal(client.soundCalls.shoot, 0); assert.equal(client.soundCalls.hit, 0);
  assert.equal(client.soundCalls.hurt, 1); assert.equal(client.soundCalls.revive, 1);
  assert.equal(client.soundCalls.reload, 0); assert.equal(client.soundCalls.kill, 0); assert.equal(client.soundCalls.repair, 0);
  const board = simulation.snapshot().doors[0];
  client.event({ event: 'board', id: 'host', doorId: board.id, boardIndex: 0, hp: 96, boards: [0, 24, 24, 24, 24] });
  assert.equal(client.soundCalls.boardBreak, 0);
  assert.equal(client.boardCalls.at(-1).boards[0], 0, 'world state still follows room events in the lobby');
  client.event({ event: 'purchase', id: 'guest', weapon: 'rifle', price: 1800 });
  assert.equal(client.soundCalls.purchase, 0);
  assert.match(client.node('toast').textContent, /MITRAILLEUSE achetée/);
  client.event({ event: 'leave', id: 'host', hostId: 'guest' });
  assert.equal(client.node('toast').textContent, 'Tu es maintenant l’hôte du refuge.');
});

test('footsteps receive authoritative positions and pause or extraction disables them', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
  client.frame(10000);
  assert.equal(client.soundCalls.footsteps.at(-1).enabled, true);
  const player = simulation.players.get('guest');
  Object.assign(player, { x: 1.1, z: .8 }); client.update(simulation.snapshot()); client.frame(10040);
  assert.deepEqual(client.soundCalls.footsteps.at(-1), { id: 'guest', x: 1.1, z: .8, enabled: true });
  client.pause(); client.frame(10080);
  assert.equal(client.soundCalls.footsteps.at(-1).enabled, false);
  extract(simulation); client.update(simulation.snapshot()); client.frame(10120);
  assert.equal(client.soundCalls.footsteps.at(-1).enabled, false);
  client.leave(); client.frame(10160);
  assert.equal(client.soundCalls.footsteps.at(-1).id, null);
  assert.equal(client.soundCalls.footsteps.at(-1).enabled, false);
});

test('the final boss has its own model, authoritative scale and live HUD label', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.phase = 'wave'; simulation.wave = MAX_WAVES;
  const state = simulation.snapshot();
  state.zombies = [{ id: 'final', kind: 'brute', boss: false, scale: 1.22, x: 0, y: 0, z: -5, yaw: 0 }];
  client.update(state);
  assert.equal(client.zombieCalls.length, 1);
  assert.equal(client.zombieCalls[0].boss, false);
  state.zombies[0].boss = true; state.zombies[0].scale = 1.32;
  client.update(state);
  assert.equal(client.zombieCalls.length, 2);
  assert.equal(client.zombieCalls[1].boss, true);
  assert.equal(client.zombieCalls[1].id, 'final', 'the server id seeds the same look for every player');
  assert.deepEqual(client.disposedZombies, [client.zombieCalls[0].mesh], 'a replaced model frees its buffers');
  assert.equal(client.zombieCalls[1].mesh.scale.value, 1.32);
  assert.match(client.node('wave-details').textContent, /COLOSSE FINAL/);
  assert.equal(client.soundCalls.scenes.at(-1).boss, true);
  client.update(state);
  assert.equal(client.zombieCalls.length, 2, 'unchanged snapshots keep the existing model');
  state.zombies = []; client.update(state);
  assert.equal(client.disposedZombies.at(-1), client.zombieCalls[1].mesh, 'a vanished zombie frees its buffers');
  assert.doesNotMatch(client.node('wave-details').textContent, /COLOSSE FINAL/);
});

test('zombie families use authoritative maximum health and stay fixed while wounded', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.phase = 'wave';
  const state = simulation.snapshot();
  state.zombies = [{ id: 'family', kind: 'walker', hp: 400, maxHp: 400, x: 0, y: 0, z: -3, yaw: 0 }];
  client.update(state);
  assert.equal(client.zombieCalls[0].maxHp, 400);
  state.zombies[0].hp = 1; client.update(state);
  assert.equal(client.zombieCalls.length, 1, 'losing health does not replace the family model');
  state.zombies[0].maxHp = 80; state.zombies[0].hp = 80; client.update(state);
  assert.equal(client.zombieCalls.length, 2, 'a changed authoritative family replaces a reused actor id');
  assert.equal(client.zombieCalls[1].maxHp, 80);
  client.update(state);
  assert.equal(client.zombieCalls.length, 2);
});

test('zombie impact motion follows server snapshots and resets on older or neutral snapshots', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.phase = 'wave';
  const state = simulation.snapshot();
  state.zombies = [{ id: 'hit', kind: 'walker', x: 0, y: 0, z: -3, yaw: 0, pushX: .5, pushZ: -1.2 }];
  client.update(state);
  const mesh = client.zombieCalls[0].mesh;
  assert.equal(mesh.userData.pushX, .5);
  assert.equal(mesh.userData.pushZ, -1.2);
  state.zombies[0].pushX = 0; state.zombies[0].pushZ = 0; client.update(state);
  assert.equal(client.zombieCalls.length, 1);
  assert.equal(mesh.userData.pushX, 0);
  assert.equal(mesh.userData.pushZ, 0);
  delete state.zombies[0].pushX; delete state.zombies[0].pushZ; client.update(state);
  assert.equal(mesh.userData.pushX, 0);
  assert.equal(mesh.userData.pushZ, 0);
});

test('nearby living ordinary zombies groan with distance attenuation and a bounded cadence', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); simulation.phase = 'wave';
  const state = simulation.snapshot();
  Object.assign(state.players.find(player => player.id === 'guest'), { x: 0, y: 0, z: 0 });
  state.zombies = [{ id: 'near', kind: 'walker', hp: 77, x: 2, y: 0, z: 0, yaw: 0 }];
  client.update(state); client.frame(10000);
  assert.equal(client.soundCalls.groans.length, 0, 'a survivor still in the lobby does not hear the gameplay ambience');
  client.enter(); client.frame(10000);
  assert.equal(client.soundCalls.groans.length, 1);
  const nearVolume = client.soundCalls.groans[0];
  for (let time = 10001; time < 12500; time += 16) client.frame(time);
  assert.equal(client.soundCalls.groans.length, 1, 'rendering more frames cannot multiply calls');
  state.zombies[0].x = 11; client.update(state); client.frame(15001);
  assert.equal(client.soundCalls.groans.length, 2, 'a living nearby zombie is audible again within five seconds');
  assert.ok(client.soundCalls.groans[1] < nearVolume);
  assert.ok(client.soundCalls.groans[1] > 0 && nearVolume <= .055);
  state.zombies = [
    { id: 'far', kind: 'walker', hp: 77, x: 11, y: 6, z: 0, yaw: 0 },
    { id: 'dead', kind: 'runner', hp: 0, x: 1, y: 0, z: 0, yaw: 0 },
    { id: 'brute', kind: 'brute', hp: 500, x: 1, y: 0, z: 0, yaw: 0 },
  ];
  client.update(state); client.frame(20002);
  assert.equal(client.soundCalls.groans.length, 2, 'dead, heavy or three-dimensionally distant enemies do not trigger ordinary groans');
  state.zombies = [{ id: 'near-again', kind: 'runner', hp: 55, x: 3, y: 0, z: 0, yaw: 0 }];
  state.phase = 'extraction'; client.update(state); client.frame(21000);
  assert.equal(client.soundCalls.groans.length, 2);
  state.phase = 'wave'; client.update(state); client.frame(21001);
  assert.equal(client.soundCalls.groans.length, 3);
  client.leave(); client.frame(26002);
  assert.equal(client.soundCalls.groans.length, 3, 'leaving silences all living-zombie calls');
  client.update(state); client.enter(); client.frame(26003);
  assert.equal(client.soundCalls.groans.length, 3, 'a stale snapshot cannot revive audio after the connection was cleared');
});

// A real wave-5 room; clearing the zombies triggers its raid. The client
// harness then receives the authoritative snapshots and events.
function raidRoom() {
  const events = [], simulation = new RoomSimulation('RAID01', { random: () => .5, onEvent: event => events.push(event) });
  simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité');
  simulation.start('host'); simulation.wave = RAIDS.waves[0] - 1; simulation.beginWave();
  for (const player of simulation.players.values()) { player.hp = 1e6; player.yaw = 0; }
  return { simulation, events, last: name => events.findLast(event => event.event === name) };
}
function startRaid(simulation) {
  simulation.toSpawn = 0; simulation.zombies.clear(); simulation.spawnWarnings.clear(); simulation.tick(1 / 30);
  for (let step = 0; simulation.raidWarnings.size && step < 900; step++) simulation.tick(1 / 30);
  return [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
}
const screenAngle = (client, id) => Number(/rotate\((-?[\d.]+)rad\)/.exec(client.node(id).style.transform)?.[1]);
const sideNames = { north: 'nord', south: 'sud', west: 'ouest', east: 'est' };

test('raider meshes follow snapshots, ease their yaw on the shortest arc and fall as raider corpses without zombie cues', () => {
  const { simulation } = raidRoom(), raiders = startRaid(simulation), client = clientHarness('guest', { fakeNow: 0 });
  const state = simulation.snapshot();
  client.update(state);
  assert.equal(client.raiderCalls.length, raiders.length);
  assert.equal(client.zombieCalls.length, 0, 'raiders never use the zombie model');
  assert.deepEqual(client.raiderCalls.map(call => [call.weapon, call.maxHp]), state.zombies.map(zombie => [zombie.weapon, zombie.maxHp]));
  assert.deepEqual(client.compiles, [[true]], 'the first raider of the page compiles with its flash visible, once');
  const mesh = client.raiderCalls[0].mesh, id = state.zombies[0].id, other = client.raiderCalls[1].mesh, otherId = state.zombies[1].id;
  assert.equal(mesh.userData.flash.visible, false, 'the flash is hidden again after compiling');
  assert.equal(mesh.userData.renderYaw, state.zombies[0].yaw);
  client.update(simulation.snapshot());
  assert.equal(client.raiderCalls.length, raiders.length, 'stable snapshots keep each model');
  const turning = simulation.snapshot();
  Object.assign(turning.zombies[0], { yaw: -3, pitch: .3, crouched: true, reloading: true, weapon: 'assault' });
  mesh.userData.renderYaw = 3;
  client.update(turning); client.frame(16);
  assert.ok(mesh.userData.renderYaw > 3 && mesh.userData.renderYaw < 3.2, `turns through π, the short way (${mesh.userData.renderYaw})`);
  assert.equal(mesh.rotation.y, mesh.userData.renderYaw);
  for (let now = 32; now < 2000; now += 16) client.frame(now);
  assert.ok(Math.abs(Math.sin(mesh.userData.renderYaw) - Math.sin(-3)) < 1e-3 && Math.abs(Math.cos(mesh.userData.renderYaw) - Math.cos(-3)) < 1e-3);
  const latest = client.raiderFrames.findLast(entry => entry.mesh === mesh);
  assert.deepEqual([latest.state.pitch, latest.state.crouched, latest.state.reloading], [.3, true, true]);
  assert.equal(latest.rotationY, mesh.userData.renderYaw, 'the smoothed yaw is what gets drawn');
  assert.equal(mesh.userData.weaponType, 'assault');
  assert.equal(client.raiderCalls.length, raiders.length, 'a new weapon swaps the held model only');

  client.enter(); client.lock();
  const near = simulation.snapshot(), guest = near.players.find(player => player.id === 'guest');
  for (const zombie of near.zombies) Object.assign(zombie, { x: guest.x + 1, z: guest.z });
  client.update(near); client.frame(5000); client.frame(9000);
  assert.equal(client.soundCalls.groans.length, 0, 'raiders never groan');
  client.event({ event: 'door', zombieId: otherId, doorId: 'west', hp: 80, boards: [20, 20, 20, 20, 0] });
  client.event({ event: 'board', zombieId: otherId, doorId: 'west', boardIndex: 3, hp: 72, boards: [20, 20, 20, 12, 0] });
  assert.equal(other.userData.attackAt, undefined, 'no zombie swing for a raider');
  assert.equal(other.userData.bashAt, undefined, 'a bullet on a plank is not a butt-stroke');
  client.time(9100); client.event({ event: 'door', zombieId: otherId, bash: true, doorId: 'west', hp: 62, boards: [20, 20, 20, 2, 0] });
  assert.ok(Number.isFinite(other.userData.bashAt), 'the plank bash drives the stock');

  client.event({ event: 'kill', id: 'guest', zombieId: id, raider: true, headshot: false, x: guest.x + 1, y: 0, z: guest.z, dirX: 1, dirZ: 0 });
  assert.deepEqual([mesh.userData.raiderDeath.directionX, mesh.userData.raiderDeath.directionZ], [1, 0]);
  assert.equal(client.soundCalls.kill, 0, 'never the zombie groan');
  assert.equal(client.soundCalls.raiderDowns, 1);
  assert.equal(client.node('hit-marker').hidden, false);
  assert.deepEqual(client.soundCalls.raiderReleases, [id]);
  client.frame(9116);
  assert.ok(client.raiderCorpses.includes(mesh), 'the corpse runs the raider death');
  const gone = simulation.snapshot(); gone.zombies = gone.zombies.filter(zombie => zombie.id !== id && zombie.id !== otherId);
  client.update(gone);
  assert.deepEqual(client.soundCalls.raiderReleases, [id, otherId], 'a raider leaving the snapshot frees its voice');
});

test('a raider shot draws hostile tracers from its muzzle and plays its take by distance and side, without local recoil or marker', () => {
  const { simulation } = raidRoom(), raiders = startRaid(simulation), client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.enableShotVisuals();
  const raider = raiders[0], self = simulation.snapshot().players.find(player => player.id === 'guest');
  const mesh = client.raiderCalls[0].mesh;
  const shot = (x, z) => ({ event: 'raider-shot', raiderId: raider.id, weapon: 'smg', sound: 'smg', x, y: 1.5, z, yaw: 0, pitch: 0, hits: 1, suppress: false,
    pellets: [{ yaw: 0, pitch: 0, distance: 9, stop: 'player' }, { yaw: .02, pitch: 0, distance: 30, stop: 'range' }] });
  client.frame(1); assert.equal(client.node('hit-marker').hidden, true);
  const firstShot = shot(mesh.position.x, mesh.position.z);
  client.event(firstShot);
  assert.equal(client.tracerCalls.length, 2);
  for (const call of client.tracerCalls) { assert.equal(call.options.hostile, true); assert.equal(call.options.local, false); }
  assert.deepEqual(client.tracerCalls[0].start.toArray(), [mesh.position.x, 1.4, mesh.position.z], 'tracers leave the raider muzzle');
  assert.ok(Number.isFinite(mesh.userData.firedAt), 'the raider model fires');
  const heard = client.soundCalls.raiderShots[0], distance = Math.hypot(firstShot.x - self.x, firstShot.z - self.z);
  assert.equal(heard.kind, 'smg'); assert.equal(heard.voiceId, raider.id);
  assert.ok(Math.abs(heard.volume - Math.max(.12, Math.min(1, 1 - (distance - 6) / 54))) < 1e-9);
  assert.ok(Math.abs(heard.pan - (firstShot.x - self.x) / distance) < 1e-9, 'the side follows the bearing in a north-facing view');
  assert.equal(client.soundCalls.shoot, 0); assert.equal(client.soundCalls.hit, 0);
  assert.equal(client.node('hit-marker').hidden, true, 'incoming fire never shows the hit marker');
  assert.equal(client.muzzleIntensity(), 0, 'and never kicks the local gun');
  client.event(shot(self.x, self.z - 4));
  assert.equal(client.soundCalls.raiderShots.at(-1).volume, 1); assert.ok(Math.abs(client.soundCalls.raiderShots.at(-1).pan) < 1e-9);
  client.event(shot(self.x + 80, self.z));
  assert.equal(client.soundCalls.raiderShots.at(-1).volume, .12); assert.equal(client.soundCalls.raiderShots.at(-1).pan, 1);
  for (let index = 0; index < 100; index++) client.event(shot(raider.x, raider.z));
  assert.equal(client.tracerCalls.length, 206);
  assert.equal(client.tracerDisposals.count, 206 - 160, 'at most 160 live tracers; the oldest are disposed');
  const paused = simulation.snapshot(); paused.paused = true; client.update(paused);
  const tracers = client.tracerCalls.length, sounds = client.soundCalls.raiderShots.length;
  client.event(shot(raider.x, raider.z));
  assert.equal(client.tracerCalls.length, tracers); assert.equal(client.soundCalls.raiderShots.length, sounds, 'a paused team drops raider fire');
});

test('a delayed raider shot cannot draw sideways from its newer interpolated muzzle', () => {
  const { simulation } = raidRoom(), raiders = startRaid(simulation), client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.enableShotVisuals(); client.frame(1);
  const raider = raiders[0], mesh = client.raiderCalls[0].mesh;
  mesh.position.x += 3; mesh.position.z += 2;
  const shot = { event: 'raider-shot', raiderId: raider.id, weapon: 'smg', sound: 'smg',
    x: raider.x, y: 1.4, z: raider.z, yaw: 0, pitch: 0, hits: 0,
    pellets: [{ yaw: 0, pitch: 0, distance: 1.2, stop: 'player' }] };
  client.event(shot);
  assert.equal(client.tracerCalls.length, 1);
  const trace = client.tracerCalls[0];
  assert.equal(trace.options.hostile, true);
  assert.deepEqual(trace.end.toArray(), [shot.x, shot.y, shot.z - 1.2]);
  assert.equal(trace.start.x, shot.x); assert.equal(trace.start.y, shot.y);
  assert.ok(trace.start.z < shot.z && trace.start.z > trace.end.z, 'the confirmed segment stays forward despite the actor moving');
});

test('raider hits and stand drill hits flash, throttle the hurt cue and keep pooled arcs on the shooter as the view turns', () => {
  const { simulation } = raidRoom(), raiders = startRaid(simulation), client = clientHarness('guest', { fakeNow: 1000 });
  client.update(simulation.snapshot()); client.enter(); client.lock();
  const self = simulation.snapshot().players.find(player => player.id === 'guest'), aim = client.aim();
  const hit = (raiderId, fromX, fromZ, absorbed = 0) => ({ event: 'hit', id: 'guest', damage: 7, absorbed, armor: 0, source: 'raider', raiderId, fromX, fromZ });
  client.event(hit('r1', self.x + 10, self.z));
  assert.equal(client.soundCalls.hurt, 1);
  client.frame(1016);
  assert.equal(client.node('damage-flash').style.opacity, .7);
  assert.equal(client.node('damage-arc-0').hidden, false);
  assert.ok(Math.abs(screenAngle(client, 'damage-arc-0') - Math.PI / 2) < 1e-3, 'an east shooter is on the right of a north-facing view');
  client.time(1100); client.event(hit('r1', self.x + 10, self.z)); client.event(hit('r2', self.x - 10, self.z));
  assert.equal(client.soundCalls.hurt, 1, 'one hurt cue per 250 ms');
  client.frame(1116);
  assert.ok(Math.abs(screenAngle(client, 'damage-arc-1') + Math.PI / 2) < 1e-3, 'a second shooter gets its own arc on the left');
  assert.equal(client.node('damage-arc-2').hidden, true, 'a repeat hit refreshes its own arc');
  client.time(1400); client.event(hit('r1', self.x + 10, self.z, 7));
  assert.equal(client.soundCalls.hurt, 2);
  assert.equal(client.node('damage-flash').classList.contains('armor'), true, 'a blow stopped by the vest flashes blue');
  assert.deepEqual(client.aim(), aim, 'hits never move the view');
  client.dispatch('mousemove', { movementX: -(Math.PI / 2) / .0018, movementY: 0 });
  client.frame(1432);
  assert.ok(Math.abs(Math.abs(screenAngle(client, 'damage-arc-0')) - Math.PI) < 1e-3, 'after turning left the east shooter is behind');
  assert.ok(Math.abs(screenAngle(client, 'damage-arc-1')) < 1e-3, 'and the west shooter straight ahead');
  client.time(1500); for (const id of ['r3', 'r4', 'r5']) client.event(hit(id, self.x, self.z - 10));
  client.frame(1516);
  assert.ok([0, 1, 2, 3].every(index => client.node(`damage-arc-${index}`).hidden === false), 'four pooled arcs at most');
  assert.ok(Math.abs(screenAngle(client, 'damage-arc-1') - Math.PI / 2) < 1e-3, 'the fifth shooter replaces the oldest arc');
  client.frame(2500);
  assert.ok([0, 1, 2, 3].every(index => client.node(`damage-arc-${index}`).hidden), 'arcs last 900 ms');
  for (const mesh of client.raiderCalls.map(call => call.mesh)) assert.equal(mesh.userData.attackAt, undefined, 'no zombie swing');
  assert.equal(raiders.length, client.raiderCalls.length);

  const events = [], practice = new RoomSimulation('TRY123', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  practice.addPlayer('guest', 'Invité');
  const drill = clientHarness('guest', { fakeNow: 0 });
  drill.update(practice.snapshot()); drill.enter(); drill.lock();
  assert.equal(practice.practiceAction('guest', { action: 'raiders' }), true);
  for (const event of events) drill.event(event);
  drill.update(practice.snapshot());
  const raid = events.find(event => event.event === 'raid');
  assert.equal(raid.drill, true);
  assert.equal(drill.node('banner-kicker').textContent, 'PILLARDS !');
  assert.equal(drill.node('banner-title').textContent, `Exercice · côté ${sideNames[raid.side]}`);
  assert.match(drill.node('practice-status').textContent, /^Deux pillards/);
  const target = [...practice.zombies.values()].find(zombie => zombie.kind === 'raider');
  for (let index = 0; index < 2; index++) drill.event({ event: 'drill-hit', id: 'guest', raiderId: target.id, fromX: target.x, fromZ: target.z, damage: 7 });
  drill.update(practice.snapshot()); drill.frame(16);
  assert.equal(drill.soundCalls.hurt, 1); assert.equal(drill.node('damage-flash').style.opacity, .7);
  assert.equal(drill.node('damage-arc-0').hidden, false); assert.equal(drill.node('damage-arc-1').hidden, true);
  assert.match(drill.node('wave-details').textContent, /cibles · .* · Touché ×2$/);
  drill.language('en');
  assert.match(drill.node('wave-details').textContent, /targets · .* · Hit ×2$/);
  assert.equal(drill.node('banner-title').textContent, `Drill · ${raid.side} side`);
  drill.language('fr');
  practice.time += 1; events.length = 0;
  assert.equal(practice.practiceAction('guest', { action: 'targets' }), true);
  for (const event of events) drill.event(event);
  drill.update(practice.snapshot());
  assert.doesNotMatch(drill.node('wave-details').textContent, /Touché/, 'fresh targets restart the hit count');
});

test('raid waves warn ahead, announce squads with a pointer, split the HUD and keep the outcome through the break, in both languages', () => {
  const ahead = room(); ahead.start('host'); ahead.wave = RAIDS.waves[0] - 1; ahead.phase = 'intermission'; ahead.timeLeft = 9.2;
  const client = clientHarness('guest', { fakeNow: 0 });
  client.update(ahead.snapshot());
  assert.equal(client.node('wave-details').textContent, '10 s · Ravitaillement effectué · Prochaine vague : pillards');
  client.language('en'); assert.equal(client.node('wave-details').textContent, '10 s · Supplies restored · Next wave: raiders'); client.language('fr');

  const { simulation, events, last } = raidRoom();
  client.update(simulation.snapshot()); client.enter(); client.lock();
  client.event(last('wave'));
  assert.equal(client.node('toast').textContent, `Vague ${String(RAIDS.waves[0]).padStart(2, '0')} : des pillards attaqueront en fin de vague.`);
  assert.equal(client.node('toast').hidden, false);
  assert.match(client.node('wave-details').textContent, /menaces restantes$/, 'before the trigger the count is unchanged');

  const raiders = startRaid(simulation), raid = last('raid');
  client.time(1000); client.event(raid);
  assert.equal(client.node('wave-banner').hidden, false);
  assert.equal(client.node('banner-kicker').textContent, 'PILLARDS !');
  assert.equal(client.node('banner-title').textContent, `Raid 1/${RAIDS.waves.length} · côté ${sideNames[raid.side]}`);
  assert.deepEqual(client.soundCalls.raidAlarms.map(options => options.squad), [false]);
  client.frame(1016);
  const self = simulation.snapshot().players.find(player => player.id === 'guest');
  const centre = { x: raid.entries.reduce((sum, point) => sum + point.x, 0) / raid.entries.length, z: raid.entries.reduce((sum, point) => sum + point.z, 0) / raid.entries.length };
  const bearing = -Math.atan2(-(centre.x - self.x), -(centre.z - self.z));
  assert.equal(client.node('raid-pointer').hidden, false);
  assert.ok(Math.abs(Math.sin(screenAngle(client, 'raid-pointer') - bearing)) < 1e-3, 'the amber pointer aims at the squad entries');
  client.update(simulation.snapshot());
  const live = simulation.snapshot(), infected = live.zombiesRemaining, remaining = live.raid.remaining;
  assert.equal(client.node('wave-details').textContent, `${infected} infecté${infected > 1 ? 's' : ''} · ${remaining} pillard${remaining > 1 ? 's' : ''}`);
  const crowded = simulation.snapshot(); crowded.zombiesRemaining = 2; client.update(crowded);
  assert.equal(client.node('wave-details').textContent, `2 infectés · ${remaining} pillard${remaining > 1 ? 's' : ''}`);
  client.language('en');
  assert.equal(client.node('wave-details').textContent, `2 infected · ${remaining} raider${remaining === 1 ? '' : 's'}`);
  assert.equal(client.node('banner-kicker').textContent, 'RAIDERS!');
  client.language('fr');
  client.frame(5100); assert.equal(client.node('raid-pointer').hidden, true, 'the pointer lasts four seconds');

  simulation.damageSpecialZombie(raiders[0], 1e6, 'guest', { x: 1, y: 0, z: 0 }, 'pistol');
  for (let step = 0; !last('raid-squad') && step < 60; step++) simulation.tick(1 / 30);
  const squad = last('raid-squad');
  client.time(6000); client.event(squad);
  assert.equal(client.node('toast').textContent, `Renforts pillards · côté ${sideNames[squad.side]}`);
  assert.deepEqual(client.soundCalls.raidAlarms.map(options => options.squad), [false, true]);
  client.frame(6016); assert.equal(client.node('raid-pointer').hidden, false);

  for (let step = 0; simulation.phase === 'wave' && step < 900; step++) {
    for (const raider of [...simulation.zombies.values()]) simulation.damageSpecialZombie(raider, 1e6, 'guest', { x: 1, y: 0, z: 0 }, 'pistol');
    simulation.tick(1 / 30);
  }
  assert.equal(simulation.phase, 'intermission');
  const cleared = last('raid-cleared');
  client.time(10000); client.event(cleared); client.update(simulation.snapshot()); client.frame(10000);
  const outcome = `Raid 1/${RAIDS.waves.length} repoussé · ${cleared.killed} pillards abattus · +${cleared.bonus} pièces chacun`;
  assert.equal(client.node('raid-result').hidden, false); assert.equal(client.node('raid-result').textContent, outcome);
  assert.equal(client.node('banner-title').textContent, 'REPRENEZ SOUFFLE', 'the break banner shows as usual');
  for (const seconds of [1, 4]) {
    for (let step = 0; step < seconds * 30; step++) simulation.tick(1 / 30);
    client.time(10000 + seconds * 1000); client.update(simulation.snapshot()); client.frame(10000 + seconds * 1000);
    assert.equal(client.node('raid-result').hidden, false, `still shown ${seconds} s into the break`);
    assert.equal(client.node('raid-result').textContent, outcome);
  }
  assert.equal(client.node('toast').hidden, true, 'it outlives the intermission toast');
  client.language('en');
  assert.equal(client.node('raid-result').textContent, `Raid 1/${RAIDS.waves.length} repelled · ${cleared.killed} raiders down · +${cleared.bonus} coins each`);
  client.language('fr');
  const legacy = simulation.snapshot(); delete legacy.raid; delete legacy.zombiesRemaining; delete legacy.nextRaidWave;
  assert.doesNotThrow(() => client.update(legacy), 'a snapshot without raid fields is tolerated');
  assert.equal(client.node('raid-result').hidden, true);
  legacy.phase = 'wave'; legacy.remaining = 4; assert.doesNotThrow(() => client.update(legacy));
  assert.equal(client.node('wave-details').textContent, '4 menaces restantes');
  assert.equal(events.filter(event => event.event === 'raid-cleared').length, 1);
});

test('a raid wave that also starts a fuel mission keeps both notices in one toast, in both languages', () => {
  const { simulation, events } = raidRoom(), client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot()); client.enter(); client.lock();
  // beginWave announces the mission first, then the raid wave, in the same tick.
  const opening = events.filter(event => event.event === 'fuel-mission' || event.event === 'wave');
  assert.deepEqual(opening.map(event => [event.event, event.wave, event.raid]), [['fuel-mission', 5, undefined], ['wave', 5, 1]]);
  client.time(0);
  for (const event of opening) client.event(event);
  assert.equal(client.node('toast').textContent, 'Le générateur manque de carburant. Une cache est indiquée dehors. Vague 05 : des pillards attaqueront en fin de vague.');
  client.language('en');
  assert.equal(client.node('toast').textContent, 'The generator needs fuel. A cache is marked outside. Wave 05: raiders will attack at the end of the wave.');
  client.language('fr');
  client.frame(6500); assert.equal(client.node('toast').hidden, false, 'the longer notice gets a longer toast');
  client.frame(7100); assert.equal(client.node('toast').hidden, true);
  // Wave 10 with the generator still running: no new mission, the raid warning stands alone.
  const seen = events.length;
  simulation.wave = RAIDS.waves[1] - 1; simulation.beginWave();
  const later = events.slice(seen).filter(event => event.event === 'fuel-mission' || event.event === 'wave');
  assert.deepEqual(later.map(event => [event.event, event.wave, event.raid]), [['wave', 10, 2]]);
  client.time(8000); client.event(later[0]);
  assert.equal(client.node('toast').textContent, 'Vague 10 : des pillards attaqueront en fin de vague.');
  client.language('en'); assert.equal(client.node('toast').textContent, 'Wave 10: raiders will attack at the end of the wave.'); client.language('fr');
});

test('a capped raid retreats with a toast, frees departing voices and reports the withdrawal', () => {
  const { simulation, events, last } = raidRoom(), client = clientHarness('guest', { fakeNow: 0 });
  startRaid(simulation);
  client.update(simulation.snapshot()); client.enter(); client.lock();
  simulation.raid.lastSquadAt = simulation.time - RAIDS.capAfterLastSquad;
  simulation.tick(1 / 30);
  client.time(500); client.event(last('raid-retreat'));
  assert.equal(client.node('toast').textContent, 'Les pillards battent en retraite !');
  client.language('en'); assert.equal(client.node('toast').textContent, 'The raiders are retreating!'); client.language('fr');
  for (let step = 0; simulation.phase === 'wave' && step < 30 * 30; step++) simulation.tick(1 / 30);
  const left = events.filter(event => event.event === 'raider-left');
  assert.ok(left.length > 0);
  for (const event of left) client.event(event);
  assert.deepEqual(client.soundCalls.raiderReleases, left.map(event => event.id));
  assert.equal(simulation.phase, 'intermission');
  client.update(simulation.snapshot());
  const bonus = last('raid-cleared').bonus;
  assert.equal(client.node('raid-result').textContent, bonus > 0 ? `Les pillards se sont repliés · +${bonus} pièces chacun` : 'Les pillards se sont repliés');
  client.language('en');
  assert.match(client.node('raid-result').textContent, /^The raiders have pulled back/);
  client.language('fr');
});

test('the stand offers the raider drill through an acknowledged server action, disabled while the team is paused', () => {
  const client = clientHarness(), simulation = new RoomSimulation('TRY123', { practice: true }); simulation.addPlayer('guest', 'Invité');
  client.update(simulation.snapshot()); client.enter(); client.pause();
  client.node('practice-raiders').onclick();
  assert.deepEqual(client.sent.at(-1), { type: 'practice', action: 'raiders' });
  assert.equal(client.node('practice-status').textContent, '', 'no local effect before the server answers');
  assert.equal(simulation.practiceAction('guest', client.sent.at(-1)), true);
  client.event({ event: 'practice', id: 'guest', action: 'raiders' });
  assert.match(client.node('practice-status').textContent, /^Deux pillards approchent/);
  client.language('en'); assert.match(client.node('practice-status').textContent, /^Two raiders approach/); client.language('fr');
  const paused = simulation.snapshot(); paused.paused = true; client.update(paused);
  assert.equal(client.node('practice-raiders').disabled, true);
});

test('the remaining player can restart after the host leaves a finished game', () => {
  const simulation = room();
  const client = clientHarness();
  simulation.endGame();
  client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, false);
  assert.equal(client.node('restart-button').hidden, true);
  simulation.removePlayer('host');
  client.update(simulation.snapshot());
  assert.equal(client.node('restart-button').hidden, false);
  assert.equal(client.node('results-list').children.length, 1);
});

test('host transfer is announced only when the local player becomes host', () => {
  const simulation = room();
  const host = clientHarness('host');
  host.update(simulation.snapshot());
  simulation.onEvent = message => host.event(message);
  simulation.removePlayer('guest');
  assert.equal(host.node('toast').textContent, '');

  const otherRoom = room();
  const guest = clientHarness();
  guest.update(otherRoom.snapshot());
  otherRoom.onEvent = message => guest.event(message);
  otherRoom.removePlayer('host');
  assert.equal(guest.node('toast').textContent, 'Tu es maintenant l’hôte du refuge.');
});

test('remote restart restores the entry button for a player who stayed in the lobby', () => {
  const simulation = room();
  const client = clientHarness();
  simulation.endGame();
  client.update(simulation.snapshot());
  assert.equal(client.node('lobby').hidden, true);
  simulation.start('host');
  client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, true);
  assert.equal(client.node('lobby').hidden, false);
  assert.equal(client.node('start-button').textContent, 'Entrer dans le refuge ↗');
  client.node('start-button').onclick();
  assert.equal(client.node('hud').hidden, false);
});

test('an open pause menu follows host transfer and the start of the night', () => {
  const simulation = room();
  const client = clientHarness();
  client.update(simulation.snapshot());
  client.enter();
  client.pause();
  assert.equal(client.node('resume-button').textContent, 'Retour au refuge ↗');
  simulation.removePlayer('host');
  client.update(simulation.snapshot());
  assert.equal(client.node('resume-button').textContent, 'Lancer la nuit ↗');
  simulation.start('guest');
  client.update(simulation.snapshot());
  assert.equal(client.node('resume-button').textContent, 'Retour au refuge ↗');
  assert.match(client.node('pause-description').textContent, /La partie continue/);
});

test('Escape explicitly releases the pointer and stops movement and fire', () => {
  const simulation = room();
  const client = clientHarness();
  simulation.start('host');
  client.update(simulation.snapshot());
  client.enter(); client.lock();
  client.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
  client.dispatch('mousedown', { button: 0 });
  assert.equal(client.activity().keys, 1);
  assert.equal(client.activity().firing, true);
  let prevented = false;
  client.dispatch('keydown', { code: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(client.pointerExits(), 1);
  assert.equal(client.activity().keys, 0);
  assert.equal(client.activity().firing, false);
  assert.equal(client.node('pause').hidden, false);
  assert.equal(client.sent.at(-1).type, 'input');
  assert.equal(client.sent.at(-1).forward, 0);
  assert.equal(client.sent.at(-1).strafe, 0);
});

test('repair prompts only appear where the authoritative interaction accepts the player', () => {
  const simulation = room();
  const client = clientHarness();
  simulation.start('host');
  const player = simulation.players.get('guest');
  const door = simulation.doors[0];
  door.hp = door.maxHp - 36;
  client.update(simulation.snapshot()); client.enter();
  Object.assign(player, { x: door.x + 2.3, z: door.z, y: 0 });
  client.update(simulation.snapshot());
  assert.equal(client.node('interaction').hidden, true);
  assert.equal(simulation.interact('guest'), false);
  Object.assign(player, { x: door.x, z: door.z, y: .9 });
  client.update(simulation.snapshot());
  assert.equal(client.node('interaction').hidden, true);
  assert.equal(simulation.interact('guest'), false);
  Object.assign(player, { y: .8, z: door.z + 1 });
  client.update(simulation.snapshot());
  assert.equal(client.node('interaction').hidden, false);
  assert.equal(simulation.interact('guest'), true);
});

test('wallet and crate prompts show the spendable balance and wave locks', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host');
  const player = simulation.players.get('guest');
  const crate = ARMORY.find(item => item.id === 'shotgun');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, z: crate.z + Math.cos(crate.facing) * 1.1, points: 900, score: 1500 });
  client.update(simulation.snapshot()); client.enter(); client.update(simulation.snapshot());
  assert.equal(client.node('points-value').textContent, 900);
  assert.match(client.node('personal-score').textContent, /SCORE 1500/);
  assert.match(client.node('interaction-text').textContent, /Acheter fusil à pompe · 350 pièces/);
  assert.equal(simulation.buyWeapon('guest', 'shotgun'), true);
  client.update(simulation.snapshot());
  assert.equal(client.node('points-value').textContent, 550);
  assert.match(client.node('personal-score').textContent, /SCORE 1500/);
  assert.match(client.node('interaction-text').textContent, /déjà possédée/);
  const bonus = ARMORY.find(item => item.id === 'minigun');
  // Approach the Gatling itself, clear of the neighbouring south pistol rack.
  Object.assign(player, { x: bonus.x + Math.sin(bonus.facing) * .65, z: bonus.z + Math.cos(bonus.facing) * .65 });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  client.update(simulation.snapshot());
  assert.match(client.node('interaction-text').textContent, new RegExp(`disponible vague ${bonus.unlockWave}`));
});

test('weapon keys cannot equip an unpurchased weapon and Space reaches authoritative input', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
  const before = client.sent.length;
  client.dispatch('keydown', { code: 'Digit2', repeat: false });
  assert.equal(client.sent.length, before);
  assert.match(client.node('toast').textContent, /râtelier/);
  client.dispatch('keydown', { code: 'Digit1', repeat: false });
  assert.equal(client.sent.length, before, 'selecting the equipped slot sends no redundant command');
  client.dispatch('keydown', { code: 'Space', repeat: false, preventDefault() {} });
  assert.equal(client.input().jump, true);
  client.dispatch('keydown', { code: 'Escape', preventDefault() {} });
  assert.equal(client.sent.at(-1).jump, false);
});

test('purchase feedback is only shown to its buyer', () => {
  const client = clientHarness();
  client.event({ event: 'purchase-denied', id: 'host', message: 'Refus' });
  assert.equal(client.node('toast').textContent, '');
  client.event({ event: 'purchase-denied', id: 'guest', message: 'Il te manque 100 pièces.' });
  assert.equal(client.node('toast').textContent, 'Il te manque 100 pièces.');
  client.event({ event: 'purchase', id: 'guest', weapon: 'minigun', price: 2800 });
  assert.match(client.node('toast').textContent, /MINIGUN achetée · −2800/);
});

test('replacement preserves slot numbers and independent ammunition, with wheel switching', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); const player = simulation.players.get('guest');
  const buy = weapon => {
    const crate = ARMORY.find(item => item.weapon === weapon);
    simulation.wave = Math.max(simulation.wave, crate.unlockWave);
    simulation.time += 1; Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
    assert.equal(simulation.buyWeapon('guest', crate.id), true); client.update(simulation.snapshot());
  };
  buy('rifle'); simulation.chooseWeapon('guest', 'pistol');
  Object.assign(player.inventory.rifle, { ammo: 9, reserve: 17 });
  buy('shotgun'); client.enter(); client.lock(); client.update(simulation.snapshot());
  assert.match(client.node('weapon-slot-1').textContent, /^1 FUSIL À POMPE/);
  assert.equal(client.node('weapon-slot-2').textContent, `2 MITRAILLEUSE · 9/${WEAPONS.rifle.magazine} · RÉSERVE 17`);
  client.dispatch('keydown', { code: 'Digit2', repeat: false });
  assert.equal(client.sent.at(-1).weapon, 'rifle');
  simulation.chooseWeapon('guest', 'rifle'); client.update(simulation.snapshot());
  assert.equal(client.node('ammo-value').textContent, 9); assert.equal(client.node('reserve-value').textContent, 17);
  let prevented = 0;
  client.dispatch('wheel', { deltaY: 1, preventDefault() { prevented++; } });
  assert.equal(client.sent.at(-1).weapon, 'shotgun'); assert.equal(prevented, 1);
  client.pause(); const before = client.sent.length;
  client.dispatch('wheel', { deltaY: 1, preventDefault() { prevented++; } });
  assert.equal(client.sent.length, before); assert.equal(prevented, 1);
});

test('duplicate weapons have one active slot, independent HUD stocks and instance selection by keys and wheel', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  let state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { weapon: 'pistol', weaponId: 'pistol', ammo: 3, reserve: 7, magazine: 12,
    ownedWeapons: ['pistol', 'pistol'], weapons: [
      { id: 'pistol', weapon: 'pistol', ammo: 3, reserve: 7, magazine: 12 },
      { id: 'pistol#2', weapon: 'pistol', ammo: 9, reserve: 25, magazine: 12 },
    ] });
  client.update(state); client.enter(); client.lock(); client.update(state);
  assert.equal(client.node('weapon-slot-1').classList.contains('active'), true);
  assert.equal(client.node('weapon-slot-2').classList.contains('active'), false);
  assert.match(client.node('weapon-slot-2').textContent, /9\/12.*25/);
  client.dispatch('keydown', { code: 'Digit2', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'weapon', weapon: 'pistol', weaponId: 'pistol#2' });
  assert.equal(client.node('ammo-value').textContent, 3, 'selection waits for the authority');
  state = structuredClone(state); self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { weaponId: 'pistol#2', ammo: 9, reserve: 25 }); client.update(state);
  assert.equal(client.node('ammo-value').textContent, 9); assert.equal(client.node('reserve-value').textContent, 25);
  assert.equal(client.node('weapon-slot-1').classList.contains('active'), false);
  assert.equal(client.node('weapon-slot-2').classList.contains('active'), true);
  assert.match(client.node('weapon-slot-1').textContent, /3\/12.*7/);
  const before = client.sent.length; client.dispatch('keydown', { code: 'Digit2', repeat: false });
  assert.equal(client.sent.length, before, 'selected copy sends no redundant command');
  client.dispatch('wheel', { deltaY: 1, preventDefault() {} });
  assert.deepEqual(client.sent.at(-1), { type: 'weapon', weapon: 'pistol' }, 'cycling past the duplicate returns to the first slot');
  client.dispatch('keydown', { code: 'Digit1', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'weapon', weapon: 'pistol' });
  const dropped = { id: 'floor-pistol', kind: 'weapon', weapon: 'pistol', ammo: 4, reserve: 6, x: self.x, y: self.y, z: self.z };
  state.pickups = [dropped]; self.nearbyWeaponId = dropped.id;
  self.weapons.pop(); self.weaponId = 'pistol'; self.ammo = 3; self.reserve = 7; client.update(state);
  assert.match(client.node('interaction-text').textContent, /Ramasser PISTOLET/);
  assert.doesNotMatch(client.node('interaction-text').textContent, /déjà/);
});

test('Xbox cycles duplicate weapon instances and leaves the selected stock authoritative', () => {
  const f = controllerClient();
  Object.assign(f.self, { weapon: 'pistol', weaponId: 'pistol', ammo: 3, reserve: 5,
    ownedWeapons: ['pistol', 'pistol'], weapons: [
      { id: 'pistol', weapon: 'pistol', ammo: 3, reserve: 5 },
      { id: 'pistol#2', weapon: 'pistol', ammo: 8, reserve: 19 },
    ] });
  f.client.update(f.state); f.button('cycle');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'weapon').at(-1), { type: 'weapon', weapon: 'pistol', weaponId: 'pistol#2' });
  assert.equal(f.self.weaponId, 'pistol'); assert.equal(f.self.ammo, 3);
  f.button('cycle', false); f.self.weaponId = 'pistol#2'; f.self.ammo = 8; f.self.reserve = 19; f.client.update(f.state);
  f.button('previous');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'weapon').at(-1), { type: 'weapon', weapon: 'pistol' });
});

test('an authoritative switch between two snipers clears scope and the previous copy reload audio', () => {
  const f = arsenalClient('sniper', 'sniper');
  Object.assign(f.self, { weaponId: 'sniper', weapons: [
    { id: 'sniper', weapon: 'sniper', ammo: 4, reserve: 3, magazine: 5 },
    { id: 'sniper#2', weapon: 'sniper', ammo: 2, reserve: 9, magazine: 5 },
  ], ammo: 4, reserve: 3 });
  f.client.update(f.state);
  f.client.dispatch('keydown', { code: 'KeyR', repeat: false });
  f.client.event({ event: 'reload', id: 'guest', weapon: 'sniper', duration: 2 });
  assert.equal(f.client.soundCalls.activeReload?.type, 'sniper');
  f.client.dispatch('mousedown', { button: 2, preventDefault() {} });
  assert.equal(f.client.aim().scoped, true);
  const switched = structuredClone(f.state), next = switched.players.find(player => player.id === 'guest');
  Object.assign(next, { weaponId: 'sniper#2', ammo: 2, reserve: 9 }); f.client.update(switched);
  assert.equal(f.client.aim().scoped, false); assert.equal(f.client.soundCalls.activeReload, null);
  assert.equal(f.client.node('ammo-value').textContent, 2);
});

test('crate prompts explain replacement and abandoned weapons before spending points', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest');
  for (const weapon of ['rifle', 'shotgun']) {
    const crate = ARMORY.find(item => item.weapon === weapon);
    simulation.wave = Math.max(simulation.wave, crate.unlockWave);
    simulation.time += 1; Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
    client.update(simulation.snapshot()); client.enter(); client.update(simulation.snapshot());
    if (weapon === 'shotgun') assert.match(client.node('interaction-text').textContent, /remplace mitrailleuse/);
    assert.equal(simulation.buyWeapon('guest', crate.id), true);
  }
  const rifle = ARMORY.find(item => item.weapon === 'rifle');
  Object.assign(player, { x: rifle.x + Math.sin(rifle.facing) * 1.1, y: rifle.y, z: rifle.z + Math.cos(rifle.facing) * 1.1, points: rifle.price }); client.update(simulation.snapshot());
  assert.match(client.node('interaction-text').textContent, /abandonnée.*prochaine vague/);
});

test('pickup models follow server positions and disappear once collected, expired or disconnected', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const state = simulation.snapshot();
  state.pickups = [{ id: 'cash', kind: 'points', x: 0, y: 3.4, z: -3, amount: 140, special: false }, { id: 'ammo', kind: 'ammo', x: 1, y: 0, z: 2, amount: 1, special: true }];
  client.update(state);
  assert.equal(client.pickupCount(), 2); assert.equal(client.pickupCalls.length, 2);
  assert.equal(client.pickupCalls[0].mesh.position.y, 3.4); assert.equal(client.pickupCalls[1].special, true);
  client.update(state); assert.equal(client.pickupCalls.length, 2, 'stable snapshots reuse shared models');
  state.pickups = state.pickups.slice(1); client.update(state); assert.equal(client.pickupCount(), 1);
  state.pickups = []; client.update(state); assert.equal(client.pickupCount(), 0);
  state.pickups = [{ id: 'new', kind: 'points', x: 0, y: 0, z: 0 }]; client.update(state);
  client.leave(); assert.equal(client.pickupCount(), 0);
});

test('combat score does not become spendable money until the actual drop is collected', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host'); simulation.timeLeft = 999;
  const player = simulation.players.get('guest'); Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: 0 });
  simulation.zombies.set('target', { id: 'target', x: -4.4, y: .4, z: -2, hp: 24, maxHp: 24, kind: 'walker', scale: 1 });
  client.update(simulation.snapshot()); client.enter(); simulation.onEvent = event => client.event(event);
  assert.equal(simulation.shoot('guest'), true);
  simulation.time += .05; simulation.updateBullets(.05); client.update(simulation.snapshot());
  assert.equal(client.node('points-value').textContent, 0); assert.match(client.node('personal-score').textContent, /SCORE 24/, 'the 24 HP it had (owner, 18 October)');
  assert.equal(client.pickupCount(), 1);
  Object.assign(player, { x: -4.4, y: 0, z: -2 }); simulation.tick(); client.update(simulation.snapshot());
  assert.equal(client.node('points-value').textContent, ECONOMY.kill); assert.equal(client.pickupCount(), 0);
  assert.equal(client.node('pickup-notice').textContent, `+${ECONOMY.kill} PIÈCES RAMASSÉES`);
  client.event({ event: 'pickup', id: 'host', kind: 'points', amount: 999 });
  assert.equal(client.node('pickup-notice').textContent, `+${ECONOMY.kill} PIÈCES RAMASSÉES`);
  client.event({ event: 'pickup', id: 'guest', kind: 'ammo', ammo: [{ weapon: 'pistol', amount: 4 }] });
  assert.equal(client.node('pickup-notice').textContent, 'MUNITIONS · PISTOLET +4');
  client.leave(); assert.equal(client.node('pickup-notice').hidden, true);
});

test('partial boxes keep their model and fill while local notices and medkits follow language changes', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const state = simulation.snapshot();
  state.pickups = [{ id: 'leftover', kind: 'ammo', x: 0, y: 0, z: 0, special: false, fill: 1 },
    { id: 'medical', kind: 'health', x: 1, y: 0, z: 0, special: false }];
  client.update(state); client.enter();
  const box = client.pickupCalls[0].mesh;
  state.pickups[0].fill = .9; client.update(state);
  assert.equal(client.pickupCalls.length, 2); assert.equal(client.pickupCount(), 2);
  assert.equal(box.userData.fill, .9); assert.equal(client.pickupCalls[1].kind, 'health');
  client.event({ event: 'pickup', id: 'guest', kind: 'ammo', removed: false, remainingFill: .9, ammo: [{ weapon: 'rifle', amount: 1 }] });
  assert.equal(client.node('pickup-notice').textContent, 'MUNITIONS · MITRAILLEUSE +1 · BOÎTE : RESTE 90 %');
  client.language('en');
  assert.equal(client.node('pickup-notice').textContent, 'AMMO · MACHINE GUN +1 · BOX: 90% LEFT');
  client.event({ event: 'pickup', id: 'host', kind: 'health', healed: 50 });
  assert.match(client.node('pickup-notice').textContent, /90% LEFT/);
  client.event({ event: 'pickup', id: 'guest', kind: 'health', healed: 63 });
  assert.equal(client.node('pickup-notice').textContent, 'MEDKIT · +63 HP · HEALTH RESTORED');
  client.language('fr');
  assert.equal(client.node('pickup-notice').textContent, 'MÉDIKIT · +63 VIE · VIE RÉTABLIE');
  state.pickups = [state.pickups[0]]; client.update(state);
  assert.equal(client.pickupCount(), 1); assert.equal(box.userData.fill, .9);
  state.pickups = []; client.update(state); assert.equal(client.pickupCount(), 0);
});

test('confirmed local automatic shots request held audio and authoritative empty or down state releases it', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest'), crate = ARMORY.find(item => item.weapon === 'rifle');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price }); assert.equal(simulation.buyWeapon('guest', crate.id), true);
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.dispatch('mousedown', { button: 0 });
  client.event({ event: 'shot', id: 'guest', weapon: 'rifle' });
  assert.deepEqual(client.soundCalls.shotOptions.at(-1), { type: 'rifle', held: true });
  client.event({ event: 'shot', id: 'host', weapon: 'rifle', x: player.x, z: player.z, yaw: 0, pitch: 0 });
  assert.deepEqual(client.soundCalls.shotOptions.at(-1), { type: 'rifle', held: false });
  player.inventory.rifle.ammo = 0; client.update(simulation.snapshot());
  assert.equal([...client.soundCalls.burstVoices.values()].some(voice => voice.voiceId === 'guest' && voice.type === 'rifle'), false, 'empty authority stops the owner voice');
  assert.equal([...client.soundCalls.burstVoices.values()].some(voice => voice.voiceId === 'host' && voice.type === 'rifle'), true, 'a separate distant voice retains its own watchdog');
  player.inventory.rifle.ammo = 5; client.update(simulation.snapshot()); client.event({ event: 'shot', id: 'guest', weapon: 'rifle' });
  assert.equal(client.soundCalls.activeBursts.rifle, true);
  player.downed = true; client.update(simulation.snapshot());
  assert.equal(client.soundCalls.activeBursts.rifle, false);
});

test('confirmed shotgun shots pump once per shooter, survive trigger release and stop on reload, switch and pause', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const player = simulation.players.get('guest');
  player.inventory.shotgun = { ammo: 5, reserve: 5 }; player.weapon = 'shotgun';
  client.update(simulation.snapshot()); client.enter(); client.lock();
  client.dispatch('mousedown', { button: 0 });client.dispatch('mouseup', { button: 0 });
  assert.equal(client.soundCalls.shoot, 0, 'input alone cannot play a pump before authoritative confirmation');
  client.event({ event: 'shot', id: 'guest', weapon: 'shotgun', hits: 0 });
  assert.equal(client.soundCalls.shoot, 1);assert.equal(client.soundCalls.shotVoiceIds.at(-1), 'guest');
  assert.equal(client.soundCalls.activePumps.has('guest'), true);
  const releases = client.soundCalls.pumpReleases.length;
  client.dispatch('mouseup', { button: 0 });client.update(simulation.snapshot());
  assert.equal(client.soundCalls.activePumps.has('guest'), true, 'the post-shot cycle remains audible after a quick click');
  assert.ok(client.soundCalls.pumpReleases.slice(releases).every(id => id !== 'guest' && id !== undefined));
  client.event({ event: 'shot', id: 'host', weapon: 'shotgun', x: player.x, z: player.z });
  assert.equal(client.soundCalls.shoot, 2);assert.equal(client.soundCalls.shotVoiceIds.at(-1), 'host');
  assert.equal(client.soundCalls.activePumps.size, 2);
  client.dispatch('keydown', { code: 'KeyR', repeat: false });
  assert.equal(client.soundCalls.activePumps.has('guest'), false);assert.equal(client.soundCalls.activePumps.has('host'), true);
  client.dispatch('keyup', { code: 'KeyR' });client.dispatch('mousedown', { button: 0 });
  client.event({ event: 'shot', id: 'guest', weapon: 'shotgun', hits: 0 });
  client.dispatch('keydown', { code: 'Digit1', repeat: false });assert.equal(client.soundCalls.activePumps.has('guest'), false);
  client.dispatch('mousedown', { button: 0 });client.event({ event: 'shot', id: 'guest', weapon: 'shotgun', hits: 0 });
  client.pause();assert.equal(client.soundCalls.activePumps.size, 0);
  const confirmed = client.soundCalls.shoot;client.event({ event: 'shot', id: 'guest', weapon: 'shotgun', hits: 0 });
  assert.equal(client.soundCalls.shoot, confirmed, 'late local confirmation cannot restart a paused pump');
});

test('empty bonus weapons explain ammunition pickups while normal controls remain available', () => {
  for (const weapon of ['minigun', 'magnum']) {
    const simulation = room(), client = clientHarness();
    simulation.start('host');
    const player = simulation.players.get('guest');
    const crate = ARMORY.find(item => item.weapon === weapon);
    simulation.wave = crate.unlockWave;
    Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price });
    assert.equal(simulation.buyWeapon('guest', crate.id), true);
    Object.assign(player.inventory[weapon], { ammo: 0, reserve: 0 });
    client.update(simulation.snapshot()); client.enter(); client.lock();
    assert.match(client.node('reload-status').textContent, /ÉPUISÉE.*BOÎTE DE MUNITIONS/);
    assert.equal(client.node('crosshair').hidden, false);
    client.dispatch('keydown', { code: 'KeyW', repeat: false });
    assert.equal(client.input().forward, 1);
    player.inventory[weapon].reserve = 1;
    client.update(simulation.snapshot());
    assert.equal(client.node('reload-status').textContent, 'CHARGEUR VIDE · R POUR RECHARGER');
  }
});

function extract(simulation) {
  simulation.start('host');
  simulation.phase = 'wave'; simulation.wave = MAX_WAVES; simulation.toSpawn = 0; simulation.zombies.clear();
  assert.equal(simulation.beginExtraction(), true);
}

function finishExtraction(simulation) {
  for (let index = 0; index < 370; index++) simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'victory');
}

test('HUD shows progress to the final wave and the server headshot multiplier', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); client.update(simulation.snapshot());
  assert.equal(client.node('wave-number').textContent, `01/${MAX_WAVES}`);
  const compatibility = simulation.snapshot();delete compatibility.maxWaves;client.update(compatibility);
  assert.equal(client.node('wave-number').textContent, `01/${MAX_WAVES}`, 'older snapshots use the shared current endpoint');
  assert.match(client.node('combat-tip').textContent, /TÊTE ×2\.2/);
  simulation.wave = MAX_WAVES; client.update(simulation.snapshot());
  assert.equal(client.node('wave-number').textContent, `${MAX_WAVES}/${MAX_WAVES}`);
  assert.match(client.node('combat-tip').textContent, /TÊTE ×2\.2/);
  assert.match(client.node('combat-tip').textContent, /ALIGNE LES ZOMBIES/);
});

test('extraction freezes controls, closes pause and keeps the cinematic rendering without pointer lock', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host'); client.update(simulation.snapshot()); client.enter(); client.lock();
  client.dispatch('keydown', { code: 'KeyW', repeat: false });
  client.dispatch('mousedown', { button: 0 }); client.pause();
  extract(simulation); client.update(simulation.snapshot());
  assert.equal(client.node('pause').hidden, true);
  assert.equal(client.node('gameover').hidden, true);
  assert.equal(client.node('hud').hidden, false);
  assert.equal(client.node('crosshair').hidden, true);
  assert.equal(client.node('combat-tip').hidden, true);
  assert.equal(client.node('interaction').hidden, true);
  assert.equal(client.activity().keys, 0);
  assert.equal(client.activity().firing, false);
  assert.equal(client.input().forward, 0);
  assert.match(client.node('wave-details').textContent, /12 s.*hélicoptère/);
  const before = client.sent.length;
  for (const code of ['KeyW', 'KeyE', 'KeyR', 'Digit1', 'Space', 'Escape']) {
    client.dispatch('keydown', { code, repeat: false, preventDefault() {} });
  }
  client.dispatch('mousedown', { button: 0 }); client.pause();
  assert.equal(client.sent.length, before);
  assert.equal(client.activity().firing, false);
  assert.equal(client.node('pause').hidden, true);
  client.dispatch('pointerlockchange', {});
  const afterUnlock = client.sent.length;
  client.frame(performance.now() + 1500);
  assert.equal(client.sent.length, afterUnlock);
  assert.ok(client.renders() > 0);
  assert.ok(client.extractionCalls.updates.at(-1).elapsed >= 1.5);
  assert.equal(client.extractionCalls.updates.at(-1).duration, 12);
  assert.equal(client.soundCalls.extraction, 1);
  client.update(simulation.snapshot());
  assert.equal(client.soundCalls.extraction, 1);
});

test('victory shows actual team results and host transfer enables restart', () => {
  const simulation = room(), client = clientHarness();
  extract(simulation);
  Object.assign(simulation.players.get('host'), { kills: 20, score: 2800 });
  Object.assign(simulation.players.get('guest'), { kills: 12, score: 1800 });
  client.update(simulation.snapshot()); finishExtraction(simulation); client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, false);
  assert.equal(client.node('pause').hidden, true);
  assert.equal(client.node('gameover-title').textContent, 'Vous êtes rentrés.');
  assert.equal(client.node('gameover-eyebrow').textContent, 'LE JOUR S’EST LEVÉ');
  assert.match(client.node('gameover-result').textContent, new RegExp(`${MAX_WAVES} vagues.*32 éliminations.*4600`));
  assert.equal(client.node('results-list').children.length, 2);
  assert.equal(client.node('restart-button').hidden, true);
  assert.equal(client.node('results-wait').hidden, false);
  assert.equal(client.soundCalls.victory, 1);
  const before = client.sent.length;
  client.node('restart-button').onclick();
  assert.equal(client.sent.length, before);
  simulation.removePlayer('host'); client.update(simulation.snapshot());
  assert.equal(client.node('restart-button').hidden, false);
  assert.equal(client.node('results-wait').hidden, true);
  assert.equal(client.soundCalls.victory, 1);
  client.node('restart-button').onclick();
  assert.equal(client.sent.at(-1).type, 'restart');
  assert.equal(client.node('gameover').hidden, false);
  assert.equal(client.node('restart-button').disabled, true);
  assert.equal(simulation.start('guest'), true); client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, true);
  assert.equal(client.node('restart-button').disabled, false);
  assert.equal(client.node('hud').hidden, false);
  assert.equal(client.node('crosshair').hidden, false);
  assert.equal(client.node('wave-number').textContent, `01/${MAX_WAVES}`);
  assert.ok(client.extractionCalls.resets > 0);
});

test('remote restart after victory restores the lobby for a late arrival', () => {
  const simulation = room(), client = clientHarness();
  extract(simulation); finishExtraction(simulation);
  client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, false);
  assert.equal(client.node('lobby').hidden, true);
  assert.equal(simulation.start('host'), true); client.update(simulation.snapshot());
  assert.equal(client.node('gameover').hidden, true);
  assert.equal(client.node('lobby').hidden, false);
  assert.equal(client.node('start-button').textContent, 'Entrer dans le refuge ↗');
  assert.ok(client.extractionCalls.resets > 0);
});

test('late extraction arrival watches the remaining cinematic instead of opening pause', () => {
  const simulation = room(), client = clientHarness();
  extract(simulation); simulation.tick(.1);
  client.update(simulation.snapshot());
  assert.equal(client.node('lobby').hidden, true);
  assert.equal(client.node('hud').hidden, false);
  assert.equal(client.node('pause').hidden, true);
  client.frame(performance.now());
  assert.ok(client.extractionCalls.updates.at(-1).elapsed >= .1);
  assert.equal(client.input().forward, 0);
  client.pause(); assert.equal(client.node('pause').hidden, true);
});

test('disconnect during extraction resets the scene and reconnecting to victory shows the right result', () => {
  const simulation = room(), client = clientHarness();
  extract(simulation);
  client.connect();
  const first = client.sockets.at(-1);
  first.emit('open');
  first.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123' }) });
  first.emit('message', { data: JSON.stringify(simulation.snapshot()) });
  assert.equal(client.node('hud').hidden, false);
  const before = client.extractionCalls.resets;
  first.close();
  assert.equal(client.node('menu').hidden, false);
  assert.equal(client.node('gameover').hidden, true);
  assert.ok(client.extractionCalls.resets > before);
  assert.match(client.node('menu-error').textContent, /connexion.*coupée/i);
  simulation.removePlayer('guest'); simulation.addPlayer('returning', 'De retour'); finishExtraction(simulation);
  client.connect();
  const second = client.sockets.at(-1);
  second.emit('open');
  second.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'returning', room: 'ABC123' }) });
  second.emit('message', { data: JSON.stringify(simulation.snapshot()) });
  assert.equal(client.node('menu').hidden, true);
  assert.equal(client.node('gameover').hidden, false);
  assert.equal(client.node('gameover-title').textContent, 'Vous êtes rentrés.');
  assert.equal(client.node('restart-button').hidden, true);
  assert.equal(client.node('results-list').children.length, 2);
});

function outdoorState(simulation, playerOptions = {}, phase = 'wave') {
  const state = simulation.snapshot();
  Object.assign(state, { phase, outsideDamagePerSecond: 3 });
  Object.assign(state.players.find(player => player.id === 'guest'), { outside: true, outsideDamageActive: true, ...playerOptions });
  return state;
}

test('outdoor warning shows the drain without toast spam and disappears on re-entry', () => {
  const simulation = room(), client = clientHarness();
  const state = outdoorState(simulation);
  client.update(state); client.enter();
  assert.equal(client.node('outside-warning').hidden, false);
  assert.equal(client.node('outside-title').textContent, 'PLUIE CORROSIVE · −3 VIE/S');
  assert.match(client.node('outside-detail').textContent, /parapluie.*toit/);
  const initialToast = client.node('toast').textContent;
  for (let index = 0; index < 5; index++) client.update(state);
  assert.equal(client.node('toast').textContent, initialToast);
  client.update(outdoorState(simulation, { outside: false, outsideDamageActive: false }));
  assert.equal(client.node('outside-warning').hidden, true);
  assert.equal(client.node('toast').textContent, initialToast);
});

test('B uses an acknowledged umbrella state, blocks combat and keeps protection through pause', () => {
  const simulation = room(), client = clientHarness();
  const state = outdoorState(simulation, { rainExposed: true, grenades: 2 });
  client.update(state); client.enter(); client.lock();
  client.dispatch('keydown', { code: 'KeyB', repeat: false });
  client.dispatch('keydown', { code: 'KeyB', repeat: true });
  assert.deepEqual(client.sent.filter(message => message.type === 'umbrella'), [{ type: 'umbrella', open: true }]);
  assert.equal(client.node('umbrella-label').textContent, 'PARAPLUIE REPLIÉ', 'no optimistic protection before server acknowledgement');
  Object.assign(state.players.find(player => player.id === 'guest'), { umbrella: { open: true, remaining: 42 }, outsideDamageActive: false });
  client.update(state);
  assert.equal(client.node('umbrella-label').textContent, 'PARAPLUIE OUVERT');
  assert.equal(client.node('umbrella-remaining').textContent, '42 s DE PROTECTION');
  assert.equal(client.node('outside-title').textContent, 'PLUIE · PROTÉGÉ');
  client.dispatch('mousedown', { button: 0 }); client.dispatch('mousedown', { button: 2 });
  client.dispatch('keydown', { code: 'KeyG', repeat: false }); client.frame(performance.now());
  assert.equal(client.activity().firing, false);
  assert.equal(client.sent.some(message => ['shoot', 'melee', 'grenade', 'minigun-spin'].includes(message.type)), false);
  client.pause();
  assert.deepEqual(client.sent.filter(message => message.type === 'umbrella'), [{ type: 'umbrella', open: true }]);
  client.language('en');
  assert.equal(client.node('umbrella-label').textContent, 'UMBRELLA OPEN');
  client.event({ event: 'umbrella-denied', id: 'guest', reason: 'recovery' });
  assert.equal(client.node('toast').textContent, 'Finish your action before opening the umbrella.');
  client.lock(); client.dispatch('keydown', { code: 'KeyB', repeat: false });
  assert.deepEqual(client.sent.filter(message => message.type === 'umbrella').at(-1), { type: 'umbrella', open: false });
});

test('fuel guidance follows the unique carrier, translates actions and clears at the ending', () => {
  const simulation = room(), client = clientHarness();
  const state = outdoorState(simulation);
  state.expedition.generator = { x: -6.4, y: 0, z: 4.7, power: .2, active: true };
  state.expedition.fuel = { x: -15, y: 0, z: 10, carrierId: null };
  const self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { x: -16, y: 0, z: 10, expeditionAction: 'take-fuel' });
  client.update(state); client.enter(); client.update(state);
  assert.match(client.node('interaction-text').textContent, /Prendre le bidon/);
  assert.equal(client.node('generator-bar').style.width, '20%');
  assert.equal(client.node('fuel-direction').textContent, 'E · 1 m');
  state.expedition.fuel.carrierId = 'guest'; self.carryingFuel = true; self.expeditionAction = 'deliver-fuel';
  client.update(state);
  assert.match(client.node('fuel-objective').textContent, /RETOUR AU GÉNÉRATEUR/);
  assert.match(client.node('interaction-text').textContent, /Ravitailler/);
  client.language('en');
  assert.equal(client.node('interaction-text').textContent, 'Refuel the generator');
  self.carryingFuel = false; state.expedition.fuel.carrierId = 'host'; client.update(state);
  assert.equal(client.node('fuel-objective').textContent, 'Hôte IS CARRYING FUEL');
  client.event({ event: 'deliver-fuel', id: 'host' });
  assert.match(client.node('toast').textContent, /lights are back/);
  state.phase = 'victory'; client.update(state);
  assert.equal(client.node('expedition-kit').hidden, true);
  assert.equal(client.node('expedition-objective').hidden, true);
});

test('outdoor scouting is harmless in the lobby and terminal phases hide the warning', () => {
  const simulation = room(), client = clientHarness();
  client.update(outdoorState(simulation, { outsideDamageActive: false }, 'lobby')); client.enter();
  assert.equal(client.node('outside-title').textContent, 'DEHORS · REPÉRAGE');
  assert.match(client.node('outside-detail').textContent, /sans perdre de vie/);
  for (const phase of ['extraction', 'victory', 'gameover']) {
    client.update(outdoorState(simulation, { outsideDamageActive: false }, phase));
    assert.equal(client.node('outside-warning').hidden, true, phase);
  }
  client.update(outdoorState(simulation, { alive: false, downed: true, outsideDamageActive: false }));
  assert.equal(client.node('outside-warning').hidden, true);
});

test('a downed outdoor survivor sees revival guidance and outdoor damage feedback stays restrained', () => {
  const simulation = room(), client = clientHarness();
  client.update(outdoorState(simulation)); client.enter();
  for (let index = 0; index < 10; index++) client.event({ event: 'hit', id: 'guest', source: 'outside', damage: 3 });
  assert.equal(client.soundCalls.hurt, 1);
  assert.equal(client.node('toast').textContent, '');
  client.event({ event: 'hit', id: 'guest', source: 'zombie', damage: 11 });
  assert.equal(client.soundCalls.hurt, 2);
  client.event({ event: 'hit', id: 'host', source: 'outside', damage: 3 });
  assert.equal(client.soundCalls.hurt, 2);
  client.update(outdoorState(simulation, { downed: true, hp: 0, outsideDamageActive: false, bleedOutLeft: 22 }));
  assert.equal(client.node('outside-title').textContent, 'À TERRE DEHORS');
  assert.match(client.node('outside-detail').textContent, /te relever ici.*−3 vie\/s/);
  assert.match(client.node('downed').lastElementChild.textContent, /même dehors.*Rentre après la réanimation.*22 s/);
  client.event({ event: 'down', id: 'guest', source: 'outside' });
  assert.match(client.node('toast').textContent, /à terre dehors.*Rentre ensuite/);
  client.event({ event: 'down', id: 'host', source: 'outside' });
  assert.match(client.node('toast').textContent, /Hôte.*à terre dehors.*presse E/);
});

test('individual board health reaches the rendered door and repair prompt describes the opening', () => {
  const simulation = room(), client = clientHarness();
  simulation.start('host');
  const state = simulation.snapshot();
  const door = state.doors.find(item => item.id === 'north');
  Object.assign(door, { hp: 24, maxHp: 120, boards: [0, 0, 0, 0, 24] });
  Object.assign(state.players.find(player => player.id === 'guest'), { x: door.x, y: 0, z: door.z + 1 });
  client.update(state); client.enter(); client.update(state);
  const rendered = client.boardCalls.findLast(item => item.id === door.id);
  assert.deepEqual(rendered.boards, door.boards);
  assert.equal(rendered.ratio, .2);
  assert.equal(client.node('door-status').textContent, '1 BRÈCHE');
  assert.equal(client.node('breach-alert').hidden, false, 'a breach shows its alert');
  assert.match(client.node('interaction-text').textContent, /Réparer.*1\/5 planches/);
  const broken = [0, 0, 0, 0, 0];
  client.event({ event: 'board', id: 'guest', doorId: 'north', boardIndex: 4, hp: 0, boards: broken });
  assert.deepEqual(client.boardCalls.at(-1), { id: 'north', ratio: 0, boards: broken });
  assert.equal(client.soundCalls.boardBreak, 1);
  client.event({ event: 'board', id: 'guest', doorId: 'north', boardIndex: 4, hp: 0, boards: broken });
  assert.equal(client.soundCalls.boardBreak, 1, 'repeated destruction must not replay the sound');
  Object.assign(door, { hp: 120, boards: [24, 24, 24, 24, 24] }); client.update(state);
  assert.deepEqual(client.boardCalls.findLast(item => item.id === door.id).boards, [24, 24, 24, 24, 24]);
  assert.equal(client.node('door-status').textContent, '4 ACCÈS TENUS');
  assert.equal(client.node('breach-alert').hidden, true, 'no alert while every entrance holds');
  client.event({ event: 'repair-blocked', id: 'guest', message: 'Dégage le passage avant de réparer.' });
  assert.equal(client.node('toast').textContent, 'Dégage le passage avant de réparer.');
  client.event({ event: 'repair-blocked', id: 'host', message: 'Message pour un autre joueur.' });
  assert.equal(client.node('toast').textContent, 'Dégage le passage avant de réparer.');
});

test('an armor vest shows under health, in the team list and in its pickup notice, in both languages', () => {
  const simulation = room(), client = clientHarness(); simulation.start('host');
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  state.pickups = [{ id: 'vest', kind: 'armor', x: 1, y: 0, z: 0, special: false }];
  client.update(state); client.enter();
  assert.equal(client.pickupCalls.at(-1).kind, 'armor');
  assert.equal(client.node('armor-row').hidden, true, 'no armor, no row');
  self.armor = 68; client.update(state);
  assert.equal(client.node('armor-row').hidden, false);
  assert.equal(client.node('armor-value').textContent, 68);
  assert.equal(client.node('armor-bar').style.width, '68%');
  const rows = client.node('team-list').children, guest = rows[state.players.indexOf(self)];
  assert.ok(guest.children.some(child => child.className === 'team-armor'));
  assert.ok(!rows[state.players.findIndex(player => player.id === 'host')].children.some(child => child.className === 'team-armor'));
  client.event({ event: 'pickup', id: 'guest', kind: 'armor', armorGained: 32, armor: 100 });
  assert.equal(client.node('pickup-notice').textContent, 'GILET · +32 ARMURE · PROTECTION COMPLÈTE');
  client.language('en');
  assert.equal(client.node('pickup-notice').textContent, 'VEST · +32 ARMOR · FULL PROTECTION');
  // A blow the vest fully stops flashes cold instead of red; a real wound flashes red again.
  client.lock();
  client.event({ event: 'hit', id: 'guest', damage: 11, absorbed: 11, armor: 57 });
  assert.equal(client.node('damage-flash').classList.contains('armor'), true);
  client.event({ event: 'hit', id: 'guest', damage: 32, absorbed: 0, armor: 0 });
  assert.equal(client.node('damage-flash').classList.contains('armor'), false);
  // Outside ticks are throttled for sound, but still clear the cold colour.
  client.event({ event: 'hit', id: 'guest', damage: 3, absorbed: 0, armor: 40, source: 'outside' });
  client.event({ event: 'hit', id: 'guest', damage: 11, absorbed: 11, armor: 29 });
  assert.equal(client.node('damage-flash').classList.contains('armor'), true);
  client.event({ event: 'hit', id: 'guest', damage: 3, absorbed: 0, armor: 29, source: 'outside' });
  assert.equal(client.node('damage-flash').classList.contains('armor'), false);
  self.armor = 0; client.update(state);
  assert.equal(client.node('armor-row').hidden, true);
});

test('every music theme of the catalogue can be chosen from both selectors and is remembered', () => {
  const client = clientHarness();
  const themes = Object.keys(MUSIC_THEME_CATALOG);
  assert.ok(themes.includes('covert-a') && themes.includes('night-b'));
  themes.forEach((theme, index) => {
    client.node(index % 2 ? 'pause-music-theme' : 'music-theme').onchange({ target: { value: theme } });
    assert.equal(client.node('music-theme').value, theme);
    assert.equal(client.node('pause-music-theme').value, theme);
    assert.deepEqual(client.musicWrites.at(-1), ['deadwood-music-theme', theme]);
    assert.equal(clientHarness('guest', { savedMusic: theme }).node('music-theme').value, theme);
  });
  assert.equal(client.sent.length, 0);
  assert.equal(client.soundCalls.unlocks, 0);
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('a page loaded before a server update refuses to join and asks for a reload', async () => {
  for (const [serverBuild, outdated] of [['b2', true], ['b1', false], [undefined, false]]) {
    const client = clientHarness('guest', { servedBuild: 'b1' }); await settle();
    client.leave();
    client.connect(); const socket = client.sockets.at(-1); socket.emit('open');
    assert.equal(client.sent.at(-1).type, 'join');
    assert.equal(client.sent.at(-1).build, 'b1', 'the join names the build this page was loaded with');
    socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123', ...(serverBuild ? { build: serverBuild } : {}) }) });
    assert.equal(client.node('reload-page').hidden, !outdated, `server ${serverBuild}`);
    assert.equal(client.node('lobby').hidden, outdated, 'an outdated page never reaches the lobby');
    if (outdated) {
      assert.equal(socket.readyState, 3, 'the connection is closed');
      assert.equal(client.node('menu-error').hidden, false);
      assert.match(client.node('menu-error').textContent, /mis à jour sur le serveur/);
      client.language('en');
      assert.match(client.node('menu-error').textContent, /updated on the server/);
    }
  }
});

test('the server refusal of an outdated page shows the reload prompt, which leaves with its message', async () => {
  const client = clientHarness('guest', { servedBuild: 'b1' }); await settle();
  client.leave();
  client.connect(); let socket = client.sockets.at(-1); socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'outdated', build: 'b2' }) });
  assert.equal(client.node('reload-page').hidden, false);
  assert.equal(client.node('lobby').hidden, true);
  assert.equal(socket.readyState, 3, 'the refused connection is closed');
  assert.equal(client.node('connect-button').disabled, false);
  assert.match(client.node('menu-error').textContent, /mis à jour sur le serveur/);
  client.node('join-tab').onclick();
  assert.equal(client.node('menu-error').hidden, true);
  assert.equal(client.node('reload-page').hidden, true, 'switching tabs clears the prompt with its message');
  client.node('room-code').value = 'ABC123';
  client.connect(); socket = client.sockets.at(-1); socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'outdated', build: 'b2' }) });
  assert.equal(client.node('reload-page').hidden, false);
  client.node('room-code').value = 'AB';
  client.connect();
  assert.match(client.node('menu-error').textContent, /6 caractères/);
  assert.equal(client.node('reload-page').hidden, true, 'another error never sits above a stale reload prompt');
});

test('a page that could not read its build still joins without claiming one', async () => {
  const client = clientHarness(); await settle();
  client.leave();
  client.connect(); const socket = client.sockets.at(-1); socket.emit('open');
  assert.equal(client.sent.at(-1).type, 'join');
  assert.equal('build' in client.sent.at(-1), false);
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123', build: 'b2' }) });
  assert.equal(client.node('lobby').hidden, false);
  assert.equal(client.node('reload-page').hidden, true);
});

function arsenalClient(weapon, other = 'pistol') {
  const simulation=room(),client=clientHarness('guest',{fakeNow:0});simulation.start('host');
  const state=simulation.snapshot(),self=state.players.find(player=>player.id==='guest');
  const equipped={weapon,ammo:weapon==='sniper'?5:0,reserve:weapon==='sniper'?10:0,magazine:weapon==='sniper'?5:0};
  Object.assign(self,{weapon,...equipped,bonus:null,points:1000,supplyPurchases:[],ownedWeapons:[weapon,other],weapons:[equipped,{weapon:other,ammo:12,magazine:12,reserve:36}]});
  state.phase='wave';state.wave=13;
  client.update(state);client.enter();client.lock();
  return {client,state,self};
}

test('sniper scope is held, narrows the field and sensitivity, and right click never starts a melee attack',()=>{
  const {client}=arsenalClient('sniper');
  const initial=client.aim();client.dispatch('mousemove',{movementX:10,movementY:0});
  const normalDelta=initial.yaw-client.aim().yaw;
  let prevented=0;client.dispatch('mousedown',{button:2,preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(client.aim().fov,30);assert.equal(client.aim().scoped,true);
  assert.equal(client.node('sniper-scope').hidden,false);
  const start=client.aim().yaw;client.dispatch('mousemove',{movementX:10,movementY:0});
  assert.ok(Math.abs((start-client.aim().yaw)/normalDelta-30/76)<1e-10);
  assert.equal(client.sent.some(message=>message.type==='shoot'),false);
  client.dispatch('mousedown',{button:0});client.time(1300);client.frame(1300);
  const shot=client.sent.findLast(message=>message.type==='shoot');assert.deepEqual(shot,{type:'shoot'});
  client.dispatch('mouseup',{button:2});assert.equal(client.aim().fov,76);assert.equal(client.aim().scoped,false);
  assert.equal(client.node('sniper-scope').hidden,true);
});

test('sniper bolt status follows server recovery and gives way to actual reload feedback',()=>{
  const {client,state,self}=arsenalClient('sniper');
  self.fireReadyLeft=1.05;client.update(state);assert.equal(client.node('reload-status').textContent,'VERROU · 1.1 S');
  client.language('en');assert.equal(client.node('reload-status').textContent,'BOLT · 1.1 S');
  self.reloading=true;self.reloadLeft=2.8;client.update(state);assert.equal(client.node('reload-status').textContent,'RELOADING · 2.8 s');
  self.reloading=false;self.fireReadyLeft=0;client.update(state);assert.equal(client.node('reload-status').textContent,'R · RELOAD');
});

test('sniper scope cannot survive pause, reload, drop, switching, umbrella, down, restart or focus loss',()=>{
  const cases={
    pause:({client})=>client.pause(),
    reload:({client})=>client.dispatch('keydown',{code:'KeyR',repeat:false}),
    drop:({client})=>client.dispatch('keydown',{code:'KeyV',repeat:false}),
    switch:({client})=>client.dispatch('keydown',{code:'Digit2',repeat:false}),
    umbrella:({client,state})=>{state.expedition.enabled=true;client.dispatch('keydown',{code:'KeyB',repeat:false});},
    down:({client,state,self})=>{self.downed=true;client.update(state);},
    extraction:({client,state})=>{state.phase='extraction';client.update(state);},
    gameover:({client,state})=>{state.phase='gameover';client.update(state);},
    restart:({client,state,self})=>{self.weapon='pistol';state.phase='countdown';client.update(state);},
    blur:({client})=>client.dispatchWindow('blur'),
    hidden:({client})=>{client.hidden(true);client.dispatch('visibilitychange');},
    leave:({client})=>client.leave(),
  };
  for(const [name,interrupt]of Object.entries(cases)){
    const fixture=arsenalClient('sniper');fixture.client.dispatch('mousedown',{button:2,preventDefault(){}});
    assert.equal(fixture.client.aim().scoped,true,name);interrupt(fixture);
    assert.equal(fixture.client.aim().fov,76,name);assert.equal(fixture.client.node('sniper-scope').hidden,true,name);
  }
});

test('hammer uses its own windup and recovery, melee slots and bilingual practice controls',()=>{
  const {client,state,self}=arsenalClient('hammer');
  client.dispatch('mousedown',{button:2,preventDefault(){}});
  assert.deepEqual(client.sent.at(-1),{type:'shoot',attack:'heavy'});
  client.event({event:'melee-start',id:'guest',weapon:'hammer',attack:'heavy',attackId:1,time:state.time,windup:.75,duration:2.2});
  client.time(200);client.frame(200);assert.equal(client.meleeCalls.at(-1).windup,.75);assert.equal(client.meleeCalls.at(-1).duration,2.2);
  assert.equal(client.node('weapon-panel').classList.contains('melee'),true);
  assert.equal(client.node('weapon-slot-1').textContent,'1 MASSE À POINTES');
  assert.match(client.node('combat-tip').textContent,/2 CIBLES MAX/);
  self.meleeReadyLeft=1.2;client.update(state);assert.match(client.node('reload-status').textContent,/RÉCUPÉRATION · 1.2 S/);
  client.language('en');assert.equal(client.node('weapon-slot-1').textContent,'1 SPIKED MACE');
  assert.match(client.node('reload-status').textContent,/RECOVERY · 1.2 S/);
  const before=client.sent.length;client.dispatch('keydown',{code:'KeyR',repeat:false});assert.equal(client.sent.length,before);
  state.practice=true;client.update(state);client.node('practice-hammer').onclick();
  assert.deepEqual(client.sent.at(-1),{type:'practice',action:'weapon',weapon:'hammer'});
  client.node('practice-sniper').onclick();assert.deepEqual(client.sent.at(-1),{type:'practice',action:'weapon',weapon:'sniper'});
});

test('late hammer confirmations share the authoritative animation age and windup with their chosen audio take',()=>{
  const {client,state,self}=arsenalClient('hammer');state.time=10;client.update(state);
  client.dispatch('mousedown',{button:2,preventDefault(){}});
  client.event({event:'melee-start',id:self.id,weapon:'hammer',attack:'heavy',attackId:10,time:9.8,windup:.75,duration:2.2});
  const audio=client.soundCalls.melee.at(-1);assert.equal(audio.weapon,'hammer');assert.equal(audio.id,self.id);assert.equal(audio.attack,'heavy');
  assert.ok(Math.abs(audio.timing.elapsed-.2)<1e-9);assert.equal(audio.timing.windup,.75);
  client.time(100);client.frame(100);const animation=client.meleeCalls.at(-1);
  assert.ok(Math.abs(animation.elapsed-(audio.timing.elapsed+.1))<1e-9);assert.equal(animation.windup,audio.timing.windup);
});

test('fire axe practice control, bilingual slots and delayed melee audio follow its own authoritative profile',()=>{
  const {client,state,self}=arsenalClient('fireaxe');state.practice=true;state.time=10;client.update(state);
  assert.equal(client.node('weapon-slot-1').textContent,'1 HACHE DE POMPIER');
  assert.match(client.node('combat-tip').textContent,/2 CIBLES MAX/);
  client.node('practice-fireaxe').onclick();assert.deepEqual(client.sent.at(-1),{type:'practice',action:'weapon',weapon:'fireaxe'});
  client.dispatch('mousedown',{button:0,preventDefault(){}});
  client.event({event:'melee-start',id:self.id,weapon:'fireaxe',attack:'light',attackId:20,time:9.9,windup:.4,duration:.6});
  const audio=client.soundCalls.melee.at(-1);assert.equal(audio.weapon,'fireaxe');assert.equal(audio.timing.windup,.4);
  assert.ok(Math.abs(audio.timing.elapsed-.1)<1e-9);
  client.time(100);client.frame(100);assert.equal(client.meleeCalls.at(-1).windup,.4);
  client.language('en');assert.equal(client.node('weapon-slot-1').textContent,'1 FIRE AXE');
  state.paused=true;client.update(state);assert.equal(client.node('practice-fireaxe').disabled,true);
});

test('server supply menu keeps the game live, the umbrella open and choices stable until a real selection',()=>{
  const {client,state,self}=arsenalClient('hammer');
  state.wave=6;state.supplyCrate={id:'supply-6',wave:6,x:20,y:0,z:16,claimed:[]};
  self.umbrella={open:true,remaining:90};self.supplyAction='crate';client.update(state);
  client.dispatch('keydown',{code:'KeyE',repeat:false});assert.deepEqual(client.sent.at(-1),{type:'interact'});
  client.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-6',wave:6});
  assert.equal(client.node('supply-menu').hidden,false);assert.equal(client.node('pause').hidden,true);
  assert.equal(client.node('supply-options').children.length,Object.keys(SUPPLY_BONUSES).length);assert.match(client.node('supply-expiry').textContent,/vague 7/);
  assert.equal(client.node('supply-options').children[0].disabled,false);
  assert.equal(client.node('supply-options').children[2].disabled,false,'the pistol counts as a compatible firearm');
  const options=client.node('supply-options').children;client.update(state);
  assert.equal(client.node('supply-options').children,options,'snapshots do not destroy a button under the mouse');
  assert.equal(client.sent.some(message=>message.type==='umbrella'&&message.open===false),false);
  client.dispatch('pointerlockchange');assert.equal(client.node('pause').hidden,true);
  client.dispatch('keydown',{code:'KeyW',repeat:false});assert.equal(client.input().forward,0);
  client.dispatch('keydown',{code:'KeyB',repeat:false});assert.deepEqual(client.sent.at(-1),{type:'umbrella',open:false});
  client.language('en');assert.match(client.node('supply-title').textContent,/SUPPLY CRATE/);
  assert.match(client.node('supply-expiry').textContent,/wave 7/);
  client.node('supply-options').children[0].onclick();
  const choice=client.sent.findLast(message=>message.type==='supply-claim');assert.deepEqual(choice,{type:'supply-claim',bonus:'stone',crateId:'supply-6'});
  assert.equal(client.node('supply-menu').hidden,true);assert.equal(self.bonus,null,'no client-side grant');
  self.bonus={stone:1};client.update(state);assert.equal(client.node('active-bonus').textContent,'BONUS · Reinforced 1');
  client.event({event:'supply-claimed',id:'guest',bonus:'stone'});assert.equal(client.node('toast').textContent,'Reinforced weapons collected.');
});

test('reinforced melee describes the next crate tier and updates the actual target limit in both languages',()=>{
  const {client,state,self}=arsenalClient('katana');
  state.wave=6;state.supplyCrate={id:'supply-6',wave:6,x:20,y:0,z:16,claimed:[]};
  self.bonus={stone:3};client.update(state);
  assert.match(client.node('combat-tip').textContent,/3 CIBLES MAX/);
  client.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-6',wave:6});
  const details=()=>client.node('supply-options').children[0].children.map(node=>node.textContent).join(' ');
  assert.match(details(),/Armes renforcées/);
  assert.match(details(),/dégâts de mêlée \+40 %/);
  assert.match(details(),/cibles supplémentaires par frappe : 1/);
  client.language('en');
  assert.match(details(),/Reinforced weapons/);
  assert.match(details(),/extra targets per swing: 1/);
  for(const [level,targets] of [[4,4],[7,4],[8,5]]){
    self.bonus.stone=level;client.update(state);
    assert.match(client.node('combat-tip').textContent,new RegExp('UP TO '+targets+' TARGETS'));
  }
});

test('station choices obey authoritative per-wave purchases, balances and supply denial messages',()=>{
  const {client,state,self}=arsenalClient('sniper','rifle');state.wave=15;self.points=600;self.supplyPurchases=['grenade'];self.supplyAction='station';client.update(state);
  client.event({event:'supply-menu',id:'guest',menu:'station',wave:15});
  const options=client.node('supply-options').children;
  const option=id=>options.find(button=>button.dataset.supplyChoice===id);
  assert.equal(option('grenade').disabled,true);assert.equal(option('armor').disabled,false);assert.equal(option('ammo').disabled,true);
  assert.match(option('grenade').children[2].textContent,/DÉJÀ ACHETÉ/);assert.match(option('ammo').children[2].textContent,/100 PIÈCES/);
  option('armor').onclick();
  assert.deepEqual(client.sent.findLast(message=>message.type==='supply-buy'),{type:'supply-buy',service:'armor'});
  client.language('en');client.event({event:'supply-denied',id:'guest',reason:'full'});
  assert.equal(client.node('toast').textContent,'Your supplies are already full.');
  client.event({event:'supply-purchased',id:'guest',service:'armor',price:600});assert.equal(client.node('toast').textContent,'Emergency vest · −600 coins');
  client.lock();client.event({event:'supply-menu',id:'guest',menu:'station',wave:15});
  self.downed=true;client.update(state);assert.equal(client.node('supply-menu').hidden,true);
});

test('a direct restart snapshot closes a late supply station without waiting for a terminal state',()=>{
  const {client,state,self}=arsenalClient('sniper');state.wave=15;self.supplyAction='station';client.update(state);
  client.event({event:'supply-menu',id:'guest',menu:'station',wave:15});
  assert.equal(client.node('supply-menu').hidden,false);
  state.phase='countdown';state.wave=0;self.weapon='pistol';self.supplyAction=null;client.update(state);
  assert.equal(client.node('supply-menu').hidden,true);
  const sent=client.sent.length;client.node('supply-options').children[0].onclick();
  assert.equal(client.sent.length,sent,'a detached choice cannot purchase during the new run');
});

test('bonus cards show owned levels, current effects and next gains; magazines and model masks follow real state',()=>{
  const {client,state,self}=arsenalClient('smg');
  self.bonus={extended:1,perforating:1,reinforced:1,stone:4,radar:7};self.grenades=1;
  client.update(state);
  const tray=client.node('bonus-tray'),chips=[...tray.children];
  assert.equal(tray.hidden,false);
  assert.deepEqual(chips.map(chip=>chip.className.replace('bonus-chip ','')),['stone','perforating','extended','reinforced','radar']);
  assert.match(chips[2].children[0].innerHTML,/<b>1<\/b>/);
  assert.match(chips[2].children[2].textContent,/\+10 %/);
  assert.match(chips[2].children[3].textContent,/\+20 %.*2/);
  assert.match(chips[1].children[2].textContent,/\+0 cibles/);
  assert.match(chips[1].children[3].textContent,/\+1 cible.*3/);
  assert.match(chips[3].children[2].textContent,/\+0 %/);
  assert.match(chips[3].children[3].textContent,/\+15 %.*2/);
  assert.equal(chips[0].dataset.active,'false');
  assert.match(chips[0].children[2].textContent,/\+40 %.*\+1 cible/);
  assert.match(chips[4].children[3].textContent,/PV exacts.*8/);
  assert.equal(client.node('reserve-magazine-row').style['--mag-extra'],'2.4px','extension is exactly 10% of the 24px base at level one');
  assert.equal(client.node('capacity-bonus').hidden,false);
  assert.equal(client.node('grenade-icons').children.length,2);
  assert.match(client.node('grenade-icons').children[0].className,/available/);
  assert.doesNotMatch(client.node('grenade-icons').children[1].className,/available/);
  const slot=client.node('weapon-slot-1');
  assert.match(slot.style['--weapon-silhouette'],/hud-silhouettes\/famille\/smg.png/);
  assert.equal(slot.classList.contains('has-silhouette'),true);
  client.language('en');client.update(state);
  assert.match(tray.children[2].children[2].textContent,/\+10%/);
  self.weapon='katana';client.update(state);
  assert.equal(tray.children[0].dataset.active,'true','weapon change invalidates card cache');
  assert.equal(tray.children[3].dataset.active,'false');
  assert.equal(client.node('capacity-bonus').hidden,true);
  self.grenades=0;self.bonus=null;client.update(state);
  assert.equal(tray.hidden,true);
  assert.ok(client.node('grenade-icons').children.every(icon=>!icon.className.includes('available')));
});

test('ground bonuses use the acknowledged pickup id, E once, actual server recovery and local-language feedback',()=>{
  const simulation=room(),client=clientHarness('guest',{fakeNow:0});simulation.start('host');
  const player=simulation.players.get('guest');player.inventory.hammer={ammo:0,reserve:0};player.weapon='hammer';player.bonus={stone:1};
  const pickup=simulation.dropBonus(player);assert.ok(pickup);
  Object.assign(player,{x:pickup.x,y:pickup.y,z:pickup.z});
  client.update(simulation.snapshot());client.enter();client.lock();client.update(simulation.snapshot());
  assert.equal(client.node('interaction').hidden,false);assert.match(client.node('interaction-text').textContent,/Ramasser Armes renforcées/);
  client.dispatch('keydown',{code:'KeyE',repeat:false});assert.deepEqual(client.sent.at(-1),{type:'interact'});
  const events=[];simulation.onEvent=event=>{events.push(event);client.event(event);};
  assert.equal(simulation.interact('guest'),true);assert.deepEqual(player.bonus,{stone:1});assert.equal(simulation.pickups.has(pickup.id),false);
  client.update(simulation.snapshot());assert.equal(client.node('active-bonus').textContent,'BONUS · Renforts 1');
  assert.ok(events.some(event=>event.event==='supply-claimed'));
  client.time(700);client.frame(700);assert.equal(client.sent.filter(message=>message.type==='interact').length,1,'held E cannot swap a bonus back immediately');
  client.language('en');assert.equal(client.node('active-bonus').textContent,'BONUS · Reinforced 1');
  assert.equal(client.node('toast').textContent,'Reinforced weapons · level 1/8 collected.');
});

test('switching between melee models clears a remote recovery animation from the previous weapon',()=>{
  const {client,state}=arsenalClient('sniper');
  const teammate=state.players.find(player=>player.id==='host');Object.assign(teammate,{weapon:'katana',x:-2,z:1.7});client.update(state);
  client.event({event:'melee-start',id:'host',weapon:'katana',attack:'heavy',attackId:1,time:state.time,windup:.7,duration:1.5});
  client.time(200);client.frame(200);assert.equal(client.survivorCalls.at(-1).meleeAttack,'heavy');
  teammate.weapon='hammer';client.update(state);client.frame(300);
  assert.equal(client.survivorCalls.at(-1).meleeAttack,undefined);assert.equal(client.soundCalls.meleeReleases.includes('host'),true);
});

test('crate expiry closes a stale choice and golden Magnum uniqueness stays visible in both languages',()=>{
  const {client,state,self}=arsenalClient('pistol','rifle');state.wave=14;
  state.supplyCrate={id:'supply-14',wave:14,x:20,y:0,z:16,claimed:[]};client.update(state);
  client.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-14',wave:14});
  state.wave=15;state.supplyCrate=null;client.update(state);assert.equal(client.node('supply-menu').hidden,true);
  const rack=ARMORY.find(item=>item.weapon==='magnum');Object.assign(self,{x:rack.x+Math.sin(rack.facing)*1.1,y:rack.y,z:rack.z+Math.cos(rack.facing)*1.1,supplyAction:null});
  state.magnumAvailable=false;client.update(state);assert.match(client.node('interaction-text').textContent,/déjà dans le refuge/);
  client.language('en');assert.match(client.node('interaction-text').textContent,/already in the shelter/);
  client.event({event:'purchase-denied',id:'guest',reason:'unique'});assert.equal(client.node('toast').textContent,'There is only one Golden Magnum in this shelter.');
});

test('practice radar lights a continuous personal map without pointer lock or device commands',()=>{
  const simulation=new RoomSimulation('TRY123',{practice:true}),client=clientHarness('guest',{fakeNow:0});
  simulation.addPlayer('guest','Invité');client.update(simulation.snapshot());client.enter();client.pause();
  client.node('practice-radar').onclick();const request=client.sent.at(-1);
  assert.deepEqual(request,{type:'practice',action:'radar'});
  assert.equal(client.node('radar-panel').hidden,true);
  assert.equal(simulation.practiceAction('guest',request),true);client.update(simulation.snapshot());
  client.event({event:'practice',id:'guest',action:'radar'});
  assert.match(client.node('practice-status').textContent,/s’affiche en continu/);
  assert.equal(client.update(simulation.snapshot()) ?? true, true);
  assert.equal(client.node('radar-panel').hidden,false,'the personal map needs no placement');
  assert.equal(client.node('radar-panel').classList.contains('radar-paused'),true);
  client.language('en');assert.match(client.node('radar-battery').textContent,/CONTINUOUS MAP/);
  assert.equal(client.sent.some(message=>message.type==='radar-deploy'||message.type==='radar-recover'),false,'device-era commands are never sent');
  client.leave();assert.equal(client.node('radar-panel').hidden,true);
});

test('H is free for the future while V retains weapon drop, and held E cannot immediately swap a bonus back twice',()=>{
  const {client,state,self}=arsenalClient('pistol','rifle');
  self.bonus={radar:2};client.update(state);
  client.dispatch('keydown',{code:'KeyH',repeat:false,preventDefault(){}});
  client.dispatch('keydown',{code:'KeyH',repeat:true});
  assert.equal(client.sent.filter(message=>message.type==='radar-deploy').length,0,'no device answers H anymore');
  client.dispatch('keydown',{code:'KeyV',repeat:false});assert.deepEqual(client.sent.at(-1),{type:'drop-weapon'});
  const droppedBonus={id:'bonus-1',kind:'bonus',bonus:{kind:'stone',level:3},x:self.x,y:self.y,z:self.z};
  state.pickups=[droppedBonus];self.nearbyBonusId='bonus-1';self.bonus=null;client.update(state);
  assert.match(client.node('interaction-text').textContent,/Ramasser Armes renforcées · niveau 3\/8/);
  client.dispatch('keydown',{code:'KeyE',repeat:false});
  self.bonus={kind:'stone',level:3};self.nearbyBonusId=null;state.pickups=[];client.update(state);
  client.time(700);client.frame(700);
  assert.equal(client.sent.filter(message=>message.type==='interact').length,1,'held E stays latched through the acknowledged pickup');
  self.downed=true;client.update(state);client.dispatch('keydown',{code:'KeyH',repeat:false});
  assert.equal(client.sent.filter(message=>message.type==='radar-deploy').length,0);
});

test('radar menu eligibility follows the wave-two unlock and a teammate’s radar never blocks your own',()=>{
  const {client,state,self}=arsenalClient('pistol','rifle');state.wave=1;state.supplyCrate={id:'supply-2',wave:2,claimed:[]};client.update(state);
  client.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-2',wave:2});
  const choice=()=>client.node('supply-options').children.find(option=>option.dataset.supplyChoice==='radar');
  assert.equal(choice().disabled,true);assert.match(choice().children[3].textContent,/VAGUE 2/);
  state.wave=2;client.update(state);client.lock();
  client.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-2',wave:2});
  assert.equal(choice().disabled,false);assert.match(choice().children[3].textContent,/NIVEAU 1\/8/);
  const mate=state.players.find(player=>player.id==='host');mate.bonus={radar:2};client.update(state);
  assert.equal(choice().disabled,false,'each survivor may carry their own radar');
  client.language('en');assert.match(choice().children[3].textContent,/LEVEL 1\/8/);
  client.node('supply-return').onclick();
  self.bonus={radar:8};client.update(state);client.frame(0);
  assert.equal(client.node('radar-panel').hidden,false);
  self.alive=false;client.update(state);assert.equal(client.node('radar-panel').hidden,false,'spectators retain their radar');
  state.phase='gameover';client.update(state);assert.equal(client.node('radar-panel').hidden,true);
  state.phase='countdown';state.wave=0;self.bonus=null;client.update(state);client.update(state);assert.equal(client.node('radar-panel').hidden,true);
});

test('P requests an authoritative team pause from play or menu; both clients freeze and only the host can resume',()=>{
  const simulation=room(),host=clientHarness('host',{fakeNow:0}),guest=clientHarness('guest',{fakeNow:0});
  simulation.start('host');Object.assign(simulation,{phase:'wave',wave:2,toSpawn:1,spawnTimer:999});
  for(const client of [host,guest]){client.update(simulation.snapshot());client.enter();client.lock();client.frame(100);client.dispatch('keydown',{code:'KeyW'});client.dispatch('mousedown',{button:0});}
  const before=simulation.time;
  host.dispatch('keydown',{code:'KeyP',repeat:false,preventDefault(){}});
  assert.deepEqual(host.sent.at(-1),{type:'pause',paused:true});
  assert.equal(host.node('resume-button').disabled,true,'the return control stays disabled while a pause request is in flight');
  assert.equal(simulation.paused,false,'a request does not freeze locally before acknowledgement');
  assert.equal(simulation.setPause('host',true),true);
  for(const client of [host,guest]){client.time(100);client.update(simulation.snapshot());}
  for(const client of [host,guest]){
    assert.equal(client.node('pause').hidden,false);assert.equal(client.activity().keys,0);assert.equal(client.activity().firing,false);
    assert.equal(client.node('phase-label').textContent,'PARTIE EN PAUSE');
    const time=client.visualTime(),frames=client.worldFrames.length,messages=client.sent.length,groans=client.soundCalls.groans.length;
    client.time(3100);client.frame(3100);client.time(5100);client.frame(5100);
    assert.equal(client.visualTime(),time);assert.equal(client.worldFrames.length,frames);assert.equal(client.sent.length,messages);assert.equal(client.soundCalls.groans.length,groans);
    assert.equal(client.soundCalls.scenes.at(-1).inGame,false);assert.equal(client.soundCalls.footsteps.at(-1).enabled,false);
  }
  for(let index=0;index<150;index++)simulation.tick(1/30);assert.equal(simulation.time,before);
  assert.equal(host.node('resume-button').disabled,false);assert.equal(guest.node('resume-button').disabled,true);
  const guestMessages=guest.sent.length;guest.node('resume-button').onclick();guest.dispatch('keydown',{code:'KeyP',repeat:false,preventDefault(){}});
  assert.equal(guest.sent.length,guestMessages);assert.match(guest.node('toast').textContent,/réservée à l’hôte/);
  host.dispatch('keydown',{code:'KeyP',repeat:false,preventDefault(){}});assert.deepEqual(host.sent.at(-1),{type:'pause',paused:false});
  assert.equal(simulation.setPause('host',false),true);
  for(const client of [host,guest]){client.time(5100);client.update(simulation.snapshot());client.frame(5200);assert.ok(Math.abs(client.visualTime()-.2)<1e-9);assert.equal(client.node('pause').hidden,false);assert.equal(client.input().forward,0);assert.equal(client.activity().firing,false);}
  assert.equal(guest.node('resume-button').disabled,false,'guest can return to controls after host resumes');
  assert.equal(host.sent.filter(message=>message.type==='pause').length,2);
});

test('the explicit pause button, editable P, repeat suppression and host transfer stay bilingual and authoritative',()=>{
  const simulation=room(),host=clientHarness('host',{fakeNow:0}),guest=clientHarness('guest',{fakeNow:0});simulation.start('host');
  for(const client of [host,guest]){client.update(simulation.snapshot());client.enter();client.pause();}
  assert.equal(host.node('room-pause-button').hidden,false);assert.equal(host.node('room-pause-button').disabled,false);assert.equal(guest.node('room-pause-button').disabled,true);
  const count=host.sent.length;
  host.dispatch('keydown',{code:'KeyP',repeat:false,target:{matches:()=>true},preventDefault(){assert.fail('typing P must remain native');}});
  host.dispatch('keydown',{code:'KeyP',repeat:false,ctrlKey:true,preventDefault(){assert.fail('Ctrl+P must remain native');}});
  assert.equal(host.sent.length,count);
  host.node('room-pause-button').onclick();host.dispatch('keydown',{code:'KeyP',repeat:true,preventDefault(){}});
  assert.equal(host.sent.filter(message=>message.type==='pause').length,1);
  simulation.setPause('host',true);for(const client of [host,guest])client.update(simulation.snapshot());
  host.language('en');guest.language('en');
  assert.equal(host.node('pause-title').textContent,'Time has stopped.');assert.equal(host.node('resume-button').textContent,'Resume game · P');
  assert.match(host.node('pause-description').textContent,/zombies, damage and timers have stopped/);
  assert.equal(guest.node('resume-button').textContent,'Waiting for the host');assert.match(guest.node('pause-description').textContent,/Wait for the host/);
  simulation.removePlayer('host');guest.update(simulation.snapshot());
  assert.equal(guest.node('resume-button').disabled,false);assert.equal(guest.node('resume-button').textContent,'Resume game · P');
  guest.node('resume-button').onclick();assert.deepEqual(guest.sent.at(-1),{type:'pause',paused:false});
  assert.equal(simulation.setPause('guest',false),true);guest.update(simulation.snapshot());assert.equal(guest.node('room-pause-button').textContent,'Pause game · P');
  guest.leave();const left=guest.sent.length;guest.dispatch('keydown',{code:'KeyP',repeat:false,preventDefault(){}});assert.equal(guest.sent.length,left);
});

test('paused snapshots reject stale combat and menu actions, and extraction visuals resume from the frozen timer',()=>{
  const simulation=new RoomSimulation('TRY123',{practice:true}),client=clientHarness('host',{fakeNow:0});simulation.addPlayer('host');
  client.update(simulation.snapshot());client.enter();client.lock();client.dispatch('mousedown',{button:0});
  client.event({event:'shot',id:'host',weapon:'assault',x:0,y:1.6,z:0,yaw:0,pitch:0,hits:0});
  assert.equal(client.soundCalls.activeBursts.assault,true);
  simulation.setPause('host',true);client.update(simulation.snapshot());
  const shots=client.soundCalls.shoot,melee=client.soundCalls.melee.length,grenades=client.explosionCount(),messages=client.sent.length;
  for(const event of [{event:'shot',weapon:'assault',hits:1},{event:'reload',weapon:'assault',duration:2},{event:'explosion',x:0,y:0,z:0},{event:'melee-start',weapon:'hammer',attack:'heavy',attackId:99,windup:.75,duration:2.2}])client.event({id:'host',...event});
  client.node('practice-refill').onclick();client.node('practice-radar').onclick();
  client.dispatch('keydown',{code:'KeyR',repeat:false});client.dispatch('keydown',{code:'KeyG',repeat:false});client.dispatch('mousedown',{button:0});
  assert.equal(client.sent.length,messages);assert.equal(client.soundCalls.shoot,shots);assert.equal(client.soundCalls.melee.length,melee);assert.equal(client.explosionCount(),grenades);assert.equal(client.node('practice-refill').disabled,true);
  // Use an authoritative extraction snapshot; its camera and animation must
  // not extrapolate the ten seconds spent in pause.
  const state=simulation.snapshot();state.practice=false;state.phase='extraction';state.timeLeft=9;state.extractionDuration=12;state.paused=false;client.time(100);client.update(state);client.frame(100);
  const elapsed=client.extractionCalls.updates.at(-1).elapsed;state.paused=true;client.update(state);const updates=client.extractionCalls.updates.length;
  assert.equal(client.node('pause').hidden,false);client.time(10100);client.frame(10100);assert.equal(client.extractionCalls.updates.length,updates);
  state.paused=false;client.update(state);client.frame(10100);assert.equal(client.extractionCalls.updates.at(-1).elapsed,elapsed);assert.equal(client.node('pause').hidden,true,'resuming extraction returns to its cinematic instead of leaving a stale pause overlay');
});

test('joining an already paused team shows its stopped world, ignores Escape as a resume and rejects a stale detached choice',()=>{
  const simulation=room(),guest=clientHarness('guest',{fakeNow:0});simulation.start('host');simulation.setPause('host',true);
  guest.update(simulation.snapshot());guest.enter();
  assert.equal(guest.node('pause').hidden,false);assert.equal(guest.node('resume-button').disabled,true);assert.equal(guest.worldFrames.at(-1),0);
  guest.dispatch('keydown',{code:'Escape',preventDefault(){}});assert.equal(guest.node('pause').hidden,false);assert.equal(guest.sent.some(message=>message.type==='pause'),false);
  simulation.setPause('host',false);guest.update(simulation.snapshot());guest.lock();
  const state=simulation.snapshot();state.wave=6;state.supplyCrate={id:'supply-6',wave:6,claimed:[]};guest.update(state);
  guest.event({event:'supply-menu',id:'guest',menu:'crate',crateId:'supply-6',wave:6});const detachedChoice=guest.node('supply-options').children[0];
  state.paused=true;guest.update(state);assert.equal(guest.node('supply-menu').hidden,true);assert.equal(guest.node('pause').hidden,false);
  const messages=guest.sent.length;detachedChoice.onclick();assert.equal(guest.sent.length,messages);
  guest.event({event:'pause-denied',id:'guest',reason:'host'});assert.match(guest.node('toast').textContent,/réservée à l’hôte/);
});

test('the range backpack unlocks four independent stocks only after acknowledgement, with keys 1–4 and a bidirectional wheel cycle',()=>{
  const simulation=new RoomSimulation('BAG123',{practice:true}),client=clientHarness('host',{fakeNow:0});const player=simulation.addPlayer('host');
  client.update(simulation.snapshot());client.enter();client.pause();
  assert.equal(client.node('weapon-slot-3').hidden,true);assert.equal(client.node('weapon-slot-4').hidden,true);assert.equal(client.node('backpack-status').hidden,true);
  player.inventory.assault.ammo=9;player.inventory.assault.reserve=17;player.inventory.rocket.ammo=0;player.inventory.rocket.reserve=1;
  const before=structuredClone(player.inventory);client.update(simulation.snapshot());
  client.node('practice-backpack').onclick();assert.deepEqual(client.sent.at(-1),{type:'practice',action:'backpack'});
  assert.equal(client.node('weapon-slot-3').hidden,true,'clicking the button never grants a local slot');
  assert.equal(simulation.practiceAction('host',client.sent.at(-1)),true);assert.deepEqual(player.inventory,before,'the backpack grants neither weapons nor ammunition');
  assert.equal(simulation.snapshot().players[0].movementMultiplier,WEAPON_MOVEMENT.assault,'an empty backpack and two carried weapons do not reduce movement');
  client.update(simulation.snapshot());client.event({event:'practice',id:'host',action:'backpack'});
  assert.equal(client.node('weapon-slot-3').hidden,false);assert.equal(client.node('weapon-slot-4').hidden,false);assert.equal(client.node('practice-backpack').disabled,true);
  assert.equal(client.node('backpack-status').textContent,'SAC · 4 EMPLACEMENTS');assert.match(client.node('practice-status').textContent,/quatre emplacements/);
  for(const [weapon,multiplier] of [['smg',.9],['rifle',.85]]){simulation.time+=.3;client.node('practice-weapon').value=weapon;client.node('practice-equip').onclick();assert.equal(simulation.practiceAction('host',client.sent.at(-1)),true);client.update(simulation.snapshot());assert.equal(simulation.snapshot().players[0].movementMultiplier,WEAPON_MOVEMENT[weapon]*multiplier);}
  assert.deepEqual(Object.keys(player.inventory),['assault','rocket','smg','rifle']);
  Object.entries(player.inventory).forEach(([weapon,stock],index)=>{stock.ammo=Math.min(WEAPONS[weapon].magazine,index+1);stock.reserve=index+7;});client.update(simulation.snapshot());client.lock();
  for(const [key,weapon] of [['Digit1','assault'],['Digit2','rocket'],['Digit3','smg'],['Digit4','rifle']]){
    client.dispatch('keydown',{code:key,repeat:false});const request=client.sent.at(-1);assert.equal(request.type,'weapon');assert.equal(request.weapon,weapon);assert.equal(simulation.chooseWeapon('host',weapon),true);client.update(simulation.snapshot());assert.equal(client.node('ammo-value').textContent,player.inventory[weapon].ammo);assert.equal(client.node('reserve-value').textContent,player.inventory[weapon].reserve);
  }
  for(const [deltaY,weapon] of [[1,'assault'],[1,'rocket'],[1,'smg'],[1,'rifle'],[-1,'smg'],[-1,'rocket'],[-1,'assault'],[-1,'rifle']]){
    client.dispatch('wheel',{deltaY,preventDefault(){}});assert.deepEqual(client.sent.at(-1),{type:'weapon',weapon});simulation.chooseWeapon('host',weapon);client.update(simulation.snapshot());
  }
  const expected=Math.round((WEAPON_MOVEMENT.rifle*.85-1)*100);
  assert.equal(client.node('weapon-mobility').textContent,`DÉPLACEMENT −${Math.abs(expected)} %`,'the server multiplier is not penalized twice');
  client.language('en');assert.equal(client.node('backpack-status').textContent,'BACKPACK · 4 SLOTS');assert.match(client.node('backpack-status').attributes.title,/10%.*15%/);assert.match(client.node('practice-status').textContent,/four slots/);
  assert.equal(client.survivorCalls.some(state=>state.backpack===true),false,'only other survivors are rendered as teammate models');
});

test('emergency supplies open with the revive kit at wave 5, unlock the permanent backpack at wave 10 and keep consumables locked until 15, in both languages',()=>{
  const {client,state,self}=arsenalClient('pistol','rifle');self.points=1500;self.supplyAction='station';self.backpack=false;self.weaponSlots=2;state.wave=4;client.update(state);
  assert.match(client.node('interaction-text').textContent,/disponible vague 5/);
  state.wave=9;client.update(state);assert.doesNotMatch(client.node('interaction-text').textContent,/disponible vague/);
  client.event({event:'supply-menu',id:'guest',menu:'station',wave:9});
  const choice=id=>client.node('supply-options').children.find(button=>button.dataset.supplyChoice===id);
  assert.equal(choice('backpack').disabled,true);assert.match(choice('backpack').children[2].textContent,/VAGUE 10/);
  state.wave=10;client.update(state);assert.equal(client.node('supply-menu').hidden,false);assert.equal(choice('backpack').disabled,false);assert.match(choice('backpack').children[2].textContent,/1500 PIÈCES/);
  for(const id of ['grenade','armor','ammo']){assert.equal(choice(id).disabled,true);assert.match(choice(id).children[2].textContent,/VAGUE 15/);}
  self.points=1499;client.update(state);assert.equal(choice('backpack').disabled,true);assert.match(choice('backpack').children[2].textContent,/MANQUE 1 PIÈCES/);
  self.points=1500;client.update(state);choice('backpack').onclick();assert.deepEqual(client.sent.findLast(message=>message.type==='supply-buy'),{type:'supply-buy',service:'backpack'});assert.equal(self.backpack,false);
  self.backpack=true;self.weaponSlots=4;self.movementMultiplier=WEAPON_MOVEMENT.pistol;self.points=0;self.supplyPurchases=['backpack'];client.update(state);client.event({event:'supply-purchased',id:'guest',service:'backpack',price:1500});
  assert.equal(client.node('toast').textContent,'Sac à dos · −1500 pièces');assert.equal(client.node('weapon-mobility').textContent,'DÉPLACEMENT +8 %');
  state.wave=11;self.points=2000;self.supplyPurchases=[];client.lock();client.update(state);client.event({event:'supply-menu',id:'guest',menu:'station',wave:11});
  assert.equal(choice('backpack').disabled,true);assert.equal(choice('backpack').children[2].textContent,'DÉJÀ POSSÉDÉ');
  client.language('en');assert.equal(choice('backpack').children[2].textContent,'ALREADY OWNED');assert.match(choice('backpack').children[1].textContent,/movement −10%/);assert.match(choice('grenade').children[2].textContent,/WAVE 15/);
  client.event({event:'supply-denied',id:'guest',reason:'owned'});assert.equal(client.node('toast').textContent,'You already own this backpack.');
  state.wave=15;client.update(state);assert.equal(choice('armor').disabled,false);
  const detached=choice('armor');state.paused=true;client.update(state);const commands=client.sent.length;detached.onclick();client.node('practice-backpack').onclick();assert.equal(client.sent.length,commands);assert.equal(client.node('practice-backpack').disabled,true);
});

test('backpack capacity changes rack and ground hints without replacing a held weapon early, then a new game hides extra slots',()=>{
  const {client,state,self}=arsenalClient('pistol','rifle');state.wave=12;self.ownedWeapons=['pistol','rifle'];
  const rack=ARMORY.find(item=>item.weapon==='shotgun');Object.assign(self,{x:rack.x+Math.sin(rack.facing)*1.1,y:rack.y,z:rack.z+Math.cos(rack.facing)*1.1,points:9999});
  client.update(state);assert.match(client.node('interaction-text').textContent,/remplace/);
  self.backpack=true;self.weaponSlots=4;client.update(state);assert.match(client.node('interaction-text').textContent,/emplacement libre/);
  const dropped={id:'floor-bag',kind:'weapon',weapon:'smg',ammo:7,reserve:13,x:self.x,y:self.y,z:self.z};state.pickups=[dropped];self.nearbyWeaponId=dropped.id;client.update(state);assert.match(client.node('interaction-text').textContent,/Ramasser MITRAILLETTE/);assert.doesNotMatch(client.node('interaction-text').textContent,/Échanger/);
  self.weapons.push({weapon:'shotgun',ammo:3,reserve:4,magazine:WEAPONS.shotgun.magazine},{weapon:'katana',ammo:0,reserve:0,magazine:0});self.ownedWeapons.push('shotgun','katana');client.update(state);assert.match(client.node('interaction-text').textContent,/Échanger/);
  const teammate=state.players.find(player=>player.id==='host');teammate.backpack=true;client.update(state);client.frame(100);assert.ok(client.survivorCalls.some(pose=>pose.backpack===true));
  self.downed=true;client.update(state);assert.equal(client.node('backpack-status').hidden,false);assert.equal(client.node('weapon-slot-4').hidden,false);
  self.downed=false;self.backpack=false;self.weaponSlots=2;self.weapons=self.weapons.slice(0,2);self.ownedWeapons=self.ownedWeapons.slice(0,2);state.phase='countdown';state.wave=0;client.update(state);
  assert.equal(client.node('backpack-status').hidden,true);assert.equal(client.node('weapon-slot-3').hidden,true);assert.equal(client.node('weapon-slot-4').hidden,true);
  client.lock();const messages=client.sent.length;client.dispatch('keydown',{code:'Digit3',repeat:false});client.dispatch('keydown',{code:'Digit4',repeat:false});assert.equal(client.sent.length,messages,'base inventory has no hidden 3rd or 4th selection');
});

test('walking, sprinting and crouching keep the same bounded camera bob at 30–240 render frames per second',()=>{
  for(const hz of [30,60,144,240]) for(const posture of ['walk','sprint','crouch']) {
    const simulation=room(),client=clientHarness('guest',{fakeNow:0});simulation.start('host');
    const state=simulation.snapshot(),self=state.players.find(player=>player.id==='guest');state.phase='wave';
    self.crouched=posture==='crouch';self.eyeHeight=self.crouched?PLAYER_POSTURE.crouchedEye:PLAYER_POSTURE.standingEye;
    client.update(state);client.enter();client.lock();client.frame(0);
    client.dispatch('keydown',{code:'KeyW'});
    if(posture==='sprint')client.dispatch('keydown',{code:'ShiftLeft'});
    if(posture==='crouch')client.dispatch('keydown',{code:'KeyC',preventDefault(){}});
    const amplitude=self.crouched?.012:.028,eye=self.y+self.eyeHeight;let peak=0;
    // Walking against a wall still moves the view but not the authoritative
    // feet. Reusing the last bob in the next interpolation used to amplify it.
    for(let index=1;index<=hz*6;index++) {
      const now=index*1000/hz;client.time(now);client.frame(now);
      const offset=Math.abs(client.cameraY()-eye);peak=Math.max(peak,offset);
      assert.ok(offset<=amplitude+1e-9,`${posture} at ${hz} Hz: camera bob ${offset} exceeds ${amplitude}`);
    }
    assert.ok(peak>amplitude*.99,`${posture} at ${hz} Hz: the intended bob is still visible`);
    const aim=client.aim();client.dispatch('keyup',{code:'KeyW'});client.frame(6100);
    assert.ok(Math.abs(client.cameraY()-eye)<1e-9,'stopping cannot leave an accumulated camera offset');
    // Sprinting widens the view a little (yaw and pitch never move) and
    // stopping eases it back to the normal field of view.
    const {fov:sprintFov,...view}=aim,{fov:_,...after}=client.aim();
    assert.deepEqual(after,view,'walking bob never rotates the view');
    if(posture==='sprint')assert.ok(sprintFov>76+4.9,`sprinting widens the view (${sprintFov})`);else assert.equal(sprintFov,76);
    for(let index=1;index<=120;index++)client.frame(6100+index*1000/60);
    assert.equal(client.aim().fov,76,'the normal field of view returns');
  }
});

test('sprinting widens the view smoothly even while 30 Hz snapshots keep arriving', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave';
  client.update(state); client.enter(); client.lock(); client.frame(0);
  client.dispatch('keydown', { code: 'KeyW' }); client.dispatch('keydown', { code: 'ShiftLeft' });
  let previous = 76;
  for (let index = 1; index <= 120; index++) {
    const now = index * 1000 / 60; client.time(now); client.frame(now);
    if (index % 2 === 0) client.update(state); // a snapshot every other frame
    const fov = client.aim().fov;
    assert.ok(fov >= previous - 1e-9, `the view never snaps back while sprinting (${previous} -> ${fov})`);
    previous = fov;
  }
  assert.ok(previous > 80.9, `the sprint boost is reached (${previous})`);
});

test('view input stops immediately on lost focus, hidden document or DOM capture before pointerlockchange',()=>{
  for(const interrupt of [
    client=>client.dispatchWindow('blur'),
    client=>{client.hidden(true);client.dispatch('visibilitychange');},
    client=>client.domLock(false),
    client=>client.focus(false),
  ]){
    const client=clientHarness(),simulation=room();simulation.start('host');client.update(simulation.snapshot());client.enter();client.lock();client.frame(1000);
    client.dispatch('mousemove',{movementX:20,movementY:-5});const aim=client.aim();
    interrupt(client);
    client.dispatch('mousemove',{movementX:1000,movementY:200});
    assert.deepEqual(client.aim(),aim,'pending capture notifications cannot rotate the view after focus is gone');
    client.hidden(false);client.dispatchWindow('focus');
    client.dispatch('mousemove',{movementX:1000,movementY:200});
    assert.deepEqual(client.aim(),aim,'returning focus alone does not resume a released capture');
    client.lock();client.dispatch('mousemove',{movementX:10,movementY:0});
    assert.ok(Math.abs(client.aim().yaw-aim.yaw+.018)<1e-9,'a new capture restores ordinary sensitivity');
  }
});

test('first render, countdown and ordinary snapshots preserve mouse input already accepted locally',()=>{
  const client=clientHarness(),simulation=room();
  const player=simulation.players.get('guest');player.yaw=.7;player.pitch=-.2;
  client.update(simulation.snapshot());client.enter();client.lock();
  assert.equal(client.aim().yaw,.7,'first server pose initializes aim before entering');
  client.dispatch('mousemove',{movementX:200,movementY:-10});const aim=client.aim();
  client.frame(1000);assert.deepEqual(client.aim(),aim,'first frame cannot undo mouse input');
  simulation.start('host');client.update(simulation.snapshot());
  client.dispatch('mousemove',{movementX:30,movementY:5});const countdownAim=client.aim();
  client.frame(1016);assert.deepEqual(client.aim(),countdownAim,'resetting camera height for countdown cannot reset local aim');
  player.yaw=-2;player.pitch=1.2;player.y=3.4;client.update(simulation.snapshot());client.frame(1032);
  assert.deepEqual(client.aim(),countdownAim,'an old authoritative aim or a change of floor cannot turn the view');
});

test('an explicit resume restores capture after a visibility-only interruption, while late capture without focus is refused',()=>{
  const client=clientHarness(),simulation=room();simulation.start('host');client.update(simulation.snapshot());client.enter();client.lock();
  client.dispatch('mousemove',{movementX:20,movementY:-5});const aim=client.aim();
  client.hidden(true);client.dispatch('visibilitychange');
  client.gainCapture();client.dispatch('mousemove',{movementX:1000,movementY:200});
  assert.deepEqual(client.aim(),aim);assert.equal(client.node('pause').hidden,false);
  client.hidden(false);client.focus(true);client.dispatch('visibilitychange');
  client.dispatch('mousemove',{movementX:1000,movementY:200});assert.deepEqual(client.aim(),aim);
  client.enablePointerRequest();client.node('resume-button').onclick();client.gainCapture();
  assert.equal(client.node('pause').hidden,true);
  client.dispatch('mousemove',{movementX:10,movementY:0});
  assert.ok(Math.abs(client.aim().yaw-aim.yaw+.018)<1e-9,'resuming must not require an extra window.focus notification');
});

test('finite fast mouse turns remain uncapped while invalid deltas cannot poison local aim',()=>{
  const client=clientHarness(),simulation=room();simulation.start('host');client.update(simulation.snapshot());client.enter();client.lock();client.frame(1000);
  const before=client.aim();client.dispatch('mousemove',{movementX:1000,movementY:200});
  assert.ok(Math.abs(client.aim().yaw-before.yaw+1.8)<1e-9,'a legitimate fast turn keeps all its movement');
  assert.ok(Math.abs(client.aim().pitch-before.pitch+.36)<1e-9);
  const aim=client.aim();
  for(const [movementX,movementY] of [[NaN,0],[0,Infinity],[undefined,5],['20',0]]){
    client.dispatch('mousemove',{movementX,movementY});assert.deepEqual(client.aim(),aim);
  }
});

test('the opt-in aim recording captures real client mouse/focus/frame context and freezes on F8 without pausing or networking',()=>{
  const client=clientHarness('guest',{fakeNow:1000}),simulation=room();simulation.start('host');client.update(simulation.snapshot());client.enter();client.lock();client.frame(1000);
  client.node('aim-diagnostic-report').onclick();assert.equal(client.node('aim-diagnostic-output').value,'');
  client.node('aim-diagnostic-enable').onchange({target:{checked:true}});
  client.time(1010);client.dispatch('mousemove',{movementX:1000,movementY:200,timeStamp:1008,isTrusted:true});
  const aim=client.aim();client.time(1020);client.frame(1020);
  const count=client.sent.length;let prevented=0;
  client.dispatch('keydown',{code:'F8',preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(client.sent.length,count,'capture does not send telemetry, movement or a pause request');
  assert.equal(client.node('pause').hidden,true);assert.deepEqual(client.aim(),aim);
  client.node('aim-diagnostic-report').onclick();const report=JSON.parse(client.node('aim-diagnostic-output').value);
  assert.equal(report.captured,true);assert.equal(report.enabled,true);assert.equal(report.events.at(-1).type,'capture');
  const mouse=report.events.find(event=>event.type==='mouse');
  assert.equal(mouse.data.movementX,1000);assert.equal(mouse.data.accepted,true);
  assert.equal(mouse.data.capture.dom,true);assert.equal(mouse.data.capture.focused,true);assert.equal(mouse.data.eventTime,1008);
  assert.equal(mouse.data.after.yaw,aim.yaw);assert.ok(mouse.data.before.yaw!==aim.yaw);
  assert.ok(report.events.some(event=>event.type==='frame'&&event.data.pose&&event.data.camera));
  const frozen=client.node('aim-diagnostic-output').value;
  client.time(2000);client.dispatch('mousemove',{movementX:10,movementY:0});client.dispatchWindow('blur');
  client.node('aim-diagnostic-report').onclick();assert.equal(client.node('aim-diagnostic-output').value,frozen);
  client.node('aim-diagnostic-clear').onclick();client.lock();client.time(2010);client.dispatchWindow('blur');
  client.time(2020);client.dispatch('mousemove',{movementX:1000,movementY:200});
  client.node('aim-diagnostic-report').onclick();const next=JSON.parse(client.node('aim-diagnostic-output').value);
  assert.equal(next.captured,false);assert.ok(next.events.some(event=>event.type==='blur'));
  assert.equal(next.events.find(event=>event.type==='mouse').data.accepted,false);
  assert.equal(next.events.some(event=>event.type==='capture'),false);
  assert.equal(JSON.stringify(next).includes('ABC123'),false);assert.equal(JSON.stringify(next).includes('Invité'),false);
  client.language('en');assert.match(client.node('aim-diagnostic-status').textContent,/Recording/);
  client.node('aim-diagnostic-enable').onchange({target:{checked:false}});
  assert.equal(client.node('aim-diagnostic-output').hidden,true);assert.equal(client.node('aim-diagnostic-output').value,'');
  assert.equal(client.node('aim-diagnostic-report').disabled,true);assert.equal(client.node('aim-diagnostic-status').textContent,'Recording disabled.');
  client.time(3000);client.dispatch('mousemove',{movementX:10,movementY:0});
  client.node('aim-diagnostic-report').onclick();assert.equal(client.node('aim-diagnostic-output').value,'');
});

// Mouse look, 14 October 2026: raw capture with fallback, and the narrow
// warp-echo guard in system movement mode (validation/aim-jumps-2026-10-14.md).
const notSupported = () => Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
function mouseLookClient({ knowsRaw = true, ...options } = {}) {
  const client = clientHarness('guest', options), simulation = room(); simulation.start('host'); client.update(simulation.snapshot());
  const calls = []; let answer = () => Promise.resolve();
  // Like the browser, the options are converted during the call; a browser
  // without raw movement leaves unadjustedMovement unread.
  client.node('game').requestPointerLock = (...args) => {
    const converted = args.map(value => knowsRaw ? { unadjustedMovement: value?.unadjustedMovement } : 'unread');
    calls.push(converted); return answer(...converted);
  };
  return { client, calls, answer: value => { answer = value; } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('mouse capture asks for raw movement by default and divides raw counts by the pixel ratio without filtering them', async () => {
  const { client, calls } = mouseLookClient({ fakeNow: 1000 });
  assert.equal(client.node('raw-mouse').checked, true);
  assert.equal(client.node('raw-mouse-status').textContent, '', 'nothing to report before the first capture');
  client.enter(); await settle();
  assert.deepEqual(calls, [[{ unadjustedMovement: true }]]);
  client.gainCapture(); assert.equal(client.node('pause').hidden, true);
  assert.deepEqual(client.mouseLook(), { raw: true, rawUnsupported: false, lockMode: 'raw', droppedSpikes: 0 });
  assert.equal(client.node('raw-mouse-status').textContent, 'Souris brute active.');
  client.viewport({ pixelRatio: 1.5 });
  const before = client.aim(); client.dispatch('mousemove', { movementX: 30, movementY: -15, timeStamp: 100 });
  assert.ok(Math.abs(client.aim().yaw - (before.yaw - 30 * .0018 / 1.5)) < 1e-12, 'the sensitivity keeps its meaning on a 150 % display');
  assert.ok(Math.abs(client.aim().pitch - (before.pitch + 15 * .0018 / 1.5)) < 1e-12);
  // Raw counts never come from a cursor warp: a sudden large count is a real turn.
  const fast = client.aim();
  client.dispatch('mousemove', { movementX: 0, movementY: 0, timeStamp: 116 });
  client.dispatch('mousemove', { movementX: 900, movementY: 0, timeStamp: 116.3 });
  assert.ok(Math.abs(client.aim().yaw - (fast.yaw - 900 * .0018 / 1.5)) < 1e-12);
  assert.equal(client.mouseLook().droppedSpikes, 0);
  client.language('en'); assert.equal(client.node('raw-mouse-status').textContent, 'Raw mouse active.');
});

test('an unsupported raw option falls back once to the plain capture, ignores its own pointerlockerror and is remembered', async () => {
  const { client, calls, answer } = mouseLookClient();
  answer(options => options?.unadjustedMovement ? Promise.reject(notSupported()) : Promise.resolve());
  client.enter(); await settle();
  assert.deepEqual(calls, [[{ unadjustedMovement: true }], []]);
  client.dispatch('pointerlockerror', {}); // queued by the refused option
  assert.equal(client.node('pause').hidden, true, 'the refused option does not open the menu');
  client.gainCapture(); assert.equal(client.node('pause').hidden, true);
  assert.deepEqual(client.mouseLook(), { raw: true, rawUnsupported: true, lockMode: 'adjusted', droppedSpikes: 0 });
  assert.equal(client.node('raw-mouse-status').textContent, 'Souris brute indisponible dans ce navigateur : mouvement du système utilisé.');
  const before = client.aim(); client.dispatch('mousemove', { movementX: 10, movementY: 0, timeStamp: 50 });
  assert.ok(Math.abs(client.aim().yaw - before.yaw + .018) < 1e-12, 'system movement keeps its pixel scale');
  client.dispatch('keydown', { code: 'Escape', preventDefault() {} }); assert.equal(client.node('pause').hidden, false);
  client.node('resume-button').onclick(); await settle();
  assert.deepEqual(calls.slice(2), [[]], 'later captures skip the refused option');
  client.dispatch('pointerlockerror', {}); assert.equal(client.node('pause').hidden, false, 'a genuine refusal still opens the menu');
  assert.deepEqual(client.warnings, []);
});

test('other capture refusals are not retried and keep the existing explanation', async () => {
  const { client, calls, answer } = mouseLookClient();
  answer(() => Promise.reject(Object.assign(new Error('gesture'), { name: 'NotAllowedError' })));
  client.enter(); await settle();
  assert.equal(calls.length, 1); assert.equal(client.node('pause').hidden, false);
  assert.match(client.node('pause-description').textContent, /La souris n’a pas pu être activée/);
  assert.equal(client.warnings.length, 1); assert.equal(client.warnings[0][1], 'NotAllowedError');
  assert.deepEqual(client.mouseLook(), { raw: true, rawUnsupported: false, lockMode: null, droppedSpikes: 0 });
});

test('the raw mouse setting is personal, persisted and applies at the next capture without a room message', async () => {
  const { client, calls } = mouseLookClient({ savedRawMouse: 'off' });
  assert.equal(client.node('raw-mouse').checked, false);
  client.enter(); await settle(); assert.deepEqual(calls, [[]]);
  client.gainCapture(); assert.equal(client.node('raw-mouse-status').textContent, 'Mouvement du système actif, selon les réglages du pointeur de l’ordinateur.');
  client.dispatch('keydown', { code: 'Escape', preventDefault() {} });
  const sent = client.sent.length;
  client.node('raw-mouse').onchange({ target: { checked: true } });
  assert.equal(client.storedValues.get(RAW_MOUSE_KEY), 'on'); assert.equal(client.sent.length, sent);
  assert.equal(client.node('raw-mouse-status').textContent, 'Le choix s’applique à la prochaine capture de la souris.');
  client.node('resume-button').onclick(); await settle();
  assert.deepEqual(calls[1], [{ unadjustedMovement: true }]);
  client.gainCapture(); assert.equal(client.node('raw-mouse-status').textContent, 'Souris brute active.');
  client.dispatch('keydown', { code: 'Escape', preventDefault() {} });
  client.node('raw-mouse').onchange({ target: { checked: false } }); assert.equal(client.storedValues.get(RAW_MOUSE_KEY), 'off');
  assert.equal(client.node('raw-mouse-status').textContent, 'Le choix s’applique à la prochaine capture de la souris.');
  const unknown = clientHarness('guest', { savedRawMouse: 'garbage' });
  assert.equal(unknown.node('raw-mouse').checked, true, 'an unknown stored value keeps the recommended default');
  // Before any capture, a change is shown by the box alone: nothing was applied yet.
  unknown.node('raw-mouse').onchange({ target: { checked: false } });
  assert.equal(unknown.node('raw-mouse').checked, false); assert.equal(unknown.node('raw-mouse-status').textContent, '');
});

test('a browser that ignores the raw option is shown and treated as system movement, and later captures stay plain', async () => {
  const { client, calls } = mouseLookClient({ knowsRaw: false, fakeNow: 1000 });
  client.enter(); await settle();
  assert.deepEqual(calls, [['unread']], 'one request, no retry');
  client.gainCapture(); assert.equal(client.node('pause').hidden, true);
  assert.deepEqual(client.mouseLook(), { raw: true, rawUnsupported: true, lockMode: 'adjusted', droppedSpikes: 0 });
  assert.equal(client.node('raw-mouse-status').textContent, 'Souris brute indisponible dans ce navigateur : mouvement du système utilisé.');
  client.viewport({ width: 1696, height: 1273, pixelRatio: 1.5 });
  const before = client.aim(); client.dispatch('mousemove', { movementX: 30, movementY: 0, timeStamp: 100 });
  assert.ok(Math.abs(client.aim().yaw - (before.yaw - 30 * .0018)) < 1e-12, 'CSS pixels are not divided by the pixel ratio');
  const guarded = client.aim(); client.dispatch('mousemove', { movementX: 600, movementY: 0, timeStamp: 100.3 });
  assert.equal(client.aim().yaw, guarded.yaw, 'the warp guard stays on'); assert.equal(client.mouseLook().droppedSpikes, 1);
  client.dispatch('keydown', { code: 'Escape', preventDefault() {} });
  client.node('resume-button').onclick(); await settle();
  assert.deepEqual(calls.slice(1), [[]], 'the ignored option is not sent again');
  client.language('en'); assert.equal(client.node('raw-mouse-status').textContent, 'Raw mouse is unavailable in this browser: using system movement. Cursor jumps ignored: 1.');
});

test('overlapping capture requests: the last one granted sets the mode, a refused one leaves it alone', async () => {
  // A raw request is pending when a second one is refused, as Chromium does
  // for different options while a lock is pending (review of 14 October).
  const first = mouseLookClient({ fakeNow: 1000 }), pending = deferred();
  first.answer(() => pending.promise); first.client.enter();
  first.answer(() => Promise.reject(Object.assign(new Error('pending'), { name: 'InUseAttributeError' })));
  first.client.node('resume-button').onclick(); await settle();
  assert.equal(first.calls.length, 2); assert.equal(first.client.mouseLook().lockMode, null);
  pending.resolve(); await settle();
  assert.equal(first.client.mouseLook().lockMode, 'raw', 'the granted raw capture is the one in place');
  first.client.gainCapture(); assert.equal(first.client.node('pause').hidden, true);
  first.client.viewport({ pixelRatio: 1.5 });
  const before = first.client.aim(); first.client.dispatch('mousemove', { movementX: 30, movementY: 0, timeStamp: 100 });
  assert.ok(Math.abs(first.client.aim().yaw - (before.yaw - 30 * .0018 / 1.5)) < 1e-12, 'raw counts are scaled');
  assert.equal(first.client.node('raw-mouse-status').textContent, 'Souris brute active.');
  // A raw request pending, a second one granted at once (same options), then
  // the first refused for its option: its plain fallback is the capture in place.
  const second = mouseLookClient(), raw = deferred(), plain = deferred();
  second.answer(options => options?.unadjustedMovement ? raw.promise : plain.promise); second.client.enter();
  second.answer(options => options?.unadjustedMovement ? Promise.resolve() : plain.promise);
  second.client.node('resume-button').onclick(); await settle();
  assert.equal(second.client.mouseLook().lockMode, 'raw');
  second.answer(options => options?.unadjustedMovement ? raw.promise : plain.promise);
  raw.reject(notSupported()); await settle();
  assert.deepEqual(second.calls, [[{ unadjustedMovement: true }], [{ unadjustedMovement: true }], []]);
  plain.resolve(); await settle();
  assert.deepEqual(second.client.mouseLook(), { raw: true, rawUnsupported: true, lockMode: 'adjusted', droppedSpikes: 0 });
  second.client.dispatch('pointerlockerror', {}); assert.equal(second.client.node('pause').hidden, true, 'the refused option does not open the menu');
  assert.deepEqual(second.client.warnings, []);
});

test('in system movement mode the real trace replays with exactly its three warp echoes dropped, counted and recorded', async () => {
  const trace = JSON.parse(readFileSync(new URL('./fixtures/aim-trace-mouse-2026-10-11.json', import.meta.url), 'utf8'));
  const { client } = mouseLookClient({ fakeNow: 5000, savedRawMouse: 'off' });
  client.viewport(trace.viewport);
  client.node('aim-diagnostic-enable').onchange({ target: { checked: true } });
  client.enter(); await settle(); client.gainCapture();
  let { yaw, pitch } = client.aim();
  for (const [index, time, movementX, movementY] of trace.events) {
    client.dispatch('mousemove', { movementX, movementY, timeStamp: time, isTrusted: true, screenX: 848, screenY: 636, clientX: 848, clientY: 636 });
    if ([107, 265, 267].includes(index)) continue;
    yaw -= movementX * .0018; pitch = Math.max(-1.48, Math.min(1.48, pitch - movementY * .0018));
  }
  assert.ok(Math.abs(client.aim().yaw - yaw) < 1e-9); assert.ok(Math.abs(client.aim().pitch - pitch) < 1e-9);
  assert.equal(client.mouseLook().droppedSpikes, 3);
  assert.equal(client.node('raw-mouse-status').textContent, 'Mouvement du système actif, selon les réglages du pointeur de l’ordinateur. Sauts du curseur ignorés : 3.');
  client.dispatch('keydown', { code: 'F8', preventDefault() {} });
  client.node('aim-diagnostic-report').onclick();
  const report = JSON.parse(client.node('aim-diagnostic-output').value), mouse = report.events.filter(event => event.type === 'mouse');
  assert.equal(mouse.length, trace.events.length);
  assert.deepEqual(mouse.filter(event => event.data.dropped).map(({ data }) => [data.movementX, data.movementY, data.dropped, data.accepted]),
    [[-600, 116, 'warp-echo', false], [594, -90, 'warp-echo', false], [595, -89, 'warp-echo', false]]);
  assert.equal(mouse.filter(event => event.data.large).length, 3, 'no other event of that size in the trace');
  const first = mouse.find(event => event.data.movementX === -600).data;
  assert.ok(Math.abs(first.intervalMs - .4) < 1e-6); assert.ok(Math.abs(first.edgeX + 600 / (1696 * .35)) < 1e-9);
  assert.equal(first.screenX, 848); assert.equal(first.clientY, 636); assert.equal(first.scale, 1);
  assert.deepEqual(first.mouse, { raw: false, rawUnsupported: false, lockMode: 'adjusted', droppedSpikes: 1 });
  assert.ok(mouse.every(event => event.data.mouse.lockMode === 'adjusted'));
  assert.deepEqual(report.metadata.mouse, { raw: false, rawUnsupported: false, lockMode: 'adjusted', droppedSpikes: 3, warpEcho: { border: .35, slackPx: 2, maxIntervalMs: 1 } });
  assert.equal(report.metadata.geometry.width, 1696); assert.equal(report.metadata.geometry.pixelRatio, 1.5);
  assert.ok(Object.hasOwn(report.metadata.browser, 'userAgent'));
  assert.ok(report.events.some(event => event.type === 'pointer-request' && event.data.rawRequested === false && event.data.geometry.height === 1273));
  assert.ok(report.events.some(event => event.type === 'pointer-lock-result' && event.data.mode === 'adjusted' && event.data.error === null));
  assert.ok(report.events.some(event => event.type === 'pointer-lock-change' && event.data.geometry.width === 1696));
  assert.equal(JSON.stringify(report).includes('ABC123'), false); assert.equal(JSON.stringify(report).includes('Invité'), false);
});

test('camera bob is added after smoothing the real moving pose, with unchanged horizontal position and local aim',()=>{
  for(const hz of [30,144,240]) {
    const simulation=room(),client=clientHarness('guest',{fakeNow:0});simulation.start('host');
    let state=simulation.snapshot();state.phase='wave';client.update(state);client.enter();client.lock();client.frame(0);
    client.dispatch('keydown',{code:'KeyW'});client.dispatch('mousemove',{movementX:15,movementY:-8});
    const aim=client.aim(),self=state.players.find(player=>player.id==='guest');
    const base={x:self.x,y:self.y+self.eyeHeight,z:self.z};
    for(let index=1;index<=hz*3;index++) {
      const now=index*1000/hz;client.time(now);
      // Real stair-sized changes, a drop, and authoritative eye-height changes
      // use the personal vertical response, without inheriting the bob.
      if(index%Math.max(1,Math.round(hz/15))===0) {
        self.x+=.04;self.z-=.1;
        self.y=index<hz?Math.floor(index/(hz/5))*.2125:index<hz*2?1:0;
        self.eyeHeight=index<hz*2?PLAYER_POSTURE.standingEye:PLAYER_POSTURE.crouchedEye;
        client.update(state);
      }
      const alpha=1-Math.exp(-Math.min(.05,1/hz)*22);
      for(const axis of ['x','y','z'])base[axis]+=((axis==='y'?self.y+self.eyeHeight:self[axis])-base[axis])*(axis==='y'?cameraSmoothingAlpha(Math.min(.05,1/hz),CAMERA_SMOOTHING_DEFAULTS.heightMs):alpha);
      client.frame(now);const actual=client.cameraPosition();
      assert.ok(Math.abs(actual.x-base.x)<1e-9&&Math.abs(actual.z-base.z)<1e-9,'bob cannot alter horizontal smoothing');
      assert.ok(Math.abs(actual.y-base.y)<=.028+1e-9,`moving pose at ${hz} Hz accumulated vertical bob`);
      assert.deepEqual(client.aim(),aim,'authoritative movement preserves the local viewing direction');
    }
  }
});


test('rocket explosion audio follows visual time across team pause and is cancelled on leaving', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 });
  simulation.start('host');
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.frame(0);
  const player = simulation.players.get('guest');
  const explosion = {event:'explosion',id:'guest',weapon:'rocket',x:player.x,y:player.y+1.5,z:player.z-34};
  client.event(explosion); client.frame(100);
  assert.equal(client.soundCalls.explosions.length,0,'200 ms flight has not completed');
  simulation.setPause('host',true); client.time(100); client.update(simulation.snapshot());
  client.time(10100); client.frame(10100);
  assert.equal(client.soundCalls.explosions.length,0,'no blast while the rocket is frozen');
  simulation.setPause('host',false); client.update(simulation.snapshot()); client.frame(10100);
  assert.equal(client.soundCalls.explosions.length,0);
  client.frame(10210);
  assert.equal(client.soundCalls.explosions.length,1);
  assert.equal(client.soundCalls.explosions[0].weapon,'rocket','selected rocket take is retained');
  client.event(explosion); client.leave(); client.frame(11210);
  assert.equal(client.soundCalls.explosions.length,1,'no explosion leaks onto the home screen');
});

test('the score panel shows score and kills, collected coins fly to the purse, and a held wave ends on its card', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host'); simulation.beginWave(); simulation.toSpawn = 0;
  const player = simulation.players.get('guest'); Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: 0 });
  const opening = simulation.snapshot(); opening.phase = 'wave';
  client.update(opening); client.enter(); simulation.onEvent = event => client.event(event);
  assert.equal(client.node('score-value').textContent, '0');
  assert.equal(client.node('kills-count').textContent, '0'); assert.equal(client.node('kills-value').textContent, 'ÉLIMINATIONS');
  simulation.zombies.set('target', { id: 'target', x: -4.4, y: .4, z: -2, hp: 24, maxHp: 24, kind: 'walker', scale: 1 });
  assert.equal(simulation.shoot('guest'), true);
  simulation.time += .05; simulation.updateBullets(.05);
  const afterKill = simulation.snapshot(); afterKill.phase = 'wave'; client.update(afterKill);
  assert.equal(client.node('score-value').textContent, '24', 'the score is the 24 HP it had');
  assert.equal(client.node('kills-count').textContent, '1'); assert.equal(client.node('kills-value').textContent, 'ÉLIMINATION');
  const popups = () => client.node('score-popups').children ?? [];
  const starred = popups().filter(element => element.className === 'score-popup');
  assert.equal(starred.length, 0, 'no « +10 » or kill score popup any more: its impact number shows it');
  Object.assign(player, { x: -4.4, y: 0, z: -2 }); simulation.tick();
  const collected = simulation.snapshot(); collected.phase = 'wave'; client.update(collected);
  const coins = popups().filter(element => element.className === 'score-popup coin');
  assert.equal(coins.length, 1, 'collected coins get their own gold popup');
  assert.equal(coins[0].textContent, `+${ECONOMY.kill}`);
  client.event({ event: 'pickup', id: 'host', kind: 'points', amount: 999 });
  assert.equal(popups().filter(element => element.className === 'score-popup coin').length, 1, "a teammate's coins are not mine");

  client.time(10000); client.frame(10000);
  assert.equal(client.node('wave-card').hidden, true, 'no card during a wave');
  client.time(20000);
  const held = simulation.snapshot(); held.phase = 'intermission'; held.wave = 3; client.update(held); client.frame(20000);
  assert.equal(client.node('wave-card').hidden, false);
  assert.equal(client.node('wave-card-title').textContent, 'VAGUE 03 TENUE');
  assert.equal(client.node('wave-card-score').textContent, '+24', 'only what this wave earned');
  assert.equal(client.node('wave-card-kills').textContent, '1 élimination');
  assert.notEqual(client.node('toast').textContent, 'Munitions et santé rétablies. Répare les barricades.', 'the card replaces the old toast');
  client.language('en');
  assert.equal(client.node('wave-card-title').textContent, 'WAVE 03 HELD');
  assert.equal(client.node('kills-value').textContent, 'KILL');
  client.language('fr');
  client.time(25900); client.frame(25900);
  assert.equal(client.node('wave-card').hidden, false, 'still there after almost six seconds');
  client.time(26100); client.frame(26100);
  assert.equal(client.node('wave-card').hidden, true, 'gone after six seconds');
  client.leave();
});

test('controller shots rumble with their recoil, follow the rumble setting and stop at the pause', () => {
  const rumbler = () => { const calls = []; return { calls, effects: ['dual-rumble'], playEffect(type, parameters) { calls.push([type, parameters.duration]); return Promise.resolve('complete'); }, reset() { calls.push(['reset']); return Promise.resolve('complete'); } }; };
  const f = controllerClient({ weapon: 'shotgun' }), actuator = rumbler();
  f.pad.vibrationActuator = actuator; f.step();
  f.client.event({ event: 'shot', id: 'guest', weapon: 'shotgun', hits: 0, time: .04, pellets: [] });
  assert.deepEqual(actuator.calls, [['dual-rumble', 130]]);
  f.client.event({ event: 'shot', id: 'host', weapon: 'shotgun', x: 0, y: 1.55, z: 0, yaw: 0, pitch: 0, hits: 0, time: .05, pellets: [] });
  assert.equal(actuator.calls.length, 1, "a teammate's shot does not rumble in my hands");
  f.client.pause();
  assert.deepEqual(actuator.calls.at(-1), ['reset'], 'the pause stops any rumble');
  const quiet = controllerClient({ weapon: 'pistol', settings: { rumble: 'off' } }), silent = rumbler();
  quiet.pad.vibrationActuator = silent; quiet.step();
  quiet.client.event({ event: 'shot', id: 'guest', weapon: 'pistol', hits: 0, time: .04, pellets: [] });
  assert.deepEqual(silent.calls, [], 'rumble off means no rumble');
  assert.equal(quiet.client.node('gamepad-rumble').value, 'off', 'the menu shows the saved setting');
});

test('the interaction plaque sits by a rack seen at an angle and falls back below the crosshair when it is out of view', () => {
  const bat = ARMORY.find(item => item.id === 'bat');
  const plaqueAt = yaw => {
    const simulation = room(), client = clientHarness('guest', { fakeNow: 0, realCamera: true }); simulation.start('host'); simulation.timeLeft = 999;
    Object.assign(simulation.players.get('guest'), { x: bat.x + 1.42, y: 0, z: bat.z + 1, yaw, pitch: 0 });
    const state = simulation.snapshot(); state.phase = 'wave';
    client.update(state); client.enter();
    for (const time of [16, 32, 48]) { client.time(time); client.update(state); client.frame(time); }
    const plaque = client.node('interaction');
    assert.equal(plaque.hidden, false, 'the rack prompt is shown');
    assert.match(client.node('interaction-text').textContent, /BATTE EN BOIS/);
    return { left: parseFloat(plaque.style.left), top: parseFloat(plaque.style.top) };
  };
  const angled = plaqueAt(Math.PI / 8); // the rack ahead and to the left
  assert.ok(angled.left < 1280 / 2 - 120, `left of the crosshair, by the rack: ${angled.left}`);
  assert.ok(angled.top > 800 / 2 && angled.top <= 800 * .66, `below the rack and above the bottom HUD: ${angled.top}`);
  const away = plaqueAt(Math.PI); // the rack behind
  assert.deepEqual(away, { left: 640, top: 512 }, 'fallback: centred, below the crosshair');
});

test('during the break, N or the View button calls the next wave; the plaque counts the team and teammates are announced', () => {
  const simulation = room(); simulation.start('host'); simulation.phase = 'wave'; simulation.wave = 1; simulation.toSpawn = 0; simulation.zombies.clear();
  simulation.finishWave();
  const client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.update(simulation.snapshot()); client.frame(16);
  assert.equal(client.node('next-wave').hidden, false, 'shown during the break');
  assert.equal(client.node('next-wave-text').textContent, 'PRÊT POUR LA VAGUE SUIVANTE');
  assert.equal(client.node('next-wave-count').textContent, '0/2');
  client.dispatch('keydown', { code: 'KeyN', repeat: false });
  assert.deepEqual(client.sent.filter(message => message.type === 'next-wave'), [{ type: 'next-wave', ready: true }]);
  simulation.onEvent = event => client.event(event);
  simulation.voteNextWave('host');
  assert.equal(client.node('toast').textContent, 'Hôte est prêt · 1/2', "a teammate's vote is announced");
  simulation.voteNextWave('guest');
  client.update(simulation.snapshot());
  assert.equal(client.node('next-wave-text').textContent, 'LA VAGUE ARRIVE');
  assert.equal(client.node('next-wave').classList.contains('called'), true);
  client.language('en');
  assert.equal(client.node('next-wave-text').textContent, 'THE WAVE IS COMING');
  client.language('fr');
  for (let step = 0; step < 4 * 30; step++) simulation.tick(1 / 30);
  client.update(simulation.snapshot());
  assert.equal(simulation.phase, 'wave');
  assert.equal(client.node('next-wave').hidden, true, 'hidden during a wave');
  const before = client.sent.length;
  client.dispatch('keydown', { code: 'KeyN', repeat: false });
  assert.equal(client.sent.length, before, 'N does nothing during a wave');
});

test('the View button calls the next wave during the break and still pauses during a wave', () => {
  const f = controllerClient();
  f.state.phase = 'intermission'; f.client.update(f.state); f.step();
  f.button('view'); f.button('view', false);
  assert.deepEqual(f.client.sent.filter(message => message.type === 'next-wave'), [{ type: 'next-wave', ready: true }]);
  assert.equal(f.client.node('pause').hidden, true, 'no pause');
  assert.equal(f.client.node('next-wave-key').textContent, '⧉', 'the plaque shows the View button');
  f.state.phase = 'wave'; f.client.update(f.state); f.step();
  f.button('view');
  assert.equal(f.client.node('pause').hidden, false, 'View still pauses during a wave');
});

test('pulled coins glide between snapshots, and position-tier glasses grant enemy markers', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave';
  state.pickups = [{ id: 'coin', kind: 'points', x: 0, y: 0, z: 0, amount: 24, special: false }];
  client.update(state); client.enter();
  state.pickups = [{ ...state.pickups[0], x: .3 }]; client.update(state);
  const mesh = client.pickupMesh('coin');
  assert.equal(mesh.position.x, 0, 'no hop at the snapshot');
  client.time(16); client.frame(16);
  assert.ok(mesh.position.x > 0 && mesh.position.x < .3, `glides: ${mesh.position.x}`);
  state.pickups = [{ ...state.pickups[0], x: 6 }]; client.update(state);
  assert.equal(mesh.position.x, 6, 'a far jump is not a glide');
  const zombie = (id, x) => ({ id, kind: 'walker', x, y: 0, z: -3, yaw: 0, hp: 50, maxHp: 50 });
  state.zombies = [zombie('z1', -1), zombie('z2', 1), zombie('z3', 2), zombie('z4', 3)]; state.remaining = 4;
  client.update(state); client.time(32); client.frame(32);
  assert.equal(client.stragglerCount(), 0, 'four left: no marker');
  state.zombies = state.zombies.slice(0, 2); state.remaining = 2;
  client.update(state); client.time(48); client.frame(48);
  assert.equal(client.stragglerCount(), 0, 'last enemies are not marked for free');
  state.players.find(player => player.id === 'guest').bonus = { radar: 3 }; state.time = 6; client.update(state); client.frame(160);
  assert.equal(client.stragglerCount(), 2, 'position-tier glasses locate the two enemies');
  state.zombies = []; state.remaining = 0; state.phase = 'intermission';
  client.update(state); client.time(64); client.frame(64);
  assert.equal(client.stragglerCount(), 0, 'cleared with the wave');
});

test('the wave card leaves when the next wave starts early, and keeps only its checklist without per-wave totals', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host'); simulation.beginWave(); simulation.toSpawn = 0;
  client.update(simulation.snapshot()); client.enter();
  simulation.zombies.clear(); simulation.finishWave();
  client.time(1000); client.update(simulation.snapshot()); client.frame(1000);
  assert.equal(client.node('wave-card').hidden, false);
  assert.equal(client.node('wave-card-stats').hidden, false, 'the server sends what this wave earned');
  simulation.voteNextWave('host'); simulation.voteNextWave('guest');
  for (let step = 0; step < 4 * 30; step++) simulation.tick(1 / 30);
  client.time(4200); client.update(simulation.snapshot()); client.frame(4200);
  assert.equal(simulation.phase, 'wave');
  assert.equal(client.node('wave-card').hidden, true, 'gone with the new wave, before its six seconds');
  const legacy = simulation.snapshot(); legacy.phase = 'intermission';
  for (const player of legacy.players) { delete player.waveScore; delete player.waveKills; }
  client.update(legacy); client.frame(4300);
  assert.equal(client.node('wave-card').hidden, false);
  assert.equal(client.node('wave-card-stats').hidden, true, 'no invented totals');
  client.leave();
  assert.equal(client.node('wave-card').hidden, true, 'leaving hides it');
});

test('the plaque stays above the wave card and never covers the crosshair, whatever its width', () => {
  const bat = ARMORY.find(item => item.id === 'bat');
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0, realCamera: true }); simulation.start('host'); simulation.timeLeft = 999;
  Object.assign(simulation.players.get('guest'), { x: bat.x + 1.42, y: 0, z: bat.z + 1, yaw: Math.PI / 8, pitch: 0 });
  const state = simulation.snapshot(); state.phase = 'wave';
  client.update(state); client.enter();
  const plaque = client.node('interaction'), card = client.node('wave-card');
  const place = time => { client.time(time); client.update(state); client.frame(time); return { left: parseFloat(plaque.style.left), top: parseFloat(plaque.style.top) }; };
  place(16);
  // A wide plaque (a long rack prompt) whose anchor is close to the centre.
  Object.assign(plaque, { offsetWidth: 900, offsetHeight: 46 });
  const wide = place(32);
  assert.ok(!(wide.top < 400 + 34 && wide.top + 46 > 400 - 34), `clear of the crosshair: ${wide.top}`);
  // The wave card (128 px from the bottom, 114 px tall) starts at 558 px on this 800-pixel screen.
  card.getBoundingClientRect = () => ({ top: 558, left: 430, width: 420, height: 114 });
  state.phase = 'intermission'; client.time(40); client.update(state);
  assert.equal(card.hidden, false, 'a held wave shows its card');
  const above = place(48);
  assert.ok(above.top + 46 <= 558 - 10, `above the card: ${above.top}`);
  assert.ok(!(above.top < 400 + 34 && above.top + 46 > 400 - 34), `and still clear of the crosshair: ${above.top}`);
});

test('the last enemy of a wave falls in slow motion; any other kill keeps full speed', () => {
  const run = remaining => {
    const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
    const state = simulation.snapshot(); state.phase = 'wave'; state.remaining = remaining;
    client.update(state); client.enter(); client.time(16); client.frame(16);
    const before = client.visualTime();
    client.event({ event: 'kill', id: 'host', zombieId: 'last', weapon: 'pistol', x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, headshot: false, score: 100, chain: 1, chainBonus: 0, chainId: 1 });
    for (let time = 32; time <= 416; time += 16) { client.time(time); client.frame(time); }
    return client.visualTime() - before;
  };
  const last = run(1), other = run(2);
  assert.ok(other > .35, `full speed: ${other}`);
  assert.ok(last < other * .45, `slow motion: ${last} vs ${other}`);
});

test('the night ends on its last kill: the chain banner and the slow motion survive the start of the extraction', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave'; state.wave = 20; state.remaining = 1;
  client.update(state); client.enter(); client.time(16); client.frame(16);
  const before = client.visualTime();
  client.event({ event: 'kill', id: 'guest', zombieId: 'boss', weapon: 'fireaxe', x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, headshot: false, boss: true, score: 600, chain: 10, chainBonus: 100, chainId: 3 });
  const extraction = simulation.snapshot(); extraction.phase = 'extraction'; extraction.wave = 20; extraction.remaining = 0;
  client.update(extraction);
  assert.equal(client.node('chain-banner').hidden, false, 'the last chain is announced, not wiped');
  assert.match((client.node('chain-banner').children ?? []).map(child => child.textContent).join(' '), /TORNADE/);
  for (let time = 32; time <= 416; time += 16) { client.time(time); client.frame(time); }
  assert.ok(client.visualTime() - before < .2, `still in slow motion: ${client.visualTime() - before}`);
});

test("a teammate's rocket fills the feed once, after the rocket lands", () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave'; state.remaining = 30;
  const host = state.players.find(player => player.id === 'host'); Object.assign(host, { x: 0, y: 0, z: 30 });
  client.update(state); client.enter(); client.time(16); client.frame(16);
  for (let chain = 1; chain <= 12; chain++) client.event({ event: 'kill', id: 'host', zombieId: `r${chain}`, weapon: 'rocket', x: 0, y: 0, z: 0, dirX: 0, dirZ: -1, headshot: false, score: 100, chain, chainBonus: 0, chainId: 7 });
  client.time(32); client.frame(32);
  assert.equal(client.node('team-chain-feed').children?.length ?? 0, 0, 'not before the rocket lands');
  for (let time = 48; time <= 400; time += 16) { client.time(time); client.frame(time); }
  assert.deepEqual((client.node('team-chain-feed').children ?? []).map(line => line.textContent), ['Hôte · OURAGAN !']);
});

test('kills right after a resume are not dropped while the resume snapshot is on its way', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave'; state.remaining = 20; state.paused = true;
  client.update(state); client.enter(); client.time(16); client.frame(16);
  client.event({ event: 'pause', id: 'host', paused: false, pauseById: null });
  client.event({ event: 'kill', id: 'guest', zombieId: 'z1', weapon: 'pistol', x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, headshot: false, score: 100, chain: 2, chainBonus: 25, chainId: 1 });
  client.time(32); client.frame(32);
  assert.equal(client.node('chain-banner').hidden, false, 'the double is announced');
});

// The kill sound hears the head shot, the kind of weapon, a heavy enemy and a
// rocket's flight (art/frisson/KILL-SOUND.md 3.2 and 6.1); Famille ignores them.
test('a local kill tells the kill sound its head shot, its kind, a heavy enemy and the rocket delay', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(); state.phase = 'wave'; state.remaining = 30;
  Object.assign(state.players.find(player => player.id === 'guest'), { x: 0, y: 0, z: 30 });
  state.zombies = [{ id: 'hulk', kind: 'brute', boss: false, hp: 500, maxHp: 500, x: 0, y: 0, z: -4, yaw: 0 }, { id: 'crawl', kind: 'crawler', hp: 40, maxHp: 40, x: 1, y: 0, z: -4, yaw: 0 }];
  client.update(state); client.enter(); client.time(16); client.frame(16);
  let n = 0;
  const kill = (weapon, extra = {}) => {
    const before = client.soundCalls.killArgs.length;
    client.event({ event: 'kill', id: 'guest', zombieId: `k${++n}`, weapon, x: 0, y: 0, z: 0, dirX: 0, dirZ: -1, headshot: false, score: 100, chain: 1, chainBonus: 0, chainId: n, ...extra });
    assert.equal(client.soundCalls.killArgs.length, before + 1, `${weapon}: one kill call`);
    return client.soundCalls.killArgs.at(-1);
  };
  assert.deepEqual(kill('pistol', { headshot: true }), [true, 'shot', false, 0]);
  assert.deepEqual(kill('pistol'), [false, 'shot', false, 0]);
  // The SMG and the rifle get a hit-stop like any bullet: shots, not streams.
  assert.deepEqual(kill('smg'), [false, 'shot', false, 0]);
  assert.deepEqual(kill('rifle'), [false, 'shot', false, 0]);
  assert.deepEqual(kill('minigun'), [false, 'stream', false, 0]);
  assert.deepEqual(kill('flamethrower'), [false, 'stream', false, 0], 'a burning zombie too');
  for (const weapon of Object.keys(MELEE_WEAPONS)) assert.deepEqual(kill(weapon), [false, 'melee', false, 0], weapon);
  assert.deepEqual(kill('grenade'), [false, 'blast', false, 0], 'a grenade blast is heard at once');
  // A rocket: its delay is the flight the blast and the marker wait for.
  const flight = Math.min(.6, Math.hypot(0, 1.5, 30) / 170);
  const [headshot, kind, heavy, delay] = kill('rocket');
  assert.deepEqual([headshot, kind, heavy], [false, 'blast', false]);
  assert.ok(Math.abs(delay - flight) < 1e-12, `the rocket's flight: ${delay} vs ${flight}`);
  // Heavy: a boss, or a brute's body.
  assert.deepEqual(kill('magnum', { boss: true }), [false, 'shot', true, 0]);
  assert.deepEqual(kill('shotgun', { zombieId: 'hulk', headshot: true }), [true, 'shot', true, 0]);
  assert.deepEqual(kill('shotgun', { zombieId: 'crawl' }), [false, 'shot', false, 0], 'a crawler is not heavy');
  // A teammate's kill and a raider's fall make no kill call.
  const calls = client.soundCalls.kill;
  client.event({ event: 'kill', id: 'host', zombieId: 'mate', weapon: 'pistol', x: 0, y: 0, z: 0, headshot: false, score: 100, chain: 1 });
  client.event({ event: 'kill', id: 'guest', zombieId: 'r1', raider: true, weapon: 'pistol', x: 0, y: 0, z: 0, headshot: false, score: 100, chain: 1 });
  assert.equal(client.soundCalls.kill, calls);
});

test('F gets you up with your kit, T gives 100 coins; on the controller RB while down and D-pad up without a radar', () => {
  const { client, state, self } = arsenalClient('pistol');
  const sentTypes = () => client.sent.map(message => message.type);
  Object.assign(self, { downed: true, alive: true, hp: 0, reviveKit: true, bleedOutLeft: 20 }); client.update(state);
  assert.equal(client.node('revive-kit').hidden, false, 'the kit shows in the HUD');
  assert.match(client.node('downed').lastElementChild.textContent, /Appuie sur F pour te relever avec ton kit \(5 s\)\. Sinon, il servira tout seul dans 20 s\./);
  client.dispatch('keydown', { code: 'KeyF', repeat: false });
  assert.equal(sentTypes().filter(type => type === 'revive-kit').length, 1);
  self.reviveKit = false; client.update(state);
  client.dispatch('keydown', { code: 'KeyF', repeat: false });
  assert.equal(sentTypes().filter(type => type === 'revive-kit').length, 1, 'no kit, nothing sent');
  Object.assign(self, { downed: false, hp: 100, points: 150 }); client.update(state);
  client.dispatch('keydown', { code: 'KeyT', repeat: false });
  assert.equal(sentTypes().filter(type => type === 'drop-coins').length, 1);
  self.points = 40; client.update(state);
  client.dispatch('keydown', { code: 'KeyT', repeat: false });
  assert.equal(sentTypes().filter(type => type === 'drop-coins').length, 1);
  assert.equal(client.node('toast').textContent, 'Il faut au moins 100 pièces pour en donner.');
  const f = controllerClient();
  Object.assign(f.self, { downed: true, hp: 0, reviveKit: true }); f.client.update(f.state); f.step();
  f.button('interact'); f.button('interact', false);
  assert.ok(f.client.sent.some(message => message.type === 'revive-kit'), 'RB while down uses the kit');
  Object.assign(f.self, { downed: false, hp: 100, reviveKit: false, points: 200, bonus: null }); f.client.update(f.state); f.step();
  f.button('radar'); f.button('radar', false);
  assert.ok(f.client.sent.some(message => message.type === 'drop-coins'), 'D-pad up gives coins without a radar');
  // Next to a downed teammate, D-pad up uses the kit on them instead of giving coins.
  const host = f.state.players.find(player => player.id === 'host'), coins = () => f.client.sent.filter(message => message.type === 'drop-coins').length;
  Object.assign(f.self, { reviveKit: true, x: 0, y: 0, z: 0, reviveTargetId: 'host' }); Object.assign(host, { downed: true, alive: true, hp: 0, x: .8, y: 0, z: 0 });
  f.client.update(f.state); f.step();
  f.button('interact');
  assert.deepEqual(f.client.sent.filter(message => message.type === 'interact').at(-1), { type: 'interact', revive: true }, 'RB next to a downed teammate is a revive press');
  f.button('interact', false);
  assert.equal(f.client.node('revive-kit-key').textContent, '↑');
  assert.equal(f.client.node('interaction-text').textContent, 'Maintiens RB · relever Hôte · ↑ : kit, tout de suite');
  const before = coins(), kits = f.client.sent.filter(message => message.type === 'revive-kit').length;
  f.button('radar'); f.button('radar', false);
  assert.equal(f.client.sent.filter(message => message.type === 'revive-kit').length, kits + 1, 'D-pad up next to a downed teammate uses the kit');
  assert.equal(coins(), before, 'and gives no coins');
});

test('the revive shows who is helping and how long is left, on the downed survivor and on the helper', () => {
  const { client, state, self } = arsenalClient('pistol');
  const host = state.players.find(player => player.id === 'host');
  Object.assign(self, { downed: true, alive: true, hp: 0, revivedBy: 'host', reviveLeft: 2.2, bleedOutLeft: 18 }); client.update(state);
  assert.equal(client.node('downed').lastElementChild.textContent, 'Hôte te relève… 3 s');
  assert.equal(client.node('revive-progress').hidden, false);
  assert.equal(client.node('revive-progress-bar').style.width, '56%');
  Object.assign(self, { revivedBy: 'guest', reviveLeft: 1.1, reviveKit: true }); client.update(state);
  assert.equal(client.node('downed').lastElementChild.textContent, 'Tu te relèves… 2 s');
  client.language('en'); assert.equal(client.node('downed').lastElementChild.textContent, 'Getting up… 2 s'); client.language('fr');
  Object.assign(self, { downed: false, hp: 100, revivedBy: null, reviveLeft: 0, reviveKit: false, x: 0, y: 0, z: 0, reviveTargetId: 'host' });
  Object.assign(host, { downed: true, alive: true, hp: 0, x: .8, y: 0, z: 0 });
  client.update(state);
  assert.equal(client.node('interaction-text').textContent, 'Maintiens E · relever Hôte');
  self.reviveKit = true; client.update(state);
  assert.equal(client.node('interaction-text').textContent, 'Maintiens E · relever Hôte · F : kit, tout de suite');
  Object.assign(self, { revivingId: 'host', reviveLeft: 3.4 }); client.update(state);
  assert.equal(client.node('interaction-text').textContent, 'Relève de Hôte… 4 s');
  assert.equal(client.node('interaction-progress').hidden, false);
  client.dispatch('keydown', { code: 'KeyF', repeat: false });
  assert.ok(client.sent.some(message => message.type === 'revive-kit'), 'F near a downed teammate uses the kit on them');
});

test('kit, robbery and coin-gift messages, the kit pickup and the supply post kit status', () => {
  const { client, state, self } = arsenalClient('pistol');
  client.event({ event: 'revive', id: 'guest', targetId: 'guest', kit: true });
  assert.equal(client.node('toast').textContent, 'Kit de relève : te revoilà debout !');
  client.event({ event: 'revive', id: 'guest', targetId: 'guest', kit: true, automatic: true });
  assert.equal(client.node('toast').textContent, 'Ton kit de relève t’a remis debout juste à temps.');
  client.event({ event: 'revive', id: 'host', targetId: 'guest', kit: true });
  assert.match(client.node('toast').textContent, /^Hôte a relevé .+ avec son kit\.$/);
  client.event({ event: 'robbed', id: 'guest', coins: 150, weapon: 'smg' });
  assert.match(client.node('toast').textContent, /^Les pillards t’ont dépouillé : −150 pièces et ton arme \(.+\)\.$/);
  client.event({ event: 'robbed', id: 'host', coins: 10, weapon: null });
  assert.equal(client.node('toast').textContent, 'Les pillards ont dépouillé Hôte.');
  client.event({ event: 'coins-dropped', id: 'guest', amount: 100 });
  assert.equal(client.node('toast').textContent, '100 pièces déposées pour l’équipe.');
  client.event({ event: 'pickup', id: 'guest', kind: 'points', amount: 100, fromId: 'host' });
  assert.equal(client.node('toast').textContent, 'Hôte t’a donné 100 pièces.');
  client.event({ event: 'pickup', id: 'guest', kind: 'revive', amount: 1, reviveKit: true });
  assert.equal(client.node('pickup-notice').textContent, 'KIT DE RELÈVE RAMASSÉ');
  state.wave = 5; self.reviveKit = true; self.supplyAction = 'station'; client.update(state);
  client.event({ event: 'supply-menu', id: 'guest', menu: 'station', wave: 5 });
  const choice = id => client.node('supply-options').children.find(button => button.dataset.supplyChoice === id);
  assert.equal(choice('revive').disabled, true); assert.equal(choice('revive').children[2].textContent, 'DÉJÀ DANS TON SAC');
  self.reviveKit = false; self.points = 1300; client.update(state);
  assert.equal(choice('revive').disabled, false); assert.match(choice('revive').children[2].textContent, /1200 PIÈCES/);
  client.event({ event: 'supply-denied', id: 'guest', reason: 'carried' });
  assert.equal(client.node('toast').textContent, 'Tu as déjà un kit de relève.');
});

test('the host picks the difficulty in the lobby; the others see it without changing it', () => {
  const simulation = room(), host = clientHarness('host', { fakeNow: 0 }), guest = clientHarness('guest', { fakeNow: 0 });
  const state = simulation.snapshot();
  for (const client of [host, guest]) { client.node('lobby').hidden = false; client.update(state); }
  const buttons = client => client.node('difficulty-options').children;
  assert.deepEqual(buttons(host).map(button => button.textContent), ['TRÈS FACILE', 'FACILE', 'NORMAL', 'DIFFICILE', 'CAUCHEMAR']);
  assert.equal(buttons(host).find(button => button.dataset.level === 'normal').className, 'difficulty-option selected');
  assert.equal(buttons(host).every(button => !button.disabled), true);
  buttons(host).find(button => button.dataset.level === 'easy').onclick();
  assert.deepEqual(host.sent.at(-1), { type: 'difficulty', level: 'easy' });
  assert.equal(buttons(guest).every(button => button.disabled), true);
  assert.match(guest.node('difficulty-detail').textContent, /L’hôte choisit la difficulté\./);
  simulation.setDifficulty('host', 'nightmare');
  guest.update(simulation.snapshot());
  assert.equal(buttons(guest).find(button => button.dataset.level === 'nightmare').className, 'difficulty-option selected');
  assert.match(guest.node('difficulty-detail').textContent, /\+60 %/);
});

test('E next to a downed teammate is a revive press: renewed every 250 ms while held, even beside a ground bonus', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const guest = simulation.players.get('guest'), host = simulation.players.get('host');
  Object.assign(host, { x: -4.5, y: 0, z: .6, yaw: 0, bonus: { stone: 2 } });
  Object.assign(host, { downed: true, hp: 0, bleedOutAt: simulation.time + 25 });
  const [bonus] = simulation.dropBonus(host); assert.ok(bonus);
  Object.assign(guest, { x: bonus.x, y: 0, z: bonus.z + .3, yaw: 0 });
  const state = simulation.snapshot(); client.update(state); client.enter(); client.lock(); client.update(state);
  assert.ok(state.players.find(player => player.id === 'guest').nearbyBonusId, 'a bonus lies at the reviver’s feet');
  client.dispatch('keydown', { code: 'KeyE', repeat: false });
  for (const at of [300, 600, 900]) { client.time(at); client.frame(at); }
  const presses = client.sent.filter(message => message.type === 'interact');
  assert.equal(presses.length, 4);
  assert.ok(presses.every(message => message.revive === true), 'never a plain interact while the revive is held');
  client.dispatch('keyup', { code: 'KeyE' });
  Object.assign(host, { downed: false, hp: 55 }); client.update(simulation.snapshot());
  client.dispatch('keydown', { code: 'KeyE', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'interact' }, 'a fresh press with nobody down is an ordinary one');
});

test('robbery messages only claim what was taken; the rain rate follows the difficulty in both languages', () => {
  const { client } = arsenalClient('pistol');
  client.event({ event: 'robbed', id: 'guest', coins: 0, weapon: null });
  assert.equal(client.node('toast').textContent, 'Les pillards n’ont rien trouvé à te prendre.');
  client.event({ event: 'robbed', id: 'guest', coins: 0, weapon: null, magnum: true });
  assert.equal(client.node('toast').textContent, 'Ton Magnum doré est tombé au sol : va vite le reprendre.');
  client.event({ event: 'robbed', id: 'guest', coins: 40, weapon: null, magnum: true });
  assert.equal(client.node('toast').textContent, 'Les pillards t’ont pris 40 pièces ; ton Magnum doré est tombé au sol.');
  client.event({ event: 'robbed', id: 'guest', coins: 0, weapon: 'smg' });
  assert.match(client.node('toast').textContent, /^Les pillards t’ont pris ton arme \(.+\)\.$/);
  const before = client.node('toast').textContent;
  client.event({ event: 'robbed', id: 'host', coins: 0, weapon: null });
  assert.equal(client.node('toast').textContent, before, 'nothing taken from a teammate: no message');
  const rainy = clientHarness(), state = outdoorState(room()); state.outsideDamagePerSecond = 4.8;
  rainy.update(state); rainy.enter();
  assert.equal(rainy.node('outside-title').textContent, 'PLUIE CORROSIVE · −4,8 VIE/S');
  rainy.language('en'); assert.equal(rainy.node('outside-title').textContent, 'CORROSIVE RAIN · −4.8 HP/S');
});

test('RB held through your own kit revive does nothing once you stand, until it is released', () => {
  const f = controllerClient();
  Object.assign(f.self, { downed: true, hp: 0, reviveKit: true }); f.client.update(f.state); f.step();
  f.button('interact');
  assert.ok(f.client.sent.some(message => message.type === 'revive-kit'));
  Object.assign(f.self, { downed: false, hp: 75, reviveKit: false }); f.client.update(f.state);
  for (let frame = 0; frame < 60; frame++) f.step(); // about a second, RB still held
  assert.equal(f.client.sent.filter(message => message.type === 'interact').length, 0);
  f.button('interact', false); f.button('interact');
  assert.equal(f.client.sent.filter(message => message.type === 'interact').length, 1, 'a fresh press acts');
});

test('a teammate downed behind a wall is not offered: E stays an ordinary press and F sends nothing', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  simulation.wave = 2;
  const guest = simulation.players.get('guest'), host = simulation.players.get('host');
  Object.assign(guest, { x: 6.95, y: 0, z: -5.15, yaw: 0, points: 1000, reviveKit: true }); // inside, at the shotgun rack
  Object.assign(host, { x: 8.9, y: 0, z: -5.15, downed: true, hp: 0, bleedOutAt: simulation.time + 25 }); // outside the east wall
  const state = simulation.snapshot(); client.update(state); client.enter(); client.lock(); client.update(state);
  assert.equal(state.players.find(player => player.id === 'guest').reviveTargetId, null);
  assert.doesNotMatch(client.node('interaction-text').textContent, /relever/);
  client.dispatch('keydown', { code: 'KeyE', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'interact' });
  client.dispatch('keyup', { code: 'KeyE' });
  client.dispatch('keydown', { code: 'KeyF', repeat: false });
  assert.equal(client.sent.some(message => message.type === 'revive-kit'), false);
});

test('with a radar and a kit, D-pad up next to a downed teammate uses the kit, not the radar', () => {
  const f = controllerClient(), host = f.state.players.find(player => player.id === 'host');
  Object.assign(f.self, { reviveKit: true, bonus: 'radar', canDeployRadar: true, x: 0, y: 0, z: 0, reviveTargetId: 'host' });
  Object.assign(host, { downed: true, alive: true, hp: 0, x: .8, y: 0, z: 0 });
  f.client.update(f.state); f.step();
  f.button('radar'); f.button('radar', false);
  assert.ok(f.client.sent.some(message => message.type === 'revive-kit'));
  assert.equal(f.client.sent.some(message => message.type === 'radar-deploy'), false);
});

// AI companions (companions/DESIGN.md, "Lobby and HUD"): a LAN room with a
// connected brain, the host, a guest and the companion Max.
function companionRoom({ humans = [] } = {}) {
  const simulation = room();
  for (const [id, name] of humans) simulation.addPlayer(id, name);
  simulation.addPlayer('max', 'Max', undefined, { companion: true });
  simulation.companionsAvailable = true;
  return simulation;
}

test('the AI companions picker stays hidden until a companion brain is connected, and on the range', () => {
  const simulation = room(), client = clientHarness('host', { fakeNow: 0 });
  client.node('lobby').hidden = false; client.update(simulation.snapshot());
  assert.equal(client.node('companions-picker').hidden, true);
  simulation.phase = 'gameover'; client.update(simulation.snapshot());
  assert.equal(client.node('companions-picker-results').hidden, true);
  simulation.companionsAvailable = true; client.update(simulation.snapshot());
  assert.equal(client.node('companions-picker-results').hidden, false);
  simulation.phase = 'lobby'; client.update(simulation.snapshot());
  assert.equal(client.node('companions-picker').hidden, false);
  client.update({ ...simulation.snapshot(), practice: true });
  assert.equal(client.node('companions-picker').hidden, true, 'never on the shooting range');
});

test('the host picks 0 to 3 AI companions in free seats; a guest sees the count without changing it', () => {
  const simulation = companionRoom(), host = clientHarness('host', { fakeNow: 0 }), guest = clientHarness('guest', { fakeNow: 0 });
  for (const client of [host, guest]) { client.node('lobby').hidden = false; client.update(simulation.snapshot()); }
  const buttons = (client, suffix = '') => client.node(`companions-options${suffix}`).children;
  assert.deepEqual(buttons(host).map(button => button.textContent), ['0', '1', '2', '3']);
  assert.deepEqual(buttons(host).map(button => button.className), ['companions-option', 'companions-option selected', 'companions-option', 'companions-option full'], 'one companion: Max');
  assert.deepEqual(buttons(host).map(button => button.disabled), [false, false, false, true], 'two humans and three companions would be five');
  assert.equal(buttons(host)[3].title, 'Plus de place : quatre survivants au plus.');
  buttons(host)[2].click();
  assert.deepEqual(host.sent.at(-1), { type: 'companions', count: 2, profiles: ['random', 'random', 'random'] });
  const sent = host.sent.length;
  buttons(host)[3].click(); buttons(host)[3].onclick(); buttons(host)[1].onclick();
  assert.equal(host.sent.length, sent, 'neither a full seat nor the current count is sent');
  assert.equal(host.node('companions-detail').textContent, 'Des coéquipiers IA rejoignent l’équipe. Ils réfléchissent avec un modèle d’IA en ligne (OpenAI), via l’ordinateur de l’hôte. Quatre survivants au plus.');
  assert.equal(buttons(guest).every(button => button.disabled), true);
  assert.equal(buttons(guest)[1].className, 'companions-option selected');
  assert.match(guest.node('companions-detail').textContent, /L’hôte choisit les compagnons\.$/);
  buttons(guest)[0].onclick();
  assert.equal(guest.sent.some(message => message.type === 'companions'), false);
  host.language('en');
  assert.equal(host.node('companions-detail').textContent, 'AI teammates join the team. They think with an online AI model (OpenAI), through the host’s computer. Four survivors at most.');
  host.language('fr');
  simulation.addPlayer('jules', 'Jules'); host.update(simulation.snapshot());
  assert.deepEqual(buttons(host).map(button => button.disabled), [false, false, true, true], 'three humans leave one seat');
  assert.deepEqual(buttons(host).map(button => button.className), ['companions-option', 'companions-option selected', 'companions-option full', 'companions-option full']);
  simulation.removePlayer('max'); host.update(simulation.snapshot());
  assert.equal(buttons(host)[0].className, 'companions-option selected', 'the count shown is the number of companions');
  const playing = { ...simulation.snapshot(), phase: 'countdown' }; host.update(playing);
  assert.equal(buttons(host).every(button => button.disabled), true, 'locked once the night has begun');
  simulation.phase = 'gameover'; host.update(simulation.snapshot());
  assert.deepEqual(buttons(host, '-results').map(button => button.disabled), [false, false, true, true], 'editable again in the results');
  buttons(host, '-results')[1].click();
  assert.deepEqual(host.sent.at(-1), { type: 'companions', count: 1, profiles: ['random', 'random', 'random'] });
});

test('AI companions wear an IA badge in the HUD, lobby and results lists, never a CONNECTÉ status', () => {
  const simulation = companionRoom(), client = clientHarness('guest', { fakeNow: 0 });
  client.node('lobby').hidden = false; client.update(simulation.snapshot());
  const rowOf = (list, name) => client.node(list).children.find(row => row.children[1].textContent === name);
  const max = rowOf('lobby-players', 'Max');
  assert.equal(max.children[1].children[0].className, 'ai-badge');
  assert.equal(max.children[1].children[0].textContent, 'IA');
  assert.equal(max.children[1].children[0].title, 'Coéquipier IA');
  assert.equal(max.children[2].textContent, '', 'no CONNECTÉ for a companion');
  assert.equal(rowOf('lobby-players', 'Hôte').children[2].textContent, 'HÔTE');
  assert.equal((rowOf('lobby-players', 'Hôte').children[1].children ?? []).some(child => child.className === 'ai-badge'), false, 'humans have no badge');
  const hud = rowOf('team-list', 'Max');
  assert.equal(hud.children[1].children[0].textContent, 'IA');
  assert.equal(hud.children.length, 4, 'the badge sits inside the name: the HUD grid keeps its columns');
  simulation.phase = 'gameover'; simulation.players.get('max').kills = 7; client.update(simulation.snapshot());
  assert.equal(rowOf('results-list', 'Max').children[1].children[0].textContent, 'IA');
  assert.match(rowOf('results-list', 'Max').children[2].textContent, /^7 élim\. · ★ \d+$/);
  client.language('en');
  assert.equal(rowOf('results-list', 'Max').children[1].children[0].textContent, 'AI');
  assert.equal(rowOf('team-list', 'Max').children[1].children[0].title, 'AI teammate');
});

test('team coin counters show each human and bot balance, track real spending and translate without changing HP or badges', () => {
  const simulation = companionRoom(), client = clientHarness('guest', { fakeNow: 0 });
  simulation.start('host');
  const human = simulation.players.get('host'), bot = simulation.players.get('max');
  Object.assign(human, { points: 3184, hp: 67 });
  Object.assign(bot, { points: 1419, hp: 42, companionProfile: { selection: 'veteran', archetype: 'veteran' } });
  const row = id => client.node('team-list').children.find(item => item.dataset.playerId === id);
  const coins = id => row(id).children[1].children.find(item => item.className === 'team-coins');
  const badge = id => (row(id).children[1].children ?? []).find(item => item.className === 'ai-badge');
  const balance = (value, locale, label) => `${value.toLocaleString(locale)} ${label}`;
  const unchangedHealth = () => {
    assert.equal(row('host').children[2].textContent, 67);
    assert.equal(row('host').children[3].children[0].style.width, '67%');
    assert.equal(row('max').children[2].textContent, 42);
    assert.equal(row('max').children[3].children[0].style.width, '42%');
    assert.equal(row('host').children.length, 4, 'coins remain inside the name cell');
    assert.equal(row('max').children.length, 4, 'profile and coins do not add HUD columns');
    assert.equal(badge('host'), undefined, 'a human balance does not create an AI badge');
  };
  client.update(simulation.snapshot());
  assert.equal(coins('host').textContent, balance(3184, 'fr-FR', 'pièces'));
  assert.equal(coins('max').textContent, balance(1419, 'fr-FR', 'pièces'));
  assert.equal(coins('guest').textContent, '0 pièces', 'each row uses its own balance');
  assert.equal(coins('max').hidden, false);
  assert.equal(badge('max').textContent, 'IA · Vétéran');
  unchangedHealth();

  const rack = ARMORY.find(item => item.weapon === 'smg');
  simulation.wave = rack.unlockWave;
  Object.assign(bot, { x: rack.x + Math.sin(rack.facing) * 1.1, y: rack.y, z: rack.z + Math.cos(rack.facing) * 1.1 });
  assert.equal(simulation.buyWeapon('max', rack.id), true, 'an authoritative purchase spends the bot balance');
  client.update(simulation.snapshot());
  assert.equal(coins('max').textContent, balance(1419 - rack.price, 'fr-FR', 'pièces'));
  assert.equal(coins('host').textContent, balance(3184, 'fr-FR', 'pièces'), 'a bot purchase does not spend a human balance');
  assert.equal(badge('max').textContent, 'IA · Vétéran');
  unchangedHealth();

  client.language('en');
  assert.equal(coins('host').textContent, balance(3184, 'en-US', 'coins'));
  assert.equal(coins('max').textContent, balance(1419 - rack.price, 'en-US', 'coins'));
  assert.equal(coins('guest').textContent, '0 coins');
  assert.equal(badge('max').textContent, 'AI · Veteran');
  unchangedHealth();
  client.language('fr');
  assert.equal(coins('host').textContent, balance(3184, 'fr-FR', 'pièces'));
  assert.equal(badge('max').textContent, 'IA · Vétéran');
});

test('team coin counters stay hidden for waiting players without changing their admission state', () => {
  const simulation = companionRoom(), client = clientHarness('host', { fakeNow: 0 });
  simulation.start('host');
  simulation.phase = 'wave'; simulation.wave = 1;
  const waiting = simulation.addPlayer('newcomer', 'En attente', undefined, { defer: true });
  assert.equal(waiting.waiting, true, 'a survivor joining an active night is waiting');
  waiting.points = 1234;
  const row = () => client.node('team-list').children.find(item => item.dataset.playerId === 'newcomer');
  const coins = () => row().children[1].children.find(item => item.className === 'team-coins');
  client.update(simulation.snapshot());
  assert.equal(coins().hidden, true);
  assert.equal(row().children[2].textContent, 'EN ATTENTE');
  assert.equal(row().className.includes('downed'), false);
  assert.equal(row().children.length, 4);
  client.language('en');
  assert.equal(coins().hidden, true);
  assert.equal(row().children[2].textContent, 'WAITING');
  assert.equal(simulation.readyPlayer('newcomer'), true);
  simulation.phase = 'intermission'; simulation.admitReadyPlayers();
  assert.equal(waiting.waiting, false);
  client.update(simulation.snapshot());
  assert.equal(coins().hidden, false, 'admission restores the ordinary balance display');
  assert.equal(coins().textContent, `${(1234).toLocaleString('en-US')} coins`);
  assert.equal(row().children[2].textContent, 100);
});

test('companion callouts are fixed lines in the teammates’ feed, in French and English', () => {
  const simulation = companionRoom({ humans: [['jules', 'Jules']] }), client = clientHarness('guest', { fakeNow: 0 });
  simulation.start('host');
  const state = simulation.snapshot(); client.update(state); client.enter(); client.lock(); client.update(state);
  const feed = client.node('team-chain-feed'), toastBefore = client.node('toast').textContent;
  const say = (order, target) => { const count = feed.children?.length ?? 0; client.event({ event: 'companion-callout', id: 'max', order, ...(target === undefined ? {} : { target }) }); return feed.children?.length > count ? feed.children.at(-1).textContent : null; };
  const lines = [['revive', 'jules'], ['kit', 'jules'], ['defend', 'west'], ['repair', 'north'], ['buy', 'shotgun'], ['follow', 'jules'], ['loft'], ['revive', 'guest'], ['kit', 'guest'], ['follow', 'guest'], ['buy', 'bat']];
  assert.deepEqual(lines.map(([order, target]) => say(order, target)), [
    'Max : je relève Jules !', 'Max : kit de relève pour Jules !', 'Max : je tiens la porte ouest !', 'Max : je répare la porte nord.',
    'Max : j’achète le fusil à pompe.', 'Max : je reste avec Jules.', 'Max : je monte sur la mezzanine !',
    'Max : je te relève !', 'Max : kit de relève pour toi !', 'Max : je reste avec toi.', 'Max : j’achète la batte en bois.',
  ]);
  assert.equal(feed.children.at(-1).className, 'team-chain companion-callout');
  assert.equal(feed.children.at(-1).dataset.badge, 'IA');
  assert.equal(client.node('toast').textContent, toastBefore, 'callouts never cover the toasts');
  client.language('en');
  assert.deepEqual(lines.map(([order, target]) => say(order, target)), [
    'Max: reviving Jules!', 'Max: revive kit for Jules!', 'Max: holding the west door!', 'Max: repairing the north door.',
    'Max: buying the shotgun.', 'Max: sticking with Jules.', 'Max: heading up to the loft!',
    'Max: reviving you!', 'Max: revive kit for you!', 'Max: sticking with you.', 'Max: buying the wooden bat.',
  ]);
  assert.equal(feed.children.at(-1).dataset.badge, 'AI');
  assert.equal(say('revive', 'gone'), 'Max: reviving a teammate!', 'a teammate who left is still a teammate');
  for (const [order, target] of [['hold'], ['shoot', 'z1'], ['defend', 'cellar'], ['buy', 'laser'], ['wait']]) assert.equal(say(order, target), null, `${order} says nothing`);
  const count = feed.children.length;
  client.event({ event: 'companion-callout', id: 'nobody', order: 'loft' });
  assert.equal(feed.children.length, count, 'an unknown companion says nothing');
});

test('companion lines leave the feed after a few seconds, three at most', () => {
  const simulation = companionRoom(), client = clientHarness('guest', { fakeNow: 0 });
  simulation.start('host');
  const state = simulation.snapshot(); client.update(state); client.enter(); client.lock(); client.update(state);
  const feed = client.node('team-chain-feed'), removed = [];
  const say = order => { client.event({ event: 'companion-callout', id: 'max', order, target: 'south' }); const line = feed.children.at(-1); line.remove = () => removed.push(line.textContent); };
  say('defend'); say('repair'); say('defend'); say('repair');
  assert.deepEqual(removed, ['Max : je tiens la porte sud !'], 'the oldest line makes room');
  client.time(3900); client.frame(3900);
  assert.equal(removed.length, 1);
  client.time(4100); client.frame(4100);
  assert.equal(removed.length, 4, 'gone after four seconds');
});

test('the brain leaving and the budget running out each show a toast, in both languages', () => {
  const { client } = arsenalClient('pistol');
  client.event({ event: 'companions-offline' });
  assert.equal(client.node('toast').textContent, 'Les compagnons IA sont partis : leur cerveau ne répond plus.');
  assert.equal(client.node('toast').hidden, false);
  client.language('en'); assert.equal(client.node('toast').textContent, 'The AI companions left: their brain stopped answering.');
  client.event({ event: 'companions-budget' });
  assert.equal(client.node('toast').textContent, 'The AI companions reached their budget.');
  client.language('fr'); assert.equal(client.node('toast').textContent, 'Les compagnons IA ont atteint leur budget.');
});

test('companions never count among the next-wave voters on the plaque', () => {
  const simulation = companionRoom(); simulation.start('host'); simulation.phase = 'wave'; simulation.wave = 1; simulation.toSpawn = 0; simulation.zombies.clear();
  simulation.finishWave();
  const client = clientHarness('guest', { fakeNow: 0 });
  client.update(simulation.snapshot()); client.enter(); client.lock(); client.update(simulation.snapshot()); client.frame(16);
  assert.equal(client.node('next-wave').hidden, false);
  assert.equal(client.node('next-wave-count').textContent, '0/2', 'the host and the guest, not Max');
  simulation.voteNextWave('host'); simulation.voteNextWave('guest'); client.update(simulation.snapshot());
  assert.equal(client.node('next-wave-text').textContent, 'LA VAGUE ARRIVE');
});

test('the picker tells the family the companions think with an online OpenAI model, not on the host’s computer', () => {
  const simulation = companionRoom(), client = clientHarness('host', { fakeNow: 0 });
  client.node('lobby').hidden = false; client.update(simulation.snapshot());
  for (const [language, online, local] of [['fr', /modèle d’IA en ligne \(OpenAI\)/, /modèle d’IA sur l’ordinateur/], ['en', /online AI model \(OpenAI\)/, /model on the host’s computer/]]) {
    client.language(language);
    assert.match(client.node('companions-detail').textContent, online);
    assert.doesNotMatch(client.node('companions-detail').textContent, local);
  }
});

test('when the brain leaves or its budget runs out, the lobby and the results say so until a brain connects again', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), at = text => html.indexOf(text);
  assert.ok(at('<section id="lobby"') < at('id="companions-notice"') && at('id="companions-notice"') < at('<div id="hud"'), 'in the lobby, not in the HUD');
  assert.ok(at('<section id="gameover"') < at('id="companions-notice-results"'), 'in the results dialog');
  const simulation = companionRoom(), client = clientHarness('host', { fakeNow: 0 });
  client.node('lobby').hidden = false; client.update(simulation.snapshot());
  const notice = client.node('companions-notice'), results = client.node('companions-notice-results');
  assert.equal(notice.hidden, true);
  // The brain leaves while the host waits in the lobby: Max goes, the picker goes.
  simulation.removePlayer('max'); simulation.companionsAvailable = false;
  client.event({ event: 'companions-offline', reason: 'offline' }); client.update(simulation.snapshot());
  assert.equal(client.node('hud').hidden, true, 'the toast sits in the hidden HUD');
  assert.equal(client.node('companions-picker').hidden, true);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'Les compagnons IA sont partis : leur cerveau ne répond plus.');
  client.time(6000); client.frame(6000); client.update(simulation.snapshot());
  assert.equal(client.node('toast').hidden, true);
  assert.equal(notice.hidden, false, 'the line outlives the toast');
  client.language('en'); assert.equal(notice.textContent, 'The AI companions left: their brain stopped answering.');
  client.language('fr');
  simulation.phase = 'gameover'; client.update(simulation.snapshot());
  assert.equal(results.hidden, false);
  assert.equal(results.textContent, 'Les compagnons IA sont partis : leur cerveau ne répond plus.');
  simulation.companionsAvailable = true; client.update(simulation.snapshot());
  assert.equal(results.hidden, true, 'a brain is back');
  assert.equal(client.node('companions-picker-results').hidden, false);
  // The budget: the same brain stays connected, and so does the line.
  client.event({ event: 'companions-budget' });
  assert.equal(results.hidden, false);
  assert.equal(results.textContent, 'Les compagnons IA ont atteint leur budget.');
  client.update(simulation.snapshot()); simulation.phase = 'lobby'; client.update(simulation.snapshot());
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'Les compagnons IA ont atteint leur budget.');
  simulation.companionsAvailable = false; client.update(simulation.snapshot());
  simulation.companionsAvailable = true; client.update(simulation.snapshot());
  assert.equal(notice.hidden, true, 'a new brain starts with a fresh budget');
  client.update({ ...simulation.snapshot(), practice: true });
  client.event({ event: 'companions-offline' });
  assert.equal(notice.hidden, true, 'never on the shooting range');
});

test('a companion count or a difficulty picked with the keyboard or the controller keeps the focus once the server confirms it', () => {
  const simulation = companionRoom(), host = clientHarness('host', { fakeNow: 0 });
  host.node('lobby').hidden = false; host.update(simulation.snapshot());
  const counts = host.node('companions-options'), two = counts.children[2];
  two.focus(); two.click();
  assert.deepEqual(host.sent.at(-1), { type: 'companions', count: 2, profiles: ['random', 'random', 'random'] });
  simulation.addPlayer('lea', 'Léa', undefined, { companion: true }); host.update(simulation.snapshot());
  assert.equal(counts.children[2].className, 'companions-option selected');
  assert.equal(host.activeElement(), counts.children[2], 'the focused button is still the one in the picker');
  const levels = host.node('difficulty-options'), level = name => levels.children.find(button => button.dataset.level === name), hard = level('hard');
  hard.focus(); hard.click();
  assert.deepEqual(host.sent.at(-1), { type: 'difficulty', level: 'hard' });
  host.update({ ...simulation.snapshot(), difficulty: 'hard' });
  assert.equal(level('hard').className, 'difficulty-option selected');
  assert.equal(host.activeElement(), level('hard'));
  host.language('en'); host.update({ ...simulation.snapshot(), difficulty: 'hard' });
  assert.equal(host.activeElement(), level('hard'), 'a language change keeps the buttons too');
  assert.equal(level('hard').textContent, 'HARD');
  assert.deepEqual(counts.children.map(button => button.textContent), ['0', '1', '2', '3']);
});

test('the results dialog scrolls on short screens, like the lobby, now that it holds the companions picker', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = selector => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) => selectors.split(',').some(item => item.trim() === selector)).map(([, , body]) => body).join(';');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<section id="gameover" class="overlay-screen" hidden><div class="dialog">/);
  for (const selector of ['.lobby-dialog', '#gameover>.dialog']) {
    assert.match(rule(selector), /max-height:calc\(100dvh - 48px\)/, selector);
    assert.match(rule(selector), /overflow-y:auto/, selector);
  }
});

test('companion profile selects survive the real global weapon HUD refresh in lobby and results', () => {
  const simulation = companionRoom(), host = clientHarness('host', { fakeNow: 0 }), state = simulation.snapshot();
  state.companionSelections = ['protector', 'timid', 'veteran'];
  Object.assign(state.players.find(player => player.id === 'max'), { companionSlot: 0, companionProfile: { selection: 'protector', archetype: 'protector' } });
  host.update(state);
  const row = host.node('companions-profiles').children[0], select = row.children[1];
  assert.deepEqual(row.children.map(element => element.tagName), ['LABEL', 'SELECT', 'SMALL']);
  assert.equal(Object.hasOwn(row.dataset, 'slot'), false);
  assert.equal(row.dataset.companionSlot, '0');
  select.focus(); select.value = 'veteran'; select.onchange();
  assert.deepEqual(host.sent.at(-1), { type: 'companions', count: 1, profiles: ['veteran', 'timid', 'veteran'] });
  for (let tick = 0; tick < 10; tick++) host.update({ ...state, companionSelections: ['veteran', 'timid', 'veteran'], time: tick / 10 });
  assert.equal(host.node('companions-profiles').children[0], row);
  assert.equal(row.children[1], select); assert.equal(host.activeElement(), select);
  assert.equal(select.value, 'veteran');
  assert.doesNotMatch(row.className, /active|has-silhouette/);
  host.update({ ...state, phase: 'gameover' });
  assert.deepEqual(host.node('companions-profiles-results').children[0].children.map(element => element.tagName), ['LABEL', 'SELECT', 'SMALL']);
});

test('melee audio predicts its own blow: local aim, a teammate’s snapshot pose, planks and seals, and bodies at contact',()=>{
  const {client,state,self}=arsenalClient('bat');state.time=10;
  const host=state.players.find(player=>player.id==='host'),south=state.doors.find(door=>door.id==='south');
  Object.assign(host,{x:0,y:0,z:5.2,yaw:Math.PI,pitch:-.2,weapon:'bat',alive:true,downed:false});
  Object.assign(south,{sealed:false,boards:[60,60,60,60,60]});
  state.zombies=[{id:'front',kind:'walker',hp:100,maxHp:100,x:self.x,y:0,z:self.z-1,yaw:0},{id:'outside',kind:'walker',hp:100,maxHp:100,x:0,y:0,z:6.8,yaw:0}];
  client.update(state);client.time(16);client.frame(16);
  const swing=(id,attackId,time=state.time)=>{client.event({event:'melee-start',id,weapon:'bat',attack:'heavy',attackId,time,windup:.35,duration:1});return client.soundCalls.melee.at(-1).timing;};
  client.dispatch('mousedown',{button:0,preventDefault(){}});const mine=swing(self.id,1).predict,aim=client.aim().yaw;
  assert.equal(client.soundCalls.melee.at(-1).timing.attackId,1,'the swing’s id, for the server’s verdict');
  assert.equal(mine(),true,'the body right ahead');
  self.yaw=aim+Math.PI;client.update(state);assert.equal(client.aim().yaw,aim);
  assert.equal(mine(),true,'the local aim, not the confirmed snapshot yaw');
  const theirs=swing('host',1).predict;assert.equal(theirs(),false,'a teammate behind intact planks');
  south.boards=[0,0,0,0,0];client.update(state);assert.equal(theirs(),true,'the same teammate through the open doorway');
  south.sealed=true;client.update(state);assert.equal(theirs(),false,'a sealed doorway');
  south.sealed=false;host.yaw=0;client.update(state);assert.equal(theirs(),false,'the teammate’s latest pose');
  state.zombies=state.zombies.filter(zombie=>zombie.id!=='front');client.update(state);assert.equal(mine(),false,'a body gone from the snapshot');
  // A runner (2.45 m/s) coming at the survivor: 2.9 m ahead at the latest
  // snapshot, about 2 m at the server's contact 0.35 s later, inside the bat's
  // reach. Its mesh still lags further behind. Predicted a hit, not a miss.
  const runner={id:'runner',kind:'runner',hp:100,maxHp:100,x:self.x-Math.sin(aim)*3.06,y:0,z:self.z-Math.cos(aim)*3.06,yaw:0};
  state.zombies=[runner];client.update(state);
  state.time=10+1/15;Object.assign(runner,{x:self.x-Math.sin(aim)*2.9,z:self.z-Math.cos(aim)*2.9});client.update(state);
  client.time(17);client.frame(17);
  const approach=swing(self.id,2).predict;assert.equal(approach(),true,'a body walking into reach');
  const mesh=client.zombieCalls.find(call=>call.id==='runner').mesh;mesh.position.set(runner.x-Math.sin(aim)*2,0,runner.z-Math.cos(aim)*2);
  assert.equal(approach(),true,'the snapshot, not the lagging mesh');
  // The same body standing still at 2.9 m, or walking away: empty air.
  state.time+=1/15;client.update(state);assert.equal(swing(self.id,3).predict(),false,'standing out of reach');
  state.time+=1/15;Object.assign(runner,{x:self.x-Math.sin(aim)*3.06,z:self.z-Math.cos(aim)*3.06});client.update(state);
  assert.equal(swing(self.id,4).predict(),false,'walking away');
  // A body killed since the snapshot can no longer be struck.
  Object.assign(runner,{x:self.x-Math.sin(aim)*1.2,z:self.z-Math.cos(aim)*1.2});state.time+=1/15;client.update(state);
  const close=swing(self.id,5).predict;assert.equal(close(),true);
  client.event({event:'kill',id:'host',zombieId:'runner',weapon:'pistol'});assert.equal(close(),false,'killed by a teammate');
  // The server's verdict reaches the swing’s voice, for every survivor in earshot.
  client.event({event:'melee-hit',id:'host',weapon:'bat',attack:'heavy',attackId:1,hits:0,kills:0,impacts:[]});
  client.event({event:'melee-hit',id:self.id,weapon:'bat',attack:'heavy',attackId:5,hits:1,kills:0,impacts:[]});
  assert.deepEqual(client.soundCalls.meleeConfirms,[{id:'host',attackId:1,hits:0},{id:self.id,attackId:5,hits:1}]);
});

test('reinforced-melee card shows damage and extra targets, including the next target threshold',()=>{
  const {client,state,self}=arsenalClient('katana');self.bonus={stone:4};client.update(state);
  let card=client.node('bonus-tray').children[0];
  assert.match(card.children[2].textContent,/\+40 %.*\+1 cible/);
  assert.match(card.children[3].textContent,/\+50 %.*5/);
  assert.match(card.children[4].textContent,/\+2 cibles.*8/);
  self.bonus.stone=8;client.update(state);card=client.node('bonus-tray').children[0];
  assert.match(card.children[2].textContent,/\+80 %.*\+2 cibles/);
  assert.match(card.children[3].textContent,/Maximum/);
  assert.equal(card.children.length,4);
});


test('the crate presents all fourteen bonuses with native icons, actual next levels and capped choices in both languages', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 });
  simulation.start('host'); simulation.phase = 'wave'; simulation.wave = 2; simulation.beginSupplyWave();
  const player = simulation.players.get('guest');
  player.bonus = Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, 1]));
  client.update(simulation.snapshot()); client.enter(); client.lock();
  client.event({ event: 'supply-menu', id: 'guest', menu: 'crate', crateId: simulation.supplyCrate.id, wave: 2 });
  const choices = () => client.node('supply-options').children;
  assert.equal(choices().length, 14); assert.equal(client.node('bonus-tray').children.length, 14);
  for (const choice of choices()) {
    assert.ok(choice.children[0].innerHTML.length > 0, choice.dataset.supplyChoice);
    assert.ok(choice.children[1].textContent.length > 2);
    assert.doesNotMatch(choice.children[2].textContent, /^bonus\./);
  }
  assert.match(client.node('supply-expiry').textContent, /Prochain choix/);
  assert.match(choices().find(choice => choice.dataset.supplyChoice === 'grenadier').children[2].textContent, /grenade/);
  player.bonus.vitamins = 8; client.update(simulation.snapshot());
  assert.equal(choices().find(choice => choice.dataset.supplyChoice === 'vitamins').disabled, true);
  client.language('en');
  assert.match(choices().find(choice => choice.dataset.supplyChoice === 'reload').children[2].textContent, /reload time/);
  assert.match(client.node('supply-expiry').textContent, /Next choice/);
  choices().find(choice => choice.dataset.supplyChoice === 'medic').click();
  assert.deepEqual(client.sent.findLast(message => message.type === 'supply-claim'), { type: 'supply-claim', bonus: 'medic', crateId: simulation.supplyCrate.id });
});

test('level-eight quick hands toggles a real inventory pair, fires both mouse buttons and restores the sniper scope on return to one weapon', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const player = simulation.players.get('guest');
  Object.assign(player, { weapon: 'sniper', weaponId: 'sniper', bonus: { switching: 8, reload: 4 },
    inventory: { sniper: { ammo: 5, reserve: 15 }, smg: { ammo: 7, reserve: 13 } } });
  client.update(simulation.snapshot()); client.enter(); client.lock();
  assert.equal(client.node('dual-controls').hidden, false);
  client.dispatch('keydown', { code: 'KeyX', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'dual-wield', enabled: true, secondaryWeaponId: 'smg' });
  assert.equal(simulation.setDualWield('guest', true, 'smg'), true); simulation.time = .03;
  client.update(simulation.snapshot());
  assert.equal(client.node('secondary-ammo-panel').hidden, false);
  assert.equal(client.node('secondary-ammo').textContent, `7/${WEAPONS.smg.magazine} +13`);
  client.dispatch('mousedown', { button: 0 }); client.dispatch('mousedown', { button: 2, preventDefault() {} });
  client.time(100); client.frame(100);
  const shots = client.sent.filter(message => message.type === 'shoot');
  assert.ok(shots.some(message => message.hand === 'secondary'));
  assert.ok(shots.some(message => !message.hand));
  assert.equal(client.aim().scoped, false, 'right click fires the second gun rather than entering ADS');
  assert.equal(simulation.shoot('guest'), true); assert.equal(simulation.shoot('guest', 0, undefined, 'secondary'), true);
  client.dispatch('mouseup', { button: 0 }); client.dispatch('mouseup', { button: 2 });
  client.dispatch('keydown', { code: 'KeyR', repeat: false });
  assert.deepEqual(client.sent.at(-1), { type: 'reload' });
  assert.equal(simulation.reload('guest'), true); client.update(simulation.snapshot());
  const hands = simulation.snapshot().players.find(actor => actor.id === 'guest').hands;
  for (const hand of ['primary', 'secondary']) client.event({ event: 'reload', id: 'guest', hand, weapon: hands[hand].weapon, duration: hands[hand].reloadDuration });
  assert.deepEqual(client.soundCalls.reloadVoices.slice(-2).map(voice => [voice.type, voice.voiceId]), [['sniper', 'guest'], ['smg', 'guest:secondary']]);
  assert.match(client.node('secondary-reload').textContent, /RECHARGE/);
  const secondaryDuration = simulation.snapshot().players.find(actor => actor.id === 'guest').hands.secondary.reloadLeft;
  for (let elapsed = 0; elapsed < secondaryDuration + .01; elapsed += .01) simulation.tick(.01); client.update(simulation.snapshot());
  assert.match(client.node('reload-status').textContent, /RECHARGEMENT/);
  assert.equal(client.node('secondary-reload').textContent, 'CLIC DROIT / LT', 'the faster secondary finishes independently');
  assert.equal(client.soundCalls.activeReload?.type, 'sniper', 'ending the secondary reload does not cut the ongoing primary recording');
  const primaryLeft = simulation.snapshot().players.find(actor => actor.id === 'guest').reloadLeft;
  for (let elapsed = 0; elapsed < primaryLeft + .01; elapsed += .01) simulation.tick(.01); client.update(simulation.snapshot());
  client.dispatch('keyup', { code: 'KeyX' }); client.dispatch('keydown', { code: 'KeyX', repeat: false });
  assert.equal(client.sent.at(-1).enabled, false); simulation.setDualWield('guest', false); client.update(simulation.snapshot());
  assert.equal(client.node('secondary-ammo-panel').hidden, true);
  client.dispatch('mousedown', { button: 2, preventDefault() {} }); assert.equal(client.aim().scoped, true);
});

test('dual-wield Xbox triggers fire independently and holding Y toggles the optional mode', () => {
  const f = controllerClient({ weapon: 'pistol' });
  Object.assign(f.self, { bonus: { switching: 8 }, dualWield: true, secondaryWeaponId: 'smg',
    weapons: [{ id: 'pistol', weapon: 'pistol', ammo: 12, magazine: 12, reserve: 36 }, { id: 'smg', weapon: 'smg', ammo: 25, magazine: 25, reserve: 50 }],
    hands: { secondary: { weapon: 'smg', weaponId: 'smg', ammo: 25, magazine: 25, reserve: 50, reloading: false, fireReadyLeft: 0 } } });
  f.client.update(f.state); f.button('fire'); f.button('alternate'); f.step(100);
  assert.ok(f.client.sent.some(message => message.type === 'shoot' && message.hand === 'secondary'));
  assert.ok(f.client.sent.some(message => message.type === 'shoot' && !message.hand));
  const primary = f.client.sent.filter(message => message.type === 'shoot' && !message.hand).length;
  f.button('fire', false); f.step(300);
  assert.equal(f.client.sent.filter(message => message.type === 'shoot' && !message.hand).length, primary);
  f.button('alternate', false); f.button('cycle'); f.step(600);
  assert.ok(f.client.sent.some(message => message.type === 'dual-wield' && message.enabled === false));
});


test('secondary automatic fire uses its own sound voice and either mouse trigger releases only its own loop', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const player = simulation.players.get('guest');
  Object.assign(player, { weapon: 'pistol', weaponId: 'pistol', bonus: { switching: 8 }, inventory: { pistol: { ammo: 8, reserve: 12 }, smg: { ammo: 7, reserve: 13 } } });
  assert.equal(simulation.setDualWield('guest', true, 'smg'), true); simulation.time = .03;
  client.update(simulation.snapshot()); client.enter(); client.lock();
  client.dispatch('mousedown', { button: 0 }); client.dispatch('mousedown', { button: 2, preventDefault() {} });
  client.event({ event: 'shot', id: 'guest', weapon: 'smg', weaponId: 'smg', hand: 'secondary', hits: 0, pellets: [] });
  assert.equal(client.soundCalls.shotVoiceIds.at(-1), 'guest:secondary');
  assert.equal(client.soundCalls.activeBursts.smg, true);
  client.dispatch('mouseup', { button: 0 });
  assert.equal(client.soundCalls.activeBursts.smg, true, 'releasing the primary pistol preserves the secondary held burst');
  client.dispatch('mouseup', { button: 2 });
  assert.equal(client.soundCalls.activeBursts.smg, false, 'releasing the secondary stops its held loop immediately');
});


test('dual weapon style rebuild keeps both actual instances and their poses, and selection labels follow live stocks without replacing the focused options', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const player = simulation.players.get('guest');
  Object.assign(player, { weapon: 'pistol', weaponId: 'pistol', bonus: { switching: 8 }, inventory: { pistol: { ammo: 8, reserve: 12 }, minigun: { ammo: 7, reserve: 13 } } });
  assert.equal(simulation.setDualWield('guest', true, 'minigun'), true); simulation.time = .03;
  client.update(simulation.snapshot()); client.enter(); client.lock();
  const before = client.models(), option = client.node('dual-secondary').children[0];
  before.primary.userData.shotAt = .5; before.secondary.userData.shotAt = .7; before.secondary.userData.rotor.rotation.z = 1.23; before.secondary.visible = false;
  player.inventory.minigun.ammo = 6;
  client.update(simulation.snapshot());
  assert.equal(client.node('dual-secondary').children[0], option, 'stock changes preserve native focus and option identity');
  assert.match(option.textContent, /6\//);
  client.restyleWeapons(); const after = client.models();
  assert.notEqual(after.primary, before.primary); assert.notEqual(after.secondary, before.secondary);
  assert.equal(after.primary.userData.shotAt, .5); assert.equal(after.secondary.userData.shotAt, .7);
  assert.equal(after.secondary.userData.rotor.rotation.z, 1.23); assert.equal(after.secondary.visible, false);
  assert.equal(after.primary.userData.type, 'pistol'); assert.equal(after.secondary.userData.type, 'minigun');
});


test('Grenadier countdown uses the authoritative next grenade, translates and hides at full stock or when regeneration is unavailable', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  Object.assign(self, { grenades: 1, maxGrenades: 5, grenadierLeft: 1.8, bonus: { grenadier: 8 } }); state.phase = 'wave';
  client.update(state); client.enter(); client.lock();
  assert.equal(client.node('grenadier-timer').hidden, false); assert.equal(client.node('grenadier-timer').textContent, 'Grenadier · prochaine dans 2 s');
  client.language('en'); assert.equal(client.node('grenadier-timer').textContent, 'Grenadier · next in 2 s');
  self.grenadierLeft = .1; client.update(state); assert.match(client.node('grenadier-timer').textContent, /1 s$/);
  state.paused = true; client.update(state); assert.match(client.node('grenadier-timer').textContent, /1 s$/, 'pause keeps the server countdown frozen'); state.paused = false;
  for (const overrides of [{ grenades: 5 }, { grenadierLeft: null }, { downed: true }, { alive: false }, { waiting: true }, { bonus: {} }]) {
    Object.assign(self, { alive: true, downed: false, waiting: false, grenades: 1, grenadierLeft: 1.8, bonus: { grenadier: 8 } }, overrides);
    client.update(state); assert.equal(client.node('grenadier-timer').hidden, true); assert.equal(client.node('grenadier-timer').textContent, '');
  }
  Object.assign(self, { alive: true, downed: false, waiting: false, grenades: 1, grenadierLeft: 1.8, bonus: { grenadier: 8 } });
  state.practice = true; client.update(state); assert.equal(client.node('grenadier-timer').hidden, true); state.practice = false;
  for (const phase of ['lobby', 'extraction', 'victory', 'gameover']) { state.phase = phase; client.update(state); assert.equal(client.node('grenadier-timer').hidden, true); }
});


test('Grenadier stock counters, silhouettes and pickup messages follow the authoritative capacity at all three increases', () => {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest'); state.phase = 'wave';
  client.update(state); client.enter(); client.lock();
  for (const [level, capacity] of [[1, 2], [3, 3], [6, 4], [8, 5]]) {
    Object.assign(self, { grenades: 1, maxGrenades: capacity, grenadierLeft: 1, bonus: { grenadier: level } }); client.update(state);
    assert.equal(client.node('grenade-count').textContent, `1/${capacity}`);
    assert.equal(client.node('grenade-icons').children.length, capacity, 'capacity changes rebuild silhouettes even when stock stays at one');
    assert.equal(client.node('grenade-icons').children.filter(icon => icon.className.includes('available')).length, 1);
  }
  client.event({ event: 'pickup', id: 'guest', kind: 'grenade', grenades: 3 }); assert.match(client.node('pickup-notice').textContent, /3\/5/);
  client.language('en'); assert.match(client.node('pickup-notice').textContent, /GRENADE COLLECTED.*3\/5/);
  delete self.maxGrenades; self.grenadierLeft = null; self.grenades = 2; client.update(state);
  assert.equal(client.node('grenade-count').textContent, '2/2', 'older snapshots retain the base carry limit');
});


test('all fourteen right-HUD bonus tiles retain original icons, owned levels and complete catalogue details across weapon changes', () => {
  const { client, state, self } = arsenalClient('pistol');
  self.bonus = Object.fromEntries(Object.keys(SUPPLY_BONUSES).map((kind, index) => [kind, index % 8 + 1]));
  client.update(state);
  const cards = () => client.node('bonus-tray').children;
  assert.equal(cards().length, 14); assert.equal(client.node('bonus-tray').hidden, false);
  for (const card of cards()) {
    const kind = card.className.replace('bonus-chip ', '');
    assert.ok(card.children[1].textContent.length > 2, kind);
    assert.match(card.children[0].innerHTML, new RegExp(`<b>${self.bonus[kind]}</b>`), kind);
    assert.ok(card.children[2].textContent.length > 2, kind);
    assert.ok(card.attributes['aria-label'].includes(card.children[2].textContent), kind);
  }
  const melee = cards().find(card => card.className === 'bonus-chip stone');
  assert.equal(melee.dataset.active, 'false'); assert.equal(melee.children.at(-1).textContent, 'Autre arme');
  self.weapon = 'katana'; client.update(state);
  assert.equal(cards().find(card => card.className === 'bonus-chip stone').dataset.active, 'true');
  assert.equal(cards().find(card => card.className === 'bonus-chip extended').dataset.active, 'false');
  client.language('en'); client.update(state);
  assert.equal(cards().find(card => card.className === 'bonus-chip extended').children.at(-1).textContent, 'Other weapon');
  self.bonus = null; client.update(state); assert.equal(client.node('bonus-tray').hidden, true);
});

// Manual save and load of a night (owner, 18 October).
const SAVED_HOST = '00000000000000a1', SAVED_GUEST = '00000000000000b2';
function savedNight({ wave = 12, names = ['Jules', 'Léa'], ambiance = 'family', facing = null } = {}) {
  const simulation = new RoomSimulation('OLD123', { ambiance });
  simulation.addPlayer(SAVED_HOST, names[0]); simulation.addPlayer(SAVED_GUEST, names[1]);
  simulation.start(SAVED_HOST); simulation.setPause(SAVED_HOST, true);
  if (facing) Object.assign(simulation.players.get(SAVED_HOST), facing);
  Object.assign(simulation, { phase: 'wave', wave });
  return JSON.parse(JSON.stringify(simulation.exportSave({ now: new Date(2026, 9, 18, 21, 40) })));
}

test('the Escape menu offers the save during a night, enabled only while the team is paused', () => {
  for (const id of ['host', 'guest']) {
    const simulation = room(); simulation.start('host'); Object.assign(simulation, { phase: 'wave', wave: 3 });
    const client = clientHarness(id);
    client.update(simulation.snapshot());
    assert.equal(client.node('save-game-button').hidden, true, 'not from the lobby');
    client.enter(); client.pause(); client.update(simulation.snapshot());
    assert.equal(client.node('save-game-button').hidden, false);
    assert.equal(client.node('save-game-button').disabled, true, 'a running night cannot be saved');
    assert.equal(client.node('save-game-hint').hidden, false);
    assert.equal(client.node('save-game-hint').textContent, id === 'host' ? 'Mets d’abord la partie en pause (P).' : 'Le chef de salle doit mettre la partie en pause.');
    client.language('en');
    assert.equal(client.node('save-game-hint').textContent, id === 'host' ? 'Pause the game first (P).' : 'The room host must pause the game first.');
    client.language('fr');
    simulation.setPause('host', true); client.update(simulation.snapshot());
    assert.equal(client.node('save-game-button').disabled, false); assert.equal(client.node('save-game-hint').hidden, true);
    client.node('save-game-button').click();
    assert.deepEqual(client.sent.at(-1), { type: 'save-game' });
    assert.equal(client.node('save-game-button').disabled, true, 'one request at a time');
    assert.equal(client.node('save-game-status').textContent, 'Sauvegarde en cours…');
    client.serverMessage({ type: 'save-denied', reason: 'not-paused' });
    assert.equal(client.node('save-game-status').textContent, 'Sauvegarde impossible : mets d’abord la partie en pause.');
    assert.equal(client.node('save-game-button').disabled, false);
    client.node('save-game-button').click(); client.serverMessage({ type: 'save-denied', reason: 'crowded' });
    assert.equal(client.node('save-game-status').textContent, 'Sauvegarde impossible : plus de quatre survivants à garder, places libres comprises.');
    simulation.setPause('host', false); client.update(simulation.snapshot());
    assert.equal(client.node('save-game-status').hidden, true, 'the line goes once the night runs again');
    simulation.phase = 'extraction'; client.update(simulation.snapshot());
    assert.equal(client.node('save-game-button').hidden, true, 'no save during the extraction');
  }
  const practice = new RoomSimulation('ABC123', { practice: true }); practice.addPlayer('guest', 'Invité');
  const client = clientHarness('guest'); client.update(practice.snapshot()); client.enter(); client.pause(); practice.setPause('guest', true); client.update(practice.snapshot());
  assert.equal(client.node('save-game-button').hidden, true, 'never on the practice range');
});

test('a saved night downloads its file and keeps five copies newest first; blocked storage still downloads', () => {
  const client = clientHarness('guest');
  for (let wave = 1; wave <= 6; wave++) client.serverMessage({ type: 'save-game', save: savedNight({ wave }) });
  assert.equal(client.downloads.length, 6);
  assert.match(client.downloads.at(-1).name, /^deadwood-vague-6-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.json$/);
  assert.deepEqual(JSON.parse(client.downloads.at(-1).text), savedNight({ wave: 6 }));
  const kept = JSON.parse(client.storedValues.get('deadwood-saves-v1'));
  assert.deepEqual(kept.map(entry => entry.wave), [6, 5, 4, 3, 2]);
  assert.deepEqual(Object.keys(kept[0]).sort(), ['ambiance', 'difficulty', 'id', 'mapId', 'players', 'save', 'savedAt', 'wave']);
  assert.equal(kept[0].mapId, 'cabin');
  assert.deepEqual(kept[0].players, ['Jules', 'Léa']); assert.equal(kept[0].ambiance, 'family'); assert.equal(kept[0].difficulty, 'normal');
  assert.equal(client.node('save-game-status').textContent, 'Partie sauvegardée (vague 6) : fichier téléchargé et copie gardée dans ce navigateur.');
  client.language('en');
  assert.equal(client.node('save-game-status').textContent, 'Game saved (wave 6): file downloaded and a copy kept in this browser.');
  const blocked = clientHarness('guest', { savesBlocked: true });
  blocked.serverMessage({ type: 'save-game', save: savedNight({ wave: 12 }) });
  assert.equal(blocked.downloads.length, 1, 'the file never waits for the storage');
  assert.equal(blocked.node('save-game-status').textContent, 'Partie sauvegardée (vague 12) : fichier téléchargé. Ce navigateur n’a pas pu en garder de copie.');
  const failed = clientHarness('guest', { downloadFails: true });
  failed.serverMessage({ type: 'save-game', save: savedNight({ wave: 4 }) });
  assert.match(failed.node('save-game-status').textContent, /copie gardée dans ce navigateur, mais le téléchargement a échoué/);
});

test('the home menu lists the saves kept here, deletes one, and is out of the join mode', () => {
  const client = clientHarness('guest');
  client.leave();
  const entries = [savedNight({ wave: 12 }), savedNight({ wave: 3, names: ['Papa', 'Jules'], ambiance: 'frisson' })].map((save, index) => ({
    id: `save-${index}`, savedAt: new Date(2026, 9, 18 - index, 21, 40).toISOString(), wave: save.wave, ambiance: save.ambiance, difficulty: save.difficulty,
    players: save.players.map(player => player.name), save }));
  client.storedValues.set('deadwood-saves-v1', JSON.stringify(entries));
  assert.equal(client.node('load-game-button').hidden, false);
  client.node('load-game-button').click();
  assert.equal(client.node('load-panel').hidden, false);
  const items = () => client.node('load-saves').children;
  assert.deepEqual(items().map(item => item.children[0].textContent), ['La cabane · Vague 12 · Famille · Jules, Léa · 18/10 21:40', 'La cabane · Vague 3 · Frisson (15+) · Papa, Jules · 17/10 21:40']);
  assert.equal(items()[0].children[1].attributes['aria-label'], 'Supprimer cette sauvegarde');
  assert.equal(client.node('load-empty').hidden, true);
  items()[1].children[1].click();
  assert.deepEqual(JSON.parse(client.storedValues.get('deadwood-saves-v1')).map(entry => entry.id), ['save-0']);
  assert.equal(items().length, 1);
  client.language('en'); client.node('load-cancel').click(); client.node('load-game-button').click();
  assert.equal(items()[0].children[0].textContent, 'The cabin · Wave 12 · Family · Jules, Léa · 10/18 21:40');
  items()[0].children[1].click();
  assert.equal(items().length, 0); assert.equal(client.node('load-empty').hidden, false);
  client.node('load-cancel').click(); assert.equal(client.node('load-panel').hidden, true);
  client.node('join-tab').onclick();
  assert.equal(client.node('load-game-button').hidden, true, 'joining a room never loads a save');
  client.node('create-tab').onclick(); assert.equal(client.node('load-game-button').hidden, false);
  // Unreadable storage lists nothing and breaks nothing.
  const blocked = clientHarness('guest', { savesBlocked: true }); blocked.leave();
  blocked.node('load-game-button').click(); assert.equal(blocked.node('load-saves').children.length, 0);
});

test('a file opens a new room (Famille when locked), uploads in chunks and enters the restored night paused', async () => {
  const save = savedNight({ wave: 12, ambiance: 'frisson', facing: { yaw: 1.25, pitch: -.3 } }), text = JSON.stringify(save);
  const file = (content = text, size = content.length) => ({ target: { files: [{ size, text: async () => content }], value: 'save.json' } });
  // Without the lock, the file's ambiance is the new room's.
  const free = clientHarness('host'); free.leave();
  free.node('load-game-button').click(); free.node('load-file-button').click();
  free.node('load-file').onchange(file());
  await settle();
  free.sockets.at(-1).emit('open');
  assert.equal(free.sent.at(-1).type, 'join'); assert.equal(free.sent.at(-1).ambiance, 'frisson'); assert.equal(free.sent.at(-1).room, undefined);
  // A PC locked to Famille opens it as Famille.
  const client = clientHarness('host'); client.leave();
  client.storedValues.set('deadwood-family-lock', '1');
  client.node('load-file').onchange(file('{"not":"a save"}'));
  await settle();
  assert.equal(client.sockets.length, 0, 'a file that is not a save opens nothing');
  assert.equal(client.node('load-status').textContent, 'Chargement impossible : ce fichier n’est pas une sauvegarde Deadwood.');
  client.node('load-file').onchange(file());
  await settle();
  const socket = client.sockets.at(-1); socket.emit('open');
  const join = client.sent.at(-1);
  assert.equal(join.type, 'join'); assert.equal('ambiance' in join, false, 'Famille: the default room');
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'host', room: 'NEW123' }) });
  const begin = client.sent.find(message => message.type === 'load-begin');
  const chunks = client.sent.filter(message => message.type === 'load-chunk');
  assert.deepEqual(begin, { type: 'load-begin', chunks: chunks.length, size: text.length });
  assert.equal(chunks.map(chunk => chunk.data).join(''), text);
  assert.deepEqual(chunks.map(chunk => chunk.index), chunks.map((_, index) => index));
  assert.equal(client.node('lobby-load-status').hidden, false);
  assert.equal(client.node('lobby-load-status').textContent, 'Chargement de la partie…');
  const restoredRoom = new RoomSimulation('NEW123', { onEvent: message => socket.emit('message', { data: JSON.stringify(message) }) });
  restoredRoom.addPlayer('host', 'Jules');
  socket.emit('message', { data: JSON.stringify(restoredRoom.snapshot()) });
  assert.equal(client.node('lobby').hidden, false);
  assert.equal(client.node('start-button').disabled, true, 'no start while the night is loading');
  const result = restoredRoom.importSave(JSON.parse(text), 'host');
  assert.equal(result.ok, true);
  restoredRoom.announceRestore();
  socket.emit('message', { data: JSON.stringify(restoredRoom.snapshot()) });
  socket.emit('message', { data: JSON.stringify({ type: 'load-result', ok: true, wave: 12, phase: 'wave' }) });
  assert.equal(client.node('lobby').hidden, true); assert.equal(client.node('hud').hidden, false);
  assert.equal(client.node('pause').hidden, false, 'the restored night waits, paused');
  assert.equal(client.node('lobby-load-status').hidden, true);
  assert.equal(client.node('toast').textContent, 'Partie reprise à la vague 12. Le chef de salle relance avec P.');
  // The restored survivor faces where they faced when the night was saved.
  socket.emit('message', { data: JSON.stringify(restoredRoom.snapshot()) });
  const facing = client.aim();
  assert.ok(Math.abs(facing.yaw - 1.25) < 1e-9 && Math.abs(facing.pitch + .3) < 1e-9, 'not the lobby’s facing');
  // Resuming while only free seats could still fight is refused with its reason.
  client.event({ event: 'pause-denied', id: 'host', reason: 'seats' });
  assert.equal(client.node('toast').textContent, 'Un survivant encore debout n’a pas repris sa place : attends son retour pour relancer la nuit.');
  // A refusal stays in the lobby with its reason.
  const refused = clientHarness('host'); refused.leave();
  refused.storedValues.set('deadwood-family-lock', '1');
  refused.node('load-file').onchange(file());
  await settle();
  const other = refused.sockets.at(-1); other.emit('open');
  other.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'host', room: 'NEW124' }) });
  const lobbyRoom = new RoomSimulation('NEW124'); lobbyRoom.addPlayer('host', 'Jules');
  other.emit('message', { data: JSON.stringify(lobbyRoom.snapshot()) });
  other.emit('message', { data: JSON.stringify({ type: 'load-result', ok: false, reason: 'invalid' }) });
  assert.equal(refused.node('lobby').hidden, false);
  assert.equal(refused.node('lobby-load-status').textContent, 'Chargement impossible : la sauvegarde est abîmée ou a été modifiée.');
  assert.equal(refused.node('start-button').disabled, false, 'an ordinary lobby again');
  const big = clientHarness('host'); big.leave();
  big.node('load-file').onchange(file(text, 700000));
  await settle();
  assert.equal(big.sockets.length, 0); assert.match(big.node('load-status').textContent, /trop grande/);
});

test('a joiner without a matching name takes a free seat from the admission panel; the restore toast names the wave', () => {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Jules');
  assert.equal(simulation.importSave(savedNight({ wave: 7 }), 'host').ok, true);
  simulation.addPlayer('guest', 'Inconnu', undefined, { defer: true });
  assert.equal(simulation.bindJoiningPlayer('guest'), false);
  const client = clientHarness('guest');
  client.update(simulation.snapshot());
  assert.equal(client.node('admission-panel').hidden, false); assert.equal(client.node('admission-seats').hidden, false);
  const buttons = client.node('admission-seat-list').children;
  assert.deepEqual(buttons.map(button => button.textContent), ['Reprendre la place de Léa']);
  const seat = simulation.freeSeatList()[0].seat;
  buttons[0].click();
  assert.deepEqual(client.sent.at(-1), { type: 'claim-seat', seat });
  assert.equal(simulation.claimSeat('guest', seat), true);
  client.update(simulation.snapshot());
  assert.equal(client.node('admission-panel').hidden, true, 'paused: in place at once');
  client.event({ type: 'event', event: 'game-restored', wave: 7, companions: 'offline' });
  assert.equal(client.node('toast').textContent, 'Partie reprise à la vague 7. Le chef de salle relance avec P. Compagnons non rétablis : cerveau IA absent.');
  client.language('en');
  assert.equal(client.node('toast').textContent, 'Game resumed at wave 7. The room host resumes with P. Companions not restored: AI brain absent.');
  client.event({ type: 'event', event: 'seat-bound', id: 'host', name: 'Jules' });
  assert.equal(client.node('toast').textContent, 'Jules is back in place.');
});

// A saved night with character sheets: Jules the Lumberjack, Léa the Mechanic.
test('a restored seat names its character, shows its debts, and keeps its select locked until the night ends', () => {
  const original = new RoomSimulation('OLD123');
  original.addPlayer(SAVED_HOST, 'Jules', undefined, { sheet: { preset: 'lumberjack' } });
  original.addPlayer(SAVED_GUEST, 'Léa', undefined, { sheet: { preset: 'mechanic' } }); original.addPlayer('00000000000000c3', 'Inès');
  original.start(SAVED_HOST); original.setPause(SAVED_HOST, true); Object.assign(original, { phase: 'wave', wave: 7 });
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Jules');
  assert.equal(simulation.importSave(JSON.parse(JSON.stringify(original.exportSave())), 'host').ok, true);
  // The loader plays the saved Lumberjack: its debts are red tiles at once.
  const host = clientHarness('host', { fakeNow: 0 });
  host.update(simulation.snapshot()); host.enter(); host.lock(); host.update(simulation.snapshot());
  assert.deepEqual(host.node('bonus-tray').children.map(tile => tile.className),
    ['extended', 'medic', 'grenadier', 'radar', 'frostaura'].map(kind => `bonus-chip debt ${kind}`));
  // A newcomer who picked the Scout here sees whose character each seat is.
  const client = clientHarness('guest', { fakeNow: 0 }), sheets = () => client.sent.filter(message => message.type === 'sheet');
  const select = client.node('character-choice-select'), detail = () => client.node('character-choice-detail').textContent;
  client.node('character-select').value = 'scout'; client.node('character-select').onchange();
  simulation.addPlayer('guest', 'Inconnu', undefined, { defer: true, sheet: { preset: 'scout' } });
  client.update(simulation.snapshot());
  assert.equal(client.node('admission-panel').hidden, false);
  assert.deepEqual(client.node('admission-seat-list').children.map(button => button.textContent), ['Reprendre la place de Léa (La Mécano)', 'Reprendre la place d’Inès']);
  client.language('en');
  assert.deepEqual(client.node('admission-seat-list').children.map(button => button.textContent), ['Take Léa’s place back (The Mechanic)', 'Take Inès’s place back']);
  client.language('fr');
  // The night runs on: a newcomer still picks freely, as ever (the Scout
  // came with the join, so there is nothing to send).
  simulation.setPause('host', false); simulation.tick(1 / 30); client.update(simulation.snapshot());
  assert.equal(select.disabled, false); assert.equal(sheets().length, 0);
  // Léa's place taken back while the night runs: waiting, but her Mechanic plays.
  const seat = simulation.freeSeatList()[0].seat;
  client.node('admission-seat-list').children[0].click();
  assert.deepEqual(client.sent.at(-1), { type: 'claim-seat', seat });
  assert.equal(simulation.claimSeat('guest', seat), true);
  for (let frame = 0; frame < 3; frame++) client.update(simulation.snapshot());
  assert.equal(client.node('admission-panel').hidden, false, 'through the admission');
  assert.equal(simulation.snapshot().freeSeats.length, 1);
  assert.equal(client.node('admission-seats').hidden, true, 'one seat each: Inès’s is not offered again');
  assert.equal(select.disabled, true); assert.equal(select.value, 'mechanic', 'the select shows the character in play');
  assert.equal(detail(), 'Bricolage +2 · Force −1 · Agilité −1 · Place reprise : tu joues La Mécano, comme dans la sauvegarde. Tu pourras en changer une fois la nuit finie.');
  client.language('en');
  assert.equal(detail(), 'Tinkering +2 · Strength −1 · Agility −1 · Place taken back: you play The Mechanic, as saved. You can change it once the night is over.');
  client.language('fr');
  assert.equal(sheets().length, 0, 'nothing sent for a seat during its night');
  select.value = 'pyro'; select.onchange(); assert.equal(sheets().length, 0); assert.equal(select.value, 'mechanic');
  assert.equal(client.storedValues.get('deadwood-character-v1'), 'scout', 'taking a seat back stores nothing on this PC');
  // The night ends: the Mechanic stays hers, with no silent switch to the
  // Scout; another pick in the results is sent as ever.
  simulation.endGame(); for (let frame = 0; frame < 3; frame++) client.update(simulation.snapshot());
  assert.equal(sheets().length, 0);
  const results = client.node('character-choice-select-results');
  assert.equal(results.disabled, false); assert.equal(results.value, 'mechanic');
  assert.match(client.node('character-choice-detail-results').textContent, /^Bricolage \+2 · Force −1 · Agilité −1 · Tu peux en changer avant la nuit/);
  results.value = 'scout'; results.onchange();
  assert.equal(sheets().length, 1); assert.equal(sheets().at(-1).sheet.preset, 'scout');
  assert.equal(simulation.setSheet('guest', sheets().at(-1).sheet), true);
  client.update(simulation.snapshot()); client.update(simulation.snapshot());
  assert.equal(sheets().length, 1);
  assert.match(client.node('character-choice-detail-results').textContent, /^Agilité \+2 · Force −1 · Balistique −1 · Tu peux en changer avant la nuit/);
});

// The loader goes from the lobby straight into the restored night and never
// sees the lobby's seat line: the restore toast names the saved character
// when it is not the one picked on this PC, and it stays theirs afterwards.
test('a loader whose seat plays another character than this PC’s pick is told so, and keeps it after the night', () => {
  const original = new RoomSimulation('OLD123');
  original.addPlayer(SAVED_HOST, 'Jules', undefined, { sheet: { preset: 'lumberjack' } }); original.addPlayer(SAVED_GUEST, 'Léa');
  original.start(SAVED_HOST); original.setPause(SAVED_HOST, true); Object.assign(original, { phase: 'wave', wave: 7 });
  const save = JSON.parse(JSON.stringify(original.exportSave()));
  const load = pick => {
    const client = clientHarness('host');
    client.node('character-select').value = pick; client.node('character-select').onchange();
    const simulation = new RoomSimulation('ABC123', { onEvent: message => client.event(message) });
    simulation.addPlayer('host', 'Jules', undefined, { sheet: { preset: pick } });
    client.update(simulation.snapshot());
    // As on both servers: the restore event, the restored room, the result.
    assert.equal(simulation.importSave(JSON.parse(JSON.stringify(save)), 'host').ok, true);
    simulation.announceRestore({ companions: 'offline' });
    assert.equal(client.node('toast').textContent, 'Partie reprise à la vague 7. Le chef de salle relance avec P. Compagnons non rétablis : cerveau IA absent.');
    client.update(simulation.snapshot());
    client.serverMessage({ type: 'load-result', ok: true, wave: 7, phase: 'wave', companions: 'offline' });
    assert.equal(client.node('hud').hidden, false); assert.equal(client.node('pause').hidden, false);
    return { client, simulation, sheets: () => client.sent.filter(message => message.type === 'sheet') };
  };
  const { client, simulation, sheets } = load('scout');
  assert.equal(client.node('toast').textContent, 'Partie reprise à la vague 7. Le chef de salle relance avec P. Compagnons non rétablis : cerveau IA absent. Place reprise : tu joues Le Bûcheron, comme dans la sauvegarde. Tu pourras en changer une fois la nuit finie.');
  client.language('en');
  assert.equal(client.node('toast').textContent, 'Game resumed at wave 7. The room host resumes with P. Companions not restored: AI brain absent. Place taken back: you play The Lumberjack, as saved. You can change it once the night is over.');
  client.language('fr');
  assert.equal(client.storedValues.get('deadwood-character-v1'), 'scout');
  // The night ends: nothing is sent, the results show the Lumberjack and the
  // next night plays him again.
  simulation.setPause('host', false); simulation.endGame();
  for (let frame = 0; frame < 3; frame++) client.update(simulation.snapshot());
  assert.equal(sheets().length, 0);
  assert.equal(client.node('character-choice-select-results').value, 'lumberjack');
  assert.equal(simulation.start('host'), true); assert.equal(simulation.players.get('host').sheet.preset, 'lumberjack');
  // A loader who picked the seat's own character hears only the usual line.
  const same = load('lumberjack');
  assert.equal(same.client.node('toast').textContent, 'Partie reprise à la vague 7. Le chef de salle relance avec P. Compagnons non rétablis : cerveau IA absent.');
});

// A homemade character that exists only in the file (created on another PC).
test('a custom character known only from the save stays its survivor’s after the night, offered by name on this PC', () => {
  const chemist = { name: 'Chimiste', stats: { strength: 0, agility: -1, ballistics: -1, tinkering: 0, chemistry: 2 } };
  const original = new RoomSimulation('OLD123');
  original.addPlayer(SAVED_HOST, 'Jules'); original.addPlayer(SAVED_GUEST, 'Léa', undefined, { sheet: chemist });
  original.start(SAVED_HOST); original.setPause(SAVED_HOST, true); Object.assign(original, { phase: 'wave', wave: 5 });
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Jules');
  assert.equal(simulation.importSave(JSON.parse(JSON.stringify(original.exportSave())), 'host').ok, true);
  // Léa joins from the family PC (its pick: the standard survivor) and takes her seat back by name.
  const client = clientHarness('guest'), sheets = () => client.sent.filter(message => message.type === 'sheet');
  simulation.addPlayer('guest', 'Léa', undefined, { defer: true }); assert.equal(simulation.bindJoiningPlayer('guest'), true);
  client.update(simulation.snapshot()); client.update(simulation.snapshot());
  const select = client.node('character-choice-select');
  assert.equal(select.disabled, true); assert.equal(select.value, '__seat__');
  assert.deepEqual([select.children.at(-1).value, select.children.at(-1).textContent], ['__seat__', 'Chimiste (sauvegarde)']);
  assert.equal(client.node('character-choice-detail').textContent, 'Chimie +2 · Agilité −1 · Balistique −1 · Place reprise : tu joues Chimiste, comme dans la sauvegarde. Tu pourras en changer une fois la nuit finie.');
  // The night ends: no silent switch to this PC's standard survivor, and
  // «Une nouvelle nuit» starts her as the Chemist again.
  simulation.endGame(); for (let frame = 0; frame < 3; frame++) client.update(simulation.snapshot());
  assert.equal(sheets().length, 0);
  const results = client.node('character-choice-select-results');
  assert.equal(results.disabled, false); assert.equal(results.value, '__seat__');
  assert.equal(simulation.start('host'), true);
  assert.deepEqual(simulation.players.get('guest').sheet, { preset: null, name: 'Chimiste', stats: chemist.stats });
  // Another pick, then the save's character again: each is sent.
  simulation.endGame(); client.update(simulation.snapshot());
  results.value = 'standard'; results.onchange(); assert.equal(sheets().at(-1).sheet.preset, 'standard');
  assert.equal(simulation.setSheet('guest', sheets().at(-1).sheet), true); client.update(simulation.snapshot());
  results.value = '__seat__'; results.onchange();
  assert.deepEqual(sheets().at(-1).sheet, { preset: null, name: 'Chimiste', stats: chemist.stats });
  assert.equal(client.storedValues.get('deadwood-characters-v1') ?? null, null, 'nothing stored without the player asking');
});

// The optional character sheet (character-sheet-ui.js) inside the real client.
function sheetClient(sheet, { phase = 'wave', wave = 6 } = {}) {
  const simulation = new RoomSimulation('ABC123'); simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité', undefined, { sheet });
  const client = clientHarness('guest', { fakeNow: 0 }); simulation.start('host');
  const state = simulation.snapshot(), self = state.players.find(player => player.id === 'guest');
  Object.assign(state, { phase, wave, supplyCrate: { id: `supply-${wave}`, wave, x: 20, y: 0, z: 16, claimed: [] } });
  self.supplyAction = 'crate';
  client.update(state); client.enter(); client.lock();
  return { client, state, self, simulation };
}
const supplyOption = (client, kind) => client.node('supply-options').children.find(button => button.dataset.supplyChoice === kind);

test('the home character joins the room; the plain standard one keeps the usual join message', () => {
  const plain = clientHarness();
  plain.connect(); plain.sockets.at(-1).emit('open');
  assert.equal(plain.sent.at(-1).type, 'join'); assert.equal(Object.hasOwn(plain.sent.at(-1), 'sheet'), false);
  const client = clientHarness();
  client.node('character-select').value = 'lumberjack'; client.node('character-select').onchange();
  assert.equal(client.storedValues.get('deadwood-character-v1'), 'lumberjack');
  assert.equal(client.node('character-card').children[0].textContent, 'Le Bûcheron');
  client.connect(); client.sockets.at(-1).emit('open');
  assert.deepEqual(client.sent.at(-1).sheet, { preset: 'lumberjack', name: '', stats: { strength: 2, agility: 0, ballistics: 0, tinkering: -1, chemistry: -1 } });
});

test('lobby lines show «Nom · Personnage» with stat chips, and the lobby select changes the sheet only before a night', () => {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité', undefined, { sheet: { preset: 'lumberjack' } });
  const state = simulation.snapshot(), client = clientHarness('guest');
  client.update(state);
  const badge = index => client.node('lobby-players').children[index].children[1].children.find(child => child.className === 'character-badge');
  assert.equal(badge(1).textContent, ' · Le Bûcheron'); assert.equal(badge(1).children[0].textContent, 'Force +2 · Bricolage −1 · Chimie −1');
  assert.equal(badge(0).textContent, ' · Survivant'); assert.equal((badge(0).children ?? []).length, 0, 'no chips for the standard sheet');
  const select = client.node('character-choice-select');
  assert.equal(select.disabled, false); assert.equal(select.children.length, 7);
  assert.match(client.node('character-choice-detail').textContent, /^Force \+2 · Bricolage −1 · Chimie −1 · Tu peux en changer avant la nuit/);
  select.value = 'pyro'; select.onchange();
  assert.deepEqual(client.sent.at(-1), { type: 'sheet', sheet: { preset: 'pyro', name: '', stats: { strength: -1, agility: 0, ballistics: -1, tinkering: 0, chemistry: 2 } } });
  assert.equal(client.storedValues.get('deadwood-character-v1'), 'pyro');
  client.language('en'); client.update(state);
  assert.equal(badge(1).textContent, ' · The Lumberjack'); assert.equal(badge(1).children[0].textContent, 'Strength +2 · Tinkering −1 · Chemistry −1');
  client.language('fr');
  // The server takes it, as the next snapshot shows.
  assert.equal(simulation.setSheet('guest', client.sent.at(-1).sheet), true);
  state.players[1].character = simulation.snapshot().players[1].character;
  // A running night locks the choice for admitted survivors, not for a waiting one.
  state.phase = 'wave'; state.wave = 3; client.update(state);
  assert.equal(select.disabled, true); assert.match(client.node('character-choice-detail').textContent, /verrouillé/);
  const sent = client.sent.length; select.value = 'scout'; select.onchange();
  assert.equal(client.sent.length, sent);
  state.players[1].waiting = true; client.update(state);
  assert.equal(client.node('character-choice-select').disabled, false);
  // Both servers drop a paused room's messages: a paused night locks it too.
  state.paused = true; client.update(state);
  assert.equal(select.disabled, true); assert.match(client.node('character-choice-detail').textContent, /Partie en pause : personnage verrouillé/);
  const sheets = client.sent.filter(message => message.type === 'sheet').length;
  select.value = 'scout'; select.onchange(); assert.equal(client.sent.filter(message => message.type === 'sheet').length, sheets);
  state.paused = false; client.update(state);
  select.value = 'scout'; select.onchange(); assert.equal(client.sent.at(-1).sheet.preset, 'scout');
  state.phase = 'lobby'; state.players[1].waiting = false; state.practice = true; client.update(state);
  assert.equal(client.node('character-choice').hidden, true, 'the weapon stand has no sheet');
  state.practice = false;
  for (const phase of ['gameover', 'victory']) {
    state.phase = phase; client.update(state);
    assert.equal(client.node('character-choice-select-results').disabled, false, phase);
  }
});

test('the crate previews talents and repayments, and the HUD shows debts as red tiles', () => {
  const { client, state, self } = sheetClient({ preset: 'pyro' });
  assert.deepEqual(self.sheetDebt, { stone: 1, vitality: 1, rainproof: 1, toughskin: 1, perforating: 1, reinforced: 1 });
  const tiles = () => client.node('bonus-tray').children;
  assert.equal(client.node('bonus-tray').hidden, false);
  assert.deepEqual(tiles().map(tile => tile.className), ['bonus-chip debt stone', 'bonus-chip debt perforating', 'bonus-chip debt reinforced',
    'bonus-chip debt vitality', 'bonus-chip debt rainproof', 'bonus-chip debt toughskin']);
  const vitality = tiles().find(tile => tile.className.endsWith('vitality'));
  assert.match(vitality.children[0].innerHTML, /<b>−1<\/b>/);
  assert.equal(vitality.children[2].textContent, '90 PV maximum'); assert.equal(vitality.children[3].textContent, 'Prochaine prise : −1 → 0');
  assert.match(vitality.attributes['aria-label'], /malus de départ −1/);
  client.event({ event: 'supply-menu', id: 'guest', menu: 'crate', crateId: 'supply-6', wave: 6 });
  const grenadier = supplyOption(client, 'grenadier');
  assert.equal(grenadier.disabled, false);
  assert.equal(grenadier.children.at(-1).textContent, 'N0 → N2'); assert.equal(grenadier.children.at(-1).children[0].textContent, 'Talent ×2');
  assert.match(grenadier.children[2].textContent, /capacité 2/);
  const reinforced = supplyOption(client, 'reinforced');
  assert.equal(reinforced.children.at(-1).textContent, '−1 → 0 · rattrapage'); assert.equal(reinforced.children[2].textContent, 'Malus compensé');
  assert.equal(supplyOption(client, 'stone').disabled, false, 'a debt is claimable without a melee weapon');
  assert.equal(supplyOption(client, 'vitamins').children.at(-1).textContent, 'NIVEAU 1/8', 'an ordinary family keeps the usual wording');
  assert.equal((supplyOption(client, 'vitamins').children.at(-1).children ?? []).length, 0);
  supplyOption(client, 'vitality').onclick();
  assert.deepEqual(client.sent.findLast(message => message.type === 'supply-claim'), { type: 'supply-claim', bonus: 'vitality', crateId: 'supply-6' });
  client.event({ event: 'supply-claimed', id: 'guest', bonus: 'vitality', level: 0, repaid: true, effective: 0 });
  assert.equal(client.node('toast').textContent, 'Vitalité : rattrapage, niveau 0.');
  // A picked-up level offsets the debt; the tile shows the effective level.
  self.bonus = { vitality: 3 }; client.update(state);
  const effective = tiles().find(tile => tile.className === 'bonus-chip vitality');
  assert.match(effective.children[0].innerHTML, /<b>2<\/b>/);
  assert.match(client.node('active-bonus').textContent, /Vitalité 2/);
  assert.match(client.node('active-bonus').textContent, /Imperméable −1/);
  self.sheetDebt = null; self.bonus = null; client.update(state);
  assert.equal(client.node('bonus-tray').hidden, true, 'nothing owed, nothing carried: no tiles');
  client.language('en'); self.sheetDebt = { switching: 2 }; client.update(state);
  assert.equal(tiles()[0].children[2].textContent, '350 ms weapon switch'); assert.equal(tiles()[0].children[3].textContent, 'Next claim: −2 → −1');
});

test('a change the server did not take is said plainly through the night, then sent once more when changes are allowed', () => {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité');
  const client = clientHarness('guest', { fakeNow: 0 }), sheets = () => client.sent.filter(message => message.type === 'sheet');
  const feed = () => { client.update(simulation.snapshot()); };
  feed(); assert.equal(sheets().length, 0, 'the joined character is the server’s already');
  const select = client.node('character-choice-select'), detail = () => client.node('character-choice-detail').textContent;
  // The host starts the night just as the choice is made: the server refuses it.
  select.value = 'scout'; select.onchange(); assert.equal(sheets().length, 1);
  simulation.start('host'); assert.equal(simulation.setSheet('guest', sheets().at(-1).sheet), false);
  feed();
  assert.equal(select.disabled, true); assert.equal(select.value, 'scout');
  assert.equal(detail(), 'En jeu : Survivant. Ton choix, La Scoute, sera pris dès que possible.');
  for (let frame = 0; frame < 5; frame++) feed();
  assert.equal(sheets().length, 1, 'never during the night');
  // The results allow it again: sent once, taken, and the line is the usual one.
  simulation.phase = 'gameover'; feed();
  assert.equal(sheets().length, 2); assert.equal(sheets().at(-1).sheet.preset, 'scout');
  feed(); assert.equal(sheets().length, 2, 'once, not every snapshot');
  assert.equal(simulation.setSheet('guest', sheets().at(-1).sheet), true); feed();
  assert.match(client.node('character-choice-detail-results').textContent, /^Agilité \+2 · Force −1 · Balistique −1 · Tu peux en changer avant la nuit/);
  for (let frame = 0; frame < 5; frame++) feed();
  assert.equal(sheets().length, 2);
});

test('characters saved in another tab of the browser reach the select through the storage event', () => {
  const client = clientHarness(), options = () => client.node('character-select').children.map(option => option.textContent);
  assert.equal(options().length, 8);
  client.storedValues.set('deadwood-characters-v1', JSON.stringify([{ id: 'c1', name: 'Mamie Jo', stats: { strength: 1, agility: -1, ballistics: 0, tinkering: 0, chemistry: 0 } }]));
  client.dispatchWindow('storage', { key: 'deadwood-characters-v1' });
  assert.deepEqual(options().slice(7), ['Mamie Jo', 'Créer un personnage…']);
});

test('a chemistry debt shows the one-grenade cap the server enforces, and a weaker medkit never claims full health', () => {
  const { client, state, self, simulation } = sheetClient({ preset: 'lumberjack' });
  assert.equal(self.maxGrenades, 1);
  assert.equal(client.node('grenade-count').textContent, '0/1'); assert.equal(client.node('grenade-icons').children.length, 1);
  assert.equal(simulation.players.get('guest').grenades, 0);
  self.grenades = 1; client.update(state);
  assert.equal(client.node('grenade-count').textContent, '1/1');
  assert.equal(client.node('grenade-icons').children.filter(icon => icon.className.includes('available')).length, 1);
  client.event({ event: 'pickup', id: 'guest', kind: 'grenade', grenades: 1 });
  assert.equal(client.node('pickup-notice').textContent, 'GRENADE RAMASSÉE · 1/1');
  client.event({ event: 'pickup', id: 'guest', kind: 'health', healed: 60, partial: true });
  assert.equal(client.node('pickup-notice').textContent, 'MÉDIKIT · +60 VIE');
  client.language('en'); assert.equal(client.node('pickup-notice').textContent, 'MEDKIT · +60 HP'); client.language('fr');
});

test('a chemistry debt fills both revive bars over its real 6 s or 7.5 s; other revivers keep the usual 5 s scale', () => {
  const { client, state, self } = arsenalClient('pistol');
  const host = state.players.find(player => player.id === 'host');
  host.sheetDebt = { medic: 2 };
  Object.assign(self, { downed: true, alive: true, hp: 0, revivedBy: 'host', reviveLeft: 7.5, bleedOutLeft: 18 }); client.update(state);
  assert.equal(client.node('revive-progress-bar').style.width, '0%', 'a 7.5 s revive is not stuck at 0 % for 2.5 s');
  self.reviveLeft = 3.75; client.update(state); assert.equal(client.node('revive-progress-bar').style.width, '50%');
  host.sheetDebt = null; self.reviveLeft = 2.2; client.update(state); assert.equal(client.node('revive-progress-bar').style.width, '56%');
  host.bonus = { medic: 8 }; client.update(state); assert.equal(client.node('revive-progress-bar').style.width, '56%', 'the standard game’s bar is unchanged');
  Object.assign(self, { downed: false, hp: 100, revivedBy: null, reviveLeft: 0, x: 0, y: 0, z: 0, reviveTargetId: 'host', sheetDebt: { medic: 1 } });
  Object.assign(host, { downed: true, alive: true, hp: 0, x: .8, y: 0, z: 0, bonus: null });
  Object.assign(self, { revivingId: 'host', reviveLeft: 6 }); client.update(state);
  assert.equal(client.node('interaction-progress').hidden, false); assert.equal(client.node('interaction-progress-bar').style.width, '0%');
  self.reviveLeft = 1.5; client.update(state); assert.equal(client.node('interaction-progress-bar').style.width, '75%');
  self.sheetDebt = null; client.update(state); assert.equal(client.node('interaction-progress-bar').style.width, '70%');
});

// «Mon survivant» (owner, 18 October): Tab shows a readable sheet of what the
// bonuses really give; the Escape menu has the same switch for the controller.
const flatten = node => [node, ...(node?.children ?? []).flatMap(flatten)];
const sheetText = client => flatten(client.node('survivor-sheet')).map(node => node.textContent ?? '').filter(Boolean).join(' | ');
const tab = (client, extra = {}) => { const event = { code: 'Tab', repeat: false, prevented: 0, preventDefault() { this.prevented++; }, ...extra }; client.dispatch('keydown', event); return event; };
function sheetPlayer(options) {
  const { client, state, self } = arsenalClient('assault');
  Object.assign(self, { bonus: { vitality: 4, extended: 3, reinforced: 4, perforating: 6 }, sheetDebt: { vitamins: 2 }, character: { preset: null, name: 'Fusée', stats: { strength: 0, agility: -1, ballistics: 1, tinkering: 0, chemistry: 0 } },
    magazine: 31, reserveCapacity: 94, ...options });
  client.update(state);
  return { client, state, self };
}

test('Tab shows the survivor sheet in place of the tiles, ignores key repeat and text fields, and is remembered', async () => {
  const { client, state, self } = sheetPlayer();
  await new Promise(setImmediate); // the published weapon table arrives
  const sheet = client.node('survivor-sheet'), tray = client.node('bonus-tray');
  assert.equal(sheet.hidden, true, 'hidden by default: the HUD is exactly as before');
  assert.equal(tray.hidden, false); const tiles = tray.children.length; assert.equal(tiles, 5);
  let event = tab(client);
  assert.equal(event.prevented, 1, 'Tab never moves the focus in play');
  assert.equal(sheet.hidden, false); assert.equal(tray.hidden, true, 'the sheet replaces the tiles');
  assert.equal(client.storedValues.get(SURVIVOR_SHEET_KEY), 'shown');
  // The numbers are the server's: the published table through upgradedWeapon.
  const simulation = new RoomSimulation('ABC123'); simulation.addPlayer('p', 'P');
  const server = Object.assign(simulation.players.get('p'), { weapon: 'assault', weaponId: 'assault', inventory: { assault: { ammo: 0, reserve: 0 } }, bonus: { ...self.bonus }, sheetDebt: { ...self.sheetDebt } });
  const profile = simulation.weaponProfile(server);
  const text = sheetText(client);
  assert.match(text, /Mon survivant/); assert.match(text, /Invité · Fusée/);
  assert.match(text, new RegExp(`Dégâts par balle \\| ${Math.round(WEAPONS.assault.damage)} → ${Math.round(profile.damage)}`));
  assert.match(text, new RegExp(`Chargeur \\| ${WEAPONS.assault.magazine} → ${profile.magazine}`));
  assert.match(text, new RegExp(`Vie max \\| 100 → ${characterStats(server).maxHp}`));
  assert.match(text, /Vitesse \| malus \| −8 %/);
  assert.match(text, /Balles perforantes \| N6 \| \/8 \| Perforation \+2 cibles \| Prochaine prise : N6 → N7/);
  // Holding Tab does nothing more; typing in a field keeps Tab native.
  event = tab(client, { repeat: true }); assert.equal(event.prevented, 1); assert.equal(sheet.hidden, false);
  event = tab(client, { target: { matches: () => true } }); assert.equal(event.prevented, 0); assert.equal(sheet.hidden, false);
  tab(client, { ctrlKey: true }); assert.equal(sheet.hidden, false, 'a shortcut with Ctrl is not the sheet key');
  // No rebuild while nothing it shows has changed.
  const children = sheet.children; self.x += 1; self.hp = 50; client.update(state);
  assert.equal(sheet.children, children);
  self.bonus.vitality = 5; client.update(state);
  assert.notEqual(sheet.children, children); assert.match(sheetText(client), /Vie max \| 100 → 150/);
  // The Escape menu keeps Tab for its own focus.
  client.pause(); event = tab(client); assert.equal(event.prevented, 0); assert.equal(sheet.hidden, false);
  client.lock();
  tab(client);
  assert.equal(sheet.hidden, true); assert.equal(tray.hidden, false); assert.equal(tray.children.length, tiles, 'the tiles come back as they were');
  assert.equal(client.storedValues.get(SURVIVOR_SHEET_KEY), 'hidden');
  // The next page load remembers it.
  const again = clientHarness('guest', { fakeNow: 0, savedSurvivorSheet: 'shown' });
  again.update(state); again.enter(); again.lock(); again.update(state);
  assert.equal(again.node('survivor-sheet').hidden, false); assert.equal(again.node('bonus-tray').hidden, true);
});

test('the Escape menu switch shows or hides the sheet, for the controller too, and says which', () => {
  const { client, state, self } = sheetPlayer();
  const button = client.node('survivor-sheet-toggle'), sheet = client.node('survivor-sheet');
  client.pause();
  assert.equal(button.textContent, 'Fiche du survivant : cachée · Tab'); assert.equal(button.attributes['aria-pressed'], 'false');
  button.click();
  assert.equal(sheet.hidden, false); assert.equal(button.textContent, 'Fiche du survivant : affichée · Tab'); assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(client.storedValues.get(SURVIVOR_SHEET_KEY), 'shown');
  client.language('en'); assert.equal(button.textContent, 'Survivor sheet: shown · Tab');
  assert.match(sheetText(client), /My survivor/);
  button.click(); assert.equal(sheet.hidden, true); assert.equal(button.textContent, 'Survivor sheet: hidden · Tab');
  // Waiting for admission or a finished night: no sheet, no error.
  button.click(); assert.equal(sheet.hidden, false);
  self.waiting = true; client.update(state); assert.equal(sheet.hidden, true);
  self.waiting = false; state.phase = 'gameover'; client.update(state); assert.equal(sheet.hidden, true);
  state.phase = 'wave'; client.update(state); client.enter(); client.update(state); assert.equal(sheet.hidden, false);
  // A snapshot without this player changes nothing and throws nothing.
  assert.doesNotThrow(() => client.update({ ...state, players: state.players.filter(player => player !== self) }));
  client.leave(); assert.equal(sheet.hidden, true);
});

test('a standard survivor sees one short line, and the weapon stand works too', () => {
  const simulation = new RoomSimulation('ABC123', { practice: true }); simulation.addPlayer('guest', 'Jules');
  const client = clientHarness('guest', { fakeNow: 0, savedSurvivorSheet: 'shown' }), state = simulation.snapshot();
  client.update(state); client.enter(); client.lock(); client.update(state);
  assert.equal(client.node('survivor-sheet').hidden, false);
  assert.match(sheetText(client), /Survivant standard : aucun bonus pour l’instant\./);
  assert.match(sheetText(client), /Arme en main · +\| FUSIL D’ASSAUT/);
  assert.equal(client.node('bonus-tray').hidden, true);
});

test('an interaction plaque never sits on the survivor sheet: it steps to its left', () => {
  const { client } = sheetPlayer();
  const plaque = client.node('interaction'); plaque.hidden = false;
  client.placePlaque(); assert.equal(plaque.style.left, '640px', 'without a sheet: where its target is');
  client.sheetRect({ left: 600, right: 900, top: 400, bottom: 600 });
  client.placePlaque(); assert.equal(plaque.style.left, '596px');
  client.sheetRect({ left: 1000, right: 1245, top: 182, bottom: 380 });
  client.placePlaque(); assert.equal(plaque.style.left, '640px', 'clear of the sheet: unchanged');
});

test('while the sheet shows, the chain feed and the breach alert step aside, and come back when it hides', () => {
  const { client } = sheetPlayer();
  tab(client);
  const feed = client.node('team-chain-feed'), breach = client.node('breach-alert');
  const region = sheetRegion({ viewport: { width: 1280, height: 720 }, score: { left: 1128, right: 1246, top: 91, bottom: 172 },
    weapon: { left: 935, right: 1245, top: 358, bottom: 686 }, wave: { left: 565, right: 715, top: 97, bottom: 215 } });
  // A full sheet takes the feed's usual place: it goes left of the weapon panel.
  client.placeFeed(region, [{ left: 731, top: 91, right: 984, bottom: 320 }, { left: 992, top: 180, right: 1245, bottom: 313 }]);
  assert.equal(feed.classList.contains('beside-sheet'), true); assert.equal(feed.classList.contains('over-sheet'), false);
  assert.deepEqual([feed.style.right, feed.style.bottom, feed.style.maxWidth], ['353px', '248px', '197px']);
  assert.ok(1280 - 353 - 197 >= 640 + 80, 'its left edge stays clear of the crosshair');
  assert.equal(breach.style.right, `${1280 - 1128 + 8}px`, 'the breach alert stands just left of the score');
  // A short sheet leaves the usual place free: nothing moves.
  client.placeFeed(region, [{ left: 945, top: 180, right: 1245, bottom: 260 }]);
  assert.equal(feed.classList.contains('beside-sheet'), false); assert.equal(feed.style.right, '');
  // Hidden again: everything back where it was.
  client.placeFeed(region, [{ left: 731, top: 91, right: 984, bottom: 320 }]);
  tab(client);
  assert.equal(client.node('survivor-sheet').hidden, true);
  assert.equal(feed.classList.contains('beside-sheet'), false);
  assert.deepEqual([feed.style.right, feed.style.bottom, feed.style.maxWidth, feed.style.maxHeight, breach.style.right], ['', '', '', '', '']);
});

test('the key bar names Tab at every width it shows, and the sheet hides the standing wave tip', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bar = /<div class="hud-controls">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.match(bar, /<span class="sheet-key-hint"><kbd data-i18n="controls.tab">TAB<\/kbd> <span data-i18n="controls.sheet">FICHE<\/span><\/span>/);
  assert.doesNotMatch(css, /sheet-key-hint[^{]*\{[^}]*display:\s*none/, 'never hidden');
  // Room for it below 1500 px: «· MOLETTE» steps aside there.
  assert.match(bar, /<span data-i18n="controls.weapons">ARMES<\/span><span class="controls-wheel"> <span data-i18n="controls.wheel">· MOLETTE<\/span><\/span>/);
  assert.match(css, /@media\(max-width:1499px\)\{\.hud-controls \.controls-wheel\{display:none\}/);
  assert.match(css, /body:has\(#survivor-sheet:not\(\[hidden\]\)\) #combat-tip\{display:none\}/);
  assert.doesNotMatch(css, /sheet-clear/, 'the feed is no longer pushed towards the centre');
});

// --- The score is the damage dealt (owner, 18 October) ----------------------
const digits = text => String(text).replace(/\D/g, '');
function scoreClient(options = {}) {
  const simulation = room(), client = clientHarness('guest', { fakeNow: 0, realCamera: true, ...options });
  simulation.start('host'); simulation.beginWave(); simulation.toSpawn = 0;
  const state = simulation.snapshot(); state.phase = 'wave'; state.wave = 3;
  client.update(state); client.enter();
  return { simulation, client, state, self: state.players.find(player => player.id === 'guest') };
}

test('impact numbers are on by default, asked for at the welcome, and drawn only from this survivor’s own batches', () => {
  const { client, state } = scoreClient();
  assert.equal(client.node('feedback-impact-numbers').checked, true);
  assert.equal(client.node('feedback-coin-popups').checked, true, 'coins keep their own setting');
  client.connect(); const socket = client.sockets.at(-1); socket.emit('open');
  socket.emit('message', { data: JSON.stringify({ type: 'welcome', id: 'guest', room: 'ABC123' }) });
  assert.deepEqual(client.sent.filter(message => message.type === 'impact-numbers'), [{ type: 'impact-numbers', enabled: true }]);
  assert.equal(client.sent.some(message => message.type === 'damage-feedback'), false);
  client.update(state); client.enter();
  const layer = client.node('damage-numbers');
  socket.emit('message', { data: JSON.stringify({ type: 'impacts', impacts: [['z1', 0, 1, -4, 37, 1], ['z2', .5, 1, -5, 12, 2]] }) });
  const drawn = (layer.children ?? []).map(element => [element.textContent, element.className]);
  assert.deepEqual(drawn, [['37', 'damage-number damage-headshot'], ['12', 'damage-number damage-continuous']], 'one number per record, gold for the head');
  // Hits and kills from the room's events pop no score of their own any more.
  const before = client.node('score-popups').children?.length ?? 0;
  client.event({ event: 'kill', id: 'guest', zombieId: 'z1', weapon: 'pistol', x: 0, y: 0, z: -4, dirX: 0, dirZ: -1, headshot: true, score: 100, chain: 1, chainBonus: 0, chainId: 1 });
  client.event({ event: 'bullet-impact', id: 'guest', stop: 'zombie', zombieId: 'z1', damage: 10, x: 0, y: 1, z: -4 });
  assert.equal(client.node('score-popups').children?.length ?? 0, before, 'no « +10 » or « +100 » popup');
  assert.equal((layer.children ?? []).length, 2, 'public events add no number: only the private batch does');
  state.paused = true; client.update(state);
  client.impacts({ type: 'impacts', impacts: [['z3', 0, 1, -4, 50, 0]] });
  assert.equal((layer.children ?? []).length, 2, 'nothing while the room is paused');
});

// The server resolves a rocket at once; its visible rocket flies at 170 m/s
// (review, 18 October): the blast's numbers, like its kill, wait for it.
test('a rocket blast’s numbers wait for the visible rocket to land, like its kill', () => {
  const { client, state, self } = scoreClient();
  Object.assign(self, { x: 0, y: 0, z: 0 }); client.update(state);
  client.frame(0);
  const layer = client.node('damage-numbers'), drawn = () => (layer.children ?? []).map(element => element.textContent);
  const far = ['far', 0, 1.5, -60, 420, IMPACT_FLAGS.rocket | IMPACT_FLAGS.killed], shot = ['near', 0, 1, -4, 30, 0];
  client.impacts({ type: 'impacts', impacts: [far, shot] });
  assert.deepEqual(drawn(), ['30'], 'the bullet’s number at once, nothing yet for the blast 60 m away');
  const arrival = 60 / 170, start = client.visualTime();
  client.time(200); client.frame(200);
  assert.ok(client.visualTime() - start < arrival); assert.deepEqual(drawn(), ['30'], 'still flying');
  client.time(450); client.frame(450);
  assert.ok(client.visualTime() - start >= arrival);
  assert.deepEqual(drawn(), ['30', '420'], 'the blast’s number when the rocket lands');
  assert.equal(layer.children.at(-1).className, 'damage-number damage-kill');
});

test('an explicit « Score et pièces qui s’envolent » opt-out keeps the numbers and the coins off', () => {
  const { client } = scoreClient({ savedValues: [['deadwood-feedback-v1', JSON.stringify({ shake: .5, scorePopups: false })]] });
  assert.equal(client.node('feedback-impact-numbers').checked, false);
  assert.equal(client.node('feedback-coin-popups').checked, false);
  assert.equal(client.storedValues.get('deadwood-impact-numbers-v1'), '0');
  client.impacts({ type: 'impacts', impacts: [['z1', 0, 1, -4, 37, 0]] });
  assert.equal(client.node('damage-numbers').children?.length ?? 0, 0);
  const toggle = client.node('feedback-impact-numbers'); toggle.checked = true; toggle.listeners.get('change')();
  assert.deepEqual(client.sent.at(-1), { type: 'impact-numbers', enabled: true });
  assert.equal(client.storedValues.get('deadwood-impact-numbers-v1'), '1');
});

test('the end-of-wave card counts each revive bonus up, then flies it to the score, which takes it on landing', () => {
  const { client, state, self } = scoreClient();
  // The order the servers send: the wave's last snapshot, the bonus event, then
  // the break's snapshot whose score includes the bonuses.
  Object.assign(self, { score: 310, waveScore: 310, waveKills: 9 });
  client.update(state);
  client.time(1000);
  client.event({ type: 'event', event: 'revive-bonus', wave: 3, reason: 'wave', payouts: [
    { reviverId: 'guest', revivedId: 'host', reviverName: 'Invité', revivedName: 'Léa', damage: 1840, amount: 1840 },
    { reviverId: 'guest', revivedId: 'ines', reviverName: 'Invité', revivedName: 'Inès', damage: 40, amount: 150 },
    { reviverId: 'host', revivedId: 'lou', reviverName: 'Hôte', revivedName: 'Lou', damage: 500, amount: 500 },
  ] });
  assert.equal(digits(client.node('score-value').textContent), '310', 'never less than before the bonuses');
  assert.doesNotMatch(client.node('toast').textContent, /Relève par/, 'nothing for this survivor to be told: nobody revived them');
  const held = structuredClone(state); held.phase = 'intermission';
  Object.assign(held.players.find(player => player.id === 'guest'), { score: 2300, waveScore: 2300 });
  client.update(held); client.frame(1000);
  assert.equal(digits(client.node('score-value').textContent), '310', 'the counter waits for the bonuses to land');
  assert.equal(client.node('wave-card').hidden, false);
  assert.equal(client.node('wave-card-score').textContent.replace(/\s/g, ' '), '+2 300', 'the wave total includes the bonuses');
  const box = client.node('wave-card-revives');
  assert.equal(box.hidden, false);
  assert.deepEqual(box.children.map(line => line.textContent), ['Relève de Léa · +0', 'Relève d’Inès · +0'], 'one line each, only this survivor’s');
  client.time(1450 + 450); client.frame(1450 + 450);
  const counting = digits(box.children[0].textContent);
  assert.ok(Number(counting) > 0 && Number(counting) < 1840, 'counting up: ' + counting);
  client.time(1000 + 450 + 900); client.frame(1000 + 450 + 900);
  assert.equal(box.children[0].textContent.replace(/\s/g, ' '), 'Relève de Léa · +1 840');
  const flights = () => (client.node('score-popups').children ?? []).filter(popup => popup.className === 'score-popup bonus');
  assert.equal(flights().length, 1, 'the first line flies to the score');
  assert.equal(flights()[0].textContent.replace(/\s/g, ' '), '+1 840', 'written like the line it leaves');
  client.language('en'); assert.equal(box.children[0].textContent, 'Revived Léa · +1,840'); client.language('fr');
  client.time(1000 + 450 + 900 + 960); client.frame(1000 + 450 + 900 + 960);
  assert.equal(digits(client.node('score-value').textContent), '2150', 'the first bonus landed');
  client.time(4000); client.frame(4000); client.time(5000); client.frame(5000);
  assert.equal(digits(client.node('score-value').textContent), '2300', 'every bonus landed');
  assert.equal(box.children[1].textContent, 'Relève d’Inès · +150', 'the floor when the revived survivor dealt less');
});

test('a revived survivor is told what their teammate earned through them; many bonuses are summarised', () => {
  const { client, state, self } = scoreClient();
  client.event({ type: 'event', event: 'revive-bonus', wave: 3, reason: 'wave', payouts: [
    { reviverId: 'host', revivedId: 'guest', reviverName: 'Jules', revivedName: 'Invité', damage: 1840, amount: 1840 },
    { reviverId: 'lou', revivedId: 'guest', reviverName: 'Lou', revivedName: 'Invité', damage: 20, amount: 150 },
  ] });
  assert.equal(client.node('toast').hidden, false);
  assert.equal(client.node('toast').textContent.replace(/\s/g, ' '), 'Relève par Jules : Jules gagne aussi tes 1 840 points · Relève par Lou : +150 points pour Lou');
  client.language('en');
  assert.equal(client.node('toast').textContent, 'Revived by Jules: Jules also earns your 1,840 points · Revived by Lou: +150 points for Lou');
  client.language('fr');
  Object.assign(self, { score: 3990, waveScore: 3990 }); client.update(state);
  client.event({ type: 'event', event: 'revive-bonus', wave: 3, reason: 'wave', payouts: ['Bo', 'Cy', 'Di', 'Flo', 'Gus'].map((name, index) => (
    { reviverId: 'guest', revivedId: 'p' + index, reviverName: 'Invité', revivedName: name, damage: 200 + index, amount: 200 + index })) });
  const held = structuredClone(state); held.phase = 'intermission';
  Object.assign(held.players.find(player => player.id === 'guest'), { score: 5000, waveScore: 5000 });
  client.update(held); client.frame(0);
  assert.deepEqual(client.node('wave-card-revives').children.map(line => line.textContent.replace(/\s/g, ' ')),
    ['Relève de Bo · +0', 'Relève de Cy · +0', 'Relève de Di · +0', '+2 autres relèves · +0'], 'four lines at most');
  client.time(20000); client.frame(20000); client.frame(21000); client.time(30000); client.frame(30000);
  assert.equal(digits(client.node('score-value').textContent), '5000', 'nothing is held once the card is gone');
});


test('multi-map host picker defaults to cabin, stays hidden in Join and preserves a creation draft',()=>{
 const client=clientHarness('host',{multiMap:true,mapStorageBlocked:true});client.leave();
 assert.equal(client.node('level-picker').hidden,false);assert.equal(client.node('level-choice').value,'cabin');assert.match(client.node('level-detail').textContent,/cabane/);
 client.node('join-tab').click();assert.equal(client.node('level-picker').hidden,true);client.node('create-tab').click();assert.equal(client.node('level-picker').hidden,false);
 client.node('player-name').value='Jules';client.node('ambiance-frisson').click();client.node('level-choice').value='supermarket';client.node('level-choice').onchange();client.node('connect-button').click();
 assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/supermarket/']);assert.equal(client.sockets.length,0,'never connects to wrong geometry');
 const transfer=JSON.parse(client.windowName().slice('deadwood-map-handoff-v1:'.length));assert.equal(transfer.draft.name,'Jules');assert.equal(transfer.draft.ambiance,'frisson');assert.equal(transfer.target,'supermarket');
 const standalone=clientHarness('host');assert.equal(standalone.node('level-picker').hidden,true);
});
test('a root-page guest entering a supermarket code redirects before a websocket and keeps their name',()=>{
 const client=clientHarness('guest',{multiMap:true,mapStorageBlocked:true});client.leave();client.node('player-name').value='Léa';client.node('join-tab').click();client.node('room-code').value='s123ab';client.connect();
 assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/supermarket/?room=S123AB']);assert.equal(client.sockets.length,0);const transfer=JSON.parse(client.windowName().slice('deadwood-map-handoff-v1:'.length));assert.equal(transfer.draft.name,'Léa');assert.equal(transfer.draft.action,'join');
});
test('market-page networking, sharing and names retain their namespace in both languages',async()=>{
 const client=clientHarness('host',{multiMap:true,mapId:'supermarket',href:'http://localhost:3000/maps/supermarket/'});client.leave();client.connect();const socket=client.sockets.at(-1);assert.equal(socket.url,'ws://localhost:3000/maps/supermarket/ws');socket.emit('open');socket.emit('message',{data:JSON.stringify({type:'welcome',id:'host',room:'S123AB',mapId:'supermarket'})});
 assert.equal(client.node('lobby-map-name').textContent,'Le Dernier Panier');client.language('en');assert.equal(client.node('pause-map-name').textContent,'The Last Checkout');await client.node('copy-room-link').onclick();assert.equal(client.clipboardWrites.at(-1),'http://localhost:3000/maps/supermarket/?room=S123AB');
});
test('cross-map file load preserves exact saved bytes with storage blocked, and rejects an unknown map',async()=>{
 const client=clientHarness('host',{multiMap:true,mapStorageBlocked:true,savesBlocked:true});client.leave();const save={...savedNight(),mapId:'supermarket',spaceId:'supermarket-depth'},text=JSON.stringify(save);
 client.node('load-file').onchange({target:{files:[{size:text.length,text:async()=>text}],value:'save.json'}});await settle();assert.equal(client.sockets.length,0);assert.equal(client.redirectedUrls[0],'http://localhost:3000/maps/supermarket/');const transfer=JSON.parse(client.windowName().slice('deadwood-map-handoff-v1:'.length));assert.equal(transfer.draft.text,text);
 const invalid=clientHarness('host',{multiMap:true});invalid.leave();const bad=JSON.stringify({...save,mapId:'other'});invalid.node('load-file').onchange({target:{files:[{size:bad.length,text:async()=>bad}],value:'save.json'}});await settle();assert.equal(invalid.redirectedUrls.length,0);assert.equal(invalid.sockets.length,0);assert.match(invalid.node('load-status').textContent,/décor non reconnu/);
});

const LAN_MAPS='cabin,supermarket,hospital';
const handoff=client=>JSON.parse(client.windowName().slice('deadwood-map-handoff-v1:'.length));
const optionValues=client=>client.node('level-choice').children.map(option=>option.value);
test('the LAN maps tag adds the hospital after the two HTML choices, keeps cabin the default and hands a creation draft over',()=>{
 const client=clientHarness('host',{multiMap:true,maps:LAN_MAPS,mapStorageBlocked:true});client.leave();const choice=client.node('level-choice');
 assert.deepEqual(optionValues(client),['cabin','supermarket','hospital']);const added=choice.children[2];assert.equal(added.tagName,'OPTION');assert.equal(added.dataset.i18n,'levels.hospital');assert.equal(added.textContent,"L'Hôpital des Pins");
 assert.equal(choice.value,'cabin');assert.match(client.node('level-detail').textContent,/cabane/);
 client.node('player-name').value='Jules';choice.value='hospital';choice.onchange();assert.equal(client.node('level-detail').textContent,translate('levels.hospitalDetail'));
 client.node('connect-button').click();assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/hospital/']);assert.equal(client.sockets.length,0,'never connects to wrong geometry');
 const transfer=handoff(client);assert.equal(transfer.target,'hospital');assert.equal(transfer.draft.action,'create');assert.equal(transfer.draft.name,'Jules');
 const pair=clientHarness('host',{multiMap:true,maps:'cabin,hospital'});assert.deepEqual(optionValues(pair),['cabin','hospital'],'an unoffered HTML choice is removed');
 const standalone=clientHarness('host',{maps:LAN_MAPS});assert.equal(standalone.node('level-picker').hidden,true);assert.deepEqual(optionValues(standalone),['cabin','supermarket'],'standalone pages leave the HTML alone');
});
test('a root-page guest entering a hospital code redirects to the hospital page before any websocket',()=>{
 const client=clientHarness('guest',{multiMap:true,maps:LAN_MAPS,mapStorageBlocked:true});client.leave();client.node('player-name').value='Léa';client.node('join-tab').click();client.node('room-code').value='h123ab';client.connect();
 assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/hospital/?room=H123AB']);assert.equal(client.sockets.length,0);const transfer=handoff(client);assert.equal(transfer.target,'hospital');assert.equal(transfer.draft.action,'join');assert.equal(transfer.draft.room,'H123AB');assert.equal(transfer.draft.name,'Léa');
});
test('a hospital save loaded on the LAN root page carries its exact bytes to the hospital page',async()=>{
 const client=clientHarness('host',{multiMap:true,maps:LAN_MAPS,mapStorageBlocked:true,savesBlocked:true});client.leave();const text=JSON.stringify({...savedNight(),mapId:'hospital',spaceId:'hospital-depth'});
 client.node('load-file').onchange({target:{files:[{size:text.length,text:async()=>text}],value:'save.json'}});await settle();assert.equal(client.sockets.length,0);assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/hospital/']);
 const transfer=handoff(client);assert.equal(transfer.target,'hospital');assert.equal(transfer.draft.action,'load');assert.equal(transfer.draft.text,text);
});
test('hospital-page networking, sharing and name keep the hospital namespace',async()=>{
 const client=clientHarness('host',{multiMap:true,maps:LAN_MAPS,mapId:'hospital',href:'http://localhost:3000/maps/hospital/'});client.leave();assert.deepEqual(optionValues(client),['cabin','supermarket','hospital']);assert.equal(client.node('level-choice').value,'hospital');
 client.connect();assert.equal(client.redirectedUrls.length,0);const socket=client.sockets.at(-1);assert.equal(socket.url,'ws://localhost:3000/maps/hospital/ws');socket.emit('open');socket.emit('message',{data:JSON.stringify({type:'welcome',id:'host',room:'H123AB',mapId:'hospital'})});
 assert.equal(client.node('lobby-map-name').textContent,"L'Hôpital des Pins");await client.node('copy-room-link').onclick();assert.equal(client.clipboardWrites.at(-1),'http://localhost:3000/maps/hospital/?room=H123AB');
});
const FOUR_MAPS='cabin,supermarket,hospital,funfair';
test('the four-map LAN tag lists La Fête Foraine last in DÉCOR, with its detail line, and a creation goes to the funfair page',()=>{
 const client=clientHarness('host',{multiMap:true,maps:FOUR_MAPS,mapStorageBlocked:true});client.leave();const choice=client.node('level-choice');
 assert.deepEqual(optionValues(client),['cabin','supermarket','hospital','funfair']);const added=choice.children[3];assert.equal(added.tagName,'OPTION');assert.equal(added.dataset.i18n,'levels.funfair');assert.equal(added.textContent,'La Fête Foraine');
 assert.equal(choice.value,'cabin','the cabin stays the default');
 client.node('player-name').value='Jules';choice.value='funfair';choice.onchange();assert.equal(client.node('level-detail').textContent,translate('levels.funfairDetail'));
 assert.match(client.node('level-detail').textContent,/salle des machines/);
 client.node('connect-button').click();assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/funfair/']);assert.equal(client.sockets.length,0,'never connects to wrong geometry');
 const transfer=handoff(client);assert.equal(transfer.target,'funfair');assert.equal(transfer.draft.action,'create');assert.equal(transfer.draft.name,'Jules');
 const three=clientHarness('host',{multiMap:true,maps:LAN_MAPS});assert.deepEqual(optionValues(three),['cabin','supermarket','hospital'],'no funfair without its name in the tag');
});
test('a funfair code typed on the LAN root goes to the funfair page; a code of hex digits after F stays a cabin code',()=>{
 const client=clientHarness('guest',{multiMap:true,maps:FOUR_MAPS,mapStorageBlocked:true});client.leave();client.node('player-name').value='Léa';client.node('join-tab').click();client.node('room-code').value='f1g2h3';client.connect();
 assert.deepEqual(client.redirectedUrls,['http://localhost:3000/maps/funfair/?room=F1G2H3']);assert.equal(client.sockets.length,0);const transfer=handoff(client);assert.equal(transfer.target,'funfair');assert.equal(transfer.draft.room,'F1G2H3');
 const cabin=clientHarness('guest',{multiMap:true,maps:FOUR_MAPS,mapStorageBlocked:true});cabin.leave();cabin.node('join-tab').click();cabin.node('room-code').value='f12345';cabin.connect();
 assert.equal(cabin.redirectedUrls.length,0);assert.equal(cabin.sockets.length,1);assert.equal(cabin.sockets[0].url,'ws://localhost:3000/ws');
});
test('the online page offers no funfair: a funfair code stays on this server and a funfair save is refused',async()=>{
 const client=clientHarness('guest',{multiMap:true,mapStorageBlocked:true});client.leave();assert.deepEqual(optionValues(client),['cabin','supermarket']);
 client.node('join-tab').click();client.node('room-code').value='F1G2H3';client.connect();assert.equal(client.redirectedUrls.length,0);assert.equal(client.sockets.length,1);assert.equal(client.sockets[0].url,'ws://localhost:3000/ws');
 const host=clientHarness('host',{multiMap:true,mapStorageBlocked:true,savesBlocked:true});host.leave();const text=JSON.stringify({...savedNight(),mapId:'funfair',spaceId:'funfair-depth'});
 host.node('load-file').onchange({target:{files:[{size:text.length,text:async()=>text}],value:'save.json'}});await settle();assert.equal(host.redirectedUrls.length,0);assert.equal(host.sockets.length,0);assert.equal(host.node('load-status').textContent,translate('levels.transferFailed'));
});
test('with only the online multi-map tag, no hospital choice appears, a hospital code stays on this server and a hospital save is refused',async()=>{
 const client=clientHarness('guest',{multiMap:true,mapStorageBlocked:true});client.leave();assert.deepEqual(optionValues(client),['cabin','supermarket']);
 client.node('join-tab').click();client.node('room-code').value='h123ab';client.connect();assert.equal(client.redirectedUrls.length,0);assert.equal(client.sockets.length,1);assert.equal(client.sockets[0].url,'ws://localhost:3000/ws');
 const host=clientHarness('host',{multiMap:true,mapStorageBlocked:true,savesBlocked:true});host.leave();const text=JSON.stringify({...savedNight(),mapId:'hospital',spaceId:'hospital-depth'});
 host.node('load-file').onchange({target:{files:[{size:text.length,text:async()=>text}],value:'save.json'}});await settle();assert.equal(host.redirectedUrls.length,0);assert.equal(host.sockets.length,0);assert.equal(host.node('load-status').textContent,translate('levels.transferFailed'));
});

test('receiving a map handoff restores character, temporary English and muted volume before connecting without storage',()=>{
 const draft={action:'create',name:'Jules',ambiance:'frisson-leger',sheet:{preset:'lumberjack'},language:'en',audio:{muted:true,volume:.23}};
 const envelope={version:1,at:Date.now(),origin:'http://localhost:3000',target:'supermarket',draft};
 const client=clientHarness('host',{multiMap:true,mapId:'supermarket',href:'http://localhost:3000/maps/supermarket/',mapStorageBlocked:true,allStorageBlocked:true,windowName:'deadwood-map-handoff-v1:'+JSON.stringify(envelope)});
 assert.equal(client.windowName(),'','consumed before async connection');assert.equal(client.node('player-name').value,'Jules');assert.equal(client.node('character-select').value,'lumberjack');
 assert.equal(client.node('pause-map-name').textContent,'The Last Checkout');assert.equal(client.node('sound-toggle').attributes['aria-label'],'Enable sound');assert.equal(client.soundCalls.volumes.at(-1),0);assert.equal(client.node('volume').value,'0.23');assert.equal(client.soundCalls.unlocks,0,'no unsolicited audio activation');
 const socket=client.sockets.at(-1);socket.emit('open');assert.equal(client.sent.at(-1).sheet.preset,'lumberjack');assert.equal(client.sent.at(-1).ambiance,'frisson-leger');
 client.leave();client.connect();client.sockets.at(-1).emit('open');assert.equal(client.sent.at(-1).sheet.preset,'lumberjack','next night keeps the visibly selected character');
 client.node('sound-toggle').click();assert.equal(client.soundCalls.volumes.at(-1),.23,'unmuting restores original chosen volume');
});
