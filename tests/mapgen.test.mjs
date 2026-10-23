import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../js/sim/mapgen.js';
import { Nav } from '../js/sim/nav.js';
import { TER, SPECIALTIES, SANDBOX_TOWN_NAMES } from '../js/config/world.js';
import { MAP_SIZE, REAL_SECONDS_PER_DAY } from '../js/config/balance.js';

test('balance constants', () => {
  assert.equal(MAP_SIZE, 144);
  assert.equal(REAL_SECONDS_PER_DAY, 36);
});

function checkInvariants(map, label) {
  const nav = new Nav(map);
  const cap = map.towns.find((t) => t.capital);
  assert.ok(cap, `${label}: has a capital`);
  for (const t of map.towns) {
    assert.ok(t.tiles.length > 0, `${label}: ${t.name} has tiles`);
    const p = nav.path(cap.x, cap.z, t.x, t.z);
    assert.ok(p, `${label}: ${t.name} reachable from capital`);
  }
  assert.ok(map.crossings.length >= 4, `${label}: at least 4 crossings (got ${map.crossings.length})`);
  for (const c of map.crossings) {
    const s = map.sites[c.siteId];
    assert.ok(nav.path(s.x, s.z, c.oi + 0.5, c.oj + 0.5), `${label}: site ${s.name} can walk to its crossing`);
    assert.ok(nav.path(c.x, c.z, cap.x, cap.z), `${label}: crossing ${c.id} reaches the capital`);
  }
  for (let k = 0; k < map.N * map.N; k++) {
    if (map.road[k] && (map.terrain[k] === TER.RIVER || map.terrain[k] === TER.LAKE)) assert.equal(map.bridge[k], 1, `${label}: road over water is a bridge`);
    if (map.road[k]) assert.notEqual(map.terrain[k], TER.MOUNTAIN, `${label}: no road through mountain`);
  }
}

test('campaign map invariants', () => {
  const map = generateMap({ scenario: 'campaign' });
  assert.equal(map.towns.length, 10);
  assert.equal(map.crossings.length, 6);
  assert.equal(map.towns[0].name, 'Valdgrad');
  assert.ok(map.terrain.some((t) => t === TER.MOUNTAIN), 'has mountains');
  assert.ok(map.terrain.some((t) => t === TER.RIVER), 'has a river');
  assert.ok(map.terrain.some((t) => t === TER.LAKE), 'has a lake');
  assert.ok(map.bridge.some((b) => b), 'has bridges');
  checkInvariants(map, 'campaign');
});

test('campaign: foreign cities sit well beyond the border', () => {
  const map = generateMap({ scenario: 'campaign' });
  const N = map.N;
  for (const s of map.sites) {
    let d = Infinity;
    for (let k = 0; k < N * N; k++) if (map.owner[k]) d = Math.min(d, Math.max(Math.abs((k % N) - s.i), Math.abs(((k / N) | 0) - s.j)));
    assert.ok(d >= 18, `${s.name} is ${d} tiles from the border`);
  }
});

test('campaign: Sorrel farms the southern plain, Harn mines under the ridge', () => {
  const map = generateMap({ scenario: 'campaign' });
  const town = (name) => map.towns.find((t) => t.name === name);
  assert.equal(town('Sorrel')?.specialty, 'farmland');
  assert.equal(town('Harn')?.specialty, 'mine');
  assert.deepEqual(SPECIALTIES.mine.produce, { ammo: 0.6, funds: 0.4 });
  assert.equal(SPECIALTIES.railyard.radius, 20);
  assert.equal(map.sites.find((s) => s.name === 'Orsk')?.townId, town('Sorrel').id);
});

test('campaign map is deterministic', () => {
  const a = generateMap({ scenario: 'campaign' }), b = generateMap({ scenario: 'campaign' });
  assert.deepEqual(a.terrain, b.terrain);
  assert.deepEqual(a.road, b.road);
});

test('sandbox maps satisfy invariants across 30 seeds, with 8–10 towns', () => {
  for (let s = 1; s <= 30; s++) {
    const map = generateMap({ scenario: 'sandbox', seed: s });
    assert.ok(SANDBOX_TOWN_NAMES.includes(map.towns[0].name), `sandbox ${s}: generated, not the campaign fallback`);
    assert.ok(map.towns.length >= 8 && map.towns.length <= 10, `sandbox ${s}: ${map.towns.length} towns`);
    checkInvariants(map, `sandbox ${s}`);
  }
});

test('border metrics in design range', () => {
  const map = generateMap({ scenario: 'campaign' });
  let border = 0;
  for (let k = 0; k < map.N * map.N; k++) if (map.border[k] && map.terrain[k] === TER.LAND) border++;
  // Ledger (map size): 185 wallable land-border tiles on the 144² map, 156 on 112² (excluding mountains and water).
  console.log(`campaign wallable border tiles: ${border}`);
  assert.ok(border > 60 && border < 220, `border tiles ${border}`);
});

test('mountain ridges are continuous walls broken only at road passes', () => {
  for (const [scenario, seed] of [['campaign', 1], ['sandbox', 3], ['sandbox', 7], ['sandbox', 11]]) {
    const map = generateMap({ scenario, seed });
    const N = map.N;
    // Barrier = mountains plus the carved pass tiles (road tiles and their neighbours near mountains).
    const nearMountain = (i, j, r) => { for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ni = i + di, nj = j + dj; if (ni >= 0 && nj >= 0 && ni < N && nj < N && map.terrain[nj * N + ni] === TER.MOUNTAIN) return true; } return false; };
    const barrier = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) {
      const i = k % N, j = (k / N) | 0;
      if (map.terrain[k] === TER.MOUNTAIN) barrier[k] = 1;
      // A river cutting the ridge is a deliberate gorge (the dead can wade it); count it as part of the line.
      else if (map.terrain[k] === TER.RIVER && nearMountain(i, j, 2)) barrier[k] = 1;
      else if (nearMountain(i, j, 2) && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => map.road[(j + dj) * N + i + di])) barrier[k] = 1;
    }
    // Count 8-connected components of the barrier that contain at least 6 mountain tiles.
    const seen = new Uint8Array(N * N);
    let big = 0;
    for (let k = 0; k < N * N; k++) {
      if (!barrier[k] || seen[k]) continue;
      let size = 0, mountains = 0;
      const stack = [k]; seen[k] = 1;
      while (stack.length) {
        const q = stack.pop(); size++;
        if (map.terrain[q] === TER.MOUNTAIN) mountains++;
        const i = q % N, j = (q / N) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = nj * N + ni;
          if (barrier[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
      if (mountains >= 6) big++;
    }
    assert.ok(big <= 1, `${scenario} ${seed}: ridge split into ${big} pieces`);
  }
});

// 4-connected components of the tiles `pred` accepts, as arrays of tile indices.
function components4(map, pred) {
  const N = map.N, seen = new Uint8Array(N * N), out = [];
  for (let k = 0; k < N * N; k++) {
    if (!pred(k) || seen[k]) continue;
    const comp = [], stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const i = q % N, j = (q / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (pred(nk) && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    out.push(comp);
  }
  return out;
}

const riverMaps = () => [['campaign', generateMap({ scenario: 'campaign' })],
  ...Array.from({ length: 30 }, (_, s) => [`sandbox ${s + 1}`, generateMap({ scenario: 'sandbox', seed: s + 1 })])];

test('rivers are 4-connected channels: no tile hangs on a corner, one river per map', () => {
  for (const [label, map] of riverMaps()) {
    const N = map.N, water = (k) => map.terrain[k] === TER.RIVER || map.terrain[k] === TER.LAKE || map.terrain[k] === TER.SEA;
    for (let k = 0; k < N * N; k++) {
      if (map.terrain[k] !== TER.RIVER) continue;
      const i = k % N, j = (k / N) | 0;
      const linked = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const ni = i + di, nj = j + dj;
        return ni < 0 || nj < 0 || ni >= N || nj >= N || water(nj * N + ni) || map.bridge[nj * N + ni];
      });
      assert.ok(linked, `${label}: river tile (${i},${j}) touches the rest only at a corner`);
    }
    // A lake the river runs through joins it; any river tiles outside that one body would be a broken piece.
    const bodies = components4(map, (k) => map.terrain[k] === TER.RIVER || map.terrain[k] === TER.LAKE)
      .filter((c) => c.some((k) => map.terrain[k] === TER.RIVER));
    assert.ok(bodies.length <= 1, `${label}: river split into ${bodies.length} pieces`);
  }
});

test('bridges: every bridge tile is a road, and each crossing is one run over water that ends on a bank road', () => {
  for (const [label, map] of riverMaps()) {
    const N = map.N;
    for (let k = 0; k < N * N; k++) {
      if (!map.bridge[k]) {
        const i = k % N, j = (k / N) | 0;
        const decked = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => i + di >= 0 && j + dj >= 0 && i + di < N && j + dj < N && map.bridge[(j + dj) * N + i + di]).length;
        assert.ok(!map.road[k] || decked < 2, `${label}: road tile ${k} is a gap between two bridge tiles`);
        continue;
      }
      assert.equal(map.road[k], 1, `${label}: bridge tile ${k} is a road tile`);
    }
    for (const run of components4(map, (k) => map.bridge[k] === 1)) {
      // A bank tile between two bridge tiles of a stepping road is decked too, but every run crosses real water.
      assert.ok(run.some((k) => map.terrain[k] === TER.RIVER || map.terrain[k] === TER.LAKE), `${label}: bridge run at tile ${run[0]} crosses no water`);
      const banks = run.filter((k) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const ni = (k % N) + di, nj = ((k / N) | 0) + dj;
        return ni >= 0 && nj >= 0 && ni < N && nj < N && map.road[nj * N + ni] && !map.bridge[nj * N + ni];
      }));
      assert.ok(banks.length >= 1, `${label}: bridge run at tile ${run[0]} reaches no bank road`);
    }
  }
});
