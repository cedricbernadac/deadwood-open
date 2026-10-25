import { randomBytes } from 'node:crypto';
import { RoomSimulation, TICK_RATE } from './simulation.mjs';
import { movementMethods } from './public/online/physics.js';

const neutral = () => ({ forward: 0, strafe: 0, sprint: false, crouch: false });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Raiders change hitbox and headshot threshold when crouching. Keep that
// discrete stance with their historical pose, without rewinding AI or health.
const enemyPose = enemy => ({ x: enemy.x, y: enemy.y, z: enemy.z, yaw: enemy.yaw,
  ...(enemy.kind === 'raider' ? { crouched: enemy.crouched === true } : {}) });

/** The LAN simulation stays intact. This adapter only changes command delivery
 * and uses the same authoritative gameplay, collision and weapon methods. */
export class OnlineRoomSimulation extends RoomSimulation {
  constructor(code, options = {}) {
    super(code, options);
    this.clock = options.clock ?? (() => performance.now());
    this.maxInputDt = options.maxInputDt ?? .05;
    this.maxInputQueue = options.maxInputQueue ?? 64;
    this.maxRewindMs = options.maxRewindMs ?? 200;
    this.interpolationMs = options.interpolationMs ?? 100;
    this.inputs = new Map();
    this.history = [];
    this.epoch = randomBytes(8).toString('hex');
    this.activeShot = null;
    this.rewindPushes = null;
    this.rewindPositions = null;
  }

  addPlayer(...args) {
    const player = super.addPlayer(...args);
    this.inputs.set(player.id, { received: 0, ack: 0, queue: [], connected: true, shotId: -1 });
    return player;
  }

  removePlayer(id) { super.removePlayer(id); this.inputs.delete(id); }

  // Connected survivors only, weighed as on the LAN (no companions online: 1 each).
  participantCount() {
    return [...this.players.values()].filter(player => !player.waiting && this.inputs?.get(player.id)?.connected !== false)
      .reduce((sum, player) => sum + this.participantWeight(player), 0);
  }

  canAdmitPlayer(player) { return super.canAdmitPlayer(player) && this.inputs.get(player.id)?.connected === true; }

  setConnected(id, connected) {
    const state = this.inputs.get(id), player = this.players.get(id);
    if (!state || !player) return false;
    state.connected = connected === true;
    this.resetGrenadier(player);
    state.queue.length = 0;
    state.ack = state.received;
    player.input = neutral(); player.jumpHeld = false; player.jumpRequested = false;
    this.cancelMinigunSpin(player); this.cancelMelee(id, true);
    if (connected) this.admitReadyPlayers();
    return true;
  }

  setInput(id, message) {
    const state = this.inputs.get(id);
    if (this.paused || !state?.connected || !this.players.has(id) || this.players.get(id).waiting || ['extraction', 'victory', 'gameover'].includes(this.phase)) return false;
    if (!Number.isSafeInteger(message.seq) || message.seq <= state.received || message.seq > 0x7fffffff
      || typeof message.dt !== 'number' || !Number.isFinite(message.dt) || message.dt < 1 / 120 || message.dt > this.maxInputDt
      || state.queue.length >= this.maxInputQueue
      || ![message.forward, message.strafe, message.yaw, message.pitch].every(value => typeof value === 'number' && Number.isFinite(value))) return false;
    state.received = message.seq;
    state.queue.push({ seq: message.seq, left: message.dt, input: {
      forward: clamp(message.forward, -1, 1), strafe: clamp(message.strafe, -1, 1),
      yaw: message.yaw, pitch: message.pitch, sprint: message.sprint === true,
      crouch: message.crouch === true, jump: message.jump === true,
    }, started: false });
    return true;
  }

  resetPlayerControls(cancelAttacks = false) {
    super.resetPlayerControls(cancelAttacks);
    for (const state of this.inputs?.values() ?? []) { state.queue.length = 0; state.ack = state.received; }
  }

  start(id) {
    const result = super.start(id);
    if (result) {
      this.epoch = randomBytes(8).toString('hex'); this.history.length = 0;
      for (const state of this.inputs.values()) {
        state.received = 0; state.ack = 0; state.shotId = -1; state.queue.length = 0;
      }
      this.recordHistory();
    }
    return result;
  }

  movePlayer(player, delta) {
    if (!player.alive || ['extraction', 'victory', 'gameover'].includes(this.phase)) return;
    const state = this.inputs.get(player.id);
    // A socket can enqueue arbitrary dt values but can never buy simulation
    // time. Total physics here is at most this server tick, including gravity.
    let budget = clamp(delta, 0, .1), steps = 0;
    while (state?.connected && state.queue.length && budget > 1e-9 && ++steps <= 16) {
      const command = state.queue[0], duration = Math.min(command.left, budget);
      if (!command.started) { super.setInput(player.id, command.input); command.started = true; }
      movementMethods.movePlayer.call(this, player, duration);
      command.left -= duration; budget -= duration;
      if (command.left <= 1e-9) { state.ack = command.seq; state.queue.shift(); }
    }
    if (budget > 1e-9) {
      // A missing packet stops translation, not the crouch posture that the
      // last accepted command established underneath a low ceiling.
      player.input = { ...neutral(), crouch: player.input.crouch }; player.jumpRequested = false;
      movementMethods.movePlayer.call(this, player, budget);
    }
  }

  event(event, details = {}) {
    const shot = this.activeShot;
    super.event(event, shot && details.id === shot.id ? { ...details, shotId: shot.shotId } : details);
  }

  recordHistory(serverTime = this.clock()) {
    this.history.push({ serverTime, zombies: new Map([...this.zombies].map(([id, zombie]) => [id, enemyPose(zombie)])) });
    while (this.history.length > 32 || (this.history.length > 1 && this.history[1].serverTime < serverTime - this.maxRewindMs - 1000 / TICK_RATE)) this.history.shift();
  }

  historicalPositions(viewTime) {
    if (!this.history.length) return null;
    const earlier = this.history.findLast(frame => frame.serverTime <= viewTime) ?? this.history[0];
    const later = this.history.find(frame => frame.serverTime >= viewTime) ?? this.history.at(-1);
    const ratio = earlier === later ? 0 : clamp((viewTime - earlier.serverTime) / (later.serverTime - earlier.serverTime), 0, 1);
    return new Map([...earlier.zombies].map(([id, pose]) => {
      const next = later.zombies.get(id) ?? pose;
      return [id, { x: pose.x + (next.x - pose.x) * ratio, y: pose.y + (next.y - pose.y) * ratio, z: pose.z + (next.z - pose.z) * ratio, yaw: pose.yaw,
        ...(typeof pose.crouched === 'boolean' ? { crouched: pose.crouched } : {}) }];
    }));
  }

  pushZombie(...args) {
    if (this.rewindPushes) { this.rewindPushes.push(args); return; }
    return super.pushZombie(...args);
  }

  dropZombieLoot(zombie, ...args) {
    const current = this.rewindPositions?.get(zombie.id);
    if (!current) return super.dropZombieLoot(zombie, ...args);
    const old = enemyPose(zombie);
    Object.assign(zombie, current);
    try { return super.dropZombieLoot(zombie, ...args); } finally { Object.assign(zombie, old); }
  }

  shootOnline(id, subTick, message = {}, { rttMs = 0 } = {}) {
    const player = this.players.get(id), input = this.inputs.get(id);
    if (!player || player.waiting || !input?.connected) return false;
    const shotId = message.shotId;
    if (shotId !== undefined) {
      if (!Number.isSafeInteger(shotId) || shotId < 0 || shotId > 0x7fffffff || shotId <= input.shotId) return false;
      input.shotId = shotId;
    }
    if (message.yaw !== undefined || message.pitch !== undefined) {
      if (![message.yaw, message.pitch].every(value => typeof value === 'number' && Number.isFinite(value))) return false;
      // Aim is a free mouse input, never a client-supplied hit or position.
      player.yaw = Math.atan2(Math.sin(message.yaw), Math.cos(message.yaw));
      player.pitch = clamp(message.pitch, -1.48, 1.48);
    }
    const selected = this.weaponHandState(player, message.hand ?? 'primary');
    if (!selected) return false;
    const now = this.clock(), weapon = this.weaponProfile(player, selected.weaponId);
    // Only hitscan enemies are rewound. Doors, shooter, ammo, cooldown, deaths,
    // projectiles, flame and melee stay in the authoritative present.
    const requested = message.viewTime;
    const viewDelay = Number.isFinite(message.interpolationMs) ? clamp(message.interpolationMs, 100, 200) : this.interpolationMs;
    const allowance = Math.min(this.maxRewindMs, Math.max(0, Number.isFinite(rttMs) ? rttMs : 0) / 2 + viewDelay);
    const viewTime = Number.isFinite(requested) ? clamp(requested, now - allowance, now) : now;
    const historical = weapon && !(this.ballisticsEnabled && weapon.bulletPhysics) && !weapon.melee && !['rocket', 'flamethrower'].includes(selected.weapon) && viewTime < now ? this.historicalPositions(viewTime) : null;
    const saved = new Map(), hidden = new Map();
    this.activeShot = { id, shotId };
    if (historical) {
      for (const [zombieId, zombie] of this.zombies) {
        saved.set(zombieId, enemyPose(zombie));
        const pose = historical.get(zombieId);
        if (pose) Object.assign(zombie, pose);
        else { hidden.set(zombieId, zombie); this.zombies.delete(zombieId); }
      }
      this.rewindPositions = saved; this.rewindPushes = [];
    }
    let accepted;
    try { accepted = super.shoot(id, subTick, message.attack, message.hand ?? 'primary'); }
    finally {
      const pushes = this.rewindPushes;
      for (const [zombieId, pose] of saved) {
        const zombie = this.zombies.get(zombieId);
        if (zombie) Object.assign(zombie, pose);
      }
      for (const [zombieId, zombie] of hidden) this.zombies.set(zombieId, zombie);
      this.rewindPositions = null; this.rewindPushes = null; this.activeShot = null;
      for (const args of pushes ?? []) if (this.zombies.has(args[0].id)) super.pushZombie(...args);
    }
    return accepted;
  }

  // A loaded night starts a new input/rewind epoch, like a new night.
  importSave(...args) {
    const result = super.importSave(...args);
    if (result.ok) {
      this.epoch = randomBytes(8).toString('hex'); this.history.length = 0;
      for (const state of this.inputs.values()) { state.received = 0; state.ack = 0; state.shotId = -1; state.queue.length = 0; }
      this.recordHistory();
    }
    return result;
  }

  bindSeat(...args) {
    const bound = super.bindSeat(...args), state = this.inputs.get(args[1]);
    if (bound && state) { state.queue.length = 0; state.ack = state.received; }
    return bound;
  }

  transientSaveFields() {
    return new Set([...super.transientSaveFields(), 'clock', 'maxInputDt', 'maxInputQueue', 'maxRewindMs', 'interpolationMs',
      'inputs', 'history', 'epoch', 'activeShot', 'rewindPushes', 'rewindPositions']);
  }

  tick(delta = 1 / TICK_RATE) { super.tick(delta); this.recordHistory(); }

  snapshot(serverTime = this.clock()) {
    const snapshot = super.snapshot();
    snapshot.net = { serverTime, epoch: this.epoch, acks: Object.fromEntries([...this.inputs].map(([id, state]) => [id, state.ack])) };
    for (const visible of snapshot.players) {
      const player = this.players.get(visible.id);
      Object.assign(visible, {
        x: player.x, y: player.y, z: player.z, vy: player.vy,
        fallStartY: player.fallStartY, jumpHeld: player.jumpHeld, jumpRequested: player.jumpRequested,
        partitionSlideLeft: player.partitionSlideLeft, lastInputAt: player.lastInputAt,
        input: { ...player.input }, connected: this.inputs.get(player.id)?.connected === true,
      });
    }
    return snapshot;
  }
}
