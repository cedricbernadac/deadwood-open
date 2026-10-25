import test from 'node:test';
import assert from 'node:assert/strict';
import { runStairPath } from '../validation/stair-trap-paths.mjs';

test('an ordinary approach, edge jump and crouch used to trap the survivor but now allow a normal side escape', () => {
  for (const id of ['west-jump', 'east-jump']) for (const hz of [30, 10]) {
    const before = runStairPath(id, { hz, legacy: true });
    assert.ok(before.invalidSamples > 0, `${id},${hz}: reproduce the old wood penetration`);
    assert.ok(before.escapeDistance < .001, `${id},${hz}: even side input used to remain blocked`);
    const after = runStairPath(id, { hz });
    assert.equal(after.invalidSamples, 0, `${id},${hz}: no airborne feet penetrate a tread`);
    assert.ok(after.escapeDistance > 1, `${id},${hz}: ordinary input frees the survivor`);
    assert.equal(after.end.y, 0);
    assert.equal(after.end.grounded, true);
    assert.equal(after.end.crouched, false);
    assert.equal(after.end.hp, 100);
  }
});

test('standing and crouched survivors descend either side from several real steps with pistol or minigun at30/10Hz', () => {
  let trials = 0;
  for (const id of ['west-descent', 'east-descent']) for (const hz of [30, 10]) {
    for (const weapon of ['pistol', 'minigun']) for (const crouch of [false, true]) for (const startZ of [-1.2, -.4, .4, 1.2]) {
      const result = runStairPath(id, { hz, weapon, crouch, startZ });
      const label = `${id},${hz},${weapon},crouch=${crouch},z=${startZ}`;
      assert.ok(result.samples[result.contact].y > 0, `${label}: climb first using actual movement`);
      assert.equal(result.invalidSamples, 0, `${label}: neither gravity nor a posture change inserts the body into wood`);
      assert.ok(result.escapeDistance > .8, `${label}: the survivor really leaves the stairs`);
      assert.equal(result.end.y, 0, label);
      assert.equal(result.end.grounded, true, label);
      assert.equal(result.end.crouched, false, label);
      assert.equal(result.end.hp, 100, label);
      for (let index = 1; index < result.samples.length; index++) {
        const a = result.samples[index - 1], b = result.samples[index];
        assert.ok(Math.hypot(b.x - a.x, b.z - a.z) <= 5.4 / hz + 1e-8, `${label}: no escape teleport`);
      }
      trials++;
    }
  }
  assert.equal(trials, 64);
});
