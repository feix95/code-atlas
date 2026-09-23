// ── 预览分色的公共账(纯常量 + 纯函数,自测覆盖)──
// 主进程拿 tree-sitter 把代码解析成「第几个字到第几个字是什么角色」,渲染层按角色上色;
// 两边只靠这一页纸对账:角色编号的顺序、后缀认语言、字数闸。颜色本身归 CSS 管
// (main.css 的 tok-*,抄的是 VS Code 官方 Dark+ / Light+ 两套主题的色号)。

import { LANGUAGES } from './languages.ts'
import { LANG_TO_GRAMMAR } from './grammarWasm.ts'

/**
 * 分色的角色名单:顺序就是 IPC 里传的编号,渲染层拿它拼 tok-xxx 类名。
 * 大白话对号:ctl 控制流关键字(紫)、kw 普通关键字(蓝)、str 字符串(橙)、
 * com 注释(绿)、num 数字(浅绿)、fn 函数名(黄)、type 类型名(青)、
 * var 变量/普通名字(浅蓝)、regex 正则(红)、symbol CSS 选择器(金)。
 */
export const HL_KINDS = [
  'ctl',
  'kw',
  'str',
  'com',
  'num',
  'fn',
  'type',
  'var',
  'regex',
  'symbol'
] as const
export type HlKind = (typeof HL_KINDS)[number]

/** 超过这个字数的正文不上色:解析在主进程同步跑,别为好看把窗口冻住(超了老实白字) */
export const HL_MAX_CHARS = 1_000_000

/**
 * 后缀 → 语法语言:不养自己的名单 —— 从语言户口本(shared/languages.ts)倒查,
 * 凡户口本语言在 LANG_TO_GRAMMAR(shared/grammarWasm.ts)有语法,它的后缀全映射过去
 * (.zsh→bash、.cts→tsx 自动收编,不用想起这还有一张表)。
 * 没语法的语言(md、scss、vue…)老实白字,宁缺毋滥;支持面仍比体检模块宽
 * (json/css/html/bash/yaml/toml 是语法包白捡的)。
 */
const EXT_LANG: Record<string, string> = {}
for (const lang of LANGUAGES) {
  const grammar = LANG_TO_GRAMMAR[lang.id]
  if (!grammar) continue
  for (const ext of lang.extensions ?? []) EXT_LANG[ext.slice(1)] = grammar
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
