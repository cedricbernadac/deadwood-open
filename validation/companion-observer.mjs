// Local observation of an isolated simulation. The ordinary public client,
// meshes and effects are reused; its spectator adaptation exists in memory.
// The observer is never a simulation player and sends no gameplay commands.
import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { WORLD, WEAPONS, TICK_RATE } from '../simulation.mjs';
import { GRENADES } from '../public/rules.js';
import { BALLISTICS } from '../public/ballistics.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');
const require = createRequire(import.meta.url);
const threeRoot = dirname(require.resolve('three'));
const BUILD = 'isolated-companion-observer-v1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

const observerStyle = `
<style>
  .masthead,#menu,#lobby,#hud,#pause,#gameover,#admission-panel,#downed,#crosshair,#interaction,#outside-hurt,#wave-card{display:none!important}
  #observer-panel{position:fixed;inset:18px 18px auto auto;width:min(460px,calc(100vw - 36px));z-index:1000;color:#f3eadc;background:rgba(11,24,21,.94);border:1px solid #59725f;border-radius:12px;padding:16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px #0005}
  #observer-panel h1{font-size:18px;margin:0 0 3px;color:#edbd77}#observer-panel p{margin:4px 0}
  #observer-panel .observer-note{color:#b6c7bd;font-size:12px}#observer-panel button{font:inherit;cursor:pointer;padding:7px 10px;border:1px solid #728975;border-radius:6px;color:#f3eadc;background:#20382d;min-height:34px}
  #observer-panel button:disabled{opacity:.5;cursor:default}#observer-panel button[aria-pressed=true]{background:#806137;border-color:#edbd77}
  #observer-actions,#observer-cameras{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}#observer-bots{display:grid;gap:8px;margin-top:10px}
  #observer-bots article{background:#ffffff08;border-left:3px solid #9eba8a;padding:7px 10px}#observer-bots strong{color:#e7cda2}#observer-bots small{display:block;color:#bdcdbf}
  @media(max-width:700px){#observer-panel{inset:8px 8px auto auto;width:min(370px,calc(100vw - 16px));padding:10px;font-size:12px}#observer-panel h1{font-size:15px}}
</style>
<aside id="observer-panel" aria-label="Observation des compagnons">
  <h1>Max et Léa — observation</h1>
  <p class="observer-note">Lecture seule · Deux compagnons jouent réellement dans une partie d’essai séparée.</p>
  <p id="observer-phase">Connexion au refuge…</p><p id="observer-message" class="observer-note"></p>
  <div id="observer-actions"><button id="observer-start">Démarrer la nuit</button><button id="observer-sound">Activer le son</button></div>
  <div id="observer-cameras" aria-label="Choisir la caméra"></div><div id="observer-bots"></div>
</aside>`;

// This code is appended to the production ES module, so it can reuse the real
// renderer and handlers without exposing mutable game state on window.
const observerClient = String.raw`
let observerCamera = 'overview', observerCameraSnap = true, observerSoundOn = false, observerPrewarmed = false;
const observerOriginalRefresh = refreshState;
const observerOriginalSend = send;
send = function(message) { if (message?.type === 'observe-start') observerOriginalSend(message); };
const observerText = (node, value) => { node.textContent = String(value ?? ''); };
const observerOrder = order => !order ? 'En attente de décision' : typeof order === 'string' ? order :
  [({hold:'Tenir la position',shoot:'Tirer',defend:'Couvrir la porte',repair:'Réparer',revive:'Secourir',kit:'Utiliser un kit',
    'self-kit':'Se relever',wait:'Attendre',follow:'Suivre',collect:'Ramasser',coins:'Ramasser les pièces',buy:'Acheter',weapon:'Changer d’arme',
    reload:'Recharger',loft:'Tenir la mezzanine',grenade:'Lancer une grenade',claim:'Récupérer un bonus',supply:'Se ravitailler'})[order.kind] || order.kind,
    order.playerId ? snapshot.players.find(player=>player.id===order.playerId)?.name : order.doorId || order.rackId || order.weapon || order.bonus || order.service || ''].filter(Boolean).join(' · ');
function observerRefreshPanel() {
  const view = snapshot?.observerView; if (!view) return;
  const bots = snapshot.players.filter(player=>player.companion===true);
  const phases = {lobby:'Prêts à commencer',countdown:'La nuit commence',wave:'Combat',intermission:'Pause entre les vagues',gameover:'Partie terminée',victory:'Victoire',extraction:'Extraction'};
  observerText($('observer-phase'), (phases[snapshot.phase] || snapshot.phase)+' · Vague '+snapshot.wave+'/'+(snapshot.maxWaves || 20)
    +(snapshot.phase==='wave'?' · '+snapshot.remaining+' menaces restantes':''));
  observerText($('observer-message'), view.status?.message || view.status?.state || 'Les caméras n’influencent ni leurs décisions ni les ennemis.');
  $('observer-start').disabled = view.started || !['lobby','countdown'].includes(snapshot.phase);
  observerText($('observer-start'), view.started ? 'Nuit démarrée' : 'Démarrer la nuit');
  const cameraKeys = ['overview', ...bots.map(player=>player.id)].join('|');
  if ($('observer-cameras').dataset.keys !== cameraKeys) {
    $('observer-cameras').dataset.keys = cameraKeys;
    $('observer-cameras').replaceChildren(...[{id:'overview',name:'Vue cabane'},...bots].map(player=>{
      const button=document.createElement('button');button.dataset.camera=player.id;button.textContent=player.name;
      button.onclick=()=>{observerCamera=player.id;observerCameraSnap=true;observerRefreshPanel();};return button;
    }));
  }
  for(const button of $('observer-cameras').children)button.setAttribute('aria-pressed',String(button.dataset.camera===observerCamera));
  $('observer-bots').replaceChildren(...bots.map(player=>{
    const article=document.createElement('article'),name=document.createElement('strong'),stats=document.createElement('p'),order=document.createElement('small'),plan=document.createElement('small');
    observerText(name,player.name+(player.downed?' · À terre':!player.alive?' · Éliminé':''));
    observerText(stats,Math.ceil(player.hp)+' PV'+(player.armor?' + '+Math.ceil(player.armor)+' armure':'')+' · '+(names[player.weapon] || player.weapon || 'Sans arme')
      +' '+player.ammo+'/'+player.magazine+' +'+player.reserve+' · '+player.points+' pièces · '+player.kills+' élim.');
    observerText(order,'Action : '+observerOrder(view.orders?.[player.id]));
    const assignment=view.plan?.assignments?.find(item=>item.id===player.id);
    const role={support:'Soutien',close:'Proximité',marksman:'Précision',medic:'Secours'};
    const post={team:'Équipe',loft:'Mezzanine',north:'Porte nord',south:'Porte sud',east:'Porte est',west:'Porte ouest'};
    const bonus={stone:'Armes renforcées',perforating:'Perforantes',extended:'Chargeurs étendus',reinforced:'Munitions renforcées',radar:'Radar'};
    observerText(plan,assignment?'Plan : '+(role[assignment.role]||assignment.role)+' · '+(post[assignment.post]||assignment.post)
      +(assignment.goalWeapon!=='none'?' · objectif '+(names[assignment.goalWeapon]||assignment.goalWeapon):'')
      +(assignment.bonus!=='none'?' · '+(bonus[assignment.bonus]||assignment.bonus):''):'Plan d’équipe en préparation…');
    article.append(name,stats,order,plan);return article;
  }));
}
refreshState = function(oldSelf) {
  observerOriginalRefresh(oldSelf);
  if (!snapshot?.observerView) return;
  inGame=true;document.body.classList.add('playing');
  for(const id of ['menu','lobby','pause','hud','gameover','admission-panel','downed','crosshair'])$(id).hidden=true;
  flashlight.visible=true;if(gun)gun.visible=false;
  if(!observerPrewarmed&&ambianceReady){observerPrewarmed=true;world.prewarm?.(renderer,camera);}
  sound.setVolume(observerSoundOn?volume:0);sound.updateScene(snapshot,!snapshot.paused);
  observerRefreshPanel();
};
function observerFrame(delta) {
  const bots=snapshot.players.filter(player=>player.companion===true),follow=bots.find(player=>player.id===observerCamera);
  for(const [id,mesh] of playerMeshes)mesh.visible=id!==follow?.id;
  if(follow){
    const target=new THREE.Vector3(follow.x,follow.y+((follow.downed||!follow.alive)? .5 : (follow.eyeHeight??1.55)),follow.z);
    if(observerCameraSnap)camera.position.copy(target);else camera.position.lerp(target,1-Math.exp(-delta*22));
    camera.rotation.set(follow.pitch||0,follow.yaw||0,0,'YXZ');
  }else{
    camera.position.set(-4.5,5.4,4.8);camera.lookAt(0,1.3,0);
  }
  observerCameraSnap=false;if(gun)gun.visible=false;
  const proxy=myPlayer();if(proxy){proxy.x=camera.position.x;proxy.y=camera.position.y;proxy.z=camera.position.z;}
}
$('observer-start').onclick=()=>{ $('observer-start').disabled=true; send({type:'observe-start'}); };
$('observer-sound').onclick=()=>{observerSoundOn=!observerSoundOn;sound.unlock();sound.setVolume(observerSoundOn?volume:0);sound.updateScene(snapshot,observerSoundOn&&!snapshot?.paused);observerText($('observer-sound'),observerSoundOn?'Couper le son':'Activer le son');};
sound.setVolume(0);joinMode=false;connect();
`;

function adaptedClient() {
  const source = readFileSync(resolve(publicRoot, 'client.js'), 'utf8');
  const cameraAnchor = /  if \(cinematic\) \{\r?\n    camera\.position\.copy\(extraction\.cameraPosition\);/g;
  if ([...source.matchAll(cameraAnchor)].length !== 1) throw new Error('The observer camera anchor no longer matches the production client.');
  return source.replace(cameraAnchor, "  if (snapshot?.observerView) {\n    observerFrame(delta);\n  } else if (cinematic) {\n    camera.position.copy(extraction.cameraPosition);") + '\n' + observerClient;
}

export async function startCompanionObserver({ simulation, getStatus = () => ({}), port = 0 } = {}) {
  if (!simulation?.snapshot || !simulation?.players) throw new TypeError('A real isolated simulation is required.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid observer port.');
  const client = adaptedClient();
  const html = readFileSync(resolve(publicRoot, 'index.html'), 'utf8')
    .replace('<title>Deadwood — Last Light</title>', '<title>Observer Max et Léa — Deadwood</title>')
    .replace('</body>', observerStyle + '\n</body>');
  let closed = false, started = false, startResolve;
  const startPromise = new Promise(resolveStart => { startResolve = resolveStart; });
  const viewers = new Map();
  const json = (response, data) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  const text = (response, body, contentType, head = false) => {
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(head ? undefined : body);
  };
  const file = (response, path, head = false) => {
    let stat;try { stat = statSync(path); } catch {}
    if (!stat?.isFile()) { response.writeHead(404); response.end('Introuvable.'); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': stat.size,
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (head) { response.end(); return; }
    const stream=createReadStream(path);stream.on('error',()=>response.destroy());stream.pipe(response);
  };
  let url;
  const server = http.createServer((request, response) => {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405);response.end();return; }
    let pathname;try { pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname); } catch { response.writeHead(400);response.end();return; }
    const head=request.method==='HEAD';
    if (pathname==='/health') return json(response,{ok:true,readOnly:true,viewers:viewers.size,players:simulation.players.size});
    if (pathname==='/world.json') return json(response,{world:WORLD,weapons:WEAPONS,grenades:GRENADES,ballistics:BALLISTICS,tickRate:TICK_RATE});
    if (pathname==='/version.json') return json(response,{build:BUILD});
    if (pathname==='/network.json') return json(response,{urls:[url]});
    if (pathname==='/'||pathname==='/index.html') return text(response,html,mime['.html'],head);
    if (pathname==='/client.js') return text(response,client,mime['.js'],head);
    if (pathname==='/vendor/three.module.js') return file(response,resolve(threeRoot,'three.module.js'),head);
    if (pathname==='/vendor/three.core.js') return file(response,resolve(threeRoot,'three.core.js'),head);
    const path=resolve(publicRoot,'.'+pathname);
    if (!path.startsWith(publicRoot+sep)||pathname.includes('\0')||pathname.includes('\\')) { response.writeHead(403);response.end();return; }
    return file(response,path,head);
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  const send=(socket,message)=>{if(socket.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify(message));}catch{}}};
  function stateFor(id) {
    const state=simulation.snapshot();
    let status={};try { status=JSON.parse(JSON.stringify(getStatus()??{})); } catch {}
    state.observerView={readOnly:true,started,status,plan:simulation.companionTeamPlan??null,
      orders:Object.fromEntries(simulation.companionOrders??[])};
    state.players=[...state.players,{id,name:'Spectateur',x:-4.5,y:5.4,z:4.8,yaw:0,pitch:0,hp:100,armor:0,
      waiting:true,ready:false,alive:true,downed:false,weapon:null,weaponId:null,weapons:[],ownedWeapons:[],bonus:null,
      ammo:0,reserve:0,magazine:0,reserveCapacity:0,score:0,kills:0,points:0,grounded:false,reviveKit:false,
      grenades:0,weaponSlots:0,outside:false,umbrella:{open:false,remaining:100,max:100}}];
    return state;
  }
  function publishState(){if(closed)return;for(const [socket,id]of viewers)send(socket,stateFor(id));}
  server.on('upgrade',(request,socket,head)=>{
    let pathname;try{pathname=new URL(request.url,'http://localhost').pathname;}catch{}
    if(pathname!=='/ws'||(request.headers.origin&&request.headers.origin!==url.slice(0,-1))){socket.destroy();return;}
    sockets.handleUpgrade(request,socket,head,ws=>sockets.emit('connection',ws));
  });
  sockets.on('connection',socket=>{
    let joined=false;socket.on('error',()=>{});
    socket.on('message',raw=>{
      let message;try{message=JSON.parse(String(raw));}catch{return;}
      if(!message||typeof message!=='object'||Array.isArray(message))return;
      if(message.type==='join'&&!joined){
        joined=true;const id='observer-'+randomBytes(6).toString('hex');viewers.set(socket,id);
        send(socket,{type:'welcome',id,room:simulation.code,hostId:simulation.hostId,practice:simulation.practice,ambiance:simulation.ambiance,build:BUILD});
        send(socket,stateFor(id));return;
      }
      if(!joined)return;
      if(message.type==='observe-start'&&!started){started=true;startResolve(true);publishState();}
      else if(message.type==='ping')send(socket,{type:'pong'});
      // input, shoot, buy, pause, ready, restart and other gameplay messages
      // are intentionally ignored. They never reach the authoritative room.
    });
    socket.on('close',()=>viewers.delete(socket));
  });
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolveListen();});});
  url=`http://127.0.0.1:${server.address().port}/`;
  return {url,publish(event){if(closed)return;for(const socket of viewers.keys())send(socket,event);},publishState,
    waitForStart(){return startPromise;},async close(){
      if(closed)return;closed=true;if(!started)startResolve(false);
      for(const socket of sockets.clients)socket.terminate();viewers.clear();
      await new Promise(resolveClose=>sockets.close(resolveClose));
      await new Promise(resolveClose=>server.close(resolveClose));
    }};
}
