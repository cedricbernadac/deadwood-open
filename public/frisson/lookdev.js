// Frisson heads lookdev (art/frisson/DESIGN.md, "Choosing"): real
// zombies from createZombie, in the real cabin world under its night lights,
// with the Famille or the Frisson heads and the proposals side by side. The
// current pack ("Actuel") wears heads.glb and bodies.glb, as in a Frisson
// room; a proposal shows its heads alone. No room, no server state, no
// audio. Served at /frisson/lookdev.html by any game server; use a scratch
// port, never the owner's game.
//   ?source=heads.glb|proposals/rodeurs.glb|…  ?heads=famille|frisson
//   ?markers=none|a|b  ?mood=famille|frisson  ?view=variants|families|specials  ?time=2.4 (frozen)
import * as THREE from '/vendor/three.module.js';
import { createWorld, animateZombie, createRaider, animateRaider } from '../world.js';
import { createGraphics } from '../graphics.js';
import { setZombieStyle } from '../zombies.js';
import { install as installHeads } from './heads.js';
import { install as installBodies } from './bodies.js';
import { install as installMarkers } from './markers.js';
import { createLineup } from './lookdev-lineup.js';
// The night mood belongs to the atmosphere part; a broken one must not take
// the heads down with it.
const atmosphere = await import('./atmosphere.js').catch(error => ({ install: async () => { throw error; } }));

const BASE = '/frisson/';
const SOURCES = [
  { file: 'heads.glb', label: 'Actuel (heads.glb + bodies.glb)', bodies: 'bodies.glb' },
  { file: 'proposals/rodeurs.glb', label: 'Rôdeurs A' },
  { file: 'proposals/rodeurs-b.glb', label: 'Rôdeurs B' },
  { file: 'proposals/enrages.glb', label: 'Enragés A' },
  { file: 'proposals/enrages-b.glb', label: 'Enragés B' },
  { file: 'proposals/revenants.glb', label: 'Revenants A' },
  { file: 'proposals/revenants-b.glb', label: 'Revenants B' },
];
// The markers proposals (art/frisson/MARKERS.md): none keeps the cast Famille
// marks of marks.js; A is the provisional default.
const MARKERS = [
  { id: 'none', label: 'Aucun' },
  { id: 'a', file: 'markers.glb', label: 'Marques A' },
  { id: 'b', file: 'proposals/marks-b.glb', label: 'Marques B' },
];
const params = new URLSearchParams(location.search);
const container = document.getElementById('view'), statusLine = document.getElementById('status');

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .06, 130);
const pipeline = createGraphics({ canvas: document.createElement('canvas'), scene, camera, choice: params.get('quality') || 'high', storage: null });
const renderer = pipeline.renderer;
container.prepend(renderer.domElement);
scene.add(camera);
const world = createWorld(scene, { quality: pipeline.preset });
const worldContext = { camera, active: false, snapshot: { wave: 1 } };
const hooks = { impact: null, death: null, frame: null, hurt: null };
const context = () => ({ THREE, world, scene, renderer, camera, sound: null, hooks, quality: pipeline.preset.id, base: BASE, document });

// --- Heads: Famille or a GLB source ------------------------------------------
// The lineup swaps them: the new heads load while the old ones still draw.
class MissingSource extends Error {}
const state = { heads: params.get('heads') === 'famille' ? 'famille' : 'frisson', source: SOURCES.some(entry => entry.file === params.get('source')) ? params.get('source') : SOURCES[0].file,
  markers: MARKERS.some(entry => entry.id === params.get('markers')) ? params.get('markers') : 'a', mood: params.get('mood') === 'famille' ? 'famille' : 'frisson' };
const lineup = createLineup({ scene, camera, raider: createRaider({ weapon: 'assault', maxHp: 175 }) });
let report = '', failed = false;
const fetchFrom = file => async () => {
  const response = await fetch(BASE + file, { cache: 'no-store' });
  if (response.status === 404) throw new MissingSource(`${file} est absent. Copie la proposition dans public/frisson/${file} (elle vient de art/frisson/proposals/), puis recharge.`);
  if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
  return response.arrayBuffer();
};
// The heads of a source, and the bodies on them for the current pack. A
// missing or broken bodies.glb leaves the heads on their storybook bodies.
async function loadSource({ file, bodies = null }) {
  const heads = await installHeads({ ...context(), fetchAsset: fetchFrom(file) });
  if (!bodies) return heads;
  let body;
  try { body = await installBodies({ ...context(), fetchAsset: fetchFrom(bodies) }); } catch (error) { heads.uninstall(); throw error; }
  return { ...heads, body, uninstall() { body.uninstall(); heads.uninstall(); } };
}
// The markers get their own hook slots, fanned to in frame(): the page's
// hooks object is the atmosphere's, and both parts write hooks.frame (the
// game's index.js fans out per part for the same reason).
const markerHooks = { impact: null, death: null, frame: null, hurt: null };
let markersHandle = null, markersNote = '';
async function applyHeads() {
  const source = SOURCES.find(entry => entry.file === state.source), file = source.file;
  const chosen = MARKERS.find(entry => entry.id === state.markers);
  failed = false;
  markersHandle?.uninstall(); markersHandle = null;
  for (const name of Object.keys(markerHooks)) markerHooks[name] = null;
  try {
    const handle = await lineup.swapHeads(async () => {
      let headsHandle = null;
      if (state.heads === 'frisson') headsHandle = await loadSource(source);
      // Famille heads: the markers must not compose onto the outgoing heads
      // style — its uninstall clears any chain it sits in.
      else setZombieStyle(null);
      if (!chosen.file) markersNote = 'Marques Famille (procédurales), comme dans le jeu des enfants.';
      else {
        markersHandle = await installMarkers({ ...context(), hooks: markerHooks, fetchAsset: fetchFrom(chosen.file) });
        if (markersHandle.style) markersNote = `${chosen.label} (${chosen.file}) : ${markersHandle.markers.families.size} familles marquées.`;
        else {
          failed = true;
          markersNote = markersHandle.error instanceof MissingSource ? markersHandle.error.message : `${chosen.file} refusé : ${markersHandle.error.message}\nLes marques Famille restent affichées.`;
        }
      }
      return headsHandle;
    });
    if (handle) {
      const { variants, boss } = handle.heads;
      const triangles = head => [head.skin, head.detail, head.eyes].reduce((sum, geometry) => sum + geometry.index.count / 3, 0);
      const sets = handle.body?.bodies?.sets.map(set => set.name).filter(Boolean) ?? [];
      const bodies = !source.bodies ? '' : handle.body?.bodies ? `\n${source.bodies} : ${handle.body.bodies.roots.length} parties de corps${sets.length ? `, ensembles ${sets.join(', ')} (un ensemble entier par zombie)` : ''}`
        : `\n${source.bodies} : corps Famille (${handle.body?.error?.message ?? 'absent'})`;
      report = `${file} : ${variants.length} têtes${boss ? ' + boss' : ' (le boss prend une tête ordinaire)'}${bodies}\n`
        + variants.map((head, index) => `${index + 1}. ${head.name} · ${triangles(head)} tri.`).join('\n') + (boss ? `\nBoss · ${triangles(boss)} tri.` : '');
    } else report = 'Têtes Famille (procédurales), comme dans le jeu des enfants.';
  } catch (error) {
    failed = true;
    markersNote = '';
    report = error instanceof MissingSource ? error.message : `${file} refusé : ${error.message}\nLes têtes Famille restent affichées.`;
  }
  refreshLabels(); viewButtons(); showStatus(); syncButtons();
}

// --- Night mood: the atmosphere part's own install, as in a Frisson room ----
let moodHandle = null, moodNote = '';
async function applyMood() {
  try { moodHandle?.uninstall?.(); } catch {}
  moodHandle = null; world.setMood?.(null);
  for (const name of Object.keys(hooks)) hooks[name] = null;
  if (state.mood === 'frisson') {
    try {
      moodHandle = await atmosphere.install({ ...context(), fetchAsset: async path => {
        const response = await fetch(BASE + path);
        if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
        return response.arrayBuffer();
      } });
      moodNote = typeof world.setMood === 'function' ? 'Ambiance Frisson (atmosphere.js).' : 'Ambiance Frisson demandée, mais world.setMood n’existe pas encore : nuit Famille.';
    } catch (error) { moodNote = `atmosphere.js a échoué : ${error.message}`; }
  } else moodNote = 'Ambiance Famille.';
  showStatus();
}
function showStatus() {
  statusLine.textContent = `${report}\n${markersNote ? markersNote + '\n' : ''}${moodNote}`;
  statusLine.classList.toggle('error', failed);
}

// --- Labels: one per actor of the lineup, shown for the row on show -----------
const labels = document.getElementById('labels'), labelOf = new Map();
function refreshLabels() {
  for (const [actor, label] of labelOf) if (!lineup.actors.includes(actor)) { label.remove(); labelOf.delete(actor); }
  for (const actor of lineup.actors) if (!labelOf.has(actor)) {
    const label = document.createElement('span'); label.textContent = actor.text; labels.append(label); labelOf.set(actor, label);
  }
}

// --- Orbit camera: drag to turn, wheel to come closer, click to focus ---------
// The lineup shows one row at a time and frames it.
function setView(id) { lineup.setView(id); syncButtons(); }
const orbit = lineup.orbit;
function pick(event) {
  const bounds = canvas.getBoundingClientRect();
  const actor = lineup.pick((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  if (actor) lineup.frame(actor);
}
const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, moved: 0 }; canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  orbit.yaw -= dx * .006;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * .004, -.25, 1.2);
  drag = { x: event.clientX, y: event.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) };
});
const release = event => { if (drag && drag.moved < 4 && event.type === 'pointerup') pick(event); drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', event => { event.preventDefault(); orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(event.deltaY * .001), 1.1, 18); }, { passive: false });

// --- Buttons ----------------------------------------------------------------------
let buttons = [];
function button(group, label, isActive, onClick) {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
  element.addEventListener('click', onClick); document.getElementById(group).append(element);
  buttons.push({ element, isActive, group });
}
// One button per view the lineup offers: the pages of variants change with the heads.
function viewButtons() {
  for (const { element } of buttons.filter(entry => entry.group === 'views')) element.remove();
  buttons = buttons.filter(entry => entry.group !== 'views');
  for (const [id, label] of lineup.views) button('views', label, () => lineup.view === id, () => setView(id));
}
function syncButtons() {
  for (const { element, isActive, group } of buttons) {
    element.classList.toggle('active', isActive()); element.setAttribute('aria-pressed', String(isActive()));
    if (group === 'sources') element.disabled = state.heads !== 'frisson';
  }
}
let busy = Promise.resolve();
const queue = task => { busy = busy.then(task).catch(error => { report = String(error?.message ?? error); failed = true; showStatus(); }); return busy; };
button('heads', 'Famille', () => state.heads === 'famille', () => queue(async () => { state.heads = 'famille'; await applyHeads(); }));
button('heads', 'Frisson', () => state.heads === 'frisson', () => queue(async () => { state.heads = 'frisson'; await applyHeads(); }));
for (const { file, label } of SOURCES) button('sources', label, () => state.source === file, () => queue(async () => { state.source = file; await applyHeads(); }));
for (const { id, label } of MARKERS) button('markers', label, () => state.markers === id, () => queue(async () => { state.markers = id; await applyHeads(); }));
button('moods', 'Famille', () => state.mood === 'famille', () => queue(async () => { state.mood = 'famille'; await applyMood(); syncButtons(); }));
button('moods', 'Frisson', () => state.mood === 'frisson', () => queue(async () => { state.mood = 'frisson'; await applyMood(); syncButtons(); }));
const frozen = params.has('time') ? Number(params.get('time')) : null;
let paused = frozen !== null;
button('motion', 'Pause', () => paused, () => { paused = !paused; syncButtons(); });

// --- Frames -------------------------------------------------------------------------
function resize() {
  const width = container.clientWidth, height = container.clientHeight;
  camera.aspect = width / height; camera.updateProjectionMatrix(); pipeline.resize(width, height);
}
const stats = document.getElementById('stats'), samples = [];
let last = performance.now(), clock = frozen ?? 0;
function pose(time, delta) {
  for (const { model, kind } of lineup.actors) {
    if (kind === 'raider') animateRaider(model, { pitch: -.04, time, delta });
    else animateZombie(model, time, false, delta);
  }
}
function drawLabels() {
  const width = container.clientWidth, height = container.clientHeight, shown = new Set();
  for (const { actor, x, y } of lineup.anchors()) {
    const label = labelOf.get(actor); if (!label) continue;
    shown.add(label); label.style.display = ''; label.style.left = `${(x + 1) / 2 * width}px`; label.style.top = `${(1 - y) / 2 * height}px`;
  }
  for (const label of labelOf.values()) if (!shown.has(label)) label.style.display = 'none';
}
function frame(now) {
  const delta = Math.min(.1, (now - last) / 1000); last = now;
  if (!paused) { clock += delta; pose(clock, delta); }
  world.update(clock, worldContext);
  const frameEvent = { delta, time: clock, self: null, snapshot: null };
  try { hooks.frame?.(frameEvent); markerHooks.frame?.(frameEvent); } catch {}
  lineup.placeCamera();
  pipeline.render(delta);
  drawLabels();
  samples.push(delta); if (samples.length > 90) samples.shift();
  const info = renderer.info, fps = samples.length / samples.reduce((sum, value) => sum + value, 0);
  stats.textContent = `${fps.toFixed(0)} i/s · ${info.render.calls} appels · ${(info.render.triangles / 1000).toFixed(1)} k triangles · ${info.programs?.length ?? '?'} shaders`;
  requestAnimationFrame(frame);
}

addEventListener('resize', resize); resize();
await queue(async () => { await applyHeads(); await applyMood(); });
setView(params.get('view'));
world.prewarm(renderer, camera);
if (frozen !== null) for (let tick = 0; tick <= 60; tick++) pose(frozen - 1 + tick / 60, 1 / 60);
requestAnimationFrame(frame);
// For browser checks: switch without clicking, read what is shown.
window.__frissonLookdev = {
  setHeads: value => queue(async () => { state.heads = value === 'famille' ? 'famille' : 'frisson'; await applyHeads(); }),
  setSource: file => queue(async () => { state.source = file; await applyHeads(); }),
  setMarkers: value => queue(async () => { state.markers = MARKERS.some(entry => entry.id === value) ? value : 'a'; await applyHeads(); }),
  setMood: value => queue(async () => { state.mood = value === 'famille' ? 'famille' : 'frisson'; await applyMood(); syncButtons(); }),
  setView, orbit, state, actors: lineup.actors, lineup, world, renderer, scene, camera,
  status: () => statusLine.textContent,
};
