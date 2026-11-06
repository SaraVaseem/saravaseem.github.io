const BASE = "https://a.windbornesystems.com/treasure/";
const ok = r => Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every(Number.isFinite) &&
  Math.abs(r[0]) <= 90 && Math.abs(r[1]) <= 180 && r[2] >= -1 && r[2] <= 60;
const NUM = "(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)";
function parse(t) { // tolerate corrupted files
  try { const j = JSON.parse(t); if (Array.isArray(j)) return { regex: false, pts: j.map(r => ok(r) ? r.slice(0, 3).map(x => +x.toFixed(3)) : null) }; } catch {}
  const re = new RegExp(`\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]`, "gi"), out = []; let m;
  while ((m = re.exec(t))) { const r = [+m[1], +m[2], +m[3]]; out.push(ok(r) ? r : null); }
  return out.length ? { regex: true, pts: out } : null;
}
const hourKey = t => "snap:" + String(t).padStart(10, "0"); // t = unix hour
async function ingest(env) {
  const nowH = Math.floor(Date.now() / 3.6e6);
  const res = await Promise.all([...Array(24).keys()].map(async h => {
    try {
      const r = await fetch(`${BASE}${String(h).padStart(2, "0")}.json`); if (!r.ok) return 0;
      const p = parse(await r.text()); if (!p) return 0;
      const q = { n: p.pts.length, bad: p.pts.filter(x => !x).length, regex: p.regex }; // data-quality metadata
      await env.HIST.put(hourKey(nowH - h), JSON.stringify({ pts: p.pts, q }), { expirationTtl: 60 * 86400 }); // later runs overwrite/backfill
      return 1;
    } catch { return 0; }
  }));
  return res.reduce((a, b) => a + b, 0);
}
const cors = { "access-control-allow-origin": "*", "content-type": "application/json", "cache-control": "public, max-age=120" };
export default {
  scheduled: (_e, env, ctx) => ctx.waitUntil(ingest(env)),
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/ingest") return new Response(JSON.stringify({ stored: await ingest(env) }), { headers: cors });
    if (u.pathname === "/api/chat" && req.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500, headers: cors });
      const { messages = [], context = "" } = await req.json();
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 600,
          system: "You analyse WindBorne weather-balloon data. The JSON context compares balloon-measured wind (from hourly displacement) with Open-Meteo model wind at each balloon's pressure level, plus data-quality stats. Answer only from the context, be concise, cite numbers, and say when the context is insufficient. Balloons are matched across hours by array index, so mention that caveat when relevant.\n\nCONTEXT:\n" + context.slice(0, 20000),
          messages: messages.slice(-10) }) });
      const j = await r.json();
      return new Response(JSON.stringify({ reply: j.content?.map(c => c.text || "").join("") || j.error?.message || "No reply" }), { headers: { ...cors, "cache-control": "no-store" } });
    }
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" } });
    if (u.pathname === "/api/history") {
      const hours = Math.min(+u.searchParams.get("hours") || 24, 168);
      let { keys } = await env.HIST.list({ prefix: "snap:", limit: 1000 });
      if (!keys.length) { await ingest(env); ({ keys } = await env.HIST.list({ prefix: "snap:" })); } // cold start
      const want = keys.map(k => k.name).sort().reverse().slice(0, hours);
      const vals = await Promise.all(want.map(k => env.HIST.get(k, "json")));
      return new Response(JSON.stringify({ updated: Date.now(), hours: want.map((k, i) => ({ t: +k.slice(5), pts: vals[i]?.pts ?? vals[i], q: vals[i]?.q ?? null })) }), { headers: cors });
    }
    return new Response(JSON.stringify({ ok: true, routes: ["/api/history?hours=72", "/api/ingest"] }), { headers: cors });
  },
};
