// 货架的一行:主行(名字/副行/状态章/体积/箭头)+ 展开区(小档案 + 文件清单 + 下载控件)。
import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import {
  formatDownloads,
  formatGgufSize,
  formatRelativeDays,
  judgeRun,
  MODEL_FIT_RAM_MAX_RATIO,
  runVerdictLabel
} from '../../../shared/modelShelf.ts'
import type { RepoFile, ShelfEntry } from '../../../shared/modelShelf.ts'
import type { DownloadState } from '../useModelShelf.ts'

/** 状态章的悬停大白话:专业词上章,人话兜底 —— 判定口径(内存 × 系数预算)在这儿说清,
 *  系数跟判定函数同一份登记(shared/modelShelf 的 MODEL_FIT_*),调了不会文案对不上账 */
const VERDICT_TIPS: Record<'no' | 'tight', string> = {
  no: `模型体积超出这台机器的可用内存预算(总内存 × ${MODEL_FIT_RAM_MAX_RATIO}，给系统留活路)，下载了也加载不起来`,
  tight: '接近内存预算上限，能跑但可能偏慢'
}

/** 副行小字(名字下方那行):下载量 + 收藏 + 更新时间(2026-09-18 起收藏也上 —— 数据早拉了,别浪费) */
function shelfSubLine(entry: ShelfEntry): string {
  const parts = [
    `${formatDownloads(entry.downloads)} 次下载`,
    `${formatDownloads(entry.likes)} 收藏`
  ]
  if (entry.lastModified) parts.push(`${formatRelativeDays(entry.lastModified)}更新`)
  return parts.join(' · ')
}

/** 下载百分比的数字滚动:GSAP 接管计数 span 的文本,React 只递 value,两边不打架。
 *  进度事件来一次滚一次,中途新值从旧动画的当前位置续滚(不回跳);
 *  系统关了动画就直接写死数字,一分不少 */
function AnimatedNumber({
  value,
  suffix = ''
}: {
  value: number
  suffix?: string
}): React.JSX.Element {
  const spanRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef(value)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  useEffect(() => {
    const el = spanRef.current
    if (!el) return
    const write = (v: number): void => {
      el.textContent = `${Math.round(v)}${suffix}`
    }
    if (shownRef.current === value) {
      write(value)
      return
    }
    tweenRef.current?.kill()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = value
      write(value)
      return
    }
    const proxy = { val: shownRef.current }
    tweenRef.current = gsap.to(proxy, {
      val: value,
      duration: 0.5,
      ease: 'power1.out',
      onUpdate: () => {
        shownRef.current = proxy.val
        write(proxy.val)
      }
    })
    return () => {
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [value, suffix])
  return <span ref={spanRef} className="shelf-dl-pct" />
}

/** 文件行上的下载区:百分比/体积 + 进度条 + 取消;下完显示「已就位」 */
function DownloadCell({
  active,
  onDownload,
  onCancel
}: {
  active: DownloadState | null
  onDownload: () => void
  onCancel: () => void
}): React.JSX.Element {
  const donePath = active?.donePath ?? null
  const pct =
    active !== null && donePath === null && active.totalBytes !== null && active.totalBytes > 0
      ? Math.min(100, Math.round((active.receivedBytes / active.totalBytes) * 100))
      : null
  if (donePath !== null) {
    return <span className="shelf-dl-done">已下载，配置已自动指向它</span>
  }
  if (active?.error) {
    return (
      <>
        <span className="shelf-dl-error">{active.error}</span>
        <button type="button" className="shelf-dl-btn" onClick={onDownload}>
          重试
        </button>
      </>
    )
  }
  if (active === null) {
    return (
      <button type="button" className="shelf-dl-btn" onClick={onDownload}>
        下载并使用
      </button>
    )
  }
  return (
    <>
      {pct !== null ? (
        <AnimatedNumber value={pct} suffix="%" />
      ) : (
        <span className="shelf-dl-pct">{formatGgufSize(active.receivedBytes)}</span>
      )}
      <span className="shelf-dl-bar" aria-hidden="true">
        <i style={{ width: `${pct ?? 5}%` }} />
      </span>
      <button type="button" className="shelf-dl-btn" onClick={onCancel}>
        取消
      </button>
    </>
  )
}

/** 展开区里的小档案:底座/协议/收藏/总大小,解析不出的整格不渲染 */
function ShelfProfile({ entry }: { entry: ShelfEntry }): React.JSX.Element {
  return (
    <dl className="shelf-profile">
      {entry.baseModel !== null && (
        <div className="shelf-profile-item">
          <dt className="shelf-profile-label">底座模型</dt>
          <dd className="shelf-profile-value" data-tip={entry.baseModel}>
            {entry.baseModel}
          </dd>
        </div>
      )}
      {entry.license !== null && (
        <div className="shelf-profile-item">
          <dt className="shelf-profile-label">开源协议</dt>
          <dd className="shelf-profile-value">{entry.license}</dd>
        </div>
      )}
      <div className="shelf-profile-item">
        <dt className="shelf-profile-label">收藏</dt>
        <dd className="shelf-profile-value">{formatDownloads(entry.likes)}</dd>
      </div>
      {entry.ggufTotalBytes !== null && entry.ggufTotalBytes > 0 && (
        <div className="shelf-profile-item">
          <dt className="shelf-profile-label">模型总大小</dt>
          <dd className="shelf-profile-value">{formatGgufSize(entry.ggufTotalBytes)}</dd>
        </div>
      )}
    </dl>
  )
}

/** 一行货架:主行点了开合;展开区常驻渲染,高度交给 CSS grid-rows 过渡 */
export function ShelfRow({
  entry,
  ramBytes,
  isOpen,
  onToggle,
  files,
  filesLoading,
  download,
  onDownload,
  onCancel
}: {
  entry: ShelfEntry
  ramBytes: number
  isOpen: boolean
  onToggle: () => void
  files: RepoFile[]
  filesLoading: boolean
  download: DownloadState | null
  onDownload: (repoId: string, filePath: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const verdict = judgeRun(entry.ggufTotalBytes, { ramBytes, vramBytes: null })
  return (
    <li
      className={`shelf-item${verdict === 'no' ? ' is-unrunnable' : ''}${isOpen ? ' is-expanded' : ''}`}
    >
      <button type="button" className="shelf-row" onClick={onToggle} aria-expanded={isOpen}>
        <span className="shelf-main">
          <span className="shelf-name" data-tip={entry.id}>
            {entry.id}
            {entry.paramScale !== null && <span className="shelf-params">{entry.paramScale}</span>}
          </span>
          <span className="shelf-sub">{shelfSubLine(entry)}</span>
        </span>
        <span className="shelf-verdict-slot">
          {verdict !== 'yes' && (
            <span className={`shelf-verdict is-${verdict}`} data-tip={VERDICT_TIPS[verdict]}>
              {runVerdictLabel(verdict)}
            </span>
          )}
        </span>
        <span className="shelf-size">{formatGgufSize(entry.ggufTotalBytes)}</span>
        <i className={`shelf-chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {/* 常驻渲染 + is-open 切换:高度交给 CSS grid-rows 过渡;收起时 inert,里面的按钮聚焦不到。
          inner 是纯裁剪层(零 padding 零边框),呼吸和分隔都住 pad —— 不然收起漏一条「乱码」 */}
      <div className={`shelf-files${isOpen ? ' is-open' : ''}`} inert={!isOpen}>
        <div className="shelf-files-inner">
          <div className="shelf-files-pad">
            <ShelfProfile entry={entry} />
            {filesLoading && <p className="shelf-note is-soft">正在读取仓库文件</p>}
            {!filesLoading && files.length === 0 && (
              <p className="shelf-note is-soft">未找到可下载的模型文件</p>
            )}
            {files.map((f) => {
              const active =
                download && download.repoId === entry.id && download.filePath === f.path
                  ? download
                  : null
              return (
                <div key={f.path} className="shelf-file-row">
                  <span className="shelf-file-path" data-tip={f.path}>
                    {f.path}
                  </span>
                  {f.quantNote !== null && <span className="shelf-quant">{f.quantNote}</span>}
                  <span className="shelf-meta">{formatGgufSize(f.sizeBytes)}</span>
                  <DownloadCell
                    active={active}
                    onDownload={() => onDownload(entry.id, f.path)}
                    onCancel={onCancel}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </li>
  )
}
