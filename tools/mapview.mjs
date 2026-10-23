// Render a generated map to a PPM image for quick inspection.
//   node tools/mapview.mjs [campaign|sandbox] [seed] [out.ppm]
import { writeFileSync } from 'node:fs';
import { generateMap } from '../js/sim/mapgen.js';
import { TER } from '../js/config/world.js';

const [scenario = 'campaign', seed = '1', out = 'map.ppm'] = process.argv.slice(2);
const map = generateMap({ scenario, seed: +seed });
const S = 6, N = map.N;
const buf = Buffer.alloc(N * S * N * S * 3);
const put = (x, y, c) => { const o = (y * N * S + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; };

for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i, t = map.terrain[k];
  let c;
  if (t === TER.SEA) c = [40, 80, 130];
  else if (t === TER.LAKE) c = [60, 110, 160];
  else if (t === TER.RIVER) c = [70, 120, 170];
  else if (t === TER.MOUNTAIN) c = [110 + map.height[k] * 25, 105 + map.height[k] * 25, 100 + map.height[k] * 25];
  else if (map.owner[k]) c = map.forest[k] ? [45, 95, 45] : map.farmland[k] ? [170, 160, 80] : [95, 145, 70];
  else c = map.forest[k] ? [85, 85, 55] : [135, 130, 95];
  if (map.sand[k]) c = [210, 195, 140];
  if (map.road[k]) c = map.bridge[k] ? [150, 110, 70] : [90, 90, 90];
  if (map.townId[k] >= 0) c = map.towns[map.townId[k]].capital ? [240, 220, 120] : [230, 230, 230];
  if (map.border[k] && t === TER.LAND && !map.road[k]) c = [240, 200, 60];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(i * S + x, j * S + y, c);
}
for (const c of map.crossings) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(c.i * S + x, c.j * S + y, [230, 40, 40]);
for (const s of map.sites) for (let y = -S; y < 2 * S; y++) for (let x = -S; x < 2 * S; x++) {
  const px = s.i * S + x, py = s.j * S + y;
  if (px >= 0 && py >= 0 && px < N * S && py < N * S) put(px, py, [120, 20, 20]);
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${N * S} ${N * S} 255\n`), buf]));
console.log(`${out}: ${map.towns.length} towns, ${map.crossings.length} crossings, ${map.sites.length} sites`);
console.log(map.towns.map((t) => `${t.name}(${t.specialty})`).join(', '));
