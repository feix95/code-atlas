// 第七十锤:模型状态栏 —— 常驻窗口底部,模型热身到哪了随时看得见。
// 加载前报上次用的模型名和大小;加载中报百分比 + 进度条,还能按取消;
// 就绪后报状态,内置模型还能一键卸下腾内存。外接 LM Studio 的装卸归它自己管,这边只看状态。
// 进度只有服务真报了数才显示,拿不到就老实转圈,绝不编百分比。
import { useEffect, useState } from 'react'
import type { ModelStatus } from '../../../shared/types.ts'

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${bytes} 字节`
}

export function ModelStatusBar(): React.JSX.Element {
  const [status, setStatus] = useState<ModelStatus | null>(null)

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

  if (status === null) return <footer className="model-dock" />

  const providerName = status.provider === 'builtin' ? '内置' : 'LM Studio'
  const size = formatBytes(status.sizeBytes)
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

  return (
    <footer className="model-dock">
      <div className={`model-status is-${status.state}`} role="status" aria-live="polite">
        {/* 左:状态本体 + 动作按钮(小葵定的版式:状态和取消/卸下都住左边) */}
        <span className="model-left">
          <span className="model-dot" aria-hidden="true" />
          <span className="model-provider">{providerName}</span>
          <span className="model-state" title={status.estimated ? '进度按上次热身耗时估的 —— 引擎不报真数,这里不编数' : undefined}>
            {stateText}
          </span>
          {/* 取消/卸下只对内置模型生效:热身中按=取消,就绪后按=卸下腾内存;外接的装卸归 LM Studio */}
          {status.provider === 'builtin' && (status.state === 'loading' || status.state === 'ready') && (
            <button type="button" className="model-act" onClick={() => void window.atlas.modelEject()}>
              {status.state === 'loading' ? '取消' : '卸下'}
            </button>
          )}
        </span>
        {/* 中:提醒/出岔子的话,空间不够自动截断,悬停看全文 */}
        {status.message && (
          <span className="model-message" title={status.message}>
            {status.message}
          </span>
        )}
        {/* 右:模型数据 + 后台日志入口(第八十七锤) */}
        <span className="model-right">
          {status.modelName && (
            <span className="model-name mono" title={status.modelName}>
              {status.modelName}
            </span>
          )}
          {size && <span className="model-size mono">{size}</span>}
          <button
            type="button"
            className="model-act"
            title="Developer 日志:看模型后台原话、请求报账"
            onClick={() => void window.atlas.devLogsOpen()}
          >
            日志
          </button>
        </span>
        {/* 进度线:贴着整条底栏底下走,按底栏全长当最大;就绪时满宽绿线退场;其他状态一根毛都不画 */}
        {(status.state === 'loading' || status.state === 'ready') && (
          <i
            className={`model-bar${status.progress === null ? ' is-unknown' : ''}`}
            style={status.progress !== null ? { width: `${Math.min(100, Math.max(0, status.progress))}%` } : undefined}
            aria-hidden="true"
          />
        )}
      </div>
    </footer>
  )
}
