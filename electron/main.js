'use strict'

/**
 * Electron 主进程
 * ------------------------------------------------------------------
 * 职责：
 *   1. 创建 BrowserWindow 并加载渲染进程（Vite 开发服务器 / 生产构建）。
 *   2. 注册 IPC 处理：search（组合两路搜索）、open-path（打开文件）。
 *   3. 实现两路本地搜索：
 *        - Everything：spawn `es.exe` 命令行工具，解析标准输出。
 *        - OneNote ：spawn Windows 自带 PowerShell 调用 OneNote COM 的
 *                    FindPages 方法（electron/onenote-search.ps1），解析 XML。
 *
 * 说明：OneNote COM 通过免编译的 PowerShell 桥接访问（无需 winax / node-gyp /
 *      electron-rebuild）；搜索逻辑全部封装在主进程，通过 contextBridge +
 *      preload 向渲染进程暴露 `window.api`。
 */

const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { spawn } = require('child_process')
const { XMLParser } = require('fast-xml-parser')

const isDev = !!process.env.VITE_DEV_SERVER_URL

// ====================================================================
// 窗口创建
// ====================================================================
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ====================================================================
// 搜索路 1：Everything（es.exe 命令行）
// ====================================================================

/**
 * 定位 es.exe：环境变量 EVERYTHING_ES_PATH 优先，其次两个标准安装目录，
 * 最后回退 'es.exe' 交给 PATH 解析（与 Everything 安装目录自带的 es.exe 兼容）。
 * @returns {string} es.exe 可执行文件路径
 */
function resolveEsPath() {
  const candidates = [
    process.env.EVERYTHING_ES_PATH,
    'C:\\Program Files\\Everything\\es.exe',
    'C:\\Program Files (x86)\\Everything\\es.exe',
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return 'es.exe'
}

/**
 * 调用 Everything 自带的 es.exe 命令行工具进行文件/文件夹搜索。
 * @param {string} keyword 搜索关键词
 * @returns {Promise<{items: string[], error: (string|null)}>}
 */
function everythingSearch(keyword) {
  return new Promise((resolve) => {
    let child
    let timer

    const finish = (value) => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve(value)
    }

    try {
      child = spawn(resolveEsPath(), [keyword], { encoding: 'buffer', windowsHide: true })
    } catch (err) {
      return finish({
        items: [],
        error: `无法启动 es.exe：${err.message}。请安装 Everything 并确认 es.exe 位于 PATH 或安装目录。`,
      })
    }

    // 兜底超时，避免 Everything 服务异常时进程挂起。
    const timeoutMs = 10000
    timer = setTimeout(() => {
      try {
        if (child && !child.killed) {
          child.kill()
        }
      } catch (e) {
        /* noop */
      }
      finish({ items: [], error: 'Everything 搜索超时（10 秒），请确认 Everything 服务已启动。' })
    }, timeoutMs)

    let stdoutBuf = Buffer.alloc(0)
    let stderrBuf = Buffer.alloc(0)

    child.on('error', (err) => {
      finish({
        items: [],
        error: `未找到 Everything 命令行（es.exe）。请安装 Everything 并确认 es.exe 在 PATH 或安装目录。(${err.message})`,
      })
    })

    child.stdout.on('data', (chunk) => {
      stdoutBuf = Buffer.concat([stdoutBuf, chunk])
    })

    child.stderr.on('data', (chunk) => {
      stderrBuf = Buffer.concat([stderrBuf, chunk])
    })

    child.on('close', () => {
      // 实测取证：es.exe 重定向输出使用系统 ANSI 代码页（中文系统为 GBK/CP936），
      // 按 UTF-8 解码会导致中文路径乱码，必须按 GBK 解码。
      // 使用 Node/Electron 内置 TextDecoder('gbk')，零外部依赖（iconv-lite 曾在
      // Electron 启动时解析失败，内置方案无此风险）。
      const gbkDecoder = new TextDecoder('gbk')
      const stdout = gbkDecoder.decode(stdoutBuf)
      const stderr = gbkDecoder.decode(stderrBuf)
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      if (lines.length === 0) {
        // 无输出：可能是无匹配（正常）或工具报错。
        finish(
          stderr.trim()
            ? { items: [], error: `Everything 返回错误：${stderr.trim()}` }
            : { items: [], error: null }
        )
        return
      }
      finish({ items: lines, error: null })
    })
  })
}

// ====================================================================
// 搜索路 2：OneNote（PowerShell 桥接 COM FindPages，免编译）
// ====================================================================

// removeNSPrefix: 真实 OneNote XML 节点带命名空间前缀（<one:Notebooks>/<one:Page>），
// 必须去掉前缀，否则 parsed.Notebooks 恒为 undefined，搜索结果永远为 0 条。
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true })

/**
 * 解析 OneNote FindPages 返回的 XML，提取页面标题、ID 与所属层级路径。
 * XML 结构示例：
 *   <Notebooks>
 *     <Notebook name="笔记本" ID="...">
 *       <Section name="分区" ID="...">
 *         <Page name="页面标题" ID="..."> ... </Page>
 *       </Section>
 *     </Notebook>
 *   </Notebooks>
 * @param {string} xml
 * @returns {Array<{title: string, id: string, path: string}>}
 */
function parseOneNoteXml(xml) {
  const items = []
  if (!xml || typeof xml !== 'string' || !xml.trim()) {
    return items
  }

  let parsed
  try {
    parsed = xmlParser.parse(xml)
  } catch (e) {
    return items
  }

  const root = parsed && parsed.Notebooks
  if (!root || !root.Notebook) {
    return items
  }

  traverse(root.Notebook, 'Notebook', [], items)
  return items
}

/**
 * 递归遍历 OneNote XML 节点，收集所有 Page 节点及其祖先路径。
 * @param {*} node 当前节点（对象或数组）
 * @param {string} tag 当前节点的标签名（Notebook/Section/Page）
 * @param {string[]} pathStack 祖先名称路径
 * @param {Array} items 结果收集数组
 */
function traverse(node, tag, pathStack, items) {
  if (node == null) {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((n) => traverse(n, tag, pathStack, items))
    return
  }
  if (typeof node !== 'object') {
    return
  }

  const nodeName = typeof node.name === 'string' ? node.name : ''
  const newPath = nodeName ? [...pathStack, nodeName] : pathStack

  // 命中页面：标签为 Page 且拥有 ID 属性。
  if (tag === 'Page' && typeof node.ID === 'string') {
    items.push({
      title: node.name || '(未命名页面)',
      id: node.ID,
      path: pathStack.join(' / '),
    })
  }

  // 继续向更深层级的节点递归。OneNote 真实层级可能为
  // Notebook > SectionGroup > Section > Page，因此必须包含 SectionGroup，
  // 否则分区组（SectionGroup）下的页面会全部丢失。
  for (const key of ['Notebook', 'Section', 'SectionGroup', 'Page']) {
    if (node[key] !== undefined) {
      traverse(node[key], key, newPath, items)
    }
  }
}

/**
 * 定位 onenote-search.ps1 脚本路径，兼容开发与打包后的目录结构：
 *   1. 主进程脚本同目录（dist-electron/ 或 electron/）；
 *   2. 回退到源码 electron/ 目录（dist-electron/../electron/）。
 * @returns {string|null} 找到的脚本绝对路径；均不存在时返回 null。
 */
function resolvePs1Path() {
  const candidates = []
  // 打包后（electron-builder）：ps1 经 extraResources 放在 resources 根目录。
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'onenote-search.ps1'))
  }
  candidates.push(path.join(__dirname, 'onenote-search.ps1'))
  candidates.push(path.join(__dirname, '../electron/onenote-search.ps1'))
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    } catch (e) {
      /* existsSync 异常时继续尝试下一个候选路径 */
    }
  }
  return null
}

/**
 * PowerShell 错误输出前缀：onenote-search.ps1 捕获异常后以该前缀输出，
 * 主进程据此把原始异常信息转换为友好中文提示。
 */
const ONENOTE_ERROR_PREFIX = '__ONENOTE_ERROR__'

/**
 * 通过 Windows 自带 PowerShell 桥接调用 OneNote COM FindPages 搜索笔记页面。
 *
 * 桥接方式：spawn powershell.exe 执行 electron/onenote-search.ps1，
 * 关键词仅通过 -Keyword 命令行参数传入（不拼接进脚本文本，天然免注入/转义问题）；
 * 脚本 stdout 输出 FindPages 的层级 XML，异常时输出 `__ONENOTE_ERROR__` 前缀信息。
 * @param {string} keyword 搜索关键词
 * @returns {Promise<{items: Array, error: (string|null)}>}
 */
function onenoteSearch(keyword) {
  return new Promise((resolve) => {
    const ps1Path = resolvePs1Path()
    if (!ps1Path) {
      resolve({
        items: [],
        error: '未找到 onenote-search.ps1 脚本，无法调用 OneNote 搜索。请确认应用安装完整。',
      })
      return
    }

    let child
    let timer

    const finish = (value) => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve(value)
    }

    try {
      child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          ps1Path,
          '-Keyword',
          keyword,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 }
      )
    } catch (err) {
      return finish({
        items: [],
        error: `无法启动 PowerShell：${err.message}。请确认系统已自带 Windows PowerShell。`,
      })
    }

    // 兜底超时，避免 OneNote COM 无响应时进程挂起（spawn timeout 之外再保险一层）。
    const timeoutMs = 10000
    timer = setTimeout(() => {
      try {
        if (child && !child.killed) {
          child.kill()
        }
      } catch (e) {
        /* noop */
      }
      finish({ items: [], error: 'OneNote 搜索超时（10 秒），请确认 OneNote 桌面版可以正常打开。' })
    }, timeoutMs)

    let stdout = ''
    let stderr = ''

    child.on('error', (err) => {
      // spawn 失败（如 powershell.exe 不在 PATH）：给出友好提示，不崩溃。
      finish({
        items: [],
        error: `无法启动 PowerShell（powershell.exe）。请确认 Windows PowerShell 可用。(${err.message})`,
      })
    })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', () => {
      const output = stdout.trim()

      // 诊断日志：把 OneNote 桥接的原始返回打进 dev 终端，便于现场定位（临时）。
      console.log(
        `[onenote] keyword="${keyword}" stdout=${output.length}字节 ` +
        `stderr=${stderr.trim() ? JSON.stringify(stderr.trim().slice(0, 160)) : '(空)'} ` +
        `错误前缀=${output.startsWith(ONENOTE_ERROR_PREFIX) ? 'Y' : 'N'}`
      )

      // 脚本捕获到异常：以 __ONENOTE_ERROR__ 前缀输出，转为友好错误。
      if (output.startsWith(ONENOTE_ERROR_PREFIX)) {
        const detail = output.slice(ONENOTE_ERROR_PREFIX.length).trim()
        finish({
          items: [],
          error: `无法调用 OneNote COM，请确认已安装 OneNote 桌面版。(${detail})`,
        })
        return
      }

      if (!output) {
        // 无输出：可能是无匹配（正常）或 PowerShell 报错。
        finish(
          stderr.trim()
            ? { items: [], error: `OneNote 搜索返回错误：${stderr.trim()}` }
            : { items: [], error: 'OneNote 未返回搜索结果（可能无匹配或未启用搜索）。' }
        )
        return
      }

      // 正常路径：把 XML 交给现有解析器（复用 parseOneNoteXml / traverse，不做改动）。
      const items = parseOneNoteXml(output)
      finish({ items, error: null })
    })
  })
}

// ====================================================================
// IPC 处理
// ====================================================================

/**
 * 组合两路搜索，并行执行，统一返回结构：
 * {
 *   everything: { items: string[], error: string|null },
 *   onenote:    { items: Array,   error: string|null },
 *   errors:     string[]
 * }
 */
ipcMain.handle('search', async (_event, keyword) => {
  const [everything, onenote] = await Promise.all([
    everythingSearch(keyword),
    onenoteSearch(keyword),
  ])

  const errors = []
  if (everything.error) {
    errors.push(`Everything：${everything.error}`)
  }
  if (onenote.error) {
    errors.push(`OneNote：${onenote.error}`)
  }

  return { everything, onenote, errors }
})

/** 使用系统默认程序打开给定路径（文件或文件夹）。 */
ipcMain.handle('open-path', async (_event, filePath) => {
  try {
    await shell.openPath(filePath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
