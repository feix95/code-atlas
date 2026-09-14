// ── 预览分色的公共账(纯常量 + 纯函数,自测覆盖)──
// 主进程拿 tree-sitter 把代码解析成「第几个字到第几个字是什么角色」,渲染层按角色上色;
// 两边只靠这一页纸对账:角色编号的顺序、后缀认语言、字数闸。颜色本身归 CSS 管
// (main.css 的 tok-*,抄的是 VS Code 官方 Dark+ / Light+ 两套主题的色号)。

/**
 * 分色的角色名单:顺序就是 IPC 里传的编号,渲染层拿它拼 tok-xxx 类名。
 * 大白话对号:ctl 控制流关键字(紫)、kw 普通关键字(蓝)、str 字符串(橙)、
 * com 注释(绿)、num 数字(浅绿)、fn 函数名(黄)、type 类型名(青)、
 * var 变量/普通名字(浅蓝)、regex 正则(红)、symbol CSS 选择器(金)。
 */
export const HL_KINDS = ['ctl', 'kw', 'str', 'com', 'num', 'fn', 'type', 'var', 'regex', 'symbol'] as const
export type HlKind = (typeof HL_KINDS)[number]

/** 超过这个字数的正文不上色:解析在主进程同步跑,别为好看把窗口冻住(超了老实白字) */
export const HL_MAX_CHARS = 1_000_000

/**
 * 后缀 → 语法语言(对上 tree-sitter-wasms 里的语法包名)。
 * TS/JS 四族共用 tsx 语法(它是超集,跟体检模块一个思路);
 * json/css/html/bash/yaml/toml 是白捡的:语法包一直在躺着,顺手收编。
 * 没收录的后缀(比如 md、各种冷门语言)老实白字,不硬上 —— 支持面故意比体检模块宽,
 * 但也只收映射表写好了的语言,宁缺毋滥。
 */
const EXT_LANG: Record<string, string> = {
  ts: 'tsx',
  tsx: 'tsx',
  mts: 'tsx',
  cts: 'tsx',
  js: 'tsx',
  jsx: 'tsx',
  mjs: 'tsx',
  cjs: 'tsx',
  py: 'python',
  pyw: 'python',
  java: 'java',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'c_sharp',
  rs: 'rust',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  sh: 'bash',
  bash: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml'
}

/** 看文件名认语言:认不出返回 null(白字),大小写不敏感(.TS 也是 TS) */
export function hlLanguageFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return null
  return EXT_LANG[fileName.slice(dot + 1).toLowerCase()] ?? null
}

/** 高亮不参与:字数超闸或语言不认识,都算「这份不上色」(纯函数,主进程和自测共用) */
export function hlEligible(text: string, language: string | null): boolean {
  return text.length <= HL_MAX_CHARS && language !== null
}
