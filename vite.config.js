import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

// Vite 配置：React 插件 + Electron（主进程 / 预加载）构建。
// 开发模式：vite-plugin-electron 会编译 main/preload 并启动 Electron，
//          渲染进程通过 http://localhost:5173 加载。
// 生产模式：vite build 会同时产出 dist（渲染）与 dist-electron（主进程/预加载）。
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.js',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        entry: 'electron/preload.js',
        onstart(options) {
          // 预加载脚本重建后通知渲染进程刷新。
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
