import WebSocket from 'ws';
import { buildInput, buildPlanInput } from './guide.mjs';
import { askDecision, askTeamPlan, decisionBody, planReservationTokens, reservationTokens, MODEL, TIMEOUT_MS, PLAN_TIMEOUT_MS } from './openai.mjs';
import { companionsDir, costOf, createBudget, createDecisionLog } from './budget.mjs';
import { LEVEL_ID } from '../public/level-id.js';

// The brain service of companions/DESIGN.md: it connects to the LAN game on
// ws://127.0.0.1:PORT/companions and answers each "decide" with one action.
export const BRAIN_NAME = 'openai-decisions';
export const BRAIN_VERSION = 2;
// map-guide-v1: each request is answered with the guide of the map it names.
export const BRAIN_CAPABILITIES = ['team-plan-v1', 'map-guide-v1'];
export const RECONNECT_MS = 3000;
export const WELCOME_MS = 2500;
export const MAX_ACTIONS = 24;
export const MAX_SITUATION = 6000;
export const MAX_PLAN_SITUATION = 16000;
export const MAX_PLAN_QUESTIONS = 20;
// The game hands the seat to a newer brain by closing the old one normally
// (1000, companions/hub.mjs) or with 4001. A welcomed brain closed with
// either stops instead of taking the seat back every few seconds; any other
// end (1001 going away, 1006 lost) is a game that left, so it tries again.
export const REPLACED_CODE = 4001;
export const REPLACED_CODES = [1000, REPLACED_CODE];
// Without PORT the brain looks for the game on 3002 (the port used while
// another application holds 3000) and on 3000 (play.cmd and npm start).
export const DEFAULT_PORTS = [3002, 3000];
// The maps of the LAN menu, each with its own guide (guide.mjs) and its name
// in the game. A request without a known map is played on this process's own.
export const MAP_IDS = ['cabin', 'supermarket', 'hospital', 'funfair'];
export const MAP_LABELS = { cabin: 'La cabane', supermarket: 'Le Dernier Panier', hospital: "L'Hôpital des Pins", funfair: 'La Fête Foraine' };
const mapOf = message => MAP_IDS.includes(message?.mapId) ? message.mapId : LEVEL_ID;

const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
export function cleanActions(actions) {
  const seen = new Set(), clean = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const value = text(action?.value, 80);
    if (!value || seen.has(value)) continue;
    seen.add(value); clean.push({ value, description: text(action.description, 240) || value });
    if (clean.length === MAX_ACTIONS) break;
  }
  return clean;
}

// Unlike a single tactical menu, a shared plan is atomic: silently removing a
// malformed question could leave one teammate with no assignment.
export function cleanPlanQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.length > MAX_PLAN_QUESTIONS) return null;
  const seen = new Set(), clean = [];
  for (const question of questions) {
    const name = question?.name;
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) || seen.has(name)) return null;
    if (typeof question.instructions !== 'string' || question.instructions.length > 1000) return null;
    if (!Array.isArray(question.choices) || !question.choices.length || question.choices.length > MAX_ACTIONS) return null;
    const values = new Set(), choices = [];
    for (const choice of question.choices) {
      if (typeof choice?.value !== 'string' || !choice.value || choice.value.length > 80 || values.has(choice.value)) return null;
      values.add(choice.value);
      choices.push({ value: choice.value, description: text(choice.description, 240) || choice.value });
    }
    seen.add(name); clean.push({ name, instructions: question.instructions, choices });
  }
  return clean;
}

// decide(message) always resolves the protocol's decision message:
// { type, id, action, confidence, latencyMs, inputTokens } or { type, id, error }.
export function createBrain({ key = '', fetch = globalThis.fetch, dir = companionsDir(), sessionBudget = 2, dailyBudget = 5,
  dry = false, timeoutMs = TIMEOUT_MS, planTimeoutMs = timeoutMs === TIMEOUT_MS ? PLAN_TIMEOUT_MS : timeoutMs,
  clock = () => new Date(), report = () => {} } = {}) {
  const budget = createBudget({ dir, sessionBudget, dailyBudget, clock });
  const log = createDecisionLog({ dir, clock });
  const requests = new Map();
  let reservedTokens = 0;
  function record(inputTokens, calls = 1) {
    if (!calls) return 0;
    const cost = budget.record(inputTokens);
    // Two dependent plan calls share one log entry but remain two requests in
    // the usage ledger. All spending is settled before the reservation clears.
    for (let index = 1; index < calls; index += 1) budget.record(0);
    return cost;
  }
  function admit(reservation) {
    const spent = budget.exhausted();
    if (spent) return spent;
    if (costOf(budget.session.inputTokens + reservedTokens + reservation) > sessionBudget) return 'session';
    if (costOf(budget.today.inputTokens + reservedTokens + reservation) > dailyBudget) return 'daily';
    return null;
  }
  async function exchange(id, options, operation, finish, success, reservation) {
    if (requests.has(id)) return finish({ error: 'api', detail: 'duplicate request' });
    if (options?.signal?.aborted) return finish({ error: 'cancelled' });
    const spent = admit(reservation);
    if (spent) return finish({ error: 'budget', detail: spent });
    const controller = new AbortController();
    const abort = () => controller.abort();
    options?.signal?.addEventListener('abort', abort, { once: true });
    requests.set(id, controller); reservedTokens += reservation;
    try {
      const result = await operation(controller.signal);
      return finish({ ...success(result), confidence: result.confidence, latencyMs: result.latencyMs,
        calls: result.calls ?? 1, inputTokens: result.inputTokens, costUsd: record(result.inputTokens, result.calls), ...(result.estimated ? { estimated: true } : {}) });
    } catch (error) {
      const kind = ['timeout', 'refusal', 'api', 'cancelled'].includes(error?.kind) ? error.kind : 'api';
      const inputTokens = Math.max(0, Number(error?.inputTokens) || 0);
      return finish({ error: kind, detail: text(error?.detail, 60) || kind, calls: error?.calls ?? 1,
        latencyMs: error?.latencyMs ?? 0, inputTokens, costUsd: record(inputTokens, error?.calls),
        ...(error?.estimated ? { estimated: true } : {}) });
    } finally {
      requests.delete(id); reservedTokens -= reservation;
      options?.signal?.removeEventListener('abort', abort);
    }
  }
  async function decide(message, options = {}) {
    const id = typeof message?.id === 'string' ? message.id : '';
    const companion = { id: text(message?.companion?.id, 80), name: text(message?.companion?.name, 40) };
    const current = text(message?.current, 80) || null;
    const choices = cleanActions(message?.actions);
    const map = mapOf(message);
    const entry = { kind: 'tactical', time: clock().toISOString(), map, room: text(message?.room, 16), companion: companion.name, companionId: companion.id,
      current, choices: choices.length, latencyMs: 0, inputTokens: 0, costUsd: 0, action: null, confidence: null, error: null };
    const finish = (extra = {}) => {
      Object.assign(entry, extra); log.write(entry); report(entry);
      return entry.error ? { type: 'decision', id, error: entry.error }
        : { type: 'decision', id, action: entry.action, confidence: entry.confidence, latencyMs: entry.latencyMs, inputTokens: entry.inputTokens };
    };
    if (!choices.length) return finish({ error: 'api', detail: 'no actions' });
    // --dry, or a single legal action: there is nothing to ask the model.
    if (dry) return finish({ action: choices[0].value, confidence: 1, dry: true });
    if (choices.length === 1) return finish({ action: choices[0].value, confidence: 1, single: true });
    const input = buildInput({ situation: text(message?.situation, MAX_SITUATION), companion, current,
      mode: message?.mode, teamIntent: text(message?.teamIntent, 900), mapId: map });
    return exchange(id, options, signal => askDecision({ fetch, key, input, choices, timeoutMs, signal }), finish,
      result => ({ action: result.action }), reservationTokens(decisionBody(input, choices)));
  }
  async function plan(message, options = {}) {
    const id = typeof message?.id === 'string' ? message.id : '';
    const questions = cleanPlanQuestions(message?.questions);
    // Only known counters enter the plan log: no model text, request prompt,
    // question instructions or selected values are written to disk.
    const entry = { kind: 'plan', time: clock().toISOString(), map: mapOf(message), room: text(message?.room, 16),
      wave: Number.isInteger(message?.wave) ? Math.max(0, Math.min(1000, message.wave)) : null,
      questions: questions?.length ?? 0, choices: questions?.reduce((sum, question) => sum + question.choices.length, 0) ?? 0,
      calls: 0, latencyMs: 0, inputTokens: 0, costUsd: 0, confidence: null, error: null };
    let selected = null;
    const finish = (extra = {}) => {
      if (extra.selected) { selected = extra.selected; delete extra.selected; }
      Object.assign(entry, extra); log.write(entry); report(entry);
      return entry.error ? { type: 'team-plan', id, error: entry.error }
        : { type: 'team-plan', id, choices: selected, confidence: entry.confidence, latencyMs: entry.latencyMs, inputTokens: entry.inputTokens };
    };
    if (!questions) return finish({ error: 'api', detail: 'invalid questions' });
    if (dry || questions.every(question => question.choices.length === 1))
      return finish({ selected: Object.fromEntries(questions.map(question => [question.name, question.choices[0].value])),
        confidence: 1, ...(dry ? { dry: true } : { single: true }) });
    const input = buildPlanInput({ situation: text(message?.situation, MAX_PLAN_SITUATION) });
    return exchange(id, options, signal => askTeamPlan({ fetch, key, input, questions, timeoutMs: planTimeoutMs, signal }), finish,
      result => ({ selected: result.choices }), planReservationTokens(input, questions));
  }
  return { decide, plan, budget, cancel(id) { const pending = requests.get(id); pending?.abort(); return Boolean(pending); },
    get pendingRequests() { return requests.size; }, get reservedTokens() { return reservedTokens; } };
}

// Keeps one connection to the game. The urls are tried in turn, the one that
// last welcomed the brain first, then again every reconnectMs. A socket that
// does not welcome the brain within welcomeMs is something else: next url.
// onStatus(state, detail, welcome): 'open' | 'welcome' | 'closed' | 'replaced' | 'invalid'.
// scope prefixes the ids the brain sees, so links sharing one brain never
// mistake each other's requests for duplicates or cancel each other's.
// A request without a mapId is played on the map its welcome named.
export function connectBrain({ url, urls = [url], brain, scope = '', reconnectMs = RECONNECT_MS, welcomeMs = WELCOME_MS, onStatus = () => {} }) {
  let socket = null, timer = null, stopped = false, welcomed = false, home = 0, tried = 0;
  const pending = new Map();
  const cancel = id => { pending.get(id)?.controller.abort(); brain.cancel?.(scope + id); };
  const cancelSocket = target => { for (const [id, request] of pending) if (request.target === target) cancel(id); };
  const send = (target, message) => { if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify(message)); };
  function later(delay) {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; open(); }, delay);
  }
  async function answer(target, message, welcome) {
    if (message?.type === 'cancel' && typeof message.id === 'string') { cancel(message.id); return; }
    if (!['decide', 'plan'].includes(message?.type) || typeof message.id !== 'string' || pending.has(message.id)) return;
    const type = message.type === 'plan' ? 'team-plan' : 'decision';
    const controller = new AbortController();
    pending.set(message.id, { controller, target });
    let decision;
    try {
      const method = message.type === 'plan' ? brain.plan : brain.decide;
      decision = await method.call(brain, { ...message, id: scope + message.id, mapId: message.mapId ?? welcome?.mapId }, { signal: controller.signal });
    } catch { decision = { type, id: message.id, error: 'api' }; }
    finally { pending.delete(message.id); }
    if (!controller.signal.aborted && socket === target && !stopped) send(target, { ...decision, id: message.id });
  }
  function open() {
    if (stopped) return;
    const index = (home + tried) % urls.length, address = urls[index];
    let target;
    // A malformed address never becomes valid: say so and stop.
    try { target = new WebSocket(address, { maxPayload: 64 * 1024, perMessageDeflate: false, handshakeTimeout: 5000 }); }
    catch (error) { stopped = true; onStatus('invalid', `${address} (${error?.message ?? error})`); return; }
    let greeted = false, waiting = null, welcome = null;
    socket = target; welcomed = false;
    target.on('open', () => {
      send(target, { type: 'brain-hello', name: BRAIN_NAME, version: BRAIN_VERSION, capabilities: BRAIN_CAPABILITIES }); onStatus('open', address);
      waiting = setTimeout(() => target.terminate(), welcomeMs);
    });
    target.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message?.type === 'brain-welcome') {
        if (greeted) return;
        greeted = true; welcome = message; clearTimeout(waiting); home = index; tried = 0;
        if (socket === target) welcomed = true;
        onStatus('welcome', address, message); return;
      }
      if (greeted) answer(target, message, welcome);
    });
    target.on('error', () => {});
    target.on('close', (code, reason) => {
      clearTimeout(waiting);
      cancelSocket(target);
      if (socket === target) { socket = null; welcomed = false; }
      if (stopped) return;
      if (greeted && REPLACED_CODES.includes(code)) { stopped = true; onStatus('replaced', String(reason ?? '')); return; }
      onStatus('closed', code);
      if (!greeted && tried + 1 < urls.length) { tried += 1; later(0); return; }
      tried = 0; later(reconnectMs);
    });
  }
  open();
  return {
    get connected() { return Boolean(socket && socket.readyState === WebSocket.OPEN && welcomed); },
    close() { stopped = true; clearTimeout(timer); timer = null; if (socket) cancelSocket(socket); socket?.close(); },
  };
}

// The other maps a welcome lists (lan-gateway.mjs): each map's /companions
// under its root, on the welcomed address's own origin, so still this PC.
const MAP_ROOT = /^\/(?:maps\/[a-z][a-z0-9-]*\/)?$/;
export function siblingServers(address, maps) {
  if (!Array.isArray(maps)) return [];
  let origin;
  try { origin = new URL(address).origin; } catch { return []; }
  const found = [];
  for (const map of maps) {
    if (!MAP_IDS.includes(map?.id) || typeof map.root !== 'string' || !MAP_ROOT.test(map.root)) continue;
    try { found.push({ id: map.id, url: checkServer(new URL(`${map.root.slice(1)}companions`, `${origin}/`).href) }); } catch {}
  }
  return found;
}

// One brain for the whole game: the first link is the game's address (urls,
// scope L0:); a welcome that lists maps opens one link per other map (L1:,
// L2:...). The same brain answers every link: one session and daily budget,
// one token reservation. 'replaced' or 'invalid' stops only that link; when
// every link has stopped, onStatus('stopped').
// onStatus(state, detail, { address, mapId, welcomed }): welcomed counts the
// links welcomed right now.
const addressKey = address => { try { return new URL(address).href; } catch { return address; } };
export function connectGame({ urls, brain, reconnectMs = RECONNECT_MS, welcomeMs = WELCOME_MS, onStatus = () => {} }) {
  const entries = [], keys = new Set();
  let closed = false;
  const welcomedLinks = () => entries.filter(entry => entry.welcomed).length;
  function add(addresses) {
    const entry = { address: addresses[0], mapId: null, welcomed: false, stopped: false, link: null };
    const scope = `L${entries.length}:`;
    entries.push(entry);
    const status = (state, detail) => onStatus(state, detail, { address: entry.address, mapId: entry.mapId, welcomed: welcomedLinks() });
    entry.link = connectBrain({ urls: addresses, brain, scope, reconnectMs, welcomeMs, onStatus(state, detail, welcome) {
      if (closed) return;
      if (state === 'welcome') {
        Object.assign(entry, { address: detail, mapId: MAP_IDS.includes(welcome?.mapId) ? welcome.mapId : null, welcomed: true });
        keys.add(addressKey(detail));
        status(state, detail);
        for (const sibling of siblingServers(detail, welcome?.maps)) {
          const key = addressKey(sibling.url);
          if (!keys.has(key)) { keys.add(key); add([sibling.url]); }
        }
        return;
      }
      if (state !== 'open') entry.welcomed = false;
      if (state === 'replaced' || state === 'invalid') entry.stopped = true;
      status(state, detail);
      if (entry.stopped && entries.every(item => item.stopped)) status('stopped', '');
    } });
  }
  add(urls);
  return {
    get connected() { return entries.some(entry => entry.link?.connected); },
    get size() { return entries.length; },
    close() { closed = true; for (const entry of entries) entry.link?.close(); },
  };
}

const gameUrl = port => `ws://127.0.0.1:${port}/companions`;
// PORT as the game reads it (cmd's "set PORT=3002 && ..." leaves a space).
export function defaultServers(env = process.env) {
  const raw = String(env.PORT ?? '').trim();
  if (!raw) return DEFAULT_PORTS.map(gameUrl);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT doit être le port du jeu, par exemple 3002 (reçu : « ${env.PORT} »).`);
  return [gameUrl(port)];
}

// The brain only ever answers the game on this PC (the key pays for it).
const LOOPBACK = /^(127(\.\d{1,3}){3}|localhost|\[::1\])$/;
export function checkServer(address) {
  let parsed = null;
  try { parsed = new URL(address); } catch {}
  if (!parsed || !['ws:', 'wss:'].includes(parsed.protocol) || parsed.hash)
    throw new Error(`--server attend une adresse ws:// valide, par exemple ${gameUrl(3002)} (reçu : « ${address} »).`);
  if (!LOOPBACK.test(parsed.hostname))
    throw new Error(`--server doit rester sur cet ordinateur (127.0.0.1, localhost ou [::1]) : le cerveau ne répond qu’au jeu lancé sur ce PC.`);
  return address;
}

const USAGE = 'node companion-brain/brain.mjs [--server ws://127.0.0.1:3002/companions] [--session-budget 2] [--daily-budget 5] [--dry] [--quiet]';
export function parseArgs(argv, env = process.env) {
  const options = { servers: null, sessionBudget: 2, dailyBudget: 5, dry: false, quiet: false, help: false };
  const args = [...argv];
  while (args.length) {
    const [flag, inline] = args.shift().split(/=(.*)/s);
    const value = () => {
      const next = inline ?? args.shift();
      if (next === undefined) throw new Error(`${flag} attend une valeur. Usage : ${USAGE}`);
      return next;
    };
    const money = () => {
      const amount = Number(value());
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`${flag} attend un montant en dollars, par exemple 2.`);
      return amount;
    };
    if (flag === '--server') options.servers = [checkServer(value())];
    else if (flag === '--session-budget') options.sessionBudget = money();
    else if (flag === '--daily-budget') options.dailyBudget = money();
    else if (flag === '--dry') options.dry = true;
    else if (flag === '--quiet') options.quiet = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Option inconnue : ${flag}. Usage : ${USAGE}`);
  }
  options.servers ??= options.help ? [] : defaultServers(env);
  return options;
}

const dollars = amount => `${amount.toFixed(amount < 1 ? 4 : 2).replace('.', ',')} $`;
function describe(entry) {
  const who = `[${entry.room || '?'}] ${entry.kind === 'plan' ? `plan d’équipe (vague ${entry.wave ?? '?'})` : entry.companion || entry.companionId || '?'}`;
  if (entry.error) return `  ${who} : erreur ${entry.error}${entry.detail && entry.detail !== entry.error ? ` (${entry.detail})` : ''}`;
  const confidence = entry.confidence === null ? '' : `  ${Math.round(entry.confidence * 100)} %`;
  const cost = entry.dry ? '  (essai)' : entry.single ? '  (seul choix)'
    : `  ${entry.latencyMs} ms  ${entry.estimated ? '~' : ''}${entry.inputTokens} jetons`;
  return `  ${who} -> ${entry.kind === 'plan' ? `${entry.questions} choix coordonnés` : entry.action}${confidence}${cost}`;
}

// The command line: resolves an exit code when it cannot start, otherwise runs
// until Ctrl+C or until another brain takes the seat. OPENAI_API_KEY is only
// ever read here and passed to the brain.
export function main(argv = process.argv.slice(2), { env = process.env, out = console } = {}) {
  let options;
  try { options = parseArgs(argv, env); } catch (error) { out.error(error.message); return 2; }
  if (options.help) { out.log(`Usage : ${USAGE}`); return 0; }
  const key = String(env.OPENAI_API_KEY ?? '').trim();
  if (!key && !options.dry) {
    out.error('OPENAI_API_KEY est introuvable : les compagnons IA ont besoin de ta clé OpenAI.');
    out.error('Définis la variable d’environnement OPENAI_API_KEY puis relance, ou lance avec --dry pour un essai sans API.');
    return 1;
  }
  const dir = companionsDir(env);
  let lastBudgetNotice = null, estimateNotice = false;
  const brain = createBrain({ key, dir, sessionBudget: options.sessionBudget, dailyBudget: options.dailyBudget, dry: options.dry,
    report: entry => {
      if (entry.error === 'budget') {
        if (lastBudgetNotice !== entry.detail) out.log(entry.detail === 'session'
          ? `  Budget de la session atteint (${dollars(options.sessionBudget)}) : les compagnons ne décident plus.`
          : `  Budget du jour atteint (${dollars(options.dailyBudget)}) : les compagnons ne décident plus jusqu’à demain.`);
        lastBudgetNotice = entry.detail; return;
      }
      if (entry.estimated && entry.error !== 'timeout' && !estimateNotice) {
        estimateNotice = true;
        out.log('  L’API n’indique pas les jetons utilisés : ils sont estimés (environ 4 caractères par jeton) et comptent dans le budget.');
      }
      if (!options.quiet) out.log(describe(entry));
    } });
  out.log(`\n  DEADWOOD — Compagnons IA (${options.dry ? 'essai sans API' : `OpenAI Decisions, ${MODEL}`})`);
  out.log(`  Jeu : ${options.servers.join(' ou ')}`);
  if (!options.dry) out.log(`  Budget : ${dollars(options.sessionBudget)} par session, ${dollars(options.dailyBudget)} par jour (aujourd’hui : ${dollars(brain.budget.today.costUsd)} dépensés)`);
  out.log(`  Journal : ${dir}\n`);
  let game = null, lost = false, replaced = false;
  const summary = () => {
    const { requests, inputTokens } = brain.budget.session;
    out.log(`\n  Session : ${requests} requêtes, ${inputTokens} jetons, ${dollars(costOf(inputTokens))}.`);
  };
  const stop = () => { game?.close(); summary(); process.exit(0); };
  const release = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // One line per welcome (one per map behind the LAN menu); the lost-game line
  // once, when no link is welcomed any more (or none yet).
  game = connectGame({ urls: options.servers, brain, onStatus(next, detail, { mapId, welcomed }) {
    if (next === 'welcome') {
      lost = false;
      out.log(`  Connecté au jeu (${detail}) : décor ${MAP_LABELS[mapId ?? LEVEL_ID]}, les compagnons peuvent rejoindre la partie.`);
    } else if (next === 'replaced') replaced = true;
    else if (next === 'invalid') { out.error(`  Adresse du jeu invalide : ${detail}`); process.exitCode = 2; }
    else if (next === 'closed' && !welcomed && !lost) {
      lost = true; out.log(`  Jeu introuvable ou déconnecté : nouvel essai toutes les ${RECONNECT_MS / 1000} s.`);
    } else if (next === 'stopped') {
      release();
      if (replaced) { out.log('  Un autre cerveau a pris la place : celui-ci s’arrête.'); summary(); }
    }
  } });
  return null;
}
