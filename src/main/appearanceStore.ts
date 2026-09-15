// 外观偏好的本地持久化:存到 userData 下的 appearance.json,跟 ai-config.json 做邻居。
// 路径契约:这是 Electron 自己的配置文件,不涉及项目内文件,不经过 joinRoot。
// 同步读通道(atlas:appearance-get-sync)是给 preload 首帧用的:页面脚本跑之前就得把
// 外观定下来,不然先按默认画一帧再换皮,界面会白闪 —— 几 KB 的 JSON 同步读,开销可忽略。
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Appearance } from '../shared/appearancePrefs.ts'
import { sanitizeAppearance } from '../shared/appearancePrefs.ts'

export function appearanceFilePath(userDataDir: string): string {
  // 用下划线前缀:这不是项目文件,避免和扫描出的节点混淆(与 ai-config.json 同理)
  return join(userDataDir, 'appearance.json')
}

/** 读存档:文件不存在/烂了 → null(表示「从没配过」,首启迁移看这个信号) */
function readStore(userDataDir: string): Appearance | null {
  try {
    const raw = readFileSync(appearanceFilePath(userDataDir), 'utf8')
    return sanitizeAppearance(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function loadAppearanceFile(userDataDir: string): Promise<Appearance | null> {
  return readStore(userDataDir)
}

/** 首帧同步读(preload sendSync 专用):文件小,一次同步读换不白闪,值 */
export function loadAppearanceFileSync(userDataDir: string): Appearance | null {
  return readStore(userDataDir)
}

export async function saveAppearanceFile(userDataDir: string, a: Appearance): Promise<void> {
  await fs.writeFile(appearanceFilePath(userDataDir), JSON.stringify(a, null, 2), 'utf8')
}
