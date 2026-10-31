// 关系图谱的文字:标签截断、字体读数和按绘制字体测量宽度。
// 容器布局要给标签留真实宽度,所以测量必须和 Canvas 绘制用同一份字体设置。
import { GRAPH_LABEL } from './graphConfig.ts'

export interface Typography {
  fontPx: number
  fontFamily: string
}

export function readTypography(): Typography {
  const root = getComputedStyle(document.documentElement)
  const rootPx = parseFloat(root.fontSize) || 16
  const labelRem = parseFloat(root.getPropertyValue('--graph-label-size')) || 0.6875
  return { fontPx: rootPx * labelRem, fontFamily: getComputedStyle(document.body).fontFamily }
}

export interface LabelMetrics extends Typography {
  /** 单行标签在布局里占的高度 */
  labelHeight: number
  measure: (text: string) => number
}

/** 拿不到 canvas 时按字符数估算:宁可估宽,不要估窄 */
function approximateWidth(fontPx: number): (text: string) => number {
  return (text) => text.length * fontPx * 0.66
}

export function createLabelMetrics(): LabelMetrics {
  const typography = readTypography()
  const labelHeight = typography.fontPx * GRAPH_LABEL.lineHeight
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) {
    return { ...typography, labelHeight, measure: approximateWidth(typography.fontPx) }
  }
  ctx.font = `${typography.fontPx}px ${typography.fontFamily}`
  return { ...typography, labelHeight, measure: (text) => ctx.measureText(text).width }
}

export function truncateLabel(text: string): string {
  return text.length > GRAPH_LABEL.maxChars ? text.slice(0, GRAPH_LABEL.maxChars - 1) + '…' : text
}
