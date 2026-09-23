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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";

var PKG_VERSION = (function () {
  try {
    var here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;
  } catch (e) {
    return "unknown";
  }
})();

var ROUTE_PREFIX = "/dsh-lobsterai-daddy";
var PANEL_PORT_DEFAULT = 17819;
var PANEL_TIMEOUT_MS = 8000;

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
      { host: "127.0.0.1", port: port, path: "/api/status", method: "GET", timeout: 3000 },
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
    req.on("end", function () {
      var body = chunks.length ? Buffer.concat(chunks) : null;
      var headers = { host: "127.0.0.1:" + port };
      // Forward only what the panel actually needs; dropping hop-by-hop and
      // framing headers avoids double content-length / gzip surprises.
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
      if (req.headers["accept"]) headers["accept"] = req.headers["accept"];
      if (body) headers["content-length"] = String(body.length);

      var preq = http.request(
        { host: "127.0.0.1", port: port, path: targetPath, method: req.method, headers: headers, timeout: PANEL_TIMEOUT_MS },
        function (pres) {
          var out = [];
          pres.on("data", function (c) { out.push(c); });
          pres.on("end", function () {
            var buf = Buffer.concat(out);
            var ct = String(pres.headers["content-type"] || "");
            // Inject the API-prefix shim into HTML only (never into JSON/SSE).
            if (ct.indexOf("text/html") >= 0 && buf.length) {
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
            finish(pres.statusCode || 502, outHeaders, buf);
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
      if (body) preq.write(body);
      preq.end();
    });
  });
}

export function apply(ctx, config) {
  ctx.logger.info("dsh-lobsterai-daddy: host half mounted (status + panel proxy)");

  var panelPort = (config && Number(config.panelPort)) || PANEL_PORT_DEFAULT;

  var dispose = ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_PREFIX,
    handler: async function (req, res) {
      var url = new URL(req.url, "http://127.0.0.1");
      var sub = url.pathname.slice(ROUTE_PREFIX.length) || "/";

      // ---- status ----
      if (sub === "/status") {
        var info = await probePanel(panelPort);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(Object.assign({
          ok: true,
          plugin: "dsh-lobsterai-daddy",
          version: PKG_VERSION,
          panelPort: panelPort,
          panelUrl: "http://127.0.0.1:" + panelPort,
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
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      // ---- panel reverse proxy ----
      if (sub === "/panel" || sub.indexOf("/panel/") === 0) {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var rest = sub.slice("/panel".length) || "/";
        var target = rest + (url.search || "");
        await proxyToPanel(req, res, target, panelPort);
        return;
      }

      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found", prefix: ROUTE_PREFIX }));
    },
  });

  ctx.effect(function () { return dispose; }, "dsh-lobsterai-daddy: routes");
}
