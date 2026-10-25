import * as THREE from '/vendor/three.module.js';

// One shared particle engine for every shot, spark, flame, puff and blast.
// Three pools, three draw calls, whatever happens on screen:
//   glow   – additive camera-facing sprites (flames, flashes, bullet heads)
//   streak – additive quads stretched along a motion (tracers, sparks)
//   smoke  – soft alpha-blended sprites (smoke, dust)
// Particles follow closed-form motion (velocity with drag, plus gravity), so
// the picture does not depend on the frame rate. Nothing here adds a light.

const VERTEX = /* glsl */`
attribute vec3 aCenter;
attribute vec3 aTail;
attribute vec4 aColor;
attribute vec2 aSize;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vColor = aColor;
  vec4 head = modelViewMatrix * vec4(aCenter, 1.0);
  vec4 mvPosition = head;
#ifdef STREAK
  // A quad from the tail to the head, as wide as aSize.x, in view space. Its
  // direction follows the path as projected on screen, so the quad always
  // faces the camera and keeps its width, whatever the depth of the path.
  vec4 tail = modelViewMatrix * vec4(aTail, 1.0);
  vec4 headClip = projectionMatrix * head, tailClip = projectionMatrix * tail;
  vec2 along = head.xy - tail.xy;
  if (headClip.w > 1e-4 && tailClip.w > 1e-4) {
    along = (headClip.xy / headClip.w - tailClip.xy / tailClip.w) / vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  }
  float span = length(along);
  vec2 dir = span > 1e-7 ? along / span : vec2(0.0, 1.0);
  // Clockwise from the motion keeps the quad front-facing (x right, y along).
  vec2 side = vec2(dir.y, -dir.x);
  float t = position.y + 0.5;
  mvPosition = mix(tail, head, t);
  mvPosition.xy += side * position.x * aSize.x + dir * (t - 0.5) * aSize.x;
#else
  float c = cos(aSize.y), s = sin(aSize.y);
  mvPosition.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aSize.x;
#endif
  gl_Position = projectionMatrix * mvPosition;
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
#endif
}`;
const FRAGMENT = /* glsl */`
uniform sampler2D map;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 texel = texture2D(map, vUv);
  gl_FragColor = vec4(vColor.rgb * texel.rgb, vColor.a * texel.a);
  #include <colorspace_fragment>
#ifdef USE_FOG
  // Same order as three's own shaders: the fog colour is an output colour.
  float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
#ifdef ADDITIVE
  // Additive light fades into the night instead of turning fog-coloured.
  gl_FragColor.rgb *= 1.0 - fogFactor;
#else
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
#endif
}`;

let textures;
// Soft round, soft cloud and soft bar textures. The tests' fake 2D context
// has no gradients, so each falls back to stacked translucent shapes.
function fxTextures() {
  if (textures) return textures;
  const make = (size, draw) => {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (canvas) { canvas.width = canvas.height = size; draw(canvas.getContext('2d'), size); }
    const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const radial = (c, size, stops) => {
    const gradient = c.createRadialGradient?.(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (gradient?.addColorStop) { for (const [stop, color] of stops) gradient.addColorStop(stop, color); c.fillStyle = gradient; c.fillRect(0, 0, size, size); return; }
    for (let radius = size / 2; radius > 0; radius -= size / 16) {
      c.fillStyle = `rgba(255,255,255,${.1 * (1 - radius / (size / 2 + 1))})`; c.beginPath?.(); c.arc?.(size / 2, size / 2, radius, 0, Math.PI * 2); c.fill?.();
    }
  };
  textures = {
    glow: make(64, (c, size) => radial(c, size, [[0, 'rgba(255,255,255,1)'], [.2, 'rgba(255,255,255,.85)'], [.5, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']])),
    smoke: make(64, (c, size) => {
      radial(c, size, [[0, 'rgba(255,255,255,.85)'], [.55, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
      // A few lumps make the puff read as a cartoon cloud, not a disc.
      for (const [x, y, r] of [[.35, .4, .2], [.62, .38, .18], [.5, .62, .22]]) {
        const lump = c.createRadialGradient?.(x * size, y * size, 0, x * size, y * size, r * size);
        if (lump?.addColorStop) { lump.addColorStop(0, 'rgba(255,255,255,.5)'); lump.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = lump; c.fillRect(0, 0, size, size); }
      }
    }),
    streak: make(64, (c, size) => {
      const gradient = c.createLinearGradient?.(0, 0, size, 0);
      if (gradient?.addColorStop) {
        for (const [stop, alpha] of [[0, 0], [.3, .35], [.5, 1], [.7, .35], [1, 0]]) gradient.addColorStop(stop, `rgba(255,255,255,${alpha})`);
        c.fillStyle = gradient; c.fillRect(0, 0, size, size);
      } else { c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(size * .35, 0, size * .3, size); }
    }),
  };
  return textures;
}

function poolMaterial({ additive, streak, map }) {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: { ...(additive ? { ADDITIVE: '' } : {}), ...(streak ? { STREAK: '' } : {}) },
  });
  material.uniforms.map.value = map;
  return material;
}

class ParticlePool {
  constructor(name, capacity, { additive = true, streak = false, map, renderOrder = 0 } = {}) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index; geometry.setAttribute('position', plane.attributes.position); geometry.setAttribute('uv', plane.attributes.uv);
    const attribute = (key, size) => {
      const value = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(key, value); return value;
    };
    this.center = attribute('aCenter', 3); this.tail = attribute('aTail', 3); this.color = attribute('aColor', 4); this.size = attribute('aSize', 2);
    geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(geometry, poolMaterial({ additive, streak, map }));
    this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder; this.mesh.matrixAutoUpdate = false;
    this.capacity = capacity; this.particles = []; this.free = []; this.streak = streak; this.cursor = 0;
  }
  // Recycles the oldest particle when full: a busy wave never allocates.
  spawn(options) {
    let particle = this.free.pop();
    if (!particle) {
      if (this.particles.length >= this.capacity) {
        const index = this.cursor++ % this.particles.length;
        particle = this.particles[index]; this.particles[index] = this.particles[this.particles.length - 1]; this.particles.pop();
      } else particle = {};
    }
    Object.assign(particle, PARTICLE_DEFAULTS, options);
    particle.start ??= 0; this.particles.push(particle);
    return particle;
  }
  update(time) {
    let count = 0;
    const center = this.center.array, tail = this.tail.array, color = this.color.array, size = this.size.array;
    for (let index = 0; index < this.particles.length; index++) {
      const p = this.particles[index], age = time - p.start;
      if (age < 0) continue;
      if (age >= p.life || p.dead) {
        // Swap-remove: order inside an additive pool does not matter.
        this.free.push(p); this.particles[index] = this.particles[this.particles.length - 1]; this.particles.pop(); index--; continue;
      }
      const t = age / p.life;
      if (p.follow) p.follow(p, age, t);
      else motion(p, age, POINT), motion(p, Math.max(0, age - p.trail), TAIL);
      if (p.follow) { POINT.set(p.x, p.y, p.z); TAIL.set(p.tx ?? p.x, p.ty ?? p.y, p.tz ?? p.z); }
      const fade = t < p.fadeIn ? t / p.fadeIn : t > p.fadeOut ? Math.max(0, (1 - t) / (1 - p.fadeOut)) : 1;
      const k = p.ease ? Math.sqrt(t) : t, i3 = count * 3, i4 = count * 4;
      center[i3] = POINT.x; center[i3 + 1] = POINT.y; center[i3 + 2] = POINT.z;
      tail[i3] = TAIL.x; tail[i3 + 1] = TAIL.y; tail[i3 + 2] = TAIL.z;
      COLOR.setHex(p.color).lerp(COLOR_TO.setHex(p.colorTo ?? p.color), Math.min(1, t * p.colorSpeed));
      const strength = p.intensity * fade;
      color[i4] = COLOR.r * (this.mesh.material.blending === THREE.AdditiveBlending ? strength : 1);
      color[i4 + 1] = COLOR.g * (this.mesh.material.blending === THREE.AdditiveBlending ? strength : 1);
      color[i4 + 2] = COLOR.b * (this.mesh.material.blending === THREE.AdditiveBlending ? strength : 1);
      color[i4 + 3] = p.alpha * fade;
      size[count * 2] = p.size + (p.sizeTo - p.size) * k;
      size[count * 2 + 1] = p.rotation + p.spin * age;
      count++;
    }
    this.mesh.geometry.instanceCount = count;
    if (count) for (const attribute of [this.center, this.tail, this.color, this.size]) { attribute.needsUpdate = true; attribute.addUpdateRange?.(0, count * attribute.itemSize); }
    return count;
  }
  clear() { this.free.push(...this.particles); this.particles.length = 0; this.mesh.geometry.instanceCount = 0; }
}
const PARTICLE_DEFAULTS = Object.freeze({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, life: .3, start: 0, size: .1, sizeTo: .1,
  color: 0xffffff, colorTo: null, colorSpeed: 1, intensity: 1, alpha: 1, fadeIn: 0, fadeOut: .5, rotation: 0, spin: 0, trail: .03, ease: false,
  follow: null, dead: false, tx: undefined, ty: undefined, tz: undefined });
const POINT = new THREE.Vector3(), TAIL = new THREE.Vector3(), COLOR = new THREE.Color(), COLOR_TO = new THREE.Color();
function motion(p, age, target) {
  const travel = p.drag > 0 ? (1 - Math.exp(-p.drag * age)) / p.drag : age;
  return target.set(p.x + p.vx * travel, p.y + p.vy * travel - .5 * p.gravity * age * age, p.z + p.vz * travel);
}

export function createFx({ glow = 1600, streak = 700, smoke = 420, seed = 1729 } = {}) {
  const map = fxTextures();
  const root = new THREE.Group(); root.name = 'fx';
  const pools = {
    smoke: new ParticlePool('fxSmoke', smoke, { additive: false, map: map.smoke, renderOrder: 4 }),
    glow: new ParticlePool('fxGlow', glow, { additive: true, map: map.glow, renderOrder: 5 }),
    streak: new ParticlePool('fxStreak', streak, { additive: true, streak: true, map: map.streak, renderOrder: 6 }),
  };
  for (const pool of Object.values(pools)) root.add(pool.mesh);
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const spread = amount => (random() - .5) * 2 * amount;
  let now = 0;
  return {
    root, pools, random, spread,
    // True while a world drives update(); standalone previews drive it
    // through their effect handles instead.
    driven: false,
    get time() { return now; },
    glow: options => pools.glow.spawn(options),
    streak: options => pools.streak.spawn(options),
    smoke: options => pools.smoke.spawn(options),
    update(time) {
      if (!Number.isFinite(time)) return 0;
      now = time;
      return pools.smoke.update(time) + pools.glow.update(time) + pools.streak.update(time);
    },
    clear() { for (const pool of Object.values(pools)) pool.clear(); },
    count() { return pools.glow.particles.length + pools.streak.particles.length + pools.smoke.particles.length; },
  };
}

// The page has one scene: one engine shared by world, zombies and clients.
let sharedFx;
export function sharedEffects() { return sharedFx ??= createFx(); }
