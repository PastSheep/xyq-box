/**
 * @xyq-box/core —— xyq-box 内核
 *
 * 职责：引导（bootstrap）、插件管理器、清单加载器、配置仓库。
 * M0 仓库脚手架：先固化 cordis 4.0.0-rc.8（ADR-D1）运行时与构建链路，
 * 内核实现随 M0 里程碑补齐。
 */

/** 内核版本（与 package.json 保持一致，M0 起由 changesets 驱动） */
export const version = '0.1.0'
