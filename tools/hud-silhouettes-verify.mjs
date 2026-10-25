// Validate the baked deliverables without a browser or image dependency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const root=new URL('../art/hud-silhouettes/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(manifest.assets.length,30);
for(const source of manifest.sources)assert.equal(hash(readFileSync(new URL('../'+source.path,import.meta.url))),source.sha256,source.path+' changed: regenerate');
const masks=new Map();
for(const a of manifest.assets){
  const png=readFileSync(new URL(a.path,root));
  assert.deepEqual(readFileSync(new URL('../public/hud-silhouettes/'+a.path,import.meta.url)),png,'served asset matches '+a.path);
  assert.equal(hash(png),a.sha256,a.path);
  assert.equal(png.length,a.bytes);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),a.width);assert.equal(png.readUInt32BE(20),a.height);
  assert.equal(png[24],8);assert.equal(png[25],6);
  const idats=[];
  for(let at=8;at<png.length;){
    const length=png.readUInt32BE(at),end=at+8+length;
    assert.ok(end+4<=png.length,'chunk bounds');
    let crc=0xffffffff;
    for(const byte of png.subarray(at+4,end)){
      crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    assert.equal((crc^0xffffffff)>>>0,png.readUInt32BE(end),'PNG checksum');
    if(png.toString('ascii',at+4,at+8)==='IDAT')idats.push(png.subarray(at+8,end));
    at=end+4;
  }
  const rows=inflateSync(Buffer.concat(idats)),alpha=new Uint8Array(a.width*a.height);
  assert.equal(rows.length,(a.width*4+1)*a.height);
  for(let y=0;y<a.height;y++){
    assert.equal(rows[y*(a.width*4+1)],0,'unfiltered PNG row');
    for(let x=0;x<a.width;x++){
      const offset=y*(a.width*4+1)+1+x*4,v=rows[offset+3];alpha[y*a.width+x]=v;
      assert.deepEqual([...rows.subarray(offset,offset+3)],[255,255,255]);
      if(x<8||y<8||x>=a.width-8||y>=a.height-8)assert.equal(v,0,'uncropped silhouette '+a.path);
    }
  }
  assert.equal(hash(alpha),a.alphaSha256);
  assert.ok(alpha.some(v=>v===255),'solid interior');
  assert.ok(alpha.some(v=>v>0&&v<255),'antialiased edge');
  assert.ok(a.triangles>0&&a.meshCount>0);
  masks.set(a.path,alpha);
}
const filled=masks.get('shared/grenade.png'),outline=masks.get('shared/grenade-outline.png');
assert.ok(outline.reduce((a,b)=>a+b,0)<filled.reduce((a,b)=>a+b,0));
outline.forEach((v,i)=>assert.ok(v<=filled[i],'outline stays within real silhouette'));
assert.equal(manifest.assets.filter(a=>a.style==='famille').length,14);
assert.equal(manifest.assets.filter(a=>a.style==='frisson').length,14);
console.log('30 PNG validés : provenance, empreintes, CRC, transparence, anticrénelage, marges et contour de grenade.');
