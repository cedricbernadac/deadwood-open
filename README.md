# DEADWOOD — Last Light

A cooperative 3D zombie-survival FPS that runs in the browser (Three.js). One to four survivors hold a shelter for twenty waves, then reach the extraction. Each player uses their own computer; one of them hosts the game with Node.js.

Play the hosted version on **[playdeadwood.com](https://playdeadwood.com)**, or run it at home on your local network with the steps below. The game page on LOB7 is [Deadwood — Last Light](https://lob7.com/games/bg_s_07513039-c17e-4900-afac-bb2509cac6c4).

*En français :* un FPS coopératif de survie en 3D, jouable à 1–4 dans le navigateur. Un ordinateur héberge la partie (Node.js 22+), les autres la rejoignent sur le même Wi-Fi. Le jeu est traduit en français et en anglais (sélecteur à l'accueil).

## Run it at home

You need **Node.js 22 or newer** on the host computer. Other players only need a recent browser with WebGL, and a keyboard and mouse or an Xbox controller.

```sh
npm install
npm start
```

Open `http://localhost:3000` on the host. Other computers on the same network open the address the server prints, for example `http://192.168.1.50:3000`. The host creates a shelter and shares its six-character code; teammates type the code to join.

- **Another port:** set `PORT`, for example `PORT=3002 npm start` (PowerShell: `$env:PORT = '3002'; npm start`).
- **All four maps in one menu:** `npm run start:lan` starts a gateway that serves the cabin, the supermarket, the hospital and the funfair.
- **One map:** `npm run start:supermarket`, `npm run start:hospital` or `npm run start:funfair`.
- **Windows:** double-click `play.cmd` (or `play-supermarket.cmd`, `play-hospital.cmd`, `play-funfair.cmd`). These launchers are written in French.
- **Internet mode:** `npm run start:online` builds the online client and starts the gateway used by playdeadwood.com.

If Windows asks about Node.js and the firewall, allow **private networks**.

## Controls

| Action | Keyboard and mouse | Xbox controller |
| --- | --- | --- |
| Move / look | WASD, ZQSD or arrows / mouse | Left stick / right stick |
| Shoot, light melee hit | Left click | RT |
| Heavy melee hit, sniper scope | Right click | LT |
| Run / crouch / jump | Shift / C / Space | L3 / R3 / A |
| Reload | R | X |
| Switch weapon | 1–4 or wheel | Y, D-pad left/right |
| Buy, pick up, repair; hold to revive | E | RB |
| Revive kit | F | D-pad up |
| Drop the held weapon / drop 100 coins | V / T | D-pad down / D-pad up |
| Dual wield (when unlocked) | X | Hold Y |
| Grenade / umbrella | G / B | LB / B |
| Ready for the next wave | N | View |
| Pause for the whole team (host) | P | Start menu |
| Survivor sheet | Tab | Start menu |
| Menu, free the mouse | Esc | Start |

Click in the view to capture the mouse and enable sound.

## What is in the game

- **Four maps:** the cabin in the woods (default), *Le Dernier Panier* (a supermarket with a cellar and a terrace), the pine hospital and the funfair. The online version serves the cabin and the supermarket.
- **Twenty waves:** walkers, crawlers, runners, armoured walkers, colossi, raiders at waves 5, 10 and 15, and a boss at wave 20. Acid rain outside, a generator, fuel caches, a supply crate with one bonus per survivor and per wave.
- **Weapons:** pistol, shotgun, SMG, assault rifle, machine gun, minigun, magnum, bolt-action rifle, flamethrower, rocket launcher, grenades and melee weapons (bat, hammer, fire axe, katana).
- **Two moods:** *Famille* (default, kid-friendly) and *Frisson*, a darker night with optional pixel blood, chosen when the shelter is created. A browser can be locked to *Famille*.
- **Save and resume** a night from the pause menu.
- **Optional AI companions** on the local server: run `npm run companions` on the host with your own `OPENAI_API_KEY` in the environment. The key stays on that computer; spending is capped per session and per day. The online server never loads them.

## Project layout

| Path | Contents |
| --- | --- |
| `server.mjs`, `simulation.mjs`, `raiders.mjs`, `supply.mjs` | Authoritative local server and game rules |
| `lan-gateway.mjs`, `start-*.mjs` | Multi-map gateway and single-map launchers |
| `online-*.mjs` | Internet mode (gateway, workers, client build) |
| `public/` | Browser client: rendering, HUD, audio, maps (`levels/*.glb`), *Frisson* models (`frisson/`) |
| `companions/`, `companion-brain/` | AI teammates: body (local rules) and brain (OpenAI) |
| `tools/`, `scripts/` | Asset build and check tools (GLB merges, HUD silhouettes, bonus icons) |
| `test/` | Node test suite: `npm test` |

## Contributing

Fork this repository, change what you like, and share your version. You can list your variant on [LOB7](https://lob7.com) as an independent edition that credits this one. Please keep the licence notices and the credits.

Run `npm test` before sharing a change. Some tests check exact asset files; if you replace a model or a sound, update the matching test. About fifty tests are skipped in this edition because they check the Blender sources and the original audio takes, which are not included. On Windows, one launcher test (`Windows supermarket launcher keeps the existing installer`) is known to fail.

**Missing sounds.** A few sound effects from the author's private build are not included because their licences do not allow redistribution: footsteps, reloads, zombie groans, board breaks, the magnum, the minigun, the rocket explosion, the assault-rifle shot, the sniper and the melee weapons. The game falls back to generated sounds for them. Recordings you are free to share are welcome.

## Licences and credits

- **Code:** [MIT](LICENSE).
- **Media** (maps, models, icons, music and sounds in `public/` and `assets/`): [CC BY 4.0](ASSETS.md), with their sources listed in [ASSETS.md](ASSETS.md).
- **Three.js** and **ws** are installed by npm under their own MIT licences.

Created by Cédric Bernadac, developed with AI assistants (Claude, Codex, Kimi).
