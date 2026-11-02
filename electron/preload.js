'use strict'

/**
 * Electron 预加载脚本
 * ------------------------------------------------------------------
 * 通过 contextBridge 在渲染进程的安全上下文中暴露 `window.api`，
 * 仅暴露必要方法，避免直接暴露 Node / Electron 内部能力。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  /**
   * 组合搜索：同时检索 Everything 与 OneNote。
   * @param {string} keyword 关键词
   * @returns {Promise<{everything: {items: string[], error: string|null}, onenote: {items: Array, error: string|null}, errors: string[]}>}
   */
  search: (keyword) => ipcRenderer.invoke('search', keyword),

  /**
   * 使用系统默认程序打开文件/文件夹。
   * @param {string} filePath 完整路径
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
})
