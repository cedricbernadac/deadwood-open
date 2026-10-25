import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

// Racks and ground weapons wear no blood in Frisson (weapon-racks lot, 24
// October 2026). The stowed views wear _DressFlat, falling back to _Dress
// (WEAPONS.md G5): the bat and the axe had a blood-free _DressFlat, but the
// hammer and the katana had none, so on high and medium their rack and
// ground copies wore the _Dress and its blood tiles (32 and 24 blood
// vertices). They now carry their own _DressFlat: the wire and rag, the
// frayed strands. Famille never wears any dressing.
const world = await importPublicModule('world.js');
const weapons = await importPublicModule('frisson/weapons.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const { BLOOD_PALETTE } = await importPublicModule('frisson/blood.js');
const { createArmoryRack, createGroundWeapon, setWeaponStyle, getWeaponStyle } = world;
const MELEE = ['bat', 'fireaxe', 'hammer', 'katana'];
const INSTALLED = readFileSync(new URL('../public/frisson/weapons.glb', import.meta.url));
// A blood vertex: its colour within 0.02 (linear RGB) of a palette colour,
// the frisson-glb-check rule (WEAPONS_CONTRACT.blood.tolerance).
const PALETTE = BLOOD_PALETTE.map(hex => new THREE.Color().setHex(hex));
function bloodVertices(geometry) {
  const color = geometry.attributes.color;
  if (!color) return 0;
  let count = 0;
  for (let vertex = 0; vertex < color.count; vertex++)
    if (PALETTE.some(c => Math.hypot(color.getX(vertex) - c.r, color.getY(vertex) - c.g, color.getZ(vertex) - c.b) <= .02)) count++;
  return count;
}
const dressesOf = root => { const list = []; root.traverse(node => { if (node.isMesh && node.name === 'frissonWeaponDress') list.push(node); }); return list; };

test('every melee weapon of the installed file has a _DressFlat without a single blood vertex', () => {
  const roots = weapons.weaponsFromGlb(readGlb(INSTALLED));
  for (const type of MELEE) {
    const record = roots.get(type);
    assert.ok(record?.dressFlat, `${type}: a _DressFlat`);
    assert.equal(bloodVertices(record.dressFlat.geometry), 0, `${type}: _DressFlat blood vertices`);
    assert.ok(bloodVertices(record.dress.geometry) > 0, `${type}: the _Dress keeps its blood (first person, held)`);
  }
});

test('at every quality, melee racks and ground weapons wear no blood', () => {
  const problems = [];
  for (const quality of ['high', 'medium', 'low']) {
    const roots = weapons.weaponsFromGlb(readGlb(INSTALLED));
    const style = weapons.createWeaponsStyle({ roots, quality });
    setWeaponStyle(style);
    try {
      for (const type of MELEE) for (const [view, build] of [['rack', () => createArmoryRack(type)], ['ground', () => createGroundWeapon(type)]]) {
        const dresses = dressesOf(build());
        // On low, racks and the ground are not dressed; elsewhere, the flat channel.
        if (quality === 'low') { if (dresses.length) problems.push(`${quality} ${type} ${view}: dressed on low`); continue; }
        if (dresses.length !== 1) { problems.push(`${quality} ${type} ${view}: ${dresses.length} dressing meshes`); continue; }
        const blood = bloodVertices(dresses[0].geometry);
        if (blood) problems.push(`${quality} ${type} ${view}: ${blood} blood vertices (${dresses[0].geometry === roots.get(type).dress.geometry ? '_Dress' : '_DressFlat'})`);
      }
    } finally { setWeaponStyle(null); style.dispose(); }
  }
  assert.deepEqual(problems, []);
  assert.equal(getWeaponStyle(), null);
});
