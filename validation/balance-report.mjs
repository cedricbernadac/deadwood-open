import { settleBallisticFlight } from '../test/helpers/ballistic-flight.mjs';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ARMORY, MAX_WAVES, LEGACY_MAX_WAVES, waveBalance, PICKUPS, enemyProfile, enemyAppearance, ENEMY_HEALTH, BRUTE_HEALTH, BOSS_HP, MAGNUM_BOSS_DAMAGE } from '../public/rules.js';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';

const defaultLoadout = ['rifle', 'shotgun'];
// Ideal availability fixture only: this helper respects wave locks but does
// not claim the weapons were financed. economy-report models paid purchases.
export function idealUnlockedLoadout(wave = MAX_WAVES) {
  const unlocked = name => wave >= (ARMORY.find(crate => crate.weapon === name)?.unlockWave ?? 1);
  if (!unlocked('shotgun')) return ['pistol'];
  if (!unlocked('rifle')) return ['pistol', 'shotgun'];
  return ['rifle', 'shotgun'];
}
function idealLoadoutStages() {
  const stages = [];
  for (let wave = 1; wave <= MAX_WAVES; wave++) {
    const weapons = idealUnlockedLoadout(wave), previous = stages.at(-1);
    if (previous && previous.weapons.join('+') === weapons.join('+')) previous.to = wave;
    else stages.push({ from: wave, to: wave, weapons });
  }
  return stages;
}
function idealLoadoutDescription(french = false) {
  return idealLoadoutStages().map(({ from, to, weapons }) => {
    const names = weapons.map(id => french ? WEAPONS[id].name : id).join(' + ');
    return names + (french ? ' en vague' : ' in wave') + (from === to ? ' ' + from : 's ' + from + '–' + to);
  }).join('; ');
}

// Pure text generation: importing the renderer neither runs the expensive
// trials nor writes any files. Stocks and box yields share the live rules.
export function ammunitionDescription(weapons = WEAPONS, pickups = PICKUPS) {
  const firearms = Object.entries(weapons).filter(([, weapon]) => !weapon.melee);
  return 'Stocks actuels (chargeur+réserve) : ' + firearms.map(([id, weapon]) =>
    id + ' ' + weapon.magazine + '+' + weapon.reserve).join('; ') + '. '
    + 'Une boîte commune tombe tous les ' + pickups.ammoEveryKills + ' kills ; une boîte sur ' + pickups.specialEvery + ' est spéciale. '
    + 'Cartouches ou unités par boîte normale/spéciale : ' + firearms.map(([id]) =>
      id + ' ' + (pickups.ammo[id] ?? 0) + '/' + (pickups.specialAmmo[id] ?? 0)).join('; ') + '. '
    + 'Ces essais portent au maximum deux armes par choix de modèle ; les boîtes ne sont jamais multipliées par le nombre de joueurs.';
}
const validLoadout = (wave, weapons) => {
  if (!weapons.length || weapons.length > 2 || new Set(weapons).size !== weapons.length
    || weapons.some(name => !WEAPONS[name] || wave < (ARMORY.find(crate => crate.weapon === name)?.unlockWave ?? 0))) throw new Error('Use one or two weapons unlocked for this wave');
  return weapons;
};

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Real spawn data, including health families, variant silhouettes and quotas.
// Moving the queue far away only isolates the shooting experiment; health,
// protection, rewards and ammunition remain those created by production.
function spawnedWave(wave, players, random = () => .5) {
  const ammoPickupIds = new Set();
  const simulation = new RoomSimulation('BUDGET', { random, onEvent: event => {
    if (event.event === 'pickup' && event.kind === 'ammo' && event.ammo?.length) ammoPickupIds.add(event.pickupId);
  } });
  for (let index = 0; index < players; index++) simulation.addPlayer(`p${index}`);
  simulation.start('p0');
  simulation.wave = wave - 1;
  simulation.beginWave();
  const balance = waveBalance(wave, players);
  for (let index = 0; index < balance.total; index++) {
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: 500, y: 0, z: -2 });
  }
  simulation.toSpawn = 1;
  simulation.spawnTimer = 999;
  simulation.updateZombie = () => {};
  return { simulation, balance, ammoPickupIds };
}

// Optimistic upper bounds: all reserve is available, maximum close damage,
// every pellet hits, no overkill wastes damage, and the rare magnum removes
// the highest-HP enemies.
// Failing even this bound proves a tactic cannot clear the whole wave.
export function waveBudget(wave, players = 1, { weapons = defaultLoadout, pickups = true } = {}) {
  const { simulation, balance } = spawnedWave(wave, players);
  const names = validLoadout(wave, weapons);
  const ammoBoxes = pickups ? Math.floor(balance.total / PICKUPS.ammoEveryKills) : 0;
  const specialBoxes = Math.floor(ammoBoxes / PICKUPS.specialEvery);
  let body = 0, alignedBody = 0, oneShots = 0;
  for (const name of names) {
    const weapon = WEAPONS[name];
    // Boxes are shared. A single collector receives its two weapon refills;
    // multiplying the dropped supply by player count would invent ammunition.
    const rounds = players * (weapon.magazine + weapon.reserve)
      + (ammoBoxes - specialBoxes) * PICKUPS.ammo[name] + specialBoxes * PICKUPS.specialAmmo[name];
    if (weapon.oneShot) { oneShots += rounds; continue; }
    const damage = rounds * weapon.pellets * weapon.damage * damageFalloff(weapon, 0);
    body += damage;
    let penetration = 0;
    for (let index = 0; index < weapon.penetrationTargets; index++) penetration += weapon.penetrationRetention ** index;
    alignedBody += damage * penetration;
  }
  const health = [...simulation.zombies.values()].map(zombie => zombie.maxHp).sort((a, b) => b - a);
  const magnumKills = Math.min(health.length, oneShots);
  const remainingHp = health.slice(magnumKills).reduce((sum, hp) => sum + hp, 0);
  return {
    wave, players, weapons: names, ammoBoxes, specialBoxes, enemies: balance.total, zombieHp: balance.zombieHp,
    totalHp: health.reduce((sum, hp) => sum + hp, 0),
    headshotMultiplier: balance.headshotMultiplier, magnumKills, remainingHp,
    body: body / remainingHp,
    alignedBody: alignedBody / remainingHp,
    heads: body * balance.headshotMultiplier / remainingHp,
    alignedHeads: alignedBody * balance.headshotMultiplier / remainingHp,
  };
}

// Constructive, ideal stationary formation trial using the real shoot(),
// reload() and minigun spin methods. Killed zombies replace the next queued target.
// It measures finite ammunition, not aim, time under attack or human play.
export function formationTrial({ wave = MAX_WAVES, players = 1, heads = true, aligned = true, starterOnly = false, weapons = defaultLoadout, pickups = true, variants = true, seed = null, targetDistance = 3, spacing = .9, magnumPriority = true } = {}) {
  const random = seed === null ? () => .5 : seededRandom(seed);
  const { simulation, balance, ammoPickupIds } = spawnedWave(wave, players, random);
  const names = validLoadout(wave, starterOnly ? ['pistol'] : weapons);
  // The isolated exterior lane has no cabin wall or furnishing in the rays.
  // There are no outdoor-damage ticks in this ammunition-only experiment.
  const firingX = -10, firingZ = 5;
  for (const player of simulation.players.values()) {
    Object.assign(player, { x: firingX, y: 0, z: firingZ, yaw: 0, pitch: 0 });
    player.inventory = Object.fromEntries(names.map(name => [name, { ammo: WEAPONS[name].magazine, reserve: WEAPONS[name].reserve }]));
  }
  const composition = Object.fromEntries(['walker', 'runner', 'crawler', 'armored', 'brute'].map(kind => [kind, [...simulation.zombies.values()].filter(zombie => zombie.kind === kind).length]));
  const healthFamilies = {};
  for (const zombie of simulation.zombies.values()) {
    const family = enemyAppearance(zombie).id;
    healthFamilies[family] = (healthFamilies[family] ?? 0) + 1;
  }
  const healthGroups = {};
  for (const zombie of simulation.zombies.values()) {
    const key = `${zombie.boss ? 'boss' : zombie.kind}:${zombie.maxHp}`;
    healthGroups[key] = (healthGroups[key] ?? 0) + 1;
  }
  const totalHp = [...simulation.zombies.values()].reduce((sum, zombie) => sum + zombie.maxHp, 0);
  const spent = Object.fromEntries(names.map(name => [name, 0]));
  let reloads = 0, turns = 0;
  const survivors = [...simulation.players.values()];
  // Alternate using the most stocked relative weapon. Keeping one gun full
  // while emptying the other would intentionally waste half each shared box.
  while (simulation.zombies.size && survivors.some(player => Object.values(player.inventory).some(stock => stock.ammo || stock.reserve))) {
      if (++turns > 100000) throw new Error('Formation trial exceeded its finite shot guard');
      const player = survivors[(turns - 1) % survivors.length];
      const name = names.filter(name => player.inventory[name].ammo || player.inventory[name].reserve)
        .sort((a, b) => (player.inventory[b].ammo + player.inventory[b].reserve) / (WEAPONS[b].magazine + WEAPONS[b].reserve)
          - (player.inventory[a].ammo + player.inventory[a].reserve) / (WEAPONS[a].magazine + WEAPONS[a].reserve))[0];
      if (!name) continue;
      simulation.chooseWeapon(player.id, name);
      const inventory = player.inventory[name];
        if (!inventory.ammo) {
          if (!simulation.reload(player.id)) throw new Error('Finite reload unexpectedly rejected');
          simulation.time = player.reloadUntil;
          simulation.tick(0);
          reloads++;
        }
        if (name === 'minigun' && !player.minigunSpinning) {
          if (!simulation.setMinigunSpin(player.id, true)) throw new Error('Minigun windup unexpectedly rejected');
          simulation.time += MINIGUN_WINDUP;
        }
        // This explicitly ideal bonus tactic reserves its finite one-shot
        // rounds for the healthiest available enemies, including the boss.
        // It does not silently grant any extra bonus rounds or a third gun.
        const targets = [...simulation.zombies.values()];
        if (name === 'magnum' && magnumPriority) targets.sort((a, b) => b.maxHp - a.maxHp);
        let index = 0;
        for (const zombie of targets) {
          zombie.x = index < (aligned ? 4 : 1) ? firingX : 500;
          zombie.z = firingZ - targetDistance - index * spacing;
          zombie.y = 0;
          index++;
        }
        const first = targets[0];
        const profile = enemyProfile(first), scale = first?.scale ?? 1;
        // For ordinary standing heads, a horizontal ray at the player's eye
        // stays inside the exposed head band of the whole line. Pitching at
        // the first head's centre would instead fly above the later heads.
        const horizontalHead = 1.55 > profile.headThreshold * scale && 1.55 < profile.height * scale;
        const aimHeight = heads ? horizontalHead ? 1.55 : profile.head * scale
          : Math.min(profile.height * .6, profile.headThreshold * .8) * scale;
        player.pitch = Math.atan2(aimHeight - 1.55, targetDistance);
        simulation.time = Math.max(simulation.time, player.shotAfter);
        if (!simulation.shoot(player.id)) throw new Error('Budget shot unexpectedly rejected');
        // Complete real flight against this stationary formation before rearranging targets.
        // The off-lane queue is not part of the stationary encounter. Keep only
        // its 1/4 exposed bodies in collision checks, then restore the queue.
        // This avoids scanning hundreds of deliberately parked targets at every
        // flight step; neither ammunition nor the exposed hitboxes change.
        const exposedIds = new Set(targets.slice(0, aligned ? 4 : 1).map(target => target.id));
        const waiting = [...simulation.zombies].filter(([id]) => !exposedIds.has(id));
        for (const [id] of waiting) simulation.zombies.delete(id);
        settleBallisticFlight(simulation, { step: 1 / 30 });
        for (const [id, zombie] of waiting) simulation.zombies.set(id, zombie);
        spent[name]++;
        if (pickups) {
          // Deliberately ideal: instant safe access to every drop at its real
          // server coordinates, no new ammunition purchases and no resupply.
          for (const pickup of [...simulation.pickups.values()]) {
            if (pickup.kind !== 'ammo') { simulation.pickups.delete(pickup.id); continue; }
            Object.assign(player, { x: pickup.x, y: pickup.y, z: pickup.z });
            simulation.collectPickups();
          }
          Object.assign(player, { x: firingX, y: 0, z: firingZ });
        } else simulation.pickups.clear();
  }
  return {
    wave, players, heads, aligned, starterOnly, weapons: names, pickups, variants: true, composition, healthFamilies, healthGroups, totalHp, seed, dispersion: seed === null ? 'centred upper-bound aim' : 'seeded production cone', targetDistance, spacing, magnumPriority,
    ammoCollected: ammoPickupIds.size, collectionMetric: 'Unique ammo pickup IDs that supplied at least one real round, including partial collections', enemies: balance.total,
    killed: balance.total - simulation.zombies.size, remaining: simulation.zombies.size,
    remainingHp: [...simulation.zombies.values()].reduce((total, zombie) => total + zombie.hp, 0),
    spent, reloads,
    ammoLeft: [...simulation.players.values()].reduce((total, player) => total + Object.values(player.inventory).reduce((sum, inventory) => sum + inventory.ammo + inventory.reserve, 0), 0),
  };
}

export function familyBalanceReport() {
  const checkpoints = [1, 4, 6, 7, 10, 14, 17, MAX_WAVES];
  const budgets = checkpoints.flatMap(wave => [1, 4].map(players =>
    waveBudget(wave, players, { weapons: idealUnlockedLoadout(wave) })));
  const finalTrials = [1, 4].flatMap(players => [
    formationTrial({ players, heads: false, aligned: false, seed: 17 }),
    formationTrial({ players, heads: false, aligned: true, seed: 17 }),
    formationTrial({ players, heads: true, aligned: false, seed: 17 }),
    formationTrial({ players, seed: 17 }),
    formationTrial({ players, seed: 17, pickups: false }),
    formationTrial({ players, seed: 17, starterOnly: true }),
    formationTrial({ players, seed: 17, weapons: ['rifle', 'minigun'] }),
    formationTrial({ players, seed: 17, weapons: ['rifle', 'magnum'] }),
    formationTrial({ players, seed: 17, weapons: ['minigun', 'magnum'] }),
  ]);
  const progression = Array.from({ length: MAX_WAVES }, (_, index) => index + 1)
    .flatMap(wave => [1, 2, 3, 4].map(players => ({
      ...formationTrial({ wave, players, seed: 17, weapons: idealUnlockedLoadout(wave) }),
      loadoutAssumption: 'Weapons are hypothetically already financed, but never used before their wave unlock',
    })));
  const spreadTrials = [1, 4].flatMap(players => [17, 31, 71].flatMap(seed =>
    [3, 6].flatMap(targetDistance => [defaultLoadout, ['rifle', 'minigun'], ['rifle', 'magnum']]
      .map(weapons => formationTrial({ players, seed, targetDistance, weapons })))));
  const centredBonusTrials = [1, 4].flatMap(players =>
    [defaultLoadout, ['rifle', 'minigun'], ['rifle', 'magnum']]
      .map(weapons => formationTrial({ players, weapons })));
  const revenue = [1, 4].flatMap(players => [4, 7, 14, MAX_WAVES].map(lastWave => {
    let beforeHeads = 0, afterHeads = 0;
    for (let wave = 1; wave <= lastWave; wave++) {
      const balance = waveBalance(wave, players), progress = (wave - 1) / (MAX_WAVES - 1);
      const oldSolo = Math.round(8 + 92 * progress ** 1.08);
      const oldTotal = Math.round(oldSolo * (1 + (.55 + .3 * progress) * (players - 1)));
      const special = (balance.brutes - balance.bosses) * 90 + balance.bosses * 150;
      beforeHeads += (oldTotal - balance.brutes) * 24 + special;
      afterHeads += (balance.total - balance.brutes) * 24 + special;
    }
    return { players, lastWave, beforeHeads, afterHeads, beforePerPerson: beforeHeads / players,
      afterPerPerson: afterHeads / players, changePercent: 100 * (afterHeads / beforeHeads - 1) };
  }));
  return { generatedAt: new Date().toISOString(),
    baseline: '2c9b29a2f2c4692d0cb0079ee8c03d4676fc380e',
    loadout: defaultLoadout, seeds: [17, 31, 71], budgets, finalTrials, progression,
    progressionAssumptions: { unlockedWeaponsOnly: true, financingEvaluated: false,
      initialLoadout: idealLoadoutDescription(),
      stationaryTargets: true, instantSafeAmmoCollection: true, humanSurvivalClaim: false },
    spreadTrials, centredBonusTrials, revenue };
}

export function familyBalanceMarkdown(report) {
  const passed = report.progression.filter(row => !row.remaining).length;
  const firstSolo = waveBalance(1, 1), lastSolo = waveBalance(MAX_WAVES, 1);
  const firstFour = waveBalance(1, 4), lastFour = waveBalance(MAX_WAVES, 4), shotgun = WEAPONS.shotgun;
  const lines = [
    '# Deadwood — budgets avec les paliers d’armes actuels', '',
    'Calculs locaux reproductibles : node validation/balance-report.mjs. Sortie balance-current.md/json ; les anciens rapports datés sont conservés. Aucun de ces essais ne remplace une partie humaine.', '',
    'Les familles ordinaires ont ' + ENEMY_HEALTH.join(', ') + ' PV. Les vagues mélangent deux familles voisines par répartition ordinale, sans tirage aléatoire de PV. Le rampant conserve ' + (enemyProfile({ kind: 'crawler' }).health * 100) + ' % des PV de sa famille ; son apparence correspond à ses PV réels. Les colosses utilisent les familles de ' + BRUTE_HEALTH.join(', ') + ' PV ; boss final ' + BOSS_HP + ' PV. Le multiplicateur de tête est constant ×' + firstSolo.headshotMultiplier + '. La même silhouette et la même couleur ne gagnent donc plus de résistance cachée avec la vague.', '',
    'Effectifs solo : ' + firstSolo.total + ' à ' + lastSolo.total + ' ; à quatre : ' + firstFour.total + ' à ' + lastFour.total + '. La progression de ' + LEGACY_MAX_WAVES + ' vagues est répartie sur ' + MAX_WAVES + ', avec les mêmes points de départ et d’arrivée. Le nombre actif final est plafonné à ' + lastSolo.maxActive + ' solo / ' + lastFour.maxActive + ' à quatre ; le reste attend son apparition. Les budgets comptent la vague entière, pas seulement les acteurs simultanés.', '',
    'Pompe : ' + shotgun.pellets + ' plombs de ' + shotgun.damage + ' dégâts de base, cône angulaire uniforme sur disque de rayon ' + shotgun.spread + ' rad (environ ' + (2 * shotgun.spread * 180 / Math.PI).toFixed(1) + '° d’ouverture totale). La cadence reste ' + shotgun.interval + ' s. Si tous les plombs touchent, le maximum proche est environ ' + Math.round(shotgun.damage * shotgun.pellets * damageFalloff(shotgun, 0)) + ' PV au corps par cartouche, contre ' + Math.round(shotgun.damage * shotgun.pellets * damageFalloff(shotgun, 4)) + ' à 4 m ; ces maxima ne décrivent pas les touches effectivement obtenues. La dispersion seedée ci-dessous emploie le vrai shoot() de production et attend les impacts physiques. La courbe lisse décroît exponentiellement avec la distance, sans coupure aux anciennes portées.', '',
    ammunitionDescription(), '',
    'Après une collecte partielle, la boîte garde son solde initial au sol, avec la même expiration. Sa charge universelle de ' + PICKUPS.ammoCharge + ' unités est débitée selon la plus grande fraction fournie aux deux armes du collecteur ; un autre joueur ou le même peut prendre le reste plus tard. Aucun nouveau stock n’est créé. La colonne des boîtes compte les identifiants uniques ayant réellement fourni une balle via un événement ammo ; plusieurs visites de la même boîte ne la comptent pas plusieurs fois. Une baisse du nombre global de pickups, parfois due à une bourse voisine, ne sert plus de mesure.', '',
    'Borne optimiste de dégâts : toutes les boîtes de la vague entière, tous les plombs au centre, toutes les pénétrations, aucun surplus perdu et aucun sur-dégât. Les PV du dénominateur proviennent de vrais spawnZombie(), avec familles, rampants, colosses et boss. La protection du cuirassé est ignorée pour cette borne favorable. Cette borne Magnum retire d’abord les ennemis ayant le plus de PV et traite optimistement toute cible comme une victime par balle, y compris le boss ; ce raccourci surestime ses dégâts réels contre le boss. Les essais constructifs suivants utilisent les vrais ' + MAGNUM_BOSS_DAMAGE + ' PV par impact, soit ' + Math.ceil(BOSS_HP / MAGNUM_BOSS_DAMAGE) + ' coups pour le boss. Un ratio inférieur à 100 % prouve une insuffisance ; un ratio supérieur ne prouve pas une route réalisable.', '',
    '| Vague | Joueurs | Zombies | PV moyen normal | Corps | Corps alignés | Têtes seules | Têtes alignées |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.budgets.map(row => '| ' + [row.wave, row.players, row.enemies, row.zombieHp,
      ...[row.body, row.alignedBody, row.heads, row.alignedHeads].map(value => (value * 100).toFixed(0) + ' %')].join(' | ') + ' |'), '',
    'Essais constructifs : vrai spawnZombie(), shoot(), reload(), rotation du minigun et collectPickups(). File stationnaire de quatre cibles séparées de 0,90 m en profondeur, à partir de 3 m. Hauteurs et protections réelles sont mêlées ; les tirs visent une tête accessible ou le torse, selon la stratégie. La ligne horizontale des têtes debout est conservée lorsque possible. Trois graines fixes produisent coureurs et vraie dispersion ; aucune modification de la réserve ne compense un tir manqué. La collecte reste immédiate et sûre. Les armes sont choisies selon leur fraction de stock disponible ; les rares tirs de Magnum visent prioritairement les plus gros PV.', '',
    '| Joueurs | Armes | Stratégie (graine 17) | Tués / total | Boîtes ayant servi | Munitions restantes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.finalTrials.map(row => '| ' + [row.players, row.weapons.join(' + '),
      (row.heads ? 'Têtes' : 'Corps') + (row.aligned ? ' alignés' : ' isolés') + (row.pickups ? '' : ', sans collecte'),
      row.killed + ' / ' + row.enemies, row.ammoCollected, row.ammoLeft].join(' | ') + ' |'), '',
    'Progression complète à dispersion réelle, graine 17 : ' + passed + ' / ' + report.progression.length +
      ' essais terminent leur vague, pour les vagues 1–' + MAX_WAVES + ' à 1–4 joueurs. Chargements idéaux : ' + idealLoadoutDescription(true) + '. Chaque arme respecte son verrou ; son financement préalable est explicitement supposé, jamais démontré par ce tableau. Le rapport economy-rebalance distingue cette hypothèse des achats réellement financés dans son modèle.', '',
    '| Joueurs | Vague | Chargement idéal déjà financé | Tués / total | Munitions restantes |',
    '|---:|---:|---|---|---:|',
    ...report.progression.map(row => '| '+[row.players,row.wave,row.weapons.join(' + '),row.killed+'/'+row.enemies,row.ammoLeft].join(' | ')+' |'), '',
    'Sensibilité de la dispersion et de la distance. Le JSON conserve aussi les essais centrés, uniquement comme comparaison optimiste.', '',
    '| Joueurs | Graine | Distance première cible | Armes | Tués / total | Munitions restantes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.spreadTrials.map(row => '| ' + [row.players, row.seed, row.targetDistance + ' m',
      row.weapons.join(' + '), row.killed + ' / ' + row.enemies, row.ammoLeft].join(' | ') + ' |'), '',
    'Le Magnum supprime immédiatement un colosse ordinaire ; le boss reçoit ' + MAGNUM_BOSS_DAMAGE + ' PV par impact. Les résultats ne permettent pas de présenter mitrailleuse + Magnum comme un duo universel de fin de partie en solo ; le joueur abandonne une arme d’endurance pour ce secours rare. Les deux bonus ensemble ne garantissent pas de terminer une vague. Le minigun reste une option de grappe limitée par ses ' + (WEAPONS.minigun.magazine + WEAPONS.minigun.reserve) + ' balles initiales et sa rotation, pas une réserve illimitée.', '',
    'Monnaie : récompenses inchangées ; prix et disponibilités réordonnés le 10 octobre. Comparaison synthétique sur vingt vagues compressées, sans puis avec le surcroît de foule ; ce tableau ne compare pas une ancienne nuit de trente vagues. Toutes les éliminations sont à la tête, toutes les bourses ramassées, sans dépense ni entraide ; à quatre, partage égal supposé. La formule croît après le niveau de difficulté 10, à la vague 7 ; après arrondi, le premier ajout non nul arrive à la vague 8. Cette foule supplémentaire ne finance pas les premiers achats plus vite. La compression de la progression peut en revanche avancer ces achats par rapport à leurs anciens numéros de vagues.', '',
    '| Joueurs | Vague terminée | Sans surcroît, par joueur | Avec surcroît, par joueur | Variation |',
    '| --- | --- | --- | --- | --- |',
    ...report.revenue.map(row => '| ' + [row.players, row.lastWave, row.beforePerPerson,
      row.afterPerPerson, row.changePercent.toFixed(1) + ' %'].join(' | ') + ' |'), '',
    'Limites : chaque vague est un essai indépendant avec un stock initial neuf, sans continuité des munitions entre vagues. Ennemis immobiles replacés dans la file à chaque tir, aucune attaque, aucune erreur humaine de visée, aucune durée dangereuse de recharge, aucun trajet de collecte, aucune expiration de butin et aucun financement des armes simulé ici. La mise en ligne des cibles et le choix prioritaire d’un gros ennemi pour le Magnum sont des conditions favorables explicites. Les résultats à 3 m ne promettent pas le même rendement à 6 m. Aucun temps de survie réel, plaisir de jeu, performance graphique ou coopération Wi-Fi humaine n’est déduit de ces budgets.', '',
  ];
  return lines.join('\n');
}

export const BALANCE_REPORT_BASENAME = 'balance-current';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = familyBalanceReport();
  const passed = report.progression.filter(row => !row.remaining).length;
  const basename = BALANCE_REPORT_BASENAME;
  writeFileSync(new URL('./' + basename + '.md', import.meta.url), familyBalanceMarkdown(report), 'utf8');
  writeFileSync(new URL('./' + basename + '.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ report: basename, progressionPassed: passed,
    progressionTrials: report.progression.length,
    finalTrials: report.finalTrials.map(({ players, weapons, heads, aligned, pickups, killed, enemies, ammoLeft }) =>
      ({ players, weapons, heads, aligned, pickups, killed, enemies, ammoLeft })),
    spreadTrialCount: report.spreadTrials.length }, null, 2));
}
