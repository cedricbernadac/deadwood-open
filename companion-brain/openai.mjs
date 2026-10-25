import { QUESTION_INSTRUCTIONS } from './guide.mjs';

// The only code that talks to OpenAI: one request for tactics; two dependent
// requests for production team plans (roles, then conditional parameters).
export const DECISIONS_URL = 'https://api.openai.com/v1/decisions';
export const MODEL = 'gpt-6-luna';
export const TIMEOUT_MS = 4500; // the owner: an answer a little over a second late is fine; give slow moments room
export const PLAN_TIMEOUT_MS = 9000; // two dependent calls, with one overall deadline

// kind is one of the protocol errors: 'timeout' | 'refusal' | 'api' | 'cancelled'.
// inputTokens is what the request may have cost even though it failed.
export class DecisionError extends Error {
  constructor(kind, detail = '', inputTokens = 0, estimated = false) {
    super(detail || kind); this.kind = kind; this.detail = detail; this.inputTokens = inputTokens; this.estimated = estimated; this.calls = 0;
  }
}

// About 4 characters per token over everything a request sends. It stands in
// for usage.input_tokens when the API leaves it out, so the budget never
// counts a billed request as free.
export function estimateTokens(input, choices) {
  return Math.ceil((input.length + QUESTION_INSTRUCTIONS.length + JSON.stringify(choices).length) / 4);
}

export function decisionBody(input, choices) {
  return { model: MODEL, input, questions: [{ type: 'choice', name: 'action', instructions: QUESTION_INSTRUCTIONS, choices }] };
}

export function planBody(input, questions) {
  // Decisions requires at least two choices. Fixed answers are retained
  // locally, never sent as a one-choice API question.
  return { model: MODEL, input, questions: questions.filter(question => question.choices.length > 1).map(question => ({ type: 'choice', ...question })) };
}

export function estimatePlanTokens(input, questions) {
  return Math.ceil((input.length + JSON.stringify(questions.filter(question => question.choices.length > 1)).length) / 4);
}

// Reserve a deliberately conservative ceiling while a request is in flight:
// a tokenizer cannot emit more tokens than UTF-8 bytes, plus envelope overhead.
// Settlement uses reported usage (or the ordinary four-character estimate).
export function reservationTokens(body) {
  return Buffer.byteLength(JSON.stringify(body), 'utf8') + 256;
}

const ROLES = ['support', 'close', 'marksman', 'medic'];
function roleAllocations(questions) {
  const roleQuestions = questions.filter(question => /^bot\d+_role$/.test(question.name));
  if (!roleQuestions.length) return null;
  const allocations = [];
  function extend(index, chosen, used) {
    if (index === roleQuestions.length) { allocations.push({ ...chosen }); return; }
    const question = roleQuestions[index];
    for (const role of ROLES) if (!used.has(role) && question.choices.some(choice => choice.value === role)) {
      chosen[question.name] = role; used.add(role); extend(index + 1, chosen, used); used.delete(role);
    }
  }
  if (roleQuestions.length <= 3) extend(0, {}, new Set());
  const question = { name: 'roleAllocation', instructions: 'Choose one coherent allocation for the whole team. Distinct roles complement each other; adapt to inventories, humans, prior plans and upcoming waves. Different roles may still use the same weapon, including two flamethrowers. The other questions will be decided after these roles are known.',
    choices: allocations.map((allocation, index) => ({ value: `allocation${index}`, description: roleQuestions.map(item => {
      const label = item.instructions.includes(':') ? item.instructions.split(':')[0].slice(0, 40) : item.name;
      return `${item.name} (${label}): ${allocation[item.name]}`;
    }).join('; ') })) };
  return { question, allocations };
}

function conditionedPlan(input, questions, roles) {
  const allocation = Object.entries(roles).map(([name, role]) => `${name}=${role}`).join('; ');
  return { input: `CONFIRMED TEAM ROLE ALLOCATION\n${allocation}\nThese roles are already decided. All remaining choices must fit this allocation. Each equipment, bonus or location choice is independently evaluated from this known team context. Different companions may choose the same weapon.\n\n${input}`,
    questions: questions.map(question => Object.hasOwn(roles, question.name)
      ? { ...question, choices: question.choices.filter(choice => choice.value === roles[question.name]) } : question) };
}

// Reserve both phases before either starts. Phase two's envelope can differ
// slightly with role names, so reserve its largest legal variant.
export function planReservationTokens(input, questions) {
  const roles = roleAllocations(questions);
  const reserve = (value, menu) => { const body = planBody(value, menu); return body.questions.length ? reservationTokens(body) : 0; };
  if (!roles) return reserve(input, questions);
  const second = roles.allocations.map(allocation => {
    const plan = conditionedPlan(input, questions, allocation);
    return reserve(plan.input, plan.questions);
  });
  return reserve(input, [roles.question]) + Math.max(0, ...second);
}

function readAnswers(body, questions, estimate) {
  // Missing or zero usage: count the estimate, never a free request.
  const reported = Number(body?.usage?.input_tokens), estimated = !(Number.isFinite(reported) && reported > 0);
  const inputTokens = estimated ? estimate : Math.round(reported);
  const answers = Array.isArray(body?.answers) ? body.answers : [];
  if (answers.some(answer => answer?.type === 'refusal')) throw new DecisionError('refusal', 'refusal', inputTokens, estimated);
  const allowed = new Map(questions.map(question => [question.name, new Set(question.choices.map(choice => choice.value))]));
  const choices = {}, seen = new Set(), confidenceValues = [];
  // Atomic parsing: a partial plan must never mix with a previous assignment.
  if (answers.length !== questions.length) throw new DecisionError('api', 'answer count', inputTokens, estimated);
  for (const answer of answers) {
    if (answer?.type !== 'choice' || seen.has(answer.name) || !allowed.get(answer.name)?.has(answer.choice))
      throw new DecisionError('api', 'unexpected answer', inputTokens, estimated);
    seen.add(answer.name); choices[answer.name] = answer.choice;
    let confidence = answer.confidence == null ? NaN : Number(answer.confidence);
    if (!Number.isFinite(confidence)) confidence = Number(answer.probabilities?.find?.(item => item?.value === answer.choice)?.probability);
    if (Number.isFinite(confidence)) confidenceValues.push(Math.min(1, Math.max(0, confidence)));
  }
  return { choices, confidence: confidenceValues.length === questions.length ? Math.round(Math.min(...confidenceValues) * 1000) / 1000 : null,
    inputTokens, ...(estimated ? { estimated } : {}) };
}

// One exchange for all questions. Timeouts and connection handovers also cover
// a fetch that ignores AbortSignal; no stale answer reaches another socket.
async function askQuestions({ fetch, key, body, estimate, signal, timeoutMs = TIMEOUT_MS, now = () => performance.now() }) {
  if (signal?.aborted) throw new DecisionError('cancelled', 'cancelled');
  const controller = new AbortController();
  const started = now();
  let timer, cancel, sent = false;
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new DecisionError('timeout', 'timeout', estimate, true)); }, timeoutMs);
  });
  const cancelled = new Promise((resolve, reject) => {
    cancel = () => { controller.abort(); reject(new DecisionError('cancelled', 'cancelled', estimate, true)); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  const exchange = (async () => {
    let response;
    try {
      sent = true;
      response = await fetch(DECISIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // A lost transport can follow a billed request. Count the estimate rather
      // than let repeated network failures silently reopen the spending cap.
      throw new DecisionError('api', error?.name === 'AbortError' ? 'aborted' : 'network', estimate, true);
    }
    // The error body is never read: it may echo part of the key.
    if (!response?.ok) throw new DecisionError('api', `http ${response?.status ?? '?'}`);
    let answerBody;
    // A 200 answer was billed even when it cannot be read.
    try { answerBody = await response.json(); } catch { throw new DecisionError('api', 'bad json', estimate, true); }
    return readAnswers(answerBody, body.questions, estimate);
  })();
  try {
    const result = await Promise.race([exchange, expired, cancelled]);
    return { ...result, calls: 1, latencyMs: Math.round(now() - started) };
  } catch (error) {
    error.calls = sent ? 1 : 0; error.latencyMs = Math.round(now() - started); throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

// Resolves { action, confidence, inputTokens, estimated?, latencyMs }.
export async function askDecision(options) {
  const result = await askQuestions({ ...options, body: decisionBody(options.input, options.choices),
    estimate: estimateTokens(options.input, options.choices) });
  const { choices, ...metadata } = result;
  return { ...metadata, action: choices.action };
}

async function askPlanQuestions(options) {
  if (options.signal?.aborted) throw new DecisionError('cancelled', 'cancelled');
  const body = planBody(options.input, options.questions);
  const fixed = Object.fromEntries(options.questions.filter(question => question.choices.length === 1)
    .map(question => [question.name, question.choices[0].value]));
  if (!body.questions.length) return { choices: fixed, confidence: 1, inputTokens: 0, calls: 0, latencyMs: 0 };
  const result = await askQuestions({ ...options, body, estimate: estimatePlanTokens(options.input, options.questions) });
  return { ...result, choices: { ...fixed, ...result.choices } };
}

// Decisions evaluates questions independently. A coherent division of roles
// therefore needs one allocation question first, then conditional parameters:
// https://developers.openai.com/api/docs/guides/decisions#ask-multiple-questions
// Generic independent menus still use a single call.
export async function askTeamPlan(options) {
  const { input, questions, timeoutMs = PLAN_TIMEOUT_MS, now = () => performance.now() } = options;
  const roles = roleAllocations(questions);
  if (!roles) return askPlanQuestions({ ...options, timeoutMs });
  if (!roles.allocations.length) throw new DecisionError('api', 'invalid role allocation');
  const started = now();
  let first = null;
  try {
    first = await askPlanQuestions({ ...options, now, timeoutMs, input, questions: [roles.question] });
    const index = roles.question.choices.findIndex(choice => choice.value === first.choices.roleAllocation);
    const conditioned = conditionedPlan(input, questions, roles.allocations[index]);
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) throw new DecisionError('timeout', 'timeout');
    const second = await askPlanQuestions({ ...options, now, timeoutMs: remaining, input: conditioned.input, questions: conditioned.questions });
    return { ...second, inputTokens: first.inputTokens + second.inputTokens, calls: first.calls + second.calls,
      confidence: first.confidence == null || second.confidence == null ? null : Math.min(first.confidence, second.confidence),
      latencyMs: Math.round(now() - started), ...(first.estimated || second.estimated ? { estimated: true } : {}) };
  } catch (error) {
    if (first) {
      error.inputTokens = first.inputTokens + (error.inputTokens || 0); error.calls = first.calls + (error.calls || 0);
      error.estimated = first.estimated || error.estimated;
    }
    error.latencyMs = Math.round(now() - started); throw error;
  }
}
