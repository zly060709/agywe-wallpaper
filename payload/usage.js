"use strict";
// v0.11 用量统计：只读本机 ~/.gemini/antigravity/conversations/<对话id>.db（Antigravity 自己存的每次模型调用记录）
// 不联网、不读登录信息。每个对话读过的部分记在 agywe/usage-cache.json，之后只读新增的几行。
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

let DatabaseSync = null, sqliteErr = "";
try { DatabaseSync = require("node:sqlite").DatabaseSync; } catch (e) { sqliteErr = String(e && e.message || e); }

const ROOT = path.join(os.homedir(), ".gemini", "antigravity");
const CONV = path.join(ROOT, "conversations");
const SUMMARY_DB = path.join(ROOT, "conversation_summaries.db");
const HEAD = 32768;          // 一行只读前 32KB，用量字段都在前面；读不到再整行读
const CACHE_V = 1;

let cacheFile = "";
let cache = { v: CACHE_V, files: {} };   // cid -> { sig, last, rows: [[idx, t, in, cache, out, think, model, max, ttft, stream]] }
let cacheDirty = false, cacheLoaded = false, saveT = null;
let models = [];             // rows 里的 model 是这里的下标
let log = () => { };
let scanning = null, lastFull = 0, titles = new Map(), titlesAt = 0;

function init(opts) {
  cacheFile = path.join(opts.dir, "usage-cache.json");
  if (typeof opts.log === "function") log = opts.log;
}
function available() { return !!DatabaseSync; }

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (j && j.v === CACHE_V && j.files && Array.isArray(j.models)) { cache = { v: CACHE_V, files: j.files }; models = j.models; }
  } catch { }
}
function saveSoon() {
  cacheDirty = true;
  if (saveT) return;
  saveT = setTimeout(async () => {
    saveT = null;
    if (!cacheDirty || !cacheFile) return;
    cacheDirty = false;
    try {
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
      await fsp.writeFile(cacheFile + ".tmp", JSON.stringify({ v: CACHE_V, models, files: cache.files }), "utf8");
      await fsp.rename(cacheFile + ".tmp", cacheFile);
    } catch (e) { log("[usage] 缓存写入失败 " + (e && e.message || e)); }
  }, 4000);
}
function modelId(name) {
  name = String(name || "");
  let i = models.indexOf(name);
  if (i < 0) { models.push(name); i = models.length - 1; }
  return i;
}

// ---- protobuf 解码（只取需要的字段；长度超出时截到现有部分，用来解析只读了一半的行）----
function readVarint(buf, st) {
  let v = 0, mul = 1, b, n = 0;
  do {
    if (st.i >= buf.length) { st.bad = true; return 0; }
    b = buf[st.i++];
    if (n < 8) { v += (b & 0x7f) * mul; mul *= 128; }   // 只算前 56 位，后面的字节照样跳过（-1 这种 10 字节的也能对齐）
    n++;
  } while (b & 0x80 && n < 10);
  return v;
}
function fields(buf) {
  const out = [];
  if (!buf || !buf.length) return out;
  const st = { i: 0, bad: false };
  while (st.i < buf.length) {
    const tag = readVarint(buf, st); if (st.bad) break;
    const fn = Math.floor(tag / 8), wt = tag % 8;
    if (fn <= 0) break;
    if (wt === 0) { const v = readVarint(buf, st); if (st.bad) break; out.push([fn, v]); }
    else if (wt === 2) { const len = readVarint(buf, st); if (st.bad) break; const end = Math.min(buf.length, st.i + len); out.push([fn, buf.subarray(st.i, end), end - st.i < len]); st.i += len; }
    else if (wt === 1) st.i += 8;
    else if (wt === 5) st.i += 4;
    else break;
  }
  return out;
}
const isBuf = (v) => v && typeof v === "object" && typeof v.length === "number";
function get(fs_, fn) { for (const f of fs_) if (f[0] === fn) return f[1]; return undefined; }
function num(v) { return typeof v === "number" ? v : 0; }
const dec = new TextDecoder();
function str(v) { try { return isBuf(v) ? dec.decode(v) : ""; } catch { return ""; } }
function dur(v) { if (!isBuf(v)) return 0; const f = fields(v); return num(get(f, 1)) + num(get(f, 2)) / 1e9; }

// 一条 gen_metadata：输入 / 缓存命中 / 输出 / 思考 token，上下文上限，首字延迟，生成用时，模型名，对应哪一步
function parseGen(data) {
  const top = fields(data);
  const chatRaw = get(top, 1);
  if (!isBuf(chatRaw)) return null;
  const chat = fields(chatRaw);
  const uRaw = get(chat, 4);
  if (!isBuf(uRaw)) return { noUsage: true, truncated: top.some((f) => f[2]) };
  const u = fields(uRaw);
  let max = 0;
  const cs = get(chat, 9);
  if (isBuf(cs)) { const w = get(fields(cs), 10); if (isBuf(w)) max = num(get(fields(w), 4)); }
  let step = -1;
  for (const f of chat) {
    if (f[0] !== 20 || !isBuf(f[1])) continue;
    const kv = fields(f[1]);
    if (str(get(kv, 1)) === "last_step_index") { step = parseInt(str(get(kv, 2)), 10); if (!isFinite(step)) step = -1; break; }
  }
  return {
    in: num(get(u, 2)), out: num(get(u, 3)), cache: num(get(u, 5)), think: num(get(u, 9)),
    max, ttft: dur(get(chat, 11)), stream: dur(get(chat, 12)),
    model: str(get(chat, 21)) || str(get(chat, 19)), step
  };
}
function stepTime(meta) {
  if (!isBuf(meta)) return 0;
  const t = get(fields(meta), 1);
  return isBuf(t) ? num(get(fields(t), 1)) : 0;
}

function statSig(file) {
  let a = null, b = null;
  try { a = fs.statSync(file); } catch { return ""; }
  try { b = fs.statSync(file + "-wal"); } catch { }
  return a.size + ":" + Math.floor(a.mtimeMs) + (b ? "|" + b.size + ":" + Math.floor(b.mtimeMs) : "");
}
function openRO(file) {
  try { return new DatabaseSync(file, { readOnly: true, timeout: 300 }); }
  catch { return new DatabaseSync(file, { readOnly: true }); }
}

// 读一个对话库里新增的调用（同步，单个库一般几毫秒，大的几十毫秒）
function refreshFile(cid, force) {
  if (!DatabaseSync) return null;
  loadCache();
  const file = path.join(CONV, cid + ".db");
  const sig = statSig(file);
  if (!sig) return null;
  let ent = cache.files[cid];
  if (ent && ent.sig === sig && !force) return ent;
  if (!ent) ent = cache.files[cid] = { sig: "", last: -1, rows: [], mt: 0 };
  let db = null;
  const t0 = Date.now();
  try {
    db = openRO(file);
    const from = Math.max(0, ent.last);    // 最后一行可能还在写，重读一遍
    const rows = db.prepare("SELECT idx, substr(data, 1, " + HEAD + ") AS d FROM gen_metadata WHERE idx >= ? ORDER BY idx ASC").all(from);
    const parsed = [];
    let needSteps = Infinity;
    for (const r of rows) {
      let p = parseGen(r.d);
      if (p && p.noUsage && p.truncated) {
        try { const full = db.prepare("SELECT data FROM gen_metadata WHERE idx = ?").get(r.idx); p = full ? parseGen(full.data) : null; } catch { }
      }
      if (!p || p.noUsage) continue;
      parsed.push([r.idx, p]);
      if (p.step >= 0) needSteps = Math.min(needSteps, p.step);
    }
    const times = new Map();
    if (needSteps !== Infinity) {
      for (const s of db.prepare("SELECT idx, substr(metadata, 1, 48) AS m FROM steps WHERE idx >= ?").all(needSteps)) {
        const t = stepTime(s.m); if (t) times.set(Number(s.idx), t);
      }
    }
    ent.rows = ent.rows.filter((x) => x[0] < from);
    let prevT = ent.rows.length ? ent.rows[ent.rows.length - 1][1] : 0;
    let mt = 0; try { mt = Math.floor(fs.statSync(file).mtimeMs / 1000); } catch { }
    for (const [idx, p] of parsed) {
      let t = p.step >= 0 ? (times.get(p.step) || 0) : 0;
      if (!t) { for (let k = p.step - 1; k >= 0 && k > p.step - 6 && !t; k--) t = times.get(k) || 0; }
      if (!t) t = prevT || mt;
      prevT = t;
      ent.rows.push([Number(idx), t, p.in, p.cache, p.out, p.think, modelId(p.model), p.max, Math.round(p.ttft * 100) / 100, Math.round(p.stream * 100) / 100]);
    }
    if (rows.length) ent.last = Number(rows[rows.length - 1].idx);
    ent.sig = sig; ent.mt = mt;
    saveSoon();
  } catch (e) {
    log("[usage] 读 " + cid + " 失败：" + (e && e.message || e));
    return ent.rows.length ? ent : null;
  } finally {
    try { db && db.close(); } catch { }
  }
  const ms = Date.now() - t0;
  if (ms > 120) log("[usage] " + cid + " 读了 " + ms + "ms");
  return ent;
}

function listConvs() {
  try { return fs.readdirSync(CONV).filter((f) => /^[\w-]+\.db$/.test(f)).map((f) => f.slice(0, -3)); } catch { return []; }
}
function newestConv() {
  let best = "", bt = 0;
  for (const cid of listConvs()) {
    let t = 0;
    try { t = fs.statSync(path.join(CONV, cid + ".db")).mtimeMs; } catch { }
    try { t = Math.max(t, fs.statSync(path.join(CONV, cid + ".db-wal")).mtimeMs); } catch { }
    if (t > bt) { bt = t; best = cid; }
  }
  return best;
}
function title(cid) {
  if (!DatabaseSync || !cid) return "";
  if (Date.now() - titlesAt > 30000 || !titles.has(cid)) {
    titlesAt = Date.now();
    let db = null;
    try {
      db = openRO(SUMMARY_DB);
      for (const r of db.prepare("SELECT conversation_id AS id, title FROM conversation_summaries").all()) titles.set(String(r.id), String(r.title || ""));
    } catch { } finally { try { db && db.close(); } catch { } }
  }
  return titles.get(cid) || "";
}

// 当前对话：最后一次调用 + 这个对话的累计
function current(cid) {
  if (!DatabaseSync) return { ok: false, reason: "nosqlite", error: sqliteErr };
  // v0.11.0：新开的对话（网址里还没有对话编号，或者记录文件还没建出来）直接算 0，不再拿最近那个对话顶上
  cid = String(cid || "");
  if (!/^[\w-]{8,80}$/.test(cid)) return { ok: true, conv: "", fresh: true, calls: 0 };
  const id = cid;
  if (!fs.existsSync(path.join(CONV, id + ".db"))) return { ok: true, conv: id, fresh: true, title: title(id), calls: 0 };
  const ent = refreshFile(id);
  if (!ent || !ent.rows.length) return { ok: true, conv: id, fresh: true, title: title(id), calls: 0 };
  const L = ent.rows[ent.rows.length - 1];
  let tin = 0, tc = 0, to = 0, tt = 0, maxCtx = 0, best = 0;
  for (const r of ent.rows) { tin += r[2]; tc += r[3]; to += r[4]; tt += r[5]; if (r[2] + r[3] > best) best = r[2] + r[3]; if (r[7]) maxCtx = r[7]; }
  return {
    ok: true, conv: id, title: title(id), calls: ent.rows.length,
    last: { at: L[1], in: L[2], cache: L[3], out: L[4], think: L[5], model: models[L[6]] || "", max: L[7] || maxCtx, ttft: L[8], stream: L[9], ctx: L[2] + L[3] },
    total: { in: tin, cache: tc, out: to, think: tt, peak: best }
  };
}

function dayKey(sec) { const d = new Date(sec * 1000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// 全部对话：按天 / 按模型汇总。第一次会把所有库过一遍（分批做，不卡界面），之后只读有变化的
async function scanAll() {
  if (scanning) return scanning;
  scanning = (async () => {
    loadCache();
    const ids = listConvs();
    const t0 = Date.now();
    for (const cid of ids) {
      try { refreshFile(cid); } catch { }
      await new Promise((r) => setImmediate(r));
    }
    for (const k of Object.keys(cache.files)) if (!ids.includes(k)) { delete cache.files[k]; cacheDirty = true; }
    lastFull = Date.now();
    const ms = Date.now() - t0;
    if (ms > 400) log("[usage] 扫描 " + ids.length + " 个对话用了 " + ms + "ms");
  })().finally(() => { scanning = null; });
  return scanning;
}
async function summary(days) {
  if (!DatabaseSync) return { ok: false, reason: "nosqlite", error: sqliteErr };
  days = Math.max(1, Math.min(120, Number(days) || 30));
  if (Date.now() - lastFull > 15000) await scanAll();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1).getTime() / 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const today = dayKey(now.getTime() / 1000);
  const byDay = new Map(), byModel = new Map();
  const z = () => ({ in: 0, cache: 0, out: 0, think: 0, calls: 0, convs: new Set() });
  const month = z(), all = z();
  for (const [cid, ent] of Object.entries(cache.files)) {
    for (const r of ent.rows || []) {
      const add = (o) => { o.in += r[2]; o.cache += r[3]; o.out += r[4]; o.think += r[5]; o.calls++; o.convs.add(cid); };
      add(all);
      if (r[1] >= monthStart) add(month);
      if (r[1] >= start) {
        const k = dayKey(r[1]);
        if (!byDay.has(k)) byDay.set(k, z());
        add(byDay.get(k));
        const m = models[r[6]] || "未知";
        if (!byModel.has(m)) byModel.set(m, z());
        add(byModel.get(m));
      }
    }
  }
  const pub = (o) => ({ in: o.in, cache: o.cache, out: o.out, think: o.think, calls: o.calls, convs: o.convs.size });
  const list = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dayKey(d.getTime() / 1000);
    list.push({ day: k, ...pub(byDay.get(k) || z()) });
  }
  return {
    ok: true, days: list, today: pub(byDay.get(today) || z()), month: pub(month), all: pub(all),
    models: [...byModel.entries()].map(([name, o]) => ({ name, ...pub(o) })).sort((a, b) => (b.in + b.cache + b.out) - (a.in + a.cache + a.out)),
    convs: Object.keys(cache.files).length
  };
}

// 今天 / 本月的总数（卡片上用，最多 15 秒算一次）
let quickSum = null, quickAt = 0;
async function today() {
  if (!DatabaseSync) return null;
  if (quickSum && Date.now() - quickAt < 15000) return quickSum;
  const s = await summary(1);
  quickSum = s && s.ok ? { today: s.today, month: s.month } : null; quickAt = Date.now();
  return quickSum;
}

module.exports = { init, available, current, summary, today, scanAll, _parseGen: parseGen, _fields: fields, sqliteError: () => sqliteErr };
