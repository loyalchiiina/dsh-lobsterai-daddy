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

// 🔴 GitHub 仓库（★ Star 直达）。与 package.json 的 repository 保持一致。
// REPO_READY=true → 按钮可点；false → 提示"尚未发布"（避免打开 404）。
var REPO_URL = "https://github.com/loyalchiiina/dsh-lobsterai-daddy";
var REPO_READY = true;
    var POS_KEY = "dsh-lobsterai-daddy.pos.v1";
    var OPEN_KEY = "dsh-lobsterai-daddy.open.v1";
    var SIZE_KEY = "dsh-lobsterai-daddy.size.v1";
    // Drawer anchor + offset from the ball. Persisted so the panel reopens where the
    // user left it; when FOLLOW is on, dragging the ball carries the open drawer by
    // the same offset (that is the requested "面板跟着悬浮球一起移动").
    var DPOS_KEY = "dsh-lobsterai-daddy.drawerpos.v1";
    var FOLLOW_KEY = "dsh-lobsterai-daddy.follow.v1";
    // Gap kept between the ball and its drawer when there is no saved position.
    var DRAWER_GAP = 10;
    // Smallest allowed distance to the viewport edge, in px.
    var EDGE = 8;
    var BALL_SIZE = 54;   // 与 dsh-workbuddy-hub 一致（视觉重量统一）

/**
 * 插件图标（内联 SVG，同 dsh-workbuddy-hub 的做法）。
 *
 * 用 `currentColor` 填充 → 自动跟随球体的文字色（宿主主题令牌），
 * 深浅色主题下都清晰；不依赖任何网络或字体资源。
 */
var ICON_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  // 🔴 2026-10-12：换成【官方 LobsterAI 图标】的龙虾剪影（用户要求：用官方图标、做成黑白）。
  // 来源：<LobsterAI 安装目录>/resources/app-icon/512x512.png（官方红底白虾应用图标）。
  // 处理链：灰度 → 连通域剔除圆角外框光晕 → 提取龙虾剪影 → 格点边界追踪描轮廓 →
  //         Douglas-Peucker 简化 → Catmull-Rom 转三次贝塞尔 → 归一化到 24x24 viewBox。
  // 用 currentColor 单色填充 → 天然黑白，且自动跟随宿主主题（深/浅/品牌色）。
  // fill-rule:evenodd 让钳口等内孔正确镂空。注意 favicon.svg 画出来是圆团、
  // 不是龙虾造型，官方可用的龙虾造型只有 app-icon/512x512.png 这一份。
  '<path fill-rule="evenodd" fill="currentColor" d="' +
  'M9.17 5.73C9.22 5.71 9.23 5.68 9.34 5.73C9.45 5.77 9.75 5.94 9.84 6.01C9.94 6.07 9.87 6.11 9.9 6.12C9.93 6.14 ' +
  '9.87 6 10.01 6.12C10.15 6.24 10.51 6.54 10.74 6.85C10.96 7.15 11.19 7.55 11.35 7.97C11.52 8.39 11.58 9.14 11.7' +
  '5 9.36C11.91 9.59 12.24 9.44 12.36 9.3C12.48 9.17 12.41 8.8 12.47 8.58C12.54 8.36 12.71 8.1 12.75 7.97C12.8 7.' +
  '84 12.71 7.9 12.75 7.8C12.79 7.7 12.92 7.44 12.97 7.35C13.03 7.27 13.06 7.34 13.09 7.3C13.11 7.25 13.08 7.16 1' +
  '3.14 7.07C13.21 6.98 13.42 6.81 13.48 6.74C13.53 6.67 13.33 6.76 13.48 6.63C13.62 6.49 14.17 6.05 14.37 5.9C14' +
  '.57 5.75 14.61 5.75 14.71 5.73C14.8 5.71 14.89 5.74 14.93 5.79C14.97 5.83 15.06 5.9 14.93 6.01C14.8 6.12 14.41' +
  ' 6.24 14.15 6.46C13.89 6.68 13.56 7.07 13.36 7.35C13.17 7.63 13.1 7.79 12.97 8.14C12.85 8.48 12.57 9.09 12.64 ' +
  '9.42C12.71 9.74 13.29 9.96 13.42 10.09C13.55 10.22 13.36 10.12 13.42 10.21C13.48 10.29 13.61 10.33 13.75 10.6C' +
  '13.91 10.86 14.18 11.48 14.31 11.82C14.46 12.17 14.55 12.49 14.6 12.67C14.65 12.84 14.57 12.8 14.6 12.88C14.62' +
  ' 12.98 14.72 13.05 14.76 13.22C14.81 13.4 14.83 13.75 14.87 13.95C14.92 14.14 14.98 14.06 15.04 14.39C15.11 14' +
  '.73 15.23 15.46 15.26 15.96C15.3 16.46 15.28 17.14 15.26 17.41C15.26 17.69 15.25 17.57 15.21 17.64C15.17 17.71' +
  ' 16.05 17.77 15.04 17.8C14.04 17.84 10.2 17.87 9.17 17.86C8.15 17.85 8.96 17.8 8.89 17.75C8.83 17.71 8.8 17.96' +
  ' 8.79 17.59C8.76 17.21 8.76 16.01 8.79 15.52C8.8 15.02 8.82 15 8.89 14.62C8.97 14.25 9.11 13.7 9.23 13.27C9.35' +
  ' 12.86 9.54 12.32 9.62 12.11C9.7 11.89 9.7 12.06 9.74 11.99C9.76 11.92 9.69 11.91 9.79 11.66C9.89 11.41 10.24 ' +
  '10.68 10.34 10.48C10.46 10.28 10.43 10.48 10.46 10.43C10.5 10.37 10.46 10.29 10.57 10.15C10.68 10.01 11 9.7 11' +
  '.13 9.59C11.26 9.48 11.34 9.65 11.35 9.48C11.37 9.3 11.31 8.89 11.19 8.53C11.07 8.16 10.82 7.62 10.63 7.3C10.4' +
  '3 6.97 10.13 6.69 10.01 6.57C9.89 6.45 9.94 6.59 9.9 6.57C9.86 6.54 9.93 6.5 9.79 6.4C9.65 6.31 9.18 6.11 9.06' +
  ' 6.01C8.94 5.92 9.05 5.89 9.06 5.85C9.08 5.8 9.13 5.75 9.17 5.73ZM17.39 4.05C17.47 4.03 17.57 4 17.72 4.05C17.' +
  '89 4.1 18.19 4.24 18.34 4.34C18.49 4.43 18.56 4.56 18.62 4.61C18.69 4.66 18.57 4.47 18.73 4.61C18.9 4.76 19.48' +
  ' 5.34 19.63 5.51C19.78 5.68 19.59 5.57 19.63 5.62C19.66 5.67 19.81 5.74 19.85 5.79C19.89 5.83 19.74 5.73 19.85' +
  ' 5.9C19.96 6.07 20.34 6.5 20.52 6.8C20.71 7.09 20.86 7.41 20.97 7.69C21.07 7.96 21.09 8.27 21.13 8.41C21.18 8.' +
  '57 21.21 8.31 21.25 8.58C21.29 8.85 21.36 9.65 21.36 10.04C21.36 10.42 21.31 10.58 21.25 10.87C21.18 11.17 21.' +
  '13 11.44 20.97 11.82C20.8 12.2 20.42 12.88 20.24 13.17C20.06 13.44 20.04 13.4 19.91 13.5C19.78 13.59 19.77 13.' +
  '7 19.46 13.72C19.15 13.75 18.38 13.7 18.06 13.67C17.75 13.63 17.72 13.58 17.56 13.5C17.4 13.42 17.2 13.22 17.1' +
  '1 13.17C17.02 13.11 17.14 13.31 17 13.17C16.86 13.02 16.48 12.69 16.27 12.32C16.07 11.97 15.87 11.53 15.77 10.' +
  '99C15.67 10.44 15.64 9.65 15.66 9.09C15.67 8.53 15.75 8.02 15.82 7.63C15.9 7.24 16.03 6.92 16.11 6.74C16.18 6.' +
  '56 16.21 6.59 16.27 6.57C16.33 6.54 16.42 6.52 16.5 6.57C16.57 6.62 16.64 6.71 16.72 6.85C16.8 6.99 16.87 7.16' +
  ' 16.94 7.41C17.02 7.65 17.13 8.1 17.17 8.31C17.2 8.51 17.12 8.51 17.17 8.64C17.21 8.77 17.33 9.01 17.45 9.09C1' +
  '7.56 9.16 17.74 9.16 17.84 9.09C17.94 9.01 18.02 8.86 18.06 8.64C18.1 8.41 18.14 8.08 18.12 7.75C18.1 7.41 18.' +
  '04 7.01 17.95 6.63C17.85 6.24 17.63 5.68 17.56 5.45C17.5 5.22 17.62 5.38 17.56 5.23C17.5 5.07 17.28 4.67 17.22' +
  ' 4.5C17.17 4.34 17.2 4.3 17.22 4.22C17.25 4.15 17.31 4.08 17.39 4.05ZM6.27 4.05C6.41 4.02 6.52 4.04 6.6 4.05C6' +
  '.68 4.07 6.74 4.07 6.77 4.17C6.8 4.26 6.79 4.52 6.77 4.61C6.75 4.7 6.73 4.55 6.66 4.73C6.59 4.9 6.43 5.29 6.33' +
  ' 5.68C6.21 6.07 6.04 6.56 5.98 7.07C5.93 7.58 5.95 8.41 5.98 8.75C6.03 9.09 6.11 9.03 6.21 9.09C6.3 9.14 6.46 ' +
  '9.11 6.54 9.09C6.63 9.05 6.61 9.24 6.72 8.92C6.81 8.59 7.02 7.52 7.16 7.13C7.3 6.74 7.45 6.67 7.55 6.57C7.66 6' +
  '.48 7.68 6.46 7.78 6.57C7.87 6.68 8.03 6.98 8.11 7.24C8.19 7.5 8.25 7.53 8.28 8.14C8.31 8.74 8.32 10.26 8.28 1' +
  '0.87C8.23 11.49 8.09 11.59 8 11.82C7.92 12.06 7.92 12.06 7.78 12.27C7.63 12.48 7.43 12.83 7.16 13.06C6.89 13.2' +
  '7 6.41 13.5 6.16 13.62C5.9 13.72 5.92 13.7 5.65 13.72C5.38 13.75 4.77 13.75 4.53 13.72C4.3 13.7 4.39 13.72 4.2' +
  '6 13.62C4.12 13.5 3.9 13.36 3.7 13.06C3.49 12.75 3.19 12.22 3.02 11.76C2.86 11.32 2.74 10.87 2.69 10.37C2.64 9' +
  '.86 2.69 9.19 2.75 8.75C2.8 8.31 2.82 8.19 3.02 7.75C3.23 7.3 3.62 6.57 3.97 6.07C4.33 5.56 4.94 4.95 5.15 4.7' +
  '3C5.36 4.5 5.16 4.8 5.26 4.73C5.36 4.65 5.59 4.39 5.77 4.28C5.93 4.17 6.13 4.09 6.27 4.05ZM9.29 18.36C10.33 18' +
  '.36 14.12 18.29 15.1 18.42C16.08 18.55 15.17 18.98 15.16 19.14C15.14 19.31 15.12 19.32 15.04 19.43C14.97 19.53' +
  ' 14.82 19.68 14.71 19.76C14.6 19.85 15.22 19.9 14.37 19.93C13.53 19.96 10.51 20 9.62 19.93C8.74 19.87 9.19 19.' +
  '69 9.06 19.54C8.93 19.39 8.87 19.21 8.83 19.04C8.8 18.86 8.76 18.59 8.83 18.48C8.92 18.36 8.24 18.37 9.29 18.3' +
  '6ZM16.5 13.56C16.67 13.43 16.59 13.51 16.67 13.56C16.74 13.61 16.74 13.72 16.94 13.83C17.15 13.95 17.54 14.14 ' +
  '17.89 14.22C18.25 14.32 18.88 14.33 19.07 14.39C19.27 14.46 19.13 14.51 19.07 14.62C19.01 14.73 18.79 14.97 18' +
  '.73 15.07C18.67 15.16 18.77 15.13 18.73 15.18C18.7 15.22 18.54 15.3 18.51 15.34C18.47 15.39 18.62 15.34 18.51 ' +
  '15.46C18.4 15.58 17.97 15.97 17.84 16.08C17.71 16.17 17.76 16.04 17.72 16.08C17.69 16.1 17.65 16.21 17.62 16.2' +
  '4C17.58 16.27 17.59 16.18 17.5 16.24C17.42 16.29 17.21 16.51 17.11 16.58C17.01 16.64 16.94 16.6 16.89 16.64C16' +
  '.84 16.66 16.99 16.66 16.83 16.74C16.68 16.83 16.1 17.28 15.94 17.14C15.78 16.98 15.93 16.32 15.88 15.85C15.83' +
  ' 15.39 15.56 14.72 15.66 14.34C15.76 13.96 16.33 13.69 16.5 13.56ZM7.38 13.56C7.46 13.51 7.4 13.43 7.55 13.56C' +
  '7.71 13.69 8.2 14.14 8.34 14.34C8.47 14.54 8.37 14.5 8.34 14.78C8.3 15.08 8.15 15.69 8.11 16.08C8.07 16.46 8.1' +
  '9 16.93 8.11 17.08C8.03 17.23 7.75 17.02 7.61 16.97C7.47 16.92 7.34 16.85 7.28 16.8C7.21 16.75 7.27 16.72 7.22' +
  ' 16.68C7.17 16.66 7.04 16.66 6.99 16.64C6.95 16.6 6.98 16.55 6.93 16.52C6.89 16.49 6.8 16.52 6.72 16.46C6.63 1' +
  '6.41 6.5 16.23 6.43 16.18C6.37 16.14 6.49 16.33 6.33 16.18C6.16 16.04 5.58 15.51 5.42 15.34C5.28 15.19 5.47 15' +
  '.28 5.42 15.23C5.39 15.19 5.29 15.18 5.21 15.07C5.12 14.95 4.96 14.68 4.92 14.57C4.89 14.45 4.82 14.44 4.98 14' +
  '.39C5.14 14.35 5.58 14.35 5.88 14.28C6.17 14.22 6.56 14.08 6.77 14.01C6.97 13.93 7 13.91 7.1 13.83C7.21 13.76 ' +
  '7.31 13.61 7.38 13.56Z' +
  '"/>' +
  '</svg>';
    // The drawer loads the console through the host-side same-origin proxy.
    //
    // 🔴 The frame URL MUST be an ABSOLUTE http:// loopback URL, and the port can only
    // come from the Host. In the DSH desktop shell the window is rendered from
    // `dsh-app://app`, whose handler grants the `x-dsh-desktop-renderer` bypass ONLY to
    // the top-level frame (installed `lib/web-document.js` checks
    // `request.frame === owner.mainFrame`). An IFRAME is a sub-frame, never gets the
    // bypass, and is answered by the packaged-static handler instead — which has no
    // /dsh-lobsterai-daddy route at all, so the frame loads an EMPTY document. The
    // iframe still fires `load`, so the old code hid the fallback and the drawer went
    // black (field report 2026-09-28).
    //
    // `fetch()` from the page works because it is a JS call routed by the client
    // transport, NOT a navigation — which is why "the dot works but the panel is black".
    //
    // NOTE on the boot payload: `window.__DSH_BOOT__` is NOT a source for the origin.
    // Verified live (2026-09-28) — its keys are exactly [rev, entries, batches], a client
    // MODULE MANIFEST carrying no origin and no port. The authoritative source is the
    // Host's own /status response, applied by resolveHostFromServer() below.
    function resolveHostOrigin() {
      try {
        var boot = window.__DSH_BOOT__;
        if (boot && typeof boot === "object") {
          var direct = boot.hostOrigin || boot.webOrigin || boot.baseUrl || boot.url;
          if (typeof direct === "string" && /^https?:\/\//.test(direct)) {
            return direct.replace(/\/+$/, "");
          }
          if (boot.port) return "http://127.0.0.1:" + boot.port;
        }
      } catch (e) { /* next */ }
      try {
        var env = window.__DSH_ENV__ || window.__DSH_CONFIG__;
        if (env) {
          var v = env.webUrl || env.webServerUrl || env.hostUrl;
          if (typeof v === "string" && /^https?:\/\//.test(v)) return v.replace(/\/+$/, "");
        }
      } catch (e) { /* next */ }
      // The page's own origin — correct only when the shell is served over HTTP. In the
      // desktop shell this is dsh-app://app, which the regex rejects.
      try {
        var o = window.location && window.location.origin;
        if (typeof o === "string" && /^https?:\/\//.test(o)) return o.replace(/\/+$/, "");
      } catch (e) { /* next */ }
      return "";
    }

    var ROUTE_PREFIX = "/dsh-lobsterai-daddy";
    var PANEL_PATH = ROUTE_PREFIX + "/panel/";
    // Host-side liveness probe (returns {running, accounts:<number>, hostOrigin,...}).
    var STATUS_PATH = ROUTE_PREFIX + "/status";
    // The CONSOLE's own data endpoint, proxied. This is what carries the account list,
    // quotas, daemon state and gateway port — a different payload from STATUS_PATH, and
    // mixing the two up is why the first native render showed "no accounts".
    var CONSOLE_PATH = ROUTE_PREFIX + "/panel/api/status";
    // Which account LobsterAI is signed in as right now. Answered by the Host, because it
    // requires reading LobsterAI's SQLite store, which the renderer cannot open. Probed on
    // every refresh, so a switch updates the UI without any extra action.
    var CURRENT_PATH = ROUTE_PREFIX + "/current";
    // 🔴 2026-10-12：宿主健康检查（含定时自动签到调度器状态）。
    // 用户反馈「自动签到我在界面看不到」——原来界面上只显示已废弃的"自动签到同意"，
    // 真正的调度器状态（是否在跑、上次结果）只存在于 /health，客户端从不读它。
    var HEALTH_PATH = ROUTE_PREFIX + "/health";
    // 🔴 ALL fetch URLs MUST STAY ROOT-RELATIVE. Verified in the field (2026-09-28):
    //   relative  -> "PROBE relative-fetch status=200"      ✅
    //   absolute  -> "PROBE loopback-fetch FAILED"          ❌ (renderer CSP)
    // An earlier version upgraded these to http://127.0.0.1:<port>/... after probing the
    // Host, which silently broke every console fetch and left the drawer empty.
    var STATUS_SRC = STATUS_PATH;
    var CONSOLE_SRC = CONSOLE_PATH;
/** 当前数据来源：'builtin'（宿主直读）| 'console'（17819 控制台代理） */
var dataSourceMode = "console";
/** 切号进行中的提示文案（空 = 无提示）。让"点了没反应"变成可见进度 */
var switchHint = "";
// 🔴 内置数据路由（2026-10-11）：宿主自己读 accounts/SQLite，**不需要常驻控制台**。
// fetchStatus 优先用它；只有它失败时才回退到控制台代理。
var LOCAL_STATUS_PATH = ROUTE_PREFIX + "/local/status";
var LOCAL_SWITCH_PATH = ROUTE_PREFIX + "/local/switch";
    // The console itself is a loopback HTTP server, independent of how the DSH shell
    // happens to be served. "浏览器打开" needs this explicit address.
    // 🔴 2026-10-11 修正：「浏览器打开」原来指向 17819 控制台（http://127.0.0.1:17819/），
// 但插件已改为**内置数据层**、控制台已停用 → 那个地址打不开（用户报"浏览器打不开"）。
// 现在走宿主 /open，由它打开**插件自己的看板页**（宿主渲染，不依赖任何外部进程）。
// 这里不再硬编码任何 URL —— 交给宿主决定，避免端口/路径漂移。
var PANEL_EXTERNAL = "";   // 空 = 使用宿主 /open
    // Advertised Host origin — DIAGNOSTIC ONLY. Never used to build fetch URLs (see the
    // relative-URL note above); the earlier attempt to use it is what broke the console.
    var HOST_ORIGIN = resolveHostOrigin();
    var hostResolved = false;

    // Probe the Host for its advertised origin, purely as a diagnostic.
    //
    // 🔴 DO NOT switch the fetch URLs to that absolute origin. Verified in the field
    // (2026-09-28 log): the renderer's CSP rejects an absolute loopback request
    // (`loopback-fetch FAILED Failed to fetch`) while the SAME path relative to the page
    // succeeds (`relative-fetch status=200`). Upgrading CONSOLE_SRC to
    // `http://127.0.0.1:<port>/...` therefore broke the console fetch itself and left the
    // drawer empty. Relative paths are the only reliably routed form here.
    function resolveHostFromServer() {
      return fetch(STATUS_PATH, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s && typeof s.hostOrigin === "string" && /^https?:\/\//.test(s.hostOrigin)) {
            HOST_ORIGIN = String(s.hostOrigin).replace(/\/+$/, "");
            hostResolved = true;
          }
          // Kept for diagnostics only; the fetch paths stay relative on purpose.
          report("HOST probe origin=" + HOST_ORIGIN +
            " (fetch URLs intentionally kept relative)");
          return hostResolved;
        })
        .catch(function (e) {
          report("HOST probe FAILED " + (e && e.message));
          return false;
        });
    }

    var hostEl = null;
    var shadow = null;
    var ballEl = null;
    var drawerEl = null;
    // Native console view (replaces the iframe; see buildUI for why an iframe is unusable).
    var panelEl = null;
    var statusEl = null;
    var currentEl = null;
    var accountsEl = null;
    var actionsEl = null;
    var infoEl = null;
    var open = false;
    // Whether the open drawer travels with the ball (user-toggleable, persisted).
    var followEnabled = true;
    var reported = {};
    // Latest /api/status payload, so a re-render never needs a second round-trip.
    var lastStatus = null;
    // Latest /current payload: { available, uid, name, reason }. Refreshed alongside the
    // status so a switch shows up without any manual step.
    var currentAccount = null;
    // Latest /health payload: { ok, version, accounts, checkinScheduler:{enabled,
    // intervalMinutes, startupDelaySeconds, lastRun:{at,reason,okCount,total}} }.
    // Read so the drawer can SHOW that the timed check-in is actually running.
    var healthCache = null;
    // 🔴 若 /health 拉取失败，明确记为「不可用」而不是留空 —— 否则界面会静默退回
    // 什么都看不到（SKILL 7.20「检测失败 ≠ 结果为空」）。
    var healthAvailable = null;
    // Set while a write action (checkin/switch/...) is in flight, to disable buttons.
    var busy = false;
    // Auto-refresh cadence. The panel's own page used 15s; the same value keeps the
    // numbers as fresh as the web console without hammering the account APIs.
    var REFRESH_MS = 15000;            // 抽屉打开时的刷新间隔
var BACKGROUND_REFRESH_MS = 60000; // 抽屉关闭时的后台刷新间隔（只更新球上的状态）
var lastFetchAt = 0;               // 上次成功拉取状态的时间
    var refreshTimer = null;
    // Consecutive failed status fetches before we surface the offline note.
    var probeFailStreak = 0;

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

    // ---- drawer position (top-left) ------------------------------------------
    function readDrawerPos() {
      try {
        var raw = localStorage.getItem(DPOS_KEY);
        if (!raw) return null;
        var p = JSON.parse(raw);
        if (typeof p.x === "number" && typeof p.y === "number") return p;
      } catch (e) { /* fall through */ }
      return null;
    }

    function saveDrawerPos(x, y) {
      try { localStorage.setItem(DPOS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (e) { /* ignore */ }
    }

    function readFollow() {
      try { return localStorage.getItem(FOLLOW_KEY) !== "0"; } catch (e) { return true; }
    }

    function saveFollow(v) {
      try { localStorage.setItem(FOLLOW_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
    }

    // Bottom-left corner of the drawer is its only fixed anchor when no position has
    // been saved yet: `right:18px;bottom` used to be implicit via the CSS shorthand,
    // so keep the same feel by anchoring the bottom edge instead of the top.
    function drawerRect() {
      if (!drawerEl) return null;
      var r = drawerEl.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    }

    function drawerOffsetFromBall() {
      var b = ballEl ? ballEl.getBoundingClientRect() : null;
      var d = drawerRect();
      if (!b || !d) return null;
      return { dx: d.left - b.left, dy: d.top - b.top };
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

    // ---- drawer placement ----------------------------------------------------
    // The drawer is absolutely positioned by an explicit (left, top) pair. Both the
    // ball and the drawer are position:fixed, so the same math applies to each.
    function applyDrawerPos(x, y) {
      if (!drawerEl) return;
      drawerEl.style.left = Math.round(x) + "px";
      drawerEl.style.top = Math.round(y) + "px";
      // Kill the CSS auto-anchor once we drive the position ourselves.
      drawerEl.style.right = "auto";
      drawerEl.style.bottom = "auto";
    }

    function clampDrawerPos(x, y) {
      var size = currentDrawerSize();
      var maxX = Math.max(EDGE, window.innerWidth - size.w - EDGE);
      var maxY = Math.max(EDGE, window.innerHeight - size.h - EDGE);
      return { x: clamp(x, EDGE, maxX), y: clamp(y, EDGE, maxY) };
    }

    // Default spot: right of the ball when it sits on the left half, left of the
    // ball when it sits on the right half, so the panel never covers the ball.
    function defaultDrawerPos() {
      var size = currentDrawerSize();
      var b = ballEl ? ballEl.getBoundingClientRect() : null;
      var bx = b ? b.left : Math.max(12, window.innerWidth - BALL_SIZE - 26);
      var by = b ? b.top : Math.round(window.innerHeight * 0.5);
      var x;
      if (bx + BALL_SIZE + DRAWER_GAP + size.w <= window.innerWidth - EDGE) {
        x = bx + BALL_SIZE + DRAWER_GAP;                 // ball on the left -> drawer right
      } else if (bx - DRAWER_GAP - size.w >= EDGE) {
        x = bx - DRAWER_GAP - size.w;                    // ball on the right -> drawer left
      } else {
        x = window.innerWidth - size.w - 18;             // fall back to the old corner
      }
      var y = by + BALL_SIZE / 2 - size.h / 2;           // vertically centred on the ball
      return clampDrawerPos(x, y);
    }

    // Place the drawer: saved spot if there is one, otherwise beside the ball.
    function placeDrawer() {
      if (!drawerEl) return;
      applyDrawerSize();
      var p = readDrawerPos();
      var target = p ? clampDrawerPos(p.x, p.y) : defaultDrawerPos();
      applyDrawerPos(target.x, target.y);
    }

    // Carry an open drawer along with the ball, preserving their relative offset.
    // Carry an open drawer along with the ball, preserving their relative offset.
    // The offset is passed in because it MUST be sampled at pointerdown: measuring it
    // here would compare the ball's NEW position against the drawer's OLD one on every
    // move, which pins the drawer in place instead of following (found by the probe).
    function followDrawer(ballX, ballY, offset) {
      if (!open || !drawerEl || !followEnabled || !offset) return;
      var size = currentDrawerSize();
      var nx = clamp(ballX + offset.dx, EDGE, Math.max(EDGE, window.innerWidth - size.w - EDGE));
      var ny = clamp(ballY + offset.dy, EDGE, Math.max(EDGE, window.innerHeight - size.h - EDGE));
      applyDrawerPos(nx, ny);
    }

    function setOpen(v) {
      open = !!v;
      saveOpen(open);
      if (!drawerEl || !ballEl) return;
      if (open) {
        placeDrawer();
        drawerEl.classList.add("open");
        ballEl.classList.add("active");
        ballEl.setAttribute("title", "收起 LobsterAIDaddy 控制台");
        syncFollowButton();
        // Refresh on open so the numbers are current, then keep polling while it stays
        // open (the web console refreshed every 15s; same cadence here).
        startRefresh();
        fetchStatus();
      } else {
        var cur = drawerRect();
        if (cur) saveDrawerPos(cur.left, cur.top);
        drawerEl.classList.remove("open");
        ballEl.classList.remove("active");
        ballEl.setAttribute("title", "打开 LobsterAIDaddy 控制台");
        stopRefresh();
      }
    }

    // Poll /api/status only while the drawer is open; a closed drawer costs nothing.
    /**
     * 🔴 后台也要刷新（2026-10-11 对齐 dsh-workbuddy-hub 的成熟做法）。
     *
     * 原实现是 `if (!open) { stopRefresh(); return; }` —— 抽屉一关，**刷新彻底停止**，
     * 于是悬浮球上的状态点/角标永远停在"上次开抽屉那一刻"。而状态是在后台变化的
     * （账号被切换、签到、网关断开），用户关着抽屉时根本看不到。
     *
     * 现在：抽屉打开时 15 秒；关闭时降频到 60 秒（够及时，又不浪费请求）。
     */
    function startRefresh() {
      stopRefresh();
      refreshTimer = setInterval(function () {
        if (open) {
          fetchStatus();
          // 🔴 抽屉打开时同时拉 /health —— 自动签到状态要能实时看到
          fetchHealth().then(function () { if (open) renderPanel(); });
          return;
        }
        // 后台低频：只为更新球上的状态点与角标
        if (Date.now() - lastFetchAt >= BACKGROUND_REFRESH_MS) {
          fetchStatus();
          fetchHealth();
        }
      }, REFRESH_MS);
    }

    function stopRefresh() {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }

    var CSS = [
      // Container must stay static + transparent to clicks (rule 7.6.3).
      "#" + HOST_ID + "{position:static;pointer-events:none;}",
      "#" + HOST_ID + " *{box-sizing:border-box;}",

      // ---------------- floating ball ----------------
      // 🔴🔴 2026-10-12 v0.9.3（用户第三轮反馈「造型不一致，要和 hub 统一」）：
      //
      // 上一版我把 hub 源码抄了一遍（`border-radius:50%`），用户仍指出**实物不一致**。
      // 像素级实测两张图后定案（不是读源码）：
      //   · 用户桌面截图里的 hub 球：70×70 亮块，顶部行宽仅 0.671×满宽、
      //     行宽达到满宽要到第 22 行 → 圆角半径 ≈22px（≈球径 31%）
      //   · hub 官方宣传图 docs/images/cooldown.png 右上角的球：同为圆角方形
      //   · 而 hub 源码写 `border-radius:"50%"`（正圆）→ **源码与实物不符**
      //
      // 结论：hub 的球实际渲染为 **圆角方形（squircle）**。上一版照源码抄成 50% 正圆，
      // 所以"看起来还是不一样"。现在按**实测形状**对齐：圆角半径 = 球径的 31%
      // （54px × 0.31 ≈ 17px）。
      ".lad-ball{position:fixed;z-index:2147483000;width:" + BALL_SIZE + "px;height:" + BALL_SIZE + "px;",
      "  border-radius:31%;pointer-events:auto;cursor:grab;user-select:none;box-sizing:border-box;",
      "  background:var(--dsw-alias-bg-layer-1, #2b2f36);",
      "  border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));",
      "  box-shadow:0 3px 14px rgba(0,0,0,.34);",
      "  display:flex;align-items:center;justify-content:center;",
      "  transition:transform .12s ease,box-shadow .12s ease;}",
      ".lad-ball:hover{transform:scale(1.06);box-shadow:0 5px 18px rgba(0,0,0,.40);}",
      ".lad-ball.dragging{cursor:grabbing;transform:scale(.96);transition:none;}",
      // 激活态：品牌色描边（保留原有语义，但改成与 hub 一致的"细环"而非外发光）
      ".lad-ball.active{border-color:var(--dsw-alias-brand-primary, #1f6feb);",
      "  box-shadow:0 3px 14px rgba(0,0,0,.34),0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #1f6feb) 32%, transparent);}",
      // 图标容器：固定 28px（同 hub）。
      // 🔴 图形本身已缩小到视框的 78%（见 ICON_SVG 注释），所以这里保持 28px 容器，
      // 视觉留白就与 hub 一致，不会再"顶到球边"。
      ".lad-emoji{width:28px;height:28px;display:block;pointer-events:none;color:var(--dsw-alias-label-primary, #e6e8ec);}",
      // 🔴 2026-10-12：删除悬浮球右下角的圆点（原「守护进程在线」指示灯）。
      // 控制台停用后它恒为灰色（永远 off），用户看到的只是一个"圆形的窟窿"。
      // 状态已由抽屉里的状态行承担（LobsterAI：运行中 / 内置 · 账号 N 个），球上不再重复。
      // badge with account count
      ".lad-badge{position:absolute;left:-4px;top:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;",
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-primary, #1f2328);font-size:11px;font-weight:600;line-height:18px;text-align:center;",
      "  border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));pointer-events:none;display:none;}",
      ".lad-badge.show{display:block;}",

      // ---------------- drawer ----------------
      // Position is driven by JS (left/top). `right:18px;top:18px` stays only as the
      // pre-first-paint fallback; applyDrawerPos() overrides it with left/top.
      // 🔴 背景统一到宿主令牌（2026-10-11）：原来这里是写死的深蓝黑
      // rgba(13,17,28,.97)，而内容区用的是浅色令牌 → 浅色主题下出现
      // 「顶部深色 + 下方浅色」的黑白分割。现在整块抽屉用同一套令牌。
      ".lad-drawer{position:fixed;z-index:2147482999;left:auto;top:18px;right:18px;",
      "  background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.08));",
      "  border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25));border-radius:16px;",
      "  box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;display:none;flex-direction:column;",
      "  pointer-events:auto;backdrop-filter:blur(10px);}",
      ".lad-drawer.open{display:flex;}",
      // The whole title bar is the drawer's drag handle.
      // 🔴 标题栏**不再单独设背景**：它与内容区同底，靠一条细边框分隔即可，
      // 避免"上深下浅"的硬切。拖动时的手感靠 cursor 变化提示。
      // 🔴 2026-10-12 v0.9.4：标题栏允许**换行**。
      //
      // 实测：整条标题栏的自然宽度需求 = **467px**
      //   （logo 20 + 标题块 119 + 跟随 55 + ⟳ 26 + 浏览器打开 82 + ★Star 61 + ✕ 26
      //     + 6 个 gap×9=54 + 左右内边距 24 = 467）
      // 而抽屉最小宽度只有 380px、常见默认 420px → **装不下**。
      //
      // 之前 `flex-wrap` 是默认的 nowrap，于是浏览器压缩子项 → 文字拐行（用户看到的现象）。
      // 只加 `flex:0 0 auto` 能止住拐行，但会把最后的 ✕ 挤出可视区（实测确认）。
      //
      // ✅ 正解：`flex-wrap:wrap` —— 空间不足时按钮组整体折到第二行，
      // 而不是压缩文字、也不是溢出裁掉。同时按钮组自身用 row-gap 控制行距。
      ".lad-head{display:flex;flex-wrap:wrap;align-items:center;gap:9px;row-gap:6px;padding:10px 12px;",
      "  cursor:grab;user-select:none;",
      "  background:transparent;",
      "  border-bottom:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));flex:0 0 auto;touch-action:none;}",
      ".lad-head.dragging{cursor:grabbing;}",
      // Buttons must not start a drag when clicked.
      ".lad-head .lad-btn{cursor:pointer;}",
// 🔴 2026-10-12：抽屉 logo 对齐 hub —— 去掉橙红渐变背景，改为
      // 「品牌色 SVG + 无底」，与 hub 的 hIcon（19px + T.brand）同款。
      ".lad-logo{width:20px;height:20px;flex:0 0 auto;",
      "  color:var(--dsw-alias-brand-primary, #1f6feb);display:block;line-height:1;}",
      ".lad-title{flex:0 1 auto;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary, #1f2328);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".lad-sub{flex:0 1 auto;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary, #6a737d);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;}",
      // 🔴 标题栏里的文字块是「可牺牲方」：空间不足时收窄省略，按钮保持完整。
      // ⚠️ 但必须给一个**下限**（min-width:96px），否则会被压成一条竖线（v0.9.4 实测踩到）。
      // flex 收缩的计算规则：可收缩项的收缩量 ∝ flex-shrink × basis，
      // 所以要让「按钮不缩、标题有限地缩」，标题的 min-width 就是那道闸门。
      ".lad-titlewrap{display:flex;flex-direction:column;justify-content:center;min-width:96px;flex:0 1 auto;overflow:hidden;}",
      // 按钮组：自身可换行，且整体靠右。空间不足时**整组**折到第二行。
      ".lad-headbtns{display:flex;flex-wrap:wrap;align-items:center;gap:9px;row-gap:6px;flex:0 0 auto;}",
      ".lad-spacer{flex:1 1 auto;min-width:0;}",
      // 🔴 2026-10-12 v0.9.4（用户反馈「跟随 / 浏览器打开 / ★ Star 都拐行了」）：
      //
      // 根因：这些按钮是 .lad-head（display:flex）的子项，而 flex 子项**默认
      // `flex-shrink:1`**。标题栏里塞了 logo + 标题 + 副标题 + 6 个按钮，
      // 空间不足时浏览器就按比例压缩每个子项 → 按钮被压窄 →
      //   · 「跟随」(2 字) → 压到只容 1 字宽 → 竖排
      //   · 「浏览器打开」(5 字) → 断成两行
      //   · 「★ Star」→ 星号与文字断行
      //
      // 修法（三件套，缺一不可）：
      //   ① `flex:0 0 auto` —— 禁止压缩（从源头解决）
      //   ② `white-space:nowrap` —— 即使被压也不换行
      //   ③ 文字按钮 `flex-shrink:0` 已含在 ① 里
      // 同时把标题/副标题设为可收缩项（它们是"可省略"的一方，用 ellipsis 处理），
      // 这样空间不足时牺牲的是标题而不是按钮。
      ".lad-btn{flex:0 0 auto;white-space:nowrap;width:26px;height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));",
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary, #57606a);font-size:14px;line-height:1;cursor:pointer;",
      "  display:flex;align-items:center;justify-content:center;padding:0;}",
      ".lad-btn:hover{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.2));color:var(--dsw-alias-label-primary, #1f2328);}",
      // Text variant for the "浏览器打开" button (auto width instead of a square).
      ".lad-btn-wide{flex:0 0 auto;white-space:nowrap;width:auto;padding:0 10px;font-size:12px;font-weight:600;}",
      // "跟随" toggle: highlighted when the drawer travels with the ball.
      ".lad-btn.lad-follow{flex:0 0 auto;white-space:nowrap;width:auto;padding:0 9px;font-size:12px;font-weight:600;gap:4px;}",
      ".lad-btn.lad-follow.on{background:rgba(58,165,234,.28);border-color:rgba(122,212,255,.55);color:var(--dsw-alias-brand-primary, #1f6feb);}",
      ".lad-btn.lad-follow .lad-follow-mark{font-size:11px;line-height:1;}",
      // 🔴 内容区**不再单独设背景**：与抽屉同底即可，叠加两层半透明会产生可见色差。
      ".lad-body{flex:1 1 auto;position:relative;min-height:0;}",
      // ---------------- native console ----------------
      ".lad-panel{position:absolute;inset:0;overflow-y:auto;padding:12px 12px 18px;",
      "  font-size:13px;color:var(--dsw-alias-label-primary, #1f2328);line-height:1.6;}",
// 切号进度提示样式（独占一行，醒目）
      ".lad-switch-hint{margin-top:6px;padding:6px 9px;border-radius:7px;font-size:12px;",
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));",
      "  border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));",
      "  color:var(--dsw-alias-label-primary, #1f2328);}",
      ".lad-status{display:flex;align-items:center;gap:7px;padding:0 2px 10px;'color:var(--dsw-alias-label-secondary, #57606a);font-size:12px;",
      "  border-bottom:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));margin-bottom:10px;}",
      ".lad-mini-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:#6b7280;}",
      ".lad-mini-dot.on{background:#34d399;box-shadow:0 0 6px #34d399;}",
      ".lad-mini-dot.off{background:#6b7280;}",
      ".lad-flex-1{flex:1 1 auto;}",
      ".lad-muted{color:var(--dsw-alias-label-tertiary, #6a737d);}",
      ".lad-tiny{font-size:11px;}",
      ".lad-balance{font-size:15px;}",
      ".lad-item{font-size:11.5px;color:var(--dsw-alias-label-secondary, #57606a);}",
      ".lad-empty{padding:14px 4px;color:var(--dsw-alias-label-tertiary, #6a737d);font-size:12.5px;}",
      // Actions sit directly under the status line (no top margin now that they lead),
      // and the account list starts a fresh block below the buttons.
      ".lad-accounts{display:flex;flex-direction:column;gap:8px;margin-top:14px;padding-top:12px;",
      "  border-top:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));}",
      ".lad-acc{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:10px;",
      // 🔴 账号卡底色改用主题令牌：原来写死 rgba(255,255,255,.045)（深色主题专用），
      // 浅色主题下会在浅底上再叠一层白，卡片边界几乎看不出。
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));}",
      ".lad-acc-main{flex:1 1 auto;min-width:0;}",
      ".lad-acc-name{font-weight:600;font-size:13.5px;}",
      ".lad-acc-quota{margin-top:2px;}",
      ".lad-acc-meta{margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".lad-tag{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11.5px;}",
      ".lad-tag.ok{background:rgba(52,211,153,.16);color:#6ee7b7;}",
      ".lad-tag.bad{background:rgba(248,113,113,.16);color:#fca5a5;}",
      ".lad-tag.idle{background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary, #6a737d);}",
      ".lad-btn-sm{padding:4px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));",
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary, #57606a);font-size:12px;cursor:pointer;flex:0 0 auto;}",
      ".lad-btn-sm:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.2));color:var(--dsw-alias-label-primary, #1f2328);}",
      ".lad-btn-sm:disabled{opacity:.45;cursor:not-allowed;}",
      ".lad-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;}",
      ".lad-act{padding:6px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.38));",
      "  background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary, #57606a);font-size:12.5px;cursor:pointer;}",
      ".lad-act:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.2));color:var(--dsw-alias-label-primary, #1f2328);}",
      ".lad-act.primary{background:linear-gradient(180deg,#ff7a45,#e8442a);border-color:transparent;color:#fff;font-weight:600;}",
      ".lad-act.primary:hover:not(:disabled){filter:brightness(1.08);}",
      ".lad-act:disabled{opacity:.45;cursor:not-allowed;}",
      ".lad-info{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin-top:14px;padding-top:11px;",
      "  border-top:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));font-size:11.5px;}",
      ".lad-info span{color:var(--dsw-alias-label-tertiary, #6a737d);}",
      ".lad-info b{color:var(--dsw-alias-label-secondary, #57606a);font-weight:500;word-break:break-all;}",
      // 🔴 2026-10-12：定时自动签到状态着色（三档：ok / warn / bad / idle）。
      // 用宿主语义令牌 + 中性回退，深浅主题下都能读（SKILL 7.15.3：state-* 静态色不随主题反转）。
      ".lad-ck{font-weight:600 !important;}",
      ".lad-ck.ok{color:var(--dsw-alias-state-success-primary, #16a34a) !important;}",
      ".lad-ck.warn{color:var(--dsw-alias-state-warn-primary, #d97706) !important;}",
      ".lad-ck.bad{color:var(--dsw-alias-state-error-primary, #d64545) !important;}",
      ".lad-ck.idle{color:var(--dsw-alias-label-tertiary, #6a737d) !important;font-weight:500 !important;}",
      // current signed-in account banner
      ".lad-current{display:flex;align-items:center;gap:8px;margin-top:12px;padding:7px 10px;",
      "  border-radius:9px;background:rgba(58,165,234,.14);border:1px solid rgba(122,212,255,.28);}",
      ".lad-current:empty{display:none;}",
      ".lad-cur-label{font-size:11.5px;color:var(--dsw-alias-brand-primary, #1f6feb);flex:0 0 auto;}",
      ".lad-cur-name{font-size:13px;font-weight:600;color:var(--dsw-alias-brand-primary, #1f6feb);}",
      // resize grip
      ".lad-resize{position:absolute;left:0;bottom:0;width:18px;height:18px;cursor:nesw-resize;z-index:5;}",
      ".lad-resize::after{content:'';position:absolute;left:4px;bottom:4px;width:9px;height:9px;",
      "  border-left:2px solid rgba(255,255,255,.3);border-bottom:2px solid rgba(255,255,255,.3);border-radius:0 0 0 3px;}",
      ".lad-hint{position:absolute;left:10px;bottom:8px;font-size:10.5px;color:var(--dsw-alias-label-tertiary, #6a737d);pointer-events:none;}",
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
// 🔴 2026-10-12：抽屉 logo 也用 SVG（同 hub 的做法），不再用 emoji。
      // 与悬浮球图标是同一个 ICON_SVG，视觉完全一致。
      logo.innerHTML = ICON_SVG;

      var titleWrap = document.createElement("div");
      // 🔴 v0.9.4：标题块允许收缩并省略（min-width:0 是 flex 里让它能真正收窄的关键，
      // 否则默认 min-width:auto 会撑住不缩，把压力全推给右侧的按钮）。
      titleWrap.className = "lad-titlewrap";
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

      // "跟随" toggle: when on, the open panel travels with the floating ball.
      var btnFollow = document.createElement("button");
      btnFollow.className = "lad-btn lad-follow";
      btnFollow.setAttribute("data-act", "follow");
      btnFollow.setAttribute("data-role", "follow");
      btnFollow.title = "开启后，拖动悬浮球时这个面板会跟着一起移动";
      var followMark = document.createElement("span");
      followMark.className = "lad-follow-mark";
      followMark.textContent = "●";
      var followLabel = document.createElement("span");
      followLabel.className = "lad-follow-label";
      followLabel.textContent = "跟随";
      btnFollow.appendChild(followMark);
      btnFollow.appendChild(followLabel);

      var btnReload = document.createElement("button");
      btnReload.className = "lad-btn";
      btnReload.textContent = "⟳";
      btnReload.setAttribute("data-act", "reload");
      btnReload.title = "刷新账号与额度";

      // Fallback path (方案 C): the full web console in the system browser. Kept because
      // it always works — the Host launches it for real — even if the native view fails.
      var btnOpen = document.createElement("button");
      btnOpen.className = "lad-btn lad-btn-wide";
      btnOpen.textContent = "浏览器打开";
      btnOpen.setAttribute("data-act", "external");
      btnOpen.title = "在系统默认浏览器中打开完整网页控制台";

      var btnClose = document.createElement("button");
      btnClose.className = "lad-btn";
      btnClose.textContent = "✕";
      btnClose.setAttribute("data-act", "close");
      btnClose.title = "收起";

      // 🔴 2026-10-11：★ Star 直达（对齐 dsh-workbuddy-hub 的做法）。
      // REPO_READY=true 时可点；未发布时给提示而不是打开 404。
      var btnStar = document.createElement("button");
      btnStar.className = "lad-btn lad-btn-wide";
      btnStar.textContent = "★ Star";
      btnStar.setAttribute("data-act", "star");
      btnStar.title = REPO_READY
        ? ("给这个插件点个 Star：" + REPO_URL)
        : ("仓库尚未发布，发布后此按钮直达 GitHub：" + REPO_URL);

      // 🔴 v0.9.4：把按钮包进独立按钮组，让它们**作为一个整体**换行/靠右，
      // 而不是散落在标题栏里各自折行（那样 spacer 会把折行位置弄乱）。
      var headBtns = document.createElement("div");
      headBtns.className = "lad-headbtns";

      head.appendChild(logo);
      head.appendChild(titleWrap);
      head.appendChild(spacer);
      headBtns.appendChild(btnFollow);
      headBtns.appendChild(btnReload);
      headBtns.appendChild(btnOpen);
      headBtns.appendChild(btnStar);
      headBtns.appendChild(btnClose);
      head.appendChild(headBtns);

      var body = document.createElement("div");
      body.className = "lad-body";
      // The console is rendered as native DOM. An iframe cannot be used here: the DSH
      // desktop shell serves the page from `dsh-app://app`, whose handler 403s any
      // sub-frame (it only grants `x-dsh-desktop-renderer` to the top-level frame), and
      // an absolute loopback URL is refused by the renderer's CSP. That is why the
      // drawer went black every ~15s no matter which URL form was used.
      panelEl = document.createElement("div");
      panelEl.className = "lad-panel";
      body.appendChild(panelEl);

      // Layout order matters: the action buttons come FIRST so the common operations are
      // reachable without scrolling, then the current account, then the full list, then
      // the run info.
      // Offline / first-paint state, replaced by renderPanel() as soon as data arrives.
      statusEl = document.createElement("div");
      statusEl.className = "lad-status";
      panelEl.appendChild(statusEl);

      actionsEl = document.createElement("div");
      actionsEl.className = "lad-actions";
      panelEl.appendChild(actionsEl);

      currentEl = document.createElement("div");
      currentEl.className = "lad-current";
      panelEl.appendChild(currentEl);

      accountsEl = document.createElement("div");
      accountsEl.className = "lad-accounts";
      panelEl.appendChild(accountsEl);

      infoEl = document.createElement("div");
      infoEl.className = "lad-info";
      panelEl.appendChild(infoEl);

      var grip = document.createElement("div");
      grip.className = "lad-resize";
      grip.setAttribute("data-act", "resize");
      grip.title = "拖动调整大小";

      body.appendChild(grip);

      drawerEl.appendChild(head);
      drawerEl.appendChild(body);

      // ---- floating ball ----
      ballEl = document.createElement("div");
      ballEl.className = "lad-ball";
      ballEl.setAttribute("title", "打开 LobsterAIDaddy 控制台");
      ballEl.setAttribute("role", "button");

      var emoji = document.createElement("div");   // 名字保留（历史），内容改为 SVG
      // 🔴 2026-10-12：emoji（🦞）→ 内联 SVG（同 hub 做法）。
      // 理由：① emoji 在不同系统/字体下渲染差异大（Windows 是彩色、有些环境是方框）；
      // ② SVG 可随主题色变化（currentColor），深浅色都清晰；③ 与 hub 的图标风格统一。
      emoji.className = "lad-emoji";
      emoji.innerHTML = ICON_SVG;

      var badge = document.createElement("div");
      badge.className = "lad-badge";
      badge.setAttribute("data-role", "badge");

      ballEl.appendChild(emoji);
      ballEl.appendChild(badge);

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

    // ---------------------------------------------------------------------------
    // Native console rendering.
    //
    // An iframe CANNOT be used here. The DSH desktop shell serves this page from
    // `dsh-app://app`, and that scheme's handler in the installed lib/web-document.js
    // returns 403 for any request whose `x-dsh-desktop-renderer` header is missing or
    // whose origin is not `dsh-app://app` — and the header is only ever granted to the
    // TOP-LEVEL frame (`request.frame === owner.mainFrame`). Electron also disables
    // `webview` (main.js calls event.preventDefault() on will-attach-webview), and an
    // absolute http://127.0.0.1:<port> URL is refused by the renderer's CSP.
    //
    // Result: every iframe form failed, so the drawer went black on each of the
    // console's own 15s refreshes. `fetch()` has no such restriction (verified live:
    // relative-fetch 200 while loopback-fetch failed), so the console is drawn as
    // native DOM from the same JSON the web page uses.
    // ---------------------------------------------------------------------------
    function esc(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function fmtTime(ms) {
      try { return new Date(ms).toLocaleTimeString(); } catch (e) { return ""; }
    }

    // Full date + time for a check-in timestamp, e.g. "09-28 16:21".
    // Falls back to an empty string for a missing/invalid value so the caller can simply
    // omit the line rather than printing "Invalid Date".
    function fmtDateTime(ms) {
      try {
        if (ms == null || !isFinite(Number(ms))) return "";
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return "";
        var mm = String(d.getMonth() + 1).padStart(2, "0");
        var dd = String(d.getDate()).padStart(2, "0");
        var hh = String(d.getHours()).padStart(2, "0");
        var mi = String(d.getMinutes()).padStart(2, "0");
        return mm + "-" + dd + " " + hh + ":" + mi;
      } catch (e) { return ""; }
    }

    // Render the whole console from one /api/status payload.
    function renderPanel(s) {
      if (!panelEl) return;
      lastStatus = s || null;
      var accounts = (s && s.accounts) || [];

      // ---- status line ----
      if (statusEl) {
        // 🔴 2026-10-11：「守护进程」是 LobsterDaddy 控制台时代的遗留概念
        // （那是 17819 面板的常驻 daemon）。现在插件已内置数据层、控制台停用，
        // 这个状态既无意义、又会误导（永远显示"未运行"）。改为显示**真正有用**的信息：
        //   · LobsterAI 本体是否在运行（切号前需要知道）
        //   · 数据来源
        //   · 账号数
        var lobsterUp = !!(s && (s.lobsterRunning === true
          || (s.accounts && s.accounts.length > 0 && s.__source === "builtin")));
        var dotCls = "lad-mini-dot " + (lobsterUp ? "on" : "off");
        var srcLabel = dataSourceMode === "builtin"
          ? (s && s.panelOnline ? "内置（控制台在线）" : "内置")
          : "控制台";
        statusEl.innerHTML =
          "<span class='" + dotCls + "'></span>" +
          "<span>LobsterAI：" + (lobsterUp ? "运行中" : "已关闭") + "</span>" +
          "<span class='lad-flex-1'></span>" +
          "<span class='lad-muted'>" + esc(srcLabel) + " · 账号 " + accounts.length + " 个</span>";
        // 🔴 2026-10-12 v0.9.5（用户反馈「频次最好显示在界面上」）：
        // 用户明确要求「不用改位置，就在最后就行」—— 定时签到信息保持在底部
        // 「运行信息」区（见下方 infoEl），顶部状态行**不重复展示**。
        // 🔴 切号进度/结果提示（2026-10-11）：切号要杀进程+重启 App，需十几秒，
        // 这段必须让用户看到，否则表现为"点了没反应"。
        if (switchHint) {
          var hintEl = document.createElement("div");
          hintEl.className = "lad-switch-hint";
          hintEl.textContent = switchHint;
          statusEl.appendChild(hintEl);
        }
      }

      // ---- current signed-in account ----
      // Sourced from the Host (/current), which reads LobsterAI's own store, so it stays
      // accurate after a switch instead of relying on a manual "capture" step.
      if (currentEl) {
        if (currentAccount) {
          if (currentAccount.uid) {
            var curName = currentAccount.name || currentAccount.uid;
            currentEl.innerHTML =
              "<span class='lad-cur-label'>当前账号</span>" +
              "<span class='lad-cur-name'>" + esc(curName) + "</span>";
          } else if (currentAccount.available && currentAccount.reason === "nologin") {
            currentEl.innerHTML = "<span class='lad-cur-label'>当前账号</span>" +
              "<span class='lad-muted'>LobsterAI 未登录</span>";
          } else {
            currentEl.innerHTML = "";
          }
        } else {
          currentEl.innerHTML = "";
        }
      }

      // ---- account table ----
      if (accountsEl) {
        if (!accounts.length) {
          accountsEl.innerHTML = "<div class='lad-empty'>还没有账号。点「免退出登录新账号」扫码加入；" +
            "若已在 LobsterAI 里登录，当前账号会自动显示（无需手动抓取）。</div>";
        } else {
          var rows = accounts.map(function (a) {
            var snap = a.snapshot || null;
            var quota;
            if (!snap) {
              quota = "<span class='lad-tag idle'>—</span>";
            } else if (snap.error) {
              quota = "<span class='lad-tag bad'>余额获取失败</span>";
            } else {
              quota = "<b class='lad-balance'>" + (snap.balance == null ? "?" : esc(snap.balance)) + "</b>" +
                "<span class='lad-muted'> 积分</span>";
              var line2 = [];
              if (snap.plan) line2.push(esc(snap.plan));
              if (snap.dailyUsed != null) line2.push("今日已用 " + esc(snap.dailyUsed));
              if (line2.length) quota += "<br><span class='lad-muted'>" + line2.join(" · ") + "</span>";
              if (snap.items && snap.items.length) {
                quota += "<br>" + snap.items.slice(0, 3).map(function (it) {
                  return "<span class='lad-item'>" + esc(it.label) + " " + esc(it.remaining) +
                    (it.exp ? "（" + esc(it.exp) + " 前有效）" : "") + "</span>";
                }).join("<br>");
              }
              if (snap.updatedAt) {
                quota += "<br><span class='lad-muted lad-tiny'>更新于 " + fmtTime(snap.updatedAt) + "</span>";
              }
            }

            // Check-in state. The panel already resolves "is this today's record?" for us:
            // it emits `today` only when the cache row's date equals the current date, and
            // null otherwise. So: null = not yet checked in today; ok = signed in;
            // already = an earlier run already claimed it today (idempotent re-check).
            var today;
            if (a.today && a.today.ok) {
              var label = a.today.already ? "今日已签到" : "已签到";
              var atText = a.today.at ? fmtDateTime(a.today.at) : "";
              today = "<span class='lad-tag ok'>" + label + "</span>" +
                (atText ? "<span class='lad-muted lad-tiny'>" + atText + "</span>" : "");
            } else if (a.today && !a.today.ok) {
              today = "<span class='lad-tag bad'>" + esc(a.today.text || "签到失败") + "</span>";
            } else {
              today = "<span class='lad-tag idle'>今日未签到</span>";
            }
            var exp = a.accessExp ? new Date(a.accessExp * 1000).toLocaleDateString() : "未知";
            var soon = a.accessExp && a.accessExp * 1000 - Date.now() < 86400000;

            return "<div class='lad-acc'>" +
              "<div class='lad-acc-main'>" +
                "<div class='lad-acc-name'>" + esc(a.name) +
                  "<span class='lad-muted lad-tiny'> " + esc(a.uidShort) + "</span></div>" +
                "<div class='lad-acc-quota'>" + quota + "</div>" +
                "<div class='lad-acc-meta'>" + today +
                  "<span class='lad-muted lad-tiny'>token 至 " + exp + (soon ? " ⚠" : "") + "</span></div>" +
              "</div>" +
              "<button class='lad-btn-sm' data-act='switch' data-uid='" + esc(a.uid) + "'" +
                (busy ? " disabled" : "") + ">切换</button>" +
            "</div>";
          }).join("");
          accountsEl.innerHTML = rows;
        }
      }

      // ---- actions ----
      if (actionsEl) {
        var flow = (s && s.loginFlow) || {};
        // 🔴 2026-10-11 v0.7.2：删掉两个「控制台专属」按钮
        //   · 复位登录流程（reset）—— 内置模式下不存在"登录流程"状态
        //   · 开启/关闭自动签到同意（consent）—— 同意状态原本存在控制台里；
        //     现在签到改为**用户显式点击即执行**，不再需要"预先同意"这一步
        // 签到按钮也不再依赖 consent（那是控制台概念），只要不在忙态就可用。
        actionsEl.innerHTML = [
          "<button class='lad-act primary' data-act='checkin'" + (busy ? " disabled" : "") + ">立即全部签到</button>",
          // 🔴 2026-10-12 v0.9.5（用户指出）：删掉「抓取当前登录账号」按钮 —— **它是冗余的**。
          // 该按钮打的 /local/capture 与 /current 干的是同一件事：
          //   · /current       → readCurrentAccountId()   ← 每次刷新**自动**调用（15 秒一次）
          //   · /local/capture → currentLocalAccount()    ← 需要手动点
          // 两者都直读 LobsterAI 存储取当前账号，结果一样。
          // 而"当前账号"早就自动显示在抽屉里（见 currentEl），切号后下一次轮询即刷新，
          // 根本不需要用户手动"抓取"。留着只会让人以为不点它就不更新。
          "<button class='lad-act primary' data-act='login'" + ((busy || flow.active) ? " disabled" : "") + " title='需要 LobsterDaddy 控制台提供登录流程；未运行时会给出提示'>＋ 免退出登录新账号</button>",
          "<button class='lad-act' data-act='quota'" + (busy ? " disabled" : "") + ">刷新额度</button>",
          "<button class='lad-act' data-act='sync'" + (busy ? " disabled" : "") + " title='把网关端口/Token 同步进 DSH（切号后已自动做）'>同步网关到 DSH</button>",
        ].join("");
      }

      // ---- info ----
      // 🔴 2026-10-12（用户反馈「自动签到我在界面看不到」）：
      // 原来这里显示的是「自动签到同意」—— 那是控制台时代的旧概念，v0.7.2 已随控制台退场
      // 删除（lib/index.js 里 consent 恒为 undefined）→ **界面永远显示"未开启"**，
      // 而真正的「定时自动签到」跑没跑、上次结果如何，界面上一个字都没有。
      // 现在改成读宿主的 /health，把调度器真实状态显示出来。
      if (infoEl) {
        var gw = (s && s.gateway) || {};
        var ck = (healthCache && typeof healthCache === "object") ? healthCache : {};
        var sch = (ck.checkinScheduler) || {};
        var last = sch.lastRun || null;
        // 组装「定时自动签到」一行：**频次** + 上次结果 + 下次执行时间。
        // 🔴 v0.9.5：用户要求「频次最好显示在界面上」—— 频次是这一行的第一信息，
        // 并且额外算出**下次执行时间**（由「上次时间 + 间隔」推算），
        // 这样用户能直接看出"它还会不会再跑、什么时候跑"。
        var ckText, ckTone = "ok";
        var interval = sch.intervalMinutes || 60;
        // 把「上次时间 + 间隔」格式化成 HH:MM，用于显示下次执行
        var nextHhmm = function () {
          if (!last || !last.at) return null;
          var nd = new Date(Number(last.at) + interval * 60000);
          return ("0" + nd.getHours()).slice(-2) + ":" + ("0" + nd.getMinutes()).slice(-2);
        };
        if (healthAvailable === false) {
          ckText = "状态未知（健康检查不可用）";
          ckTone = "idle";
        } else if (!sch.enabled) {
          ckText = "未运行";
          ckTone = "bad";
        } else if (last) {
          var d = last.at ? new Date(last.at) : null;
          var hhmm = d
            ? ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2)
            : "—";
          var okAll = (last.okCount === last.total);
          var next = nextHhmm();
          ckText = "运行中 · 每 " + interval + " 分钟"
            + " · 上次 " + hhmm + " " + last.okCount + "/" + last.total
            + (okAll ? " 全部成功" : " 部分失败")
            + (next ? " · 下次约 " + next : "");
          ckTone = okAll ? "ok" : "warn";
        } else {
          ckText = "运行中 · 每 " + interval + " 分钟"
            + " · 首次将在启动后 " + (sch.startupDelaySeconds || 8) + " 秒执行";
        }
        // 🔴 2026-10-12 v0.9.5（用户要求）：把「网关端口」改成「转接 DSH」。
        // 原来那格是控制台时代的死遗留（内置模式写死 gateway:null → 恒显示"未读取"），
        // 只会让人误以为出错。现在显示 **DSH 转接链路**的真实信息与状态：
        //   · 读到配置：本地端口 + 该端口是否在监听
        //   · 读不到：明确说明原因（不留空、不假装正常 —— SKILL 7.20）
        var rl = (s && s.relay) || null;
        var relayText, relayTone = "ok";
        if (!rl) {
          relayText = "状态未知（宿主未返回转接信息）";
          relayTone = "idle";
        } else if (!rl.available) {
          relayText = rl.note || "DSH 未配置 lobsterai 转接";
          relayTone = "idle";
        } else if (rl.alive) {
          relayText = "已接入 · " + esc(rl.endpoint || ("127.0.0.1:" + rl.port)) + " 在线";
          relayTone = "ok";
        } else {
          // 配置里有端口，但服务没起 —— 这是**真实存在**的状态：
          // 当前用的是别的 provider（如 workbuddy），或 LobsterAI 网关没启动。
          relayText = esc(rl.endpoint || ("127.0.0.1:" + rl.port)) + " 未监听"
            + (rl.note ? "（" + esc(rl.note) + "）" : "");
          relayTone = "warn";
        }
        infoEl.innerHTML = [
          "<span>数据目录</span><b>" + esc(s && s.dataDir) + "</b>",
          "<span>LobsterAI 进程</span><b>" + ((s && s.lobsterRunning) ? "运行中" : "未运行") + "</b>",
          "<span>定时自动签到</span><b class='lad-ck " + ckTone + "'>" + esc(ckText) + "</b>",
          "<span>转接 DSH</span><b class='lad-ck " + relayTone + "'>" + relayText + "</b>",
        ].join("");
      }
    }

    /**
     * 拉取宿主 /health，供抽屉显示「定时自动签到」真实状态。
     *
     * 🔴 失败必须显式标记（healthAvailable=false），不能留空：
     * 否则界面会静默显示成"未知"，用户再次看不到签到（SKILL 7.20）。
     * 该请求与主数据分开，任一失败都不影响另一条链路。
     */
    function fetchHealth() {
      return fetch(HEALTH_PATH, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        })
        .then(function (h) {
          healthAvailable = true;
          healthCache = h || null;
          return h;
        })
        .catch(function (e) {
          healthAvailable = false;
          healthCache = null;
          report("health fetch FAILED " + (e && e.message));
          return null;
        });
    }

    // Fetch the CURRENT-account probe. Kept separate from the console payload so a failure
    // here (e.g. LobsterAI not installed) can never blank the account list.
    function fetchCurrent() {
      return fetch(CURRENT_PATH, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (c) { currentAccount = c || null; return c; })
        .catch(function (e) {
          report("current fetch FAILED " + (e && e.message));
          return null;
        });
    }

/**
     * 把宿主的 /local/status 适配成控制台 /api/status 的形状，
     * 这样 renderPanel 无需任何改动就能渲染内置数据。
     *
     * 形状对照（2026-10-11 从实机控制台抄取）：
     *   控制台 accounts[i] = { uid, uidShort, name, accessExp(秒), today{ok,already,text,at}, snapshot }
     *   内置   accounts[i] = { uid, phone, nickname, accessExp(毫秒), checkin{...}, isCurrent }
     */
    function adaptLocalStatus(local) {
      var accounts = (local.accounts || []).map(function (a) {
        return {
          uid: a.uid,
          uidShort: String(a.uid) + "…",
          name: a.nickname || a.phone || a.uid,
          // 控制台用秒；内置用的是毫秒 → 这里换算回去
          accessExp: a.accessExp ? Math.floor(Number(a.accessExp) / 1000) : null,
          today: a.checkin
            ? { ok: a.checkin.ok, already: a.checkin.already, text: a.checkin.text || "", at: a.checkin.at }
            : null,
          // 内置额度（宿主直调上游，见 lib/index.js fetchQuotaView）—— 不需要控制台
          snapshot: a.snapshot || null,
          isCurrent: a.isCurrent === true,
        };
      });
      var cur = local.current || null;
      return {
        ok: true,
        __source: "builtin",
        app: "LobsterAI",
        dataDir: local.accountsDir || "",
        dbExists: true,
        consent: true,
        // 🔴 2026-10-11：删掉了遗留的 `daemon` 字段（那是 LobsterDaddy 控制台
        // 时代的常驻进程概念，控制台停用后已无意义）。
        // lobsterRunning 改为有依据的判断：宿主能读到内置账号列表 = 它的库可读。
        lobsterRunning: (local.accountsCount || 0) > 0,
        loginFlow: null,
        gateway: null,
        accounts: accounts,
        current: cur ? { uid: cur.uid, name: cur.nickname || cur.phone } : null,
        panelOnline: !!local.panelOnline,
      };
    }

    // Fetch the CONSOLE payload through the proxy and render it. Never throws.
    // The current-account probe rides along so a switch is reflected on the same tick.
    function fetchStatus() {
      return Promise.all([
        // 内置优先：宿主直读 accounts/*.json + SQLite，不依赖 17819 控制台。
        // 内置不可用时自动回退到控制台代理（保留原能力的"可选增强"地位）。
        fetch(LOCAL_STATUS_PATH, { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (local) {
            if (local && local.ok && Array.isArray(local.accounts) && local.accounts.length) {
              dataSourceMode = "builtin";
              return adaptLocalStatus(local);
            }
            dataSourceMode = "console";
            return fetch(CONSOLE_SRC, { cache: "no-store" })
              .then(function (r) { return r.json(); })
              .catch(function (e) { return { __error: (e && e.message) || "fetch failed" }; });
          })
          .catch(function () {
            dataSourceMode = "console";
            return fetch(CONSOLE_SRC, { cache: "no-store" })
              .then(function (r) { return r.json(); })
              .catch(function (e) { return { __error: (e && e.message) || "fetch failed" }; });
          }),
        fetchCurrent(),
        // 🔴 与主数据分开请求：/health 失败不得清空账号列表（Promise.all 各自兜底）
        fetchHealth(),
      ])
        .then(function (results) {
          var s = results[0];
          if (s && s.__error) throw new Error(s.__error);
          probeFailStreak = 0;
          lastFetchAt = Date.now();   // 后台刷新判定用（见 startRefresh）
          renderPanel(s);
          return s;
        })
        .catch(function (e) {
          probeFailStreak++;
          report("status fetch FAILED (" + probeFailStreak + ") " + (e && e.message));
          if (probeFailStreak >= 2 && panelEl) {
            if (statusEl) {
              statusEl.innerHTML = "<span class='lad-mini-dot off'></span>" +
                "<span>面板没响应，正在自动恢复（每 60 秒巡检一次）</span>";
            }
          }
          return null;
        });
    }

    // POST one console action and refresh afterwards. Never throws.
    function postAction(path, body) {
      busy = true;
      renderPanel(lastStatus);
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.error) report("action " + path + " error: " + d.error);
          if (d && d.loginUrl) {
            try { window.open(d.loginUrl, "_blank"); } catch (e) { /* ignore */ }
          }
          return d;
        })
        .catch(function (e) { report("action " + path + " FAILED " + (e && e.message)); })
        .then(function () {
          busy = false;
          return fetchStatus();
        });
    }

    // Drag: pointer events on the ball itself (native listeners inside our own
    // shadow root are reliable — the slot/re-render caveat applies to React
    // synthetic events, which we deliberately avoid).
    // ---------------------------------------------------------------------------
    function bindBallDrag() {
      var dragging = false;
      var moved = false;
      var startX = 0, startY = 0, originX = 0, originY = 0;
      // Ball->drawer offset sampled once per drag, so the panel moves by exactly the
      // same delta as the ball for the whole gesture.
      var followOffset = null;

      ballEl.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        var rect = ballEl.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
        followOffset = (open && followEnabled) ? drawerOffsetFromBall() : null;
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
        // Requested feature: an open panel travels with the ball.
        followDrawer(nx, ny, followOffset);
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        ballEl.classList.remove("dragging");
        try { ballEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var rect = ballEl.getBoundingClientRect();
        savePos(Math.round(rect.left), Math.round(rect.top));
        if (open && followEnabled) {
          var d = drawerRect();
          if (d) saveDrawerPos(d.left, d.top);
        }
        followOffset = null;
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
        if (act === "follow") {
          followEnabled = !followEnabled;
          saveFollow(followEnabled);
          syncFollowButton();
          return;
        }
        if (act === "reload" || act === "retry") {
          probeFailStreak = 0;
          fetchStatus();
          return;
        }
if (act === "external") {
          openExternal();
          return;
        }
        // ★ Star：直达 GitHub 仓库（REPO_READY=false 时只提示，不打开 404）
        if (act === "star") {
          if (!REPO_READY) {
            switchHint = "仓库尚未发布；发布后此按钮直达 GitHub：" + REPO_URL;
            report("star clicked but REPO_READY=false");
            renderPanel(lastStatus);
            setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 8000);
            return;
          }
          openRepo();
          return;
        }

        // ---- 操作按钮 ----
        // 🔴 2026-10-11 v0.7.0：**内置优先，控制台降级**。
        // 原来这些全部打 /panel/api/*（17819 控制台），而控制台已停用 → 点了必然失败。
        // 现在凡是宿主已内置的，直接走 /local/*（不依赖任何外部进程）。
        var base = ROUTE_PREFIX + "/panel";
        var LOCAL = ROUTE_PREFIX;

        /**
         * 先试内置路由；不可用（404/未实现）时回退控制台。
         * @param {string} localPath  内置路由（如 /local/checkin）
         * @param {string} consolePath 控制台路由（如 /api/checkin）
         * @param {object} [body]     POST body（可选）
         */
        function actPreferLocal(localPath, consolePath, body) {
          var startedAt = Date.now();
          busy = true;
          switchHint = "执行中…";
          renderPanel(lastStatus);
          return fetch(LOCAL + localPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body || {}),
          })
            .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
            .then(function (d) {
              busy = false;
              if (d && d.ok) {
                var msg = d.summary || d.note || "完成";
                switchHint = msg + "（" + ((Date.now() - startedAt) / 1000).toFixed(1) + "s）";
                report("builtin " + localPath + " OK: " + msg);
                setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 8000);
                return fetchStatus();
              }
              if (d && d.error) report("builtin " + localPath + " error: " + d.error);
              // 内置未实现/失败 → 回退控制台
              switchHint = "内置不可用，尝试控制台…";
              renderPanel(lastStatus);
              return postAction(base + consolePath, body);
            })
            .catch(function (e) {
              busy = false;
              report("builtin " + localPath + " FAILED " + (e && e.message) + " → 回退控制台");
              switchHint = "";
              return postAction(base + consolePath, body);
            });
        }

        // 签到：内置直调上游（实测 6/6 成功）
        if (act === "checkin") { actPreferLocal("/local/checkin", "/api/checkin"); return; }
        // 抓取当前账号：内置重读 LobsterAI 存储
        if (act === "capture") { actPreferLocal("/local/capture", "/api/capture"); return; }
        // 刷新额度：内置绕过缓存强制重拉
        if (act === "quota") { actPreferLocal("/local/quota/refresh", "/api/quota/refresh"); return; }
        // 🔴 v0.7.2：「复位登录流程」与「开启/关闭自动签到同意」两个按钮已删除 —— 都是控制台专属概念。
        // 保留动作分发以免旧缓存的按钮报错，但给出明确提示而不是静默失败。
        if (act === "reset" || act === "consent") {
          switchHint = "该功能属于 LobsterDaddy 控制台，插件已不需要它（此按钮已移除）";
          report("retired action clicked: " + act);
          renderPanel(lastStatus);
          setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 6000);
          return;
        }
        // 同步网关 / 登录新账号：仍需控制台。**不能让用户点了没反应** —— 先探测再决定。
        if (act === "sync" || act === "login") {
          var needMsg = act === "sync"
            ? "同步网关需要 LobsterDaddy 控制台（当前未运行）。切号后网关通常已自动同步。"
            : "免退出登录新账号需要 LobsterDaddy 控制台（当前未运行）。可先在 LobsterAI 里登录，当前账号会自动显示。";
          busy = true;
          switchHint = "检查控制台…";
          renderPanel(lastStatus);
          fetch(ROUTE_PREFIX + "/status", { cache: "no-store" })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (st) {
              busy = false;
              if (st && st.panelOnline) {
                switchHint = "控制台在线，正在执行…";
                renderPanel(lastStatus);
                return postAction(base + (act === "sync" ? "/api/gateway/sync" : "/api/login/start"));
              }
              // 控制台不在线 → 明确告知，而不是静默失败
              switchHint = needMsg;
              report("action '" + act + "' blocked: console offline");
              renderPanel(lastStatus);
              setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 10000);
              return null;
            })
            .catch(function () {
              busy = false;
              switchHint = needMsg;
              renderPanel(lastStatus);
              setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 10000);
            });
          return;
        }
        if (act === "switch") {
          var uid = el.getAttribute("data-uid");
          if (!uid) return;
          // Switching restarts LobsterAI, so keep the confirm() the web console uses.
          var okSwitch = true;
          try { okSwitch = window.confirm("切换账号会关闭并重启 LobsterAI，确定继续？"); } catch (err) { /* headless */ }
          if (!okSwitch) return;
          // 🔴 必须有可见反馈（2026-10-11 事故修正）：原来只调 report() 写日志文件，
          // 界面上**什么都看不到** —— 用户以为"点了没反应"，实际后台在跑。
          // 切号要杀进程 + 重启 App，**需要十几秒**，这段必须让用户看到进度。
          busy = true;
          switchHint = "正在切换账号…（会重启 LobsterAI，约 10~20 秒）";
          renderPanel(lastStatus);
          report("switch via builtin: uid=" + uid);
          fetch(LOCAL_SWITCH_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uid: uid }),
          })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (d) {
              if (d && d.ok) {
                switchHint = "已切换账号：" + (d.note || "完成");
                report("switch OK (" + (d.source || "builtin") + "): " + (d.note || ""));
                busy = false;
                setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 6000);
                return fetchStatus();
              }
              // 内置失败：区分「主动拒绝」与「不可用需回退」
              if (d && d.refused) {
                // 宿主明确拒绝（如找不到 exe），不要回退去控制台（会更糟）
                switchHint = d.error || "切号被拒绝";
                report("switch REFUSED: " + (d.error || ""));
                busy = false;
                renderPanel(lastStatus);
                setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 12000);
                return null;
              }
              report("builtin switch unavailable (" + ((d && d.error) || "no response") + ") → falling back to console");
              switchHint = "内置切号不可用，正在尝试控制台…";
              renderPanel(lastStatus);
              return postAction(base + "/api/account/switch", { uid: uid });
            })
            .then(function () {
              if (busy) { busy = false; renderPanel(lastStatus); }
            })
            .catch(function (e) {
              report("builtin switch FAILED " + (e && e.message) + " → falling back to console");
              switchHint = "内置切号失败：" + ((e && e.message) || "");
              renderPanel(lastStatus);
              busy = false;
              return postAction(base + "/api/account/switch", { uid: uid });
            });
          return;
        }
      });

      // ---- drawer drag by its title bar ----
      // Dragging the header moves the panel on its own; if the follow toggle is on,
      // the ball is left where it is and the new offset becomes the one carried on
      // the next ball drag (the relationship is only re-anchored on ball drags).
      var head = drawerEl.querySelector(".lad-head");
      var headDragging = false, hdX = 0, hdY = 0, hdOriginX = 0, hdOriginY = 0;
      head.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        // Never hijack a click on a header control.
        var t = e.target;
        if (t && t.closest && t.closest("[data-act]")) return;
        headDragging = true;
        hdX = e.clientX; hdY = e.clientY;
        var rect = drawerEl.getBoundingClientRect();
        hdOriginX = rect.left; hdOriginY = rect.top;
        head.classList.add("dragging");
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });
      head.addEventListener("pointermove", function (e) {
        if (!headDragging) return;
        var size = currentDrawerSize();
        var nx = clamp(hdOriginX + (e.clientX - hdX), EDGE, Math.max(EDGE, window.innerWidth - size.w - EDGE));
        var ny = clamp(hdOriginY + (e.clientY - hdY), EDGE, Math.max(EDGE, window.innerHeight - size.h - EDGE));
        applyDrawerPos(nx, ny);
      });
      function endHeadDrag(e) {
        if (!headDragging) return;
        headDragging = false;
        head.classList.remove("dragging");
        try { head.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        var rect = drawerEl.getBoundingClientRect();
        saveDrawerPos(rect.left, rect.top);
      }
      head.addEventListener("pointerup", endHeadDrag);
      head.addEventListener("pointercancel", endHeadDrag);

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
    // "跟随" toggle state -> button appearance.
    // ---------------------------------------------------------------------------
    function syncFollowButton() {
      if (!shadow) return;
      var btn = shadow.querySelector('[data-role="follow"]');
      if (!btn) return;
      btn.classList.toggle("on", !!followEnabled);
      btn.title = followEnabled
        ? "已开启跟随：拖动悬浮球时面板一起移动（点击关闭）"
        : "已关闭跟随：面板固定不动（点击开启）";
      var mark = btn.querySelector(".lad-follow-mark");
      if (mark) mark.textContent = followEnabled ? "●" : "○";
      var label = btn.querySelector(".lad-follow-label");
      if (label) label.textContent = followEnabled ? "跟随" : "固定";
    }

    // ---------------------------------------------------------------------------
    // "浏览器打开": hand the console URL to the system browser.
    //
    // A bare window.open() is unreliable here — the Electron renderer runs on the
    // dsh-app:// scheme with a restrictive CSP, and a blocked popup fails silently,
    // which is exactly what the field report described ("点击浏览器打开也没反应").
    // Try, in order: a real anchor click (survives more CSP shapes than window.open),
    // window.open, then the host's own redirect route, which always lands the promise
    // in the OS browser because the navigation starts on the HTTP origin.
    // ---------------------------------------------------------------------------
/**
     * 打开 GitHub 仓库（★ Star 直达）。
     *
     * 与 openExternal 同样的问题：渲染进程在 dsh-app:// 下 window.open 常被拦，
     * 所以优先走宿主 /open-url（Node 进程真正拉起系统浏览器）。
     */
    function openRepo() {
      report("openRepo url=" + REPO_URL);
      // ① 首选：宿主打开任意 URL
      try {
        fetch(ROUTE_PREFIX + "/open-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: REPO_URL }),
        })
          .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .then(function (d) {
            if (d && d.ok) {
              switchHint = "已在浏览器打开：" + REPO_URL;
              report("openRepo OK via host");
            } else {
              // ② 宿主不肯 → 用锚点（某些环境下仍有效）
              var a = document.createElement("a");
              a.href = REPO_URL; a.target = "_blank"; a.rel = "noopener noreferrer";
              a.style.display = "none";
              shadow.appendChild(a);
              try { a.click(); } catch (e) { /* ignore */ }
              setTimeout(function () { try { a.remove(); } catch (e) { /* ignore */ } }, 0);
              switchHint = "已尝试打开：" + REPO_URL + "（若浏览器未打开，请手动访问）";
            }
            renderPanel(lastStatus);
            setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 8000);
          })
          .catch(function () {
            switchHint = "无法自动打开，请手动访问：" + REPO_URL;
            renderPanel(lastStatus);
            setTimeout(function () { switchHint = ""; renderPanel(lastStatus); }, 8000);
          });
        return;
      } catch (e) { /* 落回锚点 */ }
      try {
        var a2 = document.createElement("a");
        a2.href = REPO_URL; a2.target = "_blank"; a2.rel = "noopener noreferrer";
        a2.style.display = "none";
        shadow.appendChild(a2);
        a2.click();
        setTimeout(function () { try { a2.remove(); } catch (e) { /* ignore */ } }, 0);
      } catch (e) { report("openRepo fallback FAILED " + (e && e.message)); }
    }

    function openExternal() {
      // 🔴 首选宿主 /open：它由 Node 进程真正拉起系统浏览器，打开的是插件自己的看板页。
      // （渲染进程在 dsh-app:// 下 window.open 常被拦，直接 a.click 也可能无效。）
      try {
        fetch(ROUTE_PREFIX + "/open", { cache: "no-store" })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            report("openExternal via host: ok=" + (d && d.ok) + " url=" + (d && d.url));
          })
          .catch(function (e) { report("openExternal host FAILED " + (e && e.message)); });
        return;
      } catch (e) { /* 落回下面的锚点方式 */ }
      var url = PANEL_EXTERNAL;
      var opened = false;
      try {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        shadow.appendChild(a);
        a.click();
        setTimeout(function () { try { a.remove(); } catch (e) { /* ignore */ } }, 0);
        opened = true;
      } catch (e) { /* try the next route */ }
      if (!opened) {
        try { opened = !!window.open(url, "_blank"); } catch (e) { opened = false; }
      }
      report("openExternal url=" + url + " viaAnchor=" + opened);
      // Last resort: ask the Host to redirect, so the OS browser takes over even when
      // the renderer cannot open windows at all.
      try {
        if (!opened) window.location.href = ROUTE_PREFIX + "/open";
      } catch (e) { /* nothing left to try */ }
    }

    // ---------------------------------------------------------------------------
    // Ball status: colour the dot + show the account count on the badge.
    // Reuses the same /status payload the console renders, so there is one source of
    // truth and no duplicated fan-out to the panel's account APIs.
    // ---------------------------------------------------------------------------
    function probe() {
      // 🔴 2026-10-12 修正：
      //   · 删掉圆点（.lad-dot）—— 原「守护进程在线」指示灯，控制台停用后恒为灰
      //   · 徽标（账号数）原依赖 s.running（控制台在线），控制台停用后**永远不显示**；
      //     现改为用内置路由的 accountsCount（不依赖任何外部进程）
      try {
        fetch(LOCAL_STATUS_PATH.replace('/local/status', '/local/status?quota=0'), { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (local) {
            var badge = shadow && shadow.querySelector('[data-role="badge"]');
            if (!badge) return;
            var cnt = local && local.ok && typeof local.accountsCount === "number" ? local.accountsCount : null;
            if (cnt !== null) {
              badge.textContent = String(cnt);
              badge.className = "lad-badge show";
            } else {
              badge.className = "lad-badge";
            }
          })
          .catch(function () {
            var badge = shadow && shadow.querySelector('[data-role="badge"]');
            if (badge) badge.className = "lad-badge";
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
        // Keep the open drawer inside the viewport too, and re-anchor the offset so
        // following still works after the viewport changed size.
        if (drawerEl && open) {
          var p = clampDrawerPos.apply(null, (function () {
            var d = drawerRect();
            return d ? [d.left, d.top] : [nx, ny];
          })());
          applyDrawerPos(p.x, p.y);
        }
      });

      // Keep the ball dot fresh regardless of whether the drawer is open.
      followEnabled = readFollow();
      syncFollowButton();
      // Resolve the Host's origin first so absolute URLs are available, then paint. The
      // native renderer works with the relative STATUS_PATH alone, so a resolution
      // failure degrades gracefully instead of blanking the drawer.
      resolveHostFromServer().then(function () {
        probe();
        if (readOpen()) setOpen(true);
      });
      probe();
      setInterval(probe, 30000);   // 8s 偏频（每 8 秒探一次本机面板），降到 30s 减压力

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

    // One-shot environment dump + a live fetch probe. The drawer rendering nothing is
    // caused by the frame being pointed at the WRONG ORIGIN, and only the live page can
    // say which origin works — so publish exactly what the runtime sees, including
    // whether a root-relative fetch actually reaches the Host at all.
    function reportEnv() {
      var boot = null;
      try { boot = window.__DSH_BOOT__; } catch (e) { boot = null; }
      var keys = [];
      try { keys = boot && typeof boot === "object" ? Object.keys(boot) : []; } catch (e) { /* ignore */ }
      report("ENV href=" + (window.location && window.location.href) +
        " origin=" + (window.location && window.location.origin) +
        " hostOrigin=" + HOST_ORIGIN +
        " bootKeys=[" + keys.join(",") + "]" +
        " consoleSrc=" + CONSOLE_SRC +
        " statusSrc=" + STATUS_SRC);

      // Relative fetch is the ONLY form that works here, so probe exactly that. An
      // absolute loopback probe was removed: the CSP rejects it (proving nothing useful)
      // and its presence made it ambiguous which URL form the plugin actually relied on.
      try {
        fetch(STATUS_PATH, { cache: "no-store" })
          .then(function (r) {
            report("PROBE relative-fetch status=" + r.status);
            return r.text();
          })
          .then(function (t) { report("PROBE relative-fetch bodyLen=" + t.length); })
          .catch(function (e) { report("PROBE relative-fetch FAILED " + (e && e.message)); });
      } catch (e) { report("PROBE relative-fetch THREW " + (e && e.message)); }
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
            hostEl = null; shadow = null; ballEl = null; drawerEl = null;
            panelEl = null; statusEl = null; currentEl = null; accountsEl = null; actionsEl = null; infoEl = null;
            lastStatus = null; currentAccount = null;
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
      reportEnv();
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
