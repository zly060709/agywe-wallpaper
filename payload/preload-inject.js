
;/* ==== agywe wallpaper preload (injected by install.cjs) ==== */
(function agyweBoot() {
  "use strict";
  try {
    const { ipcRenderer, webFrame } = require("electron");
    if (process.isMainFrame === false) return;
    if (typeof window === "undefined" || window.top !== window) return;
    const host = location.hostname;
    if (!/^(127\.0\.0\.1|localhost)$/.test(host)) return;

    // ---- v0.8 安全模式：主进程说最近两次没能正常启动，就只放一条提示，插件的界面部分这次都不加载 ----
    function safeBanner(st) {
      const build = () => {
        try {
          if (document.getElementById("agywe-safe")) return;
          const box = document.createElement("div"); box.id = "agywe-safe";
          box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:430px;padding:12px 14px;border-radius:12px;background:rgba(28,30,40,.96);color:#eef1f8;font:13px/1.55 'Microsoft YaHei UI','Segoe UI',sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.14);text-shadow:none";
          const t = document.createElement("div"); t.style.cssText = "font-weight:700;margin-bottom:4px"; t.textContent = "🛟 壁纸插件现在是安全模式";
          const p = document.createElement("div"); p.style.cssText = "opacity:.85";
          p.textContent = st.reason === "manual"
            ? "这是你在设置里点的「试一下安全模式」。这次没有加载壁纸、毛玻璃、挂件和小组件，点下面的按钮就能恢复。"
            : "最近 " + (st.fails || 2) + " 次启动没能正常完成。为了保证 Antigravity 能用，这次先不加载壁纸、毛玻璃、挂件和小组件，原因已经记进诊断日志。";
          const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;margin-top:10px";
          const mk = (txt, pri, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.style.cssText = "all:unset;cursor:pointer;padding:5px 12px;border-radius:999px;" + (pri ? "background:#4f7cff;color:#fff" : "background:rgba(255,255,255,.12)"); b.onclick = fn; return b; };
          bar.append(mk("恢复插件并重新加载", true, () => { try { ipcRenderer.send("agywe:safe-exit"); } catch { } }), mk("先这样", false, () => { try { box.remove(); } catch { } }));
          box.append(t, p, bar);
          document.documentElement.appendChild(box);
        } catch { }
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build, { once: true }); else build();
      try { ipcRenderer.send("agywe:diag", { reason: "safe-mode", safe: st }); } catch { }
    }
    let SAFE = null;
    try { SAFE = ipcRenderer.sendSync("agywe:safe-sync"); } catch { SAFE = null; }
    if (SAFE && SAFE.safe) { safeBanner(SAFE); return; }

    const ORIGIN = "agywe://app";
    const HOLE_SEL = '[data-browser-hole]:not([data-browser-hole="false"])';
    const FIELD_SEL = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]';
    let cfg = null;
    let ready = false;
    let frame = null;
    let settingsFrame = null;
    let pet = null;
    let styleEl = null;
    let agents = 0;
    let hideAll = false;   // v0.8 一键隐藏（Ctrl+Alt+H），只在这个窗口、这次打开里有效
    try { hideAll = sessionStorage.getItem("agywe:hideall") === "1"; } catch { }

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    // v0.10.5：壁纸页还没加载完时 contentWindow 还是 about:blank（和页面同源），这时发会报「target origin 不匹配」，消息也送不到，先不发
    const post = (msg) => { try { frame && frame.__agyweLoaded && frame.contentWindow && frame.contentWindow.postMessage(msg, ORIGIN); } catch { } };
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
    const HK_DEF = { settings: "Ctrl+Alt+W", quick: "Ctrl+Alt+Q", next: "Ctrl+Alt+]", prev: "Ctrl+Alt+[", pomo: "Ctrl+Alt+P", hide: "Ctrl+Alt+H" };
    function hkLabel(a) { const v = cfg && cfg.hotkeys && typeof cfg.hotkeys[a] === "string" ? cfg.hotkeys[a] : HK_DEF[a]; return v || ""; }
    function hkMatch(e, a) {
      const p = hkParse(hkLabel(a));
      return !!(p && hkAllowed(p) && e.code === p.code && !!e.ctrlKey === p.ctrl && !!e.altKey === p.alt && !!e.shiftKey === p.shift && !!e.metaKey === p.meta);
    }

    // ---- agent 数量：截获页面发给主进程的 agent:update-active-count ----
    try {
      const orig = ipcRenderer.invoke.bind(ipcRenderer);
      ipcRenderer.invoke = function (channel, ...args) {
        try {
          if (channel === "agent:update-active-count") { const prev = agents; agents = Number(args[0]) || 0; post({ type: "agywe:agents", count: agents }); updatePetBusy(); onAgentCount(prev, agents); }
          if (channel === "notification:send" && args[0] && typeof args[0] === "object") onAppNotification(args[0]);
          if (channel === "window:set-title-bar-overlay" && cfg && cfg.enabled && cfg.titleBarMode === "clear" && args[0] && typeof args[0] === "object") {
            args[0] = { ...args[0], color: "rgba(0, 0, 0, 0)" };   // v0.10.3：Electron 不认 #00000000 这种 8 位写法，会直接报错
          }
        } catch { }
        return orig(channel, ...args);
      };
    } catch { }

    // ---- 样式 ----
    const CSS = `
html.agywe-on, html.agywe-on body { background: transparent !important; background-color: transparent !important; }
html.agywe-on [data-agywe-glass="clear"] { background-color: transparent !important; background-image: none !important; }
/* v0.10.2：图标按钮（切换侧边栏这类）悬停 / 按下 / 展开时原本是一块实色方块，改成半透明 */
html.agywe-glasson .agy-button[class*="agy-button-icon"]:is(:hover, :active, [aria-pressed="true"], [aria-expanded="true"], [aria-selected="true"], [aria-checked="true"], [data-state="open"], [data-state="on"], [data-state="active"], [data-state="checked"], [data-active="true"], [data-selected="true"]):not([data-agywe-glass]) { background-color: rgba(255,255,255,.13) !important; background-image: none !important; }
html.agywe-glasson.agywe-darktext .agy-button[class*="agy-button-icon"]:is(:hover, :active, [aria-pressed="true"], [aria-expanded="true"], [aria-selected="true"], [aria-checked="true"], [data-state="open"], [data-state="on"], [data-state="active"], [data-state="checked"], [data-active="true"], [data-selected="true"]):not([data-agywe-glass]) { background-color: rgba(0,0,0,.10) !important; }
/* v0.10.4：输入框外圈。原来的深色外框 / 阴影在壁纸上像一圈很粗的黑边，换成一条细的半透明线，点进去时稍微亮一点 */
html.agywe-glasson :is(.surface-composer, .surface-composer-card, [id="antigravity.agentSidePanelInputBox"]),
html.agywe-glasson :is(.surface-composer, .surface-composer-card)::before, html.agywe-glasson :is(.surface-composer, .surface-composer-card)::after { box-shadow: none !important; outline: none !important; }
html.agywe-glasson .surface-composer { border-color: transparent !important; }
html.agywe-glasson .surface-composer-card { border-color: rgba(255,255,255,var(--agywe-ring, .12)) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,var(--agywe-ring, .12)) !important; }
html.agywe-glasson .surface-composer:focus-within .surface-composer-card { box-shadow: inset 0 0 0 1px rgba(255,255,255,calc(var(--agywe-ring, .12) * 2)) !important; }
html.agywe-glasson.agywe-darktext .surface-composer-card { border-color: rgba(0,0,0,var(--agywe-ring, .12)) !important; box-shadow: inset 0 0 0 1px rgba(0,0,0,var(--agywe-ring, .12)) !important; }
html.agywe-glasson.agywe-darktext .surface-composer:focus-within .surface-composer-card { box-shadow: inset 0 0 0 1px rgba(0,0,0,calc(var(--agywe-ring, .12) * 2)) !important; }
html.agywe-glasson :is(.surface-composer, .surface-composer-card) :is(textarea, [contenteditable], [role="textbox"]) { outline: none !important; box-shadow: none !important; }
/* v0.10.3：有的图标按钮选中 / 展开时的实色方块画在 ::before / ::after 上，按钮本身是透明的 */
html.agywe-glasson [data-agywe-pse~="b"]::before, html.agywe-glasson [data-agywe-pse~="a"]::after { background-color: rgba(255,255,255,.13) !important; background-image: none !important; }
html.agywe-glasson.agywe-darktext [data-agywe-pse~="b"]::before, html.agywe-glasson.agywe-darktext [data-agywe-pse~="a"]::after { background-color: rgba(0,0,0,.10) !important; }
html.agywe-on [data-agywe-glass="panel"], html.agywe-on [data-agywe-glass="field"] {
  background-color: rgba(var(--agywe-c, 20,20,20), var(--agywe-alpha, .55)) !important;
  background-image: none !important;
  -webkit-backdrop-filter: var(--agywe-bf, blur(var(--agywe-blur, 18px)) saturate(1.25)) !important;
  backdrop-filter: var(--agywe-bf, blur(var(--agywe-blur, 18px)) saturate(1.25)) !important;
}
html.agywe-on [data-agywe-glass="field"] { background-color: rgba(var(--agywe-c, 20,20,20), calc(var(--agywe-alpha, .55) * 1.2)) !important; }
html.agywe-on [data-agywe-glass="inner"] {
  background-color: rgba(var(--agywe-c, 20,20,20), calc(var(--agywe-alpha, .55) * .6)) !important;
  background-image: none !important;
}
html.agywe-on.agywe-tint [data-agywe-glass] { --agywe-c: var(--agywe-tint) !important; }
html.agywe-on :is([data-agywe-glass="dialog"], [data-agywe-glass="float"]) { box-shadow: 0 10px 32px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.14) !important; }
html.agywe-on.agywe-darktext :is([data-agywe-glass="dialog"], [data-agywe-glass="float"]) { box-shadow: 0 10px 32px rgba(0,0,0,.16), inset 0 0 0 1px rgba(0,0,0,.10) !important; }
html.agywe-on.agywe-border [data-agywe-glass="panel"] { box-shadow: inset 0 0 0 1px rgba(255,255,255,.10) !important; }
html.agywe-on.agywe-shadow body {
  text-shadow: 0 0 1px rgba(var(--agywe-halo, 255,255,255), var(--agywe-halo-a, .6)),
               0 0 3px rgba(var(--agywe-halo, 255,255,255), calc(var(--agywe-halo-a, .6) * .85)),
               0 0 8px rgba(var(--agywe-halo, 255,255,255), calc(var(--agywe-halo-a, .6) * .5));
}
#agywe-avatars {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important;
  pointer-events: none !important; z-index: 45 !important; overflow: hidden !important; background: transparent !important; contain: layout style;
}
#agywe-avatars .agywe-av {
  position: absolute; left: 0; top: 0; width: var(--agywe-av, 34px); height: var(--agywe-av, 34px); border-radius: 50%; overflow: hidden;
  display: grid; place-items: center; background: rgba(255,255,255,.12); will-change: transform;
  box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 1.5px rgba(255,255,255,.55);
}
#agywe-avatars[data-shape="rounded"] .agywe-av { border-radius: 28%; }
#agywe-avatars[data-shape="none"] .agywe-av { border-radius: 0; background: transparent !important; box-shadow: none; overflow: visible; }
#agywe-avatars .agywe-av img { width: 100%; height: 100%; object-fit: cover; display: block; -webkit-user-drag: none; }
#agywe-avatars .agywe-av-agent img { object-position: 50% 12%; }
#agywe-avatars[data-shape="none"] .agywe-av img { object-fit: contain; filter: drop-shadow(0 3px 5px rgba(0,0,0,.45)); }
#agywe-avatars .agywe-av.def.agywe-av-user { background: linear-gradient(135deg, #7aa7ff, #b48cff); color: #fff; font: 600 calc(var(--agywe-av, 34px) * .42)/1 "Microsoft YaHei UI", "Segoe UI", sans-serif; text-shadow: none; }
#agywe-avatars .agywe-av.def.agywe-av-agent { background: rgba(30,32,44,.7); }
#agywe-avatars .agywe-av.def.agywe-av-agent svg { width: 84%; height: 84%; }
#agywe-avatars .agywe-av.busy { animation: agywe-avpulse 1.4s ease-in-out infinite; }
#agywe-avatars .agywe-av.mood-done { box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 2.5px rgba(70,210,130,.95), 0 0 14px rgba(70,210,130,.6); }
#agywe-avatars .agywe-av.mood-attention { box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 2.5px rgba(255,175,40,.95), 0 0 14px rgba(255,175,40,.6); animation: agywe-avatt 1s ease-in-out infinite; }
#agywe-avatars .agywe-av.mood-error { box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 2.5px rgba(255,80,80,.95), 0 0 14px rgba(255,80,80,.6); }
@keyframes agywe-avatt { 0%, 100% { scale: 1; } 50% { scale: 1.12; } }
@keyframes agywe-avpulse {
  0%, 100% { box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 1.5px rgba(255,255,255,.55); }
  50% { box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 3px rgba(122,167,255,.95), 0 0 16px rgba(122,167,255,.7); }
}
#agywe-fx {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none; max-height: none;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; overflow: visible !important;
  pointer-events: none !important; z-index: 2147483645 !important;
}
html.agywe-font, html.agywe-font body, html.agywe-font .font-sans { font-family: var(--agywe-font) !important; }
#agywe-wall {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  border: 0 !important; margin: 0 !important; padding: 0 !important;
  z-index: -2147483647 !important; pointer-events: none !important; background: transparent !important;
  color-scheme: normal; opacity: 0; transition: opacity .6s ease;
}
html.agywe-on #agywe-wall { opacity: 1; }

/* ---- 挂件玩偶 ---- */
#agywe-pet {
  position: fixed !important; top: 0 !important; right: auto !important; bottom: auto !important; left: 0;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
  overflow: visible !important; width: var(--agywe-size, 64px); height: 1px; max-width: none; max-height: none;
  z-index: 2147483646 !important; pointer-events: none !important; color: inherit;
}
#agywe-pet .agywe-rig { position: absolute; left: 0; top: 0; width: var(--agywe-size, 64px); transform-origin: 50% 0; pointer-events: none; }
#agywe-pet .agywe-sway { display: flex; flex-direction: column; align-items: center; transform-origin: 50% 0; animation: agywe-swing 3.6s ease-in-out infinite; pointer-events: none; }
#agywe-pet .agywe-cord {
  width: 2px; height: calc(var(--agywe-cord, 30px) + var(--agywe-pull, 0px)); border-radius: 1px; pointer-events: none;
  background: linear-gradient(rgba(255,255,255,.85), rgba(235,235,245,.6)); box-shadow: 0 0 2px rgba(0,0,0,.55);
}
#agywe-pet .agywe-doll {
  width: var(--agywe-size, 64px); height: var(--agywe-size, 64px); margin-top: -3px; position: relative;
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important;
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: none;
  filter: drop-shadow(0 5px 7px rgba(0,0,0,.38)); transition: transform .18s ease, filter .18s ease;
}
#agywe-pet .agywe-doll img, #agywe-pet .agywe-doll svg { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; -webkit-user-drag: none; }
#agywe-pet .agywe-doll:hover { transform: scale(1.07); }
#agywe-pet .agywe-eye { transform-box: fill-box; transform-origin: center; animation: agywe-blink 5.5s infinite; }
#agywe-pet.agywe-hold .agywe-sway { animation-play-state: paused; }
#agywe-pet.agywe-hold .agywe-doll { cursor: grabbing; transition: none; }
#agywe-pet.agywe-armed .agywe-doll { filter: drop-shadow(0 0 10px rgba(122,167,255,.95)) drop-shadow(0 5px 7px rgba(0,0,0,.38)); }
#agywe-pet.agywe-busy .agywe-sway { animation-duration: 1.3s; }
#agywe-pet.agywe-busy .agywe-doll { animation: agywe-bob .55s ease-in-out infinite alternate; }
#agywe-pet .agywe-bubble {
  position: absolute; left: calc(100% + 6px); top: calc(var(--agywe-cord, 36px) + var(--agywe-size, 64px) * .12);
  width: max-content; max-width: 220px; padding: 6px 11px; border-radius: 12px 12px 12px 4px; white-space: normal;
  font: 600 12.5px/1.35 "Microsoft YaHei UI", "Segoe UI", sans-serif; color: #fff; text-shadow: none; letter-spacing: 0;
  background: rgba(30,34,46,.92); box-shadow: 0 4px 14px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.22);
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important; cursor: pointer;
  opacity: 0; transform: translateY(4px) scale(.85); transform-origin: 0 50%; transition: opacity .25s, transform .3s cubic-bezier(.3,1.6,.5,1);
}
#agywe-pet .agywe-bubble.left { left: auto; right: calc(100% + 6px); border-radius: 12px 12px 4px 12px; transform-origin: 100% 50%; }
#agywe-pet .agywe-bubble.show { opacity: 1; transform: none; }
#agywe-pet .agywe-bubble[data-mood="done"] { background: rgba(30,150,90,.94); }
#agywe-pet .agywe-bubble[data-mood="attention"] { background: rgba(215,140,20,.95); }
#agywe-pet .agywe-bubble[data-mood="error"] { background: rgba(200,58,58,.95); }
#agywe-pet.agywe-mood-done .agywe-doll { animation: agywe-jump .9s ease-out 2; }
#agywe-pet.agywe-mood-attention .agywe-doll { animation: agywe-wiggle .6s ease-in-out 5; filter: drop-shadow(0 0 9px rgba(255,180,40,.95)) drop-shadow(0 5px 7px rgba(0,0,0,.38)); }
#agywe-pet.agywe-mood-error .agywe-doll { rotate: 12deg; filter: drop-shadow(0 0 9px rgba(255,80,80,.95)) drop-shadow(0 5px 7px rgba(0,0,0,.38)); transition: rotate .4s, filter .3s; }
@keyframes agywe-jump { 0% { translate: 0 0; } 28% { translate: 0 -18px; } 55% { translate: 0 0; } 72% { translate: 0 -6px; } 100% { translate: 0 0; } }
@keyframes agywe-wiggle { 0%, 100% { rotate: 0deg; } 25% { rotate: -13deg; } 75% { rotate: 13deg; } }
#agywe-pet.agywe-spring .agywe-rig { transition: transform .75s cubic-bezier(.25,1.8,.5,1); }
#agywe-pet.agywe-spring .agywe-cord { transition: height .55s cubic-bezier(.25,1.9,.5,1); }
@keyframes agywe-swing { 0%, 100% { transform: rotate(3.5deg); } 50% { transform: rotate(-3.5deg); } }
@keyframes agywe-bob { from { translate: 0 0; } to { translate: 0 -4px; } }
@keyframes agywe-blink { 0%, 95%, 100% { transform: scaleY(1); } 97.5% { transform: scaleY(.1); } }

/* ---- 点选毛玻璃区域 ---- */
#agywe-pick {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none; max-height: none;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; overflow: visible !important;
  z-index: 2147483647 !important; pointer-events: none !important;
}
#agywe-pick .agywe-pick-box { position: fixed; display: none; border: 2px dashed #7aa7ff; background: rgba(122,167,255,.14); border-radius: 6px; pointer-events: none; transition: all .08s; }
#agywe-pick .agywe-pick-box.del { border-color: #ff8a8a; background: rgba(255,120,120,.14); }
#agywe-pick .agywe-pick-tip {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; pointer-events: none;
  font: 13px/1.4 "Segoe UI", "Microsoft YaHei UI", sans-serif; color: #fff; background: rgba(20,22,30,.85); box-shadow: 0 6px 24px rgba(0,0,0,.4); white-space: nowrap;
}
#agywe-settings {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none; max-height: none;
  border: 0; margin: 0; padding: 0; z-index: 2147483647 !important; background: transparent;
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important;
  color-scheme: dark;
}
/* ---- v0.7：主题跟随壁纸 ---- */
html.agywe-accent ::selection { background: rgba(var(--agywe-acc), .38) !important; }
html.agywe-accent textarea, html.agywe-accent [contenteditable="true"], html.agywe-accent input { caret-color: rgb(var(--agywe-acc)) !important; }
html.agywe-accent { accent-color: rgb(var(--agywe-acc)); }
html.agywe-accent ::-webkit-scrollbar-thumb { background-color: rgba(var(--agywe-acc), .42) !important; }

/* ---- 挂件闲置动作 ---- */
#agywe-pet .agywe-doll > img, #agywe-pet .agywe-doll > svg {
  translate: var(--agywe-lx, 0px) var(--agywe-ly, 0px); rotate: var(--agywe-lr, 0deg);
  transition: translate .45s ease, rotate .45s ease, filter .6s ease; transform-origin: 50% 85%;
}
#agywe-pet .agywe-eye { translate: var(--agywe-ex, 0px) var(--agywe-ey, 0px); transition: translate .25s ease; }
#agywe-pet.agywe-act-stretch .agywe-doll > * { animation: agywe-a-stretch 1.4s ease-in-out; }
#agywe-pet.agywe-act-look .agywe-doll > * { animation: agywe-a-look 1.6s ease-in-out; }
#agywe-pet.agywe-act-spin .agywe-doll > * { animation: agywe-a-spin .9s cubic-bezier(.4,0,.2,1); }
#agywe-pet.agywe-act-nod .agywe-doll > * { animation: agywe-a-nod 1s ease-in-out; }
#agywe-pet.agywe-act-hop .agywe-doll > * { animation: agywe-a-hop .9s ease-out; }
#agywe-pet.agywe-act-peek .agywe-doll > * { animation: agywe-a-peek 1.5s ease-in-out; }
@keyframes agywe-a-stretch { 0%, 100% { transform: none; } 30% { transform: scale(1.1, .86); } 60% { transform: scale(.93, 1.12); } 80% { transform: scale(1.02, .98); } }
@keyframes agywe-a-look { 0%, 100% { transform: none; } 20%, 45% { transform: scaleX(-1); } 55%, 85% { transform: none; } }
@keyframes agywe-a-spin { from { transform: perspective(240px) rotateY(0deg); } to { transform: perspective(240px) rotateY(360deg); } }
@keyframes agywe-a-nod { 0%, 100% { transform: none; } 25% { transform: rotate(9deg); } 50% { transform: rotate(-5deg); } 75% { transform: rotate(4deg); } }
@keyframes agywe-a-hop { 0%, 100% { transform: none; } 25% { transform: translateY(-16px) scale(.96, 1.05); } 50% { transform: translateY(0) scale(1.06, .94); } 70% { transform: translateY(-5px); } }
@keyframes agywe-a-peek { 0%, 100% { transform: none; } 30%, 70% { transform: translateY(6px) scale(.9) rotate(-8deg); } }
#agywe-pet.agywe-sleep .agywe-sway { animation-duration: 7s; }
#agywe-pet.agywe-sleep .agywe-doll > img, #agywe-pet.agywe-sleep .agywe-doll > svg { rotate: 14deg; translate: 0 3px; filter: brightness(.82) saturate(.85); }
#agywe-pet .agywe-zzz { position: absolute; left: calc(50% + var(--agywe-size, 64px) * .3); top: calc(var(--agywe-cord, 36px) - 6px); pointer-events: none; display: none;
  font: 800 13px/1 "Segoe UI", sans-serif; color: rgba(255,255,255,.92); text-shadow: 0 1px 3px rgba(0,0,0,.6); }
#agywe-pet.agywe-sleep .agywe-zzz { display: block; }
#agywe-pet .agywe-zzz i { position: absolute; left: 0; top: 0; font-style: normal; opacity: 0; animation: agywe-zzz 3s ease-out infinite; }
#agywe-pet .agywe-zzz i:nth-child(2) { animation-delay: 1s; font-size: 15px; }
#agywe-pet .agywe-zzz i:nth-child(3) { animation-delay: 2s; font-size: 18px; }
@keyframes agywe-zzz { 0% { opacity: 0; translate: 0 0; } 20% { opacity: 1; } 100% { opacity: 0; translate: 18px -26px; } }
#agywe-pet .agywe-bubble[data-mood="talk"] { background: rgba(30,34,46,.9); }
#agywe-pet .agywe-bubble[data-mood="rest"] { background: rgba(214,84,64,.94); }
#agywe-pet .agywe-bubble[data-mood="go"] { background: rgba(40,140,200,.94); }
#agywe-pet .agywe-bubble[data-mood="info"] { background: rgba(var(--agywe-acc, 143,180,255), .94); color: #10131c; }
#agywe-pet .agywe-badge { margin-top: 3px; padding: 1px 7px; border-radius: 999px; pointer-events: none; white-space: nowrap; display: none;
  font: 700 11px/1.55 "Segoe UI", "Microsoft YaHei UI", sans-serif; font-variant-numeric: tabular-nums; color: #fff; text-shadow: none;
  background: rgba(214,84,64,.9); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
#agywe-pet .agywe-badge.on { display: block; }
#agywe-pet .agywe-badge.brk { background: rgba(40,150,110,.92); }
#agywe-pet .agywe-badge.paused { opacity: .7; }

/* ---- 小组件：迷你播放器 / 番茄钟 ---- */
#agywe-dock {
  position: fixed !important; inset: auto !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
  overflow: visible !important; max-width: none; max-height: none; width: max-content; height: auto;
  z-index: 2147483640 !important; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none !important;
  font: 12.5px/1.35 "Microsoft YaHei UI", "Segoe UI", sans-serif; letter-spacing: 0; text-shadow: none; color: #f1f3f9;
}
#agywe-dock:empty { display: none; }
#agywe-dock .agywe-card {
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important; position: relative; box-sizing: border-box;
  color: #f1f3f9; background: rgba(24,27,37,.64); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
  border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.12); user-select: none; -webkit-user-select: none; cursor: grab;
  animation: agywe-cardin .3s cubic-bezier(.2,.9,.3,1.25);
}
html.agywe-darktext #agywe-dock .agywe-card { color: #1b1e27; background: rgba(250,250,252,.68); box-shadow: 0 8px 28px rgba(0,0,0,.16), inset 0 0 0 1px rgba(0,0,0,.08); }
#agywe-dock.agywe-dragging .agywe-card { cursor: grabbing; }
@keyframes agywe-cardin { from { opacity: 0; translate: 0 10px; scale: .96; } to { opacity: 1; translate: 0 0; scale: 1; } }
#agywe-dock button { all: unset; box-sizing: border-box; cursor: pointer; width: 26px; height: 24px; display: inline-grid; place-items: center; border-radius: 7px; color: inherit; }
#agywe-dock button:hover { background: rgba(127,127,127,.24); }
#agywe-dock button svg { width: 15px; height: 15px; fill: currentColor; display: block; }
#agywe-dock .agywe-x { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border-radius: 50%; opacity: 0; font-size: 10px; transition: opacity .15s; }
#agywe-dock .agywe-card:hover .agywe-x { opacity: .7; }
#agywe-dock .agywe-np { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px; align-items: center; width: 262px; padding: 8px 10px 7px 8px; }
#agywe-dock .agywe-art { width: 46px; height: 46px; border-radius: 10px; background: linear-gradient(135deg, var(--agywe-ui-acc, #8fb4ff), #b48cff) center / cover no-repeat; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
#agywe-dock .agywe-ti { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 12px; }
#agywe-dock .agywe-ar { opacity: .72; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#agywe-dock .agywe-ctl { display: flex; align-items: center; gap: 1px; margin-top: 2px; }
#agywe-dock .agywe-bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(127,127,127,.32); margin-left: 6px; overflow: hidden; }
#agywe-dock .agywe-bar i { display: block; height: 100%; width: 0; background: var(--agywe-ui-acc, #8fb4ff); border-radius: 2px; transition: width 1s linear; }
#agywe-dock .agywe-tm { font-size: 10.5px; opacity: .62; margin-left: 6px; font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }
#agywe-dock .agywe-np.pill { grid-template-columns: 30px minmax(0, auto); width: auto; max-width: 230px; padding: 4px 14px 4px 4px; border-radius: 999px; gap: 8px; }
#agywe-dock .agywe-np.pill .agywe-art { width: 30px; height: 30px; border-radius: 50%; animation: agywe-spin 9s linear infinite; }
#agywe-dock .agywe-np.pill.paused .agywe-art { animation-play-state: paused; }
#agywe-dock .agywe-np.pill .agywe-ar, #agywe-dock .agywe-np.pill .agywe-ctl, #agywe-dock .agywe-np.pill .agywe-x { display: none; }
#agywe-dock .agywe-np.pill:hover { max-width: 320px; }
#agywe-dock .agywe-np.pill:hover .agywe-ctl { display: flex; }
@keyframes agywe-spin { to { rotate: 360deg; } }
#agywe-dock .agywe-pomo { display: flex; align-items: center; gap: 10px; padding: 7px 10px 7px 7px; min-width: 214px; }
#agywe-dock svg.agywe-ring { width: 42px; height: 42px; flex: none; display: block; }
#agywe-dock .agywe-ring circle { fill: none; stroke-width: 3.5; }
#agywe-dock .agywe-ring .bg { stroke: rgba(127,127,127,.28); }
#agywe-dock .agywe-ring .fg { stroke: #ff6f5e; stroke-linecap: round; transition: stroke-dashoffset 1s linear; transform: rotate(-90deg); transform-origin: 50% 50%; }
#agywe-dock .agywe-pomo.brk .agywe-ring .fg { stroke: #3cc48f; }
#agywe-dock .agywe-ring text { font-size: 15px; text-anchor: middle; dominant-baseline: central; fill: currentColor; }
#agywe-dock .agywe-pt { flex: 1; min-width: 0; }
#agywe-dock .agywe-ph { font-size: 11.5px; opacity: .75; white-space: nowrap; }
#agywe-dock .agywe-time { font: 700 20px/1.1 "Segoe UI", "Microsoft YaHei UI", sans-serif; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-btns { display: flex; gap: 1px; }

/* ---- 休息提醒 ---- */
#agywe-rest {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none; max-height: none;
  margin: 0 !important; padding: 0 !important; border: 0 !important; z-index: 2147483643 !important; display: grid; place-items: center;
  background: rgba(8,10,16,.5) !important; -webkit-backdrop-filter: blur(16px) saturate(1.1); backdrop-filter: blur(16px) saturate(1.1);
  color: #fff; font: 14px/1.5 "Microsoft YaHei UI", "Segoe UI", sans-serif; text-shadow: 0 1px 8px rgba(0,0,0,.4); animation: agywe-fadein .5s ease;
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important;
}
#agywe-rest .agywe-rbox { text-align: center; }
#agywe-rest .agywe-remoji { font-size: 54px; line-height: 1; animation: agywe-a-hop 2.4s ease-in-out infinite; }
#agywe-rest .agywe-rtitle { font-size: 26px; font-weight: 700; margin-top: 12px; }
#agywe-rest .agywe-rtime { font: 700 64px/1.1 "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; margin: 6px 0 4px; }
#agywe-rest .agywe-rtip { opacity: .8; }
#agywe-rest .agywe-rbtns { margin-top: 22px; display: flex; gap: 10px; justify-content: center; }
#agywe-rest button { all: unset; cursor: pointer; padding: 8px 18px; border-radius: 999px; background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
#agywe-rest button:hover { background: rgba(255,255,255,.26); }
#agywe-rest button.pri { background: rgba(60,196,143,.85); }
@keyframes agywe-fadein { from { opacity: 0; } to { opacity: 1; } }

/* ---- 挂件右键菜单 ---- */
#agywe-menu {
  position: fixed !important; inset: auto !important; margin: 0 !important; border: 0 !important; max-width: none; max-height: none; overflow: visible !important;
  z-index: 2147483646 !important; min-width: 210px; padding: 5px !important; border-radius: 12px; box-sizing: border-box;
  color: #eef1f8; background: rgba(26,29,40,.88) !important; -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3);
  box-shadow: 0 12px 36px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.12); font: 13px/1.3 "Microsoft YaHei UI", "Segoe UI", sans-serif; text-shadow: none;
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important; animation: agywe-cardin .16s ease-out;
}
#agywe-menu button { all: unset; box-sizing: border-box; display: flex; width: 100%; gap: 14px; justify-content: space-between; padding: 7px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
#agywe-menu button:hover, #agywe-menu button:focus-visible { background: rgba(var(--agywe-acc, 143,180,255), .26); }
#agywe-menu button kbd { font: 11px Consolas, monospace; opacity: .55; }
#agywe-menu hr { border: 0; height: 1px; background: rgba(255,255,255,.1); margin: 4px 6px; }

/* ---- 快速切换 / 打字连击 ---- */
#agywe-quick {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none; max-height: none;
  border: 0; margin: 0; padding: 0; z-index: 2147483647 !important; background: transparent;
  pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important; color-scheme: dark;
}
#agywe-combo {
  position: fixed !important; right: auto !important; bottom: auto !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
  overflow: visible !important; max-width: none; max-height: none; width: max-content; height: auto; pointer-events: none !important; z-index: 2147483645 !important;
  font: italic 900 22px/1 "Segoe UI", sans-serif; color: rgb(var(--agywe-acc, 143,180,255)); -webkit-text-stroke: 1px rgba(0,0,0,.35);
  text-shadow: 0 2px 10px rgba(var(--agywe-acc, 143,180,255), .7); transform: scale(var(--agywe-cs, 1)); transform-origin: 0 100%;
}
#agywe-combo.pop { animation: agywe-combo .25s cubic-bezier(.3,1.8,.5,1); }
@keyframes agywe-combo { from { scale: 1.45; } to { scale: 1; } }

/* ---- v0.8：一键隐藏 / 提示条 / 运行计时 / 时钟 ---- */
html.agywe-hideall #agywe-pet, html.agywe-hideall #agywe-dock, html.agywe-hideall #agywe-avatars, html.agywe-hideall #agywe-fx,
html.agywe-hideall #agywe-combo, html.agywe-hideall #agywe-menu { display: none !important; }
#agywe-toast {
  position: fixed !important; left: 50% !important; top: 14px !important; right: auto !important; bottom: auto !important; inset: 14px auto auto 50% !important;
  margin: 0 !important; transform: translateX(-50%); z-index: 2147483647 !important; width: max-content; height: auto; max-width: 90vw; overflow: visible;
  padding: 8px 16px !important; border: 0 !important; border-radius: 999px; pointer-events: none !important; white-space: nowrap;
  font: 13px/1.4 "Microsoft YaHei UI", "Segoe UI", sans-serif; color: #fff !important; background: rgba(20,22,30,.88) !important;
  box-shadow: 0 6px 24px rgba(0,0,0,.4); text-shadow: none; animation: agywe-fadein .2s ease;
}
#agywe-pet .agywe-run { margin-top: 3px; padding: 1px 7px; border-radius: 999px; pointer-events: none; white-space: nowrap; display: none;
  font: 700 11px/1.55 "Segoe UI", "Microsoft YaHei UI", sans-serif; font-variant-numeric: tabular-nums; color: #fff; text-shadow: none;
  background: rgba(60,110,220,.9); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
#agywe-pet .agywe-run.on { display: block; }
#agywe-pet .agywe-bubble .agywe-sub { display: block; font-weight: 400; font-size: 11.5px; opacity: .9; margin-top: 2px; }
#agywe-dock .agywe-clock { padding: 8px 16px 9px 14px; min-width: 128px; text-align: right; }
#agywe-dock .agywe-ct { font: 700 30px/1.05 "Segoe UI", "Microsoft YaHei UI", sans-serif; font-variant-numeric: tabular-nums; letter-spacing: .5px; white-space: nowrap; }
#agywe-dock .agywe-ct small { font-size: 15px; font-weight: 600; opacity: .7; margin-left: 2px; }
#agywe-dock .agywe-ct small.ap { margin: 0 4px 0 0; font-size: 13px; }
#agywe-dock .agywe-cd { font-size: 12px; opacity: .75; margin-top: 3px; white-space: nowrap; }

/* ---- v0.9：待办 / 便签 / 低配模式 ---- */
#agywe-dock .agywe-todo, #agywe-dock .agywe-note { width: 252px; padding: 8px 10px 9px; cursor: default; }
#agywe-dock .agywe-wh { display: flex; align-items: center; gap: 6px; font-weight: 700; padding-right: 16px; cursor: grab; margin-bottom: 5px; }
#agywe-dock .agywe-wh small { font-weight: 400; opacity: .6; }
#agywe-dock .agywe-wh .agywe-clr { all: unset; margin-left: auto; font-size: 11px; font-weight: 400; opacity: .6; cursor: pointer; width: auto; height: auto; }
#agywe-dock .agywe-wh .agywe-clr:hover { opacity: 1; background: none; text-decoration: underline; }
#agywe-dock .agywe-tl { max-height: 220px; overflow: auto; margin: 0 -4px; padding: 0 4px; }
#agywe-dock .agywe-tr { display: flex; align-items: flex-start; gap: 7px; padding: 3px 0; border-radius: 6px; }
#agywe-dock .agywe-tr:hover { background: rgba(127,127,127,.12); }
#agywe-dock .agywe-tr .agywe-ck { flex: none; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px currentColor; opacity: .7; font-size: 11px; line-height: 16px; text-align: center; display: block; }
#agywe-dock .agywe-tr.done .agywe-ck { background: var(--agywe-ui-acc, #8fb4ff); box-shadow: none; color: #10131c; opacity: 1; }
#agywe-dock .agywe-tr .agywe-tt { flex: 1; min-width: 0; word-break: break-word; outline: none; border-radius: 4px; cursor: text; user-select: text; -webkit-user-select: text; }
#agywe-dock .agywe-tr .agywe-tt[contenteditable="true"] { background: rgba(127,127,127,.18); padding: 0 3px; }
#agywe-dock .agywe-tr.done .agywe-tt { text-decoration: line-through; opacity: .5; }
#agywe-dock .agywe-tr .agywe-td { flex: none; width: 18px; height: 18px; font-size: 10px; opacity: 0; }
#agywe-dock .agywe-tr:hover .agywe-td { opacity: .6; }
#agywe-dock .agywe-todo input, #agywe-dock .agywe-note textarea {
  all: unset; box-sizing: border-box; display: block; width: 100%; margin-top: 5px; padding: 5px 8px; border-radius: 8px; cursor: text;
  background: rgba(127,127,127,.16); color: inherit; font: inherit; user-select: text; -webkit-user-select: text; white-space: pre-wrap; word-break: break-word;
}
#agywe-dock .agywe-note textarea { min-height: 64px; max-height: 240px; overflow: auto; margin-top: 0; line-height: 1.5; }
#agywe-dock .agywe-todo input::placeholder, #agywe-dock .agywe-note textarea::placeholder { color: inherit; opacity: .45; }
#agywe-dock .agywe-empty { opacity: .5; font-size: 12px; padding: 2px 0; }
html.agywe-lowspec #agywe-dock .agywe-card, html.agywe-lowspec #agywe-menu, html.agywe-lowspec #agywe-rest { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
html.agywe-lowspec #agywe-dock .agywe-card { background: rgba(24,27,37,.92); }
html.agywe-lowspec.agywe-darktext #agywe-dock .agywe-card { background: rgba(250,250,252,.94); }
html.agywe-lowspec #agywe-pet .agywe-sway, html.agywe-lowspec #agywe-pet.agywe-busy .agywe-doll, html.agywe-lowspec #agywe-avatars .agywe-av.busy, html.agywe-lowspec #agywe-dock .agywe-np.pill .agywe-art { animation: none !important; }
/* ---- v0.10：摸头 / 回到顶部 / 字数 / 日历 / 系统占用 / 倒数日 ---- */
#agywe-pet .agywe-heart { position: absolute; left: calc(50% + var(--hx, 0px)); top: calc(var(--agywe-cord, 36px) + 4px); font-size: 15px; line-height: 1; pointer-events: none; text-shadow: none; animation: agywe-heart 1.3s ease-out forwards; }
@keyframes agywe-heart { 0% { opacity: 0; translate: 0 0; scale: .5; } 20% { opacity: 1; } 100% { opacity: 0; translate: var(--hdx, 0px) -52px; scale: 1.25; } }
#agywe-jump { position: fixed !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; width: max-content; height: auto; max-width: none; max-height: none; overflow: visible !important;
  z-index: 46 !important; display: flex; flex-direction: column; gap: 6px; pointer-events: none !important; }
#agywe-jump button { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font: 700 14px/1 "Segoe UI", sans-serif;
  color: #f1f3f9; background: rgba(24,27,37,.62); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); box-shadow: 0 4px 14px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.14);
  opacity: 0; translate: 0 6px; transition: opacity .2s, translate .2s, background .15s; -webkit-app-region: no-drag; app-region: no-drag; text-shadow: none; }
#agywe-jump button.on { opacity: .82; translate: 0 0; }
#agywe-jump button.on:hover { opacity: 1; background: rgba(var(--agywe-acc, 143,180,255), .55); }
#agywe-jump button:not(.on) { pointer-events: none; }
html.agywe-darktext #agywe-jump button { color: #1b1e27; background: rgba(250,250,252,.72); box-shadow: 0 4px 14px rgba(0,0,0,.14), inset 0 0 0 1px rgba(0,0,0,.08); }
#agywe-cc { position: fixed !important; margin: 0 !important; border: 0 !important; width: max-content; height: auto; max-width: none; overflow: visible; z-index: 47 !important; pointer-events: none !important;
  padding: 1px 8px !important; border-radius: 999px; font: 600 11px/1.6 "Segoe UI", "Microsoft YaHei UI", sans-serif; font-variant-numeric: tabular-nums; text-shadow: none;
  color: #f1f3f9 !important; background: rgba(24,27,37,.6) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); white-space: nowrap; transition: opacity .2s; }
html.agywe-darktext #agywe-cc { color: #2a2d36 !important; background: rgba(250,250,252,.75) !important; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
html.agywe-hideall #agywe-jump, html.agywe-hideall #agywe-cc { display: none !important; }
#agywe-dock .agywe-cal { padding: 8px 10px 9px; width: 236px; cursor: default; }
#agywe-dock .agywe-cal .agywe-wh button { width: 22px; height: 20px; font-size: 13px; }
#agywe-dock .agywe-cal .agywe-wh span { flex: 1; text-align: center; cursor: pointer; }
#agywe-dock .agywe-cg { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; text-align: center; font-size: 11.5px; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-cg i { font-style: normal; opacity: .55; font-size: 10.5px; padding-bottom: 2px; }
#agywe-dock .agywe-cg b { font-weight: 500; padding: 3px 0; border-radius: 6px; position: relative; }
#agywe-dock .agywe-cg b.we { opacity: .7; }
#agywe-dock .agywe-cg b.out { opacity: .25; }
#agywe-dock .agywe-cg b.td { background: var(--agywe-ui-acc, #8fb4ff); color: #10131c; font-weight: 800; opacity: 1; }
#agywe-dock .agywe-cg b.cd::after { content: ""; position: absolute; left: 50%; bottom: 1px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: #ff8a6a; }
#agywe-dock .agywe-sys { padding: 8px 12px 9px; width: 208px; cursor: default; }
#agywe-dock .agywe-sr { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 2px 8px; font-size: 12px; margin-top: 3px; }
#agywe-dock .agywe-sr span:nth-child(2) { text-align: right; font-variant-numeric: tabular-nums; opacity: .8; }
#agywe-dock .agywe-sb { grid-column: 1 / 3; height: 4px; border-radius: 2px; background: rgba(127,127,127,.28); overflow: hidden; }
#agywe-dock .agywe-sb i { display: block; height: 100%; width: 0; border-radius: 2px; background: var(--agywe-ui-acc, #8fb4ff); transition: width .8s ease; }
#agywe-dock .agywe-sb i.hot { background: #ff7a5e; }
#agywe-dock .agywe-cdn { padding: 8px 12px 9px; width: 220px; cursor: default; }
#agywe-dock .agywe-ci { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
#agywe-dock .agywe-ci span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#agywe-dock .agywe-ci b { font: 800 18px/1.1 "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-ci small { opacity: .65; font-size: 11px; }
#agywe-dock .agywe-ci.today b { color: #ff8a6a; }
#agywe-dock .agywe-ci.past { opacity: .5; }
/* v0.11 用量卡片 */
#agywe-dock .agywe-use { padding: 8px 12px 9px; width: 252px; cursor: grab; }
#agywe-dock .agywe-use .agywe-pv { display: none; }
#agywe-dock .agywe-use.pill { width: auto; max-width: 330px; padding: 4px 12px 4px 5px; border-radius: 999px; }
#agywe-dock .agywe-use.pill .agywe-pv { display: flex; align-items: center; gap: 7px; }
#agywe-dock .agywe-use.pill .agywe-cv, #agywe-dock .agywe-use.pill .agywe-x { display: none; }
#agywe-dock .agywe-pt { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-ring { width: 56px; height: 56px; flex: none; position: relative; }
#agywe-dock .agywe-ring.sm { width: 22px; height: 22px; }
#agywe-dock .agywe-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); display: block; }
#agywe-dock .agywe-ring circle { fill: none; stroke-width: 3.6; }
#agywe-dock .agywe-ring.sm circle { stroke-width: 5; }
#agywe-dock .agywe-ring .bg { stroke: rgba(127,127,127,.3); }
#agywe-dock .agywe-ring .fg { stroke: var(--agywe-ui-acc, #8fb4ff); stroke-linecap: round; transition: stroke-dasharray .6s ease; }
#agywe-dock .agywe-ring.warm .fg { stroke: #ffb648; }
#agywe-dock .agywe-ring.hot .fg { stroke: #ff7a5e; }
#agywe-dock .agywe-ring b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 800 12.5px/1 "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-ring.sm b { display: none; }
#agywe-dock .agywe-uh { display: flex; gap: 10px; align-items: center; }
#agywe-dock .agywe-um { min-width: 0; flex: 1; font-size: 11.5px; line-height: 1.5; }
#agywe-dock .agywe-um > div { opacity: .78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#agywe-dock .agywe-um b { font-size: 14px; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-um .agywe-mdl { opacity: .55; font-size: 10.5px; }
#agywe-dock .agywe-ul { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; margin-top: 4px; }
#agywe-dock .agywe-ul span:first-child { opacity: .65; white-space: nowrap; }
#agywe-dock .agywe-ul span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-uq { margin-top: 7px; padding-top: 5px; border-top: 1px solid rgba(127,127,127,.24); }
#agywe-dock .agywe-uq[hidden] { display: none; }
#agywe-dock .agywe-uqg { font-size: 11px; opacity: .62; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#agywe-dock .agywe-uqb { display: grid; grid-template-columns: 42px 1fr 52px; gap: 7px; align-items: center; font-size: 11px; margin-top: 2px; }
#agywe-dock .agywe-uqb span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
#agywe-dock .agywe-uqb .agywe-sb { grid-column: auto; }
#agywe-dock .agywe-ut { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#agywe-dock .agywe-uf { font-size: 10.5px; opacity: .45; margin-top: 6px; }
/* v0.11 猫猫桌宠 */
#agywe-buddy {
  position: fixed !important; inset: auto; right: 300px; bottom: 6px; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
  overflow: visible !important; width: var(--agywe-bsize, 150px); height: auto; max-width: none; max-height: none; color: inherit;
  z-index: 2147483641 !important; pointer-events: auto !important; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab;
  -webkit-app-region: no-drag !important; app-region: no-drag !important;
}
#agywe-buddy.agywe-hold { cursor: grabbing; }
#agywe-buddy .agywe-bwrap { position: relative; width: 100%; aspect-ratio: 384 / 416; pointer-events: none; }
#agywe-buddy video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; pointer-events: none; transition: opacity .14s linear; background: transparent; }
#agywe-buddy video.on { opacity: 1; }
#agywe-buddy .agywe-bbub {
  position: absolute; left: 50%; bottom: calc(100% - 10px); translate: -50% 6px; scale: .95; max-width: 250px; width: max-content; box-sizing: border-box;
  padding: 6px 12px; border-radius: 12px; background: rgba(30,34,46,.92); color: #fff; font: 600 12.5px/1.45 "Microsoft YaHei UI", "Segoe UI", sans-serif;
  text-align: center; opacity: 0; pointer-events: none; transition: opacity .2s, translate .2s, scale .2s; box-shadow: 0 4px 14px rgba(0,0,0,.3); text-shadow: none;
}
#agywe-buddy .agywe-bbub.show { opacity: 1; translate: -50% 0; scale: 1; pointer-events: auto; cursor: pointer; }
#agywe-buddy .agywe-bbub .agywe-sub { display: block; font-weight: 400; font-size: 11.5px; opacity: .9; margin-top: 2px; }
#agywe-buddy .agywe-bbub[data-mood="done"] { background: rgba(30,150,90,.94); }
#agywe-buddy .agywe-bbub[data-mood="attention"] { background: rgba(215,140,20,.95); }
#agywe-buddy .agywe-bbub[data-mood="error"] { background: rgba(200,58,58,.95); }
#agywe-buddy .agywe-bbub[data-mood="rest"] { background: rgba(214,84,64,.94); }
#agywe-buddy .agywe-bbub[data-mood="go"] { background: rgba(40,140,200,.94); }
#agywe-buddy .agywe-bbub[data-mood="info"] { background: rgba(var(--agywe-acc, 143,180,255), .94); color: #10131c; }
html.agywe-buddy-doll #agywe-pet { display: none !important; }
html.agywe-hideall #agywe-buddy { display: none !important; }`;

    let cssInjected = false;
    function ensureStyle() {
      if (!cssInjected && webFrame && typeof webFrame.insertCSS === "function") {
        // insertCSS 不受页面 CSP 的 style-src 限制
        try { webFrame.insertCSS(CSS); cssInjected = true; } catch { }
      }
      if (cssInjected) return;
      if (styleEl && styleEl.isConnected) return;
      styleEl = document.createElement("style");
      styleEl.id = "agywe-style";
      styleEl.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    function ensureFrame() {
      const root = document.documentElement;
      if (!root) return;
      ensureStyle();
      if (!frame || !frame.isConnected) {
        frame = document.createElement("iframe");
        frame.id = "agywe-wall";
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("tabindex", "-1");
        frame.setAttribute("allow", "autoplay; fullscreen");
        frame.addEventListener("load", function () { this.__agyweLoaded = true; });
        frame.src = ORIGIN + "/index.html";
        root.appendChild(frame);
      }
      if (!cfg || cfg.showButton !== false) ensurePet();
      else if (pet) { try { pet.root.remove(); } catch { } pet = null; }
    }

    // 放进浏览器"顶层"（popover），任何页面元素、z-index 都盖不住它
    function toTopLayer(el) {
      try {
        if (typeof el.showPopover !== "function") return;
        if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
        if (!el.matches(":popover-open")) el.showPopover();
      } catch { }
    }

    // =====================================================================
    // 挂件玩偶：从窗口顶部垂下来的小人，点它或往下拉绳子打开设置，左右拖可以换位置
    // =====================================================================
    const PULL_OPEN = 42;
    const PET_X_KEY = "agywe:pet-x";
    let petRatio = null;
    try { const v = parseFloat(localStorage.getItem(PET_X_KEY)); if (isFinite(v)) petRatio = clamp(v, 0, 1); } catch { }

    const SVGNS = "http://www.w3.org/2000/svg";
    function svgEl(tag, attrs, kids) {
      const el = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
      for (const c of kids || []) el.appendChild(c);
      return el;
    }
    // 默认角色（没有设置自定义图片时）
    function defaultDoll() {
      const ink = "#1c1e2b";
      return svgEl("svg", { viewBox: "0 0 64 70", "aria-hidden": "true" }, [
        svgEl("defs", {}, [
          svgEl("linearGradient", { id: "agywe-body", x1: "0", y1: "0", x2: "0", y2: "1" }, [
            svgEl("stop", { offset: "0", "stop-color": "#a9c4ff" }),
            svgEl("stop", { offset: "1", "stop-color": "#b48cff" })
          ])
        ]),
        svgEl("circle", { cx: 32, cy: 5, r: 3.2, fill: "none", stroke: "#e8e8f0", "stroke-width": 1.6 }),
        svgEl("ellipse", { cx: 22, cy: 63, rx: 4.5, ry: 5, fill: "#9a7ff0" }),
        svgEl("ellipse", { cx: 42, cy: 63, rx: 4.5, ry: 5, fill: "#9a7ff0" }),
        svgEl("ellipse", { cx: 8.5, cy: 40, rx: 4.5, ry: 6.5, fill: "#a4a8ff", transform: "rotate(-20 8.5 40)" }),
        svgEl("ellipse", { cx: 55.5, cy: 40, rx: 4.5, ry: 6.5, fill: "#a4a8ff", transform: "rotate(20 55.5 40)" }),
        svgEl("path", { d: "M32 9 C50 9 57 22 57 36 C57 52 46 62 32 62 C18 62 7 52 7 36 C7 22 14 9 32 9 Z", fill: "url(#agywe-body)" }),
        svgEl("path", { d: "M20 25 Q32 12 44 25", fill: "none", stroke: "rgba(255,255,255,.55)", "stroke-width": 3, "stroke-linecap": "round" }),
        svgEl("g", { class: "agywe-eye" }, [svgEl("ellipse", { cx: 23.5, cy: 37, rx: 3.4, ry: 4.4, fill: ink }), svgEl("circle", { cx: 24.6, cy: 35.4, r: 1.2, fill: "#fff" })]),
        svgEl("g", { class: "agywe-eye" }, [svgEl("ellipse", { cx: 40.5, cy: 37, rx: 3.4, ry: 4.4, fill: ink }), svgEl("circle", { cx: 41.6, cy: 35.4, r: 1.2, fill: "#fff" })]),
        svgEl("ellipse", { cx: 16.5, cy: 45, rx: 4, ry: 2.4, fill: "#ff9fc0", opacity: .7 }),
        svgEl("ellipse", { cx: 47.5, cy: 45, rx: 4, ry: 2.4, fill: "#ff9fc0", opacity: .7 }),
        svgEl("path", { d: "M28.5 46 Q32 49.5 35.5 46", fill: "none", stroke: ink, "stroke-width": 2, "stroke-linecap": "round" })
      ]);
    }

    function petCfg() {
      const p = (cfg && cfg.pet) || {};
      const size = Number(p.size), cord = Number(p.cord);
      return {
        size: clamp(isFinite(size) && size > 0 ? size : 64, 32, 220),
        cord: clamp(isFinite(cord) ? cord : 36, 0, 300),
        image: p.image || null,
        stamp: p.stamp || 0
      };
    }
    function petLeft(pc) {
      const s = pc.size, W = innerWidth || 1200;
      const ratio = petRatio == null ? 0.62 : petRatio;
      return clamp(Math.round(ratio * W - s / 2), 6, Math.max(6, W - s - 6));
    }
    function placePet(leftPx) {
      if (!pet) return;
      const pc = petCfg();
      const l = leftPx == null ? petLeft(pc) : clamp(leftPx, 6, Math.max(6, innerWidth - pc.size - 6));
      pet.left = l;
      pet.root.style.setProperty("left", l + "px", "important");
    }
    function savePetX() {
      if (!pet) return;
      const pc = petCfg();
      petRatio = clamp((pet.left + pc.size / 2) / (innerWidth || 1), 0, 1);
      try { localStorage.setItem(PET_X_KEY, String(petRatio)); } catch { }
    }

    function refreshPet() {
      if (!pet) return;
      const pc = petCfg();
      pet.root.style.setProperty("--agywe-size", pc.size + "px");
      pet.root.style.setProperty("--agywe-cord", pc.cord + "px");
      placePet();
      try { pet.doll.title = "壁纸设置（" + (hkLabel("settings") || "没设快捷键") + "）\n点一下或往下拉绳子打开 · 左右拖动换位置 · 右键有菜单"; } catch { }
      const im = petImageNow(pc);
      const look = im.look;
      if (look !== pet.look) {
        pet.look = look;
        pet.doll.textContent = "";
        if (im.src) {
          const img = new Image();
          img.alt = "";
          img.draggable = false;
          img.decoding = "async";
          img.onerror = () => { if (pet && pet.look === look) { pet.doll.textContent = ""; pet.doll.appendChild(defaultDoll()); } };
          img.src = im.src;
          pet.doll.appendChild(img);
        } else {
          pet.doll.appendChild(defaultDoll());
        }
      }
      updatePetBusy();
    }
    // v0.9：运行中 / 完成 / 需要确认 / 出错时换成衣柜里指定的那一套（只是临时换，不改「角色图片」）
    function petImageNow(pc) {
      try {
        const mo = (cfg && cfg.moodOutfit) || {};
        const st = (mood && mood.state) || (agents > 0 ? "busy" : "");
        const id = st && mo[st];
        const o = id && Array.isArray(cfg.outfits) ? cfg.outfits.find((x) => x && x.id === id) : null;
        if (o) {
          if (!o.image) return { look: "o-default", src: null };
          const s = String(o.image);
          return { look: "o:" + id + ":" + s.length, src: s.startsWith("url:") ? s.slice(4) : ORIGIN + "/outfit/" + encodeURIComponent(id) + "?v=" + s.length };
        }
      } catch { }
      if (!pc.image) return { look: "default", src: null };
      return { look: "img:" + pc.stamp + ":" + pc.image, src: String(pc.image).startsWith("url:") ? String(pc.image).slice(4) : ORIGIN + "/pet-image?v=" + encodeURIComponent(String(pc.stamp)) };
    }
    function updatePetBusy() { try { pet && pet.root.classList.toggle("agywe-busy", agents > 0); } catch { } }

    function ensurePet() {
      if (pet && pet.root.isConnected) { refreshPet(); toTopLayer(pet.root); return; }
      const root = document.createElement("div"); root.id = "agywe-pet";
      const rig = document.createElement("div"); rig.className = "agywe-rig";
      const sway = document.createElement("div"); sway.className = "agywe-sway";
      const cord = document.createElement("div"); cord.className = "agywe-cord";
      const doll = document.createElement("div"); doll.className = "agywe-doll";
      doll.setAttribute("role", "button");
      doll.setAttribute("tabindex", "0");
      doll.title = "壁纸设置（Ctrl+Alt+W）\n点一下或往下拉绳子打开 · 左右拖动换位置";
      sway.append(cord, doll); rig.appendChild(sway); root.appendChild(rig);
      document.documentElement.appendChild(root);
      pet = { root, rig, sway, cord, doll, look: "", left: 0 };
      bindPetDrag();
      try { bindPetExtras(); } catch { }
      refreshPet();
      toTopLayer(root);
    }

    let petDiagN = 0;
    function bindPetDrag() {
      const { doll, rig, root } = pet;
      let d = null;
      doll.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        d = { x: e.clientX, y: e.clientY, left: pet.left, mode: null, pull: 0 };
        try { doll.setPointerCapture(e.pointerId); } catch { }
        root.classList.remove("agywe-spring");
        root.classList.add("agywe-hold");
        if (petDiagN++ < 3) diag("pet-pointerdown");
        try { sfxPlay("pet"); closeMenu(); } catch { }
      });
      doll.addEventListener("pointermove", (e) => {
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.mode) {
          if (Math.hypot(dx, dy) < 6) return;
          d.mode = dy > Math.abs(dx) ? "pull" : "move";
        }
        if (d.mode === "pull") {
          d.pull = clamp(dy, 0, 150);
          const L = petCfg().cord + d.pull + petCfg().size / 2;
          root.style.setProperty("--agywe-pull", d.pull + "px");
          rig.style.transform = `rotate(${clamp(-Math.atan2(dx, L) * 180 / Math.PI, -35, 35)}deg)`;
          root.classList.toggle("agywe-armed", d.pull >= PULL_OPEN);
        } else {
          placePet(d.left + dx);
          rig.style.transform = `rotate(${clamp(-(e.movementX || 0) * 2.2, -24, 24)}deg)`;
        }
      });
      const end = (e, cancel) => {
        if (!d) return;
        const s = d; d = null;
        try { doll.releasePointerCapture(e.pointerId); } catch { }
        e.preventDefault(); e.stopPropagation();
        root.classList.add("agywe-spring");
        root.classList.remove("agywe-hold", "agywe-armed");
        root.style.setProperty("--agywe-pull", "0px");
        rig.style.transform = "";
        setTimeout(() => { try { root.classList.remove("agywe-spring"); } catch { } }, 800);
        if (cancel) return;
        if (s.mode === "move") savePetX();
        else if (s.mode === "pull") { if (s.pull >= PULL_OPEN) { clearMood(); toggleSettings(true); } }
        else if (mood.state) clearMood();          // 有提示时，点一下先把提示点掉
        else toggleSettings();
      };
      doll.addEventListener("pointerup", (e) => end(e, false));
      doll.addEventListener("pointercancel", (e) => end(e, true));
      doll.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (e.detail === 0) toggleSettings(); });
      doll.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSettings(); } });
    }

    // ---- 诊断：把状态发给主进程写日志 ----
    let lastErr = null;
    function describe(el) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      let cls = el.className; if (cls && typeof cls === "object") cls = cls.baseVal;
      return {
        tag: el.tagName, id: el.id || "", cls: String(cls || "").slice(0, 120),
        region: cs.getPropertyValue("-webkit-app-region") || cs.getPropertyValue("app-region") || "",
        pe: cs.pointerEvents, z: cs.zIndex, pos: cs.position, op: cs.opacity, bg: cs.backgroundColor,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
      };
    }
    // 哪些样式规则给这个元素设了背景（排查"标了毛玻璃却不生效"）
    function bgRules(el) {
      const out = [];
      const walk = (rules, layer, href) => {
        for (const r of rules) {
          if (out.length >= 12) return;
          try {
            if (r.cssRules && !(r instanceof CSSStyleRule)) {
              const name = (typeof CSSLayerBlockRule !== "undefined" && r instanceof CSSLayerBlockRule) ? "@layer " + (r.name || "?") : (r.conditionText ? "@" + r.conditionText.slice(0, 40) : "");
              walk(r.cssRules, name ? (layer ? layer + " > " + name : name) : layer, href);
              continue;
            }
            if (!(r instanceof CSSStyleRule)) continue;
            const st = r.style;
            const props = ["background-color", "background", "background-image", "backdrop-filter"].filter((p) => st.getPropertyValue(p));
            if (!props.length) { if (r.cssRules && r.cssRules.length) walk(r.cssRules, layer, href); continue; }
            let hit = false;
            try { hit = el.matches(r.selectorText); } catch { }
            if (!hit) continue;
            out.push({ sel: r.selectorText.slice(0, 140), layer, href: String(href || "").slice(-60), decl: props.map((p) => p + ":" + st.getPropertyValue(p).slice(0, 60) + (st.getPropertyPriority(p) ? " !" + st.getPropertyPriority(p) : "")).join("; ") });
          } catch { }
        }
      };
      const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
      for (const s of sheets) { let rules = null; try { rules = s.cssRules; } catch { out.push({ blocked: String(s.href || "").slice(-60) }); continue; } if (rules) walk(rules, "", s.href || (s.ownerNode && s.ownerNode.tagName)); }
      const cs = getComputedStyle(el);
      return { inline: el.getAttribute("style") ? el.getAttribute("style").slice(0, 300) : "", computedBg: cs.backgroundColor, bf: cs.backdropFilter, anim: cs.animationName, trans: cs.transitionProperty, rules: out, sheets: sheets.length };
    }
    function nodeInfo(el) {
      let cls = el.className; if (cls && typeof cls === "object") cls = cls.baseVal;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const o = { tag: el.tagName, id: el.id || "", cls: String(cls || "").slice(0, 120), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], z: cs.zIndex, pos: cs.position };
      if (el.tagName === "IMG") o.src = String(el.currentSrc || el.src || "").slice(0, 200);
      if (el.tagName === "VIDEO") o.src = String(el.currentSrc || el.src || "").slice(0, 200);
      if (el.tagName === "CANVAS") o.canvas = [el.width, el.height];
      if (el.tagName === "IFRAME") o.src = String(el.src || "").slice(0, 200);
      if (cs.backgroundImage && cs.backgroundImage !== "none") o.bgImg = cs.backgroundImage.slice(0, 200);
      const t = (el.textContent || "").trim(); if (t && el.children.length < 4) o.text = t.slice(0, 40);
      return o;
    }
    // 右下角都有什么（找桌宠是不是在界面里面）
    function cornerReport() {
      const W = innerWidth, H = innerHeight, seen = new Set(), out = [];
      for (const fx of [0.98, 0.95, 0.92, 0.89, 0.86]) for (const fy of [0.97, 0.93, 0.89, 0.85, 0.81, 0.77]) {
        let st = []; try { st = document.elementsFromPoint(W * fx, H * fy); } catch { }
        for (const el of st.slice(0, 6)) {
          if (seen.has(el) || el === document.documentElement || el === document.body || isOurs(el)) continue;
          seen.add(el); out.push(nodeInfo(el));
          if (out.length >= 40) return out;
        }
      }
      return out;
    }
    function petCandidates() {
      const out = [];
      const re = /pet|mascot|companion|sprite|live2d|spine|catgirl|neko|宠|看板/i;
      for (const el of document.querySelectorAll("img, canvas, video, iframe, [class], [id]")) {
        if (out.length >= 20) break;
        if (isOurs(el)) continue;
        let cls = el.className; if (cls && typeof cls === "object") cls = cls.baseVal;
        const s = (el.id || "") + " " + String(cls || "") + " " + (el.getAttribute("src") || "") + " " + (el.getAttribute("alt") || "");
        if (re.test(s)) out.push(nodeInfo(el));
      }
      return out;
    }
    function glassReport() {
      const W = innerWidth, H = innerHeight, VA = W * H || 1;
      const items = [], seen = new Set();
      for (let i = 0; i < 8 && items.length < 60; i++) for (let j = 0; j < 6 && items.length < 60; j++) {
        let stack = [];
        try { stack = document.elementsFromPoint((i + 0.5) * W / 8, (j + 0.5) * H / 6); } catch { }
        for (const el of stack) {
          if (el === document.documentElement || el === document.body) break;
          if (seen.has(el) || isOurs(el)) continue;
          seen.add(el);
          const r = el.getBoundingClientRect();
          const area = (r.width * r.height) / VA;
          if (area < 0.01) continue;
          const cs = getComputedStyle(el);
          const b = bgOf(cs);
          items.push({ ...describe(el), bgImg: String(cs.backgroundImage || "").slice(0, 80), parsed: b && b.c, glass: el.getAttribute("data-agywe-glass") || "", orig: orig.get(el) || "", hole: !!(el.querySelector && el.querySelector(HOLE_SEL)), area: +area.toFixed(3) });
          if (items.length >= 60) break;
        }
      }
      const fields = [];
      for (const f of [...document.querySelectorAll(FIELD_SEL)].slice(0, 4)) {
        const chain = [];
        let el = f;
        for (let k = 0; el && el !== document.body && k < 9; k++, el = el.parentElement) {
          const cs = getComputedStyle(el);
          chain.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 90), bg: cs.backgroundColor, bgImg: String(cs.backgroundImage || "").slice(0, 60), glass: el.getAttribute("data-agywe-glass") || "" });
        }
        fields.push(chain);
      }
      const why = [];
      for (const sel of [".bg-sidebar", ".surface-composer", ".surface-composer-card"]) {
        let el = null; try { el = document.querySelector(sel); } catch { }
        if (el) why.push({ sel, glass: el.getAttribute("data-agywe-glass") || "", ...bgRules(el) });
      }
      for (const el of [...marked].filter((e) => baseKind.get(e) !== "clear").slice(0, 6)) {
        if (why.length >= 9) break;
        why.push({ sel: "marked:" + el.tagName + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 60), glass: el.getAttribute("data-agywe-glass") || "", ...bgRules(el) });
      }
      const chips = [...marked].filter((e) => baseKind.get(e) === "chip");
      for (const el of chips.slice(0, 2)) why.push({ sel: "chip:" + el.tagName + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 60), glass: "chip", ...bgRules(el) });
      // 输入框上方那一条（淡出遮罩 / 滚动按钮区）是什么
      const band = [];
      try {
        const comp = document.querySelector(".surface-composer");
        if (comp) {
          const cr = comp.getBoundingClientRect();
          for (const dy of [12, 30, 50]) for (const el of document.elementsFromPoint(cr.left + cr.width / 2, cr.top - dy).slice(0, 6)) {
            if (isOurs(el) || el === document.body || el === document.documentElement) continue;
            const cs = getComputedStyle(el);
            band.push({ dy, ...nodeInfo(el), bg: cs.backgroundColor, bgImg: String(cs.backgroundImage).slice(0, 160), bf: cs.backdropFilter, mask: String(cs.maskImage || cs.webkitMaskImage || "").slice(0, 100), glass: el.getAttribute("data-agywe-glass") || "" });
          }
        }
      } catch { }
      // v0.10.2：「切换侧边栏」按钮往上几层都是什么颜色、有没有被处理；再看看左上角那一条
      const toggles = [];
      try {
        for (const b of toggleEls().slice(0, 3)) {
          const chain = [];
          let el = b;
          for (let k = 0; el && el !== document.body && k < 7; k++, el = el.parentElement) {
            const cs = getComputedStyle(el);
            chain.push({ ...nodeInfo(el), label: (el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 30), bg: cs.backgroundColor, bgImg: String(cs.backgroundImage || "").slice(0, 100), glass: el.getAttribute("data-agywe-glass") || "", hot: isHot(el) });
          }
          toggles.push(chain);
        }
      } catch { }
      const topLeft = [];
      try {
        const seenTL = new Set();
        for (const [x, y] of [[12, 12], [40, 18], [120, 18], [200, 18], [40, 30]]) for (const el of document.elementsFromPoint(x, y).slice(0, 8)) {
          if (seenTL.has(el) || isOurs(el) || el === document.body || el === document.documentElement) continue;
          seenTL.add(el);
          const cs = getComputedStyle(el);
          topLeft.push({ at: [x, y], ...nodeInfo(el), bg: cs.backgroundColor, bgImg: String(cs.backgroundImage || "").slice(0, 100), glass: el.getAttribute("data-agywe-glass") || "" });
          if (topLeft.length >= 24) break;
        }
      } catch { }
      const topRight = [];
      try {
        const seenTR = new Set();
        for (const [x, y] of [[W - 30, 12], [W - 160, 12], [W - 20, 95], [W - 45, 95], [W - 80, 95]]) for (const el of document.elementsFromPoint(x, y).slice(0, 8)) {
          if (seenTR.has(el) || isOurs(el) || el === document.body || el === document.documentElement) continue;
          seenTR.add(el);
          const cs = getComputedStyle(el);
          topRight.push({ at: [Math.round(x), y], ...nodeInfo(el), label: (el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 30), pressed: el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("data-state") || "", bg: cs.backgroundColor, glass: el.getAttribute("data-agywe-glass") || "", hot: isHot(el) });
          if (topRight.length >= 30) break;
        }
      } catch { }
      return { overlays: overlayReport(), icons: iconReport(), composer: composerReport(), zh: zhReport(), toggles, topLeft, topRight, titleBar: tbLast, chat: av.stats, band, kinds: [...marked].reduce((o, e) => { const k = baseKind.get(e) + ">" + (e.getAttribute("data-agywe-glass") || ""); o[k] = (o[k] || 0) + 1; return o; }, {}), chips: chips.length, chipList: chips.slice(0, 12).map(nodeInfo), darkText, items, fields, why, corner: cornerReport(), petLike: petCandidates(), holes: document.querySelectorAll(HOLE_SEL).length, force: (cfg && cfg.glassForce) || [], exclude: (cfg && cfg.glassExclude) || [] };
    }
    function diag(reason, extra) {
      try {
        const out = { reason, url: location.href, size: [innerWidth, innerHeight], dpr: devicePixelRatio, ready, cfg: cfg && { enabled: cfg.enabled, current: cfg.current, glass: cfg.glass, panelOpacity: cfg.panelOpacity, contentOpacity: cfg.contentOpacity, bubbleOpacity: cfg.bubbleOpacity, blur: cfg.blur, pet: cfg.pet && { size: cfg.pet.size, cord: cfg.pet.cord, image: cfg.pet.image ? String(cfg.pet.image).slice(0, 40) : null } }, marked: marked.size, frame: !!(frame && frame.isConnected), settings: !!(settingsFrame && settingsFrame.isConnected), lastErr, ...(extra || {}) };
        if (pet && pet.doll.isConnected) {
          const r = pet.doll.getBoundingClientRect();
          let top = null; try { top = pet.root.matches(":popover-open"); } catch { }
          out.pet = { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], topLayer: top };
          try { out.atPet = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).slice(0, 6).map(describe); } catch { }
        }
        if (reason !== "pet-pointerdown") {
          const drags = [];
          for (const el of document.querySelectorAll("*")) {
            const v = getComputedStyle(el).getPropertyValue("-webkit-app-region");
            if (v && v !== "none" && v !== "no-drag") { drags.push(describe(el)); if (drags.length >= 12) break; }
          }
          out.dragRegions = drags;
        }
        ipcRenderer.send("agywe:diag", out);
      } catch (e) { try { ipcRenderer.send("agywe:diag", { reason, diagError: String(e) }); } catch { } }
    }

    function toggleSettings(force) {
      const open = force !== undefined ? force : !(settingsFrame && settingsFrame.isConnected);
      if (!open) { if (settingsFrame) settingsFrame.remove(); settingsFrame = null; return; }
      if (settingsFrame && settingsFrame.isConnected) return;
      ensureStyle();
      settingsFrame = document.createElement("iframe");
      settingsFrame.id = "agywe-settings";
      settingsFrame.src = ORIGIN + "/settings.html";
      settingsFrame.addEventListener("load", () => sendContext(true), { once: true });
      document.documentElement.appendChild(settingsFrame);
      toTopLayer(settingsFrame);
      diag("settings-open");
      setTimeout(() => { try { settingsFrame && settingsFrame.focus(); } catch { } }, 50);
    }

    // =====================================================================
    // 毛玻璃：自动识别不透明的大块面板 + 输入框外壳 + 手动点选
    // =====================================================================
    const orig = new WeakMap();      // el -> "r,g,b"（原始背景色）
    const baseKind = new Map();      // el -> panel | field | clear
    const marked = new Set();
    const holeHosts = new Set();     // 含内置浏览器"洞"的已处理元素（需要挖洞）
    function parseRgb(s) {
      const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(String(s || "").trim());
      if (!m) return null;
      const a = m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
    }
    // oklch / lab / color-mix / color() 等写法：交给 canvas 换算成 rgb
    const colorCache = new Map();
    let cctx = null;
    function toRgba(s) {
      s = String(s || "").trim();
      if (!s || s === "transparent" || s === "none") return null;
      const quick = parseRgb(s);
      if (quick) return quick;
      if (colorCache.has(s)) return colorCache.get(s);
      let out = null;
      try {
        if (!cctx) { const cv = document.createElement("canvas"); cv.width = cv.height = 1; cctx = cv.getContext("2d", { willReadFrequently: true }); }
        cctx.clearRect(0, 0, 1, 1);
        cctx.fillStyle = "rgba(0,0,0,0)";
        cctx.fillStyle = s;
        cctx.fillRect(0, 0, 1, 1);
        const d = cctx.getImageData(0, 0, 1, 1).data;
        out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      } catch { out = null; }
      if (colorCache.size > 400) colorCache.clear();
      colorCache.set(s, out);
      return out;
    }
    const COLOR_TOKEN = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/i;
    function bgOf(cs) {
      const c = toRgba(cs.backgroundColor);
      if (c && c.a >= 0.35) return { c, grad: false };
      const bi = String(cs.backgroundImage || "");
      if (bi.includes("gradient")) {
        const m = COLOR_TOKEN.exec(bi);
        const g = m ? toRgba(m[1]) : null;
        // 渐变到透明的是"淡出遮罩"（比如输入框上方那条），不能当成面板去模糊
        const fade = /transparent/.test(bi) || /rgba\([^)]*,\s*0\)|\/\s*0\)/.test(bi);
        if (g && g.a >= 0.35) return { c: g, grad: true, fade };
      }
      return c ? { c, grad: false } : null;
    }
    const opaqueBg = (cs, min) => { const b = bgOf(cs); return b && b.c.a >= (min || 0.35) ? b.c : null; };
    function safeMatches(el, sel) { try { return el.matches(sel); } catch { return false; } }
    function isExcluded(el) { const ex = (cfg && cfg.glassExclude) || []; return ex.length > 0 && ex.some((s) => safeMatches(el, s)); }
    function isOurs(el) {
      return el === frame || el === settingsFrame || el.id === "agywe-wall" || el.id === "agywe-settings" || el.id === "agywe-fx" || el.id === "agywe-avatars" || el.id === "agywe-splash" || (typeof el.id === "string" && el.id.startsWith("agywe-")) || (dock.root && dock.root.contains(el)) || (buddy.root && buddy.root.contains(el)) || (menuEl && menuEl.contains(el)) || (pomo.overlay && pomo.overlay.el.contains(el)) ||
        (sp.el && sp.el.contains(el)) ||
        (av.root && av.root.contains(el)) ||
        (pet && pet.root.contains(el)) || (pick && pick.ov.contains(el));
    }
    function mark(el, kind, c) {
      if (!orig.has(el)) orig.set(el, `${c.r},${c.g},${c.b}`);
      el.style.setProperty("--agywe-c", orig.get(el));
      baseKind.set(el, kind);
      if (el.getAttribute("data-agywe-glass") !== kind) el.setAttribute("data-agywe-glass", kind);
      paint(el, kind);
      marked.add(el);
      if (kind !== "clear" && el.querySelector && el.querySelector(HOLE_SEL)) holeHosts.add(el);
    }
    function unmark(el) {
      try { el.removeAttribute("data-agywe-glass"); el.style.removeProperty("--agywe-c"); restoreInline(el); } catch { }
      if (holeHosts.has(el)) { try { el.style.removeProperty("clip-path"); } catch { } holeHosts.delete(el); }
      marked.delete(el); baseKind.delete(el);
    }
    // 直接写到元素的内联样式（带 !important）：页面自己的 !important / 层叠层规则都压不过它
    const GLASS_PROPS = ["background-color", "background-image", "-webkit-backdrop-filter", "backdrop-filter", "border-color"];
    const origBorder = new WeakMap();   // el -> 原始边框颜色（第一次处理前读）
    const savedInline = new WeakMap();
    function saveInline(el) {
      if (savedInline.has(el)) return;
      const s = el.style, o = {};
      for (const p of GLASS_PROPS) { const v = s.getPropertyValue(p); if (v) o[p] = [v, s.getPropertyPriority(p)]; }
      savedInline.set(el, o);
    }
    function restoreInline(el) {
      const o = savedInline.get(el) || {};
      for (const p of GLASS_PROPS) {
        if (o[p]) el.style.setProperty(p, o[p][0], o[p][1]); else el.style.removeProperty(p);
      }
      savedInline.delete(el);
    }
    const BLUR_VAL = "var(--agywe-bf, blur(var(--agywe-blur, 18px)) saturate(1.25))";
    // 弹窗 / 浮层至少模糊 16px：就算界面模糊调成 0，后面的字也不会和浮层里的字叠在一起
    const DIALOG_BLUR = "var(--agywe-bf, blur(var(--agywe-dblur, 16px)) saturate(1.2))";
    const FLOAT_BLUR = "var(--agywe-bf, blur(var(--agywe-fblur, 16px)) saturate(1.2))";   // 低配模式把 --agywe-bf 设成 none
    function paint(el, kind) {
      if (!origBorder.has(el)) {
        try { const cs = getComputedStyle(el); origBorder.set(el, parseFloat(cs.borderTopWidth) > 0 ? toRgba(cs.borderTopColor) : null); } catch { origBorder.set(el, null); }
      }
      saveInline(el);
      const s = el.style;
      const set = (p, v) => { if (s.getPropertyValue(p) !== v || s.getPropertyPriority(p) !== "important") s.setProperty(p, v, "important"); };
      const unset = (p) => { const o = (savedInline.get(el) || {})[p]; if (o) s.setProperty(p, o[0], o[1]); else s.removeProperty(p); };
      // v0.10.4：.surface-composer 是一圈 1px 内边距的外框，它的底色就是那一圈边；交给上面的细线，自己透明
      if (kind !== "clear" && el.classList && el.classList.contains("surface-composer")) kind = "clear";
      if (kind === "clear") {
        set("background-color", "transparent");
        set("background-image", "none");
        unset("-webkit-backdrop-filter"); unset("backdrop-filter");
        return;
      }
      const a = kind === "inner" ? "calc(var(--agywe-alpha, .55) * .6)"
        : kind === "field" ? "min(1, calc(var(--agywe-alpha, .55) * 1.2))"
        : kind === "chip" ? "max(var(--agywe-alpha, .55), var(--agywe-chip, .45))"
        : kind === "icon" ? "calc(var(--agywe-chip, .45) * .45)"
        : kind === "content" ? "var(--agywe-content, .3)"
        : kind === "dialog" ? "var(--agywe-dialog, .55)"
        : kind === "float" ? "var(--agywe-float, .55)"
        : "var(--agywe-alpha, .55)";
      // 气泡 / 卡片原本的实色描边在透明之后会很扎眼，改成同色半透明
      const ob = origBorder.get(el);
      if (kind === "chip" && ob && ob.a > 0.3) set("border-color", `rgba(${ob.r},${ob.g},${ob.b},.28)`);
      else unset("border-color");
      set("background-color", `rgba(var(--agywe-c, 20,20,20), ${a})`);
      set("background-image", "none");
      if (kind === "inner" || kind === "icon") { unset("-webkit-backdrop-filter"); unset("backdrop-filter"); }
      else if (kind === "dialog") { set("-webkit-backdrop-filter", DIALOG_BLUR); set("backdrop-filter", DIALOG_BLUR); }
      else if (kind === "float") { set("-webkit-backdrop-filter", FLOAT_BLUR); set("backdrop-filter", FLOAT_BLUR); }
      else { set("-webkit-backdrop-filter", BLUR_VAL); set("backdrop-filter", BLUR_VAL); }
    }
    function clearGlass() { for (const el of [...marked]) unmark(el); try { for (const el of document.querySelectorAll("[data-agywe-pse]")) el.removeAttribute("data-agywe-pse"); } catch { } pseSig = new WeakMap(); }

    // v0.10.1：记一下每次毛玻璃扫描花了多久（自检页和诊断报告里看）；超过 50 ms 的写进日志，一分钟最多一条
    const glassPerf = { n: 0, total: 0, max: 0, last: 0, slow: 0, slowAt: 0, since: Date.now(), fn: 0, ftotal: 0, fmax: 0, delayN: 0, delayTotal: 0, delayMax: 0 };
    function perfSummary() {
      const r1 = (v) => +v.toFixed(1);
      return {
        scans: glassPerf.n, avgMs: glassPerf.n ? +(glassPerf.total / glassPerf.n).toFixed(2) : 0, maxMs: r1(glassPerf.max), lastMs: +glassPerf.last.toFixed(2), slow: glassPerf.slow,
        // v0.10.2：新出现的内容走"快速通道"，下一帧之前就处理掉；delay 是从内容出现到套上毛玻璃隔了多久
        fast: glassPerf.fn, fastAvgMs: glassPerf.fn ? +(glassPerf.ftotal / glassPerf.fn).toFixed(2) : 0, fastMaxMs: r1(glassPerf.fmax),
        delayMs: glassPerf.delayN ? r1(glassPerf.delayTotal / glassPerf.delayN) : 0, delayMaxMs: r1(glassPerf.delayMax),
        nodes: document.getElementsByTagName("*").length, marked: marked.size, minutes: Math.round((Date.now() - glassPerf.since) / 60000)
      };
    }
    function scanGlass() {
      if (!ready || !cfg || !cfg.enabled || !cfg.glass || hideAll) return;
      if (document.hidden) return;   // 窗口最小化 / 被完全挡住时不扫，回来时 visibilitychange 会补一次
      const t0 = performance.now();
      try { return scanGlassInner(); }
      finally {
        const dt = performance.now() - t0;
        // 启动后头 15 秒页面还在一批批加载，第一遍要把所有元素都看一次，不算进最长 / 慢的次数
        const warm = Date.now() - glassPerf.since < 15000;
        glassPerf.n++; glassPerf.total += dt; glassPerf.last = dt; if (!warm && dt > glassPerf.max) glassPerf.max = dt;
        if (dt > 50 && !warm) {
          glassPerf.slow++;
          if (Date.now() - glassPerf.slowAt > 60000) { glassPerf.slowAt = Date.now(); try { diagLite("glass-slow", { ms: Math.round(dt), perf: perfSummary() }); } catch { } }
        }
      }
    }
    function scanGlassInner() {
      const W = innerWidth, H = innerHeight, VA = W * H;
      if (!VA) return;
      // 1) 网格取样：大块不透明背景
      const cols = 10, rows = 8;
      const pts = [];
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * W / cols;
        for (let j = 0; j < rows; j++) pts.push([x, (j + 0.5) * H / rows]);
        // 顶部标题栏 / 底部状态栏这种细长条，网格中心点扫不到
        pts.push([x, 10], [x, 26], [x, H - 10]);
      }
      // 左上角（侧栏开关那一条）和左下角：细长条，网格点容易漏
      pts.push([12, 12], [40, 18], [80, 18], [140, 18], [200, 18], [12, H - 14], [60, H - 14]);
      {
        // v0.10.2：同一个元素会出现在几十个取样点的命中栈里（外层容器尤其如此），一次扫描里只看一遍
        const seenPt = new Set();
        for (const [x, y] of pts) {
          let stack;
          try { stack = document.elementsFromPoint(x, y); } catch { continue; }
          for (const el of stack) {
            if (el === document.documentElement || el === document.body) break;
            if (seenPt.has(el)) continue;
            seenPt.add(el);
            if (isOurs(el) || marked.has(el)) continue;
            const cs = getComputedStyle(el);
            const bg0 = bgOf(cs);
            if (bg0 && bg0.fade && !isForced(el)) { mark(el, "clear", bg0.c); continue; }
            const c0 = opaqueBg(cs, 0.35);
            const weak = !c0 && bg0 && bg0.c && bg0.c.a >= 0.05 ? bg0.c : null;
            if (!c0 && !weak) continue;
            const r = el.getBoundingClientRect();
            const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
            // v0.10.6：弹窗 / 浮层先认出来：不管面积、悬停、自带底色淡不淡都处理
            const ok = area >= VA * 0.006 && r.width >= 100 && r.height >= 48 ? overlayKind(el) : "";
            if (ok) {
              if ((el.matches && el.matches(HOLE_SEL)) || isExcluded(el)) continue;
              mark(el, ok, c0 || weak); continue;
            }
            const c = c0;
            if (!c) continue;
            const bar = (r.width >= W * 0.5 && r.height >= 18 && (r.top <= 2 || r.bottom >= H - 2)) || edgeStrip(r, W, H);
            if (area < VA * 0.04 && !bar) continue;
            const dlg = false;
            if (cs.position === "fixed" && area < VA * 0.5 && el.getAttribute("role") === "dialog") continue;
            if (el.matches && el.matches(HOLE_SEL)) continue;
            if (isExcluded(el)) continue;
            // 含内置浏览器的容器：自己有 clip-path 的不碰，否则照常处理并在 updateHoles 里挖洞
            if (el.querySelector && el.querySelector(HOLE_SEL) && cs.clipPath && cs.clipPath !== "none" && !holeHosts.has(el)) continue;
            if (isHot(el)) continue;
            mark(el, bigKind(area, VA), c);
          }
        }
      }
      // 2) 输入框：往上找有背景色的外壳（输入栏面积小，网格扫不到）
      for (const f of document.querySelectorAll(FIELD_SEL)) {
        if (isOurs(f)) continue;
        const fr = f.getBoundingClientRect();
        if (fr.width < 100 || fr.height < 12) continue;
        let el = f, shell = false;
        for (let depth = 0; el && el !== document.body && depth < 10; depth++, el = el.parentElement) {
          if (marked.has(el)) { if (baseKind.get(el) !== "clear") break; continue; }
          if (isExcluded(el)) continue;
          const cs = getComputedStyle(el);
          const c = opaqueBg(cs, 0.25);
          if (!c) continue;
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > VA * 0.45) break;
          if (el === f) { mark(el, "clear", c); continue; }   // 输入框本身透明，外壳负责毛玻璃
          if (!shell) { mark(el, "field", c); shell = true; }
          else mark(el, "inner", c);
        }
      }
      // 3) 手动点选的区域
      for (const sel of (cfg.glassForce || [])) {
        let list = [];
        try { list = [...document.querySelectorAll(sel)].slice(0, 20); } catch { continue; }
        for (const el of list) {
          if (isOurs(el)) continue;
          const c = orig.has(el) ? null : (opaqueBg(getComputedStyle(el), 0.05) || { r: 20, g: 20, b: 20, a: 1 });
          if (!marked.has(el) || baseKind.get(el) === "clear" || baseKind.get(el) === "inner") mark(el, "panel", c || { r: 20, g: 20, b: 20 });
        }
      }
      // 3b) v0.10.2：「切换侧边栏」按钮所在的那一条。它往往只有按钮宽、没有文字，前面几步都会漏掉
      try { scanToggles(W, H, VA); } catch { }
      // 4) 气泡 / 卡片 / 小按钮：网格点和输入框都碰不到的中小块。只看新出现的 / class 变过的，20 秒轮一遍全量
      try { scanChips(W, H, VA); } catch { }
      try { sweepIcons(); } catch { }
      if (Date.now() - lastFull > 5000) { lastFull = Date.now(); pseSig = new WeakMap(); try { revalidate(); } catch { } }
      normalizeGlass();
      for (const el of marked) if (!el.isConnected) { marked.delete(el); baseKind.delete(el); holeHosts.delete(el); }
    }
    let lastFull = 0;
    // 整个窗口那么大的是底板（全透明）；占大半个窗口的是对话 / 工作区（给一层阅读背板）；其余是面板
    function bigKind(area, VA) { return area > VA * 0.92 ? "clear" : area > VA * 0.55 ? "content" : "panel"; }
    // 贴着窗口边的细长条（标题栏左半截、侧栏开关那一条、底部状态栏的一段）：面积小，但不处理就是一条实色带
    function edgeStrip(r, W, H) {
      const t = Math.min(r.width, r.height), len = Math.max(r.width, r.height);
      if (t < 18 || t > 90 || len < 120) return false;
      return r.width >= r.height ? (r.top <= 2 || r.bottom >= H - 2) : (r.left <= 2 || r.right >= W - 2);
    }
    const TOGGLE_SEL = '[aria-label*="侧边栏"], [aria-label*="边栏"], [aria-label*="sidebar" i], [title*="侧边栏"], [title*="sidebar" i], [data-tooltip*="侧边栏"], [data-tooltip*="sidebar" i]';
    function toggleEls() { try { return [...document.querySelectorAll(TOGGLE_SEL)].filter((el) => !isOurs(el)).slice(0, 6); } catch { return []; } }
    function scanToggles(W, H, VA) {
      for (const b of toggleEls()) {
        let el = b;
        for (let depth = 0; el && el !== document.body && el !== document.documentElement && depth < 7; depth++, el = el.parentElement) {
          if (marked.has(el)) { if (baseKind.get(el) !== "clear") break; continue; }
          if (isExcluded(el) || isHot(el)) continue;
          const cs = getComputedStyle(el);
          const c = opaqueBg(cs, 0.35);
          if (!c) continue;
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > VA * 0.45) break;
          if (el.querySelector && el.querySelector(HOLE_SEL)) break;
          mark(el, area >= VA * 0.04 || edgeStrip(r, W, H) || el !== b ? "panel" : "chip", c);
          break;
        }
      }
    }
    // 鼠标正停在上面 / 正被按住的元素：背景色可能只是悬停效果，不能当成它本来的颜色锁住
    function isHot(el) {
      try {
        if (el.matches(":active")) return true;
        if (!el.matches(":hover")) return false;
        const r = el.getBoundingClientRect();
        return r.width * r.height < innerWidth * innerHeight * 0.03;   // 悬停变色的一般是列表项、按钮这种小块
      } catch { return false; }
    }
    const rgbOf = (s) => { const n = String(s || "").split(",").map(Number); return n.length === 3 && n.every(isFinite) ? n : null; };
    function sameColor(a, b) { const x = rgbOf(a), y = rgbOf(b); return !!(x && y) && Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 12; }
    function isForced(el) { const f = (cfg && cfg.glassForce) || []; return f.length > 0 && f.some((s) => safeMatches(el, s)); }
    // 小块的底色可能是悬停 / 选中状态造成的：先撤掉我们的样式看一眼它现在本来的颜色，已经没底色的就放开
    function revalidate() {
      const list = [...marked].filter((el) => el.isConnected && baseKind.get(el) !== "content" && !isForced(el) && !isHot(el));
      if (!list.length) return;
      const VA = innerWidth * innerHeight;
      const small = list.filter((el) => { const r = el.getBoundingClientRect(); return r.width * r.height < VA * 0.2; }).slice(0, 300);
      const saved = small.map((el) => [el, el.style.getPropertyValue("background-color"), el.style.getPropertyPriority("background-color"), el.style.getPropertyValue("background-image"), el.style.getPropertyPriority("background-image"), el.getAttribute("data-agywe-glass")]);
      for (const [el] of saved) { el.style.removeProperty("background-color"); el.style.removeProperty("background-image"); el.removeAttribute("data-agywe-glass"); }
      const now = small.map((el) => bgOf(getComputedStyle(el)));
      saved.forEach(([el, bc, bcp, bi, bip, ga], i) => {
        if (bc) el.style.setProperty("background-color", bc, bcp); if (bi) el.style.setProperty("background-image", bi, bip);
        if (ga) el.setAttribute("data-agywe-glass", ga);
        const b = now[i];
        const ov = baseKind.get(el) === "float" || baseKind.get(el) === "dialog";
        if (!b || b.c.a < (ov ? 0.05 : 0.3)) { unmark(el); orig.delete(el); origBorder.delete(el); }
        else if (!b.fade) { const v = `${b.c.r},${b.c.g},${b.c.b}`; if (v !== orig.get(el)) { orig.set(el, v); el.style.setProperty("--agywe-c", v); } }
      });
    }
    const SKIP_TAGS = new Set(["svg", "path", "g", "use", "IMG", "CANVAS", "VIDEO", "IFRAME", "INPUT", "SELECT", "OPTION", "SCRIPT", "STYLE", "LINK", "META", "BR", "WBR", "SOURCE", "TEMPLATE"]);
    // 一个元素要不要套毛玻璃：返回 [el, kind, 颜色]；null = 不用；undefined = 现在判断不了（在屏幕外 / 鼠标正停在上面），过会儿再看
    // v0.10.5：弹窗 + 浮层（模型选择、下拉菜单、右键菜单、提示气泡、悬浮卡片）。这些叠在对话上面，太透明会和后面的字混在一起
    const DIALOG_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog, [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-dropdown-menu-content], [data-radix-select-content], [data-radix-popover-content], [data-radix-hover-card-content], [data-popper-placement], [data-side][data-state], [cmdk-root], .agy-overlay, .agy-fastpick';
    const MODAL_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog';
    const floatCache = new WeakMap();
    // v0.10.6：叠在对话上面的东西分两种：
    //   "dialog" = 设置页这类占了大半个窗口的弹窗；"float" = 下拉菜单、模型选择（含子菜单）、右键菜单、提示气泡、悬浮卡片
    // 两种各有一个不透明度 / 模糊设置
    function overlayKind(el) {
      try {
        const host = el.closest && el.closest(DIALOG_SEL);
        if (!host && !inDialog(el)) return "";
        const m = el.closest && el.closest(MODAL_SEL);
        if (m) { const r = m.getBoundingClientRect(); if (r.width * r.height >= innerWidth * innerHeight * 0.2) return "dialog"; }
        return "float";
      } catch { return ""; }
    }
    function inDialog(el) {
      try {
        if (el.closest && el.closest(DIALOG_SEL)) return true;
        // 没有标记的浮层：往上几层里有固定定位、又不是整个窗口那么大的
        const now = Date.now(), c = floatCache.get(el);
        if (c && now - c[1] < 3000) return c[0];
        let hit = false;
        const VA = innerWidth * innerHeight;
        for (let p = el, n = 0; p && p !== document.body && n < 6; p = p.parentElement, n++) {
          if (isOurs(p)) break;
          const cs = getComputedStyle(p);
          if (cs.position === "fixed" || (cs.position === "absolute" && (parseInt(cs.zIndex, 10) || 0) >= 40)) {
            const r = p.getBoundingClientRect();
            if (r.width * r.height < VA * 0.6 && r.width > 120 && r.height > 60) hit = true;
            break;
          }
        }
        floatCache.set(el, [hit, now]);
        return hit;
      } catch { return false; }
    }
    // v0.10.3：像按钮的元素（按钮 / role=button / agy-button）
    function btnLike(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName === "BUTTON") return true;
      const ro = el.getAttribute("role");
      if (ro === "button" || ro === "tab" || ro === "switch") return true;
      return (el.getAttribute("class") || "").indexOf("agy-button") >= 0;
    }
    function nearBtn(el, r) {
      for (let p = el.parentElement, n = 0; p && n < 3; p = p.parentElement, n++) if (btnLike(p)) return true;
      try { if (el.querySelector && el.querySelector('button, [role="button"], .agy-button, svg')) return true; } catch { }
      const par = el.parentElement;
      if (par && par.children.length <= 12) for (const s of par.children) {
        if (s === el || !btnLike(s)) continue;
        const q = s.getBoundingClientRect();
        if (Math.abs(q.left - r.left) < 8 && Math.abs(q.top - r.top) < 8) return true;
      }
      return false;
    }
    // 伪元素（::before / ::after）上的实色底：记在 data-agywe-pse 上，由 CSS 换成半透明
    const PSE_STATE = ["aria-pressed", "aria-expanded", "aria-selected", "aria-checked", "data-state", "data-active", "data-selected"];
    let pseSig = new WeakMap();
    function pseudoFix(el) {
      if (!btnLike(el) || isOurs(el)) return;
      const sig = (el.getAttribute("class") || "") + "|" + PSE_STATE.map((a) => el.getAttribute(a) || "").join(",");
      if (pseSig.get(el) === sig) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.width > 64 || r.height < 8 || r.height > 64) { pseSig.set(el, sig); return; }
      if (el.matches(":hover") || el.matches(":active")) return;   // 悬停时的颜色不算，鼠标移开后再看
      const had = el.getAttribute("data-agywe-pse");
      if (had) el.removeAttribute("data-agywe-pse");
      let v = "";
      for (const [pe, k] of [["::before", "b"], ["::after", "a"]]) {
        const ps = getComputedStyle(el, pe);
        if (!ps.content || ps.content === "none" || ps.content === "normal") continue;
        const c = toRgba(ps.backgroundColor);
        if (c && c.a >= 0.35) v += (v ? " " : "") + k;
      }
      pseSig.set(el, sig);
      if (v) el.setAttribute("data-agywe-pse", v);
    }
    function sweepIcons() {
      let n = 0;
      for (const el of document.querySelectorAll('button, [role="button"], .agy-button')) {
        if (++n > 500) break;
        try { pseudoFix(el); } catch { }
      }
    }
    function decideEl(el, W, H, VA) {
      if (SKIP_TAGS.has(el.tagName)) return null;
      if (btnLike(el)) { try { pseudoFix(el); } catch { } }
      const cs = getComputedStyle(el);
      const bgc = cs.backgroundColor;
      if ((!bgc || bgc === "rgba(0, 0, 0, 0)" || bgc === "transparent") && (!cs.backgroundImage || cs.backgroundImage === "none")) return null;
      const bg0 = bgOf(cs);
      if (bg0 && bg0.fade) return isForced(el) ? null : [el, "clear", bg0.c];
      let c = opaqueBg(cs, 0.35);
      // v0.10.6：浮层（子菜单这类）自带的底色常常本来就很淡（半透明 + 模糊），以前达不到 35% 就被跳过，现在 5% 以上就接手
      const weak = !c && bg0 && bg0.c && bg0.c.a >= 0.05 ? bg0.c : null;
      if (!c && !weak) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return undefined;   // 还没显示出来（折叠 / display 切换中）
      if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) return undefined;
      if (el.matches && el.matches(HOLE_SEL)) return null;
      if (el.querySelector && el.querySelector(HOLE_SEL)) return null;   // 含内置浏览器的容器交给全量扫描（要挖洞）
      if (isExcluded(el)) return null;
      const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
      // 弹窗 / 浮层：鼠标停在上面也照样处理（子菜单都是鼠标移过去才弹出来的，以前会被当成「悬停的小块」一直跳过）
      if (area >= VA * 0.006 && r.width >= 100 && r.height >= 48) {
        const ok = overlayKind(el);
        if (ok) return [el, ok, c || weak];
      }
      if (!c) return null;
      if (isHot(el)) return undefined;
      if (area >= VA * 0.04) return [el, bigKind(area, VA), c];
      if (edgeStrip(r, W, H)) return [el, "panel", c];
      // v0.10.2：小图标按钮（切换侧边栏这类）被选中 / 展开时的实色方块：以前因为太小、没有文字被跳过
      if (r.width >= 16 && r.width <= 56 && r.height >= 16 && r.height <= 56 && btnLike(el)) return [el, "icon", c];
      // v0.10.3：按钮里面 / 叠在按钮底下那块没有字的小方块（选中高亮、展开状态的底色），以前会因为"太小又没字"被跳过
      if (r.width >= 12 && r.width <= 64 && r.height >= 12 && r.height <= 64 && !(el.textContent || "").trim() && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 32 && nearBtn(el, r)) return [el, "icon", c];   // 只管黑 / 灰 / 白这种中性色，彩色徽标不动
      if (c.a < 0.5 || r.width < 40 || r.height < 20 || area < VA * 0.0012) return null;
      // 需要有文字或者是圆角块，避免把分隔线、进度条之类的也处理掉
      const rounded = parseFloat(cs.borderTopLeftRadius) >= 6;
      if (!rounded && !(el.textContent || "").trim()) return null;
      return [el, "chip", c];
    }
    // 先把要用的都读完，再统一写样式：读写穿插会让浏览器每处理一个元素就重算一次样式
    function applyDecisions(list) {
      for (const [el] of list) {
        if (!origBorder.has(el)) { try { const cs = getComputedStyle(el); origBorder.set(el, parseFloat(cs.borderTopWidth) > 0 ? toRgba(cs.borderTopColor) : null); } catch { origBorder.set(el, null); } }
      }
      for (const [el, kind, c] of list) mark(el, kind, c);
    }
    // 全页扫描（v0.10.2 改成增量）：class 没变、20 秒内看过的不再重复算样式
    const chipSeen = new WeakMap();   // el -> [class, 上次看的时间]
    function scanChips(W, H, VA) {
      const all = document.body ? document.body.getElementsByTagName("*") : [];
      const n = Math.min(all.length, 8000), now = Date.now(), todo = [];
      for (let i = 0; i < n; i++) {
        const el = all[i];
        if (marked.has(el)) continue;
        const cn = el.getAttribute("class") || "";
        const seen = chipSeen.get(el);
        if (seen && seen[0] === cn && now - seen[1] < 20000) continue;
        if (isOurs(el)) { chipSeen.set(el, [cn, now + 3600000]); continue; }
        const d = decideEl(el, W, H, VA);
        if (d === undefined) chipSeen.delete(el); else chipSeen.set(el, [cn, now]);
        if (d) todo.push(d);
      }
      applyDecisions(todo);
    }

    // ---- v0.10.2 快速通道：页面新加的元素 / class 变了的元素，在下一帧画出来之前就处理掉 ----
    // 以前要等 0.4~1.2 秒的全量扫描，新出现的面板会先闪一下原来的实色
    const fresh = new Set();
    let freshRaf = 0, freshT0 = 0;
    function queueFresh(n) {
      if (!n || n.nodeType !== 1) return false;
      if (fresh.size > 400) return true;
      fresh.add(n);
      if (!freshRaf) { freshT0 = performance.now(); freshRaf = requestAnimationFrame(flushFresh); }
      return true;
    }
    function flushFresh() {
      freshRaf = 0;
      if (!ready || !cfg || !cfg.enabled || !cfg.glass || hideAll || document.hidden) { fresh.clear(); return; }
      const W = innerWidth, H = innerHeight, VA = W * H;
      if (!VA) { fresh.clear(); return; }
      const t0 = performance.now();
      const list = [], uniq = new Set();
      let overflow = false;
      const push = (el) => { if (!uniq.has(el)) { uniq.add(el); list.push(el); } };
      for (const root of fresh) {
        if (!root.isConnected || isOurs(root)) continue;
        push(root);
        const d = root.getElementsByTagName ? root.getElementsByTagName("*") : [];
        for (let i = 0; i < d.length; i++) { if (list.length >= 600) { overflow = true; break; } push(d[i]); }
        if (overflow) break;
      }
      fresh.clear();
      const todo = [];
      for (const el of list) {
        if (marked.has(el)) continue;
        const d = decideEl(el, W, H, VA);
        if (d) todo.push(d);
        if (d !== undefined) chipSeen.set(el, [el.getAttribute("class") || "", Date.now()]);
      }
      if (todo.length) { applyDecisions(todo); normalizeGlass(); }
      const dt = performance.now() - t0;
      glassPerf.fn++; glassPerf.ftotal += dt; if (dt > glassPerf.fmax) glassPerf.fmax = dt;
      if (todo.length) { const lag = performance.now() - freshT0; glassPerf.delayN++; glassPerf.delayTotal += lag; if (lag > glassPerf.delayMax) glassPerf.delayMax = lag; }
      if (overflow) { scanUrgent = true; scheduleScan(); }
    }
    // 套在别的毛玻璃面板里面的，只留半透明底色（不用重复模糊）
    function normalizeGlass() {
      for (const el of marked) {
        let k = baseKind.get(el);
        if (k !== "clear") {
          // 离它最近的、本来有底色的祖先
          let host = null;
          for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            if (marked.has(p) && orig.has(p)) { host = p; break; }
          }
          const hk = host ? baseKind.get(host) : null;
          // 和底下那层同色：它本来就是"看不见"的（比如侧栏里的分组标题、置顶条），跟着变透明，别单独成块
          if (host && hk !== "clear" && sameColor(orig.get(el), orig.get(host)) && !isForced(el)) k = "clear";
          else if ((k === "panel" || k === "field" || k === "content" || k === "dialog" || k === "float") && host) {
            for (let p = host; p && p !== document.documentElement; p = p.parentElement) {
              const bk = marked.has(p) ? baseKind.get(p) : null;
              if (bk === "panel" || bk === "field" || bk === "content" || bk === "dialog" || bk === "float") { k = k === "content" ? "panel" : "inner"; break; }
            }
          }
        }
        const changed = el.getAttribute("data-agywe-glass") !== k;
        if (changed) el.setAttribute("data-agywe-glass", k);
        if (changed || el.style.getPropertyPriority("background-color") !== "important") paint(el, k);
      }
    }

    // ---- 内置浏览器标签页的"洞"：壁纸和毛玻璃都不能盖住它 ----
    let holeTimer = null;
    function holePath(w, h, ox, oy, holes, within) {
      let d = `M0 0H${w}V${h}H0Z`;
      let n = 0;
      for (const hEl of holes) {
        if (within && !within.contains(hEl)) continue;
        const r = hEl.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const l = r.left - ox, t = r.top - oy, rr = r.right - ox, b = r.bottom - oy;
        d += `M${l} ${t}H${rr}V${b}H${l}Z`;
        n++;
      }
      return n ? d : null;
    }
    function updateHoles() {
      if (!frame) return;
      const holes = document.querySelectorAll(HOLE_SEL);
      const d = holes.length ? holePath(innerWidth, innerHeight, 0, 0, holes, null) : null;
      if (d) frame.style.setProperty("clip-path", `path(evenodd, "${d}")`, "important");
      else frame.style.removeProperty("clip-path");
      for (const el of holeHosts) {
        if (!el.isConnected || !marked.has(el)) { holeHosts.delete(el); continue; }
        const r = el.getBoundingClientRect();
        const p = holes.length ? holePath(r.width, r.height, r.left, r.top, holes, el) : null;
        if (p) el.style.setProperty("clip-path", `path(evenodd, "${p}")`, "important");
        else el.style.removeProperty("clip-path");
      }
    }

    // 界面文字是深色还是浅色：决定文字描边用白色还是黑色、壁纸压暗还是提亮
    let darkText = null;
    let textRgb = null;   // v0.8 正文的实际颜色（自动对比度用）
    function updateTheme(force) {
      let d = null;
      try {
        const probe = document.querySelector(".text-foreground") || document.body;
        const c = toRgba(getComputedStyle(probe).color);
        if (c) { d = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 < 0.5; textRgb = [c.r, c.g, c.b]; }
      } catch { }
      if (d === null) return;
      if (d === darkText && !force) return;
      darkText = d;
      const mode = cfg && cfg.haloColor || "auto";
      const halo = mode === "light" ? "255,255,255" : mode === "dark" ? "0,0,0" : (d ? "255,255,255" : "0,0,0");
      document.documentElement.style.setProperty("--agywe-halo", halo);
      post({ type: "agywe:theme", darkText: d });
      try { applyTheme(); } catch { }
    }

    function hexToRgb(h) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }

    let lastGlassSig = "";
    function applyCfg(next) {
      cfg = next;
      const root = document.documentElement;
      if (!root) return;
      const on = !!(ready && cfg && cfg.enabled && !hideAll);
      root.classList.toggle("agywe-on", on);
      root.classList.toggle("agywe-glasson", on && !!cfg.glass);
      root.classList.toggle("agywe-shadow", on && !!cfg.textShadow);
      root.classList.toggle("agywe-border", on && cfg.glassBorder !== false);
      const tint = cfg && cfg.glassTintOn ? hexToRgb(cfg.glassTint) : null;
      root.classList.toggle("agywe-tint", on && !!tint);
      if (tint) root.style.setProperty("--agywe-tint", tint);
      const font = cfg && typeof cfg.font === "string" ? cfg.font.trim() : "";
      root.classList.toggle("agywe-font", !!font && !hideAll);
      root.classList.toggle("agywe-hideall", hideAll);
      root.classList.toggle("agywe-lowspec", !!(cfg && cfg.lowSpec));
      if (cfg && cfg.lowSpec) root.style.setProperty("--agywe-bf", "none"); else root.style.removeProperty("--agywe-bf");
      if (font) root.style.setProperty("--agywe-font", font); else root.style.removeProperty("--agywe-font");
      root.style.setProperty("--agywe-alpha", String(cfg ? cfg.panelOpacity : .55));
      root.style.setProperty("--agywe-chip", String(cfg && cfg.bubbleOpacity != null ? cfg.bubbleOpacity : .45));
      root.style.setProperty("--agywe-content", String(cfg && cfg.contentOpacity != null ? cfg.contentOpacity : .3));
      root.style.setProperty("--agywe-dialog", String(cfg && cfg.dialogOpacity != null ? cfg.dialogOpacity : .55));
      root.style.setProperty("--agywe-float", String(cfg && cfg.floatOpacity != null ? cfg.floatOpacity : .55));
      root.style.setProperty("--agywe-dblur", (cfg && cfg.dialogBlur != null ? cfg.dialogBlur : 16) + "px");
      root.style.setProperty("--agywe-fblur", (cfg && cfg.floatBlur != null ? cfg.floatBlur : 16) + "px");
      root.style.setProperty("--agywe-ring", String(cfg && cfg.composerRing != null ? cfg.composerRing : .12));
      root.style.setProperty("--agywe-halo-a", String(cfg && cfg.textHalo != null ? cfg.textHalo : .6));
      updateTheme(true);
      applyFxCfg();
      applyAudioCfg();
      try { applyTheme(); applyDock(); applyIdle(); applyBuddy(); } catch (e) { lastErr = String(e && e.message || e); }
      try { noiseApplyCfg(); jumpRefresh(); if (!ccOn()) ccHide(); } catch (e) { lastErr = String(e && e.message || e); }
      scheduleAvatars();
      zhApply();
      root.style.setProperty("--agywe-blur", (cfg ? cfg.blur : 18) + "px");
      const sig = JSON.stringify([cfg && cfg.glassForce, cfg && cfg.glassExclude]);
      if (sig !== lastGlassSig) { lastGlassSig = sig; clearGlass(); }
      if (!on || !cfg.glass) clearGlass(); else scheduleScan();
      ensureFrame();
    }

    let scanQueued = false, scanUrgent = false;
    let lastScan = 0;
    function scheduleScan() {
      if (scanQueued) return;
      scanQueued = true;
      // 新内容已经由快速通道处理了，这里只是补漏（网格取样 / 输入框 / 侧栏开关），不用太急，也别太频繁
      // v0.10.5：页面一变就整页重扫，流式输出时每秒一次、每次 30~90 ms，会卡。新内容快速通道已经处理了，补漏扫描最多 2.5 秒一次
      const wait = Math.max(150, (scanUrgent ? 600 : 2500) - (Date.now() - lastScan));
      scanUrgent = false;
      // 补漏扫描放到浏览器空闲时做（最多再等 500 ms），不跟打字、滚动抢同一帧
      const run = () => { scanQueued = false; lastScan = Date.now(); try { scanGlass(); updateHoles(); } catch { } };
      setTimeout(() => { if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 }); else run(); }, wait);
    }

    // =====================================================================
    // 点选模式：手动指定哪块要毛玻璃 / 不要毛玻璃
    // =====================================================================
    let pick = null;
    function cssEsc(s) { try { return CSS.escape(s); } catch { return String(s).replace(/[^\w-]/g, "\\$&"); } }
    function selectorFor(el) {
      const parts = [];
      let cur = el;
      for (let depth = 0; cur && cur !== document.body && cur !== document.documentElement && depth < 7; depth++, cur = cur.parentElement) {
        let p = cur.tagName.toLowerCase();
        if (cur.id && !/\d{3,}|[:.]/.test(cur.id) && !cur.id.startsWith("agywe")) {
          parts.unshift(p + "#" + cssEsc(cur.id));
        } else {
          const cls = [...cur.classList].filter((c) => !c.startsWith("agywe") && !c.includes(":") && c.length < 48).slice(0, 5);
          if (cls.length) p += cls.map((c) => "." + cssEsc(c)).join("");
          parts.unshift(p);
        }
        const sel = parts.join(" > ");
        try { const n = document.querySelectorAll(sel); if (n.length === 1 && n[0] === el) return sel; } catch { }
      }
      return parts.join(" > ");
    }
    function pickTarget(x, y) {
      if (pick && pick.mode === "pet") return petTarget(x, y);
      const VA = innerWidth * innerHeight;
      let stack = [];
      try { stack = document.elementsFromPoint(x, y); } catch { }
      for (const el of stack) {
        if (el === document.documentElement || el === document.body) break;
        if (isOurs(el)) continue;
        if (marked.has(el) && baseKind.get(el) !== "clear") return el;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < VA * 0.004) continue;
        if (opaqueBg(getComputedStyle(el), 0.2)) return el;
      }
      return null;
    }
    // 桌宠点选：找鼠标下面的图片 / 动画画布 / 视频 / SVG
    function mediaOf(el) {
      if (!el || !el.tagName) return null;
      const t = el.tagName;
      if (t === "IMG" && (el.currentSrc || el.src)) return { el, url: el.currentSrc || el.src };
      if (t === "VIDEO" && (el.currentSrc || el.src)) return { el, url: el.currentSrc || el.src, video: true };
      if (t === "CANVAS") { try { return { el, url: el.toDataURL("image/png"), snapshot: true }; } catch { return null; } }
      if (t.toLowerCase() === "svg") {
        try { return { el, url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(el)) }; } catch { return null; }
      }
      const bi = getComputedStyle(el).backgroundImage;
      const m = /url\(["']?([^"')]+)["']?\)/.exec(bi || "");
      if (m) return { el, url: m[1] };
      return null;
    }
    function petTarget(x, y) {
      let stack = [];
      try { stack = document.elementsFromPoint(x, y); } catch { }
      for (const el of stack.slice(0, 12)) {
        if (el === document.documentElement || el === document.body) break;
        if (isOurs(el)) continue;
        if (mediaOf(el)) return el;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < innerWidth * innerHeight * 0.15) {
          for (const k of el.querySelectorAll("img, canvas, video, svg")) { if (mediaOf(k)) return k; }
        }
      }
      return null;
    }
    function pickState(el) {
      const forced = ((cfg && cfg.glassForce) || []).find((s) => safeMatches(el, s));
      return { forced, on: !!forced || (marked.has(el) && baseKind.get(el) !== "clear") };
    }
    function drawPick() {
      if (!pick) return;
      const t = pick.target;
      if (!t) { pick.box.style.display = "none"; return; }
      const r = t.getBoundingClientRect();
      const st = pick.mode === "pet" ? { on: false } : pickState(t);
      Object.assign(pick.box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      pick.box.classList.toggle("del", st.on);
      if (!pick.toast) pick.tip.textContent = pick.mode === "pet" ? "点击：用这个当挂件的角色　·　右键或 Esc 取消" : (st.on ? "点击：去掉这块的毛玻璃" : "点击：给这块加上毛玻璃") + "　·　右键或 Esc 结束";
    }
    function toastPick(msg) {
      if (!pick) return;
      pick.toast = true; pick.tip.textContent = msg;
      clearTimeout(pick.toastT);
      pick.toastT = setTimeout(() => { if (pick) { pick.toast = false; drawPick(); } }, 1400);
    }
    function togglePicked(el) {
      const force = new Set(cfg.glassForce || []), excl = new Set(cfg.glassExclude || []);
      const st = pickState(el);
      if (st.forced) { force.delete(st.forced); unmark(el); toastPick("已去掉这块的毛玻璃"); }
      else if (st.on) { excl.add(selectorFor(el)); unmark(el); toastPick("已去掉，之后不会再自动处理这块"); }
      else {
        for (const s of [...excl]) if (safeMatches(el, s)) excl.delete(s);
        force.add(selectorFor(el));
        toastPick("已加上毛玻璃");
      }
      cfg = { ...cfg, glassForce: [...force], glassExclude: [...excl] };
      lastGlassSig = JSON.stringify([cfg.glassForce, cfg.glassExclude]);
      post({ type: "agywe:save-glass", glassForce: cfg.glassForce, glassExclude: cfg.glassExclude });
      try { scanGlass(); updateHoles(); } catch { }
      drawPick();
    }
    function endPick() {
      if (!pick) return;
      for (const [t, h] of pick.handlers) window.removeEventListener(t, h, true);
      try { pick.ov.remove(); } catch { }
      pick = null;
      diag("pick-end", { glass: glassReport() });
    }
    // 本地端口每次启动都会变、blob: 链接关掉就失效，所以先读成内嵌数据再保存
    async function toDataUrl(url) {
      if (/^data:/i.test(url)) return url;
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      if (blob.size > 2.2 * 1024 * 1024) throw new Error("too big");
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    }
    async function usePicked(el) {
      const m = mediaOf(el);
      if (!m || !m.url) { toastPick("这里没找到图片，换个位置试试"); return; }
      let url = m.url;
      const local = /^(blob:|https?:\/\/(127\.0\.0\.1|localhost)[:/])/i.test(url);
      if (local || m.video) {
        if (m.video) { toastPick("视频没法直接用，请改用「选择图片…」选它的动图"); return; }
        toastPick("正在读取图片…");
        try { url = await toDataUrl(url); } catch (e) { toastPick("图片读取失败（" + (e && e.message || e) + "），请改用「选择图片…」"); return; }
      }
      if (url.length > 3 * 1024 * 1024) { toastPick("图片太大了，请改用「选择图片…」"); return; }
      post({ type: "agywe:save-pet-url", url });
      diag("pet-picked", { picked: { ...nodeInfo(m.el), url: m.url.slice(0, 200), snapshot: !!m.snapshot, video: !!m.video } });
      endPick();
    }
    function startPick(mode) {
      if (pick) return;
      toggleSettings(false);
      ensureStyle();
      const ov = document.createElement("div"); ov.id = "agywe-pick";
      const box = document.createElement("div"); box.className = "agywe-pick-box";
      const tip = document.createElement("div"); tip.className = "agywe-pick-tip";
      tip.textContent = mode === "pet" ? "把鼠标移到桌宠身上，点一下就用它当挂件　·　右键或 Esc 取消" : "把鼠标移到要调整的区域上，点击加上 / 去掉毛玻璃　·　右键或 Esc 结束";
      ov.append(box, tip);
      document.documentElement.appendChild(ov);
      toTopLayer(ov);
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const onMove = (e) => { if (!pick) return; pick.target = pickTarget(e.clientX, e.clientY); drawPick(); };
      const onDown = (e) => {
        stop(e);
        if (!pick) return;
        if (e.button === 2) { endPick(); return; }
        if (e.button === 0) {
          const t = pickTarget(e.clientX, e.clientY);
          if (pick.mode === "pet") { if (t) usePicked(t); else toastPick("这里没找到图片，换个位置试试"); }
          else if (t) togglePicked(t);
        }
      };
      const onKey = (e) => { if (e.key === "Escape") { stop(e); endPick(); } };
      const handlers = [["pointermove", onMove], ["pointerdown", onDown], ["pointerup", stop], ["mousedown", stop], ["mouseup", stop], ["click", stop], ["dblclick", stop], ["auxclick", stop], ["contextmenu", stop], ["keydown", onKey]];
      for (const [t, h] of handlers) window.addEventListener(t, h, true);
      pick = { ov, box, tip, target: null, handlers, toast: false, toastT: 0, mode: mode === "pet" ? "pet" : "glass" };
    }

    // =====================================================================
    // 会话头像：每条你发的消息旁边、每段 agent 回复左边放一个小头像
    // 不往 Antigravity 自己的界面里插节点（避免和它的 React 冲突），而是一层不挡鼠标的浮层，按消息的位置贴上去
    // =====================================================================
    const USER_STEP_SEL = '[class~="group/user-input-step"]';
    const av = { root: null, raf: 0, pool: new Map(), ids: new WeakMap(), seq: 0, stats: null };
    function avOn() { return !!(cfg && cfg.avatarsOn !== false && !hideAll); }
    function scheduleAvatars() { if (!av.raf) av.raf = requestAnimationFrame(avLayout); }
    function avKey(el) { let k = av.ids.get(el); if (!k) { k = ++av.seq; av.ids.set(el, k); } return k; }
    function avImageSrc(who) {
      const v = who === "user" ? cfg.avatarUser : (cfg.avatarAgent === undefined ? "pet" : cfg.avatarAgent);
      if (!v) return null;
      if (v === "pet") {
        const pc = petCfg();
        if (!pc.image) return null;
        return String(pc.image).startsWith("url:") ? String(pc.image).slice(4) : ORIGIN + "/pet-image?v=" + encodeURIComponent(String(pc.stamp));
      }
      if (String(v).startsWith("url:")) return String(v).slice(4);
      return ORIGIN + "/avatar/" + who + "?v=" + encodeURIComponent(String(cfg.avatarStamp || 0));
    }
    function avLook(who) {
      const src = avImageSrc(who);
      return src ? who + "|img|" + src.length + "|" + src.slice(0, 48) + src.slice(-48) : who + "|def|" + (who === "user" ? String(cfg.avatarUserText || "我") : "");
    }
    function avDefault(el, who) {
      el.classList.add("def");
      if (who === "agent") el.appendChild(defaultDoll());
      else { const t = document.createElement("span"); t.textContent = Array.from(String(cfg.avatarUserText || "我")).slice(0, 2).join(""); el.appendChild(t); }
    }
    function avFill(el, who) {
      const look = avLook(who);
      if (el.dataset.look === look) return;
      el.dataset.look = look;
      el.textContent = ""; el.classList.remove("def");
      const src = avImageSrc(who);
      if (!src) { avDefault(el, who); return; }
      const img = new Image(); img.alt = ""; img.draggable = false; img.decoding = "async";
      img.onerror = () => { el.textContent = ""; avDefault(el, who); };
      img.src = src;
      el.appendChild(img);
    }
    function avClear() { if (av.root) { try { av.root.remove(); } catch { } } av.root = null; av.pool.clear(); }
    function avScroller(el) {
      for (let p = el.parentElement, n = 0; p && n < 40 && p !== document.body && p !== document.documentElement; p = p.parentElement, n++) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") return p;
      }
      return null;
    }
    // 消息列表：从第一条用户消息往上找，跳过只有一个孩子的包装层，再上一层就是列表
    function avList() {
      const step = document.querySelector(USER_STEP_SEL);
      if (!step) return null;
      let item = step.closest(".scroll-mt-4");
      if (!item) { item = step; for (let i = 0; i < 4 && item.parentElement; i++) item = item.parentElement; }
      for (let i = 0; i < 4 && item.parentElement && item.parentElement.childElementCount === 1; i++) item = item.parentElement;
      return item.parentElement;
    }
    function avLayout() {
      av.raf = 0;
      if (!avOn()) { avClear(); av.stats = { off: true }; return; }
      const list = avList();
      if (!list) { avClear(); av.stats = { list: false, path: location.pathname }; return; }
      if (!av.root || !av.root.isConnected) {
        av.root = document.createElement("div"); av.root.id = "agywe-avatars"; av.root.setAttribute("aria-hidden", "true");
        document.documentElement.appendChild(av.root); av.pool.clear();
      }
      const size = clamp(Number(cfg.avatarSize) || 34, 20, 72), gap = 10;
      const sc = avScroller(list);
      const sr = sc ? sc.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      av.root.style.setProperty("--agywe-av", size + "px");
      av.root.style.setProperty("clip-path", `inset(${Math.max(0, sr.top)}px ${Math.max(0, innerWidth - sr.right)}px ${Math.max(0, innerHeight - sr.bottom)}px ${Math.max(0, sr.left)}px)`);
      const shape = ["circle", "rounded", "none"].includes(cfg.avatarShape) ? cfg.avatarShape : "circle";
      if (av.root.dataset.shape !== shape) av.root.dataset.shape = shape;
      // 分组：用户消息一组一组，中间连着的 agent 内容算一段回复
      const users = [], runs = [];
      let run = null;
      for (const it of list.children) {
        if (isOurs(it)) continue;
        const steps = it.matches(USER_STEP_SEL) ? [it] : [...it.querySelectorAll(USER_STEP_SEL)];
        if (steps.length) {
          run = null;
          for (const st of steps) users.push(st);
          // 同一个包装里用户消息下面还跟着回复的情况
          const last = steps[steps.length - 1].getBoundingClientRect(), ir = it.getBoundingClientRect();
          if (ir.bottom - last.bottom > 80) { run = { first: it, last: it, topFrom: last.bottom }; runs.push(run); }
          continue;
        }
        const r = it.getBoundingClientRect();
        if (r.height < 14 || !(it.textContent || "").trim()) continue;
        if (!run) { run = { first: it, last: it }; runs.push(run); } else run.last = it;
      }
      const used = new Set();
      const lastAgentKey = runs.length ? "a" + avKey(runs[runs.length - 1].first) : "";
      const place = (key, who, x, y, busy) => {
        let el = av.pool.get(key);
        if (!el || !el.isConnected) { el = document.createElement("div"); el.className = "agywe-av agywe-av-" + who; av.root.appendChild(el); av.pool.set(key, el); }
        avFill(el, who);
        el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        if (el.classList.contains("busy") !== !!busy) el.classList.toggle("busy", !!busy);
        const md = who === "agent" && key === lastAgentKey ? mood.state : "";
        for (const m of ["done", "attention", "error"]) if (el.classList.contains("mood-" + m) !== (md === m)) el.classList.toggle("mood-" + m, md === m);
        used.add(key);
      };
      const visible = (y) => y + size > sr.top && y < sr.bottom;
      let placedU = 0, placedA = 0, noRoom = 0;
      for (const st of users) {
        const fr = (st.querySelector(".agy-user-bubble-frame") || st.querySelector(".agy-user-bubble") || st).getBoundingClientRect();
        if (fr.width < 4 || !visible(fr.top)) continue;
        let x = fr.right + gap;
        if (x + size > sr.right - 4) x = fr.left - gap - size;    // 右边放不下就放到气泡左边
        if (x < sr.left + 2) { noRoom++; continue; }
        place("u" + avKey(st), "user", x, fr.top, false);
        placedU++;
      }
      runs.forEach((rn, i) => {
        const a = rn.first.getBoundingClientRect(), b = rn.last.getBoundingClientRect();
        const top = rn.topFrom !== undefined ? rn.topFrom + 4 : a.top, bottom = b.bottom;
        if (bottom <= sr.top || top >= sr.bottom) return;
        const x = Math.min(a.left, b.left) - gap - size;
        if (x < sr.left + 2) { noRoom++; return; }
        // 回复很长时头像跟着滚动停在可见区域顶部（像吸顶），到回复结尾就停住
        const y = Math.max(top, Math.min(sr.top + 8, bottom - size));
        place("a" + avKey(rn.first), "agent", x, y, agents > 0 && i === runs.length - 1);
        placedA++;
      });
      for (const [k, el] of av.pool) if (!used.has(k)) { try { el.remove(); } catch { } av.pool.delete(k); }
      av.stats = { list: true, items: list.childElementCount, users: users.length, runs: runs.length, placedU, placedA, noRoom, scroller: !!sc, sr: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.right), Math.round(sr.bottom)], listRect: (() => { const r = list.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; })() };
    }
    window.addEventListener("scroll", () => { if (av.root || avOn()) scheduleAvatars(); scheduleScan(); }, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleScan(); });

    // =====================================================================
    // Agent 状态：完成 / 需要你确认 / 出错 → 挂件跳一下、换颜色、冒气泡；最后一个 agent 头像换颜色；壁纸边缘闪一下
    // 信号来自 Antigravity 自己发的系统通知（notification:send）和正在运行的 agent 数量
    // =====================================================================
    const mood = { state: "", timer: 0, doneT: 0, notes: 0, counts: 0, title: "", titleAt: 0 };
    const MOOD_RE = {
      error: /错误|失败|出错|异常|中断|报错|崩溃|\berror\b|\bfail|crash|blocked|exception|denied/i,
      attention: /需要|等待|确认|批准|授权|允许|审核|审批|请回复|你的输入|询问|选择|approv|permission|confirm|waiting|needs? (your )?(input|attention|approval|review)|question|allow|action required/i,
      done: /完成|已完成|结束|搞定|好了|\bdone\b|finish|complete|success|ready/i
    };
    // v0.8：Antigravity 的通知是「Agent finished: 对话标题」这种格式。只按冒号前面的状态判断，
    // 免得对话标题里碰巧有「失败」「确认」之类的词被认错
    const NOTE_RE = /^\s*(?:agent|智能体|代理)\s*([^:：]{1,40}?)\s*[:：]\s*(.*)$/i;
    const STATUS_RE = {
      error: /fail|error|crash|abort|exception|失败|出错|错误|异常|崩溃/i,
      attention: /need|wait|requir|approv|permission|confirm|input|attention|review|ask|block|paus|question|需要|等待|确认|批准|授权|允许|审核|输入/i,
      done: /finish|complet|done|success|succeed|ready|完成|结束|好了/i
    };
    function diagLite(reason, extra) { try { ipcRenderer.send("agywe:diag", { reason, path: location.pathname, ...(extra || {}) }); } catch { } }
    function parseNote(o) {
      const title = String(o.title || ""), body = String(o.body || "");
      const m = NOTE_RE.exec(body) || NOTE_RE.exec(title);
      if (m) {
        const st = m[1];
        const kind = STATUS_RE.error.test(st) ? "error" : STATUS_RE.attention.test(st) ? "attention" : STATUS_RE.done.test(st) ? "done" : "";
        return { kind, conv: String(m[2] || "").trim(), structured: true, status: st };
      }
      const t = title + " " + body;
      const kind = MOOD_RE.error.test(t) ? "error" : MOOD_RE.attention.test(t) ? "attention" : MOOD_RE.done.test(t) ? "done" : "";
      return { kind, conv: "", structured: false, status: "" };
    }
    function onAppNotification(o) {
      try {
        const r = parseNote(o);
        if (mood.notes++ < 40) diagLite("app-notification", { note: { title: String(o.title || "").slice(0, 80), body: String(o.body || "").slice(0, 120), kind: r.kind, structured: r.structured, status: r.status } });
        if (r.kind) { clearTimeout(mood.doneT); mood.title = r.conv; mood.titleAt = Date.now(); setMood(r.kind); }
      } catch { }
    }
    // ---- v0.8 agent 运行计时：挂件下面显示 ⏱ 已经跑了多久 ----
    const run = { t0: 0, timer: 0, last: 0, endAt: 0 };
    function fmtDur(ms) {
      const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60;
      return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0") : m + ":" + String(x).padStart(2, "0");
    }
    function fmtDurCn(ms) {
      const t = Math.max(1, Math.round(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60;
      return h ? h + " 小时 " + m + " 分" : m ? m + " 分 " + x + " 秒" : x + " 秒";
    }
    function renderRun() {
      if (!pet || !pet.sway) return;
      let el = pet.run;
      if (!el || !el.isConnected) { el = document.createElement("div"); el.className = "agywe-run"; pet.sway.appendChild(el); pet.run = el; }
      const on = !!(run.t0 && cfg && cfg.agentTimer !== false);
      el.classList.toggle("on", on);
      if (on) { el.textContent = "⏱ " + fmtDur(Date.now() - run.t0); el.title = "agent 已经跑了这么久"; }
    }
    function onRunCount(prev, now) {
      if (now > 0 && !run.t0) { run.t0 = Date.now(); clearInterval(run.timer); run.timer = setInterval(renderRun, 1000); }
      else if (now <= 0 && run.t0) {
        run.last = Date.now() - run.t0; run.endAt = Date.now(); run.t0 = 0; clearInterval(run.timer); run.timer = 0;
        try { ipcRenderer.send("agywe:stat", { type: "run", ms: run.last }); } catch { }
      }
      if ((prev > 0) !== (now > 0)) { try { refreshPet(); } catch { } }
      renderRun();
    }
    function onAgentCount(prev, now) {
      try { onRunCount(prev, now); } catch { }
      setTimeout(() => { try { buddyUpdate(); } catch { } }, 0);
      try {
        if (mood.counts++ < 40) diagLite("agent-count", { prev, now });
        if (now > prev) { clearTimeout(mood.doneT); if (mood.state) clearMood(); }
        else if (prev > 0 && now === 0) {
          clearTimeout(mood.doneT);
          // 稍等一下：如果紧跟着来了"出错 / 需要确认"的通知，就用那个；已经由通知报过"完成"的不再重复响
          mood.doneT = setTimeout(() => { if (!mood.state) { if (Date.now() - mood.titleAt > 5000) mood.title = ""; setMood("done"); } }, 1500);
        }
      } catch { }
    }
    function moodSub() {
      const parts = [];
      if (mood.title && Date.now() - mood.titleAt < 20000) parts.push("「" + (mood.title.length > 26 ? mood.title.slice(0, 25) + "…" : mood.title) + "」");
      if (mood.state === "done" && run.last && Date.now() - run.endAt < 20000 && cfg && cfg.agentTimer !== false) parts.push("用时 " + fmtDurCn(run.last));
      return parts.join(" · ");
    }
    function moodText(state) {
      const T = (cfg && cfg.moodText) || {};
      return state === "done" ? (T.done || "完成啦～") : state === "attention" ? (T.attention || "需要你看一下") : (T.error || "好像出错了");
    }
    function setMood(state, _detail, test) {
      if (!state || (!test && cfg && cfg.agentMood === false)) return;
      clearTimeout(mood.timer);
      mood.state = state;
      renderMood();
      try { buddyOnMood(state); } catch { }
      if (state === "done") { try { confettiBurst(); } catch { } }
      try { sfxPlay(state); } catch { }
      if (!test) { try { if (cfg && cfg.flashOnDone !== false && !document.hasFocus()) ipcRenderer.send("agywe:flash", state); } catch { } }
      if (!test) { try { ipcRenderer.send("agywe:stat", { type: "mood", kind: state }); } catch { } }
      mood.timer = setTimeout(clearMood, state === "done" ? 8000 : 120000);
      post({ type: "agywe:mood", mood: state });
      scheduleAvatars();
    }
    function clearMood() {
      clearTimeout(mood.timer);
      if (!mood.state) return;
      mood.state = "";
      renderMood();
      try { buddyOnMood(""); } catch { }
      post({ type: "agywe:mood", mood: "" });
      scheduleAvatars();
    }
    function renderMood() {
      try { buddyMoodBubble(); } catch { }
      if (!pet) return;
      try { refreshPet(); } catch { }
      for (const m of ["done", "attention", "error"]) pet.root.classList.toggle("agywe-mood-" + m, mood.state === m);
      let b = pet.bubble;
      if (!mood.state) { if (b) b.classList.remove("show"); return; }
      if (!b || !b.isConnected) {
        b = document.createElement("div"); b.className = "agywe-bubble";
        b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); clearMood(); });
        pet.rig.appendChild(b); pet.bubble = b;
      }
      b.textContent = (mood.state === "done" ? "✓ " : mood.state === "attention" ? "! " : "✕ ") + moodText(mood.state);
      const sub = moodSub();
      if (sub) { const sp2 = document.createElement("span"); sp2.className = "agywe-sub"; sp2.textContent = sub; b.appendChild(sp2); }
      b.dataset.mood = mood.state;
      b.classList.toggle("left", pet.left + petCfg().size / 2 > innerWidth / 2);   // 气泡朝窗口中间那边冒
      b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    }

    // =====================================================================
    // 打字时专注：在输入框里打字时通知壁纸页变暗 / 模糊 / 暂停，停手一会儿恢复
    // =====================================================================
    const typing = { on: false, t: 0 };
    function setTyping(on) { if (typing.on === on) return; typing.on = on; post({ type: "agywe:typing", on }); }
    function onTypeKey(e) {
      if (!cfg || !cfg.focusMode || cfg.focusMode === "none") { if (typing.on) setTyping(false); return; }
      if (e.type === "keydown" && ["Control", "Alt", "Shift", "Meta", "CapsLock", "Tab", "Escape"].includes(e.key)) return;
      const t = e.target;
      if (!t || !t.closest || isOurs(t)) return;
      let f = null; try { f = t.closest(FIELD_SEL); } catch { }
      if (!f) return;
      setTyping(true);
      clearTimeout(typing.t);
      typing.t = setTimeout(() => setTyping(false), clamp(Number(cfg.focusDelay) || 2.5, 0.5, 10) * 1000);
    }
    window.addEventListener("keydown", onTypeKey, { capture: true, passive: true });
    window.addEventListener("compositionupdate", onTypeKey, { capture: true, passive: true });
    window.addEventListener("focusout", () => { if (typing.on) { clearTimeout(typing.t); typing.t = setTimeout(() => setTyping(false), 500); } }, true);

    // =====================================================================
    // 当前在哪个对话 / 项目：给壁纸页（按项目换壁纸）和设置页（绑定按钮）用
    // =====================================================================
    let ctxSig = "";
    const projLabels = new Map();
    function chatContext() {
      const m = /\/c\/([\w-]+)/.exec(location.pathname);
      let project = "";
      try { project = new URLSearchParams(location.search).get("project") || ""; } catch { }
      if (project === "outside-of-project") project = "";
      let title = "";
      try {
        const tb = document.querySelector('[class~="@container/titlebar"]');
        title = String((tb && tb.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 60);
      } catch { }
      return { conv: m ? m[1] : "", project, title };
    }
    function projectLabel(id) {
      if (!id) return "";
      if (projLabels.has(id)) return projLabels.get(id);
      let label = "";
      try {
        for (const a of document.querySelectorAll("a[href]")) {
          const h = a.getAttribute("href") || "";
          if (!h.includes(id) || /\/c\//.test(h)) continue;
          label = String(a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
          if (label) break;
        }
      } catch { }
      if (label) projLabels.set(id, label);
      return label;
    }
    function sendContext(force) {
      const c = chatContext();
      const sig = c.conv + "|" + c.project + "|" + c.title;
      if (!force && sig === ctxSig) return;
      ctxSig = sig;
      const msg = { type: "agywe:context", ...c, projectLabel: projectLabel(c.project) };
      post(msg);
      try { settingsFrame && settingsFrame.contentWindow && settingsFrame.contentWindow.postMessage(msg, ORIGIN); } catch { }
    }

    // =====================================================================
    // 点击 / 拖尾特效：一张不挡鼠标的画布，没有粒子时不跑动画
    // =====================================================================
    const fx = { cv: null, ctx: null, parts: [], raf: 0, last: null, hue: 0, dpr: 1 };
    function fxOn() { return !!(cfg && cfg.enabled && !hideAll && !cfg.lowSpec && (cfg.doneConfetti !== false || (cfg.clickFx && cfg.clickFx !== "none") || (cfg.trailFx && cfg.trailFx !== "none") || (cfg.typeFx && cfg.typeFx !== "none"))); }
    function applyFxCfg() {
      if (!fxOn()) { if (fx.cv) { try { fx.cv.remove(); } catch { } fx.cv = null; fx.ctx = null; fx.parts.length = 0; } return; }
      if (fx.cv && fx.cv.isConnected) return;
      const cv = document.createElement("canvas"); cv.id = "agywe-fx"; cv.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(cv);
      toTopLayer(cv);
      fx.cv = cv; fx.ctx = cv.getContext("2d"); fxResize();
    }
    function fxResize() {
      if (!fx.cv) return;
      fx.dpr = Math.min(2, devicePixelRatio || 1);
      fx.cv.width = Math.round(innerWidth * fx.dpr); fx.cv.height = Math.round(innerHeight * fx.dpr);
    }
    function fxColor() {
      if (cfg && cfg.fxRainbow) { fx.hue = (fx.hue + 7) % 360; return `hsl(${fx.hue},95%,72%)`; }
      return themeAccentHex() || (cfg && cfg.fxColor) || "#9ec5ff";
    }
    function fxSpawn(p) { if (fx.parts.length < 600) fx.parts.push(p); if (!fx.raf) fx.raf = requestAnimationFrame(fxTick); }
    const R = Math.random;
    function fxClick(x, y) {
      const kind = cfg.clickFx, col = fxColor();
      if (kind === "ripple") { fxSpawn({ t: "ring", x, y, life: 0, max: 34, col, r0: 4, r1: 46 }); fxSpawn({ t: "ring", x, y, life: -6, max: 34, col, r0: 2, r1: 30 }); }
      else if (kind === "sparkle") { for (let i = 0; i < 16; i++) { const a = R() * Math.PI * 2, v = 1.5 + R() * 3.5; fxSpawn({ t: "star", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .06, life: 0, max: 34 + R() * 20, col: cfg.fxRainbow ? fxColor() : col, s: 2 + R() * 3, rot: R() * 6 }); } }
      else if (kind === "petal") { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (R() - .5) * 2.6, v = 1.5 + R() * 2.5; fxSpawn({ t: "petal", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .035, life: 0, max: 70 + R() * 30, col: cfg.fxRainbow ? fxColor() : "#ffb7cf", s: 5 + R() * 4, rot: R() * 6, vr: (R() - .5) * .2 }); } }
      else if (kind === "heart") { for (let i = 0; i < 6; i++) fxSpawn({ t: "heart", x: x + (R() - .5) * 20, y, vx: (R() - .5) * 1.2, vy: -1.2 - R() * 1.6, g: -.005, life: 0, max: 60 + R() * 20, col: cfg.fxRainbow ? fxColor() : "#ff7aa8", s: 6 + R() * 5, rot: (R() - .5) * .5 }); }
    }
    function fxMove(x, y) {
      const kind = cfg.trailFx, last = fx.last;
      fx.last = { x, y };
      if (!last) return;
      const d = Math.hypot(x - last.x, y - last.y);
      if (d < 2) return;
      const col = fxColor();
      if (kind === "glow") fxSpawn({ t: "line", x0: last.x, y0: last.y, x, y, life: 0, max: 18, col, w: 4 });
      else if (kind === "comet") fxSpawn({ t: "dot", x, y, vx: 0, vy: 0, g: 0, life: 0, max: 26, col, s: 5 });
      else if (kind === "sparkle") { const n = Math.min(3, 1 + (d / 12) | 0); for (let i = 0; i < n; i++) fxSpawn({ t: "star", x: x + (R() - .5) * 6, y: y + (R() - .5) * 6, vx: (R() - .5) * .8, vy: R() * .6, g: .03, life: 0, max: 26 + R() * 16, col: cfg.fxRainbow ? fxColor() : col, s: 1.5 + R() * 2, rot: R() * 6 }); }
    }
    function drawStar(c, s) { c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? s * .4 : s; const a = i * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); }
    function drawHeart(c, s) { c.beginPath(); c.moveTo(0, s * .35); c.bezierCurveTo(-s, -s * .3, -s * .45, -s, 0, -s * .45); c.bezierCurveTo(s * .45, -s, s, -s * .3, 0, s * .35); c.fill(); }
    function fxTick() {
      fx.raf = 0;
      const c = fx.ctx; if (!c || !fx.cv) { fx.parts.length = 0; return; }
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, fx.cv.width, fx.cv.height);
      c.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
      c.globalCompositeOperation = "lighter";
      const keep = [];
      for (const p of fx.parts) {
        p.life++;
        if (p.life < 0) { keep.push(p); continue; }
        const k = p.life / p.max; if (k >= 1) continue;
        keep.push(p);
        const a = 1 - k;
        c.globalAlpha = a; c.fillStyle = p.col; c.strokeStyle = p.col;
        if (p.vx !== undefined) { p.x += p.vx; p.y += p.vy; p.vy += p.g || 0; p.vx *= .985; if (p.vr) p.rot += p.vr; }
        if (p.t === "ring") { c.lineWidth = 2.2 * a + .5; c.beginPath(); c.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - (1 - k) * (1 - k)), 0, Math.PI * 2); c.stroke(); }
        else if (p.t === "line") { c.lineWidth = p.w * a; c.lineCap = "round"; c.shadowBlur = 8; c.shadowColor = p.col; c.beginPath(); c.moveTo(p.x0, p.y0); c.lineTo(p.x, p.y); c.stroke(); c.shadowBlur = 0; }
        else if (p.t === "dot") { c.beginPath(); c.arc(p.x, p.y, p.s * a + .5, 0, Math.PI * 2); c.fill(); }
        else { c.save(); c.translate(p.x, p.y); c.rotate(p.rot || 0); c.globalCompositeOperation = p.t === "petal" || p.t === "heart" || p.t === "text" ? "source-over" : "lighter";
          if (p.t === "star") drawStar(c, p.s);
          else if (p.t === "heart") drawHeart(c, p.s);
          else if (p.t === "text") { const sc = 1 + .35 * Math.max(0, 1 - p.life / 6); c.scale(sc, sc); c.font = "800 " + p.s + "px \"Microsoft YaHei UI\", \"Segoe UI\", sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowBlur = 6; c.shadowColor = "rgba(0,0,0,.35)"; c.fillText(p.ch, 0, 0); c.shadowBlur = 0; }
          else { c.beginPath(); c.ellipse(0, 0, p.s, p.s * .55, 0, 0, Math.PI * 2); c.fill(); }
          c.restore(); }
      }
      c.globalAlpha = 1;
      fx.parts = keep;
      if (keep.length) fx.raf = requestAnimationFrame(fxTick);
      else { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, fx.cv.width, fx.cv.height); }
    }
    window.addEventListener("pointerdown", (e) => { if (fx.cv && cfg && cfg.clickFx && cfg.clickFx !== "none" && e.button === 0 && !pick) fxClick(e.clientX, e.clientY); }, { capture: true, passive: true });
    window.addEventListener("pointermove", (e) => { if (fx.cv && cfg && cfg.trailFx && cfg.trailFx !== "none" && !pick) fxMove(e.clientX, e.clientY); }, { capture: true, passive: true });
    document.addEventListener("mouseleave", () => { fx.last = null; }, { passive: true });

    // =====================================================================
    // 系统音频频谱：抓电脑正在播放的声音（不录麦克风），只算 64 段频谱发给壁纸
    // =====================================================================
    const audio = { boot: false, state: "off", stream: null, ctx: null, an: null, buf: null, timer: 0, starting: false, waitGesture: false, tries: 0 };
    function audioWanted() { return !!(cfg && cfg.systemAudio !== false && (cfg.enabled || audio.boot)); }
    function setAudioState(st, detail) {
      if (audio.state === st) return;
      audio.state = st;
      post({ type: "agywe:audio-state", state: st });
      try { ipcRenderer.send("agywe:audio-state", st); } catch { }
      diag("audio-" + st, detail ? { audioDetail: String(detail).slice(0, 300) } : undefined);
    }
    function applyAudioCfg() { if (audioWanted()) startAudio(); else stopAudio(); }
    function stopAudio() {
      clearInterval(audio.timer); audio.timer = 0;
      try { audio.stream && audio.stream.getTracks().forEach((t) => t.stop()); } catch { }
      try { audio.ctx && audio.ctx.close(); } catch { }
      audio.stream = null; audio.ctx = null; audio.an = null;
      setAudioState("off");
    }
    async function startAudio() {
      if (audio.stream || audio.starting || !ready) return;
      audio.starting = true;
      try {
        try { ipcRenderer.send("agywe:audio-arm"); } catch { }
        await new Promise((r) => setTimeout(r, 30));
        const st = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } });
        st.getVideoTracks().forEach((t) => { try { t.stop(); } catch { } });
        const at = st.getAudioTracks()[0];
        if (!at) { st.getTracks().forEach((t) => t.stop()); throw new Error("没有拿到音频轨"); }
        if (!audioWanted()) { st.getTracks().forEach((t) => t.stop()); return; }
        at.addEventListener("ended", () => { if (audio.stream === st) { audio.stream = null; setAudioState("off", "track ended"); if (audioWanted() && audio.tries++ < 5) setTimeout(startAudio, 3000); } });
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const src = ctx.createMediaStreamSource(new MediaStream([at]));
        const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.78; an.minDecibels = -95; an.maxDecibels = -22;
        src.connect(an);   // 不接扬声器，避免回声
        audio.stream = st; audio.ctx = ctx; audio.an = an; audio.buf = new Uint8Array(an.frequencyBinCount);
        if (ctx.state === "suspended") { try { await ctx.resume(); } catch { } }
        audio.timer = setInterval(pumpAudio, 33);
        audio.waitGesture = false;
        setAudioState("live");
      } catch (e) {
        const msg = (e && (e.name + ": " + e.message)) || String(e);
        setAudioState(/NotAllowed|InvalidState|activation|gesture/i.test(msg) ? "denied" : "unavailable", msg);
        audio.waitGesture = true;   // 可能是需要用户操作才能开：等下一次点击再试
      } finally { audio.starting = false; }
    }
    const AUDIO_BANDS = 64;
    function pumpAudio() {
      const an = audio.an; if (!an || document.hidden) return;
      if (audio.ctx && audio.ctx.state === "suspended") { audio.ctx.resume().catch(() => { }); return; }
      an.getByteFrequencyData(audio.buf);
      const b = audio.buf, out = new Array(AUDIO_BANDS), T = b.length * 0.72, lo = 2;
      for (let i = 0; i < AUDIO_BANDS; i++) {
        const s0 = lo + Math.floor(T * (i / AUDIO_BANDS) ** 2), s1 = Math.max(s0 + 1, lo + Math.floor(T * ((i + 1) / AUDIO_BANDS) ** 2));
        let m = 0; for (let j = s0; j < s1 && j < b.length; j++) if (b[j] > m) m = b[j];
        out[i] = m;
      }
      post({ type: "agywe:audio", bands: out });
    }
    const retryAudio = () => { if (audio.waitGesture && audioWanted() && !audio.stream && audio.tries++ < 6) { audio.waitGesture = false; startAudio(); } else if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume().catch(() => { }); };
    window.addEventListener("pointerdown", retryAudio, { capture: true, passive: true });
    window.addEventListener("keydown", retryAudio, { capture: true, passive: true });

    // =====================================================================
    // 开屏动画：Antigravity 自带的加载画面（跳动的 A）一消失就接上，等界面和壁纸都准备好再揭开
    // 随时点一下 / 按 Esc 跳过；最长不超过设定的秒数，不会拖慢你进去
    // =====================================================================
    const SPLASH_CSS = `
@property --agywe-r { syntax: "<length>"; inherits: false; initial-value: 0px; }
html.agywe-splash-on #agywe-pet, html.agywe-splash-on #agywe-avatars, html.agywe-splash-on #agywe-fx { opacity: 0 !important; visibility: hidden !important; }
#agywe-pet, #agywe-avatars { transition: opacity .7s ease; }
#agywe-splash {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; z-index: 2147483647 !important; display: block;
  background: var(--sp-bg) !important; color: var(--sp-fg); font-family: "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif; text-shadow: none; letter-spacing: 0;
  user-select: none; -webkit-user-select: none; cursor: default; pointer-events: auto !important; -webkit-app-region: no-drag !important; app-region: no-drag !important;
  --ps: min(140px, 22vmin); --rope: max(40px, calc(50vh - var(--ps) - 70px));
}
#agywe-splash * { box-sizing: border-box; }
#agywe-splash .sp-bg { position: absolute; inset: -6%; background: var(--sp-grad); }
#agywe-splash .sp-bgimg { position: absolute; inset: 0; background: center / cover no-repeat; opacity: 0; transition: opacity .6s; }
#agywe-splash .sp-bgimg.on { opacity: 1; }
#agywe-splash .sp-stars { position: absolute; inset: 0; pointer-events: none; }
#agywe-splash .sp-stars i { position: absolute; bottom: -10px; left: var(--x); width: var(--s); height: var(--s); border-radius: 50%; background: var(--sp-acc); box-shadow: 0 0 8px var(--sp-acc); opacity: 0; animation: sp-rise var(--d) var(--w) linear infinite; }
@keyframes sp-rise { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .75; } 100% { transform: translateY(-105vh); opacity: 0; } }
#agywe-splash .sp-hang { position: absolute; left: 50%; top: 0; width: 0; height: 0; transform-origin: 0 0; animation: sp-sway 3.4s 1.25s ease-in-out infinite; }
#agywe-splash .sp-rope { position: absolute; left: -1px; top: 0; width: 2px; height: var(--rope); transform-origin: 50% 0; background: linear-gradient(var(--sp-rope), var(--sp-rope2)); animation: sp-rope .9s cubic-bezier(.3,1.35,.5,1) both; }
#agywe-splash .sp-pet { position: absolute; left: calc(var(--ps) / -2); top: calc(var(--rope) - 8px); width: var(--ps); height: var(--ps); animation: sp-drop 1.05s .1s cubic-bezier(.3,1.55,.5,1) both; filter: drop-shadow(0 12px 18px rgba(0,0,0,.35)); }
#agywe-splash .sp-pet img, #agywe-splash .sp-pet svg { width: 100%; height: 100%; object-fit: contain; display: block; -webkit-user-drag: none; }
@keyframes sp-rope { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes sp-drop { from { transform: translateY(calc(-1 * var(--rope) - var(--ps) - 20px)); } to { transform: none; } }
@keyframes sp-sway { 0%, 100% { rotate: 2.2deg; } 50% { rotate: -2.2deg; } }
#agywe-splash .sp-text { position: absolute; left: 0; right: 0; text-align: center; padding: 0 24px; }
#agywe-splash.st-pet .sp-text { top: calc(var(--rope) + var(--ps) + 18px); }
#agywe-splash .sp-title { font-size: 30px; font-weight: 600; letter-spacing: 1px; line-height: 1.3; }
#agywe-splash .sp-title span { display: inline-block; white-space: pre; opacity: 0; transform: translateY(12px); animation: sp-ch .55s cubic-bezier(.2,.9,.3,1.3) forwards; }
@keyframes sp-ch { to { opacity: 1; transform: none; } }
#agywe-splash .sp-sub, #agywe-splash .sp-quote { color: var(--sp-sub); opacity: 0; animation: sp-fade .8s forwards; }
#agywe-splash .sp-sub { margin-top: 10px; font-size: 14px; letter-spacing: 1px; }
#agywe-splash .sp-quote { margin-top: 16px; font-size: 13px; }
@keyframes sp-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
#agywe-splash.st-curtain .sp-bgimg { filter: blur(22px) brightness(.6) saturate(1.2); transform: scale(1.1); animation: sp-breathe 7s ease-in-out infinite alternate; transition: opacity .6s, filter 1s ease, transform 1s ease; }
@keyframes sp-breathe { from { scale: 1; } to { scale: 1.05; } }
#agywe-splash.st-curtain .sp-text { top: 50%; transform: translateY(-58%); color: #fff; }
#agywe-splash.st-curtain .sp-sub, #agywe-splash.st-curtain .sp-quote { color: rgba(255,255,255,.78); }
#agywe-splash .sp-clock { font-size: clamp(64px, 12vmin, 128px); font-weight: 200; letter-spacing: 6px; line-height: 1; font-variant-numeric: tabular-nums; opacity: 0; animation: sp-fade 1s .1s forwards; text-shadow: 0 4px 30px rgba(0,0,0,.35); }
#agywe-splash.st-curtain .sp-title { margin-top: 18px; font-size: 24px; font-weight: 500; }
#agywe-splash .sp-logo { position: absolute; left: 50%; top: calc(50% - 90px); width: 96px; height: 96px; margin-left: -48px; }
#agywe-splash .sp-logo svg { width: 100%; height: 100%; overflow: visible; }
#agywe-splash .sp-logo path { fill: transparent; stroke: var(--sp-acc); stroke-width: 4; stroke-linejoin: round; stroke-dasharray: 100; stroke-dashoffset: 100; animation: sp-draw 1.3s ease forwards, sp-fill .7s 1.1s forwards; }
@keyframes sp-draw { to { stroke-dashoffset: 0; } }
@keyframes sp-fill { to { fill: var(--sp-acc); } }
#agywe-splash .sp-ring { position: absolute; left: 50%; top: calc(50% - 42px); width: 180px; height: 180px; margin: -90px 0 0 -90px; border-radius: 50%; border: 1.5px solid var(--sp-acc); opacity: 0; animation: sp-ring 2.4s 1s ease-out infinite; }
@keyframes sp-ring { 0% { transform: scale(.55); opacity: .6; } 100% { transform: scale(1.5); opacity: 0; } }
#agywe-splash.st-minimal .sp-text { top: calc(50% + 30px); }
#agywe-splash.st-minimal .sp-title { font-size: 22px; font-weight: 500; letter-spacing: 3px; }
#agywe-splash .sp-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
#agywe-splash .sp-foot { position: absolute; left: 0; right: 0; bottom: 28px; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; color: var(--sp-sub); opacity: 0; animation: sp-fade .6s .5s forwards; }
#agywe-splash.st-curtain .sp-foot, #agywe-splash.st-media .sp-foot { color: rgba(255,255,255,.75); text-shadow: 0 1px 4px rgba(0,0,0,.6); }
#agywe-splash .sp-bar { width: 160px; height: 3px; border-radius: 3px; background: rgba(127,127,127,.25); overflow: hidden; position: relative; }
#agywe-splash .sp-bar::after { content: ""; position: absolute; top: 0; bottom: 0; left: -40%; width: 40%; border-radius: 3px; background: var(--sp-acc); animation: sp-load 1.2s ease-in-out infinite; }
#agywe-splash .sp-bar.done::after { left: 0; width: 100%; animation: none; }
@keyframes sp-load { 0% { left: -40%; } 100% { left: 100%; } }
#agywe-splash .sp-skip { opacity: .7; }
#agywe-splash.sp-out-reveal {
  -webkit-mask: radial-gradient(circle at var(--cx, 50%) var(--cy, 50%), transparent var(--agywe-r), #000 calc(var(--agywe-r) + 1px));
  mask: radial-gradient(circle at var(--cx, 50%) var(--cy, 50%), transparent var(--agywe-r), #000 calc(var(--agywe-r) + 1px));
  transition: --agywe-r .9s cubic-bezier(.65,0,.25,1);
}
#agywe-splash.sp-out-reveal.go { --agywe-r: 150vmax; }
#agywe-splash.sp-out-reveal .sp-text, #agywe-splash.sp-out-reveal .sp-foot { transition: opacity .35s; opacity: 0 !important; animation: none; }
#agywe-splash.sp-out-curtain .sp-bgimg { filter: none; transform: none; }
#agywe-splash.sp-out-curtain .sp-text, #agywe-splash.sp-out-curtain .sp-foot { transition: opacity .4s, transform .6s; opacity: 0 !important; animation: none; }
#agywe-splash.sp-out-curtain.go { opacity: 0; transition: opacity .7s .55s; }
#agywe-splash.sp-out-fade.go { opacity: 0; transition: opacity .7s ease; }
#agywe-splash.sp-out-fade.go .sp-logo { transform: scale(1.5); opacity: 0; transition: transform .7s, opacity .5s; }
`;
    const LOGO_D = "M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z";
    const sp = { el: null, d: null, style: "", t0: 0, min: 0, max: 0, ui: false, wall: false, wallAt: 0, media: true, out: false, iv: 0, clock: 0, failsafe: 0, cssIn: false, keyH: null };
    function splashCss() {
      if (sp.cssIn) return;
      try { if (webFrame && typeof webFrame.insertCSS === "function") { webFrame.insertCSS(SPLASH_CSS); sp.cssIn = true; } } catch { }
      if (!sp.cssIn) { const st = document.createElement("style"); st.textContent = SPLASH_CSS; (document.head || document.documentElement).appendChild(st); sp.cssIn = true; }
    }
    function splashTok(c) {
      const d = new Date(), h = d.getHours(), pad = (n) => String(n).padStart(2, "0");
      const map = {
        greet: h < 5 ? "夜深了" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好",
        name: String((c && c.name) || "").trim(), date: `${d.getMonth() + 1}月${d.getDate()}日`, weekday: "星期" + "日一二三四五六"[d.getDay()],
        time: `${pad(h)}:${pad(d.getMinutes())}`, year: String(d.getFullYear())
      };
      return (tpl) => {
        let t = String(tpl || "");
        if (!map.name) t = t.replace(/[\s，,、·~～]*\{name\}/g, "");
        return t.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).trim();
      };
    }
    function splashQuote(str) {
      const lines = String(str || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      return lines.length ? lines[Math.floor(Math.random() * lines.length)] : "";
    }
    function splashBoot() {
      let d = null;
      try { d = ipcRenderer.sendSync("agywe:splash-sync", { preview: false }); } catch { d = null; }
      if (!d || !d.show) return;
      const go = () => { try { splashBuild(d); } catch (e) { splashKill("build-error: " + (e && e.message || e)); } };
      if (document.documentElement) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
    }
    function splashBuild(d) {
      if (sp.el) return;
      splashCss();
      const root = document.documentElement;
      if (!root) return;
      const c = d.sp || {};
      let style = ["pet", "curtain", "minimal", "media"].includes(d.style) ? d.style : "pet";
      if (style === "media" && !d.media) style = "pet";
      const dark = d.theme !== "light";
      const V = dark
        ? { bg: "#0c0d13", fg: "#f3f4f8", sub: "#a7adbb", grad: "radial-gradient(ellipse at 50% 38%, #22263a 0%, #12141d 45%, #08090d 100%)", rope: "rgba(255,255,255,.85)", rope2: "rgba(255,255,255,.4)" }
        : { bg: "#ece7df", fg: "#2b2d35", sub: "#6b6e76", grad: "radial-gradient(ellipse at 50% 38%, #ffffff 0%, #f4f0ea 50%, #e4ddd2 100%)", rope: "rgba(60,60,70,.7)", rope2: "rgba(60,60,70,.3)" };
      if (style === "curtain" || style === "media") { V.bg = "#000"; V.grad = "radial-gradient(ellipse at 50% 40%, #1b1e2b 0%, #050608 100%)"; }
      const el = document.createElement("div");
      el.id = "agywe-splash"; el.className = "st-" + style; el.setAttribute("aria-hidden", "true");
      const vars = { "--sp-bg": V.bg, "--sp-fg": V.fg, "--sp-sub": V.sub, "--sp-grad": V.grad, "--sp-rope": V.rope, "--sp-rope2": V.rope2, "--sp-acc": /^#[0-9a-f]{3,8}$/i.test(String(c.accent || "")) ? c.accent : "#8fb4ff" };
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
      const div = (cls, txt) => { const x = document.createElement("div"); x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
      const bg = div("sp-bg"), bgimg = div("sp-bgimg");
      bg.appendChild(bgimg); el.appendChild(bg);
      if (style !== "media") {
        const stars = div("sp-stars");
        for (let i = 0; i < 18; i++) {
          const s = document.createElement("i");
          s.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "%");
          s.style.setProperty("--s", (2 + Math.random() * 3).toFixed(1) + "px");
          s.style.setProperty("--d", (5 + Math.random() * 6).toFixed(1) + "s");
          s.style.setProperty("--w", (-Math.random() * 8).toFixed(1) + "s");
          stars.appendChild(s);
        }
        el.appendChild(stars);
      }
      let clockEl = null, base = 0.5;
      sp.media = true;
      if (style === "pet") {
        base = 1.05;
        const hang = div("sp-hang"), rope = div("sp-rope"), pet = div("sp-pet");
        const fallback = () => { pet.textContent = ""; pet.appendChild(defaultDoll()); };
        if (d.petSrc) { const img = new Image(); img.alt = ""; img.draggable = false; img.decoding = "async"; img.onerror = fallback; img.src = d.petSrc; pet.appendChild(img); }
        else fallback();
        hang.append(rope, pet); el.appendChild(hang);
      } else if (style === "curtain") {
        base = 0.5;
        if (d.previewUrl) {
          const im = new Image();
          im.onload = () => { bgimg.style.backgroundImage = `url("${String(d.previewUrl).replace(/"/g, "%22")}")`; bgimg.classList.add("on"); };
          im.src = d.previewUrl;
        }
      } else if (style === "minimal") {
        base = 1.3;
        el.appendChild(div("sp-ring"));
        const logo = div("sp-logo");
        logo.appendChild(svgEl("svg", { viewBox: "0 0 180 180", "aria-hidden": "true" }, [svgEl("path", { d: LOGO_D, pathLength: 100 })]));
        el.appendChild(logo);
      } else if (style === "media") {
        const m = d.media;
        if (m.video) {
          sp.media = false;
          const v = document.createElement("video");
          v.className = "sp-media"; v.muted = !c.mediaSound; v.autoplay = true; v.playsInline = true; v.preload = "auto";
          v.style.objectFit = c.mediaFit === "contain" ? "contain" : "cover";
          v.addEventListener("ended", () => { sp.media = true; });
          v.addEventListener("error", () => { sp.media = true; });
          v.src = m.url;
          el.appendChild(v);
          const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => { sp.media = true; }); });
        } else {
          const im = document.createElement("img");
          im.className = "sp-media"; im.alt = ""; im.draggable = false; im.style.objectFit = c.mediaFit === "contain" ? "contain" : "cover"; im.src = m.url;
          el.appendChild(im);
        }
      }
      if (style !== "media") {
        const tok = splashTok(c);
        const text = div("sp-text");
        if (style === "curtain") { clockEl = div("sp-clock", tok("{time}")); text.appendChild(clockEl); }
        const title = div("sp-title");
        const chars = Array.from(tok(c.greeting) || tok("{greet}"));
        chars.forEach((ch, i) => { const s = document.createElement("span"); s.textContent = ch; s.style.animationDelay = (base + i * 0.05).toFixed(2) + "s"; title.appendChild(s); });
        text.appendChild(title);
        let t = base + chars.length * 0.05 + 0.1;
        const subTxt = tok(c.sub);
        if (subTxt) { const x = div("sp-sub", subTxt); x.style.animationDelay = t.toFixed(2) + "s"; text.appendChild(x); t += 0.25; }
        const q = c.showQuote ? splashQuote(c.quotes) : "";
        if (q) { const x = div("sp-quote", "「" + q + "」"); x.style.animationDelay = t.toFixed(2) + "s"; text.appendChild(x); }
        el.appendChild(text);
      }
      const foot = div("sp-foot");
      foot.append(div("sp-bar"), div("sp-status", ""), div("sp-skip", "点击任意处跳过"));
      el.appendChild(foot);
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); splashExit("skip"); });
      root.appendChild(el);
      toTopLayer(el);
      root.classList.add("agywe-splash-on");
      Object.assign(sp, {
        el, d, style, t0: Date.now(), out: false,
        min: clamp(Number(c.minSec) || 1.8, 0.3, 10) * 1000,
        ui: !!d.preview || !!document.querySelector(".agy-shell"),
        wall: !!d.preview || !d.wall, wallAt: 0
      });
      sp.max = Math.max(sp.min + 300, clamp(Number(c.maxSec) || 6, 1, 30) * 1000);
      sp.keyH = (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); splashExit("skip"); } };
      window.addEventListener("keydown", sp.keyH, true);
      sp.iv = setInterval(splashTick, 150);
      sp.failsafe = setTimeout(() => splashKill("failsafe"), sp.max + 5000);
      if (clockEl) sp.clock = setInterval(() => { try { clockEl.textContent = splashTok(c)("{time}"); } catch { } }, 1000);
    }
    function splashWall() { if (!sp.wall) { sp.wall = true; sp.wallAt = Date.now(); } }
    function splashTick() {
      if (!sp.el || sp.out) return;
      const now = Date.now(), el = now - sp.t0;
      if (!sp.ui && (document.querySelector(".agy-shell") || (el > 4000 && document.body && document.body.childElementCount > 0))) sp.ui = true;
      const st = sp.el.querySelector(".sp-status");
      if (st) st.textContent = !sp.ui ? "正在载入界面…" : !sp.wall ? "正在唤醒壁纸…" : !sp.media ? "" : "马上就好";
      if (el >= sp.max) { splashExit("timeout"); return; }
      // 壁纸刚出来时有 0.9 秒淡入，等它淡一会儿再揭开
      if (el >= sp.min && sp.ui && sp.wall && sp.media && (!sp.wallAt || now - sp.wallAt > 450)) splashExit("ready");
    }
    function splashExit(reason) {
      if (!sp.el || sp.out) return;
      sp.out = true;
      clearInterval(sp.iv); clearInterval(sp.clock);
      const el = sp.el, st = sp.style;
      try { const v = el.querySelector("video"); if (v) v.pause(); } catch { }
      const bar = el.querySelector(".sp-bar"); if (bar) bar.classList.add("done");
      try { document.documentElement.classList.remove("agywe-splash-on"); } catch { }
      let ms = 800;
      if (st === "pet") {
        const pt = el.querySelector(".sp-pet");
        if (pt) { const r = pt.getBoundingClientRect(); el.style.setProperty("--cx", Math.round(r.left + r.width / 2) + "px"); el.style.setProperty("--cy", Math.round(r.top + r.height / 2) + "px"); }
        el.classList.add("sp-out-reveal"); ms = 950;
      } else if (st === "curtain") { el.classList.add("sp-out-curtain"); ms = 1300; }
      else { el.classList.add("sp-out-fade"); ms = 760; }
      void el.offsetWidth;
      requestAnimationFrame(() => { try { el.classList.add("go"); } catch { } });
      setTimeout(() => splashKill(null), ms + 80);
      diagLite("splash-end", { reason, ms: Date.now() - sp.t0, style: st, ui: sp.ui, wall: sp.wall, preview: !!(sp.d && sp.d.preview) });
    }
    function splashKill(why) {
      clearInterval(sp.iv); clearInterval(sp.clock); clearTimeout(sp.failsafe);
      if (sp.keyH) { window.removeEventListener("keydown", sp.keyH, true); sp.keyH = null; }
      try { const v = sp.el && sp.el.querySelector("video"); if (v) { v.pause(); v.removeAttribute("src"); v.load(); } } catch { }
      try { if (sp.el) sp.el.remove(); } catch { }
      try { document.documentElement && document.documentElement.classList.remove("agywe-splash-on"); } catch { }
      sp.el = null; sp.out = false;
      if (why) diagLite("splash-kill", { why });
    }
    function splashPreview() {
      toggleSettings(false);
      setTimeout(() => {
        if (sp.el) return;
        let x = null;
        try { x = ipcRenderer.sendSync("agywe:splash-sync", { preview: true }); } catch { x = null; }
        if (x && x.show) { try { splashBuild(x); } catch (e) { splashKill("preview-error: " + (e && e.message || e)); } }
      }, 300);
    }

    // =====================================================================
    // v0.7：主题跟随壁纸 · 音效 · 挂件闲置动作 · 打字特效 · 迷你播放器 · 番茄钟 · 快捷切换壁纸
    // =====================================================================

    // ---- 主题跟随壁纸：壁纸页取色发过来，这里按界面深浅换算成毛玻璃色调和强调色 ----
    let palette = null;
    // ---- v0.10.2 标题栏跟随壁纸：算出窗口右上角按钮那一条底下实际是什么颜色，发给主进程去填 ----
    let tbLast = null;
    function tbSync() {
      try {
        if (!ready || !cfg || !cfg.enabled || hideAll || (cfg.titleBarMode !== "match" && cfg.titleBarMode !== "clear") || !palette) return;
        let col = hexArr(palette.tr) || hexArr(palette.dominant);
        if (!col) return;
        // 壁纸压暗 / 提亮
        const dm = Math.max(0, Math.min(0.9, Number(cfg.dim) || 0));
        const mode = cfg.dimMode || "auto", lighten = mode === "lighten" || (mode === "auto" && darkText === true);
        if (dm) col = col.map((v) => v * (1 - dm) + (lighten ? 255 : 0) * dm);
        // 按钮那一条下面盖着的界面层（标题栏毛玻璃等），从下往上叠
        const layers = [];
        let st = []; try { st = document.elementsFromPoint(innerWidth - 60, 10); } catch { }
        for (const el of st) {
          if (el === document.documentElement || el === document.body) break;
          if (isOurs(el)) continue;
          const c = toRgba(getComputedStyle(el).backgroundColor);
          if (c && c.a > 0.02) layers.push(c);
        }
        for (const c of layers.reverse()) col = [c.r, c.g, c.b].map((v, i) => col[i] * (1 - c.a) + v * c.a);
        const hex = arrHex(col);
        const y = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
        const sym = y > 150 ? "#1b1b1b" : "#f2f2f2";
        tbLast = { color: hex, symbol: sym, layers: layers.length };
        const key = hex + sym;
        if (key === tbSync.sent) return;
        tbSync.sent = key;
        ipcRenderer.send("agywe:tb-color", { color: hex, symbol: sym });
      } catch { }
    }
    const hexArr = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const arrHex = (a) => "#" + a.map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0")).join("");
    function rgbToHsl(c) {
      const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      if (mx === mn) return [0, 0, l];
      const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [h / 6, s, l];
    }
    function hslToRgb(h, s, l) {
      if (!s) return [l * 255, l * 255, l * 255];
      const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
    }
    function themeOn() { return !!(ready && cfg && cfg.enabled && !hideAll && cfg.themeFollow && palette && hexArr(palette.dominant) && hexArr(palette.accent)); }
    function themeHues() {
      const d = rgbToHsl(hexArr(palette.dominant)), a = rgbToHsl(hexArr(palette.accent));
      const gray = d[1] < .12;
      return { a, h: gray ? a[0] : d[0], s: gray ? a[1] * .5 : d[1] };
    }
    function themeTintRgb() {
      if (!themeOn()) return null;
      const t = themeHues(), k = clamp(Number(cfg.themeStrength ?? .6), 0, 1);
      return hslToRgb(t.h, Math.min(.55, t.s) * k, darkText ? .95 - .07 * k : .1 + .06 * k);
    }
    function themeAccentHex() {
      if (!themeOn() || cfg.themeAccent === false) return null;
      const a = themeHues().a;
      if (a[1] < .12) return null;   // 黑白灰的壁纸没有像样的强调色，用默认的
      return arrHex(hslToRgb(a[0], Math.max(.5, a[1]), darkText ? .45 : .7));
    }
    function applyTheme() {
      const root = document.documentElement; if (!root) return;
      const on = !!(ready && cfg && cfg.enabled && !hideAll);
      const t = themeTintRgb();
      const user = cfg && cfg.glassTintOn ? hexToRgb(cfg.glassTint) : null;
      if (t) root.style.setProperty("--agywe-tint", t.map((x) => Math.round(x)).join(","));
      else if (user) root.style.setProperty("--agywe-tint", user);
      root.classList.toggle("agywe-tint", on && !!(t || user));
      const acc = themeAccentHex();
      root.classList.toggle("agywe-accent", !!acc);
      const ui = acc || "#8fb4ff";
      root.style.setProperty("--agywe-acc", hexArr(ui).join(","));
      root.style.setProperty("--agywe-ui-acc", ui);
      root.classList.toggle("agywe-darktext", darkText === true);
      try { applyContrast(); } catch (e) { lastErr = String(e && e.message || e); }
    }

    // ---- 音效：全部用 WebAudio 现场合成，不带音频文件 ----
    const SFX_DEF = { on: true, volume: .5, pack: "soft", pet: true, done: true, attention: true, error: true, pomo: true, wall: true, typing: false, ui: true, remind: true, chime: true };
    const sfx = { ctx: null, master: null, noise: null, last: {} };
    function sfxCfg() { return { ...SFX_DEF, ...((cfg && cfg.sfx) || {}) }; }
    function sfxCtx() {
      if (!sfx.ctx) {
        try { sfx.ctx = new AudioContext({ latencyHint: "interactive" }); sfx.master = sfx.ctx.createGain(); sfx.master.connect(sfx.ctx.destination); }
        catch { sfx.ctx = null; return null; }
      }
      if (sfx.ctx.state === "suspended") sfx.ctx.resume().catch(() => { });
      return sfx.ctx;
    }
    function sfxNoiseBuf(c) {
      if (sfx.noise) return sfx.noise;
      const b = c.createBuffer(1, Math.floor(c.sampleRate * .5), c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return (sfx.noise = b);
    }
    // 一个音：频率 / 开始时间 / 时长 / 音量 / 波形 / 滑到的频率
    function sfxTone(c, out, f, t0, dur, vol, type, f2) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + .008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + .03);
    }
    function sfxNoise(c, out, t0, dur, vol, ftype, f, f2, q) {
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = sfxNoiseBuf(c); fl.type = ftype; fl.frequency.setValueAtTime(f, t0);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      fl.Q.value = q || 1;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(.02, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(fl); fl.connect(g); g.connect(out); s.start(t0, Math.random() * .3); s.stop(t0 + dur + .03);
    }
    const SFX_PACK = { soft: { w: "sine", d: 1, v: 1 }, crisp: { w: "triangle", d: .6, v: .9 }, retro: { w: "square", d: .45, v: .32 } };
    function sfxPlay(name, opt) {
      const s = sfxCfg();
      if (!cfg || !s.on || (s[name] === false && !(opt && opt.test))) return;
      const now = performance.now();
      if (now - (sfx.last[name] || 0) < (name === "typing" ? 28 : 90)) return;
      sfx.last[name] = now;
      const c = sfxCtx(); if (!c) return;
      const P = SFX_PACK[s.pack] || SFX_PACK.soft, w = P.w, D = P.d;
      const out = c.createGain(); out.gain.value = clamp(Number(s.volume), 0, 1) * P.v * .6; out.connect(sfx.master);
      const t = c.currentTime + .01;
      const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
      const harsh = w === "sine" ? "triangle" : w;
      switch (name) {
        case "pet": sfxTone(c, out, 520, t, .12 * D + .04, .5, w, 880); break;
        case "ui": sfxTone(c, out, 1250, t, .05, .22, "sine", 900); break;
        case "done": [72, 76, 79, 84].forEach((m, i) => sfxTone(c, out, N(m), t + i * .085, .5 * D + .15, .36, w)); break;
        case "attention": [81, 76, 81, 76].forEach((m, i) => sfxTone(c, out, N(m), t + i * .16, .16 * D + .05, .38, w)); break;
        case "error": sfxTone(c, out, 330, t, .22 * D + .08, .42, harsh, 220); sfxTone(c, out, 247, t + .2, .3 * D + .1, .38, harsh, 160); break;
        case "pomo":
          if (opt && opt.kind === "break") [67, 72, 76, 79].forEach((m, i) => sfxTone(c, out, N(m), t + i * .11, .35 * D + .2, .34, w));
          else for (let k = 0; k < 3; k++) [72, 79, 84].forEach((m) => { sfxTone(c, out, N(m), t + k * .55, 1.1 * D + .3, .2, "sine"); sfxTone(c, out, N(m) * 2.76, t + k * .55, .4, .04, "sine"); });
          break;
        case "remind": sfxTone(c, out, N(79), t, .16 * D + .06, .3, w, N(86)); sfxTone(c, out, N(86), t + .13, .3 * D + .1, .26, w); break;
        case "chime": [84, 79].forEach((m, i) => { sfxTone(c, out, N(m), t + i * .48, 1.3 * D + .5, .26, "sine"); sfxTone(c, out, N(m) * 2.01, t + i * .48, .6, .05, "sine"); sfxTone(c, out, N(m) * 2.76, t + i * .48, .35, .025, "sine"); }); break;
        case "wall": sfxNoise(c, out, t, .38, .32, "bandpass", 300, 2400, 1.2); sfxTone(c, out, 660, t + .18, .25 * D + .05, .12, "sine", 990); break;
        case "typing": {
          const del = !!(opt && opt.del), k = del ? .7 : 1;
          sfxNoise(c, out, t, .03, .45 * k, "highpass", 1800 + Math.random() * 1400, 0, .7);
          sfxTone(c, out, (del ? 180 : 240) + Math.random() * 80, t, .035, .16 * k, "triangle");
          break;
        }
        default: break;
      }
    }
    window.addEventListener("pointerdown", () => { if (sfx.ctx && sfx.ctx.state === "suspended") sfx.ctx.resume().catch(() => { }); }, { capture: true, passive: true });

    // ---- 挂件：说话、闲置小动作、睡觉、看鼠标 ----
    const IDLE_DEF = { on: true, freq: "mid", follow: true, sleepMin: 5, chatter: true, greet: true, lines: "" };
    const idle = { lastInput: Date.now(), timer: 0, sleeping: false, act: "", actT: 0, sayT: 0, lookRaf: 0, looking: false, mx: -1, my: -1, lastSay: Date.now(), lastGreet: 0, holdUntil: 0 };
    const PET_ACTS = ["stretch", "look", "spin", "nod", "hop", "peek"];
    const IDLE_FREQ = { low: 75, mid: 40, high: 18 };   // 平均多少秒做一次小动作
    const LOOK_VARS = ["--agywe-lx", "--agywe-ly", "--agywe-lr", "--agywe-ex", "--agywe-ey"];
    function idleCfg() { return { ...IDLE_DEF, ...((cfg && cfg.petIdle) || {}) }; }
    function petFree() { return !!(pet && pet.root.isConnected && !pet.root.classList.contains("agywe-hold") && !mood.state && agents === 0); }
    function petAct(name, ms) {
      if (!pet) return;
      clearTimeout(idle.actT);
      for (const a of PET_ACTS) pet.root.classList.remove("agywe-act-" + a);
      void pet.root.offsetWidth;
      pet.root.classList.add("agywe-act-" + name);
      idle.act = name;
      idle.actT = setTimeout(() => { if (pet) pet.root.classList.remove("agywe-act-" + name); idle.act = ""; }, ms || 1600);
    }
    function petSay(text, ms, kind) {
      if (buddyReplacing()) { if (text && !mood.state) buddySay(text, ms, kind); return; }
      if (!pet || !text || mood.state) return;
      let b = pet.bubble;
      if (!b || !b.isConnected) { b = document.createElement("div"); b.className = "agywe-bubble"; pet.rig.appendChild(b); pet.bubble = b; }
      if (!b.dataset.agyweSay) { b.dataset.agyweSay = "1"; b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); if (mood.state) clearMood(); else b.classList.remove("show"); }); }
      b.textContent = String(text);
      b.dataset.mood = kind || "talk";
      b.classList.toggle("left", pet.left + petCfg().size / 2 > innerWidth / 2);
      b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
      clearTimeout(idle.sayT);
      idle.sayT = setTimeout(() => { if (!mood.state && pet && pet.bubble === b) b.classList.remove("show"); }, ms || 4500);
    }
    function greetLine() {
      const h = new Date().getHours();
      return h < 5 ? "这么晚还在呀，早点休息～" : h < 11 ? "早上好！" : h < 14 ? "中午好，吃饭了吗？" : h < 18 ? "欢迎回来～" : h < 23 ? "晚上好～" : "夜深了，注意休息哦";
    }
    function randomLine(c) {
      const L = String(c.lines || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const h = new Date().getHours();
      if (h >= 23 || h < 5) L.push("已经很晚了，早点睡吧");
      return L.length ? L[Math.floor(Math.random() * L.length)] : "…";
    }
    function petSleep(hold) {
      if (!pet) return;
      idle.sleeping = true; idle.holdUntil = Date.now() + (hold || 0);
      for (const v of LOOK_VARS) pet.root.style.removeProperty(v);
      pet.root.classList.add("agywe-sleep");
    }
    function petWake(greet) {
      if (!idle.sleeping) return;
      idle.sleeping = false;
      if (pet) pet.root.classList.remove("agywe-sleep");
      const now = Date.now();
      if (greet && idleCfg().greet && now - idle.lastGreet > 20 * 60000) { idle.lastGreet = now; petAct("hop", 1000); petSay(greetLine(), 3500); sfxPlay("pet"); }
    }
    function idleTick() {
      const c = idleCfg();
      if (!c.on || !pet || !cfg || cfg.showButton === false) { if (idle.sleeping) petWake(false); return; }
      const now = Date.now(), quiet = (now - idle.lastInput) / 1000;
      const sleepMin = Number(c.sleepMin) || 0;
      if (!idle.sleeping && sleepMin > 0 && quiet > sleepMin * 60 && petFree() && !(pomo.st && pomo.st.running && pomo.st.phase === "work")) { petSleep(0); return; }
      if (idle.sleeping || !petFree() || idle.act || document.hidden || cfg.lowSpec) return;
      if (Math.random() < 1 / (IDLE_FREQ[c.freq] || 40)) {
        if (c.chatter && Math.random() < .35 && now - idle.lastSay > 90000) { idle.lastSay = now; petSay(randomLine(c), 5000); petAct("nod", 1100); }
        else petAct(PET_ACTS[Math.floor(Math.random() * PET_ACTS.length)], 1700);
      }
    }
    function onAnyInput() { idle.lastInput = Date.now(); if (idle.sleeping && Date.now() > idle.holdUntil) petWake(true); }
    ["keydown", "pointerdown", "wheel"].forEach((t) => window.addEventListener(t, onAnyInput, { capture: true, passive: true }));
    window.addEventListener("pointermove", (e) => {
      idle.mx = e.clientX; idle.my = e.clientY; onAnyInput();
      if (!idle.lookRaf) idle.lookRaf = requestAnimationFrame(petLook);
    }, { capture: true, passive: true });
    function petLookReset() { if (idle.looking && pet) { idle.looking = false; for (const v of LOOK_VARS) pet.root.style.removeProperty(v); } }
    function petLook() {
      idle.lookRaf = 0;
      if (!pet) return;
      const c = idleCfg();
      if (!c.on || !c.follow || (cfg && cfg.lowSpec) || idle.sleeping || idle.mx < 0 || pet.root.classList.contains("agywe-hold")) { petLookReset(); return; }
      const b = pet.doll.getBoundingClientRect();
      const dx = idle.mx - (b.left + b.width / 2), dy = idle.my - (b.top + b.height / 2), d = Math.hypot(dx, dy), R0 = 360;
      if (d > R0 || d < 4) { petLookReset(); return; }
      idle.looking = true;
      const k = 1 - d / R0, ux = dx / d, uy = dy / d, rs = pet.root.style;
      rs.setProperty("--agywe-lx", (ux * 4 * k).toFixed(1) + "px");
      rs.setProperty("--agywe-ly", (uy * 2 * k).toFixed(1) + "px");
      rs.setProperty("--agywe-lr", (clamp(dx / 40, -1, 1) * 7 * k).toFixed(1) + "deg");
      rs.setProperty("--agywe-ex", (ux * 2.2).toFixed(1) + "px");
      rs.setProperty("--agywe-ey", (uy * 1.8).toFixed(1) + "px");
    }
    function applyIdle() {
      if (!idle.timer) idle.timer = setInterval(() => { try { idleTick(); } catch { } }, 1000);
      const c = idleCfg();
      if (!c.on && idle.sleeping) petWake(false);
      if (!c.on || !c.follow) petLookReset();
    }
    function idleTest(a) {
      if (!pet) return;
      if (a === "sleep") { petSleep(3500); return; }
      if (a === "chat") { petSay(randomLine(idleCfg()), 4000); petAct("nod", 1100); return; }
      if (a === "greet") { petSay(greetLine(), 3500); petAct("hop", 1000); return; }
      petAct(PET_ACTS.includes(a) ? a : PET_ACTS[Math.floor(Math.random() * PET_ACTS.length)], 1700);
    }

    // ---- 快捷切换壁纸：上一张 / 下一张 / 随机 / 收藏 / 暂停（真正改配置的是壁纸页，它有令牌）----
    function wallAct(action) {
      if (!frame || !ready) { petSay("壁纸还没准备好，稍等一下～", 2500, "info"); return; }
      post({ type: "agywe:act", action });
    }
    function onWallAct(d) {
      if (d.type === "agywe:switched") {
        if (d.error) { petSay(String(d.error), 3000, "info"); return; }
        sfxPlay("wall");
        if (pet && !mood.state) { petAct("spin", 900); petSay("换成「" + String(d.title || "").slice(0, 24) + "」啦" + (d.total > 1 ? "（" + d.n + "/" + d.total + "）" : ""), 2600, "info"); }
      } else if (d.type === "agywe:faved") { sfxPlay("ui"); petSay(d.on ? "收藏好啦 ★" : "取消收藏了", 2200, "info"); }
      else if (d.type === "agywe:paused") { sfxPlay("ui"); petSay(d.paused ? "壁纸先停一下～" : "壁纸继续动起来！", 2200, "info"); }
    }
    let quickFrame = null;
    function toggleQuick(force) {
      const open = force !== undefined ? force : !(quickFrame && quickFrame.isConnected);
      if (!open) { if (quickFrame) { try { quickFrame.remove(); } catch { } } quickFrame = null; return; }
      if (quickFrame && quickFrame.isConnected) return;
      toggleSettings(false); closeMenu();
      ensureStyle();
      quickFrame = document.createElement("iframe");
      quickFrame.id = "agywe-quick";
      quickFrame.src = ORIGIN + "/quick.html";
      document.documentElement.appendChild(quickFrame);
      toTopLayer(quickFrame);
      sfxPlay("ui");
      setTimeout(() => { try { quickFrame && quickFrame.focus(); } catch { } }, 60);
    }
    // 右键挂件弹出的菜单
    let menuEl = null;
    function closeMenu() { if (menuEl) { try { menuEl.remove(); } catch { } menuEl = null; } }
    function openMenu(x, y) {
      closeMenu();
      const m = document.createElement("div"); m.id = "agywe-menu"; m.setAttribute("role", "menu");
      const s = pomo.st || pomoLoad();
      const items = [
        ["下一张壁纸", hkLabel("next"), () => wallAct("next")],
        ["上一张壁纸", hkLabel("prev"), () => wallAct("prev")],
        ["随机来一张", "", () => wallAct("random")],
        ["快速切换…", hkLabel("quick"), () => toggleQuick(true)],
        ["收藏 / 取消收藏这张", "", () => wallAct("fav")],
        null,
        [s.running ? "暂停番茄钟" : pomoActive(s) ? "继续番茄钟" : "开始专注 " + phaseMin("work") + " 分钟", hkLabel("pomo"), () => pomoOp("toggle")],
        ...(pomoActive(s) ? [["重置番茄钟", "", () => pomoOp("reset")]] : []),
        [cfg && cfg.paused ? "继续播放壁纸" : "暂停壁纸", "", () => wallAct("pause")],
        null,
        [noise.playing ? "停止白噪音（" + NOISE_LABEL[noise.type] + "）" : "白噪音：" + NOISE_LABEL[noiseCfg().type] + " ▶", "", () => noiseOp("toggle")],
        ["今天做了多少", "", () => sayStats()],
        [useCfg().mode === "card" ? "收起用量卡片" : "展开用量卡片", "", () => toggleUseCard()],
        ...(buddyActive() ? [["让桌宠休息一下", "", () => buddyHide()]] : []),
        null,
        ["隐藏壁纸和挂件", hkLabel("hide"), () => setHideAll(true)],
        ["打开设置", hkLabel("settings"), () => toggleSettings(true)]
      ];
      for (const it of items) {
        if (!it) { m.appendChild(document.createElement("hr")); continue; }
        const b = document.createElement("button"); b.setAttribute("role", "menuitem");
        const t = document.createElement("span"); t.textContent = it[0]; b.appendChild(t);
        if (it[1]) { const k = document.createElement("kbd"); k.textContent = it[1]; b.appendChild(k); }
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); try { it[2](); } catch { } });
        m.appendChild(b);
      }
      m.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
      document.documentElement.appendChild(m);
      toTopLayer(m);
      const r = m.getBoundingClientRect();
      m.style.setProperty("left", clamp(x, 6, Math.max(6, innerWidth - r.width - 6)) + "px", "important");
      m.style.setProperty("top", clamp(y, 6, Math.max(6, innerHeight - r.height - 6)) + "px", "important");
      menuEl = m;
      sfxPlay("ui");
    }
    window.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, { capture: true, passive: true });
    window.addEventListener("blur", () => closeMenu());
    let wheelAt = 0;
    function bindPetExtras() {
      const { doll, sway, rig } = pet;
      try { bindPat(doll); } catch { }
      doll.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX + 4, e.clientY + 4); });
      doll.addEventListener("wheel", (e) => {
        if (!cfg || cfg.petWheel === false) return;
        e.preventDefault(); e.stopPropagation();
        const now = Date.now(); if (now - wheelAt < 650) return; wheelAt = now;
        wallAct(e.deltaY > 0 ? "next" : "prev");
      }, { passive: false });
      const badge = document.createElement("div"); badge.className = "agywe-badge"; sway.appendChild(badge); pet.badge = badge;
      const z = document.createElement("div"); z.className = "agywe-zzz";
      for (const ch of ["z", "z", "Z"]) { const i = document.createElement("i"); i.textContent = ch; z.appendChild(i); }
      rig.appendChild(z); pet.zzz = z;
      if (idle.sleeping) pet.root.classList.add("agywe-sleep");
      renderPomoBadge();
    }
    function onHotkey(a) {
      if (a === "quick") toggleQuick();
      else if (a === "next" || a === "prev") wallAct(a);
      else if (a === "pomo") pomoOp("toggle", true);
      else if (a === "hide") setHideAll(!hideAll);
    }

    // ---- 打字特效：从光标处冒火花 / 彩纸 / 爱心 / 字，输入框轻震、连击计数、打字声 ----
    const tfx = { combo: 0, comboT: 0, comboEl: null, mirror: null };
    function typeFxOn() { const s = sfxCfg(); return !!(cfg && !hideAll && ((cfg.typeFx && cfg.typeFx !== "none") || cfg.typeShake || cfg.typeCombo || (s.on && s.typing))); }
    // 文本框里光标的位置：用一个看不见的影子元素量（放在 shadow root 里，不会惊动页面的 MutationObserver）
    function mirrorEl() {
      if (tfx.mirror && tfx.mirror.isConnected) return tfx.mirror;
      const h = document.createElement("div"); h.id = "agywe-mirror";
      h.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:visible;";
      const sr = h.attachShadow({ mode: "open" });
      const m = document.createElement("div"); sr.appendChild(m);
      document.documentElement.appendChild(h);
      tfx.mirror = m;
      return m;
    }
    function textareaCaret(ta) {
      const b = ta.getBoundingClientRect();
      try {
        const cs = getComputedStyle(ta), m = mirrorEl();
        for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize", "textIndent"]) m.style[p] = cs[p];
        m.style.whiteSpace = ta.tagName === "INPUT" ? "pre" : "pre-wrap"; m.style.overflowWrap = "break-word"; m.style.position = "absolute"; m.style.left = "0"; m.style.top = "0";
        m.textContent = String(ta.value || "").slice(0, ta.selectionEnd || 0);
        const sp = document.createElement("span"); sp.textContent = "\u200b"; m.appendChild(sp);
        const mb = m.getBoundingClientRect(), sb = sp.getBoundingClientRect();
        return { x: b.left + (sb.left - mb.left) - ta.scrollLeft, y: b.top + (sb.top - mb.top) - ta.scrollTop + (sb.height || 16) / 2 };
      } catch { return { x: b.left + 24, y: b.top + Math.min(b.height / 2, 18) }; }
    }
    function caretPoint(field) {
      try {
        const sel = document.getSelection();
        if (sel && sel.rangeCount && field.contains(sel.anchorNode)) {
          const r = sel.getRangeAt(0).cloneRange(); r.collapse(false);
          const rc = r.getClientRects()[0] || r.getBoundingClientRect();
          if (rc && (rc.left || rc.top)) return { x: rc.right || rc.left, y: rc.top + (rc.height || 16) / 2 };
          const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
          if (n) { const nb = n.getBoundingClientRect(); return { x: nb.left + 4, y: nb.top + Math.min(nb.height, 20) / 2 }; }
        }
      } catch { }
      const b = field.getBoundingClientRect();
      return { x: b.left + Math.min(Math.max(8, b.width - 8), 24), y: b.top + Math.min(b.height / 2, 18) };
    }
    function shakeField(f) {
      let box = f; try { box = f.closest('[data-agywe-glass="field"]') || f; } catch { }
      if (!box || typeof box.animate !== "function") return;
      const a = 1.6 + R() * 1.4, dx = (R() - .5) * 2 * a, dy = (R() - .5) * 2 * a;
      try { box.animate([{ translate: "0 0" }, { translate: dx.toFixed(1) + "px " + dy.toFixed(1) + "px" }, { translate: "0 0" }], { duration: 110, easing: "ease-out" }); } catch { }
    }
    function comboAt(x, y, del) {
      tfx.combo = del ? Math.max(0, tfx.combo - 1) : tfx.combo + 1;
      let el = tfx.comboEl;
      if (!el || !el.isConnected) { el = document.createElement("div"); el.id = "agywe-combo"; document.documentElement.appendChild(el); toTopLayer(el); tfx.comboEl = el; }
      el.textContent = tfx.combo > 1 ? "×" + tfx.combo : "";
      el.style.setProperty("left", Math.round(clamp(x + 14, 4, innerWidth - 80)) + "px", "important");
      el.style.setProperty("top", Math.round(clamp(y - 38, 4, innerHeight - 30)) + "px", "important");
      el.style.setProperty("--agywe-cs", String(1 + Math.min(1, tfx.combo / 80)));
      el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
      clearTimeout(tfx.comboT);
      tfx.comboT = setTimeout(() => { tfx.combo = 0; if (tfx.comboEl) tfx.comboEl.textContent = ""; }, 1600);
      if (!del && tfx.combo > 0 && tfx.combo % 50 === 0) {
        if (fx.cv) for (let i = 0; i < 18; i++) { const a = R() * Math.PI * 2, v = 2 + R() * 3.5; fxSpawn({ t: "star", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .06, life: 0, max: 40 + R() * 16, col: fxColor(), s: 3 + R() * 3, rot: R() * 6, vr: (R() - .5) * .3 }); }
        petSay("连击 ×" + tfx.combo + "！太快了吧", 2200, "info");
      }
    }
    function typeBurst(x, y, ch, del, field) {
      const low = !!(cfg && cfg.lowSpec);
      const kind = low ? "none" : (cfg && cfg.typeFx) || "none";
      if (kind !== "none" && fx.cv && fx.ctx) {
        if (del) { for (let i = 0; i < 4; i++) fxSpawn({ t: "dot", x, y, vx: (R() - .5) * 2, vy: (R() - .5) * 2, g: .05, life: 0, max: 16, col: "rgba(160,160,172,.9)", s: 1.6 }); }
        else if (kind === "spark") { for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (R() - .5) * 2.2, v = 1.2 + R() * 2.6; fxSpawn({ t: "star", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .09, life: 0, max: 22 + R() * 12, col: fxColor(), s: 2 + R() * 2, rot: R() * 6, vr: (R() - .5) * .3 }); } }
        else if (kind === "confetti") { for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (R() - .5) * 2, v = 1.5 + R() * 2.5; fxSpawn({ t: "petal", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .1, life: 0, max: 40 + R() * 16, col: "hsl(" + Math.floor(R() * 360) + ",90%,65%)", s: 3 + R() * 2, rot: R() * 6, vr: (R() - .5) * .5 }); } }
        else if (kind === "heart") { fxSpawn({ t: "heart", x: x + (R() - .5) * 8, y, vx: (R() - .5) * .8, vy: -1 - R(), g: -.01, life: 0, max: 38, col: cfg.fxRainbow ? fxColor() : "#ff7aa8", s: 5 + R() * 3, rot: (R() - .5) * .6, vr: 0 }); }
        else if (kind === "char") {
          if (ch) fxSpawn({ t: "text", x, y: y - 4, vx: (R() - .5) * .7, vy: -1.5 - R() * .6, g: .025, life: 0, max: 46, col: fxColor(), s: 17, ch: ch.slice(-4), rot: (R() - .5) * .3, vr: (R() - .5) * .02 });
          else for (let i = 0; i < 3; i++) fxSpawn({ t: "dot", x, y, vx: (R() - .5) * 1.5, vy: -R() * 1.5, g: .04, life: 0, max: 18, col: fxColor(), s: 1.6 });
        }
      }
      if (!low && cfg && cfg.typeShake && field && !del) shakeField(field);
      if (!low && cfg && cfg.typeCombo) comboAt(x, y, del);
      sfxPlay("typing", { del });
    }
    // v0.9：代码编辑器（Monaco / CodeMirror / Ace）和终端（xterm）里打字默认不放特效
    const CODE_SEL = '.monaco-editor, .cm-editor, .CodeMirror, .ace_editor, .xterm, .terminal, [class*="xterm"], [class*="monaco-"], [data-mode-id]';
    function isCodeField(f) {
      try {
        const c = f.classList;
        if (c && (c.contains("inputarea") || c.contains("xterm-helper-textarea") || c.contains("ace_text-input") || c.contains("cm-content"))) return true;
        return !!f.closest(CODE_SEL);
      } catch { return false; }
    }
    function onTypeInput(e) {
      if (!typeFxOn() || pick) return;
      const t = e.target; if (!t || !t.closest || isOurs(t)) return;
      let f = null; try { f = t.closest(FIELD_SEL) || (t.tagName === "INPUT" && /^(text|search|)$/i.test(t.type || "") ? t : null); } catch { }
      if (!f) return;
      if (cfg && cfg.typeFxCode !== true && isCodeField(f)) return;
      const it = String(e.inputType || "");
      if (e.type === "input" && (it === "insertCompositionText" || e.isComposing)) return;   // 输入法拼写中：等上屏再放
      const del = it.startsWith("delete");
      const ch = del ? "" : String(e.data || "").replace(/\s+/g, "");
      requestAnimationFrame(() => {
        try {
          const p = f.tagName === "TEXTAREA" || f.tagName === "INPUT" ? textareaCaret(f) : caretPoint(f);
          typeBurst(p.x, p.y, ch, del, f);
        } catch { }
      });
    }
    window.addEventListener("input", onTypeInput, { capture: true, passive: true });
    window.addEventListener("compositionend", onTypeInput, { capture: true, passive: true });

    // ---- 小组件：迷你播放器 + 番茄钟，叠在一个可以拖动的小坞里 ----
    const dock = { root: null, player: null, pomoCard: null, npT: 0, polling: false, artKey: -1, drag: null, pos: null, pomoHidden: false, npErr: 0 };
    const DOCK_KEY = "agywe:dock-pos";
    function dockPos() { try { const v = JSON.parse(localStorage.getItem(DOCK_KEY) || "null"); if (v && isFinite(v.r) && isFinite(v.b)) return v; } catch { } return { r: 18, b: 118 }; }
    function placeDock() {
      if (!dock.root || !dock.root.isConnected) return;
      const p = dock.pos || (dock.pos = dockPos());
      const w = dock.root.offsetWidth || 260, h = dock.root.offsetHeight || 60;
      dock.root.style.setProperty("right", clamp(p.r, 4, Math.max(4, innerWidth - w - 4)) + "px", "important");
      dock.root.style.setProperty("bottom", clamp(p.b, 4, Math.max(4, innerHeight - h - 4)) + "px", "important");
    }
    function ensureDock() {
      if (dock.root && dock.root.isConnected) { toTopLayer(dock.root); return dock.root; }
      const r = document.createElement("div"); r.id = "agywe-dock";
      document.documentElement.appendChild(r);
      dock.root = r; dock.player = null; dock.pomoCard = null;
      bindDockDrag(r);
      toTopLayer(r);
      placeDock();
      return r;
    }
    function bindDockDrag(r) {
      r.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !e.target.closest || e.target.closest("button, input, textarea, [contenteditable='true'], .agywe-tt")) return;
        const card = e.target.closest(".agywe-card"); if (!card) return;
        const p = dock.pos || dockPos();
        dock.drag = { x: e.clientX, y: e.clientY, r: p.r, b: p.b, moved: false };
        try { card.setPointerCapture(e.pointerId); } catch { }
      });
      r.addEventListener("pointermove", (e) => {
        const d = dock.drag; if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true; r.classList.add("agywe-dragging");
        dock.pos = { r: d.r - dx, b: d.b - dy }; placeDock();
      });
      const end = () => {
        const d = dock.drag; dock.drag = null; r.classList.remove("agywe-dragging");
        if (d && d.moved) { const p = dock.pos; dock.pos = { r: clamp(p.r, 4, innerWidth - 60), b: clamp(p.b, 4, innerHeight - 40) }; try { localStorage.setItem(DOCK_KEY, JSON.stringify(dock.pos)); } catch { } placeDock(); }
      };
      r.addEventListener("pointerup", end); r.addEventListener("pointercancel", end);
    }
    const ICON = {
      prev: "M6 5h2v14H6zM20 5v14L9.5 12z", next: "M16 5h2v14h-2zM4 5v14l10.5-7z", play: "M7 4.5v15l12.5-7.5z",
      pause: "M6.5 5h4v14h-4zM13.5 5h4v14h-4z", skip: "M5 5v14l9-7zM15 5h3v14h-3z",
      reset: "M12 5V2L7.5 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z"
    };
    function dockIcon(name) { return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [svgEl("path", { d: ICON[name] })]); }
    function dockBtn(name, title, fn) {
      const b = document.createElement("button"); b.title = title; b.appendChild(dockIcon(name));
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      return b;
    }
    function setIcon(b, name) { b.textContent = ""; b.appendChild(dockIcon(name)); }
    const fmtT = (s) => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

    // 迷你播放器：歌曲信息走主进程（Windows 媒体控制），这里每秒问一次
    function playerMode() { const m = cfg && cfg.miniPlayer; return m === "off" || m === "pill" ? m : "card"; }
    function playerWanted() { return !!(cfg && cfg.nowPlaying !== false && playerMode() !== "off"); }
    function removePlayer() { if (dock.player) { try { dock.player.el.remove(); } catch { } dock.player = null; dock.artKey = -1; } }
    function npCtl(action) {
      sfxPlay("ui");
      ipcRenderer.invoke("agywe:np-control", action).catch(() => { }).finally(() => setTimeout(npPoll, 350));
    }
    function setPlayerMode(m) {
      if (cfg) cfg.miniPlayer = m;
      post({ type: "agywe:save-cfg", patch: { miniPlayer: m } });
      if (dock.player) dock.player.el.classList.toggle("pill", m === "pill");
      setTimeout(placeDock, 60);
    }
    function buildPlayer() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-np";
      const art = document.createElement("div"); art.className = "agywe-art";
      const meta = document.createElement("div"); meta.style.minWidth = "0";
      const ti = document.createElement("div"); ti.className = "agywe-ti";
      const ar = document.createElement("div"); ar.className = "agywe-ar";
      const ctl = document.createElement("div"); ctl.className = "agywe-ctl";
      const bPlay = dockBtn("play", "播放 / 暂停", () => npCtl("playPause"));
      const bar = document.createElement("div"); bar.className = "agywe-bar"; const fill = document.createElement("i"); bar.appendChild(fill);
      const tm = document.createElement("span"); tm.className = "agywe-tm";
      ctl.append(dockBtn("prev", "上一首", () => npCtl("skipPrevious")), bPlay, dockBtn("next", "下一首", () => npCtl("skipNext")), bar, tm);
      meta.append(ti, ar, ctl);
      const x = document.createElement("button"); x.className = "agywe-x"; x.textContent = "✕"; x.title = "收成小胶囊（双击卡片也能切换）";
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setPlayerMode("pill"); });
      el.append(art, meta, x);
      el.addEventListener("dblclick", (e) => { if (e.target.closest && e.target.closest("button")) return; setPlayerMode(playerMode() === "pill" ? "card" : "pill"); });
      return { el, art, ti, ar, bPlay, fill, tm, playing: null };
    }
    function renderPlayer(st) {
      const has = !!(st && st.hasMedia && (st.title || st.artist));
      if (!has && (cfg.miniHideIdle !== false || (st && st.off))) { if (dock.player) { removePlayer(); placeDock(); } return; }
      ensureDock();
      let p = dock.player;
      if (!p || !p.el.isConnected) { p = buildPlayer(); dock.player = p; dock.root.appendChild(p.el); dock.artKey = -1; }
      p.el.classList.toggle("pill", playerMode() === "pill");
      const title = has ? (st.title || "（无标题）") : "没有在播放";
      const artist = has ? [st.artist, st.album].filter(Boolean).join(" · ") : "放首歌试试～";
      if (p.ti.textContent !== title) { p.ti.textContent = title; p.ti.title = title; }
      if (p.ar.textContent !== artist) p.ar.textContent = artist;
      const playing = has && st.state === 1;
      if (p.playing !== playing) { p.playing = playing; setIcon(p.bPlay, playing ? "pause" : "play"); p.el.classList.toggle("paused", !playing); }
      const dur = Number(st && st.duration) || 0, pos = Number(st && st.position) || 0;
      p.fill.style.width = dur > 0 ? clamp(pos / dur * 100, 0, 100).toFixed(1) + "%" : "0%";
      p.tm.textContent = dur > 0 ? fmtT(pos) : "";
      const key = has ? Number(st.artKey) || 0 : 0;
      if (key !== dock.artKey) {
        dock.artKey = key;
        if (!key) p.art.style.backgroundImage = "";
        else ipcRenderer.invoke("agywe:np-art").then((u) => { if (dock.player === p && dock.artKey === key) p.art.style.backgroundImage = u ? 'url("' + u + '")' : ""; }).catch(() => { });
      }
      placeDock();
    }
    async function npPoll() {
      clearTimeout(dock.npT);
      if (!playerWanted()) { dock.polling = false; if (dock.player) { removePlayer(); placeDock(); } return; }
      let st = null;
      try { st = await ipcRenderer.invoke("agywe:np"); }
      catch (e) { st = null; if (!dock.npErr++) diagLite("np-ipc-failed", { error: String(e && e.message || e).slice(0, 200) }); }
      try { renderPlayer(st); } catch (e) { lastErr = String(e && e.message || e); }
      if (!playerWanted()) { dock.polling = false; return; }
      dock.npT = setTimeout(npPoll, document.hidden ? 5000 : st && st.hasMedia ? 1000 : 3000);
    }

    // 番茄钟：状态存在 localStorage 里，几个窗口共用一份，到点只响一次
    const POMO_DEF = { show: "auto", work: 25, short: 5, long: 15, every: 4, autoNext: false, overlay: true, badge: true, notify: true, workEndText: "专注结束，休息一下吧～", breakEndText: "休息好啦，继续加油！" };
    const POMO_KEY = "agywe:pomo";
    const PH_LABEL = { work: "专注", short: "短休息", long: "长休息" };
    const REST_TIPS = ["站起来走两步，活动一下肩膀", "看看窗外远处，让眼睛放松 20 秒", "喝口水吧", "深呼吸三次", "伸个懒腰，转转脖子"];
    const pomo = { st: null, t: 0, overlay: null };
    function pomoCfg() { return { ...POMO_DEF, ...((cfg && cfg.pomo) || {}) }; }
    function pomoFresh() { return { phase: "work", running: false, endAt: 0, remain: 0, round: 0 }; }
    function pomoLoad() {
      try { const s = JSON.parse(localStorage.getItem(POMO_KEY) || "null"); if (s && typeof s === "object" && PH_LABEL[s.phase]) return s; } catch { }
      return pomoFresh();
    }
    function pomoSave() { try { localStorage.setItem(POMO_KEY, JSON.stringify(pomo.st)); } catch { } }
    function phaseMin(ph) { const c = pomoCfg(); return clamp(Number(ph === "work" ? c.work : ph === "long" ? c.long : c.short) || 1, 1, 180); }
    function pomoLeft() { const s = pomo.st; if (!s) return 0; return s.running ? Math.max(0, s.endAt - Date.now()) : (s.remain > 0 ? s.remain : phaseMin(s.phase) * 60000); }
    function pomoActive(s) { s = s || pomo.st; return !!(s && (s.running || s.remain > 0 || s.phase !== "work")); }
    function pomoShowMode() { const v = pomoCfg().show; return v === "always" || v === "off" ? v : "auto"; }
    function pomoStart() { const s = pomo.st; s.endAt = Date.now() + pomoLeft(); s.running = true; s.remain = 0; dock.pomoHidden = false; pomoSave(); pomoSync(); }
    function pomoPause() { const s = pomo.st; if (!s.running) return; s.remain = Math.max(1000, s.endAt - Date.now()); s.running = false; pomoSave(); pomoSync(); }
    function pomoReset() { pomo.st = pomoFresh(); hideRest(); pomoSave(); pomoSync(); }
    function pomoNextPhase(fromEnd) {
      const s = pomo.st, c = pomoCfg();
      if (s.phase === "work") { s.round = (s.round || 0) + 1; s.phase = s.round % clamp(Number(c.every) || 4, 1, 12) === 0 ? "long" : "short"; }
      else s.phase = "work";
      s.remain = 0; s.running = false; s.endAt = 0;
      if (fromEnd && c.autoNext) { s.endAt = Date.now() + phaseMin(s.phase) * 60000; s.running = true; }
      pomoSave(); pomoSync();
    }
    function pomoFire() {
      const s = pomo.st, c = pomoCfg();
      const wasWork = s.phase === "work", tag = String(s.endAt);
      let first = true;
      try { if (localStorage.getItem("agywe:pomo-fired") === tag) first = false; else localStorage.setItem("agywe:pomo-fired", tag); } catch { }
      pomoNextPhase(true);
      if (!first) return;
      const text = wasWork ? c.workEndText : c.breakEndText;
      if (wasWork) { try { ipcRenderer.send("agywe:stat", { type: "pomo", min: phaseMin("work") }); } catch { } }
      sfxPlay("pomo", { kind: wasWork ? "work" : "break" });
      petAct("hop", 1000);
      petSay(text, 8000, wasWork ? "rest" : "go");
      if (c.notify !== false && !document.hasFocus()) { try { ipcRenderer.send("agywe:notify", { title: wasWork ? "🍅 专注结束" : "☕ 休息结束", body: text }); } catch { } }
      if (wasWork && c.overlay !== false) showRest();
    }
    function pomoOp(op, say) {
      pomo.st = pomo.st || pomoLoad();
      if (op === "toggle") { if (pomo.st.running) pomoPause(); else pomoStart(); }
      else if (op === "start") pomoStart();
      else if (op === "pause") pomoPause();
      else if (op === "reset") pomoReset();
      else if (op === "skip") { pomoNextPhase(false); hideRest(); }
      else return;
      sfxPlay("ui");
      if (say || op === "toggle" || op === "start" || op === "reset") {
        const s = pomo.st;
        petSay(s.running ? (s.phase === "work" ? "开始专注 " + Math.ceil(pomoLeft() / 60000) + " 分钟，加油！" : "休息时间～") : op === "reset" ? "番茄钟重置了" : "番茄钟暂停", 2600, s.phase === "work" ? "rest" : "go");
      }
    }
    function removePomoCard() { if (dock.pomoCard) { try { dock.pomoCard.el.remove(); } catch { } dock.pomoCard = null; } }
    function buildPomoCard() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-pomo";
      const C = 2 * Math.PI * 17;
      const fg = svgEl("circle", { class: "fg", cx: 21, cy: 21, r: 17, "stroke-dasharray": C.toFixed(2), "stroke-dashoffset": "0" });
      const em = svgEl("text", { x: 21, y: 22 }); em.textContent = "🍅";
      const ring = svgEl("svg", { class: "agywe-ring", viewBox: "0 0 42 42", "aria-hidden": "true" }, [svgEl("circle", { class: "bg", cx: 21, cy: 21, r: 17 }), fg, em]);
      const pt = document.createElement("div"); pt.className = "agywe-pt";
      const ph = document.createElement("div"); ph.className = "agywe-ph";
      const time = document.createElement("div"); time.className = "agywe-time";
      pt.append(ph, time);
      const bs = document.createElement("div"); bs.className = "agywe-btns";
      const bPlay = dockBtn("play", "开始 / 暂停（Ctrl+Alt+P）", () => pomoOp("toggle"));
      bs.append(bPlay, dockBtn("skip", "跳到下一段", () => pomoOp("skip")), dockBtn("reset", "重置", () => pomoOp("reset")));
      const x = document.createElement("button"); x.className = "agywe-x"; x.textContent = "✕"; x.title = "收起卡片（计时会继续，挂件上能看到剩余时间）";
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock.pomoHidden = true; pomoSync(); });
      el.append(ring, pt, bs, x);
      return { el, fg, em, ph, time, bPlay, C, playing: null };
    }
    function renderPomoCard() {
      const s = pomo.st, mode = pomoShowMode();
      const want = !!(cfg && s && mode !== "off" && !dock.pomoHidden && (mode === "always" || pomoActive(s)));
      if (!want) { if (dock.pomoCard) { removePomoCard(); placeDock(); } return; }
      ensureDock();
      let p = dock.pomoCard;
      if (!p || !p.el.isConnected) { p = buildPomoCard(); dock.pomoCard = p; dock.root.insertBefore(p.el, dock.root.firstChild); }
      const brk = s.phase !== "work", left = pomoLeft(), total = phaseMin(s.phase) * 60000;
      const every = clamp(Number(pomoCfg().every) || 4, 1, 12);
      p.el.classList.toggle("brk", brk);
      p.time.textContent = fmtT(Math.ceil(left / 1000));
      p.ph.textContent = (s.running ? "" : pomoActive(s) ? "已暂停 · " : "") + PH_LABEL[s.phase] + (brk ? "" : " · 第 " + ((s.round || 0) % every + 1) + "/" + every + " 个");
      p.fg.setAttribute("stroke-dashoffset", (p.C * (1 - clamp(left / total, 0, 1))).toFixed(2));
      p.em.textContent = brk ? "☕" : "🍅";
      if (p.playing !== !!s.running) { p.playing = !!s.running; setIcon(p.bPlay, s.running ? "pause" : "play"); }
      placeDock();
    }
    function renderPomoBadge() {
      if (!pet || !pet.badge) return;
      const s = pomo.st || pomoLoad(), c = pomoCfg();
      const on = !!(cfg && c.badge !== false && pomoShowMode() !== "off" && pomoActive(s));
      pet.badge.classList.toggle("on", on);
      if (!on) return;
      pet.badge.classList.toggle("brk", s.phase !== "work");
      pet.badge.classList.toggle("paused", !s.running);
      pet.badge.textContent = (s.phase === "work" ? "🍅 " : "☕ ") + fmtT(Math.ceil(pomoLeft() / 1000));
    }
    function showRest() {
      hideRest();
      const o = document.createElement("div"); o.id = "agywe-rest";
      const box = document.createElement("div"); box.className = "agywe-rbox";
      const em = document.createElement("div"); em.className = "agywe-remoji"; em.textContent = "☕";
      const t = document.createElement("div"); t.className = "agywe-rtitle"; t.textContent = pomoCfg().workEndText || "休息一下吧";
      const tm = document.createElement("div"); tm.className = "agywe-rtime";
      const tip = document.createElement("div"); tip.className = "agywe-rtip"; tip.textContent = REST_TIPS[Math.floor(Math.random() * REST_TIPS.length)];
      const bs = document.createElement("div"); bs.className = "agywe-rbtns";
      const bGo = document.createElement("button"); bGo.className = "pri";
      const bSkip = document.createElement("button"); bSkip.textContent = "跳过休息";
      const bHide = document.createElement("button"); bHide.textContent = "收起";
      bGo.addEventListener("click", () => { if (pomo.st && pomo.st.running) hideRest(); else pomoOp("start"); });
      bSkip.addEventListener("click", () => pomoOp("skip"));
      bHide.addEventListener("click", () => hideRest());
      bs.append(bGo, bSkip, bHide);
      box.append(em, t, tm, tip, bs); o.appendChild(box);
      document.documentElement.appendChild(o); toTopLayer(o);
      pomo.overlay = { el: o, tm, bGo };
      renderRest();
    }
    function hideRest() { if (pomo.overlay) { try { pomo.overlay.el.remove(); } catch { } pomo.overlay = null; } }
    function renderRest() {
      const o = pomo.overlay; if (!o) return;
      const s = pomo.st;
      if (!s || s.phase === "work") { hideRest(); return; }
      o.tm.textContent = fmtT(Math.ceil(pomoLeft() / 1000));
      o.bGo.textContent = s.running ? "好的" : "开始休息";
    }
    function pomoSync() {
      pomo.st = pomo.st || pomoLoad();
      const s = pomo.st;
      if (s.running && Date.now() - s.endAt > 60000) { pomoNextPhase(false); return; }   // 关着 Antigravity 的时候早就到点了：不补响
      try { renderPomoCard(); } catch (e) { lastErr = String(e && e.message || e); }
      renderPomoBadge();
      renderRest();
      clearInterval(pomo.t); pomo.t = 0;
      if (s.running) pomo.t = setInterval(pomoTick, 1000);
      try { noisePomoSync(); } catch { }
    }
    function pomoTick() {
      const s = pomo.st;
      if (!s || !s.running) { clearInterval(pomo.t); pomo.t = 0; return; }
      if (Date.now() >= s.endAt) { clearInterval(pomo.t); pomo.t = 0; if (Date.now() - s.endAt > 60000) pomoNextPhase(false); else pomoFire(); return; }
      try { renderPomoCard(); } catch { }
      renderPomoBadge(); renderRest();
    }
    window.addEventListener("storage", (e) => { if (e.key === POMO_KEY) { pomo.st = pomoLoad(); pomoSync(); } });
    function applyDock() {
      if (playerWanted()) { if (!dock.polling) { dock.polling = true; npPoll(); } }
      else { dock.polling = false; clearTimeout(dock.npT); if (dock.player) { removePlayer(); placeDock(); } }
      if (dock.player) dock.player.el.classList.toggle("pill", playerMode() === "pill");
      pomoSync();
      try { renderClock(); } catch (e) { lastErr = String(e && e.message || e); }
      renderWidgets();
    }
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (menuEl) { closeMenu(); e.preventDefault(); }
      else if (pomo.overlay) { hideRest(); e.preventDefault(); }
    }, true);


    // =====================================================================
    // v0.8：一键隐藏 · 自动对比度 · 省电 · 时钟
    // =====================================================================
    function toast(msg, ms) {
      try {
        let t = document.getElementById("agywe-toast");
        if (!t || !t.isConnected) { t = document.createElement("div"); t.id = "agywe-toast"; document.documentElement.appendChild(t); }
        t.textContent = msg;
        toTopLayer(t);
        clearTimeout(toast.t);
        toast.t = setTimeout(() => { try { t.remove(); } catch { } }, ms || 2600);
      } catch { }
    }
    function setHideAll(v, quiet) {
      hideAll = !!v;
      try { sessionStorage.setItem("agywe:hideall", hideAll ? "1" : "0"); } catch { }
      document.documentElement.classList.toggle("agywe-hideall", hideAll);
      if (hideAll) { closeMenu(); toggleQuick(false); toggleSettings(false); try { noiseStop(); ccHide(); removeJump(); } catch { } }
      post({ type: "agywe:hideall", on: hideAll });
      if (cfg) applyCfg(cfg);
      if (!quiet) {
        toast(hideAll ? "已临时隐藏壁纸和插件界面" + (hkLabel("hide") ? "，再按 " + hkLabel("hide") + " 恢复" : "，到设置里关掉恢复") : "壁纸回来啦");
        try { sfxPlay("ui"); } catch { }
      }
      diagLite("hide-all", { on: hideAll });
    }

    // ---- 自动对比度：按壁纸的暗部 / 亮部，算出背板至少要多厚，字才看得清 ----
    const contrast = { on: false, need: false, ratio: null, target: 4.5, base: null, panel: null, content: null, chip: null };
    const linC = (v) => { v = clamp(v, 0, 255) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const relLum = (c) => 0.2126 * linC(c[0]) + 0.7152 * linC(c[1]) + 0.0722 * linC(c[2]);
    const cRatio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    function contrastAt(alpha, wall, tint, text) { return cRatio([0, 1, 2].map((i) => tint[i] * alpha + wall[i] * (1 - alpha)), text); }
    function alphaFor(a0, wall, tint, text, target) {
      a0 = clamp(Number(a0) || 0, 0, 1);
      if (contrastAt(a0, wall, tint, text) >= target) return a0;
      for (let a = Math.ceil(a0 * 100) / 100; a <= 0.95; a += 0.01) if (contrastAt(a, wall, tint, text) >= target) return Math.round(a * 100) / 100;
      return 0.95;
    }
    function applyContrast() {
      const root = document.documentElement; if (!root || !cfg) return;
      const base = { panel: Number(cfg.panelOpacity ?? .55), content: Number(cfg.contentOpacity ?? .3), chip: Number(cfg.bubbleOpacity ?? .45) };
      const VAR = { panel: "--agywe-alpha", content: "--agywe-content", chip: "--agywe-chip" };
      const on = !!(ready && cfg.enabled && !hideAll && cfg.autoContrast !== false && palette && isFinite(palette.lo) && isFinite(palette.hi) && darkText != null);
      contrast.on = on; contrast.base = base;
      if (!on) {
        for (const k in base) root.style.setProperty(VAR[k], String(base[k]));
        contrast.need = false; contrast.ratio = null; contrast.panel = contrast.content = contrast.chip = null;
        sendContrast(); return;
      }
      const target = clamp(Number(cfg.contrastTarget) || 4.5, 2, 10);
      // 字是深色 → 怕壁纸里暗的地方；字是浅色 → 怕亮的地方
      const wl = darkText ? palette.lo : palette.hi;
      const d = clamp(Number(cfg.dim) || 0, 0, 0.9), dm = cfg.dimMode || "auto";
      const lighten = dm === "lighten" || (dm === "auto" && darkText);
      const w0 = lighten ? wl * (1 - d) + 255 * d : wl * (1 - d);
      const wall = [w0, w0, w0];
      let tint = null;
      if (root.classList.contains("agywe-tint")) {
        const t = String(root.style.getPropertyValue("--agywe-tint") || "").split(",").map(Number);
        if (t.length === 3 && t.every(isFinite)) tint = t;
      }
      if (!tint) tint = darkText ? [244, 242, 238] : [24, 25, 31];
      const text = textRgb || (darkText ? [28, 28, 32] : [236, 238, 242]);
      const out = {};
      for (const k in base) { out[k] = Math.max(base[k], alphaFor(base[k], wall, tint, text, target)); root.style.setProperty(VAR[k], String(out[k])); }
      contrast.target = target;
      contrast.ratio = contrastAt(base.content, wall, tint, text);
      contrast.need = out.content > base.content + 0.004 || out.panel > base.panel + 0.004 || out.chip > base.chip + 0.004;
      contrast.panel = out.panel; contrast.content = out.content; contrast.chip = out.chip;
      contrast.dark = !!darkText;
      sendContrast();
    }
    function sendContrast() {
      try { if (settingsFrame && settingsFrame.contentWindow) settingsFrame.contentWindow.postMessage({ type: "agywe:contrast", c: { ...contrast } }, ORIGIN); } catch { }
    }

    // ---- 省电：拔掉电源时告诉壁纸页 ----
    let onBattery = false;
    function powerSync() { post({ type: "agywe:power", battery: onBattery }); }
    try { ipcRenderer.invoke("agywe:power-get").then((r) => { onBattery = !!(r && r.battery); powerSync(); }).catch(() => { }); } catch { }
    try {
      ipcRenderer.on("agywe:power", (_e, r) => {
        const was = onBattery; onBattery = !!(r && r.battery); powerSync();
        const mode = ((cfg && cfg.battery) || {}).mode || "fps";
        if (was !== onBattery && mode !== "none" && cfg && cfg.enabled && !hideAll) {
          try { petSay(onBattery ? (mode === "pause" ? "拔掉电源了，壁纸先停一下省电～" : "拔掉电源了，壁纸降低帧率省电～") : "接上电源啦，壁纸恢复正常", 2800, "info"); } catch { }
        }
      });
    } catch { }

    // ---- 时钟小组件 ----
    const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    function clockCfg() { return { show: false, seconds: false, date: true, h12: false, ...((cfg && cfg.clock) || {}) }; }
    function clockWanted() { return !!(cfg && clockCfg().show && !dock.clockHidden); }
    function removeClock() {
      clearInterval(dock.clockT); dock.clockT = 0;
      if (dock.clock) { try { dock.clock.el.remove(); } catch { } dock.clock = null; placeDock(); }
    }
    function buildClock() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-clock";
      const t = document.createElement("div"); t.className = "agywe-ct";
      const dd = document.createElement("div"); dd.className = "agywe-cd";
      const x = document.createElement("button"); x.className = "agywe-x"; x.textContent = "✕"; x.title = "这次先收起（「小组件」页可以关掉）";
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock.clockHidden = true; removeClock(); });
      el.append(t, dd, x);
      return { el, t, d: dd, sig: "" };
    }
    function renderClock() {
      if (!clockWanted()) { removeClock(); return; }
      ensureDock();
      let c = dock.clock;
      if (!c || !c.el.isConnected) { c = buildClock(); dock.clock = c; dock.root.appendChild(c.el); }
      const k = clockCfg(), now = new Date();
      let h = now.getHours();
      const ap = h < 6 ? "凌晨" : h < 12 ? "上午" : h < 13 ? "中午" : h < 18 ? "下午" : "晚上";
      if (k.h12) h = h % 12 || 12;
      const hm = (k.h12 ? String(h) : String(h).padStart(2, "0")) + ":" + String(now.getMinutes()).padStart(2, "0");
      const sec = k.seconds ? ":" + String(now.getSeconds()).padStart(2, "0") : "";
      const sig = [hm, sec, k.h12 ? ap : "", now.getDate(), k.date].join("|");
      if (sig !== c.sig) {
        const first = !c.sig;
        c.sig = sig;
        c.t.textContent = "";
        if (k.h12) { const a = document.createElement("small"); a.className = "ap"; a.textContent = ap; c.t.appendChild(a); }
        c.t.appendChild(document.createTextNode(hm));
        if (sec) { const sm = document.createElement("small"); sm.textContent = sec; c.t.appendChild(sm); }
        c.d.textContent = (now.getMonth() + 1) + " 月 " + now.getDate() + " 日　" + WEEK[now.getDay()];
        c.d.style.display = k.date ? "" : "none";
        if (first) placeDock();
      }
      if (!dock.clockT) dock.clockT = setInterval(() => { try { renderClock(); } catch { } }, 1000);
    }


    // =====================================================================
    // v0.9：窗口前台 · 提醒 / 报时 · 今日统计 · 待办 / 便签 · 自检
    // =====================================================================
    let winFocused = true;
    try { ipcRenderer.on("agywe:win-focus", (_e, s) => { winFocused = !!(s && s.focused && !s.minimized); post({ type: "agywe:winfocus", focused: winFocused }); }); } catch { }
    function winStateSync() {
      try { ipcRenderer.invoke("agywe:win-state").then((s) => { winFocused = !!(s && s.focused && !s.minimized); post({ type: "agywe:winfocus", focused: winFocused }); }).catch(() => { }); } catch { }
    }

    // ---- 喝水 / 起来活动提醒、整点报时 ----
    const care = { water: Date.now(), move: Date.now(), hour: -1 };
    const WATER_LINES = ["该喝口水啦 💧", "补充一下水分吧～", "喝口水，顺便让眼睛歇一下", "水杯是不是空了？去续一杯吧"];
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
    function chimeLine(h) {
      const ap = h < 6 ? "凌晨" : h < 12 ? "上午" : h === 12 ? "中午" : h < 18 ? "下午" : "晚上";
      const n = h % 12 || 12;
      const tail = h === 12 ? "，该吃午饭啦" : h === 18 ? "，今天辛苦啦" : h >= 23 || h < 5 ? "，早点休息吧" : h === 9 ? "，开工啦" : "";
      return "🕐 " + ap + " " + n + " 点" + (tail || "啦");
    }
    function careSay(text, kind, title, sound) {
      if (!pet || mood.state || hideAll) return false;
      petAct("hop", 1000); petSay(text, 9000, kind);
      if (sound) sfxPlay(sound);
      const r = (cfg && cfg.remind) || {};
      if (title && r.notify !== false && !document.hasFocus()) { try { ipcRenderer.send("agywe:notify", { title, body: text }); } catch { } }
      return true;
    }
    function careTick() {
      if (!cfg || !pet) return;
      const now = Date.now(), r = { water: 0, move: 0, notify: true, ...(cfg.remind || {}) };
      if (now - idle.lastInput > 5 * 60000) { care.water = care.move = now; }   // 5 分钟没动：人多半不在，回来再重新计时
      const wm = Number(r.water) || 0, mm = Number(r.move) || 0;
      const pomoOn = !!(pomo.st && pomoActive(pomo.st));   // 番茄钟自己会叫你休息
      if (wm > 0 && now - care.water >= wm * 60000) { if (careSay(pickOne(WATER_LINES), "go", "💧 喝口水", "remind")) care.water = now; }
      else if (mm > 0 && !pomoOn && now - care.move >= mm * 60000) { if (careSay("已经坐了 " + mm + " 分钟啦，站起来活动一下吧～", "rest", "🧘 起来活动一下", "remind")) care.move = now; }
      const ch = { on: false, from: 9, to: 22, sound: true, ...(cfg.chime || {}) };
      const d = new Date(), h = d.getHours();
      if (d.getMinutes() !== 0) { care.hour = -1; return; }
      if (!ch.on || care.hour === h || idle.sleeping) return;
      care.hour = h;
      const from = clamp(Number(ch.from) || 0, 0, 23), to = clamp(Number.isFinite(Number(ch.to)) ? Number(ch.to) : 23, 0, 23);
      const inRange = from <= to ? h >= from && h <= to : h >= from || h <= to;
      if (inRange) careSay(chimeLine(h), "info", "", ch.sound !== false ? "chime" : "");
    }
    function careTest(k) {
      if (k === "water") careSay(pickOne(WATER_LINES), "go", "", "remind");
      else if (k === "move") careSay("已经坐了 " + (Number(((cfg && cfg.remind) || {}).move) || 60) + " 分钟啦，站起来活动一下吧～", "rest", "", "remind");
      else if (k === "chime") careSay(chimeLine(new Date().getHours()), "info", "", "chime");
    }

    // ---- 今日统计（数据在主进程，右键菜单里「今天做了多少」）----
    function sayStats() {
      try {
        ipcRenderer.invoke("agywe:stats-get").then((days) => {
          const t = Array.isArray(days) && days.length ? days[days.length - 1] : null;
          if (!t || (!t.done && !t.runs && !t.pomo)) { petSay("今天还没有跑完的任务，先来一个？", 4500, "info"); return; }
          const parts = [];
          if (t.done) parts.push("完成了 " + t.done + " 个任务");
          if (t.runMs) parts.push("agent 一共跑了 " + fmtDurCn(t.runMs));
          if (t.pomo) parts.push("专注了 " + t.pomo + " 个番茄");
          petSay("今天" + parts.join("，") + "～", 7000, "info");
        }).catch(() => { });
      } catch { }
    }

    // ---- 待办 / 便签：存在设置里（经壁纸页带令牌保存），每个窗口都一样 ----
    const wid = { todos: null, note: null, saveT: 0, pendingUntil: 0 };
    const todosNow = () => (wid.todos || (Array.isArray(cfg && cfg.todos) ? cfg.todos : []));
    const noteNow = () => (wid.note != null ? wid.note : String((cfg && cfg.note) || ""));
    function saveWidgets(patch, delay) {
      if ("todos" in patch) wid.todos = patch.todos;
      if ("note" in patch) wid.note = patch.note;
      wid.pendingUntil = Date.now() + 5000;
      clearTimeout(wid.saveT);
      wid.saveT = setTimeout(() => {
        const out = {};
        if (wid.todos) out.todos = wid.todos;
        if (wid.note != null) out.note = wid.note;
        if (!frame || !frame.isConnected) { toast("壁纸页还没准备好，这次没存上，稍后再改一下"); return; }
        post({ type: "agywe:save-cfg", patch: out });
      }, delay || 0);
    }
    function guardKeys(el) {
      for (const t of ["keydown", "keyup", "keypress"]) el.addEventListener(t, (e) => { e.stopPropagation(); if (t === "keydown" && e.key === "Escape") el.blur(); });
    }
    function widOn(k) { return !!(cfg && cfg.widgets && cfg.widgets[k] && !dock[k + "Hidden"]); }
    function cardClose(k, tip) {
      const x = document.createElement("button"); x.className = "agywe-x"; x.textContent = "✕"; x.title = tip;
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock[k + "Hidden"] = true; renderWidgets(); });
      return x;
    }
    function removeTodo() { if (dock.todo) { try { dock.todo.el.remove(); } catch { } dock.todo = null; placeDock(); } }
    function removeNote() { if (dock.note) { try { dock.note.el.remove(); } catch { } dock.note = null; placeDock(); } }
    const tid = () => Math.random().toString(16).slice(2, 10);
    function buildTodo() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-todo";
      const hd = document.createElement("div"); hd.className = "agywe-wh";
      const ti = document.createElement("span"); ti.textContent = "✅ 待办";
      const cnt = document.createElement("small");
      const clr = document.createElement("button"); clr.className = "agywe-clr"; clr.textContent = "清除已完成"; clr.title = "把打了勾的都删掉";
      clr.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); saveWidgets({ todos: todosNow().filter((t) => !t.done) }); renderTodo(); });
      hd.append(ti, cnt, clr);
      const list = document.createElement("div"); list.className = "agywe-tl";
      const inp = document.createElement("input"); inp.type = "text"; inp.maxLength = 200; inp.placeholder = "＋ 添加待办，回车"; inp.spellcheck = false;
      guardKeys(inp);
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        const v = inp.value.trim(); if (!v) return;
        const cur = todosNow();
        if (cur.length >= 50) { toast("待办最多 50 条，先清掉一些已完成的"); return; }
        saveWidgets({ todos: [...cur, { id: tid(), text: v, done: false, at: Date.now() }] });
        inp.value = ""; sfxPlay("ui"); renderTodo();
      });
      el.append(hd, list, inp, cardClose("todo", "这次先收起（「小组件」页可以关掉）"));
      return { el, list, cnt, clr, inp, sig: "" };
    }
    function todoRow(t) {
      const r = document.createElement("div"); r.className = "agywe-tr" + (t.done ? " done" : "");
      const ck = document.createElement("button"); ck.className = "agywe-ck"; ck.textContent = t.done ? "✓" : ""; ck.title = t.done ? "标成没做完" : "做完了";
      ck.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        saveWidgets({ todos: todosNow().map((x) => x.id === t.id ? { ...x, done: !x.done } : x) });
        if (!t.done) { sfxPlay("done", { test: false }); }
        renderTodo();
      });
      const tt = document.createElement("span"); tt.className = "agywe-tt"; tt.textContent = t.text; tt.title = "双击修改";
      guardKeys(tt);
      tt.addEventListener("dblclick", (e) => { e.stopPropagation(); tt.contentEditable = "true"; tt.focus(); try { document.getSelection().selectAllChildren(tt); } catch { } });
      tt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); tt.blur(); } });
      tt.addEventListener("blur", () => {
        if (tt.contentEditable !== "true") return;
        tt.contentEditable = "false";
        const v = tt.textContent.trim().slice(0, 200);
        if (!v) saveWidgets({ todos: todosNow().filter((x) => x.id !== t.id) });
        else if (v !== t.text) saveWidgets({ todos: todosNow().map((x) => x.id === t.id ? { ...x, text: v } : x) });
        renderTodo();
      });
      const del = document.createElement("button"); del.className = "agywe-td"; del.textContent = "✕"; del.title = "删掉";
      del.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); saveWidgets({ todos: todosNow().filter((x) => x.id !== t.id) }); renderTodo(); });
      r.append(ck, tt, del);
      return r;
    }
    function renderTodo() {
      if (!widOn("todo")) { removeTodo(); return; }
      ensureDock();
      let c = dock.todo;
      if (!c || !c.el.isConnected) { c = buildTodo(); dock.todo = c; dock.root.appendChild(c.el); c.sig = ""; }
      const list = todosNow();
      const sig = JSON.stringify(list);
      const editing = c.list.contains(document.activeElement);
      if (sig !== c.sig && !editing) {
        c.sig = sig;
        c.list.textContent = "";
        const sorted = [...list.filter((t) => !t.done), ...list.filter((t) => t.done)];
        if (!sorted.length) { const e = document.createElement("div"); e.className = "agywe-empty"; e.textContent = "今天想做点什么？"; c.list.appendChild(e); }
        for (const t of sorted) c.list.appendChild(todoRow(t));
        placeDock();
      }
      const done = list.filter((t) => t.done).length;
      c.cnt.textContent = list.length ? done + "/" + list.length : "";
      c.clr.style.display = done ? "" : "none";
    }
    function buildNote() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-note";
      const hd = document.createElement("div"); hd.className = "agywe-wh"; hd.textContent = "📝 便签";
      const ta = document.createElement("textarea"); ta.maxLength = 5000; ta.placeholder = "随手记点什么…（自动保存）"; ta.spellcheck = false;
      guardKeys(ta);
      const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(240, Math.max(64, ta.scrollHeight + 2)) + "px"; };
      ta.addEventListener("input", () => { fit(); saveWidgets({ note: ta.value }, 800); });
      ta.addEventListener("blur", () => { if (wid.note != null) saveWidgets({ note: ta.value }, 0); });
      el.append(hd, ta, cardClose("note", "这次先收起（「小组件」页可以关掉）"));
      return { el, ta, fit };
    }
    function renderNote() {
      if (!widOn("note")) { removeNote(); return; }
      ensureDock();
      let c = dock.note;
      const fresh = !c || !c.el.isConnected;
      if (fresh) { c = buildNote(); dock.note = c; dock.root.appendChild(c.el); }
      if (document.activeElement !== c.ta) { const v = noteNow(); if (c.ta.value !== v) c.ta.value = v; }
      c.fit();
      if (fresh) placeDock();
    }
    function renderWidgets() {
      if (cfg && Date.now() > wid.pendingUntil) { wid.todos = null; wid.note = null; }
      try { renderTodo(); } catch (e) { lastErr = String(e && e.message || e); }
      try { renderNote(); } catch (e) { lastErr = String(e && e.message || e); }
      try { renderCal(false); } catch (e) { lastErr = String(e && e.message || e); }
      try { renderSys(); } catch (e) { lastErr = String(e && e.message || e); }
      try { renderCd(); } catch (e) { lastErr = String(e && e.message || e); }
      try { renderUsage(); } catch (e) { lastErr = String(e && e.message || e); }
    }

    // ---- 自检：设置页来问，这里回答页面这边的情况 ----
    function selfReport() {
      return {
        ready, lastErr, frame: !!(frame && frame.isConnected), marked: marked.size, hideAll, winFocused, onBattery, agents,
        pet: !!(pet && pet.root.isConnected), petTop: !!(pet && (() => { try { return pet.root.matches(":popover-open"); } catch { return false; } })()),
        running: !!run.t0, audio: audio.state, sfx: sfx.ctx ? sfx.ctx.state : "none", avatars: av.stats || null,
        contrast: { on: contrast.on, need: contrast.need, ratio: contrast.ratio }, darkText, dock: !!(dock.root && dock.root.isConnected),
        buddy: buddyActive() ? { clip: buddy.clip, src: buddy.info && buddy.info.kind, clips: (buddy.info && buddy.info.clips || []).length, err: buddy.err } : (buddy.info ? buddy.info.kind : "off"),
        usage: use.data ? (use.data.ok ? { conv: String(use.data.conv || "").slice(0, 8), calls: use.data.calls, fresh: !!use.data.fresh, ctx: use.data.last ? use.data.last.ctx : 0 } : use.data.reason) : (use.c ? "waiting" : "off"),
        quota: use.quota ? (use.quota.groups || []).length + " groups" : use.qErr || "none",
        lowSpec: !!(cfg && cfg.lowSpec), path: location.pathname, glassPerf: perfSummary()
      };
    }


    // =====================================================================
    // v0.10：撒彩纸 · 摸头 · 回到顶部 / 到底部 · 字数 · 日历 · 系统占用 · 倒数日 · 白噪音
    // =====================================================================
    // ---- agent 完成时撒彩纸：从挂件那里炸开，再从顶上飘下来一些 ----
    function confettiBurst() {
      if (!cfg || cfg.doneConfetti === false || cfg.lowSpec || hideAll || !cfg.enabled) return;
      applyFxCfg();
      if (!fx.cv || !fx.ctx) return;
      let ox = innerWidth / 2, oy = 40;
      try { const el = buddyReplacing() ? buddy.root : pet && pet.doll; if (el) { const r = el.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 3; } } catch { }
      const col = () => "hsl(" + Math.floor(R() * 360) + "," + (75 + R() * 20) + "%," + (58 + R() * 12) + "%)";
      for (let i = 0; i < 46; i++) { const a = Math.PI / 2 + (R() - .5) * 2.6, v = 3 + R() * 5; fxSpawn({ t: "petal", x: ox, y: oy, vx: Math.cos(a) * v * (R() < .5 ? -1 : 1), vy: Math.abs(Math.sin(a) * v) * (R() < .7 ? -1 : 1), g: .14, life: 0, max: 80 + R() * 40, col: col(), s: 3 + R() * 3, rot: R() * 6, vr: (R() - .5) * .45 }); }
      for (let i = 0; i < 40; i++) fxSpawn({ t: "petal", x: R() * innerWidth, y: -10 - R() * 60, vx: (R() - .5) * 1.4, vy: 1 + R() * 2, g: .045, life: -Math.floor(R() * 40), max: 140 + R() * 50, col: col(), s: 3 + R() * 3, rot: R() * 6, vr: (R() - .5) * .3 });
    }

    // ---- 摸头：鼠标在挂件上半身来回划几下 ----
    const pat = { dir: 0, flips: 0, t0: 0, last: 0 };
    const PAT_LINES = ["嘿嘿～", "好舒服～", "再摸一下嘛", "(｡･ω･｡)", "被摸头了！", "开心 ✨", "继续加油哦"];
    function petHearts(n) {
      if (!pet || !pet.rig) return;
      for (let i = 0; i < n; i++) {
        const h = document.createElement("span"); h.className = "agywe-heart"; h.textContent = R() < .2 ? "✨" : "❤";
        h.style.setProperty("--hx", Math.round((R() - .5) * petCfg().size * .6) + "px");
        h.style.setProperty("--hdx", Math.round((R() - .5) * 40) + "px");
        h.style.animationDelay = (i * .13).toFixed(2) + "s";
        h.style.color = ["#ff6f91", "#ff9671", "#ffc75f", "#f9a8d4"][i % 4];
        pet.rig.appendChild(h);
        setTimeout(() => { try { h.remove(); } catch { } }, 1700 + i * 140);
      }
    }
    function petPatted() {
      const now = Date.now();
      if (now - pat.last < 6000) return;
      pat.last = now;
      if (idle.sleeping) { petWake(false); petSay("唔…醒了醒了", 2500); petHearts(2); return; }
      if (mood.state) return;
      petAct("hop", 1000); petHearts(4);
      petSay(PAT_LINES[Math.floor(R() * PAT_LINES.length)], 2600);
      sfxPlay("pet");
    }
    function bindPat(doll) {
      doll.addEventListener("pointermove", (e) => {
        if (!cfg || cfg.petPat === false || e.buttons) return;
        const r = doll.getBoundingClientRect();
        if (e.clientY > r.top + r.height * .6) return;
        const mx = e.movementX || 0;
        if (Math.abs(mx) < 2) return;
        const d = mx > 0 ? 1 : -1, now = Date.now();
        if (now - pat.t0 > 1400) { pat.flips = 0; pat.t0 = now; pat.dir = d; return; }
        if (d !== pat.dir) { pat.dir = d; if (++pat.flips >= 4) { pat.flips = 0; pat.t0 = 0; petPatted(); } }
      });
      doll.addEventListener("pointerleave", () => { pat.flips = 0; });
    }

    // ---- 对话区「回到顶部 / 到底部」 ----
    const jump = { el: null, sc: null, raf: 0, up: null, dn: null };
    function jumpOn() { return !!(cfg && cfg.enabled && ready && cfg.jumpBtns !== false && !hideAll); }
    function removeJump() { if (jump.el) { try { jump.el.remove(); } catch { } jump.el = null; } }
    function jumpScroll(top) {
      const sc = jump.sc; if (!sc) return;
      try { sc.scrollTo({ top: top ? 0 : sc.scrollHeight, behavior: "smooth" }); } catch { sc.scrollTop = top ? 0 : sc.scrollHeight; }
      sfxPlay("ui");
    }
    function ensureJump() {
      if (jump.el && jump.el.isConnected) return;
      const el = document.createElement("div"); el.id = "agywe-jump"; el.setAttribute("aria-hidden", "true");
      const mk = (txt, title, top) => { const b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.title = title; b.tabIndex = -1; b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); jumpScroll(top); }); return b; };
      jump.up = mk("↑", "回到顶部", true); jump.dn = mk("↓", "到底部", false);
      el.append(jump.up, jump.dn);
      document.documentElement.appendChild(el);
      jump.el = el;
    }
    function jumpSched() { if (!jump.raf) jump.raf = requestAnimationFrame(jumpRender); }
    function jumpRefresh() {
      if (!jumpOn()) { removeJump(); return; }
      let sc = null;
      try { const list = avList(); sc = list ? avScroller(list) : null; } catch { sc = null; }
      if (sc !== jump.sc) {
        if (jump.sc) { try { jump.sc.removeEventListener("scroll", jumpSched); } catch { } }
        jump.sc = sc;
        if (sc) sc.addEventListener("scroll", jumpSched, { passive: true });
      }
      jumpSched();
    }
    function jumpRender() {
      jump.raf = 0;
      const sc = jump.sc;
      if (!jumpOn() || !sc || !sc.isConnected) { removeJump(); return; }
      const r = sc.getBoundingClientRect();
      if (r.height < 240 || r.width < 260) { removeJump(); return; }
      const top = sc.scrollTop, rest = sc.scrollHeight - sc.clientHeight - top, far = Math.max(500, sc.clientHeight * .8);
      const up = top > far, dn = rest > far;
      if (!up && !dn && !jump.el) return;
      ensureJump();
      jump.up.classList.toggle("on", up); jump.dn.classList.toggle("on", dn);
      jump.el.style.setProperty("left", Math.round(r.right - 32 - 14) + "px", "important");
      jump.el.style.setProperty("top", Math.round(Math.max(r.top + 10, r.bottom - 32 * 2 - 6 - 18)) + "px", "important");
    }

    // ---- 输入框字数 ----
    const cc = { el: null, f: null, t: 0, iv: 0 };
    function ccOn() { return !!(cfg && cfg.enabled && ready && cfg.charCount !== false && !hideAll); }
    function ccHide() { clearInterval(cc.iv); cc.iv = 0; if (cc.el) { try { cc.el.remove(); } catch { } cc.el = null; } }
    function ccText(f) { try { return f.tagName === "TEXTAREA" || f.tagName === "INPUT" ? String(f.value || "") : String(f.innerText || f.textContent || ""); } catch { return ""; } }
    function ccField(t) {
      if (!t || !t.closest || isOurs(t)) return null;
      let f = null; try { f = t.closest(FIELD_SEL); } catch { }
      if (!f || isCodeField(f)) return null;
      return f;
    }
    function ccUpdate() {
      const f = cc.f;
      if (!ccOn() || !f || !f.isConnected) { ccHide(); return; }
      const s = ccText(f);
      const n = Array.from(s.replace(/\s+/g, "")).length;
      const r = f.getBoundingClientRect();
      if (!n || r.width < 160 || r.height < 14) { ccHide(); return; }
      if (!cc.el || !cc.el.isConnected) { cc.el = document.createElement("div"); cc.el.id = "agywe-cc"; cc.el.setAttribute("aria-hidden", "true"); document.documentElement.appendChild(cc.el); }
      const lines = s.replace(/\n+$/, "").split("\n").length;
      cc.el.textContent = n + " 字" + (lines > 1 ? " · " + lines + " 行" : "");
      const w = cc.el.offsetWidth || 60;
      cc.el.style.setProperty("left", Math.round(Math.min(innerWidth - w - 6, r.right - w)) + "px", "important");
      cc.el.style.setProperty("top", Math.round(Math.max(4, r.top - 22)) + "px", "important");
      if (!cc.iv) cc.iv = setInterval(() => { try { ccUpdate(); } catch { } }, 700);
    }
    function onCcEvent(e) {
      if (!ccOn()) { if (cc.el) ccHide(); return; }
      const f = ccField(e.target);
      if (!f) return;
      cc.f = f;
      clearTimeout(cc.t); cc.t = setTimeout(() => { try { ccUpdate(); } catch { } }, 60);
    }
    window.addEventListener("input", onCcEvent, { capture: true, passive: true });
    window.addEventListener("compositionend", onCcEvent, { capture: true, passive: true });
    window.addEventListener("focusin", onCcEvent, { capture: true, passive: true });
    window.addEventListener("focusout", (e) => { if (cc.f && e.target && cc.f.contains(e.target)) { clearTimeout(cc.t); cc.t = setTimeout(() => { if (cc.f && !cc.f.contains(document.activeElement)) { cc.f = null; ccHide(); } }, 400); } }, true);

    // ---- 日历小组件 ----
    const WEEK_HEAD = ["一", "二", "三", "四", "五", "六", "日"];
    function cdList() { return (Array.isArray(cfg && cfg.countdowns) ? cfg.countdowns : []).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))); }
    function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    function removeCal() { if (dock.cal) { try { dock.cal.el.remove(); } catch { } dock.cal = null; placeDock(); } }
    function buildCal() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-cal";
      const hd = document.createElement("div"); hd.className = "agywe-wh";
      const prev = document.createElement("button"); prev.textContent = "‹"; prev.title = "上个月";
      const ti = document.createElement("span"); ti.title = "回到这个月";
      const next = document.createElement("button"); next.textContent = "›"; next.title = "下个月";
      prev.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock.calOff = (dock.calOff || 0) - 1; renderCal(true); });
      next.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock.calOff = (dock.calOff || 0) + 1; renderCal(true); });
      ti.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dock.calOff = 0; renderCal(true); });
      hd.append(prev, ti, next);
      const g = document.createElement("div"); g.className = "agywe-cg";
      el.append(hd, g, cardClose("calendar", "这次先收起（「小组件」页可以关掉）"));
      return { el, ti, g, sig: "" };
    }
    function renderCal(force) {
      if (!widOn("calendar")) { removeCal(); return; }
      ensureDock();
      let c = dock.cal;
      if (!c || !c.el.isConnected) { c = buildCal(); dock.cal = c; dock.root.appendChild(c.el); force = true; }
      const now = new Date(), base = new Date(now.getFullYear(), now.getMonth() + (dock.calOff || 0), 1);
      const marks = new Set();
      for (const x of cdList()) { const [Y, M, D] = x.date.split("-").map(Number); marks.add(x.yearly ? base.getFullYear() + "-" + String(M).padStart(2, "0") + "-" + String(D).padStart(2, "0") : x.date); }
      const sig = ymd(now) + "|" + ymd(base) + "|" + [...marks].join(",");
      if (!force && sig === c.sig) return;
      c.sig = sig;
      c.ti.textContent = base.getFullYear() + " 年 " + (base.getMonth() + 1) + " 月";
      c.g.textContent = "";
      for (const w of WEEK_HEAD) { const i = document.createElement("i"); i.textContent = w; c.g.appendChild(i); }
      const lead = (base.getDay() + 6) % 7;
      const start = new Date(base.getFullYear(), base.getMonth(), 1 - lead);
      const rows = Math.ceil((lead + new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()) / 7);
      const todayK = ymd(now);
      for (let k = 0; k < rows * 7; k++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), key = ymd(d);
        const b = document.createElement("b"); b.textContent = String(d.getDate());
        const wd = d.getDay();
        if (wd === 0 || wd === 6) b.classList.add("we");
        if (d.getMonth() !== base.getMonth()) b.classList.add("out");
        if (key === todayK) b.classList.add("td");
        if (marks.has(key)) { b.classList.add("cd"); const x = cdList().find((y) => (y.yearly ? key.slice(5) === y.date.slice(5) : key === y.date)); if (x) b.title = x.name || ""; }
        c.g.appendChild(b);
      }
      placeDock();
    }

    // ---- 系统占用小组件 ----
    const GB = 1073741824;
    function removeSys() { clearTimeout(dock.sysT); dock.sysT = 0; if (dock.sys) { try { dock.sys.el.remove(); } catch { } dock.sys = null; placeDock(); } }
    function buildSys() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-sys";
      const hd = document.createElement("div"); hd.className = "agywe-wh"; hd.textContent = "📊 系统占用";
      const row = (name) => { const r = document.createElement("div"); r.className = "agywe-sr"; const a = document.createElement("span"); a.textContent = name; const v = document.createElement("span"); v.textContent = "…"; const bar = document.createElement("div"); bar.className = "agywe-sb"; const i = document.createElement("i"); bar.appendChild(i); r.append(a, v, bar); return { r, v, i }; };
      const cpu = row("CPU"), mem = row("内存"), app2 = row("Antigravity");
      el.append(hd, cpu.r, mem.r, app2.r, cardClose("sys", "这次先收起（「小组件」页可以关掉）"));
      return { el, cpu, mem, app: app2 };
    }
    function sysPaint(c, d) {
      if (!d || d.error) { c.cpu.v.textContent = "读不到"; return; }
      const set = (row, pct, txt) => { row.v.textContent = txt; row.i.style.width = clamp(pct, 0, 100).toFixed(0) + "%"; row.i.classList.toggle("hot", pct >= 85); };
      set(c.cpu, d.cpu == null ? 0 : d.cpu, d.cpu == null ? "…" : d.cpu + "%" + (d.cores ? " · " + d.cores + " 线程" : ""));
      set(c.mem, d.memTotal ? 100 * d.memUsed / d.memTotal : 0, (d.memUsed / GB).toFixed(1) + " / " + (d.memTotal / GB).toFixed(0) + " GB");
      set(c.app, d.memTotal ? 100 * d.appMem / d.memTotal : 0, d.appMem >= GB ? (d.appMem / GB).toFixed(2) + " GB" : Math.round(d.appMem / 1048576) + " MB");
    }
    function sysPoll() {
      clearTimeout(dock.sysT); dock.sysT = 0;
      const c = dock.sys; if (!c || !c.el.isConnected) return;
      if (document.hidden) { dock.sysT = setTimeout(sysPoll, 4000); return; }
      try { ipcRenderer.invoke("agywe:sys").then((d) => { if (dock.sys === c) { sysPaint(c, d); dock.sysT = setTimeout(sysPoll, 2000); } }).catch(() => { dock.sysT = setTimeout(sysPoll, 5000); }); } catch { }
    }
    function renderSys() {
      if (!widOn("sys")) { removeSys(); return; }
      ensureDock();
      if (!dock.sys || !dock.sys.el.isConnected) { dock.sys = buildSys(); dock.root.appendChild(dock.sys.el); placeDock(); sysPoll(); }
    }

    // =====================================================================
    // v0.11 用量卡片：上下文占用 / 缓存命中 / 速度 / 今天和本月 / 额度，合在一张卡片里
    //   上下文和 token 来自本机对话库（主进程 usage.js 读，不联网）
    //   额度用 Antigravity 自己界面查额度的那个函数（cloudCodeService.retrieveUserQuotaSummary），
    //   默认每 5 分钟一次、展开卡片时最多每分钟一次，可以在「小组件」里改成只在展开时查或者不查
    // =====================================================================
    const USE_DEF = { mode: "pill", quota: "auto" };
    function useCfg() { return { ...USE_DEF, ...((cfg && cfg.usage) || {}) }; }
    const use = { c: null, t: 0, data: null, quota: null, qAt: 0, qBusy: false, qErr: "", qFail: 0, at: 0, errN: 0 };
    function fmtTok(n) {
      n = Number(n) || 0; const a = Math.abs(n);
      const f = (x, d) => x.toFixed(d).replace(/\.0+$/, "");
      return a >= 1e9 ? f(n / 1e9, 2) + "B" : a >= 1e6 ? f(n / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + "M" : a >= 1e3 ? f(n / 1e3, 1) + "K" : String(Math.round(n));
    }
    function fmtPct(x) { if (x == null || !isFinite(x)) return "--"; if (x >= 99.95) return "100%"; const r = Math.round(x * 10) / 10; return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + "%"; }
    function fmtLeft(sec) {
      sec = Math.max(0, Math.round(sec));
      const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
      return d > 0 ? d + " 天 " + h + " 小时" : h > 0 ? h + " 小时 " + m + " 分" : m > 0 ? m + " 分" : "不到 1 分钟";
    }
    // 在页面自己的环境里跑（React 的数据挂在页面那边，插件这边看不到）；找到一次就记住，不会每次都翻一遍页面
    const QUOTA_JS = `(async () => {
      const w = window;
      let s = w.__agyweQuotaSvc;
      if (!s || typeof s.retrieveUserQuotaSummary !== "function") {
        s = null;
        const seen = new Set();
        for (const el of document.querySelectorAll("body *")) {
          const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$"));
          if (!k) continue;
          for (let f = el[k]; f && !seen.has(f); f = f.return) {
            seen.add(f);
            const p = f.memoizedProps, c = p && p.value && p.value.core, v = c && c.cloudCodeService;
            if (v && typeof v.retrieveUserQuotaSummary === "function") { s = v; break; }
          }
          if (s) break;
        }
        w.__agyweQuotaSvc = s;
      }
      if (!s) return { ok: false, reason: "nosvc" };
      const r = await s.retrieveUserQuotaSummary(undefined, false);
      const gs = (r && r.response && r.response.groups) || [];
      return { ok: true, groups: gs.map((g) => ({
        name: String(g.displayName || g.id || ""),
        buckets: (Array.isArray(g.buckets) ? g.buckets : []).map((b) => {
          const v = b.remaining && b.remaining.value;
          const rs = b.resetTime && b.resetTime.seconds != null ? Number(b.resetTime.seconds) : 0;
          return { id: String(b.bucketId || ""), win: String(b.window || ""), name: String(b.displayName || ""), frac: typeof v === "number" && isFinite(v) ? v : null, reset: isFinite(rs) ? rs : 0, desc: String(b.description || "") };
        })
      })) };
    })()`;
    function quotaWanted(cardOpen) {
      const q = useCfg().quota;
      if (q === "off" || document.hidden || hideAll) return false;
      const age = Date.now() - use.qAt;
      // 界面还没加载完（找不到额度服务）：15 秒后再找，最多找 40 次；真出错才按 2、4、8… 分钟往后推
      if (use.qWait) return use.qWait < 40 && age > 15000;
      const backoff = use.qFail ? Math.min(30, 2 ** use.qFail) * 60000 : 0;
      if (age < backoff) return false;
      if (cardOpen && age > 60000) return true;
      return q === "auto" && age > 300000;
    }
    async function quotaFetch(force) {
      if (use.qBusy || !webFrame || typeof webFrame.executeJavaScript !== "function") return;
      if (!force && !quotaWanted(useCfg().mode === "card")) return;
      if (force && Date.now() - use.qAt < 5000) return;
      use.qBusy = true; use.qAt = Date.now();
      try {
        const r = await webFrame.executeJavaScript(QUOTA_JS);
        if (r && r.ok) {
          if (!use.quota || use.qWait) diagLite("quota-ok", { groups: (r.groups || []).map((g) => g.name + ":" + (g.buckets || []).length), waited: use.qWait || 0 });
          use.quota = { groups: r.groups, at: Date.now() }; use.qErr = ""; use.qFail = 0; use.qWait = 0;
        } else if (r && r.reason === "nosvc") {
          use.qWait = (use.qWait || 0) + 1;
          use.qErr = use.qWait < 40 ? "额度：等界面加载完再查…" : "界面里没找到额度信息";
          if (use.qWait === 1 || use.qWait === 8 || use.qWait === 40) diagLite("quota-nosvc", { tries: use.qWait, path: location.pathname });
        } else { use.qErr = "没查到额度"; use.qFail++; diagLite("quota-empty", { r: JSON.stringify(r).slice(0, 200) }); }
      } catch (e) {
        use.qErr = "查询失败"; use.qFail++;
        if (use.qFail <= 2) diagLite("quota-failed", { error: String(e && e.message || e).slice(0, 200) });
      } finally { use.qBusy = false; }
      if (use.c) usePaint();
    }
    // 跟当前模型对应的那一组额度（Claude / GPT 一组，Gemini 一组）
    function quotaGroupFor(model) {
      const gs = (use.quota && use.quota.groups) || [];
      if (!gs.length) return null;
      const m = String(model || "").toLowerCase();
      const tp = /claude|gpt/.test(m), ar = /argon/.test(m);
      return gs.find((g) => { const n = g.name.toLowerCase(); return tp ? /claude|gpt/.test(n) : ar ? /argon/.test(n) : !/claude|gpt|argon/.test(n); }) || gs[0];
    }
    function bucketLabel(b) {
      const s = (b.id + " " + b.win + " " + b.name).toLowerCase();
      return /5h|5 h|five/.test(s) ? "5 小时" : /week/.test(s) ? "每周" : /day|daily/.test(s) ? "每天" : (b.name || b.win || "额度");
    }
    function ringEl(cls) {
      const box = document.createElement("div"); box.className = "agywe-ring" + (cls ? " " + cls : "");
      const fg = svgEl("circle", { class: "fg", cx: 18, cy: 18, r: 15.5, pathLength: 100, "stroke-dasharray": "0 100" });
      box.appendChild(svgEl("svg", { viewBox: "0 0 36 36", "aria-hidden": "true" }, [svgEl("circle", { class: "bg", cx: 18, cy: 18, r: 15.5 }), fg]));
      const b = document.createElement("b"); box.appendChild(b);
      return { box, fg, b };
    }
    function setRing(r, pct) {
      const p = pct == null || !isFinite(pct) ? 0 : clamp(pct, 0, 100);
      r.fg.setAttribute("stroke-dasharray", p.toFixed(1) + " 100");
      r.box.classList.toggle("warm", p >= 70 && p < 88);
      r.box.classList.toggle("hot", p >= 88);
      r.b.textContent = pct == null || !isFinite(pct) ? "--" : Math.round(p) + "%";
    }
    function setUseMode(m) {
      if (cfg) cfg.usage = { ...useCfg(), mode: m };
      post({ type: "agywe:save-cfg", patch: { usage: { ...useCfg(), mode: m } } });
      if (use.c) { use.c.el.classList.toggle("pill", m === "pill"); usePaint(); }
      use.force = true;
      if (m === "card") quotaFetch(!!(use.qWait && !use.quota));
      clearTimeout(use.t); use.t = setTimeout(usePoll, 50);
      setTimeout(placeDock, 60);
    }
    function removeUse() { clearTimeout(use.t); use.t = 0; if (use.c) { try { use.c.el.remove(); } catch { } use.c = null; placeDock(); } }
    function buildUse() {
      const el = document.createElement("div"); el.className = "agywe-card agywe-use";
      // 小胶囊
      const pv = document.createElement("div"); pv.className = "agywe-pv";
      const pr = ringEl("sm"); const pt = document.createElement("span"); pt.className = "agywe-pt"; pt.textContent = "用量…";
      pv.append(pr.box, pt);
      // 卡片
      const cv = document.createElement("div"); cv.className = "agywe-cv";
      const hd = document.createElement("div"); hd.className = "agywe-wh";
      const ti = document.createElement("span"); ti.textContent = "🧠 用量";
      const sub = document.createElement("small"); sub.className = "agywe-ut";
      hd.append(ti, sub);
      const top = document.createElement("div"); top.className = "agywe-uh";
      const cr = ringEl("");
      const meta = document.createElement("div"); meta.className = "agywe-um";
      top.append(cr.box, meta);
      const lines = document.createElement("div");
      const qbox = document.createElement("div"); qbox.className = "agywe-uq";
      const foot = document.createElement("div"); foot.className = "agywe-uf";
      cv.append(hd, top, lines, qbox, foot);
      const x = document.createElement("button"); x.className = "agywe-x"; x.textContent = "✕"; x.title = "收成小胶囊（双击也能切换）";
      x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setUseMode("pill"); });
      el.append(pv, cv, x);
      el.addEventListener("dblclick", (e) => { if (e.target.closest && e.target.closest("button")) return; setUseMode(useCfg().mode === "pill" ? "card" : "pill"); });
      el.addEventListener("click", (e) => { if (useCfg().mode === "pill" && !(e.target.closest && e.target.closest("button")) && !dock.drag) { /* 单击胶囊不展开，免得拖动时误触；双击展开 */ } });
      el.addEventListener("mouseenter", () => { if (use.qWait && !use.quota) quotaFetch(true); else if (useCfg().mode === "pill") quotaFetch(false); });
      return { el, pr, pt, sub, cr, meta, lines, qbox, foot };
    }
    function lineRow(parent, name, val, tip) {
      const r = document.createElement("div"); r.className = "agywe-ul";
      const a = document.createElement("span"); a.textContent = name;
      const b = document.createElement("span"); b.textContent = val;
      if (tip) r.title = tip;
      r.append(a, b); parent.appendChild(r);
    }
    function usePaint() {
      const c = use.c; if (!c) return;
      const d = use.data, L = d && d.last, T = d && d.total;
      const ctxPct = L && L.max ? 100 * L.ctx / L.max : d && d.ok && !L ? 0 : null;
      const hitNow = L && (L.in + L.cache) ? 100 * L.cache / (L.in + L.cache) : null;
      const hitAll = T && (T.in + T.cache) ? 100 * T.cache / (T.in + T.cache) : null;
      const tps = L && L.stream > 0.05 ? L.out / L.stream : null;
      const g = quotaGroupFor(L && L.model);
      const b5 = g && (g.buckets.find((b) => bucketLabel(b) === "5 小时") || g.buckets[0]);
      // 胶囊
      setRing(c.pr, ctxPct);
      let pt = "";
      if (!d) pt = "用量…";
      else if (!d.ok) pt = d.reason === "nosqlite" ? "用量：这个版本读不了" : d.reason === "noconv" ? "还没有对话" : "用量读不到";
      else if (!L) pt = "上下文 0% · 新对话" + (b5 && b5.frac != null ? " · " + bucketLabel(b5).replace(" 小时", "h") + " 剩 " + fmtPct(b5.frac * 100) : "");
      else pt = "上下文 " + fmtPct(ctxPct) + " · 命中 " + fmtPct(hitNow) + (b5 && b5.frac != null ? " · " + bucketLabel(b5).replace(" 小时", "h") + " 剩 " + fmtPct(b5.frac * 100) : "");
      if (c.pt.textContent !== pt) c.pt.textContent = pt;
      c.el.title = L ? (d.title ? "「" + d.title + "」\n" : "") + "上下文 " + fmtTok(L.ctx) + " / " + fmtTok(L.max) + "\n本轮：输入 " + fmtTok(L.in) + " · 缓存命中 " + fmtTok(L.cache) + " · 输出 " + fmtTok(L.out) + "\n双击展开" : "双击展开";
      if (useCfg().mode === "pill") return;
      // 卡片
      c.sub.textContent = d && d.title ? (d.title.length > 18 ? d.title.slice(0, 17) + "…" : d.title) : "";
      c.sub.title = d && d.title ? d.title : "";
      setRing(c.cr, ctxPct);
      c.meta.textContent = ""; c.lines.textContent = "";
      if (d && d.ok && !L) {
        const big = document.createElement("b"); big.textContent = "0";
        const s1 = document.createElement("div"); s1.textContent = "新对话，还没调用过模型";
        c.meta.append(big, s1);
        const S = d.sum;
        if (S && S.today && S.month) lineRow(c.lines, "今天 / 本月", fmtTok(S.today.in + S.today.cache + S.today.out) + " / " + fmtTok(S.month.in + S.month.cache + S.month.out));
      } else if (!d || !d.ok || !L) {
        const e = document.createElement("div"); e.className = "agywe-empty"; e.textContent = pt; c.meta.appendChild(e);
      } else {
        const big = document.createElement("b"); big.textContent = fmtTok(L.ctx) + " / " + fmtTok(L.max);
        const s1 = document.createElement("div"); s1.innerHTML = ""; s1.textContent = "本轮 输入 " + fmtTok(L.in) + " · 命中 " + fmtTok(L.cache);
        const s2 = document.createElement("div"); s2.textContent = "输出 " + fmtTok(L.out) + (L.think ? "（思考 " + fmtTok(L.think) + "）" : "");
        const s3 = document.createElement("div"); s3.className = "agywe-mdl"; s3.textContent = L.model || ""; s3.title = L.model || "";
        c.meta.append(big, s1, s2, s3);
        lineRow(c.lines, "缓存命中", "本轮 " + fmtPct(hitNow) + " · 本对话 " + fmtPct(hitAll), "命中的 token 按缓存价计费，越高越省");
        lineRow(c.lines, "速度", (tps ? Math.round(tps) + " tok/s" : "--") + " · 首字 " + (L.ttft ? L.ttft.toFixed(1) + " 秒" : "--"), "最后一次调用：输出 token ÷ 生成用时；首字 = 发出请求到开始出字");
        lineRow(c.lines, "本对话", d.calls + " 次调用 · " + fmtTok(T.in + T.cache + T.out), "输入 " + fmtTok(T.in) + " · 缓存命中 " + fmtTok(T.cache) + " · 输出 " + fmtTok(T.out) + " · 思考 " + fmtTok(T.think));
        const S = d.sum;
        if (S && S.today && S.month) lineRow(c.lines, "今天 / 本月", fmtTok(S.today.in + S.today.cache + S.today.out) + " / " + fmtTok(S.month.in + S.month.cache + S.month.out),
          "今天 " + S.today.calls + " 次调用，命中 " + fmtPct((S.today.in + S.today.cache) ? 100 * S.today.cache / (S.today.in + S.today.cache) : null) + "\n本月 " + S.month.calls + " 次调用，命中 " + fmtPct((S.month.in + S.month.cache) ? 100 * S.month.cache / (S.month.in + S.month.cache) : null) + "\n按天、按模型的明细在设置「小组件」里");
      }
      // 额度
      c.qbox.textContent = "";
      const q = useCfg().quota;
      if (q === "off") { c.qbox.hidden = true; }
      else {
        c.qbox.hidden = false;
        const gs = (use.quota && use.quota.groups) || [];
        if (!gs.length) {
          const e = document.createElement("div"); e.className = "agywe-uqg"; e.textContent = use.qBusy ? "额度查询中…" : use.qErr || "额度还没查"; c.qbox.appendChild(e);
        }
        const now = Date.now() / 1000;
        for (const gr of gs) {
          if (!gr.buckets.length) continue;
          const h = document.createElement("div"); h.className = "agywe-uqg"; h.textContent = gr.name + (g === gr ? " · 当前模型" : ""); c.qbox.appendChild(h);
          for (const bk of gr.buckets) {
            const r = document.createElement("div"); r.className = "agywe-uqb";
            const nm = document.createElement("span"); nm.textContent = bucketLabel(bk);
            const bar = document.createElement("div"); bar.className = "agywe-sb"; const fi = document.createElement("i");
            const pct = bk.frac == null ? 0 : clamp(bk.frac * 100, 0, 100);
            fi.style.width = pct.toFixed(1) + "%"; fi.classList.toggle("hot", bk.frac != null && pct <= 15); bar.appendChild(fi);
            const v = document.createElement("span"); v.textContent = "剩 " + fmtPct(bk.frac == null ? null : pct);
            if (bk.reset > now) r.title = fmtLeft(bk.reset - now) + "后重置"; else if (bk.desc) r.title = bk.desc;
            r.append(nm, bar, v); c.qbox.appendChild(r);
          }
        }
      }
      const ago = use.at ? Math.round((Date.now() - use.at) / 1000) : null;
      c.foot.textContent = "数据来自本机对话记录" + (use.quota ? " · 额度 " + Math.max(0, Math.round((Date.now() - use.quota.at) / 60000)) + " 分钟前" : "") + (ago != null && ago > 15 ? " · " + ago + " 秒前" : "");
      placeDock();
    }
    async function usePoll() {
      clearTimeout(use.t); use.t = 0;
      if (!use.c || !use.c.el.isConnected) return;
      if (document.hidden) { use.t = setTimeout(usePoll, 15000); return; }
      const card = useCfg().mode === "card";
      const conv = chatContext().conv;
      const every = agents > 0 ? 2000 : card ? 3000 : 5000;
      // 换了对话（包括新开对话）马上刷新，不等下一轮
      if (conv === use.conv && use.at && Date.now() - use.at < every && !use.force) { use.t = setTimeout(usePoll, 1000); return; }
      use.force = false;
      try {
        const d = await ipcRenderer.invoke("agywe:usage", { conv, sum: card });
        if (d) { use.data = d; use.at = Date.now(); use.conv = conv; }
      } catch (e) { if (use.errN++ < 3) diagLite("usage-ipc-failed", { error: String(e && e.message || e).slice(0, 200) }); }
      if (!use.c) return;
      usePaint();
      quotaFetch(false);
      use.t = setTimeout(usePoll, 1000);
    }
    function renderUsage() {
      if (!cfg || useCfg().mode === "off" || dock.usageHidden) { removeUse(); return; }
      ensureDock();
      if (!use.c || !use.c.el.isConnected) { use.c = buildUse(); dock.root.insertBefore(use.c.el, dock.root.firstChild); usePaint(); usePoll(); }
      use.c.el.classList.toggle("pill", useCfg().mode === "pill");
      placeDock();
    }
    function toggleUseCard() {
      dock.usageHidden = false;
      if (useCfg().mode === "off") { if (cfg) cfg.usage = { ...useCfg(), mode: "card" }; post({ type: "agywe:save-cfg", patch: { usage: { ...useCfg(), mode: "card" } } }); renderUsage(); quotaFetch(true); return; }
      renderUsage();
      setUseMode(useCfg().mode === "card" ? "pill" : "card");
    }

    // =====================================================================
    // v0.11 猫猫桌宠：每个动作一段透明 webm，两个 <video> 交替，换动作不闪
    //   动作素材只读本机（猫猫插件自带的 / 复制到 agywe\buddy 的 / 自己选的文件夹），插件本身不带
    // =====================================================================
    const BUDDY_POS = "agywe:buddy-pos";
    const buddy = { root: null, wrap: null, vids: [], cur: -1, clip: "", loop: false, then: null, oneShot: false, tok: 0, info: null, stamp: -1, drag: null, pos: null, bubble: null, sayT: 0, idleT: 0, lastAct: Date.now(), err: 0, greeted: false, applying: false, again: false, moveDir: 0 };
    function buddyCfg() { return { on: false, dir: "", size: 150, replaceDoll: false, idle: true, greet: true, stamp: 0, ...((cfg && cfg.buddy) || {}) }; }
    function buddyActive() { return !!(buddy.root && buddy.root.isConnected && buddy.info && buddy.info.dir); }
    function buddyReplacing() { return buddyActive() && buddyCfg().replaceDoll === true; }
    function buddyHas(c) { return !!(buddy.info && Array.isArray(buddy.info.clips) && buddy.info.clips.includes(c)); }
    function bclip(...names) { for (const n of names) if (buddyHas(n)) return n; return "idle"; }
    function buddyPosLoad() { try { const v = JSON.parse(localStorage.getItem(BUDDY_POS) || "null"); if (v && isFinite(v.r) && isFinite(v.b)) return v; } catch { } return { r: 300, b: 6 }; }
    function placeBuddy() {
      if (!buddy.root) return;
      const p = buddy.pos || (buddy.pos = buddyPosLoad());
      const w = buddy.root.offsetWidth || buddyCfg().size, h = buddy.root.offsetHeight || w;
      buddy.root.style.setProperty("right", clamp(p.r, -w * .3, Math.max(0, innerWidth - w * .7)) + "px", "important");
      buddy.root.style.setProperty("bottom", clamp(p.b, -h * .2, Math.max(0, innerHeight - h * .8)) + "px", "important");
    }
    function removeBuddy() {
      clearInterval(buddy.idleT); buddy.idleT = 0;
      if (buddy.root) { for (const v of buddy.vids) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch { } } try { buddy.root.remove(); } catch { } }
      buddy.root = null; buddy.vids = []; buddy.cur = -1; buddy.clip = ""; buddy.bubble = null; buddy.oneShot = false; buddy.then = null;
      document.documentElement.classList.remove("agywe-buddy-doll");
    }
    async function applyBuddy() {
      if (buddy.applying) { buddy.again = true; return; }
      buddy.applying = true;
      try {
        const b = buddyCfg();
        if (!cfg || !b.on || hideAll) { removeBuddy(); return; }
        if (!buddy.info || buddy.stamp !== (b.stamp || 0) + ":" + b.dir) {
          buddy.stamp = (b.stamp || 0) + ":" + b.dir;
          try { buddy.info = await ipcRenderer.invoke("agywe:buddy-info"); } catch { buddy.info = null; }
          if (buddy.root) { buddy.clip = ""; buddy.oneShot = false; }
        }
        if (!buddy.info || !buddy.info.dir) { removeBuddy(); if (!buddy.warned) { buddy.warned = true; diagLite("buddy-no-assets", { info: buddy.info }); } return; }
        ensureBuddy();
        buddy.root.style.setProperty("--agywe-bsize", clamp(Number(b.size) || 150, 60, 420) + "px");
        placeBuddy();
        document.documentElement.classList.toggle("agywe-buddy-doll", b.replaceDoll === true);
        if (!buddy.clip) {
          if (!buddy.greeted && b.greet !== false && buddyHas("wave")) { buddy.greeted = true; buddyPlay("wave", false); }
          else buddyUpdate();
        }
      } catch (e) { lastErr = String(e && e.message || e); }
      finally {
        buddy.applying = false;
        if (buddy.again) { buddy.again = false; setTimeout(applyBuddy, 0); }
      }
    }
    function ensureBuddy() {
      if (buddy.root && buddy.root.isConnected) { toTopLayer(buddy.root); return; }
      const root = document.createElement("div"); root.id = "agywe-buddy";
      const wrap = document.createElement("div"); wrap.className = "agywe-bwrap";
      const mk = () => { const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.disablePictureInPicture = true; v.setAttribute("aria-hidden", "true"); v.addEventListener("loadedmetadata", () => { if (v.videoWidth && v.videoHeight) wrap.style.aspectRatio = v.videoWidth + " / " + v.videoHeight; }); return v; };
      buddy.vids = [mk(), mk()];
      wrap.append(...buddy.vids);
      const bub = document.createElement("div"); bub.className = "agywe-bbub";
      bub.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); if (mood.state) clearMood(); else bub.classList.remove("show"); });
      root.append(wrap, bub);
      document.documentElement.appendChild(root);
      buddy.root = root; buddy.wrap = wrap; buddy.bubble = bub; buddy.cur = -1; buddy.clip = "";
      bindBuddy(root);
      toTopLayer(root);
      placeBuddy();
      clearInterval(buddy.idleT);
      buddy.idleT = setInterval(buddyIdleTick, 5000);
    }
    function buddyPlay(name, loop, then) {
      if (!buddy.root || !buddy.vids.length) return;
      if (!buddyHas(name)) name = "idle";
      buddy.then = then || null; buddy.oneShot = !loop;
      if (!loop) buddy.lastAct = Date.now();
      const curV = buddy.vids[buddy.cur];
      if (name === buddy.clip && curV) {
        curV.loop = !!loop; buddy.loop = !!loop;
        if (!loop) { try { curV.currentTime = 0; } catch { } }
        if (curV.paused && !document.hidden) curV.play().catch(() => { });
        return;
      }
      buddy.clip = name; buddy.loop = !!loop;
      const nextI = buddy.cur === 0 ? 1 : 0, v = buddy.vids[nextI], old = curV;
      const tok = ++buddy.tok;
      v.loop = !!loop;
      v.onerror = () => {
        if (tok !== buddy.tok) return;
        if (buddy.err++ < 3) diagLite("buddy-video-error", { clip: name, code: v.error && v.error.code });
        buddy.oneShot = false; buddy.then = null;
        if (name !== "idle") { buddy.clip = ""; buddyPlay("idle", true); }
      };
      v.onplaying = () => {
        if (tok !== buddy.tok) return;
        v.classList.add("on");
        if (old && old !== v) { old.classList.remove("on"); setTimeout(() => { if (tok === buddy.tok) { try { old.pause(); } catch { } } }, 160); }
        buddy.cur = nextI;
      };
      v.onended = () => {
        if (tok !== buddy.tok || v.loop) return;
        const t = buddy.then; buddy.then = null; buddy.oneShot = false;
        if (t) { try { t(); } catch { buddyUpdate(); } } else buddyUpdate();
      };
      v.src = ORIGIN + "/buddy/" + encodeURIComponent(name) + "?v=" + encodeURIComponent(String(buddyCfg().stamp || 0));
      if (!document.hidden) v.play().catch(() => { });
    }
    function buddyBase() {
      if (mood.state === "attention") return bclip("waiting");
      if (mood.state === "error") return bclip("emotion-serious", "waiting");
      if (agents > 0) return bclip("working", "reviewing");
      return "idle";
    }
    function buddyUpdate() {
      if (!buddyActive() || buddy.oneShot || (buddy.drag && buddy.drag.moved)) return;
      buddyPlay(buddyBase(), true);
    }
    function buddyOnMood(state) {
      if (!buddyActive()) return;
      if (state === "done") buddyPlay(bclip("jump", "emotion-cheerful"), false, () => buddyPlay(bclip("emotion-cheerful", "wave"), false));
      else if (state === "attention") buddyPlay(bclip("emotion-frightened", "waiting"), false);
      else if (state === "error") buddyPlay(bclip("fail", "emotion-confused"), false);
      else { buddy.oneShot = false; buddyUpdate(); }
    }
    function buddyIdleTick() {
      if (!buddyActive()) return;
      const vis = !document.hidden && !hideAll;
      const v = buddy.vids[buddy.cur];
      if (v) { if (!vis && !v.paused) { try { v.pause(); } catch { } } else if (vis && v.paused && !(v.ended && !v.loop)) v.play().catch(() => { }); }
      if (!vis || buddy.oneShot || buddy.drag || mood.state || agents > 0 || buddyCfg().idle === false || (cfg && cfg.lowSpec)) return;
      const quiet = Date.now() - buddy.lastAct;
      if (quiet < 45000 || Math.random() > 0.18) return;
      const pool = ["look", "look", "look", "emotion-starry", "emotion-confused", "wave", "emotion-shy"].filter(buddyHas);
      if (pool.length) buddyPlay(pool[Math.floor(Math.random() * pool.length)], false);
    }
    function buddySay(text, ms, kind, sticky) {
      const b = buddy.bubble; if (!b || !text) return;
      b.textContent = "";
      const lines = String(text).split("\n");
      b.appendChild(document.createTextNode(lines[0]));
      if (lines[1]) { const s = document.createElement("span"); s.className = "agywe-sub"; s.textContent = lines.slice(1).join(" "); b.appendChild(s); }
      b.dataset.mood = kind || "talk";
      b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
      clearTimeout(buddy.sayT);
      if (!sticky) buddy.sayT = setTimeout(() => { if (!mood.state) b.classList.remove("show"); }, ms || 4500);
    }
    function buddyMoodBubble() {
      if (!buddyReplacing() || !buddy.bubble) return;
      if (!mood.state) { buddy.bubble.classList.remove("show"); return; }
      const sub = moodSub();
      buddySay((mood.state === "done" ? "✓ " : mood.state === "attention" ? "! " : "✕ ") + moodText(mood.state) + (sub ? "\n" + sub : ""), 0, mood.state, true);
    }
    const BUDDY_PAT = ["emotion-shy", "emotion-cheerful", "emotion-starry", "jump"];
    const BUDDY_LINES = ["喵～", "别戳啦，在干活呢", "摸摸头～", "今天也辛苦啦", "要不要歇一会儿？", "嘿嘿"];
    function bindBuddy(root) {
      root.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const p = buddy.pos || buddyPosLoad();
        buddy.drag = { x: e.clientX, y: e.clientY, r: p.r, b: p.b, moved: false, lastX: e.clientX };
        try { root.setPointerCapture(e.pointerId); } catch { }
        try { closeMenu(); } catch { }
      });
      root.addEventListener("pointermove", (e) => {
        const d = buddy.drag; if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 5) return;
        if (!d.moved) { d.moved = true; root.classList.add("agywe-hold"); }
        buddy.pos = { r: d.r - dx, b: d.b - dy }; placeBuddy();
        const step = e.clientX - d.lastX;
        if (Math.abs(step) >= 6) {
          const dir = step < 0 ? -1 : 1; d.lastX = e.clientX;
          if (dir !== buddy.moveDir) { buddy.moveDir = dir; buddy.oneShot = false; buddyPlay(bclip(dir < 0 ? "move-left" : "move-right"), true); }
        }
      });
      const end = (e, cancel) => {
        const d = buddy.drag; buddy.drag = null;
        try { root.releasePointerCapture(e.pointerId); } catch { }
        root.classList.remove("agywe-hold");
        if (!d) return;
        if (d.moved) {
          buddy.moveDir = 0;
          const p = buddy.pos; try { localStorage.setItem(BUDDY_POS, JSON.stringify(p)); } catch { }
          buddy.oneShot = false; buddyUpdate();
          return;
        }
        if (cancel) return;
        // 单击：先等一下看是不是双击
        clearTimeout(buddy.clickT);
        buddy.clickT = setTimeout(() => {
          if (mood.state) { clearMood(); return; }
          try { sfxPlay("pet"); } catch { }
          buddyPlay(BUDDY_PAT.filter(buddyHas)[Math.floor(Math.random() * BUDDY_PAT.filter(buddyHas).length)] || "idle", false);
          if (Math.random() < 0.45) buddySay(BUDDY_LINES[Math.floor(Math.random() * BUDDY_LINES.length)], 2600);
        }, 260);
      };
      root.addEventListener("pointerup", (e) => end(e, false));
      root.addEventListener("pointercancel", (e) => end(e, true));
      root.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); clearTimeout(buddy.clickT); toggleUseCard(); });
      root.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX + 4, e.clientY + 4); });
    }
    function buddyHide() {
      if (cfg) cfg.buddy = { ...buddyCfg(), on: false };
      post({ type: "agywe:save-cfg", patch: { buddy: { ...buddyCfg(), on: false } } });
      removeBuddy();
      toast("桌宠先休息啦，到设置「挂件」里可以叫回来");
    }
    document.addEventListener("visibilitychange", () => { try { buddyIdleTick(); } catch { } });
    window.addEventListener("resize", () => { try { placeBuddy(); } catch { } }, { passive: true });

    // ---- 倒数日小组件 ----
    function cdDays(x) {
      const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const [Y, M, D] = x.date.split("-").map(Number);
      let d = new Date(Y, M - 1, D);
      if (x.yearly) { d = new Date(t0.getFullYear(), M - 1, D); if (d < t0) d = new Date(t0.getFullYear() + 1, M - 1, D); }
      return Math.round((d - t0) / 86400000);
    }
    function removeCd() { if (dock.cd) { try { dock.cd.el.remove(); } catch { } dock.cd = null; placeDock(); } }
    function renderCd() {
      if (!widOn("countdown")) { removeCd(); return; }
      ensureDock();
      let c = dock.cd;
      if (!c || !c.el.isConnected) {
        const el = document.createElement("div"); el.className = "agywe-card agywe-cdn";
        const hd = document.createElement("div"); hd.className = "agywe-wh"; hd.textContent = "⏳ 倒数日";
        const list = document.createElement("div");
        el.append(hd, list, cardClose("countdown", "这次先收起（「小组件」页可以关掉）"));
        c = dock.cd = { el, list, sig: "" }; dock.root.appendChild(el);
      }
      const items = cdList().map((x) => ({ ...x, n: cdDays(x) })).filter((x) => x.n >= -30);
      items.sort((a, b) => (a.n < 0) - (b.n < 0) || Math.abs(a.n) - Math.abs(b.n));
      const sig = JSON.stringify(items.slice(0, 5).map((x) => [x.name, x.n]));
      if (sig === c.sig) return;
      c.sig = sig;
      c.list.textContent = "";
      if (!items.length) { const e = document.createElement("div"); e.className = "agywe-empty"; e.textContent = "到「小组件」页添加想数的日子"; c.list.appendChild(e); }
      for (const x of items.slice(0, 5)) {
        const r = document.createElement("div"); r.className = "agywe-ci" + (x.n === 0 ? " today" : x.n < 0 ? " past" : "");
        const nm = document.createElement("span"); nm.textContent = x.name || x.date; nm.title = x.date + (x.yearly ? "（每年）" : "");
        const b = document.createElement("b"); const sm = document.createElement("small");
        if (x.n === 0) { b.textContent = "🎉"; sm.textContent = "就是今天"; }
        else if (x.n > 0) { b.textContent = String(x.n); sm.textContent = "天后"; }
        else { b.textContent = String(-x.n); sm.textContent = "天前"; }
        r.append(nm, b, sm); c.list.appendChild(r);
      }
      placeDock();
    }

    // ---- 白噪音：全部现场合成（雨声 / 海浪 / 篝火 / 溪流 / 风扇），番茄钟专注时可以自动放 ----
    const NOISE_LABEL = { rain: "雨声", wave: "海浪", fire: "篝火", stream: "溪流", fan: "风扇" };
    const noise = { out: null, nodes: [], timers: [], type: "", playing: false, byPomo: false, bufs: null };
    function noiseCfg() { return { type: "rain", volume: .35, withPomo: false, ...((cfg && cfg.noise) || {}) }; }
    function noiseBufs(c) {
      if (noise.bufs && noise.bufs.rate === c.sampleRate) return noise.bufs;
      const len = Math.floor(c.sampleRate * 4);
      const mk = (fill) => { const b = c.createBuffer(1, len, c.sampleRate); fill(b.getChannelData(0)); return b; };
      const white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
      const pink = mk((d) => { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926; } });
      const brown = mk((d) => { let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } });
      return (noise.bufs = { rate: c.sampleRate, white, pink, brown });
    }
    function noiseSrc(c, buf, out, filters, gain) {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      let node = s;
      for (const f of filters || []) { const b = c.createBiquadFilter(); b.type = f[0]; b.frequency.value = f[1]; if (f[2]) b.Q.value = f[2]; node.connect(b); node = b; }
      const g = c.createGain(); g.gain.value = gain; node.connect(g); g.connect(out);
      s.start(0, Math.random() * 3);
      noise.nodes.push(s);
      return g;
    }
    function noiseStop(fade) {
      const nodes = noise.nodes, out = noise.out;
      for (const t of noise.timers) clearInterval(t);
      noise.timers = []; noise.nodes = []; noise.out = null;
      noise.playing = false; noise.byPomo = false;
      if (!out) return;
      try {
        const c = out.context, t = c.currentTime, d = fade === false ? .03 : .8;
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + d);
        setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { } } try { out.disconnect(); } catch { } }, d * 1000 + 100);
      } catch { }
    }
    function noiseVol() { return clamp(Number(noiseCfg().volume), 0, 1) * .9; }
    function noiseStart(type, byPomo) {
      type = NOISE_LABEL[type] ? type : noiseCfg().type;
      if (!NOISE_LABEL[type]) type = "rain";
      noiseStop(false);
      const c = sfxCtx(); if (!c) return false;
      const B = noiseBufs(c);
      const out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
      noise.out = out; noise.type = type; noise.playing = true; noise.byPomo = !!byPomo;
      const t = c.currentTime; out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(noiseVol(), t + 1.5);
      if (type === "rain") {
        noiseSrc(c, B.pink, out, [["highpass", 350], ["lowpass", 6500]], .9);
        const drops = noiseSrc(c, B.white, out, [["bandpass", 3200, .8]], .12);
        noise.timers.push(setInterval(() => { try { drops.gain.setTargetAtTime(.05 + Math.random() * .18, c.currentTime, .05); } catch { } }, 110));
      } else if (type === "wave") {
        const g = noiseSrc(c, B.brown, out, [["lowpass", 900]], .55);
        const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = .085; depth.gain.value = .42; lfo.connect(depth); depth.connect(g.gain); lfo.start(); noise.nodes.push(lfo);
        noiseSrc(c, B.pink, out, [["highpass", 1200], ["lowpass", 5000]], .08);
      } else if (type === "fire") {
        noiseSrc(c, B.brown, out, [["lowpass", 480]], .9);
        noise.timers.push(setInterval(() => {
          if (Math.random() > .4 || !noise.out) return;
          try {
            const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + Math.random() * .08, dur = .01 + Math.random() * .04;
            s.buffer = B.white; f.type = "highpass"; f.frequency.value = 1200 + Math.random() * 2500;
            g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.15 + Math.random() * .45, t0 + .002); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
            s.connect(f); f.connect(g); g.connect(noise.out); s.start(t0, Math.random() * 3); s.stop(t0 + dur + .02);
          } catch { }
        }, 90));
      } else if (type === "stream") {
        const g = noiseSrc(c, B.pink, out, [["bandpass", 1100, .5], ["lowpass", 4200]], .8);
        noiseSrc(c, B.brown, out, [["lowpass", 300]], .25);
        noise.timers.push(setInterval(() => { try { g.gain.setTargetAtTime(.55 + Math.random() * .45, c.currentTime, .04); } catch { } }, 80));
      } else {
        noiseSrc(c, B.brown, out, [["lowpass", 1400]], .85);
        noiseSrc(c, B.pink, out, [["bandpass", 180, 2]], .18);
      }
      return true;
    }
    function noiseOp(op, type, quiet) {
      if (op === "stop" || (op === "toggle" && noise.playing && (!type || type === noise.type))) { noiseStop(); if (!quiet) petSay("白噪音停了", 2000, "info"); return; }
      if (noiseStart(type || noiseCfg().type, false) && !quiet) petSay("🎧 " + NOISE_LABEL[noise.type] + " 开始啦", 2400, "info");
    }
    function noiseApplyCfg() { if (noise.playing && noise.out) { try { const c = noise.out.context; noise.out.gain.setTargetAtTime(noiseVol(), c.currentTime, .2); } catch { } } }
    function noisePomoSync() {
      const want = !!(cfg && noiseCfg().withPomo && pomo.st && pomo.st.running && pomo.st.phase === "work" && !hideAll);
      if (want && !noise.playing) noiseStart(noiseCfg().type, true);
      else if (!want && noise.playing && noise.byPomo) noiseStop();
    }

    // ---- 与壁纸页 / 设置页通信 ----
    // v0.11.2：只收插件自己那三个 iframe（壁纸 / 设置 / 快速切换）发来的消息。
    //   光看来源地址不够：agywe://app 下的任何页面地址都一样；再核对来源窗口，别的页面就冒充不了。
    const fromOurFrame = (src) => !!src && [frame, settingsFrame, quickFrame].some((f) => !!f && f.contentWindow === src);
    const droppedMsg = new Set();
    window.addEventListener("message", (e) => {
      if (e.origin !== ORIGIN) return;
      if (!fromOurFrame(e.source)) {
        const t = String((e.data && e.data.type) || "?").slice(0, 40);
        if (!droppedMsg.has(t) && droppedMsg.size < 20) { droppedMsg.add(t); try { diag("msg-dropped", { type: t }); } catch { } }
        return;
      }
      const d = e.data || {};
      if (d.type === "agywe:ready") {
        ready = true; audio.boot = !!d.wantAudio; applyCfg(d.config);
        post({ type: "agywe:agents", count: agents }); post({ type: "agywe:focus", focused: document.hasFocus() });
        post({ type: "agywe:theme", darkText: darkText == null ? null : darkText }); post({ type: "agywe:audio-state", state: audio.state });
        sendContext(true);
        post({ type: "agywe:hideall", on: hideAll }); powerSync(); post({ type: "agywe:winfocus", focused: winFocused });
        diag("wall-ready");
        setTimeout(() => { try { scanGlass(); updateHoles(); diag("glass-report", { glass: glassReport(), glassPerf: perfSummary() }); } catch { } }, 5000);
      }
      else if (d.type === "agywe:config") { audio.boot = false; if (ready) applyCfg(d.config); else if (d.config) { cfg = d.config; ensureFrame(); zhApply(); } }
      else if (d.type === "agywe:close-settings") toggleSettings(false);
      else if (d.type === "agywe:pick-glass") startPick();
      else if (d.type === "agywe:pick-pet") startPick("pet");
      else if (d.type === "agywe:first-frame") splashWall();
      else if (d.type === "agywe:splash-preview") splashPreview();
      else if (d.type === "agywe:mood-test") { toggleSettings(false); const m = String(d.mood || ""); setTimeout(() => setMood(m, "", true), 350); }
      else if (d.type === "agywe:want-context") sendContext(true);
      else if (d.type === "agywe:want-contrast") sendContrast();
      else if (d.type === "agywe:selftest") { try { settingsFrame && settingsFrame.contentWindow && settingsFrame.contentWindow.postMessage({ type: "agywe:selftest-page", r: selfReport() }, ORIGIN); } catch { } }
      else if (d.type === "agywe:noise") { noiseOp(String(d.op || "toggle"), String(d.kind || ""), !!d.quiet); try { settingsFrame && settingsFrame.contentWindow && settingsFrame.contentWindow.postMessage({ type: "agywe:noise-state", playing: noise.playing, kind: noise.type }, ORIGIN); } catch { } }
      else if (d.type === "agywe:noise-ask") { try { settingsFrame && settingsFrame.contentWindow && settingsFrame.contentWindow.postMessage({ type: "agywe:noise-state", playing: noise.playing, kind: noise.type }, ORIGIN); } catch { } }
      else if (d.type === "agywe:care-test") { toggleSettings(false); const k = String(d.kind || ""); setTimeout(() => careTest(k), 350); }
      else if (d.type === "agywe:outfit") { if (pet && !mood.state && !hideAll) { petAct("spin", 900); petSay("换上「" + String(d.name || "新衣服").slice(0, 16) + "」啦", 2600, "info"); } }
      else if (d.type === "agywe:palette") { palette = d.palette && typeof d.palette === "object" ? d.palette : null; applyTheme(); setTimeout(tbSync, 300); try { if (palette) ipcRenderer.send("agywe:palette", palette); } catch { } }
      else if (d.type === "agywe:switched" || d.type === "agywe:faved" || d.type === "agywe:paused") onWallAct(d);
      else if (d.type === "agywe:close-quick") toggleQuick(false);
      else if (d.type === "agywe:open-quick") { toggleSettings(false); setTimeout(() => toggleQuick(true), 120); }
      else if (d.type === "agywe:pomo") { const op = String(d.op || ""); if (op === "start") toggleSettings(false); pomoOp(op, true); }
      else if (d.type === "agywe:sfx-test") sfxPlay(String(d.name || "done"), { test: true, kind: String(d.kind || "") });
      else if (d.type === "agywe:idle-test") { toggleSettings(false); const a = String(d.act || ""); setTimeout(() => idleTest(a), 350); }
      else if (d.type === "agywe:save-failed") petSay(String(d.what || "设置").slice(0, 16) + "没保存上，已经恢复成实际生效的设置", 3600, "info");
      else if (d.type === "agywe:failed") { ready = false; lastErr = d.error || "failed"; applyCfg(cfg); diag("wall-failed"); splashWall(); }
    });

    // 主进程截获 Ctrl+Alt+W 后发过来（焦点在内置浏览器等地方时页面收不到按键）
    try { ipcRenderer.on("agywe:toggle-settings", () => toggleSettings()); } catch { }
    try { ipcRenderer.on("agywe:hotkey", (_e, a) => { try { onHotkey(String(a || "")); } catch { } }); } catch { }

    // ---- 鼠标转发（视差 / 点击交互）----
    let pending = null, raf = 0;
    const flushPointer = () => { raf = 0; if (pending) { post(pending); pending = null; } };
    const onPointer = (e) => {
      if (!cfg || !cfg.mouse || !ready) return;
      pending = { type: "agywe:pointer", u: e.clientX / innerWidth, v: e.clientY / innerHeight, buttons: e.buttons | 0 };
      if (!raf) raf = requestAnimationFrame(flushPointer);
    };
    ["pointermove", "pointerdown", "pointerup"].forEach((t) => window.addEventListener(t, onPointer, { capture: true, passive: true }));
    document.addEventListener("mouseleave", () => post({ type: "agywe:pointer-leave" }), { passive: true });
    window.addEventListener("focus", () => post({ type: "agywe:focus", focused: true }));
    window.addEventListener("blur", () => post({ type: "agywe:focus", focused: false }));

    window.addEventListener("keydown", (e) => {
      if (hkMatch(e, "settings")) { e.preventDefault(); toggleSettings(); }
      if (e.key === "Escape" && settingsFrame) toggleSettings(false);
    }, true);
    window.addEventListener("resize", () => { scanUrgent = true; try { jumpSched(); if (cc.el) ccUpdate(); } catch { } scheduleScan(); updateHoles(); placePet(); fxResize(); scheduleAvatars(); try { placeDock(); } catch { } }, { passive: true });

    // =====================================================================
    // v0.10.3 右上角小图标按钮的诊断：每个按钮本身 / 伪元素 / 子元素 / 兄弟元素的底色都记下来
    // =====================================================================
    function iconReport() {
      const W = innerWidth, out = [];
      try {
        for (const el of document.querySelectorAll('button, [role="button"], .agy-button')) {
          if (out.length >= 24) break;
          if (isOurs(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.width > 64 || r.height > 64 || r.top > 170 || r.bottom < 0 || r.left < W - 420 || r.left > W) continue;
          const cs = getComputedStyle(el), b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
          const kids = [...el.querySelectorAll("*")].slice(0, 8).map((k) => k.tagName + ":" + getComputedStyle(k).backgroundColor).filter((s) => !/rgba\(0, 0, 0, 0\)$/.test(s));
          const par = el.parentElement;
          out.push({
            label: (el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 40),
            rect: [r.left, r.top, r.width, r.height].map(Math.round),
            bg: cs.backgroundColor, bgImg: String(cs.backgroundImage).slice(0, 60), shadow: String(cs.boxShadow).slice(0, 60), outline: cs.outlineStyle !== "none" ? cs.outlineColor : "",
            before: b.content !== "none" ? b.backgroundColor + " " + String(b.boxShadow).slice(0, 30) : "", after: a.content !== "none" ? a.backgroundColor + " " + String(a.boxShadow).slice(0, 30) : "",
            glass: el.getAttribute("data-agywe-glass") || "", pse: el.getAttribute("data-agywe-pse") || "", hot: el.matches(":hover"),
            state: PSE_STATE.map((x) => el.getAttribute(x) ? x + "=" + el.getAttribute(x) : "").filter(Boolean).join(","),
            cls: (el.getAttribute("class") || "").slice(0, 200), kids,
            parent: par ? (par.getAttribute("class") || "").slice(0, 60) + " / " + getComputedStyle(par).backgroundColor : "",
            sib: par ? [...par.children].filter((s) => s !== el).slice(0, 4).map((s) => { const q = s.getBoundingClientRect(); return s.tagName + ":" + getComputedStyle(s).backgroundColor + "@" + [q.left, q.top, q.width, q.height].map(Math.round).join(","); }) : []
          });
        }
      } catch { }
      return out;
    }
    // v0.10.6 浮层诊断：页面上每个菜单 / 弹窗 / 提示气泡的底色、被当成什么、鼠标在不在上面
    function overlayReport() {
      const out = [];
      try {
        for (const el of document.querySelectorAll(DIALOG_SEL)) {
          if (out.length >= 16 || isOurs(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 20) continue;
          const chain = [];
          for (let p = el, n = 0; p && n < 4; p = p.firstElementChild, n++) {
            const cs = getComputedStyle(p);
            chain.push({ tag: p.tagName, cls: (p.getAttribute("class") || "").slice(0, 80), bg: cs.backgroundColor, bf: cs.backdropFilter, glass: p.getAttribute("data-agywe-glass") || "", hot: p.matches(":hover") });
          }
          out.push({ role: el.getAttribute("role") || "", kind: overlayKind(el), rect: [r.left, r.top, r.width, r.height].map(Math.round), chain });
        }
      } catch { }
      return out;
    }
    // v0.10.4 输入框外圈的诊断：从输入框往上 9 层，每层的边框 / 阴影 / 描边 / 伪元素
    function composerReport() {
      const out = [];
      try {
        const f = [...document.querySelectorAll(FIELD_SEL)].find((x) => { if (isOurs(x)) return false; const r = x.getBoundingClientRect(); return r.width > 200 && r.top > innerHeight * 0.5; });
        for (let el = f, n = 0; el && el !== document.body && n < 9; el = el.parentElement, n++) {
          const cs = getComputedStyle(el), b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
          const r = el.getBoundingClientRect();
          const pe = (p) => p.content && p.content !== "none" ? [p.backgroundColor, p.borderTopWidth + " " + p.borderTopColor, String(p.boxShadow).slice(0, 80)].join(" | ") : "";
          out.push({ tag: el.tagName, cls: (el.getAttribute("class") || "").slice(0, 120), rect: [r.left, r.top, r.width, r.height].map(Math.round), bg: cs.backgroundColor, glass: el.getAttribute("data-agywe-glass") || "",
            border: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor, shadow: String(cs.boxShadow).slice(0, 160), outline: cs.outlineStyle !== "none" ? cs.outlineWidth + " " + cs.outlineColor : "", pad: cs.paddingTop, before: pe(b), after: pe(a) });
        }
      } catch { }
      return out;
    }
    // 鼠标从一个按钮上移开：它的悬停颜色没了，马上再看一眼（以前要等下一轮补漏扫描）
    let hotBtn = null, iconRepAt = 0;
    try {
      document.addEventListener("pointerover", (e) => {
        const t = e.target;
        const b = t && t.closest ? t.closest('button, [role="button"], .agy-button') : null;
        if (b === hotBtn) return;
        const prev = hotBtn; hotBtn = b;
        if (prev && prev.isConnected && ready && cfg && cfg.enabled && cfg.glass && !hideAll) setTimeout(() => { try { pseSig.delete(prev); queueFresh(prev); scheduleScan(); } catch { } }, 160);
      }, { capture: true, passive: true });
      // 点了右上角的小按钮（比如右侧面板开关）：2.5 秒后自动记一份毛玻璃报告，20 秒最多一次
      document.addEventListener("pointerdown", (e) => {
        try {
          if (e.clientY > 170 || e.clientX < innerWidth - 420 || Date.now() - iconRepAt < 20000) return;
          const t = e.target, b = t && t.closest ? t.closest('button, [role="button"], .agy-button') : null;
          if (!b || isOurs(b)) return;
          iconRepAt = Date.now();
          setTimeout(() => { try { pseSig = new WeakMap(); scanGlass(); diag("glass-report", { glass: glassReport(), glassPerf: perfSummary(), why: "icon-click" }); } catch { } }, 2500);
        } catch { }
      }, { capture: true, passive: true });
    } catch { }

    // =====================================================================
    // v0.10.3 界面汉化（插件内置）：只换界面上的固定文字（按钮、菜单、标题、提示），
    // 整段文字必须和词表完全对上才换，对话内容、代码、输入框、编辑器里的字都不碰。
    // 不改 Antigravity 的任何文件；关掉「界面汉化」会把换过的字还原。
    // =====================================================================
    const ZH = {
      // 顶部菜单
      "File": "文件", "Edit": "编辑", "View": "视图", "Window": "窗口", "Help": "帮助", "Workspace": "工作区", "Workspaces": "工作区",
      "Undo": "撤销", "Redo": "重做", "Cut": "剪切", "Copy": "复制", "Paste": "粘贴", "Select All": "全选", "Delete": "删除", "Find": "查找", "Replace": "替换",
      "Reload": "重新加载", "Force Reload": "强制重新加载", "Toggle Developer Tools": "开发者工具", "Actual Size": "实际大小", "Zoom In": "放大", "Zoom Out": "缩小", "Reset Zoom": "重置缩放",
      "Toggle Full Screen": "全屏", "Enter Full Screen": "进入全屏", "Exit Full Screen": "退出全屏", "Minimize": "最小化", "Maximize": "最大化", "Restore": "还原", "Zoom": "缩放", "Close": "关闭",
      "Close Window": "关闭窗口", "New Window": "新建窗口", "Quit": "退出", "Quit Antigravity": "退出 Antigravity", "About": "关于", "About Antigravity": "关于 Antigravity",
      "Check for Updates": "检查更新", "Check for Updates...": "检查更新…", "Check for updates": "检查更新", "Restart to Update": "重启以更新", "Preferences": "偏好设置", "Keyboard Shortcuts": "键盘快捷键", "Keyboard shortcuts": "键盘快捷键",
      // 侧边栏
      "Sidebar": "侧边栏", "Toggle Sidebar": "切换侧边栏", "Toggle sidebar": "切换侧边栏", "Toggle Side Panel": "切换侧边面板", "Toggle side panel": "切换侧边面板", "Toggle Panel": "切换面板", "Side Panel": "侧边面板",
      "Open Sidebar": "打开侧边栏", "Close Sidebar": "关闭侧边栏", "Collapse Sidebar": "收起侧边栏", "Expand Sidebar": "展开侧边栏", "Toggle Terminal": "切换终端",
      "New Conversation": "新建对话", "New conversation": "新建对话", "New Chat": "新建对话", "New chat": "新建对话", "Automations": "自动化任务", "Automation": "自动化任务", "New Automation": "新建自动化任务",
      "Customizations": "技能与自定义", "Customization": "技能与自定义", "Projects": "项目管理", "Project": "项目", "Conversations": "对话管理", "Conversation": "对话", "Settings": "系统设置",
      "New Project": "新建项目", "Create Project": "创建项目", "Create project": "创建项目", "No Project": "未关联项目", "No project": "未关联项目", "Outside of project": "未关联项目", "Outside of Project": "未关联项目",
      "Inbox": "收件箱", "Agent Manager": "Agent 管理器", "Search": "搜索", "Search conversations": "搜索对话", "Search...": "搜索…", "Recent": "最近", "Recents": "最近", "Pinned": "已置顶", "Archived": "已归档",
      "Today": "今天", "Yesterday": "昨天", "Previous 7 Days": "过去 7 天", "Previous 7 days": "过去 7 天", "Previous 30 Days": "过去 30 天", "Previous 30 days": "过去 30 天", "Older": "更早", "This Week": "本周", "This week": "本周", "Last Week": "上周",
      "Pin": "置顶", "Unpin": "取消置顶", "Rename": "重命名", "Archive": "归档", "Unarchive": "取消归档", "Duplicate": "复制一份", "Move to project": "移到项目", "Delete conversation": "删除对话", "Rename conversation": "重命名对话",
      "Show more": "显示更多", "Show less": "收起", "Show all": "显示全部", "See all": "查看全部", "View all": "查看全部", "More": "更多", "More actions": "更多操作", "Options": "选项", "Menu": "菜单",
      // 对话
      "Load older messages": "加载更早消息", "Load more": "加载更多", "No older messages": "没有更早的消息", "Conversation Log": "对话日志", "You said": "您说", "Agent said": "Agent 回复", "You": "您",
      "Ask anything, @ to mention, / for actions": "向 Agent 提问，键入 @ 引用上下文，键入 / 调出快捷操作", "Ask anything, @ to mention, / for actions.": "向 Agent 提问，键入 @ 引用上下文，键入 / 调出快捷操作",
      "Ask anything": "向 Agent 提问", "Send": "发送", "Send message": "发送消息", "Send now": "立即发送", "Queue": "排队等待", "Queued": "排队中", "Stop": "停止", "Stop generating": "停止生成", "Cancel": "取消",
      "Retry": "重试", "Regenerate": "重新生成", "Edit message": "编辑消息", "Copy message": "复制消息", "Copied": "已复制", "Copied!": "已复制", "Copy code": "复制代码", "Copy link": "复制链接", "Copy path": "复制路径",
      "Thinking": "正在思考", "Thinking...": "正在思考…", "Thought": "已思考", "Working": "正在工作", "Working...": "正在工作…", "Running": "正在运行", "Running...": "正在运行…", "Agent is working": "Agent 正在执行", "Agent working": "Agent 正在执行",
      "Analyzed": "已分析", "Analyzing": "正在分析", "Edited": "已编辑", "Editing": "正在编辑", "Created": "已创建", "Creating": "正在创建", "Read": "已读取", "Reading": "正在读取", "Viewed": "已查看", "Searched": "已搜索", "Searching": "正在搜索",
      "Ran": "已运行", "Ran command": "已运行命令", "Run command": "运行命令", "Started": "已启动", "Launched": "已启动", "Completed": "已完成", "Complete": "已完成", "Done": "完成", "Failed": "失败", "Error": "错误", "Cancelled": "已取消", "Canceled": "已取消",
      "Pending": "等待中", "Waiting": "等待中", "Waiting for approval": "等待批准", "Approve": "批准", "Reject": "拒绝", "Deny": "拒绝", "Allow": "允许", "Allow once": "仅允许这一次", "Always allow": "始终允许", "Accept": "接受", "Accept all": "全部接受", "Reject all": "全部拒绝",
      "Review": "审阅", "Review changes": "审阅改动", "Changes": "改动", "Undo changes": "撤销改动", "Revert": "还原", "Checkpoint": "检查点", "Restore checkpoint": "恢复到检查点",
      "Context": "上下文", "Add context": "添加上下文", "Mentions": "引用", "Attach": "附件", "Attach file": "添加附件", "Attach image": "添加图片", "Add image": "添加图片", "Upload": "上传", "Drop files here": "把文件拖到这里",
      "Model": "模型", "Models": "模型", "Select model": "选择模型", "Select a model": "选择模型", "No Model Selected": "未选择模型", "No model selected": "未选择模型",
      "High": "高", "Medium": "中", "Low": "低", "XHigh": "超高", "Extra High": "超高", "Max": "最高", "Fast": "极速", "Fast mode": "极速模式", "Fast Mode": "极速模式",
      "Plan": "规划", "Planning": "规划", "Plan mode": "规划模式", "Ask": "提问", "Voice": "音色", "Voice mode": "语音模式", "Voice Mode": "语音模式", "Microphone": "麦克风",
      "This site can't be reached": "无法访问此网站", "This site can’t be reached": "无法访问此网站", "Open in browser": "在浏览器中打开", "Open in editor": "在编辑器中打开", "Open file": "打开文件", "Open folder": "打开文件夹", "Open Folder": "打开文件夹",
      "Terminal": "终端", "Browser": "浏览器", "Editor": "编辑器", "Files": "文件", "Explorer": "资源管理器", "Problems": "问题", "Output": "输出", "Preview": "预览", "Artifacts": "产出物", "Artifact": "产出物", "Tasks": "任务", "Task": "任务",
      "File Viewer": "文件查看器", "Close tab": "关闭标签页", "Close all": "全部关闭", "Close others": "关闭其他", "Split right": "向右拆分", "New Tab": "新建标签页", "Go back": "后退", "Go forward": "前进", "Refresh": "刷新",
      // 技能与自定义
      "Marketplace": "插件市场", "Installed": "已安装", "Plugins": "扩展插件", "Plugin": "扩展插件", "Skills & Rules": "技能与规则", "Skills": "技能", "Skill": "技能", "Rules": "规则", "Rule": "规则",
      "Workflows": "工作流", "Workflow": "工作流", "MCP Servers": "MCP 服务器", "MCP servers": "MCP 服务器", "Memories": "记忆", "Knowledge": "知识库", "Built In": "内置", "Built-in": "内置", "Global": "全局", "All": "全部",
      "Install": "安装", "Uninstall": "卸载", "Update": "更新", "Configure": "配置", "Connect": "连接", "Connected": "已连接", "Disconnect": "断开连接", "Enable": "启用", "Disable": "停用", "Enabled": "已启用", "Disabled": "已停用",
      "Add": "添加", "Remove": "移除", "Create": "新建", "Browse": "浏览", "Learn more": "了解详情", "Details": "详情", "Overview": "概览", "Author": "作者", "Version": "版本", "Installing...": "正在安装…", "Uninstalling...": "正在卸载…",
      // 设置
      "General": "常规设置", "Appearance": "外观", "Theme": "主题", "Light": "浅色", "Dark": "深色", "System": "系统", "Language": "语言", "Notifications": "通知", "Privacy": "隐私", "Advanced": "高级", "Account": "账号", "Profile": "个人资料",
      "Sign in": "登录", "Sign In": "登录", "Sign out": "退出登录", "Sign Out": "退出登录", "Log out": "退出登录", "Layout": "布局", "Layout mode": "界面布局模式", "Layout Mode": "界面布局模式",
      "Knowledge Work": "知识工作", "Knowledge work": "知识工作", "Software Engineering": "软件工程", "Software engineering": "软件工程",
      "Not set": "未设置", "Change": "更改", "Save": "保存", "Saved": "已保存", "Saving...": "正在保存…", "Reset": "重置", "Apply": "应用", "OK": "确定", "Confirm": "确认", "Yes": "是", "No": "否", "Back": "返回", "Next": "下一步", "Continue": "继续", "Skip": "跳过",
      "On": "开", "Off": "关", "Default": "默认", "Custom": "自定义", "None": "无", "Auto": "自动", "Loading": "正在加载", "Loading...": "正在加载…", "Refreshing...": "正在刷新…", "Unknown": "未知",
      "Feedback": "反馈", "Send feedback": "发送反馈", "Report issue": "报告问题", "Report an issue": "报告问题", "Documentation": "文档", "Docs": "文档", "Changelog": "更新日志", "Release notes": "更新说明", "What's new": "新功能",
      // 用量 / 套餐
      "Usage": "用量", "Gemini models": "Gemini 模型", "Gemini Models": "Gemini 模型", "Weekly limit": "每周限额", "Weekly Limit": "每周限额", "5-hour limit": "5 小时限额", "5 hour limit": "5 小时限额", "Daily limit": "每日限额",
      "View plans": "查看套餐", "View Plans": "查看套餐", "Upgrade": "升级", "Upgrade plan": "升级套餐", "Plans": "套餐", "Billing": "账单", "Enable overages": "启用超额抵扣", "Enable Overages": "启用超额抵扣", "Enable overage": "启用超额抵扣",
      "Today's usage": "今日用量", "This month": "本月", "remaining": "剩余", "left": "剩余", "used": "已用",
      // 其他
      "Schedule": "计划", "Trigger": "触发条件", "Triggers": "触发条件", "Runs": "运行记录", "Last run": "上次运行", "Next run": "下次运行", "Run now": "立即运行", "Pause": "暂停", "Resume": "继续", "Paused": "已暂停", "Active": "进行中",
      "Name": "名称", "Description": "描述", "Status": "状态", "Type": "类型", "Date": "日期", "Size": "大小", "Path": "路径", "Location": "位置", "Owner": "所有者", "Updated": "更新于", "Created at": "创建于",
      "Share": "分享", "Download": "下载", "Export": "导出", "Import": "导入", "Expand": "展开", "Collapse": "收起", "Expand all": "全部展开", "Collapse all": "全部收起", "Filter": "筛选", "Sort": "排序", "Clear": "清除", "Clear all": "全部清除",
      // v0.10.4 补充（设置页、对话里的按钮提示等）
      "Typeahead menu": "联想菜单", "Display Options": "显示选项", "Create New Project": "新建项目", "Archive conversation": "归档对话", "Pin conversation": "置顶对话", "Unpin conversation": "取消置顶对话", "More options": "更多选项", "Announcements and tips": "公告与提示", "Message input": "消息输入框", "Record voice memo": "录制语音", "Go Back": "后退", "Go Forward": "前进", "Search Conversations": "搜索对话", "Start Voice mode": "开始语音模式", "Start voice mode": "开始语音模式", "Edits the conversation title": "编辑对话标题", "Toggle Overview Panel": "切换概览面板", "New tab": "新建标签页", "Custom View": "自定义视图", "Enter a URL (e.g. http://localhost:8080)": "输入网址（例如 http://localhost:8080）", "Address bar": "地址栏", "Inspect element to comment": "选中页面元素来评论", "Add screenshot to conversation": "把截图加入对话", "Open in external browser": "在外部浏览器中打开", "Conversation turns": "对话轮次", "Response actions": "回复操作", "Good response": "回答得好", "Bad response": "回答得不好", "Undo to this point": "撤销到这里", "Scroll to Bottom": "滚动到底部", "Scroll to bottom": "滚动到底部", "Maximize Pane": "最大化窗格", "Restore Pane": "还原窗格", "Not in Project": "未关联项目", "Give Feedback": "提交反馈", "Give feedback": "提交反馈", "Manage your plan, credentials, and general preferences.": "管理套餐、凭据和常规偏好设置。", "Enable Telemetry": "发送使用数据", "Marketing Emails": "营销邮件", "By using this app, you agree to its": "使用本应用即表示你同意其", "Terms of Service": "服务条款", "Privacy Policy": "隐私政策", "Interface Layout": "界面布局", "Global Permissions": "全局权限", "Configure global allowed and denied resource permissions.": "配置全局允许和拒绝的资源权限。", "Permission preset": "权限预设", "Controls the actions the agent can take.": "控制 Agent 可以执行哪些操作。", "Tool permissions": "工具权限", "Modify permissions for file, terminal, and MCP tools.": "修改文件、终端和 MCP 工具的权限。", "Network access rules": "网络访问规则", "Configure allowed and denied URLs for reading.": "配置允许和禁止读取的网址。", "Input Box": "输入框", "Queued messages": "排队消息", "Configure when follow-up messages are sent.": "设置后续消息什么时候发送。", "Queue until after the current turn.": "等当前这一轮结束后再发送。", "Interrupt the agent and send immediately.": "打断 Agent，立即发送。", "Send Immediately": "立即发送", "Send immediately": "立即发送", "Choose which key sends a message in the chat composer.": "选择在输入框里用哪个键发送消息。", "Press Enter to send, Shift+Enter for a new line.": "按 Enter 发送，Shift+Enter 换行。", "Press Ctrl+Enter to send, Enter for a new line.": "按 Ctrl+Enter 发送，Enter 换行。", "The voice used in Voice mode. Powered by Gemini Live.": "语音模式下使用的声音。由 Gemini Live 驱动。", "Input device for voice mode and dictation.": "语音模式和听写使用的输入设备。", "System default": "系统默认", "How loud Antigravity's voice is.": "Antigravity 说话的音量。", "How loud Antigravity’s voice is.": "Antigravity 说话的音量。", "Voice volume": "语音音量", "Configure the agent's visual theme and display preferences.": "配置 Agent 的界面主题和显示偏好。", "Configure the agent’s visual theme and display preferences.": "配置 Agent 的界面主题和显示偏好。", "Conversation Steps": "对话步骤", "Choose how much detail is shown during a conversation.": "选择对话过程中显示多少细节。", "Font Size": "字号", "Font size": "字号", "Font": "字体", "Font Family": "字体", "Dark Theme": "深色主题", "Light Theme": "浅色主题", "Default Dark": "默认深色", "Default Light": "默认浅色", "Background color picker": "背景色选择器", "Foreground color picker": "前景色选择器", "Accent color picker": "强调色选择器", "Code Preview": "代码预览", "Advanced Settings": "高级设置", "Advanced settings": "高级设置", "Manage your notification preferences.": "管理通知偏好设置。", "Enable Notifications for Agent": "Agent 通知", "Enable Sounds for Agent": "Agent 提示音", "Set the volume of agent sounds.": "设置 Agent 提示音的音量。", "Chime volume": "提示音音量", "Configure default behaviors, skills, and MCP servers.": "配置默认行为、技能和 MCP 服务器。", "Token Usage": "Token 用量", "No token data available.": "暂无 Token 数据。", "Loading workspace customizations...": "正在加载工作区自定义项…", "Loading workspace customizations…": "正在加载工作区自定义项…", "Build With Google Plugins": "Build With Google 插件", "Built-in Browser": "内置浏览器", "Open Links In": "链接打开方式", "Choose where links open by default when clicked.": "选择点击链接时默认在哪里打开。", "External Browser": "外部浏览器", "Download Location": "下载位置", "Change…": "更改…", "Change...": "更改…", "Browsing History": "浏览记录", "Browser Subagent": "浏览器子 Agent", "Browser Actuation Rules": "浏览器操作规则", "Manage Antigravity app settings.": "管理 Antigravity 应用设置。", "Application": "应用", "Shortcuts": "快捷键", "Prevent Sleep": "阻止休眠", "Prevent the computer from sleeping while the app is running.": "应用运行时阻止电脑进入睡眠。", "Keep In Menu Bar": "常驻托盘", "Keep in Menu Bar": "常驻托盘", "Keep the app accessible from the menu bar and running in the background when all windows are closed.": "关闭所有窗口后，应用仍留在托盘里后台运行。", "Remote Control": "远程控制", "Enable Remote Control": "启用远程控制", "Work with local agents from another device.": "从另一台设备使用这台电脑上的 Agent。", "Notification Settings": "通知设置", "To modify notification settings, open your operating system's system preferences.": "要修改通知设置，请打开系统设置。", "To modify notification settings, open your operating system’s system preferences.": "要修改通知设置，请打开系统设置。", "Open System Preferences": "打开系统设置", "App version": "应用版本", "App Version": "应用版本", "Feedback Type": "反馈类型", "Bug Report": "问题反馈", "Feature Request": "功能建议", "Auth and Billing": "登录与账单", "Other": "其他", "Submit": "提交", "Show plan": "查看计划", "Steps": "步骤", "Compact": "简洁", "Detailed": "详细", "Verbose": "完整", "Minimal": "极简", "Expanded": "展开", "Collapsed": "收起", "Permissions": "权限", "Allowed": "允许", "Denied": "禁止", "Add rule": "添加规则", "Interface": "界面", "Display": "显示", "Sounds": "声音", "Volume": "音量", "Shortcut": "快捷键", "Keybindings": "快捷键", "Command": "命令", "Reset to default": "恢复默认", "Reset to Default": "恢复默认", "Learn More": "了解详情", "Manage": "管理", "Credits": "额度", "Overages": "超额抵扣", "Credentials": "凭据", "Telemetry": "使用数据", "Upload image": "上传图片", "Paste image": "粘贴图片", "Dictation": "听写", "Start dictation": "开始听写", "Stop dictation": "停止听写", "Stop recording": "停止录音", "Mute": "静音", "Unmute": "取消静音", "Open": "打开", "Close panel": "关闭面板", "Open Settings": "打开设置", "Open settings": "打开设置", "Back to conversation": "返回对话", "New Window ": "新建窗口", "Agent Permissions": "Agent 权限", "Plan usage": "套餐用量", "Workspace customizations": "工作区自定义项", "Global customizations": "全局自定义项", "Add MCP Server": "添加 MCP 服务器", "Add MCP server": "添加 MCP 服务器", "Add Skill": "添加技能", "Add skill": "添加技能", "Add Rule": "添加规则", "No results": "没有结果", "No results found": "没有找到结果", "No conversations": "还没有对话", "No conversations yet": "还没有对话", "Untitled": "未命名", "Untitled conversation": "未命名对话", "Hide": "隐藏", "Show": "显示", "Hide details": "隐藏详情", "Show details": "显示详情", "View details": "查看详情", "Open file in editor": "在编辑器中打开文件", "Accept changes": "接受改动", "Reject changes": "拒绝改动", "Keep": "保留", "Discard": "放弃", "Discard changes": "放弃改动", "Apply changes": "应用改动", "Diff": "差异", "View diff": "查看差异", "Terms": "条款",
      "Warning": "警告", "Info": "提示", "Success": "成功", "Something went wrong": "出了点问题", "Try again": "重试", "Dismiss": "关闭", "Got it": "知道了", "Not now": "以后再说", "Later": "稍后",
      // v0.10.5：从 Antigravity 界面代码里整理出来的全部界面文字（后面的同名条目覆盖前面的）
      "% left": "% 剩余",
      "(Optional) Tell us more or type your reason...": "（可选）补充说明或填写原因…",
      "(empty)": "（空）",
      "/ 1M tokens": "/ 100 万 token",
      "// Greet a user by name": "// 按名字向用户问好",
      "1 Draft": "1 份草稿",
      "1. Accessibility": "1. 辅助功能",
      "14 days": "14 天",
      "2. Screen Recording": "2. 屏幕录制",
      "21 days": "21 天",
      "2x playback speed": "2 倍速播放",
      "5h limit": "5 小时限额",
      "7 days": "7 天",
      "A chunk is a section of the page. Long pages are chunked so that only the sections that are relevant to your query are read.": "分块是页面的一个片段。长页面会被分成多块，只读取和你的问题相关的部分。",
      "A comma-separated list like org-a, org-b, or * for all.": "用逗号分隔，例如 org-a, org-b，或者填 * 表示全部。",
      "A comma-separated list like repo-a, repo-b, or * for all.": "用逗号分隔，例如 repo-a, repo-b，或者填 * 表示全部。",
      "A few things to know, and a couple settings to review.": "有几件事需要了解，还有几个设置需要确认。",
      "A group with this name already exists.": "已经有同名的分组了。",
      "A label for this computer when you connect from another device. Changing it reconnects.": "从另一台设备连接时显示的这台电脑的名称。修改后会重新连接。",
      "A new version is available.": "有新版本可用。",
      "A nickname for identifying this application in the companion website. Changing this will restart the connection.": "在配套网站上用来识别这个应用的昵称。修改后会重新连接。",
      "A project with this name already exists.": "已经有同名的项目了。",
      "A shell setup script run before every command the agent executes.": "Agent 每次执行命令前都会先运行的 Shell 初始化脚本。",
      "A snapshot was saved before running. To restore your previous output:": "运行前已保存快照。要恢复之前的输出：",
      "AI Credits Used to Generate Response": "生成回复所用的 AI 额度",
      "AI Credits are used when you've exceeded your model quota. Keep track of your current AI Credits in the": "超出模型配额后会使用 AI 额度。当前 AI 额度可以在这里查看：",
      "Abandoned": "已放弃",
      "Aborted": "已中止",
      "About embedding": "关于嵌入",
      "Accent": "强调色",
      "Accept Step": "接受这一步",
      "Access grants": "访问授权",
      "Access restricted": "访问受限",
      "Access rules": "访问规则",
      "Accessibility": "辅助功能",
      "Account connected.": "账号已连接。",
      "Account connection was not completed.": "账号没有连接成功。",
      "Accounts": "账号",
      "Accounts tab": "账号标签页",
      "Action required": "需要你处理",
      "Actions": "操作",
      "Active Skills": "已启用的技能",
      "Active Tasks & Conversations:": "进行中的任务和对话：",
      "Actual behavior": "实际表现",
      "Add Context": "添加上下文",
      "Add Handler": "添加处理程序",
      "Add Hook Card": "添加钩子卡片",
      "Add MCP": "添加 MCP",
      "Add MCP Servers": "添加 MCP 服务器",
      "Add Model": "添加模型",
      "Add New Handler to": "添加新的处理程序到",
      "Add Shortcut": "添加快捷键",
      "Add Terminal": "添加终端",
      "Add account": "添加账号",
      "Add anyway": "仍然添加",
      "Add files": "添加文件",
      "Add filter": "添加筛选条件",
      "Add inline comment": "添加行内评论",
      "Add note": "添加备注",
      "Add schedule": "添加计划",
      "Add to Chat": "加入对话",
      "Add to Chat/Quote": "加入对话 / 引用",
      "Add trigger": "添加触发条件",
      "Added": "已添加",
      "Added (Staged)": "已添加（已暂存）",
      "Address bar suggestions": "地址栏建议",
      "Admin escalation": "管理员升级",
      "After": "之后",
      "Agent Edits": "Agent 改动",
      "Agent Hooks Configuration": "Agent 钩子配置",
      "Agent ID:": "Agent ID：",
      "Agent can": "Agent 可以",
      "Agent can retrieve console logs from the browser and return it for further processing.": "Agent 可以读取浏览器的控制台日志，交回来做进一步处理。",
      "Agent can run": "Agent 可以运行",
      "Agent can scroll on browser pages to access more content.": "Agent 可以在浏览器页面上滚动，查看更多内容。",
      "Agent options": "Agent 选项",
      "Agent terminated due to error": "Agent 因出错已终止",
      "Agent:": "Agent：",
      "Agents": "Agent",
      "Agents created by": "Agent 创建者",
      "All Files": "全部文件",
      "All Workspaces": "全部工作区",
      "All active Antigravity shortcuts and user keybinding overrides are managed directly by VS Code.": "Antigravity 的所有快捷键和用户自定义的按键绑定都由 VS Code 直接管理。",
      "All agents": "全部 Agent",
      "All runs": "全部运行记录",
      "All tools (*)": "全部工具（*）",
      "Allow Google to collect and use your Interactions data, subject to the": "允许 Google 收集和使用你的交互数据，遵守",
      "Allow creating issues and grant access to specific issues.": "允许创建 Issue，并授予对指定 Issue 的访问权限。",
      "Allow opening pull requests and grant access to specific PRs.": "允许发起 Pull Request，并授予对指定 PR 的访问权限。",
      "Allow reading workflow runs (list, view, watch) across the whole repository.": "允许读取整个仓库的工作流运行记录（列表、查看、跟踪）。",
      "Allow/deny agent browser actuation access to specific URLs.": "允许或禁止 Agent 在指定网址上操作浏览器。",
      "Allow/deny agent browser file downloads from specific sites.": "允许或禁止 Agent 从指定网站下载文件。",
      "Allow/deny agent command execution outside the sandbox.": "允许或禁止 Agent 在沙盒外执行命令。",
      "Allow/deny agent read access to specific URLs or domains.": "允许或禁止 Agent 读取指定网址或域名。",
      "Allow/deny agent read access to specific files or directories.": "允许或禁止 Agent 读取指定文件或目录。",
      "Allow/deny agent write access to specific files or directories.": "允许或禁止 Agent 写入指定文件或目录。",
      "Allow/deny specific terminal commands.": "允许或禁止指定的终端命令。",
      "Also includes": "还包括",
      "Always Proceed": "始终继续",
      "Always open": "始终打开",
      "Amend": "修改提交",
      "Amend succeeded": "修改提交成功",
      "An agent is using the built-in browser. Clearing its data signs the agent out of sites and may interrupt its task.": "有 Agent 正在使用内置浏览器。清除它的数据会让 Agent 退出各网站的登录，可能打断它的任务。",
      "An error occurred while submitting your feedback. Please try again.": "提交反馈时出错了，请重试。",
      "An error was thrown.": "出错了。",
      "Annotation": "批注",
      "Antigravity (AGY) Style": "Antigravity（AGY）风格",
      "Antigravity Interactive HTML": "Antigravity 交互式 HTML",
      "Antigravity would like to use the browser.": "Antigravity 想要使用浏览器。",
      "Any error messages": "看到的错误信息",
      "Any error messages seen when trying to log in": "登录时看到的错误信息",
      "Any relevant information": "其他相关信息",
      "Any time": "任意时间",
      "App": "应用",
      "App update required": "需要更新应用",
      "Approved": "已批准",
      "Apps connected to your account": "已连接到你账号的应用",
      "Archive Conversation": "归档对话",
      "Archive This Conversation": "归档这个对话",
      "Archive Workspace": "归档工作区",
      "Archive project": "归档项目",
      "Archived Only": "只看已归档",
      "Are you sure you want to delete": "确定要删除",
      "Are you sure you want to delete the": "确定要删除这个",
      "Are you sure you want to delete this conversation? This action cannot be undone.": "确定要删除这个对话吗？删除后无法恢复。",
      "Are you sure you want to delete this side question? This action cannot be undone.": "确定要删除这个旁支提问吗？删除后无法恢复。",
      "Artifact Comments": "产出物评论",
      "Artifact Viewer": "产出物查看器",
      "Artifact updated by agent": "产出物已被 Agent 更新",
      "Artifacts like Google Docs, PDFs, Office documents (Word, Excel, PowerPoint), etc. Everything else the agent creates is under Artifacts.": "Google 文档、PDF、Office 文档（Word、Excel、PowerPoint）之类的产出物。Agent 生成的其他内容都在「产出物」里。",
      "Ask a quick question without interrupting the main conversation.": "不打断主对话，快速问一个问题。",
      "Ask a side question without interrupting the main conversation": "不打断主对话，问一个旁支问题",
      "Ask about your code or any topic, get clear answers.": "问问你的代码或任何话题，得到清楚的回答。",
      "Ask before sensitive operations.": "敏感操作前先询问。",
      "Ask questions, report issues, and discuss features": "提问、报告问题、讨论功能",
      "Ask the agent to diagnose and fix this server": "让 Agent 诊断并修复这个服务器",
      "Ask to retry": "请求重试",
      "At Mention Code Block": "@ 引用代码块",
      "At mention code block": "@ 引用代码块",
      "Attach Antigravity server logs": "附上 Antigravity 服务器日志",
      "Attach a screenshot (optional)": "附上截图（可选）",
      "Attach terminal output": "附上终端输出",
      "Attaching logs requires an email address": "附上日志需要填写邮箱地址",
      "Attackers might be able to see the images you're looking at on this site and trick you by modifying them.": "攻击者可能看得到你在这个网站上看的图片，并通过修改图片来欺骗你。",
      "Attackers might be trying to steal your information from": "攻击者可能正在试图窃取你在这个网站上的信息：",
      "Audio attachment": "音频附件",
      "Authenticate": "验证身份",
      "Authenticated as": "已验证身份：",
      "Authenticating...": "正在验证身份…",
      "Authentication Required": "需要验证身份",
      "Authentication expired": "身份验证已过期",
      "Authorization code": "授权码",
      "Auto (detected)": "自动（已检测）",
      "Auto Pin": "自动置顶",
      "Auto-assignment not configured": "没有配置自动分配",
      "Auto-starts and auto-stops the Antigravity Custom Theme & Live Wallpaper Engine daemon alongside Antigravity.": "随 Antigravity 一起自动启动和停止 Antigravity 自定义主题与动态壁纸引擎的后台进程。",
      "Automated safeguards help to protect your conversations from insecure or unsafe content. That being said, users should be aware of potential agentic risks, including data exfiltration.": "自动防护机制会帮你挡住不安全的内容。不过还是要注意 Agent 可能带来的风险，比如数据外泄。",
      "Automatic Check for Updates": "自动检查更新",
      "Automatically decide if commands run.": "自动决定命令要不要运行。",
      "Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.": "有新版本时自动提示你重启应用。关闭后可以在应用菜单里手动检查更新。",
      "Automatically reproduce bugs, trace causes, test fixes.": "自动复现 bug、追踪原因、测试修复。",
      "Available CEL field tokens and helpers": "可用的 CEL 字段和辅助函数",
      "Available CEL helper functions": "可用的 CEL 辅助函数",
      "Available for": "适用于",
      "Available licenses": "可用的许可证",
      "Avoid uploading highly sensitive data and verify actions taken by your agent. Make sure you have the": "不要上传高度敏感的数据，并核实 Agent 执行的操作。请确认你已经",
      "Back 5s (←)": "后退 5 秒（←）",
      "Back to": "返回",
      "Back to home": "返回首页",
      "Back to safety": "返回安全页面",
      "Background": "背景",
      "Background Task Output": "后台任务输出",
      "Background Tasks": "后台任务",
      "Background tasks and terminals agents left running, across all conversations.": "所有对话里 Agent 留在后台运行的任务和终端。",
      "Backoff": "退避",
      "Backquote": "反引号",
      "Backslash": "反斜杠",
      "Backspace": "退格",
      "Bad Response": "回答得不好",
      "Baseline model quota reached": "已达到基础模型配额",
      "Basic auth": "基本认证",
      "Before": "之前",
      "Best of N": "多选一（Best of N）",
      "Best of N mode is not available": "多选一模式不可用",
      "Best-of-N Ended": "多选一已结束",
      "Best-of-N Started": "多选一已开始",
      "Billing model": "计费方式",
      "Binary file not shown": "二进制文件，不显示",
      "Block": "屏蔽",
      "Blocked": "已屏蔽",
      "Blocked by organization policy": "已被组织策略屏蔽",
      "Blocked, needs input": "已阻塞，需要输入",
      "Boolean AND, OR, and negation": "布尔与、或、非",
      "Bot": "机器人",
      "Branch": "分支",
      "Branch Changes": "分支改动",
      "Branch actions": "分支操作",
      "Branch names": "分支名称",
      "Browse MCP resources": "浏览 MCP 资源",
      "Browse and enable plugins from the Build With Google catalog.": "从 Build With Google 目录里浏览并启用插件。",
      "Browse rules": "浏览规则",
      "Browse the Marketplace": "浏览插件市场",
      "Browser Actuation Permissions": "浏览器操作权限",
      "Browser Javascript Execution Policy": "浏览器 JavaScript 执行策略",
      "Browser Subagent Viewer": "浏览器子 Agent 查看器",
      "Browser Use": "浏览器操作",
      "Browser actions": "浏览器动作",
      "Browser downloads": "浏览器下载",
      "Browser is currently being operated by this conversation in another Hub window": "这个对话正在另一个 Hub 窗口里操作浏览器",
      "Browser steps": "浏览器步骤",
      "Browser tools (browser_.*)": "浏览器工具（browser_.*）",
      "Browsing Data": "浏览数据",
      "Browsing history": "浏览记录",
      "Build new features": "开发新功能",
      "Build with Google": "用 Google 构建",
      "Build with one agent or a team": "用一个 Agent 或一个团队来构建",
      "Built to help, not hurt": "为帮助而生，不为伤害",
      "Bundles": "套装",
      "Business Account Sign In": "企业账号登录",
      "By default, agents work in folders you choose and ask before sensitive changes. Adjust this anytime in Settings.": "默认情况下，Agent 在你选的文件夹里工作，敏感改动前会先问你。随时可以在设置里调整。",
      "Bytes": "字节",
      "CEL Expression Reference": "CEL 表达式参考",
      "CEL Reference": "CEL 参考",
      "Cache:": "缓存：",
      "Cancel All Tasks": "取消全部任务",
      "Cancel Generation": "取消生成",
      "Cancel Render Page Failed": "取消渲染页面失败",
      "Cancel Render Thumbnail Failed": "取消渲染缩略图失败",
      "Cancel Sending Message": "取消发送消息",
      "Cancel Step": "取消这一步",
      "Cancel Task": "取消任务",
      "Cancel download": "取消下载",
      "Cancel questionnaire": "取消问卷",
      "Cancel recording": "取消录音",
      "Cancel step": "取消这一步",
      "Cannot parse folder URI.": "无法解析文件夹路径。",
      "Caps Lock": "大写锁定",
      "Capsule": "胶囊",
      "Capture Console Logs": "获取控制台日志",
      "Capture Screenshot": "截图",
      "Captured DOM tree for": "已获取 DOM 树：",
      "Card": "卡片",
      "Caret": "插入符",
      "Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.": "执行计划：搜索、编辑、构建、测试。选一个更快、更便宜的模型。",
      "Category": "类别",
      "Certificate details": "证书详情",
      "Change VCS in General settings, under Advanced": "在「常规设置」→「高级」里修改版本控制系统",
      "Change model": "更换模型",
      "Change schedule": "更改计划",
      "Chat": "对话",
      "Chat Layout": "对话布局",
      "Chat anyways": "仍然对话",
      "Check that the microphone is unmuted and the right input device is selected.": "检查麦克风是否没有静音，输入设备是否选对了。",
      "Chief of Staff canvas": "总管画布",
      "Chief of Staff voice mode is active": "总管语音模式已开启",
      "Chinese (Simplified)": "简体中文",
      "Choose File…": "选择文件…",
      "Choose Region": "选择区域",
      "Choose a Subscription": "选择订阅",
      "Choose between non-colliding VS Code defaults or standalone Antigravity chords.": "在不冲突的 VS Code 默认快捷键和 Antigravity 独立组合键之间选择。",
      "Choose icon and color": "选择图标和颜色",
      "Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster, cheaper executor gives high quality for fewer tokens.": "选择编排器使用的模型。用更大、更聪明的模型做编排，配一个更快、更便宜的执行模型，用更少的 token 得到高质量结果。",
      "Choose what to clear from the built-in browser. It can't be undone.": "选择要从内置浏览器里清除的内容。清除后无法恢复。",
      "Choose where terminal sessions appear.": "选择终端会话显示在哪里。",
      "Circle": "圆形",
      "Claude and GPT models": "Claude 和 GPT 模型",
      "Clear Browsing Data?": "清除浏览数据？",
      "Clear Search": "清除搜索",
      "Clear and friendly": "清楚友好",
      "Clear category": "清除类别",
      "Clear cookies and site data": "清除 Cookie 和网站数据",
      "Clear file filter": "清除文件筛选",
      "Clear filter": "清除筛选",
      "Clear history, cookies and site data from the built-in browser, or manage cookies for each site.": "清除内置浏览器的浏览记录、Cookie 和网站数据，或按网站管理 Cookie。",
      "Clear row filter": "清除行筛选",
      "Clear search": "清除搜索",
      "Clear visited URLs and autocomplete suggestions from the built-in browser.": "清除内置浏览器访问过的网址和自动补全建议。",
      "Cleared Count": "已清除数量",
      "Clearing cookies and site data for": "正在清除这个网站的 Cookie 和网站数据：",
      "Click to Open Docs": "点击打开文档",
      "Click to copy URL": "点击复制网址",
      "Click to learn more about sources": "点击了解来源",
      "Click to open docs": "点击打开文档",
      "Click to view more": "点击查看更多",
      "Click to view or edit comment": "点击查看或编辑评论",
      "Clone current workspace into a new independent workspace": "把当前工作区克隆成一个新的独立工作区",
      "Close (Esc)": "关闭（Esc）",
      "Close (Escape)": "关闭（Esc）",
      "Close Logs Modal": "关闭日志窗口",
      "Close Other Tabs": "关闭其他标签页",
      "Close Panel": "关闭面板",
      "Close Tab": "关闭标签页",
      "Close Tabs to the Left": "关闭左侧标签页",
      "Close Tabs to the Right": "关闭右侧标签页",
      "Close downloads": "关闭下载",
      "Close references": "关闭引用",
      "Close split view and go to forked conversation": "关闭分屏，转到分出的对话",
      "Closed": "已关闭",
      "Code": "代码",
      "Code Change Summary": "代码改动摘要",
      "Code Search": "代码搜索",
      "Collapse All Folders": "折叠所有文件夹",
      "Color": "颜色",
      "Combobox": "组合框",
      "Comma": "逗号",
      "Command Palette": "命令面板",
      "Command prompt": "命令提示符",
      "Command setup script": "命令初始化脚本",
      "Command:": "命令：",
      "Commands": "命令",
      "Commands Outside Sandbox": "沙盒外命令",
      "Commands and files these agents can use.": "这些 Agent 可以使用的命令和文件。",
      "Commands outside sandbox": "沙盒外命令",
      "Comment": "评论",
      "Comment on Selection": "评论所选内容",
      "Comment on the plan before your agent starts, and get a walkthrough when it finishes.": "在 Agent 开始前对计划提意见，完成后看一份讲解。",
      "Comments": "评论",
      "Comments (": "评论（",
      "Commit": "提交",
      "Commit succeeded": "提交成功",
      "Compacting": "正在压缩",
      "Complete verification": "完成验证",
      "Computer": "电脑",
      "Conditions": "条件",
      "Confident and clear": "自信清晰",
      "Configure GitHub access policies.": "配置 GitHub 访问策略。",
      "Configure agent execution, queued message delivery, and permissions.": "配置 Agent 执行策略、排队消息发送及权限。",
      "Configure allowed and denied URLs for the browser subagent (invoked with /browser). Requires": "配置浏览器子 Agent（用 /browser 调用）允许和禁止访问的网址。需要",
      "Configure allowed and denied paths for file reads and writes.": "配置文件读写允许和禁止的路径。",
      "Configure allowed commands outside the sandbox.": "配置允许在沙盒外运行的命令。",
      "Configure allowed terminal commands.": "配置允许的终端命令。",
      "Configure built-in browser, link opening, and browser subagent preferences.": "配置内置浏览器、链接打开方式和浏览器子 Agent。",
      "Configure external tools via Model Context Protocol.": "通过 Model Context Protocol 配置外部工具。",
      "Configure hooks that run on agent lifecycle events.": "配置在 Agent 生命周期事件上运行的钩子。",
      "Configure the default width of markdown artifacts.": "设置 Markdown 产出物的默认宽度。",
      "Configure the maximum width of the conversation panel.": "设置对话面板的最大宽度。",
      "Configure workspace-specific permissions, resources, and customizations.": "配置工作区专属的权限、资源和自定义项。",
      "Configured servers": "已配置的服务器",
      "Configures how the agent tries to access files outside of its working folders.": "设置 Agent 如何访问工作文件夹以外的文件。",
      "Confirm Browser Interaction": "确认浏览器操作",
      "Confirm Undo": "确认撤销",
      "Confirm the command is safe to run outside of the sandbox with full network and disk access.": "确认这条命令可以在沙盒外安全运行（拥有完整的网络和磁盘权限）。",
      "Confirmation required to execute this step": "执行这一步需要确认",
      "Connect GitHub": "连接 GitHub",
      "Connect an account so the agent can use this app.": "连接一个账号，让 Agent 可以使用这个应用。",
      "Connect to SSH Host…": "连接到 SSH 主机…",
      "Connect your account to browse": "连接账号后浏览",
      "Connected Google Drive and GitHub resources": "已连接的 Google Drive 和 GitHub 资源",
      "Connecting to terminal...": "正在连接终端…",
      "Connection is secure": "连接是安全的",
      "Connection security information is not available for this page": "这个页面没有连接安全信息",
      "Connections": "连接",
      "Connectors": "连接器",
      "Console Telemetry": "控制台使用数据",
      "Contact your administrator to set up Gemini Enterprise for this project": "请联系管理员为这个项目开通 Gemini Enterprise",
      "Contents": "目录",
      "Context Providers": "上下文提供方",
      "Context and Quota Indicator": "上下文和配额指示器",
      "Context usage": "上下文用量",
      "Continue Task →": "继续任务 →",
      "Continue with Google": "用 Google 账号继续",
      "Continue with Google Cloud": "用 Google Cloud 继续",
      "Continue with different account": "换个账号继续",
      "Continue your work from another device with Remote Control. Scan the QR code or open the link below.": "用远程控制在另一台设备上继续工作。扫描二维码或打开下面的链接。",
      "Contrast": "对比度",
      "Controls how much time and quota the model spends reasoning before responding. Higher effort improves accuracy on hard problems, at the cost of slower responses and higher quota use.": "控制模型在回答前花多少时间和配额思考。思考越多，难题越准，但回答越慢、配额用得越多。",
      "Controls permissions for remote conversations.": "控制远程对话的权限。",
      "Controls whether terminal commands require your approval before running.": "控制终端命令运行前是否需要你批准。",
      "Controls whether terminal commands require your approval before running.\n\nNote: A change to this setting will only apply to new messages sent to the agent. In-progress responses will use the previous setting value.": "控制终端命令运行前是否需要你批准。\n\n注意：修改只对之后发给 Agent 的消息生效，正在进行的回复仍按原来的设置。",
      "Controls whether the agent can run custom JavaScript to automate complex browser actions.": "控制 Agent 能否运行自定义 JavaScript 来完成复杂的浏览器操作。",
      "Conversation Archived": "对话已归档",
      "Conversation History": "对话记录",
      "Conversation ID": "对话 ID",
      "Conversation Name": "对话名称",
      "Conversation Telemetry": "对话使用数据",
      "Conversation Unarchived": "对话已取消归档",
      "Conversation Width": "对话宽度",
      "Conversation copied as Markdown to clipboard": "已把对话以 Markdown 格式复制到剪贴板",
      "Conversation is not open in this Hub window": "这个对话没有在当前 Hub 窗口中打开",
      "Conversation limit reached": "已达到对话数量上限",
      "Conversation link": "对话链接",
      "Conversation name": "对话名称",
      "Conversation unavailable": "对话不可用",
      "Cookies and other site data": "Cookie 和其他网站数据",
      "Cookies and site data": "Cookie 和网站数据",
      "Cookies by Site": "按网站查看 Cookie",
      "Cookies the built-in browser stores for each site. Deleting a site's cookies usually signs you out of it. Other site data (local storage, IndexedDB, cache) is cleared only by Browsing Data → Clear.": "内置浏览器为每个网站保存的 Cookie。删除某个网站的 Cookie 通常会退出它的登录。其他网站数据（本地存储、IndexedDB、缓存）只能在「浏览数据」→「清除」里清掉。",
      "Cookies, site storage and cache. Signs you out of all sites in the built-in browser and reloads its open tabs.": "Cookie、网站存储和缓存。会退出内置浏览器里所有网站的登录，并重新加载已打开的标签页。",
      "Coordinator goal": "协调者目标",
      "Coordinator name": "协调者名称",
      "Coordinator settings": "协调者设置",
      "Coordinators": "协调者",
      "Copy Command": "复制命令",
      "Copy Config File Path": "复制配置文件路径",
      "Copy Content": "复制内容",
      "Copy Conversation ID": "复制对话 ID",
      "Copy Conversation Markdown": "复制对话 Markdown",
      "Copy File Name": "复制文件名",
      "Copy File Path": "复制文件路径",
      "Copy Image": "复制图片",
      "Copy Image Address": "复制图片地址",
      "Copy Link": "复制链接",
      "Copy Link Address": "复制链接地址",
      "Copy Message": "复制消息",
      "Copy Path": "复制路径",
      "Copy Trajectory ID": "复制轨迹 ID",
      "Copy command": "复制命令",
      "Copy debug info": "复制调试信息",
      "Copy full URL to clipboard": "把完整网址复制到剪贴板",
      "Copy gh auth login command": "复制 gh auth login 命令",
      "Copy to clipboard": "复制到剪贴板",
      "Could not clear site data for": "无法清除这个网站的数据：",
      "Could not create project": "无法创建项目",
      "Could not load": "无法加载",
      "Could not load the app view:": "无法加载应用视图：",
      "Couldn't clear browsing data. Try again.": "没能清除浏览数据，请重试。",
      "Couldn't connect": "无法连接",
      "Couldn't connect to": "无法连接到",
      "Couldn't delete cookies for": "没能删除这个网站的 Cookie：",
      "Couldn't delete your data. Try again.": "没能删除你的数据，请重试。",
      "Couldn't edit queued message": "无法编辑排队中的消息",
      "Couldn't load Google Drive link title": "无法加载 Google Drive 链接标题",
      "Couldn't load cookies.": "无法加载 Cookie。",
      "Couldn't load your SSH hosts": "无法加载你的 SSH 主机",
      "Couldn't load your SSH hosts. You can still type one.": "无法加载你的 SSH 主机，你仍然可以手动输入。",
      "Couldn't mark conversations as read": "无法把对话标为已读",
      "Couldn't search files": "无法搜索文件",
      "Couldn't start the coordinator:": "无法启动协调者：",
      "Couldn't switch accounts:": "无法切换账号：",
      "Count": "数量",
      "Create Coordinator": "创建协调者",
      "Create Group": "创建分组",
      "Create New": "新建",
      "Create a Plugin with the Agent": "让 Agent 创建一个插件",
      "Create a new project from one or more folders.": "用一个或多个文件夹新建项目。",
      "Create a new project using normal folders and/or citc workspaces.": "用普通文件夹和 / 或 CitC 工作区新建项目。",
      "Create a project first.": "请先创建一个项目。",
      "Create a project on a machine you reach over SSH. It opens in that host's own window.": "在通过 SSH 连接的机器上创建项目，会在那台主机自己的窗口里打开。",
      "Create a project on this computer or remotely.": "在这台电脑上或远程创建项目。",
      "Create a token": "创建令牌",
      "Create plugin": "创建插件",
      "Create with Prompt": "用提示词创建",
      "Created a new branch on GitHub.": "已在 GitHub 上新建分支。",
      "Created a new branch on Origin.": "已在 Origin 上新建分支。",
      "Creating projects for your conversations": "正在为你的对话创建项目",
      "Creating terminal...": "正在创建终端…",
      "Creating...": "正在创建…",
      "Critique": "评审",
      "Curated sets of plugins for common workflows and roles.": "常见工作流程和角色的精选插件合集。",
      "Current Page": "当前页面",
      "Current workspace": "当前工作区",
      "Currently installed": "已安装",
      "Custom Agent Error:": "自定义 Agent 出错：",
      "Custom Agents": "自定义 Agent",
      "Custom Context Menus": "自定义右键菜单",
      "Custom Flags": "自定义开关",
      "Custom Order": "自定义顺序",
      "Custom flag to turn on": "要打开的自定义开关",
      "Custom models are only supported on Linux machines.": "自定义模型只支持 Linux 电脑。",
      "Customizations views": "自定义视图",
      "Customize": "自定义",
      "Customize Global Skills": "自定义全局技能",
      "Customize Sections": "自定义分区",
      "Customize Shortcuts": "自定义快捷键",
      "Customize Sidebar": "自定义侧边栏",
      "Customize your experience across the agent, plugins, and product from the settings and marketplace. We won’t show you ads or let advertisers influence what": "在设置和插件市场里自定义 Agent、插件和产品体验。我们不会向你展示广告，也不会让广告主影响",
      "Custom…": "自定义…",
      "Daily": "每天",
      "Daily conversation limit reached": "已达到每日对话上限",
      "Daily environment time used": "今日已用环境时长",
      "Danger Zone": "危险操作",
      "Dark preview": "深色预览",
      "Day of the month": "每月第几天",
      "Day of the week": "星期几",
      "Days": "天",
      "Debug and fix": "调试并修复",
      "Declaration": "声明",
      "Decline": "拒绝",
      "Deep and velvety": "深沉柔和",
      "Default (Mendel)": "默认（Mendel）",
      "Default Cog branch / ref": "默认 Cog 分支 / 引用",
      "Default Cog repository": "默认 Cog 仓库",
      "Default Customizations": "默认自定义项",
      "Default workspace VCS": "默认工作区版本控制系统",
      "Definition:": "定义：",
      "Delete All Data": "删除全部数据",
      "Delete All Remote Agents Data": "删除全部远程 Agent 数据",
      "Delete All Remote Agents Data?": "删除全部远程 Agent 数据？",
      "Delete Conversation": "删除对话",
      "Delete Group": "删除分组",
      "Delete Handler": "删除处理程序",
      "Delete Hook": "删除钩子",
      "Delete MCP Server": "删除 MCP 服务器",
      "Delete Permanently": "永久删除",
      "Delete Side Question": "删除旁支提问",
      "Delete Skill": "删除技能",
      "Delete Task": "删除任务",
      "Delete Terminal": "删除终端",
      "Delete agent": "删除 Agent",
      "Delete all": "全部删除",
      "Delete all recordings?": "删除全部录音？",
      "Delete comment": "删除评论",
      "Delete organization policy": "删除组织策略",
      "Delete plugin": "删除插件",
      "Delete repository policy": "删除仓库策略",
      "Delete server": "删除服务器",
      "Delete side question": "删除旁支提问",
      "Deleted": "已删除",
      "Denied Sites": "已禁止的网站",
      "Deny setting up browser": "拒绝设置浏览器",
      "Deny with note": "拒绝并附上备注",
      "Describe the bug you encountered...": "描述一下你遇到的问题…",
      "Describe what you want. Your agent plans and builds it, and brings in other agents when needed.": "描述你想要什么。Agent 会规划并完成，需要时会叫上其他 Agent。",
      "Determines the markup language of the output.": "决定输出用哪种标记语言。",
      "Dev mode: Localhost server automatically detected": "开发模式：已自动检测到本地服务器",
      "Developer": "开发者",
      "Developer-only tools. These settings do not affect other users.": "仅供开发者使用的工具，这些设置不影响其他用户。",
      "Developer: Reset NUX": "开发者：重置新手引导",
      "Developer: Reset Onboarding": "开发者：重置初次设置",
      "Device Name": "设备名称",
      "Did restarting the desktop app help?": "重启桌面应用有用吗？",
      "Diff contents are no longer available.": "差异内容已经不可用了。",
      "Directory Viewer": "目录查看器",
      "Directory not shown": "目录未显示",
      "Disabled by organization policy": "已被组织策略停用",
      "Disabled. Open Details to finish setup or enable.": "已停用。打开详情完成设置或启用。",
      "Disabled. Open the plugin page to finish setup.": "已停用。打开插件页面完成设置。",
      "Disabling or removing this bundle doesn't affect it.": "停用或移除这个套装不会影响它。",
      "Discard comment draft": "放弃评论草稿",
      "Discard unstaged changes": "放弃未暂存的改动",
      "Dismiss Tip": "关闭提示",
      "Dismiss artifact update notice": "关闭产出物更新提示",
      "Dismiss conversation open elsewhere warning": "关闭「对话已在别处打开」提示",
      "Dismiss error": "关闭错误提示",
      "Dismiss microphone warning": "关闭麦克风提示",
      "Dismiss notification": "关闭通知",
      "Dismiss service announcement": "关闭服务公告",
      "Dismiss suggestion": "关闭建议",
      "Dismiss text selection notice": "关闭文字选择提示",
      "Docs, Sheets, Slides, and folders": "文档、表格、幻灯片和文件夹",
      "Document Answers": "文档回答",
      "Document attachment": "文档附件",
      "Documents": "文档",
      "Domains:": "域名：",
      "Don't show this for 2 days": "2 天内不再显示",
      "Down": "下",
      "Download Diagnostics": "下载诊断信息",
      "Download File": "下载文件",
      "Download PDF": "下载 PDF",
      "Download files": "下载文件",
      "Download from": "下载来源",
      "Download this site as an app to get notified when the agent needs your attention or completes a task.": "把这个网站下载成应用，Agent 需要你处理或完成任务时就能收到通知。",
      "Downloads": "下载",
      "Draft": "草稿",
      "Draft documents, emails, and notes that sound like you.": "起草像你写的文档、邮件和笔记。",
      "Drag to move": "拖动来移动",
      "Drag to resize, double-click to reset": "拖动调整大小，双击还原",
      "Drag to select a region to comment": "拖动选出一块区域来评论",
      "Drawer": "抽屉",
      "E.g. locations/global/workforcePools...": "例如 locations/global/workforcePools...",
      "Edit Comment": "编辑评论",
      "Edit Conversation Title": "编辑对话标题",
      "Edit Model": "编辑模型",
      "Edit Shortcut": "编辑快捷键",
      "Edit comment": "编辑评论",
      "Edit permission target": "编辑权限对象",
      "Edit task title": "编辑任务标题",
      "Edition": "版本",
      "Electron (Android Desktop)": "Electron（Android 桌面版）",
      "Electron (Desktop)": "Electron（桌面版）",
      "Electron (Gemini App)": "Electron（Gemini 应用）",
      "Email": "邮箱",
      "Embedded web preview": "内嵌网页预览",
      "Embedding Limitations": "嵌入限制",
      "Empty directory": "空目录",
      "Empty log": "日志为空",
      "Empty script.": "脚本为空。",
      "Empty table": "空表格",
      "Enable AI Credit Overages": "启用 AI 额度超额抵扣",
      "Enable Best-of-2": "启用二选一",
      "Enable Browser Agent": "启用浏览器 Agent",
      "Enable Notifications": "启用通知",
      "Enable Recommended Skills": "启用推荐技能",
      "Enable fine-grained GitHub permissions and define the org, repository, and resource-level access the agent is allowed to use.": "启用细粒度 GitHub 权限，设定 Agent 可以使用的组织、仓库和资源级访问权限。",
      "Enable recommended skills": "启用推荐技能",
      "Enable sandbox mode": "启用沙盒模式",
      "Enable telemetry in Settings before changing per-conversation telemetry.": "先在设置里打开使用数据，才能修改单个对话的使用数据设置。",
      "Enable terminal sandbox": "启用终端沙盒",
      "Enable the plugin to sign in.": "启用插件后才能登录。",
      "Enable this plugin to manage its accounts.": "启用这个插件后才能管理它的账号。",
      "Encountered an error while running the plugin.": "运行插件时出错了。",
      "Enter Google Cloud Project Details": "填写 Google Cloud 项目信息",
      "Enter [user@]host[:port], or pick a host from your SSH config.": "输入 [用户@]主机[:端口]，或者从 SSH 配置里选一个主机。",
      "Enter always submits. This adds a second shortcut.": "Enter 始终会发送，这里是再加一个快捷键。",
      "Enter authorization code...": "输入授权码…",
      "Enter device name...": "输入设备名称…",
      "Enter project name...": "输入项目名称…",
      "Enter the configuration values this MCP server needs. Saving restarts the server with them.": "填写这个 MCP 服务器需要的配置，保存后会用新配置重启服务器。",
      "Enter to send": "按 Enter 发送",
      "Enter tool name or server...": "输入工具名或服务器…",
      "Enterprise": "企业版",
      "Environment": "环境",
      "Environments": "环境",
      "Equal": "等于",
      "Equality and list membership (e.g.": "相等和列表包含（例如",
      "Equalize Split Panes": "均分分屏",
      "Error Details:": "错误详情：",
      "Error ID:": "错误 ID：",
      "Error Loading Models": "加载模型出错",
      "Error fetching MCP prompt": "获取 MCP 提示词出错",
      "Error loading Browser recording": "加载浏览器录屏出错",
      "Error rendering playback": "渲染回放出错",
      "Error while editing": "编辑时出错",
      "Error while editing notebook": "编辑笔记本时出错",
      "Error while reading notebook": "读取笔记本时出错",
      "Error while viewing": "查看时出错",
      "Error:": "错误：",
      "Error: Artifacts from remote conversations are not available here.": "错误：远程对话的产出物在这里不可用。",
      "Error: No artifact URI provided in URL parameters.": "错误：网址参数里没有产出物地址。",
      "Errors": "错误",
      "Escape": "Esc",
      "Europe": "欧洲",
      "Event:": "事件：",
      "Events": "事件",
      "Every command requires approval.": "每条命令都需要批准。",
      "Every day": "每天",
      "Every hour": "每小时",
      "Every week": "每周",
      "Every weekday": "每个工作日",
      "Excluded": "已排除",
      "Execute URLs": "执行网址",
      "Execution Identity": "执行身份",
      "Executor Model": "执行模型",
      "Expand All Folders": "展开所有文件夹",
      "Expected behavior": "预期表现",
      "Experimental": "实验性",
      "Expired · Action not taken": "已过期 · 未处理",
      "Explore other marketplace customizations": "探索插件市场里的其他自定义项",
      "Explore the plugin marketplace": "探索插件市场",
      "Export Artifact": "导出产出物",
      "Export artifact": "导出产出物",
      "Export as PDF": "导出为 PDF",
      "Extension": "扩展",
      "Extension (Antigravity IDE)": "扩展（Antigravity IDE）",
      "Extension (Cider)": "扩展（Cider）",
      "Extension (Eclipse)": "扩展（Eclipse）",
      "Extension (VS Code)": "扩展（VS Code）",
      "Extension (Visual Studio)": "扩展（Visual Studio）",
      "External": "外部",
      "External tools the agent can call via Model Context Protocol.": "Agent 可以通过 Model Context Protocol 调用的外部工具。",
      "Extra": "附加",
      "Eye": "眼睛",
      "Failed to Amend": "修改提交失败",
      "Failed to Commit": "提交失败",
      "Failed to Generate Commit Message": "生成提交说明失败",
      "Failed to Push": "推送失败",
      "Failed to approve browser interaction": "批准浏览器操作失败",
      "Failed to clone project locally": "在本地克隆项目失败",
      "Failed to continue": "无法继续",
      "Failed to create CitC clone workspace": "创建 CitC 克隆工作区失败",
      "Failed to create automation.": "创建自动化任务失败。",
      "Failed to create remote project": "创建远程项目失败",
      "Failed to create terminal": "创建终端失败",
      "Failed to create worktree": "创建工作树失败",
      "Failed to delete conversation": "删除对话失败",
      "Failed to delete side question": "删除旁支提问失败",
      "Failed to export artifact": "导出产出物失败",
      "Failed to fetch diffs": "获取差异失败",
      "Failed to fork conversation": "分出对话失败",
      "Failed to get all annotations": "获取全部批注失败",
      "Failed to get annotations": "获取批注失败",
      "Failed to inspect license for this project": "检查这个项目的许可证失败",
      "Failed to load comments": "加载评论失败",
      "Failed to load diff contents.": "加载差异内容失败。",
      "Failed to load image": "加载图片失败",
      "Failed to load resources": "加载资源失败",
      "Failed to load shared conversation": "加载分享的对话失败",
      "Failed to load some diffs": "部分差异加载失败",
      "Failed to proceed": "无法继续",
      "Failed to read file": "读取文件失败",
      "Failed to read file content": "读取文件内容失败",
      "Failed to refresh credentials": "刷新凭据失败",
      "Failed to reject browser interaction": "拒绝浏览器操作失败",
      "Failed to rename conversation": "重命名对话失败",
      "Failed to render diagram": "渲染图表失败",
      "Failed to render math": "渲染公式失败",
      "Failed to revert conversation": "还原对话失败",
      "Failed to save token to ~/.env": "保存令牌到 ~/.env 失败",
      "Failed to send command input": "发送命令输入失败",
      "Failed to send side question": "发送旁支提问失败",
      "Failed to start Best of N mode": "启动多选一模式失败",
      "Failed to start conversation": "开始对话失败",
      "Failed to start side question": "开始旁支提问失败",
      "Failed to stop agent": "停止 Agent 失败",
      "Failed to stop conversation": "停止对话失败",
      "Failed to unarchive local project": "取消归档本地项目失败",
      "Failed to upload HTML artifact to Drive": "上传 HTML 产出物到 Drive 失败",
      "Failed to validate the saved GitHub token.": "保存的 GitHub 令牌验证失败。",
      "Fallback Summary Used": "已使用备用摘要",
      "Fetched network request for page.": "已获取页面的网络请求。",
      "Fetched network requests for page.": "已获取页面的网络请求。",
      "Fields": "字段",
      "File Comments": "文件评论",
      "File Diff Comments": "文件差异评论",
      "File Explorer": "文件资源管理器",
      "File Permissions": "文件权限",
      "File Picker": "文件选择器",
      "File Tree Component is not loaded.": "文件树组件没有加载。",
      "File access rules": "文件访问规则",
      "File attachment": "文件附件",
      "File explorer": "文件资源管理器",
      "File not found": "找不到文件",
      "File path breadcrumbs": "文件路径导航",
      "File reads": "文件读取",
      "File writes": "文件写入",
      "Files Changed": "改动的文件",
      "Files and resources in cloud workspaces": "云端工作区里的文件和资源",
      "Files modified by the agent in this conversation": "这个对话里 Agent 改过的文件",
      "Files to edit:": "要编辑的文件：",
      "Files, folders, and repositories you connect are accessible to your agent in this project, including during background or scheduled runs.": "你连接的文件、文件夹和仓库，在这个项目里 Agent 都能访问，包括后台运行和定时运行时。",
      "Filter agents": "筛选 Agent",
      "Filter and Sort": "筛选和排序",
      "Filter files": "筛选文件",
      "Filter files...": "筛选文件…",
      "Filter plugins": "筛选插件",
      "Filter resources...": "筛选资源…",
      "Filter rows": "筛选行",
      "Filter rows...": "筛选行…",
      "Filters": "筛选",
      "Finalizing transcription...": "正在完成转写…",
      "Find References": "查找引用",
      "Find in Conversation": "在对话中查找",
      "Find in Pane": "在窗格中查找",
      "Find plugins - bundles of skills, agents, MCP servers, UI extensions and more, and install them in one click.": "查找插件（技能、Agent、MCP 服务器、界面扩展等的组合），一键安装。",
      "Finish signing in in your browser.": "在浏览器里完成登录。",
      "Finish signing in to": "完成登录：",
      "Fires after a tool step completes.": "工具步骤完成后触发。",
      "Fires after tool calls finish.": "工具调用结束后触发。",
      "Fires before a tool step executes.": "工具步骤执行前触发。",
      "Fires before the model is called.": "调用模型前触发。",
      "Fires when the execution loop terminates.": "执行循环结束时触发。",
      "Fit Mode": "适配方式",
      "Five Hour Limit Remaining": "5 小时限额剩余",
      "Fix with Agent": "让 Agent 修复",
      "Folder": "文件夹",
      "Folder doesn't exist": "文件夹不存在",
      "Folder where files downloaded in the built-in browser are saved.": "内置浏览器下载的文件保存到这个文件夹。",
      "Folders": "文件夹",
      "Folders these agents can access.": "这些 Agent 可以访问的文件夹。",
      "For Antigravity Business consumption options, see": "Antigravity 企业版的计费方式，请参阅",
      "For Turn": "对于这一轮",
      "For example: Morning bug summary": "例如：早晨 bug 汇总",
      "For example: every morning, summarize new bugs assigned to me and anything that changed overnight.": "例如：每天早上汇总分配给我的新 bug，以及夜里有变化的内容。",
      "For most deep reasoning and complex problems": "适合深度推理和复杂问题",
      "Foreground": "前景色",
      "Fork": "分出",
      "Fork Conversation": "分出对话",
      "Fork conversation in this folder": "在这个文件夹里分出对话",
      "Fork in New Workspace": "在新工作区里分出",
      "Fork in Shared Workspace": "在共享工作区里分出",
      "Fork warning": "分出警告",
      "Forked from": "分自",
      "Forward": "前进",
      "Forward 5s (→)": "前进 5 秒（→）",
      "Found references to": "找到引用：",
      "Friday": "星期五",
      "From": "从",
      "Full Error": "完整错误",
      "Full Logs": "完整日志",
      "Full View": "完整视图",
      "Full interface for coding, developer tools, and managing agents.": "完整界面，适合编程、开发工具和管理 Agent。",
      "Full machine": "整台电脑",
      "Full output written to": "完整输出已写入",
      "Fullscreen": "全屏",
      "Gauge": "仪表",
      "Generated image preview": "生成图片预览",
      "Generation Steps (": "生成步骤（",
      "Generations": "生成次数",
      "Get API key": "获取 API 密钥",
      "Get Anything Done with": "用它搞定一切：",
      "Get More AI Credits": "获取更多 AI 额度",
      "Get notified when the agent needs your attention or completes a task.": "Agent 需要你处理或完成任务时通知你。",
      "Get started": "开始使用",
      "Get started with Remote Control": "开始使用远程控制",
      "Getting scripts...": "正在获取脚本…",
      "Getting started with Google Antigravity": "Google Antigravity 入门",
      "GitHub Permissions": "GitHub 权限",
      "GitHub Personal Access Token": "GitHub 个人访问令牌",
      "GitHub Policies": "GitHub 策略",
      "GitHub Repositories": "GitHub 仓库",
      "GitHub: not signed in": "GitHub：未登录",
      "Go to": "转到",
      "Go to Accounts": "前往账号",
      "Go to Home": "回到首页",
      "Go to the machine you are controlling and quit Antigravity. It installs pending updates the next time it starts.": "去你正在控制的那台电脑上退出 Antigravity，下次启动时会安装待更新的内容。",
      "Goal": "目标",
      "Goals": "目标",
      "Good Response": "回答得好",
      "Google (internal)": "Google（内部）",
      "Google Antigravity Terms of Service": "Google Antigravity 服务条款",
      "Google Privacy Policy": "Google 隐私权政策",
      "Google Search": "Google 搜索",
      "Google Sheets": "Google 表格",
      "Google Slides": "Google 幻灯片",
      "Google3 Configuration": "Google3 配置",
      "Grant administrator access for": "授予管理员权限：",
      "Grant create, update, or delete access to specific branches.": "授予对指定分支的创建、更新或删除权限。",
      "Grant read access to workflow runs and allow dispatching workflows on specific files and refs.": "授予读取工作流运行记录的权限，并允许在指定文件和引用上触发工作流。",
      "Grant repository access": "授予仓库访问权限",
      "Grant the selected actions on the listed branch names — a comma-separated list like main, dev, prod (glob patterns like fix-* allowed), or * for all.": "对列出的分支名称授予所选操作，用逗号分隔，例如 main, dev, prod（支持 fix-* 这类通配符），或者填 * 表示全部。",
      "Grant the selected actions on the listed issue numbers — a comma-separated list like 1, 2, 3, or * for all.": "对列出的 Issue 编号授予所选操作，用逗号分隔，例如 1, 2, 3，或者填 * 表示全部。",
      "Grant the selected actions on the listed pull request numbers — a comma-separated list like 1, 2, 3, or * for all.": "对列出的 Pull Request 编号授予所选操作，用逗号分隔，例如 1, 2, 3，或者填 * 表示全部。",
      "Green": "绿色",
      "Group By": "分组方式",
      "Group name": "分组名称",
      "Hand off a feature and come back to working code.": "交给它一个功能，回来时就是能跑的代码。",
      "Handler #": "处理程序 #",
      "Having trouble signing in?": "登录遇到问题？",
      "Helpers": "辅助函数",
      "Here's how uploaded files, attachments, and connected resources work in your cloud environment": "下面是上传的文件、附件和连接的资源在云端环境里怎么运作",
      "Here's how you and your agents work together": "下面是你和 Agent 怎么配合工作",
      "Hidden by policy": "已被策略隐藏",
      "Hidden hosts": "已隐藏的主机",
      "Highlight": "高亮",
      "Hold": "保持",
      "Home": "首页",
      "Hook will only trigger if the tool name matches run_command or view_file.": "只有工具名是 run_command 或 view_file 时钩子才会触发。",
      "Hook will only trigger if the tool name matches run_command.": "只有工具名是 run_command 时钩子才会触发。",
      "Hook will only trigger if the tool name starts with browser_.": "只有工具名以 browser_ 开头时钩子才会触发。",
      "Hook will trigger if any tool is executed.": "执行任何工具都会触发钩子。",
      "Hooks": "钩子",
      "Host": "主机",
      "Host Endpoint": "主机端点",
      "Host Environment": "主机环境",
      "Hourly": "每小时",
      "How often": "频率",
      "How this feature would help you and other users": "这个功能对你和其他用户有什么帮助",
      "I prefer an immediate single response to prioritize productivity right now.": "我更想要一次给出的回答，现在效率优先。",
      "ID:": "ID：",
      "Icon": "图标",
      "Identifier": "标识符",
      "Idle": "空闲",
      "Idle Conversations": "空闲的对话",
      "Ignore events emitted by automated review or robot accounts (groupagent-*).": "忽略自动评审或机器人账号（groupagent-*）发出的事件。",
      "Ignore events triggered by the automation owner to avoid self-trigger loops.": "忽略自动化任务所有者触发的事件，避免自己触发自己。",
      "Image Answers": "图片回答",
      "Image URL:": "图片网址：",
      "Image attachment": "图片附件",
      "Image preview not available": "无法预览图片",
      "Image rendering blocked (strict mode enabled)": "图片渲染已被阻止（已开启严格模式）",
      "Import AI Studio Project": "导入 AI Studio 项目",
      "Importing shared conversation...": "正在导入分享的对话…",
      "In System Settings, click": "在「系统设置」里点击",
      "In System Settings, turn on": "在「系统设置」里打开",
      "In a rush": "赶时间",
      "In chat": "在对话中",
      "In progress": "进行中",
      "In review": "审阅中",
      "In this case,": "这种情况下，",
      "Include at least one positive": "至少包含一个正向条件",
      "Include default customizations, such as default skills.": "包含默认自定义项，比如默认技能。",
      "Include unstaged changes": "包含未暂存的改动",
      "Indexed CEL helper functions": "带索引的 CEL 辅助函数",
      "Inherit Global": "继承全局设置",
      "Initializing...": "正在初始化…",
      "Inline PDF preview is not available in this environment.": "当前环境不支持内嵌预览 PDF。",
      "Input": "输入",
      "Input:": "输入：",
      "Insert": "插入",
      "Insert in Terminal": "插入到终端",
      "Insert in terminal": "插入到终端",
      "Insert into main conversation": "插入到主对话",
      "Inspected commit": "已检查提交",
      "Install or enable the Google Drive plugin in Customizations to search files with @drive: or paste Drive links": "在「技能与自定义」里安装或启用 Google Drive 插件，就能用 @drive: 搜索文件或粘贴 Drive 链接",
      "Install this plugin to see the commands it adds, along with its skills, agents and MCP servers.": "安装这个插件后，可以看到它添加的命令、技能、Agent 和 MCP 服务器。",
      "Installed MCP Servers": "已安装的 MCP 服务器",
      "Installed separately": "单独安装的",
      "Instead of queueing, try asking the agent to do something after the current task.": "与其排队，不如让 Agent 在当前任务完成后再做这件事。",
      "Instructions": "说明",
      "Insufficient AI Credits": "AI 额度不足",
      "Intended primarily for previewing local development servers (e.g.,": "主要用于预览本地开发服务器（例如",
      "Internal": "内部",
      "Interrupt Agent": "打断 Agent",
      "Invalid Media": "媒体无效",
      "Invalid loopback URL": "无效的本机回环网址",
      "Invite a Friend": "邀请好友",
      "Issue actions": "Issue 操作",
      "Issue creation": "创建 Issue",
      "Issue numbers": "Issue 编号",
      "Issued by": "颁发者",
      "Issued to": "颁发给",
      "Issues": "Issue",
      "It was already sent or couldn't be removed from the queue.": "它已经发出去了，或者没法从队列里移除。",
      "Join the Google Chat space": "加入 Google Chat 群组",
      "Jump to Next Prompt": "跳到下一条提问",
      "Jump to Previous Prompt": "跳到上一条提问",
      "Keep Open": "保持打开",
      "Keep your coding agent up to date with the latest web best practices": "让你的编程 Agent 始终掌握最新的 Web 最佳实践",
      "Keeps working in this folder. Nothing is copied.": "继续在这个文件夹里工作，不复制任何东西。",
      "Keeps your checkout untouched": "不动你现有的代码副本",
      "Keybinding Scheme": "快捷键方案",
      "Keyboard shortcuts for quick navigation and control.": "用于快速导航和操作的键盘快捷键。",
      "Kill Terminal": "结束终端",
      "Knowledge Generation": "知识生成",
      "Label": "标签",
      "Labs": "实验室",
      "Last 7 days": "最近 7 天",
      "Last Activity": "最近活动",
      "Last Prompt": "上一条提问",
      "Last Updated": "最近更新",
      "Last Used": "最近使用",
      "Launching the browser...": "正在启动浏览器…",
      "Layout Controls": "布局控制",
      "Learn more about": "了解更多：",
      "Leaving Soon": "即将下线",
      "Left": "左",
      "Legacy Dark": "旧版深色",
      "Legacy Light": "旧版浅色",
      "Legal Help": "法律帮助",
      "Let's tailor the experience for you. What best describes your work?": "根据你的情况定制体验。哪一项最符合你的工作？",
      "License:": "许可证：",
      "Light and precise": "轻盈精准",
      "Light preview": "浅色预览",
      "Line": "线条",
      "Link": "链接",
      "Link Settings": "链接设置",
      "Link copied to clipboard.": "链接已复制到剪贴板。",
      "Links": "链接",
      "Literal": "字面量",
      "Loading Browser recording...": "正在加载浏览器录屏…",
      "Loading Hosts…": "正在加载主机…",
      "Loading MCP servers...": "正在加载 MCP 服务器…",
      "Loading Repositories…": "正在加载仓库…",
      "Loading apps...": "正在加载应用…",
      "Loading available plugins...": "正在加载可用插件…",
      "Loading bundles...": "正在加载套装…",
      "Loading conversations...": "正在加载对话…",
      "Loading customizations...": "正在加载自定义项…",
      "Loading events...": "正在加载事件…",
      "Loading hooks...": "正在加载钩子…",
      "Loading installed plugins...": "正在加载已安装插件…",
      "Loading instances...": "正在加载实例…",
      "Loading licenses...": "正在加载许可证…",
      "Loading logs...": "正在加载日志…",
      "Loading media...": "正在加载媒体…",
      "Loading models...": "正在加载模型…",
      "Loading older messages…": "正在加载更早消息…",
      "Loading page": "正在加载页面",
      "Loading plugins...": "正在加载插件…",
      "Loading preview…": "正在加载预览…",
      "Loading skills…": "正在加载技能…",
      "Loading subagent...": "正在加载子 Agent…",
      "Loading token usage...": "正在加载 token 用量…",
      "Loading trajectory...": "正在加载轨迹…",
      "Loading worktrees...": "正在加载工作树…",
      "Loading…": "正在加载…",
      "Local": "本地",
      "Local Checkout": "本地代码副本",
      "Local Permissions": "本地权限",
      "Local Windows environment": "本地 Windows 环境",
      "Local only": "仅本地",
      "Location:": "位置：",
      "Log back in": "重新登录",
      "Log in": "登录",
      "Log in to use the agent": "登录后使用 Agent",
      "Logs": "日志",
      "Logs each telemetry event to the browser's DevTools console as it fires, with the click or key that caused it. Stays on across reloads until you turn it off.": "把每个使用数据事件连同触发它的点击或按键输出到浏览器开发者工具的控制台。重新加载后仍然有效，直到你关掉。",
      "Long pages like this one will be broken down into outlines and read as needed. Read more at our": "像这样的长页面会被拆成大纲，按需读取。详情请看我们的",
      "MCP Authentication Error:": "MCP 验证错误：",
      "MCP Configuration Error:": "MCP 配置错误：",
      "MCP Install Error:": "MCP 安装错误：",
      "MCP Restart Error:": "MCP 重启错误：",
      "MCP Servers Disabled": "MCP 服务器已停用",
      "MCP Tools": "MCP 工具",
      "MCP error": "MCP 错误",
      "MCP server error": "MCP 服务器错误",
      "MCP tools": "MCP 工具",
      "Machine": "机器",
      "Main Agent": "主 Agent",
      "Make default": "设为默认",
      "Make your coding agent a better engineer": "让你的编程 Agent 成为更好的工程师",
      "Manage Hooks": "管理钩子",
      "Manage and delete your data anytime": "随时管理和删除你的数据",
      "Manage fine-grained permissions for GitHub.": "管理 GitHub 的细粒度权限。",
      "Manage your conversations from the companion website.": "在配套网站上管理你的对话。",
      "Manage your keybinding scheme and customize shortcuts in VS Code.": "在 VS Code 里管理快捷键方案和自定义快捷键。",
      "Manage your model quota and credits.": "管理你的模型配额和额度。",
      "Managed by Enterprise Gateway": "由企业网关管理",
      "Managed by plugin": "由插件管理",
      "Manager": "管理器",
      "Manifest Changes": "清单改动",
      "Manual Order": "手动排序",
      "Many external websites (such as Google Search, GitHub, or Wikipedia) restrict iframe embedding via": "很多外部网站（比如 Google 搜索、GitHub、维基百科）限制了 iframe 嵌入，方式是",
      "Mark All as Read": "全部标为已读",
      "Mark This Conversation as Read": "把这个对话标为已读",
      "Mark This Conversation as Unread": "把这个对话标为未读",
      "Markdown Artifact Width": "Markdown 产出物宽度",
      "Markdown attachment": "Markdown 附件",
      "Markdown view mode": "Markdown 查看模式",
      "Marketplace notice": "插件市场提示",
      "Match Case (Aa)": "区分大小写（Aa）",
      "Match Whole Word (ab)": "全字匹配（ab）",
      "Match case": "区分大小写",
      "Match whole word": "全字匹配",
      "Matcher:": "匹配条件：",
      "Mcp Tools": "MCP 工具",
      "Media actions": "媒体操作",
      "Members": "成员",
      "Mention Page": "引用页面",
      "Merge Conflict": "合并冲突",
      "Merged": "已合并",
      "Mermaid diagram": "Mermaid 图表",
      "Message this chat": "给这个对话发消息",
      "Messages now send immediately. Configure in": "消息现在会立即发送。可以在这里设置：",
      "Method not found": "找不到方法",
      "Migrate with Agent": "让 Agent 迁移",
      "Minimize side question": "最小化旁支提问",
      "Minimized": "已最小化",
      "Minus": "减号",
      "Missing": "缺失",
      "Missing a repository? Configure on GitHub": "找不到仓库？去 GitHub 上配置",
      "Model Credits": "模型额度",
      "Model Quota": "模型配额",
      "Model Summarization Failed": "模型总结失败",
      "Model quota reached": "已达到模型配额",
      "Models & Usage": "模型与用量",
      "Models Tab": "模型标签页",
      "Modified": "已修改",
      "Modified Files": "已修改的文件",
      "Modified in": "修改于",
      "Monday": "星期一",
      "More Plugins": "更多插件",
      "More cloud environments": "更多云端环境",
      "More toolbar actions": "更多工具栏操作",
      "Mouse button pressed": "鼠标已按下",
      "Mouse button released": "鼠标已松开",
      "Move Conversation Down": "下移对话",
      "Move Conversation Up": "上移对话",
      "Move Down": "下移",
      "Move Up": "上移",
      "Move to Group": "移到分组",
      "Move to New Group": "移到新分组",
      "Movie": "影片",
      "Mute Voice Mic": "语音模式麦克风静音",
      "Mute Voice Speaker": "语音模式扬声器静音",
      "Navigate to": "转到",
      "Navigation": "导航",
      "Needs Attention": "需要处理",
      "Needs Input": "需要输入",
      "Needs attention": "需要处理",
      "Needs reconnect": "需要重新连接",
      "Needs relaunch": "需要重新启动",
      "Network Permissions": "网络权限",
      "New": "新",
      "New Agent Script": "新建 Agent 脚本",
      "New Browser": "新建浏览器",
      "New Conversation Button": "新建对话按钮",
      "New Coordinator": "新建协调者",
      "New Fig Workspace": "新建 Fig 工作区",
      "New Group": "新建分组",
      "New Preview": "新建预览",
      "New Side Question": "新建旁支提问",
      "New Terminal": "新建终端",
      "New Terminal Tab": "新建终端标签页",
      "New Workspace": "新建工作区",
      "New Worktree": "新建工作树",
      "New automation": "新建自动化任务",
      "New conversation button": "新建对话按钮",
      "New coordinator": "新建协调者",
      "New hook name": "新钩子名称",
      "New models have been enabled for you!": "已为你开放新模型！",
      "Next Match (Enter)": "下一个匹配（Enter）",
      "Next Page": "下一页",
      "Next Side Panel Tab": "下一个侧边面板标签页",
      "Next card": "下一张卡片",
      "Next match": "下一个匹配",
      "Next question": "下一个问题",
      "Next side question": "下一个旁支提问",
      "Nickname": "昵称",
      "No MCP servers installed": "还没有安装 MCP 服务器",
      "No Models Available": "没有可用的模型",
      "No Plugins Available": "没有可用的插件",
      "No active terminals": "没有运行中的终端",
      "No active terminals. Click + to create one.": "没有运行中的终端。点 + 新建一个。",
      "No archived conversations": "没有已归档的对话",
      "No background tasks": "没有后台任务",
      "No branches": "没有分支",
      "No branches found": "找不到分支",
      "No browser pages open": "没有打开的浏览器页面",
      "No bundles available.": "没有可用的套装。",
      "No changes to amend": "没有可修改提交的改动",
      "No changes to review": "没有要审阅的改动",
      "No comments yet": "还没有评论",
      "No compatible devices found.": "找不到兼容的设备。",
      "No content available for this resource": "这个资源没有可用内容",
      "No coordinators": "没有协调者",
      "No custom agents yet.": "还没有自定义 Agent。",
      "No customizations match your search.": "没有符合搜索的自定义项。",
      "No documents": "没有文档",
      "No environments found": "找不到环境",
      "No events recorded": "没有记录到事件",
      "No events recorded.": "没有记录到事件。",
      "No file changes": "没有文件改动",
      "No files or folders found": "找不到文件或文件夹",
      "No handlers configured for": "没有配置处理程序：",
      "No hosts in": "没有主机：",
      "No instances yet.": "还没有实例。",
      "No instructions.": "没有说明。",
      "No internet. Agent features may not work.": "没有网络，Agent 功能可能用不了。",
      "No keyboard shortcuts found matching your filter.": "没有符合筛选条件的快捷键。",
      "No links": "没有链接",
      "No longer available": "已不可用",
      "No matching": "没有匹配的",
      "No matching conversations": "没有匹配的对话",
      "No matching files": "没有匹配的文件",
      "No matching flags": "没有匹配的开关",
      "No matching plugins found.": "没有找到匹配的插件。",
      "No matching project folders. Apply to use the custom URI.": "没有匹配的项目文件夹。点「应用」使用自定义地址。",
      "No matching resources found.": "没有找到匹配的资源。",
      "No matching results": "没有匹配的结果",
      "No models are available for your current project or account. Please check your project settings and IAM permissions.": "你当前的项目或账号没有可用的模型，请检查项目设置和 IAM 权限。",
      "No models available": "没有可用的模型",
      "No more older messages": "没有更早的消息了",
      "No notebook cells were found.": "没有找到笔记本单元格。",
      "No plugin loads from this folder.": "这个文件夹里没有可加载的插件。",
      "No plugins available": "没有可用的插件",
      "No plugins available.": "没有可用的插件。",
      "No previous worktrees": "没有以前的工作树",
      "No project selected": "未选择项目",
      "No project selected or project management not available.": "没有选择项目，或者项目管理不可用。",
      "No projects created": "还没有创建项目",
      "No quota information available.": "没有配额信息。",
      "No recent downloads": "最近没有下载",
      "No resources available": "没有可用的资源",
      "No runs yet": "还没有运行记录",
      "No sign-in needed": "不需要登录",
      "No sign-in required. This app is ready to use.": "不需要登录，这个应用可以直接用。",
      "No sites have cookies in the built-in browser.": "内置浏览器里还没有网站保存 Cookie。",
      "No sites match “": "没有符合的网站：“",
      "No skills available": "没有可用的技能",
      "No subagents": "没有子 Agent",
      "No uploads": "没有上传的文件",
      "No workspaces open.": "没有打开的工作区。",
      "Not Found": "未找到",
      "Not Signed In": "未登录",
      "Not available": "不可用",
      "Not configured": "未配置",
      "Not connected": "未连接",
      "Not on a branch": "不在任何分支上",
      "Not scheduled": "未安排",
      "Not secure": "不安全",
      "Not signed in": "未登录",
      "Not started": "未开始",
      "Not suitable for Best-of-N": "不适合多选一",
      "Notebook cell output": "笔记本单元格输出",
      "Nothing is running right now": "现在没有在运行的任务",
      "Nothing said yet": "还没说话",
      "Notification Preferences": "通知偏好",
      "Number of hours": "小时数",
      "Offline": "离线",
      "On a schedule": "按计划",
      "One last thing before getting started…": "开始之前还有最后一件事…",
      "Online": "在线",
      "Only Archived": "只看已归档",
      "Only Automations": "只看自动化任务",
      "Only Unread": "只看未读",
      "Only applies when grouped by status": "只在按状态分组时生效",
      "Only stored on your machine.": "只保存在你的电脑上。",
      "Open Antigravity IDE": "打开 Antigravity IDE",
      "Open Appearance": "打开外观设置",
      "Open Blame in Code Search": "在代码搜索里打开 Blame",
      "Open Browser Setup": "打开浏览器设置",
      "Open Command Palette": "打开命令面板",
      "Open Conversation Picker": "打开对话选择器",
      "Open Conversation in New Tab": "在新标签页中打开对话",
      "Open Diff": "打开差异",
      "Open File": "打开文件",
      "Open File Search": "打开文件搜索",
      "Open Folder (Interactive)": "打开文件夹（交互式）",
      "Open Google Chrome on the machine running Antigravity.": "在运行 Antigravity 的电脑上打开 Google Chrome。",
      "Open IDE": "打开 IDE",
      "Open Image in New Tab": "在新标签页中打开图片",
      "Open In": "打开方式",
      "Open Keyboard Shortcuts": "打开键盘快捷键",
      "Open Link in External Browser": "在外部浏览器中打开链接",
      "Open Link in New Tab": "在新标签页中打开链接",
      "Open MCP Config": "打开 MCP 配置",
      "Open Preferences": "打开偏好设置",
      "Open Search": "打开搜索",
      "Open Source Code": "打开源代码",
      "Open System Browser": "打开系统浏览器",
      "Open Tabs": "已打开的标签页",
      "Open Terminal": "打开终端",
      "Open Trajectory Debug View": "打开轨迹调试视图",
      "Open URL": "打开网址",
      "Open Workspace Selector": "打开工作区选择器",
      "Open a merge request": "发起合并请求",
      "Open a pull request": "发起 Pull Request",
      "Open extracted DOM in editor": "在编辑器中打开提取的 DOM",
      "Open in Antigravity IDE": "在 Antigravity IDE 中打开",
      "Open in Built-in Browser": "在内置浏览器中打开",
      "Open in Cider": "在 Cider 中打开",
      "Open in Code Search": "在代码搜索中打开",
      "Open in External Browser": "在外部浏览器中打开",
      "Open in Hub": "在 Hub 中打开",
      "Open in New Tab": "在新标签页中打开",
      "Open in New Window": "在新窗口中打开",
      "Open in Notebook View": "在笔记本视图中打开",
      "Open in Remote Control": "在远程控制中打开",
      "Open in Side Pane": "在侧边窗格中打开",
      "Open in Side Panel": "在侧边面板中打开",
      "Open in Tab": "在标签页中打开",
      "Open in full conversation": "在完整对话中打开",
      "Open in new tab": "在新标签页中打开",
      "Open in side pane": "在侧边窗格中打开",
      "Open in tab": "在标签页中打开",
      "Open link": "打开链接",
      "Open on another device": "在另一台设备上打开",
      "Open on phone": "在手机上打开",
      "Open project settings": "打开项目设置",
      "Open search in external browser": "在外部浏览器中搜索",
      "Open settings menu": "打开设置菜单",
      "Open side-by-side view": "打开并排视图",
      "Open the change": "打开这项改动",
      "Open the page in system browser": "在系统浏览器中打开页面",
      "Operating System": "操作系统",
      "Optimize the interface and terminal output for screen readers.": "针对屏幕阅读器优化界面和终端输出。",
      "Optimized for you": "为你优化",
      "Optional": "可选",
      "Optional boolean filter": "可选的布尔筛选",
      "Optional branch or ref used when creating a new Cog workspace (defaults to main if unset).": "从提示词创建新 Cog 工作区时使用的分支或引用（不填默认为 main）。",
      "Orchestrator": "编排器",
      "Orchestrator Model": "编排模型",
      "Orchestrator Settings": "编排器设置",
      "Organization Allowed Domains (Read-Only)": "组织允许的域名（只读）",
      "Organizations": "组织",
      "Other Customizations": "其他自定义项",
      "Other License": "其他许可证",
      "Other sign-in options": "其他登录方式",
      "Output:": "输出：",
      "Outside of folders file access policy": "文件夹外文件访问策略",
      "Override feature environment": "覆盖功能环境",
      "Page": "页面",
      "Page contents": "页面内容",
      "Password Prompt Blocked": "已阻止密码输入提示",
      "Paste a code instead": "改为粘贴代码",
      "Paste auth code": "粘贴验证码",
      "Paste authorization code": "粘贴授权码",
      "Paste code": "粘贴代码",
      "Paste new key": "粘贴新密钥",
      "Paste the code shown after you sign in.": "粘贴登录后显示的代码。",
      "Path copied!": "路径已复制！",
      "Pay As You Go": "按量付费",
      "Payload:": "负载：",
      "Period": "句号",
      "Permanently delete": "永久删除",
      "Permanently delete your remote conversations, projects, scheduled tasks, connected plugins and settings. Data in the desktop app and your Google account are not affected.": "永久删除你的远程对话、项目、定时任务、已连接的插件和设置。桌面应用里的数据和你的 Google 账号不受影响。",
      "Permission Details": "权限详情",
      "Permission Settings": "权限设置",
      "Permission approval scope": "权限批准范围",
      "Pick up this remote conversation on your phone or in any browser. Scan the QR code or open the link below.": "在手机或任意浏览器上继续这个远程对话。扫描二维码或打开下面的链接。",
      "Pin / Unpin Conversation": "置顶 / 取消置顶对话",
      "Pin This Conversation": "置顶这个对话",
      "Pinned Actions": "固定的操作",
      "Plan upgrade required": "需要升级套餐",
      "Plans the work, makes design decisions, and reviews the result. Pick a top-tier model. You can also pick one per conversation from the Orchestrator row in the model menu.": "规划工作、做设计决策、审查结果。选一个顶级模型。也可以在模型菜单的「编排器」一行里为单个对话选择。",
      "Play a sound when your action is needed or the agent finishes.": "需要你处理或 Agent 完成时播放提示音。",
      "Playback available": "可以回放",
      "Please describe the feature you'd like to see. The more detailed the requirements, the easier it will be for our team to incorporate your ideas. Some helpful information includes:": "请描述你想要的功能。需求写得越详细，我们的团队越容易采纳你的想法。可以包括这些信息：",
      "Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:": "请详细描述问题。反馈越具体，我们的团队越快处理。可以包括这些信息：",
      "Please describe your auth or billing issue. More details will help our support team resolve your issue quicker. Some helpful information includes:": "请描述你的登录或账单问题。细节越多，支持团队越快帮你解决。可以包括这些信息：",
      "Please list the steps to reproduce the issue": "请列出复现问题的步骤",
      "Please sign in using the Antigravity sidebar panel to view this page.": "请在 Antigravity 侧边栏面板中登录后再查看这个页面。",
      "Please verify your account to continue using": "请验证你的账号后继续使用",
      "Please verify your account, then sign in again to continue. Learn more by visiting our": "请验证你的账号，然后重新登录继续。详情请访问我们的",
      "Plugin Operation Error:": "插件操作错误：",
      "Plugin details": "插件详情",
      "Plugin metadata": "插件元数据",
      "Plugin update required": "需要更新插件",
      "Plugin:": "插件：",
      "Plugins Options": "插件选项",
      "Plugins are packaged collections of skills and MCPs to help the Agent": "插件是打包好的技能和 MCP 集合，用来帮助 Agent",
      "Plugins are packaged collections of skills and MCPs to help the Agent in": "插件是打包好的技能和 MCP 集合，用来帮助 Agent 完成",
      "Polygon": "多边形",
      "Popup": "弹出窗口",
      "Post Invocation": "调用之后",
      "Post Tool Use": "工具使用之后",
      "Pre Invocation": "调用之前",
      "Pre Tool Use": "工具使用之前",
      "Preset": "预设",
      "Press keys...": "请按键…",
      "Preview disabled (experiment off)": "预览已停用（实验功能已关闭）",
      "Preview is not available for this file type.": "这种文件类型无法预览。",
      "Preview unavailable": "无法预览",
      "Previous": "上一个",
      "Previous Match (Shift+Enter)": "上一个匹配（Shift+Enter）",
      "Previous Page": "上一页",
      "Previous Side Panel Tab": "上一个侧边面板标签页",
      "Previous Worktrees": "以前的工作树",
      "Previous card": "上一张卡片",
      "Previous match": "上一个匹配",
      "Previous question": "上一个问题",
      "Previous side question": "上一个旁支提问",
      "Pricing is based on public API pricing": "价格按公开的 API 价格计算",
      "Print telemetry to the console": "把使用数据输出到控制台",
      "Privacy Notice": "隐私声明",
      "Proceed": "继续",
      "Proceed Anyway": "仍然继续",
      "Proceed to": "继续前往",
      "Proceed with Plan": "按计划继续",
      "Prohibited Use Policy": "禁止使用政策",
      "Project 4K interface without developer tooling.": "不含开发工具的 Project 4K 界面。",
      "Project Agent": "项目 Agent",
      "Project Folders": "项目文件夹",
      "Project General": "项目常规设置",
      "Project ID:": "项目 ID：",
      "Project Name": "项目名称",
      "Project Settings": "项目设置",
      "Project already exists": "项目已存在",
      "Project location": "项目位置",
      "Project options": "项目选项",
      "Promote to conversation": "升级为对话",
      "Prompt": "提示词",
      "Prompt to run when triggered...": "触发时要运行的提示词…",
      "Prompt too simple": "提示词太简单",
      "Protocol": "协议",
      "Prototype": "原型",
      "Provide Feedback": "提供反馈",
      "Provide Google Cloud Project": "提供 Google Cloud 项目",
      "Pull Requests": "Pull Request",
      "Pull request actions": "Pull Request 操作",
      "Pull request creation": "创建 Pull Request",
      "Pull request numbers": "Pull Request 编号",
      "Pull requests": "Pull Request",
      "Purchase Credits": "购买额度",
      "Push": "推送",
      "Push succeeded": "推送成功",
      "Queued Messages": "排队消息",
      "Quick Start": "快速开始",
      "Quota": "配额",
      "Quote": "引用",
      "Quote Selection": "引用所选内容",
      "Radar": "雷达",
      "Raw": "原始内容",
      "Read URL rejected": "读取网址被拒绝",
      "Read URLs": "读取网址",
      "Read access": "读取权限",
      "Read access to code, refs, commits, and other repository contents.": "代码、引用、提交和其他仓库内容的读取权限。",
      "Read files": "读取文件",
      "Readme": "自述文件",
      "Reads": "读取",
      "Ready": "就绪",
      "Reason for opting out": "不参与的原因",
      "Receive product updates, tips, and promotions from Google Antigravity via email.": "通过邮件接收 Google Antigravity 的产品动态、技巧和优惠信息。",
      "Recent Events": "最近事件",
      "Recent Files": "最近的文件",
      "Recent files": "最近的文件",
      "Recommended": "推荐",
      "Reconnect": "重新连接",
      "Record Audio": "录音",
      "Recordings": "录音",
      "Red": "红色",
      "Redact": "隐去",
      "References": "引用",
      "Refresh MCP servers": "刷新 MCP 服务器",
      "Refresh all credentials": "刷新全部凭据",
      "Refresh gcert Credentials": "刷新 gcert 凭据",
      "Refresh quota and credits data": "刷新配额和额度数据",
      "Refreshed credentials for all automations.": "已刷新所有自动化任务的凭据。",
      "Reject Step": "拒绝这一步",
      "Relaunch ↻": "重新启动 ↻",
      "Reload Window": "重新加载窗口",
      "Reload app": "重新加载应用",
      "Reload this window.": "重新加载这个窗口。",
      "Remote": "远程",
      "Remote Agents Data": "远程 Agent 数据",
      "Remote Control Instances": "远程控制实例",
      "Remote Control Issue": "远程控制问题",
      "Remote Control isn't active on this instance. Enable it in": "这个实例没有开启远程控制。请在这里开启：",
      "Remote Control link": "远程控制链接",
      "Remote Projects": "远程项目",
      "Remote agents are busy": "远程 Agent 都在忙",
      "Remote branches": "远程分支",
      "Remote only": "仅远程",
      "Remove From Split": "移出分屏",
      "Remove Shortcut": "删除快捷键",
      "Remove audio": "删除音频",
      "Remove bundle": "移除套装",
      "Remove from Group": "移出分组",
      "Remove from Recent": "从最近中移除",
      "Remove from Split": "移出分屏",
      "Remove from history": "从历史记录中删除",
      "Remove from history (Shift+Delete)": "从历史记录中删除（Shift+Delete）",
      "Remove from list": "从列表中移除",
      "Remove individual uploaded files or connected resources in Project Settings, or delete a project or conversation to remove its stored files.": "在「项目设置」里删除单个上传的文件或已连接的资源，或者删除项目、对话来移除它保存的文件。",
      "Remove policy": "移除策略",
      "Remove resource": "移除资源",
      "Remove trigger": "移除触发条件",
      "Removed from the marketplace. Stays installed until you uninstall it.": "已从插件市场下架。在你卸载之前会一直保留。",
      "Rename Conversation": "重命名对话",
      "Rename Group": "重命名分组",
      "Rename This Conversation": "重命名这个对话",
      "Renamed": "已重命名",
      "Render failed": "渲染失败",
      "Rendering playback": "正在渲染回放",
      "Reopen Closed Tab": "重新打开已关闭的标签页",
      "Reopen Locally": "在本地重新打开",
      "Reopen ↗": "重新打开 ↗",
      "Repeat every": "重复间隔",
      "Repeat unit": "重复单位",
      "Replace the default browser right-click menu with quick actions.": "用快捷操作替换浏览器默认的右键菜单。",
      "Replace with": "替换为",
      "Replace with New": "替换为新的",
      "Replacing removes the currently installed plugin and installs the new one in its place.": "替换会卸载当前安装的插件，并在原位置装上新的。",
      "Reply": "回复",
      "Reply to /help": "回复 /help",
      "Repo": "仓库",
      "Repositories": "仓库",
      "Repository": "仓库",
      "Request Review": "请求审阅",
      "Research anything": "研究任何问题",
      "Reset All to Defaults": "全部恢复默认",
      "Reset all shortcuts to defaults": "把所有快捷键恢复默认",
      "Reset to preset": "恢复为预设",
      "Reset zoom (0)": "重置缩放（0）",
      "Resize side question panel": "调整旁支提问面板大小",
      "Resize terminal panes": "调整终端窗格大小",
      "Resolved in chat": "已在对话中解决",
      "Resolving link…": "正在解析链接…",
      "Resolving permissions...": "正在解析权限…",
      "Resources": "资源",
      "Restore Conversation": "恢复对话",
      "Restricts agent tools to a secure, isolated local sandbox.": "把 Agent 工具限制在一个安全隔离的本地沙盒里。",
      "Results": "结果",
      "Resume 1 comment draft": "继续 1 条评论草稿",
      "Resume comment draft": "继续评论草稿",
      "Resume it to load this file.": "恢复运行后才能加载这个文件。",
      "Resume it to open a new terminal. Anything that was running in this one has stopped.": "恢复运行后才能打开新终端。这个终端里原来在运行的东西已经停止了。",
      "Resume this agent where it paused": "让这个 Agent 从暂停的地方继续",
      "Retry requested": "已请求重试",
      "Revert file changes": "还原文件改动",
      "Review bundle before adding": "添加前先检查套装",
      "Review contents": "查看内容",
      "Review plans and walkthroughs": "审阅计划和讲解",
      "Right": "右",
      "Robot": "机器人",
      "Run": "运行",
      "Run (unsandboxed)": "运行（不使用沙盒）",
      "Run Now": "立即运行",
      "Run a prompt on a schedule, like a morning summary of yesterday's changes. Runs show up here.": "按计划运行一段提示词，比如每天早上汇总昨天的改动。运行记录会显示在这里。",
      "Run all commands without restrictions.": "不受限制地运行所有命令。",
      "Run in a new worktree": "在新工作树中运行",
      "Run in your current workspace": "在当前工作区中运行",
      "Run terminal commands with sandbox restrictions.": "在沙盒限制下运行终端命令。",
      "Run the app against a Linux environment. Connecting relaunches the app into the selected WSL distro.": "在 Linux 环境中运行应用。连接后应用会在选中的 WSL 发行版中重新启动。",
      "Run visibility": "运行可见性",
      "Running (Dev only)": "运行中（仅开发版）",
      "Running processes are killed. This cannot be undone.": "正在运行的进程会被结束，无法撤销。",
      "Runs as": "运行身份",
      "Runs on this computer": "在这台电脑上运行",
      "Runs remotely": "远程运行",
      "Runtime permission": "运行时权限",
      "SSH Config": "SSH 配置",
      "SSH Host": "SSH 主机",
      "SSH Host…": "SSH 主机…",
      "SSH host": "SSH 主机",
      "Sample GDoc": "示例 Google 文档",
      "Saturday": "星期六",
      "Save audio recordings": "保存录音",
      "Saving…": "正在保存…",
      "Scan the code to open this device in Remote Control, or": "扫码在远程控制中打开这台设备，或者",
      "Scope": "范围",
      "Scopes:": "范围：",
      "Screen": "屏幕",
      "Screen Reader Mode": "屏幕阅读器模式",
      "Screen Recording": "屏幕录制",
      "Screen locked: agents can't use this Mac until you unlock it": "屏幕已锁定：解锁之前 Agent 无法使用这台 Mac",
      "Screenshot must be under 10 MB": "截图必须小于 10 MB",
      "Scroll position": "滚动位置",
      "Scrolled": "已滚动",
      "Search Google Drive": "搜索 Google Drive",
      "Search MCP servers by name": "按名称搜索 MCP 服务器",
      "Search Projects": "搜索项目",
      "Search Recent Workspaces": "搜索最近的工作区",
      "Search branches": "搜索分支",
      "Search connectors": "搜索连接器",
      "Search conversations...": "搜索对话…",
      "Search customizations...": "搜索自定义项…",
      "Search file contents...": "搜索文件内容…",
      "Search filters…": "搜索筛选条件…",
      "Search flags": "搜索开关",
      "Search for MCP servers to add to your configuration": "搜索要添加到配置里的 MCP 服务器",
      "Search for commands...": "搜索命令…",
      "Search for content to open": "搜索要打开的内容",
      "Search for conversations...": "搜索对话…",
      "Search projects...": "搜索项目…",
      "Search results": "搜索结果",
      "Search shortcuts": "搜索快捷键",
      "Search shortcuts...": "搜索快捷键…",
      "Search sites": "搜索网站",
      "Search sites...": "搜索网站…",
      "Search triggers…": "搜索触发条件…",
      "Searching…": "正在搜索…",
      "Security": "安全",
      "Security preset": "安全预设",
      "See Activity": "查看动态",
      "See Plans": "查看套餐",
      "See all (": "查看全部（",
      "See more results": "查看更多结果",
      "Seek": "跳转",
      "Select": "选择",
      "Select Environment": "选择环境",
      "Select License": "选择许可证",
      "Select Model": "选择模型",
      "Select Model to Send Message": "选择发送消息用的模型",
      "Select Next Conversation": "选择下一个对话",
      "Select Previous Conversation": "选择上一个对话",
      "Select Project": "选择项目",
      "Select Sidebar Item 1": "选择侧边栏第 1 项",
      "Select Sidebar Item 2": "选择侧边栏第 2 项",
      "Select Sidebar Item 3": "选择侧边栏第 3 项",
      "Select Sidebar Item 4": "选择侧边栏第 4 项",
      "Select Sidebar Item 5": "选择侧边栏第 5 项",
      "Select Sidebar Item 6": "选择侧边栏第 6 项",
      "Select Sidebar Item 7": "选择侧边栏第 7 项",
      "Select Sidebar Item 8": "选择侧边栏第 8 项",
      "Select Sidebar Item 9": "选择侧边栏第 9 项",
      "Select Worktree": "选择工作树",
      "Select a folder.": "选择一个文件夹。",
      "Select a model using the model selector in the input box": "在输入框的模型选择器里选一个模型",
      "Select all in": "全选：",
      "Select an option": "选择一项",
      "Select an option...": "选择一项…",
      "Select another model": "换一个模型",
      "Select one or more options": "选择一项或多项",
      "Select or enter a workspace URI": "选择或输入工作区地址",
      "Select text in the PDF and click + Add to start commenting.": "在 PDF 里选中文字，点「+ 添加」开始评论。",
      "Select text in the artifact to add a comment": "在产出物里选中文字来添加评论",
      "Select the latest snapshot from the": "选择最新的快照：",
      "Select the workspace type that will be used for new conversations started with the New Workspace option.": "选择用「新建工作区」开始新对话时使用的工作区类型。",
      "Select workspace": "选择工作区",
      "Select your license": "选择你的许可证",
      "Select...": "选择…",
      "Selected element preview": "所选元素预览",
      "Selected region": "所选区域",
      "Semantic": "语义",
      "Semicolon": "分号",
      "Send Feedback": "发送反馈",
      "Send Now": "立即发送",
      "Send command input?": "发送命令输入？",
      "Send feedback as": "反馈发送人：",
      "Send messages with the keyboard's Enter key instead of starting a new line.": "用键盘的 Enter 键发送消息，而不是换行。",
      "Send reply": "发送回复",
      "Sending transcribed message...": "正在发送转写的消息…",
      "Sends after agent finishes working": "Agent 完成后发送",
      "Sent": "已发送",
      "Sent Message": "已发送的消息",
      "Services this plugin connects to on your behalf.": "这个插件代表你连接的服务。",
      "Session Summary": "会话摘要",
      "Set Project Name": "设置项目名称",
      "Set at least one scope filter": "至少设置一个范围筛选条件",
      "Set the rules, define the boundaries.": "定好规则，划好边界。",
      "Set up": "设置",
      "Set up authentication": "设置身份验证",
      "Set up my environment": "设置我的环境",
      "Settings Unavailable": "设置不可用",
      "Settings for conversations outside of projects.": "项目以外的对话的设置。",
      "Settings ↗": "设置 ↗",
      "Setup": "设置",
      "Setup required": "需要设置",
      "Setup script failed.": "初始化脚本运行失败。",
      "Setup script ran successfully.": "初始化脚本运行成功。",
      "Share your referral link with friends": "把邀请链接分享给朋友",
      "Shield": "盾牌",
      "Show 10": "显示 10 条",
      "Show 5": "显示 5 条",
      "Show All": "显示全部",
      "Show Automation Conversations": "显示自动化任务对话",
      "Show Details": "显示详情",
      "Show Plugin Conversations": "显示插件对话",
      "Show Remote Control QR code": "显示远程控制二维码",
      "Show how full the context window is next to the send button. Click it for a breakdown and to see your model quota.": "在发送按钮旁边显示上下文窗口用了多少。点它可以看明细和模型配额。",
      "Show in Sidebar": "在侧边栏中显示",
      "Show in folder": "在文件夹中显示",
      "Show more (": "显示更多（",
      "Show or Hide Plugins": "显示或隐藏插件",
      "Show submitted (": "显示已提交的（",
      "Show system notifications when your action is needed or the agent finishes.": "需要你处理或 Agent 完成时显示系统通知。",
      "Side Question": "旁支提问",
      "Side Question Selection": "旁支提问所选内容",
      "Side Questions": "旁支提问",
      "Sidecar View": "侧车视图",
      "Sidecar error": "侧车出错",
      "Sidecar feature is not available.": "侧车功能不可用。",
      "Sign in again": "重新登录",
      "Sign in needed": "需要登录",
      "Sign in required": "需要登录",
      "Sign in required.": "需要登录。",
      "Sign in to an app once and your agent can use it on any device. Open an app to see the account it uses or to disconnect it.": "在一个应用里登录一次，Agent 在任何设备上都能用它。打开应用可以查看它用的账号，或者断开连接。",
      "Sign in to finish setting up this plugin.": "登录以完成这个插件的设置。",
      "Sign in with a different account": "用其他账号登录",
      "Sign up for newsletters, tips and tricks, and other notifications about": "订阅新闻、技巧和其他通知：",
      "Sign-in required": "需要登录",
      "Signed in as": "已登录：",
      "Signed-in accounts": "已登录的账号",
      "Simplified interface for research, writing, and everyday tasks.": "精简界面，适合研究、写作和日常任务。",
      "Simulate a different host (Electron, desktop or mobile Web, Extension, remote control, or installed PWA).": "模拟其他宿主（Electron、桌面或移动网页、扩展、远程控制、已安装的 PWA）。",
      "Simulate a different user cohort (Google, External, Enterprise).": "模拟其他用户群（Google、外部、企业）。",
      "Simulate running on a different OS.": "模拟在其他操作系统上运行。",
      "Site data cleared for": "已清除这个网站的数据：",
      "Sites with cookies": "保存了 Cookie 的网站",
      "Skipped": "已跳过",
      "Slash": "斜杠",
      "Sliders": "滑块",
      "Snooze for 24 Hours": "24 小时内不再提醒",
      "Some non-image binary content was truncated.": "部分非图片的二进制内容被截断了。",
      "Something else (optional)": "其他（可选）",
      "Something went wrong!": "出错了！",
      "Sorry, this account is ineligible to use": "抱歉，这个账号没有资格使用",
      "Sort By": "排序方式",
      "Sort Conversations": "对话排序",
      "Sound": "声音",
      "Source": "来源",
      "Source:": "来源：",
      "Sources": "来源",
      "Space": "空格",
      "Sparkles": "闪光",
      "Speedometer": "速度表",
      "Split": "分屏",
      "Split Conversation Horizontally": "水平拆分对话",
      "Split Conversation Vertically": "垂直拆分对话",
      "Split Down": "向下拆分",
      "Split Right": "向右拆分",
      "Split Terminal": "拆分终端",
      "Square": "方形",
      "Stage change": "暂存改动",
      "Staged Changes": "已暂存的改动",
      "Staged index changes and working tree changes": "已暂存的索引改动和工作区改动",
      "Stamp": "印章",
      "Standalone": "独立",
      "Standalone Terminals": "独立终端",
      "Start Best-of-": "开始多选一：",
      "Start Voice Recording": "开始录音",
      "Start it again.": "重新启动它。",
      "Starting": "正在启动",
      "Starting terminal…": "正在启动终端…",
      "Starting the conversation…": "正在开始对话…",
      "Stay up to date.": "随时了解最新动态。",
      "Step Type": "步骤类型",
      "Steps to Reproduce": "复现步骤",
      "Steps to reproduce the issue": "复现问题的步骤",
      "Still running": "仍在运行",
      "Stop All Subagents": "停止所有子 Agent",
      "Stop Editing": "停止编辑",
      "Stop Execution": "停止执行",
      "Stop Recording": "停止录音",
      "Stop SSH Server…": "停止 SSH 服务器…",
      "Stop Side Question": "停止旁支提问",
      "Stop Subagent": "停止子 Agent",
      "Stop Task": "停止任务",
      "Stop Voice Recording": "停止录音",
      "Stop execution": "停止执行",
      "Stop side question": "停止旁支提问",
      "Stop subagent": "停止子 Agent",
      "Stop this agent": "停止这个 Agent",
      "Stop transcription": "停止转写",
      "Stopped": "已停止",
      "Stopping…": "正在停止…",
      "Stored and mounted in your cloud environment": "保存并挂载在你的云端环境里",
      "Stream and control": "串流和控制",
      "Stream ended": "串流已结束",
      "Su Mo Tu We Th Fr Sa": "日 一 二 三 四 五 六",
      "Subagent Conversation": "子 Agent 对话",
      "Subagent ended": "子 Agent 已结束",
      "Subagents": "子 Agent",
      "Submit Prompt (Alternate to Enter)": "提交提示词（Enter 的备用键）",
      "Submit comment": "提交评论",
      "Submitting...": "正在提交…",
      "Subscription": "订阅",
      "Substring or list check (e.g.": "子串或列表检查（例如",
      "Subtitles": "字幕",
      "Successfully imported project:": "已成功导入项目：",
      "Summarizing call…": "正在总结通话…",
      "Sun Mon Tue Wed Thu Fri Sat": "日 一 二 三 四 五 六",
      "Sunday": "星期日",
      "Sunday Monday Tuesday Wednesday Thursday Friday Saturday": "星期日 星期一 星期二 星期三 星期四 星期五 星期六",
      "Switch IDE Workspace": "切换 IDE 工作区",
      "Switch Roles": "切换角色",
      "Switch To": "切换到",
      "Switch mic": "切换麦克风",
      "Switch to This Computer": "切换到这台电脑",
      "Sync JJ worktrees to head": "把 JJ 工作树同步到最新",
      "Sync newly created JJ worktrees to head when starting a conversation.": "开始对话时把新建的 JJ 工作树同步到最新。",
      "System default app": "系统默认应用",
      "Table of contents": "目录",
      "Table options": "表格选项",
      "Taking longer than usual to load": "加载时间比平时长",
      "Target": "目标",
      "Target Tools:": "目标工具：",
      "Target text in PDF...": "PDF 中的目标文字…",
      "Task Logs": "任务日志",
      "Task not found": "找不到任务",
      "Telemetry is disabled in Settings": "使用数据已在设置中关闭",
      "Telemetry is turned off for your account.": "你的账号已关闭使用数据。",
      "Tell the agent what to do instead...": "告诉 Agent 换成做什么…",
      "Terminal & Tooling Permissions": "终端和工具权限",
      "Terminal Commands": "终端命令",
      "Terminal Placement": "终端位置",
      "Terminal command auto execution": "终端命令自动执行",
      "Terminal commands": "终端命令",
      "Terminal window": "终端窗口",
      "Terminal: Add to Chat": "终端：加入对话",
      "Terminal: Select All": "终端：全选",
      "Terminals": "终端",
      "Terms and Privacy:": "条款和隐私：",
      "Terms of Service & Data Use": "服务条款和数据使用",
      "Text": "文本",
      "Text Selection": "文字选择",
      "Text attachment": "文本附件",
      "Text selection is paused for smoother viewing. Search, comments, and annotations still work. Use the toolbar text button when selection is needed.": "为了浏览更流畅，文字选择已暂停。搜索、评论和批注仍然可用。需要选择文字时用工具栏上的文字按钮。",
      "Thank you! Your feedback has been submitted successfully.": "谢谢！你的反馈已成功提交。",
      "The Hub sent an unexpected response.": "Hub 返回了意外的响应。",
      "The agent was prevented from accessing some sites": "Agent 被阻止访问部分网站",
      "The agent will wait for you to install the browser extension.": "Agent 会等你安装浏览器扩展。",
      "The app is currently connected to a WSL distro. Reopening locally relaunches it directly on Windows.": "应用当前连接着 WSL 发行版。在本地重新打开会直接在 Windows 上重新启动它。",
      "The branch was pushed to GitLab.": "分支已推送到 GitLab。",
      "The breakdown below shows token usage from customizations like rules, skills, and MCP. If a budget is exceeded, large rules are demoted to path pointers and large customizations are excluded automatically.": "下面的明细显示规则、技能、MCP 等自定义项的 token 用量。超出预算时，大的规则会降级成路径指引，大的自定义项会自动排除。",
      "The change was pushed to Gerrit.": "改动已推送到 Gerrit。",
      "The conversation could not be loaded because its data was not found.": "找不到这个对话的数据，无法加载。",
      "The conversation was compacted to fit within the context window.": "为了放进上下文窗口，对话已被压缩。",
      "The conversation was compacted while generating this response.": "生成这条回复时对话被压缩了。",
      "The current trigger rate is too high.": "当前触发频率太高。",
      "The full developer experience.": "完整的开发者体验。",
      "The main conversation's input isn't available right now.": "主对话的输入框现在不可用。",
      "The original Gemini 4 model for advanced workflows. Leaving on Nov 30.": "最初的 Gemini 4 模型，适合高级工作流。11 月 30 日下线。",
      "The remote shared a link for this push.": "远程仓库为这次推送分享了一个链接。",
      "Themes": "主题",
      "There are currently no Build with": "目前还没有 Build with",
      "There are no customizations enabled.": "没有启用任何自定义项。",
      "There was an error with your authentication. To log in, click": "身份验证出错了。要登录，请点击",
      "There was an unexpected issue setting up your account.": "设置账号时出现了意外问题。",
      "These MCP allowlist rules are enforced by your organization's administrator.": "这些 MCP 白名单规则由你所在组织的管理员强制执行。",
      "These allowed domain rules are set by your organization's administrator and cannot be removed.": "这些允许的域名规则由你所在组织的管理员设置，无法删除。",
      "These settings can only be changed on the computer running the app, not from a remote session.": "这些设置只能在运行应用的电脑上修改，远程会话里不行。",
      "Thinking effort": "思考强度",
      "This": "这个",
      "This Computer": "这台电脑",
      "This Google Cloud project is not supported. Input a different project, or sign in with another account.": "不支持这个 Google Cloud 项目。请换一个项目，或者用其他账号登录。",
      "This bundle has no plugins yet.": "这个套装里还没有插件。",
      "This cannot be undone.": "这个操作无法撤销。",
      "This chat is archived.": "这个对话已归档。",
      "This chat's environment is paused": "这个对话的环境已暂停",
      "This command ran in the sandbox.": "这条命令是在沙盒里运行的。",
      "This computer": "这台电脑",
      "This conversation grew too large, so the history before this point may be missing or incomplete.": "这个对话太长了，这里之前的记录可能丢失或不完整。",
      "This conversation is also open in another app. Sending messages from both may cause conflicts.": "这个对话也在另一个应用里打开着，两边同时发消息可能会冲突。",
      "This conversation is not on disk. Delete it to remove it from your sidebar.": "这个对话不在磁盘上。删除它可以从侧边栏移除。",
      "This extension has no declared permissions requiring user input.": "这个扩展没有需要你填写的权限。",
      "This is a CitC workspace (Fig share)": "这是一个 CitC 工作区（Fig 共享）",
      "This link wants to open an app on your device.": "这个链接想在你的设备上打开一个应用。",
      "This may take a few minutes": "可能需要几分钟",
      "This notebook has no renderable cells.": "这个笔记本没有可渲染的单元格。",
      "This page is blocked in the built-in browser by your organization's Context-Aware Access policy.": "你所在组织的情境感知访问策略在内置浏览器里屏蔽了这个页面。",
      "This page is taking longer than expected to load, or it may be blocking embedded views (via X-Frame-Options or CSP).": "这个页面加载时间比预期长，或者它可能禁止被嵌入显示（X-Frame-Options 或 CSP）。",
      "This page isn’t working": "这个页面无法正常运作",
      "This plugin requires authentication before the agent can use its tools.": "这个插件需要先验证身份，Agent 才能使用它的工具。",
      "This project uses Firebase. Do you want to download the Firebase skill?": "这个项目用到了 Firebase，要下载 Firebase 技能吗？",
      "This project was created for": "这个项目是为它创建的：",
      "This prompt is straightforward and does not need alternative comparisons.": "这个提示词很直接，不需要多个方案对比。",
      "This request is not well-suited for parallel Best-of-N generation.": "这个请求不适合并行的多选一生成。",
      "This side question isn't available in this conversation.": "这个旁支提问在这个对话里不可用。",
      "This skill came from the marketplace, so you can add it again whenever you need it.": "这个技能来自插件市场，需要时随时可以再添加。",
      "This will permanently delete": "这会永久删除",
      "Thumbnails": "缩略图",
      "Thursday": "星期四",
      "Time": "时间",
      "Time Zone": "时区",
      "Timeout:": "超时：",
      "Tip:": "提示：",
      "Tip: Complex tasks get better results with multiple responses.": "提示：复杂任务生成多个回答效果更好。",
      "Title:": "标题：",
      "To switch accounts, sign out in the": "要切换账号，请先退出登录：",
      "To use the agent, please login": "要使用 Agent，请先登录",
      "Toggle": "切换",
      "Toggle Between Light/Dark Themes": "切换浅色 / 深色主题",
      "Toggle Environment Selector": "切换环境选择器",
      "Toggle Google Cloud projects": "切换 Google Cloud 项目",
      "Toggle Maximize Side Panel": "切换侧边面板最大化",
      "Toggle Model Selector": "切换模型选择器",
      "Toggle Project Selector": "切换项目选择器",
      "Toggle Superpowers": "开关 Superpowers",
      "Toggle Swarm": "开关 Swarm",
      "Toggle Terminal Panel": "切换终端面板",
      "Toggle Thumbnails": "切换缩略图",
      "Toggle Virtual Machine": "切换虚拟机",
      "Toggle Voice Recording": "开始 / 停止录音",
      "Toggle Word Wrap": "切换自动换行",
      "Toggle antigravity-custom-theme-plugin": "开关 antigravity-custom-theme-plugin",
      "Toggle file diff": "切换文件差异",
      "Toggle modern-web-guidance": "开关 modern-web-guidance",
      "Toggle this on to allow creating new issues.": "打开后允许创建新的 Issue。",
      "Toggle this on to allow creating new pull requests.": "打开后允许创建新的 Pull Request。",
      "Toggle this on to enable read access on contents.": "打开后允许读取内容。",
      "Too many environments running": "运行中的环境太多了",
      "Too many requests, please try again in a bit!": "请求太多了，请稍后再试！",
      "Too many surveys": "问卷太多了",
      "Tool Output": "工具输出",
      "Tool Permissions": "工具权限",
      "Tool arguments": "工具参数",
      "Trajectory Debug View": "轨迹调试视图",
      "Trajectory ID:": "轨迹 ID：",
      "Trajectory Stats": "轨迹统计",
      "Tree": "树状",
      "Triggered": "已触发",
      "Trouble signing in? Enter authorization code": "登录遇到问题？输入授权码",
      "True changes vs the parent workspace": "相对父工作区的真实改动",
      "Try Again": "重试",
      "Try out early-stage features before they ship. These may be changed or removed at any time. These features are experimental, and we make no guarantees about performance or functionality.": "抢先试用还没正式发布的功能。这些功能随时可能修改或移除，属于实验性质，不保证性能和可用性。",
      "Tuesday": "星期二",
      "Turbo mode": "Turbo 模式",
      "Turn on a flag you don't have": "打开一个你没有的开关",
      "Type a voice variant name, such as rev27.": "输入音色变体名称，例如 rev27。",
      "Type absolute path or navigate folders...": "输入绝对路径或浏览文件夹…",
      "Type to search file contents": "输入内容来搜索文件",
      "Typing your corp password here may trigger a Password Alert reset.": "在这里输入公司密码可能会触发 Password Alert 重置。",
      "UI Plugins": "界面插件",
      "UI plugins": "界面插件",
      "UI view does not exist.": "界面视图不存在。",
      "Unable to load PDF:": "无法加载 PDF：",
      "Unable to resolve audio source URL": "无法解析音频来源地址",
      "Unauthenticated": "未验证身份",
      "Unavailable": "不可用",
      "Uncommitted": "未提交",
      "Underline": "下划线",
      "Undo to Here": "撤销到这里",
      "Unidentified": "无法识别",
      "Unimplemented": "未实现",
      "United States": "美国",
      "Unknown Environment": "未知环境",
      "Unknown Notebook": "未知笔记本",
      "Unknown Source": "未知来源",
      "Unknown edit": "未知编辑",
      "Unknown error": "未知错误",
      "Unknown file edit": "未知的文件编辑",
      "Unlock the power of agent swarms.": "释放 Agent 集群的力量。",
      "Unpin This Conversation": "取消置顶这个对话",
      "Unread": "未读",
      "Unsandboxed commands": "不使用沙盒的命令",
      "Unsent draft": "未发送的草稿",
      "Unstage change": "取消暂存改动",
      "Untracked": "未跟踪",
      "Untracked (Unstaged)": "未跟踪（未暂存）",
      "Untrusted sidecar": "不受信任的侧车",
      "Up": "上",
      "Update Available": "有可用更新",
      "Updater": "更新程序",
      "Upload Debug Bundle": "上传调试包",
      "Upload Files": "上传文件",
      "Uploaded files and connected resources are mounted in your cloud environment.": "上传的文件和连接的资源会挂载在你的云端环境里。",
      "Uploaded project files and in-chat attachments are stored on Google servers and mounted into your cloud sandbox so your agent can read and work with them.": "上传的项目文件和对话附件保存在 Google 服务器上，并挂载到你的云端沙盒里，供 Agent 读取和处理。",
      "Uploaded to Google Drive": "已上传到 Google Drive",
      "Uploading to Google Drive…": "正在上传到 Google Drive…",
      "Uploads": "上传",
      "Uptime": "运行时长",
      "Use": "使用",
      "Use Advanced SSO Config": "使用高级 SSO 配置",
      "Use Antigravity through your Gemini subscription.": "通过你的 Gemini 订阅使用 Antigravity。",
      "Use Business Account": "使用企业账号",
      "Use Default": "使用默认",
      "Use Existing": "使用现有的",
      "Use Global Settings": "使用全局设置",
      "Use Google Cloud project instead": "改用 Google Cloud 项目",
      "Use Regular Expression (.*)": "使用正则表达式（.*）",
      "Use full Git clones for Best of N": "多选一时使用完整的 Git 克隆",
      "Use full VCS clones for Best of N": "多选一时使用完整的版本库克隆",
      "Use regular expression": "使用正则表达式",
      "Use theme to be imported with settings": "使用随设置一起导入的主题",
      "Use this if your admin gave you a WIF config. Paste it below to sign in.": "如果管理员给了你 WIF 配置，就用这个。粘贴到下面来登录。",
      "Use when completing tasks, implementing major features, or before merging to verify work meets requirements": "在完成任务、实现重要功能或合并之前使用，用来确认工作符合要求",
      "Use when creating new skills, editing existing skills, or verifying skills work before deployment": "在创建新技能、编辑现有技能或部署前验证技能时使用",
      "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes": "遇到任何 bug、测试失败或异常行为时，在提出修复方案之前使用",
      "Use when executing implementation plans with independent tasks in the current session": "在当前会话中执行包含独立任务的实施计划时使用",
      "Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies": "面对 2 个以上互不依赖、不需要共享状态的任务时使用",
      "Use when implementation is complete, all tests pass, and you need to decide how to integrate the work": "实现完成、测试全部通过，需要决定怎么合并这些工作时使用",
      "Use when implementing any feature or bugfix, before writing implementation code": "在实现任何功能或修复 bug、写实现代码之前使用",
      "Use when you have a spec or requirements for a multi-step task, before touching code": "手里有多步骤任务的需求或规格说明、还没开始写代码时使用",
      "User": "用户",
      "User Intent": "用户意图",
      "User Type": "用户类型",
      "User cancelled agent execution.": "用户取消了 Agent 执行。",
      "User uploaded image": "用户上传的图片",
      "VCS used when creating a new workspace, including workspaces generated based off your initial prompt.": "新建工作区时使用的版本控制系统，包括根据你的首条提示词自动创建的工作区。",
      "VS Code Default": "VS Code 默认",
      "VS Code Keyboard Shortcuts": "VS Code 键盘快捷键",
      "Valid CEL": "有效的 CEL",
      "Valid until": "有效期至",
      "Validate": "验证",
      "Validated with GitHub and stored in": "已通过 GitHub 验证并保存在",
      "Validating setup script…": "正在验证初始化脚本…",
      "Verification required": "需要验证",
      "Verify": "验证",
      "Verify that these licenses were provided by your administrator and that you trust the project ID before proceeding. Account activity and data may be logged by your organization.": "继续之前，请确认这些许可证是管理员提供的，并且你信任这个项目 ID。你的账号活动和数据可能会被组织记录。",
      "Video attachment": "视频附件",
      "View Debug": "查看调试信息",
      "View Diff": "查看差异",
      "View Logs": "查看日志",
      "View MCP servers": "查看 MCP 服务器",
      "View Page": "查看页面",
      "View Usage": "查看用量",
      "View archived in the sidebar (Customize Sidebar).": "在侧边栏里查看已归档的（自定义侧边栏）。",
      "View comments": "查看评论",
      "View could not be opened": "无法打开视图",
      "View network request": "查看网络请求",
      "View network requests": "查看网络请求",
      "View or edit comment": "查看或编辑评论",
      "View site information": "查看网站信息",
      "Virtual File Viewer": "虚拟文件查看器",
      "Visit": "访问",
      "Visited URLs and autocomplete suggestions.": "访问过的网址和自动补全建议。",
      "Voice Speed": "语速",
      "Voice dictation unavailable": "语音听写不可用",
      "Voice engine": "语音引擎",
      "Voice engine address": "语音引擎地址",
      "Voice recording is unavailable while the Chief of Staff mic is on": "总管麦克风开着时无法录音",
      "Voice speed": "语速",
      "Voices": "音色",
      "WIF Config": "WIF 配置",
      "Wait for": "等待",
      "Waiting for the agents’ windows…": "正在等待 Agent 的窗口…",
      "Waiting for tool permission approval — click Open in full conversation (↗) to approve": "正在等待工具权限批准，点「在完整对话中打开」（↗）来批准",
      "Waiting for user input": "正在等待用户输入",
      "Waiting for you to finish signing in…": "正在等你完成登录…",
      "Warm and approachable": "温暖亲切",
      "Warm and engaging": "温暖有感染力",
      "Watermark": "水印",
      "We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.": "建议附上日志，这能帮 Antigravity 团队处理你的反馈并排好优先级。",
      "Web": "网页",
      "Web (desktop)": "网页（桌面）",
      "Web (desktop, PWA)": "网页（桌面，PWA）",
      "Web (desktop, remote agents)": "网页（桌面，远程 Agent）",
      "Web (desktop, remote agents, PWA)": "网页（桌面，远程 Agent，PWA）",
      "Web (desktop, remote control)": "网页（桌面，远程控制）",
      "Web (desktop, remote control, PWA)": "网页（桌面，远程控制，PWA）",
      "Web (mobile)": "网页（移动端）",
      "Web (mobile, PWA)": "网页（移动端，PWA）",
      "Web (mobile, remote agents)": "网页（移动端，远程 Agent）",
      "Web (mobile, remote agents, PWA)": "网页（移动端，远程 Agent，PWA）",
      "Web (mobile, remote control)": "网页（移动端，远程控制）",
      "Web (mobile, remote control, PWA)": "网页（移动端，远程控制，PWA）",
      "Web Preview": "网页预览",
      "Web search prioritized results from": "网页搜索优先采用这些来源的结果：",
      "Website": "网站",
      "Wednesday": "星期三",
      "Weekdays": "工作日",
      "Weekly": "每周",
      "Weekly Limit Remaining": "每周限额剩余",
      "What counts as a document": "哪些算文档",
      "What functionality you expect your account tier to have available that is missing": "你的账号等级应该有、但现在缺少的功能",
      "What is missing in your workflow": "你的工作流里缺了什么",
      "What quota or feature is being incorrectly limited": "哪个配额或功能被错误地限制了",
      "What should it do?": "它要做什么？",
      "What should the agent do on each run?": "每次运行时 Agent 要做什么？",
      "What should the agent do on each run? For example: summarize new bugs assigned to me and anything that changed overnight.": "每次运行时 Agent 要做什么？例如：汇总分配给我的新 bug，以及夜里有变化的内容。",
      "What should this coordinator accomplish?": "这个协调者要完成什么？",
      "What you would like to see to address this gap in your workflow": "你希望怎样弥补工作流里的这个缺口",
      "What's in this bundle": "这个套装里有什么",
      "Whatever the voice-engine-addr flag serves you.": "voice-engine-addr 开关提供的那个。",
      "When": "时间",
      "When Turbo mode is on, the agent will automatically capture screenshots in the Browser without explicit user input. You can toggle this setting in Antigravity's settings.": "开启 Turbo 模式后，Agent 会在浏览器里自动截图，不需要你确认。可以在 Antigravity 的设置里关掉。",
      "When enabled, the agent will include default customizations, including default skills.": "开启后，Agent 会带上默认自定义项，包括默认技能。",
      "When enabled, the values below replace the auto-detected OS, host, and user type used for feature gating.": "开启后，下面的值会替换自动检测到的操作系统、宿主和用户类型，用于功能开关判断。",
      "When it runs": "运行时间",
      "When should it run?": "什么时候运行？",
      "When something happens": "发生某件事时",
      "When toggled on, Antigravity collects usage data to help Google enhance performance and features.": "开启后，Antigravity 会收集使用数据，帮助 Google 改进性能和功能。",
      "Where": "位置",
      "Where it runs": "运行位置",
      "Where should it run?": "在哪里运行？",
      "Whether it never connects or is intermittent/flaky": "是完全连不上，还是时断时续",
      "Which workspace the New Conversation button and keyboard shortcut start you in.": "「新建对话」按钮和快捷键会在哪个工作区里开始。",
      "Why are you opting out of auto-triggered Best-of-N?": "你为什么不想要自动触发的多选一？",
      "Why did you choose this response?": "你为什么选这个回答？",
      "Windows Subsystem for Linux": "适用于 Linux 的 Windows 子系统",
      "Work in a CitC workspace.": "在 CitC 工作区中工作。",
      "Work in a Cog workspace.": "在 Cog 工作区中工作。",
      "Work in a New Worktree": "在新工作树中工作",
      "Work in an ABFS workspace.": "在 ABFS 工作区中工作。",
      "Worker execution error": "工作进程执行出错",
      "Workflow files": "工作流文件",
      "Workflow refs": "工作流引用",
      "Workflow runs": "工作流运行记录",
      "Workflows are changing on October 19th—stay tuned for updates. You can use the agent to migrate your workflows.": "工作流将在 10 月 19 日调整，请留意更新。可以让 Agent 帮你迁移工作流。",
      "Working Directory:": "工作目录：",
      "Workspace File Explorer": "工作区文件资源管理器",
      "Workspace URI Switcher": "工作区地址切换器",
      "Workspace URI not found": "找不到工作区地址",
      "Workspace URI query parameter": "工作区地址查询参数",
      "Workspace URI to switch to": "要切换到的工作区地址",
      "Workspace folder suggestions": "工作区文件夹建议",
      "Workspace mismatch actions": "工作区不匹配时的操作",
      "Workspace setup warning": "工作区设置警告",
      "Worktree": "工作树",
      "Wrench": "扳手",
      "Write": "写入",
      "Write a comment...": "写一条评论…",
      "Write and edit docs": "撰写和编辑文档",
      "Write files": "写入文件",
      "Yellow": "黄色",
      "You are in control": "一切由你掌控",
      "You can prompt the model to try again or start a new conversation if the error persists.": "可以让模型重试；如果一直出错，就开一个新对话。",
      "You can upgrade to a Google AI Ultra plan to receive higher rate limits.": "升级到 Google AI Ultra 套餐可以获得更高的速率限制。",
      "You should not enter any sensitive information on this site (for example, passwords or credit cards), because it could be stolen by attackers.": "不要在这个网站上输入任何敏感信息（比如密码或信用卡），可能会被攻击者窃取。",
      "You're viewing a blank page": "这是一个空白页面",
      "You're viewing a local or shared file": "你正在查看本地或共享的文件",
      "Your Antigravity use will be associated with provided project.": "你使用 Antigravity 的记录会关联到所提供的项目。",
      "Your Antigravity use will be associated with provided project. Make sure you trust the project ID before proceeding. Account activity and data may be logged by your organization.": "你使用 Antigravity 的记录会关联到所提供的项目。继续之前请确认你信任这个项目 ID。你的账号活动和数据可能会被组织记录。",
      "Your Plan:": "当前套餐：",
      "Your administrator has disabled MCP servers for this workspace.": "管理员已为这个工作区停用 MCP 服务器。",
      "Your agent’s ability to execute commands is also controlled by enterprise security policies.": "Agent 执行命令的能力也受企业安全策略控制。",
      "Your changes were not saved. Please try again.": "你的改动没有保存，请重试。",
      "Your connection is not private": "你的连接不是私密连接",
      "Your connection to this site is not fully secure": "你与这个网站的连接不完全安全",
      "Your connection to this site is not secure": "你与这个网站的连接不安全",
      "Your information (for example, passwords or credit card numbers) is private when it is sent to this site.": "你发送到这个网站的信息（比如密码或信用卡号）是保密的。",
      "Your session has expired. Please log back in to continue.": "你的会话已过期，请重新登录后继续。",
      "Zip attachment": "压缩包附件",
      "Zoom Level": "缩放级别",
      "Zoom in (+)": "放大（+）",
      "Zoom out (-)": "缩小（-）",
      "copy link": "复制链接",
      "cumulative total for the conversation up to this point": "到目前为止这个对话的累计总量",
      "image for artifact level comment": "产出物评论的图片",
      "image for comment": "评论的图片",
      "in a terminal": "在终端中",
      "learn more": "了解更多",
      "necessary rights": "必要的权利",
      "not installed": "未安装",
      "to ask for content changes for legal reasons.": "，提出因法律原因要求修改内容的请求。",
      "to exit": "退出",
      "tokens (": "token（",
      "tokens)": "token）",
      "troubleshooting guide": "故障排查指南",
      "unknown error": "未知错误",
      "view full search results": "查看完整搜索结果",
      "When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.": "开启后，模型配额用完时 Antigravity 会用你的 AI 额度来处理模型请求。Antigravity 总是先用模型配额，再用 AI 额度。",
      "When toggled on, Antigravity will use your AI credits to fulfill model requests once you’re out of model quota. Antigravity will always use your model quota first before using AI credits.": "开启后，模型配额用完时 Antigravity 会用你的 AI 额度来处理模型请求。Antigravity 总是先用模型配额，再用 AI 额度。",
      "Strong": "强",
      "Notice": "提示",
      "Plan": "套餐",
      "Hide breakdown": "收起明细",
      "Resets in <1m": "不到 1 分钟后重置",
      "Auth and Billing": "登录与账单",
      "Conversation": "对话",
      "Layout": "布局",
      "Appearance": "外观",
      "Terminal": "终端",
      "Editing": "编辑",
      "Voice": "语音",
      "Agent": "Agent",
      "Upgrade": "升级",
      "General Feedback": "一般反馈",
      "Copied to clipboard": "已复制到剪贴板",
      "Maximize Width": "最大宽度",
      "Minimize Width": "最小宽度",
      "Reveal in Finder": "在访达中显示",
      "Show in File Explorer": "在文件资源管理器中显示",
      "Show in File Manager": "在文件管理器中显示",
      "Searching older messages…": "正在搜索更早消息…",
      "Couldn't load older messages · Retry": "无法加载更早消息 · 重试",
      "Couldn't load older messages — retry": "无法加载更早消息，点此重试",
      "Agent settings and permissions for conversations outside of projects.": "项目以外的对话的 Agent 设置和权限。",
      "Managed by application menu": "由应用菜单管理",
      "Zoom In": "放大",
      "Zoom Out": "缩小",
      "Reset Zoom": "重置缩放",
      "Focus Input": "聚焦输入框",
      "Ultra": "Ultra",
      "Pro": "Pro"
    };
    const ZH_U = { s: "秒", sec: "秒", secs: "秒", second: "秒", seconds: "秒", m: "分钟", min: "分钟", mins: "分钟", minute: "分钟", minutes: "分钟", h: "小时", hr: "小时", hrs: "小时", hour: "小时", hours: "小时", d: "天", day: "天", days: "天", w: "周", wk: "周", wks: "周", week: "周", weeks: "周", mo: "个月", month: "个月", months: "个月", y: "年", yr: "年", yrs: "年", year: "年", years: "年" };
    // "6d 22h" / "3 hours" / "a minute" -> "6 天 22 小时" / "3 小时" / "1 分钟"；有对不上的单位就不翻
    function zhDur(s) {
      let bad = false, hit = false;
      const t = String(s).replace(/\b(?:an?)\s+(?=[a-z])/gi, "1 ").replace(/(\d+(?:\.\d+)?)\s*([a-z]+)(?![a-z])/gi, (m0, n, u) => { const z = ZH_U[u.toLowerCase()]; if (!z) { bad = true; return m0; } hit = true; return n + " " + z + " "; })
        .replace(/\s*,\s*|\s+and\s+/gi, " ").replace(/\s+/g, " ").trim();
      if (bad || !hit || /[a-z]/i.test(t)) return null;
      return t;
    }
    const DUR = String.raw`(?:(?:\d+(?:\.\d+)?|an?)\s*[a-z]+(?:,?\s+(?:and\s+)?)?)+`;
    const ZH_RE = [
      [/^(?:just now|now)$/i, () => "刚刚"],
      [new RegExp("^(" + DUR + ")\\s+ago$", "i"), (m) => { const d = zhDur(m[1]); return d ? d + "前" : null; }],
      [new RegExp("^resets?\\s+in\\s+(" + DUR + ")$", "i"), (m) => { const d = zhDur(m[1]); return d ? d + "后重置" : null; }],
      [new RegExp("^in\\s+(" + DUR + ")$", "i"), (m) => { const d = zhDur(m[1]); return d ? d + "后" : null; }],
      [/^Turn (\d+) of (\d+)$/, (m) => "第 " + m[1] + " 轮，共 " + m[2] + " 轮"],
      // v0.10.5 快捷键页
      [/^Shortcut (.+?) for (.+)$/, (m) => "快捷键 " + m[1] + "：" + zhIn(m[2])],
      [/^Remove shortcut (.+?) for (.+)$/, (m) => "删除「" + zhIn(m[2]) + "」的快捷键 " + m[1]],
      [/^Add shortcut for (.+)$/, (m) => "为「" + zhIn(m[1]) + "」添加快捷键"],
      [/^Toggle (.+)$/, (m) => { const z = zhIn(m[1]); return (z !== m[1] ? "切换" : "开关 ") + z; }],
      // 用量 / 配额
      [/^Show (\d+) breakdowns?$/, (m) => "显示 " + m[1] + " 项明细"],
      [/^(.+): ([\d,.]+[KMG]?) tokens?$/, (m) => zhIn(m[1]) + "：" + m[2] + " token"],
      [/^You have used some of your (weekly|five hour|5 hour|daily) limit, it will fully refresh in (.+?)\.?$/i, (m) => { const d = zhDur(m[2]); return d ? ({ weekly: "每周", daily: "每日" }[m[1].toLowerCase()] || "5 小时") + "限额已用掉一部分，" + d + "后完全恢复。" : null; }],
      [/^Individual quota reached\. Please upgrade your subscription to increase your limits\. Resets in (.+?)\.?$/, (m) => { const d = zhDur(m[1]); return "已达到个人配额。请升级订阅来提高限额。" + (d ? d + "后重置。" : ""); }],
      [/^(.*?)\s*Leaving on (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})\.?$/, (m) => { const mo = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").indexOf(m[2]) + 1; const pre = m[1] ? zhIn(m[1]) : ""; return (pre && pre !== m[1] ? pre : (m[1] ? m[1] + " " : "")) + mo + " 月 " + m[3] + " 日下线。"; }],
      [/^Send feedback as (.+)$/, (m) => "以 " + m[1] + " 的身份发送反馈"],
      [/^(\d+) files? changed$/, (m) => m[1] + " 个文件有改动"],
      [/^(.+), showing (\d+) of (\d+)$/, (m) => zhIn(m[1]).replace(/[。.…]+$/, "") + "（已显示 " + m[2] + " / " + m[3] + " 条）"],
      [/^Load older messages, showing (\d+) of (\d+)$/, (m) => "加载更早消息（已显示 " + m[1] + " / " + m[2] + " 条）"],
      [/^(\d+)\/(\d+) steps?\. Show plan$/, (m) => m[1] + "/" + m[2] + " 步 · 查看计划"],
      [/^(\d+)\/(\d+) steps?$/, (m) => m[1] + "/" + m[2] + " 步"],
      [/^Select model, current: (.+)$/, (m) => "选择模型，当前：" + zhIn(m[1])],
      [/^Select project, current: (.+)$/, (m) => "选择项目，当前：" + zhIn(m[1])],
      [/^Agent permissions preset selector, current: (.+)$/, (m) => "Agent 权限预设，当前：" + zhIn(m[1])],
      [/^Conversation: (.+)$/, (m) => "对话：" + m[1]],
      [/^Message from (.+)$/, (m) => "来自 " + m[1] + " 的消息"],
      [/^Your Plan: (.+)$/, (m) => "当前套餐：" + m[1]],
      [/^((?:Gemini|Claude|GPT|Qwen|Llama|DeepSeek)\b.*?) (Extra High|XHigh|High|Medium|Low)$/, (m) => m[1] + " " + ({ "Extra High": "超高", XHigh: "超高", High: "高", Medium: "中", Low: "低" })[m[2]]],
      [/^Worked for (.+)$/, (m) => "已工作 " + m[1]],
      [/^Working for (.+)$/, (m) => "已工作 " + m[1]],
      [/^Thought for (.+)$/, (m) => "已思考 " + m[1]],
      [/^Thinking for (.+)$/, (m) => "已思考 " + m[1]],
      [/^(\d+(?:\.\d+)?%)\s+(?:remaining|left)$/i, (m) => m[1] + " 剩余"],
      [/^(\d+(?:\.\d+)?%)\s+used$/i, (m) => "已用 " + m[1]],
      [/^(\d+) requests?$/i, (m) => m[1] + " 次请求"],
      [/^(\d+) (files?|changes?|items?|results?|messages?|conversations?|projects?|skills?|rules?|plugins?|tasks?)$/i, (m) => m[1] + " 个" + ({ file: "文件", change: "改动", item: "项目", result: "结果", message: "消息", conversation: "对话", project: "项目", skill: "技能", rule: "规则", plugin: "插件", task: "任务" })[m[2].toLowerCase().replace(/s$/, "")]],
      [/^(\d+(?:\.\d+)?\s*(?:s|m|h|d|w|mo|y))(?:\s+\d+(?:\.\d+)?\s*(?:s|m|h|d|w|mo|y))*$/, (m) => zhDur(m[0])]
    ];
    const ZH_EXCL = 'pre, code, kbd, samp, textarea, input, select[multiple], script, style, noscript, title, svg, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], .xterm, .monaco-editor, .cm-editor, .agy-user-bubble, [class*="markdown"], [class*="prose"], [data-agywe-noi18n], #antigravity-catgirl-dock';
    const ZH_ATTRS = ["placeholder", "aria-label", "title", "data-placeholder", "aria-placeholder", "data-tooltip"];
    const ZH_ATTR_SEL = ZH_ATTRS.map((a) => "[" + a + "]").join(",");
    const zh = { on: false, map: null, extraSig: null, txt: new WeakMap(), att: new WeakMap(), miss: new Map(), n: 0, obs: null, q: [], raf: 0 };   // q: [节点, 0 整棵 | 1 只看这段文字 | 2 只看属性]
    const zhWanted = () => !(cfg && cfg.zh === false);
    function zhBuild() {
      const extra = cfg && typeof cfg.zhExtra === "string" ? cfg.zhExtra : "";
      if (zh.map && zh.extraSig === extra) return;
      const m = new Map(Object.entries(ZH));
      for (const line of extra.split(/\r?\n/)) {
        const i = line.search(/\s*(?:=>|=|\t)\s*/);
        if (i <= 0) continue;
        const k = line.slice(0, i).trim(), v = line.slice(i).replace(/^\s*(?:=>|=|\t)\s*/, "").trim();
        if (k && v) m.set(k, v);
      }
      zh.map = m; zh.extraSig = extra;
    }
    const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
    // 句子里嵌着的一小段（比如「当前：No Project」）：词表里有就换，没有原样保留
    const zhIn = (x) => { const t = String(x).trim(); const z = zh.map && zh.map.get(t); if (z) return z; for (const [re, fn] of ZH_RE) { if (fn === undefined) continue; const m = re.exec(t); if (m && !/current:/.test(re.source)) { const r = fn(m); if (r) return r; } } return t; };
    // 不记进「没翻到」的：快捷键、token 数、路径、纯数字单位这种
    const ZH_NOMISS = /^(?:(?:Ctrl|Alt|Shift|Cmd|Meta|Win)\+|~[\\/])|\btok\b|tok\/s$|^[\d.,\s%KMG\/-]+$/;
    function zhT(s) {
      const t = s.trim();
      if (!t || t.length > 120 || CJK.test(t) || !/[a-z]/i.test(t)) return null;
      let z = zh.map.get(t);
      if (z === undefined) {
        z = null;
        for (const [re, fn] of ZH_RE) { const m = re.exec(t); if (m) { z = fn(m); if (z) break; } }
      }
      if (!z) {
        if (t.length <= 120 && zh.miss.size < 600 && !zh.miss.has(t) && !/^[\w.\-/\\:@#]+$/.test(t) && !ZH_NOMISS.test(t)) zh.miss.set(t, 1);
        return null;
      }
      if (z === t) return null;
      const lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
      return lead + z + trail;
    }
    function zhSkip(el) {
      if (!el) return true;
      try { return !!el.closest(ZH_EXCL) || isOurs(el); } catch { return true; }
    }
    function zhText(n, checked) {
      const v = n.nodeValue;
      if (!v || v.length > 160) return;
      const prev = zh.txt.get(n);
      if (prev && prev[1] === v) return;   // 是我们换上去的
      if (!checked && zhSkip(n.parentElement)) return;
      const z = zhT(v);
      if (z == null) return;
      zh.txt.set(n, [v, z]); zh.n++;
      n.nodeValue = z;
    }
    function zhAttrs(el, checked) {
      if (!el.hasAttribute) return;
      let skip = null;
      for (const a of ZH_ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const o = zh.att.get(el);
        if (o && o[a] && o[a][1] === v) continue;
        if (skip === null) { try { skip = !checked && (isOurs(el) || !!(el.closest && el.closest("[data-agywe-noi18n], #antigravity-catgirl-dock, .xterm, .monaco-editor, .cm-editor"))); } catch { skip = true; } }
        if (skip) return;
        const z = zhT(v);
        if (z == null) continue;
        const rec = o || {};
        rec[a] = [v, z]; zh.att.set(el, rec); zh.n++;
        el.setAttribute(a, z);
      }
    }
    const ZH_ATTR_EXCL = "[data-agywe-noi18n], #antigravity-catgirl-dock, .xterm, .monaco-editor, .cm-editor";
    // 遍历一棵子树：碰到不该翻的容器（代码块、编辑器、对话正文…）整棵跳过
    function zhWalk(root, budget) {
      if (!root) return budget;
      if (root.nodeType === 3) { zhText(root, false); return budget - 1; }
      if (root.nodeType !== 1 && root.nodeType !== 9) return budget;
      if (root.nodeType === 1) {
        if (zhSkip(root)) { if (!isOurs(root)) { try { if (!root.closest(ZH_ATTR_EXCL)) zhAttrs(root, true); } catch { } } return budget; }
        zhAttrs(root, true);
      }
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
          const id = n.id;
          if (id && typeof id === "string" && id.startsWith("agywe-")) return NodeFilter.FILTER_REJECT;
          try { if (n.matches(ZH_EXCL)) { if (!n.matches(ZH_ATTR_EXCL)) zhAttrs(n, true); return NodeFilter.FILTER_REJECT; } } catch { return NodeFilter.FILTER_REJECT; }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType === 3) zhText(n, true); else zhAttrs(n, true);
        if (--budget <= 0) { zh.q.push([root, 0]); return budget; }   // 太多了，下一帧从头再过一遍（已经换过的会直接跳过）
      }
      return budget;
    }
    function zhFlush() {
      zh.raf = 0;
      if (!zh.on) { zh.q.length = 0; return; }
      let budget = 8000;
      while (zh.q.length && budget > 0) {
        const [n, mode] = zh.q.shift();
        if (n.isConnected === false) continue;
        if (mode === 1) { zhText(n, false); budget--; }
        else if (mode === 2) { zhAttrs(n, false); budget--; }
        else budget = zhWalk(n, budget);
      }
      if (zh.q.length && !zh.raf) zh.raf = requestAnimationFrame(zhFlush);
    }
    function zhOnMut(recs) {
      if (!zh.on) return;
      for (const r of recs) {
        if (r.type === "characterData") { if (r.target.nodeValue && r.target.nodeValue.length <= 160) zh.q.push([r.target, 1]); }
        else if (r.type === "attributes") zh.q.push([r.target, 2]);
        else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) zh.q.push([n, n.nodeType === 3 ? 1 : 0]);
      }
      if (zh.q.length > 3000) zh.q = [[document.body || document.documentElement, 0]];
      // 在这一帧画出来之前就换掉，不会先闪一下英文
      zhFlush();
    }
    function zhRestore() {
      try {
        const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { const p = zh.txt.get(n); if (p && n.nodeValue === p[1]) n.nodeValue = p[0]; }
        for (const el of document.querySelectorAll(ZH_ATTR_SEL)) { const o = zh.att.get(el); if (!o) continue; for (const a of Object.keys(o)) if (el.getAttribute(a) === o[a][1]) el.setAttribute(a, o[a][0]); }
      } catch { }
      zh.txt = new WeakMap(); zh.att = new WeakMap();
    }
    function zhApply() {
      try {
        const want = zhWanted();
        if (want) {
          const sig = zh.extraSig;
          zhBuild();
          if (!zh.on || sig !== zh.extraSig) {
            zh.on = true;
            if (!zh.obs) {
              zh.obs = new MutationObserver(zhOnMut);
              zh.obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ZH_ATTRS });
            }
            zh.q.push([document.body || document.documentElement, 0]);
            zhFlush();
          }
        } else if (zh.on) {
          zh.on = false;
          if (zh.obs) { try { zh.obs.disconnect(); } catch { } zh.obs = null; }
          zhRestore();
        }
      } catch (e) { lastErr = "zh: " + String(e && e.message || e); }
    }
    function zhReport() { return { on: zh.on, replaced: zh.n, missN: zh.miss.size, miss: [...zh.miss.keys()].slice(-300) }; }

    function start() {
      ensureFrame();
      zhApply();
      try {
        new MutationObserver((recs) => {
          if (av.root && recs.every((r) => av.root.contains(r.target))) return;   // 自己的头像层变化不算
          if (!frame || !frame.isConnected) ensureFrame(); if (pet && !pet.root.isConnected) ensurePet();
          // v0.10.2：只有新加了元素 / class 变了才需要看毛玻璃；流式输出时大量的纯文字变化直接跳过
          let any = false;
          const glassOn = ready && cfg && cfg.enabled && cfg.glass && !hideAll;
          for (const r of recs) {
            if (r.type === "attributes") { if (r.attributeName !== "data-browser-hole") { any = true; if (glassOn) queueFresh(r.target); } else any = true; }
            else for (const n of r.addedNodes) if (n.nodeType === 1) { any = true; if (glassOn) queueFresh(n); }
          }
          if (any) scheduleScan();
          scheduleAvatars();
        })
          .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-browser-hole", "class", "aria-pressed", "aria-expanded", "aria-selected", "aria-checked", "data-state", "data-active", "data-selected"] });
      } catch { }
      holeTimer = setInterval(() => { if (document.querySelector(HOLE_SEL) || holeHosts.size) updateHoles(); }, 250);
      setInterval(() => sendContext(false), 600);
      let lastPath = location.pathname, reportT = 0;
      setInterval(() => {
        // v0.10.2：页面一有变化就会补扫，这里只是兜底（悬停颜色恢复之类），8 秒内扫过就跳过
        if (ready && cfg && cfg.enabled && cfg.glass && Date.now() - lastScan > 8000) scheduleScan();
        try { jumpRefresh(); renderCal(false); renderCd(); } catch { }
        tbSync();
        updateTheme(false);
        scheduleAvatars();
        // 换了页面（比如打开某个对话）后再记一次毛玻璃报告，方便排查
        if (location.pathname !== lastPath) { lastPath = location.pathname; clearTimeout(reportT); reportT = setTimeout(() => { try { diag("glass-report", { glass: glassReport(), glassPerf: perfSummary() }); } catch { } }, 4000); }
      }, 3000);
      // cfg 到来前也先把挂件放出来，保证总有入口
      setTimeout(() => { if (!pet && (!cfg || cfg.showButton !== false)) ensurePet(); }, 1500);
      setTimeout(() => diag("start+4s"), 4000);
      // v0.8 安全模式：跑满 20 秒算这次启动正常；跑满 3 分钟算稳定，清零失败计数
      setTimeout(() => { try { ipcRenderer.send("agywe:boot-ok"); } catch { } }, 20000);
      winStateSync();
      setInterval(() => { try { careTick(); } catch { } }, 20000);
      setTimeout(() => { try { ipcRenderer.send("agywe:stable"); } catch { } }, 180000);
      if (hideAll) { document.documentElement.classList.add("agywe-hideall"); setTimeout(() => toast("壁纸现在是隐藏的" + (hkLabel("hide") ? "，按 " + hkLabel("hide") + " 恢复" : ""), 3200), 2500); }
      setTimeout(() => diag("start+20s"), 20000);
    }
    try { splashBoot(); } catch (e) { try { splashKill("boot-error: " + (e && e.message || e)); } catch { } }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  } catch (e) {
    try { console.warn("[agywe] preload failed", e); } catch { }
  }
})();
