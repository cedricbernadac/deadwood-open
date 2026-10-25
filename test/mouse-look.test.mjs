import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RAW_MOUSE_KEY, readRawMouse, saveRawMouse, rawMovementScale, WARP_ECHO, warpEcho, warpEchoSized, requestMouseLock } from '../public/mouse-look.js';

// Mouse deltas and event times of the owner's F8 capture (11 October 2026),
// without positions, names or paths: validation/aim-jumps-2026-10-14.md.
const trace = JSON.parse(readFileSync(new URL('./fixtures/aim-trace-mouse-2026-10-11.json', import.meta.url), 'utf8'));
const { width: traceWidth, height: traceHeight } = trace.viewport;

function memoryStorage(initial = {}, blocked = false) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { writes, getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); writes.push([key, value]); values.set(key, value); } };
}
const domError = name => Object.assign(new Error(name), { name });

// Deterministic pseudo-random numbers (mulberry32).
function random(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Genuine flicks: minimum-jerk turns (Flash & Hogan) of 5-300 degrees, a fifth
// of them vertical (5-85 degrees), each followed by a pause. Peak speeds reach
// 8 degrees/ms horizontally and 4 vertically, beyond human flicks. The mouse
// reports whole counts; events arrive one per report, or merged once per
// display frame like Chromium's mousemove, with 3 % of frames stalled for
// 50-150 ms. Each event keeps the time of its newest report.
function genuineFlicks({ sensitivity, reportHz, frameHz = 0, flicks = 100, seed }) {
  const next = random(seed), reports = [];
  let time = 0, x = 0, y = 0;
  for (let index = 0; index < flicks; index++) {
    const vertical = next() < .2, degrees = vertical ? 5 + next() * 80 : 5 + next() * 295;
    const peak = (vertical ? 4 : 8) * (.25 + .75 * next()), duration = 1.875 * degrees / peak;
    const distance = degrees * Math.PI / 180 / sensitivity * (next() < .5 ? -1 : 1), period = 1000 / reportHz;
    const startX = x, startY = y;
    for (let elapsed = period * next(); elapsed < duration + period; elapsed += period * (.9 + .2 * next())) {
      const progress = Math.min(1, elapsed / duration), travelled = distance * (10 * progress ** 3 - 15 * progress ** 4 + 6 * progress ** 5);
      if (vertical) y = startY + travelled; else x = startX + travelled;
      reports.push({ time: time + elapsed, x: Math.trunc(x), y: Math.trunc(y) });
    }
    time += duration + 40 + next() * 400;
  }
  let delivered = reports;
  if (frameHz) {
    delivered = [];
    let frameEnd = 1000 / frameHz, pending = null;
    for (const report of reports) {
      while (report.time > frameEnd) {
        if (pending) { delivered.push(pending); pending = null; }
        frameEnd += next() < .03 ? 50 + next() * 100 : 1000 / frameHz;
      }
      pending = report;
    }
    if (pending) delivered.push(pending);
  }
  const events = [];
  let previous = { time: -Infinity, x: 0, y: 0 };
  for (const report of delivered) {
    events.push({ time: report.time, intervalMs: report.time - previous.time, movementX: report.x - previous.x, movementY: report.y - previous.y });
    previous = report;
  }
  return events;
}

test('raw movement is the default, persists per browser and survives blocked storage', () => {
  assert.equal(readRawMouse(memoryStorage()), true);
  assert.equal(readRawMouse(memoryStorage({ [RAW_MOUSE_KEY]: 'off' })), false);
  assert.equal(readRawMouse(memoryStorage({ [RAW_MOUSE_KEY]: 'on' })), true);
  assert.equal(readRawMouse(memoryStorage({ [RAW_MOUSE_KEY]: 'garbage' })), true);
  assert.equal(readRawMouse(memoryStorage({}, true)), true);
  assert.equal(readRawMouse(undefined), true);
  const storage = memoryStorage();
  assert.equal(saveRawMouse(storage, false), false); assert.equal(saveRawMouse(storage, true), true);
  assert.deepEqual(storage.writes, [[RAW_MOUSE_KEY, 'off'], [RAW_MOUSE_KEY, 'on']]);
  assert.doesNotThrow(() => saveRawMouse(memoryStorage({}, true), false));
});

test('raw counts are divided by the pixel ratio, so the sensitivity keeps its meaning', () => {
  assert.equal(rawMovementScale(1), 1); assert.equal(rawMovementScale(1.5), 1 / 1.5); assert.equal(rawMovementScale(2), .5);
  for (const invalid of [0, -1, NaN, Infinity, undefined, '1.5']) assert.equal(rawMovementScale(invalid), 1);
});

test('the guard drops exactly the three captured warp echoes and nothing else from the real trace', () => {
  assert.equal(trace.source.sha256, '5b30a8f28de6f50cb2409bb85158cc897c56a4c542575fce6a270d623ddc2119');
  assert.equal(trace.events.length, 278);
  const dropped = [];
  let previousTime = -Infinity;
  for (const [index, time, movementX, movementY] of trace.events) {
    if (warpEcho({ movementX, movementY, intervalMs: time - previousTime, width: traceWidth, height: traceHeight })) dropped.push(index);
    previousTime = time;
  }
  assert.deepEqual(dropped, [107, 265, 267]);
  // Each echo repeats the hidden cursor's offset when it was warped back to the
  // centre: the genuine movement between the first and second echo adds up to
  // the second one, within Chromium's truncation.
  const between = trace.events.filter(([index]) => index > 107 && index < 265);
  const offset = between.reduce((sum, [, , x, y]) => [sum[0] + x, sum[1] + y], [0, 0]);
  assert.deepEqual(offset, [593, -89]);
  for (const index of [265, 267]) {
    const [, , x, y] = trace.events.find(event => event[0] === index);
    assert.ok(Math.abs(x - offset[0]) <= WARP_ECHO.slackPx && Math.abs(y - offset[1]) <= WARP_ECHO.slackPx);
  }
  for (const [index, , movementX] of trace.events.filter(([index]) => [107, 265, 267].includes(index)))
    assert.ok(Math.abs(movementX) / traceWidth >= WARP_ECHO.border && Math.abs(movementX) / traceWidth < .355, `event ${index}`);
});

test('genuine flicks are never dropped, even when a size-only cap would have cut them', () => {
  let events = 0, flicks = 0, large = 0;
  for (const sensitivity of [.0006, .0018, .004])
    for (const [reportHz, frameHz] of [[125, 0], [1000, 0], [8000, 0], [1000, 60], [1000, 144], [8000, 240]]) {
      const stream = genuineFlicks({ sensitivity, reportHz, frameHz, seed: Math.round(sensitivity * 1e4) * 1000 + reportHz + frameHz });
      flicks += 100; events += stream.length;
      for (const [width, height] of [[1280, 720], [traceWidth, traceHeight], [1920, 1080], [2560, 1440]])
        for (const event of stream) {
          assert.equal(warpEcho({ ...event, width, height }), false, `${sensitivity} rad/px, ${reportHz} Hz, ${frameHz} fps, ${width}x${height}: ${JSON.stringify(event)}`);
          if (warpEchoSized(event.movementX, event.movementY, width, height)) large++;
        }
    }
  assert.equal(flicks, 1800);
  assert.ok(events > 150000, `events ${events}`);
  assert.ok(large > 100, `a plain size cap would have dropped ${large} genuine events`);
});

test('a model of Chromium re-centring: every stale echo is caught and no genuine event is', () => {
  // The hidden cursor starts where the capture began; entering the outer 15 %
  // warps it to the centre. The warp is followed by a zero move and, here half
  // of the time, by a stale echo of the whole offset, 0.1-0.5 ms apart.
  for (const [frameHz, width, height] of [[60, traceWidth, traceHeight], [144, 1920, 1080], [60, 1280, 720]]) {
    const next = random(frameHz + width), stream = genuineFlicks({ sensitivity: .0018, reportHz: 1000, frameHz, seed: width + height });
    const events = [];
    let offsetX = (next() - .5) * width * .5, offsetY = (next() - .5) * height * .5, echoes = 0;
    for (const event of stream) {
      events.push({ ...event, genuine: true });
      offsetX += event.movementX; offsetY += event.movementY;
      if (Math.abs(offsetX) <= width * .35 && Math.abs(offsetY) <= height * .35) continue;
      let time = event.time;
      const zero = () => { time += .1 + next() * .4; events.push({ time, movementX: 0, movementY: 0, genuine: true }); };
      const echo = () => { time += .1 + next() * .4; events.push({ time, movementX: Math.trunc(offsetX), movementY: Math.trunc(offsetY), genuine: false }); echoes++; };
      if (next() < .5) { if (next() < .5) { zero(); echo(); } else { echo(); zero(); } }
      else zero();
      offsetX = 0; offsetY = 0;
    }
    let previousTime = -Infinity, caught = 0, wrong = 0;
    for (const event of events) {
      const drop = warpEcho({ ...event, intervalMs: event.time - previousTime, width, height });
      previousTime = event.time;
      if (drop && event.genuine) wrong++;
      if (drop && !event.genuine) caught++;
    }
    assert.ok(echoes > 20, `${echoes} echoes at ${width}x${height}`);
    assert.equal(caught, echoes); assert.equal(wrong, 0);
  }
});

test('the guard needs both the size and the sub-millisecond timing, and tolerates odd inputs', () => {
  const at = intervalMs => warpEcho({ movementX: 600, movementY: 0, intervalMs, width: traceWidth, height: traceHeight });
  assert.equal(at(.4), true); assert.equal(at(0), true); assert.equal(at(.99), true);
  for (const interval of [1, 2.1, 16, -0.1, NaN, Infinity, undefined]) assert.equal(at(interval), false, String(interval));
  const limitX = traceWidth * WARP_ECHO.border - WARP_ECHO.slackPx, limitY = traceHeight * WARP_ECHO.border - WARP_ECHO.slackPx;
  assert.equal(warpEchoSized(Math.ceil(limitX), 0, traceWidth, traceHeight), true);
  assert.equal(warpEchoSized(Math.floor(limitX), 0, traceWidth, traceHeight), false);
  assert.equal(warpEchoSized(0, -Math.ceil(limitY), traceWidth, traceHeight), true, 'a top or bottom crossing is a pitch jump');
  assert.equal(warpEchoSized(0, -Math.floor(limitY), traceWidth, traceHeight), false);
  for (const [width, height] of [[0, 800], [1280, 0], [NaN, 800], [undefined, undefined]]) assert.equal(warpEchoSized(5000, 5000, width, height), false);
});

// Like a browser, converts the options during the call: one that knows
// unadjustedMovement reads it, one that does not leaves it unread.
function lockTarget(...outcomes) {
  const calls = [];
  return { calls, knowsRaw: true, requestPointerLock(...args) {
    calls.push(args.map(options => this.knowsRaw ? { unadjustedMovement: options?.unadjustedMovement } : 'unread'));
    const outcome = outcomes[Math.min(calls.length, outcomes.length) - 1];
    if (outcome instanceof Error) throw outcome;
    return typeof outcome === 'function' ? outcome() : outcome;
  } };
}

test('raw capture is requested first and reported when granted', async () => {
  const target = lockTarget(() => Promise.resolve());
  assert.deepEqual(await requestMouseLock(target), { mode: 'raw', fallback: false, rawIgnored: false, error: null });
  assert.deepEqual(target.calls, [[{ unadjustedMovement: true }]]);
  const plain = lockTarget(() => Promise.resolve());
  assert.deepEqual(await requestMouseLock(plain, { raw: false }), { mode: 'adjusted', fallback: false, rawIgnored: false, error: null });
  assert.deepEqual(plain.calls, [[]], 'the setting turned off sends the plain request');
});

test('an unsupported raw option falls back once to the plain request, without looping', async () => {
  const fallbacks = [], target = lockTarget(() => Promise.reject(domError('NotSupportedError')), () => Promise.resolve());
  const result = await requestMouseLock(target, { onFallback: (error, details) => fallbacks.push([error.name, details]) });
  assert.deepEqual(result, { mode: 'adjusted', fallback: true, rawIgnored: false, error: null });
  assert.deepEqual(target.calls, [[{ unadjustedMovement: true }], []]);
  assert.deepEqual(fallbacks, [['NotSupportedError', { errorEvent: true }]]);
  const refused = lockTarget(() => Promise.reject(domError('NotSupportedError')));
  assert.deepEqual(await requestMouseLock(refused), { mode: null, fallback: true, rawIgnored: false, error: { name: 'NotSupportedError', message: 'NotSupportedError' } });
  assert.equal(refused.calls.length, 2, 'a refused plain request is never repeated');
  const thrown = [], throwing = lockTarget(domError('NotSupportedError'), () => Promise.resolve());
  assert.deepEqual(await requestMouseLock(throwing, { onFallback: (error, details) => thrown.push(details) }), { mode: 'adjusted', fallback: true, rawIgnored: false, error: null });
  assert.deepEqual(thrown, [{ errorEvent: false }], 'a synchronous refusal queues no pointerlockerror');
});

test('other refusals are reported without a retry, and older browsers without a promise stay usable', async () => {
  for (const name of ['NotAllowedError', 'SecurityError', 'WrongDocumentError', 'InUseAttributeError']) {
    const target = lockTarget(() => Promise.reject(domError(name)));
    const result = await requestMouseLock(target, { onFallback: () => assert.fail('no fallback') });
    assert.deepEqual(result, { mode: null, fallback: false, rawIgnored: false, error: { name, message: name } });
    assert.equal(target.calls.length, 1);
  }
  const synchronous = lockTarget(domError('SecurityError'));
  assert.equal((await requestMouseLock(synchronous)).error.name, 'SecurityError'); assert.equal(synchronous.calls.length, 1);
  const legacy = lockTarget(undefined);
  assert.deepEqual(await requestMouseLock(legacy), { mode: 'unknown', fallback: false, rawIgnored: false, error: null });
  assert.deepEqual(await requestMouseLock(lockTarget(undefined), { raw: false }), { mode: 'adjusted', fallback: false, rawIgnored: false, error: null });
  assert.equal((await requestMouseLock({})).error.name, 'Unavailable');
  assert.equal((await requestMouseLock(null)).error.name, 'Unavailable');
});

test('a browser that never reads the raw option is reported as system movement, never as raw', async () => {
  // Review of 14 October: a promise that resolves only proves the capture, not
  // the option. A browser ignores a dictionary member it does not know.
  const silent = { requestPointerLock: () => Promise.resolve() };
  assert.deepEqual(await requestMouseLock(silent, { onFallback: () => assert.fail('no fallback') }), { mode: 'adjusted', fallback: false, rawIgnored: true, error: null });
  const ignoring = lockTarget(() => Promise.resolve()); ignoring.knowsRaw = false;
  assert.deepEqual(await requestMouseLock(ignoring), { mode: 'adjusted', fallback: false, rawIgnored: true, error: null });
  assert.deepEqual(ignoring.calls, [['unread']], 'one request, no retry');
  const legacy = lockTarget(undefined); legacy.knowsRaw = false;
  assert.deepEqual(await requestMouseLock(legacy), { mode: 'adjusted', fallback: false, rawIgnored: true, error: null }, 'no promise and no option: system movement');
  const refused = lockTarget(() => Promise.reject(domError('NotAllowedError'))); refused.knowsRaw = false;
  assert.deepEqual(await requestMouseLock(refused), { mode: null, fallback: false, rawIgnored: true, error: { name: 'NotAllowedError', message: 'NotAllowedError' } });
  // Only a read during the call counts: options inspected later prove nothing.
  let kept;
  const late = { requestPointerLock(options) { kept = options; return Promise.resolve().then(() => kept.unadjustedMovement); } };
  assert.deepEqual(await requestMouseLock(late), { mode: 'adjusted', fallback: false, rawIgnored: true, error: null });
  const reading = { requestPointerLock(options) { return options.unadjustedMovement === true ? Promise.resolve() : Promise.reject(domError('TypeError')); } };
  assert.deepEqual(await requestMouseLock(reading), { mode: 'raw', fallback: false, rawIgnored: false, error: null });
  assert.equal((await requestMouseLock(silent, { raw: false })).rawIgnored, false, 'the plain request asks for nothing to ignore');
});
