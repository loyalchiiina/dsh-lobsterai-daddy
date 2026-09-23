# dsh-lobsterai-daddy · LobsterAIDaddy

把 LobsterDaddy 多账号控制台变成 **DSH 界面上的悬浮球**：可自由拖拽摆放、位置自动记忆；点开即以抽屉形式内嵌完整网页控制台，**界面与网页版完全一致**。

A draggable floating ball for the LobsterDaddy multi-account console, embedded in the DSH UI. Drag it anywhere, click to slide out the full web console in an identical drawer.

---

## 功能总览 · At a glance（中英对照 / Bilingual）

### 悬浮球 · Floating ball

| 中文 | English |
|---|---|
| 常驻 DSH 界面，可拖到任意位置 | Always-on ball you can drag anywhere |
| 坐标自动持久化，重启后原地出现 | Position persisted in `localStorage`, restored in place after restart |
| 窗口缩小时自动收回可视区，绝不会被拖出屏幕 | Re-clamped into the viewport on resize — it can never be dragged off-screen |
| 开合状态与抽屉尺寸同时被记住 | Open/closed state and drawer size are both remembered |
| 拖动与点击自动区分：拖过就不触发开合 | Drag and click are disambiguated — a drag never toggles the drawer |

### 抽屉式控制台 · Slide-in console

| 中文 | English |
|---|---|
| 点球展开/收起，抽屉从右侧滑入 | Click the ball to expand/collapse; the drawer slides in from the right |
| 内嵌完整网页控制台，和浏览器打开 `127.0.0.1:17819` 一模一样 | Embeds the full web console, byte-identical to opening `127.0.0.1:17819` in a browser |
| 拖动左下角把手自由调整大小，尺寸自动记忆 | Drag the bottom-left grip to resize; the size is persisted |
| 打开时自动刷新，每次都是最新数据 | Refreshes on every open, so the data is always current |
| 顶部 ✕ 收起、⟳ 重新加载、⧉ 在浏览器中打开 | Header buttons: ✕ collapse, ⟳ reload, ⧉ open in browser |

### 状态与兜底 · Status & fallback

| 中文 | English |
|---|---|
| 球右下角圆点：绿=面板在线，灰=未启动 | Dot on the ball: green = panel online, grey = not running |
| 球左上角徽标显示账号库数量 | Badge on the ball shows the account count |
| 面板没起来时抽屉给出提示 + 拉起命令 + 一键重连 | When the panel is down the drawer shows a hint, the start command, and one-click reconnect |
| 宿主界面重建 DOM 时自动重新挂载，球不会消失 | Auto re-mounts if the DSH shell rebuilds the DOM, so the ball never disappears |

### 安全与隐私 · Security & privacy

| 中文 | English |
|---|---|
| 所有路由（含状态查询）**仅接受回环地址**，非本机请求返回 403 | Every route (including the status probe) is **loopback-only**; non-local requests receive `403` |
| 只读取账号**数量**用于徽标，绝不读取/存储/上传凭据 | Reads only the account **count** for the badge — never reads, stores or uploads credentials |
| 零遥测、零外部网络请求（只与 `127.0.0.1` 通信） | No telemetry, no outbound requests beyond `127.0.0.1` |
| 不采集、不上传任何数据 | Collects and uploads nothing |

## 安装

```bash
# 从 npm
dsh plugin --profile desktop add dsh-lobsterai-daddy

# 或从 GitHub
dsh plugin --profile desktop add github:loyalchiiina/dsh-lobsterai-daddy
```

装完**重启 DSH** 生效（客户端 bundle 由宿主启动时加载）。

### 前置：LobsterDaddy 面板

悬浮球只是入口，真正的能力由 LobsterDaddy 提供。面板没起来时先跑：

```bash
node lobster-daddy.js panel
```

（默认监听 `127.0.0.1:17819`，仅本机可访问。）

## 原理

```
DSH 界面
  └─ 悬浮球（client.js，shadow DOM，position:fixed）
       └─ 抽屉 → iframe
            └─ /dsh-lobsterai-daddy/panel/   ← 宿主端同源反向代理
                 └─ http://127.0.0.1:17819  ← LobsterDaddy 网页控制台
```

**为什么走代理而不是直接 iframe `17819`**：同源代理彻底避开 Electron 里的跨域 / Cookie / CSP 摩擦，同时把面板的 HTML 原样透传——所以"界面和网页一致"是结构上保证的，不是靠重画一遍 UI 追平。

代理会向 HTML 注入一小段 shim：面板自身的 JS 调用的是绝对路径（`fetch('/api/status')`），在 DSH 源下会解析到不存在的根路由；shim 把 `/api/*`（`fetch` + `XMLHttpRequest`）加上代理前缀，让每个调用都落回面板。

## 配置

在 profile 的 patch 里可覆盖面板端口：

```yaml
- insert:
    - id: dsh-lobsterai-daddy
      name: dsh-lobsterai-daddy
      config:
        panelPort: 17819
```

## 兼容性

- DSH 桌面端 + 网页端均可用
- 与其它悬浮球插件（`dsh-todo-float-ball` 等）共存，各自独立定位与持久化
- 容器遵循 `position:static + pointer-events:none`，规避 Electron 下 `position:fixed` 子元素偏移问题

## 安全说明

- 面板仅绑定 `127.0.0.1`；代理路由与状态路由同样**只接受回环地址**，非本机请求一律返回 403
- 不采集、不上传任何数据；账号凭据始终由 LobsterDaddy 自己保管在本机用户目录下的 `LobsterDaddy\accounts`，本插件只读取账号**数量**用于显示徽标，从不接触凭据内容
- ⚠️ 多账号刷积分可能违反 LobsterAI 服务条款，**请只用于自己的账号**，风险自负

## License

MIT
