// 模型货架(2026-09-16,2026-09-18 三次打磨):从抱抱脸拉实时 GGUF 榜,零判断纯事实。
// 准入(小葵定):不是文本打底的一律过滤 —— 产品只要文字/工具调用/视觉,语音/向量/分类不上架。
// 能力章(眼/锤/脑)2026-09-18 小葵裁定撤下:抱抱脸 API 没有工具/思考的标准字段,tags 覆盖率
// 又太低,拿不到准数据就不装懂 —— 以后数据可靠了再议。
// 行排版:名字做主角,下载/收藏/时间缩进副行;状态章(超出/接近内存预算)→体积→箭头定宽列对齐。
// 列表分页:默认 20 条 + 「加载更多」;筛选/排序存 localStorage,下次打开照旧。
// 信息量(2026-09-18 小葵定):参数量级/收藏/底座/协议/量化翻译全上 —— 这 app 本来就是看文件的,
// 货架的信息量不能寒酸;全是 API 原样事实,解析不出就不显示。
// 动效(GSAP 点睛三处):推荐卡入场 / 下载百分比数字滚动 / 展开清单错落淡入;
// 全部尊重系统「减少动态效果」,关了动画功能一分不变。高度过渡归 CSS,GSAP 不碰布局属性。
import { useCallback, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ProgressDots } from './ProgressDots.tsx'
import {
  formatGgufSize,
  type ModelDownloadProgress,
  type RepoFile,
  type ShelfEntry,
  type ShelfQuery
} from '../../../shared/modelShelf.ts'
import {
  applyShelfQuery,
  formatDownloads,
  formatRelativeDays,
  judgeRun,
  MODEL_FIT_RAM_MAX_RATIO,
  runVerdictLabel
} from '../../../shared/modelShelf.ts'
import { loadShelfPrefs, saveShelfPrefs, type ShelfPrefs } from '../shelfPrefs.ts'

gsap.registerPlugin(useGSAP)

/** 一屏先画几行;「加载更多」每次多画的行数(榜单总量 60,数据已在内存,翻页零请求) */
const PAGE_SIZE = 20

/** 推荐模型(2026-09-18 小葵定):货架顶部的预置一键下载,新用户(默认内置引擎、还没模型)的第一步。
 *  仓库与文件路径哥实测核过(mradermacher 仓,文件一字不差,8.9 GB);榜单断网它也在 —— 不依赖货架数据 */
const FEATURED_MODEL = {
  repoId: 'mradermacher/Ornith-1.5-9B-uncensored-GGUF',
  filePath: 'Ornith-1.5-9B-uncensored.Q8_0.gguf',
  sizeLabel: '8.9 GB'
} as const

/** 状态章的悬停大白话:专业词上章,人话兜底 —— 判定口径(内存 × 系数预算)在这儿说清,
 *  系数跟判定函数同一份户口(shared/modelShelf 的 MODEL_FIT_*),调了不会文案对不上账 */
const VERDICT_TIPS: Record<'no' | 'tight', string> = {
  no: `模型体积超出这台机器的可用内存预算(总内存 × ${MODEL_FIT_RAM_MAX_RATIO},给系统留活路),下载了也加载不起来`,
  tight: '接近内存预算上限,能跑但可能偏慢'
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

interface ShelfState {
  entries: ShelfEntry[]
  ramBytes: number
}

/** 下载中的那单(进度条用);donePath = 刚下完的(显示「已就位」) */
interface DownloadState {
  repoId: string
  filePath: string
  receivedBytes: number
  totalBytes: number | null
  donePath: string | null
}

export function ModelShelfPanel({
  onModelReady
}: {
  onModelReady?: (finalPath: string) => void
}): React.JSX.Element {
  const [shelf, setShelf] = useState<ShelfState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 挂载就要拉货,初始 loading 即 true,不在 effect 里同步 set(会级联渲染) */
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, RepoFile[]>>({})
  const [filesLoading, setFilesLoading] = useState(false)
  // 筛选偏好:从 localStorage 起步(下次打开照旧),每改一次落一次档
  const [maxGb, setMaxGb] = useState<number | null>(() => loadShelfPrefs().maxGb)
  const [sortBy, setSortBy] = useState<ShelfQuery['sortBy']>(() => loadShelfPrefs().sortBy)
  const [desc, setDesc] = useState(() => loadShelfPrefs().desc)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [download, setDownload] = useState<DownloadState | null>(null)
  // GSAP 动效的作用域:面板根节点(推荐卡入场/展开淡入都在这棵树里找目标)
  const panelRef = useRef<HTMLDivElement>(null)
  const featuredRef = useRef<HTMLElement>(null)
  // 拉货序号:点「再试一次」作废在飞的旧请求,慢回来的旧响应不许覆盖新状态
  const shelfSeqRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 发榜单请求(挂载第一拉和断网重试共用):序号作废旧请求,慢回来的旧响应不许覆盖新状态 */
  const fetchShelf = useCallback(() => {
    const seq = ++shelfSeqRef.current
    window.atlas
      .modelShelf()
      .then((r) => {
        if (mountedRef.current && seq === shelfSeqRef.current) {
          setShelf({ entries: r.entries, ramBytes: r.spec.ramBytes })
        }
      })
      .catch(() => {
        if (mountedRef.current && seq === shelfSeqRef.current) {
          setError('榜单没拉下来,可能是网络不通。检查网络后再试一次。')
        }
      })
      .finally(() => {
        if (mountedRef.current && seq === shelfSeqRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchShelf()
  }, [fetchShelf])

  /** 「再试一次」:先把状态拨回「进行中」再发请求(挂载那轮不用,初始就是 loading) */
  const retryShelf = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchShelf()
  }, [fetchShelf])

  /** 改筛选的统一入口:内存生效 + 落档 + 分页回到第一页 */
  function applyPrefs(next: ShelfPrefs): void {
    setMaxGb(next.maxGb)
    setSortBy(next.sortBy)
    setDesc(next.desc)
    setVisibleCount(PAGE_SIZE)
    saveShelfPrefs(next)
  }

  // 下载进度:主进程边下边喊,这儿只管画;finalPath 到了 = 完成,报给设置页自动填路径
  useEffect(() => {
    const off = window.atlas.onModelDownloadProgress((p: ModelDownloadProgress) => {
      if (p.finalPath) {
        setDownload((prev) => (prev ? { ...prev, donePath: p.finalPath } : prev))
        onModelReady?.(p.finalPath)
      } else if (!p.error && !p.cancelled) {
        setDownload((prev) =>
          prev ? { ...prev, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes } : prev
        )
      }
    })
    return off
  }, [onModelReady])

  const startDownload = useCallback((repoId: string, filePath: string) => {
    setDownload({ repoId, filePath, receivedBytes: 0, totalBytes: null, donePath: null })
    window.atlas.modelDownloadStart(repoId, filePath).catch(() => {
      // 失败/取消:进度事件里已带人话,这里把行上状态松开
      setDownload(null)
    })
  }, [])

  const cancelDownload = useCallback(() => {
    void window.atlas.modelDownloadCancel()
  }, [])

  useEffect(() => {
    let alive = true
    window.atlas
      .modelShelf()
      .then((r) => {
        if (!alive) return
        setShelf({ entries: r.entries, ramBytes: r.spec.ramBytes })
      })
      .catch(() => {
        if (alive) setError('货架没拉下来:网络不通,或者两个数据源都在打盹。检查一下网络再重试。')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const toggleRepo = useCallback(
    (repoId: string) => {
      if (expanded === repoId) {
        setExpanded(null)
        return
      }
      setExpanded(repoId)
      if (!files[repoId]) {
        setFilesLoading(true)
        window.atlas
          .modelFiles(repoId)
          .then((list) => setFiles((prev) => ({ ...prev, [repoId]: list })))
          .catch(() => setFiles((prev) => ({ ...prev, [repoId]: [] })))
          .finally(() => setFilesLoading(false))
      }
    },
    [expanded, files]
  )

  // ── GSAP 点睛(数字滚动在 AnimatedNumber 里,这是另两处)──
  // ① 推荐卡入场:面板展开时一次性的下滑淡入 —— 首版 6px/0.35s 太轻,肉眼无感(小葵实测),
  //   提到 14px/0.45s:能明确感觉到「滑进来」,但不晃;matchMedia 挂着「减少动态效果」,关了动画就原样出现
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        const reduce = ctx.conditions?.reduceMotion === true
        if (reduce || !featuredRef.current) return
        gsap.from(featuredRef.current, { y: -14, autoAlpha: 0, duration: 0.45, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { scope: panelRef }
  )

  // ② 展开清单错落淡入:高度过渡归 CSS(grid-rows),GSAP 只管内容逐项浮现;
  //   首版 4px/0.25s 被高度变化整个掩盖(小葵实测看不见),8px/0.3s 才从过渡里透出来
  useGSAP(
    () => {
      if (expanded === null) return
      const rows = panelRef.current?.querySelectorAll(
        '.shelf-files.is-open .shelf-profile, .shelf-files.is-open .shelf-file-row, .shelf-files.is-open .shelf-note'
      )
      if (!rows || rows.length === 0) return
      const mm = gsap.matchMedia()
      mm.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, (ctx) => {
        if (ctx.conditions?.reduceMotion === true) return
        gsap.from(rows, { autoAlpha: 0, y: 8, duration: 0.3, stagger: 0.05, ease: 'power1.out' })
      })
      return () => mm.revert()
    },
    { scope: panelRef, dependencies: [expanded] }
  )

  // ③ 展开后的导航:清单在滚动窗口里长出来了,把这一行滚到看得见的位置(不算动效,算带路)
  useEffect(() => {
    if (expanded === null) return
    panelRef.current?.querySelector('.shelf-item.is-expanded')?.scrollIntoView({ block: 'nearest' })
  }, [expanded])

  const visibleAll = shelf
    ? applyShelfQuery(shelf.entries, {
        maxBytes: maxGb === null ? null : maxGb * 1024 ** 3,
        sortBy,
        desc
      })
    : []
  const visible = visibleAll.slice(0, visibleCount)
  const hiddenCount = visibleAll.length - visible.length

  // 推荐卡的下载状态:跟展开区共用同一份 download 账,认 repoId+文件路径
  const featuredActive =
    download &&
    download.repoId === FEATURED_MODEL.repoId &&
    download.filePath === FEATURED_MODEL.filePath
      ? download
      : null
  const featuredDone = featuredActive?.donePath ?? null
  const featuredPct =
    featuredActive !== null &&
    featuredDone === null &&
    featuredActive.totalBytes !== null &&
    featuredActive.totalBytes > 0
      ? Math.min(100, Math.round((featuredActive.receivedBytes / featuredActive.totalBytes) * 100))
      : null

  return (
    <div className="shelf" ref={panelRef}>
      <section className="shelf-featured" aria-label="推荐模型" ref={featuredRef}>
        <div className="shelf-featured-card">
          <div className="shelf-featured-info">
            {/* 两行收束(2026-09-18 小葵定):「推荐模型」标签并进名字行,不再独占一行 */}
            <span className="shelf-featured-name">
              <span className="shelf-featured-tag">推荐模型</span>
              Ornith-1.5-9B-uncensored(Q8_0)
            </span>
            <span className="shelf-featured-sub">
              {FEATURED_MODEL.sizeLabel} · 下载完自动配置好,即下即用
            </span>
          </div>
          {featuredDone !== null ? (
            <span className="shelf-dl-done">✓ 已就位,配置已自动指向它</span>
          ) : featuredActive !== null ? (
            <div className="shelf-featured-progress">
              {featuredPct !== null ? (
                <AnimatedNumber value={featuredPct} suffix="%" />
              ) : (
                <span className="shelf-dl-pct">{formatGgufSize(featuredActive.receivedBytes)}</span>
              )}
              <span className="shelf-dl-bar" aria-hidden="true">
                <i style={{ width: `${featuredPct ?? 5}%` }} />
              </span>
              <button type="button" className="shelf-dl-btn" onClick={cancelDownload}>
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="shelf-dl-btn shelf-featured-btn"
              onClick={() => startDownload(FEATURED_MODEL.repoId, FEATURED_MODEL.filePath)}
            >
              下载并使用
            </button>
          )}
        </div>
      </section>

      {/* 超大圆角内框(小葵设计稿):筛选栏+列表+状态提示装进同一个框,框内一个底色 */}
      <div className="shelf-frame">
        <div className="shelf-toolbar">
          <div className="shelf-filter-group" role="group" aria-label="大小筛选">
            <span className="shelf-filter-label">大小</span>
            {([null, 4, 8, 16, 32] as const).map((gb) => (
              <button
                key={String(gb)}
                type="button"
                className={`shelf-chip${maxGb === gb ? ' is-on' : ''}`}
                onClick={() => applyPrefs({ maxGb: gb, sortBy, desc })}
              >
                {gb === null ? '不限' : `≤ ${gb} GB`}
              </button>
            ))}
          </div>
          <div className="shelf-filter-group" role="group" aria-label="排序">
            <span className="shelf-filter-label">排序</span>
            <button
              type="button"
              className={`shelf-chip${sortBy === 'downloads' && desc ? ' is-on' : ''}`}
              onClick={() => applyPrefs({ maxGb, sortBy: 'downloads', desc: true })}
            >
              最热门
            </button>
            <button
              type="button"
              className={`shelf-chip${sortBy === 'downloads' && !desc ? ' is-on' : ''}`}
              onClick={() => applyPrefs({ maxGb, sortBy: 'downloads', desc: false })}
            >
              最冷门
            </button>
            <button
              type="button"
              className={`shelf-chip${sortBy === 'lastModified' && desc ? ' is-on' : ''}`}
              onClick={() => applyPrefs({ maxGb, sortBy: 'lastModified', desc: true })}
            >
              最新
            </button>
            <button
              type="button"
              className={`shelf-chip${sortBy === 'lastModified' && !desc ? ' is-on' : ''}`}
              onClick={() => applyPrefs({ maxGb, sortBy: 'lastModified', desc: false })}
            >
              最旧
            </button>
          </div>
        </div>

        {loading && (
          <p className="shelf-note">
            <ProgressDots /> 正在拉实时榜单,几秒钟的事……
          </p>
        )}
        {error && (
          <p className="shelf-note is-error">
            {error}
            <button type="button" className="shelf-retry-btn" onClick={retryShelf}>
              再试一次
            </button>
          </p>
        )}

        {shelf && visibleAll.length === 0 && !loading && (
          <p className="shelf-note is-soft">这个大小上限下没有模型,放宽一点试试。</p>
        )}

        {/* 列表连同「加载更多」一起放进滚动窗口:货架再长也不超一屏,筛选栏和推荐卡永远在场 */}
        <div className="shelf-scroll">
          <ul className="shelf-list">
            {visible.map((entry) => {
              const verdict = judgeRun(entry.ggufTotalBytes, {
                ramBytes: shelf?.ramBytes ?? 0,
                vramBytes: null
              })
              const isOpen = expanded === entry.id
              return (
                <li
                  key={entry.id}
                  className={`shelf-item${verdict === 'no' ? ' is-unrunnable' : ''}${isOpen ? ' is-expanded' : ''}`}
                >
                  <button
                    type="button"
                    className="shelf-row"
                    onClick={() => toggleRepo(entry.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="shelf-main">
                      <span className="shelf-name" data-tip={entry.id}>
                        {entry.id}
                        {entry.paramScale !== null && (
                          <span className="shelf-params">{entry.paramScale}</span>
                        )}
                      </span>
                      <span className="shelf-sub">{shelfSubLine(entry)}</span>
                    </span>
                    <span className="shelf-verdict-slot">
                      {verdict !== 'yes' && (
                        <span
                          className={`shelf-verdict is-${verdict}`}
                          data-tip={VERDICT_TIPS[verdict]}
                        >
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
                              <dd className="shelf-profile-value">
                                {formatGgufSize(entry.ggufTotalBytes)}
                              </dd>
                            </div>
                          )}
                        </dl>
                        {filesLoading && (
                          <p className="shelf-note is-soft">正在看这个仓库里有什么文件……</p>
                        )}
                        {!filesLoading && (files[entry.id]?.length ?? 0) === 0 && (
                          <p className="shelf-note is-soft">
                            这个仓库里没认出可以直接下载的模型文件。
                          </p>
                        )}
                        {(files[entry.id] ?? []).map((f) => {
                          const active =
                            download && download.repoId === entry.id && download.filePath === f.path
                              ? download
                              : null
                          const donePath = active?.donePath ?? null
                          const pct =
                            active !== null &&
                            donePath === null &&
                            active.totalBytes !== null &&
                            active.totalBytes > 0
                              ? Math.min(
                                  100,
                                  Math.round((active.receivedBytes / active.totalBytes) * 100)
                                )
                              : null
                          return (
                            <div key={f.path} className="shelf-file-row">
                              <span className="shelf-file-path" data-tip={f.path}>
                                {f.path}
                              </span>
                              {f.quantNote !== null && (
                                <span className="shelf-quant">{f.quantNote}</span>
                              )}
                              <span className="shelf-meta">{formatGgufSize(f.sizeBytes)}</span>
                              {donePath !== null ? (
                                <span className="shelf-dl-done">✓ 已就位,配置已自动指向它</span>
                              ) : active !== null ? (
                                <>
                                  {pct !== null ? (
                                    <AnimatedNumber value={pct} suffix="%" />
                                  ) : (
                                    <span className="shelf-dl-pct">
                                      {formatGgufSize(active.receivedBytes)}
                                    </span>
                                  )}
                                  <span className="shelf-dl-bar" aria-hidden="true">
                                    <i style={{ width: `${pct ?? 5}%` }} />
                                  </span>
                                  <button
                                    type="button"
                                    className="shelf-dl-btn"
                                    onClick={cancelDownload}
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="shelf-dl-btn"
                                  onClick={() => startDownload(entry.id, f.path)}
                                >
                                  下载并使用
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {hiddenCount > 0 && (
            <div className="shelf-more">
              <button type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                还有 {hiddenCount} 个模型没显示,加载更多
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
