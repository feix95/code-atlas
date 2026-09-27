// 撕窗子窗的渲染层户口(页签撕窗锤):window.open 开同进程子窗(about:blank 白窗),
// 页签的活 DOM 由 React Portal 渲染进它的 document —— Obsidian/VSCode 同款路线,
// 一棵 React 树,多个渲染出口;签的正房整个搬家,流式回答/滚动位/草稿全活。
import { useCallback, useRef, useState } from 'react'

/** 一扇子窗的手柄:id = frameName(主进程认窗用);container = Portal 的渲染坑位 */
export interface AuxWindowHandle {
  id: string
  win: Window
  container: HTMLDivElement
}

let auxSeq = 0

/**
 * 把主窗的样式家底克隆进子窗 document:vite 注入的 <style> 和外链样式表全数照抄。
 * 新窗是 about:blank 白窗,不抄样式就是个裸奔页面。
 */
function cloneStyles(targetDoc: Document): void {
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    targetDoc.head.appendChild(node.cloneNode(true))
  }
}

/**
 * 子窗壳层的外观对账:主题/字号/窗态类名跟着主窗走。
 * documentElement 的 dataset(主题)/inline style(根字号)和 body 的 class(最大化等)
 * 每次渲染都抄一遍 —— 主窗换主题/切缩放,子窗不落下。
 */
export function syncAuxChrome(targetDoc: Document): void {
  const tde = targetDoc.documentElement
  const de = document.documentElement
  tde.dataset.theme = de.dataset.theme
  for (const { name, value } of Array.from(de.attributes)) {
    if (name === 'data-theme') continue // 上面单独管
    if (tde.getAttribute(name) !== value) tde.setAttribute(name, value)
  }
  targetDoc.body.className = document.body.className
}

export function useAuxWindows(): {
  auxWins: AuxWindowHandle[]
  openAuxWindow: () => AuxWindowHandle | null
  closeAuxWindow: (id: string) => void
  onAuxGone: (fn: (id: string) => void) => void
} {
  const [auxWins, setAuxWins] = useState<AuxWindowHandle[]>([])
  // onGone 回调注册口:usePaneTabs 要听「窗死了」好清那扇名下的组
  const goneListeners = useRef(new Set<(id: string) => void>())
  // auxWins 的 ref 镜像:closeAuxWindow 要翻手柄,state 在回调里读旧账不稳 ——
  // 只在开窗/忘窗两个事件点同步(渲染期碰 ref 是 React 新规矩的红线)
  const auxRef = useRef<AuxWindowHandle[]>([])

  const forgetAux = useCallback((id: string): void => {
    auxRef.current = auxRef.current.filter((a) => a.id !== id)
    setAuxWins(auxRef.current)
    for (const fn of goneListeners.current) fn(id)
  }, [])

  /**
   * 开一扇子窗:window.open 同进程白窗 → 克隆重度样式 → 立渲染坑位 →
   * 挂死讯监听。返回 null = 浏览器/Electron 拒开(白名单/弹窗拦截),调用方别挪签。
   */
  const openAuxWindow = useCallback((): AuxWindowHandle | null => {
    const id = `aux-${++auxSeq}`
    const win = window.open('about:blank', id)
    if (!win) return null
    const doc = win.document
    doc.title = 'CodeAtlas'
    cloneStyles(doc)
    // body 立渲染坑位:.app 类让壳层样式照搬(圆角/底色/字号全挂它)
    const container = doc.createElement('div')
    container.className = 'app is-aux'
    doc.body.className = document.body.className
    doc.body.appendChild(container)
    const handle: AuxWindowHandle = { id, win, container }
    // 窗死讯:用户点系统关闭/标题栏 ×/脚本 win.close() 都会走卸载 ——
    // 渲染坑位作废 + 通知下游(usePaneTabs 清那扇名下的组)
    win.addEventListener('pagehide', () => forgetAux(id))
    auxRef.current = [...auxRef.current, handle]
    setAuxWins(auxRef.current)
    return handle
  }, [forgetAux])

  const closeAuxWindow = useCallback(
    (id: string): void => {
      const handle = auxRef.current.find((a) => a.id === id)
      if (!handle || handle.win.closed) return
      handle.win.close()
      // pagehide 会补清账;这里先记账防双关
      forgetAux(id)
    },
    [forgetAux]
  )

  // 外部死讯订阅口(不用 useEffect 包装 —— 监听器注册一次就够,Effect 管不到 ref 集)
  const onAuxGone = useCallback((fn: (id: string) => void): void => {
    goneListeners.current.add(fn)
  }, [])

  return { auxWins, openAuxWindow, closeAuxWindow, onAuxGone }
}
