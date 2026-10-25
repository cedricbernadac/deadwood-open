// Writes small GLBs in the Frisson heads layout (art/frisson/DESIGN.md) for
// tests: any number of heads, an optional boss, and hooks to break the layout
// on purpose. Each head is an octahedron skull with grey vertex colours, a
// red box mouth and two bead eyes in front (-Z).

const octahedron = (rx, ry, rz, cx = 0, cy = 0, cz = 0) => ({
  positions: [[rx, 0, 0], [-rx, 0, 0], [0, ry, 0], [0, -ry, 0], [0, 0, rz], [0, 0, -rz]].map(([x, y, z]) => [x + cx, y + cy, z + cz]),
  indices: [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5],
});
const merge = (...shapes) => {
  const positions = [], indices = [];
  for (const shape of shapes) { const base = positions.length; positions.push(...shape.positions); indices.push(...shape.indices.map(index => index + base)); }
  return { positions, indices };
};

export function headParts({ top = .22, grey = .7, mouth = [.55, .05, .06] } = {}) {
  const skin = octahedron(.18, top, .2, 0, 0, 0);
  const detail = octahedron(.05, .02, .02, 0, -.1, -.19);
  const eyes = merge(octahedron(.02, .012, .01, -.07, .03, -.17), octahedron(.02, .012, .01, .07, .03, -.17));
  return {
    Skin: { ...skin, colors: skin.positions.map(() => [grey, grey, grey]), material: 'skin' },
    Detail: { ...detail, colors: detail.positions.map(() => mouth), material: 'detail' },
    Eyes: { ...eyes, material: 'eyes' },
  };
}

const pad = (buffer, fill = 0) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, fill)]);

// heads: [{ name, parts = headParts() }]; a part may carry normals. options.
// indexType 'u16' | 'u32' | 'u8'; options.color 'f32' | 'u16n4'; options.
// mutate(json) edits the JSON last and options.text(string) its text (to
// break the layout).
export function buildHeadsGlb(heads, { indexType = 'u16', color = 'f32', mutate, text: editText } = {}) {
  const chunks = [], bufferViews = [], accessors = [], nodes = [], meshes = [], rootIndices = [];
  let offset = 0;
  const materialNames = ['skin', 'detail', 'eyes'];
  const materials = materialNames.map(name => ({ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .85 },
    ...(name === 'eyes' ? { emissiveFactor: [1, .3, .05], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } } } : {}) }));
  const view = (data, target) => {
    const bytes = pad(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, target });
    chunks.push(bytes); offset += bytes.length;
    return bufferViews.length - 1;
  };
  const accessor = spec => { accessors.push(spec); return accessors.length - 1; };
  for (const { name, parts = headParts() } of heads) {
    const children = [];
    for (const [part, data] of Object.entries(parts)) {
      const flat = Float32Array.from(data.positions.flat());
      const min = [0, 1, 2].map(axis => Math.min(...data.positions.map(point => point[axis])));
      const max = [0, 1, 2].map(axis => Math.max(...data.positions.map(point => point[axis])));
      const attributes = { POSITION: accessor({ bufferView: view(flat, 34962), componentType: 5126, count: data.positions.length, type: 'VEC3', min, max }) };
      if (data.normals) attributes.NORMAL = accessor({ bufferView: view(Float32Array.from(data.normals.flat()), 34962), componentType: 5126, count: data.normals.length, type: 'VEC3' });
      if (data.colors) {
        attributes.COLOR_0 = color === 'u16n4'
          ? accessor({ bufferView: view(Uint16Array.from(data.colors.flatMap(([r, g, b]) => [r, g, b, 1].map(value => Math.round(value * 65535)))), 34962), componentType: 5123, normalized: true, count: data.colors.length, type: 'VEC4' })
          : accessor({ bufferView: view(Float32Array.from(data.colors.flat()), 34962), componentType: 5126, count: data.colors.length, type: 'VEC3' });
      }
      const Indices = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array }[indexType];
      const indices = accessor({ bufferView: view(Indices.from(data.indices), 34963), componentType: { u8: 5121, u16: 5123, u32: 5125 }[indexType], count: data.indices.length, type: 'SCALAR' });
      meshes.push({ name: `${name}_${part}`, primitives: [{ attributes, indices, material: materialNames.indexOf(data.material) }] });
      nodes.push({ name: `${name}_${part}`, mesh: meshes.length - 1 });
      children.push(nodes.length - 1);
    }
    nodes.push({ name, children });
    rootIndices.push(nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  const json = { asset: { version: '2.0', generator: 'frisson-heads test' }, extensionsUsed: ['KHR_materials_emissive_strength'], scene: 0, scenes: [{ nodes: rootIndices }],
    nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
  mutate?.(json);
  const text = pad(Buffer.from(editText ? editText(JSON.stringify(json)) : JSON.stringify(json)), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32LE(data.length, 0); head.writeUInt32LE(type, 4); return Buffer.concat([head, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, bin)]);
}

export const namedHeads = (count, { boss = false } = {}) => [
  ...Array.from({ length: count }, (_, index) => ({ name: `FrissonHead_Test${index}` })),
  ...(boss ? [{ name: 'FrissonHead_Boss', parts: headParts({ top: .2, grey: .5 }) }] : []),
];
