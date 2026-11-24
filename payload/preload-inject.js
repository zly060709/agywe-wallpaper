
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
    const post = (msg) => { try { frame && frame.contentWindow && frame.contentWindow.postMessage(msg, ORIGIN); } catch { } };
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
          if (channel === "window:set-title-bar-overlay" && cfg && cfg.enabled && cfg.transparentTitleBar && args[0] && typeof args[0] === "object") {
            args[0] = { ...args[0], color: "#00000000" };
          }
        } catch { }
        return orig(channel, ...args);
      };
    } catch { }

    // ---- 样式 ----
    const CSS = `
html.agywe-on, html.agywe-on body { background: transparent !important; background-color: transparent !important; }
html.agywe-on [data-agywe-glass="clear"] { background-color: transparent !important; background-image: none !important; }
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
#agywe-dock .agywe-ci.past { opacity: .5; }`;

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
      return { chat: av.stats, band, kinds: [...marked].reduce((o, e) => { const k = baseKind.get(e) + ">" + (e.getAttribute("data-agywe-glass") || ""); o[k] = (o[k] || 0) + 1; return o; }, {}), chips: chips.length, chipList: chips.slice(0, 12).map(nodeInfo), darkText, items, fields, why, corner: cornerReport(), petLike: petCandidates(), holes: document.querySelectorAll(HOLE_SEL).length, force: (cfg && cfg.glassForce) || [], exclude: (cfg && cfg.glassExclude) || [] };
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
      return el === frame || el === settingsFrame || el.id === "agywe-wall" || el.id === "agywe-settings" || el.id === "agywe-fx" || el.id === "agywe-avatars" || el.id === "agywe-splash" || (typeof el.id === "string" && el.id.startsWith("agywe-")) || (dock.root && dock.root.contains(el)) || (menuEl && menuEl.contains(el)) || (pomo.overlay && pomo.overlay.el.contains(el)) ||
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
    const BLUR_VAL = "var(--agywe-bf, blur(var(--agywe-blur, 18px)) saturate(1.25))";   // 低配模式把 --agywe-bf 设成 none
    function paint(el, kind) {
      if (!origBorder.has(el)) {
        try { const cs = getComputedStyle(el); origBorder.set(el, parseFloat(cs.borderTopWidth) > 0 ? toRgba(cs.borderTopColor) : null); } catch { origBorder.set(el, null); }
      }
      saveInline(el);
      const s = el.style;
      const set = (p, v) => { if (s.getPropertyValue(p) !== v || s.getPropertyPriority(p) !== "important") s.setProperty(p, v, "important"); };
      const unset = (p) => { const o = (savedInline.get(el) || {})[p]; if (o) s.setProperty(p, o[0], o[1]); else s.removeProperty(p); };
      if (kind === "clear") {
        set("background-color", "transparent");
        set("background-image", "none");
        unset("-webkit-backdrop-filter"); unset("backdrop-filter");
        return;
      }
      const a = kind === "inner" ? "calc(var(--agywe-alpha, .55) * .6)"
        : kind === "field" ? "min(1, calc(var(--agywe-alpha, .55) * 1.2))"
        : kind === "chip" ? "max(var(--agywe-alpha, .55), var(--agywe-chip, .45))"
        : kind === "content" ? "var(--agywe-content, .3)"
        : "var(--agywe-alpha, .55)";
      // 气泡 / 卡片原本的实色描边在透明之后会很扎眼，改成同色半透明
      const ob = origBorder.get(el);
      if (kind === "chip" && ob && ob.a > 0.3) set("border-color", `rgba(${ob.r},${ob.g},${ob.b},.28)`);
      else unset("border-color");
      set("background-color", `rgba(var(--agywe-c, 20,20,20), ${a})`);
      set("background-image", "none");
      if (kind === "inner") { unset("-webkit-backdrop-filter"); unset("backdrop-filter"); }
      else { set("-webkit-backdrop-filter", BLUR_VAL); set("backdrop-filter", BLUR_VAL); }
    }
    function clearGlass() { for (const el of [...marked]) unmark(el); }

    function scanGlass() {
      if (!ready || !cfg || !cfg.enabled || !cfg.glass || hideAll) return;
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
      {
        for (const [x, y] of pts) {
          let stack;
          try { stack = document.elementsFromPoint(x, y); } catch { continue; }
          for (const el of stack) {
            if (el === document.documentElement || el === document.body) break;
            if (isOurs(el) || marked.has(el)) continue;
            const cs = getComputedStyle(el);
            const bg0 = bgOf(cs);
            if (bg0 && bg0.fade && !isForced(el)) { mark(el, "clear", bg0.c); continue; }
            const c = opaqueBg(cs, 0.35);
            if (!c) continue;
            const r = el.getBoundingClientRect();
            const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
            const bar = r.width >= W * 0.5 && r.height >= 18 && (r.top <= 2 || r.bottom >= H - 2);
            if (area < VA * 0.04 && !bar) continue;
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
      // 4) 气泡 / 卡片 / 小按钮：网格点和输入框都碰不到的中小块，隔一会儿全页扫一遍
      if (Date.now() - lastFull > 1500) { lastFull = Date.now(); try { revalidate(); } catch { } try { scanChips(W, H, VA); } catch { } }
      normalizeGlass();
      for (const el of marked) if (!el.isConnected) { marked.delete(el); baseKind.delete(el); holeHosts.delete(el); }
    }
    let lastFull = 0;
    // 整个窗口那么大的是底板（全透明）；占大半个窗口的是对话 / 工作区（给一层阅读背板）；其余是面板
    function bigKind(area, VA) { return area > VA * 0.92 ? "clear" : area > VA * 0.55 ? "content" : "panel"; }
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
        if (!b || b.c.a < 0.3) { unmark(el); orig.delete(el); origBorder.delete(el); }
        else if (!b.fade) { const v = `${b.c.r},${b.c.g},${b.c.b}`; if (v !== orig.get(el)) { orig.set(el, v); el.style.setProperty("--agywe-c", v); } }
      });
    }
    function scanChips(W, H, VA) {
      const all = document.body ? document.body.getElementsByTagName("*") : [];
      const n = Math.min(all.length, 8000);
      for (let i = 0; i < n; i++) {
        const el = all[i];
        if (marked.has(el) || isOurs(el)) continue;
        const tag = el.tagName;
        if (tag === "svg" || tag === "path" || tag === "IMG" || tag === "CANVAS" || tag === "VIDEO" || tag === "IFRAME" || tag === "INPUT" || tag === "SELECT" || tag === "OPTION") continue;
        const cs = getComputedStyle(el);
        const bgc = cs.backgroundColor;
        if ((!bgc || bgc === "rgba(0, 0, 0, 0)" || bgc === "transparent") && (!cs.backgroundImage || cs.backgroundImage === "none")) continue;
        const bg0 = bgOf(cs);
        if (bg0 && bg0.fade) { if (!isForced(el)) mark(el, "clear", bg0.c); continue; }
        const c = opaqueBg(cs, 0.5);
        if (!c) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
        const area = r.width * r.height;
        if (area < VA * 0.0012) continue;
        if (cs.position === "fixed" && el.getAttribute("role") === "dialog") continue;
        if (el.matches && el.matches(HOLE_SEL)) continue;
        if (el.querySelector && el.querySelector(HOLE_SEL)) continue;
        if (isExcluded(el)) continue;
        if (isHot(el)) continue;
        if (area >= VA * 0.04) { mark(el, bigKind(area, VA), c); continue; }
        // 需要有文字或者是圆角块，避免把分隔线、进度条之类的也处理掉
        const rounded = parseFloat(cs.borderTopLeftRadius) >= 6;
        if (!rounded && !(el.textContent || "").trim()) continue;
        mark(el, "chip", c);
      }
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
          else if ((k === "panel" || k === "field" || k === "content") && host) {
            for (let p = host; p && p !== document.documentElement; p = p.parentElement) {
              const bk = marked.has(p) ? baseKind.get(p) : null;
              if (bk === "panel" || bk === "field" || bk === "content") { k = k === "content" ? "panel" : "inner"; break; }
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
      root.style.setProperty("--agywe-halo-a", String(cfg && cfg.textHalo != null ? cfg.textHalo : .6));
      updateTheme(true);
      applyFxCfg();
      applyAudioCfg();
      try { applyTheme(); applyDock(); applyIdle(); } catch (e) { lastErr = String(e && e.message || e); }
      try { noiseApplyCfg(); jumpRefresh(); if (!ccOn()) ccHide(); } catch (e) { lastErr = String(e && e.message || e); }
      scheduleAvatars();
      root.style.setProperty("--agywe-blur", (cfg ? cfg.blur : 18) + "px");
      const sig = JSON.stringify([cfg && cfg.glassForce, cfg && cfg.glassExclude]);
      if (sig !== lastGlassSig) { lastGlassSig = sig; clearGlass(); }
      if (!on || !cfg.glass) clearGlass(); else scheduleScan();
      ensureFrame();
    }

    let scanQueued = false;
    let lastScan = 0;
    function scheduleScan() {
      if (scanQueued) return;
      scanQueued = true;
      const wait = Math.max(400, 1200 - (Date.now() - lastScan));
      setTimeout(() => { scanQueued = false; lastScan = Date.now(); try { scanGlass(); updateHoles(); } catch { } }, wait);
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
    window.addEventListener("scroll", () => { if (av.root || avOn()) scheduleAvatars(); }, { capture: true, passive: true });

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
      post({ type: "agywe:mood", mood: "" });
      scheduleAvatars();
    }
    function renderMood() {
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
    }

    // ---- 自检：设置页来问，这里回答页面这边的情况 ----
    function selfReport() {
      return {
        ready, lastErr, frame: !!(frame && frame.isConnected), marked: marked.size, hideAll, winFocused, onBattery, agents,
        pet: !!(pet && pet.root.isConnected), petTop: !!(pet && (() => { try { return pet.root.matches(":popover-open"); } catch { return false; } })()),
        running: !!run.t0, audio: audio.state, sfx: sfx.ctx ? sfx.ctx.state : "none", avatars: av.stats || null,
        contrast: { on: contrast.on, need: contrast.need, ratio: contrast.ratio }, darkText, dock: !!(dock.root && dock.root.isConnected),
        lowSpec: !!(cfg && cfg.lowSpec), path: location.pathname
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
      try { if (pet && pet.doll) { const r = pet.doll.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; } } catch { }
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
    window.addEventListener("message", (e) => {
      if (e.origin !== ORIGIN) return;
      const d = e.data || {};
      if (d.type === "agywe:ready") {
        ready = true; audio.boot = !!d.wantAudio; applyCfg(d.config);
        post({ type: "agywe:agents", count: agents }); post({ type: "agywe:focus", focused: document.hasFocus() });
        post({ type: "agywe:theme", darkText: darkText == null ? null : darkText }); post({ type: "agywe:audio-state", state: audio.state });
        sendContext(true);
        post({ type: "agywe:hideall", on: hideAll }); powerSync(); post({ type: "agywe:winfocus", focused: winFocused });
        diag("wall-ready");
        setTimeout(() => { try { scanGlass(); updateHoles(); diag("glass-report", { glass: glassReport() }); } catch { } }, 5000);
      }
      else if (d.type === "agywe:config") { audio.boot = false; if (ready) applyCfg(d.config); else if (d.config) { cfg = d.config; ensureFrame(); } }
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
      else if (d.type === "agywe:palette") { palette = d.palette && typeof d.palette === "object" ? d.palette : null; applyTheme(); try { if (palette) ipcRenderer.send("agywe:palette", palette); } catch { } }
      else if (d.type === "agywe:switched" || d.type === "agywe:faved" || d.type === "agywe:paused") onWallAct(d);
      else if (d.type === "agywe:close-quick") toggleQuick(false);
      else if (d.type === "agywe:open-quick") { toggleSettings(false); setTimeout(() => toggleQuick(true), 120); }
      else if (d.type === "agywe:pomo") { const op = String(d.op || ""); if (op === "start") toggleSettings(false); pomoOp(op, true); }
      else if (d.type === "agywe:sfx-test") sfxPlay(String(d.name || "done"), { test: true, kind: String(d.kind || "") });
      else if (d.type === "agywe:idle-test") { toggleSettings(false); const a = String(d.act || ""); setTimeout(() => idleTest(a), 350); }
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
    window.addEventListener("resize", () => { try { jumpSched(); if (cc.el) ccUpdate(); } catch { } scheduleScan(); updateHoles(); placePet(); fxResize(); scheduleAvatars(); try { placeDock(); } catch { } }, { passive: true });

    function start() {
      ensureFrame();
      try {
        new MutationObserver((recs) => {
          if (av.root && recs.every((r) => av.root.contains(r.target))) return;   // 自己的头像层变化不算
          if (!frame || !frame.isConnected) ensureFrame(); if (pet && !pet.root.isConnected) ensurePet(); scheduleScan(); scheduleAvatars();
        })
          .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-browser-hole", "class"] });
      } catch { }
      holeTimer = setInterval(() => { if (document.querySelector(HOLE_SEL) || holeHosts.size) updateHoles(); }, 250);
      setInterval(() => sendContext(false), 600);
      let lastPath = location.pathname, reportT = 0;
      setInterval(() => {
        if (ready && cfg && cfg.enabled && cfg.glass) { scanGlass(); }
        try { jumpRefresh(); renderCal(false); renderCd(); } catch { }
        updateTheme(false);
        scheduleAvatars();
        // 换了页面（比如打开某个对话）后再记一次毛玻璃报告，方便排查
        if (location.pathname !== lastPath) { lastPath = location.pathname; clearTimeout(reportT); reportT = setTimeout(() => { try { diag("glass-report", { glass: glassReport() }); } catch { } }, 4000); }
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
