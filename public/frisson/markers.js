// Frisson part: markers (art/frisson/MARKERS.md). Blender-modelled family
// markers from markers.glb replace the storybook health markers through the
// markZombie hook of zombies.js, fitted to the body, head and arm the zombie
// actually wears and baked once per (family, parent, fit): no upload per
// spawn and never more meshes per family than Famille draws. The colours
// stay true (_Detail) or grey times the family skin (_Skin, linear); _Glow
// is the only light, one extra shader program with a slow flicker. The skin
// and cloth cues of the heads and bodies are untouched. With no markers.glb
// (or a broken one) nothing installs and the cast Famille marks (marks.js)
// stay. Pale is unmarked in both looks; raiders never get markers.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { torsoTransform } from './bodies.js';
import { skinColor } from './palette.js';
import { setZombieStyle, getZombieStyle, withRim, createZombie, disposeZombie } from '../zombies.js';

export const MARK_PREFIX = 'FrissonMark_';
export const CHANNELS = Object.freeze({ Detail: 'detail', Skin: 'skin', Glow: 'glow' });
export const ANCHOR_PARENT = Object.freeze({ Torso: 'body', Shoulders: 'body', Neck: 'body', CrawlerTorso: 'body', Skull: 'head', Face: 'head', Jaw: 'head', Helmet: 'head', ArmR: 'arm', CrawlerArmR: 'arm' });
// The roots a family must carry (MARKERS.md section 3, "Required roots");
// standing and crawler sets. A zombie whose family misses one keeps the
// Famille marks: a family is answered whole or not at all.
export const STANDING_ROOTS = Object.freeze({
  sallow: Object.freeze(['Torso', 'Skull']), rust: Object.freeze(['Neck', 'ArmR']), scarlet: Object.freeze(['Torso', 'Jaw']),
  umber: Object.freeze(['Shoulders', 'Skull']), charcoal: Object.freeze(['Shoulders', 'Skull']),
  hulk: Object.freeze(['Neck', 'Shoulders']), iron: Object.freeze(['Neck', 'Shoulders', 'Face']),
  dread: Object.freeze(['Neck', 'Shoulders', 'Torso', 'Face']), overlord: Object.freeze(['Neck', 'Shoulders', 'Torso', 'Helmet']),
});
export const CRAWLER_ROOTS = Object.freeze({
  sallow: Object.freeze(['CrawlerTorso', 'Skull']), rust: Object.freeze(['CrawlerTorso', 'CrawlerArmR']),
  scarlet: Object.freeze(['CrawlerTorso', 'Jaw']), umber: Object.freeze(['CrawlerTorso', 'Skull']), charcoal: Object.freeze(['CrawlerTorso', 'Skull']),
});
// The metal vocabulary is drawn with the metal material, the rest matte.
const METAL = new Set(['rust', 'hulk', 'iron', 'dread', 'overlord']);
const GLOW_STRENGTH = Object.freeze({ charcoal: 1.6, overlord: 1.2 });
const COMPILE_TIMEOUT = 5000;

// --- The GLB ---------------------------------------------------------------------
// { families: Map(family id -> Map(anchor -> { root, channels })) }. Names
// follow the contract; anything else fails loudly, so a bad export stays on
// the Famille marks instead of drawing something odd.
export function markersFromGlb({ roots }) {
  const families = new Map();
  for (const root of roots) {
    if (!root.name.startsWith(MARK_PREFIX)) throw new Error(`GLB: root ${root.name} is not named ${MARK_PREFIX}<Family>_<Anchor>`);
    const rest = root.name.slice(MARK_PREFIX.length);
    const anchor = Object.keys(ANCHOR_PARENT).find(name => rest.endsWith(`_${name}`));
    const family = anchor && rest.slice(0, -(anchor.length + 1)).toLowerCase();
    if (!anchor || !STANDING_ROOTS[family] || rest.slice(0, -(anchor.length + 1)) !== family[0].toUpperCase() + family.slice(1))
      throw new Error(`GLB: root ${root.name} is not ${MARK_PREFIX}<Family>_<Anchor> with a known family and anchor`);
    if (root.mesh) throw new Error(`GLB: ${root.name} must be an empty with mesh children`);
    if (!families.has(family)) families.set(family, new Map());
    const anchors = families.get(family);
    if (anchors.has(anchor)) throw new Error(`GLB: ${root.name} appears twice`);
    const channels = {};
    for (const child of root.children) {
      const channel = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!CHANNELS[channel]) throw new Error(`GLB: ${child.name} is not a channel of ${root.name} (_Detail, _Skin or _Glow)`);
      if (channels[channel]) throw new Error(`GLB: ${child.name} appears twice`);
      if (!child.mesh || child.children.length) throw new Error(`GLB: ${child.name} must be a mesh without children`);
      if (child.mesh.material?.name !== CHANNELS[channel]) throw new Error(`GLB: ${child.name}: material "${child.mesh.material?.name ?? 'none'}", expected "${CHANNELS[channel]}"`);
      if (!child.mesh.geometry.attributes.color) throw new Error(`GLB: ${child.name} has no COLOR_0`);
      channels[channel] = child.mesh.geometry;
    }
    if (!channels.Detail && !channels.Glow) throw new Error(`GLB: ${root.name} needs a _Detail or a _Glow channel`);
    anchors.set(anchor, Object.freeze({ root: root.name, channels: Object.freeze(channels) }));
  }
  if (!families.size) throw new Error('GLB: no Frisson marker root');
  return Object.freeze({ families });
}

// --- Measures --------------------------------------------------------------------
// Head metrics of the worn head, in its unscaled geometry frame (MARKERS.md
// "Measured head metrics"): fronts of the brow, face and jaw on the skin,
// temple half-width, and top and back over the cranium (every channel).
export function headMetrics(skin, detail, eyes) {
  const geometries = [skin, detail, eyes].filter(Boolean);
  const front = (half, low, high) => frontAt(skin ? [skin] : [], half, low, high);
  return Object.freeze({
    brow: front(.10, .03, .12) ?? -.215,
    face: front(.08, -.05, .10) ?? -.25,
    jaw: front(.08, -.16, -.06) ?? -.205,
    temple: widest(geometries, .07, .13, ([x]) => Math.abs(x), ([, y]) => y >= 0) ?? .15,
    top: highest(geometries) ?? .21,
    back: widest(geometries, 0, Infinity, ([, , z]) => z, ([, y]) => y >= 0) ?? .22,
  });
}
// The most forward z (smallest) over a front region, vertices and edge
// crossings; null when the surface misses the region.
function frontAt(geometries, half, low, high) {
  let front = Infinity;
  forEachPoint(geometries, point => {
    if (Math.abs(point[0]) <= half && point[1] >= low && point[1] <= high) front = Math.min(front, point[2]);
  });
  return Number.isFinite(front) ? front : null;
}
// The extreme of `measure` over a y band, or null. `fallback` filters the
// points used when the band is empty (the whole cranium for temple and back).
function widest(geometries, low, high, measure, fallback) {
  let best = -Infinity, any = false;
  forEachPoint(geometries, point => {
    if (point[1] >= low && point[1] <= (Number.isFinite(high) ? high : Infinity)) { best = Math.max(best, measure(point)); any = true; }
  });
  if (!any && fallback) forEachPoint(geometries, point => { if (fallback(point)) best = Math.max(best, measure(point)); });
  return Number.isFinite(best) ? best : null;
}
function highest(geometries) {
  let top = -Infinity;
  forEachPoint(geometries, point => { top = Math.max(top, point[1]); });
  return Number.isFinite(top) ? top : null;
}
// Vertices and edge midpoints of every triangle.
function forEachPoint(geometries, visit) {
  const point = new THREE.Vector3();
  for (const geometry of geometries) {
    const position = geometry.attributes.position, index = geometry.index;
    const at = vertex => point.fromBufferAttribute(position, vertex);
    for (let vertex = 0; vertex < position.count; vertex++) visit([point.fromBufferAttribute(position, vertex).x, point.y, point.z]);
    const count = (index ? index.count : position.count);
    for (let face = 0; face < count; face += 3) {
      const corners = [0, 1, 2].map(offset => {
        const vertex = index ? index.getX(face + offset) : face + offset;
        return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
      });
      for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) visit([(corners[p][0] + corners[q][0]) / 2, (corners[p][1] + corners[q][1]) / 2, (corners[p][2] + corners[q][2]) / 2]);
    }
  }
}

// The styled torso's shoulder half-width (all its meshes, after their
// transform, over y 1.38-1.50); the Famille torso takes the contract's .235w.
export function shoulderHalfOf(body, w = 1) {
  const meshes = ['zombieTorso', 'zombieSkin', 'zombieClothes'].map(name => body.getObjectByName(name)).filter(Boolean);
  if (!meshes.length || !meshes[0].userData.bodyVariant) return .235 * w;
  let half = -Infinity;
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateMatrix();
    const position = mesh.geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrix);
      if (point.y >= 1.38 && point.y <= 1.50) half = Math.max(half, Math.abs(point.x));
    }
  }
  return Number.isFinite(half) ? half : .235 * w;
}

// The forearm section at height y in the arm geometry's own frame (unit
// pivot space for a styled arm): its centre and its largest radius.
export function forearmSection(geometries, y = -.46) {
  const points = [];
  const point = new THREE.Vector3();
  for (const geometry of geometries) {
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index);
      if (Math.abs(point.y - y) <= .02) points.push([point.x, point.z]);
    }
  }
  if (points.length < 3) return { cx: 0, cz: -.02, r: .045 };
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length, cz = points.reduce((sum, [, z]) => sum + z, 0) / points.length;
  const r = Math.max(...points.map(([x, z]) => Math.hypot(x - cx, z - cz)));
  return { cx, cz, r };
}

// --- Fitting ----------------------------------------------------------------------
// One THREE.Matrix4 per linear fit; the head anchors are fitted axis-wise
// instead (fitHead below). Every fit maps the anchor's reference frame onto
// what the zombie wears (MARKERS.md "Anchors, parents and fitting").
const hipEuler = new THREE.Euler(), hipQuat = new THREE.Quaternion();
function transformMatrix({ scale, rotationX = 0, position }, dz = 0) {
  const matrix = new THREE.Matrix4();
  matrix.compose(new THREE.Vector3(position[0], position[1], position[2] + dz), hipQuat.setFromEuler(hipEuler.set(rotationX, 0, 0)), new THREE.Vector3(...scale));
  return matrix;
}
// The torso's z shift: the measured chest front against the transformed
// nominal front (0, 1.22, -.160).
function torsoDelta({ w, d, hunch, front }) {
  const nominal = new THREE.Vector3(0, 1.22, -.16).applyMatrix4(transformMatrix(torsoTransform({ w, d, hunch })));
  return front - nominal.z;
}
export function bodyFit(anchor, { w = 1, d = 1, hunch = 0, front = -.159, shoulderHalf = .235 * w } = {}) {
  const delta = torsoDelta({ w, d, hunch, front });
  if (anchor === 'Neck') {
    const centre = new THREE.Vector3(0, 1.5, -.01).applyMatrix4(transformMatrix(torsoTransform({ w, d, hunch })));
    return new THREE.Matrix4().makeTranslation(centre.x, centre.y - 1.5, centre.z + .01 + delta * .5);
  }
  const transform = torsoTransform({ w, d, hunch });
  if (anchor === 'Shoulders') transform.scale = [shoulderHalf / .235, 1, d];
  return transformMatrix(transform, delta);
}
export const crawlerFit = front => new THREE.Matrix4().makeTranslation(0, 0, front + .22);
// The arm fit in the arm geometry's own frame: the wrist ring's authored
// centre (0, -.02) goes to the measured centre, x and z scaled to the
// measured radius; the mesh then carries the arm's own scale.
export function armFit({ cx = 0, cz = -.02, r = .045 } = {}) {
  const k = (r + .006) / .051;
  return new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeTranslation(0, 0, .02)).multiply(new THREE.Matrix4().makeScale(k, 1, k));
}
// Axis-wise about the head centre, then the head's size (MARKERS.md).
export function headFit(anchor, { brow = -.215, face = -.25, jaw = -.205, temple = .15, top = .21, back = .22 } = {}, size = 1) {
  const front = anchor === 'Face' ? face / -.25 : anchor === 'Jaw' ? jaw / -.205 : brow / -.215;
  return Object.freeze({ kx: temple / .15 * size, ky: top / .21 * size, kf: front * size, kb: back / .22 * size, size });
}
// The crown (the Helmet anchor) was authored on the Famille helmet's frame —
// band centre y .175, band half-widths .235 x .21 — which Frisson never
// draws, so an identity fit leaves it floating over the Frisson boss head.
// On a Frisson head it is re-fitted to the skin itself: the band sits 75 mm
// under the skin's top and hugs the cranium there (plus 12 mm of clearance).
// Without a Frisson head the Famille helmet is drawn: identity, as before.
function helmetFit({ skin, size }) {
  if (!skin) return new THREE.Matrix4();
  const position = skin.attributes.position;
  let top = -Infinity;
  for (let index = 0; index < position.count; index++) top = Math.max(top, position.getY(index));
  const yb = top * size - .075;
  let rx = 0, rz = 0;
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(position.getY(index) * size - yb) < .015) {
      rx = Math.max(rx, Math.abs(position.getX(index)) * size);
      rz = Math.max(rz, Math.abs(position.getZ(index)) * size);
    }
  }
  return new THREE.Matrix4().makeTranslation(0, yb - .175, 0)
    .multiply(new THREE.Matrix4().makeScale((rx + .012) / .235, 1, (rz + .012) / .21));
}

// --- Seating (M5) ------------------------------------------------------------
// The baked head piece must touch the worn head somewhere (MARKERS.md, M5).
// The fit reads the whole cranium, hair included; a stray wisp can stretch it
// until the piece hangs clear of the skull. Then — and only then — the fit
// eases toward the skull alone and the best-seating bake stays.
const SEAT_AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SEAT_GAP = .02, seatProbeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const seatRay = new THREE.Raycaster(), seatFrom = new THREE.Vector3(), seatAxis = new THREE.Vector3(), seatVertex = new THREE.Vector3();
// As floatOff in the tests: a vertex on or inside the surface seats the
// piece; a vertex outside takes its nearest surface along the six axis
// directions. The piece's clearance is its closest approach.
function headClearance(geometry, surfaces) {
  let clearance = Infinity;
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    seatVertex.fromBufferAttribute(position, index);
    const distance = Math.hypot(seatVertex.x, seatVertex.z);
    if (distance < 1e-6) return 0;
    seatFrom.set(0, seatVertex.y, 0);
    seatRay.set(seatFrom, seatAxis.set(seatVertex.x, 0, seatVertex.z).normalize()); seatRay.far = 2;
    const surface = seatRay.intersectObjects(surfaces, false).at(-1)?.distance ?? 0;
    if (distance <= surface + 1e-4) return 0;
    for (const axis of SEAT_AXES) {
      seatRay.set(seatVertex, seatAxis.set(axis[0], axis[1], axis[2])); seatRay.far = .5;
      const hit = seatRay.intersectObjects(surfaces, false)[0];
      if (hit && hit.distance < clearance) clearance = hit.distance;
    }
  }
  return clearance;
}

// --- Baking -----------------------------------------------------------------------
const triangleCount = geometry => geometry.index ? geometry.index.count : geometry.attributes.position.count;

// All of a family's roots for one parent merged into one geometry, fitted
// and coloured: _Detail true colour, _Skin grey x the family skin (linear),
// _Glow with its glow attribute at 1 (0 elsewhere). `fit` maps each anchor
// to a Matrix4, or to a headFit descriptor for the head anchors.
export function bakeMarkers(family, anchors, fits, skinHex) {
  const skinTint = new THREE.Color(skinHex);
  const parts = [];
  for (const anchor of anchors) {
    const fit = fits(anchor);
    for (const [channel, geometry] of Object.entries(family.get(anchor).channels))
      parts.push({ geometry, tint: channel === 'Skin' ? skinTint : null, glow: channel === 'Glow' ? 1 : 0, fit, head: anchor !== 'CrawlerTorso' && ANCHOR_PARENT[anchor] === 'head' && anchor !== 'Helmet' });
  }
  const glowing = parts.some(part => part.glow);
  const vertices = parts.reduce((sum, part) => sum + part.geometry.attributes.position.count, 0), indexCount = parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3);
  const glows = glowing ? new Float32Array(vertices) : null;
  const indices = new (vertices > 65535 ? Uint32Array : Uint16Array)(indexCount);
  const point = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  let vertex = 0, offset = 0;
  for (const { geometry, tint, glow, fit, head } of parts) {
    const { position, normal, color } = geometry.attributes, count = position.count;
    if (!head) {
      normalMatrix.getNormalMatrix(fit);
      for (let index = 0; index < count; index++) {
        point.fromBufferAttribute(position, index).applyMatrix4(fit);
        positions.set([point.x, point.y, point.z], (vertex + index) * 3);
        if (normal) {
          point.fromBufferAttribute(normal, index).applyMatrix3(normalMatrix).normalize();
          normals.set([point.x, point.y, point.z], (vertex + index) * 3);
        }
      }
    } else {
      // Axis-wise fit about the head centre: y scales above the centre only,
      // z scales front and back apart, then the head's size.
      const { kx, ky, kf, kb, size } = fit;
      for (let index = 0; index < count; index++) {
        point.fromBufferAttribute(position, index);
        const x = point.x * kx, y = point.y > 0 ? point.y * ky : point.y * size, z = point.z < 0 ? point.z * kf : point.z * kb;
        positions.set([x, y, z], (vertex + index) * 3);
        if (normal) {
          point.fromBufferAttribute(normal, index);
          const nx = point.x / kx, ny = point.y > 0 ? point.y / ky : point.y / size, nz = point.z < 0 ? point.z / kf : point.z / kb, length = Math.hypot(nx, ny, nz) || 1;
          normals.set([nx / length, ny / length, nz / length], (vertex + index) * 3);
        }
      }
    }
    for (let index = 0; index < count; index++) {
      colors[(vertex + index) * 3] = color.getX(index) * (tint ? tint.r : 1);
      colors[(vertex + index) * 3 + 1] = color.getY(index) * (tint ? tint.g : 1);
      colors[(vertex + index) * 3 + 2] = color.getZ(index) * (tint ? tint.b : 1);
      if (glows) glows[vertex + index] = glow;
    }
    const total = triangleCount(geometry);
    for (let index = 0; index < total; index++) indices[offset + index] = vertex + (geometry.index ? geometry.index.getX(index) : index);
    vertex += count; offset += total;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (!parts.every(part => part.geometry.attributes.normal)) geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (glows) geometry.setAttribute('glow', new THREE.BufferAttribute(glows, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// --- The style ----------------------------------------------------------------------
// One shared set of materials: matte and metal (the game's rim), and a glow
// variant of each (ONE extra program, a fixed cache key; roughness and
// metalness are uniforms, so both glow materials share it). The flicker is
// one shared uniform, 0.8-1.0 at under 2 Hz, on presets above low.
export function createMarkersStyle(markers, { hooks = null, quality = 'high' } = {}) {
  const materials = new Map(), baked = new Map();
  const flicker = { value: 1 };
  const cached = (name, create) => { if (!materials.has(name)) materials.set(name, create()); return materials.get(name); };
  const faceted = (roughness, metalness) => withRim(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, vertexColors: true, flatShading: true }));
  // totalEmissiveRadiance += vColor * vGlow * glowStrength, with the shared
  // flicker. One program for every glowing marker.
  const glowify = (material, strength) => {
    const rim = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
      rim(shader);
      shader.uniforms.markGlow = { value: strength };
      shader.uniforms.markFlicker = flicker;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float markGlow;\nuniform float markFlicker;')
        .replace('#include <opaque_fragment>', 'totalEmissiveRadiance += vColor * vGlow * markGlow * markFlicker;\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'frissonMarkGlow';
    return material;
  };
  const materialFor = family => {
    const metal = METAL.has(family), glow = GLOW_STRENGTH[family];
    if (glow) return cached(`${metal ? 'metal' : 'matte'}Glow`, () => glowify(faceted(metal ? .55 : .9, metal ? .55 : 0), glow));
    return cached(metal ? 'metal' : 'matte', () => faceted(metal ? .55 : .9, metal ? .55 : 0));
  };
  if (hooks && quality !== 'low') hooks.frame = ({ time } = {}) => { flicker.value = .9 + .1 * Math.sin(time * Math.PI * 2 * 1.6); };

  const bake = (key, family, anchors, fits, skinHex) => {
    if (!baked.has(key)) {
      const geometry = bakeMarkers(family, anchors, fits, skinHex);
      geometry.name = key;
      baked.set(key, geometry);
    }
    return baked.get(key);
  };
  const add = (parent, geometry, material, name) => {
    // Shared geometry: never userData.ownedGeometry, so disposeZombie leaves
    // it alone; shadows are set here as zombies.js mesh() would.
    const part = new THREE.Mesh(geometry, material);
    part.name = name; part.castShadow = true; part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  const headPieces = head => ({
    skin: head.getObjectByName('zombieHeadSkin')?.geometry, detail: head.getObjectByName('zombieFace')?.geometry, eyes: head.getObjectByName('zombieEyes')?.geometry,
    variant: head.getObjectByName('zombieHeadSkin')?.userData.headVariant ?? 'reference', size: head.getObjectByName('zombieHeadSkin')?.scale.x ?? 1,
  });

  return {
    markers, baked, flicker, materialFor,
    markZombie(body, head, appearance, { kind, boss = false, id, crawler = false, w = 1, d = 1, hunch = 0, front, arms } = {}) {
      // Raiders are living people: no marker, as no Frisson head either.
      if (kind === 'raider') return null;
      const family = markers.families.get(appearance.id);
      if (!family) return null; // pale is unmarked in both looks
      const needed = crawler ? CRAWLER_ROOTS[appearance.id] : STANDING_ROOTS[appearance.id];
      // The whole family or nothing: a family whose roots are missing keeps
      // the Famille marks, so the two looks are never mixed.
      if (!needed?.every(anchor => family.has(anchor))) return null;
      const material = materialFor(appearance.id), skinHex = skinColor(appearance);
      const marker = new THREE.Group(); marker.name = 'healthMarker'; body.add(marker);
      const byParent = parent => needed.filter(anchor => ANCHOR_PARENT[anchor] === parent);
      const bodyAnchors = byParent('body');
      if (bodyAnchors.length) {
        const torso = body.getObjectByName('zombieTorso');
        const key = `${appearance.id}|body|${crawler ? 'crawler' : `${torso?.userData.bodyVariant ?? 'famille'}|${w}|${d}|${hunch}|${front}`}`;
        const geometry = bake(key, family, bodyAnchors, anchor => crawler ? crawlerFit(front ?? -.215)
          : bodyFit(anchor, { w, d, hunch, front: front ?? -.159, shoulderHalf: shoulderHalfOf(body, w) }), skinHex);
        add(marker, geometry, material, 'healthMarkerAccent');
      }
      const headAnchors = byParent('head');
      if (headAnchors.length && head) {
        const worn = headPieces(head);
        const key = `${appearance.id}|head|${worn.variant}|${worn.size}`;
        const metrics = headMetrics(worn.skin, worn.detail, worn.eyes);
        // Skull anchor only: the hood may not stand off a wide-haired head
        // like horns — never wider than the bare skull's temples + 1.5 cm.
        const skullOnly = worn.skin ? headMetrics(worn.skin, null, null) : null;
        const fits = eased => anchor => {
          if (anchor === 'Helmet') return helmetFit(worn);
          const fit = anchor === 'Skull' && skullOnly ? { ...eased, temple: Math.min(eased.temple, skullOnly.temple + .015) } : eased;
          return headFit(anchor, fit, worn.size);
        };
        let geometry = bake(key, family, headAnchors, fits(metrics), skinHex);
        // When the measured cranium (hair included) leaves the piece hanging
        // clear of the worn head, ease the fit toward the skull alone (M5).
        if (worn.skin && headAnchors.some(anchor => anchor !== 'Helmet')) {
          const scaled = new THREE.Matrix4().makeScale(worn.size, worn.size, worn.size);
          const surfaces = [worn.skin, worn.detail].filter(Boolean).map(source => {
            const probe = new THREE.Mesh(source, seatProbeMaterial); probe.matrixAutoUpdate = false; probe.matrixWorld.copy(scaled); return probe;
          });
          let clearance = headClearance(geometry, surfaces);
          if (clearance > SEAT_GAP) {
            const skull = headMetrics(worn.skin, null, null);
            for (const t of [.75, .5, .25, 0]) {
              const eased = Object.fromEntries(Object.keys(metrics).map(metric => [metric, skull[metric] + (metrics[metric] - skull[metric]) * t]));
              const retry = bake(`${key}|seat${t}`, family, headAnchors, fits(eased), skinHex);
              const gap = headClearance(retry, surfaces);
              if (gap < clearance) { clearance = gap; geometry = retry; }
              if (gap <= .005) break;
            }
          }
          // Still clear: the skin's own fronts misled the fit (a nose low
          // enough to read as the jaw, as on the Rôdeurs B Elder of Frisson
          // léger). Ease the brow, face and jaw fronts toward the contract's
          // reference head, keeping the measured cranium. Every heads.glb
          // head seats before this (frisson-heads.test.mjs).
          if (clearance > SEAT_GAP) {
            const reference = headMetrics(null, null, null);
            for (const t of [.75, .5, .25, 0]) {
              const eased = { ...metrics };
              for (const metric of ['brow', 'face', 'jaw']) eased[metric] = reference[metric] + (metrics[metric] - reference[metric]) * t;
              const retry = bake(`${key}|front${t}`, family, headAnchors, fits(eased), skinHex);
              const gap = headClearance(retry, surfaces);
              if (gap < clearance) { clearance = gap; geometry = retry; }
              if (gap <= .005) break;
            }
          }
        }
        const headMarks = new THREE.Group(); headMarks.name = 'healthHeadMarker'; head.add(headMarks);
        add(headMarks, geometry, material, 'healthHeadAccent');
      }
      const armAnchors = byParent('arm');
      const pivot = arms?.[1];
      if (armAnchors.length && pivot) {
        const meshes = pivot.children.filter(child => child.isMesh);
        const scale = meshes[0]?.scale ?? new THREE.Vector3(1, 1, 1);
        const section = forearmSection(meshes.map(mesh => mesh.geometry), crawler ? -.3 : -.46);
        const key = `${appearance.id}|arm|${crawler ? 'crawler' : 'standing'}|${meshes[0]?.userData.bodyVariant ?? 'famille'}|${scale.x}|${scale.y}`;
        const geometry = bake(key, family, armAnchors, () => armFit(section), skinHex);
        const armMarks = new THREE.Group(); armMarks.name = 'healthArmMarker'; pivot.add(armMarks);
        add(armMarks, geometry, material, 'healthArmAccent').scale.copy(scale);
      }
      return marker;
    },
    dispose() {
      for (const geometry of baked.values()) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      baked.clear(); materials.clear();
    },
  };
}

// As heads.js: compiles staged zombies that carry every marker material
// (matte, metal and the one glow program), for the scene's lights and fog;
// never rejects; settles when three is done with the materials. null without
// a renderer.
function precompile({ renderer, scene, camera }) {
  if (!renderer?.compileAsync || !camera) return null;
  const models = [createZombie('walker', false, 140, 'prewarm-wrap'), createZombie('walker', false, 200, 'prewarm-scarf'),
    createZombie('walker', false, 500, 'prewarm-ash'), createZombie('brute', true, 6000, 'prewarm-boss')];
  const stage = new THREE.Group(); stage.name = 'frissonMarkersPrewarm'; stage.add(...models);
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {}).finally(() => models.forEach(disposeZombie));
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Installed after the bodies (index.js PARTS), it
// puts the markers on top of the current style. A missing or broken
// markers.glb is not an error: the Famille marks (cast by marks.js) stay and
// the handle says why ({ style: null, error }). ctx.signal works as for heads.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  let markers;
  try { markers = markersFromGlb(readGlb(await fetchAsset('markers.glb'))); }
  catch (error) {
    signal?.throwIfAborted();
    globalThis.console?.warn?.(`Frisson markers stay Famille: ${error?.message ?? error}`);
    return { style: null, markers: null, error, uninstall() {} };
  }
  const previous = getZombieStyle();
  const markersStyle = createMarkersStyle(markers, { hooks: ctx.hooks, quality: ctx.quality });
  if (signal?.aborted) { markersStyle.dispose(); signal.throwIfAborted(); }
  // The current style with the marker hook on top: one style for
  // setZombieStyle. base keeps the style underneath, so its own uninstall
  // can tell the markers sit on it.
  const style = { ...(previous ?? {}), markZombie: markersStyle.markZombie, markers: markersStyle, base: previous ?? null, dispose: () => markersStyle.dispose() };
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (getZombieStyle() === style) setZombieStyle(previous ?? null);
    if (compiling) compiling.then(() => markersStyle.dispose()); else markersStyle.dispose();
  };
  setZombieStyle(style);
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, markers, markersStyle, uninstall };
}
