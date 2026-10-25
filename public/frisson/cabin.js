// Frisson part: cabin (art/frisson/CABIN.md). The same cabin and layout,
// older and colder: the surface recipes (cabin-surfaces.js, a pure data
// module) restyle world.js's materials through world.setDressing, and the
// dressing (cabin.glb: roof boards, cobwebs, grime, marks and a few props,
// purely visual) hangs under the world's root. Uniforms only for the
// surfaces; the dressing's five materials compile before the first wave.
// A missing or unreadable file is not an error: it warns once, and the other
// half still goes on; with neither, nothing changes. ctx.signal works as for
// the other parts: called off, nothing of it stays on.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { BLOOD_EMISSIVE } from './blood.js';

export const CABIN_FILES = Object.freeze({ surfaces: 'cabin-surfaces.js', dressing: 'cabin.glb' });
export const DRESS_MATERIALS = Object.freeze(['prop', 'metal', 'mark', 'grime', 'web']);
export const DRESS_DOORS = Object.freeze({ north: 'Dress_Door_North', south: 'Dress_Door_South', west: 'Dress_Door_West', east: 'Dress_Door_East' });
const DOOR_ROOTS = Object.freeze(Object.values(DRESS_DOORS));
// Section 4.4: per root, its triangles, its meshes (one per material) and
// the materials it may use.
export const DRESS_ROOTS = Object.freeze({
  Dress_Core: Object.freeze({ triangles: 6000, meshes: 5, materials: DRESS_MATERIALS, required: true }),
  Dress_Full: Object.freeze({ triangles: 5000, meshes: 4, materials: DRESS_MATERIALS }),
  Dress_High: Object.freeze({ triangles: 4000, meshes: 3, materials: Object.freeze(['web', 'prop', 'grime']) }),
  ...Object.fromEntries(DOOR_ROOTS.map(name => [name, Object.freeze({ triangles: 400, meshes: 1, materials: Object.freeze(['mark']) })])),
});
// Section 4.6: what each graphics preset shows, and its whole budget.
export const DRESS_PRESETS = Object.freeze({
  low: Object.freeze({ roots: Object.freeze(['Dress_Core', ...DOOR_ROOTS]), half: true, drawCalls: 9, triangles: 7600 }),
  medium: Object.freeze({ roots: Object.freeze(['Dress_Core', 'Dress_Full', ...DOOR_ROOTS]), half: false, drawCalls: 13, triangles: 12600 }),
  high: Object.freeze({ roots: Object.freeze(['Dress_Core', 'Dress_Full', 'Dress_High', ...DOOR_ROOTS]), half: false, drawCalls: 16, triangles: 16600 }),
});
const COMPILE_TIMEOUT = 5000;
const warn = message => globalThis.console?.warn?.(`Frisson cabin: ${message}`);
export const presetOf = quality => {
  const id = typeof quality === 'string' ? quality : quality?.id;
  return Object.hasOwn(DRESS_PRESETS, id) ? id : 'medium';
};

// --- The surface recipes -----------------------------------------------------------
// The seed of world.js's canvasTexture: a texture's name gives its draw.
export function recipeRandom(name) {
  let seed = [...String(name)].reduce((sum, char) => sum * 31 + char.charCodeAt(0) >>> 0, 2166136261);
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
// An opaque CSS colour (#rrggbb or rgb()) as [r, g, b] in 0-255, or null.
export function cssColour(value) {
  if (typeof value !== 'string') return null;
  let match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (match) return match.slice(1).map(part => parseInt(part, 16));
  match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  const channels = match?.slice(1).map(Number);
  return channels?.every(channel => channel <= 255) ? channels : null;
}
const whole = (value, min = 1) => Number.isInteger(value) && value >= min;
// A recipe's shape, or a refusal naming what is wrong: size and grid are
// [width, height] in pixels and cells, the cells a whole, even number of
// pixels so that the half-size draw (low) keeps whole cells.
export function recipeShape(name, recipe) {
  const { size, grid, draw } = recipe ?? {};
  if (!Array.isArray(size) || size.length !== 2 || !size.every(value => whole(value))) throw new Error(`texture ${name}: size must be [width, height] in pixels`);
  if (!Array.isArray(grid) || grid.length !== 2 || !grid.every(value => whole(value))) throw new Error(`texture ${name}: grid must be [columns, rows] of cells`);
  for (const axis of [0, 1]) if (size[axis] % grid[axis] || (size[axis] / grid[axis]) % 2) throw new Error(`texture ${name}: ${size[axis]} px over ${grid[axis]} cells is not a whole, even number of pixels per cell`);
  if (typeof draw !== 'function') throw new Error(`texture ${name}: draw must be a function`);
  return { size: [size[0], size[1]], grid: [grid[0], grid[1]] };
}
// Draws recipe `name` on `context` (a 2D context of the full size, or half
// of it with half: true) through its helpers only: rect(x, y, w, h, colour)
// in whole cells with an opaque colour, wrapped across the tile's edges, and
// random(). Throws on anything else.
export function drawRecipe(name, recipe, context, { half = false } = {}) {
  const { size, grid } = recipeShape(name, recipe), [columns, rows] = grid;
  const cellX = size[0] / columns / (half ? 2 : 1), cellY = size[1] / rows / (half ? 2 : 1);
  const fill = (x, y, w, h, colour) => { context.fillStyle = colour; context.fillRect(x * cellX, y * cellY, w * cellX, h * cellY); };
  const rect = (x, y, w, h, colour) => {
    if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1) throw new Error(`texture ${name}: rect(${x}, ${y}, ${w}, ${h}) must use whole cells`);
    if (!cssColour(colour)) throw new Error(`texture ${name}: ${JSON.stringify(colour)} is not an opaque #rrggbb or rgb() colour`);
    w = Math.min(w, columns); h = Math.min(h, rows);
    x = (x % columns + columns) % columns; y = (y % rows + rows) % rows;
    for (const [left, width] of x + w > columns ? [[x, columns - x], [0, x + w - columns]] : [[x, w]])
      for (const [top, height] of y + h > rows ? [[y, rows - y], [0, y + h - rows]] : [[y, h]]) fill(left, top, width, height, colour);
  };
  recipe.draw({ rect, random: recipeRandom(name), grid: [columns, rows] });
}
function canvasFor(doc, width, height) {
  const canvas = doc?.createElement?.('canvas') ?? (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : null);
  if (!canvas) throw new Error('no canvas to draw on');
  canvas.width = width; canvas.height = height;
  return canvas;
}
// The game's filtering: sRGB, linear with mipmaps, anisotropy 4.
export function recipeTexture(name, recipe, { half = false, document: doc = globalThis.document } = {}) {
  const { size } = recipeShape(name, recipe), width = half ? size[0] / 2 : size[0], height = half ? size[1] / 2 : size[1];
  const canvas = canvasFor(doc, width, height), context = canvas.getContext('2d');
  if (!context) throw new Error(`texture ${name}: no 2D context`);
  drawRecipe(name, recipe, context, { half });
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `frissonCabin-${name}`; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}
const COLOUR_KEYS = ['color', 'roughness', 'metalness', 'opacity'];
// The world's dressing surfaces and objects from the recipes module. A
// texture that fails leaves its keys out (with one warning), so no surface
// keeps a white colour meant for a missing map.
export function surfacesFrom(module, { half = false, document: doc } = {}) {
  const recipes = module?.CABIN_SURFACES;
  if (!recipes || typeof recipes !== 'object') throw new Error(`${CABIN_FILES.surfaces} exports no CABIN_SURFACES`);
  const textures = new Map(), failed = new Set(), surfaces = {};
  for (const [key, look] of Object.entries(recipes)) {
    if (!look || typeof look !== 'object') continue;
    const entry = {};
    for (const name of COLOUR_KEYS) if (look[name] !== undefined) entry[name] = look[name];
    if (look.texture !== undefined) {
      const name = look.texture;
      if (!textures.has(name) && !failed.has(name)) {
        try {
          if (!Object.hasOwn(module.CABIN_TEXTURES ?? {}, name)) throw new Error(`texture ${name} is not in CABIN_TEXTURES`);
          textures.set(name, recipeTexture(name, module.CABIN_TEXTURES[name], { half, document: doc }));
        } catch (error) { failed.add(name); warn(`${key} keeps its Famille look: ${error?.message ?? error}`); }
      }
      if (!textures.has(name)) continue;
      entry.map = textures.get(name);
    }
    surfaces[key] = entry;
  }
  const objects = module.CABIN_OBJECTS && typeof module.CABIN_OBJECTS === 'object' ? { ...module.CABIN_OBJECTS } : {};
  return { surfaces, objects, textures: [...textures.values()] };
}
// The recipes module from its bytes: a data module with no imports, run as
// one (the bytes come from the pack's own folder, like every part).
export async function importSurfaces(bytes) {
  const text = new TextDecoder().decode(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(0));
  if (!text.trim()) throw new Error(`${CABIN_FILES.surfaces} is empty`);
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(text)}`);
}

// --- The dressing ----------------------------------------------------------------------
// The five materials, built by name (the file's own values are ignored).
export function dressingMaterial(name) {
  const shared = { vertexColors: true };
  const material = name === 'prop' ? new THREE.MeshStandardMaterial({ ...shared, flatShading: true, roughness: .9, metalness: 0 })
    : name === 'metal' ? new THREE.MeshStandardMaterial({ ...shared, flatShading: true, roughness: .6, metalness: .45 })
    : name === 'mark' ? new THREE.MeshLambertMaterial({ ...shared, flatShading: true, emissive: BLOOD_EMISSIVE, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    // A multiplier on the final pixel: white changes nothing.
    : name === 'grime' ? new THREE.MeshBasicMaterial({ ...shared, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false,
      fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    : name === 'web' ? new THREE.MeshLambertMaterial({ ...shared, transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false })
    : null;
  if (!material) throw new Error(`unknown dressing material ${name}`);
  material.name = `frissonCabin-${name}`;
  return material;
}
// Sorts a read GLB into its roots ({ name -> { material -> geometry } }),
// refusing what the layout does not allow (section 4.4). Budgets and
// placement are the checker's (tools/frisson-glb-check.mjs --cabin).
export function dressingRoots({ roots }) {
  const found = new Map();
  for (const root of roots) {
    const spec = DRESS_ROOTS[root.name];
    if (!spec) throw new Error(`GLB: root ${root.name} is not one of ${Object.keys(DRESS_ROOTS).join(', ')}`);
    if (found.has(root.name)) throw new Error(`GLB: ${root.name} appears twice`);
    if (root.mesh) throw new Error(`GLB: ${root.name} must be an empty`);
    const channels = {};
    for (const child of root.children) {
      const material = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!spec.materials.includes(material)) throw new Error(`GLB: ${child.name} is not one of ${spec.materials.map(name => `${root.name}_${name}`).join(', ')}`);
      if (channels[material]) throw new Error(`GLB: ${child.name} appears twice`);
      if (!child.mesh || child.children.length) throw new Error(`GLB: ${child.name} must be a mesh without children`);
      if (!child.mesh.geometry.attributes.color) throw new Error(`GLB: ${child.name} has no COLOR_0`);
      channels[material] = child.mesh.geometry;
    }
    found.set(root.name, channels);
  }
  if (!found.has('Dress_Core')) throw new Error('GLB: Dress_Core is missing');
  return found;
}
// The props for a preset: a group of the preset's roots, each a group of
// one mesh per material. Geometries of the other roots are freed at once.
export function buildDressing(glb, preset, made) {
  const roots = dressingRoots(glb), keep = DRESS_PRESETS[presetOf(preset)].roots, group = new THREE.Group();
  for (const [name, channels] of roots) {
    if (!keep.includes(name)) { for (const geometry of Object.values(channels)) geometry.dispose(); continue; }
    const node = new THREE.Group(); node.name = name; group.add(node);
    for (const material of DRESS_MATERIALS) {
      const geometry = channels[material];
      if (!geometry) continue;
      made.materials[material] ??= dressingMaterial(material);
      const mesh = new THREE.Mesh(geometry, made.materials[material]);
      mesh.name = `${name}_${material}`; mesh.castShadow = false; mesh.receiveShadow = material === 'prop' || material === 'metal';
      if (material === 'grime') mesh.renderOrder = -1;
      mesh.matrixAutoUpdate = false; node.add(mesh); made.geometries.push(geometry);
    }
    node.matrixAutoUpdate = false;
  }
  return group;
}
// Draw calls and triangles the props add (visible meshes, door channels counted).
export function dressingCost(props) {
  let meshes = 0, triangles = 0;
  props?.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; } });
  return { meshes, triangles };
}

// As heads.js: settles when three is done compiling, never rejects.
function precompile({ renderer, scene, camera }, props) {
  if (!props || !renderer?.compileAsync || !camera) return null;
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(props, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {});
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Without a world that takes a dressing there is
// nothing to dress (tools, tests of other parts): nothing is fetched.
export async function install(ctx = {}) {
  const { world, signal } = ctx;
  signal?.throwIfAborted();
  const none = { surfaces: null, dressing: null, uninstall() {} };
  if (typeof world?.setDressing !== 'function' || (world.levelId && world.levelId !== 'cabin')) return none;
  const base = ctx.base ?? '/frisson/', preset = presetOf(ctx.quality);
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  const made = { textures: [], geometries: [], materials: {} };
  const free = () => {
    for (const texture of made.textures) texture.dispose();
    for (const geometry of made.geometries) geometry.dispose();
    for (const material of Object.values(made.materials)) material.dispose();
    made.textures.length = made.geometries.length = 0; made.materials = {};
  };
  let surfaces = null, props = null;
  try {
    surfaces = surfacesFrom(await importSurfaces(await fetchAsset(CABIN_FILES.surfaces)), { half: DRESS_PRESETS[preset].half, document: ctx.document ?? globalThis.document });
    made.textures.push(...surfaces.textures);
  } catch (error) {
    if (signal?.aborted) { free(); throw signal.reason; }
    warn(`the surfaces keep their Famille look (${error?.message ?? error})`);
  }
  try {
    const bytes = await fetchAsset(CABIN_FILES.dressing);
    signal?.throwIfAborted();
    props = buildDressing(readGlb(bytes), preset, made);
  } catch (error) {
    if (signal?.aborted) { free(); throw signal.reason; }
    warn(`no dressing (${error?.message ?? error})`);
  }
  if (signal?.aborted) { free(); throw signal.reason; }
  if (!surfaces && !props) return none;
  const dressing = { surfaces: surfaces?.surfaces ?? {}, objects: surfaces?.objects ?? {}, props };
  world.setDressing(dressing);
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (world.dressing === dressing) world.setDressing(null);
    if (compiling) compiling.then(free); else free();
  };
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx, props);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { surfaces: surfaces ? Object.keys(surfaces.surfaces) : null, dressing: props ? { roots: props.children.map(node => node.name), ...dressingCost(props) } : null, props, preset, uninstall };
}
