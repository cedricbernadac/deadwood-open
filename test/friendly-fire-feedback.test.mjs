import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublicModule } from './helpers/public-modules.mjs';

// Friendly fire's shooter feedback in the shared modules (owner, 23 October):
// a red skull on the crosshair that no zombie marker of the same moment
// hides, and red signed numbers; every other use stays as it was.
const { HIT_TIERS, HIT_DURATIONS, createFeedbackHud } = await importPublicModule('feedback-hud.js');
const { createDamageNumbers, DAMAGE_NUMBER_LIFETIME } = await importPublicModule('damage-numbers.js');

function element(tag = 'div') {
  const classes = new Set();
  return { tagName: tag.toUpperCase(), children: [], hidden: false, textContent: '', style: {}, offsetWidth: 0, className: '',
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name), toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name) },
    append(...nodes) { this.children.push(...nodes); }, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
}
const document = { createElement: element };

test('the friendly marker is a red skull that outranks every zombie marker', () => {
  assert.ok(HIT_TIERS.friendly > Math.max(HIT_TIERS.hit, HIT_TIERS.headshot, HIT_TIERS.kill, HIT_TIERS.headshotKill));
  assert.ok(HIT_DURATIONS.friendly >= HIT_DURATIONS.headshotKill);
  let clock = 0;
  const marker = element(), hud = createFeedbackHud({ document, marker, popupLayer: element(), scoreTarget: element(), chainBanner: element(), teamFeed: element(),
    t: key => key, now: () => clock });
  hud.hit('friendly');
  assert.equal(marker.textContent, '☠'); assert.ok(marker.classList.contains('tier-friendly')); assert.equal(marker.hidden, false);
  clock = 50; hud.hit('headshotKill');
  assert.equal(marker.textContent, '☠', 'a zombie killed in the same moment never hides it');
  clock = HIT_DURATIONS.friendly + 60; hud.hit('hit');
  assert.equal(marker.textContent, '×', 'afterwards, the usual cross');
});

test('a variant and a sign mark every number of that instance, and only it', () => {
  let clock = 0;
  const layer = element(), plain = element();
  const friendly = createDamageNumbers({ document, layer, variant: 'friendly', sign: '−', canFly: () => false, now: () => clock });
  const usual = createDamageNumbers({ document, layer: plain, now: () => clock });
  assert.equal(friendly.enabled, true, 'on without any stored setting');
  const point = () => ({ x: 100, y: 100 });
  friendly.addImpacts([['mate', 0, 1.8, -3, 8.4, 0]], point);
  usual.addImpacts([['z1', 0, 1, -3, 12, 0]], point);
  assert.deepEqual(layer.children.map(child => [child.textContent, child.className]), [['−8', 'damage-number damage-friendly']]);
  assert.deepEqual(plain.children.map(child => [child.textContent, child.className]), [['12', 'damage-number']]);
  clock = 100; friendly.addImpacts([['mate', 0, 1.8, -3, 6.2, 4]], point);
  assert.equal(layer.children[0].textContent, '−14', 'a burst adds up on the same teammate');
  assert.equal(layer.children[0].className, 'damage-number damage-friendly damage-kill');
  clock = 100 + DAMAGE_NUMBER_LIFETIME + 1; friendly.update();
  assert.equal(friendly.count, 0, 'it never flew to the score: it simply faded');
});

// The shooter's red number is what the round took, like an enemy's (capped
// at the health left), the vest's share included. A real round from the
// simulation (test/fixtures/friendly-fire-scenarios.mjs) goes through the
// friendlyHitFeedback of both clients, run as written in a vm.
const { readFileSync } = await import('node:fs');
const vm = await import('node:vm');
const { IDS, room, flyBullets, friendlyHits } = await import('./fixtures/friendly-fire-scenarios.mjs');
function shown(file, sim, hit) {
  const layer = element();
  const friendlyNumbers = createDamageNumbers({ document, layer, variant: 'friendly', sign: '−', canFly: () => false, now: () => 0 });
  const source = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
  const [code] = source.match(/function friendlyHitFeedback\(event\) \{[\s\S]*?\n\}/);
  const context = vm.createContext({ snapshot: sim.snapshot(), feedback: { hit() {} }, friendlyNumbers, damagePoint: () => ({ x: 100, y: 100 }), friendlyCallout() {} });
  vm.runInContext(`${code}\nfriendlyHitFeedback(${JSON.stringify(hit)});`, context);
  return layer.children.map(child => child.textContent);
}
test('the shooter’s red number shows what the round took: never past the health left, the vest’s share included', () => {
  for (const [weapon, mate, inflicted, label] of [['sniper', { hp: 1, armor: 0 }, 1, '−1'], ['pistol', { hp: 10, armor: 0 }, 10, '−10'],
    ['pistol', { hp: 100, armor: 10 }, null, '−25'], ['pistol', { hp: 100, armor: 0 }, null, '−25']]) {
    const { sim, events, b, put } = room({ level: 'full', weapon });
    put(b, 2.5, mate);
    sim.shoot(IDS.a, 0); flyBullets(sim);
    const [hit, ...more] = friendlyHits(events, IDS.b);
    assert.equal(more.length, 0);
    const lost = mate.hp - b.hp + mate.armor - (b.armor ?? 0);
    assert.ok(Math.abs(hit.inflicted - lost) < 1e-9, `${weapon} on ${JSON.stringify(mate)}: inflicted ${hit.inflicted} is what was lost (${lost})`);
    if (inflicted !== null) assert.equal(hit.inflicted, inflicted);
    else assert.equal(hit.inflicted, hit.damage, 'nothing past the health: the whole blow');
    assert.equal(hit.absorbed, Math.min(mate.armor, hit.damage), '`absorbed` unchanged');
    assert.ok(hit.damage >= hit.inflicted, '`damage` stays the incoming blow');
    for (const file of ['client.js', 'online-client.js']) assert.deepEqual(shown(file, sim, hit), [label], `${file}, ${weapon} on ${JSON.stringify(mate)}`);
  }
  // An event from an older server, without the field: the incoming blow, as before.
  const { sim } = room({ level: 'full' });
  const old = { event: 'hit', id: IDS.b, damage: 8.4, absorbed: 0, armor: 0, source: 'friendly', shooterId: IDS.a };
  assert.deepEqual(shown('client.js', sim, old), ['−8']);
});
