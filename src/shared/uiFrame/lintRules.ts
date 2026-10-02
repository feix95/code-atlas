// 规格包体检的配置(§13.7):含糊词、行内标签、有浏览器默认样式的标签。
// 新增检查口径只改这里,不动检查逻辑。

/** 含糊词(规则 8):出现即为错误 */
export const VAGUE_WORDS = [
  '可以',
  '可选',
  '建议',
  '尽量',
  '一般',
  '大概',
  '适当',
  '酌情',
  '视情况',
  '也许',
  '或许',
  '差不多',
  '自由发挥空间'
]

/** 「可」后接动作时同样是含糊授权(例:可从 Google Fonts 引入) */
export const VAGUE_PATTERNS: RegExp[] = [/可(?=从|在|按|用|自行|根据|酌|选)/g]

/** 要扫描含糊词的文件 */
export const VAGUE_FILES = (path: string): boolean =>
  path === 'README-给AI.md' || (path.startsWith('pages/') && path.endsWith('.md'))

/** 要扫描写死数值的样式文件(演示样式与变量文件除外) */
export const LITERAL_FILES = (path: string): boolean =>
  path.endsWith('.css') &&
  (path.startsWith('components/') || path.startsWith('pages/')) &&
  !path.endsWith('_demo.css')

/** 组件样式文件(体检「演示代码泄漏」「状态缺失」) */
export const COMPONENT_CSS = (path: string): boolean =>
  path.startsWith('components/') && path.endsWith('.css') && !path.endsWith('_demo.css')

/** 演示专用 class 前缀 */
export const DEMO_CLASS_PATTERNS: RegExp[] = [/\.is-[\w-]+/, /\.demo[\w-]*/]

/** 行内标签:同级排列时若父级不是 flex / grid,空白会产生间距(规则 13) */
export const INLINE_TAGS = new Set([
  'a',
  'span',
  'button',
  'strong',
  'em',
  'img',
  'svg',
  'label',
  'code',
  'input',
  'select'
])

/** 有浏览器默认外边距、内边距或字号的标签(规则 7) */
export const UA_STYLED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'figure',
  'blockquote',
  'dl',
  'dd',
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'table',
  'th',
  'td',
  'pre',
  'hr',
  'body'
])

/** 交互组件必须具备的伪类(状态缺失检查) */
export const INTERACTIVE_STATES = [':hover', ':active', ':focus-visible', ':disabled']
