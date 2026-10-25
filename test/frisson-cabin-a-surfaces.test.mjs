import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

// The cabin surfaces proposal (art/frisson/proposals/cabin-surfaces): the
// recipes module of art/frisson/CABIN.md section 4.3 in its two variants,
// brun (cabin-surfaces.js) and olive (cabin-surfaces-olive.js), each checked
// on its own (the helpers' rules as public/frisson/cabin.js applies them),
// against the world's materials and the targets of sections 1 and 2, and
// through the engineer's checker when the tree has it. Skipped once the
// proposal folder is gone (the owner picked another one, or copied one of
// the variants into public/).
const folder = new URL('../art/frisson/proposals/cabin-surfaces/', import.meta.url);
const VARIANTS = ['cabin-surfaces.js', 'cabin-surfaces-olive.js'];
const skip = !VARIANTS.every(name => existsSync(new URL(name, folder)));
const worldText = readFileSync(new URL('../public/world.js', import.meta.url), 'utf8');

// CABIN.md section 1: the keys a dressing restyles (world.js's own list once
// it has the hook), the Famille albedo of each family and the luminance it
// should keep, and the keys whose Famille material has a map.
const BRIEF_KEYS = ['wood', 'gable', 'interiorTimber', 'floor', 'boards', 'trim', 'roof', 'interiorPlaster', 'interiorWainscot', 'interiorSkirting',
  'foundation', 'brokenGlass', 'boardedGap', 'metal', 'sofa', 'cushion', 'paper', 'rackTimber', 'rackTrim', 'rackIron', 'lateSupplyTimber',
  'lateSupplyMetal', 'generatorChassis', 'generatorPaint', 'ground', 'clearingEarth', 'escapeTrail', 'distantRunoff', 'trunk', 'needles', 'needletips', 'rock'];
const worldKeys = /export const DRESSING_SURFACE_KEYS = Object\.freeze\(\[([^\]]*)\]\)/.exec(worldText)?.[1].match(/'(\w+)'/g)?.map(key => key.slice(1, -1)) ?? null;
const FAMILLE = { wood: [0x704c32, .8, .88], gable: [0x704c32, .8, .88], interiorTimber: [0x704c32, .8, .88], floor: [0x815c3e, .8, .9], boards: [0xba8550, .85, 1],
  roof: [0x4e5c6e, .75, .95], interiorPlaster: [0x74705d, .75, .9], interiorWainscot: [0x63573a, .75, .9], interiorSkirting: [0x63573a, .75, .9],
  sofa: [0x405247, .75, .9], cushion: [0x566454, .75, .9], generatorPaint: [0xa18a43, .85, 1.1], ground: [0x223b2f, .9, 1.05], clearingEarth: [0x294737, .9, 1.05],
  boardedGap: [0x0f1211, 0, 1] };
const SIZES = { logs: [512, 512], floorboards: [512, 512], board: [256, 32], shingles: [256, 256], wainscot: [512, 512], deadgrass: [256, 256], mudgrass: [256, 256] };
const PLANKS = ['logs', 'floorboards', 'wainscot'];

const srgbToLinear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const linearToSrgb = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const hexRgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(channel => channel / 255);
const luminance = srgb => { const [r, g, b] = srgb.map(srgbToLinear); return .2126 * r + .7152 * g + .0722 * b; };
// OKLab chroma of an sRGB colour (0-1).
function chroma(srgb) {
  const [r, g, b] = srgb.map(srgbToLinear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s);
}
const cssColour = value => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value) ?? /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(String(value).replace(/\s+/g, ''));
  if (!match) return null;
  const channels = match.slice(1).map(part => value.startsWith('#') ? parseInt(part, 16) : Number(part));
  return channels.every(channel => channel <= 255) ? channels : null;
};
// world.js's canvasTexture seed: the texture's name gives its draw.
function seeded(name) {
  let seed = [...name].reduce((sum, char) => sum * 31 + char.charCodeAt(0) >>> 0, 2166136261);
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
// A recipe drawn as cabin.js draws it: rect() in whole cells with an opaque
// colour, wrapping across the tile, recorded as fills (pixels) and as cells.
function draw(name, { size, grid, draw: paint }, half = false) {
  const [columns, rows] = grid, cellX = size[0] / columns / (half ? 2 : 1), cellY = size[1] / rows / (half ? 2 : 1);
  const fills = [], cells = new Array(columns * rows).fill(null);
  const rect = (x, y, w, h, colour) => {
    assert.ok([x, y, w, h].every(Number.isInteger) && w >= 1 && h >= 1, `${name}: rect(${x}, ${y}, ${w}, ${h}) is not in whole cells`);
    const rgb = cssColour(colour);
    assert.ok(rgb, `${name}: ${colour} is not an opaque colour`);
    w = Math.min(w, columns); h = Math.min(h, rows); x = (x % columns + columns) % columns; y = (y % rows + rows) % rows;
    for (const [left, width] of x + w > columns ? [[x, columns - x], [0, x + w - columns]] : [[x, w]])
      for (const [top, height] of y + h > rows ? [[y, rows - y], [0, y + h - rows]] : [[y, h]]) {
        fills.push([colour, left * cellX, top * cellY, width * cellX, height * cellY]);
        for (let j = top; j < top + height; j++) for (let i = left; i < left + width; i++) cells[j * columns + i] = rgb;
      }
  };
  paint({ rect, random: seeded(name), grid: [columns, rows] });
  return { fills, cells };
}
function hsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return [(hue + 360) % 360, max ? delta / max : 0, max];
}

// Each variant loaded and drawn once.
const loaded = skip ? {} : Object.fromEntries(await Promise.all(VARIANTS.map(async name => {
  const url = new URL(name, folder), recipes = await import(url.href);
  const drawn = Object.fromEntries(Object.entries(recipes.CABIN_TEXTURES).map(([texture, recipe]) => [texture, draw(texture, recipe)]));
  const means = Object.fromEntries(Object.entries(drawn).map(([texture, { cells }]) => {
    const mean = [0, 0, 0];
    for (const cell of cells) for (let channel = 0; channel < 3; channel++) mean[channel] += srgbToLinear(cell[channel] / 255) / cells.length;
    return [texture, mean];
  }));
  // The albedo of a key: material colour x mean texel (sRGB 0-1).
  const albedo = key => {
    const { color = 0xffffff, texture } = recipes.CABIN_SURFACES[key], base = hexRgb(color).map(srgbToLinear);
    return (texture ? base.map((value, channel) => value * means[texture][channel]) : base).map(linearToSrgb);
  };
  return [name, { text: readFileSync(url, 'utf8'), recipes, drawn, albedo }];
})));
const ratio = ({ albedo }, light, dark) => (luminance(albedo(light)) + .05) / (luminance(albedo(dark)) + .05);

test('cabin surfaces A: the two variants are the same file but for the AGE line', { skip }, () => {
  const [brun, olive] = VARIANTS.map(name => loaded[name].text.split('\n'));
  assert.equal(brun.length, olive.length);
  const differ = brun.flatMap((line, index) => line === olive[index] ? [] : [[line, olive[index]]]);
  assert.deepEqual(differ, [['const AGE = Object.freeze({ hue: 0, chroma: 1, light: 1 });', 'const AGE = Object.freeze({ hue: 18, chroma: .74, light: .92 });']]);
  // The olive walls and floor: greyer and turned toward olive, as the critique asked (60-65 % of Famille's chroma).
  const { albedo } = loaded['cabin-surfaces-olive.js'];
  for (const key of ['wood', 'floor']) {
    const kept = chroma(albedo(key)) / chroma(hexRgb(FAMILLE[key][0]));
    assert.ok(kept >= .58 && kept <= .66, `olive ${key}: ${Math.round(kept * 100)} % of Famille's chroma`);
  }
});

for (const name of VARIANTS) {
  const variant = name === VARIANTS[0] ? 'brun' : 'olive';
  const get = () => loaded[name];

  test(`cabin surfaces A (${variant}): a pure, frozen data module with the three exports`, { skip }, () => {
    const { text, recipes } = get();
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
    assert.equal(/\b(import|require|document|window|globalThis|self|THREE|fetch|XMLHttpRequest|eval|Function|Date|performance|crypto)\b|Math\.random/.exec(code), null);
    assert.deepEqual(Object.keys(recipes).sort(), ['CABIN_OBJECTS', 'CABIN_SURFACES', 'CABIN_TEXTURES']);
    for (const exported of ['CABIN_OBJECTS', 'CABIN_SURFACES', 'CABIN_TEXTURES']) {
      assert.ok(Object.isFrozen(recipes[exported]), exported);
      for (const [key, value] of Object.entries(recipes[exported])) assert.ok(Object.isFrozen(value), `${exported}.${key}`);
    }
  });

  test(`cabin surfaces A (${variant}): every key of section 1 is restyled, with values in range, maps only where Famille has one`, { skip }, () => {
    const { recipes } = get();
    if (worldKeys) assert.deepEqual([...worldKeys].sort(), [...BRIEF_KEYS].sort(), 'world.js and CABIN.md list the same keys');
    assert.deepEqual(Object.keys(recipes.CABIN_SURFACES).sort(), [...BRIEF_KEYS].sort());
    for (const [key, look] of Object.entries(recipes.CABIN_SURFACES)) {
      for (const property of Object.keys(look)) assert.ok(['color', 'roughness', 'metalness', 'opacity', 'texture'].includes(property), `${key}.${property}`);
      if (look.color !== undefined) assert.ok(Number.isInteger(look.color) && look.color >= 0 && look.color <= 0xffffff, key);
      for (const property of ['roughness', 'metalness', 'opacity']) if (look[property] !== undefined) assert.ok(look[property] >= 0 && look[property] <= 1, `${key}.${property}`);
      if (look.opacity !== undefined) assert.equal(key, 'brokenGlass', 'opacity only where Famille is transparent');
      // A texture only where world.js gives the Famille material a map.
      const famille = new RegExp(`material\\('${key}',[^\\n]*`).exec(worldText)?.[0] ?? '';
      assert.equal(/\bmap:/.test(famille), look.texture !== undefined, `${key}: texture where Famille has a map, and only there`);
      if (look.texture !== undefined) assert.ok(Object.hasOwn(recipes.CABIN_TEXTURES, look.texture), `${key}: ${look.texture}`);
    }
    assert.deepEqual(recipes.CABIN_OBJECTS, { decorFlowerHeads: { visible: false }, decorFlowerStems: { visible: false }, decorGlowingCaps: { color: 0x2b3a33 } });
  });

  test(`cabin surfaces A (${variant}): every recipe draws in whole cells, the same twice, at both sizes, inside its canvas`, { skip }, () => {
    const { recipes, drawn } = get();
    assert.deepEqual(Object.keys(recipes.CABIN_TEXTURES).sort(), Object.keys(SIZES).sort());
    for (const [texture, recipe] of Object.entries(recipes.CABIN_TEXTURES)) {
      const { size, grid } = recipe;
      assert.deepEqual([...size], SIZES[texture], `${texture}: Famille's size`);
      for (const axis of [0, 1]) assert.ok(size[axis] % grid[axis] === 0 && (size[axis] / grid[axis]) % 2 === 0, `${texture}: whole, even cells`);
      const full = drawn[texture], again = draw(texture, recipe), half = draw(texture, recipe, true);
      assert.deepEqual(again.fills, full.fills, `${texture}: deterministic`);
      assert.deepEqual(half.fills, full.fills.map(([colour, ...box]) => [colour, ...box.map(value => value / 2)]), `${texture}: the low draw is the high one at half scale`);
      assert.ok(full.fills.every(([, x, y, w, h]) => x >= 0 && y >= 0 && x + w <= size[0] && y + h <= size[1]), `${texture}: inside the canvas`);
      assert.ok(full.cells.every(Boolean), `${texture}: every cell painted`);
      // Cheap to build: a few thousand fills at most (one draw per room join).
      assert.ok(full.fills.length < 3000, `${texture}: ${full.fills.length} fills`);
    }
  });

  test(`cabin surfaces A (${variant}): the planks keep world.js's eight rows with the seam at the bottom of each`, { skip }, () => {
    const { recipes, drawn } = get();
    for (const texture of PLANKS) {
      const { cells } = drawn[texture], [columns] = recipes.CABIN_TEXTURES[texture].grid;
      const rowLight = row => cells.slice(row * columns, (row + 1) * columns).reduce((sum, cell) => sum + luminance(cell.map(value => value / 255)), 0) / columns;
      for (let course = 0; course < 8; course++) {
        const face = Array.from({ length: 14 }, (_, row) => rowLight(course * 16 + row)), seam = rowLight(course * 16 + 15);
        assert.ok(seam < .7 * face.reduce((sum, value) => sum + value, 0) / face.length && seam <= Math.min(...face), `${texture} course ${course}: the seam is the darkest row`);
      }
    }
  });

  test(`cabin surfaces A (${variant}): the albedos follow section 1 and the readability ratios of section 2 hold`, { skip }, () => {
    const loadedVariant = get(), { albedo } = loadedVariant;
    for (const [key, [famille, min, max]] of Object.entries(FAMILLE)) {
      const kept = luminance(albedo(key)) / luminance(hexRgb(famille));
      assert.ok(kept >= min - 1e-3 && kept <= max + 1e-3, `${key}: ${Math.round(kept * 100)} % of Famille's luminance, section 1 aims at ${min * 100}-${max * 100} %`);
    }
    for (const [light, dark, min] of [['boards', 'wood', 2], ['wood', 'rackTimber', 1.22], ['escapeTrail', 'clearingEarth', 1.25]])
      assert.ok(ratio(loadedVariant, light, dark) >= min, `${light} over ${dark} ${ratio(loadedVariant, light, dark).toFixed(3)}`);
    // The barricade planks stay the lightest wood.
    for (const key of ['wood', 'floor', 'interiorTimber', 'rackTimber', 'interiorWainscot']) assert.ok(luminance(albedo('boards')) > luminance(albedo(key)), key);
  });

  test(`cabin surfaces A (${variant}): no texture colour is a pickup hue or blood red`, { skip }, () => {
    for (const [texture, { fills }] of Object.entries(get().drawn)) for (const colour of new Set(fills.map(([style]) => style))) {
      const rgb = cssColour(colour).map(value => value / 255), [hue, saturation, value] = hsv(rgb);
      assert.ok(!(saturation > .5 && value > .4 && hue >= 40 && hue <= 200), `${texture}: ${colour} is a pickup hue`);
      assert.ok(!(rgb[0] > .1 && rgb[0] > 3 * rgb[1] && rgb[0] > 3 * rgb[2]), `${texture}: ${colour} is blood red`);
    }
  });

  // The engineer's checker (tools/frisson-glb-check.mjs --surfaces), once the
  // tree has the cabin hook: no contract error and no warning.
  const checker = new URL('../tools/frisson-glb-check.mjs', import.meta.url);
  const checkerText = existsSync(checker) ? readFileSync(checker, 'utf8') : '';
  test(`cabin surfaces A (${variant}): the cabin checker passes it without a warning`, { skip: skip || !checkerText.includes('checkFrissonCabinSurfaces') ? 'no proposal or no cabin checker in this tree' : false }, async () => {
    const { checkFrissonCabinSurfaces } = await import(checker.href);
    const { errors, warnings } = await checkFrissonCabinSurfaces(get().recipes, { text: get().text });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });
}

test('cabin surfaces A: the notes and the in-engine renders are there and stay small', { skip }, () => {
  assert.ok(existsSync(new URL('NOTES.md', folder)));
  const renders = new URL('renders/', folder), names = readdirSync(renders).filter(name => name.endsWith('.png'));
  assert.ok(names.length >= 6, names.join());
  for (const variant of ['brun', 'olive']) assert.ok(names.some(name => name.includes(variant)), `renders of ${variant}`);
  let bytes = 0;
  for (const name of names) {
    const file = new URL(name, renders);
    assert.deepEqual([...readFileSync(file).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
    bytes += statSync(file).size;
  }
  assert.ok(bytes < 6.5 * 1024 * 1024, `${(bytes / 1048576).toFixed(1)} MB of renders`);
});
