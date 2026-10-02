// 自定义 SVG 图标(M3-e):用户导入的 SVG 文本随方案走(design.json 内嵌、
// 规格包/zip 落 assets/icons/custom-<名>.svg)。槽位值形如 `custom:<名>`。
// 安全边界:导入即消毒——剥脚本、事件属性、外链资源,只留静态图形。

/** 图标槽位值的自定义前缀:custom:<名> 对应 doc.customIcons[<名>] */
export const CUSTOM_ICON_PREFIX = 'custom:'

/** 自定义图标名的合法字符(与文件名共用口径) */
const CUSTOM_NAME_RE = /^[\w一-龥.-]{1,40}$/

export function isCustomIcon(name: string): boolean {
  return name.startsWith(CUSTOM_ICON_PREFIX)
}

export function customKey(name: string): string {
  return name.slice(CUSTOM_ICON_PREFIX.length)
}

/** 槽位值 → 规格包里 icons/ 下的相对文件名(lucide 原名,custom 加前缀防撞名) */
export function iconSvgRelPath(name: string): string {
  return isCustomIcon(name) ? `icons/custom-${customKey(name)}.svg` : `icons/${name}.svg`
}

// SVG 消毒规则:结构性黑名单——脚本载体、事件属性、外链引用一律拒收或剥掉。
// 只接受以 <svg> 开头、</svg> 收尾的单个元素文本。
const FORBIDDEN_TAG = /<\s*(script|foreignObject|iframe|object|embed|image|use)\b/i
const FORBIDDEN_ATTR = /\s(on[a-z]+|href|xlink:href)\s*=/i
const FORBIDDEN_URL = /(javascript|data\s*:|https?:)/i

/**
 * 消毒用户 SVG:返回可安全内嵌的 <svg> 文本;不干净抛中文错。
 * 规则:根必须 <svg>;不许脚本/外链/图片/事件属性;强制 xmlns 与方形视框。
 */
export function sanitizeSvgIcon(raw: string): string {
  const text = raw.trim()
  if (!/^<svg[\s>]/.test(text) || !/<\/svg>\s*$/.test(text)) {
    throw new Error('只收单个 <svg> 图标的文本')
  }
  if (FORBIDDEN_TAG.test(text)) {
    throw new Error('SVG 里有不被支持的元素(script/image/use 等)')
  }
  if (FORBIDDEN_ATTR.test(text) || FORBIDDEN_URL.test(text)) {
    throw new Error('SVG 里有事件属性或外链引用,已拦截')
  }
  // 规范视图框:没写 viewBox 的图在 24×24 语境里会画飞,给它一个方形视框
  let out = text
  if (!/\sviewBox\s*=/i.test(out)) out = out.replace('<svg', '<svg viewBox="0 0 24 24"')
  if (!/\sxmlns\s*=/i.test(out)) {
    out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return out
}

export function isCustomIconName(name: string): boolean {
  return CUSTOM_NAME_RE.test(name)
}
