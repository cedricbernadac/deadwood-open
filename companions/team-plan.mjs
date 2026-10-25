import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR } from '../public/level-config.js';
// A room's durable intentions. Only catalogue values returned to closed
// questions are installed; no model-written prose reaches the game or UI.
import { ARMORY, MAX_WAVES, RAIDS, GRENADES } from '../public/rules.js';
import { SUPPLY_WAVES, SUPPLY_BONUSES, LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { weaponEntries } from '../public/weapon-inventory.js';
import { weaponStrategyCatalogue, WEAPON_STRATEGY_ASSUMPTIONS } from './weapon-strategy.mjs';
import { companionProfilePrompt } from './profiles.mjs';
import { characterStats } from '../public/character-bonuses.js';
import { claimStep } from '../public/character-sheet.js';
import { characterBonusCatalogue } from './bonus-strategy.mjs';
import { doorwayPassage, wetApproach } from './outdoors.mjs';
import { crateOpportunity } from './crate-opportunity.mjs';

export const TEAM_PLAN_VERSION = 1;
export const PLAN_TIMING = Object.freeze({ retry: 15, revise: 8, stale: 30 });
export const TEAM_ROLES = Object.freeze(['support', 'close', 'marksman', 'medic']);
const text = (value, length = 60) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, length);
const coins = value => Math.max(0, Math.round(Number(value) || 0));
const active = player => player && player.alive && !player.waiting;
const bots = sim => [...sim.players.values()].filter(player => player.companion === true && !player.waiting);
const types = player => [...new Set(weaponEntries(player).map(item => item.weapon))];
export const planningWave = sim => Math.min(MAX_WAVES, Math.max(1, sim.wave + (sim.phase === 'intermission' ? 1 : 0)));

// Ignore transient ammunition, coins and health: those belong to tactics.
// Equipment/roster/profile changes can invalidate the division of labour.
export function planSignature(sim) {
  return JSON.stringify([...sim.players.values()].filter(player => !player.waiting)
    .map(player => [player.id, player.companion === true, player.alive, types(player).sort(),
      player.companion === true ? player.companionProfile ?? null : null,
      Object.keys(SUPPLY_BONUSES).map(kind => player.bonus?.[kind] ?? 0)]).sort((a, b) => a[0].localeCompare(b[0])));
}

export function assignmentFor(sim, id) {
  if (sim?.players?.get(id)?.companion !== true || sim.companionTeamPlan?.version !== TEAM_PLAN_VERSION) return null;
  return sim.companionTeamPlan.assignments?.find(item => item.id === id) ?? null;
}

export function crateRunner(sim) {
  if (!sim.supplyCrate || sim.supplyCrate.active === false || !sim.companionTeamPlan) return null;
  const order = sim.companionTeamPlan.tripOrder ?? [];
  const candidates = order.filter(id => {
    const player = sim.players.get(id);
    return active(player) && !player.downed && !sim.supplyCrate.claimed?.has(id)
      && Object.keys(SUPPLY_BONUSES).some(bonus => sim.bonusEligible?.(player, bonus));
  });
  // A runner already on a commission keeps the slot until back inside, even
  // after claiming; its umbrella and escort must not be abandoned midway.
  const away = order.find(id => {
    const player = sim.players.get(id), order = sim.companionOrders?.get(id);
    return active(player) && !player.downed && order?.kind === 'claim'
      && (Math.abs(player.x) > LEVEL.halfWidth || Math.abs(player.z) > LEVEL.halfDepth);
  });
  return away ?? candidates[0] ?? null;
}

// The 'loft' catalogue value means the sheltered cellar reserve post on the
// supermarket and the basement/cellar posts at the stair feet on the hospital
// and funfair; say it in player words.
const postWord = post => post !== 'loft' ? post : IS_SUPERMARKET ? 'cellar reserve post' : IS_HOSPITAL ? 'basement stair-foot post' : IS_FUNFAIR ? 'cellar stair-foot post' : post;
// Player words for the bare door ids. Supermarket: the east door is guarded
// from the roofed terrace passage (its doorway is in the rain). Hospital and
// funfair: what each door is and what stands by it. The words go in the post
// choices only: the plan situation (DOORS line included) is cut at 16000
// characters, and a loaded four-survivor hospital plan has under 100 to spare.
const POST_WORDS = Object.freeze(IS_SUPERMARKET ? { north: 'the north door, sales floor side', south: 'the south door, sales floor side', west: 'the west door, sales floor side' }
  : IS_HOSPITAL ? { north: 'main entrance, entrance hall (station and generator in the reception beside it)', west: 'ambulance door into the emergency department, by the main stair head; the crate is outside it',
    east: 'service door, corridor east end', south: 'south door, hall between emergency and chapel' }
    : IS_FUNFAIR ? { north: 'main entrance under the ticket arch and canopy, by the ticket booth and station', west: 'west door, circulation by the main stair head',
      east: 'east door, circulation by the prize counter', south: 'south door, hall between the snack bar and bumper cars' } : {});

export function teamIntent(sim, id) {
  const mine = assignmentFor(sim, id);
  if (!mine) return '';
  const rack = ARMORY.find(item => item.weapon === mine.goalWeapon);
  const own = sim.players.get(id), hasGoal = types(own).includes(mine.goalWeapon);
  const ready = rack && !hasGoal && sim.wave >= rack.unlockWave && own.points >= rack.price;
  const saving = rack && !hasGoal ? ` Next weapon: ${rack.weapon}, ${rack.price} coins, unlock wave ${rack.unlockWave}; you have ${coins(own.points)}.`
    + (ready ? ' Affordable and unlocked NOW: use the next safe opportunity to obtain it; do not keep saving without a reason.'
      : ' Save toward it when safe; urgent survival purchases may override.') : '';
  const members = sim.companionTeamPlan.assignments.filter(item => item.id !== id && active(sim.players.get(item.id)))
    .map(item => `${text(sim.players.get(item.id)?.name, 30)}: ${item.role}, ${postWord(item.post)}, goal ${item.goalWeapon}${sim.companionOrders?.get(item.id)?.kind ? `, doing ${sim.companionOrders.get(item.id).kind}` : ''}`).join('; ');
  const runner = crateRunner(sim), runnerName = runner ? text(sim.players.get(runner)?.name, 30) : null;
  return (`TEAM PLAN r${sim.companionTeamPlan.revision}: your role ${mine.role}; preferred post ${postWord(mine.post)}; keep ${mine.keepWeapon}; preferred crate bonus ${mine.bonus}.`
    + saving + (members ? ` Others: ${members}.` : '')
    + (runnerName ? ` Crate trip turn: ${runnerName}; others cover, but danger or a blocked trip permits changing the order.` : '')
    + ' Intentions are flexible. Rescue, immediate danger, ammunition and humans outrank the plan.').slice(0, 900);
}

const choice = (value, description = value) => ({ value, description });
const question = (name, instructions, values) => ({ name, instructions, choices: values });
export function describeTeamPlan(sim, previous = sim.companionTeamPlan) {
  const companions = bots(sim), wave = planningWave(sim);
  if (!companions.length) return null;
  const available = ARMORY.filter(item => item.weapon !== 'magnum');
  const posts = ['team', 'loft', ...sim.doors.filter(door => !door.sealed).map(door => door.id)];
  const questions = [];
  const roles = { support: 'steady covering fire and flexible defense', close: 'short-range chokepoint; flames for exposed clusters, suitable spare gun for isolated enemies',
    marksman: 'align enemies through doors/stairs; piercing fire at the front of the line', medic: 'human protection, revive kits and safe rescues' };
  companions.forEach((player, index) => {
    const prefix = `bot${index}`, who = text(player.name);
    questions.push(question(`${prefix}_role`, `${who}: choose a flexible role that complements the whole squad.`, TEAM_ROLES.map(value => choice(value, roles[value]))));
    questions.push(question(`${prefix}_goalWeapon`, `${who}: next useful upgrade or explicit savings goal, considering the whole weapon pair, funds, unlocks and teammates. An unaffordable future weapon can be a goal. none means no worthwhile upgrade or savings goal, not merely that you cannot afford one yet.`,
      [choice('none'), ...available.map(item => choice(item.weapon, `${item.weapon}: ${item.price} coins, from wave ${item.unlockWave}`))]));
    questions.push(question(`${prefix}_keepWeapon`, `${who}: which carried weapon best complements the next purchase? This choice protects that slot, so another weapon is replaced. Re-evaluate the pair: do not preserve the starter pistol by habit if keeping a shotgun with an SMG would be more useful. none reserves no slot; emergencies override.`,
      [choice('none'), ...types(player).filter(value => value !== 'magnum').map(value => choice(value))]));
    questions.push(question(`${prefix}_bonus`, `${who}: preferred stacking crate bonus, fitting this companion's equipment and intended build.`,
      [choice('none'), ...Object.keys(SUPPLY_BONUSES).filter(value => claimStep(player, value).to > claimStep(player, value).from).map(value => choice(value))]));
    questions.push(question(`${prefix}_post`, `${who}: preferred cover location, flexible when humans move or a rescue is needed.`, posts.map(value => choice(value, value === 'loft' && IS_HOSPITAL ? 'sheltered basement posts watching up the main and service stairs from their feet; both stairs remain exits'
      : value === 'loft' && IS_FUNFAIR ? 'sheltered cellar posts watching up the main and service stairs from their feet; both stairs remain exits'
        : value === 'loft' && IS_SUPERMARKET ? 'sheltered cellar reserve post by the interior stairs; exterior stair remains a second exit'
          : wetApproach(sim.doors.find(door => door.id === value)) ? `${value} door, guarded from the roofed terrace passage (the doorway is on the open-air terrace, in acid rain)` : POST_WORDS[value] ?? value))));
  });
  questions.push(question('tripLead', 'Who should take the first safe crate trip? Others cover; everyone has their own free bonus. Later companions take turns.', companions.map(player => choice(player.id, text(player.name)))));
  const people = [...sim.players.values()].filter(player => !player.waiting).map(player => ({
    id: player.id, name: text(player.name), kind: player.companion ? 'companion' : 'human', alive: player.alive, downed: player.downed,
    ...(player.companion && companionProfilePrompt(player.companionProfile) ? { profile: companionProfilePrompt(player.companionProfile) } : {}),
    hp: Math.round(player.hp), armor: Math.round(player.armor ?? 0), coins: coins(player.points), kit: player.reviveKit === true, grenades: player.grenades ?? 0,
    character: (() => { const s = characterStats(player); return { maxHp: s.maxHp, move: s.speedMultiplier, reload: s.reloadMultiplier,
      switchSec: s.switchSeconds, rain: s.rainMultiplier, combat: s.combatMultiplier, reviveSec: s.reviveSeconds,
      frost: [s.auraRadius, s.auraSlow], dual: s.dualWield,
      grenadeEverySec: s.grenadeIntervalSeconds, grenadeCap: s.maxGrenades ?? GRENADES.maxCarry,
      grenadeDamage: s.grenadeDamageMultiplier ?? 1 }; })(),
    slots: sim.weaponSlots?.(player), held: player.weapon,
    weapons: weaponEntries(player).map(({ id, weapon, stock }) => ({ id, weapon, ammo: stock.ammo, reserve: stock.reserve })),
    bonuses: Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, player.bonus?.[kind] ?? 0])),
  }));
  const services = Object.entries(LATE_SUPPLIES.items).map(([id, item]) => ({ id, price: item.price, unlockWave: item.unlockWave ?? LATE_SUPPLIES.unlockWave }));
  const previousGoals = previous?.assignments?.filter(item => companions.some(player => player.id === item.id)) ?? [];
  const catalogue = weaponStrategyCatalogue(sim);
  const claimants = [...sim.players.values()].filter(player => crateOpportunity(sim, player));
  const crateWay = claimants.length ? crateOpportunity(sim, claimants[0]).way : null;
  const situation = `Plan for wave ${wave}/${MAX_WAVES}, current phase ${sim.phase}, current wave ${sim.wave}.\n`
    + (IS_HOSPITAL ? "REFUGE: defend L'Hôpital des Pins. Reception and waiting, emergency triage, wards, the nurses' station, operating theatre and chapel occupy the ground floor; pharmacy, linen, boiler and archives shelter the basement. Main and service stairs connect the levels. The loft choice means the basement posts watching up the main and service stairs from their feet; keep both stair routes clear. Concrete floors block shots and vision. Acid rain is outside; umbrella blocks shooting. "
      : IS_FUNFAIR ? 'REFUGE: Grand Palais des Jeux, La Fête Foraine. Ground: ticket booth, games room, prizes, snack bar, bumper cars, circulation. Cellar salle des machines: refuge, shooting gallery, mirror maze, machine room, generator. Main and service stairs are the only cellar routes. The loft choice means the cellar posts watching up those stair feet; keep both clear. Floors block shots and vision. Rain outside; entrance, carousel and stall canopies dry; umbrella blocks shooting. '
        : IS_SUPERMARKET ? 'REFUGE: defend the supermarket. Sales floor, sheltered cellar reserve and open-air delivery terrace form a loop through interior and exterior stairs. The loft choice means the cellar reserve post. Keep both exits clear; concrete floors block shots and vision. Acid rain reaches the terrace and exterior stairs; umbrella blocks shooting. The east door opens from that terrace: it is guarded from the roofed passage in the partition. ' : 'REFUGE: defend the cabin; loft/stairs fallback can trap you. Acid rain outside; umbrella blocks rain and shooting. ')
    + 'Humans choose gear/movement; protect them first. Plan complementary roles, next purchases, retained gear, bonuses and cover. '
    + 'Reassess upgrades/pairs with funds, unlocks and threats. Savings never forbid rescue, ammo or survival purchases. '
    + 'Stagger shopping and crate trips with cover; each survivor gets an independent free bonus. '
    + 'Fixed crate outside: one independent claim each wave 2-18 while active. Safe claims before resealing the last exit; crouch through low gaps, return, then let the next runner go. Danger/rescues override. '
    + 'No unique Magnum for companions.\n'
    + `TEAM ${JSON.stringify(people)}\n`
    + `ARMORY ${JSON.stringify(catalogue)}\n`
    + 'COMBAT EXPERIENCE (owner playtesting, qualitative guidance, not mandatory purchases): SMG is a major pivot over pistol and often shotgun: sustained fire, magazine and penetration. Saving directly is viable; shotgun can bridge/complement. Line enemies through doors/stairs for piercing fire. Flames favor large exposed clusters; prefer a suitable usable spare for 1-2 isolated enemies. Keep safe positions, range and clear solids. Compare roles, bonuses, funds and pressure.\n'
    + `CATALOGUE ASSUMPTIONS ${JSON.stringify(WEAPON_STRATEGY_ASSUMPTIONS)} Base profiles exclude carried bonuses, listed in TEAM.\n`
    + `WAVE NOTES: ${RAIDS.waves.includes(wave) ? 'armed human raiders arrive late; avoid windows and prepare kits' : wave === MAX_WAVES ? 'final boss and extraction; prepare sustained damage and rescue' : wave >= 4 ? 'colossi are possible and can break boards quickly' : 'keep flexible cover and watch runners'}; bots fight within about 20m, short-range weapons require closer positions.\n`
    + `SUPPLY WAVES ${JSON.stringify(SUPPLY_WAVES)}, upcoming ${JSON.stringify(SUPPLY_WAVES.filter(value => value >= wave))}; station ${JSON.stringify(services)}.\n`
    + 'BONUSES: stone +10% melee/level, +1/+2 swing targets at levels4/8; perforating +1/+2/+3 bodies at3/6/8; extended +10% magazine/reserve perlevel; reinforced +15% bullet damage every2levels.\n'
    + `CHARACTER BONUSES (arrays give cumulative N1..N8; one claim raises one level, never compounds): ${JSON.stringify(characterBonusCatalogue())}\n`
    + 'BUILD: match gear/personality. Slow guns favor reload; trips vitamins/rainproof; rescues medic; combat vitality/toughskin. Frost: movement only, not bites/raiders/projectiles; strongest aura only, solids/floors block, bosses half, downed inactive. Recon: personal 25m pulse memories; hidden identities/types/floors/HP tier-limited. Quick hands N8: optional dual wield of two carried ranged instances, independent ammo/reloads; no extra slot or ammunition.\n'
    + 'GRENADIER: +1 grenade each active interval; cap rises at N3/6/8. First after a full interval, never instant or banked at cap. Pause freezes; practice/downed/dead inactive. Damage fixed at throw, grenades only; no larger blast or rockets. Spend on packs when useful, even with a loaded gun.\n'
    + `CRATE ${JSON.stringify(sim.supplyCrate ? { active: sim.supplyCrate.active !== false, wave: sim.supplyCrate.wave, claimed: [...sim.supplyCrate.claimed], outside: true,
      ...(crateWay ? { via: crateWay.door.id, crouch: crateWay.crouch, ready: claimants.map(player => player.id) } : {}) } : null)}\n`
    + `DOORS ${JSON.stringify(sim.doors.filter(door => !door.sealed).map(door => ({ id: door.id, hp: door.hp, maxHp: door.maxHp,
      ...(doorwayPassage(sim, door) ? { passage: doorwayPassage(sim, door).crouch ? 'crouch' : 'standing' } : {}), ...(wetApproach(door) ? { terrace: true, rain: true } : {}) })))}\n`
    + `PREVIOUS INTENTIONS ${JSON.stringify(previousGoals)}`;
  return { wave, signature: planSignature(sim), companions: companions.map(player => player.id), situation: situation.slice(0, 16000), questions };
}

export function normalizeTeamPlan(sim, request, answer, revision = 1) {
  if (!request || answer?.error || !answer?.choices || typeof answer.choices !== 'object' || Array.isArray(answer.choices)) return null;
  if (request.signature !== planSignature(sim) || request.wave !== planningWave(sim)) return null;
  const names = new Set(request.questions.map(item => item.name));
  if (Object.keys(answer.choices).length !== names.size || Object.keys(answer.choices).some(name => !names.has(name))) return null;
  if (request.questions.some(item => !item.choices.some(choice => choice.value === answer.choices[item.name]))) return null;
  const assignments = request.companions.map((id, index) => Object.freeze({ id,
    ...Object.fromEntries(['role', 'goalWeapon', 'keepWeapon', 'bonus', 'post'].map(field => [field, answer.choices[`bot${index}_${field}`]])),
  }));
  const lead = answer.choices.tripLead, ids = request.companions;
  const tripOrder = [lead, ...ids.filter(id => id !== lead)];
  return Object.freeze({ version: TEAM_PLAN_VERSION, wave: request.wave, revision, createdAt: sim.time,
    assignments: Object.freeze(assignments), tripOrder: Object.freeze(tripOrder) });
}
