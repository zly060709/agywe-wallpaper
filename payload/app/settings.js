"use strict";
(function () {
  const TOKEN = document.querySelector('meta[name="agywe-token"]').content;
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("agywe") : null;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const link = window.agyweParent;   // v0.11.2：和宿主之间的消息通道（parent-link.js）
  let cfg = null;
  let lib = { items: [], paths: {} };

  const get = async (p) => { const r = await fetch("/api/" + p, { cache: "no-store", headers: { "x-agywe-token": TOKEN } }); return r.json(); };
  // v0.11.1：请求失败时不再把错误内容当结果用——返回 { ok:false, error, status }，调用方按字段判断
  const post = async (p, body, method = "POST") => {
    const r = await fetch("/api/" + p, { method, headers: { "Content-Type": "application/json", "x-agywe-token": TOKEN }, body: JSON.stringify(body || {}) });
    let data = null;
    try { data = await r.json(); } catch { }
    if (!r.ok) return { ok: false, status: r.status, error: (data && data.error) || ("HTTP " + r.status) };
    return data;
  };
  const notify = (type) => { try { bc && bc.postMessage({ type }); } catch { } };

  // ---- v0.11.1 保存配置：排队发送、失败会提示并按磁盘上的配置刷新界面（详见 savequeue.js）----
  const sendConfig = async (patch) => {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", "x-agywe-token": TOKEN }, body: JSON.stringify(patch || {}) });
    let data = null, text = "";
    try { text = await r.text(); data = JSON.parse(text); } catch { }
    if (!r.ok || !data || typeof data !== "object" || Array.isArray(data) || data.error) {
      const e = new Error((data && data.error) || (text && text.slice(0, 120)) || ("HTTP " + r.status));
      e.status = r.status;
      throw e;
    }
    notify("config");
    return data;
  };
  let saveNoteTimer = null;
  const saveNote = (msg) => {
    let el = document.getElementById("agywe-save-note");
    if (!el) {
      el = document.createElement("div");
      el.id = "agywe-save-note";
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;max-width:80%;padding:8px 14px;border-radius:8px;background:rgba(160,40,40,.92);color:#fff;font-size:13px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(saveNoteTimer);
    saveNoteTimer = setTimeout(() => { el.style.display = "none"; }, 6000);
  };
  const resyncConfig = async () => {
    try {
      const c = await get("config");
      if (c && typeof c === "object" && !c.error) { cfg = c; try { bindControls(); } catch { } }
    } catch { }
  };
  const saveQ = window.agyweSaveQueue.createSaveQueue({
    send: sendConfig,
    onSaved: (c) => { cfg = c; },
    onError: (err, patch, idle) => {
      try { console.warn("[agywe] 设置保存失败", err, patch); } catch { }
      saveNote("设置没保存上（" + String(err && err.message || err).slice(0, 80) + "），" + (idle ? "已按实际生效的配置刷新界面。" : "后面的修改会继续保存。"));
      if (idle) resyncConfig();
    }
  });
  function save(patch, now) { return saveQ.save(patch, now); }
  // 关页面前把还在防抖里的修改发出去
  const flushSave = () => Promise.race([saveQ.flush(), new Promise((r) => setTimeout(r, 1500))]);
  window.addEventListener("pagehide", () => { try { saveQ.flush(); } catch { } });

  const close = () => { flushSave().finally(() => link.post({ type: "agywe:close-settings" })); };
  $("#close").onclick = close;
  $("#backdrop").onclick = close;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (!hkRec && hkEventMatch(e, "settings")) close();
  });

  $$("nav button").forEach((b) => b.onclick = () => {
    $$("nav button").forEach((x) => x.classList.toggle("on", x === b));
    $$("main section").forEach((s) => s.classList.toggle("on", s.id === "tab-" + b.dataset.tab));
    if (b.dataset.tab === "dirs") renderDirs();
    if (b.dataset.tab === "about") renderAbout();
    if (b.dataset.tab === "props") renderProps();
    if (b.dataset.tab === "pet") renderPet();
    if (b.dataset.tab === "look") renderPickInfo();
    if (b.dataset.tab === "play") renderLive();
    if (b.dataset.tab === "avatar") renderAvatars();
    if (b.dataset.tab === "switch") renderSwitch();
    if (b.dataset.tab === "splash") renderSplash();
    if (b.dataset.tab === "widgets") renderUsageStats();
  });

  // ---------------- 通用控件绑定 ----------------
  const getK = (k) => k.split(".").reduce((o, x) => (o == null ? o : o[x]), cfg);
  function patchFor(k, v) {
    const parts = k.split(".");
    if (parts.length === 1) return { [k]: v };
    return { [parts[0]]: { ...cfg[parts[0]], [parts[1]]: v } };
  }
  function bindControls() {
    $$("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      const v = getK(k);
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v == null ? "" : String(v);
      const out = el.nextElementSibling && el.nextElementSibling.tagName === "OUTPUT" ? el.nextElementSibling : null;
      const showOut = () => { if (out) out.textContent = el.type === "range" ? (+el.value).toFixed(el.step && el.step < 1 ? 2 : 0) : el.value; };
      showOut();
      const handler = () => {
        let val = el.type === "checkbox" ? el.checked : el.value;
        if (el.type === "range" || el.dataset.num) val = Number(val);
        showOut();
        const patch = patchFor(k, val);
        Object.assign(cfg, patch);
        save(patch);
        afterChange(k);
        renderResets();
      };
      el.oninput = (el.type === "range" || el.type === "color") ? handler : null;
      el.onchange = handler;
    });
    renderResets();
  }
  function afterChange(k) {
    if (k.startsWith("pet.")) renderPetPreview();
    if (k.startsWith("buddy.")) renderBuddy();
    if (k.startsWith("avatar")) renderAvatars();
    if (k.startsWith("splash.")) renderSplash();
  }

  // ---------------- v0.9 每一项旁边的「恢复默认」 ----------------
  let DEF = null;
  const getD = (k) => k.split(".").reduce((o, x) => (o == null ? undefined : o[x]), DEF);
  const sameVal = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  function renderResets() {
    if (!DEF || !cfg) return;
    $$("main .row").forEach((row) => {
      const keys = [...new Set($$("[data-k]", row).map((el) => el.dataset.k))].filter((k) => getD(k) !== undefined);
      if (!keys.length) return;
      let b = row.querySelector(":scope > .rst");
      if (!b) {
        b = document.createElement("button"); b.type = "button"; b.className = "rst"; b.textContent = "↺"; b.title = "恢复默认";
        b.onclick = async () => {
          const patch = {};
          for (const k of keys) {
            const v = JSON.parse(JSON.stringify(getD(k)));
            const pp = patchFor(k, v);
            Object.assign(cfg, pp);
            Object.assign(patch, pp);
          }
          await save(patch, true);
          bindControls();
          keys.forEach(afterChange);
        };
        row.appendChild(b);
      }
      b.classList.toggle("show", keys.some((k) => !sameVal(getK(k), getD(k))));
      b.title = "恢复默认：" + keys.map((k) => { const d = getD(k); return typeof d === "boolean" ? (d ? "开" : "关") : d === "" ? "（空）" : String(d).slice(0, 20); }).join(" / ");
    });
  }

  // ---------------- 壁纸库 ----------------
  const TYPE_LABEL = { scene: "场景", video: "视频", web: "网页", image: "图片", application: "应用", preset: "预设" };
  const keyOf = (it) => it.kind + ":" + it.id;
  function thumbUrl(it) {
    if (it.kind === "custom") return it.type === "image" ? "/custom/" + it.id : "";
    if (!it.preview) return "";
    return "/we/" + it.id + "/" + it.preview.split("/").map(encodeURIComponent).join("/");
  }
  let gridIO = null;
  function renderGrid() {
    const q = $("#q").value.trim().toLowerCase();
    const ft = $("#ftype").value;
    const onlyFav = $("#ffav").checked;
    const showHidden = $("#fhidden").checked;
    const fav = new Set(cfg.favorites || []);
    const hid = new Set(cfg.hidden || []);
    const curKey = cfg.current ? cfg.current.kind + ":" + cfg.current.id : "";
    const items = lib.items.filter((it) => {
      const k = keyOf(it);
      if (!showHidden && hid.has(k)) return false;
      if (onlyFav && !fav.has(k)) return false;
      if (ft === "custom" ? it.kind !== "custom" : ft && (it.kind === "custom" || it.type !== ft)) return false;
      if (q && !(it.title.toLowerCase().includes(q) || (it.tags || []).some((t) => t.toLowerCase().includes(q)) || (it.workshopId || "").includes(q))) return false;
      return true;
    });
    $("#count").textContent = `共 ${lib.items.length} 项，显示 ${items.length} 项` + (lib.items.length ? "" : "。没有找到 Wallpaper Engine 壁纸，可以去「目录」里手动添加，或者添加自己的图片/视频。");
    const grid = $("#grid");
    if (gridIO) { gridIO.disconnect(); gridIO = null; }
    grid.textContent = "";
    const BATCH_SIZE = 120;
    let offset = 0;
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "grid-column: 1 / -1; height: 1px; width: 100%; pointer-events: none;";
    function buildCard(it) {
      const k = keyOf(it);
      const card = document.createElement("div");
      card.className = "card" + (k === curKey ? " cur" : "") + (it.supported ? "" : " unsup") + (hid.has(k) ? " hid" : "");
      card.title = it.title + (it.supported ? "" : "（暂不支持这种类型）");
      const th = document.createElement("div");
      th.className = "thumb";
      const u = thumbUrl(it);
      if (u) th.style.backgroundImage = `url("${u}")`;
      else { th.classList.add("noimg"); th.textContent = it.type === "video" ? "🎬" : "🖼"; }
      const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = it.title;
      const badge = document.createElement("div"); badge.className = "badge";
      badge.textContent = (it.kind === "custom" ? "自定义·" : "") + (TYPE_LABEL[it.type] || it.type || "?");
      const acts = document.createElement("div"); acts.className = "acts";
      const bFav = document.createElement("button"); bFav.textContent = "★"; bFav.title = "收藏（轮播用）"; if (fav.has(k)) bFav.classList.add("on");
      bFav.onclick = (e) => {
        e.stopPropagation();
        const s = new Set(cfg.favorites || []);
        s.has(k) ? s.delete(k) : s.add(k);
        cfg.favorites = [...s];
        bFav.classList.toggle("on", s.has(k));
        save({ favorites: cfg.favorites }, true);
        if (onlyFav && !s.has(k)) card.remove();
      };
      const bHide = document.createElement("button"); bHide.textContent = hid.has(k) ? "↺" : "⊘"; bHide.title = hid.has(k) ? "恢复" : "隐藏";
      bHide.onclick = (e) => { e.stopPropagation(); const s = new Set(cfg.hidden || []); s.has(k) ? s.delete(k) : s.add(k); cfg.hidden = [...s]; save({ hidden: cfg.hidden }, true); renderGrid(); };
      const bDir = document.createElement("button"); bDir.textContent = "📂"; bDir.title = "打开所在文件夹";
      bDir.onclick = (e) => { e.stopPropagation(); post("reveal", { kind: it.kind, id: it.id }); };
      acts.append(bFav, bHide, bDir);
      if (it.kind === "custom") {
        const bDel = document.createElement("button"); bDel.textContent = "🗑"; bDel.title = "从列表移除（不删除文件）";
        bDel.onclick = async (e) => { e.stopPropagation(); await post("remove-custom", { id: it.id }); await loadLib(); };
        acts.append(bDel);
      }
      card.append(th, meta, badge, acts);
      card.onclick = () => {
        if (!it.supported) return;
        cfg.current = { kind: it.kind, id: it.id };
        const patch = { current: cfg.current };
        if (!cfg.enabled) { cfg.enabled = true; patch.enabled = true; const sw = $('[data-k="enabled"]'); if (sw) sw.checked = true; }
        if (cfg.paused) { cfg.paused = false; patch.paused = false; }
        save(patch, true);
        grid.querySelectorAll(".card.cur").forEach((c) => c.classList.remove("cur"));
        card.classList.add("cur");
      };
      return card;
    }
    function appendNextBatch() {
      if (offset >= items.length) {
        if (gridIO) { gridIO.disconnect(); gridIO = null; }
        sentinel.remove();
        return;
      }
      const slice = items.slice(offset, offset + BATCH_SIZE);
      offset += slice.length;
      const frag = document.createDocumentFragment();
      for (const it of slice) frag.appendChild(buildCard(it));
      if (sentinel.parentNode === grid) grid.insertBefore(frag, sentinel);
      else grid.appendChild(frag);
      if (offset >= items.length) {
        if (gridIO) { gridIO.disconnect(); gridIO = null; }
        sentinel.remove();
      }
    }
    appendNextBatch();
    if (offset < items.length) {
      grid.appendChild(sentinel);
      if ("IntersectionObserver" in window) {
        gridIO = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) appendNextBatch();
        }, { root: null, rootMargin: "320px 0px" });
        gridIO.observe(sentinel);
      } else {
        while (offset < items.length) appendNextBatch();
      }
    }
  }
  ["#q", "#ftype", "#ffav", "#fhidden"].forEach((s) => $(s).addEventListener("input", renderGrid));
  async function loadLib(refresh) {
    $("#count").textContent = "正在读取壁纸库…";
    lib = await get("library" + (refresh ? "?refresh=1" : ""));
    renderGrid();
    if (refresh) notify("library");
  }
  $("#refresh").onclick = () => loadLib(true);
  $("#addfiles").onclick = async () => { const r = await post("add-files"); if (r.added && r.added.length) { await loadLib(); notify("library"); } };

  // ---------------- 目录 ----------------
  async function renderDirs() {
    const info = await get("info");
    const p = info.paths || {};
    const box = $("#paths");
    box.textContent = "";
    const line = (label, val, ok) => {
      const d = document.createElement("div"); d.className = "pathline";
      const s = document.createElement("span"); s.className = ok ? "ok" : "bad"; s.textContent = ok ? "✔" : "✘";
      const b = document.createElement("b"); b.textContent = label;
      const c = document.createElement("code"); c.textContent = val || "未找到";
      d.append(s, b, c); box.appendChild(d);
    };
    line("Steam 库", (p.libs || []).join("；"), (p.libs || []).length > 0);
    line("创意工坊壁纸", (p.workshop || []).join("；"), (p.workshop || []).length > 0);
    line("WE 安装目录", (p.installs || []).join("；"), (p.installs || []).length > 0);
    line("WE 官方素材", p.assets, !!p.assets);
    const ex = $("#extra"); ex.textContent = "";
    for (const d of cfg.extraDirs || []) {
      const row = document.createElement("div"); row.className = "pathline";
      const c = document.createElement("code"); c.textContent = d;
      const b = document.createElement("button"); b.textContent = "移除";
      b.onclick = async () => { await post("remove-folder", { dir: d }); cfg = await get("config"); renderDirs(); loadLib(); notify("library"); };
      row.append(c, b); ex.appendChild(row);
    }
    if (!(cfg.extraDirs || []).length) ex.innerHTML = '<div class="muted">（没有）</div>';
    const cu = $("#customs"); cu.textContent = "";
    for (const c of cfg.custom || []) {
      const row = document.createElement("div"); row.className = "pathline";
      const code = document.createElement("code"); code.textContent = c.path;
      const b = document.createElement("button"); b.textContent = "移除";
      b.onclick = async () => { await post("remove-custom", { id: c.id }); cfg = await get("config"); renderDirs(); loadLib(); };
      row.append(code, b); cu.appendChild(row);
    }
    if (!(cfg.custom || []).length) cu.innerHTML = '<div class="muted">（没有）</div>';
  }
  $("#addfolder").onclick = async () => { const r = await post("add-folder"); if (r.added) { cfg = await get("config"); renderDirs(); loadLib(); notify("library"); } };

  async function renderAbout() {
    const info = await get("info");
    const el = $("#about");
    el.textContent = "";
    const rows = [["插件版本", info.version], ["Antigravity", info.app], ["Electron", info.electron], ["配置文件", info.configPath]];
    const af = info.autofix || {};
    const sf = info.safe || {};
    const si = $("#safeInfo");
    if (si) si.textContent = sf.on ? "现在就是安全模式（" + (sf.reason === "manual" ? "手动测试" : "连续 " + sf.fails + " 次没能正常启动") + "）" : sf.fails ? "上次有 " + sf.fails + " 次没能正常启动，再有一次就会进入安全模式" : "最近启动都正常";
    $("#autofixinfo").textContent = (af.last && af.last.length) ? "最近的自动重装记录：" + af.last.join("　｜　") : "还没有自动重装过（下次 Antigravity 更新时会用到）。";
    for (const [k, v] of rows) {
      const d = document.createElement("div"); d.className = "pathline";
      const b = document.createElement("b"); b.textContent = k;
      const c = document.createElement("code"); c.textContent = v || "-";
      d.append(b, c); el.appendChild(d);
    }
  }
  $("#openconfig").onclick = () => post("reveal", { kind: "config" });

  // ---------------- 壁纸配置（Wallpaper Engine 属性） ----------------
  const BUILTIN_TEXT = {
    ui_browse_properties_scheme_color: "配色方案",
    ui_browse_properties_alignment: "对齐方式",
    ui_browse_properties_volume: "音量",
    ui_browse_properties_audio: "音频",
    ui_browse_properties_rate: "播放速度",
    ui_browse_properties_playback_rate: "播放速度"
  };
  function pickLocale(loc) {
    if (!loc || typeof loc !== "object") return {};
    const keys = Object.keys(loc);
    const prefer = ["zh-chs", "zh-cn", "zh_chs", "zh", "zh-cht", "en-us", "en"];
    for (const p of prefer) { const k = keys.find((x) => x.toLowerCase() === p); if (k) return { ...(loc[keys.find((x) => x.toLowerCase() === "en-us")] || {}), ...loc[k] }; }
    return loc[keys[0]] || {};
  }
  function plain(s) {
    // DOMParser 解析出来的文档是"惰性"的：不会执行脚本、不会加载图片（工坊文本不可信）
    try { return (new DOMParser().parseFromString(String(s || "").replace(/<br\s*\/?>/gi, " "), "text/html").body.textContent || "").trim(); }
    catch { return String(s || "").replace(/<[^>]*>/g, "").trim(); }
  }
  function labelOf(name, p, loc) {
    const t = typeof p.text === "string" ? p.text : "";
    return plain(loc[t] || BUILTIN_TEXT[t] || (t && !/^ui_/.test(t) ? t : "") || name);
  }
  const weColorToHex = (v) => {
    const n = String(v || "").trim().split(/[\s,]+/).map(Number);
    if (n.length < 3 || n.some((x) => !isFinite(x))) return "#ffffff";
    const big = n.some((x) => x > 1);
    return "#" + n.slice(0, 3).map((x) => Math.round(Math.min(255, Math.max(0, big ? x : x * 255))).toString(16).padStart(2, "0")).join("");
  };
  const hexToWeColor = (h) => {
    const n = parseInt(String(h).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (x / 255).toFixed(5).replace(/0+$/, "").replace(/\.$/, "") || "0").join(" ");
  };
  // 简单支持 WE 的显示条件：xxx.value == true / != 1 之类
  function condOk(cond, values) {
    if (!cond || typeof cond !== "string") return true;
    try {
      return cond.split(/\s*\|\|\s*/).some((orPart) => orPart.split(/\s*&&\s*/).every((part) => {
        const m = /^\s*!?\s*(\w+)\.value\s*(==|!=|===|!==|>=|<=|>|<)?\s*(.*?)\s*$/.exec(part.replace(/^\(|\)$/g, ""));
        if (!m) return true;
        const neg = /^\s*!/.test(part);
        let v = values[m[1]];
        if (!m[2]) return neg ? !v : !!v;
        let rhs = m[3].replace(/^["']|["']$/g, "");
        const num = Number(rhs);
        const lhs = typeof v === "boolean" ? String(v) : v;
        const r = rhs === "true" || rhs === "false" ? rhs : (isFinite(num) && rhs !== "" ? num : rhs);
        const l = typeof r === "number" ? Number(lhs) : String(lhs);
        switch (m[2]) {
          case "==": case "===": return l == r; // eslint-disable-line eqeqeq
          case "!=": case "!==": return l != r; // eslint-disable-line eqeqeq
          case ">": return l > r; case "<": return l < r; case ">=": return l >= r; case "<=": return l <= r;
        }
        return true;
      }));
    } catch { return true; }
  }

  let propsSeq = 0;
  async function renderProps() {
    const seq = ++propsSeq;
    const box = $("#props");
    const ref = (eff && eff.ref) || cfg.current;
    const it = ref ? lib.items.find((x) => x.kind === ref.kind && x.id === ref.id) : null;
    $("#curtitle").textContent = it ? it.title : "（还没有选壁纸）";
    $("#curtype").textContent = it ? ((it.kind === "custom" ? "自定义 · " : "") + (TYPE_LABEL[it.type] || it.type || "")) + (it.workshopId ? " · 工坊 " + it.workshopId : "") : "去「壁纸库」里点一张";
    const th = $("#curthumb"); const u = it ? thumbUrl(it) : "";
    th.style.backgroundImage = u ? `url("${u}")` : "";
    $("#pausebtn").textContent = cfg.paused ? "▶ 继续播放" : "⏸ 暂停";
    $("#pausebtn").disabled = !it; $("#clearbtn").disabled = !it;
    box.textContent = "";
    if (!it) return;
    if (it.kind !== "we") { box.innerHTML = '<p class="muted">自定义图片 / 视频没有可调的属性。</p>'; $("#propsreset").disabled = true; return; }
    box.innerHTML = '<p class="muted">正在读取…</p>';
    let pj;
    try { pj = await get("project?id=" + encodeURIComponent(it.id)); } catch { pj = null; }
    if (seq !== propsSeq) return;
    box.textContent = "";
    const key = "we:" + it.id;
    const saved = { ...((cfg.props || {})[key] || {}) };
    const props = (pj && pj.properties) || {};
    const loc = pickLocale(pj && pj.localization);
    const entries = Object.entries(props).filter(([, p]) => p && typeof p === "object")
      .sort((a, b) => (Number(a[1].order) || 0) - (Number(b[1].order) || 0));
    const values = {};
    for (const [n, p] of entries) values[n] = n in saved ? saved[n] : p.value;
    const rows = [];
    let shown = 0;
    const commit = (n, v) => {
      saved[n] = v; values[n] = v;
      cfg.props = { ...(cfg.props || {}), [key]: { ...saved } };
      save({ props: { [key]: { ...saved } } });
      for (const r of rows) r.el.style.display = condOk(r.cond, values) ? "" : "none";
    };
    for (const [name, p] of entries) {
      const type = String(p.type || "").toLowerCase();
      const row = document.createElement("div"); row.className = "row";
      const lab = document.createElement("label"); lab.textContent = labelOf(name, p, loc); lab.title = name;
      row.appendChild(lab);
      const v = values[name];
      if (type === "slider") {
        const r = document.createElement("input"); r.type = "range";
        const min = Number(p.min ?? 0), max = Number(p.max ?? 100);
        const step = p.step != null ? Number(p.step) : (p.fraction === false ? 1 : (max - min <= 2 ? 0.01 : (Number.isInteger(min) && Number.isInteger(max) && p.fraction !== true ? 1 : 0.1)));
        r.min = String(min); r.max = String(max); r.step = String(step || 0.01); r.value = String(v ?? min);
        const out = document.createElement("output");
        const fmt = () => { out.textContent = (+r.value).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0); };
        fmt();
        r.oninput = () => { fmt(); commit(name, Number(r.value)); };
        row.append(r, out);
      } else if (type === "bool") {
        const sw = document.createElement("label"); sw.className = "switch";
        const c = document.createElement("input"); c.type = "checkbox"; c.checked = v === true || v === 1 || v === "true" || v === "1";
        const s = document.createElement("span");
        sw.append(c, s);
        c.onchange = () => commit(name, c.checked);
        row.appendChild(sw);
      } else if (type === "combo") {
        const sel = document.createElement("select");
        for (const o of Array.isArray(p.options) ? p.options : []) {
          const op = document.createElement("option");
          op.value = String(o.value); op.textContent = plain(loc[o.label] || o.label || o.value);
          sel.appendChild(op);
        }
        sel.value = String(v);
        sel.onchange = () => {
          const o = (p.options || []).find((x) => String(x.value) === sel.value);
          commit(name, o ? o.value : sel.value);
        };
        row.appendChild(sel);
      } else if (type === "color") {
        const c = document.createElement("input"); c.type = "color"; c.value = weColorToHex(v);
        c.oninput = () => commit(name, hexToWeColor(c.value));
        row.appendChild(c);
      } else if (type === "textinput") {
        const t = document.createElement("input"); t.type = "text"; t.className = "wide"; t.value = v == null ? "" : String(v);
        t.onchange = () => commit(name, t.value);
        row.appendChild(t);
      } else if (type === "text" || type === "group") {
        row.className = "row note";
        lab.className = "notetext";
      } else {
        const s = document.createElement("small"); s.className = "muted";
        s.textContent = `（${type || "未知"} 类型的属性暂不支持在这里调）`;
        row.appendChild(s);
      }
      rows.push({ el: row, cond: p.condition });
      row.style.display = condOk(p.condition, values) ? "" : "none";
      box.appendChild(row);
      shown++;
    }
    if (!shown) box.innerHTML = '<p class="muted">这张壁纸没有可调的属性。</p>';
    $("#propsreset").disabled = !Object.keys(saved).length && !shown;
  }
  $("#propsreset").onclick = async () => {
    const ref = (eff && eff.ref) || cfg.current; if (!ref || ref.kind !== "we") return;
    const key = "we:" + ref.id;
    cfg.props = { ...(cfg.props || {}), [key]: {} };
    await save({ props: { [key]: {} } }, true);
    renderProps();
  };
  $("#pausebtn").onclick = async () => { cfg.paused = !cfg.paused; await save({ paused: cfg.paused }, true); renderProps(); };
  $("#clearbtn").onclick = async () => { cfg.current = null; await save({ current: null }, true); renderProps(); renderGrid(); };

  // ---------------- 挂件 ----------------
  function renderPetPreview() {
    const pet = cfg.pet || {};
    const box = $("#petimg");
    const size = Math.max(32, Math.min(200, Number(pet.size) || 64));
    box.style.width = box.style.height = size + "px";
    $(".petcord").style.height = Math.max(0, Math.min(240, Number(pet.cord ?? 30))) / 2 + 10 + "px";
    box.textContent = "";
    if (pet.image) {
      const img = new Image(); img.alt = "";
      img.src = String(pet.image).startsWith("url:") ? String(pet.image).slice(4) : "/pet-image?v=" + encodeURIComponent(String(pet.stamp || 0));
      img.onerror = () => { box.textContent = "图片读不出来"; };
      box.appendChild(img);
    } else {
      box.classList.add("def");
    }
    box.classList.toggle("def", !pet.image);
  }
  function renderPet() {
    const pet = cfg.pet || {};
    const im = String(pet.image || "");
    $("#petpath").textContent = !im ? "（默认角色）" : im.startsWith("url:") ? "（从界面上点选的图片）" : /[\\/]agywe[\\/]assets[\\/]/i.test(im) ? "（从界面上点选的图片，已存成文件）" : im;
    renderPetPreview();
    renderBuddy();
    get("info").then((info) => {
      const list = (info && info.petApps) || [];
      $("#petfound").textContent = list.length ? "发现正在运行的桌宠程序：" + list.map((x) => x.name + "（" + x.dir + "）").join("；") + "。点「选择图片…」会直接打开它的文件夹。" : "";
    }).catch(() => { });
  }
  // ---------------- v0.11 猫猫桌宠素材（v0.12.0 起插件自带一套） ----------------
  let buddyMsgUntil = 0;
  const toastMsg = (t) => { const el = $("#buddySrc"); if (el) { el.textContent = t; buddyMsgUntil = Date.now() + 3500; setTimeout(renderBuddy, 3600); } };
  const BUDDY_SRC = { custom: "自己选的文件夹", imported: "复制到配置文件夹的那份", local: "插件文件夹里自带的", catgirl: "猫猫插件自带的", none: "" };
  async function renderBuddy() {
    const el = $("#buddySrc"); if (!el || Date.now() < buddyMsgUntil) return;
    let i = null; try { i = await get("buddy-info"); } catch { }
    if (!i || i.error) { el.textContent = ""; return; }
    const clips = Array.isArray(i.clips) ? i.clips : [];
    el.textContent = i.kind === "none" ? "⚠ 没找到素材：插件文件夹里自带的 buddy 文件夹不见了（重新解压一份），或者选一个素材文件夹" : "正在用：" + (BUDDY_SRC[i.kind] || i.kind || "本地") + "（" + clips.length + " 个动作）" + " · " + (i.dir || "");
    el.title = clips.join("、");
    $("#buddyImport").disabled = !i.catgirl;
    $("#buddyImport").textContent = i.imported ? "重新从猫猫插件复制" : "从猫猫插件复制一份";
    $("#buddyImport").title = i.catgirl ? "复制到 " + "%APPDATA%\\Antigravity\\agywe\\buddy（约 95 MB），之后删掉猫猫插件也能用" : "没装猫猫插件";
  }
  $("#buddyImport").onclick = async () => {
    const b = $("#buddyImport"); b.disabled = true; const t = b.textContent; b.textContent = "复制中…";
    try { const r = await post("buddy-import"); if (r && r.ok) { if (r.config) { cfg = r.config; notify("config"); bindControls(); } toastMsg("复制好了：" + r.n + " 个动作，" + Math.round(r.bytes / 1048576) + " MB"); } else toastMsg((r && r.error) || "没复制成功"); }
    finally { b.textContent = t; b.disabled = false; renderBuddy(); }
  };
  $("#buddyPick").onclick = async () => { const r = await post("buddy-pick"); if (r && r.ok) { cfg = r.config; notify("config"); bindControls(); } else if (r && r.error) toastMsg(r.error); renderBuddy(); };
  $("#buddyReset").onclick = async () => { const r = await post("buddy-reset"); if (r && r.ok) { cfg = r.config; notify("config"); bindControls(); } renderBuddy(); };

  // ---------------- v0.11 用量统计 ----------------
  const fmtTok = (n) => { n = Number(n) || 0; const a = Math.abs(n), f = (x, d) => x.toFixed(d).replace(/\.0+$/, ""); return a >= 1e9 ? f(n / 1e9, 2) + "B" : a >= 1e6 ? f(n / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + "M" : a >= 1e3 ? f(n / 1e3, 1) + "K" : String(Math.round(n)); };
  const hitOf = (o) => (o.in + o.cache) ? Math.round(1000 * o.cache / (o.in + o.cache)) / 10 + "%" : "--";
  let ustatsBusy = false;
  async function renderUsageStats() {
    const box = $("#ustats"); if (!box || ustatsBusy) return;
    ustatsBusy = true;
    const days = Number($("#udays").value) || 14;
    if (!box.firstChild) box.textContent = "统计中…";
    let s = null; try { s = await get("usage-summary?days=" + days); } catch { } finally { ustatsBusy = false; }
    box.textContent = "";
    if (!s || !s.ok) { box.textContent = s && s.reason === "nosqlite" ? "这个版本的 Antigravity 读不了对话记录（" + (s.error || "") + "），用量统计用不了。" : "读不到用量记录。"; return; }
    const tot = (o) => o.in + o.cache + o.out;
    const today = document.createElement("div"); today.className = "today";
    for (const [label, val, tip] of [
      ["今天 token", fmtTok(tot(s.today)), "输入 " + fmtTok(s.today.in) + " · 缓存命中 " + fmtTok(s.today.cache) + " · 输出 " + fmtTok(s.today.out)],
      ["今天命中", hitOf(s.today), "缓存命中 ÷（输入 + 缓存命中）"],
      ["今天调用", String(s.today.calls), s.today.convs + " 个对话"],
      ["本月 token", fmtTok(tot(s.month)), "输入 " + fmtTok(s.month.in) + " · 缓存命中 " + fmtTok(s.month.cache) + " · 输出 " + fmtTok(s.month.out) + " · 思考 " + fmtTok(s.month.think)],
      ["本月命中", hitOf(s.month), ""],
      ["本月调用", String(s.month.calls), s.month.convs + " 个对话"]]) {
      const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = val; if (tip) d.title = tip; d.append(b, document.createTextNode(label)); today.appendChild(d);
    }
    box.appendChild(today);
    const cap = document.createElement("div"); cap.className = "cap"; cap.textContent = "最近 " + days + " 天 · 每天的 token（浅色是缓存命中的部分）"; box.appendChild(cap);
    const max = Math.max(1, ...s.days.map(tot));
    const week = document.createElement("div"); week.className = "week ubars";
    s.days.forEach((x, i) => {
      const bar = document.createElement("div"); bar.className = "bar" + (i === s.days.length - 1 ? " today" : "");
      bar.title = x.day + "：" + fmtTok(tot(x)) + "（输入 " + fmtTok(x.in) + "，缓存命中 " + fmtTok(x.cache) + "，输出 " + fmtTok(x.out) + "），" + x.calls + " 次调用，命中率 " + hitOf(x);
      const v = document.createElement("span"); v.textContent = x.calls ? fmtTok(tot(x)) : "";
      const st = document.createElement("div"); st.className = "stk";
      const H = 60 * tot(x) / max;
      const ic = document.createElement("i"); ic.className = "c"; ic.style.height = (tot(x) ? H * x.cache / tot(x) : 0).toFixed(1) + "px";
      const io = document.createElement("i"); io.style.height = (tot(x) ? Math.max(2, H * (x.in + x.out) / tot(x)) : 2).toFixed(1) + "px";
      st.append(ic, io);
      const lb = document.createElement("span"); lb.textContent = i === s.days.length - 1 ? "今天" : x.day.slice(5).replace("-", "/");
      bar.append(v, st, lb); week.appendChild(bar);
    });
    box.appendChild(week);
    if (s.models.length) {
      const cap2 = document.createElement("div"); cap2.className = "cap"; cap2.textContent = "按模型（最近 " + days + " 天）"; box.appendChild(cap2);
      const tb = document.createElement("table"); tb.className = "umodels";
      const hr = document.createElement("tr"); for (const h of ["模型", "调用", "输入", "缓存命中", "输出", "命中率"]) { const th = document.createElement("th"); th.textContent = h; hr.appendChild(th); } tb.appendChild(hr);
      for (const m of s.models) {
        const tr = document.createElement("tr");
        for (const v of [m.name, m.calls, fmtTok(m.in), fmtTok(m.cache), fmtTok(m.out), hitOf(m)]) { const td = document.createElement("td"); td.textContent = String(v); tr.appendChild(td); }
        tb.appendChild(tr);
      }
      box.appendChild(tb);
    }
    const foot = document.createElement("div"); foot.className = "cap"; foot.textContent = "一共 " + s.convs + " 个对话记录 · 全部 " + fmtTok(tot(s.all)) + " token，命中率 " + hitOf(s.all) + " · 只在本机统计"; box.appendChild(foot);
  }
  $("#udays").value = "14";
  $("#udays").onchange = renderUsageStats;
  $("#urefresh").onclick = renderUsageStats;

  $("#petfromui").onclick = () => link.post({ type: "agywe:pick-pet" });
  $("#petpick").onclick = async () => { const c = await post("pick-pet"); if (c && c.pet) { cfg = c; notify("config"); renderPet(); } };
  $("#petreset").onclick = async () => { const c = await post("reset-pet"); if (c && c.pet) { cfg = c; notify("config"); renderPet(); } };

  // ---------------- 毛玻璃点选 ----------------
  function renderPickInfo() {
    const f = (cfg.glassForce || []).length, e = (cfg.glassExclude || []).length;
    $("#pickinfo").textContent = f || e ? `已手动加上 ${f} 块、去掉 ${e} 块` : "";
  }
  $("#pickglass").onclick = () => link.post({ type: "agywe:pick-glass" });
  $("#pickreset").onclick = async () => { cfg.glassForce = []; cfg.glassExclude = []; await save({ glassForce: [], glassExclude: [] }, true); renderPickInfo(); };

  // ---------------- 自动切换 ----------------
  let ctx = { conv: "", project: "", title: "", projectLabel: "" };
  let eff = null;
  window.addEventListener("message", (e) => {
    if (!link.isFromParent(e)) return;
    const d = e.data || {};
    if (d.type === "agywe:context") {
      ctx = { conv: String(d.conv || ""), project: String(d.project || ""), title: String(d.title || ""), projectLabel: String(d.projectLabel || "") };
      if ($("#tab-switch").classList.contains("on")) renderSwitch();
    }
  });
  if (bc) bc.addEventListener("message", (e) => { const d = e.data || {}; if (d.type === "effective") { eff = d; renderEff(); } });
  const refItem = (ref) => ref ? lib.items.find((x) => x.kind === ref.kind && x.id === ref.id) : null;
  function refTitle(ref) { if (!ref) return "（没有）"; const it = refItem(ref); return it ? it.title : "（壁纸库里找不到了）"; }
  function miniThumb(ref) {
    const d = document.createElement("div"); d.className = "minithumb";
    const it = refItem(ref); const u = it ? thumbUrl(it) : "";
    if (u) d.style.backgroundImage = `url("${u}")`;
    return d;
  }
  function renderEff() {
    const txt = !eff || !eff.ref ? "" : "现在显示：" + refTitle(eff.ref) + (eff.label ? "（" + eff.label + (eff.manual ? "；你手动换过，到下一次切换前保持" : "") + "）" : "");
    const a = $("#effline"); if (a) a.textContent = txt;
    const b2 = $("#effline2"); if (b2) b2.textContent = eff && eff.label ? txt + "　在这里点一张会临时换掉，到下一次切换为止。" : "";
  }
  async function saveSchedule(slots) {
    // v0.10.2：以前这里只留了 at / ref，选的「工作日 / 周末」一保存就丢了
    cfg.schedule = { ...(cfg.schedule || {}), slots: slots.map((x) => (x.days ? { at: x.at, ref: x.ref, days: x.days } : { at: x.at, ref: x.ref })) };
    await save({ schedule: cfg.schedule }, true); renderSwitch();
  }
  function renderSwitch() {
    renderEff();
    $("#selline").textContent = "当前选中的壁纸：" + refTitle(cfg.current) + "　（去「壁纸库」点一张来换）";
    const sch = cfg.schedule || { enabled: false, slots: [] };
    $("#schOn").checked = !!sch.enabled;
    const box = $("#slots"); box.textContent = "";
    const DORD = { weekday: 1, weekend: 2 };
    const slots = [...(sch.slots || [])].map((x) => ({ ...x })).sort((a, b2) => (DORD[a.days] || 0) - (DORD[b2.days] || 0) || String(a.at).localeCompare(String(b2.at)));
    for (const x of slots) {
      const row = document.createElement("div"); row.className = "pathline slot";
      const t = document.createElement("input"); t.type = "time"; t.value = x.at;
      t.onchange = () => { if (t.value) { x.at = t.value; saveSchedule(slots); } };
      const dsel = document.createElement("select");
      for (const [v, n] of [["", "每天"], ["weekday", "工作日"], ["weekend", "周末"]]) { const o = document.createElement("option"); o.value = v; o.textContent = n; dsel.appendChild(o); }
      dsel.value = x.days === "weekday" || x.days === "weekend" ? x.days : "";
      dsel.onchange = () => { if (dsel.value) x.days = dsel.value; else delete x.days; saveSchedule(slots); };
      const name = document.createElement("span"); name.className = "slotname"; name.textContent = refTitle(x.ref);
      const use = document.createElement("button"); use.textContent = "换成当前选中的"; use.disabled = !cfg.current;
      use.onclick = () => { x.ref = cfg.current; saveSchedule(slots); };
      const del = document.createElement("button"); del.textContent = "删除";
      del.onclick = () => saveSchedule(slots.filter((y) => y !== x));
      row.append(dsel, t, miniThumb(x.ref), name, use, del); box.appendChild(row);
    }
    if (!slots.length) box.innerHTML = '<div class="muted">（还没有时间点）</div>';
    $("#slotAdd").disabled = !cfg.current;
    const projTxt = ctx.project ? (ctx.projectLabel || ctx.project.slice(0, 8)) : "";
    $("#ctxline").textContent = ctx.conv ? "当前对话：" + (ctx.title || ctx.conv.slice(0, 8)) + (projTxt ? "　·　项目：" + projTxt : "　·　未关联项目") : "现在不在某个对话里（先打开一个对话再来绑定）";
    $("#bindConv").disabled = !ctx.conv || !cfg.current;
    $("#bindProj").disabled = !ctx.project || !cfg.current;
    const bl = $("#binds"); bl.textContent = "";
    const binds = cfg.bindings || [];
    for (const bd of binds) {
      const row = document.createElement("div"); row.className = "pathline slot";
      if ((bd.type === "conv" && bd.id === ctx.conv) || (bd.type === "project" && bd.id === ctx.project)) row.classList.add("here");
      const tag = document.createElement("b"); tag.textContent = bd.type === "conv" ? "对话" : "项目";
      const lab = document.createElement("span"); lab.className = "slotname"; lab.textContent = (bd.label || String(bd.id).slice(0, 8)) + "　→　" + refTitle(bd.ref);
      const del = document.createElement("button"); del.textContent = "解除";
      del.onclick = async () => { cfg.bindings = (cfg.bindings || []).filter((y) => !(y.type === bd.type && y.id === bd.id)); await save({ bindings: cfg.bindings }, true); renderSwitch(); };
      row.append(tag, miniThumb(bd.ref), lab, del); bl.appendChild(row);
    }
    if (!binds.length) bl.innerHTML = '<div class="muted">（还没有绑定）</div>';
  }
  $("#schOn").onchange = async () => { cfg.schedule = { ...(cfg.schedule || { slots: [] }), enabled: $("#schOn").checked }; await save({ schedule: cfg.schedule }, true); renderSwitch(); };
  $("#slotAdd").onclick = async () => {
    if (!cfg.current) return;
    const at = $("#slotAt").value || "07:00";
    const days = $("#slotDays").value || "";
    const slot = { at, ref: cfg.current }; if (days) slot.days = days;
    const slots = ((cfg.schedule || {}).slots || []).filter((x) => !(x.at === at && (x.days || "") === days)).concat([slot]);
    cfg.schedule = { ...(cfg.schedule || {}), enabled: true, slots };
    await save({ schedule: cfg.schedule }, true); renderSwitch();
  };
  async function bindTo(type) {
    const id = type === "conv" ? ctx.conv : ctx.project;
    if (!id || !cfg.current) return;
    const label = type === "conv" ? (ctx.title || id.slice(0, 8)) : (ctx.projectLabel || id.slice(0, 8));
    const list = (cfg.bindings || []).filter((x) => !(x.type === type && x.id === id)).concat([{ type, id, label, ref: cfg.current }]);
    cfg.bindings = list; await save({ bindings: list }, true); renderSwitch();
  }
  $("#bindConv").onclick = () => bindTo("conv");
  $("#bindProj").onclick = () => bindTo("project");
  $$("[data-moodtest]").forEach((bt) => bt.onclick = () => link.post({ type: "agywe:mood-test", mood: bt.dataset.moodtest }));

  // ---------------- 开屏动画 ----------------
  const SPLASH_TIP = {
    pet: "挂件顺着绳子掉下来、晃一晃，问候语一个字一个字冒出来；揭开时从挂件那里向外扩开一个圆。",
    curtain: "当前壁纸的预览图模糊铺满，中间一个大时钟；揭开时预览图变清晰再淡出，正好接上动起来的壁纸。",
    minimal: "Antigravity 的 A 一笔画出来再填色，外面一圈光环扩散，最后放大淡出。",
    media: "全屏播放你选的视频或动图，播完（或到最长等待时间）就进去，点一下可以跳过。还没选文件时会用「挂件登场」。"
  };
  function renderSplash() {
    const s = cfg.splash || {};
    $("#splashTip").textContent = SPLASH_TIP[s.style] || SPLASH_TIP.pet;
    $("#splashMediaPath").textContent = s.media ? s.media : "（没有选）";
  }
  $("#splashPreview").onclick = async () => { await save({}, true); link.post({ type: "agywe:splash-preview" }); };
  $("#splashMedia").onclick = async () => { const c = await post("pick-splash-media"); if (c && c.splash) { cfg = c; bindControls(); renderSplash(); notify("config"); } };
  $("#splashMediaReset").onclick = async () => { const c = await post("reset-splash-media"); if (c && c.splash) { cfg = c; bindControls(); renderSplash(); notify("config"); } };

  // ---------------- 会话头像 ----------------
  function avSrc(who) {
    const v = who === "user" ? cfg.avatarUser : (cfg.avatarAgent === undefined ? "pet" : cfg.avatarAgent);
    if (!v) return null;
    if (v === "pet") {
      const im = String((cfg.pet || {}).image || "");
      if (!im) return null;
      return im.startsWith("url:") ? im.slice(4) : "/pet-image?v=" + encodeURIComponent(String((cfg.pet || {}).stamp || 0));
    }
    if (String(v).startsWith("url:")) return String(v).slice(4);
    return "/avatar/" + who + "?v=" + encodeURIComponent(String(cfg.avatarStamp || 0));
  }
  function renderAvatars() {
    for (const who of ["user", "agent"]) {
      const box = $("#avprev-" + who);
      box.textContent = ""; box.className = "avprev shape-" + (cfg.avatarShape || "circle");
      const src = avSrc(who);
      if (src) { const img = new Image(); img.alt = ""; img.src = src; img.onerror = () => { box.textContent = "读不出来"; }; box.appendChild(img); }
      else { box.classList.add("def", "def-" + who); box.textContent = who === "user" ? Array.from(String(cfg.avatarUserText || "我")).slice(0, 2).join("") : "🤖"; }
      const v = who === "user" ? cfg.avatarUser : (cfg.avatarAgent === undefined ? "pet" : cfg.avatarAgent);
      $("#avpath-" + who).textContent = !v ? "（默认）" : v === "pet" ? "（用挂件的图片）" : String(v).startsWith("url:") ? "（导入的图片）" : v;
    }
  }
  $$("[data-avpick]").forEach((b) => b.onclick = async () => { const c = await post("pick-avatar", { who: b.dataset.avpick }); if (c && c.avatarStamp !== undefined) { cfg = c; notify("config"); renderAvatars(); } });
  $$("[data-avpet]").forEach((b) => b.onclick = async () => { const k = b.dataset.avpet === "user" ? "avatarUser" : "avatarAgent"; cfg[k] = "pet"; await save({ [k]: "pet", avatarStamp: Date.now() }, true); renderAvatars(); });
  $$("[data-avreset]").forEach((b) => b.onclick = async () => { const k = b.dataset.avreset === "user" ? "avatarUser" : "avatarAgent"; cfg[k] = null; await save({ [k]: null, avatarStamp: Date.now() }, true); renderAvatars(); });

  // ---------------- 外观预设 ----------------
  const PRESETS = {
    clear: { glass: true, panelOpacity: 0.18, contentOpacity: 0.12, bubbleOpacity: 0.35, blur: 10, dim: 0.15, dimMode: "auto", textShadow: true, textHalo: 0.75, haloColor: "auto", glassBorder: true },
    frost: { glass: true, panelOpacity: 0.5, contentOpacity: 0.35, bubbleOpacity: 0.6, blur: 24, dim: 0.2, dimMode: "auto", textShadow: true, textHalo: 0.45, haloColor: "auto", glassBorder: true },
    night: { glass: true, panelOpacity: 0.62, contentOpacity: 0.55, bubbleOpacity: 0.7, blur: 20, dim: 0.45, dimMode: "darken", textShadow: true, textHalo: 0.5, haloColor: "auto", glassBorder: false, glassTintOn: true, glassTint: "#12151d" }
  };
  $$("button.preset").forEach((btn) => btn.onclick = async () => {
    const p = PRESETS[btn.dataset.preset]; if (!p) return;
    Object.assign(cfg, p); await save(p, true); bindControls();
  });
  $("#exportlook").onclick = async () => { const r = await post("export-preset"); if (r && r.ok) $("#exportlook").textContent = "已导出 ✓"; setTimeout(() => { $("#exportlook").textContent = "导出…"; }, 2000); };
  $("#importlook").onclick = async () => {
    const r = await post("import-preset");
    if (r && r.error) { alert(r.error); return; }
    if (r && r.panelOpacity !== undefined) { cfg = r; bindControls(); notify("config"); renderPickInfo(); }
  };

  // ---------------- 系统联动状态 ----------------
  const AUDIO_TEXT = { live: "✔ 已接上系统声音", off: "未开启", denied: "✘ 被系统拒绝了（点一下 Antigravity 界面会再试一次）", unavailable: "✘ 抓不到系统声音" };
  async function renderLive() {
    try {
      const pi = $("#powerinfo");
      if (pi) get("info").then((inf) => { const b = !!(inf.power && inf.power.battery); const m = (cfg.battery || {}).mode || "fps"; pi.textContent = b ? "现在在用电池：" + (m === "pause" ? "壁纸已暂停" : m === "fps" ? "帧率限到 " + ((cfg.battery || {}).fps || 15) + " 帧" : "没有省电") : "现在插着电源（台式机一直是这个状态，省电不会生效）"; }).catch(() => { });
    } catch { }
    const info = await get("info").catch(() => null);
    if (!info) return;
    const np = info.nowPlaying;
    const st = !cfg.nowPlaying ? "未开启" : np && np.hasMedia ? `${np.state === 1 ? "▶" : "⏸"} ${np.title || "（无标题）"}${np.artist ? " — " + np.artist : ""}` : info.npError ? "✘ " + info.npError.slice(0, 120) : "没有检测到正在播放的媒体";
    $("#livestatus").textContent = `系统音频：${cfg.systemAudio === false ? "未开启" : (AUDIO_TEXT[info.audioState] || info.audioState)}　·　正在播放：${st}`;
  }
  setInterval(() => { if ($("#tab-play").classList.contains("on")) renderLive(); }, 2000);

  // ---------------- v0.7：小组件 / 音效 / 闲置动作 / 主题跟随 ----------------
  $$("[data-sfxtest]").forEach((b) => b.onclick = () => link.post({ type: "agywe:sfx-test", name: b.dataset.sfxtest, kind: b.dataset.kind || "" }));
  $$("[data-idletest]").forEach((b) => b.onclick = () => link.post({ type: "agywe:idle-test", act: b.dataset.idletest }));
  $$("[data-pomo]").forEach((b) => b.onclick = async () => { await save({}, true); link.post({ type: "agywe:pomo", op: b.dataset.pomo }); });
  $("#openquick").onclick = () => link.post({ type: "agywe:open-quick" });
  function renderTheme() {
    const el = $("#themeSw"); if (!el) return;
    const p = cfg && cfg.palette;
    el.textContent = "";
    if (!p || !p.accent) { el.textContent = "还没取到（等壁纸加载完，或者换一张）"; return; }
    for (const [k, label] of [["dominant", "主色"], ["accent", "强调色"]]) {
      const s = document.createElement("span"); s.className = "swatch"; s.style.background = p[k]; s.title = p[k];
      const t = document.createElement("span"); t.textContent = label + " " + p[k] + "　";
      el.append(s, t);
    }
  }
  function renderWidgets() {
    const n = $("#npnote"); if (!n) return;
    n.textContent = cfg.nowPlaying === false
      ? "⚠ 「播放」页的「正在播放」关着，迷你播放器拿不到歌曲信息，要用的话先把它打开。"
      : "歌曲信息来自 Windows 的媒体控制，网易云、QQ 音乐、Spotify、浏览器里放的都行。";
  }
  $$("nav button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.tab === "look") get("config").then((c) => { if (c) { cfg.palette = c.palette; renderTheme(); } }).catch(() => { });
    if (b.dataset.tab === "widgets") renderWidgets();
  }));


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

  // ---------------- v0.9 快捷键 ----------------
  const HK_ACTIONS = [["settings", "打开 / 关闭设置"], ["quick", "快速切换面板"], ["next", "下一张壁纸"], ["prev", "上一张壁纸"], ["pomo", "番茄钟开始 / 暂停"], ["hide", "隐藏 / 显示壁纸"]];
  const HK_DEFAULT = { settings: "Ctrl+Alt+W", quick: "Ctrl+Alt+Q", next: "Ctrl+Alt+]", prev: "Ctrl+Alt+[", pomo: "Ctrl+Alt+P", hide: "Ctrl+Alt+H" };
  let hkRec = null, hkState = {};
  const hkCur = () => ({ ...HK_DEFAULT, ...((cfg && cfg.hotkeys) || {}) });
  function hkEventMatch(e, a) {
    const p = hkParse(hkCur()[a]);
    return !!(p && e.code === p.code && !!e.ctrlKey === p.ctrl && !!e.altKey === p.alt && !!e.shiftKey === p.shift && !!e.metaKey === p.meta);
  }
  function renderHotkeys() {
    const box = $("#hotkeys"); if (!box || !cfg) return;
    box.textContent = "";
    const hk = hkCur();
    for (const [a, name] of HK_ACTIONS) {
      const row = document.createElement("div"); row.className = "row";
      const lb = document.createElement("label"); lb.textContent = name;
      const b = document.createElement("button"); b.type = "button"; b.className = "hk" + (hkRec && hkRec.a === a ? " rec" : "");
      b.textContent = hkRec && hkRec.a === a ? "请按新的组合键…" : (hk[a] || "（不用）");
      b.onclick = () => startRec(a);
      const msg = document.createElement("small");
      const st = hkState[a];
      if (hkRec && hkRec.a === a && hkRec.msg) { msg.textContent = hkRec.msg; msg.className = "hkwarn"; }
      else if (st === "taken") { msg.textContent = "⚠ 好像被别的程序占用了（QQ、输入法、截图工具的全局快捷键），按了可能到不了 Antigravity，换一个试试"; msg.className = "hkwarn"; }
      else if (st === "invalid") { msg.textContent = "✕ 这个组合不能用"; msg.className = "hkbad"; }
      else if (!hk[a]) msg.textContent = "已关掉，只能用菜单 / 挂件";
      const rst = document.createElement("button"); rst.type = "button"; rst.textContent = "默认"; rst.title = "恢复成 " + HK_DEFAULT[a];
      rst.disabled = hk[a] === HK_DEFAULT[a];
      rst.onclick = () => setHotkey(a, HK_DEFAULT[a]);
      row.append(lb, b, rst, msg);
      box.appendChild(row);
    }
  }
  async function setHotkey(a, combo) {
    const hk = { ...hkCur(), [a]: combo };
    cfg.hotkeys = hk;
    await save({ hotkeys: hk }, true);
    hkState[a] = undefined;
    if (combo) { try { const r = await post("hotkey-check", { combo }); hkState[a] = r.state; } catch { } }
    renderHotkeys();
  }
  function stopRec() {
    if (!hkRec) return;
    hkRec = null;
    window.removeEventListener("keydown", onRecKey, true);
    post("hotkey-capture", { on: false }).catch(() => { });
    renderHotkeys();
  }
  function startRec(a) {
    if (hkRec) { const same = hkRec.a === a; stopRec(); if (same) return; }
    hkRec = { a, msg: "" };
    post("hotkey-capture", { on: true }).catch(() => { });
    window.addEventListener("keydown", onRecKey, true);
    renderHotkeys();
    clearTimeout(startRec.t); startRec.t = setTimeout(() => { if (hkRec && hkRec.a === a) stopRec(); }, 19000);
  }
  function onRecKey(e) {
    if (!hkRec) return;
    e.preventDefault(); e.stopPropagation();
    if (["Control", "Alt", "Shift", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return;
    const mods = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
    if (e.key === "Escape" && !mods) { stopRec(); return; }
    const a = hkRec.a;
    if ((e.key === "Backspace" || e.key === "Delete") && !mods) { stopRec(); setHotkey(a, ""); return; }
    const p = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code };
    if (!hkKeyName(p.code)) { hkRec.msg = "这个键不能当快捷键，换一个"; renderHotkeys(); return; }
    if (!hkAllowed(p)) { hkRec.msg = (hkFormat(p) || "这个组合") + " 修饰键太少了，容易和打字冲突：至少两个修饰键，或者 F 键加一个"; renderHotkeys(); return; }
    const combo = hkFormat(p);
    const hk = hkCur();
    const dup = HK_ACTIONS.find(([x]) => x !== a && hkSig(hkParse(hk[x]) || { code: "" }) === hkSig(p));
    if (dup) { hkRec.msg = combo + " 已经给「" + dup[1] + "」用了"; renderHotkeys(); return; }
    const reserved = { "C:KeyC": 1, "C:KeyV": 1, "C:KeyX": 1, "C:KeyZ": 1, "C:KeyA": 1, "CS:KeyZ": 1, "CS:KeyP": 1, "A:F4": 1, "CS:KeyI": 1, "C:F5": 1 };
    if (reserved[hkSig(p)]) { hkRec.msg = combo + " 是常用的系统 / 编辑快捷键，换一个吧"; renderHotkeys(); return; }
    stopRec();
    setHotkey(a, combo);
  }
  async function scanHotkeys() {
    const el = $("#hkScan");
    try {
      const r = await post("hotkey-check", { all: true });
      hkState = {};
      for (const [a, v] of Object.entries(r.results || {})) hkState[a] = v.state;
      const n = Object.values(hkState).filter((x) => x === "taken").length;
      if (el) el.textContent = n ? " 检查了一遍：有 " + n + " 个好像被别的程序占用了。" : " 检查了一遍：没有发现和别的程序冲突。";
    } catch { }
    renderHotkeys();
  }
  $$("nav button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== "widgets" && hkRec) stopRec(); if (b.dataset.tab === "widgets") { scanHotkeys(); renderStats(); } }));

  // ---------------- v0.9 不同状态换装 / 提醒试一下 ----------------
  const MOOD_ROWS = [["busy", "agent 运行中"], ["done", "完成时"], ["attention", "需要确认时"], ["error", "出错时"]];
  function renderMoodOutfits() {
    const box = $("#moodOutfits"); if (!box || !cfg) return;
    const list = Array.isArray(cfg.outfits) ? cfg.outfits : [];
    const mo = { busy: "", done: "", attention: "", error: "", ...(cfg.moodOutfit || {}) };
    box.textContent = "";
    for (const [k, name] of MOOD_ROWS) {
      const row = document.createElement("div"); row.className = "row";
      const lb = document.createElement("label"); lb.textContent = name;
      const sel = document.createElement("select");
      const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "不换"; sel.appendChild(o0);
      for (const o of list) { const op = document.createElement("option"); op.value = o.id; op.textContent = o.name || o.id; sel.appendChild(op); }
      sel.value = list.some((o) => o.id === mo[k]) ? mo[k] : "";
      sel.disabled = !list.length;
      sel.onchange = async () => { cfg.moodOutfit = { ...mo, [k]: sel.value }; await save({ moodOutfit: cfg.moodOutfit }, true); };
      row.append(lb, sel);
      if (k !== "busy") {
        const t = document.createElement("button"); t.type = "button"; t.textContent = "试一下";
        t.onclick = () => link.post({ type: "agywe:mood-test", mood: k });
        row.appendChild(t);
      }
      if (!list.length) { const sm = document.createElement("small"); sm.textContent = "衣柜是空的，先在上面存几套"; row.appendChild(sm); }
      box.appendChild(row);
    }
  }
  $$("[data-caretest]").forEach((b) => b.onclick = () => link.post({ type: "agywe:care-test", kind: b.dataset.caretest }));

  // ---------------- v0.9 今日统计 ----------------
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  function durCn(ms) {
    const t = Math.round((Number(ms) || 0) / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
    return t <= 0 ? "0" : h ? h + " 小时 " + m + " 分" : m ? m + " 分" : t + " 秒";
  }
  async function renderStats() {
    const box = $("#stats"); if (!box) return;
    let days = [];
    try { days = (await get("stats?days=7")).days || []; } catch { }
    box.textContent = "";
    const t = days[days.length - 1] || {};
    const today = document.createElement("div"); today.className = "today";
    for (const [label, val] of [["完成", t.done || 0], ["需要确认", t.attention || 0], ["出错", t.error || 0], ["agent 运行", durCn(t.runMs)], ["最长一次", durCn(t.longestMs)], ["番茄", (t.pomo || 0) + (t.focusMin ? "（" + t.focusMin + " 分钟）" : "")]]) {
      const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = String(val); d.append(b, document.createTextNode(label)); today.appendChild(d);
    }
    box.appendChild(today);
    const cap1 = document.createElement("div"); cap1.className = "cap"; cap1.textContent = "最近 7 天 · agent 运行时长（柱子上是完成次数）"; box.appendChild(cap1);
    const max = Math.max(1, ...days.map((x) => x.runMs || 0));
    const week = document.createElement("div"); week.className = "week";
    days.forEach((x, i) => {
      const bar = document.createElement("div"); bar.className = "bar" + (i === days.length - 1 ? " today" : "");
      bar.title = x.day + "：完成 " + (x.done || 0) + " 次，agent 运行 " + durCn(x.runMs) + "，番茄 " + (x.pomo || 0) + " 个";
      const v = document.createElement("span"); v.textContent = x.done ? String(x.done) : "";
      const im = document.createElement("i"); im.style.height = Math.round(60 * (x.runMs || 0) / max) + "px";
      const lb = document.createElement("span"); lb.textContent = i === days.length - 1 ? "今天" : "周" + WD[x.weekday != null ? x.weekday : new Date(x.day).getDay()];
      bar.append(v, im, lb); week.appendChild(bar);
    });
    box.appendChild(week);
    if (days.some((x) => x.focusMin)) {
      const cap2 = document.createElement("div"); cap2.className = "cap"; cap2.textContent = "最近 7 天 · 番茄钟专注（分钟）"; box.appendChild(cap2);
      const fmax = Math.max(1, ...days.map((x) => x.focusMin || 0));
      const fw = document.createElement("div"); fw.className = "week focus";
      days.forEach((x, i) => {
        const bar = document.createElement("div"); bar.className = "bar" + (i === days.length - 1 ? " today" : "");
        bar.title = x.day + "：专注 " + (x.focusMin || 0) + " 分钟，" + (x.pomo || 0) + " 个番茄";
        const v = document.createElement("span"); v.textContent = x.focusMin ? String(x.focusMin) : "";
        const im = document.createElement("i"); im.style.height = Math.round(60 * (x.focusMin || 0) / fmax) + "px";
        const lb = document.createElement("span"); lb.textContent = i === days.length - 1 ? "今天" : "周" + WD[x.weekday != null ? x.weekday : new Date(x.day).getDay()];
        bar.append(v, im, lb); fw.appendChild(bar);
      });
      box.appendChild(fw);
    }
  }

  // ---------------- v0.10 倒数日 ----------------
  function cdLeft(x) {
    const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [Y, M, D] = String(x.date).split("-").map(Number);
    let d = new Date(Y, M - 1, D);
    if (x.yearly) { d = new Date(t0.getFullYear(), M - 1, D); if (d < t0) d = new Date(t0.getFullYear() + 1, M - 1, D); }
    return Math.round((d - t0) / 86400000);
  }
  function renderCountdowns() {
    const box = $("#cdList"); if (!box || !cfg) return;
    const list = Array.isArray(cfg.countdowns) ? cfg.countdowns : [];
    box.textContent = "";
    for (const x of list) {
      const row = document.createElement("div"); row.className = "cdrow";
      const b = document.createElement("b"); b.textContent = x.name || "（没有名字）";
      const n = cdLeft(x);
      const s = document.createElement("span"); s.textContent = x.date + (x.yearly ? "（每年）" : "") + " · " + (n === 0 ? "就是今天" : n > 0 ? "还有 " + n + " 天" : "已经过去 " + (-n) + " 天");
      const del = document.createElement("button"); del.textContent = "删除";
      del.onclick = async () => { cfg.countdowns = list.filter((y) => y !== x); await save({ countdowns: cfg.countdowns }, true); renderCountdowns(); };
      row.append(b, s, del); box.appendChild(row);
    }
  }
  $("#cdAdd").onclick = async () => {
    const name = $("#cdName").value.trim().slice(0, 24), date = $("#cdDate").value, msg = $("#cdMsg");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { msg.textContent = "先选一个日期"; return; }
    const list = Array.isArray(cfg.countdowns) ? [...cfg.countdowns] : [];
    if (list.length >= 20) { msg.textContent = "最多 20 个，先删掉几个"; return; }
    list.push({ id: Math.random().toString(16).slice(2, 10), name: name || date, date, yearly: $("#cdYearly").checked });
    cfg.countdowns = list;
    await save({ countdowns: list }, true);
    $("#cdName").value = ""; msg.textContent = "加好了" + (cfg.widgets && cfg.widgets.countdown ? "" : "，记得打开上面的「倒数日」开关");
    renderCountdowns();
  };

  // ---------------- v0.10 白噪音 ----------------
  let noisePlaying = false;
  function renderNoise(st) {
    if (st) noisePlaying = !!st.playing;
    const b = $("#noisePlay"); if (!b) return;
    b.textContent = noisePlaying ? "⏹ 停止" : "▶ 播放";
  }
  window.addEventListener("message", (e) => { if (!link.isFromParent(e)) return; const d = e.data || {}; if (d.type === "agywe:noise-state") renderNoise(d); });
  $("#noisePlay").onclick = () => link.post({ type: "agywe:noise", op: noisePlaying ? "stop" : "start", kind: (cfg.noise || {}).type || "rain", quiet: true });
  $$('[data-k="noise.type"]').forEach((el) => el.addEventListener("change", () => { if (noisePlaying) link.post({ type: "agywe:noise", op: "start", kind: el.value, quiet: true }); }));
  $$("nav button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab === "widgets") { renderCountdowns(); link.post({ type: "agywe:noise-ask" }); } }));

  // ---------------- v0.9 完整备份 ----------------
  $("#backupExport").onclick = async () => {
    const el = $("#backupInfo"); el.textContent = "正在打包…";
    const r = await post("export-backup");
    if (!r || !r.ok) { el.textContent = r && r.error ? "导出失败：" + r.error : ""; return; }
    el.textContent = "已保存：" + r.path + "（" + Math.max(1, Math.round(r.size / 1024)) + " KB，带了 " + r.files + " 个图片 / 视频）" + (r.skipped && r.skipped.length ? "；没放进去的：" + r.skipped.join("、") : "");
  };
  $("#backupImport").onclick = async () => {
    const el = $("#backupInfo");
    const r = await post("import-backup");
    if (!r || (!r.ok && !r.error)) return;
    if (!r.ok) { el.textContent = "恢复失败：" + r.error; return; }
    cfg = r.cfg;
    bindControls(); renderPet(); renderOutfits(); renderPickInfo(); renderTheme(); renderHotkeys();
    try { await loadLib(true); } catch { }
    notify("config"); notify("library");
    el.textContent = "恢复好了" + (r.from && r.from.createdAt ? "（备份时间 " + new Date(r.from.createdAt).toLocaleString() + "）" : "") + "，还原了 " + r.restored + " 个文件。" + (r.missing && r.missing.length ? "注意：" + r.missing.join("；") + "。" : "") + "原来的设置另存在 " + r.before;
  };

  // ---------------- v0.9 自检 ----------------
  function askParent(type, reply, ms) {
    return new Promise((res) => {
      const on = (e) => { if (!link.isFromParent(e)) return; const d = e.data || {}; if (d.type === reply) { window.removeEventListener("message", on); clearTimeout(t); res(d.r || null); } };
      const t = setTimeout(() => { window.removeEventListener("message", on); res(null); }, ms);
      window.addEventListener("message", on);
      if (!link.post({ type })) { window.removeEventListener("message", on); clearTimeout(t); res(null); }
    });
  }
  function askWall(ms) {
    return new Promise((res) => {
      if (!bc) return res(null);
      const ch = new BroadcastChannel("agywe");
      const t = setTimeout(() => { ch.close(); res(null); }, ms);
      ch.onmessage = (e) => { const d = e.data || {}; if (d.type === "selftest-wall") { clearTimeout(t); ch.close(); res(d.r || null); } };
      try { bc.postMessage({ type: "selftest" }); } catch { clearTimeout(t); ch.close(); res(null); }
    });
  }
  const ICON = { ok: "✅", warn: "⚠️", bad: "❌", off: "⚪" };
  async function runSelfTest() {
    const box = $("#selftest"); box.textContent = "正在检查…";
    $("#selfRun").disabled = true;
    try {
      const [info, page, wall, hk] = await Promise.all([
        get("info").catch(() => null), askParent("agywe:selftest", "agywe:selftest-page", 1500), askWall(2500),
        post("hotkey-check", { all: true }).catch(() => null)
      ]);
      cfg = await get("config").catch(() => cfg);
      const rows = [];
      const add = (st, name, text) => rows.push([st, name, text]);
      if (!info) add("bad", "插件", "读不到插件信息");
      else add(info.safe && info.safe.on ? "bad" : "ok", "插件", "v" + info.version + " · Antigravity " + info.app + " · Electron " + info.electron + (info.safe && info.safe.on ? " · 现在是安全模式" : ""));
      if (!wall) add("bad", "壁纸页", "没有回应（壁纸页没加载起来，或者被一键隐藏 / 安全模式停掉了）");
      else {
        add(wall.lib ? "ok" : "bad", "壁纸库", wall.lib ? wall.lib + " 张" : "一张都没找到，去「目录」里添加");
        if (!wall.effective) add("off", "当前壁纸", "还没选壁纸");
        else if (wall.ok) add(wall.fallback ? "warn" : "ok", "当前壁纸", (wall.title || wall.effective) + "（" + (wall.type || wall.kind) + "）" + (wall.fallback ? " · 场景没加载起来，用预览图顶着" : "") + " · 现在 " + wall.fps + " 帧" + (wall.paused ? " · 已暂停" : "") + (wall.hideAll ? " · 一键隐藏中" : "") + (wall.lowSpec ? " · 低配模式" : ""));
        else add("bad", "当前壁纸", "加载失败" + (page && page.lastErr ? "：" + page.lastErr : "，导出诊断报告能看到原因"));
        const soft = /swiftshader|basic render|llvmpipe|software/i.test(wall.gpu || "");
        add(!wall.webgl ? "bad" : soft ? "warn" : "ok", "显卡", !wall.webgl ? "WebGL 用不了，场景壁纸放不了（显卡驱动问题，或者硬件加速被关了）" : (soft ? "在用软件渲染，会很卡：" : "WebGL " + wall.webgl + " · ") + (wall.gpu || "未知显卡"));
      }
      if (page && page.glassPerf && page.glassPerf.scans) {
        const g = page.glassPerf;
        // v0.10.2：补漏扫描放在空闲时做，平均耗时不再直接影响手感；看最长的那次和新内容的延迟
        add(g.maxMs > 50 || (g.fast && (g.fastAvgMs > 8 || g.delayMs > 50)) ? "warn" : "ok", "毛玻璃扫描", "平均 " + g.avgMs + " ms，最长 " + g.maxMs + " ms，" + g.scans + " 次（" + g.minutes + " 分钟内）" + (g.slow ? "，有 " + g.slow + " 次超过 50 ms" : "") + "（启动后 15 秒内的不算最长）" + (g.fast ? " · 新内容 " + g.fast + " 批，平均 " + g.fastAvgMs + " ms，出现后 " + g.delayMs + " ms 内套上（最长 " + g.delayMaxMs + " ms）" : "") + " · 页面 " + g.nodes + " 个元素，毛玻璃 " + g.marked + " 块" + (g.maxMs > 50 || g.avgMs > 16 ? "。长对话里觉得卡的话，导出诊断报告给我" : ""));
      }
      if (!page) add("bad", "界面插件", "没有回应");
      else add(page.ready ? (page.hideAll ? "off" : "ok") : "warn", "界面插件", page.hideAll ? "现在是一键隐藏状态" : page.ready ? "毛玻璃 " + page.marked + " 块 · 挂件" + (page.pet ? (page.petTop ? "在最上层" : "在，但没放进最上层") : "没显示") + " · " + (page.darkText ? "深色字" : "浅色字") + (page.contrast && page.contrast.need ? " · 自动对比度已调厚背板" : "") : "壁纸页还没准备好" + (page.lastErr ? "：" + page.lastErr : ""));
      if (info) {
        const A = { live: ["ok", "已接上"], denied: ["warn", "被系统拒绝了，在界面上随便点一下会再试"], unavailable: ["bad", "这台电脑不支持抓系统声音"], off: ["warn", "还没接上（没有音乐类壁纸时也是这个状态）"] };
        add(cfg.systemAudio === false ? "off" : (A[info.audioState] || ["warn", info.audioState])[0], "系统音频", cfg.systemAudio === false ? "关着" : (A[info.audioState] || ["", info.audioState])[1]);
        const np = info.nowPlaying;
        const SUSP = { safe: "安全模式下不运行", battery: "用电池且设成暂停壁纸，后台先停着", hidden: "窗口都最小化了，后台先停着" };
        add(cfg.nowPlaying === false ? "off" : info.npSuspended ? "off" : info.npError ? "bad" : !np ? "warn" : "ok", "正在播放", cfg.nowPlaying === false ? "关着" : info.npSuspended ? (SUSP[info.npSuspended] || "暂停中") : info.npError ? "读不到：" + info.npError.slice(0, 160) + (info.npMode === "encoded" ? "（已改用备用启动方式）" : "") : !np ? "后台还没有输出（刚打开时等几秒）" : np.hasMedia ? "正在放：" + [np.title, np.artist].filter(Boolean).join(" — ") : "已连上，现在没在放歌");
        const fz = info.fuses;
        if (!fz || !fz.found) add("warn", "安全开关", "没读到 Antigravity.exe 的 Electron 安全开关" + (fz && fz.error ? "（" + fz.error.slice(0, 80) + "）" : "") + "，不影响现在使用");
        else if (fz.asarIntegrity === true) add("bad", "安全开关", "程序包完整性校验是开的：插件装不上这个版本");
        else if (fz.runAsNode === false) add("warn", "安全开关", "RunAsNode 被关了：现在能用，但 Antigravity 下次更新后安装器和自动重装都跑不起来");
        else add("ok", "安全开关", "RunAsNode 开 · 程序包完整性校验 关（插件能装、能自动重装）");
        add(info.notify ? "ok" : "bad", "通知", info.notify ? "支持，点上面「发一条测试通知」看能不能弹出来（开了勿扰模式就不会弹）" : "这台电脑不支持 Windows 通知");
        add(info.autofix && info.autofix.on ? "ok" : "off", "自动重装", info.autofix && info.autofix.on ? "开着" + (info.autofix.last && info.autofix.last.length ? " · 最近：" + info.autofix.last.slice(-1)[0] : "") : "关着，Antigravity 更新后要手动重装");
        add(info.safe && info.safe.fails ? "warn" : "ok", "启动", info.safe && info.safe.fails ? "最近有 " + info.safe.fails + " 次没能正常启动" : "最近启动都正常");
        add("ok", "电源", info.power && info.power.battery ? "在用电池（" + ({ fps: "降帧率", pause: "暂停壁纸", none: "不省电" }[(cfg.battery || {}).mode] || "降帧率") + "）" : "插着电源");
      }
      if (page) add(cfg.sfx && cfg.sfx.on === false ? "off" : page.sfx === "suspended" ? "warn" : "ok", "音效", cfg.sfx && cfg.sfx.on === false ? "关着" : page.sfx === "suspended" ? "要先在界面上点一下才能出声（浏览器的规定）" : "正常，点上面「试听音效」");
      if (hk && hk.results) {
        const taken = Object.entries(hk.results).filter(([, v]) => v.state === "taken");
        const off = Object.entries(hk.results).filter(([, v]) => v.state === "off").length;
        const used = Object.keys(hk.last || {}).length;
        add(taken.length ? "warn" : "ok", "快捷键", taken.length ? taken.map(([, v]) => v.combo).join("、") + " 好像被别的程序占用了，去「小组件」页换一个" : "没有发现冲突" + (off ? "（关掉了 " + off + " 个）" : "") + (used ? " · 这次启动用过 " + used + " 个" : ""));
        hkState = {}; for (const [a, v] of Object.entries(hk.results)) hkState[a] = v.state;
      }
      box.textContent = "";
      const bad = rows.filter((r) => r[0] === "bad").length, warn = rows.filter((r) => r[0] === "warn").length;
      const sum = document.createElement("div"); sum.className = "sum";
      sum.textContent = bad ? "有 " + bad + " 项不正常" + (warn ? "、" + warn + " 项要留意" : "") + "。看不懂的话导出一份诊断报告给我。" : warn ? "基本正常，有 " + warn + " 项要留意。" : "全部正常 🎉";
      box.appendChild(sum);
      for (const [st, name, text] of rows) {
        const r = document.createElement("div"); r.className = "st " + st;
        const i = document.createElement("span"); i.textContent = ICON[st];
        const n = document.createElement("b"); n.textContent = name;
        const t = document.createElement("span"); t.textContent = text;
        r.append(i, n, t); box.appendChild(r);
      }
    } catch (e) { box.textContent = "自检出错：" + (e && e.message || e); }
    finally { $("#selfRun").disabled = false; }
  }
  $("#selfRun").onclick = runSelfTest;
  $("#selfNotify").onclick = async () => { const r = await post("test-notify").catch(() => null); $("#selfNotify").textContent = r && r.ok ? "已发送，看右下角" : "发送失败"; setTimeout(() => { $("#selfNotify").textContent = "发一条测试通知"; }, 3000); };

  // ---------------- v0.8 设置搜索 ----------------
  const TAB_TITLE = {};
  $$("nav button").forEach((b) => { TAB_TITLE[b.dataset.tab] = b.textContent.trim(); });
  $$("main section").forEach((s) => { const k = s.id.replace(/^tab-/, ""); if (TAB_TITLE[k]) s.dataset.title = TAB_TITLE[k]; });
  const sq = $("#sq");
  function rowText(r) {
    let t = r.textContent || "";
    r.querySelectorAll("[title],[placeholder]").forEach((el) => { t += " " + (el.getAttribute("title") || "") + " " + (el.getAttribute("placeholder") || ""); });
    return t.toLowerCase();
  }
  function runSearch() {
    const s = sq.value.trim().toLowerCase();
    const main = $("main");
    main.classList.toggle("searching", !!s);
    let total = 0;
    $$("main section").forEach((sec) => {
      if (!s || sec.id === "tab-lib" || sec.id === "tab-props") { sec.classList.remove("hit"); return; }
      const words = s.split(/\s+/).filter(Boolean);
      let n = 0, head = "";
      [...sec.children].forEach((el) => {
        if (el.tagName === "H4") { head = el.textContent.toLowerCase(); return; }
        if (!el.classList.contains("row")) return;
        const txt = head + " " + rowText(el);
        const ok = words.every((x) => txt.includes(x));
        el.classList.toggle("nohit", !ok);
        el.classList.toggle("hitrow", ok);
        if (ok) n++;
      });
      sec.classList.toggle("hit", n > 0);
      total += n;
    });
    $("#sqempty").hidden = !s || total > 0;
    if (s) main.scrollTop = 0;
    if (s) { renderPet(); renderLive(); renderAbout(); renderOutfits(); }
  }
  let sqT = 0;
  sq.addEventListener("input", () => { clearTimeout(sqT); sqT = setTimeout(runSearch, 120); });
  sq.addEventListener("keydown", (e) => { if (e.key === "Escape" && sq.value) { e.preventDefault(); e.stopPropagation(); sq.value = ""; runSearch(); } });
  window.addEventListener("keydown", (e) => { if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); sq.focus(); sq.select(); } }, true);
  $$("nav button").forEach((b) => b.addEventListener("click", () => { if (sq.value) { sq.value = ""; runSearch(); } }));

  // ---------------- v0.8 自动对比度 ----------------
  function renderContrast(c) {
    const el = $("#contrastInfo"); if (!el) return;
    if (cfg && cfg.autoContrast === false) { el.textContent = "已关闭：完全按上面三个滑块来。"; return; }
    if (!c || !c.on || c.content == null) { el.textContent = "等壁纸取完颜色就会算（换一张壁纸，或者稍等几秒再打开这一页）。"; return; }
    const f = (x) => Number(x).toFixed(2);
    const b = c.base || {};
    if (!c.need) { el.textContent = `当前壁纸下字够清楚（对话区大约 ${Number(c.ratio).toFixed(1)}:1，目标 ${c.target}:1），没有额外调厚。`; return; }
    const parts = [];
    if (c.content > b.content + 0.004) parts.push(`对话区背板 ${f(b.content)} → ${f(c.content)}`);
    if (c.panel > b.panel + 0.004) parts.push(`面板 ${f(b.panel)} → ${f(c.panel)}`);
    if (c.chip > b.chip + 0.004) parts.push(`气泡 ${f(b.chip)} → ${f(c.chip)}`);
    el.textContent = `当前壁纸${c.dark ? "有偏暗的地方" : "有偏亮的地方"}，已经自动调厚：${parts.join("，")}。`;
  }
  window.addEventListener("message", (e) => {
    if (!link.isFromParent(e)) return;
    const d = e.data || {};
    if (d.type === "agywe:contrast") renderContrast(d.c);
    if (d.type === "agywe:zh-miss") renderZhMiss(d.miss || []);
  });
  function renderZhMiss(list) {
    const msg = $("#zhMissMsg");
    if (!msg) return;
    if (!list.length) { msg.textContent = "当前页没有检测到未翻译的固定界面英文。"; return; }
    const preview = list.slice(0, 12).join(" ｜ ");
    msg.textContent = `发现 ${list.length} 条未翻文本（点击上方补充翻译框可按「英文 = 中文」添加）：` + preview + (list.length > 12 ? " …" : "");
    msg.title = list.join("\n");
    const ta = $('[data-k="zhExtra"]');
    if (ta && !ta.value.trim()) ta.placeholder = list.slice(0, 4).map((x) => x + " = ").join("\n");
  }
  const zhMissBtn = $("#zhMissBtn");
  if (zhMissBtn) zhMissBtn.onclick = () => {
    const msg = $("#zhMissMsg"); if (msg) msg.textContent = "正在读取当前页未翻译文本…";
    try { link.post({ type: "agywe:want-zh-miss" }); } catch { }
  };
  const askContrast = () => { try { link.post({ type: "agywe:want-contrast" }); } catch { } };
  $$("nav button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab === "look") askContrast(); }));
  $$('[data-k="autoContrast"], [data-k="contrastTarget"], [data-k="panelOpacity"], [data-k="contentOpacity"], [data-k="bubbleOpacity"], [data-k="dim"]').forEach((el) => el.addEventListener("change", () => setTimeout(askContrast, 450)));

  // ---------------- v0.8 换装 ----------------
  const OUT_MAX = 30;
  const outImg = (o) => !o.image ? "" : String(o.image).startsWith("url:") ? String(o.image).slice(4) : "/outfit/" + encodeURIComponent(o.id) + "?v=" + encodeURIComponent(String(o.image).length);
  const rid = () => Math.random().toString(16).slice(2, 12);
  function outfitMsg(t) { const m = $("#outfitMsg"); if (m) m.textContent = t; }
  async function saveOutfits(list, extra) { cfg.outfits = list; await save({ outfits: list, ...(extra || {}) }, true); renderOutfits(); }
  function renderOutfits() {
    const box = $("#outfits"); if (!box || !cfg) return;
    const list = Array.isArray(cfg.outfits) ? cfg.outfits : [];
    const curIm = (cfg.pet && cfg.pet.image) || null;
    box.textContent = "";
    list.forEach((o, i) => {
      const card = document.createElement("div"); card.className = "outfit" + (((o.image || null) === curIm) ? " on" : ""); card.title = "点一下换上";
      const oi = document.createElement("div"); oi.className = "oi";
      const u = outImg(o);
      if (u) { const im = new Image(); im.src = u; im.alt = ""; im.onerror = () => { im.replaceWith(Object.assign(document.createElement("span"), { className: "def", textContent: "?" })); }; oi.appendChild(im); }
      else { const d = document.createElement("span"); d.className = "def"; d.textContent = "🧸"; oi.appendChild(d); }
      const nm = document.createElement("div"); nm.className = "on-n"; nm.textContent = o.name || ("第 " + (i + 1) + " 套"); nm.title = "双击改名";
      nm.addEventListener("dblclick", (e) => { e.stopPropagation(); nm.contentEditable = "true"; nm.focus(); document.getSelection().selectAllChildren(nm); });
      nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nm.blur(); } if (e.key === "Escape") { e.stopPropagation(); nm.textContent = o.name || ""; nm.blur(); } });
      nm.addEventListener("blur", () => {
        if (nm.contentEditable !== "true") return;
        nm.contentEditable = "false";
        const v = nm.textContent.trim().slice(0, 24);
        if (v && v !== o.name) saveOutfits(list.map((x) => x.id === o.id ? { ...x, name: v } : x));
        else nm.textContent = o.name || ("第 " + (i + 1) + " 套");
      });
      nm.addEventListener("click", (e) => { if (nm.contentEditable === "true") e.stopPropagation(); });
      const x = document.createElement("button"); x.className = "ox"; x.textContent = "✕"; x.title = "从衣柜里删掉（不删图片文件）";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        const slots = ((cfg.outfitRule && cfg.outfitRule.slots) || []).filter((s) => s.id !== o.id);
        cfg.outfitRule = { ...(cfg.outfitRule || {}), slots };
        saveOutfits(list.filter((y) => y.id !== o.id), { outfitRule: cfg.outfitRule });
      });
      card.addEventListener("click", async () => {
        cfg.pet = { ...(cfg.pet || {}), image: o.image || null, stamp: Date.now() };
        await save({ pet: cfg.pet }, true);
        renderOutfits(); renderPet();
        outfitMsg("换上「" + (o.name || "这一套") + "」了");
      });
      card.append(oi, nm, x);
      box.appendChild(card);
    });
    // 按时间换装
    const r = cfg.outfitRule || { enabled: false, slots: [] };
    $("#outfitRuleOn").checked = !!r.enabled;
    const sel = $("#outfitSel"); sel.textContent = "";
    list.forEach((o) => { const op = document.createElement("option"); op.value = o.id; op.textContent = o.name || o.id; sel.appendChild(op); });
    $("#outfitSlotAdd").disabled = !list.length;
    renderMoodOutfits();
    const sl = $("#outfitSlots"); sl.textContent = "";
    [...(r.slots || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach((s) => {
      const o = list.find((x) => x.id === s.id);
      const row = document.createElement("div"); row.className = "slotrow";
      const t = document.createElement("b"); t.textContent = s.at;
      const n = document.createElement("span"); n.textContent = "换上「" + (o ? (o.name || "未命名") : "（衣柜里没有了）") + "」";
      const del = document.createElement("button"); del.textContent = "删除";
      del.onclick = async () => { cfg.outfitRule = { ...r, slots: (r.slots || []).filter((y) => y !== s) }; await save({ outfitRule: cfg.outfitRule }, true); renderOutfits(); };
      row.append(t, n, del); sl.appendChild(row);
    });
  }
  $("#outfitSave").onclick = async () => {
    const list = Array.isArray(cfg.outfits) ? [...cfg.outfits] : [];
    const im = (cfg.pet && cfg.pet.image) || null;
    if (list.some((o) => (o.image || null) === im)) { outfitMsg("这一身已经在衣柜里了"); return; }
    if (list.length >= OUT_MAX) { outfitMsg("衣柜满了（最多 " + OUT_MAX + " 套），先删掉几套"); return; }
    list.push({ id: rid(), name: im ? "第 " + (list.length + 1) + " 套" : "默认小人", image: im });
    await saveOutfits(list);
    outfitMsg("存好了，双击名字可以改名");
  };
  $("#outfitAdd").onclick = async () => { const c = await post("pick-outfit"); if (c && Array.isArray(c.outfits)) { cfg = c; notify("config"); renderOutfits(); } };
  $("#outfitRuleOn").onchange = async () => { cfg.outfitRule = { ...(cfg.outfitRule || { slots: [] }), enabled: $("#outfitRuleOn").checked }; await save({ outfitRule: cfg.outfitRule }, true); renderOutfits(); };
  $("#outfitSlotAdd").onclick = async () => {
    const at = $("#outfitAt").value, id = $("#outfitSel").value;
    if (!/^\d{2}:\d{2}$/.test(at) || !id) return;
    const r = cfg.outfitRule || { enabled: false, slots: [] };
    const slots = (r.slots || []).filter((s) => s.at !== at).concat([{ at, id }]);
    cfg.outfitRule = { ...r, enabled: true, slots };
    await save({ outfitRule: cfg.outfitRule }, true);
    renderOutfits();
  };
  $$("nav button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab === "pet") renderOutfits(); }));

  // ---------------- v0.8 诊断报告 / 安全模式 ----------------
  function diagShow(r) { $("#diagInfo").textContent = r && r.ok ? "已保存：" + r.path : r && r.error ? "导出失败：" + r.error : ""; }
  $("#diagQuick").onclick = async () => { $("#diagInfo").textContent = "正在整理…"; diagShow(await post("export-diag", { quick: true, reveal: true })); };
  $("#diagExport").onclick = async () => { diagShow(await post("export-diag", {})); };
  let safeArmed = 0;
  $("#safeTest").onclick = async () => {
    if (Date.now() - safeArmed > 4000) { safeArmed = Date.now(); $("#safeTest").textContent = "再点一次确认（会重新加载窗口）"; setTimeout(() => { if (Date.now() - safeArmed >= 4000) $("#safeTest").textContent = "试一下安全模式"; }, 4100); return; }
    safeArmed = 0;
    await post("safe-test");
  };

  (async () => {
    cfg = await get("config");
    try { DEF = await get("defaults"); } catch { DEF = null; }
    bindControls();
    renderHotkeys();
    await loadLib(false);
    renderPickInfo();
    renderTheme();
    renderOutfits();
    askContrast();
    renderCountdowns();
    try { link.post({ type: "agywe:noise-ask" }); } catch { }
    try { bc && bc.postMessage({ type: "who-effective" }); } catch { }
    link.post({ type: "agywe:want-context" });
  })();
})();
