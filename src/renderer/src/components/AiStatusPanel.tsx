// AI 状态浮层:头=点+供应商名+状态词,身份行=模型+账(大小/上下文档位),
// 反馈槽=测试结果与引擎消息共用一行,底栏=左带路文字链(日志钉最左)、右干活描边钮。
import { useContext, useEffect, useState } from 'react'
import type { AiConfig, ModelStatus } from '../../../shared/types.ts'
import { AiSetupContext } from '../aiSetupContext'
import { friendlyErr } from '../errText'
import {
  builtinAct,
  formatBytes,
  headView,
  providerNameOf,
  switchModelFile,
  type Probe
} from '../aiStatusView'

export function AiStatusPanel({
  status,
  onClose
}: {
  status: ModelStatus | null
  onClose: () => void
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const configured = setup?.configured
  const [probe, setProbe] = useState<Probe | null>(null)
  /** 在线 API 的服务商名和上下文档位要回配置取(状态播报里没带) */
  const [cfg, setCfg] = useState<AiConfig | null>(null)

  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (alive) setCfg(c)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  async function probeCloud(): Promise<void> {
    setProbe({ kind: 'busy', text: '正在测试连接' })
    const config = cfg ?? (await window.atlas.aiConfigGet().catch(() => null))
    if (config?.provider !== 'cloud') {
      setProbe({ kind: 'fail', text: '无法读取在线 API 配置' })
      return
    }
    try {
      // aiListModels 兼任连接/Key 测试:只打元数据接口,不产 token 不计费;报错主进程已翻人话
      const ids = await window.atlas.aiListModels({
        baseUrl: config.cloud.baseUrl,
        apiKey: config.cloud.apiKey,
        provider: 'cloud'
      })
      setProbe({
        kind: 'ok',
        text: ids.length > 0 ? `服务商返回 ${ids.length} 个模型` : '服务商未列出模型'
      })
    } catch (err) {
      setProbe({ kind: 'fail', text: friendlyErr(err) })
    }
  }

  const logNav = (
    <button
      type="button"
      className="ai-pop-nav"
      data-tip="查看 AI 请求日志"
      onClick={() => {
        void window.atlas.devLogsOpen()
        onClose()
      }}
    >
      日志
    </button>
  )

  if (configured !== true) {
    return (
      <div className="ai-status-pop" role="dialog" aria-label="AI 状态">
        <div className="ai-pop-empty">
          <p className="ai-pop-title">
            {configured === null ? '正在读取 AI 设置' : 'AI 讲解尚未设置'}
          </p>
          {configured === false && <p className="ai-pop-note">项目地图和文件阅读可以直接使用</p>}
        </div>
        {configured === false && (
          <div className="ai-pop-actions">
            <div className="ai-pop-navs">{logNav}</div>
            {setup && (
              <button
                type="button"
                className="ai-pop-act is-call"
                data-tip="打开 AI 设置页"
                onClick={() => {
                  setup.openSettings()
                  onClose()
                }}
              >
                设置 AI
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const head = status ? headView(status, probe) : null
  const providerName = status ? providerNameOf(status, cfg) : ''
  const metaExtra = !status
    ? ''
    : status.provider === 'builtin'
      ? formatBytes(status.sizeBytes)
      : status.provider === 'cloud' && cfg
        ? `上下文 ${cfg.cloud.contextSize.toLocaleString()}`
        : ''
  // 能力标签:视觉/纯文本两粒,unknown 不挂 —— 没问到就别说
  const visionTag =
    status?.vision === 'vision'
      ? { label: '视觉', tip: '这个模型能看图片' }
      : status?.vision === 'text-only'
        ? { label: '纯文本', tip: '这个模型只能读文字，图片附件会被禁用' }
        : null
  // 反馈槽:测试结果优先(它更新),没测过才落引擎消息;异常消息配 ✕,其余纯文字
  const broken = status?.state === 'error' || status?.state === 'unreachable'
  const feedback: { ico: 'spin' | 'ok' | 'bad' | 'none'; text: string; tip?: string } | null = probe
    ? {
        ico: probe.kind === 'busy' ? 'spin' : probe.kind === 'ok' ? 'ok' : 'bad',
        text: probe.text,
        tip: probe.kind === 'fail' ? probe.text : undefined
      }
    : status?.message
      ? { ico: broken ? 'bad' : 'none', text: status.message, tip: status.message }
      : null
  const loadAct = status ? builtinAct(status) : null

  return (
    <div className="ai-status-pop" role="dialog" aria-label="AI 状态">
      {status && head ? (
        <>
          <div className="ai-pop-head">
            <span className="ai-pop-who">{providerName}</span>
            <span className={`ai-pop-dot is-${head.dot}`} aria-hidden="true" />
            <span
              className={`ai-pop-state${head.dot === 'bad' ? ' is-error' : ''}`}
              data-tip={head.tip}
            >
              {head.text}
            </span>
          </div>
          {(status.modelName || metaExtra || visionTag) && (
            <div className="ai-pop-meta">
              {status.modelName && (
                <span className="ai-pop-name mono" data-tip={status.modelName}>
                  {status.modelName}
                </span>
              )}
              {status.modelName && metaExtra && <span aria-hidden="true">·</span>}
              {metaExtra && <span>{metaExtra}</span>}
              {visionTag && (
                <span className="ai-pop-cap" data-tip={visionTag.tip}>
                  {visionTag.label}
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="ai-pop-empty">
          <p className="ai-pop-note">模型状态尚未返回，请稍候</p>
        </div>
      )}
      {feedback && (
        <div
          className="ai-pop-probe"
          data-tip={feedback.tip}
          role={feedback.ico === 'bad' ? 'alert' : 'status'}
        >
          <span className="ai-pop-probe-text">{feedback.text}</span>
          {feedback.ico !== 'none' && (
            <span
              className={`ai-pop-pico${feedback.ico === 'ok' ? ' is-ok' : ''}${feedback.ico === 'bad' ? ' is-bad' : ''}`}
              aria-hidden="true"
            >
              {feedback.ico === 'spin' ? (
                <span className="ai-pop-spin" />
              ) : feedback.ico === 'ok' ? (
                '✓'
              ) : (
                '✕'
              )}
            </span>
          )}
        </div>
      )}
      <div className="ai-pop-actions">
        <div className="ai-pop-navs">
          {logNav}
          {setup && (
            <button
              type="button"
              className="ai-pop-nav"
              disabled={setup.isOnAiSettings}
              data-tip={setup.isOnAiSettings ? '当前就在 AI 设置页' : '打开 AI 设置页'}
              onClick={() => {
                setup.openSettings()
                onClose()
              }}
            >
              AI 设置
            </button>
          )}
        </div>
        {(status?.provider === 'cloud' || status?.provider === 'builtin') && (
          <div className="ai-pop-acts">
            {status.provider === 'cloud' && (
              <button
                type="button"
                className="ai-pop-act"
                disabled={probe?.kind === 'busy'}
                data-tip="检查连接和 Key，不产生费用"
                onClick={() => void probeCloud()}
              >
                测试连接
              </button>
            )}
            {loadAct && (
              <button
                type="button"
                className="ai-pop-act"
                data-tip={loadAct.tip}
                onClick={loadAct.run}
              >
                {loadAct.label}
              </button>
            )}
            {status.provider === 'builtin' && (
              <button
                type="button"
                className="ai-pop-act"
                data-tip="更换模型文件，并自动重新装载"
                onClick={() => void switchModelFile()}
              >
                换模型
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
