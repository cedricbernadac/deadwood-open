import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createAimDiagnostics } from '../public/aim-diagnostics.js';

test('aim diagnostics are disabled by default and collect nothing until explicitly enabled', () => {
  const diagnostics = createAimDiagnostics();
  assert.deepEqual(diagnostics.status(), { enabled: false, captured: false, count: 0, capacity: 4096, maxAgeMs: 15000 });
  assert.equal(diagnostics.enabled, false); assert.equal(diagnostics.captured, false);
  assert.equal(diagnostics.record('mouse', { x: 20 }, 10), false);
  assert.equal(diagnostics.capture({ aim: { yaw: 1 } }, 11), false);
  assert.deepEqual(diagnostics.report().events, []);
  diagnostics.setEnabled(true);
  assert.equal(diagnostics.enabled, true);
  assert.equal(diagnostics.record('mouse', { x: 20 }, 10), true);
  assert.equal(diagnostics.status().count, 1);
});

test('the fixed ring keeps the newest events in chronological insertion order', () => {
  const diagnostics = createAimDiagnostics({ capacity: 3 }); diagnostics.setEnabled(true);
  for (let time = 0; time < 8; time++) assert.equal(diagnostics.record('mouse', { sequence: time }, time), true);
  assert.equal(diagnostics.status().count, 3);
  assert.deepEqual(diagnostics.report().events, [5, 6, 7].map(time => ({ type: 'mouse', time, data: { sequence: time } })));
  diagnostics.clear();
  diagnostics.record('lock', {}, 0); diagnostics.record('mouse', {}, 0);
  assert.deepEqual(diagnostics.report().events.map(event => event.type), ['lock', 'mouse']);
});

test('events expire against the supplied monotonic timestamp, including across ring wraparound', () => {
  const diagnostics = createAimDiagnostics({ capacity: 4, maxAgeMs: 15 }); diagnostics.setEnabled(true);
  for (const time of [0, 5, 10, 15, 20]) diagnostics.record('mouse', {}, time);
  assert.deepEqual(diagnostics.report().events.map(event => event.time), [5, 10, 15, 20], 'the exact age boundary is retained');
  diagnostics.record('frame', {}, 31);
  assert.deepEqual(diagnostics.report().events.map(event => event.time), [20, 31]);
  diagnostics.record('frame', {}, 100);
  assert.deepEqual(diagnostics.report().events.map(event => event.time), [100]);
  const sameInstant = createAimDiagnostics({ maxAgeMs: 0 }); sameInstant.setEnabled(true);
  sameInstant.record('lock', {}, 1); sameInstant.record('mouse', {}, 1); sameInstant.record('frame', {}, 2);
  assert.deepEqual(sameInstant.report().events.map(event => event.type), ['frame']);
});

test('manual capture adds a final marker and freezes the trace until explicitly rearmed', () => {
  const diagnostics = createAimDiagnostics({ capacity: 3, maxAgeMs: 20 }); diagnostics.setEnabled(true);
  diagnostics.record('mouse', { delta: 1 }, 1); diagnostics.record('frame', { yaw: 1 }, 2);
  assert.equal(diagnostics.capture({ aim: { yaw: 1 } }, 3), true);
  assert.equal(diagnostics.captured, true);
  const frozen = diagnostics.report();
  assert.equal(frozen.events.at(-1).type, 'capture');
  assert.equal(diagnostics.record('mouse', { delta: 2 }, 1000000), false);
  assert.equal(diagnostics.capture({}, 1000001), false);
  diagnostics.setEnabled(true);
  assert.deepEqual(diagnostics.report(), frozen, 'enabling an already enabled trace cannot discard a capture');
  assert.deepEqual(diagnostics.clear(), { enabled: true, captured: false, count: 0, capacity: 3, maxAgeMs: 20 });
  assert.equal(diagnostics.record('mouse', { delta: 3 }, 4), true);
  assert.deepEqual(diagnostics.report().events.map(event => event.type), ['mouse']);
});

test('capture follows the same age and capacity bounds before freezing', () => {
  const diagnostics = createAimDiagnostics({ capacity: 2, maxAgeMs: 5 }); diagnostics.setEnabled(true);
  diagnostics.record('mouse', {}, 1); diagnostics.record('frame', {}, 2);
  diagnostics.capture({}, 3);
  assert.deepEqual(diagnostics.report().events.map(event => event.type), ['frame', 'capture']);
  diagnostics.clear(); diagnostics.record('mouse', {}, 1); diagnostics.capture({}, 20);
  assert.deepEqual(diagnostics.report().events.map(event => event.type), ['capture']);
});

test('disabling immediately clears all trace data and captured state', () => {
  const diagnostics = createAimDiagnostics(); diagnostics.setEnabled(true);
  diagnostics.record('mouse', { pose: { x: 4 } }, 100); diagnostics.capture({}, 101);
  diagnostics.setEnabled(false);
  assert.equal(diagnostics.enabled, false); assert.equal(diagnostics.captured, false);
  assert.equal(diagnostics.status().count, 0); assert.deepEqual(diagnostics.report().events, []);
  assert.equal(diagnostics.record('mouse', {}, 102), false);
  diagnostics.setEnabled(true);
  assert.equal(diagnostics.record('mouse', {}, 0), true, 'a new session starts with a new supplied time origin');
  diagnostics.clear(); assert.equal(diagnostics.enabled, true);
});

test('input data and each report are independent nested copies', () => {
  const diagnostics = createAimDiagnostics(); diagnostics.setEnabled(true);
  const data = { pose: { x: 1, y: 2, z: 3 }, cam: { x: 4, y: 5, z: 6 }, aim: { yaw: .4, pitch: -.2 }, held: ['KeyW'] };
  diagnostics.record('frame', data, 1);
  data.pose.x = 100; data.cam.y = 100; data.aim.yaw = 100; data.held.push('KeyA');
  const metadata = { build: 'test', options: { raw: false } };
  const first = diagnostics.report(metadata);
  assert.deepEqual(first.events[0].data, { pose: { x: 1, y: 2, z: 3 }, cam: { x: 4, y: 5, z: 6 }, aim: { yaw: .4, pitch: -.2 }, held: ['KeyW'] });
  metadata.options.raw = true; first.events[0].data.pose.x = 100; first.events[0].data.held.push('KeyS'); first.events.length = 0;
  assert.equal(first.metadata.options.raw, false);
  const second = diagnostics.report();
  assert.equal(second.events.length, 1); assert.equal(second.events[0].data.pose.x, 1); assert.deepEqual(second.events[0].data.held, ['KeyW']);
  assert.deepEqual(second.metadata, {}, 'report metadata is not retained in the ring');
});

test('only explicitly supplied simple data is copied, without invoking getters or retaining foreign objects', () => {
  const diagnostics = createAimDiagnostics(); diagnostics.setEnabled(true);
  let reads = 0;
  const data = { delta: 3, invalid: NaN, infinite: Infinity, absent: undefined, callback() {}, foreign: new Map([['x', 1]]) };
  data.cycle = data;
  Object.defineProperty(data, 'getter', { enumerable: true, get() { reads++; return 12; } });
  diagnostics.record('mouse', data, 1);
  assert.equal(reads, 0);
  assert.deepEqual(diagnostics.report().events[0].data, { delta: 3 });
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('unavailable'); } });
  assert.equal(diagnostics.record('mouse', hostile, 2), true);
  assert.deepEqual(diagnostics.report().events[1].data, {});
});

test('plain values from another JavaScript realm remain simple copied data', () => {
  const diagnostics = createAimDiagnostics(); diagnostics.setEnabled(true);
  const data = vm.runInNewContext('({pose:{x:3,y:0,z:4},cam:{y:1.55},aim:{yaw:.2,pitch:.1},held:["KeyW"]})');
  assert.equal(diagnostics.record('frame', data, 1), true);
  data.pose.x = 100;
  assert.deepEqual(diagnostics.report().events[0].data, { pose: { x: 3, y: 0, z: 4 }, cam: { y: 1.55 }, aim: { yaw: .2, pitch: .1 }, held: ['KeyW'] });
  class Foreign { constructor() { this.x = 1; } }
  diagnostics.record('mouse', { instance: new Foreign() }, 2);
  assert.deepEqual(diagnostics.report().events[1].data, {});
});

test('invalid or backwards timestamps cannot alter the trace or freeze it', () => {
  const diagnostics = createAimDiagnostics(); diagnostics.setEnabled(true);
  diagnostics.record('mouse', {}, 10);
  for (const time of [NaN, Infinity, -Infinity, undefined, '11', 9]) {
    assert.equal(diagnostics.record('mouse', {}, time), false);
    assert.equal(diagnostics.capture({}, time), false);
  }
  assert.equal(diagnostics.captured, false); assert.equal(diagnostics.status().count, 1);
  assert.equal(diagnostics.record('', {}, 11), false); assert.equal(diagnostics.record(null, {}, 11), false);
  assert.equal(diagnostics.record('frame', {}, 10), true, 'equal timestamps preserve browser event order');
  assert.equal(diagnostics.capture({}, 11), true);
});

test('invalid buffer configuration is rejected explicitly', () => {
  for (const capacity of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => createAimDiagnostics({ capacity }), RangeError);
  for (const maxAgeMs of [-1, Infinity, NaN, '15000']) assert.throws(() => createAimDiagnostics({ maxAgeMs }), RangeError);
});
