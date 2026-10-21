// 翻译镜像页签的正文:只读、虚拟(不落盘);译文按块陆续上屏,骨架先占位。
// 顶部一条浅色状态行只报进度与出口(取消/重译/复制),不抢正文的注意力。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fileBaseName } from '@shared/fileRename'
import { splitMdBlocks } from '@shared/mdBlocks'
import { translateLang } from '@shared/translateLangs'
import {
  hoveredBlockOf,
  linkMdFile,
  mdFileKey,
  setHoveredBlock,
  subscribeMdHover,
  unlinkMdFile
} from '../mdHoverLink'
import {
  cancelTranslate,
  getTranslateJob,
  restartTranslate,
  startTranslate,
  subscribeTranslate,
  translateKey
} from '../translateStore'
import { registerMdScroll } from '../mdScrollSync'
import { bindDocZoomWheel, useDocZoom } from '../docZoom'
import { InlineTitle } from './InlineTitle'
import { LinkedMdView } from './LinkedMdView'

export function TranslationView({
  rootPath,
  relPath,
  lang
}: {
  rootPath: string
  relPath: string
  lang: string
}): React.JSX.Element {
  const key = translateKey(rootPath, relPath, lang)
  const fileKey = mdFileKey(rootPath, relPath)
  const job = useSyncExternalStore(subscribeTranslate, () => getTranslateJob(key))
  const hovered = useSyncExternalStore(subscribeMdHover, () => hoveredBlockOf(fileKey))
  const [source, setSource] = useState<{ text: string; error: string | null } | null>(null)

  // 原文只读一遍:块序号由它定,译文回来按号入住
  useEffect(() => {
    let alive = true
    window.atlas
      .readPreview(rootPath, relPath)
      .then((res) => {
        if (!alive) return
        if (res.status === 'ok') setSource({ text: res.text, error: null })
        else setSource({ text: '', error: res.reason || '这个文件读不出来' })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setSource({ text: '', error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      alive = false
    }
  }, [rootPath, relPath])

  // 挂链:原文那侧据此把阅读稿换成同号的块视图
  useEffect(() => {
    linkMdFile(fileKey)
    return () => unlinkMdFile(fileKey)
  }, [fileKey])

  const displayTitle = fileBaseName(relPath.split(/[\\/]/).pop() ?? '')

  useEffect(() => {
    if (!source || source.text === '') return
    startTranslate({ rootPath, relPath, lang, text: source.text, title: displayTitle })
  }, [source, rootPath, relPath, lang, displayTitle])

  const blocks = useMemo(() => (source ? splitMdBlocks(source.text) : []), [source])
  const bodyRef = useRef<HTMLDivElement>(null)
  const docZoom = useDocZoom()
  // 滚动联动:译文栏在滚时,原文栏按同一块号跟到同一高度(和原文侧登记在同一个文件账上)
  useEffect(() => {
    const el = bodyRef.current
    if (el === null || blocks.length === 0) return
    return registerMdScroll(fileKey, key, el)
  }, [fileKey, key, blocks.length])
  // Ctrl+滚轮字号与阅读档同一本账:译文栏自己也能捏合/滚轮换档
  useEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    return bindDocZoomWheel(el)
  }, [])
  const texts = job?.texts ?? []
  const shownTitle = job?.title || displayTitle
  const label = translateLang(lang)?.label ?? lang
  const total = job?.total ?? 0
  const done = job?.doneCount ?? 0
  const running = job?.status === 'running'

  const status = !source
    ? '正在读原文…'
    : source.error
      ? source.error
      : job?.status === 'error'
        ? job.error
        : job?.status === 'cancelled'
          ? '已取消'
          : !job || (running && total === 0)
            ? '正在送去翻译…'
            : running
              ? `正在翻译 ${done}/${total}`
              : `翻译完成 · 共 ${total} 段`

  function copyAll(): void {
    const parts = blocks.map((b) => texts[b.index] ?? '').filter((t) => t !== '')
    if (parts.length === 0) return
    void navigator.clipboard.writeText(parts.join('\n\n'))
  }

  return (
    <div className="trans-view">
      <div className="trans-head">
        <span className={`trans-status${job?.status === 'error' ? ' is-error' : ''}`}>
          {job?.status === 'done' && '✓ '}
          {status}
          <span className="trans-lang">{label}</span>
        </span>
        <span className="trans-actions">
          {running && (
            <button type="button" className="trans-act" onClick={() => cancelTranslate(key)}>
              取消
            </button>
          )}
          {!running && source !== null && source.text !== '' && (
            <button
              type="button"
              className="trans-act"
              onClick={() =>
                restartTranslate({
                  rootPath,
                  relPath,
                  lang,
                  text: source.text,
                  title: displayTitle
                })
              }
            >
              重新翻译
            </button>
          )}
          <button type="button" className="trans-act" onClick={copyAll} disabled={done === 0}>
            复制译文
          </button>
        </span>
      </div>
      <div
        className="trans-body"
        ref={bodyRef}
        style={{ '--doc-zoom': docZoom } as React.CSSProperties}
      >
        <article className="code-reading">
          {shownTitle !== '' && <InlineTitle title={shownTitle} />}
          {source === null ? (
            <div className="trans-placeholder">
              <div className="md-block-skeleton" aria-hidden="true" />
              <div className="md-block-skeleton" aria-hidden="true" />
              <div className="md-block-skeleton" aria-hidden="true" />
            </div>
          ) : source.error ? (
            <p className="trans-placeholder-text">{source.error}</p>
          ) : (
            <LinkedMdView
              blocks={blocks}
              texts={texts}
              hovered={hovered}
              onHover={(block) => setHoveredBlock(fileKey, block)}
            />
          )}
        </article>
      </div>
    </div>
  )
}
