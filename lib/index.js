// dsh-lobsterai-daddy — host half.
//
// Responsibilities:
//   1. register a loopback-only status route (/dsh-lobsterai-daddy/status) so the
//      bundle has a real cordis activate (inject = ['webServer']);
//   2. expose /dsh-lobsterai-daddy/panel/* as a same-origin reverse proxy to the
//      LobsterDaddy panel (127.0.0.1:17819). The drawer inside the DSH page loads
//      the console THROUGH this proxy, which avoids any cross-origin / cookie /
//      CSP friction in Electron and keeps the markup byte-identical to the web
//      console — that is what makes "界面和网页一致" hold.
//
// The visual work lives in lib/client.js, mounted by the client-modules system
// once the host activates.

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// node:sqlite is CJS-flavoured and optional across Node builds, so it is resolved through
// a require created from this module's own URL (never a bare `require` in ESM).
const require = createRequire(import.meta.url);

var PKG_VERSION = (function () {
  try {
    var here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch (e) {
    return "unknown";
  }
})();

// Is a given account the one LobsterAI is currently signed in as?
//
// The panel's /api/status does not expose this, and the renderer cannot read SQLite, so
// the Host answers it. The console's own CLI does exactly this: it reads the `kv` table
// of `%APPDATA%\LobsterAI\lobsterai.sqlite` (keys `auth_tokens` / `auth_user`) — that is
// the authoritative "currently signed-in account" record, and it is rewritten whenever
// LobsterDaddy switches accounts, so polling it makes the UI self-updating.
//
// Read-only and best-effort: any failure reports `available:false` rather than throwing,
// because this must never break /status.
function readCurrentAccountId() {
  var dbPath = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "LobsterAI", "lobsterai.sqlite");
  try {
    if (!existsSync(dbPath)) return { available: false, reason: "db-missing" };
    // Resolved lazily so a Node build without node:sqlite still mounts the plugin.
    var sqlite = null;
    try { sqlite = require("node:sqlite"); } catch (e) { sqlite = null; }
    if (!sqlite || !sqlite.DatabaseSync) return { available: false, reason: "no-sqlite" };

    var db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      var stmt = db.prepare("SELECT value FROM kv WHERE key = ?");
      var tokensRow = stmt.get("auth_tokens");
      var userRow = stmt.get("auth_user");
      if (!tokensRow) return { available: true, uid: null, reason: "nologin" };
      var tokens = {};
      var user = {};
      try { tokens = JSON.parse(tokensRow.value); } catch (e) { tokens = {}; }
      try { user = userRow ? JSON.parse(userRow.value) : {}; } catch (e) { user = {}; }
      if (!tokens || !tokens.accessToken) return { available: true, uid: null, reason: "nologin" };
      // Verified against the live store (2026-09-28): `auth_user` is
      // { yid, avatarUrl, nickname, id, status } — the account id lives in `id`, NOT
      // `userId`. The JWT `sub` carries the same value as a fallback.
      var uid = user.id != null ? String(user.id)
        : (user.userId != null ? String(user.userId) : null);
      if (!uid) {
        var payload = decodeJwtPayload(String(tokens.accessToken));
        uid = payload && (payload.sub || payload.uid) ? String(payload.sub || payload.uid) : null;
      }
      return {
        available: true,
        uid: uid,
        name: user.nickname || user.phone || user.yid || null,
      };
    } finally {
      try { db.close(); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    return { available: false, reason: String(e && e.message || e) };
  }
}

// Decode a JWT payload without verifying the signature — we only read the subject, and
// the token came from LobsterAI's own store.
function decodeJwtPayload(token) {
  try {
    var parts = String(token).split(".");
    if (parts.length < 2) return null;
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}

var ROUTE_PREFIX = "/dsh-lobsterai-daddy";
var PANEL_PORT_DEFAULT = 17819;
var PANEL_TIMEOUT_MS = 20000;
// Probe timeout: the panel answers /api/status from cache in ~3ms, but its FIRST
// call after a cache expiry (or right after the panel restarts) fans out to every
// account and was measured at 7.4s. A 3s probe timeout therefore reported
// running=false while the panel was perfectly healthy — that is the real cause of
// the "面板当前没有响应，点重新连接才行" report (verified 2026-09-25). 12s covers it.
var PANEL_PROBE_TIMEOUT_MS = 12000;

export var name = "dsh-lobsterai-daddy";
export var inject = ["webServer"];

function isLoopback(req) {
  var a = (req.socket && req.socket.remoteAddress) || "";
  var n = a.toLowerCase();
  if (n === "::1") return true;
  if (n.startsWith("::ffff:")) return n.slice(7).startsWith("127.");
  return n.startsWith("127.");
}

// Probe the panel: resolve { running, port, status } without throwing.
function probePanel(port) {
  return new Promise(function (resolve) {
    var req = http.request(
      { host: "127.0.0.1", port: port, path: "/api/status", method: "GET", timeout: PANEL_PROBE_TIMEOUT_MS },
      function (res) {
        var body = "";
        res.on("data", function (c) { body += c; });
        res.on("end", function () {
          var parsed = null;
          try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
          resolve({
            running: res.statusCode === 200,
            httpStatus: res.statusCode,
            accounts: parsed && Array.isArray(parsed.accounts) ? parsed.accounts.length : null,
            gatewayPort: parsed && parsed.gateway ? parsed.gateway.port : null,
          });
        });
      }
    );
    req.on("timeout", function () { req.destroy(); resolve({ running: false, httpStatus: 0, error: "timeout" }); });
    req.on("error", function (e) { resolve({ running: false, httpStatus: 0, error: String(e && e.message || e) }); });
    req.end();
  });
}

// Reverse-proxy one request to the panel and stream the response back.
//
// HTML responses get a shim injected: the LobsterDaddy console is a single page
// whose own JS calls ABSOLUTE paths (`fetch('/api/status')`). Served inside an
// iframe at /dsh-lobsterai-daddy/panel/ those absolute calls resolve against the
// DSH origin root, hit a non-existent route, and come back as the plain text
// "not found" — which the console then reports as
// `刷新失败：Unexpected token 'o', "not found" is not valid JSON`.
// The shim prefixes /api/* (fetch + XHR) with the proxy mount so every call
// lands back on the panel.
var PANEL_SHIM = "<script>(function(){var P='/dsh-lobsterai-daddy/panel';" +
  "function fix(u){return (typeof u==='string'&&u.charAt(0)==='/'&&u.lastIndexOf('/api/',0)===0)?(P+u):u;}" +
  "var of=window.fetch;if(of){window.fetch=function(i,o){try{if(typeof i==='string')i=fix(i);}catch(e){}return of.call(this,i,o);};}" +
  "var oo=XMLHttpRequest.prototype.open;" +
  "XMLHttpRequest.prototype.open=function(m,u){try{var a=Array.prototype.slice.call(arguments);a[1]=fix(u);return oo.apply(this,a);}catch(e){return oo.apply(this,arguments);}};" +
  "})();</script>";

// Hop-by-hop headers must never be forwarded in either direction (RFC 7230 §6.1).
// `content-encoding`/`content-length` are handled separately because we may rewrite
// the body, so the pair MUST stay consistent or the browser decodes garbage.
var HOP_BY_HOP = {
  connection: 1, "keep-alive": 1, "proxy-authenticate": 1, "proxy-authorization": 1,
  te: 1, trailer: 1, "transfer-encoding": 1, upgrade: 1,
};

function buildForwardHeaders(req, port, bodyLength) {
  var headers = { host: "127.0.0.1:" + port };
  // Ask the panel for an identity body: we rewrite HTML, and re-encoding a stream we
  // already decoded is what produced mojibake / blank drawers. Declining compression
  // removes that whole class of failure.
  headers["accept-encoding"] = "identity";
  var pass = ["content-type", "accept", "accept-language", "authorization", "cookie", "origin", "referer", "user-agent"];
  for (var i = 0; i < pass.length; i++) {
    var k = pass[i];
    if (req.headers[k] !== undefined) headers[k] = req.headers[k];
  }
  for (var h in req.headers) {
    if (HOP_BY_HOP[h]) continue;
    if (headers[h] === undefined && h !== "content-length") headers[h] = req.headers[h];
  }
  if (typeof bodyLength === "number") headers["content-length"] = String(bodyLength);
  else delete headers["content-length"];
  return headers;
}

function proxyToPanel(req, res, targetPath, port) {
  return new Promise(function (resolve) {
    // The normal path, the timeout path and the error path can all fire for the
    // same request (destroy() on timeout emits "error" right after). Only the
    // first one may answer: a second writeHead throws ERR_HTTP_HEADERS_SENT,
    // which is an uncaught exception and takes the whole DSH host process down.
    var settled = false;
    function finish(status, outHeaders, payload) {
      if (settled) return;
      settled = true;
      try {
        if (!res.headersSent) res.writeHead(status, outHeaders);
        res.end(payload);
      } catch (e) {
        try { res.destroy(); } catch (e2) { /* already gone */ }
      }
      resolve();
    }
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("error", function () { finish(400, { "content-type": "text/plain; charset=utf-8" }, "bad request"); });
    req.on("end", function () {
      var body = chunks.length ? Buffer.concat(chunks) : null;
      var headers = buildForwardHeaders(req, port, body ? body.length : 0);

      var preq = http.request(
        { host: "127.0.0.1", port: port, path: targetPath, method: req.method, headers: headers, timeout: PANEL_TIMEOUT_MS },
        function (pres) {
          var out = [];
          pres.on("data", function (c) { out.push(c); });
          pres.on("end", function () {
            var buf = Buffer.concat(out);
            var ct = String(pres.headers["content-type"] || "");
            var enc = String(pres.headers["content-encoding"] || "");

            // A compressed body cannot be safely rewritten or length-corrected, so
            // when the panel ignored `accept-encoding: identity` we forward the bytes
            // untouched WITH their original encoding header — never re-labelled.
            var rewritable = enc === "" || enc === "identity";

            if (rewritable && ct.indexOf("text/html") >= 0 && buf.length) {
              try {
                var html = buf.toString("utf8");
                if (html.indexOf("dsh-lobsterai-daddy/panel") === -1) {
                  // Inject just before </head> so the shim can never land ahead of
                  // <meta charset="utf-8"> — that would make the page decode as
                  // latin-1 and turn every Chinese label into mojibake.
                  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, PANEL_SHIM + "</head>");
                  else if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, function (m) { return m + PANEL_SHIM; });
                  else html = PANEL_SHIM + html;
                  buf = Buffer.from(html, "utf8");
                }
              } catch (e) { /* leave the body untouched on any rewrite failure */ }
            }

            var outHeaders = { "cache-control": "no-store" };
            if (ct) outHeaders["content-type"] = ct;
            if (enc && enc !== "identity") outHeaders["content-encoding"] = enc;
            // Length is only safe to declare when the body was NOT decoded above.
            if (rewritable || req.method === "HEAD") outHeaders["content-length"] = String(buf.length);
            finish(pres.statusCode || 502, outHeaders, buf);
          });
          pres.on("error", function () {
            finish(502, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ error: "面板响应读取失败" }));
          });
        }
      );
      preq.on("timeout", function () {
        finish(504, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ error: "LobsterDaddy 面板响应超时" }));
        preq.destroy();
      });
      preq.on("error", function (e) {
        finish(502, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ error: "连不上 LobsterDaddy 面板： " + String(e && e.message || e) }));
      });
      if (body && req.method !== "GET" && req.method !== "HEAD") preq.write(body);
      preq.end();
    });
  });
}

export function apply(ctx, config) {
  ctx.logger.info("dsh-lobsterai-daddy: host half mounted (status + panel proxy)");

  var panelPort = (config && Number(config.panelPort)) || PANEL_PORT_DEFAULT;

  // The HTTP origin the plugin's routes are actually served on.
  //
  // 🔴 This is the missing piece for the desktop shell. The DSH window renders the page
  // from `dsh-app://app`, and that scheme's handler grants the special
  // `x-dsh-desktop-renderer` header ONLY to the top-level frame (see the installed
  // `lib/web-document.js`, which checks `request.frame === owner.mainFrame`). An IFRAME
  // is a sub-frame, never receives the header, and therefore gets the packaged-static
  // handler — which does not contain our routes — and loads an EMPTY document. That is
  // why the drawer rendered black while `fetch()` (a JS call, not a navigation) worked.
  //
  // So the frame must be pointed at the loopback HTTP origin explicitly, and the client
  // can only learn that port from the Host. Publish it on /status.
  //
  // `webServer.port` is NOT in the service's published method list, but the service
  // object carries it and dsh-web-app itself reads exactly this
  // (`ctx.get("webServer")?.port` in localWebUrl), so it is the supported path in
  // practice. The request's own Host header is used as the authority whenever it is
  // available, because that is the address the caller JUST reached us on — no guessing.
  function hostOrigin(req) {
    var fromReq = "";
    try {
      var h = req && req.headers && req.headers.host;
      if (typeof h === "string" && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(h)) {
        fromReq = "http://" + h;
      }
    } catch (e) { /* fall through to the service */ }
    if (fromReq) return fromReq;

    var port = null;
    try {
      port = ctx.get("webServer") && ctx.get("webServer").port;
    } catch (e) { /* service shape differs across versions */ }
    if (!port) {
      try { port = ctx.webServer && ctx.webServer.port; } catch (e) { /* ignore */ }
    }
    return port ? "http://127.0.0.1:" + port : "";
  }

  var dispose = ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_PREFIX,
    handler: async function (req, res) {
      var url = new URL(req.url, "http://127.0.0.1");
      var sub = url.pathname.slice(ROUTE_PREFIX.length) || "/";

      // ---- which account LobsterAI is signed in as right now ----
      // Read live from LobsterAI's own store on every call, so a switch performed through
      // the console (or in the app) is reflected on the next poll with no extra step.
      if (sub === "/current") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var cur = readCurrentAccountId();
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(Object.assign({ ok: true, plugin: "dsh-lobsterai-daddy" }, cur)));
        return;
      }

      // ---- status ----
      // Same loopback-only rule as every other route: this reports the local account
      // COUNT, which is local-machine information and must not answer LAN callers even
      // though DSH's own trusted-host gate would normally reject them first (defence in
      // depth — the gate is configuration, this guard is the plugin's own contract).
      if (sub === "/status") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var info = await probePanel(panelPort);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(Object.assign({
          ok: true,
          plugin: "dsh-lobsterai-daddy",
          version: PKG_VERSION,
          panelPort: panelPort,
          panelUrl: "http://127.0.0.1:" + panelPort,
          // The client turns this into an ABSOLUTE iframe src. Without it the frame
          // resolves against dsh-app:// and renders nothing (see hostOrigin above).
          hostOrigin: hostOrigin(req),
          // The exact URL the drawer should load, so the client never has to guess.
          panelProxyUrl: hostOrigin(req) ? hostOrigin(req) + ROUTE_PREFIX + "/panel/" : "",
        }, info)));
        return;
      }

      // ---- client-side diagnostics sink (loopback only) ----
      // The client half posts its mount milestones here; they land in the host
      // log, so a missing floating ball can be diagnosed without devtools.
      if (sub === "/report" && req.method === "POST") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var reportChunks = [];
        req.on("data", function (c) { reportChunks.push(c); });
        req.on("end", function () {
          var text = Buffer.concat(reportChunks).toString("utf8").slice(0, 4000);
          ctx.logger.info("[dsh-lobsterai-daddy:client] " + text);
          // Mirror to a file: the Electron host's stdout is not always captured, and
          // the client half is the only witness to what the page actually renders.
          try {
            appendFileSync(join(homedir(), ".dsh", "lobsterai-daddy-client.log"),
              "[" + new Date().toISOString() + "] " + text + "\n");
          } catch (e) { /* diagnostics must never break the route */ }
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      // ---- open the console in the SYSTEM browser ----
      // The renderer lives on the dsh-app:// scheme where window.open is routinely
      // blocked, so "浏览器打开" silently did nothing. The Host is an ordinary Node
      // process and can launch the default browser for real.
      if (sub === "/open") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var openUrl = "http://127.0.0.1:" + panelPort + "/";
        var launched = false;
        try {
          if (process.platform === "win32") {
            // `start` is a cmd builtin; the empty title argument keeps the quoted URL
            // from being treated as the window title.
            spawn("cmd", ["/c", "start", "", openUrl], { detached: true, stdio: "ignore" }).unref();
          } else if (process.platform === "darwin") {
            spawn("open", [openUrl], { detached: true, stdio: "ignore" }).unref();
          } else {
            spawn("xdg-open", [openUrl], { detached: true, stdio: "ignore" }).unref();
          }
          launched = true;
        } catch (e) { /* report the failure instead of pretending */ }
        ctx.logger.info("[dsh-lobsterai-daddy] open external " + openUrl + " launched=" + launched);
        // Answer with a tiny page rather than a redirect: a redirect would navigate the
        // DSH shell itself away from the app.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end("<!doctype html><meta charset='utf-8'><title>LobsterAIDaddy</title>" +
          "<body style='font:14px system-ui;background:#0d1220;color:#e8ecf5;padding:24px'>" +
          "<p>" + (launched ? "已在系统浏览器中打开控制台。" : "无法自动打开，请手动访问：") + "</p>" +
          "<p><a style='color:#ffb27a' href='" + openUrl + "' target='_blank'>" + openUrl + "</a></p>" +
          "</body>");
        return;
      }

      // ---- panel reverse proxy ----
      // Everything that is not /status or /report is forwarded to the panel, not just
      // /panel/*: the console's own JS calls absolute `/api/...` paths, and the shim
      // rewrites them to `/dsh-lobsterai-daddy/panel/api/...`. Answering only the
      // /panel/ prefix (and 404-ing the rest) is what made the drawer show
      // "not found" instead of the live console.
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        // `/panel/x` maps to `/x`; a bare `/panel` maps to `/`. Any other top-level
        // path is forwarded verbatim so absolute console calls still resolve.
        var rest = sub === "/panel" ? "/" : (sub.indexOf("/panel/") === 0 ? sub.slice("/panel".length) : sub);
        var target = rest + (url.search || "");
        await proxyToPanel(req, res, target, panelPort);
        return;
      }
    },
  });

  ctx.effect(function () { return dispose; }, "dsh-lobsterai-daddy: routes");
}
