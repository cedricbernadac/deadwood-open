import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SoundEngine } from '../public/audio.js';
import { MAX_WAVES } from '../public/rules.js';
import { readMusicVolume, saveMusicVolume, MUSIC_VOLUME_STORAGE } from '../public/music-themes.js';

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
  constructor(){this.currentTime=0;this.state='suspended';this.sampleRate=8000;this.nodes=[];this.destination={type:'destination'};}
  async resume(){this.state='running';}
  createGain(){return new Node(this,'gain');}
  createBiquadFilter(){return new Node(this,'filter');}
  createBufferSource(){return new Node(this,'buffer');}
  createOscillator(){return new Node(this,'oscillator');}
  createDynamicsCompressor(){const node=new Node(this,'compressor');for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param();return node;}
  createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/sampleRate,length,sampleRate,numberOfChannels:channels,getChannelData:channel=>data[channel]};}
  async decodeAudioData(){return this.createBuffer(1,8000,8000);}
}
const scene=(brute=false,wave=1)=>({phase:'wave',wave,zombies:brute?[{id:'b',kind:'brute',hp:100}]:[]});
const musicManifest={
  music:{
    ambient:{src:'/audio/original.mp3',gain:.22},
    brute:{src:'/audio/brute.mp3',gain:.3},
    finale:{src:'/audio/finale.mp3',gain:.35},
    tacticalA:{src:'/audio/theme-a.mp3',gain:.25},
  },
  effects:{pistol:[{src:'/audio/pistol.wav',gain:.5}]},
};
function setup(manifest=musicManifest) {
  const ctx=new Context();
  const engine=new SoundEngine({contextFactory:()=>ctx,random:()=>.5,fetcher:async url=>{
    if(url==='/audio/manifest.json')return {ok:true,json:async()=>manifest};
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
  }});
  return {engine,ctx};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}

test('the default music volume of 1 leaves the graph and its levels exactly as before',async()=>{
  const {engine}=setup();
  await engine.unlock();engine.updateScene(scene(),true);await flush();
  const voice=engine.music.ambient;
  assert.ok(voice,'the ambient voice plays');
  assert.equal(engine.musicVol.gain.value,1,'the dedicated music node is transparent by default');
  assert.deepEqual(voice.level.connections,[engine.musicBus],'each voice keeps its own level gain');
  assert.deepEqual(engine.musicBus.connections,[engine.musicVol]);
  assert.deepEqual(engine.musicVol.connections,[engine.output]);
  assert.deepEqual(engine.output.connections,[engine.master]);
  assert.equal(voice.gain,.22,'the voice level is unchanged');
  assert.ok(voice.level.gain.events.some(([kind,value])=>kind==='ramp'&&value===.22),'the voice fade is unchanged');
  engine.stop();
});

test('setMusicVolume scales only the music, smoothly; effects and the master are untouched',async()=>{
  const {engine,ctx}=setup();
  await engine.unlock();engine.updateScene(scene(),true);await flush();
  await engine.prepareEffect('pistol');
  engine.setMusicVolume(.4);
  assert.equal(engine.musicVolume,.4);
  assert.deepEqual(engine.musicVol.gain.events.at(-1),['target',.4,0],'setTargetAtTime, like the master volume');
  assert.equal(engine.playEffect('pistol',1,0,1,false),true);
  const effectGain=ctx.nodes.find(node=>node.type==='gain'&&node.connections[0]===engine.output&&node.gain.value===.5);
  assert.ok(effectGain,'the effect keeps its own gain straight into the shared output');
  assert.ok(ctx.nodes.every(node=>node===engine.musicBus||!node.connections.includes(engine.musicVol)),'nothing but the music bus rides the music volume');
  engine.setVolume(0);
  assert.equal(engine.master.gain.value,0,'muting still silences everything through the master');
  assert.equal(engine.musicVol.gain.value,.4,'muting leaves the music level itself alone');
  engine.stop();
});

test('setMusicVolume clamps to 0-1 and a value set before unlock applies when the graph is built',async()=>{
  const {engine}=setup();
  engine.setMusicVolume(2);assert.equal(engine.musicVolume,1);
  engine.setMusicVolume(-1);assert.equal(engine.musicVolume,0);
  engine.setMusicVolume(NaN);assert.equal(engine.musicVolume,0,'an invalid value keeps the previous one');
  engine.setMusicVolume(.3);assert.equal(engine.musicVolume,.3,'stored while the engine is still locked');
  await engine.unlock();
  assert.equal(engine.musicVol.gain.value,.3,'applied when the engine unlocks');
  engine.setMusicVolume(7);assert.equal(engine.musicVol.gain.value,1);
  engine.stop();
});

test('a theme switch, the brute and the finale voices all follow the music volume',async()=>{
  const {engine}=setup();
  await engine.unlock();engine.updateScene(scene(),true);await flush();
  engine.setMusicVolume(.5);
  engine.updateScene(scene(true),true);await flush();
  assert.ok(engine.music.brute);assert.deepEqual(engine.music.brute.level.connections,[engine.musicBus]);
  engine.updateScene(scene(true,MAX_WAVES),true);await flush();
  assert.ok(engine.music.finale);assert.deepEqual(engine.music.finale.level.connections,[engine.musicBus]);
  engine.setMusicTheme('tactical-a');await flush();
  assert.equal(engine.music.ambient.key,'/audio/theme-a.mp3');
  assert.deepEqual(engine.music.ambient.level.connections,[engine.musicBus],'a new theme joins the same bus');
  assert.equal(engine.musicVol.gain.value,.5);
  engine.stop();
});

test('the slider exists in index.html and the generated online.html, with its French and English labels',()=>{
  const row='<input id="music-volume" type="range" min="0" max="1" step="0.05" value="1">';
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const online=readFileSync(new URL('../public/online.html',import.meta.url),'utf8');
  assert.ok(html.includes('<label for="music-volume" data-i18n="pause.musicVolume">'));
  assert.ok(html.includes(row));assert.ok(online.includes(row),'online.html is generated: run node online-client-build.mjs');
  const source=readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8').replace(/^export /gm,'');
  const context=vm.createContext({
    document:{documentElement:{lang:'fr'},querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:()=>null,setItem(){}},
    window:{dispatchEvent(){}},
    CustomEvent:class{constructor(type,options){Object.assign(this,{type,detail:options?.detail});}},
  });
  vm.runInContext(`${source}\nglobalThis.api={setLanguage,t};`,context);
  context.api.setLanguage('fr');assert.equal(context.api.t('pause.musicVolume'),'VOLUME DE LA MUSIQUE');
  context.api.setLanguage('en');assert.equal(context.api.t('pause.musicVolume'),'MUSIC VOLUME');
});

test('the music volume storage reads clamp, and a blocked storage never throws',()=>{
  assert.equal(readMusicVolume({getItem:()=>null}),1,'no saved value is the original mix');
  assert.equal(readMusicVolume({getItem:()=>''}),1);
  assert.equal(readMusicVolume({getItem:()=>'.25'}),.25);
  assert.equal(readMusicVolume({getItem:()=>'0'}),0);
  assert.equal(readMusicVolume({getItem:()=>'9'}),1,'clamped');
  assert.equal(readMusicVolume({getItem:()=>'abc'}),1);
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  assert.equal(readMusicVolume(blocked),1);
  assert.doesNotThrow(()=>saveMusicVolume(.5,blocked));
  const writes=[];
  assert.equal(saveMusicVolume(.451,{setItem:(key,value)=>writes.push([key,value])}),true);
  assert.deepEqual(writes,[[MUSIC_VOLUME_STORAGE,'0.451']]);
  assert.equal(saveMusicVolume(2,{setItem:(key,value)=>writes.push([key,value])}),true);
  assert.deepEqual(writes.at(-1),[MUSIC_VOLUME_STORAGE,'1'],'writes are clamped too');
  assert.equal(saveMusicVolume(NaN,{setItem(){throw new Error('unreachable');}}),false);
});
