// Online-only presentation helpers. Simulation never uses these clocks or
// interpolated positions; LAN keeps its original snapshot path.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = Number.isFinite;
const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();

export function shortestAngle(from, to, alpha) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
}

/** RTT/clock estimates are presentation hints, never a movement time budget. */
export class ClockSync {
  constructor({ now = defaultNow, maxRtt = 30000 } = {}) {
    this.now = now; this.maxRtt = maxRtt; this.reset();
  }
  reset() { this.samples = []; this.offset = null; this.rtt = null; this.anchor = null; }
  recordSnapshot(serverTime, receivedAt = this.now()) {
    if (!finite(serverTime) || !finite(receivedAt)) return false;
    if (this.anchor && serverTime <= this.anchor.serverTime) return false;
    this.anchor = { serverTime, receivedAt };
    return true;
  }
  recordPong(message, receivedAt = this.now()) {
    const sentAt = message?.clientTime, serverTime = message?.serverTime;
    if (![sentAt, serverTime, receivedAt].every(finite)) return false;
    const rtt = receivedAt - sentAt;
    if (rtt < 0 || rtt > this.maxRtt) return false;
    if (this.samples.length && sentAt <= this.samples.at(-1).sentAt) return false;
    this.samples.push({ sentAt, rtt, offset: serverTime - (sentAt + receivedAt) / 2 });
    if (this.samples.length > 16) this.samples.shift();
    // The least delayed half of the recent samples is less distorted by
    // congestion. A median keeps a lone lucky/outlying measurement harmless.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.ceil(this.samples.length / 2));
    const offsets = best.map(sample => sample.offset).sort((a, b) => a - b);
    const offset = offsets[Math.floor(offsets.length / 2)];
    this.offset = this.offset === null ? offset : this.offset + clamp(offset - this.offset, -20, 20) * .25;
    this.rtt = this.rtt === null ? rtt : this.rtt * .8 + rtt * .2;
    return true;
  }
  serverNow(clientTime = this.now()) {
    if (!finite(clientTime)) return null;
    if (this.offset !== null) return clientTime + this.offset;
    return this.anchor ? this.anchor.serverTime + Math.max(0, clientTime - this.anchor.receivedAt) : null;
  }
}

function copySnapshot(snapshot) {
  return { ...snapshot, net: { ...snapshot.net },
    players: (snapshot.players ?? []).map(player => ({ ...player })),
    zombies: (snapshot.zombies ?? []).map(zombie => ({ ...zombie })) };
}
const validPose = actor => actor && [actor.x, actor.y, actor.z].every(finite);

/** A bounded, delayed view of remote actors, with no extrapolation. */
export class SnapshotTimeline {
  constructor({ now = defaultNow, clock = new ClockSync({ now }), interpolationMs = 100,
    maxInterpolationMs = 200, maxSnapshots = 32, maxAgeMs = 2000 } = {}) {
    this.now = now; this.clock = clock;
    this.baseDelay = clamp(finite(interpolationMs) ? interpolationMs : 100, 50, 200);
    this.maxDelay = Math.max(this.baseDelay, Math.min(250, maxInterpolationMs));
    this.maxSnapshots = Math.max(2, Math.min(128, maxSnapshots));
    this.maxAgeMs = Math.max(250, Math.min(10000, maxAgeMs));
    this.reset();
  }
  reset() {
    this.frames = []; this.jitter = 0; this.lastArrival = null; this.delay = this.baseDelay; this.lastRenderTime = null;
    this.births = { players: new Map(), zombies: new Map() };
  }
  get latest() { return this.frames.at(-1)?.snapshot ?? null; }
  push(snapshot, receivedAt = this.now()) {
    const serverTime = snapshot?.net?.serverTime;
    if (!finite(serverTime) || !finite(receivedAt)) return false;
    const last = this.frames.at(-1);
    if (last && serverTime <= last.serverTime) return false;
    if (last && receivedAt >= last.receivedAt) {
      const deviation = Math.abs((receivedAt - last.receivedAt) - (serverTime - last.serverTime));
      this.jitter += (Math.min(deviation, 200) - this.jitter) * .15;
      const target = clamp(this.baseDelay + this.jitter * 2, this.baseDelay, this.maxDelay);
      this.delay += (target - this.delay) * .2;
    }
    for (const key of ['players', 'zombies']) {
      const current = new Set((snapshot[key] ?? []).map(actor => actor.id));
      for (const id of this.births[key].keys()) if (!current.has(id)) this.births[key].delete(id);
      for (const id of current) if (!this.births[key].has(id)) {
        // Actors already present when this view starts have an unknown older
        // birth. Later arrivals must not be shown before the history used for
        // their hitscan rewind can contain them.
        this.births[key].set(id, last ? serverTime : -Infinity);
      }
    }
    this.frames.push({ serverTime, receivedAt, snapshot: copySnapshot(snapshot) });
    this.clock.recordSnapshot(serverTime, receivedAt);
    while (this.frames.length > this.maxSnapshots || (this.frames.length > 2 && serverTime - this.frames[0].serverTime > this.maxAgeMs)) this.frames.shift();
    this.lastArrival = receivedAt;
    return true;
  }
  renderTime(clientTime = this.now()) {
    const serverNow = this.clock.serverNow(clientTime), latest = this.frames.at(-1);
    if (!latest || serverNow === null) return null;
    const target = Math.min(latest.serverTime, serverNow - this.delay);
    // Increasing a jitter buffer must not make a running actor walk backward.
    const result = this.lastRenderTime === null ? target : Math.max(this.lastRenderTime, target);
    this.lastRenderTime = result;
    return result;
  }
  sample(clientTime = this.now()) {
    const latest = this.latest;
    if (!latest) return null;
    const target = this.renderTime(clientTime);
    let before = this.frames[0], after = before;
    for (const frame of this.frames) {
      if (frame.serverTime <= target) before = frame;
      if (frame.serverTime >= target) { after = frame; break; }
      after = frame;
    }
    const span = after.serverTime - before.serverTime;
    const alpha = span > 0 ? clamp((target - before.serverTime) / span, 0, 1) : 0;
    const interpolate = key => {
      const oldActors = new Map(before.snapshot[key].map(actor => [actor.id, actor]));
      const newActors = new Map(after.snapshot[key].map(actor => [actor.id, actor]));
      // Membership comes from the newest authority. Dead/despawned actors
      // cannot reappear while their older interpolation frames are retained.
      return latest[key].filter(current => validPose(current) && this.births[key].get(current.id) <= target).map(current => {
        const from = oldActors.get(current.id), to = newActors.get(current.id);
        if (!validPose(from) || !validPose(to) || current.alive === false || current.hp <= 0) return { ...current };
        if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > 8) return { ...current };
        const pose = { ...current };
        // Raider stance changes the hittable silhouette. Show the stance at
        // the displayed time, matching rewind; health/death stay authoritative.
        if (current.kind === 'raider') {
          pose.crouched = from.crouched === true;
          pose.reloading = from.reloading === true;
        }
        for (const axis of ['x', 'y', 'z']) pose[axis] = from[axis] + (to[axis] - from[axis]) * alpha;
        if (finite(from.yaw) && finite(to.yaw)) pose.yaw = shortestAngle(from.yaw, to.yaw, alpha);
        if (finite(from.pitch) && finite(to.pitch)) pose.pitch = from.pitch + (to.pitch - from.pitch) * alpha;
        return pose;
      });
    };
    return { ...latest, players: interpolate('players'), zombies: interpolate('zombies'),
      net: { ...latest.net, renderTime: target, interpolationMs: this.delay } };
  }
}

/** Pure backoff; callers own cancellation, grace deadlines and storage. */
export function reconnectDelay(attempt, { baseMs = 500, capMs = 30000, jitter = 0, random = .5 } = {}) {
  const count = finite(attempt) ? clamp(Math.floor(attempt), 0, 20) : 0;
  const base = finite(baseMs) ? clamp(baseMs, 1, 30000) : 500;
  const cap = finite(capMs) ? clamp(capMs, base, 30000) : 30000;
  const variation = 1 + (clamp(finite(random) ? random : .5, 0, 1) * 2 - 1) * clamp(finite(jitter) ? jitter : 0, 0, .5);
  return Math.round(clamp(Math.min(cap, base * 2 ** count) * variation, 1, cap));
}
