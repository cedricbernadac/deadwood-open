// Technical exports only: preserve the original image and alpha; no repainting.
// Set DEADWOOD_SHARP_MODULE to a bundled/installed sharp module when necessary.
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sharp = createRequire(import.meta.url)(process.env.DEADWOOD_SHARP_MODULE || 'sharp');
const source = new URL('../assets/bonus-icons/source/', import.meta.url);
const target = new URL('../public/bonus-icons/', import.meta.url);
await mkdir(target, { recursive: true });
const exports = [];
for (const name of (await readdir(source)).filter(name => name.endsWith('.png')).sort()) {
  const input = await readFile(new URL(name, source));
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha) throw Error(`Missing transparent alpha: ${name}`);
  const outputName = name.replace(/\.png$/, '.webp');
  const output = await sharp(input).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ lossless: true, effort: 6 }).toBuffer();
  await writeFile(new URL(outputName, target), output);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  exports.push({ kind: name.slice(0, -4), original: `source/${name}`, sourceWidth: meta.width, sourceHeight: meta.height,
    sourceSha256: digest(input), asset: `public/bonus-icons/${outputName}`, width: 128, height: 128, alpha: true,
    bytes: output.length, sha256: digest(output) });
}
await writeFile(new URL('../assets/bonus-icons/exports.json', import.meta.url), JSON.stringify({ exports }, null, 2) + '\n');
console.log(`${exports.length} transparent icons exported (${exports.reduce((sum, item) => sum + item.bytes, 0)} bytes).`);
