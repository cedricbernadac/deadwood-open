import assert from 'node:assert/strict';
import test from 'node:test';
import { RUMBLE, RUMBLE_LEVELS, rumbleEffect, playRumble, stopRumble } from '../public/haptics.js';
import { FIRE_INTERVALS, MELEE_WEAPONS } from '../public/rules.js';
import { CONTROLLER_DEFAULTS, normalizeControllerSettings } from '../public/controller-ui.js';

const firearms = Object.keys(FIRE_INTERVALS).filter(weapon => !MELEE_WEAPONS[weapon]);

test('every firearm has a recoil rumble, melee weapons none, and the off level silences all', () => {
  assert.deepEqual(Object.keys(RUMBLE).sort(), [...firearms].sort());
  for (const weapon of firearms) {
    const effect = rumbleEffect(weapon);
    assert.ok(effect.duration > 0 && effect.strongMagnitude > 0 && effect.weakMagnitude > 0 && effect.rightTrigger > 0, weapon);
    assert.equal(rumbleEffect(weapon, 'off'), null);
  }
  for (const weapon of Object.keys(MELEE_WEAPONS)) assert.equal(rumbleEffect(weapon), null, weapon);
  assert.equal(rumbleEffect('unknown'), null);
  assert.deepEqual(rumbleEffect('pistol', 'nonsense'), rumbleEffect('pistol', 'normal'), 'an unknown level falls back to normal');
});

test('automatic rifles pulse once per round, the gatling and flamethrower hum, and the heavy guns kick hardest', () => {
  for (const weapon of ['smg', 'assault', 'rifle'])
    assert.ok(RUMBLE[weapon].duration < FIRE_INTERVALS[weapon] * 1000 * .8, `${weapon}: each kick is felt apart`);
  for (const weapon of ['minigun', 'flamethrower'])
    assert.ok(RUMBLE[weapon].duration > FIRE_INTERVALS[weapon] * 1000, `${weapon} lasts past its firing interval`);
  const kick = weapon => rumbleEffect(weapon).strongMagnitude;
  assert.ok(kick('shotgun') > kick('assault') && kick('assault') > kick('pistol'));
  assert.ok(kick('rocket') >= kick('shotgun') && kick('flamethrower') < kick('pistol'));
});

test('levels scale every motor and never pass full power', () => {
  const light = rumbleEffect('assault', 'light'), normal = rumbleEffect('assault'), strong = rumbleEffect('shotgun', 'strong');
  assert.equal(RUMBLE_LEVELS.light, .5);
  assert.ok(Math.abs(light.strongMagnitude - normal.strongMagnitude / 2) < 1e-9);
  for (const key of ['strongMagnitude', 'weakMagnitude', 'rightTrigger']) assert.ok(strong[key] <= 1, key);
  assert.equal(strong.rightTrigger, 1);
});

function actuator(effects) {
  const calls = [];
  return { calls, effects, playEffect(type, parameters) { calls.push({ type, parameters }); return Promise.resolve('complete'); }, reset() { calls.push({ type: 'reset' }); return Promise.resolve('complete'); } };
}

test('the right trigger kicks too when the browser lists trigger rumble; otherwise the two body motors', () => {
  const effect = rumbleEffect('shotgun');
  const triggers = actuator(['dual-rumble', 'trigger-rumble']);
  assert.equal(playRumble({ vibrationActuator: triggers }, effect), 'trigger');
  assert.deepEqual(triggers.calls[0], { type: 'trigger-rumble', parameters: { startDelay: 0, duration: 130, strongMagnitude: effect.strongMagnitude, weakMagnitude: effect.weakMagnitude, leftTrigger: 0, rightTrigger: effect.rightTrigger } });
  const body = actuator(['dual-rumble']);
  assert.equal(playRumble({ vibrationActuator: body }, effect), 'dual');
  assert.equal(body.calls[0].type, 'dual-rumble');
  assert.equal('rightTrigger' in body.calls[0].parameters, false);
  const older = actuator(undefined); // browsers without the effects list
  assert.equal(playRumble({ vibrationActuator: older }, effect), 'dual');
});

test('rumble never throws: no pad, no actuator, a refused effect or a throwing actuator', async () => {
  const effect = rumbleEffect('pistol');
  assert.equal(playRumble(null, effect), null);
  assert.equal(playRumble({}, effect), null);
  assert.equal(playRumble({ vibrationActuator: actuator(['dual-rumble']) }, null), null);
  const refused = { playEffect: () => Promise.reject(new Error('NotSupportedError')) };
  assert.equal(playRumble({ vibrationActuator: refused }, effect), 'dual');
  await new Promise(resolve => setTimeout(resolve, 5)); // a rejection would surface as unhandled here
  assert.equal(playRumble({ vibrationActuator: { playEffect() { throw new Error('gone'); } } }, effect), null);
  const pulses = [];
  assert.equal(playRumble({ hapticActuators: [{ pulse: (value, duration) => { pulses.push([value, duration]); return Promise.resolve(true); } }] }, effect), 'pulse');
  assert.deepEqual(pulses, [[effect.weakMagnitude, 50]]);
  const stopped = actuator(['dual-rumble']);
  stopRumble({ vibrationActuator: stopped });
  assert.deepEqual(stopped.calls, [{ type: 'reset' }]);
  assert.doesNotThrow(() => stopRumble(null));
  assert.doesNotThrow(() => stopRumble({ vibrationActuator: { reset() { throw new Error('gone'); } } }));
});

test('the rumble setting is saved with the controller settings, normal by default', () => {
  assert.equal(CONTROLLER_DEFAULTS.rumble, 'normal');
  assert.equal(normalizeControllerSettings({}).rumble, 'normal');
  assert.equal(normalizeControllerSettings({ rumble: 'off' }).rumble, 'off');
  assert.equal(normalizeControllerSettings({ rumble: 'loud' }).rumble, 'normal');
});
