// The kill confirm (art/frisson/KILL-SOUND.md): the kill player (merge, choke,
// heat, trims, held rocket kills, the jingle on the crack, never refused), the
// four crack candidates measured on their own renders (the analysis rules and
// K1, K3, K4, K8 against the pinned references), and Famille's clacs (Part B,
// B1 and B3). The cut-through rules K5-K7 need the owner's takes and are
// tools/frisson-sound-render.mjs --slot kill's. This file never listens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SoundEngine } from '../public/audio.js';
import { CANDIDATES, CHOSEN, KILL_BOOST, KILL_LAG, createSounds, candidate, install, render } from '../public/frisson/sounds.js';
import { KILL_K, clacCalls, engineClass, killRafale, killRules, levels, mulberry, offlineRender, peakDb, scaled, shortTerm } from '../tools/frisson-sound-analysis.mjs';

const AUDIO = readFileSync(new URL('../public/audio.js', import.meta.url), 'utf8');
const NEW = ['craque', 'claque', 'coquille', 'os'];
// The quieter tiers K3 sets the kill over (M_K LUFS at the engine's output, 14
// October 2026): Famille's hit thud (5 seeded renders, its noise averaged) and
// head-shot tink, both from audio.js (checked below); fele is measured here.
const TIERS = Object.freeze({ hit: -47.87, tink: -43.88 });
// The rules each report-only candidate fails among those this file runs
// (KILL-SOUND.md 4.3); claque's failures are all K5's (the render tool's list).
const REPORT_ONLY = Object.freeze({ os: ['K4.peak', 'body', 'centroid'] });

// A WebAudio stand-in that keeps every node and its schedule (as frisson-sounds).
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.connections = []; this.gain = new Param(1); this.frequency = new Param(350); this.Q = new Param(1); this.playbackRate = new Param(1); this.pan = new Param(0); ctx.nodes.push(this); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(time = this.ctx.currentTime, offset = 0) { this.started = true; this.startAt = time; this.offset = offset; }
  stop(time = this.ctx.currentTime) { this.stopAt = time; if (time <= this.ctx.currentTime) this.end(); }
  end() { if (!this.ended) { this.ended = true; this.onended?.(); } }
}
class Context {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 8000; this.nodes = []; this.destination = { kind: 'destination' }; }
  async resume() { this.state = 'running'; }
  createGain() { return new Node(this, 'gain'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createBufferSource() { return new Node(this, 'buffer'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createDynamicsCompressor() { const node = new Node(this, 'compressor'); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); return node; }
  createBuffer(channels, length, sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / sampleRate, length, sampleRate, numberOfChannels: channels, getChannelData: channel => data[channel] }; }
  async decodeAudioData() { return this.createBuffer(1, 8000, 8000); }
  advance(seconds) { this.currentTime += seconds; for (const node of [...this.nodes]) if (node.stopAt !== undefined && node.stopAt <= this.currentTime && !node.disconnected) node.end(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
// An unlocked engine whose groan and schedule are spied on, a seeded random,
// and a bank with these choices (the craque crack by default).
async function setup(choices = { kill: 'craque' }, { random = mulberry(11) } = {}) {
  const ctx = new Context(), log = [], timers = [];
  const engine = new SoundEngine({ contextFactory: () => ctx, random, fetcher: async () => ({ ok: false }), schedule: (callback, delay) => { timers.push(delay); return timers.length; }, cancel: () => {} });
  await engine.unlock(); await flush();
  engine.groan = volume => { log.push(['groan', volume]); };
  const create = ctx.createBufferSource.bind(ctx);
  ctx.createBufferSource = () => { const node = create(); log.push(['source', node]); return node; };
  return { engine, ctx, log, timers, bank: createSounds(engine, choices) };
}
const cracks = (ctx, from = 0) => ctx.nodes.slice(from).filter(node => node.kind === 'buffer');
const sounding = ctx => ctx.nodes.filter(node => node.kind === 'buffer' && node.startAt <= ctx.currentTime && !(node.stopAt <= ctx.currentTime));
const dB = value => 20 * Math.log10(value);
// A crack's trim: its gain over its candidate's untrimmed level for that variant
// (rendered at the buffer's own rate: 48 kHz for a candidate with variantGain).
const ownRenders = new Map();
function variantOf(made, buffer) {
  const data = buffer.getChannelData(0);
  for (let v = 0; v < made.variants; v++) {
    const key = `${made.id}:${v}:${buffer.sampleRate}`;
    if (!ownRenders.has(key)) ownRenders.set(key, render('kill', made.id, { rate: buffer.sampleRate, variant: v }));
    const own = ownRenders.get(key);
    if (own.length === data.length && own.every((value, i) => value === data[i])) return v;
  }
  return -1;
}
const trimOf = (made, node) => dB(node.connections[0].gain.value / (made.gain * KILL_BOOST * (made.variantGain?.[variantOf(made, node.buffer)] ?? 1)));

test('one kill: the zombie\'s voice, then one crack KILL_LAG later, at its measured level and a varied rate', async () => {
  assert.equal(KILL_LAG, .04);
  for (const id of NEW) {
    const { engine, ctx, log, bank } = await setup({ kill: id }), made = candidate('kill', id);
    ctx.advance(.5); const now = ctx.currentTime;
    assert.equal(bank.kill(id), true);
    assert.deepEqual(log.map(([what]) => what), ['groan', 'source'], `${id}: the voice first, as play() always did`);
    assert.equal(log[0][1], .09);
    const [crack] = cracks(ctx), [level] = crack.connections, v = variantOf(made, crack.buffer);
    assert.ok(v >= 0, `${id}: one of its six variants`);
    assert.ok(Math.abs(crack.startAt - (now + KILL_LAG)) < 1e-12, `${id}: at the lag`);
    assert.ok(Math.abs(level.gain.value - made.gain * KILL_BOOST * made.variantGain[v]) < 1e-12, `${id}: gain x variantGain`);
    const rate = crack.playbackRate.value;
    assert.ok(made.pitched ? rate === 1 : rate >= .97 && rate <= 1.03, `${id}: rate ${rate}`);
    assert.equal(level.connections[0], engine.master, 'two nodes, around the master compressor, into the master volume (the owner heard nothing through the compressor)');
  }
});

test('variants: never the same twice in a row, all six used; a head shot plays the same pool at the same level', async () => {
  for (const headshot of [false, true]) {
    const { ctx, bank } = await setup(), made = candidate('kill', 'craque'), seen = [];
    for (let i = 0; i < 200; i++) { ctx.advance(3.1); const mark = ctx.nodes.length; bank.kill('craque', headshot); seen.push(cracks(ctx, mark)[0]); }
    const buffers = seen.map(node => node.buffer);
    assert.equal(new Set(buffers).size, 6, 'six variants');
    for (let i = 1; i < buffers.length; i++) assert.notEqual(buffers[i], buffers[i - 1], `kill ${i} repeats`);
    // Rested 3 s, no heat: every crack at its variant's own level.
    for (const node of seen.slice(0, 12)) assert.ok(Math.abs(trimOf(made, node)) < 1e-9);
  }
});

test('a burst merges into one crack: five kills in one task give one source, its level, one voice', async () => {
  const { ctx, log, bank } = await setup(), made = candidate('kill', 'craque');
  for (let i = 0; i < 5; i++) assert.equal(bank.kill('craque', i === 2, 'shot', i === 3), true);
  assert.equal(cracks(ctx).length, 1);
  assert.equal(log.filter(([what]) => what === 'groan').length, 1);
  assert.ok(Math.abs(trimOf(made, cracks(ctx)[0])) < 1e-9, 'no growth: the count is the jingle\'s');
  assert.equal(cracks(ctx)[0].playbackRate.value === .95, false, 'a merged heavy kill swaps nothing');
});

test('the gap: a kill 30 ms after a crack merges, one at 80 ms chokes it at its own start; never more than two sounding', async () => {
  const { engine, ctx, bank } = await setup();
  ctx.advance(1); bank.kill('craque');
  const [first] = cracks(ctx), level = first.connections[0], gain = level.gain.value;
  ctx.advance(.03); bank.kill('craque');
  assert.equal(cracks(ctx).length, 1, '30 ms: merged');
  ctx.advance(.05); const when = ctx.currentTime + KILL_LAG; bank.kill('craque');
  assert.equal(cracks(ctx).length, 2, '80 ms: a new crack');
  const [cancel, hold, ramp] = level.gain.events;
  assert.deepEqual(cancel, ['cancel', when - .006]);
  assert.equal(hold[0], 'set'); assert.equal(hold[1], gain); assert.ok(Math.abs(hold[2] - (when - .006)) < 1e-12, 'full until 6 ms before the new start');
  assert.equal(ramp[0], 'ramp'); assert.equal(ramp[1], 0); assert.ok(Math.abs(ramp[2] - (when + .002)) < 1e-12, 'silent 2 ms after it');
  assert.ok(Math.abs(first.stopAt - (when + .007)) < 1e-12, 'stopped at +7 ms');
  // A crack the engine has stopped (a pause, a mute) is not merged into: the next kill sounds.
  ctx.advance(1); bank.kill('craque'); engine.stopSources(); ctx.advance(.01);
  let mark = ctx.nodes.length; bank.kill('craque'); assert.equal(cracks(ctx, mark).length, 1, 'after a pause');
  // A horde: a kill every 70 ms for two seconds.
  const { ctx: horde, bank: many } = await setup();
  for (let t = 0; t < 2; t += .005) {
    if (Math.round(t / .005) % 14 === 0) many.kill('craque');
    assert.ok(sounding(horde).length <= 2, `${sounding(horde).length} cracks sounding at ${t.toFixed(3)} s`);
    horde.advance(.005);
  }
});

test('merged kills add no heat: four shotgun blasts of four kills each, .85 s apart, all at their full level', async () => {
  const { ctx, bank } = await setup(), made = candidate('kill', 'craque'), trims = [];
  for (let blast = 0; blast < 4; blast++) {
    const mark = ctx.nodes.length;
    for (let pellet = 0; pellet < 4; pellet++) bank.kill('craque');
    const own = cracks(ctx, mark); assert.equal(own.length, 1, `blast ${blast}: one crack`);
    trims.push(trimOf(made, own[0])); ctx.advance(.85);
  }
  assert.deepEqual(trims.map(value => Math.round(value * 100) / 100), [0, 0, 0, 0], 'three merged kills a blast would heat it otherwise');
});

test('a head-shot kill plays the plain crack at a plain rate (fele marks the head, KF5)', async () => {
  const { ctx, bank } = await setup();
  for (let i = 0; i < 40; i++) {
    ctx.advance(3.1); const mark = ctx.nodes.length; bank.kill('craque', true);
    const rate = cracks(ctx, mark)[0].playbackRate.value;
    assert.ok(rate >= .97 && rate <= 1.03, `rate ${rate}`);
  }
});

test('a crack levelled per variant renders at 48 kHz whatever the context\'s rate; eclat renders at the context\'s', async () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const { ctx, bank } = await setup({ kill: 'craque' });
    ctx.sampleRate = sampleRate; ctx.advance(1);
    for (let i = 0; i < 40; i++) { ctx.advance(3.1); bank.kill('craque'); }
    const buffers = new Set(cracks(ctx).map(node => node.buffer));
    assert.equal(buffers.size, 6);
    for (const buffer of buffers) {
      assert.equal(buffer.sampleRate, 48000, `${sampleRate} Hz context`);
      assert.ok(variantOf(candidate('kill', 'craque'), buffer) >= 0, 'one of the measured 48 kHz renders');
    }
    const old = await setup({ kill: 'eclat' });
    old.ctx.sampleRate = sampleRate; old.ctx.advance(1); old.bank.kill('eclat');
    assert.equal(cracks(old.ctx)[0].buffer.sampleRate, sampleRate, 'eclat as he heard it');
  }
});

test('a minigun horde: 30 stream kills 33 ms apart start at most 7 cracks in any second', async () => {
  const { ctx, bank } = await setup(), starts = [];
  for (let i = 0; i < 30; i++) { const mark = ctx.nodes.length; bank.kill('craque', false, 'stream'); starts.push(...cracks(ctx, mark).map(node => node.startAt)); ctx.advance(.033); }
  for (const from of starts) assert.ok(starts.filter(at => at >= from && at < from + 1).length <= 7);
  assert.ok(starts.length >= 6);
});

test('heat: a long burst falls steadily to -6 dB plus the kind trim and no lower, and 3 s of rest bring it back', async () => {
  for (const [kind, trim] of [['shot', 0], ['stream', -4], ['melee', -6], ['blast', 0]]) {
    // 20 kills .1 s apart (a stream merges every other one: its gap is .15 s).
    const { ctx, bank } = await setup(), made = candidate('kill', 'craque'), trims = [];
    for (let i = 0; i < 20; i++) { const mark = ctx.nodes.length; bank.kill('craque', false, kind); for (const node of cracks(ctx, mark)) trims.push(trimOf(made, node)); ctx.advance(.1); }
    assert.ok(Math.abs(trims[0] - trim) < 1e-9, `${kind}: the first at ${trims[0]} dB`);
    for (let i = 1; i < trims.length; i++) assert.ok(trims[i] <= trims[i - 1] + 1e-9, `${kind}: falls`);
    assert.ok(trims.every(value => value >= trim - 6 - 1e-9 && value <= 0), `${kind}: never under the floor`);
    if (kind === 'stream') assert.equal(trims.length, 10); else assert.ok(Math.abs(trims.at(-1) - (trim - 6)) < 1e-6, `${kind}: holds at the floor (${trims.at(-1)})`);
    ctx.advance(3); const mark = ctx.nodes.length; bank.kill('craque', false, kind);
    assert.ok(Math.abs(trimOf(made, cracks(ctx, mark)[0]) - trim) < 1e-9, `${kind}: rested`);
  }
  // The brief's rafale: six kills .15 s apart trim 0, 0, 0, -0.4, -1.2, -1.9 dB.
  const { ctx, bank } = await setup(), made = candidate('kill', 'craque'), trims = [];
  for (let i = 0; i < 6; i++) { const mark = ctx.nodes.length; bank.kill('craque'); trims.push(trimOf(made, cracks(ctx, mark)[0])); ctx.advance(.15); }
  assert.deepEqual(trims.map(value => Math.round(value * 10) / 10), [0, 0, 0, -.4, -1.2, -1.9]);
});

test('a brute or boss kill only plays a little lower (rate .95); os always plays at rate 1', async () => {
  const { ctx, bank } = await setup(), made = candidate('kill', 'craque');
  bank.kill('craque', false, 'shot', true);
  assert.equal(cracks(ctx)[0].playbackRate.value, .95);
  assert.ok(Math.abs(trimOf(made, cracks(ctx)[0])) < 1e-9, 'no gain change');
  const os = await setup({ kill: 'os' });
  for (const heavy of [false, true, false]) { os.ctx.advance(1); const mark = os.ctx.nodes.length; os.bank.kill('os', false, 'shot', heavy); assert.equal(cracks(os.ctx, mark)[0].playbackRate.value, 1); }
});

test('a rocket kill waits on the visual clock for its landing: no node, no timer, one slot a rocket, then the voice and the crack', async () => {
  const { ctx, log, timers, bank } = await setup(), T = 10;
  // No frame seen yet (the audition page): it plays at once.
  assert.equal(bank.kill('craque', false, 'blast', false, .4), true);
  assert.equal(cracks(ctx).length, 1);
  ctx.advance(1); bank.land(T);
  let mark = ctx.nodes.length, groans = log.length;
  assert.equal(bank.kill('craque', false, 'blast', false, .4), true);
  assert.equal(ctx.nodes.length, mark, 'no node yet'); assert.deepEqual(timers, [], 'never a wall-clock timer'); assert.equal(log.length, groans, 'no voice yet');
  bank.land(T + .39); assert.equal(ctx.nodes.length, mark, 'not before its landing');
  bank.land(T + .41);
  assert.deepEqual(log.slice(groans).map(([what]) => what), ['groan', 'source']);
  const [crack] = cracks(ctx, mark);
  assert.ok(Math.abs(crack.startAt - (ctx.currentTime + KILL_LAG)) < 1e-12, 'the crack lands KILL_LAG after the frame that lands it');
  // A long flight is held .6 s at most.
  ctx.advance(1); bank.land(T + 2); mark = ctx.nodes.length;
  bank.kill('craque', false, 'blast', false, 2);
  bank.land(T + 2.59); assert.equal(ctx.nodes.length, mark);
  bank.land(T + 2.61); assert.equal(cracks(ctx, mark).length, 1);
  // Three kills of one rocket (splash victims at slightly different distances): one slot, one crack.
  ctx.advance(1); bank.land(T + 4); mark = ctx.nodes.length; groans = log.length;
  for (const delay of [.40, .39, .41]) bank.kill('craque', false, 'blast', true, delay);
  bank.land(T + 4.5);
  assert.equal(cracks(ctx, mark).length, 1); assert.equal(log.slice(groans).filter(([what]) => what === 'groan').length, 1);
  assert.equal(cracks(ctx, mark)[0].playbackRate.value, .95, 'a heavy kill in the slot');
  // Nine rockets in flight, 72.5 ms apart: the ring holds eight, the ninth plays at once.
  ctx.advance(1); bank.land(T + 6); mark = ctx.nodes.length;
  for (let i = 0; i < 8; i++) bank.kill('craque', false, 'blast', false, .02 + .0725 * i);
  assert.equal(ctx.nodes.length, mark);
  bank.kill('craque', false, 'blast', false, .6);
  assert.equal(cracks(ctx, mark).length, 1, 'the ninth at once');
  // A landing found too late (no frame around it) is dropped, unplayed: the
  // eight above, found 2 s late, then one found 300 ms late.
  ctx.advance(1); mark = ctx.nodes.length; bank.land(T + 8.6);
  assert.equal(ctx.nodes.length, mark, 'the eight dropped');
  bank.kill('craque', false, 'blast', false, .2);
  bank.land(T + 9.1); assert.equal(ctx.nodes.length, mark, 'dropped 300 ms late');
  // Leaving the room empties the ring.
  bank.land(T + 10); bank.kill('craque', false, 'blast', false, .2); bank.stop();
  mark = ctx.nodes.length; bank.land(T + 10.21); bank.land(T + 10.3);
  assert.equal(ctx.nodes.length, mark);
});

test('one rocket\'s kills share one slot that lands with its nearest victim, keep any heavy kill, and a dozen never spill out', async () => {
  const { ctx, log, bank } = await setup(), T = 20;
  // The far victim's event first, then a nearer one (the server's order): the
  // crack lands with the nearer one's cue, where its chain asks for the jingle.
  ctx.advance(1); bank.land(T); let mark = ctx.nodes.length;
  bank.kill('craque', false, 'blast', false, .40); bank.kill('craque', false, 'blast', false, .38);
  bank.land(T + .385); assert.equal(cracks(ctx, mark).length, 1, 'landed with the nearer victim');
  bank.land(T + .41); assert.equal(cracks(ctx, mark).length, 1, 'once');
  // A plain kill first, a heavy one merged after it: the slot plays heavy.
  ctx.advance(1); bank.land(T + 2); mark = ctx.nodes.length;
  bank.kill('craque', false, 'blast', false, .3); bank.kill('craque', false, 'blast', true, .31);
  bank.land(T + 2.4); assert.equal(cracks(ctx, mark)[0].playbackRate.value, .95);
  // Twelve victims of one rocket: no node until it lands, then one voice and one crack.
  ctx.advance(1); bank.land(T + 4); mark = ctx.nodes.length; const groans = log.length;
  for (let i = 0; i < 12; i++) bank.kill('craque', false, 'blast', false, .4 + (i % 5 - 2) * .005);
  assert.equal(ctx.nodes.length, mark, 'none at launch');
  bank.land(T + 4.5);
  assert.equal(cracks(ctx, mark).length, 1); assert.equal(log.slice(groans).filter(([what]) => what === 'groan').length, 1);
  // stop() forgets the clock too: a rocket kill then plays at once, as with no frame seen.
  bank.stop(); mark = ctx.nodes.length; bank.kill('craque', false, 'blast', false, .4);
  assert.equal(cracks(ctx, mark).length, 1);
});

test('when the client\'s phase turns, held kills follow its rocket cues: at once at the extraction, dropped at a countdown, a victory or a game over', async () => {
  const T = 30;
  for (const phase of ['extraction', 'countdown', 'victory', 'gameover', 'intermission', 'wave']) {
    const { ctx, bank } = await setup();
    ctx.advance(1); bank.land(T, 'wave');
    let mark = ctx.nodes.length;
    bank.kill('craque', false, 'blast', false, .4); bank.kill('craque', false, 'blast', false, .2);
    bank.land(T + .05, phase);
    const now = ctx.currentTime, played = cracks(ctx, mark), keeps = phase === 'intermission' || phase === 'wave';
    if (phase === 'extraction') {
      assert.equal(played.length, 1, 'both land at once, merged');
      assert.ok(Math.abs(played[0].startAt - (now + KILL_LAG)) < 1e-12);
    } else assert.equal(played.length, 0, `${phase}: nothing at the turn`);
    mark = ctx.nodes.length; bank.land(T + .3, phase); ctx.advance(.3); bank.land(T + .5, phase);
    assert.equal(cracks(ctx, mark).length, keeps ? 2 : 0, `${phase}: ${keeps ? 'each at its landing' : 'gone'}`);
    // The same phase again turns nothing: a rocket fired in it lands as usual.
    ctx.advance(1); mark = ctx.nodes.length; bank.kill('craque', false, 'blast', false, .3);
    bank.land(T + .6, phase); assert.equal(ctx.nodes.length, mark);
    bank.land(T + .81, phase); assert.equal(cracks(ctx, mark).length, 1);
  }
});

test('install\'s frame hook lands held kills from the visual clock the client passes', async () => {
  const ctx = new Context(), engine = new SoundEngine({ contextFactory: () => ctx, random: mulberry(3), fetcher: async () => ({ ok: false }) }), hooks = {};
  await engine.unlock(); await flush();
  const pack = await install({ sound: engine, hooks }, { kill: 'craque' });
  engine.groan = () => {};
  hooks.frame({ delta: .016, time: 5, self: null, snapshot: null });
  const mark = ctx.nodes.length;
  engine.kill(false, 'blast', false, .3);
  assert.equal(ctx.nodes.length, mark);
  hooks.frame({ delta: .016, time: 5.2, self: null, snapshot: null }); assert.equal(ctx.nodes.length, mark);
  hooks.frame({ delta: .016, time: 5.31, self: null, snapshot: null }); assert.equal(cracks(ctx, mark).length, 1);
  // The snapshot's phase reaches land(): a game over drops a rocket still in flight.
  ctx.advance(1); hooks.frame({ delta: .016, time: 6, self: null, snapshot: { phase: 'wave' } });
  engine.kill(false, 'blast', false, .3); const before = ctx.nodes.length;
  hooks.frame({ delta: .016, time: 6.1, self: null, snapshot: { phase: 'gameover' } });
  hooks.frame({ delta: .016, time: 6.4, self: null, snapshot: { phase: 'gameover' } });
  assert.equal(ctx.nodes.length, before, 'dropped with its blast');
  // Without the phase turning, the same rocket lands.
  ctx.advance(1); hooks.frame({ delta: .016, time: 7, self: null, snapshot: { phase: 'gameover' } });
  engine.kill(false, 'blast', false, .3); hooks.frame({ delta: .016, time: 7.31, self: null, snapshot: { phase: 'gameover' } });
  assert.equal(cracks(ctx, before).length, 1);
  pack.uninstall();
});

test('the jingle starts on the crack, never before it; with no kill sound chosen it is lot 1\'s', async () => {
  const { ctx, bank } = await setup({ kill: 'craque', chain: 'mineur' });
  ctx.advance(1); bank.kill('craque');
  const [crack] = cracks(ctx);
  ctx.advance(.01); let mark = ctx.nodes.length; bank.chain('mineur', 2);
  const [first] = cracks(ctx, mark);
  assert.ok(Math.abs(first.startAt - crack.startAt) < 1e-12, 'on the pending crack');
  // A rocket's chain: flushed before the frame lands its crack, so at now + KILL_LAG.
  ctx.advance(2); mark = ctx.nodes.length; bank.chain('mineur', 3);
  const [second] = cracks(ctx, mark);
  assert.ok(Math.abs(second.startAt - (ctx.currentTime + KILL_LAG)) < 1e-12);
  // A later jingle chokes the one before at its own start, 30 ms, scheduled.
  ctx.advance(.1); const at = ctx.currentTime + KILL_LAG; mark = ctx.nodes.length; bank.chain('mineur', 4);
  const events = second.connections[0].gain.events;
  assert.deepEqual(events[0], ['cancel', at]); assert.equal(events[1][0], 'set'); assert.ok(Math.abs(events[2][2] - (at + .03)) < 1e-12);
  assert.ok(Math.abs(second.stopAt - (at + .035)) < 1e-12);
  // A crack started within the gap: the jingle starts at once, on it.
  ctx.advance(2); bank.kill('craque'); ctx.advance(.06); mark = ctx.nodes.length; bank.chain('mineur', 2);
  assert.ok(Math.abs(cracks(ctx, mark)[0].startAt - ctx.currentTime) < 1e-12);
  // Two counts on one pending crack (a minigun horde): the first rung never
  // starts, the second starts alone on the crack.
  ctx.advance(2); mark = ctx.nodes.length; bank.kill('craque'); const [lone] = cracks(ctx, mark);
  mark = ctx.nodes.length; bank.chain('mineur', 2); const [two] = cracks(ctx, mark);
  ctx.advance(.016); mark = ctx.nodes.length; bank.chain('mineur', 3); const [three] = cracks(ctx, mark);
  assert.ok(Math.abs(two.startAt - lone.startAt) < 1e-12 && Math.abs(three.startAt - lone.startAt) < 1e-12);
  assert.ok(two.stopAt <= two.startAt + 1e-12, 'the first rung stopped at its own start');
  assert.deepEqual(two.connections[0].gain.events, [], 'no ramp: it never sounds');
  // No kill sound chosen: now, with lot 1's choke.
  const plain = await setup({ chain: 'mineur' });
  plain.ctx.advance(1); plain.bank.chain('mineur', 2); const [one] = cracks(plain.ctx);
  assert.equal(one.startAt, plain.ctx.currentTime);
  plain.ctx.advance(.1); const now = plain.ctx.currentTime; plain.bank.chain('mineur', 3);
  assert.deepEqual(one.connections[0].gain.events, [['hold', now], ['ramp', 0, now + .03]]);
});

test('a kill is never refused: its voices are not the one-shots\', state() counts them, stop() silences them', async () => {
  const { ctx, bank } = await setup({ kill: 'craque', hit: 'mouille' });
  for (let i = 0; i < 12; i++) { bank.play('hit', 'mouille'); ctx.currentTime += .04; }
  let mark = ctx.nodes.length; bank.play('hit', 'mouille'); assert.equal(cracks(ctx, mark).length, 0, 'the one-shots are full');
  mark = ctx.nodes.length; assert.equal(bank.kill('craque'), true); assert.equal(cracks(ctx, mark).length, 1, 'a kill still plays');
  assert.equal(bank.state().voices, 13);
  ctx.advance(1); assert.equal(bank.state().voices, 0);
  mark = ctx.nodes.length; bank.kill('craque'); ctx.advance(.02);
  assert.equal(bank.play('hit', 'mouille'), true); assert.equal(cracks(ctx, mark).length, 2, 'a hit is not refused by kills');
  // Stopped before it starts: it never sounds.
  mark = ctx.nodes.length; ctx.advance(.2); bank.kill('craque'); const [pending] = cracks(ctx, mark);
  bank.stop();
  assert.ok(pending.stopAt <= ctx.currentTime && pending.stopAt < pending.startAt + 1e-9, 'stopped before its start');
  ctx.advance(.05); assert.equal(bank.state().voices, 0); assert.deepEqual(sounding(ctx), []);
});

test('off or muted: no context, no node', async () => {
  let made = 0;
  const ctx = new Context(), engine = new SoundEngine({ contextFactory: () => { made++; return ctx; }, random: () => .5, fetcher: async () => ({ ok: false }) });
  const bank = createSounds(engine, { kill: 'craque' });
  for (const id of CANDIDATES.kill.map(one => one.id)) { assert.equal(bank.kill(id), false); assert.equal(bank.play('kill', id), false); }
  bank.land(1); assert.equal(bank.kill('craque', false, 'blast', false, .3), false);
  engine.setStyle(bank.style); engine.kill(true, 'blast', true, .3); engine.kill();
  assert.equal(made, 0); assert.equal(ctx.nodes.length, 0);
  const muted = await setup(); muted.engine.setVolume(0); const mark = muted.ctx.nodes.length;
  muted.engine.setStyle(muted.bank.style); muted.engine.kill(); assert.equal(muted.bank.kill('craque'), false);
  assert.equal(muted.ctx.nodes.length, mark);
});

test('the old candidates go through the player too: three variants, at their own gain', async () => {
  for (const id of ['eclat', 'pixel']) {
    const { ctx, bank } = await setup({ kill: id }), made = candidate('kill', id), buffers = new Set();
    assert.equal(made.variants, 3); assert.equal(made.variantGain, undefined);
    for (let i = 0; i < 30; i++) { ctx.advance(3.1); const mark = ctx.nodes.length; assert.equal(bank.play('kill', id), true); const [crack] = cracks(ctx, mark); buffers.add(crack.buffer); assert.ok(Math.abs(crack.connections[0].gain.value - made.gain * KILL_BOOST) < 1e-12); }
    assert.equal(buffers.size, 3);
  }
});

// ---- Measured on the renders (tools/frisson-sound-analysis.mjs) -----------

const RENDERS = new Map(NEW.map(id => [id, Array.from({ length: 6 }, (_, variant) => Float64Array.from(render('kill', id, { variant })))]));
const FELE = CANDIDATES.headshot.find(made => made.id === 'fele');

test('the pinned tiers are audio.js\'s own (the hit thud over 5 seeded renders, the tink)', async () => {
  const hits = await Promise.all([0, 1, 2, 3, 4].map(async seed => levels(await offlineRender(engineClass(AUDIO, 20261013 + seed), engine => engine.hit(), .3)).k));
  assert.ok(Math.abs(hits.reduce((a, b) => a + b) / 5 - TIERS.hit) <= .011);
  assert.ok(Math.abs(levels(await offlineRender(engineClass(AUDIO), engine => engine.headshot(), .3)).k - TIERS.tink) <= .011);
});

test('each new crack is built as the brief says: six variants, a variantGain each, only os pitched', () => {
  for (const id of NEW) {
    const made = candidate('kill', id);
    assert.match(id, /^[a-z]+$/); assert.equal(made.variants, 6); assert.equal(made.variantGain.length, 6);
    assert.ok(made.variantGain.every(value => value > .5 && value < 2)); assert.equal(made.highpass, 40); assert.equal(made.voice, .09);
    assert.equal(made.pitched === true, id === 'os');
    assert.ok(made.seconds <= KILL_K.length);
  }
  assert.deepEqual(CANDIDATES.kill.map(made => made.id), [...NEW, 'eclat', 'pixel'], 'the new cracks first, then the owner\'s eclat and pixel');
});

test('the analysis rules and K1, K3, K4, K8: every crack passes, a report-only one fails exactly its listed rules', async () => {
  const fele = Math.max(...[0, 1, 2].map(variant => levels(scaled(render('headshot', 'fele', { variant }), FELE.gain)).k));
  for (const id of NEW) {
    const made = candidate('kill', id), renders = RENDERS.get(id), rules = killRules(made, renders, [TIERS.hit, TIERS.tink, fele]), failed = new Set(rules.failed);
    const raf = await killRafale(engineClass(AUDIO), createSounds, made, renders.map(data => Float32Array.from(data)));
    if (!(levels(raf.data).k <= rules.k + KILL_K.rafaleOver)) failed.add('K8.k');
    if (!(shortTerm(raf.data) <= rules.k)) failed.add('K8.mean');
    const sixth = raf.trims[5] - raf.trims[0];
    if (!(sixth >= KILL_K.sixth[0] && sixth <= KILL_K.sixth[1])) failed.add('K8.sixth');
    assert.deepEqual([...failed].sort(), REPORT_ONLY[id] ?? [], `${id}: ${JSON.stringify(rules.rows.map(row => ({ k: row.k.toFixed(2), peak: row.peak.toFixed(1), centroid: Math.round(row.centroid), body: row.body.toFixed(1) })))}`);
  }
});

test('every crack renders the same twice, ends at zero, and renders within the frame budget', () => {
  for (const id of NEW) for (let variant = 0; variant < 6; variant++) {
    const data = render('kill', id, { variant });
    assert.deepEqual(render('kill', id, { variant }), data);
    assert.ok(data.at(-1) === 0, `${id} ${variant} ends at zero`);
    // The render's own cost: the fastest of five, since npm test runs the test
    // files side by side and a busy machine can stall any one render (18 ms
    // once, against 1.3-4 ms alone). The render tool times the slowest of five
    // on a quiet machine, and Edge's render-time page the first render.
    let fastest = Infinity;
    for (let i = 0; i < 5; i++) { const t = performance.now(); render('kill', id, { variant }); fastest = Math.min(fastest, performance.now() - t); }
    assert.ok(fastest <= KILL_K.renderMs, `${id} ${variant}: ${fastest.toFixed(1)} ms`);
  }
});

test('Famille\'s clacs (Part B): one line picks one, each gentle (B1), clean and under 3 kHz (B3)', async () => {
  const line = /^const FAMILLE_KILL=(null|'(bois|pop|tac)');/m.exec(AUDIO);
  assert.ok(line, 'FAMILLE_KILL is one line: null or a clac');
  const Engine = engineClass(AUDIO), floor = Math.max(KILL_K.famille.k[0], TIERS.tink + KILL_K.famille.overTink);
  for (const id of ['bois', 'pop', 'tac']) {
    const calls = clacCalls(Engine, id);
    assert.ok(calls.length >= 3, id);
    for (const [kind, ...args] of calls) {
      assert.ok((kind === 'noise' ? args[4] : args[5]) >= .04 - 1e-12, `${id}: 40 ms after the shot`);
      if (kind === 'noise') assert.ok(args[2] <= KILL_K.famille.maxHz, `${id}: a band at ${args[2]} Hz`);
      else if (args[4] === 'sine') assert.ok(Math.max(args[0], args[1]) <= KILL_K.famille.maxHz, `${id}: a sine at ${args[0]} Hz`);
      else { assert.equal(args[4], 'triangle'); assert.ok(Math.max(args[0], args[1]) <= KILL_K.famille.triangleHz, `${id}: a triangle at ${args[0]} Hz`); }
    }
    const data = await Promise.all([0, 1, 2, 3, 4].map(seed => offlineRender(engineClass(AUDIO, 20261013 + seed), engine => engine.clac(id), .4)));
    const k = data.reduce((sum, x) => sum + levels(x).k, 0) / 5;
    assert.ok(k >= floor - .01 && k <= KILL_K.famille.k[1], `${id}: M_K ${k.toFixed(2)} (B1)`);
    assert.ok(Math.max(...data.map(peakDb)) <= KILL_K.famille.peak, `${id}: peak (B3)`);
  }
});
