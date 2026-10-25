// WebSocket-compatible online adapter. Tokens live in RAM for this tab only.
// The LAN page never imports this module or changes its socket lifecycle.
import { mapEndpoint } from '../map-context.js';
import { OnlineSession } from './session.js';
import { reconnectDelay } from './timeline.js';

const PROTOCOL = 1;
const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;
const messageEvent = data => {
  const event = new Event('message'); Object.defineProperty(event, 'data', { value: JSON.stringify(data) }); return event;
};
const detailEvent = (type, detail) => {
  const event = new Event(type); Object.defineProperty(event, 'detail', { value: detail }); return event;
};
async function readConfiguration(fetcher, pathname) {
  const responses = await Promise.all([fetcher(mapEndpoint('/connection.json', pathname), { cache: 'no-store' }), fetcher(mapEndpoint('/version.json', pathname), { cache: 'no-store' })]);
  if (responses.some(response => !response.ok)) throw new Error('Online configuration unavailable.');
  const [config, version] = await Promise.all(responses.map(response => response.json()));
  return { config, build: version.build };
}

export class OnlineTransport extends EventTarget {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;
  constructor(url, { WebSocket: Socket = globalThis.WebSocket, fetch: fetcher = globalThis.fetch?.bind(globalThis),
    now = () => performance.now(), setTimeout: schedule = globalThis.setTimeout.bind(globalThis),
    clearTimeout: cancel = globalThis.clearTimeout.bind(globalThis), loadConfiguration = () => readConfiguration(fetcher, new URL(url).pathname),
    session = new OnlineSession({ now }) } = {}) {
    super();
    this.url = String(url); this.Socket = Socket; this.now = now; this.schedule = schedule; this.cancel = cancel;
    this.session = session; this.readyState = CONNECTING; this.socket = null; this.resumeToken = null;
    this.joined = false; this.ended = false; this.reconnecting = false; this.awaitingResumeState = false;
    this.attempt = 0; this.deadline = null; this.retryTimer = this.graceTimer = this.pingTimer = this.freshnessTimer = null;
    this.stale = false;
    this.lastMessageAt = now(); this.nonce = 0; this.pendingPings = new Map(); this.lastWelcome = null;
    Promise.resolve().then(loadConfiguration).then(({ config, build }) => {
      if (this.ended) return;
      if (config?.mode !== 'online' || config.protocol !== PROTOCOL || typeof build !== 'string' || !build)
        throw new Error('This address does not serve the online game.');
      this.config = config; this.build = build;
      this.session.tickDt = 1 / (config.inputRate === 30 ? config.inputRate : 30);
      this.openSocket(false);
    }).catch(error => { if (!this.ended) { this.dispatchEvent(detailEvent('online-status', { state: 'lost', error: error.message })); this.dispatchEvent(new Event('error')); this.finishClose(1006, 'Online configuration unavailable.'); } });
  }
  emitStatus(state, extra = {}) { this.dispatchEvent(detailEvent('online-status', { state, ...extra })); }
  clearTimers() {
    for (const key of ['retryTimer', 'graceTimer', 'pingTimer', 'freshnessTimer']) { if (this[key] !== null) this.cancel(this[key]); this[key] = null; }
    this.pendingPings.clear();
  }
  openSocket(resume) {
    if (this.ended || resume && this.now() >= this.deadline) { if (!this.ended) this.finishClose(1006, 'Resume timed out.'); return; }
    this.readyState = CONNECTING;
    let socket;
    try { socket = new this.Socket(this.url); }
    catch { if (resume) this.retry(); else this.finishClose(1006, 'Unable to open the connection.'); return; }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.ended || socket !== this.socket) return;
      this.readyState = OPEN; this.lastMessageAt = this.now();
      if (resume) socket.send(JSON.stringify({ type: 'resume', protocol: PROTOCOL, build: this.build, token: this.resumeToken }));
      else { this.emitStatus('connecting'); this.dispatchEvent(new Event('open')); }
      this.startPing(); this.startFreshnessWatchdog();
    });
    socket.addEventListener('message', event => {
      if (this.ended || socket !== this.socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      this.lastMessageAt = this.now();
      if (message.type === 'network-ping') {
        socket.send(JSON.stringify({ type: 'network-pong', nonce: message.nonce })); return;
      }
      if (message.type === 'pong') {
        if (this.pendingPings.get(message.nonce) === message.clientTime) {
          this.pendingPings.delete(message.nonce);
          if (this.session.clock.recordPong(message, this.now())) this.emitStatus(this.stale ? 'stale' : this.reconnecting ? 'retry' : 'ready', { rtt: this.session.clock.rtt });
        }
        return;
      }
      if (message.type === 'server-shutdown') {
        this.emitStatus('warning'); this.dispatchEvent(messageEvent(message)); this.finishClose(1001, 'Server restarting.'); return;
      }
      if (message.type === 'outdated') {
        this.dispatchEvent(messageEvent(message)); this.finishClose(1000, 'Client update required.'); return;
      }
      if (message.type === 'welcome') {
        if (typeof message.id !== 'string' || typeof message.resumeToken !== 'string' || message.build !== this.build
          || message.network?.protocol !== PROTOCOL || message.network?.mode !== 'online'
          || resume && (message.resumed !== true || message.id !== this.lastWelcome?.id)) {
          this.finishClose(1008, 'Invalid online welcome.'); return;
        }
        this.resumeToken = message.resumeToken; this.joined = true; this.lastWelcome = message;
        // The server clears queued controls while disconnected. Discard every
        // old prediction/shot and wait for the new full authoritative snapshot.
        this.session.reset({ playerId: message.id, epoch: message.network.epoch });
        this.session.setConnected(true);
        if (resume) this.awaitingResumeState = true;
        else { this.emitStatus('ready'); this.dispatchEvent(messageEvent(message)); }
        return;
      }
      if (message.type === 'state') {
        if (!this.joined || !this.session.ingestSnapshot(message)) return;
        if (this.awaitingResumeState || this.stale) {
          this.stale = false; this.session.setConnected(true);
          this.awaitingResumeState = false; this.reconnecting = false; this.attempt = 0; this.deadline = null;
          if (this.graceTimer !== null) this.cancel(this.graceTimer); this.graceTimer = null;
          this.emitStatus('restored'); this.dispatchEvent(detailEvent('online-restored', { id: this.lastWelcome.id }));
        }
      }
      if (message.type === 'error' && resume && this.reconnecting) { this.dispatchEvent(messageEvent(message)); this.finishClose(1006, message.message ?? 'Resume refused.'); return; }
      this.dispatchEvent(messageEvent(message));
    });
    socket.addEventListener('error', () => { if (!this.ended && socket === this.socket && !this.reconnecting) this.dispatchEvent(new Event('error')); });
    socket.addEventListener('close', event => {
      if (this.ended || socket !== this.socket) return;
      this.readyState = CLOSED; this.session.disconnected();
      if (this.pingTimer !== null) this.cancel(this.pingTimer); this.pingTimer = null;
      if (this.joined && this.resumeToken) this.retry();
      else this.finishClose(event.code ?? 1006, event.reason ?? 'Connection closed.');
    });
  }
  retry() {
    if (this.ended) return;
    if (!this.reconnecting) {
      this.reconnecting = true; this.session.disconnected(); this.awaitingResumeState = false;
      this.deadline = this.now() + Math.min(30000, this.config?.resumeGraceMs ?? 30000);
      this.emitStatus('retry'); if (!this.stale) this.dispatchEvent(new Event('online-disconnected'));
      this.graceTimer = this.schedule(() => this.finishClose(1006, 'Resume timed out.'), Math.max(0, this.deadline - this.now()));
    }
    const remaining = this.deadline - this.now();
    if (remaining <= 0) { this.finishClose(1006, 'Resume timed out.'); return; }
    this.readyState = CONNECTING;
    const wait = Math.min(remaining, reconnectDelay(this.attempt++, { capMs: 4000 }));
    if (this.retryTimer !== null) this.cancel(this.retryTimer);
    this.retryTimer = this.schedule(() => { this.retryTimer = null; this.openSocket(true); }, wait);
  }
  startPing() {
    if (this.pingTimer !== null) this.cancel(this.pingTimer);
    this.pingTimer = this.schedule(() => {
      this.pingTimer = null;
      if (this.ended || this.socket?.readyState !== OPEN) return;
      if (this.now() - this.lastMessageAt > 8000) { this.socket.close(4000, 'Heartbeat timed out.'); return; }
      const clientTime = this.now(), nonce = ++this.nonce;
      this.pendingPings.set(nonce, clientTime);
      while (this.pendingPings.size > 8) this.pendingPings.delete(this.pendingPings.keys().next().value);
      this.socket.send(JSON.stringify({ type: 'ping', nonce, clientTime })); this.startPing();
    }, 2000);
  }
  startFreshnessWatchdog() {
    if (this.freshnessTimer !== null) this.cancel(this.freshnessTimer);
    this.freshnessTimer = this.schedule(() => {
      this.freshnessTimer = null;
      if (this.ended) return;
      if (!this.reconnecting && !this.stale && this.joined && this.session.receivedAt !== null
        && this.now() - this.session.receivedAt > this.session.staleAfterMs) {
        // TCP can remain OPEN while game state stops arriving. Neutralize held
        // controls/audio now; a later state still requires an explicit resume.
        this.stale = true; this.session.disconnected(); this.emitStatus('stale');
        this.dispatchEvent(new Event('online-disconnected'));
      }
      this.startFreshnessWatchdog();
    }, 250);
  }
  send(raw) {
    if (this.readyState !== OPEN || this.ended || this.reconnecting) return false;
    let message;
    try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return false; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    if (this.stale && !['melee-cancel', 'minigun-spin', 'leave', 'ping'].includes(message.type)) return false;
    if (message.type === 'join') message = { ...message, protocol: PROTOCOL,
      build: typeof message.build === 'string' && message.build ? message.build : this.build };
    // Legacy input sends have no sequence; only OnlineSession's fixed steps
    // may consume movement time on the online authority.
    if (message.type === 'input' && (!Number.isSafeInteger(message.seq) || !Number.isFinite(message.dt))) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  close(code = 1000, reason = 'Leaving the room.') {
    if (this.ended) return;
    if (this.joined && this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type: 'leave' }));
    this.finishClose(code, reason);
  }
  finishClose(code, reason) {
    if (this.ended) return;
    this.ended = true; this.readyState = CLOSED; this.clearTimers(); this.resumeToken = null;
    this.session.disconnected();
    if (this.socket && this.socket.readyState < CLOSING) this.socket.close(code === 1006 ? 1000 : code, reason);
    this.emitStatus(code === 1000 ? 'waiting' : 'lost');
    this.dispatchEvent(detailEvent('close', { code, reason }));
  }
}
