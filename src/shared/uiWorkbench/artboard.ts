// UI 工作台画板:尺寸单位为逻辑像素(设计数值,跨平台可精确换算);预设与尺寸边界只在这里登记。
// 预设命名用描述性名称,不使用他方商标;每种设备只登记一个方向,另一方向由横竖屏切换对调宽高得到。

import { parseIntegerInput } from './numberInput.ts'

export interface ArtboardSize {
  width: number
  height: number
}

export interface ArtboardPreset extends ArtboardSize {
  id: string
  group: string
  label: string
}

/** 画板单边尺寸边界(逻辑像素,整数) */
export const ARTBOARD_SIDE_MIN = 1
export const ARTBOARD_SIDE_MAX = 8192

export const ARTBOARD_PRESETS: readonly ArtboardPreset[] = [
  { id: 'phone-compact', group: '手机', label: '紧凑手机', width: 360, height: 800 },
  { id: 'phone-standard', group: '手机', label: '标准手机', width: 390, height: 844 },
  { id: 'phone-large', group: '手机', label: '大屏手机', width: 430, height: 932 },
  { id: 'tablet', group: '平板', label: '平板', width: 768, height: 1024 },
  { id: 'desktop-small', group: '电脑', label: '小窗口', width: 1280, height: 800 },
  { id: 'desktop-medium', group: '电脑', label: '中窗口', width: 1440, height: 900 },
  { id: 'desktop-full', group: '电脑', label: '全高清', width: 1920, height: 1080 }
]

export const DEFAULT_ARTBOARD: ArtboardSize = { width: 390, height: 844 }

/** 用户输入的单边尺寸 → 合法整数;非数字返回 null(调用方保留原值) */
export function parseArtboardSide(raw: string): number | null {
  return parseIntegerInput(raw, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
}

/** 画板方向:宽大于高为横屏,其余(含正方形)为竖屏 */
export type ArtboardOrientation = 'portrait' | 'landscape'

export function artboardOrientation(size: ArtboardSize): ArtboardOrientation {
  return size.width > size.height ? 'landscape' : 'portrait'
}

/** 切到指定方向:方向不同则对调宽高(画板不旋转,内容方向不变) */
export function withOrientation(
  size: ArtboardSize,
  orientation: ArtboardOrientation
): ArtboardSize {
  if (artboardOrientation(size) === orientation) return size
  return { width: size.height, height: size.width }
}

/** 当前尺寸对上哪个预设;都对不上即自定义(返回 null) */
export function matchArtboardPreset(size: ArtboardSize): ArtboardPreset | null {
  return ARTBOARD_PRESETS.find((p) => p.width === size.width && p.height === size.height) ?? null
}
