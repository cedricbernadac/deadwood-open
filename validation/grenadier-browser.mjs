// Local-only QA fixture, 18 October 2026. Production online UI and real
// simulation ticks; no companion brain, API calls or existing server involved.
import { createOnlineServer } from '../online-server.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { characterStats } from '../public/character-bonuses.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';

export function seedGrenadierView(sim, mode = 'grenadier') {
  if (!['crate', 'all', 'grenadier'].includes(mode)) throw new Error('Unknown QA mode');
  const player = [...sim.players.values()].find(item => !item.companion);
  if (!player) return null;
  const previous = characterStats(player);
  sim.practice = false; sim.wave = 2; sim.phase = 'wave'; sim.timeLeft = 0;
  sim.toSpawn = 1; sim.spawnTimer = 9999;
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.beginSupplyWave();
  Object.assign(player, { x: sim.supplyCrate.x, y: 0, z: sim.supplyCrate.z + .8,
    yaw: 0, pitch: 0, hp: 100, alive: true, downed: false, waiting: false, grounded: true, points: 2500,
    reviveShieldUntil: sim.time + 1800, bleedOutAt: 0, grenades: 0, throwAfter: 0,
    dualWield: false, secondaryWeaponId: null, weaponStates: {}, reloadUntil: 0, shotAfter: 0,
    bonus: mode === 'all' ? Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, 8]))
      : mode === 'grenadier' ? { grenadier: 8 } : null });
  player.inventory = { pistol: { ammo: 12, reserve: 48 }, 'pistol#2': { weapon: 'pistol', ammo: 12, reserve: 48 } };
  player.weapon = 'pistol'; player.weaponId = 'pistol';
  sim.setPause(sim.hostId, false); sim.resetPlayerControls(true);
  sim.syncCharacterBonuses(player, previous);
  // Reseeding the same N8 bonus also starts a fresh full interval.
  sim.resetGrenadier(player);
  if (mode === 'all') {
    player.hp = characterStats(player).maxHp;
    sim.setDualWield(player.id, true, 'pistol#2');
    const enemy = sim.createZombie();
    Object.assign(enemy, { x: player.x, y: 0, z: player.z - 2.6, speed: 0, kind: 'walker', boss: false, scale: 1 });
    sim.zombies.set(enemy.id, enemy);
  }
  return { mode, player: player.id, wave: sim.wave, time: sim.time, grenades: player.grenades,
    grenadierLeft: sim.grenadierLeft(player), stats: characterStats(player), crate: sim.supplyCrate.id };
}

const buttons = `
const qaPanel=document.createElement('div');qaPanel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:9999;display:flex;flex-wrap:wrap;gap:6px;background:#15231f;padding:8px';
for(const [mode,label] of [['crate','QA · Caisse (14 choix)'],['all','QA · Tous les bonus N8'],['grenadier','QA · Grenadier N8'],['open','QA · Ouvrir la caisse'],['settings','QA · Réglages'],['back','QA · Jeu'],['damage','QA · Tirs réels']]){
 const button=document.createElement('button');button.textContent=label;
 button.onclick=()=>{if(mode==='settings'){document.body.classList.add('qa-settings');showPause();return;}if(mode==='back'){document.body.classList.remove('qa-settings');$('pause').hidden=true;return;}return mode==='open'?send({type:'interact'}):fetch('/qa/setup?mode='+mode,{method:'POST'});};
 qaPanel.append(button);
}document.body.append(qaPanel);
`;

export async function startGrenadierBrowser() {
  const app = createOnlineServer({ port: 0, host: '127.0.0.1' });
  const firing = new Set();
  const serve = app.server.listeners('request')[0];
  app.server.removeAllListeners('request');
  app.server.on('request', (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/style.css') {
      response.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' });
      response.end(readFileSync(new URL('../public/style.css', import.meta.url))); return;
    }
    if (url.pathname === '/qa/setup' && request.method === 'POST') {
      const mode = url.searchParams.get('mode');
      if (!['crate', 'all', 'grenadier', 'damage'].includes(mode)) {
        response.writeHead(400, { 'Content-Type': 'application/json' }); response.end('{"ok":false}'); return;
      }
      for (const timer of firing) clearInterval(timer); firing.clear();
      const seeded = [...app.rooms.values()].map(room => {
        const sim = room.simulation, result = seedGrenadierView(sim, mode === 'damage' ? 'crate' : mode);
        if (mode !== 'damage' || !result) return result;
        const player = sim.players.get(result.player);
        Object.assign(player, { x: -5, y: 0, z: 0, yaw: 0, pitch: 0 });
        const enemy = sim.createZombie();
        Object.assign(enemy, { x: -5, y: 0, z: -3.5, speed: 0, hp: 5000, maxHp: 5000, kind: 'walker', boss: false, scale: 1 });
        sim.zombies.set(enemy.id, enemy);
        let ticks = 0;
        const timer = setInterval(() => { sim.shoot(player.id); if (++ticks >= 40) { clearInterval(timer); firing.delete(timer); } }, 200);
        firing.add(timer);
        return { ...result, mode, realShots: true, enemy: enemy.id };
      }).filter(Boolean);
      for (const state of seeded) console.log(JSON.stringify(state));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: seeded.length > 0, seeded })); return;
    }
    if (url.pathname === '/qa/state' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify([...app.rooms.values()].map(room => ({ room: room.code, damageFeedbackEnabled: room.simulation.damageFeedbackEnabled, ...room.simulation.snapshot() })))); return;
    }
    if (url.pathname === '/online-client.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      response.end(readFileSync(new URL('../public/online-client.js', import.meta.url), 'utf8') + buttons); return;
    }
    if (url.pathname !== '/') return serve(request, response);
    // Same known Pointer Lock workaround as character-bonuses-browser.mjs.
    // This is a render/interaction probe, not a human keyboard/mouse game.
    const html = readFileSync(new URL('../public/online.html', import.meta.url), 'utf8')
      .replace('</head>', '<style>body.playing:not(.qa-settings) #pause{display:none!important}</style><script>setInterval(()=>{if(document.body.classList.contains("playing")&&!document.body.classList.contains("qa-settings"))document.getElementById("pause").hidden=true;},100);</script></head>');
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end(html);
  });
  const address = await app.listen();
  let closing = false;
  async function close() { if (closing) return; closing = true; for (const timer of firing) clearInterval(timer); firing.clear(); for (const client of app.wss.clients) client.terminate(); await app.close(); }
  return { app, address, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startGrenadierBrowser(), base = `http://127.0.0.1:${fixture.address.port}`;
  console.log(JSON.stringify({ url: `${base}/`, catalog: `${base}/bonus-catalog.html`, state: `${base}/qa/state`, pid: process.pid }));
  const close = async () => { await fixture.close(); process.exit(0); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
  setTimeout(close, 30 * 60 * 1000).unref();
}
