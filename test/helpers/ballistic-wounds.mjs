import { ballisticDistance } from '../../public/ballistics.js';

// Test-only view of the real arrival events, preserving the old art fixture's
// tuple vocabulary. These tuples are never serialized by the game; callers
// still assert the actual bullet-impact ownership and chronological events.
export function ballisticShotView(events, shot = events.find(event => event.event === 'shot')) {
  if (!shot?.ballistic) return shot;
  const pellets = shot.projectiles.map(projectile => {
    let segment=projectile, distance=0, stop='range'; const wounds=[],contacts=[];
    for(const event of events.filter(event=>event.event==='bullet-impact'&&event.projectileId===projectile.id)){
      const at=ballisticDistance(segment,event.age); distance=Math.max(distance,at); contacts.push(event);
      if(Number.isFinite(event.power)&&Array.isArray(event.feet))wounds.push([event.zombieId,at,event.power,event.headshot?1:0,event.killed?1:0,...event.feet]);
      if(event.visualOnly!==true){stop=event.stop;if(event.continuation)segment=event.continuation;}
    }
    return {yaw:Math.atan2(-projectile.vx,-projectile.vz),pitch:Math.asin(projectile.vy/Math.hypot(projectile.vx,projectile.vy,projectile.vz)),distance,stop,wounds,contacts};
  });
  return {...shot,pellets};
}
