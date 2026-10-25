import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomSimulation, WEAPONS, ENGAGEMENT_BAND, damageFalloff } from '../simulation.mjs';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';

const before = JSON.parse(readFileSync(new URL('../public/weapon-damage-before.json', import.meta.url))).weapons;
const factor = (weapon, distance) => damageFalloff(WEAPONS[weapon], distance);
// Independent frozen-baseline evaluator: deliberately separate from chart and
// fitting helpers, including the former shotgun contact boost and strict range.
function oldDamage(w, d) {
  if (d >= w.range) return 0;
  const c = w.falloff;
  let f = !c || w.longRangePenetration ? 1 : d <= c.start ? c.near : d >= c.end ? c.far : c.near + (c.far-c.near)*(d-c.start)/(c.end-c.start);
  if (w.closeRangeBoost && d < w.closeRangeBoost.end) {
    const b = w.closeRangeBoost, t = Math.max(0, Math.min(1, (d-b.fullUntil)/(b.end-b.fullUntil)));
    f *= 1+(b.multiplier-1)*(1-t*t*(3-2*t));
  }
  return w.damage*f;
}
function mean(fn) {
  const count = 30000;
  let sum = 0;
  for (let i=0;i<count;i++) sum += fn((i+.5)*30/count);
  return sum/count;
}

test('smooth damage matches the frozen Refuge at 10 m and its approved 0-30 m mean', () => {
  assert.deepEqual(ENGAGEMENT_BAND, [0, 30]);
  for (const id of ['pistol','smg','rifle','assault','minigun','shotgun','sniper']) {
    const current = d => WEAPONS[id].damage*factor(id,d), previous = d => oldDamage(before[id],d);
    assert.ok(Math.abs(current(10)-previous(10)) < 1e-8, `${id}: exact 10 m anchor`);
    const error = mean(current)/mean(previous)-1;
    if (id === 'shotgun') assert.ok(error > -.044 && error < -.043);
    else if (id === 'sniper') assert.ok(error > -.024 && error < -.023);
    else assert.ok(Math.abs(error) < 1e-7, `${id}: mean error ${error}`);
  }
});

test('each smooth firearm curve keeps a distinct range personality and finite Magnum power', () => {
  assert.ok(factor('shotgun',20)<.21);
  assert.ok(factor('rifle',40)>factor('assault',40));
  assert.ok(factor('assault',40)>factor('minigun',40));
  assert.ok(factor('minigun',40)>factor('smg',40));
  assert.ok(factor('rifle',60)>.8);
  assert.ok(Math.abs(WEAPONS.magnum.damage-2000)<1e-8);
  assert.ok(factor('magnum',44)<1 && factor('magnum',44)>0);
  for (const [id,w] of Object.entries(WEAPONS).filter(([,w])=>w.bulletPhysics)) {
    let previous=Infinity;
    for (let d=0;d<=w.range;d+=.25) {
      const next=factor(id,d); assert.ok(Number.isFinite(next)&&next>=0&&next<=previous+1e-12); previous=next;
    }
  }
});

function yard(weapon, random = () => .5) {
  const simulation = new RoomSimulation('RANGE', { random });
  const player = simulation.addPlayer('a'); simulation.start('a');
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: 12, y: 0, z: 10, yaw: 0, pitch: 0 });
  return { simulation, player };
}
const target = (simulation,id,z) => {
  const zombie={id,x:12,y:.4,z,hp:1e5,maxHp:1e5,kind:'walker',scale:1,speed:0,attackAfter:Infinity};
  simulation.zombies.set(id,zombie);return zombie;
};

test('real shots apply the smooth curve at arrival to each pellet distance', () => {
  const near=yard('shotgun'),far=yard('shotgun');
  const close=target(near.simulation,'close',10-3),distant=target(far.simulation,'far',10-20);
  near.simulation.shoot('a');far.simulation.shoot('a');
  assert.equal(close.hp,1e5);assert.equal(distant.hp,1e5);
  settleBallisticFlight(near.simulation);settleBallisticFlight(far.simulation);
  const closeDamage=1e5-close.hp,farDamage=1e5-distant.hp,shell=WEAPONS.shotgun.pellets*WEAPONS.shotgun.damage;
  assert.ok(Math.abs(closeDamage-shell*factor('shotgun',2.68))<1e-4);
  assert.ok(Math.abs(farDamage-shell*factor('shotgun',19.68))<1e-4);
  assert.ok(farDamage/closeDamage<.4);
  const rifle=yard('rifle'),lane=target(rifle.simulation,'lane',10-18);
  rifle.simulation.shoot('a');settleBallisticFlight(rifle.simulation);
  assert.ok(Math.abs(1e5-lane.hp-WEAPONS.rifle.damage*factor('rifle',17.68))<1e-4);
});

test('the pistol cone misses at range where a machine-gun round still lands', () => {
  assert.ok(WEAPONS.pistol.spread>WEAPONS.rifle.spread);
  for (const [weapon,distance,hits] of [['pistol',5,true],['pistol',25,false],['rifle',25,true]]) {
    const {simulation}=yard(weapon,()=>.999999),zombie=target(simulation,'z',10-distance);
    simulation.shoot('a');settleBallisticFlight(simulation);
    assert.equal(zombie.hp<1e5,hits,`${weapon} at ${distance} m`);
  }
});
