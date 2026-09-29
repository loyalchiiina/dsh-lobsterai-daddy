# Changelog

## 0.4.2 - 官方 DSH 兼容声明与引擎版本口径修正

依照 DeepSeek Harness **官方规范**（`packages/boot/app-boot/README.md`）修正兼容性声明。

- **新增官方 DSH 兼容声明**：内核检查的是 `peerDependencies` 中的
  `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 范围，**不读取 `engines.dsh`**。
  现已在 `peerDependencies` 与 `devDependencies` 同范围声明：
  `@deepseek-ai/cordis` `^4.0.2`、`@deepseek-ai/dsh` `>=0.1.7-rc.1`。
- **引擎口径修正为内核版本**：此前 `engines` 只写 `node`，未声明 DSH 内核要求；
  现补 `engines.dsh = >=0.1.7-rc.1`（内核版本口径，非客户端/外壳版本）。
- 说明：`^0.1.7` **不匹配**预发布内核 `0.1.7-rc.2`，故范围使用显式预发布下限。

无功能变更。


All notable changes to `dsh-lobsterai-daddy` are documented here.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.1] — 2026-09-29

Same content as 0.4.0. The 0.4.0 upload was accepted into npm's staging area but
never became fetchable (a re-publish answered
`409 Conflict - Cannot publish over previously staged version`), so this release
carries the identical tree under a fresh version number.

## [0.4.0] — 2026-09-28

UI pass driven by direct user review: layout order, check-in state, and the
currently signed-in account.

### Added

- **The currently signed-in account is shown in the drawer** and updates on its
  own. Read live from LobsterAI's own store (`%APPDATA%\LobsterAI\lobsterai.sqlite`,
  `kv` table: `auth_tokens` / `auth_user`) by the Host via a new
  `GET /dsh-lobsterai-daddy/current` route, because the renderer cannot open
  SQLite. Switching accounts through the console rewrites that store, so the
  next refresh reflects it — no "capture account" step required. The probe is
  best-effort: it reports `available:false` instead of throwing, and it is
  fetched separately so a failure can never blank the account list.
- **Per-account check-in state and time**: `已签到` / `今日已签到` /
  `今日未签到`, each with the last check-in timestamp (`MM-DD HH:MM`).

### Changed

- **Drawer layout reordered** to: status line → action buttons → current
  account → account list → run info. The account list used to lead, which
  pushed the common actions below the fold.
- `node:sqlite` is resolved through `createRequire(import.meta.url)` and
  degrades gracefully on Node builds without it.

## [0.3.0] — 2026-09-28

**The console is now rendered as native DOM. The iframe is gone entirely.**

### Why

Every iframe form failed, and the failure is structural rather than a bug in
this plugin — the DSH desktop shell blocks it in three independent ways:

1. `dsh-app://app` grants the `x-dsh-desktop-renderer` bypass **only to the
   top-level frame** (`request.frame === owner.mainFrame` in the installed
   `lib/web-document.js`). A sub-frame never receives it, so `forwardWebRequest`
   answers **403** — and the frame still fires `load`, which is why the drawer
   showed an empty panel with no error.
2. An absolute `http://127.0.0.1:<port>` URL is refused by the renderer's CSP
   (measured: `relative-fetch status=200` versus `loopback-fetch FAILED`).
3. `main.js` disables `webview` outright
   (`contents.on("will-attach-webview", e => e.preventDefault())`).

Because the console refreshes itself every 15s, the drawer went black on a
predictable cycle rather than intermittently.

### Added

- Native console rendering: status line, account cards with balance/plan/usage,
  eight action buttons, run info, and a `浏览器打开` fallback that launches the
  real system browser from the Host process.
- Drawer polling runs only while the drawer is open.

### Fixed

- **All `fetch` URLs stay root-relative.** An intermediate build upgraded them
  to the Host's absolute origin after probing it, which the CSP rejected and
  which left the drawer completely empty. A regression assertion in the client
  probe now forbids absolute URLs.
- `/panel/api/*` and the Host's own `/status` are distinct endpoints with
  different payloads; conflating them rendered "no accounts".

### Removed

- The iframe element, its load watchdog, the `frameHasConsole` content check
  and the fallback overlay (~80 lines).

## [0.2.0] — 2026-09-28

### Added

- **The panel follows the floating ball.** Dragging the ball carries an open
  drawer by the same offset; the header can also drag the panel on its own; a
  `跟随 / 固定` toggle persists the choice, and the drawer's position is
  persisted separately from the ball's.
- `GET /dsh-lobsterai-daddy/open` — launches the console in the system browser
  from the Host process, since `window.open` is silently blocked in the
  `dsh-app://` renderer. Loopback-only, like every other route.

### Fixed

- **Reverse-proxy correctness**, the real cause of "can't refresh / displays
  wrong": `content-encoding` and `content-length` could disagree after the HTML
  shim was injected (compressed bytes re-labelled as identity → garbage); only
  `content-type`/`accept` were forwarded; any path outside `/panel/*` returned
  the plugin's own 404 JSON, so the console's absolute `fetch('/api/...')` calls
  came back as `not found` and surfaced as
  `刷新失败：Unexpected token 'o', "not found" is not valid JSON`. Requests now
  ask for `identity` encoding, forward the needed headers, and pass unknown
  paths through to the panel.
- The ball→drawer offset is sampled once at `pointerdown`; recomputing it per
  `pointermove` pinned the panel in place instead of moving it.

## [0.1.1] — 2026-09-25

Responsiveness fix: stop the drawer from falsely reporting the panel as
unreachable. Verified against a live panel whose cold `/api/status` call took
7.4s (3ms once cached) — the previous 3s probe timeout reported a perfectly
healthy panel as offline whenever that cache expired or the panel had just
restarted. This was the real cause of the recurring
"面板当前没有响应，点重新连接才行" report.

### Fixed

- **Probe timeout raised from 3s to 12s.** The panel fans out to every account
  on a cold call, so the old budget could not cover it.
- **Opening the drawer no longer forces an iframe reload.** Re-assigning `src`
  with a fresh timestamp on every open re-fetched the entire page and made the
  drawer look unresponsive; the console refreshes its own data internally.
- **iframe load watchdog added.** An iframe's `error` event practically never
  fires, so a slow or failed first paint previously left the fallback panel
  stuck on screen with no way back. Every `src` assignment now arms a 15s
  watchdog that silently retries once before falling back.
- **Probe debounce added.** A single transient failure no longer raises the
  error panel; two consecutive failures (~16s apart) are required.
- **Panel response timeout raised from 8s to 20s** in the reverse proxy, so a
  slow console render is not truncated mid-flight.

### Changed

- **Header button "⧉" replaced by an explicit "浏览器打开" text button** — the
  icon was too cryptic to find.
- **The fallback panel now offers "浏览器打开" as well**, alongside reconnect.
- **Removed the stale "run `node lobster-daddy.js panel` yourself" instruction**
  from the fallback: panel recovery is handled by a machine-side watchdog now,
  so telling users to run commands by hand was misleading.

## [0.1.0] — 2026-09-23

Initial release. LobsterAIDaddy turns the LobsterDaddy multi-account console
into a floating ball inside the DSH UI.

### Added

- **Floating ball (client half)** — always-on ball drawn into a Shadow DOM,
  draggable anywhere on screen, position persisted in `localStorage` and
  re-clamped into the viewport on window resize so it can never be dragged
  off-screen.
- **Slide-in drawer** — clicking the ball opens a drawer that embeds the full
  LobsterDaddy web console (`http://127.0.0.1:17819`) in an iframe, so the panel
  is structurally identical to the browser version rather than a re-drawn UI.
- **Same-origin reverse proxy (host half)** — `/dsh-lobsterai-daddy/panel/*`
  proxies to the local panel, removing cross-origin / cookie / CSP friction
  inside Electron. An injected shim prefixes the console's absolute `/api/*`
  `fetch` and `XMLHttpRequest` calls with the proxy mount so they resolve
  correctly when served under the DSH origin.
- **Resizable drawer** — drag the bottom-left grip to resize; the size is
  persisted and clamped to the viewport.
- **Live status dot** — green when the panel answers, grey when it is not
  running.
- **Account badge** — shows the account-count reported by the panel.
- **Graceful fallback** — when the panel is down the drawer shows a hint, the
  command needed to start it, and a one-click reconnect button.
- **Auto re-mount watchdog** — if the DSH shell rebuilds the DOM and drops the
  host element, the ball is re-mounted automatically.

### Security

- All routes are **loopback-only**: non-local requests receive `403`. This
  includes `/status`, which reports the local account count.
- The plugin reads only the account **count** for its badge; it never reads,
  stores, or transmits account credentials.
- No telemetry, no outbound network requests beyond `127.0.0.1`.

### Fixed

- Guarded the reverse proxy so the normal, timeout and error paths cannot both
  answer the same request — a second `writeHead` raised
  `ERR_HTTP_HEADERS_SENT` and could take down the whole DSH host process.
- The HTML shim is injected immediately before `</head>` so it can never land
  ahead of `<meta charset="utf-8">` (which would make the page decode as
  latin-1 and turn every Chinese label into mojibake).
