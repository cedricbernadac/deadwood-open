// The lookdev lineup (lookdev.html): real zombies from createZombie in rows
// in front of the cabin's north facade, under its door lamp. Only the row on
// show is drawn and pickable, so no zombie of another row ever stands between
// the camera and the heads being judged. More heads than a row holds take
// pages (variants, variants2 …) on the variants row. Also the orbit camera,
// the label anchors and the swap between head sets. No DOM and no renderer:
// Node tests drive it.
import * as THREE from '/vendor/three.module.js';
import { createZombie, setZombieHealth, disposeZombie } from '../zombies.js';
import { enemyAppearance } from '../enemies.js';
import { headVariant } from './heads.js';

export const ROWS = Object.freeze({ variants: -9.5, families: -11.6, specials: -13.7 });
export const VIEWS = Object.freeze({ variants: 'Variantes', families: 'Familles', specials: 'Spéciaux' });
const SPACING = 1.25;
// Heads to a page of variants: a whole page stays in the frame at the
// orbit's longest distance (14 m).
export const PER_PAGE = 8;
const pageId = page => (page ? `variants${page + 1}` : 'variants');
const rowZ = row => ROWS[row] ?? ROWS.variants;
// Every family colour on one head (the toughness cue), then the special kinds.
const FAMILIES = [['walker', 80], ['walker', 115], ['walker', 165], ['walker', 230], ['walker', 310], ['walker', 400], ['brute', 700], ['brute', 1000], ['brute', 1400]];
const SPECIALS = [['crawler', false, 80, 'z7'], ['crawler', false, 400, 'z12'], ['armored', false, 230, 'z3'], ['runner', false, 165, 'z4'], ['brute', true, 6000, 'z1']];

// The first server id from `from` on that wears variant `index` of `count`.
export function idFor(index, count, from = 0) {
  for (let serial = from; serial < from + 10000; serial++) if (headVariant(`z${serial}`, count) === index) return `z${serial}`;
  return `z${from}`;
}
const headName = model => model.userData.head?.children[0]?.userData.headVariant;
const contains = (model, object) => { while (object && object !== model) object = object.parent; return object === model; };

// raider: an already built raider (it never changes with the heads, so it
// is placed again on every build instead of being rebuilt).
export function createLineup({ scene, camera, raider = null }) {
  const actors = [];
  const orbit = { yaw: 0, pitch: .12, distance: 6, target: new THREE.Vector3(0, 1.35, ROWS.variants) };
  let view = 'variants', heads = null;

  function place(model, row, slot, slots, text, kind = 'zombie') {
    model.position.set((slot - (slots - 1) / 2) * SPACING, 0, rowZ(row));
    model.visible = row === view;
    scene.add(model);
    actors.push({ model, kind, text, row });
  }
  function clear() {
    for (const actor of actors.splice(0)) { scene.remove(actor.model); if (actor.kind === 'zombie') disposeZombie(actor.model); }
  }
  function build() {
    const variants = heads?.heads.variants ?? [], count = Math.max(1, variants.length);
    // 1) Each variant, on the same mid family (six storybook heads in
    // Famille), PER_PAGE to a page.
    const shown = variants.length || 6;
    for (let index = 0; index < shown; index++) {
      const id = variants.length ? idFor(index, count) : `z${index}`, page = Math.floor(index / PER_PAGE);
      const model = createZombie('walker', false, 165, id); setZombieHealth(model, 165, 165);
      place(model, pageId(page), index % PER_PAGE, Math.min(PER_PAGE, shown - page * PER_PAGE), headName(model) ?? `Famille ${id}`);
    }
    // 2) Every family colour on the first head.
    const sameHead = variants.length ? idFor(0, count, 500) : 'z500';
    FAMILIES.forEach(([kind, hp], index) => {
      const model = createZombie(kind, false, hp, sameHead); setZombieHealth(model, hp, hp);
      place(model, 'families', index, FAMILIES.length, `${enemyAppearance({ kind, maxHp: hp }).label.fr} · ${hp} PV`);
    });
    // 3) Crawlers, an armoured walker, a runner, the boss, a raider.
    const slots = SPECIALS.length + (raider ? 1 : 0);
    SPECIALS.forEach(([kind, boss, hp, id], index) => {
      const model = createZombie(kind, boss, hp, id); setZombieHealth(model, hp, hp);
      place(model, 'specials', index, slots, `${boss ? 'Boss' : kind === 'crawler' ? 'Rampant' : kind === 'armored' ? 'Blindé' : 'Coureur'}${headName(model) ? ` · ${headName(model)}` : ''}`);
    });
    if (raider) place(raider, 'specials', SPECIALS.length, slots, 'Pillard (tête humaine)', 'raider');
  }

  // The next heads load while the current ones keep drawing; only then does
  // the old lineup go, the old heads free their buffers and the new lineup
  // get built. Freeing first would let the frames drawn during the load
  // upload the freed buffers again, and nothing would free them twice.
  // load: async () => heads handle, or null for the Famille heads. A failed
  // load leaves the Famille heads and rethrows.
  async function swapHeads(load = null) {
    let next = null, failure = null;
    try { next = load ? await load() : null; } catch (error) { failure = error; }
    clear();
    const previous = heads; heads = next;
    previous?.uninstall();
    build();
    // A page the new heads do not fill any more: back to the first.
    if (!views().some(([id]) => id === view)) setView('variants');
    if (failure) throw failure;
    return next;
  }

  // The views on offer, in order, as [id, label]: the pages of variants
  // (one page: "Variantes"; more: "Variantes 1–8", "Variantes 9–16" …),
  // then the families and the special kinds.
  function views() {
    const pages = [...new Set(actors.filter(actor => actor.row.startsWith('variants')).map(actor => actor.row))];
    const label = (id, page) => {
      if (pages.length < 2) return VIEWS.variants;
      const first = page * PER_PAGE + 1, last = first + actors.filter(actor => actor.row === id).length - 1;
      return `${VIEWS.variants} ${first}–${last}`;
    };
    return [...pages.map((id, page) => [id, label(id, page)]), ['families', VIEWS.families], ['specials', VIEWS.specials]];
  }

  // A whole row in the frame; a click on a zombie then brings its head close.
  function setView(id) {
    view = views().some(([key]) => key === id) ? id : 'variants';
    for (const actor of actors) actor.model.visible = actor.row === view;
    const slots = Math.max(1, actors.filter(actor => actor.row === view).length), width = slots * SPACING + .8;
    orbit.target.set(0, view === 'specials' ? 1.1 : 1.35, rowZ(view)); orbit.yaw = 0; orbit.pitch = .12;
    orbit.distance = THREE.MathUtils.clamp(width / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(.5, camera.aspect)), 3, 14);
  }
  function placeCamera() {
    const flat = Math.cos(orbit.pitch) * orbit.distance;
    camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * flat, orbit.target.y + Math.sin(orbit.pitch) * orbit.distance, orbit.target.z - Math.cos(orbit.yaw) * flat);
    camera.lookAt(orbit.target);
  }
  // The actor under a point in normalized device coordinates. three's
  // raycaster ignores visibility: hidden rows are left out here.
  const picker = new THREE.Raycaster(), pointer = new THREE.Vector2(), focus = new THREE.Vector3();
  function pick(x, y) {
    const shown = actors.filter(actor => actor.model.visible);
    picker.setFromCamera(pointer.set(x, y), camera);
    const hit = picker.intersectObjects(shown.map(actor => actor.model), true)[0];
    return hit ? shown.find(actor => contains(actor.model, hit.object)) ?? null : null;
  }
  function frame(actor) {
    (actor.model.userData.head ?? actor.model).getWorldPosition(focus);
    orbit.target.copy(focus); orbit.distance = actor.model.userData.boss ? 2.4 : 1.5; orbit.pitch = .05;
  }
  // Where the labels of the row on show go, in normalized device coordinates
  // (above each head; actors off screen are left out).
  const point = new THREE.Vector3();
  function anchors() {
    const list = [];
    for (const actor of actors) {
      if (!actor.model.visible) continue;
      const data = actor.model.userData;
      point.setFromMatrixPosition(actor.model.matrixWorld); point.y += data.kind === 'crawler' ? 1.05 : data.boss ? 2.85 : data.kind === 'brute' ? 2.55 : 2.15;
      point.project(camera);
      if (point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1) list.push({ actor, x: point.x, y: point.y });
    }
    return list;
  }
  function dispose() { clear(); heads?.uninstall(); heads = null; }

  return { actors, orbit, get view() { return view; }, get views() { return views(); }, get heads() { return heads; }, swapHeads, setView, placeCamera, pick, frame, anchors, dispose };
}
