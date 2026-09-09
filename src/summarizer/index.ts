// 全树速览:文件夹一扫完,给树里每个节点配一句大白话标签。
// 词条三档规矩(第九十二锤,按外部 AI 会诊定稿的《词条撰写执行规则》执行):
//   档位1  类型标签+文件名已说清 → 不写字(留空);只有黑话后缀给 2~4 字范畴词(如 .md → 文档)
//   档位2  身份唯一、无风险     → 只说"是什么",≤14 字,禁人物拟人,比喻只许空间/容器
//   档位3  动错会出事           → "是什么 + 该怎么处理",≤20 字,"不要手动改"统一措辞(sticky:重复不降噪)
// 状态类(空/锁定/未展开/截断)单走第五节规矩:像日志播报,比喻全免。
// 纯规则引擎,不劳烦 AI:毫秒级、零成本、断网也能用;认不出就给诚实话,绝不硬凑。
import type { NodeSummary, ScanDirNode, ScanFileNode } from '../shared/types.ts'
import { translateName } from './words.ts'

// 风险句构造器:档位3专用,同话重播时不参与降噪(见 shared/summaryDedup)
const TIER3 = (icon: string, text: string): NodeSummary => ({ icon, text, sticky: true })

// ── 文件:精确文件名字典(小写比对,最铁的证据) ──
const FILE_SUMMARIES: Record<string, NodeSummary> = {
  'package.json': { icon: 'config', text: '项目配置：名称、依赖和命令' },
  'package-lock.json': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'npm-shrinkwrap.json': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'pnpm-lock.yaml': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'yarn.lock': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'cargo.lock': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'poetry.lock': TIER3('lock', '锁定依赖版本，自动生成，不要手动改'),
  'readme': { icon: 'doc', text: '项目说明：是什么、怎么运行' },
  'readme.md': { icon: 'doc', text: '项目说明：是什么、怎么运行' },
  'readme.txt': { icon: 'doc', text: '项目说明：是什么、怎么运行' },
  '.gitignore': TIER3('lock', '告诉 Git 忽略哪些文件，不会被提交'),
  '.gitattributes': { icon: 'config', text: 'Git 的文件处理规则' },
  '.gitkeep': { icon: 'file', text: '空文件夹占位文件' },
  '.gitmodules': { icon: 'package', text: 'Git 子项目清单' },
  '.prettierignore': { icon: 'style', text: '格式化忽略名单' },
  '.editorconfig': { icon: 'config', text: '编辑器配置：统一缩进和换行' },
  '.eslintrc': { icon: 'check', text: '代码检查：查出写法问题和 bug' },
  '.eslintrc.js': { icon: 'check', text: '代码检查：查出写法问题和 bug' },
  '.eslintrc.json': { icon: 'check', text: '代码检查：查出写法问题和 bug' },
  '.eslintrc.yml': { icon: 'check', text: '代码检查：查出写法问题和 bug' },
  '.eslintrc.yaml': { icon: 'check', text: '代码检查：查出写法问题和 bug' },
  'jsconfig.json': { icon: 'config', text: 'JS 配置：帮编辑器理解代码' },
  'tsconfig.json': { icon: 'config', text: '编译配置：类型检查和编译标准' },
  'claude.md': { icon: 'bot', text: 'AI 说明：AI 干活前必读的背景' },
  'license': { icon: 'doc', text: '许可证：规定代码能怎么用' },
  'license.md': { icon: 'doc', text: '许可证：规定代码能怎么用' },
  'license.txt': { icon: 'doc', text: '许可证：规定代码能怎么用' },
  'licence': { icon: 'doc', text: '许可证：规定代码能怎么用' },
  'licence.md': { icon: 'doc', text: '许可证：规定代码能怎么用' },
  'changelog.md': { icon: 'doc', text: '更新日志：每个版本改了什么' },
  'contributing.md': { icon: 'doc', text: '参与指南：如何贡献代码' },
  'code_of_conduct.md': { icon: 'doc', text: '社区公约：行为准则' },
  'dockerfile': { icon: 'package', text: 'Docker 说明：项目怎么打包运行' },
  'docker-compose.yml': { icon: 'package', text: 'Docker 编排：多个容器一起运行' },
  'docker-compose.yaml': { icon: 'package', text: 'Docker 编排：多个容器一起运行' },
  'compose.yml': { icon: 'package', text: 'Docker 编排：多个容器一起运行' },
  'compose.yaml': { icon: 'package', text: 'Docker 编排：多个容器一起运行' },
  'makefile': { icon: 'terminal', text: '自动化指令：一条命令跑一串任务' },
  'requirements.txt': { icon: 'package', text: 'Python 依赖清单' },
  'pyproject.toml': { icon: 'package', text: 'Python 项目配置' },
  'setup.py': { icon: 'package', text: 'Python 项目配置' },
  'setup.cfg': { icon: 'package', text: 'Python 项目配置' },
  'go.mod': { icon: 'package', text: 'Go 依赖清单' },
  'cargo.toml': { icon: 'package', text: 'Rust 项目配置' },
  'pom.xml': { icon: 'package', text: 'Java 依赖和构建配置' },
  'build.gradle': { icon: 'package', text: 'Java 依赖和构建配置' },
  'build.gradle.kts': { icon: 'package', text: 'Java 依赖和构建配置' },
  'settings.gradle': { icon: 'package', text: 'Java 依赖和构建配置' },
  'settings.gradle.kts': { icon: 'package', text: 'Java 依赖和构建配置' },
  '.npmrc': { icon: 'config', text: 'npm 配置：从哪装、怎么装' },
  '.nvmrc': { icon: 'config', text: '指定 Node 版本' }
}

// ── 文件:名字模式规则(字典没精确命中时看名字形状) ──
const FILE_PATTERNS: Array<{ re: RegExp; summary: NodeSummary }> = [
  { re: /\.test\.|\.spec\.|selftest|(^|[.-])test[.-]/, summary: { icon: 'test', text: '测试：验证代码对不对' } },
  { re: /^tsconfig\..*\.json$/, summary: { icon: 'config', text: '编译配置：类型检查和编译标准' } },
  { re: /^(\.?prettier\.config\.|\.prettierrc)/, summary: { icon: 'style', text: '格式配置：统一缩进、引号、换行' } },
  {
    re: /^(\.eslintrc\.(?!json|js|yml|yaml)|eslint\.config\.)/,
    summary: { icon: 'check', text: '代码检查：查出写法问题和 bug' }
  },
  {
    re: /^(electron\.)?vite\.config\.|webpack\.config\.|rollup\.config\.|rspack\.config\./,
    summary: { icon: 'config', text: '打包配置：源代码变成能跑的程序' }
  },
  { re: /^\.env(\.|$)/, summary: TIER3('key', '配置开关，常包含密钥，不要外传') },
  { re: /^dockerfile\./, summary: { icon: 'package', text: 'Docker 说明：项目怎么打包运行' } },
  { re: /\.d\.ts$/, summary: { icon: 'doc', text: '类型说明：库的类型清单' } },
  { re: /\.config\./, summary: { icon: '⚙️', text: '配置文件' } }
]

// 认得出是代码的语言 id:给"入口角色"提示用(样式/标记类语言不掺和)
const CODE_LANG_IDS = new Set([
  'typescript',
  'typescript-react',
  'javascript',
  'javascript-react',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'swift',
  'kotlin',
  'ruby',
  'php'
])

// ── 文件:后缀范畴词(档位1:只给黑话后缀配 2~4 字范畴词,不写句子) ──
const FILE_EXT_SUMMARIES: Record<string, NodeSummary> = {
  '.md': { icon: 'doc', text: '文档' },
  '.markdown': { icon: 'doc', text: '文档' },
  '.json': { icon: 'data', text: '配置/数据' },
  '.yaml': { icon: 'config', text: '配置' },
  '.yml': { icon: 'config', text: '配置' },
  '.toml': { icon: 'config', text: '配置' },
  '.ini': { icon: 'config', text: '配置' },
  '.cfg': { icon: 'config', text: '配置' },
  '.conf': { icon: 'config', text: '配置' },
  '.lock': { icon: 'lock', text: '锁文件' },
  '.svg': { icon: 'image', text: '矢量图' },
  '.ico': { icon: 'image', text: '图标' },
  '.mp3': { icon: 'audio', text: '音频' },
  '.wav': { icon: 'audio', text: '音频' },
  '.ogg': { icon: 'audio', text: '音频' },
  '.flac': { icon: 'audio', text: '音频' },
  '.m4a': { icon: 'audio', text: '音频' },
  '.mp4': { icon: 'video', text: '视频' },
  '.mov': { icon: 'video', text: '视频' },
  '.avi': { icon: 'video', text: '视频' },
  '.mkv': { icon: 'video', text: '视频' },
  '.webm': { icon: 'video', text: '视频' },
  '.ttf': { icon: 'font', text: '字体' },
  '.otf': { icon: 'font', text: '字体' },
  '.woff': { icon: 'font', text: '字体' },
  '.woff2': { icon: 'font', text: '字体' },
  '.eot': { icon: 'font', text: '字体' },
  '.csv': { icon: 'table', text: '表格数据' },
  '.html': { icon: 'globe', text: '网页' },
  '.htm': { icon: 'globe', text: '网页' },
  '.css': { icon: 'style', text: '样式' },
  '.scss': { icon: 'style', text: '样式' },
  '.sass': { icon: 'style', text: '样式' },
  '.less': { icon: 'style', text: '样式' },
  '.sql': { icon: 'database', text: '数据库脚本' },
  '.sh': { icon: 'terminal', text: '脚本' },
  '.bash': { icon: 'terminal', text: '脚本' },
  '.zsh': { icon: 'terminal', text: '脚本' },
  '.ps1': { icon: 'terminal', text: '脚本' },
  '.bat': { icon: 'terminal', text: '脚本' },
  '.cmd': { icon: 'terminal', text: '脚本' },
  '.zip': { icon: 'archive', text: '压缩包' },
  '.tar': { icon: 'archive', text: '压缩包' },
  '.gz': { icon: 'archive', text: '压缩包' },
  '.7z': { icon: 'archive', text: '压缩包' },
  '.rar': { icon: 'archive', text: '压缩包' },
  '.exe': { icon: 'cpu', text: '程序文件' },
  '.dll': { icon: 'cpu', text: '程序文件' },
  '.so': { icon: 'cpu', text: '程序文件' },
  '.dylib': { icon: 'cpu', text: '程序文件' },
  '.bin': { icon: 'cpu', text: '程序文件' },
  '.wasm': { icon: 'cpu', text: '网页程序' },
  '.proto': { icon: 'globe', text: '接口定义' },
  '.graphql': { icon: 'globe', text: '接口定义' },
  '.gql': { icon: 'globe', text: '接口定义' },
  '.vue': { icon: 'component', text: '界面组件' },
  '.svelte': { icon: 'component', text: '界面组件' }
}

// 档位1的"沉默名单":图片/纯文本这类家喻户晓的后缀,类型标签已经说清 —— 不写字,但也不许报"没认出"
const KNOWN_SILENT_EXTS = new Set(['.txt', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'])

function summarizeFile(file: ScanFileNode): NodeSummary | undefined {
  const lower = file.name.toLowerCase()

  // 名字精确命中最可信
  const byName = FILE_SUMMARIES[lower]
  if (byName) return byName

  for (const { re, summary } of FILE_PATTERNS) {
    if (re.test(lower)) return summary
  }

  // 入口角色(档位2:文件名看不出来的真信息):常见代码语言的 index/main,多半是程序开始跑的地方
  const base = lower.replace(/\.[^.]+$/, '')
  if (file.language && CODE_LANG_IDS.has(file.language.id) && (base === 'index' || base === 'main')) {
    return { icon: 'entry', text: '入口：程序多半从这儿开始跑' }
  }

  // 文档读开头(第一百锤):有真标题就亮真名,别再笼统一句「文档」
  if (file.docTitle) {
    const t = file.docTitle.length > 16 ? `${file.docTitle.slice(0, 16)}…` : file.docTitle
    return { icon: 'doc', text: `文档：${t}` }
  }

  // 词根词典(第九十九锤):名字本身就是最大的信息 —— GitFileStatus → git状态,scanner → 扫描器
  // 注意传原始名:lower 已把驼峰压平,拆词就拆不动了
  const byWords = translateName(file.name)
  if (byWords) return { icon: 'code', text: byWords }

  const byExt = FILE_EXT_SUMMARIES[file.ext]
  if (byExt) return byExt

  // 档位1沉默名单 + 已识别语言的源代码:类型标签已经说清,不写字(降噪,不硬凑)
  if (KNOWN_SILENT_EXTS.has(file.ext)) return undefined
  if (file.language) return undefined

  if (file.ext) return { icon: 'help', text: `未知类型「${file.ext}」，点击可问 AI` }
  return { icon: 'file', text: '没有后缀，无法判断类型' }
}

// ── 目录:名字习惯字典(档位2正脸直说,≤14 字,无人物拟人) ──
const DIR_SUMMARIES: Record<string, NodeSummary> = {
  src: { icon: 'code', text: '项目全部源代码' },
  source: { icon: 'code', text: '项目全部源代码' },
  sources: { icon: 'code', text: '项目全部源代码' },
  lib: { icon: 'wrench', text: '通用工具代码' },
  libs: { icon: 'wrench', text: '通用工具代码' },
  utils: { icon: 'wrench', text: '通用工具代码' },
  util: { icon: 'wrench', text: '通用工具代码' },
  helpers: { icon: 'wrench', text: '通用工具代码' },
  helper: { icon: 'wrench', text: '通用工具代码' },
  common: { icon: 'wrench', text: '通用工具代码' },
  shared: { icon: 'wrench', text: '通用工具代码' },
  scripts: { icon: 'terminal', text: '自动化脚本' },
  script: { icon: 'terminal', text: '自动化脚本' },
  bin: { icon: 'terminal', text: '自动化脚本' },
  tools: { icon: 'terminal', text: '自动化脚本' },
  tooling: { icon: 'terminal', text: '自动化脚本' },
  test: { icon: 'test', text: '测试代码' },
  tests: { icon: 'test', text: '测试代码' },
  __tests__: { icon: 'test', text: '测试代码' },
  spec: { icon: 'test', text: '测试代码' },
  specs: { icon: 'test', text: '测试代码' },
  e2e: { icon: 'test', text: '测试代码' },
  docs: { icon: 'doc', text: '项目文档' },
  doc: { icon: 'doc', text: '项目文档' },
  documents: { icon: 'doc', text: '项目文档' },
  documentation: { icon: 'doc', text: '项目文档' },
  manual: { icon: 'doc', text: '项目文档' },
  manuals: { icon: 'doc', text: '项目文档' },
  inspiration: { icon: 'bulb', text: '参考资料和示例' },
  examples: { icon: 'bulb', text: '参考资料和示例' },
  example: { icon: 'bulb', text: '参考资料和示例' },
  demo: { icon: 'bulb', text: '参考资料和示例' },
  demos: { icon: 'bulb', text: '参考资料和示例' },
  samples: { icon: 'bulb', text: '参考资料和示例' },
  sample: { icon: 'bulb', text: '参考资料和示例' },
  reference: { icon: 'bulb', text: '参考资料和示例' },
  references: { icon: 'bulb', text: '参考资料和示例' },
  vendor: { icon: 'package', text: '第三方代码，只使用不修改' },
  vendors: { icon: 'package', text: '第三方代码，只使用不修改' },
  third_party: { icon: 'package', text: '第三方代码，只使用不修改' },
  thirdparty: { icon: 'package', text: '第三方代码，只使用不修改' },
  external: { icon: 'package', text: '第三方代码，只使用不修改' },
  deps: { icon: 'package', text: '第三方代码，只使用不修改' },
  dependencies: { icon: 'package', text: '第三方代码，只使用不修改' },
  assets: { icon: 'image', text: '静态资源' },
  asset: { icon: 'image', text: '静态资源' },
  static: { icon: 'image', text: '静态资源' },
  public: { icon: 'image', text: '静态资源' },
  images: { icon: 'image', text: '图片资源' },
  img: { icon: 'image', text: '图片资源' },
  icons: { icon: 'image', text: '图片资源' },
  fonts: { icon: 'font', text: '字体文件' },
  media: { icon: 'video', text: '媒体文件' },
  videos: { icon: 'video', text: '媒体文件' },
  video: { icon: 'video', text: '媒体文件' },
  components: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  component: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  ui: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  widgets: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  views: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  pages: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  screens: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  layouts: { icon: 'component', text: '界面按钮、卡片等可复用组件' },
  config: { icon: '⚙️', text: '配置文件' },
  configs: { icon: '⚙️', text: '配置文件' },
  configuration: { icon: '⚙️', text: '配置文件' },
  settings: { icon: '⚙️', text: '配置文件' },
  styles: { icon: '🎨', text: '界面的颜色、字体、间距样式' },
  style: { icon: '🎨', text: '界面的颜色、字体、间距样式' },
  css: { icon: '🎨', text: '界面的颜色、字体、间距样式' },
  scss: { icon: '🎨', text: '界面的颜色、字体、间距样式' },
  sass: { icon: '🎨', text: '界面的颜色、字体、间距样式' },
  types: { icon: '📐', text: '类型定义' },
  typings: { icon: '📐', text: '类型定义' },
  interfaces: { icon: '📐', text: '类型定义' },
  api: { icon: '📡', text: '供其他程序调用的接口' },
  apis: { icon: '📡', text: '供其他程序调用的接口' },
  routes: { icon: '📡', text: '供其他程序调用的接口' },
  controllers: { icon: '📡', text: '供其他程序调用的接口' },
  endpoints: { icon: '📡', text: '供其他程序调用的接口' },
  hooks: { icon: '🪝', text: '可复用的界面逻辑' },
  store: { icon: 'database', text: '数据和数据库代码' },
  stores: { icon: 'database', text: '数据和数据库代码' },
  state: { icon: 'database', text: '数据和数据库代码' },
  models: { icon: 'database', text: '数据和数据库代码' },
  model: { icon: 'database', text: '数据和数据库代码' },
  entities: { icon: 'database', text: '数据和数据库代码' },
  schemas: { icon: 'database', text: '数据和数据库代码' },
  schema: { icon: 'database', text: '数据和数据库代码' },
  db: { icon: 'database', text: '数据和数据库代码' },
  database: { icon: 'database', text: '数据和数据库代码' },
  migrations: { icon: 'database', text: '数据和数据库代码' },
  services: { icon: 'wrench', text: '业务功能代码，如下单、登录' },
  service: { icon: 'wrench', text: '业务功能代码，如下单、登录' },
  business: { icon: 'wrench', text: '业务功能代码，如下单、登录' },
  domain: { icon: 'wrench', text: '业务功能代码，如下单、登录' },
  core: { icon: 'wrench', text: '业务功能代码，如下单、登录' },
  i18n: { icon: 'globe', text: '多语言翻译' },
  locales: { icon: 'globe', text: '多语言翻译' },
  locale: { icon: 'globe', text: '多语言翻译' },
  lang: { icon: 'globe', text: '多语言翻译' },
  languages: { icon: 'globe', text: '多语言翻译' },
  translations: { icon: 'globe', text: '多语言翻译' },
  l10n: { icon: 'globe', text: '多语言翻译' },
  middleware: { icon: 'arrows', text: '中间站：外部请求先经它检查一遍' },
  plugins: { icon: 'component', text: '可选功能插件' },
  extensions: { icon: 'component', text: '可选功能插件' },
  addons: { icon: 'component', text: '可选功能插件' },
  modules: { icon: 'component', text: '可选功能插件' },
  ci: { icon: 'bot', text: '自动化流程：提交后自动检查' },
  workflows: { icon: 'bot', text: '自动化流程：提交后自动检查' },
  node_modules: TIER3('package', '第三方库，删了能重装，不要手动改'),
  dist: TIER3('archive', '打包产物，不要手动改，改源代码后重新打包'),
  build: TIER3('🏗️', '打包产物，不要手动改，改源代码后重新打包')
}

// 这些目录名底下若大半文件都是测试,改口报测试脚本数量(如本项目的 scripts/)
const SCRIPTS_LIKE = new Set(['scripts', 'script', 'bin', 'tools', 'tooling'])
const DOC_EXTS = new Set(['.md', '.txt', '.rst', '.adoc'])

function isTestFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return /\.test\.|\.spec\.|selftest|(^|[.-])test[.-]/.test(lower)
}

/** 目录速览:事实先上(锁死/空)→ 名字字典 → 全文档特判 → 内容统计兜底(没名字线索时看里面装了啥) */
function summarizeDir(node: ScanDirNode, directDirs: number, fileCount: number, byLang: Map<string, number>, extCounts: Map<string, number>): NodeSummary {
  const lower = node.name.toLowerCase()
  // 残账要说"至少":分级扫描截断后数出来的数是下限,不许把残账报成总数
  const n = (count: number): string => (node.truncated ? `至少 ${count}` : `${count}`)

  // 状态播报:这层打开被拒(多半是 Windows 锁住的系统文件夹),不是空的,也不用看
  if (node.truncated && fileCount === 0 && directDirs === 0) {
    return { icon: 'lock', text: '系统保护目录，无法查看，不影响使用' }
  }

  // 状态播报:真探过且空就是空,哪怕名字叫 config 也不许喊"配置间"绰号
  if (!node.lazy && fileCount === 0 && directDirs === 0) {
    return { icon: 'folder', text: '空的，还没有内容' }
  }

  const byName = DIR_SUMMARIES[lower]
  if (byName) {
    // 脚本类目录里若大半是测试文件,改口报数量(带数更实在)
    if (SCRIPTS_LIKE.has(lower)) {
      const directFiles = node.children.filter((c) => c.type === 'file')
      const testFiles = directFiles.filter((c) => isTestFileName(c.name))
      if (directFiles.length > 0 && testFiles.length * 2 >= directFiles.length) {
        return { icon: 'test', text: `${n(testFiles.length)} 个测试脚本，改完代码跑一遍` }
      }
    }
    return byName
  }

  // 词根词典(第九十九锤):业务起的名(scanner/summarizer)按词根给个身份词
  const dirWords = translateName(node.name)
  if (dirWords) return { icon: '📦', text: dirWords }

  // 状态播报:分级扫描还没展开这层,老实说"还没展开",别让人以为是个空文件夹
  if (node.lazy) {
    return { icon: 'folder', text: '还没展开，点击查看' }
  }

  // 全是文字资料、一份代码没有
  if (fileCount > 0 && extCounts.size > 0 && [...extCounts.keys()].every((ext) => DOC_EXTS.has(ext))) {
    return { icon: 'doc', text: `全是文档，${n(fileCount)} 份，没有代码` }
  }

  if (fileCount === 0 && directDirs > 0) {
    return { icon: 'folder', text: `只含子文件夹，${n(directDirs)} 个` }
  }

  // 没有名字线索,靠内容说话:哪种语言最多
  let topLang = ''
  let topCount = 0
  for (const [lang, count] of byLang) {
    if (count > topCount) {
      topLang = lang
      topCount = count
    }
  }
  if (topLang) {
    return { icon: 'code', text: `${n(fileCount)} 个文件，以${topLang}代码为主` }
  }
  return { icon: 'package', text: `${n(fileCount)} 个文件，代码类型未知` }
}

interface DirTally {
  directDirs: number
  fileCount: number
  byLang: Map<string, number>
  extCounts: Map<string, number>
}

function tallyDir(node: ScanDirNode): DirTally {
  const tally: DirTally = { directDirs: 0, fileCount: 0, byLang: new Map(), extCounts: new Map() }
  for (const child of node.children) {
    if (child.type === 'file') {
      const summary = summarizeFile(child)
      if (summary) child.summary = summary
      tally.fileCount++
      const ext = child.ext || '(无后缀)'
      tally.extCounts.set(ext, (tally.extCounts.get(ext) ?? 0) + 1)
      const lang = child.language?.name
      if (lang) tally.byLang.set(lang, (tally.byLang.get(lang) ?? 0) + 1)
    } else {
      tally.directDirs++
      const sub = tallyDir(child) // 先给子目录打标签,顺带收它的家底
      tally.fileCount += sub.fileCount
      for (const [lang, count] of sub.byLang) tally.byLang.set(lang, (tally.byLang.get(lang) ?? 0) + count)
      for (const [ext, count] of sub.extCounts) tally.extCounts.set(ext, (tally.extCounts.get(ext) ?? 0) + count)
    }
  }
  node.summary = summarizeDir(node, tally.directDirs, tally.fileCount, tally.byLang, tally.extCounts)
  return tally
}

/**
 * 给整棵扫描树打大白话标签(原地写进每个节点的 summary;档位1的文件可以留空)。
 * 纯内存计算,毫秒级;认不出的给诚实话,绝不编。
 */
export function annotateSummaries(tree: ScanDirNode): void {
  tallyDir(tree)
}
