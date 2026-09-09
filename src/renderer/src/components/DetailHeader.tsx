import { useEffect, useRef, useState } from 'react'
import type { NoteEntry } from '@shared/notes'
import { NotePen } from './NotePen'

export interface DetailTabDef {
  key: string
  label: string
}

export interface Crumb {
  label: string
  /** 完整路径,悬停时看全文;不传就只显示 label */
  title?: string
}

export type BadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'muted'

/**
 * 详情区固定头部:面包屑路径 + 实体名 + 副标题 + 徽章 + 关闭钮 + Tab 栏。
 * 头部钉在详情区顶部不跟内容滚 —— 不管滚到哪儿,都知道自己在看谁。
 * 第九十八锤:传了 onNoteSave 就有「写备注」入口 —— 小葵的一句话优先亮成副标题。
 */
export function DetailHeader({
  crumbs,
  icon,
  title,
  subtitle,
  note,
  onNoteSave,
  autoOpenNote,
  badges,
  tabs,
  activeTab,
  onTabChange,
  onClose
}: {
  crumbs: Crumb[]
  icon: string
  title: string
  subtitle?: string
  /** 小葵的手动备注;有它副标题就是她自己的话 */
  note?: NoteEntry | null
  /** 传了才显示备注入口;空串 = 删除备注 */
  onNoteSave?: (text: string) => void
  /** 树上右键「写/编辑备注」时置真:详情头自动展开编辑框(第一百零二锤) */
  autoOpenNote?: boolean
  badges?: Array<{ label: string; tone: BadgeTone }>
  tabs?: DetailTabDef[]
  activeTab?: string
  onTabChange?: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 右键菜单的「写/编辑备注」落到这里:置真就自动展开编辑框,每次挂载只应一次
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenNote && !autoOpenedRef.current && onNoteSave) {
      autoOpenedRef.current = true
      setDraft(note?.text ?? '')
      setEditing(true)
    }
  }, [autoOpenNote, note, onNoteSave])

  function openEditor(): void {
    setDraft(note?.text ?? '')
    setEditing(true)
  }

  function save(): void {
    onNoteSave?.(draft)
    setEditing(false)
  }

  return (
    <header className="detail-header">
      <nav className="crumbs" aria-label="所在位置">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="crumb-group">
            <span className={i === crumbs.length - 1 ? 'crumb is-current' : 'crumb'} title={c.title ?? c.label}>
              {c.label}
            </span>
            {i < crumbs.length - 1 && <span className="crumb-sep">/</span>}
          </span>
        ))}
      </nav>
      <div className="entity-line">
        <span className="entity-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="entity-title">
          <h1 title={title}>{title}</h1>
          {note ? (
            <p className="is-note" title="我的备注">
              <NotePen size={11} /> {note.text}
            </p>
          ) : (
            subtitle && <p>{subtitle}</p>
          )}
        </div>
        {badges?.map((b) => (
          <span key={b.label} className={`badge badge-${b.tone}`}>
            {b.label}
          </span>
        ))}
        {onNoteSave && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => (editing ? setEditing(false) : openEditor())}
            aria-label={note ? '编辑备注' : '写备注'}
            title={note ? '编辑备注' : '写一句话备注'}
          >
            <NotePen size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭详情,回到项目概览">
          ×
        </button>
      </div>
      {editing && (
        <div className="note-editor">
          <input
            autoFocus
            type="text"
            value={draft}
            maxLength={100}
            placeholder="一句话备注:当初为什么建它/它是干嘛的"
            aria-label="备注内容"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button type="button" className="btn btn-primary" onClick={save}>
            保存
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      )}
      {tabs && tabs.length > 0 && (
        <nav className="tabs" aria-label="详情标签">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab${activeTab === t.key ? ' is-active' : ''}`}
              aria-current={activeTab === t.key ? 'page' : undefined}
              onClick={() => onTabChange?.(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  )
}

/** 徽章在详情内容里也要用(如 Git 状态行),单独导出免得重复写类名 */
export function Badge({ label, tone }: { label: string; tone: BadgeTone }): React.JSX.Element {
  return <span className={`badge badge-${tone}`}>{label}</span>
}
