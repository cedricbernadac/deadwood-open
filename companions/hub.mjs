// The one place a companion brain connects to (companions/DESIGN.md): a
// WebSocket at /companions that only this PC can open. A brain answers
// "decide" requests; a new brain replaces the old one. With mapId the hub
// names its map in the welcome and in every request (the brain picks that
// map's guide); a gateway hub also lists every map's root so one brain opens a
// link per map, and seats only a brain with requireCapability.
export const CAPABILITIES = ['team-plan-v1', 'map-guide-v1'];
export const OUTDATED_CODE = 4002;
export class CompanionHub {
  constructor({ timeout = 6000, mapId = null, maps = null, requireCapability = null } = {}) {
    this.timeout = timeout;
    this.mapId = mapId;
    this.maps = maps;
    this.requireCapability = requireCapability;
    this.socket = null;
    this.brain = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 1;
  }

  get connected() { return Boolean(this.socket && this.brain); }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  notify() { for (const listener of this.listeners) listener(this.connected); }

  // A newcomer takes the seat only once it says hello: a stray connection
  // never unseats the brain, and a handover keeps the companions in play.
  attach(socket) {
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'brain-hello') {
        const capabilities = Array.isArray(message.capabilities) ? CAPABILITIES.filter(name => message.capabilities.includes(name)) : [];
        // An outdated brain would drive this map's bots with another map's
        // guide: it is turned away before it touches the seat.
        if (this.requireCapability && !capabilities.includes(this.requireCapability)) {
          try { socket.close(OUTDATED_CODE, 'Cerveau à mettre à jour : relance companions.cmd.'); } catch {}
          return;
        }
        const wasConnected = this.connected, previous = this.socket;
        if (previous && previous !== socket) this.release(previous, 'replaced');
        this.socket = socket;
        this.brain = { name: String(message.name ?? 'brain').slice(0, 40), version: Number(message.version) || 1, capabilities };
        socket.send(JSON.stringify({ type: 'brain-welcome', ...(this.mapId ? { mapId: this.mapId } : {}),
          ...(this.maps ? { maps: this.maps.map(({ id, root }) => ({ id, root })) } : {}) }));
        if (!wasConnected) this.notify();
      } else if (['decision', 'team-plan'].includes(message.type) && typeof message.id === 'string' && this.socket === socket) {
        const waiting = this.pending.get(message.id);
        if (!waiting || message.type !== waiting.expected) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        waiting.resolve(message);
      }
    });
    const lost = () => this.detach(socket, 'disconnected');
    socket.on('close', lost);
    socket.on('error', lost);
  }

  detach(socket, reason) {
    if (this.socket !== socket) return;
    const wasConnected = this.connected;
    this.release(socket, reason);
    this.socket = null;
    this.brain = null;
    if (wasConnected) this.notify();
  }

  // Answers every question still waiting on that brain, and lets it go.
  release(socket, reason) {
    for (const [id, waiting] of this.pending) { clearTimeout(waiting.timer); waiting.resolve({ type: waiting.expected, id, error: reason }); }
    this.pending.clear();
    try { if (reason === 'replaced') socket.close(1000, 'Un autre cerveau a pris la place.'); } catch {}
  }

  // Resolves with the brain's answer, or with { error } on timeout or loss.
  request(payload) {
    const kind = payload.type === 'plan' ? 'plan' : 'decide';
    const expected = kind === 'plan' ? 'team-plan' : 'decision';
    if (!this.connected) return Promise.resolve({ type: expected, error: 'offline' });
    const id = `d${this.nextId++}`;
    const socket = this.socket;
    const promise = new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try { socket.send(JSON.stringify({ type: 'cancel', id })); } catch {}
        resolve({ type: expected, id, error: 'timeout' });
      }, kind === 'plan' ? Math.max(this.timeout, 12000) : this.timeout);
      this.pending.set(id, { resolve, timer, expected });
      try { socket.send(JSON.stringify({ ...payload, type: kind, id, ...(this.mapId ? { mapId: this.mapId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(id); resolve({ type: 'decision', id, error: 'offline' }); }
    });
    promise.cancel = () => {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(id);
      try { socket.send(JSON.stringify({ type: 'cancel', id })); } catch {}
      pending.resolve({ type: expected, id, error: 'cancelled' });
    };
    return promise;
  }

  requestPlan(payload) { return this.request({ ...payload, type: 'plan' }); }

  close() { if (this.socket) this.detach(this.socket, 'closed'); }
}
