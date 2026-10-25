import * as THREE from '/vendor/three.module.js';
import { LEVEL, IS_SUPERMARKET } from './level-config.js';
import { createMapContext, mapForRoomCode } from './map-context.js';
import { createWorld, createZombie, animateZombie, createSurvivor, createWeapon, animateMeleeWeapon, animateWeaponMechanism, createExtraction, createPickup, createGroundWeapon, setGroundWeaponPose, createGrenadeProjectile, animateGrenadeProjectile, createGrenadeExplosion, createFlameStream, setZombieBurn, setZombieHealth, setZombieFrost, setPickupFill, animatePickup, setSurvivorWeapon, setSurvivorSecondaryWeapon, animateSurvivor, fireSurvivor, survivorMuzzle, createTracer, startZombieDeath, animateZombieDeath, createRaider, animateRaider, startRaiderDeath, animateRaiderDeath, disposeZombie, setWeaponHeat, createStragglerMarker, getSurvivorStyle, STYLED_PICKUP_KINDS } from './world.js';
import { applyWeaponViewPose, copyWeaponMuzzleInView } from './weapon-view.js';
import { shotMuzzleFromView, safeTracerStart } from './shot-visuals.js';
import { createBallisticTracer } from './ballistic-visuals.js';
import { scopeTargetDistance } from './scope-rangefinder.js';
import { BALLISTICS, ballisticRange } from './ballistics.js';
import { cameraSupportHeight, cameraSmoothingAlpha, normalizeCameraSmoothing, CAMERA_SMOOTHING_KEY, CAMERA_SMOOTHING_DEFAULTS } from './camera-motion.js';
import { SoundEngine } from './audio.js';
import { ARMORY, ARMORY_REACH, ARMORY_HEIGHT_REACH, STARTER_WEAPON, WEAPON_MOVEMENT, FIRE_INTERVALS, PLAYER_POSTURE, ENEMY_HEALTH, BRUTE_HEALTH, enemyAppearance, PICKUPS, GRENADES, ROCKET, FLAMETHROWER, MELEE_WEAPONS, MINIGUN_TIMING, minigunRotorSpeed, firingSchedule, MAX_WAVES, WINDOWS, RAIDS, DIFFICULTY_LEVELS, FRIENDLY_FIRE_LEVELS, friendlyFireAllowed, REVIVE, COIN_GIFT, AMBIANCES, ambianceOf, isFrissonLike } from './rules.js';
import { SUPPLY_BONUSES, LATE_SUPPLIES, BACKPACK, MAX_BONUS_LEVEL, perforatingTargets, reinforcedMeleeTargets, reinforcedDamagePercent } from './weapon-upgrades.js';
import { getLanguage, setLanguage, t, translateMessage, translateDom, weaponLabel, frenchOf } from './i18n.js';
import { bonusHudCard, sheetMalusEffect } from './bonus-hud.js';
import { bonusIcon } from './bonus-icons.js';
import { readSheetShown, saveSheetShown, survivorSheetModel, survivorSheetKey, renderSurvivorSheet, measureSheetRegion, placeSurvivorSheet, sheetFeedPlace, sheetBreachRight } from './survivor-sheet.js';
import { CHARACTER_BONUSES, characterStats, characterBonusDescription } from './character-bonuses.js';
import { claimStep, effectiveBonusLevel, bonusDebt } from './character-sheet.js';
import { createCharacterPicker, characterLabel, characterChips, signedValue } from './character-sheet-ui.js';
import { activeWeaponId } from './weapon-inventory.js';
import { readMusicTheme, saveMusicTheme, readMusicVolume, saveMusicVolume } from './music-themes.js';
import { RADAR, radarBlipSeconds, reconLevel, radarInformation, radarPulseIndex } from './radar-rules.js';
import { GENERATOR } from './expedition.js';
import { createRadarUI, radarSupplyStatus } from './radar-ui.js';
import { createAimDiagnostics } from './aim-diagnostics.js';
import { createGamepadControls } from './gamepad-controls.js';
import { createAimAssist } from './aim-assist.js';
import { readRawMouse, saveRawMouse, rawMovementScale, warpEcho, warpEchoSized, WARP_ECHO, requestMouseLock } from './mouse-look.js';
import { enemyProfile } from './enemies.js';
import { meleeDirection, meleeWillLand, trackMotion, sightClear, sightDoors } from './melee-reach.js';
import { readControllerSettings, saveControllerSettings, navigateControllerMenu } from './controller-ui.js';
import { rumbleEffect, playRumble, stopRumble } from './haptics.js';
import { createGraphics } from './graphics.js';
import { createFeedbackHud } from './feedback-hud.js';
import { createDamageNumbers, IMPACT_FLAGS } from './damage-numbers.js';
import { createCameraShake, explosionTrauma, SHOT_TRAUMA, createHitStop, createSlowMotion, knockbackFor, clampSlide, createBarrelHeat, casingPort } from './combat-feel.js';
import { applyAmbiance } from './ambiance.js';
import { COMPANION_PROFILE_CHOICES, companionArchetype } from './companion-profiles.js';
import { saveFileName, saveSummary, readSaves, keepSave, forgetSave, saveDateLabel, uploadPlan, downloadText } from './save-game.js';
import { reviveCardItems, reviveToastLines, reviveCountUp, REVIVE_COUNT_MS, REVIVE_STAGGER_MS } from './revive-bonus.js';

const IS_HOSPITAL = LEVEL.id === 'hospital', IS_FUNFAIR = LEVEL.id === 'funfair', HAS_SPACE = IS_SUPERMARKET || IS_HOSPITAL || IS_FUNFAIR;
const $ = id => document.getElementById(id);
const mapContext = createMapContext({ mapId: LEVEL.id });
const mapHandoff = mapContext.consumeHandoff();
let mapSheetDraft = null;
const canvas = $('game');
const sound = new SoundEngine();
const radarUI = createRadarUI({ root:$('radar-panel'), canvas:$('radar-map'), title:$('radar-title'), battery:$('radar-battery'), legend:$('radar-legend'), translate:t, pixelRatio:devicePixelRatio });
sound.setMusicTheme(readMusicTheme());
// Music keeps its own level, remembered per browser; 1 is exactly the
// original mix. The engine holds it, so it survives every (re)unlock.
let musicVolume = readMusicVolume();
sound.setMusicVolume(musicVolume);
// Combat feedback: graded hit marker, flying coins and kill chains, plus the
// camera shake, hit-stop, barrel heat and casings that make a shot land.
const feedback = createFeedbackHud({ document, marker: $('hit-marker'), popupLayer: $('score-popups'), scoreTarget: $('score-value'), coinTarget: $('points-value'),
  chainBanner: $('chain-banner'), teamFeed: $('team-chain-feed'), t, storage: (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), now: () => performance.now() });
feedback.bindSettings({ shake: $('feedback-shake'), shakeValue: $('feedback-shake-value'), coinPopups: $('feedback-coin-popups') });
// The score is the damage dealt (owner, 18 October): one number per impact,
// this survivor's own only. A killing blow's number flies to the score.
const damageNumbers = createDamageNumbers({ document, layer: $('damage-numbers'), storage: (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(),
  target: $('score-value'), frames: flight => feedback.flightFrames(flight), onLand: () => feedback.bump(),
  scale: () => Math.min(innerWidth, innerHeight) / 720, onChange: enabled => send({ type: 'impact-numbers', enabled }) });
damageNumbers.bindSettings($('feedback-impact-numbers'));
// Friendly fire, the shooter's side: what the teammate took, in red over
// their head, whatever the impact numbers setting; it scores nothing, so it
// never flies to the score.
const friendlyNumbers = createDamageNumbers({ document, layer: $('damage-numbers'), variant: 'friendly', sign: '−',
  canFly: () => false, scale: () => Math.min(innerWidth, innerHeight) / 720 });
const cameraShake = createCameraShake(), hitStop = createHitStop(), slowMotion = createSlowMotion(), shakeOffset = { x: 0, y: 0, roll: 0 };
const gunHeat = new Map(), pendingCasings = [], pendingCues = [], casingFloors = new Map();
let waveCardUntil = 0;
// The wave's revive bonuses for this survivor: each a card line that counts
// up, then flies to the score counter, which only takes it when it lands.
// The bonus event comes just before the snapshot that adds it to the score:
// the counter never shows less than the score it had then.
let reviveItems = [], reviveAwaitUntil = 0, reviveScoreFloor = 0;
let pendingChain = null;
const pendingTeamChains = new Map(); // teammate id -> this frame's newest chain
const SPRINT_FOV_BOOST = 5;
const musicSelectors = [$('music-theme'), $('pause-music-theme')];
function syncMusicSelectors() { for (const selector of musicSelectors) selector.value = sound.musicTheme; }
for (const selector of musicSelectors) selector.onchange = event => {
  const value = event.target.value;
  if (sound.setMusicTheme(value)) saveMusicTheme(value);
  syncMusicSelectors();
};
syncMusicSelectors();
// Keep canonical French sources for notices already on screen when the language changes.
const names = Object.fromEntries(['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum', 'assault', 'rocket', 'flamethrower', 'bat', 'fireaxe', 'katana', 'hammer', 'sniper'].map(id => [id, weaponLabel(id, { language: 'fr' })]));
const automaticWeapons = ['rifle', 'smg', 'minigun', 'assault', 'flamethrower'];
const cadence = FIRE_INTERVALS;
const colors = [0x809fac, 0xb28e68, 0x8da46e, 0xb78d98];
const phaseNames = { lobby: 'LE REFUGE ATTEND', countdown: 'LA NUIT APPROCHE', wave: 'VAGUE EN COURS', intermission: 'UN PEU DE RÉPIT', extraction: 'LE SECOURS EST LÀ', victory: 'TOUS À L’ABRI', gameover: 'LA LUMIÈRE S’EST ÉTEINTE' };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, .06, 130);
// Smooth the player's eye position independently of the walking offset.
// Feeding the offset back into the next frame amplifies it at high FPS.
const cameraBasePosition = new THREE.Vector3();
const NORMAL_FOV = 76, SNIPER_FOV = 30;
camera.rotation.order = 'YXZ';
const graphics = createGraphics({ canvas, scene, camera });
const renderer = graphics.renderer;
scene.add(camera);
const world = createWorld(scene, { quality: graphics.preset });
let levelReady = !HAS_SPACE;
if (HAS_SPACE) {
  world.ready.then(ok => { levelReady = ok; refreshStartButton(); refreshLevelLabels(); });
}
function refreshLevelLabels() {
  if (IS_FUNFAIR) {
    const en = getLanguage() === 'en';
    document.title = 'La Fête Foraine · Deadwood';
    const put = (key, label) => { for (const node of document.querySelectorAll('[data-i18n="' + key + '"]')) node.textContent = label; };
    put('intro.eyebrow', en ? 'THE FUNFAIR.' : 'LA FÊTE FORAINE.');
    put('intro.title.first', en ? 'The grand' : 'La fête');
    put('intro.title.second', en ? 'funfair' : 'foraine');
    put('intro.description.first', en ? 'A quiet amusement hall, colourful rides and a sheltered machine room. Four entrances. Twenty waves.' : 'Un palais des jeux silencieux, des manèges colorés et une salle des machines abritée. Quatre accès. Vingt vagues.');
    put('setup.note.second', en ? 'A shared code brings everyone into the same funfair.' : 'Un code commun vous réunit dans la même fête foraine.');
    put('setup.armory', t('setup.armory').replace(en ? 'Upstairs:' : 'À l’étage :', en ? 'In the basement:' : 'Dans le sous-sol :'));
    put('intro.coordinates', en ? 'LEVEL 04 / THE FUNFAIR' : 'NIVEAU 04 / LA FÊTE FORAINE');
    const caption = document.querySelector('.scene-caption .coordinates');
    if (caption && !levelReady) caption.textContent = world.root.userData.artError ? (en ? 'Artwork unavailable · reload to retry' : 'Décor indisponible · recharge pour réessayer') : (en ? 'Loading funfair…' : 'Chargement de la fête foraine…');
    return;
  }
  if (IS_HOSPITAL) {
    const en = getLanguage() === 'en';
    document.title = "L'Hôpital des Pins · Deadwood";
    const put = (key, label) => { for (const node of document.querySelectorAll('[data-i18n="' + key + '"]')) node.textContent = label; };
    put('intro.eyebrow', en ? 'THE PINE HOSPITAL.' : "L'HÔPITAL DES PINS.");
    put('intro.title.first', en ? 'The pine' : 'L’hôpital');
    put('intro.title.second', en ? 'hospital' : 'des Pins');
    put('intro.description.first', en ? 'Abandoned wards, an operating theatre and a sheltered basement. Four entrances. Twenty waves.' : 'Services abandonnés, bloc opératoire et sous-sol abrité. Quatre accès. Vingt vagues.');
    put('setup.note.second', en ? 'A shared code brings everyone into the same hospital.' : 'Un code commun vous réunit dans le même hôpital.');
    put('setup.armory', t('setup.armory').replace(en ? 'Upstairs:' : 'À l’étage :', en ? 'In the basement:' : 'Dans le sous-sol :'));
    put('intro.coordinates', en ? 'LEVEL 03 / THE PINE HOSPITAL' : "NIVEAU 03 / L'HÔPITAL DES PINS");
    const caption = document.querySelector('.scene-caption .coordinates');
    if (caption && !levelReady) caption.textContent = world.root.userData.artError ? (en ? 'Artwork unavailable · reload to retry' : 'Décor indisponible · recharge pour réessayer') : (en ? 'Loading hospital…' : 'Chargement de l’hôpital…');
    return;
  }
  if (!IS_SUPERMARKET) return;
  const en = getLanguage() === 'en';
  document.title = 'Le Dernier Panier · Deadwood';
  const put = (key, label) => { for (const node of document.querySelectorAll('[data-i18n="' + key + '"]')) node.textContent = label; };
  put('intro.eyebrow', en ? 'THE LAST CHECKOUT.' : 'LE DERNIER PANIER.');
  put('intro.title.first', en ? 'The last' : 'Le dernier');
  put('intro.title.second', en ? 'checkout' : 'panier');
  put('intro.description.first', en ? 'Abandoned aisles, underground stockrooms and an open-air terrace. Four entrances. Twenty waves.' : 'Rayons abandonnés, cave de réserve et terrasse à ciel ouvert. Quatre accès. Vingt vagues.');
  put('setup.note.second', en ? 'A shared code brings everyone into the same supermarket.' : 'Un code commun vous réunit dans le même supermarché.');
  put('setup.armory', t('setup.armory').replace(en ? 'Upstairs:' : 'À l’étage :', en ? 'In the cellar:' : 'Dans la cave :'));
  put('intro.coordinates', en ? 'LEVEL 02 / THE LAST CHECKOUT' : 'NIVEAU 02 / LE DERNIER PANIER');
  const caption = document.querySelector('.scene-caption .coordinates');
  if (caption && !levelReady) caption.textContent = world.root.userData.artError ? (en ? 'Artwork unavailable · reload to retry' : 'Décor indisponible · recharge pour réessayer') : (en ? 'Loading supermarket…' : 'Chargement du supermarché…');
}
refreshLevelLabels();
const extraction = createExtraction(scene);
const flashlight = new THREE.SpotLight(0xffe3b0, 7, 26, .45, .6, 1);
flashlight.position.set(0, -.1, 0);
flashlight.target.position.set(0, 0, -15);
camera.add(flashlight, flashlight.target);
flashlight.visible = false;
const muzzleLight = new THREE.PointLight(0xffc76b, 0, 5, 2);
camera.add(muzzleLight);
// Always present (intensity 0 at rest) so a teammate's flash never recompiles shaders.
const teamMuzzleLight = new THREE.PointLight(0xffc76b, 0, 7, 2);
scene.add(teamMuzzleLight);
let teamMuzzleUntil = 0;
let gun = null;
let gunType = null, gunId = null;
let secondaryGun = null, secondaryGunId = null, secondaryFiring = false, secondaryShotAt = null, secondarySpinRequested = false;
let dualCycleSince = null, dualCycleConsumed = false;
let websocket = null;
let myId = null;
let room = null;
let snapshot = null;
let inGame = false;
let joining = false;
let intentionalClose = false;
let joinMode = false;
let pendingPracticeEntry = false;
let yaw = 0, pitch = 0;
let aimReady = false;
let pointerLocked = false;
let inputFocused = document.hasFocus?.() ?? true;
function controllerStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
let controllerSettings = readControllerSettings(controllerStorage());
const controller = createGamepadControls(controllerSettings), aimAssist = createAimAssist();
let controllerState = null, controllerPlaying = false, controllerCrouched = false, activePad = null;
let controllerMenuDirection = null, controllerMenuRepeatAt = 0;
let controllerStatusKey = '';
let assistRaycaster = null;
const aimDiagnostics = createAimDiagnostics();
let lastAimSample = -Infinity;
let firing = false;
let secondaryHeld = false, meleeSuppressed = true, meleeRequestUntil = -Infinity;
let scoped = false;
let nextScopeDistanceAt = 0, scopeRaycaster = null;
let supplyMenu = null;
let supplyMenuVisualKey = '';
const meleeAnimations = new Map(), meleeSeen = new Map();
// Velocities between snapshots, for the melee audio's hit prediction.
const zombieMotion = new Map(), playerMotion = new Map();
let fireAudioWeapon = null, triggerSoundPlayed = false, reloadAudioConfirmed = false, reloadAudioRequested = false;
let reloadSoundWeapon = null, reloadSoundConfirmed = false, reloadSoundCancelled = false, secondaryReloadAudio = null;
let minigunSpinRequested = false, minigunSpinConfirmed = false;
let sensitivity = .0018;
// Raw movement by default: without it, Chromium on Windows re-centres the
// hidden cursor and can report that warp as one huge mouse delta.
let rawMouse = readRawMouse(controllerStorage()), rawMouseUnsupported = false;
let mouseLockMode = null, mouseLockRequest = 0, ignoredLockErrors = 0;
let lastMouseMoveTime = -Infinity, droppedMouseSpikes = 0;
let muted = false;
let volume = .55;
let lastInput = 0, lastShot = -10, lastInteract = 0;
let nextMinigunShotAt = null, nextShotAt = null;
let recoil = 0, muzzleUntil = 0;
let cameraRecoil = 0;
let cameraSmoothing = { ...CAMERA_SMOOTHING_DEFAULTS };
try { cameraSmoothing = normalizeCameraSmoothing(JSON.parse(localStorage.getItem(CAMERA_SMOOTHING_KEY))); } catch {}
let lastHealth = 100;
let lastPhase = null;
let lastHostId = null;
let lastRoomPaused = false, pauseRequestTarget = null;
// Simulation snapshots stop advancing during a team pause. Keep the visual
// clock on the same stopped timeline, including effects and melee windups.
let visualTime = 0;
// Flight follows server time even while local hit-stop slows cosmetic effects.
let ballisticTime = 0;
function visualSeconds() { return visualTime; }
let bannerUntil = 0, toastUntil = 0, damageUntil = 0;
let lastFrame = performance.now();
let previousTime = 0;
let cameraReady = false;
let shareOrigin = location.origin;
let connectionDeadline = null;
let snapshotReceivedAt = performance.now();
let restartRequested = false;
// Manual save (Escape menu) and load (home menu): one request at a time.
let saveRequested = false, pendingLoad = null, loadTimer = null, loadDeadline = null;
let lastOutsideHurtAt = -Infinity;
let nextZombieGroanAt = 0;
let pickupNoticeUntil = 0, pickupPoints = 0, pickupNoticeKind = null;
let reserveVisualKey = '';
let groundInteractHeld = false;
let reviveHeld = false; // E / RB pressed next to a downed teammate and still held
const keys = new Set();
// C avoids reserved browser shortcuts such as Ctrl+W; keep Ctrl as a legacy alias.
const CROUCH_KEYS = ['KeyC', 'ControlLeft', 'ControlRight'];
const zombieMeshes = new Map();
const playerMeshes = new Map();
const pickupMeshes = new Map(), pickupPoint = new THREE.Vector3();
const grenadeMeshes = new Map();
const flameStreams = new Map();
const explosions = [];
const effects = [];
const pendingExplosionSounds = [];
const tracers = [];
const ballisticTracers = new Map(), ballisticShotGroups = new Map(), ballisticHitSounds = new Map();
const corpses = [];
// Raider presentation: four pooled incoming-fire arcs keyed by raider, the
// squad direction pointer, the stand's drill hit count and live tracer bound.
const DAMAGE_ARC_MS = 900, RAID_POINTER_MS = 4000, MAX_TRACERS = 160;
const damageArcs = [0, 1, 2, 3].map(index => ({ index, raiderId: null, fromX: 0, fromZ: 0, until: 0 }));
// Friendly-fire toasts for the victim, at most one per 2 s and shooter.
// Cleared with the room (clearRaidPresentation).
const friendlyHurtToasts = new Map();
// The shooter's callout under the crosshair (owner, 23 October: « on voit
// qu'on tire sur quelqu'un… hey, tire pas sur tes copains »): a hit says so
// at most every 2.5 s with a rotating line, a down at once and longer.
const FRIENDLY_CALLOUT = Object.freeze({ hit: 1800, down: 2800, gap: 2500, lines: 3 });
let friendlyCalloutUntil = 0, friendlyCalloutAt = -Infinity, friendlyCalloutLine = 0;
let raidPointer = null, lastRaiderHurtAt = -Infinity, drillHits = 0, raiderProgramsReady = false;
// beginWave announces a fuel mission just before its 'wave' event; the next
// 'wave' event reads and clears this, so a raid warning never hides it.
let fuelMissionWave = null;
const localizedTexts = new Map();
function writeText(element, source) {
  if (typeof source === 'function') { localizedTexts.set(element, source); element.textContent = source(); }
  else if (typeof source === 'string') { localizedTexts.set(element, source); element.textContent = translateMessage(source); }
  else element.textContent = source;
}
function updateSoundButton() {
  $('sound-toggle').innerHTML = `${muted ? '♪' : '♫'} <span>${t(muted ? 'sound.off' : 'sound.on')}</span>`;
  $('sound-toggle').setAttribute('aria-label', t(muted ? 'sound.unmute' : 'sound.mute'));
}
function controlsCaptured() { return pointerLocked || (controllerPlaying && controllerState?.connected && controllerState.supported && inputFocused && !document.hidden && document.hasFocus?.() !== false); }
function syncControllerSettings() {
  for (const id of ['input-mode', 'input-mode-start']) $(id).value = controllerSettings.mode;
  $('gamepad-sensitivity').value = String(controllerSettings.sensitivity);
  $('gamepad-deadzone').value = String(controllerSettings.deadzone);
  $('gamepad-aim-assist').value = controllerSettings.aimAssist;
  $('gamepad-invert-y').checked = controllerSettings.invertY;
  $('gamepad-rumble').value = controllerSettings.rumble;
  $('gamepad-sensitivity-value').textContent = `${Math.round(controllerSettings.sensitivity)}°/s`;
  $('gamepad-deadzone-value').textContent = `${Math.round(controllerSettings.deadzone * 100)} %`;
}
function changeControllerSettings(patch) {
  controllerSettings = saveControllerSettings(controllerStorage(), { ...controllerSettings, ...patch });
  controller.configure(controllerSettings); syncControllerSettings();
  if (inGame) { controllerPlaying = false; resetInput(); document.exitPointerLock?.(); showPause(); }
}
function controllerMenuRoot() {
  return ['supply-menu', 'pause', 'lobby', 'menu', 'gameover'].map($).find(node => !node.hidden) ?? null;
}
function controllerMenuInput(state, now) {
  const root = controllerMenuRoot(); if (!root) return;
  if (state.pressed.umbrella || state.pressed.menu) {
    if (supplyMenu) closeSupplyMenu();
    else if (root === $('pause') && !$('resume-button').disabled) $('resume-button').click();
    return;
  }
  const direction = state.held.radar ? 'up' : state.held.drop ? 'down' : state.held.previous ? 'left' : state.held.next ? 'right' : null;
  if (direction && (direction !== controllerMenuDirection || now >= controllerMenuRepeatAt)) {
    navigateControllerMenu(root, direction, document); controllerMenuRepeatAt = now + (direction === controllerMenuDirection ? 140 : 360);
  }
  controllerMenuDirection = direction;
  if (state.pressed.jump) navigateControllerMenu(root, 'confirm', document);
}
function assistBlocked(eye, point) {
  if (!THREE.Raycaster) return true;
  assistRaycaster ??= new THREE.Raycaster();
  const origin = new THREE.Vector3(eye.x, eye.y, eye.z), direction = new THREE.Vector3(point.x - eye.x, point.y - eye.y, point.z - eye.z);
  const length = direction.length(); if (length < .05) return false;
  const blockers = [...(world.rayBlockers ?? [])];
  for (const door of world.doors?.values?.() ?? []) {
    if (door.userData.seal?.visible) blockers.push(door.userData.wall);
    else for (const board of door.userData.boards ?? []) if (board.visible) blockers.push(board);
  }
  assistRaycaster.set(origin, direction.normalize()); assistRaycaster.far = length - .03;
  return assistRaycaster.intersectObjects(blockers.filter(Boolean), false).length > 0;
}
function cycleCarriedWeapon(direction = 1) {
  const weapons = carriedWeapons(), current = weapons.findIndex(entry => weaponSlotId(entry) === selectedWeaponId());
  const next = (current + direction + weapons.length) % weapons.length;
  if (weapons[next]) switchWeapon(weaponSlotId(weapons[next]));
}
function controllerAction(action) {
  const self = myPlayer(); if (!self?.alive || self.waiting || self.downed || !controlsAvailable()) return;
  if (action === 'reload' && !meleeProfile()) {
    setScope(false); fireAudioWeapon = null; reloadAudioRequested = true; reloadSoundCancelled = false;
    stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); flameStreams.get(myId)?.stop(); send({ type: 'reload' });
  } else if (action === 'umbrella' && snapshot.expedition?.enabled) {
    setScope(false); firing = false; fireAudioWeapon = null; cancelMelee(); stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); flameStreams.get(myId)?.stop();
    send({ type: 'umbrella', open: !self.umbrella?.open });
  } else if (action === 'drop' && self.weapon) {
    setScope(false); cancelMelee(); firing = false; fireAudioWeapon = null; reloadAudioRequested = false;
    stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); stopReloadAudio(true); stopSecondaryReloadAudio(); send({ type: 'drop-weapon' });
  } else if (action === 'radar' && self.reviveKit === true && reviveTarget(self)) useReviveKit(); // next to a downed teammate, D-pad up uses the kit on them
  else if (action === 'radar') dropCoins(); // otherwise D-pad up gives 100 coins
  else if (action === 'grenade' && !self.umbrella?.open && self.grenades > 0 && !(self.throwLeft > 0)) { send(inputMessage()); send({ type: 'grenade' }); }
  else if (action === 'interact') pressInteract(self, performance.now());
  else if (action === 'cycle' || action === 'next') cycleCarriedWeapon(1);
  else if (action === 'previous') cycleCarriedWeapon(-1);
}
function updateController(now, delta) {
  let pad = null;
  try { pad = [...(navigator.getGamepads?.() ?? [])].find(item => item?.connected && item.mapping === 'standard') ?? null; } catch {}
  activePad = pad;
  const enabled = controllerSettings.mode !== 'mouse' && inputFocused && !document.hidden && document.hasFocus?.() !== false;
  controllerState = controller.update(pad, delta, { enabled });
  const state = controllerState;
  const statusKey = `${getLanguage()}:${state.connected}:${state.supported}:${controllerPlaying}:${state.label}`;
  if (statusKey !== controllerStatusKey) {
    $('gamepad-status').textContent = t(state.connected && state.supported ? controllerPlaying ? 'gamepad.active' : 'gamepad.connected' : 'gamepad.notConnected', { name: state.label ?? '' });
    controllerStatusKey = statusKey;
  }
  if (!state.connected || !state.supported || !enabled) {
    if (controllerPlaying) { controllerPlaying = false; resetInput(); showPause(t('gamepad.disconnected')); }
    return;
  }
  if (!controllerPlaying || !$('pause').hidden || supplyMenu || !inGame || myPlayer()?.waiting) { controllerMenuInput(state, now); return; }
  if (state.pressed.view && voteNextWave()) return; // during the break, View calls the next wave
  if (state.pressed.menu || state.pressed.view) { document.exitPointerLock?.(); showPause(); $('resume-button').focus(); return; }
  // Down, RB gets you up with your revive kit.
  if (myPlayer()?.alive && myPlayer()?.downed && state.pressed.interact && controlsAvailable()) { useReviveKit(); return; }
  if (!controlsAvailable() || !myPlayer()?.alive || myPlayer()?.downed) return;
  const self = myPlayer();
  if (state.pressed.crouch) controllerCrouched = !controllerCrouched;
  const eye = cameraReady ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
    : { x: self.x, y: self.y + (self.eyeHeight ?? PLAYER_POSTURE.standingEye), z: self.z };
  const candidates = (snapshot.zombies ?? []).flatMap(enemy => {
    const mesh = zombieMeshes.get(enemy.id); if (!mesh || mesh.visible === false) return [];
    const profile = enemyProfile(enemy);
    const crouch = enemy.kind === 'raider' ? THREE.MathUtils.clamp((mesh.userData.crouch ?? (enemy.crouched ? mesh.userData.crouchDepth ?? 1 : 0)) / (mesh.userData.crouchDepth || 1), 0, 1) : 0;
    const height = profile.height - (profile.height - (profile.crouchHeight ?? profile.height)) * crouch;
    return [{ ...enemy, aimPoint: { x: mesh.position.x, y: mesh.position.y + height * (enemy.scale ?? 1) * .67, z: mesh.position.z } }];
  });
  if (self.dualWield) secondaryFiring = state.held.alternate && !self.umbrella?.open;
  else if (scopeControlsActive(self)) setScope(state.held.alternate);
  const scopedScale = scoped ? SNIPER_FOV / NORMAL_FOV : 1;
  const aim = aimAssist.update({ eye, yaw, pitch, lookX: state.lookX, lookY: state.lookY,
    yawDelta: state.yawDelta * scopedScale, pitchDelta: state.pitchDelta * scopedScale, dt: delta,
    candidates, level: scoped && ['normal', 'strong'].includes(controllerSettings.aimAssist) ? 'light' : controllerSettings.aimAssist,
    inputSource: 'gamepad', isBlocked: (_, point) => assistBlocked(eye, point) });
  yaw += aim.yawDelta; pitch = THREE.MathUtils.clamp(pitch + aim.pitchDelta, -1.48, 1.48);
  if (meleeControlsActive(self) && state.pressed.alternate) { firing = false; requestMelee('heavy'); }
  if (state.pressed.fire && !self.umbrella?.open) { firing = true; fireAudioWeapon = self.reloading ? null : self.weapon; triggerSoundPlayed = false; reloadAudioRequested = false; reloadSoundCancelled = false; updateMinigunSpin(); if (meleeProfile()) requestMelee('light'); }
  if (state.released.fire || !state.held.fire) { firing = false; stopMinigunSpin(); releaseHandFire(); }
  if (characterStats(self).dualWield) {
    if (state.pressed.cycle) { dualCycleSince = now; dualCycleConsumed = false; }
    if (state.held.cycle && dualCycleSince !== null && now - dualCycleSince >= 550 && !dualCycleConsumed) { toggleDual(); dualCycleConsumed = true; }
    if (state.released.cycle && dualCycleSince !== null) { if (!dualCycleConsumed) cycleCarriedWeapon(1); dualCycleSince = null; }
  }
  for (const action of ['reload', 'umbrella', 'drop', 'radar', 'grenade', 'interact', 'cycle', 'previous', 'next']) if (state.pressed[action] && !(action === 'cycle' && characterStats(self).dualWield)) controllerAction(action);
  if (!state.held.interact) { groundInteractHeld = false; reviveHeld = false; }
}
function refreshPracticeControls() {
  const practice = snapshot?.practice === true;
  $('practice-controls').hidden = !practice;
  document.body.classList.toggle('practice', practice);
  const select = $('practice-weapon'), value = select.value || 'assault';
  const options = Object.keys(names).map(weapon => {
    const option = document.createElement('option'); option.value = weapon; option.textContent = weaponLabel(weapon); return option;
  });
  select.replaceChildren(...options); select.value = value;
}
function practiceAction(action, weapon) {
  if (!inGame || !controlsAvailable() || snapshot?.practice !== true || !myPlayer()?.alive) return;
  resetInput();
  send({ type: 'practice', action, ...(action === 'weapon' ? { weapon } : {}) });
}
function meleeProfile(weapon = myPlayer()?.weapon) { return MELEE_WEAPONS[weapon] ?? null; }
function meleeControlsActive(self=myPlayer()) {
  return inGame && controlsCaptured() && $('pause').hidden && !supplyMenu && !document.hidden && controlsAvailable() && self?.alive && !self.downed && !self.umbrella?.open && meleeProfile(self.weapon) && ['countdown','wave','intermission'].includes(snapshot?.phase);
}
function cancelMelee(sendCancel=true) {
  if(sendCancel && (meleeProfile()||meleeAnimations.has(myId))) send({type:'melee-cancel'});
  meleeSuppressed=true;secondaryHeld=false;meleeAnimations.delete(myId);sound.releaseMelee?.(myId);
}
function requestMelee(attack) {
  const self=myPlayer(),now=visualSeconds();
  const profile=meleeProfile(self?.weapon)?.[attack];
  if(!profile||!meleeControlsActive(self)||self.meleeReadyLeft>0||now<meleeRequestUntil)return false;
  meleeSuppressed=false;meleeRequestUntil=now+profile.duration;
  send(inputMessage());send({type:'shoot',attack});return true;
}
function scopeControlsActive(self = myPlayer()) {
  return inGame && controlsCaptured() && !supplyMenu && $('pause').hidden && !document.hidden && controlsAvailable() && self?.alive && !self.downed && !self.reloading && !self.umbrella?.open && !self.dualWield && self.weapon === 'sniper' && ['countdown','wave','intermission'].includes(snapshot?.phase);
}
function setScope(enabled) {
  const was = scoped;
  scoped = Boolean(enabled && scopeControlsActive());
  // Only a scope change owns the FOV; otherwise the sprint easing keeps it.
  const fov = scoped ? SNIPER_FOV : NORMAL_FOV;
  if ((scoped || was !== scoped) && camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix?.(); }
  $('sniper-scope').hidden = !scoped;
  document.body.classList.toggle('scoped', scoped);
  if (!scoped || !was) { nextScopeDistanceAt = 0; $('scope-distance').textContent = '—'; }
}
function scopeStaticDistance(origin, direction, maxDistance) {
  // The cabin's exterior has a flat physical ground. Its higher floors,
  // roof, furniture and current barricade boards are real ray blockers.
  let distance = !HAS_SPACE && direction.y < -1e-9 && origin.y >= 0 ? -origin.y / direction.y : Infinity;
  if (!THREE.Raycaster) return distance;
  scopeRaycaster ??= new THREE.Raycaster();
  const blockers = [...(world.rayBlockers ?? [])];
  for (const door of world.doors?.values?.() ?? []) {
    if (door.userData.seal?.visible) blockers.push(door.userData.wall);
    else for (const board of door.userData.boards ?? []) if (board.visible) blockers.push(board);
  }
  world.root?.updateMatrixWorld?.(true);
  scopeRaycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(direction.x, direction.y, direction.z));
  scopeRaycaster.near = 0; scopeRaycaster.far = maxDistance;
  const hit = scopeRaycaster.intersectObjects(blockers.filter(Boolean), false)[0];
  if (hit) distance = Math.min(distance, hit.distance);
  return distance;
}
function refreshScopeDistance(now) {
  if (!scoped || now < nextScopeDistanceAt) return;
  nextScopeDistanceAt = now + 100;
  const enemies = (snapshot?.zombies ?? []).flatMap(enemy => {
    const mesh = zombieMeshes.get(enemy.id);
    return mesh && mesh.visible !== false ? [{ ...enemy, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }] : [];
  });
  // Use the centre of the displayed view, including cosmetic camera pitch,
  // and the interpolated bodies actually visible through the reticle.
  const distance = scopeTargetDistance({ origin: camera.position, direction: meleeDirection(camera.rotation.y, camera.rotation.x),
    enemies, raycast: scopeStaticDistance, maxDistance: Math.min(camera.far ?? 130, ballisticRange('sniper', camera.far ?? 130)) });
  $('scope-distance').textContent = distance === null ? '—' : t('sniper.distanceValue', { metres: Math.round(distance) });
}
// The server's own targeting, leaning towards a hit, from the swinging
// survivor's latest snapshot pose (with the local aim) and the bodies of the
// latest snapshot, extrapolated to the server's contact time: rendered bodies
// lag behind. A predicted miss keeps the recorded impact silent; without a
// pose to predict from, the take plays whole.
function meleeWillHit(id,weapon,attack,contact) {
  const profile=meleeProfile(weapon)?.[attack],player=snapshot?.players.find(player=>player.id===id),local=id===myId;
  if(!profile||!player)return true;
  const motion=(map,id)=>{const item=map.get(id);return item?{vx:item.vx,vz:item.vz}:{};};
  const eye={x:player.x,y:player.y+(Number.isFinite(player.eyeHeight)?player.eyeHeight:PLAYER_POSTURE.standingEye),z:player.z,...motion(playerMotion,id)};
  // A body a kill event already removed can no longer be struck.
  const zombies=(snapshot.zombies??[]).filter(zombie=>zombieMeshes.has(zombie.id)).map(zombie=>({...zombie,...motion(zombieMotion,zombie.id)}));
  const doors=sightDoors(snapshot.doors);
  // With friendly fire on, a swing that will land on a teammate keeps its
  // impact sound; off, teammates are not targets (unchanged behaviour).
  const friendly=snapshot.friendlyFire==='reduced'||snapshot.friendlyFire==='full';
  const survivors=friendly?snapshot.players.filter(mate=>mate.alive&&!mate.downed&&!mate.waiting&&mate.id!==id).map(mate=>({...mate,...motion(playerMotion,mate.id)})):[];
  return meleeWillLand(eye,meleeDirection(local?yaw:player.yaw,local?pitch:player.pitch),profile,zombies,(from,point)=>sightClear(from,point,doors),contact-Number(snapshot.time),survivors);
}
function meleeAnimation(id,now=visualSeconds()) {
  const animation=meleeAnimations.get(id);
  if(!animation)return null;
  if(now-animation.startedAt>=animation.duration){meleeAnimations.delete(id);return null;}
  return {weapon:animation.weapon,attack:animation.attack,elapsed:Math.max(0,now-animation.startedAt),windup:animation.windup,duration:animation.duration};
}
// What this PC shows, whether the pack is in place, and whether it failed
// (Famille then). A start asked for while it loads waits for it; a load that
// never ends counts as failed after AMBIANCE_TIMEOUT_MS. Declared before the
// infected guide, which reads it when the page loads.
const AMBIANCE_TIMEOUT_MS = 20000;
let ambianceWanted = 'family', ambianceReady = true, ambianceFailed = false, ambianceEntryPending = false, ambianceRequest = 0;
function refreshEnemyGuide() {
  const container = $('enemy-guide-families');
  if (!container) return;
  // Frisson's own markers (art/frisson/MARKERS.md) once the pack is on this
  // PC, never from the room alone: a PC kept on Famille in a Frisson room
  // shows the Famille words (art/frisson/UI-SOUND.md section 0.7). The swatch
  // and the families stay. A string compare, unless what is shown changes.
  const frisson = isFrissonLike(ambianceWanted) && ambianceReady && !ambianceFailed;
  const key = `${getLanguage()}:${frisson}`;
  if (container.dataset.renderKey === key) return;
  container.dataset.renderKey = key;
  const rows = ENEMY_HEALTH.map(maxHp => {
    const family = enemyAppearance({ kind: 'walker', maxHp });
    const row = document.createElement('div'); row.className = 'enemy-guide-family'; row.dataset.family = family.id;
    const swatch = document.createElement('span'); swatch.className = 'enemy-guide-swatch'; swatch.style.backgroundColor = `#${family.color.toString(16).padStart(6, '0')}`; swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('strong'); label.textContent = family.label[getLanguage()];
    const health = document.createElement('span'); health.className = 'enemy-guide-health'; health.textContent = t('enemyGuide.health', { hp: maxHp });
    const marker = document.createElement('small'); marker.textContent = t(`enemyGuide.${frisson ? 'frisson.' : ''}${family.marker}`);
    row.append(swatch, label, health, marker); return row;
  });
  container.replaceChildren(...rows);
  $('enemy-guide-hulks').textContent = t(frisson ? 'enemyGuide.frisson.hulks' : 'enemyGuide.hulks', { health: BRUTE_HEALTH.join(' / ') });
}
window.addEventListener('deadwood-language-change', () => {
  translateDom();
  refreshLevelLabels();
  refreshMapLabels();
  refreshEnemyGuide();
  for (const [element, source] of localizedTexts) element.textContent = typeof source === 'function' ? source() : translateMessage(source);
  if (snapshot && myId) {
    playerList($('lobby-players')); playerList($('results-list'), true); refreshTeam(); renderCompanions(); renderCompanions('-results'); renderAmbiance(); renderAmbiance('-results');
    renderCharacterChoice(); renderCharacterChoice('-results');
    refreshAmmunition(myPlayer());
    refreshSurvivorSheet();
  }
  characterPicker.render();
  world.setLanguage?.(getLanguage());
  refreshPracticeControls();
  refreshPauseControls();
  refreshGraphicsQualityStatus();
  renderHomeAmbiance();
  if (!$('load-panel').hidden) renderLoadPanel();
  if (snapshot && myId) refreshSeatClaims();
  if (!$('pause').hidden) showPause();
  refreshRadarMap(performance.now(), true);
  if (supplyMenu) { supplyMenuVisualKey = ''; refreshSupplyMenu(); }
  updateSoundButton();
});
refreshEnemyGuide();
refreshPracticeControls();

try { $('player-name').value = localStorage.getItem('deadwood-name') || ''; } catch {}
// The optional character sheet (character-sheet-ui.js): chosen and edited on
// the home screen, changed again in the lobby or the results before a night.
const characterPicker = createCharacterPicker({ document, storage: (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), t, byId: $, onChange: () => sendCharacterSheet() });
// Accepted before a night (lobby, results) or while waiting to join one;
// never at the weapon stand, once in the night or in a paused room (both
// servers drop a paused room's other messages), nor for a seat taken back in
// a loaded night, which plays its saved character until that night ends.
// The server checks again.
function characterChangeAllowed(state = snapshot, self = myPlayer()) {
  return Boolean(state && self && state.practice !== true && state.paused !== true && !heldSeat(state, self) && (['lobby', 'gameover', 'victory'].includes(state.phase) || self.waiting === true));
}
function heldSeat(state = snapshot, self = myPlayer()) { return Boolean(self && Array.isArray(state?.seatHolders) && state.seatHolders.includes(self.id)); }
// A change made here stays pending until the server's snapshot shows it.
let characterSent = '', characterPending = false;
// A seat's saved character this page took as its own (adopt), to be named
// to the loader, who goes straight from the lobby into the restored night.
let seatAdopted = null;
function sendCharacterSheet() {
  characterPending = true;
  if (!myId || !characterChangeAllowed()) return;
  const sheet = characterPicker.sheet(); characterSent = JSON.stringify(sheet);
  send({ type: 'sheet', sheet });
}
// A change the server has not taken (sent just as the night began or the host
// paused, say) is sent once more as soon as changes are allowed again, so the
// character that plays ends up the one shown in the select.
function syncCharacterSheet() {
  const character = myPlayer()?.character;
  // A seat taken back in a loaded night plays its saved character: this page
  // takes it as its own choice, so the select shows it and nothing switches
  // when the night ends (a custom one only the save knows stays offered).
  if (character && heldSeat() && characterPicker.adopt(character)) seatAdopted = character;
  if (!characterPending || !character) return;
  if (characterPicker.applied(character)) { characterPending = false; return; }
  if (!characterChangeAllowed()) { characterSent = ''; return; }
  if (characterSent !== JSON.stringify(characterPicker.sheet())) sendCharacterSheet();
}
function renderCharacterChoice(suffix = '') {
  const root = $(`character-choice${suffix}`);
  if (!root || !snapshot) return;
  root.hidden = snapshot.practice === true;
  if (!root.hidden) characterPicker.renderChoice($(`character-choice-select${suffix}`), $(`character-choice-detail${suffix}`),
    { editable: characterChangeAllowed(), character: myPlayer()?.character, locked: snapshot.paused === true ? 'sheet.lobbyPaused' : 'sheet.lobbyLocked', seat: heldSeat() });
}
// «Nom · Le Bûcheron» and its stat chips in the lobby and the results. The
// companions always play the standard sheet and keep their own badge.
function characterBadge(player, element) {
  if (player.companion === true || !player.character) return;
  const badge = document.createElement('span'); badge.className = 'character-badge';
  badge.textContent = ` · ${characterLabel(player.character, t)}`;
  const chips = characterChips(player.character, t);
  if (chips) { const small = document.createElement('small'); small.className = 'character-chips'; small.textContent = chips; badge.append(small); }
  element.append(badge);
}
// The server build this page was loaded with; a different one on joining
// means the game was updated since and this page must be reloaded.
let pageBuild = null;
fetch(mapContext.endpoint('/version.json')).then(r => r.json()).then(data => { if (typeof data?.build === 'string') pageBuild = data.build; }).catch(() => {});
fetch(mapContext.endpoint('/network.json')).then(r => r.json()).then(data => {
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && data.urls?.length) shareOrigin = data.urls[0];
  refreshShareAddress();
}).catch(() => {});

function updateConnection(connected, text) {
  $('connection-dot').classList.toggle('offline', !connected);
  writeText($('connection-label'), text);
}
// The end of a wave, in one card: what was refilled, what to do, and what
// you did (score and kills since the wave began).
function showWaveCard() {
  const self = myPlayer(), wave = String(snapshot?.wave ?? 1).padStart(2, '0');
  const score = Math.max(0, Math.round(self?.waveScore ?? 0)), kills = Math.max(0, Math.round(self?.waveKills ?? 0));
  // An older server without per-wave totals: the card keeps its checklist only.
  $('wave-card-stats').hidden = !Number.isFinite(self?.waveScore);
  writeText($('wave-card-title'), () => t('waveCard.title', { wave }));
  writeText($('wave-card-score'), `+${score.toLocaleString(getLanguage() === 'en' ? 'en-US' : 'fr-FR')}`);
  writeText($('wave-card-kills'), () => kills === 1 ? t('waveCard.kill') : t('waveCard.kills', { count: kills }));
  $('wave-card').hidden = false; waveCardUntil = performance.now() + 6000;
  renderReviveLines(performance.now());
}
function hideWaveCard() { $('wave-card').hidden = true; waveCardUntil = 0; settleReviveItems(true); }
const scoreText = value => Math.max(0, Math.round(value)).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'fr-FR');
// What the score counter shows: the score, minus the bonuses still on their way.
function heldReviveScore() { return reviveItems.reduce((sum, item) => sum + (item.settled ? 0 : item.amount), 0); }
function writeScore(self = myPlayer()) {
  if (!self) return;
  const held = heldReviveScore(), score = self.score ?? 0;
  writeText($('score-value'), scoreText(held > 0 ? Math.max(reviveScoreFloor, score - held) : score));
}
function reviveLineText(item, shown) {
  return () => item.more ? t(item.more === 1 ? 'waveCard.moreRevive' : 'waveCard.moreRevives', { count: item.more, points: scoreText(shown()) })
    : t('waveCard.revive', { name: item.name, ofName: frenchOf(item.name), points: scoreText(shown()) });
}
// One line per bonus under the wave's total, four at most and then a summary.
function renderReviveLines(now) {
  const box = $('wave-card-revives');
  if (!box) return;
  box.replaceChildren(); box.hidden = !reviveItems.length;
  reviveItems.forEach((item, index) => {
    const line = document.createElement('div');
    line.className = 'wave-card-revive';
    item.element = line; item.startAt ??= now + 450 + index * REVIVE_STAGGER_MS;
    writeText(line, reviveLineText(item, () => item.shown ?? 0));
    box.append(line);
  });
}
// Counting up, then the flight; whatever never flies is given to the counter.
function updateReviveLines(now) {
  for (const item of reviveItems) {
    if (!item.element || item.flying || item.settled || !Number.isFinite(item.startAt) || $('wave-card').hidden) continue;
    const shown = reviveCountUp(item.amount, now - item.startAt);
    if (shown !== item.shown) { item.shown = shown; writeText(item.element, reviveLineText(item, () => item.shown)); }
    if (now - item.startAt < REVIVE_COUNT_MS) continue;
    item.flying = true;
    const rect = item.element.getBoundingClientRect?.();
    const x = rect && rect.width > 0 ? rect.left + rect.width / 2 : innerWidth / 2, y = rect && rect.height > 0 ? rect.top + rect.height / 2 : innerHeight - 150;
    const settle = () => { item.settled = true; writeScore(); };
    if (!feedback.score(item.amount, { x, y, bonus: true, label: `+${scoreText(item.amount)}`, onDone: settle })) settle();
  }
}
function settleReviveItems(force = false) {
  if (!reviveItems.length || (!force && performance.now() < reviveAwaitUntil)) return;
  let changed = false;
  for (const item of reviveItems) if (!item.flying && !item.settled) { item.settled = true; changed = true; }
  if (reviveItems.every(item => item.settled)) reviveItems = [];
  if (changed) writeScore();
}
// The server pays revive credits at the end of a wave, a victory or a game
// over. The revived survivor is told what their teammate earned through them.
function onReviveBonus(event) {
  const lines = reviveToastLines(event, myId);
  if (lines.length) toast(() => lines.map(line => t(line.floor ? 'revive.bonusToastFloor' : 'revive.bonusToast', { name: line.name, points: scoreText(line.amount) })).join(' · '), 7);
  if (event.reason !== 'wave') return;
  const items = reviveCardItems(event, myId);
  if (!items.length) return;
  settleReviveItems(true);
  reviveItems = items; reviveAwaitUntil = performance.now() + 2500; reviveScoreFloor = Math.round(myPlayer()?.score ?? 0);
  writeScore();
  if (!$('wave-card').hidden) renderReviveLines(performance.now());
}
// The interaction plaque sits by what it is about (a rack, a barricade, a
// weapon on the ground, a teammate), never over the crosshair. The code that
// chooses the prompt's text records its target, so both always agree.
let interactionTarget = null;
const plaquePoint = new THREE.Vector3();
function aimInteraction(x, y, z) { interactionTarget = [x, y, z].every(Number.isFinite) ? { x, y, z } : null; }
// A wall fixture: just below it, a little into the room.
function aimFixture(item, height) { const facing = item.facing ?? 0; aimInteraction(item.x + Math.sin(facing) * .3, (item.y ?? 0) + height, item.z + Math.cos(facing) * .3); }
function placeInteraction() {
  const plaque = $('interaction');
  if (!plaque || plaque.hidden) return;
  let x = innerWidth / 2, y = innerHeight * .64;
  if (interactionTarget && camera.projectionMatrix && camera.matrixWorldInverse) {
    camera.updateMatrixWorld(); plaquePoint.set(interactionTarget.x, interactionTarget.y, interactionTarget.z).project(camera);
    if (plaquePoint.z < 1 && Math.abs(plaquePoint.x) < .95 && Math.abs(plaquePoint.y) < .95) {
      x = (plaquePoint.x + 1) / 2 * innerWidth; y = (1 - plaquePoint.y) / 2 * innerHeight;
      y = Math.max(innerHeight * .2, Math.min(y, innerHeight * .66));
    }
  }
  const half = (plaque.offsetWidth || 0) / 2 + 12, height = plaque.offsetHeight || 46;
  x = Math.max(half, Math.min(innerWidth - half, x));
  // Above the end-of-wave card while it shows, whatever the screen height.
  const card = $('wave-card');
  if (card && !card.hidden) { const top = card.getBoundingClientRect?.().top; if (Number.isFinite(top) && top > 0) y = Math.min(y, top - height - 10); }
  // Never over the survivor sheet (Tab) either: the plaque steps to its left.
  const sheetBox = survivorSheetRect;
  if (sheetBox && x + half > sheetBox.left && x - half < sheetBox.right && y < sheetBox.bottom && y + height > sheetBox.top) x = Math.max(half, sheetBox.left - half + 8);
  // Never over the crosshair, whatever the plaque's width: just below it.
  const centreX = innerWidth / 2, centreY = innerHeight / 2;
  if (Math.abs(x - centreX) < half + 24 && y < centreY + 34 && y + height > centreY - 34) y = centreY + 34;
  plaque.style.left = `${Math.round(x)}px`; plaque.style.top = `${Math.round(y)}px`;
}
// The break between two waves ends early once every survivor is ready
// (N on the keyboard, View on the controller).
function nextWaveAvailable(self = myPlayer()) {
  return Boolean(inGame && self && !self.waiting && snapshot?.phase === 'intermission' && snapshot.practice !== true && snapshot.paused !== true);
}
// The revive kit (F; on the controller RB while down, D-pad up next to a
// downed teammate): get up in 5 s when down, or revive a downed teammate in
// reach at once. The server checks everything again.
function useReviveKit() {
  const self = myPlayer();
  if (!self?.alive || self.waiting || self.reviveKit !== true || !controlsAvailable()) return false;
  if (!self.downed && !reviveTarget(self)) return false;
  send({ type: 'revive-kit' });
  return true;
}
// The teammate being revived, or else the downed one the server says is in
// reach and in sight (never through a wall or a barricade).
function reviveTarget(self) {
  const downedTeammate = id => id ? snapshot?.players.find(player => player.id === id && player.id !== myId && player.downed && player.alive) ?? null : null;
  const current = downedTeammate(self.revivingId);
  if (current) return current;
  if (self.reviveTargetId !== undefined) return downedTeammate(self.reviveTargetId);
  return snapshot?.players.find(player => player.id !== myId && player.downed && player.alive && Math.hypot(self.x - player.x, self.z - player.z) < REVIVE.startReach && Math.abs(self.y - player.y) < REVIVE.heightReach) ?? null;
}
// One E / RB press. Next to a downed teammate it is a revive: while held, it
// is renewed often and never turns into a purchase, a pickup or a repair.
function pressInteract(self, now) {
  reviveHeld = Boolean(reviveTarget(self));
  groundInteractHeld = !reviveHeld && groundInteractionAvailable(self);
  send(reviveHeld ? { type: 'interact', revive: true } : { type: 'interact' });
  lastInteract = now;
}
// T (or D-pad up without a radar): drop a pack of coins for a teammate.
function dropCoins() {
  const self = myPlayer();
  if (!self?.alive || self.downed || self.waiting || !controlsAvailable() || snapshot?.practice === true) return false;
  if (!(self.points >= COIN_GIFT.amount)) { toast(() => t('coins.notEnough', { amount: COIN_GIFT.amount })); return false; }
  send({ type: 'drop-coins' });
  return true;
}
// The night's difficulty: the host picks it before the night, everyone sees it.
function renderDifficulty(suffix = '') {
  const root = $(`difficulty-picker${suffix}`), options = $(`difficulty-options${suffix}`), detail = $(`difficulty-detail${suffix}`);
  if (!root || !snapshot) return;
  root.hidden = snapshot.practice === true;
  if (!options || root.hidden) return;
  const host = snapshot.hostId === myId, editable = host && ['lobby', 'gameover', 'victory'].includes(snapshot.phase), current = snapshot.difficulty ?? 'normal';
  const key = JSON.stringify([getLanguage(), current, editable]);
  if (root.dataset.renderKey === key) return;
  root.dataset.renderKey = key;
  // Made once, then updated in place: the button focused with the keyboard or
  // the controller keeps the focus when the server confirms the choice.
  if (options.children?.length !== DIFFICULTY_LEVELS.length) options.replaceChildren(...DIFFICULTY_LEVELS.map(level => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.level = level;
    button.onclick = () => { if (snapshot?.hostId === myId && level !== snapshot.difficulty) send({ type: 'difficulty', level }); };
    return button;
  }));
  for (const button of options.children) {
    const level = button.dataset.level;
    button.className = level === current ? 'difficulty-option selected' : 'difficulty-option';
    button.textContent = t(`difficulty.${level}`);
    button.setAttribute('aria-pressed', String(level === current));
    button.disabled = !editable;
  }
  if (detail) detail.textContent = `${t(`difficulty.detail.${current}`)}${editable ? '' : ` ${t('difficulty.hostOnly')}`}`;
}
// Friendly fire between teammates: the host picks it like the difficulty, the
// closed section's summary keeps the level visible while it is not off.
function renderFriendlyFire(suffix = '') {
  const section = $(`advanced-options${suffix}`), options = $(`friendly-fire-options${suffix}`), detail = $(`friendly-fire-detail${suffix}`);
  if (!section || !snapshot) return;
  section.hidden = snapshot.practice === true;
  if (!options || section.hidden) return;
  // The one seam (rules.js friendlyFireAllowed) also decides whether this
  // room's ambiance may choose it at all.
  const host = snapshot.hostId === myId, editable = host && ['lobby', 'gameover', 'victory'].includes(snapshot.phase) && friendlyFireAllowed(ambianceOf(snapshot.ambiance));
  const current = FRIENDLY_FIRE_LEVELS.includes(snapshot.friendlyFire) ? snapshot.friendlyFire : 'off';
  const key = JSON.stringify([getLanguage(), current, editable]);
  if (section.dataset.renderKey === key) return;
  section.dataset.renderKey = key;
  // Made once, then updated in place, like the difficulty buttons: the button
  // focused with the keyboard or the controller keeps the focus.
  if (options.children?.length !== FRIENDLY_FIRE_LEVELS.length) options.replaceChildren(...FRIENDLY_FIRE_LEVELS.map(level => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.level = level;
    button.onclick = () => { if (snapshot?.hostId === myId && level !== (FRIENDLY_FIRE_LEVELS.includes(snapshot.friendlyFire) ? snapshot.friendlyFire : 'off')) send({ type: 'friendly-fire', level }); };
    return button;
  }));
  for (const button of options.children) {
    const level = button.dataset.level;
    button.className = level === current ? 'difficulty-option selected' : 'difficulty-option';
    button.textContent = t(`friendlyFire.${level}`);
    button.setAttribute('aria-pressed', String(level === current));
    button.disabled = !editable;
  }
  if (detail) detail.textContent = `${t(`friendlyFire.detail.${current}`)}${editable ? '' : ` ${t('friendlyFire.hostOnly')}`}`;
  const summary = $(`advanced-summary-detail${suffix}`);
  if (summary) summary.textContent = current === 'off' ? '' : ` · ${t(`friendlyFire.short.${current}`)}`;
}
// The night's ambiance (art/frisson/DESIGN.md). Famille is the game itself;
// Frisson (15+) is a pack that ambiance.js imports only while this PC shows a
// Frisson room. The pack listens through these slots; they stay empty in
// Famille, so every call below is skipped there.
const ambianceHooks = { impact: null, death: null, frame: null, hurt: null };
const FAMILY_LOCK_KEY = 'deadwood-family-lock';
// The home picker starts on Famille at every page load and after every room;
// it is never saved. "Famille uniquement" is saved per browser: that PC never
// loads Frisson, even inside a Frisson room (a child's computer).
let homeAmbiance = 'family';
function readFamilyLock(fallback = false) {
  try { return globalThis.localStorage?.getItem(FAMILY_LOCK_KEY) === '1'; } catch { return fallback; }
}
let familyLocked = readFamilyLock();
// A browser that blocks site data cannot keep the lock: it then holds until
// the page reloads, and the home screen says so under the box.
let familyLockKept = true;
const ambianceWarned = new Set();
function callAmbianceHook(name, event) {
  try { ambianceHooks[name]?.(event); }
  catch (error) { if (!ambianceWarned.has(name)) { ambianceWarned.add(name); console.warn(`Ambiance ${name}:`, error); } }
}
function playAmbianceCue() { callAmbianceHook(this.hook, this.event); }
function ambianceHook(name, event, delay = 0) {
  // On the visual clock, like the effect it goes with.
  if (delay > 0) pendingCues.push({ at: visualSeconds() + delay, play: playAmbianceCue, hook: name, event }); else callAmbianceHook(name, event);
}
// Frames and hits come often: their events are refilled, not made again (a
// hook reads what it needs at once; a hit says itself when it lands).
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
// What took the local survivor's health since the last snapshot, from the
// server's hit events (each comes before the snapshot that shows its drop):
// 'zombie' (a bite), 'raider', 'friendly' (a teammate, or one's own blast),
// 'outside' (the rain) or 'fall'; null when no hit was heard. A bite wins (it
// is a wound), else the blow that took most — a friendly hit counts by loss
// like the others, it is not a bite.
let hurtSource = null, hurtSourceLoss = 0;
function noteHurtSource(event) {
  const loss = Number(event.damage) - (Number(event.absorbed) || 0);
  if (!(loss > 0) || hurtSource === 'zombie') return;
  const source = typeof event.source === 'string' ? event.source : event.zombieId !== undefined && event.zombieId !== null ? 'zombie' : null;
  if (source && (source === 'zombie' || loss > hurtSourceLoss)) { hurtSource = source; hurtSourceLoss = loss; }
}
function renderHomeAmbiance() {
  if (familyLocked) homeAmbiance = 'family';
  for (const id of AMBIANCES) {
    const button = $(`ambiance-${id}`), chosen = homeAmbiance === id;
    button.classList.toggle('selected', chosen); button.setAttribute('aria-pressed', String(chosen));
    // Both Frisson ambiances are out of reach on a PC locked to Famille.
    if (isFrissonLike(id)) { button.disabled = familyLocked; button.title = familyLocked ? t('ambiance.lockedTitle') : ''; }
  }
  $('family-lock').checked = familyLocked;
  $('family-lock-note').hidden = familyLockKept || !familyLocked;
}
// The room's ambiance, read-only in the lobby and the results, with a note
// when this PC shows Famille instead.
const AMBIANCE_LABELS = Object.freeze({ family: 'ambiance.family', 'frisson-leger': 'ambiance.frissonLeger', frisson: 'ambiance.frisson' });
function renderAmbiance(suffix = '') {
  const value = $(`ambiance-value${suffix}`), note = $(`ambiance-note${suffix}`);
  if (!value || !snapshot) return;
  const ambiance = ambianceOf(snapshot.ambiance), frisson = isFrissonLike(ambiance);
  const noteKey = !frisson ? '' : familyLocked ? 'ambiance.lockedNote' : ambianceFailed ? 'ambiance.failedNote' : !ambianceReady ? 'ambiance.loading' : '';
  const key = JSON.stringify([getLanguage(), ambiance, noteKey]);
  if (value.dataset.renderKey === key) return;
  value.dataset.renderKey = key;
  value.textContent = t(AMBIANCE_LABELS[ambiance]);
  value.classList.toggle('frisson', frisson);
  if (note) { note.hidden = !noteKey; note.textContent = noteKey ? t(noteKey) : ''; }
}
function refreshStartButton() {
  if (!snapshot) return;
  $('start-button').disabled = !ambianceReady || !levelReady || pendingLoad !== null;
  writeText($('start-button'), !levelReady ? () => getLanguage() === 'en' ? (IS_FUNFAIR ? 'Loading funfair…' : IS_HOSPITAL ? 'Loading hospital…' : 'Loading supermarket…') : (IS_FUNFAIR ? 'Chargement de la fête foraine…' : IS_HOSPITAL ? 'Chargement de l’hôpital…' : 'Chargement du supermarché…') : !ambianceReady ? () => t('ambiance.loading') : snapshot.practice === true ? () => t('practice.enter') : snapshot.hostId === myId && snapshot.phase === 'lobby' ? 'Lancer la nuit ↗' : 'Entrer dans le refuge ↗');
}
// What the pack is given (DESIGN.md); ambiance.js adds its base, fetchAsset
// and a call-off signal, and fills these hooks only once the pack is in place.
function ambianceContext() {
  return { THREE, world, scene, renderer, camera, sound, feedback, hooks: ambianceHooks, quality: graphics.preset?.id, document };
}
// With every snapshot: a string compare, unless what this PC shows changes.
function syncAmbiance() {
  const wanted = isFrissonLike(snapshot?.ambiance) && !familyLocked ? snapshot.ambiance : 'family';
  if (wanted !== ambianceWanted) setAmbiance(wanted);
}
function setAmbiance(id) {
  const request = ++ambianceRequest;
  // Famille too waits (a moment, unless a Frisson load called off is still landing).
  ambianceWanted = id; ambianceFailed = false; ambianceReady = false;
  refreshStartButton();
  const settled = failed => {
    ambianceFailed = failed; ambianceReady = true;
    if (failed) toast(() => t('ambiance.failed'), 5);
    rebuildZombieMeshes(); restyleWeapons(); restylePickups(); refreshEnemyGuide();
    if (snapshot && myId) { refreshStartButton(); renderAmbiance(); renderAmbiance('-results'); }
    if (ambianceEntryPending) { ambianceEntryPending = false; enterGame(); }
  };
  applyAmbiance(id, isFrissonLike(id) ? ambianceContext() : {}).then(result => {
    // A load called off is off again: a zombie made meanwhile may wear its head.
    if (result.stale) { if (result.undone) { rebuildZombieMeshes(); restyleWeapons(); restylePickups(); } return; }
    if (request === ambianceRequest) settled(result.failed === true);
  });
  // Stuck loading: called off, then Famille on this PC once what it had put
  // in place is off again.
  if (isFrissonLike(id)) setTimeout(() => {
    if (request !== ambianceRequest || ambianceReady) return;
    const fallback = ++ambianceRequest;
    applyAmbiance('family', {}).then(() => { if (fallback === ambianceRequest) settled(true); });
  }, AMBIANCE_TIMEOUT_MS);
}
// "Famille uniquement" changed in another tab: it applies here at once.
function applyFamilyLock(locked) {
  if (locked === familyLocked) return;
  familyLocked = locked; familyLockKept = true; renderHomeAmbiance();
  if (snapshot && myId) { syncAmbiance(); renderAmbiance(); renderAmbiance('-results'); }
}
// Heads and bodies are built with the zombie, and the survivors' look with
// each survivor (art/frisson/SURVIVORS.md): once the pack is on or off, the
// standing zombies are made again and the falling ones go, since the pack
// frees their shared geometry and materials as it comes off (drawn again,
// three would upload them anew and keep them). Teammates already in the
// room are made again too, from the snapshot; raiders only when their look
// changes (one wearing the pack's, or a pack dressing raiders).
function rebuildZombieMeshes() {
  let removed = false;
  const style = getSurvivorStyle(), raidersStyled = Boolean(style?.plan?.({ identity: null, raider: true }));
  const remade = mesh => !mesh.userData.raider || raidersStyled || Boolean(mesh.userData.character);
  for (const [id, mesh] of zombieMeshes) if (remade(mesh)) { scene.remove(mesh); disposeZombie(mesh); zombieMeshes.delete(id); removed = true; }
  for (let i = corpses.length - 1; i >= 0; i--) if (remade(corpses[i])) { const body = corpses.splice(i, 1)[0]; scene.remove(body); disposeZombie(body); }
  for (const [id, mesh] of playerMeshes) if (style || mesh.userData.character) { scene.remove(mesh); setSurvivorSecondaryWeapon(mesh, null); setSurvivorWeapon(mesh, null); playerMeshes.delete(id); removed = true; }
  if (removed && snapshot && myId) syncActors();
}
// The weapons wear the pack's style too (art/frisson/WEAPONS.md), set through
// world.js setWeaponStyle: once an ambiance settles or undoes, the standing
// weapons are made again in the current style. Called next to
// rebuildZombieMeshes, so only when a settle or an undo actually happened;
// with no style it is a plain Famille rebuild of what is on screen.
function restyleWeapons() {
  let removed = false;
  // The first-person gun, without equip()'s side effects (scope, sounds,
  // heat reset): visibility, the bolt's shot time, the rotor angle and a hot
  // minigun's glow carry over.
  if (gun && gunType) {
    const visible = gun.visible, shotAt = gun.userData.shotAt;
    const rotorAngle = gun.userData.rotor?.rotation.z ?? 0;
    const heat = gunType === 'minigun' ? gunHeat.get(myId)?.level(visualSeconds()) ?? 0 : 0;
    camera.remove(gun); gun.userData.heatMaterial?.dispose?.();
    gun = createWeapon(gunType);
    if (shotAt !== undefined) gun.userData.shotAt = shotAt;
    if (gun.userData.rotor) gun.userData.rotor.rotation.z = rotorAngle;
    if (heat > 0) setWeaponHeat(gun, heat);
    applyWeaponViewPose(gun);
    camera.add(gun); gun.visible = visible;
  }
  if (secondaryGun) {
    const type = secondaryGun.userData.type, visible = secondaryGun.visible, shotAt = secondaryGun.userData.shotAt;
    const rotorAngle = secondaryGun.userData.rotor?.rotation.z ?? 0;
    const heat = type === 'minigun' ? gunHeat.get(myId)?.level(visualSeconds()) ?? 0 : 0;
    camera.remove(secondaryGun); secondaryGun.userData.heatMaterial?.dispose?.();
    secondaryGun = createWeapon(type);
    if (shotAt !== undefined) secondaryGun.userData.shotAt = shotAt;
    if (secondaryGun.userData.rotor) secondaryGun.userData.rotor.rotation.z = rotorAngle;
    if (heat > 0) setWeaponHeat(secondaryGun, heat);
    applyWeaponViewPose(secondaryGun); secondaryGun.position.x = -Math.abs(secondaryGun.position.x);
    camera.add(secondaryGun); secondaryGun.visible = visible;
  }
  // rebuildZombieMeshes remade the players wearing a survivor style or
  // character and the raiders a pack dresses; the others keep their mesh, so
  // only their weapon is built again (the dead raiders' too).
  const style = getSurvivorStyle(), raidersStyled = Boolean(style?.plan?.({ identity: null, raider: true }));
  const reequip = mesh => {
    const weapon = mesh.userData.weaponType;
    if (!weapon) return;
    const secondary = mesh.userData.secondaryType;
    if (secondary) setSurvivorSecondaryWeapon(mesh, null);
    setSurvivorWeapon(mesh, null); setSurvivorWeapon(mesh, weapon);
    if (secondary) setSurvivorSecondaryWeapon(mesh, secondary);
  };
  for (const mesh of playerMeshes.values()) if (!(style || mesh.userData.character)) reequip(mesh);
  for (const mesh of zombieMeshes.values()) if (mesh.userData.raider && !raidersStyled && !mesh.userData.character) reequip(mesh);
  for (const mesh of corpses) if (mesh.userData.raider && !raidersStyled && !mesh.userData.character) reequip(mesh);
  // The ground weapons come from the style's template cache: out they go,
  // and syncActors makes them again from the snapshot.
  for (const [id, mesh] of pickupMeshes) if (mesh.userData.kind === 'weapon') { scene.remove(mesh); pickupMeshes.delete(id); removed = true; }
  if (removed && snapshot && myId) syncActors();
}
// The coins and ammo boxes wear the pack's pickups style (art/frisson/PICKUPS.md),
// set through world.js setPickupStyle: as for the ground weapons above, once
// an ambiance settles or undoes the standing ones go so syncActors makes them
// again in the current style, with their fill from the snapshot. A coin
// mid-glide snaps once. With no style it is a plain Famille rebuild.
function restylePickups() {
  let removed = false;
  for (const [id, mesh] of pickupMeshes) if (STYLED_PICKUP_KINDS.includes(mesh.userData.kind)) { scene.remove(mesh); pickupMeshes.delete(id); removed = true; }
  if (removed && snapshot && myId) syncActors();
}
// AI companions (LAN, only while a brain is connected): the host picks how
// many join before the night; they take free seats, four survivors at most.
const MAX_SURVIVORS = 4, COMPANION_COUNTS = [0, 1, 2, 3];
const companionCount = state => state.players.filter(player => player.companion === true).length;
const COMPANION_SLOT_NAMES = ['Max', 'Léa', 'Sam'];
function companionSelections(state) {
  return COMPANION_SLOT_NAMES.map((_, slot) => {
    const value = state?.companionSelections?.[slot];
    return COMPANION_PROFILE_CHOICES.includes(value) ? value : 'random';
  });
}
function companionAtSlot(state, slot) {
  const companions = state.players.filter(player => player.companion === true);
  return companions.find(player => player.companionSlot === slot)
    ?? (companions.every(player => !Number.isInteger(player.companionSlot)) ? companions[slot] : null);
}
function canEditCompanions(state) {
  return state?.hostId === myId && state.companionsAvailable === true && state.practice !== true
    && ['lobby', 'gameover', 'victory'].includes(state.phase);
}
function companionProfileLabel(selection) {
  return companionArchetype(selection)?.labels[getLanguage()] ?? t('companions.random');
}
// The brain left or ran out of budget: a toast during the night (the HUD), and
// a line in the lobby and the results, which cover the HUD, until a brain
// connects again.
let companionsNotice = null, companionsWereAvailable = false;
function noteCompanions(key) {
  companionsNotice = key; toast(() => t(key), 5);
  renderCompanions(); renderCompanions('-results');
}
function trackCompanionsBrain() {
  const available = snapshot.companionsAvailable === true;
  if (available && !companionsWereAvailable) companionsNotice = null;
  companionsWereAvailable = available;
}
function renderCompanions(suffix = '') {
  const root = $(`companions-picker${suffix}`), options = $(`companions-options${suffix}`), detail = $(`companions-detail${suffix}`), notice = $(`companions-notice${suffix}`), profiles = $(`companions-profiles${suffix}`), variation = $(`companions-variation${suffix}`);
  if (!root || !snapshot) return;
  if (notice) { notice.hidden = !companionsNotice || snapshot.practice === true; notice.textContent = companionsNotice ? t(companionsNotice) : ''; }
  root.hidden = snapshot.companionsAvailable !== true || snapshot.practice === true;
  if (!options || root.hidden) return;
  const editable = canEditCompanions(snapshot);
  const current = companionCount(snapshot), humans = snapshot.players.length - current;
  const selections = companionSelections(snapshot);
  const slots = COMPANION_SLOT_NAMES.map((_, slot) => companionAtSlot(snapshot, slot));
  const key = JSON.stringify([getLanguage(), current, humans, editable, selections, slots.map(player => [player?.name, player?.companionProfile?.archetype])]);
  if (root.dataset.renderKey === key) return;
  root.dataset.renderKey = key;
  // Made once, then updated in place: the focused button keeps the focus.
  if (options.children?.length !== COMPANION_COUNTS.length) options.replaceChildren(...COMPANION_COUNTS.map(count => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.count = String(count); button.textContent = String(count);
    button.onclick = () => {
      if (!canEditCompanions(snapshot)) return;
      const companions = companionCount(snapshot);
      if (count !== companions && snapshot.players.length - companions + count <= MAX_SURVIVORS) send({ type: 'companions', count, profiles: companionSelections(snapshot) });
    };
    return button;
  }));
  for (const button of options.children) {
    const count = Number(button.dataset.count), full = humans + count > MAX_SURVIVORS;
    button.className = `companions-option${count === current ? ' selected' : ''}${full ? ' full' : ''}`;
    button.setAttribute('aria-pressed', String(count === current));
    button.title = full ? t('companions.full') : '';
    button.disabled = !editable || full;
  }
  if (detail) detail.textContent = [t('companions.detail'), humans + COMPANION_COUNTS.at(-1) > MAX_SURVIVORS ? t('companions.seats') : '', editable ? '' : t('companions.hostOnly')].filter(Boolean).join(' ');
  // The same native selects survive the 10 Hz snapshots and language changes,
  // including while a keyboard or controller user has one focused.
  if (profiles) {
    if (profiles.children.length !== COMPANION_SLOT_NAMES.length) profiles.replaceChildren(...COMPANION_SLOT_NAMES.map((_, slot) => {
      const row = document.createElement('div'); row.className = 'companion-profile'; row.dataset.companionSlot = String(slot);
      const label = document.createElement('label'), select = document.createElement('select'), description = document.createElement('small');
      select.id = `companion-profile-${slot}${suffix}`; label.htmlFor = select.id;
      description.id = `${select.id}-detail`; select.setAttribute('aria-describedby', `${description.id} companions-variation${suffix}`);
      select.append(...COMPANION_PROFILE_CHOICES.map(selection => {
        const option = document.createElement('option'); option.value = selection; return option;
      }));
      select.onchange = () => {
        if (!canEditCompanions(snapshot) || !companionAtSlot(snapshot, slot) || !COMPANION_PROFILE_CHOICES.includes(select.value)) return;
        const next = companionSelections(snapshot); next[slot] = select.value;
        send({ type: 'companions', count: companionCount(snapshot), profiles: next });
      };
      row.append(label, select, description); return row;
    }));
    profiles.hidden = current === 0;
    for (const row of profiles.children) {
      const slot = Number(row.dataset.companionSlot), [label, select, description] = row.children;
      row.hidden = !slots[slot];
      label.textContent = t('companions.profileFor', { name: slots[slot]?.name ?? COMPANION_SLOT_NAMES[slot] });
      select.disabled = !editable || row.hidden;
      for (const option of select.children) option.textContent = companionProfileLabel(option.value);
      if (select.value !== selections[slot]) select.value = selections[slot];
      description.textContent = companionArchetype(selections[slot])?.descriptions[getLanguage()] ?? t('companions.randomDetail');
    }
  }
  if (variation) { variation.hidden = current === 0; variation.textContent = t('companions.variation'); }
}
// The "IA" / "AI" badge after a companion's name, in every list of survivors.
function companionBadge(player, element) {
  if (player.companion !== true) return;
  const archetype = companionArchetype(player.companionProfile?.archetype);
  const badge = document.createElement('span'); badge.className = 'ai-badge';
  badge.textContent = [t('companions.badge'), archetype?.labels[getLanguage()]].filter(Boolean).join(' · ');
  badge.title = archetype?.descriptions[getLanguage()] ?? t('companions.badgeTitle');
  element.append(badge);
}
// A companion says what it is doing: fixed FR/EN lines (never text written by
// the model), a few seconds each in the teammates' feed on the right.
const COMPANION_LINE_MS = 4000, MAX_COMPANION_LINES = 3, companionLines = [];
function companionCallout(event) {
  const players = snapshot?.players ?? [], name = players.find(player => player.id === event.id)?.name;
  if (!name) return null;
  const order = event.order, target = event.target;
  if (['revive', 'kit', 'follow'].includes(order)) {
    if (target === myId) return () => t(`companions.callout.${order}You`, { name });
    const teammate = players.find(player => player.id === target)?.name;
    return () => t(`companions.callout.${order}`, { name, target: teammate ?? t('companions.teammate') });
  }
  if (order === 'defend' || order === 'repair') return ['north', 'south', 'west', 'east'].includes(target) ? () => t(`companions.callout.${order}`, { name, door: t(`raid.side.${target}`) }) : null;
  if (order === 'buy') {
    const weapon = ARMORY.find(rack => rack.id === target)?.weapon ?? target;
    return t(`companions.weapon.${weapon}`) === `companions.weapon.${weapon}` ? null : () => t('companions.callout.buy', { name, weapon: t(`companions.weapon.${weapon}`) });
  }
  return order === 'loft' ? () => t(IS_FUNFAIR ? 'companions.callout.funfairLoft' : IS_HOSPITAL ? 'companions.callout.hospitalCellar' : IS_SUPERMARKET ? 'companions.callout.cellar' : 'companions.callout.loft', { name }) : null;
}
function showCompanionCallout(event) {
  const text = companionCallout(event), feed = $('team-chain-feed');
  if (!text) return;
  if (!feed) { toast(text); return; }
  const line = document.createElement('div'); line.className = 'team-chain companion-callout';
  line.dataset.badge = t('companions.badge'); line.textContent = text();
  feed.append(line); companionLines.push({ line, until: performance.now() + COMPANION_LINE_MS });
  while (companionLines.length > MAX_COMPANION_LINES) companionLines.shift().line.remove();
}
function expireCompanionCallouts(now = Infinity) {
  while (companionLines.length && now >= companionLines[0].until) companionLines.shift().line.remove();
}
function voteNextWave() {
  const self = myPlayer();
  if (!nextWaveAvailable(self) || !controlsAvailable()) return false;
  send({ type: 'next-wave', ready: self.nextWaveVote !== true });
  return true;
}
function refreshNextWave(self) {
  const panel = $('next-wave');
  if (!panel) return;
  panel.hidden = !nextWaveAvailable(self);
  if (panel.hidden) return;
  // Companions never vote (the server leaves them out): humans call the wave.
  const voters = snapshot.players.filter(player => !player.waiting && player.companion !== true), votes = voters.filter(player => player.nextWaveVote === true).length;
  const called = voters.length > 0 && votes === voters.length;
  panel.classList.toggle('ready', self.nextWaveVote === true); panel.classList.toggle('called', called);
  writeText($('next-wave-key'), controllerPlaying ? '⧉' : 'N');
  writeText($('next-wave-text'), () => t(called ? 'nextWave.coming' : self.nextWaveVote === true ? 'nextWave.waiting' : 'nextWave.call'));
  writeText($('next-wave-count'), voters.length > 1 ? `${votes}/${voters.length}` : '');
}
// The last zombies of a wave show a marker through the walls, so hunting a
// straggler never stalls the night.
const stragglerMarkers = new Map();
let reconMarkerKey = '', reconMarkerSample = [];
function updateStragglers(elapsed) {
  const self = myPlayer(), level = reconLevel(self), info = radarInformation(level);
  const show = inGame && ['countdown', 'wave', 'intermission'].includes(snapshot?.phase) && !snapshot?.paused && info.positions;
  const key = `${snapshot?.room}|${snapshot?.phase}|${snapshot?.wave}|${level}|${getLanguage()}|${radarPulseIndex(level, snapshot?.time ?? 0)}`;
  if (show && key !== reconMarkerKey) {
    reconMarkerKey = key;
    reconMarkerSample = (snapshot.zombies ?? []).filter(enemy => enemy.hp > 0 && Math.hypot(enemy.x - self.x, enemy.z - self.z) <= RADAR.range).map(enemy => {
      const family = enemyAppearance(enemy), ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
      return { id: enemy.id, x: enemy.x, y: info.floor ? enemy.y + (enemyProfile(enemy).head ?? 1.7) * (enemy.scale ?? 1) + .55 : self.y + 2.25, z: enemy.z,
        label: info.types ? family.label?.[getLanguage()] ?? enemy.kind : '',
        health: info.health ? info.exactHealth ? ratio : Math.ceil(ratio * 4) / 4 : null,
        exact: info.exactHealth ? `${Math.ceil(enemy.hp)}/${enemy.maxHp}` : '' };
    });
    for (const marker of stragglerMarkers.values()) { scene.remove(marker); if (marker.userData?.ownedMap) marker.material?.map?.dispose?.(); marker.material?.dispose?.(); }
    stragglerMarkers.clear();
  }
  const present = new Set((snapshot?.zombies ?? []).filter(enemy => enemy.hp > 0).map(enemy => enemy.id));
  for (const [id, marker] of stragglerMarkers) if (!show || !present.has(id)) { scene.remove(marker); if (marker.userData?.ownedMap) marker.material?.map?.dispose?.(); marker.material?.dispose?.(); stragglerMarkers.delete(id); }
  if (!show) { reconMarkerKey = ''; return; }
  for (const enemy of reconMarkerSample) {
    if (!present.has(enemy.id)) continue;
    let marker = stragglerMarkers.get(enemy.id);
    if (!marker) { marker = createStragglerMarker({ text: enemy.label, health: enemy.health, exact: enemy.exact }); scene.add(marker); stragglerMarkers.set(enemy.id, marker); }
    marker.position.set(enemy.x, enemy.y, enemy.z);
  }
}

function toast(text, seconds = 3) {
  writeText($('toast'), text); $('toast').hidden = false; toastUntil = performance.now() + seconds * 1000;
}
function banner(kicker, title) {
  writeText($('banner-kicker'), kicker); writeText($('banner-title'), title);
  $('wave-banner').hidden = false; bannerUntil = performance.now() + 3000;
}
// A HUD line in the installed pack's words (art/frisson/UI-SOUND.md section 2.6);
// without them, exactly the Famille line.
function hudText(key, params, famille) {
  let own = null; try { own = feedback.style?.text?.(key, params ?? {}) ?? null; } catch {}
  return typeof own === 'string' ? own : translateMessage(famille);
}
function send(message) {
  if (websocket?.readyState === WebSocket.OPEN && myId) websocket.send(JSON.stringify(message));
}
function myPlayer() { return snapshot?.players.find(player => player.id === myId); }
function aimContext() {
  const self = myPlayer();
  return {
    aim: { yaw, pitch }, sensitivity, scoped, cameraReady, aimReady,
    capture: { local: pointerLocked, dom: document.pointerLockElement === canvas, focused: inputFocused && document.hasFocus?.() !== false, hidden: document.hidden === true },
    mouse: mouseLookState(),
    phase: snapshot?.phase ?? null, wave: snapshot?.wave ?? null, paused: snapshot?.paused === true,
    inGame, menu: !$('pause').hidden, supplyMenu: Boolean(supplyMenu),
    pose: self ? { x:self.x, y:self.y, z:self.z, yaw:self.yaw, pitch:self.pitch, grounded:self.grounded, crouched:self.crouched } : null,
    camera: { x:camera.position.x, y:camera.position.y, z:camera.position.z, yaw:camera.rotation.y, pitch:camera.rotation.x },
  };
}
// Data may be a function, so nothing is prepared while the recorder is off.
function recordAim(type, data = {}) {
  if (aimDiagnostics.enabled && !aimDiagnostics.captured) aimDiagnostics.record(type, { ...aimContext(), ...(typeof data === 'function' ? data() : data) }, performance.now());
}
function mouseLookState() { return { raw: rawMouse, rawUnsupported: rawMouseUnsupported, lockMode: mouseLockMode, droppedSpikes: droppedMouseSpikes }; }
// What the re-centring check depends on, for the opt-in recorder only.
function viewGeometry() {
  return { width: innerWidth, height: innerHeight, outerWidth: globalThis.outerWidth ?? null, outerHeight: globalThis.outerHeight ?? null,
    pixelRatio: devicePixelRatio, visualScale: globalThis.visualViewport?.scale ?? null,
    screen: globalThis.screen ? { width: screen.width, height: screen.height } : null, fullscreen: Boolean(document.fullscreenElement) };
}
function refreshMouseLookStatus() {
  $('raw-mouse').checked = rawMouse;
  writeText($('raw-mouse-status'), () => {
    // Nothing before the first capture; then the mode in use, until a changed
    // setting applies at the next capture.
    const changed = mouseLockMode && (mouseLockMode !== 'adjusted') !== (rawMouse && !rawMouseUnsupported);
    const mode = !mouseLockMode ? '' : changed ? 'mouse.statusNext' : mouseLockMode === 'raw' ? 'mouse.statusRaw' : mouseLockMode === 'unknown' ? 'mouse.statusUnknown'
      : rawMouse ? 'mouse.statusUnsupported' : 'mouse.statusAdjusted';
    return [mode && t(mode), droppedMouseSpikes ? t('mouse.dropped', { count: droppedMouseSpikes }) : ''].filter(Boolean).join(' ');
  });
}
function refreshAimDiagnostics() {
  const status = aimDiagnostics.status();
  $('aim-diagnostic-capture').disabled = !status.enabled || status.captured;
  $('aim-diagnostic-report').disabled = !status.enabled || !status.count;
  $('aim-diagnostic-clear').disabled = !status.enabled;
  writeText($('aim-diagnostic-status'), () => t(!status.enabled ? 'aim.off' : status.captured ? 'aim.captured' : 'aim.recording'));
}
function captureAimIncident() {
  if (!aimDiagnostics.enabled || aimDiagnostics.captured) return;
  aimDiagnostics.capture(aimContext(), performance.now());
  refreshAimDiagnostics();
  toast(() => t('aim.captured'));
}
function initializeAim(self) {
  if (aimReady || !self) return;
  yaw = self.yaw; pitch = self.pitch; aimReady = true;
  recordAim('aim-initialized');
}
function weaponSlotLimit(self = myPlayer()) { return self?.backpack === true || self?.weaponSlots === BACKPACK.slots ? BACKPACK.slots : 2; }
function stationUnlockWave() { return Math.min(...Object.values(LATE_SUPPLIES.items).map(item => item.unlockWave ?? LATE_SUPPLIES.unlockWave)); }
function carriedWeapons(self = myPlayer()) {
  if (!self) return [];
  return (self.weapons ?? (self.ownedWeapons || [self.weapon]).filter(Boolean).map(weapon => ({ weapon, ammo: weapon === self.weapon ? self.ammo : 0, reserve: weapon === self.weapon ? self.reserve : 0 }))).slice(0, weaponSlotLimit(self));
}
function weaponSlotId(entry) { return entry?.id ?? entry?.weapon ?? null; }
function selectedWeaponId(self = myPlayer()) { return activeWeaponId(self); }
function nearbyGroundWeapon(self = myPlayer()) {
  if (!self) return null;
  if (self.nearbyWeaponId !== undefined) return snapshot?.pickups?.find(item => item.id === self.nearbyWeaponId && item.kind === 'weapon') ?? null;
  return (snapshot?.pickups || []).filter(item => item.kind === 'weapon' && Math.hypot(self.x - item.x, self.z - item.z) < PICKUPS.reach && Math.abs(self.y - item.y) < PICKUPS.heightReach)
    .sort((a, b) => Math.hypot(self.x - a.x, self.z - a.z) - Math.hypot(self.x - b.x, self.z - b.z))[0] ?? null;
}
function nearbyGroundBonus(self = myPlayer()) {
  if (!self) return null;
  if (self.nearbyBonusId !== undefined) return snapshot?.pickups?.find(item => item.id === self.nearbyBonusId && item.kind === 'bonus') ?? null;
  return (snapshot?.pickups || []).filter(item => item.kind === 'bonus' && Math.hypot(self.x - item.x, self.z - item.z) < PICKUPS.reach && Math.abs(self.y - item.y) < PICKUPS.heightReach)
    .sort((a,b) => Math.hypot(self.x-a.x,self.z-a.z)-Math.hypot(self.x-b.x,self.z-b.z))[0] ?? null;
}
function groundInteractionAvailable(self = myPlayer()) { return Boolean(nearbyGroundWeapon(self) || nearbyGroundBonus(self)); }
const EXTENDED_WEAPONS = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault', 'sniper', 'magnum', 'flamethrower'];
const PERFORATING_WEAPONS = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault'];
const REINFORCED_WEAPONS = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault', 'sniper'];
function bonusUsable(bonus, self = myPlayer()) {
  if (!self) return false;
  const current = self.bonus?.[bonus] ?? 0;
  // A sheet's innate debt is always worth a claim, as on the server.
  if (bonusDebt(self, bonus) > 0) return bonus !== 'radar' || radarSupplyStatus(snapshot,self) === 'available';
  if (current) return current < MAX_BONUS_LEVEL;
  if (bonus === 'radar') return radarSupplyStatus(snapshot,self) === 'available';
  if (Object.hasOwn(CHARACTER_BONUSES, bonus)) return true;
  return carriedWeapons(self).some(({weapon}) => bonus === 'stone' ? Boolean(meleeProfile(weapon))
    : bonus === 'extended' ? EXTENDED_WEAPONS.includes(weapon)
    : bonus === 'perforating' ? PERFORATING_WEAPONS.includes(weapon)
    : bonus === 'reinforced' && REINFORCED_WEAPONS.includes(weapon));
}
function bonusLabel(kind, level = 0) {
  const name = t(`bonus.${kind}`);
  return level >= 1 && level <= MAX_BONUS_LEVEL ? t('bonus.named', { name, level, max: MAX_BONUS_LEVEL }) : name;
}
// Tray icons match the drawn magazine size; each chip shows its level.
let bonusTrayKey = '';
function refreshBonusTray(self) {
  // Carried bonuses and a character sheet's debts, at their effective level
  // (carried − debt); the next claim's step comes from the sheet.
  const kinds = Object.keys(SUPPLY_BONUSES).filter(kind => (Number.isFinite(self?.bonus?.[kind]) && self.bonus[kind] >= 1) || bonusDebt(self, kind) > 0);
  // The survivor sheet replaces the tiles while it is shown.
  const sheetOpen = survivorSheetVisible(self);
  const key = `${sheetOpen}|${getLanguage()}|${self?.weapon}|${kinds.map(kind => `${kind}:${self.bonus?.[kind] ?? 0}:${bonusDebt(self, kind)}:${claimStep(self, kind).to}`).join(',')}`;
  if (key === bonusTrayKey) return;
  bonusTrayKey = key;
  const chips = kinds
    .map(kind => {
      const inputLevel = effectiveBonusLevel(self, kind), step = claimStep(self, kind);
      if (inputLevel < 1) return debtChip(kind, inputLevel, step);
      const info = bonusHudCard(kind, inputLevel, self.weapon, t, step.to);
      const chip = document.createElement('span');
      chip.className = `bonus-chip ${kind}`;
      chip.dataset.active = String(info.active);
      chip.title = `${t(`bonus.${kind}`)} · ${t('bonus.tooltipLevel', { level: info.level, max: MAX_BONUS_LEVEL })} · ${info.effect} · ${info.next}`;
      chip.setAttribute('aria-label', chip.title);
      const heading = document.createElement('span'); heading.className = 'bonus-chip-heading';
      heading.innerHTML = `${bonusIcon(kind)}<b>${info.level}</b><small>/8</small>`;
      const label = document.createElement('span'); label.className = 'bonus-chip-label'; label.textContent = t(`hudBonus.label.${kind}`);
      const effect = document.createElement('strong'); effect.className = 'bonus-chip-effect'; effect.textContent = info.effect;
      const next = document.createElement('small'); next.className = 'bonus-chip-next'; next.textContent = info.next;
      chip.append(heading, label, effect, next);
      if (info.extra) { const extra = document.createElement('small'); extra.className = 'bonus-chip-next'; extra.textContent = info.extra; chip.append(extra); }
      if (!info.active) { const inactive = document.createElement('small'); inactive.className = 'bonus-chip-inactive'; inactive.textContent = t('hudBonus.inactive'); chip.append(inactive); }
      return chip;
    });
  const tray = $('bonus-tray');
  tray.replaceChildren(...chips);
  tray.hidden = chips.length === 0 || sheetOpen;
}
// «Mon survivant» (survivor-sheet.js): Tab, or its button in the Escape
// menu, shows or hides a readable sheet of what the bonuses really give. The
// choice is remembered in this browser; hidden by default. The base weapon
// table comes from the server (/world.json), so the weapon lines are computed
// exactly like the server's weaponProfile.
let survivorSheetShown = readSheetShown(controllerStorage());
let survivorSheetContentKey = '', survivorSheetGeometryKey = '', survivorSheetRect = null, survivorSheetCards = [], serverWeapons = null;
fetch(mapContext.endpoint('/world.json')).then(response => response.json()).then(data => {
  if (data?.weapons && typeof data.weapons === 'object') { serverWeapons = data.weapons; survivorSheetContentKey = ''; refreshSurvivorSheet(); }
}).catch(() => {});
function survivorSheetVisible(self = myPlayer()) {
  return survivorSheetShown && inGame && Boolean(self) && self.waiting !== true && Boolean(snapshot) && !finishedPhase(snapshot.phase) && snapshot.phase !== 'extraction';
}
function refreshSurvivorSheet(self = myPlayer()) {
  const sheet = $('survivor-sheet'), visible = survivorSheetVisible(self);
  if (sheet.hidden === visible) { sheet.hidden = !visible; survivorSheetGeometryKey = ''; survivorSheetRect = null; survivorSheetCards = []; if (!visible) placeTeamFeed(null); }
  if (self) refreshBonusTray(self);
  if (!visible) return;
  const key = survivorSheetKey(self, { weapons: serverWeapons, language: getLanguage() });
  if (key === survivorSheetContentKey) return;
  survivorSheetContentKey = key; survivorSheetGeometryKey = '';
  renderSurvivorSheet(sheet, survivorSheetModel(self, { weapons: serverWeapons, t, language: getLanguage() }), { document, t, icon: bonusIcon });
  layoutSurvivorSheet();
}
// Sized and placed from the HUD as laid out, only when the content or the
// room around it changed (checked once per frame; reading the boxes there
// costs no extra layout).
function layoutSurvivorSheet() {
  const sheet = $('survivor-sheet');
  if (sheet.hidden || typeof sheet.getBoundingClientRect !== 'function') return;
  const region = measureSheetRegion({ viewport: { width: innerWidth, height: innerHeight }, score: $('score-panel'), weapon: $('weapon-panel'), wave: document.querySelector?.('.wave-panel') });
  // Not measurable yet (HUD still hidden): try again next frame.
  if (!region) { survivorSheetGeometryKey = ''; survivorSheetRect = null; survivorSheetCards = []; return; }
  const geometry = `${survivorSheetContentKey}|${region.key}`;
  if (geometry === survivorSheetGeometryKey) return;
  survivorSheetGeometryKey = geometry;
  const placed = placeSurvivorSheet(sheet, region, { document, continued: t('survivor.continued') });
  survivorSheetRect = placed?.rect ?? null; survivorSheetCards = placed?.cards ?? [];
  placeTeamFeed(region);
}
// A teammate's chain feed and the companions' callouts: while the sheet shows
// they keep their usual place if it stays free, else go left of the weapon
// panel, else over the sheet's last lines just above the weapon panel; never
// towards the crosshair (sheetFeedPlace in survivor-sheet.js).
function placeTeamFeed(region) {
  // The breach alert stands just left of the score meanwhile.
  const breach = $('breach-alert'), right = sheetBreachRight(region);
  if (breach?.style) breach.style.right = right === null ? '' : `${right}px`;
  const feed = $('team-chain-feed'), place = region ? sheetFeedPlace(region, survivorSheetCards) : null;
  if (!feed?.style) return;
  feed.classList?.toggle?.('beside-sheet', Boolean(place));
  feed.classList?.toggle?.('over-sheet', place?.mode === 'over');
  feed.style.right = place ? `${place.right}px` : '';
  feed.style.bottom = place ? `${place.bottom}px` : '';
  feed.style.maxWidth = place ? `${place.maxWidth}px` : '';
  feed.style.maxHeight = place ? `${place.maxHeight}px` : '';
}
function refreshSurvivorSheetButton() {
  const button = $('survivor-sheet-toggle');
  writeText(button, () => t(survivorSheetShown ? 'survivor.toggleShown' : 'survivor.toggleHidden'));
  button.setAttribute('aria-pressed', String(survivorSheetShown));
}
function toggleSurvivorSheet() {
  survivorSheetShown = !survivorSheetShown;
  saveSheetShown(controllerStorage(), survivorSheetShown);
  refreshSurvivorSheetButton(); refreshSurvivorSheet();
}
// Tab toggles the sheet in play; never while a menu or a text field has the
// keyboard (Tab then keeps moving the focus there).
function survivorSheetKeyAllowed(event) {
  return inGame && !supplyMenu && $('pause').hidden && $('gameover').hidden && $('lobby').hidden && !document.hidden
    && !event.ctrlKey && !event.altKey && !event.metaKey
    && !event.target?.isContentEditable && !event.target?.matches?.('input,textarea,select,[contenteditable="true"]');
}
// A red «−1»/«−2» tile: the innate malus a crate claim buys back.
function debtChip(kind, level, step) {
  const chip = document.createElement('span');
  chip.className = `bonus-chip debt ${kind}`;
  chip.dataset.active = 'true';
  const effect = sheetMalusEffect(kind, level, t), next = t('sheet.nextClaim', { from: signedValue(step.from), to: signedValue(step.to) });
  chip.title = `${t(`bonus.${kind}`)} · ${t('sheet.debtTitle', { level: signedValue(level) })} · ${effect} · ${next}`;
  chip.setAttribute('aria-label', chip.title);
  const heading = document.createElement('span'); heading.className = 'bonus-chip-heading';
  heading.innerHTML = `${bonusIcon(kind)}<b>${signedValue(Math.round(level))}</b>`;
  const label = document.createElement('span'); label.className = 'bonus-chip-label'; label.textContent = t(`hudBonus.label.${kind}`);
  const shown = document.createElement('strong'); shown.className = 'bonus-chip-effect'; shown.textContent = effect;
  const following = document.createElement('small'); following.className = 'bonus-chip-next'; following.textContent = next;
  chip.append(heading, label, shown, following);
  return chip;
}
// The HUD line lists every carried bonus compactly: “Renforts 2 · Chargeur 3”.
function bonusSummary(self) {
  const carried = Object.entries(self?.bonus ?? {}).filter(([kind, level]) => Number.isFinite(level) && level >= 1).map(([kind]) => kind);
  const debts = Object.keys(SUPPLY_BONUSES).filter(kind => bonusDebt(self, kind) > 0 && !carried.includes(kind));
  return [...carried, ...debts]
    .map(kind => { const level = Math.min(MAX_BONUS_LEVEL, effectiveBonusLevel(self, kind)); return `${t(`bonus.short.${kind}`)} ${level < 0 ? signedValue(level) : level}`; })
    .join(' · ');
}
function openSupplyMenu(event) {
  if (!inGame || !controlsAvailable() || !myPlayer()?.alive || myPlayer()?.downed || !['crate','station'].includes(event.menu)) return;
  supplyMenu = {menu:event.menu,crateId:event.crateId,wave:event.wave ?? snapshot.wave};
  supplyMenuVisualKey = '';
  resetInput();
  $('pause').hidden = true; $('supply-menu').hidden = false;
  refreshSupplyMenu();
  document.exitPointerLock?.();
  $('supply-options').scrollTop = 0;
  $('supply-return').focus({ preventScroll: true });
}
function closeSupplyMenu(resume = true) {
  if (!supplyMenu) return;
  supplyMenu = null; supplyMenuVisualKey = ''; $('supply-menu').hidden = true;
  if (resume && inGame && controlsAvailable() && myPlayer()?.alive && !myPlayer()?.downed) requestPointer();
  else if (inGame && controlsAvailable() && !controlsCaptured()) showPause();
}
function refreshSupplyMenu() {
  if (!supplyMenu) return;
  const self = myPlayer(); if (!self) return;
  const crate = supplyMenu.menu === 'crate';
  const visualKey = JSON.stringify([getLanguage(),supplyMenu.menu,supplyMenu.crateId,supplyMenu.wave,snapshot.wave,snapshot.supplyCrate?.wave,self.bonus,self.sheetDebt,self.character?.stats,self.points,self.supplyPurchases,self.backpack,self.reviveKit,carriedWeapons(self).map(item=>item.weapon)]);
  if (visualKey === supplyMenuVisualKey) return;
  supplyMenuVisualKey = visualKey;
  const wave=snapshot.wave,points=self.points ?? 0;
  writeText($('supply-kicker'), () => t('supply.context',{wave,points}));
  writeText($('supply-title'), () => t(crate ? 'supply.crate' : 'supply.station'));
  writeText($('supply-note'), () => t(crate ? 'supply.crateNote' : 'supply.stationNote'));
  $('supply-expiry').hidden = !crate;
  const expiresAtWave=(snapshot.supplyCrate?.wave ?? supplyMenu.wave)+1;
  writeText($('supply-expiry'), crate ? () => t('supply.expiry', {wave:expiresAtWave}) : '');
  const options = Object.entries(crate ? SUPPLY_BONUSES : LATE_SUPPLIES.items).map(([id,item]) => {
    const button = document.createElement('button'); button.className = 'supply-option';
    const name = document.createElement('strong'); name.textContent = t(`${crate?'bonus':'service'}.${id}`);
    const currentLevel = crate ? self.bonus?.[id] ?? 0 : 0;
    // What this claim gives, from the character sheet's shared step.
    const step = crate ? claimStep(self, id) : null;
    const nextLevel = step ? Math.max(1, step.to) : Math.min(MAX_BONUS_LEVEL, currentLevel + 1);
    const detail = document.createElement('small'); detail.textContent = step?.repay && step.to < 1 ? sheetMalusEffect(id, step.to, t) : Object.hasOwn(CHARACTER_BONUSES, id) ? characterBonusDescription(id, nextLevel, getLanguage()) : t(`${crate?'bonus':'service'}.${id}Detail`,{wave:RADAR.unlockWave,range:RADAR.range,level:nextLevel,max:MAX_BONUS_LEVEL,percent:nextLevel*10,targets:reinforcedMeleeTargets(nextLevel),seconds:radarBlipSeconds(nextLevel)});
    detail.title = detail.textContent;
    const status = document.createElement('span');
    const purchased = !crate && (id === 'backpack' ? self.backpack === true : id === 'revive' ? self.reviveKit === true || (self.supplyPurchases || []).includes(id) : (self.supplyPurchases || []).includes(id));
    const locked = !crate && snapshot.wave < (item.unlockWave ?? LATE_SUPPLIES.unlockWave);
    const eligible = !crate || bonusUsable(id,self);
    const missing = crate ? 0 : Math.max(0,item.price-(self.points ?? 0));
    button.disabled = !eligible || locked || purchased || missing > 0;
    const radarStatus = crate && id === 'radar' ? radarSupplyStatus(snapshot,self) : null;
    status.textContent = radarStatus === 'locked' ? t('radar.locked',{wave:RADAR.unlockWave}) : locked ? t('supply.serviceLocked',{wave:item.unlockWave ?? LATE_SUPPLIES.unlockWave}) : !eligible ? t(currentLevel >= MAX_BONUS_LEVEL ? 'bonus.maxLevel' : 'supply.ineligible') : purchased ? t(id === 'backpack' ? 'supply.owned' : id === 'revive' && self.reviveKit === true ? 'supply.carried' : 'supply.purchased') : missing ? t('supply.funds',{points:missing}) : step?.repay ? t('sheet.claimRepay', {from: signedValue(step.from), to: signedValue(step.to)}) : step?.talent ? t('sheet.claimTalent', {from: step.from, to: step.to}) : crate ? t(currentLevel ? 'bonus.upgrade' : 'bonus.first', {level: nextLevel, max: MAX_BONUS_LEVEL}) : t('supply.price',{price:item.price});
    if (step?.talent && eligible && radarStatus !== 'locked') { const talent = document.createElement('em'); talent.className = 'sheet-talent'; talent.textContent = t('sheet.talent'); status.append(talent); }
    if (crate) { const icon = document.createElement('span'); icon.className = 'supply-bonus-icon'; icon.innerHTML = bonusIcon(id); button.append(icon); }
    button.append(name,detail,status);
    button.onclick = () => {
      if (button.disabled || !supplyMenu) return;
      send(crate ? {type:'supply-claim',bonus:id,crateId:supplyMenu.crateId} : {type:'supply-buy',service:id});
      closeSupplyMenu();
    };
    return button;
  });
  // Keep focused choices usable while server snapshots continue to arrive.
  const focusedId = $('supply-options').contains?.(document.activeElement) ? document.activeElement.dataset?.supplyChoice : null;
  options.forEach((button,index) => { button.dataset.supplyChoice = Object.keys(crate ? SUPPLY_BONUSES : LATE_SUPPLIES.items)[index]; });
  $('supply-options').replaceChildren(...options);
  if (focusedId) options.find(button => button.dataset.supplyChoice === focusedId)?.focus();
}
function refreshRadarMap(now,force=false) {
  radarUI.update(snapshot,myId,{active:inGame && !$('hud').hidden && !document.hidden,paused:!$('pause').hidden,now,force,language:getLanguage()});
}
function dualStock(self = myPlayer()) { return self?.dualWield === true ? self.hands?.secondary ?? null : null; }
function toggleDual() {
  const self = myPlayer();
  if (!self?.alive || self.downed || !characterStats(self).dualWield || !controlsAvailable()) return;
  secondaryFiring = false; secondaryShotAt = null; releaseHandFire('secondary'); stopSecondaryReloadAudio(); setScope(false);
  send({ type: 'dual-wield', enabled: !self.dualWield, secondaryWeaponId: $('dual-secondary').value || undefined });
}
function refreshDual(self) {
  const unlocked = characterStats(self).dualWield, stock = dualStock(self);
  $('dual-controls').hidden = !unlocked;
  const candidates = carriedWeapons(self).filter(entry => weaponSlotId(entry) !== selectedWeaponId(self) && !meleeProfile(entry.weapon));
  const key = `${getLanguage()}|${selectedWeaponId(self)}|${candidates.map(entry => weaponSlotId(entry)).join('|')}`;
  const select = $('dual-secondary');
  if (select.dataset.choices !== key) {
    const selected = self.secondaryWeaponId ?? select.value;
    select.dataset.choices = key;
    select.replaceChildren(...candidates.map(entry => { const option = document.createElement('option'); option.value = weaponSlotId(entry); option.textContent = `${weaponLabel(entry.weapon)} · ${entry.ammo}/${entry.magazine} +${entry.reserve}`; return option; }));
    select.value = candidates.some(entry => weaponSlotId(entry) === selected) ? selected : candidates[0] ? weaponSlotId(candidates[0]) : '';
  }
  for (const option of Array.from(select.options ?? select.children ?? [])) {
    const entry = candidates.find(entry => weaponSlotId(entry) === option.value);
    if (entry) { const label = `${weaponLabel(entry.weapon)} · ${entry.ammo}/${entry.magazine} +${entry.reserve}`; if (option.textContent !== label) option.textContent = label; }
  }
  $('dual-toggle').disabled = !self.alive || self.downed || (!stock && (!candidates.length || meleeProfile(self.weapon)));
  $('dual-toggle').textContent = t(stock ? 'dual.single' : 'dual.toggle');
  $('dual-toggle').setAttribute('aria-pressed', String(Boolean(stock)));
  $('secondary-ammo-panel').hidden = !stock;
  if (stock) {
    $('secondary-weapon').textContent = weaponLabel(stock.weapon);
    $('secondary-ammo').textContent = `${stock.ammo}/${stock.magazine} +${stock.reserve}`;
    $('secondary-reload').textContent = stock.reloading ? t('dual.reload', { seconds: Number(stock.reloadLeft).toFixed(1) }) : getLanguage() === 'en' ? 'RIGHT CLICK / LT' : 'CLIC DROIT / LT';
  }
  const wanted = stock?.weaponId ?? null;
  if (wanted !== secondaryGunId) {
    if (secondaryGun) { camera.remove(secondaryGun); secondaryGun.userData.heatMaterial?.dispose?.(); }
    secondaryGun = stock ? createWeapon(stock.weapon) : null; secondaryGunId = wanted;
    if (secondaryGun) camera.add(secondaryGun);
    secondaryShotAt = null;
  }
  if (!stock) { secondaryFiring = false; secondarySpinRequested = false; sound.releaseFire?.(undefined, `${myId}:secondary`); stopSecondaryReloadAudio(); }
}
function releaseHandFire(hand = 'primary') {
  const stock = hand === 'secondary' ? dualStock() : myPlayer(), voice = hand === 'secondary' ? `${myId}:secondary` : myId;
  if (stock) sound.releaseFire?.(stock.weapon, voice);
  flameStreams.get(voice)?.stop();
}

function updateSecondaryFire(self, now, elapsed, moving, bob, delta) {
  const stock = dualStock(self);
  if (!stock || !secondaryGun) return;
  secondaryGun.visible = self.alive && !self.downed && !self.umbrella?.open && !finishedPhase(snapshot.phase);
  applyWeaponViewPose(secondaryGun, { time: elapsed, moving, bob, recoil, reloading: stock.reloading });
  secondaryGun.position.x = -Math.abs(secondaryGun.position.x);
  if (!secondaryFiring || stock.reloading || !self.alive || self.downed || self.umbrella?.open || !(stock.ammo > 0)) releaseHandFire('secondary');
  animateWeaponMechanism(secondaryGun, { time: elapsed, reloading: stock.reloading });
  const active = controlsCaptured() && controlsAvailable() && secondaryFiring && self.alive && !self.downed && !self.umbrella?.open && !stock.reloading && ['countdown','wave','intermission'].includes(snapshot.phase);
  const spin = active && stock.weapon === 'minigun' && stock.ammo > 0;
  if (spin !== secondarySpinRequested) { secondarySpinRequested = spin; send({ type: 'minigun-spin', hand: 'secondary', spinning: spin }); if (spin) sound.startMinigun?.({ voiceId: `${myId}:secondary` }); else sound.releaseFire?.('minigun', `${myId}:secondary`); }
  if (secondaryGun.userData.rotor) secondaryGun.userData.rotor.rotation.z -= delta * minigunRotorSpeed({ spinning: stock.minigunSpinning, spinLeft: stock.minigunSpinLeft, duration: snapshot.minigunSpinDuration ?? MINIGUN_TIMING.windup, reloading: stock.reloading, downed: self.downed });
  if (!active) return;
  if (stock.weapon === 'minigun' && stock.ammo > 0 && (!stock.minigunSpinning || stock.minigunSpinLeft > 0)) return;
  const schedule = firingSchedule(now / 1000, secondaryShotAt, cadence[stock.weapon]); secondaryShotAt = schedule.nextAt;
  if (schedule.fire) { send(inputMessage()); send({ type: 'shoot', hand: 'secondary' }); }
}
function reserveMagazines(reserve, magazine, limit = 6) {
  const rounds = Math.max(0, Math.floor(Number(reserve) || 0));
  const capacity = Math.max(0, Math.floor(Number(magazine) || 0));
  if (!capacity) return { capacity, rounds, full: 0, partial: 0, visibleFull: 0, overflow: 0 };
  const full = Math.floor(rounds / capacity), partial = rounds % capacity;
  const visibleFull = Math.min(full, Math.max(0, limit - Number(partial > 0)));
  return { capacity, rounds, full, partial, visibleFull, overflow: full - visibleFull };
}
// A Chimie debt's slower hands (6 s, 7.5 s) fill the revive bars from empty
// instead of leaving them stuck at 0 %; a faster Secouriste keeps the usual
// 5 s scale, so the standard game's bars are unchanged.
function reviveDuration(reviver) { return Math.max(REVIVE.duration, characterStats(reviver).reviveSeconds); }
// The server's own cap, down to one under a Chimie debt; the base carry only
// for snapshots that predate the field.
function grenadeCapacity(self = myPlayer()) { return Number.isFinite(self?.maxGrenades) ? Math.max(1, Math.floor(self.maxGrenades)) : GRENADES.maxCarry; }
function refreshAmmunition(self) {
  if (!self) return;
  refreshDual(self);
  const weapons = carriedWeapons(self);
  const selectedId = selectedWeaponId(self);
  const capacity = self.magazine ?? weapons.find(entry => weaponSlotId(entry) === selectedId)?.magazine;
  const reserve = reserveMagazines(self.reserve, capacity);
  const fuel = self.weapon === 'flamethrower';
  const rockets = self.weapon === 'rocket';
  const melee = Boolean(meleeProfile(self.weapon));
  writeText($('ammo-unit'), () => t(fuel ? 'ammo.fuelUnits' : rockets ? 'ammo.rockets' : 'ammo.rounds'));
  $('reserve-magazine-row').setAttribute('title', t(fuel ? 'ammo.fuelExplanation' : rockets ? 'ammo.rocketExplanation' : 'ammo.explanation'));
  $('weapon-panel').classList.toggle('fuel', fuel);
  $('weapon-panel').classList.toggle('melee', melee);
  writeText($('ammo-value'), self.ammo);
  writeText($('magazine-value'), capacity ?? '—');
  writeText($('reserve-value'), self.reserve);
  $('weapon-panel').classList.toggle('empty', !melee && self.ammo <= 0);
  $('weapon-panel').classList.toggle('reloading', Boolean(self.reloading));
  const extendedLevel = Math.max(0, Math.min(MAX_BONUS_LEVEL, effectiveBonusLevel(self, 'extended')));
  const row = $('reserve-magazine-row');
  row.style.setProperty('--mag-extra', `${Number((24 * extendedLevel / 10).toFixed(1))}px`);
  const capacityBonus = $('capacity-bonus');
  capacityBonus.hidden = extendedLevel === 0 || melee || rockets || !self.weapon;
  writeText(capacityBonus, () => t('hudBonus.capacity', { percent: extendedLevel * 10 }));
  const visualKey = `${fuel ? 'fuel' : rockets ? 'rockets' : 'rounds'}/${reserve.rounds}/${reserve.capacity}/${extendedLevel}`;
  if (visualKey !== reserveVisualKey) {
    reserveVisualKey = visualKey;
    const icons = [];
    for (let index = 0; index < reserve.visibleFull + Number(reserve.partial > 0); index++) {
      const partial = index === reserve.visibleFull;
      const icon = document.createElement('span');
      icon.className = `magazine-icon${fuel ? ' fuel-canister' : rockets ? ' rocket-round' : ''}${partial ? ' partial' : ''}`;
      icon.style.setProperty('--fill', partial ? `${100 * reserve.partial / reserve.capacity}%` : '100%');
      if (extendedLevel > 0 && !fuel && !rockets) icon.append(Object.assign(document.createElement('i'), { className: 'mag-extension' }));
      icons.push(icon);
    }
    if (reserve.overflow > 0) {
      const extra = document.createElement('span'); extra.className = 'magazine-overflow';
      extra.textContent = `+${reserve.overflow}`; icons.push(extra);
    }
    $('reserve-magazines').replaceChildren(...icons);
  }
  // The big numbers already give the reserve; only the flame time is new information.
  $('reserve-summary').hidden = !fuel;
  writeText($('reserve-summary'), fuel ? () => t('ammo.fuelSummary', { seconds: Number(reserve.rounds * cadence.flamethrower).toFixed(1) }) : '');
  const readyStatus = self.weapon === 'sniper' && self.fireReadyLeft > 0
    ? () => t('sniper.bolt',{seconds:Number(self.fireReadyLeft).toFixed(1)})
    : fuel ? () => t(self.ammo === 0 ? self.reserve === 0 ? 'ammo.fuelEmpty' : 'ammo.fuelReload' : 'ammo.fuelReady')
    : self.weapon === 'minigun' && self.minigunSpinning && !self.minigunReady ? `ROTATION · ${Number(self.minigunSpinLeft).toFixed(1).replace('.', ',')} s`
    : self.ammo === 0 ? self.reserve === 0 ? 'ÉPUISÉE · CHERCHE UNE BOÎTE DE MUNITIONS' : 'CHARGEUR VIDE · R POUR RECHARGER' : 'R · RECHARGER';
  writeText($('reload-status'), melee ? () => t(self.meleeAttack ? 'melee.windup' : self.meleeReadyLeft>0 ? 'melee.recovery' : 'melee.controls', {attack:t(self.meleeAttack==='heavy'?'melee.heavy':'melee.light'),seconds:Number(self.meleeAttack?self.meleeWindupLeft:self.meleeReadyLeft??0).toFixed(1)}) : !self.weapon ? () => t('ground.unarmedHint') : self.reloading ? `RECHARGEMENT · ${Number(self.reloadLeft).toFixed(1)} s` : readyStatus);
  $('weapon-panel').classList.toggle('unarmed', !self.weapon);
  const maxGrenades = grenadeCapacity(self);
  writeText($('grenade-count'), `${self.grenades ?? 0}/${maxGrenades}`);
  $('grenade-stock').classList.toggle('empty', !(self.grenades > 0));
  const grenadeLeft = self.alive && !self.downed && !self.waiting && !snapshot?.practice
    && ['countdown', 'wave', 'intermission'].includes(snapshot?.phase) && characterStats(self).grenadeIntervalSeconds > 0
    && self.grenades < maxGrenades && Number.isFinite(self.grenadierLeft) && self.grenadierLeft > 0 ? Math.ceil(self.grenadierLeft) : null;
  $('grenadier-timer').hidden = grenadeLeft === null;
  writeText($('grenadier-timer'), grenadeLeft === null ? '' : () => t('grenadier.next', { seconds: grenadeLeft }));
  // A grenadier's timer line comes and goes; while the survivor sheet shows,
  // its room stays, so the sheet above does not jump every few seconds.
  $('weapon-panel').classList.toggle('grenadier-room', !snapshot?.practice && characterStats(self).grenadeIntervalSeconds > 0);

  const grenadeCount = Math.max(0, Math.min(maxGrenades, Math.floor(self.grenades ?? 0)));
  const grenadeIcons = $('grenade-icons');
  if (grenadeIcons.dataset.count !== String(grenadeCount) || grenadeIcons.dataset.capacity !== String(maxGrenades)) {
    grenadeIcons.dataset.count = String(grenadeCount); grenadeIcons.dataset.capacity = String(maxGrenades);
    grenadeIcons.replaceChildren(...Array.from({ length: maxGrenades }, (_, index) => {
      const icon = document.createElement('i');
      icon.className = index < grenadeCount ? 'grenade-silhouette available' : 'grenade-silhouette';
      return icon;
    }));
  }
  const silhouetteStyle = isFrissonLike(ambianceWanted) && ambianceReady && !ambianceFailed ? 'frisson' : 'famille';
  document.querySelectorAll('[data-slot]').forEach(el => {
    const index = Number(el.dataset.slot), entry = weapons[index];
    el.hidden = index >= weaponSlotLimit(self);
    const active = Boolean(entry && weaponSlotId(entry) === selectedId);
    el.classList.toggle('active', active);
    el.classList.toggle('locked', !entry);
    el.classList.toggle('empty', Boolean(entry && !meleeProfile(entry.weapon) && entry.ammo === 0));
    const silhouette = entry && Object.hasOwn(WEAPON_MOVEMENT, entry.weapon)
      ? `url("/hud-silhouettes/${silhouetteStyle}/${entry.weapon}.png")` : 'none';
    if (el.dataset.silhouette !== silhouette) {
      el.dataset.silhouette = silhouette;
      el.style.setProperty('--weapon-silhouette', silhouette);
      el.classList.toggle('has-silhouette', silhouette !== 'none');
    }
    // The held weapon's counts are the big numbers above: its slot shows the name only.
    writeText(el, !entry ? () => t('ground.emptySlot', { slot: index + 1 })
      : active ? () => `${index + 1} ${weaponLabel(entry.weapon)}`
      : () => t(meleeProfile(entry.weapon)?'melee.slot':entry.weapon === 'flamethrower' ? 'ammo.fuelSlot' : 'ammo.slot', { slot: index + 1, name: weaponLabel(entry.weapon), ammo: entry.ammo, capacity: entry.magazine ?? '—', reserve: entry.reserve }));
  });
  $('backpack-status').hidden = self.backpack !== true;
  writeText($('backpack-status'), () => t('backpack.hud',{slots:BACKPACK.slots}));
  $('backpack-status').setAttribute('title',t('backpack.penalty'));
}
function switchWeapon(requestedId) {
  const self = myPlayer();
  if (!requestedId || !self) return;
  const entry = carriedWeapons(self).find(item => weaponSlotId(item) === requestedId);
  if (!entry || weaponSlotId(entry) === selectedWeaponId(self)) return;
  const weapon = entry.weapon, weaponId = weaponSlotId(entry);
  cancelMelee();
  setScope(false);
  fireAudioWeapon = null; reloadAudioRequested = false; stopMinigunSpin(); stopReloadAudio(true);
  sound.releaseFire?.(self.weapon, myId); sound.releasePump?.(myId); send({ type: 'weapon', weapon, ...(weaponId !== weapon ? { weaponId } : {}) }); lastShot = performance.now() / 1000; nextShotAt = lastShot + characterStats(self).switchSeconds;
  flameStreams.get(myId)?.stop();
}
function showPickup(event) {
  const now = performance.now();
  if (event.kind === 'points') {
    if (Number.isFinite(event.amount) && event.amount > 0) feedback.score(event.amount, { x: innerWidth / 2, y: innerHeight * .58, coin: true });
    pickupPoints = pickupNoticeKind === 'points' && now < pickupNoticeUntil ? pickupPoints + event.amount : event.amount;
    writeText($('pickup-notice'), `+${pickupPoints} PIÈCES RAMASSÉES`);
  } else if (event.kind === 'revive') {
    writeText($('pickup-notice'), () => t('pickup.revive'));
  } else if (event.kind === 'health') {
    writeText($('pickup-notice'), () => t(event.partial === true ? 'pickup.healthPartial' : 'pickup.health', { healed: event.healed }));
  } else if (event.kind === 'armor') {
    writeText($('pickup-notice'), () => t('pickup.armor', { armor: event.armorGained ?? 0 }));
  } else if (event.kind === 'grenade') {
    writeText($('pickup-notice'), () => t('pickup.grenade', { count: event.grenades ?? myPlayer()?.grenades ?? 0, max: grenadeCapacity() }));
  } else {
    writeText($('pickup-notice'), () => {
      const ammunition = (event.ammo || []).map(item => `${weaponLabel(item.weapon)} +${item.amount}`).join(' · ');
      const notice = t('pickup.ammo', { ammunition });
      return event.removed === false && event.remainingFill > 0
        ? `${notice} · ${t('pickup.remaining', { percent: Math.round(event.remainingFill * 100) })}` : notice;
    });
  }
  pickupNoticeKind = event.kind; pickupNoticeUntil = now + 1900;
  $('pickup-notice').hidden = false;
}
function stopReloadAudio(cancelled = false) {
  if (cancelled) reloadSoundCancelled = true;
  if (reloadSoundWeapon === null) return;
  sound.releaseReload?.(myId); reloadSoundWeapon = null; reloadSoundConfirmed = false;
}
function stopSecondaryReloadAudio() {
  if (!secondaryReloadAudio) return;
  sound.releaseReload?.(`${myId}:secondary`); secondaryReloadAudio = null;
}
function stopMinigunSpin() {
  nextMinigunShotAt = null;
  if (!minigunSpinRequested) return;
  send({ type: 'minigun-spin', spinning: false }); sound.releaseFire?.('minigun', myId);
  minigunSpinRequested = false; minigunSpinConfirmed = false;
}
function updateMinigunSpin(self = myPlayer()) {
  const invalidReload = reloadAudioRequested && self && (self.ammo >= self.magazine || self.reserve <= 0);
  const active = inGame && controlsCaptured() && $('pause').hidden && !document.hidden && firing && self?.alive && !self.downed && !self.umbrella?.open && self.weapon === 'minigun' && self.ammo > 0 && !self.reloading && (fireAudioWeapon === 'minigun' || invalidReload) && ['countdown', 'wave', 'intermission'].includes(snapshot?.phase);
  if (!active) { stopMinigunSpin(); return; }
  if (!minigunSpinRequested) {
    minigunSpinRequested = true; minigunSpinConfirmed = false;
    send({ type: 'minigun-spin', spinning: true }); sound.startMinigun?.({ voiceId: myId });
  }
}
function finishedPhase(phase) { return phase === 'gameover' || phase === 'victory'; }
function controlsAvailable() { return snapshot && snapshot.paused !== true && !myPlayer()?.waiting && pauseRequestTarget !== true && !finishedPhase(snapshot.phase) && snapshot.phase !== 'extraction'; }
function roomPauseAvailable() { return snapshot && ['countdown','wave','intermission','extraction'].includes(snapshot.phase); }
function refreshPauseControls() {
  const paused = snapshot?.paused === true, host = snapshot?.hostId === myId;
  $('room-pause-button').hidden = !inGame || !roomPauseAvailable() || paused;
  $('room-pause-button').disabled = !host || pauseRequestTarget !== null;
  writeText($('room-pause-button'), () => t(host ? 'pause.stop' : 'pause.hostOnly'));
  $('resume-button').disabled = pauseRequestTarget !== null || (paused && !host);
  $('pause').classList.toggle('team-paused', paused);
  for (const id of ['practice-equip','practice-assault','practice-rocket','practice-flamethrower','practice-bat','practice-fireaxe','practice-katana','practice-hammer','practice-sniper','practice-refill','practice-targets','practice-radar','practice-raiders','practice-weapon']) $(id).disabled = paused;
  $('practice-backpack').disabled = paused || myPlayer()?.backpack === true;
  refreshSaveControls();
}
function requestRoomPause(paused = snapshot?.paused !== true) {
  if (!inGame || !roomPauseAvailable() || pauseRequestTarget !== null) return;
  if (snapshot.hostId !== myId) { toast(() => t('pause.hostOnly')); return; }
  if (typeof paused !== 'boolean' || paused === (snapshot.paused === true)) return;
  resetInput();
  pauseRequestTarget = paused;
  closeSupplyMenu(false);
  document.exitPointerLock?.();
  showPause(); refreshPauseControls();
  send({type:'pause',paused});
}
// Any admitted survivor saves a night once it is paused (owner, 18 October).
function savableNight() { return inGame && snapshot?.practice !== true && ['countdown', 'wave', 'intermission'].includes(snapshot?.phase) && !myPlayer()?.waiting; }
let savePausedSeen = false;
function refreshSaveControls() {
  const night = savableNight(), paused = snapshot?.paused === true;
  // The last save's line goes once the team plays again.
  if (snapshot && savePausedSeen && !paused && !saveRequested) $('save-game-status').hidden = true;
  if (snapshot) savePausedSeen = paused;
  $('save-game-button').hidden = !night;
  $('save-game-button').disabled = !night || !paused || saveRequested;
  $('save-game-hint').hidden = !night || paused;
  if (night && !paused) writeText($('save-game-hint'), () => t(snapshot.hostId === myId ? 'save.pauseFirstHost' : 'save.pauseFirstGuest'));
}
function saveReason(code) { return t(`save.reason.${typeof code === 'string' && t(`save.reason.${code}`) !== `save.reason.${code}` ? code : 'error'}`); }
function saveStatus(text) { writeText($('save-game-status'), text); $('save-game-status').hidden = false; }
function requestSave() {
  if (!savableNight() || snapshot.paused !== true || saveRequested) return;
  saveRequested = true; saveStatus(() => t('save.saving')); refreshSaveControls();
  send({ type: 'save-game' });
}
function saveStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
// The file, then a copy in this browser: storage may fail, the file never waits for it.
function receiveSave(save) {
  saveRequested = false;
  const summary = saveSummary(save);
  if (!summary) { saveStatus(() => t('save.failed', { reason: saveReason('format') })); refreshSaveControls(); return; }
  const wave = summary.wave;
  const downloaded = downloadText(document, JSON.stringify(save), saveFileName(wave, new Date()), { later: callback => setTimeout(callback, 1000) });
  let kept = false;
  try { kept = keepSave(saveStorage(), save); } catch {}
  saveStatus(() => t(downloaded ? kept ? 'save.doneKept' : 'save.doneFile' : kept ? 'save.doneStored' : 'save.failed', { wave, reason: saveReason('error') }));
  refreshSaveControls();
}
const LOAD_AMBIANCE_LABELS = Object.freeze({ family: 'ambiance.family', 'frisson-leger': 'ambiance.frissonLeger', frisson: 'ambiance.frisson' });
function saveEntryLabel(entry) {
  const label = t('save.entry', { wave: entry.wave, ambiance: t(LOAD_AMBIANCE_LABELS[ambianceOf(entry.ambiance)]),
    players: (entry.players ?? []).join(', ') || '—', date: saveDateLabel(entry.savedAt, getLanguage()) });
  const friendlyFire = ['reduced', 'full'].includes(entry.friendlyFire) ? ` · ${t(`friendlyFire.short.${entry.friendlyFire}`)}` : '';
  return t('levels.saveEntry', { map: mapLabel(entry.mapId ?? 'cabin'), entry: label + friendlyFire });
}
function loadStatus(text) { writeText($('load-status'), text); $('load-status').hidden = !text; }
function renderLoadPanel() {
  const entries = readSaves(saveStorage());
  $('load-empty').hidden = entries.length > 0;
  $('load-saves').replaceChildren(...entries.map(entry => {
    const item = document.createElement('li'), open = document.createElement('button'), remove = document.createElement('button');
    open.type = 'button'; open.className = 'load-entry'; open.textContent = saveEntryLabel(entry);
    open.onclick = () => beginLoad(entry.save);
    remove.type = 'button'; remove.className = 'load-delete'; remove.textContent = '✕';
    remove.setAttribute('aria-label', t('save.delete')); remove.setAttribute('title', t('save.delete'));
    remove.onclick = () => { forgetSave(saveStorage(), entry.id); renderLoadPanel(); $('load-file-button').focus?.(); };
    item.append(open, remove); return item;
  }));
}
function toggleLoadPanel(open = $('load-panel').hidden) {
  $('load-panel').hidden = !open || joinMode;
  if (!$('load-panel').hidden) { loadStatus(''); renderLoadPanel(); }
}
// A save opens a NEW room like « Ouvrir le refuge », in its own ambiance
// unless this PC is locked to Famille; the upload starts after the welcome.
function beginLoad(save, text = JSON.stringify(save)) {
  if (joining || pendingLoad) return;
  const summary = saveSummary(save), plan = summary ? uploadPlan(text) : null;
  if (!summary || !plan) { loadStatus(() => t('save.loadFailed', { reason: saveReason(summary ? 'too-large' : 'format') })); return; }
  const targetMap = Object.hasOwn(save, 'mapId') ? save.mapId : 'cabin';
  if (!['cabin', 'supermarket', 'hospital', 'funfair'].includes(targetMap)) { loadStatus(() => t('levels.unknown')); return; }
  if (mapContext.enabled && targetMap !== LEVEL.id) {
    if (!mapContext.navigate(targetMap, { ...mapDraft('load'), text })) loadStatus(() => t('levels.transferFailed'));
    return;
  }
  pendingLoad = { plan, wave: summary.wave, sent: 0, started: false };
  if (!familyLocked && readFamilyLock()) applyFamilyLock(true);
  connect({ load: { ambiance: familyLocked ? 'family' : ambianceOf(summary.ambiance) } });
}
async function loadFile(file) {
  if (!file) return;
  if (!(file.size <= 600000)) { loadStatus(() => t('save.loadFailed', { reason: saveReason('too-large') })); return; }
  let text = null, save = null;
  try { text = await file.text(); } catch { loadStatus(() => t('save.loadFailed', { reason: saveReason('read') })); return; }
  try { save = JSON.parse(text); } catch {}
  beginLoad(save, text);
}
// Chunks are paced under the servers' message rate; the lobby says so meanwhile.
function sendLoadChunks() {
  loadTimer = null;
  if (!pendingLoad || !myId) return;
  const { plan } = pendingLoad;
  for (let count = 0; count < 20 && pendingLoad.sent < plan.chunks.length; count++, pendingLoad.sent++)
    send({ type: 'load-chunk', index: pendingLoad.sent, data: plan.chunks[pendingLoad.sent] });
  if (pendingLoad.sent < plan.chunks.length) loadTimer = setTimeout(sendLoadChunks, 250);
}
function startUpload() {
  if (!pendingLoad || pendingLoad.started) return;
  pendingLoad.started = true;
  writeText($('lobby-load-status'), () => t('save.loading')); $('lobby-load-status').hidden = false;
  send({ type: 'load-begin', chunks: pendingLoad.plan.chunks.length, size: pendingLoad.plan.size });
  sendLoadChunks();
  // A transfer lost with a dropped connection must not leave the lobby waiting.
  loadDeadline = setTimeout(() => { if (pendingLoad) receiveLoadResult({ ok: false, reason: 'expired' }); }, 45000);
}
function cancelLoad() {
  clearTimeout(loadTimer); clearTimeout(loadDeadline); loadTimer = loadDeadline = null; pendingLoad = null;
  if (snapshot) refreshStartButton();
}
function receiveLoadResult(message) {
  cancelLoad();
  if (message.ok !== true) {
    writeText($('lobby-load-status'), () => t('save.loadFailed', { reason: saveReason(message.reason) })); $('lobby-load-status').hidden = false;
    return;
  }
  $('lobby-load-status').hidden = true;
  // The restored survivor faces where they faced: the next snapshot seeds the
  // aim again, as on an admission, instead of keeping the lobby's.
  aimReady = false;
  enterGame();
  // The loader never sees the lobby's seat line: the restore toast says which
  // saved character they play when it is not the one picked on this PC.
  const adopted = heldSeat() ? seatAdopted : null; seatAdopted = null;
  if (adopted) toast(() => `${restoredText(message)} ${t('sheet.seatLocked', { current: characterLabel(adopted, t) })}`, 10);
}
// «Partie reprise à la vague 7…», with the companions' note if any.
function restoredText({ wave, companions } = {}) {
  const note = companions === 'offline' ? 'save.companionsOffline' : companions === 'unsupported' ? 'save.companionsUnsupported' : null;
  return `${t('save.restored', { wave: Number.isInteger(wave) ? wave : snapshot?.wave ?? 0 })}${note ? ` ${t(note)}` : ''}`;
}
function onSaveMessage(message) {
  if (message.type === 'save-game') receiveSave(message.save);
  else if (message.type === 'save-denied') { saveRequested = false; saveStatus(() => t('save.failed', { reason: saveReason(message.reason) })); refreshSaveControls(); }
  else if (message.type === 'load-result') receiveLoadResult(message);
}
// Restored seats nobody has taken back yet, offered in the admission panel
// (not to a survivor who already took one back: one seat each).
function refreshSeatClaims() {
  const seats = Array.isArray(snapshot?.freeSeats) && !heldSeat() ? snapshot.freeSeats : [];
  $('admission-seats').hidden = !seats.length;
  const key = JSON.stringify([getLanguage(), seats]);
  if ($('admission-seat-list').dataset.renderKey === key) return;
  $('admission-seat-list').dataset.renderKey = key;
  $('admission-seat-list').replaceChildren(...seats.map(({ seat, name, character }) => {
    const button = document.createElement('button');
    // A seat keeps its saved character: named unless it is the standard one.
    const sheet = character && !(character.preset === 'standard' && !character.name) ? characterLabel(character, t) : null;
    const ofName = frenchOf(name);
    button.type = 'button'; button.className = 'outline'; button.textContent = sheet ? t('save.claimSeatAs', { name, ofName, character: sheet }) : t('save.claimSeat', { name, ofName });
    button.onclick = () => { if (myPlayer()?.waiting) send({ type: 'claim-seat', seat }); };
    return button;
  }));
}
function updateExtraction(now = performance.now()) {
  if (!['extraction', 'victory'].includes(snapshot?.phase)) return;
  const duration = snapshot.extractionDuration ?? 12;
  const elapsed = snapshot.phase === 'victory' ? duration : Math.max(0, Math.min(duration, duration - snapshot.timeLeft + (snapshot.paused ? 0 : (now - snapshotReceivedAt) / 1000)));
  extraction.update(elapsed, duration);
}
function inputMessage() {
  const active = controlsCaptured() && inGame && !supplyMenu && controlsAvailable() && $('gameover').hidden && $('pause').hidden && !document.hidden;
  const crouch = active && (controllerPlaying ? controllerCrouched : CROUCH_KEYS.some(code => keys.has(code)));
  return { type: 'input',
    forward: active ? controllerPlaying ? controllerState.forward : Number(keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) : 0,
    strafe: active ? controllerPlaying ? controllerState.strafe : Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) : 0,
    yaw, pitch, crouch, sprint: active && !crouch && !myPlayer()?.crouched && (controllerPlaying ? controllerState.held.sprint : keys.has('ShiftLeft') || keys.has('ShiftRight')), jump: active && (controllerPlaying ? controllerState.held.jump : keys.has('Space')) };
}
function refreshOutside(self) {
  refreshExpedition(self);
  if (snapshot?.practice === true) { $('outside-warning').hidden = true; return; }
  const visible = inGame && self?.outside && self.alive && !['extraction', 'victory', 'gameover'].includes(snapshot?.phase);
  $('outside-warning').hidden = !visible;
  if (!visible) return;
  // Scaled by the difficulty on the server; French writes 1,5.
  const rateValue = Math.round(100 * (snapshot.outsideDamagePerSecond ?? 3) * characterStats(self).rainMultiplier) / 100, rate = String(rateValue).replace('.', ',');
  if (snapshot.expedition?.enabled && !self.downed && snapshot.phase !== 'lobby') {
    writeText($('outside-title'), () => t(self.outsideDamageActive ? 'expedition.rain' : self.rainExposed ? 'expedition.protected' : 'expedition.sheltered', { rate: getLanguage() === 'en' ? String(rateValue) : rate }));
    writeText($('outside-detail'), () => t(self.umbrella?.open && self.umbrella.remaining <= 15 ? 'expedition.low' : self.umbrella?.open ? 'expedition.foldHint' : 'expedition.rainHint'));
    return;
  }
  const title = self.downed ? 'À TERRE DEHORS' : snapshot.phase === 'lobby' ? 'DEHORS · REPÉRAGE' : self.outsideDamageActive ? `DEHORS · −${rate} VIE/S` : 'DEHORS · RENTRE À L’ABRI';
  const detail = self.downed ? `Un coéquipier peut te relever ici. Après, rentre : dehors −${rate} vie/s.` : snapshot.phase === 'lobby' ? 'Tu peux repérer les abords sans perdre de vie avant la nuit.' : 'Rentre dans la cabane pour arrêter les dégâts.';
  if ($('outside-title').textContent !== title) writeText($('outside-title'), title);
  if ($('outside-detail').textContent !== detail) writeText($('outside-detail'), detail);
}
function refreshExpedition(self) {
  const expedition = snapshot?.expedition;
  const visible = Boolean(inGame && expedition?.enabled && self?.alive && !['extraction', 'victory', 'gameover'].includes(snapshot.phase));
  $('expedition-kit').hidden = !visible;
  $('expedition-objective').hidden = !visible;
  if (!visible) return;
  const umbrella = self.umbrella ?? { open: false, remaining: 100 };
  $('expedition-kit').classList.toggle('open', umbrella.open);
  $('expedition-kit').classList.toggle('low', umbrella.remaining <= 15);
  writeText($('umbrella-label'), () => t(umbrella.remaining <= 0 ? 'expedition.empty' : umbrella.open ? 'expedition.open' : 'expedition.folded'));
  writeText($('umbrella-remaining'), () => t('expedition.remaining', { seconds: Math.ceil(umbrella.remaining) }));
  writeText($('umbrella-hint'), () => t(umbrella.remaining <= 0 ? 'expedition.repairHint' : umbrella.open ? 'expedition.foldHint' : 'expedition.openHint'));
  const generator = expedition.generator;
  const power = Math.round(100 * (generator?.power ?? 1));
  writeText($('generator-status'), () => t('expedition.generator', { power }));
  $('generator-bar').style.width = `${power}%`;
  $('expedition-objective').classList.toggle('low', power <= 30);
  const fuel = expedition.fuel;
  $('fuel-objective').hidden = !generator?.active;
  $('fuel-direction').hidden = !generator?.active;
  if (!generator?.active || !fuel) return;
  const carrier = snapshot.players.find(player => player.id === fuel.carrierId);
  writeText($('fuel-objective'), () => t(self.carryingFuel ? 'expedition.returnFuel' : carrier ? 'expedition.carrier' : 'expedition.findFuel', { name: carrier?.name ?? '' }));
  const target = self.carryingFuel ? generator : carrier ?? fuel;
  const dx = target.x - self.x, dz = target.z - self.z;
  const sector = (Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8;
  writeText($('fuel-direction'), () => t('expedition.distance', { direction: (getLanguage() === 'en' ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] : ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'])[sector], distance: Math.ceil(Math.hypot(dx, dz)) }));
}
$('reload-page').onclick = () => location.reload();
// The reload prompt belongs to the outdated-page message only.
function showMenuError(text) {
  writeText($('menu-error'), text); $('menu-error').hidden = false; $('reload-page').hidden = true;
}
function setJoinMode(value) {
  joinMode = value;
  $('create-tab').classList.toggle('active', !value); $('join-tab').classList.toggle('active', value);
  $('join-field').hidden = !value; $('ambiance-picker').hidden = value;
  $('level-picker').hidden = value || !mapContext.enabled;
  $('load-game-button').hidden = value; if (value) $('load-panel').hidden = true;
  writeText($('connect-button').firstElementChild, value ? 'Rejoindre le refuge' : 'Ouvrir le refuge');
  $('menu-error').hidden = true; $('reload-page').hidden = true;
}
function mapLabel(id = LEVEL.id) { return ['cabin', 'supermarket', 'hospital', 'funfair'].includes(id) ? t('levels.' + id) : t('levels.unknown'); }
function refreshMapLabels() {
  for (const id of ['lobby-map-name', 'pause-map-name']) $(id).textContent = mapLabel(snapshot?.mapId ?? LEVEL.id);
  // The pause menu reminds the team when bullets can hurt them.
  const friendlyFire = ['reduced', 'full'].includes(snapshot?.friendlyFire) ? snapshot.friendlyFire : null;
  $('pause-friendly-fire').hidden = friendlyFire === null;
  $('pause-friendly-fire-value').textContent = friendlyFire ? t(`friendlyFire.level.${friendlyFire}`) : '';
  const choice = $('level-choice').value || LEVEL.id;
  $('level-detail').textContent = t(choice === 'funfair' ? 'levels.funfairDetail' : choice === 'hospital' ? 'levels.hospitalDetail' : choice === 'supermarket' ? 'levels.supermarketDetail' : 'levels.cabinDetail');
}
function mapDraft(action) {
  return { action, name: ($('player-name').value.trim() || t('setup.namePlaceholder')).slice(0, 24), ambiance: homeAmbiance, sheet: mapSheetDraft ?? characterPicker.joinSheet(), language: getLanguage(), audio: { muted, volume } };
}
function refreshShareAddress() {
  if (room) writeText($('share-address'), mapContext.shareUrl(shareOrigin, room));
  $('room-share-panel').hidden = !room;
  if (room) {
    $('pause-room-code').textContent = room;
    $('room-share-address').value = mapContext.shareUrl(shareOrigin, room);
  }
}
async function copyRoomValue(kind) {
  if (!room) return;
  const value = kind === 'code' ? room : mapContext.shareUrl(shareOrigin, room);
  let copied = false;
  try { await navigator.clipboard.writeText(value); copied = true; } catch {}
  if (!copied) {
    const address = $('room-share-address'); address.focus(); address.select?.();
  }
  writeText($('room-share-status'), () => t(copied ? kind === 'code' ? 'roomShare.codeCopied' : 'roomShare.linkCopied' : 'roomShare.copyFallback', { code: room }));
}
function connect({ practice = false, load = null } = {}) {
  if (joining) return;
  practice = practice === true;
  // A loaded save always makes a new room; any other connection drops it.
  if (!load) cancelLoad();
  const code = $('room-code').value.trim().toUpperCase();
  if (!practice && !load && joinMode && !/^[A-Z0-9]{6}$/.test(code)) { showMenuError('Le code du refuge contient 6 caractères.'); return; }
  const joinRoom = !practice && !load && joinMode ? code : undefined;
  // A code or choice for a map this page does not offer stays here: the server answers.
  const coded = joinRoom ? mapForRoomCode(code) : null, chosen = $('level-choice').value;
  const targetMap = practice ? 'cabin' : joinRoom ? (mapContext.offers(coded) ? coded : LEVEL.id) : load ? LEVEL.id : mapContext.offers(chosen) ? chosen : LEVEL.id;
  if (mapContext.enabled && targetMap && targetMap !== LEVEL.id) {
    const action = practice ? 'practice' : joinRoom ? 'join' : 'create';
    if (!mapContext.navigate(targetMap, { ...mapDraft(action), ...(joinRoom ? { room: code } : {}) })) showMenuError(() => t('levels.transferFailed'));
    return;
  }
  // Only a room made here takes the picker's ambiance; joining keeps the room's.
  // The lock is read again: another tab may have set it.
  if (!familyLocked && readFamilyLock()) applyFamilyLock(true);
  const ambiance = load ? (isFrissonLike(load.ambiance) && !familyLocked ? load.ambiance : null)
    : !joinMode && isFrissonLike(homeAmbiance) && !familyLocked ? homeAmbiance : null;
  intentionalClose = true;
  if (websocket) websocket.close();
  joining = true; myId = null; snapshot = null;
  pendingPracticeEntry = practice;
  writeText($('practice-status'), '');
  sound.updateScene(null, false);
  $('connect-button').disabled = true; $('practice-button').disabled = true; $('menu-error').hidden = true; $('reload-page').hidden = true;
  const socket = new WebSocket(mapContext.socketUrl());
  websocket = socket;
  intentionalClose = false;
  const playerName = $('player-name').value.trim() || t('setup.namePlaceholder');
  try { localStorage.setItem('deadwood-name', playerName); } catch {}
  connectionDeadline = setTimeout(() => {
    if (websocket === socket && joining) { showMenuError('Le serveur ne répond pas. Vérifie l’adresse et le réseau.'); socket.close(); }
  }, 8000);
  const sheet = practice ? null : mapSheetDraft ?? characterPicker.joinSheet();
  mapSheetDraft = null;
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join', room: joinRoom, name: playerName, weapon: STARTER_WEAPON, ...(sheet ? { sheet } : {}), ...(practice ? { practice: true } : {}), ...(ambiance ? { ambiance } : {}), ...(pageBuild ? { build: pageBuild } : {}) })));
  socket.addEventListener('message', event => {
    if (socket !== websocket) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    // The server refuses an outdated page before admitting it; the welcome
    // comparison is the fallback when the join carried no build.
    if (message.type === 'outdated' || (message.type === 'welcome' && pageBuild && typeof message.build === 'string' && message.build !== pageBuild)) {
      clearTimeout(connectionDeadline); joining = false; pendingPracticeEntry = false; $('connect-button').disabled = false; $('practice-button').disabled = false;
      intentionalClose = true; socket.close(); websocket = null;
      showMenuError(() => t('version.outdated')); $('reload-page').hidden = false;
      return;
    }
    if (message.type === 'welcome') {
      clearTimeout(connectionDeadline); joining = false; $('connect-button').disabled = false; $('practice-button').disabled = false;
      myId = message.id; room = message.room; lastPhase = null; lastHostId = null; lastRoomPaused = false; pauseRequestTarget = null; cameraReady = false; aimReady = false; restartRequested = false; seatAdopted = null;
      recordAim('welcome');
      send({ type: 'impact-numbers', enabled: damageNumbers.enabled });
      reviveItems = [];
      extraction.reset();
      sound.updateScene(null, false);
      $('menu').hidden = true; $('lobby').hidden = false; $('pause').hidden = true; $('gameover').hidden = true;
      writeText($('lobby-code'), room); writeText($('hud-room'), room);
      updateConnection(true, `REFUGE ${room} · CONNECTÉ`);
      refreshShareAddress();
      const url = new URL(location.href);
      if (practice) { url.searchParams.delete('room'); url.searchParams.set('practice', '1'); }
      else { url.searchParams.delete('practice'); url.searchParams.set('room', room); }
      history.replaceState(null, '', url);
      $('load-panel').hidden = true;
      startUpload();
    } else if (message.type === 'state') {
      const oldSelf = myPlayer(); snapshot = message;
      refreshState(oldSelf);
      if (pendingPracticeEntry && myId && myPlayer()) {
        pendingPracticeEntry = false;
        if (snapshot.practice === true) enterGame();
      }
    } else if (message.type === 'event') onEvent(message);
    else if (message.type === 'impacts') onImpacts(message);
    else if (message.type === 'error') {
      if (joining) { clearTimeout(connectionDeadline); joining = false; pendingPracticeEntry = false; cancelLoad(); $('connect-button').disabled = false; $('practice-button').disabled = false; showMenuError(message.message); intentionalClose = true; socket.close(); }
      else toast(message.message);
    }
    else onSaveMessage(message);
  });
  socket.addEventListener('close', () => {
    if (socket !== websocket) return;
    clearTimeout(connectionDeadline); joining = false; pendingPracticeEntry = false; cancelLoad(); saveRequested = false; $('connect-button').disabled = false; $('practice-button').disabled = false;
    if (!intentionalClose) {
      if (myId) {
        leave(false); showMenuError('La connexion au refuge a été coupée. Rejoins à nouveau la partie.');
      } else if ($('menu-error').hidden) showMenuError('Connexion impossible. Vérifie que le serveur est lancé et que tu utilises la bonne adresse.');
      updateConnection(false, 'CONNEXION INTERROMPUE');
    }
  });
  socket.addEventListener('error', () => { if (joining) showMenuError('Impossible de joindre le serveur. Vérifie son adresse.'); });
}
function playerList(target, results = false) {
  const children = snapshot.players.map((player, index) => {
    const li = document.createElement('li');
    const badge = document.createElement('span'); badge.className = 'player-token'; badge.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span'); name.textContent = player.name + (player.id === myId ? t('player.you') : ''); companionBadge(player, name); characterBadge(player, name);
    // A companion is never "connected": it plays on the host's computer.
    const status = document.createElement('small'); status.textContent = player.waiting ? t(player.ready ? 'admission.readyBadge' : 'admission.waitingBadge') : results ? hudText('results.player', player, `${player.kills} élim. · ★ ${player.score}`) : player.companion === true ? '' : translateMessage(player.id === snapshot.hostId ? 'HÔTE' : 'CONNECTÉ');
    li.append(badge, name, status); return li;
  });
  target.replaceChildren(...children);
}
function refreshState(oldSelf) {
  refreshMapLabels();
  if (!snapshot || !myId) return;
  snapshotReceivedAt = performance.now(); trackCompanionsBrain();
  syncAmbiance(); refreshEnemyGuide();
  const self = myPlayer(); if (!self) return;
  syncCharacterSheet();
  if (oldSelf?.waiting && !self.waiting) { aimReady = false; cameraReady = false; }
  const waiting = self.waiting === true && !finishedPhase(snapshot.phase) && snapshot.phase !== 'extraction';
  $('admission-panel').hidden = !waiting;
  $('start-button').hidden = waiting;
  if (waiting) {
    controllerPlaying = false; inGame = false; $('lobby').hidden = false; $('menu').hidden = true; $('hud').hidden = true; $('pause').hidden = true;
    $('admission-ready').disabled = self.ready === true;
    writeText($('admission-status'), () => t(self.ready ? 'admission.ready' : 'admission.waiting'));
    refreshSeatClaims();
    document.body.classList.remove('playing'); flashlight.visible = false;
  }
  // Initialize once on admission, before mouse input can be accepted. Ordinary
  // snapshots and camera-height resets must never overwrite the local aim.
  initializeAim(self);
  const paused = snapshot.paused === true, pauseChanged = paused !== lastRoomPaused;
  if (pauseChanged) {
    resetInput();
    meleeAnimations.clear(); sound.releaseMelee?.(); sound.releaseAssault?.();
    for (const stream of flameStreams.values()) stream.stop();
    muzzleUntil = teamMuzzleUntil = 0; muzzleLight.intensity = teamMuzzleLight.intensity = 0;
    closeSupplyMenu(false);
    if (paused) document.exitPointerLock?.();
    else if (snapshot.phase === 'extraction') $('pause').hidden = true;
    lastFrame = performance.now();
  }
  if (pauseRequestTarget === paused) pauseRequestTarget = null;
  lastRoomPaused = paused;
  if (self.umbrella?.open) { firing = false; fireAudioWeapon = null; cancelMelee(false); stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); flameStreams.get(myId)?.stop(); }
  if(!meleeProfile(self.weapon)||!self.alive||self.downed)cancelMelee(false);
  const weaponChanged = selectedWeaponId(oldSelf) !== selectedWeaponId(self);
  if(!scopeControlsActive(self)||weaponChanged)setScope(false);
  if(supplyMenu && (!self.alive || self.downed || !controlsAvailable() || (supplyMenu.menu === 'station' && snapshot.wave < stationUnlockWave()) || (supplyMenu.menu === 'crate' && (snapshot.supplyCrate?.id !== supplyMenu.crateId || snapshot.supplyCrate?.claimed?.includes(myId))))) closeSupplyMenu(false);
  if(supplyMenu)refreshSupplyMenu();
  const practice = snapshot.practice === true;
  if ($('practice-controls').hidden === practice) refreshPracticeControls();
  if (minigunSpinRequested && self.minigunSpinning) minigunSpinConfirmed = true;
  else if (minigunSpinRequested && minigunSpinConfirmed) stopMinigunSpin();
  if (reloadSoundWeapon !== null) {
    if (!inGame || !self.alive || self.downed || weaponChanged || self.weapon !== reloadSoundWeapon || !['countdown', 'wave', 'intermission'].includes(snapshot.phase)) stopReloadAudio(true);
    else if (self.reloading) reloadSoundConfirmed = true;
    else if (reloadSoundConfirmed) stopReloadAudio();
  }
  if (secondaryReloadAudio) {
    const stock = dualStock(self);
    if (!inGame || !self.alive || self.downed || !stock || stock.weaponId !== secondaryReloadAudio.weaponId || !['countdown', 'wave', 'intermission'].includes(snapshot.phase)) stopSecondaryReloadAudio();
    else if (stock.reloading) secondaryReloadAudio.confirmed = true;
    else if (secondaryReloadAudio.confirmed) stopSecondaryReloadAudio();
  }
  if (self.reloading) { fireAudioWeapon = null; reloadAudioConfirmed = true; }
  else if (reloadAudioConfirmed) { reloadAudioConfirmed = false; reloadAudioRequested = false; fireAudioWeapon = firing ? self.weapon : null; }
  else if (reloadAudioRequested && !weaponChanged && oldSelf?.weapon === self.weapon && oldSelf.ammo !== self.ammo) { reloadAudioRequested = false; fireAudioWeapon = firing ? self.weapon : null; }
  if (!inGame || paused || !self.alive || self.downed || !['countdown', 'wave', 'intermission'].includes(snapshot.phase)) sound.releaseFire?.();
  else if (self.reloading || self.ammo <= 0) releaseHandFire();
  if (!inGame || !['countdown', 'wave', 'intermission'].includes(snapshot.phase)) sound.releasePump?.();
  else for (const player of snapshot.players) if (!player.alive || player.downed || player.reloading || player.weapon !== 'shotgun') sound.releasePump?.(player.id);
  const host = snapshot.hostId === myId;
  const phaseChanged = snapshot.phase !== lastPhase;
  const hostChanged = snapshot.hostId !== lastHostId;
  if (hostChanged && !host) pauseRequestTarget = null;
  if (finishedPhase(lastPhase) && !finishedPhase(snapshot.phase) && !inGame) $('lobby').hidden = false;
  if (!$('lobby').hidden) {
    playerList($('lobby-players')); renderAmbiance(); renderDifficulty(); renderFriendlyFire(); renderCompanions(); renderCharacterChoice();
    refreshStartButton();
    writeText($('lobby-note'), practice ? () => t('practice.pauseDescription') : snapshot.phase === 'lobby' ? host ? 'Tu peux commencer seul. Les autres peuvent te rejoindre en partie.' : 'L’hôte lance la nuit. Tu peux déjà visiter le refuge.' : 'La nuit a commencé. Ton équipe t’attend dans la cabane.');
  }
  writeText($('phase-label'), paused ? () => t('pause.stoppedLabel') : practice ? () => t('practice.title') : phaseNames[snapshot.phase] || 'REFUGE');
  const maxWaves = snapshot.maxWaves ?? MAX_WAVES;
  const practiceTargetCount=snapshot.practiceTargets??snapshot.zombies.length;
  writeText($('wave-number'), practice ? () => t('practice.invulnerable') : `${String(Math.min(maxWaves, Math.max(1, snapshot.wave))).padStart(2, '0')}/${maxWaves}`);
  const finalBoss = snapshot.zombies.some(zombie => zombie.boss);
  writeText($('wave-details'), raidDetails(practice, practiceTargetCount) ?? (practice ? () => t('practice.details', { count: practiceTargetCount }) : snapshot.phase === 'wave' ? `${finalBoss ? 'COLOSSE FINAL · ' : ''}${snapshot.remaining} ${snapshot.remaining > 1 ? 'menaces restantes' : 'menace restante'}` : snapshot.phase === 'lobby' ? host ? 'Échap pour lancer la nuit' : 'En attente de l’hôte' : snapshot.phase === 'extraction' ? `${Math.ceil(snapshot.timeLeft)} s · L’hélicoptère vient vous chercher` : snapshot.phase === 'victory' ? 'Les survivants ont quitté Deadwood' : snapshot.phase === 'gameover' ? 'La nuit est terminée' : `${Math.ceil(snapshot.timeLeft)} s · ${snapshot.phase === 'intermission' ? 'Ravitaillement effectué' : 'Prépare-toi'}`));
  refreshRaidResult();
  const melee = meleeProfile(self.weapon);
  writeText($('combat-tip'), melee?()=>t('melee.tip',{light:melee.light.range,heavy:melee.heavy.range,targets:melee.maxTargets+reinforcedMeleeTargets(Math.max(0, effectiveBonusLevel(self, 'stone')))}): self.weapon === 'sniper' ? () => t('sniper.scope') : self.weapon === 'flamethrower' ? () => t('combat.flame', { seconds: FLAMETHROWER.burnDuration }) : self.weapon === 'rocket' ? () => t('combat.rocket', { radius: ROCKET.radiusDamage }) : `TÊTE ×${Number(snapshot.headshotMultiplier ?? 2.2).toFixed(1)} · ALIGNE LES ZOMBIES POUR LES TRAVERSER`);
  $('combat-tip').hidden = ['extraction', 'victory', 'gameover'].includes(snapshot.phase);
  $('crosshair').hidden = !controlsAvailable();
  document.body.classList.toggle('extracting', ['extraction', 'victory'].includes(snapshot.phase));
  writeText($('hp-value'), Math.max(0, Math.ceil(self.hp)));
  $('hp-bar').style.width = `${Math.max(0, Math.min(100, self.hp / (self.maxHp || 100) * 100))}%`;
  $('hp-bar').style.background = self.hp < 30 ? '#da8767' : '#abc790';
  // The vest row only appears while some armor is left.
  const armor = Math.max(0, Math.ceil(self.armor ?? 0));
  $('armor-row').hidden = armor <= 0;
  writeText($('armor-value'), armor);
  $('armor-bar').style.width = `${Math.min(100, armor)}%`;
  writeText($('points-value'), self.points ?? 0);
  writeText($('personal-score'), practice ? () => t('practice.score', { count: self.kills }) : `${self.kills} ÉLIMINATIONS · SCORE ${self.score}`);
  refreshNextWave(self);
  // The score panel, top right: a star and the score, the kills under it.
  writeScore(self);
  // The kills: a big number of their own (owner, 13 October), its label beside.
  writeText($('kills-count'), Math.max(0, Math.round(self.kills ?? 0)).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'fr-FR'));
  writeText($('kills-value'), () => t(practice ? self.kills === 1 ? 'practice.targetLabel' : 'practice.targetsLabel' : self.kills === 1 ? 'hud.killLabel' : 'hud.killsLabel'));
  writeText($('weapon-name'), self.weapon ? names[self.weapon] : () => t('ground.unarmed'));
  const backpackMultiplier = self.backpack === true ? BACKPACK.movementMultipliers[carriedWeapons(self).length] ?? 1 : 1;
  const movementMultiplier = Number.isFinite(self.movementMultiplier) ? self.movementMultiplier : (WEAPON_MOVEMENT[self.weapon] ?? 1) * backpackMultiplier;
  const mobility = Math.round((movementMultiplier - 1) * 100);
  writeText($('weapon-mobility'), mobility === 0 ? 'DÉPLACEMENT NORMAL' : `DÉPLACEMENT ${mobility > 0 ? '+' : '−'}${Math.abs(mobility)} %`);
  writeText($('posture-status'), () => t(self.crouched ? 'posture.crouched' : 'posture.standing'));
  $('posture-status').classList.toggle('crouched', self.crouched === true);
  refreshAmmunition(self);
  $('active-bonus').hidden = !(self.bonus || self.sheetDebt) || !inGame || !controlsAvailable();
  writeText($('active-bonus'), self.bonus || self.sheetDebt ? () => t('supply.active', {name: bonusSummary(self)}) : '');
  refreshSurvivorSheet(self);
  $('revive-kit').hidden = self.reviveKit !== true;
  writeText($('revive-kit-key'), controllerPlaying ? (self.downed ? 'RB' : '↑') : 'F');
  $('downed').hidden = !self.downed && self.alive;
  writeText($('downed').firstElementChild, self.alive ? 'À TERRE' : 'HORS COMBAT');
  // Down: who is getting you up and how long it takes, or how to use your kit.
  const reviver = self.revivedBy && self.revivedBy !== myId ? snapshot.players.find(player => player.id === self.revivedBy) : null;
  const reviving = self.alive && self.downed && self.reviveLeft > 0 && (reviver || self.revivedBy === myId);
  $('revive-progress').hidden = !reviving;
  if (reviving) $('revive-progress-bar').style.width = `${Math.round(100 * Math.max(0, Math.min(1, 1 - self.reviveLeft / (reviver ? reviveDuration(reviver) : REVIVE.kitDuration))))}%`;
  if (self.alive && self.downed && reviver && self.reviveLeft > 0) writeText($('downed').lastElementChild, () => t('downed.beingRevived', { name: reviver.name, seconds: Math.ceil(self.reviveLeft) }));
  else if (self.alive && self.downed && self.revivedBy === myId && self.reviveLeft > 0) writeText($('downed').lastElementChild, () => t('downed.selfReviving', { seconds: Math.ceil(self.reviveLeft) }));
  else if (self.alive && self.downed && self.reviveKit === true) writeText($('downed').lastElementChild, () => t('downed.kitHint', { key: controllerPlaying ? 'RB' : 'F', seconds: Math.ceil(self.bleedOutLeft) }));
  else writeText($('downed').lastElementChild, self.alive ? `${self.outside ? 'Un coéquipier peut te relever en maintenant E, même dehors. Rentre après la réanimation.' : 'Un coéquipier peut te relever en maintenant E (5 s).'} ${Math.ceil(self.bleedOutLeft)} s avant l’élimination.` : 'Tu reviendras à la prochaine vague si l’équipe tient.');
  if (self.weapon !== gunType || selectedWeaponId(self) !== gunId) equip(self.weapon, selectedWeaponId(self));
  for (const door of snapshot.doors) world.setDoor(door.id, door.hp / door.maxHp, door.boards, door.sealed);
  const defendedDoors = snapshot.doors.filter(door => !door.sealed && !door.sealPending);
  const breaches = defendedDoors.filter(door => Array.isArray(door.boards) ? door.boards.slice(0, 4).every(hp => hp <= 0) : door.hp <= 0).length;
  writeText($('door-status'), () => t(breaches === 1 ? 'hud.breach' : breaches > 1 ? 'hud.breaches' : 'hud.secured', { count: breaches || defendedDoors.length }));
  // The old shelter badge was decoration; only a breach is worth a line.
  $('breach-alert').hidden = !(breaches > 0);
  syncActors(); refreshTeam();
  if (self.hp < lastHealth && !self.downed) damageUntil = performance.now() + 350;
  if (inGame && self.hp < lastHealth && ambianceHooks.hurt) ambianceHook('hurt', { amount: lastHealth - self.hp, hp: self.hp, maxHp: Number.isFinite(self.maxHp) ? self.maxHp : 100, source: hurtSource });
  hurtSource = null; hurtSourceLoss = 0;
  lastHealth = self.hp;
  if (finishedPhase(snapshot.phase)) {
    playerList($('results-list'), true); $('restart-button').hidden = !host; renderAmbiance('-results'); renderDifficulty('-results'); renderFriendlyFire('-results'); renderCompanions('-results'); renderCharacterChoice('-results');
    $('results-wait').hidden = host;
    writeText($('results-wait'), 'L’hôte peut lancer une nouvelle nuit. Tu peux aussi quitter le refuge.');
    $('gameover').classList.toggle('victory', snapshot.phase === 'victory');
    writeText($('gameover-eyebrow'), snapshot.phase === 'victory' ? 'LE JOUR S’EST LEVÉ' : 'LA LUMIÈRE S’EST ÉTEINTE');
    writeText($('gameover-title'), snapshot.phase === 'victory' ? 'Vous êtes rentrés.' : 'Jusqu’au dernier.');
    const kills = snapshot.players.reduce((sum, player) => sum + player.kills, 0);
    const score = snapshot.players.reduce((sum, player) => sum + player.score, 0);
    writeText($('gameover-result'), snapshot.phase === 'victory' ? `${maxWaves} vagues traversées. L’hélicoptère vous a ramenés à l’abri. ${kills} éliminations · score d’équipe ${score}.` : `Votre équipe a atteint la vague ${snapshot.wave}/${maxWaves}. La forêt se souviendra de vous.`);
    if (hostChanged && !host) { restartRequested = false; $('restart-button').disabled = false; }
  }
  if (phaseChanged) {
    if (['countdown', 'extraction', 'victory', 'gameover'].includes(snapshot.phase)) {
      pendingExplosionSounds.length = 0; resetCombatFeel({ finale: snapshot.phase === 'extraction' });
      world.effects?.particles.clear();
      for (const effect of explosions.splice(0)) { scene.remove(effect.mesh); effect.dispose(); }
      for (const stream of flameStreams.values()) stream.stop();
    }
    if (snapshot.phase === 'wave') {
      if (practice) banner(() => t('practice.title'), () => t('practice.ready'));
      else banner('ILS ARRIVENT', `VAGUE ${String(snapshot.wave).padStart(2, '0')}`);
    }
    if (snapshot.phase === 'intermission') { banner('VOUS AVEZ TENU', 'REPRENEZ SOUFFLE'); showWaveCard(); } else hideWaveCard();
    recordAim('phase-change', { previousPhase: lastPhase });
    if (snapshot.phase === 'countdown') { cameraReady = false; if (inGame) banner('RESTEZ ENSEMBLE', 'LA NUIT COMMENCE'); }
    if (snapshot.phase === 'extraction') {
      inGame = true; $('menu').hidden = true; $('lobby').hidden = true; $('hud').hidden = false; $('pause').hidden = true; $('gameover').hidden = true;
      document.body.classList.add('playing'); flashlight.visible = false; if (gun) gun.visible = false;
      resetInput(); document.exitPointerLock?.();
      banner(`VOUS AVEZ TENU LES ${maxWaves} VAGUES`, 'EXTRACTION'); sound.extraction();
    }
    if (finishedPhase(snapshot.phase)) {
      $('pause').hidden = true; $('lobby').hidden = true; $('gameover').hidden = false;
      if (snapshot.phase === 'victory') sound.victory();
      resetInput(); document.exitPointerLock?.();
    } else if (finishedPhase(lastPhase)) {
      $('gameover').hidden = true;
      $('restart-button').disabled = false;
      if (restartRequested) { restartRequested = false; lastHealth = 100; enterGame(); }
      else if (inGame && !controlsCaptured()) showPause();
    }
    if (!['extraction', 'victory'].includes(snapshot.phase) && ['extraction', 'victory'].includes(lastPhase)) { extraction.reset(); cameraReady = false; flashlight.visible = inGame; }
    lastPhase = snapshot.phase;
  }
  if ((paused && ($('pause').hidden || pauseChanged || hostChanged)) || (!$('pause').hidden && (phaseChanged || hostChanged || pauseChanged))) showPause();
  lastHostId = snapshot.hostId;
  refreshPauseControls();
  if (oldSelf?.downed && !self.downed && self.alive) toast('Tu es de nouveau sur pied.');
  refreshInteraction(self); refreshOutside(self); refreshRadarMap(performance.now()); sound.updateScene(snapshot, inGame && !paused);
  if (pauseChanged && paused) world.update(visualSeconds(), {snapshot,myId,active:inGame,camera,survivors:playerMeshes});
}
// French keeps zero singular, as the existing threat count does.
function raidPlural(count) { return getLanguage() === 'en' ? count !== 1 : count > 1; }
// Raid waves split the threat count; the stand counts drill hits; the break
// before a raid wave says so. Null keeps the ordinary wave details.
function raidDetails(practice, targets) {
  const raid = snapshot.raid;
  if (practice) return drillHits ? () => `${t('practice.details', { count: targets })} · ${t('raid.drillHits', { count: drillHits })}` : null;
  if (snapshot.phase === 'wave' && raid?.triggered && !raid.cleared) {
    const infected = snapshot.zombiesRemaining ?? Math.max(0, snapshot.remaining - raid.remaining), raiders = raid.remaining;
    return () => `${t(raidPlural(infected) ? 'raid.infectedMany' : 'raid.infectedOne', { count: infected })} · ${t(raidPlural(raiders) ? 'raid.raiderMany' : 'raid.raiderOne', { count: raiders })}`;
  }
  if (snapshot.phase === 'intermission' && snapshot.nextRaidWave) {
    const timer = `${Math.ceil(snapshot.timeLeft)} s · Ravitaillement effectué`;
    return () => `${translateMessage(timer)} · ${t('raid.nextWave')}`;
  }
  return null;
}
// The cleared plan stays in the snapshot for the whole break, so the outcome
// outlives the intermission banner and toast.
function refreshRaidResult() {
  const raid = snapshot.phase === 'intermission' && snapshot.raid?.cleared ? snapshot.raid : null;
  $('raid-result').hidden = !raid;
  writeText($('raid-result'), raid ? () => {
    const outcome = raid.retreated > 0 ? t('raid.retreated') : t(raidPlural(raid.killed) ? 'raid.repelled' : 'raid.repelledOne', { index: raid.index, count: RAIDS.waves.length, killed: raid.killed });
    return raid.bonus > 0 ? `${outcome} · ${t('raid.bonus', { bonus: raid.bonus })}` : outcome;
  } : '');
}
function refreshTeam() {
  const children = snapshot.players.map((player, index) => {
    const row = document.createElement('div'); row.className = 'teammate' + (!player.waiting && (player.downed || !player.alive) ? ' downed' : '');
    row.dataset.playerId = player.id;
    const dot = document.createElement('i'); dot.style.background = player.downed || !player.alive ? '#d38a65' : `#${colors[index % colors.length].toString(16)}`;
    const name = document.createElement('span'); name.textContent = player.name + (player.id === myId ? t('player.you') : ''); companionBadge(player, name);
    const coins = document.createElement('small'); coins.className = 'team-coins'; coins.hidden = player.waiting === true;
    coins.textContent = t('team.coins', { count: Math.max(0, Math.floor(Number.isFinite(player.points) ? player.points : 0)).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'fr-FR') });
    name.append(coins);
    const health = document.createElement('small'); health.textContent = player.waiting ? t(player.ready ? 'admission.readyBadge' : 'admission.waitingBadge') : player.downed ? translateMessage('À TERRE') : !player.alive ? 'K.O.' : Math.ceil(player.hp);
    const track = document.createElement('div'); track.className = 'team-health'; const bar = document.createElement('i'); bar.style.width = `${Math.max(0, Math.min(100, player.hp / (player.maxHp || 100) * 100))}%`; track.append(bar);
    row.append(dot, name, health, track);
    if (player.armor > 0 && player.alive && !player.downed) {
      const armorTrack = document.createElement('div'); armorTrack.className = 'team-armor';
      const armorBar = document.createElement('i'); armorBar.style.width = `${Math.min(100, player.armor)}%`; armorTrack.append(armorBar);
      row.append(armorTrack);
    }
    return row;
  });
  $('team-list').replaceChildren(...children);
}
function syncActors() {
  trackMotion(zombieMotion, snapshot.zombies, Number(snapshot.time)); trackMotion(playerMotion, snapshot.players, Number(snapshot.time));
  const pickups = snapshot.pickups || [], pickupIds = new Set(pickups.map(pickup => pickup.id));
  for (const [id, mesh] of pickupMeshes) if (!pickupIds.has(id)) { scene.remove(mesh); pickupMeshes.delete(id); }
  for (const pickup of pickups) {
    let mesh = pickupMeshes.get(pickup.id);
    if (mesh && (mesh.userData.kind !== pickup.kind || Boolean(mesh.userData.special) !== Boolean(pickup.special) || (pickup.kind === 'weapon' && mesh.userData.weapon !== pickup.weapon) || (pickup.kind === 'bonus' && (mesh.userData.bonusKind !== pickup.bonus?.kind || mesh.userData.bonusLevel !== (pickup.bonus?.level ?? 1))))) { scene.remove(mesh); pickupMeshes.delete(pickup.id); mesh = null; }
    if (!mesh) { mesh = pickup.kind === 'weapon' ? createGroundWeapon(pickup.weapon) : createPickup(pickup.kind, Boolean(pickup.special), pickup.kind === 'bonus' ? pickup.bonus?.kind : undefined); scene.add(mesh); if (pickup.kind === 'bonus') { mesh.userData.bonusKind = pickup.bonus?.kind; mesh.userData.bonusLevel = pickup.bonus?.level ?? 1; } pickupMeshes.set(pickup.id, mesh); }
    setPickupFill(mesh, pickup.fill);
    // Coins pulled by a survivor glide between snapshots instead of hopping.
    const glide = pickup.kind === 'points' && mesh.userData.placed && mesh.position.distanceTo?.(pickupPoint.set(pickup.x, pickup.y, pickup.z)) < 3;
    if (glide) (mesh.userData.glideTo ??= new THREE.Vector3()).set(pickup.x, pickup.y, pickup.z);
    else { mesh.position.set(pickup.x, pickup.y, pickup.z); mesh.userData.glideTo = null; mesh.userData.placed = true; }
    if (pickup.kind === 'weapon') setGroundWeaponPose(mesh, pickup);
  }
  const liveGrenades = snapshot.grenades || [], grenadeIds = new Set(liveGrenades.map(item => item.id));
  for (const [id, mesh] of grenadeMeshes) if (!grenadeIds.has(id)) { scene.remove(mesh); grenadeMeshes.delete(id); }
  for (const item of liveGrenades) {
    let mesh = grenadeMeshes.get(item.id);
    if (!mesh) { mesh = createGrenadeProjectile(); mesh.position.set(item.x, item.y, item.z); grenadeMeshes.set(item.id, mesh); scene.add(mesh); }
    mesh.userData.target = new THREE.Vector3(item.x, item.y, item.z);
  }
  const zombieIds = new Set(snapshot.zombies.map(zombie => zombie.id));
  for (const [id, mesh] of zombieMeshes) if (!zombieIds.has(id)) { scene.remove(mesh); disposeZombie(mesh); zombieMeshes.delete(id); if (mesh.userData.raider) sound.releaseRaider?.(id); }
  for (const zombie of snapshot.zombies) {
    let mesh = zombieMeshes.get(zombie.id);
    const boss = zombie.boss === true, raider = zombie.kind === 'raider';
    if (mesh && (mesh.userData.kind !== zombie.kind || mesh.userData.boss !== boss || mesh.userData.maxHp !== zombie.maxHp)) { scene.remove(mesh); disposeZombie(mesh); zombieMeshes.delete(zombie.id); mesh = null; }
    if (!mesh) {
      mesh = raider ? createRaider({ weapon: zombie.weapon, maxHp: zombie.maxHp, id: zombie.id }) : createZombie(zombie.kind, boss, zombie.maxHp, zombie.id);
      mesh.position.set(zombie.x, zombie.y, zombie.z); scene.add(mesh); zombieMeshes.set(zombie.id, mesh);
      if (raider) { mesh.userData.renderYaw = Number.isFinite(zombie.yaw) ? zombie.yaw : 0; prepareRaiderPrograms(mesh); rememberRaider(zombie.id); }
    }
    if (raider) {
      setSurvivorWeapon(mesh, zombie.weapon);
      mesh.userData.state = { pitch: Number.isFinite(zombie.pitch) ? zombie.pitch : 0, crouched: zombie.crouched === true, reloading: zombie.reloading === true };
    }
    mesh.scale.setScalar(zombie.scale ?? (boss ? 1.32 : zombie.kind === 'brute' ? 1.22 : 1));
    mesh.userData.target = new THREE.Vector3(zombie.x, zombie.y, zombie.z); mesh.userData.yaw = zombie.yaw;
    mesh.userData.pushX = Number.isFinite(zombie.pushX) ? zombie.pushX : 0;
    mesh.userData.pushZ = Number.isFinite(zombie.pushZ) ? zombie.pushZ : 0;
    setZombieBurn(mesh, zombie.burning === true && zombie.burnLeft > 0);
    setZombieHealth(mesh, zombie.hp, zombie.maxHp);
    setZombieFrost(mesh, zombie.frostSlow ?? 0);
    if (raider && snapshot.paused === true) animateRaider(mesh, { ...mesh.userData.state, time: visualSeconds(), delta: 0 });
  }
  const playerIds = new Set(snapshot.players.filter(player => player.id !== myId && !player.waiting).map(player => player.id));
  for(const id of meleeAnimations.keys())if(!snapshot.players.some(player=>player.id===id))meleeAnimations.delete(id);
  for (const [id, effect] of flameStreams) if (!snapshot.players.some(player => player.id === id || `${player.id}:secondary` === id)) { effect.dispose(); flameStreams.delete(id); }
  for (const [id, mesh] of playerMeshes) if (!playerIds.has(id)) { scene.remove(mesh); playerMeshes.delete(id); }
  snapshot.players.forEach((player, index) => {
    if (player.waiting) return;
    const melee=meleeProfile(player.weapon);
    if(meleeAnimations.has(player.id) && meleeAnimations.get(player.id).weapon !== player.weapon){meleeAnimations.delete(player.id);sound.releaseMelee?.(player.id);}
    if(!melee||!player.alive||player.downed){meleeAnimations.delete(player.id);sound.releaseMelee?.(player.id);}
    else if(melee[player.meleeAttack]&&player.meleeWindupLeft>0&&meleeAnimations.get(player.id)?.attackId!==player.meleeAttackId&&(player.id!==myId||!meleeSuppressed)){
      const profile=melee[player.meleeAttack];
      meleeAnimations.set(player.id,{weapon:player.weapon,attack:player.meleeAttack,attackId:player.meleeAttackId,startedAt:visualSeconds()-Math.max(0,profile.windup-player.meleeWindupLeft),windup:profile.windup,duration:profile.duration});
    }
    if (!player.alive || player.downed || player.reloading || player.weapon !== 'flamethrower' || player.ammo <= 0) flameStreams.get(player.id)?.stop();
    const secondary = player.dualWield ? player.hands?.secondary : null;
    if (!player.alive || player.downed || !secondary || secondary.reloading || secondary.weapon !== 'flamethrower' || secondary.ammo <= 0) flameStreams.get(`${player.id}:secondary`)?.stop();
    if (player.id === myId) return;
    let mesh = playerMeshes.get(player.id);
    if (!mesh) {
      // Who it is picks the Frisson character (SURVIVORS.md); Famille ignores it.
      mesh = createSurvivor(colors[index % colors.length], { identity: { id: player.id, name: player.name, companion: player.companion === true, look: player.look ?? null } });
      mesh.position.set(player.x, player.y, player.z); scene.add(mesh); playerMeshes.set(player.id, mesh);
    }
    mesh.userData.target = new THREE.Vector3(player.x, player.y, player.z);
    mesh.userData.yaw = player.yaw;
    mesh.userData.state = { pitch: player.pitch, backpack: player.backpack === true, crouched: player.crouched === true, downed: player.downed || !player.alive, secondary: player.hands?.secondary ?? null, reloading: player.reloading === true, spinning: player.minigunSpinning === true, spinLeft: player.minigunSpinLeft, spinDuration: snapshot.minigunSpinDuration ?? MINIGUN_TIMING.windup };
    setSurvivorWeapon(mesh, player.weapon);
    setSurvivorSecondaryWeapon(mesh, player.dualWield ? player.hands?.secondary?.weapon : null);
    if (snapshot.paused === true) animateSurvivor(mesh,{...mesh.userData.state,time:visualSeconds(),delta:0});
  });
}
// The first raider of the page compiles its muzzle-flash program before any
// shot, so a solo player never stalls on the first incoming burst.
function prepareRaiderPrograms(mesh) {
  if (raiderProgramsReady || !mesh.userData.flash?.parent) return;
  raiderProgramsReady = true;
  mesh.userData.flash.visible = true; renderer.compile?.(scene, camera); mesh.userData.flash.visible = false;
}
function equip(type, id = type) {
  const changed = type !== gunType || id !== gunId;
  if(changed){setScope(false);cancelMelee(false);meleeRequestUntil=-Infinity;}
  if (changed) stopMinigunSpin();
  if (changed) { stopReloadAudio(); reloadSoundCancelled = false; reloadAudioRequested = false; reloadAudioConfirmed = false; }
  if (changed) sound.releasePump?.(myId);
  if (automaticWeapons.includes(gunType) && changed) sound.releaseFire?.(gunType, myId);
  if (changed) flameStreams.get(myId)?.stop();
  if (changed) { fireAudioWeapon = firing && !myPlayer()?.reloading ? type : null; triggerSoundPlayed = false; }
  if (gun) { camera.remove(gun); gun.userData.heatMaterial?.dispose?.(); }
  if (changed) gunHeat.get(myId)?.reset();
  gun = type ? createWeapon(type) : null; gunType = type; gunId = id;
  if (gun) { applyWeaponViewPose(gun); camera.add(gun); gun.visible = inGame; }
  // Gun geometry stays attached to the viewpoint; its depth is still correct in the room.
}
function onEvent(event) {
  if (!myId) return;
  // The room's pause takes effect with its event, before the next snapshot:
  // kills right after a resume are never dropped as if still paused.
  if (event.event === 'pause' && snapshot && typeof event.paused === 'boolean') snapshot.paused = event.paused;
  const local = event.id === myId;
  const audible = inGame && snapshot?.paused !== true && ['countdown', 'wave', 'intermission'].includes(snapshot?.phase);
  if (ambianceHooks.impact) ambianceShot = (ambianceShot + 1) | 0;
  if (local && event.event === 'hit') noteHurtSource(event);
  if (local && event.event === 'join-admitted') toast(() => t('admission.joining'));
  if (event.event === 'game-restored') toast(() => restoredText(event), ['offline', 'unsupported'].includes(event.companions) ? 8 : 6);
  if (event.event === 'seat-bound' && !local && typeof event.name === 'string') toast(() => t('save.seatTaken', { name: event.name }));
  if (event.event === 'revive-bonus') onReviveBonus(event);
  if (snapshot?.paused === true && ['shot','bullet-impact','melee-start','melee-hit','reload','hit','kill','explosion','grenade-thrown','board','door','raider-shot','raid','raid-squad','raid-retreat','raider-left','raid-cleared','drill-hit'].includes(event.event)) return;
  // The shooter learns they hurt a teammate from the victim's hit event, which
  // is not local: the red skull, the red number and the callout.
  if (event.event === 'hit' && event.source === 'friendly' && event.shooterId === myId && !local) friendlyHitFeedback(event);
  if (event.event === 'pause-denied' && local) {
    pauseRequestTarget = null; refreshPauseControls();
    toast(() => t(event.reason === 'host' ? 'pause.hostOnly' : event.reason === 'seats' ? 'pause.seats' : 'pause.unavailable'));
    return;
  }
  if(['down','leave','weapon-drop','weapon-pickup','purchase','melee-cancel'].includes(event.event)){
    meleeAnimations.delete(event.id);sound.releaseMelee?.(event.id);
    if(local)meleeSuppressed=true;
  }
  if(event.event==='melee-start'){
    const weapon=event.weapon??snapshot?.players.find(player=>player.id===event.id)?.weapon;
    const profile=meleeProfile(weapon)?.[event.attack];
    if(!profile||!Number.isFinite(event.attackId)||(meleeSeen.get(event.id)??-Infinity)>=event.attackId)return;
    meleeSeen.set(event.id,event.attackId);
    if(!audible||(local&&(!meleeControlsActive()||meleeSuppressed)))return;
    const windup=Number.isFinite(event.windup)?event.windup:profile.windup,duration=Number.isFinite(event.duration)?event.duration:profile.duration;
    const age=Math.max(0,Number(snapshot?.time??event.time)-Number(event.time??snapshot?.time??0));
    const startedAt=visualSeconds()-age;
    meleeAnimations.set(event.id,{weapon,attack:event.attack,attackId:event.attackId,startedAt,windup,duration});
    if(local)meleeRequestUntil=Math.max(meleeRequestUntil,startedAt+duration);
    const player=snapshot.players.find(player=>player.id===event.id),self=myPlayer();
    const distance=local?0:player&&self?Math.hypot(player.x-self.x,player.z-self.z):Infinity;
    // The server resolves the blow at its own time plus windup.
    const contact=Number(event.time??snapshot?.time)+windup;
    if(distance<18)sound.melee?.(event.attack,Math.max(.1,1-distance/18),event.id,weapon,{elapsed:age,windup,attackId:event.attackId,predict:()=>meleeWillHit(event.id,weapon,event.attack,contact)});
    return;
  }
  if(event.event==='melee-hit'){
    if(!audible)return;
    sound.confirmMelee?.(event.id,event.attackId,event.hits);
    if(local&&meleeControlsActive()&&!meleeSuppressed&&event.hits>0){sound.hit();feedback.hit('hit');const heavy=event.attack==='heavy'||event.kills>0;hitStop.trigger(heavy?'meleeHeavy':'melee',performance.now()/1000);cameraShake.add(heavy?.22:.11);}
    for(const impact of event.impacts??[])if(Number.isFinite(impact.x)&&Number.isFinite(impact.y)&&Number.isFinite(impact.z)){impactEffect(impact.x,impact.y,impact.z,false,0,{kill:impact.killed===true,zombieId:impact.zombieId,dirX:impact.dirX,dirZ:impact.dirZ});if(ambianceHooks.impact)ambianceImpact(0,impact.x,impact.y,impact.z,impact.dirX??0,0,impact.dirZ??0,false,impact.killed===true,impact.zombieId,Number.isFinite(impact.power)?impact.power:impact.damage,event.weapon,'melee',local,impact.feet?.[0],impact.feet?.[1],impact.feet?.[2]);}
    return;
  }
  if (event.event === 'practice' && event.action === 'targets') drillHits = 0;
  if (['reload', 'down', 'leave', 'weapon-drop', 'weapon-pickup', 'purchase'].includes(event.event)) {
    const voiceId = event.hand === 'secondary' ? `${event.id}:secondary` : event.id;
    sound.releasePump?.(voiceId); sound.releaseAssault?.(voiceId); flameStreams.get(voiceId)?.stop();
    if (event.event !== 'reload') { sound.releasePump?.(`${event.id}:secondary`); sound.releaseAssault?.(`${event.id}:secondary`); flameStreams.get(`${event.id}:secondary`)?.stop(); }
  }
  // Every blow a zombie lands, on a survivor or a barricade, shows its swing.
  // A raider never swings like a zombie: only its plank bash drives the stock.
  if (event.zombieId && ['hit', 'door', 'board'].includes(event.event)) {
    const attacker = zombieMeshes.get(event.zombieId);
    if (attacker && audible && !attacker.userData.raider && event.event !== 'board') attacker.userData.attackAt = visualSeconds();
    else if (attacker && audible && attacker.userData.raider && event.bash) attacker.userData.bashAt = visualSeconds();
  }
  if (event.event === 'fuel-mission') { fuelMissionWave = event.wave; toast(() => t('expedition.missionStarted'), 5); }
  else if (event.event === 'deliver-fuel') { toast(() => t('expedition.refueled'), 4); if (audible) sound.repair(); }
  else if (event.event === 'fuel-dropped') toast(() => t('expedition.fuelDropped'));
  else if (event.event === 'repair-umbrella' && local) { toast(() => t('expedition.repaired')); if (audible) sound.repair(); }
  else if (event.event === 'umbrella-denied' && local) toast(() => t(event.reason === 'worn' ? 'expedition.repairHint' : 'expedition.wait'));
  else if (event.event === 'next-wave-vote' && !local && event.ready === true) { const name = snapshot?.players.find(player => player.id === event.id)?.name; if (name) toast(() => t('nextWave.teammate', { name, votes: event.votes, total: event.total })); }
  else if (event.event === 'next-wave-called') toast(() => t('nextWave.coming'));
  else if (event.event === 'shot') {
    if (!audible) return;
    if (local) {
      const self = myPlayer(), secondary = event.hand === 'secondary', stock = secondary ? dualStock(self) : self, held = secondary ? secondaryFiring : firing;
      const localAudio = controlsCaptured() && $('pause').hidden && !document.hidden && self?.alive && !self.downed && !stock?.reloading && stock?.weapon === event.weapon && (secondary || fireAudioWeapon === event.weapon);
      if (localAudio) {
        if (held || !automaticWeapons.includes(event.weapon)) { sound.shoot(event.weapon, { held, voiceId: secondary ? `${event.id}:secondary` : event.id }); if (!secondary) triggerSoundPlayed = true; }
        else if (secondary || !triggerSoundPlayed) { sound.singleShot?.(event.weapon, { voiceId: secondary ? `${event.id}:secondary` : event.id }); if (!secondary) triggerSoundPlayed = true; }
      }
      recoil = event.weapon === 'shotgun' ? .13 : event.weapon === 'magnum' ? .18 : event.weapon === 'sniper' ? .14 : event.weapon === 'rocket' ? .12 : event.weapon === 'flamethrower' ? .008 : event.weapon === 'minigun' ? .025 : event.weapon === 'pistol' ? .045 : .06;
      shotRumble(event.weapon);
      if (event.weapon === 'sniper') { const model = event.hand === 'secondary' ? secondaryGun : gun; if (model) model.userData.shotAt = visualSeconds(); }
      muzzleUntil = event.weapon === 'flamethrower' ? 0 : performance.now() + 50; muzzleLight.intensity = event.weapon === 'flamethrower' ? 0 : 7;
      cameraShake.add(SHOT_TRAUMA[event.weapon] ?? 0);
      if (event.ballistic !== true && event.hits > 0) { if (localAudio) { sound.hit(); if (event.headshots > 0) sound.headshot?.(); } feedback.hit(event.headshots > 0 ? 'headshot' : 'hit'); }
    } else {
      if (myPlayer() && Math.hypot(event.x - myPlayer().x, event.z - myPlayer().z) < 18) sound.shoot(event.weapon, { voiceId: event.hand === 'secondary' ? `${event.id}:secondary` : event.id });
      const shooter = playerMeshes.get(event.id);
      if (shooter) {
        fireSurvivor(shooter, visualSeconds(), event.hand);
        const muzzle = survivorMuzzle(shooter, undefined, event.hand);
        if (muzzle && event.weapon !== 'flamethrower') { teamMuzzleLight.position.copy(muzzle); teamMuzzleUntil = performance.now() + 60; }
      }
    }
    shotEffect(event);
  } else if (event.event === 'bullet-impact') {
    if (![event.x, event.y, event.z].every(Number.isFinite)) return;
    if (event.visualOnly !== true) ballisticTracers.get(event.projectileId)?.contact(event, ballisticTime);
    if (!audible || event.stop === 'range') return;
    const point = new THREE.Vector3(event.x, event.y, event.z);
    const direction = new THREE.Vector3(event.dirX ?? 0, event.dirY ?? 0, event.dirZ ?? 0);
    if (event.stop === 'solid' || event.stop === 'board') surfaceImpact(point, event.stop === 'board' || inBoardedWindow(point), 0, direction);
    else if (event.stop === 'zombie') {
      zombieImpact(point, direction, 0);
      if (local && event.damage > 0) {
        ballisticHitAudio(event);
        feedback.hit(event.headshot === true ? 'headshot' : 'hit');
      }
      if (ambianceHooks.impact) {
        const feet = event.feet;
        ambianceImpact(0, event.x, event.y, event.z, direction.x, direction.y, direction.z,
          event.headshot === true, event.killed === true, event.zombieId,
          Number.isFinite(event.power) ? event.power : event.damage, event.weapon, 'bullet', local,
          feet?.[0] ?? feet?.x, feet?.[1] ?? feet?.y, feet?.[2] ?? feet?.z, ballisticShotGroups.get(event.projectileId));
      }
    }
    // A teammate stop (friendly fire) keeps the tracer contact only: no blood,
    // no hit marker — the victim's own hit event carries the feedback.
  } else if (event.event === 'raider-shot') {
    if (!audible) return;
    const shooter = zombieMeshes.get(event.raiderId), self = myPlayer();
    if (shooter) {
      fireSurvivor(shooter, visualSeconds(), event.hand);
      const muzzle = survivorMuzzle(shooter);
      if (muzzle) { teamMuzzleLight.position.copy(muzzle); teamMuzzleUntil = performance.now() + 60; }
    }
    shotEffect(event);
    if (self) {
      // Loudness follows horizontal distance; the stereo side follows the view.
      const dx = event.x - self.x, dz = event.z - self.z, distance = Math.hypot(dx, dz);
      const volume = Math.max(.12, Math.min(1, 1 - (distance - 6) / 54));
      const pan = distance > .5 ? Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / distance)) : 0;
      sound.raiderShot?.(event.sound ?? event.weapon, { voiceId: event.raiderId, volume, pan });
    }
  } else if (event.event === 'reload' && local && audible && event.hand === 'secondary') {
    const self = myPlayer(), stock = dualStock(self), type = event.weapon ?? stock?.weapon;
    releaseHandFire('secondary');
    if (controlsCaptured() && $('pause').hidden && !document.hidden && self?.alive && !self.downed && stock?.weapon === type && secondaryReloadAudio?.weaponId !== stock.weaponId) {
      stopSecondaryReloadAudio(); secondaryReloadAudio = { weaponId: stock.weaponId, confirmed: stock.reloading };
      sound.reload(type, event.duration, { voiceId: `${myId}:secondary` });
    }
  } else if (event.event === 'reload' && local && audible) {
    setScope(false);
    stopMinigunSpin();
    fireAudioWeapon = null; reloadAudioConfirmed = true; releaseHandFire();
    const self = myPlayer(), type = event.weapon ?? self?.weapon;
    if (controlsCaptured() && $('pause').hidden && !document.hidden && self?.alive && !self.downed && !reloadSoundCancelled && self.weapon === type && reloadSoundWeapon !== type) {
      stopReloadAudio(); reloadSoundWeapon = type; reloadSoundConfirmed = self.reloading;
      sound.reload(type, event.duration, { voiceId: myId });
    }
  }
  else if (event.event === 'hit' && local && audible) {
    const now = performance.now();
    // A blow fully stopped by the vest gives a brief cold flash instead of red.
    // Every local hit sets the colour, including throttled outside ticks.
    const stopped = event.damage > 0 && event.absorbed >= event.damage;
    $('damage-flash').classList.toggle('armor', stopped);
    if (event.source === 'raider') raiderHurt(event, now, stopped ? 180 : 400);
    else if (event.source === 'friendly') {
      // Same flash and throttled hurt cue as a raider hit, then one toast per
      // shooter per 2 s; one's own blast has its own words.
      raiderHurt(event, now, stopped ? 180 : 400);
      if (now - (friendlyHurtToasts.get(event.shooterId) ?? -Infinity) >= 2000) {
        friendlyHurtToasts.set(event.shooterId, now);
        const shooter = snapshot?.players.find(player => player.id === event.shooterId);
        toast(() => event.shooterId === myId ? t('friendlyFire.hitSelf') : t('friendlyFire.hitBy', { name: shooter?.name || t('player.unknown') }));
      }
    }
    else if (event.source !== 'outside' || now - lastOutsideHurtAt >= 1200) {
      sound.hurt(); damageUntil = now + (stopped ? 180 : event.source === 'outside' ? 200 : 400); cameraShake.add(stopped ? .04 : .12);
      if (event.source === 'outside') lastOutsideHurtAt = now;
    }
  }
  else if (event.event === 'drill-hit' && local && audible) { drillHits++; $('damage-flash').classList.toggle('armor', false); raiderHurt(event, performance.now(), 200); }
  else if (event.event === 'kill') {
    const body = zombieMeshes.get(event.zombieId), raider = event.raider === true || body?.userData.raider === true;
    if (raider) rememberRaider(event.zombieId);
    const killDelay = event.weapon === 'rocket' ? rocketArrival(event.id, event) : 0;
    // The wave's last enemy falls in slow motion, whoever brings it down.
    if (snapshot?.phase === 'wave' && snapshot.practice !== true && Number(snapshot.remaining) === 1) slowMotion.trigger(performance.now() / 1000 + Math.max(0, killDelay || 0));
    if (body) {
      if (ambianceHooks.impact) rememberFallen(event.zombieId, body);
      zombieMeshes.delete(event.zombieId);
      setZombieBurn(body, false); setZombieFrost(body, 0);
      // Explosions and point-blank blasts shove the body back, never through a wall.
      // Only the cabin's ground floor slides; multi-floor deaths stay in place.
      const knockback = body.userData.raider || HAS_SPACE || body.position.y > .3 ? null : knockbackFor(event);
      if (knockback) knockback.distance = clampSlide(body.position.x, body.position.z, event.dirX ?? 0, event.dirZ ?? 0, knockback.distance, { reach: body.userData.kind === 'crawler' ? .9 : 1.85 });
      (body.userData.raider ? startRaiderDeath : startZombieDeath)(body, { time: visualSeconds() + killDelay, directionX: event.dirX ?? 0, directionZ: event.dirZ ?? 0, headshot: event.headshot === true, knockback });
      if (ambianceHooks.death) {
        const at = [event.x, event.y, event.z].every(Number.isFinite) ? event : body.position;
        ambianceHook('death', { mesh: body, x: at.x, y: at.y, z: at.z, dirX: event.dirX ?? 0, dirZ: event.dirZ ?? 0, headshot: event.headshot === true, boss: event.boss === true, raider }, killDelay);
      }
      corpses.push(body);
      // Bound the extra models while a large wave collapses at once.
      while (corpses.length > 24) { const old = corpses.shift(); scene.remove(old); disposeZombie(old); }
    }
    if (raider) sound.releaseRaider?.(event.zombieId);
    const brute = event.boss === true || body?.userData.kind === 'brute';
    // A downed raider gets a body-fall thud, never a groan.
    if (audible && local && raider) sound.raiderDown?.();
    else if (audible && local) sound.kill(event.headshot === true, killKind(event.weapon), brute, killDelay);
    // Marker, hit-stop and chain wait for a rocket to land.
    if (audible && local) { const cue = () => killFeedback(event, brute); if (killDelay > 0) pendingCues.push({ at: visualSeconds() + killDelay, play: cue }); else cue(); }
    else if (audible && event.chain >= 3) {
      // A teammate's chain: one feed line per frame, after a rocket lands.
      const name = snapshot?.players.find(player => player.id === event.id)?.name;
      const note = () => { if (name) queueTeamChain(event.id, name, event); };
      if (killDelay > 0) pendingCues.push({ at: visualSeconds() + killDelay, play: note }); else note();
    }
    // The burst at the body's middle; a look is also told where its crown is.
    if (audible) impactEffect(event.x, event.y + 1, event.z, event.headshot === true, killDelay, { kill: true, raider, zombieId: event.zombieId, dirX: event.dirX, dirZ: event.dirZ,
      top: body && Number.isFinite(event.y) ? event.y + enemyProfile(body.userData).height * (body.scale?.y || 1) : null });
    // Blood for a kill without a wound of its own (fire, burning): at the
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
  }
  else if (event.event === 'raid' || event.event === 'raid-squad') announceRaid(event, audible);
  else if (event.event === 'raid-retreat') toast(() => t('raid.retreat'), 4);
  else if (event.event === 'raider-left') sound.releaseRaider?.(event.id);
  else if (event.event === 'wave') {
    // Raid waves are fuel-mission waves too: one toast keeps both notices.
    const fuel = fuelMissionWave === event.wave, warning = () => t('raid.waveWarning', { wave: String(event.wave).padStart(2, '0') });
    fuelMissionWave = null;
    if (Number.isFinite(event.raid)) toast(fuel ? () => `${t('expedition.missionStarted')} ${warning()}` : warning, fuel ? 7 : 5);
  }
  else if (event.event === 'repair' && local && audible) sound.repair();
  else if (event.event === 'repair-blocked' && local) toast(event.message);
  else if (event.event === 'practice' && local && snapshot?.practice === true) {
    if (event.action === 'weapon' && Object.hasOwn(names, event.weapon)) $('practice-weapon').value = event.weapon;
    writeText($('practice-status'), () => t(event.action === 'weapon' ? 'practice.equipped' : event.action === 'refill' ? 'practice.refilled' : event.action === 'radar' ? 'practice.radarReady' : event.action === 'backpack' ? 'practice.backpackReady' : event.action === 'raiders' ? 'practice.raiders' : 'practice.reset', { name: weaponLabel(event.weapon || 'assault') }));
  }
  else if (event.event === 'purchase' && local) { if (event.replacedWeapon && (keys.has('KeyE') || (controllerPlaying && controllerState?.held.interact))) groundInteractHeld = true; fireAudioWeapon = null; reloadAudioRequested = false; stopMinigunSpin(); sound.releaseFire?.(); stopReloadAudio(true); stopSecondaryReloadAudio(); if (audible) sound.purchase(); toast(`${names[event.weapon]} achetée · −${event.price} pièces${event.replacedWeapon ? ` · remplace ${names[event.replacedWeapon]}` : ''}`); }
  else if ((event.event === 'weapon-drop' || event.event === 'weapon-pickup') && local) {
    // A rack purchase creates a nearby gun after the initial E keydown.
    // Do not let held E immediately exchange the new purchase back again.
    if (event.event === 'weapon-drop' && event.exchange && (keys.has('KeyE') || (controllerPlaying && controllerState?.held.interact))) groundInteractHeld = true;
    firing = false; fireAudioWeapon = null; reloadAudioRequested = false; stopMinigunSpin(); sound.releaseFire?.(); stopReloadAudio(true); stopSecondaryReloadAudio();
    setScope(false);
    if (!event.exchange) toast(() => t(meleeProfile(event.weapon)?(event.event==='weapon-drop'?'melee.dropped':'melee.taken'):event.event === 'weapon-drop' ? 'ground.dropped' : 'ground.taken', { name: weaponLabel(event.weapon), ammo: event.ammo, reserve: event.reserve }));
  }
  else if ((event.event === 'weapon-pickup-denied' || event.event === 'weapon-drop-denied') && local) toast(() => t(event.reason === 'space' ? 'ground.noSpace' : 'ground.owned'));
  else if (event.event === 'grenade-thrown' && local && audible) sound.grenadeThrow?.();
  else if (event.event === 'explosion' && audible) {
    const projectile = grenadeMeshes.get(event.grenadeId);
    if (projectile) { scene.remove(projectile); grenadeMeshes.delete(event.grenadeId); }
    // The server resolves a rocket at once; the visible rocket flies at the
    // tracer speed, so its blast and sound wait for that arrival.
    const rocket = event.weapon === 'rocket', delay = rocket ? rocketArrival(event.id, event) : 0;
    const effect = createGrenadeExplosion({ x: event.x, y: event.y, z: event.z }, { time: visualSeconds() + delay, radius: rocket ? ROCKET.radiusDamage : GRENADES.radiusDamage });
    scene.add(effect.mesh); explosions.push(effect);
    // Every body the blast reached bleeds from its middle, outward, when it lands.
    if (ambianceHooks.impact && Array.isArray(event.wounds)) for (let index = 0; index < event.wounds.length; index++) {
      const wound = event.wounds[index], x = Number(wound?.[1]), y = Number(wound?.[2]), z = Number(wound?.[3]);
      const dx = x - event.x, dz = z - event.z, across = Math.hypot(dx, dz);
      ambianceImpact(delay, x, y, z, across > 1e-6 ? dx / across : 0, 0, across > 1e-6 ? dz / across : 0,
        false, wound?.[5] === 1, wound?.[0], Number(wound?.[4]), event.weapon ?? 'grenade', 'blast', local, x, NaN, z);
    }
    const self = myPlayer(), distance = self ? Math.hypot(self.x - event.x, self.y - event.y, self.z - event.z) : Infinity, reach = rocket ? 45 : 24;
    const boom = () => sound.explosion?.(Math.max(.1, 1 - distance / reach), { weapon: event.weapon });
    const jolt = explosionTrauma(distance, { rocket }), shake = () => cameraShake.add(jolt);
    if (jolt > 0) { if (delay > 0) pendingCues.push({ at: visualSeconds() + delay, play: shake }); else shake(); }
    if (distance < reach) {
      if (delay > 0) pendingExplosionSounds.push({ at: visualSeconds() + delay, play: boom });
      else boom();
    }
  }
  else if (event.event === 'pickup' && local && audible) {
    showPickup(event);
    if (event.fromId) { const giver = snapshot?.players.find(player => player.id === event.fromId)?.name || t('player.unknown'); toast(() => t('coins.received', { name: giver, amount: event.amount })); }
  }
  else if (event.event === 'purchase-denied' && local) toast(event.reason === 'unique' ? () => t('armory.magnumUnique') : event.message);
  else if (event.event === 'supply-menu' && local) openSupplyMenu(event);
  else if (event.event === 'supply-claimed' && local) { if (audible) sound.purchase(); toast(() => event.repaid === true ? t('sheet.repaidToast', {name: t(`bonus.${event.bonus}`), level: signedValue(Number(event.effective) || 0)}) : t('supply.claimed', {name: bonusLabel(event.bonus, event.level)})); }
  else if (event.event === 'supply-purchased' && local) { if (audible) sound.purchase(); toast(() => t('supply.bought', {name:t(`service.${event.service}`),price:event.price})); }
  else if (event.event === 'supply-denied' && local) toast(() => t(`supply.denied.${['claimed','missing','unavailable','ineligible','funds','full','purchased','owned','carried','out-of-reach'].includes(event.reason) ? event.reason : 'generic'}`));
  else if (event.event === 'revive') {
    if (audible) sound.revive();
    const nameOf = id => snapshot?.players.find(player => player.id === id)?.name || t('player.unknown');
    if (event.kit && event.targetId === event.id) toast(() => event.id === myId ? t(event.automatic ? 'kit.saved' : 'kit.used') : t('kit.usedBy', { name: nameOf(event.id) }));
    else if (event.kit) toast(() => t('kit.usedOn', { name: nameOf(event.id), target: nameOf(event.targetId) }));
    else toast(() => t('event.revived', { name: nameOf(event.targetId) }));
  }
  else if (event.event === 'robbed') {
    const name = snapshot?.players.find(player => player.id === event.id)?.name || t('player.unknown');
    const coins = event.coins > 0, weapon = Boolean(event.weapon), magnum = event.magnum === true;
    const key = coins && weapon ? 'robbed.self' : weapon ? 'robbed.selfWeapon' : coins && magnum ? 'robbed.selfCoinsMagnum'
      : coins ? 'robbed.selfCoins' : magnum ? 'robbed.magnum' : 'robbed.nothing';
    if (local) toast(() => t(key, { coins: event.coins, weapon: weapon ? weaponLabel(event.weapon, { short: true }) : '' }), 5);
    else if (coins || weapon) toast(() => t('robbed.other', { name }), 4);
  }
  else if (event.event === 'coins-dropped' && local) toast(() => t('coins.dropped', { amount: event.amount }));
  else if (event.event === 'companion-callout') showCompanionCallout(event);
  else if (event.event === 'companions-offline') noteCompanions('companions.offline');
  else if (event.event === 'companions-budget') noteCompanions('companions.budget');
  else if (event.event === 'brute') toast(event.boss ? 'Le colosse final est là. Restez ensemble !' : 'Un colosse approche. Prépare tes armes !', 4);
  else if (event.event === 'board') {
    const door = snapshot?.doors.find(item => item.id === event.doorId);
    if (door) {
      const broken = door.boards?.[event.boardIndex] > 0 && event.boards?.[event.boardIndex] === 0;
      door.hp = event.hp; if (event.boards) door.boards = [...event.boards];
      world.setDoor(event.doorId, event.hp / door.maxHp, event.boards, door.sealed);
      if (audible && broken && myPlayer() && Math.hypot(door.x - myPlayer().x, door.z - myPlayer().z) < 18) sound.boardBreak();
    }
  }
  else if (event.event === 'door' && event.hp <= 0) { toast('Une barricade a cédé !'); if (audible) sound.hurt(); }
  else if (event.event === 'down') {
    if (local) { setScope(false); closeSupplyMenu(false); firing = false; fireAudioWeapon = null; stopMinigunSpin(); sound.releaseFire?.(); stopReloadAudio(true); stopSecondaryReloadAudio(); }
    const teammate = snapshot?.players.find(player => player.id === event.id);
    // A self-inflicted blast (shooterId === id) keeps the plain downed words;
    // the one who downed a teammate gets the callout instead of a toast.
    const shooter = event.source === 'friendly' && event.shooterId !== event.id
      ? snapshot?.players.find(player => player.id === event.shooterId)?.name || t('player.unknown') : null;
    if (shooter && event.shooterId === myId) friendlyCallout(teammate, true);
    else toast(local ? event.source === 'outside' ? 'Tu es à terre dehors. Un coéquipier peut te relever. Rentre ensuite dans la cabane.'
      : shooter ? () => t('friendlyFire.downedSelf', { shooter })
      : 'Tu es à terre. Appelle un coéquipier !'
      : shooter ? () => t('friendlyFire.downedBy', { name: teammate?.name || t('player.unknown'), shooter })
      : () => t(event.source === 'outside' ? 'event.downedOutside' : 'event.downed', { name: teammate?.name || t('player.unknown') }));
  }
  else if (event.event === 'friendly-fire') {
    // The host saw their own click; everyone else hears about the change.
    if (!local) toast(() => t('friendlyFire.changed', { level: FRIENDLY_FIRE_LEVELS.includes(event.level) ? t(`friendlyFire.${event.level}`).toLowerCase() : String(event.level) }));
  }
  else if (event.event === 'leave' && event.hostId === myId && snapshot?.hostId !== myId) toast('Tu es maintenant l’hôte du refuge.');
  else if (event.event === 'join') toast(`${event.name} a rejoint le refuge.`);
}
// Raider fire or friendly fire on the local survivor (or a harmless drill
// hit): flash, a hurt cue at most every 250 ms and a pooled arc toward the
// world-space source. The view itself never moves.
function raiderHurt(event, now, flashMs) {
  damageUntil = Math.max(damageUntil, now + flashMs);
  if (now - lastRaiderHurtAt >= 250) { sound.hurt(); lastRaiderHurtAt = now; }
  if (!Number.isFinite(event.fromX) || !Number.isFinite(event.fromZ)) return;
  // A friendly shooter gets an arc of their own, distinct from every raider's.
  const key = event.raiderId ?? (event.source === 'friendly' ? `friendly:${event.shooterId}` : undefined);
  const arc = damageArcs.find(item => item.raiderId === key && now < item.until)
    ?? damageArcs.find(item => now >= item.until) ?? damageArcs.reduce((oldest, item) => item.until < oldest.until ? item : oldest);
  Object.assign(arc, { raiderId: key, fromX: event.fromX, fromZ: event.fromZ, until: now + DAMAGE_ARC_MS });
}
// The shooter's side of a friendly hit: the marker outranks any zombie's, the
// number stands over the teammate's head (crouched or standing), and the
// callout names them.
function friendlyHitFeedback(event) {
  const victim = snapshot?.players.find(player => player.id === event.id) ?? null;
  feedback.hit('friendly');
  // What the round really took (vest and health), as enemy numbers show.
  const amount = Number(event.inflicted ?? event.damage);
  if (victim && amount > 0 && [victim.x, victim.z].every(Number.isFinite))
    friendlyNumbers.addImpacts([[String(victim.id), victim.x, (Number(victim.y) || 0) + (victim.crouched ? 1.2 : 1.85), victim.z, amount, 0]], damagePoint);
  friendlyCallout(victim, false);
}
function friendlyCallout(victim, downed) {
  const element = $('friendly-callout'), now = performance.now();
  if (!element || (!downed && now - friendlyCalloutAt < FRIENDLY_CALLOUT.gap)) return;
  friendlyCalloutAt = now; friendlyCalloutUntil = now + (downed ? FRIENDLY_CALLOUT.down : FRIENDLY_CALLOUT.hit);
  const name = victim?.name || t('player.unknown');
  const line = downed ? 'friendlyFire.calloutDownLine' : `friendlyFire.calloutLine${friendlyCalloutLine++ % FRIENDLY_CALLOUT.lines}`;
  writeText($('friendly-callout-title'), () => t(downed ? 'friendlyFire.calloutDown' : 'friendlyFire.calloutHit', { name }));
  writeText($('friendly-callout-line'), () => t(line, { name }));
  element.classList.toggle('downed', downed);
  element.classList.remove('pop'); void element.offsetWidth; element.classList.add('pop');
  element.hidden = false;
}
function hideFriendlyCallout() { friendlyCalloutUntil = 0; friendlyCalloutAt = -Infinity; const element = $('friendly-callout'); if (element) element.hidden = true; }
function raidSide(side) { return ['north', 'south', 'west', 'east'].includes(side) ? t(`raid.side.${side}`) : '—'; }
// Banner (raid) or toast (squad), then an amber pointer toward the squad's entries.
function announceRaid(event, audible) {
  if (event.event === 'raid') {
    if (event.drill) drillHits = 0;
    banner(() => t('raid.kicker'), () => event.drill ? t('raid.drillTitle', { side: raidSide(event.side) }) : t('raid.title', { index: event.index, count: RAIDS.waves.length, side: raidSide(event.side) }));
  } else toast(() => t('raid.squad', { side: raidSide(event.side) }), 4);
  if (audible) sound.raidAlarm?.({ squad: event.event === 'raid-squad' });
  const entries = (Array.isArray(event.entries) ? event.entries : []).filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z));
  if (entries.length) raidPointer = { x: entries.reduce((sum, point) => sum + point.x, 0) / entries.length, z: entries.reduce((sum, point) => sum + point.z, 0) / entries.length, until: performance.now() + RAID_POINTER_MS };
}
// Screen angle (clockwise from straight ahead) of a world point, from the
// current camera yaw; recomputed every frame so indicators follow the view.
function screenBearing(self, x, z) { const angle = yaw - Math.atan2(-(x - self.x), -(z - self.z)); return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function refreshRaidIndicators(now, self, visible) {
  for (const arc of damageArcs) {
    const element = $(`damage-arc-${arc.index}`), left = arc.until - now, hidden = !visible || !self || left <= 0;
    if (element.hidden !== hidden) element.hidden = hidden;
    if (hidden) continue;
    element.style.transform = `translate(-50%, -50%) rotate(${screenBearing(self, arc.fromX, arc.fromZ).toFixed(4)}rad)`;
    element.style.opacity = Math.min(1, left / 300).toFixed(3);
  }
  const pointer = $('raid-pointer'), hidden = !visible || !self || !raidPointer || now >= raidPointer.until;
  if (pointer.hidden !== hidden) pointer.hidden = hidden;
  if (!hidden) pointer.style.transform = `translate(-50%, -50%) rotate(${screenBearing(self, raidPointer.x, raidPointer.z).toFixed(4)}rad) translateY(calc(-1 * min(30vh, 210px)))`;
}
function clearRaidPresentation() {
  for (const arc of damageArcs) Object.assign(arc, { raiderId: null, until: 0 });
  raidPointer = null; drillHits = 0; lastRaiderHurtAt = -Infinity;
  friendlyHurtToasts.clear(); hideFriendlyCallout();
  refreshRaidIndicators(0, null, false);
}
// One tracer per pellet, from the shooter's muzzle to where the server stopped it.
function shotEffect(event) {
  const hostile = event.event === 'raider-shot', shooters = hostile ? zombieMeshes : playerMeshes, shooterId = hostile ? event.raiderId : event.id;
  const local = !hostile && event.id === myId, eye = new THREE.Vector3(event.x, event.y, event.z);
  let muzzle = null;
  // The online client moves its own confirmed shots to the predicted body
  // and starts them at the click; on LAN the confirmed eye and now are right.
  let tracerEye = eye, shotTime = visualSeconds(), drawnAtClick = false;
  const shotModel = local && event.hand === 'secondary' ? secondaryGun : gun;
  if (local && shotModel) { camera.updateMatrixWorld(); muzzle = shotModel.localToWorld(shotModel.userData.muzzle.clone()); }
  else if (shooters.has(shooterId)) muzzle = survivorMuzzle(shooters.get(shooterId), undefined, event.hand);
  const pellets = Array.isArray(event.pellets) && event.pellets.length ? event.pellets : [{ yaw: event.yaw, pitch: event.pitch, distance: 12, stop: 'range' }];
  const now = visualSeconds();
  if (muzzle && !drawnAtClick && event.weapon !== 'flamethrower') shotFlash(muzzle, event, local, now);
  if (!hostile && !drawnAtClick && event.weapon !== 'flamethrower') shotCosmetics(event.id, event.weapon, now, event.hand);
  if (event.ballistic === true) {
    // The physical ray still starts at the confirmed eye. Only its local
    // presentation leaves the gun: keep scope/late weapon changes on-axis,
    // and never draw beyond a wall pierced by the first-person view model.
    const self = myPlayer(), doors = sightDoors(snapshot?.doors);
    const barrel = local && !scoped && (event.hand === 'secondary' ? secondaryGun?.userData.type : gunType) === event.weapon
      && (event.weaponId == null || event.weaponId === (event.hand === 'secondary' ? self?.secondaryWeaponId : selectedWeaponId(self)))
      && Math.cos(yaw - event.yaw) * Math.cos(pitch) * Math.cos(event.pitch) + Math.sin(pitch) * Math.sin(event.pitch) >= .8
      && eye.distanceTo(camera.position) <= 4
      && muzzle && eye.distanceTo(muzzle) <= 4
      && sightClear(eye, muzzle, doors) ? muzzle : null;
    for (const projectile of event.projectiles ?? []) {
      if (projectile?.id == null || ballisticTracers.has(projectile.id)) continue;
      const handle = createBallisticTracer(projectile, { weapon: event.weapon, local, time: ballisticTime, muzzle: barrel });
      if (!handle) continue;
      ballisticTracers.set(projectile.id, handle); ballisticShotGroups.set(projectile.id, ambianceShot); scene.add(handle.mesh);
      while (ballisticTracers.size > MAX_TRACERS) {
        const [id, oldest] = ballisticTracers.entries().next().value;
        scene.remove(oldest.mesh); oldest.dispose(); ballisticTracers.delete(id); ballisticShotGroups.delete(id);
      }
    }
    return;
  }
  if (!hostile && event.weapon === 'flamethrower') {
    // A confirmed tick renews one stream per survivor. Delayed packets cannot
    // restart our spray after release, pause, reload or a weapon switch.
    const base = myPlayer(), secondary = event.hand === 'secondary';
    const self = secondary && base?.hands?.secondary ? { ...base, ...base.hands.secondary } : base;
    if (local && (!(secondary ? secondaryFiring : firing) || !controlsCaptured() || !$('pause').hidden || document.hidden || (secondary ? secondaryGun?.userData.type : gunType) !== 'flamethrower' || !secondary && fireAudioWeapon !== 'flamethrower' || !self?.alive || self.downed || (secondary ? dualStock(self)?.reloading : self.reloading))) return;
    const direction = new THREE.Vector3(-Math.sin(event.yaw) * Math.cos(event.pitch), Math.sin(event.pitch), -Math.cos(event.yaw) * Math.cos(event.pitch));
    const distance = Number(pellets[0]?.distance);
    const end = eye.clone().addScaledVector(direction, Number.isFinite(distance) ? Math.max(0, Math.min(FLAMETHROWER.range, distance)) : FLAMETHROWER.range);
    const start = muzzle ?? eye.clone().addScaledVector(direction, .5);
    // The view model extends ahead of the eye. If a nearby wall stops the
    // authoritative ray before that muzzle, never draw a backwards jet from
    // the far side of the wall toward the survivor.
    if (end.clone().sub(start).dot(direction) <= .05) { flameStreams.get(secondary ? `${event.id}:secondary` : event.id)?.stop(); return; }
    const streamId = secondary ? `${event.id}:secondary` : event.id;
    let stream = flameStreams.get(streamId);
    if (!stream) { stream = createFlameStream(); flameStreams.set(streamId, stream); scene.add(stream.mesh); }
    stream.aim(start, end, now); return;
  }
  for (const pellet of pellets) {
    const direction = new THREE.Vector3(-Math.sin(pellet.yaw) * Math.cos(pellet.pitch), Math.sin(pellet.pitch), -Math.cos(pellet.yaw) * Math.cos(pellet.pitch));
    const distance = Number(pellet.distance);
    // A moved eye draws only longer rays; a stop keeps its true point and a
    // miss keeps its direction from the drawn eye.
    const rayEye = tracerEye !== eye && distance >= 2 ? tracerEye : eye;
    const from = pellet.stop === 'solid' || pellet.stop === 'board' || pellet.stop === 'zombie' ? eye : rayEye;
    const end = event.weapon === 'rocket' && event.impact ? new THREE.Vector3(event.impact.x, event.impact.y, event.impact.z) : from.clone().addScaledVector(direction, Number.isFinite(distance) ? Math.max(0, distance) : 12);
    const origin = safeTracerStart(rayEye, end, muzzle);
    let travel = 0;
    if (origin) {
      const start = new THREE.Vector3(origin.x, origin.y, origin.z);
      const tracer = createTracer(start, end, { local, time: now, lead: now - shotTime, rocket: event.weapon === 'rocket', weapon: event.weapon, ...(hostile ? { hostile } : {}) });
      // Arrival from now: a bullet drawn from the click may already be on its way.
      travel = Number.isFinite(tracer.travel) ? Math.max(0, (Number.isFinite(tracer.startedAt) ? tracer.startedAt : now) + tracer.travel - now) : 0;
      scene.add(tracer.mesh); tracers.push(tracer);
      // Squads of automatic raiders could pile up streaks: the oldest go first.
      while (tracers.length > MAX_TRACERS) { const oldest = tracers.shift(); scene.remove(oldest.mesh); oldest.dispose(); }
    }
    // Impacts show up when the bullet arrives, not when the shot leaves.
    if (event.weapon !== 'rocket' && (pellet.stop === 'solid' || pellet.stop === 'board')) surfaceImpact(end, pellet.stop === 'board' || inBoardedWindow(end), travel, direction);
    else if (event.weapon !== 'rocket' && pellet.stop === 'zombie') zombieImpact(end, direction, travel);
    // Every body this pellet entered bleeds where it entered, when the bullet gets there.
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
  }
}
// The feedback of one of your kills, when the blow lands: marker, a tiny
// hit-stop (not for streams of fire), the score flying to your total and
// the chain banner with its arpeggio.
function queueTeamChain(id, name, event) {
  const chainId = Number.isFinite(event.chainId) ? event.chainId : null, current = pendingTeamChains.get(id);
  if (!current || (chainId !== null && current.chainId !== null && chainId > current.chainId) || (chainId === current.chainId && event.chain > current.chain))
    pendingTeamChains.set(id, { name, chain: event.chain, chainId });
}
// Announce this frame's chains: the local banner and its sound, then teammates.
function flushChains() {
  if (pendingChain) { if (feedback.chain(pendingChain.chain, { bonus: pendingChain.bonus, chainId: pendingChain.chainId })) sound.chain?.(pendingChain.chain); pendingChain = null; }
  for (const [id, entry] of pendingTeamChains) feedback.chain(entry.chain, { name: entry.name, chainId: entry.chainId, who: id });
  pendingTeamChains.clear();
}
function killFeedback(event, heavy = false) {
  feedback.hit(event.headshot === true ? 'headshotKill' : 'kill');
  // A melee kill is followed at once by its melee-hit, which picks the freeze.
  if (!['minigun', 'flamethrower'].includes(event.weapon) && !MELEE_WEAPONS[event.weapon]) hitStop.trigger(heavy ? 'heavy' : event.headshot === true ? 'headshotKill' : 'kill', performance.now() / 1000);
  // The kill's damage already shows as its impact number; its chain bonus
  // in the chain banner. No separate score popup any more.
  // Kills of one blast arrive together: the frame shows only the longest chain.
  if (event.chain >= 2) {
    // Keep the newest chain's highest count of this frame.
    const id = Number.isFinite(event.chainId) ? event.chainId : null, current = pendingChain?.chainId ?? null;
    if (!pendingChain || (id !== null && current !== null && id > current) || (id === current && event.chain > pendingChain.chain))
      pendingChain = { chain: event.chain, bonus: event.chainBonus ?? 0, chainId: id };
  }
}
const screenScratch = new THREE.Vector3();
// This survivor's own impact numbers: the server sends nobody else's. A
// rocket's blast (flag 16) is resolved at once by the server, but the
// visible rocket is still flying: its numbers, like its kills, wait for it
// to land (rocketArrival), on the same paused-aware clock.
function onImpacts(message) {
  if (!myId || !inGame || snapshot?.paused === true || !['countdown', 'wave', 'intermission'].includes(snapshot?.phase)) return;
  const now = [];
  for (const record of Array.isArray(message?.impacts) ? message.impacts.slice(0, 64) : []) {
    const delay = Array.isArray(record) && Number.isInteger(record[5]) && (record[5] & IMPACT_FLAGS.rocket)
      ? rocketArrival(myId, { x: record[1], y: record[2], z: record[3] }) : 0;
    if (delay > 0) pendingCues.push({ at: visualSeconds() + delay, play: () => damageNumbers.addImpacts([record], damagePoint) });
    else now.push(record);
  }
  if (now.length) damageNumbers.addImpacts(now, damagePoint);
}
// Impact numbers stay at visible screen positions; an off-screen impact must
// never turn into a number at the crosshair.
function damagePoint(impact) {
  if (!camera.projectionMatrix || !camera.matrixWorldInverse) return null;
  camera.updateMatrixWorld(); screenScratch.set(impact.x, impact.y + .25, impact.z).project(camera);
  if (screenScratch.z < -1 || screenScratch.z >= 1 || Math.abs(screenScratch.x) > .94 || Math.abs(screenScratch.y) > .94) return null;
  return { x: (screenScratch.x + 1) / 2 * innerWidth, y: (1 - screenScratch.y) / 2 * innerHeight };
}
// Every shot warms its barrel and queues a casing (pump and bolt guns eject
// when cycled). Teammates' casings only when they are close.
function heatOf(id) { let heat = gunHeat.get(id); if (!heat) { heat = createBarrelHeat(); gunHeat.set(id, heat); } return heat; }
function shotCosmetics(id, weapon, time, hand = 'primary') {
  heatOf(id).shot(weapon, time);
  const spec = casingPort(weapon);
  if (spec && world.effects?.casings) { pendingCasings.push({ at: time + spec.delay, id, weapon, hand }); if (pendingCasings.length > 48) pendingCasings.shift(); }
}
const casingPoint = new THREE.Vector3(), casingVelocity = new THREE.Vector3(), casingAxis = new THREE.Vector3();
function gunModelOf(id, hand = 'primary') { return id === myId ? hand === 'secondary' ? secondaryGun : gun : hand === 'secondary' ? playerMeshes.get(id)?.userData.secondaryGun ?? null : playerMeshes.get(id)?.userData.gun ?? null; }
function ejectCasings(time) {
  let kept = 0;
  for (const entry of pendingCasings) {
    if (entry.at > time) { pendingCasings[kept++] = entry; continue; }
    const model = gunModelOf(entry.id, entry.hand), spec = casingPort(entry.weapon), shooter = snapshot?.players.find(player => player.id === entry.id), self = myPlayer();
    if (!model?.matrixWorld || model.userData.type !== entry.weapon || !spec || !shooter || !self) continue;
    if (entry.id !== myId && Math.hypot(shooter.x - self.x, shooter.z - self.z) > 25) continue;
    if (entry.id === myId) camera.updateMatrixWorld();
    const origin = model.localToWorld(casingPoint.fromArray(spec.port)), e = model.matrixWorld.elements;
    // Out to the gun's right and a little back; the minigun pours them out low.
    const right = casingAxis.set(e[0], e[1], e[2]).normalize();
    casingVelocity.copy(right).multiplyScalar(spec.drop ? .9 + Math.random() * .4 : 1.3 + Math.random() * .7);
    casingVelocity.addScaledVector(casingAxis.set(e[4], e[5], e[6]).normalize(), spec.drop ? -.15 + Math.random() * .35 : 1.4 + Math.random() * .6);
    casingVelocity.addScaledVector(casingAxis.set(e[8], e[9], e[10]).normalize(), spec.drop ? -.15 - Math.random() * .2 : .2 + Math.random() * .3);
    if (shooter.grounded !== false && Number.isFinite(shooter.y)) casingFloors.set(entry.id, shooter.y);
    world.effects.casings.eject({ origin, velocity: casingVelocity, time, kind: spec.kind, floor: casingFloors.get(entry.id) ?? 0 });
  }
  pendingCasings.length = kept;
}
// A warm barrel at rest breathes smoke from its muzzle; a hot minigun glows.
const heatPoint = new THREE.Vector3();
function updateGunHeat(time, step) {
  for (const [id, heat] of gunHeat) {
    const model = gunModelOf(id);
    if (!model?.userData.muzzle || model.userData.melee) continue;
    const level = heat.level(time);
    if (model.userData.type === 'minigun') setWeaponHeat(model, level);
    const wisps = heat.wisps(time, step);
    if (!wisps || !world.effects?.smoke || !model.visible) continue;
    if (id === myId) camera.updateMatrixWorld();
    const point = model.localToWorld(heatPoint.copy(model.userData.muzzle));
    if (id !== myId && camera.position.distanceTo?.(point) > 30) continue;
    for (let index = 0; index < wisps; index++) world.effects.smoke(point, time, level, id === myId ? .55 : 1);
  }
}
// A swoosh behind each blade through the fast part of its swing, for you and
// for teammates: segments between successive positions of its sweet spot.
const swingTrails = new Map();
function updateSwingTrails(time) {
  if (!world.effects?.swing) return;
  for (const id of [myId, ...playerMeshes.keys()]) {
    const animation = meleeAnimation(id, time), model = gunModelOf(id), frame = model?.userData.bladeFrame, tip = model?.userData.trailTip;
    // Only the strike itself: never the backswing before it or the recovery.
    const span = model?.userData.swingWindows?.[animation?.attack] ?? [-.05, .1];
    const strikeFrom = animation ? animation.windup + span[0] : 0, strikeTo = animation ? animation.windup + span[1] : 0;
    if (!animation || !frame?.localToWorld || !tip || model.visible === false || animation.elapsed < strikeFrom || animation.elapsed > strikeTo) { swingTrails.delete(id); continue; }
    frame.updateWorldMatrix?.(true, false);
    const point = frame.localToWorld(tip.clone()), last = swingTrails.get(id);
    if (last && animation.elapsed > last.elapsed) world.effects.swing(last.point, point, time, { weapon: model.userData.type, heavy: animation.attack === 'heavy' });
    swingTrails.set(id, { point, elapsed: animation.elapsed });
  }
}
// `finale`: the extraction begins with the night's last kill, which keeps its
// delayed feedback, its chain banner and its slow motion.
function resetCombatFeel({ finale = false } = {}) {
  clearBallisticTracers();
  swingTrails.clear();
  for (const id of gunHeat.keys()) { const model = gunModelOf(id); if (model?.userData.type === 'minigun') setWeaponHeat(model, 0); }
  if (finale) { for (const cue of pendingCues.splice(0)) cue.play(); flushChains(); }
  pendingCues.length = 0; pendingCasings.length = 0; gunHeat.clear(); casingFloors.clear(); pendingChain = null; pendingTeamChains.clear();
  world.effects?.casings?.clear(); cameraShake.reset(); hitStop.reset();
  if (!finale) { feedback.clear(); damageNumbers.clear(); friendlyNumbers.clear(); slowMotion.reset(); expireCompanionCallouts(); }
}
// A trigger confirms one hit sound and, if it arrives later, one headshot sound.
// Keep this separate from short-lived/evicted tracer meshes: sibling pellets
// and penetrations can still arrive after the first tracer has disappeared.
function ballisticHitAudio(event) {
  const groupId = event.shotGroupId ?? event.projectileId;
  let group = ballisticHitSounds.get(groupId);
  if (!group || group.expiresAt <= ballisticTime) {
    group = { hit: false, headshot: false, expiresAt: ballisticTime + BALLISTICS.maxLife + .5 };
    ballisticHitSounds.set(groupId, group);
    while (ballisticHitSounds.size > MAX_TRACERS) ballisticHitSounds.delete(ballisticHitSounds.keys().next().value);
  }
  if (!group.hit) { sound.hit(); group.hit = true; }
  if (event.headshot === true && !group.headshot) { sound.headshot?.(); group.headshot = true; }
}
function clearBallisticTracers() {
  for (const handle of ballisticTracers.values()) { scene.remove(handle.mesh); handle.dispose(); }
  ballisticTracers.clear(); ballisticShotGroups.clear(); ballisticHitSounds.clear();
}
// The server resolves a rocket at once; the visible rocket flies at the
// tracer speed (shot-fx BULLET_SPEED), so its blast and kills wait for it.
function rocketArrival(shooterId, point) {
  const shooter = snapshot?.players?.find(player => player.id === shooterId);
  if (!shooter || ![point?.x, point?.y, point?.z].every(Number.isFinite)) return 0;
  return Math.min(.6, Math.hypot(shooter.x - point.x, shooter.y + 1.5 - point.y, shooter.z - point.z) / 170);
}
// How a kill sounds (art/frisson/KILL-SOUND.md 1.3): the streams are the
// weapons killFeedback gives no hit-stop. Constants, no allocation.
function killKind(weapon) {
  return MELEE_WEAPONS[weapon] ? 'melee' : weapon === 'minigun' || weapon === 'flamethrower' ? 'stream' : weapon === 'rocket' || weapon === 'grenade' ? 'blast' : 'shot';
}
// A star of light out of the barrel, for every shooter whose muzzle is known.
function shotFlash(point, event, local, time) {
  const direction = new THREE.Vector3(-Math.sin(event.yaw) * Math.cos(event.pitch), Math.sin(event.pitch), -Math.cos(event.yaw) * Math.cos(event.pitch));
  world.effects?.muzzle(point, direction, { weapon: event.weapon, local, time });
}
// Raiders are living people, and a look may draw their hits apart
// (art/frisson/UI-SOUND.md section 2.1). A melee blow or a rocket's burst can
// come after the kill has removed the mesh, so the raider ids made lately
// stay in a small ring (as blood.js does); a bare bullet hit goes to the
// nearest enemy of the snapshot. Nothing is allocated per hit.
const raiderIds = new Array(32).fill(null);
let raiderNext = 0;
function rememberRaider(id) {
  if (id === undefined || id === null || raiderIds.includes(id)) return;
  raiderIds[raiderNext] = id; raiderNext = (raiderNext + 1) % raiderIds.length;
}
const raiderSeen = id => id != null && raiderIds.includes(id);
function raiderNear(point) {
  const enemies = snapshot?.zombies;
  if (!Array.isArray(enemies)) return false;
  let nearest = null, gap = 1.44;
  for (let index = 0; index < enemies.length; index++) {
    const enemy = enemies[index];
    if (!enemy || !Number.isFinite(enemy.x) || !Number.isFinite(enemy.z)) continue;
    const dx = enemy.x - point.x, dz = enemy.z - point.z, distance = dx * dx + dz * dz, feet = Number.isFinite(enemy.y) ? enemy.y : 0;
    if (distance < gap && point.y >= feet - .3 && point.y <= feet + (Number.isFinite(enemy.height) ? enemy.height : 2) + .3) { gap = distance; nearest = enemy; }
  }
  return nearest?.kind === 'raider';
}
// Golden sparks where a bullet or pellet stops in an enemy (a look installed
// at run time may draw them otherwise; a raider is told apart for it).
function zombieImpact(point, direction, delay = 0) {
  world.effects?.impact(point, { kind: 'zombie', direction, time: visualSeconds() + delay, raider: raiderNear(point) });
}
// A nailed-shut window is solid wall for the server; its impacts are wood.
function inBoardedWindow(point) {
  return WINDOWS.some(window => !window.open && point.y > window.bottom && point.y < window.top
    && Math.abs((window.axis === 'x' ? point.z : point.x) - window.fixed) < .25
    && Math.abs((window.axis === 'x' ? point.x : point.z) - window.center) < window.width / 2);
}
// Sparks, a flash and dust where a shot stops in wood, stone or ground.
function surfaceImpact(point, wood, delay = 0, direction = null) {
  world.effects?.impact(point, { kind: wood ? 'wood' : 'solid', direction, time: visualSeconds() + delay });
}
// A burst of gold on a blow or a kill (a crown of stars on a head shot):
// satisfying, never blood. A look installed at run time is told whether the
// blow killed, whether it struck a raider, which way it went and, for a
// kill, where the body's crown is.
function impactEffect(x, y, z, headshot = false, delay = 0, hit = null) {
  const dirX = Number.isFinite(hit?.dirX) ? hit.dirX : 0, dirZ = Number.isFinite(hit?.dirZ) ? hit.dirZ : 0;
  world.effects?.impact({ x, y, z }, { kind: headshot ? 'headshot' : 'kill', time: visualSeconds() + delay, kill: hit?.kill ?? true, raider: hit?.raider === true || raiderSeen(hit?.zombieId), dirX, dirZ, top: hit?.top ?? null });
}
function refreshInteraction(self) {
  const progress = $('interaction-progress'), channel = self?.revivingId ? self.reviveLeft : 0;
  if (progress) { progress.hidden = !(channel > 0); if (channel > 0) $('interaction-progress-bar').style.width = `${Math.round(100 * Math.max(0, Math.min(1, 1 - channel / reviveDuration(self))))}%`; }
  interactionTarget = null;
  if (!inGame || !controlsAvailable() || !self.alive || self.downed || snapshot.phase === 'lobby') { $('interaction').hidden = true; return; }
  const teammate = reviveTarget(self);
  if (snapshot?.practice === true) { $('interaction').hidden = true; return; }
  if (!teammate && self.expeditionAction) {
    $('interaction').hidden = false;
    const fuel = snapshot.expedition?.fuel;
    if (self.expeditionAction === 'take-fuel' && fuel) aimInteraction(fuel.x, (fuel.y ?? 0) + .5, fuel.z);
    else aimInteraction(GENERATOR.x, GENERATOR.y + GENERATOR.height + .2, GENERATOR.z);
    writeText($('interaction-text'), () => t(`expedition.${self.expeditionAction}`));
    return;
  }
  const dropped = nearbyGroundWeapon(self);
  const droppedBonus = !dropped && nearbyGroundBonus(self);
  if (!teammate && droppedBonus) {
    $('interaction').hidden = false; aimInteraction(droppedBonus.x, (droppedBonus.y ?? 0) + .55, droppedBonus.z);
    writeText($('interaction-text'), () => t('supply.droppedBonus',{name:bonusLabel(droppedBonus.bonus?.kind ?? droppedBonus.bonus, droppedBonus.bonus?.level ?? 1),replacement:self.bonus?t('supply.replacesBonus'):''}));
    return;
  }
  if (!teammate && !dropped && self.supplyAction) {
    $('interaction').hidden = false;
    if (self.supplyAction === 'crate') aimInteraction(snapshot.supplyCrate?.x, (snapshot.supplyCrate?.y ?? 0) + .8, snapshot.supplyCrate?.z);
    else aimFixture(LATE_SUPPLIES.position, .75);
    const hint=self.supplyAction === 'crate' ? snapshot.supplyCrate?.claimed?.includes(myId) ? 'supply.claimedHint' : 'supply.crateHint' : snapshot.wave < stationUnlockWave() ? 'supply.lockedHint' : 'supply.stationHint';
    const wave=self.supplyAction === 'crate' ? (snapshot.supplyCrate?.wave ?? snapshot.wave)+1 : stationUnlockWave();
    writeText($('interaction-text'), () => t(hint, {wave}));
    return;
  }
  const crate = (snapshot.armory || ARMORY).filter(item => Math.hypot(self.x - item.x, self.z - item.z) < ARMORY_REACH && Math.abs(self.y - item.y) < ARMORY_HEIGHT_REACH)
    .sort((a, b) => Math.hypot(self.x - a.x, self.z - a.z) - Math.hypot(self.x - b.x, self.z - b.z))[0];
  const door = snapshot.doors.find(door => door.hp < door.maxHp && Math.hypot(self.x - door.x, self.z - door.z) < 2.25 && self.y <= .8);
  const boardCount = Array.isArray(door?.boards) ? ` · ${door.boards.filter(hp => hp > 0).length}/${door.boards.length} planches` : '';
  const owned = crate && (self.ownedWeapons || [self.weapon]).includes(crate.weapon);
  const locked = crate && snapshot.wave < (crate.unlockWave ?? 0);
  const uniqueUnavailable = crate?.weapon === 'magnum' && !owned && snapshot.magnumAvailable === false;
  const unavailable = crate && !owned && (self.weaponSupply || []).includes(crate.weapon);
  const replacement = carriedWeapons(self).length >= weaponSlotLimit(self) ? ` · remplace ${names[self.weapon].toLowerCase()}` : ' · emplacement libre';
  $('interaction').hidden = !teammate && !dropped && !crate && !door;
  if (teammate) aimInteraction(teammate.x, teammate.y + .9, teammate.z);
  else if (dropped) aimInteraction(dropped.x, (dropped.y ?? 0) + .55, dropped.z);
  else if (crate) aimFixture(crate, .75); // racks hang from .9 m to 2.15 m
  else if (door) aimInteraction(door.x, .7, door.z);
  if (!teammate && dropped) {
    writeText($('interaction-text'), () => t(carriedWeapons(self).length >= weaponSlotLimit(self) ? meleeProfile(dropped.weapon)?'melee.swap':'ground.swap' : meleeProfile(dropped.weapon)?'melee.take':'ground.take', { name: weaponLabel(dropped.weapon), ammo: dropped.ammo, reserve: dropped.reserve, current: self.weapon ? weaponLabel(self.weapon) : '' }));
  } else if (teammate) {
    const left = self.revivingId === teammate.id ? self.reviveLeft : 0;
    writeText($('interaction-text'), () => left > 0 ? t('revive.inProgress', { name: teammate.name, seconds: Math.ceil(left) })
      : t(self.reviveKit === true ? 'revive.holdOrKit' : 'revive.hold', { name: teammate.name, key: controllerPlaying ? 'RB' : 'E', kit: controllerPlaying ? '↑' : 'F' }));
  } else writeText($('interaction-text'), teammate ? `Relever ${teammate.name}` : crate ? locked ? `${crate.label} · disponible vague ${crate.unlockWave} · ${crate.price} pièces` : owned ? `Équiper ${crate.label.toLowerCase()} · déjà possédée` : uniqueUnavailable ? () => t('armory.magnumUnavailable') : unavailable ? `${crate.label} abandonnée · rachat à la prochaine vague` : `Acheter ${crate.label.toLowerCase()} · ${crate.price} pièces${self.points < crate.price ? ` · manque ${crate.price - self.points}` : replacement}` : door ? `Réparer la barricade · ${Math.ceil(100 * door.hp / door.maxHp)} %${boardCount}` : '');
}
function enterGame() {
  if (!levelReady) { world.ready?.then(ok => { if (ok && snapshot && !inGame) enterGame(); }); return; }
  if (!myId || myPlayer()?.waiting || finishedPhase(snapshot?.phase)) return;
  // A Frisson room waits for its pack, so the prewarm below compiles it too.
  if (!ambianceReady) { ambianceEntryPending = true; return; }
  inGame = true; $('lobby').hidden = true; $('menu').hidden = true; $('hud').hidden = false; $('pause').hidden = true;
  document.body.classList.add('playing'); flashlight.visible = true;
  // Compile zombie, puff and effect programs once, with the in-play lights.
  world.prewarm?.(renderer, camera);
  sound.unlock(); sound.updateScene(snapshot, inGame && snapshot?.paused !== true); if (gun) gun.visible = true; refreshOutside(myPlayer());
  if (snapshot?.paused) { world.update(visualSeconds(), {snapshot,myId,active:inGame,camera,survivors:playerMeshes}); showPause(); return; }
  requestPointer();
}
function requestPointer() {
  if (!controlsAvailable()) return;
  // An explicit resume click can restore focus without a separate window.focus
  // event (for example after a visibility-only interruption).
  inputFocused = !document.hidden && document.hasFocus?.() !== false;
  if (controllerSettings.mode !== 'mouse' && controllerState?.connected && controllerState.supported) {
    resetInput(); controllerPlaying = true; pointerLocked = false; document.exitPointerLock?.();
    if (inputFocused) { $('pause').hidden = true; sound.unlock(); }
    return;
  }
  controllerPlaying = false;
  if (controllerSettings.mode === 'gamepad') { showPause(t('gamepad.notConnected')); return; }
  if (!canvas.requestPointerLock) { showPause('Utilise un navigateur de bureau avec clavier et souris.'); return; }
  const raw = rawMouse && !rawMouseUnsupported, request = ++mouseLockRequest;
  // The mode in use stays until a capture is granted: a refused request (for
  // example while another one is pending) changes nothing in place.
  ignoredLockErrors = 0;
  recordAim('pointer-request', () => ({ rawRequested: raw, geometry: viewGeometry() }));
  requestMouseLock(canvas, { raw, onFallback: (error, { errorEvent }) => {
    // Remember the refusal for this page: later captures go straight to the
    // plain request. Its own pointerlockerror must not open the menu.
    rawMouseUnsupported = true; if (errorEvent) ignoredLockErrors++;
    recordAim('pointer-raw-unsupported', { error: error?.name ?? null });
  } }).then(result => {
    const latest = request === mouseLockRequest;
    // A browser that never read the option ignores it: later captures stay plain.
    if (result.rawIgnored) rawMouseUnsupported = true;
    // Overlapping requests settle in any order; the last one granted is the
    // capture in place, whichever was sent last.
    if (!result.error) mouseLockMode = result.mode;
    recordAim('pointer-lock-result', { rawRequested: raw, mode: result.mode, fallback: result.fallback, rawIgnored: result.rawIgnored, latest, error: result.error?.name ?? null });
    refreshMouseLookStatus();
    if (!result.error || !latest) return;
    console.warn('Pointer Lock:', result.error.name, result.error.message);
    showPause('La souris n’a pas pu être activée. Clique ci-dessous pour réessayer ; si le refus persiste, ouvre le jeu dans un onglet de navigateur de bureau.');
  });
}
function resetInput() { secondaryFiring = false; secondaryShotAt = null; dualCycleSince = null; dualCycleConsumed = false; flameStreams.get(`${myId}:secondary`)?.stop(); if (secondarySpinRequested) send({type:'minigun-spin',hand:'secondary',spinning:false}); secondarySpinRequested = false; controller.reset(); aimAssist.reset(); controllerCrouched = false; setScope(false); keys.clear(); groundInteractHeld = false; reviveHeld = false; firing = false; cancelMelee(); fireAudioWeapon = null; reloadAudioRequested = false; stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(); flameStreams.get(myId)?.stop(); stopReloadAudio(true); stopSecondaryReloadAudio(); send({ type: 'input', forward: 0, strafe: 0, yaw, pitch, crouch: false, sprint: false, jump: false }); }
// The recoil of a shot, felt in the hands when playing with the controller.
function shotRumble(weapon) {
  if (!controllerPlaying || !activePad) return;
  playRumble(activePad, rumbleEffect(weapon, controllerSettings.rumble));
}
function showPause(description) {
  if (!inGame || supplyMenu || finishedPhase(snapshot?.phase) || (snapshot?.phase === 'extraction' && !snapshot.paused)) return;
  stopRumble(activePad);
  controllerPlaying = false; resetInput();
  const paused = snapshot?.paused === true, host = snapshot?.hostId === myId;
  $('pause').hidden = false;
  writeText($('pause-title'), paused ? () => t('pause.stoppedTitle') : snapshot?.practice === true ? () => t('practice.title') : snapshot?.phase === 'lobby' && host ? 'La nuit t’attend.' : 'Reprendre ton poste.');
  writeText($('pause-description'), paused ? () => t(host ? 'pause.stoppedHost' : 'pause.stoppedGuest') : description || (snapshot?.practice === true ? () => t('practice.pauseDescription') : snapshot?.phase === 'lobby' ? host ? 'Ton équipe est prête. Lance la nuit quand tu veux.' : 'L’hôte lancera la nuit. Tu peux explorer le refuge.' : () => t('pause.description')));
  writeText($('resume-button'), paused ? () => t(host ? 'pause.continue' : 'pause.waiting') : snapshot?.practice === true ? () => t('practice.return') : snapshot?.phase === 'lobby' && host ? 'Lancer la nuit ↗' : 'Retour au refuge ↗');
  refreshPauseControls();
}
function leave(close = true) {
  closeSupplyMenu(false); hideWaveCard();
  ambianceEntryPending = false; if (ambianceWanted !== 'family') setAmbiance('family');
  ambianceFrame.self = ambianceFrame.snapshot = null;
  // The next room starts on Famille again, whatever this one was.
  homeAmbiance = 'family'; renderHomeAmbiance();
  pendingExplosionSounds.length = 0; resetCombatFeel(); ballisticTime = 0; raiderIds.fill(null);
  world.effects?.particles.clear();
  controllerPlaying = false;
  resetInput();
  fireAudioWeapon = null; triggerSoundPlayed = false; reloadAudioConfirmed = false; reloadAudioRequested = false;
  intentionalClose = true; if (close) websocket?.close(); websocket = null; myId = null; room = null; snapshot = null; inGame = false;
  refreshEnemyGuide();
  radarUI.reset();
  const radarControls = $('radar-controls'); if (radarControls) radarControls.hidden = true;
  sound.updateScene(null, false); sound.stop();
  clearTimeout(connectionDeadline); keys.clear(); firing = false; cameraReady = false; aimReady = false; lastPhase = null; lastHostId = null; lastRoomPaused = false; pauseRequestTarget = null; lastHealth = 100; hurtSource = null; hurtSourceLoss = 0;
  recordAim('leave');
  restartRequested = false; $('restart-button').disabled = false; extraction.reset();
  cancelLoad(); saveRequested = false; $('save-game-status').hidden = true; $('lobby-load-status').hidden = true;
  lastOutsideHurtAt = -Infinity; nextZombieGroanAt = 0; $('outside-warning').hidden = true; $('damage-flash').classList.remove('armor');
  companionsNotice = null; companionsWereAvailable = false;
  pickupNoticeUntil = 0; pickupNoticeKind = null; pickupPoints = 0; $('pickup-notice').hidden = true;
  document.exitPointerLock?.();
  for (const mesh of [...zombieMeshes.values(), ...playerMeshes.values(), ...pickupMeshes.values(), ...grenadeMeshes.values(), ...corpses]) scene.remove(mesh);
  for (const mesh of [...zombieMeshes.values(), ...corpses]) disposeZombie(mesh);
  zombieMeshes.clear(); playerMeshes.clear(); pickupMeshes.clear(); grenadeMeshes.clear(); corpses.length = 0;
  fallenIds.fill(null); fallenBodies.fill(null); fallenNext = 0;
  meleeAnimations.clear();meleeSeen.clear();zombieMotion.clear();playerMotion.clear();meleeRequestUntil=-Infinity;sound.releaseMelee?.();
  for (const effect of explosions.splice(0)) { scene.remove(effect.mesh); effect.dispose(); }
  for (const tracer of tracers.splice(0)) { scene.remove(tracer.mesh); tracer.dispose(); }
  for (const stream of flameStreams.values()) stream.dispose(); flameStreams.clear();
  for (const id of ['lobby', 'hud', 'pause', 'gameover']) $(id).hidden = true;
  $('survivor-sheet').hidden = true; survivorSheetContentKey = survivorSheetGeometryKey = ''; survivorSheetRect = null; survivorSheetCards = []; placeTeamFeed(null);
  $('menu').hidden = false; document.body.classList.remove('playing', 'extracting', 'practice');
  $('practice-controls').hidden = true; pendingPracticeEntry = false;
  $('connect-button').disabled = false; $('practice-button').disabled = false; joining = false; if (gun) gun.visible = false; flashlight.visible = false;
  updateConnection(true, 'COOPÉRATION · 1–4 JOUEURS');
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
  for (const id of ['north', 'south', 'west', 'east']) world.setDoor(id, 1);
  clearRaidPresentation();
}

// The HTML lists two maps; a LAN gateway names its own in a meta tag, in order.
function mapOption(id) {
  const option = document.createElement('option');
  option.value = id; option.dataset.i18n = 'levels.' + id; option.textContent = t('levels.' + id);
  return option;
}
if (mapContext.enabled) {
  const select = $('level-choice'), present = [...(select.options ?? select.children ?? [])];
  const offered = mapContext.maps.map(id => present.find(option => option.value === id) ?? mapOption(id));
  for (const option of present) if (!offered.includes(option)) option.remove();
  select.append(...offered);
}
$('level-choice').value = mapContext.offers(LEVEL.id) ? LEVEL.id : 'cabin';
$('level-choice').onchange = refreshMapLabels;
$('level-picker').hidden = !mapContext.enabled || joinMode;
refreshMapLabels();
$('create-tab').onclick = () => setJoinMode(false);
$('join-tab').onclick = () => { setJoinMode(true); $('room-code').focus(); };
$('connect-button').onclick = connect;
$('practice-button').onclick = () => connect({ practice: true });
// Famille, Frisson léger, Frisson: either Frisson only on a PC not locked to Famille.
for (const id of AMBIANCES) $(`ambiance-${id}`).onclick = () => { if (!isFrissonLike(id) || !familyLocked) homeAmbiance = id; renderHomeAmbiance(); };
$('family-lock').onchange = event => {
  familyLocked = event.target.checked === true;
  try { localStorage.setItem(FAMILY_LOCK_KEY, familyLocked ? '1' : '0'); } catch {}
  // Read back: blocked storage throws, or keeps nothing.
  familyLockKept = readFamilyLock(!familyLocked) === familyLocked;
  renderHomeAmbiance();
};
window.addEventListener('storage', event => {
  if (event.key === FAMILY_LOCK_KEY || event.key === null) applyFamilyLock(readFamilyLock(familyLocked));
  characterPicker.storageChanged(event.key); // characters saved in another tab
});
renderHomeAmbiance();
$('practice-equip').onclick = () => practiceAction('weapon', $('practice-weapon').value);
for (const weapon of ['assault', 'rocket', 'flamethrower','bat','fireaxe','katana','hammer','sniper']) $(`practice-${weapon}`).onclick = () => practiceAction('weapon', weapon);
$('practice-refill').onclick = () => practiceAction('refill');
$('practice-targets').onclick = () => practiceAction('targets');
$('dual-toggle').onclick = toggleDual;
$('survivor-sheet-toggle').onclick = toggleSurvivorSheet;
refreshSurvivorSheetButton();
$('dual-secondary').onchange = () => { if (myPlayer()?.dualWield) { secondaryFiring = false; send({type:'dual-wield',enabled:true,secondaryWeaponId:$('dual-secondary').value}); } };
$('practice-radar').onclick = () => practiceAction('radar');
$('practice-backpack').onclick = () => practiceAction('backpack');
$('practice-raiders').onclick = () => practiceAction('raiders');
$('supply-return').onclick = () => closeSupplyMenu();
for (const input of [$('player-name'), $('room-code')]) input.addEventListener('keydown', event => { if (event.key === 'Enter') connect(); });
$('start-button').onclick = () => { if (!ambianceReady || !levelReady) return; if (snapshot?.hostId === myId && snapshot.phase === 'lobby') send({ type: 'start' }); enterGame(); };
$('room-pause-button').onclick = () => requestRoomPause(true);
$('save-game-button').onclick = requestSave;
$('load-game-button').onclick = () => toggleLoadPanel();
$('load-cancel').onclick = () => { toggleLoadPanel(false); $('load-game-button').focus?.(); };
$('load-file-button').onclick = () => $('load-file').click();
$('load-file').onchange = event => { loadFile(event.target?.files?.[0]); if (event.target) event.target.value = ''; };
$('resume-button').onclick = () => { if (snapshot?.paused) { requestRoomPause(false); return; } if (snapshot?.hostId === myId && snapshot.phase === 'lobby') send({ type: 'start' }); resetInput(); $('pause').hidden = true; sound.unlock(); requestPointer(); };
$('restart-button').onclick = () => {
  if (snapshot?.hostId !== myId || !finishedPhase(snapshot.phase) || restartRequested) return;
  restartRequested = true; $('restart-button').disabled = true; send({ type: 'restart' });
};
for (const id of ['leave-lobby', 'leave-game', 'leave-over']) $(id).onclick = () => leave();
$('copy-link').onclick = async () => {
  const link = mapContext.shareUrl(shareOrigin, room);
  let copied = false;
  try { await navigator.clipboard.writeText(link); copied = true; } catch {
    const input = document.createElement('textarea'); input.value = link; input.style.position = 'fixed'; input.style.left = '-9999px'; document.body.append(input); input.select();
    try { copied = document.execCommand('copy'); } catch {} input.remove();
  }
  writeText($('copy-link'), copied ? 'Lien copié ✓' : 'Sélectionne le lien ci-dessous');
  setTimeout(() => { writeText($('copy-link'), 'Copier le lien'); }, 2500);
};
$('copy-room-code').onclick = () => copyRoomValue('code');
$('copy-room-link').onclick = () => copyRoomValue('link');
$('hud-room').onclick = () => { resetInput(); document.exitPointerLock?.(); showPause(); $('copy-room-code').focus(); };
$('admission-ready').onclick = () => { if (myPlayer()?.waiting && !myPlayer()?.ready) send({ type: 'ready' }); };
for (const id of ['input-mode', 'input-mode-start']) $(id).onchange = event => changeControllerSettings({ mode: event.target.value });
$('gamepad-sensitivity').oninput = event => changeControllerSettings({ sensitivity: Number(event.target.value) });
$('gamepad-deadzone').oninput = event => changeControllerSettings({ deadzone: Number(event.target.value) });
$('gamepad-aim-assist').onchange = event => changeControllerSettings({ aimAssist: event.target.value });
$('gamepad-rumble').onchange = event => changeControllerSettings({ rumble: event.target.value });
$('gamepad-invert-y').onchange = event => changeControllerSettings({ invertY: event.target.checked });
syncControllerSettings();
$('volume').oninput = event => { volume = Number(event.target.value); sound.setVolume(muted ? 0 : volume); };
$('music-volume').value = String(musicVolume);
$('music-volume').oninput = event => { musicVolume = Number(event.target.value); sound.setMusicVolume(musicVolume); saveMusicVolume(musicVolume); };
$('sensitivity').oninput = event => { sensitivity = Number(event.target.value); };
// Applies at the next capture; the menu is open, so the pointer is free.
$('raw-mouse').onchange = event => {
  rawMouse = saveRawMouse(controllerStorage(), event.target.checked);
  recordAim('raw-mouse-setting'); refreshMouseLookStatus();
};
refreshMouseLookStatus();
function syncCameraSmoothing() {
  for (const [key, id] of [['heightMs', 'camera-height-smoothing'], ['recoilMs', 'camera-recoil-smoothing']]) {
    $(id).value = String(cameraSmoothing[key]);
    $(`${id}-value`).textContent = `${Math.round(cameraSmoothing[key])} ms`;
  }
}
function saveCameraSmoothing() {
  try { localStorage.setItem(CAMERA_SMOOTHING_KEY, JSON.stringify(cameraSmoothing)); } catch {}
  syncCameraSmoothing();
}
for (const [key, id] of [['heightMs', 'camera-height-smoothing'], ['recoilMs', 'camera-recoil-smoothing']]) {
  $(id).oninput = event => {
    cameraSmoothing = normalizeCameraSmoothing({ ...cameraSmoothing, [key]: Number(event.target.value) });
    saveCameraSmoothing();
  };
}
$('camera-smoothing-reset').onclick = () => { cameraSmoothing = { ...CAMERA_SMOOTHING_DEFAULTS }; saveCameraSmoothing(); };
syncCameraSmoothing();
let graphicsChoice = graphics.choice, graphicsReloadPending = false;
function refreshGraphicsQualityStatus() {
  const preset = t(`graphics.level.${graphics.preset.id}`);
  $('graphics-quality-status').textContent = (graphicsChoice === 'auto'
    ? t('graphics.statusAuto', { preset })
    : t('graphics.statusManual', { preset }))
    + (graphicsReloadPending ? ` ${t('graphics.reload')}` : '');
}
$('graphics-quality').value = graphicsChoice;
refreshGraphicsQualityStatus();
$('graphics-quality').onchange = event => {
  const result = graphics.setChoice(event.target.value);
  graphicsChoice = result.choice;
  graphicsReloadPending = result.reloadRequired;
  refreshGraphicsQualityStatus();
};
$('aim-diagnostic-enable').onchange = event => {
  aimDiagnostics.setEnabled(event.target.checked);
  lastAimSample = -Infinity;
  $('aim-diagnostic-output').value = ''; $('aim-diagnostic-output').hidden = true;
  recordAim('enabled'); refreshAimDiagnostics();
};
$('aim-diagnostic-capture').onclick = captureAimIncident;
$('aim-diagnostic-clear').onclick = () => {
  aimDiagnostics.clear(); lastAimSample = -Infinity;
  $('aim-diagnostic-output').value = ''; $('aim-diagnostic-output').hidden = true;
  recordAim('rearmed'); refreshAimDiagnostics();
};
$('aim-diagnostic-report').onclick = () => {
  if (!aimDiagnostics.enabled) return;
  const report = aimDiagnostics.report({ build:pageBuild, units:'radians / metres / milliseconds', input:'mousemove', viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},
    geometry:viewGeometry(), mouse:{ ...mouseLookState(), warpEcho:{ ...WARP_ECHO } }, browser:{ userAgent:globalThis.navigator?.userAgent ?? null,
      brands:globalThis.navigator?.userAgentData?.brands?.map(brand => `${brand.brand} ${brand.version}`) ?? null, platform:globalThis.navigator?.userAgentData?.platform ?? null } });
  $('aim-diagnostic-output').value = JSON.stringify(report, null, 2);
  $('aim-diagnostic-output').hidden = false;
  $('aim-diagnostic-output').focus(); $('aim-diagnostic-output').select();
};
$('sound-toggle').onclick = () => {
  muted = !muted; sound.unlock(); sound.setVolume(muted ? 0 : volume);
  updateSoundButton();
};
document.addEventListener('pointerlockchange', () => {
  const domLocked = document.pointerLockElement === canvas;
  pointerLocked = domLocked && inputFocused && !document.hidden && document.hasFocus?.() !== false;
  if (controllerPlaying && !domLocked) return;
  if (pointerLocked) controllerPlaying = false;
  recordAim('pointer-lock-change', () => ({ geometry: viewGeometry() }));
  if (pointerLocked && snapshot?.paused !== true) { $('pause').hidden = true; sound.unlock(); } else { if (domLocked) document.exitPointerLock?.(); resetInput(); showPause(); }
});
document.addEventListener('pointerlockerror', () => {
  // The refused raw option already triggered the plain request.
  if (ignoredLockErrors > 0) { ignoredLockErrors--; recordAim('pointer-lock-error', { ignored: true }); return; }
  recordAim('pointer-lock-error'); showPause('Le navigateur demande un clic pour activer la souris.');
});
document.addEventListener('mousemove', event => {
  // The browser may update focus/capture before dispatching pointerlockchange.
  // Latch that loss now: returning focus alone must not resume stale input.
  if (pointerLocked && (document.pointerLockElement !== canvas || !inputFocused || document.hidden || document.hasFocus?.() === false)) {
    pointerLocked = false; recordAim('capture-unavailable'); resetInput(); showPause();
  }
  const allowed = inGame && pointerLocked && document.pointerLockElement === canvas && inputFocused && !document.hidden && document.hasFocus?.() !== false && !supplyMenu && $('pause').hidden && controlsAvailable();
  const valid = Number.isFinite(event.movementX) && Number.isFinite(event.movementY);
  const tracing = aimDiagnostics.enabled && !aimDiagnostics.captured, before = tracing ? { yaw, pitch } : null;
  const intervalMs = event.timeStamp - lastMouseMoveTime;
  if (Number.isFinite(event.timeStamp)) lastMouseMoveTime = event.timeStamp;
  // Raw counts have no warp; otherwise drop only the measured warp echo.
  const raw = mouseLockMode === 'raw', scale = raw ? rawMovementScale(devicePixelRatio) : 1;
  const dropped = allowed && valid && !raw && warpEcho({ movementX:event.movementX, movementY:event.movementY, intervalMs, width:innerWidth, height:innerHeight });
  if (dropped) { droppedMouseSpikes++; refreshMouseLookStatus(); }
  if (allowed && valid && !dropped) {
    const aimSensitivity = sensitivity * scale * (scoped ? SNIPER_FOV / NORMAL_FOV : 1);
    yaw -= event.movementX * aimSensitivity; pitch = THREE.MathUtils.clamp(pitch - event.movementY * aimSensitivity, -1.48, 1.48);
  }
  if (tracing) recordAim('mouse', { movementX:event.movementX, movementY:event.movementY, eventTime:event.timeStamp, intervalMs: Number.isFinite(intervalMs) ? intervalMs : null, trusted:event.isTrusted,
    screenX:event.screenX, screenY:event.screenY, clientX:event.clientX, clientY:event.clientY, scale,
    edgeX: event.movementX / (innerWidth * WARP_ECHO.border), edgeY: event.movementY / (innerHeight * WARP_ECHO.border),
    large: valid && warpEchoSized(event.movementX, event.movementY, innerWidth, innerHeight), dropped: dropped ? 'warp-echo' : null,
    accepted:allowed && valid && !dropped, before, after:{yaw,pitch} });
});
document.addEventListener('mousedown', event => {
  if (event.button === 2 && myPlayer()?.dualWield && inGame && pointerLocked && !supplyMenu && $('pause').hidden && controlsAvailable() && myPlayer()?.alive && !myPlayer()?.downed && !myPlayer()?.umbrella?.open) { event.preventDefault?.(); secondaryFiring = true; return; }
  if(event.button===2 && scopeControlsActive()) { event.preventDefault?.(); setScope(true); return; }
  if(event.button===2&&meleeControlsActive()){
    event.preventDefault?.();if(secondaryHeld)return;secondaryHeld=true;firing=false;requestMelee('heavy');return;
  }
  if(event.button===0&&inGame&&pointerLocked&&!supplyMenu&&$('pause').hidden&&controlsAvailable()&&myPlayer()?.alive&&!myPlayer()?.downed&&!myPlayer()?.umbrella?.open){
    firing=true;fireAudioWeapon=myPlayer()?.reloading?null:myPlayer()?.weapon;triggerSoundPlayed=false;reloadAudioRequested=false;reloadSoundCancelled=false;updateMinigunSpin();
    if(meleeProfile())requestMelee('light');
  }
});
document.addEventListener('mouseup', event => { if(event.button===2){secondaryHeld=false;secondaryFiring=false;releaseHandFire('secondary');setScope(false);}if (event.button === 0) { firing = false; stopMinigunSpin(); releaseHandFire(); } });
document.addEventListener('contextmenu',event=>{if(myPlayer()?.dualWield||meleeControlsActive()||scopeControlsActive())event.preventDefault();});
document.addEventListener('keydown', event => {
  if (event.code === 'Tab' && survivorSheetKeyAllowed(event)) {
    // One press shows the sheet, the next hides it; holding Tab does nothing more.
    event.preventDefault?.(); if (!event.repeat) toggleSurvivorSheet(); return;
  }
  if (event.code === 'F8' && aimDiagnostics.enabled && inGame && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target?.isContentEditable && !event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) {
    event.preventDefault?.(); if (!event.repeat) captureAimIncident(); return;
  }
  // P works from the menu as well as Pointer Lock. Keep typing and native
  // shortcuts intact in editable controls, including the settings selectors.
  if (event.code === 'KeyP' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target?.isContentEditable && !event.target?.matches?.('input,textarea,select,[contenteditable="true"]')) {
    if (inGame && roomPauseAvailable()) { event.preventDefault?.(); if (!event.repeat) requestRoomPause(); }
    return;
  }
  if (supplyMenu) {
    if (event.code === 'Escape') { event.preventDefault?.(); closeSupplyMenu(); }
    else if (!event.repeat && event.code === 'KeyB' && controlsAvailable() && snapshot?.expedition?.enabled && myPlayer()?.alive && !myPlayer()?.downed) { event.preventDefault?.(); send({type:'umbrella',open:!myPlayer().umbrella?.open}); }
    return;
  }
  if (event.code === 'Escape' && inGame) {
    event.preventDefault(); if (!controlsAvailable() && snapshot?.paused !== true) return;
    resetInput(); document.exitPointerLock?.(); showPause(); return;
  }
  if (!pointerLocked || !inGame || !controlsAvailable() || !$('pause').hidden || document.hidden) return;
  keys.add(event.code);
  if (CROUCH_KEYS.includes(event.code) || event.ctrlKey || keys.has('ControlLeft') || keys.has('ControlRight') || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault?.();
  if (CROUCH_KEYS.includes(event.code)) send(inputMessage());
  if (!event.repeat && event.code === 'KeyX') { toggleDual(); return; }
  if (!event.repeat && event.code === 'KeyR'&&!meleeProfile()) { setScope(false); fireAudioWeapon = null; reloadAudioRequested = true; reloadSoundCancelled = false; stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); flameStreams.get(myId)?.stop(); send({ type: 'reload' }); }
  const self = myPlayer(), active = self?.alive && !self.downed && ['countdown', 'wave', 'intermission'].includes(snapshot.phase);
  if (!event.repeat && event.code === 'KeyN') voteNextWave();
  if (!event.repeat && event.code === 'KeyF') useReviveKit();
  if (!event.repeat && event.code === 'KeyT') dropCoins();
  if (!event.repeat && active && event.code === 'KeyB' && snapshot.expedition?.enabled) {
    setScope(false);
    firing = false; fireAudioWeapon = null; cancelMelee(); stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); flameStreams.get(myId)?.stop();
    send({ type: 'umbrella', open: !self.umbrella?.open });
  }
  if (!event.repeat && active && event.code === 'KeyV' && self.weapon) {
    setScope(false);
    cancelMelee();
    firing = false; fireAudioWeapon = null; reloadAudioRequested = false; stopMinigunSpin(); sound.releaseFire?.(); sound.releasePump?.(myId); stopReloadAudio(true); stopSecondaryReloadAudio(); send({ type: 'drop-weapon' });
  }
  if (!event.repeat && active && !self.umbrella?.open && event.code === 'KeyG' && self.grenades > 0 && !(self.throwLeft > 0)) { send(inputMessage()); send({ type: 'grenade' }); }
  if (!event.repeat && active && event.code === 'KeyE') pressInteract(self, performance.now());
  const slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[event.code];
  if (slot !== undefined && !event.repeat) {
    if (slot >= weaponSlotLimit(self)) return;
    const weapon = weaponSlotId(carriedWeapons()[slot]);
    if (!weapon) toast(() => t('ground.emptyHint'));
    else switchWeapon(weapon);
  }
});
document.addEventListener('wheel', event => {
  if (!pointerLocked || !inGame || !$('pause').hidden || document.hidden || !controlsAvailable() || !myPlayer()?.alive || myPlayer().downed || !event.deltaY) return;
  event.preventDefault();
  const weapons = carriedWeapons(), current = weapons.findIndex(entry => weaponSlotId(entry) === selectedWeaponId());
  const next = (current + (event.deltaY > 0 ? 1 : -1) + weapons.length) % weapons.length;
  if (weapons[next]) switchWeapon(weaponSlotId(weapons[next]));
}, { passive: false });
document.addEventListener('keyup', event => {
  keys.delete(event.code);
  if (event.code === 'KeyE') { groundInteractHeld = false; reviveHeld = false; }
  if (CROUCH_KEYS.includes(event.code) && inGame) send(inputMessage());
});
function loseInputFocus(reason) {
  inputFocused = false; pointerLocked = false; controllerPlaying = false;
  recordAim(reason);
  resetInput();
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  showPause();
}
window.addEventListener('blur', () => loseInputFocus('blur'));
window.addEventListener('focus', () => { inputFocused = true; recordAim('focus'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { loseInputFocus('hidden'); radarUI.reset(); }
  else recordAim('visible');
});
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); graphics.resize(innerWidth, innerHeight); recordAim('resize', () => ({ geometry: viewGeometry() })); });
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); resetInput(); $('boot-error').hidden = false; writeText($('boot-error-detail'), 'Le navigateur a perdu sa connexion à la carte graphique. Recharge la page.'); });
const entryUrl = new URL(location.href), urlRoom = entryUrl.searchParams.get('room');
if (entryUrl.searchParams.get('practice') === '1') $('practice-button').focus();
else if (urlRoom) { setJoinMode(true); $('room-code').value = urlRoom.slice(0, 6).toUpperCase(); }
// Only an explicit click on the other map creates this one-time draft. Bare
// root visits always keep the cabin default and never autojoin a remembered room.
if (mapHandoff) {
  $('player-name').value = mapHandoff.name;
  homeAmbiance = familyLocked ? 'family' : ambianceOf(mapHandoff.ambiance);
  mapSheetDraft = mapHandoff.sheet ?? null;
  if (mapSheetDraft) characterPicker.adopt(mapSheetDraft);
  if (mapHandoff.language === 'fr' || mapHandoff.language === 'en') setLanguage(mapHandoff.language);
  if (mapHandoff.audio) {
    muted = mapHandoff.audio.muted === true;
    if (Number.isFinite(mapHandoff.audio.volume)) volume = Math.max(0, Math.min(1, mapHandoff.audio.volume));
    $('volume').value = String(volume);
    sound.setVolume(muted ? 0 : volume); updateSoundButton();
  }
  renderHomeAmbiance();
  if (mapHandoff.action === 'load') {
    try { beginLoad(JSON.parse(mapHandoff.text), mapHandoff.text); } catch { showMenuError(() => t('levels.transferFailed')); }
  } else if (mapHandoff.action === 'join') {
    setJoinMode(true); $('room-code').value = String(mapHandoff.room ?? ''); connect();
  } else { setJoinMode(false); connect({ practice: mapHandoff.action === 'practice' }); }
}

function updateZombieGroans(now, self) {
  if (!inGame || snapshot?.paused === true || !self?.alive || !['countdown', 'wave', 'intermission'].includes(snapshot?.phase)) { nextZombieGroanAt = 0; return; }
  if (now < nextZombieGroanAt) return;
  nextZombieGroanAt = now + 500;
  let nearest = Infinity;
  for (const zombie of snapshot.zombies) {
    if (zombie.kind === 'brute' || zombie.kind === 'raider' || zombie.boss || zombie.hp <= 0) continue;
    nearest = Math.min(nearest, Math.hypot(zombie.x - self.x, zombie.y - self.y, zombie.z - self.z));
  }
  if (nearest > 12) return;
  sound.groan(.055 * (.2 + .8 * (1 - nearest / 12)));
  nextZombieGroanAt = now + 2500 + Math.random() * 2500;
}
function frame(now) {
  requestAnimationFrame(frame);
  refreshRadarMap(now);
  layoutSurvivorSheet();
  const frameSeconds = Math.max(0, (now - lastFrame) / 1000);
  const delta = Math.min(.05, frameSeconds); lastFrame = now;
  updateController(now, delta);
  if (snapshot?.paused === true) {
    sound.updateFootsteps(myPlayer(), false);
    graphics.render(delta);
    return;
  }
  ballisticTime += frameSeconds;
  for (const [id, group] of ballisticHitSounds) if (group.expiresAt <= ballisticTime) ballisticHitSounds.delete(id);
  // A hit-stop slows the world's clock for a few hundredths of a second; the
  // last kill of a wave slows it for most of a second.
  const visualStep = frameSeconds * Math.min(hitStop.scale(now / 1000), slowMotion.scale(now / 1000));
  visualTime += visualStep;
  // The melee swing gate runs on this clock: give back what a hit-stop held,
  // so the freeze never slows the next swing.
  if (visualStep < frameSeconds && Number.isFinite(meleeRequestUntil)) meleeRequestUntil -= frameSeconds - visualStep;
  const elapsed = visualSeconds();
  const self = myPlayer();
  // Use the same paused timeline as the flying rocket and its blast. A wall-
  // clock timer could explode audibly during pause or after leaving the room.
  for (let index = pendingExplosionSounds.length - 1; index >= 0; index--) {
    if (pendingExplosionSounds[index].at > elapsed) continue;
    const cue = pendingExplosionSounds.splice(index, 1)[0];
    if (inGame && !document.hidden) cue.play();
  }
  for (let index = pendingCues.length - 1; index >= 0; index--) {
    if (pendingCues[index].at > elapsed) continue;
    const cue = pendingCues.splice(index, 1)[0];
    if (inGame && !document.hidden) cue.play();
  }
  flushChains();
  if (scoped && !scopeControlsActive(self)) setScope(false);
  refreshScopeDistance(now);
  updateMinigunSpin(self);
  updateZombieGroans(now, self);
  const cinematic = ['extraction', 'victory'].includes(snapshot?.phase);
  if (secondaryGun && (cinematic || !inGame || !self)) secondaryGun.visible = false;
  sound.updateFootsteps(self, inGame && controlsCaptured() && $('pause').hidden && $('gameover').hidden && !document.hidden && controlsAvailable());
  if ((cinematic || !inGame || !self) && !scoped && camera.fov !== NORMAL_FOV) { camera.fov = NORMAL_FOV; camera.updateProjectionMatrix?.(); }
  if (cinematic) {
    camera.position.copy(extraction.cameraPosition); camera.lookAt(extraction.cameraTarget);
    if (gun) gun.visible = false;
  } else if (!inGame || !self) {
    if (IS_FUNFAIR) { camera.position.set(Math.sin(elapsed * .07) * .3, 1.75, 3.2); camera.lookAt(6, 1.5, -6); }
    else if (IS_HOSPITAL) { camera.position.set(Math.sin(elapsed * .07) * .3, 1.75, 3.2); camera.lookAt(-6, 1.5, -10.5); }
    else if (IS_SUPERMARKET) { camera.position.set(-4.1 + Math.sin(elapsed * .07) * .3, 1.75, 8.1); camera.lookAt(-4.2, 1.6, -7.5); }
    else { camera.position.set(-4.5 + Math.sin(elapsed * .07) * .7, 2.3, 4.6); camera.lookAt(3.4, 2.7, -2.8); }
  } else {
    const eyeHeight = self.downed || !self.alive ? .5 : Number.isFinite(self.eyeHeight) ? self.eyeHeight : self.crouched ? PLAYER_POSTURE.crouchedEye : PLAYER_POSTURE.standingEye;
    const target = new THREE.Vector3(self.x, cameraSupportHeight(self) + eyeHeight, self.z);
    if (!cameraReady) { cameraBasePosition.copy(target); cameraRecoil = 0; cameraReady = true; recordAim('camera-position-initialized'); }
    const cameraHorizontalAlpha = 1 - Math.exp(-delta * 22);
    cameraBasePosition.x += (target.x - cameraBasePosition.x) * cameraHorizontalAlpha;
    cameraBasePosition.z += (target.z - cameraBasePosition.z) * cameraHorizontalAlpha;
    cameraBasePosition.y += (target.y - cameraBasePosition.y) * cameraSmoothingAlpha(delta, cameraSmoothing.heightMs);
    camera.position.copy(cameraBasePosition);
    const movement = inputMessage();
    const moving = controlsCaptured() && controlsAvailable() && Math.hypot(movement.forward, movement.strafe) > .01;
    const sprinting = movement.sprint;
    const bob = moving && self.grounded !== false && !self.downed ? Math.sin(elapsed * (self.crouched ? 6 : sprinting ? 13 : 9)) * (self.crouched ? .012 : .028) : 0;
    camera.position.y += bob;
    // Ease only the cosmetic kick. Mouse yaw/pitch and weapon recoil stay direct.
    cameraRecoil += (recoil - cameraRecoil) * cameraSmoothingAlpha(delta, cameraSmoothing.recoilMs);
    camera.rotation.set(pitch + cameraRecoil * .18, yaw, 0, 'YXZ');
    // Shake moves and rolls the view only: yaw and pitch, so the aim, stay put.
    cameraShake.sample(frameSeconds, feedback.settings.shake, shakeOffset);
    shakeOffset.dx = Math.cos(yaw) * shakeOffset.x; shakeOffset.dz = -Math.sin(yaw) * shakeOffset.x; shakeOffset.applied = true;
    camera.position.x += shakeOffset.dx; camera.position.z += shakeOffset.dz;
    camera.position.y += shakeOffset.y; camera.rotation.z = shakeOffset.roll;
    // Sprinting widens the view a little; the sniper scope keeps its own.
    if (!scoped) {
      const goal = NORMAL_FOV + (sprinting && moving && self.grounded !== false && !self.crouched && !self.downed ? SPRINT_FOV_BOOST : 0);
      const next = Math.abs(goal - camera.fov) < .05 ? goal : camera.fov + (goal - camera.fov) * (1 - Math.exp(-delta * 7));
      if (next !== camera.fov) { camera.fov = next; camera.updateProjectionMatrix?.(); }
    }
    if (gun) {
      gun.visible = !scoped && self.alive && !self.downed && !self.umbrella?.open && !finishedPhase(snapshot.phase);
      applyWeaponViewPose(gun, { time: elapsed, moving, bob, recoil, reloading: self.reloading });
      if(meleeProfile(self.weapon))animateMeleeWeapon(gun,meleeAnimation(myId,elapsed)??{elapsed:Infinity});
      animateWeaponMechanism(gun,{time:elapsed,shotElapsed:gun.userData.shotAt===undefined?Infinity:elapsed-gun.userData.shotAt,reloading:self.reloading});
      if (gun.userData.rotor) gun.userData.rotor.rotation.z -= delta * minigunRotorSpeed({ spinning: controlsCaptured() && controlsAvailable() && firing && self.minigunSpinning, spinLeft: self.minigunSpinLeft, duration: snapshot.minigunSpinDuration ?? MINIGUN_TIMING.windup, reloading: self.reloading, downed: self.downed || !self.alive });
    }
    updateSecondaryFire(self, now, elapsed, moving, bob, delta);
    if (controlsAvailable() && now - lastInput >= 40) { send(inputMessage()); lastInput = now; }
    if (controlsCaptured() && controlsAvailable() && firing && self.weapon && self.alive && !self.downed && !self.umbrella?.open && !self.reloading && (self.weapon !== 'minigun' || self.minigunReady || self.ammo === 0) && ['wave', 'countdown', 'intermission'].includes(snapshot.phase)) {
      if(meleeProfile(self.weapon))requestMelee('light');
      else{
        // Every weapon keeps the server's slots: a held trigger fires evenly.
        const minigun = self.weapon === 'minigun', schedule = firingSchedule(now / 1000, minigun ? nextMinigunShotAt : nextShotAt, cadence[self.weapon]);
        if (minigun) nextMinigunShotAt = schedule.nextAt; else nextShotAt = schedule.nextAt;
        if (schedule.fire) { send(inputMessage()); send({ type: 'shoot' }); lastShot = now / 1000; }
      }
    }
    // E / RB held through a fall (RB is also the kit while down) must be
    // released before it acts again once standing.
    if (self.downed) { groundInteractHeld = true; reviveHeld = false; }
    const interactHeld = controlsCaptured() && controlsAvailable() && self.alive && !self.downed && (controllerPlaying ? controllerState.held.interact : keys.has('KeyE'));
    if (interactHeld && self.revivingId) reviveHeld = true; // the server took this press as a revive
    // A held revive is renewed well inside REVIVE.holdGrace, even next to a
    // weapon or a bonus on the ground.
    if (interactHeld && reviveHeld && now - lastInteract > 250) { send({ type: 'interact', revive: true }); lastInteract = now; }
    else if (interactHeld && !reviveHeld && !groundInteractHeld && now - lastInteract > 570) {
      groundInteractHeld = groundInteractionAvailable(self); send({ type: 'interact' }); lastInteract = now;
    }
  }
  recoil *= Math.exp(-delta * 16);
  if (aimDiagnostics.enabled && !aimDiagnostics.captured && now - lastAimSample >= 100) { recordAim('frame', { frameSeconds, recoil }); lastAimSample = now; }
  muzzleLight.intensity = now < muzzleUntil ? 7 : 0;
  if (gun) copyWeaponMuzzleInView(gun, muzzleLight.position);
  const alpha = 1 - Math.exp(-delta * 17);
  for (const mesh of zombieMeshes.values()) {
    mesh.position.lerp(mesh.userData.target, alpha);
    const d = mesh.userData;
    if (d.raider) {
      // AI turns are abrupt: ease along the shortest arc, kept outside rotation.
      const target = Number.isFinite(d.yaw) ? d.yaw : d.renderYaw ?? 0, current = Number.isFinite(d.renderYaw) ? d.renderYaw : target;
      d.renderYaw = current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * (1 - Math.exp(-delta * 12));
      mesh.rotation.y = d.renderYaw;
      animateRaider(mesh, { ...d.state, time: elapsed, delta });
    } else { mesh.rotation.y = d.yaw; animateZombie(mesh, elapsed, true, delta); }
  }
  for (const [id,mesh] of playerMeshes) {
    mesh.position.lerp(mesh.userData.target, alpha); mesh.rotation.y = mesh.userData.yaw;
    const melee=meleeAnimation(id,elapsed);
    animateSurvivor(mesh, { ...mesh.userData.state, meleeAttack:melee?.attack,meleeElapsed:melee?.elapsed??Infinity,meleeWindup:melee?.windup,meleeDuration:melee?.duration,time: elapsed, delta });
  }
  ejectCasings(elapsed); updateGunHeat(elapsed, visualStep); updateSwingTrails(elapsed);
  for (let i = corpses.length - 1; i >= 0; i--) if (!(corpses[i].userData.raider ? animateRaiderDeath : animateZombieDeath)(corpses[i], elapsed)) { const body = corpses.splice(i, 1)[0]; scene.remove(body); disposeZombie(body); }
  for (let i = tracers.length - 1; i >= 0; i--) {
    if (tracers[i].update(elapsed)) continue;
    const tracer = tracers.splice(i, 1)[0]; scene.remove(tracer.mesh); tracer.dispose();
  }
  for (const [id, handle] of ballisticTracers) {
    if (handle.update(ballisticTime)) continue;
    scene.remove(handle.mesh); handle.dispose(); ballisticTracers.delete(id); ballisticShotGroups.delete(id);
  }
  for (const stream of flameStreams.values()) stream.update(elapsed);
  teamMuzzleLight.intensity = now < teamMuzzleUntil ? 6 : 0;
  for (const mesh of pickupMeshes.values()) { if (mesh.userData.glideTo) mesh.position.lerp(mesh.userData.glideTo, 1 - Math.exp(-delta * 18)); animatePickup(mesh, elapsed); }
  updateStragglers(elapsed);
  for (const mesh of grenadeMeshes.values()) {
    // Smooth the latest authoritative positions without extrapolating ahead
    // of the server. A bounce between snapshots can slightly cut a corner.
    mesh.position.lerp(mesh.userData.target, 1 - Math.exp(-delta * 35)); animateGrenadeProjectile(mesh, elapsed);
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (explosions[i].update(elapsed)) continue;
    const effect = explosions.splice(i, 1)[0]; scene.remove(effect.mesh); effect.dispose();
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    if (elapsed >= effects[i].until) { const effect = effects.splice(i, 1)[0]; scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); }
  }
  $('damage-flash').style.opacity = cinematic ? 0 : now < damageUntil ? .7 : self?.downed ? .18 : 0;
  refreshRaidIndicators(now, self, inGame && !cinematic);
  if (now >= bannerUntil) $('wave-banner').hidden = true;
  if (now >= toastUntil) $('toast').hidden = true;
  if (now >= waveCardUntil) $('wave-card').hidden = true;
  updateReviveLines(now); if ($('wave-card').hidden) settleReviveItems();
  // The end-of-wave card and the pickup notice share the bottom centre.
  $('pickup-notice').classList.toggle('behind-card', !$('wave-card').hidden);
  placeInteraction();
  if (now >= pickupNoticeUntil || !inGame || !self?.alive || self.downed || ['extraction', 'victory', 'gameover'].includes(snapshot?.phase)) $('pickup-notice').hidden = true;
  feedback.update(); damageNumbers.update(); friendlyNumbers.update(); expireCompanionCallouts(now);
  if (now >= friendlyCalloutUntil && !$('friendly-callout').hidden) $('friendly-callout').hidden = true;
  // After flushChains(): a look holds a rocket's kill sound until this clock
  // reaches the landing, and lines the chain jingle of the same frame up on it
  // (art/frisson/KILL-SOUND.md 1.3), so the jingle must be asked for first.
  if (inGame && ambianceHooks.frame) {
    ambianceFrame.delta = visualStep; ambianceFrame.time = elapsed; ambianceFrame.self = self; ambianceFrame.snapshot = snapshot;
    callAmbianceHook('frame', ambianceFrame);
  }
  // The funfair's mirrors show this survivor, for the reflections only (funfair-mirrors.js).
  world.setLocalAvatar?.(inGame && self && !cinematic ? { player: self, color: colors[Math.max(0, snapshot.players.indexOf(self)) % colors.length], x: cameraBasePosition.x, z: cameraBasePosition.z, yaw, pitch, melee: meleeAnimation(myId, elapsed) } : null);
  world.update(elapsed, { snapshot, myId, active: inGame, camera, survivors: playerMeshes }); updateExtraction(now); graphics.render(delta, { measure: inGame && !snapshot?.paused });
  // The shake is for the picture only: aim assist reads the steady eye.
  if (shakeOffset.applied) { camera.position.x -= shakeOffset.dx; camera.position.z -= shakeOffset.dz; camera.position.y -= shakeOffset.y; camera.rotation.z = 0; shakeOffset.applied = false; }
  previousTime = now;
}
requestAnimationFrame(frame);
