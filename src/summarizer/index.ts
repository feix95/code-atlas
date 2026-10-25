// 全树速览:文件夹一扫完,给树里每个节点配一句大白话标签。
// 词条三档规矩(按外部 AI 会诊定稿的《词条撰写执行规则》执行):
// 档位1  类型标签+文件名已说清 → 不写字(留空);只有非常用后缀给 2~4 字范畴词(如 .md → 文档)
// 档位2  身份唯一、无风险     → 只说"是什么",≤14 字,禁人物拟人,比喻只许空间/容器
// 档位3  动错会出事           → "是什么 + 该怎么处理",≤20 字,"不要手动改"统一措辞(sticky:重复不降噪)
// 状态类(空/锁定/未展开/截断)单走第五节规矩:像日志播报,比喻全免。
// 纯规则引擎,不劳烦 AI:毫秒级、零成本、断网也能用;认不出就给诚实话,绝不硬凑。
// 词库(文件名字典/名字形状规则/后缀范畴词/目录名字典)住在 dictionary.ts。
import type { NodeSummary, ScanDirNode, ScanFileNode } from '../shared/types.ts'
import { DOC_EXTS } from '../shared/fileKinds.ts'
import { LANGUAGES, type LanguageCategory } from '../shared/languages.ts'
import { translateName } from './words.ts'
import {
  CODE_LANG_IDS,
  DIR_SUMMARIES,
  FILE_EXT_SUMMARIES,
  FILE_PATTERNS,
  FILE_SUMMARIES,
  KNOWN_SILENT_EXTS,
  SCRIPTS_LIKE
} from './dictionary.ts'

/** 文档真标题进树悬停的字数上限。当年按行内小灰字定 16,灰字退役后改悬停,放到 24。 */
export const DOC_TITLE_MAX_CHARS = 24

/** 语言类别 → 类型图标;纯文本也按文档画,图标册里没有单独的文本图标 */
const LANGUAGE_CATEGORY_ICONS: Record<LanguageCategory, string> = {
  code: 'code',
  config: 'config',
  style: 'style',
  doc: 'doc',
  text: 'doc'
}

const LANGUAGE_TYPE_ICONS = new Map(
  LANGUAGES.map((lang) => [lang.id, LANGUAGE_CATEGORY_ICONS[lang.category]])
)

/** 沉默名单里的常见类型不写字,但图标仍要说清是什么 */
const SILENT_TYPE_ICONS: Record<string, string> = {
  '.pdf': 'doc',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image'
}

/**
 * 文件类型图标:只认后缀和语言,不看名字含义。
 * 摘要带语义图标(锁/测试/入口)时界面优先用摘要的,这里负责没摘要或词根命中时的类型兜底。
 */
function resolveFileTypeIcon(file: ScanFileNode): string {
  if (DOC_EXTS.has(file.ext)) return 'doc'
  const byExt = FILE_EXT_SUMMARIES[file.ext]
  if (byExt) return byExt.icon
  const bySilentType = SILENT_TYPE_ICONS[file.ext]
  if (bySilentType) return bySilentType
  return file.language ? (LANGUAGE_TYPE_ICONS.get(file.language.id) ?? 'file') : 'file'
}

/** 文档只按文档处理:名字含义只影响文案,不能把图标抢成代码 */
function summarizeDocFile(file: ScanFileNode): NodeSummary | undefined {
  if (file.docTitle) {
    const title =
      file.docTitle.length > DOC_TITLE_MAX_CHARS
        ? `${file.docTitle.slice(0, DOC_TITLE_MAX_CHARS)}…`
        : file.docTitle
    return { icon: 'doc', text: `文档：${title}` }
  }
  const byWords = translateName(file.name)
  if (byWords) return { icon: 'doc', text: `文档：${byWords}` }
  const byExt = FILE_EXT_SUMMARIES[file.ext]
  if (byExt) return byExt
  if (KNOWN_SILENT_EXTS.has(file.ext)) return undefined
  return { icon: 'doc', text: '文档' }
}

function summarizeFile(file: ScanFileNode): NodeSummary | undefined {
  const lower = file.name.toLowerCase()

  // 名字精确命中最可信
  const byName = FILE_SUMMARIES[lower]
  if (byName) return byName

  // 文档先定性:后缀已说明是文档,名字里的词根只允许影响文案
  if (DOC_EXTS.has(file.ext)) return summarizeDocFile(file)

  for (const { re, summary } of FILE_PATTERNS) {
    if (re.test(lower)) return summary
  }

  // 入口角色(档位2:文件名看不出来的真信息):常见代码语言的 index/main,多半是程序开始跑的地方
  const base = lower.replace(/\.[^.]+$/, '')
  if (
    file.language &&
    CODE_LANG_IDS.has(file.language.id) &&
    (base === 'index' || base === 'main')
  ) {
    return { icon: 'entry', text: '入口：程序多半从这儿开始跑' }
  }

  // 词根词典:名字本身就是最大的信息 —— GitFileStatus → git状态,scanner → 扫描器
  // 注意传原始名:lower 已把驼峰压平,拆词就拆不动了;图标仍归类型层,词根不许抢
  const byWords = translateName(file.name)
  if (byWords) {
    const typeIcon = resolveFileTypeIcon(file)
    return { icon: typeIcon === 'file' ? 'code' : typeIcon, text: byWords }
  }

  const byExt = FILE_EXT_SUMMARIES[file.ext]
  if (byExt) return byExt

  // 档位1沉默名单 + 已识别语言的源代码:类型标签已经说清,不写字(降噪,不硬凑)
  if (KNOWN_SILENT_EXTS.has(file.ext)) return undefined
  if (file.language) return undefined

  if (file.ext) return { icon: 'help', text: `未知类型「${file.ext}」，点击可问 AI` }
  return { icon: 'file', text: '没有后缀，无法判断类型' }
}

function isTestFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return /\.test\.|\.spec\.|selftest|(^|[.-])test[.-]/.test(lower)
}

/** 目录速览:事实先上(锁死/空)→ 名字字典 → 全文档特判 → 内容统计兜底(没名字线索时看里面装了啥) */
function summarizeDir(
  node: ScanDirNode,
  directDirs: number,
  fileCount: number,
  byLang: Map<string, number>,
  extCounts: Map<string, number>
): NodeSummary {
  const lower = node.name.toLowerCase()
  // 残账要说"至少":分级扫描截断后数出来的数是下限,不许把残账报成总数
  const n = (count: number): string => (node.truncated ? `至少 ${count}` : `${count}`)

  // 状态播报:这层打开被拒(多半是 Windows 锁住的系统文件夹),不是空的,也不用看
  if (node.truncated && fileCount === 0 && directDirs === 0) {
    return { icon: 'lock', text: '系统保护目录，无法查看，不影响使用' }
  }

  // 状态播报:真探过且空就是空,哪怕名字叫 config 也不许喊"配置间"别名
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

  // 词根词典:业务起的名(scanner/summarizer)按词根给个身份词
  const dirWords = translateName(node.name)
  if (dirWords) return { icon: 'folder', text: dirWords }

  // 状态播报:分级扫描还没展开这层,老实说"还没展开",别让人以为是个空文件夹
  if (node.lazy) {
    return { icon: 'folder', text: '还没展开，点击查看' }
  }

  // 全是文字资料、一份代码没有
  if (
    fileCount > 0 &&
    extCounts.size > 0 &&
    [...extCounts.keys()].every((ext) => DOC_EXTS.has(ext))
  ) {
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
      child.typeIcon = resolveFileTypeIcon(child)
      const summary = summarizeFile(child)
      if (summary) child.summary = summary
      tally.fileCount++
      const ext = child.ext || '(无后缀)'
      tally.extCounts.set(ext, (tally.extCounts.get(ext) ?? 0) + 1)
      const lang = child.language?.name
      if (lang) tally.byLang.set(lang, (tally.byLang.get(lang) ?? 0) + 1)
    } else {
      tally.directDirs++
      const sub = tallyDir(child) // 先给子目录打标签,顺带收其子树合计
      tally.fileCount += sub.fileCount
      for (const [lang, count] of sub.byLang)
        tally.byLang.set(lang, (tally.byLang.get(lang) ?? 0) + count)
      for (const [ext, count] of sub.extCounts)
        tally.extCounts.set(ext, (tally.extCounts.get(ext) ?? 0) + count)
    }
  }
  node.summary = summarizeDir(
    node,
    tally.directDirs,
    tally.fileCount,
    tally.byLang,
    tally.extCounts
  )
  return tally
}

/**
 * 给整棵扫描树打大白话标签(原地写进每个节点的 summary;档位1的文件可以留空)。
 * 纯内存计算,毫秒级;认不出的给诚实话,绝不编。
 */
export function annotateSummaries(tree: ScanDirNode): void {
  tallyDir(tree)
}
