import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from './mesh-merge.js';

// Fuses the static, anonymous, opaque meshes into one mesh per material and
// attribute signature, with each part's matrix baked into the geometry.
//
// The main pass covers root: a mesh is eligible only when it is a plain
// visible Mesh with a single opaque material, no name and no userData, and no
// ancestor up to root breaks those rules or appears in the caller's identity
// exclusion set (raycast blockers, door parts, animated or toggleable
// subtrees). Zones are static subtrees that tests look up by name (armory
// displays, rack weapons): their content merges within the zone itself, so
// group bounds and lookups are preserved, but each mesh must still be
// anonymous, untagged, visible and opaque itself. With `keepColors` a mesh
// whose geometry carries a `color` attribute merges with it (the signature
// gains a colour flag, so coloured and uncoloured parts never fuse).
export function mergeStaticMeshes(root, { excluded = new Set(), zones = [], keepColors = false } = {}) {
  root.updateMatrixWorld(true);
  const zoneSet = new Set(zones);
  let merged = 0, removed = 0;
  const mergeScope = (scope, relaxAncestors) => {
    const inverse = new THREE.Matrix4().copy(scope.matrixWorld).invert();
    const groups = new Map();
    const visit = (node, ancestorBlocked) => {
      if (node !== scope && zoneSet.has(node)) return; // nested zones merge themselves
      const blocked = ancestorBlocked || excluded.has(node) || !node.visible ||
        (!relaxAncestors && (node.name !== '' || Object.keys(node.userData).length > 0));
      const anonymous = node.name === '' && Object.keys(node.userData).length === 0;
      if (!blocked && anonymous && node.isMesh === true && !node.isInstancedMesh && !node.isSkinnedMesh) {
        const material = node.material;
        if (!Array.isArray(material) && material.transparent !== true) {
          const signature = `${material.uuid}:${node.geometry.attributes.uv ? 1 : 0}:${node.geometry.index ? 1 : 0}`
            + (keepColors ? `:${node.geometry.attributes.color ? 1 : 0}` : '');
          if (!groups.has(signature)) groups.set(signature, { material, meshes: [] });
          groups.get(signature).meshes.push(node);
        }
      }
      for (const child of node.children) visit(child, blocked);
    };
    visit(scope, false);
    for (const { material, meshes } of groups.values()) {
      if (meshes.length < 2) continue;
      const parts = meshes.map(mesh => ({ geometry: mesh.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld) }));
      const mesh = new THREE.Mesh(mergeGeometries(parts, { keepColors }), material);
      mesh.name = `staticMerge-${material.name || merged}`;
      merged++;
      mesh.userData.staticMerge = true;
      mesh.castShadow = meshes.some(part => part.castShadow);
      mesh.receiveShadow = meshes.some(part => part.receiveShadow);
      mesh.matrixAutoUpdate = false;
      scope.add(mesh);
      for (const part of meshes) part.removeFromParent();
      removed += meshes.length;
    }
  };
  mergeScope(root, false);
  for (const zone of zones) mergeScope(zone, true);
  root.updateMatrixWorld(true);
  return { merged, removed };
}
