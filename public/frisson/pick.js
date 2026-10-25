// Frisson part: the per-zombie picks (art/frisson/DESIGN.md, BODIES.md).
// The server id picks a zombie's head, its body set and each alternate part
// on every screen alike, each from its own hash, so the storybook look's
// random sequence is never touched. hashSeed (FNV-1a) alone will not do: its
// low bits follow the parity of the id's digits, and two salts that differ
// in their last letter (armL, armR) only move a few of its bits. Read
// straight, it ties every head to one body alternate, the left arm to the
// right one, and clumps the head styles along the ids. The murmur3
// finaliser spreads every bit over all the others first.
import { hashSeed } from '../zombie-looks.js';

export function mixHash(hash) {
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

// One of `count` for the zombie `id`: salt '' picks the head, '|set' the
// body set, '|torso', '|armL' … an alternate part.
export function frissonPick(id, salt, count) { return mixHash(hashSeed(`${id}|frisson${salt}`)) % count; }
