// Writes small GLBs in the Frisson layout (art/frisson/DESIGN.md and
// BODIES.md) from plain arrays: root empties with mesh children, one indexed
// triangle primitive per mesh with POSITION, NORMAL and COLOR_0 (float RGB),
// plain materials named by the caller, no transforms. Deterministic: the
// same input always gives the same bytes. Used by the merge tool that builds
// the final heads and bodies (tools/frisson-glb-merge.mjs), the bodies
// placeholder generator (art/frisson/placeholder/) and tests.
//
// roots: [{ name, children: [{ name, material, positions, indices, colors?,
// normals? }] }]; positions, colors and normals are [[x, y, z]] lists or
// flat arrays. Without normals, smooth (area-weighted) normals are computed.
// options.materials lists the materials in order: a name gives a plain one
// (white, not metallic, options.roughness), an object is a whole glTF
// material written as given (the merge tool copies the proposals' eyes with
// their glow); extensionsUsed then lists the extensions the materials use.
// options.mutate(json) edits the JSON last and options.text(string) its text,
// so tests can break the layout on purpose.

const flat = list => (list.length && Array.isArray(list[0]) ? list.flat() : Array.from(list));
const pad = (buffer, fill = 0) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, fill)]);

// Area-weighted vertex normals of an indexed triangle list.
export function smoothNormals(positions, indices) {
  const normals = new Float64Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [indices[index] * 3, indices[index + 1] * 3, indices[index + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) { normals[vertex] += nx; normals[vertex + 1] += ny; normals[vertex + 2] += nz; }
  }
  const result = new Float32Array(positions.length);
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]) || 1;
    result[index] = normals[index] / length; result[index + 1] = normals[index + 1] / length; result[index + 2] = normals[index + 2] / length;
    if (!(length > 1e-12)) result[index + 1] = 1;
  }
  return result;
}

export function writeFrissonGlb(roots, { generator = 'frisson glb writer', materials: order = null, roughness = .9, mutate, text: editText } = {}) {
  const chunks = [], bufferViews = [], accessors = [], nodes = [], meshes = [], rootIndices = [];
  const given = new Map((order ?? []).filter(entry => typeof entry === 'object').map(entry => [entry.name, entry]));
  const materialNames = order ? order.map(entry => (typeof entry === 'object' ? entry.name : entry)) : [];
  let offset = 0;
  const view = (data, target) => {
    const bytes = pad(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, target });
    chunks.push(bytes); offset += bytes.length;
    return bufferViews.length - 1;
  };
  const accessor = spec => { accessors.push(spec); return accessors.length - 1; };
  for (const root of roots) {
    const children = [];
    for (const child of root.children ?? []) {
      const positions = Float32Array.from(flat(child.positions)), indices = flat(child.indices), count = positions.length / 3;
      if (!materialNames.includes(child.material)) materialNames.push(child.material);
      const min = [0, 1, 2].map(axis => { let value = Infinity; for (let index = axis; index < positions.length; index += 3) value = Math.min(value, positions[index]); return value; });
      const max = [0, 1, 2].map(axis => { let value = -Infinity; for (let index = axis; index < positions.length; index += 3) value = Math.max(value, positions[index]); return value; });
      const attributes = { POSITION: accessor({ bufferView: view(positions, 34962), componentType: 5126, count, type: 'VEC3', min, max }) };
      const normals = child.normals ? Float32Array.from(flat(child.normals)) : smoothNormals(positions, indices);
      attributes.NORMAL = accessor({ bufferView: view(normals, 34962), componentType: 5126, count, type: 'VEC3' });
      if (child.colors) attributes.COLOR_0 = accessor({ bufferView: view(Float32Array.from(flat(child.colors)), 34962), componentType: 5126, count, type: 'VEC3' });
      const Indices = count > 65535 ? Uint32Array : Uint16Array;
      const index = accessor({ bufferView: view(Indices.from(indices), 34963), componentType: count > 65535 ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
      meshes.push({ name: child.name, primitives: [{ attributes, indices: index, material: materialNames.indexOf(child.material) }] });
      nodes.push({ name: child.name, mesh: meshes.length - 1 });
      children.push(nodes.length - 1);
    }
    nodes.push({ name: root.name, children });
    rootIndices.push(nodes.length - 1);
  }
  const materials = materialNames.map(name => (given.has(name) ? structuredClone(given.get(name))
    : { name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: roughness } }));
  const extensions = [...new Set(materials.flatMap(material => Object.keys(material.extensions ?? {})))].sort();
  const bin = Buffer.concat(chunks);
  const json = { asset: { version: '2.0', generator }, ...(extensions.length ? { extensionsUsed: extensions } : {}), scene: 0, scenes: [{ nodes: rootIndices }], nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
  mutate?.(json);
  const jsonBytes = pad(Buffer.from(editText ? editText(JSON.stringify(json)) : JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32LE(data.length, 0); head.writeUInt32LE(type, 4); return Buffer.concat([head, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonBytes), chunk(0x004e4942, bin)]);
}
