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
import { createSupermarketOutdoors } from './supermarket-outdoors.js';
import { SHOP_TUBES, CELLAR_TUBES, WARM_FIXTURES, INDOOR, lampsFor, indoorTarget, flickerLevel } from './supermarket-lights.js';

export async function loadLevelDecor(path) {
  const { GLTFLoader } = await import('/vendor/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(path)).scene;
}

// Blender owns the artwork; these simple volumes own local ray occlusion.
// They are hidden after the GLB arrives, and remain raycastable like the
// generator's existing occlusion mesh. Authority always stays on the server.
export function createSupermarketWorld(scene, { quality, loadDecor } = {}, factories) {
  const root = new THREE.Group(); root.name = 'supermarketWorld'; scene.add(root);
  const doors = new Map(), rayBlockers = [], proxies = [], localized = [], armoryDisplays = new Map();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8b7aa, roughness: .92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4c635f, roughness: .65, metalness: .35 });
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
    mesh.name = 'collision-' + bounds.id;
    return mesh;
  }
  for (const volume of [...SPACE.boxes, ...SPACE.facadeSections]) spaceBox(volume);
  for (const wall of EXTERIOR_WALLS) {
    const { id, axis, fixed, rotation } = wall;
    for (const opening of wallOpenings(id)) {
      if (opening.door) {
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
        const sign = localizedSign(frame, language => ({ north: language === 'en' ? 'DELIVERIES' : 'LIVRAISONS', south: language === 'en' ? 'MAIN ENTRANCE' : 'ENTRÉE PRINCIPALE', west: language === 'en' ? 'EMERGENCY EXIT' : 'ISSUE DE SECOURS', east: language === 'en' ? 'DELIVERY TERRACE' : 'TERRASSE LIVRAISONS' })[id], 0, id === 'east' ? 3 : 3.6, .19, 0, 2.3);
        door.userData.seal = seal; door.userData.wall = fill; door.userData.frame = frame;
        door.userData.openingSections = []; door.userData.shelterSign = sign;
        doors.set(id, door);
      }
    }
  }
  // Ground slabs are cut around both real descending stairwells. The cellar,
  // retaining walls and closed concrete steps come from the shared contract.
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
  // Lights hang under the tubes that still work (supermarket-lights.js, which
  // build_supermarket.py mirrors). Spots aim at the floor, so each floor keeps
  // its own light although nothing here casts a shadow through the slab.
  const lamps = [];
  for (const spec of lampsFor(quality)) {
    const light = spec.point ? new THREE.PointLight(spec.color, spec.intensity, spec.range, 2)
      : new THREE.SpotLight(spec.color, spec.intensity, spec.range, spec.angle ?? 1.05, .75, 2);
    light.position.set(spec.x, spec.y, spec.z); root.add(light);
    if (light.isSpotLight) { const [tx, ty, tz] = spec.target ?? [spec.x, spec.y - 3, spec.z]; light.target.position.set(tx, ty, tz); root.add(light.target); }
    lamps.push({ light, intensity: spec.intensity, flicker: spec.flicker === true });
  }
  // Small round halos stand in for bloom on the working tubes, as on the
  // cabin lamps (a sprite always faces the camera, so it stays round).
  const HALO = { cold: .2, warm: .5 };
  const halos = [], haloMaterial = new THREE.SpriteMaterial({ map: factories.glowTexture?.(), color: 0xbfeee2, transparent: true, opacity: HALO.cold,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flickerHaloMaterial = haloMaterial.clone(), agedHaloMaterial = haloMaterial.clone(), warmHaloMaterial = haloMaterial.clone();
  agedHaloMaterial.color.setHex(0xffe0b0); warmHaloMaterial.color.setHex(0xffb76b); warmHaloMaterial.opacity = HALO.warm;
  const tubeHalo = { flicker: flickerHaloMaterial, aged: agedHaloMaterial, on: haloMaterial };
  // A wide, faint glow on the ceiling deck around each working shop tube.
  for (const [tubes, y, size] of [[SHOP_TUBES, 5.86, 2.1], [CELLAR_TUBES, -.63, 1.1]]) for (const tube of tubes) {
    if (tube.state === 'dead') continue;
    const halo = new THREE.Sprite(tubeHalo[tube.state]); halo.position.set(tube.x, y, tube.z); halo.scale.setScalar(size); root.add(halo); halos.push(halo);
  }
  for (const fixture of WARM_FIXTURES) {
    const halo = new THREE.Sprite(warmHaloMaterial); halo.position.set(fixture.x, fixture.y, fixture.z); halo.scale.setScalar(.9); root.add(halo); halos.push(halo);
  }
  let reducedMotion = false;
  try { reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch {}
  // Night as at the cabin: the same sky, horizon fog and moon direction.
  const NIGHT = factories.NIGHT ?? { horizon: 0x14232b };
  const LIGHT = { ambient: .5, moon: 1.35, fill: .22 };
  // The ground colour is the light bounced off floors: it keeps ceilings and
  // undersides readable now that every tube light aims at the floor.
  const ambient = new THREE.HemisphereLight(0x8ea4cc, 0x736a5f, LIGHT.ambient); scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xa9c6f0, LIGHT.moon); moon.position.set(-13, 21, -14); scene.add(moon);
  const fill = new THREE.DirectionalLight(0x8c7fc4, LIGHT.fill); fill.position.set(10, 7, 12); scene.add(fill);
  scene.background = new THREE.Color(NIGHT.horizon); scene.fog = new THREE.FogExp2(NIGHT.horizon, .014);
  const fogColor = scene.fog.color.clone(), background = scene.background.clone();
  const outdoors = createSupermarketOutdoors(scene, root, { quality, grassTexture: factories.grassTexture, repeatedTexture: factories.repeatedTexture, createNightSky: factories.createNightSky });
  // Emissive GLB materials driven like the lights: tubes, warm lenses, sign.
  const glows = [];
  // Frisson colours, as at the cabin: written only when they change.
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
  const api = { levelId: LEVEL.id, root, doors, rayBlockers, armoryDisplays, supplyCrate, lateSupplyPost, expedition,
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
      // Sky, fog and background change together, only when they change.
      const skyScale = mood?.sky ?? 1, skyFog = moodHex(mood?.fogColor);
      if (skyScale !== skyState.scale || skyFog !== skyState.fog) {
        skyState = { scale: skyScale, fog: skyFog }; outdoors.sky?.userData.setMood?.(skyScale, skyFog);
        if (skyFog === null) { scene.fog.color.copy(fogColor); scene.background.copy(background); }
        else { scene.fog.color.setHex(skyFog); scene.background.setHex(skyFog); }
      }
      return Boolean(mood);
    },
    prewarm(renderer, camera) { moodRenderer = renderer; renderer?.compile?.(scene, camera); return true; },
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
      // Indoors (shop or cellar) the moon fades and the bounce rises, eased so
      // walking through a door feels like eyes adapting, not a light switch.
      const target = indoorTarget(context.camera?.position), step = indoorAt === null ? 1 : Math.min(1, Math.max(0, time - indoorAt) * INDOOR.rate);
      indoorAt = time; indoor += (target - indoor) * step;
      const moonShare = 1 + (INDOOR.moon - 1) * indoor, bounce = 1 + (INDOOR.ambient - 1) * indoor;
      ambient.intensity = LIGHT.ambient * bounce * (mood?.ambient ?? 1); moon.intensity = LIGHT.moon * moonShare * (mood?.moon ?? 1); fill.intensity = LIGHT.fill * moonShare * (mood?.fill ?? 1);
      const flicker = flickerLevel(time, reducedMotion), lampMood = mood?.lamps ?? 1;
      for (const [index, lamp] of lamps.entries()) lamp.light.intensity = lamp.intensity * power * lampMood * (lamp.flicker ? flicker : .98 + .02 * Math.sin(time * 5 + index));
      // The tube itself dips deeper than its light, like a real starter.
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
        lens.material.color.setHex(claimed ? factories.SUPPLY_BEACON.claimed : flash ? factories.SUPPLY_BEACON.bright : factories.SUPPLY_BEACON.dim); glow.material.opacity = flash ? .85 : 0; glow.scale.setScalar(flash ? 1.2 : .5);
        if (supply.active !== false && time >= crateSmokeAt) { crateSmokeAt = time + factories.SUPPLY_BEACON.smokeEvery; emitSignalSmoke({ x: supply.x, y: (supply.y ?? 0) + .48, z: supply.z }, time); }
      }
      const magnum = armoryDisplays.get('magnum')?.getObjectByName('rackWeapon-magnum'); if (magnum) magnum.visible = context.snapshot?.magnumAvailable !== false;
      expedition.update(time, context);
    },
  };
  const loader = loadDecor ?? (() => loadLevelDecor('/levels/supermarket.glb'));
  api.ready = loader().then(model => {
    decor = model; model.name = 'supermarketBlender'; model.traverse(node => { if (node.isMesh) { node.castShadow = node.receiveShadow = true; } });
    // Tubes, warm lenses, lamps and the sign follow the generator, the mood
    // and the stutter. Found by material: a batch can hold several (the sign
    // carries lit, dead and flickering letters in one mesh).
    const GLOWS = { Fluorescent_cold: false, Fluorescent_flicker: true, Fluorescent_aged: false, Warm_lens: false, Emergency_amber: false,
      Sign_glow: false, Sign_flicker: true, Sign_dead: false, Lamp_sodium: false, Lamp_sodium_flicker: true, Lamp_pool: false, Lamp_pool_flicker: true };
    const clones = new Map();
    model.traverse(node => {
      const name = node.isMesh ? node.material?.name : null;
      if (!(name in GLOWS)) return;
      if (!clones.has(name)) {
        const material = node.material.clone(); clones.set(name, material);
        glows.push({ material, intensity: material.emissiveIntensity, flicker: GLOWS[name] });
      }
      node.material = clones.get(name);
    });
    // Ground decals (grime, prop shadows, lamp pools) draw first among
    // transparent things, so pickup and crate halos never pop while walking.
    const DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker']);
    model.traverse(node => { if (node.isMesh && DECALS.has(node.material?.name)) node.renderOrder = -1; });
    root.add(model); for (const mesh of proxies) mesh.material = hidden;
    loaded = true; root.userData.artLoaded = true; root.updateMatrixWorld(true); return true;
  }).catch(error => { root.userData.artError = String(error); console.error('Supermarket artwork:', error); return false; });
  return api;
}
