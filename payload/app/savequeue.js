"use strict";
/*
 * v0.11.1 设置保存队列
 *   以前：每次保存都直接发请求，「立即保存」和 200ms 防抖可以同时在路上，晚回来的旧响应会盖掉新的；
 *         请求失败时把错误内容当成配置，界面和磁盘上的配置悄悄分了叉。
 *   现在：
 *     · 同一时间只有一个保存请求在路上，按顺序发；
 *     · 没发出去的修改合并成一次（嵌套对象合并一层，和主进程 mergeConfig 一致）；
 *     · 只有队列空了才用服务器返回的配置更新界面，过期的响应不会盖掉新改的值；
 *     · 失败不吞：回调 onError(err, patch, idle)，由页面决定提示和重新读取。
 * 浏览器里挂在 window.agyweSaveQueue；Node 里（冒烟测试）是 module.exports。
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.agyweSaveQueue = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  function mergePatch(into, patch) {
    const out = { ...(into || {}) };
    for (const [k, v] of Object.entries(patch || {})) {
      out[k] = isPlain(out[k]) && isPlain(v) ? { ...out[k], ...v } : v;
    }
    return out;
  }

  function createSaveQueue(opts) {
    const send = opts.send;                                  // (patch) => Promise<config>；失败要 throw
    const onSaved = opts.onSaved || function () { };         // (config)：只在队列清空时调用
    const onError = opts.onError || function () { };         // (err, patch, idle)
    const delay = opts.delay == null ? 200 : opts.delay;
    const setT = opts.setTimeout || setTimeout;
    const clearT = opts.clearTimeout || clearTimeout;

    let pending = null;       // 还没发出去的修改
    let timer = null;
    let inflight = 0;         // 已经排上队、还没回来的请求
    let chain = Promise.resolve();
    const stats = { sent: 0, ok: 0, failed: 0, maxInflight: 0, dropped: 0 };

    const idle = () => !pending && inflight === 0;

    function runOnce() {
      if (timer) { clearT(timer); timer = null; }
      if (!pending || Object.keys(pending).length === 0) { pending = null; return chain.then(() => true); }
      const patch = pending; pending = null;
      inflight++;
      const job = chain.then(async () => {
        stats.sent++;
        let cfg;
        try { cfg = await send(patch); }
        catch (err) {
          inflight--; stats.failed++;
          try { onError(err, patch, idle()); } catch { }
          return false;
        }
        inflight--; stats.ok++;
        if (idle()) { try { onSaved(cfg); } catch { } }
        else stats.dropped++;                                 // 后面还有新的修改，先不拿这个响应覆盖界面
        return true;
      });
      chain = job.then(() => { }, () => { });
      stats.maxInflight = Math.max(stats.maxInflight, inflight);
      return job;
    }

    function save(patch, now) {
      pending = mergePatch(pending, patch);
      if (timer) { clearT(timer); timer = null; }
      if (now) return runOnce();
      timer = setT(runOnce, delay);
      return undefined;
    }

    /** 把还在防抖里的修改马上发出去，等队列里所有请求都回来 */
    function flush() { return runOnce().then(() => chain).then(() => true); }

    return { save, flush, idle, stats };
  }

  return { createSaveQueue, mergePatch };
});
