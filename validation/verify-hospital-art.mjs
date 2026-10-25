// Read-only integrity and contract inspection of the real hospital GLB.
// Run: node validation/verify-hospital-art.mjs [validation/kimi-hospital/hospital-art-verification.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { scanCoplanar } from './hospital-coplanarity.mjs';
import { loadGlbTriangles } from './hospital-props-audit.mjs';
import { auditContacts } from './hospital-contact.mjs';

process.env.DEADWOOD_LEVEL = 'hospital';
const { LEVEL } = await import('../public/level-config.js');
const { WINDOWS } = await import('../public/layout.js');
const { SPACE, spaceTreadY } = await import('../public/level-space.js');
const { ARMORY, armoryRackBounds } = await import('../public/rules.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const art = resolve(root, 'art/levels/hospital');
const path = resolve(root, 'public/levels/hospital.glb');
const output = resolve(process.argv[2] ?? resolve(root, 'validation/kimi-hospital/hospital-art-verification.json'));
const bytes = readFileSync(path), hash = data => createHash('sha256').update(data).digest('hex');
const checks = [];
function check(name, passed, detail = {}) { checks.push({ name, passed: Boolean(passed), ...detail }); }

if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB header');
const jsonLength = bytes.readUInt32LE(12);
if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) throw Error('Invalid GLB JSON chunk');
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryOffset = 20 + jsonLength, binaryLength = bytes.readUInt32LE(binaryOffset);
if (bytes.readUInt32LE(binaryOffset + 4) !== 0x004e4942 || binaryOffset + 8 + binaryLength > bytes.length) throw Error('Invalid GLB binary chunk');
const binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
const stats = JSON.parse(readFileSync(resolve(art, 'stats.json'), 'utf8'));
check('GLB chunk lengths and buffer declaration are coherent', json.buffers?.length === 1 && json.buffers[0].byteLength <= binaryLength && json.buffers[0].byteLength >= binaryLength - 3,
  { fileBytes: bytes.length, jsonBytes: jsonLength, binaryBytes: binaryLength, declaredBufferBytes: json.buffers?.[0]?.byteLength });
check('every bufferView lies inside the binary chunk', (json.bufferViews ?? []).every(view => (view.byteOffset ?? 0) >= 0 && view.byteLength > 0 && (view.byteOffset ?? 0) + view.byteLength <= binary.length));

function accessor(index) {
  const spec = json.accessors[index], view = json.bufferViews[spec.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[spec.type];
  const width = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[spec.componentType];
  const method = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8' }[spec.componentType];
  if (!size || !width || !method || spec.normalized) throw Error('Unsupported or normalized accessor ' + index);
  const stride = view.byteStride ?? size * width, start = (view.byteOffset ?? 0) + (spec.byteOffset ?? 0);
  if (start < 0 || start + (spec.count - 1) * stride + size * width > binary.length) throw Error('Accessor outside binary chunk ' + index);
  return Array.from({ length: spec.count }, (_, row) => Array.from({ length: size }, (_, component) => binary[method](start + row * stride + component * width)));
}

const totals = { meshes: json.meshes.length, drawCalls: 0, materials: json.materials.length, positions: 0, normals: 0, triangles: 0,
  nonfinite: 0, nonunitNormals: 0, invertedWinding: 0, degenerateTriangles: 0, invalidIndices: 0 };
const allMeshes = [], built = json.meshes.map(mesh => mesh.primitives.map(primitive => {
  totals.drawCalls++;
  if ((primitive.mode ?? 4) !== 4) throw Error('Non-triangle primitive');
  if (primitive.attributes.POSITION === undefined || primitive.attributes.NORMAL === undefined || primitive.indices === undefined) throw Error('Missing position, normal or index accessor');
  const positions = accessor(primitive.attributes.POSITION), normals = accessor(primitive.attributes.NORMAL), indices = accessor(primitive.indices).flat();
  if (positions.length !== normals.length || indices.length % 3) throw Error('Inconsistent primitive accessors');
  totals.positions += positions.length; totals.normals += normals.length; totals.triangles += indices.length / 3;
  totals.nonfinite += positions.concat(normals).filter(row => row.some(value => !Number.isFinite(value))).length;
  totals.nonunitNormals += normals.filter(row => Math.abs(row.reduce((sum, value) => sum + value * value, 0) - 1) > 1e-3).length;
  totals.invalidIndices += indices.filter(index => !Number.isInteger(index) || index < 0 || index >= positions.length).length;
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = indices.slice(index, index + 3).map(point => positions[point]);
    if (!a || !b || !c) continue;
    const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], normal = normals[indices[index]];
    if (cross.reduce((sum, value) => sum + value * value, 0) < 1e-18) totals.degenerateTriangles++;
    else if (cross.reduce((sum, value, axis) => sum + value * normal[axis], 0) < 0) totals.invertedWinding++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.flat()), 3)); geometry.setIndex(indices);
  return { geometry, material: json.materials[primitive.material]?.name ?? '' };
}));
const objects = json.nodes.map(node => {
  const object = new THREE.Group(); object.name = node.name ?? '';
  if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale); }
  else { if (node.translation) object.position.fromArray(node.translation); if (node.rotation) object.quaternion.fromArray(node.rotation); if (node.scale) object.scale.fromArray(node.scale); }
  if (node.mesh !== undefined) for (const primitive of built[node.mesh]) {
    const mesh = new THREE.Mesh(primitive.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.name = object.name + ':' + primitive.material; mesh.userData.material = primitive.material; object.add(mesh); allMeshes.push(mesh);
  }
  return object;
});
for (const [index, node] of json.nodes.entries()) for (const child of node.children ?? []) objects[index].add(objects[child]);
const scene = new THREE.Group(); for (const index of json.scenes[json.scene ?? 0].nodes) scene.add(objects[index]); scene.updateMatrixWorld(true);
function segment(name, from, to, expectedBlocked, expectedY = null, tolerance = 1e-4) {
  const origin = new THREE.Vector3(...from), direction = new THREE.Vector3(...to).sub(origin), length = direction.length();
  const ray = new THREE.Raycaster(origin, direction.normalize(), 0, Math.max(0, length - 1e-5)), hit = ray.intersectObjects(allMeshes, false)[0];
  const passed = Boolean(hit) === expectedBlocked && (expectedY == null || hit && Math.abs(hit.point.y - expectedY) <= tolerance);
  check(name, passed, { from, to, expectedBlocked, ...(expectedY == null ? {} : { expectedY, tolerance }), actual: hit ? {
    point: hit.point.toArray().map(value => Number(value.toFixed(6))), distance: Number(hit.distance.toFixed(6)), mesh: hit.object.name,
  } : null });
}

check('finite positions and normals', totals.nonfinite === 0, { nonfinite: totals.nonfinite });
check('unit normals', totals.nonunitNormals === 0, { nonunitNormals: totals.nonunitNormals });
check('all indices reference existing vertices', totals.invalidIndices === 0, { invalidIndices: totals.invalidIndices });
check('triangle winding agrees with normals', totals.invertedWinding === 0, { invertedWinding: totals.invertedWinding });
check('no degenerate exported triangles', totals.degenerateTriangles === 0, { degenerateTriangles: totals.degenerateTriangles });
check('export counts match source stats', totals.triangles === stats.triangles && totals.meshes === stats.meshes && totals.drawCalls === stats.drawCalls && totals.materials === stats.materials,
  { actual: { triangles: totals.triangles, meshes: totals.meshes, drawCalls: totals.drawCalls, materials: totals.materials },
    declared: { triangles: stats.triangles, meshes: stats.meshes, drawCalls: stats.drawCalls, materials: stats.materials } });
check('triangle and draw-call budgets (whole map under 200,000, about 90 draw calls)', totals.triangles < 200000 && totals.drawCalls <= 90, { triangles: totals.triangles, drawCalls: totals.drawCalls, triangleLimitExclusive: 200000, drawCallTarget: 90 });
check('architecture share under 120,000 triangles (props session counted apart)', Number.isInteger(stats.architectureTriangles) && stats.architectureTriangles < 120000
  && stats.architectureTriangles + stats.propTriangles === stats.sourceTriangles, { architectureTriangles: stats.architectureTriangles, propTriangles: stats.propTriangles, sourceTriangles: stats.sourceTriangles });

const images = json.images.map(image => {
  const view = json.bufferViews[image.bufferView], embedded = image.bufferView !== undefined && !image.uri;
  const png = embedded ? binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) : Buffer.alloc(0);
  const signature = png.length >= 8 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const validPng = signature && png.length >= 45 && png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0 && png.toString('ascii', png.length - 8, png.length - 4) === 'IEND';
  return { name: image.name ?? null, mimeType: image.mimeType, embedded, bytes: view?.byteLength ?? 0, validPng,
    width: validPng ? png.readUInt32BE(16) : 0, height: validPng ? png.readUInt32BE(20) : 0 };
});
check('all textures are nonempty embedded PNG files', images.length >= 20 && images.every(image => image.embedded && image.bytes > 0 && image.validPng && image.mimeType === 'image/png'), { images });
check('all material factors are finite and bounded', json.materials.every(material => [...(material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]), ...(material.emissiveFactor ?? [0, 0, 0])]
  .every(value => Number.isFinite(value) && value >= 0 && value <= 1)));
check('no runtime lights or cameras baked into model', !(json.cameras?.length) && !(json.extensions?.KHR_lights_punctual?.lights?.length));
const requiredMaterials = ['Fluorescent_cold', 'Fluorescent_flicker', 'Fluorescent_aged', 'Warm_lens', 'Emergency_amber', 'Exit_glow',
  'Sign_glow', 'Sign_dead', 'Sign_flicker', 'Lamp_sodium', 'Lamp_sodium_flicker', 'Lamp_pool', 'Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow'];
const materialNames = new Set(json.materials.map(material => material.name));
check('loader-compatible emissive and decal materials exist', requiredMaterials.every(name => materialNames.has(name)), { requiredMaterials, missing: requiredMaterials.filter(name => !materialNames.has(name)) });
check('family-safe material and image names', ![...materialNames, ...images.map(image => image.name ?? '')].some(name => /blood|gore|organ|syringe|corpse|cadaver/i.test(name)));

const roofIndex = json.nodes.findIndex(node => node.name === 'Roof');
const meshNodeStates = [];
function visit(index, inRoof = false) {
  const node = json.nodes[index], roof = inRoof || index === roofIndex;
  if (node.mesh !== undefined) meshNodeStates.push({ name: node.name ?? '', roof });
  for (const child of node.children ?? []) visit(child, roof);
}
for (const index of json.scenes[json.scene ?? 0].nodes) visit(index);
check('Roof is a separate populated subtree', roofIndex >= 0 && (json.nodes[roofIndex].children?.length ?? 0) > 0 && meshNodeStates.some(node => node.roof));
check('all batches use Hospital__ except Roof__ inside Roof', meshNodeStates.every(node => node.roof ? node.name.startsWith('Roof__') : node.name.startsWith('Hospital__')), { invalid: meshNodeStates.filter(node => !(node.roof ? node.name.startsWith('Roof__') : node.name.startsWith('Hospital__'))) });

// Match Python's canonical JSON hashing while retaining authored numeric literals.
const configSource = readFileSync(resolve(root, 'public/level-config.js'), 'utf8');
const configLiteral = configSource.split('export const LEVELS = freeze(')[1].split(');\nexport const LEVEL_IDS')[0];
class NumericLiteral { constructor(source) { this.source = source; } }
const numberTree = JSON.parse(configLiteral, (key, value, context) => typeof value === 'number' ? new NumericLiteral(context?.source ?? String(value)) : value).hospital;
const asciiString = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
function canonical(value) {
  if (value instanceof NumericLiteral) return value.source;
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => asciiString(key) + ':' + canonical(value[key])).join(',') + '}';
  return typeof value === 'string' ? asciiString(value) : JSON.stringify(value);
}
const contractSha256 = hash(canonical(numberTree)), sceneExtras = json.scenes[json.scene ?? 0].extras ?? {};
check('export was built against this exact level contract', stats.collisionContractSha256 === contractSha256 && sceneExtras.collision_contract_sha256 === contractSha256,
  { expected: contractSha256, sourceStats: stats.collisionContractSha256 ?? null, embeddedScene: sceneExtras.collision_contract_sha256 ?? null });
const spaceBytes = readFileSync(resolve(art, 'space-contract.json')), spaceSha256 = hash(spaceBytes);
check('Blender space JSON equals the live physics contract', JSON.stringify(JSON.parse(spaceBytes)) === JSON.stringify(SPACE) && JSON.stringify(stats.spaceContract) === JSON.stringify(SPACE));
check('export was built against the exact multi-floor contract', stats.spaceContractSha256 === spaceSha256 && sceneExtras.space_contract_sha256 === spaceSha256,
  { expected: spaceSha256, sourceStats: stats.spaceContractSha256, embeddedScene: sceneExtras.space_contract_sha256 });

for (const window of WINDOWS) {
  const sign = Math.sign(window.fixed), along = window.center, y = (window.bottom + window.top) / 2;
  const from = window.axis === 'x' ? [along, y, window.fixed - sign] : [window.fixed - sign, y, along];
  const to = window.axis === 'x' ? [along, y, window.fixed + sign] : [window.fixed + sign, y, along];
  segment(`${window.id}: ${window.open ? 'open window' : 'closed wall'}`, from, to, !window.open);
}
for (const door of LEVEL.doors) segment(`${door.id}: empty doorway for dynamic barricade`, [door.x - door.outX, 1.8, door.z - door.outZ], [door.x + door.outX, 1.8, door.z + door.outZ], false);
for (const section of SPACE.facadeSections) {
  const x = (section.minX + section.maxX) / 2, z = (section.minZ + section.maxZ) / 2, y = (section.minY + section.maxY) / 2;
  const vertical = section.wallId === 'north' || section.wallId === 'south';
  segment(`${section.id}: exact facade solid`, vertical ? [x, y, z - .5] : [x - .5, y, z], vertical ? [x, y, z + .5] : [x + .5, y, z], true);
}
for (const flight of SPACE.flights) {
  const x = (flight.minX + flight.maxX) / 2;
  segment(flight.id + ': open stairwell', [x, .12, (flight.minZ + flight.maxZ) / 2], [x, -.3, (flight.minZ + flight.maxZ) / 2], false);
  for (let i = 0; i < flight.steps; i++) {
    const z = flight.minZ + (i + .5) * (flight.maxZ - flight.minZ) / flight.steps, y = spaceTreadY(flight, z);
    segment(flight.id + ': tread ' + (i + 1), [x, y + .07, z], [x, y - .2, z], true, y, .012);
  }
}
for (const wall of SPACE.walls.filter(item => item.id.startsWith('cellar-'))) {
  const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2, y = wall.baseY + wall.height / 2;
  if (wall.id.endsWith('west') || wall.id.endsWith('east')) segment(wall.id + ': cellar retaining wall', [x - .5, y, z], [x + .5, y, z], true);
  else segment(wall.id + ': cellar retaining wall', [x, y, z - .5], [x, y, z + .5], true);
}
// Real rooms: every partition piece and lintel is solid where the contract
// says, every doorway is clear, the suspended ceiling is at 3.2 m over the
// rooms and open over both stair wells.
const across = (wall, y) => {
  const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2;
  return wall.maxX - wall.minX >= wall.maxZ - wall.minZ ? [[x, y, wall.minZ - .3], [x, y, wall.maxZ + .3]] : [[wall.minX - .3, y, z], [wall.maxX + .3, y, z]];
};
const partitions = SPACE.walls.filter(item => item.id.startsWith('room-') || item.id.startsWith('hall-'));
for (const wall of partitions) {
  const y = wall.id.includes('-lintel-') ? wall.baseY + wall.height / 2 : wall.baseY + Math.min(wall.height / 2, .6);
  segment(`${wall.id}: partition solid`, ...across(wall, y), true);
}
const ROOMS = SPACE.rooms ?? [];
check('SPACE.rooms lists the nine real rooms', ROOMS.length === 9 && ROOMS.every(room => room.doors.length >= 1), { rooms: ROOMS.map(room => room.id) });
for (const room of ROOMS) for (const door of room.doors) {
  const y = door.floorY + 1.6, w = door.width / 2 - .25;
  for (const along of [-w, 0, w]) {
    const [x, z] = door.axis === 'x' ? [door.x + along, door.z] : [door.x, door.z + along];
    segment(`${room.id}/${door.id}: clear doorway (${along.toFixed(2)})`, door.axis === 'x' ? [x, y, z - .4] : [x - .4, y, z], door.axis === 'x' ? [x, y, z + .4] : [x + .4, y, z], false);
  }
}
const ceiling = SPACE.slabs.filter(slab => slab.id.startsWith('ceiling-'));
check('ceiling slabs cover the ground floor except both stair wells', ceiling.length > 0 && ceiling.every(slab => slab.minY === 3.2)
  && SPACE.holes.every(hole => !ceiling.some(slab => slab.minX < hole.maxX && slab.maxX > hole.minX && slab.minZ < hole.maxZ && slab.maxZ > hole.minZ)), { pieces: ceiling.length });
for (const room of ROOMS.filter(item => item.floor === 'ground')) {
  segment(`${room.id}: suspended ceiling at 3.2 m`, [room.target.x, 1.6, room.target.z], [room.target.x, 3.5, room.target.z], true, 3.2, .003);
}
for (const [index, hole] of SPACE.holes.entries()) {
  const x = (hole.minX + hole.maxX) / 2, z = (hole.minZ + hole.maxZ) / 2;
  segment(`stair well ${index}: light shaft open above the ceiling`, [x, 1.2, z], [x, 5.6, z], false);
}
const canopyEntrance = SPACE.slabs.find(slab => slab.id === 'entrance-canopy') ?? { minX: -3.4, maxX: 3.4, minZ: -17.75, maxZ: -15.135, minY: 3 };
segment('entrance canopy exact underside', [(canopyEntrance.minX + canopyEntrance.maxX) / 2, 2.6, (canopyEntrance.minZ + canopyEntrance.maxZ) / 2], [(canopyEntrance.minX + canopyEntrance.maxX) / 2, 3.4, (canopyEntrance.minZ + canopyEntrance.maxZ) / 2], true, canopyEntrance.minY, .012);
check('entrance canopy is also a rain shelter', SPACE.shelters.some(shelter => shelter.id === 'entrance-canopy'));
// Windows sit on the real facade openings (layout.js scales the supermarket's
// centres): stone surround and sill outside, painted surround inside, a
// stripped frame lining each open hole, boards and dark glass on the closed.
const HALF_T = .135, OUTER = .147;
const wallPoint = (window, along, y, n) => {
  const out = Math.sign(window.fixed);
  return window.axis === 'x' ? [along, y, window.fixed + out * n] : [window.fixed + out * n, y, along];
};
const wallHit = (name, window, along, y, from, to, expected) => {
  const origin = wallPoint(window, along, y, from), end = wallPoint(window, along, y, to);
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...end).sub(o), length = d.length();
  const hit = new THREE.Raycaster(o, d.normalize(), 0, length).intersectObjects(allMeshes, false)[0];
  const out = Math.sign(window.fixed), n = hit ? ((window.axis === 'x' ? hit.point.z : hit.point.x) - window.fixed) * out : null;
  check(name, hit && Math.abs(n - expected) <= .003, { from: origin, to: end, expectedOffset: expected, actualOffset: n === null ? null : Number(n.toFixed(4)), mesh: hit?.object.name ?? null });
};
for (const window of WINDOWS) {
  const c = window.center, h = window.width / 2;
  for (const side of [-1, 1]) {
    wallHit(`${window.id}: outer surround beside the opening (${side})`, window, c + side * (h + .05), 1.9, 1, 0, OUTER + .04);
    wallHit(`${window.id}: inner surround beside the opening (${side})`, window, c + side * (h + .05), 1.9, -1, 0, -(HALF_T + .012 + .03));
  }
  segment(`${window.id}: outer sill under the opening`, wallPoint(window, c, 1.4, OUTER + .03), wallPoint(window, c, .9, OUTER + .03), true, window.bottom - .004, .003);
  if (window.open) {
    for (const side of [-1, 1]) segment(`${window.id}: stripped frame lines the reveal (${side})`, wallPoint(window, c + side * (h - .03), 1.9, -.5), wallPoint(window, c + side * (h - .03), 1.9, .5), true);
  } else {
    wallHit(`${window.id}: boards outside the closed window`, window, c, 1.36, 1, 0, OUTER + .028);
    wallHit(`${window.id}: dark glass inside the closed window`, window, c, 1.9, -1, 0, -(HALF_T + .015));
  }
}
const rackOverWindow = [];
for (const rack of ARMORY) {
  const b = armoryRackBounds(rack);
  for (const window of WINDOWS) {
    const lo = window.axis === 'x' ? b.minX : b.minZ, hi = window.axis === 'x' ? b.maxX : b.maxZ;
    const near = window.axis === 'x' ? Math.abs((b.minZ + b.maxZ) / 2 - window.fixed) < .6 : Math.abs((b.minX + b.maxX) / 2 - window.fixed) < .6;
    if (near && rack.y === 0 && lo < window.center + window.width / 2 + .1 && hi > window.center - window.width / 2 - .1) rackOverWindow.push({ rack: rack.id, window: window.id });
  }
}
check('no armory rack hangs over a window', rackOverWindow.length === 0, { rackOverWindow });
for (const rail of SPACE.rails) {
  const x = (rail.minX + rail.maxX) / 2, z = (rail.minZ + rail.maxZ) / 2, y = rail.baseY + rail.height / 2;
  if (rail.id.endsWith('low-end')) segment(rail.id + ': stair end protection', [x, y, z - .3], [x, y, z + .3], true);
  else segment(rail.id + ': stair side protection', [x - .3, y, z], [x + .3, y, z], true);
}
segment('cellar actual floor', [0, -3.15, 0], [0, -3.65, 0], true, -3.39, .015);
segment('cellar slab overhead', [0, -.5, 0], [0, .2, 0], true, -.24, .012);
segment('hospital roof', [0, 6.1, 5], [0, 6.7, 5], true, 6.26, .012);
segment('facade top stays under the roof membrane', [19.0, 6.6, 0], [19.0, 6.45, 0], true, 6.5, .002);
const canopy = SPACE.slabs.find(slab => slab.id === 'ambulance-bay-canopy');
segment('ambulance canopy exact underside', [(canopy.minX + canopy.maxX) / 2, 3.0, 0], [(canopy.minX + canopy.maxX) / 2, 3.6, 0], true, canopy.minY, .012);
check('ambulance canopy is also a rain shelter', SPACE.shelters.some(shelter => shelter.id === 'ambulance-bay-canopy' && ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY'].every(key => shelter[key] === canopy[key])));
// The bus shelter: a roof slab over an open front, its seat a slab too.
const busRoof = SPACE.slabs.find(slab => slab.id === 'bus-shelter-east-roof'), busSeat = SPACE.slabs.find(slab => slab.id === 'bus-shelter-east-seat');
const busX = (busRoof.minX + busRoof.maxX) / 2, busFront = (busSeat.maxZ + busRoof.maxZ) / 2;
segment('bus shelter roof exact underside over the open front', [busX, 1.2, busFront], [busX, 2.9, busFront], true, busRoof.minY, .006);
segment('bus shelter front stays open at body height', [busX, 1.2, busRoof.maxZ + .3], [busX, 1.2, busSeat.maxZ + .05], false);
segment('bus shelter west end stays open at body height', [busRoof.minX - .3, 1.2, busFront], [busSeat.minX + .3, 1.2, busFront], false);
segment('bus shelter bench seat at the seat slab', [(busSeat.minX + busSeat.maxX) / 2, .9, (busSeat.minZ + busSeat.maxZ) / 2], [(busSeat.minX + busSeat.maxX) / 2, .2, (busSeat.minZ + busSeat.maxZ) / 2], true, busSeat.maxY, .003);
check('bus shelter roof is a rain shelter above the colossus', busRoof.minY >= 2.53 && SPACE.shelters.some(shelter => shelter.id === busRoof.id && ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY'].every(key => shelter[key] === busRoof[key])));

const probeOffsets = { reception: .52, 'waiting-chair': .36, gurney: null, 'bedside-cabinet': .34, 'privacy-curtain': 1.2, 'crash-cart': .40,
  'hospital-bed': null, 'iv-stand': .90, 'nurses-station': .55, 'operating-table': null, 'anaesthesia-trolley': .42, 'covered-instrument-tray': .42,
  monitor: .80, 'scrub-sink': .42, 'swinging-door': 1.10, 'bed-head-console': .90, 'chapel-bench': .43, 'chapel-altar': .40, 'pharmacy-shelf': .72, 'pharmacy-counter': .40,
  'linen-shelf': .72, 'linen-cart': .40, boiler: 1.20, 'boiler-manifold': .90, workbench: null, 'archive-shelf': .72, 'archive-table': null, 'archive-boxes': .40, 'archive-ladder': 1.07 };
for (const cover of LEVEL.furniture) {
  const declared = stats.furnitureContract?.find(value => value.id === cover.id);
  const same = declared && ['minX', 'maxX', 'minZ', 'maxZ', 'height'].every(key => declared[key] === cover[key]) && (declared.baseY ?? 0) === (cover.baseY ?? 0);
  const audit = stats.authoredBounds?.[cover.id];
  check(`${cover.id}: authored bounds match collider`, same && audit?.withinContract && audit?.fillsBoundaryWithin35mm,
    { collider: cover, authored: audit ?? null, declaredMatches: Boolean(same) });
  const base = cover.baseY ?? 0, offset = probeOffsets[cover.kind], y = base + (offset ?? (['gurney', 'hospital-bed', 'operating-table'].includes(cover.kind) ? cover.height - .09 : cover.height - .13));
  const x = (cover.minX + cover.maxX) / 2, z = (cover.minZ + cover.maxZ) / 2;
  if (cover.maxZ - cover.minZ >= cover.maxX - cover.minX) segment(`${cover.id}: visible geometry at correct floor`, [cover.minX - .1, y, z], [cover.maxX + .1, y, z], true);
  else segment(`${cover.id}: visible geometry at correct floor`, [x, y, cover.minZ - .1], [x, y, cover.maxZ + .1], true);
}
for (const piece of LEVEL.sofa.parts) {
  const audit = stats.authoredBounds?.['sofa:' + piece.part];
  check(`sofa ${piece.part}: authored bounds match collider`, audit?.withinContract && audit?.fillsBoundaryWithin35mm, { collider: piece, authored: audit ?? null });
  segment(`sofa ${piece.part}: exact contact`, [(piece.minX + piece.maxX) / 2, 1.3, (piece.minZ + piece.maxZ) / 2], [(piece.minX + piece.maxX) / 2, 0, (piece.minZ + piece.maxZ) / 2], true, piece.height, .012);
}
check('reception table authored bounds match collider', stats.authoredBounds?.table?.fillsBoundaryWithin35mm, { authored: stats.authoredBounds?.table ?? null });
segment('reception table contact', [(LEVEL.table.minX + LEVEL.table.maxX) / 2, 1.3, (LEVEL.table.minZ + LEVEL.table.maxZ) / 2],
  [(LEVEL.table.minX + LEVEL.table.maxX) / 2, 0, (LEVEL.table.minZ + LEVEL.table.maxZ) / 2], true, LEVEL.table.height, .012);

const propOffsets = { car: .70, ambulance: 1.30, 'bus-shelter-back': 1.20, 'bus-shelter-side': 1.20, 'bus-shelter-post': 1.20, 'bus-shelter-bench': .46, sign: 2.35, hedge: .60, lamp: 2.90 };
for (const prop of SPACE.props) {
  const audit = stats.authoredBounds?.[prop.id];
  check(`${prop.id}: exterior art stays inside prop box`, audit?.withinContract && audit?.fillsBoundaryWithin35mm, { collider: prop, authored: audit ?? null });
  const x = (prop.minX + prop.maxX) / 2, z = (prop.minZ + prop.maxZ) / 2, y = propOffsets[prop.kind] ?? prop.maxY - .03;
  segment(`${prop.id}: solid exterior geometry`, [prop.minX - .1, y, z], [prop.maxX + .1, y, z], true);
}

const renderNames = ['overview', 'exterior', 'entrance', 'ground', 'corridor', 'ward', 'theatre', 'emergency', 'basement', 'linen', 'archives', 'chapel', 'waiting', 'children', 'ambulance', 'verge', 'bus-shelter'];
const renderProof = renderNames.map(name => {
  const file = resolve(art, `render-${name}.png`), present = existsSync(file), data = present ? readFileSync(file) : Buffer.alloc(0);
  const width = data.length >= 24 ? data.readUInt32BE(16) : 0, height = data.length >= 24 ? data.readUInt32BE(20) : 0;
  return { name, path: `art/levels/hospital/render-${name}.png`, bytes: data.length, width, height,
    validPng: data.length > 50000 && width === 1440 && height === 1000 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND' };
});
check(`${renderNames.length} full-size Cycles render files exist`, process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' || renderProof.every(render => render.validPng), { renders: renderProof, skippedForIteration: process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' });
// Coplanar faces of different materials within 3 mm flicker. Visible spots
// that involve the architecture fail; spots wholly inside one prop-model box
// (the props session's furniture and vehicles) are listed for that session.
const DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker']);
const blended = new Set(json.materials.filter(material => material.alphaMode === 'BLEND').map(material => material.name));
const soup = [];
for (const mesh of allMeshes) {
  const material = mesh.userData.material, position = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
  const vertex = k => new THREE.Vector3().fromBufferAttribute(position, k).applyMatrix4(mesh.matrixWorld).toArray();
  for (let k = 0; k < index.count; k += 3) soup.push({ a: vertex(index.getX(k)), b: vertex(index.getX(k + 1)), c: vertex(index.getX(k + 2)), material,
    occluder: !DECALS.has(material) && !blended.has(material) });
}
const contactAudit = auditContacts(loadGlbTriangles(path), stats.contactChecks ?? []);
check('every audited small part touches its support within 3 mm (triangle-mesh distance)', contactAudit.checked > 0 && contactAudit.passed,
  { checked: contactAudit.checked, toleranceMm: contactAudit.toleranceMm, failed: contactAudit.failed });
const PROP_KINDS = new Set(['bedside-cabinet', 'hospital-bed', 'gurney', 'operating-table', 'waiting-chair', 'privacy-curtain', 'iv-stand', 'crash-cart', 'anaesthesia-trolley',
  'linen-cart', 'covered-instrument-tray', 'pharmacy-shelf', 'linen-shelf', 'archive-shelf', 'workbench', 'archive-table', 'monitor', 'scrub-sink', 'swinging-door', 'boiler',
  'linen-folding-table', 'laundry-bag', 'archive-ladder', 'chapel-lectern', 'water-cooler', 'kids-table', 'kids-stool', 'kids-storage']);
const propBoxes = [...LEVEL.furniture.filter(item => PROP_KINDS.has(item.kind)).map(item => ({ id: item.id, minX: item.minX, maxX: item.maxX, minZ: item.minZ, maxZ: item.maxZ, minY: item.baseY ?? 0, maxY: (item.baseY ?? 0) + item.height })),
  { id: 'table', ...LEVEL.table, minY: 0, maxY: LEVEL.table.height }, ...SPACE.props.filter(item => item.kind !== 'sign')];
const insideBox = (t, b) => t.lo[0] >= b.minX - .005 && t.hi[0] <= b.maxX + .005 && t.lo[1] >= b.minY - .005 && t.hi[1] <= b.maxY + .005 && t.lo[2] >= b.minZ - .005 && t.hi[2] <= b.maxZ + .005;
const started = Date.now();
const coplanar = scanCoplanar(soup, { tolerance: .003, scan: t => !DECALS.has(t.material) });
const visibleSpots = coplanar.filter(spot => spot.visibleFraction >= .34).map(spot => {
  const box = propBoxes.find(b => spot.triangles.every(t => insideBox(t, b)));
  return { ...spot, owner: box ? `props session (${box.id})` : 'architecture' };
});
const architectureSpots = visibleSpots.filter(spot => spot.owner === 'architecture');
const propSpots = visibleSpots.filter(spot => spot.owner !== 'architecture');
check('no visible coplanar faces of different materials within 3 mm in the architecture', architectureSpots.length === 0, {
  spotsScanned: coplanar.length, visibleSpots: visibleSpots.length, architectureSpotCount: architectureSpots.length, architectureSpots: architectureSpots.slice(0, 40).map(({ triangles, ...spot }) => spot),
  propsSessionSpots: propSpots.length, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
const manifestPath = resolve(art, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifestFailures = [];
for (const entry of manifest.files) {
  const file = resolve(root, entry.path);
  if (!existsSync(file)) { manifestFailures.push({ path: entry.path, error: 'missing' }); continue; }
  const data = readFileSync(file);
  if (data.length !== entry.bytes || hash(data) !== entry.sha256) manifestFailures.push({ path: entry.path, error: 'size or SHA-256 mismatch' });
}
check('manifest covers present unmodified deliverables', manifestFailures.length === 0 && manifest.files.some(entry => entry.path === 'public/levels/hospital.glb') && manifest.files.some(entry => entry.path === 'validation/verify-hospital-art.mjs'), { manifestFailures, files: manifest.files.length });
const expectedRenders = renderNames.map(name => `render-${name}.png`).sort(), sourceRenders = [...(stats.renders ?? [])].sort();
const manifestRenders = manifest.files.filter(entry => entry.path.startsWith('art/levels/hospital/render-')).map(entry => entry.path.split('/').pop()).sort();
const renderSetMatches = JSON.stringify(sourceRenders) === JSON.stringify(expectedRenders) && JSON.stringify(manifestRenders) === JSON.stringify(expectedRenders);
check('source stats and manifest describe the same full-size current render set', process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' || renderSetMatches && renderProof.every(render => render.validPng),
  { expectedRenders, sourceRenders, manifestRenders, skippedForIteration: process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' });

const report = { generatedAt: new Date().toISOString(), mapId: LEVEL.id, glb: { path: 'public/levels/hospital.glb', sha256: hash(bytes), bytes: bytes.length },
  levelConfigSha256: hash(configSource), collisionContractSha256: contractSha256, spaceContractSha256: spaceSha256,
  sourceStats: { seed: stats.seed, textures: images.length, solidAudits: Object.keys(stats.authoredBounds ?? {}).length, renders: stats.renders }, geometry: totals,
  renders: renderProof, contacts: contactAudit, coplanar: { tolerance: .003, propsSessionSpots: propSpots.map(({ triangles, ...spot }) => spot) }, checks, passed: checks.every(value => value.passed), limits: [
    'Static geometry and selected contact/visibility probes; not an exhaustive triangle-vs-AABB equivalence proof.',
    'The coplanar scan judges visibility with nine short rays (the reviewers\' scanner heuristic); a spot is the props session\'s when both faces lie inside one of its prop boxes.',
    'Furniture and prop boundary audits are recorded by the deterministic generator and sampled against the exported mesh.',
    'Dynamic barricades, weapon racks, generator, equipment and runtime hospital lighting are outside this art GLB inspection.',
    'Cycles images are inspected separately; this receipt does not prove human keyboard/mouse play, listening, GPU performance, Wi-Fi play or live hospital loader integration.',
  ] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, failed: checks.filter(value => !value.passed).map(value => value.name),
  glbSha256: report.glb.sha256, triangles: totals.triangles, meshes: totals.meshes, drawCalls: totals.drawCalls, materials: totals.materials, textures: images.length, output }));
if (!report.passed) process.exitCode = 1;
