// Validation-only preload that brings a campaign raid within a minute, for
// browser proofs on an isolated control server:
//   PORT=0 node --import ./validation/raid-qa-hook.mjs server.mjs
//   PowerShell: $env:PORT = '0'; node --import ./validation/raid-qa-hook.mjs server.mjs
// It patches RoomSimulation.prototype in this process only. Production code,
// the build id and the served files stay unchanged. It refuses to load without
// PORT, or with 3000/3002: server.mjs would otherwise take a shared port.
// RAID_QA_WAVE picks the raid wave (5, 10 or 15, default 5); RAID_QA_HORDE
// caps that wave's zombies (default 3) so the trigger comes quickly.
import { RoomSimulation } from '../simulation.mjs';
import { RAIDS } from '../public/raids.js';

// Read as a number like server.mjs does, so ' 3002' or '03002' cannot slip
// through; an unset or empty PORT is refused rather than defaulting to 3000.
const port = Number(process.env.PORT?.trim() || NaN);
if (!Number.isInteger(port) || port === 3000 || port === 3002) {
  throw new Error(`raid-qa-hook: PORT must name an isolated port (PORT=0 picks a free one; PowerShell: $env:PORT = '0'), never 3000 or 3002; got ${JSON.stringify(process.env.PORT ?? null)}`);
}
const wave = Number(process.env.RAID_QA_WAVE ?? 5), horde = Number(process.env.RAID_QA_HORDE ?? 3);
if (!RAIDS.waves.includes(wave)) throw new Error(`RAID_QA_WAVE must be one of ${RAIDS.waves.join(', ')}`);
if (!Number.isInteger(horde) || horde < 0) throw new Error('RAID_QA_HORDE must be a whole number');

const { start, beginWave } = RoomSimulation.prototype;
Object.assign(RoomSimulation.prototype, {
  // The first countdown leads straight into the chosen raid wave.
  start(...args) {
    const started = start.apply(this, args);
    if (started) this.wave = wave - 1;
    return started;
  },
  // Raid waves keep only a token horde; the raid itself is untouched.
  beginWave(...args) {
    const begun = beginWave.apply(this, args);
    if (begun && this.raid) {
      this.toSpawn = Math.min(this.toSpawn, horde);
      this.waveInitialTotal = Math.min(this.waveInitialTotal, horde);
      this.brutesToSpawn = 0;
      this.bruteSpawnAt = [];
      this.farSpawnQuota = 0;
    }
    return begun;
  },
});
console.log(`[raid-qa-hook] campaign starts at wave ${wave} with at most ${horde} zombies before the raid (validation only).`);
