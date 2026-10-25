import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Derive an additive online entry point. Never edit the proven LAN sources.
// Every integration seam must occur exactly once: a conflicting upstream edit
// fails the build rather than silently shipping a half-adapted client.
const canonical = source => source.replace(/\r\n/g, '\n');
export function replaceExactlyOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Online client build: ${label} expected exactly one anchor, found ${count}.`);
  return source.replace(anchor, replacement);
}

const helpers = `
// Online presentation keeps authority in snapshot and local aim in yaw/pitch.
const onlineUI = createOnlineUI({ language: getLanguage });
const onlineShotReservations = new Map();
// Shots whose flash and casing were drawn at the click, kept across phase
// changes so the confirmation never repeats them; cleared with the session.
const onlineClickCosmetics = new Set();
// Farther than this, the predicted body is not the moment of the shot.
const ONLINE_TRACER_SHIFT = 4;
let onlineReservationEpoch = null, onlineReservationPaused = null, onlineReservationPhase = null;
function onlineReleaseReservations(state) {
  const epoch = state.net?.epoch ?? null, paused = state.paused === true;
  if (onlineReservationEpoch !== epoch || onlineReservationPaused !== paused || onlineReservationPhase !== state.phase) onlineShotReservations.clear();
  if (onlineReservationEpoch !== epoch) onlineClickCosmetics.clear();
  onlineReservationEpoch = epoch; onlineReservationPaused = paused; onlineReservationPhase = state.phase;
  for (const [id, shot] of onlineShotReservations) if (Number.isFinite(shot.time) && state.time >= shot.time || performance.now() - shot.at > 2000) onlineShotReservations.delete(id);
}
function onlineLocalShot(shotId, self, hand = 'primary') {
  const model = hand === 'secondary' ? secondaryGun : gun;
  if (hand === 'secondary') { if (!self?.dualWield || !self.hands?.secondary) return false; self = { ...self, ...self.hands.secondary }; }
  if (!self || !controlsCaptured() || !$('pause').hidden || document.hidden || !self.alive || self.downed || self.reloading
    || self.umbrella?.open || meleeProfile(self.weapon) || !['wave','countdown','intermission'].includes(snapshot?.phase)) return false;
  const weaponId = selectedWeaponId(self) ?? self.weapon;
  const pending = [...onlineShotReservations.values()].filter(shot => shot.weaponId === weaponId).length;
  if (!(self.ammo > pending)) return false;
  const muzzleView = model && (hand === 'secondary' ? model.userData.type : gunType) === self.weapon && self.weapon !== 'flamethrower'
    ? copyWeaponMuzzleInView(model, new THREE.Vector3()) : null;
  // Flash, casing, barrel heat and kick leave with the click, from the model on
  // screen; the confirmed shot then only draws its bullet and its impacts.
  const firedAt = visualSeconds(), flashed = Boolean(muzzleView && model?.userData?.muzzle && model.localToWorld);
  if (flashed) {
    camera.updateMatrixWorld();
    shotFlash(model.localToWorld(model.userData.muzzle.clone()), { yaw, pitch, weapon: self.weapon }, true, firedAt);
    shotCosmetics(myId, self.weapon, firedAt, hand);
    onlineClickCosmetics.add(shotId); if (onlineClickCosmetics.size > 256) onlineClickCosmetics.delete(onlineClickCosmetics.values().next().value);
  }
  cameraShake.add(SHOT_TRAUMA[self.weapon] ?? 0);
  onlineShotReservations.set(shotId, { weapon: self.weapon, weaponId, hand, time: null, at: performance.now(), muzzleView, firedAt, flashed });
  while (onlineShotReservations.size > 256) onlineShotReservations.delete(onlineShotReservations.keys().next().value);
  sound.shoot(self.weapon, { held: hand === 'secondary' ? secondaryFiring : firing, voiceId: hand === 'secondary' ? myId + ':secondary' : myId }); triggerSoundPlayed = true;
  recoil = self.weapon === 'shotgun' ? .13 : self.weapon === 'magnum' ? .18 : self.weapon === 'sniper' ? .14 : self.weapon === 'rocket' ? .12 : self.weapon === 'flamethrower' ? .008 : self.weapon === 'minigun' ? .025 : self.weapon === 'pistol' ? .045 : .06;
  shotRumble(self.weapon);
  if (model && self.weapon === 'sniper') model.userData.shotAt = visualSeconds();
  muzzleUntil = self.weapon === 'flamethrower' ? 0 : performance.now() + 50;
  muzzleLight.intensity = self.weapon === 'flamethrower' ? 0 : 7;
  return true;
}
`;

export function deriveOnlineClient(clientSource) {
  let source = canonical(clientSource);
  const replace = (anchor, replacement, label) => { source = replaceExactlyOnce(source, anchor, replacement, label); };
  replace("import { createAimDiagnostics } from './aim-diagnostics.js';", "import { createAimDiagnostics } from './aim-diagnostics.js';\nimport { OnlineTransport } from './online/transport.js';\nimport { createOnlineUI } from './online/ui.js';", 'online imports');
  replace('const canvas = $(\'game\');', "const canvas = $('game');" + helpers, 'online presentation helpers');
  replace("function send(message) {\n  if (websocket?.readyState === WebSocket.OPEN && myId) websocket.send(JSON.stringify(message));\n}", `function send(message) {
  if (websocket?.readyState !== WebSocket.OPEN || !myId) return;
  if (message.type === 'input' && !Number.isSafeInteger(message.seq)) return;
  if (message.type === 'shoot') {
    const shot = websocket.session.createShot({ yaw, pitch, ...(message.hand ? { hand: message.hand } : {}) });
    if (!shot) return;
    message = { ...shot, ...(message.hand ? { hand: message.hand } : {}), ...(message.attack ? { attack: message.attack } : {}) };
    if (!message.attack && onlineLocalShot(shot.shotId, myPlayer(), message.hand)) websocket.session.markShotPlayed(shot.shotId);
  }
  websocket.send(JSON.stringify(message));
}`, 'sequenced input and immediate fire');
  replace("function controlsAvailable() { return snapshot && snapshot.paused !== true", "function controlsAvailable() { return websocket?.readyState === WebSocket.OPEN && websocket?.session?.connected !== false && snapshot && snapshot.paused !== true", 'online availability guard');
  replace("const socket = new WebSocket(mapContext.socketUrl());", "const socket = new OnlineTransport(mapContext.socketUrl());", 'online socket');
  replace('  websocket = socket;\n  intentionalClose = false;', `  websocket = socket;
  socket.addEventListener('online-status', event => { if (socket === websocket) onlineUI.set(event.detail.state, event.detail.rtt); });
  socket.addEventListener('online-disconnected', () => {
    if (socket !== websocket) return;
    onlineShotReservations.clear();
    resetInput(); pointerLocked = false; document.exitPointerLock?.();
    showPause(onlineUI.text(socket.stale ? 'stale' : 'retry')); refreshPauseControls();
  });
  socket.addEventListener('online-restored', () => {
    if (socket !== websocket) return;
    onlineShotReservations.clear();
    resetInput(); pointerLocked = false; document.exitPointerLock?.(); cameraReady = false;
    if (inGame) showPause(onlineUI.text('restored'));
    refreshPauseControls();
  });
  intentionalClose = false;`, 'disconnect and explicit resume menu');
  replace('      const oldSelf = myPlayer(); snapshot = message;', '      const oldSelf = myPlayer(); snapshot = message; onlineReleaseReservations(message);', 'authoritative ammo reservation release');
  replace("    } else if (message.type === 'event') onEvent(message);", "    } else if (message.type === 'event') onEvent(message);\n    else if (message.type === 'shot-ack' && message.accepted === false) onlineShotReservations.delete(message.shotId);", 'shot refusal cleanup');
  replace("  $('resume-button').disabled = pauseRequestTarget !== null || (paused && !host);", "  $('resume-button').disabled = websocket?.readyState !== WebSocket.OPEN || websocket?.session?.connected === false || pauseRequestTarget !== null || (paused && !host);", 'resume unavailable while reconnecting');
  replace("  $('room-pause-button').disabled = !host || pauseRequestTarget !== null;", "  $('room-pause-button').disabled = websocket?.readyState !== WebSocket.OPEN || websocket?.session?.connected === false || !host || pauseRequestTarget !== null;", 'team pause unavailable while disconnected');
  replace("function requestRoomPause(paused = snapshot?.paused !== true) {", "function requestRoomPause(paused = snapshot?.paused !== true) {\n  if (websocket?.readyState !== WebSocket.OPEN || websocket?.session?.connected === false) return;", 'no optimistic pause while disconnected');
  replace("  const local = event.id === myId;\n  const audible =", "  const local = event.id === myId;\n  if (local && event.event === 'shot' && onlineShotReservations.has(event.shotId)) onlineShotReservations.get(event.shotId).time = event.time;\n  const audible =", 'confirmed shot reservation');
  replace("      const localAudio = controlsCaptured() && $('pause').hidden", "      const onlinePlayEcho = websocket?.session?.consumeShotEcho(event) !== false;\n      const localAudio = controlsCaptured() && $('pause').hidden", 'local echo identity');
  replace('      if (localAudio) {', '      if (localAudio && onlinePlayEcho) {', 'deduplicate shot audio');
  replace("      recoil = event.weapon === 'shotgun'", "      if (onlinePlayEcho) recoil = event.weapon === 'shotgun'", 'deduplicate shot recoil');
  replace("      shotRumble(event.weapon);\n", "      if (onlinePlayEcho) shotRumble(event.weapon);\n", 'deduplicate shot rumble');
  replace("      if (event.weapon === 'sniper') { const model = event.hand === 'secondary' ? secondaryGun : gun; if (model) model.userData.shotAt = visualSeconds(); }", "      if (onlinePlayEcho && event.weapon === 'sniper') { const model = event.hand === 'secondary' ? secondaryGun : gun; if (model) model.userData.shotAt = visualSeconds(); }", 'deduplicate sniper animation');
  replace("      muzzleUntil = event.weapon === 'flamethrower' ? 0 : performance.now() + 50; muzzleLight.intensity = event.weapon === 'flamethrower' ? 0 : 7;", "      if (onlinePlayEcho) { muzzleUntil = event.weapon === 'flamethrower' ? 0 : performance.now() + 50; muzzleLight.intensity = event.weapon === 'flamethrower' ? 0 : 7; }", 'deduplicate muzzle flash');
  replace(`  const shotModel = local && event.hand === 'secondary' ? secondaryGun : gun;
  if (local && shotModel) { camera.updateMatrixWorld(); muzzle = shotModel.localToWorld(shotModel.userData.muzzle.clone()); }
  else if (shooters.has(shooterId)) muzzle = survivorMuzzle(shooters.get(shooterId), undefined, event.hand);`, `  const shotModel = local && event.hand === 'secondary' ? secondaryGun : gun;
  if (event.weapon === 'flamethrower') {
    if (local && shotModel) { camera.updateMatrixWorld(); muzzle = shotModel.localToWorld(shotModel.userData.muzzle.clone()); }
    else if (shooters.has(shooterId)) muzzle = survivorMuzzle(shooters.get(shooterId), undefined, event.hand);
  } else if (hostile) muzzle = eye; // Raider events already contain the true barrel origin.
  else if (local) {
    const shot = onlineShotReservations.get(event.shotId);
    drawnAtClick = onlineClickCosmetics.delete(event.shotId);
    if (shot?.weapon === event.weapon) {
      muzzle = shotMuzzleFromView(eye, event.yaw, event.pitch, shot.muzzleView);
      // The confirmed eye is a round trip behind a running survivor: draw from
      // the predicted body instead, with this shot's own aim and barrel offset,
      // unless the body is too far away to be the same moment (a respawn).
      const body = camera.position;
      if (muzzle && body && eye.distanceTo(body) <= ONLINE_TRACER_SHIFT) {
        tracerEye = body.clone(); muzzle = shotMuzzleFromView(tracerEye, event.yaw, event.pitch, shot.muzzleView);
      }
      // The bullet leaves the barrel when the server confirms it (owner,
      // 13 October): drawing it "already on its way" made it appear part-way
      // along its path instead of at the muzzle.
    }
  }
  // Without a captured local barrel, use the confirmed ray. Remote models are
  // buffered at another instant and must not bend this shot's trajectory.`, 'shot-time barrel instead of current pose');
  replace("      cameraShake.add(SHOT_TRAUMA[event.weapon] ?? 0);\n", "      if (onlinePlayEcho) cameraShake.add(SHOT_TRAUMA[event.weapon] ?? 0);\n", 'deduplicate shot kick');
  replace('function leave(close = true) {\n  closeSupplyMenu(false);', 'function leave(close = true) {\n  onlineShotReservations.clear(); onlineClickCosmetics.clear();\n  closeSupplyMenu(false);', 'clear online cosmetics on leaving');
  replace("  updateConnection(true, 'COOPÉRATION · 1–4 JOUEURS');", "  updateConnection(true, () => onlineUI.text('title'));", 'online title after leaving');
  replace('  updateController(now, delta);', `  updateController(now, delta);
  const onlineSession = websocket?.session;
  const onlineStep = onlineSession?.update(frameSeconds, inputMessage());
  for (const command of onlineStep?.commands ?? []) send(command);`, 'fixed-rate frame prediction');
  replace('  const elapsed = visualSeconds();\n  const self = myPlayer();', '  const elapsed = visualSeconds();\n  const self = myPlayer();\n  const onlinePose = onlineSession?.cameraPlayer(self, delta) ?? self;', 'predicted camera pose');
  replace('    const target = new THREE.Vector3(self.x, cameraSupportHeight(self) + eyeHeight, self.z);', `    const onlineEyeHeight = self.downed || !self.alive ? .5 : onlinePose?.crouched ? PLAYER_POSTURE.crouchedEye : PLAYER_POSTURE.standingEye;
    const target = new THREE.Vector3(onlinePose.x, cameraSupportHeight(onlinePose, onlineSession?.predictedPlayer) + onlineEyeHeight, onlinePose.z);`, 'predicted camera position only');
  replace(`    const cameraHorizontalAlpha = 1 - Math.exp(-delta * 22);
    cameraBasePosition.x += (target.x - cameraBasePosition.x) * cameraHorizontalAlpha;
    cameraBasePosition.z += (target.z - cameraBasePosition.z) * cameraHorizontalAlpha;`, `    // Ease stair/stance height like LAN; keep horizontal prediction immediate.
    // Reconciliation damping alone does not smooth discrete 21.25 cm treads.
    cameraBasePosition.x = target.x; cameraBasePosition.z = target.z;`, 'vertical camera damping');
  replace('    if (controlsAvailable() && now - lastInput >= 40) { send(inputMessage()); lastInput = now; }', '    // Input is sequenced and predicted at 30 Hz above, never from render cadence.', 'remove legacy movement timer');
  replace(`  const alpha = 1 - Math.exp(-delta * 17);
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
  }`, `  const alpha = 1 - Math.exp(-delta * 17);
  const onlineView = onlineSession?.timeline.sample(now);
  const onlineZombies = new Map((onlineView?.zombies ?? []).map(actor => [actor.id, actor]));
  const onlinePlayers = new Map((onlineView?.players ?? []).map(actor => [actor.id, actor]));
  for (const [id, mesh] of zombieMeshes) {
    const actor = onlineZombies.get(id);
    if (!actor) { mesh.visible = false; continue; } // Wait for the buffered birth time.
    mesh.visible = true; mesh.position.set(actor.x, actor.y, actor.z); mesh.rotation.y = actor.yaw;
    const d = mesh.userData;
    if (d.raider) {
      // The timeline already eases yaw and selects the rendered posture. Applying
      // the LAN easing again would aim at a newer snapshot and add another delay.
      d.renderYaw = actor.yaw;
      animateRaider(mesh, { ...d.state, pitch: actor.pitch ?? 0, crouched: actor.crouched === true,
        reloading: actor.reloading === true, time: elapsed, delta });
    } else animateZombie(mesh, elapsed, true, delta);
  }`, 'remote zombie interpolation');
  replace('  for (const [id,mesh] of playerMeshes) {\n    mesh.position.lerp(mesh.userData.target, alpha); mesh.rotation.y = mesh.userData.yaw;', `  for (const [id,mesh] of playerMeshes) {
    const actor = onlinePlayers.get(id);
    if (actor) { mesh.visible = true; mesh.position.set(actor.x, actor.y, actor.z); mesh.rotation.y = actor.yaw; }
    else mesh.visible = false;`, 'remote survivor interpolation');
  const hash = createHash('sha256').update(canonical(clientSource)).digest('hex').slice(0, 16);
  return `// GENERATED by online-client-build.mjs from unchanged client.js (${hash}).\n` + source;
}

export function deriveOnlineHtml(htmlSource) {
  let source = canonical(htmlSource);
  const replace = (anchor, replacement, label) => { source = replaceExactlyOnce(source, anchor, replacement, label); };
  replace('<title>Deadwood — Last Light</title>', '<title>Deadwood — Last Light · Online</title>', 'online document title');
  replace('  <link rel="stylesheet" href="/style.css">', '  <link rel="stylesheet" href="/style.css">\n  <link rel="stylesheet" href="/online/online.css">', 'online styles');
  replace('<span id="connection-label" data-i18n="connection.idle">', '<span id="connection-label" data-online-copy="title">', 'online connection label');
  replace('<p class="muted" data-i18n="setup.subtitle">Seul ou à plusieurs, sur le même réseau.</p>', '<p class="muted" id="online-subtitle">Joue sur Internet, seul ou avec tes amis.</p>', 'online subtitle');
  replace("import('/client.js').catch(error => {", "import('/online-client.js').catch(error => {", 'online module entry');
  return '<!-- GENERATED by online-client-build.mjs; index.html remains the LAN entry. -->\n' + source;
}

export async function buildOnlineClient(directory = dirname(fileURLToPath(import.meta.url)), { check = false } = {}) {
  const publicDirectory = join(directory, 'public');
  const [client, html] = await Promise.all(['client.js', 'index.html'].map(file => readFile(join(publicDirectory, file), 'utf8')));
  const outputs = { 'online-client.js': deriveOnlineClient(client), 'online.html': deriveOnlineHtml(html) };
  for (const [file, content] of Object.entries(outputs)) {
    if (check) {
      const existing = await readFile(join(publicDirectory, file), 'utf8');
      if (canonical(existing) !== content) throw new Error(`Online client build: stale generated ${file}. Run node online-client-build.mjs.`);
    } else await writeFile(join(publicDirectory, file), content, 'utf8');
  }
  return Object.keys(outputs);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  buildOnlineClient(undefined, { check: process.argv.includes('--check') }).then(files => console.log(`Online client ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${files.join(', ')}`));
