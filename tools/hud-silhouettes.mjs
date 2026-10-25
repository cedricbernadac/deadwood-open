// Orthographic silhouettes of the shipped meshes. No hand-drawn contours,
// browser/GPU, external renderer or extra dependency: project triangles,
// rasterize their union at 4x, then encode white RGBA PNG masks.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { importPublicModule } from '../test/helpers/public-modules.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, process.argv[2] ?? 'art/hud-silhouettes');
const world = await importPublicModule('world.js');
const { WEAPON_TYPES, anchorNameFor } = await importPublicModule('frisson/weapon-recipes.js');
const { weaponsFromGlb, createWeaponsStyle, disposeWeapons } = await importPublicModule('frisson/weapons.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const { weaponLabel, setLanguage } = await importPublicModule('i18n.js');
setLanguage('fr');
const SOURCES = ['public/world.js', 'public/frisson/weapons.js', 'public/frisson/weapon-recipes.js',
  'public/frisson/weapons.glb', 'public/frisson/glb.js', 'public/mesh-merge.js', 'public/i18n.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRevision = execFileSync('git', ['log', '-1', '--format=%H', '--', ...SOURCES], { cwd: ROOT, encoding: 'utf8' }).trim();
const manifest = { version: 1, sourceRevision, raster: { supersampling: 4, padding: 8, color: 'white alpha mask', projection: 'orthographic triangle union' },
  sources: SOURCES.map(path => ({ path, sha256: hash(readFileSync(resolve(ROOT, path))) })), assets: [] };

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(alpha, width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    rows[at] = rows[at + 1] = rows[at + 2] = 255; rows[at + 3] = alpha[y * width + x];
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function projectedMesh(root, type) {
  // Cancel only the FPS ready pose. Keep all mesh vertices, relative transforms,
  // material groups and the style's actual replacements/dressing.
  root.updateMatrixWorld(true);
  const name = type === 'grenade' ? null : anchorNameFor(type);
  const anchor = name ? root.getObjectByName(name) : root;
  if (!anchor) throw new Error('Missing production anchor: '+type);
  const inverse = anchor.matrixWorld.clone().invert();
  const broadBlade = ['katana', 'fireaxe', 'hammer'].includes(type);
  const plane = type === 'grenade' ? 'XY (pin and lever front)' : broadBlade ? '-Z, -X (broad melee face)' : '-Z, Y (weapon side)';
  const triangles = [], meshes = [];
  root.traverseVisible(node => {
    if (!node.isMesh || node.isSkinnedMesh || node.isInstancedMesh) {
      if (node.isSkinnedMesh || node.isInstancedMesh) throw new Error('Unsupported animated mesh: '+type);
      return;
    }
    const geometry = node.geometry, position = geometry.getAttribute('position');
    const transform = inverse.clone().multiply(node.matrixWorld);
    const points = Array.from({ length: position.count }, (_, i) => {
      const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
      return type === 'grenade' ? [p.x, p.y] : [-p.z, broadBlade ? -p.x : p.y];
    });
    const index = geometry.index, count = index?.count ?? position.count;
    const start = geometry.drawRange.start, end = Math.min(count, start + geometry.drawRange.count);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    let emitted = 0;
    for (const group of groups) {
      const mat = materials[group.materialIndex ?? 0];
      if (!mat || mat.visible === false || mat.opacity === 0) continue;
      for (let i = Math.max(start, group.start); i + 2 < Math.min(end, group.start + group.count); i += 3) {
        triangles.push([0,1,2].map(j => points[index ? index.getX(i+j) : i+j])); emitted++;
      }
    }
    meshes.push({ name: node.name || '(unnamed)', triangles: emitted });
  });
  if (!triangles.length) throw new Error('Empty model '+type);
  return { triangles, meshes, plane };
}
function rasterize(triangles, width, height) {
  const SS = 4, W = width*SS, H = height*SS, pixels = new Uint8Array(W*H);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) for (const [x,y] of triangle) {
    bounds[0]=Math.min(bounds[0],x); bounds[1]=Math.min(bounds[1],y);
    bounds[2]=Math.max(bounds[2],x); bounds[3]=Math.max(bounds[3],y);
  }
  const scale = Math.min((width-16)/(bounds[2]-bounds[0]), (height-16)/(bounds[3]-bounds[1]));
  const cx=(bounds[0]+bounds[2])/2, cy=(bounds[1]+bounds[3])/2;
  const transform = ([x,y]) => [(width/2+(x-cx)*scale)*SS,(height/2-(y-cy)*scale)*SS];
  for (const triangle of triangles) {
    const points = triangle.map(transform);
    const y0=Math.max(0,Math.ceil(Math.min(...points.map(p=>p[1]))-.5));
    const y1=Math.min(H-1,Math.floor(Math.max(...points.map(p=>p[1]))-.5));
    for(let y=y0;y<=y1;y++){
      const scan=y+.5, intersections=[];
      for(let i=0;i<3;i++){
        const a=points[i],b=points[(i+1)%3];
        if((a[1]<=scan && b[1]>scan)||(b[1]<=scan && a[1]>scan))
          intersections.push(a[0]+(scan-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      }
      if(intersections.length<2)continue;
      const left=Math.max(0,Math.ceil(Math.min(...intersections)-.5));
      const right=Math.min(W-1,Math.floor(Math.max(...intersections)-.5));
      if(right>=left)pixels.fill(255,y*W+left,y*W+right+1);
    }
  }
  const alpha=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let sum=0;for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++)sum+=pixels[(y*SS+sy)*W+x*SS+sx];
    alpha[y*width+x]=Math.round(sum/(SS*SS));
  }
  return { alpha, bounds, pixelsPerUnit: scale };
}
function outline(alpha,width,height,radius=4){
  const result=new Uint8Array(alpha.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=y*width+x;if(!alpha[at])continue;
    let min=alpha[at];
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx*dx+dy*dy>radius*radius)continue;
      min=Math.min(min,x+dx<0||x+dx>=width||y+dy<0||y+dy>=height?0:alpha[(y+dy)*width+x+dx]);
    }
    result[at]=alpha[at]-min;
  }
  return result;
}
let written=0;
function save(path,bytes){mkdirSync(dirname(path),{recursive:true});let existing;try{existing=readFileSync(path);}catch{}if(!existing?.equals(Buffer.from(bytes))){writeFileSync(path,bytes);written++;}}
function exportModel(root,type,style){
  const width=type==='grenade'?128:384,height=type==='grenade'?192:128;
  const projected=projectedMesh(root,type),render=rasterize(projected.triangles,width,height);
  const variants=type==='grenade'?{filled:render.alpha,outline:outline(render.alpha,width,height)}:{filled:render.alpha};
  for(const [variant,alpha]of Object.entries(variants)){
    const relative=style+'/'+type+(variant==='outline'?'-outline':'')+'.png';
    const bytes=png(alpha,width,height);save(resolve(OUT,relative),bytes);
    // Default regeneration also updates the lightweight assets served by the HUD.
    if (!process.argv[2]) save(resolve(ROOT,'public/hud-silhouettes',relative),bytes);
    manifest.assets.push({id:type,style,variant,path:relative,label:type==='grenade'?'Grenade':weaponLabel(type),width,height,
      bytes:bytes.length,sha256:hash(bytes),alphaSha256:hash(alpha),geometrySha256:hash(JSON.stringify(projected.triangles)),
      coverage:alpha.reduce((n,v)=>n+v,0)/(255*width*height),bounds:render.bounds,pixelsPerUnit:render.pixelsPerUnit,
      plane:projected.plane,meshCount:projected.meshes.length,triangles:projected.triangles.length,meshes:projected.meshes});
  }
}
const parsed=weaponsFromGlb(readGlb(readFileSync(resolve(ROOT,'public/frisson/weapons.glb'))));
const style=createWeaponsStyle({roots:parsed,quality:'high'});
for(const theme of ['famille','frisson']){
  for(const type of WEAPON_TYPES){
    const gun=world.createHeldWeapon(type);
    if(theme==='frisson')style.dress(gun,{type,view:'rack'});
    exportModel(gun,type,theme);
  }
}
// This is exactly grenadeModel(), also called by createLateSupplyPost().
exportModel(world.createGrenadeProjectile(),'grenade','shared');
save(resolve(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
style.dispose();disposeWeapons(parsed);
console.log(JSON.stringify({assets:manifest.assets.length,bytes:manifest.assets.reduce((sum,a)=>sum+a.bytes,0),written,out:OUT}));
