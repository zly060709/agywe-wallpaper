#!/usr/bin/env node
"use strict";
/*
 * agywe 安装器 —— 给 Antigravity 桌面 App 装 / 卸 Wallpaper Engine 壁纸插件
 *
 * 用法（不需要单独装 Node.js，用 Antigravity.exe 自己当 Node 跑）：
 *   set ELECTRON_RUN_AS_NODE=1
 *   "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" install.cjs install
 *   ... install.cjs uninstall
 *   ... install.cjs status
 * 参数：--exe <Antigravity.exe 路径>  或  --dir <安装目录>
 *
 * 原理：重新打包 resources\app.asar，往里加 dist/agywe/*，并改三处：
 *   main.js          第一行后 require("./agywe/hook.js")
 *   customScheme.js  registerSchemesAsPrivileged 列表里加 agywe 协议
 *   preload.js       末尾追加壁纸层 / 毛玻璃 / 设置入口
 * 原文件同时存进 dist/agywe/orig/，卸载时原样放回；另外整包备份为 app.asar.agywe-backup。
 */
try { process.noAsar = true; } catch { }
let fs;
try { fs = require("original-fs"); } catch { fs = require("fs"); }
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const AGYWE_VERSION = "0.13.0";
const PAYLOAD = path.join(__dirname, "payload");
const PATCHED = ["dist/main.js", "dist/customScheme.js", "dist/preload.js"];
const MARK = "dist/agywe/manifest.json";

// 自动重装开关：卸载 / 还原后写 autofix.off，开机检查和更新守候看到它就不再自动装
function autofixOff(on) {
  const f = path.join(__dirname, "autofix.off");
  try { if (on) fs.writeFileSync(f, "uninstalled " + new Date().toISOString()); else if (fs.existsSync(f)) fs.unlinkSync(f); } catch { }
}
function removeRunKey() {
  if (process.platform !== "win32") return;
  try { cp.execFileSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "agywe-autofix", "/f"], { windowsHide: true, stdio: "ignore" }); } catch { }
}

// ---------------------------------------------------------------------------
// asar 读写
// ---------------------------------------------------------------------------
function readAsar(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 16 || buf.readUInt32LE(0) !== 4) throw new Error("不是有效的 asar 文件: " + file);
  const headerSize = buf.readUInt32LE(4);
  const strLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + strLen).toString("utf8"));
  return { buf, header, base: 8 + headerSize };
}

function nodeAt(header, p) {
  let n = header;
  for (const part of p.split("/")) {
    if (!n || !n.files || !Object.prototype.hasOwnProperty.call(n.files, part)) return null;
    n = n.files[part];
  }
  return n;
}

function fileBytes(a, p) {
  const n = nodeAt(a.header, p);
  if (!n || n.files || n.unpacked || n.link || n.offset === undefined) return null;
  const off = a.base + Number(n.offset);
  return a.buf.subarray(off, off + n.size);
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
function integrityOf(buf) {
  const blockSize = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += blockSize) blocks.push(sha256(buf.subarray(i, i + blockSize)));
  return { algorithm: "SHA256", hash: sha256(buf), blockSize, blocks };
}

/**
 * 重新打包。overrides: Map<路径, Buffer | null>，null = 删除；不在原包里的路径 = 新增。
 * 保持原有文件顺序与 unpacked / link 条目不变。
 */
function repack(a, overrides) {
  const header = JSON.parse(JSON.stringify(a.header));
  // 删除
  for (const [p, v] of overrides) {
    if (v !== null) continue;
    const parts = p.split("/");
    const parent = parts.length > 1 ? nodeAt(header, parts.slice(0, -1).join("/")) : header;
    if (parent && parent.files) delete parent.files[parts[parts.length - 1]];
  }
  // 新增（先占位，内容在下面统一写）
  for (const [p, v] of overrides) {
    if (v === null || nodeAt(header, p)) continue;
    const parts = p.split("/");
    let n = header;
    for (let i = 0; i < parts.length - 1; i++) {
      n.files = n.files || {};
      if (!n.files[parts[i]]) n.files[parts[i]] = { files: {} };
      n = n.files[parts[i]];
      if (!n.files) throw new Error("路径冲突: " + p);
    }
    n.files[parts[parts.length - 1]] = { size: 0, offset: "0" };
  }
  // 按遍历顺序重排数据
  const chunks = [];
  let cursor = 0;
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix ? prefix + "/" + name : name;
      if (child.files) { walk(child, p); continue; }
      if (child.unpacked || child.link) continue;
      let data;
      if (overrides.has(p)) data = overrides.get(p);
      else data = fileBytes(a, p);
      if (!data) throw new Error("读取失败: " + p);
      const isNew = overrides.has(p);
      child.size = data.length;
      child.offset = String(cursor);
      if (isNew || child.integrity) child.integrity = integrityOf(data);
      chunks.push(data);
      cursor += data.length;
    }
  };
  walk(header, "");
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const padded = (json.length + 3) & ~3;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, ...chunks]);
}


// ---------------------------------------------------------------------------
// v0.10.1 Electron 安全开关（fuses）：Antigravity.exe 里写死的一串标志位
//   asarIntegrity 开 = 程序包被改动就启动失败 → 不能装
//   runAsNode 关    = 安装器借不了 Antigravity.exe 跑 Node → 根本跑不起来（cmd 里会先用 fusecheck.ps1 拦住）
// ---------------------------------------------------------------------------
const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "latin1");
const FUSE_NAMES = ["runAsNode", "cookieEncryption", "nodeOptions", "nodeCliInspect", "asarIntegrity", "onlyLoadAppFromAsar", "browserV8Snapshot", "fileProtocolPrivileges", "wasmTrapHandlers"];
function parseFuseWire(t) {
  const cnt = t[1], out = { found: true, version: t[0], count: cnt, raw: "" };
  for (let j = 0; j < cnt && j + 2 < t.length; j++) {
    const ch = String.fromCharCode(t[j + 2]);
    out.raw += ch;
    if (j < FUSE_NAMES.length) out[FUSE_NAMES[j]] = ch === "1" ? true : ch === "0" ? false : null;   // "r" = 已移除
  }
  return out;
}
function readFuses(exe) {
  let fd;
  try { fd = fs.openSync(exe, "r"); } catch (e) { return { found: false, error: String(e && e.message || e) }; }
  try {
    const size = fs.fstatSync(fd).size, CH = 8 * 1024 * 1024, keepN = FUSE_SENTINEL.length - 1;
    const buf = Buffer.alloc(CH + FUSE_SENTINEL.length);
    let base = 0, carry = 0, filePos = 0;
    while (filePos < size) {
      const n = fs.readSync(fd, buf, carry, CH, filePos);
      if (n <= 0) break;
      filePos += n;
      const len = carry + n;
      const i = buf.subarray(0, len).indexOf(FUSE_SENTINEL);
      if (i >= 0) {
        const t = Buffer.alloc(48);
        fs.readSync(fd, t, 0, 48, base + i + FUSE_SENTINEL.length);
        return parseFuseWire(t);
      }
      const keep = Math.min(len, keepN);
      buf.copy(buf, 0, len - keep, len);
      base += len - keep; carry = keep;
    }
    return { found: false };
  } catch (e) { return { found: false, error: String(e && e.message || e) }; }
  finally { try { fs.closeSync(fd); } catch { } }
}
function fuseLine(f) {
  if (!f || !f.found) return "没读到（" + ((f && f.error) || "可能是新的 Electron 版本") + "）";
  const on = (v) => (v === true ? "开" : v === false ? "关" : "已移除");
  return `RunAsNode ${on(f.runAsNode)} · 程序包完整性校验 ${on(f.asarIntegrity)} · 只从程序包加载 ${on(f.onlyLoadAppFromAsar)}`;
}

// ---------------------------------------------------------------------------
// 补丁（v0.10.1：按结构匹配，不再写死 electron_1 这种编译出来的变量名）
// ---------------------------------------------------------------------------
const HOOK_LINE = 'try { require("./agywe/hook.js"); } catch (e) { try { console.error("[agywe] hook failed", e); } catch (_) { } }\n';
// xxx.protocol.registerSchemesAsPrivileged([   /   (0, e.protocol.registerSchemesAsPrivileged)([   /   protocol.registerSchemesAsPrivileged([
const SCHEME_RE_SRC = String.raw`(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\bprotocol\s*\.\s*registerSchemesAsPrivileged\s*\)?\s*\(\s*\[`;
const SCHEME_ITEM = '...(function () { try { return [require("./agywe/scheme.js").privileged]; } catch (e) { return []; } })(),';
// 文件开头的 "use strict"（前面允许有 BOM、空白和注释；单双引号都行）
const STRICT_RE = /^(\uFEFF?(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*)(["'])use strict\2;?[ \t]*(\r?\n)?/;
const CUSTOM_SCHEME_RE = /\brequire\(\s*["']\.\/customScheme(?:\.js)?["']\s*\)/;
const ELECTRON_REQ_RE = /\brequire\(\s*["']electron["']\s*\)/;
const schemeHits = (src) => src.match(new RegExp(SCHEME_RE_SRC, "g")) || [];

function checkAnchors(main, scheme, preload) {
  const errs = [];
  if (!CUSTOM_SCHEME_RE.test(main)) errs.push("main.js 里没有找到 customScheme 引用");
  const n = schemeHits(scheme).length;
  if (n !== 1) errs.push("customScheme.js 里没有找到唯一的 registerSchemesAsPrivileged([（找到 " + n + " 处）");
  if (!ELECTRON_REQ_RE.test(preload)) errs.push("preload.js 结构不符（没有引用 electron）");
  if (!preload.includes("agent:update-active-count")) errs.push("preload.js 里没有 agent 计数接口（不影响壁纸，只影响 agent 联动）");
  return errs;
}

function patchMain(src) {
  const m = STRICT_RE.exec(src);
  if (!m) return HOOK_LINE + src;   // 没有 "use strict"：放在最前面
  const head = m[0];
  return head + (m[3] ? "" : "\n") + HOOK_LINE + src.slice(head.length);
}
function patchScheme(src) { return src.replace(new RegExp(SCHEME_RE_SRC), (m) => m + SCHEME_ITEM); }
function patchPreload(src, inject) { return src.replace(/\s*$/, "\n") + inject; }

function listPayload(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...listPayload(dir, r));
    else out.push(r);
  }
  return out;
}

/** 从一个（可能已打过补丁的）包还原出原版 overrides */
function pristineOverrides(a) {
  const ov = new Map();
  if (!nodeAt(a.header, MARK)) return ov;
  for (const p of PATCHED) {
    const orig = fileBytes(a, "dist/agywe/orig/" + path.posix.basename(p));
    if (!orig) throw new Error("已安装的包里缺少原文件备份 " + p + "，请用 restore 命令从整包备份恢复");
    ov.set(p, Buffer.from(orig));
  }
  ov.set("dist/agywe", null);
  return ov;
}

function buildInstall(pristine) {
  const read = (p) => fileBytes(pristine, p).toString("utf8");
  const main = read("dist/main.js"), scheme = read("dist/customScheme.js"), preload = read("dist/preload.js");
  const errs = checkAnchors(main, scheme, preload);
  const fatal = errs.filter((e) => !e.includes("不影响壁纸"));
  if (fatal.length) throw new Error("这个版本的 Antigravity 结构和插件预期不一致，为安全起见没有修改任何文件：\n  - " + fatal.join("\n  - "));
  errs.filter((e) => e.includes("不影响壁纸")).forEach((e) => warn(e));

  const inject = fs.readFileSync(path.join(PAYLOAD, "preload-inject.js"), "utf8");
  const ov = new Map();
  ov.set("dist/main.js", Buffer.from(patchMain(main), "utf8"));
  ov.set("dist/customScheme.js", Buffer.from(patchScheme(scheme), "utf8"));
  ov.set("dist/preload.js", Buffer.from(patchPreload(preload, inject), "utf8"));
  for (const p of PATCHED) ov.set("dist/agywe/orig/" + path.posix.basename(p), Buffer.from(fileBytes(pristine, p)));
  for (const rel of listPayload(PAYLOAD)) {
    if (rel === "preload-inject.js") continue;
    let data = fs.readFileSync(path.join(PAYLOAD, rel));
    if (rel === "hook.js") data = Buffer.from(data.toString("utf8").replace(/__AGYWE_VERSION__/g, AGYWE_VERSION), "utf8");
    ov.set("dist/agywe/" + rel, data);
  }
  const appVersion = JSON.parse(fileBytes(pristine, "package.json").toString("utf8")).version;
  ov.set(MARK, Buffer.from(JSON.stringify({ name: "agywe", version: AGYWE_VERSION, appVersion, installedAt: new Date().toISOString() }, null, 2)));
  return { overrides: ov, appVersion };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const info = (...a) => console.log("[agywe]", ...a);
const warn = (...a) => console.log("[agywe] ⚠", ...a);

function parseArgs(argv) {
  const out = { cmd: argv[0] || "status" };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--exe") out.exe = argv[++i];
    else if (argv[i] === "--dir") out.dir = argv[++i];
    else if (argv[i] === "--force") out.force = true;
  }
  return out;
}

function resolveDir(args) {
  if (args.dir) return path.resolve(args.dir);
  if (args.exe) return path.dirname(path.resolve(args.exe));
  const la = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
  return path.join(la, "Programs", "antigravity");
}

function runningPids() {
  if (process.platform !== "win32") return [];
  try {
    const out = cp.execFileSync("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq Antigravity.exe"], { encoding: "utf8", windowsHide: true });
    return out.split(/\r?\n/).map((l) => l.split('","')[1]).filter(Boolean).map(Number).filter((pid) => pid && pid !== process.pid && pid !== process.ppid);
  } catch { return []; }
}

function ensureClosed(force) {
  const pids = runningPids();
  if (!pids.length) return;
  if (force) {
    info("正在结束 Antigravity 进程:", pids.join(", "));
    try { cp.execFileSync("taskkill", ["/F", "/IM", "Antigravity.exe", "/FI", `PID ne ${process.pid}`], { windowsHide: true, stdio: "ignore" }); } catch { }
    const t = Date.now(); while (runningPids().length && Date.now() - t < 5000) { /* wait */ }
    if (!runningPids().length) return;
  }
  throw new Error("Antigravity 还在运行（进程 " + pids.join(", ") + "）。请先完全退出它（包括右下角托盘图标 → 退出），再重新运行。\n  也可以加 --force 让安装器自动结束它（未保存的内容会丢失）。");
}

function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const t = Date.now(); while (Date.now() - t < ms) { /* wait */ } }
}
// v0.8：替换 app.asar 时如果被别的程序占着（EPERM / EBUSY），等一等再试，最多 6 次
function renameRetry(from, to) {
  const WAIT = [1000, 2000, 3000, 4000, 5000];
  let last = null;
  for (let i = 0; i <= WAIT.length; i++) {
    try { fs.renameSync(from, to); if (i) info(`第 ${i + 1} 次替换成功`); return; }
    catch (e) {
      last = e;
      if (!/^(EPERM|EBUSY|EACCES)$/.test(String(e && e.code))) throw e;
      if (i === WAIT.length) break;
      if (i === 0) info("app.asar 正被别的程序占着，等一会儿再试…");
      else info(`还是被占着，${WAIT[i] / 1000} 秒后再试（第 ${i + 1}/${WAIT.length} 次）…`);
      sleepMs(WAIT[i]);
    }
  }
  const pids = runningPids();
  const lines = [
    `替换 app.asar 失败（${last && last.code}），它一直被别的程序占着。`,
    pids.length ? `  · 发现 Antigravity 还在运行（进程 ${pids.join(", ")}）：在右下角托盘图标上右键「退出」，或者加 --force。` : "  · Antigravity 已经退出了，占着它的是别的程序：",
    "  · 杀毒软件可能正在扫描刚写好的新文件，等半分钟再运行一次通常就好了；",
    "  · 资源管理器开着 Antigravity 的 resources 文件夹、或者预览窗格选中了 app.asar 时也会占着，关掉那个窗口；",
    "  · 还是不行就重启电脑后再装。",
    "  原来的 app.asar 没有动过，Antigravity 照常能用；留下的 app.asar.agywe-tmp 下次安装会直接覆盖，不用管。"
  ];
  throw new Error(lines.join("\n"));
}
function writeAtomic(target, buf) {
  const tmp = target + ".agywe-tmp";
  fs.writeFileSync(tmp, buf);
  const check = readAsar(tmp); // 写完先自检能不能解析
  if (!nodeAt(check.header, "package.json")) throw new Error("自检失败：新包里没有 package.json");
  renameRetry(tmp, target);
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------
function status(dir) {
  const asar = path.join(dir, "resources", "app.asar");
  if (!fs.existsSync(asar)) throw new Error("找不到 " + asar + "，请用 --exe 或 --dir 指定 Antigravity 的位置");
  const a = readAsar(asar);
  const pkg = JSON.parse(fileBytes(a, "package.json").toString("utf8"));
  const mark = fileBytes(a, MARK);
  info("Antigravity", pkg.version, "位于", dir);
  const fuses = readFuses(path.join(dir, "Antigravity.exe"));
  info("安全开关：" + fuseLine(fuses));
  if (mark) { const m = JSON.parse(mark.toString("utf8")); info("壁纸插件：已安装 v" + m.version + "（安装于 " + m.installedAt + "）"); }
  else info("壁纸插件：未安装");
  const bak = asar + ".agywe-backup";
  if (fs.existsSync(bak)) {
    try { const b = readAsar(bak); info("整包备份：", JSON.parse(fileBytes(b, "package.json").toString("utf8")).version, bak); } catch { info("整包备份：存在但无法解析", bak); }
  }
  return { a, pkg, installed: !!mark, fuses };
}

function install(dir, force) {
  const asar = path.join(dir, "resources", "app.asar");
  const { a, pkg, installed, fuses } = status(dir);
  if (fuses && fuses.found && fuses.asarIntegrity === true) {
    throw new Error("这个版本的 Antigravity 打开了「程序包完整性校验」（Electron 的 EnableEmbeddedAsarIntegrityValidation）。\n" +
      "  改动 app.asar 后它会直接启动失败，所以这次没有修改任何文件，Antigravity 照常能用。\n" +
      "  插件暂时没法装在这个版本上，等插件更新吧。");
  }
  if (fuses && !fuses.found) warn("没读到 Antigravity.exe 的安全开关，继续安装。万一装完打不开，运行 uninstall.cmd 或 restore-backup.cmd 还原。");
  ensureClosed(force);
  let pristine = a;
  if (installed) {
    info("检测到旧版插件，先还原再重新安装…");
    pristine = { ...readAsarFromBuffer(repack(a, pristineOverrides(a))) };
  } else {
    const bak = asar + ".agywe-backup";
    fs.copyFileSync(asar, bak);
    info("已备份原版程序包 →", bak);
  }
  const { overrides, appVersion } = buildInstall(pristine);
  const out = repack(pristine, overrides);
  writeAtomic(asar, out);
  info(`✅ 安装完成：插件 v${AGYWE_VERSION} → Antigravity ${appVersion}（程序包 ${(a.buf.length / 1048576).toFixed(1)}MB → ${(out.length / 1048576).toFixed(1)}MB）`);
  autofixOff(false);
  info("现在打开 Antigravity，点窗口顶部垂下来的挂件（或按 Ctrl+Alt+W）打开壁纸设置。");
  info("Antigravity 第一次启动可能会稍慢几秒；如果出现任何问题，运行 uninstall.cmd 即可还原。");
  void pkg;
}

function readAsarFromBuffer(buf) {
  const headerSize = buf.readUInt32LE(4);
  const strLen = buf.readUInt32LE(12);
  return { buf, header: JSON.parse(buf.subarray(16, 16 + strLen).toString("utf8")), base: 8 + headerSize };
}

function uninstall(dir, force) {
  const asar = path.join(dir, "resources", "app.asar");
  const { a, installed } = status(dir);
  if (!installed) { autofixOff(true); removeRunKey(); info("没有安装插件，不需要卸载。"); return; }
  ensureClosed(force);
  const out = repack(a, pristineOverrides(a));
  writeAtomic(asar, out);
  autofixOff(true); removeRunKey();
  info("✅ 已卸载，Antigravity 恢复原版。壁纸设置保留在 %APPDATA%\\Antigravity\\agywe（可手动删除）。");
}

function restore(dir, force) {
  const asar = path.join(dir, "resources", "app.asar");
  const bak = asar + ".agywe-backup";
  if (!fs.existsSync(bak)) throw new Error("没有整包备份：" + bak);
  const cur = readAsar(asar);
  const b = readAsar(bak);
  const vc = JSON.parse(fileBytes(cur, "package.json").toString("utf8")).version;
  const vb = JSON.parse(fileBytes(b, "package.json").toString("utf8")).version;
  if (vc !== vb && !force) throw new Error(`备份是 ${vb}，当前是 ${vc}，版本不一致，不建议用备份覆盖。确实要这样做请加 --force。`);
  ensureClosed(false);
  fs.copyFileSync(bak, asar);
  autofixOff(true); removeRunKey();
  info("✅ 已用整包备份覆盖 app.asar（" + vb + "）");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveDir(args);
  try {
    if (args.cmd === "install") install(dir, args.force);
    else if (args.cmd === "uninstall") uninstall(dir, args.force);
    else if (args.cmd === "restore") restore(dir, args.force);
    else status(dir);
  } catch (e) {
    console.log("[agywe] ❌ " + (e && e.message || e));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { readAsar, readAsarFromBuffer, repack, fileBytes, nodeAt, buildInstall, pristineOverrides, checkAnchors, patchMain, patchScheme, readFuses, parseFuseWire, fuseLine };
