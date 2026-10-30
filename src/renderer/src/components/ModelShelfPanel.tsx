// 模型货架(2026-09-16,2026-09-18 三次打磨):从抱抱脸拉实时 GGUF 榜,零判断纯事实。
// 准入(产品定):不是文本打底的一律过滤 —— 产品只要文字/工具调用/视觉,语音/向量/分类不上架。
// 能力章(眼/工具/脑)2026-09-18 小葵裁定撤下:抱抱脸 API 没有工具/思考的标准字段,tags 覆盖率
// 又太低,拿不到准数据就不装懂 —— 以后数据可靠了再议。
// 行排版:名字做主角,下载/收藏/时间缩进副行;状态章(超出/接近内存预算)→体积→箭头定宽列对齐。
// 列表分页:默认 20 条 + 「加载更多」;筛选/排序存 localStorage,下次打开照旧。
// 信息量(2026-09-18 产品定):参数量级/收藏/底座/协议/量化翻译全上 —— 这 app 本来就是看文件的,
// 货架的信息量不能寒酸;全是 API 原样事实,解析不出就不显示。
// 动效(GSAP 点睛两处):下载百分比数字滚动(在 ShelfRow)/ 展开清单错落淡入(在本文件);
// 全部尊重系统「减少动态效果」,关了动画功能一分不变。高度过渡归 CSS,GSAP 不碰布局属性。
// 数据侧住在 useModelShelf,单行渲染住在 ShelfRow。
import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ProgressDots } from './ProgressDots.tsx'
import { applyShelfQuery, type ShelfQuery } from '../../../shared/modelShelf.ts'
import { loadShelfPrefs, saveShelfPrefs, type ShelfPrefs } from '../shelfPrefs.ts'
import { useModelShelf } from '../useModelShelf.ts'
import { ShelfRow } from './ShelfRow.tsx'

gsap.registerPlugin(useGSAP)

/** 一屏先画几行;「加载更多」每次多画的行数(榜单总量 60,数据已在内存,翻页零请求) */
const PAGE_SIZE = 20

export function ModelShelfPanel({
  onModelReady
}: {
  onModelReady?: (finalPath: string) => void
}): React.JSX.Element {
  const {
    shelf,
    error,
    loading,
    retryShelf,
    expanded,
    toggleRepo,
    files,
    filesLoading,
    download,
    startDownload,
    cancelDownload
  } = useModelShelf(onModelReady)
  // 筛选偏好:从 localStorage 起步(下次打开照旧),每改一次落一次档
  const [maxGb, setMaxGb] = useState<number | null>(() => loadShelfPrefs().maxGb)
  const [sortBy, setSortBy] = useState<ShelfQuery['sortBy']>(() => loadShelfPrefs().sortBy)
  const [desc, setDesc] = useState(() => loadShelfPrefs().desc)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  // GSAP 动效的作用域:面板根节点(展开淡入在这棵树里找目标)
  const panelRef = useRef<HTMLDivElement>(null)

  /** 改筛选的统一入口:内存生效 + 落档 + 分页回到第一页 */
  function applyPrefs(next: ShelfPrefs): void {
    setMaxGb(next.maxGb)
    setSortBy(next.sortBy)
    setDesc(next.desc)
    setVisibleCount(PAGE_SIZE)
    saveShelfPrefs(next)
  }

  // GSAP 点睛(数字滚动在 ShelfRow 里,这是另一处)
  // 展开清单错落淡入:高度过渡归 CSS(grid-rows),GSAP 只管内容逐项浮现;
  // 首版 4px/0.25s 被高度变化整个掩盖(小葵实测看不见),8px/0.3s 才从过渡里透出来
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

  return (
    <div className="shelf" ref={panelRef}>
      {/* 超大圆角内框(小葵设计稿):筛选栏+列表+状态提示装进同一个框,框内一个底色 */}
      <div className="shelf-frame">
        <div className="shelf-toolbar">
          <div className="shelf-filter-group">
            <span className="shelf-filter-label">大小</span>
            <select
              className="cfg-select shelf-sel"
              aria-label="大小筛选"
              value={maxGb === null ? '' : String(maxGb)}
              onChange={(e) =>
                applyPrefs({
                  maxGb: e.target.value === '' ? null : Number(e.target.value),
                  sortBy,
                  desc
                })
              }
            >
              <option value="">不限</option>
              {[4, 8, 16, 32].map((gb) => (
                <option key={gb} value={gb}>
                  ≤ {gb} GB
                </option>
              ))}
            </select>
          </div>
          <div className="shelf-filter-group">
            <span className="shelf-filter-label">排序</span>
            <select
              className="cfg-select shelf-sel"
              aria-label="排序"
              value={`${sortBy}:${desc ? 'desc' : 'asc'}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(':')
                applyPrefs({
                  maxGb,
                  sortBy: s as ShelfQuery['sortBy'],
                  desc: d === 'desc'
                })
              }}
            >
              <option value="downloads:desc">最热门</option>
              <option value="downloads:asc">最冷门</option>
              <option value="lastModified:desc">最新</option>
              <option value="lastModified:asc">最旧</option>
            </select>
          </div>
        </div>

        {loading && (
          <p className="shelf-note">
            <ProgressDots /> 正在加载实时榜单
          </p>
        )}
        {error && (
          <p className="shelf-note is-error">
            {error}
            <button type="button" className="shelf-retry-btn" onClick={retryShelf}>
              重试
            </button>
          </p>
        )}

        {shelf && visibleAll.length === 0 && !loading && (
          <p className="shelf-note is-soft">该大小上限下无模型，放宽上限后重试</p>
        )}

        {/* 列表连同「加载更多」一起放进滚动窗口:货架再长也不超一屏,筛选栏永远在场 */}
        <div className="shelf-scroll">
          <ul className="shelf-list">
            {visible.map((entry) => (
              <ShelfRow
                key={entry.id}
                entry={entry}
                ramBytes={shelf?.ramBytes ?? 0}
                isOpen={expanded === entry.id}
                onToggle={() => toggleRepo(entry.id)}
                files={files[entry.id] ?? []}
                filesLoading={filesLoading}
                download={download}
                onDownload={startDownload}
                onCancel={cancelDownload}
              />
            ))}
          </ul>

          {hiddenCount > 0 && (
            <div className="shelf-more">
              <button
                type="button"
                aria-label={`加载更多，还有 ${hiddenCount} 个模型未显示`}
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                加载更多
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
