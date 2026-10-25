// This module is loaded only when /connection.json explicitly enables ONLINE.
// It owns presentation prediction, never health, ammunition or game decisions.
import { clonePredictedPlayer, createPhysicsContext, stepPredictedPlayer } from './physics.js';
import { ClockSync, SnapshotTimeline } from './timeline.js';

const finite = Number.isFinite;
const clamp = (number, low, high) => Math.max(low, Math.min(high, number));
const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();
const frozen = snapshot => !snapshot || snapshot.paused === true || ['extraction', 'victory', 'gameover'].includes(snapshot.phase);
const position = player => player && [player.x, player.y, player.z].every(finite);
const ackFor = (snapshot, playerId) => {
  const ack = snapshot?.net?.acks?.[playerId] ?? snapshot?.net?.ackSeq ?? 0;
  return Number.isSafeInteger(ack) && ack >= 0 ? ack : 0;
};
function cleanInput(input = {}, aim = { yaw: 0, pitch: 0 }) {
  return { forward: finite(input.forward) ? clamp(input.forward, -1, 1) : 0,
    strafe: finite(input.strafe) ? clamp(input.strafe, -1, 1) : 0,
    sprint: input.sprint === true, crouch: input.crouch === true, jump: input.jump === true,
    yaw: finite(input.yaw) ? input.yaw : aim.yaw,
    pitch: finite(input.pitch) ? clamp(input.pitch, -1.48, 1.48) : aim.pitch };
}

export class OnlineSession {
  constructor({ playerId = null, now = defaultNow, tickRate = 30, interpolationMs = 100,
    maxPending = 90, staleAfterMs = 1000 } = {}) {
    this.now = now; this.playerId = playerId;
    this.tickDt = 1 / clamp(finite(tickRate) ? tickRate : 30, 20, 60);
    this.maxPending = clamp(Number.isSafeInteger(maxPending) ? maxPending : 90, 4, 180);
    this.staleAfterMs = clamp(finite(staleAfterMs) ? staleAfterMs : 1000, 250, 3000);
    this.clock = new ClockSync({ now });
    this.timeline = new SnapshotTimeline({ now, clock: this.clock, interpolationMs });
    this.connected = true; this.nextSeq = 1; this.nextShotId = 1;
    this.epoch = null; this.retiredEpochs = new Set(); this.snapshot = null;
    this.pending = []; this.accumulator = 0; this.predicted = null; this.preview = null;
    this.aim = { yaw: 0, pitch: 0 }; this.input = cleanInput();
    this.correction = { x: 0, y: 0, z: 0 }; this.effects = new Map();
    this.receivedAt = null; this.lastAck = 0; this.context = null;
  }
  reset({ playerId = this.playerId, epoch = null, snapshot = null, receivedAt = this.now() } = {}) {
    this.playerId = playerId; this.epoch = epoch; this.retiredEpochs.clear();
    this.snapshot = null; this.pending = []; this.accumulator = 0;
    this.predicted = this.preview = this.context = null;
    this.lastAck = 0; this.receivedAt = null; this.connected = true;
    this.correction = { x: 0, y: 0, z: 0 }; this.effects.clear();
    this.clock.reset(); this.timeline.reset();
    if (snapshot) this.ingestSnapshot(snapshot, { receivedAt });
  }
  setConnected(connected) {
    this.connected = connected === true;
    if (!this.connected) { this.pending = []; this.accumulator = 0; this.effects.clear(); }
  }
  disconnected() { this.setConnected(false); }
  get predictedPlayer() { return this.preview ?? this.predicted; }
  get pendingCount() { return this.pending.length; }

  ingestSnapshot(snapshot, { receivedAt = this.now() } = {}) {
    const time = snapshot?.net?.serverTime, epoch = snapshot?.net?.epoch ?? this.epoch;
    if (!finite(time) || !finite(receivedAt) || !Array.isArray(snapshot?.players) || !Array.isArray(snapshot?.zombies)) return false;
    if (this.retiredEpochs.has(epoch)) return false;
    const changedEpoch = this.epoch !== null && epoch !== this.epoch;
    if (!changedEpoch && this.snapshot && time <= this.snapshot.net.serverTime) return false;
    const self = snapshot.players.find(player => player.id === this.playerId);
    if (!position(self)) return false;
    const ack = ackFor(snapshot, this.playerId);
    if (!changedEpoch && this.snapshot && ack < this.lastAck) return false;
    const transition = changedEpoch || !this.snapshot || snapshot.phase !== this.snapshot.phase
      || (snapshot.paused === true) !== (this.snapshot.paused === true)
      || self.alive !== this.snapshot.players.find(player => player.id === this.playerId)?.alive
      || self.downed !== this.snapshot.players.find(player => player.id === this.playerId)?.downed;
    if (changedEpoch) {
      this.retiredEpochs.add(this.epoch);
      if (this.retiredEpochs.size > 8) this.retiredEpochs.delete(this.retiredEpochs.values().next().value);
      this.clock.reset();
    }
    if (transition) { this.timeline.reset(); this.pending = []; this.accumulator = 0; this.effects.clear(); }
    this.epoch = epoch; this.snapshot = snapshot; this.receivedAt = receivedAt;
    this.timeline.push(snapshot, receivedAt);
    this.lastAck = ack; this.nextSeq = Math.max(this.nextSeq, ack + 1);
    this.pending = this.pending.filter(command => command.seq > ack);
    const previous = this.predictedPlayer;
    this.predicted = clonePredictedPlayer(self); this.context = createPhysicsContext(snapshot);
    if (!previous) { this.aim = { yaw: finite(self.yaw) ? self.yaw : 0, pitch: finite(self.pitch) ? self.pitch : 0 }; this.input = cleanInput({}, this.aim); }
    if (!frozen(snapshot) && this.connected) for (const command of this.pending) stepPredictedPlayer(this.predicted, command, command.dt, this.context);
    this.refreshPreview();
    if (transition || !position(previous)) this.correction = { x: 0, y: 0, z: 0 };
    else {
      const error = { x: previous.x - this.preview.x, y: previous.y - this.preview.y, z: previous.z - this.preview.z };
      // Large corrections must return immediately to an authoritative safe
      // pose. Small reconciliation errors fade without changing local aim.
      if (Math.hypot(error.x, error.y, error.z) > 1.5) this.correction = { x: 0, y: 0, z: 0 };
      else for (const axis of ['x', 'y', 'z']) this.correction[axis] += error[axis];
    }
    return true;
  }
  refreshPreview() {
    if (!this.predicted) { this.preview = null; return; }
    this.preview = clonePredictedPlayer(this.predicted);
    if (this.accumulator > 1e-9 && !frozen(this.snapshot) && this.connected) {
      const context = createPhysicsContext(this.snapshot);
      context.time = this.context.time;
      stepPredictedPlayer(this.preview, this.input, this.accumulator, context);
    }
    this.preview.yaw = this.aim.yaw; this.preview.pitch = this.aim.pitch;
  }
  update(deltaSeconds, input = {}) {
    if (!finite(deltaSeconds) || deltaSeconds < 0) return { commands: [], predictedPlayer: this.predictedPlayer };
    this.input = cleanInput(input, this.aim); this.aim = { yaw: this.input.yaw, pitch: this.input.pitch };
    const stale = this.receivedAt === null || this.now() - this.receivedAt > this.staleAfterMs;
    const blocked = !this.connected || frozen(this.snapshot) || !this.predicted || !this.predicted.alive || stale;
    // A suspended/background tab never catches up seconds of old movement.
    if (blocked || deltaSeconds > .2) {
      this.accumulator = 0;
      if (blocked) this.pending = [];
      this.refreshPreview();
      return { commands: [], predictedPlayer: this.predictedPlayer };
    }
    this.accumulator += deltaSeconds;
    const commands = [];
    while (this.accumulator + 1e-10 >= this.tickDt && this.pending.length < this.maxPending) {
      const command = { type: 'input', ...this.input, seq: this.nextSeq++, dt: this.tickDt };
      this.pending.push(command); commands.push(command);
      stepPredictedPlayer(this.predicted, command, command.dt, this.context);
      this.accumulator = Math.max(0, this.accumulator - this.tickDt);
    }
    if (this.pending.length >= this.maxPending) this.accumulator = 0;
    this.refreshPreview();
    return { commands, predictedPlayer: this.predictedPlayer };
  }
  cameraPlayer(authoritative = null, deltaSeconds = 0) {
    const pose = this.predictedPlayer;
    if (!pose) return authoritative;
    const decay = finite(deltaSeconds) && deltaSeconds >= 0 ? Math.exp(-Math.min(.1, deltaSeconds) * 14) : 1;
    for (const axis of ['x', 'y', 'z']) this.correction[axis] *= decay;
    return { ...(authoritative ?? pose), ...pose,
      x: pose.x + this.correction.x, y: pose.y + this.correction.y, z: pose.z + this.correction.z,
      yaw: this.aim.yaw, pitch: this.aim.pitch };
  }
  trimEffects(now = this.now()) {
    for (const [id, effect] of this.effects) if (now - effect.at > 10000) this.effects.delete(id);
    while (this.effects.size > 256) this.effects.delete(this.effects.keys().next().value);
  }
  createShot({ yaw = this.aim.yaw, pitch = this.aim.pitch, now = this.now(), hand = 'primary' } = {}) {
    if (!this.connected || frozen(this.snapshot) || !this.predicted?.alive || this.predicted.downed
      || !['primary', 'secondary'].includes(hand) || hand === 'secondary' && !this.predicted.dualWield
      || ![yaw, pitch, now].every(finite) || this.receivedAt === null || now - this.receivedAt > this.staleAfterMs) return null;
    this.trimEffects(now);
    const shotId = this.nextShotId++;
    return { type: 'shoot', shotId, yaw, pitch, ...(hand === 'secondary' ? { hand } : {}), viewTime: this.timeline.renderTime(now),
      interpolationMs: clamp(finite(this.timeline.delay) ? this.timeline.delay : 100, 100, 200) };
  }
  markShotPlayed(shotId, now = this.now()) {
    if (!Number.isSafeInteger(shotId) || shotId < 1 || !finite(now)) return false;
    this.effects.set(shotId, { at: now, played: true }); this.trimEffects(now); return true;
  }
  consumeShotEcho(event, now = this.now()) {
    if (event?.id !== this.playerId || !Number.isSafeInteger(event?.shotId)) return true;
    this.trimEffects(now);
    const previous = this.effects.get(event.shotId);
    this.effects.set(event.shotId, { at: now, played: true }); this.trimEffects(now);
    return previous?.played !== true;
  }
}
