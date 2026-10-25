// Online-only limits. The local server does not import this module.
export const ONLINE_PROTOCOL = 1;

function integer(env, key, fallback, min, max) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  return value;
}

export function onlineConfig(env = process.env) {
  if (env.ONLINE_WS_COMPRESSION !== undefined && !['true', 'false'].includes(env.ONLINE_WS_COMPRESSION)) throw new Error('ONLINE_WS_COMPRESSION must be true or false.');
  const allowedOrigins = (env.ONLINE_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('ONLINE_ALLOWED_ORIGINS must contain complete HTTP(S) origins.');
  }
  return Object.freeze({
    mode: 'online', protocol: ONLINE_PROTOCOL, inputRate: 30, tickRate: 30, snapshotRate: 15,
    interpolationMs: 100, maxInputDt: .05, maxInputQueue: 64, maxRewindMs: 200,
    resumeGraceMs: 30000,
    compression: env.ONLINE_WS_COMPRESSION !== 'false',
    resultIdleMs: integer(env, 'ONLINE_RESULT_IDLE_MS', 30 * 60 * 1000, 60000, 24 * 60 * 60 * 1000),
    pausedIdleMs: integer(env, 'ONLINE_PAUSED_IDLE_MS', 2 * 60 * 60 * 1000, 60000, 24 * 60 * 60 * 1000),
    lobbyIdleMs: integer(env, 'ONLINE_LOBBY_IDLE_MS', 2 * 60 * 60 * 1000, 60000, 24 * 60 * 60 * 1000),
    maxRooms: integer(env, 'ONLINE_MAX_ROOMS', 5, 1, 100),
    maxPlayers: integer(env, 'ONLINE_MAX_PLAYERS', 20, 1, 400),
    maxConnections: integer(env, 'ONLINE_MAX_CONNECTIONS', 40, 4, 1000),
    // These count the actual TCP peer. X-Forwarded-For is deliberately ignored:
    // trusting an arbitrary client header would bypass every per-address cap.
    maxConnectionsPerAddress: integer(env, 'ONLINE_MAX_CONNECTIONS_PER_ADDRESS', 40, 4, 1000),
    maxMessagesPerSecond: integer(env, 'ONLINE_MAX_MESSAGES_PER_SECOND', 140, 30, 1000),
    createsPerMinute: integer(env, 'ONLINE_CREATES_PER_MINUTE', 6, 1, 100),
    allowedOrigins: Object.freeze(allowedOrigins),
  });
}

export function publicOnlineConfig(config) {
  return {
    mode: config.mode, protocol: config.protocol, inputRate: config.inputRate,
    tickRate: config.tickRate, snapshotRate: config.snapshotRate,
    interpolationMs: config.interpolationMs, maxInputDt: config.maxInputDt,
    maxRewindMs: config.maxRewindMs, resumeGraceMs: config.resumeGraceMs,
    resultIdleMs: config.resultIdleMs, pausedIdleMs: config.pausedIdleMs, lobbyIdleMs: config.lobbyIdleMs,
    maxPlayersPerRoom: 4, maxRooms: config.maxRooms, maxPlayers: config.maxPlayers,
  };
}
