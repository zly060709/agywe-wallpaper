"use strict";
/*
 * agywe — Wallpaper Engine 壁纸插件（Antigravity 桌面 App）主进程部分
 * 由 install.cjs 注入到 app.asar 的 dist/agywe/hook.js，main.js 第一行 require 它。
 * 任何异常都只记日志，绝不影响 Antigravity 本身启动。
 */
const electron = require("electron");
const { app, protocol, session, dialog, shell, BrowserWindow, ipcMain, desktopCapturer } = electron;
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { Readable } = require("stream");

const AGYWE_VERSION = "__AGYWE_VERSION__";
const SCHEME = "agywe";
const ORIGIN = `${SCHEME}://app`;
const APP_DIR = path.join(__dirname, "app");
const TOKEN = crypto.randomBytes(16).toString("hex");

// ---------------------------------------------------------------------------
// 诊断日志：插件文件夹 agywe-diag.log（存在时）+ %APPDATA%\Antigravity\agywe\diag.log
// ---------------------------------------------------------------------------
const DIAG_FILES = [];
try {
  const la = process.env.LOCALAPPDATA;
  const pluginDir = la ? path.join(la, "Programs", "agywe-wallpaper") : null;
  if (pluginDir && fs.existsSync(pluginDir)) DIAG_FILES.push(path.join(pluginDir, "agywe-diag.log"));
} catch { }
let diagCount = 0;
function diagWrite(obj) {
  if (diagCount++ > 2000) return;
  let line;
  try { line = new Date().toISOString() + " " + (typeof obj === "string" ? obj : JSON.stringify(obj)) + "\n"; } catch { return; }
  for (const f of DIAG_FILES) {
    try {
      try { if (fs.statSync(f).size > 4 * 1024 * 1024) { try { fs.rmSync(f + ".old", { force: true }); } catch { } fs.renameSync(f, f + ".old"); } } catch { }
      fs.appendFileSync(f, line);
    } catch { }
  }
}
const fmt = (a) => a.map((x) => x instanceof Error ? (x.stack || x.message) : typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ");
const log = (...a) => { try { console.log("[agywe]", ...a); } catch { } diagWrite("[main] " + fmt(a)); };
const warn = (...a) => { try { console.warn("[agywe]", ...a); } catch { } diagWrite("[main][warn] " + fmt(a)); };

try {
  app.once("ready", () => {
    try {
      const f = path.join(app.getPath("userData"), "agywe", "diag.log");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      DIAG_FILES.push(f);
    } catch { }
  });
} catch { }
diagWrite(`===== agywe v${AGYWE_VERSION} hook loaded, electron ${process.versions.electron}, pid ${process.pid}`);

// ---------------------------------------------------------------------------
// v0.10.7 本机调试端口：猫猫桌宠这类插件要靠它把界面挂进来（它们读 %APPDATA%\Antigravity\DevToolsActivePort）。
// 以前是旧主题补丁往快捷方式里加 --remote-debugging-port=0，换个图标打开、或者 Antigravity 自动更新后就没了。
// 现在在这里统一打开：只监听 127.0.0.1，端口随机。必须在 app ready 之前设，main.js 第一行加载这里，正好来得及。
// 设置里「外观」→「允许其他插件挂进界面」可以关。
// ---------------------------------------------------------------------------
try {
  let want = true;
  try {
    const f = path.join(app.getPath("userData"), "agywe", "config.json");
    const c = JSON.parse(fs.readFileSync(f, "utf8"));
    if (c && c.cdpForPlugins === false) want = false;
  } catch { }
  if (app.commandLine.hasSwitch("remote-debugging-port")) diagWrite("[cdp] 启动参数里已经有 --remote-debugging-port，不用再加");
  else if (want) { app.commandLine.appendSwitch("remote-debugging-port", "0"); diagWrite("[cdp] 已打开本机调试端口（给猫猫桌宠等插件用）"); }
  else diagWrite("[cdp] 设置里关掉了「允许其他插件挂进界面」，不打开调试端口");
} catch (e) { diagWrite("[cdp] 打开调试端口失败：" + (e && e.message || e)); }

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const DEFAULTS = {
  enabled: true,
  current: null,                // { kind: 'we' | 'custom', id }
  favorites: [],                // ['we:<id>', 'custom:<id>']
  hidden: [],
  custom: [],                   // [{ id, path, type: 'video'|'image', title }]
  extraDirs: [],
  // 播放
  fit: "cover",
  fps: 30,
  renderDpr: 0,
  volume: 0,
  scripts: true,
  mouse: true,
  pauseOnBlur: false,
  particles: "high",
  postProcessing: "high",
  rotate: { enabled: false, minutes: 15, order: "sequential", pool: "favorites" },
  // 外观
  glass: true,
  panelOpacity: 0.55,
  blur: 18,
  dim: 0.25,
  textShadow: true,
  transparentTitleBar: false,   // 旧开关（v0.10.1 及以前），读到 true 会换成 titleBarMode: "clear"
  titleBarMode: "off",          // v0.10.2 窗口右上角按钮那一条：off 不改 | match 跟随壁纸颜色 | clear 透明
  tbClear103: false,            // v0.10.3：原来选「跟随壁纸颜色」的，升级时换成「透明」一次（只换这一次）
  mig105: false,                // v0.10.5：弹窗默认不透明度从 0.8 提到 0.86（只改没动过的）
  zh: true,                     // v0.10.3 界面汉化（插件内置）
  cdpForPlugins: true,          // v0.10.7 打开本机调试端口，让猫猫桌宠这类插件能挂进界面（改了要重启 Antigravity）
  dialogOpacity: 0.55,          // v0.10.4 弹窗（设置页这类）的不透明度
  dialogBlur: 16,               // v0.10.6 弹窗的模糊（px）
  floatOpacity: 0.55,           // v0.10.6 浮层（模型选择和子菜单、下拉菜单、右键菜单、提示气泡）的不透明度
  floatBlur: 16,                // v0.10.6 浮层的模糊（px）
  mig106: false,                // v0.10.6：弹窗不透明度没手动改过（0.8 / 0.86）的换成 0.55
  composerRing: 0.12,           // v0.10.4 输入框外圈细线的不透明度
  zhExtra: "",                  // v0.10.3 补充翻译，每行「英文 = 中文」
  showButton: true,
  agentFx: "glow",              // none | glow | brighten
  glassBorder: true,
  bubbleOpacity: 0.45,          // 气泡 / 小卡片的最低不透明度
  contentOpacity: 0.3,          // 对话区 / 工作区阅读背板
  transition: "fade",           // fade | zoom | blur | slide | none
  transitionSec: 0.9,
  parallax: 0,                  // 视频 / 图片 / 网页壁纸的鼠标视差强度
  // 会话头像
  avatarsOn: true,
  avatarUser: null,             // null = 默认（文字）；文件路径；"url:data:..."；"pet" = 用挂件图片
  avatarAgent: "pet",           // 默认用挂件（你的桌宠）当 agent 头像
  avatarUserText: "我",
  avatarSize: 34,
  avatarShape: "circle",        // circle | rounded | none
  avatarStamp: 0,
  // agent 状态提示
  agentMood: true,
  moodText: { done: "完成啦～", attention: "需要你看一下", error: "好像出错了" },
  // 打字时专注
  focusMode: "none",            // none | dim | blur | pause
  focusStrength: 0.6,
  focusDelay: 2.5,
  // 自动切换
  schedule: { enabled: false, slots: [] },   // slots: [{ at: "07:00", ref: { kind, id } }]
  bindings: [],                 // [{ type: "conv" | "project", id, label, ref }]
  // 开屏动画
  splash: {
    enabled: true, style: "pet", theme: "auto", accent: "#8fb4ff",
    greeting: "{greet}，{name}", name: "", sub: "{date} · {weekday}",
    showQuote: true,
    quotes: "先跑起来，再变好看。\n小步快跑，及时提交。\n今天也要写出没有 bug 的代码。\n让 agent 跑着，你去喝口水。\n好的命名胜过一行注释。\n慢一点，就是快一点。",
    minSec: 1.8, maxSec: 6, onceADay: false, matchNative: true,
    media: null, mediaStamp: 0, mediaSound: false, mediaFit: "cover", lastDay: ""
  },
  // 自动重装
  autoFix: true,
  autoFixRestart: true,
  textHalo: 0.6,                // 文字描边强度
  haloColor: "auto",            // auto | light | dark
  dimMode: "auto",              // auto | darken | lighten
  clickFx: "none",              // none | ripple | sparkle | petal | heart
  trailFx: "none",              // none | glow | comet | sparkle
  fxColor: "#9ec5ff",
  fxRainbow: false,
  systemAudio: true,            // 系统音频频谱
  nowPlaying: true,             // 正在播放（Windows 媒体信息）
  glassTintOn: false,
  glassTint: "#161a24",
  glassForce: [],               // 手动点选要毛玻璃的元素（CSS 选择器）
  glassExclude: [],             // 手动点选不要毛玻璃的元素
  font: "",
  // 挂件玩偶
  pet: { image: null, size: 64, cord: 36, stamp: 0 },
  // 主题跟随壁纸
  themeFollow: false,           // 从当前壁纸取色：毛玻璃色调 + 强调色
  themeStrength: 0.6,           // 色调浓淡
  themeAccent: true,            // 选中文字、光标、特效、小组件也用壁纸的颜色
  palette: null,                // 最近一次从壁纸取到的颜色（开屏也用）
  // 迷你播放器
  miniPlayer: "card",           // card | pill | off
  miniHideIdle: true,           // 没在放歌时隐藏
  // 番茄钟
  pomo: {
    show: "auto", work: 25, short: 5, long: 15, every: 4, autoNext: false, overlay: true, badge: true, notify: true,
    workEndText: "专注结束，休息一下吧～", breakEndText: "休息好啦，继续加油！"
  },
  // 音效（全部现场合成）
  sfx: { on: true, volume: 0.5, pack: "soft", pet: true, done: true, attention: true, error: true, pomo: true, wall: true, typing: false, ui: true, remind: true, chime: true },
  // 挂件闲置动作
  petIdle: {
    on: true, freq: "mid", follow: true, sleepMin: 5, chatter: true, greet: true,
    lines: "要不要喝口水？\n站起来伸个懒腰吧～\n眼睛累了就看看远处\n我在这儿陪着你\n今天的代码也很漂亮！\n记得提交代码哦\n有 bug 也没关系，慢慢来"
  },
  // 打字特效
  typeFx: "none",               // none | spark | confetti | heart | char
  typeShake: false,
  typeCombo: false,
  // 快捷切换壁纸
  quickPool: "favorites",       // favorites | all
  petWheel: true,               // 在挂件上滚轮切换壁纸
  recent: [],                   // 最近用过的壁纸（快速切换面板用）
  // v0.8
  autoContrast: true,           // 字看不清时自动把背板调厚（只会比设定更厚）
  contrastTarget: 4.5,          // 目标对比度 3 / 4.5 / 7
  battery: { mode: "fps", fps: 15 },   // 用电池时：fps 降帧率 | pause 暂停 | none 不变
  flashOnDone: true,            // Antigravity 不在前台时，完成 / 需要确认 / 出错让任务栏图标闪
  agentTimer: true,             // 挂件下面显示 agent 已经跑了多久
  clock: { show: false, seconds: false, date: true, h12: false },
  outfits: [],                  // 挂件换装：[{ id, name, image }]，image 同 pet.image
  outfitRule: { enabled: false, slots: [] },   // 按时间换装：slots [{ at: "07:00", id }]
  safeMode: { auto: true },     // 连续两次没能正常启动时自动进入安全模式
  // v0.9
  typeFxCode: false,            // 在代码编辑器 / 终端里打字时也放打字特效
  blurFps: 0,                   // Antigravity 不在前台时把帧率降到多少（0 = 不变）
  moodOutfit: { busy: "", done: "", attention: "", error: "" },   // 不同状态换成衣柜里的哪一套（"" = 不换）
  remind: { water: 0, move: 0, notify: true },                    // 喝水 / 起来活动提醒，单位分钟，0 = 关
  chime: { on: false, from: 9, to: 22, sound: true },             // 整点报时
  todos: [],                    // 待办：[{ id, text, done, at }]
  note: "",                     // 便签
  widgets: { todo: false, note: false, calendar: false, sys: false, countdown: false },
  lowSpec: false,               // 低配模式：一键关掉特效、模糊和小动作，壁纸降画质
  // v0.10
  wallFx: { brightness: 1, contrast: 1, saturate: 1, temp: 0, vignette: 0, grain: 0, scan: 0 },   // 壁纸画面滤镜 / 后期叠加
  videoRate: 1,                 // 视频壁纸播放速度
  petPat: true,                 // 鼠标在挂件头上来回划 = 摸头
  doneConfetti: true,           // agent 完成时撒彩纸
  jumpBtns: true,               // 对话区「回到顶部 / 到底部」按钮
  charCount: true,              // 输入框字数
  countdowns: [],               // 倒数日：[{ id, name, date: "2026-02-17", yearly }]
  noise: { type: "rain", volume: 0.35, withPomo: false },          // 白噪音
  hotkeys: { settings: "Ctrl+Alt+W", quick: "Ctrl+Alt+Q", next: "Ctrl+Alt+]", prev: "Ctrl+Alt+[", pomo: "Ctrl+Alt+P", hide: "Ctrl+Alt+H" },
  // 每张壁纸自己的属性（Wallpaper Engine 里的"属性"面板）：{ "we:<id>": { name: value } }
  props: {},
  paused: false,
  relaxCsp: true
};

const LOOK_KEYS = ["themeFollow", "themeStrength", "themeAccent", "miniPlayer", "miniHideIdle", "typeFx", "typeShake", "typeCombo", "sfx", "petIdle", "petWheel", "agentMood", "moodText", "focusMode", "focusStrength", "focusDelay", "avatarsOn", "avatarUserText", "avatarSize", "avatarShape", "glass", "panelOpacity", "bubbleOpacity", "contentOpacity", "transition", "transitionSec", "parallax", "blur", "dim", "dimMode", "textShadow", "textHalo", "haloColor", "glassBorder", "glassTintOn", "glassTint",
  "glassForce", "glassExclude", "font", "fit", "agentFx", "clickFx", "trailFx", "fxColor", "fxRainbow", "transparentTitleBar", "titleBarMode", "showButton", "zh", "zhExtra", "cdpForPlugins", "dialogOpacity", "dialogBlur", "floatOpacity", "floatBlur", "composerRing",
  "autoContrast", "contrastTarget", "agentTimer", "flashOnDone", "clock", "typeFxCode", "wallFx", "petPat", "doneConfetti", "jumpBtns", "charCount"];

let configPath = null;
let config = null;
// v0.8 安全模式的状态（详见下面「安全模式」一节）
const safe = { on: false, reason: "", fails: 0, manual: false, begun: false };
let onBattery = false;

function cfgDir() { return path.join(app.getPath("userData"), "agywe"); }

// ---------------------------------------------------------------------------
// v0.10.1 配置瘦身：64 KB 以上的内嵌图片（url:data:...）存成 agywe\assets\ 里的文件，配置里只记路径
//   之前每拖一下滑块都要把几百 KB 的 base64 重新写一遍 config.json
// ---------------------------------------------------------------------------
const SPILL_MIN = 64 * 1024;
const DATA_EXT = { "image/png": ".png", "image/apng": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/svg+xml": ".svg", "image/bmp": ".bmp" };
function assetsDir() { return path.join(cfgDir(), "assets"); }
function spillDataUrl(v) {
  if (typeof v !== "string" || v.length < SPILL_MIN || !v.startsWith("url:data:")) return v;
  const m = /^url:data:([\w.+-]+\/[\w.+-]+)((?:;[^,;]*)*),/.exec(v.slice(0, 300));
  if (!m) return v;
  const ext = DATA_EXT[m[1].toLowerCase()];
  if (!ext) return v;
  let buf;
  try {
    const body = v.slice(m[0].length);
    buf = /;base64/i.test(m[2]) ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  } catch { return v; }
  if (!buf || !buf.length) return v;
  const file = path.join(assetsDir(), crypto.createHash("sha1").update(buf).digest("hex").slice(0, 24) + ext);
  try {
    fs.mkdirSync(assetsDir(), { recursive: true });
    if (!fs.existsSync(file) || fs.statSync(file).size !== buf.length) { fs.writeFileSync(file + ".tmp", buf); fs.renameSync(file + ".tmp", file); }
  } catch (e) { warn("spill image failed", e); return v; }
  return file;
}
function spillConfig(c) {
  if (!c || typeof c !== "object") return 0;
  let n = 0;
  const sp = (v) => { const r = spillDataUrl(v); if (r !== v) n++; return r; };
  if (c.pet && typeof c.pet === "object") { const r = sp(c.pet.image); if (r !== c.pet.image) c.pet = { ...c.pet, image: r }; }
  for (const k of ["avatarUser", "avatarAgent"]) { const r = sp(c[k]); if (r !== c[k]) c[k] = r; }
  if (Array.isArray(c.outfits)) c.outfits = c.outfits.map((o) => { if (!o || typeof o !== "object") return o; const r = sp(o.image); return r !== o.image ? { ...o, image: r } : o; });
  return n;
}

function loadConfig() {
  if (config) return config;
  configPath = path.join(cfgDir(), "config.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { }
  config = mergeConfig(DEFAULTS, saved);
  if (saved.transparentTitleBar === true && !saved.titleBarMode) config.titleBarMode = "clear";
  // v0.10.3：「跟随壁纸颜色」只能填一块纯色，壁纸有图案时看得出是个色块；透明之前一直没生效（颜色写法 Electron 不认），现在修好了，换过去一次
  if (!saved.mig106) {
    if (saved.dialogOpacity === undefined || saved.dialogOpacity === 0.8 || saved.dialogOpacity === 0.86) config.dialogOpacity = 0.55;
    config.mig105 = true; config.mig106 = true;
    try { fs.mkdirSync(cfgDir(), { recursive: true }); fs.writeFileSync(configPath + ".tmp", JSON.stringify(config, null, 2), "utf8"); fs.renameSync(configPath + ".tmp", configPath); } catch (e) { warn("config migrate failed", e); }
  }
  if (saved.titleBarMode === "match" && !saved.tbClear103) {
    config.titleBarMode = "clear"; config.tbClear103 = true;
    try { fs.mkdirSync(cfgDir(), { recursive: true }); fs.writeFileSync(configPath + ".tmp", JSON.stringify(config, null, 2), "utf8"); fs.renameSync(configPath + ".tmp", configPath); diagWrite("[titlebar] 「跟随壁纸颜色」换成「透明」（升级到 v0.10.3 时只换一次）"); } catch (e) { warn("config migrate failed", e); }
  }
  try {
    const n = spillConfig(config);
    if (n) {
      fs.mkdirSync(cfgDir(), { recursive: true });
      fs.writeFileSync(configPath + ".tmp", JSON.stringify(config, null, 2), "utf8");
      fs.renameSync(configPath + ".tmp", configPath);
      diagWrite(`[config] 把 ${n} 张内嵌大图存成了文件（agywe\\assets），config.json 变小了`);
    }
  } catch (e) { warn("config spill failed", e); }
  return config;
}

function mergeConfig(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue;
    if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...base[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function saveConfig(patch) {
  loadConfig();
  config = mergeConfig(config, patch);
  // 最近用过的壁纸（快速切换面板的「最近」）
  if (patch && patch.current && typeof patch.current === "object" && patch.current.id) {
    const k = patch.current.kind + ":" + patch.current.id;
    config.recent = [k, ...(config.recent || []).filter((x) => x !== k)].slice(0, 24);
  }
  try { spillConfig(config); } catch (e) { warn("config spill failed", e); }
  if (patch && ("nowPlaying" in patch || "battery" in patch)) { try { setTimeout(syncNowPlaying, 0); } catch { } }
  if (patch && "autoFix" in patch) { try { setTimeout(syncAutoFix, 0); } catch { } }
  if (patch && ("titleBarMode" in patch || "transparentTitleBar" in patch || "enabled" in patch)) { try { setTimeout(syncTitleBars, 0); } catch { } }
  await fsp.mkdir(cfgDir(), { recursive: true });
  const tmp = configPath + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
  await fsp.rename(tmp, configPath);
  return config;
}

// ---------------------------------------------------------------------------
// 找 Steam / Wallpaper Engine
// ---------------------------------------------------------------------------
function regQuery(key, name) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    execFile("reg", ["query", key, "/v", name], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const m = String(stdout).match(new RegExp(name + "\\s+REG_\\w+\\s+(.+)", "i"));
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function steamLibraries() {
  const roots = new Set();
  const candidates = [
    await regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath"),
    await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"),
    await regQuery("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"),
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam"
  ].filter(Boolean).map((p) => path.normalize(p.replace(/\//g, "\\")));
  for (const c of candidates) {
    if (!(await exists(c))) continue;
    roots.add(c.toLowerCase() === c ? c : c);
    try {
      const vdf = await fsp.readFile(path.join(c, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        roots.add(path.normalize(m[1].replace(/\\\\/g, "\\")));
      }
    } catch { }
  }
  // 去重（大小写不敏感）
  const seen = new Map();
  for (const r of roots) seen.set(r.toLowerCase(), r);
  return [...seen.values()];
}

let wePathsCache = null;
async function wePaths(force) {
  if (wePathsCache && !force) return wePathsCache;
  const libs = await steamLibraries();
  const workshop = [];
  const installs = [];
  for (const lib of libs) {
    const ws = path.join(lib, "steamapps", "workshop", "content", "431960");
    if (await exists(ws)) workshop.push(ws);
    const inst = path.join(lib, "steamapps", "common", "wallpaper_engine");
    if (await exists(inst)) installs.push(inst);
  }
  wePathsCache = { libs, workshop, installs, assets: null };
  for (const inst of installs) {
    const a = path.join(inst, "assets");
    if (await exists(a)) { wePathsCache.assets = a; break; }
  }
  return wePathsCache;
}

// ---------------------------------------------------------------------------
// 找正在运行的桌宠程序（只看程序名和路径，用来让「选择图片」直接打开它的文件夹）
// ---------------------------------------------------------------------------
const PET_RE = /pet|mascot|shimeji|desk.?(pet|mate|buddy)|companion|neko|catgirl|live2d|vpet|宠|看板/i;
const SKIP_DIR_RE = /^[a-z]:\\windows\\|\\windowsapps\\|\\microsoft\\edge|\\nvidia|\\amd\\|\\intel\\/i;
let petApps = [];
let procList = [];
function scanProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.Path } | ForEach-Object { $_.ProcessName + '|' + $_.Path }";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
      if (err && !stdout) { warn("process scan failed", err); return resolve([]); }
      const seen = new Map();
      for (const line of String(stdout || "").split(/\r?\n/)) {
        const i = line.indexOf("|"); if (i < 0) continue;
        const name = line.slice(0, i).trim(), exe = line.slice(i + 1).trim();
        if (!exe || SKIP_DIR_RE.test(exe)) continue;
        if (!seen.has(exe.toLowerCase())) seen.set(exe.toLowerCase(), { name, exe, dir: path.dirname(exe) });
      }
      resolve([...seen.values()]);
    });
  });
}
async function findPetApps() {
  procList = await scanProcesses();
  const hits = [];
  for (const p of procList) {
    if (/antigravity|language_server|electron/i.test(p.name)) continue;
    let hit = PET_RE.test(p.name) || PET_RE.test(p.dir);
    if (!hit) {
      // 程序名看不出来的，看看同目录里有没有一堆动图 / 精灵图文件夹
      try {
        const ents = await fsp.readdir(p.dir, { withFileTypes: true });
        hit = ents.some((e) => e.isDirectory() && /^(pets?|skins?|sprites?|characters?|models?|assets\\?pets?|mods)$/i.test(e.name)) && ents.length < 400;
      } catch { }
    }
    if (hit) hits.push(p);
  }
  petApps = hits.slice(0, 6);
  diagWrite({ petApps, processes: procList.map((p) => p.exe).slice(0, 120) });
  return petApps;
}

// ---------------------------------------------------------------------------
// 壁纸库
// ---------------------------------------------------------------------------
const SUPPORTED = new Set(["scene", "video", "web"]);
let library = null;            // { items, byId, scannedAt, paths }
let scanning = null;

function idFor(dir) { return crypto.createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 16); }

async function readProject(dir) {
  try {
    let txt = await fsp.readFile(path.join(dir, "project.json"), "utf8");
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
    return JSON.parse(txt);
  } catch { return null; }
}

async function scanContainer(container, source, out) {
  let entries = [];
  try { entries = await fsp.readdir(container, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
    const dir = path.join(container, e.name);
    await addItem(dir, source, out, e.name);
  }));
}

async function addItem(dir, source, out, folderName) {
  const proj = await readProject(dir);
  if (!proj) return false;
  const type = String(proj.type || "").toLowerCase();
  const id = idFor(dir);
  out.push({
    id,
    kind: "we",
    title: String(proj.title || folderName || path.basename(dir)),
    type,
    supported: SUPPORTED.has(type),
    preview: proj.preview ? String(proj.preview) : null,
    file: proj.file ? String(proj.file) : null,
    workshopId: proj.workshopid ? String(proj.workshopid) : (/^\d+$/.test(folderName || "") ? folderName : null),
    tags: Array.isArray(proj.tags) ? proj.tags.map(String) : [],
    rating: proj.contentrating ? String(proj.contentrating) : "",
    source,
    dir
  });
  return true;
}

async function scanLibrary(force) {
  if (library && !force) return library;
  if (scanning) return scanning;
  scanning = (async () => {
    const paths = await wePaths(force);
    const items = [];
    for (const ws of paths.workshop) await scanContainer(ws, "workshop", items);
    for (const inst of paths.installs) {
      await scanContainer(path.join(inst, "projects", "myprojects"), "myprojects", items);
      await scanContainer(path.join(inst, "projects", "defaultprojects"), "default", items);
    }
    const cfg = loadConfig();
    for (const extra of cfg.extraDirs || []) {
      if (await exists(path.join(extra, "project.json"))) await addItem(extra, "extra", items, path.basename(extra));
      else await scanContainer(extra, "extra", items);
    }
    const byId = new Map();
    for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
    const list = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    library = { items: list, byId, scannedAt: Date.now(), paths };
    try { logUnsupported(list); } catch { }
    return library;
  })();
  try { return await scanning; } finally { scanning = null; }
}

let unsupportedLogged = false;
async function logUnsupported(list) {
  if (unsupportedLogged) return; unsupportedLogged = true;
  const byType = new Map();
  for (const it of list) if (!it.supported) { const a = byType.get(it.type) || []; if (a.length < 3) a.push(it); byType.set(it.type, a); }
  const out = {};
  for (const [t, arr] of byType) {
    out[t || "?"] = [];
    for (const it of arr) {
      const proj = (await readProject(it.dir)) || {};
      let files = [];
      try { files = (await fsp.readdir(it.dir)).slice(0, 20); } catch { }
      const g = proj.general || {};
      out[t || "?"].push({ title: it.title, keys: Object.keys(proj), file: proj.file, preset: proj.preset ? JSON.stringify(proj.preset).slice(0, 400) : undefined, generalKeys: Object.keys(g), props: Object.keys(g.properties || {}).slice(0, 20), files });
    }
  }
  diagWrite({ unsupportedTypes: out, counts: [...byType.keys()].map((t) => [t, list.filter((i) => i.type === t).length]) });
}

let materialIndex = null;
async function buildMaterialIndex(assets) {
  if (materialIndex) return materialIndex;
  const names = [];
  const root = path.join(assets, "materials");
  async function walk(dir, rel) {
    let ents = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (/\.tex$/i.test(e.name)) names.push(r.replace(/\.tex$/i, ""));
    }
  }
  await walk(root, "");
  materialIndex = { names };
  return materialIndex;
}

// ---------------------------------------------------------------------------
// 协议处理
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".apng": "image/apng",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".glsl": "text/plain; charset=utf-8", ".frag": "text/plain; charset=utf-8", ".vert": "text/plain; charset=utf-8"
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";

const VIDEO_EXT = new Set([".mp4", ".m4v", ".webm", ".mov", ".mkv"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
  });
}

function insideDir(root, rel) {
  const full = path.resolve(root, rel);
  const r = path.resolve(root);
  if (full !== r && !full.toLowerCase().startsWith(r.toLowerCase() + path.sep)) return null;
  return full;
}

async function serveFile(file, request, { cors = false, cache = "no-cache" } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return new Response(null, { status: 404 }); }
  if (!st.isFile()) return new Response(null, { status: 404 });
  const headers = {
    "Content-Type": mimeOf(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  };
  if (cors) headers["Access-Control-Allow-Origin"] = "*";
  if (request.method === "HEAD") {
    headers["Content-Length"] = String(st.size);
    return new Response(null, { status: 200, headers });
  }
  const range = request.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : NaN;
      let end = m[2] ? parseInt(m[2], 10) : NaN;
      if (isNaN(start)) { start = Math.max(0, st.size - (isNaN(end) ? 0 : end)); end = st.size - 1; }
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${st.size}` } });
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
    }
  }
  headers["Content-Length"] = String(st.size);
  // 小文件直接读，大文件走流
  if (st.size < 8 * 1024 * 1024) {
    const buf = await fsp.readFile(file);
    return new Response(buf, { status: 200, headers });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

function publicItem(it) {
  const { dir, ...rest } = it;
  return { ...rest, folder: dir };
}

function customItems() {
  return (loadConfig().custom || []).map((c) => ({
    id: c.id, kind: "custom", title: c.title || path.basename(c.path), type: c.type, supported: true,
    preview: c.type === "image" ? "" : null, folder: c.path, source: "custom"
  }));
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function tokenOk(request) { return request.headers.get("x-agywe-token") === TOKEN; }

function focusedWin() {
  return BrowserWindow.getFocusedWindow() || undefined;
}

async function handleApi(sub, request, url) {
  const method = request.method;
  if (sub === "config" && method === "GET") return json(loadConfig());
  if (sub === "defaults" && method === "GET") return json(DEFAULTS);
  if (sub === "stats" && method === "GET") return json({ days: statsWindow(Math.max(1, Math.min(30, Number(url.searchParams.get("days")) || 7))) });
  if (sub === "info" && method === "GET") {
    const p = await wePaths(false);
    return json({ version: AGYWE_VERSION, app: app.getVersion(), electron: process.versions.electron, paths: p, configPath, petApps: petApps.map((x) => ({ name: x.name, dir: x.dir })), audioState, nowPlaying: npPublic(), npError, npSuspended, npMode: npUseFile ? "file" : "encoded", autofix: autofixInfo(),
      safe: { on: safe.on, reason: safe.reason, fails: safe.fails }, power: { battery: onBattery },
      notify: (() => { try { return !!(electron.Notification && electron.Notification.isSupported()); } catch { return false; } })(),
      hotkeys: { conflicts: hkConflicts, last: hkLast }, fuses: fuseInfo || await loadFuses() });
  }
  if (sub === "library" && method === "GET") {
    const lib = await scanLibrary(url.searchParams.get("refresh") === "1");
    return json({ items: [...lib.items.map(publicItem), ...customItems()], paths: lib.paths, scannedAt: lib.scannedAt });
  }
  // 当前壁纸的 project.json 属性（给「壁纸配置」页用）
  if (sub === "project" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    const lib = await scanLibrary(false);
    const it = lib.byId.get(id);
    if (!it) return json({ error: "not found" }, 404);
    const proj = (await readProject(it.dir)) || {};
    const general = proj.general && typeof proj.general === "object" ? proj.general : {};
    return json({
      id, title: it.title, type: it.type,
      properties: general.properties && typeof general.properties === "object" ? general.properties : {},
      localization: general.localization && typeof general.localization === "object" ? general.localization : {},
      description: typeof proj.description === "string" ? proj.description.slice(0, 2000) : ""
    });
  }
  // ---- 给 WebWallGL 用的系统接口（liveSystem）----
  if (sub === "system/media" && method === "GET") return json({ ...(npPublic() || { hasMedia: false }), audioState });
  if (sub === "system/artwork" && method === "GET") {
    if (!npArt) return new Response(null, { status: 404 });
    return new Response(npArt.buf, { status: 200, headers: { "Content-Type": npArt.type || "image/jpeg", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
  }
  if (sub === "system/media-control" && method === "POST") {
    const { action } = await readBody(request);
    await mediaControl(String(action || ""));
    return json({ ...(npPublic() || { hasMedia: false }), audioState });
  }
  if (sub.startsWith("system/")) return new Response(null, { status: 404 });
  // 以下接口会改动东西，需要令牌（只有 agywe 自己的页面拿得到）
  if (!tokenOk(request)) return json({ error: "forbidden" }, 403);
  if (sub === "config" && (method === "PUT" || method === "POST")) {
    const body = await readBody(request);
    return json(await saveConfig(body));
  }
  if (sub === "pick-pet" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: "选择挂件玩偶的图片（支持 GIF / APNG / WebP 动图）",
      defaultPath: petApps[0] ? petApps[0].dir : undefined,
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "gif", "webp", "apng", "jpg", "jpeg", "svg", "bmp"] }]
    });
    if (r.canceled || !r.filePaths[0]) return json(loadConfig());
    return json(await saveConfig({ pet: { image: r.filePaths[0], stamp: Date.now() } }));
  }
  if (sub === "pick-avatar" && method === "POST") {
    const { who } = await readBody(request);
    if (who !== "user" && who !== "agent") return json({ error: "bad who" }, 400);
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: who === "user" ? "选择你的头像" : "选择 agent 的头像",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "gif", "webp", "apng", "jpg", "jpeg", "svg", "bmp"] }]
    });
    if (r.canceled || !r.filePaths[0]) return json(loadConfig());
    return json(await saveConfig({ [who === "user" ? "avatarUser" : "avatarAgent"]: r.filePaths[0], avatarStamp: Date.now() }));
  }
  if (sub === "pick-splash-media" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: "选择开屏视频或动图",
      properties: ["openFile"],
      filters: [{ name: "视频 / 动图 / 图片", extensions: ["mp4", "webm", "m4v", "mov", "gif", "webp", "apng", "png", "jpg", "jpeg"] }]
    });
    if (r.canceled || !r.filePaths[0]) return json(loadConfig());
    return json(await saveConfig({ splash: { media: r.filePaths[0], mediaStamp: Date.now(), style: "media" } }));
  }
  if (sub === "reset-splash-media" && method === "POST") {
    const cur = (loadConfig().splash || {}).style;
    return json(await saveConfig({ splash: { media: null, mediaStamp: Date.now(), style: cur === "media" ? "pet" : cur } }));
  }
  if (sub === "reset-pet" && method === "POST") {
    return json(await saveConfig({ pet: { image: null, stamp: Date.now() } }));
  }
  if (sub === "export-preset" && method === "POST") {
    const r = await dialog.showSaveDialog(focusedWin(), { title: "导出外观预设", defaultPath: "agywe-外观预设.json", filters: [{ name: "外观预设", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return json({ ok: false });
    const cfg = loadConfig();
    const look = {};
    for (const k of LOOK_KEYS) if (k in cfg) look[k] = cfg[k];
    const pet = { size: cfg.pet.size, cord: cfg.pet.cord };
    try {
      const im = String(cfg.pet.image || "");
      if (im.startsWith("url:data:")) pet.image = im;
      else if (im && !im.startsWith("url:")) {
        const buf = await fsp.readFile(im);
        if (buf.length < 2.5 * 1024 * 1024) pet.image = "url:data:" + (mimeOf(im).split(";")[0]) + ";base64," + buf.toString("base64");
      }
    } catch { }
    look.pet = pet;
    await fsp.writeFile(r.filePath, JSON.stringify({ agyweLook: 1, version: AGYWE_VERSION, look }, null, 2), "utf8");
    return json({ ok: true, path: r.filePath });
  }
  if (sub === "import-preset" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), { title: "导入外观预设", properties: ["openFile"], filters: [{ name: "外观预设", extensions: ["json"] }] });
    if (r.canceled || !r.filePaths[0]) return json(loadConfig());
    let data;
    try { data = JSON.parse((await fsp.readFile(r.filePaths[0], "utf8")).replace(/^\uFEFF/, "")); } catch { return json({ error: "文件不是有效的外观预设" }, 400); }
    const look = data && typeof data.look === "object" ? data.look : data;
    const patch = {};
    for (const k of LOOK_KEYS) if (look && k in look && typeof look[k] === typeof DEFAULTS[k]) patch[k] = look[k];
    if (look && look.pet && typeof look.pet === "object") {
      patch.pet = { stamp: Date.now() };
      if (typeof look.pet.size === "number") patch.pet.size = look.pet.size;
      if (typeof look.pet.cord === "number") patch.pet.cord = look.pet.cord;
      if (typeof look.pet.image === "string" && /^url:data:image\//.test(look.pet.image)) patch.pet.image = look.pet.image;
    }
    return json(await saveConfig(patch));
  }
  if (sub === "add-files" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: "选择图片或视频",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "图片 / 视频", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "m4v", "mov", "mkv"] }
      ]
    });
    if (r.canceled) return json({ added: [] });
    const cfg = loadConfig();
    const custom = [...(cfg.custom || [])];
    const added = [];
    for (const f of r.filePaths) {
      const ext = path.extname(f).toLowerCase();
      const type = VIDEO_EXT.has(ext) ? "video" : IMAGE_EXT.has(ext) ? "image" : null;
      if (!type) continue;
      if (custom.some((c) => c.path.toLowerCase() === f.toLowerCase())) continue;
      const item = { id: idFor("custom:" + f), path: f, type, title: path.basename(f, ext) };
      custom.push(item); added.push(item);
    }
    await saveConfig({ custom });
    return json({ added });
  }
  if (sub === "remove-custom" && method === "POST") {
    const { id } = await readBody(request);
    const cfg = loadConfig();
    await saveConfig({ custom: (cfg.custom || []).filter((c) => c.id !== id) });
    return json({ ok: true });
  }
  if (sub === "add-folder" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: "选择 Wallpaper Engine 壁纸目录（单个项目或包含多个项目的文件夹）",
      properties: ["openDirectory"]
    });
    if (r.canceled || !r.filePaths[0]) return json({ added: null });
    const cfg = loadConfig();
    const dirs = [...new Set([...(cfg.extraDirs || []), r.filePaths[0]])];
    await saveConfig({ extraDirs: dirs });
    await scanLibrary(true);
    return json({ added: r.filePaths[0] });
  }
  if (sub === "remove-folder" && method === "POST") {
    const { dir } = await readBody(request);
    const cfg = loadConfig();
    await saveConfig({ extraDirs: (cfg.extraDirs || []).filter((d) => d !== dir) });
    await scanLibrary(true);
    return json({ ok: true });
  }
  if (sub === "pick-outfit" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), {
      title: "给挂件添加衣服（可以一次选好几张）",
      defaultPath: petApps[0] ? petApps[0].dir : undefined,
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "gif", "webp", "apng", "jpg", "jpeg", "svg", "bmp"] }]
    });
    if (r.canceled || !r.filePaths.length) return json(loadConfig());
    const outfits = [...(loadConfig().outfits || [])];
    for (const f of r.filePaths) {
      if (outfits.length >= 30) break;
      if (outfits.some((o) => o && o.image === f)) continue;
      outfits.push({ id: crypto.randomBytes(5).toString("hex"), name: path.basename(f, path.extname(f)).slice(0, 24), image: f });
    }
    return json(await saveConfig({ outfits }));
  }
  if (sub === "export-diag" && method === "POST") {
    const { quick, reveal } = await readBody(request);
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const def = path.join(PLUGIN_DIR && fs.existsSync(PLUGIN_DIR) ? PLUGIN_DIR : app.getPath("desktop"), `agywe-诊断报告-${stamp}.txt`);
    let target = def;
    if (!quick) {
      const r = await dialog.showSaveDialog(focusedWin(), { title: "导出诊断报告", defaultPath: def, filters: [{ name: "文本文件", extensions: ["txt"] }] });
      if (r.canceled || !r.filePath) return json({ ok: false });
      target = r.filePath;
    }
    try {
      const txt = await buildDiagReport();
      await fsp.writeFile(target, "\uFEFF" + txt, "utf8");
      diagWrite(`[diag] 导出诊断报告 ${target}（${txt.length} 字）`);
      if (reveal) { try { shell.showItemInFolder(target); } catch { } }
      return json({ ok: true, path: target, size: txt.length });
    } catch (e) { return json({ ok: false, error: String(e && e.message || e) }); }
  }
  if (sub === "test-notify" && method === "POST") {
    let ok = false;
    try {
      if (electron.Notification && electron.Notification.isSupported()) {
        new electron.Notification({ title: "agywe 测试通知", body: "能看到这条，说明 Windows 通知正常。" }).show();
        ok = true;
      }
    } catch (e) { warn("test notify failed", e); }
    return json({ ok });
  }
  if (sub === "hotkey-capture" && method === "POST") {
    const { on } = await readBody(request);
    hkCaptureUntil = on ? Date.now() + 20000 : 0;
    return json({ ok: true });
  }
  if (sub === "hotkey-check" && method === "POST") {
    const { combo, all } = await readBody(request);
    if (all) {
      const hk = { ...DEFAULTS.hotkeys, ...(loadConfig().hotkeys || {}) };
      const results = {};
      for (const a of HOTKEY_ACTIONS) {
        const p = hkParse(hk[a]);
        results[a] = { combo: hk[a] || "", state: !hk[a] ? "off" : !p || !hkAllowed(p) ? "invalid" : globalTaken(p) };
      }
      hkConflicts = Object.fromEntries(Object.entries(results).filter(([, r]) => r.state === "taken").map(([a, r]) => [a, r.combo]));
      return json({ results, last: hkLast });
    }
    const p = hkParse(combo);
    return json({ combo: hkFormat(p), state: !p || !hkAllowed(p) ? "invalid" : globalTaken(p) });
  }
  if (sub === "export-backup" && method === "POST") {
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const r = await dialog.showSaveDialog(focusedWin(), { title: "完整备份", defaultPath: path.join(app.getPath("documents"), `agywe-完整备份-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.json`), filters: [{ name: "agywe 备份", extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return json({ ok: false });
    try {
      const data = await buildBackup();
      const txt = JSON.stringify(data);
      await fsp.writeFile(r.filePath, txt, "utf8");
      diagWrite(`[backup] 导出 ${r.filePath}（${Math.round(txt.length / 1024)} KB，${Object.keys(data.files).length} 个文件）`);
      return json({ ok: true, path: r.filePath, size: txt.length, files: Object.keys(data.files).length, skipped: data.skipped });
    } catch (e) { return json({ ok: false, error: String(e && e.message || e) }); }
  }
  if (sub === "import-backup" && method === "POST") {
    const r = await dialog.showOpenDialog(focusedWin(), { title: "从备份恢复", properties: ["openFile"], filters: [{ name: "agywe 备份", extensions: ["json"] }] });
    if (r.canceled || !r.filePaths[0]) return json({ ok: false });
    try {
      const out = await restoreBackup(r.filePaths[0]);
      diagWrite(`[backup] 恢复 ${r.filePaths[0]} → ${out.error || "ok，文件 " + out.restored + " 个"}`);
      return json(out);
    } catch (e) { return json({ ok: false, error: String(e && e.message || e) }); }
  }
  if (sub === "safe-test" && method === "POST") {
    safe.manual = true;
    writeBoot({ manual: true, pending: false });
    safeEval("manual");
    setTimeout(() => { for (const h of liveHubs()) { try { h.reload(); } catch { } } }, 300);
    return json({ ok: true });
  }
  if (sub === "reveal" && method === "POST") {
    const { kind, id } = await readBody(request);
    let target = null;
    if (kind === "we") { const lib = await scanLibrary(false); target = lib.byId.get(id)?.dir; }
    else if (kind === "custom") target = (loadConfig().custom || []).find((c) => c.id === id)?.path;
    else if (kind === "config") target = cfgDir();
    if (target) { if (kind === "custom") shell.showItemInFolder(target); else await shell.openPath(target); }
    return json({ ok: !!target });
  }
  return json({ error: "not found" }, 404);
}

async function handleRequest(request) {
  let url;
  try { url = new URL(request.url); } catch { return new Response(null, { status: 400 }); }
  if (url.hostname !== "app") return new Response(null, { status: 404 });
  let p = decodeURIComponent(url.pathname);
  try {
    // 官方素材（WebWallGL 约定的 /api/local-assets 接口）
    if (p === "/api/local-assets" || p === "/api/local-assets/") {
      const wp = await wePaths(false);
      return json(wp.assets ? { ok: true, roots: [{ id: "we" }] } : { ok: false, roots: [] }, 200, { "Access-Control-Allow-Origin": "*" });
    }
    if (p.startsWith("/api/local-assets/we/")) {
      const wp = await wePaths(false);
      if (!wp.assets) return new Response(null, { status: 404 });
      const rel = p.slice("/api/local-assets/we/".length);
      if (rel === "materials/index.json") return json(await buildMaterialIndex(wp.assets), 200, { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" });
      const file = insideDir(wp.assets, rel);
      if (!file) return new Response(null, { status: 403 });
      return serveFile(file, request, { cors: true, cache: "max-age=3600" });
    }
    if (p.startsWith("/api/")) return await handleApi(p.slice(5), request, url);

    // 壁纸文件 /we/<id>/<相对路径>
    if (p.startsWith("/we/")) {
      const rest = p.slice(4);
      const slash = rest.indexOf("/");
      const id = slash < 0 ? rest : rest.slice(0, slash);
      const rel = slash < 0 ? "" : rest.slice(slash + 1);
      const lib = await scanLibrary(false);
      const it = lib.byId.get(id);
      if (!it || !rel) return new Response(null, { status: 404 });
      const file = insideDir(it.dir, rel);
      if (!file) return new Response(null, { status: 403 });
      return serveFile(file, request, { cors: true, cache: "max-age=600" });
    }
    // 自定义图片/视频 /custom/<id>
    if (p.startsWith("/custom/")) {
      const id = p.slice(8).split("/")[0];
      const c = (loadConfig().custom || []).find((x) => x.id === id);
      if (!c) return new Response(null, { status: 404 });
      return serveFile(c.path, request, { cors: true, cache: "max-age=600" });
    }
    // 开屏：当前壁纸的预览图 / 自定义开屏视频
    if (p === "/splash-preview") {
      const cfg = loadConfig();
      const ref = timeRuleMain(cfg) || cfg.current;
      if (!ref) return new Response(null, { status: 404 });
      if (ref.kind === "custom") {
        const c = (cfg.custom || []).find((x) => x.id === ref.id);
        if (!c || c.type !== "image") return new Response(null, { status: 404 });
        return serveFile(c.path, request, { cors: true, cache: "no-cache" });
      }
      const lib = await scanLibrary(false);
      const it = lib.byId.get(ref.id);
      if (!it || !it.preview) return new Response(null, { status: 404 });
      const file = insideDir(it.dir, it.preview);
      if (!file) return new Response(null, { status: 403 });
      return serveFile(file, request, { cors: true, cache: "no-cache" });
    }
    if (p === "/splash-media") {
      const m = (loadConfig().splash || {}).media;
      if (!m || typeof m !== "string") return new Response(null, { status: 404 });
      if (!SPLASH_EXT.has(path.extname(m).toLowerCase())) return new Response(null, { status: 403 });
      return serveFile(m, request, { cors: true, cache: "no-cache" });
    }
    // 会话头像图片 /avatar/user  /avatar/agent
    if (p === "/avatar/user" || p === "/avatar/agent") {
      const v = loadConfig()[p.endsWith("user") ? "avatarUser" : "avatarAgent"];
      if (!v || typeof v !== "string" || v === "pet" || v.startsWith("url:")) return new Response(null, { status: 404 });
      const ext = path.extname(v).toLowerCase();
      if (![".png", ".gif", ".webp", ".apng", ".jpg", ".jpeg", ".svg", ".bmp"].includes(ext)) return new Response(null, { status: 403 });
      return serveFile(v, request, { cors: true, cache: "max-age=86400" });
    }
    // 挂件换装的图片 /outfit/<id>（设置页缩略图用）
    if (p.startsWith("/outfit/")) {
      const id = p.slice(8).split("/")[0];
      const o = (loadConfig().outfits || []).find((x) => x && x.id === id);
      const im = o && typeof o.image === "string" ? o.image : "";
      if (!im || im.startsWith("url:")) return new Response(null, { status: 404 });
      const ext = path.extname(im).toLowerCase();
      if (![".png", ".gif", ".webp", ".apng", ".jpg", ".jpeg", ".svg", ".bmp"].includes(ext)) return new Response(null, { status: 403 });
      return serveFile(im, request, { cors: true, cache: "max-age=86400" });
    }
    // 挂件玩偶图片 /pet-image
    if (p === "/pet-image") {
      const pet = loadConfig().pet || {};
      if (!pet.image) return new Response(null, { status: 404 });
      const ext = path.extname(pet.image).toLowerCase();
      if (![".png", ".gif", ".webp", ".apng", ".jpg", ".jpeg", ".svg", ".bmp"].includes(ext)) return new Response(null, { status: 403 });
      return serveFile(pet.image, request, { cors: true, cache: "max-age=86400" });
    }
    // 插件自己的页面
    if (p === "/" || p === "") p = "/index.html";
    const file = insideDir(APP_DIR, p.replace(/^\/+/, ""));
    if (!file) return new Response(null, { status: 403 });
    if (/\.html$/i.test(file)) {
      let html;
      try { html = await fsp.readFile(file, "utf8"); } catch { return new Response(null, { status: 404 }); }
      html = html.replace(/__AGYWE_TOKEN__/g, TOKEN).replace(/__AGYWE_VERSION__/g, AGYWE_VERSION);
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return serveFile(file, request, { cors: false, cache: "no-cache" });
  } catch (e) {
    warn("request failed", p, e);
    return new Response(String(e && e.message || e), { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 放宽 Hub 页面的 CSP：只给 frame-src / child-src 加上 agywe:
// （协议本身已注册 bypassCSP，这里是兜底）
// ---------------------------------------------------------------------------
function relaxCsp(value) {
  const parts = String(value).split(";").map((s) => s.trim()).filter(Boolean);
  const names = parts.map((d) => d.split(/\s+/)[0].toLowerCase());
  const addTo = (i) => {
    let toks = parts[i].split(/\s+/);
    toks = toks.filter((t) => t !== "'none'");
    if (!toks.includes(SCHEME + ":")) toks.push(SCHEME + ":");
    parts[i] = toks.join(" ");
  };
  let touched = false;
  ["frame-src", "child-src"].forEach((d) => { const i = names.indexOf(d); if (i >= 0) { addTo(i); touched = true; } });
  if (!touched) {
    const di = names.indexOf("default-src");
    if (di >= 0) {
      const src = parts[di].split(/\s+/).slice(1).filter((t) => t !== "'none'");
      parts.push(["frame-src", ...src, SCHEME + ":"].join(" "));
    }
  }
  return parts.join("; ");
}

function installCspRelax() {
  try {
    const ses = session.defaultSession;
    ses.webRequest.onHeadersReceived({ urls: ["https://127.0.0.1/*", "https://localhost/*", "http://127.0.0.1/*", "http://localhost/*"] }, (details, callback) => {
      try {
        if (details.resourceType !== "mainFrame" || !loadConfig().relaxCsp) return callback({});
        const headers = details.responseHeaders || {};
        let changed = false;
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === "content-security-policy") {
            headers[k] = headers[k].map(relaxCsp);
            changed = true;
          }
        }
        callback(changed ? { responseHeaders: headers } : {});
      } catch { callback({}); }
    });
  } catch (e) { warn("csp relax failed", e); }
}

// ---------------------------------------------------------------------------
// 系统音频：给壁纸页的 getDisplayMedia 只放行"电脑正在播放的声音"（loopback），不录麦克风
// 只在 agywe 自己发起请求的那几秒放行，其它页面的屏幕共享请求照旧拒绝（Antigravity 本身没有用这个接口）
// ---------------------------------------------------------------------------
let audioState = "off";
let audioArmUntil = 0;
function installDisplayMedia() {
  try {
    ipcMain.on("agywe:audio-arm", () => { audioArmUntil = Date.now() + 5000; });
    ipcMain.on("agywe:audio-state", (_e, st) => { audioState = ["live", "off", "denied", "unavailable"].includes(st) ? st : "off"; });
    const ses = session.defaultSession;
    if (typeof ses.setDisplayMediaRequestHandler !== "function") { warn("setDisplayMediaRequestHandler 不可用"); return; }
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const armed = Date.now() < audioArmUntil;
      audioArmUntil = 0;
      if (!armed || !loadConfig().systemAudio) { try { callback({}); } catch { } return; }
      desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((srcs) => {
          if (!srcs || !srcs[0]) { diagWrite("[audio] 没有可用的屏幕源"); return callback({}); }
          diagWrite("[audio] 放行系统音频（loopback）");
          callback({ video: srcs[0], audio: "loopback" });
        })
        .catch((e) => { warn("desktopCapturer failed", e); try { callback({}); } catch { } });
    });
  } catch (e) { warn("display media handler failed", e); }
}

// ---------------------------------------------------------------------------
// 正在播放（Windows 系统媒体信息 SMTC）：常驻一个 PowerShell，每秒输出一行 JSON
// ---------------------------------------------------------------------------
const PS_HEAD = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$asTaskG = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  "function Await($op, [Type]$t) { $task = $asTaskG.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(5000); if ($task.IsCompleted) { $task.Result } else { $null } }",
  "$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]",
  "$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]",
  "$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]",
  "$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])"
];
const PS_LOOP = [
  "$lastKey = ''",
  "while ($true) {",
  "  try {",
  "    $s = $mgr.GetCurrentSession()",
  "    if ($null -eq $s) { [Console]::Out.WriteLine('{\"hasMedia\":false}') }",
  "    else {",
  "      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])",
  "      $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()",
  "      $st = [int]$pb.PlaybackStatus",
  "      $state = 0; if ($st -eq 4) { $state = 1 } elseif ($st -eq 5) { $state = 2 }",
  "      $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds",
  "      $pos = $tl.Position.TotalSeconds",
  "      if ($state -eq 1) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }",
  "      if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }",
  "      $o = [ordered]@{ hasMedia = $true; state = $state; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle; albumArtist = [string]$p.AlbumArtist; position = [math]::Round([math]::Max(0, $pos), 2); duration = [math]::Round([math]::Max(0, $dur), 2); app = [string]$s.SourceAppUserModelId; hasArtwork = ($null -ne $p.Thumbnail) }",
  "      $key = $o.title + '|' + $o.artist + '|' + $o.album",
  "      if ($key -ne $lastKey) {",
  "        $lastKey = $key",
  "        if ($null -ne $p.Thumbnail) {",
  "          try {",
  "            $rs = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])",
  "            $n = [uint32]$rs.Size",
  "            if ($n -gt 0 -and $n -lt 4000000) {",
  "              $dr = [Windows.Storage.Streams.DataReader]::new($rs)",
  "              $null = Await ($dr.LoadAsync($n)) ([uint32])",
  "              $bytes = New-Object byte[] $n; $dr.ReadBytes($bytes)",
  "              $o.thumb = [Convert]::ToBase64String($bytes); $o.thumbType = [string]$rs.ContentType",
  "              $dr.Dispose()",
  "            }",
  "            $rs.Dispose()",
  "          } catch { $o.thumbError = [string]$_.Exception.Message }",
  "        }",
  "      }",
  "      [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))",
  "    }",
  "  } catch { [Console]::Out.WriteLine('{\"error\":' + (ConvertTo-Json ([string]$_.Exception.Message) -Compress) + '}') }",
  "  [Console]::Out.Flush()",
  "  Start-Sleep -Milliseconds 1000",
  "}"
];
const encPs = (lines) => Buffer.from(lines.join("\r\n"), "utf16le").toString("base64");
let np = null, npArt = null, npError = "", npProc = null, npRestarts = 0, npStopped = false;
function npPublic() {
  if (!np) return null;
  const { thumb, thumbType, thumbError, ...rest } = np;
  return { ...rest, hasArtwork: !!npArt && !!np.hasArtwork };
}
// v0.10.1：脚本先写成 agywe\media-helper.ps1 再用 -File 启动（-EncodedCommand 容易被杀毒软件拦）；
// -File 起不来时自动退回 -EncodedCommand
let npUseFile = true, npSuspended = "";
function psScriptFile(name, lines) {
  try {
    const f = path.join(cfgDir(), name);
    const body = "\uFEFF" + lines.join("\r\n") + "\r\n";
    let same = false;
    try { same = fs.readFileSync(f, "utf8") === body; } catch { }
    if (!same) { fs.mkdirSync(cfgDir(), { recursive: true }); fs.writeFileSync(f, body, "utf8"); }
    return f;
  } catch (e) { warn("write ps script failed", name, e); return null; }
}
function psArgs(name, lines, extra) {
  const base = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
  const f = npUseFile ? psScriptFile(name, lines) : null;
  if (f) return { args: [...base, "-File", f, ...(extra || [])], file: true };
  return { args: [...base, "-EncodedCommand", encPs(lines)], file: false };
}
// 用不着的时候别让 PowerShell 常驻：关了「正在播放」、安全模式、所有窗口都最小化 / 隐藏、用电池且设成暂停壁纸
function npWantReason() {
  const c = loadConfig();
  if (!c.nowPlaying) return "off";
  if (safe.on) return "safe";
  if (onBattery && ((c.battery || {}).mode === "pause")) return "battery";
  if (npAllHidden) return "hidden";
  return "";
}
let npAllHidden = false, npHideT = 0;
function npCheckWindows() {
  let visible = false;
  try { for (const w of BrowserWindow.getAllWindows()) { try { if (!w.isDestroyed() && w.isVisible() && !w.isMinimized()) { visible = true; break; } } catch { } } } catch { visible = true; }
  clearTimeout(npHideT);
  if (visible) { if (npAllHidden) { npAllHidden = false; syncNowPlaying(); } return; }
  npHideT = setTimeout(() => { npAllHidden = true; syncNowPlaying(); }, 30000);   // 最小化半分钟后再停，免得来回切的时候反复起停
}
// ---- v0.10.2 标题栏：窗口右上角最小化 / 最大化 / 关闭那一条是 Electron 自己画的（titleBarOverlay），
// 不在网页里，毛玻璃碰不到。这里在主进程直接改它的底色：
//   match = 用界面算好的「这一条底下实际的颜色」填（agywe:tb-color），clear = 完全透明（有的电脑会变成纯黑）
const tbOrig = new WeakMap();      // win -> Antigravity 自己最后一次设的 { color, symbolColor, height }
const tbTouched = new WeakSet();   // 我们改过的窗口（关掉时才需要还原）
const tbMatch = { color: null, symbol: null };
let tbLog = 0;
const tbDiag = (s) => { if (tbLog++ < 40) diagWrite("[titlebar] " + s); };
function tbMode() { const c = loadConfig(); if (!c.enabled || safe.on) return "off"; return c.titleBarMode === "match" || c.titleBarMode === "clear" ? c.titleBarMode : "off"; }
function tbTarget() {
  const m = tbMode();
  // v0.10.3：Electron 只认 #rrggbb / rgba()，以前写的 #00000000 会被当成错误直接拒掉，所以「完全透明」从来没生效过
  if (m === "clear") return { color: "rgba(0, 0, 0, 0)", ...(tbMatch.symbol ? { symbolColor: tbMatch.symbol } : {}) };
  if (m === "match" && tbMatch.color) return { color: tbMatch.color, symbolColor: tbMatch.symbol };
  return null;
}
try {
  const proto = BrowserWindow && BrowserWindow.prototype;
  const origSet = proto && proto.setTitleBarOverlay;
  if (typeof origSet === "function") {
    proto.setTitleBarOverlay = function (opts) {
      let o = opts;
      try {
        if (opts && typeof opts === "object" && !opts.__agywe) {
          tbOrig.set(this, { ...(tbOrig.get(this) || {}), ...opts });
          const tg = tbTarget();
          if (tg) { o = { ...opts, ...tg }; tbTouched.add(this); }
          tbDiag(`Antigravity 设置 ${JSON.stringify(opts).slice(0, 120)} → ${tg ? "改成 " + JSON.stringify(tg) : "不改"}`);
        }
        if (o && o.__agywe) { o = { ...o }; delete o.__agywe; }
      } catch { }
      return origSet.call(this, o);
    };
    tbDiag("已接管 setTitleBarOverlay");
  } else tbDiag("这个 Electron 没有 setTitleBarOverlay");
} catch (e) { warn("titlebar hook failed", e); }
function applyTitleBar(win) {
  try {
    if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== "function") return;
    const tg = tbTarget(), o = tbOrig.get(win);
    if (tg) { win.setTitleBarOverlay({ __agywe: true, ...tg }); tbTouched.add(win); tbDiag(`窗口 ${win.id} → ${JSON.stringify(tg)}`); }
    else if (tbTouched.has(win) && o && o.color) { win.setTitleBarOverlay({ __agywe: true, color: o.color, ...(o.symbolColor ? { symbolColor: o.symbolColor } : {}) }); tbTouched.delete(win); tbDiag(`窗口 ${win.id} 还原 ${o.color}`); }
  } catch (e) { tbDiag(`窗口设置失败：${e && e.message || e}`); }
}
function syncTitleBars() { try { for (const w of BrowserWindow.getAllWindows()) applyTitleBar(w); } catch { } }
try {
  ipcMain.on("agywe:tb-color", (e, v) => {
    try {
      const ok = (s) => /^#[0-9a-f]{6}$/i.test(String(s || ""));
      if (!v || !ok(v.color) || !ok(v.symbol)) return;
      tbMatch.color = v.color; tbMatch.symbol = v.symbol;
      if (tbMode() !== "off") applyTitleBar(BrowserWindow.fromWebContents(e.sender));
    } catch { }
  });
} catch { }
try {
  app.on("browser-window-created", (_e, w) => {
    try { for (const ev of ["minimize", "restore", "hide", "show", "closed"]) w.on(ev, () => setTimeout(npCheckWindows, 50)); } catch { }
    try { w.webContents.on("did-finish-load", () => { if (tbTarget()) applyTitleBar(w); }); w.once("ready-to-show", () => { if (tbTarget()) applyTitleBar(w); }); } catch { }
  });
} catch { }
function startNowPlaying() {
  if (process.platform !== "win32" || npProc || npStopped || safe.on) return;
  if (npWantReason()) return;
  const { spawn } = require("child_process");
  let child, viaFile = false;
  try {
    const a = psArgs("media-helper.ps1", [...PS_HEAD, ...PS_LOOP]);
    viaFile = a.file;
    child = spawn("powershell.exe", a.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { npError = String(e && e.message || e); warn("now playing spawn failed", e); return; }
  npProc = child;
  const t0 = Date.now();
  let buf = "", errBuf = "", lines = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (lines++ === 0) diagWrite({ nowPlayingFirst: { ...o, thumb: o.thumb ? o.thumb.length : undefined } });
      if (o.error) { npError = String(o.error); continue; }
      npError = "";
      if (o.thumb) { try { npArt = { buf: Buffer.from(o.thumb, "base64"), type: o.thumbType || "image/jpeg" }; } catch { } }
      if (!o.hasMedia) npArt = null;
      else if (np && (np.title !== o.title || np.artist !== o.artist || np.album !== o.album) && !o.thumb) npArt = null;
      np = o;
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { if (errBuf.length < 4000) errBuf += d; });
  child.on("exit", (code) => {
    if (npProc === child) npProc = null;
    if (errBuf) { npError = errBuf.trim().slice(0, 500); diagWrite({ nowPlayingExit: code, stderr: errBuf.slice(0, 2000) }); }
    if (viaFile && !lines && Date.now() - t0 < 15000 && !npStopped) { npUseFile = false; diagWrite("[np] -File 方式没起来，改用 -EncodedCommand"); }
    if (!npStopped && npRestarts++ < 5) setTimeout(startNowPlaying, 5000 * npRestarts);
  });
}
function stopNowPlaying() { npStopped = true; try { npProc && npProc.kill(); } catch { } npProc = null; np = null; npArt = null; }
const MEDIA_ACTIONS = { playPause: "TryTogglePlayPauseAsync", play: "TryPlayAsync", pause: "TryPauseAsync", skipNext: "TrySkipNextAsync", skipPrevious: "TrySkipPreviousAsync" };
function mediaControl(action) {
  const m = MEDIA_ACTIONS[action];
  if (!m || process.platform !== "win32") return Promise.resolve(false);
  // 动作名经过白名单（MEDIA_ACTIONS），脚本里再校验一次
  const fileLines = ["param([string]$Action = '')", "if ($Action -notmatch '^Try(TogglePlayPause|Play|Pause|SkipNext|SkipPrevious)Async$') { exit 2 }", ...PS_HEAD, "$s = $mgr.GetCurrentSession()", "if ($null -ne $s) { $null = Await ($s.$Action()) ([bool]) }"];
  const encLines = [...PS_HEAD, "$s = $mgr.GetCurrentSession()", "if ($null -ne $s) { $null = Await ($s." + m + "()) ([bool]) }"];
  const f = npUseFile ? psScriptFile("media-control.ps1", fileLines) : null;
  const args = f ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f, "-Action", m] : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encPs(encLines)];
  return new Promise((resolve) => {
    execFile("powershell.exe", args, { windowsHide: true, timeout: 8000 }, (err) => {
      if (err) warn("media control failed", action, err.message);
      resolve(!err);
    });
  });
}
try { app.on("before-quit", stopNowPlaying); } catch { }
// 设置里开关「正在播放」后跟着起停
function syncNowPlaying() {
  const why = npWantReason();
  if (!why) { if (npSuspended) diagWrite(`[np] 恢复后台（之前因为 ${npSuspended} 停着）`); npSuspended = ""; npStopped = false; npRestarts = 0; startNowPlaying(); }
  else {
    if ((npProc || np) && why !== "off") diagWrite(`[np] 停掉后台 PowerShell：${why}`);
    npSuspended = why === "off" ? "" : why;
    if (npProc || np) stopNowPlaying(); else npStopped = true;
  }
}

// ---------------------------------------------------------------------------
// v0.7 迷你播放器 / 番茄钟 / 主题取色：页面里的 preload 直接走 IPC（页面和 agywe:// 跨域，fetch 不了）
// ---------------------------------------------------------------------------
let npArtKey = 0, npArtRef = null;
try {
  ipcMain.handle("agywe:np", () => {
    if (!loadConfig().nowPlaying) return { off: true, hasMedia: false };
    if (npArt !== npArtRef) { npArtRef = npArt; npArtKey++; }
    const p = npPublic();
    return p ? { ...p, artKey: npArt ? npArtKey : 0 } : { hasMedia: false, error: npError || "" };
  });
  ipcMain.handle("agywe:np-art", () => {
    if (!npArt) return null;
    try { return "data:" + (npArt.type || "image/jpeg") + ";base64," + npArt.buf.toString("base64"); } catch { return null; }
  });
  ipcMain.handle("agywe:np-control", async (_e, action) => !!(await mediaControl(String(action || ""))));
  ipcMain.on("agywe:notify", (_e, n) => {
    try {
      if (!n || !electron.Notification || !electron.Notification.isSupported()) return;
      new electron.Notification({ title: String(n.title || "Antigravity").slice(0, 80), body: String(n.body || "").slice(0, 200), silent: true }).show();
    } catch (e) { warn("notify failed", e); }
  });
  ipcMain.on("agywe:palette", (_e, pal) => {
    try {
      if (!pal || typeof pal !== "object") return;
      const ok = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));
      if (!ok(pal.accent) || !ok(pal.dominant)) return;
      const cur = loadConfig().palette || {};
      if (cur.accent === pal.accent && cur.dominant === pal.dominant) return;
      saveConfig({ palette: { accent: pal.accent, dominant: pal.dominant, dark: !!pal.dark } }).catch(() => { });
    } catch { }
  });
} catch (e) { warn("v0.7 ipc failed", e); }

// ---------------------------------------------------------------------------
// 自动重装：Antigravity 自动更新会换掉 app.asar，插件就没了
//  - 开机检查：HKCU\...\Run 里登记 autofix.ps1 -Mode logon
//  - 更新守候：Antigravity 退出去装更新时，启动一个独立的 PowerShell（不是 Antigravity.exe，不会占住要更新的文件），
//    等更新装完再把插件装回去
// ---------------------------------------------------------------------------
const PLUGIN_DIR = (() => { try { const la = process.env.LOCALAPPDATA; return la ? path.join(la, "Programs", "agywe-wallpaper") : null; } catch { return null; } })();
// v0.10.2：把 Antigravity.exe 的实际位置记到插件文件夹里（antigravity-path.txt），
// 装在别的盘 / 别的目录时，几个 .cmd 和自动重装靠它找到程序（findag.ps1 会读）
function rememberExePath() {
  try {
    if (!PLUGIN_DIR || !fs.existsSync(PLUGIN_DIR)) return;
    const exe = process.execPath;
    if (!exe || !/antigravity\.exe$/i.test(exe)) return;
    const f = path.join(PLUGIN_DIR, "antigravity-path.txt");
    let old = ""; try { old = fs.readFileSync(f, "utf8").trim(); } catch { }
    if (old !== exe) { fs.writeFileSync(f, exe, "utf8"); diagWrite(`[path] 记下 Antigravity 位置 ${exe.length} 字符`); }
  } catch (e) { warn("remember exe path failed", e); }
}
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME = "agywe-autofix";
const autofixScript = () => (PLUGIN_DIR ? path.join(PLUGIN_DIR, "autofix.ps1") : null);
function syncAutoFix() {
  if (process.platform !== "win32") return;
  const ps1 = autofixScript();
  const want = !!loadConfig().autoFix && !!ps1 && fs.existsSync(ps1);
  const val = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1}" -Mode logon`;
  execFile("reg", ["query", RUN_KEY, "/v", RUN_NAME], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
    const has = !err && String(stdout || "").includes(RUN_NAME);
    const same = has && ps1 && String(stdout || "").toLowerCase().includes(ps1.toLowerCase());
    if (want && !same) execFile("reg", ["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", val, "/f"], { windowsHide: true, timeout: 5000 }, (e) => diagWrite(`[autofix] 开机检查${e ? "登记失败 " + e.message : "已登记"}`));
    else if (!want && has) execFile("reg", ["delete", RUN_KEY, "/v", RUN_NAME, "/f"], { windowsHide: true, timeout: 5000 }, (e) => diagWrite(`[autofix] 开机检查${e ? "取消失败 " + e.message : "已取消"}`));
  });
}
let updatePending = false;
function watchUpdater() {
  try { electron.autoUpdater.on("before-quit-for-update", () => { updatePending = true; diagWrite("[autofix] before-quit-for-update"); }); } catch { }
  try {
    const { autoUpdater } = require("electron-updater");   // 和 Antigravity 自己用的是同一个实例
    autoUpdater.on("update-downloaded", (i) => { updatePending = true; diagWrite(`[autofix] 已下载更新 ${i && i.version}`); });
  } catch (e) { warn("electron-updater hook failed", e); }
}
function spawnWatcher(mode) {
  const ps1 = autofixScript();
  if (process.platform !== "win32" || !ps1 || !fs.existsSync(ps1)) return;
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Mode", mode],
      { detached: true, stdio: "ignore", windowsHide: true, env, cwd: PLUGIN_DIR });
    child.unref();
    diagWrite(`[autofix] 已启动更新守候（pid ${child.pid}）`);
  } catch (e) { warn("spawn autofix failed", e); }
}
try {
  app.on("will-quit", () => {
    try {
      let pending = updatePending;
      try { const { autoUpdater } = require("electron-updater"); if (autoUpdater && autoUpdater.quitAndInstallCalled) pending = true; } catch { }
      if (pending && loadConfig().autoFix) spawnWatcher("update");
    } catch { }
  });
} catch { }
function autofixInfo() {
  const out = { on: !!loadConfig().autoFix, last: [] };
  try {
    const f = PLUGIN_DIR && path.join(PLUGIN_DIR, "autofix.log");
    if (f && fs.existsSync(f)) out.last = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(-3);
  } catch { }
  return out;
}

// ---------------------------------------------------------------------------
// 开屏动画：hub 页面的 preload 一开始就用同步 IPC 来问"这次要不要播、怎么播"
// 一定要回复（finally），否则页面会卡住
// ---------------------------------------------------------------------------
const SPLASH_EXT = new Set([".mp4", ".webm", ".m4v", ".mov", ".gif", ".webp", ".apng", ".png", ".jpg", ".jpeg"]);
const SPLASH_STYLES = ["pet", "curtain", "minimal", "media"];
const SPLASH_BG = { dark: "#0c0d13", light: "#ece7df" };
let splashUsed = false;
function splashConf() { return { ...DEFAULTS.splash, ...((loadConfig() || {}).splash || {}) }; }
function splashTheme(sp) {
  if (sp.theme === "dark" || sp.theme === "light") return sp.theme;
  try { return electron.nativeTheme && electron.nativeTheme.shouldUseDarkColors ? "dark" : "light"; } catch { return "dark"; }
}
const safeColor = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? String(c) : d);
function splashAccent(sp) { const c = loadConfig(); return (c.themeFollow && c.palette && safeColor(c.palette.accent, null)) || safeColor(sp.accent, "#8fb4ff"); }
function todayStr() { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function slotDayOk(days, wd) {
  if (Array.isArray(days)) return days.includes(wd);
  if (days === "weekday") return wd >= 1 && wd <= 5;
  if (days === "weekend") return wd === 0 || wd === 6;
  return true;
}
// 按时间（可以限定工作日 / 周末）：今天已经过了的最后一个时间点；今天还没到第一个，就往前一天找
function pickSlot(slots, valid) {
  const toMin = (x) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(x || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const list = (slots || []).map((x) => ({ ...x, m: toMin(x && x.at) })).filter((x) => x.m !== null && (!valid || valid(x)));
  if (!list.length) return null;
  const now = new Date(), t = now.getHours() * 60 + now.getMinutes();
  for (let back = 0; back < 8; back++) {
    const wd = (now.getDay() - back + 70) % 7;
    const c = list.filter((x) => slotDayOk(x.days, wd) && (back > 0 || x.m <= t)).sort((a, b) => a.m - b.m);
    if (c.length) return c[c.length - 1];
  }
  return null;
}
function timeRuleMain(cfg) {
  const sc = cfg && cfg.schedule;
  if (!sc || !sc.enabled || !Array.isArray(sc.slots)) return null;
  const pick = pickSlot(sc.slots, (x) => !!x.ref);
  return pick ? pick.ref : null;
}
function splashSkippedToday(sp) { return !!(sp.onceADay && sp.lastDay === todayStr()); }
function splashData(opts) {
  const preview = !!(opts && opts.preview);
  const cfg = loadConfig();
  const sp = splashConf();
  if (!preview) {
    if (!sp.enabled || splashUsed || safe.on) return { show: false };
    splashUsed = true;
    if (splashSkippedToday(sp)) return { show: false };
    if (sp.onceADay) saveConfig({ splash: { lastDay: todayStr() } }).catch(() => { });
  }
  let style = SPLASH_STYLES.includes(sp.style) ? sp.style : "pet";
  let media = null;
  if (style === "media") {
    const m = typeof sp.media === "string" ? sp.media : "";
    const ext = path.extname(m).toLowerCase();
    if (m && SPLASH_EXT.has(ext) && fs.existsSync(m)) media = { url: `${ORIGIN}/splash-media?v=${encodeURIComponent(String(sp.mediaStamp || 0))}`, video: VIDEO_EXT.has(ext) };
    else style = "pet";
  }
  const pet = cfg.pet || {};
  const im = String(pet.image || "");
  const petSrc = im.startsWith("url:") ? im.slice(4) : im ? `${ORIGIN}/pet-image?v=${encodeURIComponent(String(pet.stamp || 0))}` : null;
  return {
    show: true, preview, style, theme: splashTheme(sp), media, petSrc,
    previewUrl: `${ORIGIN}/splash-preview?v=${Date.now()}`,
    wall: !!(cfg.enabled && (cfg.current || timeRuleMain(cfg))),
    sp: {
      greeting: String(sp.greeting || ""), name: String(sp.name || ""), sub: String(sp.sub || ""),
      showQuote: sp.showQuote !== false, quotes: String(sp.quotes || ""),
      minSec: Number(sp.minSec), maxSec: Number(sp.maxSec), accent: splashAccent(sp),
      mediaSound: !!sp.mediaSound, mediaFit: sp.mediaFit === "contain" ? "contain" : "cover"
    }
  };
}
try {
  ipcMain.on("agywe:splash-sync", (e, opts) => {
    let out = { show: false };
    try { out = splashData(opts); } catch (err) { warn("splash data failed", err); out = { show: false }; }
    finally { e.returnValue = out; }
  });
} catch (e) { warn("splash ipc failed", e); }
// 把 Antigravity 自带的加载画面（跳动的 A）染成开屏的配色，两段之间不闪
try {
  app.on("web-contents-created", (_e, wc) => {
    try {
      wc.on("dom-ready", () => {
        try {
          const u = String(wc.getURL() || "");
          if (!u.startsWith("data:text/html") || !u.includes("logo-pulse")) return;
          const sp = splashConf();
          if (!sp.enabled || sp.matchNative === false || splashUsed || safe.on || splashSkippedToday(sp)) return;
          const bg = sp.style === "media" || sp.style === "curtain" ? "#000" : SPLASH_BG[splashTheme(sp)];
          const p = wc.insertCSS(`body{background:${bg} !important}.logo{color:${splashAccent(sp)} !important}`);
          if (p && p.catch) p.catch(() => { });
        } catch { }
      });
    } catch { }
  });
} catch { }

// ---------------------------------------------------------------------------
// 快捷键（主进程截获，焦点在哪个页面都能用）+ 渲染进程诊断
// ---------------------------------------------------------------------------
const hubs = new Set();
function liveHubs() {
  for (const h of hubs) { try { if (h.isDestroyed()) hubs.delete(h); } catch { hubs.delete(h); } }
  return [...hubs];
}
function toggleFromMain(wc) {
  const list = liveHubs();
  let targets = list.filter((h) => h === wc);
  if (!targets.length) targets = list.filter((h) => { try { return h.isFocused(); } catch { return false; } });
  if (!targets.length) targets = list;
  for (const h of targets) { try { h.send("agywe:toggle-settings"); } catch { } }
  diagWrite(`[main] shortcut -> ${targets.length} hub(s)`);
}
function isShortcut(input) {
  return input && input.type === "keyDown" && input.control && input.alt && !input.shift && !input.meta &&
    (input.code === "KeyW" || String(input.key).toLowerCase() === "w");
}

// ---- 快捷键的解析 / 显示（hook.js、preload、设置页里是同一份）----
const HK_NAMES = { BracketRight: "]", BracketLeft: "[", Backquote: "`", Minus: "-", Equal: "=", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete" };
const HK_CODES = Object.fromEntries(Object.entries(HK_NAMES).map(([c, n]) => [n.toLowerCase(), c]));
function hkKeyName(code) {
  code = String(code || "");
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return "Num" + code.slice(6);
  return HK_NAMES[code] || null;
}
function hkParse(str) {
  const parts = String(str || "").split("+").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const p = { ctrl: false, alt: false, shift: false, meta: false, code: "" };
  for (const raw of parts) {
    const x = raw.toLowerCase();
    if (x === "ctrl" || x === "control") p.ctrl = true;
    else if (x === "alt") p.alt = true;
    else if (x === "shift") p.shift = true;
    else if (x === "win" || x === "meta" || x === "super" || x === "cmd") p.meta = true;
    else if (p.code) return null;
    else if (/^[a-z]$/.test(x)) p.code = "Key" + x.toUpperCase();
    else if (/^[0-9]$/.test(x)) p.code = "Digit" + x;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(x)) p.code = "F" + x.slice(1);
    else if (/^num[0-9]$/.test(x)) p.code = "Numpad" + x.slice(3);
    else if (HK_CODES[x]) p.code = HK_CODES[x];
    else return null;
  }
  return p.code ? p : null;
}
function hkFormat(p) {
  if (!p || !p.code) return "";
  const k = hkKeyName(p.code);
  return k ? [p.ctrl && "Ctrl", p.alt && "Alt", p.shift && "Shift", p.meta && "Win", k].filter(Boolean).join("+") : "";
}
// 至少两个修饰键（Ctrl / Alt / Shift / Win），或者 F 键 + 一个修饰键，免得把正常打字截走
function hkAllowed(p) {
  if (!p || !hkKeyName(p.code)) return false;
  const n = [p.ctrl, p.alt, p.shift, p.meta].filter(Boolean).length;
  return /^F\d+$/.test(p.code) ? n >= 1 : n >= 2;
}
const hkSig = (p) => (p.ctrl ? "C" : "") + (p.alt ? "A" : "") + (p.shift ? "S" : "") + (p.meta ? "M" : "") + ":" + p.code;
// 快捷键：默认 Ctrl+Alt+W 设置 · Q 快速切换 · ] 下一张 · [ 上一张 · P 番茄钟 · H 一键隐藏，都可以在设置里改
const HOTKEY_ACTIONS = ["settings", "quick", "next", "prev", "pomo", "hide"];
let hkCache = { sig: "", map: new Map() };
let hkCaptureUntil = 0;          // 设置页在录新快捷键时先别截走
let hkConflicts = {};            // 看起来被别的程序（全局快捷键）占用的
const hkLast = {};               // 这次启动每个快捷键最后一次收到的时间
function hotkeyTable() {
  const hk = { ...DEFAULTS.hotkeys, ...((loadConfig() || {}).hotkeys || {}) };
  const sig = JSON.stringify(hk);
  if (sig === hkCache.sig) return hkCache.map;
  const map = new Map();
  for (const a of HOTKEY_ACTIONS) {
    const p = hkParse(hk[a]);
    if (!p || !hkAllowed(p)) continue;
    const k = hkSig(p);
    if (!map.has(k)) map.set(k, a);
  }
  hkCache = { sig, map };
  return map;
}
function hotkeyOf(input) {
  if (!input || input.type !== "keyDown") return null;
  if (Date.now() < hkCaptureUntil) return null;
  let code = String(input.code || "");
  if (!code) {
    const k = String(input.key || "");
    if (/^[a-z]$/i.test(k)) code = "Key" + k.toUpperCase();
    else if (HK_CODES[k.toLowerCase()]) code = HK_CODES[k.toLowerCase()];
  }
  if (!code) return null;
  const a = hotkeyTable().get(hkSig({ ctrl: !!input.control, alt: !!input.alt, shift: !!input.shift, meta: !!input.meta, code }));
  if (!a) return null;
  if (input.isAutoRepeat && a !== "next" && a !== "prev") return "swallow";
  hkLast[a] = Date.now();
  return a;
}
// 试着注册成全局快捷键：注册不上，多半是别的程序（QQ、输入法、截图工具…）已经占了，按下去根本到不了 Antigravity
function electronAccel(p) {
  const k = hkKeyName(p.code);
  if (!k) return null;
  const key = /^Num\d$/.test(k) ? "num" + k.slice(3) : k;
  return [p.ctrl && "Control", p.alt && "Alt", p.shift && "Shift", p.meta && "Super", key].filter(Boolean).join("+");
}
function globalTaken(p) {
  try {
    const gs = electron.globalShortcut;
    const acc = electronAccel(p);
    if (!gs || !acc) return "unknown";
    if (gs.isRegistered(acc)) return "free";
    const ok = gs.register(acc, () => { });
    if (ok) { try { gs.unregister(acc); } catch { } return "free"; }
    return "taken";
  } catch { return "unknown"; }
}
function scanHotkeyConflicts() {
  try {
    const hk = { ...DEFAULTS.hotkeys, ...(loadConfig().hotkeys || {}) };
    hkConflicts = {};
    for (const a of HOTKEY_ACTIONS) { const p = hkParse(hk[a]); if (p && hkAllowed(p) && globalTaken(p) === "taken") hkConflicts[a] = hk[a]; }
    diagWrite(`[hotkey] ${Object.keys(hkConflicts).length ? "可能被别的程序占用：" + JSON.stringify(hkConflicts) : "没有发现冲突"}`);
  } catch (e) { warn("hotkey scan failed", e); }
}
const hotkeyAt = {};
function hotkeyFromMain(wc, action) {
  if (action === "swallow") return;
  const now = Date.now();
  if ((action === "next" || action === "prev") && now - (hotkeyAt[action] || 0) < 350) return;   // 按住不放时别连着狂换
  hotkeyAt[action] = now;
  const list = liveHubs();
  let target = list.find((h) => h === wc) || list.find((h) => { try { return h.isFocused(); } catch { return false; } }) || list[0];
  if (!target) return;
  try { target.send("agywe:hotkey", action); } catch { }
  diagWrite(`[main] hotkey ${action}`);
}
function installHooks() {
  try {
    ipcMain.on("agywe:diag", (e, d) => {
      try { hubs.add(e.sender); trackWin(e.sender); } catch { }
      diagWrite({ renderer: d });
    });
  } catch (e) { warn("ipc diag failed", e); }
  try {
    app.on("web-contents-created", (_e, wc) => {
      try {
        wc.on("before-input-event", (ev, input) => {
          const hk = hotkeyOf(input);
          if (!hk) return;
          try { ev.preventDefault(); } catch { }
          if (hk === "settings") toggleFromMain(wc); else hotkeyFromMain(wc, hk);
        });
        wc.on("console-message", (ev, level, message, line, sourceId) => {
          try {
            const msg = ev && typeof ev.message === "string" ? ev.message : String(message || "");
            const src = ev && typeof ev.sourceId === "string" ? ev.sourceId : String(sourceId || "");
            const lvl = ev && ev.level !== undefined ? ev.level : level;
            const ln = ev && ev.lineNumber !== undefined ? ev.lineNumber : line;
            if (/agywe|webwallgl/i.test(msg + " " + src)) diagWrite(`[console:${lvl}] ${msg.slice(0, 2000)} (${src}:${ln})`);
          } catch { }
        });
        wc.on("did-fail-load", (_ev, code, desc, url, isMain) => {
          if (/^agywe:/i.test(String(url))) diagWrite(`[load-fail] ${code} ${desc} ${url} main=${isMain}`);
        });
        wc.on("render-process-gone", (_ev, d) => diagWrite({ renderGone: d }));
      } catch { }
    });
  } catch (e) { warn("web-contents hook failed", e); }
}
installHooks();

// ---------------------------------------------------------------------------
// v0.8 安全模式：连续两次没能正常启动（或者界面进程崩了），就先不加载插件的界面部分，保证 Antigravity 能用
//   boot.json = { pending, fails, manual }
//   - 启动时上次的 pending 还是 true：上次没跑到「正常」就没了 → fails + 1
//   - 页面跑满 20 秒报 boot-ok → pending = false；跑满 3 分钟报 stable → fails = 0
//   - 界面进程崩溃（crashed / oom / abnormal-exit / launch-failed）→ fails + 1
//   - 正常退出 → pending = false
// ---------------------------------------------------------------------------
function bootFile() { return path.join(cfgDir(), "boot.json"); }
function readBoot() {
  try { const o = JSON.parse(fs.readFileSync(bootFile(), "utf8")); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function writeBoot(patch) {
  try {
    const o = { ...readBoot(), ...patch, at: new Date().toISOString(), version: AGYWE_VERSION };
    fs.mkdirSync(cfgDir(), { recursive: true });
    fs.writeFileSync(bootFile(), JSON.stringify(o));
    return o;
  } catch { return null; }
}
function safeEval(why) {
  let auto = true;
  try { auto = ((loadConfig() || {}).safeMode || {}).auto !== false; } catch { }
  const was = safe.on;
  safe.on = !!(safe.manual || (auto && safe.fails >= 2));
  if (safe.on && !was) { safe.reason = safe.manual ? "manual" : (why || "fails"); diagWrite(`[safe] 进入安全模式：${safe.reason}（连续 ${safe.fails} 次没能正常启动）`); }
  if (!safe.on) safe.reason = "";
}
function bootBegin() {
  if (safe.begun) return;
  safe.begun = true;
  const b = readBoot();
  safe.manual = !!b.manual;
  safe.fails = (Number(b.fails) || 0) + (b.pending ? 1 : 0);
  if (b.pending) diagWrite(`[safe] 上次启动没有正常完成（${b.at || "?"}，v${b.version || "?"}），连续 ${safe.fails} 次`);
  safeEval("boot");
  writeBoot({ pending: !safe.on, fails: safe.fails, manual: safe.manual });
}
try {
  ipcMain.on("agywe:safe-sync", (e) => {
    let out = { safe: false };
    try { bootBegin(); out = { safe: safe.on, reason: safe.reason, fails: safe.fails }; } catch { out = { safe: false }; }
    finally { e.returnValue = out; }
  });
  ipcMain.on("agywe:boot-ok", (e) => {
    try { hubs.add(e.sender); } catch { }
    try { if (safe.begun && !safe.on) writeBoot({ pending: false }); } catch { }
  });
  ipcMain.on("agywe:stable", () => {
    try { if (safe.begun && !safe.on && safe.fails) { safe.fails = 0; writeBoot({ pending: false, fails: 0 }); diagWrite("[safe] 已稳定运行 3 分钟，失败计数清零"); } } catch { }
  });
  ipcMain.on("agywe:safe-exit", (e) => {
    try { safe.manual = false; safe.fails = 0; safe.on = false; safe.reason = ""; writeBoot({ pending: true, fails: 0, manual: false }); diagWrite("[safe] 手动恢复插件"); } catch { }
    setTimeout(() => { try { e.sender.reload(); } catch { } }, 80);
  });
  app.on("render-process-gone", (_e, wc, d) => {
    try {
      if (!d || !["crashed", "oom", "abnormal-exit", "launch-failed"].includes(d.reason)) return;
      let u = ""; try { u = String(wc.getURL() || ""); } catch { }
      if (!hubs.has(wc) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) return;
      safe.fails++;
      writeBoot({ pending: false, fails: safe.fails });
      diagWrite(`[safe] 界面进程退出：${d.reason}（${d.exitCode}），连续 ${safe.fails} 次`);
      safeEval("crash");
    } catch { }
  });
  app.on("will-quit", () => { try { if (safe.begun && !safe.on && readBoot().pending) writeBoot({ pending: false }); } catch { } });
} catch (e) { warn("safe mode ipc failed", e); }

// ---------------------------------------------------------------------------
// v0.8 任务栏闪烁：Antigravity 不在前台时，agent 完成 / 需要确认 / 出错，让任务栏图标闪，点回窗口就停
// ---------------------------------------------------------------------------
const flashWins = new WeakSet();
try {
  ipcMain.on("agywe:flash", (e, kind) => {
    try {
      if (loadConfig().flashOnDone === false) return;
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win || win.isDestroyed() || win.isFocused()) return;
      win.flashFrame(true);
      // v0.10.2：窗口不在前台时连着完成好几次，以前每次都会再挂一个 focus 监听
      if (!flashWins.has(win)) {
        flashWins.add(win);
        win.once("focus", () => { flashWins.delete(win); try { win.flashFrame(false); } catch { } });
      }
      diagWrite(`[flash] ${String(kind || "").slice(0, 20)}`);
    } catch (err) { warn("flash failed", err); }
  });
} catch (e) { warn("flash ipc failed", e); }

// ---------------------------------------------------------------------------
// v0.8 省电：笔记本拔掉电源时告诉壁纸页（降帧率 / 暂停在壁纸页里做）
// ---------------------------------------------------------------------------
function powerBroadcast() { for (const h of liveHubs()) { try { h.send("agywe:power", { battery: onBattery }); } catch { } } }
function installPower() {
  try {
    const pm = electron.powerMonitor;
    if (!pm) return;
    try { onBattery = typeof pm.isOnBatteryPower === "function" ? !!pm.isOnBatteryPower() : !!pm.onBatteryPower; } catch { }
    pm.on("on-battery", () => { onBattery = true; diagWrite("[power] 拔掉电源"); powerBroadcast(); try { syncNowPlaying(); } catch { } });
    pm.on("on-ac", () => { onBattery = false; diagWrite("[power] 接上电源"); powerBroadcast(); try { syncNowPlaying(); } catch { } });
    diagWrite(`[power] ${onBattery ? "用电池" : "插着电源"}`);
  } catch (e) { warn("power monitor failed", e); }
}
try { ipcMain.handle("agywe:power-get", () => ({ battery: onBattery })); } catch (e) { warn("power ipc failed", e); }

// ---------------------------------------------------------------------------
// v0.8 诊断报告：版本、设置（不含图片）、最近的日志和毛玻璃报告，一个 txt
// ---------------------------------------------------------------------------
function redact(v, depth) {
  depth = depth || 0;
  if (typeof v === "string") {
    if (v.startsWith("url:data:") || v.startsWith("data:")) return `<内嵌图片 ${Math.round(v.length / 1024)} KB>`;
    return v.length > 400 ? v.slice(0, 400) + "…" : v;
  }
  if (Array.isArray(v)) return depth > 3 ? `[${v.length} 项]` : v.slice(0, 40).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === "props" ? `${Object.keys(x || {}).length} 张壁纸有自己的属性` : redact(x, depth + 1);
    return o;
  }
  return v;
}
function tailFile(f, maxBytes) {
  try {
    const st = fs.statSync(f);
    const n = Math.min(st.size, maxBytes);
    const fd = fs.openSync(f, "r");
    try { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); return b.toString("utf8"); }
    finally { fs.closeSync(fd); }
  } catch { return ""; }
}
async function buildDiagReport() {
  const cfg = loadConfig();
  const os = require("os");
  let lib = null; try { lib = await scanLibrary(false); } catch { }
  let wp = null; try { wp = await wePaths(false); } catch { }
  const out = [];
  const H = (t) => out.push("", "==== " + t + " ====");
  out.push("agywe 诊断报告　" + new Date().toString());
  out.push(`插件 v${AGYWE_VERSION} · Antigravity ${app.getVersion()} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome}`);
  out.push(`系统 ${os.type()} ${os.release()} ${os.arch()} · 内存 ${Math.round(os.totalmem() / 1073741824)} GB · ${(os.cpus() || []).length} 线程`);
  out.push(`安全模式 ${safe.on ? "开（" + safe.reason + "）" : "关"} · 连续失败 ${safe.fails} · 电源 ${onBattery ? "电池" : "插电"} · 系统音频 ${audioState} · 正在播放 ${np ? (np.hasMedia ? "有媒体" : "没在放") : "未连接"}${npError ? "（" + npError.slice(0, 120) + "）" : ""}`);
  const fz = fuseInfo || await loadFuses();
  out.push(`Electron 安全开关 ${fz && fz.found ? fz.raw + "（RunAsNode " + fz.runAsNode + " · 程序包完整性校验 " + fz.asarIntegrity + "）" : "没读到"} · 正在播放后台 ${npProc ? "运行中" : npSuspended ? "暂停（" + npSuspended + "）" : "没在跑"}（${npUseFile ? "-File" : "-EncodedCommand"}）`);
  try { const st = fs.statSync(configPath); out.push(`config.json ${Math.round(st.size / 1024)} KB · 存成文件的图片 ${(() => { try { return fs.readdirSync(assetsDir()).length; } catch { return 0; } })()} 张`); } catch { }
  out.push(`壁纸库 ${lib ? lib.items.length : "?"} 张 · 桌宠程序 ${petApps.map((x) => x.name).join("、") || "没找到"} · 窗口 ${liveHubs().length} 个`);
  H("路径"); out.push(JSON.stringify(wp, null, 1));
  H("设置（内嵌图片已省略）"); out.push(JSON.stringify(redact(cfg), null, 1));
  H("启动记录"); out.push(JSON.stringify(readBoot()));
  H("自动重装记录"); out.push((PLUGIN_DIR ? tailFile(path.join(PLUGIN_DIR, "autofix.log"), 4000).replace(/^\uFEFF/, "").trim() : "") || "（没有）");
  const L = (DIAG_FILES[0] ? tailFile(DIAG_FILES[0], 1.5 * 1024 * 1024) : "").split(/\r?\n/).filter(Boolean);
  const cut = (l, n) => (l.length > n ? l.slice(0, n) + ` …（省略 ${l.length - n} 字）` : l);
  const glass = L.filter((l) => l.includes('"glass-report"')).slice(-1)[0];
  H("最近一次毛玻璃报告"); out.push(glass ? cut(glass, 40000) : "（没有）");
  H("最近的通知 / agent 状态 / 安全模式"); out.push(...L.filter((l) => /app-notification|agent-count|\[flash\]|\[safe\]|\[power\]|safe-mode/.test(l)).slice(-50).map((l) => cut(l, 400)));
  H("最近的警告"); out.push(...L.filter((l) => /\[warn\]|renderGone|load-fail|\[console:[23]\]|wall-failed|glass-slow|❌/.test(l)).slice(-60).map((l) => cut(l, 600)));
  H("日志最后 200 行"); out.push(...L.slice(-200).map((l) => cut(l, 800)));
  return out.join("\r\n");
}


// ---------------------------------------------------------------------------
// v0.9 窗口在不在前台（给壁纸页降帧率用）：看的是整个窗口，点进内置浏览器不算失焦
// ---------------------------------------------------------------------------
const trackedWins = new WeakSet();
function winState(win) { try { return { focused: win.isFocused(), minimized: win.isMinimized() }; } catch { return { focused: true, minimized: false }; } }
function trackWin(wc) {
  try {
    const win = BrowserWindow.fromWebContents(wc);
    if (!win || trackedWins.has(win)) return;
    trackedWins.add(win);
    const send = () => { try { if (!wc.isDestroyed()) wc.send("agywe:win-focus", winState(win)); } catch { } };
    for (const ev of ["focus", "blur", "minimize", "restore"]) win.on(ev, send);
  } catch { }
}
try {
  ipcMain.handle("agywe:win-state", (e) => {
    trackWin(e.sender);
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? winState(win) : { focused: true, minimized: false };
  });
} catch (e) { warn("win-state ipc failed", e); }

// ---------------------------------------------------------------------------
// v0.9 今日统计：完成 / 需要确认 / 出错次数、agent 跑了多久、番茄钟，按天存在 stats.json（留 60 天）
// ---------------------------------------------------------------------------
const stats = { data: null, t: 0, dirty: false };
const STAT_ZERO = { done: 0, attention: 0, error: 0, runs: 0, runMs: 0, longestMs: 0, pomo: 0, focusMin: 0 };
function statsFile() { return path.join(cfgDir(), "stats.json"); }
function loadStats() {
  if (stats.data) return stats.data;
  try { stats.data = JSON.parse(fs.readFileSync(statsFile(), "utf8")); } catch { stats.data = {}; }
  if (!stats.data || typeof stats.data !== "object" || Array.isArray(stats.data)) stats.data = {};
  return stats.data;
}
function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function saveStats() {
  if (!stats.dirty || !stats.data) return;
  try {
    fs.mkdirSync(cfgDir(), { recursive: true });
    const tmp = statsFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(stats.data));
    fs.renameSync(tmp, statsFile());
    stats.dirty = false;
  } catch (e) { warn("stats save failed", e); }
}
function statBump(ev) {
  if (!ev || typeof ev !== "object") return;
  const all = loadStats(), k = dayKey();
  const s = all[k] = { ...STAT_ZERO, ...(all[k] || {}) };
  if (ev.type === "run") {
    const ms = Math.min(24 * 3600e3, Math.max(0, Number(ev.ms) || 0));
    if (ms < 1000) return;
    s.runs++; s.runMs += ms; s.longestMs = Math.max(s.longestMs, ms);
  } else if (ev.type === "mood" && ["done", "attention", "error"].includes(ev.kind)) s[ev.kind]++;
  else if (ev.type === "pomo") { s.pomo++; s.focusMin += Math.min(600, Math.max(0, Number(ev.min) || 0)); }
  else return;
  const keys = Object.keys(all).sort();
  while (keys.length > 60) delete all[keys.shift()];
  stats.dirty = true;
  clearTimeout(stats.t); stats.t = setTimeout(saveStats, 1500);
}
function statsWindow(n) {
  const all = loadStats(), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); const k = dayKey(d); out.push({ day: k, weekday: d.getDay(), ...STAT_ZERO, ...(all[k] || {}) }); }
  return out;
}
try {
  ipcMain.on("agywe:stat", (_e, ev) => { try { statBump(ev); } catch { } });
  ipcMain.handle("agywe:stats-get", () => statsWindow(7));
  app.on("will-quit", () => { try { clearTimeout(stats.t); saveStats(); } catch { } });
} catch (e) { warn("stats ipc failed", e); }

// ---------------------------------------------------------------------------
// v0.9 完整备份 / 恢复：所有设置，加上挂件、头像、衣柜、开屏用到的图片一起打包进一个 .json
// ---------------------------------------------------------------------------
const BACKUP_EXT = new Set([".png", ".gif", ".webp", ".apng", ".jpg", ".jpeg", ".svg", ".bmp", ".mp4", ".webm", ".m4v", ".mov"]);
async function buildBackup() {
  const cfg = JSON.parse(JSON.stringify(loadConfig()));
  delete cfg.palette;
  const files = {}, skipped = [];
  const embed = async (val, maxMB, label) => {
    if (typeof val !== "string" || !val || val === "pet" || val.startsWith("url:") || val.startsWith("agywe-file:")) return val;
    try {
      const st = await fsp.stat(val);
      if (!st.isFile() || !BACKUP_EXT.has(path.extname(val).toLowerCase())) return val;
      if (st.size > maxMB * 1048576) { skipped.push(`${label}（${Math.round(st.size / 1048576)} MB，太大没放进去）`); return val; }
      const id = "f" + Object.keys(files).length;
      files[id] = { name: path.basename(val), data: (await fsp.readFile(val)).toString("base64") };
      return "agywe-file:" + id;
    } catch { skipped.push(`${label}（文件找不到了）`); return val; }
  };
  if (cfg.pet) cfg.pet.image = await embed(cfg.pet.image, 8, "挂件图片");
  cfg.avatarUser = await embed(cfg.avatarUser, 8, "你的头像");
  cfg.avatarAgent = await embed(cfg.avatarAgent, 8, "agent 头像");
  if (cfg.splash) cfg.splash.media = await embed(cfg.splash.media, 40, "开屏视频 / 动图");
  if (Array.isArray(cfg.outfits)) for (const o of cfg.outfits) if (o) o.image = await embed(o.image, 8, `衣服「${o.name || ""}」`);
  return { agyweBackup: 1, version: AGYWE_VERSION, app: app.getVersion(), createdAt: new Date().toISOString(), config: cfg, files, skipped };
}
async function restoreBackup(file) {
  let data;
  try { data = JSON.parse((await fsp.readFile(file, "utf8")).replace(/^\uFEFF/, "")); } catch { return { ok: false, error: "文件不是有效的 JSON" }; }
  if (!data || data.agyweBackup !== 1 || !data.config || typeof data.config !== "object") {
    if (data && data.agyweLook) return { ok: false, error: "这是「外观预设」文件，请到「外观」页点「导入…」" };
    return { ok: false, error: "这不是 agywe 的完整备份文件" };
  }
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  await fsp.mkdir(cfgDir(), { recursive: true });
  const before = path.join(cfgDir(), `config.before-restore-${stamp}.json`);
  await fsp.writeFile(before, JSON.stringify(loadConfig(), null, 2), "utf8");   // 恢复前先把现在的存一份
  const dir = path.join(cfgDir(), "restored");
  const files = data.files && typeof data.files === "object" ? data.files : {};
  let restored = 0;
  const unpack = async (val) => {
    if (typeof val !== "string" || !val.startsWith("agywe-file:")) return val;
    const f = files[val.slice(11)];
    if (!f || typeof f.data !== "string") return null;
    const name = String(f.name || "file").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(-80);
    if (!BACKUP_EXT.has(path.extname(name).toLowerCase())) return null;
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, crypto.randomBytes(4).toString("hex") + "-" + name);
    await fsp.writeFile(target, Buffer.from(f.data, "base64"));
    restored++;
    return target;
  };
  const kind = (x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
  const src = data.config, patch = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in src) || k === "palette") continue;
    const dv = DEFAULTS[k], v = src[k];
    if (dv !== null && v !== null && kind(dv) !== kind(v)) continue;
    patch[k] = v;
  }
  if (patch.pet && typeof patch.pet === "object") patch.pet = { ...patch.pet, image: await unpack(patch.pet.image), stamp: Date.now() };
  for (const k of ["avatarUser", "avatarAgent"]) if (k in patch) patch[k] = await unpack(patch[k]);
  if (patch.splash && typeof patch.splash === "object") patch.splash = { ...patch.splash, media: await unpack(patch.splash.media), mediaStamp: Date.now() };
  if (Array.isArray(patch.outfits)) {
    const list = [];
    for (const o of patch.outfits.slice(0, 30)) if (o && typeof o === "object") list.push({ ...o, image: await unpack(o.image) });
    patch.outfits = list;
  }
  patch.avatarStamp = Date.now();
  const cfg = await saveConfig(patch);
  let lib = null;
  try { lib = await scanLibrary(true); } catch { }
  const missing = [];
  if (lib && cfg.current && cfg.current.kind === "we" && !lib.byId.has(cfg.current.id)) missing.push("当前壁纸在这台电脑的壁纸库里找不到");
  const favLost = lib ? (cfg.favorites || []).filter((k) => String(k).startsWith("we:") && !lib.byId.has(String(k).slice(3))).length : 0;
  if (favLost) missing.push(`${favLost} 张收藏的壁纸这台电脑上没有`);
  const customLost = (cfg.custom || []).filter((c) => c && c.path && !fs.existsSync(c.path)).length;
  if (customLost) missing.push(`${customLost} 个自定义图片 / 视频不在原来的位置`);
  const dirLost = (cfg.extraDirs || []).filter((x) => !fs.existsSync(x)).length;
  if (dirLost) missing.push(`${dirLost} 个手动添加的壁纸目录不存在`);
  return { ok: true, cfg, restored, missing, before, from: { version: data.version, createdAt: data.createdAt } };
}



// ---------------------------------------------------------------------------
// v0.10.1 读 Antigravity.exe 里的 Electron 安全开关（给自检 / 诊断报告 / 关于页用），结果按 exe 大小 + 时间缓存
// ---------------------------------------------------------------------------
const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "latin1");
const FUSE_NAMES = ["runAsNode", "cookieEncryption", "nodeOptions", "nodeCliInspect", "asarIntegrity", "onlyLoadAppFromAsar", "browserV8Snapshot", "fileProtocolPrivileges", "wasmTrapHandlers"];
let fuseInfo = null;
async function readFusesAsync(exe) {
  let fh;
  try { fh = await fsp.open(exe, "r"); } catch (e) { return { found: false, error: String(e && e.message || e) }; }
  try {
    const size = (await fh.stat()).size, CH = 4 * 1024 * 1024, keepN = FUSE_SENTINEL.length - 1;
    const buf = Buffer.alloc(CH + FUSE_SENTINEL.length);
    let base = 0, carry = 0, pos = 0;
    while (pos < size) {
      const { bytesRead: n } = await fh.read(buf, carry, CH, pos);
      if (n <= 0) break;
      pos += n;
      const len = carry + n;
      const i = buf.subarray(0, len).indexOf(FUSE_SENTINEL);
      if (i >= 0) {
        const t = Buffer.alloc(48);
        await fh.read(t, 0, 48, base + i + FUSE_SENTINEL.length);
        const cnt = t[1], out = { found: true, version: t[0], raw: "" };
        for (let j = 0; j < cnt && j + 2 < t.length; j++) {
          const ch = String.fromCharCode(t[j + 2]); out.raw += ch;
          if (j < FUSE_NAMES.length) out[FUSE_NAMES[j]] = ch === "1" ? true : ch === "0" ? false : null;
        }
        return out;
      }
      const keep = Math.min(len, keepN);
      buf.copy(buf, 0, len - keep, len);
      base += len - keep; carry = keep;
      await new Promise((r) => setTimeout(r, 0));   // 一块一块读，别卡住主进程
    }
    return { found: false };
  } catch (e) { return { found: false, error: String(e && e.message || e) }; }
  finally { try { await fh.close(); } catch { } }
}
async function loadFuses() {
  try {
    const exe = process.execPath;
    const st = await fsp.stat(exe);
    const key = st.size + ":" + Math.round(st.mtimeMs);
    const cf = path.join(cfgDir(), "fuses.json");
    try { const c = JSON.parse(await fsp.readFile(cf, "utf8")); if (c && c.key === key && c.fuses) { fuseInfo = c.fuses; return fuseInfo; } } catch { }
    const t0 = Date.now();
    fuseInfo = await readFusesAsync(exe);
    if (!fuseInfo.error) { try { await fsp.writeFile(cf, JSON.stringify({ key, fuses: fuseInfo })); } catch { } }   // 读失败的不缓存，下次再试
    diagWrite(`[fuses] ${JSON.stringify(fuseInfo)}（${Date.now() - t0} ms）`);
    if (fuseInfo.found && fuseInfo.runAsNode === false) warn("这个版本的 Antigravity 关掉了 RunAsNode：插件下次更新后没法自动装回");
  } catch (e) { fuseInfo = { found: false, error: String(e && e.message || e) }; }
  return fuseInfo;
}

// ---------------------------------------------------------------------------
// v0.10 系统占用小组件：CPU（两次采样的差）、内存、Antigravity 自己占的内存
// ---------------------------------------------------------------------------
let cpuLast = null;
function cpuSample() {
  const os = require("os");
  const cs = os.cpus() || [];
  let idle = 0, total = 0;
  for (const c of cs) { const t = c.times || {}; idle += t.idle || 0; total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0); }
  return { idle, total, n: cs.length };
}
function sysUsage() {
  const os = require("os");
  const s = cpuSample();
  let cpu = null;
  if (cpuLast && s.total > cpuLast.total) cpu = Math.max(0, Math.min(100, Math.round(100 * (1 - (s.idle - cpuLast.idle) / (s.total - cpuLast.total)))));
  cpuLast = s;
  const memTotal = os.totalmem(), memFree = os.freemem();
  let appMem = 0;
  try { for (const m of app.getAppMetrics() || []) appMem += ((m.memory && m.memory.workingSetSize) || 0) * 1024; } catch { }
  return { cpu, cores: s.n, memTotal, memUsed: Math.max(0, memTotal - memFree), appMem };
}
try { ipcMain.handle("agywe:sys", () => { try { return sysUsage(); } catch (e) { return { error: String(e && e.message || e) }; } }); } catch (e) { warn("sys ipc failed", e); }

async function handleRequestLogged(request) {
  let res;
  try { res = await handleRequest(request); }
  catch (e) { warn("request threw", request.url, e); return new Response(String(e), { status: 500 }); }
  try {
    const u = new URL(request.url);
    const p = u.pathname;
    if (res.status >= 400 || /\.html$|^\/$|^\/api\/(config|library|info)$/.test(p)) {
      diagWrite(`[req] ${request.method} ${p}${u.search} -> ${res.status}`);
    }
  } catch { }
  return res;
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  try {
    loadConfig();
    try { bootBegin(); } catch (e) { warn("safe mode boot failed", e); }
    protocol.handle(SCHEME, handleRequestLogged);
    installCspRelax();
    scanLibrary(false).then((l) => log(`library: ${l.items.length} items`)).catch((e) => warn("scan failed", e));
    wePaths(false).then((p) => log("paths", p)).catch(() => { });
    log(`ready v${AGYWE_VERSION}`);
    setTimeout(() => { findPetApps().catch((e) => warn("pet scan failed", e)); }, 3000);
    installDisplayMedia();
    setTimeout(startNowPlaying, 1500);
    setTimeout(syncAutoFix, 4000);
    setTimeout(rememberExePath, 3000);
    setTimeout(watchUpdater, 6000);
    installPower();
    setTimeout(scanHotkeyConflicts, 9000);
    setTimeout(() => { loadFuses().catch(() => { }); }, 25000);
  } catch (e) { warn("init failed", e); }
}).catch(() => { });

module.exports = { relaxCsp, mergeConfig, DEFAULTS };
