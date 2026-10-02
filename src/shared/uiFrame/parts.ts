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
  },
  {
    id: 'radio',
    label: '单选',
    node: () => ({
      tag: 'label',
      cls: 'rdo',
      children: [
        { tag: 'input', cls: 'rdo__in', attrs: { type: 'radio', checked: '' } },
        { tag: 'span', cls: 'rdo__dot' }
      ]
    })
  },
  {
    id: 'segmented',
    label: '分段控件',
    node: () => ({
      tag: 'div',
      cls: 'seg',
      children: ['日', '周', '月'].map((text, i) => ({
        tag: 'button',
        cls: 'seg__it',
        attrs: { type: 'button', ...(i === 1 ? { 'aria-selected': 'true' } : {}) },
        text
      }))
    })
  },
  {
    id: 'slider',
    label: '滑块',
    node: () => ({
      tag: 'input',
      cls: 'sld',
      attrs: { type: 'range', value: '40', min: '0', max: '100' }
    })
  },
  {
    id: 'select',
    label: '下拉选择',
    node: () => ({
      tag: 'label',
      cls: 'sel-box',
      children: [
        {
          tag: 'select',
          cls: 'sel',
          children: [{ tag: 'option', text: '所有项目' }]
        },
        { tag: 'span', cls: 'sel-ic', icon: 'demo-down' }
      ]
    })
  },
  {
    id: 'stepper',
    label: '步进器',
    node: () => ({
      tag: 'div',
      cls: 'stp',
      children: [
        {
          tag: 'button',
          cls: 'stp__btn',
          attrs: { type: 'button', 'aria-label': '减少' },
          text: '−'
        },
        { tag: 'span', cls: 'stp__val', text: '3' },
        {
          tag: 'button',
          cls: 'stp__btn',
          attrs: { type: 'button', 'aria-label': '增加' },
          text: '+'
        }
      ]
    })
  },
  {
    id: 'rating',
    label: '评分',
    node: () => ({
      tag: 'span',
      cls: 'rate',
      children: [1, 2, 3, 4, 5].map((i) => ({
        tag: 'button',
        cls: 'rate__star',
        attrs: {
          type: 'button',
          'aria-label': `${i} 星`,
          ...(i <= 3 ? { 'aria-pressed': 'true' } : {})
        },
        text: '★'
      }))
    })
  },
  {
    id: 'textarea',
    label: '文本域',
    node: () => ({ tag: 'textarea', cls: 'ta', attrs: { placeholder: '写点什么…' } })
  },
  {
    id: 'search',
    label: '搜索框',
    node: () => ({
      tag: 'label',
      cls: 'srch',
      children: [
        { tag: 'span', cls: 'srch__ic', icon: 'demo-search' },
        { tag: 'input', cls: 'srch__in', attrs: { type: 'search', placeholder: '搜索…' } }
      ]
    })
  },
  {
    id: 'button-group',
    label: '按钮组',
    node: () => ({
      tag: 'div',
      cls: 'bgrp',
      children: ['左对齐', '居中', '右对齐'].map((text, i) => ({
        tag: 'button',
        cls: 'bgrp__it',
        attrs: { type: 'button', 'aria-pressed': i === 1 ? 'true' : 'false' },
        text
      }))
    })
  },
  {
    id: 'link',
    label: '链接',
    node: () => ({ tag: 'a', cls: 'lnk', attrs: { href: '#' }, text: '查看详情' })
  },
  {
    id: 'toast',
    label: '轻提示',
    node: () => ({
      tag: 'div',
      cls: 'toast',
      attrs: { role: 'status' },
      children: [
        { tag: 'span', cls: 'toast__text', text: '已保存' },
        { tag: 'button', cls: 'toast__act', attrs: { type: 'button' }, text: '撤销' }
      ]
    })
  },
  {
    id: 'banner',
    label: '横幅',
    node: () => ({
      tag: 'div',
      cls: 'banner banner--info',
      attrs: { role: 'alert' },
      children: [{ tag: 'span', cls: 'banner__text', text: '新功能上线提示' }]
    })
  },
  {
    id: 'progress',
    label: '进度条',
    node: () => ({
      tag: 'div',
      cls: 'prog',
      attrs: { role: 'progressbar', 'aria-valuenow': '60' },
      children: [{ tag: 'span', cls: 'prog__fill' }]
    })
  },
  {
    id: 'spinner',
    label: '加载圈',
    node: () => ({ tag: 'span', cls: 'spin', attrs: { role: 'progressbar' } })
  },
  {
    id: 'skeleton',
    label: '骨架屏',
    node: () => ({ tag: 'span', cls: 'skl skl--line' })
  },
  {
    id: 'empty',
    label: '空状态',
    node: () => ({
      tag: 'div',
      cls: 'emp',
      children: [
        { tag: 'span', cls: 'emp__icon', icon: 'demo-li' },
        { tag: 'span', cls: 'emp__title', text: '还没有内容' },
        { tag: 'span', cls: 'emp__text', text: '开始添加后,项目会出现在这里。' }
      ]
    })
  },
  {
    id: 'badge',
    label: '徽标',
    node: () => ({ tag: 'span', cls: 'bdg', text: '3' })
  },
  {
    id: 'tag',
    label: '标签',
    node: () => ({
      tag: 'span',
      cls: 'tag',
      children: [
        { tag: 'span', text: '标签' },
        { tag: 'button', cls: 'tag__x', attrs: { type: 'button', 'aria-label': '移除' }, text: '×' }
      ]
    })
  },
  {
    id: 'avatar',
    label: '头像',
    node: () => ({ tag: 'span', cls: 'avt', children: [{ tag: 'span', text: '葵' }] })
  },
  {
    id: 'divider',
    label: '分割线',
    node: () => ({ tag: 'span', cls: 'div', attrs: { role: 'separator' } })
  },
  {
    id: 'appbar',
    label: '顶栏',
    node: () => ({
      tag: 'header',
      cls: 'abar',
      children: [
        { tag: 'span', cls: 'abar__title', text: '产品名' },
        {
          tag: 'nav',
          cls: 'abar__nav',
          children: ['功能', '定价'].map((t) => ({
            tag: 'a',
            cls: 'abar__link',
            attrs: { href: '#' },
            text: t
          }))
        },
        { tag: 'span', cls: 'abar__spacer' }
      ]
    })
  },
  {
    id: 'sidebar',
    label: '侧边导航',
    node: () => ({
      tag: 'nav',
      cls: 'sbar',
      children: ['概览', '项目', '设置'].map((t, i) => ({
        tag: 'a',
        cls: 'sbar__it',
        attrs: { href: '#', ...(i === 0 ? { 'aria-current': 'page' } : {}) },
        children: [
          { tag: 'span', cls: 'sbar__ic', icon: i === 0 ? 'demo-card' : 'demo-li' },
          { tag: 'span', text: t }
        ]
      }))
    })
  },
  {
    id: 'rail',
    label: '图标栏',
    node: () => ({
      tag: 'nav',
      cls: 'rail',
      children: ['demo-card', 'demo-li', 'demo-ibtn'].map((ic, i) => ({
        tag: 'button',
        cls: 'rail__it',
        attrs: { type: 'button', ...(i === 0 ? { 'aria-current': 'page' } : {}) },
        children: [{ tag: 'span', cls: 'rail__ic', icon: ic as PageNode['icon'] }]
      }))
    })
  },
  {
    id: 'bottombar',
    label: '底部页签栏',
    node: () => ({
      tag: 'nav',
      cls: 'bbar',
      children: ['首页', '消息', '我的'].map((t, i) => ({
        tag: 'button',
        cls: 'bbar__it',
        attrs: { type: 'button', ...(i === 0 ? { 'aria-selected': 'true' } : {}) },
        children: [
          { tag: 'span', cls: 'bbar__ic', icon: i === 0 ? 'demo-card' : 'demo-li' },
          { tag: 'span', text: t }
        ]
      }))
    })
  },
  {
    id: 'breadcrumb',
    label: '面包屑',
    node: () => ({
      tag: 'nav',
      cls: 'crumb',
      attrs: { 'aria-label': '面包屑' },
      children: [
        { tag: 'a', cls: 'crumb__link', attrs: { href: '#' }, text: '首页' },
        { tag: 'span', cls: 'crumb__sep', text: '/' },
        { tag: 'span', cls: 'crumb__cur', attrs: { 'aria-current': 'page' }, text: '设置' }
      ]
    })
  },
  {
    id: 'pagination',
    label: '分页',
    node: () => ({
      tag: 'nav',
      cls: 'pgn',
      attrs: { 'aria-label': '分页' },
      children: ['1', '2', '3'].map((t, i) => ({
        tag: 'button',
        cls: 'pgn__it',
        attrs: { type: 'button', ...(i === 0 ? { 'aria-current': 'page' } : {}) },
        text: t
      }))
    })
  },
  {
    id: 'steps',
    label: '步骤条',
    node: () => ({
      tag: 'nav',
      cls: 'stps',
      attrs: { 'aria-label': '进度' },
      children: [
        {
          tag: 'span',
          cls: 'stps__it',
          attrs: { 'data-state': 'done' },
          children: [
            { tag: 'span', cls: 'stps__dot', text: '✓' },
            { tag: 'span', text: '填写' }
          ]
        },
        { tag: 'span', cls: 'stps__link' },
        {
          tag: 'span',
          cls: 'stps__it',
          attrs: { 'aria-current': 'step' },
          children: [
            { tag: 'span', cls: 'stps__dot', text: '2' },
            { tag: 'span', text: '确认' }
          ]
        }
      ]
    })
  },
  {
    id: 'fab',
    label: '悬浮按钮',
    node: () => ({
      tag: 'button',
      cls: 'fab',
      attrs: { type: 'button', 'aria-label': '新建' },
      icon: 'demo-button'
    })
  },
  {
    id: 'menu',
    label: '下拉菜单',
    node: () => ({
      tag: 'div',
      cls: 'menu',
      attrs: { role: 'menu' },
      children: ['重命名', '复制', '删除'].map((t) => ({
        tag: 'button',
        cls: 'menu__it',
        attrs: { type: 'button', role: 'menuitem' },
        text: t
      }))
    })
  },
  {
    id: 'popover',
    label: '气泡卡',
    node: () => ({
      tag: 'div',
      cls: 'pop',
      children: [
        { tag: 'p', cls: 'pop__title', text: '标题' },
        { tag: 'p', cls: 'pop__text', text: '气泡卡的说明内容。' }
      ]
    })
  },
  {
    id: 'dialog',
    label: '对话框',
    node: () => ({
      tag: 'div',
      cls: 'dlg',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '对话框' },
      children: [
        { tag: 'h3', cls: 'dlg__title', text: '标题' },
        { tag: 'p', cls: 'dlg__text', text: '对话框正文内容。' }
      ]
    })
  },
  {
    id: 'drawer',
    label: '抽屉',
    node: () => ({
      tag: 'aside',
      cls: 'dwr',
      attrs: { 'aria-label': '详情面板' },
      children: [
        { tag: 'h3', cls: 'dwr__title', text: '详情' },
        { tag: 'p', cls: 'dwr__text', text: '抽屉面板内容。' }
      ]
    })
  },
  {
    id: 'sheet',
    label: '底部面板',
    node: () => ({
      tag: 'div',
      cls: 'sht',
      attrs: { role: 'dialog', 'aria-label': '底部面板' },
      children: [{ tag: 'span', cls: 'sht__grab' }]
    })
  },
  {
    id: 'action-sheet',
    label: '动作菜单',
    node: () => ({
      tag: 'div',
      cls: 'ash',
      children: [
        {
          tag: 'div',
          cls: 'ash__group',
          children: ['分享', '取消'].map((t, i) => ({
            tag: 'button',
            cls: `ash__it${i === 1 ? ' ash__it--cancel' : ''}`,
            attrs: { type: 'button' },
            text: t
          }))
        }
      ]
    })
  },
  {
    id: 'collapse',
    label: '折叠面板',
    node: () => ({
      tag: 'div',
      cls: 'acdn',
      children: [
        {
          tag: 'div',
          cls: 'acdn__it',
          attrs: { 'data-open': 'true' },
          children: [
            {
              tag: 'button',
              cls: 'acdn__head',
              attrs: { type: 'button', 'aria-expanded': 'true' },
              children: [
                { tag: 'span', text: '折叠标题' },
                { tag: 'span', cls: 'acdn__ic', icon: 'demo-down' }
              ]
            },
            {
              tag: 'div',
              cls: 'acdn__body',
              children: [{ tag: 'p', cls: 'acdn__text', text: '展开的内容区。' }]
            }
          ]
        }
      ]
    })
  },
  {
    id: 'table',
    label: '表格',
    node: () => ({
      tag: 'table',
      cls: 'tbl',
      children: [
        {
          tag: 'thead',
          children: [{ tag: 'tr', children: ['名称', '状态'].map((t) => ({ tag: 'th', text: t })) }]
        },
        {
          tag: 'tbody',
          children: [
            { tag: 'tr', children: ['落地页', '已发布'].map((t) => ({ tag: 'td', text: t })) }
          ]
        }
      ]
    })
  },
  {
    id: 'tree',
    label: '树形列表',
    node: () => ({
      tag: 'div',
      cls: 'tree',
      attrs: { role: 'tree' },
      children: [
        {
          tag: 'div',
          cls: 'tree__it',
          attrs: { role: 'treeitem', 'data-depth': '0' },
          children: [
            { tag: 'span', cls: 'tree__ic', icon: 'demo-down' },
            { tag: 'span', text: '文档' }
          ]
        },
        {
          tag: 'div',
          cls: 'tree__it',
          attrs: { role: 'treeitem', 'data-depth': '1' },
          children: [
            { tag: 'span', cls: 'tree__ic' },
            { tag: 'span', text: '指南' }
          ]
        }
      ]
    })
  },
  {
    id: 'timeline',
    label: '时间线',
    node: () => ({
      tag: 'div',
      cls: 'tline',
      children: [
        {
          tag: 'div',
          cls: 'tline__it',
          children: [
            { tag: 'span', cls: 'tline__dot', attrs: { 'data-state': 'done' } },
            {
              tag: 'div',
              cls: 'tline__body',
              children: [
                { tag: 'div', cls: 'tline__title', text: '完成的事' },
                { tag: 'div', cls: 'tline__sub', text: '10-02 14:12' }
              ]
            }
          ]
        },
        {
          tag: 'div',
          cls: 'tline__it',
          children: [
            { tag: 'span', cls: 'tline__dot' },
            {
              tag: 'div',
              cls: 'tline__body',
              children: [{ tag: 'div', cls: 'tline__title', text: '待做的事' }]
            }
          ]
        }
      ]
    })
  },
  {
    id: 'titlebar',
    label: '窗口标题栏',
    node: () => ({
      tag: 'header',
      cls: 'tbar',
      children: [
        { tag: 'span', cls: 'tbar__title', text: '应用窗口' },
        { tag: 'button', cls: 'tbar__ctl', attrs: { type: 'button', 'aria-label': '最小化' } },
        {
          tag: 'button',
          cls: 'tbar__ctl tbar__ctl--close',
          attrs: { type: 'button', 'aria-label': '关闭' }
        }
      ]
    })
  },
  {
    id: 'statusbar',
    label: '状态栏',
    node: () => ({
      tag: 'footer',
      cls: 'stat',
      children: [
        { tag: 'span', text: '就绪' },
        { tag: 'span', cls: 'stat__right', text: 'UTF-8' }
      ]
    })
  },
  {
    id: 'splitter',
    label: '分栏条',
    node: () => ({
      tag: 'span',
      cls: 'spl',
      attrs: { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0' }
    })
  },
  {
    id: 'phone-navbar',
    label: '手机导航栏',
    node: () => ({
      tag: 'header',
      cls: 'pnav',
      children: [
        {
          tag: 'button',
          cls: 'pnav__back',
          attrs: { type: 'button', 'aria-label': '返回' },
          icon: 'app-back'
        },
        { tag: 'span', cls: 'pnav__title', text: '详情' }
      ]
    })
  },
  {
    id: 'swipe-row',
    label: '滑动操作行',
    node: () => ({
      tag: 'div',
      cls: 'swr',
      children: [
        { tag: 'div', cls: 'swr__body', children: [{ tag: 'span', text: '左滑出现操作' }] },
        { tag: 'button', cls: 'swr__act swr__act--danger', attrs: { type: 'button' }, text: '删除' }
      ]
    })
  },
  {
    id: 'pull-refresh',
    label: '下拉刷新',
    node: () => ({
      tag: 'div',
      cls: 'ptr',
      children: [
        { tag: 'span', cls: 'ptr__ic', icon: 'demo-down' },
        { tag: 'span', text: '下拉刷新' }
      ]
    })
  }
]

export const PART_MAP: Record<string, PartDef> = Object.fromEntries(PART_DEFS.map((p) => [p.id, p]))

/** 配方 id → 样板节点;未注册回 null(底板跳过并忽略,不挡渲染) */
export function partNode(id: string): PageNode | null {
  return PART_MAP[id]?.node() ?? null
}
