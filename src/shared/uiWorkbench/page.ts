// Page(纯逻辑,无 React / DOM):Figma 式「一页 = 一块画布 + 一棵对象树」。
// 画布底色是 Page 的属性,不是对象、不进导出;当前画板(≈ Figma 的 Frame)的尺寸也归 Page 所有。
// 节点归属于某个 Page;节点的增删改走 scene.ts 的 NodeAction,作用于指定 Page。
import {
  ARTBOARD_SIDE_MAX,
  ARTBOARD_SIDE_MIN,
  DEFAULT_ARTBOARD,
  type ArtboardSize
} from './artboard.ts'
import { parseHexColor, sanitizeName } from './node.ts'
import { applyNodeAction, type NodeAction, type SceneNode } from './scene.ts'

/** 画布底色:颜色 6 位小写 hex;不透明度整数 0-100;visible=false 即不画底色(露出底层背景) */
export interface PageBackground {
  color: string
  opacity: number
  visible: boolean
}

export interface Page {
  id: string
  name: string
  background: PageBackground
  artboard: ArtboardSize
  nodes: readonly SceneNode[]
}

export interface PagePatch {
  name?: string
  background?: Partial<PageBackground>
  artboard?: ArtboardSize
}

/** 画布底色默认值(Figma 同款):浅色主题 #f5f5f5、深色主题 #1e1e1e */
export const PAGE_DEFAULT_BACKGROUND: PageBackground = {
  color: '#f5f5f5',
  opacity: 100,
  visible: true
}
export const PAGE_DEFAULT_BACKGROUND_DARK: PageBackground = {
  ...PAGE_DEFAULT_BACKGROUND,
  color: '#1e1e1e'
}

export function defaultPageBackground(isDark: boolean): PageBackground {
  return { ...(isDark ? PAGE_DEFAULT_BACKGROUND_DARK : PAGE_DEFAULT_BACKGROUND) }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function pageSeq(pages: readonly { id: string }[]): number {
  const used = pages.map((p) => Number(/^page-(\d+)$/.exec(p.id)?.[1] ?? 0))
  return Math.max(0, ...used) + 1
}

/** 新页:id/名字序号取现有最大 + 1(删掉的号不复用);底色与画板尺寸继承 inherit(Figma 同款),没有则取默认 */
export function createPage(
  pages: readonly { id: string }[],
  inherit?: Pick<Page, 'background' | 'artboard'>,
  fallback: Pick<Page, 'background' | 'artboard'> = {
    background: PAGE_DEFAULT_BACKGROUND,
    artboard: DEFAULT_ARTBOARD
  }
): Page {
  const seq = pageSeq(pages)
  const source = inherit ?? fallback
  return {
    id: `page-${seq}`,
    name: `页面 ${seq}`,
    background: { ...source.background },
    artboard: { ...source.artboard },
    nodes: []
  }
}

function sanitizeBackground(
  current: PageBackground,
  patch: Partial<PageBackground>
): PageBackground {
  const merged = { ...current, ...patch }
  return {
    color: parseHexColor(merged.color) ?? current.color,
    opacity: clampInt(merged.opacity, 0, 100),
    visible: merged.visible !== false
  }
}

function sanitizeArtboard(next: ArtboardSize): ArtboardSize {
  return {
    width: clampInt(next.width, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX),
    height: clampInt(next.height, ARTBOARD_SIDE_MIN, ARTBOARD_SIDE_MAX)
  }
}

/** 改页属性:名字不能空;底色逐字段校验,非法颜色回退原值;画板尺寸钳到合法边界 */
export function patchPage(pages: readonly Page[], id: string, patch: PagePatch): Page[] {
  return pages.map((p) =>
    p.id !== id
      ? p
      : {
          ...p,
          name: patch.name === undefined ? p.name : sanitizeName(patch.name, p.name),
          background: patch.background
            ? sanitizeBackground(p.background, patch.background)
            : p.background,
          artboard: patch.artboard ? sanitizeArtboard(patch.artboard) : p.artboard
        }
  )
}

/** 对指定页的节点列表落一次 NodeAction;页不存在则原样返回 */
export function applyNodeActionToPage(
  pages: readonly Page[],
  pageId: string,
  action: NodeAction
): Page[] {
  return pages.map((p) => (p.id === pageId ? { ...p, nodes: applyNodeAction(p.nodes, action) } : p))
}

/** 删页:至少保留一页,只剩一页时原样返回 */
export function removePage(pages: readonly Page[], id: string): Page[] {
  return pages.length <= 1 ? [...pages] : pages.filter((p) => p.id !== id)
}

/** 删掉 removedId 后该看哪一页:删的不是当前页则不动;删的是当前页则落到原位置的下一页(没有则上一页) */
export function activeAfterRemove(
  before: readonly Page[],
  removedId: string,
  activeId: string
): string {
  if (before.length <= 1 || removedId !== activeId) return activeId
  const index = before.findIndex((p) => p.id === removedId)
  const rest = before.filter((p) => p.id !== removedId)
  return rest[Math.min(index, rest.length - 1)].id
}

/** 页签位置调整:toIndex = 移动后下标,越界钳到两端 */
export function reorderPage(pages: readonly Page[], id: string, toIndex: number): Page[] {
  const from = pages.findIndex((p) => p.id === id)
  if (from < 0) return [...pages]
  const rest = pages.filter((p) => p.id !== id)
  const to = Math.min(rest.length, Math.max(0, Math.round(toIndex)))
  return [...rest.slice(0, to), pages[from], ...rest.slice(to)]
}

/** 画布底色的 CSS 值:隐藏时返回 null(露出底层默认底板);不透明度写进 alpha */
export function pageBackgroundCss(background: PageBackground): string | null {
  if (!background.visible) return null
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.color.slice(i, i + 2), 16))
  return `rgb(${r} ${g} ${b} / ${background.opacity}%)`
}
