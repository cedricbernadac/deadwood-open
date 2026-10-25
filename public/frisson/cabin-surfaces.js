// Frisson cabin surfaces: a surface artist's proposal (art/frisson/CABIN.md,
// sections 1 and 4.3), to be copied over public/frisson/cabin-surfaces.js
// if the owner picks it. The same cabin, many nights into the siege: dark
// weathered boards, some gone grey, some black with damp, dirt and mould
// packed in the seams, gaps where boards shrank, checks split from the board
// ends, knots and nails, worm holes, rot at the board ends, rust run down
// from the nails, water come in through the seams, damp blotches, a dirty,
// stained floor, flaking paint on the low wall, clawed barricade planks, a
// mossy roof with missing shingles, and dead, trampled grass. Gameplay
// colours are never touched (CABIN.md section 2), and the probes of the
// cabin shooter keep their contrast (NOTES.md).
//
// Two variants, the same file but for the AGE line below: cabin-surfaces.js
// ("brun") and cabin-surfaces-olive.js ("olive"). NOTES.md compares them.
//
// A pure data module: no import, no THREE, no DOM; deterministic. cabin.js
// fetches it and draws each texture through its helpers: rect(x, y, w, h,
// colour) in whole cells with an opaque CSS colour, wrapping across the tile
// edges, and random(), seeded from the texture's name. Each recipe first
// paints its own grid of cells (fills, darkening and blending, always on
// whole cells, so every edge stays hard), then hands the grid to rect() as
// the fewest rectangles: one flat colour each, no gradient, alpha or path.

// --- Age: the one line the two variants differ by ---------------------------------
// The wall and floor wood (and its seams and dirt) turned `hue` degrees in
// OKLCh toward olive, its chroma scaled by `chroma` and its luminance by
// `light`. Racks, barricade planks, rust and mould keep their own hue.
// brun: { hue: 0, chroma: 1, light: 1 }; olive: { hue: 18, chroma: .74, light: .92 }.
const AGE = Object.freeze({ hue: 18, chroma: .74, light: .92 });

// --- Cells -----------------------------------------------------------------------------
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const shaded = (colour, k) => colour.map((value, channel) => value * (Array.isArray(k) ? k[channel] : k));
const mix = (a, b, t) => a.map((value, channel) => value + (b[channel] - value) * t);
const pick = (random, count) => Math.floor(random() * count);
const span = (random, min, max) => min + pick(random, max - min + 1);
const chance = (random, odds) => random() < odds;

// Colours: sRGB 0-255 to linear and back, luminance, 0xrrggbb.
const toLinear = value => (value /= 255) <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const toSrgb = value => 255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055);
const luma = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
const hex = colour => colour.reduce((value, channel) => value << 8 | clamp(channel), 0);
// Only the luminance scaled (the racks keep their hue and their ratio to the walls).
const dimmed = colour => colour.map(value => toSrgb(toLinear(value) * AGE.light));
// A colour aged as AGE says.
function aged(colour) {
  if (AGE.hue === 0 && AGE.chroma === 1 && AGE.light === 1) return colour;
  const rgb = colour.map(toLinear);
  const [l, m, s] = [[.4122214708, .5363325363, .0514459929], [.2119034982, .6806995451, .1073969566], [.0883024619, .2817188376, .6299787005]]
    .map(row => Math.cbrt(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s, a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, b = .0259040371 * l + .7827717662 * m - .808675766 * s;
  const chroma = Math.hypot(a, b) * AGE.chroma, hue = Math.atan2(b, a) + AGE.hue * Math.PI / 180, A = chroma * Math.cos(hue), B = chroma * Math.sin(hue);
  const [l3, m3, s3] = [L + .3963377774 * A + .2158037573 * B, L - .1055613458 * A - .0638541728 * B, L - .0894841775 * A - 1.291485548 * B].map(value => value ** 3);
  const out = [4.0767416621 * l3 - 3.3077115913 * m3 + .2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - .3413193965 * s3, -.0041960863 * l3 - .7034186147 * m3 + 1.707614701 * s3].map(value => Math.max(0, value));
  const k = AGE.light * luma(rgb) / luma(out);
  return out.map(value => toSrgb(Math.min(1, value * k)));
}

// A tile of cells, sRGB 0-255, wrapping at its edges like rect().
function cellGrid([columns, rows]) {
  const cells = new Float32Array(columns * rows * 3);
  const at = (x, y) => ((((y % rows) + rows) % rows) * columns + (((x % columns) + columns) % columns)) * 3;
  const each = (x, y, w, h, paint) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) paint(at(x + i, y + j)); };
  return {
    columns, rows,
    fill: (x, y, w, h, colour) => each(x, y, w, h, index => cells.set(colour, index)),
    shade: (x, y, w, h, k) => each(x, y, w, h, index => { for (let c = 0; c < 3; c++) cells[index + c] *= Array.isArray(k) ? k[c] : k; }),
    blend: (x, y, w, h, colour, t) => each(x, y, w, h, index => { for (let c = 0; c < 3; c++) cells[index + c] += (colour[c] - cells[index + c]) * t; }),
    // The grid through rect(): runs of one colour per row, stacked into
    // rectangles while the rows below repeat them.
    paint(rect) {
      const key = index => clamp(cells[index]) << 16 | clamp(cells[index + 1]) << 8 | clamp(cells[index + 2]);
      const css = value => `rgb(${value >> 16},${value >> 8 & 255},${value & 255})`;
      let open = new Map();
      for (let y = 0; y <= rows; y++) {
        const next = new Map();
        for (let x = 0; y < rows && x < columns;) {
          const value = key((y * columns + x) * 3);
          let end = x + 1;
          while (end < columns && key((y * columns + end) * 3) === value) end++;
          const id = `${x},${end},${value}`, box = open.get(id);
          if (box) { box.h++; open.delete(id); next.set(id, box); } else next.set(id, { x, y, w: end - x, h: 1, value });
          x = end;
        }
        for (const box of open.values()) rect(box.x, box.y, box.w, box.h, css(box.value));
        open = next;
      }
    },
  };
}

// --- Planks ------------------------------------------------------------------------------
// Eight 30 cm courses per tile, 16 cells each, the seam in the bottom two
// cells (world.js's plank layout, which the world-mapped walls, seals and
// gables line up on). Each course is one long board, a few with a shorter
// one patched in, each board its own wood.
const COURSE = 16, FACE = 14;
// How far apart two columns are, round the tile.
const apart = (a, b, columns) => Math.min(((a - b) % columns + columns) % columns, ((b - a) % columns + columns) % columns);
// The studs (every 60 cm) a look nails its boards to.
const studs = (look, columns) => { const list = []; for (let stud = look.nails.phase; stud < columns; stud += look.nails.pitch) list.push(stud); return list; };
function courses(grid, random, look) {
  const list = [], patched = new Set();
  while (patched.size < look.patched) patched.add(pick(random, 8));
  for (let row = 0; row < 8; row++) {
    const top = row * COURSE, first = pick(random, grid.columns), joints = [first];
    if (patched.has(row)) joints.push(first + span(random, 44, 84));
    const boards = joints.map((x, index) => {
      const end = index + 1 < joints.length ? joints[index + 1] : first + grid.columns;
      let roll = random(), kind = look.kinds[0];
      for (const candidate of look.kinds) { kind = candidate; roll -= candidate.share; if (roll < 0) break; }
      const tone = shaded(mix(look.base, kind.toward ?? look.base, kind.t ?? 0), kind.k * (1 - look.vary + random() * 2 * look.vary));
      return { x: x + 1, length: end - x - 1, tone, knots: [] };
    });
    for (const board of boards) grid.fill(board.x, top, board.length, FACE, board.tone);
    list.push({ top, joints, boards });
  }
  return list;
}
// Grain: broken 1-cell lines along the board, darker and a few lighter;
// the top edge catching the light, chipped; grime along the lower edge.
function grain(grid, random, { top, boards }, look) {
  for (const board of boards) {
    for (let count = Math.max(1, Math.round(board.length / look.grain.every)); count > 0; count--) {
      const length = span(random, 6, Math.min(44, board.length)), light = chance(random, look.grain.light);
      grid.shade(board.x + pick(random, board.length - length + 1), top + 2 + pick(random, FACE - 4), length, 1, light ? look.grain.up : look.grain.down);
    }
    grid.shade(board.x, top, board.length, 1, look.lip);
    for (let chip = span(random, 0, 2); chip > 0; chip--) grid.shade(board.x + pick(random, board.length), top, span(random, 1, 3), 1, .8);
    grid.shade(board.x, top + FACE - 1, board.length, 1, look.low);
    if (look.grimy) for (let x = board.x + pick(random, 8); x < board.x + board.length - 2; x += span(random, 8, 30)) grid.shade(x, top + FACE - 2, Math.min(span(random, 4, 16), board.x + board.length - x), 1, (1 + look.low) / 2);
  }
}
// Knots; checks split along the grain from where wood splits (the board
// ends, the knots and the nails), 3 to 12 cells, most of them mid-dark, a
// few open and near black; worm holes and grit; rot eating into an end
// (dark, a hole, specks of mould round it).
function wear(grid, random, { top, boards }, look, nailed) {
  const { splits } = look;
  for (const board of boards) {
    const starts = [[board.x, 1, null], [board.x + board.length - 1, -1, null]];
    if (board.length > 10 && chance(random, look.knots)) {
      const x = board.x + 3 + pick(random, board.length - 7), y = top + 4 + pick(random, FACE - 8);
      grid.shade(x - 1, y, 4, 2, .86); grid.shade(x, y - 1, 2, 4, .86); grid.shade(x, y, 2, 2, .72);
      starts.push([x + 3, 1, y + pick(random, 2)], [x - 2, -1, y + pick(random, 2)]);
    }
    for (const stud of nailed) {
      const offset = ((stud - board.x) % grid.columns + grid.columns) % grid.columns;
      if (offset > 2 && offset < board.length - 3) for (const row of look.nails.rows) starts.push([stud + (chance(random, .5) ? 2 : -2), chance(random, .5) ? 1 : -1, top + row + pick(random, 3) - 1]);
    }
    for (let split = Math.round(board.length / 128 * splits.per + random() * .6); split > 0; split--) {
      const [x0, dir, y0] = starts[pick(random, starts.length)], length = Math.min(board.length - 2, span(random, 3, 12));
      const y = y0 ?? top + 2 + pick(random, FACE - 4), open = chance(random, splits.open), x = dir > 0 ? x0 : x0 - length + 1;
      grid.shade(x, y, length, 1, open ? splits.dark : splits.mid);
      // An open check gapes where it starts.
      if (open) grid.shade(dir > 0 ? x0 : x0 - 1, y + (y > top + FACE / 2 ? -1 : 1), 2, 1, splits.mid);
    }
    // Grit: worm holes and specks of dirt, alone or in pairs.
    for (let speck = Math.round(board.length * look.grit); speck > 0; speck--) {
      const x = board.x + pick(random, board.length), y = top + 1 + pick(random, FACE - 2);
      grid.shade(x, y, 1, 1, .7);
      if (chance(random, .35)) grid.shade(x + 1 + pick(random, 2), y + (chance(random, .5) ? 1 : 0), 1, 1, .78);
    }
    if (look.rot && board.length > 12 && chance(random, look.rot.odds)) {
      const atStart = chance(random, .5), w = span(random, 2, 5), h = span(random, 4, 9), x = atStart ? board.x : board.x + board.length - w;
      grid.blend(x, top + FACE - h, w, h, look.rot.colour, .55);
      const inner = Math.max(1, w - 2), lift = span(random, 1, 3);
      grid.blend(atStart ? x : x + w - inner, top + FACE - h - lift, inner, lift, look.rot.colour, .45);
      if (chance(random, .6)) grid.fill(atStart ? x : x + w - 1, top + FACE - span(random, 1, 3), 1, 1, look.rot.hole);
      for (let speck = span(random, 1, 3); speck > 0; speck--) grid.fill(x + pick(random, w), top + FACE - h - pick(random, 2), 1, 1, look.mould);
    }
  }
}
// The seam: the shadow under each board, then the dark gap, with dirt and
// mould packed in; the butt joints; gaps where a board shrank.
function seams(grid, random, { top, joints, boards }, look) {
  for (const board of boards) grid.fill(board.x - 1, top + FACE, board.length + 1, 1, shaded(board.tone, look.shadow));
  grid.fill(0, top + FACE + 1, grid.columns, 1, look.seam);
  for (let x = pick(random, 6); x < grid.columns; x += span(random, 5, 16)) {
    const length = span(random, 2, 7);
    grid.blend(x, top + FACE + pick(random, 2), length, 1, look.dirt, .6);
    if (chance(random, look.mouldy)) grid.fill(x + pick(random, length), top + FACE + pick(random, 2), span(random, 1, 2), 1, look.mould);
  }
  boards.forEach((board, index) => {
    const joint = joints[index];
    grid.fill(joint, top, 1, FACE, shaded(board.tone, look.joint));
    if (chance(random, look.mouldy)) grid.fill(joint + (chance(random, .5) ? 1 : -1), top + FACE - span(random, 1, 4), 1, span(random, 1, 2), look.mould);
  });
  for (const board of boards) if (chance(random, look.gaps)) {
    const length = Math.min(board.length, span(random, 3, 11));
    grid.fill(board.x + pick(random, board.length - length + 1), top + FACE - 1, length, 1, look.gap);
  }
}
// Nails on the studs (every 60 cm), some gone, some with rust run down
// (stepping paler as it runs) or a rust ring.
function nails(grid, random, list, look) {
  const { rows, odds, rust, run, ringed } = look.nails, nailed = studs(look, grid.columns);
  for (const { top, joints } of list) for (const stud of nailed) {
    if (joints.some(joint => apart(stud, joint, grid.columns) < 3)) continue;
    for (const offset of rows) {
      if (!chance(random, odds)) continue;
      const x = stud + pick(random, 3) - 1, y = top + offset;
      if (chance(random, ringed)) { grid.blend(x - 1, y, 3, 1, look.rust, .4); grid.blend(x, y - 1, 1, 3, look.rust, .4); }
      grid.fill(x, y, 1, 1, look.nail);
      if (chance(random, rust)) {
        const length = span(random, run[0], run[1]), third = Math.max(1, Math.round(length / 3));
        grid.blend(x, y + 1, 1, third, look.rust, .62);
        grid.blend(x, y + 1 + third, 1, third, look.rust, .42);
        grid.blend(x, y + 1 + 2 * third, 1, Math.max(1, length - 2 * third), look.rust, .26);
      }
    }
  }
}
// Water come in through a seam: a 2-cell run down the board under it, wet
// at its front, then down the next board or two, shifted at each seam,
// shorter and fainter each time, with a drip off its foot. Damp blotches
// over two or three courses, a dark heart where their lobes overlap, drips
// run down from them, mould in them. Neither is a height mark: they repeat
// with the tile.
function damp(grid, random, look) {
  const { runs, blotches } = look.damp;
  for (let count = runs.count; count > 0; count--) {
    let x = pick(random, grid.columns), course = pick(random, 8), k = runs.k;
    for (let leg = span(random, 1, 3); leg > 0; leg--) {
      const top = course * COURSE, h = span(random, 6, FACE), w = chance(random, .7) ? 2 : 1;
      grid.shade(x, top, w, 1, k - .06);
      grid.shade(x, top + 1, w, h - 1, k);
      if (h < FACE) grid.shade(x + pick(random, w), top + h, 1, span(random, 1, Math.min(3, FACE - h)), (k + 1) / 2);
      x += span(random, -2, 2); course = (course + 1) % 8; k = Math.min(.97, k + .05);
    }
  }
  for (let count = blotches.count; count > 0; count--) {
    const w = span(random, blotches.w[0], blotches.w[1]), h = span(random, blotches.h[0], blotches.h[1]), x = pick(random, grid.columns), y = pick(random, grid.rows);
    grid.shade(x, y, w, h, blotches.k);
    for (let lobe = span(random, 2, 4); lobe > 0; lobe--) {
      const lw = span(random, Math.ceil(w / 3), w - 2), lh = span(random, Math.ceil(h / 3), h - 1);
      grid.shade(x + span(random, -3, w - lw + 3), y + span(random, -3, h - lh + 2), lw, lh, (blotches.k + 1) / 2);
    }
    for (let drip = span(random, 1, 3); drip > 0; drip--) grid.shade(x + pick(random, w), y + h, 1, span(random, 2, 7), (blotches.k + 1) / 2);
    for (let speck = span(random, 2, 5); speck > 0; speck--) grid.blend(x + pick(random, w), y + pick(random, h), span(random, 1, 2), 1, look.mould, .7);
  }
}
function planks(helpers, look, extra) {
  const grid = cellGrid(helpers.grid), random = helpers.random, nailed = studs(look, grid.columns);
  // The layout: which of the seeded draws the tile starts from (NOTES.md).
  for (let skip = look.layout; skip > 0; skip--) random();
  const list = courses(grid, random, look);
  for (const course of list) { grain(grid, random, course, look); wear(grid, random, course, look, nailed); }
  extra?.(grid, random, list);
  for (const course of list) seams(grid, random, course, look);
  damp(grid, random, look);
  nails(grid, random, list, look);
  grid.paint(helpers.rect);
}

// --- Looks -------------------------------------------------------------------------------
// The walls: dark weathered brown, some boards gone grey, some dark with damp.
const WALL = {
  base: aged([115, 81, 53]), vary: .05, patched: 2, layout: 0,
  kinds: [{ share: .52, k: 1 }, { share: .26, k: .99, toward: aged([97, 89, 77]), t: .2 }, { share: .22, k: .88, toward: aged([70, 64, 49]), t: .25 }],
  grain: { every: 20, light: .25, up: 1.05, down: .9 }, lip: 1.05, low: .9, grimy: true,
  knots: .25, splits: { per: 1.6, open: .2, mid: .82, dark: .62 }, grit: .025, rot: { odds: .22, colour: aged([58, 48, 38]), hole: [24, 20, 17] },
  shadow: .68, seam: aged([48, 40, 32]), joint: .6, dirt: aged([70, 62, 50]), mould: [52, 57, 41], mouldy: .45, gap: [20, 17, 15], gaps: .2,
  damp: { runs: { count: 3, k: .76 }, blotches: { count: 4, w: [10, 20], h: [7, 14], k: .9 } },
  nail: [42, 37, 34], rust: [114, 70, 45],
  nails: { pitch: 32, phase: 9, rows: [6], odds: .8, rust: .25, run: [6, 14], ringed: 0 },
};
// The floor: the same boards, the dirtiest planks in the cabin: dirt packed
// dark in the seams, ground into the grain and in grit all over, dried
// spills and dark stains. Its dirt is fine-grained or balanced (a spill's
// dark tide line round a paler middle), and its boards stay close in value:
// pickups and crawlers land anywhere on it, and a dark patch the size of a
// pickup's ring would take their contrast (NOTES.md).
const FLOOR = {
  base: aged([125, 96, 64]), vary: .02, patched: 3, layout: 1,
  kinds: [{ share: .7, k: 1 }, { share: .15, k: 1.02 }, { share: .15, k: .95, toward: aged([88, 76, 60]), t: .15 }],
  grain: { every: 12, light: .1, up: 1.04, down: .88 }, lip: 1.04, low: .9, grimy: true,
  knots: .15, splits: { per: 1.2, open: .15, mid: .84, dark: .66 }, grit: .1, rot: null,
  shadow: .72, seam: aged([54, 45, 36]), joint: .66, dirt: aged([64, 57, 47]), mould: [58, 60, 46], mouldy: .12, gap: [30, 26, 22], gaps: .15,
  damp: { runs: { count: 0, k: 1 }, blotches: { count: 0, w: [1, 1], h: [1, 1], k: 1 } },
  nail: [56, 46, 37], rust: [116, 72, 46],
  nails: { pitch: 32, phase: 5, rows: [3, 10], odds: .75, rust: 0, run: [1, 1], ringed: .25 },
};
// Floor dirt: dried spills (a broken dark tide line round a paler middle,
// across a seam or two), small dark stains of 3-7 cells, some with a darker
// heart, and dirt trodden into the boards along the seams.
function floorDirt(grid, random, list) {
  for (let spill = 7; spill > 0; spill--) {
    const x = pick(random, grid.columns), y = pick(random, grid.rows), w = span(random, 7, 13), h = span(random, 4, 8);
    grid.shade(x + 1, y + 1, w - 2, h - 2, 1.04);
    for (const [ex, ey, ew, eh] of [[x + 1, y, w - 2, 1], [x + 1, y + h - 1, w - 2, 1], [x, y + 1, 1, h - 2], [x + w - 1, y + 1, 1, h - 2]])
      for (let at = 0; at < Math.max(ew, eh); at += span(random, 2, 4)) {
        const run = span(random, 2, 4);
        if (ew > 1) grid.shade(ex + at, ey, Math.min(run, ew - at), 1, .8); else grid.shade(ex, ey + at, 1, Math.min(run, eh - at), .8);
      }
  }
  for (let stain = 20; stain > 0; stain--) {
    const x = pick(random, grid.columns), y = pick(random, grid.rows), w = span(random, 3, 7), h = span(random, 2, 4);
    grid.shade(x, y, w, h, [.87, .87, .89]);
    grid.shade(x + 1 + pick(random, Math.max(1, w - 2)), y - 1, span(random, 2, 4), h + 2, [.92, .92, .94]);
    if (chance(random, .35)) grid.shade(x + 1 + pick(random, Math.max(1, w - 3)), y + pick(random, Math.max(1, h - 1)), span(random, 2, 3), span(random, 1, 2), .86);
  }
  for (const { top } of list) for (let x = pick(random, 12); x < grid.columns; x += span(random, 8, 20))
    grid.blend(x, top + FACE - 2 - pick(random, 2), span(random, 2, 6), 1, [70, 62, 52], .5);
}
// The low wall: the same boards painted grey-green, the paint gone in patches.
const WAINSCOT = {
  base: [87, 89, 75], vary: .03, patched: 2, layout: 0,
  kinds: [{ share: .7, k: 1 }, { share: .3, k: .94, toward: [84, 82, 70], t: .3 }],
  grain: { every: 30, light: .2, up: 1.04, down: .95 }, lip: 1.06, low: .9,
  knots: .05, splits: { per: 1, open: .2, mid: .8, dark: .64 }, grit: .02, rot: null,
  shadow: .62, seam: [38, 39, 34], joint: .55, dirt: [62, 62, 52], mould: [48, 54, 40], mouldy: .35, gap: [20, 19, 17], gaps: .15,
  damp: { runs: { count: 2, k: .84 }, blotches: { count: 1, w: [8, 14], h: [4, 9], k: .92 } },
  nail: [60, 60, 52], rust: [116, 72, 46],
  nails: { pitch: 32, phase: 13, rows: [6], odds: .7, rust: .3, run: [4, 10], ringed: 0 },
};
// Flakes: the dark wood under the paint, the lifted rim paler.
function flakes(grid, random, list) {
  for (const { top, boards } of list) for (const board of boards) {
    for (let flake = Math.round(board.length / 40 + random()); flake > 0; flake--) {
      const w = span(random, 2, 12), h = span(random, 1, 4), x = board.x + pick(random, Math.max(1, board.length - w)), y = top + 1 + pick(random, FACE - h - 1);
      grid.fill(x, y, w, h, shaded([58, 52, 45], .9 + random() * .2));
      if (w > 4 && h < 4) grid.fill(x + 1 + pick(random, w - 3), y + h, span(random, 1, 3), 1, [54, 48, 42]);
      grid.shade(x, y - 1, w, 1, 1.12);
    }
    for (let scuff = Math.round(board.length / 50); scuff > 0; scuff--) grid.shade(board.x + pick(random, board.length), top + FACE - 3 - pick(random, 4), span(random, 3, 8), 1, 1.07);
  }
}

// One barricade plank (256 x 32 px, cells of 2 px): rough-sawn wood nailed
// up during the siege, the newest and still the lightest, warmest wood in
// the cabin, with a light top edge and a dark warm underside so the plank
// reads against the night as Famille's does; splintered ends, chipped edges,
// one claw gouge set off the middle (three or four slanted strokes, the
// groove dark, the torn wood pale above it) and a shallow scratch set of
// one-cell strokes nearer the other end, rust-ringed nail holes near the
// ends, grey smudges of dirty hands. Every plank shows the whole tile, so
// the marks are few and small: a big set would repeat plank after plank.
function board({ rect, random, grid: size }) {
  const grid = cellGrid(size), [W] = size, base = [186, 141, 88];
  grid.fill(0, 0, W, 16, base);
  for (let line = 0; line < 7; line++) grid.shade(pick(random, W), 3 + pick(random, 10), span(random, 20, 90), 1, chance(random, .3) ? 1.05 : .91);
  grid.shade(0, 0, W, 1, 1.12); grid.shade(0, 1, W, 1, 1.06);
  grid.blend(0, 14, W, 1, [108, 68, 36], .55); grid.blend(0, 15, W, 1, [96, 58, 30], .8);
  // Splintered ends: a ragged edge one to three cells deep.
  for (const end of [0, W - 1]) for (let y = 0; y < 16; y += span(random, 2, 4)) {
    const depth = span(random, 1, 3);
    grid.shade(end === 0 ? 0 : W - depth, y, depth, span(random, 1, 3), .74);
  }
  // The gouge set: parallel strokes three rows apart, each stepping down a
  // cell per run of 2 cells.
  const strokes = 3, from = 84 + pick(random, 12), y0 = 2 + pick(random, 2);
  for (let stroke = 0; stroke < strokes; stroke++) {
    const length = 4 - pick(random, 2), x0 = from + stroke + pick(random, 2), y1 = y0 + stroke * 3;
    for (let step = 0; step < length && y1 + step < 13; step++) {
      const x = x0 + step * 2, y = y1 + step;
      grid.shade(x, y, 2, 1, .62);
      if (y > 1) grid.blend(x, y - 1, 2, 1, [214, 196, 162], .38);
    }
  }
  // The scratch set: one-cell strokes, shallow.
  for (let stroke = 0, x0 = 26 + pick(random, 10), y0 = 5 + pick(random, 4); stroke < 2; stroke++) grid.shade(x0 + stroke * 2, y0 + stroke * 2, span(random, 4, 6), 1, .8);
  // Chips knocked out of the edges, a knot.
  for (let chip = span(random, 2, 4); chip > 0; chip--) grid.shade(8 + pick(random, W - 16), chance(random, .5) ? 0 : 14, span(random, 2, 5), span(random, 1, 2), .7);
  if (chance(random, .7)) { const x = 20 + pick(random, W - 40), y = 5 + pick(random, 5); grid.shade(x - 1, y, 4, 2, .88); grid.shade(x, y, 2, 1, .66); }
  // Nail holes near each end, ringed with rust.
  for (const x of [5, W - 6]) for (const y of [4, 11]) {
    grid.blend(x - 1, y - 1, 3, 3, [124, 76, 46], .5); grid.fill(x, y, 1, 1, [44, 36, 31]);
  }
  for (let smudge = span(random, 2, 4); smudge > 0; smudge--) grid.shade(10 + pick(random, W - 20), 3 + pick(random, 9), span(random, 2, 6), span(random, 1, 3), [.88, .88, .9]);
  grid.paint(rect);
}
// Eight columns of shingles in staggered rows (cells of 4 px), each its own
// weathered tone (within 10 %) with a line or two of grain, the overlap a
// soft step darker rather than a black outline; olive moss grown across the
// shingles in clumps that ignore their edges, three to five shingles gone
// (near black, a batten showing), a few cracked, pale lichen specks.
function shingles({ rect, random, grid: size }) {
  const grid = cellGrid(size), [W, H] = size, base = [86, 98, 90], brown = [96, 90, 76], moss = [84, 92, 54], deepMoss = [62, 70, 44];
  let missing = 0;
  for (let column = 0; column < 8; column++) {
    const x = column * 8;
    for (let y = column % 2 ? -4 : 0; y < 64; y += 8) {
      if (missing < 5 && (chance(random, .07) || (column === 7 && y >= 52 && missing < 3))) {
        missing++; grid.fill(x, y, 8, 8, [24, 26, 24]); grid.fill(x, y + 3, 8, 1, [40, 37, 32]); continue;
      }
      const tone = shaded(mix(base, brown, random() * .6), .9 + random() * .2);
      grid.fill(x, y, 8, 8, tone);
      grid.shade(x + 1 + pick(random, 5), y, 1, span(random, 4, 7), chance(random, .5) ? .92 : 1.05);
      grid.shade(x, y, 1, 7, 1.05);
      grid.fill(x + 7, y, 1, 8, shaded(tone, .66)); grid.fill(x, y + 7, 7, 1, shaded(tone, .74));
      if (chance(random, .15)) grid.shade(x + 2 + pick(random, 4), y + 1, 1, span(random, 3, 5), .6);
      if (chance(random, .35)) grid.fill(x + 1 + pick(random, 5), y + 1 + pick(random, 4), 1, 1, [116, 122, 104]);
    }
  }
  // Moss: clumps of two or three overlapping patches over several shingles,
  // a deeper core, a few strays.
  for (let clump = 26; clump > 0; clump--) {
    const x = pick(random, W), y = pick(random, H), w = span(random, 4, 11), h = span(random, 3, 8);
    grid.blend(x, y, w, h, moss, .62);
    grid.blend(x + 1 + pick(random, 3), y - span(random, 1, 2), Math.max(2, w - span(random, 2, 4)), h + span(random, 1, 3), moss, .45);
    if (w > 5 && h > 3) grid.blend(x + 2, y + 1 + pick(random, 2), w - 4, h - 2 - pick(random, 2), deepMoss, .5);
  }
  for (let speck = 40; speck > 0; speck--) grid.blend(pick(random, W), pick(random, H), span(random, 1, 2), 1, moss, .6);
  grid.paint(rect);
}
// Ground: a dull base in large clumps, mud patches, short blades.
function ground({ rect, random, grid: size }, look) {
  const grid = cellGrid(size), [W, H] = size;
  grid.fill(0, 0, W, H, look.base);
  for (let clump = look.clumps; clump > 0; clump--) {
    const x = pick(random, W), y = pick(random, H), w = span(random, 4, 12), h = span(random, 3, 8), k = chance(random, .5) ? .92 : 1.07;
    grid.shade(x, y, w, h, k); grid.shade(x + 1 + pick(random, 3), y - 1, Math.max(1, w - 3), h + 2, k);
  }
  for (let patch = look.patches; patch > 0; patch--) {
    const x = pick(random, W), y = pick(random, H), w = span(random, 2, 6), h = span(random, 1, 3), tone = shaded(look.mud, .9 + random() * .2);
    grid.fill(x, y, w, h, tone);
    if (w > 2) grid.fill(x + 1, y + h, w - 2, 1, tone);
  }
  for (let blade = look.blades; blade > 0; blade--) grid.fill(pick(random, W), pick(random, H), 1, span(random, 1, 3), look.tones[pick(random, look.tones.length)]);
  grid.paint(rect);
}

const recipe = (size, grid, draw) => Object.freeze({ size: Object.freeze(size), grid: Object.freeze(grid), draw });
export const CABIN_TEXTURES = Object.freeze({
  logs: recipe([512, 512], [128, 128], helpers => planks(helpers, WALL)),
  floorboards: recipe([512, 512], [128, 128], helpers => planks(helpers, FLOOR, floorDirt)),
  board: recipe([256, 32], [128, 16], board),
  shingles: recipe([256, 256], [64, 64], shingles),
  wainscot: recipe([512, 512], [128, 128], helpers => planks(helpers, WAINSCOT, flakes)),
  // Dead grass: dull olive and brown, mud, no bright tips.
  deadgrass: recipe([256, 256], [64, 64], helpers => ground(helpers, {
    base: [49, 53, 41], clumps: 26, mud: [58, 51, 41], patches: 18, blades: 520,
    tones: [[76, 74, 54], [60, 64, 45], [35, 39, 30], [66, 60, 46]],
  })),
  // The clearing: trampled mud with grass left in tufts.
  mudgrass: recipe([256, 256], [64, 64], helpers => ground(helpers, {
    base: [69, 63, 47], clumps: 22, mud: [74, 64, 49], patches: 30, blades: 340,
    tones: [[84, 80, 58], [62, 64, 46], [48, 47, 36], [56, 50, 39]],
  })),
});

const surface = look => Object.freeze(look);
export const CABIN_SURFACES = Object.freeze({
  wood: surface({ color: 0xffffff, roughness: .93, texture: 'logs' }),
  gable: surface({ color: 0xffffff, roughness: .93, texture: 'logs' }),
  interiorTimber: surface({ color: 0xffffff, roughness: .93, texture: 'logs' }),
  floor: surface({ color: 0xffffff, roughness: .9, texture: 'floorboards' }),
  boards: surface({ color: 0xffffff, roughness: .9, texture: 'board' }),
  trim: surface({ color: 0x26221f, roughness: .92 }),
  roof: surface({ color: 0xffffff, roughness: .95, texture: 'shingles' }),
  interiorPlaster: surface({ color: 0x6a665c, roughness: .97 }),
  interiorWainscot: surface({ color: 0xffffff, roughness: .94, texture: 'wainscot' }),
  interiorSkirting: surface({ color: 0xffffff, roughness: .94, texture: 'wainscot' }),
  foundation: surface({ color: 0x3f403d, roughness: .9 }),
  brokenGlass: surface({ color: 0x7f948e, roughness: .25, opacity: .5 }),
  boardedGap: surface({ color: 0x0d0f0e, roughness: 1 }),
  metal: surface({ color: 0x4a3d33, roughness: .7, metalness: .45 }),
  sofa: surface({ color: 0x3f463d, roughness: .9 }),
  cushion: surface({ color: 0x525a4b, roughness: .9 }),
  paper: surface({ color: 0x978f75, roughness: .9 }),
  rackTimber: surface({ color: hex(dimmed([74, 63, 46])), roughness: .95 }),
  rackTrim: surface({ color: 0x1c1816, roughness: .9 }),
  rackIron: surface({ color: 0x6a5a4a, roughness: .7, metalness: .4 }),
  lateSupplyTimber: surface({ color: 0x3f4239, roughness: .95 }),
  lateSupplyMetal: surface({ color: 0x5e5c52, roughness: .7 }),
  generatorChassis: surface({ color: 0x2e322e, roughness: .6 }),
  generatorPaint: surface({ color: 0x998244, roughness: .75 }),
  ground: surface({ color: 0xffffff, roughness: 1, texture: 'deadgrass' }),
  clearingEarth: surface({ color: 0xffffff, roughness: 1, texture: 'mudgrass' }),
  escapeTrail: surface({ color: 0x5f4b35, roughness: .95 }),
  distantRunoff: surface({ color: 0x2b2c25, roughness: .99 }),
  trunk: surface({ color: 0x2a2622 }),
  needles: surface({ color: 0x1c2b26 }),
  needletips: surface({ color: 0x27362f }),
  rock: surface({ color: 0x3d433f }),
});

// The storybook leftovers outside: no flowers, and the caps no longer glow.
export const CABIN_OBJECTS = Object.freeze({
  decorFlowerHeads: Object.freeze({ visible: false }),
  decorFlowerStems: Object.freeze({ visible: false }),
  decorGlowingCaps: Object.freeze({ color: 0x2b3a33 }),
});
