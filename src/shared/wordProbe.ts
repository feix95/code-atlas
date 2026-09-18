/**
 * 划词问一问的纯逻辑(2026-09-18 二期):热键档位的认读、组合键的校验与录制。
 * 渲染层(设置页录制按键)和主进程(注册热键、读存档)共用同一份口径。
 * 边界(需求表已拍板):不做后台剪贴板监听 —— 只在热键触发那一刻才碰剪贴板。
 */

/** 划词问一问的档位:开关 + 全局热键组合键 */
export interface WordProbePrefs {
  enabled: boolean
  accelerator: string
}

/**
 * 抓取判定(纯函数,自测覆盖):读到的新文本和备份不同且非空才算「真抓到了」。
 * 相同 = 没选中任何文字(Ctrl+C 没改变剪贴板),按开放问题第 1 条拍板:完全无反应。
 * 边界:选中的文字恰好等于剪贴板已有内容时也会判成「没抓到」—— 宁可漏弹,不弹空泡。
 */
export function isFreshGrab(grabbed: string, backupText: string): boolean {
  return grabbed.trim() !== '' && grabbed !== backupText
}

/** 出厂默认:Alt+Q(开工前按需求表候选实测过,避开 Alt+Tab/Win 系/输入法切换) */
export const WORD_PROBE_DEFAULT: WordProbePrefs = { enabled: true, accelerator: 'Alt+Q' }

/** Electron 认的修饰键前缀(Shift 不算"够格"的修饰:Shift+字母是打字,不是快捷键) */
const QUALIFYING_MODIFIERS = ['Control', 'Alt', 'Super', 'Meta', 'Command', 'CommandOrControl', 'CmdOrCtrl'] as const

/** 主键的白名单:字母、数字、F1-F12、方向键等导航键;其余(标点/中文)不收 */
function isQualifyingKey(key: string): boolean {
  if (/^[A-Z0-9]$/.test(key)) return true
  if (/^F([1-9]|1[0-2])$/.test(key)) return true
  return ['Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Esc'].includes(key)
}

/** 组合键合法性(纯函数,自测覆盖):必须有够格的修饰键 + 合法主键,两者缺一不可 */
export function validateAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return false
  const [mods, key] = [parts.slice(0, -1), parts[parts.length - 1]!]
  const hasQualifier = mods.some((m) => (QUALIFYING_MODIFIERS as readonly string[]).includes(m))
  return hasQualifier && isQualifyingKey(key)
}

/**
 * 存档认读(纯函数,自测覆盖):形状不对/组合键不合法/开关不是布尔,一律回出厂默认。
 * 旧档里 enabled 合法但 accelerator 不合法,两个都按默认走 —— 半好半坏的档不缝补,口径简单。
 */
export function parseWordProbePrefs(raw: unknown): WordProbePrefs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...WORD_PROBE_DEFAULT }
  const s = raw as Record<string, unknown>
  const enabled = s['enabled']
  const accelerator = typeof s['accelerator'] === 'string' ? s['accelerator'].trim() : ''
  if (typeof enabled === 'boolean' && accelerator && validateAccelerator(accelerator)) {
    return { enabled, accelerator }
  }
  return { ...WORD_PROBE_DEFAULT }
}

/**
 * 设置页录制按键 → Electron 组合键字符串(纯函数,自测覆盖)。
 * 规则:必须带 Ctrl 或 Alt(Shift 单独打字不算数,Win 键系统抢得凶不推荐但允许叠加);
 * 单按 Esc 回 null(取消录制);主键必须是白名单里的(字母/数字/F 键/导航键)。
 */
export function acceleratorFromKeyEvent(e: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  key: string
}): string | null {
  if (e.key === 'Escape') return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('Super')
  if (e.shiftKey) parts.push('Shift')
  // 主键归一:A-Z 大写、数字原样、F 键原样;修饰键单按不构成组合
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
  const normalized = named[key] ?? key
  if (!isQualifyingKey(normalized)) return null
  parts.push(normalized)
  const accelerator = parts.join('+')
  // Shift 不算够格修饰:只有 Shift+X 的一律不收
  const modifiers = parts.slice(0, -1)
  if (modifiers.length === 1 && modifiers[0] === 'Shift') return null
  return validateAccelerator(accelerator) ? accelerator : null
}
