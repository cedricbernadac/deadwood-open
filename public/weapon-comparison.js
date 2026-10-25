import { ARMORY, WEAPON_MOVEMENT, PICKUPS, MINIGUN_TIMING, waveBalance } from './rules.js';
import { ENEMY_PROFILES } from './enemies.js';
import { getLanguage, setLanguage, weaponLabel } from './i18n.js';
import { scenarioReport } from './weapon-scenarios.js';
import { BALLISTICS, longRangeFalloff, sampleBulletAtDistance } from './ballistics.js';
import { blastDamageAtDistance, flameFalloff } from './area-damage.js';
export { blastDamageAtDistance } from './area-damage.js';

const ORDER = ARMORY.map(rack => rack.weapon);
const HEADSHOT = waveBalance(1, 1).headshotMultiplier;

// Profiles and the sampler are shared with the authoritative game. The chart
// uses horizontal distance in the shared longitudinal approximation, with
// gravity treated separately. It never continues a vanished bullet at zero.
export function damageAtDistance(weapon, distance) {
  if (!Number.isFinite(distance) || distance < 0) throw new TypeError('Invalid distance');
  if (weapon.bulletPhysics) { const sample = sampleBulletAtDistance(weapon, distance); return sample.reachable ? sample.damage : 0; }
  if (weapon.fuel) return weapon.damage * flameFalloff(weapon, distance);
  if (distance > weapon.range) return 0;
  return weapon.damage * longRangeFalloff(weapon, distance);
}

export function comparisonProfiles(config){
  const weapons=config?.weapons;
  if(!weapons||typeof weapons!=='object')throw new TypeError('Missing refuge weapons');
  const bullets=Object.values(weapons).filter(weapon=>weapon.bulletPhysics);
  const maxDistance=Math.max(1,...bullets.map(weapon=>sampleBulletAtDistance(weapon,0).endDistance));
  return {weapons,maxDistance};
}
export function weaponFlightAtDistance(weapon,distance,gravity=BALLISTICS.gravity){
  if(!Number.isFinite(distance)||distance<0||!Number.isFinite(gravity)||gravity<0)throw new TypeError('Invalid flight inputs');
  if(!weapon.bulletPhysics)return null;
  const sample=sampleBulletAtDistance(weapon,distance);
  return {...sample,muzzleSpeed:weapon.bulletPhysics.muzzleSpeed,inRange:sample.reachable};
}
export function falloffCurve(weapon,maxDistance=weapon.bulletPhysics?sampleBulletAtDistance(weapon,0).endDistance:weapon.range,samples=120){
  if(!Number.isFinite(maxDistance)||maxDistance<=0||!Number.isInteger(samples)||samples<2)throw new TypeError('Invalid curve inputs');
  const end=Math.min(maxDistance,weapon.bulletPhysics?sampleBulletAtDistance(weapon,0).endDistance:weapon.range);
  return Array.from({length:samples+1},(_,i)=>{const distance=i/samples*end;
    return {distance,damage:weapon.bulletPhysics?sampleBulletAtDistance(weapon,distance).damage:damageAtDistance(weapon,distance)};});
}
export const BULLET_COLORS=Object.freeze({pistol:'#8dc98a',rifle:'#79b7f0',shotgun:'#f39774',smg:'#c19bdf',minigun:'#6dd6c4',magnum:'#f6d56a',assault:'#e990b5',sniper:'#d5e6ed'});
export function comparisonCurves(weapons,{selected='sniper',overlay=false,shotgunUnit='pellet',maxDistance=null}={}){
  if(!['pellet','shell'].includes(shotgunUnit))throw new TypeError('Invalid shotgun unit');
  maxDistance??=Math.max(1,...Object.values(weapons).filter(weapon=>weapon.bulletPhysics).map(weapon=>sampleBulletAtDistance(weapon,0).endDistance));
  return Object.keys(BULLET_COLORS).filter(id=>weapons[id]?.bulletPhysics&&(overlay||id===selected)).map(id=>{
    const weapon=weapons[id],multiplier=id==='shotgun'&&shotgunUnit==='shell'?weapon.pellets:1;
    return {id,color:BULLET_COLORS[id],selected:id===selected,multiplier,points:falloffCurve(weapon,maxDistance,240).map(point=>({...point,damage:point.damage*multiplier}))};
  });
}

export function comparisonStats(weapons, armory = ARMORY, distance = 3, gravity = BALLISTICS.gravity) {
  if (!weapons || typeof weapons !== 'object') throw new TypeError('Missing weapons');
  const order = [...ORDER, ...Object.keys(weapons).filter(id => !ORDER.includes(id))];
  return order.map(id => {
    const weapon = weapons[id];
    if (!weapon || !['damage', 'magazine', 'reserve', 'reloadTime', 'range', 'interval', 'pellets', 'spread', 'penetrationTargets', 'penetrationRetention']
      .every(key => Number.isFinite(weapon[key])) || weapon.interval <= 0 || weapon.range <= 0
      || weapon.magazine < 0 || weapon.reserve < 0 || weapon.reloadTime < 0
      || !weapon.melee && (weapon.magazine < 1 || weapon.reloadTime <= 0)) throw new TypeError(`Invalid weapon: ${id}`);
    if (weapon.melee && (!weapon.attacks || !['light', 'heavy'].every(attack => {
      const profile = weapon.attacks[attack];
      return profile && ['damage', 'range', 'coneAngle', 'windup', 'interval', 'maxTargets', 'retention'].every(key => Number.isFinite(profile[key]))
        && profile.damage > 0 && profile.range > 0 && profile.interval > profile.windup && profile.windup >= 0;
    }))) throw new TypeError(`Invalid melee weapon: ${id}`);
    const rack = armory.find(item => item.weapon === id);
    if (!rack || !Number.isFinite(rack.price)) throw new TypeError(`Missing rack: ${id}`);
    if (weapon.falloff && !['start', 'end', 'near', 'far'].every(key => Number.isFinite(weapon.falloff[key]))) throw new TypeError(`Invalid falloff: ${id}`);
    const body = damageAtDistance(weapon, distance);
    const attacks = weapon.melee ? Object.fromEntries(Object.entries(weapon.attacks).map(([attack, profile]) => [attack, {
      ...profile, damageAtDistance: distance <= profile.range ? profile.damage : 0, inRange: distance <= profile.range,
      rpm: 60 / profile.interval,
    }])) : null;
    const flight=weaponFlightAtDistance(weapon,distance,gravity);
    return { id, weapon, attacks, flight, flameScale: weapon.fuel ? flameFalloff(weapon, distance) : null, price: rack.price, unlockWave: rack.unlockWave ?? 1,
      inRange: attacks ? Object.values(attacks).some(attack => attack.inRange) : flight ? flight.inRange : distance <= weapon.range, body, head: weapon.melee ? null : body * HEADSHOT,
      totalPerShot: body * weapon.pellets, dps: body * weapon.pellets / weapon.interval,
      rpm: 60 / weapon.interval, movement: WEAPON_MOVEMENT[id] * 100,
      totalStock: weapon.magazine + weapon.reserve,
      normalAmmo: PICKUPS.ammo[id], specialAmmo: PICKUPS.specialAmmo[id],
      farBody: weapon.bulletPhysics ? sampleBulletAtDistance(weapon,sampleBulletAtDistance(weapon,0).endDistance).damage : damageAtDistance(weapon, weapon.range),
      spreadDegrees: weapon.spread * 180 / Math.PI,
    };
  });
}

const copy = {
  flightPhysics:['Les balles volent à vitesse finie dans le Refuge et au stand : les dégâts arrivent au contact. Le vol libre montré ici inclut ralentissement et chute ; le sol et les obstacles peuvent arrêter la balle avant. Aucune compensation automatique de la chute.', 'Bullets travel at finite speed in the Shelter and range: damage arrives on contact. Free flight shown here includes deceleration and drop; ground and obstacles can stop the bullet sooner. Drop is not automatically compensated.'],
  scenarioApproximation:['Les scénarios ci-dessous approchent les tirs par des rayons droits contre des cibles fixes pour comparer le débit à courte distance. Ils utilisent les dégâts actuels, mais ne simulent ni le temps de vol ni la chute. Ce calcul de comparaison ne remplace pas une partie.', 'The scenarios below approximate shots with straight rays against stationary targets to compare close-range output. They use current damage, but do not simulate travel time or drop. This comparison is not a gameplay test.'],
  chartOverlay:['Superposer toutes les armes à balles','Overlay all bullet weapons'],
  chartLegend:['Armes affichées','Displayed weapons'],
  shotgunUnit:['Pompe · unité de la courbe','Shotgun · chart unit'],perPellet:['Par plomb','Per pellet'],allPellets:['9 plombs théoriques','9 theoretical pellets'],
  horizontalAxis:['Distance horizontale (m)','Horizontal distance (m)'],damageAxis:['Dégâts au corps (PV)','Body damage (HP)'],
  physicsDetails:['Vol et réglage des dégâts','Flight and damage tuning'],
  physicsFormula:["Le vol conserve la traînée quadratique : masse, vitesse initiale et Cx × section déterminent le ralentissement ; la gravité ajoute la chute. Les dégâts sont calibrés séparément pour le jeu : D₀ est la puissance au départ. La courbe souple vaut D₀ / [1 + (d/L)ᵖ] : L divise les dégâts par deux et p règle la courbure. Le pompe, le sniper et le Magnum gardent une décroissance exponentielle D₀ × exp(−2kd), avec k issu de la traînée. La transmission règle l’énergie perdue lors d’une traversée ; la chute n’augmente pas les dégâts.","Flight retains quadratic drag: mass, muzzle speed and Cd × area determine deceleration; gravity adds drop. Damage is tuned separately for gameplay: D₀ is initial damage. The smooth curve is D₀ / [1 + (d/L)ᵖ]: L halves damage and p controls curvature. The shotgun, sniper and Magnum retain exponential decay D₀ × exp(−2kd), with k derived from drag. Transmission controls energy lost when piercing a body; falling adds no damage."],
  mass:['Masse du projectile','Projectile mass'],dragArea:['Traînée · Cx × section','Drag · Cd × area'],transmission:['Transmission · traversée','Transmission · penetration'],
  muzzleDamage:['Dégâts au départ · D₀','Initial damage · D₀'],damageCurve:['Courbe des dégâts','Damage curve'],
  rationalCurve:['Souple · D₀ / [1 + (d/L)ᵖ]','Smooth · D₀ / [1 + (d/L)ᵖ]'],exponentialCurve:['Exponentielle · D₀ × exp(−2kd)','Exponential · D₀ × exp(−2kd)'],
  halfDistance:['Dégâts divisés par deux · L','Half-damage distance · L'],curvePower:['Courbure · p','Curvature · p'],exponentialRate:['Atténuation · 2k','Decay rate · 2k'],
  impactSpeed:['vitesse à cette distance','speed at this distance'],simulationEnd:['fin du vol simulé','simulated flight horizon'],
  blastTitle:['Les dégâts autour de l’explosion.','Damage around the explosion.'],
  blastIntro:['Roquette ou grenade : pleine puissance jusqu’à 2 m du foyer, puis baisse lisse jusqu’à zéro à 4 m. Le trajet du projectile ne réduit pas l’explosion ; murs et armure peuvent réduire les dégâts en partie.','Rocket or grenade: full power through 2 m from the blast centre, then smooth decay to zero at 4 m. Projectile travel does not weaken the blast; walls and armor can reduce damage in play.'],
  blastWeapon:['Charge explosive','Explosive charge'],rocketOption:['Roquette','Rocket'],grenadeOption:['Grenade','Grenade'],
  areaHistoryLink:['Comparer avant / maintenant : explosions et flammes ↗','Compare before / now: blasts and flames ↗'],
  flameHistoryLink:['Voir le jet et la brûlure selon la distance ↗','See direct flame and burn over distance ↗'],
  blastDistance:['Distance au centre de l’explosion','Distance from explosion centre'],
  flightSpeed:['Vitesse initiale','Muzzle speed'],flight:['Vol / chute','Flight / drop'],
  chartTitle:['La puissance avec la distance.','Damage over distance.'],chartWeapon:['Arme de la courbe','Chart weapon'],
  chartIntro:["Dégâts au corps sans armure, selon la distance horizontale. Les courbes sont réglées pour retrouver les sensations de proximité ; le vol conserve ses vitesses, sa traînée et sa chute. Chaque trait s’arrête à la fin du vol simulé, avec la puissance restante.","Unarmored body damage over horizontal distance. Curves are tuned to preserve close-range feel; flight retains its speeds, drag and drop. Each line stops at its simulated flight horizon with its remaining damage."],
  back: ['Retour au jeu', 'Back to the game'], language: ['Langue', 'Language'],
  eyebrow: ['LE BON OUTIL, AU BON MOMENT', 'THE RIGHT TOOL, AT THE RIGHT TIME'],
  title: ['L’arsenal du refuge.', 'The shelter’s arsenal.'],
  intro: ['Compare les armes avant de choisir tes deux emplacements.', 'Compare the weapons before choosing your two slots.'],
  try: ['Essayer les armes ↗', 'Try the weapons ↗'], slots: ['2 armes au choix', 'Any 2 weapons'],
  source: ['Valeurs actuelles du serveur', 'Current server values'],
  historyLink: ['Dégâts avant / maintenant · une courbe par arme ↗', 'Damage before / now · a chart for each weapon ↗'],
  loading: ['Chargement des règles du serveur…', 'Loading server rules…'],
  error: ['Impossible de charger les valeurs. Vérifie que le serveur Deadwood est lancé.', 'Could not load weapon values. Check that the Deadwood server is running.'],
  retry: ['Réessayer', 'Retry'],
  comparisonEyebrow: ['PUISSANCE / MANIEMENT', 'POWER / HANDLING'],
  comparisonTitle: ['Les chiffres, côte à côte.', 'The numbers, side by side.'], distance: ['Distance de tir', 'Firing distance'],
  tableNote:["Dégâts sur une cible sans armure. Cadence et DPS théoriques, hors rechargement ; le total du pompe suppose que les 9 plombs touchent. Fais varier la distance pour comparer la puissance restante.","Damage against an unarmored target. Theoretical fire rate and DPS exclude reloads; the shotgun total assumes all 9 pellets hit. Adjust distance to compare remaining power."],
  weapon: ['Arme', 'Weapon'], damage: ['Dégâts corps / tête', 'Body / head damage'], cadence: ['Cadence / DPS', 'Fire rate / DPS'], stock: ['Chargeur + réserve', 'Magazine + reserve'],
  reload: ['Recharge', 'Reload'], range: ['Portée', 'Range'], penetration: ['Traversée', 'Penetration'], movement: ['Vitesse', 'Movement'], purchase: ['Achat', 'Purchase'],
  penetrationNote:["La traversée compte le premier zombie : « 3 cibles » = le premier + deux derrière. Le pourcentage indique les dégâts conservés par corps traversé ; la traînée continue pendant le trajet. Murs et planches arrêtent les tirs.","Penetration includes the first zombie: “3 targets” means the first plus two behind it. The percentage shows damage retained per body; drag continues during flight. Walls and boards stop shots."],
  rolesTitle: ['Assaut, SMG ou mitrailleuse ?', 'Assault rifle, SMG or machine gun?'],
  roles: ['Dans Deadwood, l’assaut privilégie la précision et les dégâts par cartouche, avec une cadence plus lente et un chargeur plus petit. Le SMG est rapide et mobile ; la mitrailleuse tire plus vite que l’assaut et traverse trois cibles. Leurs noms ne définissent pas un calibre réel : ce sont les réglages actuels du jeu.', 'In Deadwood, the assault rifle favors precision and damage per round, with a slower rate and a smaller magazine. The SMG is fast and mobile; the machine gun fires faster than the assault rifle and pierces three targets. The names do not specify real calibers: these are the current game settings.'],
  rocketTitle: ['La roquette explose à l’impact.', 'The rocket explodes on impact.'],
  flameTitle: ['Arroser, puis laisser brûler.', 'Sweep, then let them burn.'],
  meleeTitle: ['Les armes de mêlée : rapide ou puissant.', 'Melee weapons: quick or powerful.'],
  advanced: ['Munitions et précision · voir les détails', 'Ammo and accuracy · see the details'],
  ammoNote: ['Une boîte possède une charge partagée entre les deux armes portées. Ces quantités sont des maximums par arme pour une boîte entièrement disponible : elles ne s’ajoutent pas automatiquement. Une boîte partiellement ramassée reste au sol.', 'Each box has one shared supply for both carried weapons. These are per-weapon maximums for a full box, not amounts automatically added together. Partially collected boxes remain on the ground.'],
  normalBox: ['Boîte normale', 'Normal box'], specialBox: ['Boîte spéciale', 'Special box'], totalStock: ['Stock maximum', 'Maximum stock'], spread: ['Dispersion par axe', 'Spread per axis'], farDamage: ['Dégâts au loin', 'Long-range damage'],
  precisionNote: ['Dispersion : écart angulaire aléatoire maximal de chaque côté de la visée (plus petit = plus précis). Le pompe distribue ses plombs dans un disque ; le lance-flammes couvre un cône. Ce tableau ne mesure pas ta précision en partie.', 'Spread: maximum random angular offset to each side of your aim (smaller means more precise). Shotgun pellets spread over a disk; the flamethrower covers a cone. This table does not measure your accuracy in play.'],
  sustainedEyebrow: ['LES DEUX DÉBITS', 'SUSTAINED AND ACTIVE OUTPUT'],
  sustainedTitle: ['Pendant l’attaque et sur la durée.', 'During the attack and over time.'],
  sustainedIntro: ['Deux séries à contact, 4 m et 12 m : la moyenne avec recharges et préparation, puis le débit actif sans ces temps. La cadence entre tirs reste conservée ; les armes de mêlée gardent leur cycle complet, préparation comprise. Ces trois distances restent fixes quand tu déplaces le curseur du tableau.', 'Two sets at contact, 4 m and 12 m: sustained output including reloads and preparation, then active output excluding those delays. Intervals between shots are retained; melee weapons retain their complete cycle, including preparation. These three distances stay fixed when you move the table’s distance slider.'],
  sustainedLegend: ['Moyenne · avec recharges et préparation', 'Sustained · including reloads and preparation'],
  activeLegend: ['Actif · sans recharge ni préparation', 'Active · excluding reloads and preparation'],
  activeMethod: ['Le débit actif garde les mêmes impacts et hypothèses de visée. Il enlève recharge et mise en rotation de la Gatling, conserve l’intervalle entre tirs. Exception : les armes de mêlée gardent préparation et récupération à chaque coup ; leurs deux séries sont donc identiques. Tu peux préparer en marchant ou en courant, mais chaque nouveau coup doit être préparé. Le lance-flammes garde une seule brûlure continue, sans la multiplier. C’est un potentiel pendant l’attaque, pas une recharge instantanée ajoutée au jeu.', 'Active output uses the same hits and aiming assumptions. It excludes reloads and Gatling spin-up, retains intervals between shots. Exception: melee weapons retain preparation and recovery on every swing, so both sets are identical. You can prepare while walking or sprinting, but every new swing must be prepared. The flamethrower retains one continuous burn without multiplying it. This is potential output during the attack, not an instant reload added to the game.'],
  sustainedContact: ['PV/s moyens · contact', 'Average HP/s · contact'],
  sustainedFour: ['PV/s moyens · 4 m', 'Average HP/s · 4 m'],
  sustainedTwelve: ['PV/s moyens · 12 m', 'Average HP/s · 12 m'],
  activeContact: ['PV/s actifs · contact', 'Active HP/s · contact'],
  activeFour: ['PV/s actifs · 4 m', 'Active HP/s · 4 m'],
  activeTwelve: ['PV/s actifs · 12 m', 'Active HP/s · 12 m'],
  efficiencyColumn: ['Dégâts pondérés · PV/s', 'Weighted damage · HP/s'],
  efficiencyFormula: ['Indice = 50 % de chaque série, avec 25 % contact + 50 % à 4 m + 25 % à 12 m. Pour les armes de mêlée : moyenne des deux attaques. Calcul sur les valeurs non arrondies. Cet indice proche ne mesure pas la spécialité du sniper à 50 m. Clique sur la dernière colonne pour trier.', 'Index = 50% of each set, with 25% contact + 50% at 4 m + 25% at 12 m. For melee weapons: average of both attacks. Calculated using unrounded values. This close-range index does not measure the sniper’s 50 m specialty. Click the last column to sort.'],
  efficiencyBody: ['pondération 25 / 50 / 25', '25 / 50 / 25 weighting'],
  efficiencyMelee: ['moyenne léger / puissant', 'average of light / heavy'],
  efficiencyDescending: ['Trier par dégâts pondérés décroissants', 'Sort by weighted damage, highest first'],
  efficiencyAscending: ['Trier par dégâts pondérés croissants', 'Sort by weighted damage, lowest first'],
  efficiencyReset: ['Rétablir l’ordre initial des armes', 'Restore the original weapon order'],
  scenarioMethod: ['Hypothèses de visée et de calcul', 'Aiming and calculation assumptions'],
  scenarioLoading: ['Calcul des trois scénarios…', 'Calculating the three scenarios…'],
  scenarioError: ['Scénarios indisponibles. Les caractéristiques individuelles restent affichées ; recharge la page pour réessayer.', 'Scenarios unavailable. Individual weapon stats are still shown; reload the page to retry.'],
  scenarioLimit:["Débit potentiel sur des cibles de mesure sans armure, sans plafonner les dégâts aux PV restants. Le Magnum applique sa courbe de dégâts aux infectés comme au boss. La foule est limitée à 90 m pour ce calcul de proximité. Ce débit ne prédit ni les éliminations ni les munitions disponibles en partie.","Potential output against unarmored measuring targets, without clipping damage at remaining HP. The Magnum applies its damage curve to ordinary infected and bosses alike. The crowd is limited to 90 m for this close-range calculation. This output predicts neither kills nor available ammunition in play."],
  scenarioSupply: ['La réserve est renouvelée après chaque chargeur pour mesurer une longue durée. Dans le jeu, les stocks et les boîtes restent limités. Les prix et les vagues de disponibilité sont inchangés.', 'The reserve is replenished after each magazine to measure long-run output. In the game, stocks and pickups remain limited. Prices and unlock waves are unchanged.'],
  magnumNote:["Un seul Magnum doré pour toute la salle, échangeable au sol. Il conserve environ 2 000 PV au départ, puis une décroissance exponentielle avec la distance, contre les infectés comme contre le boss. Pas d’élimination automatique, aucune traversée, réserve initiale vide ; les bonus ne renforcent pas ses dégâts.","One gold Magnum for the entire room, transferable on the ground. It retains about 2,000 initial HP damage, then exponential distance decay, against ordinary infected and bosses alike. No automatic elimination, no penetration and no starting reserve; bonuses do not raise its damage."],
  sourceNote: ['Calculé à partir de /world.json et des règles partagées du jeu. Les PV des familles restent fixes ; le mélange d’ennemis évolue avec les vagues. Aucune valeur n’est une promesse de réussite en partie.', 'Calculated from /world.json and the shared game rules. Enemy families keep fixed HP; their mix changes with the waves. These numbers do not guarantee success in play.'],
};

const local = (fr, en) => getLanguage() === 'en' ? en : fr;
const text = key => copy[key][getLanguage() === 'en' ? 1 : 0];
const number = (value, maximumFractionDigits = 1) => new Intl.NumberFormat(getLanguage(), { maximumFractionDigits }).format(value);
const hp = value => `${number(value)} ${local('PV', 'HP')}`;
const seconds = value => `${number(value, 2)} s`;
function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}
function cell(main, detail) {
  const element = node('td');
  element.append(node('strong', main));
  if (detail) element.append(node('small', detail));
  return element;
}
function penetrationCell(stat) {
  const { weapon } = stat;
  if (weapon.melee) {
    const count = weapon.attacks.light.maxTargets;
    return cell(`${count} ${local(count === 1 ? 'cible' : 'cibles', count === 1 ? 'target' : 'targets')}`,
      count > 1 ? `${number(weapon.attacks.light.retention * 100)} % ${local('par cible balayée', 'per swept target')}` : local('aucun balayage supplémentaire', 'no additional sweep'));
  }
  if (weapon.explosive) return cell(local('Zone', 'Area'), `${weapon.innerRadius}–${weapon.radiusDamage} m`);
  if (weapon.fuel) return cell(local('Cône', 'Cone'), `${number(weapon.coneAngle * 180 / Math.PI)}°`);
  const count = weapon.penetrationTargets;
  return cell(`${count} ${local(count === 1 ? 'cible' : 'cibles', count === 1 ? 'target' : 'targets')}`,
    count > 1 ? `${number(weapon.penetrationRetention * 100)} % ${local('par corps', 'per body')}` : local('aucune traversée', 'no penetration'));
}
function damageCell(stat) {
  const { weapon } = stat;
  if (!stat.inRange) return cell('—', local('hors de portée', 'out of range'));
  if (weapon.melee) return cell(`${stat.attacks.light.inRange ? number(stat.attacks.light.damage) : '—'} / ${stat.attacks.heavy.inRange ? number(stat.attacks.heavy.damage) : '—'}`,
    local('léger / lourd · sans bonus tête', 'light / heavy · no head bonus'));
  if (weapon.explosive) return cell(hp(weapon.damage), local(`rayon ≤ ${weapon.innerRadius} m · pas de bonus tête`, `radius ≤ ${weapon.innerRadius} m · no head bonus`));
  if (weapon.fuel) return cell(`${hp(weapon.contactDps * stat.flameScale)}/s`, `+ ${hp(weapon.burnDps * stat.flameScale)}/s ${local('brûlure créée', 'new burn')}`);
  if (weapon.pellets > 1) return cell(`${number(stat.body)} / ${number(stat.head)}`, local(`par plomb · ${number(stat.totalPerShot)} corps si ${weapon.pellets} touchent`, `per pellet · ${number(stat.totalPerShot)} body if ${weapon.pellets} hit`));
  return cell(`${number(stat.body)} / ${number(stat.head)}`, local('par balle', 'per round'));
}
function cadenceCell(stat) {
  const { weapon } = stat;
  if (weapon.melee) return cell(`${number(stat.attacks.light.rpm, 0)} / ${number(stat.attacks.heavy.rpm, 0)} ${local('coups/min', 'swings/min')}`,
    `${seconds(stat.attacks.light.interval)} / ${seconds(stat.attacks.heavy.interval)} ${local('par cycle', 'per cycle')}`);
  if (weapon.fuel) return cell(`${number(1 / weapon.interval)} ${local('carburant/s', 'fuel/s')}`, local('pas de tir par balle', 'continuous stream'));
  if (weapon.explosive) return cell(local('1 tir puis recharge', '1 shot, then reload'), `≈ ${number(60 / weapon.reloadTime)} / min ${local('avec R immédiat', 'with immediate R')}`);
  return cell(`${number(stat.rpm, 0)} / min`, `${number(stat.dps, 0)} ${local('PV/s corps', 'body HP/s')}`);
}

export function scenarioColumns(report, id, targetHp = 400, timingMode = 'sustained') {
  if (!Number.isFinite(targetHp) || targetHp <= 0) throw new TypeError('Invalid target HP');
  if (!['sustained', 'active'].includes(timingMode)) throw new TypeError('Invalid scenario timing mode');
  if (!report) return null;
  const rows = report.rows.filter(row => row.id === id);
  if (!rows.length) throw new TypeError(`Missing scenario row: ${id}`);
  return report.scenarios.map((scenario, index) => {
    const cells = rows.map(row => {
      const base = row.cells[index];
      if (timingMode === 'active' && !base?.active) throw new TypeError(`Missing active scenario row: ${id}`);
      return { ...base, ...(timingMode === 'active' && base.active), mode: row.mode };
    });
    if (cells.some(cell => !Number.isFinite(cell.rawDps))) throw new TypeError(`Invalid scenario row: ${id}`);
    return { distance: scenario.distance, timingMode, cells, values: cells.map(cell => cell.rawDps) };
  });
}

export function weightedWeaponScore(report, id, targetHp = 400) {
  if (!report) return null;
  const distanceWeights = [.25, .5, .25], timingWeights = [.5, .5];
  const sets = ['sustained', 'active'].map(mode => scenarioColumns(report, id, targetHp, mode));
  if (sets.some(columns => columns.length !== 3 || columns.some((column, index) => column.distance !== [0, 4, 12][index])))
    throw new TypeError('Weighted score requires contact, 4 m and 12 m scenarios');
  const profileScores = sets[0][0].values.map((_, profile) => sets.reduce((total, columns, timing) =>
    total + timingWeights[timing] * columns.reduce((sum, column, distance) => sum + distanceWeights[distance] * column.values[profile], 0), 0));
  if (!profileScores.length || profileScores.some(score => !Number.isFinite(score))) throw new TypeError('Invalid weighted score');
  return { score: profileScores.reduce((sum, score) => sum + score, 0) / profileScores.length,
    profileScores, distanceWeights, timingWeights };
}

function sustainedCell(column, stat, targetHp) {
  if (!column) return cell('…');
  const { values, cells, timingMode } = column;
  const value = values.every(dps => dps === 0) ? '0' : `≈ ${values.map(dps => number(dps, 0)).join(' / ')}`;
  let detail = local('PV/s potentiels', 'potential HP/s');
  if (stat.weapon.melee) detail = timingMode === 'active' ? local('léger / puissant · cycle complet', 'light / heavy · full cycle') : local('léger / puissant · PV/s', 'light / heavy · HP/s');
  else if (stat.weapon.fuel) detail = local('jet fixe + brûlure unique', 'fixed stream + one burn');
  else detail += ` · ${number(cells[0].targetsPerShot, 1)} ${local('corps/tir', 'bodies/shot')}`;
  const element = cell(value, detail); element.className = `scenario-column${timingMode === 'active' ? ' active-column' : ''}${values.every(dps => dps === 0) ? ' out-of-range' : ''}`;
  const timing = cells[0];
  element.title = local(`${timingMode === 'active' ? 'Cycle actif' : 'Cycle'} de ${number(timing.cycleTime, timingMode === 'active' ? 3 : 2)} s ; ${number(timing.shotsPerCycle, 0)} tirs/coups. Valeur moyenne sur ${timing.samples} dispositions de zombies.`, `${timingMode === 'active' ? 'Active cycle' : 'Cycle'} of ${number(timing.cycleTime, timingMode === 'active' ? 3 : 2)} s; ${number(timing.shotsPerCycle, 0)} shots/swings. Mean over ${timing.samples} zombie arrangements.`);
  if (stat.weapon.melee && timingMode === 'active') element.title = local(`Cycles complets léger / puissant : ${cells.map(cell => number(cell.cycleTime, 2)).join(' / ')} s, préparation comprise à chaque coup.`, `Full light / heavy cycles: ${cells.map(cell => number(cell.cycleTime, 2)).join(' / ')} s, including preparation on every swing.`);
  return element;
}

function renderRows(stats, report = null, targetHp = 400, efficiencySort = 'none') {
  const rows = document.getElementById('weapon-rows'), ammoRows = document.getElementById('ammo-rows');
  rows.replaceChildren(); ammoRows.replaceChildren();
  const scores = new Map(stats.map(stat => [stat.id, weightedWeaponScore(report, stat.id, targetHp)]));
  const ordered = [...stats];
  if (report && efficiencySort !== 'none') ordered.sort((a, b) => (efficiencySort === 'descending' ? -1 : 1) * (scores.get(a.id).score - scores.get(b.id).score));
  for (const stat of ordered) {
    const { weapon, id } = stat, row = node('tr', undefined, weapon.melee || ['assault', 'rocket', 'flamethrower', 'sniper'].includes(id) ? 'accent' : '');
    const name = node('th', weaponLabel(id)); name.scope = 'row';
    if (id === 'minigun') name.append(node('small', local(`rotation ${seconds(MINIGUN_TIMING.windup)}`, `${seconds(MINIGUN_TIMING.windup)} spin-up`)));
    const rangeDetail = weapon.bulletPhysics ? text('simulationEnd') : weapon.melee ? local('léger / lourd', 'light / heavy') : weapon.fuel ? local('cône de flammes', 'flame cone') : local('portée maximale', 'maximum range');
    const stockCell = weapon.melee ? cell(local('Sans munitions', 'No ammo'), local('un emplacement', 'one slot')) : cell(`${weapon.magazine} + ${weapon.reserve}`, weapon.fuel ? local('unités de carburant', 'fuel units') : local('cartouches', 'rounds'));
    row.append(name, damageCell(stat), cadenceCell(stat), stockCell,
      weapon.melee ? cell('—', local('récupération entre coups', 'recovery between swings')) : cell(seconds(weapon.reloadTime)),
      cell(weapon.melee ? `${number(weapon.attacks.light.range)} / ${number(weapon.attacks.heavy.range)} m` : `${number(weapon.bulletPhysics ? sampleBulletAtDistance(weapon,0).endDistance : weapon.range)} m`, rangeDetail), ...flightCells(stat), penetrationCell(stat), cell(`${number(stat.movement)} %`, local('marche et sprint', 'walk and sprint')),
      cell(`${number(stat.price, 0)} ${local('pièces', 'coins')}`, id === 'pistol' ? local('départ gratuit', 'free starting weapon') : local(`dès la vague ${stat.unlockWave}`, `from wave ${stat.unlockWave}`)));
    const scenarios = scenarioColumns(report, id, targetHp);
    for (let index = 0; index < 3; index++) row.append(sustainedCell(scenarios?.[index], stat, targetHp));
    const active = scenarioColumns(report, id, targetHp, 'active');
    for (let index = 0; index < 3; index++) row.append(sustainedCell(active?.[index], stat, targetHp));
    const score = scores.get(id), scoreCell = cell(score ? `≈ ${number(score.score, 1)}` : '…', score ? text(weapon.melee ? 'efficiencyMelee' : 'efficiencyBody') : undefined);
    scoreCell.className = 'efficiency-column';
    if (score) scoreCell.title = text('efficiencyFormula');
    row.append(scoreCell);
    rows.append(row);
    const ammoRow = node('tr'), ammoName = node('th', weaponLabel(id)); ammoName.scope = 'row';
    const ammoUnits = weapon.fuel ? local('unités', 'units') : local('cartouches', 'rounds');
    const spread = weapon.fuel ? `${number(weapon.coneAngle * 90 / Math.PI)}°` : `${number(stat.spreadDegrees, 2)}°`;
    const far = weapon.explosive ? cell(local('Explosion', 'Explosion')) : weapon.fuel ? cell(local(`Jusqu’à ${weapon.range} m`, `Up to ${weapon.range} m`))
      : cell(hp(stat.farBody), local(`à ${number(weapon.bulletPhysics ? sampleBulletAtDistance(weapon,0).endDistance : weapon.range)} m${weapon.pellets > 1 ? ' · par plomb' : ''}`, `at ${number(weapon.bulletPhysics ? sampleBulletAtDistance(weapon,0).endDistance : weapon.range)} m${weapon.pellets > 1 ? ' · per pellet' : ''}`));
    if (weapon.melee) {
      ammoRow.append(ammoName, cell('—'), cell('—'), cell(local('Sans consommable', 'No consumable')),
        cell(`${number(weapon.attacks.light.coneAngle * 180 / Math.PI)}° / ${number(weapon.attacks.heavy.coneAngle * 180 / Math.PI)}°`, local('arc léger / lourd', 'light / heavy arc')),
        cell('—', local('corps à corps seulement', 'melee only')));
      ammoRows.append(ammoRow); continue;
    }
    ammoRow.append(ammoName, cell(`${stat.normalAmmo}`, ammoUnits), cell(`${stat.specialAmmo}`, ammoUnits), cell(`${stat.totalStock}`, local('chargé + réserve', 'loaded + reserve')),
      cell(`±${spread}`, weapon.fuel ? local('demi-cône', 'half cone') : weapon.pellets > 1 ? local('disque de 9 plombs', '9-pellet disk') : local('plus petit = plus précis', 'smaller = more precise')), far);
    ammoRows.append(ammoRow);
  }
}

function flightCells(stat){
  const flight=stat.flight,a=cell(flight?number(flight.muzzleSpeed,1)+' m/s':'—'),b=cell(flight&&flight.inRange?'≈ '+seconds(flight.time)+' / '+dropLabel(flight.drop):'—',flight?(flight.inRange?local('tir horizontal · vol libre','horizontal shot · free flight'):local('hors du vol simulé','outside simulated flight')):local('profil inchangé','unchanged profile'));
  for(const cell of [a,b])cell.classList.add('flight-column');return [a,b];
}
function dropLabel(value){return value<1?number(value*100,1)+' cm':number(value,2)+' m';}
function renderChart(series,distance,maxDistance,peak,axisLabel){
  const x=d=>60+d/maxDistance*690,y=damage=>185-damage/peak*145;
  let markup='<svg viewBox="0 0 780 240" aria-hidden="true"><path class="chart-grid" d="M60 40H750 M60 112.5H750 M60 185H750"/><path class="chart-marker" d="M'+x(distance).toFixed(2)+' 35V185"/>';
  for(const curve of series){
    const path=curve.points.map((p,i)=>(i?'L':'M')+x(p.distance).toFixed(2)+','+y(p.damage).toFixed(2)).join(' '),last=curve.points.at(-1);
    markup+='<path data-weapon="'+curve.id+'" class="chart-line '+(curve.selected?'is-selected':'is-overlay')+'" style="stroke:'+curve.color+'" d="'+path+'"/>';
    markup+='<circle class="chart-endpoint" style="stroke:'+curve.color+'" cx="'+x(last.distance).toFixed(2)+'" cy="'+y(last.damage).toFixed(2)+'" r="3"/>';
  }
  return markup+'<text x="10" y="20">'+text('damageAxis')+'</text><text x="10" y="44">'+number(peak,0)+'</text><text x="19" y="189">0</text><text x="60" y="208">0 m</text><text x="380" y="208">'+number(maxDistance/2,0)+' m</text><text x="698" y="208">'+number(maxDistance,0)+' m</text><text x="390" y="232" text-anchor="middle">'+axisLabel+'</text></svg>';
}
function renderCurve(weapons,distance,maxDistance,gravity){
  const select=document.getElementById('curve-weapon'),previous=select.value;select.replaceChildren();
  for(const id of Object.keys(BULLET_COLORS))if(weapons[id]?.bulletPhysics){const option=node('option',weaponLabel(id));option.value=id;select.append(option);}
  select.value=[...select.options].some(option=>option.value===previous)?previous:'sniper';
  const selected=select.value,weapon=weapons[selected],overlay=document.getElementById('overlay-curves').checked,shotgunUnit=document.getElementById('shotgun-unit').value;
  document.getElementById('shotgun-unit').disabled=!overlay&&selected!=='shotgun';
  const series=comparisonCurves(weapons,{selected,overlay,shotgunUnit,maxDistance}),peak=Math.max(1,...series.flatMap(curve=>curve.points.map(p=>p.damage)));
  const multiplier=selected==='shotgun'&&shotgunUnit==='shell'?weapon.pellets:1,sample=sampleBulletAtDistance(weapon,distance),chart=document.getElementById('falloff-chart');
  const unit=selected==='shotgun'?' · '+text(shotgunUnit==='shell'?'allPellets':'perPellet'):'';
  chart.setAttribute('aria-label',weaponLabel(selected)+unit+' · '+number(distance)+' m : '+(sample.reachable?hp(sample.damage*multiplier):local('hors du vol simulé','outside simulated flight')));
  chart.innerHTML=renderChart(series,distance,maxDistance,peak,text('horizontalAxis'));
  const legend=document.getElementById('curve-legend');legend.replaceChildren();legend.setAttribute('aria-label',text('chartLegend'));
  for(const curve of series){const item=node('li',undefined,curve.selected?'selected':''),swatch=node('i');swatch.style.setProperty('--curve',curve.color);swatch.setAttribute('aria-hidden','true');
    item.append(swatch,node('span',weaponLabel(curve.id)+(curve.id==='shotgun'?' · '+text(shotgunUnit==='shell'?'allPellets':'perPellet'):'')));legend.append(item);}
  const flight=sample.reachable?' · '+seconds(sample.time)+' / '+dropLabel(sample.drop)+' · '+number(sample.speed,1)+' m/s '+text('impactSpeed'):'';
  document.getElementById('curve-value').textContent=weaponLabel(selected)+unit+' · '+number(distance)+' m : '+(sample.reachable?hp(sample.damage*multiplier):local('hors du vol simulé','outside simulated flight'))+flight+' · '+text('simulationEnd')+' '+number(sample.endDistance,1)+' m';
  const profile=document.getElementById('physics-profile'),physics=weapon.bulletPhysics,curve=weapon.damageCurve;profile.replaceChildren();
  const parameters=[[text('mass')+(selected==='shotgun'?' · '+text('perPellet'):''),number(physics.mass*1000,3)+' g'],
    [text('flightSpeed'),number(physics.muzzleSpeed,1)+' m/s'],[text('dragArea'),number(physics.dragArea*1e6,3)+' mm²'],[text('transmission'),number(physics.transmission*100,1)+' %'],
    [text('muzzleDamage')+(selected==='shotgun'?' · '+text('perPellet'):''),hp(weapon.damage)],
    [text('damageCurve'),text(curve?.kind==='rational'?'rationalCurve':'exponentialCurve')]];
  if(curve?.kind==='rational')parameters.push([text('halfDistance'),number(curve.halfDistance,2)+' m'],[text('curvePower'),number(curve.power,2)]);
  else parameters.push([text('exponentialRate'),number(2*physics.drag,5)+' m⁻¹']);
  for(const [label,value]of parameters){
    const pair=node('div');pair.append(node('dt',label),node('dd',value));profile.append(pair);
  }
}
function renderBlast(rocket,grenades){
  const isGrenade=document.getElementById('blast-weapon').value==='grenade',weapon=isGrenade?grenades:rocket;
  const control=document.getElementById('blast-distance');control.max=String(weapon.radiusDamage);control.value=String(Math.min(Number(control.value),weapon.radiusDamage));
  const distance=Number(control.value),damage=blastDamageAtDistance(weapon,distance),count=120;
  const distances=[...new Set([0,weapon.innerRadius,weapon.radiusDamage,...Array.from({length:count+1},(_,i)=>i/count*weapon.radiusDamage)])].sort((a,b)=>a-b);
  const curve={id:isGrenade?'grenade':'rocket',color:isGrenade?'#c19bdf':'#e9b872',selected:true,points:distances.map(distance=>({distance,damage:blastDamageAtDistance(weapon,distance)}))};
  const chart=document.getElementById('blast-chart');chart.innerHTML=renderChart([curve],distance,weapon.radiusDamage,Math.max(1,weapon.damage),text('blastDistance')+' (m)');
  chart.setAttribute('aria-label',text('blastDistance')+' '+number(distance)+' m : '+hp(damage));
  document.getElementById('blast-distance-output').textContent=number(distance)+' m';document.getElementById('blast-value').textContent=text(isGrenade?'grenadeOption':'rocketOption')+' · '+number(distance)+' m : '+hp(damage);
}

if (typeof document !== 'undefined' && document.getElementById('weapon-rows')) {
  const languageSelect = document.getElementById('language-select'), distance = document.getElementById('distance');
  const status = document.getElementById('load-status');
  const scenarioStatus = document.getElementById('scenario-status');
  const efficiencyButton = document.getElementById('efficiency-sort'), efficiencyHeader = document.getElementById('efficiency-header');
  let config = null, failed = false, scenarioData = null, scenarioFailed = false;
  let efficiencySort = 'none';
  function render() {
    document.documentElement.lang = getLanguage();
    document.title = local('Deadwood — Comparatif des armes', 'Deadwood — Weapon comparison');
    languageSelect.value = getLanguage(); languageSelect.setAttribute('aria-label', text('language'));
    for (const element of document.querySelectorAll('[data-copy]')) element.textContent = text(element.dataset.copy);
    document.getElementById('physics-note').textContent=text('flightPhysics');
    document.getElementById('table-region').setAttribute('aria-label', text('comparisonTitle'));
    document.getElementById('ammo-region').setAttribute('aria-label', text('advanced'));
    document.getElementById('headshot-guide').textContent = local(`Têtes ×${number(HEADSHOT)} sur les balles`, `Bullet headshots ×${number(HEADSHOT)}`);
    status.classList.toggle('error', failed);
    status.replaceChildren();
    if (!config) {
      status.append(node('span', text(failed ? 'error' : 'loading')));
      if (failed) { const retry = node('button', text('retry'), 'button'); retry.addEventListener('click', load); status.append(retry); }
      return;
    }
    let selected,stats;try{selected=comparisonProfiles(config);distance.max=String(Math.ceil(selected.maxDistance));distance.value=String(Math.min(Number(distance.value),Number(distance.max)));stats=comparisonStats(selected.weapons,config.world.armory,Number(distance.value),config.ballistics?.gravity??BALLISTICS.gravity);}catch{status.hidden=false;status.classList.add('error');status.append(node('span',text('error')));const retry=node('button',text('retry'),'button');retry.addEventListener('click',load);status.append(retry);document.getElementById('comparison').hidden=true;return;}
    document.getElementById('comparison').hidden=false;status.hidden = true;
    document.getElementById('distance-output').textContent = `${number(Number(distance.value), 0)} m`;
    renderRows(stats, scenarioData, 400, efficiencySort);
    renderCurve(selected.weapons,Number(distance.value),Number(distance.max),config.ballistics?.gravity??BALLISTICS.gravity);
    renderBlast(selected.weapons.rocket,config.grenades);
    document.getElementById('flight-header').textContent=text('flight')+' · '+number(Number(distance.value),0)+' m';
    efficiencyHeader.setAttribute('aria-sort', efficiencySort);
    efficiencyButton.title = efficiencyButton.ariaLabel = text(efficiencySort === 'none' ? 'efficiencyDescending' : efficiencySort === 'descending' ? 'efficiencyAscending' : 'efficiencyReset');
    document.getElementById('efficiency-arrow').textContent = efficiencySort === 'none' ? '↕' : efficiencySort === 'descending' ? '↓' : '↑';
    efficiencyButton.disabled = !scenarioData;
    scenarioStatus.hidden = Boolean(scenarioData); scenarioStatus.textContent = text(scenarioFailed ? 'scenarioError' : 'scenarioLoading');
    const assumptions = scenarioData?.assumptions;
    document.getElementById('scenario-assumptions').textContent = assumptions ? local(
      `Visée frontale fixe au corps, 0 % de tirs à la tête, sans armure. Œil accroupi à ${number(assumptions.eyeHeight, 2)} m ; aucune rotation tactique du lance-flammes. Distance libre entre la peau du joueur et les premiers corps. Terrain plat ouvert, zombies immobiles qui ne meurent pas, foule à 360° limitée à ${number(assumptions.crowdRadius, 1)} m : pas de murs, recul ou danger. Espacement de ${number(assumptions.spacing, 2)} m (densité nominale ${number(assumptions.nominalDensity, 2)} corps/m²), ${assumptions.samples} dispositions déphasées et tournées, ${assumptions.shotsPerSample} tirs aléatoires par disposition pour les armes à balles. La première cible est visée ; les suivantes ne sont pas alignées exprès. Dispersion réelle, plombs, perte de dégâts par distance et corps traversé, cônes et explosions sont calculés. Les brûlures ne s’empilent pas. Un cycle compte les intervalles entre les balles, puis la recharge déclenchée avec R immédiatement après la dernière balle (le rechargement automatique attendrait encore un intervalle) ; la Gatling remet ses canons en rotation à chaque chargeur. La préparation de chaque arme de mêlée fait déjà partie de son cycle. Les moyennes sont arrondies.`,
      `Fixed frontal body aim, 0% headshots, no armor. Crouched eye at ${number(assumptions.eyeHeight, 2)} m; no tactical flamethrower sweep. Distance is the free gap between the player’s skin and the nearest bodies. Open flat ground, stationary targets that do not die, a 360° crowd limited to ${number(assumptions.crowdRadius, 1)} m: no walls, pushback or danger. Spacing of ${number(assumptions.spacing, 2)} m (nominal density ${number(assumptions.nominalDensity, 2)} bodies/m²), ${assumptions.samples} shifted and rotated arrangements, ${assumptions.shotsPerSample} random triggers per arrangement for bullet weapons. The first target is aimed at; later ones are not deliberately aligned. Actual spread, pellets, distance and penetration falloff, cones and explosions are calculated. Burns do not stack. Each cycle counts intervals between rounds, then reload triggered with R immediately after the last round (automatic reload would wait one more firing interval); the Gatling spins up again for each magazine. Melee preparation is already included in its cycle. Means are rounded.`) : '';
    const rocket = config.weapons.rocket, flame = config.weapons.flamethrower;
    document.getElementById('rocket-note').textContent = local(
      `${hp(rocket.damage)} dans les ${rocket.innerRadius} m du point d’impact, puis décroissance jusqu’à zéro à ${rocket.radiusDamage} m. Les murs protègent, sans dégâts alliés. Actuellement, l’impact est calculé immédiatement sur la ligne de visée ; la grenade G, elle, rebondit et explose après un délai.`,
      `${hp(rocket.damage)} within ${rocket.innerRadius} m of impact, then falling to zero at ${rocket.radiusDamage} m. Walls provide cover; no friendly damage. Currently impact is resolved immediately along your aim; the G grenade bounces and explodes after a delay.`);
    document.getElementById('flame-note').textContent = local(
      `Cône de ${number(flame.coneAngle * 180 / Math.PI)}° : pleine puissance jusqu’à ${flame.fullDamageRange} m, puis baisse lisse jusqu’à zéro à ${flame.range} m. Jet direct jusqu’à ${hp(flame.contactDps)}/s et brûlure créée jusqu’à ${hp(flame.burnDps)}/s, tous deux réduits avec la distance. Chaque contact peut brûler pendant ${seconds(flame.burnDuration)}, sans cumul. Une ancienne exposition plus forte reste active jusqu’à son expiration ; une flamme plus faible ne la prolonge pas à pleine puissance. Aucun bonus tête.`,
      `${number(flame.coneAngle * 180 / Math.PI)}° cone: full power through ${flame.fullDamageRange} m, then smooth decay to zero at ${flame.range} m. Up to ${hp(flame.contactDps)}/s direct damage and ${hp(flame.burnDps)}/s newly applied burn, both reduced by distance. Each contact can burn for ${seconds(flame.burnDuration)} without stacking. An older stronger exposure lasts until its own expiry; weaker flame does not extend it at full power. No head bonus.`);
    const melee = Object.entries(config.weapons).filter(([, weapon]) => weapon.melee), meleeCard = document.getElementById('melee-card');
    meleeCard.hidden = !melee.length;
    const meleeNote = document.getElementById('melee-note'); meleeNote.replaceChildren();
    for (const [id, weapon] of melee) {
      const { light, heavy } = weapon.attacks;
      const targets = light.maxTargets === 1 ? local('Une seule cible, sans balayage des ennemis derrière.', 'One target only; enemies behind it are not swept.') : local(
        `Jusqu’à ${light.maxTargets} ennemis balayés, ${number(light.retention * 100)} % de dégâts conservés par cible suivante.`,
        `Sweeps up to ${light.maxTargets} enemies, retaining ${number(light.retention * 100)}% damage per next target.`);
      meleeNote.append(node('p', `${weaponLabel(id)} — ` + local(
        `Clic gauche : ${hp(light.damage)}, portée ${number(light.range)} m, arc de ${number(light.coneAngle * 180 / Math.PI)}°, impact après ${seconds(light.windup)}. Clic droit : ${hp(heavy.damage)}, portée ${number(heavy.range)} m, arc de ${number(heavy.coneAngle * 180 / Math.PI)}°, impact après ${seconds(heavy.windup)}. Cycles de ${seconds(light.interval)} / ${seconds(heavy.interval)}. ${targets} Pas de bonus tête, armure et obstacles conservés. Tu peux préparer en marchant ou en courant ; les dégâts utilisent ta position à l’impact. Le coup est annulé si tu changes d’arme ou ouvres le menu.`,
        `Left click: ${hp(light.damage)}, ${number(light.range)} m reach, ${number(light.coneAngle * 180 / Math.PI)}° arc, impact after ${seconds(light.windup)}. Right click: ${hp(heavy.damage)}, ${number(heavy.range)} m reach, ${number(heavy.coneAngle * 180 / Math.PI)}° arc, impact after ${seconds(heavy.windup)}. Cycles: ${seconds(light.interval)} / ${seconds(heavy.interval)}. ${targets} No head bonus; armor and obstacles apply. You can prepare while walking or sprinting; damage uses your position at impact. Switching weapons or opening the menu cancels the swing.`)));
    }
    const armor = (1 - ENEMY_PROFILES.armored.bodyDamage) * 100;
    document.getElementById('armor-note').textContent = local(`Cuirassés : −${number(armor)} % de dégâts au corps, y compris Magnum, explosion et feu. Les tirs à la tête ignorent cette réduction.`,
      `Armored zombies: ${number(armor)}% less body damage, including Magnum, explosions and fire. Headshots bypass that reduction.`);
    document.getElementById('minigun-note').textContent = local(`Gatling : ${seconds(MINIGUN_TIMING.windup)} de mise en rotation avant le premier dégât. Sa cadence affichée concerne uniquement le tir établi. Sa lourdeur ralentit aussi le sprint.`,
      `Gatling: ${seconds(MINIGUN_TIMING.windup)} spin-up before the first damage. The displayed rate applies once firing is established. Its weight also slows sprinting.`);
  }
  async function load() {
    config = null; failed = false; scenarioData = null; scenarioFailed = false; status.hidden = false;
    document.getElementById('comparison').hidden = true; render();
    try {
      const response = await fetch('/world.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Weapon values unavailable');
      const next = await response.json();
      if (!Array.isArray(next.world?.armory) || !next.grenades || !Number.isFinite(next.grenades.damage)) throw new Error('Missing armory or grenade profile');
      comparisonStats(next.weapons, next.world.armory);
      config = next; document.getElementById('comparison').hidden = false;
      setTimeout(() => {
        if (config !== next) return;
        try { scenarioData = scenarioReport(next.weapons); } catch { scenarioFailed = true; }
        render();
      }, 0);
    } catch { failed = true; }
    render();
  }
  languageSelect.addEventListener('change', () => { setLanguage(languageSelect.value); render(); });
  window.addEventListener('deadwood-language-change', render);
  window.addEventListener('storage', event => { if (event.key === 'deadwood-language') { setLanguage(event.newValue); render(); } });
  document.getElementById('curve-weapon').addEventListener('change',render);
  document.getElementById('overlay-curves').addEventListener('change',render);
  document.getElementById('shotgun-unit').addEventListener('change',render);
  document.getElementById('blast-distance').addEventListener('input',render);
  document.getElementById('blast-weapon').addEventListener('change',render);
  distance.addEventListener('input', render);
  efficiencyButton.addEventListener('click', () => { efficiencySort = efficiencySort === 'none' ? 'descending' : efficiencySort === 'descending' ? 'ascending' : 'none'; render(); });
  load();
}
