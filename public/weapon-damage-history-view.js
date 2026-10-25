import { getLanguage, setLanguage, weaponLabel } from './i18n.js';
import { baselineSample, currentSample, historyCurve, historyMeanDamage } from './weapon-damage-history.js';
import { BASELINE_GRENADE, GRENADE_BASELINE_PROVENANCE } from './weapon-area-before.js';

const ORDER = ['assault', 'minigun', 'sniper', 'rifle', 'smg', 'pistol', 'shotgun', 'magnum', 'rocket', 'grenade', 'flamethrower', 'bat', 'fireaxe', 'katana', 'hammer'];
const COPY = {
  back: ['Comparatif complet ↗', 'Full comparison ↗'], language: ['Langue', 'Language'],
  eyebrow: ['LES DÉGÂTS, ARME PAR ARME', 'DAMAGE, WEAPON BY WEAPON'], title: ['Avant / maintenant.', 'Before / now.'],
  intro: ['L’ancien Refuge face aux nouveaux réglages. Deux courbes par arme, pour voir ce qui change avec la distance.', 'The original Shelter versus the new tuning. Two curves per weapon show what changes with distance.'],
  play: ['Essayer au stand ↗', 'Try at the range ↗'], beforeLegend: ['Avant · version habituelle', 'Before · original version'], currentLegend: ['Maintenant · nouveaux réglages', 'Now · new tuning'],
  zoom: ['Distance affichée · armes à balles', 'Displayed distance · bullet weapons'], near: ['Proximité · 0–20 m', 'Close range · 0–20 m'], calibrationRange: ['Raccord · 0–30 m', 'Calibration · 0–30 m'], full: ['Toutes les portées · 0–650 m', 'All ranges · 0–650 m'],
  readDistance: ['Lire les dégâts à', 'Read damage at'], shotgun: ['Fusil à pompe', 'Shotgun'], pellet: ['Par plomb', 'Per pellet'], shell: ['Total théorique des 9 plombs', 'Theoretical total of all 9 pellets'],
  melee: ['Armes de mêlée', 'Melee weapons'], light: ['Coup rapide', 'Quick attack'], heavy: ['Coup puissant', 'Heavy attack'],
  help: ['Dégâts au corps, sans armure ni bonus, sur la première cible. Chaque graphique possède sa propre échelle verticale. Clique ou déplace le pointeur sur une courbe pour lire une distance.', 'Body damage without armor or upgrades, against the first target. Each chart has its own vertical scale. Click or move the pointer over a curve to inspect a distance.'],
  meanHelp: ['Deux repères fixes : égaler les dégâts à 10 m ne garantit pas la même moyenne de 0 à 30 m. La moyenne continue donne le même poids à chaque mètre ; les distances hors portée comptent pour zéro. Ce n’est pas une moyenne de tirs en partie. Les écarts restent affichés, même quand tu déplaces le curseur.', 'Two fixed references: matching damage at 10 m does not guarantee the same 0–30 m average. The continuous mean gives each meter equal weight; unreachable distances count as zero. This is not an average of shots during gameplay. Differences stay visible as you move the cursor.'],
  limits: ['Les nouveaux tirs sont représentés en vol libre : le sol et les obstacles peuvent les arrêter avant. Un cercle marque la fin du vol simulé, sans inventer une chute des dégâts à zéro. Les anciennes coupures nettes de portée sont conservées sur les courbes « Avant ».', 'New bullets are shown in free flight: terrain and obstacles can stop them earlier. A circle marks the simulation endpoint, without inventing a drop to zero damage. Original hard range cutoffs remain visible on the Before curves.'],
  transport: ['Dans le Refuge comme au stand, les balles volent à vitesse finie avec ralentissement et chute. Les dégâts et les réactions arrivent au contact, sur la trajectoire réellement parcourue.', 'In both the Shelter and range, bullets travel at finite speed with drag and drop. Damage and reactions occur at contact along the actual flight path.'],
  retry: ['Réessayer', 'Retry']
};
const $ = id => document.getElementById(id);
const local = (fr, en) => getLanguage() === 'fr' ? fr : en;
const labelFor = id => id === 'grenade' ? 'Grenade' : weaponLabel(id);
const fmt = (value, digits = 1) => new Intl.NumberFormat(getLanguage() === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits }).format(value);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const svgNode = (tag, attrs = {}, text) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); if (text !== undefined) el.textContent = text; return el; };
let baseline, weapons, cards = [], target = 'boss', flameMode = 'direct', version = 0;
const specialDistances = { rocket: 2.5, grenade: 2.5, flamethrower: 5.5, bat: 1, fireaxe: 1, katana: 1, hammer: 1 };

function options() { return { target, targetHp: 400, shotgunUnit: $('history-shotgun-unit').value, attack: $('history-melee').value, flameMode }; }
function bullet(id) { return !!weapons[id].bulletPhysics; }
function domain(id) {
  if (bullet(id)) return Number($('history-range').value);
  if (weapons[id].explosive) return 5;
  if (weapons[id].fuel) return 7;
  return 3;
}
function distance(id) { return bullet(id) ? Number($('history-distance').value) : specialDistances[id]; }
function axis(id) { return weapons[id].explosive ? local('Distance au foyer de l’explosion (m)', 'Distance from blast center (m)') : local('Distance de la cible (m)', 'Target distance (m)'); }
function unit(id) { return weapons[id].fuel ? local('PV/s', 'HP/s') : local('PV', 'HP'); }
function metric(id) {
  if (weapons[id].fuel) return flameMode === 'burn' ? local('Brûlure créée · PV/s', 'New burn · HP/s')
    : flameMode === 'total' ? local('Jet + brûlure · PV/s', 'Direct + burn · HP/s') : local('Jet direct · PV/s', 'Direct flame · HP/s');
  if (id === 'magnum' && target === 'ordinary') return local('PV retirés · infecté à 400 PV', 'HP removed · 400 HP infected');
  return local('Dégâts au corps (PV)', 'Body damage (HP)');
}
function note(id) {
  if (id === 'magnum') return target === 'boss'
    ? local('Contre un boss : avant, 1 000 PV par tir à portée. Les infectés ordinaires étaient éliminés automatiquement ; passe sur « Infecté à 400 PV » pour comparer ce cas.', 'Against a boss: originally 1,000 HP per shot within range. Ordinary infected were killed instantly; choose “400 HP infected” to compare that case.')
    : local('Cible ordinaire à 400 PV, sans armure : les deux courbes plafonnent aux PV retirés. Avant, élimination automatique à portée ; maintenant, dégâts décroissants avec la distance.', 'An ordinary 400 HP unarmored target: both curves are capped at HP actually removed. Originally an instant kill within range; now damage decreases with distance.');
  if (id === 'shotgun') return $('history-shotgun-unit').value === 'shell'
    ? local('Somme théorique si les neuf plombs touchent. La dispersion réduit le nombre de plombs reçus en partie. L’ancien bonus de proximité est inclus.', 'Theoretical total if all nine pellets hit. Spread reduces actual pellet hits. The original close-range boost is included.')
    : local('Dégâts d’un seul plomb ; neuf plombs sont tirés par cartouche. L’ancien bonus de proximité est inclus.', 'Damage from one pellet; nine pellets are fired per shell. The original close-range boost is included.');
  if (weapons[id].explosive) return local('Distance depuis l’explosion. Même pleine puissance jusqu’à 2 m ; avant, décroissance linéaire, maintenant, raccord lisse jusqu’à zéro à 4 m. Sans obstacle ni armure.', 'Distance from the explosion. Same full power through 2 m; originally linear decay, now a smooth transition to zero at 4 m. No obstruction or armor.');
  if (weapons[id].fuel) return local('Cible initialement éteinte, sans armure. Pleine puissance conservée jusqu’à 5 m, puis baisse lisse du jet et de la brûlure créée jusqu’à zéro à 6 m. Une brûlure dure 4 s après son contact, sans cumul ; une exposition antérieure plus forte peut encore agir après un déplacement. « Jet + brûlure » est un débit simultané, pas le total sur 4 s.', 'Initially unlit, unarmored target. Full power preserved through 5 m, then smooth direct and newly applied burn falloff to zero at 6 m. A burn lasts 4 s after its contact without stacking; an earlier stronger exposure can still act after moving. “Direct + burn” is simultaneous DPS, not the total over 4 s.');
  if (weapons[id].melee) return local('Dégâts du coup choisi sur la première cible. Le coup rapide et le coup puissant ont chacun leur portée. Réglage inchangé.', 'Selected attack damage against the first target. Quick and heavy attacks have separate reaches. Tuning is unchanged.');
  return weapons[id].damageCurve?.kind === 'rational'
    ? local('Avant : ancienne atténuation et coupure de portée. Maintenant : courbe de dégâts souple, calibrée à 10 m et sur la moyenne 0–30 m. Vitesse et chute restent celles du modèle de vol.', 'Before: original falloff and hard range limit. Now: a smooth damage curve calibrated at 10 m and over the 0–30 m average. Speed and drop retain the flight model.')
    : local('Avant : ancienne atténuation et coupure de portée. Maintenant : décroissance exponentielle, avec puissance de départ calibrée. Dégâts avant tête, armure et traversée.', 'Before: original falloff and hard range limit. Now: exponential decay with tuned initial damage. Values are before headshots, armor and penetration.');
}

function samplePair(id, d) { return [baselineSample(baseline.weapons[id], d, options()), currentSample(weapons[id], d, options())]; }
function renderCalibration(card) {
  if (!card.calibration) return;
  const opts = options(), [atBefore, atCurrent] = samplePair(card.id, 10);
  const values = [
    [atBefore.damage, atCurrent.damage],
    [historyMeanDamage(baseline.weapons[card.id], { ...opts, version: 'before' }), historyMeanDamage(weapons[card.id], opts)],
  ];
  card.calibration.forEach((fields, index) => {
    const [before, current] = values[index], delta = current - before;
    fields[0].textContent = `${fmt(before, 2)} ${unit(card.id)}`;
    fields[1].textContent = `${fmt(current, 2)} ${unit(card.id)}`;
    fields[2].textContent = Math.abs(delta) <= 1e-7 * Math.max(1, before)
      ? local('Identique', 'Unchanged')
      : before > 0 ? `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta / before) * 100, 2)} %`
      : `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta), 2)} ${unit(card.id)}`;
  });
}
function renderReadout(card) {
  const d = distance(card.id), [before, current] = samplePair(card.id, d), suffix = unit(card.id);
  card.at.textContent = `${fmt(d)} m`;
  card.before.textContent = bullet(card.id) && !before.reachable ? local('Hors portée', 'Out of range') : `${fmt(before.damage)} ${suffix}`;
  card.current.textContent = bullet(card.id) && !current.reachable ? local('Vol terminé', 'Flight ended') : `${fmt(current.damage)} ${suffix}`;
  card.before.classList.toggle('history-ended', bullet(card.id) && !before.reachable);
  card.current.classList.toggle('history-ended', bullet(card.id) && !current.reachable);
  const delta = current.damage - before.damage;
  card.delta.textContent = bullet(card.id) && (!before.reachable || !current.reachable)
    ? !before.reachable && !current.reachable ? '—' : current.reachable ? local('Portée gagnée', 'Range gained') : local('Vol terminé', 'Flight ended')
    : Math.abs(delta) < .00001 ? local('Identique', 'Unchanged') : before.damage > 0
    ? `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))} ${suffix} (${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta / before.damage) * 100)} %)`
    : local('Hors portée avant', 'Out of range before');
  card.graph.setAttribute('aria-label', `${labelFor(card.id)} — ${fmt(d)} m : ${local('avant', 'before')} ${card.before.textContent}, ${local('maintenant', 'now')} ${card.current.textContent}. ${metric(card.id)}.`);
  if (card.cursor) { const x = 48 + Math.min(d, domain(card.id)) / domain(card.id) * 430; card.cursor.setAttribute('x1', x); card.cursor.setAttribute('x2', x); }
  if (card.localSlider) card.localSlider.value = d;
}

function renderChart(card) {
  const id = card.id, max = domain(id), opts = { ...options(), maxDistance: max, samples: 240 };
  const before = historyCurve(baseline.weapons[id], { ...opts, version: 'before' });
  const current = historyCurve(weapons[id], { ...opts, version: 'current' });
  const rawMax = Math.max(1, ...before.map(p => p.damage), ...current.map(p => p.damage));
  const magnitude = 10 ** Math.floor(Math.log10(rawMax)), yMax = Math.ceil(rawMax / magnitude * 2) * magnitude / 2;
  const x = d => 48 + d / max * 430, y = damage => 187 - damage / yMax * 150;
  const svg = svgNode('svg', { viewBox: '0 0 500 239', 'aria-hidden': 'true' });
  svg.append(svgNode('text', { x: 48, y: 17, class: 'history-axis-title' }, metric(id)));
  for (let tick = 0; tick <= 2; tick++) {
    const value = yMax * tick / 2;
    svg.append(svgNode('line', { x1: 48, x2: 478, y1: y(value), y2: y(value), class: 'chart-grid' }), svgNode('text', { x: 40, y: y(value) + 4, 'text-anchor': 'end' }, fmt(value, value < 10 ? 1 : 0)));
  }
  for (let tick = 0; tick <= 4; tick++) {
    const value = max * tick / 4;
    svg.append(svgNode('text', { x: x(value), y: 207, 'text-anchor': tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle' }, fmt(value)));
  }
  svg.append(svgNode('text', { x: 263, y: 232, 'text-anchor': 'middle', class: 'history-axis-title' }, axis(id)));
  if (bullet(id) && max >= 10) {
    svg.append(svgNode('line', { x1: x(10), x2: x(10), y1: 30, y2: 187, class: 'history-reference' }),
      svgNode('text', { x: x(10) + 5, y: 30, class: 'history-reference-label' }, '10 m'));
  }
  const path = points => points.map((p, index) => `${index ? 'L' : 'M'}${x(p.distance).toFixed(3)},${y(p.damage).toFixed(3)}`).join(' ');
  svg.append(svgNode('path', { d: path(current), class: 'history-current' }), svgNode('path', { d: path(before), class: 'history-before' }));
  if (bullet(id)) {
    const last = current.at(-1), end = currentSample(weapons[id], 0, options()).endDistance;
    if (last && end <= max) svg.append(svgNode('circle', { cx: x(last.distance), cy: y(last.damage), r: 3.4, class: 'history-end' }));
  }
  card.cursor = svgNode('line', { x1: 48, x2: 48, y1: 30, y2: 187, class: 'history-cursor' }); svg.append(card.cursor);
  const readPointer = event => {
    const bounds = svg.getBoundingClientRect(), inSvg = (event.clientX - bounds.left) / bounds.width * 500;
    const d = Math.round(Math.max(0, Math.min(max, (inSvg - 48) / 430 * max)) * (bullet(id) ? 1 : 10)) / (bullet(id) ? 1 : 10);
    if (bullet(id)) { $('history-distance').value = d; renderDistances(); }
    else { specialDistances[id] = d; renderReadout(card); }
  };
  svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || event.buttons) readPointer(event); });
  svg.addEventListener('click', readPointer);
  card.graph.replaceChildren(svg);
  card.note.textContent = note(id);
  renderCalibration(card);
  renderReadout(card);
}

function renderDistances() {
  $('history-distance-output').textContent = `${fmt(Number($('history-distance').value))} m`;
  for (const card of cards) renderReadout(card);
}

function createCard(id, index) {
  const article = node('article', undefined, 'history-card'); article.id = `history-${id}`;
  const header = node('header'), title = node('div'), label = node('h2', labelFor(id)); label.id = `history-title-${id}`; article.setAttribute('aria-labelledby', label.id);
  title.append(node('p', `${String(index + 1).padStart(2, '0')} / ${ORDER.length}`, 'eyebrow'), label);
  const kind = weapons[id].melee ? local('Mêlée', 'Melee') : weapons[id].fuel ? local('Jet et brûlure', 'Flame and burn') : weapons[id].explosive ? local('Explosion', 'Explosion') : `${fmt(weapons[id].bulletPhysics.muzzleSpeed)} m/s`;
  header.append(title, node('span', kind, 'history-kind')); article.append(header);
  if (id === 'magnum') {
    const wrap = node('label', local('Cible du Magnum', 'Magnum target'), 'history-local-control'), select = node('select'); select.id = 'history-magnum-target';
    for (const [value, text] of [['boss', local('Boss · dégâts par tir', 'Boss · damage per shot')], ['ordinary', local('Infecté à 400 PV · PV retirés', '400 HP infected · HP removed')]]) { const option = node('option', text); option.value = value; select.append(option); }
    select.value = target; select.addEventListener('change', () => { target = select.value; renderChart(cards.find(card => card.id === 'magnum')); }); wrap.append(select); article.append(wrap);
  }
  if (weapons[id].fuel) {
    const wrap = node('label', local('Effet mesuré', 'Measured effect'), 'history-local-control'), select = node('select'); select.id = 'history-flame-mode';
    for (const [value, text] of [['direct', local('Jet direct', 'Direct flame')], ['burn', local('Brûlure créée', 'New lingering burn')], ['total', local('Jet + brûlure · PV/s', 'Direct + burn · HP/s')]]) { const option = node('option', text); option.value = value; select.append(option); }
    select.value = flameMode; select.addEventListener('change', () => { flameMode = select.value; renderChart(cards.find(card => card.id === 'flamethrower')); }); wrap.append(select); article.append(wrap);
  }
  const graph = node('div', undefined, 'history-graph'); graph.setAttribute('role', 'img'); article.append(graph);
  const atLine = node('div', undefined, 'history-at'), at = node('output'); atLine.append(node('span', weapons[id].explosive ? local('Depuis l’explosion', 'From explosion') : local('Distance de lecture', 'Reading distance')), at); article.append(atLine);
  const values = node('dl', undefined, 'history-values'), fields = [];
  for (const text of [local('Avant', 'Before'), local('Maintenant', 'Now'), local('Écart', 'Difference')]) { const item = node('div'), value = node('dd'); item.append(node('dt', text), value); values.append(item); fields.push(value); }
  article.append(values);
  let calibration;
  if (bullet(id)) {
    const table = node('table', undefined, 'history-calibration'), head = node('thead'), heading = node('tr'), body = node('tbody');
    table.append(node('caption', local('Repères fixes', 'Fixed references')));
    for (const text of [local('Mesure', 'Measure'), local('Avant', 'Before'), local('Maintenant', 'Now'), local('Écart', 'Difference')]) { const cell = node('th', text); cell.scope = 'col'; heading.append(cell); }
    head.append(heading); table.append(head, body); calibration = [];
    for (const [index, text] of [local('À 10 m', 'At 10 m'), local('Moyenne 0–30 m', '0–30 m average')].entries()) {
      const row = node('tr'), title = node('th', text); title.scope = 'row'; row.dataset.metric = index ? 'mean-0-30' : 'at-10'; row.append(title);
      const fields = Array.from({ length: 3 }, () => node('td')); row.append(...fields); body.append(row); calibration.push(fields);
    }
    article.append(table);
  }
  let localSlider;
  if (!bullet(id)) { localSlider = node('input', undefined, 'history-local-distance'); localSlider.type = 'range'; localSlider.min = 0; localSlider.max = domain(id); localSlider.step = .1; localSlider.value = distance(id); localSlider.setAttribute('aria-label', `${labelFor(id)} · ${axis(id)}`); localSlider.addEventListener('input', () => { specialDistances[id] = Number(localSlider.value); renderReadout(cards.find(card => card.id === id)); }); article.append(localSlider); }
  const noteEl = node('p', undefined, 'history-note'); article.append(noteEl);
  return { id, article, graph, at, before: fields[0], current: fields[1], delta: fields[2], note: noteEl, localSlider, calibration };
}

function translate() {
  document.documentElement.lang = getLanguage();
  document.title = local('Deadwood — Dégâts avant / maintenant', 'Deadwood — Damage before / now');
  $('language-select').value = getLanguage();
  $('language-select').setAttribute('aria-label', local('Langue', 'Language'));
  for (const el of document.querySelectorAll('[data-copy]')) el.textContent = COPY[el.dataset.copy][getLanguage() === 'fr' ? 0 : 1];
  if (!weapons) return;
  cards = ORDER.map(createCard); $('history-grid').replaceChildren(...cards.map(card => card.article));
  const date = baseline.provenance?.checkedAt ?? baseline.provenance?.capturedAt;
  const stamp = date && !Number.isNaN(Date.parse(date)) ? new Intl.DateTimeFormat(getLanguage() === 'fr' ? 'fr-FR' : 'en-GB').format(new Date(date)) : '17/10/2026';
  const grenadeStamp = new Intl.DateTimeFormat(getLanguage() === 'fr' ? 'fr-FR' : 'en-GB').format(new Date(GRENADE_BASELINE_PROVENANCE.checkedAt));
  $('history-provenance').textContent = local(`Avant : référence figée du Refuge habituel sur 3002, relevée le ${stamp}. Grenade ajoutée depuis ses règles du ${grenadeStamp} : 450 PV, pleine puissance jusqu’à 2 m, décroissance linéaire jusqu’à 4 m. Maintenant : profils du serveur de cette page.`, `Before: frozen original Shelter reference from port 3002, captured on ${stamp}. Grenade added from its rules on ${grenadeStamp}: 450 HP, full power through 2 m, linear decay to 4 m. Now: profiles from this page’s server.`);
  cards.forEach(renderChart); renderDistances();
}

async function load() {
  const request = ++version; $('load-status').textContent = local('Chargement des profils…', 'Loading weapon profiles…'); $('history-retry').hidden = true;
  try {
    const responses = await Promise.all(['/weapon-damage-before.json', '/world.json'].map(url => fetch(url, { cache: 'no-store' })));
    if (responses.some(response => !response.ok)) throw new Error('Unavailable profiles');
    const [before, current] = await Promise.all(responses.map(response => response.json()));
    if (!current.grenades || !Number.isFinite(current.grenades.damage)) throw new Error('Missing grenade profile');
    before.weapons = { ...before.weapons, grenade: BASELINE_GRENADE };
    current.weapons = { ...current.weapons, grenade: { ...current.grenades, explosive: true } };
    if (!before.weapons || !current.weapons || ORDER.some(id => !before.weapons[id] || !current.weapons[id]) || ORDER.slice(0, 8).some(id => !current.weapons[id].bulletPhysics)) throw new Error('Incomplete profiles');
    if (request !== version) return;
    baseline = before; weapons = current.weapons; translate(); $('history-content').hidden = false; $('load-status').textContent = '';
    if (/^#history-[a-z]+$/.test(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (error) {
    if (request !== version) return;
    $('history-content').hidden = true; $('load-status').textContent = local('Impossible de charger les deux versions. Ouvre cette page sur le serveur d’essai à jour, puis réessaie.', 'Could not load both versions. Open this page on the current preview server and try again.'); $('history-retry').hidden = false;
  }
}

$('history-range').addEventListener('change', () => { $('history-distance').max = $('history-range').value; if (Number($('history-distance').value) > Number($('history-range').value)) $('history-distance').value = $('history-range').value; cards.forEach(renderChart); renderDistances(); });
$('history-distance').addEventListener('input', renderDistances);
$('history-shotgun-unit').addEventListener('change', () => { const card = cards.find(card => card.id === 'shotgun'); if (card) renderChart(card); });
$('history-melee').addEventListener('change', () => cards.filter(card => weapons[card.id].melee).forEach(renderChart));
$('language-select').addEventListener('change', () => { setLanguage($('language-select').value); translate(); });
$('history-retry').addEventListener('click', load);
translate(); load();
