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
  | 'app-back'
  | 'app-bell'
  | 'app-search'
  | 'app-row-1'
  | 'app-row-2'
  | 'app-row-3'
  | 'app-arrow'
  | 'demo-search'
  | 'demo-down'

export type UiPlatform = 'desktop' | 'phone'

/** 底板上摆的一个零件实例(M3-a 页面拼装):配方 id + 自由坐标 */
export interface PlacedPart {
  /** 实例 id:选中/移动/删除的定位锚,生成时唯一 */
  id: string
  /** 零件注册表 entries 的配方 id(src/shared/uiFrame/parts.ts) */
  recipe: string
  /** 底板内容坐标(px,未缩放坐标系) */
  x: number
  y: number
}

export interface UiFrameDoc {
  schemaVersion: 1
  name: string
  platform: UiPlatform
  /** 画布设备预设 id(§5.4);切平台时重置为该平台的默认档 */
  device: string
  /** 起步模板 id(§9);模板与空白起步的户口名 */
  template: string
  rootFontPx: number
  tokens: TokenMap
  icons: Record<IconSlot, string>
  /** 底板上的零件摆放(M3-a);空数组 = 底板显示模板示例页或空态 */
  placed: PlacedPart[]
  /** 问卷 D9「需要重点照顾」→ §5.7 加强档校验(更大字号下限、更高对比度) */
  a11yEnhanced?: boolean
  /** 立项单技术选型回填(§3.6):导出时的默认目标技术栈 */
  targetStack?: string
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

/** 方案文件 manifest.json(§15):格式版本号必须带,老方案靠它迁移 */
export interface SchemeManifest {
  formatVersion: 1
  id: string
  name: string
  platform: UiPlatform
  /** 风格预设名(§8) */
  style: string
  /** 起步模板 id;空白起步记 'blank' */
  template: string
  createdAt: string
  modifiedAt: string
  appVersion: string
}

/** 方案库清单行(§5.8):列表要缩略图、平台、风格、最后修改时间 */
export interface SchemeMeta {
  id: string
  name: string
  platform: UiPlatform
  style: string
  modifiedAt: string
  /** data:URL 缩略图;没截成的方案为 null */
  thumbnail: string | null
}

/** 方案库读取结果:manifest + design.json 正文(渲染层再 parseDoc) */
export interface SchemeBundle {
  manifest: SchemeManifest
  design: string
}

/** 保存方案的 IPC 入参;id 为空 = 新建 */
export interface SchemeSavePayload {
  id: string | null
  name: string
  doc: UiFrameDoc
  /** 缩略图用:示例页完整 HTML(内联样式);为空跳过缩略图 */
  thumbHtml: string
}

export type LintLevel = 'error' | 'warn'

export interface LintIssue {
  level: LintLevel
  check: string
  file: string
  message: string
}
