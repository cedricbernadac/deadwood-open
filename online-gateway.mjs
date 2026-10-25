import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onlineConfig } from './online-config.mjs';
import { createSharedCapacity, capacityView } from './shared-capacity.mjs';

export const ONLINE_MAPS=Object.freeze({multiMap:true,defaultMap:'cabin',maps:Object.freeze([
 Object.freeze({id:'cabin',root:'/',codePrefix:null}),
 Object.freeze({id:'supermarket',root:'/maps/supermarket/',codePrefix:'S'}),
])});
const PREFIX='/maps/supermarket/';
const json=(request,response,status,value)=>{
 const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?undefined:bytes);
};
const denySocket=(socket,status,reason)=>socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
function route(raw){
 let url;try{url=new URL(raw,'http://localhost');}catch{return null;}
 if(url.pathname.includes('\\')||url.pathname.includes('\0'))return null;
 if(url.pathname==='/maps/supermarket')return {redirect:PREFIX+url.search};
 if(url.pathname.startsWith(PREFIX))return {id:'supermarket',path:'/'+url.pathname.slice(PREFIX.length)+url.search,pathname:'/'+url.pathname.slice(PREFIX.length)};
 if(url.pathname.startsWith('/maps/'))return null;
 return {id:'cabin',path:url.pathname+url.search,pathname:url.pathname};
}

// One public listener, two private loopback listeners and two immutable ESM
// realms. The raw WebSocket tunnel preserves ping/pong RTT and compression.
export async function createOnlineGateway({port=Number(process.env.PORT??'3000'),host='0.0.0.0',config=onlineConfig(),autoTick=true}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT must be a valid TCP port.');
 const descriptor=createSharedCapacity({rooms:config.maxRooms,players:config.maxPlayers,connections:config.maxConnections});
 const capacity=capacityView(descriptor,2),proxyKey=randomBytes(32).toString('base64url');
 const workers=new Map(),sockets=new Set(),addressBuckets=new Map(),freeSlots=Array.from({length:descriptor.addressSlots},(_,i)=>descriptor.addressSlots-1-i);
 let closing=false,closePromise;
 const available=entry=>entry?.ready===true&&!entry.exited;
 const headers=(request,address='127.0.0.1',slot=null)=>{
  const clean={...request.headers};for(const key of Object.keys(clean))if(key.startsWith('x-deadwood-'))delete clean[key];
  return {...clean,'x-deadwood-worker-key':proxyKey,'x-deadwood-peer-ip':address,...(slot===null?{}:{'x-deadwood-peer-slot':String(slot)})};
 };
 function addressBucket(address){
  const now=Date.now();let entry=addressBuckets.get(address);if(entry){entry.at=now;return entry;}
  if(!freeSlots.length)for(const[ip,bucket]of addressBuckets)if(!bucket.count&&now-bucket.at>60000){addressBuckets.delete(ip);capacity.clearAddress(bucket.slot);freeSlots.push(bucket.slot);}
  if(!freeSlots.length)return null;
  entry={slot:freeSlots.pop(),count:0,at:now};addressBuckets.set(address,entry);return entry;
 }
 const backendHealth=entry=>new Promise(resolveHealth=>{
  if(!available(entry)){resolveHealth({ok:false,id:entry.id,mapId:entry.id,root:entry.root,ready:false});return;}
  const request=http.get({host:'127.0.0.1',port:entry.port,path:'/health',headers:{host:'localhost',...headers({headers:{}})}},response=>{
   let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;if(text.length>65536)request.destroy();});
   response.on('end',()=>{try{const value=JSON.parse(text);resolveHealth({...value,id:entry.id,root:entry.root,ready:value.ok===true});}catch{resolveHealth({ok:false,id:entry.id,mapId:entry.id,root:entry.root,ready:false});}});
  });
  request.setTimeout(1500,()=>request.destroy());request.on('error',()=>resolveHealth({ok:false,id:entry.id,mapId:entry.id,root:entry.root,ready:false}));
 });
 const health=async()=>{
  const maps=await Promise.all([...workers.values()].map(backendHealth)),counts=capacity.snapshot();
  return {ok:!closing&&maps.length===2&&maps.every(map=>map.ready),mode:'online',multiMap:true,defaultMap:'cabin',protocol:config.protocol,...counts,
   capacity:{rooms:config.maxRooms,players:config.maxPlayers,connections:config.maxConnections},maps,memory:{rssBytes:process.memoryUsage().rss}};
 };
 const server=http.createServer(async(request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
  const selected=route(request.url);if(!selected){response.writeHead(404);response.end();return;}
  if(selected.redirect){response.writeHead(308,{Location:selected.redirect});response.end();return;}
  if(selected.pathname==='/maps.json'&&selected.id==='cabin'){json(request,response,[...workers.values()].every(available)&&!closing?200:503,ONLINE_MAPS);return;}
  if(selected.pathname==='/health'&&selected.id==='cabin'){const state=await health();json(request,response,state.ok?200:503,state);return;}
  const entry=workers.get(selected.id);if(closing||!available(entry)){json(request,response,503,{ok:false,error:'map-unavailable',mapId:selected.id});return;}
  const upstream=http.request({host:'127.0.0.1',port:entry.port,method:request.method,path:selected.path,headers:headers(request)},backend=>{
   response.writeHead(backend.statusCode,backend.headers);backend.pipe(response);
  });
  upstream.setTimeout(10000,()=>upstream.destroy());
  upstream.on('error',()=>{if(response.headersSent)response.destroy();else json(request,response,503,{ok:false,error:'map-unavailable',mapId:selected.id});});
  request.on('aborted',()=>upstream.destroy());response.on('close',()=>{if(!response.writableFinished)upstream.destroy();});request.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(request,socket,head)=>{
  socket.on('error',()=>socket.destroy());const selected=route(request.url),entry=selected&&workers.get(selected.id);
  if(!selected||selected.redirect||selected.pathname!=='/ws'){denySocket(socket,404,'Not found');return;}
  if(closing||!available(entry)){denySocket(socket,503,'Map unavailable');return;}
  const address=request.socket.remoteAddress??'unknown',bucket=addressBucket(address);
  if(!bucket||bucket.count>=config.maxConnectionsPerAddress||!capacity.reserve('connections')){denySocket(socket,429,'Server busy');return;}
  bucket.count++;let released=false;
  const release=()=>{if(released)return;released=true;bucket.count--;bucket.at=Date.now();capacity.release('connections');};socket.once('close',release);
  const upstream=http.request({host:'127.0.0.1',port:entry.port,method:'GET',path:'/ws',headers:headers(request,address,bucket.slot)});
  upstream.setTimeout(10000,()=>upstream.destroy());
  upstream.once('upgrade',(backend,backendSocket,backendHead)=>{
   upstream.setTimeout(0);backendSocket.setTimeout(0);socket.setTimeout(0);
   if(socket.destroyed){backendSocket.destroy();return;}
   let initial=`HTTP/1.1 ${backend.statusCode} ${backend.statusMessage}\r\n`;for(let i=0;i<backend.rawHeaders.length;i+=2)initial+=backend.rawHeaders[i]+': '+backend.rawHeaders[i+1]+'\r\n';socket.write(initial+'\r\n');
   if(backendHead.length)socket.write(backendHead);if(head.length)backendSocket.write(head);
   backendSocket.on('error',()=>socket.destroy());socket.on('error',()=>backendSocket.destroy());backendSocket.on('close',()=>socket.destroy());socket.on('close',()=>backendSocket.destroy());
   socket.pipe(backendSocket);backendSocket.pipe(socket);
  });
  upstream.once('response',backend=>{denySocket(socket,backend.statusCode,backend.statusMessage);backend.resume();});
  upstream.on('error',()=>{if(!socket.destroyed)denySocket(socket,503,'Map unavailable');});socket.once('close',()=>upstream.destroy());upstream.end();
 });
 async function close(){
  if(closePromise)return closePromise;closing=true;
  closePromise=(async()=>{
   const stopped=server.listening?new Promise(resolveClose=>server.close(resolveClose)):Promise.resolve();
   await Promise.all([...workers.values()].map(entry=>new Promise(resolveWorker=>{
    if(entry.exited){resolveWorker();return;}
    const timer=setTimeout(()=>entry.worker.terminate(),1800);entry.worker.once('exit',()=>{clearTimeout(timer);resolveWorker();});entry.worker.postMessage({type:'close'});
   })));
   for(const socket of sockets)socket.destroy();await stopped;capacity.releaseAll();
  })();return closePromise;
 }
 try{
  await Promise.all(ONLINE_MAPS.maps.map((map,owner)=>new Promise((resolveReady,rejectReady)=>{
   const worker=new Worker(new URL('./online-worker.mjs',import.meta.url),{env:{...process.env,DEADWOOD_LEVEL:map.id},execArgv:[],workerData:{owner,capacity:descriptor,config,autoTick,proxyKey,catalog:ONLINE_MAPS,root:map.root}});
   const entry={...map,worker,ready:false};workers.set(map.id,entry);
   const timer=setTimeout(()=>rejectReady(Error('Map worker startup timed out: '+map.id)),20000);
   worker.on('message',message=>{if(message?.type==='ready'){entry.port=message.port;entry.build=message.build;entry.ready=true;clearTimeout(timer);resolveReady();}});
   worker.on('error',()=>{entry.ready=false;clearTimeout(timer);rejectReady(Error('Map worker failed: '+map.id));});
   worker.on('exit',()=>{const wasReady=entry.ready;entry.ready=false;entry.exited=true;capacity.clearOwner(owner);clearTimeout(timer);if(!wasReady)rejectReady(Error('Map worker exited: '+map.id));});
  })));
 }catch(error){await close();throw error;}
 return {server,workers,capacity,config,health,close,
  async listen(){await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,resolveListen);});return server.address();},
 };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const gateway=await createOnlineGateway(),address=await gateway.listen();
 console.log(`\n  DEADWOOD ONLINE\n  http://localhost:${address.port}\n  La cabane / Le Dernier Panier; ${gateway.config.maxRooms} rooms / ${gateway.config.maxPlayers} players maximum.\n`);
 const shutdown=()=>{gateway.close().then(()=>process.exit(0));setTimeout(()=>process.exit(0),2500).unref();};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
