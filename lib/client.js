window.__ModuleLoader__.load({
  id: "dsh-lobsterai-daddy",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    // ---------------------------------------------------------------------------
    // LobsterAIDaddy — draggable floating ball + slide-in drawer that embeds the
    // LobsterDaddy web console, so the panel is pixel-identical to the web page.
    //
    // Hard-won rules from the todo-ball / font-enhancer plugins that this file
    // obeys (see dsh-config/references/plugin-development SKILL.md 7.6.3 / 7.9.2):
    //   * the mount container must be position:static + pointer-events:none, and
    //     only the ball itself is position:fixed — a position:relative container
    //     makes a fixed child render offset / behind in Electron;
    //   * everything lives in a shadow root and uses NATIVE event listeners
    //     (synthetic React events and refs are unreliable inside slots);
    //   * the ball position is persisted in localStorage and re-clamped into the
    //     viewport on resize so it can never be dragged off-screen.
    // ---------------------------------------------------------------------------

    var HOST_ID = "dsh-lobsterai-daddy-root";
    var POS_KEY = "dsh-lobsterai-daddy.pos.v1";
    var OPEN_KEY = "dsh-lobsterai-daddy.open.v1";
    var SIZE_KEY = "dsh-lobsterai-daddy.size.v1";
    var BALL_SIZE = 52;
    // The drawer loads the console through the host-side same-origin proxy, so
    // there is no cross-origin / cookie friction inside Electron.
    var PANEL_SRC = "/dsh-lobsterai-daddy/panel/";
    var STATUS_SRC = "/dsh-lobsterai-daddy/status";

    var hostEl = null;
    var shadow = null;
    var ballEl = null;
    var drawerEl = null;
    var frameEl = null;
    var open = false;
    var reported = {};

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function readPos() {
      try {
        var raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        var p = JSON.parse(raw);
        if (typeof p.x === "number" && typeof p.y === "number") return p;
      } catch (e) { /* fall through */ }
      return null;
    }

    function defaultPos() {
      return {
        x: Math.max(12, window.innerWidth - BALL_SIZE - 26),
        y: Math.round(window.innerHeight * 0.5),
      };
    }

    function savePos(x, y) {
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y })); } catch (e) { /* ignore */ }
    }

    function readSize() {
      try {
        var raw = localStorage.getItem(SIZE_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (typeof s.w === "number" && typeof s.h === "number") return s;
      } catch (e) { /* fall through */ }
      return null;
    }

    function saveSize(w, h) {
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w: w, h: h })); } catch (e) { /* ignore */ }
    }

    function applyBallPos(x, y) {
      if (!ballEl) return;
      ballEl.style.left = x + "px";
      ballEl.style.top = y + "px";
    }

    function saveOpen(v) {
      try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
    }

    function readOpen() {
      try { return localStorage.getItem(OPEN_KEY) === "1"; } catch (e) { return false; }
    }

    // ---- drawer geometry (resizable, persisted) ----
    function currentDrawerSize() {
      var s = readSize();
      if (s) {
        return {
          w: clamp(s.w, 380, Math.max(380, window.innerWidth - 40)),
          h: clamp(s.h, 380, Math.max(380, window.innerHeight - 40)),
        };
      }
      return {
        w: clamp(Math.round(window.innerWidth * 0.42), 420, 760),
        h: clamp(Math.round(window.innerHeight * 0.78), 460, 1000),
      };
    }

    function applyDrawerSize() {
      if (!drawerEl) return;
      var size = currentDrawerSize();
      drawerEl.style.width = size.w + "px";
      drawerEl.style.height = size.h + "px";
    }

    function setOpen(v) {
      open = !!v;
      saveOpen(open);
      if (!drawerEl || !ballEl) return;
      if (open) {
        applyDrawerSize();
        drawerEl.classList.add("open");
        ballEl.classList.add("active");
        ballEl.setAttribute("title", "收起 LobsterAIDaddy 控制台");
        // Kick the frame so the console shows fresh data every time it opens.
        try {
          if (frameEl && frameEl.getAttribute("src")) frameEl.setAttribute("src", PANEL_SRC + "?t=" + Date.now());
        } catch (e) { /* ignore */ }
      } else {
        drawerEl.classList.remove("open");
        ballEl.classList.remove("active");
        ballEl.setAttribute("title", "打开 LobsterAIDaddy 控制台");
      }
    }

    var CSS = [
      // Container must stay static + transparent to clicks (rule 7.6.3).
      "#" + HOST_ID + "{position:static;pointer-events:none;}",
      "#" + HOST_ID + " *{box-sizing:border-box;}",

      // ---------------- floating ball ----------------
      ".lad-ball{position:fixed;z-index:2147483000;width:" + BALL_SIZE + "px;height:" + BALL_SIZE + "px;",
      "  border-radius:50%;pointer-events:auto;cursor:grab;user-select:none;",
      "  background:radial-gradient(circle at 32% 28%,#ff9a5a 0%,#ff6a3d 38%,#e8442a 72%,#b8281a 100%);",
      "  box-shadow:0 6px 20px rgba(232,68,42,.42),0 2px 6px rgba(0,0,0,.35),inset 0 1px 2px rgba(255,255,255,.45);",
      "  display:flex;align-items:center;justify-content:center;",
      "  transition:transform .16s ease,box-shadow .16s ease;}",
      ".lad-ball:hover{transform:scale(1.07);box-shadow:0 8px 26px rgba(232,68,42,.55),0 2px 8px rgba(0,0,0,.4),inset 0 1px 2px rgba(255,255,255,.5);}",
      ".lad-ball.dragging{cursor:grabbing;transform:scale(.96);transition:none;}",
      ".lad-ball.active{background:radial-gradient(circle at 32% 28%,#7ad4ff 0%,#3aa5ea 38%,#2a72c8 72%,#1a4a8a 100%);",
      "  box-shadow:0 6px 20px rgba(58,165,234,.5),0 2px 6px rgba(0,0,0,.35),inset 0 1px 2px rgba(255,255,255,.45);}",
      ".lad-emoji{font-size:26px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));pointer-events:none;}",
      // live status dot on the ball
      ".lad-dot{position:absolute;right:1px;bottom:1px;width:12px;height:12px;border-radius:50%;",
      "  border:2px solid rgba(10,12,20,.85);background:#6b7280;pointer-events:none;}",
      ".lad-dot.on{background:#34d399;box-shadow:0 0 8px #34d399;}",
      ".lad-dot.off{background:#6b7280;}",
      // badge with account count
      ".lad-badge{position:absolute;left:-4px;top:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;",
      "  background:#1f2937;color:#e8ecf5;font-size:11px;font-weight:600;line-height:18px;text-align:center;",
      "  border:1px solid rgba(255,255,255,.25);pointer-events:none;display:none;}",
      ".lad-badge.show{display:block;}",

      // ---------------- drawer ----------------
      ".lad-drawer{position:fixed;z-index:2147482999;right:18px;top:18px;",
      "  background:rgba(13,17,28,.97);border:1px solid rgba(255,255,255,.12);border-radius:16px;",
      "  box-shadow:0 18px 50px rgba(0,0,0,.55);overflow:hidden;display:none;flex-direction:column;",
      "  pointer-events:auto;backdrop-filter:blur(10px);}",
      ".lad-drawer.open{display:flex;}",
      ".lad-head{display:flex;align-items:center;gap:9px;padding:10px 12px;",
      "  background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));",
      "  border-bottom:1px solid rgba(255,255,255,.09);flex:0 0 auto;}",
      ".lad-logo{width:22px;height:22px;border-radius:7px;flex:0 0 auto;",
      "  background:linear-gradient(135deg,#ff7a45,#ff4d6d);display:flex;align-items:center;justify-content:center;font-size:13px;}",
      ".lad-title{font-size:13px;font-weight:600;color:#e8ecf5;letter-spacing:.02em;white-space:nowrap;}",
      ".lad-sub{font-size:11px;color:#8b93a7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;}",
      ".lad-spacer{flex:1 1 auto;}",
      ".lad-btn{width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.14);",
      "  background:rgba(255,255,255,.06);color:#c9d2e3;font-size:14px;line-height:1;cursor:pointer;",
      "  display:flex;align-items:center;justify-content:center;padding:0;}",
      ".lad-btn:hover{background:rgba(255,255,255,.14);color:#fff;}",
      ".lad-body{flex:1 1 auto;position:relative;background:#0d1220;min-height:0;}",
      ".lad-frame{width:100%;height:100%;border:0;display:block;background:#0d1220;}",
      ".lad-fallback{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;",
      "  gap:12px;padding:26px;text-align:center;color:#aab3c8;font-size:13px;line-height:1.7;}",
      ".lad-fallback.show{display:flex;}",
      ".lad-fallback b{color:#e8ecf5;font-size:14px;}",
      ".lad-fallback code{background:rgba(255,255,255,.07);padding:2px 7px;border-radius:5px;font-size:12px;color:#ffb27a;}",
      ".lad-again{padding:8px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.18);",
      "  background:linear-gradient(180deg,#ff7a45,#e8442a);color:#fff;font-size:12.5px;cursor:pointer;font-weight:600;}",
      ".lad-again:hover{filter:brightness(1.08);}",
      // resize grip
      ".lad-resize{position:absolute;left:0;bottom:0;width:18px;height:18px;cursor:nesw-resize;z-index:5;}",
      ".lad-resize::after{content:'';position:absolute;left:4px;bottom:4px;width:9px;height:9px;",
      "  border-left:2px solid rgba(255,255,255,.3);border-bottom:2px solid rgba(255,255,255,.3);border-radius:0 0 0 3px;}",
      ".lad-hint{position:absolute;left:10px;bottom:8px;font-size:10.5px;color:#5c6478;pointer-events:none;}",
    ].join("\n");

    function buildUI() {
      if (!hostEl) return;

      // ---- drawer ----
      drawerEl = document.createElement("div");
      drawerEl.className = "lad-drawer";

      var head = document.createElement("div");
      head.className = "lad-head";

      var logo = document.createElement("div");
      logo.className = "lad-logo";
      logo.textContent = "🦞";

      var titleWrap = document.createElement("div");
      var title = document.createElement("div");
      title.className = "lad-title";
      title.textContent = "LobsterAIDaddy";
      var sub = document.createElement("div");
      sub.className = "lad-sub";
      sub.textContent = "LobsterAI 多账号控制台";
      titleWrap.appendChild(title);
      titleWrap.appendChild(sub);

      var spacer = document.createElement("div");
      spacer.className = "lad-spacer";

      var btnReload = document.createElement("button");
      btnReload.className = "lad-btn";
      btnReload.textContent = "⟳";
      btnReload.setAttribute("data-act", "reload");
      btnReload.title = "重新加载控制台";

      var btnOpen = document.createElement("button");
      btnOpen.className = "lad-btn";
      btnOpen.textContent = "⧉";
      btnOpen.setAttribute("data-act", "external");
      btnOpen.title = "在浏览器中打开";

      var btnClose = document.createElement("button");
      btnClose.className = "lad-btn";
      btnClose.textContent = "✕";
      btnClose.setAttribute("data-act", "close");
      btnClose.title = "收起";

      head.appendChild(logo);
      head.appendChild(titleWrap);
      head.appendChild(spacer);
      head.appendChild(btnReload);
      head.appendChild(btnOpen);
      head.appendChild(btnClose);

      var body = document.createElement("div");
      body.className = "lad-body";

      frameEl = document.createElement("iframe");
      frameEl.className = "lad-frame";
      frameEl.setAttribute("allow", "clipboard-read; clipboard-write");
      frameEl.addEventListener("load", function () {
        // A successful load means the console answered through the proxy.
        hideFallback();
      });
      frameEl.addEventListener("error", function () { showFallback(); });

      var fallback = document.createElement("div");
      fallback.className = "lad-fallback";
      fallback.innerHTML = [
        "<div style='font-size:34px'>🦞</div>",
        "<b>控制台没起来</b>",
        "<div>LobsterDaddy 面板（<code>127.0.0.1:17819</code>）当前没有响应。<br>",
        "在终端里跑一次下面这条命令即可拉起：</div>",
        "<code>node lobster-daddy.js panel</code>",
        "<button class='lad-again' data-act='retry'>重新连接</button>",
      ].join("");

      var grip = document.createElement("div");
      grip.className = "lad-resize";
      grip.setAttribute("data-act", "resize");
      grip.title = "拖动调整大小";

      body.appendChild(frameEl);
      body.appendChild(fallback);
      body.appendChild(grip);

      drawerEl.appendChild(head);
      drawerEl.appendChild(body);

      // ---- floating ball ----
      ballEl = document.createElement("div");
      ballEl.className = "lad-ball";
      ballEl.setAttribute("title", "打开 LobsterAIDaddy 控制台");
      ballEl.setAttribute("role", "button");

      var emoji = document.createElement("div");
      emoji.className = "lad-emoji";
      emoji.textContent = "🦞";

      var dot = document.createElement("div");
      dot.className = "lad-dot off";
      dot.setAttribute("data-role", "dot");

      var badge = document.createElement("div");
      badge.className = "lad-badge";
      badge.setAttribute("data-role", "badge");

      ballEl.appendChild(emoji);
      ballEl.appendChild(badge);
      ballEl.appendChild(dot);

      // 🔴 Must append to the SHADOW root, not to hostEl: once an element has an
      // attached shadow root, its light-DOM children are not rendered (there is
      // no <slot>), so appending to hostEl makes the ball invisible while every
      // API check still passes. This was the "no floating ball after restart" bug.
      shadow.appendChild(drawerEl);
      shadow.appendChild(ballEl);

      var pos = readPos() || defaultPos();
      pos.x = clamp(pos.x, 6, Math.max(6, window.innerWidth - BALL_SIZE - 6));
      pos.y = clamp(pos.y, 6, Math.max(6, window.innerHeight - BALL_SIZE - 6));
      applyBallPos(pos.x, pos.y);
      applyDrawerSize();
    }

    function showFallback() {
      var f = shadow.querySelector(".lad-fallback");
      if (f) f.classList.add("show");
      if (frameEl) frameEl.style.visibility = "hidden";
    }

    function hideFallback() {
      var f = shadow.querySelector(".lad-fallback");
      if (f) f.classList.remove("show");
      if (frameEl) frameEl.style.visibility = "visible";
    }

    // ---------------------------------------------------------------------------
    // Drag: pointer events on the ball itself (native listeners inside our own
    // shadow root are reliable — the slot/re-render caveat applies to React
    // synthetic events, which we deliberately avoid).
    // ---------------------------------------------------------------------------
    function bindBallDrag() {
      var dragging = false;
      var moved = false;
      var startX = 0, startY = 0, originX = 0, originY = 0;

      ballEl.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        var rect = ballEl.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
        ballEl.classList.add("dragging");
        try { ballEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });

      ballEl.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        var nx = clamp(originX + dx, 6, Math.max(6, window.innerWidth - BALL_SIZE - 6));
        var ny = clamp(originY + dy, 6, Math.max(6, window.innerHeight - BALL_SIZE - 6));
        applyBallPos(nx, ny);
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        ballEl.classList.remove("dragging");
        try { ballEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var rect = ballEl.getBoundingClientRect();
        savePos(Math.round(rect.left), Math.round(rect.top));
        // A drag that actually moved must NOT toggle the drawer.
        if (!moved) setOpen(!open);
      }

      ballEl.addEventListener("pointerup", endDrag);
      ballEl.addEventListener("pointercancel", endDrag);
    }

    // ---------------------------------------------------------------------------
    // Drawer interactions via data-act delegation (rule 7.6.4: always bind the
    // resolved element, never a stale/undefined variable).
    // ---------------------------------------------------------------------------
    function bindDrawerEvents() {
      drawerEl.addEventListener("click", function (e) {
        var t = e.target;
        var el = t && t.closest ? t.closest("[data-act]") : null;
        if (!el) return;
        var act = el.getAttribute("data-act");
        if (act === "close") { setOpen(false); return; }
        if (act === "reload" || act === "retry") {
          hideFallback();
          if (frameEl) frameEl.setAttribute("src", PANEL_SRC + "?t=" + Date.now());
          probe();
          return;
        }
        if (act === "external") {
          try { window.open("http://127.0.0.1:17819/", "_blank"); } catch (err) { /* ignore */ }
          return;
        }
      });

      // ---- resize grip ----
      var grip = drawerEl.querySelector('[data-act="resize"]');
      var resizing = false, rsX = 0, rsY = 0, rsW = 0, rsH = 0;
      grip.addEventListener("pointerdown", function (e) {
        resizing = true;
        rsX = e.clientX; rsY = e.clientY;
        var rect = drawerEl.getBoundingClientRect();
        rsW = rect.width; rsH = rect.height;
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
        e.stopPropagation();
      });
      grip.addEventListener("pointermove", function (e) {
        if (!resizing) return;
        // The grip sits at the drawer's bottom-left: dragging outward grows it.
        var w = clamp(rsW - (e.clientX - rsX), 380, Math.max(380, window.innerWidth - 30));
        var h = clamp(rsH + (e.clientY - rsY), 380, Math.max(380, window.innerHeight - 30));
        drawerEl.style.width = w + "px";
        drawerEl.style.height = h + "px";
      });
      grip.addEventListener("pointerup", function (e) {
        if (!resizing) return;
        resizing = false;
        try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var rect = drawerEl.getBoundingClientRect();
        saveSize(Math.round(rect.width), Math.round(rect.height));
      });
    }

    // ---------------------------------------------------------------------------
    // Live status: colour the dot + show the account count on the badge.
    // ---------------------------------------------------------------------------
    function probe() {
      try {
        fetch(STATUS_SRC, { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (s) {
            var dot = shadow.querySelector('[data-role="dot"]');
            var badge = shadow.querySelector('[data-role="badge"]');
            if (dot) dot.className = "lad-dot " + (s && s.running ? "on" : "off");
            if (badge) {
              if (s && s.running && typeof s.accounts === "number") {
                badge.textContent = String(s.accounts);
                badge.className = "lad-badge show";
              } else {
                badge.className = "lad-badge";
              }
            }
            if (s && s.running) {
              if (open) hideFallback();
            } else if (open) {
              showFallback();
            }
          })
          .catch(function () {
            var dot = shadow.querySelector('[data-role="dot"]');
            if (dot) dot.className = "lad-dot off";
          });
      } catch (e) { /* ignore */ }
    }

    function mount() {
      if (document.getElementById(HOST_ID)) return; // guard against double mount
      report("mount:start readyState=" + document.readyState +
        " body=" + (document.body ? "yes" : "no") +
        " win=" + window.innerWidth + "x" + window.innerHeight);
      hostEl = document.createElement("div");
      hostEl.id = HOST_ID;
      shadow = hostEl.attachShadow({ mode: "open" });

      var style = document.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);

      document.body.appendChild(hostEl);

      buildUI();
      bindBallDrag();
      bindDrawerEvents();

      // Clamp back into view when the window shrinks.
      window.addEventListener("resize", function () {
        if (!ballEl) return;
        var rect = ballEl.getBoundingClientRect();
        var nx = clamp(rect.left, 6, Math.max(6, window.innerWidth - BALL_SIZE - 6));
        var ny = clamp(rect.top, 6, Math.max(6, window.innerHeight - BALL_SIZE - 6));
        applyBallPos(nx, ny);
        savePos(nx, ny);
        applyDrawerSize();
      });

      // Load the console lazily on first open; keep the dot fresh regardless.
      if (readOpen()) {
        setOpen(true);
      } else if (frameEl) {
        frameEl.setAttribute("src", PANEL_SRC);
      }
      probe();
      setInterval(probe, 15000);

      var br = ballEl.getBoundingClientRect();
      report("mount:done ballRect=" + Math.round(br.left) + "," + Math.round(br.top) +
        " size=" + Math.round(br.width) + "x" + Math.round(br.height) +
        " inBody=" + (document.body.contains(hostEl)));
    }

    // ---------------------------------------------------------------------------
    // Diagnostics: post milestones to the host log (/dsh-lobsterai-daddy/report)
    // so a missing ball can be diagnosed without opening devtools.
    // ---------------------------------------------------------------------------
    function report(text) {
      try {
        var key = String(text).slice(0, 60);
        if (reported[key]) return;
        reported[key] = 1;
        fetch("/dsh-lobsterai-daddy/report", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: String(text).slice(0, 1500),
        }).catch(function () { /* diagnostics must never break the UI */ });
      } catch (e) { /* ignore */ }
    }

    // ---------------------------------------------------------------------------
    // Watchdog: the shell can rebuild the DOM and drop our host element, which
    // would silently remove the ball. Re-mount whenever it disappears (the same
    // guard dsh-todo-float-ball uses).
    // ---------------------------------------------------------------------------
    function startWatchdog() {
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        try {
          if (!document.getElementById(HOST_ID)) {
            hostEl = null; shadow = null; ballEl = null; drawerEl = null; frameEl = null;
            reported = {};
            mount();
          }
        } catch (e) { /* keep the watchdog alive */ }
        if (tries > 600) clearInterval(timer); // ~10 min of grace, then stop
      }, 2000);
    }

    exports.inject = [];
    exports.apply = function () {
      report("apply:called readyState=" + document.readyState);
      function boot() {
        try { mount(); } catch (e) { report("mount:ERROR " + (e && e.message)); }
        startWatchdog();
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
      } else {
        boot();
      }
    };
    return module.exports;
  },
});
