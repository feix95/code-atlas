// 画布 iframe 的文档:与规格包同一批生成函数,样式内联(所见即所导出)。
// 拖动中只替换 tokens 那段 <style> 的正文,不重载页面,保持 60fps 跟手。
import {
  htmlDocument,
  HOME_PAGE,
  PAGE_STYLES,
  styleTexts,
  tokensCss,
  WALL_STYLES,
  wallBody
} from '@shared/uiFrame/documents'
import type { UiFrameDoc } from '@shared/uiFrame/types'
import { canvasFontsCss, iconLookup } from './assets'

export type CanvasView = 'wall' | 'page'

export const VIEW_LABEL: Record<CanvasView, string> = { wall: '组件墙', page: '示例页' }

/** 示例页的设计视口(逻辑像素) */
export const PAGE_VIEWPORT = { width: HOME_PAGE.width, height: HOME_PAGE.height }

let fontsCache: string | null = null
function fonts(): string {
  fontsCache ??= canvasFontsCss()
  return fontsCache
}

export function canvasHtml(doc: UiFrameDoc, view: CanvasView): string {
  return htmlDocument({
    title: VIEW_LABEL[view],
    body: view === 'wall' ? wallBody() : HOME_PAGE.body,
    styles: view === 'wall' ? WALL_STYLES : PAGE_STYLES,
    ctx: { mode: 'canvas', icons: doc.icons, lookup: iconLookup },
    styleMode: { kind: 'inline', texts: styleTexts(doc, fonts()) }
  })
}

/** 只换变量:拖动预览与提交后的刷新都走这里 */
export function applyTokens(frameDoc: Document, doc: UiFrameDoc): void {
  const el = frameDoc.querySelector('style[data-uf-style="tokens"]')
  if (el) el.textContent = tokensCss(doc)
}
