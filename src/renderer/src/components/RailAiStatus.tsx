// rail 底槽的 AI 状态钮(UI v3 §6.1):图形形状区分就绪/加载/未连接等状态,图标颜色随主题。
// 点击弹浮层(锚位:贴钮上方往右弹,Windows 系统托盘/Discord 同款),Esc/点外/滚轮收起。
// 浮层版式在 AiStatusPanel;三态脸与文案映射在 aiStatusView。
import { useContext, useEffect, useState } from 'react'
import type { ModelStatus } from '../../../shared/types.ts'
import { AiSetupContext } from '../aiSetupContext'
import { useMenuDismiss } from '../useMenuDismiss'
import { AiStatusPanel } from './AiStatusPanel'
import { faceOf } from '../aiStatusView'

export function RailAiStatus(): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    // 先问一次现状,再订阅后续变化;主进程状态一动就会广播过来
    const off = window.atlas.onModelStatus((s) => {
      if (alive) setStatus(s)
    })
    void window.atlas
      .modelStatusGet()
      .then((s) => {
        if (alive) setStatus(s)
      })
      .catch(() => {})
    return () => {
      alive = false
      off()
    }
  }, [])

  // 点外/滚轮/Esc 收起;钮自己算「里面」,不然 mousedown 先收 click 又弹回
  useMenuDismiss(open, () => setOpen(false), '.ai-status-pop, .rail-ai')

  const face = faceOf(setup?.configured, status)
  const stateLabel =
    face === 'ready'
      ? 'AI 已就绪'
      : face === 'loading'
        ? 'AI 模型热身中'
        : face === 'error'
          ? 'AI 出错'
          : 'AI 未装载'

  return (
    <>
      <button
        type="button"
        className={`rail-btn rail-ai is-${face}`}
        onClick={() => setOpen((o) => !o)}
        data-tip={`AI 状态:${stateLabel}`}
        data-tip-side="right"
        aria-label={`AI 状态:${stateLabel}`}
        aria-expanded={open}
      >
        {face === 'loading' ? (
          <span className="ai-load-spin" aria-hidden="true" />
        ) : face === 'ready' ? (
          // 就绪脸手绘:外圈(.ai-ready-ring)与对勾(.ai-ready-tick)拆层,各跑各的登场动画
          <svg
            className="ai-ready-icon"
            width="1.375rem"
            height="1.375rem"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle className="ai-ready-ring" cx="12" cy="12" r="10" />
            <path className="ai-ready-tick" d="m16 9-5.5 5.5L8 12" />
          </svg>
        ) : (
          // 没叫醒/出岔子 = unplug:左下插头(带插脚)与右上插座拆层,
          // is-idle 态两半从「插着」的位置拔开(出岔子不跑动画,借同一张脸)
          <svg
            className="ai-idle-icon"
            width="1.375rem"
            height="1.375rem"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <g className="ai-unplug-plug">
              <path d="m2 22 3-3" />
              <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
              <path d="M7.5 13.5 10 11" />
              <path d="M10.5 16.5 13 14" />
            </g>
            <g className="ai-unplug-socket">
              <path d="m19 5 3-3" />
              <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
            </g>
          </svg>
        )}
      </button>
      {open && <AiStatusPanel status={status} onClose={() => setOpen(false)} />}
    </>
  )
}
