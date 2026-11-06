var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var BASE = "https://a.windbornesystems.com/treasure/";
var ok = /* @__PURE__ */ __name((r) => Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every(Number.isFinite) && Math.abs(r[0]) <= 90 && Math.abs(r[1]) <= 180 && r[2] >= -1 && r[2] <= 60, "ok");
var NUM = "(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)";
function parse(t) {
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return { regex: false, pts: j.map((r) => ok(r) ? r.slice(0, 3).map((x) => +x.toFixed(3)) : null) };
  } catch {
  }
  const re = new RegExp(`\\[\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\]`, "gi"), out = [];
  let m;
  while (m = re.exec(t)) {
    const r = [+m[1], +m[2], +m[3]];
    out.push(ok(r) ? r : null);
  }
  return out.length ? { regex: true, pts: out } : null;
}
__name(parse, "parse");
var hourKey = /* @__PURE__ */ __name((t) => "snap:" + String(t).padStart(10, "0"), "hourKey");
async function ingest(env) {
  const nowH = Math.floor(Date.now() / 36e5);
  const res = await Promise.all([...Array(24).keys()].map(async (h) => {
    try {
      const r = await fetch(`${BASE}${String(h).padStart(2, "0")}.json`);
      if (!r.ok) return 0;
      const p = parse(await r.text());
      if (!p) return 0;
      const q = { n: p.pts.length, bad: p.pts.filter((x) => !x).length, regex: p.regex };
      await env.HIST.put(hourKey(nowH - h), JSON.stringify({ pts: p.pts, q }), { expirationTtl: 60 * 86400 });
      return 1;
    } catch {
      return 0;
    }
  }));
  return res.reduce((a, b) => a + b, 0);
}
__name(ingest, "ingest");
var cors = { "access-control-allow-origin": "*", "content-type": "application/json", "cache-control": "public, max-age=120" };
var src_default = {
  scheduled: /* @__PURE__ */ __name((_e, env, ctx) => ctx.waitUntil(ingest(env)), "scheduled"),
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/api/ingest") return new Response(JSON.stringify({ stored: await ingest(env) }), { headers: cors });
    if (u.pathname === "/api/chat" && req.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500, headers: cors });
      const { messages = [], context = "" } = await req.json();
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          system: "You analyse WindBorne weather-balloon data. The JSON context compares balloon-measured wind (from hourly displacement) with Open-Meteo model wind at each balloon's pressure level, plus data-quality stats. Answer only from the context, be concise, cite numbers, and say when the context is insufficient. Balloons are matched across hours by array index, so mention that caveat when relevant.\n\nCONTEXT:\n" + context.slice(0, 2e4),
          messages: messages.slice(-10)
        })
      });
      const j = await r.json();
      return new Response(JSON.stringify({ reply: j.content?.map((c) => c.text || "").join("") || j.error?.message || "No reply" }), { headers: { ...cors, "cache-control": "no-store" } });
    }
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" } });
    if (u.pathname === "/api/history") {
      const hours = Math.min(+u.searchParams.get("hours") || 24, 168);
      let { keys } = await env.HIST.list({ prefix: "snap:", limit: 1e3 });
      if (!keys.length) {
        await ingest(env);
        ({ keys } = await env.HIST.list({ prefix: "snap:" }));
      }
      const want = keys.map((k) => k.name).sort().reverse().slice(0, hours);
      const vals = await Promise.all(want.map((k) => env.HIST.get(k, "json")));
      return new Response(JSON.stringify({ updated: Date.now(), hours: want.map((k, i) => ({ t: +k.slice(5), pts: vals[i]?.pts ?? vals[i], q: vals[i]?.q ?? null })) }), { headers: cors });
    }
    return new Response(JSON.stringify({ ok: true, routes: ["/api/history?hours=72", "/api/ingest"] }), { headers: cors });
  }
};

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-dJDC9a/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-dJDC9a/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
