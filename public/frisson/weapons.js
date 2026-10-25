// Frisson part: weapons (art/frisson/WEAPONS.md). Every weapon the Famille
// code builds — first person, held by teammates and raiders, on the armory
// racks and on the ground — is dressed by one style set through world.js
// setWeaponStyle: the Famille materials are swapped for the recipes of
// section 2.2 (one material per Famille name, the heads' detail program:
// zombieRim, vertex colours, flat shading), the Famille geometries for the
// cached weathered ones of section 2.4 (shared by every copy of a weapon and
// tier), and the dressing of weapons.glb (tape, wraps, nails, shells, pixel
// blood on melee) is attached to the weapon's anchor with an identity
// transform so it follows every pose, swing, recoil, rack fit and ground
// pose. The chipped axe edge and the nicked katana blade replace their
// Famille mesh. Famille itself never loads any of this (D7).
// With no weapons.glb (or a broken one) the recipes and the weathering still
// apply, with a single console warning.
// Ownership: the style owns the recipe and dress materials and the
// weathering cache (its dispose() frees them). The GLB geometries belong to
// the parsed asset handed back as `weapons`, shared by every dressed copy
// (geometry.userData.frissonShared): setSurvivorWeapon and restyleArmory
// never dispose them, and neither does the style (a caller may hand it roots
// it keeps). The part's install parses its own copy, so its uninstall frees
// that copy (disposeWeapons) with the style, once the compile has settled
// and the views are back to Famille: a load taken off leaves nothing behind.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { createWeapon, setWeaponStyle, getWeaponStyle } from '../world.js';
import { WEAPON_TYPES, KEEP_MATERIALS, anchorNameFor, familleMaterialName, createRecipeMaterials, createDressMaterial, createWeathering } from './weapon-recipes.js';

export const ROOT_PREFIX = 'FrissonWeapon';
const COMPILE_TIMEOUT = 5000;
// pistol -> FrissonWeapon_Pistol, smg -> FrissonWeapon_Smg (section 3.2).
export const rootNameFor = type => `${ROOT_PREFIX}_${String(type).slice(0, 1).toUpperCase()}${String(type).slice(1)}`;

// The GLB's roots by weapon type: { dress, dressFlat, replacements:
// Map<part, mesh> } with the glb.js meshes. A missing root or channel is not
// an error: that weapon (or view) gets the recipes only. The shared flag
// goes on the geometries once, here.
export function weaponsFromGlb(glb) {
  const roots = Array.isArray(glb) ? glb : glb?.roots ?? [];
  const weapons = new Map();
  for (const root of roots) {
    if (typeof root?.name !== 'string' || !root.name.startsWith(`${ROOT_PREFIX}_`)) continue;
    const type = root.name.slice(ROOT_PREFIX.length + 1).toLowerCase();
    if (!WEAPON_TYPES.includes(type) || weapons.has(type)) continue;
    let dress = null, dressFlat = null;
    const replacements = new Map();
    for (const child of root.children ?? []) {
      const channel = typeof child?.name === 'string' && child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!channel || !child.mesh?.geometry) continue;
      if (channel === 'Dress') { dress ??= child.mesh; }
      else if (channel === 'DressFlat') { dressFlat ??= child.mesh; }
      else if (channel.startsWith('Replace_')) { const part = channel.slice(8); if (!replacements.has(part)) replacements.set(part, child.mesh); }
    }
    for (const mesh of [dress, dressFlat, ...replacements.values()]) if (mesh) mesh.geometry.userData.frissonShared = true;
    weapons.set(type, Object.freeze({ type, root: root.name, dress, dressFlat, replacements }));
  }
  return weapons;
}

// Frees the GLB geometries of a weaponsFromGlb map (dress, dressFlat and the
// replacements). Only the owner of the parsed asset calls it.
export function disposeWeapons(weapons) {
  for (const weapon of weapons?.values() ?? [])
    for (const mesh of [weapon.dress, weapon.dressFlat, ...weapon.replacements.values()]) mesh?.geometry?.dispose();
}

// The one weapons style (WEAPONS.md 4.2). quality is the graphics preset id
// ('low' | 'medium' | 'high'): the weathering tier is `full` for the first
// person at every quality, for the held views on medium and high, and for
// racks and the ground on high; `plain` for racks and the ground on medium,
// and for every third-person view on low (2.4.6: the first-person weapon is
// always on screen, and the plain tier's uniform faces lose the worn
// outline of its dark faces against a dark room).
export function createWeaponsStyle({ roots = null, quality = 'high' } = {}) {
  const recipes = createRecipeMaterials(), dressMaterial = createDressMaterial(), weathering = createWeathering();
  const weapons = roots instanceof Map ? roots : roots ? weaponsFromGlb(roots) : new Map();
  const tiers = new Map();
  const bake = (type, tier) => {
    const key = `${type}|${tier}`;
    if (!tiers.has(key)) tiers.set(key, weathering.bake(type, tier));
    return tiers.get(key);
  };
  const tierFor = view => view === 'firstPerson' || quality === 'high' || (view === 'held' && quality !== 'low') ? 'full' : 'plain';
  // The recipe of a Famille material; null for the keep class (sights,
  // bores, optic glass) and for anything already Frisson (re-dressing).
  // Famille materials are unnamed: the name comes from the constructor
  // triple, exactly as the weathering bake recovered it.
  const recipeFor = (material, type) => {
    if (!material || material.name?.startsWith('frisson')) return null;
    const name = familleMaterialName(material, type);
    if (!name || KEEP_MATERIALS.has(name)) return null;
    return recipes.get(name) ?? null;
  };

  // Mutates gun in place. Every Famille node, name, userData, transform and
  // order stays; weapons never cast or receive shadows.
  function dress(gun, { type, view = 'firstPerson' } = {}) {
    if (!gun) return gun;
    // The anchor by NAME, never userData: rack and ground copies have none.
    const anchorName = anchorNameFor(type);
    const anchor = (anchorName && gun.getObjectByName(anchorName)) || gun;
    // Re-dressing starts clean (the staged compile weapon, a style swap).
    const previous = anchor.getObjectByName('frissonWeaponDress');
    if (previous) previous.removeFromParent();

    const channels = weapons.get(type) ?? null;
    // The replacements take the Famille mesh's place, name and userData
    // (minus sections), in the anchor's frame with an identity transform.
    // A replacement still counts toward its Famille key's ordinal below:
    // skipping it would shift the ordinals of the meshes that share its
    // material (the axe's pickTip would get the cutting edge's geometry).
    const replaced = new Map();
    if (channels) {
      for (const [part, source] of channels.replacements) {
        const current = anchor.getObjectByName(part);
        if (!current?.isMesh) continue;
        const userData = { ...current.userData }; delete userData.sections;
        const parent = current.parent, at = parent.children.indexOf(current);
        const key = (Array.isArray(current.material) ? current.material : [current.material])
          .map(material => familleMaterialName(material, type) ?? '').join('+');
        parent.remove(current);
        if (!current.geometry?.userData?.frissonShared) current.geometry?.dispose?.();
        const mesh = new THREE.Mesh(source.geometry, recipes.get(source.material?.name) ?? dressMaterial);
        mesh.name = part; mesh.userData = userData; mesh.castShadow = mesh.receiveShadow = false;
        // The Famille mesh's own slot: the children order does not move.
        parent.children.splice(at, 0, mesh); mesh.parent = parent;
        replaced.set(mesh, key);
      }
    }

    // Materials and weathered geometry. The mesh key is the one the bake
    // used: the recovered Famille material name(s) joined with '+' and the
    // ordinal among the meshes with that key, depth-first (hands have their
    // own materials, so the ordinals are the same with or without them).
    const baked = bake(type, tierFor(view)), ordinals = new Map();
    gun.traverse(node => {
      if (!node.isMesh || node.name === 'frissonWeaponDress') return;
      const replacedKey = replaced.get(node);
      if (replacedKey === undefined && node.geometry?.userData?.frissonShared) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const key = replacedKey ?? materials.map(material => familleMaterialName(material, type) ?? '').join('+');
      const ordinal = ordinals.get(key) ?? 0; ordinals.set(key, ordinal + 1);
      // A replacement already wears its recipe material and final geometry.
      if (replacedKey !== undefined) return;
      const swapped = materials.map(material => recipeFor(material, type) ?? material);
      if (!swapped.some((material, index) => material !== materials[index])) return;
      node.material = Array.isArray(node.material) ? swapped : swapped[0];
      const weathered = baked.get(`${key}|${ordinal}`);
      if (weathered) { node.geometry.dispose(); node.geometry = weathered; }
    });

    // The dressing mesh: _Dress for the first person and held views,
    // _DressFlat falling back to _Dress for racks and the ground. On low,
    // only the first-person weapon is dressed.
    if (channels && (quality !== 'low' || view === 'firstPerson')) {
      const source = view === 'rack' || view === 'ground' ? channels.dressFlat ?? channels.dress : channels.dress;
      if (source) {
        const mesh = new THREE.Mesh(source.geometry, dressMaterial);
        mesh.name = 'frissonWeaponDress'; mesh.castShadow = mesh.receiveShadow = false;
        anchor.add(mesh);
      }
    }
    return gun;
  }

  return {
    quality, weapons, recipes, dressMaterial, weathering, bake, dress,
    // What the style owns: its materials and the weathered geometries. The
    // GLB geometries stay with the parsed asset (see the header).
    dispose() {
      for (const material of recipes.values()) material.dispose();
      dressMaterial.dispose();
      weathering.dispose();
      tiers.clear();
    },
  };
}

// One dressed first-person weapon and one dressed rack weapon on an empty
// stage, compiled for the scene's lights and fog (as the survivors do). The
// recipes share the program the pack has already compiled; this warms the
// no-shadow variant and the dress material before the first wave (2.1).
// Never rejects; null without a renderer.
function precompile({ renderer, scene, camera }, style) {
  if (!renderer?.compileAsync || !camera) return null;
  const firstPerson = createWeapon('rifle'), rack = createWeapon('katana');
  // The style is not the world's yet at this point of install (4.3), so
  // createWeapon did not dress: do it by hand. The rack copy wears DressFlat.
  if (getWeaponStyle() !== style) style.dress(firstPerson, { type: 'rifle', view: 'firstPerson' });
  style.dress(rack, { type: 'katana', view: 'rack' });
  const stage = new THREE.Group(); stage.name = 'frissonWeaponsPrewarm'; stage.add(firstPerson, rack);
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {}).finally(() => {
    // The stage owns only the Famille geometries the recipes do not touch
    // (sights, bores, optic glass); everything shared stays with the caches.
    stage.traverse(node => { if (node.isMesh && !node.geometry?.userData?.frissonShared) node.geometry.dispose(); });
  });
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Installed after the survivors (index.js
// PARTS). A missing or broken weapons.glb is not an error: the recipes and
// the weathering still dress every weapon, one console warning says why,
// and the rest of the pack goes on ({ weapons: null, error }). ctx.signal
// works as for the survivors: its AbortError is never swallowed, and a load
// called off leaves nothing on.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  let weapons = null, error = null;
  try { weapons = weaponsFromGlb(readGlb(await fetchAsset('weapons.glb'))); }
  catch (caught) {
    signal?.throwIfAborted();
    error = caught;
    globalThis.console?.warn?.(`Frisson weapons: recipes and weathering only (${caught?.message ?? caught})`);
  }
  const quality = typeof ctx.quality === 'string' ? ctx.quality : 'high';
  const style = createWeaponsStyle({ roots: weapons, quality });
  // The style and this install's own parse of the GLB go together.
  const free = () => { style.dispose(); disposeWeapons(weapons); };
  if (signal?.aborted) { free(); signal.throwIfAborted(); }
  // The whole weathering up front (2.4.7): a bake mid-wave would hitch. Only
  // the tiers this quality can show are baked (2.4.6); another tier, if the
  // quality changes later, bakes lazily through the same cache.
  const tiersNeeded = quality === 'high' ? ['full'] : ['full', 'plain'];
  for (const type of WEAPON_TYPES) for (const tier of tiersNeeded) style.bake(type, tier);
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (getWeaponStyle() === style) {
      setWeaponStyle(null);
      ctx.world?.restyleArmory?.();
    }
    // Mid-compile, three still polls the materials.
    if (compiling) compiling.then(free); else free();
  };
  setWeaponStyle(style);
  ctx.world?.restyleArmory?.();
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx, style);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, weapons, error, uninstall };
}
