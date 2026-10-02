// 画布 iframe 的文档:与规格包同一批生成函数,样式内联(所见即所导出)。
// 拖动中只替换 tokens 那段 <style> 的正文,不重载页面,保持 60fps 跟手。
import { boardBody, boardCss, boardValueText } from '@shared/uiFrame/board'
import {
  htmlDocument,
  pageFor,
  styleTexts,
  tokensCss,
  WALL_STYLES,
  wallBody
} from '@shared/uiFrame/documents'
import { rulesCss } from '@shared/uiFrame/recipes/kit'
import type { UiFrameDoc } from '@shared/uiFrame/types'
import { canvasFontsCss, iconLookup } from './assets'

export type CanvasView = 'wall' | 'board' | 'page'

export const VIEW_LABEL: Record<CanvasView, string> = {
  wall: '组件墙',
  board: '变量板',
  page: '示例页'
}

/** 变量板只加载变量与自身样式,不带组件/页面样式 */
const BOARD_STYLES = ['fonts', 'tokens', 'reset', 'board']

let fontsCache: string | null = null
function fonts(): string {
  fontsCache ??= canvasFontsCss()
  return fontsCache
}

export function canvasHtml(doc: UiFrameDoc, view: CanvasView): string {
  // 变量板是画布专属视图:样式不进规格包,单独一段 <style>
  const texts = styleTexts(doc, fonts())
  texts['board'] = `/* 变量板 · 画布专属,不导出 */\n\n${rulesCss(boardCss())}\n`
  const page = pageFor(doc.platform)
  const body = view === 'wall' ? wallBody() : view === 'board' ? boardBody(doc) : page.body
  const styles = view === 'wall' ? WALL_STYLES : view === 'board' ? BOARD_STYLES : page.styles
  return htmlDocument({
    title: VIEW_LABEL[view],
    body,
    styles,
    ctx: { mode: 'canvas', icons: doc.icons, lookup: iconLookup },
    styleMode: { kind: 'inline', texts }
  })
}

/** 只换变量:拖动预览与提交后的刷新都走这里 */
export function applyTokens(frameDoc: Document, doc: UiFrameDoc): void {
  const el = frameDoc.querySelector('style[data-uf-style="tokens"]')
  if (el) el.textContent = tokensCss(doc)
  // 变量板读数原地刷新:不重载 iframe,保住滚动位置
  for (const item of frameDoc.querySelectorAll('[data-uf-part^="tok:"]')) {
    const name = item.getAttribute('data-uf-part')?.slice(4) ?? ''
    const val = item.querySelector('.vb-val')
    if (val && doc.tokens[name]) val.textContent = boardValueText(doc, name)
  }
}
