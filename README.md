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
| 首次打开加载后即常驻，避免每次展开都重拉整页 | Loads once and stays mounted, instead of re-fetching the whole page on every expand |
| 顶部 ✕ 收起、⟳ 重新加载、**浏览器打开** | Header buttons: ✕ collapse, ⟳ reload, **open in browser** |

### 状态与兜底 · Status & fallback

| 中文 | English |
|---|---|
| 球右下角圆点：绿=面板在线，灰=未启动 | Dot on the ball: green = panel online, grey = not running |
| 球左上角徽标显示账号库数量 | Badge on the ball shows the account count |
| 面板没起来时抽屉给出提示 + 一键重连 + 浏览器打开 | When the panel is down the drawer shows a hint, one-click reconnect, and open-in-browser |
| 宿主界面重建 DOM 时自动重新挂载，球不会消失 | Auto re-mounts if the DSH shell rebuilds the DOM, so the ball never disappears |

### 稳定性：为什么它不再动不动报"没有响应" · Why it stops crying wolf

最常见的抱怨是「面板当前没有响应，得点重新连接／刷新才行」。**实测证明多数情况面板本身是健康的，是检测侧误报**，故做了四层处理：

The most common complaint was *"the panel is not responding, I have to hit reconnect"*. Testing showed the panel was usually healthy and **the detection was wrong**, so four guards were added:

| 机制 Mechanism | 说明 Detail |
|---|---|
| **探活超时 12s** | 面板 `/api/status` 冷调用实测 7.4s（缓存命中仅 3ms）。原先 3s 超时会在缓存过期或面板刚重启时把健康面板误判为离线 |
| **Probe timeout 12s** | The panel's cold `/api/status` measured 7.4s (3ms from cache). A 3s timeout reported a healthy panel as offline whenever the cache expired or the panel had just restarted |
| **打开不强制重载** | 点开抽屉只在首次加载 iframe，避免每次展开都重拉整页而"看起来没响应" |
| **No forced reload on open** | The drawer loads the iframe once; re-fetching the whole page on every expand made it *look* unresponsive |
| **iframe 加载看门狗** | iframe 的 `error` 事件几乎不触发，故每次赋 `src` 都启用 15s 看门狗：超时静默重试一次，仍失败才降级到提示面板 |
| **iframe load watchdog** | An iframe's `error` event practically never fires, so every `src` assignment arms a 15s watchdog: one silent retry, then fall back |
| **探活防抖** | 连续 2 次失败（约 16s）才显示错误面板，单次网络抖动不会翻脸 |
| **Probe debounce** | Two consecutive failures (~16s) are required before the error panel shows, so a single blip does not trigger it |

面板进程自身的存活由机器侧看护脚本负责（定时巡检、掉线静默拉起），与插件相互独立 —— 插件只负责**如实反映状态**，不负责"让面板活着"。

Keeping the panel process alive is the job of a machine-side watchdog (periodic checks, silent restart), independent of this plugin — the plugin only **reports status truthfully** rather than keeping the panel running.

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

悬浮球只是入口，真正的能力由 LobsterDaddy 提供。需要先让面板在 `127.0.0.1:17819` 跑起来：

```bash
node lobster-daddy.js panel
```

建议把它交给机器侧看护脚本常驻（掉线自动拉起），这样悬浮球就无需人工干预。面板默认仅绑定 `127.0.0.1`，只有本机可访问。

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
