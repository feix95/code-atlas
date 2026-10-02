// 画布 iframe 的文档:与规格包同一批生成函数,样式内联(所见即所导出)。
// 拖动中只替换 tokens 那段 <style> 的正文,不重载页面,保持 60fps 跟手。
import { boardBody, boardCss, boardValueText } from '@shared/uiFrame/board'
import { benchBody, BENCH_RULES } from '@shared/uiFrame/benchBoard'
import {
  compStyleKey,
  htmlDocument,
  pageFor,
  styleTexts,
  tokensCss,
  WALL_STYLES,
  wallBody
} from '@shared/uiFrame/documents'
import { RECIPES } from '@shared/uiFrame/recipes'
import { rulesCss } from '@shared/uiFrame/recipes/kit'
import type { UiFrameDoc } from '@shared/uiFrame/types'
import { canvasFontsCss, iconLookup } from './assets'

export type CanvasView = 'wall' | 'board' | 'bench'

export const VIEW_LABEL: Record<CanvasView, string> = {
  bench: '底板',
  wall: '零件墙',
  board: '变量板'
}

/** 变量板只加载变量与自身样式,不带组件/页面样式 */
const BOARD_STYLES = ['fonts', 'tokens', 'reset', 'board']
/** 底板拼装:全量组件样式(任何零件都可能上板)+ 板面规则;'bench' 键画布专属不导出 */
const BENCH_STYLES = [
  'fonts',
  'tokens',
  'reset',
  ...RECIPES.map((r) => compStyleKey(r.id)),
  'bench'
]

let fontsCache: string | null = null
function fonts(): string {
  fontsCache ??= canvasFontsCss()
  return fontsCache
}

export function canvasHtml(doc: UiFrameDoc, view: CanvasView): string {
  // 变量板/底板是画布专属视图:样式不进规格包,单独一段 <style>
  const texts = styleTexts(doc, fonts())
  texts['board'] = `/* 变量板 · 画布专属,不导出 */\n\n${rulesCss(boardCss())}\n`
  texts['bench'] = `/* 底板拼装 · 画布专属,不导出 */\n\n${rulesCss(BENCH_RULES)}\n`
  const page = pageFor(doc.platform)
  // 底板上摆了零件 → 渲染零件板;还没摆 → 模板示例页(空白起步的空态由画布外层盖)
  const benchBoard = view === 'bench' && doc.placed.length > 0
  const body =
    view === 'wall'
      ? wallBody()
      : view === 'board'
        ? boardBody(doc)
        : benchBoard
          ? [benchBody(doc)]
          : page.body
  const styles =
    view === 'wall'
      ? WALL_STYLES
      : view === 'board'
        ? BOARD_STYLES
        : benchBoard
          ? BENCH_STYLES
          : page.styles
  return htmlDocument({
    title: VIEW_LABEL[view],
    body,
    styles,
    ctx: { mode: 'canvas', icons: doc.icons, lookup: iconLookup, custom: doc.customIcons },
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
