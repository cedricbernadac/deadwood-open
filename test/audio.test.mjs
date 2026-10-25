import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { SoundEngine } from '../public/audio.js';
import { MINIGUN_TIMING, FIRE_INTERVALS, MAX_WAVES, MELEE_WEAPONS } from '../public/rules.js';
import { MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME } from '../public/music-themes.js';

test('two hands reload the same selected take in parallel and cancelling one preserves the other',async()=>{
  const {engine,ctx}=setup({effects:{reloadPistol:[{src:'/audio/dual-reload.wav',gain:.3}]}});
  await engine.unlock();await engine.prepareEffect('reloadPistol');
  assert.equal(engine.reload('pistol',.8,{voiceId:'actor'}),true);
  const first=engine.reloadVoices.get('actor'),source=[...first.sources][0];
  assert.equal(engine.reload('pistol',1,{voiceId:'actor:secondary'}),true);
  const second=engine.reloadVoices.get('actor:secondary'),other=[...second.sources][0];
  assert.notEqual(first,second);assert.notEqual(source,other);assert.equal(source.buffer,other.buffer);
  assert.equal(source.playbackRate.value,1);assert.equal(other.playbackRate.value,1);
  assert.equal([...first.levels][0].gain.events[0][1],.3);assert.equal([...second.levels][0].gain.events[0][1],.3);
  const allocated=ctx.nodes.length;
  assert.equal(engine.reload('pistol',1,{voiceId:'actor:secondary'}),false);assert.equal(ctx.nodes.length,allocated,'confirmation does not replay a hand already reloading');
  engine.releaseReload('actor');assert.equal(engine.reloadVoices.has('actor'),false);assert.equal(engine.reloadVoices.get('actor:secondary'),second);
  assert.ok(source.stopAt<=ctx.currentTime+.025);assert.equal(other.stopAt,1,'the other selected take keeps its complete scheduled duration');
  ctx.advance(.03);assert.ok(engine.active.has(other));ctx.advance(1);assert.equal(engine.reloadVoices.size,0);assert.equal(engine.active.size,0);
  engine.stop();
});

test('an old hand reload ending cannot remove its replacement or another hand',async()=>{
  const {engine,ctx}=setup();await engine.unlock();
  engine.reload('pistol',1,{voiceId:'actor'});const old=[...engine.reloadVoices.get('actor').sources];
  engine.reload('shotgun',2,{voiceId:'actor'});const replacement=engine.reloadVoices.get('actor');
  engine.reload('smg',1.5,{voiceId:'actor:secondary'});const other=engine.reloadVoices.get('actor:secondary');
  for(const source of old)source.onended();
  assert.equal(engine.reloadVoices.get('actor'),replacement);assert.equal(engine.reloadVoices.get('actor:secondary'),other);
  engine.releaseReload();ctx.advance(.03);assert.equal(engine.reloadVoices.size,0);assert.equal(engine.active.size,0);engine.stop();
});

test('same-type sustained fire belongs to each hand and reloading one cannot cut the other loop',async()=>{
  for(const type of ['rifle','smg','flamethrower']){
    const {engine,ctx}=setup({effects:{[type]:[{src:`/audio/dual-${type}.wav`,gain:.31}]}});
    const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
    await engine.unlock();await engine.prepareEffect(type);
    engine.shoot(type,{held:true,voiceId:'actor'});engine.shoot(type,{held:true,voiceId:'actor:secondary'});
    const voices=engine.fireVoices.get(type),first=voices.get('actor'),second=voices.get('actor:secondary');
    assert.notEqual(first.source,second.source);assert.equal(first.source.buffer,second.source.buffer,'cache PCM without sharing the playing source');
    const allocated=ctx.nodes.length;engine.shoot(type,{held:true,voiceId:'actor:secondary'});assert.equal(ctx.nodes.length,allocated);
    engine.reload(type,.5,{voiceId:'actor'});assert.equal(voices.has('actor'),false);assert.equal(voices.get('actor:secondary'),second);
    assert.equal(second.source.stopAt,undefined);ctx.advance(.07);assert.ok(engine.active.has(second.source));
    engine.releaseFire(type,'actor:secondary');assert.equal(voices.size,0);engine.releaseReload();clock.advance(100);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('remote burst watchdogs expire independently for the two hands of the same weapon',async()=>{
  const {engine,ctx}=setup({effects:{smg:[{src:'/audio/dual-smg.wav'}]}}),clock=timers(ctx);
  engine.schedule=clock.schedule;engine.cancel=clock.cancel;await engine.unlock();await engine.prepareEffect('smg');
  engine.shoot('smg',{voiceId:'actor'});engine.shoot('smg',{voiceId:'actor:secondary'});
  const second=engine.fireVoices.get('smg').get('actor:secondary');assert.equal(clock.pending.size,2);
  clock.advance(100);engine.shoot('smg',{voiceId:'actor:secondary'});clock.advance(100);
  assert.equal(engine.fireVoices.get('smg').has('actor'),false);assert.equal(engine.fireVoices.get('smg').get('actor:secondary'),second);
  assert.equal(clock.pending.size,1);clock.advance(100);assert.equal(engine.fireVoices.get('smg').size,0);assert.equal(clock.pending.size,0);
  clock.advance(70);assert.equal(engine.active.size,0);engine.stop();
});

test('minigun rotation and confirmed loops are independent per hand and release remains scoped',async()=>{
  const {engine,ctx}=setup(),clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;await engine.unlock();
  assert.equal(engine.startMinigun({voiceId:'actor'}),true);assert.equal(engine.startMinigun({voiceId:'actor:secondary'}),true);
  const other=engine.minigunVoices.get('actor:secondary'),spin=other.spinVoice;
  engine.shoot('minigun',{held:true,voiceId:'actor'});
  assert.equal(engine.minigunVoices.get('actor').spinVoice,null);assert.equal(other.spinVoice,spin);assert.equal(other.spinning,true);
  engine.shoot('minigun',{held:true,voiceId:'actor:secondary'});const second=other.voice;
  engine.releaseFire('minigun','actor');assert.equal(engine.minigunVoices.size,1);assert.equal(engine.minigunVoices.get('actor:secondary').voice,second);
  assert.equal(second.noise.stopAt,undefined);engine.releaseFire();clock.advance(150);assert.equal(engine.minigunVoices.size,0);assert.equal(engine.active.size,0);engine.stop();
});

test('simultaneous same-type pistol shots retain both selected recordings rather than sharing one cooldown',async()=>{
  const {engine,ctx}=setup({effects:{pistol:[{src:'/audio/dual-pistol.wav',gain:.27}]}});await engine.unlock();await engine.prepareEffect('pistol');
  const selected=engine.buffers.get('/audio/dual-pistol.wav').buffer;
  engine.shoot('pistol',{voiceId:'actor'});engine.shoot('pistol',{voiceId:'actor:secondary'});
  assert.equal([...engine.active].filter(source=>source.buffer===selected).length,2);
  engine.shoot('pistol',{voiceId:'actor'});assert.equal([...engine.active].filter(source=>source.buffer===selected).length,2,'same-hand duplicates keep the original short gate');
  ctx.advance(.04);engine.shoot('pistol',{voiceId:'actor'});assert.equal([...engine.active].filter(source=>source.buffer===selected).length,3);engine.stop();
});

test('secondary equipment preloads its own selected shot, reload and mechanism without changing the primary',async()=>{
  const effects=Object.fromEntries(['pistol','reloadPistol','sniperShot'].map(kind=>[kind,[{src:`/audio/dual-${kind}.wav`}]]));
  const {engine,requests}=setup({effects});
  engine.updateScene({...state(),players:[{weapon:'pistol',dualWield:true,hands:{secondary:{weapon:'sniper'}}}]},true);await engine.unlock();await flush();
  for(const kind of ['reloadPistol','sniperShot'])assert.ok(requests.some(request=>request.url===`/audio/dual-${kind}.wav`),kind);
  engine.stop();
});

test('mute, pause and stop clean every hand source, reload map and watchdog while legacy aliases stay intact',async()=>{
  for(const cancel of [engine=>engine.setVolume(0),engine=>engine.updateScene(null,false),engine=>engine.stop()]){
    const {engine,ctx}=setup({effects:{smg:[{src:'/audio/dual-cleanup.wav'}]}}),clock=timers(ctx);
    engine.schedule=clock.schedule;engine.cancel=clock.cancel;await engine.unlock();await engine.prepareEffect('smg');
    engine.shoot('smg');assert.equal(engine.smgVoice,engine.fireVoices.get('smg').get('local'));
    engine.shoot('smg',{voiceId:'remote'});engine.shoot('minigun',{voiceId:'remote:secondary'});
    engine.reload('pistol',1,{voiceId:'actor'});engine.reload('shotgun',2,{voiceId:'actor:secondary'});
    cancel(engine);clock.advance(3000);
    assert.equal(engine.smgVoice,null);assert.equal(engine.minigunVoice,null);assert.equal(engine.reloadVoice,null);
    assert.equal(engine.minigunVoices.size,0);assert.equal(engine.reloadVoices.size,0);assert.ok([...engine.fireVoices.values()].every(voices=>voices.size===0));
    assert.equal(clock.pending.size,0);assert.equal(engine.active.size,0);engine.stop();
  }
});

class Param {
  constructor(value=0){this.value=value;this.events=[];}
  setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time]);}
  setTargetAtTime(value,time){this.value=value;this.events.push(['target',value,time]);}
  linearRampToValueAtTime(value,time){this.value=value;this.events.push(['ramp',value,time]);}
  exponentialRampToValueAtTime(value,time){this.value=value;this.events.push(['exponential',value,time]);}
  cancelScheduledValues(){}
  cancelAndHoldAtTime(){}
}
class Node {
  constructor(ctx,type){this.ctx=ctx;this.type=type;this.connections=[];this.gain=new Param();this.frequency=new Param();this.Q=new Param();this.playbackRate=new Param(1);ctx.nodes.push(this);}
  connect(node){this.connections.push(node);return node;}
  disconnect(){this.connections=[];this.disconnected=true;}
  start(time=this.ctx.currentTime,offset=0){this.started=true;this.startAt=time;this.offset=offset;}
  stop(time=this.ctx.currentTime){this.stopAt=time;if(time<=this.ctx.currentTime)this.onended?.();}
}
class Context {
  constructor(){this.currentTime=0;this.state='suspended';this.sampleRate=8000;this.nodes=[];this.destination={type:'destination'};this.decoded=0;}
  async resume(){this.state='running';}
  createGain(){return new Node(this,'gain');}
  createBiquadFilter(){return new Node(this,'filter');}
  createBufferSource(){return new Node(this,'buffer');}
  createOscillator(){return new Node(this,'oscillator');}
  createDynamicsCompressor(){const node=new Node(this,'compressor');for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param();return node;}
  createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/sampleRate,length,sampleRate,numberOfChannels:channels,getChannelData:channel=>data[channel]};}
  async decodeAudioData(){this.decoded++;return this.createBuffer(1,8000,8000);}
  advance(seconds){this.currentTime+=seconds;for(const node of this.nodes)if(node.stopAt!==undefined&&node.stopAt<=this.currentTime&&!node.disconnected)node.onended?.();}
}
const state=(brute=false,phase='wave')=>({phase,zombies:brute?[{id:'b',kind:'brute',hp:100}]:[]});
function setup(manifest={},options={}) {
  const ctx=new Context(),requests=[];
  const engine=new SoundEngine({contextFactory:()=>ctx,random:()=>.5,fetcher:async(url,options)=>{
    requests.push({url,options});
    if(url==='/audio/manifest.json')return {ok:true,json:async()=>manifest};
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
  },...options});
  return {engine,ctx,requests};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}

test('native WebAudio receives the interactive latency hint once without altering injected contexts',async()=>{
  const calls=[];
  class NativeAudioContext extends Context {constructor(options){super();calls.push(options);}}
  const source=readFileSync(new URL('../public/audio.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export class /m,'class ');
  const context=vm.createContext({window:{AudioContext:NativeAudioContext},MINIGUN_TIMING,FIRE_INTERVALS,MAX_WAVES,MELEE_WEAPONS,MUSIC_THEME_CATALOG,DEFAULT_MUSIC_THEME});
  vm.runInContext(`${source}\nglobalThis.NativeEngine=SoundEngine;`,context);
  const engine=new context.NativeEngine({fetcher:async()=>({ok:false})});
  assert.equal(calls.length,0,'construct only after user audio activation');
  await engine.unlock();await engine.unlock();assert.equal(calls.length,1);assert.equal(calls[0].latencyHint,'interactive');
  assert.deepEqual(Object.keys(calls[0]),['latencyHint']);assert.equal(engine.ready(),true);engine.stop();
  const injected=setup();await injected.engine.unlock();assert.equal(injected.engine.ctx,injected.ctx);assert.equal(calls.length,1);injected.engine.stop();
});

test('provisional hammer swings never borrow selected katana takes and cancel their delayed heavy preparation',async()=>{
  const {engine,ctx,requests}=setup({effects:{katanaLight:[{src:'/audio/selected-sword.wav'}],katanaHeavy:[{src:'/audio/selected-heavy.wav'}]}});
  await engine.unlock();await flush();
  assert.equal(engine.melee('heavy',1,'hammer','hammer'),true);
  const voice=engine.meleeVoices.get('hammer');assert.ok(voice.sources.size>=3);const scheduled=[...voice.sources];
  assert.ok([...voice.sources].some(source=>Math.abs(source.startAt-.5)<1e-8),'heavy fallback anticipates contact by 250ms too');
  assert.equal(requests.some(request=>request.url.includes('selected-')),false);
  engine.releaseMelee('hammer');ctx.advance(.03);assert.equal(engine.meleeVoices.size,0);
  assert.ok(scheduled.every(source=>source.stopAt<=.025));
  const before=ctx.nodes.length;engine.shoot('hammer');assert.equal(engine.reload('hammer',1),false);assert.equal(ctx.nodes.length,before);
  engine.stop();assert.equal(engine.active.size,0);
});

test('provisional sniper shot and bolt remain separate from recorded weapons and mechanical voices cancel on reload',async()=>{
  const {engine,ctx,requests}=setup({effects:{rifle:[{src:'/audio/selected-machinegun.wav'}]}});await engine.unlock();await flush();
  engine.shoot('sniper',{voiceId:'remote'});const voice=engine.pumpVoices.get('remote');assert.ok(voice.sources.size>=6);
  assert.ok([...voice.sources].some(source=>Math.abs(source.startAt-.16)<1e-8));
  assert.ok([...voice.sources].some(source=>Math.abs(source.startAt-.84)<1e-8));
  assert.equal(requests.some(request=>request.url.includes('selected-machinegun')),false);
  engine.releasePump('remote');ctx.advance(.03);assert.equal(engine.pumpVoices.size,0);
  assert.equal(engine.reload('sniper',3),true);assert.equal(engine.reloadVoice.type,'sniper');
  assert.ok([...engine.reloadVoice.sources].some(source=>source.startAt>=2.7));
  engine.releaseReload();ctx.advance(.03);assert.equal(engine.reloadVoice,null);engine.stop();assert.equal(engine.active.size,0);
});

test('selected hammer whooshes anticipate contact without cutting their beginning or changing pitch',async()=>{
  for(const [attack,kind,file,windup,impact,duration,start] of [
    ['light','hammerLight','hammer-light.mp3',.3,.2,.5,0],['heavy','hammerHeavy','hammer-heavy.mp3',.75,.4,.9,.1],
  ]){
    const {engine,ctx,requests}=setup({effects:{[kind]:[{src:`/audio/${file}`,gain:.31,sync:{impact}}],katanaLight:[{src:'/audio/unrelated-sword.wav'}]}});
    ctx.decodeAudioData=async()=>ctx.createBuffer(2,Math.round(duration*8000),8000);
    await engine.unlock();await engine.prepareEffect(kind);
    const sample=engine.buffers.get(`/audio/${file}`).buffer,copy=sample.getChannelData(0).slice();
    assert.equal(engine.melee(attack,.6,'actor','hammer'),true);
    const voice=engine.meleeVoices.get('actor'),source=[...voice.sources][0];
    assert.equal(voice.weapon,'hammer');assert.equal(voice.sources.size,1,'no procedural layer duplicates the chosen recording');
    assert.equal(source.buffer,sample);assert.equal(source.loop,false);assert.equal(source.playbackRate.value,1);assert.equal(source.offset,0);
    assert.ok(Math.abs(source.startAt-start)<1e-8);assert.equal(source.stopAt,source.startAt+duration);
    assert.equal(source.connections[0].gain.value,.31*.6);assert.deepEqual(sample.getChannelData(0),copy);
    assert.equal(requests.some(request=>request.url.includes('unrelated-sword')),false);
    ctx.advance(source.stopAt+.01);assert.equal(engine.meleeVoices.size,0);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('late hammer starts catch up to the same animation age without replaying a completed swing',async()=>{
  const {engine,ctx}=setup({effects:{hammerLight:[{src:'/audio/hammer-light.mp3',sync:{impact:.2}}]}});
  ctx.decodeAudioData=async()=>ctx.createBuffer(1,4000,8000);
  await engine.unlock();await engine.prepareEffect('hammerLight');
  engine.melee('light',1,'a','hammer',{elapsed:.15,windup:.3});
  const source=[...engine.meleeVoices.get('a').sources][0];
  assert.equal(source.startAt,0);assert.ok(Math.abs(source.offset-.15)<1e-8);
  assert.ok(Math.abs(source.startAt+.2-source.offset-.05)<1e-8);
  engine.releaseMelee('a');ctx.advance(.03);const allocated=ctx.nodes.length;
  assert.equal(engine.melee('light',1,'a','hammer',{elapsed:.8}),false);
  assert.equal(engine.meleeVoices.size,0);assert.equal(ctx.nodes.length,allocated);
  assert.equal(engine.melee('light',1,'a','hammer',{elapsed:.75}),false,'a sample whose complete tail is past never restarts');
  assert.equal(engine.meleeVoices.size,0);engine.stop();
});

test('new hammer and sniper samples preload once for equipped survivors and do not fetch the sword or machine gun',async()=>{
  const {engine,requests}=setup({effects:{hammerLight:[{src:'/audio/hammer-light.mp3'}],hammerHeavy:[{src:'/audio/hammer-heavy.mp3'}],
    sniperShot:[{src:'/audio/sniper-shot.mp3'}],katanaLight:[{src:'/audio/sword.wav'}],rifle:[{src:'/audio/machinegun.wav'}]}});
  engine.updateScene({...state(),players:[{weapon:'hammer'},{weapon:'sniper'}]},true);
  await engine.unlock();await flush();
  for(let index=0;index<8;index++)engine.updateScene({...state(),players:[{weapon:'hammer'},{weapon:'sniper'}]},true);
  await flush();
  for(const file of ['hammer-light.mp3','hammer-heavy.mp3','sniper-shot.mp3'])assert.equal(requests.filter(request=>request.url===`/audio/${file}`).length,1,file);
  assert.equal(requests.some(request=>/sword|machinegun/.test(request.url)),false);engine.stop();
});

test('the selected sniper report is played once per confirmed shot at original pitch with a separate tracked bolt',async()=>{
  const {engine,ctx,requests}=setup({effects:{sniperShot:[{src:'/audio/sniper-shot.mp3',gain:.37}],rifle:[{src:'/audio/other-rifle.wav'}]}});
  ctx.decodeAudioData=async()=>ctx.createBuffer(2,8800,8000);
  await engine.unlock();await engine.prepareEffect('sniperShot');
  const sample=engine.buffers.get('/audio/sniper-shot.mp3').buffer,copy=sample.getChannelData(0).slice();
  engine.shoot('sniper',{voiceId:'a'});engine.singleShot('sniper',{voiceId:'b'});
  const reports=[...engine.active].filter(source=>source.buffer===sample);
  assert.equal(reports.length,2,'simultaneous teammates must not share a global shot cooldown');
  for(const report of reports){assert.equal(report.startAt,0);assert.equal(report.offset,0);assert.equal(report.loop,undefined);
    assert.equal(report.playbackRate.value,1);assert.ok(Math.abs(report.stopAt-1.13)<1e-8);assert.equal(report.connections[0].gain.value,.37);}
  for(const id of ['a','b']){
    const bolt=engine.pumpVoices.get(id);assert.equal(bolt.sources.size,6);
    assert.ok([...bolt.sources].every(source=>source.buffer!==sample));
    assert.ok([...bolt.sources].some(source=>source.startAt===.16));assert.ok([...bolt.sources].some(source=>source.startAt===.84));
  }
  assert.deepEqual(sample.getChannelData(0),copy);assert.equal(requests.some(request=>request.url.includes('other-rifle')),false);
  engine.stop();assert.equal(engine.active.size,0);assert.equal(engine.pumpVoices.size,0);
});

test('an undecoded hammer take uses the cancellable fallback and never starts later when the download completes',async()=>{
  for(const [attack,kind] of [['light','hammerLight'],['heavy','hammerHeavy']]){
    const ctx=new Context();let finish;
    const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?
      {ok:true,json:async()=>({effects:{[kind]:[{src:'/audio/hammer.mp3',sync:{impact:.2}}]}})}:
      {ok:true,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}});
    await engine.unlock();await flush();engine.melee(attack,1,'actor','hammer');await flush();
    assert.equal(engine.meleeVoices.get('actor').sources.size,3);const allocated=ctx.nodes.length;
    engine.releaseMelee('actor');ctx.advance(.03);finish(new ArrayBuffer(4));await flush();
    assert.equal(engine.active.size,0);assert.equal(engine.meleeVoices.size,0);assert.equal(ctx.nodes.length,allocated);
    engine.melee(attack,1,'actor','hammer');assert.equal(engine.meleeVoices.get('actor').sources.size,1);engine.stop();
  }
});

test('hammer sample cancellation belongs to one actor and mute, pause and stop cancel delayed starts',async()=>{
  for(const cancel of [engine=>engine.setVolume(0),engine=>engine.updateScene(null,false),engine=>engine.stop()]){
    const {engine,ctx}=setup({effects:{hammerLight:[{src:'/audio/hammer-light.mp3',sync:{impact:.1}}],hammerHeavy:[{src:'/audio/hammer-heavy.mp3',sync:{impact:.2}}]}});
    await engine.unlock();await engine.prepareEffect('hammerLight');await engine.prepareEffect('hammerHeavy');
    engine.melee('light',1,'a','hammer');engine.melee('heavy',1,'b','hammer');
    const oldVoice=engine.meleeVoices.get('a'),old=[...oldVoice.sources][0],other=engine.meleeVoices.get('b');
    engine.melee('heavy',.4,'a','hammer');const replacement=engine.meleeVoices.get('a');
    old.onended();assert.equal(engine.meleeVoices.get('a'),replacement);assert.equal(engine.meleeVoices.get('b'),other);
    const scheduled=[...replacement.sources,...other.sources],cached=engine.buffers.size;
    assert.ok(scheduled.every(source=>source.startAt>.25));cancel(engine);
    assert.equal(engine.active.size,0);assert.equal(engine.meleeVoices.size,0);assert.equal(engine.buffers.size,cached);
    ctx.advance(3);assert.equal(engine.active.size,0);
  }
});

test('the original sniper and historical mace exports keep their preserved takes, hashes and unchanged pitch/tempo',{ skip: 'needs the art and audio originals, kept out of the open edition' }, ()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8')).sniperMaceImport;
  const selections=[
    ['sniperShot','sniper riffle shot',2,2,'sniper-shot.mp3','5c84d809792b3f7926767ee3ab8a5df6934009b6305affa8e7813f8055f3c600'],
    ['hammerLight','mace swing',1,1,'hammer-light.mp3','f1946e52c0ee7e21b9762568397fb119b5db0e863fef23c61c7fbd01af49b9b2'],
    ['hammerHeavy','mace swing',2,1,'hammer-heavy.mp3','f87f011642e8c1a720f40ab5a5fe67045fcb161502b1273dac32e3bb7232bf93'],
  ];
  assert.equal(provenance.agentGenerations,0);assert.equal(provenance.agentCreditsSpent,0);
  for(const [effect,prompt,take,duration,file,sourceSha] of selections){
    const record=provenance.takes.find(item=>item.effect===effect),entry=manifest.effects[effect];
    assert.equal(entry.length,1);
    if(effect==='sniperShot'){assert.equal(entry[0].src,`/audio/${file}`);assert.deepEqual(entry[0],record.manifest);}
    else assert.notEqual(entry[0].src,`/audio/${file}`,'the original mace take stays archived after the owner replaces it');
    assert.equal(record.take,take);assert.equal(record.original.take,String(take));assert.equal(record.original.prompt,prompt);
    const original=readFileSync(new URL(`../${record.original.originalPath.split('/').map(encodeURIComponent).join('/')}`,import.meta.url));
    const output=readFileSync(new URL(`../${record.output.path}`,import.meta.url));
    assert.equal(createHash('sha256').update(original).digest('hex'),sourceSha);
    assert.equal(record.original.sha256,sourceSha);
    assert.equal(createHash('sha256').update(output).digest('hex'),record.output.sha256);
    assert.equal(record.output.sourceStartSeconds,0);assert.equal(record.output.sourceDurationSeconds,duration);
    assert.equal(record.output.decodedDurationSeconds,duration);assert.equal(record.output.pitchRatio,1);assert.equal(record.output.tempoFactor,1);
    assert.equal(record.output.clippedSampleCount,0);assert.ok(record.output.decodedPeakDbfs<=-3);
    assert.equal(record.original.sourceId,null,'Keep unavailable account identifiers unknown');
  }
});

test('both mace takes keep their selected timing, including the owner’s 250ms heavy and 200ms light hammer delays and network catch-up',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const audit=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8')).meleeExpansionImport;
  // The bat's takes of this import were replaced on 13 October (melee-swings-audio.test.mjs).
  for(const take of audit.takes.filter(take=>manifest.effects[take.effect][0].src===take.manifest.src)){
    const kind=take.effect,weapon=kind.startsWith('bat')?'bat':'hammer',attack=kind.endsWith('Heavy')?'heavy':'light';
    const {windup,duration}=MELEE_WEAPONS[weapon][attack],peak=take.output.rmsPeakSeconds,delay=({hammerHeavy:.25,hammerLight:.2})[kind]??0,start=windup-peak+delay;
    const {engine,ctx}=setup(manifest);
    ctx.decodeAudioData=async()=>ctx.createBuffer(1,Math.round(take.output.decodedDurationSeconds*44100),44100);
    await engine.unlock();await engine.prepareEffect(kind);
    const entry=manifest.effects[kind][0],sample=engine.buffers.get(entry.src).buffer;
    assert.equal(entry.sync.impact,peak);assert.equal(engine.catalog.effects[kind][0].sync.advance,0);
    assert.equal(engine.catalog.effects[kind][0].sync.delay??0,delay);
    engine.melee(attack,1,'actor',weapon);
    const source=[...engine.meleeVoices.get('actor').sources][0];
    assert.equal(source.buffer,sample);assert.equal(source.offset,0);assert.equal(source.playbackRate.value,1);
    assert.ok(Math.abs(source.startAt-start)<1e-8);assert.ok(Math.abs(source.startAt+peak-windup-delay)<1e-8);
    assert.ok(Math.abs(source.stopAt-source.startAt-sample.duration)<1e-8);
    for(const age of [.05,Math.min(.25,duration*.5),...(kind==='hammerHeavy'?[.9,1.4]:kind==='hammerLight'?[.4,.6]:[])]){
      engine.melee(attack,1,'actor',weapon,{elapsed:age,windup});
      const late=[...engine.meleeVoices.get('actor').sources][0];
      assert.ok(Math.abs(late.startAt-Math.max(0,start-age))<1e-8);
      assert.ok(Math.abs(late.offset-Math.max(0,age-start))<1e-8);
      assert.equal(late.playbackRate.value,1);
    }
    assert.equal(engine.melee(attack,1,'actor',weapon,{elapsed:duration}),false,'an expired attack never replays');
    assert.equal(engine.meleeVoices.size,0);
    const before=ctx.nodes.length;engine.shoot(weapon);assert.equal(engine.reload(weapon,1),false);assert.equal(ctx.nodes.length,before);
    engine.stop();assert.equal(engine.active.size,0);
  }
});

test('the four new owner-selected originals are preserved and only leading near-silence is removed',{ skip: 'needs the art and audio originals, kept out of the open edition' }, ()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const audit=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8')).meleeExpansionImport;
  const choices=[['batLight','hard boxing glove heavy impact',4,0],['batHeavy','slow swing followed by heavy impact',2,.783],
    ['hammerLight','swing followed by medium impact',4,.504],['hammerHeavy','slow swing followed by heavy impact',3,.384]];
  // The owner replaced both bat takes on 13 October; their files stay, marked historical.
  const superseded=new Set(['batLight','batHeavy']);
  assert.equal(audit.takes.length,4);assert.equal(audit.agentGenerations,0);assert.equal(audit.agentCreditsSpent,0);
  for(const [effect,prompt,take,cut] of choices){
    const record=audit.takes.find(item=>item.effect===effect),out=record.output;
    assert.equal(record.original.prompt,prompt);assert.equal(record.take,take);assert.equal(record.original.take,String(take));
    if(superseded.has(effect))assert.notEqual(manifest.effects[effect][0].src,record.manifest.src);else assert.deepEqual(manifest.effects[effect],[record.manifest]);
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../${record.original.originalPath.split('/').map(encodeURIComponent).join('/')}`,import.meta.url))).digest('hex'),record.original.sha256);
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../${out.path}`,import.meta.url))).digest('hex'),out.sha256);
    assert.ok(Math.abs(out.sourceStartSeconds-cut)<.001);assert.ok(Math.abs(out.sourceDurationSeconds+out.sourceStartSeconds-record.original.duration)<1/44100);
    assert.ok(Math.abs(out.decodedDurationSeconds-out.sourceDurationSeconds)<1/44100);
    assert.equal(out.pitchRatio,1);assert.equal(out.tempoFactor,1);assert.equal(out.tailPreserved,true);
    assert.equal(out.clippedSampleCount,0);assert.ok(out.decodedPeakDbfs<=-3);assert.equal(record.original.sourceId,null);
  }
});

test('fire axe keeps the selected takes, complete remaining tails and exact original hashes',{ skip: 'needs the art and audio originals, kept out of the open edition' }, ()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const audit=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8')).fireaxeImport;
  assert.equal(audit.agentCreditsSpent,0);assert.equal(audit.agentGenerations,0);
  assert.equal(audit.takes.length,2);
  for(const [effect,take,cut] of [['fireaxeLight',3,.663469387755102],['fireaxeHeavy',2,0]]){
    const row=audit.takes.find(r=>r.effect===effect),out=row.output;
    assert.equal(row.original.prompt,'Axe swing followed by medium impact');assert.equal(row.take,take);
    assert.deepEqual(manifest.effects[effect],[row.manifest]);
    for(const [path,sha] of [[row.original.originalPath,row.original.sha256],[out.path,out.sha256]])
      assert.equal(createHash('sha256').update(readFileSync(new URL(`../${path.split('/').map(encodeURIComponent).join('/')}`,import.meta.url))).digest('hex'),sha);
    assert.equal(out.sourceStartSeconds,cut);assert.equal(out.pitchRatio,1);assert.equal(out.tempoFactor,1);
    assert.equal(out.tailPreserved,true);assert.equal(out.clippedSampleCount,0);
    assert.ok(Math.abs(out.sourceDurationSeconds+cut-row.original.duration)<1/44100);
    assert.ok(out.decodedPeakDbfs<=-2.99);assert.equal(row.manifest.sync.advance,0);
  }
});

for(const attack of ['light','heavy'])test(`fire axe ${attack} audio shares the authoritative impact and compensates age without replaying expired attacks`,{ skip: 'needs the art and audio originals, kept out of the open edition' },async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const kind=attack==='heavy'?'fireaxeHeavy':'fireaxeLight',entry=manifest.effects[kind][0];
  const {windup,duration}=MELEE_WEAPONS.fireaxe[attack],start=windup-entry.sync.impact;
  const {engine,ctx,requests}=setup(manifest);ctx.decodeAudioData=async()=>ctx.createBuffer(1,88200,44100);
  engine.updateScene({...state(),players:[{weapon:'fireaxe'}]},true);await engine.unlock();await engine.prepareEffect(kind);
  assert.ok(requests.some(r=>r.url===entry.src));
  for(const age of [0,.1,.45]){
    engine.melee(attack,1,'a','fireaxe',{elapsed:age});const source=[...engine.meleeVoices.get('a').sources][0];
    assert.equal(source.playbackRate.value,1);assert.ok(Math.abs(source.startAt-Math.max(0,start-age))<1e-8);
    assert.ok(Math.abs(source.offset-Math.max(0,age-start))<1e-8);
  }
  engine.melee(attack,1,'b','fireaxe');const other=engine.meleeVoices.get('b');
  assert.equal(engine.melee(attack,1,'a','fireaxe',{elapsed:duration}),false);
  assert.equal(engine.meleeVoices.get('b'),other);
  engine.releaseMelee();ctx.advance(3);assert.equal(engine.meleeVoices.size,0);
  engine.stop();assert.equal(engine.active.size,0);
});

test('bat samples preload once and delayed hits cancel independently for each actor',async()=>{
  const {engine,ctx,requests}=setup({effects:{batLight:[{src:'/audio/bat-light.mp3',sync:{impact:.1,advance:0}}],batHeavy:[{src:'/audio/bat-heavy.mp3',sync:{impact:.13,advance:0}}]}});
  engine.updateScene({...state(),players:[{weapon:'bat'}]},true);await engine.unlock();await flush();
  for(let i=0;i<5;i++)engine.updateScene({...state(),players:[{weapon:'bat'}]},true);await flush();
  for(const file of ['bat-light.mp3','bat-heavy.mp3'])assert.equal(requests.filter(request=>request.url===`/audio/${file}`).length,1);
  engine.melee('heavy',1,'a','bat');engine.melee('light',1,'b','bat');const other=engine.meleeVoices.get('b');
  const source=[...engine.meleeVoices.get('a').sources][0];assert.ok(Math.abs(source.startAt-.22)<1e-8);
  engine.releaseMelee('a');assert.equal(engine.meleeVoices.get('b'),other);assert.ok(source.stopAt<=.025);
  engine.setVolume(0);assert.equal(engine.meleeVoices.size,0);assert.equal(engine.active.size,0);ctx.advance(3);assert.equal(engine.active.size,0);
});

test('both final hammer delays are cancellable for recorded and undecoded fallback voices',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  for(const [attack,kind,start,peak] of [['heavy','hammerHeavy',.406349,1],['light','hammerLight',.330385,.5]])for(const decoded of [false,true]){
    const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
    const {engine,ctx}=setup(manifest);await engine.unlock();await flush();
    if(decoded)await engine.prepareEffect(kind);
    engine.melee(attack,1,'actor','hammer');const voice=engine.meleeVoices.get('actor'),sources=[...voice.sources];
    // The light swing also plays the owner's whoosh layer, in the same voice.
    if(decoded){assert.equal(sources.length,kind==='hammerLight'?2:1);assert.ok(Math.abs(sources[0].startAt-start)<1e-8);}
    else{assert.equal(sources.length,3);assert.ok(sources.some(source=>Math.abs(source.startAt-peak)<1e-8));}
    const allocated=ctx.nodes.length;engine.releaseMelee('actor');await flush();ctx.advance(3);
    assert.equal(engine.meleeVoices.size,0);assert.equal(engine.active.size,0);assert.equal(ctx.nodes.length,allocated);
    assert.ok(sources.every(source=>source.stopAt<=.025),'cancel even before the delayed sample begins');engine.stop();
  }
});

test('each held assault shot retains one fixed-pitch attack and overlaps only its bounded tail, without autonomous follow-up',async()=>{
  // The grain path stays for a take cut from a burst: test it with the previous take.
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));manifest.effects.assault=manifest.effects.assaultBurst;
  const {engine,ctx}=setup(manifest),clock=timers(ctx),bytes=readFileSync(new URL('../public/audio/assault-fire-4.wav',import.meta.url));
  engine.schedule=clock.schedule;engine.cancel=clock.cancel;ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);
  await engine.unlock();await engine.prepareEffect('assault');
  const original=engine.buffers.get('/audio/assault-fire-4.wav').buffer,copy=original.getChannelData(0).slice(),allocated=ctx.nodes.length;
  const confirmations=[0,.133,.266,.4,.533,.7,.833,1,1.133];let previous=0,grain;
  for(const at of confirmations){
    ctx.advance(at-previous);previous=at;engine.shoot('assault',{held:true,voiceId:'actor'});
    const voice=engine.assaultVoices.get('actor'),source=[...voice.sources].at(-1);grain??=source.buffer;
    assert.equal(source.buffer,grain);assert.equal(source.startAt,at);assert.equal(source.loop,false);assert.equal(source.playbackRate.value,1);
    assert.equal(source.buffer.duration,.18);assert.equal(source.stopAt,at+source.buffer.duration);
    assert.ok(voice.sources.size<=2);assert.equal(engine.active.size,voice.sources.size);assert.equal(voice.levels.size,voice.sources.size);
    assert.equal(clock.pending.size,0);assert.equal(engine.assaultVoice,null);
  }
  assert.equal(ctx.nodes.length-allocated,confirmations.length*2,'one buffer source and gain per confirmed bullet');
  const nodes=ctx.nodes.length;ctx.advance(1);assert.equal(ctx.nodes.length,nodes);assert.equal(engine.active.size,0);assert.equal(engine.assaultVoices.size,0);
  assert.deepEqual(original.getChannelData(0),copy);
  const start=Math.round(manifest.effects.assault[0].grain.start*44100),index=Math.round(.04*44100);
  assert.equal(grain.getChannelData(0)[index],copy[start+index],'interior source samples stay exact, without resampling or artificial attack');
  assert.equal(Math.abs(grain.getChannelData(0)[0]),0);assert.equal(Math.abs(grain.getChannelData(0).at(-1)),0);
  engine.singleShot('assault',{voiceId:'actor'});const single=[...engine.assaultVoices.get('actor').sources][0];
  assert.notEqual(single.buffer,grain);assert.ok(Math.abs(single.buffer.duration-.095)<1/44100);engine.stop();
});

test('the selected assault held tail fills 133 and 167 ms confirmation gaps without adding attacks or changing the original PCM',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));manifest.effects.assault=manifest.effects.assaultBurst;const entry=manifest.effects.assault[0];
  const bytes=readFileSync(new URL('../public/audio/assault-fire-4.wav',import.meta.url)),{engine,ctx}=setup(manifest);
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect('assault');
  const original=engine.buffers.get(entry.src).buffer,copy=original.getChannelData(0).slice(),rate=original.sampleRate;
  const single=engine.assaultGrainBuffer(entry,original).getChannelData(0),held=engine.assaultTailBuffer(entry,original).getChannelData(0);
  assert.deepEqual(held.subarray(0,Math.round(.05*rate)),single.subarray(0,Math.round(.05*rate)),'the complete selected attack, including its onset, remains sample-exact');
  const rms=pcm=>Math.sqrt(pcm.reduce((sum,value)=>sum+value*value,0)/Math.max(1,pcm.length));
  const width=Math.round(.005*rate),attackRms=rms(held.subarray(Math.round(.01*rate),Math.round(.04*rate)));
  for(let at=Math.round(.05*rate);at<held.length-width;at+=width)assert.ok(rms(held.subarray(at,at+width))<attackRms*.65,'the extension contains only quieter tail energy, never a second shot attack');
  function sequence(pcm,gap){const result=new Float32Array(Math.round((gap*49+.13)*rate));for(let shot=0;shot<50;shot++){const at=Math.round(shot*gap*rate);for(let i=0;i<pcm.length&&at+i<result.length;i++)result[at+i]+=pcm[i];}return result;}
  function metrics(pcm){let quiet=0,longest=0,peak=0;for(const value of pcm)peak=Math.max(peak,Math.abs(value));for(let at=0;at<pcm.length-width;at+=width){quiet=rms(pcm.subarray(at,at+width))*entry.gain<10**(-35/20)?quiet+1:0;longest=Math.max(longest,quiet);}return {quietMs:longest*5,peak};}
  for(const gap of [.133,.167]){
    const before=metrics(sequence(single,gap)),after=metrics(sequence(held,gap));
    assert.ok(before.quietMs>=35,'the old grain really leaves a gap in this actual selected recording');
    assert.ok(after.quietMs<=5,'the extended tail bridges the normal frame-quantised gap');
    assert.ok(after.peak<1,'overlapping raw PCM stays below clipping before the existing gain and compressor');
  }
  assert.deepEqual(original.getChannelData(0),copy);engine.stop();
});

test('held assault tails stay bounded per shooter even when delayed confirmations arrive together and every release cancels all tails',async()=>{
  const manifest={effects:{assault:[{src:'/audio/assault.wav',grain:{start:.1,end:.195}}],reloadSmg:[{src:'/audio/reload.wav'}]}};
  for(const cancel of [engine=>engine.releaseAssault('a'),engine=>engine.releaseFire('assault'),engine=>engine.releaseFire(),engine=>engine.reload('assault',1.6),engine=>engine.setVolume(0),engine=>engine.updateScene(null,false)]){
    const {engine,ctx}=setup(manifest);await engine.unlock();await engine.prepareEffect('assault');
    engine.shoot('assault',{held:true,voiceId:'b'});const other=engine.assaultVoices.get('b');
    for(let index=0;index<50;index++)engine.shoot('assault',{held:true,voiceId:'a'});
    const voice=engine.assaultVoices.get('a');assert.equal(voice.sources.size,2);assert.equal(voice.levels.size,2);assert.equal(engine.active.size,3);
    assert.equal(engine.assaultVoices.get('b'),other,'a packet batch cannot cut another player’s report');
    const tails=[...voice.sources];cancel(engine);assert.equal(engine.assaultVoices.has('a'),false);
    assert.ok(tails.every(source=>source.stopAt<=ctx.currentTime+.012));ctx.advance(.2);
    assert.equal(engine.assaultVoices.size,0);assert.equal([...engine.active].some(source=>[...engine.fireBuffers.values()].includes(source.buffer)),false,'all assault tails have ended; an R reload may still be audible');
    engine.stop();assert.equal(engine.active.size,0);
  }
});

test('assault voices belong to separate shooters and pause, release, reload, mute and leave cancel their short tails',async()=>{
  const manifest={effects:{assault:[{src:'/audio/assault.wav',gain:.389,grain:{start:.69,end:.785,fadeIn:.001,fadeOut:.012}}],katanaLight:[{src:'/audio/katana.wav'}],reloadSmg:[{src:'/audio/reload.wav'}]}};
  for(const cancel of [engine=>engine.releaseFire('assault'),engine=>engine.releaseFire(),engine=>engine.reload('assault',1.6),engine=>engine.setVolume(0),engine=>engine.updateScene(null,false)]){
    const {engine,ctx}=setup(manifest);await engine.unlock();for(const kind of Object.keys(manifest.effects))await engine.prepareEffect(kind);
    engine.shoot('assault',{voiceId:'a'});engine.shoot('assault',{voiceId:'b'});engine.melee('light',1,'sword');
    const second=engine.assaultVoices.get('b'),firstSource=[...engine.assaultVoices.get('a').sources][0];
    engine.shoot('assault',{voiceId:'a'});const replacement=engine.assaultVoices.get('a');
    firstSource.onended();assert.equal(engine.assaultVoices.get('a'),replacement);assert.equal(engine.assaultVoices.get('b'),second);
    engine.releaseAssault('a');assert.equal(engine.assaultVoices.has('a'),false);assert.equal(engine.assaultVoices.get('b'),second);
    assert.equal(engine.meleeVoices.size,1);cancel(engine);assert.equal(engine.assaultVoices.size,0);
    ctx.advance(.03);assert.equal([...engine.active].some(source=>source.buffer===engine.fireBuffers.values().next().value),false);engine.stop();assert.equal(engine.active.size,0);
  }
});

test('invalid assault grain metadata never replays a full recorded burst, and late decoding never emits an extra shot',async()=>{
  const ctx=new Context();let finish;
  const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?
    {ok:true,json:async()=>({effects:{assault:[{src:'/audio/assault.wav',grain:{start:.69,end:5}}]}})}:
    {ok:true,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}});
  await engine.unlock();await flush();engine.shoot('assault',{held:true});await flush();
  assert.ok(engine.assaultVoices.get('local').sources.size>1);const allocated=ctx.nodes.length;
  engine.releaseFire('assault');ctx.advance(.03);finish(new ArrayBuffer(4));await flush();assert.equal(ctx.nodes.length,allocated);assert.equal(engine.active.size,0);
  engine.shoot('assault');assert.ok([...engine.assaultVoices.get('local').sources].every(source=>source.buffer!==engine.buffers.get('/audio/assault.wav').buffer));
  engine.stop();assert.equal(engine.active.size,0);
});

test('the two owner-selected katana take 3 recordings stay complete, fixed-pitch and unchanged in decoded memory',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8'));
  for(const [attack,kind,file,seconds,sourceKey,sourceSha] of [
    ['light','katanaLight','katana-slash-3.wav',6,'katana_light','6183b49d429944f55c2854897145dedc42407b7f3e8b098390a72008ac3334e5'],
    ['heavy','katanaHeavy','katana-special-3.wav',3,'katana_heavy','969f15d0801089e0f405790bc0b1282380ed71e9e18fe46d4e24dad8f7266562'],
  ]){
    const {engine,ctx}=setup(manifest),bytes=readFileSync(new URL(`../public/audio/${file}`,import.meta.url));
    ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect(kind);
    const sample=engine.buffers.get(`/audio/${file}`).buffer,copy=sample.getChannelData(0).slice();
    assert.equal(sample.duration,seconds);assert.equal(engine.melee(attack,.6,'actor'),true);
    const voice=engine.meleeVoices.get('actor'),source=[...voice.sources][0];
    assert.equal(source.buffer,sample);assert.equal(source.loop,false);assert.equal(source.playbackRate.value,1);
    assert.equal(source.offset,0);assert.equal(source.stopAt,ctx.currentTime+seconds);
    assert.equal(source.connections[0].gain.value,.3);assert.deepEqual(sample.getChannelData(0),copy);
    assert.equal(provenance.sources[sourceKey].sha256,sourceSha);assert.equal(provenance.sources[sourceKey].take,'3');
    const output=provenance.outputs.find(item=>item.path===`public/audio/${file}`);
    assert.equal(output.sourceKey,sourceKey);assert.equal(output.sourceStartSeconds,0);
    assert.equal(output.sourceDurationSeconds,seconds);assert.equal(output.pitchRatio,1);assert.equal(output.tempoFactor,1);
    assert.equal(output.clippedSampleCount,0);assert.ok(Math.abs(output.decodedPeakDbfs+3)<.005);
    ctx.advance(seconds+.01);assert.equal(engine.meleeVoices.size,0);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('katana starts replace only the same actor’s tail and old onended events cannot delete the new voice',async()=>{
  const {engine,ctx}=setup({effects:{katanaLight:[{src:'/audio/light.wav',gain:.5}],katanaHeavy:[{src:'/audio/heavy.wav',gain:.5}],pistol:[{src:'/audio/pistol.wav'}]}});
  await engine.unlock();for(const kind of ['katanaLight','katanaHeavy','pistol'])await engine.prepareEffect(kind);
  engine.melee('light',1,'a');engine.melee('heavy',.4,'b');engine.shoot('pistol');
  const original=engine.meleeVoices.get('a'),other=engine.meleeVoices.get('b'),pistol=[...engine.active].at(-1);
  const old=[...original.sources][0];ctx.advance(.55);engine.melee('heavy',1,'a');
  const replacement=engine.meleeVoices.get('a');assert.notEqual(original,replacement);assert.equal(engine.meleeVoices.size,2);
  assert.equal(engine.meleeVoices.get('b'),other);assert.equal(old.stopAt,ctx.currentTime+.025);
  old.onended();assert.equal(engine.meleeVoices.get('a'),replacement);
  engine.releaseMelee('a');assert.equal(engine.meleeVoices.has('a'),false);assert.equal(engine.meleeVoices.get('b'),other);
  assert.ok(engine.active.has(pistol));engine.releaseFire();assert.equal(engine.meleeVoices.get('b'),other,'mouse release preserves a confirmed swing');
  engine.releaseMelee();ctx.advance(.03);assert.equal(engine.meleeVoices.size,0);assert.ok(engine.active.has(pistol));engine.stop();
});

test('katana preparation loads both attacks once, with no magazine, reload or dry-fire substitute',async()=>{
  const effects={katanaLight:[{src:'/audio/light.wav'}],katanaHeavy:[{src:'/audio/heavy.wav'}]};
  const {engine,ctx,requests}=setup({effects});await engine.unlock();await flush();
  engine.updateScene({...state(),players:[{weapon:'katana'}]},true);await flush();
  for(let i=0;i<10;i++)engine.updateScene({...state(),players:[{weapon:'katana'}]},true);await flush();
  assert.equal(requests.filter(item=>item.url==='/audio/light.wav').length,1);assert.equal(requests.filter(item=>item.url==='/audio/heavy.wav').length,1);
  assert.equal(requests.some(item=>/reload|pistol/.test(item.url)),false);
  const nodes=ctx.nodes.length;engine.shoot('katana');assert.equal(engine.reload('katana',1),false);
  assert.equal(ctx.nodes.length,nodes);assert.equal(engine.melee('invalid'),false);assert.equal(engine.melee('light',NaN),false);
  assert.equal(ctx.nodes.length,nodes);engine.stop();
});

test('katana’s undecoded sample uses an immediate cancellable fallback and never replays a stale attack',async()=>{
  for(const attack of ['light','heavy']){
    const ctx=new Context();let finish;
    const kind=attack==='heavy'?'katanaHeavy':'katanaLight';
    const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?
      {ok:true,json:async()=>({effects:{[kind]:[{src:'/audio/sword.wav',gain:.5}]}})}:
      {ok:true,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}});
    assert.equal(engine.melee(attack),false);assert.equal(ctx.nodes.length,0);await engine.unlock();await flush();
    assert.equal(engine.melee(attack),false);await flush();assert.ok(engine.meleeVoices.get('local').sources.size>=2);
    const allocated=ctx.nodes.length;engine.releaseMelee();ctx.advance(.03);assert.equal(engine.active.size,0);
    finish(new ArrayBuffer(4));await flush();assert.equal(ctx.nodes.length,allocated);assert.equal(engine.active.size,0);
    assert.equal(engine.melee(attack),true);assert.equal(engine.meleeVoices.get('local').sources.size,1);engine.stop();
  }
});

test('mute, pause/leave and stop clear all katana actor voices without changing their cached recordings',async()=>{
  for(const cancel of [engine=>engine.setVolume(0),engine=>engine.updateScene(null,false),engine=>engine.stop()]){
    const {engine,ctx}=setup({effects:{katanaLight:[{src:'/audio/light.wav'}],katanaHeavy:[{src:'/audio/heavy.wav'}]}});
    await engine.unlock();await engine.prepareEffect('katanaLight');await engine.prepareEffect('katanaHeavy');
    engine.melee('light',1,'local');engine.melee('heavy',1,'remote');const cached=engine.buffers.size;
    cancel(engine);assert.equal(engine.active.size,0);assert.equal(engine.meleeVoices.size,0);assert.equal(engine.buffers.size,cached);
    ctx.advance(7);assert.equal(engine.active.size,0);
  }
});

test('new weapon samples prepare only for active equipment and AR deliberately reuses the SMG reload',async()=>{
  const effects=Object.fromEntries(['assault','rocket','flamethrower','reloadSmg'].map(kind=>[kind,[{src:`/audio/${kind}.wav`}]]));
  const {engine,requests}=setup({effects});
  engine.updateScene({...state(false,'lobby'),players:['assault','rocket','flamethrower'].map(weapon=>({weapon}))},true);
  assert.equal(requests.length,0);await engine.unlock();await flush();assert.equal(requests.length,1);
  engine.updateScene({...state(),players:['assault','rocket','flamethrower'].map(weapon=>({weapon}))},true);await flush();
  for(const kind of Object.keys(effects))assert.equal(requests.filter(item=>item.url===`/audio/${kind}.wav`).length,1);
  assert.equal(requests.some(item=>/reload(?:Rocket|Flamethrower|Assault)/.test(item.url)),false);engine.stop();
});

test('flamethrower sustains one fixed-pitch prepared loop and caches the seam without touching original PCM',async()=>{
  const effects=Object.fromEntries(['flamethrower'].map(kind=>[kind,[{src:`/audio/${kind}.wav`,gain:.27,loop:{start:.1,end:.9,crossfade:.04}}]]));
  const {engine,ctx}=setup({effects}),clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  ctx.decodeAudioData=async()=>{const result=ctx.createBuffer(1,8000,8000),values=result.getChannelData(0);for(let i=0;i<values.length;i++)values[i]=.2*Math.sin(i*.025);return result;};
  await engine.unlock();for(const type of Object.keys(effects))await engine.prepareEffect(type);
  const originals=Object.fromEntries(Object.keys(effects).map(type=>[type,engine.buffers.get(`/audio/${type}.wav`).buffer.getChannelData(0).slice()]));
  for(const type of Object.keys(effects))engine.shoot(type,{held:true});const allocated=ctx.nodes.length;
  const voices={flamethrower:engine.flamethrowerVoice};
  for(let i=0;i<12;i++)for(const type of Object.keys(effects))engine.shoot(type,{held:true});
  assert.equal(ctx.nodes.length,allocated);assert.equal(clock.pending.size,0);
  for(const [type,voice] of Object.entries(voices)){
    const original=engine.buffers.get(`/audio/${type}.wav`).buffer;
    assert.equal(engine[`${type}Voice`],voice);assert.notEqual(voice.source.buffer,original);
    assert.equal(voice.source.buffer.duration,.76);assert.equal(voice.source.loop,true);assert.equal(voice.source.playbackRate.value,1);
    assert.deepEqual(original.getChannelData(0),originals[type]);assert.equal(voice.level.gain.value,.27);
    engine.releaseFire(type);clock.advance(70);engine.shoot(type,{held:true});assert.equal(engine[`${type}Voice`].source.buffer,voice.source.buffer);
  }
  engine.stop();assert.equal(engine.active.size,0);
});

test('the three selected arsenal exports preserve full duration and produce unclipped fixed-pitch runtime voices',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  for(const [type,file,duration,loopDuration] of [['assault','assault-rifle-shot-4.wav',2,null],['rocket','rocket-launcher-1.wav',3,null],['flamethrower','flamethrower-3.wav',4,3.02]]){
    const {engine,ctx}=setup(manifest),bytes=readFileSync(new URL(`../public/audio/${file}`,import.meta.url));
    assert.equal(manifest.effects[type][0].src,`/audio/${file}`);ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);
    await engine.unlock();await engine.prepareEffect(type);const original=engine.buffers.get(`/audio/${file}`).buffer,copy=original.getChannelData(0).slice();
    assert.equal(original.duration,duration);engine.shoot(type,{held:true});
    const voice=type==='assault'?{source:[...engine.assaultVoices.get('local').sources][0]}:type==='rocket'?{source:[...engine.active][0]}:engine[`${type}Voice`];
    assert.equal(voice.source.playbackRate.value,1);assert.deepEqual(original.getChannelData(0),copy);
    if(loopDuration!==null){assert.notEqual(voice.source.buffer,original);assert.equal(voice.source.buffer.duration,loopDuration);assert.equal(voice.source.loop,true);}
    else if(type==='assault'){
      // The owner's single-shot take plays whole for each round.
      assert.equal(voice.source.buffer,original);
      assert.equal(voice.source.loop,false);assert.equal(voice.source.stopAt,ctx.currentTime+voice.source.buffer.duration);
    }else{assert.equal(voice.source.buffer,original);assert.equal(voice.source.stopAt,ctx.currentTime+duration+.03);}
    let peak=0;for(const value of voice.source.buffer.getChannelData(0))peak=Math.max(peak,Math.abs(value));
    assert.ok(peak<1,`${type} prepared PCM must retain headroom`);engine.stop();assert.equal(engine.active.size,0);
  }
});

test('remote flame fire tolerates one missing confirmation, then releases within the cadence watchdog',async()=>{
  for(const type of ['flamethrower']){
    const {engine,ctx}=setup({effects:{[type]:[{src:`/audio/${type}.wav`}]}}),clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
    await engine.unlock();await engine.prepareEffect(type);engine.shoot(type);
    const voice=engine[`${type}Voice`],watchdog=Math.max(150,FIRE_INTERVALS[type]*2000+30);
    clock.advance(FIRE_INTERVALS[type]*2000);assert.equal(engine[`${type}Voice`],voice);
    engine.shoot(type);clock.advance(watchdog-1);assert.equal(engine[`${type}Voice`],voice);
    clock.advance(1);assert.equal(engine[`${type}Voice`],null);assert.equal(clock.pending.size,0);
    clock.advance(70);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('rocket launch uses its complete selected take at fixed pitch and leaves explosion playback to the impact event',async()=>{
  const {engine,ctx}=setup({effects:{rocket:[{src:'/audio/rocket.wav',gain:.21}],explosion:[{src:'/audio/blast.wav',gain:.4}]}},{random:()=>.9});
  await engine.unlock();await engine.prepareEffect('rocket');await engine.prepareEffect('explosion');
  const allocated=ctx.nodes.length;engine.shoot('rocket');engine.shoot('rocket');
  assert.equal(engine.active.size,2);assert.equal(ctx.nodes.length-allocated,4);
  for(const source of engine.active){assert.equal(source.buffer,engine.buffers.get('/audio/rocket.wav').buffer);assert.equal(source.playbackRate.value,1);assert.equal(source.offset,0);assert.equal(source.stopAt,ctx.currentTime+source.buffer.duration+.03);}
  engine.explosion(.5,{weapon:'rocket'});const blast=[...engine.active].at(-1);
  assert.equal(blast.buffer,engine.buffers.get('/audio/blast.wav').buffer);assert.equal(blast.playbackRate.value,1);assert.equal(blast.connections[0].gain.value,.2);
  engine.stop();assert.equal(engine.active.size,0);
});

test('a rocket impact plays its own owner-chosen explosion take; grenades keep theirs at fixed pitch',async()=>{
  const {engine}=setup({effects:{explosion:[{src:'/audio/grenade.wav',gain:.4}],rocketExplosion:[{src:'/audio/rocket-impact.wav',gain:.4}]}},{random:()=>.5});
  await engine.unlock();await engine.prepareEffect('explosion');await engine.prepareEffect('rocketExplosion');
  engine.explosion(1,{weapon:'rocket'});const rocket=[...engine.active].at(-1);
  assert.equal(rocket.buffer,engine.buffers.get('/audio/rocket-impact.wav').buffer);assert.equal(rocket.playbackRate.value,1);
  engine.explosion(1);const grenade=[...engine.active].at(-1);
  assert.equal(grenade.buffer,engine.buffers.get('/audio/grenade.wav').buffer);
  assert.equal(engine.active.size,2,'a grenade and a rocket can boom together');
  engine.stop();
});

test('new fire samples never replay a stale event after decoding; flame fallback stays continuous until release',async()=>{
  for(const type of ['assault','rocket','flamethrower']){
    const ctx=new Context();let finish;
    const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>({effects:{[type]:[{src:`/audio/${type}.wav`}]}})}:{ok:true,arrayBuffer:()=>new Promise(resolve=>{finish=()=>resolve(new ArrayBuffer(4));})}});
    engine.shoot(type);assert.equal(ctx.nodes.length,0);await engine.unlock();await flush();engine.shoot(type,{held:true});await flush();
    const allocated=ctx.nodes.length,voice=engine.flamethrowerVoice;
    if(type==='flamethrower'){assert.ok(voice?.procedural);assert.equal(voice.source.loop,true);for(let i=0;i<10;i++)engine.shoot(type,{held:true});assert.equal(ctx.nodes.length,allocated);}
    finish();await flush();assert.equal(ctx.nodes.length,allocated);
    if(type==='flamethrower'){assert.equal(engine.flamethrowerVoice,voice);engine.releaseFire(type);ctx.advance(.07);assert.equal(engine.active.size,0);}
    engine.stop();engine.shoot(type,{held:true});
    const source=type==='flamethrower'?engine.flamethrowerVoice.source:type==='assault'?[...engine.assaultVoices.get('local').sources][0]:[...engine.active][0];
    if(type==='assault')assert.notEqual(source.buffer,engine.buffers.get(`/audio/${type}.wav`).buffer);
    else assert.equal(source.buffer,engine.buffers.get(`/audio/${type}.wav`).buffer);
    engine.setVolume(0);assert.equal(engine.active.size,0);const silent=ctx.nodes.length;engine.shoot(type,{held:true});assert.equal(ctx.nodes.length,silent);engine.stop();
  }
});

test('specific assault release preserves flame fire; generic release, reload, mute and leave stop both',async()=>{
  const effects=Object.fromEntries(['assault','flamethrower','reloadSmg','reloadPistol'].map(kind=>[kind,[{src:`/audio/${kind}.wav`}]]));
  const {engine,ctx}=setup({effects});await engine.unlock();for(const kind of Object.keys(effects))await engine.prepareEffect(kind);
  engine.shoot('assault',{held:true});engine.shoot('flamethrower',{held:true});const flame=engine.flamethrowerVoice;
  engine.releaseFire('assault');assert.equal(engine.assaultVoices.size,0);assert.equal(engine.flamethrowerVoice,flame);
  engine.reload('assault',1.6);assert.equal(engine.flamethrowerVoice,null);assert.equal(engine.reloadVoice.type,'assault');
  assert.ok([...engine.reloadVoice.sources].every(source=>source.buffer===engine.buffers.get('/audio/reloadSmg.wav').buffer));
  for(const type of ['rocket','flamethrower']){engine.reload(type,type==='rocket'?2.8:3);assert.equal(engine.reloadVoice.type,type);assert.ok([...engine.reloadVoice.sources].every(source=>source.buffer!==engine.buffers.get('/audio/reloadPistol.wav').buffer));engine.releaseReload();}
  for(const method of ['release','mute','leave']){
    engine.shoot('assault',{held:true});engine.shoot('flamethrower',{held:true});
    if(method==='release'){engine.releaseFire();ctx.advance(.07);}else if(method==='mute')engine.setVolume(0);else engine.updateScene(null,false);
    assert.equal(engine.assaultVoices.size,0);assert.equal(engine.flamethrowerVoice,null);
    if(method==='mute')engine.setVolume(.55);
  }
  engine.stop();assert.equal(engine.active.size,0);
});

test('late short confirmations of flame fire remain bounded single excerpts without sustained voices',async()=>{
  for(const type of ['flamethrower']){
    const {engine,ctx}=setup({effects:{[type]:[{src:`/audio/${type}.wav`}]}});await engine.unlock();await engine.prepareEffect(type);
    engine.singleShot(type);assert.equal(engine.active.size,1);const source=[...engine.active][0];
    assert.equal(source.buffer,engine.buffers.get(`/audio/${type}.wav`).buffer);assert.equal(source.loop,false);assert.equal(source.playbackRate.value,1);
    assert.equal(source.stopAt,ctx.currentTime+.09);assert.equal(engine[`${type}Voice`],null);assert.equal(engine[`${type}Timer`],null);
    ctx.advance(.1);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('tactical music switches only the ambient voice with a fade, reuses decoded choices and stays opt-in',async()=>{
  const {engine,ctx,requests}=setup({music:{ambient:{src:'/audio/original.mp3',gain:.12},tacticalA:{src:'/audio/tactical-resolve-a.mp3',gain:.13},tacticalB:{src:'/audio/tactical-resolve-b.mp3',gain:.14},[MUSIC_THEME_CATALOG[DEFAULT_MUSIC_THEME]]:{src:'/audio/default-theme.mp3',gain:.17},brute:{src:'/audio/brute.mp3',gain:.15},finale:{src:'/audio/finale.mp3',gain:.16}}});
  assert.equal(engine.musicTheme,DEFAULT_MUSIC_THEME);assert.equal(engine.musicThemeStatus(),'locked');
  assert.equal(engine.setMusicTheme('invalid'),false);assert.equal(engine.setMusicTheme('original'),false,'the original is no longer a choice');
  assert.equal(engine.musicTheme,DEFAULT_MUSIC_THEME);assert.equal(engine.setMusicTheme('tactical-a'),true);
  engine.updateScene(state(),true);assert.equal(requests.length,0);
  await engine.unlock();await flush();
  assert.equal(engine.music.ambient.key,'/audio/tactical-resolve-a.mp3');assert.equal(engine.musicThemeStatus(),'local');
  assert.equal(requests.some(item=>item.url==='/audio/original.mp3'),false,'unselected original is not prefetched');
  assert.equal(requests.some(item=>item.url==='/audio/default-theme.mp3'),false,'unselected default is not prefetched');
  assert.equal(requests.some(item=>item.url==='/audio/tactical-resolve-b.mp3'),false,'unselected B is not prefetched');
  const before=engine.music.ambient,brute=engine.music.brute;
  engine.setMusicTheme('tactical-b');await flush();
  assert.equal(engine.music.ambient.key,'/audio/tactical-resolve-b.mp3');
  assert.ok(before.level.gain.events.some(([type,value,time])=>type==='ramp'&&value===0&&time===ctx.currentTime+1.5));
  assert.equal(before.source.stopAt,ctx.currentTime+1.6);assert.equal(engine.music.brute,brute);
  engine.updateScene({...state(true),wave:MAX_WAVES},true);await flush();const finale=engine.music.finale;
  assert.equal(engine.setMusicTheme('original'),false);assert.equal(engine.musicTheme,'tactical-b');
  engine.setMusicTheme(DEFAULT_MUSIC_THEME);await flush();assert.equal(engine.music.ambient.key,'/audio/default-theme.mp3');assert.equal(engine.music.finale,finale);
  assert.equal(engine.music.finale.target,.16);assert.equal(engine.music.ambient.target,0);
  engine.setMusicTheme('tactical-a');await flush();
  assert.equal(requests.filter(item=>item.url==='/audio/tactical-resolve-a.mp3').length,1);
  assert.equal(requests.some(item=>item.url==='/audio/original.mp3'),false,'the original loads only as a fallback');
  engine.stop();
});

test('missing tactical assets retain the original, report absence and do not refetch each snapshot',async()=>{
  const {engine,requests}=setup({music:{ambient:{src:'/audio/original.mp3'},tacticalA:{src:'/audio/missing.mp3'}}},{fetcher:async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>({music:{ambient:{src:'/audio/original.mp3'},tacticalA:{src:'/audio/missing.mp3'}}})}:{ok:url!=='/audio/missing.mp3',arrayBuffer:async()=>new ArrayBuffer(4)}});
  const calls=[],fetcher=engine.fetcher;engine.fetcher=(url,options)=>{calls.push(url);return fetcher(url,options);};
  engine.setMusicTheme('tactical-a');engine.updateScene(state(),true);await engine.unlock();await flush();
  assert.equal(engine.musicThemeStatus(),'missing');assert.equal(engine.music.ambient.key,'/audio/original.mp3');
  for(let i=0;i<12;i++)engine.updateScene(state(),true);await flush();
  assert.equal(calls.filter(url=>url==='/audio/missing.mp3').length,1);
  engine.setMusicTheme('tactical-b');assert.equal(engine.musicThemeStatus(),'missing');assert.equal(engine.music.ambient.key,'/audio/original.mp3');
  engine.stop();assert.equal(requests.length,0);
  // The default theme falls back the same way: the original file is kept for this.
  const music={ambient:{src:'/audio/original.mp3'},[MUSIC_THEME_CATALOG[DEFAULT_MUSIC_THEME]]:{src:'/audio/missing-default.mp3'}};
  const fallback=setup({},{fetcher:async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>({music})}:{ok:url!=='/audio/missing-default.mp3',arrayBuffer:async()=>new ArrayBuffer(4)}}).engine;
  assert.equal(fallback.musicTheme,DEFAULT_MUSIC_THEME);fallback.updateScene(state(),true);await fallback.unlock();await flush();
  assert.equal(fallback.musicThemeStatus(),'missing');assert.equal(fallback.music.ambient.key,'/audio/original.mp3');
  fallback.stop();
});

test('late tactical decoding cannot override a newer theme or resurrect audio after mute or leave',async()=>{
  for(const ending of ['switch','mute','leave']){
    const ctx=new Context();let finish;
    const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>({music:{ambient:{src:'/audio/original.mp3'},[MUSIC_THEME_CATALOG[DEFAULT_MUSIC_THEME]]:{src:'/audio/default-theme.mp3'},tacticalA:{src:'/audio/delayed.mp3'}}})}:{ok:true,arrayBuffer:()=>url==='/audio/delayed.mp3'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(new ArrayBuffer(4))}});
    engine.setMusicTheme('tactical-a');engine.updateScene(state(),true);await engine.unlock();await flush();
    assert.equal(engine.musicThemeStatus(),'loading');
    if(ending==='switch'){engine.setMusicTheme(DEFAULT_MUSIC_THEME);await flush();}
    else if(ending==='mute')engine.setVolume(0);
    else engine.updateScene(null,false);
    finish(new ArrayBuffer(4));await flush();
    if(ending==='switch')assert.equal(engine.music.ambient.key,'/audio/default-theme.mp3');
    else{assert.equal(engine.active.size,0);assert.equal(engine.music.ambient,null);}
    engine.stop();
  }
});

test('audio remains silent and makes no request before a user unlock; generated music routes through the master',async()=>{
  const {engine,ctx,requests}=setup();engine.updateScene(state(),true);engine.shoot('pistol');
  assert.equal(requests.length,0);assert.equal(ctx.nodes.length,0);
  await engine.unlock();await flush();
  assert.equal(requests[0].url,'/audio/manifest.json');assert.equal(ctx.state,'running');
  assert.equal(engine.music.ambient.source.loop,true);assert.equal(engine.music.brute.source.loop,true);
  assert.equal(engine.music.ambient.level.connections[0],engine.musicBus);
  assert.equal(engine.musicBus.connections[0],engine.musicVol);assert.equal(engine.musicVol.connections[0],engine.output);assert.equal(engine.output.connections[0],engine.master);
  assert.equal(engine.master.connections[0],ctx.destination);
  assert.ok(engine.music.ambient.source.buffer.getChannelData(0).some(value=>Math.abs(value)>.02));
  engine.stop();
});

test('repeated snapshots reuse both music voices; brute transitions crossfade and announce only once',async()=>{
  const {engine,ctx}=setup();engine.updateScene(state(),true);await engine.unlock();await flush();
  const base=engine.music.ambient.source,heavy=engine.music.brute.source,initialNodes=ctx.nodes.length;
  for(let i=0;i<20;i++)engine.updateScene(state(),true);
  assert.equal(ctx.nodes.length,initialNodes);
  engine.updateScene(state(true),true);const afterEntry=ctx.nodes.length;
  assert.equal(engine.music.ambient.target,0);assert.ok(engine.music.brute.target>0);
  for(let i=0;i<20;i++)engine.updateScene(state(true),true);
  assert.equal(ctx.nodes.length,afterEntry);assert.equal(engine.music.ambient.source,base);assert.equal(engine.music.brute.source,heavy);
  engine.updateScene(state(false),true);assert.ok(engine.music.ambient.target>0);assert.equal(engine.music.brute.target,0);
  engine.stop();
});

test('local music decodes after unlock and replaces the fallback once, while remote manifest paths are ignored',async()=>{
  const {engine,ctx,requests}=setup({music:{ambient:{src:'/audio/base.wav',gain:.12},brute:{src:'https://example.com/music.mp3',gain:1}}});
  engine.updateScene(state(),true);await engine.unlock();await flush();
  assert.ok(requests.some(item=>item.url==='/audio/base.wav'));assert.ok(requests.every(item=>item.url.startsWith('/audio/')));
  assert.equal(engine.music.ambient.key,'/audio/base.wav');assert.equal(engine.music.ambient.target,.12);
  assert.equal(engine.music.brute.key,'synth:brute');assert.equal(ctx.decoded,1);
  const source=engine.music.ambient.source;for(let i=0;i<10;i++)engine.updateScene(state(),true);await flush();
  assert.equal(engine.music.ambient.source,source);assert.equal(requests.filter(item=>item.url==='/audio/base.wav').length,1);
  engine.stop();
});

test('missing assets keep a playable generated score and procedural pistol effect',async()=>{
  const ctx=new Context(),requests=[];
  const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>{requests.push(url);return {ok:false};}});
  engine.updateScene(state(),true);await engine.unlock();await flush();
  assert.equal(engine.music.ambient.key,'synth:ambient');assert.equal(engine.music.brute.key,'synth:brute');
  const before=ctx.nodes.length;engine.shoot('pistol');assert.ok(ctx.nodes.length>before);
  assert.deepEqual(requests,['/audio/manifest.json']);engine.stop();
});

test('sample effects load lazily, vary playback rate, respect cooldown and stop with all music on leave',async()=>{
  const {engine,ctx,requests}=setup({effects:{pistol:[{src:'/audio/pistol.wav',gain:.5}]}});
  engine.updateScene(state(),true);await engine.unlock();await flush();assert.equal(requests.length,1);
  engine.shoot('pistol');await flush();assert.ok(requests.some(item=>item.url==='/audio/pistol.wav'));
  engine.shoot('pistol');const sample=[...engine.active].find(node=>node.buffer===engine.buffers.get('/audio/pistol.wav').buffer);
  assert.ok(sample&&sample.playbackRate.value>=.97&&sample.playbackRate.value<=1.03);
  const before=ctx.nodes.length;engine.shoot('pistol');assert.equal(ctx.nodes.length,before);
  engine.updateScene(null,false);assert.equal(engine.active.size,0);assert.equal(engine.music.ambient,null);assert.equal(engine.music.brute,null);
});

test('grenade samples preserve their pitch, scale distance volume and overlap without a cooldown',async()=>{
  const {engine,ctx}=setup({effects:{explosion:[{src:'/audio/explosion.wav',gain:.6}],pistol:[{src:'/audio/pistol.wav',gain:.2}]}},{random:()=>.8});
  await engine.unlock();await engine.prepareEffect('explosion');await engine.prepareEffect('pistol');
  const allocated=ctx.nodes.length;engine.explosion(.25);engine.explosion(2);
  const sources=[...engine.active];assert.equal(sources.length,2);assert.equal(ctx.nodes.length-allocated,4,'each explosion creates only its sample and gain');
  for(const source of sources){
    assert.equal(source.buffer,engine.buffers.get('/audio/explosion.wav').buffer);assert.equal(source.playbackRate.value,1);
    assert.equal(source.startAt,ctx.currentTime);assert.equal(source.stopAt,ctx.currentTime+source.buffer.duration+.03);
    assert.equal(source.connections[0].connections[0],engine.output);
  }
  assert.equal(sources[0].connections[0].gain.value,.15);assert.equal(sources[1].connections[0].gain.value,.6);
  const before=ctx.nodes.length;for(const value of [0,-1,NaN,Infinity,-Infinity,'1',null])engine.explosion(value);
  assert.equal(ctx.nodes.length,before,'silent or invalid distance volume creates no sources');
  engine.shoot('pistol');assert.notEqual([...engine.active].at(-1).playbackRate.value,1,'other effects retain their existing pitch variation');
  ctx.advance(1.04);assert.equal(engine.active.size,0);engine.stop();
});

test('grenade samples prefetch once during active phases but stay unloaded in a lobby',async()=>{
  const {engine,requests}=setup({effects:{explosion:[{src:'/audio/explosion.wav',gain:.4}]}});
  engine.explosion();assert.equal(requests.length,0);await engine.unlock();await flush();
  engine.updateScene(state(false,'lobby'),true);await flush();assert.equal(requests.length,1);
  for(const phase of ['countdown','wave','intermission']){engine.updateScene(state(false,phase),true);await flush();}
  assert.equal(requests.filter(item=>item.url==='/audio/explosion.wav').length,1);
  const buffer=engine.buffers.get('/audio/explosion.wav').buffer;assert.ok(buffer);
  assert.ok([...engine.active].every(source=>source.buffer!==buffer),'prefetching does not play an explosion');engine.stop();
});

test('an undecoded grenade uses an immediate fallback without playing a late explosion after decoding',async()=>{
  const ctx=new Context();let complete;
  const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url==='/audio/manifest.json'?
    {ok:true,json:async()=>({effects:{explosion:[{src:'/audio/explosion.wav',gain:.4}]}})}:
    {ok:true,arrayBuffer:()=>new Promise(resolve=>{complete=()=>resolve(new ArrayBuffer(4));})}});
  await engine.unlock();await flush();engine.explosion(.5);await flush();
  const fallback=[...engine.active];assert.equal(fallback.length,4);assert.ok(fallback.some(source=>source.type==='triangle'));
  assert.ok(fallback.filter(source=>source.type==='buffer').every(source=>source.buffer===engine.noiseBuffer));
  const allocated=ctx.nodes.length;complete();await flush();assert.equal(ctx.nodes.length,allocated,'decoding cannot replay an old event');
  ctx.advance(1);assert.equal(engine.active.size,0);engine.explosion(.5);
  assert.equal(engine.active.size,1);assert.equal([...engine.active][0].buffer,engine.buffers.get('/audio/explosion.wav').buffer);engine.stop();
});

test('missing grenade files retain the bounded fallback, while mute and leaving release both audio paths',async()=>{
  for(const available of [false,true]){
    const ctx=new Context(),engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url==='/audio/manifest.json'?
      {ok:true,json:async()=>({effects:{explosion:[{src:'/audio/explosion.wav',gain:.4}]}})}:
      {ok:available,arrayBuffer:async()=>new ArrayBuffer(4)}});
    await engine.unlock();assert.equal(await engine.prepareEffect('explosion'),available);engine.explosion();assert.equal(engine.active.size,available?1:4);
    engine.setVolume(0);assert.equal(engine.active.size,0);const allocated=ctx.nodes.length;engine.explosion();assert.equal(ctx.nodes.length,allocated);
    engine.setVolume(.55);engine.explosion();assert.equal(engine.active.size,available?1:4);
    engine.updateScene(null,false);assert.equal(engine.active.size,0);ctx.advance(2);assert.equal(engine.active.size,0);engine.stop();
  }
});

test('stop and mute release sources, and a later game or unmute can start fresh voices without refetching',async()=>{
  const {engine,requests}=setup();engine.updateScene(state(),true);await engine.unlock();await flush();
  const old=engine.music.ambient.source;engine.stop();assert.equal(engine.active.size,0);
  engine.updateScene(state(),true);assert.notEqual(engine.music.ambient.source,old);
  engine.setVolume(0);assert.equal(engine.active.size,0);engine.updateScene(state(true),true);assert.equal(engine.active.size,0);
  engine.shoot('pistol');engine.groan();engine.boardBreak();assert.equal(engine.active.size,0);
  engine.setVolume(.4);assert.ok(engine.music.ambient&&engine.music.brute);assert.equal(engine.master.gain.value,.4);
  assert.equal(requests.filter(item=>item.url==='/audio/manifest.json').length,1);engine.stop();
});

test('asynchronous decoding cannot resurrect audio after leaving a game',async()=>{
  const ctx=new Context();let finish;
  const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url.endsWith('manifest.json')?
    {ok:true,json:async()=>({music:{ambient:{src:'/audio/delayed.wav'}}})}:
    {ok:true,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}});
  engine.updateScene(state(),true);await engine.unlock();await flush();engine.stop();finish(new ArrayBuffer(4));await flush();
  assert.equal(engine.active.size,0);assert.equal(engine.music.ambient,null);assert.equal(engine.inGame,false);
});

test('the final-wave score outranks the brute score and a boss announces once per arrival',async()=>{
  const {engine}=setup({music:{finale:{src:'/audio/finale.wav',gain:.16}}});
  engine.updateScene({...state(true),wave:MAX_WAVES-1},true);await engine.unlock();await flush();
  assert.ok(engine.music.brute.target>0);assert.equal(engine.music.finale,null);
  engine.updateScene({...state(true),wave:MAX_WAVES},true);await flush();
  assert.equal(engine.music.finale.key,'/audio/finale.wav');assert.equal(engine.music.finale.target,.16);
  assert.equal(engine.music.brute.target,0);assert.equal(engine.music.ambient.target,0);
  let announcements=0;engine.boss=()=>announcements++;
  const boss={phase:'wave',wave:MAX_WAVES,zombies:[{id:'boss',kind:'brute',boss:true}]};
  for(let i=0;i<30;i++)engine.updateScene(boss,true);assert.equal(announcements,1);
  engine.updateScene({...boss,phase:'victory'},true);assert.equal(engine.music.finale,null);
  engine.stop();
});

test('footsteps follow authoritative distance and stay silent when stationary, paused, airborne or teleported',async()=>{
  const {engine,ctx}=setup();engine.updateScene(state(),true);await engine.unlock();await flush();
  const self={id:'p',x:0,z:0,alive:true,grounded:true,outside:false};
  engine.updateFootsteps(self);const baseline=ctx.nodes.length;
  self.x=.5;engine.updateFootsteps(self);assert.equal(ctx.nodes.length,baseline);
  self.x=1;engine.updateFootsteps(self);const walking=ctx.nodes.length;assert.ok(walking>baseline);
  ctx.advance(2);for(let i=0;i<30;i++)engine.updateFootsteps(self);assert.equal(ctx.nodes.length,walking);
  self.x=1.8;engine.updateFootsteps(self,false);self.x=2.5;engine.updateFootsteps(self,true);assert.equal(ctx.nodes.length,walking);
  self.x=3.5;engine.updateFootsteps(self);assert.ok(ctx.nodes.length>walking);
  const beforeAir=ctx.nodes.length;self.grounded=false;self.x=4.5;engine.updateFootsteps(self);assert.equal(ctx.nodes.length,beforeAir);
  self.grounded=true;engine.updateFootsteps(self);self.x=40;engine.updateFootsteps(self);assert.equal(ctx.nodes.length,beforeAir);
  engine.stop();
});

test('a failed asset decode preserves the generated soundtrack and does not retry every snapshot',async()=>{
  const {engine,ctx,requests}=setup({music:{ambient:{src:'/audio/unsupported.wav'}}});
  ctx.decodeAudioData=async()=>{throw new Error('unsupported fixture');};
  engine.updateScene(state(),true);await engine.unlock();await flush();
  for(let i=0;i<20;i++)engine.updateScene(state(),true);await flush();
  assert.equal(engine.music.ambient.key,'synth:ambient');assert.ok(engine.music.ambient.target>0);
  assert.equal(requests.filter(item=>item.url==='/audio/unsupported.wav').length,1);engine.stop();
});

function timers(ctx) {
  const pending=new Map();let nextId=0,time=0;
  return {
    pending,
    schedule(callback,delay){const id=++nextId;pending.set(id,{callback,at:time+delay});return id;},
    cancel(id){pending.delete(id);},
    advance(milliseconds){time+=milliseconds;ctx.advance(milliseconds/1000);for(const [id,task] of pending)if(task.at<=time){pending.delete(id);task.callback();}},
  };
}

test('a minigun burst sustains one mechanical voice instead of overlapping a sound for every round',async()=>{
  const {engine,ctx}=setup();const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();const baseline=ctx.nodes.length;
  engine.shoot('minigun');const voice=engine.minigunVoice,started=ctx.nodes.length;
  assert.ok(started>baseline);assert.equal(engine.active.size,3);
  for(let i=0;i<9;i++){clock.advance(55);engine.shoot('minigun');}
  assert.equal(engine.minigunVoice,voice);assert.equal(ctx.nodes.length,started);assert.equal(clock.pending.size,1);
  clock.advance(149);assert.equal(engine.minigunVoice,voice);
  clock.advance(1);assert.equal(engine.minigunVoice,null);assert.equal(clock.pending.size,0);
  clock.advance(140);assert.equal(engine.active.size,0);
  engine.shoot('minigun');assert.notEqual(engine.minigunVoice,voice);engine.stop();assert.equal(clock.pending.size,0);
});

test('mute and stop cancel a minigun motor and its silence timer without restarting it later',async()=>{
  const {engine,ctx}=setup();const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();engine.shoot('minigun');engine.setVolume(0);
  assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);assert.equal(engine.minigunVoice,null);
  clock.advance(500);engine.shoot('minigun');assert.equal(engine.active.size,0);
  engine.setVolume(.4);engine.shoot('minigun');assert.equal(engine.active.size,3);
  engine.stop();clock.advance(500);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);
});

test('a local shotgun impact stays immediate and retains delayed pump mechanics without a second generated impact',async()=>{
  const {engine,ctx}=setup({effects:{shotgun:[{src:'/audio/shotgun.wav',gain:.6}]}});
  await engine.unlock();await flush();engine.shoot('shotgun');await flush();ctx.advance(2);
  const now=ctx.currentTime,impact=engine.buffers.get('/audio/shotgun.wav').buffer;
  engine.shoot('shotgun');
  const sources=[...engine.active],sample=sources.filter(source=>source.buffer===impact);
  assert.equal(sample.length,1);assert.equal(sample[0].startAt,now);
  const mechanics=sources.filter(source=>source.buffer===engine.noiseBuffer);
  assert.ok(mechanics.length>=2);assert.ok(mechanics.every(source=>source.startAt>now));
  assert.ok(mechanics.some(source=>source.startAt>now+.1));engine.stop();
});

test('the selected shotgun pump retains the complete one-second take at fixed pitch and leaves the report and R reload intact',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.effects.shotgun[0].src,'/audio/shotgun-heavy-2.wav');
  assert.equal(manifest.effects.reloadShotgun[0].src,'/audio/reload-shotgun.wav');
  assert.equal(manifest.effects.shotgunPump[0].src,'/audio/reload-shotgun-click-3.wav');
  const bytes=readFileSync(new URL('../public/audio/reload-shotgun-click-3.wav',import.meta.url));
  const {engine,ctx}=setup(manifest,{random:()=>.9});
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);
  await engine.unlock();await engine.prepareEffect('shotgun');await engine.prepareEffect('shotgunPump');
  const sample=engine.buffers.get(manifest.effects.shotgunPump[0].src).buffer,copy=sample.getChannelData(0).slice();
  assert.equal(sample.duration,1);assert.equal(sample.sampleRate,44100);assert.equal(sample.numberOfChannels,1);
  engine.shoot('shotgun',{voiceId:'survivor'});
  const sources=[...engine.active],pump=[...engine.pumpVoices.get('survivor').sources];
  assert.equal(sources.length,2,'only the selected report and pump play, without duplicate procedural mechanics');
  assert.equal(pump.length,1);assert.equal(pump[0].buffer,sample);assert.equal(pump[0].playbackRate.value,1);
  assert.equal(pump[0].startAt,.12);assert.equal(pump[0].offset,0);assert.equal(pump[0].stopAt,1.12);
  assert.equal(pump[0].connections[0].gain.value,.29);assert.deepEqual(sample.getChannelData(0),copy);
  ctx.advance(1.13);assert.equal(engine.pumpVoices.size,0);assert.equal(engine.active.size,0);engine.stop();
});

test('shotgun pumps belong to individual shooters and the next shot cancels only that shooter’s old cycle',async()=>{
  const {engine,ctx}=setup({effects:{shotgunPump:[{src:'/audio/pump.wav',gain:.29}]}});
  await engine.unlock();await engine.prepareEffect('shotgunPump');
  engine.shotgunPump('a');engine.shotgunPump('b');
  const first=[...engine.pumpVoices.get('a').sources][0],other=[...engine.pumpVoices.get('b').sources][0];
  assert.equal(engine.pumpVoices.size,2);assert.equal(first.startAt,other.startAt);
  engine.releaseFire();assert.equal(engine.pumpVoices.size,2,'releasing the trigger must preserve the confirmed shot’s mechanical cycle');
  ctx.advance(.85);engine.shotgunPump('a');
  const next=[...engine.pumpVoices.get('a').sources][0];
  assert.notEqual(first,next);assert.ok(first.stopAt<=ctx.currentTime+.025);assert.equal(other.stopAt,1.12);
  ctx.advance(.03);assert.ok(!engine.active.has(first));assert.ok(engine.active.has(other));
  assert.equal(engine.pumpVoices.get('a').sources.has(next),true,'old onended cannot clear a new cycle');
  engine.releasePump('a');assert.ok(engine.pumpVoices.has('b'));ctx.advance(2);
  assert.equal(engine.active.size,0);assert.equal(engine.pumpVoices.size,0);engine.stop();
});

test('an undecoded pump falls back once without playing the selected sample late',async()=>{
  const ctx=new Context();let complete;
  const engine=new SoundEngine({contextFactory:()=>ctx,fetcher:async url=>url==='/audio/manifest.json'?
    {ok:true,json:async()=>({effects:{shotgunPump:[{src:'/audio/pump.wav',gain:.29}]}})}:
    {ok:true,arrayBuffer:()=>new Promise(resolve=>{complete=()=>resolve(new ArrayBuffer(4));})}});
  assert.equal(engine.shotgunPump(),false);assert.equal(ctx.nodes.length,0);
  await engine.unlock();await flush();assert.equal(engine.shotgunPump(),false);await flush();
  const voice=engine.pumpVoices.get('local');assert.equal(voice.sources.size,3);
  assert.ok([...voice.sources].every(source=>source.startAt>=.12));
  const allocated=ctx.nodes.length;complete();await flush();assert.equal(ctx.nodes.length,allocated);
  ctx.advance(.5);assert.equal(engine.pumpVoices.size,0);
  assert.equal(engine.shotgunPump(),true);assert.equal(engine.pumpVoices.get('local').sources.size,1);engine.stop();
});

test('pump cancellation before its start, R reload, mute and leaving cannot replay a delayed cycle',async()=>{
  for(const cancel of [engine=>engine.releasePump('local'),engine=>engine.reload('shotgun',2.4),engine=>engine.setVolume(0),engine=>engine.updateScene(null,false)]) {
    const {engine,ctx}=setup({effects:{shotgunPump:[{src:'/audio/pump.wav',gain:.29}],reloadShotgun:[{src:'/audio/reload-shotgun.wav',gain:.29}]}});
    await engine.unlock();await engine.prepareEffect('shotgunPump');await engine.prepareEffect('reloadShotgun');
    engine.shotgunPump();const source=[...engine.pumpVoices.get('local').sources][0];
    cancel(engine);assert.equal(engine.pumpVoices.size,0);assert.ok(source.stopAt<source.startAt);
    const allocated=ctx.nodes.length;ctx.advance(3);assert.equal(ctx.nodes.length,allocated);assert.ok(!engine.active.has(source));engine.stop();
  }
});

test('an active unlocked game silently prepares monster cries and equipped weapons before their first use',async()=>{
  const {engine,ctx,requests}=setup({effects:{
    brute:[{src:'/audio/brute.wav',gain:.4}],boss:[{src:'/audio/boss.wav',gain:.5}],
    pistol:[{src:'/audio/pistol.wav',gain:.5}],shotgun:[{src:'/audio/shotgun.wav',gain:.6}],shotgunPump:[{src:'/audio/pump.wav',gain:.29}],
  }});
  const waiting={...state(),players:[{id:'p',weapon:'pistol'}]};
  engine.updateScene({...waiting,phase:'lobby'},true);assert.equal(requests.length,0);
  await engine.unlock();await flush();assert.equal(requests.length,1,'lobby must not prepare effects');
  engine.updateScene(waiting,true);await flush();
  for(const src of ['/audio/brute.wav','/audio/boss.wav','/audio/pistol.wav'])assert.ok(engine.buffers.get(src)?.buffer);
  assert.equal(requests.some(request=>request.url==='/audio/shotgun.wav'),false);
  assert.equal(requests.some(request=>request.url==='/audio/pump.wav'),false);
  assert.equal(engine.active.size,2,'preparation must not play effects');
  engine.updateScene({...waiting,zombies:[{id:'brute',kind:'brute'}]},true);
  assert.ok([...engine.active].some(source=>source.buffer===engine.buffers.get('/audio/brute.wav').buffer));
  engine.shoot('pistol');assert.ok([...engine.active].some(source=>source.buffer===engine.buffers.get('/audio/pistol.wav').buffer));
  engine.updateScene({...waiting,players:[{id:'p',weapon:'shotgun'}]},true);await flush();
  assert.ok(engine.buffers.get('/audio/shotgun.wav')?.buffer);
  assert.ok(engine.buffers.get('/audio/pump.wav')?.buffer);
  const decoded=ctx.decoded;for(let i=0;i<20;i++)engine.updateScene(waiting,true);await flush();assert.equal(ctx.decoded,decoded);
  engine.stop();
});

test('raider gunfire plays the selected takes at fixed pitch on its own voices, cooldown and cap, never silencing a local shot',async()=>{
  const manifest={effects:{pistol:[{src:'/audio/pistol.wav',gain:.5}],shotgun:[{src:'/audio/shotgun.wav',gain:.65}],shotgunPump:[{src:'/audio/pump.wav',gain:.29}],
    assault:[{src:'/audio/assault.wav',gain:.389,grain:{start:.1,end:.195,fadeIn:.001,fadeOut:.012}}],smg:[{src:'/audio/smg.wav',gain:.9}],rifle:[{src:'/audio/rifle.wav',gain:.3}]}};
  const {engine,ctx,requests}=setup(manifest);await engine.unlock();
  for(const kind of ['pistol','shotgun','assault','smg','rifle'])await engine.prepareEffect(kind);
  const buffer=src=>engine.buffers.get(src).buffer,voice=id=>[...engine.raiderVoices.get(id).sources][0];
  assert.equal(engine.raiderShot('pistol',{voiceId:'r1',volume:.5,pan:-.4}),true);
  const pistol=voice('r1');
  assert.equal(pistol.buffer,buffer('/audio/pistol.wav'));assert.equal(pistol.playbackRate.value,1,'no pitch shift');assert.equal(pistol.loop,false);
  assert.ok(Math.abs(pistol.connections[0].gain.value-.5*.6*.5)<1e-9,'0.6 of the player mix, scaled by the distance volume');
  engine.shoot('pistol');
  assert.equal([...engine.active].filter(source=>source.buffer===buffer('/audio/pistol.wav')).length,2,'a local shot right after a raider shot still plays');
  assert.equal(engine.raiderShot('pistol',{voiceId:'r2'}),true,'and a local shot never silences a raider');
  assert.equal(engine.raiderShot('pistol',{voiceId:'r1'}),false,'each raider has its own short cooldown');
  ctx.advance(.031);
  assert.equal(engine.raiderShot('pistol',{voiceId:'r1'}),true);
  assert.ok(pistol.stopAt<=ctx.currentTime+.012+1e-9,'a new shot cuts that raider’s previous tail');
  assert.deepEqual(pistol.connections[0].gain.events.at(-1).slice(0,2),['ramp',0]);
  assert.equal(engine.raiderShot('shotgun',{voiceId:'r3'}),true);
  assert.equal(voice('r3').buffer,buffer('/audio/shotgun.wav'));assert.equal(voice('r3').stopAt,ctx.currentTime+buffer('/audio/shotgun.wav').duration);
  assert.equal(engine.pumpVoices.size,0,'a raider shotgun has no pump');
  assert.equal(requests.some(request=>request.url==='/audio/pump.wav'),false);
  assert.equal(engine.raiderShot('assault',{voiceId:'r4'}),true);
  assert.ok(Math.abs(voice('r4').buffer.duration-.095)<1/8000,'the 95 ms assault grain');
  engine.shoot('assault',{voiceId:'local'});
  assert.equal([...engine.assaultVoices.get('local').sources][0].buffer,voice('r4').buffer,'the same cached grain as survivors');
  for(const [kind,id] of [['smg','r5'],['rifle','r6']]){
    assert.equal(engine.raiderShot(kind,{voiceId:id}),true);
    const excerpt=voice(id);
    assert.equal(excerpt.buffer,buffer(`/audio/${kind}.wav`));assert.equal(excerpt.loop,false);
    assert.ok(Math.abs(excerpt.stopAt-ctx.currentTime-.09)<1e-9,`${kind}: the 85 ms single-shot excerpt`);
    assert.deepEqual(excerpt.connections[0].gain.events.at(-1),['ramp',0,ctx.currentTime+.085]);
  }
  assert.equal(engine.smgVoice,null);assert.equal(engine.rifleVoice,null,'never the survivors’ shared sustained voices');
  assert.equal(engine.raiderShot('rocket',{voiceId:'r9'}),false,'raiders carry no rocket audio');
  engine.releaseFire();engine.releasePump();engine.releaseAssault();
  assert.deepEqual([...engine.raiderVoices.keys()],['r2','r1','r3','r4','r5','r6'],'player releases never reach raider voices');
  for(let index=7;index<=12;index++)engine.raiderShot('pistol',{voiceId:`r${index}`});
  assert.deepEqual([...engine.raiderVoices.keys()],['r3','r4','r5','r6','r7','r8','r9','r10','r11','r12'],'ten raider sources at most; the oldest give way');
  engine.releaseRaider('r3');assert.equal(engine.raiderVoices.has('r3'),false);assert.equal(engine.raiderVoices.size,9);
  engine.setVolume(0);assert.equal(engine.raiderVoices.size,0,'mute releases every raider voice');
  engine.setVolume(.5);ctx.advance(.04);engine.raiderShot('pistol',{voiceId:'r1'});engine.stop();
  assert.equal(engine.raiderVoices.size,0);assert.equal(engine.active.size,0);assert.equal(engine.raiderLast.size,0);

  const panned=setup(manifest);panned.ctx.createStereoPanner=()=>{const node=new Node(panned.ctx,'panner');node.pan=new Param();return node;};
  await panned.engine.unlock();await panned.engine.prepareEffect('pistol');
  panned.engine.raiderShot('pistol',{voiceId:'r1',pan:-3});
  const panner=panned.ctx.nodes.find(node=>node.type==='panner');
  assert.equal(panner.pan.value,-1);assert.equal([...panned.engine.raiderVoices.get('r1').sources][0].connections[0].connections[0],panner);
  assert.equal(panner.connections[0],panned.engine.output);panned.engine.stop();

  const cold=setup(manifest);await cold.engine.unlock();await cold.engine.loadManifest();
  const nodes=cold.ctx.nodes.length;
  assert.equal(cold.engine.raiderShot('smg',{voiceId:'r1'}),false);
  assert.equal(cold.ctx.nodes.length,nodes,'an undecoded take stays silent, with no procedural stand-in');
  await flush();assert.equal(cold.engine.active.size,0,'and never plays late once decoded');cold.engine.stop();
});

test('raid waves preload exactly the five raider takes, and the alarm sounds once per raid with squad squelches',async()=>{
  const effects={};for(const kind of ['pistol','smg','shotgun','assault','rifle','shotgunPump','reloadSmg','reloadPistol','reloadShotgun','reloadRifle'])effects[kind]=[{src:`/audio/${kind}.wav`}];
  const {engine,ctx,requests}=setup({effects});
  const fetched=()=>requests.map(request=>request.url).filter(url=>url!=='/audio/manifest.json');
  const scene=(raid,extra={})=>({...state(),players:[{id:'p',weapon:'katana'}],raid,...extra});
  await engine.unlock();await flush();
  engine.updateScene(scene(null),true);await flush();
  assert.deepEqual(fetched(),[],'no raider take before a raid wave');
  engine.updateScene(scene({index:1,triggered:false,cleared:false}),true);await flush();
  assert.deepEqual(fetched().sort(),['/audio/assault.wav','/audio/pistol.wav','/audio/rifle.wav','/audio/shotgun.wav','/audio/smg.wav']);
  for(let index=0;index<10;index++)engine.updateScene(scene({index:1,triggered:false,cleared:false}),true);await flush();
  assert.equal(fetched().length,5,'each take once, never a pump or a reload');
  const drill=setup({effects});await drill.engine.unlock();await flush();
  drill.engine.updateScene({...scene(null),zombies:[{id:'r1',kind:'raider',hp:140}]},true);await flush();
  assert.equal(drill.requests.filter(request=>request.url!=='/audio/manifest.json').length,5,'stand drill raiders are prepared too');drill.engine.stop();

  const alarms=[],alarm=engine.raidAlarm.bind(engine);
  engine.raidAlarm=(options={})=>{const played=alarm(options);if(played)alarms.push(options.squad===true?'squad':'raid');return played;};
  const nodes=ctx.nodes.length;
  for(let index=0;index<20;index++)engine.updateScene(scene({index:1,triggered:true,cleared:false}),true);
  assert.deepEqual(alarms,['raid'],'snapshots announce the raid once');
  const played=ctx.nodes.slice(nodes).map(node=>[node.type,node.frequency.events[0]?.[1],node.frequency.events[0]?.[2]]);
  assert.deepEqual(played.filter(([type])=>type!=='gain'&&type!=='buffer'),[['bandpass',1900,0],['highpass',3600,.13],['lowpass',520,.2],['sawtooth',73.42,.2],['sawtooth',103.83,.2]],
    'a radio squelch around 1.9 kHz, then a low tritone through a lowpass');
  assert.equal(engine.music.brute.target,0,'the music is unchanged');
  assert.equal(engine.raidAlarm({squad:true}),false,'a squad squelch never doubles a fresh alarm');
  ctx.advance(4);assert.equal(engine.raidAlarm({squad:true}),true);assert.equal(engine.raidAlarm({squad:true}),false,'squads share a 4 s cooldown');
  engine.updateScene(scene({index:1,triggered:true,cleared:false}),false);engine.updateScene(scene({index:1,triggered:true,cleared:false}),true);
  assert.deepEqual(alarms,['raid','squad'],'resuming a pause does not replay the alarm');
  engine.updateScene(scene({index:1,triggered:true,cleared:true}),true);ctx.advance(5);
  assert.equal(engine.raidAlarm(),true,'a delivered raid event sounds at once');
  engine.updateScene(scene({index:2,triggered:true,cleared:false}),true);
  assert.deepEqual(alarms,['raid','squad','raid'],'and its snapshot does not repeat it');
  engine.updateScene(scene(null),true);ctx.advance(5);engine.updateScene(scene({index:3,triggered:true,cleared:false}),true);
  assert.deepEqual(alarms,['raid','squad','raid','raid'],'a missed event still announces the raid');
  engine.stop();
  assert.equal(engine.raidAnnounced,false);assert.equal(engine.lastRaidAlarmAt,-Infinity);assert.equal(engine.lastRaidSquelchAt,-Infinity);
});

test('a sustained machine gun keeps one complete PCM loop across ten shots and fades when the burst stops',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/heavy-rifle-3.wav',gain:.65}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  ctx.decodeAudioData=async()=>ctx.createBuffer(1,24000,8000);
  await engine.unlock();await flush();engine.shoot('rifle');
  assert.equal(engine.rifleVoice,null,'first undecoded shot must use the immediate procedural fallback');
  assert.ok(engine.active.size>0);await flush();clock.advance(1000);assert.equal(engine.active.size,0);
  engine.shoot('rifle');const voice=engine.rifleVoice,allocated=ctx.nodes.length;
  assert.ok(voice.source.loop);assert.equal(voice.source.buffer.duration,3);
  for(let i=0;i<9;i++){clock.advance(180);engine.shoot('rifle');}
  assert.equal(engine.rifleVoice,voice);assert.equal(ctx.nodes.length,allocated);assert.equal(clock.pending.size,1);
  clock.advance(229);assert.equal(engine.rifleVoice,voice);clock.advance(1);assert.equal(engine.rifleVoice,null);
  clock.advance(70);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);engine.stop();
});

test('confirmed local automatic fire holds one voice across acknowledgement gaps and remote shots until explicit release',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}],smg:[{src:'/audio/smg.wav'}],minigunFire:[{src:'/audio/minigun.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();await flush();
  for(const type of ['rifle','smg','minigun']) {
    await engine.prepareEffect(type==='minigun'?'minigunFire':type);
    engine.shoot(type,{held:true});const voice=engine[`${type}Voice`],allocated=ctx.nodes.length;
    assert.ok(voice);assert.equal(voice.held,true);assert.equal(clock.pending.size,0);
    clock.advance(360);engine.shoot(type);clock.advance(2500);
    assert.equal(engine[`${type}Voice`],voice,'remote events must not restore the timeout on held local fire');
    assert.equal(ctx.nodes.length,allocated);assert.equal(clock.pending.size,0);
    engine.releaseFire(type);clock.advance(150);assert.equal(engine[`${type}Voice`],null);assert.equal(engine.active.size,0);
    engine.shoot(type);assert.equal(clock.pending.size,1,'later remote fire must regain its bounded watchdog');
    clock.advance(440);assert.equal(engine[`${type}Voice`],null);clock.advance(150);assert.equal(engine.active.size,0);
  }
  engine.stop();
});

test('mute, reload and leave clear held automatic voices without leaving an immortal held state',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();await engine.prepareEffect('rifle');
  for(const action of ['mute','reload','leave']) {
    engine.shoot('rifle',{held:true});assert.equal(engine.rifleVoice.held,true);
    if(action==='mute'){engine.setVolume(0);engine.setVolume(.55);}
    else if(action==='reload'){engine.reload('rifle',1.65);engine.releaseReload();}
    else engine.updateScene(null,false);
    assert.equal(engine.rifleVoice,null);engine.shoot('rifle');assert.equal(engine.rifleVoice.held,false);
    clock.advance(230);assert.equal(engine.rifleVoice,null);engine.stop();
  }
});

test('remote automatic fire survives one missing confirmation but always stops within its bounded watchdog',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}],smg:[{src:'/audio/smg.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();
  for(const [type,gap,timeout] of [['rifle',180,230],['smg',170,200]]) {
    await engine.prepareEffect(type);engine.shoot(type);const voice=engine[`${type}Voice`];
    for(let i=0;i<6;i++){clock.advance(gap);assert.equal(engine[`${type}Voice`],voice);engine.shoot(type);}
    clock.advance(timeout-1);assert.equal(engine[`${type}Voice`],voice);
    clock.advance(1);assert.equal(engine[`${type}Voice`],null);clock.advance(70);assert.equal(engine.active.size,0);
  }
  engine.stop();
});

function wavBuffer(ctx,bytes) {
  assert.equal(bytes.toString('ascii',0,4),'RIFF');let format,data;
  for(let offset=12;offset+8<=bytes.length;) {
    const size=bytes.readUInt32LE(offset+4),id=bytes.toString('ascii',offset,offset+4);
    if(id==='fmt ')format={codec:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),rate:bytes.readUInt32LE(offset+12),bits:bytes.readUInt16LE(offset+22)};
    if(id==='data')data=bytes.subarray(offset+8,offset+8+size);
    offset+=8+size+(size%2);
  }
  assert.equal(format.codec,1);assert.equal(format.bits,16);
  const result=ctx.createBuffer(format.channels,data.length/(2*format.channels),format.rate);
  for(let channel=0;channel<format.channels;channel++) {
    const values=result.getChannelData(channel);
    for(let i=0;i<values.length;i++)values[i]=data.readInt16LE((i*format.channels+channel)*2)/32768;
  }
  return result;
}

test('the selected machine-gun recording loops its sustained PCM without the decaying tail, clipping or source mutation',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.effects.rifle[0].src,'/audio/heavy-rifle-bass-2.wav');
  const {engine,ctx}=setup(manifest),clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  const bytes=readFileSync(new URL('../public/audio/heavy-rifle-bass-2.wav',import.meta.url));
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);
  await engine.unlock();await engine.prepareEffect('rifle');
  const original=engine.buffers.get(manifest.effects.rifle[0].src).buffer,copy=original.getChannelData(0).slice();
  engine.shoot('rifle',{held:true});const voice=engine.rifleVoice,loop=voice.source.buffer,pcm=loop.getChannelData(0);
  assert.equal(original.duration,2);assert.equal(loop.duration,1.06);assert.notEqual(loop,original);
  assert.equal(voice.source.playbackRate.value,1);assert.equal(voice.source.loop,true);assert.equal(engine.fireBuffers.size,1);
  assert.deepEqual(original.getChannelData(0),copy,'the selected file and its decoded buffer must remain intact');
  const window=Math.round(loop.sampleRate*.025),rms=[];let peak=0;
  for(let i=0;i<pcm.length;i++)peak=Math.max(peak,Math.abs(pcm[i]));
  for(let start=0;start<pcm.length;start+=window) {
    let energy=0;for(let i=0;i<window;i++)energy+=pcm[(start+i)%pcm.length]**2;
    rms.push(Math.sqrt(energy/window));
  }
  assert.ok(peak<1,'equal-power overlap must fit the existing -3dB headroom');
  assert.ok(Math.min(...rms)>.25,'even the loop seam must retain sustained energy');
  assert.ok(Math.max(...rms)/Math.min(...rms)<2,'no repeat of the quiet end-of-burst tail');
  clock.advance(7200);assert.equal(engine.rifleVoice,voice);engine.releaseFire('rifle');clock.advance(70);
  engine.shoot('rifle',{held:true});assert.equal(engine.rifleVoice.source.buffer,loop,'prepared PCM must be cached across bursts');engine.stop();
});

test('the selected SMG loop removes its quiet tail and joins consecutive shots without mutating or restarting the take',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.effects.smg[0].src,'/audio/smg-3.wav');
  const {engine,ctx}=setup(manifest),clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  const bytes=readFileSync(new URL('../public/audio/smg-3.wav',import.meta.url));
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect('smg');
  const original=engine.buffers.get('/audio/smg-3.wav').buffer,copy=original.getChannelData(0).slice();
  engine.shoot('smg',{held:true});const voice=engine.smgVoice,loop=voice.source.buffer,pcm=loop.getChannelData(0),rate=loop.sampleRate;
  assert.equal(original.duration,2);assert.notEqual(loop,original);
  assert.equal(loop.length,Math.round(.9*rate)-Math.round(.035*rate));
  assert.equal(voice.source.playbackRate.value,1);assert.equal(voice.source.loop,true);assert.equal(engine.fireBuffers.size,1);
  assert.deepEqual(original.getChannelData(0),copy);
  const width=Math.round(rate*.1),hop=Math.round(rate*.005),rms=[];let peak=0;
  for(const value of pcm)peak=Math.max(peak,Math.abs(value));
  // Sliding windows include every seam phase across eight repetitions; short
  // intervals between individual gunshots remain, but the long burst gap does not.
  for(let start=0;start<pcm.length*8;start+=hop){
    let energy=0;for(let i=0;i<width;i++)energy+=pcm[(start+i)%pcm.length]**2;
    rms.push(Math.sqrt(energy/width));
  }
  assert.ok(Math.min(...rms)>.065,'no 100ms quiet tail, including across the seam');
  assert.ok(Math.max(...rms)/Math.min(...rms)<1.8,'the seam does not create a new burst dip or swell');
  assert.ok(peak<1,'the crossfade cannot clip');
  assert.ok(Math.abs(peak-.707916259765625*.85)<1e-6,'trim only the prepared loop to retain the established mix');
  assert.ok(Math.abs(pcm[0]-pcm.at(-1))<.02,'the seam cannot add a hard discontinuity');
  const allocated=ctx.nodes.length;clock.advance(7200);assert.equal(engine.smgVoice,voice);assert.equal(ctx.nodes.length,allocated);
  engine.releaseFire('smg');clock.advance(70);assert.equal(engine.active.size,0);
  engine.shoot('smg',{held:true});assert.equal(engine.smgVoice.source.buffer,loop,'reuse the prepared PCM across later bursts');
  engine.reload('smg',1.5);assert.equal(engine.smgVoice,null);engine.releaseReload();clock.advance(70);
  engine.shoot('smg',{held:true});engine.setVolume(0);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);engine.stop();
});

test('the selected SMG loop safely preserves short decoded sources and respects an explicit replacement profile',async()=>{
  const {engine,ctx}=setup();await engine.unlock();
  const entry={src:'/audio/smg-3.wav'},short=ctx.createBuffer(1,4000,8000),full=ctx.createBuffer(1,16000,8000);
  assert.equal(engine.fireLoopBuffer(entry,short),short,'a different shorter file must not be read outside its PCM');
  const explicit=engine.fireLoopBuffer({...entry,loop:{start:.1,end:.6,crossfade:.02}},full);
  assert.equal(explicit.duration,.48,'explicit metadata takes precedence over the chosen-take default');
  assert.equal(engine.fireLoopBuffer({src:'/audio/another-smg.wav'},full),full,'an unselected take must not inherit guessed timings');engine.stop();
});

test('the selected minigun PCM keeps its first-shot offset and smooths the sustained seam without changing the source',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.effects.minigunFire[0].src,'/audio/minigun-fire.wav');
  const {engine,ctx}=setup(manifest),bytes=readFileSync(new URL('../public/audio/minigun-fire.wav',import.meta.url));
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect('minigunFire');
  const original=engine.buffers.get('/audio/minigun-fire.wav').buffer,pcm=original.getChannelData(0),copy=pcm.slice(),rate=original.sampleRate;
  engine.startMinigun();assert.equal(engine.minigunSpinVoice.source.buffer,original);assert.equal(engine.minigunSpinVoice.source.offset,0);
  engine.shoot('minigun',{held:true});const voice=engine.minigunVoice,prepared=voice.source.buffer,values=prepared.getChannelData(0);
  const logicalStart=Math.round(MINIGUN_TIMING.loopStart*rate),end=Math.round(MINIGUN_TIMING.loopEnd*rate),overlap=Math.round(MINIGUN_TIMING.crossfade*rate),start=logicalStart+overlap;
  assert.notEqual(prepared,original);assert.equal(prepared.duration,original.duration);assert.equal(voice.source.offset,1);
  assert.equal(voice.source.loopStart,start/rate);assert.equal(voice.source.loopEnd,end/rate);assert.equal((end-start)/rate,3.61);
  assert.deepEqual(values.subarray(0,end-overlap),copy.subarray(0,end-overlap),'the first-shot prefix is unchanged');
  assert.deepEqual(values.subarray(end),copy.subarray(end),'PCM beyond the loop is unchanged');
  assert.deepEqual(pcm,copy,'neither the preserved file nor its decoded source is modified');
  const rawJump=Math.abs(copy[end-1]-copy[logicalStart]),joinedJump=Math.abs(values[end-1]-values[start]);
  assert.ok(rawJump>.75,'the selected source exposes the original discontinuity');assert.ok(joinedJump<rawJump*.04,`${rawJump} -> ${joinedJump}`);
  let originalDelta=0,preparedDelta=joinedJump,peak=0;
  for(let i=start;i<end;i++){
    peak=Math.max(peak,Math.abs(values[i]));if(i+1<end){originalDelta=Math.max(originalDelta,Math.abs(copy[i+1]-copy[i]));preparedDelta=Math.max(preparedDelta,Math.abs(values[i+1]-values[i]));}
  }
  assert.ok(preparedDelta<=originalDelta+1e-6,'the seam introduces no larger jump than the recording already contains');assert.ok(peak<1,'the equal-power overlap does not clip');
  engine.releaseFire('minigun');engine.shoot('minigun',{held:true});assert.equal(engine.minigunVoice.source.buffer,prepared,'crossfaded PCM is reused on later bursts');engine.stop();
});

test('loop metadata outside the decoded recording falls back safely to its intact buffer',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/rifle.wav',loop:{start:0,end:5,crossfade:.04}}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();await engine.prepareEffect('rifle');engine.shoot('rifle',{held:true});
  assert.equal(engine.rifleVoice.source.buffer,engine.buffers.get('/audio/rifle.wav').buffer);
  assert.equal(engine.fireBuffers.size,0);engine.stop();
});

test('machine-gun release, retrigger, mute and leave cancel the correct voice and timer without silencing other effects',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/heavy-rifle-3.wav',gain:.65}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  await engine.unlock();await flush();engine.shoot('rifle');await flush();clock.advance(1000);
  engine.shoot('rifle');const first=engine.rifleVoice;
  engine.shoot('pistol');const effect=[...engine.active].find(source=>source!==first.source);
  engine.releaseFire('rifle');assert.equal(engine.rifleVoice,null);assert.equal(clock.pending.size,0);assert.ok(engine.active.has(effect));
  engine.shoot('rifle');assert.notEqual(engine.rifleVoice,first);assert.equal(clock.pending.size,1);
  engine.setVolume(0);assert.equal(engine.rifleVoice,null);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);
  clock.advance(500);engine.setVolume(.4);engine.shoot('rifle');assert.ok(engine.rifleVoice);
  engine.updateScene(null,false);clock.advance(500);assert.equal(engine.rifleVoice,null);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);
});

test('SMG sustained fire uses its own prepared buffer and a single voice at its faster firing cadence',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/heavy-rifle-3.wav',gain:.65}],smg:[{src:'/audio/smg-3.wav',gain:.6}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  ctx.decodeAudioData=async()=>ctx.createBuffer(1,16000,8000);
  engine.updateScene({...state(),players:[{weapon:'rifle'},{weapon:'smg'}]},true);await engine.unlock();await flush();engine.updateScene(null,false);
  engine.shoot('rifle');engine.shoot('smg');
  const rifle=engine.rifleVoice,smg=engine.smgVoice,allocated=ctx.nodes.length;
  assert.notEqual(rifle.source.buffer,smg.source.buffer);assert.notEqual(smg.source.buffer,engine.buffers.get('/audio/smg-3.wav').buffer);
  assert.equal(engine.buffers.get('/audio/smg-3.wav').buffer.duration,2);
  assert.equal(smg.source.buffer.duration,.865);assert.equal(smg.source.loop,true);assert.equal(smg.source.playbackRate.value,1);
  for(let i=0;i<9;i++){clock.advance(85);engine.shoot('smg');}
  assert.equal(engine.smgVoice,smg);assert.equal(ctx.nodes.length,allocated);assert.equal(engine.rifleVoice,null);
  clock.advance(199);assert.equal(engine.smgVoice,smg);clock.advance(1);assert.equal(engine.smgVoice,null);
  clock.advance(70);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);engine.stop();
});

test('switching from SMG releases just that burst, while generic release and mute stop every firing voice',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/heavy-rifle-3.wav'}],smg:[{src:'/audio/smg-3.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  engine.updateScene({...state(),players:[{weapon:'rifle'},{weapon:'smg'}]},true);await engine.unlock();await flush();engine.updateScene(null,false);
  engine.shoot('smg');const smg=engine.smgVoice;engine.releaseFire('smg');engine.shoot('rifle');
  assert.equal(engine.smgVoice,null);assert.ok(engine.rifleVoice);clock.advance(70);assert.equal(engine.active.has(smg.source),false);
  engine.shoot('smg');engine.shoot('minigun');engine.releaseFire();
  assert.equal(engine.rifleVoice,null);assert.equal(engine.smgVoice,null);assert.equal(engine.minigunVoice,null);assert.equal(clock.pending.size,0);
  clock.advance(150);assert.equal(engine.active.size,0);
  engine.shoot('smg');assert.ok(engine.smgVoice);engine.setVolume(0);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);engine.stop();
});

test('default firing timers preserve the browser global receiver on schedule and cancellation',async t=>{
  const {engine}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}],smg:[{src:'/audio/smg.wav'}]}});
  engine.updateScene({...state(),players:[{weapon:'rifle'},{weapon:'smg'}]},true);await engine.unlock();await flush();engine.updateScene(null,false);
  const pending=new Map();let nextId=0;
  t.mock.method(globalThis,'setTimeout',function(callback,delay){
    assert.equal(this,globalThis,'browser timers reject a SoundEngine receiver');
    const id=++nextId;pending.set(id,{callback,delay});return id;
  });
  t.mock.method(globalThis,'clearTimeout',function(id){assert.equal(this,globalThis);pending.delete(id);});
  engine.shoot('rifle');engine.shoot('smg');engine.shoot('minigun');
  assert.equal(pending.size,3);assert.deepEqual([...pending.values()].map(item=>item.delay).sort((a,b)=>a-b),[150,200,230]);
  engine.shoot('rifle');assert.equal(pending.size,3);engine.releaseFire();assert.equal(pending.size,0);engine.stop();
});

test('acknowledged short rifle and SMG shots play a bounded PCM excerpt without restarting sustained fire',async()=>{
  const {engine,ctx}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}],smg:[{src:'/audio/smg.wav'}]}},{schedule:()=>assert.fail('a short shot must not schedule a burst timer')});
  engine.updateScene({...state(),players:[{weapon:'rifle'},{weapon:'smg'}]},true);await engine.unlock();await flush();engine.updateScene(null,false);
  for(const type of ['rifle','smg']) {
    engine.singleShot(type);const sources=[...engine.active];assert.equal(sources.length,1);
    assert.equal(sources[0].buffer,engine.buffers.get(`/audio/${type}.wav`).buffer);assert.equal(sources[0].loop,false);
    assert.ok(sources[0].stopAt<=ctx.currentTime+.1);assert.equal(engine[`${type}Voice`],null);assert.equal(engine[`${type}Timer`],null);
    ctx.advance(.1);assert.equal(engine.active.size,0);
  }
  engine.singleShot('minigun');assert.equal(engine.active.size,3);assert.equal(engine.minigunVoice,null);assert.equal(engine.minigunTimer,null);
  ctx.advance(.15);assert.equal(engine.active.size,0);engine.stop();
});

test('short-shot fallback stays immediate, gated and stoppable without delayed audio after decoding',async()=>{
  const {engine,ctx,requests}=setup({effects:{rifle:[{src:'/audio/rifle.wav'}]}});
  engine.singleShot('rifle');assert.equal(requests.length,0);assert.equal(ctx.nodes.length,0);
  await engine.unlock();await flush();engine.singleShot('rifle');assert.ok(engine.active.size>0);assert.equal(engine.rifleVoice,null);
  const allocated=ctx.nodes.length;await flush();assert.equal(ctx.nodes.length,allocated,'decoding must not replay an old acknowledgement');
  engine.stop();assert.equal(engine.active.size,0);engine.singleShot('rifle');assert.equal(engine.active.size,1);
  engine.setVolume(0);assert.equal(engine.active.size,0);const muted=ctx.nodes.length;engine.singleShot('rifle');engine.singleShot('minigun');assert.equal(ctx.nodes.length,muted);
  ctx.advance(1);assert.equal(engine.active.size,0);engine.stop();
});

test('equipped weapons prepare their own reload assets, and every weapon plays the corresponding bounded sample',async()=>{
  const keys={pistol:'reloadPistol',rifle:'reloadRifle',smg:'reloadSmg',shotgun:'reloadShotgun',magnum:'reloadMagnum',minigun:'reloadMinigun'};
  const effects=Object.fromEntries(Object.values(keys).map(key=>[key,[{src:`/audio/${key}.wav`,gain:.3}]]));
  const {engine,ctx,requests}=setup({effects});
  engine.updateScene({...state(),players:[{weapon:'pistol'}]},true);assert.equal(requests.length,0);
  await engine.unlock();await flush();
  assert.ok(requests.some(request=>request.url==='/audio/reloadPistol.wav'));
  assert.ok(!requests.some(request=>request.url==='/audio/reloadRifle.wav'),'unequipped reloads should remain lazy');
  engine.updateScene({...state(),players:Object.keys(keys).map(weapon=>({weapon}))},true);await flush();engine.updateScene(null,false);
  for(const [weapon,key] of Object.entries(keys)) {
    assert.equal(engine.reload(weapon,.4),true);const voice=engine.reloadVoice,source=[...voice.sources][0],allocated=ctx.nodes.length;
    assert.equal(source.buffer,engine.buffers.get(`/audio/${key}.wav`).buffer);assert.equal(source.loop,false);
    assert.ok(source.stopAt<=ctx.currentTime+.4);assert.equal(engine.reload(weapon,.4),false);assert.equal(ctx.nodes.length,allocated);
    engine.releaseReload();ctx.advance(.03);assert.equal(engine.reloadVoice,null);assert.equal(engine.active.size,0);
  }
  engine.reload();assert.equal(engine.reloadVoice.type,'pistol');engine.stop();
});

test('reload cancellation and weapon changes replace only reload audio, while mute and leave clean every source',async()=>{
  const {engine,ctx}=setup({effects:{reloadPistol:[{src:'/audio/reload-pistol.wav'}],reloadRifle:[{src:'/audio/reload-rifle.wav'}]}});
  engine.updateScene({...state(),players:[{weapon:'pistol'},{weapon:'rifle'}]},true);await engine.unlock();await flush();
  const music=engine.music.ambient.source;engine.groan();const groan=[...engine.active].find(source=>source.type==='sawtooth');
  engine.reload('pistol',1.25);const old=[...engine.reloadVoice.sources][0];engine.reload('rifle',1.65);
  assert.equal(engine.reloadVoice.type,'rifle');assert.ok(old.stopAt<=ctx.currentTime+.025);assert.ok(engine.active.has(music));assert.ok(engine.active.has(groan));
  engine.releaseReload();engine.releaseReload();ctx.advance(.03);assert.ok(!engine.active.has(old));assert.ok(engine.active.has(music));assert.ok(engine.active.has(groan));
  engine.reload('pistol',1.25);engine.setVolume(0);assert.equal(engine.reloadVoice,null);assert.equal(engine.active.size,0);
  const allocated=ctx.nodes.length;assert.equal(engine.reload('rifle'),false);assert.equal(ctx.nodes.length,allocated);
  engine.setVolume(.4);engine.reload('pistol',1.25);assert.ok(engine.reloadVoice);engine.updateScene(null,false);
  assert.equal(engine.reloadVoice,null);assert.equal(engine.active.size,0);engine.stop();
});

test('an undecoded reload uses one immediate procedural sequence and never replays when decoding finishes',async()=>{
  const {engine,ctx,requests}=setup({effects:{reloadShotgun:[{src:'/audio/reload-shotgun.wav'}]}});
  assert.equal(engine.reload('shotgun',2.4),false);assert.equal(requests.length,0);
  await engine.unlock();await flush();assert.equal(engine.reload('shotgun',2.4),true);
  const voice=engine.reloadVoice,allocated=ctx.nodes.length;assert.equal(voice.sources.size,5);assert.ok([...voice.sources].some(source=>source.startAt>ctx.currentTime+.6));
  assert.equal(engine.reload('shotgun',2.4),false);assert.equal(ctx.nodes.length,allocated);await flush();assert.equal(ctx.nodes.length,allocated);
  engine.releaseReload();ctx.advance(1);assert.equal(engine.active.size,0);assert.equal(engine.reloadVoice,null);
  assert.equal(engine.reload('shotgun',2.4),true);assert.equal(engine.reloadVoice.sources.size,1);
  const source=[...engine.reloadVoice.sources][0];assert.equal(source.buffer,engine.buffers.get('/audio/reload-shotgun.wav').buffer);
  engine.stop();assert.equal(engine.active.size,0);assert.equal(engine.reloadCapture,null);
});

test('minigun rotation and confirmed fire use consecutive parts of the selected recording without looping its intro',async()=>{
  const {engine,ctx,requests}=setup({effects:{minigunFire:[{src:'/audio/minigun-fire.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;ctx.decodeAudioData=async()=>ctx.createBuffer(1,40000,8000);
  engine.updateScene({...state(),players:[{weapon:'minigun'}]},true);assert.equal(engine.startMinigun(),false);assert.equal(requests.length,0);
  await engine.unlock();await flush();assert.ok(engine.buffers.get('/audio/minigun-fire.wav')?.buffer);
  engine.updateScene(null,false);assert.equal(engine.startMinigun(),true);const spin=engine.minigunSpinVoice,allocated=ctx.nodes.length;
  assert.equal(spin.source.buffer,engine.buffers.get('/audio/minigun-fire.wav').buffer);assert.equal(spin.source.loop,false);assert.equal(spin.source.stopAt,MINIGUN_TIMING.windup);assert.equal(spin.source.offset,0);
  clock.advance(1000);assert.equal(engine.minigunVoice,null);assert.equal(clock.pending.size,0);assert.equal(engine.active.size,0);
  assert.equal(engine.startMinigun(),false);assert.equal(ctx.nodes.length,allocated,'a repeated spin request must not replay the intro');
  engine.shoot('minigun');const fire=engine.minigunVoice,fireAllocated=ctx.nodes.length;
  assert.equal(engine.minigunSpinVoice,null);assert.notEqual(fire.source.buffer,engine.buffers.get('/audio/minigun-fire.wav').buffer);assert.equal(fire.source.buffer.duration,5);assert.equal(fire.source.loop,true);
  assert.equal(fire.source.offset,MINIGUN_TIMING.fireOffset);assert.equal(fire.source.loopStart,MINIGUN_TIMING.loopStart+MINIGUN_TIMING.crossfade);assert.equal(fire.source.loopEnd,MINIGUN_TIMING.loopEnd);assert.equal(fire.source.playbackRate.value,1);
  for(let i=0;i<9;i++){clock.advance(55);engine.shoot('minigun');}
  assert.equal(engine.minigunVoice,fire);assert.equal(ctx.nodes.length,fireAllocated);assert.equal(clock.pending.size,1);
  engine.releaseFire('minigun');clock.advance(140);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);
  const beforeRemote=ctx.nodes.length;engine.shoot('minigun');assert.equal(engine.minigunSpinVoice,null);assert.equal(ctx.nodes.length,beforeRemote+2,'a distant confirmed shot starts only the firing loop');
  engine.stop();engine.singleShot('minigun');const short=[...engine.active][0];assert.equal(short.buffer,engine.buffers.get('/audio/minigun-fire.wav').buffer);assert.equal(short.loop,false);assert.equal(short.offset,MINIGUN_TIMING.fireOffset);assert.ok(short.stopAt<=ctx.currentTime+.1);assert.equal(engine.minigunVoice,null);engine.stop();
});

test('release, mute and leave stop minigun rotation or firing without a delayed automatic shot',async()=>{
  const {engine,ctx}=setup({effects:{minigunSpin:[{src:'/audio/minigun-spin.wav'}],minigunFire:[{src:'/audio/minigun-fire.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  engine.updateScene({...state(),players:[{weapon:'minigun'}]},true);await engine.unlock();await flush();engine.updateScene(null,false);
  engine.startMinigun();clock.advance(100);engine.releaseFire('minigun');assert.equal(engine.minigunSpinVoice,null);assert.equal(engine.minigunSpinning,false);
  clock.advance(2000);assert.equal(engine.active.size,0);assert.equal(engine.minigunVoice,null);assert.equal(clock.pending.size,0);
  engine.startMinigun();engine.setVolume(0);assert.equal(engine.active.size,0);assert.equal(engine.minigunSpinVoice,null);assert.equal(engine.minigunSpinning,false);
  engine.setVolume(.4);engine.startMinigun();engine.shoot('minigun');assert.ok(engine.minigunVoice);engine.setVolume(0);assert.equal(clock.pending.size,0);assert.equal(engine.active.size,0);
  engine.setVolume(.4);assert.equal(engine.startMinigun(),true);engine.updateScene(null,false);clock.advance(2000);assert.equal(engine.minigunSpinning,false);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);engine.stop();
});

test('an undecoded minigun keeps its immediate fallback through the burst and uses the selected sample only after release',async()=>{
  const {engine,ctx}=setup({effects:{minigunFire:[{src:'/audio/minigun-fire.wav'}]}});
  const clock=timers(ctx);engine.schedule=clock.schedule;engine.cancel=clock.cancel;
  ctx.decodeAudioData=async()=>ctx.createBuffer(1,40000,8000);
  await engine.unlock();await flush();engine.startMinigun();assert.equal(engine.minigunSpinVoice.kind,'procedural');const allocated=ctx.nodes.length;
  engine.shoot('minigun',{held:true});const fire=engine.minigunVoice;assert.equal(fire.kind,'procedural');const duringBurst=ctx.nodes.length;
  await flush();assert.ok(duringBurst>allocated);engine.shoot('minigun',{held:true});assert.equal(engine.minigunVoice,fire);assert.equal(ctx.nodes.length,duringBurst);
  engine.releaseFire('minigun');clock.advance(1100);assert.equal(engine.active.size,0);assert.equal(clock.pending.size,0);
  engine.startMinigun();assert.equal(engine.minigunSpinVoice.kind,'sample');engine.shoot('minigun');assert.equal(engine.minigunVoice.kind,'sample');assert.equal(engine.minigunVoice.source.offset,MINIGUN_TIMING.fireOffset);engine.stop();
});

test('explicit sample preparation waits for the manifest and decode without a game scene or any audio source',async()=>{
  const {engine,ctx,requests}=setup({effects:{minigunFire:[{src:'/audio/minigun-fire.wav'}]}});
  assert.equal(await engine.prepareEffect('minigunFire'),false);assert.equal(requests.length,0);
  await engine.unlock();assert.equal(await engine.prepareEffect('minigunFire'),true);
  assert.ok(engine.buffers.get('/audio/minigun-fire.wav').buffer);assert.equal(engine.active.size,0);assert.equal(engine.inGame,false);
  const decoded=ctx.decoded;assert.equal(await engine.prepareEffect('minigunFire'),true);assert.equal(ctx.decoded,decoded);
  assert.equal(await engine.prepareEffect('missing'),false);assert.equal(engine.active.size,0);engine.stop();
});

function previewHarness({delayExplosion=false,delayPump=false,delaySword=false,delayArsenal=false,music=false,missingMusic=false,swings=false}={}) {
  const ctx=new Context(),clock=timers(ctx),requests=[],nodes=new Map(),intervals=new Map(),windowEvents=new Map();
  ctx.decodeAudioData=async()=>ctx.createBuffer(1,40000,8000);
  let engine,completeLoad,nextInterval=0,language='fr';
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,value:id==='volume'?'.55':'',textContent:'',dataset:{},listeners:new Map(),attributes:new Map(),volume:1,muted:false,currentTime:0,paused:true,
      addEventListener(name,callback){this.listeners.set(name,callback);},setAttribute(name,value){this.attributes.set(name,value);},getAttribute(name){return this.attributes.get(name)??null;},pause(){this.paused=true;}});
    return nodes.get(id);
  };
  const pistol=node('pistol');pistol.dataset.effect='pistol';pistol.textContent='Pistolet';
  const rifle=node('rifle');rifle.dataset.effect='rifle';rifle.textContent='MITRAILLEUSE · tir continu 7 s';
  const explosion=node('explosion');explosion.dataset.effect='explosion';
  const pump=node('shotgunPump');pump.dataset.effect='shotgunPump';
  const shotgun=node('shotgun');shotgun.dataset.effect='shotgun';
  const newEffects=['assault','rocket','flamethrower','katanaLight','katanaHeavy','sniperShot','hammerLight','hammerHeavy','batLight','batHeavy','fireaxeLight','fireaxeHeavy'].map(type=>{const target=node(type);target.dataset.effect=type;return target;});
  const extraSamples=Object.fromEntries(['assault','rocket','flamethrower','reloadSmg','katanaLight','katanaHeavy','sniperShot','hammerLight','hammerHeavy','batLight','batHeavy','fireaxeLight','fireaxeHeavy'].map(type=>[type,[{src:`/audio/${type}.wav`}]]));
  // The owner's swing takes of 13 October: a light bat that starts inside its take, a whoosh over the light mace.
  if(swings)Object.assign(extraSamples,{batLight:[{src:'/audio/batLight.wav',sync:{impact:.241451,advance:0,start:.121451}}],hammerLightSwing:[{src:'/audio/hammerLightSwing.wav',gain:.5,sync:{impact:.143673}}]});
  const shotgunReload=node('shotgun-reload');shotgunReload.dataset.reload='shotgun';shotgunReload.textContent='Recharger le fusil à pompe';
  const reloads=[shotgunReload,...['assault','rocket','flamethrower'].map(type=>{const target=node(`${type}-reload`);target.dataset.reload=type;return target;})];
  // The Famille kill proposals (KILL-SOUND.md 5): the old thump, then the three clacs.
  const clacs=['null','bois','pop','tac'].map(id=>{const target=node(`clac-${id}`);target.dataset.clac=id;return target;});
  class PreviewEngine extends SoundEngine {
    constructor(){super({contextFactory:()=>ctx,schedule:clock.schedule,cancel:clock.cancel,random:()=>.5,fetcher:async url=>{
      requests.push(url);
      if(url==='/audio/manifest.json')return {ok:true,json:async()=>({music:music?{ambient:{src:'/audio/ambient.mp3'},tacticalA:{src:'/audio/tactical-resolve-a.mp3'},tacticalB:{src:'/audio/tactical-resolve-b.mp3'},covertA:{src:'/audio/covertA.mp3'},covertB:{src:'/audio/covertB.mp3'},nightA:{src:'/audio/nightA.mp3'},nightB:{src:'/audio/nightB.mp3'}}:{},effects:{...extraSamples,minigunFire:[{src:'/audio/minigun-fire.wav'}],pistol:[{src:'/audio/pistol.wav'}],rifle:[{src:'/audio/rifle.wav'}],smg:[{src:'/audio/smg.wav'}],explosion:[{src:'/audio/explosion.wav',gain:.4}],shotgun:[{src:'/audio/shotgun.wav'}],shotgunPump:[{src:'/audio/pump.wav',gain:.29}],reloadShotgun:[{src:'/audio/reload-shotgun.wav'}]}})};
      if(missingMusic&&url==='/audio/tactical-resolve-a.mp3')return {ok:false};
      return {ok:true,arrayBuffer:()=>url==='/audio/minigun-fire.wav'||(delayExplosion&&url==='/audio/explosion.wav')||(delayPump&&url==='/audio/pump.wav')||(delaySword&&url===`/audio/${delaySword}.wav`)||(delayArsenal&&url===`/audio/${delayArsenal}.wav`)?new Promise(resolve=>{completeLoad=()=>resolve(new ArrayBuffer(4));}):Promise.resolve(new ArrayBuffer(4))};
    }});engine=this;}
  }
  const html=readFileSync(new URL('../public/audio-preview.html',import.meta.url),'utf8'),textNodes=[];
  for(const [,tag,attributes,key,value] of html.matchAll(/<([a-z][\w-]*)\b([^>]*data-preview-text="([^"]+)"[^>]*)>([^<]*)<\/\1>/g)) {
    const reload=attributes.match(/data-reload="([^"]+)"/)?.[1];
    const id=attributes.match(/\bid="([^"]+)"/)?.[1]??attributes.match(/data-effect="([^"]+)"/)?.[1]??(reload?`${reload}-reload`:`preview-${key}`);
    const target=node(id);target.dataset.previewText=key;target.textContent=value;textNodes.push(target);
  }
  // Music buttons are wired from the real page, so a new theme is driven like the others.
  const modes=[...html.matchAll(/<button\b[^>]*\bdata-mode="([^"]+)"[^>]*>/g)].map(([tag,mode])=>{
    const target=node(`preview-${tag.match(/data-preview-text="([^"]+)"/)[1]}`),theme=tag.match(/data-theme="([^"]+)"/)?.[1];
    target.dataset.mode=mode;if(theme)target.dataset.theme=theme;return target;
  });
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;\r?\n/gm,'');
  const document={documentElement:{lang:'fr'},title:'',getElementById:node,querySelectorAll:selector=>selector==='[data-effect]'?[pistol,rifle,explosion,pump,shotgun,...newEffects]:selector==='[data-reload]'?reloads:selector==='[data-mode]'?modes:selector==='[data-preview-text]'?textNodes:selector==='[data-clac]'?clacs:[]};
  const context=vm.createContext({SoundEngine:PreviewEngine,Map,MINIGUN_TIMING,FIRE_INTERVALS,MAX_WAVES,MUSIC_THEME_CATALOG,fetch:async()=>({json:async()=>({weapons:{minigun:{magazine:75}}})}),getLanguage:()=>language,setLanguage:value=>{language=value;},document,
    window:{addEventListener:(name,callback)=>windowEvents.set(name,callback)},setTimeout:clock.schedule,clearTimeout:clock.cancel,
    setInterval:(callback,delay)=>{const id=++nextInterval;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id)});
  vm.runInContext(script,context);
  return {engine,ctx,clock,requests,node,intervals,document,textNodes,language:value=>{node('language').value=value;node('language').listeners.get('change')();},click:id=>node(id).listeners.get('click')(),complete:()=>completeLoad(),pagehide:()=>windowEvents.get('pagehide')()};
}

test('continuous flame preview waits for its local take and stops at five seconds in both languages',async()=>{
  for(const [type,milliseconds] of [['flamethrower',5000]]){
    const view=previewHarness();await view.click(type);
    const voice=view.engine[`${type}Voice`];assert.ok(voice);assert.equal(voice.source.playbackRate.value,1);
    assert.equal(view.engine.inGame,false);assert.equal(view.clock.pending.size,1);assert.match(view.node('action-status').textContent,/fichier local/);
    view.language('en');assert.match(view.node('action-status').textContent,/local file/);
    view.clock.advance(milliseconds-1);assert.equal(view.engine[`${type}Voice`],voice);
    view.clock.advance(1);assert.equal(view.engine[`${type}Voice`],null);assert.equal(view.clock.pending.size,0);
    view.clock.advance(70);assert.equal(view.engine.active.size,0);view.pagehide();
  }
});

test('assault preview explicitly schedules 54 attacks with overlapping held tails at the unchanged 130ms cadence, then stops in both languages',async()=>{
  const view=previewHarness();await view.click('assault');
  assert.equal(view.engine.assaultVoices.size,1);assert.equal(view.engine.assaultVoice,null);
  const sources=()=>view.ctx.nodes.filter(node=>node.type==='buffer'&&node.started);
  const allocated=sources().length,interval=[...view.intervals.values()].find(item=>item.delay===FIRE_INTERVALS.assault*1000);
  assert.ok(interval);assert.match(view.node('action-status').textContent,/fichier local/);
  for(let i=0;i<53;i++){view.clock.advance(130);interval.callback();}
  assert.equal(sources().length-allocated,53);assert.equal([...view.intervals.values()].some(item=>item===interval),false);
  assert.equal(sources().every(source=>!source.loop),true);assert.equal(view.engine.assaultVoices.size,1);
  view.language('en');assert.match(view.node('preview-arsenalChoices').textContent,/one.*attack.*per.*(confirmed )?(bullet|shot).*overlap.*no autonomous loop/);
  assert.match(view.node('action-status').textContent,/Assault rifle.*local file/);
  view.clock.advance(110);assert.equal(view.engine.assaultVoices.size,0);assert.equal(view.clock.pending.size,0);
  view.clock.advance(15);assert.equal(view.engine.active.size,0);view.pagehide();
});

for(const cancel of ['stop','mute','pistol','pagehide'])test(`assault preview ${cancel} cancels scheduled shots and releases the last grain`,async()=>{
  const view=previewHarness();await view.click('assault');
  if(cancel==='pagehide')view.pagehide();else await view.click(cancel);
  assert.equal([...view.intervals.values()].some(item=>item.delay===130),false);assert.equal(view.clock.pending.size,0);
  view.clock.advance(140);assert.equal(view.engine.assaultVoices.size,0);view.pagehide();
});

test('katana previews wait for each exact take, retain its full decoded duration and translate the attack assignment',async()=>{
  for(const [kind,attack,english] of [['katanaLight','light','Katana · quick slash · take 3 · 6 s'],['katanaHeavy','heavy','Katana · heavy slash · take 3 · 3 s']]){
    const view=previewHarness({delaySword:kind}),pending=view.click(kind);await flush();
    assert.equal(view.engine.active.size,0);assert.match(view.node('action-status').textContent,/Chargement/);
    view.complete();await pending;const source=[...view.engine.meleeVoices.get('local').sources][0];
    assert.equal(view.engine.meleeVoices.get('local').attack,attack);assert.equal(source.offset,0);
    assert.equal(source.stopAt,view.ctx.currentTime+source.buffer.duration);assert.equal(source.playbackRate.value,1);
    assert.match(view.node('preview-katanaChoices').textContent,/« sword slash special attack » n°3/);
    view.language('en');assert.equal(view.node(kind).textContent,english);
    assert.equal(view.node('action-status').textContent,`${english} · local file.`);
    assert.match(view.node('preview-katanaChoices').textContent,/complete recordings at original pitch and tempo/);
    await view.click('stop');assert.equal(view.engine.active.size,0);assert.equal(view.engine.meleeVoices.size,0);
  }
});

for(const [kind,attack,english] of [
  ['sniperShot',null,'Sniper · “sniper riffle shot” · take 2'],
  ['hammerLight','light','Hammer · light strike · whoosh take 4 + medium impact take 4'],
  ['hammerHeavy','heavy','Hammer · heavy strike · heavy impact take 3'],
  ['batLight','light','Bat · light strike · swing + impact take 1'],
  ['batHeavy','heavy','Bat · heavy strike · swing + impact take 4'],
  ['fireaxeLight','light','Fire axe · light strike · take 3'],
  ['fireaxeHeavy','heavy','Fire axe · heavy strike · take 2'],
])test(`${kind} preview waits for the selected take and translates its exact assignment`,async()=>{
  const view=previewHarness({delayArsenal:kind}),pending=view.click(kind);await flush();
  assert.equal(view.engine.active.size,0);assert.match(view.node('action-status').textContent,/Chargement/);
  view.complete();await pending;
  const sample=view.engine.buffers.get(`/audio/${kind}.wav`).buffer;
  const reports=[...view.engine.active].filter(source=>source.buffer===sample);
  assert.equal(reports.length,1);assert.equal(reports[0].playbackRate.value,1);assert.equal(reports[0].offset,0);
  assert.equal(reports[0].stopAt-reports[0].startAt,sample.duration+(attack?0:.03));
  if(attack){assert.equal(view.engine.meleeVoices.get('local').weapon,kind.startsWith('bat')?'bat':kind.startsWith('fireaxe')?'fireaxe':'hammer');assert.equal(view.engine.meleeVoices.get('local').attack,attack);}
  else assert.ok(view.engine.pumpVoices.get('local'));
  view.language('en');assert.equal(view.node(kind).textContent,english);
  assert.equal(view.node('action-status').textContent,`${english} · local file.`);
  assert.match(view.node('preview-hammerSniperChoices').textContent,/take 4 for the light strike.*take 3 for the heavy strike/);
  assert.match(view.node('preview-batChoices').textContent,/take 1, swing \+ impact.*take 4 \(718 ms of leading silence removed/);
  await view.click('stop');assert.equal(view.engine.active.size,0);assert.equal(view.engine.meleeVoices.size,0);assert.equal(view.engine.pumpVoices.size,0);
});

test('the preview plays a landed swing as the game does: the light mace whoosh with its impact take, the light bat from inside its take',async()=>{
  const view=previewHarness({swings:true});await view.click('hammerLight');
  const voice=view.engine.meleeVoices.get('local'),[take,layer]=[...voice.sources],now=view.ctx.currentTime;
  assert.equal(take.buffer,view.engine.buffers.get('/audio/hammerLight.wav').buffer);assert.equal(layer.buffer,view.engine.buffers.get('/audio/hammerLightSwing.wav').buffer);
  assert.ok(Math.abs(layer.startAt-now-(MELEE_WEAPONS.hammer.light.windup-.143673))<1e-9);assert.equal(layer.offset,0);assert.equal(layer.stopAt-layer.startAt,layer.buffer.duration);
  assert.match(view.node('action-status').textContent,/souffle n°4 \+ impact moyen n°4 · fichier local/);
  await view.click('stop');assert.equal(view.engine.meleeVoices.size,0);assert.ok([take,layer].every(source=>source.stopAt<=view.ctx.currentTime+.025));
  await view.click('batLight');const [bat]=[...view.engine.meleeVoices.get('local').sources];
  assert.equal(bat.startAt,view.ctx.currentTime);assert.equal(bat.offset,.121451);assert.equal(bat.connections[0].connections[0].gain.events.length,2,'opens over 5 ms');
  await view.click('stop');assert.equal(view.engine.active.size,0);view.pagehide();
});

for(const kind of ['sniperShot','hammerLight','hammerHeavy','batLight','batHeavy','fireaxeLight','fireaxeHeavy'])for(const cancellation of ['stop','mute','pagehide'])
  test(`preview ${cancellation} cancels ${kind} while loading without late playback`,async()=>{
    const view=previewHarness({delayArsenal:kind}),pending=view.click(kind);await flush();
    if(cancellation==='pagehide')view.pagehide();else await view.click(cancellation);
    view.complete();await pending;assert.equal(view.engine.active.size,0);
    assert.equal(view.engine.meleeVoices.size,0);assert.equal(view.engine.pumpVoices.size,0);
  });

for(const cancellation of ['stop','mute','pagehide'])test(`preview ${cancellation} cancels a katana still loading without late playback`,async()=>{
  const view=previewHarness({delaySword:'katanaHeavy'}),pending=view.click('katanaHeavy');await flush();
  if(cancellation==='pagehide')view.pagehide();else await view.click(cancellation);
  view.complete();await pending;assert.equal(view.engine.active.size,0);assert.equal(view.engine.meleeVoices.size,0);
});

test('new preview reloads distinguish the selected reused SMG mechanism from intentional procedural reloads',async()=>{
  const view=previewHarness();await view.click('rocket');
  const launch=[...view.engine.active][0];assert.equal(launch.buffer,view.engine.buffers.get('/audio/rocket.wav').buffer);
  assert.equal(launch.playbackRate.value,1);assert.equal(launch.stopAt,view.ctx.currentTime+launch.buffer.duration+.03);
  await view.click('assault-reload');assert.equal(view.engine.reloadVoice.type,'assault');
  assert.ok([...view.engine.reloadVoice.sources].every(source=>source.buffer===view.engine.buffers.get('/audio/reloadSmg.wav').buffer));
  assert.match(view.node('action-status').textContent,/1.6 s · fichier local/);
  for(const type of ['rocket','flamethrower']){
    await view.click(`${type}-reload`);assert.equal(view.engine.reloadVoice.type,type);
    assert.match(view.node('action-status').textContent,/mécanisme généré · aucun fichier choisi/);
  }
  view.language('en');assert.match(view.node('action-status').textContent,/generated mechanism · no selected file/);
  assert.equal(view.requests.some(url=>/reload(?:Rocket|Flamethrower|Assault)/.test(url)),false);view.pagehide();
});

test('simultaneous automatic-fire comparison sustains both loops for seven seconds and cancellation clears both',async()=>{
  for(const cancellation of ['timeout','stop','mute','pistol','pagehide']){
    const view=previewHarness();await view.click('automatic-comparison');
    const rifle=view.engine.rifleVoice,smg=view.engine.smgVoice;assert.ok(rifle&&smg);assert.equal(rifle.held,true);assert.equal(smg.held,true);
    assert.equal(view.engine.inGame,false,'comparison is isolated from the score');assert.equal(view.clock.pending.size,1);
    assert.match(view.node('action-status').textContent,/mitrailleuse : fichier local ; SMG : fichier local/);
    view.language('en');assert.match(view.node('action-status').textContent,/machine gun: local file; SMG: local file/);
    view.clock.advance(6999);assert.equal(view.engine.rifleVoice,rifle);assert.equal(view.engine.smgVoice,smg);
    if(cancellation==='timeout')view.clock.advance(1);
    else if(cancellation==='pagehide')view.pagehide();else await view.click(cancellation);
    assert.equal(view.engine.rifleVoice,null);assert.equal(view.engine.smgVoice,null);assert.equal(view.clock.pending.size,0);
    view.pagehide();assert.equal(view.engine.active.size,0);
  }
});

test('music preview compares A and B, returns to the default theme and translates the actual local-file status',async()=>{
  const view=previewHarness({music:true}),home=MUSIC_THEME_CATALOG[DEFAULT_MUSIC_THEME];
  assert.equal(view.requests.length,0);assert.equal(view.engine.musicTheme,DEFAULT_MUSIC_THEME);
  await view.click('preview-tacticalA');await flush();
  for(const {callback} of view.intervals.values())callback();
  assert.equal(view.engine.musicTheme,'tactical-a');assert.equal(view.engine.music.ambient.key,'/audio/tactical-resolve-a.mp3');
  assert.equal(view.node('preview-tacticalA').attributes.get('aria-pressed'),'true');
  assert.equal(view.node(`preview-${home}`).attributes.get('aria-pressed'),'false');
  assert.equal(view.node('music-status').textContent,'Tactical Resolve · A · fichier local.');
  view.language('en');assert.equal(view.node('music-status').textContent,'Tactical Resolve · A · local file.');
  await view.click('preview-tacticalB');await flush();for(const {callback} of view.intervals.values())callback();
  assert.equal(view.engine.music.ambient.key,'/audio/tactical-resolve-b.mp3');
  assert.equal(view.node('preview-tacticalA').attributes.get('aria-pressed'),'false');
  assert.equal(view.node('preview-tacticalB').attributes.get('aria-pressed'),'true');
  await view.click(`preview-${home}`);await flush();for(const {callback} of view.intervals.values())callback();
  assert.equal(view.engine.musicTheme,DEFAULT_MUSIC_THEME);assert.equal(view.engine.music.ambient.key,`/audio/${home}.mp3`);
  assert.equal(view.node(`preview-${home}`).attributes.get('aria-pressed'),'true');assert.equal(view.node('preview-tacticalB').attributes.get('aria-pressed'),'false');
  assert.equal(view.node('music-status').textContent,'Covert Ostinato · B · local file.');
  assert.equal(view.requests.includes('/audio/ambient.mp3'),false,'the kept original is not fetched while every chosen track loads');
  await view.click('stop');assert.equal(view.engine.active.size,0);view.pagehide();
});

test('music preview reports a missing candidate explicitly while retaining the original atmosphere',async()=>{
  const view=previewHarness({music:true,missingMusic:true});
  await view.click('preview-tacticalA');await flush();for(const {callback} of view.intervals.values())callback();
  assert.equal(view.engine.music.ambient.key,'/audio/ambient.mp3');
  assert.equal(view.node('music-status').textContent,'Tactical Resolve · A · fichier absent · ambiance originale conservée.');
  view.language('en');assert.equal(view.node('music-status').textContent,'Tactical Resolve · A · file missing · original atmosphere retained.');
  await view.click('mute');assert.equal(view.engine.active.size,0);
  await view.click('preview-tacticalB');await flush();assert.equal(view.engine.active.size,0,'selecting while muted cannot start music');
  view.pagehide();
});

test('the grenade preview waits for the selected sample and translates its choice and playback status',async()=>{
  const view=previewHarness({delayExplosion:true}),pending=view.click('explosion');await flush();
  assert.equal(view.engine.inGame,false);assert.ok(view.requests.includes('/audio/explosion.wav'));assert.equal(view.engine.active.size,0);
  assert.equal(view.node('action-status').textContent,'Chargement du bruitage…');view.complete();await pending;
  assert.equal(view.engine.active.size,1);const source=[...view.engine.active][0];
  assert.equal(source.buffer,view.engine.buffers.get('/audio/explosion.wav').buffer);assert.equal(source.playbackRate.value,1);
  assert.equal(view.node('action-status').textContent,'Explosion de grenade · n°4 · fichier local.');
  assert.match(view.node('preview-choices').textContent,/« grenade explosion » n°4, hauteur d’origine conservée/);
  view.language('en');assert.equal(view.node('explosion').textContent,'Grenade explosion · take 4');
  assert.equal(view.node('action-status').textContent,'Grenade explosion · take 4 · local file.');
  assert.match(view.node('preview-choices').textContent,/“grenade explosion”, take 4, original pitch preserved/);
  assert.equal([...view.engine.active][0],source,'changing language leaves the current sample playing');
  view.click('mute');assert.equal(view.engine.active.size,0);assert.equal(view.node('action-status').textContent,'All audio muted.');view.pagehide();
});

test('the isolated pump preview waits for take 3, plays no gunshot and translates its assignment in French and English',async()=>{
  const view=previewHarness({delayPump:true}),pending=view.click('shotgunPump');await flush();
  assert.ok(view.requests.includes('/audio/pump.wav'));assert.equal(view.engine.active.size,0);assert.equal(view.engine.inGame,false);
  view.complete();await pending;
  const sources=[...view.engine.active];assert.equal(sources.length,1);assert.equal(sources[0].buffer,view.engine.buffers.get('/audio/pump.wav').buffer);
  assert.equal(sources[0].startAt,0);assert.equal(sources[0].playbackRate.value,1);
  assert.equal(view.requests.includes('/audio/shotgun.wav'),false);assert.equal(view.requests.includes('/audio/reload-shotgun.wav'),false);
  assert.equal(view.node('action-status').textContent,'Réarmer la pompe · n°3 · fichier local.');
  assert.match(view.node('preview-choices').textContent,/« shotgun reload click » n°3 pour réarmer après chaque tir/);
  view.language('en');assert.equal(view.node('shotgunPump').textContent,'Cycle shotgun pump · take 3');
  assert.equal(view.node('action-status').textContent,'Cycle shotgun pump · take 3 · local file.');
  assert.match(view.node('preview-choices').textContent,/“shotgun reload click”, take 3, for pumping after each shot/);
  assert.match(view.node('preview-reloadNote').textContent,/shotgun R reload keeps its sequence/);
  assert.equal([...view.engine.active][0],sources[0]);view.pagehide();assert.equal(view.engine.pumpVoices.size,0);
});

test('the shotgun shot preview prepares its selected mechanical cycle once and R still uses only its original reload',async()=>{
  const view=previewHarness();await view.click('shotgun');
  const pump=view.engine.buffers.get('/audio/pump.wav').buffer,voice=view.engine.pumpVoices.get('local');
  assert.equal(voice.sources.size,1);assert.equal([...voice.sources][0].startAt,.12);
  assert.equal([...view.engine.active].filter(source=>source.buffer===pump).length,1);
  await view.click('shotgun-reload');assert.equal(view.engine.pumpVoices.size,0);
  assert.equal(view.engine.reloadVoice.type,'shotgun');assert.ok([...view.engine.reloadVoice.sources].every(source=>source.buffer!==pump));view.pagehide();
});

for(const cancellation of ['stop','mute','pagehide'])test(`preview ${cancellation} cancels a pump still loading without delayed playback`,async()=>{
  const view=previewHarness({delayPump:true}),pending=view.click('shotgunPump');await flush();
  if(cancellation==='pagehide')view.pagehide();else view.click(cancellation);
  view.complete();await pending;view.clock.advance(2000);assert.equal(view.engine.active.size,0);assert.equal(view.engine.pumpVoices.size,0);view.pagehide();
});

test('the final music preview uses the shared twentieth-wave endpoint',async()=>{
  const view=previewHarness();await view.click('preview-finale');
  assert.equal(MAX_WAVES,20);assert.equal(view.engine.scene.wave,MAX_WAVES);
  assert.ok(view.engine.music.finale.target>0);assert.equal(view.engine.music.brute.target,0);view.pagehide();
});

for(const cancellation of ['stop','mute','pagehide'])test(`preview ${cancellation} cancels a grenade still loading without a late explosion`,async()=>{
  const view=previewHarness({delayExplosion:true}),pending=view.click('explosion');await flush();
  assert.equal(view.engine.active.size,0);if(cancellation==='pagehide')view.pagehide();else view.click(cancellation);
  view.complete();await pending;view.clock.advance(2000);assert.equal(view.engine.active.size,0);view.pagehide();
});

test('the machine-gun preview sustains local fire through seventy-nine rounds and explicitly releases it after seven seconds',async()=>{
  const view=previewHarness();await view.click('rifle');
  const voice=view.engine.rifleVoice,allocated=view.ctx.nodes.length;
  assert.equal(voice.held,true);assert.equal(view.clock.pending.size,0);
  for(let round=1;round<79;round++) {
    view.clock.advance(90);assert.equal(view.engine.rifleVoice,voice);
    const interval=[...view.intervals.values()].find(task=>task.delay===90);assert.ok(interval);interval.callback();
  }
  assert.equal(view.ctx.nodes.length,allocated);assert.equal(view.engine.rifleVoice,null);
  assert.ok(![...view.intervals.values()].some(task=>task.delay===90));view.clock.advance(70);
  assert.equal(view.engine.active.size,0);view.pagehide();
});

test('a direct preview minigun click waits for the real sample and sustains the current seventy-five-round magazine after shared spin-up',async()=>{
  const view=previewHarness(),pending=view.click('minigun-burst');await flush();
  assert.ok(view.requests.includes('/audio/minigun-fire.wav'));assert.equal(view.engine.inGame,false);assert.equal(view.engine.active.size,0);
  assert.equal(view.engine.minigunSpinVoice,null);view.complete();await pending;
  assert.ok(view.engine.minigunSpinVoice);assert.match(view.node('action-status').textContent,/fichier local/);
  assert.equal(view.engine.minigunSpinVoice.source.offset,0);assert.equal(view.engine.minigunSpinVoice.source.stopAt,MINIGUN_TIMING.windup);
  view.clock.advance(999);assert.equal(view.engine.minigunVoice,null);view.clock.advance(1);
  const fire=view.engine.minigunVoice,allocated=view.ctx.nodes.length;assert.equal(fire.kind,'sample');assert.notEqual(fire.source.buffer,view.engine.buffers.get('/audio/minigun-fire.wav').buffer);
  assert.equal(fire.source.offset,MINIGUN_TIMING.fireOffset);assert.match(view.node('action-status').textContent,/75 coups en 4,1 s/);
  for(let round=1;round<75;round++) {view.clock.advance(55);const interval=[...view.intervals.values()].find(task=>task.delay===55);assert.ok(interval);interval.callback();}
  assert.equal(view.ctx.nodes.length,allocated);assert.equal(view.engine.minigunVoice,null);assert.ok(![...view.intervals.values()].some(task=>task.delay===55));
  view.clock.advance(140);assert.equal(view.engine.active.size,0);view.pagehide();
});

for(const cancellation of ['stop','mute','new effect','native excerpt','pagehide'])test(`preview ${cancellation} cancels a minigun sample still loading without delayed playback`,async()=>{
  const view=previewHarness(),pending=view.click('minigun-burst');await flush();
  if(cancellation==='stop'||cancellation==='mute')view.click(cancellation);
  else if(cancellation==='new effect')await view.click('pistol');
  else if(cancellation==='pagehide')view.pagehide();
  else {const reference=view.node('minigun-reference');reference.paused=false;reference.listeners.get('play')();}
  view.complete();await pending;view.clock.advance(2000);
  assert.equal(view.engine.minigunSpinVoice,null);assert.equal(view.engine.minigunVoice,null);assert.equal(view.engine.minigunSpinning,false);
  assert.equal(view.clock.pending.size,0);assert.ok(![...view.intervals.values()].some(task=>task.delay===55));view.pagehide();
});

test('the native minigun excerpt shares master volume and stops engine playback in both directions',async()=>{
  const view=previewHarness(),pending=view.click('minigun-burst');await flush();view.complete();await pending;
  const reference=view.node('minigun-reference');assert.equal(reference.volume,.55);
  reference.paused=false;reference.currentTime=2;reference.listeners.get('play')();assert.equal(view.engine.active.size,0);assert.equal(view.clock.pending.size,0);assert.equal(reference.paused,false);
  view.node('volume').value='.2';view.node('volume').listeners.get('input')();assert.equal(reference.volume,.2);assert.equal(view.engine.volume,.2);
  await view.click('pistol');assert.equal(reference.paused,true);assert.equal(reference.currentTime,0);assert.ok(view.engine.active.size>0);
  view.click('mute');assert.equal(reference.volume,0);assert.equal(reference.muted,true);assert.equal(view.engine.active.size,0);view.pagehide();
});

test('the audio preview translates all visible sections and status messages without requesting audio before activation',()=>{
  const view=previewHarness();view.language('en');
  assert.equal(view.document.documentElement.lang,'en');
  assert.equal(view.document.title,'Deadwood · Audio preview outside the game');
  assert.equal(view.node('preview-heading').textContent,'Audio preview · outside the game');
  assert.equal(view.node('shotgun-reload').textContent,'Reload shotgun');
  assert.equal(view.node('audio-status').textContent,'Audio is waiting for activation.');
  assert.equal(view.node('asset-status').textContent,'No files requested before activation.');
  assert.equal(view.node('action-status').textContent,'Ready to listen.');
  assert.equal(view.node('minigun-reference').getAttribute('aria-label'),'Complete five-second minigun firing excerpt from the video');
  assert.ok(view.textNodes.length>35);
  for(const target of view.textNodes)assert.ok(!/Recharg|Pistolet|Grognement|Bruitages|Écoute|Colosse|Langue|Musique|Aperçu/.test(target.textContent),target.textContent);
  assert.equal(view.requests.length,0);
  view.language('fr');assert.equal(view.node('preview-heading').textContent,'Aperçu audio · hors partie');
  assert.equal(view.node('shotgun-reload').textContent,'Recharger le fusil à pompe');view.pagehide();
});

test('changing preview language preserves a running burst and translates its current action and mute result',async()=>{
  const view=previewHarness();await view.click('rifle');
  const voice=view.engine.rifleVoice,allocated=view.ctx.nodes.length;
  view.language('en');
  assert.equal(view.engine.rifleVoice,voice);assert.equal(view.ctx.nodes.length,allocated);
  assert.equal(view.node('action-status').textContent,'MACHINE GUN · continuous fire, 7 s · local file.');
  assert.ok([...view.intervals.values()].some(task=>task.delay===90));
  view.click('mute');assert.equal(view.node('action-status').textContent,'All audio muted.');
  assert.equal(view.engine.rifleVoice,null);view.language('fr');
  assert.equal(view.node('action-status').textContent,'Tous les sons sont coupés.');view.pagehide();
});

test('every catalogue theme loads from the real manifest and fetches only its own track', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/audio/manifest.json', import.meta.url), 'utf8'));
  const themeFiles = Object.values(MUSIC_THEME_CATALOG).map(key => manifest.music[key].src);
  for (const [theme, key] of Object.entries(MUSIC_THEME_CATALOG)) {
    const { engine, requests } = setup(manifest);
    assert.equal(engine.setMusicTheme(theme), true, theme);
    engine.updateScene(state(), true); await engine.unlock(); await flush();
    assert.equal(engine.catalog.music[key].src, manifest.music[key].src, `${theme}: catalogued from the manifest`);
    assert.equal(engine.music.ambient.key, manifest.music[key].src, `${theme}: plays its own file`);
    assert.equal(engine.musicThemeStatus(), 'local');
    assert.deepEqual(requests.map(request => request.url).filter(url => themeFiles.includes(url)), [manifest.music[key].src], `${theme}: no other theme fetched`);
  }
});

test('music preview offers exactly the catalogue and drives each new theme with its own file, pressed state and translated status',async()=>{
  const view=previewHarness({music:true});
  assert.deepEqual(view.document.querySelectorAll('[data-mode]').filter(b=>b.dataset.mode==='ambient').map(b=>b.dataset.theme),Object.keys(MUSIC_THEME_CATALOG));
  for(const [theme,key,label] of [['covert-a','covertA','Covert Ostinato · A'],['covert-b','covertB','Covert Ostinato · B'],['night-a','nightA','Night Resolve · A'],['night-b','nightB','Night Resolve · B']]){
    view.language('fr');await view.click(`preview-${key}`);await flush();for(const {callback} of view.intervals.values())callback();
    assert.equal(view.engine.musicTheme,theme);assert.equal(view.engine.music.ambient.key,`/audio/${key}.mp3`);
    for(const b of view.document.querySelectorAll('[data-mode]'))assert.equal(b.attributes.get('aria-pressed'),String(b.dataset.theme===theme),b.id);
    assert.equal(view.node('music-status').textContent,`${label} · fichier local.`);
    view.language('en');assert.equal(view.node('music-status').textContent,`${label} · local file.`);
  }
  await view.click('stop');view.pagehide();
});

test('headshot plays a bright two-oscillator tink with one noise tick, and stays silent when locked or muted',async()=>{
  const {engine,ctx}=setup();
  engine.headshot();assert.equal(ctx.nodes.length,0,'a locked engine confirms nothing');
  await engine.unlock();await flush();
  const before=ctx.nodes.length;engine.headshot();
  const fresh=ctx.nodes.slice(before),oscillator=node=>['sine','triangle','sawtooth','square'].includes(node.type);
  assert.equal(fresh.filter(oscillator).length,2);
  assert.equal(fresh.filter(node=>node.type==='buffer').length,1);
  engine.setVolume(0);const muted=ctx.nodes.length;engine.headshot();assert.equal(ctx.nodes.length,muted,'volume 0 confirms nothing');
  engine.stop();
});

test('headshot rate limit drops a repeat within 40 ms but accepts one at 50 ms',async()=>{
  const {engine,ctx}=setup();await engine.unlock();await flush();
  engine.headshot();const played=ctx.nodes.length;
  ctx.advance(.02);engine.headshot();assert.equal(ctx.nodes.length,played,'several pellets of one blast report a single tink');
  ctx.advance(.03);engine.headshot();assert.ok(ctx.nodes.length>played,'the next shot 50 ms later is confirmed again');
  engine.stop();
});

test('chain ignores non-finite counts and counts below two',async()=>{
  const {engine,ctx}=setup();await engine.unlock();await flush();
  const before=ctx.nodes.length;
  engine.chain(1);engine.chain(0);engine.chain(NaN);
  assert.equal(ctx.nodes.length,before);engine.stop();
});

test('chain grows its arpeggio up to six notes, then climbs one note further at each big step of the ladder',async()=>{
  const oscillator=node=>['sine','triangle','sawtooth','square'].includes(node.type);
  for(const [count,oscillators,noises] of [[2,4,0],[3,5,0],[6,8,1],[7,8,1],[8,9,1],[15,11,1],[40,12,1],[75,13,1],[500,13,1]]){
    const {engine,ctx}=setup();await engine.unlock();await flush();
    const before=ctx.nodes.length;engine.chain(count);
    const fresh=ctx.nodes.slice(before);
    assert.equal(fresh.filter(oscillator).length,oscillators,`chain(${count}) oscillators`);
    assert.equal(fresh.filter(node=>node.type==='buffer').length,noises,`chain(${count}) shimmer`);
    engine.stop();
  }
});

test('chain arpeggio notes start sixty milliseconds apart on the audio clock',async()=>{
  const {engine,ctx}=setup();await engine.unlock();await flush();
  ctx.advance(1);const now=ctx.currentTime,before=ctx.nodes.length;
  engine.chain(4);
  const oscillators=ctx.nodes.slice(before).filter(node=>['sine','triangle','sawtooth','square'].includes(node.type));
  assert.equal(oscillators.length,6);
  for(let k=0;k<4;k++)assert.ok(Math.abs(oscillators[k].startAt-(now+k*.06))<1e-9,`note ${k}`);
  assert.ok(Math.abs(oscillators[4].startAt-(now+3*.06))<1e-9,'the held last note');
  assert.ok(Math.abs(oscillators[5].startAt-(now+3*.06+.01))<1e-9,'its soft octave');
  engine.stop();
});

test('chain rate limit only drops a same-or-smaller chain within 150 ms',async()=>{
  {
    const {engine,ctx}=setup();await engine.unlock();await flush();
    engine.chain(3);const played=ctx.nodes.length;
    ctx.advance(.1);engine.chain(3);assert.equal(ctx.nodes.length,played,'the same chain within 150 ms plays once');
    engine.stop();
  }
  {
    const {engine,ctx}=setup();await engine.unlock();await flush();
    engine.chain(3);ctx.advance(.1);const played=ctx.nodes.length;
    engine.chain(4);assert.ok(ctx.nodes.length>played,'a bigger chain within 150 ms is still heard');
    engine.stop();
  }
  {
    const {engine,ctx}=setup();await engine.unlock();await flush();
    engine.chain(3);ctx.advance(.2);const played=ctx.nodes.length;
    engine.chain(3);assert.ok(ctx.nodes.length>played,'the same chain after 150 ms plays again');
    engine.stop();
  }
});

test('the audio preview offers the synthesized head-shot and kill-chain buttons in both languages with a chain demo branch',()=>{
  const html=readFileSync(new URL('../public/audio-preview.html',import.meta.url),'utf8');
  assert.ok(html.includes('data-effect="headshot" data-preview-text="headshot">Confirmation de tir à la tête · synthèse'));
  assert.ok(html.includes('data-effect="chainDemo" data-preview-text="chainDemo">Série d’éliminations · double → inarrêtable · synthèse'));
  assert.ok(html.includes("headshot:'Head-shot confirmation · synthesized'"));
  assert.ok(html.includes("chainDemo:'Kill chain · double → unstoppable · synthesized'"));
  assert.ok(html.includes("effect==='chainDemo'"));
});

// Part B of art/frisson/KILL-SOUND.md: Famille's kill "clac", requested by the owner.
const FAMILLE_KILL=/^const FAMILLE_KILL=(null|'([a-z]+)');$/m.exec(readFileSync(new URL('../public/audio.js',import.meta.url),'utf8'));
test('the audio preview offers the Famille kill proposals in both languages, each the groan then its clac or the old thud, the default framed',async()=>{
  assert.ok(FAMILLE_KILL,'FAMILLE_KILL is one line');
  const chosen=FAMILLE_KILL[2]??'null';
  const html=readFileSync(new URL('../public/audio-preview.html',import.meta.url),'utf8');
  for(const text of ['Élimination · propositions pour Famille (défaut provisoire, à choisir à l’oreille)','Ancien : petit choc sourd','Clac de bois (bois)','Pop de dessin animé (pop)','Tac-tac (tac)','Avec un tir de pistolet'])assert.ok(html.includes(text),text);
  for(const id of ['null','bois','pop','tac'])assert.ok(html.includes(`data-clac="${id}"`),id);
  const view=previewHarness();
  for(const id of ['null','bois','pop','tac'])assert.equal(view.node(`clac-${id}`).attributes.get('aria-current'),String(id===chosen),`${id}: framed only when chosen`);
  assert.match(view.node('clac-status').textContent,chosen==='null'?/l’ancien petit choc sourd/:/défaut provisoire/);
  view.language('en');
  assert.equal(view.node('preview-killClacs').textContent,'Kill · proposals for Famille (provisional default, to choose by ear)');
  for(const [key,text] of [['clacThump','Old: soft thud'],['clacBois','Wooden clack (bois)'],['clacPop','Cartoon pop (pop)'],['clacTac','Castanet tac-tac (tac)'],['clacPistol','With a pistol shot'],['chosen','chosen']])assert.equal(view.node(`preview-${key}`).textContent,text);
  assert.match(view.node('clac-status').textContent,chosen==='null'?/old soft thud/:/provisional default/);
  assert.equal(view.requests.length,0,'nothing asked before a click');
  view.language('fr');
  for(const id of ['null','bois','pop','tac']){
    const calls=[],clac=view.engine.clac.bind(view.engine),noise=view.engine.noise.bind(view.engine),groan=view.engine.groan.bind(view.engine);
    view.engine.clac=value=>{calls.push(['clac',value]);return clac(value);};view.engine.noise=(...args)=>{calls.push(['noise',...args]);return noise(...args);};view.engine.groan=volume=>{calls.push(['groan',volume]);return groan(volume);};
    view.engine.ctx&&view.ctx.advance(1);
    await view.click(`clac-${id}`);
    assert.deepEqual(calls.filter(([kind])=>kind!=='noise'||id==='null').slice(0,2),[['groan',.09],id==='null'?['noise',.12,.1,350]:['clac',id]],`${id}: the groan, then ${id==='null'?'the null path of kill()':'its clac'}`);
    assert.match(view.node('action-status').textContent,/grognement de mort puis son d’élimination\./);
  }
  view.node('clac-pistol').checked=true;view.ctx.advance(1);
  const before=view.ctx.nodes.length;await view.click('clac-pop');
  assert.ok(view.ctx.nodes.slice(before).some(node=>node.type==='buffer'),'the pistol first');
  assert.match(view.node('action-status').textContent,/après un tir de pistolet/);
  view.pagehide();
});

test('a Famille clac is gentle and bounded: nothing while muted or locked, one per 70 ms, only its own names',async()=>{
  const {engine,ctx}=setup();
  assert.equal(engine.clac('bois'),false,'locked: nothing');assert.equal(ctx.nodes.length,0);
  await engine.unlock();await flush();const unlocked=ctx.nodes.length;
  for(const id of ['constructor','toString','__proto__','hasOwnProperty','',null,undefined,'nope'])assert.equal(engine.clac(id),false,String(id));
  assert.equal(ctx.nodes.length,unlocked,'an unknown name makes nothing');
  ctx.advance(1);
  for(const id of ['bois','pop','tac']){
    ctx.advance(1);const before=ctx.nodes.length;
    assert.equal(engine.clac(id),true);const made=ctx.nodes.length-before;assert.ok(made>=6,`${id}: ${made} nodes`);
    const fresh=ctx.nodes.slice(before),now=ctx.currentTime;
    assert.ok(fresh.filter(node=>node.startAt!==undefined).every(node=>node.startAt>=now+.04-1e-9),`${id}: 40 ms after the shot`);
    // Probed at 60 and 80 ms (at 50 ms, (t+.05)-t falls a hair under .05 and would let a 50 ms gap pass).
    ctx.advance(.06);assert.equal(engine.clac(id),true);assert.equal(ctx.nodes.length,before+made,'a second within 70 ms is merged');
    ctx.advance(.02);assert.equal(engine.clac(id),true);assert.equal(ctx.nodes.length,before+2*made,'the next after 70 ms plays');
  }
  engine.setVolume(0);const muted=ctx.nodes.length;ctx.advance(1);
  assert.equal(engine.clac('pop'),false);assert.equal(ctx.nodes.length,muted,'muted: nothing');
  engine.stop();
});

test('the owner 17 October assault take and previous selections retain their recorded provenance',{ skip: 'needs the art and audio originals, kept out of the open edition' }, ()=>{
  const report=JSON.parse(readFileSync(new URL('../validation/assault-rifle-shot-import-2026-10-17.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(readFileSync(new URL('../validation/audio-provenance.json',import.meta.url),'utf8'));
  for(const item of [report.original,report.output,report.previous]){
    const path=item.originalPath??item.path,bytes=readFileSync(new URL(`../${path.split('/').map(encodeURIComponent).join('/')}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,path);
  }
  assert.equal(report.original.sha256,'80da7e37f7479814025372f6bcaaa47e50eab4895134509bc89dae848ad712b3');
  assert.equal(report.original.take,'4');assert.equal(report.output.duration,report.original.duration);
  assert.equal(report.output.sourceStartSeconds,0);assert.equal(report.output.pitchRatio,1);assert.equal(report.output.tempoFactor,1);
  assert.equal(report.output.streams[0].channels,2);assert.equal(report.output.streams[0].sample_rate,'48000');
  assert.equal(report.agentGenerations,0);assert.equal(report.agentCreditsSpent,0);
  assert.ok(Math.abs(report.levelCalibration.mixedRmsRatio-1)<.00001,'initial mix matches the old attack energy');
  assert.equal(provenance.sources.assault_rifle_shot_2026_10_17.sha256,report.original.sha256);
  assert.equal(provenance.outputs.find(item=>item.path===report.output.path).sha256,report.output.sha256);
  assert.equal(provenance.sources.assault_shot.sha256,'5da9fc2ed7b8500b54e96d49ea9d681e2d784a495e665f13edc05440edea9c1f');
});

test('the owner single-shot assault take plays once per round and each two-second tail finishes at normal cadence',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8')),entry=manifest.effects.assault[0];
  assert.equal(entry.src,'/audio/assault-rifle-shot-4.wav');assert.equal(entry.shot,true);
  const {engine,ctx}=setup(manifest),bytes=readFileSync(new URL('../public/audio/assault-rifle-shot-4.wav',import.meta.url));
  ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect('assault');
  const original=engine.buffers.get(entry.src).buffer;assert.equal(original.duration,2);assert.equal(FIRE_INTERVALS.assault,.13);
  const copies=Array.from({length:2},(_,i)=>original.getChannelData(i).slice()),played=[];
  let previous=0,maximum=0;
  for(let i=0;i<40;i++){
    const at=i*FIRE_INTERVALS.assault;
    ctx.advance(at-previous);previous=at;engine.shoot('assault',{held:true,voiceId:'actor'});
    const sources=[...engine.assaultVoices.get('actor').sources],newest=sources.at(-1);
    played.push(newest);maximum=Math.max(maximum,sources.length);
    assert.equal(newest.buffer,original,'each round plays the whole take');assert.equal(newest.startAt,at);assert.equal(newest.playbackRate.value,1);assert.equal(newest.loop,false);
    assert.ok(sources.length<=16,`at most sixteen overlapping rounds (${sources.length})`);
    for(const source of played)assert.equal(source.stopAt,source.startAt+2,'later rounds never truncate an ordinary earlier tail');
  }
  assert.equal(maximum,16);assert.equal(new Set(played).size,40);
  // A single tap does not cut the previous round's tail either.
  ctx.advance(.2);engine.shoot('assault',{held:false,voiceId:'actor'});
  assert.ok(engine.assaultVoices.get('actor').sources.size>=2,'the earlier tail still rings under the new round');
  const nodes=ctx.nodes.length,sources=[...engine.assaultVoices.get('actor').sources];
  engine.releaseFire('assault');engine.releaseFire();
  assert.deepEqual([...engine.assaultVoices.get('actor').sources],sources,'ordinary trigger release lets confirmed tails finish');
  for(const source of sources)assert.equal(source.stopAt,source.startAt+2);
  ctx.advance(2.1);assert.equal(ctx.nodes.length,nodes,'no autonomous audio rounds');assert.equal(engine.assaultVoices.size,0);assert.equal(engine.active.size,0);
  for(let i=0;i<2;i++)assert.deepEqual(original.getChannelData(i),copies[i],'selected PCM is never changed in memory');
});

test('complete assault tails stay bounded during packet batches and explicit pause, mute, leave and stop clean them',{ skip: 'needs the art and audio originals, kept out of the open edition' }, async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/audio/manifest.json',import.meta.url),'utf8'));
  const bytes=readFileSync(new URL('../public/audio/assault-rifle-shot-4.wav',import.meta.url));
  for(const cancel of [engine=>engine.releaseAssault(),engine=>engine.setVolume(0),engine=>engine.updateScene({paused:true},false),engine=>engine.updateScene(null,false),engine=>engine.stop()]){
    const {engine,ctx}=setup(manifest);ctx.decodeAudioData=async()=>wavBuffer(ctx,bytes);await engine.unlock();await engine.prepareEffect('assault');
    engine.shoot('assault',{voiceId:'other'});const other=engine.assaultVoices.get('other');
    for(let i=0;i<80;i++)engine.shoot('assault',{held:true,voiceId:'actor'});
    assert.equal(engine.assaultVoices.get('actor').sources.size,16);assert.equal(engine.assaultVoices.get('actor').levels.size,16);
    assert.equal(engine.assaultVoices.get('other'),other,'packet batch does not cut another player');assert.equal(engine.active.size,17);
    cancel(engine);ctx.advance(.03);assert.equal(engine.assaultVoices.size,0);assert.equal(engine.active.size,0);
    const nodes=ctx.nodes.length;ctx.advance(3);assert.equal(ctx.nodes.length,nodes);engine.stop();
  }
});
