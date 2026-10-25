import test from 'node:test';
import assert from 'node:assert/strict';
import { runOptionalLevelsSmoke } from '../validation/optional-levels-smoke.mjs';

test('one ephemeral gateway preserves independent cabin and optional cellar nights', { timeout: 90000 }, async () => {
  const { createOnlineGateway } = await import('../online-gateway.mjs');
  const gateway = await createOnlineGateway({ port: 0, host: '127.0.0.1' });
  try {
    const address = await gateway.listen();
    assert.ok(address.port > 0 && ![3002, 3013].includes(address.port));
    const result = await runOptionalLevelsSmoke({ origin: `http://127.0.0.1:${address.port}` });
    assert.equal(result.passed, true, JSON.stringify({ failed: result.checks.filter(check => !check.passed), error: result.error, cleanup: result.after }, null, 2));
    assert.ok(result.checks.length >= 25);
  } finally { await gateway.close(); }
});
