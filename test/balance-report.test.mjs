import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { WEAPONS } from '../simulation.mjs';
import { PICKUPS, BOSS_HP, MAGNUM_BOSS_DAMAGE } from '../public/rules.js';

test('the current balance Markdown renders live stocks and boxes without running trials or overwriting dated archives', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const validation = new URL('../validation/', import.meta.url);
  const archives = readdirSync(validation).filter(name => /^balance-.*\d{4}-\d{2}-\d{2}\.(?:md|json)$/.test(name));
  assert.ok(archives.length > 0, 'there must be historical evidence to protect');
  const original = new Map(archives.map(name => [name, readFileSync(new URL(name, validation))]));
  const { familyBalanceMarkdown, BALANCE_REPORT_BASENAME } = await import('../validation/balance-report.mjs');
  const markdown = familyBalanceMarkdown({ budgets: [], finalTrials: [], progression: [], spreadTrials: [], revenue: [] });
  assert.equal(BALANCE_REPORT_BASENAME, 'balance-current', 'the CLI targets current output rather than a dated evidence file');
  assert.match(markdown, /minigun 75\+75/);
  assert.match(markdown, /minigun 6\/12/);
  assert.match(markdown, new RegExp('minigun ' + WEAPONS.minigun.magazine + '\\+' + WEAPONS.minigun.reserve));
  assert.match(markdown, new RegExp('minigun ' + PICKUPS.ammo.minigun + '/' + PICKUPS.specialAmmo.minigun));
  assert.match(markdown, new RegExp('boss final ' + BOSS_HP + ' PV'));
  assert.match(markdown, new RegExp(Math.ceil(BOSS_HP / MAGNUM_BOSS_DAMAGE) + ' coups pour le boss'));
  assert.match(markdown, /Ces essais portent au maximum deux armes par choix de modèle/);
  assert.doesNotMatch(markdown, /75\+19|boss final 3 600|suppression immédiate d’un colosse ou du boss/);
  for (const [name, bytes] of original) assert.deepEqual(readFileSync(new URL(name, validation)), bytes, name);
});

test('ammunition text follows changed rule inputs rather than embedding the current reserve and box amounts', async () => {
  const { ammunitionDescription } = await import('../validation/balance-report.mjs');
  const description = ammunitionDescription({ minigun: { magazine: 75, reserve: 42 }, blade: { melee: true, magazine: 0, reserve: 0 } },
    { ammoEveryKills: 7, specialEvery: 3, ammo: { minigun: 8 }, specialAmmo: { minigun: 15 } });
  assert.match(description, /minigun 75\+42/);
  assert.match(description, /minigun 8\/15/);
  assert.match(description, /tous les 7 kills ; une boîte sur 3 est spéciale/);
  assert.doesNotMatch(description, /75\+75|6\/12|blade/);
});
