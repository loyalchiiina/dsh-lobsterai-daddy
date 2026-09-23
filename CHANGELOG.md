# Changelog

All notable changes to `dsh-lobsterai-daddy` are documented here.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
