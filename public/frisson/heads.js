// Frisson part: heads (art/frisson/DESIGN.md). Blender-modelled heads from
// heads.glb replace the storybook skulls through zombies.js setZombieStyle.
// Every zombie of a variant shares its three geometries; only the family
// skin, a detail and a glow material are drawn, so a head costs three draw
// calls and no upload. Raiders keep their Famille heads. The skin keeps the
// family colour (the toughness cue; palette.js gives its corpse version)
// times the grey of the model's shading, and stays the head's first child.
// No storybook hat: the hair and the skull are the silhouette. The family's
// head marks are cast onto each head (marks.js), and the overlord wears its
// crown on its own head instead of the storybook helmet and cage.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { headSurface, buildMarks, HEAD_MARKS } from './marks.js';
import { skinColor, clothColor } from './palette.js';
import { setZombieStyle, getZombieStyle, withRim, createZombie, disposeZombie } from '../zombies.js';
import { frissonPick } from './pick.js';

export const HEAD_PREFIX = 'FrissonHead_';
// The head files the pack may wear, chosen by ambiance.js (ctx.variant.heads):
// heads.glb, the owner's A series (Frisson), or heads-b.glb, the rounder B
// series without growths (Frisson léger, the owner, 15 October 2026). No
// variant, or any other name, is heads.glb: a variant never fetches a path
// of its own.
export const HEAD_FILES = Object.freeze(['heads.glb', 'heads-b.glb']);
export function headsFile(variant) { return HEAD_FILES.includes(variant?.heads) ? variant.heads : HEAD_FILES[0]; }
export const BOSS_HEAD = 'FrissonHead_Boss';
export const HEAD_PARTS = Object.freeze(['Skin', 'Detail', 'Eyes']);
// The overlord's family mark (enemies.js): the only one the boss head wears,
// and one no ordinary zombie wears.
export const BOSS_MARKER = 'crown';
// Crawlers wear the head at .74. A head taller than the storybook skulls
// (top .215), its marks included, shrinks to their height, so crawlers stay
// crawler-height.
const CRAWLER_TOP = .215 * .74;
// The storybook overlord's helmet tops out at .235 and its crown at .23,
// about its server height (1.91 m with the head at 1.68): the Frisson boss
// head with its crown shrinks to stay under .231, so shots at the crown
// still count.
const BOSS_TOP = .231;
// The overlord's head is grown past the walkers' scale, so it reads massive
// next to its neck ring; head and crown stay under BOSS_TOP.
const BOSS_HEAD_GROW = 1.12;
const COMPILE_TIMEOUT = 5000;
// The game's glow (zombies.js EYES), whose colours a head file may replace
// per kind: the same roughness, and no fog, so eyes shine out of the mist.
const EYE_ROUGHNESS = Object.freeze({ walker: .2, crawler: .3, boss: .3 });
// A tint must glow at least this much (emissive luminance x intensity) to
// replace the game's: a black placeholder would put the eyes out.
const MIN_GLOW = .05;
// The walkers' glow of a head: its own _Eyes material, named `eyes`, or
// `eyes_<Set>` in a file that mixes sets (each keeps its own glow).
export const WALKER_EYES = /^eyes(?:_[A-Z][A-Za-z0-9]*)?$/;
// Art-direction overrides, by material name, on top of a file's own glow
// (linear colours): the Rôdeurs' cold blue reads stronger than their file's
// bluish white under the Frisson night.
const EYE_TINT_OVERRIDES = { eyes_Rodeurs: { color: [.10, .20, .45], emissive: [.08, .25, 1.0], emissiveIntensity: 1.5 } };

// Head-local metrics of a skin, as zombies.js describes skulls: half width
// and depth of the cranium (above the centre, where hats and marks sit) and
// the top. Hats are fitted with them.
export function skullOf(geometry) {
  const position = geometry.attributes.position;
  let half = 0, front = 0, top = -Infinity;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    top = Math.max(top, y);
    if (y >= 0) { half = Math.max(half, Math.abs(x)); front = Math.max(front, Math.abs(z)); }
  }
  return Object.freeze({ front, half, top });
}

// Sorts the GLB's roots into ordinary variants (file order) and the optional
// boss head. Names follow the contract; a missing part fails loudly. Each
// head carries `glow`: the tint of its own walker eyes (eyeTints), or null.
export function headsFromGlb(glb) {
  const { roots } = glb, variants = [], tints = eyeTints(glb);
  let boss = null;
  for (const root of roots) {
    if (!root.name.startsWith(HEAD_PREFIX) || root.name.length === HEAD_PREFIX.length) throw new Error(`GLB: root ${root.name} is not named ${HEAD_PREFIX}<Name>`);
    if (root.mesh || root.children.length !== HEAD_PARTS.length) throw new Error(`GLB: ${root.name} must be an empty with ${HEAD_PARTS.join(', ')} children`);
    const parts = {};
    for (const part of HEAD_PARTS) {
      const child = root.children.find(node => node.name === `${root.name}_${part}`);
      if (!child?.mesh || child.children.length) throw new Error(`GLB: ${root.name}_${part} is missing`);
      parts[part] = child.mesh.geometry;
    }
    for (const part of ['Skin', 'Detail']) if (!parts[part].attributes.color) throw new Error(`GLB: ${root.name}_${part} has no COLOR_0`);
    // The whole head's top: stitches or a crack may stand above the skin.
    const top = Math.max(...HEAD_PARTS.map(part => { parts[part].computeBoundingBox(); return parts[part].boundingBox.max.y; }));
    const head = Object.freeze({ name: root.name.slice(HEAD_PREFIX.length), skin: parts.Skin, detail: parts.Detail, eyes: parts.Eyes, skull: skullOf(parts.Skin), top,
      glow: tints.heads.get(root) ?? null });
    if (root.name === BOSS_HEAD) boss = head; else variants.push(head);
  }
  if (!variants.length) throw new Error(`GLB: no ${HEAD_PREFIX}<Name> head for ordinary zombies`);
  return Object.freeze({ variants: Object.freeze(variants), boss, eyes: Object.freeze({ walker: tints.walker, crawler: tints.crawler, boss: tints.boss }) });
}

// The glow each kind's eyes take from the file, or null for the game's own:
// walkers (and runners, the armoured, colossi) the walker eyes of their own
// head (WALKER_EYES: `eyes`, or `eyes_<Set>` when a file mixes sets, so each
// set keeps its glow); crawlers a material named `eyes_crawler`; the
// overlord the boss head's own `eyes_boss`, or one by that name anywhere in
// the file. Each { color, emissive, emissiveIntensity }, colours linear as in
// the file, one per material: heads that share a material share its tint.
// heads maps each ordinary root to its walker tint; walker is the first
// ordinary head's.
export function eyeTints({ roots = [], materials = [] } = {}) {
  const glows = material => Boolean(material) && (material.emissive.r * .2126 + material.emissive.g * .7152 + material.emissive.b * .0722) * material.emissiveIntensity >= MIN_GLOW;
  const made = new Map();
  const tint = material => {
    if (!glows(material)) return null;
    if (!made.has(material)) {
      const override = EYE_TINT_OVERRIDES[material.name];
      made.set(material, Object.freeze(override
        ? { color: new THREE.Color(...override.color), emissive: new THREE.Color(...override.emissive), emissiveIntensity: override.emissiveIntensity }
        : { color: material.color.clone(), emissive: material.emissive.clone(), emissiveIntensity: material.emissiveIntensity }));
    }
    return made.get(material);
  };
  const eyesOf = root => root?.children.find(node => node.name === `${root.name}_Eyes`)?.mesh?.material ?? null;
  const named = name => materials.find(material => material.name === name) ?? null;
  const ordinary = roots.filter(root => root.name !== BOSS_HEAD), boss = eyesOf(roots.find(root => root.name === BOSS_HEAD));
  const heads = new Map(ordinary.map(root => { const material = eyesOf(root); return [root, WALKER_EYES.test(material?.name ?? '') ? tint(material) : null]; }));
  return Object.freeze({
    walker: heads.get(ordinary[0]) ?? null,
    crawler: tint(named('eyes_crawler')),
    boss: tint(boss?.name === 'eyes_boss' ? boss : named('eyes_boss')),
    heads,
  });
}

// The server id picks the variant on every screen, from its own mixed hash
// (pick.js): the storybook look's random sequence is never touched.
export function headVariant(id, count) { return frissonPick(id, '', count); }

export function createHeadsStyle({ variants, boss, eyes: tints = {} }) {
  const materials = new Map(), surfaces = new Map(), worn = new WeakMap();
  const cached = (name, create) => { if (!materials.has(name)) materials.set(name, create()); return materials.get(name); };
  // Same roughness and moonlit rim as the game's skin, cloth and detail; the
  // facets come from flat shading over the model's smooth normals. Skin and
  // cloth wear the Frisson palette (palette.js).
  const faceted = (color, roughness, extra = {}) => withRim(new THREE.MeshStandardMaterial({ color, roughness, vertexColors: true, flatShading: true, ...extra }));
  const skinMaterial = appearance => cached(`skin-${appearance.id}`, () => faceted(skinColor(appearance), .82));
  const detailMaterial = () => cached('detail', () => faceted(0xffffff, .86));
  const clothMaterial = appearance => cached(`cloth-${appearance.id}`, () => faceted(clothColor(appearance), .96));
  // The storybook bodies (no bodies.glb, or a kind it has no body for) in
  // the head's corpse colour: the game's own skin material (zombies.js
  // skinMaterial) in the palette colour, so no program is added. A family
  // the palette leaves alone keeps the game's material.
  const storybookSkin = appearance => (skinColor(appearance) === appearance.color ? null
    : cached(`storybook-skin-${appearance.id}`, () => withRim(new THREE.MeshStandardMaterial({ color: skinColor(appearance), roughness: .82 }))));
  // The family accent as markZombie draws it, with its faint glow.
  const accentMaterial = appearance => cached(`accent-${appearance.id}`, () => faceted(appearance.accentColor, .96, { emissive: appearance.accentColor, emissiveIntensity: .12 }));
  // The game's glow treatment in the file's colours: for one kind, or for
  // the walkers' eyes of the heads sharing one tint (keyed by the tint).
  const glowMaterial = (key, tint, roughness) => cached(key, () => new THREE.MeshStandardMaterial({ color: tint.color, roughness,
    emissive: tint.emissive, emissiveIntensity: tint.emissiveIntensity, fog: false }));
  const eyeMaterial = which => (tints[which] ? glowMaterial(`eyes-${which}`, tints[which], EYE_ROUGHNESS[which]) : null);
  const headGlow = variant => (variant.glow ? glowMaterial(variant.glow, variant.glow, EYE_ROUGHNESS.walker) : null);
  const variantFor = id => variants[headVariant(id, variants.length)];
  // A family's marks on one head, cast once and shared: { accent, cloth, top }.
  const marksOf = (variant, marker) => {
    if (!surfaces.has(variant)) surfaces.set(variant, { surface: headSurface(variant), marks: new Map() });
    const entry = surfaces.get(variant);
    if (!entry.marks.has(marker)) {
      const built = buildMarks(entry.surface, marker), parts = [built.accent, built.cloth].filter(Boolean);
      entry.marks.set(marker, Object.freeze({ ...built, top: parts.length ? Math.max(...parts.map(geometry => geometry.boundingBox.max.y)) : -Infinity }));
    }
    return entry.marks.get(marker);
  };
  // Casts now every family's marks a head can wear (well under 1 ms each),
  // so no first spawn pays for them mid-wave: the overlord's crown on the
  // boss head only, and every other family on the ordinary heads (the crown
  // too when there is no boss head). Returns how many were cast.
  const prepare = () => {
    let cast = 0;
    const others = Object.keys(HEAD_MARKS).filter(marker => !boss || marker !== BOSS_MARKER);
    for (const [variant, markers] of [...variants.map(variant => [variant, others]), ...(boss ? [[boss, [BOSS_MARKER]]] : [])]) for (const marker of markers) {
      if (surfaces.get(variant)?.marks.has(marker)) continue;
      marksOf(variant, marker); cast++;
    }
    return cast;
  };
  return {
    variants, boss, variantFor, tints, marksOf, prepare,
    buildHead(head, appearance, look, { eyes, scale = 1, crawler = false, id, boss: isBoss = false, kind } = {}) {
      // Raiders are living people: they keep their own heads.
      if (kind === 'raider') return null;
      const variant = isBoss && boss ? boss : variantFor(id);
      const room = crawler ? CRAWLER_TOP : isBoss ? BOSS_TOP : Infinity, top = Math.max(variant.top, marksOf(variant, appearance.marker).top);
      const size = top > 0 ? Math.min(isBoss ? scale * BOSS_HEAD_GROW : scale, room / top) : scale;
      const add = (geometry, material, name) => {
        // Shared geometry: never userData.ownedGeometry, so disposeZombie
        // leaves it alone; shadows are set here as mesh() would.
        const part = new THREE.Mesh(geometry, material);
        part.name = name; part.castShadow = true; part.receiveShadow = true;
        if (size !== 1) part.scale.setScalar(size);
        head.add(part);
        return part;
      };
      // Skin first, whatever the file's order: it stays the head's first child.
      add(variant.skin, skinMaterial(appearance), 'zombieHeadSkin').userData.headVariant = variant.name;
      add(variant.detail, detailMaterial(), 'zombieFace');
      // Walkers, runners, the armoured and colossi glow in their own head's
      // tint; crawlers and the overlord in their kind's (eyes, from the game).
      add(variant.eyes, (!crawler && !isBoss && headGlow(variant)) || eyes, 'zombieEyes');
      worn.set(head, { variant, size });
      // No hat: the hair and the skull make the silhouette. A head shot
      // still kills, with nothing to pop off.
      return { hat: null };
    },
    // The family's head marks (zombies.js markZombie), cast onto this head:
    // the same names, colours and places, on its own surface.
    markHead(headMarks, appearance) {
      const wearing = worn.get(headMarks.parent);
      if (!wearing) return false;
      headMarks.scale.setScalar(wearing.size);
      const { accent, cloth } = marksOf(wearing.variant, appearance.marker);
      for (const [geometry, material, name] of [[accent, accentMaterial, 'healthHeadAccent'], [cloth, clothMaterial, 'healthHeadCloth']]) {
        if (!geometry) continue;
        // Shared geometry, never userData.ownedGeometry.
        const part = new THREE.Mesh(geometry, material(appearance));
        part.name = name; part.castShadow = true; part.receiveShadow = true;
        headMarks.add(part);
      }
      return true;
    },
    // The overlord's crown sits on its own head: no storybook helmet or
    // cage cutting into it.
    bossHelmet: head => worn.has(head),
    // The storybook bodies' neck and hands match the head (bodies.js dresses
    // the Frisson bodies with the materials below). Crawlers and the
    // overlord glow in the file's tint for their kind when it has one; the
    // other kinds get the game's walker glow here, and buildHead puts their
    // own head's glow on them when it has one.
    skin: storybookSkin,
    eyes: (kind, isBoss) => (isBoss ? eyeMaterial('boss') : kind === 'crawler' ? eyeMaterial('crawler') : null),
    // The Frisson skin and detail, for the bodies (bodies.js): one set, so
    // neck, hands and head match and no shader program is added.
    materials: Object.freeze({ skin: skinMaterial, detail: detailMaterial }),
    dispose() {
      for (const head of [...variants, ...(boss ? [boss] : [])]) for (const geometry of [head.skin, head.detail, head.eyes]) geometry.dispose();
      for (const { marks } of surfaces.values()) for (const { accent, cloth } of marks.values()) { accent?.dispose(); cloth?.dispose(); }
      for (const material of materials.values()) material.dispose();
      materials.clear(); surfaces.clear();
    },
  };
}

// Compiles a staged walker and crawler, which carry every Frisson program
// (the boss's too), for the game scene's lights and fog. The promise never
// rejects (a failed compile only costs a hitch at the first zombie) and
// settles once three is done with the materials: until then three polls them
// and must not find them freed. null without a renderer.
function precompile({ renderer, scene, camera }) {
  if (!renderer?.compileAsync || !camera) return null;
  const models = [createZombie('walker', false, 80, 'prewarm'), createZombie('crawler', false, 80, 'prewarm')];
  const stage = new THREE.Group(); stage.name = 'frissonHeadsPrewarm'; stage.add(...models);
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {}).finally(() => models.forEach(disposeZombie));
}

// The compile, for COMPILE_TIMEOUT at most and no longer once aborted.
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md, plus an optional ctx.signal (AbortSignal) that
// leaving the room aborts. Aborted before the heads are set, install rejects
// with nothing installed; after, the heads uninstall at once and install
// rejects if it has not returned yet, so a late install never outlives the
// room. Install before world.prewarm (its staged zombies then compile the
// Frisson programs); with a renderer at hand the programs are compiled here
// too.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  const heads = headsFromGlb(readGlb(await fetchAsset(headsFile(ctx.variant))));
  const style = createHeadsStyle(heads);
  if (signal?.aborted) { style.dispose(); signal.throwIfAborted(); }
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    // The bodies (bodies.js) may sit on these heads: then both come off.
    for (let current = getZombieStyle(); current; current = current.base) if (current === style) { setZombieStyle(null); break; }
    // Mid-compile, three still polls the materials (see precompile).
    if (compiling) compiling.then(() => style.dispose()); else style.dispose();
  };
  setZombieStyle(style);
  signal?.addEventListener('abort', uninstall, { once: true });
  // In the game (a renderer at hand), the marks are cast while the room loads.
  if (ctx.renderer) style.prepare();
  const compiled = precompile(ctx);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, heads, uninstall };
}
