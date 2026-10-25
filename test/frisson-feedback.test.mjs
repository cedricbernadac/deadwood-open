import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import inspector from 'node:inspector/promises';
import * as THREE from 'three';
import { importPublicModule, importPublicSource } from './helpers/public-modules.mjs';

// The Frisson feedback, lot 1 (art/frisson/UI-SOUND.md sections 2, 4.3-4.5,
// 4.7 and 5.1): the impact, death and HUD hooks are no-ops with a null style
// (Famille byte for byte, proven against each file with its hook lines put
// back as they were), and the pack part's recipes, words and stylesheet keep
// the brief's rules. The sounds of the same lot have their own tests.
const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Each anchor must be present exactly once: changing a hook line on purpose
// means changing its pair here.
function strip(source, pairs, name) {
  for (const [anchor, replacement] of pairs) {
    assert.equal(source.split(anchor).length - 1, 1, `${name}: exactly one ${JSON.stringify(anchor.split('\n').find(Boolean))}`);
    source = source.split(anchor).join(replacement);
  }
  return source;
}

const SHOT_FX_HOOKS = [
  [`// A look for hits on enemies, installed at run time by another look
// (art/frisson/UI-SOUND.md section 2.1): style[kind] is a recipe for
// 'zombie', 'kill' or 'headshot', with an optional .blow (a melee blow that
// did not kill) and .raider (a living enemy). Without a recipe, and always
// while the style is null, the bursts below are drawn exactly as before.
// A burst also hears which way the blow went (dirX, dirZ) and, for a kill
// drawn at the body's middle, the enemy's crown (top, a world height): only
// a look reads them.
let impactStyle = null;
export function setImpactStyle(style = null) { impactStyle = style && typeof style === 'object' ? style : null; }
export function getImpactStyle() { return impactStyle; }

`, ''],
  ["export function impactBurst(point, { kind = 'solid', direction = null, time = 0, kill = true, raider = false, dirX = 0, dirZ = 0, top = null } = {}) {", "export function impactBurst(point, { kind = 'solid', direction = null, time = 0 } = {}) {"],
  ['  if (impactStyle?.[kind]) { styledImpact(impactStyle[kind], point, direction, time, kill, raider, dirX, dirZ, top); return; }\n', ''],
  [`
// A styled burst, in the Famille formulas: a flash, embers flying back along
// the shot, then the dark layers (ash, and grit rising by \`lift\`) in the
// alpha-blended smoke pool, since the additive pools can only add light.
// A kill burst drawn at the body's middle (one given its crown, \`top\`) would
// stay hidden in the torso: the recipe's \`front\` brings it out of the body
// toward the killer (against dirX, dirZ), \`under\` keeps it on a body lower
// than the kill's 1 m (a crawler), and the grit rises from the crown.
// Embers start a little apart (\`jitter\`) and may kindle as they fly out
// (\`fadeIn\`), so their additive light never piles into a hot core. Scratch
// vectors and positional arguments: nothing allocated per hit beyond the
// particle options Famille passes too.
const styledBack = new THREE.Vector3(), styledAt = new THREE.Vector3();
function styledImpact(own, point, direction, time, kill, raider, dirX, dirZ, top) {
  // A living enemy's recipe first, then a blow that did not kill (each may have its own).
  const base = raider && own.raider ? own.raider : own, recipe = kill === false && base.blow ? base.blow : base;
  const fx = sharedEffects(), back = direction ? styledBack.set(-direction.x, -direction.y, -direction.z).normalize() : styledBack.set(0, 1, 0);
  const whole = Number.isFinite(top), away = whole && recipe.front && Number.isFinite(dirX) && Number.isFinite(dirZ) ? Math.hypot(dirX, dirZ) : 0, reach = away > 1e-6 ? recipe.front / away : 0;
  const at = whole ? styledAt.set(point.x - (reach && dirX * reach), Math.min(point.y, top - (recipe.under ?? 0)), point.z - (reach && dirZ * reach)) : point;
  const { flash, embers, ash, grit } = recipe;
  if (flash) fx.glow({ start: time, life: flash.life, x: at.x, y: at.y, z: at.z, size: flash.size[0], sizeTo: flash.size[1], color: flash.color, colorTo: flash.colorTo, intensity: flash.intensity, fadeOut: .3 });
  const jitter = embers?.jitter ?? 0;
  for (let index = 0; index < (embers?.count ?? 0); index++) {
    const speed = embers.speed[0] + fx.random() * (embers.speed[1] - embers.speed[0]);
    const vx = back.x * .8 + fx.spread(1), vy = back.y * .8 + fx.spread(1) + embers.up, vz = back.z * .8 + fx.spread(1);
    fx.streak({ start: time, life: embers.life[0] + fx.random() * (embers.life[1] - embers.life[0]), x: at.x + (jitter && fx.spread(jitter)), y: at.y + (jitter && fx.spread(jitter)), z: at.z + (jitter && fx.spread(jitter)),
      vx: vx * speed, vy: vy * speed, vz: vz * speed, gravity: embers.gravity, drag: embers.drag, size: embers.size[0], sizeTo: embers.size[1], color: embers.color, colorTo: embers.colorTo, colorSpeed: 2.5,
      intensity: embers.intensity, trail: embers.trail, fadeIn: embers.fadeIn ?? 0, fadeOut: .6 });
  }
  if (ash) styledSmoke(fx, ash, at, back, time, 0);
  // The bone dust rises above the head itself: from the crown when it is known.
  if (grit) styledSmoke(fx, grit, point, back, time, (whole ? top - point.y : 0) + (grit.lift ?? 0));
}
function styledSmoke(fx, layer, point, back, time, lift) {
  const jitter = layer.jitter ?? 0;
  for (let index = 0; index < layer.count; index++) {
    fx.smoke({ start: time, life: layer.life[0] + fx.random() * (layer.life[1] - layer.life[0]),
      x: point.x + fx.spread(jitter), y: point.y + lift + fx.spread(jitter), z: point.z + fx.spread(jitter),
      vx: back.x * layer.vx + fx.spread(layer.spread), vy: layer.vy[0] + fx.random() * (layer.vy[1] - layer.vy[0]), vz: back.z * layer.vx + fx.spread(layer.spread),
      drag: layer.drag, gravity: layer.gravity ?? 0, size: layer.size[0], sizeTo: layer.size[1] + fx.random() * (layer.size[2] - layer.size[1]),
      color: layer.color, colorTo: layer.colorTo, alpha: layer.alpha, fadeIn: .08, fadeOut: .35, rotation: fx.random() * 6, spin: fx.spread(1.5) });
  }
}
`, ''],
];
const ZOMBIE_HOOKS = [
  [`// An optional death look: style.poof(appearance, kind, boss) returns
// { smoke, sparks } materials for the puff (sparks false hides the ring), or
// null for the storybook puff. The materials are the style's to free.
let deathStyle = null;
export function setDeathStyle(style = null) { deathStyle = style && typeof style === 'object' ? style : null; }
export function getDeathStyle() { return deathStyle; }
`, ''],
  ['    let own = null; try { own = deathStyle?.poof?.(appearance, d.kind, d.boss === true) ?? null; } catch {}\n', ''],
  ['own?.smoke || ', ''],
  ['own?.sparks || ', ''],
  ['    if (own?.sparks === false) sparks.visible = false;\n', ''],
];
const HUD_HOOKS = [
  [`  // An optional look, set at run time by another look: style.text(key,
  // params) answers a line or null, style.popupFrames(flight, rise) the score
  // popup's keyframes or null. Anything else, a throw included, keeps the
  // lines and frames below; with no style, say() is the very same t() call.
  let style = null;
`, ''],
  ["  const say = (key, params) => { let own = null; try { own = style?.text?.(key, params ?? {}) ?? null; } catch {} return typeof own === 'string' ? own : t(key, params); };\n", ''],
  ['  const framesOf = (flight, rise) => { let own = null; try { own = style?.popupFrames?.(flight, rise) ?? null; } catch {} return Array.isArray(own) ? own : null; };\n', ''],
  ["label.textContent = say('feedback.headshot');", "label.textContent = t('feedback.headshot');"],
  ["parts.push(say('feedback.chainCount', { count }));", "parts.push(t('feedback.chainCount', { count }));"],
  ["parts.push(say('feedback.chainBonus', { points: bonus }));", "parts.push(t('feedback.chainBonus', { points: bonus }));"],
  ['strong.textContent = say(labelKey);', 'strong.textContent = t(labelKey);'],
  ["line.textContent = say('feedback.teammateChain', { name, label: say(labelKey) });", "line.textContent = t('feedback.teammateChain', { name, label: t(labelKey) });"],
  // The flight's frames moved into flightFrames (owner, 18 October), shared
  // with the revive bonuses and the impact numbers; Famille's are popupKeyframes.
  ['    return framesOf(flight, rise) ?? popupKeyframes(flight, rise);', '    return popupKeyframes(flight, rise);'],
  [`  // Never touches the DOM: the next line, popup or banner takes the look.
  function setStyle(next = null) {
    style = next && typeof next === 'object' ? next : null;
    return style;
  }

`, ''],
  ['    get style() { return style; },\n', ''],
  ['bindSettings, setStyle,', 'bindSettings,'],
];

const fxModule = await importPublicModule('fx.js');
const shotFx = await importPublicModule('shot-fx.js');
const zombies = await importPublicModule('zombies.js');
const hudModule = await importPublicModule('feedback-hud.js');
const i18n = await importPublicModule('i18n.js');
const part = await importPublicModule('frisson/feedback.js');
const { WORDS, IMPACT_STYLE, FEEDBACK_STYLE } = part;
const stripped = {
  shotFx: await importPublicSource(strip(read('shot-fx.js'), SHOT_FX_HOOKS, 'shot-fx.js'), { name: 'shot-fx.js' }),
  zombies: await importPublicSource(strip(read('zombies.js'), ZOMBIE_HOOKS, 'zombies.js'), { name: 'zombies.js' }),
  hud: await importPublicSource(strip(read('feedback-hud.js'), HUD_HOOKS, 'feedback-hud.js'), { name: 'feedback-hud.js' }),
};

test('each stripped copy has no hook left', () => {
  const shot = strip(read('shot-fx.js'), SHOT_FX_HOOKS, 'shot-fx.js'), zombie = strip(read('zombies.js'), ZOMBIE_HOOKS, 'zombies.js'), hud = strip(read('feedback-hud.js'), HUD_HOOKS, 'feedback-hud.js');
  assert.doesNotMatch(shot, /impactStyle|styledImpact|styledSmoke|styledBack|styledAt|kill = true|dirX = 0/);
  assert.doesNotMatch(zombie, /deathStyle|own\?\./);
  assert.doesNotMatch(hud, /\bsay\(|framesOf|setStyle|let style|const own/);
});

// --- Impact bursts (UI-SOUND.md 2.1, 4.3) ---------------------------------------
// Every particle and every random draw, from seeded stubs on the shared engine
// that both shot-fx.js copies use.
function recording(run, seed = 20261014) {
  const fx = fxModule.sharedEffects(), saved = { glow: fx.glow, streak: fx.streak, smoke: fx.smoke, random: fx.random, spread: fx.spread };
  const calls = [];
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; calls.push(['random']); return state / 4294967296; };
  Object.assign(fx, { random, spread: amount => (random() - .5) * 2 * amount });
  for (const pool of ['glow', 'streak', 'smoke']) fx[pool] = options => { calls.push([pool, { ...options }]); return {}; };
  try { run(); } finally { Object.assign(fx, saved); }
  return calls;
}
const POINT = Object.freeze({ x: 1.5, y: 1.2, z: -2.5 });
const DIRECTIONS = [null, new THREE.Vector3(.3, -.2, -1)];
const OPTIONS = [{}, { kill: false }, { raider: true }, { kill: false, raider: true }, { kill: true, raider: false }, { dirX: .6, dirZ: -.8, top: 2.4 }, { kill: false, dirX: -1, dirZ: 0 }, { raider: true, dirX: 0, dirZ: 1, top: 1.8 }];
const KINDS = ['wood', 'solid', 'zombie', 'kill', 'headshot', 'mystery'];
const everyBurst = module => () => {
  for (const kind of KINDS) for (const direction of DIRECTIONS) for (const options of OPTIONS) module.impactBurst(POINT, { kind, direction, time: .5, ...options });
  module.impactBurst(POINT, {}); module.impactBurst(null, { kind: 'kill' }); module.impactBurst({ x: NaN, y: 0, z: 0 }, { kind: 'kill' });
};

test('with no impact style, every burst is drawn exactly as before the hook (particles and random draws)', () => {
  assert.equal(shotFx.getImpactStyle(), null, 'Famille is the default');
  const before = recording(everyBurst(stripped.shotFx));
  assert.ok(before.length > 1000);
  assert.deepEqual(recording(everyBurst(shotFx)), before, 'style null');
  shotFx.setImpactStyle(IMPACT_STYLE); shotFx.setImpactStyle(null);
  assert.deepEqual(recording(everyBurst(shotFx)), before, 'after the style was set and cleared');
  for (const junk of [{}, 'x', 7, null, undefined]) { shotFx.setImpactStyle(junk); assert.deepEqual(recording(everyBurst(shotFx)), before, `style ${JSON.stringify(junk)}`); }
  shotFx.setImpactStyle(null);
  assert.equal(shotFx.getImpactStyle(), null);
});

test('with the Frisson style, kinds without a recipe (wood, solid, unknown) are untouched', () => {
  const run = module => () => { for (const kind of ['wood', 'solid', 'mystery']) for (const direction of DIRECTIONS) for (const options of OPTIONS) module.impactBurst(POINT, { kind, direction, time: .5, ...options }); };
  const before = recording(run(stripped.shotFx));
  shotFx.setImpactStyle(IMPACT_STYLE);
  try { assert.deepEqual(recording(run(shotFx)), before); } finally { shotFx.setImpactStyle(null); }
});

const pools = calls => ({ glow: calls.filter(([pool]) => pool === 'glow'), streak: calls.filter(([pool]) => pool === 'streak'), smoke: calls.filter(([pool]) => pool === 'smoke') });
const particles = calls => calls.filter(([pool]) => pool !== 'random').length;
// The events of section 2.1: [name, kind, options, Frisson count by pool].
// The kill bursts grew after review (feedback.js: the brief's kill drew fewer
// pixels than a bullet hit), still far under Famille's 31 and 42.
const EVENTS = [
  ['bullet hit', 'zombie', {}, { glow: 1, streak: 3, smoke: 2 }],
  ['kill', 'kill', {}, { glow: 1, streak: 9, smoke: 4 }],
  ['melee blow', 'kill', { kill: false }, { glow: 1, streak: 4, smoke: 2 }],
  ['head-shot kill', 'headshot', {}, { glow: 1, streak: 10, smoke: 9 }],
  ['raider hit', 'zombie', { raider: true }, { glow: 1, streak: 0, smoke: 3 }],
  ['raider kill', 'kill', { raider: true }, { glow: 1, streak: 0, smoke: 4 }],
  ['raider blow', 'kill', { kill: false, raider: true }, { glow: 1, streak: 0, smoke: 3 }],
  ['raider head shot', 'headshot', { raider: true }, { glow: 1, streak: 0, smoke: 4 }],
];
const green = hex => (hex >> 8) & 0xff;

test('the Frisson bursts: the counts of section 2.1, never more than Famille, dim embers, dark layers in the smoke pool', () => {
  shotFx.setImpactStyle(IMPACT_STYLE);
  try {
    for (const [name, kind, options, expected] of EVENTS) for (const direction of DIRECTIONS) {
      const calls = recording(() => shotFx.impactBurst(POINT, { kind, direction, time: .5, ...options }));
      const famille = recording(() => stripped.shotFx.impactBurst(POINT, { kind, direction, time: .5 }));
      const { glow, streak, smoke } = pools(calls);
      assert.deepEqual({ glow: glow.length, streak: streak.length, smoke: smoke.length }, expected, name);
      assert.ok(particles(calls) <= particles(famille), `${name}: ${particles(calls)} particles, Famille ${particles(famille)}`);
      // One flash only: no pops, ring or stars. Additive light is a dim red,
      // never gold or white, and never brighter than Famille's.
      for (const [, particle] of [...glow, ...streak]) {
        for (const hex of [particle.color, particle.colorTo]) assert.ok(green(hex) <= 0x60, `${name}: additive colour ${hex.toString(16)}`);
        assert.ok(particle.intensity <= 1, `${name}: intensity ${particle.intensity}`);
      }
      const ash = smoke.filter(([, particle]) => particle.vy < 1), grit = smoke.filter(([, particle]) => particle.vy >= 1);
      for (const [, particle] of ash) assert.ok([0x2c2622, 0x9c9a94].includes(particle.color), `${name}: ash colour ${particle.color.toString(16)}`);
      if (kind === 'headshot' && !options.raider) {
        // The jet of bone dust: straight up at 2.2 to 3.2 m/s, just over the
        // burst when no crown is given (the brief's + .05).
        assert.equal(grit.length, 6, name);
        const lift = IMPACT_STYLE.headshot.grit.lift;
        assert.equal(lift, .05);
        for (const [, particle] of grit) {
          assert.ok(particle.vy >= 2.2 && particle.vy <= 3.2, `grit vy ${particle.vy}`);
          assert.ok(Math.abs(particle.vx) <= .5 && Math.abs(particle.vz) <= .5);
          assert.ok(Math.abs(particle.y - (POINT.y + lift)) < 1e-12 && particle.x === POINT.x && particle.z === POINT.z);
          assert.equal(particle.color, 0xa89f8e); assert.equal(particle.gravity, 6);
        }
      } else assert.equal(grit.length, 0, name);
      if (options.raider) for (const [, particle] of smoke) assert.equal(particle.color, 0x9c9a94, `${name}: Famille's solid dust`);
    }
    // The Famille counts the brief compares against.
    const famille = kind => particles(recording(() => stripped.shotFx.impactBurst(POINT, { kind, time: .5 })));
    assert.deepEqual([famille('zombie'), famille('kill'), famille('headshot')], [15, 31, 42]);
  } finally { shotFx.setImpactStyle(null); }
});

test('a kill given its crown comes out of the body toward the killer, and the head-shot jet rises from the crown', () => {
  shotFx.setImpactStyle(IMPACT_STYLE);
  try {
    // The kill event's point (feet + 1) on a walker (crown 1.82), a brute (2.22) and a crawler (.82), shot along (.6, -.8).
    for (const [body, top] of [['walker', 1.82], ['brute', 2.22], ['crawler', .82]]) for (const kind of ['kill', 'headshot']) {
      const calls = recording(() => shotFx.impactBurst(POINT, { kind, time: .5, dirX: .6 * 3, dirZ: -.8 * 3, top: POINT.y - 1 + top }));
      const { glow, streak, smoke } = pools(calls), recipe = IMPACT_STYLE[kind], height = Math.min(POINT.y, POINT.y - 1 + top - recipe.under);
      const flash = glow[0][1];
      assert.ok(Math.abs(flash.x - (POINT.x - .6 * recipe.front)) < 1e-9 && Math.abs(flash.z - (POINT.z + .8 * recipe.front)) < 1e-9, `${body} ${kind}: ${recipe.front} m toward the killer`);
      assert.ok(Math.abs(flash.y - height) < 1e-9, `${body} ${kind}: on the body (${flash.y})`);
      for (const [, ember] of streak) assert.ok(Math.hypot(ember.x - flash.x, ember.y - flash.y, ember.z - flash.z) <= Math.sqrt(3) * recipe.embers.jitter + 1e-9, `${body} ${kind}: embers start around the flash`);
      const grit = smoke.filter(([, particle]) => particle.vy >= 1);
      assert.equal(grit.length, kind === 'headshot' ? 6 : 0);
      for (const [, particle] of grit) assert.ok(Math.abs(particle.y - (POINT.y - 1 + top + recipe.grit.lift)) < 1e-9 && particle.x === POINT.x && particle.z === POINT.z, `${body}: the jet starts on the crown`);
    }
    // No crown (a melee blow at the body's face, a bullet hit): drawn where it struck.
    for (const [kind, options] of [['kill', { kill: false, dirX: 1, dirZ: 0 }], ['kill', { dirX: 1, dirZ: 0 }], ['zombie', { dirX: 1, dirZ: 0 }], ['kill', { dirX: NaN, dirZ: 0, top: 2 }]]) {
      const flash = pools(recording(() => shotFx.impactBurst(POINT, { kind, time: .5, ...options }))).glow[0][1];
      assert.deepEqual([flash.x, flash.z], [POINT.x, POINT.z], JSON.stringify(options));
    }
  } finally { shotFx.setImpactStyle(null); }
});

test('the impact recipes are frozen through and through', () => {
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value), path);
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(IMPACT_STYLE, 'IMPACT_STYLE');
  walk(WORDS, 'WORDS');
  assert.ok(Object.isFrozen(FEEDBACK_STYLE));
  assert.deepEqual(Object.keys(IMPACT_STYLE).sort(), ['headshot', 'kill', 'zombie']);
});

// --- Death puff (UI-SOUND.md 2.2, 4.4) ------------------------------------------
const CAST = [['walker', false, 80, 'z3'], ['walker', false, 230, 'z11'], ['runner', false, 165, 'z12'], ['crawler', false, 104, 'z14'], ['armored', false, 230, 'z15'], ['brute', false, 1000, 'z16'], ['brute', true, 6000, 'z17']];
function puff(module, [kind, boss, hp, id]) {
  const group = module.createZombie(kind, boss, hp, id);
  module.startZombieDeath(group, { time: 2, directionX: .6, directionZ: -.8, headshot: true });
  const poof = group.userData.poof;
  const look = mesh => ({ name: mesh.name, visible: mesh.visible, type: mesh.material.type, color: mesh.material.color.getHex(), toneMapped: mesh.material.toneMapped,
    material: mesh.material.name, vertices: mesh.geometry.attributes.position.count, position: mesh.position.toArray() });
  const result = { name: poof.group.name, visible: poof.group.visible, position: poof.group.position.toArray(), children: poof.group.children.map(child => child.name), smoke: look(poof.smoke), sparks: look(poof.sparks) };
  module.disposeZombie(group);
  return { result, poof };
}

test('with no death style, the puff is built exactly as before the hook', () => {
  assert.equal(zombies.getDeathStyle(), null, 'Famille is the default');
  for (const member of CAST) {
    const before = puff(stripped.zombies, member).result;
    assert.equal(before.sparks.visible, true);
    assert.deepEqual(puff(zombies, member).result, before, member.join('/'));
    // A style that answers null, or throws, is the storybook puff too.
    for (const style of [{ poof: () => null }, { poof: () => { throw new Error('broken look'); } }, { poof: 'not a function' }, {}]) {
      zombies.setDeathStyle(style);
      try { assert.deepEqual(puff(zombies, member).result, before, `${member.join('/')} through ${Object.keys(style)}`); } finally { zombies.setDeathStyle(null); }
    }
  }
});

test('the part\'s death style: one shared soot of Famille\'s program, the spark ring built but hidden, three positional arguments', () => {
  const calls = [];
  zombies.setDeathStyle({ poof: (...args) => { calls.push(args); return null; } });
  try { for (const member of CAST) puff(zombies, member); } finally { zombies.setDeathStyle(null); }
  assert.equal(calls.length, CAST.length);
  calls.forEach((args, index) => {
    const [kind, boss] = CAST[index];
    assert.equal(args.length, 3);
    assert.equal(typeof args[0].id, 'string'); assert.equal(args[1], kind); assert.equal(args[2], boss);
  });
  const handle = part.install({ THREE });
  try {
    const looks = CAST.map(member => puff(zombies, member)), famille = puff(stripped.zombies, CAST[0]).result;
    const soot = looks[0].poof.smoke.material;
    assert.ok(soot instanceof THREE.MeshLambertMaterial);
    assert.equal(soot.name, 'frisson:zombiePoofSmoke'); assert.equal(soot.color.getHex(), 0x2e2926);
    for (const { poof, result } of looks) {
      assert.equal(poof.smoke.material, soot, 'one shared material');
      assert.equal(result.sparks.visible, false); assert.equal(result.sparks.type, 'MeshBasicMaterial', 'the Famille ring, hidden');
      assert.equal(result.smoke.type, famille.smoke.type);
      assert.deepEqual({ ...result, smoke: { ...result.smoke, color: 0, material: '' }, sparks: { ...result.sparks, visible: true, color: 0 } },
        { ...famille, smoke: { ...famille.smoke, color: 0, material: '' }, sparks: { ...famille.sparks, color: 0 }, position: result.position }, 'same meshes, names and geometry');
    }
    // Same program as Famille's Lambert smoke: only the colour uniform differs.
    const familleSmoke = puff(stripped.zombies, CAST[0]).poof.smoke.material;
    for (const key of ['vertexColors', 'fog', 'transparent', 'flatShading', 'map', 'emissiveMap', 'side', 'toneMapped', 'wireframe']) assert.equal(soot[key], familleSmoke[key], key);
    assert.equal(soot.customProgramCacheKey(), familleSmoke.customProgramCacheKey());
    const answer = zombies.getDeathStyle().poof(), again = zombies.getDeathStyle().poof();
    assert.equal(answer, again, 'nothing allocated per death'); assert.ok(Object.isFrozen(answer));
  } finally { handle.uninstall(); }
});

// --- The feedback HUD (UI-SOUND.md 2.3-2.6, 4.5) -----------------------------------
function fakeElement(tag = 'div', log = null) {
  const classes = new Set();
  const element = {
    tagName: tag.toUpperCase(), children: [], parent: null, hidden: false, textContent: '', style: {}, offsetWidth: 0, animations: [],
    append(...nodes) { for (const node of nodes) { node.parent = element; element.children.push(node); } },
    remove() { if (!element.parent) return; const list = element.parent.children; list.splice(list.indexOf(element), 1); element.parent = null; },
    querySelector(selector) { return element.children.find(child => child.tagName === selector.toUpperCase()) ?? null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    animate(keyframes, options) { const entry = { keyframes: structuredClone(keyframes), options: { ...options } }; element.animations.push(entry); log?.push(entry); return {}; },
    set innerHTML(_) { throw new Error('innerHTML is forbidden'); },
  };
  Object.defineProperty(element, 'className', { get: () => [...classes].join(' '), set: value => { classes.clear(); for (const name of String(value).split(/\s+/)) if (name) classes.add(name); } });
  element.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) };
  return element;
}
function hudFor(module, t, { box = true } = {}) {
  let time = 0;
  const animations = [];
  const marker = fakeElement('div'); marker.className = 'hit-marker';
  const popupLayer = fakeElement('div'), chainBanner = fakeElement('div'), teamFeed = fakeElement('div');
  const scoreTarget = fakeElement('strong'), coinTarget = fakeElement('strong');
  scoreTarget.getBoundingClientRect = () => box ? { left: 1100, top: 120, width: 90, height: 38, right: 1190, bottom: 158 } : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  coinTarget.getBoundingClientRect = () => ({ left: 60, top: 600, width: 50, height: 25, right: 110, bottom: 625 });
  chainBanner.append(fakeElement('strong'), fakeElement('small'));
  const document = { createElement: tag => fakeElement(tag, animations) };
  const hud = module.createFeedbackHud({ document, marker, popupLayer, scoreTarget, coinTarget, chainBanner, teamFeed, t, storage: null, now: () => time });
  return { hud, marker, popupLayer, chainBanner, teamFeed, scoreTarget, coinTarget, animations, advance: ms => { time += ms; } };
}
const describeNode = node => ({ tag: node.tagName, className: node.className, hidden: node.hidden, text: node.textContent, left: node.style.left, top: node.style.top, children: node.children.map(describeNode) });
function view(env) {
  return { marker: describeNode(env.marker), popups: describeNode(env.popupLayer), banner: describeNode(env.chainBanner), team: describeNode(env.teamFeed), score: env.scoreTarget.className, coins: env.coinTarget.className, animations: env.animations.length };
}
// The scripted sequence of section 5.1, recorded after every step.
function play(module, t, { prepare = () => {}, box = true } = {}) {
  const env = hudFor(module, t, { box });
  prepare(env.hud);
  const log = [];
  const step = label => log.push([label, view(env)]);
  for (const kind of ['hit', 'headshot', 'kill', 'headshotKill']) { env.hud.hit(kind); step(kind); env.advance(60); env.hud.update(); }
  env.hud.score(25, { x: 640, y: 360 }); step('score');
  env.hud.score(100, { x: 650, y: 350, headshot: true }); step('head-shot score');
  env.hud.score(5, { x: 620, y: 380, coin: true }); step('coins');
  for (const [count, bonus] of [[2, 0], [5, 10], [8, 25], [30, 60], [75, 150]]) { env.hud.chain(count, { bonus, chainId: 4 }); step(`chain ${count}`); env.advance(100); env.hud.update(); }
  env.hud.chain(3, { name: 'Lou', chainId: 9 }); step('teammate');
  env.advance(1000); env.hud.update(); step('later');
  env.hud.clear(); step('clear');
  return { log, animations: env.animations };
}
const calls = [];
const recordingT = (key, params) => { calls.push([key, params]); return i18n.t(key, params); };

test('with no HUD style, the words, classes and popup keyframes are exactly as before the hook', () => {
  for (const language of ['fr', 'en']) for (const box of [true, false]) {
    i18n.setLanguage(language);
    calls.length = 0;
    const before = play(stripped.hud, recordingT, { box }), beforeCalls = structuredClone(calls);
    calls.length = 0;
    const now = play(hudModule, recordingT, { box });
    assert.deepEqual(now, before, `${language}, flight ${box}`);
    // The very same t() calls: same keys, same parameters, none added.
    assert.deepEqual(calls, beforeCalls);
    const cleared = play(hudModule, recordingT, { box, prepare: hud => { assert.equal(hud.setStyle(FEEDBACK_STYLE), FEEDBACK_STYLE); assert.equal(hud.setStyle(null), null); } });
    assert.deepEqual(cleared, before, `${language}: set then cleared`);
    for (const broken of [{ text: () => { throw new Error('x'); }, popupFrames: () => { throw new Error('x'); } }, { text: () => 42, popupFrames: () => 'frames' }, { text: () => null, popupFrames: () => null }, {}])
      assert.deepEqual(play(hudModule, recordingT, { box, prepare: hud => hud.setStyle(broken) }), before, `${language}: a broken style ${JSON.stringify(Object.keys(broken))}`);
    for (const junk of ['style', 3, null, undefined]) assert.deepEqual(play(hudModule, recordingT, { box, prepare: hud => assert.equal(hud.setStyle(junk), null) }), before);
  }
  i18n.setLanguage('fr');
});

test('with the Frisson HUD style, the words of section 2.6 in French and English', () => {
  for (const language of ['fr', 'en']) {
    i18n.setLanguage(language);
    const words = WORDS[language];
    const env = hudFor(hudModule, i18n.t);
    assert.equal(env.hud.style, null);
    env.hud.setStyle(FEEDBACK_STYLE);
    assert.equal(env.hud.style, FEEDBACK_STYLE);
    env.hud.score(100, { x: 600, y: 300, headshot: true });
    assert.equal(env.popupLayer.children[0].children[0].textContent, words['feedback.headshot']);
    for (const [count, bonus, step] of [[2, 0, 2], [3, 0, 3], [5, 10, 5], [8, 25, 8], [12, 30, 12], [30, 60, 30], [75, 150, 75]]) {
      env.hud.chain(count, { bonus, chainId: 1 });
      const [strong, small] = env.chainBanner.children;
      assert.equal(strong.textContent, words[`feedback.chain${step}`], `${language} ${count}`);
      const parts = [];
      if (count >= 5) parts.push(words['feedback.chainCount'].replace('{count}', count));
      if (bonus > 0) parts.push(words['feedback.chainBonus'].replace('{points}', bonus));
      assert.equal(small.textContent, parts.join(' · '));
    }
    assert.equal(env.chainBanner.children[1].textContent, language === 'fr' ? '75 ABATTUS · SÉRIE +150' : '75 PUT DOWN · STREAK +150');
    env.hud.chain(3, { name: 'Lou', chainId: 9 });
    assert.equal(env.teamFeed.children[0].textContent, `Lou · ${words['feedback.chain3']}`, 'the teammate line keeps its Famille frame, with the Frisson ladder word');
    // The results line (client.js hudText) and a key without Frisson words.
    const player = { name: 'Lou', kills: 12, score: 340 };
    assert.equal(FEEDBACK_STYLE.text('results.player', player), language === 'fr' ? '12 élim. · 340 pts' : '12 kills · 340 pts');
    assert.equal(FEEDBACK_STYLE.text('feedback.teammateChain', { name: 'x', label: 'y' }), null);
    assert.equal(FEEDBACK_STYLE.text('toString'), null);
    assert.equal(FEEDBACK_STYLE.text('results.player', Object.create({ kills: 1, score: 2 })), words['results.player'], 'own properties only');
  }
  i18n.setLanguage('fr');
});

const scales = frame => [...frame.transform.matchAll(/scale\(([\d.]+)\)/g)].map(match => Number(match[1]));
test('the Frisson popup frames: no scale above 1, a stepped start, the same arc as Famille', () => {
  for (const box of [true, false]) {
    const famille = hudFor(stripped.hud, i18n.t, { box }), frisson = hudFor(hudModule, i18n.t, { box });
    frisson.hud.setStyle(FEEDBACK_STYLE);
    for (const env of [famille, frisson]) { env.hud.score(25, { x: 640, y: 360 }); env.hud.score(100, { x: 640, y: 360, headshot: true }); }
    assert.equal(frisson.animations.length, 2);
    frisson.animations.forEach(({ keyframes, options }, index) => {
      const before = famille.animations[index];
      assert.deepEqual(options, before.options, 'same duration and fill');
      assert.ok(keyframes.flatMap(scales).every(value => value <= 1), JSON.stringify(keyframes));
      assert.equal(keyframes[0].easing, 'steps(2,end)');
      assert.equal(keyframes.length, before.keyframes.length);
      const tail = box ? 2 : 1;
      assert.deepEqual(keyframes.slice(-tail), before.keyframes.slice(-tail), box ? 'the arc frames' : 'the fade frame');
      assert.deepEqual(keyframes.map(frame => frame.offset), before.keyframes.map(frame => frame.offset));
    });
  }
});

// --- Words (UI-SOUND.md 2.6) --------------------------------------------------------
// The placeholders of each key, as the brief's last column lists them.
const PLACEHOLDERS = {
  'feedback.chain2': [], 'feedback.chain3': [], 'feedback.chain4': [], 'feedback.chain5': [], 'feedback.chain6': [], 'feedback.chain8': [],
  'feedback.chain10': [], 'feedback.chain12': [], 'feedback.chain15': [], 'feedback.chain20': [], 'feedback.chain25': [], 'feedback.chain30': [],
  'feedback.chain40': [], 'feedback.chain50': [], 'feedback.chain75': [], 'feedback.chain100': [],
  'feedback.chainCount': ['count'], 'feedback.chainBonus': ['points'], 'feedback.headshot': [], 'results.player': ['kills', 'score'],
};
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('the words: the same keys in both languages, a word for every chain step, the placeholders of the table, no shout, no star, nothing crude', () => {
  assert.deepEqual(Object.keys(WORDS).sort(), ['en', 'fr']);
  assert.deepEqual(Object.keys(WORDS.fr), Object.keys(WORDS.en));
  assert.deepEqual(Object.keys(WORDS.fr).sort(), Object.keys(PLACEHOLDERS).sort());
  for (const step of hudModule.CHAIN_STEPS) assert.ok(WORDS.fr[`feedback.chain${step}`] && WORDS.en[`feedback.chain${step}`], `step ${step}`);
  for (const language of ['fr', 'en']) {
    const ladder = hudModule.CHAIN_STEPS.map(step => WORDS[language][`feedback.chain${step}`]);
    assert.equal(new Set(ladder).size, ladder.length, `${language}: no two steps share a name`);
    for (const [key, text] of Object.entries(WORDS[language])) {
      assert.equal(typeof text, 'string');
      assert.deepEqual(placeholders(text), [...PLACEHOLDERS[key]].sort(), `${language} ${key}`);
      assert.doesNotMatch(text, /[!★☠]/u, `${language} ${key}`);
      assert.doesNotMatch(text, /sang|blood|tripe|guts|cervelle|brain|boucher|butcher|viscère|gore|merde|shit|putain|fuck/i, `${language} ${key}`);
      assert.equal(text, text.trim());
    }
  }
  // The Famille keys carry the same placeholders (results.player is a client.js template: {kills}, {score}).
  for (const key of Object.keys(PLACEHOLDERS).filter(key => key !== 'results.player')) {
    i18n.setLanguage('fr'); assert.deepEqual(placeholders(i18n.t(key)), [...PLACEHOLDERS[key]].sort(), key);
  }
});

// --- feedback.css (UI-SOUND.md 2.3-2.5, 4.7) --------------------------------------------
// Rules as { selectors, body, media, keyframes } (comments dropped; nested @media walked).
function cssRules(text) {
  const rules = [];
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (block, media) => {
    let at = 0;
    while (at < block.length) {
      const open = block.indexOf('{', at);
      if (open < 0) { assert.equal(block.slice(at).trim(), '', 'nothing outside a rule'); break; }
      let depth = 1, close = open + 1;
      for (; close < block.length && depth; close++) depth += block[close] === '{' ? 1 : block[close] === '}' ? -1 : 0;
      const prelude = block.slice(at, open).trim(), body = block.slice(open + 1, close - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else if (prelude.startsWith('@keyframes')) rules.push({ keyframes: prelude.slice(10).trim(), body, media });
      else rules.push({ selectors: prelude.split(',').map(selector => selector.trim().replace(/\s+/g, ' ')), body, media });
      at = close;
    }
  };
  walk(source, null);
  return rules;
}
const FEEDBACK_CSS = read('frisson/feedback.css'), STYLE_CSS = read('style.css');
// Selectors style.css lacks: each refines one it has (a class added to a compound).
const ALLOW = ['.score-popup.headshot small'];
const REDUCED = '@media (prefers-reduced-motion: reduce){.hit-marker,.hit-marker::after,.chain-banner,.chain-banner strong,.team-chain{animation:none!important}}';

test('feedback.css restyles only selectors of style.css, keeps the cascade, stops for reduced motion and loads nothing', () => {
  const famille = new Set(cssRules(STYLE_CSS).flatMap(rule => rule.selectors ?? []));
  const rules = cssRules(FEEDBACK_CSS), styled = rules.filter(rule => rule.selectors);
  assert.ok(styled.length >= 30);
  for (const selector of styled.flatMap(rule => rule.selectors)) {
    if (famille.has(selector)) continue;
    assert.ok(ALLOW.includes(selector), `${selector} is not a style.css selector`);
    const compounds = selector.split(' ');
    const classes = compounds.flatMap((compound, index) => [...compound.matchAll(/\.[\w-]+/g)].map(match => [index, match[0]]));
    assert.ok(classes.some(([index, name]) => famille.has([...compounds.slice(0, index), compounds[index].replace(name, ''), ...compounds.slice(index + 1)].join(' '))),
      `${selector} refines a selector style.css styles`);
  }
  // Class chain-6 is set for every count of 6 and more: a size rule for
  // chain-5/chain-6 would shrink tiers 3-6 to 46 px.
  for (const rule of styled) if (rule.selectors.some(selector => /^\.chain-banner\.chain-[56] strong$/.test(selector))) assert.doesNotMatch(rule.body, /font-size/);
  for (const rule of styled) if (rule.selectors.includes('.chain-banner strong')) assert.doesNotMatch(rule.body, /font-size/, 'tiers 1-2 keep their Famille sizes');
  // Every new animation stops under reduced motion.
  assert.ok(FEEDBACK_CSS.includes(REDUCED));
  const reduced = rules.filter(rule => rule.media?.includes('prefers-reduced-motion')).flatMap(rule => rule.selectors);
  assert.deepEqual(reduced, ['.hit-marker', '.hit-marker::after', '.chain-banner', '.chain-banner strong', '.team-chain']);
  const animated = styled.filter(rule => !rule.media && /(^|;)\s*animation\s*:/.test(rule.body));
  assert.ok(animated.length >= 8);
  for (const selector of animated.flatMap(rule => rule.selectors)) {
    const base = selector.replace(/\.(tier-\w+|chain-tier-\d|chain-\d)/g, '');
    assert.ok(reduced.includes(base), `${selector} (${base}) under reduced motion`);
  }
  // Nothing external, no star, no rotation, no wobble.
  assert.doesNotMatch(FEEDBACK_CSS, /★|@import|rotate|cubic-bezier/);
  for (const [, quote, target] of FEEDBACK_CSS.matchAll(/url\(\s*(['"]?)([^'")]{0,12})/g)) assert.match(target, /^data:/, `url(${quote}${target}`);
  // The flicker: four steps at most, never under .75.
  const flicker = rules.find(rule => rule.keyframes === 'frisson-flicker');
  assert.ok(flicker);
  const opacities = [...flicker.body.matchAll(/opacity:([\d.]+)/g)].map(match => Number(match[1]));
  assert.ok(opacities.every(value => value >= .75)); assert.ok(opacities.filter(value => value < 1).length <= 4);
  // The chain words: bone to rust to a deep red, no blue or violet, no stop
  // darker than #7a1410, and the bone hairline from tier 3 on.
  for (const tier of [1, 3, 4, 5, 6]) {
    const rule = styled.find(item => item.selectors.includes(tier === 1 ? '.chain-banner strong' : `.chain-banner.chain-tier-${tier} strong`));
    if (tier > 1) assert.match(rule.body, /-webkit-text-stroke:\.5px #d8cfbd66/);
    const stops = [.../linear-gradient\(([^)]*)\)/.exec(rule.body)[1].matchAll(/#([0-9a-f]{6})/gi)].map(match => parseInt(match[1], 16));
    assert.ok(stops.length >= 2);
    for (const hex of stops) {
      const r = hex >> 16, g = (hex >> 8) & 255, b = hex & 255;
      assert.ok(b <= r && g <= r, `tier ${tier}: ${hex.toString(16)} is neither blue nor violet`);
      assert.ok(luminance(hex) >= luminance(0x7a1410), `tier ${tier}: ${hex.toString(16)} is not darker than #7a1410`);
    }
  }
  // The keyframes keep the centring (the flicker moves the word inside the banner).
  for (const rule of rules.filter(item => item.keyframes?.startsWith('frisson-') && item.keyframes !== 'frisson-flicker'))
    for (const [, frame] of rule.body.matchAll(/transform:([^;}]+)/g)) assert.match(frame, /^translate\(-50%,-50%\)/, `${rule.keyframes}: ${frame}`);
});
const linear = channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const luminance = hex => .2126 * linear(hex >> 16) + .7152 * linear((hex >> 8) & 255) + .0722 * linear(hex & 255);

// The skull: 11 rectangles of a 7 x 7 pixel picture with two equal eyes.
const SKULL = ['.#####.', '#######', '#..#..#', '#..#..#', '###.###', '.#####.', '.#.#.#.'];
test('the pixel skull is the brief\'s 7 x 7 picture, as an inline SVG, with two equal eye holes', () => {
  const uris = [...FEEDBACK_CSS.matchAll(/url\("(data:image\/svg\+xml,[^"]+)"\)/g)].map(match => match[1]);
  assert.equal(uris.length, 2, 'the score panel and the wave card');
  assert.equal(new Set(uris).size, 1);
  const svg = decodeURIComponent(uris[0].slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 7 7' shape-rendering='crispEdges'><path fill='#d8cfbd' d='([^']+)'\/><\/svg>$/);
  const d = /d='([^']+)'/.exec(svg)[1];
  const rects = [...d.matchAll(/M(\d) (\d)h(\d)v(\d)H(\d)z/g)];
  assert.equal(rects.length, 11); assert.equal(rects.map(match => match[0]).join(''), d, 'nothing but rectangles');
  const grid = Array.from({ length: 7 }, () => Array(7).fill('.'));
  for (const [, x, y, w, h, back] of rects) {
    assert.equal(Number(back), Number(x));
    for (let row = Number(y); row < Number(y) + Number(h); row++) for (let column = Number(x); column < Number(x) + Number(w); column++) {
      assert.equal(grid[row][column], '.', 'no overlap'); grid[row][column] = '#';
    }
  }
  assert.deepEqual(grid.map(row => row.join('')), SKULL);
  // Holes: empty cells not reached from the border.
  const seen = grid.map(row => row.map(() => false)), holes = [];
  const fill = (row, column) => { const stack = [[row, column]], cells = []; while (stack.length) { const [r, c] = stack.pop(); if (r < 0 || c < 0 || r > 6 || c > 6 || seen[r][c] || grid[r][c] === '#') continue; seen[r][c] = true; cells.push([r, c]); stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]); } return cells; };
  for (let index = 0; index < 7; index++) for (const [r, c] of [[0, index], [6, index], [index, 0], [index, 6]]) fill(r, c);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (!seen[r][c] && grid[r][c] === '.') holes.push(fill(r, c));
  const eyes = holes.filter(cells => cells.every(([r]) => r < 4));
  assert.equal(eyes.length, 2);
  assert.equal(eyes[0].length, eyes[1].length); assert.equal(eyes[0].length, 4);
});

// --- Allocation (UI-SOUND.md F1, F10) ----------------------------------------------------
// V8's sampling heap profiler, minor and major collections included, adds up
// the bytes each function allocates itself (its callees count apart). The
// smallest object is 16 bytes: allocating one per call shows at least that
// many bytes per call, so a function staying under 1 byte per call
// allocates nothing per call (what is left is the profiler's own noise).
async function allocated(run, warm = run) {
  warm();
  const session = new inspector.Session();
  session.connect();
  try {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    run();
    const { profile } = await session.post('HeapProfiler.stopSampling');
    const bytes = new Map();
    const walk = node => { bytes.set(node.callFrame.functionName, (bytes.get(node.callFrame.functionName) ?? 0) + node.selfSize); node.children.forEach(walk); };
    walk(profile.head);
    return (...names) => names.reduce((sum, name) => sum + (bytes.get(name) ?? 0), 0);
  } finally { await session.post('HeapProfiler.disable').catch(() => {}); session.disconnect(); }
}
// The shared engine's pools and draws, as no-ops: what is left is what the burst code itself allocates.
function quietFx(run) {
  const fx = fxModule.sharedEffects(), saved = { glow: fx.glow, streak: fx.streak, smoke: fx.smoke, random: fx.random, spread: fx.spread };
  let state = 7;
  Object.assign(fx, { glow: () => null, streak: () => null, smoke: () => null, random: () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296, spread: amount => amount * .5 });
  try { run(); } finally { Object.assign(fx, saved); }
}

test('the hooks allocate nothing on the Famille path, and the Frisson bursts no more than Famille\'s', async () => {
  // The HUD: say() and framesOf() with no style, over many lines and popups.
  const constant = () => 'x', env = hudFor(hudModule, constant);
  let chainId = 0;
  const lines = count => { for (let index = 0; index < count; index++) { env.hud.chain(5, { bonus: 10, chainId: ++chainId }); env.hud.chain(3, { name: 'Lou', chainId }); env.hud.score(10, { x: 1, y: 2, headshot: true }); } };
  // Warmed well past the JIT's tiering, whose one-off code would otherwise
  // land in say() now and then (54 and 19 kB in two runs of three, 14 October).
  const hud = await allocated(() => lines(6000), () => { for (let pass = 0; pass < 4; pass++) lines(6000); });
  assert.ok(hud('say') + hud('framesOf') < 18000, `say ${hud('say')} B, framesOf ${hud('framesOf')} B over 18,000 lines and 6,000 popups`);
  assert.ok(hud('chain') > 100000, `the measure sees the Famille allocations around them (${hud('chain')} B)`);
  // The part's death look: one shared answer for every death.
  const handle = part.install({ THREE });
  try {
    const poof = zombies.getDeathStyle().poof, appearance = { id: 'pale' };
    const deaths = await allocated(() => { for (let index = 0; index < 100000; index++) poof(appearance, 'walker', false); });
    assert.ok(deaths('poof') < 100000, `poof ${deaths('poof')} B over 100,000 deaths`);
  } finally { handle.uninstall(); }
  // The bursts: with no style the styled code never runs; with it, each
  // Frisson burst allocates less than its Famille one (fewer particles, one
  // scratch vector, positional arguments).
  for (const [kind, options] of [['zombie', {}], ['kill', {}], ['kill', { kill: false }], ['headshot', {}], ['headshot', { dirX: .6, dirZ: -.8, top: 2.2 }], ['kill', { raider: true, dirX: 1, dirZ: 0, top: 1.8 }]]) {
    const burst = () => quietFx(() => { for (let index = 0; index < 1500; index++) shotFx.impactBurst(POINT, { kind, direction: DIRECTIONS[1], time: .5, ...options }); });
    const famille = await allocated(burst);
    assert.equal(famille('styledImpact', 'styledSmoke'), 0, `${kind}: the styled path never runs without a style`);
    shotFx.setImpactStyle(IMPACT_STYLE);
    let frisson;
    try { frisson = await allocated(burst); } finally { shotFx.setImpactStyle(null); }
    const mine = frisson('impactBurst', 'styledImpact', 'styledSmoke'), theirs = famille('impactBurst');
    assert.ok(theirs > 100000, `${kind}: Famille's bursts measured (${theirs} B)`);
    assert.ok(mine < theirs, `${kind} ${JSON.stringify(options)}: Frisson ${mine} B, Famille ${theirs} B`);
  }
});

// --- The part (UI-SOUND.md 4.7) ---------------------------------------------------------
function fakeDocument() {
  const head = { children: [], appendChild(node) { node.parentNode = head; head.children.push(node); return node; }, removeChild(node) { head.children.splice(head.children.indexOf(node), 1); node.parentNode = null; } };
  return { head, createElement: tag => ({ tagName: tag, id: '', rel: '', href: '', parentNode: null, remove() { this.parentNode?.removeChild(this); } }), getElementById: id => head.children.find(node => node.id === id) ?? null };
}
const fakeHud = () => ({ style: null, setStyle(style) { this.style = style ?? null; return this.style; } });

test('the part installs and takes off only its own, with or without the HUD and three', () => {
  for (const [withHud, withThree] of [[true, true], [true, false], [false, true], [false, false]]) {
    const document = fakeDocument(), feedback = withHud ? fakeHud() : undefined;
    // A stale link from an earlier install is replaced, never doubled.
    document.head.appendChild({ id: 'frisson-feedback-css', parentNode: null, remove() { this.parentNode?.removeChild(this); } });
    const handle = part.install({ ...(withThree ? { THREE } : {}), ...(withHud ? { feedback } : {}), document, base: '/frisson/' });
    assert.equal(typeof handle.uninstall, 'function');
    assert.equal(shotFx.getImpactStyle(), IMPACT_STYLE);
    const death = zombies.getDeathStyle(), look = death.poof({}, 'walker', false);
    assert.equal(look.sparks, false);
    assert.equal(look.smoke?.isMeshLambertMaterial ?? null, withThree ? true : null);
    if (withHud) assert.equal(feedback.style, FEEDBACK_STYLE);
    const links = document.head.children.filter(node => node.id === 'frisson-feedback-css');
    assert.equal(links.length, 1); assert.equal(links[0].href, '/frisson/feedback.css'); assert.equal(links[0].rel, 'stylesheet');
    let disposed = 0; look.smoke?.addEventListener('dispose', () => disposed++);
    handle.uninstall();
    assert.equal(shotFx.getImpactStyle(), null); assert.equal(zombies.getDeathStyle(), null);
    if (withHud) assert.equal(feedback.style, null);
    assert.equal(document.head.children.length, 0, 'the link is detached');
    assert.equal(disposed, withThree ? 1 : 0);
    handle.uninstall();
    assert.equal(disposed, withThree ? 1 : 0, 'a second uninstall does nothing');
  }
  // Another look installed meanwhile is left alone.
  const feedback = fakeHud(), handle = part.install({ THREE, feedback });
  const other = { zombie: {} }, otherDeath = { poof: () => null }, otherHud = { text: () => null };
  shotFx.setImpactStyle(other); zombies.setDeathStyle(otherDeath); feedback.setStyle(otherHud);
  handle.uninstall();
  assert.equal(shotFx.getImpactStyle(), other); assert.equal(zombies.getDeathStyle(), otherDeath); assert.equal(feedback.style, otherHud);
  shotFx.setImpactStyle(null); zombies.setDeathStyle(null);
  // No document at all, as the real-pack test installs.
  part.install({}).uninstall();
  assert.equal(shotFx.getImpactStyle(), null);
});

test('the part imports only the three Famille modules it restyles, and no three', () => {
  const source = read('frisson/feedback.js');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]), ['../shot-fx.js', '../zombies.js', '../i18n.js']);
  assert.doesNotMatch(source, /\bimport\s*\(|fetch\(|three\.module/);
  assert.match(source, /\$\{base\}feedback\.css`/);
});
