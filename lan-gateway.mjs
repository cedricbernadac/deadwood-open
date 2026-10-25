import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_ROOTS } from './public/map-context.js';
import { localNetworkUrls } from './network-urls.mjs';

// The home Wi-Fi game with every decor in its menu: one public port, one
// server.mjs worker per map, always on, each on its own loopback port. The
// cabin answers at '/', the other maps under /maps/<id>/ (the online routing
// of online-gateway.mjs, without anything Render needs).
export const LAN_MAPS = Object.freeze(Object.entries(MAP_ROOTS).map(([id, root]) => Object.freeze({ id, root })));

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const UPGRADES = new Set(['/ws', '/companions']);

// Where a request goes: a map and the path its worker sees, a redirect to the
// map's root, or null (404). Media under absolute paths (/vendor, /levels,
// /audio, /style.css…) belong to the cabin worker, which serves all of public/.
export function lanRoute(raw, maps = LAN_MAPS) {
  let url, decoded;
  // URL parsing turns a raw backslash into '/': refuse it before.
  if (typeof raw !== 'string' || raw.split('?')[0].includes('\\')) return null;
  try { url = new URL(raw, 'http://localhost'); decoded = decodeURIComponent(url.pathname); } catch { return null; }
  const { pathname, search } = url;
  if (pathname.includes('\\') || pathname.includes('\0') || decoded.includes('\\') || decoded.includes('\0')) return null;
  for (const { id, root } of maps) {
    if (root === '/') continue;
    if (pathname === root.slice(0, -1)) return { redirect: root + search };
    if (pathname.startsWith(root)) {
      const rest = '/' + pathname.slice(root.length);
      return { id, path: rest + search, pathname: decodeURIComponent(rest) };
    }
  }
  if (pathname.startsWith('/maps/') || decoded.startsWith('/maps/')) return null;
  return { id: 'cabin', path: pathname + search, pathname: decoded };
}

// A companion brain runs on this computer, never in a web page (browsers always
// send an Origin). Behind the gateway every tunnel reaches a worker from
// 127.0.0.1, so this check lives here.
export function brainAllowed(request) {
  return LOOPBACK.has(request?.socket?.remoteAddress) && request?.headers?.origin === undefined;
}

const json = (request, response, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
};
const denySocket = (socket, status, reason) => socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

export async function createLanGateway({ port = Number(process.env.PORT ?? '3000'), host = '0.0.0.0', maps = LAN_MAPS, readyTimeoutMs = 30000,
  upstreamTimeoutMs = 10000, log = console.log } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT doit être un port TCP valide.');
  const catalog = maps.map(({ id, root }) => ({ id, root }));
  const workers = new Map(), sockets = new Set();
  let closing = false, closePromise = null;
  const available = entry => entry?.ready === true && !entry.exited;

  const mapHealth = entry => new Promise(done => {
    const down = { id: entry.id, root: entry.root, ready: false, rooms: 0, players: 0, build: entry.build ?? null, companions: false };
    if (closing || !available(entry)) { done(down); return; }
    let settled = false;
    const finish = value => { if (!settled) { settled = true; done(value); } };
    const request = http.get({ host: '127.0.0.1', port: entry.port, path: '/health', headers: { host: 'localhost' } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; if (text.length > 65536) request.destroy(); });
      response.on('end', () => {
        try {
          const value = JSON.parse(text);
          finish({ id: entry.id, root: entry.root, ready: value.ok === true && value.mapId === entry.id,
            rooms: Number(value.rooms) || 0, players: Number(value.players) || 0, build: value.build ?? entry.build, companions: value.companions === true });
        } catch { finish(down); }
      });
      response.on('error', () => finish(down)); response.on('close', () => finish(down));
    });
    request.setTimeout(1500, () => request.destroy());
    request.on('error', () => finish(down));
  });
  const health = async () => {
    const states = await Promise.all([...workers.values()].map(mapHealth));
    return { ok: !closing && states.length === catalog.length && states.every(map => map.ready), mode: 'lan', multiMap: true, defaultMap: 'cabin',
      rooms: states.reduce((sum, map) => sum + map.rooms, 0), players: states.reduce((sum, map) => sum + map.players, 0), maps: states };
  };

  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    const selected = lanRoute(request.url, catalog);
    if (!selected) { response.writeHead(404); response.end(); return; }
    if (selected.redirect) { response.writeHead(308, { Location: selected.redirect }); response.end(); return; }
    if (selected.id === 'cabin' && selected.pathname === '/health') { const state = await health(); json(request, response, state.ok ? 200 : 503, state); return; }
    // Invitation links name the gateway's port, never a worker's.
    if (selected.pathname === '/network.json') { json(request, response, 200, { urls: localNetworkUrls(server.address().port) }); return; }
    const entry = workers.get(selected.id);
    if (closing || !available(entry)) { json(request, response, 503, { ok: false, error: 'map-unavailable', mapId: selected.id }); return; }
    const upstream = http.request({ host: '127.0.0.1', port: entry.port, method: request.method, path: selected.path, headers: request.headers }, backend => {
      // The idle limit guards the wait for headers only: a slow reader of a
      // 27 MB level holds the stream back without ever cutting it.
      upstream.setTimeout(0);
      // A body cut short (a worker stopped mid-stream) ends the reader's
      // download too, instead of leaving it waiting forever.
      backend.on('error', () => response.destroy());
      backend.on('close', () => { if (!backend.complete) response.destroy(); });
      response.writeHead(backend.statusCode, backend.headers); backend.pipe(response);
    });
    upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy());
    upstream.on('error', () => { if (response.headersSent) response.destroy(); else json(request, response, 503, { ok: false, error: 'map-unavailable', mapId: selected.id }); });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  // Players on /ws and a brain on /companions: a raw tunnel to the map's
  // worker keeps ping/pong and close codes exactly as the worker sends them.
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    const selected = lanRoute(request.url, catalog);
    if (!selected || selected.redirect || !UPGRADES.has(selected.pathname)) { denySocket(socket, 404, 'Not Found'); return; }
    if (selected.pathname === '/companions' && !brainAllowed(request)) { denySocket(socket, 403, 'Forbidden'); return; }
    const entry = workers.get(selected.id);
    if (closing || !available(entry)) { denySocket(socket, 503, 'Map unavailable'); return; }
    const upstream = http.request({ host: '127.0.0.1', port: entry.port, method: 'GET', path: selected.path, headers: request.headers });
    upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy());
    upstream.once('upgrade', (backend, backendSocket, backendHead) => {
      upstream.setTimeout(0); backendSocket.setTimeout(0); socket.setTimeout(0);
      if (socket.destroyed) { backendSocket.destroy(); return; }
      let initial = `HTTP/1.1 ${backend.statusCode} ${backend.statusMessage}\r\n`;
      for (let index = 0; index < backend.rawHeaders.length; index += 2) initial += backend.rawHeaders[index] + ': ' + backend.rawHeaders[index + 1] + '\r\n';
      socket.write(initial + '\r\n');
      if (backendHead.length) socket.write(backendHead);
      if (head.length) backendSocket.write(head);
      backendSocket.on('error', () => socket.destroy()); socket.on('error', () => backendSocket.destroy());
      backendSocket.on('close', () => socket.destroy()); socket.on('close', () => backendSocket.destroy());
      socket.pipe(backendSocket); backendSocket.pipe(socket);
    });
    upstream.once('response', backend => { denySocket(socket, backend.statusCode, backend.statusMessage); backend.resume(); });
    upstream.on('error', () => { if (!socket.destroyed) denySocket(socket, 503, 'Map unavailable'); });
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const stopped = server.listening ? new Promise(resolveClose => server.close(() => resolveClose())) : Promise.resolve();
      await Promise.all([...workers.values()].map(entry => new Promise(resolveWorker => {
        if (entry.exited) { resolveWorker(); return; }
        const timer = setTimeout(() => entry.worker.terminate(), 2500);
        entry.worker.once('exit', () => { clearTimeout(timer); resolveWorker(); });
        entry.worker.postMessage({ type: 'close' });
      })));
      for (const socket of sockets) socket.destroy();
      await stopped;
    })();
    return closePromise;
  }

  // All or nothing: every map starts, or none stays running.
  try {
    await Promise.all(catalog.map(map => new Promise((resolveReady, rejectReady) => {
      const worker = new Worker(new URL('./server.mjs', import.meta.url), { env: { ...process.env, DEADWOOD_LEVEL: map.id }, execArgv: [],
        workerData: { lanGateway: true, root: map.root, maps: catalog } });
      const entry = { id: map.id, root: map.root, worker, port: null, build: null, ready: false, exited: false, started: false };
      workers.set(map.id, entry);
      const fail = reason => { clearTimeout(timer); rejectReady(new Error(`Map worker ${reason}: ${map.id}`)); };
      const timer = setTimeout(() => fail('startup timed out'), readyTimeoutMs);
      worker.on('message', message => {
        if (message?.type !== 'ready' || entry.started) return;
        if (message.mapId !== map.id) { fail(`reported ${String(message.mapId)}`); return; }
        Object.assign(entry, { port: message.port, build: message.build, ready: true, started: true });
        clearTimeout(timer); resolveReady();
      });
      worker.on('error', error => {
        entry.ready = false;
        if (!entry.started) fail(`failed (${error?.message ?? error})`);
        else if (!closing) log(`  [${map.id}] erreur : ${error?.message ?? error}`);
      });
      worker.on('exit', code => {
        entry.ready = false; entry.exited = true; entry.exitCode = code;
        if (!entry.started) fail(`exited (code ${code})`);
        else if (!closing) log(`  [${map.id}] décor arrêté (code ${code}) : relance la passerelle.`);
      });
    })));
  } catch (error) { await close(); throw error; }

  return { server, workers, health, close,
    async listen() {
      await new Promise((resolveListen, rejectListen) => {
        const failed = error => { server.off('listening', listening); rejectListen(error); };
        const listening = () => { server.off('error', failed); resolveListen(); };
        server.once('error', failed); server.once('listening', listening);
        server.listen(port, host);
      });
      return server.address();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = String(process.argv[2] ?? process.env.PORT ?? '3000').trim();
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error(`  Port invalide : « ${raw} ». Donne un nombre entre 0 et 65535, par exemple 3002.`); process.exit(2); }
  let gateway;
  try { gateway = await createLanGateway({ port }); }
  catch (error) { console.error(`  La passerelle n'a pas pu démarrer les décors : ${error?.message ?? error}`); process.exit(1); }
  let address;
  try { address = await gateway.listen(); }
  catch (error) {
    console.error(error?.code === 'EADDRINUSE' ? `  Le port ${port} est déjà utilisé par une autre application.` : `  La passerelle n'a pas pu écouter le port ${port} : ${error?.message ?? error}`);
    await gateway.close(); process.exit(1);
  }
  console.log(`\n  DEADWOOD — LAST LIGHT · quatre décors au choix dans le menu\n  Sur cet ordinateur : http://localhost:${address.port}`);
  for (const url of localNetworkUrls(address.port)) console.log(`  Réseau local       : ${url}`);
  console.log("  Même Wi-Fi : ouvre cette adresse ; La cabane par défaut, Le Dernier Panier, L'Hôpital des Pins et La Fête Foraine dans DÉCOR");
  console.log('  Compagnons IA (facultatif, sur cet ordinateur) : companions.cmd, un seul cerveau pour les quatre décors\n');
  const shutdown = () => { gateway.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
