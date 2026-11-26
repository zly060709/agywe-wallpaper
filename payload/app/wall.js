"use strict";
/* agywe 壁纸页：跑在 agywe://app/index.html，作为 Hub 页面最底层的 iframe */
(function () {
  const W = window.WebWallGL;
  const stage = document.getElementById("stage");
  const dim = document.getElementById("dim");
  const link = window.agyweParent;   // v0.11.2：和宿主之间的消息通道（parent-link.js）
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("agywe") : null;

  let cfg = null;
  let lib = { items: [] };
  let audioState = "off";
  let darkText = null;
  let typing = false;
  let mood = "";
  let ctx = { conv: "", project: "" };
  let manual = null;        // 规则生效时你在壁纸库里手动换的：{ ruleKey, ref }，到下一次切换前保持
  let decision = null;      // { ref, rule, manual }
  let effKey = "";

  // ---- WebWallGL 的系统实况接口：频谱不走网络，直接由上层页面算好送过来 ----
  const sysSinks = new Set();
  const NativeES = window.EventSource;
  window.EventSource = function (url, opts) {
    if (/\/api\/system\/stream/.test(String(url))) {
      const es = {
        url: String(url), readyState: 1, withCredentials: false, onmessage: null, onerror: null, onopen: null, _ls: new Set(),
        close() { this.readyState = 2; sysSinks.delete(this); },
        addEventListener(t, f) { if (t === "message" && typeof f === "function") this._ls.add(f); },
        removeEventListener(t, f) { this._ls.delete(f); },
        dispatchEvent() { return true; },
        CONNECTING: 0, OPEN: 1, CLOSED: 2
      };
      sysSinks.add(es);
      // v0.10.2：和真的 EventSource 一样，异步触发一次 open
      setTimeout(() => { try { if (es.readyState === 1 && typeof es.onopen === "function") es.onopen({ type: "open" }); } catch { } }, 0);
      return es;
    }
    return NativeES ? new NativeES(url, opts) : undefined;
  };
  window.EventSource.CONNECTING = 0; window.EventSource.OPEN = 1; window.EventSource.CLOSED = 2;
  function pushSys(obj) {
    if (!sysSinks.size) return;
    const ev = { data: JSON.stringify(obj), type: "message" };
    for (const es of sysSinks) { try { es.onmessage && es.onmessage(ev); for (const f of es._ls) f(ev); } catch { } }
  }
  function waitAudio(ms) {
    return new Promise((res) => {
      if (!cfg || cfg.systemAudio === false || audioState === "live") return res();
      const t0 = Date.now();
      const iv = setInterval(() => { if (audioState === "live" || audioState === "denied" || audioState === "unavailable" || Date.now() - t0 > ms) { clearInterval(iv); res(); } }, 100);
    });
  }
  let cur = null;          // { key, layer, inst, video, item }
  let focused = true;
  let onBattery = false;   // v0.8 省电：笔记本拔掉电源
  let hideAll = false;     // v0.8 一键隐藏（Ctrl+Alt+H）时壁纸也停下来，不白白占显卡
  let winFocused = true;   // v0.9 Antigravity 窗口在不在前台（不在前台可以降帧率）
  let agents = 0;
  let rotateTimer = null;
  let remountT = 0;
  let loadSeq = 0;

  const toParent = (msg) => link.post(msg);
  const api = async (p) => { const r = await fetch("/api/" + p, { cache: "no-store" }); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); };
  const keyOf = (ref) => ref ? ref.kind + ":" + ref.id : "";

  function findItem(ref) {
    if (!ref) return null;
    return lib.items.find((it) => it.kind === ref.kind && it.id === ref.id) || null;
  }

  function hasActive() { return !!(cfg && cfg.enabled && cur && cur.ok); }

  function publicCfg() {
    return { ...cfg, enabled: hasActive() };
  }

  // ------------------------------------------------------------------
  function propsFor(item) {
    if (!item || item.kind !== "we") return {};
    const p = cfg.props && cfg.props["we:" + item.id];
    return p && typeof p === "object" ? { ...p } : {};
  }

  function engineOptions(item) {
    return {
      fit: cfg.fit || "cover",
      fps: effFps(),
      renderDpr: effDpr(),
      volume: Number(cfg.volume) || 0,
      scripts: cfg.scripts !== false,
      properties: propsFor(item),
      liveSystem: cfg.systemAudio !== false || cfg.nowPlaying !== false,
      localAssets: "lazy",
      quality: effQuality(),
      mountTimeoutMs: 45000,
      onDiagnostic: (msg, lvl) => { if (lvl === "error") console.warn("[webwallgl]", msg); }
    };
  }

  function mediaUrl(item) {
    if (item.kind === "custom") return "/custom/" + item.id;
    return "/we/" + item.id + "/" + String(item.file || "").split("/").map(encodeURIComponent).join("/");
  }

  async function mountInto(layer, item) {
    const isMedia = item.kind === "custom" || item.type === "video";
    if (isMedia && item.type === "image") {
      const img = new Image();
      img.decoding = "async";
      img.src = mediaUrl(item);
      layer.appendChild(img);
      await img.decode();
      return { img };
    }
    if (isMedia) {
      const v = document.createElement("video");
      v.muted = !(cfg.volume > 0); v.volume = Math.min(1, Math.max(0, cfg.volume || 0));
      v.loop = true; v.autoplay = true; v.playsInline = true; v.preload = "auto";
      v.src = mediaUrl(item);
      layer.appendChild(v);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("视频加载超时")), 30000);
        v.addEventListener("loadeddata", () => { clearTimeout(t); res(); }, { once: true });
        v.addEventListener("error", () => { clearTimeout(t); rej(new Error("视频无法播放（可能是编码不受支持）")); }, { once: true });
      });
      try { v.playbackRate = videoRate(); } catch { }
      try { await v.play(); } catch { v.muted = true; try { await v.play(); } catch { } }
      return { video: v };
    }
    if (!W) throw new Error("WebWallGL 引擎没有加载");
    const inst = await W.mount(layer, { source: W.httpSource(location.origin + "/we/" + item.id), ...engineOptions(item) });
    return { inst };
  }

  function fallbackPreview(layer, item) {
    if (item.kind !== "we" || !item.preview) return false;
    layer.textContent = "";
    const img = new Image();
    img.src = "/we/" + item.id + "/" + item.preview.split("/").map(encodeURIComponent).join("/");
    layer.appendChild(img);
    return true;
  }

  function disposeEntry(e) {
    if (!e) return;
    try { e.inst && e.inst.destroy({ releasePkgCache: true }); } catch { }
    try { if (e.video) { e.video.pause(); e.video.removeAttribute("src"); e.video.load(); } } catch { }
    try { e.layer.remove(); } catch { }
  }

  async function show(ref, force) {
    const seq = ++loadSeq;
    if (!cfg.enabled || !ref) { const old = cur; cur = null; disposeEntry(old); toParent({ type: "agywe:config", config: publicCfg() }); return; }
    let item = findItem(ref);
    if (!item) { try { lib = await api("library"); } catch { } item = findItem(ref); }
    if (seq !== loadSeq) return;
    if (!item) { console.warn("[agywe] 找不到壁纸", ref); toParent({ type: "agywe:config", config: publicCfg() }); return; }
    if (!force && cur && cur.key === keyOf(ref) && cur.ok) return;

    const layer = document.createElement("div");
    layer.className = "layer";
    stage.appendChild(layer);
    const entry = { key: keyOf(ref), layer, item, ok: false, audioLive: audioState === "live" };
    try {
      Object.assign(entry, await mountInto(layer, item));
      entry.ok = true;
    } catch (err) {
      console.warn("[agywe] 壁纸加载失败，尝试用预览图兜底:", item.title, err);
      entry.ok = fallbackPreview(layer, item);
      entry.inst = null;
      entry.fallback = entry.ok;
    }
    if (seq !== loadSeq) { disposeEntry(entry); return; }
    if (!entry.ok) { disposeEntry(entry); toParent({ type: "agywe:config", config: publicCfg() }); return; }
    const old = cur;
    cur = entry;
    requestAnimationFrame(() => layer.classList.add("show"));
    setTimeout(() => disposeEntry(old), Math.max(300, (Number(cfg.transitionSec ?? 0.9) * 1000) + 200));
    if (!par.raf) par.raf = requestAnimationFrame(parallaxTick);
    applyPause();
    setTimeout(() => updatePalette(0), 400);
    if (entry.video) {
      entry.video.addEventListener("loadeddata", () => setTimeout(() => updatePalette(0), 250), { once: true });
    }
    toParent({ type: "agywe:config", config: publicCfg() });
  }

  // ------------------------------------------------------------------
  // ---- 视差：视频 / 图片 / 网页 / 预览图跟着鼠标轻微移动（场景壁纸用它自己的视差）----
  const par = { tx: 0, ty: 0, x: 0, y: 0, raf: 0 };
  function parallaxAmt() { return cfg && cfg.lowSpec ? 0 : Math.max(0, Math.min(1, Number(cfg && cfg.parallax) || 0)); }
  function parallaxTarget() { return !!(cur && cur.layer && (cur.fallback || !cur.item || cur.item.type !== "scene")); }
  function parallaxTick() {
    par.raf = 0;
    const amt = parallaxAmt();
    par.x += (par.tx - par.x) * 0.08; par.y += (par.ty - par.y) * 0.08;
    const on = amt > 0 && parallaxTarget();
    const k = on ? amt : 0;
    const s = 1 + 0.06 * k, px = -par.x * 40 * k, py = -par.y * 28 * k;
    for (const el of stage.children) el.style.transform = k ? `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${s.toFixed(4)})` : "";
    if (on && (Math.abs(par.tx - par.x) > 0.001 || Math.abs(par.ty - par.y) > 0.001)) par.raf = requestAnimationFrame(parallaxTick);
  }
  function pushParallax(u, v) {
    if (!parallaxAmt()) return;
    par.tx = (u - 0.5) * 2; par.ty = (v - 0.5) * 2;
    if (!par.raf) par.raf = requestAnimationFrame(parallaxTick);
  }

  function applyLook() {
    const tr = ["fade", "zoom", "blur", "slide", "none"].includes(cfg.transition) ? cfg.transition : "fade";
    for (const t of ["fade", "zoom", "blur", "slide", "none"]) document.body.classList.toggle("tr-" + t, t === tr);
    document.body.style.setProperty("--tr", Math.max(0, Math.min(5, Number(cfg.transitionSec ?? 0.9))) + "s");
    if (!parallaxAmt()) { par.tx = par.ty = 0; } if (!par.raf) par.raf = requestAnimationFrame(parallaxTick);
    document.body.classList.toggle("fit-contain", cfg.fit === "contain");
    document.body.classList.toggle("fit-stretch", cfg.fit === "stretch");
    document.body.classList.toggle("fx-glow", cfg.agentFx === "glow");
    document.body.classList.toggle("busy", agents > 0);
    const mode = cfg.dimMode || "auto";
    const lighten = mode === "lighten" || (mode === "auto" && darkText === true);
    dim.style.background = lighten ? "#fff" : "#000";
    for (const m of ["done", "attention", "error"]) document.body.classList.toggle("mood-" + m, mood === m && cfg.agentFx !== "none");
    const fm = typing ? (cfg.focusMode || "none") : "none";
    const fs = Math.max(0.1, Math.min(1, Number(cfg.focusStrength ?? 0.6)));
    stage.style.filter = [wallFilter(), fm === "blur" ? `blur(${Math.round(3 + 15 * fs)}px)` : ""].filter(Boolean).join(" ");
    applyWallFx();
    let d = Number(cfg.dim) || 0;
    if (fm === "dim") d = Math.min(0.9, d + 0.55 * fs);
    else if (fm === "blur") d = Math.min(0.9, d + 0.12 * fs);
    if (agents > 0 && cfg.agentFx === "brighten") d = Math.max(0, d - 0.2);
    dim.style.opacity = String(Math.min(0.9, Math.max(0, d)));
    applyPalVars();
  }

  // ---- v0.8 省电：用电池时降帧率或暂停 ----
  function batteryMode() {
    if (!onBattery) return "none";
    const m = ((cfg && cfg.battery) || {}).mode;
    return m === "pause" || m === "none" ? m : "fps";
  }
  function effFps() {
    let f = Number(cfg && cfg.fps) || 30;
    if (cfg && cfg.lowSpec) f = Math.min(f, 30);
    const bl = Number(cfg && cfg.blurFps) || 0;
    if (!winFocused && bl > 0) f = Math.min(f, Math.max(5, bl));
    if (batteryMode() !== "fps") return f;
    const bf = Math.max(5, Math.min(60, Number(((cfg && cfg.battery) || {}).fps) || 15));
    return Math.min(f, bf);
  }
  // ---- v0.9 低配模式：粒子 / 后处理降到低，渲染分辨率最多 1x ----
  function effQuality() {
    if (cfg && cfg.lowSpec) return { particles: "low", postProcessing: "low" };
    return { particles: (cfg && cfg.particles) || "high", postProcessing: (cfg && cfg.postProcessing) || "high" };
  }
  function effDpr() {
    const d = Number(cfg && cfg.renderDpr) || 0;
    if (!(cfg && cfg.lowSpec)) return d;
    return d > 0 && d < 1 ? d : 1;
  }
  function applyFps() {
    try { if (cur && cur.inst) { const f = effFps(); if (cur.fps !== f) { cur.inst.setFps(f); cur.fps = f; } } } catch (e) { console.warn(e); }
  }
  // ---- v0.10 壁纸画面：亮度 / 对比度 / 饱和度 / 色温，暗角 / 颗粒 / 扫描线 ----
  const WFX_DEF = { brightness: 1, contrast: 1, saturate: 1, temp: 0, vignette: 0, grain: 0, scan: 0 };
  const num = (v, d, a, b) => { v = Number(v); return Math.max(a, Math.min(b, isFinite(v) ? v : d)); };
  function wfx() { const f = { ...WFX_DEF, ...((cfg && cfg.wallFx) || {}) }; return { brightness: num(f.brightness, 1, .3, 1.8), contrast: num(f.contrast, 1, .3, 1.8), saturate: num(f.saturate, 1, 0, 2.5), temp: num(f.temp, 0, -1, 1), vignette: num(f.vignette, 0, 0, 1), grain: num(f.grain, 0, 0, 1), scan: num(f.scan, 0, 0, 1) }; }
  function wallFilter() {
    const f = wfx(), out = [];
    if (Math.abs(f.brightness - 1) > .005) out.push(`brightness(${f.brightness})`);
    if (Math.abs(f.contrast - 1) > .005) out.push(`contrast(${f.contrast})`);
    if (Math.abs(f.saturate - 1) > .005) out.push(`saturate(${f.saturate})`);
    return out.join(" ");
  }
  let grainUrl = "";
  function grainTexture() {
    if (grainUrl) return grainUrl;
    try {
      const cv = document.createElement("canvas"); cv.width = cv.height = 160;
      const c = cv.getContext("2d"), im = c.createImageData(160, 160), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      c.putImageData(im, 0, 0);
      grainUrl = cv.toDataURL("image/png");
    } catch { grainUrl = ""; }
    return grainUrl;
  }
  function applyWallFx() {
    const f = wfx(), on = !!(cfg && cfg.enabled);
    const tint = document.getElementById("tint"), vig = document.getElementById("vig"), gr = document.getElementById("grain"), sc = document.getElementById("scan");
    if (tint) { tint.style.background = f.temp >= 0 ? "#ff8a2a" : "#2a7dff"; tint.style.opacity = on ? String(Math.abs(f.temp) * .45) : "0"; }
    if (vig) vig.style.opacity = on ? String(f.vignette) : "0";
    if (gr) {
      const g = on ? f.grain : 0;
      if (g > 0 && !gr.style.backgroundImage) { const u = grainTexture(); if (u) gr.style.backgroundImage = `url(${u})`; }
      gr.style.opacity = String(g * .22);
      gr.classList.toggle("still", !!(cfg && cfg.lowSpec));
    }
    if (sc) sc.style.opacity = on ? String(f.scan * .5) : "0";
  }
  function videoRate() { return num(cfg && cfg.videoRate, 1, .25, 2); }
  function applyPause() {
    if (!cur) return;
    const pause = !!cfg.paused || document.hidden || hideAll || batteryMode() === "pause" || (cfg.pauseOnBlur && !focused) || (typing && cfg.focusMode === "pause");
    try { if (cur.inst) { if (pause && !cur.inst.paused) cur.inst.pause(); else if (!pause && cur.inst.paused) cur.inst.resume(); } } catch { }
    try { if (cur.video) { if (pause) cur.video.pause(); else cur.video.play().catch(() => { }); } } catch { }
  }

  function applyLive(prev) {
    applyLook();
    if (!cur) return;
    const i = cur.inst;
    try {
      if (i) {
        if (prev.fit !== cfg.fit) i.setFit(cfg.fit);
        if (prev.fps !== cfg.fps || prev.blurFps !== cfg.blurFps || prev.lowSpec !== cfg.lowSpec || JSON.stringify(prev.battery) !== JSON.stringify(cfg.battery)) applyFps();
        if (prev.volume !== cfg.volume) i.setVolume(Number(cfg.volume) || 0);
        if (prev.particles !== cfg.particles || prev.postProcessing !== cfg.postProcessing || prev.lowSpec !== cfg.lowSpec) i.setQuality(effQuality());
        if (prev.renderDpr !== cfg.renderDpr || prev.lowSpec !== cfg.lowSpec) i.setRenderDpr(effDpr());
      }
      if (cur.video && prev.volume !== cfg.volume) { cur.video.volume = Math.min(1, cfg.volume || 0); cur.video.muted = !(cfg.volume > 0); }
      if (cur.video && prev.videoRate !== cfg.videoRate) { cur.video.playbackRate = videoRate(); }
    } catch (e) { console.warn(e); }
    applyPause();
  }

  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // 自动切换：对话绑定 > 项目绑定 > 按时间 > 壁纸库里选的（含自动轮播）
  // ------------------------------------------------------------------
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || "")); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  // v0.10：时间点可以只在工作日 / 周末生效
  const DAYS_LABEL = { weekday: "工作日", weekend: "周末" };
  function slotDayOk(days, wd) {
    if (Array.isArray(days)) return days.includes(wd);
    if (days === "weekday") return wd >= 1 && wd <= 5;
    if (days === "weekend") return wd === 0 || wd === 6;
    return true;
  }
  // 今天已经过了的最后一个时间点；今天还没到第一个，就往前一天找（沿用前一天最后一个）
  function pickSlot(slots, valid) {
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
  function timeRule() {
    const sc = cfg && cfg.schedule;
    if (!sc || !sc.enabled || !Array.isArray(sc.slots)) return null;
    const pick = pickSlot(sc.slots, (x) => !!(x.ref && findItem(x.ref)));
    if (!pick) return null;
    const dl = DAYS_LABEL[pick.days] ? DAYS_LABEL[pick.days] + " " : "";
    return { key: "time:" + (pick.days || "all") + ":" + pick.at + ":" + keyOf(pick.ref), ref: pick.ref, label: "按时间，" + dl + pick.at + " 起" };
  }
  function projectRule() {
    const bs = Array.isArray(cfg && cfg.bindings) ? cfg.bindings : [];
    if (!bs.length) return null;
    const c = ctx.conv && bs.find((x) => x.type === "conv" && x.id === ctx.conv && x.ref && findItem(x.ref));
    if (c) return { key: "conv:" + c.id + ":" + keyOf(c.ref), ref: c.ref, label: "绑定到这个对话" };
    const p = ctx.project && bs.find((x) => x.type === "project" && x.id === ctx.project && x.ref && findItem(x.ref));
    if (p) return { key: "proj:" + p.id + ":" + keyOf(p.ref), ref: p.ref, label: "绑定到项目「" + (p.label || p.id.slice(0, 8)) + "」" };
    return null;
  }
  function activeRule() { return projectRule() || timeRule(); }
  function decide() {
    const rule = activeRule();
    if (!rule) { manual = null; return { ref: cfg.current, rule: null, manual: false }; }
    if (manual && manual.ruleKey === rule.key && manual.ref) return { ref: manual.ref, rule, manual: true };
    manual = null;
    return { ref: rule.ref, rule, manual: false };
  }
  function effectiveRef() { return (decision && decision.ref) || (cfg && cfg.current) || null; }
  function announce() {
    try { bc && bc.postMessage({ type: "effective", ref: decision ? decision.ref : null, label: decision && decision.rule ? decision.rule.label : "", manual: !!(decision && decision.manual), ctx }); } catch { }
  }
  async function applyEffective(force) {
    decision = decide();
    announce();
    const k = keyOf(decision.ref) + "|" + !!cfg.enabled;
    if (!force && k === effKey && cur) return;
    effKey = k;
    const mySeq = loadSeq + 1;
    await show(decision.ref);
    // v0.10.2：没换成功（加载失败）就把 effKey 清掉，下一次检查（20 秒一次 / 配置变化）还会再试
    if (mySeq === loadSeq && effKey === k && !(cur && cur.ok && cur.key === keyOf(decision.ref))) effKey = "";
  }

  function rotationPool() {
    const hidden = new Set(cfg.hidden || []);
    const all = lib.items.filter((it) => it.supported && !hidden.has(it.kind + ":" + it.id));
    if (cfg.rotate.pool === "favorites") {
      const fav = new Set(cfg.favorites || []);
      const f = all.filter((it) => fav.has(it.kind + ":" + it.id));
      if (f.length) return f;
    }
    return all;
  }

  function setupRotate() {
    clearInterval(rotateTimer); rotateTimer = null;
    if (!cfg.enabled || !cfg.rotate || !cfg.rotate.enabled) return;
    const ms = Math.max(1, Number(cfg.rotate.minutes) || 15) * 60000;
    rotateTimer = setInterval(async () => {
      if (document.hidden) return;
      if (activeRule()) return;          // 按时间 / 按项目的规则优先
      const pool = rotationPool();
      if (pool.length < 2) return;
      let next;
      if (cfg.rotate.order === "random") {
        do { next = pool[Math.floor(Math.random() * pool.length)]; } while (cur && next.kind + ":" + next.id === cur.key);
      } else {
        const idx = pool.findIndex((it) => cur && it.kind + ":" + it.id === cur.key);
        next = pool[(idx + 1) % pool.length];
      }
      const ref = { kind: next.kind, id: next.id };
      try {
        const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", "x-agywe-token": TOKEN }, body: JSON.stringify({ current: ref }) });
        if (r.ok) cfg = await r.json();
      } catch { }
      applyEffective(false);
    }, ms);
  }

  const TOKEN = document.querySelector('meta[name="agywe-token"]') ? document.querySelector('meta[name="agywe-token"]').content : "";

  async function reloadConfig() {
    const prev = cfg;
    cfg = await api("config");
    const needRemount = prev && cur && cur.inst && (prev.scripts !== cfg.scripts);
    if (needRemount) { const old = cur; cur = null; disposeEntry(old); }
    // 规则生效时在壁纸库里手动换了一张：临时盖过规则，直到下一次切换
    if (prev && cfg.current && keyOf(prev.current) !== keyOf(cfg.current)) {
      const r = activeRule();
      manual = r ? { ruleKey: r.key, ref: cfg.current } : null;
    }
    const rulesChanged = !!prev && JSON.stringify([prev.schedule, prev.bindings]) !== JSON.stringify([cfg.schedule, cfg.bindings]);
    if (!prev || keyOf(prev.current) !== keyOf(cfg.current) || prev.enabled !== cfg.enabled || needRemount || !cur || rulesChanged) {
      applyLook();
      await applyEffective(needRemount || !cur);
      // v0.10.2：壁纸没变（只改了规则 / 开关）时 show() 会提前返回，不会通知上层；这里补一次
      toParent({ type: "agywe:config", config: publicCfg() });
    } else {
      applyLive(prev);
      applyPropsChange(prev);
      toParent({ type: "agywe:config", config: publicCfg() });
    }
    setupRotate();
    applyOutfitRule().catch(() => { });
  }

  // 壁纸属性变了：场景直接热更新；删掉了某些值（恢复默认）或网页壁纸就重新加载
  function applyPropsChange(prev) {
    if (!cur || !cur.item || cur.item.kind !== "we") return;
    const k = "we:" + cur.item.id;
    const a = (prev.props && prev.props[k]) || {}, b = (cfg.props && cfg.props[k]) || {};
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const removed = Object.keys(a).some((n) => !(n in b));
    if (cur.inst && (cur.item.type === "scene" || cur.item.type === "web") && !removed) {
      const changed = {};
      for (const [n, v] of Object.entries(b)) if (JSON.stringify(a[n]) !== JSON.stringify(v)) changed[n] = v;
      try { cur.inst.setProperties(changed); return; } catch (e) { console.warn("[agywe] setProperties 失败，重新加载", e); }
    }
    clearTimeout(applyPropsChange.t);
    applyPropsChange.t = setTimeout(() => { const r = effectiveRef(); if (r) show(r, true); }, 400);
  }

  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // ---- v0.7 主题跟随壁纸：从当前壁纸取主色 / 强调色，发给上层页面 ----
  let lastPal = null, palSeq = 0;
  function rgbHex(c) { return "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join(""); }
  function paletteFrom(src) {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 36;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.drawImage(src, 0, 0, 64, 36);
    const d = c.getImageData(0, 0, 64, 36).data;
    const bins = new Map();
    const lums = [];
    let lum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 510, den = 255 - Math.abs(mx + mn - 255), s = mx === mn || !den ? 0 : (mx - mn) / den;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum += y; n++; lums.push(y);
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      let e = bins.get(key); if (!e) { e = { n: 0, r: 0, g: 0, b: 0, s: 0, l: 0 }; bins.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b; e.s += s; e.l += l;
    }
    if (!n) return null;
    const list = [...bins.values()].map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n], s: e.s / e.n, l: e.l / e.n })).sort((a, b) => b.n - a.n);
    const dom = list[0];
    let acc = null, best = -1;
    for (const e of list) {
      if (e.n < n * 0.01) continue;
      const score = e.s * Math.max(0, 1 - Math.abs(e.l - 0.58) * 1.6) * Math.pow(e.n / n, 0.25);   // 面积权重放低：小块的亮色也能当强调色
      if (score > best) { best = score; acc = e; }
    }
    // v0.10.2：右上角（窗口按钮那一条底下）的平均颜色，给「标题栏跟随壁纸」用
    let tr = null;
    { let r = 0, g = 0, b = 0, k = 0; for (let y = 0; y < 3; y++) for (let x = 48; x < 64; x++) { const i = (y * 64 + x) * 4; if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; } if (k) tr = rgbHex([r / k, g / k, b / k]); }
    lums.sort((a, b) => a - b);
    const pct = (q) => Math.round(lums[Math.min(lums.length - 1, Math.max(0, Math.floor(q * (lums.length - 1))))]);
    // lo / hi：壁纸里偏暗 / 偏亮那 10% 的亮度（自动对比度按这两个算，比平均值稳）
    return { dominant: rgbHex(dom.c), accent: rgbHex((acc || dom).c), tr: tr || rgbHex(dom.c), dark: lum / n < 110, lum: Math.round(lum / n), lo: pct(0.1), hi: pct(0.9) };
  }
  async function updatePalette(retry) {
    const seq = ++palSeq;
    if (!cur || !cur.layer) return;
    let src = null;
    try {
      if (cur.img) src = cur.img;
      else if (cur.video && cur.video.readyState >= 2 && cur.video.videoWidth) src = cur.video;
      else {
        const it = cur.item;
        if (it && it.kind === "we" && it.preview) {
          const im = new Image();
          im.src = "/we/" + it.id + "/" + String(it.preview).split("/").map(encodeURIComponent).join("/");
          await im.decode();
          src = im;
        } else { const im = cur.layer.querySelector("img"); if (im) src = im; }
      }
      if (!src || seq !== palSeq) {
        if ((retry || 0) < 3 && cur && cur.video) setTimeout(() => updatePalette((retry || 0) + 1), 1200);
        return;
      }
      const pal = paletteFrom(src);
      if (!pal) return;
      // 视频片头或动态画面刚渲染时偶尔抓到全黑帧：延迟复采，避免自动对比度误判壁纸为纯黑
      if (pal.hi < 14 && (retry || 0) < 3 && cur && cur.video) {
        setTimeout(() => updatePalette((retry || 0) + 1), 1500);
      }
      lastPal = pal;
      applyPalVars();
      toParent({ type: "agywe:palette", palette: pal });
    } catch (e) { console.warn("[agywe] 取色失败", e && e.message || e); }
  }
  function applyPalVars() {
    const on = !!(cfg && cfg.themeFollow && lastPal);
    const tri = (h) => { const v = parseInt(String(h).slice(1), 16); return ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255); };
    if (on) { document.body.style.setProperty("--g1", tri(lastPal.accent)); document.body.style.setProperty("--g2", tri(lastPal.accent)); }
    else { document.body.style.removeProperty("--g1"); document.body.style.removeProperty("--g2"); }
  }

  // ---- v0.8 挂件按时间换装：到了某个时间点换上那一套；中间手动换的保持到下一个时间点 ----
  let outfitKey = null, outfitBusy = false;
  function outfitPick() {
    const r = cfg && cfg.outfitRule;
    if (!r || !r.enabled || !Array.isArray(r.slots)) return null;
    const list = Array.isArray(cfg.outfits) ? cfg.outfits.filter((o) => o && o.id) : [];
    const pick = pickSlot(r.slots, (x) => list.some((o) => o.id === x.id));
    if (!pick) return null;
    return { key: (pick.days || "all") + "|" + pick.at + "|" + pick.id, outfit: list.find((o) => o.id === pick.id) };
  }
  async function applyOutfitRule() {
    if (outfitBusy || !cfg) return;
    const p = outfitPick();
    if (!p) { outfitKey = null; return; }
    if (p.key === outfitKey) return;
    outfitKey = p.key;
    const im = p.outfit.image || null;
    if (((cfg.pet || {}).image || null) === im) return;
    outfitBusy = true;
    try {
      cfg = await putCfg({ pet: { image: im, stamp: Date.now() } });
      toParent({ type: "agywe:config", config: publicCfg() });
      toParent({ type: "agywe:outfit", name: p.outfit.name || "" });
      try { bc && bc.postMessage({ type: "config" }); } catch { }
    } catch (e) { console.warn("[agywe] 换装失败", e); outfitKey = null; }   // v0.10.2：失败了下一轮（20 秒后）再试
    finally { outfitBusy = false; }
  }

  // ---- v0.7 快捷切换：上一张 / 下一张 / 随机 / 收藏 / 暂停（挂件、快捷键、右键菜单都走这里）----
  function quickPool() {
    const hidden = new Set(cfg.hidden || []);
    const all = lib.items.filter((it) => it.supported && !hidden.has(it.kind + ":" + it.id));
    if ((cfg.quickPool || "favorites") === "favorites") {
      const fav = new Set(cfg.favorites || []);
      const f = all.filter((it) => fav.has(it.kind + ":" + it.id));
      if (f.length >= 2) return f;
    }
    return all;
  }
  async function putCfg(patch) {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", "x-agywe-token": TOKEN }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error("保存失败 " + r.status);
    const c = await r.json();
    if (!c || typeof c !== "object" || Array.isArray(c) || c.error) throw new Error("保存失败：" + String((c && c.error) || "返回的不是配置"));
    return c;
  }
  // v0.11.2：从宿主发来的保存请求失败时，告诉宿主，并把实际生效的配置发回去（不然界面上显示改了、其实没存）
  function saveFailed(what, err) {
    try { console.warn("[agywe] 保存失败：" + what, err); } catch { }
    toParent({ type: "agywe:save-failed", what });
    reloadConfig().then(() => toParent({ type: "agywe:config", config: publicCfg() })).catch(() => { });
  }
  let actBusy = false;
  async function doAct(action) {
    if (!cfg || actBusy) return;
    actBusy = true;
    try {
      if (action === "next" || action === "prev" || action === "random") {
        if (!lib.items.length) { try { lib = await api("library"); } catch { } }
        const pool = quickPool();
        if (!pool.length) { toParent({ type: "agywe:switched", error: "壁纸库是空的，先去设置里添加壁纸" }); return; }
        const curKey = cur ? cur.key : keyOf(effectiveRef());
        let next;
        if (action === "random") {
          if (pool.length === 1) next = pool[0];
          else { let guard = 0; do { next = pool[Math.floor(Math.random() * pool.length)]; } while (next.kind + ":" + next.id === curKey && guard++ < 20); }
        } else {
          const idx = pool.findIndex((it) => it.kind + ":" + it.id === curKey);
          const step = action === "next" ? 1 : -1;
          next = pool[((idx < 0 ? (step > 0 ? -1 : 0) : idx) + step + pool.length) % pool.length];
        }
        const patch = { current: { kind: next.kind, id: next.id } };
        if (!cfg.enabled) patch.enabled = true;
        if (cfg.paused) patch.paused = false;
        await putCfg(patch);
        await reloadConfig();
        try { bc && bc.postMessage({ type: "config" }); } catch { }
        toParent({ type: "agywe:switched", title: next.title, n: pool.indexOf(next) + 1, total: pool.length });
      } else if (action === "fav") {
        const ref = effectiveRef();
        if (!ref) { toParent({ type: "agywe:switched", error: "现在没有在用的壁纸" }); return; }
        const k = keyOf(ref), fav = new Set(cfg.favorites || []);
        const on = !fav.has(k); if (on) fav.add(k); else fav.delete(k);
        cfg = await putCfg({ favorites: [...fav] });
        toParent({ type: "agywe:config", config: publicCfg() });
        try { bc && bc.postMessage({ type: "config" }); } catch { }
        const it = findItem(ref);
        toParent({ type: "agywe:faved", on, title: it ? it.title : "" });
      } else if (action === "pause") {
        await putCfg({ paused: !cfg.paused });
        await reloadConfig();
        try { bc && bc.postMessage({ type: "config" }); } catch { }
        toParent({ type: "agywe:paused", paused: !!cfg.paused });
      }
    } catch (e) {
      console.warn("[agywe] 快捷操作失败", action, e);
      toParent({ type: "agywe:switched", error: "没弄成，设置没保存上，稍后再试一次" });   // v0.11.2：以前失败了什么提示都没有
    }
    finally { actBusy = false; }
  }

  window.addEventListener("message", (e) => {
    if (!link.isFromParent(e)) return;
    const d = e.data || {};
    if (d.type === "agywe:pointer") { try { cur && cur.inst && cur.inst.pushPointer(d.u, d.v, d.buttons | 0); } catch { } pushParallax(Number(d.u) || 0.5, Number(d.v) || 0.5); }
    else if (d.type === "agywe:pointer-leave") { try { cur && cur.inst && cur.inst.pointerLeave(); } catch { } pushParallax(0.5, 0.5); }
    else if (d.type === "agywe:focus") { focused = !!d.focused; if (cfg) applyPause(); }
    else if (d.type === "agywe:power") { onBattery = !!d.battery; if (cfg) { applyFps(); applyPause(); } }
    else if (d.type === "agywe:hideall") { hideAll = !!d.on; if (cfg) applyPause(); }
    else if (d.type === "agywe:winfocus") { winFocused = d.focused !== false; if (cfg) applyFps(); }
    else if (d.type === "agywe:agents") { agents = Number(d.count) || 0; if (cfg) applyLook(); }
    else if (d.type === "agywe:typing") { typing = !!d.on; if (cfg) { applyLook(); applyPause(); } }
    else if (d.type === "agywe:mood") { mood = String(d.mood || ""); if (cfg) applyLook(); }
    else if (d.type === "agywe:context") {
      const next = { conv: String(d.conv || ""), project: String(d.project || "") };
      if (next.conv !== ctx.conv || next.project !== ctx.project) { ctx = next; if (cfg) applyEffective(false); }
    }
    else if (d.type === "agywe:theme") { darkText = d.darkText === true ? true : d.darkText === false ? false : null; if (cfg) applyLook(); }
    else if (d.type === "agywe:audio") { if (Array.isArray(d.bands) && d.bands.length === 64) pushSys({ audio: { bands: d.bands }, audioState: "live" }); }
    else if (d.type === "agywe:audio-state") {
      const prev = audioState;
      audioState = String(d.state || "off");
      pushSys({ audioState: audioState === "live" ? "live" : audioState });
      // 壁纸加载时系统音频还没准备好，用的是模拟频谱：现在好了就重新加载一次
      if (audioState === "live" && prev !== "live" && cur && cur.ok && !cur.audioLive && cur.item && (cur.item.type === "scene" || cur.item.type === "web") && cfg && effectiveRef()) {
        clearTimeout(remountT); remountT = setTimeout(() => { if (cur && !cur.audioLive && effectiveRef()) show(effectiveRef(), true); }, 600);
      }
    }
    else if (d.type === "agywe:act") doAct(String(d.action || ""));
    else if (d.type === "agywe:save-cfg") {
      const p = d.patch && typeof d.patch === "object" ? d.patch : {};
      const body = {};
      if (["off", "card", "pill"].includes(p.miniPlayer)) body.miniPlayer = p.miniPlayer;
      // v0.9 待办 / 便签
      if (Array.isArray(p.todos)) body.todos = p.todos.filter((x) => x && typeof x === "object").slice(0, 50).map((x) => ({ id: String(x.id || "").slice(0, 16) || Math.random().toString(16).slice(2, 10), text: String(x.text || "").slice(0, 200), done: !!x.done, at: Number(x.at) || Date.now() }));
      if (typeof p.note === "string") body.note = p.note.slice(0, 5000);
      if (Object.keys(body).length) putCfg(body).then((c) => { cfg = c; toParent({ type: "agywe:config", config: publicCfg() }); try { bc && bc.postMessage({ type: "config" }); } catch { } }).catch((err) => saveFailed("小组件", err));
    }
    else if (d.type === "agywe:save-pet-url") {
      // 在界面上点选的桌宠图片
      const u = String(d.url || "");
      if (!/^(https?:|data:image\/|blob:|file:|agywe:)/i.test(u) || u.length > 3 * 1024 * 1024) return;
      putCfg({ pet: { image: "url:" + u, stamp: Date.now() } })
        .then((c) => { cfg = c; toParent({ type: "agywe:config", config: publicCfg() }); try { bc && bc.postMessage({ type: "config" }); } catch { } })
        .catch((e) => saveFailed("桌宠图片", e));
    }
    else if (d.type === "agywe:save-glass") {
      // 页面里点选毛玻璃区域后，由这里带令牌保存
      const body = { glassForce: Array.isArray(d.glassForce) ? d.glassForce.map(String).slice(0, 80) : [], glassExclude: Array.isArray(d.glassExclude) ? d.glassExclude.map(String).slice(0, 80) : [] };
      putCfg(body)
        .then((c) => { cfg = c; toParent({ type: "agywe:config", config: publicCfg() }); try { bc && bc.postMessage({ type: "config" }); } catch { } })
        .catch((e) => saveFailed("毛玻璃点选", e));
    }
  });
  document.addEventListener("visibilitychange", () => { if (cfg) applyPause(); });
  if (bc) bc.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === "config") reloadConfig().catch((err) => console.warn(err));
    if (d.type === "library") api("library").then((l) => { lib = l; }).catch(() => { });
    if (d.type === "who-effective") announce();
    if (d.type === "selftest") { try { bc.postMessage({ type: "selftest-wall", r: wallReport() }); } catch { } }
  };
  // ---- v0.9 自检：设置页通过 BroadcastChannel 来问 ----
  function wallReport() {
    let gpu = "", webgl = 0;
    try {
      const cv = document.createElement("canvas");
      let gl = cv.getContext("webgl2"); webgl = gl ? 2 : 0;
      if (!gl) { gl = cv.getContext("webgl"); webgl = gl ? 1 : 0; }
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
        const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      }
    } catch { }
    const it = cur && cur.item;
    return {
      ok: !!(cur && cur.ok), type: it ? it.type || "" : "", kind: it ? it.kind || "" : "", title: it ? String(it.title || "").slice(0, 60) : "",
      fallback: !!(cur && cur.fallback), paused: !!(cfg && cfg.paused), fps: cfg ? effFps() : 0, battery: onBattery, winFocused, hideAll,
      audioState, audioLive: !!(cur && cur.audioLive), webgl, gpu: gpu.slice(0, 140), lib: (lib.items || []).length, effective: keyOf(effectiveRef()), lowSpec: !!(cfg && cfg.lowSpec)
    };
  }

  (async () => {
    try {
      cfg = await api("config");
      try { lib = await api("library"); } catch (e) { console.warn("[agywe] 壁纸库读取失败", e); }
      applyLook();
      toParent({ type: "agywe:ready", config: { ...cfg, enabled: false }, needsSetup: !cfg.current, wantAudio: !!(cfg.enabled && cfg.current && cfg.systemAudio !== false) });
      await waitAudio(3000);
      await applyEffective(true);
      toParent({ type: "agywe:first-frame", ok: !!(cur && cur.ok) });   // 开屏动画等这个信号再揭开
      setupRotate();
      // 按时间：每 20 秒看一次到没到下一个时间点
      setInterval(() => { if (cfg && cfg.schedule && cfg.schedule.enabled) applyEffective(false); }, 20000);
      applyOutfitRule().catch(() => { });
      setInterval(() => { applyOutfitRule().catch(() => { }); }, 20000);
    } catch (e) {
      console.warn("[agywe] 初始化失败", e);
      toParent({ type: "agywe:failed", error: String(e && e.message || e) });
      toParent({ type: "agywe:first-frame", ok: false });
    }
  })();
})();
