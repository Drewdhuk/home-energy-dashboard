/* Home Energy Dashboard Card (single-file, no build) — v1.4
 *
 * NetZero-style 6-graph energy dashboard:
 * 1) Solar (actual) + forecast (optional)
 * 2) Grid (power line + Peak/Off-peak/Dispatch background + dashed p/kWh unit-price trend + net £ for range)
 * 3) Battery power + SoC
 * 4) Home load
 * 5) Heat pump power + outside temperature overlay
 * 6) EV charger power
 *
 * Includes:
 * - Export CSV (current range) + summary footer (net £, avg p/kWh, import/export kWh)
 * - Range tabs: 24h / 7d / 30d / This Year / Last Year
 *
 * Important:
 * - For money + p/kWh overlays, provide entities.import_rate (and ideally entities.export_rate).
 * - Rates can be in £/kWh (e.g. 0.075) or p/kWh (e.g. 7.5). The card auto-detects.
 */

const CARD_TAG = "home-energy-dashboard-card";

const DEFAULTS = {
  title: "Home Energy Dashboard",
  refresh_seconds: 60,
  range: "day", // day | week | month | this_year | last_year
  show_range_tabs: true,
  show_export: true,
  max_points: 220,
  options: {
    invert_grid: false,
    invert_battery: false,
  },
};

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function parseFloatSafe(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function fmtW(w) {
  if (!isNum(w)) return "—";
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(w/1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}
function fmtPct(p) { return isNum(p) ? `${Math.round(p)}%` : "—"; }
function fmtTemp(t) { return isNum(t) ? `${t.toFixed(1)}°C` : "—"; }
function fmtGBP(x) {
  if (!isNum(x)) return "—";
  const sign = x < 0 ? "–" : "";
  return `${sign}£${Math.abs(x).toFixed(2)}`;
}
function fmtPPerKwh(p) {
  if (!isNum(p)) return "—";
  const sign = p < 0 ? "–" : "";
  return `${sign}${Math.abs(p).toFixed(1)} p/kWh`;
}
function toISO(d) { return d.toISOString(); }

function pickRange(range) {
  const now = new Date();
  if (range === "week") return { start: new Date(now.getTime() - 7*24*3600*1000), end: now };
  if (range === "month") return { start: new Date(now.getTime() - 30*24*3600*1000), end: now };
  if (range === "this_year") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
    return { start, end: now };
  }
  if (range === "last_year") {
    const y = now.getUTCFullYear() - 1;
    const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    return { start, end };
  }
  return { start: new Date(now.getTime() - 24*3600*1000), end: now };
}
function rangeLabel(range) {
  if (range === "week") return "Last 7d";
  if (range === "month") return "Last 30d";
  if (range === "this_year") return "This Year";
  if (range === "last_year") return "Last Year";
  return "Last 24h";
}

function downsample(points, maxPoints) {
  if (!points || points.length <= maxPoints) return points || [];
  const stride = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i * stride)]);
  return out;
}

function extractHistorySeries(historyResponse) {
  const arr = Array.isArray(historyResponse) ? historyResponse[0] : null;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const st of arr) {
    const v = parseFloatSafe(st.state);
    if (v === null) continue;
    const t = Date.parse(st.last_changed || st.last_updated);
    if (!Number.isFinite(t)) continue;
    out.push({ t, v });
  }
  return out;
}

function extractHistoryStates(historyResponse) {
  const arr = Array.isArray(historyResponse) ? historyResponse[0] : null;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const st of arr) {
    const t = Date.parse(st.last_changed || st.last_updated);
    if (!Number.isFinite(t)) continue;
    out.push({ t, s: String(st.state || "").toLowerCase() });
  }
  out.sort((a,b)=>a.t-b.t);
  return out;
}

function svgLinePath(points, w, h, pad, yMin, yMax) {
  if (!points.length || !isNum(yMin) || !isNum(yMax) || yMax === yMin) return "";
  const x0 = pad, x1 = w - pad;
  const y0 = pad, y1 = h - pad;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const dt = Math.max(1, tMax - tMin);
  const parts = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = x0 + ((p.t - tMin) / dt) * (x1 - x0);
    const y = y1 - ((p.v - yMin) / (yMax - yMin)) * (y1 - y0);
    parts.push((i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2));
  }
  return parts.join(" ");
}

function niceDomain(minV, maxV) {
  if (!isNum(minV) || !isNum(maxV)) return null;
  if (minV === maxV) {
    const eps = Math.max(1, Math.abs(minV) * 0.1);
    return { min: minV - eps, max: maxV + eps };
  }
  const span = maxV - minV;
  const pad = span * 0.08;
  return { min: minV - pad, max: maxV + pad };
}

function seriesMinMax(seriesList) {
  let mn = Infinity, mx = -Infinity;
  for (const s of seriesList) {
    for (const p of (s || [])) {
      if (!isNum(p.v)) continue;
      if (p.v < mn) mn = p.v;
      if (p.v > mx) mx = p.v;
    }
  }
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return null;
  return { min: mn, max: mx };
}

function escapeCsv(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildBandsFromStateTimeline(timeline, startMs, endMs) {
  if (!timeline || timeline.length === 0) return [];
  const out = [];
  let idx = 0;
  let current = null;
  while (idx < timeline.length && timeline[idx].t <= startMs) {
    current = timeline[idx].s;
    idx++;
  }
  let t0 = startMs;
  if (current === null) {
    if (timeline[0].t > endMs) return [];
    t0 = Math.max(startMs, timeline[0].t);
    current = timeline[0].s;
    idx = 1;
  }
  for (; idx < timeline.length; idx++) {
    const t = timeline[idx].t;
    if (t <= startMs) continue;
    if (t >= endMs) break;
    out.push({ t0, t1: t, kind: current });
    t0 = t;
    current = timeline[idx].s;
  }
  out.push({ t0, t1: endMs, kind: current });
  return out.filter(b => b.t1 > b.t0);
}

function normalizeRateToGbpPerKwh(raw) {
  if (!isNum(raw)) return null;
  if (raw <= 1.5) return raw; // £/kWh
  return raw / 100.0; // p/kWh -> £/kWh
}

function seriesValueAt(series, t) {
  if (!series || series.length === 0) return null;
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? series[ans].v : null;
}

function stateAt(series, t) {
  if (!series || series.length === 0) return "";
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? series[ans].s : "";
}

function computeGridMoneyAndUnitPrice(gridSeries, importRateSeries, exportRateSeries, startMs, endMs) {
  if (!gridSeries || gridSeries.length < 2) {
    return { import_kwh:0, export_kwh:0, import_cost_gbp:0, export_income_gbp:0, net_cost_gbp:0, avg_p_per_kwh:null, unit_price_series_p:[] };
  }

  const ts = new Set();
  for (const p of gridSeries) ts.add(p.t);
  for (const p of (importRateSeries || [])) ts.add(p.t);
  for (const p of (exportRateSeries || [])) ts.add(p.t);
  const timeline = Array.from(ts).filter(t => t >= startMs && t <= endMs).sort((a,b)=>a-b);
  if (timeline.length < 2) return { import_kwh:0, export_kwh:0, import_cost_gbp:0, export_income_gbp:0, net_cost_gbp:0, avg_p_per_kwh:null, unit_price_series_p:[] };

  let import_kwh = 0, export_kwh = 0, import_cost_gbp = 0, export_income_gbp = 0;
  const unit_price_series_p = [];

  for (let i = 0; i < timeline.length - 1; i++) {
    const t0 = timeline[i];
    const t1 = timeline[i+1];
    const dt_h = (t1 - t0) / 3600000.0;
    if (dt_h <= 0) continue;

    const grid_w = seriesValueAt(gridSeries, t0);
    if (!isNum(grid_w)) continue;

    const imp_raw = seriesValueAt(importRateSeries, t0);
    const exp_raw = seriesValueAt(exportRateSeries, t0);

    const imp_gbp = normalizeRateToGbpPerKwh(imp_raw);
    const exp_gbp = normalizeRateToGbpPerKwh(exp_raw);

    const imp_kw = Math.max(0, grid_w) / 1000.0;
    const exp_kw = Math.max(0, -grid_w) / 1000.0;

    const imp_kwh = imp_kw * dt_h;
    const exp_kwh = exp_kw * dt_h;

    import_kwh += imp_kwh;
    export_kwh += exp_kwh;

    if (isNum(imp_gbp)) import_cost_gbp += imp_kwh * imp_gbp;
    if (isNum(exp_gbp)) export_income_gbp += exp_kwh * exp_gbp;

    let unit_p = null;
    if (imp_kw > 0.0001 && isNum(imp_gbp)) unit_p = imp_gbp * 100.0;
    else if (exp_kw > 0.0001 && isNum(exp_gbp)) unit_p = exp_gbp * 100.0;
    if (unit_p !== null) unit_price_series_p.push({ t: t0, v: unit_p });
  }

  const net_cost_gbp = import_cost_gbp - export_income_gbp;
  const avg_p_per_kwh = (import_kwh > 0.000001) ? (net_cost_gbp / import_kwh) * 100.0 : null;

  return { import_kwh, export_kwh, import_cost_gbp, export_income_gbp, net_cost_gbp, avg_p_per_kwh, unit_price_series_p };
}

class HomeEnergyDashboardCard extends HTMLElement {
  static getStubConfig() { return { type: `custom:${CARD_TAG}` }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._cache = new Map();
    this._timer = null;
    this._lastSeries = null;
    this._lastRange = null;
    this._money = null;
    this._renderBase();
  }

  setConfig(config) {
    if (!config) throw new Error("Missing configuration.");
    if (!config.entities) throw new Error("Missing 'entities' mapping.");
    this._config = {
      ...DEFAULTS,
      ...config,
      options: { ...DEFAULTS.options, ...(config.options || {}) },
      entities: { ...(config.entities || {}) },
    };
    this._renderBase();
    this._schedule();
  }

  set hass(hass) { this._hass = hass; this._schedule(); }

  disconnectedCallback() {
    if (this._timer) window.clearTimeout(this._timer);
    this._timer = null;
  }

  getCardSize() { return 10; }

  _schedule() {
    if (!this._config || !this._hass) return;
    if (this._timer) window.clearTimeout(this._timer);
    this._update();
    const ms = clamp((this._config.refresh_seconds || 60) * 1000, 15000, 10*60*1000);
    this._timer = window.setTimeout(() => this._schedule(), ms);
  }

  _state(entityId) { return (entityId && this._hass) ? (this._hass.states[entityId] || null) : null; }
  _num(entityId) { const st = this._state(entityId); return st ? parseFloatSafe(st.state) : null; }

  async _fetchHistory(entityId, start, end) {
    const key = `${entityId}|${start.toISOString()}|${end.toISOString()}`;
    const now = Date.now();
    const cached = this._cache.get(key);
    if (cached && (now - cached.ts) < 55*1000) return cached.data;
    const path = `history/period/${encodeURIComponent(toISO(start))}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(toISO(end))}`;
    const resp = await this._hass.callApi("GET", path);
    this._cache.set(key, { ts: now, data: resp });
    return resp;
  }

  _renderBase() {
    const style = `
      :host { display:block; }
      ha-card { background:#0b0e12; color:#e8eaed; border-radius:18px; overflow:hidden; box-shadow:none; }
      .wrap { padding:16px; }
      .top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .title { font-size:16px; font-weight:700; letter-spacing:0.2px; }
      .topRight { display:flex; gap:10px; align-items:flex-start; justify-content:flex-end; flex-wrap:wrap; }
      .chips { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
      .chip { font-size:12px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.10); }
      .chip.good { background:rgba(52,199,89,0.14); border-color:rgba(52,199,89,0.22); }
      .chip.warn { background:rgba(255,159,10,0.14); border-color:rgba(255,159,10,0.22); }
      .chip.info { background:rgba(10,132,255,0.14); border-color:rgba(10,132,255,0.22); }
      .btn { cursor:pointer; user-select:none; font-size:12px; padding:7px 10px; border-radius:12px;
             background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10); opacity:0.95; }
      .btn:active { transform: translateY(1px); }
      .btnRow { display:flex; gap:8px; justify-content:flex-end; }
      .tabs { display:flex; gap:8px; margin:8px 0 14px; flex-wrap:wrap; }
      .tab { cursor:pointer; user-select:none; font-size:12px; padding:7px 10px; border-radius:12px;
             background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); opacity:0.9; }
      .tab.active { background:rgba(255,255,255,0.10); opacity:1; }
      .grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }
      @media (max-width:700px){ .grid { grid-template-columns: 1fr; } }
      .cardlet { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:12px; min-height:140px; }
      .row { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
      .label { font-size:13px; opacity:0.85; }
      .value { font-size:18px; font-weight:750; }
      .sub { margin-top:4px; font-size:12px; opacity:0.65; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
      .chart { margin-top:10px; }
      .chart svg { width:100%; height:auto; display:block; }
      .gridline { stroke:rgba(232,234,237,0.10); stroke-width:1; }
      .lineA { stroke:rgba(232,234,237,0.95); stroke-width:2.2; fill:none; }
      .lineB { stroke:rgba(10,132,255,0.85); stroke-width:2.2; fill:none; }
      .lineC { stroke:rgba(52,199,89,0.85); stroke-width:2.2; fill:none; }
      .dash { stroke-dasharray:6 6; opacity:0.85; }
      .bandPeak { fill: rgba(255,159,10,0.10); }
      .bandOffPeak { fill: rgba(52,199,89,0.10); }
      .bandDispatch { fill: rgba(10,132,255,0.10); }
      .foot { margin-top:12px; font-size:12px; opacity:0.6; }
      code { opacity:0.85; }
    `;
    this.shadowRoot.innerHTML = `
      <style>${style}</style>
      <ha-card>
        <div class="wrap">
          <div class="top">
            <div class="title" id="hed_title"></div>
            <div class="topRight">
              <div class="btnRow" id="hed_btns"></div>
              <div class="chips" id="hed_chips"></div>
            </div>
          </div>
          <div class="tabs" id="hed_tabs" style="display:none;"></div>
          <div class="grid">
            <div class="cardlet" id="c_solar"></div>
            <div class="cardlet" id="c_grid"></div>
            <div class="cardlet" id="c_batt"></div>
            <div class="cardlet" id="c_home"></div>
            <div class="cardlet" id="c_hp"></div>
            <div class="cardlet" id="c_ev"></div>
          </div>
          <div class="foot" id="hed_foot"></div>
        </div>
      </ha-card>
    `;

    const btnsEl = this.shadowRoot.getElementById("hed_btns");
    btnsEl.innerHTML = "";
    if (this._config?.show_export) {
      const b = document.createElement("div");
      b.className = "btn";
      b.textContent = "Export CSV";
      b.addEventListener("click", () => this._exportCsv());
      btnsEl.appendChild(b);
    }

    const tabsEl = this.shadowRoot.getElementById("hed_tabs");
    if (this._config?.show_range_tabs) {
      tabsEl.style.display = "flex";
      const labels = { day:"24h", week:"7d", month:"30d", this_year:"This Year", last_year:"Last Year" };
      const order = ["day","week","month","this_year","last_year"];
      tabsEl.innerHTML = order.map(r => `
        <div class="tab ${this._config.range===r ? "active":""}" data-range="${r}">${labels[r]}</div>
      `).join("");
      tabsEl.querySelectorAll(".tab").forEach(el => {
        el.addEventListener("click", () => {
          this._config.range = el.getAttribute("data-range");
          tabsEl.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
          el.classList.add("active");
          this._cache.clear();
          this._update();
        });
      });
    }
  }

  _chip(text, cls="") { return `<span class="chip ${cls}">${text}</span>`; }

  _renderChart({ seriesA, seriesB, dashedB=false, yDomain=null, bands=null }) {
    const w = 320, h = 110, pad = 10;
    const all = [];
    if (seriesA) all.push(seriesA);
    if (seriesB) all.push(seriesB);
    const mm = yDomain ? yDomain : seriesMinMax(all);
    if (!mm) {
      return `<div class="chart"><svg viewBox="0 0 ${w} ${h}">
        <line class="gridline" x1="0" y1="${h-1}" x2="${w}" y2="${h-1}"></line>
        <text class="axislabel" x="${pad}" y="${h/2}">No data</text>
      </svg></div>`;
    }
    const dom = niceDomain(mm.min, mm.max);
    const yMin = dom.min, yMax = dom.max;

    const pathA = seriesA ? svgLinePath(seriesA, w, h, pad, yMin, yMax) : "";
    const pathB = seriesB ? svgLinePath(seriesB, w, h, pad, yMin, yMax) : "";

    const gl = [];
    for (let i = 1; i <= 3; i++) {
      const y = pad + (i/4) * (h - 2*pad);
      gl.push(`<line class="gridline" x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}"></line>`);
    }

    // Bands
    let bandSvg = "";
    if (bands && bands.length && seriesA && seriesA.length) {
      const tMin = seriesA[0].t;
      const tMax = seriesA[seriesA.length - 1].t;
      const dt = Math.max(1, tMax - tMin);
      const x0 = pad, x1 = w - pad;
      const y0 = pad, y1 = h - pad;
      const rects = [];
      for (const b of bands) {
        const kind = (b.kind || "");
        const cls =
          kind.includes("dispatch") ? "bandDispatch" :
          (kind.includes("off") ? "bandOffPeak" :
          (kind.includes("peak") ? "bandPeak" : null));
        if (!cls) continue;
        const xa = x0 + ((b.t0 - tMin) / dt) * (x1 - x0);
        const xb = x0 + ((b.t1 - tMin) / dt) * (x1 - x0);
        const x = Math.max(x0, Math.min(x1, xa));
        const wRect = Math.max(0, Math.min(x1, xb) - x);
        if (wRect <= 0.5) continue;
        rects.push(`<rect class="${cls}" x="${x.toFixed(2)}" y="${y0}" width="${wRect.toFixed(2)}" height="${(y1-y0)}"></rect>`);
      }
      bandSvg = rects.join("");
    }

    return `
      <div class="chart">
        <svg viewBox="0 0 ${w} ${h}">
          ${bandSvg}
          ${gl.join("")}
          ${pathA ? `<path class="lineA" d="${pathA}"></path>` : ""}
          ${pathB ? `<path class="lineB ${dashedB ? "dash":""}" d="${pathB}"></path>` : ""}
        </svg>
      </div>
    `;
  }

  _panel(label, value, subLeft, subRight, chartHtml, extra="") {
    return `
      <div class="row"><div class="label">${label}</div><div class="value">${value}</div></div>
      <div class="sub"><span>${subLeft || ""}</span><span>${subRight || ""}</span></div>
      ${chartHtml || ""}
      ${extra || ""}
    `;
  }

  _parseForecast(entityId, start, end) {
    const st = this._state(entityId);
    if (!st) return [];
    const fc = st.attributes?.forecast;
    if (!Array.isArray(fc)) return [];
    const pts = [];
    for (const item of fc) {
      const t = Date.parse(item.period_start || item.datetime || item.time || "");
      if (!Number.isFinite(t)) continue;
      if (t < start.getTime() || t > end.getTime()) continue;
      const kw = parseFloatSafe(item.pv_estimate ?? item.estimate ?? item.value ?? item.power ?? null);
      if (kw === null) continue;
      pts.push({ t, v: kw * 1000 });
    }
    pts.sort((a,b)=>a.t-b.t);
    return pts;
  }

  _exportCsv() {
    if (!this._lastSeries || !this._lastRange) { this._update().then(() => this._exportCsv()); return; }
    const { start, end } = this._lastRange;
    const s = this._lastSeries;

    const headers = [
      "timestamp_iso","solar_power_w","solar_forecast_w","grid_power_w",
      "battery_power_w","battery_soc_pct","home_power_w","heatpump_power_w",
      "ev_power_w","outdoor_temp_c","tariff_state","unit_price_p_kwh"
    ];

    const allTs = new Set();
    for (const key of Object.keys(s)) for (const p of (s[key] || [])) allTs.add(p.t);
    const timeline = Array.from(allTs).sort((a,b)=>a-b);

    const lines = [];
    lines.push(headers.join(","));
    for (const t of timeline) {
      if (t < start.getTime() || t > end.getTime()) continue;
      const row = [
        new Date(t).toISOString(),
        seriesValueAt(s.solar, t),
        seriesValueAt(s.solar_forecast, t),
        seriesValueAt(s.grid, t),
        seriesValueAt(s.batt, t),
        seriesValueAt(s.soc, t),
        seriesValueAt(s.home, t),
        seriesValueAt(s.hp, t),
        seriesValueAt(s.ev, t),
        seriesValueAt(s.outdoor, t),
        stateAt(s.tariff_state, t),
        seriesValueAt(s.unit_price_p, t),
      ].map(escapeCsv);
      lines.push(row.join(","));
    }

    lines.push("");
    lines.push("summary_key,summary_value");
    if (this._money) {
      lines.push(`range,${escapeCsv(rangeLabel(this._config.range))}`);
      lines.push(`import_kwh,${this._money.import_kwh.toFixed(3)}`);
      lines.push(`export_kwh,${this._money.export_kwh.toFixed(3)}`);
      lines.push(`import_cost_gbp,${this._money.import_cost_gbp.toFixed(3)}`);
      lines.push(`export_income_gbp,${this._money.export_income_gbp.toFixed(3)}`);
      lines.push(`net_cost_gbp,${this._money.net_cost_gbp.toFixed(3)}`);
      if (this._money.avg_p_per_kwh !== null) lines.push(`avg_cost_p_per_kwh,${this._money.avg_p_per_kwh.toFixed(3)}`);
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `home_energy_dashboard_${this._config.range}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _update() {
    if (!this._config || !this._hass) return;

    const cfg = this._config;
    const e = cfg.entities;
    const opt = cfg.options;

    this.shadowRoot.getElementById("hed_title").textContent = cfg.title;

    const solarNow = this._num(e.solar_power);
    const gridNowRaw = this._num(e.grid_power);
    const battNowRaw = this._num(e.battery_power);
    const homeNow = this._num(e.home_power);
    const hpNow = this._num(e.heatpump_power);
    const evNow = this._num(e.ev_power);
    const socNow = this._num(e.battery_soc);
    const outNow = this._num(e.outdoor_temp);

    const gridNow = isNum(gridNowRaw) ? (opt.invert_grid ? -gridNowRaw : gridNowRaw) : null;
    const battNow = isNum(battNowRaw) ? (opt.invert_battery ? -battNowRaw : battNowRaw) : null;

    // Chips
    const tariffStateNow = this._state(e.tariff_state)?.state;
    const dispatchOn = this._state(e.dispatch_active)?.state === "on";
    const chips = [];
    if (dispatchOn) chips.push(this._chip("Intelligent Dispatch", "info"));
    if (tariffStateNow && tariffStateNow !== "unknown" && tariffStateNow !== "unavailable") {
      const t = String(tariffStateNow).toLowerCase();
      if (t.includes("off")) chips.push(this._chip("Off‑peak", "good"));
      else if (t.includes("peak")) chips.push(this._chip("Peak", "warn"));
      else if (t.includes("dispatch")) chips.push(this._chip("Dispatch", "info"));
      else chips.push(this._chip(tariffStateNow, ""));
    } else {
      chips.push(this._chip("Tariff: —", ""));
    }
    this.shadowRoot.getElementById("hed_chips").innerHTML = chips.join("");

    // Range
    const { start, end } = pickRange(cfg.range);
    this._lastRange = { start, end };
    const rLabel = rangeLabel(cfg.range);

    // Numeric histories
    const neededNumeric = [
      ["solar", e.solar_power],
      ["grid", e.grid_power],
      ["batt", e.battery_power],
      ["home", e.home_power],
      ["hp", e.heatpump_power],
      ["ev", e.ev_power],
      ["soc", e.battery_soc],
      ["outdoor", e.outdoor_temp],
      ["import_rate", e.import_rate],
      ["export_rate", e.export_rate],
    ].filter(([,id]) => !!id);

    const historyMap = new Map();
    await Promise.all(neededNumeric.map(async ([k, id]) => {
      try {
        const raw = await this._fetchHistory(id, start, end);
        let series = extractHistorySeries(raw);
        series.sort((a,b)=>a.t-b.t);
        series = downsample(series, cfg.max_points);
        historyMap.set(k, series);
      } catch (err) {
        console.warn("Home Energy Dashboard history fetch failed:", k, id, err);
        historyMap.set(k, []);
      }
    }));

    // Tariff timeline & bands
    let tariffTimeline = [];
    if (e.tariff_state) {
      try {
        const raw = await this._fetchHistory(e.tariff_state, start, end);
        tariffTimeline = extractHistoryStates(raw);
      } catch (err) {
        console.warn("Home Energy Dashboard tariff history fetch failed:", e.tariff_state, err);
      }
    }
    const bands = buildBandsFromStateTimeline(tariffTimeline, start.getTime(), end.getTime());

    // Inversions
    if (opt.invert_grid) {
      const s = historyMap.get("grid") || [];
      historyMap.set("grid", s.map(p => ({ t:p.t, v:-p.v })));
    }
    if (opt.invert_battery) {
      const s = historyMap.get("batt") || [];
      historyMap.set("batt", s.map(p => ({ t:p.t, v:-p.v })));
    }

    const solarForecast = e.solar_forecast ? downsample(this._parseForecast(e.solar_forecast, start, end), cfg.max_points) : [];

    // Money & unit price series
    const gridSeries = historyMap.get("grid") || [];
    const importRateSeries = historyMap.get("import_rate") || [];
    const exportRateSeries = historyMap.get("export_rate") || [];
    this._money = computeGridMoneyAndUnitPrice(gridSeries, importRateSeries, exportRateSeries, start.getTime(), end.getTime());

    // Store for export
    this._lastSeries = {
      solar: historyMap.get("solar") || [],
      solar_forecast: solarForecast,
      grid: gridSeries,
      batt: historyMap.get("batt") || [],
      soc: historyMap.get("soc") || [],
      home: historyMap.get("home") || [],
      hp: historyMap.get("hp") || [],
      ev: historyMap.get("ev") || [],
      outdoor: historyMap.get("outdoor") || [],
      tariff_state: tariffTimeline || [],
      unit_price_p: (this._money.unit_price_series_p || []),
    };

    // Solar
    const solarSeries = historyMap.get("solar") || [];
    const solarDom = seriesMinMax([solarSeries, solarForecast]);
    const solarChart = this._renderChart({ seriesA: solarSeries, seriesB: solarForecast, dashedB: true, yDomain: solarDom });
    this.shadowRoot.getElementById("c_solar").innerHTML = this._panel("Solar", fmtW(solarNow), e.solar_forecast ? "Actual + forecast" : "Actual", rLabel, solarChart);

    // Grid chart: overlay unit price (p/kWh) scaled onto grid-power axis
    let unitMapped = [];
    let yDomainGrid = null;
    const gridMM = seriesMinMax([gridSeries]);
    if (gridMM) {
      const dom = niceDomain(gridMM.min, gridMM.max);
      yDomainGrid = dom;
      const yMin = dom.min, yMax = dom.max;
      const u = this._money.unit_price_series_p || [];
      if (u.length > 0) {
        const umm = seriesMinMax([u]);
        if (umm) {
          const uMin = umm.min, uMax = umm.max;
          const denom = Math.max(0.0001, (uMax - uMin));
          unitMapped = u.map(p => ({ t: p.t, v: yMin + ((p.v - uMin) / denom) * (yMax - yMin) }));
        }
      }
    }
    const gridChart = this._renderChart({ seriesA: gridSeries, seriesB: unitMapped, dashedB: true, yDomain: yDomainGrid, bands });

    const gridFlow = isNum(gridNow) ? (gridNow >= 0 ? "Import" : "Export") : "—";
    const net = this._money ? this._money.net_cost_gbp : null;
    const avgP = this._money ? this._money.avg_p_per_kwh : null;

    const extra = `
      <div class="sub"><span>${avgP !== null ? ("Avg " + fmtPPerKwh(avgP)) : "Avg —"}</span><span>Dashed: p/kWh</span></div>
      <div class="sub"><span>Tariff shading</span><span>${e.tariff_state ? "Peak/Off‑peak/Dispatch" : "Add tariff_state"}</span></div>
    `;
    this.shadowRoot.getElementById("c_grid").innerHTML = this._panel("Grid", fmtGBP(net), `${gridFlow} • Net for ${rLabel}`, e.import_rate ? "" : "Add import_rate", gridChart, extra);

    // Battery: power + SoC overlay (scaled)
    const battSeries = historyMap.get("batt") || [];
    const socSeries = historyMap.get("soc") || [];
    const battMM = seriesMinMax([battSeries]);
    let socMapped = [];
    let yDomainBatt = null;
    if (battMM) {
      const dom = niceDomain(battMM.min, battMM.max);
      yDomainBatt = dom;
      const yMin = dom.min, yMax = dom.max;
      socMapped = socSeries.map(p => ({ t:p.t, v: yMin + (clamp(p.v,0,100)/100) * (yMax - yMin) }));
    }
    const battChart = this._renderChart({ seriesA: battSeries, seriesB: socMapped, dashedB: true, yDomain: yDomainBatt });
    const battSub = isNum(battNow) ? (battNow >= 0 ? "Charging" : "Discharging") : "—";
    this.shadowRoot.getElementById("c_batt").innerHTML = this._panel("Battery", `${fmtPct(socNow)} • ${fmtW(battNow)}`, battSub, rLabel, battChart);

    // Home
    const homeSeries = historyMap.get("home") || [];
    const homeChart = this._renderChart({ seriesA: homeSeries });
    this.shadowRoot.getElementById("c_home").innerHTML = this._panel("Home", fmtW(homeNow), "Load", rLabel, homeChart);

    // Heat pump + outside temp overlay (scaled)
    const hpSeries = historyMap.get("hp") || [];
    const outdoorSeries = historyMap.get("outdoor") || [];
    const hpMM = seriesMinMax([hpSeries]);
    let outdoorMapped = [];
    let yDomainHp = null;
    if (hpMM) {
      const dom = niceDomain(hpMM.min, hpMM.max);
      yDomainHp = dom;
      if (outdoorSeries.length > 0) {
        const tmm = seriesMinMax([outdoorSeries]);
        if (tmm) {
          const tMin = tmm.min, tMax = tmm.max;
          const yMin = dom.min, yMax = dom.max;
          const denom = Math.max(0.0001, (tMax - tMin));
          outdoorMapped = outdoorSeries.map(p => ({ t: p.t, v: yMin + ((p.v - tMin) / denom) * (yMax - yMin) }));
        }
      }
    }
    const hpChart = this._renderChart({ seriesA: hpSeries, seriesB: outdoorMapped, dashedB: true, yDomain: yDomainHp });
    const hpExtra = outdoorSeries.length
      ? `<div class="sub"><span>Outside</span><span>${fmtTemp(outNow)} (overlay)</span></div>`
      : `<div class="sub"><span>Outside</span><span>— (add outdoor_temp)</span></div>`;
    this.shadowRoot.getElementById("c_hp").innerHTML = this._panel("Heat Pump", fmtW(hpNow), "Vaillant", rLabel, hpChart, hpExtra);

    // EV
    const evSeries = historyMap.get("ev") || [];
    const evChart = this._renderChart({ seriesA: evSeries });
    const evSub = isNum(evNow) ? (evNow > 50 ? "Charging" : "Idle") : "—";
    this.shadowRoot.getElementById("c_ev").innerHTML = this._panel("EV Charger", fmtW(evNow), evSub, rLabel, evChart);

    // Footer
    const missing = [];
    for (const [k, id] of Object.entries(e)) {
      if (!id) continue;
      if (!this._hass.states[id]) missing.push(`${k}: ${id}`);
    }
    const notes = [];
    if (!e.tariff_state) notes.push("Add entities.tariff_state for peak/off‑peak/dispatch shading.");
    if (!e.import_rate) notes.push("Add entities.import_rate (Octopus current rate) for £ and p/kWh overlays.");
    this.shadowRoot.getElementById("hed_foot").innerHTML = missing.length
      ? `Missing entities: <code>${missing.join("</code>, <code>")}</code>`
      : (notes.length ? notes.join(" ") : `Tip: Export CSV includes a summary footer (net £, avg p/kWh, import/export kWh).`);
  }
}

customElements.define(CARD_TAG, HomeEnergyDashboardCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Home Energy Dashboard",
  description: "NetZero-style 6-graph energy dashboard with tariff shading, p/kWh trend, net £, outdoor-temp overlay, calendar year views, and CSV export."
});
