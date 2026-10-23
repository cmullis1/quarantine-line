// Minimap: terrain base (with fog), towns, structures, troops, the dead, refugees, buses, pings, camera view; its
// legend, and the label under it that names the map overlay O has on and keys its colours.
import { $ } from './dom.js';
import { TER } from '../config/world.js';
import { PRODUCER_COLORS, INFECTION_COLORS, DEFENCE_COLORS, HP_COLORS } from './overview.js';

// Everything the minimap colours, in one place, so the legend shows what is drawn.
export const MAP_COLORS = { troops: '#4ab0ff', dead: '#ff2a2a', refugees: '#f0f0f0', buses: '#e0b030', wall: '#d8d8d0', building: '#9a9a9a' };
export const TOWN_COLORS = { ok: '#e8e2d0', capital: '#f4e090', outbreak: '#ff8040', breakout: '#ff2a1a', quarantined: '#d0b040', fallen: '#1a1010' };

// Fallen covers scorched; a breakout outranks the outbreak it grew from.
const townState = (t, info) => (t.status !== 'ok' ? 'fallen' : t.breakout ? 'breakout' : t.alerted ? 'outbreak' : t.quarantine ? 'quarantined' : info.capital ? 'capital' : 'ok');

const swatch = (color, label, cls = '') => `<span><i class="${cls}" style="${cls === 'ring' ? 'border-color' : 'background'}:${color}"></i>${label}</span>`;

const LEGEND = `<div class="row">${['troops', 'dead', 'refugees', 'buses'].map((k) => swatch(MAP_COLORS[k], k)).join('')}</div>`
  + `<div class="row"><em>towns</em>${['ok', 'outbreak', 'breakout', 'quarantined', 'fallen'].map((k) => swatch(TOWN_COLORS[k], k)).join('')}</div>`;

const OVERLAY_KEYS = {
  infection: { name: 'Infection', key: swatch(INFECTION_COLORS.cases, 'cases') + swatch(INFECTION_COLORS.clear, 'clear') + swatch(INFECTION_COLORS.lost, 'lost') },
  economy: {
    name: 'Economy',
    key: ['farm', 'munitions', 'lab', 'factory'].map((k) => swatch(PRODUCER_COLORS[k], k)).join('') + `<span><i style="background:repeating-linear-gradient(45deg, ${PRODUCER_COLORS.idle} 0 2px, #2a100d 2px 4px)"></i>idle</span>`,
  },
  defence: {
    name: 'Defence',
    key: swatch(DEFENCE_COLORS.gun, 'range', 'ring') + swatch(DEFENCE_COLORS.artillery, 'artillery', 'ring')
      + `<span>${HP_COLORS.map((c) => `<i style="background:${c}"></i>`).join('')}wall HP</span>`,
  },
};

export class Minimap {
  constructor(app) {
    this.app = app;
    const cv = $('#minimap');
    this.S = 3;
    const N = app.sim.N;
    cv.width = N * this.S; cv.height = N * this.S;
    this.ctx = cv.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = N; this.base.height = N;
    this.fogSig = -1;
    const go = (e) => {
      const r = cv.getBoundingClientRect();
      app.jumpTo(((e.clientX - r.left) / r.width) * N, ((e.clientY - r.top) / r.height) * N);
    };
    let down = false;
    cv.onmousedown = (e) => { down = true; go(e); };
    window.addEventListener('mouseup', () => { down = false; });
    cv.onmousemove = (e) => { if (down) go(e); };
    $('#mm-legend').innerHTML = LEGEND;
    this.setOverlay(app.overlay);
  }

  setOverlay(mode) {
    const el = $('#overlay-label'), k = OVERLAY_KEYS[mode];
    el.classList.toggle('off', !k);
    el.innerHTML = k ? `<div class="name">◉ ${k.name} overlay <kbd>O</kbd></div><div class="legend">${k.key}</div>` : '<div class="name">Overlay off <kbd>O</kbd></div>';
  }

  redrawBase() {
    const sim = this.app.sim, m = sim.map, N = m.N, seen = sim.state.fog.seen;
    const bx = this.base.getContext('2d'), img = bx.createImageData(N, N);
    for (let k = 0; k < N * N; k++) {
      const t = m.terrain[k];
      let c;
      if (t === TER.SEA) c = [32, 64, 100];
      else if (t === TER.RIVER || t === TER.LAKE) c = [44, 90, 130];
      else if (t === TER.MOUNTAIN) c = [130, 124, 112];
      else if (m.owner[k]) c = m.forest[k] ? [52, 100, 52] : m.farmland[k] ? [150, 150, 80] : [86, 130, 62];
      else c = m.forest[k] ? [85, 85, 58] : [110, 106, 76];
      if (m.road[k]) c = [120, 118, 110];
      if (m.border[k] && t === TER.LAND) c = [200, 170, 70];
      if (!m.owner[k] && t !== TER.SEA) { const f = sim.vis[k] ? 1 : seen[k] ? 0.6 : 0.3; c = c.map((v) => v * f); }
      img.data.set([c[0], c[1], c[2], 255], k * 4);
    }
    bx.putImageData(img, 0, 0);
  }

  draw(dt) {
    const sim = this.app.sim, s = sim.state, ctx = this.ctx, S = this.S, N = sim.N;
    const sig = Math.floor(s.time * 2);
    if (sig !== this.fogSig) { this.fogSig = sig; this.redrawBase(); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, N * S, N * S);
    for (const t of s.towns) {
      const i = sim.map.towns[t.id];
      ctx.fillStyle = TOWN_COLORS[townState(t, i)];
      ctx.fillRect((i.x - i.r * 0.6) * S, (i.z - i.r * 0.6) * S, i.r * 1.2 * S, i.r * 1.2 * S);
    }
    for (const b of s.ents.buildings) {
      ctx.fillStyle = b.type === 'wall' || b.type === 'highwall' || b.type === 'gate' ? MAP_COLORS.wall : MAP_COLORS.building;
      ctx.fillRect(b.i * S, b.j * S, b.size * S, b.size * S);
    }
    ctx.fillStyle = MAP_COLORS.refugees;
    for (const r of s.ents.refugees) if (!r.camp && sim.visible(r.x, r.z)) ctx.fillRect(r.x * S - 1, r.z * S - 1, 2, 2);
    ctx.fillStyle = MAP_COLORS.dead;
    for (const z of s.ents.dead) if (!z.gone && sim.visible(z.x, z.z)) ctx.fillRect(z.x * S - 1, z.z * S - 1, 2, 2);
    ctx.fillStyle = MAP_COLORS.troops;
    for (const u of s.ents.units) ctx.fillRect(u.x * S - 2, u.z * S - 2, 4, 4);
    ctx.fillStyle = MAP_COLORS.buses;
    for (const v of s.ents.vehicles) ctx.fillRect(v.x * S - 2, v.z * S - 2, 4, 4);
    // Pings
    const pings = this.app.ui.alerts.pings;
    for (let k = pings.length - 1; k >= 0; k--) {
      const p = pings[k];
      p.t += dt;
      const r = 4 + p.t * 18;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.6);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x * S, p.z * S, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      if (p.t > 1.6) pings.splice(k, 1);
    }
    const poly = this.app.view.viewPolygon();
    if (poly) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      poly.forEach(([x, z], k) => (k ? ctx.lineTo(x * S, z * S) : ctx.moveTo(x * S, z * S)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
