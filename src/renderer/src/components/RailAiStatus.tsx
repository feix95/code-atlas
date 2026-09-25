// rail 底槽的 AI 状态钮(UI v3 §6.1):图形形状区分就绪/加载/未连接等状态,图标颜色随主题。
// 点击弹浮层(锚位:贴钮上方往右弹,Windows 系统托盘/Discord 同款),Esc/点外/滚轮收起。
// 浮层内容沿用旧文档第七节全套:供应商+状态文案、热身进度(纯文字)、模型名+大小、
// 热身中「取消」/就绪「卸下」、「AI 设置」「日志」入口、status.message 截断悬停看全文、
// 未配置「设置 AI」引导 —— 旧底部状态栏(ModelStatusBar)随它上岗退役。
import { useContext, useEffect, useState } from 'react'
import type { ModelStatus } from '../../../shared/types.ts'
import { AiSetupContext } from '../aiSetupContext'
import { TreeIcon } from './Icons'
import { useMenuDismiss } from '../useMenuDismiss'

/** rail 图标本体 ≈0.425u ≈ 27px@100%(与 Rail.tsx 同档) */
const RAIL_ICON = 27

/** 状态脸:三态外的第四态 = 红插头(§6.1:出错 = 红 unplug) */
type AiFace = 'ready' | 'loading' | 'idle' | 'error'

function faceOf(configured: boolean | null | undefined, status: ModelStatus | null): AiFace {
  if (configured !== true || !status) return 'idle'
  if (status.state === 'loading') return 'loading'
  if (status.state === 'ready' || status.state === 'busy') return 'ready'
  if (status.state === 'error' || status.state === 'unreachable') return 'error'
  return 'idle'
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${bytes} 字节`
}

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
  const icon = face === 'ready' ? 'circleCheck' : face === 'loading' ? 'loaderCircle' : 'unplug'
  const stateLabel =
    face === 'ready'
      ? 'AI 已就绪'
      : face === 'loading'
        ? 'AI 模型热身中'
        : face === 'error'
          ? 'AI 出岔子了'
          : 'AI 未加载'

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
        <TreeIcon name={icon} size={RAIL_ICON} mono />
      </button>
      {open && <AiStatusPanel status={status} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 状态浮层:供应商+状态文案+热身进度(纯字)+模型名+大小+取消/卸下+AI 设置/日志+引导,一项不裁 */
function AiStatusPanel({
  status,
  onClose
}: {
  status: ModelStatus | null
  onClose: () => void
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const configured = setup?.configured

  if (configured !== true) {
    return (
      <div className="ai-status-pop" role="dialog" aria-label="AI 状态">
        <p className="ai-pop-title">
          {configured === null ? '正在读取 AI 设置…' : 'AI 讲解尚未设置'}
        </p>
        <p className="ai-pop-note">项目地图和文件阅读可以直接使用</p>
        {configured === false && setup && (
          <div className="ai-pop-actions">
            <button
              type="button"
              className="ai-pop-act is-primary"
              onClick={() => {
                setup.openSettings()
                onClose()
              }}
            >
              设置 AI
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ai-status-pop" role="dialog" aria-label="AI 状态">
      {status ? (
        <>
          <StatusRows status={status} />
          {status.message && (
            <p
              className={`ai-pop-message${status.state === 'error' ? ' is-error' : ''}`}
              data-tip={status.message}
            >
              {status.message}
            </p>
          )}
          {(status.modelName || formatBytes(status.sizeBytes) !== '') && (
            <div className="ai-pop-row ai-pop-meta">
              {status.modelName && (
                <span className="ai-pop-name mono" data-tip={status.modelName}>
                  {status.modelName}
                </span>
              )}
              {formatBytes(status.sizeBytes) !== '' && (
                <span className="ai-pop-size mono">{formatBytes(status.sizeBytes)}</span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="ai-pop-note">模型状态还没回话,引擎那边可能在热身</p>
      )}
      <div className="ai-pop-actions">
        {setup && (
          <button
            type="button"
            className="ai-pop-act"
            onClick={() => {
              setup.openSettings()
              onClose()
            }}
          >
            AI 设置
          </button>
        )}
        <button
          type="button"
          className="ai-pop-act"
          data-tip="Developer 日志:看模型后台原话、请求报账"
          onClick={() => {
            void window.atlas.devLogsOpen()
            onClose()
          }}
        >
          日志
        </button>
      </div>
    </div>
  )
}

/** 第一行:供应商 pill + 状态文案(含热身进度,只写字不画条)+ 取消/卸下动作 */
function StatusRows({ status }: { status: ModelStatus }): React.JSX.Element {
  const providerName = status.provider === 'builtin' ? '内置' : 'LM Studio'
  const stateText =
    status.state === 'loading'
      ? status.progress === null
        ? '热身中……'
        : `热身中 ${status.estimated ? '约 ' : ''}${Math.round(status.progress)}%`
      : status.state === 'idle'
        ? '还没叫醒'
        : status.state === 'busy'
          ? '忙'
          : status.state === 'ready'
            ? '就绪'
            : status.state === 'unreachable'
              ? '没连上'
              : '出岔子了'
  const broken = status.state === 'error' || status.state === 'unreachable'

  return (
    <div className="ai-pop-row">
      <span className="ai-pop-provider">{providerName}</span>
      <span
        className={`ai-pop-state${broken ? ' is-error' : ''}`}
        data-tip={
          status.estimated ? '进度按上次热身耗时估的 —— 引擎不报真数,这里不编数' : undefined
        }
      >
        {stateText}
      </span>
      {/* 取消/卸下只对内置模型生效:热身中按=取消,就绪后按=卸下腾内存;外接的装卸归 LM Studio */}
      {status.provider === 'builtin' &&
        (status.state === 'loading' || status.state === 'ready') && (
          <button
            type="button"
            className="ai-pop-act"
            onClick={() => void window.atlas.modelEject()}
          >
            {status.state === 'loading' ? '取消' : '卸下'}
          </button>
        )}
    </div>
  )
}
