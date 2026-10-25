import * as THREE from '/vendor/three.module.js';

// Merges small primitives into one BufferGeometry, so a rigid part (a
// zombie's torso, a rack, a fence) costs one draw call instead of dozens.
// Each part is { geometry, matrix?, color? }. Positions and normals are baked
// with the part matrix; an optional colour becomes a vertex colour, uvs are
// kept only when every part has them. With `keepColors`, a part without an
// explicit colour copies its geometry's rgb `color` attribute instead of
// white. Source geometries are left untouched (and are disposed when
// `dispose` is set).
export function mergeGeometries(parts, { dispose = false, keepColors = false } = {}) {
  const usable = parts.filter(part => part?.geometry?.attributes?.position);
  const merged = new THREE.BufferGeometry();
  if (!usable.length) return merged;
  const withColor = usable.some(part => (part.color !== undefined && part.color !== null)
    || (keepColors && part.geometry.attributes.color?.itemSize === 3));
  const withUv = usable.every(part => part.geometry.attributes.uv);
  let vertexCount = 0, indexCount = 0;
  for (const { geometry } of usable) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
  const colors = withColor ? new Float32Array(vertexCount * 3) : null, uvs = withUv ? new Float32Array(vertexCount * 2) : null;
  const indices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(indexCount);
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3(), color = new THREE.Color();
  let vertexOffset = 0, indexOffset = 0;
  for (const part of usable) {
    const { geometry } = part, matrix = part.matrix ?? IDENTITY;
    const position = geometry.attributes.position, sourceNormal = geometry.attributes.normal, uv = geometry.attributes.uv;
    // An explicit part colour wins; keepColors falls back to the geometry's.
    const vertexColors = keepColors && (part.color === undefined || part.color === null) && geometry.attributes.color?.itemSize === 3
      ? geometry.attributes.color : null;
    normalMatrix.getNormalMatrix(matrix);
    // A mirrored matrix flips the winding; swap two indices to keep faces outward.
    const mirrored = matrix.determinant() < 0;
    if (withColor && !vertexColors) color.set(part.color ?? 0xffffff);
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(matrix);
      point.toArray(positions, (vertexOffset + index) * 3);
      if (sourceNormal) normal.fromBufferAttribute(sourceNormal, index).applyMatrix3(normalMatrix).normalize();
      else normal.set(0, 1, 0);
      normal.toArray(normals, (vertexOffset + index) * 3);
      if (colors) {
        const target = (vertexOffset + index) * 3;
        if (vertexColors) { colors[target] = vertexColors.getX(index); colors[target + 1] = vertexColors.getY(index); colors[target + 2] = vertexColors.getZ(index); }
        else color.toArray(colors, target);
      }
      if (uvs) { uvs[(vertexOffset + index) * 2] = uv.getX(index); uvs[(vertexOffset + index) * 2 + 1] = uv.getY(index); }
    }
    const count = geometry.index ? geometry.index.count : position.count;
    for (let index = 0; index < count; index += 3) {
      const read = offset => vertexOffset + (geometry.index ? geometry.index.getX(index + offset) : index + offset);
      indices[indexOffset + index] = read(0);
      indices[indexOffset + index + 1] = read(mirrored ? 2 : 1);
      indices[indexOffset + index + 2] = read(mirrored ? 1 : 2);
    }
    vertexOffset += position.count; indexOffset += count;
    if (dispose) geometry.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (colors) merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}
const IDENTITY = new THREE.Matrix4();

// Collects primitives for one rigid part, then builds a single mesh.
// `place` takes a position, an optional rotation (Euler XYZ) and scale.
export class PartBuilder {
  constructor() { this.parts = []; }
  add(geometry, color, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    this.parts.push({ geometry, color, matrix });
    return this;
  }
  get empty() { return this.parts.length === 0; }
  // Source primitives are usually shared, cached templates: never disposed.
  build(material, name) {
    const mesh = new THREE.Mesh(mergeGeometries(this.parts), material);
    if (name) mesh.name = name;
    return mesh;
  }
}
