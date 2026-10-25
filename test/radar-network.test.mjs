import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root=fileURLToPath(new URL('../',import.meta.url));
async function setup(t,practice=true) {
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}});
  let output='';
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(output||'Radar server did not start')),10000);
    const collect=chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Radar server exited ${code}: ${output}`));});
  });
  const peers=[];t.after(async()=>{await Promise.all(peers.map(peer=>peer.close()));});
  const build=(await(await fetch(origin+'/version.json')).json()).build;
  async function connect(room) {
    const peer=new Peer(origin);peers.push(peer);await once(peer.socket,'open');
    const since=peer.send({type:'join',build,name:'Radar QA',practice,...(room?{room}:{}),radar:{id:'forged',placed:true}});
    const welcome=await peer.wait(message=>message.type==='welcome',since);
    return {peer,...welcome};
  }
  return {connect};
}
class Peer {
  constructor(origin) {
    this.socket=new WebSocket(origin.replace(/^http/,'ws')+'/ws');this.messages=[];this.waiters=new Set();
    this.socket.on('error',()=>{});
    this.socket.on('message',raw=>{const message=JSON.parse(raw);this.messages.push(message);for(const waiter of [...this.waiters])if(waiter.predicate(message))waiter.resolve(message);});
  }
  mark(){return this.messages.length;}
  send(message){const since=this.mark();this.socket.send(JSON.stringify(message));return since;}
  wait(predicate,since=0) {
    const found=this.messages.slice(since).findLast(predicate);if(found)return Promise.resolve(found);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,resolve:message=>{clearTimeout(timer);this.waiters.delete(waiter);resolve(message);}};
      const timer=setTimeout(()=>{this.waiters.delete(waiter);reject(Error(`Radar wait timed out (${predicate.toString()}): ${JSON.stringify(this.messages.at(-1))}`));},5000);
      this.waiters.add(waiter);
    });
  }
  state(predicate,since=0){return this.wait(message=>message.type==='state'&&predicate(message),since);}
  async close(){if(this.socket.readyState===WebSocket.CLOSED)return;const closed=once(this.socket,'close');this.socket.close();await closed;}
}

test('real sockets grant each player their own permanent practice radar and ignore device-era commands',{timeout:20000},async t=>{
  const {connect}=await setup(t),host=await connect(),guest=await connect(host.room);
  let state=await host.peer.state(state=>state.players.length===2);
  assert.equal(state.radar,undefined,'joining cannot grant a forged device');
  assert.equal(state.players.every(player=>player.bonus===null),true);
  const hostSince=host.peer.send({type:'practice',action:'radar',level:1});
  state=await host.peer.state(state=>state.players.find(player=>player.id===host.id)?.bonus?.radar>=1,hostSince);
  assert.deepEqual(state.players.find(player=>player.id===host.id).bonus,{radar:8});
  // The guest carries their own: no shared appliance, no battery to preserve.
  const guestSince=guest.peer.send({type:'practice',action:'radar',expiresWave:999});
  state=await host.peer.state(state=>state.players.every(player=>player.bonus?.radar>=1),guestSince);
  assert.deepEqual(state.players.map(player=>player.bonus),[{radar:8},{radar:8}]);
  // Device-era messages no longer exist: they change nothing and crash nothing.
  const stale=host.peer.mark();
  host.peer.send({type:'radar-deploy',id:guest.id,x:100,y:30,z:100});
  host.peer.send({type:'radar-recover',id:host.id});
  const settled=await host.peer.state(state=>state.time>0,stale);
  assert.equal(settled.players.every(player=>player.bonus?.radar>=1),true,'stale commands cannot strip or move a bonus');
  const late=await connect(host.room);
  const lateState=await late.peer.state(state=>state.players.length===3);
  assert.equal(lateState.radar,undefined);
  assert.deepEqual(lateState.players.find(player=>player.id===host.id).bonus,{radar:8});
  const since=host.peer.send({type:'practice',action:'targets'});
  state=await host.peer.state(state=>state.players.length===3,state.players?since:host.peer.mark());
  assert.equal(state.players.find(player=>player.id===host.id).bonus.radar,8,'target reset keeps personal radars');
});

test('a campaign client cannot activate practice radar or fake a crate bonus',{timeout:15000},async t=>{
  const {connect}=await setup(t,false),host=await connect();
  let since=host.peer.send({type:'practice',action:'radar',wave:8});
  host.peer.send({type:'supply-claim',bonus:'radar',crateId:'supply-4',wave:4});
  await host.peer.wait(message=>message.event==='supply-denied',since);
  since=host.peer.send({type:'radar-deploy',radar:{id:'forged',placed:true},x:0,y:0,z:0});
  await host.peer.state(state=>state.players.length===1&&state.wave===0,host.peer.mark());
  const state=await host.peer.state(state=>state.players[0].bonus===null);
  assert.equal(state.radar,undefined);
  assert.equal(state.players[0].supplyAction===null||state.players[0].supplyAction===undefined,true);
});
