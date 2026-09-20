// 共享对话镜像的节流器(气泡锁死案 2026-09-21):流式刷屏时最多每 intervalMs 抄送
// 一份快照给气泡窗;到点补发的必须是「最新一版」,不许念旧账 —— 旧实现里定时器
// 排着队时来的改动被直接跳过,补发的是排闹钟那一刻的旧快照:AI 答完的
// 「忙→完」翻牌恰好常落在这个窗口里被丢掉,主进程存底永远卡「忙」,
// 气泡输入框就这么锁死(气泡窗的 busy 看的是消息 state,不是主窗的 busy 旗)。

/**
 * 造一个「以最新为准」的节流推送器:每次 notify 记一版;距上次发送够间隔就
 * 立即发,不够就把最新版挂尾推 —— 定时器到点发的是当下记着的最新版,
 * 不是排闹钟那一刻抓到的旧版。
 */
export function createMirrorThrottle<T>(send: (value: T) => void, intervalMs: number): (value: T) => void {
  let lastSentAt = 0
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const p = pending
    pending = null
    if (p === null) return
    lastSentAt = Date.now()
    send(p.value)
  }
  return (value: T) => {
    const elapsed = Date.now() - lastSentAt
    if (elapsed >= intervalMs) {
      // 间隔够了直接发;若有尾推排着队,顺手摘了 —— 最新版这就发走,旧账不用补
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        pending = null
      }
      lastSentAt = Date.now()
      send(value)
      return
    }
    pending = { value }
    if (timer === null) timer = setTimeout(flush, intervalMs - elapsed)
  }
}
