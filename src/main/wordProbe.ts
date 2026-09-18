// ── 划词问一问(2026-09-18 二期)──
// 任意软件里选中文字 → 按全局热键 → 小探针弹气泡,划词直接带进去问。
// 机制和右键问一问不同(那是注册表),这边走:全局热键 → 模拟 Ctrl+C 抓取
// 当前活动窗口的选中文本 → 气泡输入框预填(可删可改)。
// 剪贴板礼貌原则(需求表立的):抓之前备份原内容,抓完恢复原样 —— 绝不因为
// 问了一句话就把人家复制着的东东弄丢。平时绝不碰剪贴板,热键那一刻才碰。

import { clipboard, globalShortcut } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addDevLog } from '../shared/devlog.ts'
import { createHotkeyBinder, isFreshGrab, parseWordProbePrefs, validateAccelerator, WORD_PROBE_DEFAULT, type WordProbePrefs } from '../shared/wordProbe.ts'

const run = promisify(execFile)

/** 存档文件(userData/word-probe.json):开关 + 组合键 */
function prefsPath(dir: string): string {
  return join(dir, 'word-probe.json')
}

export function readWordProbePrefs(dir: string): WordProbePrefs {
  const file = prefsPath(dir)
  if (!existsSync(file)) return { ...WORD_PROBE_DEFAULT }
  try {
    return parseWordProbePrefs(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return { ...WORD_PROBE_DEFAULT }
  }
}

export function writeWordProbePrefs(dir: string, prefs: WordProbePrefs): void {
  try {
    writeFileSync(prefsPath(dir), JSON.stringify(prefs, null, 2), 'utf8')
  } catch {
    // 安静放过:记偏好是锦上添花
  }
}

/** 模拟 Ctrl+C:借 Windows 自带的 WScript.Shell SendKeys,发到前台活动窗口。
 * 起个 PowerShell 子进程(约一两百毫秒),零新依赖;^c 就是 Ctrl+C。 */
async function sendCopyKeystroke(): Promise<void> {
  await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', "$ws = New-Object -ComObject wscript.shell; $ws.SendKeys('^c')"],
    { windowsHide: true, timeout: 5000 }
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 给模拟按键留的落键时间;太短抓不到,太长热键显得迟钝 */
const GRAB_SETTLE_MS = 280

// 模块内两个活户口径:initWordProbe 时注入一次,之后改键/拨开关都复用
let activeDir = ''
let deliverText: ((text: string) => void) | null = null

// 热键账房(幽灵热键修复):记住上次真注册的那只键,apply 时精确摘它 ——
// 不再广撒网摘「默认 + 新键」,换键/关闭后旧键不再挂系统上继续偷发 Ctrl+C。
// 注册失败(被别的软件占了)记一笔后台日志、老实回 false,不静默失效
const bindHotkey = createHotkeyBinder(
  { register: (acc, cb) => globalShortcut.register(acc, cb), unregister: (acc) => globalShortcut.unregister(acc) },
  (acc) => addDevLog('system', `划词热键 ${acc} 没挂上(可能被别的软件占了):去设置页换一个组合键`)
)

/** 按档位挂热键:先摘上次注册的那只再挂新的;被占了老实回 false */
function applyWordProbeHotkey(prefs: WordProbePrefs): boolean {
  return bindHotkey(prefs, () => {
    void grabAndDeliver().catch(() => {})
  })
}

/** 热键触发:备份剪贴板 → 模拟 Ctrl+C → 等落键 → 读到新文本 → 恢复原样 → 交给气泡 */
async function grabAndDeliver(): Promise<void> {
  const text = await grabSelection(activeDir)
  if (text && deliverText) deliverText(text)
}

/** 抓取本体:整个过程只在热键触发时发生,平时绝不碰剪贴板。
 * Electron 44 的剪贴板 API 全异步(对齐 Web 标准),read() 拿到的条目原样备份、
 * write() 原子写回 —— 文本/图片/富文本一起还原,礼貌原则比逐格式手抄更彻底。 */
async function grabSelection(stateDir: string): Promise<string | null> {
  const backup = await clipboard.read()
  const backupText = await clipboard.readText()
  try {
    await sendCopyKeystroke()
    await sleep(GRAB_SETTLE_MS)
    const grabbed = await clipboard.readText()
    if (!isFreshGrab(grabbed, backupText)) return null
    // 抓取期间用户正好把开关关了的边缘:尊重最新档位,不弹
    if (!readWordProbePrefs(stateDir).enabled) return null
    return grabbed
  } finally {
    // 恢复原样:备份里有什么就还什么,一点不多一点不少
    await clipboard.write(backup).catch(() => {})
  }
}

/** 启动时按存档挂热键(存档坏了走默认);抓到的文字由 onText 交给气泡 */
export function initWordProbe(stateDir: string, onText: (text: string) => void): void {
  activeDir = stateDir
  deliverText = onText
  applyWordProbeHotkey(readWordProbePrefs(stateDir))
}

/** 校验并落档 + 重挂热键:设置页改键/拨开关走这条;失败时档位不变、原热键照旧 */
export function setWordProbePrefs(stateDir: string, prefs: WordProbePrefs): { ok: boolean; message?: string } {
  if (!validateAccelerator(prefs.accelerator)) {
    return { ok: false, message: '这个组合键不行:要带 Ctrl 或 Alt,主键用字母、数字或 F 键' }
  }
  const ok = applyWordProbeHotkey(prefs)
  if (!ok && prefs.enabled) return { ok: false, message: `${prefs.accelerator} 被别的软件占了,换个组合键试试` }
  writeWordProbePrefs(stateDir, prefs)
  return { ok: true }
}
