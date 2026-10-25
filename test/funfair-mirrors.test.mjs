import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import { createLanGateway, LAN_MAPS } from '../lan-gateway.mjs';

// Real reflections in the funfair's mirror maze (public/funfair-mirrors.js).
// The checks that need DEADWOOD_LEVEL=funfair run as child processes.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const assertSafePort = port => {
  assert.ok(Number.isInteger(port) && port > 0, `port ${port}`);
  assert.ok((port < 3000 || port > 3099) && ![3013, 3104, 3105, 3197, 3198].includes(port), `port ${port} belongs to a live or shared server`);
};
function run(script, { level = 'funfair', timeout = 240000, marker } = {}) {
  const env = { ...process.env, OPENAI_API_KEY: '' };
  if (level === null) delete env.DEADWOOD_LEVEL; else env.DEADWOOD_LEVEL = level;
  const result = spawnSync(process.execPath, [script], { cwd: ROOT, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  // A failing assertion inside a data: module prints that module whole: keep the report readable.
  const clip = text => String(text ?? '').split('\n').map(line => line.length > 400 ? line.slice(0, 400) + '…' : line).join('\n');
  const diagnostic = [`level: ${level ?? 'default cabin'}, status: ${result.status}, signal: ${result.signal}`, result.error ? String(result.error) : '', clip(result.stdout), clip(result.stderr)].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  if (marker) assert.match(result.stdout, marker, diagnostic);
  return result.stdout;
}

test('funfair mirrors: GLB panes, tiers, range, choice, hysteresis and fades, avatar layer, no recursion, resize, colour, dispose, the real world, the closed maze and cellar, what a pass leaves out, the frame-time guard that never blinks, the inert probe and walking in the maze', () => {
  run(fixture('funfair-mirrors-check.mjs'), { timeout: 480000, marker: /funfair mirrors verified: 16 checks/ });
});

for (const level of [null, 'supermarket', 'hospital']) {
  test(`the ${level ?? 'cabin'} world has no mirror hook, no mirror rig and never asks for Reflector.js`, () => {
    run(fixture('funfair-mirrors-other-maps-check.mjs'), { level, timeout: 120000, marker: /has no funfair mirrors: verified/ });
  });
}

// Static imports of public modules, for the module graph.
const STATIC = /\b(?:import(?!\s*\()|export)\b[^;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\1/g;
const DYNAMIC = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
function closure(entries) {
  const seen = new Set(), visit = name => {
    if (seen.has(name)) return; seen.add(name);
    for (const match of read(name).matchAll(STATIC)) {
      const specifier = match[2] ?? match[4];
      if (specifier.startsWith('./') || specifier.startsWith('../')) visit(posix.normalize(posix.join(posix.dirname(name), specifier)));
    }
  };
  entries.forEach(visit);
  return seen;
}

test('only the funfair world imports the mirrors, and only the mirrors fetch Reflector.js, with a fixed path', () => {
  const modules = readdirSync(new URL('../public/', import.meta.url)).filter(name => name.endsWith('.js'));
  const importers = modules.filter(name => [...read(name).matchAll(STATIC)].some(match => (match[2] ?? match[4]) === './funfair-mirrors.js'));
  assert.deepEqual(importers, ['world-funfair.js']);
  const reflector = modules.filter(name => /(['"`])[^'"`\n]*Reflector\.js\1/.test(read(name)));
  assert.deepEqual(reflector, ['funfair-mirrors.js']);
  assert.deepEqual([...read('funfair-mirrors.js').matchAll(DYNAMIC)].map(match => match[2]), ['/vendor/Reflector.js']);
  // world-funfair.js is itself fetched only on the funfair.
  assert.match(read('world.js'), /const \{ createFunfairWorld \} = IS_FUNFAIR \? await import\('\.\/world-funfair\.js'\) : \{\};/);
  for (const entry of [['client.js'], ['online-client.js'], ['world.js']]) assert.equal(closure(entry).has('funfair-mirrors.js'), false, `${entry}: no static path to the mirrors`);
  assert.ok(closure(['world-funfair.js']).has('funfair-mirrors.js'));
  // The client's hook is one optional call: other maps' worlds have no setLocalAvatar.
  for (const name of ['client.js', 'online-client.js']) assert.equal(read(name).split('world.setLocalAvatar?.(').length, 2, name);
  // The online servers never serve the funfair: their vendor list is unchanged.
  assert.doesNotMatch(readFileSync(new URL('../online-server.mjs', import.meta.url), 'utf8'), /Reflector/);
});

async function standaloneFunfair() {
  const child = spawn(process.execPath, ['start-funfair.mjs', '0'], { cwd: ROOT, env: { ...process.env, OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no banner: ${output}`)), 20000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`exited ${code}: ${output}`)); });
    const collect = chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { origin, async close() { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; } };
}
async function servedReflector(url) {
  const response = await fetch(url), text = await response.text();
  assert.equal(response.status, 200, url);
  assert.match(response.headers.get('content-type'), /javascript/, url);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', url);
  assert.match(text, /class Reflector extends Mesh/, url);
  assert.match(text, /from '\/vendor\/three\.module\.js'/, `${url}: three from the local vendor path`);
  assert.doesNotMatch(text, /from (['"])three\1/, `${url}: no bare specifier left`);
  return text;
}

test('a standalone funfair server serves the mirrors module and Reflector.js from the local three.js', { timeout: 60000 }, async t => {
  const server = await standaloneFunfair(); t.after(() => server.close());
  assertSafePort(Number(new URL(server.origin).port));
  assert.equal((await (await fetch(server.origin + '/health')).json()).mapId, 'funfair');
  const reflector = await servedReflector(server.origin + '/vendor/Reflector.js');
  assert.equal(reflector, readFileSync(new URL('../node_modules/three/examples/jsm/objects/Reflector.js', import.meta.url), 'utf8').replace(/from (['"])three\1/g, "from '/vendor/three.module.js'"));
  const mirrors = await fetch(server.origin + '/funfair-mirrors.js');
  assert.equal(mirrors.status, 200); assert.equal(await mirrors.text(), read('funfair-mirrors.js'));
  assert.match(await (await fetch(server.origin + '/world-funfair.js')).text(), /from '\.\/funfair-mirrors\.js'/);
});

test('the LAN gateway serves the mirrors under /maps/funfair/ and Reflector.js at the absolute vendor path the page asks for', { timeout: 90000 }, async t => {
  const gateway = await createLanGateway({ port: 0, host: '127.0.0.1', log: () => {}, maps: LAN_MAPS.filter(map => ['cabin', 'funfair'].includes(map.id)) });
  const address = await gateway.listen(); assertSafePort(address.port);
  for (const entry of gateway.workers.values()) assertSafePort(entry.port);
  t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(origin + '/maps/funfair/')).text();
  assert.ok(page.includes("import('/maps/funfair/client.js')"), 'the funfair page loads its modules under /maps/funfair/');
  const mirrors = await fetch(origin + '/maps/funfair/funfair-mirrors.js');
  assert.equal(mirrors.status, 200); assert.equal(await mirrors.text(), read('funfair-mirrors.js'));
  assert.match(await (await fetch(origin + '/maps/funfair/world-funfair.js')).text(), /from '\.\/funfair-mirrors\.js'/, 'resolved relative to /maps/funfair/');
  // import('/vendor/Reflector.js') from /maps/funfair/funfair-mirrors.js reaches the cabin worker, which serves the same vendor files.
  const absolute = await servedReflector(origin + '/vendor/Reflector.js');
  assert.equal(await servedReflector(origin + '/maps/funfair/vendor/Reflector.js'), absolute);
  assert.equal((await fetch(origin + '/vendor/three.module.js', { method: 'HEAD' })).status, 200);
});
