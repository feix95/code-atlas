// 内联标题改名(内联标题改名锤):Obsidian 式点标题改文件名,三处同吃一本账 ——
// 标题显示(fileBaseName)、提交前轻校验(fileBaseError)、改名回执(RenameOutcome)。
// 权威校验在主进程 renameTextFile;这里供渲染层就地挡一眼 + 主进程复核,两边同一份口径。

/** Windows 文件名禁字:全平台一视同仁地拦,免得改了名到另一台机器打不开 */
const BAD_CHARS = /[<>:"/\\|?*]/
/** 文件名长度保守上限(Windows 路径总账 260,名字留足余量) */
const BASE_MAX_CHARS = 120

/** 文件名 → 内联标题显示的基础名:掐尾去扩展名;'.env' 这类点开头文件回 ''(不摆标题) */
export function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/** 文件名 → 小写扩展名(含点,与扫描器 extname 同口径);'.env' 回 '' */
export function fileExtOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 不可见控制符体检(换行/制表/删除键这类):贴进来的名字混进一个都过不了 */
function hasControlChar(v: string): boolean {
  for (const ch of v) if (ch < ' ') return true
  return false
}

/**
 * 改名输入的基础名体检:合法回 null,非法回一句人话(显示在预览窗的提示条)。
 * 只管主名不含扩展名这一截;扩展名由系统保留,用户改不着。
 */
export function fileBaseError(base: string): string | null {
  const v = base.trim()
  if (v === '') return '名字不能是空的'
  if (BAD_CHARS.test(v)) return '名字里有 Windows 不认的字符:不能带 < > : " / \\ | ? *'
  if (hasControlChar(v)) return '名字里混进了看不见的字符,重打一遍试试'
  if (v === '.' || v === '..') return '这个名字是系统保留的,用不了'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(v)) {
    return '这个名字是 Windows 保留的设备名,换一个'
  }
  if (v.endsWith('.') || v.endsWith(' ')) return '名字不能以点或空格结尾(Windows 会偷偷吃掉)'
  if (v.length > BASE_MAX_CHARS) return `名字太长了,${BASE_MAX_CHARS} 个字以内`
  return null
}

/**
 * 改名回执(渲染层口径):ok 带新户口(relPath 以 '/' 分隔、name 含扩展名),
 * 不然带一句人话报错 —— 标题编辑件按它决定收不收官、提示条亮什么字。
 */
export type RenameOutcome =
  { ok: true; relPath: string; name: string } | { ok: false; error: string }
