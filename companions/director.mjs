// One room's AI companions (companions/DESIGN.md): adds and removes them for
// the host, moves their bodies every tick and asks the brain what each one
// does next. The brain decides; nothing here chooses an order.
import { PLAN_TIMING, assignmentFor, teamIntent, planningWave, planSignature, describeTeamPlan, normalizeTeamPlan } from './team-plan.mjs';
import { COMPANION_PROFILE_CHOICES } from '../public/companion-profiles.js';
import { rollCompanionProfile, restoreCompanionProfile } from './profiles.mjs';
export const COMPANION_NAMES = Object.freeze(['Max', 'Léa', 'Sam']);
export const COMPANION_TIMING = Object.freeze({ wave: 1, calm: 2, trigger: .35, stale: 5, callout: 4, lowHp: 40 });
// Switching to another target of the same kind (another zombie, another
// door) wastes the reaction time: only when the brain is fairly sure.
export const SWITCH_CONFIDENCE = .45;
const URGENT_KINDS = ['revive', 'kit', 'self-kit'];
const ACTIVE_PHASES = ['countdown', 'wave', 'intermission'];
const EDIT_PHASES = ['lobby', 'gameover', 'victory'];
const CALLOUT_KINDS = ['revive', 'kit', 'defend', 'repair', 'buy', 'follow', 'loft'];
const TRIGGER_EVENTS = ['down', 'revive', 'eliminated', 'wave', 'countdown', 'resupply', 'raid', 'raid-squad', 'robbed'];

const orderTarget = order => order?.playerId ?? order?.doorId ?? order?.rackId ?? order?.zombieId ?? order?.pickupId ?? order?.weapon ?? null;

export class CompanionDirector {
  constructor(simulation, hub, { createBody, describe, random = Math.random } = {}) {
    this.simulation = simulation;
    this.hub = hub;
    this.createBody = createBody;
    this.describe = describe;
    this.random = random;
    this.entries = new Map();
    this.budgetWarned = false;
    this.nextNumber = 1;
    this.generation = 0;
    this.teamPlanTicket = null;
    this.planNextAt = -Infinity;
    this.planRevision = 0;
    this.plannedSignature = null;
    simulation.companionTeamPlan = null;
    simulation.companionOrders = new Map();
    simulation.companionSelections = COMPANION_NAMES.map(() => 'random');
  }

  get count() { return this.entries.size; }

  humans() { return [...this.simulation.players.values()].filter(player => player.companion !== true); }

  // Host only, between nights, with a brain connected. 0–3, never more than
  // four survivors in all.
  setCount(count, byId, profiles = undefined) {
    const simulation = this.simulation;
    if (!Number.isInteger(count) || count < 0 || count > COMPANION_NAMES.length) return false;
    if (simulation.practice || byId !== simulation.hostId || !EDIT_PHASES.includes(simulation.phase)) return false;
    if (profiles !== undefined && (!Array.isArray(profiles) || profiles.length !== COMPANION_NAMES.length
      || !profiles.every(value => COMPANION_PROFILE_CHOICES.includes(value)))) return false;
    const changed = profiles !== undefined && profiles.some((value, slot) => value !== simulation.companionSelections[slot]);
    if ((count > this.entries.size || changed) && !this.hub.connected) return false;
    if (changed) simulation.companionSelections = [...profiles];
    const target = Math.min(count, 4 - this.humans().length);
    const rosterChanged = target !== this.count;
    while (this.entries.size > target) this.remove([...this.entries.keys()].at(-1));
    while (this.entries.size < target) this.add();
    if (changed) for (const entry of this.entries.values()) {
      if (this.simulation.players.get(entry.id)?.companionProfile?.selection !== profiles[entry.slot]) this.rollProfile(entry);
    }
    if (changed || rosterChanged) this.resetPlan();
    return true;
  }

  add() {
    const used = new Set([...this.entries.values()].map(entry => entry.slot));
    const slot = COMPANION_NAMES.findIndex((_, index) => !used.has(index));
    const name = COMPANION_NAMES[slot] ?? `IA ${this.nextNumber}`;
    const id = `ia-${this.simulation.code}-${this.nextNumber++}`;
    this.simulation.addPlayer(id, name, undefined, { companion: true });
    const player = this.simulation.players.get(id);
    player.companionSlot = slot;
    player.companionProfile = rollCompanionProfile(this.simulation.companionSelections[slot], this.random);
    const body = this.createBody(this.simulation, id, { random: this.random, profile: player.companionProfile });
    this.entries.set(id, { id, name, slot, body, playedNight: false, ticket: null, epoch: 0, lastAskAt: -Infinity, answeredAt: -Infinity, triggered: true, order: null, value: null, orderSince: 0, lastCalloutAt: -Infinity, recent: [], health: [], hurtNoted: -Infinity });
    return id;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (entry) this.interrupt(entry);
    if (!this.entries.delete(id)) return;
    this.simulation.companionOrders.delete(id);
    if (this.simulation.players.has(id)) this.simulation.removePlayer(id);
  }

  // A fourth human takes a companion seat: a companion out of the fight
  // first, never the last one still standing for the team.
  makeRoomForHuman() {
    const simulation = this.simulation;
    if (simulation.players.size < 4) return true;
    const ids = [...this.entries.keys()].reverse();
    const out = ids.find(id => { const player = simulation.players.get(id); return !player || player.waiting || !player.alive || player.downed; });
    if (out) { this.remove(out); return true; }
    const last = ids[0];
    if (!last) return false;
    const fighting = simulation.fightingPlayers?.() ?? [];
    if (!['lobby', 'gameover', 'victory'].includes(simulation.phase) && fighting.length <= 1 && fighting[0]?.id === last) return false;
    this.remove(last);
    return true;
  }

  // The brain left: the companions log out with it.
  removeAll(reason = 'offline') {
    if (!this.entries.size) return false;
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.simulation.event('companions-offline', { reason });
    return true;
  }

  dispose() { this.resetPlan(); this.entries.clear(); }

  // A loaded night replaces the lobby's companions, without the brain notice.
  dropAll() {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.resetPlan();
  }

  // The companions of a loaded night (manual save): same slots and frozen
  // profiles, each bound to its saved record (weapons, bonuses, coins, HP,
  // position). Orders and the team plan are not saved: the brain plans again.
  restore(companions = []) {
    const simulation = this.simulation;
    if (!companions.length) return null;
    if (!this.hub.connected || simulation.practice) return 'offline';
    for (const companion of [...companions].sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9))) {
      const used = new Set([...this.entries.values()].map(entry => entry.slot));
      const slot = Number.isInteger(companion.slot) && companion.slot < COMPANION_NAMES.length && !used.has(companion.slot) ? companion.slot
        : COMPANION_NAMES.findIndex((_, index) => !used.has(index));
      if (slot < 0) break;
      const profile = restoreCompanionProfile(companion.profile) ?? rollCompanionProfile(simulation.companionSelections?.[slot], this.random);
      const id = `ia-${simulation.code}-${this.nextNumber++}`, name = COMPANION_NAMES[slot];
      if (!simulation.adoptCompanion(companion, id, { name, slot, profile })) break;
      const body = this.createBody(simulation, id, { random: this.random, profile });
      this.entries.set(id, { id, name, slot, body, playedNight: true, ticket: null, epoch: 0, lastAskAt: -Infinity, answeredAt: -Infinity, triggered: true, order: null, value: null, orderSince: 0, lastCalloutAt: -Infinity, recent: [], health: [], hurtNoted: -Infinity });
    }
    this.resetPlan();
    return 'restored';
  }

  interrupt(entry) {
    entry.epoch += 1;
    entry.ticket?.request?.cancel?.();
    entry.ticket = null;
    entry.triggered = true;
  }

  rollProfile(entry) {
    const player = this.simulation.players.get(entry.id);
    if (!player) return;
    player.companionProfile = rollCompanionProfile(this.simulation.companionSelections[entry.slot], this.random);
    entry.body.setProfile?.(player.companionProfile);
    entry.playedNight = false;
  }

  resetPlan() {
    this.generation += 1;
    this.teamPlanTicket?.request?.cancel?.();
    this.teamPlanTicket = null;
    this.planNextAt = -Infinity;
    this.planRevision = 0;
    this.plannedSignature = null;
    this.simulation.companionTeamPlan = null;
    this.simulation.companionOrders.clear();
    this.budgetWarned = false;
    for (const entry of this.entries.values()) {
      this.interrupt(entry);
      if (entry.order || entry.value) entry.body.setOrder?.(null);
      entry.order = null; entry.value = null;
      entry.lastAskAt = -Infinity; entry.answeredAt = -Infinity;
      entry.recent = []; entry.health = []; entry.hurtNoted = -Infinity;
    }
  }

  onEvent(message) {
    if (message?.type !== 'event' || !this.entries.size) return;
    const { event } = message;
    if (['countdown', 'gameover', 'victory'].includes(event)) this.resetPlan();
    if (event === 'countdown') for (const entry of this.entries.values()) {
      if (entry.playedNight) this.rollProfile(entry);
      entry.playedNight = true;
    }
    if (['down', 'eliminated', 'raid', 'raid-squad', 'robbed'].includes(event))
      for (const entry of this.entries.values()) this.interrupt(entry);
    if (TRIGGER_EVENTS.includes(event)) for (const entry of this.entries.values()) this.trigger(entry, message);
    else if (event === 'hit' && this.entries.has(message.id) && (this.simulation.players.get(message.id)?.hp ?? 100) < COMPANION_TIMING.lowHp)
      {
        const entry = this.entries.get(message.id);
        // A fresh question already sees this danger. Repeated bites must not
        // cancel every answer before it arrives and spend the budget on retries.
        if (this.simulation.time - entry.hurtNoted > 3) {
          entry.hurtNoted = this.simulation.time; this.interrupt(entry);
        }
        this.trigger(entry, message);
      }
  }

  trigger(entry, message) {
    entry.triggered = true;
    const name = id => this.simulation.players.get(id)?.name ?? id;
    const line = message.event === 'down' ? `${name(message.id)} went down`
      : message.event === 'revive' ? `${name(message.targetId)} was revived`
      : message.event === 'eliminated' ? `${name(message.id)} was eliminated`
      : message.event === 'raid' || message.event === 'raid-squad' ? 'raiders are coming'
      : message.event === 'robbed' ? `${name(message.id)} was robbed by raiders`
      : message.event === 'hit' ? 'you were hit hard' : null;
    if (line) entry.recent = [...entry.recent, line].slice(-4);
  }

  // Every simulation tick, before simulation.tick().
  step(delta) {
    const simulation = this.simulation;
    if (!this.entries.size || simulation.paused || !ACTIVE_PHASES.includes(simulation.phase)) return;
    this.maybePlan();
    for (const entry of this.entries.values()) {
      const player = simulation.players.get(entry.id);
      if (!player || player.waiting || !player.alive) continue;
      this.noteHealth(entry, player);
      let status;
      try { status = entry.body.tick(delta); }
      catch (error) { status = 'failed'; entry.body.setOrder?.(null); entry.order = null; entry.value = null; }
      if ((status === 'done' || status === 'failed') && entry.order) {
        entry.recent = [...entry.recent, `your order ${entry.value} is ${status}`].slice(-4);
        entry.order = null; entry.value = null; entry.triggered = true;
        simulation.companionOrders.delete(entry.id);
      }
      this.maybeAsk(entry);
    }
  }

  // Health lost over the last 3 s: told to the brain, and asked again early.
  noteHealth(entry, player) {
    const now = this.simulation.time, health = player.hp + (player.armor ?? 0);
    entry.health = [...entry.health.filter(sample => now - sample.at <= 3), { at: now, health }];
    const lost = Math.round(Math.max(...entry.health.map(sample => sample.health)) - health);
    if (lost >= 15 && now - entry.hurtNoted > 3 && !player.downed) {
      this.interrupt(entry);
      entry.hurtNoted = now; entry.triggered = true;
      entry.recent = [...entry.recent, `you lost ${lost} HP in the last 3 s: you are under attack, fall back`].slice(-4);
    }
  }

  // Shared planning is infrequent and independent of every companion's
  // tactical question. Neither bodies nor emergency decisions wait for it.
  maybePlan() {
    const sim = this.simulation;
    if (!this.hub.connected || !this.hub.requestPlan || !this.hub.brain?.capabilities?.includes('team-plan-v1')) return;
    const signature = planSignature(sim), wave = planningWave(sim);
    if (this.teamPlanTicket) {
      const ticket = this.teamPlanTicket;
      if (ticket.description.signature === signature && ticket.description.wave === wave) return;
      ticket.request?.cancel?.(); this.teamPlanTicket = null;
    }
    if (sim.time < this.planNextAt) return;
    if (sim.companionTeamPlan?.wave === wave && this.plannedSignature === signature) return;
    const description = describeTeamPlan(sim);
    if (!description) return;
    const ticket = { description, generation: this.generation, at: sim.time, request: null };
    this.teamPlanTicket = ticket;
    this.planNextAt = sim.time + PLAN_TIMING.retry;
    const request = this.hub.requestPlan({ room: sim.code, wave, situation: description.situation, questions: description.questions });
    ticket.request = request;
    request.then(answer => this.applyPlan(ticket, answer), () => this.applyPlan(ticket, { error: 'api' }));
  }

  applyPlan(ticket, answer) {
    if (this.teamPlanTicket !== ticket || ticket.generation !== this.generation) return 'dropped';
    this.teamPlanTicket = null;
    const sim = this.simulation;
    if (!ACTIVE_PHASES.includes(sim.phase) || sim.time - ticket.at > PLAN_TIMING.stale) return 'stale';
    if (answer?.error === 'budget' && !this.budgetWarned) {
      this.budgetWarned = true; sim.event('companions-budget', {});
    }
    const plan = normalizeTeamPlan(sim, ticket.description, answer, this.planRevision + 1);
    if (!plan) return answer?.error ?? 'invalid';
    sim.companionTeamPlan = plan;
    this.planRevision = plan.revision;
    this.plannedSignature = ticket.description.signature;
    this.planNextAt = sim.time + PLAN_TIMING.revise;
    for (const entry of this.entries.values()) entry.triggered = true;
    sim.event('companion-plan', { wave: plan.wave, revision: plan.revision, assignments: plan.assignments, tripOrder: plan.tripOrder });
    return 'applied';
  }

  maybeAsk(entry) {
    const simulation = this.simulation;
    if (!this.hub.connected || entry.ticket) return;
    const every = entry.triggered || !entry.order ? COMPANION_TIMING.trigger : simulation.phase === 'wave' ? COMPANION_TIMING.wave : COMPANION_TIMING.calm;
    if (simulation.time - Math.max(entry.lastAskAt, entry.answeredAt) < every) return; // from the later of question and answer
    let situation;
    try { situation = this.describe(simulation, entry.id, { order: entry.order, orderSince: entry.orderSince, recent: entry.recent }); }
    catch { return; }
    if (!situation?.actions?.length) return;
    // Rank = the situation's order of the actions (most urgent first).
    const ticket = { at: simulation.time, generation: this.generation, epoch: entry.epoch, wave: simulation.wave, phase: simulation.phase, orders: situation.orders, rank: new Map(situation.actions.map((action, index) => [action.value, index])) };
    entry.ticket = ticket; entry.lastAskAt = simulation.time; entry.triggered = false; entry.recent = [];
    const intent = assignmentFor(simulation, entry.id) ? teamIntent(simulation, entry.id) : '';
    ticket.request = this.hub.request({ room: simulation.code, companion: { id: entry.id, name: entry.name }, situation: situation.text, actions: situation.actions, current: entry.value,
      ...(intent ? { mode: 'tactical', teamIntent: intent, planRevision: simulation.companionTeamPlan.revision } : {}) });
    ticket.request.then(answer => this.apply(entry, ticket, answer), () => { if (entry.ticket === ticket) entry.ticket = null; });
  }

  apply(entry, ticket, answer) {
    if (entry.ticket !== ticket || this.entries.get(entry.id) !== entry || ticket.generation !== this.generation || ticket.epoch !== entry.epoch) return 'dropped';
    entry.ticket = null;
    const simulation = this.simulation;
    entry.answeredAt = simulation.time;
    if (answer?.error) {
      if (answer.error === 'budget' && !this.budgetWarned) { this.budgetWarned = true; simulation.event('companions-budget', {}); }
      return answer.error;
    }
    if (simulation.time - ticket.at > COMPANION_TIMING.stale || simulation.wave !== ticket.wave || simulation.phase !== ticket.phase) { entry.triggered = true; return 'stale'; }
    const value = answer?.action;
    if (typeof value !== 'string' || !Object.hasOwn(ticket.orders, value)) { entry.triggered = true; return 'illegal'; }
    // Still legal now? (the target may have died, the teammate got up)
    let now = null;
    try { now = this.describe(simulation, entry.id, { order: entry.order, orderSince: entry.orderSince, recent: [] }); } catch {}
    if (!now || !Object.hasOwn(now.orders, value)) { entry.triggered = true; return 'gone'; }
    if (value === 'keep') return 'keep';
    const order = now.orders[value];
    const before = entry.order;
    // A hesitant switch to another target of the same kind is ignored, unless
    // the new one is more urgent (listed earlier) or the current one is gone.
    const rank = new Map(now.actions.map((action, index) => [action.value, index]));
    if (before && order && before.kind === order.kind && !URGENT_KINDS.includes(order.kind)
      && Number.isFinite(answer.confidence) && answer.confidence < SWITCH_CONFIDENCE
      && rank.has(entry.value) && (rank.get(value) ?? Infinity) > rank.get(entry.value)) return 'hesitant';
    entry.body.setOrder(order);
    entry.order = order; entry.value = value; entry.orderSince = simulation.time;
    simulation.companionOrders.set(entry.id, order);
    this.callout(entry, before, order);
    return 'applied';
  }

  // A fixed line for the children when the plan really changes (no model text).
  callout(entry, before, order) {
    if (!CALLOUT_KINDS.includes(order?.kind)) return;
    if (before?.kind === order.kind && orderTarget(before) === orderTarget(order)) return;
    const simulation = this.simulation;
    if (simulation.time - entry.lastCalloutAt < COMPANION_TIMING.callout) return;
    entry.lastCalloutAt = simulation.time;
    const target = orderTarget(order);
    simulation.event('companion-callout', { id: entry.id, order: order.kind, ...(target ? { target } : {}) });
  }
}
