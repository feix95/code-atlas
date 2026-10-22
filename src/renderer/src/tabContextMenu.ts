// 页签右键菜单的条目编排(Obsidian 式分组,组间一道细线)。只管拼清单,弹菜单是调用方的事。
import { canTranslate } from '@shared/translateGate'
import { TRANSLATE_LANGS } from '@shared/translateLangs'
import { getCodeWrapOn, toggleCodeWrap } from './codePrefs'
import type { TabBarTab } from './components/TabBar'
import { MENU_SEP, type ContextMenuEntry } from './components/contextMenuStore'
import { isFileKind } from './paneKinds'
import { applyViewFlags, viewFlags } from './viewState'

/**
 * 菜单行按签品类现拼:单例签没有文件动作和选项区;非 md 文件签不摆「排版显示」;
 * peek 签没有树定位、也不摆翻译(读根不是工作区,译文会读错)。
 */
export function buildTabMenuItems(input: {
  tab: TabBarTab
  /** 本带全部签:批量关与单组拆分的账要它 */
  tabs: TabBarTab[]
  workspaceRoot?: string | null
  canMoveToSiblingGroup: boolean
  onClose: (id: string) => void
  onCloseMany?: (ids: string[]) => void
  onMoveTab: (
    id: string,
    toGroup: 'sibling' | null,
    atIndex: number | null,
    splitSide?: 'left' | 'right'
  ) => void
  onDetachTab?: (id: string) => void
  onRevealInTree?: (id: string) => void
  onTranslate?: (tab: TabBarTab, lang: string) => void
}): ContextMenuEntry[] {
  const { tab: t, tabs, workspaceRoot, canMoveToSiblingGroup } = input
  const { onClose, onCloseMany, onMoveTab, onDetachTab, onRevealInTree, onTranslate } = input
  const isFile = isFileKind(t.kind)
  const root = t.scopeRoot ?? workspaceRoot ?? null
  const items: ContextMenuEntry[] = []

  items.push({ label: '关闭页签', icon: 'x', run: () => onClose(t.id) })

  // 批量关签(和关单签同组):只剩这一张时「其他」灰挂,菜单形状稳定
  if (onCloseMany) {
    const otherIds = tabs.filter((x) => x.id !== t.id).map((x) => x.id)
    items.push(
      {
        label: '关闭其他页签',
        icon: 'sidesX',
        disabled: otherIds.length === 0,
        run: () => onCloseMany(otherIds)
      },
      {
        label: '关闭全部页签',
        icon: 'xSquare',
        disabled: tabs.length === 0,
        run: () => onCloseMany(tabs.map((x) => x.id))
      }
    )
  }

  // 选项区(文件签常驻):三个互相独立的开关全是全局一档 —— 排版显示(只有 md 系有这一维,
  // 别的文件不摆)、只读(所有文件通吃)、自动换行(Alt+Z 走同一份全局偏好)。
  // 拨一颗 = 全局偏好翻面,所有已开的签就地跟随;读数换算只走 viewState
  if (isFile) {
    const flags = viewFlags(t.relPath)
    items.push(MENU_SEP, { heading: '选项' })
    if (flags.canRender) {
      items.push({
        label: '排版显示',
        icon: 'bookOpen',
        switchOn: flags.render,
        run: (on) => applyViewFlags({ render: on })
      })
    }
    items.push(
      {
        label: '只读',
        icon: 'lock',
        switchOn: flags.readOnly,
        run: (on) => applyViewFlags({ readOnly: on })
      },
      {
        label: '自动换行',
        icon: 'wrapText',
        switchOn: getCodeWrapOn(),
        run: () => toggleCodeWrap()
      }
    )
  }

  // 翻译(预览签:选语种 → 开一张并排的译文镜像签;译文签:就地换语种,不新开签)。
  // 译文签的当前语种在子菜单里打勾
  if (
    onTranslate &&
    (t.kind === 'translate' || (t.kind === 'preview' && canTranslate(t.relPath)))
  ) {
    items.push(MENU_SEP, {
      label: '翻译成…',
      icon: 'sparkles',
      children: TRANSLATE_LANGS.map((l) => ({
        label: l.code === t.lang ? `${l.label} ✓` : l.label,
        run: () => onTranslate(t, l.code)
      }))
    })
  }

  if (onDetachTab)
    items.push(MENU_SEP, {
      label: '移到新窗口',
      icon: 'appWindow',
      run: () => onDetachTab(t.id)
    })

  // 分组组:已有另一组就「挪过去」;单组才分向拆(独签一组拆不出第二组,灰着)
  if (canMoveToSiblingGroup)
    items.push(MENU_SEP, {
      label: '移到另一组',
      icon: 'arrows',
      run: () => onMoveTab(t.id, 'sibling', null)
    })
  else {
    const lonely = tabs.length < 2
    items.push(
      MENU_SEP,
      {
        label: '向左拆分',
        icon: 'panelLeft',
        disabled: lonely,
        run: () => onMoveTab(t.id, 'sibling', null, 'left')
      },
      {
        label: '向右拆分',
        icon: 'panelRight',
        disabled: lonely,
        run: () => onMoveTab(t.id, 'sibling', null, 'right')
      }
    )
  }

  // 文件动作组:复制路径自成一组,资源管理器/树定位一组
  if (isFile && root !== null) {
    items.push(
      MENU_SEP,
      {
        label: '复制路径',
        icon: 'copy',
        run: async () => {
          const r = await window.atlas.copyFilePath(root, t.relPath)
          return r.ok ? '已复制 ✓' : (r.message ?? '没复制成')
        }
      },
      MENU_SEP,
      {
        label: '在文件资源管理器中显示',
        icon: 'folder',
        run: async () => {
          const r = await window.atlas.revealFilePath(root, t.relPath)
          return r.ok ? undefined : (r.message ?? '没打开成')
        }
      }
    )
    // peek 签的文件不归工作区树管,树定位不摆
    if (t.kind === 'preview' && onRevealInTree)
      items.push({
        label: '在文件列表中显示当前文件',
        icon: 'crosshair',
        run: () => onRevealInTree(t.id)
      })
  }

  return items
}
