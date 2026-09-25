/**
 * 手动搬窗引擎(顶栏死空间 / 页签尾空白 / 日志窗头条共用)。
 *
 * 为什么手搓而不是 app-region:drag:
 *  - 原生拖拽走系统标题栏通道,Windows 的 Aero Shake(摇窗最小化其它窗)会介入,
 *    点住快速晃鼠标就误伤全屏窗口;程序级 setBounds 移动系统不认作标题栏拖拽,
 *    Shake 天然哑火(小葵点名 Obsidian 同款表现)。代价:没有系统贴边吸附预览。
 *  - 页签尾空白那块地本来也铺不了 drag(右键菜单+拖放落点会被吞)。
 *
 * 协议:位移攒够 4px 阈值才算拖(免得最大化下点一下就把窗还原);过阈值时报
 * 起点坐标 windowDragStart,之后每帧报光标绝对屏幕坐标 windowDragMove。
 * ⚠ 报绝对坐标不报增量:150% 缩放下每写一次 bounds 窗体偷长 1px(雷区档案②,
 * 黑匣子实测 1432x969→1700x1250);主进程按「基线矩形 + 总位移」回放,尺寸恒写收敛。
 * 指针捕获让光标甩出窗也能继续跟手。
 */
export function startWindowDrag(e: React.PointerEvent<HTMLElement>): void {
  if (e.button !== 0) return
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  const startX = e.screenX
  const startY = e.screenY
  let dragging = false
  const move = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) < 4) return
      dragging = true
      window.atlas.windowDragStart(startX, startY)
    }
    window.atlas.windowDragMove(ev.screenX, ev.screenY)
  }
  const done = (): void => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', done)
    el.removeEventListener('pointercancel', done)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', done)
  el.addEventListener('pointercancel', done)
}

/**
 * 顶栏这类「死空间才拖窗」的命中判定:落在可交互件(按钮/输入框/页签带等)
 * 上面就不接管,让正常点击和页签自己的拖拽走。
 */
export const WINDOW_DRAG_EXCLUDE = 'button, input, textarea, select, label, a, [role], .tabbar'

/** 死空间判定:true = 可按拖窗处理 */
export function isDeadSpace(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(WINDOW_DRAG_EXCLUDE))
}
