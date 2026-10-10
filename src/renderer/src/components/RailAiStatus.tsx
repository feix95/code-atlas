// rail 底槽的 AI 状态钮(UI v3 §6.1):图形形状区分就绪/加载/未连接等状态,图标颜色随主题。
// 点击弹浮层(锚位:贴钮上方往右弹,Windows 系统托盘/Discord 同款),Esc/点外/滚轮收起。
// 浮层版式(v4 重设计):头=圆点+供应商真名(在线 API 带服务商)+状态词,
// 身份行=模型名+大小/上下文档位,反馈槽=测试结论与引擎消息共用一行,
// 底栏=左带路文字链(日志钉最左、AI 设置次之)、右干活描边钮(测试连接/装卸/换模型)。
// 诚实线:在线 API 没测过只说「已配置」;已在 AI 设置页时该链原名置灰。
import { useContext, useEffect, useState } from 'react'
import type { AiConfig, ModelStatus } from '../../../shared/types.ts'
import { PROVIDER_OPTIONS } from '../../../shared/aiSetup.ts'
import { findCloudVendor } from '../../../shared/cloudVendors.ts'
import { AiSetupContext } from '../aiSetupContext'
import { useMenuDismiss } from '../useMenuDismiss'
import { friendlyErr } from '../errText'

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

/** 一次「测试连接」的结论:busy=正在问,ok=服务商回了名单,fail=报人话错 */
type Probe = { kind: 'busy' | 'ok' | 'fail'; text: string }

/** 头部视图:圆点只做四色助理(绿=可用/蓝=进行中/红=异常/灰=未启用),
    真值由状态词担——在线 API 底层报「就绪」只代表配置填全,从没真连过,
    翻译成「已配置」+灰点;本会话测过了才按测试结论改口(就绪绿/没连上红) */
function headView(
  status: ModelStatus,
  probe: Probe | null
): {
  dot: 'ok' | 'go' | 'bad' | 'off'
  text: string
  tip?: string
} {
  if (status.provider === 'cloud' && status.state === 'ready') {
    if (probe?.kind === 'ok') return { dot: 'ok', text: '就绪' }
    if (probe?.kind === 'fail') return { dot: 'bad', text: '没连上' }
    return {
      dot: 'off',
      text: '已配置',
      tip: '配置填全了,还没真连过 —— 点「测试连接」验'
    }
  }
  switch (status.state) {
    case 'loading':
      return {
        dot: 'go',
        text:
          status.progress === null
            ? '热身中……'
            : `热身中 ${status.estimated ? '约 ' : ''}${Math.round(status.progress)}%`,
        tip: status.estimated ? '进度按上次热身耗时估的 —— 引擎不报真数,这里不编数' : undefined
      }
    case 'busy':
      return { dot: 'go', text: '忙' }
    case 'ready':
      return { dot: 'ok', text: '就绪' }
    case 'idle':
      return { dot: 'off', text: '没叫醒' }
    case 'unreachable':
      return { dot: 'bad', text: '没连上' }
    default:
      return { dot: 'bad', text: '出岔子了' }
  }
}

/** 内置模型的装卸动作:热身中=取消,就绪=卸下,没叫醒/出岔子/连不上=装载主动热身;
    外接的装卸归 LM Studio 管,这里不出钮 */
function builtinAct(status: ModelStatus): { label: string; tip: string; run: () => void } | null {
  if (status.provider !== 'builtin' || status.state === 'busy') return null
  if (status.state === 'loading')
    return { label: '取消', tip: '停掉这次装载', run: () => void window.atlas.modelEject() }
  if (status.state === 'ready')
    return { label: '卸下', tip: '从内存卸下,释放显存', run: () => void window.atlas.modelEject() }
  return { label: '装载', tip: '把模型读进内存', run: () => void window.atlas.modelLoad() }
}

/** 状态浮层:头=点+供应商名+状态词,身份行=模型+账(大小/上下文档位),
    反馈槽=测试结果与引擎消息共用一行,底栏=左带路文字链(日志钉最左)、右干活描边钮 */
function AiStatusPanel({
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
    setProbe({ kind: 'busy', text: '正在问服务商…' })
    const config = cfg ?? (await window.atlas.aiConfigGet().catch(() => null))
    if (config?.provider !== 'cloud') {
      setProbe({ kind: 'fail', text: '读不到在线 API 的配置' })
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
        text: ids.length > 0 ? `服务商列出 ${ids.length} 个模型` : '服务商没列出模型'
      })
    } catch (err) {
      setProbe({ kind: 'fail', text: friendlyErr(err) })
    }
  }

  const logNav = (
    <button
      type="button"
      className="ai-pop-nav"
      data-tip="看模型请求的底层日志"
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
            {configured === null ? '正在读取 AI 设置…' : 'AI 讲解尚未设置'}
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
  const providerName = status
    ? status.provider === 'cloud'
      ? `在线 API · ${cfg ? (findCloudVendor(cfg.cloud.vendor)?.label.split('(')[0] ?? '自定义') : '…'}`
      : (PROVIDER_OPTIONS.find((p) => p.id === status.provider)?.label ?? status.provider)
    : ''
  const metaExtra = !status
    ? ''
    : status.provider === 'builtin'
      ? formatBytes(status.sizeBytes)
      : status.provider === 'cloud' && cfg
        ? `上下文 ${cfg.cloud.contextSize.toLocaleString()}`
        : ''
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
            <span className={`ai-pop-dot is-${head.dot}`} aria-hidden="true" />
            <span className="ai-pop-who">{providerName}</span>
            <span
              className={`ai-pop-state${head.dot === 'bad' ? ' is-error' : ''}`}
              data-tip={head.tip}
            >
              {head.text}
            </span>
          </div>
          {(status.modelName || metaExtra) && (
            <div className="ai-pop-meta">
              {status.modelName && (
                <span className="ai-pop-name mono" data-tip={status.modelName}>
                  {status.modelName}
                </span>
              )}
              {status.modelName && metaExtra && <span aria-hidden="true">·</span>}
              {metaExtra && <span>{metaExtra}</span>}
            </div>
          )}
        </>
      ) : (
        <div className="ai-pop-empty">
          <p className="ai-pop-note">模型状态还没回话,引擎那边可能在热身</p>
        </div>
      )}
      {feedback && (
        <div
          className="ai-pop-probe"
          data-tip={feedback.tip}
          role={feedback.ico === 'bad' ? 'alert' : 'status'}
        >
          <span
            className={`ai-pop-pico${feedback.ico === 'ok' ? ' is-ok' : ''}${feedback.ico === 'bad' ? ' is-bad' : ''}`}
            aria-hidden="true"
          >
            {feedback.ico === 'spin' ? (
              <span className="ai-pop-spin" />
            ) : feedback.ico === 'ok' ? (
              '✓'
            ) : feedback.ico === 'bad' ? (
              '✕'
            ) : (
              ''
            )}
          </span>
          <span className="ai-pop-probe-text">{feedback.text}</span>
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
                data-tip="拿配置里的 Key 真打一次服务商接口,验连通和 Key;不产 token,不计费"
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
                data-tip="换一个 GGUF 模型文件:选完写进 AI 设置,引擎自动按新模型重载"
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
