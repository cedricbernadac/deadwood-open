import * as THREE from '/vendor/three.module.js';
import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR, HAS_SPACE } from './level-config.js';
import { SPACE } from './level-space.js';
import { createSupermarketWorld } from './world-supermarket.js';
import { ARMORY, ARMORY_RACK, LOFT, LOFT_RAIL, EXTERIOR, BARRICADE_BOARDS, INTERIOR_WALLS, INTERIOR_DOORWAYS, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, wallOpenings, enemyProfile, enemyAppearance, RAIDER_APPEARANCE, STAIRS, STAIR_WELL, STAIR_STRINGERS, STAIR_TREADS, FLAMETHROWER, MELEE, MELEE_WEAPONS, SUPPLY_BONUSES, LATE_SUPPLIES, BACKPACK, RADAR, minigunRotorSpeed, EXPEDITION, UMBRELLA, GENERATOR, FUEL_CACHES, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, rainRoofHeight, hasRainShelter, PARTITION_CAPS } from './rules.js';
import { CHARACTER_BONUSES } from './character-bonuses.js';
import { getLanguage, weaponLabel } from './i18n.js';
import { createZombie, setZombieHealth, animateZombie, setZombieBurn, animateZombieBurn, startZombieDeath, animateZombieDeath, disposeZombie, getZombieStyle, ZOMBIE_DEATH_DURATION } from './zombies.js';
import { PartBuilder, mergeGeometries } from './mesh-merge.js';
import { createGroundDecor } from './ground-decor.js';
import { mergeStaticMeshes } from './world-merge.js';
import { createSplinterPool } from './splinters.js';
import { sharedEffects } from './fx.js';
import { launchProjectile, impactBurst, muzzleFlash, createFlameEmitter, explosionBurst, emitBarrelSmoke, emitSignalSmoke, emitSwingTrail, BULLET_SPEED } from './shot-fx.js';
import { createCasingPool } from './casings.js';
// Large level worlds, their decor, lights and GLB loading are fetched only on
// their own map; the cabin and the supermarket never download them.
const { createHospitalWorld } = IS_HOSPITAL ? await import('./world-hospital.js') : {};
const { createFunfairWorld } = IS_FUNFAIR ? await import('./world-funfair.js') : {};

// Everything in Deadwood is built locally. No asset download is required.
// Zombies live in zombies.js; the clients keep importing them from here.
export { createZombie, setZombieHealth, animateZombie, setZombieBurn, startZombieDeath, animateZombieDeath, disposeZombie, ZOMBIE_DEATH_DURATION };
// A single cached ring material/geometry keeps the slow effect inexpensive and
// independent of the model's own materials (including the Frisson pack).
let frostGeometry, frostMaterial;
export function setZombieFrost(group, slow = 0) {
  if (!group?.userData) return;
  const active = Number.isFinite(slow) && slow > 0 && group.userData.kind !== 'raider';
  let ring = group.userData.frostRing;
  if (!ring && active) {
    frostGeometry ??= new THREE.RingGeometry(.3, .34, 18);
    frostMaterial ??= new THREE.MeshBasicMaterial({ color: 0x9edfff, transparent: true, opacity: .38, depthWrite: false, side: THREE.DoubleSide });
    ring = new THREE.Mesh(frostGeometry, frostMaterial); ring.name = 'frostSlowRing';
    ring.rotation.x = -Math.PI / 2; ring.position.y = .045;
    group.add(ring); group.userData.frostRing = ring;
  }
  if (ring) ring.visible = active;
  group.userData.frostSlow = active ? slow : 0;
}
const palette = { timber: 0xbea690, trim: 0x2a2523, amber: 0xffc48c, teal: 0x65a9b4 };
const mats = {};
// The cabin's dressing (world.setDressing; the contract is CABIN.md in the
// art folder): the cached materials a dressing may restyle, the ground decor
// it may hide or recolour, and the door channels of its props. Everything
// that carries gameplay (signs, weapons, pickups, the crate, the gauge,
// spawn marks, zombies, survivors) is left out on purpose.
export const DRESSING_SURFACE_KEYS = Object.freeze(['wood', 'gable', 'interiorTimber', 'floor', 'boards', 'trim', 'roof', 'interiorPlaster',
  'interiorWainscot', 'interiorSkirting', 'foundation', 'brokenGlass', 'boardedGap', 'metal', 'sofa', 'cushion', 'paper', 'rackTimber', 'rackTrim',
  'rackIron', 'lateSupplyTimber', 'lateSupplyMetal', 'generatorChassis', 'generatorPaint', 'ground', 'clearingEarth', 'escapeTrail', 'distantRunoff',
  'trunk', 'needles', 'needletips', 'rock']);
export const DRESSING_OBJECT_KEYS = Object.freeze(['decorFlowerHeads', 'decorFlowerStems', 'decorGlowingCaps']);
export const DRESSING_DOOR_CHANNELS = Object.freeze({ north: 'Dress_Door_North', south: 'Dress_Door_South', west: 'Dress_Door_West', east: 'Dress_Door_East' });
// The cache is module-wide, so one dressing is on per page: this takes it
// off the world that has it.
let dressingOff = null;
const WEAPON_MODELS = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum', 'assault', 'rocket', 'flamethrower', 'katana', 'hammer', 'sniper', 'bat', 'fireaxe'];
const SMG_MODEL_SCALE = .72;
let woodTexture;
function material(name, color, roughness = 0.85, extra = {}) {
  return mats[name] ||= new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}
function box(parent, x, y, z, w, h, d, mat, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cylinder(parent, x, y, z, rt, rb, h, mat, sides = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, sides), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function sphere(parent, x, y, z, radius, mat, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function makeWoodTexture() {
  if (woodTexture) return woodTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = '#a2937c';
  c.fillRect(0, 0, 256, 256);
  let seed = 73517;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 450; i++) {
    const y = rand() * 256;
    c.strokeStyle = `rgba(${rand() > .5 ? '44,28,19' : '223,202,167'},${.03 + rand() * .09})`;
    c.beginPath(); c.moveTo(0, y);
    c.bezierCurveTo(70, y + rand() * 5, 180, y - rand() * 5, 256, y + rand() * 2); c.stroke();
  }
  for (let y = 0; y < 256; y += 64) {
    c.fillStyle = '#55483c'; c.fillRect(0, y, 256, 2);
    c.fillStyle = 'rgba(238,220,187,.2)'; c.fillRect(0, y + 2, 256, 1);
    for (const x of [8, 248]) { c.fillStyle = '#554e43'; c.fillRect(x, y + 7, 2, 2); c.fillRect(x, y + 54, 2, 2); }
  }
  woodTexture = new THREE.CanvasTexture(canvas);
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(2, 2);
  return woodTexture;
}
function sign(parent, label, x, y, z, rotation = 0, width = 1.7) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const c = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide }));
  mesh.position.set(x, y, z); mesh.rotation.y = rotation; parent.add(mesh);
  mesh.userData.setLabel = value => {
    if (mesh.userData.label === value) return;
    c.fillStyle = '#29251f'; c.fillRect(0, 0, 512, 128);
    c.strokeStyle = '#9d8867'; c.lineWidth = 5; c.strokeRect(8, 8, 496, 112);
    c.fillStyle = '#d8c49c'; c.font = 'bold 42px monospace';
    for (let size = 41; c.measureText(value).width > 470 && size >= 20; size--) c.font = `bold ${size}px monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, 256, 65);
    mesh.userData.label = value; texture.needsUpdate = true;
  };
  mesh.userData.setLabel(label);
  return mesh;
}

// Storybook night: indigo zenith, teal horizon. The fog uses the horizon
// colour exactly (fog is applied after tone mapping), so silhouettes emerge
// from the sky itself. Sky pieces are therefore not tone mapped either.
const NIGHT = { zenith: 0x080c27, upper: 0x131b45, middle: 0x203761, horizon: 0x284c58, below: 0x1b3640,
  farTrees: 0x1d3a47, nearTrees: 0x132a35, moon: 0xf4efd6, moonHalo: 0x9cbcf0 };
// Graphics presets live in graphics-quality.js; this default keeps tests,
// previews and older callers on the medium budget.
const DEFAULT_QUALITY = Object.freeze({ id: 'medium', shadows: false, shadowMapSize: 1024, fireflies: 100, groundDetail: .7, rainFraction: 1 });
let glowTextureCache;
// A soft round sprite. The tests' fake 2D context returns no gradients, so
// the fallback draws stacked translucent discs instead.
function glowTexture() {
  if (glowTextureCache) return glowTextureCache;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d'), gradient = c.createRadialGradient?.(32, 32, 0, 32, 32, 32);
  if (gradient?.addColorStop) {
    for (const [stop, alpha] of [[0, 1], [.18, .85], [.42, .32], [.7, .08], [1, 0]]) gradient.addColorStop(stop, `rgba(255,255,255,${alpha})`);
    c.fillStyle = gradient; c.fillRect(0, 0, 64, 64);
  } else for (let radius = 32; radius > 0; radius -= 4) {
    c.fillStyle = `rgba(255,255,255,${.12 * (1 - radius / 34)})`; c.beginPath?.(); c.arc?.(32, 32, radius, 0, Math.PI * 2); c.fill?.();
  }
  glowTextureCache = new THREE.CanvasTexture(canvas); glowTextureCache.colorSpace = THREE.SRGBColorSpace;
  return glowTextureCache;
}
function createNightSky(seed = 9157) {
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const sky = new THREE.Group(); sky.name = 'nightSky';
  const radius = 112, color = new THREE.Color(), next = new THREE.Color();
  const dome = new THREE.SphereGeometry(radius, 36, 24), position = dome.attributes.position, colors = [];
  const stops = [[-1, NIGHT.below], [-.02, NIGHT.horizon], [.04, NIGHT.horizon], [.16, NIGHT.middle], [.42, NIGHT.upper], [1, NIGHT.zenith]];
  // Stop colours are hex numbers or THREE.Color (a mood's regraded sky).
  function paint(stops, target) {
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index) / radius;
      let stop = 0; while (stop < stops.length - 2 && y > stops[stop + 1][0]) stop++;
      const [from, low] = stops[stop], [to, high] = stops[stop + 1], t = THREE.MathUtils.clamp((y - from) / (to - from), 0, 1);
      color.set(low).lerp(next.set(high), t * t * (3 - 2 * t));
      target[index * 3] = color.r; target[index * 3 + 1] = color.g; target[index * 3 + 2] = color.b;
    }
  }
  paint(stops, colors);
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const unlit = extra => new THREE.MeshBasicMaterial({ fog: false, depthWrite: false, toneMapped: false, ...extra });
  const domeMesh = new THREE.Mesh(dome, unlit({ vertexColors: true, side: THREE.BackSide }));
  domeMesh.name = 'skyDome'; domeMesh.renderOrder = -10; sky.add(domeMesh);
  // Two rings of jagged fir tops on the horizon: the forest reads in every
  // direction although real trees stay outside the walkable clearing.
  function treeline(distance, low, high, step, hex, order) {
    const vertices = [];
    for (let angle = 0; angle < Math.PI * 2 - 1e-6;) {
      const width = step * (.6 + random() * .9), height = low + random() * (high - low), mid = angle + width / 2, end = angle + width;
      const point = (theta, y) => vertices.push(Math.cos(theta) * distance, y, Math.sin(theta) * distance);
      // Band below the tree line, then a two-tier fir silhouette.
      point(angle, -30); point(end, -30); point(end, low * .45); point(angle, -30); point(end, low * .45); point(angle, low * .45);
      point(angle - width * .15, low * .45); point(end + width * .15, low * .45); point(mid, height * .72);
      point(angle + width * .1, height * .55); point(end - width * .1, height * .55); point(mid, height);
      angle = end;
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const mesh = new THREE.Mesh(geometry, unlit({ color: hex, side: THREE.DoubleSide })); mesh.renderOrder = order; sky.add(mesh);
    return mesh;
  }
  const farTrees = treeline(104, 5, 13, .05, NIGHT.farTrees, -9); farTrees.name = 'farTreeline';
  const nearTrees = treeline(98, 3.5, 9.5, .07, NIGHT.nearTrees, -8); nearTrees.name = 'nearTreeline';
  const starPositions = [], starColors = [];
  for (let index = 0; index < 420; index++) {
    const theta = random() * Math.PI * 2, y = .1 + random() ** .7 * .9, ring = Math.sqrt(1 - y * y), light = .35 + random() * .65;
    starPositions.push(Math.cos(theta) * ring * 106, y * 106, Math.sin(theta) * ring * 106);
    starColors.push(light * (.85 + random() * .15), light * .92, light);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: glowTexture(),
    transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  stars.name = 'stars'; stars.renderOrder = -9.5; sky.add(stars);
  // The storybook moon sits low over the trees in the moonlight's azimuth.
  const moonDirection = new THREE.Vector3(-13, 0, -14).normalize().multiplyScalar(Math.cos(.38)).setY(Math.sin(.38));
  const moon = new THREE.Mesh(new THREE.CircleGeometry(5.2, 40), unlit({ color: NIGHT.moon, map: moonTexture(), transparent: true }));
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), unlit({ color: NIGHT.moonHalo, map: glowTexture(), transparent: true, opacity: .42, blending: THREE.AdditiveBlending }));
  for (const [mesh, distance, order] of [[halo, 101, -8.6], [moon, 100, -8.5]]) {
    mesh.position.copy(moonDirection).multiplyScalar(distance); mesh.lookAt(0, 0, 0); mesh.renderOrder = order; sky.add(mesh);
  }
  moon.name = 'moon'; halo.name = 'moonHalo';
  for (const child of sky.children) child.frustumCulled = false;
  // Mood (world.setMood): the horizon band takes the fog colour exactly, so
  // fog and sky stay seamless; the other stops and the tree lines get the
  // same per-channel filter (fog / horizon), and the dome, stars, moon and
  // halo are scaled. Neutral values restore the original colours exactly.
  const domeColors = dome.attributes.color, original = domeColors.array.slice(), filter = new THREE.Color();
  const filtered = [farTrees, nearTrees].map(mesh => [mesh.material, mesh.material.color.clone()]);
  const scaled = [stars, moon].map(mesh => [mesh.material, mesh.material.color.clone()]), haloOpacity = halo.material.opacity;
  sky.userData.setMood = (scale = 1, fog = null) => {
    if (fog === null) filter.setRGB(1, 1, 1);
    else {
      const horizon = color.setHex(NIGHT.horizon), target = next.setHex(fog);
      filter.setRGB(Math.min(3, target.r / horizon.r), Math.min(3, target.g / horizon.g), Math.min(3, target.b / horizon.b));
    }
    if (scale === 1 && fog === null) domeColors.array.set(original);
    else paint(stops.map(([at, hex]) => [at, hex === NIGHT.horizon ? new THREE.Color(fog ?? hex) : new THREE.Color(hex).multiply(filter).multiplyScalar(scale)]), domeColors.array);
    domeColors.needsUpdate = true;
    for (const [material, base] of filtered) material.color.copy(base).multiply(filter);
    for (const [material, base] of scaled) material.color.copy(base).multiplyScalar(scale);
    halo.material.opacity = haloOpacity * scale;
  };
  return sky;
}
let moonTextureCache;
function moonTexture() {
  if (moonTextureCache) return moonTextureCache;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff'; c.beginPath?.(); c.arc?.(64, 64, 63, 0, Math.PI * 2); c.fill?.();
  // Soft grey "seas" give the moon a friendly face-like texture, not a skull.
  for (const [x, y, r, a] of [[46, 50, 20, .12], [80, 42, 13, .1], [72, 82, 22, .09], [40, 86, 9, .1], [92, 70, 7, .12]]) {
    c.fillStyle = `rgba(96,104,128,${a})`; c.beginPath?.(); c.arc?.(x, y, r, 0, Math.PI * 2); c.fill?.();
  }
  moonTextureCache = new THREE.CanvasTexture(canvas); moonTextureCache.colorSpace = THREE.SRGBColorSpace;
  return moonTextureCache;
}
// Procedural storybook textures. Only fillRect and simple paths are used, so
// the tests' fake 2D context can run every builder.
const textureCache = {};
function canvasTexture(name, width, height, draw, { repeat = [1, 1], anisotropy = 4 } = {}) {
  if (textureCache[name]) return textureCache[name];
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  let seed = [...name].reduce((sum, char) => sum * 31 + char.charCodeAt(0) >>> 0, 2166136261);
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  draw(canvas.getContext('2d'), random);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(...repeat); texture.anisotropy = anisotropy;
  return textureCache[name] = texture;
}
const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
// Eight horizontal 30 cm planks per 2.4 m tile: gentle tone changes, a soft
// top highlight, a dark groove and one long butt joint per board.
function plankTexture(name = 'planks', tone = [150, 116, 88]) {
  return canvasTexture(name, 512, 512, (c, random) => {
    for (let row = 0; row < 8; row++) {
      const y = row * 64, shade = .9 + random() * .16;
      const base = [tone[0] * shade, tone[1] * shade, tone[2] * shade * (.96 + random() * .08)];
      c.fillStyle = rgb(...base); c.fillRect(0, y, 512, 64);
      for (let line = 0; line < 4; line++) {
        const gy = y + 12 + random() * 40, dark = .9 + random() * .05;
        c.fillStyle = rgb(base[0] * dark, base[1] * dark, base[2] * dark); c.fillRect(0, gy, 512, 1);
      }
      c.fillStyle = 'rgba(255,238,206,.16)'; c.fillRect(0, y + 1, 512, 2);
      c.fillStyle = 'rgba(48,30,18,.55)'; c.fillRect(0, y + 61, 512, 3);
      const joint = 40 + random() * 430;
      c.fillStyle = 'rgba(48,30,18,.45)'; c.fillRect(joint, y + 1, 2, 60);
      c.fillStyle = 'rgba(70,70,74,.7)'; c.fillRect(joint - 7, y + 29, 3, 3); c.fillRect(joint + 6, y + 29, 3, 3);
    }
  });
}
// One barricade plank: lighter fresh wood, bevelled edges and nail heads.
function boardTexture() {
  return canvasTexture('board', 256, 32, (c, random) => {
    c.fillStyle = rgb(196, 150, 100); c.fillRect(0, 0, 256, 32);
    for (let line = 0; line < 4; line++) { c.fillStyle = 'rgba(120,80,48,.35)'; c.fillRect(0, 6 + random() * 20, 256, 1); }
    c.fillStyle = 'rgba(255,240,210,.3)'; c.fillRect(0, 1, 256, 3);
    c.fillStyle = 'rgba(70,42,24,.6)'; c.fillRect(0, 28, 256, 4); c.fillRect(0, 0, 2, 32); c.fillRect(254, 0, 2, 32);
  });
}
// Shingle rows run along the ridge (texture u = across the slope).
function shingleTexture() {
  return canvasTexture('shingles', 256, 256, (c, random) => {
    for (let column = 0; column < 8; column++) {
      const x = column * 32;
      for (let y = column % 2 ? -16 : 0; y < 256; y += 32) {
        const shade = .8 + random() * .35;
        c.fillStyle = rgb(78 * shade, 92 * shade, 110 * shade); c.fillRect(x, y, 32, 32);
        c.fillStyle = 'rgba(14,18,26,.75)'; c.fillRect(x + 27, y, 5, 32); c.fillRect(x, y + 30, 32, 2);
        c.fillStyle = 'rgba(200,215,235,.14)'; c.fillRect(x + 1, y + 2, 4, 26);
      }
    }
  }, { repeat: [8.65 / 2.2, 13 / 2.2] });
}
// Blue-green night grass: soft clumps, then short blades of two tones.
function grassTexture() {
  return canvasTexture('grass', 256, 256, (c, random) => {
    c.fillStyle = rgb(54, 86, 72); c.fillRect(0, 0, 256, 256);
    const blob = (x, y, r, style) => { c.fillStyle = style; c.beginPath?.(); c.ellipse?.(x, y, r, r * (.5 + random() * .4), random() * 3, 0, Math.PI * 2); c.fill?.(); };
    for (let patch = 0; patch < 60; patch++) {
      const shade = .82 + random() * .36, x = random() * 256, y = random() * 256, r = 8 + random() * 26;
      // Wrap clumps across the tile edge so the repeat stays invisible.
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256])
        blob(x + dx, y + dy, r, `rgba(${Math.round(68 * shade)},${Math.round(108 * shade)},${Math.round(84 * shade)},.28)`);
    }
    for (let blade = 0; blade < 1100; blade++) {
      c.fillStyle = random() > .55 ? 'rgba(122,164,120,.42)' : 'rgba(30,54,44,.45)';
      c.fillRect(random() * 256, random() * 256, 1, 2 + random() * 4);
    }
  });
}
function repeatedTexture(texture, x, y) {
  const copy = texture.clone(); copy.repeat.set(x, y); copy.needsUpdate = true; return copy;
}
// Maps a material's texture from world coordinates (box projection), so
// planks keep one scale across every wall section, seal and gable.
function worldMapped(material, metersPerTile) {
  material.onBeforeCompile = shader => {
    shader.uniforms.worldMapScale = { value: 1 / metersPerTile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldMapPosition;\nvarying vec3 vWorldMapNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldMapPosition = (modelMatrix * vec4(position, 1.0)).xyz;\nvWorldMapNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float worldMapScale;\nvarying vec3 vWorldMapPosition;\nvarying vec3 vWorldMapNormal;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec3 worldWeights = pow(abs(normalize(vWorldMapNormal)), vec3(8.0));
        worldWeights /= worldWeights.x + worldWeights.y + worldWeights.z;
        vec3 worldUv = vWorldMapPosition * worldMapScale;
        diffuseColor *= texture2D(map, worldUv.zy) * worldWeights.x + texture2D(map, worldUv.xz) * worldWeights.y + texture2D(map, worldUv.xy) * worldWeights.z;
      #endif`);
  };
  material.customProgramCacheKey = () => `worldMapped:${metersPerTile}`;
  return material;
}
// Moon shadows (high quality only): one shadow map that follows the camera,
// snapped to whole texels so edges do not shimmer while walking. No light is
// added or removed; only the existing moon starts casting.
export const MOON_SHADOW = Object.freeze({ halfSize: 26, distance: 60, near: 1, far: 140 });
// The teammate flashlight cones' base opacity; a mood's `beams` scales it.
const TEAMMATE_BEAM_OPACITY = .035;
function moonShadows(scene, moon, quality) {
  const size = quality?.shadows ? quality.shadowMapSize || 2048 : 0;
  if (!size) return null;
  moon.castShadow = true;
  moon.shadow.mapSize.set(size, size);
  Object.assign(moon.shadow.camera, { left: -MOON_SHADOW.halfSize, right: MOON_SHADOW.halfSize, top: MOON_SHADOW.halfSize, bottom: -MOON_SHADOW.halfSize, near: MOON_SHADOW.near, far: MOON_SHADOW.far });
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -.0005; moon.shadow.normalBias = .035;
  scene.add(moon.target);
  const direction = moon.position.clone().normalize(), center = new THREE.Vector3();
  const texel = MOON_SHADOW.halfSize * 2 / size;
  // Two axes across the light direction for snapping.
  const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  return {
    follow(camera) {
      if (camera) camera.getWorldPosition(center); else center.set(0, 0, 0);
      center.y = 0;
      const x = Math.round(center.dot(right) / texel) * texel, y = Math.round(center.dot(up) / texel) * texel, z = center.dot(direction);
      center.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(direction, z);
      moon.target.position.copy(center);
      moon.position.copy(center).addScaledVector(direction, MOON_SHADOW.distance);
    },
  };
}
// Fireflies drift around the clearing: tiny additive points, no lights.
function createFireflies(count, seed = 4421) {
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const base = new Float32Array(count * 4), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    // Around the cabin walls and along the clearing, never inside the cabin.
    let x, z; do { x = (random() - .5) * 46; z = (random() - .5) * 34; } while (Math.abs(x) < 9.2 && Math.abs(z) < 7.2);
    base.set([x, .35 + random() * 2.4, z, random() * Math.PI * 2], index * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: .16, map: glowTexture(), vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.name = 'fireflies'; points.frustumCulled = false;
  points.userData.update = time => {
    for (let index = 0; index < count; index++) {
      const x = base[index * 4], y = base[index * 4 + 1], z = base[index * 4 + 2], phase = base[index * 4 + 3];
      positions[index * 3] = x + Math.sin(time * .31 + phase) * 1.4 + Math.sin(time * .9 + phase * 3) * .25;
      positions[index * 3 + 1] = y + Math.sin(time * .53 + phase * 2) * .35;
      positions[index * 3 + 2] = z + Math.cos(time * .27 + phase) * 1.4;
      // Each one blinks slowly: mostly dim, briefly bright yellow-green.
      const blink = Math.max(0, Math.sin(time * (.7 + (phase % 1) * .6) + phase * 7)) ** 6, glow = .12 + blink * .95;
      colors[index * 3] = glow * .78; colors[index * 3 + 1] = glow; colors[index * 3 + 2] = glow * .38;
    }
    geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
  };
  points.userData.update(0);
  return points;
}

// loadReflector: the funfair mirrors' Reflector.js loader (tests only).
export function createWorld(scene, { quality = DEFAULT_QUALITY, mergeStatic = true, loadDecor, loadReflector } = {}) {
  if (IS_FUNFAIR) return createFunfairWorld(scene, { quality, mergeStatic, loadDecor, loadReflector }, { sign, createArmoryRack, buildRackWeapon, createSupplyCrate, createLateSupplyPost, createExpeditionEffects, moonShadows, supplyBeaconFlash, SUPPLY_BEACON, boardWood: material('boards', 0xf2e2cc, .88, { map: boardTexture() }),
    glowTexture, NIGHT, grassTexture, repeatedTexture, createNightSky,
    // The mirror maze draws the local survivor with the teammates' pipeline.
    createSurvivor, setSurvivorWeapon, setSurvivorSecondaryWeapon, animateSurvivor, getSurvivorStyle, createUmbrella });
  if (IS_HOSPITAL) return createHospitalWorld(scene, { quality, mergeStatic, loadDecor }, { sign, createArmoryRack, buildRackWeapon, createSupplyCrate, createLateSupplyPost, createExpeditionEffects, moonShadows, supplyBeaconFlash, SUPPLY_BEACON, boardWood: material('boards', 0xf2e2cc, .88, { map: boardTexture() }),
    glowTexture, NIGHT, grassTexture, repeatedTexture, createNightSky });
  if (IS_SUPERMARKET) return createSupermarketWorld(scene, { quality, mergeStatic, loadDecor }, { sign, createArmoryRack, buildRackWeapon, createSupplyCrate, createLateSupplyPost, createExpeditionEffects, moonShadows, supplyBeaconFlash, SUPPLY_BEACON, boardWood: material('boards', 0xf2e2cc, .88, { map: boardTexture() }),
    glowTexture, NIGHT, grassTexture, repeatedTexture, createNightSky });
  const root = new THREE.Group(); scene.add(root);
  const doors = new Map(), shelterSigns = new Map(); const rayBlockers = [];
  let language = getLanguage();
  const localizedSigns = [];
  function localizedSign(parent, label, ...placement) {
    const mesh = sign(parent, label(language), ...placement);
    localizedSigns.push({ mesh, label });
    return mesh;
  }
  // Honey planks mapped in world space: one plank size on every wall,
  // seal and gable. Barricade boards keep their own single-plank texture.
  const wood = worldMapped(material('wood', palette.timber, .9, { map: plankTexture() }), 2.4);
  const floor = worldMapped(material('floor', 0xcdbba4, .92, { map: plankTexture('floorPlanks', [160, 126, 96]) }), 2.4);
  const boardWood = material('boards', 0xf2e2cc, .88, { map: boardTexture() });
  const trim = material('trim', palette.trim);
  const metal = material('metal', 0x343c3e, .45, { metalness: .7 });
  const cloth = material('cloth', 0x424936);
  const glass = material('brokenGlass', 0x9cc3c6, .08, { transparent: true, opacity: .42, metalness: .35, side: THREE.DoubleSide, depthWrite: false });
  const glow = material('glow', 0xffd29b, .2, { emissive: 0xffab55, emissiveIntensity: 2.3 });
  rayBlockers.push(box(root, 0, -.22, 0, 16.5, .44, 12.5, floor, false));
  box(root, 0, -.57, 0, 17, .25, 13, material('foundation', 0x464846), false);
  box(root, 0, -.12, 0, Math.max(110, EXTERIOR.bounds.maxX - EXTERIOR.bounds.minX + 16), .2,
    Math.max(110, EXTERIOR.bounds.maxZ - EXTERIOR.bounds.minZ + 16), material('ground', 0x9fb0a6, 1, { map: repeatedTexture(grassTexture(), 74, 36) }), false);
  // A flat clearing matches the authoritative outdoor ground and leaves a
  // complete escape route between all four doors.
  const earth = material('clearingEarth', 0xc4d2c4, .99, { map: repeatedTexture(grassTexture(), (EXTERIOR.bounds.maxX - EXTERIOR.bounds.minX + 1) / 3.2, (EXTERIOR.bounds.maxZ - EXTERIOR.bounds.minZ + 1) / 3.2) });
  const clearingWidth = EXTERIOR.bounds.maxX - EXTERIOR.bounds.minX;
  const clearingDepth = EXTERIOR.bounds.maxZ - EXTERIOR.bounds.minZ;
  const clearing = box(root, 0, -.016, 0, clearingWidth + 1, .02, clearingDepth + 1, earth, false);
  clearing.name = 'expedition-clearing';
  const trail = material('escapeTrail', 0x55503c, .99);
  for (const z of [-7.8, 7.8]) box(root, 0, -.003, z, 22, .006, 2.6, trail, false);
  for (const x of [-9.8, 9.8]) box(root, x, -.003, 0, 2.6, .006, 18.2, trail, false);
  for (const cache of FUEL_CACHES) {
    const startX = Math.sign(cache.x) * 9.8, startZ = Math.sign(cache.z) * 7.8;
    const path = box(root, (cache.x + startX) / 2, -.001, (cache.z + startZ) / 2,
      2, .008, Math.hypot(cache.x - startX, cache.z - startZ) + 1, trail, false);
    path.rotation.y = Math.atan2(cache.x - startX, cache.z - startZ);
    path.name = 'fuel-cache-trail';
  }
  // Two long, open approaches offer visible distant arrivals. They are flat
  // ground paint, so these sight lines cannot introduce a hidden AI obstacle.
  const distantApproaches = new THREE.Group(); distantApproaches.name = 'distantApproaches'; root.add(distantApproaches);
  for (const end of FAR_SPAWN_ENTRIES) {
    const side = Math.sign(end.x), start = { x: side * 9.8, z: -side * 3.5 };
    const approach = box(distantApproaches, (start.x + end.x) / 2, -.002, (start.z + end.z) / 2,
      8.8, .007, Math.hypot(end.x - start.x, end.z - start.z) + 3, trail, false);
    approach.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
    approach.name = side < 0 ? 'westDistantClearing' : 'eastDistantClearing';
    const runoff = material('distantRunoff', 0x323e35, .99);
    for (const offset of [-2.6, 2.6]) {
      const rut = box(approach, offset, .005, 0, .34, .008, approach.geometry.parameters.depth - 1, runoff, false);
      rut.name = 'distantTrailRut';
    }
  }
  // Low mist marks the clearing's edge without a fence across zombie arrivals.
  const edgeMist = new THREE.MeshBasicMaterial({color:0x5a8176,transparent:true,opacity:.075,depthWrite:false,side:THREE.DoubleSide});
  for (const z of [EXTERIOR.bounds.minZ, EXTERIOR.bounds.maxZ]) box(root, 0, .55, z, clearingWidth, 1.1, .035, edgeMist, false);
  for (const x of [EXTERIOR.bounds.minX, EXTERIOR.bounds.maxX]) box(root, x, .55, 0, .035, 1.1, clearingDepth, edgeMist, false);
  for (const [id,x,z,rotation] of [['north',0,-6.22,Math.PI],['south',0,6.22,0],['west',-8.22,0,-Math.PI/2],['east',8.22,0,Math.PI/2]]) {
    shelterSigns.set(id, localizedSign(root,lang=>lang==='en'?'SHELTER · COME BACK SOON':'REFUGE · REVIENS VITE',x,2.98,z,rotation,2.5));
  }

  // Jagged pieces of the old panes stay wedged in the open window frames.
  const shardGeometries = [[[0,0],[.34,0],[0,.22]], [[0,0],[.2,0],[.04,.3]], [[0,0],[.16,.02],[.05,.17]], [[0,0],[.26,0],[.21,.12]]]
    .map(points => new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))));
  const boardedGap = material('boardedGap', 0x0f1211, 1);
  // Seen from outside, warm lamplight leaks between the window planks: the
  // cabin looks lived-in and safe. It dims with the generator like the lamps.
  const windowGlow = material('boardedGlow', 0x1c130c, 1, { emissive: 0xffa04a, emissiveIntensity: .42 });
  function shard(frame, geometry, x, y, angle, flip = 1) {
    const mesh = new THREE.Mesh(geometry, glass);
    mesh.position.set(x, y, 0); mesh.rotation.z = angle; mesh.scale.x = flip;
    frame.add(mesh); return mesh;
  }
  function wall({ id, axis, fixed, length, rotation }) {
    const thickness = EXTERIOR_WALL_THICKNESS;
    const section = (center, y, width, height, surface = wood) => {
      if (width <= 0 || height <= 0) return;
      const mesh = axis === 'x' ? box(root, center, y, fixed, width, height, thickness, surface) : box(root, fixed, y, center, thickness, height, width, surface);
      rayBlockers.push(mesh);
      return mesh;
    };
    let cursor = -length / 2;
    for (const opening of wallOpenings(id, { includeBoarded: true })) {
      const a = opening.center - opening.width / 2, b = opening.center + opening.width / 2;
      section((cursor + a) / 2, 3.25, a - cursor, 6.5);
      const below = section(opening.center, opening.bottom / 2, opening.width, opening.bottom);
      const above = section(opening.center, (6.5 + opening.top) / 2, opening.width, 6.5 - opening.top);
      // A nailed-shut window is solid wall for every shot, exactly as on the server.
      if (!opening.open) {
        const gap = section(opening.center, (opening.bottom + opening.top) / 2, opening.width, opening.top - opening.bottom, boardedGap);
        // Box faces: +x, -x, +y, -y, +z, -z; only the outward face glows.
        const faces = Array(6).fill(boardedGap), outward = Math.sign(fixed) > 0 ? 0 : 1;
        faces[(axis === 'x' ? 4 : 0) + outward] = windowGlow; gap.material = faces;
      }
      const frame = new THREE.Group(); frame.position.set(axis === 'x' ? opening.center : fixed, 0, axis === 'x' ? fixed : opening.center); frame.rotation.y = rotation; root.add(frame);
      for (const side of [-1, 1]) box(frame, side * (opening.width / 2 + .025), (opening.bottom + opening.top) / 2, 0, .15, opening.top - opening.bottom + .16, .36, trim);
      box(frame, 0, opening.top, 0, opening.width + .25, .16, .36, trim);
      if (!opening.door) box(frame, 0, opening.bottom, 0, opening.width + .25, .14, .4, trim);
      if (!opening.door && opening.open) {
        const left = -opening.width / 2, right = opening.width / 2;
        shard(frame, shardGeometries[0], left, opening.top - .08, -Math.PI / 2);
        shard(frame, shardGeometries[1], right, opening.top - .08, Math.PI, 1);
        shard(frame, shardGeometries[2], left, opening.bottom + .07, 0);
        shard(frame, shardGeometries[3], right, opening.bottom + .07, 0, -1);
        shard(frame, shardGeometries[2], -.35, opening.top - .08, Math.PI + .3);
        // One slanted bar high in the frame says "not an entrance" while
        // leaving the aiming height clear.
        const bar = box(frame, 0, 2.3, .12, opening.width + .05, .14, .09, wood); bar.rotation.z = .16;
      } else if (!opening.door) {
        // Planks nailed over the outside, thinner battens inside: the
        // racks hanging on the inner face keep their 4.5 cm clearance.
        const outside = -thickness / 2 - .028, inside = thickness / 2 + .015;
        [[1.36, .05], [1.68, -.04], [2.02, .035], [2.36, -.05]].forEach(([y, angle]) => {
          const plank = box(frame, 0, y, outside, opening.width + .14, .23, .05, boardWood); plank.rotation.z = angle;
          for (const side of [-1, 1]) sphere(plank, side * (opening.width / 2 - .02), 0, -.03, .024, metal);
        });
        [[1.5, -.03], [1.95, .04], [2.42, -.02]].forEach(([y, angle]) => {
          box(frame, 0, y, inside, opening.width + .1, .18, .028, boardWood).rotation.z = angle;
        });
      } else {
        const door = new THREE.Group(); frame.add(door); const boards = [];
        for (const geometry of BARRICADE_BOARDS) {
          const board = box(door, 0, geometry.y, 0, geometry.width, geometry.height, geometry.depth, boardWood); board.rotation.z = geometry.angle; boards.push(board);
          for (const sx of [-1, 1]) sphere(board, sx * 1.12, 0, .075, .026, metal);
        }
        door.userData.boards = boards; door.userData.hp = 1; doors.set(id, door);
        // Inactive entrances disappear into an ordinary full-height wall.
        // Using the same orientation, height and material as its neighbours
        // keeps both faces and horizontal plank seams aligned. The opening's
        // upper section is hidden at the same time, avoiding coplanar faces.
        const seal = new THREE.Group(); seal.name = `inactiveDoorWall-${id}`; root.add(seal); seal.visible = false;
        const wallFill = axis === 'x'
          ? box(seal, opening.center, 3.25, fixed, opening.width, 6.5, thickness, wood)
          : box(seal, fixed, 3.25, opening.center, thickness, 6.5, opening.width, wood);
        wallFill.name = 'inactiveDoorTimber';
        Object.assign(door.userData, { seal, wall: wallFill, frame, openingSections: [below, above].filter(Boolean), shelterSign: shelterSigns.get(id) });
        localizedSign(frame, lang => ({fr:{north:'NORD',south:'SUD',west:'OUEST',east:'EST'},en:{north:'NORTH',south:'SOUTH',west:'WEST',east:'EAST'}})[lang][id], 0, 3.03, .19);
      }
      cursor = b;
    }
    section((cursor + length / 2) / 2, 3.25, length / 2 - cursor, 6.5);
  }
  for (const exteriorWall of EXTERIOR_WALLS) wall(exteriorWall);

  for (const x of [-7.83, 7.83]) for (const z of [-5.82, 5.82]) box(root, x, 3.2, z, .34, 6.6, .34, trim);
  for (const z of [-5.8, -2.2, 2.2, 5.8]) {
    box(root, 0, 6.42, z, 16.1, .3, .3, trim);
    for (const x of [-4, 0, 4]) box(root, x, 6.75, z, .2, .85, .2, wood);
  }
  const roofMat = material('roof', 0xffffff, .95, { map: shingleTexture() });
  for (const sx of [-1, 1]) {
    const roof = box(root, sx * 4.15, 7.32, 0, 8.65, .24, 13, roofMat);
    roof.rotation.z = -sx * .21;
    rayBlockers.push(roof);
  }
  box(root, 0, 8.19, 0, .26, .24, 13.1, trim);
  for (const z of [-6, 6]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-8,6.5,z, 8,6.5,z, 0,8.2,z], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 2,0, 1,1], 2));
    geometry.computeVertexNormals();
    const gable = new THREE.Mesh(geometry, worldMapped(material('gable', palette.timber, .9, { map: plankTexture(), side: THREE.DoubleSide }), 2.4));
    gable.castShadow = true; gable.receiveShadow = true; root.add(gable); rayBlockers.push(gable);
  }

  // Upper floor with a real stair well. These dimensions match the server.
  for (const [id, minX, maxX, minZ, maxZ] of [
    ['north', LOFT.minX, LOFT.maxX, LOFT.minZ, STAIR_WELL.minZ],
    ['east', STAIR_WELL.maxX, LOFT.maxX, STAIR_WELL.minZ, LOFT.maxZ],
    ['west', LOFT.minX, STAIR_WELL.minX, STAIR_WELL.minZ, LOFT.maxZ],
    ['south', STAIR_WELL.minX, STAIR_WELL.maxX, STAIR_WELL.maxZ, LOFT.maxZ],
  ]) {
    const slab = box(root, (minX + maxX) / 2, LOFT.y - LOFT.thickness / 2, (minZ + maxZ) / 2, maxX - minX, LOFT.thickness, maxZ - minZ, floor);
    slab.name = `loft-floor-${id}`; rayBlockers.push(slab);
  }
  for (const tread of STAIR_TREADS) {
    rayBlockers.push(box(root, (tread.minX + tread.maxX) / 2, (tread.minY + tread.maxY) / 2, (tread.minZ + tread.maxZ) / 2, tread.maxX - tread.minX, tread.maxY - tread.minY, tread.maxZ - tread.minZ, floor));
  }
  function railing(x1, z1, x2, z2, y) {
    const guardrail = new THREE.Group(); guardrail.name = 'loftGuardrail'; root.add(guardrail);
    const length = Math.hypot(x2-x1, z2-z1);
    for (let i = 0; i <= Math.ceil(length / 1.2); i++) {
      const t = i / Math.ceil(length / 1.2); box(guardrail, x1+(x2-x1)*t, y+LOFT_RAIL.height/2, z1+(z2-z1)*t, .085, LOFT_RAIL.height, .085, trim);
    }
    const rail = box(guardrail, (x1+x2)/2, y+LOFT_RAIL.topBarY, (z1+z2)/2, .1, .12, length+.1, wood); rail.rotation.y = Math.atan2(x2-x1, z2-z1);
  }
  railing(LOFT.minX, LOFT.minZ + .2, LOFT.minX, LOFT.maxZ - .2, LOFT.y);
  // Stringers stay below the landing; the sloping handrails are removed so
  // the visibly open stair sides also permit an emergency jump out.
  for (const beam of STAIR_STRINGERS) {
    const stringer = box(root, beam.x, beam.centerY, beam.centerZ, beam.width, beam.height, beam.length, trim);
    stringer.rotation.x = beam.angle;
  }
  // Shared AABBs make the plaster partitions and their openings agree with
  // movement, bullets and zombie routes. All trim sits outside the clear doors.
  const plaster = material('interiorPlaster', 0x74705d, .97);
  const wainscot = worldMapped(material('interiorWainscot', 0xa8c0a4, .94, { map: plankTexture() }), 2.4);
  // Coplanar trim gets a depth bias instead of widening the collision volume.
  const skirting = worldMapped(material('interiorSkirting', 0xa8c0a4, .94, { map: plankTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 2.4);
  const interiorTimber = worldMapped(material('interiorTimber', palette.timber, .9, { map: plankTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 2.4);
  for (const wall of INTERIOR_WALLS) {
    const width = wall.maxX - wall.minX, depth = wall.maxZ - wall.minZ;
    const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2;
    const cap = PARTITION_CAPS.find(candidate => candidate.layoutId === wall.id);
    const bodyHeight = cap ? cap.baseY - wall.baseY : wall.height;
    const mesh = box(root, x, wall.baseY + bodyHeight / 2, z, width, bodyHeight, depth,
      wall.kind === 'low-cover' ? wainscot : wall.kind === 'lintel' ? wood : plaster);
    mesh.userData.layoutId = wall.id;
    rayBlockers.push(mesh);
    if (cap) {
      const geometry = partitionCapGeometry(cap);
      geometry.translate(-x, -wall.baseY - bodyHeight / 2, -z);
      const pitchedCap = new THREE.Mesh(geometry, wood); pitchedCap.name = 'partitionPitchedCap';
      pitchedCap.userData.partitionCap = cap; pitchedCap.castShadow = pitchedCap.receiveShadow = true;
      mesh.add(pitchedCap); rayBlockers.push(pitchedCap);
    }
    if (wall.kind === 'partition' || wall.kind === 'low-cover') {
      // The wood skirting and cap stay inside the authoritative volume.
      box(root, x, wall.baseY + .065, z, width, .13, depth, skirting);
      if (!cap) box(root, x, wall.baseY + wall.height - .035, z, width, .07, depth, interiorTimber);
    }
  }
  for (const opening of INTERIOR_DOORWAYS) {
    const alongX = opening.axis === 'x';
    const from = alongX ? opening.minX : opening.minZ, to = alongX ? opening.maxX : opening.maxZ;
    const fixed = alongX ? (opening.minZ + opening.maxZ) / 2 : (opening.minX + opening.maxX) / 2;
    const thickness = alongX ? opening.maxZ - opening.minZ : opening.maxX - opening.minX;
    const frame = (center, y, length, height) => alongX
      ? box(root, center, y, fixed, length, height, thickness, interiorTimber)
      : box(root, fixed, y, center, thickness, height, length, interiorTimber);
    for (const edge of [from - .045, to + .045]) frame(edge, opening.baseY + opening.height / 2, .09, opening.height);
    frame((from + to) / 2, opening.baseY + opening.height + .055, to - from + .18, .11);
  }
  // Collision-authoritative furniture: sofa and table.
  const furnitureStart = root.children.length;
  const sofaMat = material('sofa', 0x405247);
  // Heights match SOFA in layout.js: seat .48 (cushions over the whole seat),
  // arms .72, back .8; the back rests on the base.
  box(root,-4.6,.225,2.95,2.8,.35,1.1,sofaMat); box(root,-4.6,.6,3.35,2.8,.4,.3,sofaMat);
  for (const x of [-5.85,-3.35]) box(root,x,.5,2.95,.3,.44,1.1,sofaMat);
  for (const x of [-5.333,-4.6,-3.867]) box(root,x,.44,2.8,.723,.08,.8,material('cushion',0x566454));
  box(root,-.9,.74,-.4,2.2,.12,1.2,wood);
  for (const x of [-1.85,.05]) for (const z of [-.9,.1]) box(root,x,.36,z,.1,.72,.1,trim);
  cylinder(root,-1.1,.83,-.5,.13,.12,.1,metal,16);
  box(root,-.5,.82,-.45,.34,.03,.28,material('paper',0xb6b19b));
  rayBlockers.push(...root.children.slice(furnitureStart).filter(child => child.isMesh));
  // Flush hunting-cabin racks share positions, facing and prices with the
  // server. No purchase island remains in the middle of the movement lanes.
  const armoryDisplays = new Map();
  for (const crate of ARMORY) {
    const display = createArmoryRack(crate.weapon); display.name = `armory-${crate.id}`;
    display.position.set(crate.x, crate.y, crate.z); display.rotation.y = crate.facing ?? Math.atan2(-crate.x, -crate.z); root.add(display);
    armoryDisplays.set(crate.weapon, display);
    localizedSign(display,lang=>`${weaponLabel(crate.weapon,{language:lang})} · ${crate.price} ${lang==='en'?'COINS':'PIÈCES'}`,0,2,.218,0,1.17);
    if (crate.unlockWave) localizedSign(display,lang=>`BONUS · ${lang==='en'?'WAVE':'VAGUE'} ${crate.unlockWave}`,0,1.02,.218,0,.95);
  }
  sign(root,'DEADWOOD',-7.82,4.55,-2.8,Math.PI/2,2.8);
  // The old west-corner shelf is removed: that solid wall now holds a rack.
  // The east loft wall now holds the bolt-action rifle; its old decorative
  // locker would have covered the rack and is deliberately removed.
  const lateSupplyPost = createLateSupplyPost();
  lateSupplyPost.position.set(LATE_SUPPLIES.position.x, LATE_SUPPLIES.position.y, LATE_SUPPLIES.position.z);
  lateSupplyPost.rotation.y = LATE_SUPPLIES.position.facing; root.add(lateSupplyPost);
  // The post opens with its earliest item (the revive kit).
  const postOpens = Math.min(...Object.values(LATE_SUPPLIES.items).map(item => item.unlockWave ?? LATE_SUPPLIES.unlockWave));
  localizedSign(lateSupplyPost, lang => lang === 'en' ? `EQUIPMENT · WAVE ${postOpens}` : `ÉQUIPEMENT · VAGUE ${postOpens}`, 0, 1.97, .132, 0, 1.1);
  const supplyCrate = createSupplyCrate(); supplyCrate.visible = false; root.add(supplyCrate);

  const lamps=[];
  // A soft additive halo stands in for bloom on every quality level.
  const haloMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb36b, transparent: true, opacity: .55,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  function lamp(x,y,z,intensity=12) {
    cylinder(root,x,y+.16,z,.2,.28,.23,metal,12);
    sphere(root,x,y,z,.13,glow);
    const light=new THREE.PointLight(palette.amber,intensity,11,2); light.position.set(x,y-.04,z); root.add(light); lamps.push({light,intensity});
    const halo = new THREE.Sprite(haloMaterial); halo.name = 'lampHalo'; halo.position.set(x, y - .02, z); halo.scale.setScalar(1.35); root.add(halo);
  }
  lamp(-4.5,3.3,-2.4,19); lamp(-4.5,3.3,3.7,17); lamp(6.5,5.9,-3.2,15); lamp(6.5,5.8,3.5,14); lamp(.3,3.1,.7,10);
  for (const [x,z] of [[0,-6.55],[0,6.55],[-8.55,0],[8.55,0]]) lamp(x,3.35,z,12);
  // Cool moonlight outside, a violet rim from the opposite side, warm lamps
  // inside: the cabin reads as the safe place, the woods as the danger.
  const LIGHT = { ambient: 1.15, moon: 2.4, fill: .5 };
  const ambient = new THREE.HemisphereLight(0x8aa6d6,0x5a4a3a,LIGHT.ambient); scene.add(ambient);
  const moon=new THREE.DirectionalLight(0xa9c6f0,LIGHT.moon); moon.position.set(-13,21,-14); scene.add(moon);
  const fill=new THREE.DirectionalLight(0x8c7fc4,LIGHT.fill); fill.position.set(12,8,8); scene.add(fill);
  scene.background=new THREE.Color(NIGHT.horizon); scene.fog=new THREE.FogExp2(NIGHT.horizon,.017);
  const sky = createNightSky(); scene.add(sky);
  const shadows = moonShadows(scene, moon, quality);
  const treeTrunk=material('trunk',0x302c27), needles=material('needles',0x153b32), tips=material('needletips',0x245046);
  let seed=2137; const random=()=>{seed=(seed*1664525+1013904223)>>>0; return seed/4294967296;};
  if (mergeStatic) {
    // One InstancedMesh per tree part and one for the rocks: the same seeded
    // ring around the clearing, 4 draw calls instead of 286. Unit geometries
    // are scaled per instance to the exact dimensions the loops used before.
    const forestTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.14, .34, 1, 6), treeTrunk, 64);
    const forestNeedles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0, 1, 1, 7), needles, 128);
    const forestTips = new THREE.InstancedMesh(new THREE.CylinderGeometry(0, 1, 1, 7), tips, 64);
    const forestRocks = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), material('rock', 0x41504d), 30);
    const forestParts = { forestTrunks, forestNeedles, forestTips, forestRocks };
    const forestMatrix = new THREE.Matrix4(), forestPosition = new THREE.Vector3(), forestScale = new THREE.Vector3(), forestQuaternion = new THREE.Quaternion();
    let needle = 0;
    for(let i=0;i<64;i++) {
      const angle=random()*Math.PI*2, radius=13+random()*33;
      let x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      const h=7+random()*7;
      if (Math.abs(x) < EXTERIOR.bounds.maxX + 2.5 && Math.abs(z) < EXTERIOR.bounds.maxZ + 2.5) {
        const factor = Math.min((EXTERIOR.bounds.maxX+2.5)/Math.max(.001,Math.abs(x)), (EXTERIOR.bounds.maxZ+2.5)/Math.max(.001,Math.abs(z)));
        x *= factor; z *= factor;
      }
      forestPosition.set(x, h/2-.7, z); forestScale.set(1, h, 1);
      forestMatrix.compose(forestPosition, forestQuaternion, forestScale); forestTrunks.setMatrixAt(i, forestMatrix);
      for(let j=0;j<3;j++) {
        forestPosition.set(x, h*.48+j*h*.15, z); forestScale.set(2.1-j*.38, h*.5, 2.1-j*.38);
        forestMatrix.compose(forestPosition, forestQuaternion, forestScale);
        if (j===2) forestTips.setMatrixAt(i, forestMatrix); else forestNeedles.setMatrixAt(needle++, forestMatrix);
      }
    }
    for(let i=0;i<30;i++) {
      const angle=random()*Math.PI*2,radius=11+random()*20;
      let x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      if (Math.abs(x) < EXTERIOR.bounds.maxX + 1 && Math.abs(z) < EXTERIOR.bounds.maxZ + 1) {
        const factor = Math.min((EXTERIOR.bounds.maxX+1)/Math.max(.001,Math.abs(x)), (EXTERIOR.bounds.maxZ+1)/Math.max(.001,Math.abs(z)));
        x *= factor; z *= factor;
      }
      const size=.25+random()*.6;
      forestPosition.set(x, .07, z); forestScale.set(size*1.5, size*.7, size);
      forestMatrix.compose(forestPosition, forestQuaternion, forestScale); forestRocks.setMatrixAt(i, forestMatrix);
    }
    for (const [name, forest] of Object.entries(forestParts)) {
      forest.name = name; forest.castShadow = true;
      forest.receiveShadow = forest !== forestRocks; // cylinder() received, sphere() did not
      forest.instanceMatrix.needsUpdate = true;
      // The instances span the whole ring; culling needs the real bounds.
      forest.computeBoundingBox(); forest.computeBoundingSphere();
      root.add(forest);
    }
  } else {
    for(let i=0;i<64;i++) {
      const angle=random()*Math.PI*2, radius=13+random()*33;
      let x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      const h=7+random()*7;
      if (Math.abs(x) < EXTERIOR.bounds.maxX + 2.5 && Math.abs(z) < EXTERIOR.bounds.maxZ + 2.5) {
        const factor = Math.min((EXTERIOR.bounds.maxX+2.5)/Math.max(.001,Math.abs(x)), (EXTERIOR.bounds.maxZ+2.5)/Math.max(.001,Math.abs(z)));
        x *= factor; z *= factor;
      }
      cylinder(root,x,h/2-.7,z,.14,.34,h,treeTrunk,6);
      for(let j=0;j<3;j++) cylinder(root,x,h*.48+j*h*.15,z,0,2.1-j*.38,h*.5,j===2?tips:needles,7);
    }
    for(let i=0;i<30;i++) {
      const angle=random()*Math.PI*2,radius=11+random()*20;
      let x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      if (Math.abs(x) < EXTERIOR.bounds.maxX + 1 && Math.abs(z) < EXTERIOR.bounds.maxZ + 1) {
        const factor = Math.min((EXTERIOR.bounds.maxX+1)/Math.max(.001,Math.abs(x)), (EXTERIOR.bounds.maxZ+1)/Math.max(.001,Math.abs(z)));
        x *= factor; z *= factor;
      }
      sphere(root,x,.07,z,.25+random()*.6,material('rock',0x41504d),1.5,.7,1);
    }
  }
  const fireflies = createFireflies(Math.max(0, Math.round(quality.fireflies ?? DEFAULT_QUALITY.fireflies))); root.add(fireflies);
  // Wood chips burst from a plank the moment it breaks (pre-built pool).
  const splinters = createSplinterPool(); root.add(splinters.mesh);
  // Shots, sparks, flames and blasts all draw in one shared particle engine.
  const effects = sharedEffects(); effects.clear(); scene.add(effects.root); effects.driven = true;
  // Brass casings and shotgun shells: one pre-built instanced pool.
  const casings = createCasingPool(); scene.add(casings.mesh);
  let lastUpdate = 0, crateSmokeAt = 0, prewarmed = false; const prewarmedStyles = new WeakSet(), chip = new THREE.Vector3(), outward = new THREE.Vector3();
  // Walk-through grass, flowers and mushrooms; density follows the quality.
  const groundDecor = createGroundDecor({ density: quality.groundDetail ?? DEFAULT_QUALITY.groundDetail }); root.add(groundDecor);
  const expedition = createExpeditionEffects(scene, { root, rayBlockers, doors, localizedSign, quality });
  if (mergeStatic) {
    // Everything raycast, localized, toggled or animated keeps its own mesh:
    // identity exclusions here, conservative shape rules in world-merge.js.
    const excluded = new Set(rayBlockers);
    for (const door of doors.values()) {
      excluded.add(door);
      const { frame, seal, wall, openingSections = [], shelterSign, boards = [] } = door.userData;
      for (const item of [frame, seal, wall, shelterSign, ...openingSections, ...boards]) if (item) excluded.add(item);
    }
    for (const item of [supplyCrate, expedition.root]) excluded.add(item);
    // These named subtrees are static (only the magnum group's visibility
    // follows unlocks, a flag on the group itself), so their anonymous
    // content merges within each named group: lookups and measured bounds
    // survive, draw calls do not.
    const zones = [lateSupplyPost, root.getObjectByName('loftGuardrail'), root.getObjectByName('cabinGenerator')].filter(Boolean);
    for (const display of armoryDisplays.values()) {
      zones.push(display);
      const rackWeapon = display.getObjectByName(`rackWeapon-${display.userData.weapon}`);
      if (rackWeapon) zones.push(rackWeapon);
    }
    mergeStaticMeshes(root, { excluded, zones });
  }
  // Frisson mood (the contract is DESIGN.md in the art folder): multipliers
  // on the values update() computes. `lit` keeps update()'s own values, so
  // setMood can re-apply between frames and null puts them back. Fog
  // density is never touched.
  const mood = { ambient: 1, moon: 1, fill: 1, lamps: 1, windowGlow: 1, sky: 1, fireflies: 1, beams: 1, fogColor: null, exposure: 1 };
  const moodScales = ['ambient', 'moon', 'fill', 'lamps', 'windowGlow', 'sky', 'fireflies', 'beams'];
  // mood.colors replaces light colours, written only when they change.
  const moodColors = [['ambientSky', [ambient.color]], ['ambientGround', [ambient.groundColor]], ['moon', [moon.color]], ['fill', [fill.color]], ['lamps', lamps.map(lamp => lamp.light.color)]]
    .map(([key, colors]) => ({ key, colors, originals: colors.map(color => color.clone()), hex: null }));
  const lit = { ambient: 0, moon: 0, fill: 0, halo: 0, windowGlow: 0, lamps: [] };
  const fogColor = scene.fog.color.clone(), background = scene.background.clone(), fireflyOpacity = fireflies.material.opacity;
  let moodOn = false, moodRenderer = null, baseExposure = null, skyScale = 1, skyFog = null;
  function keepLit() {
    lit.ambient = ambient.intensity; lit.moon = moon.intensity; lit.fill = fill.intensity;
    lit.halo = haloMaterial.opacity; lit.windowGlow = windowGlow.emissiveIntensity;
    for (let i = 0; i < lamps.length; i++) lit.lamps[i] = lamps[i].light.intensity;
  }
  function applyMood() {
    const m = moodOn ? mood : null;
    ambient.intensity = m ? lit.ambient * m.ambient : lit.ambient;
    moon.intensity = m ? lit.moon * m.moon : lit.moon;
    fill.intensity = m ? lit.fill * m.fill : lit.fill;
    haloMaterial.opacity = m ? lit.halo * m.lamps : lit.halo;
    windowGlow.emissiveIntensity = m ? lit.windowGlow * m.windowGlow : lit.windowGlow;
    for (let i = 0; i < lamps.length; i++) lamps[i].light.intensity = m ? lit.lamps[i] * m.lamps : lit.lamps[i];
    for (const slot of expedition.teamSlots) slot.beam.material.opacity = TEAMMATE_BEAM_OPACITY * (m ? m.beams : 1);
  }
  function restoreExposure() {
    if (moodRenderer && baseExposure !== null) moodRenderer.toneMappingExposure = baseExposure;
    baseExposure = null;
  }
  const moodFactor = (value, key) => Number.isFinite(value?.[key]) && value[key] >= 0 ? value[key] : 1;
  const moodHex = value => Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : null;

  // Frisson cabin dressing (CABIN.md in the art folder, section 4.2): uniforms
  // only. Colour, roughness, metalness, opacity (where the material is
  // already transparent) and map (where Famille already has one, as a clone
  // with the Famille map's repeat and wrapping): no define, map presence or
  // version changes, so nothing recompiles on or off. Props hang under root
  // as frissonDressing, outside rayBlockers and the static merge; a door's
  // Dress_Door_<Id> channel shows only while that door is not sealed. Every
  // value is kept and null puts it all back exactly.
  let dressing = null, dressed = null;
  const doorChannels = new Map();
  const dressingUnit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  function undress() {
    if (!dressed) return;
    for (const saved of dressed.surfaces) {
      const { material } = saved;
      material.color.copy(saved.color); material.roughness = saved.roughness; material.metalness = saved.metalness;
      material.opacity = saved.opacity; material.map = saved.map;
      saved.clone?.dispose();
    }
    for (const { mesh, visible, color } of dressed.objects) { mesh.visible = visible; mesh.material.color.copy(color); }
    dressed.props?.removeFromParent();
    doorChannels.clear(); dressed = null; dressing = null;
    if (dressingOff === undress) dressingOff = null;
  }
  function dress(next) {
    const ignored = [], surfaces = [], objects = [];
    for (const [key, look] of Object.entries(next.surfaces ?? {})) {
      const material = DRESSING_SURFACE_KEYS.includes(key) ? mats[key] : null;
      if (!material || !look || typeof look !== 'object') { ignored.push(`surface ${key}`); continue; }
      const saved = { material, color: material.color.clone(), roughness: material.roughness, metalness: material.metalness, opacity: material.opacity, map: material.map, clone: null };
      surfaces.push(saved);
      for (const property of Object.keys(look)) {
        const value = look[property];
        if (property === 'color' && moodHex(value) !== null) material.color.setHex(value);
        else if ((property === 'roughness' || property === 'metalness') && dressingUnit(value)) material[property] = value;
        else if (property === 'opacity' && dressingUnit(value) && material.transparent) material.opacity = value;
        else if (property === 'map' && value?.isTexture && saved.map) {
          const famille = saved.map, clone = value.clone();
          clone.repeat.copy(famille.repeat); clone.offset.copy(famille.offset); clone.wrapS = famille.wrapS; clone.wrapT = famille.wrapT;
          clone.anisotropy = famille.anisotropy; clone.colorSpace = famille.colorSpace; clone.channel = famille.channel; clone.needsUpdate = true;
          material.map = saved.clone = clone;
        } else if (value !== undefined) ignored.push(`surface ${key}.${property}`);
      }
    }
    for (const [name, look] of Object.entries(next.objects ?? {})) {
      const mesh = DRESSING_OBJECT_KEYS.includes(name) ? groundDecor.getObjectByName(name) : null;
      if (!mesh?.material?.color || !look || typeof look !== 'object') { ignored.push(`object ${name}`); continue; }
      objects.push({ mesh, visible: mesh.visible, color: mesh.material.color.clone() });
      for (const property of Object.keys(look)) {
        const value = look[property];
        if (property === 'visible' && typeof value === 'boolean') mesh.visible = value;
        else if (property === 'color' && moodHex(value) !== null) mesh.material.color.setHex(value);
        else if (value !== undefined) ignored.push(`object ${name}.${property}`);
      }
    }
    const props = next.props?.isObject3D === true ? next.props : null;
    if (props) {
      props.name = 'frissonDressing'; props.updateMatrix(); props.matrixAutoUpdate = false;
      root.add(props);
      for (const [id, name] of Object.entries(DRESSING_DOOR_CHANNELS)) {
        const channel = props.getObjectByName(name), door = doors.get(id);
        if (!channel || !door) continue;
        doorChannels.set(id, channel); channel.visible = door.userData.seal.visible !== true;
      }
    } else if (next.props !== undefined && next.props !== null) ignored.push('props');
    for (const what of ignored) globalThis.console?.warn?.(`world.setDressing: ${what} is not part of the dressing, ignored`);
    dressed = { surfaces, objects, props }; dressing = next;
  }

  const api = { root, doors, rayBlockers, expedition, armoryDisplays, supplyCrate, lateSupplyPost,
    atmosphere: { ambient, moon, fill, lamps, sky, fireflies, quality },
    effects: { impact: impactBurst, muzzle: muzzleFlash, smoke: emitBarrelSmoke, swing: emitSwingTrail, particles: effects, casings },
    // Compiles zombie, puff, decor and particle programs at load time, so the
    // first zombie on screen or the first kill never stalls a frame. Once per
    // page for the storybook zombies; once more for each zombie style (the
    // Frisson pack: a new one per room, its programs freed with it), since
    // the pack compiles in the lobby, before the flashlight is on.
    prewarm(renderer, camera) {
      // The game's renderer is the one a mood's exposure acts on.
      if (!moodRenderer && Number.isFinite(renderer?.toneMappingExposure)) moodRenderer = renderer;
      const style = getZombieStyle();
      if (!renderer?.compile || (style ? prewarmedStyles.has(style) : prewarmed)) return false;
      if (style) prewarmedStyles.add(style); else prewarmed = true;
      const stage = new THREE.Group(); stage.name = 'shaderPrewarm';
      const models = [['walker', false, 80], ['crawler', false, 80], ['armored', false, 165], ['brute', false, 700], ['brute', true, 6000]]
        .map(([kind, boss, hp]) => createZombie(kind, boss, hp, 'prewarm'));
      startZombieDeath(models[0], { time: 0 }); models[0].userData.poof.group.visible = true;
      stage.add(...models); scene.add(stage);
      try { renderer.compile(scene, camera); } finally { scene.remove(stage); models.forEach(disposeZombie); }
      return true;
    },
    setLanguage(value = getLanguage()) {
      language = value === 'en' ? 'en' : 'fr';
      for (const { mesh, label } of localizedSigns) mesh.userData.setLabel(label(language));
    },
    // Rebuilds every rack weapon with the current style (null = Famille).
    // Each rackWeapon-<type> subtree is dropped (its merged geometries
    // disposed, never the style's shared frissonShared ones), rebuilt through
    // the same helper as createArmoryRack and merged again like the initial
    // zone pass. Only the numeric suffix of the staticMerge-<n> names may
    // differ from the initial build; nothing looks those names up.
    restyleArmory() {
      for (const [type, display] of armoryDisplays) {
        const old = display.getObjectByName(`rackWeapon-${type}`);
        const structure = old?.parent ?? display.children[0];
        if (old) {
          old.removeFromParent();
          old.traverse(node => { if (node.isMesh && !node.geometry.userData.frissonShared) node.geometry.dispose(); });
        }
        const gun = buildRackWeapon(type);
        structure.add(gun);
        root.updateMatrixWorld(true);
        mergeStaticMeshes(gun, { zones: [gun], keepColors: true });
      }
    },
    // mood: { ambient, moon, fill, lamps, windowGlow, sky, fireflies, beams }
    // (1 = unchanged), fogColor (hex or null), exposure (a multiplier on the
    // tone-mapping exposure of the renderer given to prewarm, or passed here
    // once) and colors { ambientSky, ambientGround, moon, fill, lamps } (hex).
    // null undoes it all. Uniforms only: no light, define or program
    // changes, so no recompile. Fit for every frame: nothing is allocated
    // unless the sky or fog colour changes.
    setMood(next = null, options) {
      const renderer = options?.renderer ?? moodRenderer;
      if (!moodOn) keepLit(); // without a mood the lights hold update()'s values
      if (renderer !== moodRenderer) { restoreExposure(); moodRenderer = renderer; }
      moodOn = Boolean(next) && typeof next === 'object';
      for (let i = 0; i < moodScales.length; i++) mood[moodScales[i]] = moodOn ? moodFactor(next, moodScales[i]) : 1;
      mood.exposure = moodOn && Number.isFinite(next.exposure) && next.exposure > 0 ? next.exposure : 1;
      mood.fogColor = moodOn ? moodHex(next.fogColor) : null;
      applyMood();
      for (let i = 0; i < moodColors.length; i++) {
        const tint = moodColors[i], hex = moodOn ? moodHex(next.colors?.[tint.key]) : null;
        if (hex === tint.hex) continue;
        tint.hex = hex;
        for (let j = 0; j < tint.colors.length; j++) if (hex === null) tint.colors[j].copy(tint.originals[j]); else tint.colors[j].setHex(hex);
      }
      // Fog, background and sky change together, only when they change.
      if (mood.sky !== skyScale || mood.fogColor !== skyFog) {
        skyScale = mood.sky; skyFog = mood.fogColor; sky.userData.setMood(skyScale, skyFog);
        if (skyFog === null) scene.fog.color.copy(fogColor); else scene.fog.color.setHex(skyFog);
        if (scene.background?.isColor) { if (skyFog === null) scene.background.copy(background); else scene.background.setHex(skyFog); }
      }
      fireflies.visible = mood.fireflies > 0; fireflies.material.opacity = fireflyOpacity * mood.fireflies;
      if (!moodOn) restoreExposure();
      else if (moodRenderer) { baseExposure ??= moodRenderer.toneMappingExposure; moodRenderer.toneMappingExposure = baseExposure * mood.exposure; }
      return moodOn;
    },
    // The material keys and decor a dressing may change (nothing else).
    surfaceKeys: DRESSING_SURFACE_KEYS,
    objectKeys: DRESSING_OBJECT_KEYS,
    // dressing: { surfaces: { [key]: { color?, roughness?, metalness?,
    // opacity?, map? } }, objects: { [name]: { visible?, color? } }, props:
    // Object3D | null }. A second call replaces the first (restore, then
    // apply), here or on another world; null is the exact Famille restore.
    // Unknown keys are ignored with one warning each. The textures and props
    // passed in stay the caller's to dispose. True when a dressing is on.
    setDressing(next = null) {
      if (dressingOff && dressingOff !== undress) dressingOff();
      undress();
      if (!next || typeof next !== 'object') return false;
      dress(next);
      dressingOff = undress;
      return true;
    },
    // The dressing on this world, or null.
    get dressing() { return dressing; },
    // Pass a health fraction (0..1), or an integer percentage (0..100).
    setDoor(id,hp,boardHealth,sealed=false) {
      const door=doors.get(id);if(!door)return;
      const ratio=THREE.MathUtils.clamp(hp>1?hp/100:hp,0,1);door.userData.hp=ratio;
      const visible=Math.ceil(ratio*BARRICADE_BOARDS.length);
      door.userData.boards.forEach((board,i)=>{
        const was=board.visible;
        board.visible=sealed !== true && (Array.isArray(boardHealth)?boardHealth[i]>0:i<visible);
        // Only a plank broken during play bursts: not the first sync of a
        // joining player, and not a door being sealed.
        // A long gap since this door's last sync means a rejoin, not a break.
        if (was && !board.visible && sealed !== true && door.userData.synced && lastUpdate - (door.userData.syncedAt ?? -Infinity) < 1.5) {
          board.getWorldPosition(chip); outward.set(chip.x, 0, chip.z);
          splinters.burst(chip, outward, lastUpdate);
        }
      });
      door.userData.synced=true;door.userData.syncedAt=lastUpdate;
      door.userData.seal.visible=sealed === true;
      door.userData.frame.visible=sealed !== true;
      for (const section of door.userData.openingSections) section.visible=sealed !== true;
      if (door.userData.shelterSign) door.userData.shelterSign.visible=sealed !== true;
      const channel=doorChannels.get(id); if (channel) channel.visible=sealed !== true;
    },
    update(time, context = {}) {
      time = Number.isFinite(time) ? time : 0;
      lastUpdate = time; splinters.update(time); effects.update(time); casings.update(time);
      // Also apply equipment on a stopped frame or a newly joined teammate;
      // the normal animated rig follows the same authoritative flag below.
      for (const player of context.snapshot?.players ?? []) {
        const backpack = context.survivors?.get?.(player.id)?.userData.backpack;
        if (backpack) backpack.visible = player.backpack === true;
      }
      const state = context.snapshot?.expedition;
      const enabled = state?.enabled === true;
      const power = enabled ? THREE.MathUtils.clamp(state.generator?.power ?? 1, GENERATOR.minPower, 1) : 1;
      const night = enabled ? THREE.MathUtils.clamp(((context.snapshot?.wave ?? 1) - 1) / 19, 0, 1) : 0;
      ambient.intensity = LIGHT.ambient * (1 - night * .5);
      moon.intensity = LIGHT.moon * (1 - night * .5);
      fill.intensity = LIGHT.fill * (1 - night * .35);
      haloMaterial.opacity = .55 * power;
      windowGlow.emissiveIntensity = .42 * power;
      shadows?.follow(context.camera);
      if (context.camera) context.camera.getWorldPosition(sky.position);
      for(let i=0;i<lamps.length;i++) lamps[i].light.intensity=lamps[i].intensity*power*(.96+.025*Math.sin(time*5.7+i*2)+.015*Math.sin(time*13.1+i));
      if (moodOn) { keepLit(); applyMood(); }
      if (fireflies.visible) fireflies.userData.update(time);
      const supply = context.snapshot?.supplyCrate;
      supplyCrate.visible = context.active === true && Boolean(supply);
      if (supply) {
        supplyCrate.position.set(supply.x, supply.y ?? 0, supply.z);
        const radarChoice = supplyCrate.getObjectByName('bonus-radar');
        if (radarChoice) radarChoice.visible = (context.snapshot?.wave ?? 0) >= RADAR.unlockWave;
        const claimed = supply.active === false || (Array.isArray(supply.claimed) ? supply.claimed.includes(context.myId) : false);
        supplyCrate.userData.indicator.material.color.setHex(claimed ? 0x61776b : 0xe2c47d);
        supplyCrate.userData.halo.material.opacity = claimed ? .08 : .16 + Math.sin(time * 2) * .035;
        const { lens, glow } = supplyCrate.userData.beacon, flash = supplyBeaconFlash(time, claimed);
        lens.material.color.setHex(claimed ? SUPPLY_BEACON.claimed : flash ? SUPPLY_BEACON.bright : SUPPLY_BEACON.dim);
        glow.material.opacity = flash ? .85 : 0;
        glow.scale.setScalar(flash ? 1.2 : .5);
        if (supply.active !== false && time >= crateSmokeAt) {
          crateSmokeAt = time + SUPPLY_BEACON.smokeEvery;
          emitSignalSmoke({ x: supplyCrate.position.x, y: supplyCrate.position.y + .48, z: supplyCrate.position.z }, time);
        }
      }
      const magnumDisplay = armoryDisplays.get('magnum')?.getObjectByName('rackWeapon-magnum');
      if (magnumDisplay) magnumDisplay.visible = context.snapshot?.magnumAvailable !== false;
      expedition.update(time, context);
    }
  };
  return api;
}

function partitionCapGeometry(cap) {
  const { minX: a, maxX: b, minZ: c, maxZ: d, baseY: y, highY: h, lowY: l } = cap;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    a,y,c, b,y,c, b,y,d, a,y,d, a,h,c, b,h,c, b,l,d, a,l,d,
  ], 3));
  geometry.setIndex([0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1,
    1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0]);
  geometry.computeVertexNormals();
  return geometry;
}

// These props follow the authoritative equipment state. They never create
// pickups, change protection or decide whether a fuel delivery succeeded.
export function createUmbrella() {
  const group = new THREE.Group(); group.name = 'survivorUmbrella';
  const vertices = [], ribs = [], sides = 12, radius = .68;
  for (let index = 0; index < sides; index++) {
    const a = index / sides * Math.PI * 2, b = (index + 1) / sides * Math.PI * 2;
    vertices.push(0, .07, 0, Math.cos(a) * radius, -.16, Math.sin(a) * radius,
      Math.cos(b) * radius, -.16, Math.sin(b) * radius);
    ribs.push(0, .075, 0, Math.cos(a) * radius, -.155, Math.sin(a) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
  const canopy = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x425e55, roughness: .65, side: THREE.DoubleSide }));
  canopy.name = 'umbrellaCanopy'; group.add(canopy);
  const ribGeometry = new THREE.BufferGeometry(); ribGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ribs, 3));
  group.add(new THREE.LineSegments(ribGeometry, new THREE.LineBasicMaterial({ color: 0x8a9d86 })));
  cylinder(group, 0, -.38, 0, .014, .014, .81, material('umbrellaStem', 0x9b9d91, .4), 6).castShadow = false;
  group.userData.canopy = canopy;
  return group;
}

export function createFuelCan() {
  const group = new THREE.Group(); group.name = 'expeditionFuelCan';
  const paint = material('fuelCanPaint', 0xa57631, .7, { metalness: .3 });
  box(group, 0, .2, 0, .32, .4, .19, paint, false);
  for (const x of [-.08, .08]) box(group, x, .434, 0, .035, .09, .06, paint, false);
  box(group, 0, .475, 0, .19, .035, .06, paint, false);
  cylinder(group, .105, .422, 0, .035, .035, .04, material('fuelCanCap', 0x3c4337), 8).castShadow = false;
  box(group, 0, .21, -.098, .19, .045, .006, material('fuelCanStripe', 0xd6b96e), false).rotation.z = .72;
  return group;
}

function createExpeditionEffects(scene, { root, rayBlockers, doors, localizedSign, quality = DEFAULT_QUALITY }) {
  const effects = new THREE.Group(); effects.name = 'expeditionEffects'; root.add(effects);
  const generator = new THREE.Group(); generator.name = 'cabinGenerator';
  generator.position.set(GENERATOR.x, GENERATOR.y, GENERATOR.z); effects.add(generator);
  const chassis = material('generatorChassis', 0x333d38, .55, { metalness: .5 });
  const paint = material('generatorPaint', 0xa18a43, .75, { metalness: .3 });
  for (const x of [-.46, .46]) {
    box(generator, x, .43, 0, .08, .86, .7, chassis, false);
    box(generator, x, .86, 0, .08, .08, .7, chassis, false);
  }
  box(generator, 0, .15, 0, 1.05, .18, .7, chassis, false);
  box(generator, -.12, .47, 0, .64, .45, .56, paint, false);
  const motor = cylinder(generator, .31, .45, 0, .23, .23, .29, chassis, 12); motor.rotation.z = Math.PI / 2; motor.castShadow = false;
  box(generator, -.14, .76, 0, .67, .16, .55, paint, false);
  const gauge = box(generator, -.17, .5, .291, .32, .06, .012, new THREE.MeshBasicMaterial({ color: 0x8fd895 }), false);
  gauge.name = 'generatorPowerGauge';
  const lamp = sphere(generator, .21, .72, .29, .035, new THREE.MeshBasicMaterial({ color: 0xe4bc6b })); lamp.castShadow = false;
  const generatorOccluder = box(generator, 0, GENERATOR.height / 2, 0, GENERATOR.width, GENERATOR.height, GENERATOR.depth,
    new THREE.MeshBasicMaterial({ visible: false }), false);
  // The coarse generator collider is also the server's solid collision body.
  generatorOccluder.name = 'generatorOcclusion'; rayBlockers.push(generatorOccluder);
  localizedSign(generator, lang => lang === 'en' ? 'GENERATOR · FUEL' : 'GÉNÉRATEUR · BIDON', -.1, .65, .294, 0, .66);
  const cacheMarkers = FUEL_CACHES.map((cache, index) => {
    const marker = new THREE.Group(); marker.position.set(cache.x, cache.y, cache.z); effects.add(marker);
    marker.name = `fuel-cache-${index + 1}`;
    const ring = new THREE.Mesh(new THREE.RingGeometry(.43, .52, 24), new THREE.MeshBasicMaterial({ color: 0xa78c53, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .012; marker.add(ring);
    // Ground paint cannot become a new invulnerable platform.
    localizedSign(marker, lang => lang === 'en' ? `FUEL CACHE ${index + 1}` : `CACHE BIDON ${index + 1}`, 0, .025, .7, 0, 1.1).rotation.x = -Math.PI / 2;
    return marker;
  });
  const fuel = createFuelCan(); fuel.visible = false; effects.add(fuel);
  const localFuel = createFuelCan(); localFuel.name = 'firstPersonFuelCan'; localFuel.visible = false;
  localFuel.position.set(.43, -.6, -.74); localFuel.rotation.set(.12, -.25, -.1); localFuel.scale.setScalar(.65);
  const localUmbrella = createUmbrella(); localUmbrella.name = 'firstPersonUmbrella'; localUmbrella.visible = false;
  localUmbrella.position.set(.36, .77, -.55); localUmbrella.rotation.z = -.1;

  // The intermediate arrivals are shared server anchors. Flush grilles and
  // fallen twigs mark them without an unmodelled wall trapping an emerging body.
  const spawnEntries = new THREE.Group(); spawnEntries.name = 'intermediateSpawnEntries'; effects.add(spawnEntries);
  const culverts = SPAWN_ENTRIES.filter(entry => entry.kind === 'culvert'), woods = SPAWN_ENTRIES.filter(entry => entry.kind === 'woods');
  const culvertHoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.57, .57, .018, 20), material('culvertDark', 0x101b1b), culverts.length);
  const culvertRims = new THREE.InstancedMesh(new THREE.TorusGeometry(.59, .035, 5, 20).rotateX(Math.PI / 2), material('culvertConcrete', 0x59635c), culverts.length);
  const woodlandGround = new THREE.InstancedMesh(new THREE.CylinderGeometry(.68, .68, .012, 16), material('woodlandEmergence', 0x263c30), woods.length);
  const twigs = new THREE.InstancedMesh(new THREE.BoxGeometry(.055, .045, 1.1), material('fallenSpawnTwigs', 0x463c2d), woods.length * 3);
  const entryMatrix = new THREE.Matrix4(), entryQuaternion = new THREE.Quaternion(), entryPosition = new THREE.Vector3(), entryScale = new THREE.Vector3(1, 1, 1);
  for (const [index, entry] of culverts.entries()) {
    entryPosition.set(entry.x, .012, entry.z); entryMatrix.compose(entryPosition, entryQuaternion, entryScale); culvertHoles.setMatrixAt(index, entryMatrix);
    entryPosition.y = .019; entryMatrix.compose(entryPosition, entryQuaternion, entryScale); culvertRims.setMatrixAt(index, entryMatrix);
  }
  for (const [index, entry] of woods.entries()) {
    entryPosition.set(entry.x, .008, entry.z); entryMatrix.compose(entryPosition, entryQuaternion.identity(), entryScale); woodlandGround.setMatrixAt(index, entryMatrix);
    for (let twig = 0; twig < 3; twig++) {
      const angle = twig / 3 * Math.PI * 2 + index;
      entryPosition.set(entry.x + Math.cos(angle) * .73, .028, entry.z + Math.sin(angle) * .73);
      entryQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle + .6);
      entryMatrix.compose(entryPosition, entryQuaternion, entryScale); twigs.setMatrixAt(index * 3 + twig, entryMatrix);
    }
  }
  spawnEntries.add(culvertHoles, culvertRims, woodlandGround, twigs);
  spawnEntries.userData.anchors = SPAWN_ENTRIES;

  // One reusable line buffer, rather than a mesh/particle allocation per drop.
  const dropCount = 1400, rainPositions = new Float32Array(dropCount * 6), rainSeeds = new Float32Array(dropCount * 3);
  let rainSeed = 71029;
  const random = () => { rainSeed = (rainSeed * 1664525 + 1013904223) >>> 0; return rainSeed / 4294967296; };
  for (let index = 0; index < dropCount; index++) {
    // Keep the established rain density around the cabin without multiplying
    // particles with the much larger arena. The rest traces the long approaches.
    // Interleaved, so a lower quality that draws a prefix still rains on
    // both the cabin and the far approaches.
    const nearCabin = index % 5 < 3;
    const minX = nearCabin ? -22 : EXPEDITION.bounds.minX - 2, maxX = nearCabin ? 22 : EXPEDITION.bounds.maxX + 2;
    const minZ = nearCabin ? -18 : EXPEDITION.bounds.minZ - 2, maxZ = nearCabin ? 18 : EXPEDITION.bounds.maxZ + 2;
    rainSeeds[index * 3] = minX + random() * (maxX - minX);
    rainSeeds[index * 3 + 1] = random() * 13;
    rainSeeds[index * 3 + 2] = minZ + random() * (maxZ - minZ);
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa9c3ca, transparent: true, opacity: .38, depthWrite: false }));
  rain.name = 'expeditionRain'; rain.frustumCulled = false; rain.visible = false; effects.add(rain);
  // Low quality draws (and animates) only part of the buffer.
  const drawnDrops = Math.max(1, Math.min(dropCount, Math.round(dropCount * (quality.rainFraction ?? 1))));
  rainGeometry.setDrawRange(0, drawnDrops * 2);

  // All three teammate lights exist from construction. Joining or leaving a
  // room only changes intensity, so Three.js does not rebuild every material.
  const beamGeometry = new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, -.5, 0).rotateX(Math.PI / 2);
  const teamSlots = Array.from({ length: 3 }, (_, index) => {
    const equipment = new THREE.Group(); equipment.name = `teammateEquipment-${index}`; effects.add(equipment);
    const umbrella = createUmbrella(), carriedFuel = createFuelCan(); equipment.add(umbrella, carriedFuel);
    const torch = cylinder(equipment, 0, 0, 0, .035, .04, .13, material('teamTorch', 0x657277, .4), 8); torch.rotation.x = Math.PI / 2; torch.castShadow = false;
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: 0xc9dcba, side: THREE.DoubleSide, transparent: true, opacity: TEAMMATE_BEAM_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    beam.name = `teammateBeam-${index}`; equipment.add(beam);
    const light = new THREE.SpotLight(0xffe3b0, 0, 26, .36, .7, 1); light.name = `teammateLight-${index}`;
    light.castShadow = false; effects.add(light, light.target);
    return { equipment, umbrella, carriedFuel, torch, beam, light, lastOcclusion: -Infinity, length: 26, origin: new THREE.Vector3(), direction: new THREE.Vector3(), previousOrigin: new THREE.Vector3(Infinity, Infinity, Infinity), previousDirection: new THREE.Vector3() };
  });
  const warningCapacity = 32;
  const warningMaterial = new THREE.MeshBasicMaterial({ color: 0xb96642, transparent: true, opacity: .48, depthWrite: false, side: THREE.DoubleSide });
  const warningRings = new THREE.InstancedMesh(new THREE.RingGeometry(.32, .48, 20).rotateX(-Math.PI / 2), warningMaterial, warningCapacity);
  const warningBodies = new THREE.InstancedMesh(new THREE.ConeGeometry(.2, .8, 6), new THREE.MeshBasicMaterial({ color: 0x3c6155, transparent: true, opacity: .32, depthWrite: false }), warningCapacity);
  warningRings.name = 'spawnWarningGround'; warningBodies.name = 'spawnWarningPresence';
  for (const mesh of [warningRings, warningBodies]) { mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); effects.add(mesh); }

  const raycaster = new THREE.Raycaster(), blockers = [], up = new THREE.Vector3(0, 1, 0);
  let blockerKey = null;
  const umbrellaVolumes = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }));
  const forward = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(), side = new THREE.Vector3(), rayDirection = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  function cutBeam(slot, time) {
    if (time - slot.lastOcclusion < .1 && slot.previousOrigin.distanceToSquared(slot.origin) < .16 && slot.previousDirection.dot(slot.direction) > .995) return;
    slot.lastOcclusion = time; slot.previousOrigin.copy(slot.origin); slot.previousDirection.copy(slot.direction);
    right.crossVectors(slot.direction, up).normalize(); if (right.lengthSq() < .01) right.set(1, 0, 0);
    side.crossVectors(right, slot.direction).normalize();
    let length = 26;
    // Centre plus the four outer directions conservatively shorten the whole
    // cone before visible walls, slabs, furniture and surviving door planks.
    for (let index = 0; index < 5; index++) {
      rayDirection.copy(slot.direction);
      if (index) rayDirection.addScaledVector(index < 3 ? right : side, index % 2 ? .35 : -.35).normalize();
      raycaster.set(slot.origin, rayDirection); raycaster.far = length;
      const hit = raycaster.intersectObjects(blockers, false)[0];
      if (hit) length = Math.min(length, Math.max(.05, hit.distance - .055));
    }
    slot.length = length;
  }
  function survivorPose(player, survivor, target) {
    if (survivor) { survivor.updateWorldMatrix(true, false); survivor.getWorldPosition(target); }
    else target.set(player.x ?? 0, player.y ?? 0, player.z ?? 0);
    return target;
  }
  return { root: effects, generator, gauge, cacheMarkers, spawnEntries, fuel, localFuel, localUmbrella, rain, rainSeeds, teamSlots, warningRings, warningBodies,
    update(time, { snapshot, myId, active = false, camera, survivors } = {}) {
      const expedition = snapshot?.expedition, enabled = active && expedition?.enabled === true;
      // Its physical collider also exists in the practice room.
      generator.visible = true; cacheMarkers.forEach(marker => { marker.visible = enabled; });
      const power = THREE.MathUtils.clamp(expedition?.generator?.power ?? 1, GENERATOR.minPower, 1);
      gauge.scale.x = power; gauge.material.color.setHex(power > .45 ? 0x8fd895 : 0xd9934a);
      lamp.material.color.setHex(expedition?.generator?.active ? 0x9fe7a4 : 0xe4bc6b);
      const players = snapshot?.players ?? [], local = players.find(player => player.id === myId);
      const localOpen = enabled && local?.umbrella?.open && !local.downed && local.alive !== false;
      if (camera && localUmbrella.parent !== camera) camera.add(localUmbrella);
      if (camera && localFuel.parent !== camera) camera.add(localFuel);
      localUmbrella.visible = Boolean(localOpen && camera);
      localFuel.visible = Boolean(enabled && camera && expedition?.fuel?.carrierId === myId && local?.carryingFuel && !local.downed);
      if (localOpen) localUmbrella.userData.canopy.material.color.setHex(local.umbrella.remaining > (local.umbrella.max ?? UMBRELLA.max) * .2 ? 0x425e55 : 0x786649);
      const groundFuel = enabled && expedition?.fuel && !expedition.fuel.carrierId;
      fuel.visible = Boolean(groundFuel);
      if (groundFuel) fuel.position.set(expedition.fuel.x, expedition.fuel.y, expedition.fuel.z);
      rain.visible = enabled;
      if (enabled) {
        let umbrellaCount = 0;
        for (const player of players) {
          if (!player.umbrella?.open || player.downed || player.alive === false || umbrellaCount >= umbrellaVolumes.length) continue;
          const survivor = survivors?.get?.(player.id), volume = umbrellaVolumes[umbrellaCount++];
          survivorPose(player, survivor, position);
          volume.x = position.x; volume.z = position.z;
          volume.y = position.y + 2.12 - (survivor?.userData.crouch ?? (player.crouched ? 1 : 0)) * .86;
        }
        for (let index = 0; index < drawnDrops; index++) {
          const span = HAS_SPACE ? 13 - SPACE.minY : 13;
          const y = ((rainSeeds[index * 3 + 1] - time * 9) % span + span) % span + (HAS_SPACE ? SPACE.minY : 0);
          const x = rainSeeds[index * 3] + y * .045, z = rainSeeds[index * 3 + 2];
          const roof = hasRainShelter({ x, y: 0, z }, 0) ? rainRoofHeight(x) : -1;
          let underUmbrella = false;
          for (let canopy = 0; canopy < umbrellaCount && !underUmbrella; canopy++) {
            const volume = umbrellaVolumes[canopy];
            underUmbrella = (x - volume.x) ** 2 + (z - volume.z) ** 2 < .68 ** 2 && y - .4 < volume.y;
          }
          const hidden = (HAS_SPACE ? hasRainShelter({ x, y: y - .4, z }, 0) : y - .4 <= roof) || underUmbrella, offset = index * 6;
          rainPositions[offset] = x; rainPositions[offset + 1] = hidden ? -20 : y; rainPositions[offset + 2] = z;
          rainPositions[offset + 3] = x + .018; rainPositions[offset + 4] = hidden ? -20 : y - .4; rainPositions[offset + 5] = z;
        }
        rainGeometry.attributes.position.needsUpdate = true;
      }
      // The blockers only change when a door is (un)sealed or loses a board,
      // and no blocker transform ever moves: rebuild and resync only then.
      let nextKey = '';
      for (const door of doors.values()) {
        nextKey += door.userData.seal.visible ? 's' : door.userData.boards.map(board => board.visible ? 1 : 0).join('');
      }
      if (nextKey !== blockerKey) {
        blockerKey = nextKey;
        blockers.length = 0; blockers.push(...rayBlockers);
        for (const door of doors.values()) {
          if (door.userData.seal.visible) blockers.push(door.userData.wall);
          else for (const board of door.userData.boards) if (board.visible) blockers.push(board);
        }
        root.updateMatrixWorld(true);
      }
      const teammates = active ? players.filter(player => player.id !== myId).slice(0, 3) : [];
      for (let index = 0; index < teamSlots.length; index++) {
        const slot = teamSlots[index], player = teammates[index];
        slot.equipment.visible = Boolean(player); slot.light.intensity = 0;
        slot.umbrella.visible = slot.carriedFuel.visible = slot.beam.visible = slot.torch.visible = false;
        if (!player) { slot.lastOcclusion = -Infinity; continue; }
        const survivor = survivors?.get?.(player.id), crouch = survivor?.userData.crouch ?? (player.crouched ? 1 : 0);
        survivorPose(player, survivor, position);
        const yaw = survivor?.rotation.y ?? player.yaw ?? 0;
        quaternion.setFromAxisAngle(up, yaw);
        slot.umbrella.visible = Boolean(enabled && player.umbrella?.open && !player.downed && player.alive !== false);
        slot.umbrella.position.copy(position); slot.umbrella.position.y += 2.12 - crouch * .86;
        slot.umbrella.quaternion.copy(quaternion);
        slot.umbrella.userData.canopy.material.color.setHex(player.umbrella?.remaining > (player.umbrella?.max ?? UMBRELLA.max) * .2 ? 0x425e55 : 0x786649);
        slot.carriedFuel.visible = Boolean(enabled && expedition?.fuel?.carrierId === player.id && player.carryingFuel);
        slot.carriedFuel.position.set(player.backpack === true ? -.43 : 0, 1.05 - crouch * .53, .3).applyQuaternion(quaternion).add(position);
        slot.carriedFuel.quaternion.copy(quaternion);
        const standing = player.alive !== false && !player.downed;
        slot.beam.visible = slot.torch.visible = standing;
        if (!standing) continue;
        slot.origin.set(.16, 1.48 - crouch * .57, -.19).applyQuaternion(quaternion).add(position);
        const pitch = THREE.MathUtils.clamp(player.pitch ?? 0, -1.1, 1.1);
        slot.direction.set(0, Math.sin(pitch), -Math.cos(pitch)).applyQuaternion(quaternion).normalize();
        cutBeam(slot, time);
        slot.light.position.copy(slot.origin); slot.light.target.position.copy(slot.origin).add(slot.direction);
        slot.light.intensity = 4.8; slot.light.distance = slot.length;
        slot.beam.position.copy(slot.origin); slot.beam.quaternion.setFromUnitVectors(forward, slot.direction);
        slot.beam.scale.set(slot.length * .31, slot.length * .31, slot.length);
        slot.torch.position.copy(slot.origin); slot.torch.quaternion.setFromUnitVectors(up, slot.direction);
      }
      const warnings = enabled ? (snapshot.spawnWarnings ?? []).slice(0, warningCapacity) : [];
      warningRings.count = warningBodies.count = warnings.length;
      for (let index = 0; index < warnings.length; index++) {
        const warning = warnings[index], pulse = 1 + .15 * Math.sin(time * 9 + index);
        position.set(warning.x, (warning.y ?? 0) + .018, warning.z); scale.set(pulse, 1, pulse);
        matrix.compose(position, quaternion.identity(), scale); warningRings.setMatrixAt(index, matrix);
        position.y += .39; scale.set(.7, .7 + .2 * Math.sin(time * 7 + index), .7);
        matrix.compose(position, quaternion, scale); warningBodies.setMatrixAt(index, matrix);
      }
      warningRings.instanceMatrix.needsUpdate = warningBodies.instanceMatrix.needsUpdate = true;
    }
  };
}

export function createExtraction(scene) {
  const facadeOffset = HAS_SPACE ? LEVEL.halfDepth - 6 : 0;
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const helicopter = new THREE.Group(); root.add(helicopter);
  const hull = material('rescueHull',0x59685b,.74,{metalness:.25});
  const dark = material('rescueDark',0x232e32,.45,{metalness:.65});
  const glass = material('rescueCockpit',0x87b7bd,.2,{metalness:.35,emissive:0x25484d,emissiveIntensity:.35});
  const stripe = material('rescueStripe',0xd3b979,.82);
  sphere(helicopter,0,0,0,1,hull,.82,.68,1.7);
  sphere(helicopter,0,.08,-1.05,1,glass,.73,.55,.83);
  box(helicopter,0,-.38,-.65,1.43,.18,1.4,hull);
  box(helicopter,0,.63,.14,1.15,.3,1.24,dark);
  for (const side of [-1,1]) {
    box(helicopter,side*.79,-.04,.34,.025,.18,1.25,stripe);
    box(helicopter,side*.77,.19,.54,.026,.5,.68,glass);
    box(helicopter,side*.78,.2,.1,.035,.53,.055,dark);
    const skid = cylinder(helicopter,side*.87,-.92,.05,.055,.055,2.8,dark,8); skid.rotation.x = Math.PI/2;
    for (const z of [-.76,.86]) {
      const support = box(helicopter,side*.72,-.67,z,.09,.48,.09,dark); support.rotation.z = side*.27;
    }
  }
  const boom = cylinder(helicopter,0,.15,2.67,.15,.29,2.8,hull,8); boom.rotation.x = Math.PI/2;
  box(helicopter,0,.39,4.02,.12,1.13,.65,hull).rotation.x = -.24;
  box(helicopter,0,.27,3.4,1.56,.095,.53,stripe);
  const rotor = new THREE.Group(); rotor.position.set(0,1.17,.1); helicopter.add(rotor);
  cylinder(helicopter,0,.96,.1,.075,.075,.45,dark);
  for (const angle of [0,Math.PI/2]) {
    const blade = box(rotor,0,0,0,6.4,.045,.16,dark,false); blade.rotation.y = angle;
  }
  const tailRotor = new THREE.Group(); tailRotor.position.set(.2,.4,3.94); helicopter.add(tailRotor);
  for (const angle of [0,Math.PI/2]) {
    const blade = box(tailRotor,0,0,0,.04,1.28,.09,dark,false); blade.rotation.x = angle;
  }
  const beaconMat = new THREE.MeshBasicMaterial({color:0xfbc581});
  sphere(helicopter,0,.94,2.25,.085,beaconMat);
  const beacon = new THREE.PointLight(0xffb15f,2,3); beacon.position.set(0,.98,2.25); helicopter.add(beacon);
  const searchlight = new THREE.SpotLight(0xe5f5e5,110,42,.3,.75,1.6);
  searchlight.position.set(0,-.5,-1); searchlight.castShadow = false; helicopter.add(searchlight);
  const searchTarget = new THREE.Object3D(); searchTarget.position.set(0,-.68,-8.7-facadeOffset); root.add(searchTarget);
  searchlight.target = searchTarget;
  const shaftMaterial = new THREE.MeshBasicMaterial({color:0xe9efbf,transparent:true,opacity:.035,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(2.15,1,20,1,true),shaftMaterial); root.add(shaft);
  const haloMaterial = new THREE.MeshBasicMaterial({color:0xe3c681,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.55,1.72,48),haloMaterial);
  halo.rotation.x = -Math.PI/2; halo.position.copy(searchTarget.position); halo.position.y += .018; root.add(halo);
  const exitLight = new THREE.PointLight(0xffd598,0,17,2); exitLight.position.set(0,1.5,-5.5-facadeOffset); root.add(exitLight);
  const lightPosition = new THREE.Vector3(), beamDirection = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
  const smooth = value => value*value*(3-2*value);
  return {
    root,
    cameraPosition: new THREE.Vector3(-11,6.8,-17-facadeOffset),
    cameraTarget: new THREE.Vector3(1,3.5,-8.5-facadeOffset),
    update(elapsed,duration=12) {
      if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return;
      root.visible = true;
      const progress = THREE.MathUtils.clamp(elapsed/duration,0,1), time = progress*12;
      const arrival = smooth(THREE.MathUtils.clamp(time/5,0,1));
      const departure = smooth(THREE.MathUtils.clamp((time-9)/3,0,1));
      helicopter.position.set(-26*(1-arrival)+24*departure,17*(1-arrival)+3.8*arrival+15*departure,-36*(1-arrival)-12*arrival-28*departure-facadeOffset);
      helicopter.position.y += Math.sin(time*2.4)*.075*arrival*(1-departure);
      helicopter.rotation.set(.045*(1-arrival)-.12*departure,Math.PI+.32*departure,-.065*(1-arrival)+.065*departure);
      rotor.rotation.y = time*44; tailRotor.rotation.x = time*62;
      beacon.intensity = time < 12 && Math.sin(time*7) > .55 ? 5 : .4;
      searchlight.intensity = 110*arrival*(1-departure);
      helicopter.updateMatrixWorld(true); searchlight.getWorldPosition(lightPosition);
      beamDirection.copy(lightPosition).sub(searchTarget.position);
      shaft.position.copy(searchTarget.position).add(lightPosition).multiplyScalar(.5);
      shaft.scale.y = beamDirection.length(); shaft.quaternion.setFromUnitVectors(up,beamDirection.normalize());
      shaftMaterial.opacity = .035*arrival*(1-departure);
      haloMaterial.opacity = arrival*(.12+.05*Math.sin(time*2))*(1-departure)+.2*departure;
      exitLight.intensity = 8*arrival+14*departure;
    },
    reset() {
      root.visible = false; searchlight.intensity = 0; exitLight.intensity = 0;
      beacon.intensity = 0; shaftMaterial.opacity = 0; haloMaterial.opacity = 0;
    },
  };
}

function limb(parent,x,y,z,width,length,mat) {
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
  box(pivot,0,-length/2,0,width,length,width,mat);return pivot;
}
// The same pivot without its box, for a survivor style to fill.
function joint(parent,x,y,z) {
  const pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);return pivot;
}

// A flame jet: rolling fire, embers and smoke from the nozzle to where the
// server stopped the stream, drawn by the shared particle engine (no light,
// no mesh per flame). The handle keeps the old stream API.
export function createFlameStream() {
  const mesh = new THREE.Group(); mesh.name = 'flameStream'; mesh.visible = false;
  const emitter = createFlameEmitter(), direction = new THREE.Vector3(), end = new THREE.Vector3(), effects = hostEffects(mesh);
  let disposed = false;
  return {
    mesh,
    aim(start, target, time) {
      if (disposed) return;
      direction.copy(target).sub(start); const length = Math.min(FLAMETHROWER.range, direction.length());
      if (length <= .01) { emitter.stop(); mesh.visible = false; return; }
      end.copy(start).addScaledVector(direction.normalize(), length); mesh.position.copy(start);
      emitter.aim(start, end, time, FLAMETHROWER.coneAngle); mesh.visible = true;
    },
    stop() { emitter.stop(); mesh.visible = false; },
    update(time) { mesh.visible = !disposed && emitter.update(time); driveEffects(effects, time); return mesh.visible; },
    dispose() { if (disposed) return; disposed = true; emitter.stop(); mesh.removeFromParent(); mesh.visible = false; },
  };
}

const pickupTemplates = new Map();
function pickupTemplate(kind, special) {
  const key = `${kind}-${special ? 'special' : 'normal'}`;
  if (pickupTemplates.has(key)) return pickupTemplates.get(key);
  const root = new THREE.Group(), model = new THREE.Group();
  root.name = `pickup-${kind}`; model.name = 'pickupModel'; root.add(model);
  const metal = material('pickupMetal', 0x242f2d, .62, { metalness: .55 });
  if (kind === 'ammo') {
    const casing = material('pickupAmmoCasing', 0x415a42, .78, { metalness: .35 });
    const marking = special
      ? material('pickupAmmoSpecialMarking', 0xe8c26b, .5, { emissive: 0x976c2d, emissiveIntensity: .65 })
      : material('pickupAmmoMarking', 0x7bc5bc, .5, { emissive: 0x477d75, emissiveIntensity: .65 });
    box(model, 0, .15, 0, .4, .25, .27, casing, false);
    box(model, 0, .28, 0, .43, .035, .3, metal, false);
    for (const side of [-1, 1]) {
      box(model, side * .13, .15, -.143, .035, .21, .014, marking, false);
      box(model, side * .13, .15, .143, .035, .21, .014, marking, false);
      box(model, side * .13, .302, 0, .035, .012, .26, marking, false);
    }
    box(model, 0, .324, 0, .16, .025, .035, metal, false);
    // Each instance owns these transforms; the cached GPU resources stay shared.
    const fill = new THREE.Group(); fill.name = 'ammoFill'; model.add(fill);
    for (const z of [-.151, .151]) {
      box(model, 0, .075, z, .26, .045, .008, metal, false);
      box(fill, 0, .075, z + Math.sign(z) * .005, .25, .03, .008, marking, false);
    }
    box(model, 0, .305, .065, .26, .008, .045, metal, false);
    box(fill, 0, .311, .065, .25, .008, .03, marking, false);
    const brass = material('pickupAmmoBrass', 0xb39a58, .42, { metalness: .65 });
    for (const x of [-.06, 0, .06]) {
      const round = cylinder(model, x, .16, -.16, .014, .014, .12, brass, 6);
      round.castShadow = false;
      const tip = cylinder(model, x, .232, -.16, .002, .014, .025, brass, 6);
      tip.castShadow = false;
    }
  } else if (kind === 'grenade') {
    model.add(grenadeModel());
  } else if (kind === 'health') {
    const cloth = material('pickupMedicalCloth', 0xe1e7d5, .9);
    const green = material('pickupMedicalCross', 0x67dd98, .6, { emissive: 0x226a40, emissiveIntensity: .6 });
    box(model, 0, .15, 0, .37, .26, .25, cloth, false);
    box(model, 0, .29, 0, .39, .035, .27, metal, false);
    box(model, 0, .32, 0, .15, .025, .035, metal, false);
    for (const z of [-.13, .13]) {
      box(model, 0, .15, z, .16, .045, .012, green, false);
      box(model, 0, .15, z, .045, .16, .014, green, false);
    }
    box(model, 0, .313, .055, .14, .01, .035, green, false);
    box(model, 0, .313, .055, .035, .012, .12, green, false);
  } else if (kind === 'armor') {
    // A plate carrier laid flat: shoulder straps toward the neck, a raised
    // chest plate with a pale-blue chevron and three magazine pouches.
    const fabric = material('pickupArmorFabric', 0x3e5566, .88);
    const plate = material('pickupArmorPlate', 0x26333b, .45, { metalness: .55 });
    const chevron = material('pickupArmorChevron', 0x8fd0ff, .4, { emissive: 0x2b6a99, emissiveIntensity: .7 });
    box(model, 0, .06, 0, .36, .07, .4, fabric, false);
    for (const side of [-1, 1]) {
      box(model, side * .11, .07, -.24, .08, .05, .12, fabric, false);
      box(model, side * .21, .055, .02, .06, .05, .22, fabric, false);
      box(model, side * .045, .136, -.02, .14, .012, .03, chevron, false).rotation.y = side * .6;
    }
    box(model, 0, .115, -.03, .26, .03, .24, plate, false);
    for (const x of [-.09, 0, .09]) box(model, x, .11, .14, .07, .045, .06, plate, false);
  } else if (kind === 'revive') {
    // The revive kit: an orange pouch with a big white heart, unlike the
    // white medkit with its green cross (owner, 13 October).
    const pouch = material('pickupRevivePouch', 0xff8a3d, .6, { emissive: 0x9a3a10, emissiveIntensity: .35 });
    const strap = material('pickupReviveStrap', 0x7a3a1c, .8);
    const heart = material('pickupReviveHeart', 0xfff4ee, .4, { emissive: 0xff9ab8, emissiveIntensity: .5 });
    box(model, 0, .13, 0, .34, .2, .24, pouch, false);
    box(model, 0, .245, 0, .3, .04, .2, pouch, false);
    box(model, 0, .13, 0, .36, .05, .25, strap, false);
    // A flat heart on the lid: two round lobes and a point.
    for (const side of [-1, 1]) { const lobe = cylinder(model, side * .032, .272, -.012, .042, .042, .012, heart, 12); lobe.castShadow = false; }
    const point = box(model, 0, .272, .022, .06, .012, .06, heart, false); point.rotation.y = Math.PI / 4;
    for (const side of [-1, 1]) { const lobe = cylinder(model, side * .032, .15, -.124, .036, .036, .01, heart, 12); lobe.rotation.x = Math.PI / 2; lobe.castShadow = false; }
    const front = box(model, 0, .118, -.124, .05, .05, .01, heart, false); front.rotation.z = Math.PI / 4;
  } else {
    // Gold coins, unmistakably money (owner request, 12 October): three short
    // stacks and one big coin standing up with a raised rim, catching the light.
    const gold = material('pickupCoins', 0xf0c25a, .35, { metalness: .75, emissive: 0x9a6418, emissiveIntensity: .55 });
    const rim = material('pickupCoinRim', 0xc8902e, .45, { metalness: .8, emissive: 0x6a4210, emissiveIntensity: .4 });
    for (const [x, z, count] of [[-.09, .04, 5], [.075, .06, 3], [-.005, -.085, 4]]) {
      for (let index = 0; index < count; index++) {
        const coin = cylinder(model, x + (index % 2 ? .006 : -.004), .011 + index * .019, z + (index % 3 - 1) * .004, .062, .062, .017, index % 2 ? rim : gold, 12);
        coin.castShadow = false;
      }
    }
    // A darker milled edge around two bright faces.
    const big = cylinder(model, .025, .14, .1, .095, .095, .022, rim, 16); big.rotation.x = Math.PI / 2 - .3; big.castShadow = false; big.name = 'pickupBigCoin';
    for (const side of [-1, 1]) { const face = cylinder(big, 0, side * .0125, 0, .082, .082, .004, gold, 16); face.castShadow = false; }
  }
  if (pickupStyle && STYLED_PICKUP_KINDS.includes(kind)) pickupStyle.dress(model, { kind, special });
  // Shared geometry/materials survive collection. The halo is unlit and adds no light or collider.
  const halo = new THREE.Group(); halo.name = 'pickupHalo'; halo.position.y = .014; root.add(halo);
  const color = kind === 'ammo' ? (special ? 0xe8c26b : 0x7bc5bc) : kind === 'health' ? 0x67dd98 : kind === 'armor' ? 0x8fc7ff : kind === 'grenade' ? 0xffaa48 : kind === 'revive' ? 0xff7ab0 : 0xeebf67;
  const haloMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .34, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.29, .325, 24), haloMaterial);
  ring.rotation.x = -Math.PI / 2; halo.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.275, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .07, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; halo.add(disc);
  pickupTemplates.set(key, root); return root;
}

// An optional pickup style (the Frisson pack's pickups part) dresses the
// models of the styled kinds built from now on; null is the Famille build,
// exactly. One style at a time. Switching styles drops the cached templates
// of the styled kinds only (bonus and the ground weapons keep theirs), so the
// next pickup is built in the new style; shared Frisson geometries
// (geometry.userData.frissonShared) belong to the style and are never disposed
// here, and a MeshStandardMaterial (the world's shared mats, or the style's)
// is never disposed either — only the halo's two MeshBasicMaterials are
// per-template.
export const STYLED_PICKUP_KINDS = Object.freeze(['points', 'ammo', 'health', 'armor', 'grenade', 'revive']);
let pickupStyle = null;
export function setPickupStyle(style = null) {
  pickupStyle = style ?? null;
  for (const [key, template] of pickupTemplates) {
    if (!STYLED_PICKUP_KINDS.some(kind => key.startsWith(`${kind}-`))) continue;
    template.traverse(node => {
      if (!node.isMesh) return;
      if (!node.geometry.userData.frissonShared) node.geometry.dispose();
      if (node.material?.isMeshBasicMaterial) node.material.dispose(); // the pickup halo's two materials
    });
    pickupTemplates.delete(key);
  }
}
export function getPickupStyle() { return pickupStyle; }

// One small reusable prop, no light, texture upload or extra render pass.
// Every vertex fits the same footprint used by the authoritative placement.
export function createRadar() {
  const root = new THREE.Group(); root.name = 'fieldRadar';
  const casing = material('radarCasing', 0x424f40, .8);
  const rim = material('radarRim', 0x242e2d, .55, { metalness: .55 });
  const screen = material('radarScreen', 0x173f35, .6, { emissive: 0x123529, emissiveIntensity: .5 });
  for (const x of [-.19,.19]) for (const z of [-.12,.12]) box(root,x,.014,z,.06,.028,.06,rim,false);
  box(root,0,.102,0,.40,.16,.28,casing,false);
  box(root,0,.025,0,.42,.025,.30,rim,false);
  for (const x of [-.12,.12]) box(root,x,.217,.10,.025,.07,.025,rim,false);
  box(root,0,.25,.10,.265,.025,.025,rim,false);
  for (const x of [-.17,.17]) cylinder(root,x,.24,-.11,.006,.009,.16,rim,6).castShadow=false;
  const face = new THREE.Mesh(new THREE.CircleGeometry(.087,24),screen);
  face.rotation.x=-Math.PI/2;face.position.set(-.04,.184,-.016);root.add(face);
  const markings = material('radarMarkings',0x65a995,.65,{emissive:0x234a3f,emissiveIntensity:.3});
  for (const radius of [.04,.077]) {
    const ring=new THREE.Mesh(new THREE.RingGeometry(radius-.002,radius,24),markings);
    ring.rotation.x=-Math.PI/2;ring.position.copy(face.position);ring.position.y+=.001;root.add(ring);
  }
  const sweep=new THREE.Group();sweep.position.set(-.04,.186,-.016);root.add(sweep);
  box(sweep,.038,0,0,.076,.002,.003,markings,false);
  box(root,.108,.187,-.065,.025,.008,.035,rim,false);
  const indicator=box(root,.108,.188,.003,.024,.008,.024,new THREE.MeshBasicMaterial({color:0x7ef2bc}),false);
  root.userData={sweep,indicator};
  return root;
}

export function createBonusModel(bonus = 'stone') {
  if (bonus === 'radar') { const radar=createRadar();radar.name='bonus-radar';return radar; }
  const root = new THREE.Group(); root.name = `bonus-${bonus}`;
  if (bonus === 'grenadier') { const grenade = grenadeModel(); grenade.scale.setScalar(1.5); root.add(grenade); return root; }
  if (Object.hasOwn(CHARACTER_BONUSES, bonus)) {
    const colors = { vitamins: 0xd4bd55, reload: 0xd39355, switching: 0xb0c9da, vitality: 0xe98680, rainproof: 0x6fa7bd, toughskin: 0x9faaa0, medic: 0xa7d997, frostaura: 0x9ee5ef };
    const color = colors[bonus] ?? 0x8be0bd, body = material(`bonus-${bonus}`, color, .6);
    box(root, 0, .13, 0, .22, .24, .12, body, false);
    box(root, 0, .27, 0, .13, .04, .1, material('bonusLid', 0x3c4b43), false);
    const mark = material('bonusMark', 0xf0efd6);
    if (bonus === 'frostaura') { for (const angle of [0, Math.PI/3, -Math.PI/3]) box(root, 0, .14, .065, .025, .15, .012, mark, false).rotation.z = angle; }
    else { box(root, 0, .14, .065, .11, .025, .012, mark, false); box(root, 0, .14, .065, .025, .11, .012, mark, false); }
    return root;
  }
  const metal = material('bonusMetal', 0x87968d, .5, { metalness: .6 });
  if (bonus === 'perforating') {
    const brass = material('bonusPiercingBrass', 0xc9a768, .4, { metalness: .7 });
    for (const x of [-.09, 0, .09]) {
      cylinder(root, x, .13, 0, .027, .027, .2, brass, 8).castShadow = false;
      cylinder(root, x, .25, 0, 0, .027, .045, metal, 8).castShadow = false;
    }
    box(root, 0, .035, 0, .3, .06, .09, material('bonusPiercingCase', 0x383e34), false);
  } else if (bonus === 'extended') {
    box(root, 0, .15, 0, .15, .27, .085, material('bonusMagazine', 0x485c64, .65, { metalness: .5 }), false).rotation.z = -.12;
    for (const y of [.07, .13, .19]) box(root, .08, y, 0, .012, .017, .08, metal, false);
    box(root, .015, .015, 0, .19, .035, .1, metal, false);
  } else {
    const stone = box(root, 0, .07, 0, .32, .1, .13, material('bonusSharpeningStone', 0x9caaa2), false);
    stone.rotation.z = .07;
    box(root, 0, .015, 0, .36, .025, .16, material('bonusStoneBacking', 0x514833), false);
    for (const x of [-.09, .03, .11]) box(root, x, .123, 0, .012, .003, .1, metal, false).rotation.y = .2;
  }
  return root;
}

// The crate marks itself like outdoor rescue gear: a double red strobe plus
// a pale smoke column, both fog-proof and light-free.
export const SUPPLY_BEACON = Object.freeze({ period: 1.6, firstFlash: .1, secondAt: .24, secondFlash: .1,
  bright: 0xff2d1e, dim: 0x3c0f0a, claimed: 0x61281c, smokeEvery: .62 });

export function supplyBeaconFlash(time, claimed = false) {
  if (claimed) return false;
  const phase = (Number.isFinite(time) ? time : 0) % SUPPLY_BEACON.period;
  return phase < SUPPLY_BEACON.firstFlash
    || (phase >= SUPPLY_BEACON.secondAt && phase < SUPPLY_BEACON.secondAt + SUPPLY_BEACON.secondFlash);
}

export function createSupplyCrate() {
  const root = new THREE.Group(); root.name = 'outdoorSupplyCrate';
  const timber = material('supplyCrateTimber', 0x665844, .94), strap = material('supplyCrateStrap', 0x3a4b45, .6, { metalness: .5 });
  box(root, 0, .17, 0, 1.12, .32, .7, timber, false);
  for (const x of [-.43, .43]) box(root, x, .18, 0, .055, .34, .72, strap, false);
  box(root, 0, .025, 0, 1.15, .05, .73, strap, false);
  // The lid stays low and open. Choices are shown in the menu; the crate
  // keeps its compact physical silhouette, without hanging reward models.
  const lid = box(root, 0, .35, .37, 1.12, .045, .48, timber, false); lid.rotation.x = -.85;
  const indicator = box(root, 0, .18, -.358, .3, .08, .014, new THREE.MeshBasicMaterial({ color: 0xe2c47d }), false);
  indicator.name = 'supplyCrateIndicator';
  const halo = new THREE.Mesh(new THREE.RingGeometry(.7, .77, 32), new THREE.MeshBasicMaterial({ color: 0xd2bd7b, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = .01; root.add(halo);
  // Rescue strobe: thin mast, fog-free lens and an additive halo, no lights.
  const mast = cylinder(root, -.42, .44, -.28, .016, .016, .34, material('beaconMast', 0x2c3531, .6, { metalness: .4 }), 6); mast.castShadow = false;
  const lens = box(root, -.42, .63, -.28, .055, .075, .055, new THREE.MeshBasicMaterial({ color: SUPPLY_BEACON.dim, fog: false, toneMapped: false }), false);
  lens.name = 'crateBeaconLens';
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3626, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  beaconGlow.name = 'crateBeaconGlow'; beaconGlow.position.set(-.42, .63, -.28); beaconGlow.scale.setScalar(.5); root.add(beaconGlow);
  root.userData = { indicator, halo, beacon: { lens, glow: beaconGlow } };
  return root;
}

export function createLateSupplyPost() {
  const root = new THREE.Group(); root.name = 'lateSupplyPost';
  const timber = material('lateSupplyTimber', 0x4c5143, .95), metal = material('lateSupplyMetal', 0x687367, .6, { metalness: .5 });
  box(root, 0, 1.5, .045, 1.18, 1.03, .065, timber, false);
  for (const x of [-.54, .54]) box(root, x, 1.5, .09, .035, 1.05, .035, metal, false);
  const backpack = createBackpack(); backpack.name = 'backpackDisplay'; backpack.position.set(-.405, 1.52, .14); backpack.scale.setScalar(.56); root.add(backpack);
  const grenade = grenadeModel(); grenade.position.set(-.125, 1.38, .1); grenade.scale.setScalar(1.12); root.add(grenade);
  // Display the actual kinds of equipment: an open-neck carrier and a deep
  // ammunition case remain recognisable without a label or a pickup halo.
  const vest = new THREE.Group(); vest.name = 'lateSupplyArmorDisplay'; vest.position.set(.145, 1.48, .11); root.add(vest);
  const fabric = material('lateSupplyArmor', 0x5d7780, .95), plate = material('lateSupplyArmorPlate', 0x33474d, .8);
  const webbing = material('lateSupplyWebbing', 0x263632, .95);
  const outline = new THREE.Shape();
  const points = [[-.085,-.15],[.085,-.15],[.105,-.12],[.105,.065],[.075,.1],[.075,.17],[.035,.17],[.03,.105],[-.03,.105],[-.035,.17],[-.075,.17],[-.075,.1],[-.105,.065],[-.105,-.12]];
  points.forEach(([x,y], index) => index ? outline.lineTo(x,y) : outline.moveTo(x,y)); outline.closePath();
  const carrier = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: .028, bevelEnabled: false }), fabric);
  carrier.name = 'lateSupplyVestBody'; carrier.receiveShadow = true; vest.add(carrier);
  box(vest, 0, .015, .035, .15, .155, .024, plate, false).name = 'lateSupplyVestChestPlate';
  for (const side of [-1, 1]) {
    box(vest, side * .055, .134, .035, .029, .065, .018, webbing, false).name = 'lateSupplyVestShoulderStrap';
    box(vest, side * .112, -.04, .014, .022, .075, .024, webbing, false).name = 'lateSupplyVestSideStrap';
  }
  for (const x of [-.06, 0, .06]) {
    box(vest, x, -.102, .047, .047, .065, .035, fabric, false).name = 'lateSupplyVestPouch';
    box(vest, x, -.072, .067, .049, .014, .009, webbing, false);
  }
  const ammunition = new THREE.Group(); ammunition.name = 'lateSupplyAmmoDisplay'; ammunition.position.set(.415, 1.285, .165); root.add(ammunition);
  const casing = material('lateSupplyAmmo', 0x737c4e, .82, { metalness: .3 });
  box(ammunition, 0, .09, 0, .225, .18, .135, casing, false).name = 'lateSupplyAmmoCase';
  box(ammunition, 0, .19, 0, .24, .025, .15, metal, false).name = 'lateSupplyAmmoLid';
  for (const x of [-.055, .055]) box(ammunition, x, .224, 0, .017, .045, .025, metal, false).name = 'lateSupplyAmmoHandleSupport';
  box(ammunition, 0, .249, 0, .127, .017, .025, webbing, false).name = 'lateSupplyAmmoHandle';
  box(ammunition, .083, .164, .075, .027, .05, .015, metal, false).name = 'lateSupplyAmmoLatch';
  const brass = material('lateSupplyAmmoBrass', 0xd4ad62, .42, { metalness: .7 });
  for (const x of [-.055, 0, .055]) {
    const round = cylinder(ammunition, x, .099, .081, .009, .009, .075, brass, 6); round.castShadow = false; round.name = 'lateSupplyAmmoCartridge';
    const tip = cylinder(ammunition, x, .1465, .081, .001, .009, .02, brass, 6); tip.castShadow = false;
  }
  box(ammunition, 0, .068, .091, .15, .017, .01, webbing, false).name = 'lateSupplyAmmoCartridgeClip';
  for (const x of [-.405, -.125, .145, .415]) box(root, x, 1.24, .12, .25, .035, .025, metal, false);
  return root;
}

// A compact canvas pack, built once with the survivor. The rear pocket faces
// +Z; thin shoulder straps wrap round the torso without covering the arms.
export function createBackpack() {
  const pack = new THREE.Group(); pack.name = 'survivorBackpack';
  const canvas = material('backpackCanvas', 0x596044, .97);
  const flap = material('backpackFlap', 0x6c7350, .97);
  const webbing = material('backpackWebbing', 0x323b2c, .95);
  const buckle = material('backpackBuckle', 0x8d927b, .62, { metalness: .35 });
  const piece = (name, x, y, z, w, h, d, mat) => { const mesh = box(pack, x, y, z, w, h, d, mat, false); mesh.name = name; return mesh; };
  piece('backpackCanvasBody', 0, 0, 0, .36, .47, .2, canvas);
  piece('backpackTopFlap', 0, .185, .025, .39, .13, .235, flap);
  piece('backpackRearPocket', 0, -.105, .13, .27, .21, .095, canvas);
  piece('backpackPocketFlap', 0, -.02, .14, .29, .055, .11, flap);
  piece('backpackPocketSeam', 0, -.207, .18, .25, .009, .008, webbing);
  for (const side of [-1, 1]) {
    piece('backpackSidePocket', side * .211, -.065, .005, .07, .255, .16, canvas);
    piece('backpackSideFlap', side * .211, .055, .02, .075, .055, .17, flap);
    piece('backpackRearStrap', side * .11, .055, .154, .035, .36, .012, webbing);
    piece('backpackRearBuckle', side * .11, -.02, .169, .055, .04, .018, buckle);
    piece('backpackShoulderStrap', side * .16, .035, -.455, .035, .42, .014, webbing);
    piece('backpackShoulderLoop', side * .16, .253, -.225, .035, .03, .47, webbing);
    piece('backpackShoulderBuckle', side * .16, -.075, -.467, .05, .04, .018, buckle);
  }
  piece('backpackHandleLeft', -.065, .28, -.02, .025, .07, .035, webbing);
  piece('backpackHandleRight', .065, .28, -.02, .025, .07, .035, webbing);
  piece('backpackHandleTop', 0, .315, -.02, .155, .025, .035, webbing);
  return pack;
}

export function createPickup(kind = 'points', special = false, fill = 1) {
  if (kind === 'bonus') {
    const requested = typeof special === 'string' ? special : fill;
    const bonus = typeof requested === 'string' && Object.hasOwn(SUPPLY_BONUSES, requested) ? requested : 'stone';
    const group = new THREE.Group(), model = createBonusModel(bonus), halo = new THREE.Group();
    group.name = 'pickup-bonus'; model.name = 'pickupModel'; halo.name = 'pickupHalo';
    const ring = new THREE.Mesh(new THREE.RingGeometry(.23, .26, 24), new THREE.MeshBasicMaterial({ color: 0xe0b86a, transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; halo.position.y = .012; halo.add(ring); group.add(model, halo);
    group.userData = { kind: 'bonus', bonus, model, halo, phase: Math.random() * Math.PI * 2 };
    return group;
  }
  kind = ['ammo', 'health', 'armor', 'grenade', 'revive'].includes(kind) ? kind : 'points';
  special = kind === 'ammo' && special === true;
  const group = pickupTemplate(kind, special).clone(true);
  group.userData = { kind, special, model: group.getObjectByName('pickupModel'), halo: group.getObjectByName('pickupHalo'), phase: Math.random() * Math.PI * 2 };
  setPickupFill(group, fill);
  return group;
}

export function setPickupFill(group, value = 1) {
  if (group.userData.kind !== 'ammo') return;
  const fill = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  group.userData.fill = fill;
  const indicator = group.getObjectByName('ammoFill');
  if (!indicator) return;
  indicator.visible = fill > 0;
  indicator.scale.x = fill;
  indicator.position.x = fill === 1 ? 0 : -.125 * (1 - fill);
}

export function animatePickup(group, time) {
  const { model, halo, phase = 0, kind } = group.userData;
  if (!model || !halo) return;
  // The authoritative root stays on its exact floor/stair position.
  const t = Number.isFinite(time) ? time : 0;
  if (kind !== 'weapon') {
    model.position.y = .022 + Math.sin(t * 2.1 + phase) * .016;
    model.rotation.y = t * .45 + phase;
  }
  halo.scale.setScalar(1 + Math.sin(t * 2.1 + phase) * .065);
}

// Ground weapons reuse the held model, with its hands removed. Cached meshes
// share GPU resources just like the other pickups; collecting one only removes
// its scene instance. The server position remains the floor reference.
const groundWeaponTemplates = new Map();
// Two rack supports per weapon, in the held weapon's own frame (x across,
// y up, z along the barrel, the melee frames in their ready pose): under the
// forend or barrel and under the stock or frame for guns, under the shaft or
// blade and under the grip for melee. Each is the lowest point of the weapon
// over its hook post's footprint (0.055 m wide, z 0.0495-0.1945 on the
// rack), less 0.3 mm, measured on the fitted Famille weapon: a post whose top
// is there touches the weapon without entering it
// (test/weapon-rack-supports.test.mjs).
const RACK_SUPPORTS = Object.freeze({
  pistol: [[.003, -.0473, -.2476], [.003, -.1243, -.0581]], // slide nose, trigger guard
  rifle: [[.0225, -.0257, -.6968], [.0225, -.0955, .3782]], // barrel, stock
  shotgun: [[0, -.0954, -.6433], [0, -.0954, .3654]], // magazine tube, stock
  smg: [[.0002, -.0199, -.2465], [.0002, -.0545, .2612]], // handguard, stock
  minigun: [[0, -.1036, -.7686], [0, -.0956, .3707]], // front collar, back of the receiver
  magnum: [[0, .0006, -.356], [0, -.147, -.028]], // underlug, trigger guard
  assault: [[0, -.0278, -.4395], [0, -.0778, .3315]], // handguard, stock
  rocket: [[.0122, -.0806, -.5209], [.0122, -.1406, .3034]], // tube, shoulder rest
  flamethrower: [[0, -.0738, -.5973], [0, -.2358, .1433]], // pilot light under the shroud, tank
  katana: [[.0059, .3239, -.5902], [.0059, -.1291, .1205]], // blade, grip
  hammer: [[.0011, .1936, -.429], [.0011, -.1898, .1872]], // shaft, grip
  sniper: [[.0493, .0318, -.8089], [.0493, -.098, .3662]], // barrel, stock
  bat: [[0, .1841, -.4342], [0, -.1152, .1027]], // barrel, handle
  fireaxe: [[-.0585, 0, -.4996], [-.0622, 0, .1915]], // shaft, grip
});
// Where the two hook posts stand, in rack space: each support point carried
// through the fitted weapon's transform, x kept between the side trims and
// the top inside the rack box. The fit does not depend on the style, so a
// restyled weapon (restyleArmory) sits on the same posts.
function rackSupports(gun, type) {
  gun.updateMatrix();
  return RACK_SUPPORTS[type].map(point => {
    const { x, y } = new THREE.Vector3(...point).applyMatrix4(gun.matrix);
    return [THREE.MathUtils.clamp(x, -.545, .545), THREE.MathUtils.clamp(y, 1.1, 2.07)];
  });
}
// The weapon hanging on a rack, fitted by uniform scale from its Famille
// bounds (so the rack placement never changes), then dressed for the current
// style. restyleArmory rebuilds racks through this same helper.
function buildRackWeapon(type) {
  const gun = createHeldWeapon(type); gun.name = `rackWeapon-${type}`; gun.userData = {};
  gun.rotation.y = Math.PI / 2;
  if (type === 'fireaxe') {
    // A wall-mounted axe hangs by its broad cheek. Keeping the FPS ready
    // pose here would turn the head into the rack's depth, and the generic
    // depth limit would then shrink the entire axe to a miniature.
    gun.getObjectByName('fireaxeSwing').rotation.set(0, 0, 0);
    gun.rotation.set(Math.PI / 2, 0, .65, 'ZYX');
  }
  gun.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(gun), size = bounds.getSize(new THREE.Vector3());
  // Uniform scale keeps each silhouette intact, including the minigun drum.
  // The thin SMG must not be enlarged to fill the same rack footprint as the
  // heavier guns; its actual compact proportions remain visible on the wall.
  gun.scale.setScalar(Math.min(type === 'smg' ? .65 : .95, 1.15 / size.x, (type === 'fireaxe' ? .95 : .65) / size.y, .14 / size.z));
  gun.updateMatrixWorld(true); bounds = new THREE.Box3().setFromObject(gun);
  const center = bounds.getCenter(new THREE.Vector3());
  gun.position.set(-center.x, 1.5 - center.y, .074 - bounds.min.z);
  weaponStyle?.dress(gun, { type, view: 'rack' });
  return gun;
}

export function createArmoryRack(type = 'rifle') {
  type = WEAPON_MODELS.includes(type) ? type : 'rifle';
  const root = new THREE.Group(), structure = new THREE.Group(); root.name = 'armoryRack'; root.add(structure);
  const verticalScale = ARMORY_RACK.height / 1.25;
  structure.scale.set(ARMORY_RACK.width / 1.3, verticalScale, ARMORY_RACK.depth / .22);
  structure.position.y = ARMORY_RACK.baseY - .9 * verticalScale;
  const timber = material('rackTimber', 0x514533, .95), dark = material('rackTrim', 0x302a24, .9);
  const iron = material('rackIron', 0x70716a, .5, { metalness: .65 });
  // All geometry fits local x ±.65, y .9..2.15, z 0...22. These exact
  // dimensions are shared by the authoritative rack collider.
  box(structure, 0, 1.52, .035, 1.3, 1.2, .055, timber);
  for (const x of [-.6, .6]) box(structure, x, 1.52, .07, .055, 1.2, .035, dark);
  for (const y of [.94, 2.1]) box(structure, 0, y, .07, 1.3, .055, .035, dark);
  // Each hook post stands under one of the weapon's two support points, its
  // top touching the weapon; the front lip keeps its place below the top.
  const gun = buildRackWeapon(type);
  for (const [x, top] of rackSupports(gun, type)) {
    box(structure, x, top - .075, .122, .055, .15, .145, iron);
    box(structure, x, top - .125, .182, .07, .035, .045, iron);
  }
  structure.add(gun); root.userData = { weapon: type };
  return root;
}

export function createGroundWeapon(type = 'pistol') {
  type = WEAPON_MODELS.includes(type) ? type : 'pistol';
  if (!groundWeaponTemplates.has(type)) {
    const root = new THREE.Group(), model = new THREE.Group(), gun = createHeldWeapon(type);
    root.name = 'pickup-weapon'; model.name = 'pickupModel'; root.add(model); model.add(gun);
    gun.name = `groundWeapon-${type}`; gun.userData = {};
    gun.rotation.z = Math.PI / 2;
    // The axe rests on its broad cheek, rather than balancing vertically on
    // its edge. This low, static pose is independent of its held wind-up.
    if (type === 'fireaxe') { gun.rotation.set(0, 0, 0); gun.getObjectByName('fireaxeSwing').rotation.set(0, 0, 0); }
    gun.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gun), center = bounds.getCenter(new THREE.Vector3());
    gun.position.set(-center.x, .018 - bounds.min.y, -center.z);
    weaponStyle?.dress(gun, { type, view: 'ground' });
    const halo = new THREE.Group(); halo.name = 'pickupHalo'; halo.position.y = .012; root.add(halo);
    const glow = new THREE.MeshBasicMaterial({ color: 0x75baff, transparent: true, opacity: .34, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(.3, .33, 28), glow);
    ring.rotation.x = -Math.PI / 2; halo.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(.285, 24), new THREE.MeshBasicMaterial({ color: 0x75baff, transparent: true, opacity: .07, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; halo.add(disc);
    groundWeaponTemplates.set(type, root);
  }
  const group = groundWeaponTemplates.get(type).clone(true);
  group.userData = { kind: 'weapon', weapon: type, model: group.getObjectByName('pickupModel'), halo: group.getObjectByName('pickupHalo'), phase: Math.random() * Math.PI * 2 };
  return group;
}

export function setGroundWeaponPose(group, { yaw = 0, pitch = 0, modelLift = 0 } = {}) {
  if (group?.userData.kind !== 'weapon') return;
  group.rotation.set(0, Number.isFinite(yaw) ? yaw : 0, 0);
  // The server chooses the support height and inclination. Keep the halo on
  // that horizontal support plane while the actual weapon rests on steps.
  group.userData.model.rotation.x = Number.isFinite(pitch) ? pitch : 0;
  group.userData.model.position.y = Number.isFinite(modelLift) ? modelLift : 0;
}

function grenadeModel() {
  const model = new THREE.Group(); model.name = 'grenadeBody';
  const olive = material('grenadeOlive', 0x56623b, .8, { metalness: .32 });
  const amber = material('grenadeBand', 0xdfa24d, .55, { metalness: .25 });
  const steel = material('grenadeSteel', 0x8a9692, .35, { metalness: .75 });
  const body = sphere(model, 0, .078, 0, .06, olive, .9, 1.18, .9); body.castShadow = false;
  for (const y of [.052, .085, .117]) cylinder(model, 0, y, 0, y === .117 ? .039 : .054, y === .117 ? .039 : .054, .009, amber, 12).castShadow = false;
  cylinder(model, 0, .147, 0, .023, .03, .028, olive, 10).castShadow = false;
  box(model, .023, .143, 0, .014, .082, .026, steel, false).rotation.z = -.24;
  const pin = new THREE.Mesh(new THREE.TorusGeometry(.019, .0035, 5, 12), steel); pin.name = 'grenadePin'; pin.position.set(-.033, .157, 0); model.add(pin);
  model.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
  return model;
}

let grenadeProjectileTemplate;
export function createGrenadeProjectile() {
  if (!grenadeProjectileTemplate) {
    const root = new THREE.Group(), model = grenadeModel(); root.name = 'grenadeProjectile';
    // Projectile coordinates describe its centre, unlike floor pickup roots.
    model.position.y = -.085; root.add(model); grenadeProjectileTemplate = root;
  }
  const group = grenadeProjectileTemplate.clone(true);
  group.userData = { model: group.getObjectByName('grenadeBody') };
  return group;
}

export function animateGrenadeProjectile(group, time) {
  const model = group.userData.model;
  if (!model) return;
  const t = Number.isFinite(time) ? time : 0;
  model.rotation.set(t * 7.4, t * 3.1, t * 2.3);
}

// Short unlit blast, dust and sparks. It adds no persistent/dynamic lights and
// owns every resource it disposes; one explosion cannot affect another.
export function createGrenadeExplosion(position = {}, { time = 0, radius = 4 } = {}) {
  const start = Number.isFinite(time) ? time : 0;
  radius = Number.isFinite(radius) ? THREE.MathUtils.clamp(radius, .1, 20) : 4;
  const mesh = new THREE.Group(); mesh.name = 'grenadeExplosion';
  mesh.position.set(...['x', 'y', 'z'].map(axis => Number.isFinite(position[axis]) ? position[axis] : 0));
  // Fireball, sparks, embers and smoke live in the shared particle engine;
  // only the shock ring on the ground is a mesh of its own.
  explosionBurst(mesh.position, { time: start, radius });
  const effects = hostEffects(mesh);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffc27a, opacity: .75, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 48), ringMaterial); ring.name = 'explosionRing'; ring.rotation.x = -Math.PI / 2; ring.position.y = .03; mesh.add(ring);
  let disposed = false;
  const effect = {
    mesh,
    update(now) {
      if (disposed) return false;
      const age = Math.max(0, (Number.isFinite(now) ? now : start) - start), progress = THREE.MathUtils.clamp(age / .6, 0, 1);
      driveEffects(effects, now);
      // The shock ring races out, then thins away.
      ring.scale.setScalar(Math.max(.001, radius * Math.min(1, Math.sqrt(age / .34))));
      ringMaterial.opacity = .75 * (1 - progress) ** 1.5;
      mesh.visible = age < .6;
      return mesh.visible;
    },
    dispose() {
      if (disposed) return;
      disposed = true; mesh.visible = false; mesh.removeFromParent();
      ring.geometry.dispose(); ringMaterial.dispose();
    },
  };
  effect.update(start);
  return effect;
}

// A teammate holds the same weapon model as the first-person view, minus its
// first-person hands. Positions are in the shoulder-pivoted aim group; hand
// grips are in weapon space.
const HELD_WEAPONS = {
  pistol: { position: [.05, -.03, -.38], scale: .9, right: [0, -.15, .07], left: [-.015, -.16, .05] },
  magnum: { position: [.06, -.03, -.38], scale: .9, right: [0, -.14, .09], left: [-.015, -.15, .07] },
  minigun: { position: [.13, -.24, -.24], scale: .8, right: [0, -.12, .14], left: [0, .19, .03] },
  rocket: { position: [.18, -.01, -.3], scale: .8, right: [0, -.13, .05], left: [0, -.09, -.28] },
  flamethrower: { position: [.16, -.17, -.29], scale: .8, right: [0, -.15, .1], left: [0, -.1, -.3] },
  katana: { position: [.12, -.11, -.25], scale: .9, right: [.015, -.02, .1], left: [-.015, -.02, .24] },
  hammer: { position: [.12, -.13, -.26], scale: .85, right: [.025, -.025, .12], left: [-.025, -.025, .3] },
  bat: { position: [.12, -.11, -.24], scale: .95, right: [.025, -.025, .1], left: [-.025, -.025, .255] },
  fireaxe: { position: [.12, -.12, -.25], scale: .9, right: [.026, -.025, .1], left: [-.026, -.025, .29] },
  sniper: { position: [.15, -.06, -.35], scale: .85, right: [0, -.12, .14], left: [0, -.09, -.34] },
  smg: { position: [.14, -.05, -.34], scale: .85, right: [0, -.11 * SMG_MODEL_SCALE, .12 * SMG_MODEL_SCALE], left: [0, -.075 * SMG_MODEL_SCALE, -.27 * SMG_MODEL_SCALE] },
  long: { position: [.14, -.05, -.34], scale: .85, right: [0, -.12, .14], left: [0, -.09, -.25] },
};
const ARM_LENGTH = .51, DOWN = new THREE.Vector3(0, -1, 0);
let flashTexture;
function muzzleFlashTexture() {
  if (flashTexture !== undefined) return flashTexture;
  flashTexture = null;
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const context = canvas?.getContext?.('2d');
  if (!context?.createRadialGradient) return flashTexture;
  canvas.width = canvas.height = 64;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,250,228,1)'); glow.addColorStop(.28, 'rgba(255,212,130,.9)');
  glow.addColorStop(.62, 'rgba(255,146,54,.32)'); glow.addColorStop(1, 'rgba(255,120,40,0)');
  context.fillStyle = glow; context.fillRect(0, 0, 64, 64);
  flashTexture = new THREE.CanvasTexture(canvas); flashTexture.colorSpace = THREE.SRGBColorSpace;
  return flashTexture;
}
function createMuzzleFlash() {
  const flash = new THREE.Group(); flash.name = 'muzzleFlash'; flash.visible = false;
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd08a, map: muzzleFlashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  // Two crossed petals along the barrel and a disc facing it read from every side.
  const flat = new THREE.Mesh(new THREE.PlaneGeometry(.17, .46), glow); flat.rotation.x = Math.PI / 2; flat.position.z = -.2;
  const upright = new THREE.Mesh(new THREE.PlaneGeometry(.46, .17), glow); upright.rotation.y = Math.PI / 2; upright.position.z = -.2;
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(.24, .24), glow); disc.position.z = -.03;
  flash.add(flat, upright, disc);
  return flash;
}
// A held weapon is the first-person build minus the hands; it is never
// dressed here (each view dresses its own copy: held, rack or ground).
export function createHeldWeapon(type) {
  const gun = buildWeapon(type);
  const hands = [mats.firstPersonHand, mats.firstPersonSleeve], removed = [];
  gun.traverse(node => { if (node.isMesh && hands.includes(node.material)) removed.push(node); });
  for (const node of removed) { node.parent.remove(node); node.geometry.dispose(); }
  gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0);
  return gun;
}
// A friendly face for teammates: bright eyes, brows and a small smile, merged
// into one mesh. A raider's goggles and bandana cover it.
let survivorFaceGeometry;
function survivorFace() {
  if (!survivorFaceGeometry) {
    const face = new PartBuilder(), ball = new THREE.SphereGeometry(1, 10, 8), block = new THREE.BoxGeometry(1, 1, 1);
    // A focused survivor, not a toy (owner, 12 October): narrow
    // eyes under a heavy lid, low brows dipping toward the nose, a nose, and
    // a firm straight mouth. Still a stylized face, never grim.
    for (const side of [-1, 1]) {
      face.add(ball, 0xe9e4d8, { position: [side * .058, .012, -.162], scale: [.026, .013, .012] });
      face.add(ball, 0x2a2420, { position: [side * .056, .01, -.172], scale: [.012, .0115, .006] });
      face.add(block, 0xa77d5f, { position: [side * .058, .024, -.168], rotation: [0, 0, side * .1], scale: [.058, .012, .016] });
      face.add(block, 0x3a2a22, { position: [side * .06, .046, -.168], rotation: [0, 0, side * .15], scale: [.064, .018, .022] });
    }
    face.add(ball, 0xb88c6a, { position: [0, -.024, -.175], scale: [.016, .027, .018] });
    face.add(block, 0x5e3329, { position: [0, -.078, -.163], scale: [.056, .011, .018] });
    survivorFaceGeometry = mergeGeometries(face.parts);
  }
  const mesh = new THREE.Mesh(survivorFaceGeometry, material('survivorFace', 0xffffff, .6, { vertexColors: true }));
  mesh.name = 'survivorFace'; mesh.castShadow = false;
  return mesh;
}
let raiderBandanaGeometry_;
function raiderBandanaGeometry() {
  if (!raiderBandanaGeometry_) {
    const cloth = new PartBuilder(), ball = new THREE.SphereGeometry(1, 16, 10), cone = new THREE.ConeGeometry(1, 1, 6);
    cloth.add(ball, 0xffffff, { position: [0, -.07, -.008], scale: [.178, .07, .168] });
    cloth.add(cone, 0xffffff, { position: [0, -.125, -.155], rotation: [Math.PI + .25, 0, 0], scale: [.045, .05, .018] });
    for (const side of [-1, 1]) cloth.add(cone, 0xffffff, { position: [side * .035, -.08, .19], rotation: [-.9, 0, side * .6], scale: [.03, .09, .02] });
    raiderBandanaGeometry_ = mergeGeometries(cloth.parts);
  }
  return raiderBandanaGeometry_;
}
let raiderGoggleGeometry;
function raiderGoggleParts(glow) {
  if (!raiderGoggleGeometry) {
    const frame = new PartBuilder(), lenses = new PartBuilder();
    const tube = new THREE.CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2), block = new THREE.BoxGeometry(1, 1, 1);
    const ring = new THREE.TorusGeometry(1, .07, 6, 28).rotateX(Math.PI / 2);
    frame.add(block, 0x2b3033, { position: [0, .045, -.172], scale: [.2, .06, .05] });
    frame.add(ring, 0x1d2124, { position: [0, .04, -.01], scale: [.2, .22, .19] });
    for (const side of [-1, 1]) {
      frame.add(tube, 0x24292c, { position: [side * .052, .035, -.222], scale: [.034, .034, .085] });
      lenses.add(tube, 0xffffff, { position: [side * .052, .035, -.267], scale: [.027, .027, .008] });
      lenses.add(block, 0xffffff, { position: [side * .206, .04, -.03], scale: [.012, .022, .05] });
    }
    raiderGoggleGeometry = { frame: mergeGeometries(frame.parts), lenses: mergeGeometries(lenses.parts) };
  }
  const group = new THREE.Group(); group.name = 'raiderGoggleSet';
  const mount = new THREE.Mesh(raiderGoggleGeometry.frame, material('raiderGoggleFrame', 0xffffff, .55, { vertexColors: true, metalness: .3 }));
  mount.name = 'raiderGoggleFrame';
  const lenses = new THREE.Mesh(raiderGoggleGeometry.lenses, glow); lenses.name = 'raiderGoggles';
  group.add(mount, lenses);
  return group;
}
// Raiders reuse this rig without the pack or the throwaway pistol.
// A small glowing chevron over each of the last zombies of a wave, drawn
// through walls at a constant on-screen size (about 32 px tall at 800 px).
let stragglerTexture = null;
export function createStragglerMarker({ text = '', health = null, exact = '' } = {}) {
  if (!stragglerTexture) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const glow = context.createRadialGradient(32, 30, 4, 32, 30, 30); glow.addColorStop(0, 'rgba(255,170,70,.55)'); glow.addColorStop(1, 'rgba(255,120,40,0)');
    context.fillStyle = glow; context.fillRect(0, 0, 64, 64);
    context.beginPath(); context.moveTo(14, 18); context.lineTo(50, 18); context.lineTo(32, 46); context.closePath();
    context.lineJoin = 'round'; context.lineWidth = 6; context.strokeStyle = '#2a1206'; context.stroke();
    context.fillStyle = '#ffb04a'; context.fill();
    stragglerTexture = new THREE.CanvasTexture(canvas); stragglerTexture.colorSpace = THREE.SRGBColorSpace;
  }
  let map = stragglerTexture;
  const detailed = Boolean(text || health !== null || exact);
  if (detailed) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(stragglerTexture.image, 96, 0, 64, 64);
    ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#e9f4d6';
    ctx.strokeStyle = '#142119'; ctx.lineWidth = 4;
    if (text) { ctx.strokeText(text, 128, 83); ctx.fillText(text, 128, 83); }
    if (health !== null) { ctx.fillStyle = '#1d3529'; ctx.fillRect(64, 92, 128, 8); ctx.fillStyle = '#b5e6a0'; ctx.fillRect(64, 92, 128 * health, 8); }
    if (exact) { ctx.fillStyle = '#e9f4d6'; ctx.fillText(exact, 128, 122); }
    map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  }
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false }));
  marker.name = 'stragglerMarker'; marker.renderOrder = 999; marker.scale.set(detailed ? .21 : .062, detailed ? .105 : .062, 1); marker.userData.ownedMap = detailed;
  return marker;
}

// The players' look may come from a style installed at runtime (the Frisson
// survivors, art/frisson/SURVIVORS.md); null is the storybook survivor
// below. style.plan({ color, identity, raider }) answers for a whole
// survivor or for none (null). With a plan, createSurvivor still makes,
// names, places and orders every group and pivot and asks the style for the
// meshes where it would build boxes: style.buildTorso(body, plan) adds the
// torso first and returns { torso, vest }, buildHips(body, plan) { belt },
// buildHead(head, plan, { glow }), buildLeg(leg, knee, plan, { side })
// { boot } (on the knee), buildArm(arm, plan, { side }) { hand }. A style
// missing a builder is no style. Styled meshes share the style's geometry;
// their hands keep their true size on stretched arms (userData.hands).
let survivorStyle = null;
const SURVIVOR_BUILDERS = Object.freeze(['plan', 'buildHead', 'buildTorso', 'buildHips', 'buildArm', 'buildLeg']);
export function setSurvivorStyle(style = null) { survivorStyle = style ?? null; }
export function getSurvivorStyle() { return survivorStyle; }
function survivorPlan(color, identity, raider) {
  const style = survivorStyle;
  if (!style || !SURVIVOR_BUILDERS.every(name => typeof style[name] === 'function')) return null;
  const plan = style.plan({ color, identity, raider }) ?? null;
  return plan ? { style, plan } : null;
}
// A deep green glow stays green after tone mapping instead of washing out.
function raiderGoggleMaterial() { return material('raiderGoggles',RAIDER_APPEARANCE.accentColor,.35,{emissive:0x0b8a50,emissiveIntensity:2.1}); }

// identity: { id, name, companion, look } of the snapshot player (null in tools).
export function createSurvivor(color=0x6299a2,{backpack:packed=true,weapon='pistol',identity=null,raider=false}={}) {
  const styled=survivorPlan(color,identity,raider),style=styled?.style,plan=styled?.plan;
  const survivor=new THREE.Group();const clothes=styled?null:new THREE.MeshStandardMaterial({color,roughness:.9});
  const body=new THREE.Group();survivor.add(body);
  const skin=material('humanSkin',0xc59b78),pants=material('humanPants',0x303d40),cap=material('cap',0x36474a);
  const {torso,vest}=styled?style.buildTorso(body,plan):{torso:box(body,0,1.17,0,.46,.57,.28,clothes),vest:box(body,0,1.2,-.17,.35,.45,.07,material('vest',0x293738))};
  const backpack=packed?createBackpack():null;if(backpack){backpack.position.set(0,1.18,.26);backpack.visible=false;body.add(backpack);}
  const belt=styled?style.buildHips(body,plan).belt:box(body,0,.9,0,.42,.08,.26,material('belt',0x2a2420));
  const head=new THREE.Group();head.position.set(0,1.67,0);body.add(head);
  if(styled)style.buildHead(head,plan,{glow:raider?raiderGoggleMaterial():null});
  else{sphere(head,0,0,0,.19,skin,.9,1.1,.9);sphere(head,0,.09,.015,.195,cap,1,.6,1).name='survivorCap';
    box(head,0,.07,-.2,.21,.025,.13,cap).name='survivorBrim';
    head.add(survivorFace());}
  const knees=[],boots=[],hands=[];
  const legs=[-1,1].map(side=>{
    if(styled){const leg=joint(body,side*.13,.9,0),knee=joint(leg,0,-.38,0);knees.push(knee);boots.push(style.buildLeg(leg,knee,plan,{side}).boot);return leg;}
    const leg=limb(body,side*.13,.9,0,.18,.38,pants),knee=limb(leg,0,-.38,0,.17,.35,pants);knees.push(knee);boots.push(box(knee,0,-.38,-.05,.2,.1,.29,material('boots',0x221e1b)));return leg;});
  // Arms and weapon pivot together at the shoulders and follow the aim pitch.
  const aim=new THREE.Group();aim.position.set(0,1.42,0);body.add(aim);
  const arms=[-1,1].map(side=>{
    if(styled){const arm=joint(aim,side*.24,0,0);hands.push(style.buildArm(arm,plan,{side}).hand);return arm;}
    const arm=limb(aim,side*.24,0,0,.13,ARM_LENGTH-.06,clothes);box(arm,0,-ARM_LENGTH+.03,0,.12,.11,.13,skin);return arm;});
  const holder=new THREE.Group();aim.add(holder);
  survivor.userData={body,head,aim,holder,arms,legs,knees,boots,torso,vest,belt,backpack,flash:createMuzzleFlash(),gun:null,weaponType:null,gait:0,speed:0,pose:0,crouch:0,reload:0,recoil:0,flashUntil:-Infinity,last:null};
  if(styled)Object.assign(survivor.userData,{hands,character:plan.character});
  setSurvivorWeapon(survivor,weapon);
  return survivor;
}
// A raider is the survivor rig with swapped material references, never
// recolored shared ones. Accents are MeshStandard boxes (the goggles reuse the
// zombie-eye program), with no light and no shadow. A survivor style dresses
// its own raiders (hood, mask, goggles, armband, back mark): then none of this.
function dressRaider(d) {
  const jacket=material('raiderJacket',RAIDER_APPEARANCE.clothColor,.93),rig=material('raiderChestRig',0x3a3428,.88);
  const trousers=material('raiderTrousers',0x1c2023,.92),hood=material('raiderHood',0x272b2c,.96);
  const red=material('raiderRed',RAIDER_APPEARANCE.color,.9),chevron=material('raiderChevron',0xd8d0b8,.8);
  const goggles=raiderGoggleMaterial();
  d.torso.material.dispose();d.torso.material=jacket;for(const arm of d.arms)arm.children[0].material=jacket;
  d.vest.material=rig;
  for(const index of [0,1]){d.legs[index].children[0].material=trousers;d.knees[index].children[0].material=trousers;}
  const cap=d.head.getObjectByName('survivorCap'),brim=d.head.getObjectByName('survivorBrim');
  cap.name='raiderHood';cap.material=hood;cap.position.set(0,.035,.045);cap.scale.set(1,1.05,.95);
  d.head.remove(brim);brim.geometry.dispose();
  // The friendly survivor face stays off the raider (goggles and bandana).
  const face=d.head.getObjectByName('survivorFace');if(face)d.head.remove(face);
  // A rounded bandana over the nose and mouth, knotted at the back.
  const bandana=new THREE.Mesh(raiderBandanaGeometry(),red);bandana.name='raiderBandana';d.head.add(bandana);
  // Night-vision goggles: a dark mount and strap, two short tubes, and cold
  // green lenses plus side lamps, far in hue from every zombie eye, so a
  // raider reads from the front and from the side.
  d.head.add(raiderGoggleParts(goggles));
  box(d.arms[0],0,-.13,0,.15,.07,.15,red,false).name='raiderArmband';
  for(const side of [-1,1]){const mark=box(d.torso,side*.055,.06,.145,.13,.03,.012,chevron,false);mark.rotation.z=side*.62;mark.name='raiderChevron';}
}
// id: the raider's server id, for a style's pick (null in tools).
export function createRaider({weapon='smg',maxHp,id=null}={}) {
  const raider=createSurvivor(RAIDER_APPEARANCE.clothColor,{backpack:false,weapon:null,raider:true,identity:id===null?null:{id}}),d=raider.userData;
  if(!d.character)dressRaider(d);
  // A raider crouches less deeply than a survivor: its head sits where the
  // server's crouched hitbox puts it (the full crouch lowers the head .86 m).
  const profile=enemyProfile({kind:'raider'});
  Object.assign(d,{raider:true,kind:'raider',boss:false,maxHp,crouchDepth:(profile.head-profile.crouchHead)/.86});
  setSurvivorWeapon(raider,weapon);
  raider.traverse(node=>{if(node.isMesh)node.castShadow=false;});
  raider.name='raider';
  return raider;
}
export function setSurvivorWeapon(group,type='pistol') {
  const d=group.userData;
  if(!WEAPON_MODELS.includes(type))type=null;
  if(!d.holder||d.weaponType===type)return;
  if(d.gun){d.gun.remove(d.flash);d.holder.remove(d.gun);d.gun.traverse(node=>{if(node.geometry&&!node.geometry.userData.frissonShared)node.geometry.dispose();});d.gun.userData.heatMaterial?.dispose();}
  d.gun=null;d.weaponType=null;d.flash.visible=false;d.flashUntil=-Infinity;d.recoil=0;
  if(type===null){
    d.reload=0;d.holder.position.z=0;
    for(const arm of d.arms){arm.scale.y=1;arm.quaternion.identity();}
    if(d.hands)for(const hand of d.hands)hand.scale.y=1;
    return;
  }
  const held=HELD_WEAPONS[type]??HELD_WEAPONS.long,gun=createHeldWeapon(type);
  gun.position.fromArray(held.position);gun.scale.setScalar(held.scale);
  weaponStyle?.dress(gun,{type,view:'held'});
  if(!gun.userData.melee){gun.add(d.flash);d.flash.position.copy(gun.userData.muzzle);}
  d.holder.add(gun);d.gun=gun;d.weaponType=type;
  fitSurvivorGrips(d,held);
}
function fitSurvivorGrips(d,held){
  const reach=d.gripScratch??(d.gripScratch=new THREE.Vector3()),pivot=d.gun.userData.melee?d.gun.userData.meleePivot:null;
  for(const[arm,grip]of[[d.arms[1],held.right],[d.arms[0],held.left]]){
    reach.fromArray(grip);if(pivot){if(d.gun.userData.bladeFrame)reach.applyEuler(d.gun.userData.bladeFrame.rotation);reach.applyEuler(pivot.rotation).add(pivot.position);}
    reach.multiplyScalar(held.scale).add(d.gun.position).sub(arm.position);
    arm.scale.y=reach.length()/ARM_LENGTH;arm.quaternion.setFromUnitVectors(DOWN,reach.normalize());
  }
  if (d.secondaryGun) {
    const held = HELD_WEAPONS[d.secondaryType] ?? HELD_WEAPONS.long, arm = d.arms[0];
    reach.fromArray(held.right).multiplyScalar(held.scale).add(d.secondaryGun.position).sub(arm.position);
    arm.scale.y = reach.length() / ARM_LENGTH; arm.quaternion.setFromUnitVectors(DOWN, reach.normalize());
  }
  // A styled survivor's hands keep their true size on the stretched arms.
  if(d.hands)d.hands.forEach((hand,index)=>{hand.scale.y=1/d.arms[index].scale.y;});
}
export function fireSurvivor(group,time=0,hand='primary') {
  if (hand === 'secondary') { const d = group.userData; if (d.secondaryGun) { d.secondaryFlashUntil = d.secondaryType === 'flamethrower' ? -Infinity : time + .065; d.secondaryGun.userData.shotAt = time; } return; }
  const d=group.userData;if(!d.flash||!d.gun)return;
  if(d.gun.userData.melee){d.flashUntil=-Infinity;return;}
  if(d.weaponType==='flamethrower'){d.flashUntil=-Infinity;d.recoil=.08;return;}
  d.flashUntil=time+.065;d.recoil=1;
  d.gun.userData.shotAt = time;
  d.flash.rotation.z=Math.random()*Math.PI;d.flash.scale.setScalar(.85+Math.random()*.45);
}
export function setSurvivorSecondaryWeapon(group, type = null) {
  const d = group?.userData; if (!d?.holder || d.secondaryType === type) return;
  if (d.secondaryGun) { d.holder.remove(d.secondaryGun); d.secondaryGun.traverse(node => { if (node.geometry && !node.geometry.userData.frissonShared) node.geometry.dispose(); }); d.secondaryGun.userData.heatMaterial?.dispose?.(); }
  d.secondaryType = type; d.secondaryGun = type ? createHeldWeapon(type) : null; d.secondaryFlash = null; d.secondaryFlashUntil = -Infinity;
  if (d.secondaryGun) {
    const held = HELD_WEAPONS[type] ?? HELD_WEAPONS.long;
    d.secondaryGun.scale.setScalar(held.scale); d.secondaryGun.position.fromArray(held.position); d.secondaryGun.position.x = -.27;
    weaponStyle?.dress(d.secondaryGun, { type, view: 'held' });
    d.secondaryFlash = createMuzzleFlash(); d.secondaryFlash.visible = false; d.secondaryGun.add(d.secondaryFlash); d.secondaryFlash.position.copy(d.secondaryGun.userData.muzzle);
    d.holder.add(d.secondaryGun);
  }
  if (d.gun) fitSurvivorGrips(d, HELD_WEAPONS[d.weaponType] ?? HELD_WEAPONS.long);
}
export function survivorMuzzle(group,target=new THREE.Vector3(),hand='primary') {
  const gun=hand==='secondary'?group.userData.secondaryGun:group.userData.gun;if(!gun||gun.userData.melee)return null;
  group.updateMatrixWorld(true);
  return gun.localToWorld(target.copy(gun.userData.muzzle));
}
// Walk cycle from the actual displacement, aim pitch, recoil, reload and a
// downed pose on the back. The root stays on the server-smoothed position.
export function animateSurvivor(group,{secondary=null,pitch=0,crouched=false,downed=false,backpack=false,reloading=false,spinning=false,spinLeft=0,spinDuration,meleeAttack=null,meleeElapsed=Infinity,meleeWindup,meleeDuration,time=0,delta=1/60}={}) {
  const d=group.userData;if(!d.aim)return;
  if(d.backpack)d.backpack.visible=backpack===true;
  const armed=Boolean(d.gun);
  const step=Math.max(0,Math.min(.1,Number.isFinite(delta)?delta:0)),blend=rate=>1-Math.exp(-step*rate);
  const moved=d.last?Math.hypot(group.position.x-d.last.x,group.position.z-d.last.z):0;
  d.last=(d.last??new THREE.Vector3()).copy(group.position);
  // A big catch-up in one frame (tab back in focus, respawn) is a slide, not a stride.
  const walked=moved>.5?0:moved;
  d.speed+=((step>0?Math.min(7,walked/step):0)-d.speed)*blend(10);
  const walk=Math.min(1,d.speed/3.2);
  d.gait+=walked*3.4;
  d.crouch+=((crouched&&!downed?(d.crouchDepth??1):0)-d.crouch)*blend(10);
  const crouch=d.crouch*(1-d.pose),swing=Math.sin(d.gait)*.62*walk*(1-crouch*.65);
  d.legs[0].rotation.x=swing+1.05*crouch;d.legs[1].rotation.x=-swing+1.05*crouch;
  for(let index=0;index<2;index++){d.legs[index].position.y=.9-.43*crouch;d.knees[index].rotation.x=-2.1*crouch;d.boots[index].rotation.x=-(d.legs[index].rotation.x+d.knees[index].rotation.x);}
  d.torso.position.y=1.17-.53*crouch;d.vest.position.y=1.2-.53*crouch;d.belt.position.y=.9-.43*crouch;
  d.torso.scale.y=d.vest.scale.y=1-.26*crouch;
  if(d.backpack){d.backpack.position.y=1.18-.53*crouch;d.backpack.scale.y=1-.26*crouch;}
  d.head.position.y=1.67-.86*crouch;d.head.position.z=-.08*crouch;
  d.aim.position.y=1.42-.57*crouch;
  d.pose+=((downed?1:0)-d.pose)*blend(7);
  d.reload+=((armed&&reloading?1:0)-d.reload)*blend(10);
  d.recoil=armed?d.recoil*Math.exp(-step*14):0;
  d.body.rotation.x=d.pose*Math.PI/2*.94;
  // A downed survivor rests on the pack instead of clipping it into the floor.
  d.body.position.y=d.pose*(.16+(d.backpack?.visible ? .2 : 0))+Math.abs(Math.sin(d.gait))*.035*walk*(1-d.pose);
  const aim=THREE.MathUtils.clamp(Number.isFinite(pitch)?pitch:0,-1.1,1.1);
  // On the back, the weapon rests along the body instead of pointing at the ceiling.
  d.aim.rotation.x=armed?aim*(1-d.pose)-1.35*d.pose-.55*d.reload+d.recoil*.16:0;
  d.aim.rotation.z=armed?.35*d.reload:0;
  if(d.gun?.userData.melee){
    animateMeleeWeapon(d.gun,{attack:meleeAttack,elapsed:downed?Infinity:meleeElapsed,windup:meleeWindup,duration:meleeDuration,survivorAim:d.aim.rotation.x,survivorRoll:d.aim.rotation.z});
    const swing=d.gun.userData.meleePose;
    if(swing){d.aim.rotation.x+=swing.armX;d.aim.rotation.z+=swing.armZ;}
    fitSurvivorGrips(d,HELD_WEAPONS[d.weaponType]??HELD_WEAPONS.katana);
  }
  d.holder.position.z=d.recoil*.07;
  d.head.rotation.x=aim*.45*(1-d.pose);
  d.flash.visible=armed&&!d.gun.userData.melee&&time<d.flashUntil;
  if(d.gun?.userData.rotor)d.gun.userData.rotor.rotation.z-=step*minigunRotorSpeed({spinning,spinLeft,duration:spinDuration,reloading,downed});
  if (d.gun) animateWeaponMechanism(d.gun, { time, reloading: reloading || downed });
  if (d.secondaryGun) { fitSurvivorGrips(d, HELD_WEAPONS[d.weaponType] ?? HELD_WEAPONS.long); d.secondaryGun.visible = !downed; animateWeaponMechanism(d.secondaryGun, { time, reloading: secondary?.reloading || downed }); if (d.secondaryGun.userData.rotor) d.secondaryGun.userData.rotor.rotation.z -= step * minigunRotorSpeed({ spinning: secondary?.minigunSpinning, spinLeft: secondary?.minigunSpinLeft, duration: spinDuration, reloading: secondary?.reloading, downed }); if (d.secondaryFlash) d.secondaryFlash.visible = !downed && time < (d.secondaryFlashUntil ?? -Infinity); }
}
// The survivor pose, plus burn flames and a butt-stroke on planks (no flash).
// Like animateSurvivor, it never moves or turns the root.
export function animateRaider(group,state={}) {
  animateSurvivor(group,state);
  const d=group.userData;if(!d.aim)return;
  const time=Number.isFinite(state.time)?state.time:0,bash=Number.isFinite(d.bashAt)?(time-d.bashAt)/.32:-1;
  if(d.gun&&bash>=0&&bash<1){const thrust=Math.sin(Math.PI*bash);d.aim.rotation.x-=.45*thrust;d.holder.position.z-=.2*thrust;}
  animateZombieBurn(group,time);
}

export function animateWeaponMechanism(gun, { time = 0, shotElapsed, reloading = false } = {}) {
  const bolt = gun?.userData.bolt; if (!bolt) return;
  const elapsed = Number.isFinite(shotElapsed) ? shotElapsed : time - (gun.userData.shotAt ?? -Infinity);
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  const active = !reloading && Number.isFinite(elapsed) && elapsed >= .16 && elapsed < 1.25;
  const open = active ? smooth((elapsed - .16) / .14) - smooth((elapsed - .82) / .16) : 0;
  const pull = active ? smooth((elapsed - .32) / .2) - smooth((elapsed - .67) / .18) : 0;
  bolt.rotation.z = open > 0 ? open * -.9 : 0; bolt.position.z = .018 + pull * .11;
}

// A hot minigun's barrels glow from dull red to orange. The first call gives
// this gun its own barrel material, so no other minigun ever shares the glow.
const HEAT_GLOW = new THREE.Color();
export function setWeaponHeat(gun, level = 0) {
  const rotor = gun?.userData?.rotor;
  if (!rotor || gun.userData.type !== 'minigun') return false;
  let hot = gun.userData.heatMaterial;
  if (!hot) {
    if (!(level > .35)) return false; // Cold: keep sharing the ordinary material.
    const barrels = []; rotor.traverse(node => { if (node.isMesh && /^minigunBarrel/.test(node.name)) barrels.push(node); });
    if (!barrels.length || !barrels[0].material?.emissive) return false;
    hot = barrels[0].material.clone(); hot.name = 'minigunHotBarrels';
    // Material.copy drops onBeforeCompile/customProgramCacheKey; copy them
    // when they are own properties of the source (a Frisson weapon material),
    // so a hot minigun keeps the already-compiled zombieRim program. Famille
    // materials have no such own properties: nothing changes for them.
    for (const key of ['onBeforeCompile', 'customProgramCacheKey'])
      if (Object.prototype.hasOwnProperty.call(barrels[0].material, key)) hot[key] = barrels[0].material[key];
    for (const barrel of barrels) barrel.material = hot;
    gun.userData.heatMaterial = hot;
  }
  const glow = THREE.MathUtils.clamp((Number.isFinite(level) ? level : 0) - .35, 0, .65) / .65;
  hot.emissive.copy(HEAT_GLOW.setHSL(.035 * glow, 1, .42 + .1 * glow));
  hot.emissiveIntensity = glow * glow * 2.4;
  return true;
}

// Tracers are visible streaks that travel from the muzzle to where the
// server says the pellet stopped, with a short fading trail behind them.
// Hostile (raider) fire keeps the same shape in a reddish colour.
// A visible bullet (or pellet, or rocket) from the muzzle to the server's
// stop point, drawn by the shared particle engine. The returned handle keeps
// the old tracer API: an empty node to add, update() while it flies.
// Previews without a world still see effects: a handle hosts the shared
// particle root when no scene holds it, and drives it while no world does.
function hostEffects(group) {
  const effects = sharedEffects();
  let node = effects.root; while (node.parent) node = node.parent;
  if (!node.isScene) group.add(effects.root);
  return effects;
}
function driveEffects(effects, now) { if (!effects.driven && Number.isFinite(now)) effects.update(now); }
// `lead` starts a late-drawn bullet part-way along its path (online, from
// the click), but never past 45 % of its flight, so its head is always seen.
export function createTracer(start,end,{local=false,time=0,rocket=false,hostile=false,weapon=rocket?'rocket':'pistol',lead=0}={}) {
  const group=new THREE.Group();group.name=rocket?'rocketTrail':'tracer';
  const flight=Math.max(.035,start.distanceTo(end)/BULLET_SPEED),startedAt=time-Math.min(Number.isFinite(lead)?Math.max(0,lead):0,.45*flight);
  const travel=launchProjectile(start,end,{weapon:rocket?'rocket':weapon,local,hostile,time:startedAt}),effects=hostEffects(group);
  return {
    mesh:group,start,end,travel,weapon,startedAt,
    update(now) { driveEffects(effects,now); return Number.isFinite(now)&&now-startedAt<travel+.07; },
    dispose() {},
  };
}

// A raider turns its back along the shot over .15 s, falls into the downed
// pose, sinks after 2.1 s and is removed at 3 s, like a zombie corpse.
export function startRaiderDeath(group,{time=0,directionX=0,directionZ=0}={}) {
  const d=group.userData,length=Math.hypot(directionX,directionZ);d.flashUntil=-Infinity;
  d.death={start:time,last:time,fromYaw:group.rotation.y,toYaw:length>1e-6?Math.atan2(directionX,directionZ):group.rotation.y,baseY:group.position.y};
}
export function animateRaiderDeath(group,time) {
  const d=group.userData,death=d.death;if(!death||!d.aim)return false;
  const age=Math.max(0,time-death.start),step=Math.max(0,Math.min(.1,time-death.last));death.last=Math.max(death.last,time);
  const turn=Math.atan2(Math.sin(death.toYaw-death.fromYaw),Math.cos(death.toYaw-death.fromYaw))*THREE.MathUtils.clamp(age/.15,0,1);
  group.rotation.y=death.fromYaw+turn;
  animateSurvivor(group,{downed:true,pitch:0,time,delta:step});
  group.position.y=death.baseY-.55*THREE.MathUtils.clamp((age-2.1)/.9,0,1);
  return age<3;
}
// Bigger, more readable melee swings (owner request, 12 October): the weapon
// winds up further, follows through further, and the hands travel across the
// view through the strike. Only amplitudes change: the fast part of each arc
// still meets the server's impact time. `pose.sweep` is 1 in first person
// and 0 on a teammate's model, which keeps its original, head-clear swing.
const SWING_GAIN = Object.freeze({
  light: Object.freeze({ windup: 1.45, strike: 1.15, windX: .1, sweepX: .3, liftY: .05, dropY: .05, reach: .07, arm: 1 }),
  heavy: Object.freeze({ windup: 1.25, strike: 1.12, windX: .03, sweepX: .1, liftY: .12, dropY: .16, reach: .1, arm: 1 }),
});
function sweepSwing(pose, attack, preparation, strike, amount) {
  const gain = SWING_GAIN[attack === 'heavy' ? 'heavy' : 'light'], sweep = Number.isFinite(pose.sweep) ? pose.sweep : 1;
  pose.position.x += sweep * amount * (preparation * gain.windX - strike * gain.sweepX);
  pose.position.y += sweep * amount * (preparation * gain.liftY - strike * gain.dropY);
  pose.position.z -= sweep * amount * strike * gain.reach;
  pose.armX *= gain.arm; pose.armZ *= gain.arm;
  return pose;
}
// The blade reaches the middle of its fast sweep at the authoritative impact
// time. Preparation and recovery remain visibly different for the heavy cut.
function katanaMotion(attack,elapsed,windup,duration,pose) {
  const active=(attack==='light'||attack==='heavy')&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<duration;
  const smooth=value=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
  const preparation=active?smooth(elapsed/(windup*.75)):0;
  const strike=active?smooth((elapsed-windup+.05)/.1):0;
  const recovery=active?smooth((elapsed-windup-.1)/Math.max(.1,duration-windup-.1)):1;
  const amount=1-recovery,heavy=attack==='heavy';
  const gain = SWING_GAIN[attack === 'heavy' ? 'heavy' : 'light'], amplify = Number.isFinite(pose.sweep) ? pose.sweep : 1, gainW = 1 + (gain.windup - 1) * amplify, gainS = 1 + (gain.strike - 1) * amplify;
  pose.rotation.set(.55+preparation*gainW*amount*(heavy?1.1:.25)-strike*gainS*amount*(heavy?1.75:.5),amount*(-preparation*gainW*(heavy?.12:.65)+strike*gainS*(heavy?.25:1.5)),-.15+amount*(preparation*gainW*(heavy?.12:.7)-strike*gainS*(heavy?.25:1.4)));
  pose.position.set(amount*(strike*gainS*.12-preparation*gainW*.03),amount*(preparation*gainW*(heavy?.08:.02)-strike*gainS*.08),-amount*strike*gainS*.15);
  pose.armX=amount*(preparation*gainW*(heavy?.7:.12)-strike*gainS*(heavy?1.05:.24));
  pose.armZ=heavy?amount*(preparation*gainW*.08-strike*gainS*.16):amount*(-preparation*gainW*.38+strike*gainS*.8);
  sweepSwing(pose, attack, preparation, strike, amount);
  pose.rollWeight=active?amount*smooth(elapsed/(windup*.5)):0;
  return pose;
}
function meleeMotionScratch(){return{rotation:new THREE.Euler(),position:new THREE.Vector3(),armX:0,armZ:0,rollWeight:0};}
function hammerMotion(attack, elapsed, windup, duration, pose) {
  const active = (attack === 'light' || attack === 'heavy') && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < duration;
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  const heavy = attack === 'heavy', preparation = active ? smooth(elapsed / (windup * .8)) : 0;
  const strike = active ? smooth((elapsed - windup + .07) / .14) : 0;
  const recovery = active ? smooth((elapsed - windup - .12) / Math.max(.15, duration - windup - .12)) : 1;
  const amount = 1 - recovery;
  const gain = SWING_GAIN[attack === 'heavy' ? 'heavy' : 'light'], amplify = Number.isFinite(pose.sweep) ? pose.sweep : 1, gainW = 1 + (gain.windup - 1) * amplify, gainS = 1 + (gain.strike - 1) * amplify;
  pose.rotation.set(.55 + amount * (preparation * gainW * (heavy ? 1.15 : .25) - strike * gainS * (heavy ? 1.8 : .55)),
    amount * (preparation * gainW * (heavy ? -.1 : -.72) + strike * gainS * (heavy ? .17 : 1.55)),
    -.15 + amount * (preparation * gainW * (heavy ? .08 : .55) - strike * gainS * (heavy ? .18 : 1.25)));
  pose.position.set(amount * (strike * gainS * .08 - preparation * gainW * .04), amount * (preparation * gainW * .12 - strike * gainS * .13), -amount * strike * gainS * .12);
  pose.armX = amount * (preparation * gainW * (heavy ? .75 : .12) - strike * gainS * (heavy ? 1.1 : .25));
  pose.armZ = amount * (preparation * gainW * (heavy ? .08 : -.4) - strike * gainS * (heavy ? .15 : -.85));
  sweepSwing(pose, attack, preparation, strike, amount);
  pose.rollWeight = active ? amount * smooth(elapsed / (windup * .5)) : 0;
  return pose;
}
function batMotion(attack, elapsed, windup, duration, pose) {
  const active = (attack === 'light' || attack === 'heavy') && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < duration;
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  const heavy = attack === 'heavy', preparation = active ? smooth(elapsed / (windup * .75)) : 0;
  // A short lateral strike or a deliberate two-handed overhead strike. Both
  // reach the middle of the fast contact arc at the server's impact time.
  const strikeWindow = heavy ? .12 : .08, recoveryStart = heavy ? .09 : .055;
  const strike = active ? smooth((elapsed - windup + strikeWindow / 2) / strikeWindow) : 0;
  const recovery = active ? smooth((elapsed - windup - recoveryStart) / Math.max(.1, duration - windup - recoveryStart)) : 1;
  const amount = 1 - recovery;
  const gain = SWING_GAIN[attack === 'heavy' ? 'heavy' : 'light'], amplify = Number.isFinite(pose.sweep) ? pose.sweep : 1, gainW = 1 + (gain.windup - 1) * amplify, gainS = 1 + (gain.strike - 1) * amplify;
  pose.rotation.set(.55 + amount * (preparation * gainW * (heavy ? .9 : .14) - strike * gainS * (heavy ? 1.45 : .3)),
    amount * (preparation * gainW * (heavy ? -.16 : -.52) + strike * gainS * (heavy ? .3 : 1.2)),
    -.15 + amount * (preparation * gainW * (heavy ? .18 : .42) - strike * gainS * (heavy ? .32 : .95)));
  pose.position.set(amount * (strike * gainS * .075 - preparation * gainW * .025), amount * (preparation * gainW * (heavy ? .08 : .015) - strike * gainS * .07), -amount * strike * gainS * .1);
  pose.armX = amount * (preparation * gainW * (heavy ? .55 : .08) - strike * gainS * (heavy ? .85 : .18));
  pose.armZ = amount * (preparation * gainW * (heavy ? .1 : -.25) - strike * gainS * (heavy ? .2 : -.55));
  sweepSwing(pose, attack, preparation, strike, amount);
  pose.rollWeight = active ? amount * smooth(elapsed / (windup * .5)) : 0;
  return pose;
}
function fireaxeMotion(attack, elapsed, windup, duration, pose) {
  const active = (attack === 'light' || attack === 'heavy') && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < duration;
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
  const heavy = attack === 'heavy', preparation = active ? smooth(elapsed / (windup * .8)) : 0;
  const strikeWindow = heavy ? .16 : .1;
  const strike = active ? smooth((elapsed - windup + strikeWindow / 2) / strikeWindow) : 0;
  const recoveryStart = heavy ? .13 : .075;
  const recovery = active ? smooth((elapsed - windup - recoveryStart) / Math.max(.1, duration - windup - recoveryStart)) : 1;
  const amount = 1 - recovery;
  const gain = SWING_GAIN[attack === 'heavy' ? 'heavy' : 'light'], amplify = Number.isFinite(pose.sweep) ? pose.sweep : 1, gainW = 1 + (gain.windup - 1) * amplify, gainS = 1 + (gain.strike - 1) * amplify;
  // The light swing crosses a broad horizontal arc. The two-handed heavy
  // swing starts higher and cuts diagonally through the same impact point.
  pose.rotation.set(.55 + amount * (preparation * gainW * (heavy ? 1 : .18) - strike * gainS * (heavy ? 1.75 : .37)),
    amount * (preparation * gainW * (heavy ? -.48 : -.9) + strike * gainS * (heavy ? .95 : 1.9)),
    -.15 + amount * (preparation * gainW * (heavy ? .38 : .42) - strike * gainS * (heavy ? .85 : .9)));
  pose.position.set(amount * (strike * gainS * .12 - preparation * gainW * .06), amount * (preparation * gainW * (heavy ? .11 : .015) - strike * gainS * .1), -amount * strike * gainS * .13);
  pose.armX = amount * (preparation * gainW * (heavy ? .65 : .1) - strike * gainS * (heavy ? 1 : .2));
  pose.armZ = amount * (preparation * gainW * (heavy ? .26 : -.38) - strike * gainS * (heavy ? .58 : -.8));
  sweepSwing(pose, attack, preparation, strike, amount);
  pose.rollWeight = active ? amount * smooth(elapsed / (windup * .5)) : 0;
  return pose;
}
export function animateMeleeWeapon(gun,{attack='light',elapsed=Infinity,windup,duration,survivorAim=null,survivorRoll=0}={}) {
  const pivot=gun?.userData.meleePivot;if(!pivot)return;
  const attacks = MELEE_WEAPONS[gun.userData.type] ?? MELEE;
  const profile=attacks[attack]??attacks.light, motion = gun.userData.type === 'hammer' ? hammerMotion : gun.userData.type === 'bat' ? batMotion : gun.userData.type === 'fireaxe' ? fireaxeMotion : katanaMotion;
  windup=Number.isFinite(windup)&&windup>0?windup:profile.windup;
  duration=Number.isFinite(duration)&&duration>windup?duration:profile.duration;
  const d=gun.userData,s=d.meleeScratch??(d.meleeScratch={current:meleeMotionScratch(),before:meleeMotionScratch(),after:meleeMotionScratch(),sample:meleeMotionScratch(),a:new THREE.Vector3(),b:new THREE.Vector3(),velocity:new THREE.Vector3(),parent:new THREE.Euler(),rotation:new THREE.Quaternion(),parentRotation:new THREE.Quaternion()});
  const follow=Number.isFinite(survivorAim),sweep=follow?0:1;
  s.current.sweep=s.before.sweep=s.after.sweep=s.sample.sweep=sweep;
  const pose=motion(attack,elapsed,windup,duration,s.current);
  pivot.rotation.copy(pose.rotation);pivot.position.copy(pose.position);
  const scale=follow?gun.scale.x:1;
  const transform=(sample,target)=>{
    target.set(0,0,-.7).applyEuler(sample.rotation).add(sample.position).multiplyScalar(scale);
    if(follow){target.add(gun.position);s.parent.set(survivorAim+sample.armX,0,survivorRoll+sample.armZ);target.applyEuler(s.parent);}
    return target;
  };
  let roll=0;
  if(pose.rollWeight>0){
    // Derive from the unrolled trajectory: translating the grip and rotating
    // an avatar's shoulders both affect contact velocity. The roll must never
    // feed back into this reference motion.
    const contactTime=Math.max(windup-.025,Math.min(windup+.025,elapsed)),epsilon=.0001;
    const before=motion(attack,contactTime-epsilon,windup,duration,s.before),after=motion(attack,contactTime+epsilon,windup,duration,s.after);
    s.velocity.copy(transform(after,s.b)).sub(transform(before,s.a));
    const sample=motion(attack,contactTime,windup,duration,s.sample);
    s.rotation.setFromEuler(sample.rotation);
    if(follow){s.parent.set(survivorAim+sample.armX,0,survivorRoll+sample.armZ);s.parentRotation.setFromEuler(s.parent);s.rotation.premultiply(s.parentRotation);}
    s.velocity.applyQuaternion(s.rotation.invert());
    // The katana edge, axe blade and hammer's striking spikes point to local
    // -X. Their contact face follows the sweep, including teammate aim pitch.
    if(s.velocity.x*s.velocity.x+s.velocity.y*s.velocity.y>1e-16)roll=Math.atan2(-s.velocity.y,-s.velocity.x)*pose.rollWeight;
  }
  if(d.bladeFrame)d.bladeFrame.rotation.z=roll;
  const result=d.meleePose??(d.meleePose={armX:0,armZ:0});
  result.armX=pose.armX;result.armZ=pose.armZ;result.edgeRoll=roll;
}
// An optional weapon style (the Frisson pack's weapons module) dresses every
// weapon built from now on; null is the Famille build, exactly.
// One style at a time. Switching styles drops the cached ground templates, so
// the next pickup is built in the new style; shared Frisson geometries
// (geometry.userData.frissonShared) belong to the style and are never
// disposed here.
let weaponStyle = null;
export function setWeaponStyle(style = null) {
  weaponStyle = style ?? null;
  for (const template of groundWeaponTemplates.values()) {
    template.traverse(node => {
      if (!node.isMesh) return;
      if (!node.geometry.userData.frissonShared) node.geometry.dispose();
      if (node.material?.isMeshBasicMaterial) node.material.dispose(); // the pickup halo's two materials
    });
  }
  groundWeaponTemplates.clear();
}
export function getWeaponStyle() { return weaponStyle; }

export function createWeapon(type = 'pistol') {
  const gun = buildWeapon(type);
  weaponStyle?.dress(gun, { type, view: 'firstPerson' });
  return gun;
}

export function buildWeapon(type='pistol') {
  const gun=new THREE.Group();gun.position.set(.32,-.28,-.48);gun.rotation.y=-.018;
  if (type === 'fireaxe') {
    const pivot = new THREE.Group(), frame = new THREE.Group(); pivot.name = 'fireaxeSwing'; frame.name = 'fireaxeEdgeFrame';
    gun.add(pivot); pivot.add(frame);
    const wood = material('fireaxeHickory', 0xb2834e, .88), grain = material('fireaxeWoodGrain', 0x79542e, .95);
    const red = material('fireaxeRedEnamel', 0xa92118, .5, { metalness: .45 });
    const steel = material('fireaxePolishedEdge', 0xc9d5cf, .25, { metalness: .9 });
    const grip = material('fireaxeGrip', 0x292d29, .96);
    const shaft = cylinder(frame, 0, 0, -.2, .024, .032, 1.18, wood, 12); shaft.rotation.x = Math.PI / 2; shaft.name = 'fireaxeWoodHandle';
    const handleGrip = cylinder(frame, 0, 0, .22, .033, .034, .33, grip, 12); handleGrip.rotation.x = Math.PI / 2;
    for (const z of [.07, .13, .19, .25, .31, .37]) {
      const wrap = cylinder(frame, 0, 0, z, .035, .035, .009, grain, 12); wrap.rotation.x = Math.PI / 2;
    }
    // Extruded silhouettes lie in the handle/head plane; the silver bevel is
    // a separate solid face along the broad cutting edge, opposite the pick.
    const headPart = (name, points, surface, depth) => {
      const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 3, steps: 1 });
      const part = new THREE.Mesh(geometry, surface); part.name = name; part.rotation.x = Math.PI / 2; part.position.y = depth / 2; frame.add(part); return part;
    };
    headPart('fireaxeRedHead', [[-.055,-.91],[-.23,-.95],[-.295,-.91],[-.285,-.675],[-.205,-.66],[-.055,-.735],[.085,-.735],[.105,-.85]], red, .07);
    const edge = headPart('fireaxeCuttingEdge', [[-.295,-.91],[-.335,-.915],[-.325,-.667],[-.285,-.675]], steel, .045);
    edge.userData.strikingSide = 'negative-X';
    const eye = box(frame, .015, 0, -.8, .095, .105, .17, red); eye.name = 'fireaxeHandleSocket';
    const pick = cylinder(frame, .2, 0, -.805, 0, .057, .25, red, 6); pick.rotation.z = -Math.PI / 2; pick.name = 'fireaxeRearPick';
    const pickTip = cylinder(frame, .303, 0, -.805, 0, .018, .055, steel, 6); pickTip.rotation.z = -Math.PI / 2;
    const cap = cylinder(frame, 0, 0, .4, .036, .036, .025, red, 12); cap.rotation.x = Math.PI / 2;
    for (const x of [-.017, .017]) box(frame, x, -.024, -.285, .003, .003, .63, grain);
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(frame, .026, -.025, .1, .095, .1, .12, hand); box(frame, -.026, -.025, .29, .095, .1, .11, hand);
    box(frame, .1, -.11, .35, .13, .13, .27, sleeve).rotation.z = .18;
    gun.userData = { type, melee: true, meleePivot: pivot, bladeFrame: frame, muzzle: new THREE.Vector3(-.33, 0, -.79), trailTip: new THREE.Vector3(-.3, 0, -.8), swingWindows: { light: [-.05, .075], heavy: [-.08, .13] } };
    animateMeleeWeapon(gun); gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if (type === 'bat') {
    const pivot = new THREE.Group(), frame = new THREE.Group(); pivot.name = 'batSwing'; frame.name = 'batStrikeFrame';
    gun.add(pivot); pivot.add(frame);
    const wood = material('batAshWood', 0xb48a55, .86), grain = material('batWoodGrain', 0x7a5635, .95);
    const grip = material('batGripTape', 0x34392f, .98), stamp = material('batMakerStamp', 0x583c27, .95);
    // Lathed ash wood has a rounded barrel, a continuously tapered neck and
    // a narrow handle. The capped knob prevents the hands sliding off.
    const profile = [[0,-.74],[.032,-.735],[.05,-.71],[.056,-.67],[.057,-.56],[.055,-.43],[.049,-.3],[.038,-.14],[.028,.02],[.024,.14],[.025,.315],[0,.33]];
    const geometry = new THREE.LatheGeometry(profile.map(([radius, z]) => new THREE.Vector2(radius, z)), 16);
    geometry.computeBoundingBox(); const centre = geometry.boundingBox.getCenter(new THREE.Vector3()); geometry.translate(-centre.x, -centre.y, -centre.z);
    const barrel = new THREE.Mesh(geometry, wood);
    barrel.name = 'batWoodBarrel'; barrel.rotation.x = Math.PI / 2; barrel.position.copy(centre).applyEuler(barrel.rotation); barrel.userData.strikingSide = 'round-barrel'; frame.add(barrel);
    const knob = cylinder(frame, 0, 0, .337, .041, .041, .026, wood, 16); knob.rotation.x = Math.PI / 2; knob.name = 'batHandleKnob';
    const tape = cylinder(frame, 0, 0, .17, .027, .029, .285, grip, 12); tape.rotation.x = Math.PI / 2; tape.name = 'batHandleTape';
    for (const z of [.04, .085, .13, .175, .22, .265, .31]) {
      const band = cylinder(frame, 0, 0, z, .0295, .0295, .009, grain, 12); band.rotation.x = Math.PI / 2;
    }
    for (const angle of [-.8, .15, 1.35, 2.4]) {
      const line = box(frame, Math.cos(angle) * .055, Math.sin(angle) * .055, -.535, .003, .002, .23, grain);
      line.rotation.z = angle; line.name = 'batWoodGrain';
    }
    for (const z of [-.39, -.365, -.34]) box(frame, -.047, .005, z, .003, .035, .012, stamp);
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(frame, .025, -.025, .1, .095, .1, .11, hand); box(frame, -.025, -.025, .255, .095, .1, .11, hand);
    box(frame, .1, -.11, .32, .13, .13, .26, sleeve).rotation.z = .18;
    gun.userData = { type, melee: true, meleePivot: pivot, bladeFrame: frame, muzzle: new THREE.Vector3(-.057, 0, -.56), trailTip: new THREE.Vector3(0, 0, -.66), swingWindows: { light: [-.04, .055], heavy: [-.06, .09] } };
    animateMeleeWeapon(gun); gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if (type === 'hammer') {
    const pivot = new THREE.Group(), frame = new THREE.Group(); pivot.name = 'hammerSwing'; frame.name = 'hammerStrikeFrame';
    gun.add(pivot); pivot.add(frame);
    const iron = material('hammerForgedIron', 0x5d6667, .58, { metalness: .78 });
    const edge = material('hammerSpikes', 0xb3beb5, .36, { metalness: .85 });
    const wood = material('hammerShaft', 0x695138, .92), leather = material('hammerGrip', 0x302b25, .96);
    const shaft = cylinder(frame, 0, 0, -.22, .024, .029, 1.17, wood, 10); shaft.rotation.x = Math.PI / 2;
    const grip = cylinder(frame, 0, 0, .18, .032, .033, .36, leather, 10); grip.rotation.x = Math.PI / 2;
    for (const z of [.025, .09, .155, .22, .285, .35]) {
      const wrap = cylinder(frame, 0, 0, z, .034, .034, .014, iron, 10); wrap.rotation.x = Math.PI / 2;
    }
    // A flanged mace: an iron ball bristling with pyramid spikes (owner
    // request, 12 October), on the same shaft and grip. Every direction is a
    // striking side, and the ball keeps the old head's centre and thickness so
    // racks, the ground envelope and the swing stay as they were.
    const head = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), iron); head.name = 'hammerHead'; head.position.set(0, 0, -.79); frame.add(head);
    const collar = cylinder(frame, 0, 0, -.69, .034, .045, .05, iron, 10); collar.rotation.x = Math.PI / 2; collar.name = 'maceCollar';
    const spikeGroup = new THREE.Group(); spikeGroup.name = 'hammerStrikingSpikes'; spikeGroup.userData.strikingSide = 'negative-X'; frame.add(spikeGroup);
    const spikeGeometry = new THREE.ConeGeometry(.024, .07, 4).translate(0, .035, 0), up = new THREE.Vector3(0, 1, 0), outward = new THREE.Vector3();
    // Spikes spread evenly over the ball (a Fibonacci sphere), none towards the shaft.
    for (let index = 0, count = 22; index < count; index++) {
      const z = 1 - 2 * (index + .5) / count, ring = Math.sqrt(1 - z * z), angle = index * Math.PI * (3 - Math.sqrt(5));
      outward.set(Math.cos(angle) * ring, Math.sin(angle) * ring, -z);
      if (outward.z > .62) continue;
      const spike = new THREE.Mesh(spikeGeometry, edge); spike.name = 'maceSpike';
      spike.position.set(0, 0, -.79).addScaledVector(outward, .082); spike.quaternion.setFromUnitVectors(up, outward); spikeGroup.add(spike);
    }
    const pommel = cylinder(frame, 0, 0, .385, .038, .038, .035, iron, 10); pommel.rotation.x = Math.PI / 2;
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(frame, .026, -.025, .12, .095, .1, .12, hand); box(frame, -.026, -.025, .3, .095, .1, .11, hand);
    box(frame, .1, -.11, .36, .13, .13, .27, sleeve).rotation.z = .18;
    gun.userData = { type, melee: true, meleePivot: pivot, bladeFrame: frame, muzzle: new THREE.Vector3(-.16, 0, -.79), trailTip: new THREE.Vector3(0, 0, -.79), swingWindows: { light: [-.07, .12], heavy: [-.07, .12] } };
    animateMeleeWeapon(gun); gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if (type === 'sniper') {
    const stock = material('sniperStock', 0x635443, .9), steel = material('sniperSteel', 0x7e8e8b, .36, { metalness: .8 });
    const dark = material('sniperAction', 0x263436, .52, { metalness: .65 }), black = material('sniperBore', 0x081215, .95);
    box(gun, 0, -.025, .29, .1, .145, .42, stock);
    box(gun, 0, -.022, -.16, .105, .14, .49, stock);
    box(gun, 0, -.13, .09, .085, .19, .105, stock).rotation.x = -.23;
    const receiver = cylinder(gun, 0, .055, -.13, .048, .048, .4, dark, 12); receiver.rotation.x = Math.PI / 2;
    const barrel = cylinder(gun, 0, .055, -.72, .018, .025, .79, steel, 12); barrel.rotation.x = Math.PI / 2;
    const crown = cylinder(gun, 0, .055, -1.128, .027, .027, .035, dark, 12); crown.rotation.x = Math.PI / 2;
    const bore = cylinder(gun, 0, .055, -1.148, .013, .013, .008, black, 10); bore.rotation.x = Math.PI / 2;
    box(gun, 0, -.128, -.12, .073, .11, .13, dark);
    const scope = new THREE.Group(); scope.name = 'sniperScope'; gun.add(scope);
    const tube = cylinder(scope, 0, .2, -.22, .043, .043, .42, dark, 14); tube.rotation.x = Math.PI / 2;
    for (const [z, radius, depth] of [[-.465, .065, .12], [.015, .054, .075]]) {
      const bell = cylinder(scope, 0, .2, z, radius, radius * .83, depth, dark, 14); bell.rotation.x = Math.PI / 2;
      const glass = cylinder(scope, 0, .2, z + (z < 0 ? -depth / 2 - .002 : depth / 2 + .002), radius * .8, radius * .8, .004, material('sniperOpticGlass', 0x4d9a99, .16, { metalness: .7 }), 14); glass.rotation.x = Math.PI / 2;
    }
    for (const z of [-.31, -.03]) { box(scope, 0, .115, z, .035, .09, .05, steel); box(scope, 0, .2, z, .11, .025, .035, steel); }
    cylinder(scope, 0, .27, -.18, .033, .033, .07, steel, 10);
    const bolt = new THREE.Group(); bolt.name = 'sniperBolt'; bolt.position.set(.045, .057, .018); gun.add(bolt);
    const lever = cylinder(bolt, .051, -.022, 0, .011, .011, .1, steel, 8); lever.rotation.z = -.9;
    sphere(bolt, .09, -.056, 0, .027, dark);
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(gun, .05, -.15, .14, .11, .13, .13, hand); box(gun, -.05, -.09, -.34, .11, .1, .16, hand);
    box(gun, .12, -.24, .31, .15, .15, .3, sleeve).rotation.z = .2;
    supportSleeve(gun, [-.05, -.09, -.34], sleeve);
    gun.userData = { type, muzzle: new THREE.Vector3(0, .055, -1.154), barrel, bolt };
    gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if(type==='katana'){
    const pivot=new THREE.Group();pivot.name='katanaSwing';gun.add(pivot);
    const frame=new THREE.Group();frame.name='katanaEdgeFrame';pivot.add(frame);
    const steel=material('katanaSteel',0xc5d7d6,.2,{metalness:.92});
    const guard=material('katanaGuard',0x313b38,.4,{metalness:.75});
    const wrap=material('katanaWrap',0x2d3b32,.95),trim=material('katanaTrim',0xbaa371,.45,{metalness:.65});
    // Five vertices per section: a single sharp edge, its two bevels and a
    // blunt spine. Equal longitudinal stations make edge/spine orientation
    // measurable from actual production vertices rather than guessed axes.
    const stations=Array.from({length:25},(_,index)=>index*1.02/24);stations.push(1.12);
    const vertices=[],materialIndices=[[],[],[]],sections=[];
    for(const distance of stations){
      const t=Math.min(1,distance/1.02),u=(1.22-Math.sqrt(1.22*1.22-.4*distance))/.2;
      // As on a real katana, the blade curves away from its cutting edge: the
      // edge (local -X) runs along the longer, convex side and the spine along
      // the shorter, concave one. (The two profiles are mirrored and swapped.)
      const edgeProfile=distance<=1.02?-.032*(1-t)**2-2*.058*t*(1-t)-.105*t*t:-.035;
      const spineProfile=.032*(1-u)**2+2*.014*u*(1-u)-.035*u*u;
      // The point (kissaki) stays on the edge side: past 1.02 m the edge
      // sweeps up to a tip in line with the nearly straight spine.
      const edge=distance<=1.02?-spineProfile:.112,spine=distance<=1.02?-edgeProfile:.112;
      const bevel=edge+(spine-edge)*.28,base=vertices.length/3,z=-distance;
      vertices.push(edge,.0035,z,bevel,.007,z,spine,.007,z,spine,0,z,bevel,0,z);
      sections.push({distance,edge:base,spineTop:base+2,spineBottom:base+3});
      if(sections.length>1)for(let side=0;side<5;side++){
        const previous=base-5,next=(side+1)%5,bucket=materialIndices[side===0||side===4?1:side===2?2:0];
        bucket.push(previous+side,base+next,base+side,previous+side,previous+next,base+next);
      }
    }
    materialIndices[2].push(0,4,3,0,3,2,0,2,1);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(materialIndices.flat());let groupStart=0;materialIndices.forEach((indices,materialIndex)=>{geometry.addGroup(groupStart,indices.length,materialIndex);groupStart+=indices.length;});geometry.computeVertexNormals();geometry.computeBoundingBox();
    const bladeCenter=geometry.boundingBox.getCenter(new THREE.Vector3());geometry.translate(-bladeCenter.x,-bladeCenter.y,-bladeCenter.z);
    const sharpened=material('katanaCuttingEdge',0xe6f1ee,.15,{metalness:.95}),spineMaterial=material('katanaSpine',0x586966,.38,{metalness:.8});sharpened.name='katanaCuttingEdge';spineMaterial.name='katanaSpine';
    const blade=new THREE.Mesh(geometry,[steel,sharpened,spineMaterial]);blade.name='katanaBlade';blade.userData={sections,cuttingSide:'negative-X',edgeName:'katanaCuttingEdge',spineName:'katanaSpine'};blade.position.copy(bladeCenter);blade.position.z-=.055;frame.add(blade);
    const tsuba=cylinder(frame,0,0,-.04,.092,.092,.018,guard,16);tsuba.rotation.x=Math.PI/2;tsuba.scale.z=.65;
    const handle=cylinder(frame,0,0,.14,.025,.026,.32,wrap,10);handle.rotation.x=Math.PI/2;
    for(let index=0;index<7;index++){
      const band=box(frame,0,.025,.015+index*.04,.044,.008,.014,trim);band.rotation.y=index%2===0?.55:-.55;
    }
    for(const z of[-.02,.3]){const cap=cylinder(frame,0,0,z,.029,.029,.025,trim,12);cap.rotation.x=Math.PI/2;}
    const hand=material('firstPersonHand',0xb89171),sleeve=material('firstPersonSleeve',0x3e4a43);
    box(frame,.028,-.02,.09,.09,.10,.11,hand);box(frame,-.028,-.02,.225,.09,.10,.11,hand);
    box(frame,.10,-.10,.29,.13,.13,.28,sleeve).rotation.z=.18;
    gun.userData={type,melee:true,meleePivot:pivot,bladeFrame:frame,muzzle:new THREE.Vector3(.112,0,-1.175),trailTip:new THREE.Vector3(.09,0,-1.08),swingWindows:{light:[-.05,.1],heavy:[-.05,.1]}};
    animateMeleeWeapon(gun);gun.traverse(node=>{if(node.isMesh){node.castShadow=false;node.receiveShadow=false;}});
    return gun;
  }
  if (['assault', 'rocket', 'flamethrower'].includes(type)) {
    const dark = material('specialGunDark', 0x283334, .5, { metalness: .65 });
    const steel = material('specialGunSteel', 0x85928d, .35, { metalness: .8 });
    const olive = material('specialGunOlive', 0x64704d, .85);
    const black = material('specialGunBore', 0x0a1416, .9);
    let barrel, muzzle;
    if (type === 'assault') {
      // Narrow receiver, curved magazine and a compact optic distinguish the
      // precision rifle from the heavy machine gun and its box magazine.
      box(gun, 0, .015, -.06, .105, .16, .4, dark);
      box(gun, 0, -.02, .3, .085, .115, .32, olive);
      box(gun, 0, -.14, .09, .085, .2, .1, olive).rotation.x = -.24;
      const mag = box(gun, 0, -.19, -.105, .075, .27, .12, dark); mag.rotation.x = -.24;
      for (let index = 0; index < 3; index++) box(gun, .04, -.13 - index * .065, -.115, .01, .018, .1, steel);
      box(gun, 0, .025, -.42, .095, .105, .29, olive);
      for (const side of [-1, 1]) for (let index = 0; index < 4; index++) box(gun, side * .05, .035, -.32 - index * .06, .008, .033, .025, black);
      barrel = cylinder(gun, 0, .025, -.655, .019, .022, .22, steel, 10); barrel.rotation.x = Math.PI / 2;
      const brake = cylinder(gun, 0, .025, -.79, .031, .031, .07, dark, 10); brake.rotation.x = Math.PI / 2;
      box(gun, 0, .135, -.08, .075, .065, .13, steel);
      box(gun, 0, .173, -.08, .05, .018, .11, black);
      box(gun, 0, .135, -.525, .027, .08, .025, steel);
      muzzle = new THREE.Vector3(0, .025, -.83);
    } else if (type === 'rocket') {
      barrel = cylinder(gun, 0, .035, -.14, .115, .115, 1.12, olive, 16); barrel.rotation.x = Math.PI / 2;
      for (const z of [-.705, .405]) {
        const ring = cylinder(gun, 0, .035, z, .132, .132, .055, steel, 16); ring.rotation.x = Math.PI / 2;
        const bore = cylinder(gun, 0, .035, z + (z < 0 ? -.031 : .031), .095, .095, .008, black, 14); bore.rotation.x = Math.PI / 2;
      }
      box(gun, 0, -.18, .035, .085, .22, .11, dark);
      box(gun, 0, -.14, -.3, .075, .16, .1, dark);
      box(gun, .124, .1, -.08, .055, .09, .27, dark);
      for (const z of [-.2, .1]) box(gun, .124, .17, z, .065, .06, .035, steel);
      box(gun, 0, -.105, .3, .22, .07, .23, dark);
      box(gun, -.117, .035, .15, .012, .055, .11, material('rocketWarning', 0xe9be66, .7));
      muzzle = new THREE.Vector3(0, .035, -.755);
    } else {
      const tank = material('flameFuelTank', 0x826638, .72, { metalness: .45 });
      box(gun, 0, .005, -.02, .12, .15, .32, dark);
      for (const side of [-1, 1]) {
        cylinder(gun, side * .125, -.07, .2, .067, .067, .33, tank, 12);
        cylinder(gun, side * .125, .108, .2, .026, .026, .035, steel, 10);
        box(gun, side * .125, -.06, .269, .1, .065, .014, olive);
      }
      barrel = cylinder(gun, 0, .015, -.39, .039, .045, .51, steel, 12); barrel.rotation.x = Math.PI / 2;
      const shroud = cylinder(gun, 0, .015, -.59, .076, .06, .21, dark, 12); shroud.rotation.x = Math.PI / 2;
      for (let index = 0; index < 4; index++) {
        const band = cylinder(gun, 0, .015, -.51 - index * .045, .078, .078, .012, steel, 12); band.rotation.x = Math.PI / 2;
      }
      box(gun, 0, -.13, .08, .09, .2, .11, olive);
      box(gun, 0, -.12, -.3, .075, .17, .11, olive);
      const pilot = cylinder(gun, 0, -.061, -.67, .012, .012, .065, tank, 8); pilot.rotation.x = Math.PI / 2;
      const hose = new THREE.Mesh(new THREE.TorusGeometry(.145, .018, 6, 12, Math.PI), dark); hose.position.set(.06, -.18, .1); hose.rotation.y = Math.PI / 2; gun.add(hose);
      muzzle = new THREE.Vector3(0, .015, -.715);
    }
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(gun, .055, -.16, .12, .11, .13, .13, hand).rotation.x = -.2;
    box(gun, -.055, -.1, -.3, .11, .1, .16, hand);
    box(gun, .13, -.24, .29, .15, .15, .3, sleeve).rotation.z = .2;
    supportSleeve(gun, [-.055, -.1, -.3], sleeve);
    gun.userData = { type, muzzle, barrel };
    gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if (type === 'pistol') {
    const slide = material('pistolSlide',0x616e70,.3,{metalness:.8});
    const frame = material('pistolFrame',0x242e30,.48,{metalness:.55});
    const grip = material('pistolGrip',0x343a32,.9);
    box(gun,0,.018,-.1,.105,.13,.34,slide);
    box(gun,0,-.045,-.05,.1,.09,.25,frame);
    box(gun,0,-.17,.075,.09,.23,.115,grip).rotation.x=-.18;
    const barrel=cylinder(gun,0,.018,-.2,.017,.019,.18,frame,12);barrel.rotation.x=Math.PI/2;
    const muzzle=cylinder(gun,0,.018,-.295,.025,.025,.018,slide,12);muzzle.rotation.x=Math.PI/2;
    const bore=cylinder(gun,0,.018,-.307,.012,.012,.007,material('pistolBore',0x0b1415),10);bore.rotation.x=Math.PI/2;
    box(gun,0,-.115,-.018,.07,.018,.105,frame);
    for(const side of [-1,1])box(gun,side*.034,-.085,-.055,.012,.065,.018,frame);
    for(let i=0;i<4;i++)box(gun,.055,.025,.035-i*.018,.007,.07,.006,frame);
    box(gun,0,.095,.035,.055,.025,.025,frame);
    box(gun,0,.095,-.24,.024,.025,.02,frame);
    box(gun,0,.112,-.24,.009,.009,.014,material('pistolSight',0xdfb883,.4,{emissive:0x745322,emissiveIntensity:.5}));
    const hand=material('firstPersonHand',0xb89171),sleeve=material('firstPersonSleeve',0x3e4a43);
    box(gun,.045,-.14,.1,.11,.13,.12,hand).rotation.x=-.2;
    box(gun,-.035,-.12,.015,.1,.11,.11,hand);
    const arm=box(gun,.095,-.24,.23,.15,.15,.27,sleeve);arm.rotation.x=-.2;arm.rotation.z=.17;
    supportSleeve(gun,[-.035,-.12,.015],sleeve);
    gun.userData={type,muzzle:new THREE.Vector3(0,.018,-.315),barrel};
    gun.traverse(node=>{if(node.isMesh){node.castShadow=false;node.receiveShadow=false;}});
    return gun;
  }
  if (type === 'magnum') {
    // A revolver silhouette: exposed six-round cylinder, heavy short barrel
    // and curved grip. No shoulder stock, rifle foregrip or box magazine.
    const gold = material('goldGun', 0xe3b550, .25, { metalness: .85 });
    const polished = material('goldGunSteel', 0xffd47c, .2, { metalness: .85 });
    const wood = material('magnumWalnutGrip', 0x38221b, .85), dark = material('magnumBore', 0x191a18, .9);
    const cylinderCenterY = .007, cylinderCenterZ = -.065;
    const chamber = cylinder(gun, 0, cylinderCenterY, cylinderCenterZ, .082, .082, .145, gold, 24);
    chamber.name = 'magnumCylinder'; chamber.rotation.x = Math.PI / 2;
    for (let index = 0; index < 6; index++) {
      const angle = Math.PI / 6 + index * Math.PI / 3, x = Math.cos(angle) * .052, y = cylinderCenterY + Math.sin(angle) * .052;
      const opening = cylinder(gun, x, y, -.1405, .015, .015, .006, dark, 10);
      opening.name = `magnumChamber-${index + 1}`; opening.rotation.x = Math.PI / 2;
      const primer = cylinder(gun, x, y, .0095, .010, .010, .006, polished, 10); primer.rotation.x = Math.PI / 2;
    }
    const topStrap = box(gun, 0, .106, -.055, .102, .024, .235, gold); topStrap.name = 'magnumTopStrap';
    box(gun, 0, -.072, -.055, .105, .026, .205, gold);
    box(gun, 0, .012, .071, .107, .13, .065, gold);
    box(gun, 0, .009, -.163, .104, .128, .032, gold);
    const barrel = cylinder(gun, 0, .059, -.31, .037, .04, .26, polished, 12); barrel.rotation.x = Math.PI / 2; barrel.name = 'magnumHeavyBarrel';
    const underlug = box(gun, 0, .021, -.31, .055, .04, .27, gold); underlug.name = 'magnumUnderlug';
    const crown = cylinder(gun, 0, .059, -.442, .044, .044, .024, gold, 12); crown.rotation.x = Math.PI / 2;
    const bore = cylinder(gun, 0, .059, -.456, .022, .022, .004, dark, 12); bore.rotation.x = Math.PI / 2; bore.name = 'magnumMuzzleBore';
    const gripShape = new THREE.Shape();
    gripShape.moveTo(.032, -.061); gripShape.lineTo(.104, -.055);
    gripShape.quadraticCurveTo(.104, -.108, .14, -.16);
    gripShape.quadraticCurveTo(.195, -.225, .123, -.231);
    gripShape.lineTo(.071, -.222); gripShape.quadraticCurveTo(.049, -.171, .045, -.119);
    gripShape.quadraticCurveTo(.04, -.082, .032, -.061);
    const gripGeometry = new THREE.ExtrudeGeometry(gripShape, { depth: .076, steps: 1, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 2, curveSegments: 10 });
    gripGeometry.translate(0, 0, -.038);
    gripGeometry.computeBoundingBox(); const gripCenter = gripGeometry.boundingBox.getCenter(new THREE.Vector3());
    gripGeometry.translate(-gripCenter.x, -gripCenter.y, -gripCenter.z);
    const grip = new THREE.Mesh(gripGeometry, wood); grip.rotation.y = -Math.PI / 2; grip.position.copy(gripCenter).applyEuler(grip.rotation); grip.name = 'magnumCurvedGrip'; gun.add(grip);
    for (const side of [-1, 1]) {
      const screw = cylinder(gun, side * .043, -.135, .094, .009, .009, .004, polished, 10); screw.rotation.z = Math.PI / 2;
    }
    const guard = new THREE.Mesh(new THREE.TorusGeometry(.043, .006, 6, 18), gold);
    guard.name = 'magnumTriggerGuard'; guard.position.set(0, -.108, -.01); guard.rotation.y = Math.PI / 2; guard.scale.set(1.2, .8, 1); gun.add(guard);
    const trigger = box(gun, 0, -.097, .006, .012, .035, .014, polished); trigger.rotation.x = -.35; trigger.name = 'magnumTrigger';
    const hammer = new THREE.Group(); hammer.name = 'magnumHammer'; gun.add(hammer);
    box(hammer, 0, .075, .095, .035, .043, .025, gold).rotation.x = -.35;
    box(hammer, 0, .096, .12, .045, .014, .05, polished).rotation.x = -.2;
    box(gun, 0, .109, .03, .05, .014, .026, dark);
    box(gun, 0, .108, -.421, .022, .018, .019, dark);
    box(gun, 0, .12, -.421, .009, .007, .013, material('magnumSight', 0xdfb883, .4, { emissive: 0x745322, emissiveIntensity: .5 }));
    const hand = material('firstPersonHand', 0xb89171), sleeve = material('firstPersonSleeve', 0x3e4a43);
    box(gun, .045, -.14, .115, .11, .13, .12, hand).rotation.x = -.2;
    box(gun, -.035, -.12, .04, .1, .11, .11, hand);
    const arm = box(gun, .095, -.24, .23, .15, .15, .27, sleeve); arm.rotation.x = -.2; arm.rotation.z = .17;
    supportSleeve(gun, [-.035, -.12, .04], sleeve);
    gun.userData = { type, muzzle: new THREE.Vector3(0, .059, -.46), barrel, cylinder: chamber };
    gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  if (type === 'smg') {
    // A short receiver, straight stick magazine and open metal stock separate
    // the light SMG from the machine gun's broad box magazine and foregrip.
    // The metalwork is scaled separately so the hands keep human dimensions.
    // The muzzle and teammate grips follow the shorter physical weapon.
    const model = new THREE.Group(); model.name = 'smgCompactFrame'; model.scale.setScalar(SMG_MODEL_SCALE); gun.add(model);
    const dark = material('smgGun', 0x293536, .55, { metalness: .65 });
    const steel = material('smgSteel', 0x899996, .4, { metalness: .8 });
    const grip = material('smgGrip', 0x182626, .94);
    const casing = material('smgCasing', 0x576d68, .75, { metalness: .35 });
    const receiver = box(model, 0, .005, -.015, .105, .135, .29, casing); receiver.name = 'smgCompactReceiver';
    box(model, 0, -.11, .12, .078, .2, .1, grip).rotation.x = -.25;
    const magazine = box(model, 0, -.205, -.08, .066, .25, .085, dark); magazine.name = 'smgStickMagazine';
    box(model, 0, -.333, -.08, .074, .013, .093, steel);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) box(model, side * .035, -.14 - i * .055, -.08, .004, .028, .06, steel);
    const stockFrame = new THREE.Group(); stockFrame.name = 'smgOpenStock'; model.add(stockFrame);
    box(stockFrame, 0, -.015, .175, .086, .105, .045, dark);
    for (const y of [-.068, .04]) box(stockFrame, 0, y, .315, .024, .014, .25, steel);
    box(stockFrame, 0, -.014, .447, .09, .14, .022, grip);
    box(model, 0, .023, -.31, .105, .1, .22, dark);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) box(model, side * .054, .032, -.235 - i * .046, .005, .045, .018, steel);
    box(model, .055, .018, -.005, .004, .037, .11, dark);
    const barrel = cylinder(model, 0, .012, -.44, .025, .03, .36, steel, 12); barrel.rotation.x = Math.PI / 2;
    const bore = cylinder(model, 0, .012, -.62, .016, .016, .002, dark, 12); bore.rotation.x = Math.PI / 2; bore.name = 'smgMuzzleBore';
    box(model, 0, .1, .08, .064, .04, .055, steel);
    box(model, 0, .063, -.61, .05, .09, .04, dark);
    box(model, 0, .111, -.61, .012, .012, .015, material('sight', 0xdfb883, .4, { emissive: 0x745322, emissiveIntensity: .5 }));
    gun.userData = { type, muzzle: new THREE.Vector3(0, .012, -.621).multiplyScalar(SMG_MODEL_SCALE), barrel, rotor: undefined };
    const sleeve = material('firstPersonSleeve', 0x3e4a43), hand = material('firstPersonHand', 0xb89171);
    box(gun, .06 * SMG_MODEL_SCALE, -.13 * SMG_MODEL_SCALE, .19 * SMG_MODEL_SCALE, .12, .15, .13, hand).rotation.x = -.3;
    const arm = box(gun, .13, -.24, .3, .16, .16, .34, sleeve); arm.rotation.x = -.2; arm.rotation.z = .25;
    box(gun, -.065 * SMG_MODEL_SCALE, -.075 * SMG_MODEL_SCALE, -.27 * SMG_MODEL_SCALE, .12, .1, .17, hand);
    supportSleeve(gun, [-.065 * SMG_MODEL_SCALE, -.075 * SMG_MODEL_SCALE, -.27 * SMG_MODEL_SCALE], sleeve);
    gun.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
    return gun;
  }
  const metal=material('gun',0x242c30,.4,{metalness:.75}),steel=material('gunSteel',0x697577,.3,{metalness:.8}),stock=type==='shotgun'?material('shotgunWood',0x592a21,.85):material('gunStock',0x514538,.85);
  const shotgun=type==='shotgun',smg=type==='smg',machinegun=type==='rifle';
  box(gun,0,0,0,machinegun?.17:.115,machinegun?.2:.15,shotgun?.4:machinegun?.43:.34,metal);
  box(gun,0,-.1,.14,.105,.25,.12,stock).rotation.x=-.25;
  box(gun,0,-.015,.31,.12,.16,.3,shotgun?stock:metal);
  const barrelLength=shotgun?.72:smg?.36:type==='minigun'?.65:.57;
  const barrel=cylinder(gun,0,.012,-.26-barrelLength/2,machinegun?.033:.025,machinegun?.038:.03,barrelLength,steel,12);barrel.rotation.x=Math.PI/2;
  if (type === 'minigun') {
    // Spin around the shared barrel/collar axis, keeping their rest geometry.
    // Offsetting the children alone makes the entire assembly orbit the gun.
    const rotor = new THREE.Group(); rotor.name = 'minigunRotor'; rotor.position.y = .012; gun.add(rotor); gun.userData.rotor = rotor;
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      const tube = cylinder(rotor,Math.cos(angle)*.075,Math.sin(angle)*.075,-.26-barrelLength/2,.024,.024,barrelLength,steel,10); tube.rotation.x = Math.PI/2; tube.name = `minigunBarrel-${i + 1}`;
    }
    for (const [index, z] of [-.35,-.76].entries()) { const ring = cylinder(rotor,0,0,z,.115,.115,.065,metal,16); ring.rotation.x=Math.PI/2; ring.name = `minigunCollar-${index + 1}`; }
    const drum = cylinder(gun,0,-.12,.01,.16,.16,.29,metal,16); drum.rotation.z=Math.PI/2;
    box(gun,0,.16,.03,.25,.055,.23,steel);
  } else if(shotgun) {
    const tube=cylinder(gun,0,-.07,-.52,.025,.025,.6,metal,10);tube.rotation.x=Math.PI/2;
    box(gun,0,-.03,-.39,.12,.13,.23,stock);
  } else if(machinegun) {
    const magazine=box(gun,.025,-.205,-.07,.19,.27,.23,metal);magazine.rotation.x=-.06;
    box(gun,.025,-.34,-.06,.205,.025,.245,steel);
    for(let i=0;i<4;i++)box(gun,.124,-.12-i*.055,-.07,.012,.022,.21,steel);
    box(gun,0,.018,-.4,.15,.13,.29,metal);
    for(let i=0;i<5;i++)for(const side of [-1,1])box(gun,side*.079,.035,-.29-i*.048,.008,.055,.022,stock);
    const foregrip=cylinder(gun,0,-.15,-.43,.043,.05,.23,stock,10);foregrip.rotation.x=-.1;
    for(const z of [-.12,.055])box(gun,0,.14,z,.055,.11,.035,steel);
    box(gun,0,.195,-.035,.065,.035,.24,metal);
  } else {
    const mag=box(gun,0,-.2,-.09,.09,.28,.12,metal);mag.rotation.x=smg?.05:-.12;
    box(gun,0,.06,-.31,.12,.115,smg?.22:.34,metal);
    for(let i=0;i<5;i++) box(gun,.064,.07,-.2-i*.048,.007,.045,.02,steel);
  }
  box(gun,0,.1,.08,.07,.055,.06,steel);box(gun,0,.063,-.25-barrelLength,.05,.09,.04,metal);
  // A tiny warm front-sight mark remains readable in dim corners.
  box(gun,0,.111,-.25-barrelLength,.012,.012,.015,material('sight',0xdfb883,.4,{emissive:0x745322,emissiveIntensity:.5}));
  gun.userData={type,muzzle:new THREE.Vector3(0,.012,-.29-barrelLength),barrel,rotor:gun.userData.rotor};
  const sleeve=material('firstPersonSleeve',0x3e4a43);
  const hand=material('firstPersonHand',0xb89171);
  box(gun,.06,-.13,.19,.12,.15,.13,hand).rotation.x=-.3;
  const arm=box(gun,.13,-.24,.3,.16,.16,.34,sleeve);arm.rotation.x=-.2;arm.rotation.z=.25;
  box(gun,-.065,machinegun?-.14:-.075,machinegun?-.43:-.27,.12,.1,.17,hand);
  supportSleeve(gun,[-.065,machinegun?-.14:-.075,machinegun?-.43:-.27],sleeve);
  gun.traverse(node=>{if(node.isMesh){node.castShadow=false;node.receiveShadow=false;}});
  return gun;
}
// The support hand's forearm on a two-handed gun: one sleeve box from the
// wrist under the support hand down toward the lower left, where the elbow
// leaves the screen. [x, y, z] is the support hand's centre in the gun's frame.
// Same sleeve material as the firing arm, so createHeldWeapon strips it and
// the Frisson style dresses it with the sleeve recipe.
function supportSleeve(parent, [x, y, z], sleeve) {
  const arm = box(parent, x - .07, y - .135, z + .15, .14, .14, .3, sleeve);
  arm.rotation.set(.72, -.42, 0);
  return arm;
}
