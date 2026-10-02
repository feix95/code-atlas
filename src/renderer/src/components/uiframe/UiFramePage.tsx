// 「UI 框架」页签(§5):起步页(选平台/模板/我的方案)→ 工具条 + 画布 + 属性面板。
import { useState } from 'react'
import type { ThemeName } from '@shared/uiFrame/types'
import { VIEW_LABEL, type CanvasView } from '../../uiFrame/canvasDoc'
import { docActions, useUiFrameDoc } from '../../uiFrame/docStore'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import type { CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { useUiFrameExport, type ExportState } from '../../uiFrame/useUiFrameExport'
import { Notice } from '../Notice'
import { UiFrameCanvas } from './UiFrameCanvas'
import { UiFrameInspector } from './UiFrameInspector'
import { SaveNameDialog, UiFrameLibrary } from './UiFrameSchemes'
import { UiFrameStart } from './UiFrameStart'

const VIEWS: CanvasView[] = ['wall', 'board', 'page']
const THEMES: Array<[ThemeName, string]> = [
  ['light', '亮色'],
  ['dark', '暗色']
]
const ZOOMS: Array<[fit: boolean, label: string]> = [
  [true, '适应宽度'],
  [false, '实际大小']
]

function isUndoKey(e: KeyboardEvent | React.KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return null
  return e.shiftKey ? 'redo' : 'undo'
}

function handleUndoKey(e: KeyboardEvent | React.KeyboardEvent): void {
  const which = isUndoKey(e)
  if (!which) return
  if (e.target instanceof HTMLInputElement) return
  e.preventDefault()
  docActions[which]()
}

function ExportBanner({
  state,
  onDismiss
}: {
  state: ExportState
  onDismiss: () => void
}): React.JSX.Element | null {
  if (state.kind === 'idle' || state.kind === 'saving') return null
  const close = (
    <button type="button" className="uf-link" onClick={onDismiss}>
      关闭
    </button>
  )
  if (state.kind === 'error') {
    return (
      <Notice kind="error">
        {state.message} {close}
      </Notice>
    )
  }
  if (state.kind === 'blocked') {
    return (
      <Notice kind="error">
        <strong>
          规格包体检没通过,已阻止导出({state.issues.filter((i) => i.level === 'error').length}{' '}
          个错误)
        </strong>
        <ul className="uf-issues">
          {state.issues.map((i, k) => (
            <li key={k}>
              [{i.check}] <code>{i.file}</code>:{i.message}
            </li>
          ))}
        </ul>
        {close}
      </Notice>
    )
  }
  const hasWarn = state.warnings.length > 0 || state.unloadedFonts.length > 0
  return (
    <Notice kind={hasWarn ? 'warn' : 'info'}>
      <strong>规格包已导出</strong>:<code>{state.path}</code>{' '}
      <button
        type="button"
        className="uf-link"
        onClick={() => void window.atlas.uiFrameRevealExport()}
      >
        打开文件夹
      </button>{' '}
      {close}
      {state.unloadedFonts.length > 0 && (
        <p>这些截图截取时字体没加载完成:{state.unloadedFonts.join('、')}</p>
      )}
      {state.warnings.length > 0 && (
        <ul className="uf-issues">
          {state.warnings.map((i, k) => (
            <li key={k}>
              提醒 [{i.check}] <code>{i.file}</code>:{i.message}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  )
}

export function UiFramePage(): React.JSX.Element {
  const { doc, past, future } = useUiFrameDoc()
  const { started, schemeId, busy, error, notice } = useSchemeState()
  const [view, setView] = useState<CanvasView>('wall')
  const [theme, setTheme] = useState<ThemeName>('light')
  const [fit, setFit] = useState(true)
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const exporter = useUiFrameExport()

  // 回起步页(新建方案/换模板)时把浮层状态收干净,免得回画布时库面板还盖着
  const [prevStarted, setPrevStarted] = useState(started)
  if (prevStarted !== started) {
    setPrevStarted(started)
    if (!started) {
      setLibraryOpen(false)
      setNaming(false)
    }
  }

  if (!started) {
    return (
      <div className="uf-page">
        <UiFrameStart />
      </div>
    )
  }

  const onSave = (): void => {
    if (schemeId) void schemeActions.save(doc)
    else setNaming(true)
  }

  return (
    <div className="uf-page" onKeyDown={handleUndoKey}>
      <div className="uf-toolbar" role="toolbar" aria-label="UI 框架工具条">
        <button
          type="button"
          className="btn btn-ghost uf-scheme-name"
          title="打开方案库"
          onClick={() => setLibraryOpen(true)}
        >
          {doc.name}
          {schemeId === null && <span className="uf-chip">未入库</span>}
        </button>
        <div className="uf-seg" role="group" aria-label="视图">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`uf-seg-btn${view === v ? ' is-on' : ''}`}
              aria-pressed={view === v}
              onClick={() => {
                setView(v)
                setSelection(null)
              }}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        {view === 'page' && (
          <div className="uf-seg" role="group" aria-label="主题">
            {THEMES.map(([t, label]) => (
              <button
                key={t}
                type="button"
                className={`uf-seg-btn${theme === t ? ' is-on' : ''}`}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {view === 'page' && (
          <div className="uf-seg" role="group" aria-label="画布缩放">
            {ZOOMS.map(([isFit, label]) => (
              <button
                key={label}
                type="button"
                className={`uf-seg-btn${fit === isFit ? ' is-on' : ''}`}
                aria-pressed={fit === isFit}
                onClick={() => setFit(isFit)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="uf-toolbar-gap" />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={past.length === 0}
          onClick={docActions.undo}
        >
          撤销
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={future.length === 0}
          onClick={docActions.redo}
        >
          重做
        </button>
        <button type="button" className="btn btn-ghost" onClick={docActions.resetAll}>
          恢复模板
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy === 'save'} onClick={onSave}>
          {busy === 'save' ? '正在保存……' : '保存方案'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={exporter.state.kind === 'saving'}
          onClick={() => void exporter.run(doc)}
        >
          {exporter.state.kind === 'saving' ? '正在导出……' : '导出规格包'}
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && (
        <Notice kind="info">
          {notice}{' '}
          <button type="button" className="uf-link" onClick={schemeActions.dismissNotice}>
            知道了
          </button>
        </Notice>
      )}
      <ExportBanner state={exporter.state} onDismiss={exporter.dismiss} />
      <div className="uf-main">
        <UiFrameCanvas
          doc={doc}
          view={view}
          theme={theme}
          fit={fit}
          selection={selection}
          onSelect={setSelection}
          onCommit={docActions.setToken}
          onKey={handleUndoKey}
        />
        <UiFrameInspector doc={doc} selection={selection} />
      </div>
      {libraryOpen && <UiFrameLibrary onClose={() => setLibraryOpen(false)} />}
      {naming && (
        <SaveNameDialog
          initial={doc.name}
          onSubmit={(name) => {
            setNaming(false)
            void schemeActions.save(doc, name)
          }}
          onClose={() => setNaming(false)}
        />
      )}
    </div>
  )
}
