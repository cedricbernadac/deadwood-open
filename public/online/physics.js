import { LEVEL, HAS_SPACE } from '../level-config.js';
import { SPACE, spaceFloor, spaceFlightAt, spaceCeiling, spaceCanOccupy, spaceWallHeight } from '../level-space.js';
// The online predictor and online authority share this movement kernel.
// The LAN simulator deliberately retains its original implementation.
// Methods below are mechanically copied from RoomSimulation; parity tests
// guard stairs, walls, boards, gravity, posture, backpack weight and crowds.
import { ARMORY, WEAPON_MOVEMENT, EXTERIOR, BARRICADE_BOARDS, LOFT, armoryRackBounds } from '../rules.js';
import { INTERIOR_WALLS, PARTITION_CAPS, partitionCapSupport, SOFA, coverPieces } from '../layout.js';
import { PLAYER_POSTURE, LOFT_RAIL, fallDamage, playerHeight } from '../movement.js';
import { enemyProfile } from '../enemies.js';
import { STAIRS, STAIR_WELL, STAIR_CONTACT, stairContactY, stairRampY as stairY,
  stairTreadY as stairStepY, stairCeiling, stairStringerSurface } from '../stairs.js';
import { GENERATOR_BOUNDS } from '../expedition.js';
import { BACKPACK } from '../weapon-upgrades.js';
import { characterStats } from '../character-bonuses.js';
import { activeWeaponId, weaponType } from '../weapon-inventory.js';

export const ONLINE_PHYSICS_VERSION = 1;
const TICK_RATE = 30;
const FROZEN_PHASES = ['extraction', 'victory', 'gameover'];
const HAZARD_PHASES = ['wave', 'countdown', 'intermission'];
export const WORLD = Object.freeze({
  width: LEVEL.width, depth: LEVEL.depth, loftY: LOFT.y, eyeHeight: 1.55,
  bounds: LEVEL.insideBounds,
  stair: STAIRS, loft: LOFT, armory: ARMORY,
  covers: [
    ...INTERIOR_WALLS,
    SOFA,
    LEVEL.table,
    GENERATOR_BOUNDS, ...ARMORY.map(armoryRackBounds),
  ],
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const inRect = (x, z, rect, margin = 0) => x >= rect.minX - margin && x <= rect.maxX + margin && z >= rect.minZ - margin && z <= rect.maxZ + margin;
const isStair = (x, z) => HAS_SPACE ? SPACE.flights.some(f=>inRect(x,z,f)) : inRect(x, z, WORLD.stair);
const PLAYER_RADIUS = .25, PLAYER_HEIGHT = PLAYER_POSTURE.standingHeight, STEP_HEIGHT = .24;
const GRAVITY = 18, JUMP_SPEED = 5.6, PLAYER_MOTION_SMOOTHING = .4;
const ZOMBIE_RADIUS = .29;
const bodyRadius = zombie => ZOMBIE_RADIUS * (zombie.scale ?? 1);
const loftRailBounds = Object.freeze({ minX: LOFT.minX - LOFT_RAIL.thickness / 2, maxX: LOFT.minX + LOFT_RAIL.thickness / 2,
  minZ: LOFT.minZ + LOFT_RAIL.endInset - LOFT_RAIL.thickness / 2, maxZ: LOFT.maxZ - LOFT_RAIL.endInset + LOFT_RAIL.thickness / 2 });
const hasLoftFloor = (x, z, radius = PLAYER_RADIUS) => inRect(x, z, WORLD.loft, radius)
  && !inRect(x, z, STAIR_WELL, -radius);
const overlapsLoftSlab = (x, z, y, height, radius = PLAYER_RADIUS) => hasLoftFloor(x, z, radius)
  && y < WORLD.loftY - 1e-6 && y + height > WORLD.loftY - LOFT.thickness + 1e-6;
const wellClearancePenalty = (x, z, radius = PLAYER_RADIUS) =>
  Math.max(0, STAIR_WELL.minX + radius - x, x - STAIR_WELL.maxX + radius)
  + Math.max(0, STAIR_WELL.minZ + radius - z, z - STAIR_WELL.maxZ + radius);
const leavesLoftPenetration = (player, x, z, y) => overlapsLoftSlab(player.x, player.z, player.y, playerHeight(player))
  && y <= player.y + 1e-6
  && wellClearancePenalty(x, z) < wellClearancePenalty(player.x, player.z) - 1e-6;
const normalizeAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Bind these to an authoritative online RoomSimulation, whose damagePlayer
// keeps the real health/armor/downing rules. The browser context below replaces
// that hook with a no-op: prediction never spends ammo or applies damage.
export const movementMethods = Object.freeze({
  canOccupy(entity, x, z, y, radius, respectCovers = true) {
    const isPlayer = this.players.has(entity.id);
    const bodyHeight = isPlayer ? playerHeight(entity) : enemyProfile(entity).height*(entity.scale ?? 1);
    if (HAS_SPACE && !spaceCanOccupy(x,z,y,bodyHeight,radius,isPlayer ? entity.grounded !== false ? STEP_HEIGHT : 0 : .4)) return false;
    if (!HAS_SPACE && isPlayer && overlapsLoftSlab(x, z, y, bodyHeight, radius)
      && !leavesLoftPenetration(entity, x, z, y)) return false;
    if (!HAS_SPACE && isPlayer && y < LOFT.y + LOFT_RAIL.height - 1e-6 && y + bodyHeight > LOFT.y
      && inRect(x, z, loftRailBounds, radius)) return false;
    if (!HAS_SPACE && respectCovers) {
      // Tread contacts allow the small rise of ordinary stair walking. Below
      // the staircase, however, the whole body must clear its real underside.
      const surface = isPlayer ? stairContactY(z) : stairY(z);
      // Step-height tolerance is only for feet raised by ordinary grounded
      // stair walking. An airborne shoulder cannot enter below a tread's top:
      // otherwise gravity drops it through that tread into the enclosed wood.
      const allowance = isPlayer ? entity.grounded !== false ? STEP_HEIGHT : 1e-6 : .3;
      const onTreads = (isPlayer ? inRect(x,z,STAIR_CONTACT,radius) : isStair(x,z)) && y >= surface - allowance;
      const nearFoot = x >= STAIRS.minX && x <= STAIRS.maxX
        && z >= STAIRS.maxZ - (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps && y <= .32;
      if (!onTreads && !nearFoot && y + bodyHeight > stairCeiling(x,z,y,radius) + 1e-6) return false;
    }
    if (y < LEVEL.wallHeight && y + bodyHeight > 0) {
      for (const door of this.doors) {
        const horizontalWall = door.outZ !== 0;
        const normal = horizontalWall ? z : x, tangent = horizontalWall ? x : z;
        const plane = horizontalWall ? door.z : door.x, halfLength = horizontalWall ? LEVEL.halfWidth : LEVEL.halfDepth;
        if (HAS_SPACE && y >= spaceWallHeight(door, tangent) - 1e-6) continue;
        if (Math.abs(normal-plane)>radius+.135 || Math.abs(tangent)>halfLength+radius) continue;
        if (Math.abs(tangent)+radius>1.3 || y<0 || y+bodyHeight>2.8 || !this.doorPassable(door,y,bodyHeight)) return false;
      }
    }
    for (const cover of respectCovers ? WORLD.covers : INTERIOR_WALLS) {
      const baseY = cover.baseY ?? 0;
      const height = bodyHeight;
      const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
      if (cap) {
        if (y < partitionCapSupport(cap, x, z, radius) - 1e-6 && y + height > baseY) return false;
        continue;
      }
      for (const piece of coverPieces(cover)) if (y < baseY + piece.height && y + height > baseY && inRect(x, z, piece, radius)) return false;
    }
    return true;
  },

  doorPassable(door,y=0,height=PLAYER_HEIGHT) {
    if (!door || door.sealed) return false;
    const boards = door.boards;
    if (!boards) return door.hp <= 0;
    return boards.every((hp,index) => {
      if(hp<=0)return true;
      const board=BARRICADE_BOARDS[index];
      const extent=board.height/2*Math.cos(board.angle)+board.width/2*Math.abs(Math.sin(board.angle));
      const center=board.y;
      return y>=center+extent || y+height<=center-extent;
    });
  },

  playerSurface(player, x, z, belowY) {
    const surfaces = [HAS_SPACE ? spaceFloor(x,z,belowY,PLAYER_RADIUS) : 0];
    if (!HAS_SPACE) { if (inRect(x, z, STAIR_CONTACT, PLAYER_RADIUS)) surfaces.push(stairContactY(z));
    else surfaces.push(stairStringerSurface(x, z, PLAYER_RADIUS)); }
    if (hasLoftFloor(x, z)) surfaces.push(WORLD.loftY);
    if (inRect(x, z, loftRailBounds, PLAYER_RADIUS)) surfaces.push(LOFT.y + LOFT_RAIL.height);
    for (const cover of WORLD.covers) {
      const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
      if (cap) surfaces.push(partitionCapSupport(cap, x, z, PLAYER_RADIUS));
      else for (const piece of coverPieces(cover)) if (inRect(x, z, piece, PLAYER_RADIUS)) surfaces.push((cover.baseY ?? 0) + piece.height);
    }
    return Math.max(...surfaces.filter(height => height <= belowY + 1e-6));
  },

  playerCandidateY(player, x, z, stepOriginY = player.y, stepAllowance = STEP_HEIGHT) {
    if (HAS_SPACE) {
      const support=this.playerSurface(player,x,z,player.y+(player.grounded?STEP_HEIGHT:.02));
      if(!Number.isFinite(support))return null;
      if(player.grounded&&support>stepOriginY+stepAllowance+1e-6)return null;
      return player.grounded&&Math.abs(support-player.y)<=STEP_HEIGHT&&Math.abs(support-stepOriginY)<=stepAllowance+1e-6?support:player.y;
    }
    const currentStair = isStair(player.x, player.z), nextStair = isStair(x, z);
    const height = playerHeight(player);
    const usingStairs = currentStair && player.y >= stairStepY(player.z) - STEP_HEIGHT;
    const ceiling = stairCeiling(x, z, player.y, PLAYER_RADIUS);
    const passesBelow = player.y + height <= ceiling + 1e-6;
    const onSide = z > WORLD.stair.minZ && z < WORLD.stair.maxZ
      && player.z > WORLD.stair.minZ && player.z < WORLD.stair.maxZ;
    // There is no handrail along the flight. Feet already above a tread may
    // leave sideways, while a body below it must still clear the real wood.
    const leavingTreads = inRect(player.x, player.z, STAIR_CONTACT, PLAYER_RADIUS)
      && player.y >= stairStepY(player.z) - STEP_HEIGHT
      && player.y >= stairStepY(z) - STEP_HEIGHT;

    // The high half is a real underpass. Keep the feet on the ground instead
    // of selecting an overhead tread as the next walkable floor.
    const approachesFoot = player.z >= WORLD.stair.maxZ && z >= WORLD.stair.maxZ - (WORLD.stair.maxZ - WORLD.stair.minZ) / WORLD.stair.steps
      && x >= WORLD.stair.minX && x <= WORLD.stair.maxX;
    const entersLanding = !currentStair && (nextStair && !onSide || approachesFoot)
      && Math.abs(stairStepY(z) - player.y) <= STEP_HEIGHT;
    if (!usingStairs && !entersLanding && !passesBelow && !leavingTreads) return null;

    const support = this.playerSurface(player, x, z, player.y + (player.grounded ? STEP_HEIGHT : 0));
    if (nextStair && stairStepY(z) > player.y + (player.grounded ? STEP_HEIGHT : 0.02) && !passesBelow) return null;
    // X and Z are swept separately, but share one step-height allowance.
    // Otherwise a diagonal move can snap down two 21 cm treads in one tick.
    if (player.grounded && support > stepOriginY + stepAllowance + 1e-6) return null;
    const targetY = player.grounded && Math.abs(support - player.y) <= STEP_HEIGHT
      && Math.abs(support - stepOriginY) <= stepAllowance + 1e-6 ? support : player.y;
    // Check the raised feet, not just their old height: otherwise a single
    // 21 cm stair step can insert the head into the slab and trap every exit.
    if (overlapsLoftSlab(x, z, targetY, height) && !leavesLoftPenetration(player, x, z, targetY)) return null;
    return targetY;
  },

  playerPartitionCap(player) {
    return PARTITION_CAPS.find(cap => Math.abs(player.y - partitionCapSupport(cap, player.x, player.z, PLAYER_RADIUS)) < .025 && player.vy <= 0);
  },

  slidePartitionCap(player, delta) {
    const cap = this.playerPartitionCap(player);
    if (cap) player.partitionSlideLeft = .25;
    else player.partitionSlideLeft = Math.max(0, (player.partitionSlideLeft ?? 0) - delta);
    if (!cap && !player.partitionSlideLeft) return;
    if (!Number.isFinite(player.fallStartY)) player.fallStartY = player.y;
    player.grounded = false;
    // The steep narrow cap has no stable foothold, even when sprinting
    // against the slide. Maintain real contact until the feet clear its edge.
    const steps = Math.max(1, Math.ceil(6 * delta / .12));
    for (let step = 0; step < steps; step++) {
      const z = player.z + 6 * delta / steps;
      const surface = cap ? partitionCapSupport(cap, player.x, z, PLAYER_RADIUS) : -Infinity;
      const y = Number.isFinite(surface) ? Math.min(player.y, surface) : player.y;
      if (this.canOccupy(player, player.x, z, y, PLAYER_RADIUS)) Object.assign(player, { y, z });
    }
  },

  updatePlayerVertical(player, delta, stepOriginY = player.y, stepAllowance = STEP_HEIGHT) {
    const support = this.playerSurface(player, player.x, player.z, player.y + STEP_HEIGHT);
    if (player.grounded && Math.abs(support - player.y) <= STEP_HEIGHT
      && Math.abs(support - stepOriginY) <= stepAllowance + 1e-6
      && !overlapsLoftSlab(player.x, player.z, support, playerHeight(player))) {
      player.y = support;
      player.vy = 0;
      player.fallStartY = null;
      return;
    }
    const steppedOff = player.grounded && support < stepOriginY - stepAllowance;
    player.grounded = false;
    const oldY = player.y;
    if (!Number.isFinite(player.fallStartY)) player.fallStartY = steppedOff ? stepOriginY : oldY;
    let nextY = oldY + player.vy * delta - 0.5 * GRAVITY * delta * delta;
    player.vy -= GRAVITY * delta;
    const floor = this.playerSurface(player, player.x, player.z, oldY);
    if (player.vy <= 0 && nextY <= floor) {
      nextY = floor;
      player.vy = 0;
      player.grounded = true;
      if (this.playerPartitionCap(player)) player.grounded = false;
    } else {
      const underside = HAS_SPACE ? spaceCeiling(player.x,player.z,oldY,PLAYER_RADIUS) : WORLD.loftY - LOFT.thickness;
      const height = playerHeight(player);
      if ((HAS_SPACE || hasLoftFloor(player.x, player.z)) && oldY + height <= underside
        && nextY + height >= underside) {
        nextY = underside - height;
        player.vy = 0;
      }
      const beneathTreads = !isStair(player.x, player.z) || oldY < stairStepY(player.z) - STEP_HEIGHT;
      const stairUnderside = !HAS_SPACE && beneathTreads ? stairCeiling(player.x, player.z, oldY, PLAYER_RADIUS) : Infinity;
      if (oldY + height <= stairUnderside + 1e-6 && nextY + height >= stairUnderside) {
        nextY = stairUnderside - height;
        player.vy = 0;
      }
    }
    player.y = nextY;
    if (player.grounded) {
      // Count the height lost from the takeoff surface, not the extra height
      // of a normal jump. Landing consumes the fall even if already downed.
      const damage = fallDamage(player.fallStartY - nextY);
      player.fallStartY = null;
      if (damage && HAZARD_PHASES.includes(this.phase)) this.damagePlayer(player, damage, { source: 'fall' });
    }
  },

  movePlayer(player, delta) {
    if (!player.alive || FROZEN_PHASES.includes(this.phase)) return;
    delta = clamp(delta, 0, 0.1);
    const stepOriginY = player.y, fromX = player.x, fromZ = player.z;
    // Keep equivalent traversal for diagnostic ticks longer than the live
    // server's 1/30 s, while never granting a second allowance for an axis.
    const stepAllowance = STEP_HEIGHT * Math.max(1, delta * TICK_RATE);
    if (!Number.isFinite(player.vy)) player.vy = 0;
    if (typeof player.grounded !== 'boolean') player.grounded = true;
    const support = this.playerSurface(player, player.x, player.z, player.y + STEP_HEIGHT);
    if (player.grounded && Math.abs(support - player.y) > STEP_HEIGHT) player.grounded = false;
    const freshInput = this.time - player.lastInputAt <= 0.6 && !player.downed;
    if (freshInput && player.input.crouch) player.crouched = true;
    else if (player.crouched) {
      // Releasing Ctrl cannot grow the body through a ceiling or a plank.
      const standing = { ...player, crouched: false };
      const underLoft = hasLoftFloor(player.x, player.z) && player.y < WORLD.loftY - .02
        && player.y + PLAYER_HEIGHT > WORLD.loftY - LOFT.thickness;
      const beneathTreads = !isStair(player.x, player.z) || player.y < stairStepY(player.z) - STEP_HEIGHT;
      const underStairs = HAS_SPACE ? player.y + PLAYER_HEIGHT > spaceCeiling(player.x,player.z,player.y,PLAYER_RADIUS) + 1e-6 : beneathTreads && player.y + PLAYER_HEIGHT > stairCeiling(player.x, player.z, player.y, PLAYER_RADIUS) + 1e-6;
      if (!underLoft && !underStairs && this.canOccupy(standing, player.x, player.z, player.y, PLAYER_RADIUS)) player.crouched = false;
    }
    if (freshInput && player.jumpRequested && player.grounded && !this.playerPartitionCap(player) && !(player.partitionSlideLeft > 0)
      && !overlapsLoftSlab(player.x, player.z, player.y, playerHeight(player))) {
      player.fallStartY = player.y;
      player.vy = JUMP_SPEED;
      player.grounded = false;
    }
    player.jumpRequested = false;
    let { forward, strafe } = freshInput ? player.input : { forward: 0, strafe: 0 };
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 1) { forward /= magnitude; strafe /= magnitude; }
    const speed = (player.crouched ? 3.5 * PLAYER_POSTURE.crouchSpeed : freshInput && player.input.sprint ? 5.4 : 3.5) * this.playerMovementMultiplier(player);
    const dx = (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * strafe) * speed * delta;
    const sliding = this.playerPartitionCap(player) || player.partitionSlideLeft > 0;
    const dz = sliding ? 0 : (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * strafe) * speed * delta;
    const substeps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.14));
    for (let step = 0; step < substeps; step++) {
      for (const [axis, amount] of [['x', dx / substeps], ['z', dz / substeps]]) {
        const bounds = EXTERIOR.bounds;
        const x = clamp(player.x + (axis === 'x' ? amount : 0), bounds.minX, bounds.maxX);
        const z = clamp(player.z + (axis === 'z' ? amount : 0), bounds.minZ, bounds.maxZ);
        const y = this.playerCandidateY(player, x, z, stepOriginY, stepAllowance);
        if (y !== null && this.canOccupy(player, x, z, y, PLAYER_RADIUS) && !this.zombieBlocksPlayer(player, x, z, y)) Object.assign(player, { x, y, z });
      }
    }
    this.slidePartitionCap(player, delta);
    this.updatePlayerVertical(player, delta, stepOriginY, stepAllowance);
    this.updatePlayerMotion(player, fromX, fromZ, delta);
  },

  updatePlayerMotion(player, fromX, fromZ, delta) {
    if (!(delta > 0)) return;
    const limit = 5.4 * this.playerMovementMultiplier(player);
    let vx = (player.x - fromX) / delta, vz = (player.z - fromZ) / delta;
    const speed = Math.hypot(vx, vz);
    if (speed > limit) { vx *= limit / speed; vz *= limit / speed; }
    const blend = 1 - Math.exp(-delta / PLAYER_MOTION_SMOOTHING);
    player.motionX = (player.motionX ?? 0) + (vx - (player.motionX ?? 0)) * blend;
    player.motionZ = (player.motionZ ?? 0) + (vz - (player.motionZ ?? 0)) * blend;
  },

  zombieBlocksPlayer(player, x, z, y) {
    for (const zombie of this.zombies.values()) {
      if (!(zombie.hp > 0)) continue;
      const bottom = zombie.y ?? 0, top = bottom + enemyProfile(zombie).height * (zombie.scale ?? 1);
      if (y >= top || y + playerHeight(player) <= bottom) continue;
      const next = Math.hypot(x - zombie.x, z - zombie.z);
      if (next < PLAYER_RADIUS + bodyRadius(zombie) && next < Math.hypot(player.x - zombie.x, player.z - zombie.z) - 1e-6) return true;
    }
    return false;
  },

  backpackMovementMultiplier(player) {
    // Weight follows the actual authoritative inventory, never a client flag
    // or a cached counter that could survive an exchange, death drop or reset.
    const carried = Object.keys(player?.inventory ?? {}).length;
    return BACKPACK.movementMultipliers[Math.min(carried, BACKPACK.slots)] ?? 1;
  },

  playerMovementMultiplier(player) {
    const secondary = player?.dualWield && characterStats(player).dualWield && player.secondaryWeaponId !== activeWeaponId(player)
      && Object.hasOwn(player.inventory ?? {}, player.secondaryWeaponId) ? player.secondaryWeaponId : null;
    const weight = secondary ? Math.min(WEAPON_MOVEMENT[player?.weapon] ?? 1,
      WEAPON_MOVEMENT[weaponType(secondary, player.inventory[secondary])] ?? 1) : WEAPON_MOVEMENT[player?.weapon] ?? 1;
    return weight * this.backpackMovementMultiplier(player) * characterStats(player).speedMultiplier;
  }
});

/** Clone state used by prediction without modifying a received snapshot. */
export function clonePredictedPlayer(player) {
  if (!player || typeof player !== 'object') throw new TypeError('A player state is required.');
  // Slot IDs preserve separate copies of one model and their actual weight.
  const slots = player.inventory ? Object.entries(player.inventory)
    : Array.isArray(player.weapons) ? player.weapons.map(slot => [slot.id ?? slot.weapon, slot])
    : (Array.isArray(player.ownedWeapons) ? player.ownedWeapons : player.weapon ? [player.weapon] : []).map(id => [id, {}]);
  const inventory = Object.fromEntries(slots.map(([id, stock]) => [id, { ...stock }]));
  return { ...player, inventory,
    input: { forward: 0, strafe: 0, sprint: false, crouch: false, ...player.input },
    umbrella: { ...player.umbrella },
    vy: Number.isFinite(player.vy) ? player.vy : 0,
    grounded: typeof player.grounded === 'boolean' ? player.grounded : true,
    jumpHeld: player.jumpHeld === true, jumpRequested: player.jumpRequested === true,
    fallStartY: Number.isFinite(player.fallStartY) ? player.fallStartY : null,
    partitionSlideLeft: Number.isFinite(player.partitionSlideLeft) ? player.partitionSlideLeft : 0,
  };
}

const DOOR_DIRECTIONS = Object.freeze(Object.fromEntries(LEVEL.doors.map(door => [door.id, door])));

/** A light, disposable world view; it never reads DOM, clocks or network state. */
export function createPhysicsContext(snapshot = {}) {
  const playerStates = snapshot.players instanceof Map ? [...snapshot.players.values()] : snapshot.players ?? [];
  const zombieStates = snapshot.zombies instanceof Map ? [...snapshot.zombies.values()] : snapshot.zombies ?? [];
  const context = {
    ...movementMethods,
    time: Number.isFinite(snapshot.time) ? snapshot.time : 0,
    phase: snapshot.phase ?? 'lobby', paused: snapshot.paused === true,
    players: new Map(playerStates.map(player => [player.id, clonePredictedPlayer(player)])),
    zombies: new Map(zombieStates.map(zombie => [zombie.id, { ...zombie }])),
    doors: (snapshot.doors ?? []).map(door => ({ ...DOOR_DIRECTIONS[door.id], ...door,
      ...(Array.isArray(door.boards) ? { boards: [...door.boards] } : {}) })),
    damagePlayer() {},
  };
  return context;
}

/** Exact movement-input acceptance; ignores invalid input like the authority. */
export function applyPredictedInput(player, message, context) {
  if (context.paused || FROZEN_PHASES.includes(context.phase) || !message) return false;
  for (const value of [message.forward, message.strafe, message.yaw, message.pitch]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  }
  player.input = { forward: clamp(message.forward, -1, 1), strafe: clamp(message.strafe, -1, 1),
    sprint: message.sprint === true, crouch: message.crouch === true };
  const jump = message.jump === true;
  if (jump && !player.jumpHeld) player.jumpRequested = true;
  player.jumpHeld = jump;
  player.yaw = normalizeAngle(message.yaw);
  player.pitch = clamp(message.pitch, -1.48, 1.48);
  player.lastInputAt = context.time;
  return true;
}

/**
 * Advance a mutable predicted player/context by one command (at most 100 ms).
 * The authoritative online simulation calls movementMethods.movePlayer itself;
 * its tick already owns clock advancement and its damage hook is authoritative.
 */
export function stepPredictedPlayer(player, input, dt, context) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('A finite, nonnegative movement delta is required.');
  if (!context || typeof context.movePlayer !== 'function') throw new TypeError('A physics context is required.');
  if (context.paused) return player;
  const delta = clamp(dt, 0, .1);
  context.players.set(player.id, player);
  applyPredictedInput(player, input, context);
  context.time += delta;
  context.movePlayer(player, delta);
  return player;
}

/** Pure convenience API; authoritative health, ammo and snapshot stay intact. */
export function predictMovement(player, input, dt, snapshot = {}) {
  const context = createPhysicsContext(snapshot);
  const predicted = clonePredictedPlayer(player);
  return stepPredictedPlayer(predicted, input, dt, context);
}
