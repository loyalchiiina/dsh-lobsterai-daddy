# Changelog

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

## 0.7.4 — 2026-10-11

- 新增 `docs/drawer-overview.png`：悬浮球抽屉完整界面作为主宣传图，README 效果图区置顶
- README：修正已过时的功能表（「复位登录流程 / 守护进程开关」已随控制台退场删除），
  补充「Star 直达」「完全自包含」条目
- `npm pack` 核对：3 张效果图全部进包（`files` 白名单含 `docs/*.png`）
## 0.7.5 — 2026-10-11

- 删除两张过时截图（`docs/多账号登录控制台.png`、`docs/龙虾签到账号.png`，09-29 旧界面，
  之后界面历经 5 个版本变更）；README 效果图区只保留当前界面的 `docs/drawer-overview.png`
- 旧图已入回收站（可恢复），未永久删除
## 0.9.5 — 2026-10-12

用户要求两件事：① 把「网关端口」改成「转接到 DSH 的信息及状态」，并把签到**频次**显示在界面；
② 质疑「抓取当前登录账号」按钮是否冗余。

### ① 签到功能核查结论：**一直正常**（附证据）

| 检查项 | 实测结果 |
|---|---|
| 调度器 | `enabled: true`，每 **60 分钟** |
| 启动首次签到 | DSH 22:03:24 启动 → **22:03:35**（8 秒后）触发 ✅ |
| 签到结果 | **6/6 账号全部成功** |
| 缓存落盘 | `%APPDATA%\LobsterDaddy\checkin-cache.json`，6 个账号今日 `ok:true` |
| 频率表现 | 当前 22:05，距上次仅 1 分钟 → 第二次未到，`reason` 仍是 `startup`（**预期行为**） |

### ②「网关端口」→「转接 DSH」（死字段 → 真实状态）

**原字段是控制台时代的死遗留**：内置模式下客户端写死 `gateway: null`
（`adaptLocalStatus()`），所以界面**恒显示"未读取"** —— 没有任何状态含义，
只会让人误以为出错（用户正是被它引来回问的）。

改为显示 **DSH 转接链路**的真实信息：

```
LobsterAI 积分 → 本机网关(127.0.0.1:50189) → DSH llm-pi-ai provider(lobsterai.baseURL)
```

宿主新增 `probeRelay()`（best-effort，永不抛错）：
- `readRelayPortFromProfile()` —— 从 DSH 的 `cordis.patch.yml` 正则解析 `lobsterai.baseURL` 端口
  （只做文本解析，不引入 yaml 依赖，结构变化也不易挂）
- `probePortAlive()` —— TCP 连上即算通（1.2s 超时）
- 返回 `{ available, port, alive, endpoint, note }`

界面三态：
| 状态 | 显示 | 颜色 |
|---|---|---|
| 已接入 | `已接入 · 127.0.0.1:50189 在线` | 绿 |
| 配置有但服务没起 | `127.0.0.1:50189 未监听（ECONNREFUSED）` | 橙 |
| DSH 未配置转接 | `DSH 未配置 lobsterai 转接` | 灰 |

> 实测（本机当前状态）：`{available:true, port:50189, alive:false, note:"ECONNREFUSED"}`
> —— 因为当前用的是 workbuddy provider，LobsterAI 网关没起。这是**真实状态**，不是故障。

### ③ 删除冗余按钮「抓取当前登录账号」

用户质疑正确 —— **它确实是冗余的**：

| | `/current`（自动） | `/local/capture`（按钮） |
|---|---|---|
| 宿主实现 | `readCurrentAccountId()` | `currentLocalAccount()` |
| 触发 | **每次刷新自动**（15 秒） | 需手动点 |
| 结果 | 当前账号 uid/name | 当前账号 uid/phone/nickname |

两者都直读 LobsterAI 存储取当前账号，**同一个东西读两遍**。而"当前账号"
早已自动显示在抽屉里，切号后下次轮询即刷新 —— 用户根本不需要手动"抓取"。
留着只会让人以为不点它就不更新。

- 按钮 5 个 → **4 个**（立即全部签到 / 免退出登录新账号 / 刷新额度 / 同步网关到 DSH）
- 顺带修正两处**指向已删按钮的提示语**（空账号提示、登录失败提示），避免误导
- 保留 `act === "capture"` 的分发（向后兼容：旧 UI 缓存仍可能发送该动作）

### ④ 签到频次显示更完整

底部「运行信息」区的定时签到行（**位置不变**，用户要求保持最后）：

```
运行中 · 每 60 分钟 · 上次 22:03 6/6 全部成功 · 下次约 23:03
```

新增「**下次约 HH:MM**」（由"上次时间 + 间隔"推算），让用户直接看出"还会不会再跑、什么时候跑"。

### 探针

新增 10 项断言：转接字段必须来自宿主 `relay`（不得写死）、
必须处理 `available/alive` 两种分支、反向断言按钮 `data-act='capture'` 不得存在、
提示语不得再指向已删按钮、其余 4 个按钮不得被误删。

## 0.9.4 — 2026-10-12

用户第四轮反馈：**「跟随 / 浏览器打开 / ★ Star 怎么都拐行了」**。

### 🔴 根因：flex 子项默认可被压缩 + 标题栏宽度根本不够

两个问题叠加：

**① CSS 缺「禁压缩 + 不换行」**（直接原因）

`.lad-btn` / `.lad-btn-wide` / `.lad-follow` 都是 `.lad-head`（`display:flex`）的子项，
而 **flex 子项默认 `flex-shrink:1`**。标题栏空间不足时，浏览器按比例压缩每个子项：

| 按钮 | 被压缩后的表现 |
|---|---|
| 「跟随」(2 字) | 压到只容 1 字宽 → **竖排** |
| 「浏览器打开」(5 字) | **断成两行** |
| 「★ Star」 | 星号与文字**断行** |

**② 布局宽度本来就装不下**（根本原因）

实测整条标题栏的自然宽度需求：

```
logo 20 + 标题块 119 + 跟随 55 + ⟳ 26 + 浏览器打开 82 + ★Star 61 + ✕ 26
+ 6 个 gap×9 = 54 + 左右内边距 24
= 467px
```

而抽屉**最小宽度 380px、常见默认 420px** → **必然装不下**。
所以只加 `flex:0 0 auto`（禁压缩）虽然止住了拐行，但实测会把最后的 ✕ **挤出抽屉**。

### 修复（三件套，缺一不可）

1. **`flex:0 0 auto`** —— 禁止按钮被压缩
2. **`white-space:nowrap`** —— 即使被压也不换行
3. **`.lad-head` 加 `flex-wrap:wrap`** —— 空间不足时按钮组**整体折到第二行**，
   而不是压缩文字、也不是溢出裁掉

配套结构调整：
- 新增 `.lad-headbtns` 按钮组容器（`flex-wrap:wrap`），把 5 个按钮作为**一个整体**
  靠右/折行 —— 否则 `.lad-spacer` 会把折行位置弄乱
- `.lad-titlewrap` 加 `min-width:96px` 下限 —— 否则标题会被压成一条竖线（实测踩到）
- `.lad-title` / `.lad-sub` 改 `flex:0 1 auto; min-width:0` + `text-overflow:ellipsis`
  —— 让标题成为「可牺牲方」，空间不足时先省略标题而不是挤压按钮

### 实测验证（多宽度）

| 抽屉宽度 | 结果 | 标题栏高 |
|---|---|---|
| 380px（最小） | ✅ 全部正常（按钮组折行） | 94px |
| 420px（默认） | ✅ 全部正常（折行） | 94px |
| 460px | ✅ 全部正常（折行） | 94px |
| 560px | ✅ 全部正常（**单行**） | 62px |
| 760px | ✅ 全部正常（单行） | 62px |

五个按钮宽度在各宽度下恒定：`跟随 55×26`、`⟳ 26×26`、`浏览器打开 82×26`、
`★ Star 61×26`、`✕ 26×26` —— **高度恒为 26px 即「单行」**，无一换行、无一溢出。

### 探针

新增 9 项标题栏布局断言（含反向断言：按钮不得被改成 `flex:1 1 auto` / `flex-shrink:1`）。

## 0.9.3 — 2026-10-12

用户第三轮反馈：**「logo 大小合适了，但悬浮球的造型不一致，要和 hub 统一」**。

### 🔴 根因：hub 源码写的是圆形，**实物却是圆角方形**（源码 ≠ 实物）

上一版（0.9.2）我把 hub 的 `buildBall()` 逐行抄了一遍，其中
`borderRadius: "50%"` 抄成 `border-radius:50%`。**用户看实物后仍指出不一致** ——
说明"照源码抄"这个做法本身错了。

改用**像素级测量实物**定案（两张图互证）：

| 证据 | 测量结果 |
|---|---|
| 用户桌面截图里的 hub 球 | 70×70 亮块。顶部行宽仅 **0.671×** 满宽（正圆应为 0）；行宽达满宽要到第 **22** 行（正圆应为第 35 行 = 半宽）→ **圆角方形，半径 ≈22px ≈ 球径 31%** |
| hub 官方宣传图 `docs/images/cooldown.png` 右上角的球 | 满宽行占比 **90.8%**，中段大面积满宽 → 同为**圆角方形** |
| hub 源码 `lib/client.js:210` | `borderRadius: "50%"` → **与实物不符** |

**结论：hub 的球实际渲染为圆角方形（squircle），不是正圆。** 上一版照源码抄成正圆，
所以用户看"还是不一样"。这也印证了 SKILL §7.29.1 的教训——**先渲染看一眼，别信源文件写什么**。

### 修复

- `.lad-ball` 的 `border-radius` 由 `50%` 改为 **`31%`**（54px × 0.31 ≈ 17px），
  与实测的 hub 实物一致。
- 徽标、激活态描边同步跟随新形状。

### 本轮方法论（写进 SKILL §7.29.8）

> **"和某插件保持一致"时，必须测量它的实物渲染，不能抄它的源码。**
> 源码里的 `border-radius:50%` 可能被宿主全局样式、插件自身运行时改造、
> 或浏览器对 `box-sizing`/`zoom` 的处理改掉。**唯一可靠的基准是像素测量**：
> 逐行量亮区宽度 → 看"满宽占比"：
> - 满宽只出现在 1~2 行（顶点尖）→ **正圆**
> - 满宽占中段一大片（>50%）→ **圆角矩形**，半径 ≈ 从顶到满宽的行距

## 0.9.2 — 2026-10-12

用户第二轮回馈三点，全部处理：

### ① 图标「略微大了些、超过外框」→ 图形缩到视框 78%
**真因不是尺寸**（容器一直是 28px，与 hub 相同），而是**图形在 viewBox 里的占比**：

| | 图形宽度占视框 |
|---|---|
| 本插件（旧） | **96.0%**（实测） |
| workbuddy-hub | 95.3%（但它的 viewBox 是 36×36、图形高度只占 90%，整体观感更小） |

我方图形几乎顶满 24 视框的左右边界（x 0.44→23.50），28px 下自然贴到球边。
现在把 path 的所有坐标按 `k=0.8118` 缩放并重新居中，**图形宽度占视框 78%**，
四周留出均匀空白，不再顶边。

### ② 外框对齐 workbuddy-hub（逐项比对源码后补齐 3 处差异）
对照 hub 的 `buildBall()` 逐项核对，发现并修复：

| 项 | hub | 本插件（旧） | 处置 |
|---|---|---|---|
| 尺寸 | 54px | 54px | 一致，不动 |
| 圆角 | `border-radius:50%` | `border-radius:50%` | 一致，不动 |
| **边框** | `1px solid <border-l3>` | **无边框** | ✅ 补上 |
| **阴影** | 中性 `0 3px 14px rgba(0,0,0,.34)` | **橙红辉光 + inset 白色内高光** | ✅ 换成中性 |
| 图标容器 | 28px | 28px | 一致，不动 |

橙红辉光 + inset 内高光是"看起来像外发光/发虚"的来源，改成中性阴影后
两个插件观感统一。

> 🔴 附带修掉一个**静默 CSS 错误**：旧代码 `.lad-ball.active` 后面多写了一行
> `box-shadow:0 6px 20px rgba(58,165,234,.5)...`，导致该规则出现两个 box-shadow
> 声明（后者覆盖前者）。现已合并为单条。

### ③ 自动签到「界面看不到」→ 排查结论 + 界面补上状态
**排查结论：签到功能一直在正常运行，只是界面上没有任何地方显示它。**

- 证据：`GET /dsh-lobsterai-daddy/health` 返回
  `checkinScheduler.enabled=true, lastRun={reason:"startup", okCount:6, total:6}`
  —— 6 个账号全部签到成功。
- **根因**：抽屉底部「信息」区原来显示的是 **「自动签到同意」**——那是控制台时代的旧
  概念，v0.7.2 随控制台退场时已删除（`lib/index.js` 里 `consent` 恒为 `undefined`），
  于是**界面永远显示"未开启"**；而真正在跑的定时签到状态只存在于 `/health`，
  客户端从来不读它。用户自然"看不到"。

**修复**：
- 界面那一行改为 **「定时自动签到」**，实时显示：`运行中 · 每 60 分钟 · 上次 HH:MM 6/6 全部成功`
- 三档配色：全部成功=绿 / 部分失败=橙 / 未运行=红 / 不可用=灰
- 新增 `HEALTH_PATH` 常量 + `fetchHealth()`，接入主刷新链路（`Promise.all` 并列，
  **与主数据分开请求** → `/health` 失败不会清空账号列表）
- 🔴 失败时显式记 `healthAvailable=false`，界面显示「状态未知（健康检查不可用）」，
  **不留空**（避免"检测失败被当成没有数据"的静默 bug，SKILL §7.20）

### 探针
- 客户端探针新增 9 项签到状态断言（含反向断言：界面不得再渲染「自动签到同意」标签）
- 全部断言通过


## 0.9.1 — 2026-10-12

### 图标：改用官方 LobsterAI 图标（黑白版）
用户反馈「图标太丑了看不出来是什么东西，把官方的图标改成黑白的就行」。

- **旧图标**：手写的简化龙虾轮廓（内联 SVG），触须细、钳形含糊 → 28px 下糊成一团，
  看不出是什么东西。
- **新图标**：直接取自**官方 LobsterAI 应用图标**的红底白虾造型，做成单色剪影。
  - 来源：`<LobsterAI 安装目录>\resources\app-icon\512x512.png`（官方 512×512 应用图标）。
  - ⚠️ 踩坑记录：官方的 `control-ui\favicon.svg` **画出来是个圆团、不是龙虾造型**
    （只有身体+钳的粗轮廓，没有触须与钳口），一度被我误当作矢量源使用；
    官方可用的龙虾造型只有 `app-icon/512x512.png` 这一份位图。
  - 处理链：灰度 → 连通域分析**剔除圆角外框光晕**（bbox 覆盖率 >50% 且填充率 <15%
    的细线域）→ 保留龙虾 6 个部件域 → 格点边界追踪描轮廓（实心区恒在行进方向右侧，
    外轮廓顺时针、孔洞逆时针）→ Douglas-Peucker 简化（eps=1.0）→ Catmull-Rom 转三次
    贝塞尔 → 归一化到 24×24 viewBox。
  - 输出：单条 `<path>`（6185 字符）用 `fill="currentColor"` 填充 → **天然黑白**，
    且自动跟随宿主主题令牌（深色球=浅色虾、浅色球=深色虾、抽屉 logo=品牌色）。
  - `fill-rule="evenodd"` 保证钳口等内孔正确镂空（否则会填成实心）。
  - 悬浮球图标与抽屉 logo 复用同一个 `ICON_SVG`，视觉完全一致。
- **验证**（不是只看 `node --check`）：
  - DOM-stub 运行时探针（加载 bundle → 调 `apply()` → 检查真实挂载）：
    6 子路径、1134 坐标全部落在 0..24 viewBox 内、bbox 23.06×19.70、
    无渐变/非单色颜色、`#dsh-lobsterai-daddy-root` 与 shadowRoot 均创建成功、
    球内 SVG 已注入。
  - 无头浏览器渲染真实尺寸检视：**28px 下清晰可辨**（钳、身、触须、钳口俱全），
    16px 仍可辨识，20px 品牌色 logo 正常。
## 0.9.0 — 2026-10-12

### 新增：定时自动签到
用户指出「新发的插件没有自动定时签到的功能」—— 确认属实（原实现只有手动「立即全部签到」）。
现照 `dsh-workbuddy-hub` 的成熟做法补齐：
- 启动后 **8 秒**首次签到，之后每 **60 分钟**一次
- 定时器 `unref()`（不阻止进程退出），停止函数注册到 `ctx.effect`（卸载时清理）
- 幂等由 `checkin-cache` 保证（今日已 ok 的账号跳过）
- 日志用 `[next-ui-diagnostic]` 白名单前缀（DSH 日志能捕获）
- 新增 `GET /health` 暴露调度器状态（enabled / 间隔 / 上次运行结果）

### 界面：对齐 dsh-workbuddy-hub 的视觉风格
- **悬浮球尺寸 52 → 54px**（与 hub 一致）
- **球体背景**：橙红渐变 → **宿主主题令牌** `--dsw-alias-bg-layer-1`（深浅色主题自然适配）
- **激活态**：蓝渐变 → 品牌色描边
- **图标**：emoji（🦞）→ **内联 SVG（currentColor）**
  - 理由：emoji 在不同系统/字体下渲染差异大；SVG 可跟随主题色
- **抽屉 logo**：橙红渐变方块 + emoji → 品牌色 SVG（同 hub 的 hIcon）
- **移除悬浮球右下角的圆点**：原「守护进程在线」指示灯，控制台停用后恒为灰色（一个"圆形的窟窿"）
- **修复隐藏 bug**：账号数徽标原依赖 `s.running`（控制台在线）→ 控制台停用后**永远不显示**；改用内置路由的 `accountsCount`

### 探针
- 新增 `scripts/lad-host-probe.cjs`（宿主侧探针，40 项）：验证路由注册、定时签到调度、
  切号安全防线、隐私脱敏、协议白名单
- 客户端探针更新为 88 项（圆点改为反向断言）
