// 「我的方案」库面板(第 5.8 节):列表 + 打开 / 重命名 / 复制 / 快照 / 导出 / 删除。
// 起步页与工作区工具条都从这里进;删除要二次确认,快照可回滚(回滚不改盘上的当前版,下次保存才落)。
import { useEffect, useState } from 'react'
import type { SchemeMeta } from '@shared/uiFrame/types'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import { Notice } from '../Notice'
import { useUiFrameDoc } from '../../uiFrame/docStore'

/** ISO 时间 → 「今天 14:03 / 昨天 / M月d日」人话时间 */
function schemeTimeLabel(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const now = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  if (sameDay(t, now)) return `今天 ${hhmm}`
  const yesterday = new Date(now.getTime() - 86400_000)
  if (sameDay(t, yesterday)) return `昨天 ${hhmm}`
  return `${t.getMonth() + 1}月${t.getDate()}日`
}

const PLATFORM_LABEL: Record<SchemeMeta['platform'], string> = {
  desktop: '电脑端',
  phone: '手机端'
}

/** 方案卡:缩略图 + 名字 + 平台/风格/时间;起步页与库面板共用 */
export function SchemeCard({
  meta,
  onOpen
}: {
  meta: SchemeMeta
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="uf-card uf-scheme"
      aria-label={meta.name}
      onClick={() => onOpen(meta.id)}
    >
      {meta.thumbnail ? (
        <img className="uf-scheme-thumb" src={meta.thumbnail} alt="" />
      ) : (
        <span className="uf-scheme-thumb uf-scheme-thumb-empty" aria-hidden>
          无预览
        </span>
      )}
      <span className="uf-card-name">{meta.name}</span>
      <span className="uf-card-meta">
        {PLATFORM_LABEL[meta.platform]} · {meta.style} · {schemeTimeLabel(meta.modifiedAt)}
      </span>
    </button>
  )
}

/** 命名对话框:另存为 / 重命名 / 复制 共用;确定回调拿到名字 */
function NameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose
}: {
  title: string
  initial: string
  submitLabel: string
  onSubmit: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()
  return (
    <div className="uf-modal-back" role="presentation" onClick={onClose}>
      <div
        className="uf-modal"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="uf-panel-title">{title}</h3>
        <input
          className="uf-input"
          value={name}
          autoFocus
          aria-label="方案名"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onSubmit(trimmed)
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="uf-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!trimmed}
            onClick={() => onSubmit(trimmed)}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 库面板里一行的操作:打开 / 重命名 / 复制 / 快照(展开)/ 导出 / 删除(二次确认) */
function SchemeRow({
  meta,
  askName,
  onClosePanel
}: {
  meta: SchemeMeta
  askName: (dialog: NameAsk) => void
  onClosePanel: () => void
}): React.JSX.Element {
  const [confirmDel, setConfirmDel] = useState(false)
  const [snaps, setSnaps] = useState<string[] | null>(null)

  const toggleSnaps = (): void => {
    if (snaps === null) void schemeActions.snapshots(meta.id).then(setSnaps)
    else setSnaps(null)
  }

  return (
    <li className="uf-lib-row">
      <div className="uf-lib-main">
        {meta.thumbnail ? (
          <img className="uf-lib-thumb" src={meta.thumbnail} alt="" />
        ) : (
          <span className="uf-lib-thumb uf-scheme-thumb-empty" aria-hidden />
        )}
        <div className="uf-lib-text">
          <span className="uf-lib-name">{meta.name}</span>
          <span className="uf-card-meta">
            {PLATFORM_LABEL[meta.platform]} · {meta.style} · {schemeTimeLabel(meta.modifiedAt)}
          </span>
        </div>
      </div>
      <div className="uf-lib-ops">
        <button
          type="button"
          className="uf-link"
          onClick={() => {
            void schemeActions.open(meta.id)
            onClosePanel()
          }}
        >
          打开
        </button>
        <button
          type="button"
          className="uf-link"
          onClick={() =>
            askName({ kind: 'rename', id: meta.id, title: '重命名方案', initial: meta.name })
          }
        >
          重命名
        </button>
        <button
          type="button"
          className="uf-link"
          onClick={() =>
            askName({ kind: 'copy', id: meta.id, title: '复制方案', initial: `${meta.name} 副本` })
          }
        >
          复制
        </button>
        <button type="button" className="uf-link" onClick={toggleSnaps}>
          {snaps === null ? '快照' : '收起快照'}
        </button>
        <button
          type="button"
          className="uf-link"
          onClick={() => void schemeActions.exportScheme(meta.id)}
        >
          导出
        </button>
        <button
          type="button"
          className={`uf-link${confirmDel ? ' uf-link-danger' : ''}`}
          onClick={() => {
            if (!confirmDel) {
              setConfirmDel(true)
              return
            }
            void schemeActions.remove(meta.id)
          }}
        >
          {confirmDel ? '再点一次删除' : '删除'}
        </button>
      </div>
      {snaps !== null && (
        <div className="uf-lib-snaps">
          {snaps.length === 0 && <span className="uf-hint">还没有快照;手动保存一次就有了。</span>}
          {snaps.map((s) => (
            <span key={s} className="uf-lib-snap">
              <code>{s.replace('.json', '')}</code>
              <button
                type="button"
                className="uf-link"
                onClick={() => {
                  void schemeActions.restore(meta.id, s)
                  onClosePanel()
                }}
              >
                回到这版
              </button>
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

interface NameAsk {
  kind: 'rename' | 'copy' | 'saveAs' | 'save'
  id: string | null
  title: string
  initial: string
}

/** 方案库浮层:清单 + 操作;顶栏「保存方案」无户口时也借这里的命名框 */
export function UiFrameLibrary({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { doc } = useUiFrameDoc()
  const { schemes, schemeId, error } = useSchemeState()
  const [ask, setAsk] = useState<NameAsk | null>(null)

  useEffect(() => {
    void schemeActions.refresh()
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const submitName = (name: string): void => {
    const a = ask
    setAsk(null)
    if (!a) return
    if (a.kind === 'save') void schemeActions.save(doc, name)
    if (a.kind === 'saveAs') void schemeActions.saveAs(doc, name)
    if (a.kind === 'rename' && a.id) void schemeActions.rename(a.id, name, doc)
    if (a.kind === 'copy' && a.id) void schemeActions.copy(a.id, name)
  }

  return (
    <div className="uf-modal-back" role="presentation" onClick={onClose}>
      <div
        className="uf-modal uf-lib"
        role="dialog"
        aria-label="我的方案库"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uf-lib-head">
          <h3 className="uf-panel-title">我的方案</h3>
          <div className="uf-lib-head-ops">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setAsk({ kind: 'saveAs', id: null, title: '另存为', initial: `${doc.name} 副本` })
              }
            >
              另存当前
            </button>
            <button type="button" className="btn btn-ghost" onClick={schemeActions.backToStart}>
              新建方案
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {schemeId === null && (
          <Notice kind="info">当前方案还没存进库,点工具条「保存」或这里「另存当前」。</Notice>
        )}
        <ul className="uf-lib-list">
          {(schemes ?? []).map((meta) => (
            <SchemeRow key={meta.id} meta={meta} askName={setAsk} onClosePanel={onClose} />
          ))}
          {schemes !== null && schemes.length === 0 && (
            <li className="uf-hint">库里还没有方案。</li>
          )}
        </ul>
        {ask && (
          <NameDialog
            title={ask.title}
            initial={ask.initial}
            submitLabel={ask.kind === 'save' ? '保存' : '确定'}
            onSubmit={submitName}
            onClose={() => setAsk(null)}
          />
        )}
      </div>
    </div>
  )
}

/** 工具条「保存」的命名框(未入库方案第一次保存要起名) */
export function SaveNameDialog({
  initial,
  onSubmit,
  onClose
}: {
  initial: string
  onSubmit: (name: string) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <NameDialog
      title="保存方案"
      initial={initial}
      submitLabel="保存"
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}
