// 外观偏好的公共账(类型 + 清洗 + 首启迁移决策,纯函数零 DOM):
// 渲染层(appearance.ts)和主进程落盘(appearanceStore)共用同一份清洗规则,
// 谁也不许私造一份,不然「存进去的」和「读出来的」会分家。
// 偏好本体存主进程的 appearance.json(userData 下,跟 ai-config.json 做邻居);
// localStorage 里的旧存档由首启迁移收编,收编完就清掉 —— 从此外观不再按端口分仓。

import { NEUTRAL_PALETTE } from './appearancePalette.ts'

export type AppearanceMode = 'auto' | 'light' | 'dark'
/** preset 和自定义色互斥:选了预设就清空自定义色,点「自定义」才进 custom 档 */
export type AppearancePreset = 'default' | 'blue' | 'custom'

export interface Appearance {
  mode: AppearanceMode
  preset: AppearancePreset
  /** 自定义主题色(#rrggbb);不设就跟预设走 */
  accent: string | null
  /** 自定义辅助色(#rrggbb);不设就跟预设走 */
  secondary: string | null
  /** 自定义底板色(#rrggbb);不设就走石墨中性底(仅自定义档生效) */
  base: string | null
}

/** 配色预设:石墨 = 默认无色皮(不写任何内联,样式表灰阶说了算);
 *  雾空蓝 = 老默认皮的回归色(accent 一族照旧派生,画布也泛蓝调);
 *  想玩别的色走「自定义」档,种子永远是石墨 */
export const COLOR_PRESETS: Array<{
  key: AppearancePreset
  name: string
  accent: string
  secondary: string
}> = [
  // accent/secondary 即暗色样式表真值(户口在 shared/appearancePalette 的 seed):
  // 进自定义档时种子是它俩,保证「自定义默认」和石墨像素级一致
  {
    key: 'default',
    name: '石墨',
    accent: NEUTRAL_PALETTE.seed.accent,
    secondary: NEUTRAL_PALETTE.seed.secondary
  },
  { key: 'blue', name: '雾空蓝', accent: '#147dcc', secondary: '#5ac5db' }
]

export function defaultAppearance(): Appearance {
  return { mode: 'auto', preset: 'default', accent: null, secondary: null, base: null }
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

/** 陌生存档清洗:字段不认识/越界一律回默认,坏了就当没配过,绝不炸界面 */
export function sanitizeAppearance(raw: unknown): Appearance {
  if (typeof raw !== 'object' || raw === null) return defaultAppearance()
  const p = raw as Record<string, unknown>
  return {
    mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : 'auto',
    preset: p.preset === 'custom' || p.preset === 'blue' ? p.preset : 'default',
    accent: isHexColor(p.accent) ? p.accent : null,
    secondary: isHexColor(p.secondary) ? p.secondary : null,
    base: isHexColor(p.base) ? p.base : null
  }
}

/** 首启定值(纯函数,自测覆盖):
 *  主进程存档在 → 听主进程的,localStorage 的旧档直接作废;
 *  主进程没存过、localStorage 有旧档 → 清洗旧档当当前值,并要求迁移(写进主进程文件);
 *  两头都空 → 全默认,不迁移 */
export function resolveAppearanceStartup(opts: {
  stored: Appearance | null
  legacyRaw: string | null
}): { value: Appearance; migrate: boolean } {
  if (opts.stored) return { value: opts.stored, migrate: false }
  if (opts.legacyRaw) {
    try {
      const legacy = sanitizeAppearance(JSON.parse(opts.legacyRaw))
      // 全默认的旧档不值得迁移(等价于没配过),免得用户目录多一个没用的文件
      const isDefault =
        legacy.mode === 'auto' &&
        legacy.preset === 'default' &&
        !legacy.accent &&
        !legacy.secondary &&
        !legacy.base
      if (!isDefault) return { value: legacy, migrate: true }
    } catch {
      // 旧档烂了就当没配过
    }
  }
  return { value: defaultAppearance(), migrate: false }
}
