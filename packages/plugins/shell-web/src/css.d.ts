/** Vite CSS 导入声明（经 Vite 入口打包，tsc 类型检查用） */
declare module '*.css' {
  const content: string
  export default content
}
