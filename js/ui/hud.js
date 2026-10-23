// Top bar: clock, speed, resources with rates and breakdowns, trust/order, world infection; news ticker.
import { $, RES_META, rateHtml, fmt, tipOn } from './dom.js';
import { ACTS } from '../config/campaign.js';
import { computeRates } from '../sim/systems/economy.js';

export class Hud {
  constructor(app) {
    this.app = app;
    const res = Object.keys(RES_META).map((k) => `<div class="chip" id="c-${k}"><span class="ic">${RES_META[k].icon}</span><b id="r-${k}">0</b><small id="rr-${k}"></small></div>`).join('');
    $('#top').innerHTML = `
      <div class="brand">QUARANTINE<span>LINE</span></div>
      <div class="clock"><div class="d" id="t-day">DAY 1</div><div class="h" id="t-hour">07:00</div><div class="act" id="t-act"></div></div>
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
    this.lastNews = null;
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
    $('#t-day').textContent = `DAY ${sim.day}`;
    const h = Math.floor(sim.hour), mi = Math.floor((sim.hour % 1) * 6) * 10;
    $('#t-hour').textContent = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}${sim.night ? ' ☾' : ''}`;
    $('#t-act').textContent = s.mode === 'campaign' ? ACTS[sim.act - 1].title.split(': ')[0] : s.mode === 'sandbox' ? 'Sandbox' : 'Training';
    for (const k of Object.keys(RES_META)) {
      $(`#r-${k}`).textContent = Math.floor(s.res[k]);
      $(`#rr-${k}`).innerHTML = rateHtml(s.rates[k]);
      const low = (k === 'food' && s.res.food < 20) || (k === 'ammo' && s.res.ammo < 15) || (k === 'funds' && s.res.funds < 10);
      $(`#c-${k}`).classList.toggle('low', low);
    }
    $('#r-pop').textContent = fmt(s.population || 0);
    const w = s.workforce || { have: 0, need: 0 };
    $('#r-work').textContent = `${Math.round(w.need)}/${Math.floor(w.have)}`;
    $('#c-work').classList.toggle('low', w.need > w.have + 1e-9);
    const meter = (id, v, rate) => {
      const el = $(`#m-${id}`);
      el.style.width = v + '%';
      el.style.background = v > 50 ? '#7cc46a' : v > 30 ? '#e0b040' : '#e04a3a';
      $(`#m-${id}-r`).innerHTML = rateHtml(rate, 2);
    };
    meter('trust', s.trust, s.trustRate);
    meter('order', s.order, s.orderRate);
    $('#m-world').style.width = s.worldInf + '%';
    $('#m-world-v').textContent = s.worldInf.toFixed(1) + '%';
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
