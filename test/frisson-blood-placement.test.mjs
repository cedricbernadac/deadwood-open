import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublicModule } from './helpers/public-modules.mjs';

const { install, SPLATS } = await importPublicModule('frisson/blood.js');

const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// A document stand-in: canvases record their 2D calls (as frisson-blood.test.mjs).
function fakeDocument({ width = 1920, height = 1080 } = {}) {
  const body = {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; },
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; return node; },
  };
  const pen = () => ({
    calls: [], globalAlpha: 1, fillStyle: '#000', imageSmoothingEnabled: true,
    clearRect(...args) { this.calls.push(['clearRect', ...args]); },
    fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); },
    drawImage(image, x, y) { this.calls.push(['drawImage', image, x, y, this.globalAlpha]); },
  });
  return {
    body, defaultView: { innerWidth: width, innerHeight: height },
    createElement(tag) {
      const canvas = { tag, width: 300, height: 150, style: {}, parentNode: null,
        setAttribute() {},
        getContext(kind) { return kind === '2d' ? (this.pen ??= pen()) : null; },
        remove() { this.parentNode?.removeChild(this); } };
      return canvas;
    },
  };
}

// The HUD keep-out zones, grown by half a sprite in x as placeSplat grows them.
const MARGIN = SPLATS.sprite / 2 / SPLATS.width;
const onHud = (fx, fy) =>
  fx < .34 + MARGIN && fy > .68 ||
  fx > .72 - MARGIN && fy > .56 ||
  fx > .36 - MARGIN && fx < .64 + MARGIN && fy < .36;

test('hurt splats never cover the HUD: 1,000 seeded rolls keep their centre out of the grown zones', async () => {
  const document = fakeDocument(), hooks = {};
  const handle = await install({ scene: null, hooks, quality: 'high', random: seeded(20261014), document, base: '/frisson/' });
  const overlay = document.body.children[0];
  assert.equal(overlay.width, SPLATS.width);
  let placements = 0;
  for (let roll = 0; roll < 1000; roll++) {
    hooks.hurt({ amount: 6, hp: 80, maxHp: 100, source: 'zombie' });
    hooks.frame({ delta: SPLATS.spacing + .01 });
    const calls = overlay.pen.calls, last = calls.findLastIndex(call => call[0] === 'clearRect');
    const fresh = calls.slice(last + 1).filter(call => call[0] === 'drawImage');
    assert.ok(fresh.length > 0, `roll ${roll}: a splat was placed`);
    for (const [, , x, y] of fresh) {
      const fx = (x + SPLATS.sprite / 2) / overlay.width, fy = (y + SPLATS.sprite / 2) / overlay.height;
      assert.ok(!onHud(fx, fy), `roll ${roll}: centre (${fx.toFixed(3)}, ${fy.toFixed(3)}) on the HUD`);
    }
    placements += fresh.length;
  }
  assert.ok(placements >= 1000, `${placements} placements checked`);
  handle.uninstall();
});

test('a splat whose eight rolls all land on the HUD falls back to a side strip in the free band', async () => {
  // A constant .72 rolls the top-centre band, inside the wave panel zone.
  const document = fakeDocument(), hooks = {};
  const handle = await install({ scene: null, hooks, quality: 'high', random: () => .72, document, base: '/frisson/' });
  const overlay = document.body.children[0];
  hooks.hurt({ amount: 6, hp: 80, maxHp: 100, source: 'zombie' });
  hooks.frame({ delta: 1 / 60 });
  const calls = overlay.pen.calls, last = calls.findLastIndex(call => call[0] === 'clearRect');
  const draws = calls.slice(last + 1).filter(call => call[0] === 'drawImage');
  assert.equal(draws.length, 1);
  const x = draws[0][2] + SPLATS.sprite / 2, y = draws[0][3] + SPLATS.sprite / 2;
  assert.ok(x >= 2 && x <= 26 || x >= overlay.width - 26 && x <= overlay.width - 2, `fallback x ${x}`);
  const fy = y / overlay.height;
  assert.ok(fy >= .36 && fy <= .62, `fallback fy ${fy}`);
  assert.ok(!onHud(x / overlay.width, fy), 'the fallback itself stays clear');
  handle.uninstall();
});
