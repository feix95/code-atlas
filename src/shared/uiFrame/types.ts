// UI 框架(UI Spec Builder)的数据结构总账:方案、变量、页面结构、规格包。
// 规格见 docs/to-do list《UI框架-需求规格(UI Spec Builder)》§6、§12、§13。
// 全部为纯类型,渲染层、主进程、自测共用这一份定义。

export type ThemeName = 'light' | 'dark'

/** 变量层级(§6.1):基础变量 → 组件变量 / 页面变量;后两者默认引用基础变量 */
export type TokenTier = 'base' | 'component' | 'page'

/** 变量值。尺寸一律存逻辑像素(§12 内部存储),导出时按根字号换算 rem */
export type TokenValue =
  | { kind: 'color'; light: string; dark: string }
  | { kind: 'dimension'; px: number }
  | { kind: 'em'; value: number }
  | { kind: 'number'; value: number }
  | { kind: 'fontWeight'; value: number }
  | { kind: 'fontFamily'; families: string[] }
  | {
      kind: 'shadow'
      x: number
      y: number
      blur: number
      spread: number
      light: string
      dark: string
    }
  | { kind: 'ref'; ref: string }

export interface TokenDef {
  /** 两级路径:[分组, 名称];CSS 变量名 = path.join('-'),DTCG 引用 = {path.join('.')} */
  path: [string, string]
  label: string
  tier: TokenTier
  value: TokenValue
}

/** 键 = CSS 变量名(不含 --) */
export type TokenMap = Record<string, TokenDef>

/** 图标槽位:页面与演示页里每个用到图标的位置 */
export type IconSlot =
  | 'demo-button'
  | 'demo-ibtn'
  | 'demo-check'
  | 'demo-input'
  | 'demo-li'
  | 'demo-arrow'
  | 'demo-card'
  | 'hero-cta'
  | 'feature-1'
  | 'feature-2'
  | 'feature-3'

export interface UiFrameDoc {
  schemaVersion: 1
  name: string
  platform: 'desktop'
  rootFontPx: number
  tokens: TokenMap
  icons: Record<IconSlot, string>
}

/** lucide icon-nodes.json 的单个图标:[标签名, 属性] 列表 */
export type IconNode = Array<[string, Record<string, string>]>
export type IconLookup = (name: string) => IconNode | undefined

/** 页面结构节点(§13.2 规则 6:每个元素写明标签、class、关键属性) */
export interface PageNode {
  tag: string
  cls?: string
  attrs?: Record<string, string>
  text?: string
  /** 内联图标槽位;iconAt = 图标在文字前还是文字后 */
  icon?: IconSlot
  iconAt?: 'start' | 'end'
  /** 画布选中用的部件名(只在画布模式输出 data-uf-part) */
  part?: string
  children?: PageNode[]
}

/** 规格包:相对路径 → 文本内容;字体与截图由主进程补齐 */
export interface SpecPackage {
  folderName: string
  files: Record<string, string>
  fonts: FontPlan[]
  previews: PreviewPlan[]
}

export interface FontPlan {
  /** 规格包内的子目录(fonts/<dir>/) */
  dir: 'inter' | 'noto-sans-sc'
  files: string[]
}

export interface PreviewPlan {
  html: string
  png: string
  width: number
  height: number
}

/** 导出结果:用户取消 / 写盘完成(附字体未加载的截图清单) */
export type UiFrameExportResult =
  { status: 'canceled' } | { status: 'done'; path: string; unloadedFontPreviews: string[] }

export type LintLevel = 'error' | 'warn'

export interface LintIssue {
  level: LintLevel
  check: string
  file: string
  message: string
}
