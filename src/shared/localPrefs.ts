/**
 * localStorage 读写小件(P2-14 公共件,renderer 和 preload 共用):
 * 读 = 坏 JSON 兜底回 fallback;写 = 失败静默(记偏好是锦上添花,不该惊动界面)。
 * 三种存法都是老档既有格式,不许改:对象走 JSON、数字走裸串、开关旗走 'on'/'off'。
 */

/** 对象档:JSON 存取 */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 写不进就算了
  }
}

/** 数字档:裸串存取(0 和读不动的都当没记过) */
export function readNumPref(key: string, fallback: number): number {
  const n = Number(localStorage.getItem(key))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function writeNumPref(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    // 同上
  }
}

/** 开关旗:'on'/'off' 裸串,没记过回 fallback */
export function readFlagPref(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === 'on'
}

export function writeFlagPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // 同上
  }
}
