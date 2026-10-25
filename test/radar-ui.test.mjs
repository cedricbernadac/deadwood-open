import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRadarFrame, projectRadarPoint, radarFloorMarker, radarSupplyStatus, radarLevelOf, createRadarThrottle, createRadarUI, RADAR_PLAN } from '../public/radar-ui.js';
import { RADAR, radarBlipSeconds } from '../public/radar-rules.js';
import { EXTERIOR_WALLS, INTERIOR_WALLS } from '../public/layout.js';
import { enemyAppearance, RAIDER_APPEARANCE } from '../public/enemies.js';
import { setLanguage, t } from '../public/i18n.js';

const snapshot = (level = 3) => ({ wave:8, phase:'wave',
  players:[{id:'self',x:0,y:0,z:0,yaw:Math.PI/2,alive:true,bonus:{radar:level}},{id:'friend',x:4,y:3.4,z:-4,yaw:0,alive:true}],
  zombies:[{id:'near',x:0,y:0,z:-4,hp:80,maxHp:80,kind:'walker'},{id:'edge',x:25,y:3.4,z:0,hp:400,maxHp:400,kind:'armored'},
    {id:'far',x:25.001,y:0,z:0,hp:80,maxHp:80,kind:'walker'},{id:'dead',x:0,y:0,z:3,hp:0,maxHp:80,kind:'walker'}], doors:[] });

test('radar projection uses north at the top, exact inclusive range and distinct off-range ally markers', () => {
  assert.deepEqual(projectRadarPoint({x:0,z:-25},{x:0,z:0}),{x:0,y:-1,distance:25,edge:false});
  assert.equal(projectRadarPoint({x:25.001,z:0},{x:0,z:0}),null);
  assert.deepEqual(projectRadarPoint({x:50,z:0},{x:0,z:0},25,true),{x:1,y:0,distance:50,edge:true});
  assert.equal(projectRadarPoint({x:NaN,z:0},{x:0,z:0}),null);
  assert.equal(projectRadarPoint({x:0,z:0},null),null);
  const frame=buildRadarFrame(snapshot(),'self');
  assert.deepEqual(frame.enemies.map(enemy=>enemy.id),['near','edge']);
  assert.equal(frame.allies[0].heading,-Math.PI/2);
  assert.equal(frame.allies[0].self,true);
  assert.equal(frame.allies[1].self,false);
  assert.deepEqual([frame.x,frame.z],[0,0],'the personal map centres on its owner');
  assert.equal(frame.level,3);
});

test('enemy dots retain maximum-health family colors and visible shapes for armored, crawler, hulks and boss', () => {
  const state=snapshot(8);
  state.zombies=[80,115,165,230,310,400].map((maxHp,index)=>({id:`family-${index}`,x:index,y:0,z:0,hp:1,maxHp,kind:'walker'}));
  state.zombies.push(...['armored','crawler','brute','boss'].map((kind,index)=>({id:kind,x:0,y:0,z:index,hp:1,maxHp:kind==='brute'?1400:80,kind:kind==='boss'?'brute':kind,boss:kind==='boss'})));
  const frame=buildRadarFrame(state,'self');
  frame.enemies.forEach(point=>assert.equal(point.color,`#${enemyAppearance(state.zombies.find(z=>z.id===point.id)).color.toString(16).padStart(6,'0')}`));
  assert.deepEqual(frame.enemies.slice(-4).map(point=>point.shape),['armored','crawler','brute','boss']);
  assert.equal(frame.enemies[0].family,'pale');
  assert.equal(frame.enemies[5].family,'charcoal','wounds do not turn an ash zombie pale');
});

test('raiders are a fixed red faction cross on the radar, never a zombie family, and the legend names them', () => {
  const state=snapshot(8);
  state.zombies=[{id:'r1',x:3,y:0,z:-2,hp:140,maxHp:140,kind:'raider'},{id:'r2',x:-3,y:3.4,z:2,hp:80,maxHp:80,kind:'raider',crouched:true},{id:'r3',x:1,y:0,z:1,hp:0,maxHp:140,kind:'raider'}];
  const frame=buildRadarFrame(state,'self'),red=`#${RAIDER_APPEARANCE.color.toString(16).padStart(6,'0')}`;
  assert.deepEqual(frame.enemies.map(point=>[point.id,point.shape,point.color,point.family]),[['r1','raider',red,'raider'],['r2','raider',red,'raider']],'health never picks a zombie family colour; dead raiders vanish');
  assert.equal(frame.enemies[1].floor,1,'floor marks still apply');
  const strokes=[],texts=[],context=new Proxy({stroke(){strokes.push(this.strokeStyle);},fillText(text){texts.push(text);}},{get:(target,key)=>key in target?target[key]:()=>{}});
  const root={hidden:true,classList:{remove(){},toggle(){}}},legend={};
  const ui=createRadarUI({root,canvas:{getContext:()=>context,setAttribute(){}},title:{},battery:{},legend,translate:t});
  setLanguage('fr');assert.equal(ui.update(state,'self',{now:0,language:'fr'}),true);
  assert.ok(strokes.filter(style=>style===red).length>=2,'each raider is drawn as a red cross');
  assert.ok(texts.includes('↑'),'with its floor mark');
  assert.match(legend.textContent,/✕ pillard/);
  setLanguage('en');ui.update(state,'self',{now:1,language:'en'});assert.match(legend.textContent,/✕ raider/);setLanguage('fr');
});

test('floors are encoded separately from colors and relative to the observing player, including spectators', () => {
  assert.equal(radarFloorMarker(3.4,0),1);
  assert.equal(radarFloorMarker(0,3.4),-1);
  assert.equal(radarFloorMarker(.8,0),0);
  const state=snapshot(8); state.players[0].y=3.4; state.players[0].alive=false;
  const frame=buildRadarFrame(state,'self');
  assert.equal(frame.allies[0].dead,true);
  assert.equal(frame.enemies[0].floor,-1);
  assert.equal(frame.enemies[1].floor,0);
  state.players[0].alive=true;state.players[0].downed=true;
  assert.equal(buildRadarFrame(state,'self').allies[0].downed,true);
});

test('the personal radar needs its owner’s bonus, ignores phases it cannot act in and never expires with waves', () => {
  const state=snapshot(8);
  assert.equal(buildRadarFrame(state,'self',false),null);
  for (const phase of ['lobby','extraction','gameover','victory']) assert.equal(buildRadarFrame({...state,phase},'self'),null);
  assert.ok(buildRadarFrame({...state,phase:'intermission'},'self'));
  assert.ok(buildRadarFrame({...state,phase:'countdown'},'self'));
  assert.ok(buildRadarFrame({...state,wave:19},'self'),'a permanent bonus has no battery');
  assert.ok(buildRadarFrame({...state,practice:true,wave:20},'self'));
  const noRadar=snapshot(); noRadar.players[0].bonus={stone:2};
  assert.equal(buildRadarFrame(noRadar,'self'),null,'another bonus lights no map');
  assert.equal(radarLevelOf(noRadar.players[0]),0);
  assert.equal(radarLevelOf(state.players[0]),8);
  assert.equal(radarLevelOf({bonus:{radar:99}}),RADAR.blipSeconds.length,'levels clamp to the ladder');
  assert.equal(radarLevelOf({bonus:{stone:4,radar:2}}),2,'stacked bonuses still expose the radar');
});

test('radar crate eligibility follows the unlock wave and every player may carry their own', () => {
  const state=snapshot(8);
  assert.equal(radarSupplyStatus({...state,wave:RADAR.unlockWave-1},{bonus:null}),'locked');
  assert.equal(radarSupplyStatus({...state,wave:RADAR.unlockWave-1,practice:true},{bonus:null}),'available','practice ignores the wave gate');
  assert.equal(radarSupplyStatus({...state,wave:RADAR.unlockWave},{bonus:null}),'available');
  assert.equal(radarSupplyStatus(state,{bonus:{radar:4}}),'available','a carried radar blocks no teammate');
});

test('the map blips on the level’s rhythm and level eight reads as continuous', () => {
  const context=new Proxy({},{get:(target,key)=>key in target?target[key]:()=>{}});
  const root={hidden:true,classList:{remove(){},toggle(){}}};
  const battery={},ui=createRadarUI({root,canvas:{getContext:()=>context,setAttribute(){}},title:{},battery,legend:{},translate:t});
  const level1=snapshot(1);
  assert.equal(ui.update(level1,'self',{now:0}),true);
  assert.equal(root.hidden,false);
  assert.match(battery.textContent,/UN PLAN TOUTES LES 8 S/);
  assert.equal(ui.update(level1,'self',{now:1500,force:true}),true,'still lit at 1.5 s inside the visible window');
  assert.equal(ui.update(level1,'self',{now:2500,force:true}),false,'dark after the two-second flash');
  assert.equal(root.hidden,true);
  assert.equal(ui.update(level1,'self',{now:8000,force:true}),true,'the next blip relights the map');
  const level8=snapshot(RADAR.blipSeconds.length);
  for (const now of [0,1500,2500,3200]) {
    assert.equal(ui.update(level8,'self',{now,force:true}),true,`level eight stays lit at ${now} ms`);
    assert.equal(root.hidden,false);
  }
  assert.match(battery.textContent,/PLAN EN CONTINU/);
  ui.reset();assert.equal(root.hidden,true);
});

test('radar refresh is bounded to five paints per second and changes/reset repaint immediately', () => {
  const throttle=createRadarThrottle();let count=0;
  for(let now=0;now<1000;now+=10)count+=Number(throttle.ready(now,'r1'));
  assert.equal(count,5);
  assert.equal(throttle.ready(995,'r1'),false);
  assert.equal(throttle.ready(995,'r2'),true);
  assert.equal(throttle.ready(996,'r2',true),true);
  throttle.reset();assert.equal(throttle.ready(997,'r2'),true);
  assert.equal(throttle.ready(NaN,'r2'),false);
  assert.deepEqual(RADAR.blipSeconds,[8,7,6,5,4,3,2,.2]);
  assert.equal(radarBlipSeconds(8),.2);
});

test('static plan preserves shared exterior wall gaps and interior partition bounds', () => {
  assert.equal(RADAR_PLAN.interior,INTERIOR_WALLS);
  for(const wall of EXTERIOR_WALLS){
    const along=RADAR_PLAN.exterior.filter(segment=>wall.axis==='x'?segment.z1===wall.fixed&&segment.z2===wall.fixed:segment.x1===wall.fixed&&segment.x2===wall.fixed);
    assert.ok(along.length>=2);
    assert.ok(along.every(segment=>wall.axis==='x'?segment.x2<=-1.3||segment.x1>=1.3:segment.z2<=-1.3||segment.z1>=1.3),'door opening is not a solid drawn wall');
  }
});

function rendererHarness() {
  const calls=[],strokes=[];let path=[];
  const context=new Proxy({clearRect(){calls.push('clear');},fillText(text){calls.push(text);},
    beginPath(){path=[];},moveTo(x,y){path.push(['move',x,y]);},lineTo(x,y){path.push(['line',x,y]);},
    stroke(){strokes.push({path:[...path],color:this.strokeStyle,width:this.lineWidth});}}, {get:(target,key)=>key in target?target[key]:()=>{}});
  const classes=new Set();
  const root={hidden:true,classList:{remove:key=>classes.delete(key),toggle(key,on){on?classes.add(key):classes.delete(key);}}};
  const canvas={getContext:()=>context,setAttribute(key,value){this[key]=value;}};
  const title={},battery={},legend={};
  const renderer=createRadarUI({root,canvas,title,battery,legend,translate:t,pixelRatio:3});
  return {renderer,root,canvas,title,battery,legend,classes,calls,strokes};
}

test('sealed entrances join the radar walls without metallic styling while active barricades keep their states', () => {
  const ui=rendererHarness(),state=snapshot();
  state.doors=[{id:'north',x:0,z:-6,sealed:true,hp:0},{id:'south',x:0,z:6,sealed:false,hp:200},
    {id:'east',x:8,z:0,sealed:false,hp:0},{id:'west',x:-8,z:0,sealed:true,hp:200}];
  ui.renderer.update(state,'self',{now:0});
  const project=value=>112+value/25*94;
  for(const door of state.doors){
    const alongX=door.id==='north'||door.id==='south';
    const path=[['move',project(door.x-(alongX?1.3:0)),project(door.z-(alongX?0:1.3))],
      ['line',project(door.x+(alongX?1.3:0)),project(door.z+(alongX?0:1.3))]];
    const stroke=ui.strokes.find(stroke=>JSON.stringify(stroke.path)===JSON.stringify(path));
    assert.ok(stroke,door.id);
    assert.equal(stroke.width,2,door.id);
    assert.equal(stroke.color,door.sealed?'#90a68e':door.hp>0?'#caaa6c':'#d36f50',door.id);
    if(door.sealed) assert.ok(ui.strokes.some(wall=>wall.color===stroke.color&&wall.width===stroke.width&&wall!==stroke), 'same wall style');
  }
});

test('canvas lifecycle uses a single bounded buffer, hides immediately and repaints cleanly on restart and language change', () => {
  setLanguage('fr');const ui=rendererHarness(),state=snapshot(2);
  assert.equal(ui.canvas.width,336);
  assert.equal(ui.renderer.update(state,'self',{now:0,language:'fr'}),true);
  assert.equal(ui.root.hidden,false);
  assert.match(ui.title.textContent,/25 m/);
  assert.match(ui.battery.textContent,/NIVEAU 2 · UN PLAN TOUTES LES 7 S/);
  assert.equal(ui.renderer.update(state,'self',{now:50,paused:true,language:'fr'}),false);
  assert.ok(ui.classes.has('radar-paused'));
  const before=ui.calls.length;
  const gone=snapshot(); gone.players[0].bonus=null;
  assert.equal(ui.renderer.update(gone,'self',{now:100,force:true}),false);
  assert.equal(ui.root.hidden,true);assert.equal(ui.calls.length,before+1);
  ui.renderer.update(snapshot(3),'self',{now:1400,language:'fr',force:true});
  setLanguage('en');ui.renderer.update(state,'self',{now:1600,language:'en',force:true});
  assert.match(ui.battery.textContent,/LEVEL 2 · A MAP EVERY 7 S/);
  assert.match(ui.canvas['aria-label'],/north at the top/);
  ui.renderer.reset();assert.equal(ui.root.hidden,true);setLanguage('fr');
});
