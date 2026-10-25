// Blood-spray test data (art/frisson/BLOOD-SPRAY.md 2.7, 5.1): the wounds of
// the worked examples as RoomSimulation({ ambiance: 'frisson' }) records them
// (section 4.1; seeded random 7, the shooter at (-4.4, 0, 4) facing -z, the
// target straight ahead; the two walkers in line from (-4.4, 0, 2.1)), and the
// hook events the client makes of them (section 4.2 item 4). The blood tests
// and the bench feed these to the part; frisson-blood-spray.test.mjs checks
// they are still what the real server writes. Pellet: [yaw, pitch, distance,
// stop, wounds]; wound: [zombieId, hitAt, power, head, killed, feetX, feetY, feetZ].
export const SHOTS = Object.freeze({
  pistolBody3: { eye: [-4.4,1.55,4], pellets: [[-0.016,-0.037,2.682,"zombie",[["T",2.682,25.161,0,0,-4.4,0,1]]]] },
  pistolHead3: { eye: [-4.4,1.55,4], pellets: [[-0.016,0.043,2.683,"zombie",[["T",2.683,55.355,1,0,-4.4,0,1]]]] },
  pistolBody10: { eye: [-4.4,1.55,4], pellets: [[-0.016,-0.047,9.692,"zombie",[["T",9.692,23.852,0,0,-4.4,0,-6]]]] },
  rifleBody6: { eye: [-4.4,1.55,4], pellets: [[-0.008,-0.023,65,"range",[["T",5.682,30,0,0,-4.4,0,-2]]]] },
  assaultHead6: { eye: [-4.4,1.55,4], pellets: [[-0.006,0.02,55,"range",[["T",5.681,92.4,1,0,-4.4,0,-2]]]] },
  shotgunBody10: { eye: [-4.4,1.55,4], pellets: [[-0.087,-0.002,9.902,"solid",[]],[-0.034,-0.124,9.947,"solid",[]],[0.05,-0.064,9.898,"solid",[]],[-0.028,-0.022,32,"range",[["T",9.686,16.82,0,0,-4.4,0,-6]]],[0.056,-0.063,9.9,"solid",[]],[0.034,-0.048,9.882,"solid",[]],[0.056,-0.112,8.315,"solid",[]],[-0.021,-0.029,32,"range",[["T",9.686,16.82,0,0,-4.4,0,-6]]],[0.034,-0.162,32,"range",[]]] },
  shotgunBody5: { eye: [-4.4,1.55,4], pellets: [[-0.087,-0.022,9.905,"solid",[]],[-0.034,-0.144,9.973,"solid",[["T",4.731,21.086,0,0,-4.4,0,-1]]],[0.05,-0.084,8.29,"solid",[["T",4.703,21.086,0,0,-4.4,0,-1]]],[-0.028,-0.042,9.878,"solid",[["T",4.686,21.086,0,0,-4.4,0,-1]]],[0.056,-0.083,8.291,"solid",[["T",4.703,21.086,0,0,-4.4,0,-1]]],[0.034,-0.068,9.893,"solid",[["T",4.693,21.086,0,0,-4.4,0,-1]]],[0.056,-0.132,8.335,"solid",[["T",4.728,21.086,0,0,-4.4,0,-1]]],[-0.021,-0.049,9.879,"solid",[["T",4.687,21.086,0,0,-4.4,0,-1]]],[0.034,-0.182,32,"range",[["T",4.761,21.086,0,0,-4.4,0,-1]]]] },
  shotgunBody12: { eye: [-4.4,1.55,4], pellets: [[-0.087,-0.082,9.936,"solid",[["T",0.886,42.171,0,0,-4.4,0,2.8]]],[-0.034,-0.204,32,"range",[["T",0.899,42.171,0,0,-4.4,0,2.8]]],[0.05,-0.144,8.347,"solid",[["T",0.89,42.171,0,0,-4.4,0,2.8]]],[-0.028,-0.102,9.921,"solid",[["T",0.885,42.171,0,0,-4.4,0,2.8]]],[0.056,-0.143,8.348,"solid",[["T",0.89,42.171,0,0,-4.4,0,2.8]]],[0.034,-0.128,9.952,"solid",[["T",0.888,42.171,0,0,-4.4,0,2.8]]],[0.056,-0.192,32,"range",[["T",0.898,42.171,0,0,-4.4,0,2.8]]],[-0.021,-0.109,9.926,"solid",[["T",0.885,42.171,0,0,-4.4,0,2.8]]],[0.034,-0.242,32,"range",[["T",0.907,42.171,0,0,-4.4,0,2.8]]]] },
  shotgunColossusBody: { eye: [-4.4,1.55,4], pellets: [[-0.087,-0.032,9.908,"solid",[["T",0.813,42.171,0,0,-4.4,0,2.8]]],[-0.034,-0.154,9.988,"solid",[["T",0.82,42.171,0,0,-4.4,0,2.8]]],[0.05,-0.094,8.297,"solid",[["T",0.814,42.171,0,0,-4.4,0,2.8]]],[-0.028,-0.052,9.882,"solid",[["T",0.811,42.171,0,0,-4.4,0,2.8]]],[0.056,-0.093,8.298,"solid",[["T",0.814,42.171,0,0,-4.4,0,2.8]]],[0.034,-0.078,9.901,"solid",[["T",0.813,42.171,0,0,-4.4,0,2.8]]],[0.056,-0.142,8.346,"solid",[["T",0.819,42.171,0,0,-4.4,0,2.8]]],[-0.021,-0.059,9.885,"solid",[["T",0.811,42.171,0,0,-4.4,0,2.8]]],[0.034,-0.192,32,"range",[["T",0.825,42.171,0,0,-4.4,0,2.8]]]] },
  shotgunColossusHead: { eye: [-4.4,1.55,4], pellets: [[-0.087,0.418,10.833,"solid",[["T",0.889,92.777,1,0,-4.4,0,2.8]]],[-0.034,0.296,10.321,"solid",[["T",0.847,42.171,0,0,-4.4,0,2.8]]],[0.05,0.356,10.537,"solid",[["T",0.865,92.777,1,0,-4.4,0,2.8]]],[-0.028,0.398,10.705,"solid",[["T",0.879,92.777,1,0,-4.4,0,2.8]]],[0.056,0.357,10.547,"solid",[["T",0.866,92.777,1,0,-4.4,0,2.8]]],[0.034,0.372,10.596,"solid",[["T",0.87,92.777,1,0,-4.4,0,2.8]]],[0.056,0.308,10.37,"solid",[["T",0.851,92.777,1,0,-4.4,0,2.8]]],[-0.021,0.391,10.671,"solid",[["T",0.876,92.777,1,0,-4.4,0,2.8]]],[0.034,0.258,10.208,"solid",[["T",0.838,42.171,0,0,-4.4,0,2.8]]]] },
  shotgunColossusKill: { eye: [-4.4,1.55,4], pellets: [[-0.087,0.418,10.833,"solid",[["T",0.889,92.777,1,0,-4.4,0,2.8]]],[-0.034,0.296,10.321,"solid",[["T",0.847,42.171,0,0,-4.4,0,2.8]]],[0.05,0.356,10.537,"solid",[["T",0.865,92.777,1,0,-4.4,0,2.8]]],[-0.028,0.398,10.705,"solid",[["T",0.879,92.777,1,0,-4.4,0,2.8]]],[0.056,0.357,10.547,"solid",[["T",0.866,92.777,1,0,-4.4,0,2.8]]],[0.034,0.372,10.596,"solid",[["T",0.87,92.777,1,0,-4.4,0,2.8]]],[0.056,0.308,10.37,"solid",[["T",0.851,92.777,1,0,-4.4,0,2.8]]],[-0.021,0.391,10.671,"solid",[["T",0.876,92.777,1,0,-4.4,0,2.8]]],[0.034,0.258,10.208,"solid",[["T",0.838,42.171,0,1,-4.4,0,2.8]]]] },
  shotgunWalkerKill: { eye: [-4.4,1.55,4], pellets: [[-0.087,0.168,10.043,"solid",[["T",0.896,92.777,1,1,-4.4,0,2.8]]],[-0.034,0.046,32,"range",[["T",0.881,92.777,1,1,-4.4,0,2.8]]],[0.05,0.106,32,"range",[["T",0.886,92.777,1,1,-4.4,0,2.8]]],[-0.028,0.148,9.978,"solid",[["T",0.89,92.777,1,1,-4.4,0,2.8]]],[0.056,0.107,32,"range",[["T",0.886,92.777,1,1,-4.4,0,2.8]]],[0.034,0.122,9.945,"solid",[["T",0.887,92.777,1,1,-4.4,0,2.8]]],[0.056,0.058,32,"range",[["T",0.883,92.777,1,1,-4.4,0,2.8]]],[-0.021,0.141,9.966,"solid",[["T",0.889,92.777,1,1,-4.4,0,2.8]]],[0.034,0.008,32,"range",[["T",0.881,92.777,1,1,-4.4,0,2.8]]]] },
  sniperWalkerKill: { eye: [-4.4,1.55,4], pellets: [[-0.001,0.011,90,"range",[["T",7.68,770,1,1,-4.4,0,-4]]]] },
  sniperColossusHead: { eye: [-4.4,1.55,4], pellets: [[-0.001,0.041,90,"range",[["T",7.616,770,1,0,-4.4,0,-4]]]] },
  magnumColossusKill: { eye: [-4.4,1.55,4], pellets: [[-0.002,-0.018,5.611,"zombie",[["T",5.611,1400,0,1,-4.4,0,-2]]]] },
  magnumWalkerKill: { eye: [-4.4,1.55,4], pellets: [[-0.002,-0.018,5.681,"zombie",[["T",5.681,200,0,1,-4.4,0,-2]]]] },
  shotgunCrawler3: { eye: [-4.4,1.55,4], pellets: [[-0.087,-0.182,32,"range",[]],[-0.034,-0.304,32,"range",[["T",2.81,62.494,1,0,-4.4,0,1]]],[0.05,-0.244,32,"range",[["T",3.017,58.059,1,0,-4.4,0,1]]],[-0.028,-0.202,32,"range",[]],[0.056,-0.243,32,"range",[["T",3.039,57.628,1,0,-4.4,0,1]]],[0.034,-0.228,32,"range",[["T",3.232,53.945,1,0,-4.4,0,1]]],[0.056,-0.292,32,"range",[["T",2.803,62.662,1,0,-4.4,0,1]]],[-0.021,-0.209,32,"range",[]],[0.034,-0.342,32,"range",[["T",2.847,61.687,1,0,-4.4,0,1]]]] },
  shotgunColossusMixed: { eye: [-4.4,1.55,4], pellets: [[-0.087,0.338,10.494,"solid",[["T",0.861,92.777,1,0,-4.4,0,2.8]]],[-0.034,0.216,10.107,"solid",[["T",0.829,42.171,0,0,-4.4,0,2.8]]],[0.05,0.276,10.265,"solid",[["T",0.842,42.171,0,0,-4.4,0,2.8]]],[-0.028,0.318,10.389,"solid",[["T",0.853,92.777,1,0,-4.4,0,2.8]]],[0.056,0.277,10.273,"solid",[["T",0.843,42.171,0,0,-4.4,0,2.8]]],[0.034,0.292,10.308,"solid",[["T",0.846,42.171,0,0,-4.4,0,2.8]]],[0.056,0.228,10.144,"solid",[["T",0.832,42.171,0,0,-4.4,0,2.8]]],[-0.021,0.311,10.363,"solid",[["T",0.85,92.777,1,0,-4.4,0,2.8]]],[0.034,0.178,10.029,"solid",[["T",0.823,42.171,0,0,-4.4,0,2.8]]]] },
  shotgunTwoWalkers: { eye: [-4.4,1.55,2.1], pellets: [[-0.087,0.008,7.995,"solid",[["A",2.69,65.195,1,0,-4.4,0,-0.9]]],[-0.034,-0.114,3.706,"zombie",[["A",2.699,29.543,0,0,-4.4,0,-0.9],["B",3.706,9.744,0,0,-4.4,0,-1.9]]],[0.05,-0.054,3.69,"zombie",[["A",2.687,29.664,0,0,-4.4,0,-0.9],["B",3.69,9.771,0,0,-4.4,0,-1.9]]],[-0.028,-0.012,3.682,"zombie",[["A",2.681,65.399,1,0,-4.4,0,-0.9],["B",3.682,21.53,1,0,-4.4,0,-1.9]]],[0.056,-0.053,3.691,"zombie",[["A",2.688,29.658,0,0,-4.4,0,-0.9],["B",3.691,9.77,0,0,-4.4,0,-1.9]]],[0.034,-0.038,3.685,"zombie",[["A",2.683,29.704,0,0,-4.4,0,-0.9],["B",3.685,9.781,0,0,-4.4,0,-1.9]]],[0.056,-0.102,3.705,"zombie",[["A",2.698,29.552,0,0,-4.4,0,-0.9],["B",3.705,9.746,0,0,-4.4,0,-1.9]]],[-0.021,-0.019,3.681,"zombie",[["A",2.681,65.403,1,0,-4.4,0,-0.9],["B",3.681,9.787,0,0,-4.4,0,-1.9]]],[0.034,-0.152,3.725,"zombie",[["A",2.713,29.399,0,0,-4.4,0,-0.9],["B",3.725,9.713,0,0,-4.4,0,-1.9]]]] },
});

// The rows of the 2.7 table: the shot (or one synthetic wound for melee,
// blasts and the legacy kill), the target's kind, the camera's distance d
// (the shooter's own view), and the printed values (high preset; medium and
// low are totals). D and I are rounded as printed.
const row = (label, source, kind, d, mode, expect) => Object.freeze({ label, source, kind, d, mode, expect: Object.freeze(expect) });
export const ROWS = Object.freeze([
  row('Pistol, walker body, 3 m', 'pistolBody3', 'walker', 3, 'bullet', { wounds: 1, heads: 0, D: 25.2, I: 1.18, puffs: 2, burst: 10, back: 5, exit: 5, globs: 0, fountain: 0, kill: 0, total: 12, medium: 12, low: 12, spots: 8 }),
  row('Pistol, walker head, 3 m', 'pistolHead3', 'walker', 3, 'bullet', { wounds: 1, heads: 1, D: 55.4, I: 1.91, puffs: 2, burst: 19, back: 10, exit: 9, globs: 0, fountain: 0, kill: 0, total: 21, medium: 21, low: 21, spots: 13 }),
  row('Pistol, walker body, 10 m', 'pistolBody10', 'walker', 10, 'bullet', { wounds: 1, heads: 0, D: 23.9, I: 1.13, puffs: 1, burst: 7, back: 3, exit: 4, globs: 0, fountain: 0, kill: 0, total: 8, medium: 8, low: 8, spots: 5 }),
  row('Rifle, walker body, 6 m', 'rifleBody6', 'walker', 6, 'bullet', { wounds: 1, heads: 0, D: 30, I: 1.32, puffs: 2, burst: 11, back: 4, exit: 7, globs: 0, fountain: 0, kill: 0, total: 13, medium: 13, low: 13, spots: 8 }),
  row('Assault rifle, walker head, 6 m', 'assaultHead6', 'walker', 6, 'bullet', { wounds: 1, heads: 1, D: 92.4, I: 2.49, puffs: 2, burst: 23, back: 9, exit: 14, globs: 0, fountain: 0, kill: 0, total: 25, medium: 25, low: 25, spots: 15 }),
  row('Shotgun, walker body, 10 m', 'shotgunBody10', 'walker', 10, 'bullet', { wounds: 2, heads: 0, D: 33.6, I: 1.42, puffs: 2, burst: 8, back: 3, exit: 5, globs: 0, fountain: 0, kill: 0, total: 10, medium: 10, low: 10, spots: 6 }),
  row('Shotgun, walker body, 5 m', 'shotgunBody5', 'walker', 5, 'bullet', { wounds: 8, heads: 0, D: 168.7, I: 3.24, puffs: 16, burst: 22, back: 9, exit: 13, globs: 0, fountain: 0, kill: 0, total: 38, medium: 38, low: 38, spots: 14 }),
  row('Shotgun, walker body, 1.2 m', 'shotgunBody12', 'walker', 1.2, 'bullet', { wounds: 9, heads: 0, D: 379.5, I: 4.32, puffs: 18, burst: 29, back: 15, exit: 14, globs: 1, fountain: 0, kill: 0, total: 47, medium: 47, low: 47, spots: 17 }),
  row('Shotgun, colossus body, 1.2 m', 'shotgunColossusBody', 'brute', 1.2, 'bullet', { wounds: 9, heads: 0, D: 379.5, I: 4.32, puffs: 18, burst: 39, back: 20, exit: 19, globs: 1, fountain: 0, kill: 0, total: 57, medium: 57, low: 57, spots: 23 }),
  row('Shotgun, colossus head, 1.2 m (1,400 HP)', 'shotgunColossusHead', 'brute', 1.2, 'bullet', { wounds: 9, heads: 7, D: 733.8, I: 5.24, puffs: 18, burst: 59, back: 30, exit: 29, globs: 2, fountain: 8, kill: 0, total: 85, medium: 85, low: 69, spots: 34 }),
  row('The same, 700-HP colossus (killed)', 'shotgunColossusKill', 'brute', 1.2, 'bullet', { wounds: 9, heads: 7, D: 733.8, I: 5.24, puffs: 18, burst: 59, back: 30, exit: 29, globs: 2, fountain: 0, kill: 30, total: 107, medium: 107, low: 91, spots: 34 }),
  row('Shotgun, 80-HP walker, head, 1.2 m (1 kill + 8 through the body)', 'shotgunWalkerKill', 'walker', 1.2, 'bullet', { wounds: 9, heads: 9, D: 835, I: 5.42, puffs: 18, burst: 46, back: 23, exit: 23, globs: 2, fountain: 0, kill: 23, total: 87, medium: 87, low: 72, spots: 26 }),
  row('Sniper, walker head, 8 m (killed)', 'sniperWalkerKill', 'walker', 8, 'bullet', { wounds: 1, heads: 1, D: 770, I: 5.30, puffs: 2, burst: 45, back: 18, exit: 27, globs: 2, fountain: 0, kill: 23, total: 70, medium: 70, low: 56, spots: 26 }),
  row('Sniper, colossus head, 8 m', 'sniperColossusHead', 'brute', 8, 'bullet', { wounds: 1, heads: 1, D: 770, I: 5.30, puffs: 2, burst: 61, back: 24, exit: 37, globs: 2, fountain: 8, kill: 0, total: 71, medium: 71, low: 53, spots: 35 }),
  row('Magnum, colossus body, 6 m (killed)', 'magnumColossusKill', 'brute', 6, 'bullet', { wounds: 1, heads: 0, D: 1400, I: 6.15, puffs: 2, burst: 54, back: 22, exit: 32, globs: 3, fountain: 0, kill: 25, total: 81, medium: 81, low: 67, spots: 30 }),
  row('Magnum, walker body, 6 m (killed)', 'magnumWalkerKill', 'walker', 6, 'bullet', { wounds: 1, heads: 0, D: 200, I: 3.46, puffs: 2, burst: 24, back: 10, exit: 14, globs: 0, fountain: 0, kill: 13, total: 39, medium: 39, low: 39, spots: 14 }),
  row('Shotgun, crawler, 3 m', 'shotgunCrawler3', 'crawler', 3, 'bullet', { wounds: 6, heads: 6, D: 356.5, I: 4.23, puffs: 12, burst: 28, back: 14, exit: 14, globs: 1, fountain: 5, kill: 0, total: 45, medium: 45, low: 45, spots: 16 }),
  row('Bat light, walker', { power: 120, killed: 0 }, 'walker', 1.5, 'melee', { wounds: 1, heads: 0, D: 120, I: 2.81, puffs: 2, burst: 20, back: 10, exit: 10, globs: 0, fountain: 0, kill: 0, total: 22, medium: 22, low: 22, spots: 12 }),
  row('Bat light, walker (kill)', { power: 120, killed: 1 }, 'walker', 1.5, 'melee', { wounds: 1, heads: 0, D: 120, I: 2.81, puffs: 2, burst: 20, back: 10, exit: 10, globs: 0, fountain: 0, kill: 12, total: 34, medium: 34, low: 34, spots: 12 }),
  row('Hammer heavy, colossus (killed)', { power: 900, killed: 1 }, 'brute', 1.5, 'melee', { wounds: 1, heads: 0, D: 900, I: 5.52, puffs: 2, burst: 49, back: 25, exit: 24, globs: 3, fountain: 0, kill: 23, total: 74, medium: 74, low: 67, spots: 28 }),
  row('Katana heavy, walker (killed)', { power: 504, killed: 1 }, 'walker', 1.5, 'melee', { wounds: 1, heads: 0, D: 504, I: 4.71, puffs: 2, burst: 31, back: 16, exit: 15, globs: 2, fountain: 0, kill: 15, total: 48, medium: 48, low: 48, spots: 18 }),
  row('Rocket, walker within 2 m (killed), seen from 6 m', { power: 700, killed: 1 }, 'walker', 6, 'blast', { wounds: 1, heads: 0, D: 700, I: 5.17, puffs: 0, burst: 20, back: 0, exit: 20, globs: 2, fountain: 0, kill: 16, total: 36, medium: 36, low: 36, spots: 20 }),
  row('Grenade, walker 3 m from it, seen from 6 m', { power: 225, killed: 0 }, 'walker', 6, 'blast', { wounds: 1, heads: 0, D: 225, I: 3.61, puffs: 0, burst: 15, back: 0, exit: 15, globs: 1, fountain: 0, kill: 0, total: 15, medium: 15, low: 15, spots: 15 }),
  row('Fire kill (legacy, no wound), 6 m', { power: 40, killed: 1, local: false }, 'walker', 6, 'legacy', { wounds: 1, heads: 0, D: 40, I: 1.58, puffs: 0, burst: 13, back: 0, exit: 13, globs: 0, fountain: 0, kill: 9, total: 22, medium: 22, low: 22, spots: 9 }),
]);
// The stream table of 2.7: steady state, every round on one zombie at 6 m.
// Spots follow the kind and head factors (review round 2): a colossus or a
// head stream leaves more floor and wall pixels than the brief first printed.
// The rifle's spots per second are 20 (1.84 a round every .09 s); the brief
// prints 21.
export const STREAMS = Object.freeze([
  Object.freeze({ label: 'Minigun on a colossus', interval: .055, power: 30.1, kind: 'brute', head: false, A: 68, puffs: 2, burst: 3.44, perRound: 5.4, perSecond: 99, spotsPerSecond: 31 }),
  Object.freeze({ label: 'SMG on a walker', interval: .085, power: 21, kind: 'walker', head: false, A: 28, puffs: 2, burst: 3.17, perRound: 5.2, perSecond: 61, spotsPerSecond: 19 }),
  Object.freeze({ label: 'Rifle on a walker', interval: .09, power: 30, kind: 'walker', head: false, A: 36, puffs: 2, burst: 3.69, perRound: 5.7, perSecond: 63, spotsPerSecond: 20 }),
  Object.freeze({ label: 'Assault rifle on the head of a walker', interval: .13, power: 92.4, kind: 'walker', head: true, A: 67, puffs: 2, burst: 8.14, perRound: 10.1, perSecond: 78, spotsPerSecond: 31 }),
  Object.freeze({ label: 'Pistol on a walker', interval: .25, power: 25.2, kind: 'walker', head: false, A: 6, puffs: 2, burst: 5.89, perRound: 7.9, perSecond: 32, spotsPerSecond: 12 }),
]);

export const SCALES = Object.freeze({ walker: 1, crawler: 1, brute: 1.22, boss: 1.32 });
// public/shot-fx.js: a tracer's travel is max(.035, length / BULLET_SPEED).
export const BULLET_SPEED = 170;
export const pelletDirection = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
// The wounds of a recorded shot, flat: { id, hitAt, power, head, killed, feet, dir, distance }.
export function shotWounds(name) {
  const shot = SHOTS[name];
  return shot.pellets.flatMap(([yaw, pitch, distance, , wounds]) => wounds.map(([id, hitAt, power, head, killed, x, y, z]) =>
    ({ id, hitAt, power, head: head === 1, killed: killed === 1, feet: [x, y, z], dir: pelletDirection(yaw, pitch), distance })));
}
// The spray of one 2.7 row, as sprayPlan takes it (a fresh zombie).
export function rowSpray(row) {
  const wounds = typeof row.source === 'string' ? shotWounds(row.source) : [{ power: row.source.power, head: false, killed: row.source.killed === 1 }];
  const damage = wounds.reduce((sum, wound) => sum + wound.power, 0), head = wounds.reduce((sum, wound) => sum + (wound.head ? wound.power : 0), 0);
  return { damage, recent: 0, headShare: damage > 0 ? head / damage : 0, wounds: wounds.length, kind: row.kind, boss: false, mode: row.mode,
    kill: wounds.some(wound => wound.killed), killDone: false, distance: row.d, local: row.source.local ?? true, carry: .5, spotCarry: .5 };
}
// The client's hook event for one wound (4.2 item 4): the point is eye +
// dir × hitAt, moved by `shift` (the drawn body minus the feet); due when
// the tracer gets there. `move` carries the whole scene (eye, body, wound)
// elsewhere in the cabin; MOVE puts the target's feet at the shot tool's
// spot (2.6, 0, -4.6), clear of furniture with the shooter along +z.
export const MOVE = name => { const feet = shotWounds(name)[0].feet; return [2.6 - feet[0], 0, -4.6 - feet[2]]; };
export function woundEvent(name, wound, { shot = 1, local = true, kind = 'walker', boss = false, scale = SCALES[kind] ?? 1, shift = [0, 0, 0],
  move = [0, 0, 0], eye = SHOTS[name].eye, weapon = 'shotgun', travel = null } = {}) {
  const [dx, dy, dz] = wound.dir, flight = travel ?? Math.max(.035, wound.distance / BULLET_SPEED);
  return {
    x: eye[0] + dx * wound.hitAt + shift[0] + move[0], y: eye[1] + dy * wound.hitAt + shift[1] + move[1], z: eye[2] + dz * wound.hitAt + shift[2] + move[2],
    dirX: dx, dirY: dy, dirZ: dz, headshot: wound.head, kill: wound.killed, zombieId: wound.id, damage: wound.power, weapon, mode: 'bullet', shot,
    kind, boss, scale, axisX: wound.feet[0] + shift[0] + move[0], axisZ: wound.feet[2] + shift[2] + move[2], local,
    delay: wound.distance > 0 ? flight * Math.min(1, wound.hitAt / wound.distance) : flight,
  };
}
export const shotEvents = (name, options = {}) => shotWounds(name).map(wound => woundEvent(name, wound, options));
