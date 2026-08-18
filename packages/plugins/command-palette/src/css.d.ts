/** CSS 导入声明（经打包器处理，tsc 类型检查用） */
declare module '*.css' {
  const content: string
  export default content
}
