# 个人集成搜索（Personal Search）

一个 Windows 桌面应用：在**一个统一搜索框**中输入关键词，**一次搜索同时**完成两件事并分栏展示：

1. **搜索本机文件** —— 调用 Everything 官方命令行工具 `es.exe`。
2. **搜索 OneNote 桌面版笔记** —— 通过 Windows 自带 PowerShell 调用 OneNote COM 接口的 `FindPages` 方法（免编译，无需 Visual Studio / node-gyp / electron-rebuild）。

> ⚠️ **仅支持 Windows**。Everything 与 OneNote 均为 Windows 专属。

---

## 功能特性

- 顶部统一搜索框，回车或点击「搜索」即可触发。
- 左右两栏并行展示结果：左栏为 `Everything` 本机文件，右栏为 `OneNote` 笔记。
- 文件结果点击即用系统默认程序打开（目录也会打开资源管理器）。
- OneNote 结果展示页面标题 + 所属「笔记本 / 分区」层级路径。
- 完善的容错与友好提示：Everything 未安装、`es.exe` 缺失、OneNote 未安装、COM 不可用、无匹配结果等状态均有明确提示，不会崩溃。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Electron（主进程 + 渲染进程） |
| 前端框架 | React 18 + Vite |
| UI 组件 | MUI（Material UI）+ Tailwind CSS |
| 本机文件搜索 | `es.exe`（Everything 命令行）via `child_process.spawn` |
| 本机笔记搜索 | Windows PowerShell 桥接 OneNote COM `FindPages`（`electron/onenote-search.ps1`） |
| 进程通信 | `contextBridge` + `preload.js` + `ipcMain`/`ipcRenderer` |

---

## 运行环境（前提条件）

1. **Windows 操作系统**（必需）。
2. **Node.js**（建议 18 LTS 及以上）。
3. **Everything**：安装 [Everything](https://www.voidtools.com/)，并确保 `es.exe`（"ES 命令行界面"）可用：
   - 可从 voidtools 下载 "ES 命令行界面" 并放置于 Everything 安装目录；
   - 或将 Everything 安装目录加入系统 `PATH`，以便 `spawn('es.exe', ...)` 能找到它。
   - Everything 服务需处于运行状态（任务栏有 Everything 图标）。
4. **OneNote 桌面版**：需安装 Microsoft OneNote 桌面版（Windows 版，随 Office 提供），以便 COM `OneNote.Application` 可用。OneNote 搜索通过 Windows 自带 PowerShell 调用 COM 实现，**无需 Visual Studio / node-gyp 编译 / electron-rebuild**，无任何原生模块依赖。

---

## 安装与运行

```bash
# 1. 安装依赖（纯 JavaScript 依赖，无原生模块编译步骤）
npm install

# 2. 开发模式（同时启动 Vite 开发服务器与 Electron）
npm run dev

# 3. 生产构建（产出 dist 与 dist-electron）
npm run build

# 4. 运行已构建的应用
npm start
```

> 说明：`npm run dev` 由 `vite-plugin-electron` 驱动，会自动编译主进程/预加载脚本并拉起 Electron 加载 Vite 开发服务器（默认 http://localhost:5173）。

---

## 架构说明

```
渲染进程 (React)                   主进程 (Electron)
─────────────────                 ─────────────────────────────
SearchBar                         electron/main.js
   │  window.api.search(kw)  ──▶   ipcMain.handle('search')
   │                                  ├─ Promise.all([
App.jsx                              │    everythingSearch(kw)  ──▶ spawn('es.exe', [kw])
   │  <EverythingResults/>           │    onenoteSearch(kw)    ──▶ powershell.exe + COM FindPages
   │  <OneNoteResults/>              │  ])
preload.js (contextBridge) ◀──       └─ 返回 { everything, onenote, errors }
```

- **preload.js** 通过 `contextBridge` 仅暴露 `window.api.search` 与 `window.api.openPath`，不开 `nodeIntegration`，保证渲染进程安全。
- 两路搜索逻辑各自封装（`everythingSearch` / `onenoteSearch`），便于将来切换实现（例如 Everything 也可改用 HTTP 服务），UI 层无需改动。

### 返回数据结构

```js
{
  everything: { items: string[],  error: string | null },  // 文件路径数组
  onenote:    { items: {title, id, path}[], error: string | null },
  errors:     string[]                                        // 汇总错误提示
}
```

---

## 已知限制 / 诚实说明

- 本开发环境（非 Windows）**无法真正运行** Everything 与 OneNote COM，因此**完整功能验证需在 Windows 上安装 Everything + OneNote 桌面版后进行**。
- OneNote 搜索通过 Windows 自带 PowerShell（`powershell.exe -File electron/onenote-search.ps1 -Keyword <关键词>`）调用 COM，关键词仅经命令行参数传入，无注入风险；脚本异常以 `__ONENOTE_ERROR__` 前缀输出并由主进程转为友好提示。
- 【Windows 实测提醒】首次 OneNote COM 调用可能触发 OneNote 桌面版启动（弹出窗口或后台进程），属正常现象；建议先手动打开一次 OneNote 再使用本应用搜索。
- `es.exe` 的搜索匹配规则遵循 Everything 语法；若 Everything 服务未运行，`es.exe` 会报错，应用会展示对应提示。

---

## 文件结构

```
personal-search/
├─ package.json            # 依赖与脚本（标注 "os": ["win32"]）
├─ index.html              # Vite 入口 HTML
├─ vite.config.js          # React 插件 + vite-plugin-electron
├─ tailwind.config.js      # Tailwind 配置
├─ postcss.config.js       # PostCSS 配置
├─ electron/
│  ├─ main.js              # 主进程：窗口 + IPC + 两路搜索实现
│  ├─ onenote-search.ps1   # PowerShell 桥接脚本：调用 OneNote COM FindPages
│  └─ preload.js           # contextBridge 暴露 window.api
├─ src/
│  ├─ main.jsx             # React 入口（ThemeProvider）
│  ├─ App.jsx              # 整体布局：搜索栏 + 两栏结果
│  ├─ theme.js             # MUI 主题
│  ├─ index.css            # Tailwind 指令
│  └─ components/
│     ├─ SearchBar.jsx         # 搜索输入框 + 按钮（回车触发）
│     ├─ EverythingResults.jsx # 文件路径列表（点击打开）
│     └─ OneNoteResults.jsx    # OneNote 页面标题 + 层级路径
└─ README.md
```
