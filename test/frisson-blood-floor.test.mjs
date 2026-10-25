import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { WORLD } from '../simulation.mjs';
import { coverPieces } from '../public/layout.js';
import { STAIRS, STAIR_WELL, stairTreadY, LOFT } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { COVERS, TABLE, ARC_SOLIDS, LOFT_SLABS, TREAD_BOXES, CONTACT, SOLID_COUNT, OPEN_WINDOWS, FLOOR_IO, restingSurface, restingSurfaceIO, blockedAt, freeTravel,
  squareRests, arcContact, openWindowAt } = await importPublicModule('frisson/blood-floor.js');
const { WINDOWS, EXTERIOR_WALL_THICKNESS } = await import('../public/layout.js');

// simulation.mjs keeps restingSurface to itself (it is not exported), and the
// browser cannot import the server: the server's own source text is run here,
// with the names it uses, so any change to it on the server shows up.
const SERVER = readFileSync(new URL('../simulation.mjs', import.meta.url), 'utf8');
function serverText(pattern, what) {
  const match = SERVER.match(pattern);
  assert.ok(match, `simulation.mjs no longer has ${what}`);
  return match[0];
}
assert.match(SERVER, /stairTreadY as stairStepY/, 'stairStepY is still the shared stairTreadY');
assert.match(SERVER, /import \{[^}]*\bSTAIR_WELL\b[^}]*\} from '\.\/public\/stairs\.js'/);
const serverRestingSurface = new Function('WORLD', 'STAIR_WELL', 'coverPieces', 'stairStepY', 'IS_SUPERMARKET', [
  serverText(/^const inRect = .*$/m, 'inRect'), serverText(/^const isStair = .*$/m, 'isStair'),
  serverText(/^function restingSurface\(x, z, fromY\) \{\r?\n[\s\S]*?\r?\n\}/m, 'restingSurface'), 'return restingSurface;',
].join('\n'))(WORLD, STAIR_WELL, coverPieces, stairTreadY, false);

test('the blood floor uses exactly the server furniture, loft and stairs', () => {
  const shape = cover => JSON.stringify({ id: cover.id, minX: cover.minX, maxX: cover.maxX, minZ: cover.minZ, maxZ: cover.maxZ,
    baseY: cover.baseY ?? 0, height: cover.height, parts: (cover.parts ?? []).map(part => [part.minX, part.maxX, part.minZ, part.maxZ, part.height]) });
  assert.deepEqual(COVERS.map(shape), WORLD.covers.map(shape));
  assert.ok(WORLD.covers.some(cover => shape(cover) === shape(TABLE)), 'the table copy matches simulation.mjs');
  assert.equal(WORLD.stair, STAIRS);
  assert.equal(WORLD.loft, LOFT);
  assert.equal(WORLD.loftY, LOFT.y);
});

test('restingSurface matches the server\'s own function on a grid over the cabin, at every height', () => {
  let checked = 0;
  for (let x = -8.2; x <= 8.2; x += .1) for (let z = -6.2; z <= 6.2; z += .1) for (const fromY of [.3, .5, 1, 2, 3.5, 5]) {
    assert.equal(restingSurface(x, z, fromY), serverRestingSurface(x, z, fromY), `(${x.toFixed(2)}, ${z.toFixed(2)}) from ${fromY}`);
    checked++;
  }
  // The edges themselves: the loft rim, the well, the flight's sides and treads.
  for (const x of [LOFT.minX, STAIR_WELL.minX, STAIR_WELL.maxX, STAIRS.minX, STAIRS.maxX]) for (let z = -6; z <= 6; z += .03125) {
    for (const fromY of [.5, 2, 3.5]) { assert.equal(restingSurface(x, z, fromY), serverRestingSurface(x, z, fromY)); checked++; }
  }
  assert.ok(checked > 100000);
});

test('the ground, the loft, the stair well, the treads and the furniture tops', () => {
  assert.equal(restingSurface(-1, 1.5, 1), 0, 'open ground floor');
  assert.equal(restingSurface(5, -4, 4), LOFT.y, 'the loft from above');
  assert.equal(restingSurface(5, -4, 1), 0, 'under the loft');
  assert.equal(restingSurface(4.75, 0, 5), 0, 'the stair well beside the treads drops to the ground');
  assert.equal(restingSurface(3.8, 0, 5), stairTreadY(0), 'a tread');
  assert.equal(restingSurface(-.9, -.4, 1.2), .8, 'the table top');
  assert.equal(restingSurface(-.9, -.4, .5), 0, 'under the table top');
  assert.equal(restingSurface(-4.6, 2.8, 1), .48, 'the sofa seat');
  assert.equal(restingSurface(-4.6, 3.35, 1), .8, 'the sofa back');
});

test('blocked columns and paths: walls and furniture on the floor block, a suspended rack does not', () => {
  assert.equal(blockedAt(0, -2, .05, .25), true, 'the partition');
  assert.equal(blockedAt(-.9, -.4, .05, .25), true, 'the table on the ground floor');
  assert.equal(blockedAt(-.9, -.4, .85, 1.05), false, 'above the table top');
  assert.equal(blockedAt(-6.3, 5.95, .05, .25), true, 'the south wall');
  assert.equal(blockedAt(-6.3, 5.65, .05, .25), false, 'under a wall rack hung at 0.9 m');
  assert.equal(blockedAt(0, 6, .05, .25), false, 'the south doorway');
  assert.equal(blockedAt(0, 6, 3.45, 3.65), true, 'above the doorway');
  assert.ok(Math.abs(freeTravel(0, -1.5, 0, -2.5, .05, .25) - (1.5 - 1.88) / -1) < 1e-9, 'stops at the partition face');
  assert.equal(freeTravel(0, -1.5, 0, -1.7, .05, .25), 1, 'a short path in the open');
  assert.equal(freeTravel(0, 5, 0, 7, .05, .25), 1, 'through a doorway');
  assert.ok(freeTravel(-4, 5, -4, 7, .05, .25) < 1, 'not through a wall');
  assert.equal(freeTravel(0, -2, 0, -1, .05, .25), 1, 'a path that starts in a solid ignores it');
  assert.equal(freeTravel(-1, .6, -1, -.2, 1, 1.1), 1, 'over the table');
});

test('a flat square rests only where all of it lies on one surface', () => {
  assert.equal(squareRests(5, -4, .025, LOFT.y), true, 'the open loft');
  assert.equal(squareRests(.5, 0, .025, LOFT.y), false, 'centred on the loft edge: half of it over the drop');
  assert.equal(squareRests(.525, 0, .025, LOFT.y), true, 'flush with the loft edge');
  assert.equal(squareRests(STAIR_WELL.maxX, 0, .025, LOFT.y), false, 'over the stair well');
  assert.equal(squareRests(STAIRS.minX, .1, .0125, stairTreadY(.1)), false, 'over the side of the flight');
  const riser = STAIRS.maxZ - 3 * (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps;
  assert.equal(squareRests(3.8, riser + .02, .025, stairTreadY(riser + .02)), false, 'across a riser');
  assert.equal(squareRests(3.8, riser + .1, .025, stairTreadY(riser + .1)), true, 'on one tread');
  assert.equal(squareRests(-.9, -.4, .025, .8), true, 'the table top');
  assert.equal(squareRests(.2, -.4, .025, .8), false, 'over the table edge');
  assert.equal(squareRests(.2 + .02, -.4, .025, 0), false, 'beside the table: a corner under it');
  assert.equal(squareRests(.2 + .025, -.4, .025, 0), true, 'flush with the table');
  assert.equal(squareRests(0, -1.86, .025, 0), false, 'a corner in the partition');
  assert.equal(squareRests(0, -1.86, .0125, 0), true, 'clear of the partition');
});

test('droplet arcs: the solids are the walls, the furniture, the loft floor and the treads', () => {
  assert.equal(LOFT_SLABS.length, 4);
  for (const slab of LOFT_SLABS) {
    assert.equal(slab.top, LOFT.y);
    for (const [x, z] of [[slab.minX + .01, slab.minZ + .01], [slab.maxX - .01, slab.maxZ - .01]]) assert.equal(restingSurface(x, z, 5), LOFT.y, 'over the loft, never the well');
  }
  assert.equal(TREAD_BOXES.length, STAIRS.steps);
  for (const tread of TREAD_BOXES) {
    const z = (tread.minZ + tread.maxZ) / 2;
    assert.ok(Math.abs(tread.top - stairTreadY(z)) < 1e-12, 'a tread\'s top is the server\'s step height');
    assert.ok(Math.abs(tread.top - stairTreadY(tread.minZ + 1e-6)) < 1e-12 && Math.abs(tread.top - stairTreadY(tread.maxZ - 1e-6)) < 1e-12, 'over its whole run');
  }
  assert.ok(ARC_SOLIDS.length > LOFT_SLABS.length + TREAD_BOXES.length);
});

test('arcContact: what an arc meets first, a top, a side, an underside or nothing', () => {
  const out = {}, g = 9, half = .015;
  const ground = (y, vy) => (vy + Math.sqrt(vy * vy + 2 * g * (y - half))) / g;
  // Down onto the table top.
  arcContact(-.9, 1.3, .1, 0, .5, -.6, g, half, ground(1.3, .5), out);
  assert.equal(out.kind, CONTACT.TOP); assert.equal(out.top, .8);
  const y = 1.3 + .5 * out.time - g * out.time ** 2 / 2;
  assert.ok(Math.abs(y - (.8 + half)) < 1e-9, 'its cube comes down on the top');
  // Into the side of the waist-high wall (top 1.15), 35 cm away at 1.3 m.
  arcContact(.43, 1.3, 3.6, 1.5, 0, 0, g, half, ground(1.3, 0), out);
  assert.equal(out.kind, CONTACT.SIDE);
  assert.ok(Math.abs(out.enter - (.78 - half - .43) / 1.5) < 1e-9, 'when the cube reaches the face');
  // The face it meets, for a wall pixel: the -x face, the solid's bottom and top, one of the walls blood sticks to.
  assert.equal(out.normalX, -1); assert.equal(out.normalZ, 0); assert.equal(out.bottom, 0); assert.equal(out.top, 1.15);
  assert.ok(out.index >= 0 && out.index < SOLID_COUNT && ARC_SOLIDS[out.index].minX === .78);
  // The same wall from the other side, and the partition's +z face from the living room.
  arcContact(1.4, 1.3, 3.6, -1.5, 0, 0, g, half, ground(1.3, 0), out);
  assert.equal(out.kind, CONTACT.SIDE); assert.equal(out.normalX, 1); assert.equal(out.normalZ, 0);
  arcContact(0, 1.2, -1.5, .1, .5, -2, g, half, ground(1.2, .5), out);
  assert.equal(out.kind, CONTACT.SIDE); assert.equal(out.normalX, 0); assert.equal(out.normalZ, 1);
  assert.ok(Math.abs(ARC_SOLIDS[out.index].maxZ - -1.88) < 1e-9);
  // A tread's riser is a side too, but not a wall blood sticks to.
  arcContact(3.8, .3, 2.9, 0, .2, -2, g, half, ground(.3, .2), out);
  if (out.kind === CONTACT.SIDE) assert.ok(out.index >= SOLID_COUNT, 'the stairs come after the walls and furniture');
  // Up into the pistol rack's underside (0.9 m), from below it.
  arcContact(-6.3, .7, 5.75, 0, 2, 0, g, half, ground(.7, 2), out);
  assert.equal(out.kind, CONTACT.CEILING);
  assert.ok(Math.abs(out.low - (.9 - half)) < 1e-9);
  // Nothing in the open, a solid it starts in, one it starts beside and leaves.
  arcContact(-1, 1.2, 1.5, 1, .5, 0, g, half, ground(1.2, .5), out);
  assert.equal(out.kind, CONTACT.NONE);
  arcContact(0, 1.2, -2, 0, .5, 1, g, half, ground(1.2, .5), out);
  assert.equal(out.kind, CONTACT.NONE, 'starting in the partition, heading out');
  arcContact(0, 1.2, -1.87, 0, .5, 1, g, half, ground(1.2, .5), out);
  assert.equal(out.kind, CONTACT.NONE, 'starting against the partition, heading away');
  arcContact(0, 1.2, -1.87, 0, .5, -1, g, half, ground(1.2, .5), out);
  assert.equal(out.kind, CONTACT.SIDE, 'starting against the partition, heading into it');
  // A riser on the stairs, thrown uphill from a tread.
  arcContact(3.8, stairTreadY(1) + .3, 1, 0, .3, -1.5, g, half, ground(stairTreadY(1) + .3, .3), out);
  assert.ok(out.kind === CONTACT.SIDE || out.kind === CONTACT.TOP);
});

test('openWindowAt: within .3 m of the plane of an outer wall, inside a glassless window; boarded windows and the doorway are not', () => {
  assert.equal(OPEN_WINDOWS.length, 4, 'one glassless window per wall');
  for (const window of WINDOWS) {
    const at = (along, y, across) => window.axis === 'x' ? openWindowAt(along, y, across) : openWindowAt(across, y, along);
    const middle = (window.bottom + window.top) / 2;
    assert.equal(at(window.center, middle, window.fixed), window.open, window.id);
    assert.equal(at(window.center, middle, window.fixed + .29), window.open, `${window.id}: the inner face side`);
    assert.equal(at(window.center, middle, window.fixed - .29), window.open, `${window.id}: outside`);
    assert.equal(at(window.center, middle, window.fixed + .31), false, `${window.id}: in the room`);
    assert.equal(at(window.center + window.width / 2 - .01, middle, window.fixed), window.open, `${window.id}: its edge`);
    assert.equal(at(window.center + window.width / 2 + .01, middle, window.fixed), false, `${window.id}: beside it`);
    assert.equal(at(window.center, window.bottom - .01, window.fixed), false, `${window.id}: under the sill`);
    assert.equal(at(window.center, window.top + .01, window.fixed), false, `${window.id}: above it`);
  }
  assert.ok(EXTERIOR_WALL_THICKNESS / 2 < .3, 'both faces of the wall are within reach');
  assert.equal(openWindowAt(0, 1.5, -6), false, 'the doorway is not a window');
});

test('the register entry points are the same code: restingSurfaceIO equals restingSurface', () => {
  for (let x = -8; x <= 8; x += .37) for (let z = -6; z <= 6; z += .41) for (const fromY of [.5, 2, 4]) {
    FLOOR_IO[0] = x; FLOOR_IO[1] = fromY; FLOOR_IO[2] = z;
    restingSurfaceIO();
    assert.equal(FLOOR_IO[9], restingSurface(x, z, fromY));
  }
});
