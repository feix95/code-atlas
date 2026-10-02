// 画布设备预设(§5.4):平台 → 逻辑像素尺寸档 + 外框装饰参数(状态栏 / 灵动岛 / 底部手势条)。
// 这些数值是设备外观数据,不是设计变量;进 design.json 只是记录画布口径。
import type { UiFrameDoc, UiPlatform } from './types.ts'

export interface DevicePreset {
  id: string
  platform: UiPlatform
  label: string
  width: number
  height: number
  /** 手机状态栏区高(逻辑像素);桌面为 0 */
  statusBar: number
  /** 底部手势条/安全区高;桌面为 0 */
  homeBar: number
  /** 顶部居中灵动岛胶囊 */
  island: boolean
  isDefault?: boolean
}

export const DEVICES: DevicePreset[] = [
  {
    id: 'desktop-1280',
    platform: 'desktop',
    label: '1280 × 800(默认)',
    width: 1280,
    height: 800,
    statusBar: 0,
    homeBar: 0,
    island: false,
    isDefault: true
  },
  {
    id: 'desktop-1440',
    platform: 'desktop',
    label: '1440 × 900',
    width: 1440,
    height: 900,
    statusBar: 0,
    homeBar: 0,
    island: false
  },
  {
    id: 'desktop-1920',
    platform: 'desktop',
    label: '1920 × 1080',
    width: 1920,
    height: 1080,
    statusBar: 0,
    homeBar: 0,
    island: false
  },
  {
    id: 'phone-360',
    platform: 'phone',
    label: '360 × 800 · Android 常见',
    width: 360,
    height: 800,
    statusBar: 28,
    homeBar: 24,
    island: false
  },
  {
    id: 'phone-390',
    platform: 'phone',
    label: '390 × 844 · iPhone(默认)',
    width: 390,
    height: 844,
    statusBar: 54,
    homeBar: 34,
    island: true,
    isDefault: true
  },
  {
    id: 'phone-430',
    platform: 'phone',
    label: '430 × 932 · iPhone Pro Max',
    width: 430,
    height: 932,
    statusBar: 59,
    homeBar: 34,
    island: true
  }
]

export function devicesFor(platform: UiPlatform): DevicePreset[] {
  return DEVICES.filter((d) => d.platform === platform)
}

export function defaultDeviceId(platform: UiPlatform): string {
  const found = DEVICES.find((d) => d.platform === platform && d.isDefault)
  return (found ?? devicesFor(platform)[0]).id
}

/** 方案的设备预设;设备 id 与平台对不上时回平台默认档(老方案/手改的 design.json 兜底) */
export function deviceFor(doc: Pick<UiFrameDoc, 'platform' | 'device'>): DevicePreset {
  const hit = DEVICES.find((d) => d.id === doc.device && d.platform === doc.platform)
  return hit ?? DEVICES.find((d) => d.id === defaultDeviceId(doc.platform))!
}

/** 设备 id 是否合法且属于该平台(导入解析用) */
export function isDeviceId(platform: UiPlatform, id: unknown): id is string {
  return typeof id === 'string' && DEVICES.some((d) => d.platform === platform && d.id === id)
}
