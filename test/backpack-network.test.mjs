import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

test('two real clients keep four independent backpack slots private and authoritative through pause', {timeout:20000}, async t => {
  const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const peers=[];
  t.after(async()=>{
    await Promise.all(peers.map(async peer=>{
      if(peer.socket.readyState===WebSocket.CLOSED)return;
      const closed=once(peer.socket,'close');peer.socket.close();await closed;
    }));
    if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}
  });
  let output='';
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(output||'Backpack server did not start')),10000);
    const collect=chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Backpack server exited ${code}: ${output}`));});
  });
  const {build}=await(await fetch(origin+'/version.json')).json();
  async function connect(room){
    const socket=new WebSocket(origin.replace(/^http/,'ws')+'/ws'),messages=[],waiters=new Set();
    socket.on('error',()=>{});
    socket.on('message',raw=>{const value=JSON.parse(raw);messages.push(value);for(const waiter of [...waiters])if(waiter.predicate(value))waiter.resolve(value);});
    const peer={socket,mark:()=>messages.length,send:value=>{const mark=messages.length;socket.send(JSON.stringify(value));return mark;},
      wait(predicate,mark=0){
        const found=messages.slice(mark).findLast(predicate);if(found)return Promise.resolve(found);
        return new Promise((resolve,reject)=>{
          const waiter={predicate,resolve:value=>{clearTimeout(timer);waiters.delete(waiter);resolve(value);}};
          const timer=setTimeout(()=>{waiters.delete(waiter);reject(Error(`Backpack wait timed out: ${JSON.stringify(messages.at(-1))}`));},5000);waiters.add(waiter);
        });
      }};
    peer.state=(predicate,mark=0)=>peer.wait(value=>value.type==='state'&&predicate(value),mark);
    peers.push(peer);await once(socket,'open');
    const mark=peer.send({type:'join',build,name:'Backpack QA',practice:true,backpack:true,weaponSlots:99,...(room?{room}:{})});
    return {peer,...await peer.wait(value=>value.type==='welcome',mark)};
  }
  const host=await connect(),guest=await connect(host.room);
  const self=state=>state.players.find(player=>player.id===host.id),other=state=>state.players.find(player=>player.id===guest.id);
  let state=await guest.peer.state(state=>state.players.length===2);
  assert.equal(self(state).backpack,false);assert.equal(other(state).backpack,false,'forged join capacity is ignored');
  assert.equal(self(state).weaponSlots,2);
  const initial=self(state).weapons;
  let mark=host.peer.send({type:'practice',action:'backpack',id:guest.id});
  state=await guest.peer.state(state=>self(state).backpack,guest.peer.mark());
  assert.equal(self(state).weaponSlots,4);assert.equal(other(state).weaponSlots,2);
  assert.equal(other(state).backpack,false,'the socket owner receives the practice equipment');
  assert.deepEqual(self(state).weapons,initial,'the bag grants neither weapons nor ammunition');
  assert.equal(self(state).movementMultiplier,1,'an empty backpack has no movement penalty');
  async function equip(weapon){
    // Practice commands are rate-limited to 250 ms; observe simulation time.
    const current=await host.peer.state(()=>true,host.peer.mark());
    const readyAt=current.time+.27;
    await host.peer.state(state=>state.time>=readyAt,host.peer.mark());
    const start=host.peer.send({type:'practice',action:'weapon',weapon});
    return host.peer.state(state=>self(state).weapon===weapon,start);
  }
  state=await equip('sniper');
  assert.equal(self(state).weapons.length,3);
  assert.ok(Math.abs(self(state).movementMultiplier-.81)<1e-10,'three weapons: sniper mobility times 90%');
  state=await equip('hammer');
  assert.equal(self(state).weapons.length,4);
  assert.ok(Math.abs(self(state).movementMultiplier-.765)<1e-10,'four weapons: hammer mobility times 85%');
  const loadout=self(state).weapons.map(({weapon})=>weapon);
  assert.deepEqual(loadout,['assault','rocket','sniper','hammer']);
  const guestLoadout=other(state).weapons;
  for(const weapon of loadout){
    mark=host.peer.send({type:'weapon',weapon});
    state=await guest.peer.state(state=>self(state).weapon===weapon,guest.peer.mark());
    assert.equal(self(state).weapons.length,4);assert.deepEqual(other(state).weapons,guestLoadout);
  }
  mark=host.peer.send({type:'pause',paused:true});
  const frozen=await host.peer.state(state=>state.paused,mark);
  guest.peer.send({type:'practice',action:'backpack'});
  host.peer.send({type:'practice',action:'weapon',weapon:'pistol'});
  host.peer.send({type:'supply-buy',service:'backpack'});
  for(let index=0;index<4;index++){
    state=await guest.peer.state(()=>true,guest.peer.mark());
    assert.deepEqual(state.players,frozen.players);assert.equal(state.time,frozen.time);
  }
  mark=host.peer.send({type:'pause',paused:false});
  await host.peer.state(state=>!state.paused,mark);
  state=await equip('pistol');
  assert.equal(self(state).weapons.length,4,'a fifth practice weapon replaces the active slot');
  assert.deepEqual(self(state).weapons.map(({weapon})=>weapon),['assault','rocket','sniper','pistol']);
  assert.equal(other(state).backpack,false);
  mark=host.peer.send({type:'drop-weapon'});
  state=await host.peer.state(state=>self(state).weapons.length===3,mark);
  assert.equal(self(state).backpack,true);assert.equal(self(state).movementMultiplier,.9);
  const readyAt=state.time+.35;
  await host.peer.state(state=>state.time>=readyAt,host.peer.mark());
  mark=host.peer.send({type:'drop-weapon'});
  state=await host.peer.state(state=>self(state).weapons.length===2,mark);
  assert.equal(self(state).backpack,true);assert.equal(self(state).movementMultiplier,.8,'two weapons: only the held rocket weight remains');
});
