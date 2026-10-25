// Writes small GLBs in the Frisson markers layout (art/frisson/MARKERS.md)
// for tests: one root FrissonMark_<Family>_<Anchor> per required root, with
// _Detail/_Skin/_Glow mesh children (materials detail/skin/glow, glow with
// KHR_materials_emissive_strength as the heads helper does for eyes). The
// pieces are tubes, boxes and shells seated a standoff (0.006-0.015) off the
// reference surfaces, inside the contract bounds, under the triangle budgets,
// and each family's front-projected area falls in its ladder band (sallow <
// rust < scarlet < umber < charcoal, hulk < iron < dread < overlord,
// strictly). brokenRoots breaks the layout on purpose for the checker tests.
//
// Head pieces are shells hugging the reference head (REF_PROFILE: the jaw,
// face and brow ellipses of MARKERS.md's reference frame, completed below and
// above), so the axis-wise fit seats them on any head built on the same
// profile — profileHead builds such heads at the extremes of the measured
// ranges, for the fitting tests. Body pieces follow the contract's unit torso
// envelope (TORSO_ENV, what the checker's area raster occludes with) and the
// placeholder crawler barrel (CRAWLER_ENV).

import { writeFrissonGlb } from '../../tools/frisson-glb-write.mjs';

// COLOR_0 is linear in glTF; these are sRGB 0-255 as authored.
const lin = (r, g, b) => [r, g, b].map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
const GAUZE = lin(176, 164, 140), RUST = lin(110, 68, 42), CANVAS = lin(150, 138, 116), LEATHER = lin(92, 62, 42);
const BURLAP = lin(128, 106, 76), ROPE = lin(108, 86, 56), CHAR = lin(46, 48, 52), IRON = lin(100, 78, 58), STEEL = lin(150, 150, 155);
const EMBER = lin(240, 80, 16), AMBER = lin(255, 150, 40), GREY = [.55, .55, .55];

// --- The reference head profile --------------------------------------------------
// Elliptical sections (rx half-width, zc centre, rz half-depth) by height.
// The metric bands keep MARKERS.md's reference frame: jaw front -.205, face
// front -.250, brow front -.215, temple .150, back .220. x scales with the
// temple ratio, fronts with their band's metric, the back with its own, so a
// shell authored on this profile lands on any profile head after the
// axis-wise fit.
export const REF_PROFILE = Object.freeze([
  Object.freeze([-.20, Object.freeze({ rx: .096, zc: -.0325, rz: .1425 })]),
  Object.freeze([-.16, Object.freeze({ rx: .120, zc: -.009, rz: .196 })]),
  Object.freeze([-.06, Object.freeze({ rx: .120, zc: -.009, rz: .196 })]),
  Object.freeze([-.05, Object.freeze({ rx: .132, zc: -.0205, rz: .2295 })]),
  Object.freeze([.02, Object.freeze({ rx: .132, zc: -.0205, rz: .2295 })]),
  Object.freeze([.03, Object.freeze({ rx: .150, zc: .0025, rz: .2175 })]),
  Object.freeze([.12, Object.freeze({ rx: .150, zc: .0025, rz: .2175 })]),
  Object.freeze([.165, Object.freeze({ rx: .120, zc: .0165, rz: .1815 })]),
  Object.freeze([.21, Object.freeze({ rx: .075, zc: .02, rz: .10 })]),
]);
function profileAt(y) {
  const rows = REF_PROFILE;
  if (y <= rows[0][0]) return rows[0][1];
  for (let i = 0; i < rows.length - 1; i++) {
    const [y0, a] = rows[i], [y1, b] = rows[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return { rx: a.rx + (b.rx - a.rx) * t, zc: a.zc + (b.zc - a.zc) * t, rz: a.rz + (b.rz - a.rz) * t };
    }
  }
  return rows.at(-1)[1];
}

// A shell hugging the reference head between heights y0..y1 over angles
// a0..a1 (degrees; 0 faces -Z, +90 the zombie's right), standing s off the
// reference surface. Rows at every profile knot in between, so band
// transitions are followed exactly.
function shellArc(y0, y1, a0, a1, s, nu = 10) {
  const ys = [y0, ...REF_PROFILE.map(([y]) => y).filter(y => y > y0 + 1e-9 && y < y1 - 1e-9), y1];
  const positions = [], indices = [];
  for (const y of ys) {
    const { rx, zc, rz } = profileAt(y);
    for (let i = 0; i <= nu; i++) {
      const a = (a0 + (a1 - a0) * i / nu) * Math.PI / 180;
      positions.push([(rx + s) * Math.sin(a), y, zc - (rz + s) * Math.cos(a)]);
    }
  }
  for (let row = 0; row < ys.length - 1; row++) for (let i = 0; i < nu; i++) {
    const a = row * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    indices.push(a, c, d, a, d, b);
  }
  return { positions, indices };
}

// A head on the reference profile with the metrics at the given values (both
// ends of MARKERS.md's measured ranges), for the fitting tests. Elliptical
// sections of 24 points; positions and indices, as the other fixtures.
export function profileHead({ jaw, face, brow, temple, top, back }) {
  const ellipse = (rx, front, rear) => ({ rx, zc: (front + rear) / 2, rz: (rear - front) / 2 });
  const rows = [
    [-.20, ellipse(.64 * temple, jaw + .03, .5 * back)],
    [-.16, ellipse(.80 * temple, jaw, .85 * back)],
    [-.06, ellipse(.80 * temple, jaw, .85 * back)],
    [-.05, ellipse(.88 * temple, face, .95 * back)],
    [.02, ellipse(.88 * temple, face, .95 * back)],
    [.03, ellipse(temple, brow, back)],
    [.12, ellipse(temple, brow, back)],
    [(top + .12) / 2, ellipse(.8 * temple, brow + .05, .9 * back)],
    [top, ellipse(.5 * temple, (brow + back) / 2, .5 * back)],
  ];
  const positions = [], indices = [], n = 24;
  for (const [y, { rx, zc, rz }] of rows)
    for (let i = 0; i < n; i++) {
      const a = i / n * 2 * Math.PI;
      positions.push([rx * Math.sin(a), y, zc - rz * Math.cos(a)]);
    }
  for (let row = 0; row < rows.length - 1; row++) for (let i = 0; i < n; i++) {
    const a = row * n + i, b = row * n + (i + 1) % n, c = a + n, d = b + n;
    indices.push(a, b, d, a, d, c);
  }
  // Caps: a fan to each end row's centre.
  for (const [row, flip] of [[0, true], [rows.length - 1, false]]) {
    const [y, { zc }] = rows[row], centre = positions.length;
    positions.push([0, y, zc]);
    for (let i = 0; i < n; i++) {
      const a = row * n + i, b = row * n + (i + 1) % n;
      indices.push(...(flip ? [centre, b, a] : [centre, a, b]));
    }
  }
  return { positions, indices };
}

// --- Pieces ----------------------------------------------------------------------
// A box centred at (cx, cy, cz), full sizes (sx, sy, sz), tilted rx about X
// then rotated rz about Z. Outward winding, 12 triangles.
const box = (cx, cy, cz, sx, sy, sz, rz = 0, rx = 0) => {
  const c = Math.cos(rz), s = Math.sin(rz), cx1 = Math.cos(rx), sx1 = Math.sin(rx), positions = [];
  for (const [x, y, z] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
    const py = y * sy / 2, pz = z * sz / 2;
    const y2 = py * cx1 - pz * sx1, z2 = py * sx1 + pz * cx1, px = x * sx / 2;
    positions.push([cx + px * c - y2 * s, cy + px * s + y2 * c, cz + z2]);
  }
  return { positions, indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3, 3, 7, 6, 3, 6, 2, 0, 1, 5, 0, 5, 4] };
};
// An open strip of elliptical section following rows [[y, rx, cz, rz] ...]:
// angle 0 faces -Z (the front), growing toward +X (the zombie's right);
// a0..a1 in degrees; n segments for a full turn; s widens rx and rz (a
// standoff off the profile the rows follow); square > 0 fattens the
// diagonals (the real torsos are squarer than an ellipse). 2 triangles per
// segment and row.
const tube = (rows, n = 16, a0 = 0, a1 = 360, s = 0, square = 0) => {
  const steps = Math.max(1, Math.round(n * Math.abs(a1 - a0) / 360)), positions = [], indices = [];
  for (const [y, rx, cz, rz] of rows)
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180, fat = 1 + square * Math.sin(2 * a) ** 2;
      positions.push([(rx + s) * fat * Math.sin(a), y, cz - (rz + s) * fat * Math.cos(a)]);
    }
  for (let row = 0; row < rows.length - 1; row++) for (let i = 0; i < steps; i++) {
    const a = row * (steps + 1) + i, b = a + 1, c = a + steps + 1, d = c + 1;
    indices.push(a, c, d, a, d, b);
  }
  return { positions, indices };
};
// An open elliptical band (no caps) of height h round (cx, cy, cz): angle 0
// faces -Z (the front), growing toward +X (the zombie's right). a0..a1 in
// degrees; n segments for a full turn. 2 triangles per segment.
const band = (cx, cy, cz, rx, rz, h, n = 12, a0 = 0, a1 = 360) => {
  const steps = Math.max(1, Math.round(n * Math.abs(a1 - a0) / 360)), positions = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
    const x = cx + rx * Math.sin(a), z = cz - rz * Math.cos(a);
    positions.push([x, cy - h / 2, z], [x, cy + h / 2, z]);
  }
  for (let i = 0; i < steps; i++) {
    const k = i * 2;
    indices.push(k, k + 3, k + 2, k, k + 1, k + 3);
  }
  return { positions, indices };
};

// Rows [y, ...values], linear in every column.
const atRows = table => y => {
  if (y <= table[0][0]) return [y, ...table[0].slice(1)];
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i], b = table[i + 1];
    if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0]); return [y, ...a.slice(1).map((value, j) => value + (b[j + 1] - value) * t)]; }
  }
  return [y, ...table.at(-1).slice(1)];
};
// The contract's unit torso envelope (MARKERS.md section 3 — the checker's
// area raster occludes with it): [y, half-width, half-depth] about
// (0, y, -.01). The standing bands follow it a seating off, so they show
// from -Z and seat on the real torsos.
const TORSO_ENV = [[.80, .19, .16], [1.00, .19, .16], [1.05, .21, .15], [1.38, .21, .15], [1.50, .235, .15], [1.55, .14, .12]];
const torsoAt = y => { const [yy, rx, rz] = atRows(TORSO_ENV)(y); return [yy, rx, -.01, rz]; };
const torsoTube = (y0, y1, a0 = 0, a1 = 360, s = .0065, n = 16) => tube([y0, (y0 + y1) / 2, y1].map(torsoAt), n, a0, a1, s, .07);
// The collar on the collarbones: flared onto the shoulders at the bottom,
// proud of the neck at the top (necks swing; the clearance is 0.13).
const collarTube = (top, n = 12) => tube([[1.45, .193, -.01, .165], [1.50, top, -.01, .16], [1.53, top - .005, -.01, .15]], n, 0, 360, .006);
// The placeholder crawler barrel (public/frisson/bodies.glb), authored 25 mm
// toward +Z: the crawler fit pins the authored chest front -0.22 to the
// measured one (about -0.245). [y, half-width, centre z, half-depth].
const CRAWLER_ENV = [[.30, .117, .150, .075], [.35, .170, .0025, .2225], [.40, .200, .0145, .2345], [.45, .201, .0135, .2335], [.50, .181, -.0775, .1195], [.55, .073, -.0975, .0425]];
const crawlerAt = atRows(CRAWLER_ENV);
const crawlerTube = (y0, y1, a0 = 0, a1 = 360, s = .006, n = 10) => tube([y0, (y0 + y1) / 2, y1].map(crawlerAt), n, a0, a1, s, .07);

// Chain links (boxes) at the given points, draped on the shoulder or back;
// they lie along the drape (thin across the body, long over it).
const links = (points, color = IRON, sx = .018, sy = .05, sz = .034) => points.map(([x, y, z]) => ({ geo: box(x, y, z, sx, sy, sz), color }));
// The chains: over the shoulder tops (which the contract pins at y ~1.49-1.50)
// and down the back, every link seated on the surface; their front ends stay
// above y 1.40, tucked at the plate's top edge, and clear of the neck
// (0.13 from the axis).
const chainL = [[-.16, 1.505, -.05], [-.185, 1.505, .01], [-.195, 1.50, .07], [-.20, 1.45, .135], [-.20, 1.38, .15]];
const chainR = chainL.map(([x, y, z]) => [-x, y, z]);
const crossA = [[-.17, 1.51, .0], [-.12, 1.515, .08], [-.06, 1.515, .13], [.06, 1.50, .15], [.14, 1.45, .163]];
const crossB = crossA.map(([x, y, z]) => [-x, y, z]);

// One channel child of a root: [{ geo, color }] merged, colours per shape.
const channel = (root, name, shapes) => {
  const positions = [], indices = [], colors = [];
  for (const { geo, color } of shapes) {
    const base = positions.length;
    positions.push(...geo.positions);
    indices.push(...geo.indices.map(index => index + base));
    for (let i = 0; i < geo.positions.length; i++) colors.push(color);
  }
  return { name: `${root}_${name}`, material: name.toLowerCase(), positions, indices, colors };
};
const root = (family, anchor, ...channels) => ({ name: `FrissonMark_${family}_${anchor}`, children: channels });

// The whole valid set, one call per family (pale is unmarked). Fresh plain
// data each call, so tests can bend it (see brokenRoots).
export function markersRoots() {
  return [
    // Sallow: gauze turns round the ribs, a gauze turn over the brow and the
    // right eye, a loose tail behind the left ear.
    root('Sallow', 'Torso', channel('FrissonMark_Sallow_Torso', 'Detail', [
      { geo: torsoTube(1.152, 1.188), color: GAUZE },
      { geo: box(.10, 1.163, -.1695, .05, .028, .006, .1), color: GAUZE }])),
    root('Sallow', 'Skull', channel('FrissonMark_Sallow_Skull', 'Detail', [
      { geo: shellArc(.06, .11, -40, 40, .007, 10), color: GAUZE },
      { geo: shellArc(.04, .095, -140, -115, .007, 2), color: GAUZE }])),
    root('Sallow', 'CrawlerTorso', channel('FrissonMark_Sallow_CrawlerTorso', 'Detail', [
      { geo: crawlerTube(.395, .445, 0, 360, .006, 8), color: GAUZE }])),
    // Rust: a collar on the collarbones with links to the sternum, skin
    // bulging round it, and a manacle on the right wrist.
    root('Rust', 'Neck',
      channel('FrissonMark_Rust_Neck', 'Detail', [
        { geo: tube([[1.45, .193, -.01, .175], [1.50, .155, -.01, .17], [1.53, .15, -.01, .16]], 12, 0, 360, .006), color: RUST },
        { geo: box(0, 1.46, -.172, .04, .05, .024), color: RUST },
        ...links([[0, 1.443, -.172], [.012, 1.427, -.168], [-.008, 1.412, -.164]], RUST, .024, .022, .012)]),
      channel('FrissonMark_Rust_Neck', 'Skin', [{ geo: band(0, 1.53, -.01, .155, .15, .03, 10), color: GREY }])),
    root('Rust', 'ArmR', channel('FrissonMark_Rust_ArmR', 'Detail', [
      { geo: band(0, -.46, -.02, .052, .052, .045, 8), color: RUST }])),
    root('Rust', 'CrawlerTorso', channel('FrissonMark_Rust_CrawlerTorso', 'Detail', [
      { geo: crawlerTube(.495, .535, 0, 360, .006, 8), color: RUST }])),
    root('Rust', 'CrawlerArmR', channel('FrissonMark_Rust_CrawlerArmR', 'Detail', [
      { geo: band(0, -.30, -.02, .048, .048, .04, 6), color: RUST }])),
    // Scarlet: two canvas straps round the torso, one over the left shoulder,
    // a leather muzzle strap round the jaw.
    root('Scarlet', 'Torso', channel('FrissonMark_Scarlet_Torso', 'Detail', [
      { geo: tube([[1.275, .228, -.01, .15], [1.30, .231, -.01, .15], [1.325, .233, -.01, .15]], 12, 0, 360, .006, .07), color: CANVAS },
      { geo: torsoTube(1.03, 1.08), color: CANVAS },
      { geo: torsoTube(1.34, 1.50, -135, -55), color: LEATHER },
      { geo: box(.08, 1.30, -.1725, .03, .06, .012), color: STEEL },
      { geo: box(-.06, 1.055, -.1715, .03, .05, .012), color: STEEL }])),
    root('Scarlet', 'Jaw', channel('FrissonMark_Scarlet_Jaw', 'Detail', [
      { geo: shellArc(-.115, -.085, -60, 60, .006, 10), color: LEATHER }])),
    root('Scarlet', 'CrawlerTorso', channel('FrissonMark_Scarlet_CrawlerTorso', 'Detail', [
      { geo: crawlerTube(.33, .37, 0, 360, .006, 8), color: CANVAS },
      { geo: crawlerTube(.46, .50, 0, 360, .006, 8), color: CANVAS }])),
    // Umber: a ragged burlap mantle on the shoulders, tied at the throat with
    // rope, its hem ragged down the back; a hood pushed back framing the head.
    root('Umber', 'Shoulders', channel('FrissonMark_Umber_Shoulders', 'Detail', [
      { geo: torsoTube(1.35, 1.47, 120, 240, .012), color: BURLAP },
      { geo: torsoTube(1.455, 1.485, 0, 360, .006, 10), color: ROPE },
      { geo: box(-.08, 1.26, .157, .05, .16, .018), color: BURLAP }])),
    root('Umber', 'Skull', channel('FrissonMark_Umber_Skull', 'Detail', [
      { geo: shellArc(.04, .105, 110, 250, .007, 12), color: BURLAP }])),
    root('Umber', 'CrawlerTorso', channel('FrissonMark_Umber_CrawlerTorso', 'Detail', [
      { geo: crawlerTube(.355, .495, 100, 260, .008, 10), color: BURLAP }])),
    // Charcoal: a charred crust over shoulders and chest and one side of the
    // skull; embers glow in the cracks (the only walker with light).
    root('Charcoal', 'Shoulders',
      channel('FrissonMark_Charcoal_Shoulders', 'Detail', [
        { geo: torsoTube(1.31, 1.49, -65, 65, .009), color: CHAR },
        { geo: torsoTube(1.34, 1.49, 45, 135, .009), color: CHAR },
        { geo: torsoTube(1.34, 1.49, -135, -45, .009), color: CHAR }]),
      channel('FrissonMark_Charcoal_Shoulders', 'Glow', [
        { geo: box(-.07, 1.38, -.174, .02, .02, .006), color: EMBER },
        { geo: box(.06, 1.42, -.174, .02, .02, .006), color: EMBER },
        { geo: box(-.2405, 1.42, -.02, .006, .02, .02), color: EMBER },
        { geo: box(.2405, 1.40, -.06, .006, .02, .02), color: EMBER }])),
    root('Charcoal', 'Skull',
      channel('FrissonMark_Charcoal_Skull', 'Detail', [
        { geo: shellArc(.04, .105, 15, 95, .007, 10), color: CHAR }]),
      channel('FrissonMark_Charcoal_Skull', 'Glow', [
        { geo: shellArc(.045, .07, 35, 55, .010, 2), color: EMBER },
        { geo: shellArc(.04, .055, 60, 80, .010, 2), color: EMBER },
        { geo: shellArc(.06, .085, 70, 90, .010, 2), color: EMBER },
        { geo: shellArc(.042, .06, 20, 38, .010, 2), color: EMBER }])),
    root('Charcoal', 'CrawlerTorso',
      channel('FrissonMark_Charcoal_CrawlerTorso', 'Detail', [
        { geo: box(-.208, .41, .02, .012, .16, .24), color: CHAR },
        { geo: box(.208, .41, .02, .012, .16, .24), color: CHAR }]),
      channel('FrissonMark_Charcoal_CrawlerTorso', 'Glow', [
        { geo: box(-.217, .44, -.02, .006, .02, .02), color: EMBER },
        { geo: box(.217, .42, .02, .006, .02, .02), color: EMBER }])),
    // Hulk: a riveted neck ring and one chain over the left trapezius, down
    // the back, its front end tucked at the plate's top edge.
    root('Hulk', 'Neck', channel('FrissonMark_Hulk_Neck', 'Detail', [
      { geo: collarTube(.15), color: IRON }])),
    root('Hulk', 'Shoulders', channel('FrissonMark_Hulk_Shoulders', 'Detail', links(chainL))),
    // Iron: the hulk's ring, two chains crossing in an X on the back, and a
    // riveted scrap plate over the left half of the face.
    root('Iron', 'Neck', channel('FrissonMark_Iron_Neck', 'Detail', [
      { geo: tube([[1.45, .193, -.01, .165], [1.50, .175, -.01, .16], [1.55, .17, -.01, .15]], 12, 0, 360, .006), color: IRON }])),
    root('Iron', 'Shoulders', channel('FrissonMark_Iron_Shoulders', 'Detail', links([...crossA, ...crossB]))),
    root('Iron', 'Face', channel('FrissonMark_Iron_Face', 'Detail', [
      { geo: shellArc(-.048, .02, -122, -3, .006, 9), color: IRON },
      { geo: shellArc(-.02, 0, -80, -65, .009, 2), color: STEEL },
      { geo: shellArc(-.035, -.02, -60, -45, .009, 2), color: STEEL },
      { geo: shellArc(-.03, -.015, -90, -82, .009, 2), color: STEEL }])),
    // Dread: the iron's chains, two turns round the waist with a padlock at
    // the hip, and a cage mask over the face.
    root('Dread', 'Neck', channel('FrissonMark_Dread_Neck', 'Detail', [
      { geo: tube([[1.45, .193, -.01, .15], [1.50, .168, -.01, .148], [1.56, .163, -.01, .14]], 12, 0, 360, .006), color: IRON }])),
    root('Dread', 'Shoulders', channel('FrissonMark_Dread_Shoulders', 'Detail', links([...crossA, ...crossB]))),
    root('Dread', 'Torso', channel('FrissonMark_Dread_Torso', 'Detail', [
      { geo: tube([[.955, .19, -.008, .122], [1.045, .19, -.008, .122]], 14, 0, 360, .006), color: IRON },
      { geo: box(.20, .965, -.02, .05, .07, .025), color: IRON }])),
    root('Dread', 'Face', channel('FrissonMark_Dread_Face', 'Detail', [
      ...[-60, -30, 0, 30, 60].map(a => ({ geo: shellArc(-.038, .012, a - 3.5, a + 3.5, .007, 1), color: IRON })),
      { geo: shellArc(0, .012, -60, 60, .007, 10), color: IRON },
      { geo: shellArc(-.038, -.026, -60, 60, .007, 8), color: IRON },
      { geo: shellArc(.04, .06, 105, 255, .007, 12), color: IRON }])),
    // Overlord: a spiked collar, heavier chains, and the crown of nails round
    // the helmet rim, the nail tips heated amber (the boss's accent).
    root('Overlord', 'Neck', channel('FrissonMark_Overlord_Neck', 'Detail', [
      { geo: tube([[1.45, .193, -.01, .155], [1.50, .178, -.01, .158], [1.555, .173, -.01, .148]], 14, 0, 360, .006), color: RUST },
      ...Array.from({ length: 8 }, (_, i) => {
        const a = i / 8 * 2 * Math.PI;
        return { geo: box(.181 * Math.sin(a), 1.555, -.01 - .165 * Math.cos(a), .016, .038, .016), color: RUST };
      })])),
    root('Overlord', 'Shoulders', channel('FrissonMark_Overlord_Shoulders', 'Detail', [
      ...links(chainL, IRON, .045, .06, .018), ...links(chainR, IRON, .045, .06, .018)])),
    root('Overlord', 'Torso', channel('FrissonMark_Overlord_Torso', 'Detail', [
      { geo: tube([[.975, .195, -.008, .122], [1.025, .195, -.008, .122]], 14, 0, 360, .006), color: IRON },
      { geo: box(.205, .965, -.02, .06, .08, .028), color: RUST }])),
    root('Overlord', 'Helmet',
      channel('FrissonMark_Overlord_Helmet', 'Detail', [
        { geo: band(0, .175, -.01, .245, .215, .045, 12), color: RUST },
        ...Array.from({ length: 8 }, (_, i) => {
          const a = i / 8 * 2 * Math.PI;
          return { geo: box(.255 * Math.sin(a), .195, -.01 - .225 * Math.cos(a), .016, .05, .016), color: RUST };
        })]),
      channel('FrissonMark_Overlord_Helmet', 'Glow', Array.from({ length: 8 }, (_, i) => {
        const a = i / 8 * 2 * Math.PI;
        return { geo: box(.256 * Math.sin(a), .220, -.01 - .226 * Math.cos(a), .014, .009, .014), color: AMBER };
      }))),
  ];
}

// The GLB bytes for a root list; options as writeFrissonGlb (mutate, text),
// with the glow material's emissive strength extension added first.
export function buildMarkersGlb(roots = markersRoots(), options = {}) {
  return writeFrissonGlb(roots, {
    generator: 'frisson-markers test', materials: ['detail', 'skin', 'glow'], ...options,
    mutate: json => {
      const glow = json.materials.find(material => material.name === 'glow');
      if (glow) {
        glow.emissiveFactor = [1, .35, .08];
        glow.extensions = { KHR_materials_emissive_strength: { emissiveStrength: 1 } };
        json.extensionsUsed = ['KHR_materials_emissive_strength'];
      }
      options.mutate?.(json);
    },
  });
}

// The default set with one deliberate contract violation, for the checker
// tests; each names the offending root.
export function brokenRoots(kind) {
  const roots = markersRoots();
  const named = name => roots.find(entry => entry.name === name);
  switch (kind) {
    // A _Detail child drawn with a material that is not "detail".
    case 'material': named('FrissonMark_Sallow_Torso').children[0].material = 'canvas'; break;
    // Rust's collar with neither _Detail nor _Glow.
    case 'channel': named('FrissonMark_Rust_Neck').children = named('FrissonMark_Rust_Neck').children.filter(child => !child.name.endsWith('_Detail')); break;
    // Sallow's wrap above the Torso y bound.
    case 'bounds': for (const child of named('FrissonMark_Sallow_Torso').children) child.positions = child.positions.map(([x, y, z]) => [x, y + .6, z]); break;
    // Scarlet's straps twelve times over: over the family's budget.
    case 'budget': for (const child of named('FrissonMark_Scarlet_Torso').children) child.indices = Array(12).fill(child.indices).flat(); break;
    // Glow on a family that never glows.
    case 'glow': {
      const detail = named('FrissonMark_Sallow_Torso').children[0];
      named('FrissonMark_Sallow_Torso').children.push({ ...structuredClone(detail), name: 'FrissonMark_Sallow_Torso_Glow', material: 'glow', colors: detail.positions.map(() => EMBER) });
      break;
    }
    // A required root missing.
    case 'missing': return roots.filter(entry => entry.name !== 'FrissonMark_Hulk_Neck');
    default: throw new Error(`unknown break ${kind}`);
  }
  return roots;
}

// --- Measures on a root list (the tests' own ruler) -------------------------------
const standing = (roots, family) => roots.filter(root => {
  const [, fam, anchor] = root.name.split('_');
  return fam === family && !anchor.startsWith('Crawler');
});
// Triangles of a family's standing set, or of its crawler set (the crawler
// roots plus the shared head roots), as marks-a's test counts them.
export function familyTriangles(roots, family, crawler = false) {
  const picked = roots.filter(root => {
    const [, fam, anchor] = root.name.split('_');
    return fam === family && (crawler ? anchor.startsWith('Crawler') || ['Skull', 'Jaw'].includes(anchor) : !anchor.startsWith('Crawler'));
  });
  return picked.reduce((sum, root) => sum + root.children.reduce((count, child) => count + child.indices.length / 3, 0), 0);
}
// The projected area of a family's standing pieces (orthographic, unit
// build): the union of the cells the triangles cover, so overlapping pieces
// are counted once. view 'front' from -Z, 'side' from +X.
export function projectedArea(roots, family, view = 'front', cell = .0025) {
  const cells = new Set();
  const map = view === 'front' ? ([x, y]) => [x, y] : ([x, y, z]) => [z, y];
  for (const root of standing(roots, family)) for (const child of root.children) {
    const p = child.positions, index = child.indices;
    for (let face = 0; face < index.length; face += 3) {
      const [a, b, c] = [p[index[face]], p[index[face + 1]], p[index[face + 2]]].map(map);
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-14) continue;
      const i0 = Math.floor(Math.min(a[0], b[0], c[0]) / cell), i1 = Math.ceil(Math.max(a[0], b[0], c[0]) / cell);
      const j0 = Math.floor(Math.min(a[1], b[1], c[1]) / cell), j1 = Math.ceil(Math.max(a[1], b[1], c[1]) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = (i + .5) * cell, y = (j + .5) * cell;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) cells.add(i * 100003 + j);
      }
    }
  }
  return cells.size * cell * cell;
}
