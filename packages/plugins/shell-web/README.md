# @xyq-box/plugin-shell-web

Web 壳插件（M1）：Vite 部署入口 + 内核 bootstrap + 默认清单 + root slot 渲染。

## 职责（docs/02 §1、docs/06 M1）

1. **Vite 部署入口**（`index.html` + `src/web/main.ts`）：只调用 `kernel.bootstrap()` 启动内核，加载默认插件清单（`plugins.json`，经 Vite 虚拟模块打包进产物）；
2. **加载默认插件清单**：`plugins.json` 声明默认装载的插件集（内核按依赖决定加载顺序，与书写顺序无关）；
3. **占据 root slot 渲染 React UI 根**：作为插件被清单装载后，向 views 服务注册 `root` 视图描述符，并把 React UI 根（`ShellApp`）渲染进 `#root`；
4. **提供 system 服务**：把 `window` / `document` / `navigator` / `notification` 等浏览器能力以 `ctx.system` 服务暴露（M2 桌面壳以同名服务替换，消费者零感知）；
5. **与 plugin-views 配合汇聚视图**：订阅 `ctx.views.onChange`，把各扩展点（sidebar/toolbar/statusbar/panel）下所有已注册视图聚合渲染。views 为**可选能力**（`ctx.get` 探测），未装载时降级为仅渲染壳自身。

## 结构

```
shell-web/
├── index.html            # Vite 入口 HTML（#root 挂载点）
├── vite.config.ts        # Vite 配置 + xyqPlugins 虚拟模块（清单 → import 注册表）
├── plugins.json          # 默认插件清单（浏览器内核据此装载）
├── src/
│   ├── index.ts          # 插件入口（name/provide/apply）
│   ├── system.ts         # system 服务（浏览器能力代理）
│   ├── types.ts          # 与 plugin-views 协作的结构类型
│   ├── ui/
│   │   ├── ShellApp.tsx  # React UI 根（chrome + 视图聚合）
│   │   ├── ViewSlot.tsx  # 扩展点聚合渲染器
│   │   └── shell.css     # 壳样式（CSS 变量协议，经 Vite 入口打包）
│   └── web/
│       ├── main.ts       # Vite 部署入口（kernel.bootstrap + 内核 HMR）
│       └── env.d.ts      # 虚拟模块与 vite/client 类型声明
└── tests/                # 冒烟测试（bootstrap + DOM 桩）
```

## 开发

```bash
# 依赖安装（仓库根执行一次）
pnpm install

# 先构建库包（core/sdk/各插件的 lib/ 由 tsc 产出）
pnpm -r build

# 启动 Web 壳（Vite dev，默认 http://localhost:5173）
pnpm --filter @xyq-box/plugin-shell-web dev
# 或仓库根
pnpm dev
```

- 浏览器内核经 `bootstrap({ manifest, loader })` 引导：清单与插件模块由 Vite 打包（虚拟模块 `virtual:xyq-plugins` 生成「插件名 → 动态 import」注册表）；
- **内核 HMR**：修改 `plugins.json` → 热重载全部已装载插件（无需刷新页面）；修改插件代码 → Vite 动态 import 更新，经 `kernel.plugins.reload`（卸载+重装，拾取新模块）生效；未 accept 的模块整页刷新；
- 本地相对路径插件（`./local-plugins/*`）经 vite alias 指向仓库内绝对路径，dev 模式下可用；
- `pnpm test` 冒烟测试在 Node 环境以 DOM 桩验证引导链路（system 服务 / root slot 注册 / UI 根挂载）。

## 与 plugin-views 的关系

views 服务（docs/04 §5：`register` / `list` / `onChange`）由 `@xyq-box/plugin-views`（M1 另一张卡）提供。
壳以结构类型（`src/types.ts`）识别该契约，不 import 其实现 —— 插件间无包级依赖（docs/05 §2）。
