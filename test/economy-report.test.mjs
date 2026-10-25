import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeRevenue, purchaseThreshold, economyReport } from '../validation/economy-report.mjs';
import { ARMORY } from '../public/rules.js';

test('the cash forecast accounts for every normal, brute and boss with a single shared reward', () => {
  for (const [players, wave, kills, body, heads] of [
    [1, 1, 8, 144, 192], [1, 5, 82, 1560, 2100], [1, 20, 1441, 27322, 36756],
    [4, 1, 21, 378, 504], [4, 5, 227, 4170, 5580], [4, 20, 4728, 86488, 115644],
  ]) {
    const bodyRevenue = cumulativeRevenue(wave, players, false);
    const headRevenue = cumulativeRevenue(wave, players, true);
    assert.equal(bodyRevenue.kills, kills);
    assert.equal(headRevenue.kills, kills);
    assert.equal(bodyRevenue.after, body);
    assert.equal(headRevenue.after, heads);
    assert.equal(headRevenue.afterPerPerson * players, heads, 'Planning division must not multiply the shared world money');
  }
  // Preserve the historical first twenty waves, rather than applying the
  // compressed health, crowd or head bonus to the named b72fb8a baseline.
  for (const [players, beforeKills, body, heads] of [[1, 721, 169090, 139840], [4, 2189, 495240, 405630]]) {
    assert.equal(cumulativeRevenue(20, players, false).beforeKills, beforeKills);
    assert.equal(cumulativeRevenue(20, players, false).before, body);
    assert.equal(cumulativeRevenue(20, players, true).before, heads);
    assert.deepEqual(cumulativeRevenue(30, players, false), cumulativeRevenue(20, players, false), 'No phantom waves or repeated final bosses beyond extraction');
  }
  assert.equal(cumulativeRevenue(1, 1, true).extraCrowdCashPercent, 0);
});

test('cash thresholds retain their forecast independently of prices, spent cash and wave locks', () => {
  for (const [cost, soloBody, soloHeads, fourBody, fourHeads] of [
    [650, 4, 3, 4, 4], [1500, 5, 5, 7, 6], [4500, 9, 8, 11, 10], [6000, 11, 9, 12, 11],
  ]) {
    for (const [players, heads, expected] of [[1, false, soloBody], [1, true, soloHeads], [4, false, fourBody], [4, true, fourHeads]]) {
      assert.equal(purchaseThreshold(cost, players, heads), expected);
      assert.ok(cumulativeRevenue(expected, players, heads).afterPerPerson >= cost);
      assert.ok(cumulativeRevenue(expected - 1, players, heads).afterPerPerson < cost);
    }
  }
  assert.equal(purchaseThreshold(1, 1, true, { unlockWave: 8 }), 8, 'Even plentiful cash cannot bypass a bonus wave gate');
  assert.equal(purchaseThreshold(1800, 4, true, { spent: 1750, unlockWave: 8 }), 9,
    'A prior shotgun and assault purchase postpones the machine gun beyond its unlock');
  assert.equal(purchaseThreshold(1800, 4, true, { spent: 350, unlockWave: 8 }), 8,
    'A cheaper route has a distinct remaining budget');
  assert.equal(purchaseThreshold(1e9, 4, true), null, 'Never invent a purchase after extraction');
  assert.throws(() => purchaseThreshold(350, 4, true, { spent: -1 }), TypeError);
});

test('the paid headshot route starts with pistol, buys shotgun first and respects every later gate and spent cost', () => {
  const report = economyReport();
  assert.equal(report.earlyHeadRoute.length, 19);
  for (const row of report.earlyHeadRoute) {
    assert.equal(row.remaining, 0, `${row.players} players, wave ${row.wave}, weapons ${row.weapons}`);
    assert.ok(row.ammoLeft > 0);
    assert.equal(row.seed, 17);
    assert.equal(row.dispersion, 'seeded production cone');
    assert.ok(row.weapons.length <= 2);
    for (const weapon of row.weapons) {
      const rack = ARMORY.find(rack => rack.weapon === weapon);
      assert.ok(row.wave >= rack.unlockWave, `${weapon} is locked in wave ${row.wave}`);
    }
    assert.ok(row.cashLeftBeforeWave >= 0, 'Already spent money is not reused for the next gun');
    assert.equal(row.cashEarnedBeforeWave, cumulativeRevenue(row.wave - 1, row.players, true).afterPerPerson);
    assert.equal(row.cashLeftBeforeWave + row.spentBeforeWave, row.cashEarnedBeforeWave);
    assert.equal(row.spentBeforeWave, row.purchasesBeforeWave.reduce((sum, purchase) => sum + purchase.price, 0));
    for (const purchase of row.purchasesBeforeWave) {
      assert.ok(purchase.afterWave >= purchase.unlockWave);
      assert.ok(purchase.afterWave < row.wave, 'Use a purchase only after its financed completed wave');
      assert.ok(cumulativeRevenue(purchase.afterWave, row.players, true).afterPerPerson >= purchase.cumulativeSpent);
    }
  }
  const first = (players, weapon) => report.earlyHeadRoute.find(row => row.players === players && row.weapons.includes(weapon)).wave;
  assert.deepEqual([first(1,'shotgun'), first(4,'shotgun')], [3,4]);
  assert.deepEqual([first(1,'assault'), first(4,'assault')], [7,7]);
  assert.deepEqual([first(1,'rifle'), first(4,'rifle')], [9,10]);
  assert.deepEqual(report.earlyHeadRoute.filter(row => row.wave === 1).map(row => row.weapons), [['pistol'],['pistol']]);
  assert.equal(report.earlyRouteAssumptions.authoritativePurchaseActionSimulated, false);
  assert.equal(report.earlyRouteAssumptions.humanSurvivalClaim, false);
  const duo = report.purchases.filter(row => row.id === 'duo');
  assert.ok(duo.every(row => row.cost === 2150 && row.unlockWave === 8 && row.afterWave >= 8));
  for (const [id, cost, unlockWave] of [['duoThenFlamethrower',4750,10], ['duoThenMinigun',4950,12], ['duoThenMagnum',5650,14]]) {
    const rows = report.purchases.filter(row => row.id === id);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.cost === cost && row.unlockWave === unlockWave && row.afterWave >= unlockWave));
  }
  assert.deepEqual(report.help.map(row => [row.before, row.after, row.score]), [[5, 1, 5], [60, 12, 60], [240, 48, 240], [150, 25, 150]]);
  assert.deepEqual(report.ammunition.map(row => [row.weapon, row.after]), [['pistol', 48], ['rifle', 120], ['shotgun', 32], ['smg', 160], ['minigun', 150], ['magnum', 6], ['assault', 96], ['rocket', 3], ['flamethrower', 120], ['katana', 0], ['hammer', 0], ['sniper', 15], ['bat', 0], ['fireaxe', 0]]);
});
