/**
 * 聊天文件链接的检测器:AI 回答里提到的文件,凡是能在扫描树里对上户口的,
 * 标出来给界面画成可点的链接(点了左边开预览);对不上的(模型编的)当普通文字,
 * 绝不给用户一个点了没反应的死链接。
 *
 * 认文件的阶梯(从严到宽):
 * 1. 带路径的(src/ai/index.ts)—— 直接认,精确对上才画;
 * 2. 文件名带后缀(package.json)—— 全项目查无重名才认,重名的一律不画(点了不知道开哪个);
 * 3. 没后缀的裸词(main)—— 一律不认,八成在说别的,不凑热闹。
 *
 * 纯函数零副作用,自测覆盖(scripts/selftest-filelinks.mts)。
 */

/** 目录树的路径索引:建一次,一条回答里查多次 */
export interface FileLinkIndex {
  /** 全部 relPath:键是归一化后的小写(模型大小写/斜杠爱跑偏),值是树里的规范写法 */
  byPath: Map<string, string>
  /** 文件名(必须带后缀)→ 规范 relPath;全项目重名的名字不收录 */
  byName: Map<string, string>
}

/** 一处认下的文件引用:span 盖住原文里的整段记号(路径+行号),relPath 是规范写法 */
export interface FileLinkSpan {
  start: number
  end: number
  relPath: string
  /** 原文带的行号(还没夹逼;越界的由预览窗自己夹到文件边缘) */
  line?: number
}

/** 界面画链接要用的最小上下文:索引 + 点了以后去哪 */
export interface FileLinkTarget {
  index: FileLinkIndex
  onOpen: (relPath: string, line?: number) => void
}

/** relPath 归一:反斜杠收成正斜杠,掐头去尾的 ./、/ ,重复斜杠并成一个 */
function normalizeRelPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
}

function baseName(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash >= 0 ? relPath.slice(slash + 1) : relPath
}

/** 用全部 relPath 建索引;名字必须带后缀,且全项目唯一才进按名索引 */
export function buildFileLinkIndex(paths: string[]): FileLinkIndex {
  const byPath = new Map<string, string>()
  const nameCounts = new Map<string, number>()
  for (const raw of paths) {
    const norm = normalizeRelPath(raw)
    if (norm === '') continue
    byPath.set(norm.toLowerCase(), norm)
    const name = baseName(norm)
    if (!name.includes('.')) continue
    const key = name.toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const byName = new Map<string, string>()
  for (const raw of paths) {
    const norm = normalizeRelPath(raw)
    const name = baseName(norm)
    if (!name.includes('.')) continue
    if ((nameCounts.get(name.toLowerCase()) ?? 0) === 1) byName.set(name.toLowerCase(), norm)
  }
  return { byPath, byName }
}

/**
 * 候选记号:一串连续的路径字符(字母数字 - _ . \ /),后面可选「:行号」,
 * 甚至「:行号:列号」(模型爱学编译器的报错格式)。中英文冒号都收。
 * 候选前面不能还是路径字符(不然 "xsrc/a.ts" 会切出 "src/a.ts" 假阳性)。
 */
const FILE_TOKEN_RE =
  /(?<![A-Za-z0-9_.\-/\\])([A-Za-z0-9_.\-/\\]+)(?:[:：](\d{1,7}))?(?:[:：]\d{1,7})?/g

/**
 * 在一段文字里找全部认得下的文件引用。调用方保证这段文字不含行内代码
 * (`...` 里的字是"展示代码",不是"递文件"),围栏代码块由更外层挡住。
 */
export function findFileLinks(text: string, index: FileLinkIndex): FileLinkSpan[] {
  const spans: FileLinkSpan[] = []
  FILE_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FILE_TOKEN_RE.exec(text)) !== null) {
    let base = m[1]
    // 结尾的句点/斜杠多半是句子标点("见 src/x.ts." 的那颗点),摘掉再查户口
    base = base.replace(/[./]+$/, '')
    if (base === '') continue
    const lineRaw = m[2]
    const norm = normalizeRelPath(base)
    if (norm === '') continue
    let relPath: string | undefined
    if (norm.includes('/')) {
      relPath = index.byPath.get(norm.toLowerCase())
    } else {
      // 没路径的:先按全路径查(根目录文件),再按唯一文件名查
      relPath = index.byPath.get(norm.toLowerCase()) ?? index.byName.get(norm.toLowerCase())
    }
    if (!relPath) continue
    const line = lineRaw !== undefined ? Number(lineRaw) : undefined
    // 结尾标点摘了几颗,span 的终点就缩几格,别把句子里的句点吃进链接里
    const suffixLen = lineRaw !== undefined ? m[0].length - m[1].length : 0
    spans.push({
      start: m.index,
      end: m.index + base.length + suffixLen,
      relPath,
      ...(line !== undefined && line >= 1 ? { line } : {})
    })
  }
  return spans
}
