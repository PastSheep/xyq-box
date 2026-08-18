/**
 * @xyq-box/plugin-shell-desktop —— Electron IPC 通道常量
 *
 * 主进程（ipcMain / ipcMain.handle）与渲染进程（preload / ipcRenderer）共享的通道名。
 * 常量包确保两端通道名一致，不出现 typo 错位。
 */

/** ipcMain.handle 通道名：渲染进程 RPC 调用 */
export const IPC_CHANNEL_RPC_CALL = 'xyqBox:rpc:call'

/** ipcMain.send / ipcRenderer.on 通道名：主进程推送事件到渲染进程 */
export const IPC_CHANNEL_PUSH = 'xyqBox:push'
