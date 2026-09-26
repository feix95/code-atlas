// rail 底槽的 AI 状态钮(UI v3 §6.1):图形形状区分就绪/加载/未连接等状态,图标颜色随主题。
// 点击弹浮层(锚位:贴钮上方往右弹,Windows 系统托盘/Discord 同款),Esc/点外/滚轮收起。
// 浮层内容沿用旧文档第七节全套:供应商+状态文案、热身进度(纯文字)、模型名+大小、
// 热身中「取消」/就绪「卸下」/未醒与异常态「装载」、内置「换模型」文件快捷道、
// 「AI 设置」「日志」入口、status.message 截断悬停看全文、
// 未配置「设置 AI」引导 —— 旧底部状态栏(ModelStatusBar)随它上岗退役。
import { useContext, useEffect, useState } from 'react'
import type { ModelStatus } from '../../../shared/types.ts'
import { AiSetupContext } from '../aiSetupContext'
import { useMenuDismiss } from '../useMenuDismiss'

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

/** 浮层「换模型」快捷道:弹 GGUF 文件框 → 读配置改路径 → 存档
    (存档 handler 自带「换模型就地解散旧引擎」逻辑,状态播报自动刷) */
async function switchModelFile(): Promise<void> {
  const picked = await window.atlas.aiPickFile().catch(() => null)
  if (!picked) return
  const config = await window.atlas.aiConfigGet().catch(() => null)
  if (!config) return
  await window.atlas
    .aiConfigSave({ ...config, builtin: { ...config.builtin, modelPath: picked } })
    .catch(() => {})
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
  // 三张脸都手绘:热身=CSS 彗星尾环,就绪/没叫醒=拆层 SVG(登场动画要动零件)
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
        {status?.provider === 'builtin' && (
          <button
            type="button"
            className="ai-pop-act"
            data-tip="换一个 GGUF 模型文件:选完写进 AI 设置,引擎自动按新模型重载"
            onClick={() => void switchModelFile()}
          >
            换模型
          </button>
        )}
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

  // 内置模型的装卸动作:热身中=取消,就绪=卸下,没叫醒/出岔子/连不上=装载主动热身;
  // 外接的装卸归 LM Studio 管,这里不出钮
  const act =
    status.provider !== 'builtin'
      ? null
      : status.state === 'loading'
        ? { label: '取消', run: () => void window.atlas.modelEject() }
        : status.state === 'ready'
          ? { label: '卸下', run: () => void window.atlas.modelEject() }
          : status.state === 'busy'
            ? null
            : { label: '装载', run: () => void window.atlas.modelLoad() }

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
      {act && (
        <button type="button" className="ai-pop-act" onClick={act.run}>
          {act.label}
        </button>
      )}
    </div>
  )
}
