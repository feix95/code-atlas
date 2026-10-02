// 零件注册表(M3-a):零件盒拖上底板的「默认形态」——每个组件一个样板节点。
// 拖放/双击往 doc.placed 里记 {recipe, x, y};底板按这份表把零件渲染出来。
// 新增组件:配方写好后来这里登记一个默认实例即可上板。
import type { PageNode } from './types.ts'

export interface PartDef {
  /** 配方 id(= RECIPES 里的组件 id;底板通过它找样板与样式) */
  id: string
  /** 零件盒/选中态显示名 */
  label: string
  /** 上板时的默认样板节点 */
  node: () => PageNode
}

export const PART_DEFS: PartDef[] = [
  {
    id: 'button',
    label: '按钮',
    node: () => ({
      tag: 'button',
      cls: 'btn btn--solid',
      attrs: { type: 'button' },
      icon: 'demo-button',
      text: '按钮'
    })
  },
  {
    id: 'icon-button',
    label: '图标按钮',
    node: () => ({
      tag: 'button',
      cls: 'ibtn ibtn--ghost',
      attrs: { type: 'button', 'aria-label': '图标按钮' },
      icon: 'demo-ibtn'
    })
  },
  {
    id: 'input',
    label: '输入框',
    node: () => ({
      tag: 'label',
      cls: 'ipt-box',
      children: [
        { tag: 'span', cls: 'ipt-ic', icon: 'demo-input' },
        { tag: 'input', cls: 'ipt', attrs: { type: 'text', placeholder: '请输入内容' } }
      ]
    })
  },
  {
    id: 'checkbox',
    label: '复选框',
    node: () => ({
      tag: 'label',
      cls: 'chk',
      children: [
        { tag: 'input', cls: 'chk__in', attrs: { type: 'checkbox', checked: '' } },
        { tag: 'span', cls: 'chk__box', icon: 'demo-check' }
      ]
    })
  },
  {
    id: 'switch',
    label: '开关',
    node: () => ({
      tag: 'label',
      cls: 'sw',
      children: [
        { tag: 'input', cls: 'sw__in', attrs: { type: 'checkbox', checked: '' } },
        { tag: 'span', cls: 'sw__thumb' }
      ]
    })
  },
  {
    id: 'tabs',
    label: '页签',
    node: () => {
      const tab = (text: string, selected = false): PageNode => ({
        tag: 'button',
        cls: 'tab',
        attrs: { type: 'button', ...(selected ? { 'aria-selected': 'true' } : {}) },
        text
      })
      return {
        tag: 'div',
        cls: 'tabs',
        children: [tab('页签一'), tab('页签二', true), tab('页签三')]
      }
    }
  },
  {
    id: 'card',
    label: '卡片',
    node: () => ({
      tag: 'div',
      cls: 'card',
      children: [
        { tag: 'div', cls: 'card__icon', icon: 'demo-card' },
        { tag: 'h3', cls: 'card__title', text: '卡片标题' },
        { tag: 'p', cls: 'card__text', text: '卡片说明文字,用来展示标题、正文和圆角高度。' }
      ]
    })
  },
  {
    id: 'list-row',
    label: '列表行',
    node: () => ({
      tag: 'div',
      cls: 'li',
      children: [
        { tag: 'span', cls: 'li__lead', icon: 'demo-li' },
        {
          tag: 'div',
          cls: 'li__main',
          children: [{ tag: 'div', cls: 'li__title', text: '列表标题' }]
        },
        { tag: 'span', cls: 'li__trail', icon: 'demo-arrow' }
      ]
    })
  },
  {
    id: 'tooltip',
    label: '提示气泡',
    node: () => ({
      tag: 'span',
      cls: 'tip',
      text: '提示内容',
      children: [{ tag: 'span', cls: 'tip__arrow' }]
    })
  }
]

export const PART_MAP: Record<string, PartDef> = Object.fromEntries(PART_DEFS.map((p) => [p.id, p]))

/** 配方 id → 样板节点;未注册回 null(底板跳过并忽略,不挡渲染) */
export function partNode(id: string): PageNode | null {
  return PART_MAP[id]?.node() ?? null
}
