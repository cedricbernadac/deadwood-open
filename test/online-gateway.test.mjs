import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import WebSocket from 'ws';
import { createOnlineGateway } from '../online-gateway.mjs';
import { onlineConfig } from '../online-config.mjs';
import { createSharedCapacity, capacityView } from '../shared-capacity.mjs';
class Peer{
 constructor(url,options={}){this.socket=new WebSocket(url,options);this.messages=[];this.waiters=new Set();this.socket.on('error',()=>{});this.socket.on('message',raw=>{const m=JSON.parse(raw);this.messages.push(m);for(const w of [...this.waiters])if(w.predicate(m))w.finish(m);});}
 async open(){await once(this.socket,'open');return this;}
 send(m){const at=this.messages.length;this.socket.send(JSON.stringify(m));return at;}
 wait(predicate,at=0){const found=this.messages.slice(at).find(predicate);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiters.delete(w);reject(Error('Gateway response timed out'));},4000);const w={predicate,finish:m=>{clearTimeout(timer);this.waiters.delete(w);resolve(m);}};this.waiters.add(w);});}
 async join(build,extra={}){const at=this.send({type:'join',protocol:1,build,name:'Test',...extra});return this.wait(m=>['welcome','error','outdated'].includes(m.type),at);}
 async leave(){const at=this.send({type:'leave'});await this.wait(m=>m.type==='left',at);}
 async close(){if(this.socket.readyState===WebSocket.CLOSED)return;const ended=once(this.socket,'close');this.socket.close();await ended;}
}
async function fixture(t,overrides={}){
 const gateway=await createOnlineGateway({port:0,host:'127.0.0.1',config:{...onlineConfig({}),...overrides}});const a=await gateway.listen(),url='http://127.0.0.1:'+a.port;const peers=[];
 t.after(async()=>{await Promise.all(peers.map(p=>p.close()));await gateway.close();});
 const peer=async(map='cabin',options={})=>{const path=map==='supermarket'?'/maps/supermarket/':'/';const p=await new Peer(url.replace('http:','ws:')+path+'ws',options).open();peers.push(p);return p;};
 const build=map=>gateway.workers.get(map).build;
 return {gateway,url,peer,build};
}
async function until(read,predicate){let last;for(let i=0;i<80;i++){last=await read();if(predicate(last))return last;await new Promise(r=>setTimeout(r,15));}assert.fail('Gateway state did not settle: '+JSON.stringify(last));}

test('capacity leases are atomic across workers and an owner cannot release another map',async()=>{
 const descriptor=createSharedCapacity({rooms:5,players:20,connections:40}),a=capacityView(descriptor,0),b=capacityView(descriptor,1);
 const url=new URL('../shared-capacity.mjs',import.meta.url).href;
 const run=owner=>new Promise((resolve,reject)=>{const worker=new Worker(`const{parentPort,workerData}=require('node:worker_threads');import(workerData.url).then(({capacityView})=>{const p=capacityView(workerData.descriptor,workerData.owner);let held=0;for(let i=0;i<20;i++)if(p.reserve('rooms'))held++;parentPort.postMessage(held);});`,{eval:true,workerData:{url,descriptor,owner}});worker.on('message',resolve);worker.on('error',reject);});
 const held=await Promise.all([run(0),run(1)]);assert.equal(held[0]+held[1],5);assert.equal(a.count('rooms'),5);a.releaseAll();assert.equal(b.count('rooms'),held[1]);b.releaseAll();assert.deepEqual(a.snapshot(),{rooms:0,players:0,connections:0});assert.throws(()=>a.release('rooms'),/already released/);
 assert.equal(a.tryCreate(0,2,1000),true);assert.equal(b.tryCreate(0,2,1001),true);assert.equal(a.tryCreate(0,2,1002),false);assert.equal(b.tryCreate(0,2,61001),true);
});

test('gateway isolates HTML modules and workers while sharing media and one public port',async t=>{
 const {gateway,url}=await fixture(t);const health=await(await fetch(url+'/health')).json();assert.equal(health.ok,true);assert.deepEqual(health.capacity,{rooms:5,players:20,connections:40});assert.equal(health.maps.length,2);assert.ok(health.memory.rssBytes>0);
 assert.notEqual(gateway.workers.get('cabin').build,gateway.workers.get('supermarket').build);
 for(const [map,root]of [['cabin','/'],['supermarket','/maps/supermarket/']]){
  const html=await(await fetch(url+root)).text();assert.match(html,/<meta name="deadwood-multi-map" content="true">/);assert.ok(html.includes(`from '${root}i18n.js'`));assert.ok(html.includes(`import('${root}online-client.js')`));
  const config=await(await fetch(url+root+'connection.json')).json();assert.equal(config.multiMap,true);assert.equal(config.defaultMap,'cabin');assert.equal(config.maps.length,2);
  assert.deepEqual(await(await fetch(url+root+'version.json')).json(),{build:gateway.workers.get(map).build,mapId:map,mode:'online',protocol:1});
  assert.match(await(await fetch(url+root+'level-id.js')).text(),new RegExp('"'+map+'"'));
 }
 assert.equal((await fetch(url+'/maps/not-a-level/')).status,404);assert.equal((await fetch(url+'/maps/supermarket',{redirect:'manual'})).headers.get('location'),'/maps/supermarket/');
 assert.equal((await fetch(url+'/vendor/three.module.js')).status,200);
 console.log('Gateway idle RSS MiB:',(health.memory.rssBytes/2**20).toFixed(1));
});

test('global rooms and players are shared across maps with no ghost room after refusal',async t=>{
 const {gateway,peer,build}=await fixture(t,{maxRooms:2,maxPlayers:3,createsPerMinute:100});
 const a=await peer(),b=await peer('supermarket'),first=await a.join(build('cabin')),second=await b.join(build('supermarket'));
 assert.match(first.room,/^[0-9A-F]{6}$/);assert.match(second.room,/^S[0-9A-Z]{5}$/);
 const c=await peer('supermarket');assert.equal((await c.join(build('supermarket'))).code,'room-capacity');assert.equal(gateway.capacity.count('rooms'),2);
 assert.equal((await c.join(build('supermarket'),{room:second.room})).type,'welcome');
 const d=await peer();assert.equal((await d.join(build('cabin'),{room:first.room})).code,'player-capacity');assert.equal(gateway.capacity.count('players'),3);
 await c.leave();await b.leave();await until(()=>gateway.health(),h=>h.rooms===1&&h.players===1);
 assert.equal((await d.join(build('cabin'))).type,'welcome');await a.leave();await d.leave();assert.deepEqual(gateway.capacity.snapshot(),{rooms:0,players:0,connections:4});
});

test('disconnect reserves a shared player slot, resume reuses it, and expiration releases it',async t=>{
 const {gateway,peer,build}=await fixture(t,{maxRooms:3,maxPlayers:1,resumeGraceMs:160,createsPerMinute:100});const a=await peer(),first=await a.join(build('cabin'));await a.close();
 const b=await peer('supermarket');assert.equal((await b.join(build('supermarket'))).code,'player-capacity');
 const resumed=await peer(),at=resumed.send({type:'resume',protocol:1,build:build('cabin'),token:first.resumeToken});const welcome=await resumed.wait(m=>['welcome','error'].includes(m.type),at);assert.equal(welcome.type,'welcome');assert.equal(welcome.id,first.id);assert.equal(gateway.capacity.count('players'),1);
 await resumed.close();await until(()=>gateway.health(),h=>h.players===0&&h.rooms===0);
 assert.equal((await b.join(build('supermarket'))).type,'welcome');await b.leave();
});

test('connections, per-address cap, and room creation budget are global across the two paths',async t=>{
 const {gateway,url,peer,build}=await fixture(t,{maxConnections:2,maxConnectionsPerAddress:2,createsPerMinute:2});const a=await peer(),b=await peer('supermarket');
 const reject=new WebSocket(url.replace('http:','ws:')+'/maps/supermarket/ws',{headers:{'X-Forwarded-For':'203.0.113.2','x-deadwood-peer-ip':'203.0.113.3'}});reject.on('error',()=>{});const [,response]=await once(reject,'unexpected-response');assert.equal(response.statusCode,429);response.resume();reject.terminate();
 assert.equal((await a.join(build('cabin'))).type,'welcome');await a.leave();assert.equal((await b.join(build('supermarket'))).type,'welcome');await b.leave();assert.equal((await a.join(build('cabin'))).code,'create-rate');assert.equal(gateway.capacity.count('rooms'),0);
 await a.close();await until(()=>gateway.health(),h=>h.connections===1);
});

test('gateway preserves Origin checks and raw WebSocket control frames; workers reject forged proxy headers',async t=>{
 const {gateway,url,peer}=await fixture(t);
 const bad=new WebSocket(url.replace('http:','ws:')+'/maps/supermarket/ws',{origin:'https://untrusted.invalid'});bad.on('error',()=>{});const [,response]=await once(bad,'unexpected-response');assert.equal(response.statusCode,403);response.resume();bad.terminate();
 const good=await peer('supermarket',{origin:url});const pong=once(good.socket,'pong');good.socket.ping('raw-control');assert.equal((await pong)[0].toString(),'raw-control');
 const entry=gateway.workers.get('supermarket');assert.equal((await fetch('http://127.0.0.1:'+entry.port+'/health',{headers:{'x-deadwood-worker-key':'forged','x-deadwood-peer-ip':'203.0.113.2'}})).status,403);
});

test('a failed map is unhealthy and never falls back to cabin assets or simulation',async t=>{
 const {gateway,url}=await fixture(t);await gateway.workers.get('supermarket').worker.terminate();
 const response=await fetch(url+'/health'),health=await response.json();assert.equal(response.status,503);assert.equal(health.ok,false);assert.equal(health.maps.find(m=>m.id==='supermarket').ready,false);
 const missing=await fetch(url+'/maps/supermarket/world.json');assert.equal(missing.status,503);assert.equal((await missing.json()).mapId,'supermarket');assert.equal((await fetch(url+'/world.json')).status,200);
});


test('default five-room and twenty-player capacity is enforced across both workers',async t=>{
 const {gateway,peer,build}=await fixture(t);const hosts=[];
 for(let index=0;index<5;index++){const map=index%2?'supermarket':'cabin',p=await peer(map),welcome=await p.join(build(map));assert.equal(welcome.type,'welcome');hosts.push({map,p,welcome});}
 const probe=await peer();assert.equal((await probe.join(build('cabin'))).code,'room-capacity');const guests=[];
 for(const {map,welcome}of hosts)for(let index=0;index<3;index++){const p=await peer(map);assert.equal((await p.join(build(map),{room:welcome.room})).type,'welcome');guests.push(p);}
 assert.equal(gateway.capacity.count('players'),20);assert.equal(gateway.capacity.count('rooms'),5);
 assert.equal((await probe.join(build('cabin'),{room:hosts[0].welcome.room})).code,'player-capacity');
 const health=await gateway.health();assert.equal(health.players,20);assert.equal(health.rooms,5);console.log('Gateway 20-player lobby RSS MiB:',(health.memory.rssBytes/2**20).toFixed(1));
 for(const p of [...hosts.map(h=>h.p),...guests])await p.leave();assert.equal(gateway.capacity.count('rooms'),0);assert.equal(gateway.capacity.count('players'),0);
});

test('idle expiry and shutdown release cross-map leases even with disconnected reservations',async t=>{
 const {gateway,peer,build}=await fixture(t,{lobbyIdleMs:15,createsPerMinute:100});const a=await peer(),b=await peer('supermarket');
 assert.equal((await a.join(build('cabin'))).type,'welcome');assert.equal((await b.join(build('supermarket'))).type,'welcome');await b.close();
 await new Promise(resolve=>setTimeout(resolve,25));for(const entry of gateway.workers.values())entry.worker.postMessage({type:'heartbeat'});
 await until(()=>gateway.health(),health=>health.rooms===0&&health.players===0);
 assert.equal((await a.join(build('cabin'))).type,'welcome');await gateway.close();assert.deepEqual(gateway.capacity.snapshot(),{rooms:0,players:0,connections:0});
});
