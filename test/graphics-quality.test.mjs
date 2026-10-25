import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRAPHICS_QUALITY_KEY, GRAPHICS_QUALITY_CHOICES, GRAPHICS_PRESETS,
  normalizeGraphicsQuality, autoGraphicsPresetId, resolveGraphicsPreset,
  readGraphicsQuality, saveGraphicsQuality, createPixelRatioGovernor,
} from '../public/graphics-quality.js';

test('normalization accepts only the four choices and falls back to auto', () => {
  assert.deepEqual(GRAPHICS_QUALITY_CHOICES, ['auto', 'low', 'medium', 'high']);
  for (const choice of GRAPHICS_QUALITY_CHOICES) assert.equal(normalizeGraphicsQuality(choice), choice);
  for (const value of [undefined, null, '', 'LOW', 'ultra', 0, 1, {}, [], 'auto ']) assert.equal(normalizeGraphicsQuality(value), 'auto', String(value));
});

test('auto heuristics: software renderers are low before any other hint', () => {
  for (const gpu of ['Google SwiftShader', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'softpipe', 'Microsoft Basic Render Driver', 'some software rasterizer']) {
    assert.equal(autoGraphicsPresetId({ gpu, deviceMemory: 16 }), 'low', gpu);
  }
});

test('auto heuristics: 4 GB of device memory or less is low', () => {
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', deviceMemory: 4 }), 'low');
  assert.equal(autoGraphicsPresetId({ gpu: '', deviceMemory: 2 }), 'low');
  assert.equal(autoGraphicsPresetId({ gpu: '', deviceMemory: 8 }), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: '', deviceMemory: '4' }), 'medium', 'only a real number triggers the memory rule');
});

test('auto heuristics: weak integrated and mobile GPUs are low', () => {
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'low');
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'low');
  for (const gpu of ['Mali-G52 MC2', 'Adreno (TM) 640', 'PowerVR Rogue GE8320', 'VideoCore VI']) assert.equal(autoGraphicsPresetId({ gpu }), 'low', gpu);
});

test('auto heuristics: other integrated GPUs are medium', () => {
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: 'AMD Radeon Graphics (Vega 8)' }), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: 'Apple M2' }), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: 'Apple GPU' }), 'medium');
});

test('auto heuristics: discrete GPUs are high, everything unknown is medium', () => {
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'high');
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'high');
  assert.equal(autoGraphicsPresetId({ gpu: 'NVIDIA Quadro T1000' }), 'high');
  assert.equal(autoGraphicsPresetId({ gpu: 'ANGLE (Intel, Arc A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }), 'high');
  assert.equal(autoGraphicsPresetId({ gpu: 'GTX 1660 SUPER' }), 'high');
  assert.equal(autoGraphicsPresetId({ gpu: '' }), 'medium');
  assert.equal(autoGraphicsPresetId(), 'medium');
  assert.equal(autoGraphicsPresetId({ gpu: 'Some Unrecognized Accelerator' }), 'medium');
});

test('resolveGraphicsPreset freezes a full preset tagged with the normalized choice', () => {
  const auto = resolveGraphicsPreset('auto', { gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' });
  assert.equal(auto.id, 'high'); assert.equal(auto.choice, 'auto'); assert.ok(Object.isFrozen(auto));
  const manual = resolveGraphicsPreset('low');
  assert.equal(manual.id, 'low'); assert.equal(manual.choice, 'low');
  assert.equal(manual.pixelRatio, GRAPHICS_PRESETS.low.pixelRatio);
  assert.equal(resolveGraphicsPreset('nonsense').choice, 'auto');
});

test('presets and the choice list are frozen', () => {
  assert.ok(Object.isFrozen(GRAPHICS_PRESETS));
  for (const preset of Object.values(GRAPHICS_PRESETS)) assert.ok(Object.isFrozen(preset), preset.id);
  assert.throws(() => { GRAPHICS_PRESETS.low.pixelRatio = 99; }, TypeError);
});

test('storage read normalizes, and missing, invalid or blocked storage means auto', () => {
  const storage = value => ({ getItem: () => value });
  assert.equal(readGraphicsQuality(storage('high')), 'high');
  assert.equal(readGraphicsQuality(storage(null)), 'auto');
  assert.equal(readGraphicsQuality(storage('ultra')), 'auto');
  assert.equal(readGraphicsQuality(undefined), 'auto');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readGraphicsQuality(blocked), 'auto');
});

test('storage write persists the normalized choice and reports success', () => {
  const writes = [];
  const storage = { setItem(key, value) { writes.push([key, value]); } };
  assert.equal(saveGraphicsQuality(storage, 'medium'), true);
  assert.equal(saveGraphicsQuality(storage, 'ULTRA'), true);
  assert.deepEqual(writes, [[GRAPHICS_QUALITY_KEY, 'medium'], [GRAPHICS_QUALITY_KEY, 'auto']]);
  assert.equal(saveGraphicsQuality({ setItem() { throw new Error('blocked'); } }, 'low'), false);
  assert.equal(saveGraphicsQuality(undefined, 'low'), false);
});

const feed = (governor, seconds, count) => {
  let changed = 0;
  for (let index = 0; index < count; index++) if (governor.sample(seconds)) changed++;
  return changed;
};

test('governor starts at the capped pixel ratio and lowers it under sustained slow frames', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.high, 2);
  assert.equal(governor.ratio, 1.5);
  for (let index = 0; index < 133; index++) assert.equal(governor.sample(.03), false, `no change before 4 slow seconds (${index})`);
  assert.equal(governor.sample(.03), true, 'the 4th cumulative slow second lowers the ratio');
  assert.equal(governor.ratio, 1.4);
});

// A GPU-bound machine: frame time follows the number of pixels drawn.
const feedGpu = (governor, base, start, count) => {
  let changes = 0;
  for (let index = 0; index < count; index++) if (governor.sample(base * (governor.ratio / start) ** 2)) changes++;
  return changes;
};

test('governor respects the cooldown, then keeps stepping down to the minimum and never below', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.high, 2);
  feedGpu(governor, .06, 1.5, 70); // First drop: 1.5 -> 1.4.
  assert.equal(governor.ratio, 1.4);
  assert.equal(feedGpu(governor, .06, 1.5, 50), 0, 'no change during the 3 s cooldown');
  assert.equal(governor.ratio, 1.4);
  assert.ok(feedGpu(governor, .06, 1.5, 200) > 0, 'slow frames after the cooldown lower the ratio again');
  feedGpu(governor, .06, 1.5, 6000);
  assert.equal(governor.ratio, .9, 'sustained slow frames settle at the high preset minimum');
  assert.equal(feed(governor, .03, 1000), 0, 'the minimum is a floor');
  assert.equal(governor.ratio, .9);
});

test('governor undoes a drop that did not speed frames up (a 30 Hz cap) and stops adapting', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.high, 2);
  feed(governor, 1 / 30, 134);
  assert.equal(governor.ratio, 1.4, 'it tries a lower resolution');
  feed(governor, 1 / 30, 200);
  assert.equal(governor.ratio, 1.5, 'no gain: the sharp picture comes back');
  assert.equal(feed(governor, 1 / 30, 3000), 0, 'and it stops trying');
  assert.equal(governor.ratio, 1.5);
});

test('governor raises the ratio under sustained fast frames and never above the starting cap', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.low, 1);
  assert.equal(governor.ratio, 1);
  feedGpu(governor, .045, 1, 3000); // A GPU-bound drop to the .7 floor.
  assert.equal(governor.ratio, .7);
  for (let index = 0; index < 200; index++) governor.sample(.016); // EMA crosses below 1/57 s.
  let changes = 0;
  for (let index = 0; index < 2000; index++) if (governor.sample(.016)) changes++;
  assert.ok(changes > 0, 'fast frames raise the ratio again');
  feed(governor, .016, 20000);
  assert.equal(governor.ratio, 1, 'the starting cap is a ceiling');
});

test('governor ignores non-finite and oversized samples without touching its state', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.medium, 1.25);
  assert.equal(governor.ratio, 1.25);
  for (const sample of [NaN, Infinity, -Infinity, .6, 2, -0.1, 0]) assert.equal(governor.sample(sample), false, String(sample));
  for (let index = 0; index < 100; index++) governor.sample(.03); // 3 slow seconds: not enough yet.
  assert.equal(governor.sample(NaN), false);
  assert.equal(governor.sample(10), false);
  for (let index = 0; index < 33; index++) governor.sample(.03);
  assert.equal(governor.sample(.03), true, 'outliers did not count toward the 4 slow seconds');
  assert.equal(governor.ratio, 1.15);
});

test('governor honors the device pixel ratio cap when it is below the preset ceiling', () => {
  const governor = createPixelRatioGovernor(GRAPHICS_PRESETS.high, 1.2);
  assert.equal(governor.ratio, 1.2);
  feed(governor, .016, 40000);
  assert.equal(governor.ratio, 1.2, 'fast frames never exceed the device cap');
  const fallback = createPixelRatioGovernor(GRAPHICS_PRESETS.low, 0);
  assert.equal(fallback.ratio, 1, 'a missing device ratio means 1');
});
