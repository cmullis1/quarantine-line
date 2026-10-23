// Vehicles keep to the roads (R15.6: cars were driving across the grass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnBus } from '../js/sim/entities.js';

// Every point along the route between its first and last road waypoints lies on a road tile.
function offRoad(sim, pts) {
  const bad = [];
  for (let n = 1; n < pts.length - 1; n++) {
    const [ax, az] = pts[n - 1], [bx, bz] = pts[n];
    if (n === 1) continue; // the leg from the start onto the road
    for (let t = 0; t <= 1; t += 0.05) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      // A point exactly on a tile corner touches four tiles; it is on the road if any of them is.
      const on = [[0, 0], [0.01, 0.01], [-0.01, 0.01], [0.01, -0.01], [-0.01, -0.01]].some(([ox, oz]) => sim.map.road[Math.floor(z + oz) * sim.N + Math.floor(x + ox)]);
      if (!on) bad.push([x.toFixed(1), z.toFixed(1)]);
    }
  }
  return bad;
}

for (const [mode, seed] of [['campaign', 1], ['sandbox', 4]]) {
  test(`routes between every pair of towns stay on the road (${mode})`, () => {
    const sim = new Sim({ seed, mode });
    const towns = sim.map.towns;
    let routes = 0;
    for (const a of towns) for (const b of towns) {
      if (a === b) continue;
      const p = sim.nav.roadPath(a.x, a.z, b.x, b.z);
      assert.ok(p, `${a.name} → ${b.name} has a road route`);
      const bad = offRoad(sim, [[a.x, a.z], ...p]);
      assert.deepEqual(bad, [], `${a.name} → ${b.name} leaves the road at ${bad.slice(0, 3)}`);
      routes++;
    }
    assert.ok(routes > 20);
  });
}

test('an evacuation bus is routed along the roads', () => {
  const sim = new Sim({ seed: 1 });
  const v = spawnBus(sim, 1, 0, 100, 0);
  assert.deepEqual(offRoad(sim, [[v.x, v.z], ...v.path]), []);
});
