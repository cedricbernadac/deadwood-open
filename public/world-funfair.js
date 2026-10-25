import * as THREE from '/vendor/three.module.js';
import { LEVEL } from './level-config.js';
import { SPACE } from './level-space.js';
import { ARMORY, armoryRackBounds, BARRICADE_BOARDS, SEALED_DOOR_PLATE, EXTERIOR_WALLS, wallOpenings, LATE_SUPPLIES, GENERATOR, RADAR } from './rules.js';
import { coverPieces } from './layout.js';
import { getLanguage, weaponLabel } from './i18n.js';
import { createSplinterPool } from './splinters.js';
import { createCasingPool } from './casings.js';
import { sharedEffects } from './fx.js';
import { mergeStaticMeshes } from './world-merge.js';
import { impactBurst, muzzleFlash, emitBarrelSmoke, emitSwingTrail, emitSignalSmoke } from './shot-fx.js';
import { createFunfairOutdoors } from './funfair-outdoors.js';
import { loadLevelDecor } from './world-supermarket.js';
import { GROUND_TUBES, CELLAR_TUBES, WARM_FIXTURES, INDOOR, lampsFor, indoorTarget, flickerLevel } from './funfair-lights.js';
import { createFunfairMirrors, mirrorEnclosure } from './funfair-mirrors.js';

export function createFunfairWorld(scene, { quality, loadDecor, loadReflector } = {}, factories) {
  const root = new THREE.Group(); root.name = 'funfairWorld'; scene.add(root);
  const doors = new Map(), rayBlockers = [], proxies = [], localized = [], armoryDisplays = new Map();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb7aaa5, roughness: .92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x526764, roughness: .65, metalness: .35 });
  const wood = factories.boardWood;
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  function box(parent, x, y, z, w, h, d, material = concrete, proxy = true) {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.receiveShadow = mesh.castShadow = true; parent.add(mesh);
    if (proxy) { rayBlockers.push(mesh); proxies.push(mesh); }
    return mesh;
  }
  function localizedSign(parent, label, ...placement) {
    const mesh = factories.sign(parent, label(getLanguage()), ...placement);
    localized.push({ mesh, label }); return mesh;
  }
  const solid = bounds => box(root, (bounds.minX + bounds.maxX) / 2,
    (bounds.baseY ?? 0) + bounds.height / 2, (bounds.minZ + bounds.maxZ) / 2,
    bounds.maxX - bounds.minX, bounds.height, bounds.maxZ - bounds.minZ);
  function spaceBox(bounds) {
    const mesh = box(root, (bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
    mesh.name = 'collision-' + bounds.id; return mesh;
  }
  for (const volume of [...SPACE.boxes, ...SPACE.facadeSections]) spaceBox(volume);
  for (const wall of EXTERIOR_WALLS) {
    const { id, axis, fixed, rotation } = wall;
    for (const opening of wallOpenings(id)) {
      if (!opening.door) continue;
      const frame = new THREE.Group(); frame.position.set(axis === 'x' ? 0 : fixed, 0, axis === 'x' ? fixed : 0);
      frame.rotation.y = rotation; root.add(frame);
      const door = new THREE.Group(); frame.add(door);
      door.userData.boards = BARRICADE_BOARDS.map(board => {
        const mesh = box(door, 0, board.y, 0, board.width, board.height, board.depth, wood, false);
        mesh.rotation.z = board.angle;
        for (const x of [-1.12, 1.12]) box(mesh, x, 0, .065, .045, .045, .022, metal, false);
        return mesh;
      });
      const seal = new THREE.Group(); root.add(seal); seal.visible = false;
      const fill = axis === 'x'
        ? box(seal, 0, SEALED_DOOR_PLATE.height / 2, fixed, SEALED_DOOR_PLATE.width, SEALED_DOOR_PLATE.height, SEALED_DOOR_PLATE.depth, metal, false)
        : box(seal, fixed, SEALED_DOOR_PLATE.height / 2, 0, SEALED_DOOR_PLATE.depth, SEALED_DOOR_PLATE.height, SEALED_DOOR_PLATE.width, metal, false);
      const sign = localizedSign(frame, language => ({
        north: language === 'en' ? 'MAIN ENTRANCE' : 'ENTRÉE PRINCIPALE',
        south: language === 'en' ? 'SOUTH EXIT' : 'SORTIE SUD',
        west: language === 'en' ? 'RIDES' : 'MANÈGES',
        east: language === 'en' ? 'SERVICE ENTRANCE' : 'ACCÈS SERVICE',
      })[id], 0, 3.6, .19, 0, 2.3);
      door.userData.seal = seal; door.userData.wall = fill; door.userData.frame = frame;
      door.userData.openingSections = []; door.userData.shelterSign = sign; doors.set(id, door);
    }
  }
  for (const obstacle of [...LEVEL.interiorWalls, ...(LEVEL.furniture ?? [])]) solid(obstacle);
  for (const piece of coverPieces(LEVEL.sofa)) solid(piece);
  solid(LEVEL.table);
  const roof = LEVEL.roof;
  box(root, (roof.bounds.minX + roof.bounds.maxX) / 2, roof.height - roof.thickness / 2,
    (roof.bounds.minZ + roof.bounds.maxZ) / 2, roof.bounds.maxX - roof.bounds.minX, roof.thickness, roof.bounds.maxZ - roof.bounds.minZ);
  function rack(crate) {
    solid(armoryRackBounds(crate));
    const display = factories.createArmoryRack(crate.weapon); display.name = `armory-${crate.id}`;
    display.position.set(crate.x, crate.y, crate.z); display.rotation.y = crate.facing ?? 0; root.add(display);
    localizedSign(display, language => `${weaponLabel(crate.weapon, { language })} · ${crate.price} ${language === 'en' ? 'COINS' : 'PIÈCES'}`, 0, 2, .218, 0, 1.17);
    localizedSign(display, language => `BONUS · ${language === 'en' ? 'WAVE' : 'VAGUE'} ${crate.unlockWave}`, 0, 1.02, .218, 0, .95);
    const gun = display.getObjectByName(`rackWeapon-${crate.weapon}`);
    root.updateMatrixWorld(true); if (gun) mergeStaticMeshes(gun, { zones: [gun], keepColors: true });
    return display;
  }
  for (const crate of ARMORY) armoryDisplays.set(crate.weapon, rack(crate));
  const lateSupplyPost = factories.createLateSupplyPost();
  lateSupplyPost.position.set(LATE_SUPPLIES.position.x, LATE_SUPPLIES.position.y, LATE_SUPPLIES.position.z);
  lateSupplyPost.rotation.y = LATE_SUPPLIES.position.facing; root.add(lateSupplyPost);
  const supplyCrate = factories.createSupplyCrate(); supplyCrate.visible = false; root.add(supplyCrate);
  const lamps = [];
  for (const spec of lampsFor(quality)) {
    const light = spec.point ? new THREE.PointLight(spec.color, spec.intensity, spec.range, 2)
      : new THREE.SpotLight(spec.color, spec.intensity, spec.range, spec.angle ?? 1.05, .75, 2);
    light.position.set(spec.x, spec.y, spec.z); root.add(light);
    if (light.isSpotLight) {
      const [tx, ty, tz] = spec.target ?? [spec.x, spec.y - 3, spec.z];
      light.target.position.set(tx, ty, tz); root.add(light.target);
    }
    lamps.push({ light, intensity: spec.intensity, flicker: spec.flicker === true });
  }
  const HALO = { cold: .2, warm: .5 };
  const halos = [], haloMaterial = new THREE.SpriteMaterial({ map: factories.glowTexture?.(), color: 0xc9eee7, transparent: true, opacity: HALO.cold,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flickerHaloMaterial = haloMaterial.clone(), agedHaloMaterial = haloMaterial.clone(), warmHaloMaterial = haloMaterial.clone();
  agedHaloMaterial.color.setHex(0xffe0b0); warmHaloMaterial.color.setHex(0xffb76b); warmHaloMaterial.opacity = HALO.warm;
  const tubeHalo = { flicker: flickerHaloMaterial, aged: agedHaloMaterial, on: haloMaterial };
  for (const [tubes, cellar] of [[GROUND_TUBES, false], [CELLAR_TUBES, true]]) for (const tube of tubes) {
    if (tube.state === 'dead') continue;
    const halo = new THREE.Sprite(tubeHalo[tube.state]); halo.position.set(tube.x, cellar ? tube.y : tube.y - .05, tube.z);
    halo.scale.setScalar(cellar ? 1.1 : tube.y > 5 ? 2.1 : 1.3); root.add(halo); halos.push(halo);
  }
  for (const fixture of WARM_FIXTURES) {
    const halo = new THREE.Sprite(warmHaloMaterial); halo.position.set(fixture.x, fixture.y, fixture.z); halo.scale.setScalar(.9); root.add(halo); halos.push(halo);
  }
  let reducedMotion = false;
  try { reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch {}
  const NIGHT = factories.NIGHT ?? { horizon: 0x14232b };
  const LIGHT = { ambient: .5, moon: 1.35, fill: .22 };
  const ambient = new THREE.HemisphereLight(0x8ea4cc, 0x736a5f, LIGHT.ambient); scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xa9c6f0, LIGHT.moon); moon.position.set(-13, 21, -14); scene.add(moon);
  const fill = new THREE.DirectionalLight(0x8c7fc4, LIGHT.fill); fill.position.set(10, 7, 12); scene.add(fill);
  scene.background = new THREE.Color(NIGHT.horizon); scene.fog = new THREE.FogExp2(NIGHT.horizon, .014);
  const fogColor = scene.fog.color.clone(), background = scene.background.clone();
  const outdoors = createFunfairOutdoors(scene, root, { quality, grassTexture: factories.grassTexture, repeatedTexture: factories.repeatedTexture, createNightSky: factories.createNightSky });
  const glows = [];
  const moodColors = [['ambientSky', [ambient.color]], ['ambientGround', [ambient.groundColor]], ['moon', [moon.color]], ['fill', [fill.color]], ['lamps', lamps.map(lamp => lamp.light.color)]]
    .map(([key, colors]) => ({ key, colors, originals: colors.map(color => color.clone()), hex: null }));
  const moodHex = value => Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : null;
  let skyState = { scale: 1, fog: null }, indoor = 0, indoorAt = null;
  const shadows = factories.moonShadows(scene, moon, quality);
  const splinters = createSplinterPool(); root.add(splinters.mesh);
  const particles = sharedEffects(); particles.clear(); scene.add(particles.root); particles.driven = true;
  const casings = createCasingPool(); scene.add(casings.mesh);
  const expedition = factories.createExpeditionEffects(scene, { root, rayBlockers, doors, localizedSign, quality });
  let lastUpdate = 0, crateSmokeAt = 0, mood = null, moodRenderer = null, exposure = null;
  let decor = null, loaded = false;
  // The mirror maze's live reflections (medium and high quality) and the
  // local survivor seen in them: funfair-mirrors.js. Nothing outdoors (the
  // scenery, the sky, the rain, the spawn grilles, fuel caches and warnings)
  // shows in a cellar mirror, and the collision proxies never draw (their
  // material is hidden once the decor is in place, before any pool works):
  // both are left out of reflection passes. The maze room and the slab over
  // the cellar close the rest: a pass leaves out the scenery and the actors
  // that the maze's doorway and the stair wells do not show (MIRROR_SIGHT).
  const maze = SPACE.rooms?.find(room => room.id === 'miroirs'), floorHeight = id => SPACE.floors?.find(floor => floor.id === id)?.y;
  const overMaze = slab => maze && slab.maxY === floorHeight('ground') && slab.minX <= maze.target.x && slab.maxX >= maze.target.x && slab.minZ <= maze.target.z && slab.maxZ >= maze.target.z;
  const mirrors = createFunfairMirrors({ scene, quality, rayBlockers, furniture: LEVEL.furniture, isReady: () => loaded,
    offstage: [outdoors.group, outdoors.sky, expedition.rain, expedition.spawnEntries, ...(expedition.cacheMarkers ?? []), expedition.warningRings, expedition.warningBodies, ...proxies].filter(Boolean),
    enclosure: mirrorEnclosure(maze, { floorY: floorHeight(maze?.floor), ceilingY: floorHeight('ground'), slabBottom: SPACE.slabs?.find(overMaze)?.minY, wells: SPACE.holes }),
    scenery: () => {
      const meshes = []; decor?.traverse(node => { if (node.isMesh) meshes.push(node); });
      return [...meshes, ...armoryDisplays.values(), lateSupplyPost, ...halos, ...[...doors.values()].flatMap(door => [door.userData.frame, door.userData.seal]), expedition.generator].filter(Boolean);
    },
    movers: [supplyCrate],
    factories: { createSurvivor: factories.createSurvivor, setSurvivorWeapon: factories.setSurvivorWeapon, setSurvivorSecondaryWeapon: factories.setSurvivorSecondaryWeapon,
      animateSurvivor: factories.animateSurvivor, getSurvivorStyle: factories.getSurvivorStyle, createUmbrella: factories.createUmbrella },
    ...(loadReflector ? { loadReflector } : {}) });
  const api = { levelId: LEVEL.id, root, doors, rayBlockers, armoryDisplays, supplyCrate, lateSupplyPost, expedition, mirrors,
    atmosphere: { ambient, moon, fill, lamps, sky: outdoors.sky, outdoors, quality },
    effects: { impact: impactBurst, muzzle: muzzleFlash, smoke: emitBarrelSmoke, swing: emitSwingTrail, particles, casings },
    get loaded() { return loaded; }, get decor() { return decor; },
    setLanguage(language = getLanguage()) { for (const { mesh, label } of localized) mesh.userData.setLabel(label(language)); },
    restyleArmory() {
      for (const [type, display] of armoryDisplays) {
        const old = display.getObjectByName('rackWeapon-' + type), structure = old?.parent ?? display.children[0];
        old?.removeFromParent();
        old?.traverse(node => { if (node.isMesh && !node.geometry.userData.frissonShared) node.geometry.dispose(); });
        const gun = factories.buildRackWeapon(type); structure.add(gun); root.updateMatrixWorld(true);
        mergeStaticMeshes(gun, { zones: [gun], keepColors: true });
      }
      mirrors.refreshScenery();
    },
    setDressing() { return false; },
    setMood(next, options) {
      mood = next ?? null; moodRenderer = options?.renderer ?? moodRenderer;
      if (moodRenderer) {
        exposure ??= moodRenderer.toneMappingExposure;
        moodRenderer.toneMappingExposure = exposure * (mood?.exposure ?? 1);
      }
      for (const tint of moodColors) {
        const hex = mood ? moodHex(mood.colors?.[tint.key]) : null;
        if (hex === tint.hex) continue;
        tint.hex = hex;
        tint.colors.forEach((color, index) => hex === null ? color.copy(tint.originals[index]) : color.setHex(hex));
      }
      const skyScale = mood?.sky ?? 1, skyFog = moodHex(mood?.fogColor);
      if (skyScale !== skyState.scale || skyFog !== skyState.fog) {
        skyState = { scale: skyScale, fog: skyFog }; outdoors.sky?.userData.setMood?.(skyScale, skyFog);
        if (skyFog === null) { scene.fog.color.copy(fogColor); scene.background.copy(background); }
        else { scene.fog.color.setHex(skyFog); scene.background.setHex(skyFog); }
      }
      return Boolean(mood);
    },
    prewarm(renderer, camera) { moodRenderer = renderer; mirrors.setRenderer(renderer); renderer?.compile?.(scene, camera); return true; },
    // The local survivor's pose for the mirrors (client.js, once per frame).
    setLocalAvatar(state) { mirrors.setLocalAvatar(state); },
    dispose() { mirrors.dispose(); },
    setDoor(id, hp, health, sealed = false) {
      const door = doors.get(id); if (!door) return;
      const ratio = THREE.MathUtils.clamp(hp > 1 ? hp / 100 : hp, 0, 1);
      door.userData.hp = ratio;
      door.userData.boards.forEach((board, index) => {
        const show = !sealed && (Array.isArray(health) ? health[index] > 0 : index < Math.ceil(ratio * BARRICADE_BOARDS.length));
        if (board.visible && !show && !sealed && door.userData.synced && lastUpdate - (door.userData.syncedAt ?? -Infinity) < 1.5) {
          const point = board.getWorldPosition(new THREE.Vector3()); splinters.burst(point, new THREE.Vector3(point.x, 0, point.z), lastUpdate);
        }
        board.visible = show;
      });
      door.userData.synced = true; door.userData.syncedAt = lastUpdate; door.userData.seal.visible = sealed; door.userData.frame.visible = !sealed;
    },
    update(time, context = {}) {
      lastUpdate = time; splinters.update(time); particles.update(time); casings.update(time); shadows?.follow(context.camera);
      for (const player of context.snapshot?.players ?? []) {
        const backpack = context.survivors?.get?.(player.id)?.userData.backpack;
        if (backpack) backpack.visible = player.backpack === true;
      }
      const state = context.snapshot?.expedition;
      const power = state?.enabled ? THREE.MathUtils.clamp(state.generator?.power ?? 1, GENERATOR.minPower, 1) : 1;
      const target = indoorTarget(context.camera?.position), step = indoorAt === null ? 1 : Math.min(1, Math.max(0, time - indoorAt) * INDOOR.rate);
      indoorAt = time; indoor += (target - indoor) * step;
      const moonShare = 1 + (INDOOR.moon - 1) * indoor, bounce = 1 + (INDOOR.ambient - 1) * indoor;
      ambient.intensity = LIGHT.ambient * bounce * (mood?.ambient ?? 1); moon.intensity = LIGHT.moon * moonShare * (mood?.moon ?? 1); fill.intensity = LIGHT.fill * moonShare * (mood?.fill ?? 1);
      const flicker = flickerLevel(time, reducedMotion), lampMood = mood?.lamps ?? 1;
      for (const [index, lamp] of lamps.entries()) lamp.light.intensity = lamp.intensity * power * lampMood * (lamp.flicker ? flicker : .98 + .02 * Math.sin(time * 5 + index));
      haloMaterial.opacity = agedHaloMaterial.opacity = HALO.cold * power * lampMood; flickerHaloMaterial.opacity = haloMaterial.opacity * flicker * flicker;
      warmHaloMaterial.opacity = HALO.warm * power * lampMood;
      for (const glow of glows) glow.material.emissiveIntensity = glow.intensity * power * lampMood * (glow.flicker ? flicker * flicker : 1);
      if (context.camera && outdoors.sky) context.camera.getWorldPosition(outdoors.sky.position);
      const supply = context.snapshot?.supplyCrate;
      supplyCrate.visible = context.active === true && Boolean(supply);
      if (supply) {
        supplyCrate.position.set(supply.x, supply.y ?? 0, supply.z);
        const radar = supplyCrate.getObjectByName('bonus-radar'); if (radar) radar.visible = (context.snapshot?.wave ?? 0) >= RADAR.unlockWave;
        const claimed = supply.active === false || supply.claimed?.includes(context.myId);
        supplyCrate.userData.indicator.material.color.setHex(claimed ? 0x61776b : 0xe2c47d);
        supplyCrate.userData.halo.material.opacity = claimed ? .08 : .16 + Math.sin(time * 2) * .035;
        const { lens, glow } = supplyCrate.userData.beacon, flash = factories.supplyBeaconFlash(time, claimed);
        lens.material.color.setHex(claimed ? factories.SUPPLY_BEACON.claimed : flash ? factories.SUPPLY_BEACON.bright : factories.SUPPLY_BEACON.dim);
        glow.material.opacity = flash ? .85 : 0; glow.scale.setScalar(flash ? 1.2 : .5);
        if (supply.active !== false && time >= crateSmokeAt) { crateSmokeAt = time + factories.SUPPLY_BEACON.smokeEvery; emitSignalSmoke({ x: supply.x, y: (supply.y ?? 0) + .48, z: supply.z }, time); }
      }
      const magnum = armoryDisplays.get('magnum')?.getObjectByName('rackWeapon-magnum'); if (magnum) magnum.visible = context.snapshot?.magnumAvailable !== false;
      expedition.update(time, context);
      mirrors.update(time, context);
    },
  };
  const loader = loadDecor ?? (() => loadLevelDecor('/levels/funfair.glb'));
  api.ready = loader().then(model => {
    decor = model; model.name = 'funfairBlender'; model.traverse(node => { if (node.isMesh) { node.castShadow = node.receiveShadow = true; } });
    const glowKind = name => {
      if (!name) return null;
      if (/flicker/i.test(name)) return true;
      if (/fluorescent|warm_lens|emergency_amber|screen_glow|sign_(?:glow|dead)|lamp_(?:sodium|pool)|exit.*(?:glow|light)|sign.*(?:glow|lit)|garland.*(?:glow|lit)|arcade.*(?:glow|lit)/i.test(name)) return false;
      return null;
    };
    const clones = new Map();
    model.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material, index) => {
        const flicker = glowKind(material?.name); if (flicker === null) return;
        if (!clones.has(material.name)) {
          const clone = material.clone(); clones.set(material.name, clone);
          glows.push({ material: clone, intensity: clone.emissiveIntensity, flicker });
        }
        const clone = clones.get(material.name);
        if (Array.isArray(node.material)) node.material[index] = clone; else node.material = clone;
      });
      if (materials.some(material => /floor_grime|prop_shadow|lamp_pool|ground_decal|dirt_decal/i.test(material?.name ?? ''))) node.renderOrder = -1;
    });
    root.add(model); for (const mesh of proxies) mesh.material = hidden;
    loaded = true; root.userData.artLoaded = true; root.updateMatrixWorld(true); return true;
  }).catch(error => { root.userData.artError = String(error); console.error('Funfair artwork:', error); return false; });
  return api;
}
