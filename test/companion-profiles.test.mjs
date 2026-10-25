import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANION_ARCHETYPES, COMPANION_PROFILE_CHOICES, companionArchetype } from '../public/companion-profiles.js';
import { rollCompanionProfile, companionProfilePrompt, publicCompanionProfile } from '../companions/profiles.mjs';
import { seededRandom } from '../validation/balance-report.mjs';

test('the shared catalogue exposes five frozen, translated archetypes and random selection', () => {
  const ids = ['sharpshooter', 'rusher', 'protector', 'timid', 'veteran'];
  assert.deepEqual(COMPANION_ARCHETYPES.map(entry => entry.id), ids);
  assert.deepEqual(COMPANION_PROFILE_CHOICES, ['random', ...ids]);
  assert.ok(Object.isFrozen(COMPANION_PROFILE_CHOICES) && Object.isFrozen(COMPANION_ARCHETYPES));
  for (const entry of COMPANION_ARCHETYPES) {
    assert.equal(companionArchetype(entry.id), entry);
    assert.ok(entry.labels.fr && entry.labels.en && entry.descriptions.fr && entry.descriptions.en);
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.labels) && Object.isFrozen(entry.descriptions) && Object.isFrozen(entry.ratings));
    assert.ok(Object.values(entry.ratings).every(value => Number.isInteger(value) && value >= 1 && value <= 5));
  }
  assert.equal(companionArchetype('random'), null);
  assert.equal(companionArchetype('__proto__'), null);
});

test('profiles vary independently within eight percent and stay immutable after creation', () => {
  for (const id of COMPANION_PROFILE_CHOICES.slice(1)) {
    const nominal = rollCompanionProfile(id, () => .5);
    const random = seededRandom(431);
    const seen = new Set();
    for (let index = 0; index < 100; index++) {
      const profile = rollCompanionProfile(id, random);
      assert.equal(profile.selection, id); assert.equal(profile.archetype, id);
      assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.aim) && Object.isFrozen(profile.aim.reaction)
        && Object.isFrozen(profile.aim.pause) && Object.isFrozen(profile.traits) && Object.isFrozen(profile.variation));
      assert.ok(Object.values(profile.variation).every(factor => factor >= .92 && factor <= 1.08));
      for (const key of ['tremorYaw', 'tremorPitch']) {
        assert.ok(profile.aim[key] >= nominal.aim[key] * .92 - 1e-12 && profile.aim[key] <= nominal.aim[key] * 1.08 + 1e-12);
      }
      for (const key of ['reaction', 'pause']) {
        assert.ok(profile.aim[key][0] > 0 && profile.aim[key][0] < profile.aim[key][1]);
        profile.aim[key].forEach((value, part) => assert.ok(value >= nominal.aim[key][part] * .92 - 1e-12 && value <= nominal.aim[key][part] * 1.08 + 1e-12));
      }
      const before = JSON.stringify(profile);
      assert.throws(() => { profile.aim.reaction[0] = 0; }, TypeError);
      assert.throws(() => { profile.traits.courage = 0; }, TypeError);
      assert.equal(JSON.stringify(profile), before);
      seen.add(JSON.stringify(profile.variation));
    }
    assert.equal(seen.size, 100, 'independent individual variation, rather than one shared profile');
    assert.deepEqual(rollCompanionProfile(id, seededRandom(99)), rollCompanionProfile(id, seededRandom(99)));
  }
});

test('random archetypes use equal bins, permit duplicates and clamp a hostile random source', () => {
  for (let index = 0; index < COMPANION_ARCHETYPES.length; index++) {
    const profile = rollCompanionProfile('random', () => (index + .5) / 5);
    assert.equal(profile.selection, 'random');
    assert.equal(profile.archetype, COMPANION_ARCHETYPES[index].id);
  }
  assert.equal(rollCompanionProfile('random', () => .99).archetype, 'veteran');
  assert.equal(rollCompanionProfile('random', () => 1).archetype, 'veteran');
  assert.equal(rollCompanionProfile('random', () => -1).archetype, 'sharpshooter');
  assert.equal(rollCompanionProfile('bad', () => NaN).archetype, 'protector');
  assert.deepEqual(rollCompanionProfile('random', () => .5), rollCompanionProfile('random', () => .5));
  let calls = 0;
  rollCompanionProfile('protector', () => { calls++; return .5; }); assert.equal(calls, 3);
  rollCompanionProfile('random', () => { calls++; return .5; }); assert.equal(calls, 7);
});

test('profiles differentiate accuracy, reaction, semiautomatic eagerness and pressure handling', () => {
  const profiles = Object.fromEntries(COMPANION_ARCHETYPES.map(entry => [entry.id, rollCompanionProfile(entry.id, () => .5)]));
  const { veteran, sharpshooter, protector, rusher, timid } = profiles;
  assert.ok(veteran.aim.tremorYaw < sharpshooter.aim.tremorYaw && sharpshooter.aim.tremorYaw < protector.aim.tremorYaw
    && protector.aim.tremorYaw < rusher.aim.tremorYaw && rusher.aim.tremorYaw < timid.aim.tremorYaw);
  assert.ok(veteran.aim.reaction[1] < protector.aim.reaction[0] && rusher.aim.reaction[1] < timid.aim.reaction[0]);
  assert.ok(rusher.aim.pause[1] < sharpshooter.aim.pause[0] + 1e-12);
  assert.ok(veteran.aim.flinch < timid.aim.flinch && veteran.aim.crowd < timid.aim.crowd);
  assert.ok(protector.traits.teamwork > rusher.traits.teamwork && rusher.traits.courage > timid.traits.courage);
  assert.ok(Object.values(profiles).every(profile => Object.values(profile.traits).every(value => value >= 0 && value <= 1)));
});

test('the prompt reflects the actual individual while public data omits private tuning', () => {
  for (const id of COMPANION_PROFILE_CHOICES) {
    const profile = rollCompanionProfile(id, () => .8);
    const prompt = companionProfilePrompt(profile);
    assert.ok(prompt.length > 100 && prompt.length <= 400);
    assert.ok(prompt.includes(companionArchetype(profile.archetype).labels.en));
    assert.ok(prompt.includes(profile.aim.tremorYaw.toFixed(3)) && prompt.includes(profile.aim.reaction[0].toFixed(2)));
    assert.match(prompt, /Soft preferences; adapt to emergencies and team needs/);
    assert.deepEqual(publicCompanionProfile(profile), { selection: profile.selection, archetype: profile.archetype });
  }
  for (const invalid of [null, {}, { selection: 'random', archetype: 'bad' }, { selection: 'timid', archetype: 'veteran' }]) {
    assert.equal(publicCompanionProfile(invalid), null); assert.equal(companionProfilePrompt(invalid), '');
  }
  assert.equal(companionProfilePrompt({ selection: 'timid', archetype: 'timid', aim: { reaction: 1 }, traits: {} }), '');
});
