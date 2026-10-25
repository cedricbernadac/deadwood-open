# AI companions — design and contracts

Owner's request (13 October 2026): when playing alone, or when a child plays without a parent, the host picks in the lobby how many AI companions join the team (0–3; at most 4 survivors in all). Companions are teammates driven by a language model (OpenAI Decisions API, `gpt-6-luna`) that "decides what to do now" from a text summary of the game. Constraints:

- **Local and optional.** It only works on the Wi-Fi (LAN) server (`server.mjs`), on the PC that hosts the game, with the owner's key. The online server (`online-server.mjs`, Render) never loads any of it. No key ever reaches a browser, a file in the repo, a log or a snapshot.
- **No scripted brain.** Every choice comes from the model. If the brain is not there or the API fails, companions do not fall back to scripted decisions: they keep their last order until it ends, then wait (and may get eaten). If the brain service disconnects, companions leave the game.
- **Pluggable brains.** The game never contains OpenAI code. A brain is a separate program that connects to the LAN server on a localhost-only WebSocket and answers "here is the situation and the legal actions — which one?". The first brain is OpenAI Decisions; an MCP adapter or other models can implement the same protocol later.
- **Kid-friendly.** Companions protect the humans first, never take the family's loot (coins aside: see "Coins"), never take unique items, never become host, and talk only through fixed FR/EN callout strings (no model-written text reaches the children).

## Companion archetypes (17 October 2026)

The host picks a profile per named seat in the lobby or results: Sharpshooter,
Rusher, Protector, Timid or Veteran, or Random. Repeated archetypes are allowed.
The five profiles intentionally need not have equal strength: a Veteran is a
strong all-round teammate, while a team of Timid companions is a challenge.
Only a connected LAN brain enables editing. Online and practice have no bots.

`public/companion-profiles.js` holds translated labels, descriptions and
qualitative ratings. `companions/profiles.mjs` owns server-side handling:
angular tremor, reaction, extra semiautomatic pause, pressure sensitivity and
courage/teamwork/aggression. Individual accuracy/reaction/pause factors vary
by at most ±8%, sampled once and frozen throughout a night. Random draws each
archetype independently with equal probability; duplicates are valid. The
first night uses the lobby preview, later nights draw fresh variations and
fresh Random identities. Waves, decisions, snapshots and reconnect messages
do not reroll a living companion. Re-adding a removed companion makes a new
individual, retaining the seat's chosen archetype setting.

The legacy `AIM` stays unchanged for bodies without a profile. There is no
global precision boost: each body uses its own immutable configuration.
Weapons retain their legal cadence, damage, reload and movement rules.
`body.setProfile(profile)` resets local order/navigation/aim at the permitted
boundary without replacing the body instance. Plan/decision tickets are
invalidated on roster or selection changes and new nights.

The network command remains `{type:'companions', count}` for old clients. An
optional `profiles` field is an exact three-item array of known selection IDs,
validated atomically before mutation; clients never submit physical traits.
Room snapshots contain `companionSelections`, and each bot has a stable
`companionSlot` plus only `{selection, archetype}` under `companionProfile`.
Private handling data reaches the model through a compact description in
TEAM and YOUR PROFILE, including its actual rolled skills. Courage and
cooperation are soft preferences, never a filtered action menu: rescue,
ammunition, retreat and urgent threats remain available to every archetype.
An exhausted held gun (magazine and reserve both zero) cannot offer a shoot
order or keep a shooting order. A reserve that can reload still permits it;
melee, grenade, rescue, switch, collection and cover options remain. Every
answer, including keep, is checked against the current legal menu on arrival.

UI profile rows use `data-companion-slot`, distinct from weapon `data-slot`.
Native selects persist through 10 Hz snapshots and retain focus. The effective
random identity appears in the AI badge; all profile text uses plain DOM text.

### Catalogue des bonus de personnage — niveaux 1 à 8

**Grille intégrée le 17 octobre 2026 après validation du propriétaire.** Elle
remplace le brouillon limité à trois cumuls. Les définitions partagées du
runtime sont dans `public/character-bonuses.js` ; les valeurs chiffrées sont
aussi conservées dans `validation/character-bonus-catalog-2026-10-17.json`.
Il s'agit de niveaux de bonus, sans XP ni niveau général du personnage.
Le catalogue comprend **14 bonus : 10 de personnage, Grenadier inclus, et
4 d'armes**. Grenadier complète la grille initiale le 18 octobre.

Premier canal des essais : **la caisse de ravitaillement**, à côté
des bonus d'armes actuels. Une prise ajoute un nouveau bonus au niveau 1 ou
augmente de 1 celui qu'on possède. Décision finale du propriétaire :
**un choix indépendant par survivant à chaque vague de 2 à 18**, soit
**17 prises**. La caisse reste en permanence au même endroit dehors,
inactive aux vagues 1, 19 et 20. Le plafond reste 8 par bonus :
une spécialisation complète prend huit caisses, les autres prises permettant
de compléter le personnage. Cette cadence remplace les huit anciennes prises
des vagues paires et devra être évaluée dans de vraies parties.
Humains et bots ont les mêmes effets ; les personnalités/compétences de visée
des bots restent distinctes.

Tous les chiffres ci-dessous sont **les effets cumulés au niveau indiqué**,
calculés une fois sur la valeur de base. On ne multiplie pas les pourcentages
à chaque acquisition. Les valeurs sont un premier réglage à tester.

#### Capacités et résistance

| Bonus et effet | N1 | N2 | N3 | N4 | N5 | N6 | N7 | N8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Vitamines** : vitesse horizontale | +3 % | +6 % | +9 % | +12 % | +15 % | +18 % | +21 % | +24 % |
| **Huile de coude** : durée de recharge | −10 % | −15 % | −20 % | −25 % | −30 % | −35 % | −40 % | −50 % |
| **Mains vives** : délai avant tir après changement d'arme | 200 ms | 160 ms | 125 ms | 95 ms | 70 ms | 45 ms | 20 ms | 20 ms + double maniement |
| **Vitalité** : PV maximum | 110 | 120 | 130 | 140 | 150 | 160 | 170 | 180 |
| **Imperméable** : dégâts de pluie | −10 % | −20 % | −30 % | −40 % | −50 % | −60 % | −70 % | −80 % |
| **Peau dure** : dégâts de combat | −3 % | −6 % | −9 % | −12 % | −15 % | −18 % | −21 % | −24 % |
| **Secouriste** : temps de réanimation manuelle | 4,5 s | 4,2 s | 3,9 s | 3,6 s | 3,3 s | 3 s | 2,5 s | 2 s |
| **Grenadier** : intervalle par grenade | 20 s | 20 s | 17 s | 17 s | 14 s | 14 s | 12 s | 10 s |
| **Grenadier** : capacité maximale | 2 | 2 | 3 | 3 | 3 | 4 | 4 | 5 |
| **Grenadier** : dégâts de grenade | +0 % | +10 % | +10 % | +20 % | +20 % | +30 % | +40 % | +50 % |

Secouriste est une idée complémentaire pour un personnage de soutien. Les six
autres passifs reprennent les demandes du propriétaire. Pour ces capacités,
un petit gain à chaque prise évite des premiers niveaux sans effet.

- **Vitamines** : marche et course, sans changer saut, gravité ou dimensions.
  À N8, marche de base 3,5 → 4,34 m/s et sprint 5,4 → 6,70 m/s. Les facteurs
  de l'arme tenue et du sac continuent de s'appliquer.
- **Huile de coude** : à N8, durée divisée par deux : SMG 1,5 → 0,75 s,
  minigun 3,4 → 1,7 s. Ni cadence, ni dégâts,
  ni chargeur, ni réserve supplémentaires ; la durée affichée doit être réelle.
- **Mains vives** : le délai actuel est 250 ms. On réduit uniquement ce verrou,
  jamais la récupération du tir précédent : `max(previous shotAfter, new lock)`.
  Changer continue d'annuler une recharge. Les sept premiers niveaux ramènent
  le verrou à 20 ms ; N8 ajoute le double maniement décrit ci-dessous,
  plutôt qu'un dernier petit gain de quelques millisecondes.
- **Vitalité** : chaque niveau pris debout ajoute 10 PV actuels et maximum,
  conservant les dégâts déjà subis. Soins et remplissage entre vagues respectent
  le nouveau maximum. Les réanimations restent à 55 PV à la main / 75 au kit ;
  aucune réanimation gratuite à l'acquisition. Un ramassage de plusieurs niveaux
  suit la différence de maximum, pas un soin répété indépendant.
- **Imperméable** : pluie normale de base 3 PV/s → 0,6 PV/s à N8. Pas d'immunité,
  pas de durée de parapluie supplémentaire ; le parapluie conserve sa protection
  habituelle et empêche toujours de tirer quand il est ouvert.
- **Peau dure** : petite résistance passive aux zombies et pillards, distincte
  du gilet qui s'épuise. Réduction après difficulté, avant absorption du gilet.
  Elle ne protège ni de la pluie ni des chutes et ne crée pas une nouvelle jauge.
- **Secouriste** : réanimation manuelle de base 5 s, jusqu'à 2 s au N8 ;
  pas de PV rendus en plus,
  pas d'accélération de la relève automatique au kit ni des réparations.

#### Grenadier — régénération et capacité

Une grenade gagnée par intervalle de **temps de simulation actif**, durant
le compte à rebours, les vagues et les intervalles entre vagues. La capacité
de base de deux passe à **trois à N3, quatre à N6 et cinq à N8**. Acquisition,
montée de niveau et récupération d'un bonus déposé commencent un intervalle
complet ; elles n'ajoutent jamais une grenade immédiate ni ne remplissent
les nouveaux emplacements. Le premier gain attend le même intervalle que
les suivants.

Le stock plein efface la progression et ne crée aucune banque cachée :
dépenser une grenade recommence l'intervalle entier. Mise à terre, mort,
attente de place ou autre état inactif effacent également la progression ;
le retour à un état actif recommence l'intervalle. **La pause collective
fige le temps restant**, sans le remettre à zéro. Aucun gain au stand d'essai
ni hors des phases actives. La perte du bonus supprime sa progression et
plafonne le stock à deux ; la nouvelle nuit remet stock et bonus à zéro.
Les grenades laissées par les zombies gardent leur quota d'équipe indépendant.

La puissance supplémentaire concerne **les grenades seulement**, sans
augmentation de rayon ni effet sur les roquettes. Le multiplicateur est
capturé au lancer : perdre ou améliorer le bonus ensuite ne change pas
une grenade déjà en vol. Pas de cumul avec Munitions renforcées. À N8,
le cœur de l'explosion passe de 450 à **675 dégâts**, avant résistances et
protections, avec les mêmes rayons de 2 m et 4 m et la même décroissance lisse.

`characterStats(player)` expose `grenadeIntervalSeconds`, `maxGrenades` et
`grenadeDamageMultiplier`.
Le snapshot fournit la capacité et `grenadierLeft`, nul si le gain est inactif
ou le stock plein. Le HUD montre stock/capacité, autant de silhouettes que
d'emplacements et le temps restant applicable. Les résumés tactiques utilisent
le getter autoritaire `sim.grenadierLeft(player)`, sans lire son horloge privée.
Le plan reçoit stock, capacité, cadence, puissance et la grille partagée ; Grenadier
reste un objectif facultatif, absent des objectifs futurs à N8. Les grenades
sont proposées sur les groupes même avec une arme chargée ; les urgences et
les choix de tir, repli ou secours restent libres.

#### Mains vives N8 — double maniement

Récompense finale : **une arme dans chaque main, deux commandes de tir**.
Un mode facultatif sélectionné dans l'inventaire associe deux instances
d'armes à distance déjà portées, y compris deux exemplaires du même type.
Il n'ajoute ni emplacement d'inventaire, ni arme, ni munitions. Les armes de
mêlée et les grenades restent hors de cette première définition ; les armes
à distance conservent leurs caractéristiques propres.

- **Souris** : clic gauche pour la première arme, clic droit pour la seconde ;
  les deux boutons peuvent tirer simultanément. **Manette** : RT et LT
  respectivement, avec la même possibilité de tirer des deux mains.
- Chaque arme garde son chargeur, sa réserve, sa cadence, sa dispersion,
  ses projectiles et ses états particuliers : mise en rotation du minigun,
  flux du lance-flammes, etc. Une arme vide n'empêche pas l'autre de tirer.
  Les stocks restent attachés à l'identifiant réel de l'instance. Les bonus
  d'armes du porteur s'appliquent selon leurs compatibilités habituelles.
- La commande de recharge lance les deux recharges en parallèle, chacune
  avec sa durée et ses munitions propres. Une main peut reprendre le tir
  quand sa recharge est terminée, même si l'autre recharge encore.
- Le tir est à la hanche dans ce mode : le clic droit sert à la seconde arme.
  Revenir au maniement classique restaure la lunette du sniper et les
  commandes habituelles. Le changement de mode respecte les verrous de tir
  existants ; il ne permet jamais d'annuler la récupération d'un coup.
- Le facteur de déplacement le plus contraignant des deux armes s'applique.
  Les blocages habituels pendant une réanimation, une interaction, l'ouverture
  du parapluie ou une incapacité restent communs aux deux mains. Si la paire
  devient invalide (arme lâchée, bonus perdu), retour au maniement classique.

Humains et bots disposent du même mode et des mêmes règles. Les horloges
de tir/recharge et les stocks sont propres à chaque instance tenue ; les
blocages de réanimation, pause et parapluie restent communs. Le protocole
transmet `hand: 'primary' | 'secondary'` et les snapshots décrivent les deux
mains. Le corps d'un bot choisit explicitement la paire puis peut tirer des
deux mains ; les urgences restent disponibles. Le clavier utilise X, la
manette Y maintenu, et le menu permet de choisir la seconde instance.

#### Lunettes de reconnaissance — évolution du Radar

Réutiliser le bonus **`radar`**, sa portée personnelle de **25 m**, sa carte et
son acquisition en caisse. La carte et les indications dans la vue représentent
le même équipement ; pas de deuxième bonus de vision concurrent. Les
informations se cumulent au fil des niveaux.

| Niveau | Information disponible derrière les murs | Rafraîchissement |
| --- | --- | ---: |
| 1 | Présence locale approximative : isolés / groupe / horde, sans positions individuelles | 8 s |
| 2 | Estimation répartie par secteurs autour du joueur | 7 s |
| 3 | Triangles jaunes sur les positions détectées, sans type ni PV | 6 s |
| 4 | Même localisation, actualisée plus souvent | 5 s |
| 5 | Types : marcheur, coureur, rampant, cuirassé, colosse, pillard | 4 s |
| 6 | Types et indication de l'étage | 3 s |
| 7 | Santé approximative : barre à quatre segments | 2 s |
| 8 | PV actuels/max exacts et suivi quasi continu | 0,2 s |

Les paliers importants sont **3 → localisation**, **5 → identification**,
**7 → santé approximative**, **8 → santé précise**. Les niveaux intermédiaires
améliorent la fraîcheur de l'information. Montrer les détails du zombie visé
et de quelques menaces proches, plutôt que remplir l'écran de nombres.

Sans lunettes : pas de position individuelle révélée derrière un mur. Les
triangles jaunes gratuits des trois derniers ennemis sont retirés ; la
localisation individuelle est débloquée au niveau 3. Le compteur global
reste l'objectif de progression de la vague ; l'estimation des lunettes porte
sur la présence locale à 25 m, pas sur un deuxième total global. Modèles,
couleurs et blessures normalement visibles restent reconnaissables sans bonus.
Les bots doivent recevoir le même degré d'information sur les ennemis hors
de vue : masquer uniquement le HUD tout en livrant positions et PV exacts au
prompt leur donnerait des lunettes gratuites.

#### Aura de froid — ralentissement permanent expérimental

À la demande du propriétaire, l'impulsion temporaire est remplacée par une
**aura passive continue**, centrée sur le porteur vivant et debout. Pas de
bouton, de durée d'utilisation, de récupération ni de consommation. Un zombie
est ralenti tant qu'il est dans la zone valide ; il retrouve sa vitesse
habituelle en sortant. L'aura s'arrête si le porteur tombe ou est éliminé.

| Effet cumulé | N1 | N2 | N3 | N4 | N5 | N6 | N7 | N8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ralentissement de déplacement | 15 % | 15 % | 18 % | 18 % | 21 % | 21 % | 25 % | 25 % |
| Rayon autour du porteur | 2 m | 2,5 m | 2,5 m | 3 m | 3 m | 3,5 m | 3,5 m | 4 m |

N1 active l'aura. Ensuite, **chaque niveau améliore exactement un paramètre** :
rayon aux niveaux **2 / 4 / 6 / 8**, puissance aux **3 / 5 / 7**. Aucun niveau
d'attente. Ralentissement des déplacements seulement, jamais de la cadence des
morsures, des projectiles ou des pillards. Effet réduit de moitié sur les boss.
Les obstacles et l'étage sont respectés ; plusieurs porteurs appliquent le
ralentissement le plus fort, sans addition ni multiplication. Statut
expérimental : avec Vitamines, l'aura donne un avantage de déplacement
significatif ; vérifier son équilibre en partie avec la cadence proposée
d'une caisse par vague. Elle ne rend pas une réanimation sûre face à un
zombie déjà au contact, puisque les morsures ne sont pas ralenties.

#### Bonus d'armes actuels — référence conservée

| Effet | N1 | N2 | N3 | N4 | N5 | N6 | N7 | N8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Armes renforcées : dégâts de mêlée | +10 % | +20 % | +30 % | +40 % | +50 % | +60 % | +70 % | +80 % |
| Armes renforcées : cibles supplémentaires | 0 | 0 | 0 | +1 | +1 | +1 | +1 | +2 |
| Balles perforantes : cibles supplémentaires | 0 | 0 | +1 | +1 | +1 | +2 | +2 | +3 |
| Chargeur étendu : chargeur et réserve | +10 % | +20 % | +30 % | +40 % | +50 % | +60 % | +70 % | +80 % |
| Munitions renforcées : dégâts | 0 % | +15 % | +15 % | +30 % | +30 % | +45 % | +45 % | +60 % |

Compatibilités et arrondis actuels conservés : perforation plafonnée à six
cibles, hors sniper/flammes/explosifs/Magnum ; munitions renforcées hors
mêlée/flammes/explosifs/Magnum ; chargeur étendu sur les armes à chargeur d'au
moins deux unités, Magnum et lance-flammes compris. Le Radar reste un seul
bonus parmi ces choix et suit maintenant l'évolution décrite ci-dessus.

#### Règles communes et suite du chantier

Bonus conservés à terre et après réanimation, déposés à l'élimination selon
les règles existantes, remis à zéro à la nouvelle nuit. Un même calcul des
effets doit servir au serveur, à la prédiction client, au HUD et aux résumés
des bots. Chaque carte de caisse montre l'effet actuel, l'effet du prochain
niveau et le prochain palier utile. Tout bonus personnage peut être choisi
indépendamment des armes portées ; aucune dépense ou prise imposée aux bots.

Menu de caisse, HUD et catalogue utilisent **14 icônes générées avec imagegen**,
silhouettes stylisées dans le style des silhouettes d'armes du HUD, en WebP
**128 × 128 avec transparence**, avec PNG originaux conservés dans
`assets/bonus-icons/source`. La caisse 3D garde son couvercle ouvert et sa balise,
sans modèles de bonus alignés au-dessus. `createBonusModel` reste utilisé pour
les bonus déposés au sol, Grenadier compris ; ces objets restent récupérables.

La caisse est le canal d'acquisition initiale ; récupérer un bonus déposé
par un survivant éliminé reste possible. Achats au mur, butin aléatoire et
**construction avant la partie avec un budget de points** sont
différés. De futurs profils prédéfinis pourront assembler ces mêmes bonus,
sans créer une deuxième mécanique de progression. Le catalogue, ses échelles,
le nouveau Radar, Grenadier et la caisse permanente sont intégrés. La validation et
l'activation du serveur Wi-Fi sont consignées dans `REPRISE.md`.

## Layers

```
browser (unchanged protocol + a lobby picker)  ⇄  server.mjs (LAN)
                                                   ├─ RoomSimulation (companion players are ordinary players with player.companion = true)
                                                   ├─ companions/director.mjs  — per room: add/remove companions, 30 Hz bodies, decision scheduling
                                                   │    ├─ companions/body.mjs       — the "body": navigation, human-like aim, order executors
                                                   │    ├─ companions/situation.mjs  — the "eyes": situation text + legal actions → orders
                                                   │    ├─ companions/outdoors.mjs   — trips outside: the doorway, the walk, the rain (shared)
                                                   │    ├─ companions/routes.mjs     — supermarket routes: the partition opening, the rain-priced flight choice (shared)
                                                   │    ├─ companions/arsenal.mjs    — the weapons it carries: what each is worth when one must go (shared)
                                                   │    └─ companions/coins.mjs      — the coins near a companion: when it may sweep them (shared)
                                                   └─ companions/hub.mjs — the localhost WebSocket /companions where one brain connects
companion-brain/ (separate process, holds the key)  ⇄  ws://127.0.0.1:PORT/companions
```

## Simulation hooks (already in simulation.mjs)

- `sim.addPlayer(id, name, undefined, { companion: true })` creates a companion: `player.companion = true`, `ready = true`, `collectTargetId = null`. Never becomes host (host succession prefers humans).
- `nextWaveVoters()` excludes companions (humans alone call the next wave early).
- A companion's zombie kill pays its `killCash` straight into `player.points` (a guaranteed income); no coin pile drops. (Raider kills still drop their loot.)
- Companions collect coins like humans (owner, 13 October): the magnet (`attractCoins`) pulls a pile to the nearest survivor who could take it, companions included, never a gift back to its dropper, who cannot take it again for 3 s. Any other pickup only when `player.collectTargetId === pickup.id` (`collectPickups`).
- `sim.repairDoor(id, doorId)`: one repair action on a named door (25 HP, 0.55 s cooldown, refused when the passage is occupied, from < 2.25 m). Use it instead of `interact()`, which would buy at a rack first.
- Snapshot: each companion player carries `companion: true`; the room carries `companionsAvailable` (true when a brain is connected; set by the LAN server as `simulation.companionsAvailable`).
- A companion counts half a survivor (owner, 13 October: "ils devraient compter pour des demi-joueurs"; `COMPANION_SHARE` in `public/rules.js`): `participantCount()` = humans + companions / 2, players waiting excluded (`participantWeight`; the online room uses the same weights, and has no companions). `waveBalance` takes the fractional count, clamped to 1–4: one human and one companion (1.5) get 10 zombies in wave 1 (solo 8, duo 12) and 228 in wave 20 (160, 296); whole counts give exactly the numbers of before. Doors (`defendedDoorIds`) and raids (`raidPlayers`) take the whole part: 1.5 keeps the solo two doors and a solo raid, 2.5 a duo's, 3.5 all four doors. `wavePlayerCount` (in the snapshot too) is the wave's frozen count, fractional now; no client reads it. Companions count whole in `fightingPlayers` (a standing companion keeps the night going; humans come back at the next wave).

## Orders (body contract) — `companions/body.mjs`

```js
export function createCompanionBody(sim, id, { random = Math.random, profile } = {})
// → { setProfile(profile), setOrder(order), get order(), tick(delta) → status, get status() }
// status: 'idle' | 'running' | 'done' | 'failed' | 'down'
```

`tick(delta)` is called every simulation tick (1/30 s) BEFORE `sim.tick()`, only in phases countdown / wave / intermission and never while paused. It always refreshes `sim.setInput(id, {...})` (inputs go stale after 0.6 s). It must never throw (the director wraps it anyway). It must not use `sim.random` (use its own `random`).

Order objects (`kind` + params). "Engage" means: shoot visible threats in range with human-like aim while doing the order.

| kind | params | behaviour | ends |
|---|---|---|---|
| `hold` | — | stay; engage threats within weapon range (max 20 m) | never (running) |
| `shoot` | `zombieId` | aim and fire at that enemy; step to get a clear line if needed (≤ 6 m) | done when it is dead or gone; failed after 6 s without a clear line |
| `defend` | `doorId` | go to a post 2.5–3 m inside the door, out of the passage; face it; engage threats near that door first | never |
| `repair` | `doorId` | go inside within 2.25 m of the door, out of the passage; `sim.repairDoor` every ≥ 0.56 s, but none while a teammate standing outside needs that doorway to get back in (`shutOut`, "Trips outside") | done at full HP; failed if sealed/unreachable, blocked 3 times, or (the supermarket's east door, mended from the terrace) when, with no umbrella left, the next second of rain would leave it at or under the outdoor HP floor |
| `revive` | `playerId` | go to the downed teammate; `sim.interact(id, { revive: true })` every 0.25 s until up | done when up; failed if eliminated or unreachable for 10 s |
| `kit` | `playerId` | go within 2 m, then `sim.useReviveKit(id)` | done/failed |
| `self-kit` | — | (downed) `sim.useReviveKit(id)` | done |
| `wait` | — | (downed) nothing | never |
| `follow` | `playerId` | stay 2–4 m from that human on the same floor; engage threats near them | never; failed if they are eliminated |
| `collect` | `pickupId` | set `player.collectTargetId`, walk onto it; one lying outside is a trip through a broken doorway (see "Trips outside") | done when gone (outside: once back inside); failed after 12 s (outside: 15 s to reach it, or its doorway boarded up, sealed or blocked) |
| `coins` | — | a sweep (see "Coins"): walk to the nearest pile (the magnet does the rest), then the next within 5 m of where it stands; one just outside an open doorway is a trip; a pile it gets no closer to for 3 s is given up | after 8 s or when none is left, once back inside: done if a pile it went for is gone, else failed; failed at once when no longer calm (an enemy within 8 m, someone down) or when a trip fails |
| `buy` | `rackId` | walk to the rack (ARMORY); at the rack, still worth buying (`arsenal.mjs` `worthBuying`: a break may have refilled the gun it was to replace) else failed; every slot full, `sim.chooseWeapon` the weapon worth least first, unless the game would refuse the purchase (then failed, its reload kept); `sim.buyWeapon(id, rackId)`; the new weapon stays in hand unless the one it held fights better (`fightsBetter`: a gun with ammo, a blade, an empty gun, then the worth) | done/failed |
| `weapon` | `weapon` | `sim.chooseWeapon(id, weapon)` | done |
| `reload` | — | `sim.reload(id)` | done when the magazine is reloaded |
| `loft` | — | go to the loft post at the top of the stairs, then hold there (engage) | never |
| `grenade` | `zombieId` | aim a throw (pitch solved for the fuse) at the pack round that zombie, then `sim.throwGrenade(id)` | done when thrown; failed after 3 s or without a grenade |
| `claim` | `bonus` | a trip outside to the supply crate (see "Trips outside"): onto it, `sim.claimSupply(id, bonus, crateId)` at arm's length (still eligible, else failed), then straight back in | done once back inside; failed with no way out, too hard a rain, no longer eligible, or past the trip's time boxes |
| `supply` | `service` | walk to the station's stand spot (LATE_SUPPLIES), then `sim.buySupply(id, service)` | done when bought; failed if refused (funds, wave, already bought this wave, out of sight) |
| `umbrella` | — | walk within 1.8 m of the generator (GENERATOR, the floor it stands on), then `sim.expeditionInteraction(id)` — the human's E there, which `interact()` never reaches | done when the umbrella is back to `UMBRELLA.max`; failed after 20 s or when no longer calm; answers a zombie about to bite on the way |

Map 2, Le Dernier Panier, replaces the loft with a cellar reserve and an open-air delivery terrace. Bodies, perceptions and coin distances use public/level-space.js: either of two stair flights may join the sales floor and the cellar. A flight is committed through its opposite landing, including when an order changes, and only through one of its landings: a teammate followed while he stands on the treads is walked to and replanned every tick (committed to where he stood, the follower shuttled on the treads). With no goal of their own, bodies on a flight finish it, except a follower near a teammate who stands on that same flight: it closes up to him there instead (sent on to the landing past him, it walked back past him to the other one for as long as he stood). Bodies never jump into a well or stop on the last tread. The legacy loft order/catalogue value means the sheltered cellar reserve post on this map, with an exterior stair as a second exit. Its action description and FR/EN callout say so. Two companions on it split the posts by lobby slot (`loftRank`, body.mjs; the hospital shares it): the first holds the interior stair foot, the next watches the exterior stairs from the cellar. Only a companion standing on that order counts (one down, eliminated or waiting for the next wave holds no post, and the next takes over), and the action names the post the companion would take, in a line that fits the 170-character cap. A route's rain (companions/routes.mjs) is measured leg by leg against the real shelter, the sales roof and the ground slabs over the cellar that `spaceRainShelter` reads, clipped exactly; the same metres price a flight threefold and are the rain `routeInfo` reports. A human followed onto the exterior stairs is followed into the rain (no roofed spot sees that flight) and the `follow` line says so before the distance; one on the open terrace is covered from the roofed passage while in sight. Concrete slabs block visibility/fire between levels. Rain checks anticipate each step on the exposed terrace/exterior flight; cellar cover folds the umbrella. Cellar ammunition, coins, weapon racks, ordinary revives and kits use the same human command paths as the cabin. A deterministic test exercises both stairs in both directions and these basement interactions without any model API.

Map 3, L'Hôpital des Pins, uses the same shared SPACE authority and prediction contract for bodies, loot, coins, refuge/watch posts, recon and outdoor trips. Reception and waiting, emergency triage, the wards and nurses' station, the operating theatre and chapel are on the ground floor; pharmacy, linen, boiler and archives surround the sheltered basement. The main and service stairs are two committed routes between levels. The legacy loft order/catalogue value means the basement posts at the stair feet, never a loft: as on the supermarket, the first companion on it watches up the main stair from the far corner of its foot hall (-16.6,-13.1), which also sees the pharmacy doorway and the strip west of the flight (a zombie crossing the basement comes into sight about 7 m away, not 2.3 m as from (-14,-10.5)), the next one up the service stair from (13,0); each sees its whole flight and its head (SPACE.refuge, which sees neither flight, is unchanged; no peek on this map). Its order description, team-plan choice and FR/EN callout say so, and both stair routes remain exits. The guide and situation name the hospital rooms and routes. Concrete slabs block visibility/fire between levels; acid rain stays outside, the basement folds the umbrella, and solid parking props participate in outdoor routing. Guarding a door, a body tries posts 2.5-3 m inside it and, on this map only, 3.5-4 m next: the north door's vestibule kick panels take every spot nearer. A flight is committed through one of its landings only: a teammate followed while he stands on the treads is walked to and replanned every tick, and a follower near him on that same flight closes up to him there rather than finishing the flight, as on the supermarket. Bound for the ground floor past a flight's head rails, a body has left the flight (`spaceFlightHolding`, as the zombies) and the visibility graph routes it from there. The revive, collect, buy, supply, umbrella and repair time limits are at least the walk at the body's own pace (route metres x1.7 for the doorways, at 3.5 m/s times its gun and backpack weight) plus 4 s (revive, collect) or 6 s.

What the hospital brain reads (lot 2 of the hospital companion audit, every change gated on the hospital, so the cabin and supermarket texts stay byte-identical): a target on the other floor is priced in walked metres by the staircase the route takes, as on the supermarket ("42 m via the main stairs (below you)" from the entrance hall to the refuge passage 3 m below, 27 m from the chapel to the boiler room right under it), and so is a zombie's distance to a target on the other floor in its goal and the threat order. The loft action names only the post `loftRank` gives (the main stair foot first, the service stair foot for the next), whole within the 170-character cap. Enemies inside are placed by room, hall or flight ("INSIDE (chapel)", "INSIDE (basement refuge passage, under the north door)", "INSIDE (on the service stairs)"), recon says basement and stairs, and the STAIRS line counts each flight. The team plan's door posts say what each door is (the main entrance, the ambulance door with the crate outside, the service door, the south door); its DOORS line keeps the bare ids, because the plan situation is cut at 16000 characters and a loaded four-survivor hospital plan has under 100 to spare; the guide speaks of wide stairs and says the basement has no outside door. Trip rain leaves out the metres under the entrance canopy (2.75 m out of the north door) and the ambulance-bay canopy (2.8 m out of the west door); a trip that never leaves them costs no rain. A coin sweep is priced on the walk round the walls: the shortest path over the padded corners of the partitions, the stair rails and the wells (ground) or flights (basement), and the doorway centres, built once per floor; furniture stays the body's routing. A pile behind a partition counts its walk round through a doorway, and one that walk takes past the 10 m reach is not offered (the straight metres offered a theatre pile 2.6 m through the ward wall as 'within 3 m', a 20 m walk; in the audit's 182 piles, the 7 never reached and 16 more that took a 9-23 m walk drop out, the other 159 are all collected).

Map 4, La Fête Foraine, uses the same SPACE authority and the hospital's walled-map companion paths without changing cabin, supermarket or hospital branches. The brain names the Grand Palais des Jeux rooms ticket booth, games room, prizes, snack bar, bumper cars and circulation, and the cellar salle des machines rooms refuge, shooting gallery, mirror maze and machine room. Main and service stairs are committed through a landing only, a followed survivor on the treads is replanned rather than becoming a fixed commitment, and both flights have separate names and counts in situations and recon. Cross-floor teammate and zombie-goal distances are walked metres by the chosen flight; revive, collect, buy, supply, umbrella and repair limits use the body's weighted walk as on the hospital. Coin offers use the same wall-, rail- and well-aware walk graph, on both floors. The legacy loft order means a cellar stair-foot watch: the first body stands at (-13.1,-3.4,-10.5) for the main stair, the next at (12.7,-3.4,0) for service; each sees all 21 sampled tread/head sightlines of its own flight and none of the other, and neither peeks away. `loftRank` releases a post when its holder is down, eliminated or waiting; a downed body physically occupying the nominal post leaves the relief beside it, with the same full sightline. The action names only the assigned post (longest measured action line 134 characters). Standard 2.5-3 m door-post rows work at every exterior door; deterministic real-body guards killed each entering walker in 8.57-9.57 s with zero companion HP lost. Real purchases covered shotgun and SMG on the ground, assault rifle and flamethrower in the cellar, with physical descent, ascent and descent; following passed both flights both ways with zero vertical reversals. The existing entrance canopy removes rain from trips and doorstep coins, while uncovered approaches still cost rain; carousel and stall canopy ids remain real shelters without a generic outdoor-rule change. Team-plan post choices describe all four doors and the Palais/cellar refuge, DOORS keeps bare ids, and a loaded four-survivor plan remains whole at 15,896 characters. The full guide is 5,683 characters and the tactical guide 313 words. `validation/kimi-funfair/companion-smoke.mjs` exercises these behaviors with real simulation and bodies, without a brain process, server or API (607 checks in 21 blocks).

Body rules (always, whatever the order): reload when the magazine is empty; profile-dependent aim (reaction, tremor and composure; legacy bodies without a profile keep 0.3–0.45 s reaction, while the owner-requested Veteran is intentionally strong); fire only when the line is clear of walls and intact barricade boards (`sim.raiderLineClear(origin, point)`), the one exception being a body shut outside (see "Trips outside"); never go outside the cabin except on a trip for a pickup or the supply crate outside (other orders whose target is outside fail, and a body that finds itself outside, or whose trip was cut short, comes back in first, answering a zombie about to bite on the way); umbrella open whenever it stands in the rain, folded under the roof or for a shot (see "Trips outside"); never jump down from the loft; unstick when blocked (sidestep / back off). Routes come from the zombies' visibility graph; a zombie is wider than a body, so where the graph finds no route from the body's spot (by the stair foot or a wall), the body first steps to the nearest spot 0.4–0.8 m away that has one (straight on, it climbed the first tread toward coins under the flight and stuck there). A downed body returns `'down'` and only obeys `self-kit` / `wait`.

## Friendly fire

A room setting (`sim.friendlyFire`: `'off'`, `'reduced'`, `'full'`, scaled by
`friendlyFireScale` in `public/rules.js`), on when `sim.friendlyFireOn()` says
so: the one seam the damage, the snapshot and the companions all ask. With it on, bullets and pellets
pierce bodies into the teammates behind them, blades, flames and blasts hurt
the team, and a survivor's own grenade or rocket hurts them within 4 m. With
it off, nothing changes for the companions: not one decision, not one
character of the situation text — every check below is gated on the level.

- **The body holds its fire** (`companions/body.mjs`): every trigger pull goes
  through the same guards, the reflexes and the plank shot of a body shut out
  included, and the usual teammate clearance grows by .15 m. Every gun
  watches the aimed line past the target too (a piercing round carries on, a
  missed one as well), to the first solid or intact board or the weapon's
  range, the clearance growing with the spread, sideways and in height (a
  line just over a head still has pellets under it). Every direction the
  aim's spread may give a round (`pelletPattern`) is also cast against each
  standing teammate's box: a body overlapping the shooter's own, or beside
  and just behind the eye, holds the trigger too. The round flies on the
  tick it is fired, after `sim.tick` has moved the players, so that box is
  where the teammate can be by then: taken standing (a crouch can end that
  tick), grown sideways by one tick's stride at his top speed (his gun's
  weight, his sheet's bonus) + 3 cm, never less than .15 m, and in height by
  one tick's rise or fall (a stair tread, a jump's first tick, or his
  airborne speed and gravity; `heightRoom`). A round still 2–3 ticks from a
  teammate who jumps into its path after it left the barrel can hit him: an
  accepted residual, like a human walking into a teammate's fire. A swing is
  never started with a standing teammate in its cone (the light attack's
  reach + .3 m, arc + .2 rad for the windup, via `meleeTargets`). Flames are
  never lit when the authority's own cone (`sim.flameReach`) reaches a
  teammate, nor with one within range + .5 m and `coneAngle / 2 + .1` rad of
  the aim at his feet, middle, chest or head, with a clear line. A rocket is
  never fired when the point where its real flight stops — the first solid,
  teammate or zombie on the line, as `shootRocket` stops it, or the target —
  lands its blast within `radiusDamage + .5` m of a standing teammate or of
  the body itself. A grenade order fails rather than
  let the blast — at the pack's centre, or where the throw the hand holds
  would really burst (`sim.predictGrenade`) — come within `radiusDamage + .5`
  m of anyone standing, in 3D to the middle of the body, a floor away too. The
  grenade offers fly at most 4 throws per call and 4 per room tick shared by
  every companion described on it (`ROOM_FLIGHTS`), so a crowd cannot stall
  the server tick.
  Downed and waiting teammates are never hit, so they never block a shot
  either.
- **The body keeps out of a live blast** (`liveBursts`, `keepClear`): until a
  grenade in flight, anyone's, has burst, every body keeps out of
  `radiusDamage + .5` m of where its flight will end (a copy flown on through
  `sim.advanceGrenade`). Whatever the order, a step closer slides along that
  edge or waits; a body found inside (there at the throw, or pushed in)
  sprints out. The thrower sent at its own pack waits too.
- **The brain is told** (`companions/situation.mjs`): one line next to the
  phase line names the level and what hurts whom ("your hands hold the
  trigger anyway"), the grenade action says the blast hurts survivors within
  4 m too (boards still spared), and a pack whose centre stands that close to
  the companion or a standing teammate is not offered at all, nor one whose
  throw the body would refuse at its trigger (its predicted flight). Each
  flight costs about a millisecond: at most four per situation, the packs a
  low line from the thrower reaches flown first. The cached
  guides (`GUIDE`, `TACTICAL_GUIDE`, `PLAN_GUIDE`) stay untouched: they make
  no safety promise, and a cached prefix must stay identical for every room.
  The team plan's weapon facts say "Blasts hurt our team too." instead of
  "No friendly blast damage." (same length, the plan stays within budget).

## Situation and actions — `companions/situation.mjs`

```js
export function describeSituation(sim, companionId, { order = null, orderSince = 0, recent = [] } = {})
// → { text, actions: [{ value, description }], orders: { [value]: orderObject } }
```

- `text`: compact English summary for the model, ≤ ~2,800 characters (~700 tokens). Exact geometry is computed by code and given as meaning: distances in metres, 8-point compass from the companion, floor (ground / loft / stairs), inside/outside, which survivor a zombie is going for, door boards and zombies at each door, teammates (HP, downed + seconds left, being revived, carried bonuses), own state (HP, weapons and ammo, coins, kit, carried bonuses), wave / phase / time left, raid state, nearby pickups, what the companion can afford, the current order and for how long, a few recent events. The supply crate, when one stands, gets its own line with the whole picture (owner, 16 October): where, who has claimed, every bonus the companion's weapons make it eligible for with its ladder and levels, what the family carries, the enemies within 5 m of it, and the trip out. The station line lists its services, prices and what is already bought this wave.
- `actions`: only legal, useful values, ≤ 24, each with a one-line description. Value grammar: `keep` (only when there is a current order), `hold`, `shoot:<zombieId>` (≤ 6 most relevant visible enemies), `defend:<doorId>`, `repair:<doorId>`, `revive:<playerId>`, `kit:<playerId>`, `self-kit`, `wait`, `follow:<playerId>` (humans), `collect:<pickupId>`, `coins`, `buy:<rackId>`, `weapon:<weapon>`, `reload`, `umbrella` (calm, the umbrella under ~50 s: the generator refills it to 100 s, free), `loft`, `grenade:<zombieId>` (a pack of 3+ within 2 m of one another, 3.5–11 m away, when it carries a grenade), `claim:<bonus>` (one per bonus its weapons fit, while the crate stands unclaimed by it and a way out and the rain allow the trip), `supply:<service>` (a station service it can afford, unlocked, not bought this wave, that still makes sense: a kit when it has none, grenades under the cap, armor under the max, ammo with the held gun's reserve low, the backpack once).
- Body reflexes (the owner's cheat sheet, too fast for the brain): back off 1.2 m from a zombie within 2 m while shooting (toward open floor, never into a corner); losing 15 HP in 2 s falls back to cover for 2 s; head first well inside, chest by a door; prefer targets lined up behind one another with a piercing gun; never fire when the real aim with its spread would reach one of our barricades beyond the target. An urgent enemy (about to bite a teammate, same floor) masked by that teammate's body alone makes a holding order step round them for a clear line — up to 5 m, whatever the order's anchor, preferring the side away from walls, never through them, given up once the enemy is gone.
- Strategy lives in the brain's guide (companion-brain/guide.mjs), not in code: what to buy (SMG and machine gun first, shotgun as a stopgap, flamethrower later), coins (pick up the coins near you when nothing is within 8 m, above all when a human has a better gun, then buy the best gun you can afford when the shop is open), grenades on packs, the loft when overrun, out of ammo, falling back under fire, stepping outside for ammo, a medkit or its crate bonus, claiming from the crate while it stands (free, per player, gone with the wave — owner, 16 October: whenever a crate stands unclaimed, going is nearly always worth it).
- Buying: between waves, or in a calm moment of a wave (nothing within 8 m, nobody down), since racks unlock at the start of their wave. A purchase under way may be kept while it is still possible (unlocked, affordable, not owned) when a zombie comes within 8 m (before 13 October that took `keep` away and the walk to the rack was lost), but not with one within 3 m (inside, or anywhere once it is outside): the buying body walks on and never backs off.
- What it may buy: never a blade while it has a gun with ammo (melee puts it in the crowd), and with every slot full only something worth more than the weapon it replaces, the one it carries worth least, named in the action ("it replaces your pistol"). Worth (`companions/arsenal.mjs`, shared with the body): the rack price, a blade's for good since it never runs dry (owner: "le katana ... pas besoin de munitions"; a katana outranks a shotgun or an SMG), nothing for a gun with no ammo at all; ties: less ammo, then cheaper. A purchase replaces the weapon in hand (for humans still), and holding his shotgun Max bought the SMG and dropped the shotgun (owner, 13 October): the body now takes out the weapon worth least first, and asks `worthBuying` again at the rack. With more coins, a brain taking the first rack offered went shotgun, bat, shotgun, fire axe, bat (review of 13 October).
- The station (owner, 16 October): `supply:<service>` buys at the inside post (`sim.buySupply`, one of each service per wave) while the shop is open — revive kit 1200 from wave 5, backpack 1500 at wave 10 (four weapon slots, a little slower), grenade 350, armor vest 600 and an ammo refill of the held gun 700 from wave 15 — each offered only while it still makes sense (a kit when it carries none, grenades under the cap, armor under the max, ammo with the held gun's reserve low, the backpack once). The guide sends spare coins there once the family's guns are seen to: a kit first, then grenades and armor.
- Guards: downed → only `self-kit` (if it has a kit) and `wait`. Never the golden Magnum or ground weapons. A useful dropped bonus may be recovered only when a nearby human does not need it and another companion has not claimed that pickup. Crate claims are different (owner, 16 October): every survivor gets one bonus of their own from the same crate, so a companion claiming takes nothing from anyone — `claim` is offered whenever the crate stands, its own is unclaimed, its weapons fit the bonus, and a way out and the rain allow the trip. `buy` and `supply` only when the shop is open (see Buying), affordable, unlocked, not already owned or bought this wave. `coins` only when calm (see "Coins"). `collect` only useful dropped bonuses (with nearby humans first), ammo boxes (when its reserve is low), medkits (when hurt and no human within 6 m is hurt), revive kits (when it has none and no human within 6 m needs one — relaxed from "every human already has one", owner, 16 October); inside the cabin and same floor or reachable, or, for ammo boxes, medkits and useful dropped bonuses, outside on the ground when a trip is possible (see "Trips outside"). `repair` only for damaged, unsealed doors; it names the teammates standing outside who need that doorway to get back in ("Max is out beyond it: you wait till they are back in").
- The door lines say "you can step outside through it" for a doorway a standing survivor gets through; the companion's own line gives its umbrella (open or folded, seconds left) when it is outside or has used some, and says "SHUT OUTSIDE" when every doorway is boarded up behind it. A pickup outside it may not take says why: no way out to it, too long in the rain, it fades before you get there, or never yours outside (revive kits).
- `orders[value]` is the body order for each action value (`keep` maps to `null`).

## Trips outside — `companions/outdoors.mjs`

Owner's request (13 October 2026): "il ne faut pas leur interdire d'aller dehors". Companions earn their guns from the zombies outside; an ammo box or a medkit lying in the yard must not be out of their reach for good. The brain decides whether a trip is worth it; nothing is scripted.

- Facts from the simulation: rain burns 3 HP/s x difficulty `damageTaken` outside the eaves (|x| > 8.38 or |z| > 6.5) during countdown / wave / intermission (`updateOutsideDamage`); every survivor has an umbrella (`sim.setUmbrella(id, open)`) that blocks 100 s of rain in all and forbids shooting, melee, grenades and the minigun spin while open; a survivor crosses a door only once its lower boards are broken (`sim.doorPassable(door, 0, 1.75)`); windows never let anyone through; zombies outside go for survivors within 5 m.
- `wayOut(sim, point)`: the doorway for a trip to a point on the ground outside, among doors that are not sealed or being sealed and that a standing survivor gets through: the shortest walk from the step outside it (straight, or round one corner of the cabin), at most 14 m. A point on the doorstep, between the walls and the walk's margin round the cabin (loot of zombies shot in a doorway), is walked to from that margin straight out from it. `shutOut(sim, door)`: the survivors standing outside, within 16 m of that open doorway, for whom it is the nearest way back in. `rainCost(sim, player, distance, way = null, extraSeconds = 0)`: the round trip's seconds in the rain (at 3.5 m/s, + 1 s), plus `extraSeconds` of work out there (a repair: 0.56 s per action), the umbrella left, the HP the rain would take past the umbrella (3 s of umbrella kept in hand), and whether at least 20 HP would be left. A repair whose doorway is on the supermarket terrace (`wetApproach`) is priced as the whole job, walk both ways and every action, offered only when affordable, and says the umbrella seconds left or the HP it costs ("in the terrace rain (~12 s, ~45 HP)").
- Eyes: `collect:<pickupId>` for an ammo box or a medkit outside, with the same needs and human-first guards as inside, only with such a doorway, an affordable rain cost, and time to get there before it fades. Described honestly: "Pick up the ammo box outside, 6.8 m past the broken west door (low on ammo): about 5 s in the rain, under your umbrella; 2 enemies near it." Never revive kits or anything else outside (coins just outside a doorway: the `coins` sweep). A `claim:<bonus>` for the supply crate is the same kind of trip (same doorway and rain guards, minus the fading: a crate stands its wave and the break after; the next one opens as the next wave starts), and the body claims at arm's length rather than standing on it.
- Body: the collect order goes to the step 1.4 m inside the doorway `wayOut` picks, straight through it (4 s at most in the passage), onto the pickup (taken: gone, or stood on for two ticks), and back in by the same doorway (another open one if it was boarded up meanwhile) until well inside: done. Failed when the doorway is boarded up or sealed before it got out, when the passage stays blocked, after 15 s without reaching the pickup, or 12 s without getting back in. A trip that ends or is replaced anywhere but inside leaves the body coming back in first (by the nearest open doorway), like a body that finds itself outside; every other order keeps it inside.
- Next crate (owner, 18 October: late in a break a bot walked out to a crate it had already claimed and back instead of waiting): in the last `NEXT_CRATE_LEAD` (8) seconds of a break, with its own claim spent (claimed, or the crate inactive) and an active crate wave next (`nextCrateWave`, crate-opportunity.mjs), the eyes offer the same `claim:<bonus>` worded "Next crate (wave N starts in ~T s): wait inside at the west exit, then claim ...". The body waits on the step 1.4 m inside that exit, answering a zombie about to bite, and starts the usual trip (with its own 15 s clock) as soon as the new crate stands; over (failed) if the way closes, the break ends otherwise or the wait passes 15 s. A claim trip that comes back empty-handed (the wave 19 crate is inactive) is failed, not done; one that claimed just as the crate renewed, a step from it, claims the new one too.
- Never shut out (review of 13 October: one repair, 25 HP on the lowest plank, closes a doorway to a standing survivor, and a companion left outside was almost always downed there by the rain or the zombies). A companion's repair waits while `shutOut` names a teammate (its action says so). A body shut out all the same (a human boarded the doorway up behind it) goes to the step 1.2 m outside the nearest unsealed doorway and, with a gun that has ammo (not a blade, flames or rockets), shoots out the planks that keep a standing survivor out, the lowest first, umbrella folded for each shot; a zombie within 1.5 m comes first. Then it comes back in through the gap.
- Umbrella (body, whatever the order): open in the rain, judged a step ahead so no drop falls first; folded under the roof. In the rain it only engages within 3 m (4 m once folded, so it does not flicker), and only with a gun that can fire (an empty one keeps the umbrella open and walks on). It aims under the umbrella and folds it only for the shot itself, then keeps it folded 1.2 s after its last shot in the rain before reopening. It never stops to fight in the rain: a survivor (3.5 m/s, 5.4 sprinting) outruns every zombie (runners 1.85-2.45 m/s), and standing on each new target got companions downed outside in real waves (review trials, waves 3 to 6: in 2 to 7 of 10 trips; none once it kept walking). It asks to open only when the simulation will accept (no `umbrella-denied` noise). Without zombies, a trip takes no rain at all; with a worn umbrella, the rain takes what the umbrella no longer blocks.

## Coins — `companions/coins.mjs`

Owner's request (13 October 2026, after a night alone with Max: 748 decisions, one shotgun bought, the owner with an SMG and "énormément d'argent"): "ils ont le droit de ramasser de l'argent ... il faudrait leur faire une règle simple pour qu'ils ramassent quand même de l'argent". They buy their guns with coins.

- The simulation lets them take coins like anyone (see "Simulation hooks"); their own kills still pay them directly.
- Eyes: the `coins` action ("Pick up 3 coin piles (85 coins) within 7 m; you have 40 coins, Jules has 1,450.", plus "N just outside the west door" for those) is offered only when calm: no living enemy within 8 m of the companion and nobody down, and at least one pile within 10 m walked (by the staircase between floors; 18 m on the supermarket, where companions/routes.mjs counts the garden partition's detour through its opening) that is inside on a floor (not a table top), or within 3 m outside an open doorway (`wayOut`) with an umbrella that lasts the round trip (`rainCost` burns nothing), with no enemy within 5 m of it and no standing human within 3 m (theirs: never race a child for it). Never a gift (`droppedBy`, its own or a human's: it is meant for someone; the magnet still gives it to whoever stands nearest, so a human pays a companion by dropping coins at its feet), nor a pile its body gave up in the last 60 s. A repair whose doorway has coins the action would sweep says "N coins lie just outside it: pick them up first (coins)". The PICKUPS line counts the piles inside and their coins.
- Body: the sweep goes for the nearest such pile, then the next within 5 m of where it stands (the magnet pulls a pile from 2.6 m); a pile outside is a trip (`trip()`, as for an ammo box) back in by the doorway. It fails as soon as it is no longer calm (an enemy within 8 m, someone down), when `keep` goes too: the brain is asked again while that enemy is still far (it failed at 2 m at first, and the body then stood there without shooting until the brain answered). A pile a human comes within 3 m of is left to them. A pile it gets no 30 cm closer to in 3 s (the magnet counts), or whose trip fails, is given up for 60 s (`giveUp`: under the low end of the flight, behind something): never offered again and again. Otherwise over after 8 s or when no pile is left, once back inside: done if a pile it went for is gone, failed if none was. The director asks again 0.35 s after either (the done/failed trigger).
- Guide: one rule in the cheat sheet (coins buy guns; when nothing is within 8 m, pick up the coins near you, also just outside a door before rebuilding it, above all when a human already has a better gun; then buy the best gun you can afford when the shop is open). The guide stayed the same size: duplicated lines (reload, the loft fallback, the funnel) went.

## Brain protocol — WebSocket `/companions` on the LAN server (loopback only)

### Shared team intentions (17 October 2026)

`weapon-strategy.mjs` derives the 13 non-unique weapons' bonus-free comparison from actual simulation profiles: cadence, magazine/reserve, reload, 3/10/20 m projectile damage, shotgun per-pellet and all-pellet ceilings, penetration cap/energy retention, spread, movement and separate melee/flame/blast mechanics. DPS is an ideal body-hit ceiling, with the reload approximation and minigun spin specified; it is not predicted companion performance. The current body's light-only melee is distinguished from heavy arsenal figures. No recoil-camera penalty or penetration multiplier is invented. Carried bonuses remain in TEAM with their actual rules.

Owner play experience is separately identified as qualitative advice: the SMG is a major early pivot and the flamethrower an important later crowd-control option, neither compulsory. Saving directly for an upgrade is legitimate. Goal and retained weapon are chosen as a complementary pair; retaining the starter by habit is discouraged, and `none` still remains legal. When a goal is actually unlocked and affordable, the bounded tactical intention explicitly proposes obtaining it at a safe opportunity; saving, alternatives and urgent overrides remain available. No weapon balance, buying legality or replacement-ranking code is changed by this information update.

The production brain advertises `capabilities: ["team-plan-v1"]` (protocol version 2). Older brains still receive the original tactical contract. Planning is automatic with the new brain: there is no additional lobby option.

`companions/team-plan.mjs` builds one shared snapshot of the human and companion inventories, coins, armor, kits and bonuses, the current doors, actual weapon profiles/prices/unlocks, upcoming crate waves and station services. Countdown plans wave 1; intermission plans the next wave. Useful intentions persist between waves. Ammunition, spending and minor health changes do not themselves request a new plan. A roster/equipment change can cause a revision, no sooner than 8 seconds after the last plan. A failed request is retried after 15 seconds. A new night, victory, loss or room disposal clears the plan and invalidates its outstanding requests.

The model assigns each companion a preferred role (`support`, `close`, `marksman`, `medic`), next weapon, carried weapon to retain, crate bonus and cover post. A preferred first runner establishes the crate trip order; others cover. A runner returning from the crate keeps its turn until back inside. These are flexible intentions. Humans are never assigned orders. Rescue, immediate danger, ammunition and survival purchases may override a companion's plan.

Decisions questions in one request are independent ([official contract](https://developers.openai.com/api/docs/guides/decisions#ask-multiple-questions)). The production plan therefore has two stages sharing the same snapshot: one choice of a whole complementary role allocation (4, 12 or 24 permutations for 1, 2 or 3 bots), then the remaining choices conditioned on those known roles. Roles do not forbid duplicate weapons: two companions may choose flamethrowers. Fixed answers are retained locally; the API receives only questions with at least two choices. The server validates every answer against the original choices and the current room generation, wave horizon and equipment/roster signature. Partial, forged or obsolete plans are rejected atomically. Only catalogue values enter the simulation; no generated prose enters snapshots or player-facing messages. The diagnostic `companion-plan` event contains those closed values and its revision.

While a shared plan is in flight, each body keeps executing and each bot can ask its tactical question independently. Once a plan applies, the tactical guide is 350 words rather than 1,027; its intent is bounded to 900 characters and is included only once. The tactical menu targets 16 choices, up to 24 when needed to preserve urgent options. Rescue, kit, reloading, usable weapon swaps, withdrawal, planned purchases and crate visits retain space even in a busy scene. Purchases honor useful preferred weapons and may replace a more expensive weapon to obtain the planned one; ordinary availability, money and rack checks still apply.

The situation gives the remaining reload time to a tenth of a second. Weapon-switch choices explain when they would cancel the current reload and require restarting it on return. This information helps avoid unproductive empty-weapon round trips while keeping every emergency switch available; it does not lock an action or change player physics.

An active firearm at 0/0 explicitly cannot fire or reload. The situation mentions usable alternatives only conditionally, and an ongoing useful ammo collection shows the remaining direct distance and asks for continuity while the route stays safe. Danger and rescue still override it. This addresses repeated observed collect/shoot interruptions without scripting collection or removing any legal action.

A preferred firearm needs at least `max(2, ceil(magazine * 0.15))` rounds across magazine and reserve to protect its slot. Below that threshold the plan permits an available firearm purchase even at a lower price, and an adequately supplied gun ranks ahead of the almost-empty preferred one. This changes the companion's available choices and replacement checks; the model still chooses whether to buy. Without a plan, the legacy price policy remains.

Downing, elimination, raids, robbery and serious damage invalidate obsolete tactical questions. `cancel` aborts the associated transport and releases only that request. Repeated small hits within the same 3-second damage episode do not cancel the already-informed emergency question. No replacement action is scripted by the planner or director.

Strategic timeout is 9 seconds over both API stages (hub allowance 12 seconds); tactical timeout stays 4.5 seconds. The two stages, failed/aborted requests and tactics share the same budget. Conservative input reservations account for concurrent calls before admission; settlements use reported token usage or the existing estimate. The journal distinguishes `kind: "plan"` and `kind: "tactical"` and counts physical API calls, without storing prompts or model-selected plan values. Live validation is explicitly opt-in: `node validation/team-plan-live.mjs --live`, on an ephemeral server with a separate $0.05 test cap.

### One brain for the maps of the LAN menu (24 October 2026)

The home Wi-Fi game runs `lan-gateway.mjs`: one public port, one `server.mjs` worker per map (cabin at `/`, supermarket at `/maps/supermarket/`, hospital at `/maps/hospital/`, funfair at `/maps/funfair/` since the evening of 24 October), each with its own hub at `<root>companions`. The gateway lets `/companions` through only from this computer without a browser `Origin` (behind it every tunnel reaches the worker from 127.0.0.1, so the guard lives in the gateway).

- **Welcome.** A hub built with `mapId` names it: `{ "type": "brain-welcome", "mapId": "hospital" }`. A gateway worker's hub also lists every map: `"maps": [{ "id": "cabin", "root": "/" }, { "id": "supermarket", "root": "/maps/supermarket/" }, { "id": "hospital", "root": "/maps/hospital/" }, { "id": "funfair", "root": "/maps/funfair/" }]`. A hub without options still sends exactly `{ "type": "brain-welcome" }`.
- **One link per map.** The brain connects to its `--server` address (or 3002 then 3000) as before. From a welcome that lists `maps`, it opens a link to each sibling `<root>companions` on the same origin (known ids only, roots matching `/^\/(?:maps\/[a-z][a-z0-9-]*\/)?$/`, loopback only). All links share one brain object: one session budget, one daily budget, one token reservation. Request ids are scoped per link (`L0:`, `L1:`…) so the same `d1` on two maps is neither a duplicate nor cancelled by the other map. It prints one `Connecté au jeu (<url>) : décor <map>` line per welcome.
- **mapId in every request.** The hub adds `mapId` to each `decide` and `plan`. The brain picks the guide from it (`guidesFor(mapId)` in `companion-brain/guide.mjs`, memoised per map, so each map keeps one constant guide and one cached prompt prefix), falling back to the welcome's mapId, then to the process's own `DEADWOOD_LEVEL`. The journal entry records `map`. The guides are byte-identical to the ones each standalone level used (sha256 pinned in `test/companion-brain-maps.test.mjs`).
- **Capability `map-guide-v1`.** The production brain advertises `["team-plan-v1", "map-guide-v1"]`. A gateway hub requires `map-guide-v1`: an older brain's hello is closed with **4002** (`Cerveau à mettre à jour : relance companions.cmd.`) before it touches the seat, so the brain in place keeps it. An old brain retries every 3 s at no cost until it is stopped; it must be relaunched with the new code. Standalone servers (`node server.mjs`, `start-*.mjs`) require nothing.
- **Replacement.** Each map's hub seats one brain; a new hello with the capability replaces the old (1000) as before. A link that is replaced stops for good; the process exits when all its links have stopped. Known limit: two up-to-date brains reconnecting at the same time can split the maps between them for good (each map keeps whichever said hello last), each with its own budget. Run one brain only.
- **Gateway shutdown.** Closing the gateway or a worker never sends 1000 or 4001 to the brain: it sees an abnormal close and retries.

JSON messages, one brain at a time per hub (a new one replaces the old).

- brain → server: `{ "type": "brain-hello", "name": "openai-decisions", "version": 2, "capabilities": ["team-plan-v1", "map-guide-v1"] }` → server: `{ "type": "brain-welcome" }`, plus `mapId` (and `maps` behind the LAN gateway) as above.
- server → brain: `{ "type": "decide", "id": "<request id>", "room": "ABC123", "companion": { "id": "...", "name": "Max" }, "situation": "<text>", "actions": [{ "value", "description" }], "current": "<value or null>" }`, plus `"mapId"` when the hub has one (also on `plan`).
- brain → server: `{ "type": "decision", "id": "<request id>", "action": "<value>", "confidence": 0.8, "latencyMs": 270, "inputTokens": 850 }` or `{ "type": "decision", "id", "error": "timeout" | "refusal" | "budget" | "api" }`.
- server → brain: `{ "type": "plan", "id", "room", "wave", "situation", "questions": [{ "name", "instructions", "choices" }] }`; brain → server: `{ "type": "team-plan", "id", "choices": { "questionName": "allowedValue" }, "confidence", "latencyMs", "inputTokens" }` or an error. No more than one shared plan is pending per room.
- server → brain: `{ "type": "cancel", "id" }` for a now-obsolete question. Late replies cannot apply to another request or a new night.
- A budget refusal shows the existing toast and retains valid current orders; the brain admits no further API calls above its cap.

The server asks at most once in flight per companion: about every 1 s during a wave, every 2 s during countdown / intermission, and sooner (≥ 0.35 s) on triggers (order done/failed, a teammate down, the companion downed, phase change). Answers older than 5 s, from another generation/wave/phase, or no longer legal are dropped.

## Brain — `companion-brain/` (separate process; the only code that knows OpenAI)

`node companion-brain/brain.mjs [--server ws://127.0.0.1:3002/companions] [--session-budget 2] [--daily-budget 5] [--dry]`

- Reads `OPENAI_API_KEY` from the environment; never prints, logs or stores it. Exits with a clear message when it is missing (unless `--dry`).
- For each `decide`: one `POST https://api.openai.com/v1/decisions` with `model: "gpt-6-luna"`, `input` = the game guide (how to play Deadwood well, as a teammate of a father and his 10-year-old son) + the situation text, `questions` = one `choice` question named `action` whose choices are the `actions`. Timeout 4.5 s (the hub waits 6 s; answers older than 5 s of game time are dropped). Answers `decision` with the chosen value (or an error).
- Budget: counts `usage.input_tokens` at $0.10 per million; session budget (default $2) and daily budget (default $5) persisted under `%LOCALAPPDATA%/deadwood-companions/usage.json`. Over budget → answers `error: "budget"`.
- Logs one JSON line per decision under `%LOCALAPPDATA%/deadwood-companions/decisions-YYYY-MM-DD.jsonl` (time, room, companion, latency, tokens, cost, action, confidence, error) — never the key.
- Reconnects every 3 s when the game server is not there. `--dry` answers with the first action without calling the API (for tests and demos).

## Lobby and HUD (client)

- Lobby and results: a "COMPAGNONS IA" picker 0–3 next to the difficulty, host only, shown only when `snapshot.companionsAvailable === true`. It sends `{ type: "companions", count }`. Options beyond the free seats are disabled. The count shown is the number of companion players.
- Lists (HUD survivors, lobby, results) show an "IA" badge on companions.
- Callouts: the server emits `{ event: "companion-callout", id, order, target? }` on meaningful order changes (revive, kit, defend, repair, buy, follow, loft), at most one per companion per 4 s; the client shows a fixed FR/EN line ("Max : je relève Jules !").
- Brain lost: `{ event: "companions-offline" }` → toast; budget: `{ event: "companions-budget" }` → toast.

Names: Max, Léa, Sam (in that order).
