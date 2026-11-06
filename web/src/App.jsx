import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
const API = import.meta.env.VITE_API || "";
const LV = [850, 700, 500, 300, 250, 200, 150, 100, 70, 50, 30];
const pres = km => { const h = km * 1000; return h < 11000 ? 1013.25 * (1 - 2.25577e-5 * h) ** 5.25588 : 226.32 * Math.exp(-(h - 11000) / 6341.6); };
const lvl = p => LV.reduce((a, b) => Math.abs(Math.log(b / p)) < Math.abs(Math.log(a / p)) ? b : a);
const spd = w => Math.hypot(w.u, w.v);

const wind = (a, b) => { let dl = a[1] - b[1]; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  return { u: dl * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180) * 111320 / 3600, v: (a[0] - b[0]) * 111320 / 3600 }; };
const QC = { ok: "#3ddc97", suspect: "#ffb020", lost: "#ff4d5a" };

function useHistory(hours) {            // history from our KV-backed API (+ per-hour quality metadata)
  const [s, set] = useState({ H: [], Q: [], err: null, loading: true });
  useEffect(() => {
    let dead = false;
    const go = async () => { try {
      const j = await (await fetch(`${API}/api/history?hours=${hours}`)).json();
      if (!dead) set({ H: j.hours.map(h => h.pts), Q: j.hours.map(h => h.q), err: null, loading: false, at: j.updated });
    } catch (e) { if (!dead) set(x => ({ ...x, err: String(e), loading: false })); } };
    go(); const id = setInterval(go, 3e5); return () => { dead = true; clearInterval(id); };
  }, [hours]);
  return s;
}
function useModel(H, hours) {           // Open-Meteo wind for a 150-balloon sample
  const [m, set] = useState({ sample: [], M: null });
  useEffect(() => {
    if (!H[1]) return; let dead = false;
    (async () => {
      const idx = H[0].map((_, i) => i).filter(i => H[0][i] && H[1][i]).sort(() => Math.random() - .5).slice(0, 150);
      const vars = LV.flatMap(l => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`]).join(","), M = {};
      try {
        for (let c = 0; c < idx.length; c += 50) {
          const ch = idx.slice(c, c + 50), f = a => ch.map(i => H[0][i][a].toFixed(2)).join(",");
          let j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${f(0)}&longitude=${f(1)}&hourly=${vars}&wind_speed_unit=ms&timezone=GMT&past_days=${Math.ceil(hours / 24)}&forecast_days=1`)).json();
          if (!Array.isArray(j)) j = [j]; ch.forEach((i, k) => (M[i] = j[k].hourly));
        }
        if (!dead) set({ sample: idx, M });
      } catch { if (!dead) set({ sample: [], M: null }); }
    })();
    return () => { dead = true; };
  }, [H.length && H[0], hours]);
  return m;
}
function classify(H, k) {               // ok | suspect (implausible jump) | lost (missing/corrupted this hour)
  const cur = H[k] || [], prev = H[k + 1] || [], out = [], n = Math.max(cur.length, prev.length);
  for (let i = 0; i < n; i++) {
    let a = cur[i], st = "ok", bw = null;
    if (!a) { let h = k + 1; while (h < H.length && !H[h]?.[i]) h++; a = H[h]?.[i]; if (!a) continue; st = "lost"; }
    else if (prev[i]) { bw = wind(a, prev[i]); if (spd(bw) > 100 || Math.abs(a[2] - prev[i][2]) > 8) { st = "suspect"; bw = null; } }
    out.push({ i, a, st, bw });
  }
  return out;
}
function records(cls, { sample, M }, past, k) {
  const out = [], ix = past * 24 + new Date().getUTCHours() - k, by = {}; cls.forEach(c => (by[c.i] = c));
  for (const i of sample) {
    const c = by[i], h = M?.[i]; if (!c || c.st !== "ok" || !c.bw || !h) continue;
    const L = lvl(pres(c.a[2])), s = h[`wind_speed_${L}hPa`]?.[ix], d = h[`wind_direction_${L}hPa`]?.[ix];
    if (!Number.isFinite(s) || !Number.isFinite(d)) continue;
    const r = d * Math.PI / 180, mw = { u: -s * Math.sin(r), v: -s * Math.cos(r) };
    out.push({ i, lat: c.a[0], lon: c.a[1], alt: c.a[2], bw: c.bw, mw, L, err: Math.hypot(c.bw.u - mw.u, c.bw.v - mw.v) });
  }
  return out;
}
const colorOf = (c, mode, rec) => mode === "quality" ? QC[c.st] : mode === "err" ? (rec ? `hsl(${Math.max(0, 130 - rec.err * 8)},90%,55%)` : "#667")
  : mode === "speed" ? (c.bw ? `hsl(${260 - Math.min(spd(c.bw), 60) * 4},90%,60%)` : "#667") : `hsl(${230 - Math.min(c.a[2], 22) / 22 * 200},85%,58%)`;
const vec = (lat, lon, w) => [[lon, lat], [lon + w.u * 3600 / (111320 * Math.cos(lat * Math.PI / 180)), lat + w.v * 3600 / 111320]]; // true 1-hour displacement

function Spark({ H, i }) {
  const pts = H.map((h, k) => [k, h?.[i]?.[2]]).filter(p => p[1] != null).reverse(); if (pts.length < 2) return null;
  const n = H.length, d = pts.map(([k, a]) => `${(1 - k / (n - 1)) * 300},${50 - a / 22 * 46}`).join(" ");
  return <svg viewBox="0 0 300 54" width="100%"><polyline points={d} fill="none" stroke="var(--acc)" strokeWidth="2" /></svg>;
}
function Chat({ context }) {            // insight bot: Worker -> Claude, grounded in the Open-Meteo comparison
  const [msgs, set] = useState([]), [txt, setTxt] = useState(""), [busy, setBusy] = useState(false);
  const send = async q => {
    if (!q.trim() || busy) return; const next = [...msgs, { role: "user", content: q }]; set(next); setTxt(""); setBusy(true);
    try { const j = await (await fetch(`${API}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next, context }) })).json();
      set([...next, { role: "assistant", content: j.reply || j.error }]); } catch (e) { set([...next, { role: "assistant", content: "Chat unavailable: " + e }]); }
    setBusy(false);
  };
  return <div className="chat"><h3>Ask the data</h3>
    <div className="msgs">{msgs.map((m, i) => <p key={i} className={m.role[0]}>{m.content}</p>)}{busy && <p>thinking…</p>}</div>
    {!msgs.length && <div className="chips">{["Where is the forecast worst and why?", "How trustworthy is today's data?", "Which altitude band disagrees most?"].map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>}
    <form onSubmit={e => { e.preventDefault(); send(txt); }}><input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Ask about the balloons…" /><button>Send</button></form></div>;
}

export default function App() {
  const [hours, setHours] = useState(48), [k, setK] = useState(0), [mode, setMode] = useState("quality");
  const [trails, setTrails] = useState(true), [arrows, setArrows] = useState(true), [play, setPlay] = useState(false), [sel, setSel] = useState(-1);
  const { H, Q, err, loading, at } = useHistory(hours), model = useModel(H, hours), box = useRef(), mapRef = useRef(), [ready, setReady] = useState(false);
  const past = Math.ceil(hours / 24), kk = Math.min(k, Math.max(H.length - 2, 0));
  const cls = useMemo(() => classify(H, kk), [H, kk]), rec = useMemo(() => records(cls, model, past, kk), [cls, model, past, kk]);
  useEffect(() => { if (!play) return; const id = setInterval(() => setK(x => x <= 0 ? Math.max(H.length - 2, 0) : x - 1), 300); return () => clearInterval(id); }, [play, H.length]);

  useEffect(() => {                     // map setup (MapLibre GL)
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const m = new maplibregl.Map({ container: box.current, center: [0, 20], zoom: 1.3, attributionControl: { compact: true },
      style: `https://basemaps.cartocdn.com/gl/${dark ? "dark-matter" : "positron"}-gl-style/style.json` });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    m.on("load", () => {
      const E = { type: "FeatureCollection", features: [] };
      ["trails", "arrows", "balloons"].forEach(id => m.addSource(id, { type: "geojson", data: E }));
      m.addLayer({ id: "trails", type: "line", source: "trails", paint: { "line-color": ["get", "c"], "line-opacity": .35, "line-width": 1.2 } });
      m.addLayer({ id: "arrows", type: "line", source: "arrows", paint: { "line-color": ["match", ["get", "k"], "meas", "#4da3ff", "#c8d0da"], "line-width": 2 } });
      m.addLayer({ id: "balloons", type: "circle", source: "balloons", paint: { "circle-color": ["get", "c"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 6, 7],
        "circle-stroke-color": ["match", ["get", "st"], "suspect", QC.suspect, "lost", QC.lost, "rgba(0,0,0,0)"], "circle-stroke-width": ["match", ["get", "st"], "ok", 0, 2.5],
        "circle-opacity": ["match", ["get", "st"], "lost", .45, 1] } });
      m.addLayer({ id: "sel", type: "circle", source: "balloons", filter: ["==", ["get", "i"], -1], paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.on("click", "balloons", e => { const f = e.features[0], p = f.properties; setSel(p.i);
        new maplibregl.Popup({ closeButton: false }).setLngLat(f.geometry.coordinates).setHTML(`<b>#${p.i}</b> · ${p.st}<br>${(+p.alt).toFixed(1)} km${p.info ? "<br>" + p.info : ""}`).addTo(m); });
      m.on("mouseenter", "balloons", () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", "balloons", () => (m.getCanvas().style.cursor = ""));
      mapRef.current = m; setReady(true);
    });
    return () => m.remove();
  }, []);
  useEffect(() => {                     // push data into the map
    const m = mapRef.current; if (!ready || !m) return; const byR = {}; rec.forEach(r => (byR[r.i] = r));
    m.getSource("balloons").setData({ type: "FeatureCollection", features: cls.map(c => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.a[1], c.a[0]] },
      properties: { i: c.i, st: c.st, alt: c.a[2], c: colorOf(c, mode, byR[c.i]), info: byR[c.i] ? `measured ${spd(byR[c.i].bw).toFixed(1)} · model ${spd(byR[c.i].mw).toFixed(1)} m/s` : "" } })) });
    const tr = [];
    if (trails) cls.forEach(c => { let seg = [], last = null; const flush = () => { if (seg.length > 1) tr.push({ type: "Feature", properties: { c: colorOf(c, mode, byR[c.i]) }, geometry: { type: "LineString", coordinates: seg } }); seg = []; };
      for (let h = Math.min(H.length - 1, kk + 24); h >= kk; h--) { const q = H[h]?.[c.i]; if (!q || (last && Math.abs(q[1] - last[1]) > 30)) flush(); if (q) { seg.push([q[1], q[0]]); last = q; } } flush(); });
    m.getSource("trails").setData({ type: "FeatureCollection", features: tr });
    m.getSource("arrows").setData({ type: "FeatureCollection", features: arrows ? rec.flatMap(r => [["meas", r.bw], ["model", r.mw]].map(([k2, w]) => ({ type: "Feature", properties: { k: k2 }, geometry: { type: "LineString", coordinates: vec(r.lat, r.lon, w) } }))) : [] });
  }, [ready, cls, rec, mode, trails, arrows, H, kk]);
  useEffect(() => { if (ready) mapRef.current.setFilter("sel", ["==", ["get", "i"], sel]); }, [sel, ready]);

  const nq = { ok: 0, suspect: 0, lost: 0 }; cls.forEach(c => nq[c.st]++);
  const stat = useMemo(() => {
    if (!rec.length) return null; const e = rec.map(r => r.err).sort((a, b) => a - b), g = {}; rec.forEach(r => (g[r.L] = g[r.L] || []).push(r.err));
    const avg = Object.fromEntries(Object.entries(g).map(([l, a]) => [l, +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2)]));
    return { med: e[e.length >> 1], bad: e.filter(v => v > 5).length / e.length, avg, mx: Math.max(...Object.values(avg)), top: [...rec].sort((a, b) => b.err - a.err).slice(0, 6) };
  }, [rec]);
  const context = useMemo(() => JSON.stringify({ hours_ago: kk, hours_stored: H.length, balloons: nq,
    feed_quality_last_24h: Q.slice(0, 24).map(q => q && { invalid_rows: q.bad, total: q.n, regex_recovered: q.regex }),
    open_meteo_comparison: stat && { sample_size: rec.length, median_error_ms: +stat.med.toFixed(2), share_over_5ms: +stat.bad.toFixed(2), mean_error_by_hpa: stat.avg,
      top_misses: stat.top.map(r => ({ lat: +r.lat.toFixed(1), lon: +r.lon.toFixed(1), alt_km: +r.alt.toFixed(1), hpa: r.L, measured_ms: +spd(r.bw).toFixed(1), model_ms: +spd(r.mw).toFixed(1) })) } }), [kk, H.length, nq.ok, nq.suspect, nq.lost, Q, stat]);
  const csv = () => { const t = "balloon,lat,lon,alt_km,measured_ms,model_ms,err_ms\n" + rec.map(r => [r.i, r.lat, r.lon, r.alt, spd(r.bw), spd(r.mw), r.err].join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t])); a.download = "wind-truth.csv"; a.click(); };
  const qcol = q => !q ? "var(--line)" : q.bad / Math.max(q.n, 1) > .02 ? QC.lost : q.bad || q.regex ? QC.suspect : QC.ok;

  return <>
    <header><h1>🎈 Wind Truth</h1>
      <p className="sub">Balloons as drifting wind sensors, checked against the Open-Meteo model. Colours flag data quality: healthy, suspect (implausible jump) or lost (missing or corrupted this hour).</p>
      <span className="pill">{err ? "API error: " + err : loading ? "loading…" : `${H.length} h in store · updated ${new Date(at).toLocaleTimeString()}`}</span></header>
    <main>
      <section className="card map"><div ref={box} className="mapbox" />
        <div className="ctl">
          <button onClick={() => setPlay(!play)}>{play ? "⏸" : "▶"}</button>
          <input type="range" min="0" max={Math.max(H.length - 2, 0)} value={kk} onChange={e => setK(+e.target.value)} /><span>{kk ? `${kk} h ago` : "now"}</span>
          <select value={mode} onChange={e => setMode(e.target.value)}><option value="quality">color: data quality</option><option value="alt">color: altitude</option><option value="err">color: model error</option><option value="speed">color: wind speed</option></select>
          <select value={hours} onChange={e => setHours(+e.target.value)}>{[24, 48, 72, 168].map(h => <option key={h} value={h}>{h} h history</option>)}</select>
          <label><input type="checkbox" checked={trails} onChange={e => setTrails(e.target.checked)} /> trails</label>
          <label><input type="checkbox" checked={arrows} onChange={e => setArrows(e.target.checked)} /> arrows</label>
          <button onClick={csv} disabled={!rec.length}>⬇ CSV</button></div>
        <div className="qs" title="Feed health per hour (left = now)">{Q.slice(0, H.length - 1).map((q, i) => <i key={i} style={{ background: qcol(q), outline: i === kk ? "2px solid var(--ink)" : "none" }} title={q ? `${i} h ago: ${q.bad}/${q.n} invalid${q.regex ? ", regex-recovered" : ""}` : "no metadata"} />)}</div>
        <div className="leg">{Object.entries(QC).map(([k2, c]) => <span key={k2}><i style={{ background: c }} />{k2} ({nq[k2]})</span>)}<span>blue arrow = measured wind, grey = model (true 1 h displacement)</span></div>
      </section>
      <aside className="card">
        <div className="kp"><div><b>{nq.ok + nq.suspect}</b><span>balloons reporting</span></div><div><b>{nq.lost + nq.suspect}</b><span>lost or suspect</span></div>
          <div><b>{stat ? stat.med.toFixed(1) : "–"}</b><span>median error (m/s)</span></div><div><b>{stat ? Math.round(stat.bad * 100) + "%" : "–"}</b><span>off by &gt;5 m/s</span></div></div>
        <h3>Model error by pressure level</h3>
        {stat ? LV.filter(l => stat.avg[l]).map(l => <div className="row" key={l}><span>{l} hPa</span><div className="bar" style={{ width: stat.avg[l] / stat.mx * 100 + "%" }} /><span>{stat.avg[l]}</span></div>) : <span style={{ color: "var(--mute)" }}>waiting for weather model…</span>}
        <h3>Biggest forecast misses</h3>
        {stat?.top.map(r => <div className="out" key={r.i} onClick={() => { setSel(r.i); mapRef.current?.flyTo({ center: [r.lon, r.lat], zoom: 4 }); }}><span>{r.lat.toFixed(1)}°, {r.lon.toFixed(1)}° · {r.alt.toFixed(1)} km</span><b>{r.err.toFixed(1)} m/s</b></div>)}
        {sel >= 0 && <><h3>Balloon #{sel} altitude</h3><Spark H={H} i={sel} /></>}
        <Chat context={context} />
      </aside>
    </main>
    <div className="notes"><p><b>Notes.</b> I chose Open-Meteo because balloons are passive drifters, so their motion directly measures wind, and Open-Meteo serves free, keyless model winds by pressure level, the natural ground truth to check them against. The feed has no IDs, so balloons are matched by array index; jumps over 100 m/s or 8 km altitude are flagged suspect.</p></div>
  </>;
}
