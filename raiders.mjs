import { RAIDS, RAID_ENTRIES, RAIDER_LOADOUTS, RAIDER_AIM_TUNING, DRILL_LOADOUTS, RAIDER_PLANK_DAMAGE, raidIndex, raidPlayers, raidTotal, raidSquad, raidDamageScale, raiderLoadout } from './public/raids.js';
import { ENEMY_PROFILES, enemyPosture, enemyHitbox, enemyDamageMultiplier } from './public/enemies.js';
import { BARRICADE_BOARDS, PICKUPS, FLAMETHROWER, EXTERIOR, playerEyeHeight, playerHeight, playerHitbox, difficultyOf, isFrissonLike } from './public/rules.js';
import { HAS_SPACE } from './public/level-config.js';
import { spaceCanOccupy } from './public/level-space.js';

// Close faster without sprinting as fast as a survivor; retreat is unchanged.
const RAIDER_SPEEDS = Object.freeze({ advance: 3.2, breach: 2.9, assault: 2.6, strafe: 1.5, retreat: RAIDS.retreatSpeed });
const RAIDER_RADIUS = .29, WARNING_SPACING = .58, THIRD_RAIDER_OFFSET = 1.2, ENTRY_RETRY = .5;
const STUCK_AFTER = 20, STUCK_DISTANCE = 1, LOOT_EXTENSION = 60, DRILL_DISTANCE = 16, DRILL_SPREAD = 2.5;
const STUCK_STATES = ['advance', 'breach', 'assault'];
// Section 4: perception and aim. Sight and bullets share one muzzle.
const RAIDER_AIM = Object.freeze({
  sightInterval: .2, sightMargin: 4, sightHeight: 6, samples: Object.freeze([.62, .35, .92]),
  muzzleStanding: 1.5, muzzleCrouched: .95, muzzleForward: .3,
  memory: 1.5, fresh: 1, peekHidden: .4, ...RAIDER_AIM_TUNING,
  flinch: .08, flinchTime: .6, flinchDelay: .3, suppress: .03, suppressTime: 1.5,
  friendlyLine: 1.5, friendlyRetry: .15, falloffCap: 1.15, shotsPerTick: 2,
});
// Section 5: the squad's movement and timing.
const RAIDER_BEHAVIOUR = Object.freeze({
  stagingDistance: 7.5, stagingReach: 1, hold: Object.freeze([.65, 1.05]), strafe: 1.5, engage: Object.freeze([4.5, 2.5]),
  followerDelay: 2.5, blind: 1.8, lowHp: .35, assaultHold: 4.5, adjacent: .92, outdoorApproach: 9, strafeClearance: 1, masked: .5,
});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const milli = value => Math.round(value * 1000) / 1000;
const isRaider = zombie => zombie?.kind === 'raider';
const sideEntries = doorId => RAID_ENTRIES.filter(entry => entry.doorId === doorId);
const aimPoint = (player, share) => ({ x: player.x, y: player.y + playerHeight(player) * share, z: player.z });
const playerBox = playerHitbox;
const between = ([low, high], random) => high > low ? low + (high - low) * random() : low;
// Breach with no survivor in reach: the zombie routing toward the cabin centre.
const CABIN_CENTRE = Object.freeze({ id: null, x: 0, y: 0, z: 0, alive: false, downed: true, crouched: false });
// A third squad member takes entry A, shifted away from the door axis.
function entryPoint(door, entry, squadOrdinal) {
  const axis = door.outZ ? 'x' : 'z', shift = Math.floor(squadOrdinal / 2) * THIRD_RAIDER_OFFSET * Math.sign(entry[axis] - door[axis]);
  return { x: entry.x + (axis === 'x' ? shift : 0), z: entry.z + (axis === 'z' ? shift : 0), entryId: entry.id };
}

// Raid lifecycle and raider AI mixin. simulation.mjs passes its private
// geometry helpers, so this module imports only shared public rules and never
// the simulation back.
export function createRaiderMethods({ rayBox, rayBoard, WEAPONS, damageFalloff, bodyRadius, outsideCabin, WORLD }) {
  const cabinGap = body => Math.hypot(Math.max(0, Math.abs(body.x) - WORLD.width / 2), Math.max(0, Math.abs(body.z) - WORLD.depth / 2));
  const pelletDamage = (gun, travelled) => gun.damage * Math.min(RAIDER_AIM.falloffCap, damageFalloff(WEAPONS[gun.ref], travelled));
  return {
    // Called by beginWave after its balance setup. Draws no random number.
    planRaid() {
      this.raidWarnings.clear();
      for (const zombie of [...this.zombies.values()]) if (isRaider(zombie)) this.zombies.delete(zombie.id);
      this.raidLootIds.clear();
      const index = raidIndex(this.wave);
      if (this.practice || !this.raidsEnabled || !index) return (this.raid = null);
      const players = raidPlayers(this.wavePlayerCount ?? this.participantCount());
      this.raid = { index, wave: this.wave, players, total: raidTotal(index, players), squad: raidSquad(players), damageScale: raidDamageScale(players),
        spawned: 0, killed: 0, retreated: 0, triggered: false, triggeredAt: null,
        zombiesDoneAt: null, holdSince: null, lastSquadAt: null, squads: 0,
        sideStart: 0, sideStep: 1, cleared: false, over: false, bonus: 0, retreatAt: null };
      return this.raid;
    },

    raidSettled() {
      const raid = this.raid;
      return !raid || raid.cleared || raid.over || !this.raidsEnabled;
    },

    // Every count is derived from state: unreleased + announced + present.
    raidCounts() {
      const raid = this.raid;
      let alive = 0;
      for (const zombie of this.zombies.values()) if (isRaider(zombie) && !zombie.drill) alive++;
      const pending = raid?.triggered ? raid.total - raid.spawned + this.raidWarnings.size : 0;
      return { alive, pending, remaining: raid?.triggered ? pending + alive : 0 };
    },

    raidPending() {
      return this.raid?.triggered && !this.raid.cleared ? this.raidCounts().pending : 0;
    },

    zombieCount() {
      let count = 0;
      for (const zombie of this.zombies.values()) if (!isRaider(zombie)) count++;
      return count;
    },

    nextRaidWave() {
      return this.phase === 'intermission' && this.raidsEnabled && !this.practice && raidIndex(this.wave + 1) ? this.wave + 1 : null;
    },

    activeRaidDoors() {
      const active = this.doors.filter(door => !door.sealed && !door.sealPending);
      return active.length ? active : this.doors;
    },

    updateRaid(delta, living) {
      const raid = this.raid;
      if (this.practice || !raid || raid.over || raid.cleared) return;
      if (!raid.triggered && !this.triggerRaid(living)) return;
      // Freed slots can keep releasing squads; the trigger cap bounds the whole raid.
      if (raid.retreatAt === null && (this.time - raid.lastSquadAt >= RAIDS.capAfterLastSquad - 1e-8
        || this.time - raid.triggeredAt >= RAIDS.capAfterTrigger - 1e-8)) this.raidCapRetreat();
      else if (raid.retreatAt === null) this.releaseDueSquad();
      this.updateRaidWarnings();
      this.checkRaidCleared();
    },

    triggerRaid(living) {
      const raid = this.raid;
      if (this.toSpawn > 0) return false;
      raid.zombiesDoneAt ??= this.time;
      let live = this.spawnWarnings.size;
      for (const zombie of this.zombies.values()) if (!isRaider(zombie)) live += zombie.kind === 'brute' ? RAIDS.bruteWeight : 1;
      const threshold = RAIDS.triggerBase + RAIDS.triggerPerPlayer * raid.players;
      const ready = live <= threshold
        || this.time - raid.zombiesDoneAt >= RAIDS.fallbackAfter - 1e-8 && live <= RAIDS.fallbackFactor * threshold;
      if (!ready) return false;
      // A fuel run or a far survivor delays the assault, never indefinitely.
      if (living.some(player => this.fuel?.carrierId === player.id || Math.hypot(player.x, player.z) > RAIDS.holdDistance)) {
        raid.holdSince ??= this.time;
        if (this.time - raid.holdSince < RAIDS.holdForFuel - 1e-8) return false;
      }
      const doors = this.activeRaidDoors();
      raid.triggered = true;
      raid.triggeredAt = this.time;
      raid.sideStart = Math.floor(this.random() * doors.length) % doors.length;
      raid.sideStep = this.random() < .5 ? 1 : -1;
      const squad = this.releaseRaidSquad(raid.squad);
      this.event('raid', { index: raid.index, wave: raid.wave, total: raid.total, squad: raid.squad, side: squad.side,
        entries: squad.entries, damageScale: raid.damageScale });
      return true;
    },

    releaseRaidSquad(size) {
      const raid = this.raid, doors = this.activeRaidDoors(), count = doors.length;
      const door = doors[((raid.sideStart + raid.squads * raid.sideStep) % count + count) % count];
      const entries = sideEntries(door.id), released = Math.max(0, Math.min(size, raid.total - raid.spawned));
      for (let slot = 0; slot < released; slot++) {
        const point = entryPoint(door, entries[slot % 2], slot);
        const raider = this.createRaider(raid.spawned + 1, entries[slot % 2], raid, { door, squadOrdinal: slot, squadId: raid.squads + 1, point });
        // Solo: the squad's second raider is announced a few seconds later.
        this.queueRaider(raider, point, entryPoint(door, entries[(slot + 1) % 2], slot), raid.players === 1 && slot === 1 ? RAIDS.soloStagger : 0);
        raid.spawned++;
      }
      raid.squads++;
      raid.lastSquadAt = this.time;
      return { side: door.id, count: released, entries: entries.map(({ x, z }) => ({ x, z })) };
    },

    // At most squad + floor(squad / 2) raiders are ever up: the timer release
    // fills only the room left under that cap.
    releaseDueSquad() {
      const raid = this.raid;
      if (raid.spawned >= raid.total) return false;
      const up = this.raidCounts().alive + this.raidWarnings.size, half = Math.floor(raid.squad / 2);
      const due = up <= half || this.time - raid.lastSquadAt >= RAIDS.nextSquadAfter[raid.players - 1] - 1e-8 && up <= raid.squad;
      if (!due) return false;
      const squad = this.releaseRaidSquad(Math.min(raid.squad, raid.squad + half - up));
      this.event('raid-squad', { index: raid.index, side: squad.side, count: squad.count, entries: squad.entries });
      return true;
    },

    createRaider(ordinal, entry, plan, { door = this.doors.find(item => item.id === entry.doorId), squadOrdinal = 0, squadId = 0, drill = false,
      loadout = raiderLoadout(plan.index, ordinal), point = entry } = {}) {
      const strength = this.practice ? 1 : difficultyOf(this.difficulty).raiders;
      const hp = Math.round(RAIDS.hp[plan.index - 1] * strength), axis = door.outZ ? 'x' : 'z', offset = [-3, 0, 3][squadOrdinal % 3];
      const out = RAIDER_BEHAVIOUR.stagingDistance;
      return {
        id: `r${this.nextRaiderId++}`, kind: 'raider', faction: 'raider', source: 'raider',
        raidIndex: plan.index, ordinal, squadOrdinal, squadId, drill,
        x: point.x, y: 0, z: point.z, yaw: Math.atan2(point.x, point.z), pitch: 0,
        hp, maxHp: hp, bodyDamage: RAIDS.bodyDamage[plan.index - 1], scale: 1, boss: false,
        doorId: door.id, spawnEntryId: entry.id ?? null, farSpawn: false, entered: false,
        speed: RAIDER_SPEEDS.advance, attackAfter: 0, damage: ENEMY_PROFILES.raider.damage * plan.damageScale * strength,
        attackInterval: ENEMY_PROFILES.raider.attackInterval, barricadeDamage: ENEMY_PROFILES.raider.barricadeDamage,
        stairState: null, pushX: 0, pushZ: 0, pushLeft: 0,
        loadout, ammo: RAIDER_LOADOUTS[loadout].magazine, reloadUntil: 0, crouched: false, damageScale: plan.damageScale * strength,
        // AI state stays out of navigation/portalRoute/stairState, which knockback clears.
        ai: { state: 'advance',
          stagingX: door.x + door.outX * out + (axis === 'x' ? offset : 0), stagingZ: door.z + door.outZ * out + (axis === 'z' ? offset : 0),
          targetId: null, aimingAt: null, seenAt: -Infinity, hiddenSince: -Infinity,
          reactionUntil: 0, acquiredAt: 0, settleAmplitude: RAIDER_AIM.settle, nextShotAt: 0, burstLeft: 0, firedAt: -Infinity,
          flinchUntil: 0, lastHp: hp, burning: false, engageUntil: 0, engagedAt: null, breachStartedAt: null, holdUntil: 0,
          strafeSign: ordinal % 2 ? 1 : -1, strafeLeft: 0, strafeX: null, strafeZ: null, strafeUntil: 0,
          nextSightAt: 0, sight: null, lastSeenX: null, lastSeenY: null, lastSeenZ: null,
          suppressUntil: 0, armed: false, moving: null, holding: false, blockedAt: -Infinity,
          movedAt: this.time, movedX: point.x, movedZ: point.z, replanned: false, retreatStartedAt: null,
          spawnedAt: this.time, homeX: point.x, homeZ: point.z },
      };
    },

    queueRaider(raider, point, alternate = null, delay = 0) {
      const announceAt = this.time + delay;
      const warning = { id: raider.id, raider, x: point.x, z: point.z, alternate, announceAt, readyAt: announceAt + RAIDS.warning };
      this.raidWarnings.set(warning.id, warning);
      return warning;
    },

    raidEntryClear(warning, point) {
      if (!this.canOccupy(warning.raider, point.x, point.z, 0, RAIDER_RADIUS)) return false;
      for (const other of this.zombies.values()) if (other.hp > 0 && distance(point, other) < RAIDER_RADIUS + bodyRadius(other)) return false;
      for (const other of this.raidWarnings.values()) if (other !== warning && distance(point, other) < WARNING_SPACING) return false;
      for (const other of this.spawnWarnings.values()) if (distance(point, other) < WARNING_SPACING) return false;
      for (const player of this.players.values()) if (player.alive && distance(point, player) < RAIDS.entryClearance) return false;
      return true;
    },

    // A blocked entry tries the side's other entry, then retries shortly after.
    updateRaidWarnings() {
      for (const warning of [...this.raidWarnings.values()]) {
        if (this.time + 1e-8 < warning.readyAt) continue;
        const point = [warning, warning.alternate].find(candidate => candidate && this.raidEntryClear(warning, candidate));
        if (!point) { warning.readyAt = this.time + ENTRY_RETRY; continue; }
        this.raidWarnings.delete(warning.id);
        this.materializeRaider(warning.raider, point);
      }
    },

    materializeRaider(raider, point = raider) {
      Object.assign(raider, { x: point.x, z: point.z, yaw: Math.atan2(point.x, point.z) });
      if (point.entryId) raider.spawnEntryId = point.entryId;
      // Sight checks are staggered by ordinal over the 0.2 s cadence.
      Object.assign(raider.ai, { movedAt: this.time, movedX: point.x, movedZ: point.z, spawnedAt: this.time, homeX: point.x, homeZ: point.z,
        nextSightAt: this.time + (raider.ordinal % 6) * RAIDER_AIM.sightInterval / 6 });
      this.zombies.set(raider.id, raider);
      return raider;
    },

    raidCapRetreat() {
      const raid = this.raid, ids = [];
      raid.retreatAt = this.time;
      // Dropped and unreleased raiders count as withdrawn: killed + retreated reaches total.
      raid.retreated += this.raidWarnings.size + raid.total - raid.spawned;
      this.raidWarnings.clear();
      raid.spawned = raid.total;
      for (const raider of this.zombies.values()) {
        if (!isRaider(raider) || raider.drill) continue;
        this.beginRaiderRetreat(raider);
        ids.push(raider.id);
      }
      this.event('raid-retreat', { index: raid.index, ids });
    },

    checkRaidCleared() {
      const raid = this.raid;
      if (!raid.triggered || raid.cleared || raid.spawned < raid.total || this.raidWarnings.size || this.raidCounts().alive) return false;
      raid.cleared = true;
      // Paid in proportion to the raiders killed: waiting out the cap earns nothing.
      raid.bonus = Math.round((RAIDS.clearBonus[raid.index - 1] ?? 0) * raid.killed / raid.total);
      if (raid.bonus > 0) for (const player of this.players.values()) if (player.alive) this.awardPoints(player, raid.bonus);
      for (const id of this.raidLootIds) {
        const pickup = this.pickups.get(id);
        if (pickup) pickup.expiresAt = Math.max(pickup.expiresAt, this.time + LOOT_EXTENSION);
      }
      this.event('raid-cleared', { index: raid.index, wave: raid.wave, killed: raid.killed, retreated: raid.retreated, bonus: raid.bonus });
      return true;
    },

    // One raider tick: wounds, sight, movement, then posture, the visible aim
    // and fire from the post-movement muzzle. Retreat holds fire.
    updateRaider(raider, delta, living) {
      const ai = raider.ai, gun = RAIDER_LOADOUTS[raider.loadout];
      if (ai.state === 'retreat') return this.updateRaiderRetreat(raider, delta, living);
      if (raider.reloadUntil > 0 && this.time + 1e-9 >= raider.reloadUntil) { raider.ammo = gun.magazine; raider.reloadUntil = 0; }
      this.raiderFlinch(raider, delta);
      this.raiderValidateTarget(raider);
      if (this.time + 1e-9 >= ai.nextSightAt) {
        ai.nextSightAt = ai.nextSightAt + RAIDER_AIM.sightInterval > this.time + 1e-9 ? ai.nextSightAt + RAIDER_AIM.sightInterval : this.time + RAIDER_AIM.sightInterval;
        this.updateRaiderSight(raider, living);
      }
      ai.moving = null; ai.holding = false;
      if (ai.state === 'advance') this.raiderAdvance(raider, delta);
      else if (ai.state === 'engage') this.raiderEngageStep(raider, delta, living);
      else if (ai.state === 'breach') this.raiderBreachStep(raider, delta);
      else if (ai.state === 'assault') this.raiderAssaultStep(raider, delta, living);
      if (ai.state === 'retreat') return false;
      this.raiderPosture(raider, living);
      this.raiderAim(raider);
      this.raiderFire(raider);
      // A deliberate hold, a plank bash or a melee blow is not being stuck.
      if (ai.holding || raider.attackAfter > this.time) Object.assign(ai, { movedAt: this.time, movedX: raider.x, movedZ: raider.z });
      this.raiderStuckGuard(raider);
      return false;
    },

    raiderTarget(raider) {
      return raider.ai.targetId ? this.players.get(raider.ai.targetId) ?? null : null;
    },

    // A downed, eliminated, departed or far survivor is dropped at once.
    raiderValidateTarget(raider) {
      const ai = raider.ai, player = this.raiderTarget(raider);
      if (!ai.targetId || player?.alive && !player.downed && Math.hypot(player.x, player.z) <= RAIDS.targetRadius) return false;
      Object.assign(ai, { targetId: null, aimingAt: null, sight: null, hiddenSince: -Infinity, nextSightAt: this.time });
      return true;
    },

    // Damage is read from hp, so every weapon path flinches without a hook.
    // Burn ticks are ignored; only a fresh flinch delays the next shot.
    raiderFlinch(raider, delta) {
      const ai = raider.ai, burning = Number.isFinite(raider.burnUntil);
      const allowance = burning || ai.burning ? FLAMETHROWER.burnDps * delta + 1e-6 : 1e-9;
      const drop = ai.lastHp - raider.hp;
      ai.lastHp = raider.hp; ai.burning = burning;
      if (!(drop > allowance)) return false;
      if (this.time >= ai.flinchUntil) ai.nextShotAt = Math.max(ai.nextShotAt, this.time) + RAIDER_AIM.flinchDelay;
      ai.flinchUntil = this.time + RAIDER_AIM.flinchTime;
      // Wounded far out, a raider dashes in rather than trading shots from the treeline.
      const shooter = this.raiderTarget(raider);
      if (ai.state === 'advance' && shooter && distance(raider, shooter) <= RAIDER_AIM.advanceFireRange) this.raiderEngage(raider);
      return true;
    },

    // The bullets' solid set, built once per tick (and again if a seal lands).
    raiderSolids() {
      const sealed = this.doors.reduce((mask, door, index) => door.sealed ? mask | 1 << index : mask, 0), cache = this.raiderSolidCache;
      if (cache?.time !== this.time || cache.sealed !== sealed) this.raiderSolidCache = { time: this.time, sealed, boxes: this.solidBoxes() };
      return this.raiderSolidCache.boxes;
    },

    // Intact boards along origin + direction * length, nearest first. Only
    // doors whose plane the segment spans are tested.
    raiderBoardHits(origin, direction, length) {
      const hits = [];
      for (const door of this.doors) {
        if (door.sealed) continue;
        const axis = door.outX ? 'x' : 'z', start = origin[axis] - door[axis], end = start + direction[axis] * length;
        if (Math.min(start, end) > .2 || Math.max(start, end) < -.2) continue;
        for (const board of BARRICADE_BOARDS) {
          if (door.boards[board.index] <= 0) continue;
          const hitAt = rayBoard(origin, direction, door, board, length);
          if (hitAt < length) hits.push({ door, boardIndex: board.index, hitAt });
        }
      }
      return hits.sort((a, b) => a.hitAt - b.hitAt);
    },

    raiderMuzzle(raider, point, crouched = raider.crouched) {
      let dx = point.x - raider.x, dz = point.z - raider.z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-6) { dx /= length; dz /= length; } else { dx = -Math.sin(raider.yaw); dz = -Math.cos(raider.yaw); }
      return { x: raider.x + dx * RAIDER_AIM.muzzleForward, y: raider.y + (crouched ? RAIDER_AIM.muzzleCrouched : RAIDER_AIM.muzzleStanding),
        z: raider.z + dz * RAIDER_AIM.muzzleForward };
    },

    raiderCandidates(raider, living) {
      const reach = RAIDER_LOADOUTS[raider.loadout].range + RAIDER_AIM.sightMargin;
      return living.filter(player => player.alive && !player.downed && Math.abs(player.y - raider.y) < RAIDER_AIM.sightHeight
        && Math.hypot(player.x, player.z) <= RAIDS.targetRadius && distance(raider, player) <= reach);
    },

    // The first visible sample, chest, then hips, then head, from the
    // standing muzzle; crouchSees tells whether the crouched muzzle sees it.
    raiderTargetPoint(raider, player) {
      for (const share of RAIDER_AIM.samples) {
        const point = aimPoint(player, share);
        if (this.raiderLineClear(this.raiderMuzzle(raider, point, false), point)) {
          return { share, point, crouchSees: this.raiderLineClear(this.raiderMuzzle(raider, point, true), point) };
        }
      }
      return null;
    },

    // Sticky targeting: keep a visible target; after 1.5 s without sight,
    // take the nearest visible survivor (ties by id).
    updateRaiderSight(raider, living) {
      const ai = raider.ai, candidates = this.raiderCandidates(raider, living);
      const current = candidates.find(player => player.id === ai.targetId) ?? null;
      let player = null, seen = current && this.raiderTargetPoint(raider, current);
      if (seen) player = current;
      else if (!current || this.time - ai.seenAt >= RAIDER_AIM.memory - 1e-9) {
        candidates.sort((a, b) => distance(raider, a) - distance(raider, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const candidate of candidates) if ((seen = this.raiderTargetPoint(raider, candidate))) { player = candidate; break; }
      }
      if (player) {
        if (player.id !== ai.targetId || this.time - ai.seenAt > RAIDER_AIM.fresh + 1e-9) this.raiderAcquire(raider, false);
        else if (Number.isFinite(ai.hiddenSince) && this.time - ai.hiddenSince >= RAIDER_AIM.peekHidden - 1e-9) this.raiderAcquire(raider, true);
        Object.assign(ai, { targetId: player.id, seenAt: this.time, hiddenSince: -Infinity,
          lastSeenX: seen.point.x, lastSeenY: seen.point.y, lastSeenZ: seen.point.z,
          sight: { id: player.id, share: seen.share, visible: true, crouchSees: seen.crouchSees } });
      } else if (current && this.time - ai.seenAt < RAIDER_AIM.memory - 1e-9) {
        if (!Number.isFinite(ai.hiddenSince)) ai.hiddenSince = this.time;
        ai.sight = { ...ai.sight, visible: false, crouchSees: false };
      } else Object.assign(ai, { targetId: null, sight: null, hiddenSince: -Infinity });
      return ai.sight;
    },

    // No shot before reactionUntil. A peek after >= 0.4 s hidden is quicker.
    raiderAcquire(raider, peek) {
      const ai = raider.ai, [base, spread] = peek ? RAIDER_AIM.peek : raider.raidIndex >= 3 ? RAIDER_AIM.reactionRaid3 : RAIDER_AIM.reaction;
      Object.assign(ai, { reactionUntil: this.time + base + spread * this.random(), acquiredAt: this.time,
        settleAmplitude: peek ? RAIDER_AIM.peekSettle : RAIDER_AIM.settle });
    },

    // Where the raider aims now: the live sample while visible, otherwise the
    // last seen point (suppressive fire).
    raiderAimPoint(raider) {
      const ai = raider.ai, player = this.raiderTarget(raider);
      if (!player) return null;
      if (ai.sight?.visible) return aimPoint(player, ai.sight.share);
      return ai.lastSeenX === null ? null : { x: ai.lastSeenX, y: ai.lastSeenY, z: ai.lastSeenZ };
    },

    // The tell: from acquisition on, the body and gun face the target.
    raiderAim(raider) {
      const ai = raider.ai, point = this.raiderAimPoint(raider);
      ai.aimingAt = point ? ai.targetId : null;
      if (!point) { raider.pitch = 0; return false; }
      const origin = this.raiderMuzzle(raider, point);
      if (distance(raider, point) > 1e-6) raider.yaw = Math.atan2(-(point.x - raider.x), -(point.z - raider.z));
      raider.pitch = Math.atan2(point.y - origin.y, Math.hypot(point.x - origin.x, point.z - origin.z));
      return true;
    },

    // Crouch only while still, and only when the crouched muzzle sees the
    // target point: to fire in engage/assault, when badly hurt, or to reload.
    raiderPosture(raider, living) {
      const ai = raider.ai, lowHp = raider.hp < RAIDER_BEHAVIOUR.lowHp * raider.maxHp, sight = ai.sight;
      let crouched = false;
      if (ai.moving === null) {
        if (raider.reloadUntil > this.time) crouched = true;
        else if (sight?.visible) crouched = (lowHp || ai.state === 'engage' || ai.state === 'assault') && sight.crouchSees;
        else crouched = lowHp;
      }
      if (crouched === raider.crouched) return false;
      raider.crouched = crouched;
      if (ai.targetId) this.updateRaiderSight(raider, living);
      return true;
    },

    raiderAimError(raider, player, origin, point, suppress = false) {
      const ai = raider.ai, gun = RAIDER_LOADOUTS[raider.loadout];
      const settle = ai.settleAmplitude * Math.exp(-(this.time - ai.acquiredAt) / RAIDER_AIM.settleTime);
      let motion = 0;
      const dx = point.x - origin.x, dz = point.z - origin.z, horizontal = Math.hypot(dx, dz);
      if (player && horizontal > 1e-6) {
        const lateral = Math.abs((player.motionX ?? 0) * dz - (player.motionZ ?? 0) * dx) / horizontal;
        motion = Math.min(RAIDER_AIM.motionMax, RAIDER_AIM.motionGain * lateral / Math.max(RAIDER_AIM.motionFloor, Math.hypot(dx, point.y - origin.y, dz)));
      }
      const self = ai.moving === 'run' ? RAIDER_AIM.running : ai.moving === 'strafe' ? RAIDER_AIM.strafing : 0;
      return gun.spread + settle + motion + self + (this.time < ai.flinchUntil ? RAIDER_AIM.flinch : 0) + (suppress ? RAIDER_AIM.suppress : 0);
    },

    // Two draws, mapped uniformly onto the unit disk (as the player shotgun).
    raiderDisk() {
      const horizontal = this.random() * 2 - 1, vertical = this.random() * 2 - 1;
      if (horizontal === 0 && vertical === 0) return [0, 0];
      const major = Math.abs(horizontal) > Math.abs(vertical), radius = major ? horizontal : vertical;
      const angle = major ? Math.PI / 4 * (vertical / horizontal) : Math.PI / 2 - Math.PI / 4 * (horizontal / vertical);
      return [radius * Math.cos(angle), radius * Math.sin(angle)];
    },

    // The first body on the exact aim line: a squad-mate within 1.5 m of it
    // holds the shot back.
    raiderLineBlocked(raider, origin, point) {
      const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z;
      const flat = dx * dx + dz * dz, total = Math.hypot(dx, dy, dz);
      if (flat < 1e-9) return false;
      const direction = { x: dx / total, y: dy / total, z: dz / total };
      let first = null;
      for (const other of this.zombies.values()) {
        if (other === raider || !(other.hp > 0)) continue;
        let along;
        if (isRaider(other)) {
          const t = ((other.x - origin.x) * dx + (other.z - origin.z) * dz) / flat, lineY = origin.y + dy * t;
          if (t <= 0 || t >= 1 || Math.hypot(origin.x + dx * t - other.x, origin.z + dz * t - other.z) >= RAIDER_AIM.friendlyLine
            || lineY < other.y - .3 || lineY > other.y + enemyPosture(other).height + .3) continue;
          along = t * total;
        } else if (!((along = rayBox(origin, direction, enemyHitbox(other), total)) < total)) continue;
        if (!first || along < first.along) first = { other, along };
      }
      return isRaider(first?.other);
    },

    // Bursts at the loadout interval, then a pause; carry-over scheduling
    // keeps the table cadence at 30 Hz (at most two shots per tick).
    raiderFire(raider) {
      const ai = raider.ai, gun = RAIDER_LOADOUTS[raider.loadout], player = this.raiderTarget(raider);
      if (raider.ammo <= 0) this.raiderReload(raider);
      const visible = !!player && !!ai.sight?.visible;
      const suppress = !!player && !visible && ai.lastSeenX !== null && ai.firedAt >= ai.acquiredAt && this.time - ai.seenAt <= RAIDER_AIM.suppressTime + 1e-9;
      const point = (visible || suppress) && this.raiderAimPoint(raider), origin = point && this.raiderMuzzle(raider, point);
      // An idle gun never banks shots: firing resumes from now, or later.
      const reach = point ? Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z) : Infinity;
      if (raider.reloadUntil > this.time || !point || this.time + 1e-9 < ai.reactionUntil || reach > gun.range
        || ai.state === 'advance' && reach > RAIDER_AIM_TUNING.advanceFireRange) { ai.armed = false; return 0; }
      if (!ai.armed || this.time - ai.nextShotAt > gun.interval + 1e-9) ai.nextShotAt = Math.max(ai.nextShotAt, this.time);
      ai.armed = true;
      let shots = 0;
      while (shots < RAIDER_AIM.shotsPerTick && ai.nextShotAt <= this.time + 1e-9 && raider.ammo > 0) {
        if (this.raiderLineBlocked(raider, origin, point)) { Object.assign(ai, { nextShotAt: this.time + RAIDER_AIM.friendlyRetry, blockedAt: this.time }); break; }
        if (ai.burstLeft <= 0) ai.burstLeft = gun.burst[1] > gun.burst[0]
          ? Math.min(gun.burst[1], gun.burst[0] + Math.floor(this.random() * (gun.burst[1] - gun.burst[0] + 1))) : gun.burst[0];
        this.traceRaiderShot(raider, origin, point, { sigma: this.raiderAimError(raider, visible ? player : null, origin, point, suppress), suppress });
        raider.ammo--; ai.burstLeft--; shots++;
        ai.firedAt = this.time;
        ai.nextShotAt += gun.interval + (ai.burstLeft > 0 ? 0 : between(gun.pause, this.random));
        if (raider.ammo <= 0) { this.raiderReload(raider); break; }
      }
      return shots;
    },

    raiderReload(raider) {
      if (raider.reloadUntil > this.time) return false;
      raider.reloadUntil = this.time + RAIDER_LOADOUTS[raider.loadout].reload;
      raider.ai.burstLeft = 0;
      return true;
    },

    // The player hitscan geometry, reapplied for raider guns. Boards stop a
    // pellet (8 plank damage once per shot); zombies take the bullet, other
    // raiders block it, survivors' damage is summed and applied once.
    traceRaiderShot(raider, origin, point, { sigma = 0, suppress = false } = {}) {
      const gun = RAIDER_LOADOUTS[raider.loadout], solids = this.raiderSolids(), damaged = new Map(), pellets = [];
      const dx = point.x - origin.x, dz = point.z - origin.z;
      const aimYaw = Math.atan2(-dx, -dz), aimPitch = Math.atan2(point.y - origin.y, Math.hypot(dx, dz));
      let planked = false, hits = 0;
      for (let pellet = 0; pellet < gun.pellets; pellet++) {
        const [horizontal, vertical] = this.raiderDisk();
        const yaw = aimYaw + horizontal * sigma, pitch = aimPitch + vertical * sigma;
        const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
        let solidDistance = gun.range;
        for (const box of solids) solidDistance = Math.min(solidDistance, rayBox(origin, direction, box, gun.range));
        const intersections = this.raiderBoardHits(origin, direction, solidDistance);
        for (const zombie of this.zombies.values()) {
          if (zombie === raider || !(zombie.hp > 0)) continue;
          const hitAt = rayBox(origin, direction, enemyHitbox(zombie), gun.range);
          if (hitAt < solidDistance) intersections.push({ zombie, hitAt });
        }
        for (const player of this.players.values()) {
          if (!player.alive || player.downed) continue;
          const hitAt = rayBox(origin, direction, playerBox(player), gun.range);
          if (hitAt < solidDistance) intersections.push({ player, hitAt });
        }
        const key = hit => hit.door ? `${hit.door.id}:${hit.boardIndex}` : hit.zombie?.id ?? hit.player.id;
        intersections.sort((a, b) => a.hitAt - b.hitAt || Number(!a.door) - Number(!b.door) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
        const first = intersections[0];
        let stop = { distance: solidDistance, kind: solidDistance < gun.range ? 'solid' : 'range' }, wound = null;
        if (first?.door) {
          // Drill bullets stop on the stand's planks without breaking them.
          if (!planked && !raider.drill) this.damageDoor(first.door, RAIDER_PLANK_DAMAGE, { boardIndex: first.boardIndex, zombieId: raider.id });
          planked = true;
          stop = { distance: first.hitAt, kind: 'board' };
        } else if (first?.zombie) {
          stop = { distance: first.hitAt, kind: isRaider(first.zombie) ? 'raider' : 'zombie' };
          if (!isRaider(first.zombie) && !raider.drill) {
            const zombie = first.zombie, power = pelletDamage(gun, first.hitAt) * enemyDamageMultiplier(zombie, false);
            // Frisson rooms only (art/frisson/BLOOD-SPRAY.md 4.1): the feet before the push.
            const feet = isFrissonLike(this.ambiance) ? [milli(zombie.x), milli(zombie.y), milli(zombie.z)] : null;
            const killed = this.damageSpecialZombie(zombie, power, null, direction, 'raider', true, false);
            if (feet) wound = [zombie.id, milli(first.hitAt), milli(power), 0, killed ? 1 : 0, ...feet];
          }
        } else if (first?.player) {
          damaged.set(first.player, (damaged.get(first.player) ?? 0) + pelletDamage(gun, first.hitAt));
          hits++;
          stop = { distance: first.hitAt, kind: 'player' };
        }
        const entry = { yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind };
        if (wound) entry.wounds = [wound];
        pellets.push(entry);
      }
      for (const [player, damage] of damaged) this.damagePlayer(player, milli(damage * raider.damageScale), raider);
      this.event('raider-shot', { raiderId: raider.id, weapon: gun.model, sound: gun.sound, x: milli(origin.x), y: milli(origin.y), z: milli(origin.z),
        yaw: milli(aimYaw), pitch: milli(aimPitch), pellets, hits, suppress });
      return { pellets, hits, damaged };
    },

    // advance: run to the staging point 9 m out, firing on the move.
    raiderAdvance(raider, delta) {
      const ai = raider.ai, staging = { x: ai.stagingX, z: ai.stagingZ }, player = this.raiderTarget(raider);
      raider.speed = RAIDER_SPEEDS.advance;
      if (distance(raider, staging) > RAIDER_BEHAVIOUR.stagingReach) { ai.moving = 'run'; this.moveZombieTowards(raider, staging, delta); }
      const close = player && ai.sight?.visible && distance(raider, player) <= RAIDER_LOADOUTS[raider.loadout].engageRange;
      if (close || distance(raider, staging) <= RAIDER_BEHAVIOUR.stagingReach) this.raiderEngage(raider);
    },

    raiderEngage(raider) {
      const ai = raider.ai, [base, spread] = RAIDER_BEHAVIOUR.engage;
      Object.assign(ai, { state: 'engage', engagedAt: this.time, engageUntil: this.time + base + spread * this.random(),
        holdUntil: this.time + between(RAIDER_BEHAVIOUR.hold, this.random), strafeLeft: 0, breachStartedAt: null });
      Object.assign(raider, { speed: RAIDER_SPEEDS.strafe, navigation: null });
      return true;
    },

    // engage: hold, then strafe 1.5 m along the facade; approach a visible
    // survivor in the open; hunt an unseen one round the cabin; breach in a
    // staggered order, or re-stage in the drill.
    raiderEngageStep(raider, delta, living = []) {
      const ai = raider.ai, gun = RAIDER_LOADOUTS[raider.loadout], player = this.raiderTarget(raider);
      // Nobody in sight and nobody indoors: no blind breach of an empty cabin.
      // The exterior route goes round the facade until the survivor is seen.
      const hunted = !raider.drill && !ai.sight?.visible && outsideCabin(raider.x, raider.z) ? this.raiderQuarry(raider, living) : null;
      if (hunted && outsideCabin(hunted.x, hunted.z)) {
        raider.speed = RAIDER_SPEEDS.advance; ai.moving = 'run'; ai.strafeLeft = 0;
        this.moveZombieTowards(raider, hunted, delta);
        return false;
      }
      const outdoor = !!player && outsideCabin(player.x, player.z);
      if (outdoor && ai.sight?.visible && distance(raider, player) > Math.min(gun.engageRange, RAIDER_BEHAVIOUR.outdoorApproach)) {
        raider.speed = RAIDER_SPEEDS.advance; ai.moving = 'run'; ai.strafeLeft = 0;
        this.moveZombieTowards(raider, player, delta);
      } else if (ai.strafeLeft > 0 || (this.time + 1e-9 >= ai.holdUntil || this.raiderLineMasked(raider)) && this.raiderStartStrafe(raider)) this.raiderStrafe(raider, delta);
      else ai.holding = true;
      if (outdoor) return false;
      const blind = this.time - Math.max(ai.seenAt, ai.engagedAt) >= RAIDER_BEHAVIOUR.blind - 1e-9;
      if (raider.drill) return (blind || this.time + 1e-9 >= ai.engageUntil) && this.raiderRestage(raider);
      return (blind || this.raiderBreachDue(raider)) && this.raiderBreach(raider);
    },

    // A squad-mate in the line of fire moves the raider instead of freezing it.
    raiderLineMasked(raider) {
      return this.time - raider.ai.blockedAt < RAIDER_BEHAVIOUR.masked;
    },

    raiderStartStrafe(raider) {
      const ai = raider.ai, door = this.doors.find(item => item.id === raider.doorId), alongX = door?.outZ ? 1 : 0, alongZ = 1 - alongX;
      for (const sign of [ai.strafeSign, -ai.strafeSign]) {
        const point = { x: raider.x + alongX * sign * RAIDER_BEHAVIOUR.strafe, z: raider.z + alongZ * sign * RAIDER_BEHAVIOUR.strafe };
        // A strafe never ends inside a SPACE parking prop.
        if (cabinGap(point) < RAIDER_BEHAVIOUR.strafeClearance || point.x < EXTERIOR.bounds.minX || point.x > EXTERIOR.bounds.maxX
          || point.z < EXTERIOR.bounds.minZ || point.z > EXTERIOR.bounds.maxZ
          || HAS_SPACE && !spaceCanOccupy(point.x, point.z, 0, ENEMY_PROFILES.raider.height, RAIDER_RADIUS)) continue;
        Object.assign(ai, { strafeSign: sign, strafeX: point.x, strafeZ: point.z, strafeLeft: RAIDER_BEHAVIOUR.strafe,
          strafeUntil: this.time + RAIDER_BEHAVIOUR.strafe / RAIDER_SPEEDS.strafe + .5 });
        return true;
      }
      ai.holdUntil = this.time + between(RAIDER_BEHAVIOUR.hold, this.random);
      return false;
    },

    raiderStrafe(raider, delta) {
      const ai = raider.ai, point = { x: ai.strafeX, z: ai.strafeZ };
      raider.speed = RAIDER_SPEEDS.strafe; ai.moving = 'strafe';
      const arrived = this.moveZombieTowards(raider, point, delta);
      ai.strafeLeft = distance(raider, point);
      if (!arrived && ai.strafeLeft >= .08 && this.time < ai.strafeUntil) return false;
      Object.assign(ai, { strafeLeft: 0, strafeSign: -ai.strafeSign, holdUntil: this.time + between(RAIDER_BEHAVIOUR.hold, this.random) });
      return true;
    },

    // The squad's first raider breaches at engageUntil; the others cover until
    // it reaches its door, or 2.5 s after it left. A leader that never breaches
    // releases them 2.5 s after their own engage window.
    raiderBreachDue(raider) {
      const ai = raider.ai;
      let leader = null;
      for (const other of this.zombies.values()) {
        if (!isRaider(other) || other === raider || other.drill !== raider.drill || other.raidIndex !== raider.raidIndex
          || other.squadId !== raider.squadId || other.squadOrdinal >= raider.squadOrdinal || other.ai.state === 'retreat' || !(other.hp > 0)) continue;
        if (!leader || other.squadOrdinal < leader.squadOrdinal) leader = other;
      }
      if (!leader) return this.time + 1e-9 >= ai.engageUntil;
      if (leader.ai.state === 'breach' || leader.ai.state === 'assault') {
        const door = this.doors.find(item => item.id === (leader.portalRoute?.doorId ?? leader.doorId));
        return leader.entered || !!door && this.barricadeFront(leader, door, 1)
          || this.time + 1e-9 >= leader.ai.breachStartedAt + RAIDER_BEHAVIOUR.followerDelay;
      }
      return this.time + 1e-9 >= ai.engageUntil + RAIDER_BEHAVIOUR.followerDelay;
    },

    raiderBreach(raider) {
      const ai = raider.ai, door = this.doors.find(item => item.id === raider.doorId);
      Object.assign(ai, { state: 'breach', breachStartedAt: this.time, strafeLeft: 0 });
      Object.assign(raider, { speed: RAIDER_SPEEDS.breach, navigation: null });
      // Head for the squad's own door first while it is still defended.
      if (door && !door.sealed && !door.sealPending && outsideCabin(raider.x, raider.z) && raider.portalRoute?.stage !== 'cross') {
        raider.portalRoute = { doorId: door.id, fromOutside: true, toOutside: false, stage: 'approach' };
      }
      return true;
    },

    raiderRestage(raider) {
      Object.assign(raider.ai, { state: 'advance', strafeLeft: 0 });
      Object.assign(raider, { speed: RAIDER_SPEEDS.advance, navigation: null });
      return true;
    },

    // breach: the zombie routing (active doors, plank bash, crossing, stairs)
    // toward an indoor target or the cabin centre; an outdoor target sends
    // the raider back to engage.
    raiderBreachStep(raider, delta) {
      const ai = raider.ai, player = this.raiderTarget(raider), crossing = raider.portalRoute?.stage === 'cross';
      if (player && outsideCabin(player.x, player.z) && !crossing) return this.raiderEngage(raider);
      raider.speed = RAIDER_SPEEDS.breach; ai.moving = 'run';
      this.updateZombie(raider, delta, [player ?? CABIN_CENTRE]);
      // entered stays set once a raider has crossed; assault is only ever inside.
      if (raider.entered && !outsideCabin(raider.x, raider.z)) Object.assign(ai, { state: 'assault' });
      return true;
    },

    // assault: hold and shoot a visible survivor within 4.5 m (bash when
    // adjacent); otherwise hunt with the zombie routing; leave by a door for
    // a survivor outdoors.
    raiderAssaultStep(raider, delta, living) {
      const ai = raider.ai, player = this.raiderTarget(raider), crossing = raider.portalRoute?.stage === 'cross';
      raider.speed = RAIDER_SPEEDS.assault;
      const quarry = player ?? this.raiderQuarry(raider, living);
      if (quarry && outsideCabin(quarry.x, quarry.z)) {
        if (outsideCabin(raider.x, raider.z) && !crossing) return this.raiderEngage(raider);
        ai.moving = 'run';
        return this.updateZombie(raider, delta, [this.raiderExitToward(raider, quarry)]);
      }
      if (!quarry) { ai.holding = true; return false; }
      const gap = distance(raider, quarry);
      // A raider on the stairs keeps climbing; it still fires on the move.
      if (quarry === player && ai.sight?.visible && gap < RAIDER_BEHAVIOUR.assaultHold && !crossing && !raider.stairState && !this.raiderLineMasked(raider)) {
        ai.holding = true;
        if (gap < RAIDER_BEHAVIOUR.adjacent) this.updateZombie(raider, delta, [player]);
        return true;
      }
      ai.moving = 'run';
      return this.updateZombie(raider, delta, [quarry]);
    },

    // Without a target, the nearest reachable survivor, indoors first.
    raiderQuarry(raider, living) {
      const reachable = living.filter(player => player.alive && !player.downed && Math.hypot(player.x, player.z) <= RAIDS.targetRadius);
      const inside = reachable.filter(player => !outsideCabin(player.x, player.z));
      return (inside.length ? inside : reachable).reduce((nearest, player) => {
        const score = distance(raider, player) + Math.abs(raider.y - player.y) * 3;
        return !nearest || score < nearest.score ? { player, score } : nearest;
      }, null)?.player ?? null;
    },

    // Not moving 1 m in 20 s re-plans the route once; still stuck after
    // stuckRetreatAfter more seconds, that raider alone retreats.
    raiderStuckGuard(raider) {
      const ai = raider.ai;
      if (!STUCK_STATES.includes(ai.state) || Math.hypot(raider.x - ai.movedX, raider.z - ai.movedZ) >= STUCK_DISTANCE) {
        Object.assign(ai, { movedAt: this.time, movedX: raider.x, movedZ: raider.z, replanned: false });
        return false;
      }
      const still = this.time - ai.movedAt;
      if (!ai.replanned && still >= STUCK_AFTER - 1e-8) {
        ai.replanned = true;
        raider.navigation = null;
        raider.portalRoute = null;
      } else if (ai.replanned && still >= STUCK_AFTER + RAIDS.stuckRetreatAfter - 1e-8) return this.beginRaiderRetreat(raider);
      return false;
    },

    beginRaiderRetreat(raider) {
      if (raider.ai.state === 'retreat') return false;
      Object.assign(raider.ai, { state: 'retreat', retreatStartedAt: this.time, targetId: null, aimingAt: null, burstLeft: 0 });
      Object.assign(raider, { speed: RAIDER_SPEEDS.retreat, crouched: false, pitch: 0, navigation: null, portalRoute: null });
      return true;
    },

    // A retreating raider holds fire and runs home; it stays killable until
    // it is far and unseen, or its time runs out. No loot on departure.
    updateRaiderRetreat(raider, delta) {
      const ai = raider.ai;
      if (outsideCabin(raider.x, raider.z) && raider.portalRoute?.stage !== 'cross') this.moveZombieTowards(raider, { x: ai.homeX, z: ai.homeZ }, delta);
      else this.updateZombie(raider, delta, [this.retreatExit(raider)]);
      if (this.time - ai.retreatStartedAt >= RAIDS.retreatMaxSeconds - 1e-8
        || cabinGap(raider) >= RAIDS.retreatDespawnDistance && !this.raiderSeen(raider)) return this.despawnRaider(raider);
      return false;
    },

    // An inert point just outside the exit door. updateZombie routes a body
    // indoors (stairs and door crossing) toward it; damagePlayer ignores it.
    retreatExit(raider) {
      const unsealed = this.doors.filter(door => !door.sealed);
      const door = unsealed.find(item => item.id === raider.portalRoute?.doorId)
        ?? unsealed.filter(item => this.doorPassable(item, 0, ENEMY_PROFILES.raider.height)).sort((a, b) => distance(raider, a) - distance(raider, b))[0]
        ?? unsealed.find(item => item.id === raider.doorId) ?? unsealed[0] ?? this.doors[0];
      return { id: null, x: door.x + door.outX * 2, y: 0, z: door.z + door.outZ * 2, alive: false, downed: true, crouched: false };
    },

    // Leaving for an outdoor quarry: the same inert point outside the open
    // door that shortens the whole run (raider to door, then door to quarry).
    raiderExitToward(raider, quarry) {
      const cost = door => distance(raider, door) + distance(door, quarry);
      const active = this.doors.filter(door => !door.sealed && !door.sealPending);
      const open = active.filter(door => this.doorPassable(door, 0, ENEMY_PROFILES.raider.height));
      const door = (open.length ? open : active).sort((a, b) => cost(a) - cost(b))[0];
      if (!door) return this.retreatExit(raider);
      return { id: null, x: door.x + door.outX * 2, y: 0, z: door.z + door.outZ * 2, alive: false, downed: true, crouched: false };
    },

    despawnRaider(raider) {
      if (!this.zombies.delete(raider.id)) return false;
      const raid = this.raid;
      if (raid && !raider.drill && raider.raidIndex === raid.index) raid.retreated++;
      this.event('raider-left', { id: raider.id });
      return true;
    },

    // The bullets' solid set: solids (sealed plates included) and intact
    // boards, whose real gaps let rays through. Bodies never block.
    raiderLineClear(origin, target) {
      const direction = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
      if (this.raiderSolids().some(box => rayBox(origin, direction, box, 1) < 1 - 1e-6)) return false;
      return !this.raiderBoardHits(origin, direction, 1).some(hit => hit.hitAt < 1 - 1e-6);
    },

    raiderSeen(raider) {
      const height = enemyPosture(raider).height * (raider.scale ?? 1);
      const points = [.62, .92].map(share => ({ x: raider.x, y: raider.y + height * share, z: raider.z }));
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        const eye = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
        if (points.some(point => this.raiderLineClear(eye, point))) return true;
      }
      return false;
    },

    // Reached through dropZombieLoot after its practice return. Raider loot
    // never advances the zombie ammo, health, armour or grenade cadences.
    dropRaiderLoot(raider, cash, add) {
      if (this.practice) return;
      const raid = this.raid, current = !!raid && !raider.drill && raider.raidIndex === raid.index;
      if (current) raid.killed++;
      const purse = add('points', cash);
      const box = add('ammo', 1, current && raid.killed + raid.retreated === raid.total);
      box.charge = PICKUPS.ammoCharge;
      for (const pickup of [purse, box]) {
        pickup.expiresAt = this.time + RAIDS.lootLifetime;
        this.raidLootIds.add(pickup.id);
      }
    },

    raidSnapshot() {
      const raid = this.raid;
      if (!raid) return null;
      return { index: raid.index, wave: raid.wave, total: raid.total, squad: raid.squad, triggered: raid.triggered, cleared: raid.cleared,
        remaining: this.raidCounts().remaining, killed: raid.killed, retreated: raid.retreated, bonus: raid.bonus };
    },

    raidWarningSnapshot() {
      return [...this.raidWarnings.values()].filter(warning => this.time + 1e-8 >= warning.announceAt)
        .map(warning => ({ id: warning.id, x: milli(warning.x), y: 0, z: milli(warning.z), readyAt: milli(warning.readyAt),
          remaining: milli(Math.max(0, warning.readyAt - this.time)), kind: 'raider' }));
    },

    raiderSnapshot(raider) {
      return { faction: 'raider', weapon: RAIDER_LOADOUTS[raider.loadout]?.model ?? null, pitch: milli(raider.pitch ?? 0),
        crouched: raider.crouched === true, reloading: raider.reloadUntil > this.time,
        aimingAt: raider.ai?.aimingAt ?? null, state: raider.ai?.state ?? null };
    },

    // Stand drill: each press replaces the squad, alternating west and east.
    practiceRaiders() {
      if (!this.practice) return false;
      for (const zombie of [...this.zombies.values()]) if (isRaider(zombie) && zombie.drill) this.zombies.delete(zombie.id);
      const turn = this.drillSides ?? 0, active = this.activeRaidDoors();
      const door = active.find(item => item.id === (turn % 2 ? 'east' : 'west')) ?? active[0];
      this.drillSides = turn + 1;
      const plan = { index: 1, damageScale: raidDamageScale(this.players.size) }, axis = door.outZ ? 'x' : 'z';
      const raiders = DRILL_LOADOUTS.map((loadout, slot) => {
        const lateral = (slot ? 1 : -1) * DRILL_SPREAD;
        const point = { x: door.x + door.outX * DRILL_DISTANCE + (axis === 'x' ? lateral : 0), z: door.z + door.outZ * DRILL_DISTANCE + (axis === 'z' ? lateral : 0) };
        return this.materializeRaider(this.createRaider(slot + 1, { id: null, doorId: door.id, ...point }, plan,
          { door, squadOrdinal: slot, drill: true, loadout, point }), point);
      });
      this.event('raid', { index: plan.index, wave: this.wave, total: raiders.length, squad: raiders.length, side: door.id,
        entries: raiders.map(raider => ({ x: milli(raider.x), z: milli(raider.z) })), damageScale: plan.damageScale, drill: true });
      return true;
    },

    updatePracticeRaiders(delta, living) {
      for (const raider of [...this.zombies.values()]) if (isRaider(raider)) this.updateRaider(raider, delta, living);
    },
  };
}
