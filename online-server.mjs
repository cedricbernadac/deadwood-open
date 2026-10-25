import { GRENADES } from './public/rules.js';
import { LEVEL_ID } from './public/level-id.js';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TICK_RATE, WORLD, WEAPONS } from './simulation.mjs';
import { OnlineRoomSimulation } from './online-simulation.mjs';
import { onlineConfig, publicOnlineConfig } from './online-config.mjs';
import { BALLISTICS } from './public/ballistics.js';
import { scheduleServerTicks } from './tick-clock.mjs';
import { receiveSaveUpload, expireSaveUpload, parseSaveText } from './save-transfer.mjs';
// Preserve the existing scheduler API for validation tools.
export { scheduleServerTicks as scheduleOnlineTicks } from './tick-clock.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
const require = createRequire(import.meta.url);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
};

// Freeze served bytes together with the build identifier. Editing a checkout
// cannot make an already-running server mix old simulation with new assets.
function frozenAssets({basePath='/',multiMap=null}={}) {
  const assets = new Map(), hash = createHash('sha256');
  hash.update(`level:${LEVEL_ID}\n`);
  if(multiMap)hash.update(`gateway:${basePath}\n`);
  const add = (path, url = null) => {
    let bytes = readFileSync(path);
    if(url==='/online.html'&&multiMap){
      let source=bytes.toString('utf8');
      if(!source.includes("from '/i18n.js'")||!source.includes("import('/online-client.js')"))throw Error('Online HTML bootstrap changed; update the map gateway transform');
      source=source.replace('</head>','<meta name="deadwood-multi-map" content="true">\n</head>')
        .replace(/(from\s+['"]|import\(['"])\/(?!vendor\/)([^'"]+\.js)(['"])/g,(_,before,path,after)=>before+basePath+path+after)
        .replace(/(<script\b[^>]*\bsrc=['"])\/(?!vendor\/)([^'"]+\.js)(['"])/g,(_,before,path,after)=>before+basePath+path+after);
      bytes=Buffer.from(source);
    }
    hash.update(relative(root, path).split(sep).join('/')); hash.update(bytes);
    if (url) assets.set(url, { bytes, contentType: mime[extname(path)] ?? 'application/octet-stream' });
  };
  // Hospital and funfair are not online maps yet: their GLBs and previews stay
  // out of the memory and the build id of every other map's server.
  const offline = url => LEVEL_ID !== 'hospital' && url.startsWith('/levels/hospital')
    || LEVEL_ID !== 'funfair' && url.startsWith('/levels/funfair');
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = resolve(directory, entry.name), url = '/' + relative(publicRoot, path).split(sep).join('/');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !offline(url)) add(path, url);
    }
  };
  visit(publicRoot);
  for (const file of ['server.mjs', 'simulation.mjs', 'supply.mjs', 'raiders.mjs', 'tick-clock.mjs', 'save-game.mjs', 'save-codec.mjs', 'save-transfer.mjs', 'online-server.mjs', 'online-simulation.mjs', 'online-config.mjs', 'online-gateway.mjs', 'online-worker.mjs', 'shared-capacity.mjs']) add(resolve(root, file));
  for (const file of ['three.module.js', 'three.core.js']) add(resolve(dirname(require.resolve('three')), file), '/vendor/' + file);
  for (const [url, file] of [['/vendor/GLTFLoader.js', 'loaders/GLTFLoader.js'], ['/vendor/BufferGeometryUtils.js', 'utils/BufferGeometryUtils.js']]) {
    const path = resolve(dirname(require.resolve('three')), '../examples/jsm', file);
    add(path);
    const bytes = Buffer.from(readFileSync(path, 'utf8').replace(/from (['"])three\1/g, "from '/vendor/three.module.js'")
      .replace("from '../utils/BufferGeometryUtils.js'", "from '/vendor/BufferGeometryUtils.js'"));
    assets.set(url, { bytes, contentType: 'text/javascript; charset=utf-8' });
  }
  return { assets, build: hash.digest('hex').slice(0, 12) };
}

function sameOrigin(request, config) {
  const origin = request.headers.origin;
  if (origin === undefined) return true; // Native WebSocket tests / non-browser clients.
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    return url.host === request.headers.host || config.allowedOrigins.includes(url.origin);
  } catch { return false; }
}

export function createOnlineServer({ config = onlineConfig(), port = Number(process.env.PORT ?? '3000'), host = '0.0.0.0', clock = () => performance.now(), autoTick = true, capacity = null, proxyKey = null, basePath = '/', multiMap = null } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const { assets, build } = frozenAssets({basePath,multiMap});
  const rooms = new Map(), connections = new Map(), sessions = new Map(), createWindows = new Map();
  let draining = false, ticks = 0, lastTickAt = clock(), tickMs = 0, peakTickMs = 0;
  const publicConfig = { ...publicOnlineConfig(config), ...(multiMap??{}) };
  const trustedRequest = request => {
    if(proxyKey===null)return true;
    const ip=request.socket.remoteAddress,key=request.headers['x-deadwood-worker-key'];
    return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)&&typeof key==='string'&&Buffer.byteLength(key)===Buffer.byteLength(proxyKey)&&timingSafeEqual(Buffer.from(key),Buffer.from(proxyKey));
  };
  const peerAddress = request => proxyKey!==null ? request.headers['x-deadwood-peer-ip'] : request.socket.remoteAddress ?? 'unknown';
  const send = (socket, message) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1024 * 1024) { socket.close(1008, 'Connection too slow.'); return; }
    socket.send(JSON.stringify(message));
  };
  const broadcast = (room, message) => {
    const bytes = JSON.stringify(message);
    for (const peer of room.peers.values()) {
      const socket = peer.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 1024 * 1024) { socket.close(1008, 'Connection too slow.'); continue; }
      socket.send(bytes);
    }
  };
  const roomState = room => broadcast(room, room.simulation.snapshot(clock()));
  // Impact numbers: each survivor who asked for them, and nobody else,
  // receives their own (never the whole room's).
  const syncImpactNumbers = room => room.simulation.setImpactObservers([...room.peers.values()].filter(peer =>
    peer.impactNumbers === true && peer.socket?.readyState === WebSocket.OPEN).map(peer => peer.id));
  const sendImpactNumbers = room => {
    for (const [id, impacts] of room.simulation.takeImpactNumbers()) send(room.peers.get(id)?.socket, { type: 'impacts', impacts });
  };
  const fail = (peer, code, message) => send(peer.socket, { type: 'error', code, message });
  const token = () => randomBytes(32).toString('base64url');
  const playerCount = () => [...rooms.values()].reduce((count, room) => count + room.peers.size, 0);

  const server = http.createServer((request, response) => {
    if(!trustedRequest(request)){response.writeHead(403);response.end();return;}
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    const json = value => {
      const bytes = Buffer.from(JSON.stringify(value));
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    };
    if (pathname === '/health') {
      json({ ok: !draining, mapId: LEVEL_ID, mode: 'online', protocol: config.protocol, build, rooms: rooms.size, players: playerCount(),
        connectedPlayers: [...sessions.values()].filter(peer => peer.socket?.readyState === WebSocket.OPEN).length,
        connections: connections.size, capacity: { rooms: config.maxRooms, players: config.maxPlayers },
        simulation: { tickRate: TICK_RATE, lastTickMs: Number(tickMs.toFixed(3)), peakTickMs: Number(peakTickMs.toFixed(3)) } }); return;
    }
    if (pathname === '/connection.json') { json(publicConfig); return; }
    if (pathname === '/world.json') { json({ mapId: LEVEL_ID, world: WORLD, weapons: WEAPONS, grenades: GRENADES, ballistics: BALLISTICS, tickRate: TICK_RATE }); return; }
    if (pathname === '/version.json') { json({ build, mapId: LEVEL_ID, mode: 'online', protocol: config.protocol }); return; }
    if (pathname === '/network.json') { json({ mode: 'online', urls: [] }); return; }
    if (pathname === '/level-id.js') {
      const bytes = Buffer.from(`export const LEVEL_ID = ${JSON.stringify(LEVEL_ID)};\n`);
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes); return;
    }
    if (pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(403); response.end(); return; }
    const asset = assets.get(pathname === '/' || pathname === '/index.html' ? '/online.html' : pathname);
    if (!asset) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found.'); return; }
    response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.bytes.length,
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    response.end(request.method === 'HEAD' ? undefined : asset.bytes);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096,
    perMessageDeflate: config.compression ? {
      threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true,
      concurrencyLimit: 4, zlibDeflateOptions: { level: 3 },
    } : false });
  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { pathname = ''; }
    const address = peerAddress(request);
    const addressCount = [...connections.values()].filter(connection => connection.address === address).length;
    const denied = !trustedRequest(request) ? [403, 'Gateway required'] : draining ? [503, 'Server restarting'] : pathname !== '/ws' ? [404, 'Not found']
      : !sameOrigin(request, config) ? [403, 'Origin denied']
      : connections.size >= config.maxConnections || addressCount >= config.maxConnectionsPerAddress ? [429, 'Server busy'] : null;
    if (denied) { socket.end(`HTTP/1.1 ${denied[0]} ${denied[1]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    wss.handleUpgrade(request, socket, head, websocket => wss.emit('connection', websocket, request));
  });

  // The creator's ambiance is the room's for good (RoomSimulation validates it).
  function makeRoom(practice, ambiance) {
    let code;
    do { code = LEVEL_ID==='supermarket' ? 'S'+randomInt(36**5).toString(36).padStart(5,'0').toUpperCase() : randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
    if(capacity&&!capacity.reserve('rooms'))return null;
    const room = { code, peers: new Map(), lastActivity: clock() };
    room.simulation = new OnlineRoomSimulation(code, { practice, ambiance, clock, maxInputDt: config.maxInputDt,
      maxInputQueue: config.maxInputQueue, maxRewindMs: config.maxRewindMs, interpolationMs: config.interpolationMs,
      onEvent: event => broadcast(room, event) });
    rooms.set(code, room); return room;
  }

  function deleteRoom(room){if(rooms.delete(room.code))capacity?.release('rooms');}
  function leave(peer) {
    peer.saveUpload = null;
    if (peer.token) sessions.delete(peer.token);
    peer.token = null; peer.resumeUntil = null;
    const room = peer.room;
    if (!room) return;
    if(room.peers.delete(peer.id))capacity?.release('players'); syncImpactNumbers(room); room.simulation.removePlayer(peer.id); peer.room = null;
    if (!room.peers.size) deleteRoom(room); else roomState(room);
  }

  function disconnect(connection, socket) {
    connections.delete(socket);
    const peer = connection.peer;
    if (peer.socket !== socket) return;
    peer.socket = null; peer.saveUpload = null;
    if (!peer.room) return;
    if (draining) { leave(peer); return; }
    peer.resumeUntil = clock() + config.resumeGraceMs;
    syncImpactNumbers(peer.room);
    peer.room.simulation.setConnected(peer.id, false);
    roomState(peer.room);
  }

  // A save file in chunks (save-transfer.mjs), host of a new lobby only. The
  // online room has no companions: saved ones are left behind with a note.
  function loadSave(peer, message) {
    const room = peer.room, simulation = room.simulation;
    const refusal = simulation.practice ? 'practice' : simulation.hostId !== peer.id ? 'host' : simulation.phase !== 'lobby' ? 'phase' : null;
    const step = receiveSaveUpload(peer, message, { refusal, now: clock() });
    if (step.reply) { send(peer.socket, step.reply); return; }
    if (step.text === undefined) return;
    room.lastActivity = clock();
    const parsed = parseSaveText(step.text);
    const result = parsed.reason ? { ok: false, reason: parsed.reason } : simulation.importSave(parsed.save, peer.id);
    if (!result.ok) { send(peer.socket, { type: 'load-result', ok: false, reason: result.reason }); return; }
    const companions = result.adopted;
    simulation.announceRestore({ companions });
    syncImpactNumbers(room);
    roomState(room);
    send(peer.socket, { type: 'load-result', ok: true, wave: result.wave, phase: result.phase, ...(companions ? { companions } : {}) });
  }

  function welcome(peer, resumed = false) {
    send(peer.socket, { type: 'welcome', id: peer.id, room: peer.room.code, hostId: peer.room.simulation.hostId,
      mapId: LEVEL_ID, practice: peer.room.simulation.practice, ambiance: peer.room.simulation.ambiance, build, resumed, resumeToken: peer.token,
      network: { ...publicConfig, epoch: peer.room.simulation.epoch, serverTime: clock() } });
    roomState(peer.room);
  }

  function probe(peer) {
    if (!peer.socket || peer.socket.readyState !== WebSocket.OPEN) return;
    if (peer.probe) {
      if (clock() - peer.probe.at > 15000) peer.socket.terminate();
      return; // Do not replace a missing pong and postpone its timeout forever.
    }
    const nonce = randomBytes(8).toString('hex');
    peer.probe = { nonce, at: clock() };
    peer.socket.ping(nonce);
  }

  wss.on('connection', (socket, request) => {
    const now = clock(), address = peerAddress(request);
    const addressSlot=proxyKey!==null?Number(request.headers['x-deadwood-peer-slot']):null;
    const connection = { address, messages: 0, window: now,
      peer: { id: randomBytes(8).toString('hex'), socket, room: null, token: null, resumeUntil: null, saveUpload: null,
        impactNumbers: false, joinedAt: now, rttMs: 0, probe: null } };
    connections.set(socket, connection);
    probe(connection.peer);
    socket.on('pong', data => {
      const peer = connection.peer;
      if (peer.probe && data.toString() === peer.probe.nonce) {
        const measured = Math.max(0, clock() - peer.probe.at);
        peer.rttMs = peer.rttMs > 0 ? Math.min(peer.rttMs * .75 + measured * .25, measured + 100) : measured;
        peer.probe = null;
      }
    });
    socket.on('message', raw => {
      const peer = connection.peer, now = clock();
      if (draining) return;
      if (now - connection.window >= 1000) { connection.window = now; connection.messages = 0; }
      if (++connection.messages > config.maxMessagesPerSecond) { socket.close(1008, 'Too many messages.'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { fail(peer, 'invalid-json', 'Invalid JSON message.'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') return;
      if (message.type === 'ping') {
        send(socket, { type: 'pong', nonce: typeof message.nonce === 'string' || Number.isSafeInteger(message.nonce) ? message.nonce : undefined,
          clientTime: Number.isFinite(message.clientTime) ? message.clientTime : undefined, serverTime: now }); return;
      }
      if (message.type === 'network-pong') return; // Native WebSocket pong measures RTT without trusting client clocks.
      if (message.type === 'join' || message.type === 'resume') {
        if (peer.room) { fail(peer, 'already-joined', 'You are already in a room.'); return; }
        if (message.protocol !== config.protocol) { fail(peer, 'protocol', 'This server requires the online client.'); return; }
        if (message.build !== build) { send(socket, { type: 'outdated', build }); return; }
        const resumeToken = message.token ?? message.resumeToken;
        if (message.type === 'resume' || resumeToken !== undefined) {
          const previous = typeof resumeToken === 'string' && resumeToken.length <= 128 ? sessions.get(resumeToken) : null;
          if (!previous || !previous.room || previous.socket || !(previous.resumeUntil > now)) {
            fail(peer, 'resume-expired', 'This connection can no longer be resumed.'); return;
          }
          sessions.delete(previous.token); previous.token = token(); sessions.set(previous.token, previous);
          previous.socket = socket; previous.resumeUntil = null; previous.joinedAt = now; previous.probe = null;
          connection.peer = previous; previous.room.simulation.setConnected(previous.id, true);
          syncImpactNumbers(previous.room);
          if (!previous.room.simulation.players.get(previous.id)?.waiting) previous.room.lastActivity = now;
          probe(previous); welcome(previous, true); return;
        }
        if (playerCount() >= config.maxPlayers || capacity && capacity.count('players')>=config.maxPlayers) { fail(peer, 'player-capacity', 'All player slots are occupied.'); return; }
        let room, created=false;
        if (typeof message.room === 'string' && message.room.trim()) {
          const code = message.room.trim().toUpperCase();
          if (!/^[A-Z0-9]{6}$/.test(code) || !rooms.has(code)) { fail(peer, 'room-not-found', 'Room not found.'); return; }
          room = rooms.get(code);
        } else {
          if (rooms.size >= config.maxRooms || capacity && capacity.count('rooms')>=config.maxRooms) { fail(peer, 'room-capacity', 'All rooms are occupied.'); return; }
          if(capacity&&proxyKey!==null){
            if(!capacity.tryCreate(addressSlot,config.createsPerMinute)){fail(peer,'create-rate','Please wait before creating another room.');return;}
          }else{
          let window = createWindows.get(address);
          if (!window || now - window.at >= 60000) { window = { at: now, count: 0 }; createWindows.set(address, window); }
          if (window.count >= config.createsPerMinute) { fail(peer, 'create-rate', 'Please wait before creating another room.'); return; }
          window.count++;
          }
          room = makeRoom(message.practice === true, message.ambiance); // a joiner's ambiance is ignored
          if(!room){fail(peer,'room-capacity','All rooms are occupied.');return;}
          created=true;
        }
        if (room.peers.size >= 4) { fail(peer, 'room-full', 'This room already has four survivors.'); return; }
        if(capacity&&!capacity.reserve('players')){if(created)deleteRoom(room);fail(peer,'player-capacity','All player slots are occupied.');return;}
        // An optional character sheet; the simulation validates it (practice ignores it).
        room.simulation.addPlayer(peer.id, typeof message.name === 'string' ? message.name : 'Survivor', undefined, { defer: true, sheet: message.sheet });
        // A restored night: a joiner named like a free seat takes it back.
        room.simulation.bindJoiningPlayer(peer.id);
        peer.room = room; peer.token = token(); sessions.set(peer.token, peer);
        room.peers.set(peer.id, peer);
        syncImpactNumbers(room);
        if (!room.simulation.players.get(peer.id)?.waiting) room.lastActivity = now;
        welcome(peer); return;
      }
      if (message.type === 'leave') { leave(peer); send(socket, { type: 'left' }); return; }
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
      if (simulation.paused && !['pause', 'start', 'restart', 'ready', 'save-game', 'claim-seat', 'load-begin', 'load-chunk'].includes(message.type)) return;
      // Heartbeats, rejected commands and a tab's repeated neutral inputs are
      // not human activity. They must not pin an idle result/lobby forever.
      const activity = result => { if (result && !['gameover', 'victory'].includes(simulation.phase)) peer.room.lastActivity = now; return result; };
      switch (message.type) {
        case 'ready': simulation.readyPlayer(peer.id); roomState(peer.room); break;
        case 'pause': activity(simulation.setPause(peer.id, message.paused)); roomState(peer.room); break;
        case 'practice': activity(simulation.practiceAction(peer.id, message)); break;
        case 'input': {
          const accepted = simulation.setInput(peer.id, message);
          if (accepted && (message.forward !== 0 || message.strafe !== 0 || message.jump === true)) peer.room.lastActivity = now;
          break;
        }
        case 'umbrella': activity(simulation.setUmbrella(peer.id, message.open)); break;
        case 'next-wave': activity(simulation.voteNextWave(peer.id, message.ready)); break;
        case 'revive-kit': activity(simulation.useReviveKit(peer.id)); break;
        case 'drop-coins': activity(simulation.dropCoins(peer.id)); break;
        case 'difficulty': if (activity(simulation.setDifficulty(peer.id, message.level))) roomState(peer.room); break;
        case 'friendly-fire': if (activity(simulation.setFriendlyFire(peer.id, message.level))) roomState(peer.room); break;
        case 'sheet': if (activity(simulation.setSheet(peer.id, message.sheet))) roomState(peer.room); break;
        case 'shoot': {
          const accepted = activity(simulation.shootOnline(peer.id, (now - lastTickAt) / 1000, message, { rttMs: peer.rttMs }));
          send(socket, { type: 'shot-ack', shotId: Number.isSafeInteger(message.shotId) ? message.shotId : undefined, accepted, serverTime: now });
          sendImpactNumbers(peer.room); break;
        }
        case 'melee-cancel': activity(simulation.cancelMelee(peer.id)); break;
        case 'minigun-spin':
          if (message.hand === undefined || ['primary', 'secondary'].includes(message.hand)) activity(simulation.setMinigunSpin(peer.id, message.spinning, message.hand));
          break;
        case 'reload': activity(simulation.reload(peer.id, message.hand)); break;
        case 'dual-wield': activity(simulation.setDualWield(peer.id, message.enabled, message.secondaryWeaponId)); break;
        case 'drop-weapon': activity(simulation.dropWeapon(peer.id)); break;
        case 'grenade': activity(simulation.throwGrenade(peer.id)); break;
        case 'interact': activity(simulation.interact(peer.id, { revive: message.revive === true })); break;
        case 'buy': activity(simulation.buyWeapon(peer.id, message.crateId)); break;
        case 'supply-claim': activity(simulation.claimSupply(peer.id, message.bonus, message.crateId)); break;
        case 'supply-buy': activity(simulation.buySupply(peer.id, message.service)); break;
        case 'weapon': if (!activity(simulation.chooseWeapon(peer.id, message.weaponId ?? message.weapon))) fail(peer, 'weapon-unavailable', 'Buy this weapon at its rack.'); break;
        case 'start': case 'restart': if (simulation.start(peer.id)) peer.room.lastActivity = now; syncImpactNumbers(peer.room); roomState(peer.room); break;
        case 'save-game': {
          let reply;
          try { reply = { type: 'save-game', save: simulation.exportSave({ build, requesterId: peer.id }) }; }
          catch (error) { reply = { type: 'save-denied', reason: typeof error?.code === 'string' ? error.code : 'error' }; }
          send(socket, reply);
          break;
        }
        case 'claim-seat': if (activity(simulation.claimSeat(peer.id, message.seat))) roomState(peer.room); break;
        case 'load-begin': case 'load-chunk': loadSave(peer, message); break;
      }
    });
    socket.once('close', () => disconnect(connection, socket));
    socket.on('error', () => { socket.terminate(); });
  });

  function step() {
    const startedAt = clock(); lastTickAt = startedAt;
    for (const peer of sessions.values()) if (!peer.socket && peer.resumeUntil <= startedAt) leave(peer);
    for (const room of rooms.values()) {
      room.simulation.tick(1 / TICK_RATE);
      sendImpactNumbers(room);
      if (ticks % 2 === 0) roomState(room);
    }
    ticks++; tickMs = Math.max(0, clock() - startedAt); peakTickMs = Math.max(peakTickMs, tickMs);
  }

  const simulationTimer = autoTick ? scheduleServerTicks(step, { rate: TICK_RATE, clock }) : null;
  function heartbeat() {
    for (const connection of connections.values()) {
      const peer = connection.peer;
      expireSaveUpload(peer, clock());
      if (!peer.room && clock() - peer.joinedAt > 60000) peer.socket?.terminate(); else probe(peer);
    }
    for (const [address, window] of createWindows) if (clock() - window.at > 60000) createWindows.delete(address);
    for (const room of rooms.values()) {
      const idleMs = room.simulation.paused ? config.pausedIdleMs
        : room.simulation.phase === 'lobby' ? config.lobbyIdleMs
        : ['gameover', 'victory'].includes(room.simulation.phase) ? config.resultIdleMs : null;
      if (idleMs !== null && clock() - room.lastActivity > idleMs) {
        for (const peer of [...room.peers.values()]) { send(peer.socket, { type: 'server-shutdown', reason: 'room-idle-expired', resume: false }); leave(peer); }
      }
    }
  }
  const heartbeatTimer = autoTick ? setInterval(heartbeat, 10000) : null;

  let closePromise;
  function close(reason = 'server-restarting') {
    if (closePromise) return closePromise;
    draining = true; simulationTimer?.stop(); clearInterval(heartbeatTimer);
    for (const connection of connections.values()) {
      send(connection.peer.socket, { type: 'server-shutdown', reason, resume: false });
      connection.peer.socket?.close(1001, 'Server restarting.');
    }
    closePromise = new Promise(resolveClose => {
      const force = setTimeout(() => { for (const socket of connections.keys()) socket.terminate(); }, 500);
      force.unref();
      wss.close(() => {
        server.close(() => { clearTimeout(force); rooms.clear(); sessions.clear(); capacity?.releaseAll(); resolveClose(); });
        if (!server.listening) { clearTimeout(force); rooms.clear(); sessions.clear(); resolveClose(); }
      });
    });
    return closePromise;
  }

  return { server, wss, rooms, connections, sessions, build, config, step, heartbeat, close,
    async listen() {
      await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
      return server.address();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const online = createOnlineServer();
  const address = await online.listen();
  console.log(`\n  DEADWOOD ONLINE\n  http://localhost:${address.port}\n  Build ${online.build}; ${online.config.maxRooms} rooms / ${online.config.maxPlayers} players maximum.\n`);
  const shutdown = () => { online.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
