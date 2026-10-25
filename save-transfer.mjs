// Upload of a save file in chunks, shared by the LAN and online servers:
// both cap a WebSocket message at 4096 bytes, and a save is 6-41 KB.
export const SAVE_TRANSFER = Object.freeze({ maxChunks: 200, maxSize: 600000, chunkChars: 3000, idleMs: 60000 });

const fail = reason => ({ reply: { type: 'load-result', ok: false, reason } });

// One transfer per peer, kept on the peer object. Returns { reply } to send,
// { text } once every chunk has arrived, or {} while it is under way.
export function receiveSaveUpload(peer, message, { now = Date.now(), refusal = null } = {}) {
  if (refusal) { peer.saveUpload = null; return fail(refusal); }
  if (peer.saveUpload && now - peer.saveUpload.at > SAVE_TRANSFER.idleMs) peer.saveUpload = null;
  if (message.type === 'load-begin') {
    if (peer.saveUpload) return fail('busy');
    const { chunks, size } = message;
    if (!Number.isSafeInteger(chunks) || !Number.isSafeInteger(size) || chunks < 1 || chunks > SAVE_TRANSFER.maxChunks
      || size < chunks || size > SAVE_TRANSFER.maxSize || size > chunks * SAVE_TRANSFER.chunkChars) return fail('too-large');
    peer.saveUpload = { chunks, size, parts: new Array(chunks).fill(null), received: 0, length: 0, at: now };
    return {};
  }
  const upload = peer.saveUpload;
  if (!upload) return fail('expired');
  const { index, data } = message;
  if (!Number.isSafeInteger(index) || index < 0 || index >= upload.chunks || upload.parts[index] !== null
    || typeof data !== 'string' || !data.length || data.length > SAVE_TRANSFER.chunkChars || upload.length + data.length > upload.size) {
    peer.saveUpload = null; return fail('invalid');
  }
  upload.parts[index] = data; upload.received++; upload.length += data.length; upload.at = now;
  if (upload.received < upload.chunks) return {};
  peer.saveUpload = null;
  if (upload.length !== upload.size) return fail('invalid');
  return { text: upload.parts.join('') };
}

// Discarded after a minute of silence (heartbeat) or when the peer leaves.
export function expireSaveUpload(peer, now = Date.now()) {
  if (peer.saveUpload && now - peer.saveUpload.at > SAVE_TRANSFER.idleMs) peer.saveUpload = null;
}

export function parseSaveText(text) {
  try { return { save: JSON.parse(text) }; } catch { return { reason: 'format' }; }
}
