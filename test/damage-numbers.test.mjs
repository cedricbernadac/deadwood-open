import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamageNumbers, impactRecords, damageText, damageFontSize, loadImpactNumbersSetting, IMPACT_NUMBERS_KEY, IMPACT_NUMBERS_DEFAULT,
  LEGACY_FEEDBACK_KEY, LEGACY_DAMAGE_NUMBERS_KEY, MAX_DAMAGE_NUMBERS, DAMAGE_MERGE_WINDOW, DAMAGE_MERGE_AGE, CONTINUOUS_MERGE_WINDOW, DAMAGE_NUMBER_LIFETIME,
  DAMAGE_NUMBER_GAP, DAMAGE_RISE, damageRise, IMPACT_FLAGS } from '../public/damage-numbers.js';
import { FIRE_INTERVALS } from '../public/rules.js';

// Impact numbers (owner, 18 October): one number per impact, the score the
// hit earned; the server sends each survivor their own as compact records.
const record = (zombieId = 'z1', amount = 20, flags = 0) => [zombieId, 0, 1, -4, amount, flags];
function memory(entries = []) {
  const map = new Map(entries), writes = [];
  return { map, writes, getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); map.set(key, value); } };
}
function fixture({ storage = memory(), targetRect = { left: 1000, top: 20, width: 100, height: 40 }, canFly = true, scale = 1 } = {}) {
  let time = 0, projections = 0, landed = 0;
  const animations = [];
  const layer = { children: [], append(element) { this.children.push(element); } };
  const document = { createElement() {
    const element = { style: {}, className: '', textContent: '', remove() { const index = layer.children.indexOf(this); if (index >= 0) layer.children.splice(index, 1); },
      animate(keyframes, options) { const animation = { element, keyframes, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; } };
    return element;
  } };
  const target = targetRect ? { getBoundingClientRect: () => targetRect } : null;
  const frames = flight => [{ transform: 'start' }, { transform: `fly ${flight.dx},${flight.dy}` }];
  const hud = createDamageNumbers({ document, layer, storage, now: () => time, target, frames, scale: () => scale, canFly: () => canFly, onLand: () => { landed++; } });
  return { hud, layer, storage, animations, project: () => { projections++; return { x: 100, y: 100 }; },
    get projections() { return projections; }, get landed() { return landed; }, advance(ms) { time += ms; } };
}

test('server records are validated; a burn batch is continuous fire too', () => {
  assert.deepEqual(impactRecords([record('z1', 12.4, IMPACT_FLAGS.headshot | IMPACT_FLAGS.killed)]),
    [{ zombieId: 'z1', x: 0, y: 1, z: -4, amount: 12, headshot: true, continuous: false, killed: true, rocket: false }]);
  assert.equal(impactRecords({ impacts: [record('z2', 3, IMPACT_FLAGS.burn)] })[0].continuous, true);
  assert.equal(IMPACT_FLAGS.rocket, 16); assert.equal(impactRecords([record('z3', 40, IMPACT_FLAGS.rocket)])[0].rocket, true, 'a rocket blast is marked');
  for (const bad of [null, [1, 0, 0, 0, 5, 0], ['z', NaN, 0, 0, 5, 0], ['z', 0, 0, 0, -1, 0], ['z', 0, 0, 0, 5, .5], { zombieId: 'z' }])
    assert.deepEqual(impactRecords([bad]), [], JSON.stringify(bad));
  assert.equal(impactRecords(Array.from({ length: 100 }, (_, index) => record(`z${index}`))).length, 64, 'a forged batch stays bounded');
  assert.equal(damageText(1839.6), '1840'); assert.equal(damageText(-3), '0');
});

test('numbers are on by default; an explicit « Score et pièces qui s’envolent » opt-out keeps them off', () => {
  assert.equal(IMPACT_NUMBERS_DEFAULT, true);
  const fresh = memory();
  assert.equal(loadImpactNumbersSetting(fresh), true); assert.deepEqual(fresh.writes, [], 'nothing stored until asked');
  const optedOut = memory([[LEGACY_FEEDBACK_KEY, JSON.stringify({ shake: .5, scorePopups: false })]]);
  assert.equal(loadImpactNumbersSetting(optedOut), false);
  assert.deepEqual(optedOut.writes, [[IMPACT_NUMBERS_KEY, '0']], 'the opt-out is written down once');
  // The coin setting then takes the old field over: the numbers stay off.
  optedOut.map.set(LEGACY_FEEDBACK_KEY, JSON.stringify({ shake: .5, coinPopups: true }));
  assert.equal(loadImpactNumbersSetting(optedOut), false);
  assert.equal(loadImpactNumbersSetting(memory([[LEGACY_FEEDBACK_KEY, JSON.stringify({ shake: .5, scorePopups: true })]])), true);
  // The old damage numbers were off by default; alone, their choice says nothing about the score popups.
  for (const value of ['0', '1']) assert.equal(loadImpactNumbersSetting(memory([[LEGACY_DAMAGE_NUMBERS_KEY, value]])), true, value);
  // Who had turned « Dégâts à l’impact » on chose these numbers, even after
  // turning the flying score off (the « double emploi » reaction): they stay on.
  const optedIn = memory([[LEGACY_DAMAGE_NUMBERS_KEY, '1'], [LEGACY_FEEDBACK_KEY, JSON.stringify({ shake: .5, scorePopups: false })]]);
  assert.equal(loadImpactNumbersSetting(optedIn), true, 'an explicit opt-in to the old numbers keeps them');
  assert.deepEqual(optedIn.writes, [], 'and stores nothing until asked');
  const offBoth = memory([[LEGACY_DAMAGE_NUMBERS_KEY, '0'], [LEGACY_FEEDBACK_KEY, JSON.stringify({ shake: .5, scorePopups: false })]]);
  assert.equal(loadImpactNumbersSetting(offBoth), false, 'the old numbers off and the flying score off: numbers off');
  const halfBlocked = { getItem: key => { if (key === LEGACY_DAMAGE_NUMBERS_KEY) throw new Error('blocked'); return key === LEGACY_FEEDBACK_KEY ? '{"scorePopups":false}' : null; }, setItem() {} };
  assert.equal(loadImpactNumbersSetting(halfBlocked), false, 'an unreadable old key falls back to the score popup rule');
  assert.equal(loadImpactNumbersSetting(memory([[IMPACT_NUMBERS_KEY, '0']])), false);
  assert.equal(loadImpactNumbersSetting(memory([[IMPACT_NUMBERS_KEY, '1'], [LEGACY_FEEDBACK_KEY, '{"scorePopups":false}']])), true, 'a stored choice wins');
  assert.equal(loadImpactNumbersSetting(memory([[LEGACY_FEEDBACK_KEY, '{broken']])), true);
  assert.equal(loadImpactNumbersSetting({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), true);
  assert.equal(loadImpactNumbersSetting(null), true);
});

test('one number per impact at its point, 16 to 28 px by amount and smaller on a small screen', () => {
  const f = fixture();
  f.hud.addImpacts([record('z1', 9), record('z2', 1840)], f.project);
  assert.equal(f.hud.count, 2); assert.equal(f.projections, 2);
  const [small, big] = f.layer.children;
  assert.equal(small.textContent, '9'); assert.equal(big.textContent, '1840');
  assert.equal(small.style.left, '114px'); assert.equal(small.style.top, '90px');
  assert.equal(damageFontSize(0), 16); assert.equal(damageFontSize(1e6), 28);
  assert.ok(parseFloat(small.style.fontSize) >= 16 && parseFloat(small.style.fontSize) < parseFloat(big.style.fontSize));
  assert.equal(big.style.fontSize, '28px');
  assert.equal(damageFontSize(1e6, .5), 21, 'three quarters at most on a small screen');
  assert.equal(damageFontSize(100, 2), damageFontSize(100), 'never bigger than designed');
});

test('a burst on one enemy merges into one number without a new projection or a longer life', () => {
  const f = fixture();
  f.hud.addImpacts([record('z1', 10)], f.project);
  f.advance(50); f.hud.addImpacts([record('z1', 6)], f.project);
  assert.equal(f.hud.count, 1); assert.equal(f.projections, 1); assert.equal(f.layer.children[0].textContent, '16');
  f.advance(DAMAGE_MERGE_WINDOW); f.hud.addImpacts([record('z1', 20)], f.project);
  assert.equal(f.hud.count, 2); assert.equal(f.projections, 2);
  f.advance(DAMAGE_NUMBER_LIFETIME - DAMAGE_MERGE_WINDOW - 50); f.hud.update();
  assert.equal(f.hud.count, 1, 'the first burst expires at its original deadline');
  f.advance(DAMAGE_NUMBER_LIFETIME); f.hud.update(); assert.equal(f.hud.count, 0);
});

test('held flames and burns keep adding to one number on a body a little longer', () => {
  const f = fixture(), fire = (amount, flags = IMPACT_FLAGS.continuous) => f.hud.addImpacts([record('burning', amount, flags)], f.project);
  fire(4); f.advance(125); fire(4); f.advance(125); fire(9, IMPACT_FLAGS.continuous | IMPACT_FLAGS.burn); f.advance(125); fire(4);
  assert.equal(f.hud.count, 1, `one number for ${CONTINUOUS_MERGE_WINDOW} ms of fire`); assert.equal(f.layer.children[0].textContent, '21');
  f.advance(CONTINUOUS_MERGE_WINDOW - 375); fire(4); assert.equal(f.hud.count, 2, 'then a new one');
  f.hud.addImpacts([record('shot', 10)], f.project); f.advance(DAMAGE_MERGE_WINDOW + 50); f.hud.addImpacts([record('shot', 10)], f.project);
  assert.equal(f.hud.count, 4, 'bullets keep the short window');
});

test('a big blast stays capped at twelve numbers and an off-screen impact is never moved to the crosshair', () => {
  const f = fixture();
  f.hud.addImpacts([record('off')], () => null); assert.equal(f.hud.count, 0);
  f.hud.addImpacts(Array.from({ length: 40 }, (_, index) => record(`z${index}`, index + 1)), f.project);
  assert.equal(f.hud.count, MAX_DAMAGE_NUMBERS); assert.equal(f.layer.children.length, MAX_DAMAGE_NUMBERS);
  assert.equal(f.projections, MAX_DAMAGE_NUMBERS, 'one blast cannot project forty labels');
  f.hud.addImpacts([record('later')], f.project);
  assert.equal(f.projections, MAX_DAMAGE_NUMBERS, 'the creation rate is bounded across batches too');
  f.advance(DAMAGE_NUMBER_LIFETIME); f.hud.update(); assert.equal(f.layer.children.length, 0);
  f.hud.addImpacts([record('zero', 0)], f.project); assert.equal(f.hud.count, 0, 'nothing to show for zero');
});

test('gold for a head shot, the fire colour for flames and burns', () => {
  const f = fixture();
  f.hud.addImpacts([record('head', 40, IMPACT_FLAGS.headshot), record('fire', 4, IMPACT_FLAGS.continuous), record('burn', 9, IMPACT_FLAGS.burn | IMPACT_FLAGS.continuous)], f.project);
  assert.deepEqual(f.layer.children.map(element => element.className),
    ['damage-number damage-headshot', 'damage-number damage-continuous', 'damage-number damage-continuous']);
});

test('a killing blow\'s number flies to the score and bumps it; the others rise where they hit, as a kill does when it cannot fly', () => {
  const f = fixture();
  f.hud.addImpacts([record('hit', 30), record('kill', 70, IMPACT_FLAGS.killed)], f.project);
  const [rise, flight] = f.animations;
  assert.ok(rise.keyframes.at(-1).transform.includes('translateY(-40px)'), 'a hit rises and fades');
  assert.equal(flight.keyframes.at(-1).transform, 'fly 936,-50', 'a kill flies to the score centre');
  assert.equal(f.layer.children[1].className, 'damage-number damage-kill');
  f.advance(DAMAGE_NUMBER_LIFETIME); f.hud.update();
  assert.equal(f.landed, 1, 'only the flight lands on the score');
  // A kill merged into a number already on screen sets it flying.
  f.hud.addImpacts([record('late', 20)], f.project); f.advance(30); f.hud.addImpacts([record('late', 5, IMPACT_FLAGS.killed)], f.project);
  assert.equal(f.animations.at(-2).cancelled, true); assert.match(f.animations.at(-1).keyframes.at(-1).transform, /^fly /);
  assert.equal(f.layer.children[0].textContent, '25');
  for (const options of [{ canFly: false }, { targetRect: { left: 0, top: 0, width: 0, height: 0 } }, { targetRect: null }]) {
    const still = fixture(options);
    still.hud.addImpacts([record('kill', 70, IMPACT_FLAGS.killed)], still.project);
    assert.ok(still.animations[0].keyframes.at(-1).transform.includes('translateY(-40px)'), JSON.stringify(options));
    still.advance(DAMAGE_NUMBER_LIFETIME); still.hud.update(); assert.equal(still.landed, 0);
  }
});

test('the menu checkbox is on by default, persists the choice and clears the numbers at once', () => {
  const storage = memory(), f = fixture({ storage }), handlers = {};
  const control = { checked: false, addEventListener(name, handler) { handlers[name] = handler; } };
  f.hud.bindSettings(control); assert.equal(control.checked, true);
  f.hud.addImpacts([record()], f.project); control.checked = false; handlers.change();
  assert.equal(f.hud.count, 0); assert.equal(f.hud.enabled, false); assert.equal(storage.map.get(IMPACT_NUMBERS_KEY), '0');
  f.hud.addImpacts([record()], f.project); assert.equal(f.hud.count, 0, 'off: nothing drawn');
  assert.equal(fixture({ storage }).hud.enabled, false, 'remembered');
});

// Held automatic fire (review, 18 October): one shot message per shot, so a
// record every 55-130 ms on one body. It used to stack three or four numbers
// at one spot. Now the body's newest number takes each hit while it is young,
// and a newer one starts where it never runs into it.
test('held SMG, rifle, assault and minigun fire on one body: two numbers at most, whose boxes never overlap', () => {
  for (const weapon of ['smg', 'rifle', 'assault', 'minigun']) {
    const f = fixture(), interval = Math.round(FIRE_INTERVALS[weapon] * 1000);
    let maxAlive = 0, closest = Infinity, created = 0;
    for (let time = 0; time <= 5000; time += 5) {
      if (time % interval === 0) {
        const before = f.projections;
        f.hud.addImpacts([record('held', 9)], f.project);
        created += f.projections - before;
      }
      f.hud.update();
      const boxes = f.hud.boxes().filter(box => box.target === 'held');
      maxAlive = Math.max(maxAlive, boxes.length);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
        closest = Math.min(closest, Math.abs(boxes[i].y - boxes[j].y) - (boxes[i].height + boxes[j].height) / 2);
      f.advance(5);
    }
    assert.ok(maxAlive <= 2, `${weapon}: ${maxAlive} numbers alive on one body`);
    assert.ok(closest >= DAMAGE_NUMBER_GAP - 1e-9, `${weapon}: boxes ${closest.toFixed(1)} px apart`);
    assert.ok(created >= 9 && created <= 12, `${weapon}: about two numbers a second (${created} in 5 s)`);
  }
});

test('a burst keeps adding to the newest number while it is young, with a short swell; slow shots still get one each', () => {
  const f = fixture();
  for (let shot = 0; shot < 5; shot++) { f.hud.addImpacts([record('z1', 9)], f.project); f.advance(80); }
  assert.equal(f.hud.count, 1, 'one number for 400 ms of fire'); assert.equal(f.layer.children[0].textContent, '45');
  const swells = f.animations.filter(animation => animation.keyframes[0].fontSize);
  assert.equal(swells.length, 4, 'each added hit swells the number'); assert.equal(swells.at(-1).options.duration, 140);
  assert.equal(swells.at(-1).keyframes.at(-1).fontSize, f.layer.children[0].style.fontSize, 'back to its size');
  f.advance(DAMAGE_MERGE_AGE - 400); f.hud.addImpacts([record('z1', 9)], f.project);
  assert.equal(f.hud.count, 2, `a number older than ${DAMAGE_MERGE_AGE} ms takes no more`);
  const [first, second] = f.layer.children;
  assert.ok(parseFloat(second.style.top) < parseFloat(first.style.top), 'the new one starts above the old, clear of it');
  assert.equal(second.style.left, first.style.left);
  const g = fixture();
  g.hud.addImpacts([record('z1', 37)], g.project); g.advance(Math.round(FIRE_INTERVALS.pistol * 1000)); g.hud.addImpacts([record('z1', 37)], g.project);
  assert.equal(g.hud.count, 2, 'two pistol shots, two numbers');
  // A body with nothing near its impact any more starts again at the impact.
  g.advance(DAMAGE_NUMBER_LIFETIME); g.hud.update(); g.hud.addImpacts([record('z1', 37)], g.project);
  assert.equal(g.layer.children.at(-1).style.top, '90px');
});

test('the rise the browser plays is the one the placement assumes', () => {
  const f = fixture();
  f.hud.addImpacts([record('z1', 9)], f.project);
  const frames = f.animations[0].keyframes;
  assert.equal(frames.length, DAMAGE_RISE.length);
  for (const [index, [offset, up, scale, opacity]] of DAMAGE_RISE.entries()) {
    assert.equal(frames[index].offset, offset); assert.equal(frames[index].opacity, opacity);
    assert.equal(frames[index].transform, `translate(-50%,-50%) translateY(${-up}px) scale(${scale})`);
    const at = damageRise(offset * DAMAGE_NUMBER_LIFETIME);
    assert.ok(Math.abs(at.up - up) < 1e-9 && Math.abs(at.scale - scale) < 1e-9, `rise at ${offset}`);
  }
  // Concave: a number that starts above another never sees it catch up.
  const rates = DAMAGE_RISE.slice(1).map(([offset, up], index) => (up - DAMAGE_RISE[index][1]) / (offset - DAMAGE_RISE[index][0]));
  assert.ok(rates.every((rate, index) => index === 0 || rate <= rates[index - 1]), rates.join(' '));
});
