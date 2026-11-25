#!/usr/bin/env node
"use strict";
/*
 * agywe 冒烟测试（v0.11.1 起）
 *   双击 test.cmd 运行（用 Antigravity.exe 自己当 Node，不需要单独装 Node.js）。
 *   只读：不改 Antigravity、不改你的设置；临时文件写在 test\.tmp-* 里，跑完删掉。
 *   结果同时写到 test\smoke-last.log。
 *
 * 覆盖：
 *   1. 所有脚本能通过语法检查，页面引用的文件都在
 *   2. 安装器：模拟程序包上 装上 → 卸载 → 重装，结构不符时拒绝改动，安全开关解析
 *   3. 接口守卫：会改东西的接口都要令牌（或同源 JSON），带令牌的页面不开放跨源
 *   4. 配置：合并规则、并发写盘不丢不报错、你电脑上的 config.json 能正常读
 *   5. 设置页保存队列：防抖合并、一次只发一个、过期响应不覆盖、失败不吞
 *   6. 你电脑上的 Antigravity 程序包还能不能装（只在内存里演练，不写盘）
 */
try { process.noAsar = true; } catch { }
let fs;
try { fs = require("original-fs"); } catch { fs = require("fs"); }
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const PAYLOAD = path.join(ROOT, "payload");
const MARK = "dist/agywe/manifest.json";
const TMP = path.join(__dirname, ".tmp-" + process.pid);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const VER = (/AGYWE_VERSION = "([^"]+)"/.exec(read("install.cjs")) || [])[1] || "?";
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const eqJ = (a, b, msg) => assert.strictEqual(J(a), J(b), msg);

const logLines = [];
const log = (s) => { console.log(s); logLines.push(s); };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
class Skip extends Error { }
const skip = (why) => { throw new Skip(why); };
function quiet(fn) {
  const o = console.log; console.log = () => { };
  try { return fn(); } finally { console.log = o; }
}
function ensureTmp() { fs.mkdirSync(TMP, { recursive: true }); return TMP; }

function listFiles(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r)); else out.push(r);
  }
  return out;
}

// ---- 从 hook.js 里按名字抠出顶层声明（hook.js 依赖 Electron，没法整体加载）----
function matchBrace(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  throw new Error("括号不配对");
}
function matchParen(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  throw new Error("圆括号不配对");
}
function extractDecl(src, name) {
  const re = new RegExp("(^|\\n)((?:async\\s+)?function\\s+" + name + "\\s*\\(|const\\s+" + name + "\\s*=)");
  const m = re.exec(src);
  if (!m) throw new Error("hook.js 里找不到 " + name + "（被改名了？）");
  const start = m.index + m[1].length;
  const isFn = m[2].includes("function");
  const from = isFn ? matchParen(src, start + m[2].length - 1) : start + m[2].length - 1;
  const end = matchBrace(src, src.indexOf("{", from));
  let s = src.slice(start, end + 1);
  if (src[end + 1] === ";") s += ";";
  return s;
}
// 在独立环境里运行抠出来的代码，取出指定的名字
function compileSnippet(code, names, globals) {
  const ctx = Object.assign({}, globals || {}, { __out: null });
  vm.runInNewContext(code + "\n;__out = ({ " + names.join(", ") + " });", ctx, { filename: "hook.js(片段)" });
  return ctx.__out;
}
const hookSrc = () => read("payload/hook.js");

// ===========================================================================
// 1. 语法和引用
// ===========================================================================
test("所有脚本语法正确", () => {
  const files = [...listFiles(PAYLOAD).filter((f) => /\.(c?js)$/.test(f)).map((f) => "payload/" + f), "install.cjs", "test/smoke.cjs"];
  for (const rel of files) {
    const src = read(rel).replace(/^#!.*/, "");
    try { new vm.Script("(function (exports, require, module, __filename, __dirname) {" + src + "\n})", { filename: rel }); }
    catch (e) { throw new Error(rel + "：" + e.message); }
  }
  return files.length + " 个文件";
});

test("页面引用的文件都在，令牌占位符正确", () => {
  const appDir = path.join(PAYLOAD, "app");
  const pages = fs.readdirSync(appDir).filter((f) => /\.html$/i.test(f));
  let refs = 0;
  for (const f of pages) {
    const html = fs.readFileSync(path.join(appDir, f), "utf8");
    for (const m of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/gi)) {
      const u = m[1];
      if (/^(?:[a-z]+:|\/\/|#)/i.test(u)) continue;
      refs++;
      assert.ok(fs.existsSync(path.join(appDir, u.split(/[?#]/)[0])), f + " 引用的 " + u + " 不存在");
    }
    if (/name="agywe-token"/.test(html)) assert.ok(html.includes('content="__AGYWE_TOKEN__"'), f + " 的令牌占位符不对");
  }
  const s = fs.readFileSync(path.join(appDir, "settings.html"), "utf8");
  const a = s.indexOf('src="savequeue.js"'), b = s.indexOf('src="settings.js"');
  assert.ok(a >= 0 && b > a, "settings.html 必须先加载 savequeue.js 再加载 settings.js");
  return pages.length + " 个页面、" + refs + " 处引用";
});

// ===========================================================================
// 2. 安装器
// ===========================================================================
function fakeAsar(I, files, extraHeader) {
  const a = { header: { files: JSON.parse(J(extraHeader || {})) }, buf: Buffer.alloc(0), base: 0 };
  return I.readAsarFromBuffer(I.repack(a, new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, "utf8")]))));
}
const FAKE = {
  "package.json": J({ name: "antigravity", version: "9.9.9" }),
  "dist/main.js": '"use strict";\nconst customScheme_1 = require("./customScheme");\nconsole.log("main");\n',
  "dist/customScheme.js": '"use strict";\nconst electron_1 = require("electron");\nelectron_1.protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true } }]);\n',
  "dist/preload.js": '"use strict";\nconst { ipcRenderer } = require("electron");\nipcRenderer.on("agent:update-active-count", () => { });\n',
  "dist/other.js": "module.exports = 42;\n"
};
const UNPACKED = { native: { files: { "a.node": { size: 3, unpacked: true } } } };
const PATCHED = ["dist/main.js", "dist/customScheme.js", "dist/preload.js"];

test("安装器：模拟程序包上 装上 → 卸载 → 重装", () => {
  const I = require(path.join(ROOT, "install.cjs"));
  const pristine = fakeAsar(I, FAKE, UNPACKED);
  for (const [k, v] of Object.entries(FAKE)) assert.strictEqual(I.fileBytes(pristine, k).toString("utf8"), v, "打包往返后 " + k + " 变了");

  // 装上
  const { overrides, appVersion } = quiet(() => I.buildInstall(pristine));
  assert.strictEqual(appVersion, "9.9.9");
  const inst = I.readAsarFromBuffer(I.repack(pristine, overrides));
  const txt = (a, p) => { const b = I.fileBytes(a, p); assert.ok(b, "包里缺少 " + p); return b.toString("utf8"); };
  assert.strictEqual(JSON.parse(txt(inst, MARK)).version, VER, "manifest 版本不对");
  const mainLines = txt(inst, "dist/main.js").split("\n");
  assert.strictEqual(mainLines[0], '"use strict";', "main.js 第一行应保持 use strict");
  assert.ok(mainLines[1].includes('require("./agywe/hook.js")'), "main.js 第二行应是挂钩");
  const sch = txt(inst, "dist/customScheme.js");
  assert.strictEqual(sch.split('require("./agywe/scheme.js")').length - 1, 1, "协议声明应插入且只插一次");
  assert.ok(/registerSchemesAsPrivileged\(\[\.\.\.\(function/.test(sch), "协议声明位置不对");
  const inject = fs.readFileSync(path.join(PAYLOAD, "preload-inject.js"), "utf8");
  const pre = txt(inst, "dist/preload.js");
  assert.ok(pre.startsWith(FAKE["dist/preload.js"].trimEnd()) && pre.endsWith(inject), "preload.js 应是原文 + 注入脚本");
  for (const p of PATCHED) assert.strictEqual(txt(inst, "dist/agywe/orig/" + path.posix.basename(p)), FAKE[p], "原文件备份不对：" + p);
  const payloadFiles = listFiles(PAYLOAD).filter((f) => f !== "preload-inject.js");
  for (const rel of payloadFiles) assert.ok(I.fileBytes(inst, "dist/agywe/" + rel), "包里缺少插件文件 " + rel);
  const hk = txt(inst, "dist/agywe/hook.js");
  assert.ok(!hk.includes("__AGYWE_VERSION__") && hk.includes('"' + VER + '"'), "hook.js 版本号没替换");
  const mn = I.nodeAt(inst.header, "dist/main.js");
  assert.ok(mn.integrity && mn.integrity.hash === sha256(I.fileBytes(inst, "dist/main.js")), "main.js 完整性哈希不对");
  assert.ok(I.nodeAt(inst.header, "native/a.node").unpacked === true, "unpacked 条目丢了");
  assert.strictEqual(txt(inst, "dist/other.js"), FAKE["dist/other.js"], "无关文件被改了");

  // 卸载
  const un = I.readAsarFromBuffer(I.repack(inst, I.pristineOverrides(inst)));
  assert.strictEqual(I.nodeAt(un.header, "dist/agywe"), null, "卸载后还留着 dist/agywe");
  for (const p of PATCHED) assert.strictEqual(txt(un, p), FAKE[p], "卸载后没还原：" + p);
  assert.ok(I.nodeAt(un.header, "native/a.node").unpacked === true, "卸载后 unpacked 条目丢了");

  // 在已安装的包上重装：不能重复插入
  const p2 = I.readAsarFromBuffer(I.repack(inst, I.pristineOverrides(inst)));
  const inst2 = I.readAsarFromBuffer(I.repack(p2, quiet(() => I.buildInstall(p2)).overrides));
  assert.strictEqual(txt(inst2, "dist/customScheme.js").split('require("./agywe/scheme.js")').length - 1, 1, "重装后协议声明重复了");
  assert.strictEqual(txt(inst2, "dist/main.js").split('require("./agywe/hook.js")').length - 1, 1, "重装后挂钩重复了");
  return payloadFiles.length + " 个插件文件，卸载后 3 个文件逐字节还原";
});

test("安装器：程序结构不符时拒绝改动", () => {
  const I = require(path.join(ROOT, "install.cjs"));
  const bad = (patch, label) => {
    const a = fakeAsar(I, { ...FAKE, ...patch });
    assert.throws(() => quiet(() => I.buildInstall(a)), /没有修改任何文件/, label + " 时应该拒绝安装");
  };
  bad({ "dist/customScheme.js": '"use strict";\nmodule.exports = {};\n' }, "找不到协议注册");
  bad({ "dist/customScheme.js": FAKE["dist/customScheme.js"] + FAKE["dist/customScheme.js"] }, "协议注册有两处");
  bad({ "dist/main.js": '"use strict";\nconsole.log(1);\n' }, "main.js 不引用 customScheme");
  bad({ "dist/preload.js": '"use strict";\nconsole.log(1);\n' }, "preload.js 不引用 electron");
  // 缺 agent 计数接口只影响联动，应该照常能装
  const ok = fakeAsar(I, { ...FAKE, "dist/preload.js": '"use strict";\nrequire("electron");\n' });
  quiet(() => I.buildInstall(ok));
  return "4 种异常结构都拦住了";
});

test("安装器：安全开关（fuses）解析", () => {
  const I = require(path.join(ROOT, "install.cjs"));
  const wire = Buffer.from([1, 9, ..."101011r00"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0))));
  const f = I.parseFuseWire(wire);
  eqJ([f.runAsNode, f.cookieEncryption, f.nodeOptions, f.nodeCliInspect, f.asarIntegrity, f.onlyLoadAppFromAsar, f.browserV8Snapshot, f.fileProtocolPrivileges, f.wasmTrapHandlers],
    [true, false, true, false, true, true, null, false, false]);
  // 标志串正好跨过 8MB 读块边界
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "latin1");
  const file = path.join(ensureTmp(), "fake.exe");
  const at = 8 * 1024 * 1024 - 10;
  const buf = Buffer.alloc(at + sentinel.length + 64, 0x41);
  sentinel.copy(buf, at);
  Buffer.from([1, 9, ..."000010000"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0)))).copy(buf, at + sentinel.length);
  fs.writeFileSync(file, buf);
  const r = I.readFuses(file);
  assert.ok(r.found && r.asarIntegrity === true && r.runAsNode === false, "跨块的开关没读对：" + J(r));
  assert.ok(!I.readFuses(path.join(TMP, "nope.exe")).found);
  return "跨读块边界也能读到";
});

// ===========================================================================
// 3. 接口守卫
// ===========================================================================
test("接口守卫：会改东西的接口都要令牌", () => {
  const src = hookSrc();
  const a = src.indexOf("async function handleApi(");
  assert.ok(a > 0, "找不到 handleApi");
  const gate = src.indexOf('if (!tokenOk(request)) return json({ error: "forbidden" }, 403);', a);
  assert.ok(gate > a, "handleApi 里找不到令牌检查");
  const before = src.slice(a, gate);
  const writes = [...before.matchAll(/sub === "([^"]+)" && \(?method === "(POST|PUT|DELETE|PATCH)"/g)].map((m) => m[1]);
  const ALLOW = ["system/media-control"];
  const extra = writes.filter((w) => !ALLOW.includes(w));
  assert.strictEqual(extra.length, 0, "这些会改东西的接口排在令牌检查前面：" + extra.join(", "));
  for (const w of writes) {
    const i = before.indexOf('sub === "' + w + '"');
    const block = before.slice(i, before.indexOf("\n  }", i));
    assert.ok(block.includes("sameOriginWrite(request)"), w + " 没有同源检查");
  }
  assert.ok(!/method === "OPTIONS"/.test(src), "hook.js 开始应答预检请求了：令牌头 + 不答预检 是现在防跨源的前提，改之前请重新审一遍");
  return "令牌检查前只有 " + writes.join(", ") + "，且有同源检查";
});

test("接口守卫：同源检查的判断", () => {
  const { sameOriginWrite } = compileSnippet(extractDecl(hookSrc(), "sameOriginWrite"), ["sameOriginWrite"], { ORIGIN: "agywe://app" });
  const req = (h) => ({ headers: { get: (k) => (h[k.toLowerCase()] === undefined ? null : h[k.toLowerCase()]) } });
  const cases = [
    [{ "content-type": "application/json" }, true],
    [{ "content-type": "application/json; charset=utf-8", origin: "agywe://app" }, true],
    [{ "content-type": "text/plain" }, false],
    [{}, false],
    [{ "content-type": "application/json", origin: "null" }, false],
    [{ "content-type": "application/json", origin: "https://example.com" }, false]
  ];
  for (const [h, want] of cases) assert.strictEqual(sameOriginWrite(req(h)), want, "判断错了：" + J(h));
  return cases.length + " 种请求";
});

test("接口守卫：带令牌的页面和配置不开放跨源读取", () => {
  const src = hookSrc();
  const i = src.indexOf("replace(/__AGYWE_TOKEN__/g");
  assert.ok(i > 0, "找不到令牌替换");
  const resp = src.slice(i, src.indexOf("\n", src.indexOf("\n", i) + 1));
  assert.ok(!/Access-Control-Allow-Origin/i.test(resp), "带令牌的页面加了跨源头");
  assert.ok(src.includes('if (sub === "config" && method === "GET") return json(loadConfig());'), "配置读取接口变了，请确认没有加跨源头");
  assert.ok(!/Access-Control/i.test(extractDecl(src, "json")), "json() 默认带了跨源头");
  const sch = read("payload/scheme.js");
  assert.ok(/scheme:\s*"agywe"/.test(sch) && /standard:\s*true/.test(sch) && /secure:\s*true/.test(sch), "协议声明变了");
});

// ===========================================================================
// 4. 配置
// ===========================================================================
test("配置：合并规则", () => {
  const src = hookSrc();
  const { DEFAULTS, mergeConfig } = compileSnippet(extractDecl(src, "DEFAULTS") + "\n" + extractDecl(src, "mergeConfig"), ["DEFAULTS", "mergeConfig"], {});
  const before = J(DEFAULTS);
  assert.ok(!("error" in DEFAULTS), "配置里不能有 error 这一项（设置页靠它判断保存失败）");
  assert.strictEqual(mergeConfig(DEFAULTS, { notAKey: 1 }).notAKey, undefined, "未知的项应该丢掉");
  const objKey = Object.keys(DEFAULTS).find((k) => DEFAULTS[k] && typeof DEFAULTS[k] === "object" && !Array.isArray(DEFAULTS[k]) && Object.keys(DEFAULTS[k]).length >= 2);
  if (objKey) {
    const [k1, k2] = Object.keys(DEFAULTS[objKey]);
    const m = mergeConfig(DEFAULTS, { [objKey]: { [k1]: "__x__" } });
    assert.strictEqual(m[objKey][k1], "__x__");
    eqJ(m[objKey][k2], DEFAULTS[objKey][k2], "嵌套项应该只改动传进来的子项");
  }
  eqJ(mergeConfig(DEFAULTS, { glassForce: ["a"] }).glassForce, ["a"], "数组应该整个替换");
  assert.strictEqual(J(DEFAULTS), before, "合并改动了默认配置");
  return Object.keys(DEFAULTS).length + " 项默认配置";
});

test("配置：并发保存写盘不丢、不报错", async () => {
  const src = hookSrc();
  const { makeConfigWriter } = compileSnippet(extractDecl(src, "makeConfigWriter"), ["makeConfigWriter"], { process: { pid: process.pid }, setTimeout, Promise });
  const write = makeConfigWriter(fs.promises, path);
  const dir = path.join(ensureTmp(), "cfg");
  const file = path.join(dir, "config.json");
  const N = 30;
  const jobs = [];
  for (let n = 0; n < N; n++) jobs.push(write(file, J({ n, pad: "x".repeat(2000 + n) })));
  const res = await Promise.allSettled(jobs);
  const bad = res.filter((r) => r.status !== "fulfilled");
  assert.strictEqual(bad.length, 0, bad.length + " 次写入失败：" + (bad[0] && bad[0].reason));
  assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).n, N - 1, "最后一次写入没留下来");
  const left = fs.readdirSync(dir).filter((f) => f !== "config.json");
  assert.strictEqual(left.length, 0, "留下了临时文件：" + left.join(", "));
  return N + " 次同时写入";
});

test("配置：你电脑上的 config.json 能正常读取", () => {
  const appData = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming") : "");
  const file = appData && path.join(appData, "Antigravity", "agywe", "config.json");
  if (!file || !fs.existsSync(file)) skip("没找到 %APPDATA%\\Antigravity\\agywe\\config.json");
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { throw new Error("config.json 解析失败（插件会悄悄退回默认设置）：" + e.message); }
  assert.ok(saved && typeof saved === "object" && !Array.isArray(saved), "config.json 不是一个对象");
  const src = hookSrc();
  const { DEFAULTS, mergeConfig } = compileSnippet(extractDecl(src, "DEFAULTS") + "\n" + extractDecl(src, "mergeConfig"), ["DEFAULTS", "mergeConfig"], {});
  const merged = JSON.parse(J(mergeConfig(DEFAULTS, saved)));
  const unknown = Object.keys(saved).filter((k) => !(k in DEFAULTS));
  const size = fs.statSync(file).size;
  return `${Object.keys(merged).length} 项、${(size / 1024).toFixed(1)} KB` + (unknown.length ? `，${unknown.length} 项已不再使用（${unknown.slice(0, 6).join(", ")}${unknown.length > 6 ? "…" : ""}）` : "");
});

// ===========================================================================
// 5. 设置页保存队列
// ===========================================================================
test("设置保存队列", async () => {
  const { createSaveQueue, mergePatch } = require(path.join(PAYLOAD, "app", "savequeue.js"));
  eqJ(mergePatch({ props: { a: 1 }, x: [1] }, { props: { b: 2 }, x: [2] }), { props: { a: 1, b: 2 }, x: [2] });

  const mk = (sendImpl) => {
    const rec = { sent: [], saved: [], errors: [], live: 0, maxLive: 0 };
    const q = createSaveQueue({
      delay: 15,
      send: async (p) => { rec.sent.push(p); rec.live++; rec.maxLive = Math.max(rec.maxLive, rec.live); try { return await sendImpl(p, rec.sent.length); } finally { rec.live--; } },
      onSaved: (c) => rec.saved.push(c),
      onError: (e, p, idle) => rec.errors.push({ msg: e.message, p, idle })
    });
    return { q, rec };
  };

  // 防抖合并成一次
  { const { q, rec } = mk(async (p) => p); q.save({ a: 1 }); q.save({ b: 2 }); await sleep(60); eqJ(rec.sent, [{ a: 1, b: 2 }]); }

  // 一次只发一个，顺序不乱；「立即保存」会带上还在防抖里的修改
  {
    const { q, rec } = mk(async (p) => { await sleep(10 + Math.random() * 20); return p; });
    q.save({ x: 1 }, true); q.save({ y: 2 }); q.save({ z: 3 }, true); q.save({ w: 4 }, true);
    await q.flush();
    assert.strictEqual(rec.maxLive, 1, "同时有 " + rec.maxLive + " 个请求在路上");
    eqJ(rec.sent, [{ x: 1 }, { y: 2, z: 3 }, { w: 4 }]);
    eqJ(rec.saved, [{ w: 4 }], "只应该用最后一次的响应更新界面");
  }

  // 慢的旧响应不覆盖新的
  {
    const { q, rec } = mk(async (p, n) => { await sleep(n === 1 ? 50 : 1); return { v: p.v }; });
    q.save({ v: 1 }, true); q.save({ v: 2 }, true);
    await q.flush();
    eqJ(rec.saved, [{ v: 2 }]);
    assert.strictEqual(q.stats.dropped, 1);
  }

  // 失败不吞，之后照常能保存
  {
    const { q, rec } = mk(async (p) => { if (p.bad) throw new Error("forbidden"); return p; });
    assert.strictEqual(await q.save({ bad: 1 }, true), false);
    eqJ(rec.errors, [{ msg: "forbidden", p: { bad: 1 }, idle: true }]);
    assert.strictEqual(await q.save({ good: 1 }, true), true);
    eqJ(rec.saved, [{ good: 1 }]);
  }

  // 嵌套项合并、空保存不发请求、flush 立刻发出防抖里的修改
  {
    const { q, rec } = mk(async (p) => p);
    q.save({ props: { a: 1 } }); q.save({ props: { b: 2 } });
    await q.flush();
    eqJ(rec.sent, [{ props: { a: 1, b: 2 } }]);
    await q.save({}, true);
    assert.strictEqual(rec.sent.length, 1, "空保存不应该发请求");
    assert.ok(q.idle());
  }

  // 设置页确实在用这个队列
  const s = read("payload/app/settings.js");
  assert.ok(s.includes("agyweSaveQueue.createSaveQueue") && !/cfg = await post\("config"/.test(s), "settings.js 没有用保存队列");
  return "防抖、串行、过期响应、失败、嵌套合并都对";
});

// ===========================================================================
// 6. 本机 Antigravity（只读，在内存里演练安装）
// ===========================================================================
test("本机 Antigravity 程序包还能正常安装（只在内存里演练）", () => {
  const I = require(path.join(ROOT, "install.cjs"));
  let dir = null;
  try { const p = fs.readFileSync(path.join(ROOT, "antigravity-path.txt"), "utf8").trim(); if (p) dir = /\.exe$/i.test(p) ? path.dirname(p) : p; } catch { }
  if (!dir || !fs.existsSync(path.join(dir, "resources", "app.asar"))) {
    const la = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
    dir = la ? path.join(la, "Programs", "antigravity") : null;
  }
  const asar = dir && path.join(dir, "resources", "app.asar");
  if (!asar || !fs.existsSync(asar)) skip("没找到 Antigravity 的 app.asar");
  const a = I.readAsar(asar);
  const pkg = JSON.parse(I.fileBytes(a, "package.json").toString("utf8"));
  const markBuf = I.fileBytes(a, MARK);
  const mark = markBuf ? JSON.parse(markBuf.toString("utf8")) : null;
  const pristine = mark ? I.readAsarFromBuffer(I.repack(a, I.pristineOverrides(a))) : a;
  const t = (p) => I.fileBytes(pristine, p).toString("utf8");
  const errs = I.checkAnchors(t("dist/main.js"), t("dist/customScheme.js"), t("dist/preload.js"));
  const fatal = errs.filter((e) => !e.includes("不影响壁纸"));
  assert.strictEqual(fatal.length, 0, "Antigravity " + pkg.version + " 的结构和插件预期不一致，先别装：" + fatal.join("；"));
  const { overrides } = quiet(() => I.buildInstall(pristine));
  const out = I.repack(pristine, overrides);
  const back = I.readAsarFromBuffer(out);
  assert.ok(I.nodeAt(back.header, "package.json") && I.fileBytes(back, MARK), "演练出来的新包解析失败");
  const fuses = I.readFuses(path.join(dir, "Antigravity.exe"));
  assert.ok(!(fuses.found && fuses.asarIntegrity === true), "Antigravity 打开了程序包完整性校验，装上会启动失败");
  const parts = ["Antigravity " + pkg.version];
  parts.push(mark ? "已装插件 v" + mark.version + (mark.version !== VER ? "（这里是 v" + VER + "，运行 install.cmd 更新）" : "") : "未安装插件");
  parts.push("演练安装 " + (a.buf.length / 1048576).toFixed(1) + "MB → " + (out.length / 1048576).toFixed(1) + "MB");
  if (errs.length > fatal.length) parts.push("提示：" + errs.filter((e) => e.includes("不影响壁纸")).join("；"));
  return parts.join("，");
});

// ===========================================================================
(async () => {
  log(`agywe 冒烟测试 · 插件 v${VER} · ${new Date().toLocaleString()} · Node ${process.versions.node}${process.versions.electron ? " / Electron " + process.versions.electron : ""}`);
  log("");
  let pass = 0, fail = 0, skipped = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      const note = await t.fn();
      pass++;
      log(`✅ ${t.name}${note ? "：" + note : ""}（${Date.now() - t0}ms）`);
    } catch (e) {
      if (e instanceof Skip) { skipped++; log(`⏭  ${t.name}：跳过（${e.message}）`); }
      else { fail++; log(`❌ ${t.name}\n   ${String((e && e.message) || e)}`); }
    }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { }
  log("");
  log(`结果：${pass} 通过，${fail} 失败，${skipped} 跳过`);
  try { fs.writeFileSync(path.join(__dirname, "smoke-last.log"), logLines.join("\n") + "\n", "utf8"); } catch { }
  process.exitCode = fail ? 1 : 0;
})();
