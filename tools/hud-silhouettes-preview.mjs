import { readFileSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WEAPONS } from '../simulation.mjs';
const root=new URL('../art/hud-silhouettes/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const data={weapons:{},grenade:{}};
for(const a of manifest.assets){
  const src='data:image/png;base64,'+readFileSync(new URL(a.path,root)).toString('base64');
  if(a.id==='grenade'){data.grenade[a.variant]=src;continue;}
  const w=WEAPONS[a.id];
  data.weapons[a.id]??={label:a.label,magazine:w.magazine,reserve:w.reserve,melee:!!w.melee};
  data.weapons[a.id][a.style]=src;
}
const template=readFileSync(new URL('hud-silhouettes-preview.html',import.meta.url),'utf8');
const result=template.replace('__HUD_DATA__',JSON.stringify(data));
const out=new URL('preview.html',root);writeFileSync(out,result);
console.log(fileURLToPath(out)+' ('+Buffer.byteLength(result)+' bytes)');
