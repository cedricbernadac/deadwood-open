import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// gpt-6-luna on the Decisions API: input tokens only, output is not billed.
export const PRICE_PER_MILLION = .10;
export const KEEP_DAYS = 90;
export const costOf = tokens => Number((tokens * PRICE_PER_MILLION / 1e6).toFixed(10));

// %LOCALAPPDATA%/deadwood-companions; DEADWOOD_COMPANIONS_DIR overrides it (tests).
export function companionsDir(env = process.env) {
  if (env.DEADWOOD_COMPANIONS_DIR) return env.DEADWOOD_COMPANIONS_DIR;
  return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'deadwood-companions');
}

// The owner's local calendar day, YYYY-MM-DD.
export function dayOf(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const emptyUsage = () => ({ version: 1, days: {}, total: { requests: 0, inputTokens: 0, costUsd: 0 } });
function readUsage(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data.days !== 'object' || Array.isArray(data.days)) return emptyUsage();
    return { ...emptyUsage(), ...data, total: { ...emptyUsage().total, ...data.total } };
  } catch { return emptyUsage(); }
}
function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  try { renameSync(temporary, file); } catch { writeFileSync(file, text); }
}

// Session spending lives in memory; daily spending is persisted in usage.json
// and re-read before each write so two brain runs on one day add up.
export function createBudget({ dir, sessionBudget = 2, dailyBudget = 5, clock = () => new Date() }) {
  const file = join(dir, 'usage.json');
  const session = { requests: 0, inputTokens: 0 };
  let usage = readUsage(file);
  const dayUsage = () => usage.days[dayOf(clock())] ?? { requests: 0, inputTokens: 0, costUsd: 0 };
  return {
    file,
    get session() { return { ...session, costUsd: costOf(session.inputTokens) }; },
    get today() { const day = dayUsage(); return { requests: day.requests || 0, inputTokens: day.inputTokens || 0, costUsd: costOf(day.inputTokens || 0) }; },
    // 'session' | 'daily' when a budget is spent, otherwise null.
    exhausted() {
      if (costOf(session.inputTokens) >= sessionBudget) return 'session';
      if (costOf(dayUsage().inputTokens || 0) >= dailyBudget) return 'daily';
      return null;
    },
    record(inputTokens) {
      const tokens = Math.max(0, Math.round(Number(inputTokens) || 0));
      session.requests += 1; session.inputTokens += tokens;
      usage = readUsage(file);
      const key = dayOf(clock());
      const day = usage.days[key] ??= { requests: 0, inputTokens: 0, costUsd: 0 };
      day.requests = (day.requests || 0) + 1; day.inputTokens = (day.inputTokens || 0) + tokens; day.costUsd = costOf(day.inputTokens);
      usage.total.requests = (usage.total.requests || 0) + 1; usage.total.inputTokens = (usage.total.inputTokens || 0) + tokens; usage.total.costUsd = costOf(usage.total.inputTokens);
      for (const old of Object.keys(usage.days).sort().slice(0, -KEEP_DAYS)) delete usage.days[old];
      try { mkdirSync(dir, { recursive: true }); writeAtomic(file, `${JSON.stringify(usage, null, 2)}\n`); } catch {}
      return costOf(tokens);
    },
  };
}

// One JSON line per decision in decisions-YYYY-MM-DD.jsonl. Entries are built
// from known fields only; the key is never one of them.
export function createDecisionLog({ dir, clock = () => new Date() }) {
  return {
    write(entry) {
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `decisions-${dayOf(clock())}.jsonl`), `${JSON.stringify(entry)}\n`);
      } catch {}
    },
  };
}
