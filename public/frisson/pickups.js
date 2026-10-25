// Frisson part: pickups (art/frisson/PICKUPS.md). The coins, the ammo boxes,
// the first-aid box, the armour vest, the grenade and the revive kit — the
// models pickupTemplate builds in world.js, plain and special — are dressed
// by one style set through world.js setPickupStyle: the Famille meshes of the
// model go, and the Body (plus the Glint, when the root has one) of the
// tier's root in pickups.glb takes their place with an identity transform,
// wearing the weapons' dress program (zombieRim, vertex colours, flat
// shading: no new program). The ammoFill group stays as it is, children,
// transforms and materials, so the fill bars and setPickupFill work
// unchanged; pickupModel, pickupHalo, the bob, the spin and the pulse never
// move. The tier comes from ctx.variant: 'light' in Frisson léger, 'full'
// otherwise. Famille itself never loads any of this.
// With no pickups.glb (or a broken one, or none of the tier's roots) nothing
// is dressed: the Famille look stays, with a single console warning.
// Ownership: the style owns its materials (its dispose() frees them).
// The GLB geometries belong to the parsed asset handed back as `pickups`,
// shared by every dressed copy (geometry.userData.frissonShared): dress never
// disposes them, and neither does the style (a caller may hand it roots it
// keeps). The part's install parses its own copy, so its uninstall frees that
// copy (disposePickups) with the style, once the compile has settled and the
// pickups are back to Famille: a load taken off leaves nothing behind.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { createPickup, setPickupStyle, getPickupStyle } from '../world.js';
import { createDressMaterial } from './weapon-recipes.js';

export const ROOT_PREFIX = 'FrissonPickup';
export const PICKUP_ROOT_KINDS = Object.freeze(['Points', 'Ammo', 'AmmoSpecial', 'Health', 'Armor', 'Grenade', 'Revive']);
export const PICKUP_TIERS = Object.freeze(['light', 'full']);
const COMPILE_TIMEOUT = 5000;
// The tier as the root names spell it: FrissonPickup_<Kind>_<Light|Full>.
const TIER_NAMES = Object.freeze({ light: 'Light', full: 'Full' });

// The glint materials (PICKUPS.md 3.1, pickups-more/NOTES.md): the cue parts
// that glow faintly at night, as Famille's emissive ones do — one per root
// kind that has a Glint, the emissive multiplier by tier (never above
// Famille's). The grenade has none: Famille's has no emissive part either.
// Health's cross and Armor's chevron sit at the top of the ±.15 provisional
// range PICKUPS.md 3.1 allows: the shot tool's P5 measured the tarnished cues
// below half of Famille's readable share (15 October 2026).
export const GLINT = Object.freeze({
  Points: Object.freeze({ emissive: 0x9a6418, intensity: Object.freeze({ light: .40, full: .25 }), roughness: .55, metalness: .45 }),
  Ammo: Object.freeze({ emissive: 0x477d75, intensity: Object.freeze({ light: .45, full: .30 }), roughness: .70, metalness: .20 }),
  AmmoSpecial: Object.freeze({ emissive: 0x976c2d, intensity: Object.freeze({ light: .45, full: .30 }), roughness: .70, metalness: .20 }),
  Health: Object.freeze({ emissive: 0x226a40, intensity: Object.freeze({ light: .55, full: .40 }), roughness: .70, metalness: .20 }),
  Armor: Object.freeze({ emissive: 0x2b6a99, intensity: Object.freeze({ light: .60, full: .45 }), roughness: .70, metalness: .20 }),
  Revive: Object.freeze({ emissive: 0xff9ab8, intensity: Object.freeze({ light: .30, full: .20 }), roughness: .85, metalness: 0 }),
});

// The tier an ambiance variant asks for (ambiance.js FRISSON_VARIANTS); a
// context without one (tests, tools, the lookdev) is Frisson's, the full look.
export function tierOf(variant) { return variant?.pickups === 'light' ? 'light' : 'full'; }
// The root kind a pickup kind maps to: points -> Points, ammo -> Ammo or
// AmmoSpecial, health/armor/grenade/revive -> their capitalised kind;
// anything else is never dressed.
const ROOT_KIND_BY_PICKUP = Object.freeze({ points: 'Points', health: 'Health', armor: 'Armor', grenade: 'Grenade', revive: 'Revive' });
export function rootKindOf(kind, special) { return kind === 'ammo' ? (special ? 'AmmoSpecial' : 'Ammo') : ROOT_KIND_BY_PICKUP[kind] ?? null; }

// The GLB's roots by '<Kind>_<Light|Full>' (Points_Light, AmmoSpecial_Full):
// { key, root, body, glint } with the glb.js meshes (glint may be null). Only
// roots named exactly FrissonPickup_<Kind>_<Tier> with a <Root>_Body mesh
// child count; the first one wins. The shared flag goes on the geometries
// once, here.
export function pickupsFromGlb(glb) {
  const roots = Array.isArray(glb) ? glb : glb?.roots ?? [];
  const pickups = new Map();
  for (const root of roots) {
    if (typeof root?.name !== 'string' || !root.name.startsWith(`${ROOT_PREFIX}_`)) continue;
    const [kind, tier] = root.name.slice(ROOT_PREFIX.length + 1).split('_');
    if (!PICKUP_ROOT_KINDS.includes(kind) || !Object.values(TIER_NAMES).includes(tier)) continue;
    const key = `${kind}_${tier}`;
    if (pickups.has(key)) continue;
    let body = null, glint = null;
    for (const child of root.children ?? []) {
      if (typeof child?.name !== 'string' || !child.mesh?.geometry) continue;
      if (child.name === `${root.name}_Body`) body ??= child.mesh;
      else if (child.name === `${root.name}_Glint`) glint ??= child.mesh;
    }
    if (!body) continue;
    for (const mesh of [body, glint]) if (mesh) mesh.geometry.userData.frissonShared = true;
    pickups.set(key, Object.freeze({ key, root: root.name, body, glint }));
  }
  return pickups;
}

// Frees the GLB geometries of a pickupsFromGlb map (bodies and glints). Only
// the owner of the parsed asset calls it.
export function disposePickups(pickups) {
  for (const entry of pickups?.values() ?? []) for (const mesh of [entry.body, entry.glint]) mesh?.geometry?.dispose();
}

// The one pickups style (PICKUPS.md 3.1): the dress material is the weapons'
// own recipe renamed, the glints add their cue's emissive (a uniform of
// the same program). `roots` is a pickupsFromGlb map, or a GLB (a readGlb
// result) to parse, or null; `missing` names this tier's keys absent from it.
export function createPickupsStyle({ roots = null, tier = 'full' } = {}) {
  const dressMaterial = createDressMaterial(); dressMaterial.name = 'frissonPickupDress';
  const glintMaterials = new Map();
  for (const [kind, glint] of Object.entries(GLINT)) {
    const material = createDressMaterial();
    material.name = `frissonPickupGlint_${kind}`;
    material.emissive.setHex(glint.emissive);
    material.emissiveIntensity = glint.intensity[tier] ?? glint.intensity.full;
    material.roughness = glint.roughness; material.metalness = glint.metalness;
    glintMaterials.set(kind, material);
  }
  const pickups = roots instanceof Map ? roots : roots ? pickupsFromGlb(roots) : new Map();
  const tierName = TIER_NAMES[tier] ?? TIER_NAMES.full;
  const missing = PICKUP_ROOT_KINDS.map(kind => `${kind}_${tierName}`).filter(key => !pickups.has(key));

  // Mutates the pickupModel of a template in place (PICKUPS.md 3.1): false —
  // the model untouched — when this tier has no root for the kind. Otherwise
  // every Famille child goes but the ammoFill group, which stays as it is so
  // setPickupFill and the bars' glow work unchanged; the removed subtrees'
  // own geometries are disposed (never a shared one, never a material: the
  // Famille ones are the world's shared mats). model keeps its name, so
  // createPickup's userData, animatePickup and the spin are untouched.
  function dress(model, { kind, special } = {}) {
    const rootKind = rootKindOf(kind, special);
    const entry = rootKind ? pickups.get(`${rootKind}_${tierName}`) : null;
    if (!entry) return false;
    if (model.getObjectByName('frissonPickupBody')) return true; // already dressed
    for (const child of [...model.children]) {
      if (child.name === 'ammoFill') continue;
      child.traverse(node => { if (node.isMesh && !node.geometry?.userData?.frissonShared) node.geometry?.dispose?.(); });
      model.remove(child);
    }
    const body = new THREE.Mesh(entry.body.geometry, dressMaterial);
    body.name = 'frissonPickupBody'; body.castShadow = false; body.receiveShadow = true;
    model.add(body);
    if (entry.glint) {
      const glint = new THREE.Mesh(entry.glint.geometry, glintMaterials.get(rootKind) ?? dressMaterial);
      glint.name = 'frissonPickupGlint'; glint.castShadow = false; glint.receiveShadow = true;
      model.add(glint);
    }
    return true;
  }

  return {
    tier, roots: pickups, dressMaterial, glintMaterials, missing, dress,
    // What the style owns: its materials. The GLB geometries stay with
    // the parsed asset (see the header).
    dispose() { dressMaterial.dispose(); for (const material of glintMaterials.values()) material.dispose(); },
  };
}

// One pickup of each styled kind on an empty stage, compiled for the scene's
// lights and fog (as the weapons do): the dress and glint programs are the
// ones the weapons part already compiled, so this only warms their use on
// these geometries before the first wave. Never rejects; null without a
// renderer. The clones share the templates' geometry: nothing to dispose.
function precompile({ renderer, scene, camera }) {
  if (!renderer?.compileAsync || !camera) return null;
  const stage = new THREE.Group(); stage.name = 'frissonPickupsPrewarm';
  stage.add(createPickup('points'), createPickup('ammo'), createPickup('ammo', true),
    createPickup('health'), createPickup('armor'), createPickup('grenade'), createPickup('revive'));
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {});
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Installed right after the weapons, whose dress
// program it reuses (index.js PARTS). A missing or broken pickups.glb is not
// an error: the Famille look stays, one console warning says why, and the
// rest of the pack goes on ({ style: null, pickups: null, error }). Roots of
// the tier missing from the file leave those kinds Famille the same way, one
// warning naming them. ctx.signal works as for the weapons: its AbortError is
// never swallowed, and a load called off leaves nothing on.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  let pickups = null, error = null;
  try { pickups = pickupsFromGlb(readGlb(await fetchAsset('pickups.glb'))); }
  catch (caught) {
    signal?.throwIfAborted();
    globalThis.console?.warn?.(`Frisson pickups: Famille look (${caught?.message ?? caught})`);
    return { style: null, pickups: null, error: caught, uninstall() {} };
  }
  const tier = tierOf(ctx.variant);
  const style = createPickupsStyle({ roots: pickups, tier });
  // The style and this install's own parse of the GLB go together.
  const free = () => { style.dispose(); disposePickups(pickups); };
  if (style.missing.length === PICKUP_ROOT_KINDS.length) {
    // None of the tier's roots: the missing-file case, one warning.
    error = new Error(`pickups.glb: no FrissonPickup root for tier ${TIER_NAMES[tier]}`);
    globalThis.console?.warn?.(`Frisson pickups: Famille look (${error.message})`);
    free();
    return { style: null, pickups: null, error, uninstall() {} };
  }
  if (style.missing.length) globalThis.console?.warn?.(`Frisson pickups: Famille look for ${style.missing.join(', ')} (not in pickups.glb)`);
  if (signal?.aborted) { free(); signal.throwIfAborted(); }
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (getPickupStyle() === style) setPickupStyle(null);
    // Mid-compile, three still polls the materials.
    if (compiling) compiling.then(free); else free();
  };
  setPickupStyle(style);
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, pickups, error: null, uninstall };
}
