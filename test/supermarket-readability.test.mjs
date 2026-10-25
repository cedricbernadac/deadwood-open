import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The readability pass of 24 October, read back from the exported supermarket GLB.
const bytes = readFileSync(new URL('../public/levels/supermarket.glb', import.meta.url));
const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
const offset = 20 + length, binary = bytes.subarray(offset + 8, offset + 8 + bytes.readUInt32LE(offset));
const material = name => json.materials.find(entry => entry.name === name);
function heights(name) {
  const node = json.nodes.find(entry => entry.name === name); assert.ok(node, name + ' exists');
  const [sy, ty] = [(node.scale ?? [1, 1, 1])[1], (node.translation ?? [0, 0, 0])[1]];
  assert.deepEqual(node.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1], name + ' is not rotated');
  const ys = [];
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION], view = json.bufferViews[accessor.bufferView];
    for (let row = 0; row < accessor.count; row++) ys.push(binary.readFloatLE((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + row * (view.byteStride ?? 12) + 4) * sy + ty);
  }
  return ys;
}

test('supermarket ivy leaves are double-sided, so a leaf turned away never vanishes', () => {
  for (const name of ['Ivy_light', 'Ivy_dark']) assert.equal(material(name)?.doubleSided, true, name);
});

test('supermarket floor grime stands 3 mm or more above the tiles and the cellar concrete', () => {
  // Shop tiles top out at Y 0.014, the cellar concrete at -3.390: closer than 3 mm flickers.
  assert.ok(Math.min(...heights('Market__Floor_grime_shop')) >= .017 - 1e-6, 'shop grime');
  assert.ok(Math.min(...heights('Market__Floor_grime_cellar')) >= -3.387 - 1e-6, 'cellar grime');
});

test('supermarket debris and bay lines are faded, carton barcodes printed, and the map is lighter', () => {
  for (const name of ['Debris_faded', 'Parking_paint_worn', 'Barcode_print']) assert.ok(material(name), name);
  let triangles = 0;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) triangles += json.accessors[primitive.indices].count / 3;
  assert.ok(triangles < 250000, `${triangles} triangles (255,794 before the printed barcodes)`);
});
