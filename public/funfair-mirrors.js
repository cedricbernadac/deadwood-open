import * as THREE from '/vendor/three.module.js';
import { PLAYER_POSTURE } from './movement.js';

// Real reflections in the funfair's mirror maze, « le Palais des glaces »
// (owner, 24 October: « les miroirs, là, on va se voir dedans ou pas
// vraiment ? »). Only world-funfair.js uses this module. The Blender panes
// (art/levels/funfair/funfair_cellar.py, mirror_panel) stay in the GLB as the
// fake glass; a small pool of live three.js reflectors sits 3.5 mm in front
// of the nearest panes that face the camera, and the local player sees their
// own survivor in them. The low quality tier has no pool at all: the fake
// glass, zero extra cost, and Reflector.js is never even downloaded.
export const MIRROR_LAYER = 9;
export const MIRROR_POOL = Object.freeze({ low: 0, medium: 1, high: 2 });
// The pane of mirror_panel: 9 cm inside each post, from 17 cm above the
// panel's base to 32 cm below its top, on both faces 10 mm from the centre plane.
export const MIRROR_PANE = Object.freeze({ inset: .09, bottom: .17, top: .32, offset: .010 });
// A live reflector 3.5 mm in front of its pane and 2 mm inside its edges, which
// the velvet border (10 to 18 mm off the centre plane) covers.
export const MIRROR_FIT = Object.freeze({ lift: .0035, margin: .002 });
// Distances in metres, times in seconds. live: from the eye to a pane;
// prepare: to the maze's panes, when the pool is built and its shaders
// compiled; cellarTop: above the panels' base, the eye is upstairs (the snack
// bar is right over the maze); facing: how far in front of a pane the eye must
// be. The hysteresis: a live pane counts 'keep' times more than it weighs (it
// stays while it weighs at least 1 / keep, 40 %, of the best), stays live up to
// 'reach' metres farther and 'facing' / 2 nearer its plane, and is never
// displaced by another pane in its first 'hold' seconds; a pane that has just
// gone (faded out, or dropped off screen) is not taken again for 'back'
// seconds (walking to and fro past a panel's end would show it for a moment).
// The pool is re-chosen every 'every' seconds, or at once when the eye moved
// 'move' metres or turned 'turn' radians. 'second': the share of the screen a
// pane must cover to take the high tier's second reflector (3 %: a pane seen
// square-on within about 4.7 m; a far one of 94 x 98 pixels cost this PC 13 ms
// for 1 %), half that to keep it (faceShare); the first reflector has no
// minimum, it is the mirror the player looks at.
export const MIRROR_RANGE = Object.freeze({ live: 9, prepare: 14, cellarTop: 3.2, facing: .05, every: .2, keep: 2.5, reach: .6, hold: 1, back: .6, move: 1, turn: .35, second: .03 });
// An old mirror: a little warm and a little dark, no distortion. The
// reflection is drawn exactly like the main view (tone mapped and encoded);
// the tint multiplies those display colours and haze is a faint dust lift in
// the blacks. Targets are half the drawing buffer. A reflection that is on
// screen appears and leaves over 'fade' seconds, through the decor glass
// behind it (a hand-over from one pane to another, the frame-time guard).
export const MIRROR_LOOK = Object.freeze({ tint: Object.freeze([.95, .94, .91]), haze: .006, textureScale: .5, clipBias: .003, samples: Object.freeze({ medium: 2, high: 4 }), fade: .2 });
// What a maze mirror can show. Drawn whole, a reflection pass cost about as
// much as the main view: the upstairs and the other cellar rooms lay in its
// cone, behind the walls. The maze is a closed room (its walls and the ground
// slab over it are checked against the GLB in
// test/fixtures/funfair-mirrors-check.mjs) open only at its doorways, so a
// point outside it shows in a mirror only along a reflected ray
// eye' -> pane -> doorway -> point: inside the cone from the reflected eye
// through the part of the pane that sees the doorway. Likewise the whole
// cellar is closed overhead but for its stair wells (checked the same way), so
// whatever stands on the floor above shows only along
// eye' -> pane -> doorway -> well -> point. Nothing behind a mirror shows in
// it either. Each pass hides the scenery and the actors that are in none of
// these. Metres: 'wall' around the room, 'top' under the floor above
// (whatever stands on it is upstairs), 'opening' around each doorway and well
// (the GLB closes the room and the cellar to within 2.5 cm of them), 'pane'
// around each pane (wider than the narrowed lens's padding), 'behind' the
// mirror's plane; an actor (a survivor, a zombie, a crate) is a box reaching
// 'actorReach' times its scale around its feet, from 'actorBelow' times its
// scale under them (never through the floor above when it stands on it) to
// 'actorTop' times its scale over them (a boss brute, its flying pieces); a
// sprite turns to the camera and counts as a cube of 'spriteRadius' times its
// scale around its centre.
export const MIRROR_SIGHT = Object.freeze({ wall: .15, top: .01, opening: .05, pane: .15, behind: .05, actorReach: 3.5, actorBelow: .2, actorTop: 3.2, spriteRadius: .75 });
// A frame-time guard, for a PC that a live mirror slows down, in steps that
// never blink. It counts the frames the screen shows, all in one way: an
// interval under 'catchUp' seconds (the browser catching up after a long
// frame: no screen refreshes that fast) shows nothing of its own and joins
// the next ones until they add up to 'catchUp'; an interval over 'hitch'
// seconds (a tab switch, a pause) is no frame. A frame counts for the mirror
// when it showed a live one, drawn or kept; 'smoothing' is each frame's weight
// in the running averages, where a frame over 'spike' times the running
// average (the system stalling the browser for a moment) counts as that much,
// in the comparison too: a steady frame of either kind is always under twice
// the average of both. Three stages:
// - 'full' to 'light': when the frames with a live mirror average more than
//   'slow' seconds (under 38 images per second: a 60 Hz screen that misses
//   every other frame still shows 40) for 'after' seconds, the mirror gets
//   lighter and stays live: one reflection only (the high tier's second pane
//   fades out), redrawn every other frame shown, in smaller targets, without
//   multisampling, the last one kept in between.
// - 'light' to 'full': when the frames that drew the lighter reflection
//   average under 'fast' seconds (over 48 images per second) for 'recover'
//   seconds, doubled after each step down to 'light' (a PC whose full mirror
//   is slow again comes back less and less often), at most 'recoverMax'.
// - 'light' to 'glass', for the session: the lighter mirror's frames
//   alternate between drawing its reflection and keeping it, side by side.
//   They are compared in windows of at least 'kinds' frames and 'span'
//   seconds of each kind. Whatever slows every frame alike (a fight, the
//   browser, another program) adds as much to both kinds, so the drawing
//   frames look less slow next to the keeping ones, not more (on a screen
//   that rounds each frame up to its refreshes, on average). A window blames
//   the mirror when its drawing frames are at least 'gain' (60 %) slower than
//   its keeping frames (the mirror alone then takes over 37 % of a drawing
//   frame; a PC that cannot afford it shows 85 % and more, while this busy PC,
//   its frames on a 56 Hz screen taking one, two or three refreshes, averages
//   16 to 41 % with single windows up to 81 %, never three in a row over 49 %)
//   AND its frames average more than 'floor' seconds (under 30 images per
//   second) AND it is calm: its keeping frames no more than 'calm' times (15
//   %) slower than the median of the last 'calmOf' calm windows (a fight, a
//   spawn or another program slows the keeping frames too, and sometimes the
//   reflection more than the rest: that window is set aside). The first
//   window of a light spell, and the next one after 'renew' seconds of
//   windows set aside in a row (a PC busier for good), only measure the
//   keeping frames. After 'spells' windows in a row that blame it (any other
//   window starts the count again), the mirror fades to the decor glass,
//   which the maze keeps until the page is reloaded: one hand-over, never
//   back and forth. A frame without a live mirror begins the window again
//   (not the count), and so does a window whose kinds stop alternating, one
//   'ahead' frames ahead of the other: a pane cut by the screen's edge is
//   redrawn on every frame while the eye moves, so no window closes until
//   the eye is still.
// light.turn and light.move: how far the eye may turn (radians) or move
// (metres) for a reflection cut by the screen's edge to be kept.
export const MIRROR_BUDGET = Object.freeze({ slow: 1 / 38, after: 2, fast: 1 / 48, recover: 4, recoverMax: 60, floor: 1 / 30, gain: .6, calm: 1.15, calmOf: 5, renew: 20,
  kinds: 12, span: 1.5, spells: 3, ahead: 6, hitch: .5, catchUp: .003, spike: 2.5, smoothing: .1, light: Object.freeze({ every: 2, textureScale: .35, samples: 0, turn: .01, move: .01 }) });
// The local survivor in the mirrors has its eyes where the camera is
// (PLAYER_POSTURE), standing and crouched. The teammates' model has them
// 'eye' metres over its head's centre, 13 cm over the camera's when standing:
// it is scaled down about its feet to the camera's eye height; crouched, its
// head drops as far as the camera does (the model's own crouch lowers it
// .86 m, the camera .67 m).
export const MIRROR_AVATAR = Object.freeze({ eye: .011 });
// Test-only: a page whose localStorage holds this key set to '1' exposes the
// pool as globalThis.__funfairMirrors (validation/funfair-mirrors-2026-10-24).
export const MIRROR_PROBE_KEY = 'deadwood-test-mirror-probe';

// The room the mirrors stand in, for MIRROR_SIGHT: a SPACE room (bounds and
// doors), the height of its floor and of the floor above it, and the wells
// (rectangles) through the slab under that floor, whose underside is at
// slabBottom.
export function mirrorEnclosure(room, { floorY, ceilingY, slabBottom = ceilingY, wells = [] } = {}) {
  if (!room?.bounds || !Number.isFinite(floorY) || !Number.isFinite(ceilingY) || !(ceilingY > floorY) || !(slabBottom <= ceilingY)) return null;
  const { bounds } = room, wall = MIRROR_SIGHT.wall, margin = MIRROR_SIGHT.opening;
  const box = new THREE.Box3(new THREE.Vector3(bounds.minX - wall, floorY - wall, bounds.minZ - wall), new THREE.Vector3(bounds.maxX + wall, ceilingY - MIRROR_SIGHT.top, bounds.maxZ + wall));
  const portals = (room.doors ?? []).filter(door => door.width > 0 && door.height > 0).map(door => {
    const half = door.width / 2 + margin, bottom = (door.floorY ?? floorY) - margin, top = (door.floorY ?? floorY) + door.height + margin;
    const corners = door.axis === 'x'
      ? [[door.x - half, bottom, door.z], [door.x + half, bottom, door.z], [door.x + half, top, door.z], [door.x - half, top, door.z]]
      : [[door.x, bottom, door.z - half], [door.x, bottom, door.z + half], [door.x, top, door.z + half], [door.x, top, door.z - half]];
    const points = corners.map(([x, y, z]) => Object.freeze(new THREE.Vector3(x, y, z)));
    return Object.freeze({ id: door.id, corners: Object.freeze(points), centre: Object.freeze(points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(.25)),
      normal: Object.freeze(door.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)) });
  });
  const skylights = (wells ?? []).filter(well => well.maxX > well.minX && well.maxZ > well.minZ).map(well => {
    const y = slabBottom - margin;
    const points = [[well.minX - margin, well.minZ - margin], [well.maxX + margin, well.minZ - margin], [well.maxX + margin, well.maxZ + margin], [well.minX - margin, well.maxZ + margin]]
      .map(([x, z]) => Object.freeze(new THREE.Vector3(x, y, z)));
    return Object.freeze({ corners: Object.freeze(points), centre: Object.freeze(new THREE.Vector3((well.minX + well.maxX) / 2, y, (well.minZ + well.maxZ) / 2)), normal: Object.freeze(new THREE.Vector3(0, 1, 0)) });
  });
  return Object.freeze({ id: room.id, box, portals: Object.freeze(portals), skylights: Object.freeze(skylights), upstairs: ceilingY - MIRROR_SIGHT.top });
}

// The cone from 'apex' through a doorway: four planes, each through the apex
// and one edge, facing the doorway's centre. Null when the apex is in the
// doorway's plane.
export function portalCone(portal, apex) {
  if (Math.abs((apex.x - portal.centre.x) * portal.normal.x + (apex.y - portal.centre.y) * portal.normal.y + (apex.z - portal.centre.z) * portal.normal.z) < 1e-3) return null;
  return coneThrough(apex, portal.corners, portal.centre);
}
function coneThrough(apex, polygon, inside) {
  return polygon.map((point, index) => {
    const plane = new THREE.Plane().setFromCoplanarPoints(apex, point, polygon[(index + 1) % polygon.length]);
    if (plane.distanceToPoint(inside) < 0) plane.negate();
    return plane;
  });
}
// The part of a convex polygon on the positive side of a plane.
function clipPolygon(polygon, plane) {
  const out = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length], da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(new THREE.Vector3().lerpVectors(a, b, da / (da - db)));
  }
  return out;
}
const behindPlane = (plane, box) => {
  const n = plane.normal;
  return n.x * (n.x > 0 ? box.max.x : box.min.x) + n.y * (n.y > 0 ? box.max.y : box.min.y) + n.z * (n.z > 0 ? box.max.z : box.min.z) + plane.constant < 0;
};
// A box can be in a cone unless it lies wholly behind one of its planes.
export function coneMeetsBox(planes, box) {
  if (!planes) return true;
  for (const plane of planes) if (behindPlane(plane, box)) return false;
  return true;
}
// The part of a polygon (on the pane) whose rays from the apex pass through
// an opening; null when none does.
function clipThrough(polygon, opening, apex) {
  let clipped = polygon;
  for (const plane of portalCone(opening, apex) ?? []) { clipped = clipPolygon(clipped, plane); if (clipped.length < 3) return null; }
  return clipped.length >= 3 ? clipped : null;
}
const coneOf = (apex, polygon) => coneThrough(apex, polygon, polygon.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / polygon.length));
// What a mirror face can show to an eye: the reflected eye (Reflector.js's
// virtual camera), the plane a shown box cannot lie wholly behind, for each
// doorway the exact cone of rays from the reflected eye through both the pane
// and that doorway (the pane clipped by the doorway's cone), and the cones of
// those rays that also pass a well (upCones). 'open' when the eye is on the
// mirror's plane: nothing is ruled out.
export function mirrorSight(enclosure, face, eye) {
  const pane = face.window, n = pane.normal, c = pane.centre;
  const side = (eye.x - c.x) * n.x + (eye.y - c.y) * n.y + (eye.z - c.z) * n.z;
  if (!enclosure || !(side > 1e-3)) return { open: true, cones: [], upCones: [] };
  const apex = new THREE.Vector3(eye.x - 2 * side * n.x, eye.y - 2 * side * n.y, eye.z - 2 * side * n.z);
  const front = new THREE.Plane(new THREE.Vector3(n.x, n.y, n.z), MIRROR_SIGHT.behind - (n.x * c.x + n.y * c.y + n.z * c.z));
  const cones = [], upCones = [], whole = pane.corners.map(point => point.clone());
  for (const portal of enclosure.portals) {
    const door = clipThrough(whole, portal, apex);
    if (!door) continue;
    cones.push(coneOf(apex, door));
    for (const skylight of enclosure.skylights ?? []) {
      const up = clipThrough(door, skylight, apex);
      if (up) upCones.push(coneOf(apex, up));
    }
  }
  return { open: false, apex, front, cones, upCones };
}
// Whether a mirror may show a box (mirrorSight). Every test is conservative:
// a box it rejects is out of sight.
export function canMirrorShow(enclosure, sight, box) {
  if (sight.open) return true;
  if (behindPlane(sight.front, box)) return false;
  const upstairs = box.min.y >= enclosure.upstairs;
  if (!upstairs && box.intersectsBox(enclosure.box)) return true;
  for (const planes of upstairs ? sight.upCones : sight.cones) if (coneMeetsBox(planes, box)) return true;
  return false;
}

// The box an actor (a survivor, a zombie, a crate) may draw in, from its feet
// and its scale (MIRROR_SIGHT).
const actorFeet = new THREE.Vector3(), actorScale = new THREE.Vector3();
export function actorBounds(object, box, enclosure) {
  object.updateWorldMatrix(true, false);
  actorFeet.setFromMatrixPosition(object.matrixWorld); actorScale.setFromMatrixScale(object.matrixWorld);
  const size = Math.max(Math.abs(actorScale.x), Math.abs(actorScale.y), Math.abs(actorScale.z), 1e-3), reach = MIRROR_SIGHT.actorReach * size;
  let bottom = actorFeet.y - MIRROR_SIGHT.actorBelow * size;
  if (enclosure && actorFeet.y >= enclosure.upstairs) bottom = Math.max(bottom, enclosure.upstairs);
  box.min.set(actorFeet.x - reach, bottom, actorFeet.z - reach);
  box.max.set(actorFeet.x + reach, actorFeet.y + MIRROR_SIGHT.actorTop * size, actorFeet.z + reach);
  return box;
}

// The pane faces of the maze, two per 'mirror-panel' of LEVEL.furniture.
export function mirrorFaces(furniture = []) {
  const faces = [];
  for (const panel of furniture ?? []) {
    if (panel?.kind !== 'mirror-panel') continue;
    const alongX = panel.maxX - panel.minX > panel.maxZ - panel.minZ, base = panel.baseY ?? 0;
    const cx = (panel.minX + panel.maxX) / 2, cz = (panel.minZ + panel.maxZ) / 2;
    const half = (alongX ? panel.maxX - panel.minX : panel.maxZ - panel.minZ) / 2;
    const paneWidth = 2 * (half - MIRROR_PANE.inset), bottom = base + MIRROR_PANE.bottom, top = base + panel.height - MIRROR_PANE.top;
    for (const side of [1, -1]) {
      const normal = Object.freeze(alongX ? { x: 0, z: side } : { x: side, z: 0 }), along = Object.freeze(alongX ? { x: 1, z: 0 } : { x: 0, z: 1 });
      const lift = MIRROR_PANE.offset + MIRROR_FIT.lift, width = paneWidth - 2 * MIRROR_FIT.margin, height = top - bottom - 2 * MIRROR_FIT.margin;
      const centre = Object.freeze({ x: cx + normal.x * lift, y: (bottom + top) / 2, z: cz + normal.z * lift });
      const extent = new THREE.Vector3(Math.abs(along.x) * width / 2 + Math.abs(normal.x) * .01, height / 2, Math.abs(along.z) * width / 2 + Math.abs(normal.z) * .01);
      const box = new THREE.Box3(new THREE.Vector3(centre.x, centre.y, centre.z).sub(extent), new THREE.Vector3(centre.x, centre.y, centre.z).add(extent));
      // The face as an opening for MIRROR_SIGHT, a margin wider.
      const reach = width / 2 + MIRROR_SIGHT.pane, rise = height / 2 + MIRROR_SIGHT.pane;
      const corners = [[-reach, -rise], [reach, -rise], [reach, rise], [-reach, rise]]
        .map(([u, v]) => Object.freeze(new THREE.Vector3(centre.x + along.x * u, centre.y + v, centre.z + along.z * u)));
      faces.push(Object.freeze({
        id: `${panel.id}:${alongX ? (side > 0 ? 'south' : 'north') : (side > 0 ? 'east' : 'west')}`, panelId: panel.id, side, normal, along, centre, width, height,
        yaw: Math.atan2(normal.x, normal.z), box,
        pane: Object.freeze({ x: cx + normal.x * MIRROR_PANE.offset, z: cz + normal.z * MIRROR_PANE.offset, width: paneWidth, bottom, top }),
        window: Object.freeze({ corners: Object.freeze(corners), centre: Object.freeze(new THREE.Vector3(centre.x, centre.y, centre.z)), normal: Object.freeze(new THREE.Vector3(normal.x, 0, normal.z)) }),
      }));
    }
  }
  return faces;
}

// Signed distance in front of the face and distance to its rectangle.
export function faceDistance(face, point) {
  const dx = point.x - face.centre.x, dy = point.y - face.centre.y, dz = point.z - face.centre.z;
  const facing = dx * face.normal.x + dz * face.normal.z, across = dx * face.along.x + dz * face.along.z;
  return { facing, distance: Math.hypot(facing, Math.max(0, Math.abs(across) - face.width / 2), Math.max(0, Math.abs(dy) - face.height / 2)) };
}

// How much a face matters on screen: over a 4 x 4 grid of its cells inside
// the view frustum, each cell's solid angle weighted by cos^4 of its angle to
// the view direction. The mirror the player looks at wins over a larger one
// seen edge-on at the side of the screen.
const GRID = [-.375, -.125, .125, .375];
const gridPoint = new THREE.Vector3(), toPoint = new THREE.Vector3();
export function facePriority(face, eye, view, frustum) {
  const cell = face.width * face.height / 16;
  let total = 0;
  for (const u of GRID) for (const v of GRID) {
    gridPoint.set(face.centre.x + face.along.x * u * face.width, face.centre.y + v * face.height, face.centre.z + face.along.z * u * face.width);
    if (!frustum.containsPoint(gridPoint)) continue;
    const squared = toPoint.subVectors(gridPoint, eye).lengthSq();
    if (!(squared > 1e-8)) continue;
    const length = Math.sqrt(squared), toward = -(toPoint.x * face.normal.x + toPoint.z * face.normal.z) / length, centred = toPoint.dot(view) / length;
    if (toward > 0 && centred > 0) total += cell * toward / squared * centred ** 4;
  }
  return total;
}

// The share of the screen a face covers (MIRROR_RANGE.second): its quad in
// clip coordinates (x, y, w), clipped to the view and in front of the eye
// before the perspective divide, over the whole view.
const shareCorner = new THREE.Vector4();
const SHARE_PLANES = Object.freeze([[-1, 0, 1, 0], [1, 0, 1, 0], [0, -1, 1, 0], [0, 1, 1, 0], [0, 0, 1, -1e-4]]);
export function faceShare(face, viewProjection) {
  let polygon = [];
  for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
    shareCorner.set(face.centre.x + face.along.x * u * face.width, face.centre.y + v * face.height, face.centre.z + face.along.z * u * face.width, 1).applyMatrix4(viewProjection);
    polygon.push([shareCorner.x, shareCorner.y, shareCorner.w]);
  }
  for (const [px, py, pw, offset] of SHARE_PLANES) {
    const clipped = [], side = point => px * point[0] + py * point[1] + pw * point[2] + offset;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length], da = side(a), db = side(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); clipped.push(a.map((value, axis) => value + (b[axis] - value) * t)); }
    }
    polygon = clipped;
    if (polygon.length < 3) return 0;
  }
  let twice = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    twice += a[0] / a[2] * (b[1] / b[2]) - b[0] / b[2] * (a[1] / a[2]);
  }
  // The view is 2 x 2 in normalised device coordinates.
  return Math.abs(twice) / 8;
}

// Three.js's own reflector shader with the old mirror's tint instead of an
// overlay blend. The target already holds the main view's own colours (see
// sameAsScreen): no second tone mapping, no second encoding. 'opacity' is the
// fade (MIRROR_LOOK.fade, see setOpacity).
const MIRROR_SHADER = Object.freeze({
  name: 'FunfairMirrorShader',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, haze: { value: MIRROR_LOOK.haze }, opacity: { value: 1 } },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform float haze;
    uniform float opacity;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj( tDiffuse, vUv );
      gl_FragColor = vec4( base.rgb * color + haze, opacity );
    }`,
});
export { MIRROR_SHADER };

// The fade, without changing the mirror's shader program or its place in the
// opaque list. Its material always blends (CustomBlending): at rest with
// factors one and zero, which writes the reflection as an opaque surface
// does; while it fades, over the source alpha and drawn after the opaque
// objects of render order 0, so the decor glass behind it is already there.
const REPLACE = Object.freeze({ src: THREE.OneFactor, dst: THREE.ZeroFactor, order: 0 });
const OVER = Object.freeze({ src: THREE.SrcAlphaFactor, dst: THREE.OneMinusSrcAlphaFactor, order: 1 });
export function setOpacity(reflector, value) {
  const material = reflector.material, opacity = Math.max(0, Math.min(1, value)), blend = opacity < 1 ? OVER : REPLACE;
  material.uniforms.opacity.value = opacity;
  material.blending = THREE.CustomBlending; material.blendEquation = THREE.AddEquation;
  material.blendSrc = blend.src; material.blendDst = blend.dst; material.blendSrcAlpha = null; material.blendDstAlpha = null;
  reflector.renderOrder = blend.order;
  return opacity;
}

// WebGLRenderer tone maps and encodes only the canvas, or a target flagged as
// an XR one, which it encodes in the target texture's colour space. Flagged so
// and marked sRGB, a reflection target is drawn with the very shader programs,
// tone mapping, encoding, fog and background of the main view (its colours
// match by construction) and no material switches programs between the two
// passes. Half float keeps the stored display values unclamped and unquantised.
export function sameAsScreen(renderTarget) {
  renderTarget.isXRRenderTarget = true;
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  return renderTarget;
}

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const UMBRELLA_WORN = 0x786649, UMBRELLA_FRESH = 0x425e55;

// scene: where the pool and the avatar live. quality: the graphics preset
// (its id picks the pool). rayBlockers: the world's collision proxies, for the
// line of sight to a pane. factories: createSurvivor, setSurvivorWeapon,
// setSurvivorSecondaryWeapon, animateSurvivor, getSurvivorStyle and
// createUmbrella from world.js (the teammates' own pipeline). isReady: whether
// the decor is in place. offstage: what no cellar mirror can show (the
// outdoor scenery, the sky, the rain), left out of reflection passes; the pool
// only ever works in the cellar. enclosure (mirrorEnclosure), scenery (a
// function listing the static scenery once the decor is in place) and movers
// (objects that move, beside the scene's survivors and zombies): MIRROR_SIGHT.
// loadReflector: how Reflector is fetched (tests). clock: seconds, for
// MIRROR_BUDGET (tests).
export function createFunfairMirrors({ scene, quality, rayBlockers = [], furniture = [], factories = {}, isReady = () => true, offstage = [],
  enclosure = null, scenery = () => [], movers = [], loadReflector = () => import('/vendor/Reflector.js'), log = console,
  clock = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000 } = {}) {
  const poolSize = MIRROR_POOL[quality?.id] ?? 0;
  const faces = mirrorFaces(furniture);
  const rig = new THREE.Group(); rig.name = 'funfairMirrors';
  if (poolSize > 0 && faces.length) scene?.add(rig);
  const pool = [], assigned = new Map(), assignedAt = new Map(), goneAt = new Map(), stats = { loads: 0, renders: 0, nested: 0, evaluations: 0, skipped: 0, reused: 0, settled: 0 };
  // The last hand-overs, for the tests: 'arrive', 'leave' (a fade out
  // begins, with why), 'back' (won back while fading), 'left' (faded out),
  // 'gone:<why>' (given up at once: off screen) and 'release' (forced).
  const handovers = [], logHandover = (event, face, time, extra = {}) => { handovers.push({ event, face: face.id, time, ...extra }); if (handovers.length > 256) handovers.shift(); };
  const eye = new THREE.Vector3(), view = new THREE.Vector3(), lastEye = new THREE.Vector3(Infinity, 0, 0), lastView = new THREE.Vector3();
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), raycaster = new THREE.Raycaster(), target = new THREE.Vector3(), direction = new THREE.Vector3();
  const corner = new THREE.Vector4(), drawing = new THREE.Vector2();
  const bounds = faces.length ? faces.reduce((box, face) => box.union(face.box), new THREE.Box3()) : null;
  const panelBase = Math.min(...(furniture ?? []).filter(item => item?.kind === 'mirror-panel').map(item => item.baseY ?? 0));
  let renderer = null, loading = null, loadError = null, built = false, ready = false, disposed = false, blockers = null;
  let geometry = null, avatar = null, avatarStyle = null, avatarTime = null, localState = null, lastEvaluation = -Infinity, rendering = false;
  let forcedOff = false, avatarInMirrors = true, lastCamera = null, lastTime = 0, fadeClock = null, updates = 0;
  // MIRROR_SIGHT: the static scenery's bounds, measured once; each pass's cones.
  let sightOn = true, sightItems = null, culled = 0, guardOn = true, exempt = null;
  const leftOut = [];
  const apex = new THREE.Vector3(), actorBox = new THREE.Box3(), spriteScale = new THREE.Vector3();
  const nodeBox = new THREE.Box3(), nodePoint = new THREE.Vector3(), nodeSize = new THREE.Vector3(), lit = new WeakMap();
  let sight = { open: true, cones: [], upCones: [] };
  // MIRROR_BUDGET. stage: 'full', 'light' or 'glass' (for good); clock: the
  // last sample; shown: whether the frame since then showed a live mirror,
  // renders: the passes drawn by then; frame: the frame being shown (catch-ups
  // joined to the next), joining: the last sample left one pending (the light
  // mirror's alternation then waits: both parts are of one kind), beat: that
  // alternation; average: the shown frames, drawnAverage: those that drew the
  // light reflection; slow and headroom: seconds of slow frames ('full') and
  // of fast drawing frames ('light'); degrades: the steps down to 'light' so
  // far; window: the light mirror's frames of each kind; calm: the keeping
  // frames of the last calm windows of this light spell (the reference),
  // restless: seconds of windows set aside since the last calm one; streak:
  // windows in a row that blamed the mirror; judged, blamed and setAside:
  // windows so far, those that blamed it, those set aside; verdicts and last:
  // the last windows' verdicts; freed: the targets were freed after the fade
  // to the glass.
  const freshFrame = () => ({ time: 0, drew: false, shown: false });
  const freshWindow = () => ({ drawn: 0, drawnCount: 0, kept: 0, keptCount: 0 });
  const freshGuard = () => ({ stage: 'full', clock: null, shown: false, renders: 0, frame: freshFrame(), joining: false, beat: 0, average: null, drawnAverage: null,
    slow: 0, headroom: 0, degrades: 0, window: freshWindow(), calm: [], restless: 0, streak: 0, judged: 0, blamed: 0, setAside: 0, verdicts: [], last: null, freed: false, steps: [] });
  const guard = freshGuard();

  const inCellar = point => Number.isFinite(panelBase) && point.y >= panelBase - .5 && point.y <= panelBase + MIRROR_RANGE.cellarTop;
  const nearMaze = point => {
    if (!bounds || !inCellar(point)) return false;
    const dx = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x), dz = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
    return Math.hypot(dx, dz) <= MIRROR_RANGE.prepare;
  };

  function prepare() {
    if (loading || disposed || poolSize === 0 || !faces.length) return;
    stats.loads++;
    loading = Promise.resolve().then(() => loadReflector()).then(module => {
      if (disposed) return false;
      const Reflector = module?.Reflector;
      if (typeof Reflector !== 'function') throw new Error('Reflector.js has no Reflector export');
      build(Reflector);
      return precompile().then(() => { ready = !disposed; return ready; });
    }).catch(error => { loadError = String(error?.message ?? error); log?.warn?.('Funfair mirrors:', error); return false; });
  }

  function build(Reflector) {
    geometry = new THREE.PlaneGeometry(1, 1);
    const tint = new THREE.Color().setRGB(...MIRROR_LOOK.tint, THREE.LinearSRGBColorSpace);
    for (let index = 0; index < poolSize; index++) {
      const reflector = new Reflector(geometry, { clipBias: MIRROR_LOOK.clipBias, textureWidth: 256, textureHeight: 256, color: tint,
        multisample: MIRROR_LOOK.samples[quality.id] ?? 0, shader: MIRROR_SHADER });
      reflector.name = `funfairMirror-${index + 1}`; reflector.visible = false;
      reflector.castShadow = reflector.receiveShadow = false; reflector.material.toneMapped = false;
      sameAsScreen(reflector.getRenderTarget());
      reflector.camera.layers.enable(MIRROR_LAYER);
      reflector.userData.face = null; reflector.userData.view = null; reflector.userData.leaving = false; reflector.userData.opacity = 0;
      // Built blending (setOpacity): the fade never changes its program.
      setOpacity(reflector, 1);
      wrap(reflector);
      rig.add(reflector); pool.push(reflector);
    }
    built = true;
  }

  // The avatar's and the mirror's shaders are compiled before the first live
  // mirror, not during it (the scene's own are the main view's).
  async function precompile() {
    if (!renderer?.compileAsync || !pool.length) return;
    ensureAvatar();
    const previous = renderer.getRenderTarget();
    let pending = null;
    try {
      renderer.setRenderTarget(pool[0].getRenderTarget());
      pending = renderer.compileAsync(scene, pool[0].camera);
    } catch (error) { log?.warn?.('Funfair mirrors (shaders):', error); }
    finally { renderer.setRenderTarget(previous); }
    if (pending) await Promise.race([pending.catch(() => {}), new Promise(done => setTimeout(done, 4000))]);
  }

  // One reflection pass: the other mirrors hidden (no recursion: the GLB glass
  // behind them shows), the first-person weapon, umbrella and fuel can hidden
  // (the avatar carries its own), what the mirror cannot show hidden
  // (MIRROR_SIGHT), the target at half the drawing buffer and the reflected
  // camera narrowed to the pane (crop). update() runs it before the main
  // render, at the top level, where it shares the main view's light state.
  function pass(reflector, activeRenderer, camera, renderScene = scene) {
    // From behind its plane a mirror shows nothing: Reflector.js's own test,
    // made here so that a pass is either drawn whole or not begun.
    reflector.updateWorldMatrix(true, false);
    direction.setFromMatrixPosition(reflector.matrixWorld).sub(target.setFromMatrixPosition(camera.matrixWorld));
    if (direction.dot(target.set(0, 0, 1).transformDirection(reflector.matrixWorld)) >= 0) return;
    fitTarget(reflector, activeRenderer);
    const lens = crop(reflector, camera), renderTarget = reflector.getRenderTarget();
    const hidden = [];
    for (const other of pool) if (other !== reflector && other.visible) { other.visible = false; hidden.push(other); }
    for (const child of camera?.children ?? []) if (child.visible && !child.isLight) { child.visible = false; hidden.push(child); }
    for (const object of offstage) if (object?.visible) { object.visible = false; hidden.push(object); }
    hideUnseen(reflector, camera, hidden);
    rendering = true;
    try { reflector.userData.render.call(reflector, activeRenderer, renderScene, lens); stats.renders++; guard.shown = true; }
    finally { rendering = false; for (const object of hidden) object.visible = true; }
    // The texture lookup lands in the viewport the pane was drawn in.
    reflector.material.uniforms.textureMatrix.value.premultiply(matrix.makeScale(renderTarget.viewport.z / renderTarget.width, renderTarget.viewport.w / renderTarget.height, 1));
    const data = reflector.userData;
    data.view = viewKey(camera, activeRenderer); data.dirty = false; data.drawnFace = data.face;
    (data.passEye ??= new THREE.Vector3()).setFromMatrixPosition(camera.matrixWorld); camera.getWorldDirection(data.passView ??= new THREE.Vector3());
  }
  // MIRROR_BUDGET.light: a frame that keeps the last reflection instead of
  // drawing it again. The texture lookup still maps each point of the pane
  // through the camera it was drawn with, so the reflection lags one frame and
  // nothing else changes. Only for a reflection drawn for this pane at this
  // canvas size; one whose narrowed lens was cut by the screen's edge covers
  // only what was on screen then, so it is kept only while the eye has turned
  // and moved less than light.turn and light.move (under its 4-pixel margin).
  function reuseLast(reflector, camera, activeRenderer) {
    const data = reflector.userData;
    if (data.dirty || !data.view || data.drawnFace !== data.face) return false;
    drawing.set(0, 0); activeRenderer?.getDrawingBufferSize?.(drawing);
    if (data.view[32] !== drawing.x || data.view[33] !== drawing.y) return false;
    // The eye must still be in front of the mirror, as for a pass.
    if (faceDistance(data.face, eye).facing <= 0) return false;
    if (data.clamped && (eye.distanceTo(data.passEye) > MIRROR_BUDGET.light.move || view.angleTo(data.passView) > MIRROR_BUDGET.light.turn)) return false;
    data.view = viewKey(camera, activeRenderer); stats.reused++; guard.shown = true;
    return true;
  }
  // MIRROR_SIGHT. Nothing with a light inside is ever hidden: the reflection
  // keeps the main view's lights, hence its shader programs.
  const holdsLight = object => {
    let found = lit.get(object);
    if (found === undefined) { found = false; object.traverse(node => { if (node.isLight) found = true; }); lit.set(object, found); }
    return found;
  };
  // World bounds of what an object draws; a sprite, which turns to the
  // camera, as a cube around its centre.
  function boundsOf(object, box) {
    box.makeEmpty(); object.updateWorldMatrix(true, true);
    object.traverse(node => {
      if (node.isSprite) {
        node.getWorldPosition(nodePoint); spriteScale.setFromMatrixScale(node.matrixWorld);
        box.union(nodeBox.setFromCenterAndSize(nodePoint, nodeSize.setScalar(2 * MIRROR_SIGHT.spriteRadius * Math.max(Math.abs(spriteScale.x), Math.abs(spriteScale.y)))));
      } else if ((node.isMesh || node.isLine || node.isPoints) && node.geometry) {
        if (node.boundingBox !== undefined) { if (node.boundingBox === null) node.computeBoundingBox(); nodeBox.copy(node.boundingBox); }
        else { if (!node.geometry.boundingBox) node.geometry.computeBoundingBox(); nodeBox.copy(node.geometry.boundingBox); }
        if (!nodeBox.isEmpty()) box.union(nodeBox.applyMatrix4(node.matrixWorld));
      }
    });
    return box;
  }
  // The static scenery (the decor's meshes, the racks, the halos, the door
  // frames...), measured the first time a pass needs it.
  function sceneryItems() {
    if (sightItems) return sightItems;
    let listed = [];
    try { listed = [...new Set(scenery?.() ?? [])]; } catch (error) { log?.warn?.('Funfair mirrors (scenery):', error); }
    sightItems = [];
    for (const object of listed) {
      if (!object?.isObject3D || object === rig || holdsLight(object)) continue;
      const box = boundsOf(object, new THREE.Box3());
      if (!box.isEmpty()) sightItems.push({ object, box });
    }
    return sightItems;
  }
  const canShow = box => canMirrorShow(enclosure, sight, box);
  function actorsNow() {
    const list = [];
    for (const child of scene?.children ?? []) if (child !== rig && child.userData?.body) list.push(child);
    for (const object of movers) if (object?.isObject3D) list.push(object);
    return list;
  }
  function hideUnseen(reflector, camera, hidden) {
    culled = 0; leftOut.length = 0;
    const face = reflector.userData.face;
    if (!enclosure || !sightOn || !face) return;
    sight = mirrorSight(enclosure, face, apex.setFromMatrixPosition(camera.matrixWorld));
    if (sight.open) return;
    const hide = object => { if (exempt?.has(object)) return; object.visible = false; hidden.push(object); leftOut.push(object); culled++; };
    for (const item of sceneryItems()) if (item.object.visible && !canShow(item.box)) hide(item.object);
    for (const object of actorsNow()) if (object.visible && !holdsLight(object) && !canShow(actorBounds(object, actorBox, enclosure))) hide(object);
  }

  // MIRROR_BUDGET, sampled once per update(): true while the maze shows the
  // glass for good. The interval since the last sample is the frame the last
  // update drew: it drew reflections when passes were made since, and showed
  // a live mirror when one was drawn or kept. Catch-ups join the next frame,
  // which then drew reflections if any part did: every average and both kinds
  // of the comparison count the same frames.
  const ema = (average, value) => average === null ? value : average + (value - average) * MIRROR_BUDGET.smoothing;
  function quiet() { guard.average = null; guard.drawnAverage = null; guard.slow = 0; guard.headroom = 0; guard.window = freshWindow(); }
  function sampleFrame(now) {
    const interval = guard.clock === null ? NaN : now - guard.clock, shown = guard.shown, drew = stats.renders > guard.renders;
    guard.clock = now; guard.shown = false; guard.renders = stats.renders; guard.joining = false;
    if (!guardOn) return false;
    if (guard.stage === 'glass') return true;
    if (!(interval >= 0 && interval <= MIRROR_BUDGET.hitch)) { guard.frame = freshFrame(); return false; }
    const frame = guard.frame;
    frame.time += interval; frame.drew ||= drew; frame.shown ||= shown;
    if (frame.time < MIRROR_BUDGET.catchUp) { guard.joining = true; return false; }
    guard.frame = freshFrame();
    if (!frame.shown) { quiet(); return false; }
    account(frame.time, frame.drew, now);
    return guard.stage === 'glass';
  }
  const recoverAfter = () => Math.min(MIRROR_BUDGET.recoverMax, MIRROR_BUDGET.recover * 2 ** Math.max(0, guard.degrades - 1));
  function account(seconds, drew, now) {
    // A stall counts as 'spike' times the running average (MIRROR_BUDGET).
    const counted = guard.average === null ? seconds : Math.min(seconds, MIRROR_BUDGET.spike * guard.average);
    guard.average = ema(guard.average, counted);
    if (guard.stage === 'full') {
      if (guard.average > MIRROR_BUDGET.slow) { guard.slow += seconds; if (guard.slow >= MIRROR_BUDGET.after) stepTo('light', now); }
      else guard.slow = 0;
      return;
    }
    // 'light': headroom on the frames that drew the reflection.
    if (drew) guard.drawnAverage = ema(guard.drawnAverage, counted);
    if (guard.drawnAverage !== null && guard.drawnAverage < MIRROR_BUDGET.fast) {
      guard.headroom += seconds;
      if (guard.headroom >= recoverAfter()) { stepTo('full', now); return; }
    } else guard.headroom = 0;
    const side = guard.window;
    if (drew) { side.drawn += counted; side.drawnCount++; } else { side.kept += counted; side.keptCount++; }
    const { kinds, span, ahead } = MIRROR_BUDGET;
    if (Math.abs(side.drawnCount - side.keptCount) > ahead) guard.window = freshWindow();
    else if (side.drawnCount >= kinds && side.keptCount >= kinds && side.drawn >= span && side.kept >= span) judge(now);
  }
  const medianOf = list => {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  // One window of the light mirror's frames, side by side: 'calm' is null for
  // a window that only measures, false for one set aside.
  function judge(now) {
    const side = guard.window, drawn = side.drawn / side.drawnCount, kept = side.kept / side.keptCount;
    const live = (side.drawn + side.kept) / (side.drawnCount + side.keptCount);
    const { gain, floor, calm: calmBy, calmOf, renew, spells } = MIRROR_BUDGET;
    if (guard.restless >= renew) guard.calm.length = 0;
    const reference = medianOf(guard.calm), calm = reference === null ? null : kept <= reference * calmBy;
    if (calm === false) { guard.restless += side.drawn + side.kept; guard.setAside++; }
    else { guard.calm.push(kept); if (guard.calm.length > calmOf) guard.calm.shift(); guard.restless = 0; }
    const ratio = drawn / kept, cause = calm === true && ratio >= 1 + gain && live > floor;
    guard.streak = cause ? guard.streak + 1 : 0; guard.judged++; if (cause) guard.blamed++;
    guard.last = { by: 'frames', at: now, drawn, kept, live, ratio, reference, calm, cause, streak: guard.streak, frames: [side.drawnCount, side.keptCount], seconds: [side.drawn, side.kept] };
    guard.verdicts.push(guard.last); if (guard.verdicts.length > 32) guard.verdicts.shift();
    guard.window = freshWindow();
    if (guard.streak >= spells) stepTo('glass', now);
  }
  const glassNow = () => guardOn && guard.stage === 'glass';
  // A step of the guard: the targets follow ('light' and 'glass': smaller,
  // without multisampling; 'full': as the tier has them). 'glass' keeps the
  // last reflections for the fade out, then frees the targets (update).
  function stepTo(stage, now) {
    const from = guard.stage;
    guard.stage = stage; guard.steps.push({ at: now, stage }); if (guard.steps.length > 16) guard.steps.shift();
    if (from === 'full' && stage === 'light') guard.degrades++;
    // Each light spell measures its own calm reference.
    quiet(); guard.streak = 0; guard.freed = false; guard.calm = []; guard.restless = 0;
    const samples = stage === 'full' ? MIRROR_LOOK.samples[quality.id] ?? 0 : MIRROR_BUDGET.light.samples;
    for (const reflector of pool) {
      const renderTarget = reflector.getRenderTarget();
      // A new sample count is a new target: its reflection is drawn again.
      if (renderTarget.samples !== samples) { renderTarget.samples = samples; renderTarget.dispose(); reflector.userData.dirty = true; }
      else if (stage !== 'glass') reflector.userData.dirty = true;
    }
    // The pool is chosen again at once ('light' and 'full' change how many panes it takes).
    lastEvaluation = -Infinity;
  }

  // What a reflection was drawn for: the eye, its lens and the canvas size.
  function viewKey(camera, activeRenderer) {
    drawing.set(0, 0); activeRenderer?.getDrawingBufferSize?.(drawing);
    return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, drawing.x, drawing.y];
  }
  const sameView = (key, camera, activeRenderer) => {
    if (!key) return false;
    const now = viewKey(camera, activeRenderer);
    return now.every((value, index) => Math.abs(value - key[index]) < 1e-7);
  };
  // Three.js calls this when it draws the mirror in the main view. The
  // reflection drawn by update() for this very view is kept; otherwise (no
  // update this frame and the view changed, a resize, a probe switch) it is
  // drawn here, nested in the main render. A main view drawn again with no
  // update since (a paused room draws the scene and runs no update) ends a
  // fade at once: a mirror is never left half faded for a whole pause.
  function wrap(reflector) {
    reflector.userData.render = reflector.onBeforeRender;
    reflector.onBeforeRender = function (activeRenderer, renderScene, camera) {
      if (rendering || disposed) { stats.skipped++; return; }
      renderer ??= activeRenderer;
      const data = reflector.userData;
      if (data.drawnAfter === updates) endFade(reflector); else data.drawnAfter = updates;
      if (!data.dirty && sameView(data.view, camera, activeRenderer)) return;
      stats.nested++; pass(reflector, activeRenderer, camera, renderScene);
    };
  }
  // The fade's end, at once: in whole, or out (the next update releases it).
  function endFade(reflector) {
    const data = reflector.userData, end = data.leaving ? 0 : 1;
    if (!data.face || data.opacity === end) return;
    data.opacity = setOpacity(reflector, end); stats.settled++;
  }

  function fitTarget(reflector, activeRenderer) {
    if (!activeRenderer?.getDrawingBufferSize) return;
    activeRenderer.getDrawingBufferSize(drawing);
    const scale = guard.stage === 'full' ? MIRROR_LOOK.textureScale : MIRROR_BUDGET.light.textureScale;
    const width = Math.max(1, Math.round(drawing.x * scale)), height = Math.max(1, Math.round(drawing.y * scale));
    const renderTarget = reflector.getRenderTarget();
    if (renderTarget.width !== width || renderTarget.height !== height) renderTarget.setSize(width, height);
  }

  // The reflected camera narrowed to the pane. A point of the mirror plane is
  // its own reflection, so the reflected camera sees it at the same height and
  // at the opposite horizontal position (a reflection reverses handedness): the
  // pane's screen rectangle mirrored left to right, two target pixels wider.
  // Reflector.js builds its camera from the eye it is given; given this eye,
  // whose lens is cropped to that rectangle, it frustum-culls everything the
  // pane cannot show and draws the pane into a viewport of the target sized as
  // the pane is on screen (at the target's scale), not the whole target.
  const lensEye = new THREE.PerspectiveCamera(), cropMatrix = new THREE.Matrix4();
  lensEye.matrixAutoUpdate = false; lensEye.matrixWorldAutoUpdate = false;
  // 'clamped' when the pane is not drawn whole (cut by the screen's edge, or
  // the whole view kept): MIRROR_BUDGET.light then keeps it only while the eye
  // stays still (reuseLast).
  function crop(reflector, camera) {
    const renderTarget = reflector.getRenderTarget(), width = renderTarget.width, height = renderTarget.height;
    renderTarget.viewport.set(0, 0, width, height); renderTarget.scissor.set(0, 0, width, height); renderTarget.scissorTest = false;
    lensEye.matrixWorld.copy(camera.matrixWorld); lensEye.matrixWorldInverse.copy(camera.matrixWorldInverse);
    lensEye.projectionMatrix.copy(camera.projectionMatrix); lensEye.far = camera.far; lensEye.near = camera.near;
    reflector.userData.clamped = true;
    const p = camera.projectionMatrix.elements;
    if (Math.abs(p[8]) > 1e-9 || Math.abs(p[9]) > 1e-9) return lensEye; // an off-centre lens: no crop
    reflector.updateWorldMatrix(true, false);
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(reflector.matrixWorld);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
      corner.set(x, y, 0, 1).applyMatrix4(matrix);
      if (!(corner.w > 1e-6)) return lensEye; // a corner behind the eye: the whole view
      minX = Math.min(minX, corner.x / corner.w); maxX = Math.max(maxX, corner.x / corner.w);
      minY = Math.min(minY, corner.y / corner.w); maxY = Math.max(maxY, corner.y / corner.w);
    }
    const padX = 4 / width, padY = 4 / height;
    const x0 = Math.max(-1, -maxX - padX), x1 = Math.min(1, -minX + padX), y0 = Math.max(-1, minY - padY), y1 = Math.min(1, maxY + padY);
    if (!(x1 > x0 && y1 > y0)) return lensEye;
    reflector.userData.clamped = x0 === -1 || x1 === 1 || y0 === -1 || y1 === 1;
    const viewportWidth = Math.max(1, Math.min(width, Math.ceil((x1 - x0) / 2 * width))), viewportHeight = Math.max(1, Math.min(height, Math.ceil((y1 - y0) / 2 * height)));
    cropMatrix.set(2 / (x1 - x0), 0, 0, -(x1 + x0) / (x1 - x0), 0, 2 / (y1 - y0), 0, -(y1 + y0) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1);
    lensEye.projectionMatrix.premultiply(cropMatrix);
    renderTarget.viewport.set(0, 0, viewportWidth, viewportHeight); renderTarget.scissor.set(0, 0, viewportWidth, viewportHeight); renderTarget.scissorTest = true;
    return lensEye;
  }

  // Walls, slabs and panels around the maze, for the line of sight.
  function nearbyBlockers() {
    if (blockers) return blockers;
    const region = bounds.clone().expandByScalar(MIRROR_RANGE.live + 1), box = new THREE.Box3();
    blockers = (rayBlockers ?? []).filter(mesh => {
      if (!mesh?.isMesh) return false;
      mesh.updateWorldMatrix(true, false);
      return region.intersectsBox(box.setFromObject(mesh));
    });
    return blockers;
  }
  // Seen when one of five points just in front of the panel's box is in clear view.
  function lineOfSight(face, from) {
    const list = nearbyBlockers();
    for (const [u, v] of [[0, 0], [-.35, -.35], [.35, -.35], [.35, .35], [-.35, .35]]) {
      target.set(face.centre.x + face.along.x * u * face.width + face.normal.x * .07, face.centre.y + v * face.height,
        face.centre.z + face.along.z * u * face.width + face.normal.z * .07);
      const length = direction.subVectors(target, from).length();
      if (length < 1e-3) return true;
      raycaster.set(from, direction.multiplyScalar(1 / length)); raycaster.near = 0; raycaster.far = length;
      if (!raycaster.intersectObjects(list, false).length) return true;
    }
    return false;
  }

  function place(reflector, face) {
    reflector.position.set(face.centre.x, face.centre.y, face.centre.z);
    reflector.rotation.set(0, face.yaw, 0);
    reflector.scale.set(face.width, face.height, 1);
    reflector.updateMatrixWorld(true);
  }
  // A reflector given up at once: hidden, the glass behind shows.
  function release(reflector, reason = 'release') {
    const face = reflector.userData.face;
    if (face) {
      assigned.delete(face); assignedAt.delete(face); logHandover(reason, face, lastTime);
      // MIRROR_RANGE.back, for what the eye made go (not a forced release).
      if (reason !== 'release') goneAt.set(face, lastTime);
    }
    Object.assign(reflector.userData, { face: null, leaving: false, opacity: 0 });
    reflector.visible = false;
  }
  function releaseAll() { for (const reflector of pool) release(reflector); }
  // A reflector given up: if it is on screen, it fades out (MIRROR_LOOK.fade)
  // and keeps its place in the pool until it has; otherwise it goes at once.
  function leave(reflector, why) {
    const data = reflector.userData;
    if (!data.face || data.leaving) return;
    reflector.updateMatrixWorld(true);
    if (!reflector.visible || !(data.opacity > 0) || faceDistance(data.face, eye).facing <= 0 || !frustum.intersectsObject(reflector)) { release(reflector, `gone:${why}`); return; }
    data.leaving = true; logHandover('leave', data.face, lastTime, { why });
  }
  function assign(reflector, face, time) {
    Object.assign(reflector.userData, { face, leaving: false, opacity: 0 });
    assigned.set(face, reflector); assignedAt.set(face, time);
    place(reflector, face); setOpacity(reflector, 0); reflector.visible = true;
    logHandover('arrive', face, time);
  }
  // The fades: each reflector moves its opacity toward 1, or 0 when leaving,
  // by 1 / MIRROR_LOOK.fade a second; one that has faded out is released and
  // (unless the guard holds the glass) the pool is chosen again in the same
  // frame, so the pane waiting for it starts to fade in at once.
  function fade(time, camera, resting) {
    const delta = fadeClock === null || time < fadeClock ? 0 : Math.min(.1, time - fadeClock), step = delta / MIRROR_LOOK.fade;
    fadeClock = time;
    let freed = false;
    for (const reflector of pool) {
      const data = reflector.userData;
      if (!data.face) continue;
      data.opacity = data.leaving ? data.opacity - step : Math.min(1, data.opacity + step);
      if (data.leaving && data.opacity <= 0) { release(reflector, 'left'); freed = true; }
    }
    if (freed) { lastEvaluation = -Infinity; if (!resting) evaluate(time, camera); }
    for (const reflector of pool) if (reflector.userData.face) setOpacity(reflector, reflector.userData.opacity);
  }

  // The panes that face the eye within range, weigh most on screen and are in
  // clear sight; the live ones keep their place unless clearly outweighed (a
  // reflector leaving counts as free of its pane, which can still win it back).
  // The light mirror (MIRROR_BUDGET) takes one pane; a second pane must be
  // large enough on screen (MIRROR_RANGE.second) unless held.
  const viewProjection = new THREE.Matrix4();
  function evaluate(time, camera) {
    stats.evaluations++;
    lastEvaluation = time; lastEye.copy(eye); lastView.copy(view);
    if (forcedOff || !inCellar(eye)) { releaseAll(); return; }
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const slots = guard.stage === 'full' ? pool.length : Math.min(1, pool.length);
    const candidates = [];
    for (const face of faces) {
      const holder = assigned.get(face), current = Boolean(holder) && !holder.userData.leaving, { facing, distance } = faceDistance(face, eye);
      if (facing < (current ? MIRROR_RANGE.facing / 2 : MIRROR_RANGE.facing)) continue;
      if (distance > MIRROR_RANGE.live + (current ? MIRROR_RANGE.reach : 0)) continue;
      const weight = facePriority(face, eye, view, frustum);
      if (!(weight > 0)) continue;
      if (!holder && time - (goneAt.get(face) ?? -Infinity) < MIRROR_RANGE.back && time >= goneAt.get(face)) continue;
      const held = current && time - (assignedAt.get(face) ?? -Infinity) < MIRROR_RANGE.hold;
      candidates.push({ face, current, held, score: held ? Infinity : weight * (current ? MIRROR_RANGE.keep : 1) });
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = new Set(), hidden = new Set(), small = new Set();
    for (const { face, current, held } of candidates) {
      if (chosen.size >= slots) break;
      if (chosen.size >= 1 && !held && faceShare(face, viewProjection) < MIRROR_RANGE.second * (current ? .5 : 1)) { small.add(face); continue; }
      if (lineOfSight(face, eye)) chosen.add(face); else hidden.add(face);
    }
    for (const reflector of pool) {
      const face = reflector.userData.face;
      if (!face) continue;
      // 'outweighed': in sight, another pane won; 'light': the light mirror
      // takes one pane; 'small': too small on screen for a second pane;
      // 'unseen': out of range, edge-on, turned away or hidden by a wall or a panel.
      if (!chosen.has(face)) {
        const candidate = candidates.some(item => item.face === face) && !hidden.has(face);
        leave(reflector, !candidate ? 'unseen' : small.has(face) ? 'small' : slots < pool.length ? 'light' : 'outweighed');
      } else if (reflector.userData.leaving) { reflector.userData.leaving = false; logHandover('back', face, time); }
    }
    for (const face of chosen) {
      if (assigned.has(face)) continue;
      // All taken: a reflector is still fading out; this pane comes once it has.
      const reflector = pool.find(item => !item.userData.face);
      if (!reflector) break;
      assign(reflector, face, time);
    }
  }

  function ensureAvatar() {
    const player = localState?.player;
    if (!player || typeof factories.createSurvivor !== 'function') return avatar;
    const style = factories.getSurvivorStyle?.() ?? null, color = Number.isInteger(localState.color) ? localState.color : 0x809fac;
    const key = JSON.stringify([color, player.id ?? null, player.name ?? null, player.look ?? null]);
    if (avatar && avatar.userData.mirrorKey === key && avatarStyle === style) return avatar;
    disposeAvatar();
    avatar = factories.createSurvivor(color, { identity: { id: player.id, name: player.name, companion: false, look: player.look ?? null } });
    avatar.name = 'funfairMirrorAvatar'; avatar.visible = false; avatar.userData.mirrorKey = key; avatarStyle = style;
    const umbrella = factories.createUmbrella?.() ?? null;
    if (umbrella) { umbrella.name = 'funfairMirrorUmbrella'; umbrella.visible = false; avatar.add(umbrella); avatar.userData.mirrorUmbrella = umbrella; }
    avatar.userData.mirrorStyled = Boolean(avatar.userData.character);
    // MIRROR_AVATAR: the head's height at rest, as built.
    avatar.userData.mirrorHead = avatar.userData.head?.position.y ?? null;
    rig.add(avatar); layerAvatar(); avatarTime = null;
    return avatar;
  }
  // Every node of the avatar on the mirror layer alone: the main camera, its
  // shadow pass and every raycaster (layer 0) never see it.
  function layerAvatar() {
    avatar?.traverse(node => { node.layers.set(MIRROR_LAYER); if (node.isMesh) node.castShadow = false; });
  }
  function syncAvatar(time, context) {
    const player = localState?.player;
    if (!player || player.alive === false || player.waiting === true) { if (avatar) avatar.visible = false; return; }
    if (!ensureAvatar()) return;
    const delta = avatarTime === null ? 1 / 60 : Math.max(0, Math.min(.1, time - avatarTime)); avatarTime = time;
    avatar.visible = true;
    avatar.position.set(finite(localState.x, player.x ?? 0), finite(player.y, 0), finite(localState.z, player.z ?? 0));
    avatar.rotation.set(0, finite(localState.yaw, player.yaw ?? 0), 0);
    factories.setSurvivorWeapon?.(avatar, player.weapon ?? null);
    factories.setSurvivorSecondaryWeapon?.(avatar, player.dualWield ? player.hands?.secondary?.weapon ?? null : null);
    const melee = localState.melee;
    factories.animateSurvivor?.(avatar, { pitch: finite(localState.pitch, player.pitch ?? 0), backpack: player.backpack === true, crouched: player.crouched === true,
      downed: player.downed === true, secondary: player.hands?.secondary ?? null, reloading: player.reloading === true, spinning: player.minigunSpinning === true,
      spinLeft: player.minigunSpinLeft, spinDuration: context.snapshot?.minigunSpinDuration, meleeAttack: melee?.attack ?? null,
      meleeElapsed: melee?.elapsed ?? Infinity, meleeWindup: melee?.windup, meleeDuration: melee?.duration, time, delta });
    const lift = eyeLine(avatar);
    const umbrella = avatar.userData.mirrorUmbrella;
    if (umbrella) {
      const open = context.active === true && context.snapshot?.expedition?.enabled === true && player.umbrella?.open === true && player.downed !== true;
      umbrella.visible = open;
      umbrella.position.set(0, 2.12 - (avatar.userData.crouch ?? 0) * .86 + lift, 0);
      if (open) umbrella.userData.canopy?.material.color.setHex(player.umbrella.remaining > (player.umbrella.max ?? 100) * .2 ? UMBRELLA_FRESH : UMBRELLA_WORN);
    }
    layerAvatar();
  }
  // MIRROR_AVATAR, after animateSurvivor: the avatar scaled about its feet so
  // that its standing eyes are at the camera's eye height, and its head
  // raised (in the avatar's own units) as far as the camera's crouch is
  // shallower than the model's. Returns that raise.
  function eyeLine(model) {
    const data = model.userData, rest = data.mirrorHead;
    if (!data.head || !Number.isFinite(rest)) return 0;
    const scale = PLAYER_POSTURE.standingEye / (rest + MIRROR_AVATAR.eye), crouch = (data.crouch ?? 0) * (1 - (data.pose ?? 0));
    model.scale.setScalar(scale);
    const eye = (PLAYER_POSTURE.standingEye + (PLAYER_POSTURE.crouchedEye - PLAYER_POSTURE.standingEye) * crouch) / scale;
    const lift = Math.max(0, eye - MIRROR_AVATAR.eye - data.head.position.y);
    data.head.position.y += lift;
    return lift;
  }
  function disposeAvatar() {
    if (!avatar) return;
    avatar.removeFromParent();
    factories.setSurvivorSecondaryWeapon?.(avatar, null); factories.setSurvivorWeapon?.(avatar, null);
    const umbrella = avatar.userData.mirrorUmbrella;
    // Its own geometries and the unshared materials (clothes, canopy, ribs);
    // world.js's cached materials and the shared face and style parts stay.
    avatar.traverse(node => {
      if (node.geometry && !node.geometry.userData?.frissonShared && node.name !== 'survivorFace') node.geometry.dispose();
    });
    // The muzzle flash leaves the tree with the weapon: its planes and glow.
    const flashMaterials = new Set();
    avatar.userData.flash?.traverse(node => { node.geometry?.dispose(); if (node.material) flashMaterials.add(node.material); });
    for (const material of flashMaterials) material.dispose();
    if (!avatar.userData.mirrorStyled) avatar.userData.torso?.material?.dispose?.();
    umbrella?.userData.canopy?.material?.dispose?.();
    umbrella?.traverse(node => { if (node.isLineSegments) node.material?.dispose?.(); });
    avatar = null; avatarStyle = null; avatarTime = null;
  }

  const api = {
    MIRROR_LAYER, poolSize, faces, pool, rig,
    get ready() { return ready; }, get loading() { return loading; }, get loadError() { return loadError; }, get avatar() { return avatar; },
    get live() { return pool.filter(reflector => reflector.visible && reflector.userData.face).map(reflector => reflector.userData.face); },
    get handovers() { return handovers.map(item => ({ ...item })); },
    get stats() {
      return { ...stats, pool: poolSize, built, ready, live: api.live.map(face => face.id), avatar: Boolean(avatar?.visible), loadError,
        sight: { on: Boolean(enclosure) && sightOn, scenery: sightItems?.length ?? null, culled },
        leaving: pool.filter(reflector => reflector.visible && reflector.userData.leaving).map(reflector => reflector.userData.face.id),
        guard: { on: guardOn, stage: guard.stage, resting: glassNow(), average: guard.average, drawnAverage: guard.drawnAverage, slow: guard.slow, headroom: guard.headroom,
          recoverAfter: recoverAfter(), degrades: guard.degrades, streak: guard.streak, judged: guard.judged, blamed: guard.blamed, setAside: guard.setAside,
          reference: medianOf(guard.calm), restless: guard.restless, window: { ...guard.window }, freed: guard.freed, last: guard.last && { ...guard.last },
          verdicts: guard.verdicts.map(item => ({ ...item })), steps: guard.steps.map(item => ({ ...item })) } };
    },
    setRenderer(next) { if (next) renderer = next; },
    // The scenery moved or was rebuilt (the armory restyled): measured again.
    refreshScenery() { sightItems = null; },
    setLocalAvatar(state) { localState = state && typeof state === 'object' && state.player ? state : null; },
    update(time, context = {}) {
      const camera = context.camera;
      updates++;
      if (disposed || poolSize === 0 || !camera || !faces.length) return;
      camera.updateMatrixWorld();
      camera.getWorldPosition(eye); camera.getWorldDirection(view); lastCamera = camera; lastTime = time;
      if (!built) { if (nearMaze(eye) && isReady()) prepare(); return; }
      if (!ready) return;
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const resting = sampleFrame(clock());
      if (resting) {
        // MIRROR_BUDGET: the glass for good; what is live fades out first.
        for (const reflector of pool) leave(reflector, 'guard');
        lastEvaluation = -Infinity;
      } else {
        const due = time - lastEvaluation >= MIRROR_RANGE.every || time < lastEvaluation || eye.distanceTo(lastEye) > MIRROR_RANGE.move
          || view.angleTo(lastView) > MIRROR_RANGE.turn;
        if (due) evaluate(time, camera);
      }
      fade(time, camera, resting);
      // Faded out to the glass for good: the targets are freed, once.
      if (resting && !guard.freed && pool.every(reflector => !reflector.userData.face)) {
        for (const reflector of pool) reflector.getRenderTarget().dispose();
        guard.freed = true;
      }
      if (!pool.some(reflector => reflector.visible)) { if (avatar) avatar.visible = false; return; }
      syncAvatar(time, context);
      if (!renderer) return;
      // MIRROR_BUDGET.light: the reflection drawn every other frame shown
      // (catch-ups join the next frame: both parts of one kind), so that the
      // frames alternate between drawing and keeping it, which the guard
      // compares; the last one kept in between. Fading out to the glass, the
      // last reflections are kept, or drawn as light ones.
      if (guard.stage === 'light' && !guard.joining) guard.beat = (guard.beat + 1) % MIRROR_BUDGET.light.every;
      const keeping = resting || (guard.stage === 'light' && guard.beat !== 0);
      for (const reflector of pool) {
        if (!reflector.visible) continue;
        reflector.updateMatrixWorld(true);
        if (!frustum.intersectsObject(reflector)) continue;
        if (keeping && reuseLast(reflector, camera, renderer)) continue;
        pass(reflector, renderer, camera);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; ready = false;
      for (const reflector of pool) { reflector.removeFromParent(); reflector.dispose(); }
      pool.length = 0; assigned.clear(); assignedAt.clear(); goneAt.clear(); sightItems = null;
      geometry?.dispose(); geometry = null;
      disposeAvatar(); rig.removeFromParent();
      if (globalThis.__funfairMirrors?.api === api) delete globalThis.__funfairMirrors;
    },
  };
  // The test-only probe (MIRROR_PROBE_KEY): inert unless that key is set.
  const probeHidden = new Set(), seenOut = new Map(), pathOf = object => {
    const names = [];
    for (let node = object; node && node !== scene; node = node.parent) names.unshift(`${node.name || node.type}#${node.parent ? node.parent.children.indexOf(node) : 0}`);
    return names.join('/');
  };
  const faceRect = (face, canvas) => {
    if (!lastCamera || !face) return null;
    const width = canvas?.clientWidth ?? 0, height = canvas?.clientHeight ?? 0, xs = [], ys = [];
    matrix.multiplyMatrices(lastCamera.projectionMatrix, lastCamera.matrixWorldInverse);
    for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
      corner.set(face.centre.x + face.along.x * u * face.width, face.centre.y + v * face.height, face.centre.z + face.along.z * u * face.width, 1).applyMatrix4(matrix);
      if (!(corner.w > 0)) return { face: face.id, partial: true };
      xs.push((corner.x / corner.w + 1) / 2 * width); ys.push((1 - corner.y / corner.w) / 2 * height);
    }
    return { face: face.id, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  installProbe(api, {
    setAvatarInMirrors(on) { avatarInMirrors = on !== false; for (const reflector of pool) { reflector.camera.layers[avatarInMirrors ? 'enable' : 'disable'](MIRROR_LAYER); reflector.userData.dirty = true; } return avatarInMirrors; },
    // Back on, the pool is chosen again at once and shown whole, without a
    // fade (a paused room runs no update).
    setLive(on) {
      forcedOff = on === false; lastEvaluation = -Infinity;
      if (forcedOff) releaseAll();
      else if (ready && lastCamera) { evaluate(lastTime, lastCamera); for (const reflector of pool) if (reflector.userData.face) reflector.userData.opacity = setOpacity(reflector, 1); }
      return !forcedOff;
    },
    handovers() { return api.handovers; },
    // MIRROR_SIGHT switched off, for the pixel comparison that shows it hides
    // nothing a mirror shows.
    setSight(on) { sightOn = on !== false; for (const reflector of pool) reflector.userData.dirty = true; return sightOn; },
    // What the last pass left out, by path in the scene (each node with its
    // index among its siblings); and which of them the next passes keep
    // (null: none), to find which one a picture needs.
    leftOut() { return leftOut.map(object => { const path = pathOf(object); seenOut.set(path, object); return path; }); },
    keep(paths) {
      exempt = paths?.length ? new Set(paths.map(path => seenOut.get(path)).filter(Boolean)) : null;
      for (const reflector of pool) reflector.userData.dirty = true; return exempt?.size ?? 0;
    },
    // MIRROR_BUDGET switched off (a loaded test PC must not rest the mirror
    // under a measurement), or on again from a clean state.
    setGuard(on) { stepTo('full', guard.clock ?? 0); Object.assign(guard, freshGuard()); guardOn = on !== false; lastEvaluation = -Infinity; return guardOn; },
    // A neutral mirror (tint 1, no haze) for the colour comparison, or back to the old mirror.
    setNeutral(on) {
      for (const reflector of pool) {
        reflector.material.uniforms.color.value.setRGB(...(on ? [1, 1, 1] : MIRROR_LOOK.tint), THREE.LinearSRGBColorSpace);
        reflector.material.uniforms.haze.value = on ? 0 : MIRROR_LOOK.haze;
        reflector.userData.dirty = true;
      }
      return on === true;
    },
    // The first-person weapon and kit shown or hidden (it covers part of the
    // mirror in the main view, never in the reflection).
    setFirstPerson(on) {
      for (const child of lastCamera?.children ?? []) if (!child.isLight) { if (on === false) { if (child.visible) { child.visible = false; probeHidden.add(child); } } else if (probeHidden.delete(child)) child.visible = true; }
      return on !== false;
    },
    // Draws the scene straight through the first live mirror's reflected
    // camera onto the canvas, with what its pass hides hidden: the same light,
    // tone mapping and encoding as the main view, for the colour comparison.
    // The reflected camera is rebuilt here from the whole view (not narrowed
    // to the pane), so the comparison also checks the narrowed lens's mapping.
    directView() {
      const reflector = pool.find(item => item.visible);
      if (!reflector || !renderer || !lastCamera) return false;
      const hidden = [];
      for (const item of pool) if (item.visible) { item.visible = false; hidden.push(item); }
      for (const child of lastCamera.children) if (child.visible && !child.isLight) { child.visible = false; hidden.push(child); }
      const previous = renderer.getRenderTarget(), renderTarget = reflector.getRenderTarget();
      renderTarget.viewport.set(0, 0, renderTarget.width, renderTarget.height); renderTarget.scissorTest = false;
      rendering = true;
      try { reflector.userData.render.call(reflector, renderer, scene, lastCamera); renderer.setRenderTarget(null); renderer.render(scene, reflector.camera); }
      finally { rendering = false; renderer.setRenderTarget(previous); for (const object of hidden) object.visible = true; reflector.userData.dirty = true; }
      return true;
    },
    // The live panes' rectangles, or any face's, in CSS pixels of the main view as last drawn.
    rects(canvas) { return pool.filter(reflector => reflector.visible).map(reflector => faceRect(reflector.userData.face, canvas)); },
    faceRect(id, canvas) { return faceRect(faces.find(face => face.id === id), canvas); },
    targets() { return pool.map(reflector => { const target = reflector.getRenderTarget(); return { width: target.width, height: target.height, viewport: target.viewport.toArray(), scissorTest: target.scissorTest, samples: target.samples }; }); },
    // Whole frames as the game draws them (each live mirror's pass, then the
    // main render), waited for with a one-pixel read back, in milliseconds: a
    // rough cost that a 60 Hz display cap does not hide. Also the time spent
    // issuing each part and its draw calls.
    timeRenders(count = 10) {
      if (!renderer || !lastCamera) return null;
      const gl = renderer.getContext(), pixel = new Uint8Array(4), result = { total: [], passIssue: [], mainIssue: [], passCalls: 0, mainCalls: 0, passTriangles: 0, mainTriangles: 0 };
      for (let index = 0; index < count; index++) {
        const start = performance.now();
        for (const reflector of pool) if (reflector.visible) pass(reflector, renderer, lastCamera);
        const issued = performance.now(); result.passCalls = renderer.info.render.calls; result.passTriangles = renderer.info.render.triangles; result.culled = culled;
        renderer.render(scene, lastCamera); const main = performance.now(); result.mainCalls = renderer.info.render.calls; result.mainTriangles = renderer.info.render.triangles;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        result.total.push(performance.now() - start); result.passIssue.push(issued - start); result.mainIssue.push(main - issued);
      }
      return result;
    },
  });
  return api;
}

function installProbe(api, extra) {
  let enabled = false;
  try { enabled = globalThis.localStorage?.getItem(MIRROR_PROBE_KEY) === '1'; } catch {}
  if (!enabled) return;
  globalThis.__funfairMirrors = { api, MIRROR_LAYER, get stats() { return api.stats; }, ...extra };
}
