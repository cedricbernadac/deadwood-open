import { GRENADES } from './public/rules.js';
import { LEVEL_ID } from './public/level-id.js';
import http from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomSimulation, TICK_RATE, WORLD, WEAPONS } from './simulation.mjs';
import { BALLISTICS } from './public/ballistics.js';
import { scheduleServerTicks } from './tick-clock.mjs';
import { CompanionHub } from './companions/hub.mjs';
import { CompanionDirector } from './companions/director.mjs';
import { createCompanionBody } from './companions/body.mjs';
import { describeSituation } from './companions/situation.mjs';
import { receiveSaveUpload, expireSaveUpload, parseSaveText } from './save-transfer.mjs';
import { localNetworkUrls } from './network-urls.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
// Behind lan-gateway.mjs (every decor in the home Wi-Fi menu) this server is
// one map worker: loopback only, its page tagged for DÉCOR and rooted at its map.
const GATEWAY = !isMainThread && workerData?.lanGateway === true ? workerData : null;
const MAP_ROOT = /^\/(?:maps\/[a-z][a-z0-9-]*\/)?$/;
if (GATEWAY) {
  if (typeof GATEWAY.root !== 'string' || !MAP_ROOT.test(GATEWAY.root)) throw new Error('Passerelle LAN : racine de décor invalide.');
  const maps = GATEWAY.maps;
  if (!Array.isArray(maps) || !maps.length || !maps.every(map => typeof map?.id === 'string' && /^[a-z][a-z0-9-]*$/.test(map.id) && typeof map.root === 'string' && MAP_ROOT.test(map.root))
    || !maps.some(map => map.id === LEVEL_ID) || !maps.some(map => map.id === 'cabin')) throw new Error('Passerelle LAN : liste des décors invalide.');
}
const LOG_TAG = GATEWAY ? `[${LEVEL_ID}] ` : '';
// The LAN page as a map worker serves it, read afresh like every other file.
function gatewayIndex() {
  const source = readFileSync(resolve(publicRoot, 'index.html'), 'utf8');
  if (!source.includes("from '/i18n.js'") || !source.includes("import('/client.js')") || !source.includes('</head>')) throw new Error('index.html a changé : mets à jour la transformation de la passerelle LAN.');
  const rooted = (_, before, path, after) => before + GATEWAY.root + path + after;
  return Buffer.from(source
    .replace('</head>', `<meta name="deadwood-multi-map" content="true">\n<meta name="deadwood-maps" content="${GATEWAY.maps.map(map => map.id).join(',')}">\n</head>`)
    .replace(/(from\s+['"]|import\(['"])\/(?!vendor\/)([^'"]+\.js)(['"])/g, rooted)
    .replace(/(<script\b[^>]*\bsrc=['"])\/(?!vendor\/)([^'"]+\.js)(['"])/g, rooted));
}
if (GATEWAY) gatewayIndex();
// One build id over every served file and the authoritative code, taken when
// the server starts. A page loaded before an update is told to reload rather
// than draw a world that no longer matches the server.
function buildId() {
  const hash = createHash('sha256');
  hash.update(`level:${LEVEL_ID}\n`);
  const add = path => { hash.update(relative(root, path).split(sep).join('/')); hash.update(readFileSync(path)); };
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path); else if (entry.isFile()) add(path);
    }
  };
  visit(publicRoot);
  for (const file of ['server.mjs', 'simulation.mjs', 'supply.mjs', 'raiders.mjs', 'tick-clock.mjs', 'save-game.mjs', 'save-codec.mjs', 'save-transfer.mjs', 'network-urls.mjs']) add(resolve(root, file));
  visit(resolve(root, 'companions'));
  return hash.digest('hex').slice(0, 12);
}
const BUILD = buildId();
const require = createRequire(import.meta.url);
const threeModule = resolve(dirname(require.resolve('three')), 'three.module.js');
const threeCore = resolve(dirname(require.resolve('three')), 'three.core.js');
// Reflector.js: the funfair mirror maze's live reflections (public/funfair-mirrors.js),
// fetched only by a medium or high quality funfair page near the maze.
const threeAddons = new Map([
  ['/vendor/GLTFLoader.js', 'loaders/GLTFLoader.js'],
  ['/vendor/BufferGeometryUtils.js', 'utils/BufferGeometryUtils.js'],
  ['/vendor/Reflector.js', 'objects/Reflector.js'],
].map(([url, file]) => [url, Buffer.from(readFileSync(resolve(dirname(require.resolve('three')), '../examples/jsm', file), 'utf8')
  .replace(/from (['"])three\1/g, "from '/vendor/three.module.js'")
  .replace("from '../utils/BufferGeometryUtils.js'", "from '/vendor/BufferGeometryUtils.js'"))]));
const rooms = new Map();
const peers = new Map();
// AI companions (companions/DESIGN.md): a brain on this PC connects to
// /companions; without one, nothing of it shows or runs.
const hub = new CompanionHub({ mapId: LEVEL_ID, ...(GATEWAY ? { maps: GATEWAY.maps.map(({ id, root }) => ({ id, root })), requireCapability: 'map-guide-v1' } : {}) });
// A map worker never reads PORT: that is the gateway's own port.
const port = GATEWAY ? 0 : Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT doit être un port TCP valide.');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
};

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 1024 * 1024) { socket.close(1008, 'Connexion trop lente.'); return; }
  socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const encoded = JSON.stringify(message);
  for (const peer of room.peers.values()) {
    if (peer.socket.readyState !== WebSocket.OPEN) continue;
    if (peer.socket.bufferedAmount > 1024 * 1024) { peer.socket.close(1008, 'Connexion trop lente.'); continue; }
    peer.socket.send(encoded);
  }
}

// Impact numbers: each survivor who asked for them, and nobody else,
// receives their own (never the whole room's).
function syncImpactNumbers(room) {
  room.simulation.setImpactObservers([...room.peers.values()].filter(peer =>
    peer.impactNumbers === true && peer.socket.readyState === WebSocket.OPEN).map(peer => peer.id));
}

function sendImpactNumbers(room) {
  for (const [id, impacts] of room.simulation.takeImpactNumbers()) {
    const peer = room.peers.get(id);
    if (peer) send(peer.socket, { type: 'impacts', impacts });
  }
}

// A room code names its map, so the home menu can join any code: S, H or F
// and five base-36 characters for the supermarket, the hospital and the
// funfair, six hex digits for the cabin. F is a hex digit itself: a funfair
// code whose five came out hex only (about 1.7 %) is drawn again, so it never
// reads as a cabin code (public/map-context.js, mapForRoomCode).
const CODE_PREFIX = LEVEL_ID === 'supermarket' ? 'S' : LEVEL_ID === 'hospital' ? 'H' : LEVEL_ID === 'funfair' ? 'F' : null;
function roomCode() {
  if (!CODE_PREFIX) return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  let code;
  do { code = CODE_PREFIX + randomInt(36 ** 5).toString(36).padStart(5, '0').toUpperCase(); } while (/^[A-F0-9]{6}$/.test(code));
  return code;
}

// The creator's ambiance is the room's for good (RoomSimulation validates it).
function makeRoom(practice = false, ambiance = 'family') {
  let code;
  do { code = roomCode(); } while (rooms.has(code));
  const room = { code, peers: new Map(), lastActivity: Date.now() };
  room.simulation = new RoomSimulation(code, { practice: practice === true, ambiance, onEvent: message => { broadcast(room, message); room.companions?.onEvent(message); } });
  room.simulation.companionsAvailable = hub.connected;
  room.companions = practice === true ? null : new CompanionDirector(room.simulation, hub, { createBody: createCompanionBody, describe: describeSituation });
  rooms.set(code, room);
  return room;
}

function leave(peer) {
  peer.saveUpload = null;
  const room = peer.room;
  if (!room) return;
  room.peers.delete(peer.id);
  syncImpactNumbers(room);
  room.simulation.removePlayer(peer.id);
  if (!room.peers.size) { room.companions?.dispose(); rooms.delete(room.code); }
  else broadcast(room, room.simulation.snapshot());
  peer.room = null;
}

// A save file arrives in chunks (save-transfer.mjs): only the host of a new
// room's lobby may load one. The room is rebuilt PAUSED, then shown to all.
function loadSave(peer, message) {
  const room = peer.room, simulation = room.simulation;
  const refusal = simulation.practice ? 'practice' : simulation.hostId !== peer.id ? 'host' : simulation.phase !== 'lobby' ? 'phase' : null;
  const step = receiveSaveUpload(peer, message, { refusal });
  if (step.reply) { send(peer.socket, step.reply); return; }
  if (step.text === undefined) return;
  const parsed = parseSaveText(step.text);
  // Companions need the brain on this PC; without it they stay behind.
  const result = parsed.reason ? { ok: false, reason: parsed.reason }
    : simulation.importSave(parsed.save, peer.id, { beforeApply: () => room.companions?.dropAll(), adopt: companions => room.companions?.restore(companions) });
  if (!result.ok) { send(peer.socket, { type: 'load-result', ok: false, reason: result.reason }); return; }
  const companions = result.adopted === 'restored' ? null : result.adopted;
  simulation.announceRestore({ companions });
  syncImpactNumbers(room);
  broadcast(room, simulation.snapshot());
  send(peer.socket, { type: 'load-result', ok: true, wave: result.wave, phase: result.phase, ...(companions ? { companions } : {}) });
}

function serveFile(response, path, method) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Fichier introuvable.');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
    'Content-Length': statSync(path).size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(path);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(GATEWAY ? { ok: true, mapId: LEVEL_ID, build: BUILD, rooms: rooms.size, players: peers.size, companions: hub.connected }
      : { ok: true, ...(['supermarket', 'hospital', 'funfair'].includes(LEVEL_ID) ? { mapId: LEVEL_ID, build: BUILD } : {}), rooms: rooms.size, players: peers.size }));
    return;
  }
  if (GATEWAY && (pathname === '/' || pathname === '/index.html')) {
    let bytes;
    try { bytes = gatewayIndex(); }
    catch (error) {
      console.error(`  ${LOG_TAG}Page du décor :`, error?.message ?? error);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Page du décor indisponible.'); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes); return;
  }
  if (pathname === '/world.json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ mapId: LEVEL_ID, world: WORLD, weapons: WEAPONS, grenades: GRENADES, ballistics: BALLISTICS, tickRate: TICK_RATE }));
    return;
  }
  if (pathname === '/version.json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ build: BUILD, mapId: LEVEL_ID }));
    return;
  }
  if (pathname === '/network.json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ urls: localNetworkUrls(server.address()?.port ?? port) }));
    return;
  }
  if (pathname === '/level-id.js') {
    const bytes = Buffer.from(`export const LEVEL_ID = ${JSON.stringify(LEVEL_ID)};\n`);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes); return;
  }
  if (threeAddons.has(pathname)) {
    const bytes = threeAddons.get(pathname);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes); return;
  }
  if (pathname === '/vendor/three.module.js') { serveFile(response, threeModule, request.method); return; }
  if (pathname === '/vendor/three.core.js') { serveFile(response, threeCore, request.method); return; }
  const path = resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(publicRoot + sep) || pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(403); response.end(); return; }
  serveFile(response, path, request.method);
});

let lastSimulationTickAt = performance.now();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
const brainServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
// Players on /ws. A companion brain on /companions only from this PC and never
// from a web page (browsers always send an Origin).
server.on('upgrade', (request, socket, head) => {
  let pathname = '';
  try { pathname = new URL(request.url, 'http://localhost').pathname; } catch {}
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
  if (pathname === '/ws') websocketServer.handleUpgrade(request, socket, head, ws => websocketServer.emit('connection', ws, request));
  else if (pathname === '/companions' && local && !request.headers.origin) brainServer.handleUpgrade(request, socket, head, ws => hub.attach(ws));
  else socket.destroy();
});
hub.onChange(connected => {
  for (const room of rooms.values()) {
    room.simulation.companionsAvailable = connected;
    if (!connected) room.companions?.removeAll('offline');
    broadcast(room, room.simulation.snapshot());
  }
  console.log(connected ? `  ${LOG_TAG}Compagnons IA : cerveau connecté (${hub.brain?.name}).` : `  ${LOG_TAG}Compagnons IA : cerveau déconnecté.`);
});
websocketServer.on('connection', socket => {
  const peer = { id: randomBytes(8).toString('hex'), socket, room: null, impactNumbers: false, saveUpload: null,
    alive: true, messages: 0, window: Date.now(), joinedAt: Date.now() };
  peers.set(peer.id, peer);
  socket.on('pong', () => { peer.alive = true; });
  socket.on('message', raw => {
    const now = Date.now();
    if (now - peer.window >= 1000) { peer.window = now; peer.messages = 0; }
    if (++peer.messages > 140) { socket.close(1008, 'Trop de messages.'); return; }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { send(socket, { type: 'error', message: 'Message JSON invalide.' }); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return;
    if (message.type === 'join') {
      if (peer.room) { send(socket, { type: 'error', message: 'Tu es déjà dans une salle.' }); return; }
      // Refused before any room is made or joined: teammates never see a
      // survivor who arrives and leaves at once.
      if (typeof message.build === 'string' && message.build !== BUILD) { send(socket, { type: 'outdated', build: BUILD }); return; }
      let room;
      if (typeof message.room === 'string' && message.room.trim()) {
        const code = message.room.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code) || !rooms.has(code)) { send(socket, { type: 'error', message: 'Salle introuvable. Vérifie le code et le serveur.' }); return; }
        room = rooms.get(code);
      } else room = makeRoom(message.practice === true, message.ambiance); // a joiner's ambiance is ignored
      // A companion gives its seat to a fourth human.
      if (room.peers.size >= 4 || (room.simulation.players.size >= 4 && !room.companions?.makeRoomForHuman())) { send(socket, { type: 'error', message: 'Cette salle contient déjà 4 survivants.' }); return; }
      const name = typeof message.name === 'string' ? message.name : 'Survivant';
      // An optional character sheet; the simulation validates it (practice ignores it).
      room.simulation.addPlayer(peer.id, name, message.weapon, { defer: true, sheet: message.sheet });
      // A restored night: a joiner named like a free seat takes it back.
      room.simulation.bindJoiningPlayer(peer.id);
      peer.room = room;
      room.peers.set(peer.id, peer);
      syncImpactNumbers(room);
      room.lastActivity = now;
      send(socket, { type: 'welcome', id: peer.id, room: room.code, hostId: room.simulation.hostId, practice: room.simulation.practice, ambiance: room.simulation.ambiance, build: BUILD });
      broadcast(room, room.simulation.snapshot());
      return;
    }
    if (!peer.room) return;
    const simulation = peer.room.simulation;
    // A personal display setting: answered to this survivor alone.
    if (message.type === 'impact-numbers') {
      if (typeof message.enabled !== 'boolean') return;
      peer.impactNumbers = message.enabled;
      syncImpactNumbers(peer.room);
      send(socket, { type: 'impact-numbers', enabled: message.enabled });
      return;
    }
    if (!simulation.players.get(peer.id)?.waiting) peer.room.lastActivity = now;
    // A paused room still accepts membership, heartbeat and host controls,
    // but even forged gameplay packets must leave its frozen state alone.
    if (simulation.paused && !['pause', 'start', 'restart', 'ping', 'leave', 'ready', 'save-game', 'claim-seat', 'load-begin', 'load-chunk'].includes(message.type)) return;
    switch (message.type) {
      case 'ready': simulation.readyPlayer(peer.id); broadcast(peer.room, simulation.snapshot()); break;
      case 'pause': if (simulation.setPause(peer.id, message.paused)) broadcast(peer.room, simulation.snapshot()); break;
      case 'practice': simulation.practiceAction(peer.id, message); break;
      case 'input': simulation.setInput(peer.id, message); break;
      case 'umbrella': simulation.setUmbrella(peer.id, message.open); break;
      case 'next-wave': simulation.voteNextWave(peer.id, message.ready); break;
      case 'revive-kit': simulation.useReviveKit(peer.id); break;
      case 'drop-coins': simulation.dropCoins(peer.id); break;
      case 'difficulty': if (simulation.setDifficulty(peer.id, message.level)) broadcast(peer.room, simulation.snapshot()); break;
      case 'friendly-fire': if (simulation.setFriendlyFire(peer.id, message.level)) broadcast(peer.room, simulation.snapshot()); break;
      case 'sheet': if (simulation.setSheet(peer.id, message.sheet)) broadcast(peer.room, simulation.snapshot()); break;
      case 'companions': if (peer.room.companions?.setCount(message.count, peer.id, message.profiles)) broadcast(peer.room, simulation.snapshot()); break;
      case 'shoot': simulation.shoot(peer.id, (performance.now() - lastSimulationTickAt) / 1000, message.attack, message.hand); sendImpactNumbers(peer.room); break;
      case 'melee-cancel': simulation.cancelMelee(peer.id); break;
      case 'minigun-spin':
        if (message.hand === undefined || ['primary', 'secondary'].includes(message.hand)) simulation.setMinigunSpin(peer.id, message.spinning, message.hand);
        break;
      case 'reload': simulation.reload(peer.id, message.hand); break;
      case 'dual-wield': simulation.setDualWield(peer.id, message.enabled, message.secondaryWeaponId); break;
      case 'drop-weapon': simulation.dropWeapon(peer.id); break;
      case 'grenade': simulation.throwGrenade(peer.id); break;
      case 'interact': simulation.interact(peer.id, { revive: message.revive === true }); break;
      case 'buy': simulation.buyWeapon(peer.id, message.crateId); break;
      case 'supply-claim': simulation.claimSupply(peer.id, message.bonus, message.crateId); break;
      case 'supply-buy': simulation.buySupply(peer.id, message.service); break;
      case 'weapon':
        if (!simulation.chooseWeapon(peer.id, message.weaponId ?? message.weapon)) send(socket, { type: 'error', message: 'Cette arme est indisponible. Achète-la à son râtelier avec tes pièces.' });
        break;
      case 'start': case 'restart': simulation.start(peer.id); syncImpactNumbers(peer.room); break;
      case 'ping': send(socket, { type: 'pong', time: now }); break;
      case 'save-game': {
        let reply;
        try { reply = { type: 'save-game', save: simulation.exportSave({ build: BUILD, requesterId: peer.id }) }; }
        catch (error) { reply = { type: 'save-denied', reason: typeof error?.code === 'string' ? error.code : 'error' }; }
        send(socket, reply);
        break;
      }
      case 'claim-seat': if (simulation.claimSeat(peer.id, message.seat)) broadcast(peer.room, simulation.snapshot()); break;
      case 'load-begin': case 'load-chunk': loadSave(peer, message); break;
      case 'leave': leave(peer); break;
    }
  });
  socket.on('close', () => { leave(peer); peers.delete(peer.id); });
  socket.on('error', () => { leave(peer); peers.delete(peer.id); });
});

let ticks = 0;
const simulationTimer = scheduleServerTicks(() => {
  lastSimulationTickAt = performance.now();
  for (const room of rooms.values()) {
    try { room.companions?.step(1 / TICK_RATE); }
    catch (error) { console.error(`  ${LOG_TAG}Compagnons IA :`, error?.message ?? error); }
    room.simulation.tick(1 / TICK_RATE);
    sendImpactNumbers(room);
    if (ticks % 2 === 0) broadcast(room, room.simulation.snapshot());
  }
  ticks++;
}, { rate: TICK_RATE });

const heartbeatTimer = setInterval(() => {
  for (const peer of peers.values()) {
    expireSaveUpload(peer);
    if (!peer.alive || (!peer.room && Date.now() - peer.joinedAt > 60000)) { peer.socket.terminate(); continue; }
    peer.alive = false;
    peer.socket.ping();
  }
  // A forgotten lobby expires after two hours without player actions.
  for (const room of rooms.values()) {
    if (room.simulation.phase === 'lobby' && Date.now() - room.lastActivity > 2 * 60 * 60 * 1000) {
      for (const peer of room.peers.values()) peer.socket.close(1000, 'Salle inactive.');
    }
  }
}, 30000);

// A map worker tells the gateway its loopback port and stops when told to.
if (GATEWAY) server.listen(0, '127.0.0.1', () => {
  parentPort.postMessage({ type: 'ready', port: server.address().port, build: BUILD, mapId: LEVEL_ID });
  parentPort.on('message', message => { if (message?.type === 'close') shutdown(); });
});
else server.listen(port, '0.0.0.0', () => {
  const actualPort = server.address().port;
  console.log(`\n  ${LEVEL_ID === 'funfair' ? 'LA FÊTE FORAINE — NIVEAU 4' : LEVEL_ID === 'hospital' ? "L'HÔPITAL DES PINS — NIVEAU 3" : LEVEL_ID === 'supermarket' ? 'LE DERNIER PANIER — NIVEAU 2' : 'CABIN CO-OP'}\n  Sur cet ordinateur : http://localhost:${actualPort}`);
  for (const url of localNetworkUrls(actualPort)) console.log(`  Réseau local       : ${url}`);
  console.log('  Même Wi-Fi / réseau : ouvre cette adresse et partage le code de salle.');
  console.log(`  Compagnons IA (facultatif, sur cet ordinateur) : ${LEVEL_ID === 'funfair' ? 'companions-funfair.cmd' : LEVEL_ID === 'hospital' ? 'companions-hospital.cmd' : LEVEL_ID === 'supermarket' ? 'companions-supermarket.cmd' : 'npm run companions'}\n`);
});

function shutdown() {
  simulationTimer.stop();
  clearInterval(heartbeatTimer);
  for (const peer of peers.values()) peer.socket.close(1001, 'Serveur arrêté.');
  websocketServer.close();
  hub.close();
  brainServer.close();
  server.close(() => process.exit(0));
  const timeout = setTimeout(() => process.exit(0), 2000);
  timeout.unref();
}
// A map worker's process.exit ends only its thread; the gateway owns signals.
if (!GATEWAY) {
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
