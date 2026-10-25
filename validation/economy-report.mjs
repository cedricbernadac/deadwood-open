import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ARMORY, ECONOMY, MAX_WAVES, waveBalance, killCash } from '../public/rules.js';
import { WEAPONS } from '../simulation.mjs';
import { formationTrial } from './balance-report.mjs';

const baseline = 'b72fb8a9a75aaaef058c099080be9fc5f34ce2b0';
const checkpoints = [1, 3, 5, 8, 10, 15, MAX_WAVES];
const legacyTotals = { pistol: 48, rifle: 210, shotgun: 64, smg: 280, minigun: 75, magnum: 6 };

// Historical parameters verified in b72fb8a/public/rules.js. This roster is
// deliberately separate from today's larger wave and fixed-health families.
function historicalBalance(wave, players) {
  const progress = (wave - 1) / 29;
  const solo = Math.round(8 + 92 * progress ** 1.08);
  return {
    total: Math.round(solo * (1 + (.55 + .3 * progress) * (players - 1))),
    zombieHp: Math.round(77 + 843 * progress ** 1.4),
    headshotMultiplier: 1.7 + 1.8 * progress,
    bruteHp: 450 + wave * 35, brutes: wave >= 8 ? 2 : wave >= 5 ? 1 : 0,
    bosses: wave === 30 ? 1 : 0, bossHp: 3600,
  };
}

// Before: isolated historical rifle rounds (30 damage at <=20 m), 10 cash
// per impact plus the historical kill score. After: current fixed kill cash,
// irrespective of wounds, pellet count and the family HP. Both assume that
// their own full roster was killed and every physical money drop collected.
export function waveRevenue(wave, players = 1, heads = true) {
  const balance = waveBalance(wave, players);
  const normal = balance.total - balance.brutes;
  const brutes = balance.brutes - balance.bosses;
  const historical = historicalBalance(balance.wave, players);
  const oldGroups = [
    { count: historical.total - historical.brutes, hp: historical.zombieHp, kind: 'walker', boss: false },
    { count: historical.brutes - historical.bosses, hp: historical.bruteHp, kind: 'brute', boss: false },
    { count: historical.bosses, hp: historical.bossHp, kind: 'brute', boss: true },
  ];
  let before = 0, rifleHits = 0;
  for (const group of oldGroups) {
    const hits = Math.ceil(group.hp / (30 * (heads ? historical.headshotMultiplier : 1)));
    const score = group.kind === 'brute' ? heads ? 400 : 300 : heads ? 130 : 100;
    rifleHits += hits * group.count;
    before += group.count * (score + hits * 10);
  }
  const specialCash = brutes * killCash({ kind: 'brute', boss: false }, heads)
    + balance.bosses * killCash({ kind: 'brute', boss: true }, heads);
  const after = normal * killCash({ kind: 'walker', boss: false }, heads) + specialCash;
  // Historical same-numbered waves keep their own brute/boss gates. With a
  // shorter night this comparison includes progression compression, not just
  // crowd growth; it is not a full thirty-wave historical campaign.
  const previousCash = (historical.total - historical.brutes) * killCash({ kind: 'walker', boss: false }, heads)
    + (historical.brutes - historical.bosses) * killCash({ kind: 'brute', boss: false }, heads)
    + historical.bosses * killCash({ kind: 'brute', boss: true }, heads);
  return { wave: balance.wave, players, heads, enemies: balance.total, normal, brutes, bosses: balance.bosses,
    beforeEnemies: historical.total, rifleHits, historicalRifleHits: rifleHits, before, after, previousCash };
}

export function cumulativeRevenue(lastWave, players = 1, heads = true) {
  lastWave = Math.max(0, Math.min(MAX_WAVES, Math.floor(Number.isFinite(lastWave) ? lastWave : 0)));
  const rows = Array.from({ length: lastWave }, (_, index) => waveRevenue(index + 1, players, heads));
  const result = rows.reduce((total, row) => ({
    kills: total.kills + row.enemies, beforeKills: total.beforeKills + row.beforeEnemies,
    before: total.before + row.before, after: total.after + row.after, previousCash: total.previousCash + row.previousCash,
  }), { kills: 0, beforeKills: 0, before: 0, after: 0, previousCash: 0 });
  return { wave: lastWave, players, heads, ...result, beforePerPerson: result.before / players,
    afterPerPerson: result.after / players, previousCashPerPerson: result.previousCash / players,
    extraCrowdCashPercent: 100 * (result.after / result.previousCash - 1), reductionFactor: result.before / result.after };
}

// A threshold at the end of a completed wave. Equal per-player collection is
// a planning assumption, never an automatic split performed by the server.
export function purchaseThreshold(cost, players = 1, heads = true, { before = false, unlockWave = 0, spent = 0 } = {}) {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(spent) || spent < 0) throw new TypeError('Purchase costs must be finite and non-negative');
  for (let wave = 1; wave <= MAX_WAVES; wave++) {
    const revenue = cumulativeRevenue(wave, players, heads);
    if (wave >= unlockWave && revenue[before ? 'beforePerPerson' : 'afterPerPerson'] >= cost + spent) return wave;
  }
  return null;
}

export function economyReport() {
  const prices = Object.fromEntries(ARMORY.map(crate => [crate.weapon, crate.price]));
  const goal = (id, label, weapons) => ({ id, label, weapons,
    cost: weapons.reduce((sum, weapon) => sum + prices[weapon], 0),
    unlockWave: Math.max(...weapons.map(weapon => ARMORY.find(crate => crate.weapon === weapon).unlockWave ?? 1)) });
  const goals = [
    goal('shotgun', 'Première amélioration : pompe', ['shotgun']),
    goal('katana', 'Katana seul, alternative précoce', ['katana']),
    goal('shotgunThenSmg', 'Pompe puis SMG', ['shotgun', 'smg']),
    goal('shotgunThenAssault', 'Pompe puis assaut', ['shotgun', 'assault']),
    goal('duo', 'Pompe puis mitrailleuse', ['shotgun', 'rifle']),
    goal('earlyRoute', 'Pompe puis assaut puis mitrailleuse', ['shotgun', 'assault', 'rifle']),
    goal('duoThenMinigun', 'Duo puis achat de la Gatling', ['shotgun', 'rifle', 'minigun']),
    goal('duoThenMagnum', 'Duo puis achat du Magnum', ['shotgun', 'rifle', 'magnum']),
    goal('duoThenFlamethrower', 'Duo puis achat de la flamme', ['shotgun', 'rifle', 'flamethrower']),
    goal('duoThenRocket', 'Duo puis achat de la roquette', ['shotgun', 'rifle', 'rocket']),
    goal('duoThenBothBonuses', 'Duo puis les deux bonus', ['shotgun', 'rifle', 'minigun', 'magnum']),
  ];
  const cumulative = [1, 4].flatMap(players => checkpoints.flatMap(wave => [false, true].map(heads => cumulativeRevenue(wave, players, heads))));
  const purchases = goals.flatMap(goal => [1, 4].flatMap(players => [false, true].map(heads => ({
    ...goal, players, heads,
    beforeWave: purchaseThreshold(goal.cost, players, heads, { before: true, unlockWave: goal.unlockWave }),
    afterWave: purchaseThreshold(goal.cost, players, heads, { unlockWave: goal.unlockWave }),
  }))));
  const ammunition = Object.entries(WEAPONS).map(([weapon, stats]) => ({
    weapon, magazine: stats.magazine, reserve: stats.reserve, before: legacyTotals[weapon] ?? null,
    after: stats.magazine + stats.reserve, reductionPercent: legacyTotals[weapon] ? 100 * (1 - (stats.magazine + stats.reserve) / legacyTotals[weapon]) : null,
  }));
  const help = [
    { action: 'repair', count: 1, before: 5, after: ECONOMY.repair, score: 5 },
    { action: 'fullDoor', count: 12, before: 60, after: 12 * ECONOMY.repair, score: 60 },
    { action: 'fourDoors', count: 48, before: 240, after: 48 * ECONOMY.repair, score: 240 },
    { action: 'revive', count: 1, before: 150, after: ECONOMY.revive, score: 150 },
  ];
  const earlyHeadRoute = [1, 4].flatMap(players => {
    let spent = 0;
    const schedule = ['shotgun', 'assault', 'rifle'].map(weapon => {
      const rack = ARMORY.find(crate => crate.weapon === weapon);
      const afterWave = purchaseThreshold(rack.price, players, true, { spent, unlockWave: rack.unlockWave });
      spent += rack.price;
      return { weapon, price: rack.price, unlockWave: rack.unlockWave, afterWave, cumulativeSpent: spent };
    });
    const lastWave = Math.min(MAX_WAVES, schedule.at(-1).afterWave + 1);
    return Array.from({ length: lastWave }, (_, index) => {
      const wave = index + 1;
      const acquired = schedule.filter(purchase => purchase.afterWave < wave);
      const weapons = acquired.length === 0 ? ['pistol'] : acquired.length === 1 ? ['pistol', 'shotgun']
        : ['shotgun', acquired.at(-1).weapon];
      const spentBeforeWave = acquired.at(-1)?.cumulativeSpent ?? 0;
      const cashEarnedBeforeWave = cumulativeRevenue(wave - 1, players, true).afterPerPerson;
      return { ...formationTrial({ wave, players, heads: true, aligned: weapons.some(weapon => weapon !== 'pistol'), seed: 17, weapons }),
        purchaseSchedule: schedule, purchasesBeforeWave: acquired, spentBeforeWave, cashEarnedBeforeWave,
        cashLeftBeforeWave: cashEarnedBeforeWave - spentBeforeWave,
        purchaseModel: 'Buy only after a completed wave funds cumulative spending and its unlock; use from the following wave' };
    });
  });
  return { generatedAt: new Date().toISOString(), baseline,
    previousEconomyBaseline: '155d433df491a625d7644c14fd8fe63e0607ab19',
    historicalModel: 'Separate b72fb8a roster, HP and headshot multiplier; isolated rifle impacts plus kill cash',
    economy: ECONOMY, prices, cumulative, purchases, ammunition, help, earlyHeadRoute,
    earlyRouteAssumptions: { route: ['shotgun', 'assault', 'rifle'], allKillsHeadshots: true,
      cashCollection: 1, equalShare: true, purchaseAfterCompletedWave: true,
      authoritativePurchaseActionSimulated: false, safeInstantAmmoCollection: true,
      stationaryTargets: true, waveEndRefill: 'Production finishWave restores carried magazine and reserve',
      humanSurvivalClaim: false } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = economyReport(), basename = 'economy-rebalance-2026-10-10';
  const lines = [
    '# Deadwood — économie et nouveaux paliers sur vingt vagues', '',
    'Reproduction : node validation/economy-report.mjs. Nouveau rapport rebalance ; les rapports du 9 octobre restent historiques, sans écrasement.', '',
    'Prix et verrous du 10 octobre : '+ARMORY.map(rack => rack.weapon+' '+rack.price+'/v'+(rack.unlockWave ?? 1)).join(', ')+'. Pistolet de départ gratuit. Récompenses et progression inchangées. Les colonnes avant utilisent les mêmes numéros de vagues du modèle b72fb8a, pas une nuit historique complète de 30 vagues. Chaque bourse est partagée une seule fois ; les chiffres par joueur à quatre supposent une répartition égale.', '',
    '| Joueurs | Vague terminée | Zombies cumulés | Cash corps | Cash têtes | Cash têtes par joueur |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[1,4].flatMap(players => checkpoints.map(wave => {
      const body=report.cumulative.find(row=>row.players===players&&row.wave===wave&&!row.heads);
      const head=report.cumulative.find(row=>row.players===players&&row.wave===wave&&row.heads);
      return '| '+[players,wave,body.kills,body.after,head.after,head.afterPerPerson].join(' | ')+' |';
    })), '',
    '| Achat cumulé | Coût | Solo corps | Solo têtes | Quatre corps | Quatre têtes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...new Set(report.purchases.map(row=>row.id))].map(id=>{
      const rows=report.purchases.filter(row=>row.id===id);
      const get=(players,heads)=>rows.find(row=>row.players===players&&row.heads===heads).afterWave;
      return '| '+[rows[0].label,rows[0].cost,get(1,false),get(1,true),get(4,false),get(4,true)].join(' | ')+' |';
    }), '',
    'Stocks actuels : '+report.ammunition.map(row=>row.weapon+' '+row.magazine+' + '+row.reserve).join(' ; ')+'. Boîtes normales/spéciales inchangées ; aucun achat de munitions.', '',
    'Route initiale : pistolet puis pompe, puis assaut et enfin mitrailleuse ; deux stocks portés au maximum, anciennes dépenses toujours déduites. Le budget suppose toutes les morts à la tête, toutes les bourses récupérées et un partage égal. Chaque achat attend la fin d’une vague effectivement financée et son verrou ; l’arme entre dans le scénario suivant seulement. L’action buyWeapon et le trajet au râtelier ne sont pas simulés.', '',
    'Route aux têtes, vraie simulation de tirs et dispersion seedée17 : '+report.earlyHeadRoute.filter(row=>!row.remaining).length+'/'+report.earlyHeadRoute.length+' vagues idéales terminées. Chaque vague est un essai indépendant avec stock neuf, conformément au vrai finishWave qui remplit les armes conservées. Cibles stationnaires, collecte de munitions immédiate et sûre, aucun combat de survie ni trajet dangereux.', '',
    '| Joueurs | Vague | Armes présentes au début | Dépenses antérieures | Cash gagné avant la vague | Solde | Tués / total |',
    '|---:|---:|---|---:|---:|---:|---|',
    ...report.earlyHeadRoute.map(row => '| '+[row.players,row.wave,row.weapons.join(' + '),row.spentBeforeWave,row.cashEarnedBeforeWave,row.cashLeftBeforeWave,row.killed+'/'+row.enemies].join(' | ')+' |'), '',
    'Limites : toutes les bourses récupérées, aucune dépense dans les cumuls, corps/têtes désignent les coups mortels. Les seuils sont atteints en fin de vague ; aucune victoire humaine ni coopération Wi-Fi n’est déduite de ces calculs.', '',
  ];
  writeFileSync(new URL('./'+basename+'.md',import.meta.url),lines.join('\n'),'utf8');
  writeFileSync(new URL('./'+basename+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({report:basename,initialRoutePassed:report.earlyHeadRoute.filter(row=>!row.remaining).length,
    initialRouteTrials:report.earlyHeadRoute.length,purchases:report.purchases,
    finalCumulative:report.cumulative.filter(row=>row.wave===MAX_WAVES)},null,2));
}
