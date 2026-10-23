// Basic Training. Each step is the real next thing a player does; it completes when they do it.
// `target` points the highlight at a DOM element (CSS selector) or a world position.
// `setup(app, mem)` runs once when the step starts; `done(app, mem)` is polled; `info` steps need Continue.
import { spawnRefugee } from '../sim/entities.js';
import { scheduleHorde } from '../sim/systems/world.js';

const kirsk = (sim) => sim.map.crossings.find((c) => sim.map.sites[c.siteId].name === 'Kirsk') || sim.map.crossings[0];
const kessel = (sim) => sim.map.towns.find((t) => t.name === 'Kessel') || sim.map.towns[1];
const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) < r;
// Infantry on the field plus infantry queued anywhere.
const infantryOrdered = (sim) => sim.state.ents.units.filter((u) => u.type === 'infantry').length + sim.state.ents.buildings.reduce((n, b) => n + (b.queue?.filter((t) => t === 'infantry').length || 0), 0);

export const TUTORIAL = [
  {
    id: 'pan', title: 'Look around', text: 'You govern Valdmark. Move the camera with WASD or the arrow keys (or hold the middle mouse button and drag).',
    keys: ['W', 'A', 'S', 'D'],
    setup: (app, m) => { m.x = app.view.view.x; m.z = app.view.view.z; },
    done: (app, m) => Math.hypot(app.view.view.x - m.x, app.view.view.z - m.z) > 6,
  },
  {
    id: 'zoom', title: 'Zoom and rotate', text: 'Scroll the mouse wheel to zoom. Press Q or E to rotate the view a quarter turn.',
    keys: ['Wheel', 'Q', 'E'],
    setup: (app, m) => { m.zoom = app.view.view.zoomT; m.yaw = app.view.view.yawT; },
    done: (app, m) => Math.abs(app.view.view.zoomT - m.zoom) > 0.2 && Math.abs(app.view.view.yawT - m.yaw) > 0.5,
  },
  {
    id: 'town', title: 'Your towns', text: 'Click the label over Valdgrad, the capital. The panel shows its people, hidden-infection reports and what it produces.',
    target: { dom: '.clabel.cap' },
    done: (app) => app.sel.town != null,
  },
  {
    id: 'select', title: 'Your troops', text: 'Drag a box around the soldiers near the HQ to select them.',
    target: { world: (sim) => { const u = sim.state.ents.units[0]; return u ? [u.x, u.z] : null; } },
    setup: (app) => { const u = app.sim.state.ents.units[0]; if (u) app.jumpTo(u.x, u.z); },
    done: (app) => app.sel.units.length >= 3,
  },
  {
    id: 'move', title: 'Giving orders', text: 'Right-click the ground to move them. They fire at anything in range on the way.',
    keys: ['Right-click'],
    done: (app) => app.sel.units.some((id) => app.sim.byId(id)?.path),
  },
  {
    id: 'train', title: 'Training troops', text: 'New troops come from your HQ (later also a Barracks and a Helipad). Press B, open the ARMY tab and train an Infantry Squad. You can also click the HQ and train from its panel.',
    target: { dom: '#build' }, keys: ['B'],
    setup: (app, m) => { m.n = infantryOrdered(app.sim); app.ui.build.tab = 'army'; app.ui.build.render(); },
    done: (app, m) => infantryOrdered(app.sim) > m.n,
  },
  {
    id: 'farm', title: 'Feeding the country', text: 'Press B for the build menu, open ECONOMY and place a Farm. Farms on farmland make 50% more food. Farms, factories and labs need workers from your towns: the 👷 counter at the top shows how many are in use and available.',
    target: { dom: '#build' }, keys: ['B'],
    setup: (app, m) => { m.n = app.sim.state.ents.buildings.filter((b) => b.type === 'farm').length; app.ui.build.tab = 'economy'; app.ui.build.render(); },
    done: (app, m) => app.sim.state.ents.buildings.filter((b) => b.type === 'farm').length > m.n,
  },
  {
    id: 'economy', title: 'Resources', info: true,
    text: 'Funds, food, ammo, manpower, authority and research are along the top. Hover any of them to see where it comes from and where it goes.',
    target: { dom: '#top .res' },
  },
  {
    id: 'checkpoint', title: 'The border', text: 'Refugees and the dead come along the roads. Build a Checkpoint (DEFENCE tab) on the road at the gold border line, here.',
    target: { world: (sim) => { const c = kirsk(sim); return [c.x, c.z]; } },
    setup: (app) => { const c = kirsk(app.sim); app.jumpTo(c.x, c.z - 2); app.sim.state.res.funds += 200; app.sim.state.res.manpower += 40; app.ui.build.tab = 'defense'; app.ui.build.setOpen(true); },
    done: (app) => { const c = kirsk(app.sim); const b = app.sim.buildingAt(c.i, c.j); return !!b && b.type === 'checkpoint'; },
  },
  {
    id: 'wall', title: 'Walls', text: 'Select Wall and drag a line across the pass beside the checkpoint. The dead go around walls if they can, so close the gap.',
    target: { world: (sim) => { const c = kirsk(sim); return [c.x, c.z]; } },
    setup: (app, m) => { m.n = app.sim.state.ents.buildings.filter((b) => b.type === 'wall').length; app.ui.build.tab = 'defense'; app.ui.build.setOpen(true); },
    done: (app, m) => app.sim.state.ents.buildings.filter((b) => b.type === 'wall').length >= m.n + 2,
  },
  {
    id: 'tower', title: 'Watchtowers', text: 'Build a Watchtower just behind the wall. Towers shoot anything in range. You can see the range ring while placing.',
    setup: (app, m) => { m.n = app.sim.state.ents.buildings.filter((b) => b.type === 'tower').length; app.ui.build.tab = 'defense'; app.ui.build.setOpen(true); },
    done: (app, m) => app.sim.state.ents.buildings.filter((b) => b.type === 'tower').length > m.n,
  },
  {
    id: 'stance', title: 'Who gets in', text: 'People are walking to this crossing. Open POLICY (right) and set the border to SCREENED: only crossings with a checkpoint let people in, after checking them.',
    target: { dom: '#border-seg, .seg' },
    setup: (app) => {
      app.ui.panels.show('policy');
      const sim = app.sim, c = kirsk(sim);
      for (const b of sim.state.ents.buildings) if (!b.built) { b.built = true; b.progress = 1; }
      for (let k = 0; k < 5; k++) { const r = spawnRefugee(sim, c.siteId); r.x = r.gx + sim.range(-1, 1); r.z = r.gz + sim.range(-1, 1); r.path = []; r.infected = k === 1; r.incub = 200; }
      sim.state.cooldowns.border = 0;
    },
    done: (app) => app.sim.state.border === 'screened',
  },
  {
    id: 'screening', title: 'Screening', text: 'Watch the checkpoint process the queue. Some carry the infection. Screening catches most of them, never all. Speed up with + if you like.',
    keys: ['+'],
    target: { world: (sim) => { const c = kirsk(sim); return [c.x, c.z]; } },
    setup: (app, m) => { m.a = app.sim.state.stats.admitted + app.sim.state.stats.turnedAway; },
    done: (app, m) => app.sim.state.stats.admitted + app.sim.state.stats.turnedAway >= m.a + 2,
  },
  {
    id: 'outbreak', title: 'An outbreak', text: 'Kessel is reporting cases. Select your Quarantine Team (yellow suits) and move it into Kessel.',
    target: { world: (sim) => { const t = kessel(sim); return [t.x, t.z]; } },
    setup: (app) => {
      const sim = app.sim, t = kessel(sim), st = sim.state.towns[t.id];
      st.infected = 160; st.hist = Array(14).fill(160); st.reported = 64; st.alerted = true;
      app.jumpTo(t.x, t.z);
      sim.alert('outbreak', `Outbreak confirmed in ${t.name}. Send a Quarantine Team.`, t.x, t.z, 'bad');
    },
    done: (app) => { const t = kessel(app.sim); return app.sim.state.ents.units.some((u) => u.type === 'hazmat' && near(u, t.x, t.z, t.r + 2.5)); },
  },
  {
    id: 'quarantine', title: 'Quarantine', text: 'Click Kessel and press Quarantine. It slows the spread to other towns but costs income and a little trust every hour.',
    target: { dom: '#selection' },
    done: (app) => app.sim.state.towns[kessel(app.sim).id].quarantine,
  },
  {
    id: 'reports', title: 'What you can see', info: true,
    text: 'Reported cases lag half a day and only show what you can detect. Quarantine teams, hospitals and testing raise detection. By the time a town reports trouble, it is bigger than it looks.',
    target: { dom: '#selection' },
  },
  {
    id: 'law', title: 'Laws', text: 'Open POLICY and sign the Curfew into law. Laws are permanent. Each chain gets harsher, and costs are listed before you sign.',
    target: { dom: '#right' },
    setup: (app) => { app.ui.panels.show('policy'); app.sim.state.res.authority = Math.max(app.sim.state.res.authority, 20); },
    done: (app) => app.sim.hasLaw('curfew'),
  },
  {
    id: 'trust', title: 'Trust and Order', info: true,
    text: 'TRUST is cooperation, ORDER is compliance. Laws like Curfew buy order with trust. If either hits zero, your government falls. Hover the meters to see what is moving them.',
    target: { dom: '#top .meters' },
  },
  {
    id: 'research', title: 'Research', text: 'Open RESEARCH and choose Rapid Screening. Labs (and the university in Lenz) produce the points.',
    target: { dom: '#right' },
    setup: (app) => { app.ui.panels.show('research'); app.sim.state.res.research += 10; },
    done: (app) => !!app.sim.state.research.active || app.sim.hasTech('m1'),
  },
  {
    id: 'cabinet', title: 'The cabinet', text: 'A minister has a request. Open CABINET and promise it. Keep promises for authority and trust; break them and both suffer.',
    target: { dom: '#right' },
    setup: (app) => {
      const s = app.sim.state;
      s.cabinet.requests.push({ id: app.sim.newId(), defId: 'infantry', minister: 'defence', p: { base: app.sim.state.ents.units.filter((u) => u.type === 'infantry').length }, status: 'offered', offeredAt: s.time, until: s.time + 48 });
      app.ui.panels.show('cabinet');
    },
    done: (app) => app.sim.state.cabinet.requests.some((r) => r.status === 'accepted'),
  },
  {
    id: 'horde', title: 'A horde', text: 'A horde is coming down the Kirsk pass. Move your soldiers behind the wall and hold. The red dashes show where they are heading.',
    target: { world: (sim) => { const c = kirsk(sim); return [c.x, c.z]; } },
    setup: (app, m) => {
      const sim = app.sim, c = kirsk(sim);
      const h = scheduleHorde(sim, { size: 16, siteId: c.siteId, lead: 1, label: 'Training horde' });
      h.x = c.oi + 0.5 + c.dx * 8; h.z = c.oj + 0.5 + c.dz * 8;
      m.horde = h.id;
      app.jumpTo(c.x, c.z);
    },
    done: (app, m) => { const s = app.sim.state; const h = s.hordes.find((x) => x.id === m.horde); return !!h && h.spawned > 0 && !s.ents.dead.some((z) => z.horde === m.horde && !z.gone); },
  },
  {
    id: 'noise', title: 'Noise', text: 'Gunfire, sirens and explosions draw the dead. A Sound Lure turns that into a tool: build one where you want them to go.',
    target: { dom: '#build' },
    setup: (app, m) => { app.sim.state.research.done.push('e3'); app.sim.state.res.funds += 60; m.n = app.sim.state.ents.buildings.filter((b) => b.type === 'lure').length; app.ui.build.tab = 'defense'; app.ui.build.setOpen(true); },
    done: (app, m) => app.sim.state.ents.buildings.filter((b) => b.type === 'lure').length > m.n,
  },
  {
    id: 'pileup', title: 'The pile-up', info: true,
    text: 'Dead blocked by a wall climb on each other. When ten press one section, the top of the pile spills over. Keep towers and troops right behind your walls; High Walls need twenty-two.',
  },
  {
    id: 'recon', title: 'Government actions', text: 'Press F1 (Recon Flight) and click somewhere abroad to see beyond the border. Actions cost authority and have cooldowns.',
    target: { dom: '#actions' }, keys: ['F1'],
    setup: (app) => { app.sim.state.res.authority += 10; },
    done: (app) => (app.sim.state.cooldowns.recon || 0) > 0,
  },
  {
    id: 'groups', title: 'Control groups', text: 'Select your soldiers and press Ctrl+1. Later, press 1 to select them again. Double-tap to jump the camera there.',
    keys: ['Ctrl', '1'],
    done: (app) => (app.input.groups[1] || []).length > 0,
  },
  {
    id: 'pause', title: 'Time', text: 'Space pauses; + and − change speed. You can give every order while paused.',
    keys: ['Space'],
    setup: (app, m) => { m.seen = false; },
    done: (app, m) => { if (app.paused) m.seen = true; return m.seen && !app.paused; },
  },
  {
    id: 'manual', title: 'The Field Manual', text: 'Press F10 (or the ? button) any time for controls and everything you have learned. Lessons also pop up the first time something happens.',
    keys: ['F10'], target: { dom: '#b-manual' },
    done: (app) => app.ui.modals.kind === 'manual',
  },
];
