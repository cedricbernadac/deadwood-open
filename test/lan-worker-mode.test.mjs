import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { LAN_MAPS } from '../lan-gateway.mjs';
import { localNetworkUrls } from '../network-urls.mjs';

// server.mjs as a map worker of the LAN gateway: started here directly in a
// worker thread, as lan-gateway.mjs does, on a loopback ephemeral port.
const SERVER = new URL('../server.mjs', import.meta.url);
const INDEX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const MULTI_MAP_META = '<meta name="deadwood-multi-map" content="true">';
const MAPS_META = '<meta name="deadwood-maps" content="cabin,supermarket,hospital,funfair">';
const assertSafePort = port => {
  assert.ok(Number.isInteger(port) && port > 0, `port ${port}`);
  assert.ok((port < 3000 || port > 3099) && ![3013, 3104, 3105].includes(port), `port ${port} belongs to a live or shared server`);
};

function startWorker({ level, root, env = {}, maps = LAN_MAPS }) {
  const worker = new Worker(SERVER, { env: { ...process.env, DEADWOOD_LEVEL: level, OPENAI_API_KEY: '', ...env }, execArgv: [], stdout: true,
    workerData: { lanGateway: true, root, maps: maps.map(map => ({ ...map })) } });
  let output = '';
  worker.stdout.setEncoding('utf8'); worker.stdout.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => worker.once('exit', code => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Map worker did not report ready.')), 20000);
    worker.on('message', message => { if (message?.type === 'ready') { clearTimeout(timer); resolve(message); } });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(Error(`Map worker exited with ${code}.`)); });
  });
  ready.catch(() => {});
  async function stop() {
    if (worker.threadId < 0) return exited;
    const timer = setTimeout(() => worker.terminate(), 4000);
    worker.postMessage({ type: 'close' });
    const code = await exited; clearTimeout(timer); return code;
  }
  return { worker, ready, exited, stop, output: () => output };
}

const workers = [];
after(async () => { await Promise.all(workers.map(entry => entry.stop())); });
let hospital = null;
async function hospitalWorker() {
  if (hospital) return hospital;
  // A port the worker must not try to take: PORT is the gateway's own port.
  const occupant = net.createServer();
  await new Promise((resolve, reject) => { occupant.once('error', reject); occupant.listen(0, '0.0.0.0', resolve); });
  const occupied = occupant.address().port; assertSafePort(occupied);
  workers.push({ stop: () => new Promise(resolve => occupant.close(resolve)) });
  const started = startWorker({ level: 'hospital', root: '/maps/hospital/', env: { PORT: String(occupied) } });
  workers.push(started);
  const ready = await started.ready;
  hospital = { ...started, info: ready, occupied, origin: `http://127.0.0.1:${ready.port}` };
  return hospital;
}

test('a hospital map worker ignores the inherited PORT and reports ready on its own loopback port', async () => {
  const { info, occupied, output } = await hospitalWorker();
  assert.equal(info.type, 'ready'); assert.equal(info.mapId, 'hospital');
  assertSafePort(info.port); assert.notEqual(info.port, occupied, 'PORT is the gateway\'s, never the worker\'s');
  assert.match(info.build, /^[0-9a-f]{12}$/);
  assert.doesNotMatch(output(), /Sur cet ordinateur|EADDRINUSE/, 'a worker prints no banner of its own');
});

test('a map worker serves the LAN page with the multi-map tags and its own module root', async () => {
  const { origin } = await hospitalWorker();
  const response = await fetch(origin + '/'), html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
  assert.ok(html.includes(MULTI_MAP_META)); assert.ok(html.includes(MAPS_META));
  assert.equal(html.match(/<meta name="deadwood-maps" content="([^"]*)">/)[1], 'cabin,supermarket,hospital,funfair');
  assert.ok(html.indexOf(MAPS_META) < html.indexOf('</head>'), 'the tags are in the head');
  assert.ok(html.includes("from '/maps/hospital/i18n.js'")); assert.ok(html.includes("import('/maps/hospital/client.js')"));
  const absolute = [...html.matchAll(/(?:from\s+['"]|import\(['"]|<script\b[^>]*\bsrc=['"])(\/[^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(absolute.length >= 2);
  assert.deepEqual(absolute.filter(path => !path.startsWith('/vendor/') && !path.startsWith('/maps/hospital/')), [], 'no other absolute import');
  assert.equal(await (await fetch(origin + '/index.html')).text(), html);
  assert.equal(await (await fetch(origin + '/?room=H12345')).text(), html);
  const head = await fetch(origin + '/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(html));
  assert.equal(await (await fetch(origin + '/level-id.js')).text(), 'export const LEVEL_ID = "hospital";\n');
});

test('a map worker health names its map, its build and whether a brain is connected', async () => {
  const { origin, info } = await hospitalWorker();
  const response = await fetch(origin + '/health');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, mapId: 'hospital', build: info.build, rooms: 0, players: 0, companions: false });
});

test('a map worker cannot be reached from the local network, only through the gateway', { skip: localNetworkUrls(1).length ? false : 'no private IPv4 address on this computer' }, async () => {
  const { info } = await hospitalWorker();
  const host = new URL(localNetworkUrls(info.port)[0]).hostname;
  const socket = net.connect({ host, port: info.port });
  const outcome = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('timeout'), 8000);
    socket.once('connect', () => { clearTimeout(timer); resolve('connected'); });
    socket.once('error', error => { clearTimeout(timer); resolve(error.code); });
  });
  socket.destroy();
  assert.notEqual(outcome, 'connected', `${host}:${info.port} must refuse`);
});

test('a map worker stops with code 0 within 3 s when the gateway says close', async () => {
  const { worker, exited } = await hospitalWorker();
  const started = performance.now();
  worker.postMessage({ type: 'close' });
  assert.equal(await exited, 0);
  assert.ok(performance.now() - started < 3000, `stopped in ${Math.round(performance.now() - started)} ms`);
});

test('the cabin worker at the root serves public/index.html with only the two tags added', async () => {
  const cabin = startWorker({ level: 'cabin', root: '/' }); workers.push(cabin);
  const info = await cabin.ready;
  assert.equal(info.mapId, 'cabin'); assertSafePort(info.port);
  const html = await (await fetch(`http://127.0.0.1:${info.port}/`)).text();
  assert.ok(html.includes(MULTI_MAP_META) && html.includes(MAPS_META));
  assert.equal(html.replace(MULTI_MAP_META + '\n', '').replace(MAPS_META + '\n', ''), INDEX);
  const health = await (await fetch(`http://127.0.0.1:${info.port}/health`)).json();
  assert.deepEqual(health, { ok: true, mapId: 'cabin', build: info.build, rooms: 0, players: 0, companions: false });
  assert.equal(await cabin.stop(), 0);
});

test('a map worker refuses a malformed gateway description at startup', async () => {
  for (const [root, maps] of [
    ['/evil/', LAN_MAPS],
    ['//evil.example/', LAN_MAPS],
    ['/maps/hospital', LAN_MAPS],
    ['/maps/hospital/', LAN_MAPS.filter(map => map.id !== 'hospital')],
    ['/maps/hospital/', LAN_MAPS.filter(map => map.id !== 'cabin')],
    ['/maps/hospital/', []],
    ['/maps/hospital/', [...LAN_MAPS, { id: '"><script>', root: '/maps/x/' }]],
  ]) {
    const started = startWorker({ level: 'hospital', root, maps });
    await assert.rejects(started.ready, error => !/did not report ready/.test(error.message), `${root} ${JSON.stringify(maps)}`);
    await started.exited;
  }
});
