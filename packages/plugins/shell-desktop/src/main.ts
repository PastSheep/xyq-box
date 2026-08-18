/**
 * @xyq-box/plugin-shell-desktop —— Electron 主进程入口（部署胶水）
 *
 * docs/06 M2 与 docs/02 §1「宿主极简」：主进程只做两件事——
 * 1. kernel.bootstrap()（读取本包 plugins.json 桌面清单，装载全部服务插件）；
 * 2. 创建 BrowserWindow 加载 shell-web 渲染层（复用其 UI）。
 *
 * 不含任何业务与壳逻辑：system/window/tray 服务与 connection IPC 桥
 * 全部由 @xyq-box/plugin-shell-desktop 插件本体提供（清单装载）。
 *
 * 渲染目标解析：
 * - 优先 env XYQ_RENDERER_URL；
 * - 开发（未打包）：shell-web 的 Vite 开发服务器（默认 http://localhost:5173）；
 * - 生产：复用 shell-web 的构建产物 ../shell-web/dist/index.html（存在时）。
 */

import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { bootstrap, type KernelHandle } from '@xyq-box/core'

/** 包根（src/ 与 lib/ 均为包根子目录，此处恒指向包根） */
const packageRoot = fileURLToPath(new URL('../', import.meta.url))

let kernel: KernelHandle | null = null
let mainWindow: BrowserWindowType | null = null

/** 解析渲染层加载目标（dev = shell-web 开发服务器；prod = 复用其 dist） */
function resolveRendererTarget(): { url: string } | { file: string } {
  const envUrl = process.env.XYQ_RENDERER_URL
  if (envUrl) return { url: envUrl }

  if (!app.isPackaged) {
    return { url: process.env.XYQ_RENDERER_DEV_URL ?? 'http://localhost:5173' }
  }

  // 生产：复用 shell-web 的 Vite 构建产物（仓库内 ../shell-web/dist）
  const file = resolve(packageRoot, '../shell-web/dist/index.html')
  if (existsSync(file)) return { file }
  return { url: process.env.XYQ_RENDERER_DEV_URL ?? 'http://localhost:5173' }
}

/** 创建主窗口并加载 shell-web 渲染层 */
async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }

  const target = resolveRendererTarget()
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'xyq-box',
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(packageRoot, 'lib/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })

  if ('url' in target) {
    console.info('[shell-desktop] loading renderer URL: %s', target.url)
    await win.loadURL(target.url)
  } else {
    console.info('[shell-desktop] loading renderer file: %s', target.file)
    await win.loadFile(target.file)
  }
}

async function boot(): Promise<void> {
  await app.whenReady()
  if (!kernel) {
    kernel = await bootstrap({ basePath: packageRoot, profile: 'desktop' })
    console.info(
      '[shell-desktop] kernel v' + kernel.version + ' booted, ' +
        kernel.plugins.getStatus().length + ' plugin(s)',
    )
  }
  await createMainWindow()

  // macOS：点击 Dock 图标重新打开窗口
  app.on('activate', () => {
    void createMainWindow()
  })
}

// 所有窗口关闭 → 退出（macOS 惯例除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

boot().catch((error: unknown) => {
  console.error('[shell-desktop] bootstrap failed', error)
  app.quit()
})
