// Read-only integrity, geometry and contact inspection of the real funfair GLB.
// Run: node validation/verify-funfair-art.mjs [validation/kimi-funfair/art/art-verification.json]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { scanCoplanar } from './hospital-coplanarity.mjs';

process.env.DEADWOOD_LEVEL = 'funfair';
const { LEVEL } = await import('../public/level-config.js');
const { WINDOWS } = await import('../public/layout.js');
const { SPACE, spaceTreadY } = await import('../public/level-space.js');
const { ARMORY, armoryRackBounds } = await import('../public/rules.js');
const { GROUND_TUBES, lampsFor } = await import('../public/funfair-lights.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const art = resolve(root, 'art/levels/funfair');
const path = resolve(root, 'public/levels/funfair.glb');
const output = resolve(process.argv[2] ?? resolve(root, 'validation/kimi-funfair/art/art-verification.json'));
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
const parts = JSON.parse(readFileSync(resolve(root, 'validation/kimi-funfair/funfair-parts.json'), 'utf8'));
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
const RAY_DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker', 'Fair_ground_decal']);
const solidMeshes = allMeshes.filter(mesh => !RAY_DECALS.has(mesh.userData.material));
function ray(from, to, margin = 1e-5) {
  const origin = new THREE.Vector3(...from), direction = new THREE.Vector3(...to).sub(origin), length = direction.length();
  return new THREE.Raycaster(origin, direction.normalize(), 0, Math.max(0, length - margin)).intersectObjects(solidMeshes, false)[0] ?? null;
}
function segment(name, from, to, expectedBlocked, expectedY = null, tolerance = 1e-4) {
  const hit = ray(from, to);
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
check('triangle and draw-call budgets (under 220,000 and at most 90)', totals.triangles < 220000 && totals.drawCalls <= 90,
  { triangles: totals.triangles, drawCalls: totals.drawCalls, triangleLimitExclusive: 220000, drawCallTarget: 90 });
check('source triangle ownership adds up', stats.architectureTriangles + stats.propTriangles === stats.sourceTriangles && stats.sourceTriangles === stats.triangles,
  { architectureTriangles: stats.architectureTriangles, propTriangles: stats.propTriangles, sourceTriangles: stats.sourceTriangles, exportedTriangles: totals.triangles });

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
const requiredMaterials = ['Fluorescent_cold', 'Fluorescent_flicker', 'Fluorescent_aged', 'Fluorescent_dead', 'Warm_lens', 'Emergency_amber', 'Exit_glow',
  'Sign_glow', 'Sign_dead', 'Sign_flicker', 'Lamp_sodium', 'Lamp_sodium_flicker', 'Lamp_pool', 'Lamp_pool_flicker', 'Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Mirror'];
const materialNames = new Set(json.materials.map(material => material.name));
check('loader-compatible and funfair materials exist', requiredMaterials.every(name => materialNames.has(name)), { missing: requiredMaterials.filter(name => !materialNames.has(name)) });
check('family-safe material and image names', ![...materialNames, ...images.map(image => image.name ?? '')].some(name => /blood|gore|organ|syringe|corpse|cadaver|clown|doll|needle/i.test(name)));
const buildSource = readFileSync(resolve(art, 'build_funfair.py'), 'utf8');
// The build includes its polish modules (kit, atlases, furniture, dressing, outside).
const artModules = ['funfair_kit.py', 'funfair_atlas.py', 'funfair_ground.py', 'funfair_cellar.py', 'funfair_dress.py', 'funfair_outside.py'];
const artSource = [buildSource, ...artModules.map(name => readFileSync(resolve(art, name), 'utf8'))].join(String.fromCharCode(10));
check('build includes every polish module', artModules.every(name => buildSource.includes(name)), { modules: artModules });
const frenchSigns = ['AUTOS TAMPONNEUSES', 'TIR', 'CONFISERIE', 'LOTS', 'CAISSE', 'SORTIE', 'FÊTE FORAINE', 'BARBE À PAPA', 'CANARDS'];
check('required French signs are authored', frenchSigns.every(label => artSource.includes(label)), { missing: frenchSigns.filter(label => !artSource.includes(label)) });
const groundFlickerTubes = parts.filter(part => part.name === 'Fluoro_tube' && part.material === 'Fluorescent_flicker'
  && Math.abs((part.min[0] + part.max[0]) / 2 + 8) < .001 && Math.abs((part.min[2] + part.max[2]) / 2 - 1) < .08);
check('ground tube at -8,1 flickers in source, runtime and exported art', buildSource.includes('(xi,zi)==(1,2)')
  && GROUND_TUBES.find(tube => tube.x === -8 && tube.z === 1)?.state === 'flicker' && groundFlickerTubes.length === 2,
  { sourceFormulaPresent: buildSource.includes('(xi,zi)==(1,2)'), runtimeState: GROUND_TUBES.find(tube => tube.x === -8 && tube.z === 1)?.state, exportedTubes: groundFlickerTubes.length });
check('runtime light tiers remain 13, 19 and 20', lampsFor({ id: 'low' }).length === 13 && lampsFor({ id: 'medium' }).length === 19 && lampsFor({ id: 'high' }).length === 20,
  { low: lampsFor({ id: 'low' }).length, medium: lampsFor({ id: 'medium' }).length, high: lampsFor({ id: 'high' }).length });
check('garlands mix live and dead bulbs', parts.some(part => part.name === 'Garland_bulb' && part.material === 'Sign_dead') && parts.some(part => part.name === 'Garland_bulb' && ['Warm_lens', 'Sign_flicker', 'Garland_lit'].includes(part.material)));
const lampPools = parts.filter(part => ['Lamp_pool', 'Lamp_pool_flicker'].includes(part.material));
const deadNortheastLamp = SPACE.props.find(prop => prop.id === 'prop-lamp-ne');
const poolCenter = part => ({ x: (part.min[0] + part.max[0]) / 2, z: (part.min[2] + part.max[2]) / 2 });
const deadLampPools = lampPools.filter(part => {
  if (!deadNortheastLamp) return false;
  const { x, z } = poolCenter(part);
  return Math.abs(x - (deadNortheastLamp.minX + deadNortheastLamp.maxX) / 2) < .01 && Math.abs(z - (deadNortheastLamp.minZ + deadNortheastLamp.maxZ) / 2) < .01;
});
check('dead northeast lamp has no animated or emissive pool', lampPools.length === 3 && deadLampPools.length === 0
  && lampPools.filter(part => part.material === 'Lamp_pool_flicker').length === 1
  && lampPools.filter(part => part.material === 'Lamp_pool_flicker').every(part => {
    const { x, z } = poolCenter(part); return Math.abs(x - 8) < .01 && Math.abs(z - 16) < .01;
  }), { lampPools: lampPools.map(part => ({ material: part.material, ...poolCenter(part) })), deadLampPools: deadLampPools.length });
check('editable Blender source is present', existsSync(resolve(art, 'funfair.blend')) && readFileSync(resolve(art, 'funfair.blend')).length > 1000000);

const roofIndex = json.nodes.findIndex(node => node.name === 'Roof');
const meshNodeStates = [];
function visit(index, inRoof = false) {
  const node = json.nodes[index], roof = inRoof || index === roofIndex;
  if (node.mesh !== undefined) meshNodeStates.push({ name: node.name ?? '', roof });
  for (const child of node.children ?? []) visit(child, roof);
}
for (const index of json.scenes[json.scene ?? 0].nodes) visit(index);
check('Roof is a separate populated subtree', roofIndex >= 0 && (json.nodes[roofIndex].children?.length ?? 0) > 0 && meshNodeStates.some(node => node.roof));
check('all batches use Funfair__ except Roof__ inside Roof', meshNodeStates.every(node => node.roof ? node.name.startsWith('Roof__') : node.name.startsWith('Funfair__')),
  { invalid: meshNodeStates.filter(node => !(node.roof ? node.name.startsWith('Roof__') : node.name.startsWith('Funfair__'))) });

// Match Python's canonical JSON hashing while retaining authored numeric literals.
const configSource = readFileSync(resolve(root, 'public/level-config.js'), 'utf8');
const configLiteral = configSource.split('export const LEVELS = freeze(')[1].split(');\nexport const LEVEL_IDS')[0];
class NumericLiteral { constructor(source) { this.source = source; } }
const numberTree = JSON.parse(configLiteral, (key, value, context) => typeof value === 'number' ? new NumericLiteral(context?.source ?? String(value)) : value).funfair;
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
check('frozen contract counts are present', SPACE.rooms.length === 9 && SPACE.flights.length === 2 && SPACE.treads.length === 40 && SPACE.props.length === 14 && LEVEL.furniture.length === 55,
  { rooms: SPACE.rooms.length, flights: SPACE.flights.length, treads: SPACE.treads.length, props: SPACE.props.length, furniture: LEVEL.furniture.length });

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
    segment(flight.id + ': tread ' + (i + 1), [x, y + .07, z], [x, y - .2, z], true, y, .0121);
  }
}
for (const wall of SPACE.walls.filter(item => item.id.startsWith('cellar-'))) {
  const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2, y = wall.baseY + wall.height / 2;
  if (wall.id.endsWith('west') || wall.id.endsWith('east')) segment(wall.id + ': cellar retaining wall', [x - .5, y, z], [x + .5, y, z], true);
  else segment(wall.id + ': cellar retaining wall', [x, y, z - .5], [x, y, z + .5], true);
}
const across = (wall, y) => {
  const x = (wall.minX + wall.maxX) / 2, z = (wall.minZ + wall.maxZ) / 2;
  return wall.maxX - wall.minX >= wall.maxZ - wall.minZ ? [[x, y, wall.minZ - .3], [x, y, wall.maxZ + .3]] : [[wall.minX - .3, y, z], [wall.maxX + .3, y, z]];
};
const partitions = SPACE.walls.filter(item => item.id.startsWith('room-'));
for (const wall of partitions) {
  const y = wall.id.includes('-lintel-') ? wall.baseY + wall.height / 2 : wall.baseY + Math.min(wall.height / 2, .6);
  segment(`${wall.id}: partition solid`, ...across(wall, y), true);
}
const ROOMS = SPACE.rooms ?? [];
check('SPACE.rooms lists nine reachable named room contracts', ROOMS.length === 9 && ROOMS.every(room => room.doors.length >= 1 && room.label.fr && room.label.en), { rooms: ROOMS.map(room => room.id) });
for (const room of ROOMS) for (const door of room.doors) {
  const y = door.floorY + 1.6, w = door.width / 2 - .25;
  for (const along of [-w, 0, w]) {
    const [x, z] = door.axis === 'x' ? [door.x + along, door.z] : [door.x, door.z + along];
    segment(`${room.id}/${door.id}: clear doorway (${along.toFixed(2)})`, door.axis === 'x' ? [x, y, z - .4] : [x - .4, y, z], door.axis === 'x' ? [x, y, z + .4] : [x + .4, y, z], false);
  }
}
const ceiling = SPACE.slabs.filter(slab => slab.id.startsWith('ceiling-'));
check('ceiling slabs cover ground except both stair wells', ceiling.length > 0 && ceiling.every(slab => slab.minY === 3.2 && slab.maxY === 3.26)
  && SPACE.holes.every(hole => !ceiling.some(slab => slab.minX < hole.maxX && slab.maxX > hole.minX && slab.minZ < hole.maxZ && slab.maxZ > hole.minZ)), { pieces: ceiling.length });
for (const room of ROOMS.filter(item => item.floor === 'ground')) {
  segment(`${room.id}: suspended ceiling at 3.2 m`, [room.target.x, 3.05, room.target.z], [room.target.x, 3.5, room.target.z], true, 3.2, .003);
}
for (const [index, hole] of SPACE.holes.entries()) {
  const x = (hole.minX + hole.maxX) / 2, z = (hole.minZ + hole.maxZ) / 2;
  segment(`stair well ${index}: light shaft open above ceiling`, [x, 1.2, z], [x, 5.6, z], false);
}
const entrance = SPACE.slabs.find(slab => slab.id === 'entrance-canopy');
segment('entrance canopy exact underside', [(entrance.minX + entrance.maxX) / 2, 2.6, (entrance.minZ + entrance.maxZ) / 2], [(entrance.minX + entrance.maxX) / 2, 3.4, (entrance.minZ + entrance.maxZ) / 2], true, entrance.minY, .012);
for (const id of ['entrance-canopy', 'carousel-canopy', 'stall-canopy-west', 'stall-canopy-east']) check(id + ' is a rain shelter', SPACE.shelters.some(shelter => shelter.id === id));
for (const id of ['carousel-canopy', 'stall-canopy-west', 'stall-canopy-east']) {
  const shelter = SPACE.shelters.find(item => item.id === id), x = (shelter.minX + shelter.maxX) / 2, z = (shelter.minZ + shelter.maxZ) / 2;
  // The stall booths have a closed roof deck: the probe starts just above the booth.
  const booth = SPACE.props.find(prop => prop.kind === 'stall' && prop.minX < x && x < prop.maxX && prop.minZ < z && z < prop.maxZ);
  const start = Math.max(shelter.minY - .4, booth ? booth.maxY + .02 : -Infinity);
  segment(id + ': visible supported canopy', [x, start, z], [x, shelter.maxY + .2, z], true, id === 'carousel-canopy' ? shelter.minY : shelter.maxY, .012);
}
for (const point of [{ id: 'carousel-canopy', x: -26, z: 25.1 }, { id: 'stall-canopy-west', x: -13.5, z: -15.45 }, { id: 'stall-canopy-east', x: 13.5, z: -15.45 }]) {
  const shelter = SPACE.shelters.find(item => item.id === point.id), carousel = point.id === 'carousel-canopy';
  const expectedWidth = carousel ? 11 : 7.8, expectedDepth = carousel ? 11 : 5.3;
  const valid = shelter && Math.abs(shelter.maxX - shelter.minX - expectedWidth) < 1e-6 && Math.abs(shelter.maxZ - shelter.minZ - expectedDepth) < 1e-6
    && point.x >= shelter.minX && point.x <= shelter.maxX && point.z >= shelter.minZ && point.z <= shelter.maxZ;
  check(`${point.id}: expanded shelter contains dry survivor point`, valid, { point, shelter });
  segment(`${point.id}: dry survivor volume is clear to 2.2 m`, [point.x, .05, point.z], [point.x, 2.2, point.z], false);
  const roofY = carousel ? shelter.minY : 2.90 - .30 * Math.abs(point.z - (shelter.minZ + shelter.maxZ) / 2) / ((shelter.maxZ - shelter.minZ) / 2);
  segment(`${point.id}: canopy covers dry survivor point`, [point.x, 2.3, point.z], [point.x, 3.3, point.z], true, roofY, .012);
}
// Outside the booth footprint nothing of a stall may hang below its canopy: the frame,
// stays and bulbs lie on the fabric's upper face (the brief's 2.75 m rule, canopy exempt).
const belowCanopy = [];
for (const booth of SPACE.props.filter(prop => prop.kind === 'stall')) {
  const shelter = SPACE.shelters.find(item => item.id === (booth.minX < 0 ? 'stall-canopy-west' : 'stall-canopy-east'));
  for (const part of parts.filter(item => item.col === 'Stalls' && !item.solid && !item.name.startsWith('TEXT:'))) {
    const outside = part.min[0] < booth.minX - 1e-6 || part.max[0] > booth.maxX + 1e-6 || part.min[2] < booth.minZ - 1e-6 || part.max[2] > booth.maxZ + 1e-6;
    const over = part.max[0] > shelter.minX && part.min[0] < shelter.maxX && part.max[2] > shelter.minZ && part.min[2] < shelter.maxZ;
    if (outside && over && part.min[1] < shelter.minY - .012) belowCanopy.push({ name: part.name, min: part.min, max: part.max });
  }
}
check('stall awnings carry nothing below the canopy outside the booth', belowCanopy.length === 0, { belowCanopy: belowCanopy.slice(0, 12) });
for (const rail of SPACE.rails) {
  const x = (rail.minX + rail.maxX) / 2, z = (rail.minZ + rail.maxZ) / 2, y = rail.baseY + rail.height / 2;
  if (rail.id.endsWith('low-end')) segment(rail.id + ': stair end protection', [x, y, z - .3], [x, y, z + .3], true);
  else segment(rail.id + ': stair side protection', [x - .3, y, z], [x + .3, y, z], true);
}
segment('cellar actual floor', [0, -3.15, 0], [0, -3.65, 0], true, -3.394, .003);
segment('cellar slab overhead', [0, -.5, 0], [0, .2, 0], true, -.24, .003);
segment('ground actual floor', [0, 1, 0], [0, -.1, 0], true, .010, .003);
segment('funfair roof underside', [0, 6.1, 5], [0, 6.7, 5], true, 6.26, .003);
segment('funfair roof membrane', [17, 6.6, 5], [17, 6.45, 5], true, 6.5, .003);

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

const probeOffsets = { counter: .52, 'prize-shelf': .80, 'bumper-rail': .84, 'bumper-car': .25, 'mirror-panel': 1.10, 'crate-stack': .60,
  'arcade-row': 1.2, 'claw-machine': 1.0, pinball: .9, 'change-machine': 1.0, 'skee-ball': .6, 'prize-gondola': 1.2, 'prize-wall': 1.2, 'back-bar': .95,
  'snack-cart': 1.0, 'bistro-table': .76, 'ticket-booth': 1.0, 'duck-stage': 1.6, switchboard: 1.2, transformer: 1.0, 'carousel-motor': .8,
  'electrical-cabinet': 1.0, workbench: .9, 'kiddie-ride': .6, 'queue-rail': .9, 'horse-rack': 1.0, trunks: .6 };
for (const cover of LEVEL.furniture) {
  const declared = stats.furnitureContract?.find(value => value.id === cover.id);
  const same = declared && ['minX', 'maxX', 'minZ', 'maxZ', 'height'].every(key => declared[key] === cover[key]) && (declared.baseY ?? 0) === (cover.baseY ?? 0);
  const audit = stats.authoredBounds?.[cover.id];
  check(`${cover.id}: authored bounds match collider`, same && audit?.withinContract && audit?.fillsBoundaryWithin35mm, { authored: audit ?? null, declaredMatches: Boolean(same) });
  const base = cover.baseY ?? 0, offset = probeOffsets[cover.kind], y = base + (offset ?? cover.height - .13);
  const x = (cover.minX + cover.maxX) / 2, z = (cover.minZ + cover.maxZ) / 2;
  if (cover.maxZ - cover.minZ >= cover.maxX - cover.minX) segment(`${cover.id}: visible geometry at correct floor`, [cover.minX - .1, y, z], [cover.maxX + .1, y, z], true);
  else segment(`${cover.id}: visible geometry at correct floor`, [x, y, cover.minZ - .1], [x, y, cover.maxZ + .1], true);
}
for (const piece of LEVEL.sofa.parts) {
  const audit = stats.authoredBounds?.['sofa:' + piece.part];
  check(`sofa ${piece.part}: authored bounds match collider`, audit?.withinContract && audit?.fillsBoundaryWithin35mm, { authored: audit ?? null });
  segment(`sofa ${piece.part}: exact contact`, [(piece.minX + piece.maxX) / 2, 1.0, (piece.minZ + piece.maxZ) / 2], [(piece.minX + piece.maxX) / 2, 0, (piece.minZ + piece.maxZ) / 2], true, piece.height, .012);
}
check('work table authored bounds match collider', stats.authoredBounds?.table?.fillsBoundaryWithin35mm, { authored: stats.authoredBounds?.table ?? null });
segment('work table contact', [(LEVEL.table.minX + LEVEL.table.maxX) / 2, 1.0, (LEVEL.table.minZ + LEVEL.table.maxZ) / 2],
  [(LEVEL.table.minX + LEVEL.table.maxX) / 2, 0, (LEVEL.table.minZ + LEVEL.table.maxZ) / 2], true, LEVEL.table.height, .012);

for (const prop of SPACE.props) {
  const audit = stats.authoredBounds?.[prop.id];
  check(`${prop.id}: exterior art stays inside prop box`, audit?.withinContract && audit?.fillsBoundaryWithin35mm, { authored: audit ?? null });
  const x = (prop.minX + prop.maxX) / 2, z = (prop.minZ + prop.maxZ) / 2;
  if (prop.kind === 'stall') segment(`${prop.id}: solid exterior geometry`, [prop.minX - .1, prop.maxY - .03, prop.maxZ - .06], [prop.maxX + .1, prop.maxY - .03, prop.maxZ - .06], true);
  else {
    const y = prop.kind === 'carousel' ? prop.maxY - .025 : prop.kind === 'caravan' ? prop.maxY - .05 : prop.kind === 'fence' ? prop.maxY - .06 : prop.kind === 'lamp' ? 2.9 : prop.kind === 'arch-support' ? 2 : prop.maxY - .10;
    segment(`${prop.id}: solid exterior geometry`, [prop.minX - .1, y, z], [prop.maxX + .1, y, z], true);
  }
}
const wheelParts = parts.filter(part => part.col === 'Wheel');
check('Ferris wheel is art-only and wholly beyond playable bounds', wheelParts.length > 20 && wheelParts.every(part => part.max[2] < -64) && Math.max(...wheelParts.map(part => part.max[1])) > 23,
  { parts: wheelParts.length, maxZ: Math.max(...wheelParts.map(part => part.max[2])), maxY: Math.max(...wheelParts.map(part => part.max[1])) });
// Bearing, not chain contact: the support graph reaches a stair through tread-to-tread
// contacts, which hid a stair hanging past the plinth. Every wheel part whose foot is at
// plinth level must stand on a pad or landing top under its whole footprint (5 cm grid),
// and every tread must be housed between two such stringers over its full depth.
{
  const PLINTH = ['Wheel_pad', 'Wheel_landing'], plinthTops = wheelParts.filter(part => PLINTH.includes(part.name));
  const plinthY = Math.max(...plinthTops.map(part => part.max[1]));
  const bearsOn = (part, supports) => {
    const tops = supports.filter(top => Math.abs(top.max[1] - part.min[1]) <= .012), span = axis => part.max[axis] - part.min[axis];
    const nx = Math.max(2, Math.ceil(span(0) / .05) + 1), nz = Math.max(2, Math.ceil(span(2) / .05) + 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = part.min[0] + span(0) * i / (nx - 1), z = part.min[2] + span(2) * j / (nz - 1);
      if (!tops.some(top => x >= top.min[0] - 1e-3 && x <= top.max[0] + 1e-3 && z >= top.min[2] - 1e-3 && z <= top.max[2] + 1e-3)) return false;
    }
    return true;
  };
  const standing = wheelParts.filter(part => !PLINTH.includes(part.name) && Math.abs(part.min[1] - plinthY) <= .012);
  const unbacked = standing.filter(part => !bearsOn(part, plinthTops)).map(part => ({ name: part.name, min: part.min, max: part.max }));
  const stringers = standing.filter(part => part.name === 'Wheel_step_stringer'), treads = wheelParts.filter(part => part.name === 'Wheel_step');
  check('Ferris wheel parts at plinth level bear on the pad or landing under their whole footprint',
    plinthTops.length >= 2 && stringers.length === 2 * treads.length && treads.length >= 8 && standing.some(part => part.name === 'Wheel_footing') && unbacked.length === 0,
    { plinthY, standing: standing.length, stringers: stringers.length, unbacked: unbacked.slice(0, 12) });
  // A left stringer ends where the tread starts and a right one starts where it ends, both
  // spanning its depth and reaching its top.
  const sides = [[stringer => stringer.max[0], tread => tread.min[0]], [stringer => stringer.min[0], tread => tread.max[0]]];
  const grounded = stringers.filter(stringer => bearsOn(stringer, plinthTops));
  const housed = tread => sides.every(([face, edge]) => grounded.some(stringer => Math.abs(face(stringer) - edge(tread)) <= .002
    && stringer.min[2] <= tread.min[2] + 1e-3 && stringer.max[2] >= tread.max[2] - 1e-3 && stringer.max[1] >= tread.max[1] - .002));
  const loose = treads.filter(tread => !housed(tread)).map(tread => ({ min: tread.min, max: tread.max }));
  const firstRiser = treads.length ? Math.min(...treads.map(tread => tread.max[1])) - plinthY : null;
  check('Ferris wheel stair treads are housed in grounded stringers and start one riser above the landing',
    loose.length === 0 && firstRiser !== null && firstRiser > .1 && firstRiser <= .30, { treads: treads.length, loose, firstRiser });
}

// Mesh-distance/contact audit: find the authored part that reaches each solid's
// top, then raycast the exported triangles at that part's centre. This checks
// the GLB itself, not only the generator's AABB bookkeeping.
const meshContacts = [];
for (const [id, audit] of Object.entries(stats.authoredBounds ?? {})) {
  const top = audit.max[1], candidates = parts.filter(part => part.solid === id && Math.abs(part.max[1] - top) <= .004);
  let best = null;
  for (const part of candidates) {
    const x = (part.min[0] + part.max[0]) / 2, z = (part.min[2] + part.max[2]) / 2;
    const hit = ray([x, top + .08, z], [x, top - .12, z]);
    const distance = hit ? Math.abs(hit.point.y - top) : null;
    if (!best || distance !== null && (best.distance === null || distance < best.distance)) best = { part: part.name, distance, hit: hit?.object.name ?? null };
  }
  const passed = best?.distance !== null && best?.distance <= .012;
  meshContacts.push({ id, top, candidates: candidates.length, ...best, passed });
  check(`${id}: exported mesh contacts authored top within 12 mm`, passed, { contact: meshContacts.at(-1) });
}

const renderNames = ['overview', 'hall', 'jeux', 'lots', 'confiserie', 'bumper-cars', 'stairs', 'cellar', 'miroirs', 'machines', 'carousel', 'stalls', 'entrance', 'wheel', 'refuge'];
const renderProof = renderNames.map(name => {
  const file = resolve(art, `render-${name}.png`), present = existsSync(file), data = present ? readFileSync(file) : Buffer.alloc(0);
  return { name, path: `art/levels/funfair/render-${name}.png`, bytes: data.length,
    validPng: data.length > 50000 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND' };
});
check('all fifteen full-size Cycles render files exist', process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' || renderProof.every(render => render.validPng), { renders: renderProof, skippedForIteration: process.env.DEADWOOD_VERIFY_SKIP_RENDERS === '1' });

// Runtime ground is another stream's file. Once present, parse its actual flat
// calls and require every asphalt/grass top to stay outside the 0..4 mm art slab.
const outdoorsPath = resolve(root, 'public/funfair-outdoors.js'), outdoorsExists = existsSync(outdoorsPath);
const runtimePlanes = [];
if (outdoorsExists) {
  const source = readFileSync(outdoorsPath, 'utf8'), defaultHeight = source.match(/y\s*=\s*(-?[\d.]+),\s*h\s*=\s*([\d.]+)/);
  if (/flat\(name,\s*grassMaterial/.test(source)) for (const name of ['grass-north', 'grass-south', 'grass-west', 'grass-east']) {
    const y = Number(defaultHeight?.[1]), h = Number(defaultHeight?.[2]); runtimePlanes.push({ name, y, h, top: y + h / 2 });
  }
  for (const match of source.matchAll(/flat\(\s*['"`]([^'"`]+)['"`]([\s\S]*?)\);/g)) {
    const name = match[1]; if (!/grass-|funfairParking/i.test(name)) continue;
    const numbers = [...match[2].matchAll(/(?<![\w$])-?(?:\d+\.\d+|\d+|\.\d+)(?![\w$])/g)].map(value => Number(value[0]));
    const y = numbers.length >= 2 ? numbers.at(-2) : Number(defaultHeight?.[1]), h = numbers.length >= 2 ? numbers.at(-1) : Number(defaultHeight?.[2]);
    runtimePlanes.push({ name, y, h, top: y + h / 2 });
  }
}
const planesValid = runtimePlanes.length >= 5 && runtimePlanes.every(plane => Number.isFinite(plane.top) && (plane.top <= -.003 || plane.top >= .007));
check('runtime ground/grass planes avoid art by at least 3 mm', process.env.DEADWOOD_VERIFY_SKIP_RUNTIME_GROUND === '1' || outdoorsExists && planesValid,
  { outdoorsExists, runtimePlanes, skippedForIteration: process.env.DEADWOOD_VERIFY_SKIP_RUNTIME_GROUND === '1', artAsphaltRange: [0, .004] });

const DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker', 'Fair_ground_decal']);
const blended = new Set(json.materials.filter(material => material.alphaMode === 'BLEND').map(material => material.name));
const soup = [];
for (const mesh of allMeshes) {
  const material = mesh.userData.material, position = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
  const vertex = k => new THREE.Vector3().fromBufferAttribute(position, k).applyMatrix4(mesh.matrixWorld).toArray();
  for (let k = 0; k < index.count; k += 3) soup.push({ a: vertex(index.getX(k)), b: vertex(index.getX(k + 1)), c: vertex(index.getX(k + 2)), material,
    occluder: !DECALS.has(material) && !blended.has(material) });
}
const started = Date.now();
const coplanar = scanCoplanar(soup, { tolerance: .003, scan: triangle => !DECALS.has(triangle.material) });
const visibleSpots = coplanar.filter(spot => spot.visibleFraction >= .34);
check('no visible coplanar faces of different materials within 3 mm', visibleSpots.length === 0,
  { spotsScanned: coplanar.length, visibleSpotCount: visibleSpots.length, visibleSpots: visibleSpots.slice(0, 40).map(({ triangles, ...spot }) => spot), seconds: Number(((Date.now() - started) / 1000).toFixed(1)) });

const manifestPath = resolve(art, 'manifest.json'), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes.toString('utf8'));
const manifestFailures = [];
for (const entry of manifest.files) {
  const file = resolve(root, entry.path);
  if (!existsSync(file)) { manifestFailures.push({ path: entry.path, error: 'missing' }); continue; }
  const data = readFileSync(file);
  if (data.length !== entry.bytes || hash(data) !== entry.sha256) manifestFailures.push({ path: entry.path, error: 'size or SHA-256 mismatch' });
}
check('manifest covers present unmodified deliverables', manifestFailures.length === 0 && manifest.files.some(entry => entry.path === 'public/levels/funfair.glb') && manifest.files.some(entry => entry.path === 'validation/verify-funfair-art.mjs'),
  { manifestFailures, files: manifest.files.length });
check('manifest and JSON deliverables use LF line endings', !manifestBytes.includes(13) && [manifest, stats].every(Boolean), { manifestCrBytes: manifestBytes.includes(13) });

const report = { generatedAt: new Date().toISOString(), mapId: LEVEL.id, glb: { path: 'public/levels/funfair.glb', sha256: hash(bytes), bytes: bytes.length },
  levelConfigSha256: hash(configSource), collisionContractSha256: contractSha256, spaceContractSha256: spaceSha256,
  sourceStats: { seed: stats.seed, textures: images.length, solidAudits: Object.keys(stats.authoredBounds ?? {}).length, renders: stats.renders }, geometry: totals,
  renders: renderProof, meshContacts, runtimePlanes, coplanar: { tolerance: .003, spotsScanned: coplanar.length, visibleSpotCount: visibleSpots.length }, checks,
  passed: checks.every(value => value.passed), limits: [
    'Static geometry and selected contact/visibility probes; not an exhaustive triangle-vs-AABB equivalence proof.',
    'Mesh contacts sample the authored top-reaching part of every contract solid against exported triangles; the separate support graph checks all part bounds.',
    'The coplanar scan judges visibility with nine short rays; external scanner output is stored separately.',
    'Dynamic barricades, weapon racks, the runtime generator, equipment and runtime funfair lighting are outside this GLB inspection.',
    'Runtime plane heights are statically read from funfair-outdoors.js; no browser scene or GPU measurement is claimed.',
    'Cycles images are inspected separately; no human keyboard/mouse play, listening, Wi-Fi session or live loader integration is claimed.',
  ] };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, failed: checks.filter(value => !value.passed).map(value => value.name),
  glbSha256: report.glb.sha256, triangles: totals.triangles, meshes: totals.meshes, drawCalls: totals.drawCalls, materials: totals.materials, textures: images.length,
  meshContacts: meshContacts.length, visibleCoplanarSpots: visibleSpots.length, runtimePlanes: runtimePlanes.length, output }));
if (!report.passed) process.exitCode = 1;
