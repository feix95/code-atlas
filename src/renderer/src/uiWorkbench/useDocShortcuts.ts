// 文档级快捷键:Ctrl+Z 撤销 / Ctrl+Shift+Z、Ctrl+Y 重做(macOS Cmd 同理,键位认 e.code 不认 e.key);
// Ctrl+A 全选 / Ctrl+C 复制 / Ctrl+V 粘贴(逐级 +10 偏移)/ Ctrl+X 剪切 / Ctrl+D 原地复制;
// 复制粘贴作用于整个选集:多选复制、成组贴回,贴完整体选中;
// 方向键微调选中节点 1px,Shift+方向键 10px,按住连发整笔只记一步撤销;
// Delete/Backspace 删除整组选中;
// 小键盘方向键(Numpad2/4/6/8)与主键区方向键同效。
// 与 useToolKeys 的分工:那边是画布悬停才生效的单键(V/R/Delete);这里是文档快捷键——
// 不要求鼠标在画布上(面板改完数值鼠标还停在面板,Ctrl+Z 照样要灵),
// 但焦点在输入框/可编辑区时不接管,保住输入框的原生编辑键;
// 焦点落在工作台 DOM 之外的控件上(双分屏另一侧)也不抢键。
import { useEffect } from 'react'
import { cloneRect, type RectNode } from '@shared/uiWorkbench/node'
import { docActions, getDocState } from './documentStore'
import { isEditableTarget, isTextEditingTarget } from './isEditableTarget'
import type { CanvasViewportApi } from './useCanvasViewport'

// 工作台内存剪贴板:只活在本模块,不碰系统剪贴板;pastes 计数让连续粘贴逐级错开
let clipboard: { nodes: RectNode[]; pastes: number } | null = null

const NUDGE_STEP = 1
const NUDGE_STEP_SHIFT = 10
const PASTE_OFFSET = 10
// 方向认 e.code 不认 e.key:小键盘方向键码恒为 Numpad*(不吃 NumLock,
// key 才会随 NumLock 变成数字),画布上数字键本就无功能,统一按方向处理
const ARROW_DELTA: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  Numpad4: { x: -1, y: 0 },
  Numpad8: { x: 0, y: -1 },
  Numpad6: { x: 1, y: 0 },
  Numpad2: { x: 0, y: 1 }
}

export function useDocShortcuts(viewport: CanvasViewportApi): void {
  const { viewportRef } = viewport
  useEffect(() => {
    const win = viewportRef.current?.ownerDocument.defaultView
    if (!win) return
    // 按住的方向键集合:连发整笔只开一次批次,全部松开(或窗口失焦)才结算
    const heldArrows = new Set<string>()

    /** 按键归不归工作台管:可编辑区不接管;焦点在工作台之外的控件上(别组分屏)不抢 */
    const own = (e: KeyboardEvent): boolean => {
      // Ctrl/Cmd+* 只让渡给真吃编辑键的目标:色板/下拉/开关这类非文本控件没有原生撤销,
      // 让出去 = 焦点停在上面时 Ctrl+Z 变成死键;单键(方向键/V/R)维持全量屏蔽
      if (e.ctrlKey || e.metaKey) {
        if (isTextEditingTarget(e.target)) return false
      } else if (isEditableTarget(e.target)) return false
      const root = viewportRef.current?.closest('.ui-workbench') ?? null
      const target = e.target
      if (
        target instanceof win.Element &&
        root !== null &&
        !root.contains(target) &&
        target !== win.document.body &&
        target !== win.document.documentElement
      ) {
        return false
      }
      return true
    }

    const copySelection = (): RectNode[] => {
      const { nodes, selectedIds } = getDocState()
      const picked = nodes.filter((n) => selectedIds.includes(n.id))
      if (picked.length === 0) return []
      // 深拷贝存剪贴板:之后源节点再被改动,贴出来的还是复制那一刻的样子
      clipboard = {
        nodes: picked.map((n) => ({ ...n, radii: [...n.radii] as typeof n.radii })),
        pastes: 0
      }
      return picked
    }

    const onKey = (e: KeyboardEvent): void => {
      // 方向键微调:按住期间的首发 keydown 开批次,keyup 齐了就结算;blur 兜底
      const delta = ARROW_DELTA[e.code]
      if (delta && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!own(e) || getDocState().selectedIds.length === 0) return
        // 集合空就开批:正常是首发 keydown;blur 丢账后飘来的 repeat 也算新的一按
        if (heldArrows.size === 0) docActions.beginBatch()
        heldArrows.add(e.code)
        const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP
        // 整组微调:选中几个动几个,同批同位移
        for (const n of getDocState().nodes) {
          if (getDocState().selectedIds.includes(n.id)) {
            docActions.dispatch({
              type: 'update',
              id: n.id,
              patch: { x: n.x + delta.x * step, y: n.y + delta.y * step }
            })
          }
        }
        e.preventDefault()
        return
      }
      // Delete/Backspace 整组删除:文档级键,不要求指针悬停画布
      // (悬停门槛只管 V/R 这类换工具键——删除在面板焦点之外随时要灵)
      if (!(e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (!own(e)) return
        const { selectedIds } = getDocState()
        if (selectedIds.length === 0) return
        docActions.beginBatch()
        try {
          for (const id of selectedIds) docActions.dispatch({ type: 'remove', id })
        } finally {
          docActions.endBatch()
        }
        e.preventDefault()
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !own(e)) return
      switch (e.code) {
        case 'KeyZ':
          if (e.shiftKey) docActions.redo()
          else docActions.undo()
          break
        case 'KeyY':
          docActions.redo()
          break
        case 'KeyA':
          docActions.selectIds(getDocState().nodes.map((n) => n.id))
          break
        case 'KeyC':
          if (copySelection().length === 0) return
          break
        case 'KeyV': {
          if (!clipboard) return
          clipboard.pastes += 1
          docActions.beginBatch()
          try {
            // 逐个克隆:序号在「含已贴节点」的列表上重算,一次粘贴内 id 不撞车;整组贴完整体选中
            const offset = {
              x: PASTE_OFFSET * clipboard.pastes,
              y: PASTE_OFFSET * clipboard.pastes
            }
            const newIds: string[] = []
            for (const src of clipboard.nodes) {
              const node = cloneRect(src, getDocState().nodes, offset)
              docActions.dispatch({ type: 'add', node })
              newIds.push(node.id)
            }
            docActions.selectIds(newIds)
          } finally {
            docActions.endBatch()
          }
          break
        }
        case 'KeyX': {
          const src = copySelection()
          if (src.length === 0) return
          // 剪切 = 复制 + 全删,合成一步撤销
          docActions.beginBatch()
          try {
            for (const n of src) docActions.dispatch({ type: 'remove', id: n.id })
          } finally {
            docActions.endBatch()
          }
          break
        }
        case 'KeyD': {
          const { nodes, selectedIds } = getDocState()
          const picked = nodes.filter((n) => selectedIds.includes(n.id))
          if (picked.length === 0) return
          docActions.beginBatch()
          try {
            const newIds: string[] = []
            for (const src of picked) {
              const node = cloneRect(src, getDocState().nodes, {
                x: PASTE_OFFSET,
                y: PASTE_OFFSET
              })
              docActions.dispatch({ type: 'add', node })
              newIds.push(node.id)
            }
            docActions.selectIds(newIds)
          } finally {
            docActions.endBatch()
          }
          break
        }
        default:
          return
      }
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!heldArrows.has(e.code)) return
      heldArrows.delete(e.code)
      if (heldArrows.size === 0) docActions.endBatch()
    }
    const onBlur = (): void => {
      if (heldArrows.size > 0) {
        heldArrows.clear()
        docActions.endBatch()
      }
    }
    win.addEventListener('keydown', onKey, true)
    win.addEventListener('keyup', onKeyUp, true)
    win.addEventListener('blur', onBlur)
    return () => {
      win.removeEventListener('keydown', onKey, true)
      win.removeEventListener('keyup', onKeyUp, true)
      win.removeEventListener('blur', onBlur)
      // 组件卸载时若还按着方向键,补结算不留挂起批次
      if (heldArrows.size > 0) {
        heldArrows.clear()
        docActions.endBatch()
      }
    }
  }, [viewportRef])
}
