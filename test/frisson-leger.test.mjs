// Frisson léger (the owner, 15 October 2026): a third ambiance between
// Famille and Frisson, exactly Frisson but for three things, the rounder B heads
// (public/frisson/heads-b.glb), half the blood and the light pickups
// (pickups.js tierOf). The loader passes the
// variant (ambiance.js FRISSON_VARIANTS) to the one pack; heads.js reads its
// head file, blood.js its share of the knob. The home picker, the lobby and
// results, the "Famille uniquement" lock and the infected guide treat it as
// Frisson. Famille is untouched; Frisson is exactly as before.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { createAmbianceLoader, FRISSON_VARIANTS } from '../public/ambiance.js';
import { ENEMY_HEALTH, BRUTE_HEALTH, enemyAppearance } from '../public/rules.js';
import { t, getLanguage, setLanguage } from '../public/i18n.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { NO_HOOKS, settle, recordingPack, clientHarness, snapshotFor, joinMessage, walker } from './helpers/frisson-client.mjs';
import { SHOTS, ROWS, MOVE, shotEvents, rowSpray } from './helpers/blood-wounds.mjs';

const { createWorld } = await importPublicModule('world.js');
const zombies = await importPublicModule('zombies.js');
const heads = await importPublicModule('frisson/heads.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const { install: installBlood, BLOOD, SPLATS } = await importPublicModule('frisson/blood.js');
const { BLOOD_INTENSITY, knob, variantKnob, variantShare, sprayPlan } = await importPublicModule('frisson/blood-spray.js');

const LIGHT = FRISSON_VARIANTS['frisson-leger'], FULL = FRISSON_VARIANTS.frisson;
const bytesOf = name => { const bytes = readFileSync(new URL(`../public/frisson/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// ---------------------------------------------------------------------------
// The pack: the head file and the blood's share.
// ---------------------------------------------------------------------------

test('heads.js wears heads-b.glb in Frisson léger only; any other variant, or none, is heads.glb', () => {
  assert.deepEqual(heads.HEAD_FILES, ['heads.glb', 'heads-b.glb']); assert.ok(Object.isFrozen(heads.HEAD_FILES));
  assert.equal(heads.headsFile(LIGHT), 'heads-b.glb');
  assert.equal(heads.headsFile(FULL), 'heads.glb');
  for (const variant of [undefined, null, {}, { heads: '../secret.glb' }, { heads: '/frisson/heads-b.glb' }, { heads: 'bodies.glb' }, { heads: ['heads-b.glb'] }, 'heads-b.glb'])
    assert.equal(heads.headsFile(variant), 'heads.glb', JSON.stringify(variant));
});

test('the heads part fetches heads-b.glb in Frisson léger and heads.glb otherwise, and wears what it fetched', async () => {
  const wear = async variant => {
    const asked = [];
    const handle = await heads.install({ variant, fetchAsset: async path => { asked.push(path); return bytesOf(path); } });
    const names = handle.heads.variants.map(head => head.name), boss = handle.heads.boss?.name ?? null;
    assert.equal(zombies.getZombieStyle(), handle.style);
    handle.uninstall();
    assert.equal(zombies.getZombieStyle(), null);
    return { asked, names, boss };
  };
  const light = await wear(LIGHT), full = await wear(FULL), none = await wear(undefined);
  assert.deepEqual(light.asked, ['heads-b.glb']); assert.deepEqual(full.asked, ['heads.glb']); assert.deepEqual(none.asked, ['heads.glb']);
  // The B file's own heads, none of the A ones; Frisson is the A file as before.
  const fileNames = name => heads.headsFromGlb(readGlb(bytesOf(name))).variants.map(head => head.name);
  assert.deepEqual(light.names, fileNames('heads-b.glb'));
  assert.deepEqual(full.names, fileNames('heads.glb')); assert.deepEqual(none.names, full.names);
  assert.equal(light.names.filter(name => full.names.includes(name)).length, 0, 'no A head in Frisson léger');
  // Rôdeurs, Enragés and Revenants B mixed, with a boss head (the Enragés B one).
  for (const set of ['RodeursB', 'EnragesB', 'RevenantsB']) assert.ok(light.names.some(name => name.startsWith(set)), set);
  assert.equal(light.boss, 'Boss');
});

test('the blood knob: Frisson léger draws with half of Frisson\'s, Frisson with BLOOD_INTENSITY exactly', () => {
  assert.equal(BLOOD_INTENSITY, 1);
  assert.equal(variantKnob(undefined, undefined), knob(BLOOD_INTENSITY));
  assert.equal(variantKnob(BLOOD_INTENSITY, FULL), BLOOD_INTENSITY);
  assert.equal(variantKnob(BLOOD_INTENSITY, LIGHT), BLOOD_INTENSITY * .5);
  assert.equal(variantKnob(undefined, LIGHT), .5);
  // On top of the owner's knob (clamped to .25–2): always half of Frisson's,
  // even at the knob's floor, where Frisson léger goes below it.
  assert.equal(variantKnob(2, LIGHT), 1); assert.equal(variantKnob(1.5, LIGHT), .75); assert.equal(variantKnob(9, LIGHT), 1);
  assert.equal(variantKnob(.5, LIGHT), .25); assert.equal(variantKnob(.25, LIGHT), .125); assert.equal(variantKnob(.1, LIGHT), .125);
  for (const value of [undefined, .1, .25, .3, .5, .75, 1, 1.5, 2, 9, 'x', null]) {
    assert.equal(variantKnob(value, FULL), knob(value ?? undefined), `Frisson at ${value}`);
    assert.equal(variantKnob(value, LIGHT), variantKnob(value, FULL) / 2, `Frisson léger at ${value}: half of Frisson`);
  }
  // A share that is not a positive number is no share; a variant never adds blood.
  for (const blood of [undefined, null, 0, -.5, Number.NaN, Infinity, '.5', [.5], 2]) { assert.equal(variantKnob(1, { blood }), 1, String(blood)); assert.equal(variantShare({ blood }), 1, String(blood)); }
  assert.equal(variantShare(LIGHT), .5); assert.equal(variantShare(FULL), 1); assert.equal(variantShare(undefined), 1);
});

// The blood part fed one recorded wound, as blood-spray.test.mjs does: the
// owner's case, the shotgun at 1.2 m into a colossus's head.
async function bloodPart({ variant, random = seeded(7), intensity } = {}) {
  const scene = new THREE.Scene(), hooks = {}, droplets = [], sprays = [];
  const eye = SHOTS.shotgunColossusHead.eye, move = MOVE('shotgunColossusHead');
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 200); camera.position.set(eye[0] + move[0], eye[1] + move[1], eye[2] + move[2]);
  const handle = await installBlood({ THREE, scene, camera, hooks, quality: 'high', random, base: '/frisson/', ...(variant === undefined ? {} : { variant }),
    ...(intensity === undefined ? {} : { bloodIntensity: intensity }), onDroplet: info => droplets.push({ ...info }), onSpray: info => sprays.push({ ...info }) });
  hooks.frame({ delta: 1 / 60 });
  for (const event of shotEvents('shotgunColossusHead', { kind: 'brute', local: true, shot: 1, move })) hooks.impact(event);
  for (let step = 0; step < 12; step++) hooks.frame({ delta: 1 / 60 });
  const stats = handle.stats(), knobOnGroup = scene.getObjectByName('frissonBlood').userData.knob;
  handle.uninstall();
  return { stats, droplets, sprays, knobOnGroup };
}

test('the blood part in Frisson léger throws half of Frisson\'s spray; Frisson throws exactly what it threw before', async () => {
  const before = await bloodPart(), full = await bloodPart({ variant: FULL }), light = await bloodPart({ variant: LIGHT });
  // Frisson: the very same droplets, drawn from the same random, as with no variant at all.
  assert.deepEqual(full.droplets, before.droplets); assert.deepEqual(full.sprays, before.sprays);
  assert.deepEqual(full.stats, before.stats);
  assert.equal(full.stats.knob, 1); assert.equal(full.knobOnGroup, 1);
  // Frisson léger: the knob at .5, the pools as large (they never shrink).
  assert.equal(light.stats.knob, .5); assert.equal(light.knobOnGroup, .5);
  assert.deepEqual(light.stats.pools, full.stats.pools);
  // The plan at .5: burst, fountain and kill halved, the entry puffs by √.5.
  const spray = rowSpray(ROWS.find(row => row.source === 'shotgunColossusHead'));
  const plan = B => sprayPlan(spray, 'high', B, {}), atOne = plan(1), atHalf = plan(.5);
  assert.equal(full.sprays.length, 1); assert.equal(light.sprays.length, 1);
  assert.equal(full.sprays[0].want, atOne.burst + atOne.fountain + atOne.kill);
  assert.equal(light.sprays[0].want, atHalf.burst + atHalf.fountain + atHalf.kill);
  const ratio = light.sprays[0].want / full.sprays[0].want;
  assert.ok(ratio > .45 && ratio < .55, `half the spray (${light.sprays[0].want} of ${full.sprays[0].want})`);
  assert.ok(Math.abs(light.sprays[0].spots / full.sprays[0].spots - .5) < .1, `half the floor and wall pixels (${light.sprays[0].spots} of ${full.sprays[0].spots})`);
  const thrown = result => result.droplets.filter(drop => drop.layer !== 'puff').length;
  assert.ok(thrown(light) > 0, 'blood still flies');
  assert.ok(Math.abs(thrown(light) / thrown(full) - .5) < .08, `half the droplets beyond the puffs (${thrown(light)} of ${thrown(full)})`);
  // The owner's knob still works on top (a bench or a tool passing its own).
  assert.equal((await bloodPart({ variant: LIGHT, intensity: 2 })).stats.knob, 1);
  assert.equal((await bloodPart({ variant: FULL, intensity: 2 })).stats.knob, 2);
});

// The stains under the fallen and the screen splats when bitten, which the
// knob does not reach: Frisson léger halves them too ("diminuer le sang de
// moitié"); Frisson draws exactly what it drew before. A document stand-in
// whose canvases record their 2D calls (as in frisson-blood.test.mjs).
function recordingDocument() {
  const body = { children: [], appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; return node; } };
  const pen = () => ({ calls: [], globalAlpha: 1, fillStyle: '#000', imageSmoothingEnabled: true,
    clearRect(...args) { this.calls.push(['clearRect', ...args]); }, fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); },
    drawImage(image, x, y) { this.calls.push(['drawImage', image.id, x, y, this.globalAlpha]); } });
  const created = [];
  return { body, created, defaultView: { innerWidth: 1920, innerHeight: 1080 },
    createElement(tag) {
      const canvas = { id: created.length, tag, width: 300, height: 150, style: {}, attributes: {}, parentNode: null, setAttribute(key, value) { this.attributes[key] = value; },
        getContext(kind) { return kind === '2d' ? (this.pen ??= pen()) : null; }, remove() { this.parentNode?.removeChild(this); } };
      created.push(canvas);
      return canvas;
    } };
}
// Walkers and colossi falling at a few open spots of the cabin floor, then
// bites at ordinary and at low health: the stain squares shown (their area
// in grid cells) and the blood painted on the splat sprites (pixels).
async function stainsAndSplats(variant, seed) {
  const document = recordingDocument(), scene = new THREE.Scene(), hooks = {};
  const handle = await installBlood({ THREE, scene, hooks, quality: 'high', random: seeded(seed), document, base: '/frisson/', ...(variant === undefined ? {} : { variant }) });
  const stains = scene.getObjectByName('frissonBlood').getObjectByName('frissonBloodStains');
  const step = seconds => { for (let left = seconds; left > 1e-9; left -= 1 / 60) hooks.frame({ delta: Math.min(1 / 60, left) }); };
  step(1 / 60);
  for (const [x, z, dirX, dirZ] of [[-1, 1.5, 1, 0], [-1, 1.5, 0, 1], [1, 1.5, -1, 0], [0, 2.4, 0, -1], [-1.2, 2.6, 1, 0], [1.2, 2.6, 0, 1]])
    for (const kind of ['walker', 'brute']) hooks.death({ mesh: { position: { x, y: 0, z }, rotation: { y: 0 }, scale: { x: kind === 'brute' ? 1.22 : 1 }, userData: { kind, boss: false } }, x, y: 0, z, dirX, dirZ });
  step(1.5);
  const array = stains.instanceMatrix.array, squares = [];
  for (let index = 0; index < stains.count; index++) if (array[index * 16] > 0) squares.push(Array.from(array.subarray(index * 16, index * 16 + 16)));
  const cells = squares.reduce((sum, matrix) => sum + (matrix[0] / BLOOD.grid) ** 2, 0);
  for (const [amount, hp] of [[11, 89], [11, 78], [25, 53], [11, 42], [11, 31], [11, 20]]) { hooks.hurt({ amount, hp, maxHp: 100, source: 'zombie' }); step(.5); }
  const sprites = document.created.filter(canvas => canvas.width === SPLATS.sprite && canvas.pen);
  const painted = sprites.map(sprite => { const calls = sprite.pen.calls, last = calls.findLastIndex(call => call[0] === 'clearRect'); return calls.slice(last + 1).filter(call => call[0] === 'fillRect'); });
  const pixels = painted.flat().reduce((sum, call) => sum + call[4] * call[5], 0);
  handle.uninstall();
  return { squares, cells, painted, pixels, splats: painted.filter(calls => calls.length).length };
}

test('Frisson léger halves the stains under the fallen and the screen splats when bitten; Frisson draws exactly what it drew before', async () => {
  let fullCells = 0, lightCells = 0, fullPixels = 0, lightPixels = 0;
  for (const seed of [3, 11, 29]) {
    const before = await stainsAndSplats(undefined, seed), full = await stainsAndSplats(FULL, seed), light = await stainsAndSplats(LIGHT, seed);
    // Frisson: the very same squares and the very same paint, from the same random.
    assert.deepEqual(full.squares, before.squares, `seed ${seed}: Frisson's stains`); assert.deepEqual(full.painted, before.painted, `seed ${seed}: Frisson's splats`);
    assert.ok(full.squares.length > 40 && full.splats >= 8, `seed ${seed}: ${full.squares.length} stain squares, ${full.splats} splats`);
    // Frisson léger: as many splats, each about half as much blood; the stains about half the area.
    assert.ok(light.squares.length > 0 && light.splats === full.splats, `seed ${seed}: ${light.squares.length} squares, ${light.splats} splats of ${full.splats}`);
    fullCells += full.cells; lightCells += light.cells; fullPixels += full.pixels; lightPixels += light.pixels;
  }
  const stainShare = lightCells / fullCells, splatShare = lightPixels / fullPixels;
  assert.ok(stainShare > .4 && stainShare < .6, `stains: ${lightCells} grid cells of ${fullCells} (${stainShare.toFixed(2)})`);
  assert.ok(splatShare > .4 && splatShare < .6, `splats: ${lightPixels} pixels of ${fullPixels} (${splatShare.toFixed(2)})`);
});

// ---------------------------------------------------------------------------
// The whole pack through the loader, as client.js asks for it.
// ---------------------------------------------------------------------------

function gameContext(asked) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130);
  const element = () => ({ style: { setProperty() {} }, dataset: {}, width: 0, height: 0, setAttribute() {}, remove() {}, append() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) });
  const previous = globalThis.document; globalThis.document = { createElement: element };
  let world;
  try { world = createWorld(scene); } finally { globalThis.document = previous; }
  return {
    THREE, world, scene, camera, renderer: { toneMappingExposure: 1.3, compile() {}, async compileAsync() {}, getPixelRatio: () => 1 },
    sound: { setStyle() {}, heartbeat() {} }, feedback: { style: null, setStyle(style) { this.style = style; } }, quality: 'low',
    document: { head: element(), body: element(), createElement: element, getElementById: () => null, querySelector: () => null, documentElement: { classList: { add() {}, remove() {} } } },
    fetchAsset: async path => { asked.push(path); return bytesOf(path); },
  };
}

test('the real pack: Frisson léger fetches heads-b.glb and never heads.glb, Frisson the reverse, every other file alike; the blood knob follows', async () => {
  const loader = createAmbianceLoader(), importer = () => importPublicModule('frisson/index.js');
  const run = async id => {
    const asked = [], ctx = gameContext(asked), hooks = { ...NO_HOOKS };
    assert.deepEqual(await loader.apply(id, { ...ctx, hooks }, importer), { id });
    assert.equal(loader.id, id);
    const knobOnGroup = ctx.scene.getObjectByName('frissonBlood')?.userData.knob;
    for (const name of Object.keys(hooks)) assert.equal(typeof hooks[name], 'function', `${id}: ${name}`);
    assert.ok(zombies.getZombieStyle(), `${id}: the heads and bodies are on`);
    assert.deepEqual(await loader.apply('family', {}), { id: 'family' });
    assert.deepEqual(hooks, NO_HOOKS); assert.equal(zombies.getZombieStyle(), null);
    assert.equal(ctx.scene.getObjectByName('frissonBlood'), undefined, `${id}: the blood comes off`);
    return { asked, knobOnGroup };
  };
  const light = await run('frisson-leger'), full = await run('frisson');
  assert.ok(light.asked.includes('heads-b.glb') && !light.asked.includes('heads.glb'), JSON.stringify(light.asked));
  assert.ok(full.asked.includes('heads.glb') && !full.asked.includes('heads-b.glb'), JSON.stringify(full.asked));
  // Nothing else changes: the same files, in the same order, but the heads.
  assert.deepEqual(light.asked.map(path => path === 'heads-b.glb' ? 'heads.glb' : path), full.asked);
  assert.equal(light.knobOnGroup, .5); assert.equal(full.knobOnGroup, 1);
});

// ---------------------------------------------------------------------------
// The browser client (client.js in a vm, test/helpers/frisson-client.mjs).
// ---------------------------------------------------------------------------

const ORDER = ['family', 'frisson-leger', 'frisson'];
const pressed = client => ORDER.map(id => client.node(`ambiance-${id}`).attributes['aria-pressed']);
const guideFor = frisson => ({
  markers: ENEMY_HEALTH.map(maxHp => t(`enemyGuide.${frisson ? 'frisson.' : ''}${enemyAppearance({ kind: 'walker', maxHp }).marker}`)),
  hulks: t(frisson ? 'enemyGuide.frisson.hulks' : 'enemyGuide.hulks', { health: BRUTE_HEALTH.join(' / ') }),
});
const guide = client => ({ markers: client.node('enemy-guide-families').children.map(row => row.children[3].textContent), hulks: client.node('enemy-guide-hulks').textContent });

test('home picker: Famille, Frisson léger, Frisson; Frisson léger only for a room made here, never saved', () => {
  const client = clientHarness();
  assert.deepEqual(pressed(client), ['true', 'false', 'false']);
  client.node('ambiance-frisson-leger').click();
  assert.deepEqual(pressed(client), ['false', 'true', 'false']);
  assert.equal(client.node('ambiance-frisson-leger').classList.contains('selected'), true);
  assert.equal(client.node('ambiance-family').classList.contains('selected'), false);
  const created = joinMessage(client);
  assert.equal(created.ambiance, 'frisson-leger'); assert.equal(created.room, undefined);
  const stand = joinMessage(client, { practice: true });
  assert.equal(stand.practice, true); assert.equal(stand.ambiance, 'frisson-leger');
  // Frisson, then back to Frisson léger: one choice at a time.
  client.node('ambiance-frisson').click(); assert.deepEqual(pressed(client), ['false', 'false', 'true']); assert.equal(joinMessage(client).ambiance, 'frisson');
  client.node('ambiance-frisson-leger').click(); assert.deepEqual(pressed(client), ['false', 'true', 'false']);
  // Joining never asks for an ambiance.
  client.node('join-tab').onclick(); client.node('room-code').value = 'abc123';
  assert.equal('ambiance' in joinMessage(client), false);
  client.node('create-tab').onclick();
  client.node('ambiance-family').click();
  assert.equal('ambiance' in joinMessage(client), false);
  assert.deepEqual(client.writes.filter(([key]) => key !== 'deadwood-name'), [], 'the choice is never stored');
  assert.equal(clientHarness().state().homeAmbiance, 'family');
});

test('"Famille uniquement" closes both Frisson ambiances, here and from another tab', () => {
  const client = clientHarness();
  client.node('ambiance-frisson-leger').click();
  client.node('family-lock').checked = true; client.node('family-lock').onchange({ target: client.node('family-lock') });
  for (const id of ['frisson-leger', 'frisson']) { assert.equal(client.node(`ambiance-${id}`).disabled, true, id); assert.equal(client.node(`ambiance-${id}`).title, t('ambiance.lockedTitle'), id); }
  assert.equal(client.node('ambiance-family').disabled, false);
  assert.deepEqual(pressed(client), ['true', 'false', 'false'], 'locking falls back to Famille');
  client.node('ambiance-frisson-leger').onclick();
  assert.equal(client.state().homeAmbiance, 'family');
  assert.equal('ambiance' in joinMessage(client), false);
  const reloaded = clientHarness({ locked: true });
  assert.equal(reloaded.node('ambiance-frisson-leger').disabled, true);
  // Another tab takes the lock off, then puts it on again while Frisson léger is chosen.
  const other = clientHarness();
  other.node('ambiance-frisson-leger').click();
  other.storage('deadwood-family-lock', '1');
  assert.equal(other.node('ambiance-frisson-leger').disabled, true); assert.equal(other.state().homeAmbiance, 'family');
  other.storage('deadwood-family-lock', '0');
  assert.equal(other.node('ambiance-frisson-leger').disabled, false); assert.equal(other.node('ambiance-frisson-leger').title, '');
  // Written without this tab hearing of it: read again when the room is made.
  other.node('ambiance-frisson-leger').click();
  other.stored.set('deadwood-family-lock', '1');
  assert.equal('ambiance' in joinMessage(other), false);
});

test('a Frisson léger room loads the pack with its variant, says so in the lobby and the results, shows the Frisson guide, and comes off on leaving', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('host');
  client.update(snapshotFor({ ambiance: 'frisson-leger', zombies: [walker(5)] }));
  assert.equal(client.node('start-button').disabled, true, 'held while the pack loads');
  await settle(); await settle();
  assert.deepEqual(client.loaderCalls, ['frisson-leger']); assert.equal(pack.imports, 1);
  // The context of DESIGN.md, plus the variant the loader adds.
  const ctx = pack.contexts[0];
  for (const key of ['THREE', 'world', 'scene', 'renderer', 'camera', 'sound', 'feedback', 'hooks', 'quality', 'base', 'document', 'fetchAsset', 'signal']) assert.ok(ctx[key] !== undefined, key);
  assert.equal(ctx.variant, LIGHT); assert.deepEqual({ ...ctx.variant }, { id: 'frisson-leger', heads: 'heads-b.glb', blood: .5, pickups: 'light' });
  assert.equal(client.node('ambiance-value').textContent, 'Frisson léger (12+)');
  assert.equal(client.node('ambiance-value').classList.contains('frisson'), true);
  assert.equal(client.node('ambiance-note').hidden, true); assert.equal(client.node('start-button').disabled, false);
  assert.deepEqual(guide(client), guideFor(true), 'the pack is on: its markers');
  // The hooks are the pack's: a wound reaches it, as in Frisson.
  client.enter();
  client.update(snapshotFor({ ambiance: 'frisson-leger', phase: 'wave', zombies: [walker(5)] }));
  client.event({ type: 'event', event: 'shot', id: 'host', weapon: 'pistol', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0,
    pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'zombie', wounds: [[5, 3.68, 25.2, 0, 0, 2, 0, -4]] }] });
  assert.equal(pack.events.filter(([name]) => name === 'impact').length, 1);
  client.update(snapshotFor({ ambiance: 'frisson-leger', phase: 'gameover' }));
  assert.equal(client.node('ambiance-value-results').textContent, 'Frisson léger (12+)');
  client.leave(); await settle();
  assert.deepEqual(log, ['import', 'install', 'prewarm', 'uninstall']);
  assert.deepEqual(client.hooks(), NO_HOOKS);
  assert.deepEqual(guide(client), guideFor(false));
  // A Frisson room next, in the same tab: installed again with Frisson's variant, not imported again.
  client.join('host'); client.update(snapshotFor({ ambiance: 'frisson' })); await settle(); await settle();
  assert.deepEqual(client.loaderCalls, ['frisson-leger', 'family', 'frisson']);
  assert.equal(pack.imports, 1); assert.equal(pack.contexts[1].variant, FULL);
  assert.equal(client.node('ambiance-value').textContent, 'Frisson (15+)');
});

test('a PC locked to Famille in a Frisson léger room never imports the pack, shows the room\'s name with its note, and the Famille guide', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ locked: true, importer: pack.importer, log });
  client.join('guest');
  client.update(snapshotFor({ ambiance: 'frisson-leger', zombies: [walker(5)] }));
  assert.equal(client.node('ambiance-value').textContent, 'Frisson léger (12+)');
  assert.equal(client.node('ambiance-note').hidden, false); assert.equal(client.node('ambiance-note').textContent, 'Cet ordinateur reste en Famille.');
  assert.equal(client.node('start-button').disabled, false);
  client.enter(); client.update(snapshotFor({ ambiance: 'frisson-leger', phase: 'wave', zombies: [walker(5)] }));
  for (let now = 16; now < 200; now += 16) { client.time(now); client.frame(now); }
  assert.deepEqual(guide(client), guideFor(false));
  client.leave(); await settle();
  assert.deepEqual(client.loaderCalls, []); assert.equal(pack.imports, 0);
  assert.deepEqual(client.hooks(), NO_HOOKS);
  assert.equal(client.fetched.filter(url => /frisson/i.test(url)).length, 0);
  // Locked from another tab while Frisson léger is on: Famille at once.
  const inside = clientHarness({ importer: pack.importer, log });
  inside.join('guest'); inside.update(snapshotFor({ ambiance: 'frisson-leger', phase: 'wave', zombies: [walker(5)] })); await settle(); await settle();
  assert.equal(typeof inside.hooks().frame, 'function');
  inside.storage('deadwood-family-lock', '1'); await settle(); await settle();
  assert.deepEqual(inside.hooks(), NO_HOOKS); assert.equal(log.at(-1), 'uninstall');
  assert.equal(inside.node('ambiance-note').textContent, 'Cet ordinateur reste en Famille.');
  assert.deepEqual(guide(inside), guideFor(false));
});

test('words: « Frisson léger » and « Light Fright », each with its line', () => {
  const before = getLanguage();
  try {
    setLanguage('fr');
    assert.equal(t('ambiance.frissonLeger'), 'Frisson léger (12+)');
    assert.equal(t('ambiance.frissonLegerDetail'), 'Comme Frisson, avec des têtes plus rondes et moitié moins de sang.');
    setLanguage('en');
    assert.equal(t('ambiance.frissonLeger'), 'Light Fright (12+)');
    assert.equal(t('ambiance.frissonLegerDetail'), 'Like Frisson, with rounder heads and half the blood.');
  } finally { setLanguage(before); }
});

test('the page: three choices in the picker, in order, translated, on the LAN and online pages alike', () => {
  for (const page of ['index.html', 'online.html']) {
    const html = readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    const picker = html.match(/<div id="ambiance-picker"[\s\S]*?<\/div><\/div>/)?.[0] ?? '';
    const buttons = [...picker.matchAll(/<button id="ambiance-([\w-]+)" type="button" class="ambiance-option[^"]*" data-ambiance="([\w-]+)" aria-pressed="(true|false)"><strong data-i18n="([\w.]+)">([^<]+)<\/strong><small data-i18n="([\w.]+)">([^<]+)<\/small><\/button>/g)];
    assert.deepEqual(buttons.map(match => match[1]), ORDER, page);
    for (const [, id, data, ariaPressed, label, text, detail, detailText] of buttons) {
      assert.equal(data, id, page); assert.equal(ariaPressed, String(id === 'family'), `${page} ${id}`);
      const key = id === 'frisson-leger' ? 'frissonLeger' : id;
      assert.equal(label, `ambiance.${key}`); assert.equal(detail, `ambiance.${key}Detail`);
      // The page's own words are the French ones.
      setLanguage('fr'); assert.equal(text, t(label)); assert.equal(detailText, t(detail));
    }
  }
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.ambiance-options\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/);
  assert.match(css, /\.ambiance-option\[data-ambiance="frisson-leger"\]\.selected\{/);
});
