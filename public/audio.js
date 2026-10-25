import { MINIGUN_TIMING } from './minigun.js';
import { MAX_WAVES } from './progression.js';
import { MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME, isMusicTheme } from './music-themes.js';
import { FIRE_INTERVALS, MELEE_WEAPONS } from './rules.js';

const reloadEffects={pistol:'reloadPistol',rifle:'reloadRifle',smg:'reloadSmg',assault:'reloadSmg',rocket:null,flamethrower:null,shotgun:'reloadShotgun',magnum:'reloadMagnum',minigun:'reloadMinigun',sniper:null};
const sustainedWeapons=Object.freeze(['rifle','smg','flamethrower']);
// The selected SMG take fires only in its first 900 ms; replaying its complete
// two-second recording inserts a quiet tail into every held burst. Prepare the
// seam in memory and retain both the exported file and its original take. The
// small level trim preserves the previous mix after removing that quiet tail.
const selectedFireLoops=Object.freeze({
  '/audio/smg-3.wav':Object.freeze({start:0,end:.9,crossfade:.035,gain:.85}),
});
// Historical mace recordings used a playtest adjustment. New impact recordings
// explicitly set advance:0 and align their measured peaks with contact.
const HAMMER_AUDIO_ADVANCE=.25;
// Where the impact begins in each owner-selected take (seconds into the decoded
// export), read from its envelope and spectral flux (README); for the bat's
// swing takes of 13 October, from impact_onset() in validation/melee-impact-
// onsets.py. When the client predicts a miss, the voice fades out over `fade`
// and is silent from `at` on: the swing recorded before stays whole and the
// file is never edited. Keyed by file: another take plays whole until it is
// measured. The katana takes are a slash and a ringing blade, with no separate
// impact; a swing layer (`${kind}Swing`) has none either and is never gated.
const MELEE_IMPACTS=Object.freeze({
  '/audio/bat-light-axe-1.mp3':Object.freeze({at:.241451,fade:.02}),
  '/audio/bat-heavy-axe-4.mp3':Object.freeze({at:.233469,fade:.02}),
  '/audio/hammer-medium-4.mp3':Object.freeze({at:.034,fade:.012}),
  '/audio/hammer-heavy-3.mp3':Object.freeze({at:.298,fade:.012}),
  '/audio/fireaxe-light-3.mp3':Object.freeze({at:.3,fade:.02}),
  '/audio/fireaxe-heavy-2.mp3':Object.freeze({at:.24,fade:.02}),
});
// The client predicts once, 50 ms before contact, or earlier when the take's
// impact comes first, so the decision still lands 30 ms before the fade. The
// impact stays until a miss is decided: a late decision shortens the fade, or
// keeps the take whole under 4 ms before the impact. The server's verdict,
// when it arrives first, settles it; a hit restores the gain within 5 ms up to
// 30 ms into the impact.
const MELEE_PREDICT_LEAD=.05,MELEE_DECIDE_MARGIN=.03,MELEE_MIN_FADE=.004,MELEE_RESTORE=.03,MELEE_RESTORE_RAMP=.005;
// A take or swing layer that begins inside its recording, mid-swing (a take's
// `sync.start`, or a late network event skipping the elapsed part), opens over
// 5 ms rather than with a click.
const MELEE_START_FADE=.005;
// Raider gunfire reuses the owner's selected takes, at their own pitch, on a
// separate path: own voices, cooldowns and cap, never the players' shared ones.
// full: the whole report (no shotgun pump); grain: the 95 ms assault grain;
// excerpt: the 85 ms single-shot window of the looping machine-gun takes.
const RAIDER_TAKES=Object.freeze({pistol:'full',shotgun:'full',assault:'grain',smg:'excerpt',rifle:'excerpt'});
const RAIDER_MIX=.6,RAIDER_COOLDOWN=.03,RAIDER_VOICE_CAP=10,RAID_ALARM_COOLDOWN=4;
// The Famille kill "clac", picked by ear by the owner on the audio preview
// page (null: the soft thump, unchanged). One line; see the reprise.
// He asked for it on 14 October 2026 (« un petit clac ou un petit pop »);
// nobody has heard it yet. Provisional default by measurement (the kill-sound
// brief, section 5; the sound render tool's kill slot): of his two words,
// 'pop' cuts better through his gun takes, a mean 2-3 kHz rise of +7.0 dB at
// the 40 ms lag over the pistol, shotgun, assault rifle and magnum, against
// +6.7 dB for 'bois' at the same level (B2; Edge's own nodes agree, +6.3 and
// +6.0). The mean rides on the magnum (+13.2 and +13.0): over the pistol, the
// gun he uses most, pop rises +1.4 dB and bois +0.8, a rise the ear does not
// separate from the shot, so a pistol kill's clac will barely be heard. Every
// clac sits at the lowest level B1 allows (4 LU over the head-shot tink, about
// -39.8 LUFS), gentler than Frisson's crack.
const FAMILLE_KILL='pop';
// Clean, kid-friendly clacks: nothing designed above 3 kHz, 40 ms after the shot.
const KILL_CLACS=Object.freeze({
  bois(e){e.tone(2350,2290,.04,.116,'sine',.04);e.noise(.02,.081,2400,'bandpass',.04);e.tone(170,95,.06,.058,'triangle',.04);},
  pop(e){e.tone(2600,900,.035,.128,'sine',.04);e.tone(1300,450,.035,.045,'sine',.04);e.noise(.012,.051,2600,'bandpass',.04);e.tone(150,80,.05,.038,'triangle',.04);},
  tac(e){e.noise(.03,.198,2400,'bandpass',.04);e.tone(2100,2040,.03,.099,'sine',.04);e.noise(.03,.141,2400,'bandpass',.095);e.tone(2100,2040,.03,.069,'sine',.095);},
});

export class SoundEngine {
  constructor({contextFactory,fetcher,random=Math.random,schedule=(callback,delay)=>globalThis.setTimeout(callback,delay),cancel=timer=>globalThis.clearTimeout(timer)}={}) {
    this.ctx=null;this.master=null;this.volume=.55;this.musicVolume=1;this.active=new Set();
    this.contextFactory=contextFactory;this.fetcher=fetcher;this.random=random;
    this.catalog={music:{},effects:{}};this.manifestPromise=null;this.manifestReady=false;this.manifestSettled=false;this.buffers=new Map();this.synthBuffers=new Map();this.fireBuffers=new Map();
    this.music={ambient:null,brute:null,finale:null};this.musicTheme=DEFAULT_MUSIC_THEME;this.scene=null;this.inGame=false;this.unlocked=false;
    this.bruteAnnounced=false;this.bossAnnounced=false;this.lastBruteAt=-Infinity;this.lastBossAt=-Infinity;this.effectLast=new Map();
    this.footstep=null;this.footstepDistance=0;this.lastFootstepAt=-Infinity;this.lastBoardBreakAt=-Infinity;
    this.lastHeadshotAt=-Infinity;this.lastClacAt=-Infinity;this.lastChainAt=-Infinity;this.lastChainN=0;
    this.schedule=schedule;this.cancel=cancel;this.minigunVoice=null;this.minigunTimer=null;this.minigunSpinVoice=null;this.minigunSpinning=false;
    this.fireVoices=new Map(sustainedWeapons.map(type=>[type,new Map()]));this.minigunVoices=new Map();
    for(const type of sustainedWeapons){this[`${type}Voice`]=null;this[`${type}Timer`]=null;}
    this.reloadVoice=null;this.reloadVoices=new Map();this.reloadCapture=null;this.pumpVoices=new Map();this.pumpCapture=null;
    this.meleeVoices=new Map();this.meleeCapture=null;
    this.assaultVoices=new Map();this.assaultCapture=null;
    this.assaultVoice=null;this.assaultTimer=null;
    this.raiderVoices=new Map();this.raiderCapture=null;this.raiderLast=new Map();
    this.raidAnnounced=false;this.lastRaidAlarmAt=-Infinity;this.lastRaidSquelchAt=-Infinity;
    // A sound style (the Frisson pack); null is the Famille mix, exactly.
    this.style=null;this.styleAmbienceOn=false;this.styleHeartbeat=0;
  }
  async unlock() {
    try {
      if(!this.ctx) {
        const AudioContext=globalThis.window?.AudioContext||globalThis.window?.webkitAudioContext;
        if(!this.contextFactory&&!AudioContext)return;
        this.ctx=this.contextFactory?this.contextFactory():new AudioContext({latencyHint:'interactive'});
        const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-18;compressor.knee.value=18;compressor.ratio.value=5;
        compressor.attack.value=.003;compressor.release.value=.18;
        this.master=this.ctx.createGain();this.master.gain.value=this.volume;compressor.connect(this.master);this.master.connect(this.ctx.destination);this.output=compressor;
        this.musicBus=this.ctx.createGain();this.musicBus.gain.value=.5;
        // Music answers to its own slider through this node; at 1 it is
        // transparent and the mix is exactly the previous one.
        this.musicVol=this.ctx.createGain();this.musicVol.gain.value=this.musicVolume;this.musicBus.connect(this.musicVol);this.musicVol.connect(this.output);
        this.noiseBuffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate);
        const noise=this.noiseBuffer.getChannelData(0);for(let i=0;i<noise.length;i++)noise[i]=Math.random()*2-1;
      }
      await this.ctx.resume();this.unlocked=this.ready();
      if(this.unlocked){this.ambient();void this.loadManifest();}
    } catch (_) { /* A browser without WebAudio can still play the game. */ }
  }
  setVolume(v) {
    this.volume=Number.isFinite(v)?Math.max(0,Math.min(1,v)):this.volume;
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.03);
    if(!this.volume)this.stopSources();else this.ambient();
  }
  // The music slider's level: every music voice rides the music bus, so one
  // smooth move scales them all and nothing else; the master still rules all.
  setMusicVolume(v) {
    this.musicVolume=Number.isFinite(v)?Math.max(0,Math.min(1,v)):this.musicVolume;
    if(this.musicVol)this.musicVol.gain.setTargetAtTime(this.musicVolume,this.ctx.currentTime,.03);
  }
  ready() {return this.ctx?.state==='running';}
  setMusicTheme(value) {
    if(!isMusicTheme(value))return false;
    if(this.musicTheme!==value){this.musicTheme=value;this.ambient();}
    return true;
  }
  musicThemeStatus() {
    if(!this.unlocked)return 'locked';
    if(!this.manifestReady)return this.manifestSettled?'missing':'loading';
    const entry=this.catalog.music[MUSIC_THEME_CATALOG[this.musicTheme]];
    if(!entry)return 'missing';
    const record=this.buffers.get(entry.src);
    return record?.buffer?'local':record?.settled?'missing':'loading';
  }
  track(source,nodes=[]) {
    const reload=this.reloadCapture,pump=this.pumpCapture,melee=this.meleeCapture,assault=this.assaultCapture,raider=this.raiderCapture;
    if(reload){reload.sources.add(source);for(const node of nodes)if(node.gain)reload.levels.add(node);}
    if(pump){pump.sources.add(source);for(const node of nodes)if(node.gain)pump.levels.add(node);}
    if(melee){melee.sources.add(source);for(const node of nodes)if(node.gain)melee.levels.add(node);}
    if(assault){assault.sources.add(source);for(const node of nodes)if(node.gain)assault.levels.add(node);}
    if(raider){raider.sources.add(source);for(const node of nodes)if(node.gain)raider.levels.add(node);}
    this.active.add(source);source.onended=()=>{
      this.active.delete(source);
      if(reload){reload.sources.delete(source);if(this.reloadVoices.get(reload.id)===reload&&!reload.sources.size&&this.ctx.currentTime>=reload.endAt){this.reloadVoices.delete(reload.id);if(reload.id==='local')this.reloadVoice=null;}}
      if(pump){pump.sources.delete(source);if(!pump.sources.size&&this.pumpVoices.get(pump.id)===pump)this.pumpVoices.delete(pump.id);}
      if(melee){melee.sources.delete(source);if(!melee.sources.size&&this.meleeVoices.get(melee.id)===melee)this.meleeVoices.delete(melee.id);}
      if(assault){assault.sources.delete(source);for(const node of nodes)if(node.gain)assault.levels.delete(node);if(!assault.sources.size&&this.assaultVoices.get(assault.id)===assault)this.assaultVoices.delete(assault.id);}
      if(raider){raider.sources.delete(source);if(!raider.sources.size&&this.raiderVoices.get(raider.id)===raider)this.raiderVoices.delete(raider.id);}
      try{source.disconnect();for(const n of nodes)n.disconnect();}catch(_){}
    };
  }
  localAsset(src) {
    if(typeof src!=='string'||!src.startsWith('/audio/')||src.includes('\\'))return null;
    try{const origin=globalThis.location?.origin||'http://localhost';const url=new URL(src,origin);return url.origin===origin&&url.pathname.startsWith('/audio/')?url.pathname+url.search:null;}catch(_){return null;}
  }
  async loadManifest() {
    if(!this.unlocked)return;
    if(this.manifestPromise)return this.manifestPromise;
    this.manifestPromise=(async()=>{
      try {
        const fetcher=this.fetcher||globalThis.fetch;if(!fetcher)return;
        const response=await fetcher('/audio/manifest.json',{redirect:'error'});if(!response.ok)return;
        const data=await response.json();
        const entry=value=>{
          const src=this.localAsset(value?.src);if(!src)return null;
          const item={src,gain:Number.isFinite(value.gain)?Math.max(0,Math.min(1,value.gain)):.22},loop=value.loop;
          if(Number.isFinite(loop?.start)&&loop.start>=0&&Number.isFinite(loop.end)&&loop.end>loop.start)
            item.loop={start:loop.start,end:loop.end,crossfade:Number.isFinite(loop.crossfade)?Math.max(.001,Math.min(.1,loop.crossfade)):.04};
          // A complete single-shot take, played whole for every round.
          if(value.shot===true)item.shot=true;
          const grain=value.grain;
          if(Number.isFinite(grain?.start)&&grain.start>=0&&Number.isFinite(grain.end)&&grain.end>grain.start)
            item.grain={start:grain.start,end:grain.end,fadeIn:Number.isFinite(grain.fadeIn)?Math.max(0,Math.min(.02,grain.fadeIn)):.001,fadeOut:Number.isFinite(grain.fadeOut)?Math.max(.001,Math.min(.03,grain.fadeOut)):.012};
          if(Number.isFinite(value.sync?.impact)&&value.sync.impact>=0){
            item.sync={impact:value.sync.impact};
            if(Number.isFinite(value.sync.advance)&&value.sync.advance>=0)item.sync.advance=value.sync.advance;
            if(Number.isFinite(value.sync.delay)&&value.sync.delay>=0)item.sync.delay=value.sync.delay;
            if(Number.isFinite(value.sync.start)&&value.sync.start>=0)item.sync.start=value.sync.start;
          }
          return item;
        };
        // Every selectable theme comes from the shared catalogue: one entry per new track.
        for(const kind of new Set(['ambient','brute','finale',...Object.values(MUSIC_THEME_CATALOG)])){const item=entry(data.music?.[kind]);if(item)this.catalog.music[kind]=item;}
        for(const [kind,values] of Object.entries(data.effects||{}))if(Array.isArray(values))this.catalog.effects[kind]=values.map(entry).filter(Boolean);
        this.manifestReady=true;
      } catch(_){ /* Local assets are optional; generated sound remains available. */ }
      finally {this.manifestSettled=true;}
      this.ambient();
    })();
    return this.manifestPromise;
  }
  loadBuffer(src) {
    if(!this.unlocked)return null;
    if(!this.buffers.has(src)) {
      const record={buffer:null,promise:null,settled:false};this.buffers.set(src,record);
      record.promise=(async()=>{
        try {
          const fetcher=this.fetcher||globalThis.fetch;
          const response=await fetcher(src,{redirect:'error'});if(!response.ok)return;
          record.buffer=await this.ctx.decodeAudioData(await response.arrayBuffer());
        } catch(_){ /* A missing or unsupported file falls back to procedural sound. */ }
        finally {record.settled=true;}
      })();
    }
    return this.buffers.get(src);
  }
  async prepareEffect(kind) {
    if(!this.unlocked||!this.ready()||typeof kind!=='string')return false;
    await this.loadManifest();
    const entries=this.catalog.effects[kind]||[];
    // A melee take's swing layer is part of the same sound.
    await Promise.all([...entries,...this.catalog.effects[`${kind}Swing`]||[]].map(entry=>this.loadBuffer(entry.src)?.promise));
    return entries.some(entry=>this.buffers.get(entry.src)?.buffer);
  }
  prepareEffects() {
    if(!this.unlocked||!this.manifestReady||!this.ready()||!this.volume||!this.inGame||!['wave','countdown','intermission'].includes(this.scene?.phase))return;
    const wanted=new Set(['groan','brute','boss','boardBreak','footstepIndoor','footstepOutdoor','explosion','rocketExplosion']);
    const equipped=(this.scene.players||[]).flatMap(player=>[player,...player.dualWield&&player.hands?.secondary?[player.hands.secondary]:[]]);
    for(const player of equipped)if(typeof player.weapon==='string'){
      wanted.add(player.weapon);if(reloadEffects[player.weapon])wanted.add(reloadEffects[player.weapon]);
      if(player.weapon==='minigun')wanted.add('minigunFire');
      if(player.weapon==='shotgun')wanted.add('shotgunPump');
      if(player.weapon==='katana'){wanted.add('katanaLight');wanted.add('katanaHeavy');}
      if(player.weapon==='hammer'){wanted.add('hammerLight');wanted.add('hammerHeavy');}
      if(player.weapon==='bat'){wanted.add('batLight');wanted.add('batHeavy');}
      if(player.weapon==='fireaxe'){wanted.add('fireaxeLight');wanted.add('fireaxeHeavy');}
      if(player.weapon==='sniper')wanted.add('sniperShot');
    }
    // A raid wave (or a stand drill) decodes the five raider takes before the first burst.
    if(this.scene.raid||this.scene.zombies?.some(zombie=>zombie.kind==='raider'))for(const kind of Object.keys(RAIDER_TAKES))wanted.add(kind);
    for(const kind of [...wanted])if(this.catalog.effects[`${kind}Swing`])wanted.add(`${kind}Swing`);
    for(const kind of wanted)for(const entry of this.catalog.effects[kind]||[])this.loadBuffer(entry.src);
  }
  proceduralMusic(kind) {
    if(this.synthBuffers.has(kind))return this.synthBuffers.get(kind);
    const sampleRate=22050,duration=16,buffer=this.ctx.createBuffer(1,sampleRate*duration,sampleRate),data=buffer.getChannelData(0);
    const heavy=kind!=='ambient',finale=kind==='finale',root=finale?36.6875:heavy?41.25:55,third=finale?51.9375:heavy?58.25:65.4375;
    const notes=heavy?[164.81,174.61,164.81,146.83,155.56,146.83,130.81,123.47]:[220,0,207.65,0,196,0,164.81,0];
    for(let i=0;i<data.length;i++) {
      const t=i/sampleRate,note=notes[Math.floor(t/2)],envelope=Math.sin(Math.PI*(t%2)/2)**2;
      const drone=.09*Math.sin(2*Math.PI*root*t)+.04*Math.sin(2*Math.PI*third*t)+.025*Math.sin(2*Math.PI*82.5*t);
      const melody=note?.035*Math.sin(2*Math.PI*note*t)*envelope:0;
      const pulse=heavy?.045*Math.sin(2*Math.PI*(finale?41.25:55)*t)*Math.exp(-14*(t%(finale?.25:.5))):0;
      data[i]=drone*(.82+.18*Math.cos(2*Math.PI*t/8))+melody+pulse;
    }
    this.synthBuffers.set(kind,buffer);return buffer;
  }
  fade(param,value,seconds=1.5) {
    const t=this.ctx.currentTime;
    if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(t);else{param.cancelScheduledValues(t);param.setValueAtTime(param.value,t);}
    param.linearRampToValueAtTime(value,t+seconds);
  }
  musicVoice(kind,buffer,key,gain) {
    const previous=this.music[kind],source=this.ctx.createBufferSource(),level=this.ctx.createGain();
    source.buffer=buffer;source.loop=true;level.gain.value=0;source.connect(level);level.connect(this.musicBus);
    this.track(source,[level]);source.start();this.music[kind]={source,level,key,gain,target:null};
    if(previous){this.fade(previous.level.gain,0,1.5);try{previous.source.stop(this.ctx.currentTime+1.6);}catch(_){}}
    return this.music[kind];
  }
  updateScene(snapshot,inGame=false) {
    this.scene=snapshot;this.inGame=inGame===true;
    if(!snapshot)this.raidAnnounced=false;
    if(!this.inGame||!snapshot){this.bruteAnnounced=false;this.bossAnnounced=false;this.stopSources();return;}
    if(!snapshot?.zombies?.some(zombie=>zombie.kind==='brute'))this.bruteAnnounced=false;
    if(!snapshot?.zombies?.some(zombie=>zombie.boss))this.bossAnnounced=false;
    this.ambient();
  }
  playEffect(kind,volume=1,cooldown=.035,pitch=1,varyPitch=true,voiceId='local') {
    if(!this.ready()||!this.volume)return false;
    const entries=this.catalog.effects[kind];if(!entries?.length)return false;
    const key=voiceId==='local'?kind:`${kind}:${voiceId}`;
    const now=this.ctx.currentTime;if(now-(this.effectLast.get(key)??-Infinity)<cooldown)return true;
    const entry=entries[Math.floor(this.random()*entries.length)%entries.length],record=this.loadBuffer(entry.src);
    if(!record?.buffer)return false;
    const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=record.buffer;source.playbackRate.value=(varyPitch ? .97+this.random()*.06 : 1)*pitch;
    gain.gain.value=entry.gain*volume;source.connect(gain);gain.connect(this.output);this.track(source,[gain]);
    source.start();source.stop(now+record.buffer.duration/source.playbackRate.value+.03);this.effectLast.set(key,now);return true;
  }
  noise(duration=.2,volume=.2,frequency=1000,type='lowpass',delay=0) {
    if(!this.ready()||!this.volume)return;
    const t=this.ctx.currentTime+delay,source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain();
    source.buffer=this.noiseBuffer;filter.type=type;filter.frequency.setValueAtTime(frequency,t);filter.Q.value=.7;
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),t+.003);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    source.connect(filter);filter.connect(gain);gain.connect(this.output);this.track(source,[filter,gain]);source.start(t,Math.random());source.stop(t+duration+.01);
  }
  tone(frequency,endFrequency,duration,volume=.1,type='sine',delay=0) {
    if(!this.ready()||!this.volume)return;
    const t=this.ctx.currentTime+delay,source=this.ctx.createOscillator(),gain=this.ctx.createGain();source.type=type;
    source.frequency.setValueAtTime(frequency,t);source.frequency.exponentialRampToValueAtTime(Math.max(10,endFrequency),t+duration);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),t+.004);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    source.connect(gain);gain.connect(this.output);this.track(source,[gain]);source.start(t);source.stop(t+duration+.02);
  }
  shoot(type='rifle',{held=false,voiceId='local'}={}) {
    if(MELEE_WEAPONS[type])return;
    if(type==='sniper'){
      // The selected rifle report stays separate from its mechanical cycle.
      if(!this.playEffect('sniperShot',1,0,1,false))this.proceduralShot(type);
      this.sniperBolt(voiceId);return;
    }
    if(type==='assault'){this.assaultShot(voiceId,{held});return;}
    if(type==='minigun'){this.minigun({held,voiceId});return;}
    if(sustainedWeapons.includes(type)&&this.sustainFire(type,{held,voiceId}))return;
    if(!(!sustainedWeapons.includes(type)&&this.playEffect(type,1,type==='rocket'?0:.035,1,type!=='rocket',voiceId)))this.proceduralShot(type);
    if(type==='shotgun')this.shotgunPump(voiceId);
  }
  singleShot(type='rifle',{voiceId='local'}={}) {
    if(type==='assault'){this.assaultShot(voiceId);return;}
    if(!sustainedWeapons.includes(type)&&type!=='minigun'){this.shoot(type,{voiceId});return;}
    if(!this.ready()||!this.volume)return;
    const entries=this.catalog.effects[type==='minigun'?'minigunFire':type];
    if(entries?.length) {
      const entry=entries[Math.floor(this.random()*entries.length)%entries.length],record=this.loadBuffer(entry.src);
      if(record?.buffer&&(type!=='minigun'||record.buffer.duration>MINIGUN_TIMING.fireOffset)) {
        const now=this.ctx.currentTime,source=this.ctx.createBufferSource(),level=this.ctx.createGain();
        source.buffer=record.buffer;source.loop=false;
        level.gain.setValueAtTime(0,now);level.gain.linearRampToValueAtTime(entry.gain,now+.004);
        level.gain.setValueAtTime(entry.gain,now+.06);level.gain.linearRampToValueAtTime(0,now+.085);
        source.connect(level);level.connect(this.output);this.track(source,[level]);source.start(now,type==='minigun'?MINIGUN_TIMING.fireOffset:0);source.stop(now+.09);
        return;
      }
    }
    if(type==='minigun') {
      this.tone(110,72,.12,.07,'sawtooth');this.tone(330,216,.12,.035,'triangle');this.noise(.1,.045,1800,'bandpass');
    } else this.proceduralShot(type);
  }
  proceduralShot(type='rifle') {
    if(type==='pistol') {
      this.noise(.11,.29,3000);this.noise(.018,.13,6200,'highpass');this.tone(245,62,.1,.19,'triangle');
    } else if (type==='magnum') {
      this.noise(.34,.62,1600);this.noise(.035,.3,5800,'highpass');this.tone(150,32,.28,.38,'triangle');
    } else if(type==='sniper') {
      this.noise(.24,.39,2100);this.noise(.025,.2,6400,'highpass');this.tone(175,39,.23,.24,'triangle');
      this.noise(.31,.055,480,'lowpass',.09);
    } else if(type==='shotgun') {
      this.noise(.36,.68,1900);this.noise(.075,.38,5500,'highpass');this.tone(160,38,.26,.42,'triangle');this.noise(.18,.065,420,'lowpass',.09);
      this.noise(.085,.14,3200,'bandpass',.04);
    } else if(type==='rocket') {
      // Launch only: the authoritative impact event supplies the distant blast.
      this.noise(.24,.25,650,'lowpass');this.noise(.08,.1,2100,'bandpass');this.tone(100,45,.2,.1,'triangle');
    } else if(type==='flamethrower') {
      this.noise(.1,.045,1100,'lowpass');this.noise(.04,.015,2200,'bandpass');
    } else if(type==='smg'||type==='assault') {
      this.noise(.12,.35,2800);this.noise(.025,.14,6500,'highpass');this.tone(210,60,.085,.21,'triangle');
    } else {
      this.noise(.21,.46,2400);this.noise(.045,.24,5200,'highpass');this.tone(190,42,.15,.29,'triangle');this.noise(.04,.075,3900,'bandpass',.065);
    }
    // A quieter delayed tail suggests the timber room's short reflection.
    this.noise(type==='shotgun'?.23:.13,.045,950,'lowpass',.07);
  }
  shotgunPump(voiceId='local',delay=.12) {
    this.releasePump(voiceId);
    if(!this.ready()||!this.volume)return false;
    const start=this.ctx.currentTime+(Number.isFinite(delay)?Math.max(0,delay):.12);
    const voice={id:voiceId,sources:new Set(),levels:new Set()};this.pumpVoices.set(voiceId,voice);this.pumpCapture=voice;
    try {
      const entries=this.catalog.effects.shotgunPump;
      const entry=entries?.[Math.floor(this.random()*entries.length)%entries.length],record=entry&&this.loadBuffer(entry.src);
      if(record?.buffer) {
        const source=this.ctx.createBufferSource(),level=this.ctx.createGain();
        source.buffer=record.buffer;source.playbackRate.value=1;level.gain.value=entry.gain;
        source.connect(level);level.connect(this.output);this.track(source,[level]);
        source.start(start);source.stop(start+record.buffer.duration);return true;
      }
      // Keep an unavailable sample immediate and cancellable, with no late replay.
      const wait=start-this.ctx.currentTime;
      this.noise(.11,.075,650,'bandpass',wait);
      this.noise(.035,.1,2800,'highpass',wait+.16);this.tone(400,110,.045,.025,'triangle',wait+.16);
      return false;
    } finally {this.pumpCapture=null;}
  }
  releasePump(voiceId) {
    if(voiceId===undefined){for(const id of [...this.pumpVoices.keys()])this.releasePump(id);return;}
    const voice=this.pumpVoices.get(voiceId);if(!voice)return;this.pumpVoices.delete(voiceId);
    for(const level of voice.levels)this.fade(level.gain,0,.02);
    for(const source of voice.sources)try{source.stop(this.ctx.currentTime+.025);}catch(_){}
  }
  sniperBolt(voiceId='local') {
    this.releasePump(voiceId);
    if(!this.ready()||!this.volume)return false;
    const voice={id:voiceId,sources:new Set(),levels:new Set()};this.pumpVoices.set(voiceId,voice);this.pumpCapture=voice;
    try {
      // These mechanical sounds track the production bolt opening, sliding,
      // and closing during the 1.25 s firing cycle, and cancel on weapon change.
      this.noise(.045,.07,3400,'highpass',.16);this.tone(510,210,.045,.02,'triangle',.16);
      this.noise(.16,.065,1350,'bandpass',.32);this.noise(.12,.06,1600,'bandpass',.67);
      this.noise(.04,.085,3900,'highpass',.84);this.tone(380,130,.055,.025,'triangle',.84);
      return true;
    } finally {this.pumpCapture=null;}
  }
  melee(attack='light',volume=1,voiceId='local',weapon='katana',timing={}) {
    if(!['light','heavy'].includes(attack))return false;
    this.releaseMelee(voiceId);
    const gain=Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):0;
    if(!this.ready()||!this.volume||!gain)return false;
    const timed=weapon==='hammer'||weapon==='bat'||weapon==='fireaxe',profile=MELEE_WEAPONS[weapon]?.[attack];
    const elapsed=timed&&Number.isFinite(timing?.elapsed)?Math.max(0,timing.elapsed):0;
    if(timed&&elapsed>=profile.duration)return false;
    const voice={id:voiceId,attack,weapon,sources:new Set(),levels:new Set()};
    this.meleeVoices.set(voiceId,voice);this.meleeCapture=voice;
    try {
      if(timed) {
        const heavy=attack==='heavy';
        const windup=Number.isFinite(timing?.windup)&&timing.windup>=0&&timing.windup<profile.duration?timing.windup:profile.windup;
        const kind=`${weapon}${heavy?'Heavy':'Light'}`;
        const entry=this.catalog.effects[kind]?.[0],record=entry&&this.loadBuffer(entry.src);
        const advance=entry?.sync?.advance??(weapon==='hammer'?HAMMER_AUDIO_ADVANCE:0);
        const extraDelay=entry?.sync?.delay??0;
        // The swing layer, if any, joins every swing, hit or miss, after the take.
        const swung=()=>this.meleeSwing(kind,gain,elapsed,windup);
        if(record?.buffer) {
          // Align contact without cutting the beginning of a timely swing.
          // Only a genuinely late network event skips elapsed recording time;
          // a take with sync.start always begins that far into its recording.
          const impact=entry.sync?.impact??windup,skip=entry.sync?.start??0;
          if(impact<record.buffer.duration) {
            const delay=Math.max(0,windup-(impact-skip)-advance)+extraDelay;
            const now=this.ctx.currentTime,wait=delay-elapsed,start=now+Math.max(0,wait),offset=skip+Math.max(0,-wait);
            if(offset>=record.buffer.duration){if(swung())return true;this.meleeVoices.delete(voiceId);return false;}
            // timing.predict() says whether the blow will land; a miss keeps no impact.
            const cut=typeof timing?.predict==='function'?MELEE_IMPACTS[entry.src]:null;
            const impactAt=cut?start-offset+cut.at:Infinity,fadeAt=cut?Math.max(start,impactAt-cut.fade):Infinity;
            const decideAt=Math.min(now+windup-elapsed-MELEE_PREDICT_LEAD,fadeAt-MELEE_DECIDE_MARGIN);
            let hit=null;
            if(cut&&decideAt<=now){hit=this.predictMelee(timing.predict);if(!hit&&impactAt-start<MELEE_MIN_FADE){if(swung())return true;this.meleeVoices.delete(voiceId);return false;}}
            const source=this.ctx.createBufferSource(),level=this.ctx.createGain(),value=entry.gain*gain;
            source.buffer=record.buffer;source.loop=false;source.playbackRate.value=1;level.gain.value=value;source.connect(level);
            this.meleeOutput(source,level,start,offset);
            source.start(start,offset);source.stop(start+record.buffer.duration-offset);
            if(cut) {
              voice.gate={param:level.gain,value,fadeAt,impactAt,attackId:timing.attackId,closed:false,settled:false};
              if(hit===false)this.closeMeleeGate(voice);
              else if(hit===null)voice.gateTimer=this.schedule(()=>{
                voice.gateTimer=null;
                if(this.meleeVoices.get(voiceId)===voice&&voice.gate&&!voice.gate.settled&&!this.predictMelee(timing.predict))this.closeMeleeGate(voice);
              },(decideAt-now)*1000);
            }
            swung();return true;
          }
        }
        // Missing or undecoded takes keep a cancellable fallback with the same delay;
        // completing a download never replays an expired attack.
        this.noise(heavy?.4:.22,(heavy?.14:.105)*gain,heavy?540:850,'bandpass',Math.max(0,windup-advance+extraDelay-.2-elapsed));
        this.tone(heavy?130:190,heavy?45:80,heavy?.26:.16,.045*gain,'triangle',Math.max(0,windup-advance+extraDelay-.16-elapsed));
        this.noise(.06,.035*gain,2200,'highpass',Math.max(0,windup-advance+extraDelay-elapsed));
        swung();return true;
      }
      const entry=this.catalog.effects[attack==='heavy'?'katanaHeavy':'katanaLight']?.[0];
      const record=entry&&this.loadBuffer(entry.src);
      if(record?.buffer) {
        const source=this.ctx.createBufferSource(),level=this.ctx.createGain();
        source.buffer=record.buffer;source.loop=false;source.playbackRate.value=1;level.gain.value=entry.gain*gain;
        source.connect(level);level.connect(this.output);this.track(source,[level]);
        source.start();source.stop(this.ctx.currentTime+record.buffer.duration);return true;
      }
      // Decoding never replays an expired swing. An immediate, tracked whoosh
      // preserves feedback and can be cancelled by the same gameplay lifecycle.
      const heavy=attack==='heavy';
      this.noise(heavy?.68:.27,(heavy?.13:.09)*gain,heavy?900:1500,'bandpass');
      this.tone(heavy?180:340,heavy?70:140,heavy?.45:.18,.025*gain,'triangle',heavy?.2:0);
      return false;
    } finally {this.meleeCapture=null;}
  }
  // The owner's swing layer of a timed attack (manifest `${kind}Swing`): a whoosh
  // with no impact, heard on every swing, hit or miss. Its sync.impact (the end
  // of its loud part) lands on contact, as a swing leading into the blow; without
  // one it starts with the attack. A late event skips the elapsed part, opening
  // over 5 ms. It shares the swing's voice, so a new swing, a release or silence
  // stops it with the take.
  meleeSwing(kind,gain,elapsed,windup) {
    const entry=this.catalog.effects[`${kind}Swing`]?.[0],record=entry&&this.loadBuffer(entry.src);
    if(!record?.buffer)return false;
    const delay=Math.max(0,windup-(entry.sync?.impact??windup))+(entry.sync?.delay??0),wait=delay-elapsed,offset=Math.max(0,-wait);
    if(offset>=record.buffer.duration)return false;
    const start=this.ctx.currentTime+Math.max(0,wait),source=this.ctx.createBufferSource(),level=this.ctx.createGain();
    source.buffer=record.buffer;source.loop=false;source.playbackRate.value=1;level.gain.value=entry.gain*gain;
    source.connect(level);this.meleeOutput(source,level,start,offset);
    source.start(start,offset);source.stop(start+record.buffer.duration-offset);return true;
  }
  // Connects a timed take or swing layer; one that begins inside its recording
  // opens over 5 ms. The gate and the voice level stay on `level`.
  meleeOutput(source,level,start,offset) {
    if(offset>0){
      const opening=this.ctx.createGain();opening.gain.value=0;opening.gain.setValueAtTime(0,start);opening.gain.linearRampToValueAtTime(1,start+MELEE_START_FADE);
      level.connect(opening);opening.connect(this.output);this.track(source,[level,opening]);
    } else {level.connect(this.output);this.track(source,[level]);}
  }
  // A failing prediction keeps the recorded take whole.
  predictMelee(predict) {try{return predict()===true;}catch(_){return true;}}
  // A miss: silent from the recorded impact, fading from fadeAt or from now.
  closeMeleeGate(voice) {
    const gate=voice.gate,now=this.ctx.currentTime;
    if(!gate||gate.closed)return false;
    const from=Math.max(now,gate.fadeAt);
    if(gate.fadeAt<gate.impactAt?gate.impactAt-from<MELEE_MIN_FADE:now>gate.impactAt)return false;
    gate.closed=true;gate.from=from;
    if(gate.impactAt>from){gate.param.setValueAtTime(gate.value,from);gate.param.linearRampToValueAtTime(0,gate.impactAt);}
    else gate.param.setValueAtTime(0,gate.impactAt);
    return true;
  }
  // A hit after a predicted miss: nothing was cut before the fade; later the
  // gain comes back from its current level, up to 30 ms into the impact.
  openMeleeGate(voice) {
    const gate=voice.gate,now=this.ctx.currentTime;
    if(!gate)return false;
    if(!gate.closed)return true;
    if(now>=gate.impactAt+MELEE_RESTORE)return false;
    gate.closed=false;gate.param.cancelScheduledValues(now);
    if(now<=gate.from){gate.param.setValueAtTime(gate.value,now);return true;}
    const level=gate.impactAt>gate.from?gate.value*Math.max(0,Math.min(1,(gate.impactAt-now)/(gate.impactAt-gate.from))):0;
    gate.param.setValueAtTime(level,now);gate.param.linearRampToValueAtTime(gate.value,now+MELEE_RESTORE_RAMP);
    return true;
  }
  // The server's verdict on this swing settles its gate, whatever was predicted.
  confirmMelee(voiceId,attackId,hits) {
    const voice=this.meleeVoices.get(voiceId),gate=voice?.gate;
    if(!gate||!this.ctx||(attackId!==undefined&&gate.attackId!==undefined&&attackId!==gate.attackId))return false;
    if(voice.gateTimer!=null){this.cancel(voice.gateTimer);voice.gateTimer=null;}
    gate.settled=true;
    return hits>0?this.openMeleeGate(voice):this.closeMeleeGate(voice);
  }
  releaseMelee(voiceId) {
    if(voiceId===undefined){for(const id of [...this.meleeVoices.keys()])this.releaseMelee(id);return;}
    const voice=this.meleeVoices.get(voiceId);if(!voice)return;this.meleeVoices.delete(voiceId);
    if(voice.gateTimer!=null){this.cancel(voice.gateTimer);voice.gateTimer=null;}voice.gate=null;
    for(const level of voice.levels)this.fade(level.gain,0,.02);
    for(const source of voice.sources)try{source.stop(this.ctx.currentTime+.025);}catch(_){}
  }
  sustainRifle() {return this.sustainFire('rifle');}
  // One voice per raider: a new shot cuts its own tail; at most ten raider
  // sources, the oldest giving way. An undecoded take stays silent.
  raiderShot(kind,{voiceId='raider',volume=1,pan=0}={}) {
    const mode=RAIDER_TAKES[kind],level=Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):0;
    if(!mode||!level||!this.ready()||!this.volume)return false;
    const now=this.ctx.currentTime;if(now-(this.raiderLast.get(voiceId)??-Infinity)<RAIDER_COOLDOWN)return false;
    const entries=this.catalog.effects[kind];if(!entries?.length)return false;
    const entry=mode==='grain'?entries[0]:entries[Math.floor(this.random()*entries.length)%entries.length],record=this.loadBuffer(entry.src);
    const buffer=record?.buffer&&(mode==='grain'&&entry.shot!==true?this.assaultGrainBuffer(entry,record.buffer):record.buffer);
    if(!buffer)return false;
    this.raiderLast.set(voiceId,now);this.releaseRaider(voiceId);
    while(this.raiderVoices.size>=RAIDER_VOICE_CAP)this.releaseRaider(this.raiderVoices.keys().next().value);
    const voice={id:voiceId,sources:new Set(),levels:new Set()};this.raiderVoices.set(voiceId,voice);this.raiderCapture=voice;
    try {
      const source=this.ctx.createBufferSource(),gain=this.ctx.createGain(),stereo=this.ctx.createStereoPanner?.()??null,peak=entry.gain*RAIDER_MIX*level;
      source.buffer=buffer;source.loop=false;source.playbackRate.value=1;
      if(mode==='excerpt'){gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(peak,now+.004);gain.gain.setValueAtTime(peak,now+.06);gain.gain.linearRampToValueAtTime(0,now+.085);}
      else gain.gain.value=peak;
      source.connect(gain);
      if(stereo){stereo.pan.value=Math.max(-1,Math.min(1,Number.isFinite(pan)?pan:0));gain.connect(stereo);stereo.connect(this.output);}
      else gain.connect(this.output);
      this.track(source,stereo?[gain,stereo]:[gain]);source.start(now);source.stop(now+(mode==='excerpt'?.09:buffer.duration));
      return true;
    } finally {this.raiderCapture=null;}
  }
  releaseRaider(voiceId) {
    if(voiceId===undefined){for(const id of [...this.raiderVoices.keys()])this.releaseRaider(id);return;}
    const voice=this.raiderVoices.get(voiceId);if(!voice)return;this.raiderVoices.delete(voiceId);
    for(const level of voice.levels)this.fade(level.gain,0,.008);
    for(const source of voice.sources)try{source.stop(this.ctx.currentTime+.012);}catch(_){}
  }
  assaultGrainBuffer(entry,buffer) {
    const rate=buffer.sampleRate,channels=buffer.numberOfChannels,grain=entry.grain;
    const start=grain?Math.round(grain.start*rate):0,end=grain?Math.round(grain.end*rate):Math.min(buffer.length,Math.round(.095*rate));
    if(!Number.isFinite(rate)||rate<=0||!Number.isInteger(channels)||channels<1||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>buffer.length||end<=start)return null;
    const length=end-start,fadeIn=Math.min(length,Math.round((grain?.fadeIn??.001)*rate)),fadeOut=Math.min(length,Math.round((grain?.fadeOut??.012)*rate));
    if(fadeIn+fadeOut>=length)return null;
    const key=`assault-grain:${entry.src}:${start}:${end}:${fadeIn}:${fadeOut}`;
    if(this.fireBuffers.has(key))return this.fireBuffers.get(key);
    const result=this.ctx.createBuffer(channels,length,rate);
    for(let channel=0;channel<channels;channel++){
      const source=buffer.getChannelData(channel),target=result.getChannelData(channel);target.set(source.subarray(start,end));
      for(let i=0;i<fadeIn;i++)target[i]*=i/Math.max(1,fadeIn);
      for(let i=0;i<fadeOut;i++)target[length-1-i]*=i/Math.max(1,fadeOut);
    }
    this.fireBuffers.set(key,result);return result;
  }
  assaultTailBuffer(entry,buffer) {
    const grain=this.assaultGrainBuffer(entry,buffer);if(!grain)return null;
    const rate=buffer.sampleRate,start=entry.grain?Math.round(entry.grain.start*rate):0,end=start+grain.length;
    const overlap=Math.round(.01*rate),tailLength=Math.round(.045*rate),prefix=grain.length-overlap;
    if(tailLength<=overlap*3||grain.length<tailLength+overlap)return grain;
    const length=Math.max(grain.length,Math.round((FIRE_INTERVALS.assault+.05)*rate)),fadeOut=Math.round(.03*rate);
    const key=`assault-tail:${entry.src}:${start}:${end}:${length}:${overlap}:${entry.grain?.fadeIn??.001}`;
    if(this.fireBuffers.has(key))return this.fireBuffers.get(key);
    // Repeat only the attack-free end of the selected report. Its original
    // attack stays at this bullet's arrival; no extra gunshot is scheduled.
    const tail=this.fireLoopBuffer({...entry,loop:{start:(end-tailLength)/rate,end:end/rate,crossfade:overlap/rate}},buffer);
    if(tail===buffer)return grain;
    const result=this.ctx.createBuffer(buffer.numberOfChannels,length,rate),fadeIn=Math.round((entry.grain?.fadeIn??.001)*rate);
    for(let channel=0;channel<buffer.numberOfChannels;channel++){
      const source=buffer.getChannelData(channel),target=result.getChannelData(channel),loop=tail.getChannelData(channel);
      target.set(source.subarray(start,start+prefix));
      for(let i=0;i<Math.min(fadeIn,prefix);i++)target[i]*=i/Math.max(1,fadeIn);
      for(let i=prefix;i<length;i++)target[i]=loop[(i-prefix+loop.length-overlap)%loop.length];
      for(let i=0;i<fadeOut;i++)target[length-1-i]*=i/Math.max(1,fadeOut-1);
    }
    this.fireBuffers.set(key,result);return result;
  }
  assaultShot(voiceId='local',{held=false}={}) {
    if(!this.ready()||!this.volume){this.releaseAssault(voiceId);return false;}
    const entry=this.catalog.effects.assault?.[0],record=entry&&this.loadBuffer(entry.src),whole=entry?.shot===true;
    // A complete owner-selected single-shot take plays whole for
    // every round: its natural tail fades under the next round's attack. The
    // grain and repeated-tail path stays for a take cut from a burst.
    const buffer=record?.buffer&&(whole?record.buffer:held?this.assaultTailBuffer(entry,record.buffer):this.assaultGrainBuffer(entry,record.buffer));
    if(!whole&&(!held||!buffer))this.releaseAssault(voiceId);
    const voice=this.assaultVoices.get(voiceId)??{id:voiceId,sources:new Set(),levels:new Set()};
    this.assaultVoices.set(voiceId,voice);this.assaultCapture=voice;
    try {
      if(buffer){
        // Ordinary 130–167 ms arrivals overlap only their decaying tails.
        // A batch of delayed packets must not allocate an unbounded chorus.
        // Allow the whole recording to finish at the actual firing cadence;
        // the owner's two-second take needs 16 voices, not the previous four.
        const cap=whole?Math.min(32,Math.max(4,Math.ceil(buffer.duration/FIRE_INTERVALS.assault))):2;
        while(voice.sources.size>=cap){const oldest=voice.sources.values().next().value;try{oldest.stop();oldest.onended?.();}catch(_){}voice.sources.delete(oldest);}
        const source=this.ctx.createBufferSource(),level=this.ctx.createGain();
        source.buffer=buffer;source.loop=false;source.playbackRate.value=1;level.gain.value=entry.gain;
        source.connect(level);level.connect(this.output);this.track(source,[level]);
        source.start();source.stop(this.ctx.currentTime+buffer.duration);return true;
      }
      // Each confirmation supplies one immediate event, never a late decoded
      // replay or an autonomous held-fire loop with a different shot cadence.
      this.proceduralShot('assault');return false;
    } finally {this.assaultCapture=null;}
  }
  releaseAssault(voiceId) {
    if(voiceId===undefined){for(const id of [...this.assaultVoices.keys()])this.releaseAssault(id);return;}
    const voice=this.assaultVoices.get(voiceId);if(!voice)return;this.assaultVoices.delete(voiceId);
    for(const level of voice.levels)this.fade(level.gain,0,.008);
    for(const source of voice.sources)try{source.stop(this.ctx.currentTime+.012);}catch(_){}
  }
  fireLoopBuffer(entry,buffer) {
    const loop=entry.loop??selectedFireLoops[entry.src];if(!loop)return buffer;
    const rate=buffer.sampleRate,channels=buffer.numberOfChannels;
    if(!Number.isFinite(rate)||!Number.isInteger(channels)||channels<1||loop.end>buffer.duration)return buffer;
    const start=Math.round(loop.start*rate),end=Math.round(loop.end*rate),overlap=Math.round(loop.crossfade*rate),length=end-start;
    if(overlap<2||length<overlap*3)return buffer;
    const gain=Number.isFinite(loop.gain)?Math.max(0,Math.min(1,loop.gain)):1;
    const key=`${entry.src}:${start}:${end}:${overlap}:${gain}`;if(this.fireBuffers.has(key))return this.fireBuffers.get(key);
    // Keep the selected recording intact on disk. Only its sustained section is
    // looped; equal-power overlap avoids replaying the recording's decaying tail.
    const result=this.ctx.createBuffer(channels,length-overlap,rate),straight=length-overlap*2;
    for(let channel=0;channel<channels;channel++) {
      const source=buffer.getChannelData(channel),target=result.getChannelData(channel);
      target.set(source.subarray(start+overlap,end-overlap));
      for(let i=0;i<overlap;i++) {
        const angle=(i+.5)/overlap*Math.PI/2;
        target[straight+i]=source[end-overlap+i]*Math.cos(angle)+source[start+i]*Math.sin(angle);
      }
      if(gain!==1)for(let i=0;i<target.length;i++)target[i]*=gain;
    }
    this.fireBuffers.set(key,result);return result;
  }
  sustainFire(type,{held=false,voiceId='local'}={}) {
    if(!sustainedWeapons.includes(type))return false;
    if(!this.ready()||!this.volume)return false;
    const voices=this.fireVoices.get(type);
    let voice=voices.get(voiceId);
    if(!voice) {
      const entries=this.catalog.effects[type];
      const entry=entries?.length?entries[Math.floor(this.random()*entries.length)%entries.length]:null,record=entry?this.loadBuffer(entry.src):null;
      if(!record?.buffer&&type!=='flamethrower')return false;
      const source=this.ctx.createBufferSource(),level=this.ctx.createGain();
      source.buffer=record?.buffer?this.fireLoopBuffer(entry,record.buffer):this.noiseBuffer;source.loop=true;level.gain.setValueAtTime(0,this.ctx.currentTime);
      level.gain.linearRampToValueAtTime(record?.buffer?entry.gain:.065,this.ctx.currentTime+.012);
      const filter=!record?.buffer?this.ctx.createBiquadFilter():null;
      if(filter){filter.type='lowpass';filter.frequency.value=1300;filter.Q.value=.65;source.connect(filter);filter.connect(level);}else source.connect(level);
      level.connect(this.output);this.track(source,filter?[filter,level]:[level]);source.start();
      voice={id:voiceId,source,level,held:false,procedural:!record?.buffer,timer:null};voices.set(voiceId,voice);
    }
    voice.held=voice.held||held===true;
    if(voice.timer!==null){this.cancel(voice.timer);voice.timer=null;}
    // Remote fire has no release message: tolerate one missing confirmation,
    // then stop within a bounded delay instead of keeping an unattended loop.
    const watchdog=type==='smg'?200:type==='rifle'?230:Math.max(150,(FIRE_INTERVALS[type]??.1)*2000+30);
    if(!voice.held)voice.timer=this.schedule(()=>{if(voices.get(voiceId)===voice)this.releaseFire(type,voiceId);},watchdog);
    if(voiceId==='local'){this[`${type}Voice`]=voice;this[`${type}Timer`]=voice.timer;}
    return true;
  }
  releaseFire(type,voiceId) {
    if(type===undefined){for(const kind of [...sustainedWeapons,'minigun','assault'])this.releaseFire(kind,voiceId);return;}
    // Releasing the trigger stops future rounds, not the confirmed single
    // shot's decay. Explicit actor cancellation and stopSources still clean
    // these voices on down/leave, pause, mute, scene changes and full stop.
    if(type==='assault'){if(this.catalog.effects.assault?.[0]?.shot!==true)this.releaseAssault(voiceId);return;}
    if(type==='minigun') {
      if(voiceId===undefined){for(const id of [...this.minigunVoices.keys()])this.releaseFire(type,id);return;}
      const state=this.minigunVoices.get(voiceId);if(!state)return;this.minigunVoices.delete(voiceId);
      if(state.timer!==null)this.cancel(state.timer);
      this.stopMinigunVoice(state.voice);this.stopMinigunVoice(state.spinVoice);
      if(voiceId==='local'){this.minigunVoice=null;this.minigunSpinVoice=null;this.minigunSpinning=false;this.minigunTimer=null;}
      return;
    }
    if(!sustainedWeapons.includes(type))return;
    const voices=this.fireVoices.get(type);
    if(voiceId===undefined){for(const id of [...voices.keys()])this.releaseFire(type,id);return;}
    const voice=voices.get(voiceId);if(!voice)return;voices.delete(voiceId);
    if(voice.timer!==null)this.cancel(voice.timer);
    if(voiceId==='local'){this[`${type}Voice`]=null;this[`${type}Timer`]=null;}
    this.fade(voice.level.gain,0,.055);try{voice.source.stop(this.ctx.currentTime+.065);}catch(_){}
  }
  minigunSample(kind,loop) {
    // Rotation and firing use different portions of the same selected take.
    const entries=this.catalog.effects.minigunFire;if(!entries?.length)return null;
    const entry=entries[Math.floor(this.random()*entries.length)%entries.length],record=this.loadBuffer(entry.src);
    if(!record?.buffer||(loop&&record.buffer.duration<=MINIGUN_TIMING.loopStart))return null;
    const prepared=loop?this.minigunFireBuffer(entry,record.buffer):null;if(loop&&!prepared)return null;
    const now=this.ctx.currentTime,source=this.ctx.createBufferSource(),level=this.ctx.createGain();
    source.buffer=prepared?.buffer??record.buffer;source.loop=loop;
    if(loop){source.loopStart=prepared.loopStart;source.loopEnd=prepared.loopEnd;}
    level.gain.setValueAtTime(0,now);level.gain.linearRampToValueAtTime(entry.gain,now+.015);
    source.connect(level);level.connect(this.output);this.track(source,[level]);source.start(now,loop?MINIGUN_TIMING.fireOffset:0);
    if(!loop)source.stop(now+Math.min(MINIGUN_TIMING.windup,record.buffer.duration));
    return {kind:'sample',source,level};
  }
  minigunFireBuffer(entry,buffer) {
    const loop={start:MINIGUN_TIMING.loopStart,end:Math.min(MINIGUN_TIMING.loopEnd,buffer.duration),crossfade:MINIGUN_TIMING.crossfade};
    const section=this.fireLoopBuffer({...entry,loop},buffer);if(section===buffer)return null;
    const start=Math.round(loop.start*buffer.sampleRate)+Math.round(loop.crossfade*buffer.sampleRate);
    const end=Math.round(loop.end*buffer.sampleRate),key=`minigun:${entry.src}:${start}:${end}`;
    if(!this.fireBuffers.has(key)){
      // Preserve the complete prefix so the first confirmed shot still starts
      // at exactly 1 s. Only the final overlap differs from the selected PCM.
      const prepared=this.ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
      for(let channel=0;channel<buffer.numberOfChannels;channel++){
        const target=prepared.getChannelData(channel);target.set(buffer.getChannelData(channel));target.set(section.getChannelData(channel),start);
      }
      this.fireBuffers.set(key,prepared);
    }
    return {buffer:this.fireBuffers.get(key),loopStart:start/buffer.sampleRate,loopEnd:end/buffer.sampleRate};
  }
  proceduralMinigun(spinning=false) {
    const now=this.ctx.currentTime,windup=MINIGUN_TIMING.windup;
      const rotor=this.ctx.createOscillator(),harmonic=this.ctx.createOscillator(),noise=this.ctx.createBufferSource();
      const rotorGain=this.ctx.createGain(),harmonicGain=this.ctx.createGain(),noiseGain=this.ctx.createGain();
      const filter=this.ctx.createBiquadFilter(),level=this.ctx.createGain();
      rotor.type='sawtooth';rotor.frequency.setValueAtTime(82,now);rotor.frequency.exponentialRampToValueAtTime(154,now+(spinning?windup:.13));
      harmonic.type='triangle';harmonic.frequency.setValueAtTime(246,now);harmonic.frequency.exponentialRampToValueAtTime(462,now+(spinning?windup:.13));
      rotorGain.gain.value=.58;harmonicGain.gain.value=.24;noiseGain.gain.value=.2;
      filter.type='bandpass';filter.frequency.value=1800;filter.Q.value=.65;
      noise.buffer=this.noiseBuffer;noise.loop=true;
      level.gain.setValueAtTime(0,now);level.gain.linearRampToValueAtTime(spinning?.055:.14,now+(spinning?.18:.07));
      rotor.connect(rotorGain);harmonic.connect(harmonicGain);noise.connect(filter);filter.connect(noiseGain);
      rotorGain.connect(level);harmonicGain.connect(level);noiseGain.connect(level);level.connect(this.output);
      this.track(rotor);this.track(harmonic);this.track(noise,[rotorGain,harmonicGain,noiseGain,filter,level]);
      rotor.start();harmonic.start();noise.start();
      if(spinning){level.gain.setValueAtTime(.055,now+windup-.05);level.gain.linearRampToValueAtTime(0,now+windup+.04);for(const source of [rotor,harmonic,noise])source.stop(now+windup+.05);}
      return {kind:'procedural',rotor,harmonic,noise,level};
  }
  stopMinigunVoice(voice,seconds=.12) {
    if(!voice)return;
    const now=this.ctx.currentTime;this.fade(voice.level.gain,0,seconds);
    if(voice.kind==='sample'){try{voice.source.stop(now+seconds+.01);}catch(_){}return;}
    voice.rotor.frequency.exponentialRampToValueAtTime(48,now+seconds);voice.harmonic.frequency.exponentialRampToValueAtTime(144,now+seconds);
    for(const source of [voice.rotor,voice.harmonic,voice.noise])try{source.stop(now+seconds+.01);}catch(_){}
  }
  startMinigun({voiceId='local'}={}) {
    const state=this.minigunVoices.get(voiceId)??{voice:null,spinVoice:null,spinning:false,timer:null};
    if(!this.ready()||!this.volume||state.spinning||state.voice)return false;
    this.releaseReload(voiceId);state.spinning=true;
    state.spinVoice=this.minigunSample('minigunSpin',false)||this.proceduralMinigun(true);this.minigunVoices.set(voiceId,state);
    if(voiceId==='local'){this.minigunSpinning=state.spinning;this.minigunSpinVoice=state.spinVoice;}
    return true;
  }
  minigun({held=false,voiceId='local'}={}) {
    if(!this.ready()||!this.volume)return;
    const state=this.minigunVoices.get(voiceId)??{voice:null,spinVoice:null,spinning:false,timer:null};this.minigunVoices.set(voiceId,state);
    this.stopMinigunVoice(state.spinVoice,.035);state.spinVoice=null;state.spinning=false;
    const voice=state.voice||(state.voice=this.minigunSample('minigunFire',true)||this.proceduralMinigun());
    voice.held=voice.held||held===true;
    if(state.timer!==null){this.cancel(state.timer);state.timer=null;}
    if(!voice.held)state.timer=this.schedule(()=>{
      if(this.minigunVoices.get(voiceId)===state&&state.voice===voice)this.releaseFire('minigun',voiceId);
    },150);
    if(voiceId==='local'){this.minigunVoice=voice;this.minigunSpinVoice=null;this.minigunSpinning=false;this.minigunTimer=state.timer;}
  }
  reload(type='pistol',duration,{voiceId='local'}={}) {
    if(MELEE_WEAPONS[type])return false;
    if(!this.ready()||!this.volume)return false;
    if(!Object.hasOwn(reloadEffects,type))type='pistol';
    const now=this.ctx.currentTime,limit=Number.isFinite(duration)&&duration>0?Math.min(15,duration):null;
    const previous=this.reloadVoices.get(voiceId);
    if(previous?.type===type&&now<previous.endAt)return false;
    // Older callers have no actor/hand identity and retain their global reset.
    // New gameplay callers always identify a hand, leaving every other one intact.
    const scoped=arguments.length>=3;
    this.releaseReload(scoped?voiceId:undefined);this.releaseFire(undefined,scoped?voiceId:undefined);this.releasePump(voiceId);
    const entries=reloadEffects[type]?this.catalog.effects[reloadEffects[type]]:null;
    const entry=entries?.length?entries[Math.floor(this.random()*entries.length)%entries.length]:null;
    const record=entry?this.loadBuffer(entry.src):null;
    const length=Math.min(record?.buffer?.duration??(type==='sniper'?3:.7),limit??Infinity);
    const voice={id:voiceId,type,sources:new Set(),levels:new Set(),endAt:now+(limit??length)};
    this.reloadVoices.set(voiceId,voice);if(voiceId==='local')this.reloadVoice=voice;this.reloadCapture=voice;
    try {
      if(record?.buffer) {
        const source=this.ctx.createBufferSource(),level=this.ctx.createGain();source.buffer=record.buffer;source.loop=false;
        level.gain.setValueAtTime(entry.gain,now);level.gain.setValueAtTime(entry.gain,now+Math.max(0,length-.025));level.gain.linearRampToValueAtTime(0,now+length);
        source.connect(level);level.connect(this.output);this.track(source,[level]);source.start();source.stop(now+length);
      } else if(type==='sniper') {
        this.noise(.06,.085,2900,'highpass');this.noise(.12,.065,950,'bandpass',.3);
        this.noise(.07,.1,2200,'bandpass',1.9);this.noise(.12,.07,1600,'bandpass',2.45);
        this.tone(410,155,.05,.035,'triangle',2.72);this.noise(.035,.085,3300,'highpass',2.72);
        if(limit!==null)for(const source of voice.sources)source.stop(now+length);
      } else {
        this.noise(.05,.12,2300,'highpass');this.tone(480,180,.055,.04,'triangle');
        this.noise(.07,.14,2700,'bandpass',.34);this.noise(.045,.18,3500,'highpass',.62);this.tone(650,250,.04,.05,'square',.64);
        if(limit!==null)for(const source of voice.sources)source.stop(now+length);
      }
    } finally {this.reloadCapture=null;}
    return true;
  }
  releaseReload(voiceId) {
    if(voiceId===undefined){for(const id of [...this.reloadVoices.keys()])this.releaseReload(id);return;}
    const voice=this.reloadVoices.get(voiceId);if(!voice)return;this.reloadVoices.delete(voiceId);if(voiceId==='local')this.reloadVoice=null;
    for(const level of voice.levels)this.fade(level.gain,0,.02);
    for(const source of voice.sources)try{source.stop(this.ctx.currentTime+.025);}catch(_){}
  }
  // A style may replace hit(), headshot(), kill(headshot, kind, heavy, delay),
  // groan(volume) and chain(count), and add ambience(on) and heartbeat(level);
  // whatever it lacks stays Famille.
  // It plays only while audio runs, through the same output and master volume.
  setStyle(style=null) {
    const next=style&&typeof style==='object'?style:null;
    if(next===this.style)return;
    this.styleOff();this.style=next;
    if(next&&this.ready()&&this.volume)this.styleAmbience();
  }
  styled(name,args) {
    const play=this.style?.[name];if(typeof play!=='function')return false;
    if(this.ready()&&this.volume)try{play.apply(this.style,args);}catch(_){ /* A style never breaks the game's sound. */ }
    return true;
  }
  // The Famille sound itself, even under a style: a candidate may layer it.
  famille(name,...args) {
    if(!['hit','headshot','kill','groan','chain'].includes(name))return;
    const style=this.style;this.style=null;
    try{this[name](...args);}finally{this.style=style;}
  }
  // A style's bed and heartbeat follow the music: in game, countdown to intermission.
  styleScene() {return this.inGame&&this.ready()&&this.volume>0&&['wave','countdown','intermission'].includes(this.scene?.phase);}
  styleAmbience() {
    const on=typeof this.style?.ambience==='function'&&this.styleScene();
    if(on===this.styleAmbienceOn)return;
    this.styleAmbienceOn=on;try{this.style?.ambience?.(on);}catch(_){}
  }
  styleOff() {
    const style=this.style;
    if(this.styleAmbienceOn){this.styleAmbienceOn=false;try{style?.ambience?.(false);}catch(_){}}
    if(this.styleHeartbeat){this.styleHeartbeat=0;try{style?.heartbeat?.(0);}catch(_){}}
  }
  // The local player's heartbeat, from 0 (none) to 1 (down): a style's only.
  // Called every frame while it beats; the style schedules ahead from it.
  heartbeat(level=0) {
    if(typeof this.style?.heartbeat!=='function')return false;
    const value=this.styleScene()&&Number.isFinite(level)?Math.max(0,Math.min(1,level)):0;
    if(!value&&!this.styleHeartbeat)return false;
    this.styleHeartbeat=value;try{this.style.heartbeat(value);}catch(_){}
    return value>0;
  }
  hit() {if(this.styled('hit'))return;this.noise(.09,.16,780);this.tone(125,54,.06,.07,'triangle');}
  headshot() {
    if(this.styled('headshot'))return;
    if(!this.ready()||!this.volume)return;
    const now=this.ctx.currentTime;if(now-this.lastHeadshotAt<.04)return;
    this.lastHeadshotAt=now;
    this.tone(1568,2093,.09,.05,'sine');this.tone(3136,2637,.06,.018,'triangle',.012);this.noise(.03,.035,5200,'highpass');
  }
  chain(count) {
    if(!this.ready()||!this.volume||!Number.isFinite(count)||count<2)return;
    const whole=Math.floor(count),n=Math.min(whole,6),now=this.ctx.currentTime;
    if(whole<=this.lastChainN&&now-this.lastChainAt<.15)return;
    this.lastChainAt=now;this.lastChainN=whole;
    if(this.style&&this.styled('chain',[whole]))return;
    // Past 6 kills, each step of the ladder climbs further: 8, 15, 30, 75.
    const extra=whole>=75?4:whole>=30?3:whole>=15?2:whole>=8?1:0;
    const notes=[523.25,659.25,783.99,1046.5,1318.5,1568,2093,2637,3136,4186],steps=n+extra,last=notes[steps-1];
    for(let i=0;i<steps;i++)this.tone(notes[i],notes[i]*1.01,.12,.045,'triangle',i*.06);
    this.tone(last,last,.26+extra*.05,.05,'triangle',(steps-1)*.06);this.tone(last*2,last*2,.2,.012,'sine',(steps-1)*.06+.01);
    if(n>=5)this.noise(.25+extra*.08,.03+extra*.006,6000,'highpass',(steps-1)*.06);
    if(extra>=2)this.tone(notes[3],notes[3],.32+extra*.04,.035,'sine',(steps-1)*.06);
  }
  hurt() {this.noise(.22,.25,620);this.tone(105,55,.24,.16,'sawtooth');}
  grenadeThrow() {this.noise(.035,.08,3200,'highpass');this.tone(520,210,.045,.035,'triangle');}
  explosion(volume=1,{weapon}={}) {
    const gain=Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):0;
    if(!gain)return;
    // Keep the selected take's pitch, and allow separate simultaneous grenades.
    // The rocket has its own owner-chosen impact (take 3), the grenade take 4.
    if(weapon==='rocket'&&this.playEffect('rocketExplosion',gain,0,1,false))return;
    if(this.playEffect('explosion',gain,0,1,false))return;
    this.noise(.5,.48*gain,750,'lowpass');this.noise(.055,.2*gain,4200,'highpass');
    this.tone(96,26,.45,.32*gain,'triangle');this.noise(.35,.075*gain,230,'lowpass',.12);
  }
  groan(volume=.055) {
    if(this.styled('groan',[volume]))return;
    if(this.playEffect('groan',volume/.055,.8))return;
    if(!this.ready()||!this.volume)return;
    const t=this.ctx.currentTime,source=this.ctx.createOscillator(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain();
    source.type='sawtooth';source.frequency.setValueAtTime(65+Math.random()*20,t);source.frequency.linearRampToValueAtTime(46,t+.8);
    filter.type='lowpass';filter.frequency.setValueAtTime(380,t);filter.frequency.linearRampToValueAtTime(140,t+1);
    gain.gain.setValueAtTime(.0001,t);gain.gain.linearRampToValueAtTime(volume,t+.23);gain.gain.exponentialRampToValueAtTime(.0001,t+1.1);
    source.connect(filter);filter.connect(gain);gain.connect(this.output);this.track(source,[filter,gain]);source.start(t);source.stop(t+1.2);
  }
  // The zombie's voice is always groan(): a styled groan speaks here too. A
  // style also hears the kill's kind and its delay; Famille ignores them.
  kill(headshot=false,kind='shot',heavy=false,delay=0) {if(typeof this.style?.kill==='function'&&this.styled('kill',[headshot,kind,heavy,delay]))return;this.groan(.09);if(FAMILLE_KILL){this.clac(FAMILLE_KILL);return;}this.noise(.12,.1,350);}
  // A Famille kill "clac" (KILL_CLACS), 40 ms after the shot, at most one per
  // 70 ms so a shotgun's kills never stack. Unknown or inherited names: false.
  clac(id) {
    if(!Object.hasOwn(KILL_CLACS,id)||!this.ready()||!this.volume)return false;
    const now=this.ctx.currentTime;if(now-this.lastClacAt<.07)return true;
    this.lastClacAt=now;KILL_CLACS[id](this);return true;
  }
  // A raider going down: a body-fall thud, never the zombie groan.
  raiderDown() {this.noise(.14,.11,330);this.tone(92,44,.14,.08,'triangle');}
  // Proposal for the owner to judge by ear (never listened to by the author):
  // a radio squelch, then a low dissonant pair through a lowpass, about 0.9 s.
  // Squads get the squelch alone. Event and snapshot calls share the cooldown.
  raidAlarm({squad=false}={}) {
    if(!this.ready()||!this.volume)return false;
    const now=this.ctx.currentTime;
    if(now-this.lastRaidAlarmAt<RAID_ALARM_COOLDOWN||squad&&now-this.lastRaidSquelchAt<RAID_ALARM_COOLDOWN)return false;
    this[squad?'lastRaidSquelchAt':'lastRaidAlarmAt']=now;
    this.noise(squad?.12:.18,squad?.06:.075,1900,'bandpass');this.noise(.045,.035,3600,'highpass',squad?.08:.13);
    if(squad)return true;
    const start=now+.2,duration=.68,filter=this.ctx.createBiquadFilter(),level=this.ctx.createGain();
    filter.type='lowpass';filter.frequency.setValueAtTime(520,start);filter.frequency.exponentialRampToValueAtTime(170,start+duration);filter.Q.value=.9;
    level.gain.setValueAtTime(.0001,start);level.gain.exponentialRampToValueAtTime(.11,start+.05);level.gain.exponentialRampToValueAtTime(.0001,start+duration);
    filter.connect(level);level.connect(this.output);
    // D2 against G#2: a tritone that reads as a threat, never a reward.
    [73.42,103.83].forEach((frequency,index)=>{
      const source=this.ctx.createOscillator();source.type='sawtooth';
      source.frequency.setValueAtTime(frequency,start);source.frequency.exponentialRampToValueAtTime(frequency*.94,start+duration);
      source.connect(filter);this.track(source,index?[filter,level]:[]);source.start(start);source.stop(start+duration+.02);
    });
    return true;
  }
  wave() {
    this.tone(110,110,.7,.08,'triangle');this.tone(138.59,138.59,.8,.055,'sine',.13);this.tone(164.81,164.81,1,.05,'sine',.28);
    this.noise(.6,.045,350,'lowpass',.12);
  }
  extraction() {
    // A short rotor approach followed by the extraction radio acknowledgement.
    this.tone(68,83,1.35,.075,'triangle');
    for(let i=0;i<18;i++) this.noise(.075,.025+i*.002,260,'lowpass',i*.06);
    this.noise(.18,.05,1900,'bandpass',1.1);
    this.tone(740,740,.1,.055,'sine',1.18);this.tone(1046.5,1046.5,.12,.045,'sine',1.35);
  }
  victory() {
    for(let i=0;i<4;i++) this.tone([261.63,329.63,392,523.25][i],[261.63,329.63,392,523.25][i],.85,.055,'sine',i*.11);
    this.tone(130.81,130.81,1.25,.065,'triangle');this.noise(.35,.022,620,'lowpass',.1);
  }
  brute() {if(this.playEffect('brute',1,8))return;this.tone(62,31,1.15,.11,'triangle');this.tone(87,46,.8,.045,'sine',.12);this.noise(.6,.055,180,'lowpass');}
  boss() {if(this.playEffect('boss',1,10)||this.playEffect('brute',.9,10,.75))return;this.tone(46,23,1.6,.12,'triangle');this.tone(65.4,32.7,1.3,.055,'sine',.16);this.noise(.9,.07,130,'lowpass');}
  boardBreak() {
    if(!this.ready()||!this.volume||this.ctx.currentTime-this.lastBoardBreakAt<.1)return;
    this.lastBoardBreakAt=this.ctx.currentTime;if(this.playEffect('boardBreak',.7,.1))return;
    this.noise(.17,.17,1500,'bandpass');this.noise(.055,.09,3800,'highpass',.03);this.tone(160,58,.14,.06,'triangle');
  }
  updateFootsteps(self,enabled=true) {
    if(!self||!enabled||!this.inGame||!self.alive||self.downed||self.grounded===false||!Number.isFinite(self.x)||!Number.isFinite(self.z)) {
      this.footstep=null;this.footstepDistance=0;return;
    }
    if(!this.footstep||this.footstep.id!==self.id){this.footstep={id:self.id,x:self.x,z:self.z};return;}
    const traveled=Math.hypot(self.x-this.footstep.x,self.z-this.footstep.z);
    this.footstep.x=self.x;this.footstep.z=self.z;
    if(traveled>2){this.footstepDistance=0;return;}
    if(traveled<.001)return;
    this.footstepDistance+=traveled;
    if(!this.ready()||!this.volume||this.footstepDistance<.95||this.ctx.currentTime-this.lastFootstepAt<.25)return;
    this.footstepDistance=0;this.lastFootstepAt=this.ctx.currentTime;
    if(this.playEffect(self.outside?'footstepOutdoor':'footstepIndoor',.16,.22))return;
    this.noise(.075,self.outside?.045:.055,self.outside?420:850,'lowpass');
    if(!self.outside)this.tone(100,66,.07,.018,'triangle');
  }
  repair() {if(this.playEffect('repair',1,.15))return;this.noise(.055,.16,1000);this.tone(170,78,.07,.14,'triangle');}
  purchase() {this.tone(330,440,.12,.06,'triangle');this.tone(660,880,.17,.06,'sine',.12);this.noise(.05,.08,2000,'highpass');}
  revive() {for(let i=0;i<3;i++)this.tone([261.63,329.63,392][i],[261.63,329.63,392][i],.35,.065,'sine',i*.12);}
  ambient() {
    if(!this.ready()||!this.volume)return;
    if(this.style)this.styleAmbience();
    const eligible=this.inGame&&['wave','countdown','intermission'].includes(this.scene?.phase);
    this.prepareEffects();
    const boss=eligible&&this.scene.zombies?.some(zombie=>zombie.boss);
    // A missed 'raid' event cannot silence the alarm; a delivered one is not repeated.
    const raid=eligible&&this.scene.raid?.triggered===true&&this.scene.raid.cleared!==true;
    if(raid&&!this.raidAnnounced){this.raidAlarm();this.raidAnnounced=true;}else if(!raid)this.raidAnnounced=false;
    const finale=eligible&&(this.scene.wave>=MAX_WAVES||boss);
    const brute=eligible&&this.scene.zombies?.some(zombie=>zombie.kind==='brute');
    if(boss&&!this.bossAnnounced){if(this.ctx.currentTime-this.lastBossAt>=10){this.boss();this.lastBossAt=this.ctx.currentTime;}this.bossAnnounced=true;}
    if(brute&&!boss&&!this.bruteAnnounced){if(this.ctx.currentTime-this.lastBruteAt>=8){this.brute();this.lastBruteAt=this.ctx.currentTime;}this.bruteAnnounced=true;}
    for(const kind of ['ambient','brute','finale']) {
      let voice=this.music[kind];
      if(eligible&&(kind!=='finale'||finale||voice)) {
        let entry=this.catalog.music[kind==='ambient'?MUSIC_THEME_CATALOG[this.musicTheme]:kind],record=entry?this.loadBuffer(entry.src):null;
        // A missing candidate preserves the original atmosphere. A pending decode
        // cannot replace a newer choice because callbacks read the current theme.
        if(kind==='ambient'&&this.musicTheme!=='original'&&(!entry||record?.settled&&!record.buffer)){
          entry=this.catalog.music.ambient;record=entry?this.loadBuffer(entry.src):null;
        }
        // Keep the current score while a newly selected local file decodes.
        // The transition then needs a single crossfade rather than a synth detour.
        if(record?.buffer||!voice||record?.settled||!entry){
          const key=record?.buffer?entry.src:`synth:${kind}`,buffer=record?.buffer||this.proceduralMusic(kind);
          if(!voice||voice.key!==key)voice=this.musicVoice(kind,buffer,key,entry?.gain??.22);
        }
        if(record?.promise&&!record.notified){record.notified=true;void record.promise.then(()=>this.ambient());}
      }
      if(!voice)continue;
      const selected=kind==='finale'?finale:kind==='brute'?brute&&!finale:!brute&&!finale;
      const target=eligible&&selected?voice.gain*(this.scene.phase==='intermission'?.65:1):0;
      if(voice.target!==target){this.fade(voice.level.gain,target);voice.target=target;}
      if(!eligible){try{voice.source.stop(this.ctx.currentTime+1.6);}catch(_){}this.music[kind]=null;}
    }
  }
  stopSources() {
    this.styleOff();
    this.releaseReload();this.releasePump();this.releaseMelee();this.releaseAssault();this.releaseRaider();
    this.releaseFire();
    if(this.minigunTimer!==null){this.cancel(this.minigunTimer);this.minigunTimer=null;}
    this.minigunVoice=null;this.minigunSpinVoice=null;this.minigunSpinning=false;
    for(const type of sustainedWeapons){const timer=`${type}Timer`;if(this[timer]!==null){this.cancel(this[timer]);this[timer]=null;}this[`${type}Voice`]=null;}
    for(const source of this.active){try{source.stop();source.onended?.();}catch(_){}}
    this.active.clear();this.music={ambient:null,brute:null,finale:null};this.footstep=null;this.footstepDistance=0;
  }
  stop() {
    this.inGame=false;this.scene=null;this.bruteAnnounced=false;this.bossAnnounced=false;this.lastBruteAt=-Infinity;this.lastBossAt=-Infinity;
    this.lastFootstepAt=-Infinity;this.lastBoardBreakAt=-Infinity;this.effectLast.clear();
    this.raiderLast.clear();this.raidAnnounced=false;this.lastRaidAlarmAt=-Infinity;this.lastRaidSquelchAt=-Infinity;this.stopSources();
  }
}
