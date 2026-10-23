// Top bar: clock, speed, resources with rates and breakdowns, trust/order, world infection; news ticker.
import { $, RES_META, rateHtml, fmt, tipOn, setText, setHtml, setStyle, setClass, esc, ceilHours } from './dom.js';
import { ACTS } from '../config/campaign.js';
import { PACE } from '../config/balance.js';
import { computeRates } from '../sim/systems/economy.js';
import { paceSignals } from '../sim/systems/world.js';

const THREATS = {
  calm: ['CALM', 'Nothing is on its way. Build.'],
  rumour: ['RUMOUR', 'The dead are massing abroad: where, and the hours until they set out.'],
  contact: ['CONTACT', 'A horde is in sight: the hours until its lead reaches the line.'],
  breach: ['BREACH', 'The dead are inside the border.'],
  quiet: ['QUIET', 'The fight is over: the hours of guaranteed calm left. No new horde sets out and nothing trickles in.'],
  outbreak: ['OUTBREAK', 'No horde, but a town is reporting infection: send a Quarantine Team before it breaks out.'],
};

// The threat chip: what the dead are doing, read from the hordes, the dead inside the border and the pacing
// director's phase. In the calm after a fight a few dead inside (no more than end a peak) and a rumour waiting for
// the calm to end leave it QUIET; a horde already on its way, or a story set piece due before the calm ends, does not.
// Whole hours left, at least 1.
const hoursLeft = (h) => Math.max(1, ceilHours(h));

function threat(sim) {
  const s = sim.state, N = sim.N, nav = sim.nav;
  const near = new Map();
  for (const z of s.ents.dead) {
    if (z.gone || !z.horde || !nav) continue;
    const k = Math.floor(z.z) * N + Math.floor(z.x);
    if (!(near.get(z.horde) <= nav.dist[k])) near.set(z.horde, nav.dist[k]);
  }
  // The director's own reading (world.js), so the chip says what the director does.
  const { fight: fighting, inside } = paceSignals(sim);
  // A peak whose fight is over is about to become the calm (the director looks every quarter hour): say so already,
  // rather than flash CALM between the fight and QUIET.
  const ending = s.pace.phase === 'peak' && !fighting && inside <= PACE.calmDead;
  const relax = s.pace.phase === 'relax' || ending, end = ending ? s.time + sim.diff.relaxHours : s.pace.t + sim.diff.relaxHours;
  const calmLeft = hoursLeft(end - s.time);
  if (inside > (relax ? PACE.calmDead : 0)) return { kind: 'breach', detail: `${inside} inside${relax ? ` · ${calmLeft} h calm` : ''}`, inside, calmLeft: relax ? calmLeft : 0 };
  let contact = null, eta = Infinity;
  for (const h of s.hordes) {
    if (h.phase !== 'contact' && !(h.phase === 'moving' && h.arrived)) continue;
    const d = near.get(h.id) ?? Infinity;
    if (!contact || d < eta) { contact = h; eta = d; }
  }
  // Hours to the line as the contact report reckons them (fog.js).
  if (contact) return { kind: 'contact', detail: isFinite(eta) ? `~${Math.max(1, Math.round(eta / 0.9))} h` : '', horde: contact };
  let next = null;
  for (const h of s.hordes) {
    if (h.phase !== 'rumour' && h.phase !== 'moving') continue;
    const at = h.phase === 'moving' ? -Infinity : h.spawnAt;
    if (relax && at >= end) continue;
    if (!next || at < (next.phase === 'moving' ? -Infinity : next.spawnAt)) next = h;
  }
  if (next) return { kind: 'rumour', detail: `${next.name} · ${next.phase === 'moving' ? 'moving' : `in ${hoursLeft(next.spawnAt - s.time)} h`}`, horde: next };
  // Outbreaks are the director's to ignore (they are management, not an attack) but the player's to hear about.
  const sick = s.towns.find((t) => t.status === 'ok' && t.alerted);
  const sickName = sick ? sim.map.towns[sick.id].name : '';
  if (relax) return { kind: 'quiet', detail: `${calmLeft} h${sick ? ` · ☣ ${sickName}` : ''}`, inside, town: sick, calmLeft };
  if (sick) return { kind: 'outbreak', detail: sickName, town: sick };
  return { kind: 'calm', detail: '' };
}

// Where a click on the chip goes: the dead inside nearest the capital, the contacted horde's lead in sight (else the
// place it came from), the rumoured place. Nowhere in the calm.
function threatTarget(sim, t) {
  const s = sim.state;
  if (t.kind === 'breach') {
    const cap = sim.map.towns.find((c) => c.capital), owner = sim.map.owner, N = sim.N;
    let best = null, bd = Infinity;
    for (const z of s.ents.dead) {
      if (z.gone || !owner[Math.floor(z.z) * N + Math.floor(z.x)]) continue;
      const d = Math.hypot(z.x - cap.x, z.z - cap.z);
      if (d < bd) { bd = d; best = z; }
    }
    return best && [best.x, best.z];
  }
  if (t.kind === 'contact') {
    let lead = null, bd = Infinity;
    for (const z of s.ents.dead) {
      if (z.gone || z.horde !== t.horde.id || !sim.visible(z.x, z.z)) continue;
      const d = sim.nav.dist[Math.floor(z.z) * sim.N + Math.floor(z.x)];
      if (!lead || d < bd) { bd = d; lead = z; }
    }
    return lead ? [lead.x, lead.z] : [t.horde.x, t.horde.z];
  }
  if (t.kind === 'rumour') return [t.horde.x, t.horde.z];
  if (t.town) { const info = sim.map.towns[t.town.id]; return [info.x, info.z]; }
  return null;
}

export class Hud {
  constructor(app) {
    this.app = app;
    const res = Object.keys(RES_META).map((k) => `<div class="chip" id="c-${k}"><span class="ic">${RES_META[k].icon}</span><b id="r-${k}">0</b><small id="rr-${k}"></small></div>`).join('');
    $('#top').innerHTML = `
      <div class="brand">QUARANTINE<span>LINE</span></div>
      <div class="clock"><div class="d" id="t-day">DAY 1</div><div class="h" id="t-hour">07:00</div><div class="act" id="t-act"></div></div>
      <button class="threat calm" id="t-threat"><b id="t-threat-k">CALM</b><span id="t-threat-d"></span></button>
      <div class="speeds">
        <button data-speed="0" title="Pause (Space)">❚❚</button><button data-speed="1" title="1× (+/−)">▶</button>
        <button data-speed="2" title="2×">▶▶</button><button data-speed="4" title="4×">▶▶▶</button>
        <span class="spd" id="t-speed"></span>
      </div>
      <div class="res">${res}<div class="chip" id="c-pop"><span class="ic">🏙️</span><b id="r-pop">0</b></div><div class="chip" id="c-work"><span class="ic">👷</span><b id="r-work">0</b></div></div>
      <div class="meters">
        <div class="meter" id="m-trust-w"><label>TRUST <span id="m-trust-r"></span></label><div class="bar"><i id="m-trust"></i><span class="tick" style="left:30%"></span><span class="tick" style="left:70%"></span></div></div>
        <div class="meter" id="m-order-w"><label>ORDER <span id="m-order-r"></span></label><div class="bar"><i id="m-order"></i><span class="tick" style="left:30%"></span><span class="tick" style="left:70%"></span></div></div>
        <div class="meter" id="m-world-w"><label>WORLD <span id="m-world-v"></span></label><div class="bar"><i id="m-world" style="background:linear-gradient(90deg,#a83a2a,#ff5a48)"></i></div></div>
      </div>
      <div class="spacer"></div>
      <button class="topbtn" id="b-manual" title="Field Manual (F10)">?</button>
      <button class="topbtn" id="b-menu" title="Menu (Esc)">☰</button>`;
    $('#top').querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => app.setSpeed(+b.dataset.speed)));
    $('#b-manual').addEventListener('click', () => app.ui.modals.manual());
    $('#b-menu').addEventListener('click', () => app.ui.modals.pauseMenu());
    for (const k of Object.keys(RES_META)) tipOn($(`#c-${k}`), () => this.breakdown(k));
    tipOn($('#c-pop'), () => `<b>Population</b><br>${this.app.sim.state.towns.filter((t) => t.status === 'ok').map((t) => `${this.app.sim.map.towns[t.id].name}: ${fmt(t.pop)}`).join('<br>')}`);
    const parts = (list) => (list || []).filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => a[1] - b[1]).map(([l, v]) => `<div class="kv"><span>${l}</span><b class="${v < 0 ? 'bad' : 'good'}">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}/h</b></div>`).join('');
    const recent = (log) => Object.entries(log || {}).filter(([c]) => !['normal life', 'outbreaks', 'quarantines', 'laws', 'safety', 'public fear', 'troops in towns', 'police stations', 'breakouts', 'low trust', 'hunger', 'unpaid troops', 'starvation', 'crowds at the border'].includes(c)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([c, v]) => `<div class="kv"><span>${c}</span><b class="${v < 0 ? 'bad' : 'good'}">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}</b></div>`).join('');
    tipOn($('#c-work'), () => {
      const w = this.app.sim.state.workforce || { have: 0, need: 0 };
      return `<b>Workers ${Math.round(w.need)} needed / ${Math.floor(w.have)} available</b><br>Farms and labs need 1 worker, factories and munitions plants 2. The living towns supply them (quarantined towns far fewer). Farms are staffed first, then munitions plants, labs and factories; whatever is left over stands idle and produces nothing. Every town lost or locked down shrinks the workforce.`;
    });
    tipOn($('#m-trust-w'), () => { const s = this.app.sim.state; return `<b>Trust ${Math.round(s.trust)}</b>: whether people cooperate. Below 30 they hide cases and break quarantine; above 70 they volunteer. At 0 the government is removed.${parts(s.trustParts)}<br><b>Biggest one-off changes</b>${recent(s.stats.trustLog) || '<div class="hint">none yet</div>'}`; });
    tipOn($('#m-order-w'), () => { const s = this.app.sim.state; return `<b>Order ${Math.round(s.order)}</b>: whether people comply. Below 30 there is looting and people flee towns, spreading infection; above 70 production rises 10%. At 0 the state collapses.${parts(s.orderParts)}<br><b>Biggest one-off changes</b>${recent(s.stats.orderLog) || '<div class="hint">none yet</div>'}`; });
    tipOn($('#m-world-w'), () => `<b>World infection</b><br>Share of the world's population infected. Drives refugees and the size of hordes.`);
    $('#t-threat').addEventListener('click', () => { const p = threatTarget(this.app.sim, threat(this.app.sim)); if (p) this.app.jumpTo(p[0], p[1]); });
    tipOn($('#t-threat'), () => this.threatTip());
    this.lastNews = null;
  }

  threatTip() {
    const sim = this.app.sim, s = sim.state, t = threat(sim);
    const from = (h) => (h.sea ? 'the sea' : esc(h.name));
    const where = (h) => (h.sea ? 'at sea' : `near ${esc(h.name)}`);
    let now;
    if (t.kind === 'breach') now = `${t.inside} dead inside the border.${t.calmLeft ? ` The calm still holds for ${t.calmLeft} h: no new horde comes until then.` : ''}`;
    else if (t.kind === 'contact') now = `A horde of ${t.horde.members} dead from ${from(t.horde)} is in sight${t.detail ? `; its lead is ${t.detail} from the line` : ''}.`;
    else if (t.kind === 'rumour') now = `${t.horde.label ? `${esc(t.horde.label)}: the` : 'The'} dead are massing ${where(t.horde)}${t.horde.phase === 'moving' ? ' and have set out' : `; they set out in about ${hoursLeft(t.horde.spawnAt - s.time)} h`}.`;
    else if (t.kind === 'quiet') {
      const wait = s.hordes.filter((h) => h.phase === 'rumour');
      now = `${t.calmLeft} h of guaranteed calm left.${t.town ? ` ${esc(sim.map.towns[t.town.id].name)} is reporting infection.` : ''}${t.inside ? ` ${t.inside} dead still inside the border.` : ''}${wait.length ? ` A horde rumoured ${where(wait[0])} waits for the calm to end.` : ''}`;
    } else if (t.kind === 'outbreak') now = `No horde is on its way, but ${esc(sim.map.towns[t.town.id].name)} is reporting infection.`;
    else now = 'Nothing is on its way.';
    const rows = Object.entries(THREATS).map(([k, [name, text]]) => `<div class="threat-row${k === t.kind ? ' on' : ''}"><b class="threat-k ${k}">${name}</b><span>${text}</span></div>`).join('');
    return `<b>Threat</b>: ${now}${rows}<div class="hint">${threatTarget(sim, t) ? 'Click to look at it.' : 'Nothing to look at in the calm.'}</div>`;
  }

  breakdown(k) {
    const sim = this.app.sim;
    const { rates } = computeRates(sim);
    const tips = {
      funds: 'Town taxes (× trust), factories, HQ, steelworks and the market, minus troop and building upkeep. Factories need workers (👷).',
      food: 'Farms (more on farmland), grain co-ops and the harbour, minus what people, troops and camps eat.',
      ammo: 'Munitions plants and the steelworks. Every shot costs ammunition.',
      manpower: 'Grows with population (Martial Law and Mobilisation boost it) and with admitted refugees.',
      authority: 'Political capital for laws and government actions. Grows with time and trust.',
      research: 'Labs and the university. Spent by the active research project.',
    };
    return `<b>${RES_META[k].label}</b> ${rateHtml(rates[k], 2)}<br>${tips[k]}`;
  }

  update() {
    const sim = this.app.sim, s = sim.state;
    setText($('#t-day'), `DAY ${sim.day}`);
    const h = Math.floor(sim.hour), mi = Math.floor((sim.hour % 1) * 6) * 10;
    setText($('#t-hour'), `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}${sim.night ? ' ☾' : ''}`);
    setText($('#t-act'), s.mode === 'campaign' ? ACTS[sim.act - 1].title.split(': ')[0] : s.mode === 'sandbox' ? 'Sandbox' : 'Training');
    const th = threat(sim);
    setClass($('#t-threat'), `threat ${th.kind}`);
    setText($('#t-threat-k'), THREATS[th.kind][0]);
    setText($('#t-threat-d'), th.detail);
    for (const k of Object.keys(RES_META)) {
      setText($(`#r-${k}`), String(Math.floor(s.res[k])));
      setHtml($(`#rr-${k}`), rateHtml(s.rates[k]));
      const low = (k === 'food' && s.res.food < 20) || (k === 'ammo' && s.res.ammo < 15) || (k === 'funds' && s.res.funds < 10);
      $(`#c-${k}`).classList.toggle('low', low);
    }
    setText($('#r-pop'), fmt(s.population || 0));
    const w = s.workforce || { have: 0, need: 0 };
    setText($('#r-work'), `${Math.round(w.need)}/${Math.floor(w.have)}`);
    $('#c-work').classList.toggle('low', w.need > w.have + 1e-9);
    // Bar widths to a tenth of a percent: finer is under a pixel on any of these bars.
    const meter = (id, v, rate) => {
      const el = $(`#m-${id}`);
      setStyle(el, 'width', v.toFixed(1) + '%');
      setStyle(el, 'background', v > 50 ? '#7cc46a' : v > 30 ? '#e0b040' : '#e04a3a');
      setHtml($(`#m-${id}-r`), rateHtml(rate, 2));
    };
    meter('trust', s.trust, s.trustRate);
    meter('order', s.order, s.orderRate);
    setStyle($('#m-world'), 'width', s.worldInf.toFixed(1) + '%');
    setText($('#m-world-v'), s.worldInf.toFixed(1) + '%');
    const speed = this.app.paused ? 0 : this.app.speed;
    $('#top').querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === speed));
    const sp = $('#t-speed'), word = speed ? `${speed}×` : 'PAUSED';
    if (sp.textContent !== word) { sp.textContent = word; sp.classList.toggle('paused', !speed); }
    const feed = s.news.feed || [];
    if (feed.length && feed[0] !== this.lastNews) {
      this.lastNews = feed[0];
      const t = $('#ticker-text');
      t.textContent = feed.slice(0, 4).map((n) => n.text).join('   ◆   ');
      t.style.animation = 'none';
      void t.offsetWidth;
      t.style.animation = '';
    }
  }
}
