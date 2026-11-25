"use strict";
/*
 * v0.11.2 插件页面（壁纸页 / 设置页 / 快速切换）和宿主页面（Antigravity 界面）之间的消息通道
 *   以前每个页面自己算宿主地址：location.ancestorOrigins 拿不到时退成 "*"，
 *   于是发出去的消息谁都能收，收到的消息也不看是谁发的。
 *   现在：
 *     · 宿主地址按 ancestorOrigins → document.referrer 的顺序找，都找不到就停用消息通道（不再退成 "*"）；
 *     · 只把消息发给自己的父页面，并且指定它的地址；
 *     · 收消息时 来源窗口必须是父页面、来源地址必须是宿主地址，两样都对才算。
 * 浏览器里是 window.agyweParent；Node 里（冒烟测试）module.exports 是 (win) => 通道，可以传假窗口进去测。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory;
  else root.agyweParent = factory(root);
})(typeof self !== "undefined" ? self : this, function (win) {
  let origin = "";
  try {
    const ao = win.location && win.location.ancestorOrigins;
    if (ao && ao.length) origin = String(ao[0]);
  } catch { }
  if (!origin) {
    try { if (win.document && win.document.referrer) origin = new URL(win.document.referrer).origin; } catch { }
  }
  if (origin === "null") origin = "";   // 沙箱或 file: 之类没有确定地址的，不当宿主
  let parentWin = null;
  try { parentWin = win.parent && win.parent !== win ? win.parent : null; } catch { }
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    try { console.warn("[agywe] 找不到宿主页面的地址，和宿主之间的消息先停用"); } catch { }
  };
  return {
    origin,
    ok: !!(origin && parentWin),
    /** 发给宿主；发不出去返回 false（不抛错） */
    post(msg) {
      if (!origin || !parentWin) { warn(); return false; }
      try { parentWin.postMessage(msg, origin); return true; } catch { return false; }
    },
    /** 这条消息是不是宿主发来的 */
    isFromParent(e) {
      return !!(e && parentWin && origin && e.source === parentWin && e.origin === origin);
    }
  };
});
