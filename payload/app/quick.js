"use strict";
/* agywe 快速切换壁纸：Ctrl+Alt+Q 或右键挂件打开，底部一排缩略图 */
(function () {
  const TOKEN = document.querySelector('meta[name="agywe-token"]').content;
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("agywe") : null;
  const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || "*";
  const $ = (s) => document.querySelector(s);
  const strip = $("#strip"), q = $("#q");
  const TYPE = { scene: "场景", video: "视频", web: "网页", image: "图片" };
  const VIEWS = ["fav", "recent", "all"];
  let cfg = null, lib = { items: [] }, view = "all", list = [], sel = 0, effKey = "", busy = false;
  const keyOf = (it) => it.kind + ":" + it.id;
  const get = async (p) => { const r = await fetch("/api/" + p, { cache: "no-store" }); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); };
  async function put(patch) {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", "x-agywe-token": TOKEN }, body: JSON.stringify(patch) });
    if (r.ok) cfg = await r.json();
    try { bc && bc.postMessage({ type: "config" }); } catch { }
    return r.ok;
  }
  const close = () => parent.postMessage({ type: "agywe:close-quick" }, parentOrigin);
  function thumb(it) {
    if (it.kind === "custom") return it.type === "image" ? "/custom/" + it.id : "";
    return it.preview ? "/we/" + it.id + "/" + String(it.preview).split("/").map(encodeURIComponent).join("/") : "";
  }
  function compute() {
    const hidden = new Set(cfg.hidden || []);
    const all = lib.items.filter((it) => it.supported && !hidden.has(keyOf(it)));
    const fav = new Set(cfg.favorites || []);
    let out;
    if (view === "fav") out = all.filter((it) => fav.has(keyOf(it)));
    else if (view === "recent") { const m = new Map(all.map((it) => [keyOf(it), it])); out = (cfg.recent || []).map((k) => m.get(k)).filter(Boolean); }
    else out = all;
    const s = q.value.trim().toLowerCase();
    if (s) out = out.filter((it) => String(it.title || "").toLowerCase().includes(s) || (it.tags || []).some((t) => String(t).toLowerCase().includes(s)) || String(it.workshopId || "").includes(s));
    return out;
  }
  function mark(scroll) {
    const cards = strip.querySelectorAll(".card");
    cards.forEach((c, i) => c.classList.toggle("sel", i === sel));
    const c = cards[sel];
    if (c && scroll) c.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    $("#info").textContent = list.length ? (sel + 1) + " / " + list.length + (list[sel] ? "　" + (list[sel].title || "") : "") : "";
  }
  function render(selKey) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === view));
    list = compute().slice(0, 600);
    strip.textContent = "";
    if (!list.length) {
      const e = document.createElement("div"); e.className = "empty";
      e.textContent = q.value.trim() ? "没有名字里带「" + q.value.trim() + "」的壁纸" : view === "fav" ? "还没有收藏。在「全部」里右键一张就能收藏。" : view === "recent" ? "还没有最近用过的记录。" : "没有找到壁纸，先去设置里添加。";
      strip.appendChild(e); $("#info").textContent = ""; return;
    }
    const fav = new Set(cfg.favorites || []);
    const frag = document.createDocumentFragment();
    list.forEach((it, i) => {
      const c = document.createElement("div"); c.className = "card" + (keyOf(it) === effKey ? " cur" : "");
      const u = thumb(it);
      if (u) {
        const im = new Image(); im.loading = "lazy"; im.decoding = "async"; im.alt = ""; im.src = u;
        im.onerror = () => { const ph = document.createElement("div"); ph.className = "ph"; ph.textContent = it.type === "video" ? "🎬" : "🖼"; im.replaceWith(ph); };
        c.appendChild(im);
      } else { const ph = document.createElement("div"); ph.className = "ph"; ph.textContent = it.type === "video" ? "🎬" : "🖼"; c.appendChild(ph); }
      const t = document.createElement("div"); t.className = "t"; t.textContent = it.title || "（无标题）"; t.title = it.title || "";
      const b = document.createElement("div"); b.className = "b"; b.textContent = (it.kind === "custom" ? "自定义·" : "") + (TYPE[it.type] || it.type || "");
      const f = document.createElement("div"); f.className = "f"; f.textContent = fav.has(keyOf(it)) ? "★" : "";
      c.append(t, b, f);
      c.addEventListener("click", (e) => apply(i, e.shiftKey));
      c.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleFav(i); });
      c.addEventListener("mouseenter", () => { sel = i; mark(false); });
      frag.appendChild(c);
    });
    strip.appendChild(frag);
    const want = selKey || effKey;
    const idx = want ? list.findIndex((it) => keyOf(it) === want) : -1;
    sel = idx >= 0 ? idx : 0;
    mark(true);
  }
  async function apply(i, keep) {
    const it = list[i]; if (!it || busy) return;
    busy = true;
    const patch = { current: { kind: it.kind, id: it.id } };
    if (!cfg.enabled) patch.enabled = true;
    if (cfg.paused) patch.paused = false;
    try {
      if (await put(patch)) {
        effKey = keyOf(it);
        parent.postMessage({ type: "agywe:switched", title: it.title, n: i + 1, total: list.length }, parentOrigin);
      }
    } finally { busy = false; }
    if (keep) render(keyOf(it)); else setTimeout(close, 90);
  }
  async function toggleFav(i) {
    const it = list[i]; if (!it) return;
    const k = keyOf(it), fav = new Set(cfg.favorites || []);
    if (fav.has(k)) fav.delete(k); else fav.add(k);
    await put({ favorites: [...fav] });
    render(k);
  }
  function move(step) { if (!list.length) return; sel = (sel + step + list.length) % list.length; mark(true); }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "PageDown") { e.preventDefault(); move(6); }
    else if (e.key === "PageUp") { e.preventDefault(); move(-6); }
    else if (e.key === "Enter") { e.preventDefault(); apply(sel, e.shiftKey); }
    else if (e.key === "Tab") { e.preventDefault(); view = VIEWS[(VIEWS.indexOf(view) + (e.shiftKey ? VIEWS.length - 1 : 1)) % VIEWS.length]; render(); }
    // v0.8 键盘操作补全
    else if (e.key === "Home" && (!q.value || document.activeElement !== q)) { e.preventDefault(); if (list.length) { sel = 0; mark(true); } }
    else if (e.key === "End" && (!q.value || document.activeElement !== q)) { e.preventDefault(); if (list.length) { sel = list.length - 1; mark(true); } }
    else if (e.ctrlKey && !e.altKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); toggleFav(sel); }
    else if (e.altKey && !e.ctrlKey && (e.key === "r" || e.key === "R")) { e.preventDefault(); $("#rand").click(); }
    else if (e.altKey && !e.ctrlKey && /^[1-3]$/.test(e.key)) { e.preventDefault(); view = VIEWS[+e.key - 1]; render(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== q) { q.focus(); }
  });
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { view = b.dataset.v; render(); q.focus(); }));
  q.addEventListener("input", () => render(null));
  strip.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); strip.scrollLeft += e.deltaY; } }, { passive: false });
  $("#bg").addEventListener("click", close);
  $("#close").addEventListener("click", close);
  $("#rand").addEventListener("click", () => {
    const pool = compute(); if (!pool.length) return;
    let i = 0, guard = 0;
    do { i = Math.floor(Math.random() * pool.length); } while (pool.length > 1 && keyOf(pool[i]) === effKey && guard++ < 20);
    list = pool; apply(i, true);
  });
  if (bc) bc.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "effective" && d.ref) {
      effKey = d.ref.kind + ":" + d.ref.id;
      strip.querySelectorAll(".card").forEach((c, i) => c.classList.toggle("cur", !!list[i] && keyOf(list[i]) === effKey));
    }
  });
  (async () => {
    try {
      cfg = await get("config");
      try { const acc = cfg.themeFollow && cfg.palette && cfg.palette.accent; if (acc) document.documentElement.style.setProperty("--acc", acc); } catch { }
      lib = await get("library");
      effKey = cfg.current ? cfg.current.kind + ":" + cfg.current.id : "";
      const hidden = new Set(cfg.hidden || []);
      const favN = (cfg.favorites || []).filter((k) => !hidden.has(k)).length;
      view = favN >= 2 ? "fav" : "all";
      render();
      try { bc && bc.postMessage({ type: "who-effective" }); } catch { }
    } catch (e) {
      strip.textContent = "";
      const d = document.createElement("div"); d.className = "empty"; d.textContent = "读取壁纸库失败：" + (e && e.message || e); strip.appendChild(d);
    }
    try { window.focus(); q.focus(); } catch { }
  })();
})();
