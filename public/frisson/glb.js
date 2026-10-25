import * as THREE from '/vendor/three.module.js';

// A small reader for the Frisson heads GLB (art/frisson/DESIGN.md): the
// restricted layout our Blender scripts export, not glTF at large. One JSON
// and one BIN chunk; nodes without transforms; one indexed triangle primitive
// per mesh with POSITION, NORMAL and COLOR_0; plain materials. Anything else
// is refused with a message naming the offending part, so a bad export fails
// at load (and in the contract checker) instead of drawing something odd.

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const FLOAT = 5126, UBYTE = 5121, USHORT = 5123, UINT = 5125;
const COMPONENTS = { [UBYTE]: Uint8Array, [USHORT]: Uint16Array, [UINT]: Uint32Array, [FLOAT]: Float32Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const NORMALIZED = { [UBYTE]: 255, [USHORT]: 65535 };
const ATTRIBUTES = { POSITION: 'position', NORMAL: 'normal', COLOR_0: 'color' };
export const GLB_EXTENSIONS = Object.freeze(['KHR_materials_emissive_strength']);
// Top-level glTF properties the layout never uses.
const FORBIDDEN = ['animations', 'skins', 'cameras', 'textures', 'images', 'samplers'];
const NODE_KEYS = new Set(['name', 'children', 'mesh', 'translation', 'rotation', 'scale', 'matrix', 'extras']);
const IDENTITY = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const TEXTURES = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];

function fail(message) { throw new Error(`GLB: ${message}`); }
const exactly = (values, expected) => Array.isArray(values) && values.length === expected.length && values.every((value, index) => Math.abs(value - expected[index]) < 1e-6);
const whole = value => Number.isInteger(value) && value >= 0;
// The item of a glTF list at a whole-number index, or a clear refusal.
const itemAt = (list, index, what) => (whole(index) && Array.isArray(list) && list[index]) || fail(what);

function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return fail('expected an ArrayBuffer');
}

// Splits the container into its JSON document and its binary chunk.
export function readGlbChunks(input) {
  const bytes = bytesOf(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== MAGIC) fail('not a binary glTF file');
  if (view.getUint32(4, true) !== 2) fail(`version ${view.getUint32(4, true)}, expected 2`);
  if (view.getUint32(8, true) !== bytes.byteLength) fail(`header length ${view.getUint32(8, true)} for ${bytes.byteLength} bytes`);
  const chunks = [];
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) fail('truncated chunk header');
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > bytes.byteLength) fail('truncated chunk');
    chunks.push({ type, start: offset + 8, length });
    offset += 8 + length;
  }
  if (chunks.length !== 2 || chunks[0].type !== JSON_CHUNK || chunks[1].type !== BIN_CHUNK) fail('expected exactly a JSON chunk then a BIN chunk');
  let json;
  try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(chunks[0].start, chunks[0].start + chunks[0].length))); }
  catch (error) { fail(`unreadable JSON chunk (${error.message})`); }
  return { json, bin: bytes.subarray(chunks[1].start, chunks[1].start + chunks[1].length) };
}

// The whole file: { roots, nodes, meshes, materials, json }. Nodes are
// { name, mesh, children }; meshes { name, geometry, material } with a ready
// BufferGeometry (Float32 RGB vertex colours); materials keep their glTF name,
// linear base colour, emissive colour and intensity, roughness and metalness.
// Every refusal is an Error whose message starts with "GLB: ", even for JSON
// shapes no check names.
export function readGlb(input) {
  try { return readLayout(input); }
  catch (error) { throw String(error?.message).startsWith('GLB: ') ? error : new Error(`GLB: unreadable layout (${error?.message ?? error})`, { cause: error }); }
}

function readLayout(input) {
  const { json, bin } = readGlbChunks(input);
  if (json.asset?.version !== '2.0') fail(`asset version ${json.asset?.version}, expected 2.0`);
  if (json.extensionsRequired?.length) fail(`required extensions ${json.extensionsRequired.join(', ')}`);
  for (const name of json.extensionsUsed ?? []) if (!GLB_EXTENSIONS.includes(name)) fail(`extension ${name} is outside the layout`);
  for (const key of FORBIDDEN) if (json[key]?.length) fail(`${key} are not allowed`);
  if ((json.buffers?.length ?? 0) !== 1 || json.buffers[0].uri !== undefined) fail('expected one buffer: the BIN chunk');
  if (json.buffers[0].byteLength > bin.byteLength) fail('buffer longer than the BIN chunk');

  const accessorCache = new Map();
  const accessor = (index, what) => {
    const spec = itemAt(json.accessors, index, `${what}: accessor ${index} is missing`);
    if (spec.sparse) fail(`${what}: sparse accessors are not allowed`);
    const Type = COMPONENTS[spec.componentType], size = SIZES[spec.type];
    if (!Type || !size) fail(`${what}: unsupported accessor ${spec.componentType}/${spec.type}`);
    const view = itemAt(json.bufferViews, spec.bufferView, `${what}: bufferView ${spec.bufferView} is missing`);
    if ((view.buffer ?? 0) !== 0) fail(`${what}: bufferView ${spec.bufferView} is not in the BIN chunk`);
    if (![spec.count, spec.byteOffset ?? 0, view.byteOffset ?? 0, view.byteLength].every(whole) || !spec.count) fail(`${what}: count, offsets and lengths must be whole numbers`);
    const element = size * Type.BYTES_PER_ELEMENT;
    if (view.byteStride !== undefined && view.byteStride !== element) fail(`${what}: interleaved data is not allowed`);
    const start = (view.byteOffset ?? 0) + (spec.byteOffset ?? 0), length = spec.count * element;
    if ((spec.byteOffset ?? 0) + length > view.byteLength || start + length > bin.byteLength) fail(`${what}: data out of bounds`);
    // Copied out, so every array is aligned and owns its memory.
    const array = new Type(bin.slice(start, start + length).buffer);
    // NaN or infinite floats would pass every bound check and draw nothing.
    if (Type === Float32Array && !array.every(Number.isFinite)) fail(`${what}: non-finite value`);
    return { array, size, componentType: spec.componentType, normalized: spec.normalized === true, count: spec.count };
  };
  const cachedAccessor = (index, what) => {
    if (!accessorCache.has(index)) accessorCache.set(index, accessor(index, what));
    return accessorCache.get(index);
  };

  const materials = (json.materials ?? []).map((spec, index) => {
    const name = spec.name ?? `material ${index}`, pbr = spec.pbrMetallicRoughness ?? {};
    if (pbr.baseColorTexture || pbr.metallicRoughnessTexture || TEXTURES.some(key => spec[key])) fail(`material ${name}: textures are not allowed`);
    for (const extension of Object.keys(spec.extensions ?? {})) if (!GLB_EXTENSIONS.includes(extension)) fail(`material ${name}: extension ${extension} is outside the layout`);
    if ((spec.alphaMode ?? 'OPAQUE') !== 'OPAQUE') fail(`material ${name}: only opaque materials`);
    const base = pbr.baseColorFactor ?? [1, 1, 1, 1], emissive = spec.emissiveFactor ?? [0, 0, 0];
    const strength = spec.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1, roughness = pbr.roughnessFactor ?? 1, metalness = pbr.metallicFactor ?? 1;
    // JSON reads 1e999 as Infinity.
    if (!Array.isArray(base) || base.length !== 4 || !Array.isArray(emissive) || emissive.length !== 3 || ![...base, ...emissive, strength, roughness, metalness].every(Number.isFinite))
      fail(`material ${name}: factors must be finite numbers`);
    const [r, g, b] = base, [er, eg, eb] = emissive;
    return Object.freeze({
      name, color: new THREE.Color().setRGB(r, g, b), emissive: new THREE.Color().setRGB(er, eg, eb),
      emissiveIntensity: strength, roughness, metalness, doubleSided: spec.doubleSided === true,
    });
  });

  const meshes = (json.meshes ?? []).map((spec, index) => {
    const name = spec.name ?? `mesh ${index}`;
    if (spec.primitives?.length !== 1) fail(`mesh ${name}: exactly one primitive expected, found ${spec.primitives?.length ?? 0}`);
    const [primitive] = spec.primitives;
    if ((primitive.mode ?? 4) !== 4) fail(`mesh ${name}: triangles only`);
    if (primitive.targets?.length || spec.weights?.length) fail(`mesh ${name}: morph targets are not allowed`);
    if (primitive.extensions && Object.keys(primitive.extensions).length) fail(`mesh ${name}: primitive extensions are not allowed`);
    const geometry = new THREE.BufferGeometry();
    for (const [key, index] of Object.entries(primitive.attributes ?? {})) {
      const attribute = ATTRIBUTES[key];
      if (!attribute) fail(`mesh ${name}: attribute ${key} is outside the layout`);
      const data = cachedAccessor(index, `mesh ${name} ${key}`);
      if (key === 'COLOR_0') {
        if (data.size !== 3 && data.size !== 4) fail(`mesh ${name}: COLOR_0 must be VEC3 or VEC4`);
        const scale = data.componentType === FLOAT ? 1 : data.normalized ? NORMALIZED[data.componentType] : 0;
        if (!scale) fail(`mesh ${name}: COLOR_0 must be float or normalized`);
        // Plain RGB floats: an alpha channel would select another program.
        const rgb = new Float32Array(data.count * 3);
        for (let vertex = 0; vertex < data.count; vertex++) for (let channel = 0; channel < 3; channel++) rgb[vertex * 3 + channel] = data.array[vertex * data.size + channel] / scale;
        geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      } else {
        if (data.componentType !== FLOAT || data.size !== 3) fail(`mesh ${name}: ${key} must be float VEC3`);
        geometry.setAttribute(attribute, new THREE.BufferAttribute(data.array.slice(), 3));
      }
    }
    const position = geometry.attributes.position;
    if (!position) fail(`mesh ${name}: POSITION is missing`);
    for (const key of ['normal', 'color']) if (geometry.attributes[key] && geometry.attributes[key].count !== position.count) fail(`mesh ${name}: ${key} count differs from POSITION`);
    if (primitive.indices === undefined) fail(`mesh ${name}: indices are missing`);
    const indices = cachedAccessor(primitive.indices, `mesh ${name} indices`);
    if (indices.size !== 1 || (indices.componentType !== USHORT && indices.componentType !== UINT)) fail(`mesh ${name}: indices must be u16 or u32 scalars`);
    if (indices.count % 3) fail(`mesh ${name}: index count ${indices.count} is not a whole number of triangles`);
    for (const value of indices.array) if (value >= position.count) fail(`mesh ${name}: index ${value} past ${position.count} vertices`);
    geometry.setIndex(new THREE.BufferAttribute(indices.array.slice(), 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = primitive.material === undefined ? null : itemAt(materials, primitive.material, `mesh ${name}: material ${primitive.material} is missing`);
    return { name, geometry, material };
  });

  const nodes = (json.nodes ?? []).map((spec, index) => {
    const name = spec.name ?? `node ${index}`;
    if (typeof name !== 'string') fail(`node ${index}: its name must be a string`);
    for (const key of Object.keys(spec)) if (!NODE_KEYS.has(key)) fail(`node ${name}: ${key} is outside the layout`);
    for (const key of ['translation', 'rotation', 'scale', 'matrix']) if (spec[key] !== undefined && !exactly(spec[key], IDENTITY[key])) fail(`node ${name}: transforms must be applied (${key})`);
    const mesh = spec.mesh === undefined ? null : itemAt(meshes, spec.mesh, `node ${name}: mesh ${spec.mesh} is missing`);
    return { name, mesh, children: [] };
  });
  const parents = new Map();
  (json.nodes ?? []).forEach((spec, index) => {
    for (const child of spec.children ?? []) {
      itemAt(nodes, child, `node ${nodes[index].name}: child ${child} is missing`);
      if (parents.has(child) || child === index) fail(`node ${nodes[child].name} has two parents`);
      parents.set(child, index); nodes[index].children.push(nodes[child]);
    }
  });
  const scene = itemAt(json.scenes, json.scene ?? 0, 'no scene');
  const roots = (scene.nodes ?? []).map(index => itemAt(nodes, index, `scene node ${index} is missing`));
  for (const index of scene.nodes ?? []) if (parents.has(index)) fail(`scene root ${nodes[index].name} also has a parent`);
  return { roots, nodes, meshes, materials, json };
}
