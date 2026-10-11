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
        // 🔴 脱敏后再输出：曾经直接返回完整手机号（user.phone），那是隐私泄漏
        name: displayName(user),
      };
    } finally {
      try { db.close(); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    return { available: false, reason: String(e && e.message || e) };
  }
}

/**
 * 隐私脱敏（🔴 硬要求，与 dsh-workbuddy-hub 同规格）。
 *
 * 手机号与昵称属于个人隐私，**任何离开宿主进程的输出面都不得完整露出**：
 * 悬浮球抽屉、网页版看板、`/status` 等 HTTP 响应。
 *
 * 手机号：保留前 3（运营商段）+ 后 3，中间与第 11 位一并打码。
 * 昵称：超过 2 字只留首尾（例「示例用户甲」→「示…甲」）。
 */
function maskPhone(p) {
  var s = String(p == null ? "" : p);
  if (!s) return "";
  if (s.length >= 11) return s.slice(0, 3) + "****" + s.slice(-4, -1) + "*";
  if (s.length >= 7) return s.slice(0, 3) + "****" + s.slice(-2, -1) + "*";
  return s;
}
/**
 * 昵称脱敏。
 *
 * 🔴 关键（2026-10-11 实测踩到）：LobsterAI 保存的 `nickname` **很多本身就是已脱敏的
 * 手机号形态**（如 `183****3722`）。首版没识别这种情况，又按"首尾各留一字"处理，
 * 于是 `183****3722` → `1…2` —— 六个账号全长一样，用户完全分不清哪个是哪个。
 *
 * 因此顺序必须是：
 *   ① 已脱敏号码形态（含 `*`）→ **原样保留**（它已经安全，且是可辨识信息）
 *   ② 纯 11 位数字（真手机号）→ 按手机号规则脱敏
 *   ③ 其它 7 位以上数字      → 按手机号规则脱敏
 *   ④ 普通昵称               → 首尾各留一字
 */
function maskNick(n) {
  var s = String(n == null ? "" : n).trim();
  if (!s) return "";
  // ① 已脱敏的号码形态：183****3722 / 183****372 / 183***72
  //    仍要收敛到「露后 3 位」的统一规格（与 dsh-workbuddy-hub 一致）：
  //    LobsterAI 自己存的是 `183****3722`（露 4 位），这里把最后一位也打码。
  if (/^1\d{2}\*{2,}\d{2,4}$/.test(s)) {
    var mm = s.match(/^(1\d{2})\*+(\d{2,4})$/);
    if (mm && mm[2].length >= 3) return mm[1] + "****" + mm[2].slice(0, mm[2].length - 1) + "*";
    return s;
  }
  // ② 完整手机号
  if (/^\d{11}$/.test(s)) return maskPhone(s);
  // ③ 其它长数字串
  if (/^\d{7,}$/.test(s)) return maskPhone(s);
  // ④ 普通昵称：首尾各留一字
  var chars = Array.from(s);
  return chars.length <= 2 ? s : chars[0] + "…" + chars[chars.length - 1];
}
/** 账号显示名：昵称优先并按昵称规则脱敏；回退到手机号则按号码规则脱敏 */
function displayName(user) {
  if (!user || typeof user !== "object") return null;
  if (user.nickname) return maskNick(user.nickname);
  if (user.phone) return maskPhone(user.phone);
  if (user.yid) return String(user.yid);
  return null;
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
// 🔴 GitHub 仓库（★ Star 直达）。与 package.json 的 repository 保持一致。
// REPO_READY=true → 看板/抽屉的 Star 按钮可点；false → 只提示"尚未发布"。
var REPO_URL = "https://github.com/loyalchiiina/dsh-lobsterai-daddy";
var REPO_READY = true;
// ---------------------------------------------------------------------------
// 🔴 内置数据层（2026-10-11）：不再依赖常驻的 17819 控制台进程
//
// 背景：用户指出 dsh-workbuddy-hub 不需要常驻进程，而 LobsterDaddy 需要
// 一个 PowerShell 窗口一直挂着提供服务。经查证，那个控制台做的多数事
// 其实是**纯文件 / SQLite 操作**，完全可以在插件宿主里自己做：
//
//   · 账号列表   → 读 %APPDATA%\LobsterDaddy\accounts\*.json
//   · 当前账号   → 读 LobsterAI 的 SQLite kv(auth_user)   ← 本插件已这么做
//   · 签到状态   → 读 %APPDATA%\LobsterDaddy\checkin-cache.json
//   · 切号       → 读 accounts/<uid>.json → 写 SQLite kv(auth_tokens/auth_user)
//                  → 重启 LobsterAI（与 lobster-daddy.js 的 switchAccount 同构）
//
// 仍走控制台的只剩「登录新账号 / 捕获凭据」这类需要进程操作的能力。
// 因此：**控制台从"必需"降级为"可选增强"**，与 WorkDaddy 在 hub 里的地位一致。
// ---------------------------------------------------------------------------
var LOBSTERDADDY_DIR = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "LobsterDaddy");
var LD_ACCOUNTS_DIR = join(LOBSTERDADDY_DIR, "accounts");
var LD_CHECKIN_CACHE = join(LOBSTERDADDY_DIR, "checkin-cache.json");
var LOBSTER_DB_FILE = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "LobsterAI", "lobsterai.sqlite");

/** 读一个账号文件；失败返回 null */
function readAccountFile(uid) {
  try {
    var p = join(LD_ACCOUNTS_DIR, String(uid) + ".json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) { return null; }
}

/**
 * 列出全部已保存账号（🔴 一律脱敏后再输出）。
 * 数据来自 LobsterDaddy 自持的 accounts 目录 —— 与控制台 `listAccounts()` 同源。
 */
function listLocalAccounts() {
  var out = [];
  var currentId = null;
  // 🔴 readCurrentAccountId() 返回的是**对象** {available, uid, name}，
  // 不是 uid 本身。首版直接 String(它) 得到 "[object Object]"，导致
  // isCurrent 永远为 false、当前账号识别不出来（2026-10-11 实测踩到）。
  try {
    var cur = readCurrentAccountId();
    if (cur && cur.uid != null) currentId = String(cur.uid);
  } catch (e) { currentId = null; }
  var cache = {};
  try { cache = JSON.parse(readFileSync(LD_CHECKIN_CACHE, "utf8")) || {}; } catch (e) { cache = {}; }
  var today = (function () {
    var d = new Date();
    var p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  })();
  var files = [];
  try { files = require("node:fs").readdirSync(LD_ACCOUNTS_DIR).filter((f) => f.endsWith(".json")); } catch (e) { files = []; }
  for (var i = 0; i < files.length; i++) {
    var uid = files[i].replace(/\.json$/, "");
    var a = readAccountFile(uid);
    if (!a || !a.accessToken) continue;
    var rec = cache[uid] || null;
    out.push({
      uid: uid,
      // 🔴 隐私：账号文件里 phone/nickname 都是完整值，这里一律脱敏
      phone: maskPhone(a.phone),
      nickname: maskNick(a.nickname) || maskPhone(a.phone),
      // 令牌到期（秒 → 毫秒），前端用来显示「令牌剩余」
      accessExp: a.accessExp ? Number(a.accessExp) * 1000 : null,
      savedAt: a.savedAt ? Number(a.savedAt) : null,
      isCurrent: currentId != null && String(currentId) === String(uid),
      checkin: rec && rec.date === today
        ? { ok: rec.ok === true, already: rec.already === true, kind: String(rec.kind || ""), text: String(rec.text || ""), at: Number(rec.at) || null }
        : null,
    });
  }
  return out;
}

/** 当前在用的账号（从自持账号列表里找 isCurrent） */
function currentLocalAccount() {
  var list = listLocalAccounts();
  for (var i = 0; i < list.length; i++) if (list[i].isCurrent) return list[i];
  return null;
}

// ------------------------------------------------------------- 内置额度查询
/**
 * 🔴 内置积分查询（2026-10-11）：直调 LobsterAI 自己的上游接口，**不需要控制台**。
 *
 * 规则移植自 lobster-daddy.js 的 fetchAccountSnapshot() / snapshotToView()：
 *   基址 https://lobsterai-server.youdao.com
 *   GET /api/user/profile-summary → totalCreditsRemaining（余额）/ creditItems（含有效期）
 *   GET /api/user/quota           → planName / dailyCreditsUsed / freeCreditsExpired
 *   认证 Bearer <accessToken> + origin/referer 指向 lobsterai.youdao.com
 *
 * 带 TTL 缓存（60 秒），避免每次轮询都打上游。
 */
var LOBSTER_API_BASE = "https://lobsterai-server.youdao.com";
var QUOTA_TTL_MS = 60 * 1000;
var quotaCacheLocal = new Map();   // uid -> { at, view }

function lobsterAuthHeaders(accessToken) {
  return {
    authorization: "Bearer " + accessToken,
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://lobsterai.youdao.com",
    referer: "https://lobsterai.youdao.com/",
    "cache-control": "no-store",
  };
}

async function lobsterApiGet(pathname, accessToken, timeoutMs) {
  try {
    var res = await fetch(LOBSTER_API_BASE + pathname, {
      headers: lobsterAuthHeaders(accessToken),
      signal: AbortSignal.timeout(timeoutMs || 12000),
    });
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { httpStatus: res.status, code: body ? body.code : undefined, data: body ? body.data : undefined, message: body ? body.message : "" };
  } catch (e) {
    var timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return { httpStatus: 0, code: undefined, data: undefined, message: timedOut ? "请求超时" : ((e && e.message) || "fetch failed") };
  }
}

/** 取一个账号的额度视图（含缓存）。**永不抛错**。 */
async function fetchQuotaView(uid, force) {
  var cached = quotaCacheLocal.get(String(uid));
  if (!force && cached && Date.now() - cached.at < QUOTA_TTL_MS) return cached.view;
  var account = readAccountFile(uid);
  if (!account || !account.accessToken) {
    var bad = { error: "账号缺少凭据" };
    quotaCacheLocal.set(String(uid), { at: Date.now(), view: bad });
    return bad;
  }
  var p = { httpStatus: 0, code: undefined, data: undefined };
  var q = { httpStatus: 0, code: undefined, data: undefined };
  try {
    var both = await Promise.all([
      lobsterApiGet("/api/user/profile-summary", account.accessToken),
      lobsterApiGet("/api/user/quota", account.accessToken),
    ]);
    p = both[0]; q = both[1];
  } catch (e) { /* 已各自处理 */ }
  var view;
  if ((!p.data) && (!q.data)) {
    view = { error: "http=" + p.httpStatus + "/" + q.httpStatus + " code=" + p.code + "/" + q.code };
  } else {
    var prof = p.data || {};
    var quota = q.data || {};
    var items = Array.isArray(prof.creditItems) ? prof.creditItems.map(function (it) {
      return {
        label: String(it.label || it.labelEn || it.type || "积分"),
        remaining: typeof it.creditsRemaining === "number" ? Math.round(it.creditsRemaining * 100) / 100 : null,
        exp: it.expiresAt ? String(it.expiresAt).slice(0, 10) : null,
      };
    }) : [];
    view = {
      balance: typeof prof.totalCreditsRemaining === "number" ? Math.round(prof.totalCreditsRemaining * 100) / 100 : null,
      plan: quota.planName || null,
      dailyUsed: typeof quota.dailyCreditsUsed === "number" ? Math.round(quota.dailyCreditsUsed * 100) / 100 : null,
      freeExpired: quota.freeCreditsExpired === true,
      items: items,
      updatedAt: Date.now(),
    };
  }
  quotaCacheLocal.set(String(uid), { at: Date.now(), view: view });
  return view;
}

/** 批量取额度（并发）。 */
async function fetchQuotaViews(uids, force) {
  var out = {};
  var results = await Promise.all((uids || []).map(function (uid) {
    return fetchQuotaView(uid, force).then(function (v) { return [String(uid), v]; });
  }));
  for (var i = 0; i < results.length; i++) out[results[i][0]] = results[i][1];
  return out;
}

// --------------------------------------------------------- 内置签到（v0.7.0）
/**
 * 内置签到：直调 LobsterAI 上游活动接口，**不需要 LobsterDaddy 控制台**。
 *
 * 协议完全复刻 lobster-daddy.js（含常量与错误码），实测端点：
 *   ① 查当日签到活动  GET  {base}/api/client-activities/slot
 *        query: placement=desktop_sidebar, clientVersion, containerApiVersion=2, platform=win32
 *   ② 执行签到        POST {base}/api/client-activities/{activityCode}/actions/check_in
 *        body:  { configRevision, idempotencyKey, payload: {} }
 *
 * 结果判定（与 lobster-daddy.js 的 classifyCheckin 一致）：
 *   HTTP 200 + code 0            → 成功
 *   code 51104 (AlreadyClaimed)  → 今日已签到（视为成功）
 *   code 51101/51100             → 无进行中的活动
 *   code 51102 / HTTP 401        → 登录态失效
 */
var CHECKIN_CLIENT_VERSION = "2026.9.17";
var CHECKIN_ERR = {
  NotFound: 51100,
  NotActive: 51101,
  LoginRequired: 51102,
  AlreadyClaimed: 51104,
};

function checkinTodayLocal() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** 查当日签到活动 slot */
async function fetchCheckinSlot(accessToken) {
  var q = "placement=desktop_sidebar"
    + "&clientVersion=" + encodeURIComponent(CHECKIN_CLIENT_VERSION)
    + "&containerApiVersion=2"
    + "&platform=win32";
  return lobsterApiGet("/api/client-activities/slot?" + q, accessToken, 15000);
}

/** 执行签到 */
async function executeCheckin(accessToken, activityCode, configRevision, idempotencyKey) {
  try {
    var res = await fetch(LOBSTER_API_BASE + "/api/client-activities/" + encodeURIComponent(activityCode) + "/actions/check_in", {
      method: "POST",
      headers: lobsterAuthHeaders(accessToken),
      body: JSON.stringify({ configRevision: configRevision, idempotencyKey: idempotencyKey, payload: {} }),
      signal: AbortSignal.timeout(15000),
    });
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { httpStatus: res.status, code: body ? body.code : undefined, message: body ? body.message : "" };
  } catch (e) {
    var to = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return { httpStatus: 0, code: undefined, message: to ? "请求超时" : ((e && e.message) || "fetch failed") };
  }
}

/** 签到结果判定（与 lobster-daddy.js 同规则） */
function classifyCheckin(r) {
  if (r.httpStatus === 200 && r.code === 0) return { ok: true, already: false, kind: "ok", text: "签到成功" };
  if (r.code === CHECKIN_ERR.AlreadyClaimed) return { ok: true, already: true, kind: "already", text: "今日已签到" };
  if (r.code === CHECKIN_ERR.NotActive || r.code === CHECKIN_ERR.NotFound) {
    return { ok: false, already: false, kind: "inactive", text: "当前无可用签到活动（" + r.code + "）" };
  }
  if (r.code === CHECKIN_ERR.LoginRequired || r.httpStatus === 401) {
    return { ok: false, already: false, kind: "auth", text: "登录态失效" };
  }
  return { ok: false, already: false, kind: "fail", text: "失败 http=" + r.httpStatus + " code=" + r.code + " " + (r.message || "") };
}

/** 签到缓存文件（与控制台共用同一份，互不冲突） */
function checkinCachePath() { return LD_CHECKIN_CACHE; }

function readCheckinCache() {
  try { return JSON.parse(readFileSync(checkinCachePath(), "utf8")) || {}; } catch (e) { return {}; }
}

function writeCheckinCache(cache) {
  try {
    var tmp = checkinCachePath() + ".tmp";
    require("node:fs").writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    require("node:fs").renameSync(tmp, checkinCachePath());
  } catch (e) { /* 缓存写失败不影响签到结果 */ }
}

/**
 * 全部账号签到（内置版）。永不抛错。
 * @param {boolean} force 为 true 时忽略"今日已处理"的缓存
 */
async function runCheckinAll(force) {
  var accounts = listLocalAccounts();
  var cache = readCheckinCache();
  var today = checkinTodayLocal();
  var results = [];
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    var prev = cache[a.uid];
    // 幂等：今日已成功过的直接跳过（除非 force）
    if (!force && prev && prev.date === today && prev.ok) {
      results.push({ uid: a.uid, name: a.nickname || a.phone, ok: true, already: !!prev.already, kind: prev.kind || "cached", text: prev.text || "今日已处理", skipped: true });
      continue;
    }
    var acc = readAccountFile(a.uid);
    if (!acc || !acc.accessToken) {
      results.push({ uid: a.uid, name: a.nickname || a.phone, ok: false, kind: "auth", text: "缺少凭据" });
      continue;
    }
    var verdict;
    try {
      var slot = await fetchCheckinSlot(acc.accessToken);
      var slot2 = slot;
      if (!(slot2.code === 0 && slot2.data)) {
        verdict = { ok: false, kind: "fail", text: "查询签到活动失败 http=" + slot2.httpStatus + " code=" + slot2.code };
      } else {
        var st = slot2.data.slotState;
        var act = slot2.data.activity;
        if (st !== "available" || !act || !act.activityCode) {
          verdict = { ok: false, kind: "inactive", text: "当前无可用签到活动（slotState=" + st + "）" };
        } else {
          var idk = ("daily-" + a.uid + "-" + today).slice(0, 64);
          // 用**未脱敏的原始 uid**（缓存键必须稳定）
          var r = await executeCheckin(acc.accessToken, act.activityCode, act.configRevision, idk);
          verdict = classifyCheckin(r);
        }
      }
    } catch (e) {
      verdict = { ok: false, kind: "fail", text: "异常：" + ((e && e.message) || e) };
    }
    cache[a.uid] = {
      date: today, ok: verdict.ok === true, already: verdict.already === true,
      kind: verdict.kind, text: verdict.text, at: Date.now(),
    };
    results.push({ uid: a.uid, name: a.nickname || a.phone, ok: verdict.ok === true, already: verdict.already === true, kind: verdict.kind, text: verdict.text });
  }
  writeCheckinCache(cache);
  var okCount = results.filter(function (r) { return r.ok; }).length;
  return {
    ok: true,
    summary: "汇总：" + okCount + "/" + results.length + " 个账号签到有效",
    okCount: okCount,
    total: results.length,
    results: results,
  };
}

// --------------------------------------------------------------- 内置切号
/**
 * 找 LobsterAI.exe 的位置（用于重启 App）。
 * 顺序：lobster-path.json 覆盖 → 常见安装位置扫描。
 * 与 lobster-daddy.js 的 findLobsterExe() 同规则。
 */
/**
 * exe 路径进程内缓存：找到一次就记住（除非文件消失），
 * 避免每次切号都扫盘 + 起 PowerShell（实测最坏 ~3 秒）。
 */
var _exeCache = null;
var _exeCacheAt = 0;
var EXE_CACHE_TTL_MS = 10 * 60 * 1000;

function findLobsterExe() {
  // 缓存命中（且文件仍在）直接返回
  if (_exeCache && (Date.now() - _exeCacheAt) < EXE_CACHE_TTL_MS) {
    try { if (existsSync(_exeCache)) return _exeCache; } catch (e) { /* 失效则重扫 */ }
  }
  var found = findLobsterExeUncached();
  if (found) { _exeCache = found; _exeCacheAt = Date.now(); }
  return found;
}

function findLobsterExeUncached() {
  var cp = require("node:child_process");

  // ① 显式覆盖
  try {
    var override = JSON.parse(readFileSync(join(LOBSTERDADDY_DIR, "lobster-path.json"), "utf8"));
    if (override && override.path && existsSync(override.path)) return override.path;
  } catch (e) { /* 无覆盖文件是正常的 */ }

  // ② 从正在运行的进程读映像路径（最可靠）
  try {
    var psOut = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-Process -Name LobsterAI -ErrorAction SilentlyContinue | Select-Object -First 1).Path"],
      { encoding: "utf8", timeout: 10000 });
    var rp = String(psOut || "").trim().replace(/^"|"$/g, "");
    if (rp && existsSync(rp)) return rp;
  } catch (e) { /* 没在运行是正常的 */ }

  // ③ 快捷方式（开始菜单 + 桌面）
  try {
    var dirs = [
      join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
      join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
      join(homedir(), "Desktop"),
      join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
    ];
    var psCmd = dirs.map(function (d) {
      return "Get-ChildItem -Path '" + d.replace(/'/g, "''") + "' -Recurse -Filter 'Lobster*.lnk' -ErrorAction SilentlyContinue";
    }).join("; ");
    var lnkOut = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "$s=New-Object -ComObject WScript.Shell; " + psCmd
      + " | Where-Object { $_.Name -notmatch 'Uninstall' } | ForEach-Object { $s.CreateShortcut($_.FullName).TargetPath }"],
      { encoding: "utf8", timeout: 15000 });
    var cands = String(lnkOut || "").split(/\r?\n/).map(function (x) { return x.trim().replace(/^"|"$/g, ""); }).filter(Boolean);
    for (var c = 0; c < cands.length; c++) {
      if (/LobsterAI\.exe$/i.test(cands[c]) && existsSync(cands[c])) return cands[c];
    }
  } catch (e) { /* 快捷方式不可用 */ }

  // ④ 注册表卸载项同目录
  try {
    var regOut = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Lobster' } | ForEach-Object { $_.UninstallString; $_.InstallLocation }"],
      { encoding: "utf8", timeout: 12000 });
    var rows = String(regOut || "").split(/\r?\n/).map(function (x) { return x.trim().replace(/^"|"$/g, ""); }).filter(Boolean);
    for (var r = 0; r < rows.length; r++) {
      var dir = rows[r].indexOf(".exe") >= 0 ? dirname(rows[r]) : rows[r];
      if (!dir) continue;
      try { var exe = join(dir, "LobsterAI.exe"); if (existsSync(exe)) return exe; } catch (e2) { /* ignore */ }
    }
  } catch (e) { /* 注册表不可用 */ }

  // ⑤ 标准位置
  var guesses = [
    join(process.env.LOCALAPPDATA || "", "Programs", "LobsterAI", "LobsterAI.exe"),
    join(process.env.LOCALAPPDATA || "", "LobsterAI", "LobsterAI.exe"),
    join(process.env.ProgramFiles || "C:\\Program Files", "LobsterAI", "LobsterAI.exe"),
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "LobsterAI", "LobsterAI.exe"),
  ];
  for (var i = 0; i < guesses.length; i++) {
    try { if (existsSync(guesses[i])) return guesses[i]; } catch (e) { /* ignore */ }
  }

  // ⑥ 常见盘符（覆盖"装在别的盘"—— 本机正是 E:\LobsterAI，原实现就是漏在这里）
  var drives = ["C", "D", "E", "F", "G"];
  for (var di = 0; di < drives.length; di++) {
    var variants = [
      drives[di] + ":\\LobsterAI\\LobsterAI.exe",
      drives[di] + ":\\LobsterAi\\LobsterAI.exe",
      drives[di] + ":\\Program Files\\LobsterAI\\LobsterAI.exe",
      drives[di] + ":\\Program Files (x86)\\LobsterAI\\LobsterAI.exe",
    ];
    for (var v = 0; v < variants.length; v++) {
      try { if (existsSync(variants[v])) return variants[v]; } catch (e) { /* ignore */ }
    }
  }
  return null;
}

/**
 * 列出正在运行的 LobsterAI 进程 pid。
 *
 * 🔴🔴 两轮事故的最终结论（2026-10-11 实测）：
 *
 * | 方式 | 耗时 | 可用性 |
 * |---|---|---|
 * | `tasklist` | **8767 ms** | 慢但可用 |
 * | `wmic` | — | ❌ **本机根本不存在**（我误判，见下） |
 * | `Get-CimInstance` | 8098 ms | 慢 |
 * | **`powershell -Command "Get-Process"`** | **879 ms** | ✅ 唯一既可用又较快 |
 *
 * **我犯的两个错**：
 *  ① 上一版测出 `wmic` "1 ms" 就采用了它 —— 那其实是**命令不存在立刻报错**的耗时，
 *     不是真的查了进程。于是 `lobsterPids()` 永远返回空 → `wasRunning=false`
 *     → 代码以为"软件没在运行"，跳过杀进程也跳过重启，**却仍然写了登录态**。
 *  ② 检测"失败"与"确实没进程"没有区分 —— 前者绝不能让业务逻辑当成后者。
 *
 * 因此本版：
 *  · 用 PowerShell 子进程（879ms，唯一可用方案）
 *  · **解析失败时抛错**（由调用方决定怎么办），而不是静默返回 []
 */
function lobsterPidsStrict() {
  var cp = require("node:child_process");
  var out = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    "@(Get-Process -Name LobsterAI -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','"],
    { encoding: "utf8", timeout: 15000 });
  var s = String(out || "").trim();
  if (!s) return [];                       // 真的没有进程（PowerShell 正常返回空）
  return s.split(",").map(function (x) { return Number(String(x).trim()); }).filter(function (n) { return n > 0; });
}

/** 宽松版：检测失败时回退 tasklist，最终失败返回 []（供只读展示用） */
function lobsterPids() {
  try { return lobsterPidsStrict(); } catch (e) { /* 落回 tasklist */ }
  try {
    var cp = require("node:child_process");
    var out2 = cp.execFileSync("tasklist", ["/FI", "IMAGENAME eq LobsterAI.exe", "/FO", "CSV", "/NH"],
      { encoding: "utf8", timeout: 20000 });
    var pids2 = [];
    out2.split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^"LobsterAI\.exe","(\d+)"/i);
      if (m) pids2.push(Number(m[1]));
    });
    return pids2;
  } catch (e) { return []; }
}

/**
 * 启动 LobsterAI。
 *
 * 🔴🔴 第三轮事故修正（2026-10-11）：`spawn(exe)` **起不来**！
 *
 * 实测对比（同一台机器、同一个 exe）：
 *   · `spawn('E:\\LobsterAI\\LobsterAI.exe', [], {detached:true})` → **失败**（进程数 0）
 *   · `Invoke-CimMethod Win32_Process Create`（带 CurrentDirectory）→ **成功**（6 进程）
 *
 * 原因：LobsterAI 是 **Electron 应用**，必须在**自己的安装目录**下启动才能找到
 * `resources/`、`app.asar` 等。Node 的 `spawn` 若不给 `cwd`，在某些宿主环境里
 * 会继承一个不合适的工作目录（尤其被 DSH 这类 Electron 宿主拉起时），
 * 导致应用启动即退出 —— **表面上"spawn 成功"但进程活不下来**。
 *
 * 因此改用 **WMI 启动**（`Win32_Process.Create`，可显式指定 `CurrentDirectory`），
 * 并保留 spawn（带 cwd）作为兜底。
 */
function startLobster(exe) {
  var cp = require("node:child_process");
  var workDir = dirname(exe);

  // ① WMI（实测可用，且能显式指定工作目录）
  try {
    var ps = "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{"
      + "CommandLine='\"" + exe.replace(/'/g, "''") + "\"';"
      + "CurrentDirectory='" + workDir.replace(/'/g, "''") + "'} | Select-Object -ExpandProperty ReturnValue";
    var out = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8", timeout: 20000 });
    if (String(out || "").trim() === "0") return { via: "wmi", ok: true };
  } catch (e) { /* 落回 spawn */ }

  // ② spawn 兜底（**必须带 cwd**）
  try {
    cp.spawn(exe, [], { detached: true, stdio: "ignore", cwd: workDir }).unref();
    return { via: "spawn", ok: true };
  } catch (e) {
    return { via: "none", ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * 关闭 LobsterAI。
 *
 * 🔴 性能修正（2026-10-11 实测计时）：
 *   · `taskkill`（优雅，不带 /F）→ **8.4 秒**，而且 Electron 的渲染子进程常拒绝被终止
 *   · 之后"等退出"再花 **15.2 秒** → 两段合计 23.6 秒（占切号总耗时的 85%）
 *
 * 而 LobsterAI 的登录态只在 SQLite 里（我们直接写库），**不需要它优雅落盘**，
 * 所以直接 `/F` 强杀即可 —— 实测降到 ~1 秒级。
 */
function killLobster() {
  return new Promise((resolve) => {
    var cp = require("node:child_process");
    // 直接强杀（/F）：Electron 的优雅关闭会卡住，而我们不需要它做收尾工作
    cp.execFile("taskkill", ["/IM", "LobsterAI.exe", "/T", "/F"], { timeout: 20000 }, () => {
      // 快速轮询确认退出（间隔 200ms，最多 ~2 秒）
      var tries = 0;
      var check = function () {
        var left = lobsterPids();
        if (!left.length) return resolve(true);
        if (++tries >= 10) return resolve(lobsterPids().length === 0);
        setTimeout(check, 200);
      };
      setTimeout(check, 200);
    });
  });
}

/**
 * 内置切号：读自持账号 → 写 LobsterAI 的 SQLite → 重启 App。
 *
 * 复刻 lobster-daddy.js `switchAccount()` 的规则（同一份 SQLite 键名），
 * 因此切号结果与走控制台**完全等价**。
 *
 * ⚠️ 必须重启 LobsterAI：它的登录态在**运行中的内存**里，
 * 写完 SQLite 只是"下次启动读到的值"。（这与 WorkBuddy 不同 ——
 * WorkBuddy 的登录态是文件，换文件即生效，所以 hub 的切号无需重启。）
 */
async function switchAccountLocal(uid) {
  var wantUid = String(uid || "").trim();
  if (!wantUid) return { ok: false, error: "缺少 uid" };
  var account = readAccountFile(wantUid);
  if (!account || !account.accessToken) return { ok: false, error: "账号不存在或缺少凭据：" + wantUid };

  var sqlite = null;
  try { sqlite = require("node:sqlite"); } catch (e) { sqlite = null; }
  if (!sqlite || !sqlite.DatabaseSync) return { ok: false, error: "当前 Node 缺少 node:sqlite，无法写登录态（需要 Node 22+）" };

  // 🔴🔴 事故修正（2026-10-11）：**先确认能找到 exe，再决定能不能杀进程**。
  //
  // 原实现的顺序是「先 killLobster() → 写 SQLite → 再 findLobsterExe() 」，
  // 一旦找不到 exe（本机装在 E:\LobsterAI，原候选路径全落空），
  // 结果就是：**服务被杀了，但拉不起来** → 用户的软件直接掉了。
  //
  // 新规则：把 exe 查找提到杀进程**之前**；只要要重启却又找不到 exe，
  // **立刻拒绝整次切号，绝不先杀**。
  // 🔴 用 strict 版检测，且**检测失败必须拒绝**（2026-10-11 第二轮事故修正）
  //
  // 上一轮的教训（wmic 不存在 → 检测永远返回空 → wasRunning=false）：
  // 代码以为"软件没在运行"，于是跳过杀进程、跳过重启，**却仍然写了登录态** ——
  // 用户看到的现象就是"点了切换，软件掉了"（其实是被写库后 App 自身重启失败/被中断）。
  //
  // 因此：**进程检测不能失败后当成"没有进程"**。查不到就拒绝整次操作。
  var pidsNow = null;
  try {
    pidsNow = lobsterPidsStrict();
  } catch (e) {
    return {
      ok: false,
      refused: true,
      error: "已中止切号：无法确定 LobsterAI 是否在运行（进程检测失败：" + ((e && e.message) || e)
        + "）。为安全起见不做任何改动。",
    };
  }
  var wasRunning = pidsNow.length > 0;
  var exe = null;
  if (wasRunning) {
    exe = findLobsterExe();
    if (!exe) {
      return {
        ok: false,
        refused: true,
        error: "已中止切号：LobsterAI 正在运行，但找不到 LobsterAI.exe，"
          + "无法保证切换后能重启它（宁可不动，也不让你丢服务）。"
          + "请把路径写入 " + join(LOBSTERDADDY_DIR, "lobster-path.json")
          + " 形如 {\"path\":\"E:\\\\LobsterAI\\\\LobsterAI.exe\"} 后重试。",
      };
    }
  }

  // 记录旧凭据，供失败时回滚
  var prevTokens = null;
  var prevUser = null;
  try {
    var dbR = new sqlite.DatabaseSync(LOBSTER_DB_FILE, { readOnly: true });
    try {
      var t0 = dbR.prepare("SELECT value FROM kv WHERE key = ?").get("auth_tokens");
      var u0 = dbR.prepare("SELECT value FROM kv WHERE key = ?").get("auth_user");
      prevTokens = t0 ? t0.value : null;
      prevUser = u0 ? u0.value : null;
    } finally { try { dbR.close(); } catch (e) { /* ignore */ } }
  } catch (e) { /* 读不到旧值是次要问题 */ }

  if (wasRunning) {
    var killed = await killLobster();
    if (!killed) return { ok: false, error: "无法关闭 LobsterAI（可能有残留进程），已中止切号以免写出半成品状态" };
  }

  // 写 SQLite 的两个 kv 行（键名与 lobster-daddy.js 完全一致）
  var db = null;
  try {
    db = new sqlite.DatabaseSync(LOBSTER_DB_FILE);
  } catch (e) {
    return { ok: false, error: "打开 LobsterAI 数据库失败：" + ((e && e.message) || e) };
  }
  try {
    var tokens = JSON.stringify({ accessToken: account.accessToken, refreshToken: account.refreshToken });
    var userRaw = account.userRaw || {
      yid: account.yid, phone: account.phone, avatarUrl: null,
      nickname: account.nickname,
      id: account.userId ? Number(account.userId) : Number(account.uid),
      status: 1,
    };
    var user = JSON.stringify(userRaw);
    var now = Date.now();
    // upsert（不同 SQLite 版本对 ON CONFLICT 支持不一致，用两步更稳）
    var up = db.prepare("UPDATE kv SET value = ?, updated_at = ? WHERE key = ?");
    var ins = db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)");
    for (var pair of [["auth_tokens", tokens], ["auth_user", user]]) {
      var info = up.run(pair[1], now, pair[0]);
      if (!info || info.changes === 0) ins.run(pair[0], pair[1], now);
    }
  } catch (e) {
    try { db.close(); } catch (e2) { /* ignore */ }
    return { ok: false, error: "写入登录态失败：" + ((e && e.message) || e) };
  } finally {
    try { db.close(); } catch (e2) { /* ignore */ }
  }

  // 重启 LobsterAI（只有它本来在运行时才拉起，避免"顺手打开一个 App"）
  // exe 已在杀进程**之前**确认过（见函数开头），所以这里一定拿得到。
  var relaunched = false;
  if (wasRunning) {
    try {
      await startLobster(exe);
      // 🔴 时序优化（2026-10-11）：Electron 冷启动本身要约 3~5 秒，
      // 所以先等 3 秒再开始检测，避免前几次无效轮询（每次还带 1.5s 的进程查询开销）。
      // 之后每次间隔 500ms，总上限约 25 秒。
      // 冷启动实测 1.8 秒 → 先等 4 秒（含余量），再每 700ms 检查一次，最多 6 次。
      // 这样正常情况只调 1 次进程检测（PowerShell ~1s），而不是 40 次。
      await new Promise(function (r) { setTimeout(r, 4000); });
      for (var w = 0; w < 6; w++) {
        if (lobsterPids().length > 0) { relaunched = true; break; }
        await new Promise(function (r) { setTimeout(r, 700); });
      }
    } catch (e) { relaunched = false; }
  }

  // 🔴 重启失败 → **回滚登录态并尝试恢复原状态**（事故修正 2026-10-11）
  // 原实现此时仍返回 ok:true，用户看到"已切换"但软件已经没了。
  if (wasRunning && !relaunched) {
    var rolledBack = false;
    try {
      if (prevTokens !== null || prevUser !== null) {
        var db2 = new sqlite.DatabaseSync(LOBSTER_DB_FILE);
        try {
          var up2 = db2.prepare("UPDATE kv SET value = ?, updated_at = ? WHERE key = ?");
          var ins2 = db2.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)");
          var pairs2 = [];
          if (prevTokens !== null) pairs2.push(["auth_tokens", prevTokens]);
          if (prevUser !== null) pairs2.push(["auth_user", prevUser]);
          for (var pi = 0; pi < pairs2.length; pi++) {
            var inf = up2.run(pairs2[pi][1], Date.now(), pairs2[pi][0]);
            if (!inf || inf.changes === 0) ins2.run(pairs2[pi][0], pairs2[pi][1], Date.now());
          }
          rolledBack = true;
        } finally { try { db2.close(); } catch (e3) { /* ignore */ } }
      }
    } catch (e) { rolledBack = false; }
    // 再试一次拉起（给用户一个"至少把软件还回去"的结果）
    var secondTry = false;
    try {
      await startLobster(exe);
      await new Promise(function (r) { setTimeout(r, 4000); });
      for (var w2 = 0; w2 < 6; w2++) {
        if (lobsterPids().length > 0) { secondTry = true; break; }
        await new Promise(function (r) { setTimeout(r, 700); });
      }
    } catch (e) { secondTry = false; }
    return {
      ok: false,
      uid: wantUid,
      wasRunning: wasRunning,
      restarted: secondTry,
      rolledBack: rolledBack,
      error: "切号未能完成：LobsterAI 重启失败。"
        + (rolledBack ? "已回滚到原账号登录态。" : "回滚也失败，请手动在 LobsterAI 里登录。")
        + (secondTry ? "（重试后已把它拉起）" : "（重试也没起来，请手动启动 " + exe + "）"),
    };
  }

  var acc = readAccountFile(wantUid);
  return {
    ok: true,
    source: "builtin",
    uid: wantUid,
    // 🔴 脱敏后再回传
    phone: maskPhone(acc && acc.phone),
    nickname: maskNick(acc && acc.nickname) || maskPhone(acc && acc.phone),
    wasRunning: wasRunning,
    restarted: relaunched,
    exe: exe || null,
    note: wasRunning
      ? "已写入登录态并重启 LobsterAI"
      : "LobsterAI 未在运行：已写入登录态，下次启动即为该账号",
  };
}

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

      // ---- 内置数据路由（不依赖常驻控制台，2026-10-11） ----
      // 这些内容与 17819 控制台的 /api/status 同源（都读 LobsterDaddy 自持的
      // accounts 目录 + LobsterAI 的 SQLite），因此**没有控制台进程时依然可用**。
      if (sub === "/local/status") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var accounts = [];
        var err = null;
        try { accounts = listLocalAccounts(); } catch (e) { err = String((e && e.message) || e); }
        var curAcc = null;
        try { curAcc = currentLocalAccount(); } catch (e) { /* ignore */ }
        // 🔴 内置额度：并发直调上游（带 60 秒缓存），不需要控制台。
        // 需要 ?quota=0 可跳过（用于纯列表的轻量轮询）。
        var wantQuota = !/[?&]quota=0/.test(url.search || "");
        if (wantQuota && accounts.length) {
          try {
            var views = await fetchQuotaViews(accounts.map(function (a) { return a.uid; }), /[?&]force=1/.test(url.search || ""));
            for (var i = 0; i < accounts.length; i++) {
              var v = views[accounts[i].uid] || null;
              accounts[i].snapshot = v && !v.error ? v : null;
              if (v && v.error) accounts[i].snapshotError = v.error;
            }
          } catch (e) { /* 额度是增强，失败不影响列表 */ }
        }
        // 控制台是否在线（只作为"可选增强可用性"上报，不是必需）
        var panelUp = false;
        try { panelUp = !!(await probePanel(panelPort)).running; } catch (e) { panelUp = false; }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({
          ok: true,
          source: "builtin",
          error: err,
          panelOnline: panelUp,
          accountsDir: LD_ACCOUNTS_DIR,
          accountsCount: accounts.length,
          current: curAcc,
          accounts: accounts,
        }));
        return;
      }

      // ---- 内置切号（读自持账号 → 写 LobsterAI SQLite → 重启 App） ----
      // 与 lobster-daddy.js 的 switchAccount() 同构：纯文件 + SQLite 操作，
      // 不需要常驻服务。唯一必须的是**重启 LobsterAI**（它的登录态在内存里）。
      if (sub === "/local/switch") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "POST required" }));
          return;
        }
        var body = "";
        try { body = await new Promise((resolve) => {
          var chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          req.on("error", () => resolve(""));
        }); } catch (e) { body = ""; }
        var wantUid = "";
        try { wantUid = String((JSON.parse(body || "{}")).uid || ""); } catch (e) { wantUid = ""; }
        var out = await switchAccountLocal(wantUid);
        res.writeHead(out.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(out));
        return;
      }

      // ---- 内置签到（v0.7.0）：直调上游，不需要控制台 ----
      // 原来按钮打的是 /panel/api/checkin（17819 控制台），控制台停用后必然失败。
      if (sub === "/local/checkin") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var forceCheckin = /[?&]force=1/.test(url.search || "");
        var ciRes;
        try { ciRes = await runCheckinAll(forceCheckin); }
        catch (e) { ciRes = { ok: false, error: String((e && e.message) || e) }; }
        res.writeHead(ciRes.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(ciRes));
        return;
      }

      // ---- 自检：诊断「浏览器打不开」的最常见原因（请求头过大） ----
      // 🔴 2026-10-11：实测确认根因是 DSH 自身的 dsh-auth-* Cookie 累积
      // （端口每次变 → cookie 名变 → 30 天有效期内不断堆积 → 超 Node 16KB 上限）。
      // 这里把诊断做进插件，用户一访问就能看到问题与解法。
      if (sub === "/selfcheck") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var httpMod = require("node:http");
        var limit = httpMod.maxHeaderSize || 16384;
        var rawCookie = req.headers.cookie || "";
        var cookieLen = Buffer.byteLength(rawCookie, "utf8");
        var headerLen = 0;
        try {
          Object.keys(req.headers).forEach(function (k) {
            headerLen += Buffer.byteLength(k + ": " + String(req.headers[k]) + "\r\n", "utf8");
          });
        } catch (e) { /* ignore */ }
        // 统计 dsh-auth-* cookie 条数（累积的直接指标）
        var dshAuthCount = (rawCookie.match(/dsh-auth-/g) || []).length;
        var ratio = limit > 0 ? headerLen / limit : 0;
        var verdict;
        var advice = [];
        if (ratio >= 0.8) {
          verdict = "danger";
          advice.push("请求头已用 " + Math.round(ratio * 100) + "% 的配额，**很可能随时触发 431（浏览器打不开）**。");
          advice.push("① 治标：设 NODE_OPTIONS=--max-http-header-size=131072，然后重启 DSH。");
          advice.push("② 治本：把 ~/.dsh/desktop-preferences.json 的 port 从 0 改成固定端口，避免 Cookie 继续累积。");
          advice.push("③ 清理：在浏览器设置里清除本站点 Cookie（HttpOnly，JS 删不掉）。");
        } else if (ratio >= 0.5) {
          verdict = "warn";
          advice.push("请求头已用 " + Math.round(ratio * 100) + "%，建议尽早固定 DSH 端口以免继续累积。");
        } else {
          verdict = "ok";
          advice.push("请求头占用正常（" + Math.round(ratio * 100) + "%），暂无风险。");
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({
          ok: true,
          verdict: verdict,
          maxHeaderSize: limit,
          currentHeaderBytes: headerLen,
          usageRatio: Math.round(ratio * 1000) / 1000,
          cookieBytes: cookieLen,
          dshAuthCookieCount: dshAuthCount,
          advice: advice,
          note: "dsh-auth-* Cookie 由 DSH 的 dsh-client-connection 写入（每次换端口生成一个新名字，30 天有效）。条数越多越接近上限。",
        }, null, 2));
        return;
      }

      // ---- 内置刷新额度：绕过缓存强制重拉 ----
      if (sub === "/local/quota/refresh") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var accs = [];
        try { accs = listLocalAccounts(); } catch (e) { /* ignore */ }
        var refreshed = {};
        try { refreshed = await fetchQuotaViews(accs.map(function (a) { return a.uid; }), true); }
        catch (e) { /* 额度是增强 */ }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, refreshed: Object.keys(refreshed).length }));
        return;
      }

      // ---- 内置"抓取当前登录账号"：重读 SQLite，返回当前账号 ----
      // 原按钮走控制台 /api/capture（把 App 内登录态抓进账号库）。
      // 内置模式下账号库本就由我们直读，此路由等价于"刷新当前账号信息"。
      if (sub === "/local/capture") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var cur = null;
        try { cur = currentLocalAccount(); } catch (e) { /* ignore */ }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({
          ok: true,
          source: "builtin",
          uid: cur ? cur.uid : null,
          phone: cur ? cur.phone : null,
          nickname: cur ? cur.nickname : null,
          note: cur ? "已从 LobsterAI 存储读取当前登录账号" : "未识别到当前登录账号",
        }));
        return;
      }

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

      // ---- 内置看板页（浏览器可访问，不依赖控制台） ----
      // 🔴 2026-10-11 新增：插件改为内置数据层后，需要一个"浏览器能打开的页面"。
      // 与 dsh-workbuddy-hub 的 /board 同一模式：宿主直接渲染，无需认证、无需外部进程。
      if (sub === "/board") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        // 🔴 2026-10-11：看板页顶部显示「请求头占用」自检提示。
        // 用户在这里最直接 —— 若占用过高，很可能下一秒就打不开页面了。
        var selfLimit = require("node:http").maxHeaderSize || 16384;
        var selfRawCookie = req.headers.cookie || "";
        var selfHdrLen = 0;
        try {
          Object.keys(req.headers).forEach(function (k) {
            selfHdrLen += Buffer.byteLength(k + ": " + String(req.headers[k]) + "\r\n", "utf8");
          });
        } catch (e) { /* ignore */ }
        var selfRatio = selfLimit > 0 ? selfHdrLen / selfLimit : 0;
        var selfAuthCount = (selfRawCookie.match(/dsh-auth-/g) || []).length;
        var selfBanner = "";
        if (selfRatio >= 0.8) {
          selfBanner = "<div class='banner danger'><b>⚠️ 请求头已用 " + Math.round(selfRatio * 100) + "% 配额，随时可能打不开页面</b>"
            + "<div>原因：DSH 的 <code>dsh-auth-*</code> Cookie 累积（本页收到 " + selfAuthCount + " 条）。每次 DSH 重启换端口就会新增一条，30 天不失效。</div>"
            + "<div>解决：① 设 <code>NODE_OPTIONS=--max-http-header-size=131072</code>；② 把 <code>desktop-preferences.json</code> 的 <code>port</code> 固定；③ 在浏览器里清除本站点 Cookie。</div></div>";
        } else if (selfRatio >= 0.5) {
          selfBanner = "<div class='banner warn'>请求头已用 " + Math.round(selfRatio * 100) + "%（<code>dsh-auth-*</code> " + selfAuthCount + " 条），建议固定 DSH 端口以免继续累积。</div>";
        }

        var bAcc = [];
        try { bAcc = listLocalAccounts(); } catch (e) { /* ignore */ }
        try {
          var bViews = await fetchQuotaViews(bAcc.map(function (a) { return a.uid; }), false);
          for (var bi = 0; bi < bAcc.length; bi++) {
            var bv = bViews[bAcc[bi].uid] || null;
            bAcc[bi].snapshot = bv && !bv.error ? bv : null;
          }
        } catch (e) { /* 额度是增强 */ }
        var esc2 = function (s) {
          return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
          });
        };
        var rows = bAcc.map(function (a) {
          var s = a.snapshot;
          var ci = a.checkin;
          return "<div class='acc" + (a.isCurrent ? " cur" : "") + "' data-uid='" + esc2(a.uid) + "'>"
            + "<div class='row1'><b>" + esc2(a.nickname || a.phone || a.uid) + "</b>"
            + (a.isCurrent ? "<span class='tag-cur'>当前</span>" : "")
            + "<span class='uid'>" + esc2(a.uid) + "</span>"
            + "<span class='flex1'></span>"
            // 🔴 2026-10-11：每个账号卡片带「切换」按钮（非当前账号才显示）
            + (a.isCurrent ? "" : "<button class='btn btn-switch' data-act='switch' data-uid='" + esc2(a.uid) + "'>切换</button>")
            + "</div>"
            + "<div class='quota'>" + (s && s.balance != null ? esc2(s.balance) + " 积分" : "（额度未取到）")
            + (s && s.plan ? " · " + esc2(s.plan) : "")
            + (s && s.dailyUsed != null ? " · 今日已用 " + esc2(s.dailyUsed) : "") + "</div>"
            + (s && s.items && s.items.length
              ? "<div class='items'>" + s.items.map(function (it) {
                  return "<span>" + esc2(it.label) + " " + esc2(it.remaining) + (it.exp ? "（" + esc2(it.exp) + " 前有效）" : "") + "</span>";
                }).join("") + "</div>"
              : "")
            + "<div class='meta'>"
            + (ci && ci.ok ? "<span class='tag-ok'>" + (ci.already ? "今日已签到" : "已签到") + "</span>" : "")
            + (a.accessExp ? "<span>token 至 " + esc2(new Date(a.accessExp).toLocaleDateString("zh-CN")) + "</span>" : "")
            + "</div>"
            + "</div>";
        }).join("");

        // 顶部工具栏（与抽屉里的功能对齐）
        var toolbar = "<div class='toolbar'>"
          + "<button class='btn btn-primary' data-act='checkin'>立即全部签到</button>"
          + "<button class='btn' data-act='quota'>刷新额度</button>"
          + "<button class='btn' data-act='capture'>抓取当前登录账号</button>"
          + "<button class='btn' data-act='reload'>重新读取</button>"
          + "<button class='btn' data-act='login'>＋ 免退出登录新账号</button>"
          // 🔴 2026-10-11：★ Star（对齐抽屉与 dsh-workbuddy-hub）
          + "<a class='btn btn-star' href='" + REPO_URL + "' target='_blank' rel='noopener noreferrer' "
          + "data-act='star' title='" + (REPO_READY ? "给这个插件点个 Star：" + REPO_URL : "仓库尚未发布：" + REPO_URL) + "'>★ Star</a>"
          + "</div>"
          + "<div id='msg' class='msg'></div>" + selfBanner;

        var page = "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
          + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
          + "<title>LobsterAI 多账号看板</title><style>"
          + "body{margin:0;padding:18px;font:14px/1.6 system-ui,'Microsoft YaHei',sans-serif;"
          + "background:#f6f7f9;color:#1f2328;}"
          + "h1{font-size:17px;margin:0 0 4px;}"
          + ".sub{color:#6a737d;font-size:12px;margin-bottom:12px;}"
          + ".toolbar{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;}"
          + ".btn{padding:6px 12px;border-radius:7px;border:1px solid #d5d8dd;background:#fff;"
          + "color:#1f2328;font-size:13px;cursor:pointer;font-family:inherit;}"
          + ".btn:hover{background:#f0f2f5;}"
          + ".btn:disabled{opacity:.5;cursor:not-allowed;}"
          + ".btn-star{background:linear-gradient(180deg,#ffd66b,#f5b301);border-color:#e0a800;color:#3a2b00;font-weight:600;text-decoration:none;display:inline-block;}"
          + ".banner{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;line-height:1.5;}"
          + ".banner.danger{background:#fdeceb;border:1px solid #f5c2c0;color:#8a1f1a;}"
          + ".banner.warn{background:#fff8e5;border:1px solid #f0dca8;color:#7a5b00;}"
          + ".banner code{background:rgba(0,0,0,.07);padding:1px 4px;border-radius:3px;font-size:12px;}"
          + ".btn-primary{background:linear-gradient(180deg,#ff7a45,#e8442a);border-color:transparent;"
          + "color:#fff;font-weight:600;}"
          + ".btn-switch{padding:3px 10px;font-size:12px;}"
          + ".msg{display:none;margin-bottom:12px;padding:9px 12px;border-radius:8px;font-size:13px;"
          + "background:#eef4ff;border:1px solid #c7d9f7;white-space:pre-wrap;}"
          + ".msg.show{display:block;}"
          + ".msg.err{background:#fdeceb;border-color:#f5c2c0;}"
          + ".acc{background:#fff;border:1px solid #e3e5e8;border-radius:10px;padding:10px 12px;margin-bottom:9px;}"
          + ".acc.cur{border-color:#1f6feb;box-shadow:0 0 0 2px rgba(31,111,235,.12);}"
          + ".row1{display:flex;align-items:center;gap:8px;}"
          + ".row1 b{font-size:15px;}"
          + ".uid{color:#8b93a7;font-size:12px;}"
          + ".flex1{flex:1 1 auto;}"
          + ".tag-cur{background:#1f6feb;color:#fff;border-radius:5px;padding:1px 7px;font-size:11px;}"
          + ".quota{margin-top:3px;font-size:15px;font-weight:600;}"
          + ".items{margin-top:5px;display:flex;flex-wrap:wrap;gap:6px;}"
          + ".items span{background:#f0f2f5;border-radius:6px;padding:2px 8px;font-size:12px;color:#57606a;}"
          + ".meta{margin-top:7px;display:flex;gap:8px;align-items:center;font-size:12px;color:#6a737d;}"
          + ".tag-ok{background:#d7f5e3;color:#0a7a3d;border-radius:5px;padding:1px 7px;}"
          + ".hint{color:#8b93a7;font-size:12px;margin-top:16px;}"
          + "</style><body><h1>LobsterAI 多账号</h1>"
          + "<div class='sub'>数据由插件宿主直接读取（不需要 LobsterDaddy 控制台）· 共 "
          + bAcc.length + " 个账号</div>"
          + toolbar
          + "<div id='list'>" + rows + "</div>"
          + "<div class='hint'>此页由 dsh-lobsterai-daddy 提供。手机号与昵称已脱敏。</div>"
          // 前端脚本：按钮 → 调内置路由
          + "<script>(function(){"
          + "var BASE='" + ROUTE_PREFIX + "';"
          + "var msg=document.getElementById('msg');"
          + "var listEl=document.getElementById('list');"
          + "function show(t,err){msg.textContent=t;msg.className='msg show'+(err?' err':'');}"
          + "function busy(b){var bs=document.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].disabled=b;}"
          + "function post(p,body){"
          + "  busy(true);show('执行中…（'+p+'）');"
          + "  return fetch(BASE+p,{method:'POST',headers:{'content-type':'application/json'},"
          + "    body:JSON.stringify(body||{})})"
          + "    .then(function(r){return r.json().catch(function(){return {};});})"
          + "    .then(function(d){busy(false);"
          + "      if(d&&d.ok){"
          + "        var m=d.summary||d.note||'完成';"
          + "        if(d.results&&d.results.length){m+='\\n'+d.results.map(function(x){return x.name+': '+x.text;}).join('\\n');}"
          + "        show(m);setTimeout(reload,900);"
          + "      } else {show((d&&d.error)||'失败',true);}"
          + "      return d;"
          + "    }).catch(function(e){busy(false);show('请求失败: '+e.message,true);});"
          + "}"
          + "function reload(){location.reload();}"
          + "document.addEventListener('click',function(ev){"
          + "  var el=ev.target;while(el&&el!==document&&!el.getAttribute('data-act'))el=el.parentNode;"
          + "  if(!el||el===document)return;"
          + "  var act=el.getAttribute('data-act');if(!act)return;"
          + "  ev.preventDefault();"
          + "  if(act==='checkin'){post('/local/checkin');return;}"
          + "  if(act==='quota'){post('/local/quota/refresh');return;}"
          + "  if(act==='capture'){post('/local/capture');return;}"
          + "  if(act==='reload'){reload();return;}"
          + "  if(act==='login'){"
          + "    window.open('" + "http://127.0.0.1:17819" + "','_blank');"
          + "    show('登录新账号需要 LobsterDaddy 控制台（当前未运行）。可在 LobsterAI 里手动登录后用「抓取当前登录账号」。',true);return;}"
          + "  if(act==='switch'){"
          + "    var uid=el.getAttribute('data-uid');if(!uid)return;"
          + "    if(!confirm('切换账号会关闭并重启 LobsterAI，确定继续？'))return;"
          + "    post('/local/switch',{uid:uid});return;}"
          + "});"
          + "})();</script>"
          + "</body></html>";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(page);
        return;
      }

      // ---- open the console in the SYSTEM browser ----
      // The renderer lives on the dsh-app:// scheme where window.open is routinely
      // blocked, so "浏览器打开" silently did nothing. The Host is an ordinary Node
      // process and can launch the default browser for real.
      //
      // 🔴 2026-10-11 修正：原来打开的是 `http://127.0.0.1:<panelPort>/`（17819 控制台），
      // 而插件已改为**内置数据层**、控制台已停用 → 那个地址打不开（用户报"浏览器打不开"）。
      // 现在改为打开**插件自己的看板页**（宿主直接渲染，不依赖任何外部进程），
      // 与 dsh-workbuddy-hub 的 /board 同一模式。
      // ---- 打开任意 URL（★ Star 直达用） ----
      // 🔴 2026-10-11：渲染进程在 dsh-app:// 下 window.open 常被拦，
      // 所以对外链一律走宿主 —— 由 Node 进程真正拉起系统浏览器。
      // 安全：只允许 http/https，且必须本机调用。
      if (sub === "/open-url") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        var ouBody = "";
        try {
          ouBody = await new Promise(function (resolve) {
            var chunks = [];
            req.on("data", function (c) { chunks.push(c); });
            req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
            req.on("error", function () { resolve(""); });
          });
        } catch (e) { ouBody = ""; }
        var ouUrl = "";
        try { ouUrl = String((JSON.parse(ouBody || "{}")).url || ""); } catch (e) { ouUrl = ""; }
        // 只允许 http/https（防止 file://、javascript: 等被当作外链打开）
        if (!/^https?:\/\//i.test(ouUrl)) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "只允许 http/https URL" }));
          return;
        }
        var ouLaunched = false;
        try {
          if (process.platform === "win32") {
            spawn("cmd", ["/c", "start", "", ouUrl], { detached: true, stdio: "ignore" }).unref();
          } else if (process.platform === "darwin") {
            spawn("open", [ouUrl], { detached: true, stdio: "ignore" }).unref();
          } else {
            spawn("xdg-open", [ouUrl], { detached: true, stdio: "ignore" }).unref();
          }
          ouLaunched = true;
        } catch (e) { ouLaunched = false; }
        ctx.logger.info("[dsh-lobsterai-daddy] open-url " + ouUrl + " launched=" + ouLaunched);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: ouLaunched, url: ouUrl, via: process.platform === "win32" ? "cmd start" : "open" }));
        return;
      }

      if (sub === "/open") {
        if (!isLoopback(req)) {
          res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "仅允许本机访问" }));
          return;
        }
        // 打开自己的看板（同源、无需认证、不依赖控制台）
        var openUrl = "http://127.0.0.1:" + ctx.webServer.port + ROUTE_PREFIX + "/board";
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
          "<body style='font:14px system-ui;background:#f6f7f9;color:#1f2328;padding:24px'>" +
          // 🔴 2026-10-11：文案改为准确描述（原来是"已在系统浏览器中打开控制台"，
          // 而控制台已停用、现在打开的是插件自己的看板，旧文案会误导用户）。
          "<p>" + (launched ? "已在系统浏览器中打开 LobsterAI 多账号看板。" : "无法自动打开，请手动访问：") + "</p>" +
          "<p><a style='color:#1f6feb' href='" + openUrl + "' target='_blank'>" + openUrl + "</a></p>" +
          "<p style='color:#6a737d;font-size:12px'>此看板由插件宿主直接渲染，不需要 LobsterDaddy 控制台。</p>" +
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
