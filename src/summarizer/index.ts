// 全树速览:文件夹一扫完,给树里每个节点配一句大白话标签。
// 纯规则引擎(文件名字典 + 目录名习惯 + 内容统计),不劳烦 AI:
// 毫秒级、零成本、断网也能用 —— AI 深讲留给点开后的讲解卡。
// 界面只管原样展示 summary;规则实在认不出就给"没认出来"的诚实话,绝不硬凑瞎说。
import type { NodeSummary, ScanDirNode, ScanFileNode } from '../shared/types.ts'

// ── 文件:精确文件名字典(小写比对,最铁的证据) ──
const FILE_SUMMARIES: Record<string, NodeSummary> = {
  'package.json': { emoji: '🪪', text: '项目身份证:叫啥名、用哪些库、能跑哪些命令' },
  'package-lock.json': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'npm-shrinkwrap.json': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'pnpm-lock.yaml': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'yarn.lock': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'cargo.lock': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'poetry.lock': { emoji: '🔒', text: '依赖精确清单:锁定每个包的确切版本,自动生成,别手改' },
  'readme': { emoji: '🏠', text: '项目门面:新人第一站,介绍这是啥、怎么跑起来' },
  'readme.md': { emoji: '🏠', text: '项目门面:新人第一站,介绍这是啥、怎么跑起来' },
  'readme.txt': { emoji: '🏠', text: '项目门面:新人第一站,介绍这是啥、怎么跑起来' },
  '.gitignore': { emoji: '🚫', text: '告诉 Git 哪些东西别管:临时文件、本地配置,别提交上去' },
  '.gitattributes': { emoji: '🏷️', text: '告诉 Git 每类文件怎么对待:换行、编码这些规矩' },
  '.gitkeep': { emoji: '🧯', text: '占位符:空文件夹靠它不被 Git 忘掉' },
  '.gitmodules': { emoji: '🔗', text: '子项目清单:仓库里还嵌着别人家的仓库' },
  '.prettierignore': { emoji: '🙈', text: '排版师傅的免检名单:这些文件不用格式化' },
  '.editorconfig': { emoji: '✒️', text: '编辑器统一设置:谁来打开,缩进换行都一个样' },
  '.eslintrc': { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' },
  '.eslintrc.js': { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' },
  '.eslintrc.json': { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' },
  '.eslintrc.yml': { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' },
  '.eslintrc.yaml': { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' },
  'jsconfig.json': { emoji: '📐', text: 'JavaScript 的尺子:编辑器怎么理解这套代码' },
  'claude.md': { emoji: '🤖', text: 'AI 说明书:AI 助手上岗前必读,交代项目背景和注意事项' },
  'license': { emoji: '⚖️', text: '使用许可证:别人能拿这代码干什么、不能干什么' },
  'license.md': { emoji: '⚖️', text: '使用许可证:别人能拿这代码干什么、不能干什么' },
  'license.txt': { emoji: '⚖️', text: '使用许可证:别人能拿这代码干什么、不能干什么' },
  'licence': { emoji: '⚖️', text: '使用许可证:别人能拿这代码干什么、不能干什么' },
  'licence.md': { emoji: '⚖️', text: '使用许可证:别人能拿这代码干什么、不能干什么' },
  'changelog.md': { emoji: '📜', text: '更新日志:每个版本改了啥,一页翻完' },
  'contributing.md': { emoji: '🤝', text: '参与指南:想帮忙改代码,先看这' },
  'code_of_conduct.md': { emoji: '🤝', text: '社区公约:一起干活的行为准则' },
  'dockerfile': { emoji: '🐳', text: '集装箱图纸:教 Docker 把项目打包成能到处跑的盒子' },
  'docker-compose.yml': { emoji: '🐳', text: '集装箱编队:好几个盒子一起怎么开' },
  'docker-compose.yaml': { emoji: '🐳', text: '集装箱编队:好几个盒子一起怎么开' },
  'compose.yml': { emoji: '🐳', text: '集装箱编队:好几个盒子一起怎么开' },
  'compose.yaml': { emoji: '🐳', text: '集装箱编队:好几个盒子一起怎么开' },
  'makefile': { emoji: '🔨', text: '自动化指令集:敲一条命令替你干一串活' },
  'requirements.txt': { emoji: '📋', text: '依赖清单:项目要装哪些 Python 包' },
  'pyproject.toml': { emoji: '🐍', text: 'Python 项目章程:叫啥名、要哪些包、怎么装' },
  'setup.py': { emoji: '🐍', text: 'Python 项目章程:叫啥名、要哪些包、怎么装' },
  'setup.cfg': { emoji: '🐍', text: 'Python 项目章程:叫啥名、要哪些包、怎么装' },
  'go.mod': { emoji: '📋', text: '依赖清单:项目要哪些 Go 包、Go 版本多高' },
  'cargo.toml': { emoji: '📋', text: '依赖清单:Rust 项目的包和编译规矩' },
  'pom.xml': { emoji: '📋', text: '依赖清单:Java 项目的包和编译规矩' },
  'build.gradle': { emoji: '📋', text: '依赖清单:Java 项目的包和编译规矩' },
  'build.gradle.kts': { emoji: '📋', text: '依赖清单:Java 项目的包和编译规矩' },
  'settings.gradle': { emoji: '📋', text: '依赖清单:Java 项目的包和编译规矩' },
  'settings.gradle.kts': { emoji: '📋', text: '依赖清单:Java 项目的包和编译规矩' },
  '.npmrc': { emoji: '⚙️', text: 'npm 的小开关:装包从哪装、怎么装' },
  '.nvmrc': { emoji: '🔢', text: '指定 Node 版本:这项目用哪个版本的 Node 跑' }
}

// ── 文件:后缀字典(名字没认出来时看后缀) ──
const FILE_EXT_SUMMARIES: Record<string, NodeSummary> = {
  '.md': { emoji: '📖', text: '文档:用文字写的说明' },
  '.markdown': { emoji: '📖', text: '文档:用文字写的说明' },
  '.txt': { emoji: '📄', text: '纯文本:随手记的文字' },
  '.json': { emoji: '🗂️', text: '数据/配置:程序照着读的小账本' },
  '.yaml': { emoji: '🗂️', text: '配置文件:一层缩进一层意思的设定书' },
  '.yml': { emoji: '🗂️', text: '配置文件:一层缩进一层意思的设定书' },
  '.toml': { emoji: '🗂️', text: '配置文件:一段一块的设定书' },
  '.ini': { emoji: '⚙️', text: '配置文件:程序的行为开关' },
  '.cfg': { emoji: '⚙️', text: '配置文件:程序的行为开关' },
  '.conf': { emoji: '⚙️', text: '配置文件:程序的行为开关' },
  '.lock': { emoji: '🔒', text: '依赖精确清单:自动生成,别手改' },
  '.png': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.jpg': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.jpeg': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.gif': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.webp': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.svg': { emoji: '🖼️', text: '图片素材:矢量小图,放大不糊' },
  '.ico': { emoji: '🖼️', text: '图标素材:软件/网页的小头像' },
  '.bmp': { emoji: '🖼️', text: '图片素材:界面或文档用的图' },
  '.mp3': { emoji: '🎵', text: '音频素材:听个响的文件' },
  '.wav': { emoji: '🎵', text: '音频素材:听个响的文件' },
  '.ogg': { emoji: '🎵', text: '音频素材:听个响的文件' },
  '.flac': { emoji: '🎵', text: '音频素材:听个响的文件' },
  '.m4a': { emoji: '🎵', text: '音频素材:听个响的文件' },
  '.mp4': { emoji: '🎬', text: '视频素材:能动起来的画面' },
  '.mov': { emoji: '🎬', text: '视频素材:能动起来的画面' },
  '.avi': { emoji: '🎬', text: '视频素材:能动起来的画面' },
  '.mkv': { emoji: '🎬', text: '视频素材:能动起来的画面' },
  '.webm': { emoji: '🎬', text: '视频素材:能动起来的画面' },
  '.ttf': { emoji: '🔤', text: '字体文件:界面文字的笔迹' },
  '.otf': { emoji: '🔤', text: '字体文件:界面文字的笔迹' },
  '.woff': { emoji: '🔤', text: '字体文件:界面文字的笔迹' },
  '.woff2': { emoji: '🔤', text: '字体文件:界面文字的笔迹' },
  '.eot': { emoji: '🔤', text: '字体文件:界面文字的笔迹' },
  '.pdf': { emoji: '📕', text: 'PDF 文档:排好版的固定文档' },
  '.csv': { emoji: '📊', text: '表格数据:逗号隔开的简易表格' },
  '.html': { emoji: '🌐', text: '网页:浏览器能直接打开的页面' },
  '.htm': { emoji: '🌐', text: '网页:浏览器能直接打开的页面' },
  '.css': { emoji: '🎨', text: '样式:管界面长什么样' },
  '.scss': { emoji: '🎨', text: '样式:管界面长什么样' },
  '.sass': { emoji: '🎨', text: '样式:管界面长什么样' },
  '.less': { emoji: '🎨', text: '样式:管界面长什么样' },
  '.sql': { emoji: '🗃️', text: '数据库脚本:建表查数据的指令' },
  '.sh': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.bash': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.zsh': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.ps1': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.bat': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.cmd': { emoji: '🖥️', text: '脚本:一条条命令攒成的自动化小工具' },
  '.zip': { emoji: '📦', text: '压缩包:打包一起搬的文件堆' },
  '.tar': { emoji: '📦', text: '压缩包:打包一起搬的文件堆' },
  '.gz': { emoji: '📦', text: '压缩包:打包一起搬的文件堆' },
  '.7z': { emoji: '📦', text: '压缩包:打包一起搬的文件堆' },
  '.rar': { emoji: '📦', text: '压缩包:打包一起搬的文件堆' },
  '.exe': { emoji: '⚙️', text: '机器码:给电脑直接执行的程序零件' },
  '.dll': { emoji: '⚙️', text: '机器码:给电脑直接执行的程序零件' },
  '.so': { emoji: '⚙️', text: '机器码:给电脑直接执行的程序零件' },
  '.dylib': { emoji: '⚙️', text: '机器码:给电脑直接执行的程序零件' },
  '.bin': { emoji: '⚙️', text: '机器码:给电脑直接执行的程序零件' },
  '.wasm': { emoji: '⚙️', text: '网页机器码:浏览器里跑的高性能零件' },
  '.proto': { emoji: '📡', text: '接口契约:两边怎么说话的约定' },
  '.graphql': { emoji: '📡', text: '接口契约:要什么数据怎么问' },
  '.gql': { emoji: '📡', text: '接口契约:要什么数据怎么问' },
  '.vue': { emoji: '🧩', text: '界面组件:一块拼装好的页面零件' },
  '.svelte': { emoji: '🧩', text: '界面组件:一块拼装好的页面零件' }
}

// ── 文件:名字模式规则(字典和后缀都认不出时再试) ──
const FILE_PATTERNS: Array<{ re: RegExp; summary: NodeSummary }> = [
  // 测试文件:名字里带 test/spec/selftest 的都是考卷
  { re: /\.test\.|\.spec\.|selftest|(^|[.-])test[.-]/, summary: { emoji: '🧪', text: '测试:验证代码对不对的考卷' } },
  { re: /^tsconfig\..*\.json$/, summary: { emoji: '📐', text: 'TypeScript 的尺子:类型查多严、编译成啥标准' } },
  { re: /^\.?prettier\.config\./, summary: { emoji: '📏', text: '排版规矩:缩进、引号、换行统一标准,全项目一个审美' } },
  {
    re: /^(\.eslintrc\.(?!json|js|yml|yaml)|eslint\.config\.)/,
    summary: { emoji: '🩺', text: '代码体检医生:揪出坏写法和潜在 bug' }
  },
  {
    re: /^(electron\.)?vite\.config\.|webpack\.config\.|rollup\.config\.|rspack\.config\./,
    summary: { emoji: '⚙️', text: '打包流水线:源代码怎么编译拼装成能跑的程序' }
  },
  { re: /^\.env(\.|$)/, summary: { emoji: '🔑', text: '环境变量:程序运行时的可调开关,常有密钥,别外传' } },
  { re: /^dockerfile\./, summary: { emoji: '🐳', text: '集装箱图纸:教 Docker 把项目打包成能到处跑的盒子' } },
  { re: /\.d\.ts$/, summary: { emoji: '📜', text: '类型说明书:告诉 TypeScript 那些库长啥样' } },
  { re: /\.config\./, summary: { emoji: '⚙️', text: '配置文件:调程序行为的小开关' } }
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

function summarizeFile(file: ScanFileNode): NodeSummary {
  const lower = file.name.toLowerCase()

  // 名字精确命中最可信
  const byName = FILE_SUMMARIES[lower]
  if (byName) return byName

  for (const { re, summary } of FILE_PATTERNS) {
    if (re.test(lower)) return summary
  }

  // 入口角色:常见代码语言的 index/main 文件,多半是程序开始跑的地方
  const base = lower.replace(/\.[^.]+$/, '')
  if (file.language && CODE_LANG_IDS.has(file.language.id) && (base === 'index' || base === 'main')) {
    return { emoji: '🚪', text: '入口:程序多半从这儿开始跑' }
  }

  const byExt = FILE_EXT_SUMMARIES[file.ext]
  if (byExt) return byExt

  if (file.language) {
    return { emoji: '🧱', text: `${file.language.name} 源代码:程序的一块积木` }
  }
  if (file.ext) return { emoji: '🤔', text: `没认出「${file.ext}」是啥类型,点它可问 AI` }
  return { emoji: '📄', text: '没有后缀名,得打开看看才知道是干嘛的' }
}

// ── 目录:名字习惯字典 ──
const DIR_SUMMARIES: Record<string, NodeSummary> = {
  src: { emoji: '🏠', text: '本体所在:全部源代码都住这,程序的心脏' },
  source: { emoji: '🏠', text: '本体所在:全部源代码都住这,程序的心脏' },
  sources: { emoji: '🏠', text: '本体所在:全部源代码都住这,程序的心脏' },
  lib: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  libs: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  utils: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  util: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  helpers: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  helper: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  common: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  shared: { emoji: '🧰', text: '工具间:到处要用的通用小工具' },
  scripts: { emoji: '⚙️', text: '工具脚本:一条条攒好的命令,替你自动干活' },
  script: { emoji: '⚙️', text: '工具脚本:一条条攒好的命令,替你自动干活' },
  bin: { emoji: '⚙️', text: '工具脚本:一条条攒好的命令,替你自动干活' },
  tools: { emoji: '⚙️', text: '工具脚本:一条条攒好的命令,替你自动干活' },
  tooling: { emoji: '⚙️', text: '工具脚本:一条条攒好的命令,替你自动干活' },
  test: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  tests: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  __tests__: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  spec: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  specs: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  e2e: { emoji: '🧪', text: '测试试卷:改完代码跑一遍,验证没改坏' },
  docs: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  doc: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  documents: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  documentation: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  manual: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  manuals: { emoji: '📚', text: '文档仓库:项目说明都搁这' },
  inspiration: { emoji: '💡', text: '灵感收集箱:攒想法和参考资料,不参与程序运行' },
  examples: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  example: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  demo: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  demos: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  samples: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  sample: { emoji: '💡', text: '灵感收集箱:攒样例和参考,照着学,不参与程序运行' },
  reference: { emoji: '💡', text: '灵感收集箱:攒想法和参考资料,不参与程序运行' },
  references: { emoji: '💡', text: '灵感收集箱:攒想法和参考资料,不参与程序运行' },
  vendor: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  vendors: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  third_party: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  thirdparty: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  external: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  deps: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  dependencies: { emoji: '📦', text: '外来户:别人家的代码放这借用,咱自己不改' },
  assets: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  asset: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  static: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  public: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  images: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  img: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  icons: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  fonts: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  media: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  videos: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  video: { emoji: '🖼️', text: '素材库:图片字体这些装点门面的东西' },
  components: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  component: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  ui: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  widgets: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  views: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  pages: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  screens: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  layouts: { emoji: '🧩', text: '零件库:界面一块块的小零件,拼出整个页面' },
  config: { emoji: '⚙️', text: '配置间:程序的行为开关都集中在这' },
  configs: { emoji: '⚙️', text: '配置间:程序的行为开关都集中在这' },
  configuration: { emoji: '⚙️', text: '配置间:程序的行为开关都集中在这' },
  settings: { emoji: '⚙️', text: '配置间:程序的行为开关都集中在这' },
  styles: { emoji: '🎨', text: '化妆间:界面长什么样的样式都搁这' },
  style: { emoji: '🎨', text: '化妆间:界面长什么样的样式都搁这' },
  css: { emoji: '🎨', text: '化妆间:界面长什么样的样式都搁这' },
  scss: { emoji: '🎨', text: '化妆间:界面长什么样的样式都搁这' },
  sass: { emoji: '🎨', text: '化妆间:界面长什么样的样式都搁这' },
  types: { emoji: '📐', text: '类型说明书:给 TypeScript 看的数据形状' },
  typings: { emoji: '📐', text: '类型说明书:给 TypeScript 看的数据形状' },
  interfaces: { emoji: '📐', text: '类型说明书:给 TypeScript 看的数据形状' },
  api: { emoji: '📡', text: '对外窗口:跟外部打交道的接口' },
  apis: { emoji: '📡', text: '对外窗口:跟外部打交道的接口' },
  routes: { emoji: '📡', text: '对外窗口:跟外部打交道的接口' },
  controllers: { emoji: '📡', text: '对外窗口:跟外部打交道的接口' },
  endpoints: { emoji: '📡', text: '对外窗口:跟外部打交道的接口' },
  hooks: { emoji: '🪝', text: '复用逻辑:多个界面共用的功能挂钩' },
  store: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  stores: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  state: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  models: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  model: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  entities: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  schemas: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  schema: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  db: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  database: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  migrations: { emoji: '🗄️', text: '数据管家:存数据和定数据形状的规矩' },
  services: { emoji: '🏭', text: '干活的车间:真正办事的业务逻辑' },
  service: { emoji: '🏭', text: '干活的车间:真正办事的业务逻辑' },
  business: { emoji: '🏭', text: '干活的车间:真正办事的业务逻辑' },
  domain: { emoji: '🏭', text: '干活的车间:真正办事的业务逻辑' },
  core: { emoji: '🏭', text: '干活的车间:真正办事的业务逻辑' },
  i18n: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  locales: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  locale: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  lang: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  languages: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  translations: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  l10n: { emoji: '🌍', text: '多语言:一套界面翻译成多种话' },
  middleware: { emoji: '🚦', text: '中间站:请求路过时先经它把关' },
  plugins: { emoji: '🔌', text: '插件架:可选的功能小配件' },
  extensions: { emoji: '🔌', text: '插件架:可选的功能小配件' },
  addons: { emoji: '🔌', text: '插件架:可选的功能小配件' },
  modules: { emoji: '🔌', text: '插件架:可选的功能小配件' },
  ci: { emoji: '🤖', text: '自动流水线:提交代码后机器自动检查' },
  workflows: { emoji: '🤖', text: '自动流水线:提交代码后机器自动检查' }
}

// 这些目录名底下若大半文件都是测试,改口说成"自测工具箱"(如本项目的 scripts/)
const SCRIPTS_LIKE = new Set(['scripts', 'script', 'bin', 'tools', 'tooling'])
const DOC_EXTS = new Set(['.md', '.txt', '.rst', '.adoc'])

function isTestFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return /\.test\.|\.spec\.|selftest|(^|[.-])test[.-]/.test(lower)
}

/** 目录速览:名字字典 → 全文档特判 → 内容统计兜底(没名字线索时看里面装了啥) */
function summarizeDir(node: ScanDirNode, directDirs: number, fileCount: number, byLang: Map<string, number>, extCounts: Map<string, number>): NodeSummary {
  const lower = node.name.toLowerCase()
  const byName = DIR_SUMMARIES[lower]
  if (byName) {
    // 脚本类目录里若大半是测试文件,改口成自测工具箱(带数量更实在)
    if (SCRIPTS_LIKE.has(lower)) {
      const directFiles = node.children.filter((c) => c.type === 'file')
      const testFiles = directFiles.filter((c) => isTestFileName(c.name))
      if (directFiles.length > 0 && testFiles.length * 2 >= directFiles.length) {
        return { emoji: '🧪', text: `自测工具箱:${testFiles.length} 个测试脚本,改完代码跑一遍验身` }
      }
    }
    return byName
  }

  // 分级扫描还没探进这层:老实说"还没探",别让人以为是个空文件夹
  if (node.lazy) {
    return { emoji: '📁', text: '还没探:点开它,马上帮你探这一层' }
  }

  // 这层打开被拒(多半是 Windows 锁住的系统文件夹):老实说"不让看",别谎报成空文件夹
  if (node.truncated && fileCount === 0 && directDirs === 0) {
    return { emoji: '🔒', text: '系统不让看:被 Windows 锁住的内部文件夹,不是空的,也不用看' }
  }

  if (fileCount === 0 && directDirs === 0) {
    return { emoji: '📂', text: '空文件夹:暂时啥也没装' }
  }

  // 全是文字资料、一份代码没有:老实说它是资料间
  if (fileCount > 0 && extCounts.size > 0 && [...extCounts.keys()].every((ext) => DOC_EXTS.has(ext))) {
    return { emoji: '📚', text: `资料间:${fileCount} 份文字资料,一份代码没有` }
  }

  if (fileCount === 0 && directDirs > 0) {
    return { emoji: '📁', text: `分类抽屉:里头划了 ${directDirs} 个子文件夹,没散文件` }
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
    return { emoji: '🧱', text: `装着 ${fileCount} 个文件,大头是${topLang}代码` }
  }
  return { emoji: '📦', text: `装着 ${fileCount} 个文件,没认出是什么代码` }
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
      child.summary = summarizeFile(child)
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
 * 给整棵扫描树打大白话标签(原地写进每个节点的 summary)。
 * 纯内存计算,毫秒级;文件名/后缀认不出的给诚实话,绝不编。
 */
export function annotateSummaries(tree: ScanDirNode): void {
  tallyDir(tree)
}
