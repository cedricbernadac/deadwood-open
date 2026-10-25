const rect = (minX,maxX,minZ,maxZ) => ({minX,maxX,minZ,maxZ});
// Same flight contract as the hospital: holdLanding keeps a body on the flight
// until it crosses the landing, so routes never shuttle at the head or foot.
const flight = (id,minX,maxX,minZ,maxZ) => ({id,...rect(minX,maxX,minZ,maxZ),baseY:-3.4,topY:0,steps:20,treadThickness:.17,holdLanding:true,
  well:rect(minX-.3,maxX+.3,minZ-.35,maxZ+.55),
  lower:{x:(minX+maxX)/2,y:-3.4,z:minZ-.65},upper:{x:(minX+maxX)/2,y:0,z:maxZ+1.05}});
const prop = (id,kind,cx,cz,sx,sz,height) => ({id,kind,...rect(cx-sx/2,cx+sx/2,cz-sz/2,cz+sz/2),minY:0,maxY:height});
function subtract(bounds,hole) {
  const a=Math.max(bounds.minX,hole.minX),b=Math.min(bounds.maxX,hole.maxX),c=Math.max(bounds.minZ,hole.minZ),d=Math.min(bounds.maxZ,hole.maxZ);
  if(a>=b||c>=d)return [bounds];
  return [rect(bounds.minX,a,bounds.minZ,bounds.maxZ),rect(b,bounds.maxX,bounds.minZ,bounds.maxZ),rect(a,b,bounds.minZ,c),rect(a,b,d,bounds.maxZ)].filter(r=>r.maxX>r.minX&&r.maxZ>r.minZ);
}

// La Fête Foraine: the Grand Palais des Jeux (36 x 26 m) over a salle des
// machines (34 x 24 m at -3.4 m). Real partitions like the hospital's, seen
// by authority, prediction, the zombies' visibility graph, companions and the
// radar. Every doorway is at least 1.4 m wide and 2.7 m high so the colossus
// (2.52 m) passes. Ground partitions stop under the 3.2 m suspended ceiling,
// cellar partitions under the ground slab.
const INSIDE = rect(-17.865,17.865,-12.865,12.865);
const DOOR_HEIGHT = 2.7;
const GROUND = {floor:'ground',baseY:0,height:3.2,half:.08};
const CELLAR = {floor:'cellar',baseY:-3.4,height:3.16,half:.1};
export const FUNFAIR_CEILING = Object.freeze({minY:3.2,maxY:3.26});

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
      doors.push({id:opening.id,room,axis,x:axis==='x'?opening.center:at,z:axis==='x'?at:opening.center,width:opening.width,height:DOOR_HEIGHT,floorY:baseY});
      cursor=b;
    }
    piece(openings.length?`-${++count}`:'',cursor,to,baseY,baseY+height);
  }
  const door=(id,center,width)=>({id,center,width});
  const {minX:X0,maxX:X1,minZ:Z0,maxZ:Z1}=INSIDE;
  // Ground floor. A corridor spine between z=-2.4 and z=4.4 links the west and
  // east doors; halls cross it from the north and south doors. The admit grid
  // (x -5..1.6, z -.3..3.7) stays inside the spine. North side: the caisse
  // wraps the main stair void (the stair passes through a gap in its south
  // wall, like the hospital's reception), then the games room and the prize
  // counter. South side: the confiserie, the bumper-car arcade west of the
  // service stair, and an open south-east hall around that stair's head.
  run('caisse','south-w','x',-2.4,X0,-14.9,GROUND);
  run('caisse','south-e','x',-2.4,-11.3,-2.6,GROUND,[door('caisse-corridor',-6,1.8)]);
  run('caisse','east','z',-2.6,Z0,-2.48,GROUND,[door('caisse-hall',-7,2.4)]);
  run('jeux','west','z',2.6,Z0,-2.48,GROUND,[door('jeux-hall',-7,2)]);
  run('jeux','south','x',-2.4,2.52,9.4,GROUND,[door('jeux-corridor',6,1.8)]);
  run('lots','west','z',9.4,Z0,-2.48,GROUND,[door('lots-jeux',-8,1.8)]);
  run('lots','south','x',-2.4,9.32,X1,GROUND,[door('lots-corridor',13,2.4)]);
  run('confiserie','north','x',4.4,X0,-2.48,GROUND,[door('confiserie-corridor',-10,2.4)]);
  run('confiserie','east','z',-2.4,4.48,Z1,GROUND,[door('confiserie-hall',8.5,2)]);
  run('arcade','west','z',2.4,4.48,Z1,GROUND,[door('arcade-hall',8.5,1.8)]);
  run('arcade','north','x',4.4,2.48,10.9,GROUND,[door('arcade-corridor',6,2.4)]);
  run('arcade','east','z',10.9,4.4,Z1,GROUND);
  // Basement: a corridor between z=-2.4 and z=2.4 with a north and a south
  // passage. The refuge wraps the main stair foot (its tread columns close the
  // gap in the refuge's south wall at cellar level), the shooting gallery lies
  // north-east, the mirror maze south-west, the machine room west of the
  // service stair; that stair's foot strip stays open corridor space, like the
  // hospital's service stair strip.
  run('refuge','south-w','x',-2.4,-17,-14.9,CELLAR);
  run('refuge','south-e','x',-2.4,-11.3,-2.6,CELLAR,[door('refuge-corridor',-6,1.8)]);
  run('refuge','east','z',-2.6,-12,-2.5,CELLAR);
  run('tir','west','z',2.6,-12,-2.5,CELLAR,[door('tir-passage',-7,1.8)]);
  run('tir','south','x',-2.4,2.52,17,CELLAR,[door('tir-corridor',9.8,2.4)]);
  run('miroirs','north','x',2.4,-17,-2.52,CELLAR,[door('miroirs-corridor',-9,2.4)]);
  run('miroirs','east','z',-2.6,2.5,12,CELLAR);
  run('machines','north','x',2.4,2.52,10.9,CELLAR,[door('machines-corridor',6,1.8)]);
  run('machines','west','z',2.6,2.5,12,CELLAR);
  run('machines','east','z',10.9,2.4,12,CELLAR);
  const room=(id,floor,label,bounds,target)=>({id,floor,label,bounds,target:{...target,y:floor==='ground'?0:-3.4},doors:doors.filter(item=>item.room===id).map(({room,...item})=>item)});
  const rooms=[
    room('caisse','ground',{fr:'CAISSE',en:'TICKET BOOTH'},rect(X0,-2.6,Z0,-2.4),{x:-12.9,z:-10.6}),
    room('jeux','ground',{fr:'SALLE DE JEUX',en:'GAMES ROOM'},rect(2.6,9.4,Z0,-2.4),{x:6,z:-6}),
    room('lots','ground',{fr:'LOTS',en:'PRIZE COUNTER'},rect(9.4,X1,Z0,-2.4),{x:13.5,z:-9}),
    room('confiserie','ground',{fr:'CONFISERIE',en:'SNACK BAR'},rect(X0,-2.4,4.4,Z1),{x:-14,z:10}),
    room('arcade','ground',{fr:'AUTOS TAMPONNEUSES',en:'BUMPER CARS'},rect(2.4,10.9,4.4,Z1),{x:6,z:5.5}),
    room('refuge','cellar',{fr:'REFUGE',en:'REFUGE'},rect(-17,-2.6,-12,-2.4),{x:-6,z:-7}),
    room('tir','cellar',{fr:'TIR',en:'SHOOTING GALLERY'},rect(2.6,17,-12,-2.4),{x:9.8,z:-7}),
    room('miroirs','cellar',{fr:'PALAIS DES GLACES',en:'MIRROR MAZE'},rect(-17,-2.6,2.4,12),{x:-12,z:9}),
    room('machines','cellar',{fr:'SALLE DES MACHINES',en:'MACHINE ROOM'},rect(2.6,10.9,2.4,12),{x:6,z:6}),
  ];
  return {walls,rooms};
}

export function createFunfairSpace(facadeSections) {
  const flights=[flight('main-stair',-14.6,-11.6,-8,-1),flight('service-stair',11.2,14.2,3,10)];
  const holes=flights.map(f=>f.well);
  const groundPieces=holes.reduce((pieces,hole)=>pieces.flatMap(piece=>subtract(piece,hole)),[rect(-160,160,-84,84)]);
  const slabs=groundPieces.map((r,i)=>({id:`ground-slab-${i}`,...r,minY:-.24,maxY:0}));
  for(const f of flights)slabs.push({id:`ground-upper-apron-${f.id}`,...rect(f.well.minX,f.well.maxX,f.maxZ,f.well.maxZ),minY:-.24,maxY:0});
  slabs.push({id:'cellar-slab',...rect(-17,17,-12,12),minY:-3.64,maxY:-3.4});
  // Cantilevered canopy over the main (north) door, under the ticket arch: a
  // rain shelter too. The carousel and stall canopies below are rain-only.
  slabs.push({id:'entrance-canopy',...rect(-3.4,3.4,-15.9,-13.135),minY:3,maxY:3.2});
  // Suspended ceiling over the whole ground floor, open above both stair wells
  // (their light shafts rise to the roof). A solid: grenades and shots stop on it.
  const ceiling=holes.reduce((pieces,hole)=>pieces.flatMap(piece=>subtract(piece,hole)),[INSIDE]);
  ceiling.forEach((r,i)=>slabs.push({id:`ceiling-${i}`,...r,...FUNFAIR_CEILING}));
  const {walls:rooms_walls,rooms}=partitions();
  const walls=[
    {id:'cellar-west',...rect(-17.24,-17,-12.24,12.24),baseY:-3.4,height:3.4},
    {id:'cellar-east',...rect(17,17.24,-12.24,12.24),baseY:-3.4,height:3.4},
    {id:'cellar-north',...rect(-17,17,-12.24,-12),baseY:-3.4,height:3.4},
    {id:'cellar-south',...rect(-17,17,12,12.24),baseY:-3.4,height:3.4},
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
  // Solid outdoor props of the fair. Axis-aligned boxes the Blender art fills
  // exactly; each is at least 1 m tall (the jump apex is 0.87 m), and every
  // scripted route (spawn, raid and far entries, supply caches) keeps clear.
  // The Ferris wheel is scenery outside the playable bounds and needs no prop.
  const props=[
    prop('prop-carousel-base','carousel',-26,20,8,8,1.1),
    prop('prop-stall-west','stall',-13.5,-17.75,5,2.5,2.4),
    prop('prop-stall-east','stall',13.5,-17.75,5,2.5,2.4),
    prop('prop-caravan-west','caravan',-27,-9,5,2.2,2.6),
    prop('prop-caravan-south','caravan',10,20,5,2.2,2.6),
    prop('prop-lorry-east','lorry',26,8,6,2.2,3),
    prop('prop-arch-west','arch-support',-2.2,-15.5,.4,.4,4),
    prop('prop-arch-east','arch-support',2.2,-15.5,.4,.4,4),
    prop('prop-fence-north-west','fence',-13,-22,14,.2,1.4),
    prop('prop-fence-north-east','fence',13,-22,14,.2,1.4),
    prop('prop-lamp-sw','lamp',-8,16,.28,.28,5.8),
    prop('prop-lamp-se','lamp',8,16,.28,.28,5.8),
    prop('prop-lamp-nw','lamp',-20,-14,.28,.28,5.8),
    prop('prop-lamp-ne','lamp',20,-14,.28,.28,5.8),
  ];
  const boxes=[...slabs,...walls.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...rails.map(w=>({...w,minY:w.baseY,maxY:w.baseY+w.height})),...treads,...props];
  return {id:'funfair-depth',minY:-3.4,flights,holes,slabs,walls,rails,treads,props,boxes,
    facadeSections,rooms,
    floors:[{id:'ground',...rect(-18,18,-13,13),y:0},{id:'cellar',...rect(-17,17,-12,12),y:-3.4}],
    shelters:[
      {id:'funfair-roof',...rect(-18.38,18.38,-13.5,13.5),minY:6.26,maxY:6.5},
      ...slabs.filter(s=>s.maxY===0||s.id.includes('canopy')),
      {id:'carousel-canopy',...rect(-31.5,-20.5,14.5,25.5),minY:3,maxY:3.3},
      {id:'stall-canopy-west',...rect(-17.4,-9.6,-20.4,-15.1),minY:2.6,maxY:2.9},
      {id:'stall-canopy-east',...rect(9.6,17.4,-20.4,-15.1),minY:2.6,maxY:2.9},
    ],
    refuge:{x:-6,y:-3.4,z:-7},watch:{x:-13.1,y:-1.7,z:-4.5},
  };
}
