// 松手/取消的统一收尾:芯片沉降飞回落点,落地后才交账 + 收场。
import type { PaneDropMark } from './paneTabs'
import { settleRectFor } from './tabDragHitTest'
import {
  CHIP_SETTLE_MS,
  type DragZone,
  type SettleRect,
  type SourceRect,
  type TabDragState
} from './tabDragTypes'
import type { BodySnap, StripSnap } from './tabDragWindows'

export function finishDropSettle(input: {
  zone: DragZone
  doCommit: boolean
  srcGroupId: string | null
  tabId: string
  rect: SourceRect
  paneSplit: number
  snaps: readonly StripSnap[]
  bodies: readonly BodySnap[]
  view: Window
  commit: (z: DragZone) => void
  endSession: () => void
  setDrag: React.Dispatch<React.SetStateAction<TabDragState | null>>
  setDropMark: React.Dispatch<React.SetStateAction<PaneDropMark | null>>
}): void {
  const {
    zone: z,
    doCommit,
    srcGroupId,
    tabId,
    rect,
    paneSplit,
    snaps,
    bodies,
    view,
    commit,
    endSession,
    setDrag,
    setDropMark
  } = input

  // 本组条带内松手:活序滑动里真身已经滑到落点跟前,不等沉降直接交账 —
  // 签就是跟着指针站位的,再飞一段是纯多余(Chromium 同款:就地落下)
  if (z.type === 'strip' && z.groupId === srcGroupId) {
    if (doCommit) commit(z)
    endSession()
    return
  }
  const target: SettleRect | null = settleRectFor({
    zone: z,
    snaps,
    bodies,
    srcGroupId,
    tabId,
    rect,
    paneSplit
  })
  if (!target) {
    if (doCommit) commit(z)
    endSession()
    return
  }
  setDrag((d) => (d ? { ...d, phase: 'settle', settle: target } : d))
  setDropMark(null) // 正文提示可以撤了,沉降本身就是反馈;页签缝留着接芯片落地
  view.setTimeout(() => {
    if (doCommit) commit(z)
    endSession()
  }, CHIP_SETTLE_MS)
}
