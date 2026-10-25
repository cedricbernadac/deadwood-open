import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR } from './level-config.js';
import { EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, wallOpenings } from './layout.js';
import { createHospitalSpace } from './level-space-hospital.js';
import { createFunfairSpace } from './level-space-funfair.js';
// Metres, feet coordinates. One source for Blender, authority, prediction,
// companion routing and render proxies. Cabin retains its historical solver.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const rect = (minX,maxX,minZ,maxZ) => ({minX,maxX,minZ,maxZ});
export const spaceInRect = (x,z,r,margin=0) => x >= r.minX-margin && x <= r.maxX+margin && z >= r.minZ-margin && z <= r.maxZ+margin;
const flight = (id,minX,maxX,minZ,maxZ) => ({id,...rect(minX,maxX,minZ,maxZ),baseY:-3.4,topY:0,steps:20,treadThickness:.17,
  well:rect(minX-.3,maxX+.3,minZ-.35,maxZ+.55),
  lower:{x:(minX+maxX)/2,y:-3.4,z:minZ-.65},upper:{x:(minX+maxX)/2,y:0,z:maxZ+1.05}});
const flights=[flight('stock-stair',3,5.4,-8,-1),flight('garden-stair',10,12.4,2,9)];
const holes=flights.map(f=>f.well);
function subtract(bounds,hole) {
  const a=Math.max(bounds.minX,hole.minX),b=Math.min(bounds.maxX,hole.maxX),c=Math.max(bounds.minZ,hole.minZ),d=Math.min(bounds.maxZ,hole.maxZ);
  if(a>=b||c>=d)return [bounds];
  return [rect(bounds.minX,a,bounds.minZ,bounds.maxZ),rect(b,bounds.maxX,bounds.minZ,bounds.maxZ),rect(a,b,bounds.minZ,c),rect(a,b,d,bounds.maxZ)].filter(r=>r.maxX>r.minX&&r.maxZ>r.minZ);
}
const groundPieces=holes.reduce((pieces,hole)=>pieces.flatMap(piece=>subtract(piece,hole)),[rect(-160,160,-84,84)]);
const slabs=groundPieces.map((r,i)=>({id:`ground-slab-${i}`,...r,minY:-.24,maxY:0}));
for(const f of flights)slabs.push({id:`ground-upper-apron-${f.id}`,...rect(f.well.minX,f.well.maxX,f.maxZ,f.well.maxZ),minY:-.24,maxY:0});
slabs.push({id:'cellar-slab',...rect(-1,13,-10,10),minY:-3.64,maxY:-3.4});
const walls=[
  {id:'cellar-west',...rect(-1.24,-1,-10.24,10.24),baseY:-3.4,height:3.4},
  {id:'cellar-east',...rect(13,13.24,-10.24,10.24),baseY:-3.4,height:3.4},
  {id:'cellar-north',...rect(-1,13,-10.24,-10),baseY:-3.4,height:3.4},
  {id:'cellar-south',...rect(-1,13,10,10.24),baseY:-3.4,height:3.4},
  {id:'garden-partition-north',...rect(7.88,8.12,-11,-1.6),baseY:0,height:4.2},
  {id:'garden-partition-lintel',...rect(7.88,8.12,-1.6,1.6),baseY:3.1,height:1.1},
  {id:'garden-partition-south',...rect(7.88,8.12,1.6,11),baseY:0,height:4.2},
];
// Retaining cheeks and low parapets protect the open stairwells. Their caps
// stay within zombie reach; tall stock shelving stays away from both flights.
const rails=flights.flatMap(f=>[
  {id:`${f.id}-west`,...rect(f.minX-.22,f.minX,f.minZ-.3,f.maxZ+.5),baseY:-3.4,height:4.45},
  {id:`${f.id}-east`,...rect(f.maxX,f.maxX+.22,f.minZ-.3,f.maxZ+.5),baseY:-3.4,height:4.45},
  {id:`${f.id}-low-end`,...rect(f.minX-.22,f.maxX+.22,f.minZ-.35,f.minZ-.15),baseY:-.24,height:1.29},
]);
const treads=flights.flatMap(f=>Array.from({length:f.steps},(_,i)=>({id:`${f.id}-tread-${i}`,flightId:f.id,
  minX:f.minX,maxX:f.maxX,minZ:f.minZ+i*(f.maxZ-f.minZ)/f.steps,maxZ:f.minZ+(i+1)*(f.maxZ-f.minZ)/f.steps,
  minY:f.baseY,maxY:f.baseY+(i+1)*(f.topY-f.baseY)/f.steps})));
export const spaceWallHeight=(wall,along)=>IS_SUPERMARKET&&(wall.id==='east'||(['north','south'].includes(wall.id)&&along>8))?3.2:6.5;
const facadeSections=[];
for(const wall of EXTERIOR_WALLS){
  const section=(min,max,low,high)=>{if(max<=min||high<=low)return;const r=wall.axis==='x'?rect(min,max,wall.fixed-EXTERIOR_WALL_THICKNESS/2,wall.fixed+EXTERIOR_WALL_THICKNESS/2):rect(wall.fixed-EXTERIOR_WALL_THICKNESS/2,wall.fixed+EXTERIOR_WALL_THICKNESS/2,min,max);facadeSections.push({id:wall.id+'-'+facadeSections.length,wallId:wall.id,...r,minY:low,maxY:high});};
  const span=(min,max,low)=>{const cuts=[min,...(wall.axis==='x'&&min<8&&max>8?[8]:[]),max];for(let i=1;i<cuts.length;i++)section(cuts[i-1],cuts[i],low,spaceWallHeight(wall,(cuts[i-1]+cuts[i])/2));};
  let cursor=-wall.length/2;
  for(const opening of wallOpenings(wall.id)){const min=opening.center-opening.width/2,max=opening.center+opening.width/2;span(cursor,min,0);section(min,max,0,opening.bottom);span(min,max,opening.top);cursor=max;}
  span(cursor,wall.length/2,0);
}
// Solid parking props (lot 2): cars, a delivery van, trolleys and their
// corral, lamp posts. Axis-aligned boxes the Blender art fills exactly; each
// is at least 1 m tall (the jump apex is 0.87 m), and every scripted route
// (spawn, raid and far entries, supply and fuel caches) keeps >= 2.5 m.
const prop=(id,kind,cx,cz,sx,sz,height)=>({id,kind,...rect(cx-sx/2,cx+sx/2,cz-sz/2,cz+sz/2),minY:0,maxY:height});
const props=[
  prop('prop-car-west','car',-11,20.2,1.8,4.3,1.45),
  prop('prop-car-east','car',11.2,19.6,1.8,4.3,1.45),
  prop('prop-van-north','van',11,-15.6,5,2,2.3),
  prop('prop-trolley-corral','corral',-8.6,13.9,3,.8,2.2),
  prop('prop-trolley-south','trolley',7.4,14.2,.6,.9,1),
  prop('prop-trolley-west','trolley',-15.8,13.4,.6,.9,1),
  prop('prop-lamp-sw','lamp',-9,15.6,.24,.24,6.2),
  prop('prop-lamp-se','lamp',9,15.6,.24,.24,6.2),
  prop('prop-lamp-nw','lamp',-19.5,-18,.24,.24,6.2),
  prop('prop-lamp-ne','lamp',16.2,-13.8,.24,.24,6.2),
];
const boxes=[...slabs,...walls.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...rails.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...treads,...props];
const supermarketSpace={id:'supermarket-depth',minY:-3.4,flights,holes,slabs,walls,rails,treads,props,boxes,
  facadeSections,
  floors:[{id:'sales',...rect(-14,8,-11,11),y:0},{id:'terrace',...rect(8,14,-11,11),y:0},{id:'cellar',...rect(-1,13,-10,10),y:-3.4}],
  shelters:[{id:'sales-roof',...rect(-14.38,8.38,-11.5,11.5),minY:6.26,maxY:6.5},...slabs.filter(s=>s.maxY===0)],
  refuge:{x:6.5,y:-3.4,z:-8.9},watch:{x:4.2,y:-2.1,z:-7.5},
};
const hospitalSpace=IS_HOSPITAL?createHospitalSpace(facadeSections):null;
const funfairSpace=IS_FUNFAIR?createFunfairSpace(facadeSections):null;
export const SPACE=freeze(hospitalSpace??funfairSpace??supermarketSpace);
const EPS=1e-6;
export const spaceRampY=(f,z)=>f.baseY+Math.max(0,Math.min(1,(z-f.minZ)/(f.maxZ-f.minZ)))*(f.topY-f.baseY);
export const spaceTreadY=(f,z)=>f.baseY+Math.ceil(Math.max(0,Math.min(1,(z-f.minZ)/(f.maxZ-f.minZ)))*f.steps-1e-8)*(f.topY-f.baseY)/f.steps;
export function spaceFlightAt(x,z,y,radius=0) {
  return SPACE.flights.find(f=>spaceInRect(x,z,{...f,minZ:f.minZ-.4,maxZ:f.maxZ+.9},radius)&&Math.abs(y-spaceTreadY(f,z))<=.38)??null;
}
export function spaceFloor(x,z,belowY=Infinity,radius=0) {
  let best=-Infinity;
  for(const slab of SPACE.slabs) if(slab.maxY<=belowY+EPS&&spaceInRect(x,z,slab,radius))best=Math.max(best,slab.maxY);
  for(const f of SPACE.flights) if(spaceInRect(x,z,f,radius)){const y=spaceTreadY(f,z);if(y<=belowY+EPS)best=Math.max(best,y);}
  return best;
}
export function spaceCeiling(x,z,feetY,radius=0) {
  let low=Infinity;
  for(const slab of SPACE.slabs) if(slab.minY>=feetY-EPS && slab.maxY>feetY+EPS&&spaceInRect(x,z,slab,radius))low=Math.min(low,slab.minY);
  return low;
}
export function spaceCanOccupy(x,z,y,height,radius=0,stepAllowance=0) {
  const on=spaceFlightAt(x,z,y,radius);
  return !SPACE.boxes.some(b=>!(on&&b.flightId&&b.maxY<=y+stepAllowance+EPS)&&!(on&&b.id.startsWith('ground-')&&b.maxY<=y+stepAllowance+EPS)&&spaceInRect(x,z,b,radius)&&y<b.maxY-EPS&&y+height>b.minY+EPS);
}
export function spaceFloorId(point) {
  const f=spaceFlightAt(point.x,point.z,point.y??0);if(f)return 'stair';
  if((point.y??0)<-1.7)return 'cellar';
  if(IS_HOSPITAL||IS_FUNFAIR){
    if(Math.abs(point.x)>LEVEL.halfWidth||Math.abs(point.z)>LEVEL.halfDepth)return 'outside';
    return 'ground';
  }
  if(Math.abs(point.x)>14||Math.abs(point.z)>11)return 'outside';
  return point.x>8?'terrace':'ground';
}
const flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const lower=p=>(p.y??0)<-1.7;
// Where the side rails of each holdLanding flight end at its head (they stand
// at the flight's x edges, from its base). Past them the band's margin still
// reaches on (spaceFlightAt), but the body stands on the upper floor.
const RAIL_HEADS=new Map(SPACE.flights.filter(f=>f.holdLanding).map(f=>[f.id,
  Math.max(f.maxZ,...SPACE.rails.filter(r=>r.baseY===f.baseY&&(r.maxX===f.minX||r.minX===f.maxX)).map(r=>r.maxZ))]));
// The flight a body must still leave through a landing on its way to target.
// A holdLanding flight lets go of a body past its head rails that is bound for
// the upper floor: it has left the flight, and the zombies' visibility graph
// routes it from there. Without this, a route along the corridor wall that
// grazed the head margin handed the body back to the landing it had just
// reached, and it turned there forever. The feet keep their hold: their halls
// lead routes away from the margin, and a boss past the foot rails still
// overlaps the first tread, where the graph cannot start a route.
export function spaceFlightHolding(start,target) {
  const on=spaceFlightAt(start.x,start.z,start.y??0);
  return on&&RAIL_HEADS.has(on.id)&&!lower(target)&&start.z>RAIL_HEADS.get(on.id)?null:on;
}
// Waypoints retain the flight ID until the other landing is behind the feet.
// Same-floor obstacle avoidance remains the visibility graph's responsibility.
export function spaceRoute(start,target) {
  const on=spaceFlightAt(start.x,start.z,start.y??0),to=spaceFlightAt(target.x,target.z,target.y??0);
  if(on){
    if(to?.id===on.id)return [{...target,flightId:on.id}];
    if(spaceFlightHolding(start,target)){
      const landing=lower(target)?on.lower:on.upper;
      return [{...landing,flightId:on.id},...spaceRoute(landing,target)];
    }
  }
  if(to){const landing=lower(start)?to.lower:to.upper;return [{...landing},{...target,flightId:to.id}];}
  if(lower(start)===lower(target))return [{...target}];
  const f=SPACE.flights.reduce((best,candidate)=>{
    const a=lower(start)?candidate.lower:candidate.upper,b=lower(start)?candidate.upper:candidate.lower;
    const cost=flat(start,a)+flat(b,target);return !best||cost<best.cost?{f:candidate,cost}:best;
  },null).f;
  const a=lower(start)?f.lower:f.upper,b=lower(start)?f.upper:f.lower;
  return [{...a},{...b,flightId:f.id},{...target}];
}
// A landing is spent only once the body has left its flight: released while
// the feet are still in the flight's band, the next leg can point back up
// (or down) the steps, and the body shuttles at the foot or the head.
export function spaceWaypoint(start,target) {
  const route=spaceRoute(start,target),on=spaceFlightAt(start.x,start.z,start.y??0);
  while(route.length>1&&flat(start,route[0])<.35&&Math.abs((start.y??0)-route[0].y)<.3&&!(on&&route[0].flightId===on.id))route.shift();
  return route[0];
}
export function spaceRainShelter(position,height=0) {
  if(![position?.x,position?.y,position?.z,height].every(Number.isFinite))return false;
  return SPACE.shelters.some(s=>spaceInRect(position.x,position.z,s)&&position.y+height<=s.minY+EPS);
}
