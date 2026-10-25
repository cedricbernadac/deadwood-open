import { ARMOR, PICKUPS } from './public/rules.js';
import { SUPPLY_CACHES } from './public/expedition.js';
import { LATE_SUPPLIES, BACKPACK, SUPPLY_BONUSES, SUPPLY_WAVES, MAX_BONUS_LEVEL, bonusEntries, upgradedWeapon } from './public/weapon-upgrades.js';
import { RADAR } from './public/radar-rules.js';
import { CHARACTER_BONUSES, characterStats } from './public/character-bonuses.js';
import { bonusDebt, claimStep, debtOf, innateDebt } from './public/character-sheet.js';
import { weaponType, weaponEntries, activeWeaponId, resolveWeaponId } from './public/weapon-inventory.js';

const phases = ['wave', 'countdown', 'intermission'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// These methods share the room's authoritative interaction and inventory rules.
// No client-supplied position, capacity, price or ammunition is trusted.
export const supplyMethods = {
  beginSupplyWave() {
    for (const player of this.players.values()) player.supplyPurchases = [];
    // One recognisable location all night. Inactive waves keep the physical
    // crate but offer no claim; every active wave renews each survivor's choice.
    this.supplyCrate = this.practice ? null : { id: `supply-${this.wave}`, ...SUPPLY_CACHES[0],
      wave: this.wave, active: SUPPLY_WAVES.includes(this.wave), claimed: new Set() };
  },

  // Eligibility follows the weapons carried, not the effect a young level would
  // have today: armor-piercing rounds invest through levels 1-3 with no payoff
  // yet, so the kind of weapon decides rather than the current stat change.
  bonusFitsWeapons(player, bonus) {
    if (Object.hasOwn(CHARACTER_BONUSES, bonus)) return true;
    return Object.keys(player?.inventory ?? {}).some(id => {
      const type = weaponType(id, player.inventory[id]);
      const base = this.weaponProfile(null, type);
      if (bonus === 'stone') return Boolean(base?.melee);
      if (bonus === 'perforating') return Boolean(base) && !base.melee && !base.fuel && !base.explosive && !base.oneShot && !base.upgradeExempt && type !== 'sniper';
      if (bonus === 'extended') return Boolean(base) && base.magazine >= 2;
      // Reinforced rounds: bullet weapons, shotgun and sniper included.
      if (bonus === 'reinforced') return Boolean(base) && !base.melee && !base.fuel && !base.explosive && !base.oneShot && !base.upgradeExempt;
      return false;
    });
  },

  bonusEligible(player, bonus) {
    if (typeof bonus !== 'string' || !Object.hasOwn(SUPPLY_BONUSES, bonus)) return false;
    // A sheet's innate debt is always worth a claim, whatever is carried:
    // repaying it is how its malus goes (the radar still waits for its wave).
    if (bonusDebt(player, bonus) > 0) return bonus !== 'radar' || this.practice || this.wave >= RADAR.unlockWave;
    if (player?.bonus?.[bonus]) return player.bonus[bonus] < MAX_BONUS_LEVEL;
    if (bonus === 'radar') return this.practice || this.wave >= RADAR.unlockWave;
    return this.bonusFitsWeapons(player, bonus);
  },

  normalizeInventory(player) {
    for (const [id, stock] of Object.entries(player.inventory)) {
      const excess = Math.max(0, stock.ammo - this.weaponProfile(player, id).magazine);
      stock.ammo -= excess;
      stock.reserve += excess;
    }
  },

  supplyReach(player, target, reach) {
    return !!player?.alive && !player.downed && phases.includes(this.phase) && !this.practice && !!target
      && distance(player, target) < reach && Math.abs(player.y - (target.y ?? 0)) < .8
      && this.interactionVisible(player, target);
  },

  supplyAction(player) {
    if (player?.y <= .8 && this.doors.some(door => door.hp < door.maxHp && distance(player, door) < 2.25)) return null;
    if (this.supplyCrate?.active !== false && this.supplyReach(player, this.supplyCrate, LATE_SUPPLIES.reach) && !this.supplyCrate.claimed.has(player.id)) return 'crate';
    // The post opens with its earliest item (the revive kit, wave 5).
    if (this.wave >= Math.min(...Object.values(LATE_SUPPLIES.items).map(item => item.unlockWave ?? LATE_SUPPLIES.unlockWave))
      && this.supplyReach(player, LATE_SUPPLIES.position, LATE_SUPPLIES.reach)) return 'station';
    return null;
  },

  openSupplyMenu(player) {
    const menu = this.supplyAction(player);
    if (!menu) return false;
    this.event('supply-menu', { id: player.id, menu, wave: this.wave, ...(menu === 'crate' ? { crateId: this.supplyCrate.id } : {}) });
    return true;
  },

  supplyDenied(id, reason) {
    this.event('supply-denied', { id, reason });
    return false;
  },

  recoverableDropPoint(player, weapon = 'pistol') {
    // This is a geometry probe, including when its owner is down or eliminated.
    // The real player's ability to interact must not prevent a safe death drop.
    const pose = { ...player, alive: true, downed: false };
    return this.groundWeaponPosition(pose, weapon)
      ?? this.groundWeaponPosition({ ...pose, x: -2.8, y: 0, z: 1.7, yaw: 0, grounded: true }, weapon);
  },

  dropBonus(player) {
    const entries = bonusEntries(player.bonus);
    // Debt repaid at the crate is lost with the bonuses: back to the sheet's
    // innate debt (character-sheet.js), even with nothing to drop.
    const innate = innateDebt(player.sheet);
    if (!entries.length) {
      if (Object.keys(SUPPLY_BONUSES).some(kind => debtOf(innate, kind) !== bonusDebt(player, kind))) this.resetSheetDebt?.(player);
      return null;
    }
    const point = this.recoverableDropPoint(player);
    if (!point) return null;
    // Levels travel with their bonus: each carried bonus falls as its own
    // pickup, ready for a teammate at the spot where its owner went down.
    const pickups = entries.map(([kind, level]) => {
      const pickup = { id: `p${this.nextPickupId++}`, kind: 'bonus', ...point, bonus: { kind, level }, expiresAt: this.time + PICKUPS.lifetime };
      this.pickups.set(pickup.id, pickup);
      return pickup;
    });
    const previousStats = characterStats(player);
    player.bonus = null;
    player.sheetDebt = innate;
    this.syncCharacterBonuses?.(player, previousStats);
    this.normalizeInventory(player);
    return pickups;
  },

  claimSupply(id, bonus, crateId) {
    const player = this.players.get(id), crate = this.supplyCrate;
    if (!player || !crate || crate.id !== crateId) return this.supplyDenied(id, 'missing');
    if (crate.active === false || !SUPPLY_WAVES.includes(this.wave)) return this.supplyDenied(id, 'unavailable');
    if (!this.supplyReach(player, crate, LATE_SUPPLIES.reach)) return this.supplyDenied(id, 'out-of-reach');
    if (crate.claimed.has(id)) return this.supplyDenied(id, 'claimed');
    if (!this.bonusEligible(player, bonus)) return this.supplyDenied(id, 'ineligible');
    // Choices stack: a new bonus joins the carried set, a repeat raises its
    // level. The sheet decides the step (claimStep): a debt is repaid first,
    // a talent family climbs two levels at a time.
    const previousStats = characterStats(player), step = claimStep(player, bonus);
    if (step.level > 0) (player.bonus ??= {})[bonus] = step.level;
    if (step.debt > 0) player.sheetDebt[bonus] = step.debt;
    else if (player.sheetDebt) delete player.sheetDebt[bonus];
    crate.claimed.add(id);
    this.syncCharacterBonuses?.(player, previousStats);
    this.normalizeInventory(player);
    this.event('supply-claimed', { id, bonus, level: player.bonus?.[bonus] ?? 0, ...(step.repay ? { repaid: true, effective: step.to } : {}) });
    return true;
  },

  nearbyBonus(player) {
    if (!player?.alive || player.downed || !phases.includes(this.phase)) return null;
    return [...this.pickups.values()].filter(pickup => pickup.kind === 'bonus' && pickup.expiresAt > this.time
      && this.canCollectPickup(player, pickup) && this.interactionVisible(player, pickup))
      .sort((a, b) => distance(player, a) - distance(player, b) || a.id.localeCompare(b.id))[0] ?? null;
  },

  takeBonus(id, pickupId) {
    const player = this.players.get(id), pickup = this.pickups.get(pickupId);
    if (!player || pickup !== this.nearbyBonus(player) || player.interactAfter > this.time) return false;
    if (!pickup.bonus || !this.bonusEligibleForPickup(player, pickup.bonus)) return this.supplyDenied(id, 'ineligible');
    const previousStats = characterStats(player);
    this.pickups.delete(pickup.id);
    (player.bonus ??= {})[pickup.bonus.kind] = pickup.bonus.level;
    this.syncCharacterBonuses?.(player, previousStats);
    this.normalizeInventory(player);
    player.interactAfter = this.time + .3;
    this.event('supply-claimed', { id, bonus: pickup.bonus.kind, level: pickup.bonus.level });
    return true;
  },

  // A ground pickup keeps its own level; carrying the same kind already means
  // there is nothing to gain, unlike a crate claim which raises the level.
  bonusEligibleForPickup(player, bonus) {
    return !!bonus?.kind && Object.hasOwn(SUPPLY_BONUSES, bonus.kind) && !player.bonus?.[bonus.kind]
      && (bonus.kind === 'radar' ? this.practice || this.wave >= RADAR.unlockWave : this.bonusFitsWeapons(player, bonus.kind));
  },

  buySupply(id, service) {
    if (typeof service !== 'string') return this.supplyDenied(id, 'unavailable');
    const player = this.players.get(id), item = LATE_SUPPLIES.items[service];
    if (!player || !Object.hasOwn(LATE_SUPPLIES.items, service ?? '') || !item
      || this.wave < (item.unlockWave ?? LATE_SUPPLIES.unlockWave)) return this.supplyDenied(id, 'unavailable');
    if (!this.supplyReach(player, LATE_SUPPLIES.position, LATE_SUPPLIES.reach)) return this.supplyDenied(id, 'out-of-reach');
    if (service === 'backpack' && player.backpack === true) return this.supplyDenied(id, 'owned');
    if (service === 'revive' && player.reviveKit === true) return this.supplyDenied(id, 'carried');
    if ((player.supplyPurchases ?? []).includes(service)) return this.supplyDenied(id, 'purchased');
    if (service === 'grenade' && player.grenades >= characterStats(player).maxGrenades || service === 'armor' && player.armor >= ARMOR.max) return this.supplyDenied(id, 'full');
    // Owner, 16 October: ran dry alone with coins to spare — the ammo service
    // is a full refill of every firearm carried (magazine and reserve, bonus
    // levels included), not a top-up of the one in hand.
    const dry = service === 'ammo' ? Object.entries(player.inventory).filter(([weaponId, carried]) => {
      const profile = this.weaponProfile(player, weaponId);
      return profile && !profile.melee && carried.ammo + carried.reserve < profile.magazine + profile.reserve;
    }) : null;
    if (service === 'ammo' && !dry.length) return this.supplyDenied(id, 'full');
    if (player.points < item.price) return this.supplyDenied(id, 'funds');
    player.points -= item.price;
    (player.supplyPurchases ??= []).push(service);
    if (service === 'grenade') player.grenades++;
    if (service === 'armor') player.armor = ARMOR.max;
    if (service === 'ammo') for (const [weaponId, carried] of dry) {
      const profile = this.weaponProfile(player, weaponId);
      carried.reserve = profile.magazine + profile.reserve - carried.ammo;
    }
    if (service === 'backpack') player.backpack = true;
    if (service === 'revive') player.reviveKit = true;
    this.event('supply-purchased', { id, service, price: item.price });
    return true;
  },

  magnumAvailable() {
    // A reserved seat of a restored night keeps its Magnum for its player.
    return ![...this.players.values(), ...(this.reservedSeats?.values() ?? [])].some(player => weaponEntries(player).some(entry => entry.weapon === 'magnum'))
      && ![...this.pickups.values()].some(pickup => pickup.kind === 'weapon' && pickup.weapon === 'magnum');
  },

  dropUniqueMagnum(player) {
    const magnumId = resolveWeaponId(player, 'magnum');
    if (this.practice || !magnumId) return;
    const point = this.recoverableDropPoint(player, 'magnum');
    if (!point) throw new Error('No reachable support for the unique Magnum');
    const stock = player.inventory[magnumId];
    const pickup = { id: `p${this.nextPickupId++}`, kind: 'weapon', weapon: 'magnum', ...point, ...stock, expiresAt: Infinity };
    this.pickups.set(pickup.id, pickup);
    delete player.inventory[magnumId];
    if (player.weapon === 'magnum') {
      this.selectInventoryWeapon(player, Object.keys(player.inventory)[0] ?? null);
      player.reloadUntil = 0;
    }
    this.event('weapon-drop', { id: player.id, pickupId: pickup.id, weapon: 'magnum', ...stock });
  },
};
