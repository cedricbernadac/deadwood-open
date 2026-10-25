// Bodies GLBs for tests (art/frisson/BODIES.md): the final bodies.glb and
// heads.glb the game loads (art/frisson/selection.json), the placeholder
// built in memory and its roots (from the placeholder generator, so tests can
// add, drop or bend parts), and the measures the bodies tests share: how
// well the procedural markers and armour sit on a body.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { writeFrissonGlb } from '../../tools/frisson-glb-write.mjs';
import { placeholderRoots, placeholderGlb } from '../../art/frisson/placeholder/frisson_bodies_placeholder.mjs';

export { placeholderRoots, placeholderGlb };
// The final files, as the game serves them.
export const BODIES_GLB = readFileSync(new URL('../../public/frisson/bodies.glb', import.meta.url));
export const HEADS_GLB = readFileSync(new URL('../../public/frisson/heads.glb', import.meta.url));
// Fixtures: the bodies placeholder (25 roots, no sets) and the placeholder
// heads (eight heads, no boss head) the pack shipped with before the choice.
export const PLACEHOLDER_BODIES = placeholderGlb();
export const PLACEHOLDER_HEADS = readFileSync(new URL('../../art/frisson/placeholder/frisson_heads_placeholder.glb', import.meta.url));

// A GLB from root lists; options as writeFrissonGlb (mutate, text).
export const bodiesGlb = (roots, options = {}) => writeFrissonGlb(roots, { generator: 'frisson-bodies test', materials: ['cloth', 'skin', 'detail', 'pants', 'tie'], ...options });
// The placeholder's roots with `edit(roots)` applied (a deep copy).
export function editedRoots(edit) {
  const roots = structuredClone(placeholderRoots());
  return edit(roots) ?? roots;
}
// A copy of a root under another name (its children renamed to match), its
// points moved by `move([x, y, z])`.
export function renamedRoot(root, name, move = point => point) {
  return { name, children: root.children.map(child => ({ ...structuredClone(child), name: name + child.name.slice(root.name.length), positions: child.positions.map(move) })) };
}

// How a procedural piece sits on a body: the share of its vertices outside
// the envelope and its smallest distance to it, along horizontal rays from
// the axis of `frame` (a body or a pivot: points (0, y, 0) of its own space).
const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), point = new THREE.Vector3(), direction = new THREE.Vector3(), inverse = new THREE.Matrix4();
const twoSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
export function fitOn(frame, envelopeMeshes, piece) {
  frame.updateMatrixWorld(true);
  inverse.copy(frame.matrixWorld).invert();
  const envelope = envelopeMeshes.map(part => {
    const probe = new THREE.Mesh(part.geometry, twoSided); probe.matrixAutoUpdate = false;
    probe.matrixWorld.multiplyMatrices(inverse, part.matrixWorld); return probe;
  });
  const position = piece.geometry.attributes.position, toFrame = new THREE.Matrix4().multiplyMatrices(inverse, piece.matrixWorld);
  let outside = 0, gap = Infinity;
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).applyMatrix4(toFrame);
    origin.set(0, point.y, 0);
    const distance = Math.hypot(point.x, point.z);
    if (distance < 1e-6) continue;
    ray.set(origin, direction.set(point.x, 0, point.z).normalize()); ray.far = 2;
    const surface = ray.intersectObjects(envelope, false).at(-1)?.distance ?? 0;
    if (distance > surface + 1e-4) outside++;
    gap = Math.min(gap, distance - surface);
  }
  return { visible: outside / position.count, gap };
}

// The body's own meshes (torso and limbs, not armour or markers).
export const BODY_MESHES = ['zombieTorso', 'zombieSkin', 'zombieClothes', 'zombieSleeve', 'zombieHand', 'zombieLeg'];
export function bodyEnvelope(model) {
  const list = [];
  model.userData.body.traverse(object => { if (object.isMesh && BODY_MESHES.includes(object.name)) list.push(object); });
  return list;
}
// Every procedural piece worn on the torso or legs: markers and armour.
export const WORN = ['healthMarkerAccent', 'healthMarkerCloth', 'zombieArmor', 'zombieChestPlate', 'zombieArmorStraps', 'zombieArmorPadLeft', 'zombieArmorPadRight', 'zombieHeavyArmor', 'zombieArmorTrim', 'zombieLegGuard'];

// How far a piece floats off what it sits on (MARKERS.md rule M5): the
// piece's closest approach to the envelope — a collar resting on the
// collarbones seats at ~0 even where it stands off the neck, while a piece
// hanging in the air keeps a positive clearance everywhere. Vertices on or
// inside the surface (the horizontal-ray test of fitOn, in `frame` space)
// approach 0; vertices outside take their nearest surface along the six axis
// directions. Infinity when every vertex hangs clear off in every direction.
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function floatOff(frame, envelopeMeshes, piece) {
  frame.updateMatrixWorld(true);
  inverse.copy(frame.matrixWorld).invert();
  const envelope = envelopeMeshes.map(part => {
    const probe = new THREE.Mesh(part.geometry, twoSided); probe.matrixAutoUpdate = false;
    probe.matrixWorld.multiplyMatrices(inverse, part.matrixWorld); return probe;
  });
  const position = piece.geometry.attributes.position, toFrame = new THREE.Matrix4().multiplyMatrices(inverse, piece.matrixWorld);
  let float = Infinity;
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).applyMatrix4(toFrame);
    origin.set(0, point.y, 0);
    const distance = Math.hypot(point.x, point.z);
    // A vertex on the axis, or on or inside the surface, makes the closest
    // approach 0: nothing can beat it.
    if (distance < 1e-6) return 0;
    ray.set(origin, direction.set(point.x, 0, point.z).normalize()); ray.far = 2;
    const surface = ray.intersectObjects(envelope, false).at(-1)?.distance ?? 0;
    if (distance <= surface + 1e-4) return 0; // on the surface or sunk into it
    let clearance = Infinity;
    for (const axis of AXES) {
      ray.set(point, direction.set(...axis)); ray.far = .5;
      const hit = ray.intersectObjects(envelope, false)[0];
      if (hit && hit.distance < clearance) clearance = hit.distance;
    }
    float = Math.min(float, clearance);
  }
  return float;
}
