// Small DOM helpers shared by the UI modules.
import { fmt } from '../util.js';

// Effect text quotes base trust losses ("Trust −20"); show them as they will land right now.
export function trueTrust(text, mult) {
  if (Math.abs(mult - 1) < 0.01) return text;
  return text.replace(/([Tt]rust) −(\d+)(?![\d.])/g, (_, w, n) => `${w} −${Math.max(1, Math.round(n * mult))}`);
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Writes that skip what the page already shows: rewriting the same text or style still costs a style and layout
// pass. Each remembers its last value on the element, so an element must be written only through them.
export function setText(el, v) { if (el._tx !== v) { el.textContent = v; el._tx = v; } }
export function setHtml(el, v) { if (el._hx !== v) { el.innerHTML = v; el._hx = v; } }
export function setStyle(el, k, v) { const c = (el._sx ||= {}); if (c[k] !== v) { el.style[k] = v; c[k] = v; } }
export function setClass(el, v) { if (el._cx !== v) { el.className = v; el._cx = v; } }

export const RES_META = {
  funds: { label: 'Funds', icon: '💰' },
  food: { label: 'Food', icon: '🍞' },
  ammo: { label: 'Ammo', icon: '🔸' },
  manpower: { label: 'Manpower', icon: '👥' },
  authority: { label: 'Authority', icon: '⚖️' },
  research: { label: 'Research', icon: '🧪' },
};

// Costs are whole numbers; upkeep rates are fractions per hour and show as such (0.12, not 1).
export function costHtml(cost, res) {
  return Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) => `<span class="cost ${res && (res[k] ?? 0) < v ? 'short' : ''}">${RES_META[k].icon}${Number.isInteger(v) ? v : +v.toFixed(2)}</span>`).join(' ');
}

// A disabled control's reason when it costs more than there is: each missing resource's icon on a red chip.
export function needHtml(cost, res) {
  return Object.entries(cost).filter(([k, v]) => v > 0 && (res[k] ?? 0) < v).map(([k]) => `<span class="need">${RES_META[k].icon}</span>`).join('');
}

// The interface scale. The HUD and every layer over the map (labels, arrows, tooltip, hover card) are zoomed by it,
// so a screen position (the view's projection, the mouse, a bounding rect) is divided by it before it becomes a
// left, top or translate inside them, and their own widths are multiplied by it to compare with the screen.
export const uiScale = () => parseFloat(document.documentElement.style.getPropertyValue('--ui')) || 1;

export function rateHtml(v, digits = 1) {
  if (Math.abs(v) < 0.005) return '<span class="rate">±0</span>';
  return `<span class="rate ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}/h</span>`;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export { fmt };

// Tooltip: content is set through JS (never via HTML attributes) so markup can't break.
const tip = () => document.getElementById('tip');
let tipFor = null;
export function showTip(el, html) {
  tipFor = el;
  const t = tip();
  t.innerHTML = html;
  t.style.display = 'block';
  const r = el.getBoundingClientRect(), z = uiScale();
  const tw = t.offsetWidth * z, th = t.offsetHeight * z;
  let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
  if (y < 4) y = r.bottom + 8;
  x = Math.max(6, Math.min(innerWidth - tw - 6, x));
  t.style.left = x / z + 'px';
  t.style.top = y / z + 'px';
}
export function hideTip() { tipFor = null; tip().style.display = 'none'; }
// A panel that re-renders under the cursor takes the tooltip's element away before its mouseleave: drop the tip.
export function dropOrphanTip() { if (tipFor && !tipFor.isConnected) hideTip(); }

// Attach a tooltip whose content is computed on hover.
export function tipOn(el, fn) {
  el.addEventListener('mouseenter', () => showTip(el, typeof fn === 'function' ? fn() : fn));
  el.addEventListener('mouseleave', hideTip);
}

// A weapon's reach: from its minimum (indirect fire) to its range.
export const reach = (w) => `${w.minRange ? `${w.minRange}–` : ''}${w.range}`;

// Whole hours, rounded up. The clock steps in 0.05 h, so a time 14 h ahead can read 14.000000000000002: drop the
// float noise first, or a countdown shows one hour too many.
export const ceilHours = (h) => Math.ceil(h - 1e-6);

export function hours(h) {
  if (h >= 24) return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
  return `${Math.max(0, ceilHours(h))}h`;
}
