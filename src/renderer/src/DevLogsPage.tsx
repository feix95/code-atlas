// 第八十七锤:Developer 日志窗口 —— LM Studio 同款的后台透明度。
// 引擎原话(llama-server 吐的每一行)、请求报账(提问/完成/token 账/耗时)、应用记账
// (启动/就绪/退出/收尸)全在这一本账里。独立小窗,主窗干活它旁观。
// 隐私线:账本只记元数据和引擎输出,用户问了什么、材料里有什么,一个字不进账。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DevLogEntry, DevLogSource } from '../../shared/types.ts'
import { devLogSourceName, formatDevLogTime } from '../../shared/devlog.ts'

/** 窗口端自己也对齐账本容量:订阅久了别让浏览器端悄悄长胖 */
const PAGE_MAX = 2000

type SourceFilter = 'all' | DevLogSource

const SOURCE_CHIPS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'engine', label: '引擎' },
  { key: 'request', label: '请求' },
  { key: 'system', label: '应用' }
]

export function DevLogsPage(): React.JSX.Element {
  const [entries, setEntries] = useState<DevLogEntry[]>([])
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [filterText, setFilterText] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [copyNote, setCopyNote] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const autoRef = useRef(autoScroll)

  useEffect(() => {
    autoRef.current = autoScroll
  }, [autoScroll])

  // 开窗先补一遍旧账,再订阅新账;退订防泄漏
  useEffect(() => {
    let alive = true
    const off = window.atlas.onDevLog((entry) => {
      if (!alive) return
      setEntries((prev) => {
        // 按 id 去重(拉旧账和订阅可能有重叠瞬间),超容量丢最旧的
        if (prev.length > 0 && prev[prev.length - 1].id >= entry.id) return prev
        const next = prev.length >= PAGE_MAX ? [...prev.slice(-(PAGE_MAX - 1)), entry] : [...prev, entry]
        return next
      })
    })
    void window.atlas
      .devLogsPull()
      .then((snapshot) => {
        if (alive) setEntries(snapshot.slice(-PAGE_MAX))
      })
      .catch(() => {})
    return () => {
      alive = false
      off()
    }
  }, [])

  // 自动滚动:新账进来贴着底;用户往上翻了就先不打扰(勾选框自己会取消)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && autoRef.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const onListScroll = (): void => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!atBottom && autoRef.current) setAutoScroll(false)
  }

  const filtered =
    sourceFilter === 'all' && filterText.trim() === ''
      ? entries
      : entries.filter((e) => {
          if (sourceFilter !== 'all' && e.source !== sourceFilter) return false
          const q = filterText.trim().toLowerCase()
          return q === '' || e.text.toLowerCase().includes(q)
        })

  const asText = (): string =>
    filtered.map((e) => `[${formatDevLogTime(e.ts)}] [${devLogSourceName(e.source)}] ${e.text}`).join('\n')

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(asText())
      setCopyNote('已复制')
    } catch {
      setCopyNote('复制失败')
    }
    setTimeout(() => setCopyNote(''), 1500)
  }

  const clearAll = (): void => {
    void window.atlas.devLogsClear().catch(() => {})
    setEntries([])
  }

  return (
    <div className="devlog">
      <header className="devlog-head">
        <span className="devlog-title">
          Developer 日志
          <small>引擎原话 · 请求报账 · 应用记账 —— 只记元数据,问题内容不进账</small>
        </span>
        <span className="devlog-count mono">{filtered.length === entries.length ? `${entries.length} 条` : `${filtered.length} / ${entries.length} 条`}</span>
        <button
          type="button"
          className="devlog-close"
          title="关闭"
          aria-label="关闭日志窗口"
          onClick={() => void window.atlas.windowClose()}
        >
          ×
        </button>
      </header>

      <div className="devlog-toolbar">
        <div className="devlog-chips" role="group" aria-label="按来源筛选">
          {SOURCE_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`chip-link${sourceFilter === chip.key ? ' is-on' : ''}`}
              onClick={() => setSourceFilter(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          className="devlog-filter"
          type="text"
          placeholder="筛一筛……(认行里的字)"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <label className="devlog-auto">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          跟到底
        </label>
        <button type="button" className="devlog-tool" onClick={() => void copyAll()}>
          {copyNote || '复制全部'}
        </button>
        <button type="button" className="devlog-tool" onClick={clearAll}>
          清空
        </button>
      </div>

      <div className="devlog-list" ref={listRef} onScroll={onListScroll}>
        {filtered.length === 0 ? (
          <p className="devlog-empty">
            {entries.length === 0
              ? '账本干干净净 —— 等引擎吐第一行字(首次用 AI 时它才会醒)'
              : '没有对得上筛子的行:换个来源或换个词试试'}
          </p>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className={`devlog-row is-${e.source}`}>
              <time className="mono">{formatDevLogTime(e.ts)}</time>
              <span className="devlog-tag">{devLogSourceName(e.source)}</span>
              <span className="devlog-text">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
