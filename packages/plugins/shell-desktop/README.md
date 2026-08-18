# @xyq-box/plugin-shell-desktop

Electron 桌面壳插件（M2）：主进程 bootstrap + BrowserWindow，提供 `system` / `window` / `tray` 服务，`connection` 走 Electron IPC，复用 shell-web 的 UI。

## 职责（docs/02 §1、docs/06 M2）

1. **Electron 主进程**（`src/main.ts`）：只做两件事——`kernel.bootstrap()`（读取本包 `plugins.json` 桌面清单）+ 创建 BrowserWindow 加载 shell-web 渲染层；
2. **system 服务**（`src/services/system.ts`）：Electron 能力代理——`shell.openExternal` / Electron Notification / `nativeTheme` / `screen` / 窗口焦点与网络事件；`platform: 'desktop'`，与 shell-web 的 system 服务同名替换，消费者零感知；
3. **window 服务**（`src/services/window.ts`）：BrowserWindow 管理——创建/状态快照/尺寸/标题/全屏/事件订阅；
4. **tray 服务**（`src/services/tray.ts`）：系统托盘——创建/右键菜单/提示/销毁，服务卸载自动清理；
5. **connection 走 Electron IPC**（`src/index.ts` + `src/preload.ts` + `src/ipc.ts`）：
   - preload 经 contextBridge 注入 `window.xyqBridge`（`rpc.call` + `onPush`）；
   - 主进程 `ipcMain.handle('xyqBox:rpc:call')` → 内核 `ctx.connection.rpc.call`；
   - 主进程 push 经 `onPushRelay` 转发到所有渲染进程；
   - shell-web 渲染入口检测到 `window.xyqBridge` 后自动切换为 IPC 传输（`IpcConnectionService`）——同一份 UI 打包产物，两种部署形态，插件代码零感知（docs/02 §3.1）；
6. **复用 shell-web 的 UI**：本插件不含渲染层，BrowserWindow 加载 shell-web 的 Vite 产物/开发服务器。

## 结构

```
shell-desktop/
├── plugins.json          # 桌面清单（主进程内核装载；仅 node half 插件）
├── src/
│   ├── main.ts           # Electron 主进程入口（bootstrap + BrowserWindow）
│   ├── preload.ts        # contextBridge 注入 window.xyqBridge
│   ├── ipc.ts            # IPC 通道常量（两端共享）
│   ├── electron-types.ts # ElectronModule 类型 + 惰性加载守卫
│   ├── index.ts          # 插件入口（provide system/window/tray + IPC 桥 + RPC 端点）
│   └── services/
│       ├── system.ts     # DesktopSystemService
│       ├── window.ts     # WindowService
│       └── tray.ts       # TrayService
├── scripts/
│   └── build-preload.mjs # tsc 后把 preload 生成为 .mjs（Electron ESM preload 要求）
└── tests/                # 服务单测 + bootstrap 冒烟
```

## 开发

```bash
# 依赖安装（仓库根执行一次）
pnpm install

# 构建库包（tsc 产出 lib/，含 preload.mjs）
pnpm --filter @xyq-box/plugin-shell-desktop build

# 类型检查 / 单测
pnpm --filter @xyq-box/plugin-shell-desktop typecheck
pnpm test

# 启动桌面壳（需要先起 shell-web 的 Vite dev server，默认 http://localhost:5173）
pnpm --filter @xyq-box/plugin-shell-web dev   # 终端 1
pnpm --filter @xyq-box/plugin-shell-desktop start   # 终端 2
```

渲染目标解析顺序：`XYQ_RENDERER_URL` env → 开发模式加载 `http://localhost:5173`（shell-web dev server）→ 生产加载 `../shell-web/dist/index.html`。

## RPC 端点（'/'shell-desktop'）

| 端点 | payload | 说明 |
| --- | --- | --- |
| `system.info` | `null` | 平台/版本/在线/标题/可见性 |
| `system.setTitle` | `{ title }` | 设置聚焦窗口标题 |
| `system.openUrl` | `{ url }` | `shell.openExternal` |
| `window.list` | `null` | 全部窗口状态快照 |
| `window.create` | 部分 `WindowOptions` | 创建窗口返回 id |
| `window.setTitle` | `{ title, id? }` | 设置窗口标题 |
| `tray.list` | `null` | 托盘 id 列表 |
| `tray.create` | `{ id?, tooltip?, title?, contextMenu? }` | 创建托盘返回 id |
| `tray.destroy` | `{ id }` | 销毁托盘 |

> RPC payload 约定：无参数必须传 `null`（docs/04 §8）。

## 已知边界

- `loadElectron()` 仅 Electron 主进程（`process.type === 'browser'`）加载真实模块；单测/CLI 环境降级（服务可用、操作抛可读错误）；
- Electron ≥28 ESM preload 要求 `.mjs` 扩展名（`scripts/build-preload.mjs` 在构建时生成 `lib/preload.mjs`）；
- 托盘图标缺省为内置 16×16 占位 PNG，生产可用 `TrayOptions.icon` 替换；
- IPC 桥仅在 Electron 主进程安装；渲染进程的 `IpcConnectionService` 本地端点优先，未命中经 IPC 转发主进程。
