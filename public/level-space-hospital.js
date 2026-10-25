import { LEVEL } from './level-config.js';

const rect = (minX,maxX,minZ,maxZ) => ({minX,maxX,minZ,maxZ});
// holdLanding: a body leaves these flights only at their landing (level-space.js
// spaceWaypoint). Without it a zombie bound for a room behind a stair foot or
// head spent the landing while still on the bottom or top tread, walked
// straight at its target, back onto the flight, and shuttled there forever.
const flight = (id,minX,maxX,minZ,maxZ) => ({id,...rect(minX,maxX,minZ,maxZ),baseY:-3.4,topY:0,steps:20,treadThickness:.17,holdLanding:true,
  well:rect(minX-.3,maxX+.3,minZ-.35,maxZ+.55),
  lower:{x:(minX+maxX)/2,y:-3.4,z:minZ-.65},upper:{x:(minX+maxX)/2,y:0,z:maxZ+1.05}});
const prop = (id,kind,cx,cz,sx,sz,height) => ({id,kind,...rect(cx-sx/2,cx+sx/2,cz-sz/2,cz+sz/2),minY:0,maxY:height});
// The car park's bus shelter (owner, 24 October: a real rain shelter), 4.5 m
// off the east facade, its open end facing the east door 6-10 m away so a
// companion's trip out of that door reaches its roof. Colliders: the back
// wall on the north side with both back posts and the timetable, the glazed
// east side with its front post (it overlaps the back wall's east post), a
// lone front post at the open west end and a bench against the back wall;
// the south front and the west end are open. The roof is a slab 2.56 m up
// (the 2.52 m colossus walks under it) listed in SPACE.shelters, so the rain
// and the companions treat its footprint as dry; the bench seat is a slab
// too, so a body that jumps onto the bench stands on it instead of sinking
// into its collider.
export const BUS_SHELTER = Object.freeze({id:'bus-shelter-east',...rect(24.5,28.5,7.2,9),roofY:2.56,roofTop:2.62,
  roof:Object.freeze(rect(24.4,28.6,7.1,9.3)),seatY:.48});
function busShelterParts(s) {
  const mm=value=>Math.round(value*1000)/1000;
  const part=(name,kind,minX,maxX,minZ,maxZ,maxY)=>({id:`prop-${s.id}-${name}`,kind,shelter:s.id,...rect(mm(minX),mm(maxX),mm(minZ),mm(maxZ)),minY:0,maxY});
  return [
    part('back','bus-shelter-back',s.minX,s.maxX,s.minZ,s.minZ+.14,s.roofY),
    part('side','bus-shelter-side',s.maxX-.1,s.maxX,s.minZ+.1,s.maxZ,s.roofY),
    part('post','bus-shelter-post',s.minX,s.minX+.1,s.maxZ-.1,s.maxZ,s.roofY),
    part('bench','bus-shelter-bench',s.minX+.5,s.maxX-.5,s.minZ+.14,s.minZ+.54,s.seatY),
  ];
}
function subtract(bounds,hole) {
  const a=Math.max(bounds.minX,hole.minX),b=Math.min(bounds.maxX,hole.maxX),c=Math.max(bounds.minZ,hole.minZ),d=Math.min(bounds.maxZ,hole.maxZ);
  if(a>=b||c>=d)return [bounds];
  return [rect(bounds.minX,a,bounds.minZ,bounds.maxZ),rect(b,bounds.maxX,bounds.minZ,bounds.maxZ),rect(a,b,bounds.minZ,c),rect(a,b,d,bounds.maxZ)].filter(r=>r.maxX>r.minX&&r.maxZ>r.minZ);
}

// Real rooms (second pass). Partitions are SPACE.walls like the cellar's
// retaining walls, so authority, prediction, the zombies' visibility graph,
// companions, melee sight, Frisson stains and the radar all see them. Every
// doorway is at least 1.4 m wide and 2.7 m high: the colossus is 2.52 m tall
// (1.91 x 1.32), so its lintel never reaches a body. Ground partitions stop
// under the suspended ceiling (3.2 m), cellar partitions under the slab.
const INSIDE = rect(-19.865,19.865,-14.865,14.865);
const DOOR_HEIGHT = 2.7;
const GROUND = {floor:'ground',baseY:0,height:3.2,half:.08};
const CELLAR = {floor:'cellar',baseY:-3.4,height:3.16,half:.1};
export const HOSPITAL_CEILING = Object.freeze({minY:3.2,maxY:3.26});

function partitions() {
  const walls=[],doors=[];
  // One straight partition: axis 'x' runs along x at z=at, axis 'z' along z at x=at.
  function run(room,id,axis,at,from,to,level,openings=[]) {
    const {baseY,height,half}=level;
    const piece=(suffix,a,b,low,high)=>{
      if(b-a<1e-9)return;
      const r=axis==='x'?rect(a,b,at-half,at+half):rect(at-half,at+half,a,b);
      walls.push({id:`room-${room}-${id}${suffix}`,...r,baseY:low,height:Math.round((high-low)*1e6)/1e6});
    };
    let cursor=from,count=0;
    for(const opening of [...openings].sort((p,q)=>p.center-q.center)){
      const a=opening.center-opening.width/2,b=opening.center+opening.width/2;
      piece(`-${++count}`,cursor,a,baseY,baseY+height);
      piece(`-lintel-${opening.id}`,a,b,baseY+DOOR_HEIGHT,baseY+height);
      doors.push({id:opening.id,room,axis,x:axis==='x'?opening.center:at,z:axis==='x'?at:opening.center,width:opening.width,height:DOOR_HEIGHT,floorY:baseY,...(opening.internal?{internal:true}:{})});
      cursor=b;
    }
    piece(openings.length?`-${++count}`:'',cursor,to,baseY,baseY+height);
  }
  const door=(id,center,width,internal=false)=>({id,center,width,...(internal?{internal:true}:{})});
  const {minX:X0,maxX:X1,minZ:Z0,maxZ:Z1}=INSIDE;
  // Ground floor. The west ambulance door opens directly into the emergency
  // department; its eastern doorway joins the corridor spine to the service
  // door. Reception and waiting, the ward and theatre stay north of the spine.
  run('reception','south-w','x',-2.8,X0,-16.9,GROUND);
  run('reception','south','x',-2.8,-13.3,-2.52,GROUND,[door('reception-corridor',-10.6,2)]);
  run('reception','east','z',-2.6,Z0,-2.88,GROUND,[door('reception-hall',-8,2.8)]);
  run('ward','west','z',2.6,Z0,-2.88,GROUND,[door('ward-hall',-6.4,1.8)]);
  run('ward','south','x',-2.8,2.52,10.42,GROUND,[door('ward-corridor',9.55,1.5)]);
  run('theatre','west','z',10.5,Z0,-2.88,GROUND);
  run('theatre','south','x',-2.8,10.42,X1,GROUND,[door('theatre-corridor',14.4,2.4)]);
  run('emergency','north','x',4.2,X0,-4.32,GROUND,[door('emergency-bay',-13.4,7.2,true)]);
  run('emergency','east','z',-4.4,-2.88,Z1,GROUND,[door('emergency-east',0,2.2),door('emergency-hall',11.5,1.8)]);
  run('chapel','north','x',4.2,2.52,10.58,GROUND,[door('chapel-corridor',9.3,1.8)]);
  run('chapel','west','z',2.6,4.28,Z1,GROUND);
  run('chapel','east','z',10.5,4.28,Z1,GROUND);
  // Glazed vestibule inside the main door: a 1 m solid kick panel each side of
  // a 2.6 m opening facing the doorway; the broken glazing above it is art only.
  for(const [id,a,b] of [['west',-2.52,-1.3],['east',1.3,2.52]])walls.push({id:`hall-vestibule-${id}`,...rect(a,b,-12.48,-12.32),baseY:0,height:1});
  // Basement: a corridor between z=-2.6 and z=2.6 with the refuge passage
  // north of it and a matching passage south; the main stair foot keeps its
  // own hall west of the pharmacy, the service stair foot opens on the corridor.
  run('pharmacy','south','x',-2.6,-13.3,-2.5,CELLAR,[door('pharmacy-corridor',-4.7,1.8)]);
  run('pharmacy','west','z',-13.2,-14,-2.7,CELLAR,[door('pharmacy-stairs',-12.7,1.8)]);
  run('pharmacy','east','z',-2.6,-14,-2.7,CELLAR);
  run('archives','south','x',-2.6,1.9,19,CELLAR,[door('archives-corridor',13.3,1.8)]);
  run('archives','west','z',2,-14,-2.7,CELLAR,[door('archives-refuge',-12.7,1.8)]);
  run('linen','north','x',2.6,-19,-2.5,CELLAR,[door('linen-corridor',-8.3,1.8)]);
  run('linen','east','z',-2.6,2.7,14,CELLAR,[door('linen-passage',5.1,1.8)]);
  run('boiler','north','x',2.6,1.9,12.98,CELLAR,[door('boiler-corridor',9.5,1.8)]);
  run('boiler','west','z',2,2.7,14,CELLAR,[door('boiler-passage',4.3,1.8)]);
  run('boiler','east','z',12.88,2.7,14,CELLAR);
  const ambulance = LEVEL.doors.find(item => item.id === 'west');
  doors.push({id:'emergency-ambulance',room:'emergency',axis:'z',x:ambulance.x,z:ambulance.z,width:2.6,height:2.8,floorY:0,exterior:true});
  const room=(id,floor,label,bounds,target)=>({id,floor,label,bounds,target:{...target,y:floor==='ground'?0:-3.4},doors:doors.filter(item=>item.room===id).map(({room,...item})=>item)});
  const rooms=[
    room('reception','ground',{fr:'ACCUEIL / ATTENTE',en:'RECEPTION / WAITING'},rect(X0,-2.68,Z0,-2.88),{x:-15,z:-12.2}),
    room('ward','ground',{fr:'HOSPITALISATION',en:'WARD'},rect(2.68,10.42,Z0,-2.88),{x:7,z:-11.2}),
    room('theatre','ground',{fr:'BLOC OPÉRATOIRE',en:'OPERATING THEATRE'},rect(10.58,X1,Z0,-2.88),{x:17,z:-12.4}),
    room('emergency','ground',{fr:'URGENCES',en:'EMERGENCY'},rect(X0,-4.48,-2.88,Z1),{x:-12,z:11.8}),
    room('chapel','ground',{fr:'CHAPELLE',en:'CHAPEL'},rect(2.68,10.42,4.28,Z1),{x:9.2,z:8}),
    room('pharmacy','cellar',{fr:'PHARMACIE',en:'PHARMACY'},rect(-13.1,-2.7,-14,-2.7),{x:-9.3,z:-12.6}),
    room('archives','cellar',{fr:'ARCHIVES',en:'ARCHIVES'},rect(2.1,19,-14,-2.7),{x:15,z:-10.5}),
    room('linen','cellar',{fr:'LINGERIE',en:'LINEN'},rect(-19,-2.7,2.7,14),{x:-15,z:8}),
    room('boiler','cellar',{fr:'CHAUFFERIE',en:'BOILER ROOM'},rect(2.1,12.78,2.7,14),{x:6.2,z:12.9}),
  ];
  return {walls,rooms};
}

export function createHospitalSpace(facadeSections) {
  const flights=[flight('main-stair',-16.6,-13.6,-9,-2),flight('service-stair',13.2,16.2,4,11)];
  const holes=flights.map(f=>f.well);
  const groundPieces=holes.reduce((pieces,hole)=>pieces.flatMap(piece=>subtract(piece,hole)),[rect(-160,160,-84,84)]);
  const slabs=groundPieces.map((r,i)=>({id:`ground-slab-${i}`,...r,minY:-.24,maxY:0}));
  for(const f of flights)slabs.push({id:`ground-upper-apron-${f.id}`,...rect(f.well.minX,f.well.maxX,f.maxZ,f.well.maxZ),minY:-.24,maxY:0});
  slabs.push({id:'cellar-slab',...rect(-19,19,-14,14),minY:-3.64,maxY:-3.4});
  slabs.push({id:'ambulance-bay-canopy',...rect(-22.8,-19.86,-3.5,10.6),minY:3.2,maxY:3.44});
  // Cantilevered entrance canopy over the main (north) door: a rain shelter too.
  slabs.push({id:'entrance-canopy',...rect(-3.4,3.4,-17.75,-15.135),minY:3,maxY:3.2});
  slabs.push({id:`${BUS_SHELTER.id}-roof`,...BUS_SHELTER.roof,minY:BUS_SHELTER.roofY,maxY:BUS_SHELTER.roofTop});
  const bench=busShelterParts(BUS_SHELTER).find(item=>item.kind==='bus-shelter-bench');
  slabs.push({id:`${BUS_SHELTER.id}-seat`,...rect(bench.minX,bench.maxX,bench.minZ,bench.maxZ),minY:BUS_SHELTER.seatY-.04,maxY:BUS_SHELTER.seatY});
  // Suspended ceiling over the whole ground floor, open above both stair wells
  // (their light shafts rise to the roof). A solid: grenades and shots stop on it.
  const ceiling=holes.reduce((pieces,hole)=>pieces.flatMap(piece=>subtract(piece,hole)),[INSIDE]);
  ceiling.forEach((r,i)=>slabs.push({id:`ceiling-${i}`,...r,...HOSPITAL_CEILING}));
  const {walls:rooms_walls,rooms}=partitions();
  const walls=[
    {id:'cellar-west',...rect(-19.24,-19,-14.24,14.24),baseY:-3.4,height:3.4},
    {id:'cellar-east',...rect(19,19.24,-14.24,14.24),baseY:-3.4,height:3.4},
    {id:'cellar-north',...rect(-19,19,-14.24,-14),baseY:-3.4,height:3.4},
    {id:'cellar-south',...rect(-19,19,14,14.24),baseY:-3.4,height:3.4},
    ...rooms_walls,
  ];
  const rails=flights.flatMap(f=>[
    {id:`${f.id}-west`,...rect(f.minX-.22,f.minX,f.minZ-.3,f.maxZ+.5),baseY:-3.4,height:4.45},
    {id:`${f.id}-east`,...rect(f.maxX,f.maxX+.22,f.minZ-.3,f.maxZ+.5),baseY:-3.4,height:4.45},
    {id:`${f.id}-low-end`,...rect(f.minX-.22,f.maxX+.22,f.minZ-.35,f.minZ-.15),baseY:-.24,height:1.29},
  ]);
  const treads=flights.flatMap(f=>Array.from({length:f.steps},(_,i)=>({id:`${f.id}-tread-${i}`,flightId:f.id,
    minX:f.minX,maxX:f.maxX,minZ:f.minZ+i*(f.maxZ-f.minZ)/f.steps,maxZ:f.minZ+(i+1)*(f.maxZ-f.minZ)/f.steps,
    minY:f.baseY,maxY:f.baseY+(i+1)*(f.topY-f.baseY)/f.steps})));
  const props=[
    prop('prop-car-south-west','car',-13,22,1.9,4.4,1.45),
    prop('prop-car-south-east','car',12.5,23,1.9,4.4,1.45),
    prop('prop-car-north','car',14,-21,1.9,4.4,1.45),
    prop('prop-ambulance-west','ambulance',-27,10,5.4,2.2,2.45),
    ...busShelterParts(BUS_SHELTER),
    prop('prop-hospital-sign','sign',-11,-19,4,.5,3.2),
    prop('prop-hedge-south-west','hedge',-18,18,1.2,5,1.2),
    prop('prop-hedge-south-east','hedge',18,18,1.2,5,1.2),
    prop('prop-hedge-north-west','hedge',-18,-18,1.2,5,1.2),
    prop('prop-lamp-south-west','lamp',-8,18,.28,.28,5.8),
    prop('prop-lamp-south-east','lamp',8,18,.28,.28,5.8),
    prop('prop-lamp-north-west','lamp',-23,-12,.28,.28,5.8),
    prop('prop-lamp-north-east','lamp',23,-12,.28,.28,5.8),
  ];
  const boxes=[...slabs,...walls.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...rails.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...treads,...props];
  return {id:'hospital-depth',minY:-3.4,flights,holes,slabs,walls,rails,treads,props,boxes,
    facadeSections,rooms,
    floors:[{id:'ground',...rect(-20,20,-15,15),y:0},{id:'cellar',...rect(-19,19,-14,14),y:-3.4}],
    shelters:[{id:'hospital-roof',...rect(-20.38,20.38,-15.5,15.5),minY:6.26,maxY:6.5},...slabs.filter(s=>s.maxY===0||s.id==='ambulance-bay-canopy'||s.id==='entrance-canopy'||s.id===`${BUS_SHELTER.id}-roof`)],
    refuge:{x:0,y:-3.4,z:-6},watch:{x:-15.1,y:-1.53,z:-5.35},
  };
}
