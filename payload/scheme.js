"use strict";
// agywe 自定义协议的特权声明。install.cjs 把它插进 customScheme.js 的
// registerSchemesAsPrivileged([...]) 列表最前面（Electron 只允许调用一次该函数）。
exports.privileged = {
  scheme: "agywe",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: true,
    codeCache: true
  }
};
