import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

class Peer {
  constructor(origin) {
    this.socket=new WebSocket(origin.replace(/^http/,'ws')+'/ws');this.messages=[];this.waiters=new Set();
    this.socket.on('error',()=>{});
    this.socket.on('message',raw=>{const value=JSON.parse(raw);this.messages.push(value);for(const waiter of [...this.waiters])if(waiter.predicate(value))waiter.resolve(value);});
  }
  mark(){return this.messages.length;}
  send(value){const mark=this.mark();this.socket.send(JSON.stringify(value));return mark;}
  wait(predicate,mark=0) {
    const found=this.messages.slice(mark).findLast(predicate);if(found)return Promise.resolve(found);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,resolve:value=>{clearTimeout(timer);this.waiters.delete(waiter);resolve(value);}};
      const timer=setTimeout(()=>{this.waiters.delete(waiter);reject(Error(`Pause wait timed out: ${JSON.stringify(this.messages.at(-1))}`));},5000);
      this.waiters.add(waiter);
    });
  }
  state(predicate,mark=0){return this.wait(value=>value.type==='state'&&predicate(value),mark);}
  async freshStates(count) {
    const values=[];
    for(let index=0;index<count;index++)values.push(await this.state(()=>true,this.mark()));
    return values;
  }
  async close(){if(this.socket.readyState===WebSocket.CLOSED)return;const ended=once(this.socket,'close');this.socket.close();await ended;}
}

async function setup(t,practice=false) {
  const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}});
  let output='';
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(output||'Pause test server did not start')),10000);
    const collect=chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Pause test server exited ${code}: ${output}`));});
  });
  const peers=[];t.after(async()=>{await Promise.all(peers.map(peer=>peer.close()));});
  const {build}=await(await fetch(origin+'/version.json')).json();
  async function connect(room) {
    const peer=new Peer(origin);peers.push(peer);await once(peer.socket,'open');
    const mark=peer.send({type:'join',build,name:'Pause QA',practice,...(room?{room}:{})});
    return {peer,...await peer.wait(value=>value.type==='welcome',mark)};
  }
  return {connect,origin};
}

const frozenView=state=>({time:state.time,timeLeft:state.timeLeft,phase:state.phase,wave:state.wave,
  remaining:state.remaining,toSpawn:state.toSpawn,players:state.players,zombies:state.zombies,
  grenades:state.grenades,spawnWarnings:state.spawnWarnings,doors:state.doors,pickups:state.pickups,
  expedition:state.expedition,supplyCrate:state.supplyCrate});

test('real peers freeze countdown and reload, reject paused actions, and resume after a paused host leaves',{timeout:20000},async t=>{
  const {connect}=await setup(t),host=await connect(),guest=await connect(host.room);
  let mark=host.peer.send({type:'start'});
  await host.peer.state(state=>state.phase==='countdown',mark);
  mark=host.peer.send({type:'shoot'});
  await host.peer.state(state=>state.players.find(player=>player.id===host.id).ammo===11,mark);
  mark=host.peer.send({type:'reload'});
  await host.peer.state(state=>state.players.find(player=>player.id===host.id).reloading,mark);
  mark=host.peer.send({type:'pause',paused:true,id:guest.id});
  const frozen=await host.peer.state(state=>state.paused===true,mark);
  assert.equal(frozen.pauseById,host.id,'the socket owner, not its forged id, pauses');
  await guest.peer.state(state=>state.paused===true);
  const unchanged=frozenView(frozen);
  for(const actor of [host,guest])for(const message of [
    {type:'pause',paused:'false'},
    {type:'input',forward:1,strafe:1,yaw:2,pitch:.5,crouch:true,sprint:true,jump:true},
    {type:'shoot'},{type:'reload'},{type:'grenade'},{type:'umbrella',open:true},
    {type:'drop-weapon'},{type:'interact'},{type:'buy',crateId:'pistol'},
    {type:'radar-deploy'},{type:'radar-recover'},{type:'minigun-spin',spinning:true},
    {type:'weapon',weapon:'pistol'},{type:'practice',action:'targets'},
  ])actor.peer.send(message);
  guest.peer.send({type:'pause',paused:false,id:host.id});
  for(const state of await host.peer.freshStates(10)) {
    assert.equal(state.paused,true);assert.deepEqual(frozenView(state),unchanged);
  }
  const late=await connect(host.room);
  const joined=await late.peer.state(state=>state.paused&&state.players.length===3);
  assert.equal(joined.time,frozen.time);assert.equal(joined.timeLeft,frozen.timeLeft);
  mark=guest.peer.mark();await host.peer.close();
  const transferred=await guest.peer.state(state=>state.hostId===guest.id&&state.players.length===2,mark);
  assert.equal(transferred.paused,true);
  mark=guest.peer.send({type:'pause',paused:false});
  const resumed=await guest.peer.state(state=>state.paused===false&&state.time>frozen.time,mark);
  assert.equal(resumed.pauseById,null);assert.ok(resumed.timeLeft<frozen.timeLeft);
  const pose=resumed.players.find(player=>player.id===guest.id);
  const settled=(await guest.peer.freshStates(3)).at(-1).players.find(player=>player.id===guest.id);
  assert.deepEqual([settled.x,settled.y,settled.z],[pose.x,pose.y,pose.z],'paused movement is not replayed on resume');
});

test('a shared practice pause preserves targets, weapon stocks and the personal radar until explicit resume',{timeout:15000},async t=>{
  const {connect}=await setup(t,true),host=await connect(),guest=await connect(host.room);
  let mark=host.peer.send({type:'practice',action:'radar'});
  const granted=await host.peer.state(state=>state.players.find(player=>player.id===host.id)?.bonus?.radar>=1,mark);
  assert.equal(granted.radar,undefined);
  mark=host.peer.send({type:'pause',paused:true});
  const frozen=await guest.peer.state(state=>state.paused===true,guest.peer.mark());
  assert.deepEqual(frozen.players.find(player=>player.id===host.id).bonus,{radar:8});
  const expected=frozenView(frozen);
  for(const actor of [host,guest])for(const message of [
    {type:'practice',action:'targets'},{type:'practice',action:'weapon',weapon:'hammer'},
    {type:'practice',action:'refill'},{type:'radar-deploy'},{type:'radar-recover'},
    {type:'shoot'},{type:'drop-weapon'},{type:'melee-cancel'},
  ])actor.peer.send(message);
  for(const state of await host.peer.freshStates(8))assert.deepEqual(frozenView(state),expected);
  mark=host.peer.send({type:'pause',paused:false});
  const resumed=await host.peer.state(state=>state.paused===false,mark);
  assert.deepEqual(resumed.players.find(player=>player.id===host.id).bonus,{radar:8},'device-era commands never touch the personal radar');
});
