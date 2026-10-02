// 「UI 框架」页签(§5 + 工作台改造):起步页(选平台/模板/我的方案)→ 工具条 + 底板 + 属性面板;
// 画布视图与方案库浮层归 workbenchStore(零件盒在侧栏,两边共用一本账)。
import { useEffect, useMemo, useState } from 'react'
import { flutterThemeDart, reactNativeThemeTs, tailwindThemeCss } from '@shared/uiFrame/adapters'
import { deviceFor, devicesFor } from '@shared/uiFrame/devices'
import { pagesFor } from '@shared/uiFrame/documents'
import { platformIssues } from '@shared/uiFrame/platformRules'
import type { ThemeName, UiPlatform } from '@shared/uiFrame/types'
import { VIEW_LABEL, type CanvasView } from '../../uiFrame/canvasDoc'
import { docActions, useUiFrameDoc } from '../../uiFrame/docStore'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import type { CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { useUiFrameExport, type ExportState } from '../../uiFrame/useUiFrameExport'
import { useWorkbench, workbenchActions, workbenchNow } from '../../uiFrame/workbenchStore'
import { Notice } from '../Notice'
import { UiFrameCanvas } from './UiFrameCanvas'
import { UiFrameInspector } from './UiFrameInspector'
import { SaveNameDialog, UiFrameLibrary } from './UiFrameSchemes'
import { UiFrameRules } from './UiFrameRules'
import { UiFrameStart } from './UiFrameStart'

const VIEWS: CanvasView[] = ['bench', 'wall', 'board']
const PLATFORMS: Array<[UiPlatform, string]> = [
  ['desktop', '电脑端'],
  ['phone', '手机端']
]
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
  // 已处理过的别再处理:div 冒泡拦截后 window 监听会再见一次同一事件
  if (e.defaultPrevented) return
  // 底板选中零件时 Delete/Backspace 删实例,Esc 取消选中(M3-a)
  const placed = workbenchNow().placedSel
  if (e.key === 'Escape' && placed) {
    workbenchActions.selectPlaced(null)
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && placed) {
    // 画布内的 input 是道具不是真编辑框,不拦;外层页面的真实表单控件才拦
    const t = e.target
    const inCanvas = t instanceof Element && t.ownerDocument !== document
    if (
      !inCanvas &&
      (t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable))
    )
      return
    e.preventDefault()
    docActions.removePlaced(placed)
    workbenchActions.selectPlaced(null)
    return
  }
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
      <strong>规格包已导出</strong>:<code>{state.path}</code>
      <span className="uf-hint">
        把这个文件夹整个交给你的 AI 编程助手,它照着数值做出一模一样的界面。
      </span>{' '}
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
  const { view, libraryOpen, placedSel, pageId } = useWorkbench()
  const [theme, setTheme] = useState<ThemeName>('light')
  const [fit, setFit] = useState(true)
  const [chrome, setChrome] = useState(true)
  const [safeArea, setSafeArea] = useState(true)
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const [naming, setNaming] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exporter = useUiFrameExport()
  // 平台规范提醒(§5.7):随方案每次改动实时重算
  const issues = useMemo(() => platformIssues(doc), [doc])

  // 换视图(含零件盒跳转)就清掉部件选中:旧视图的部件在新画布上不存在;
  // 底板零件的选中在 workbenchStore 的 setView/jump 里同一笔清(渲染期回调会踩掉同事件后写的选中)
  const [prevView, setPrevView] = useState(view)
  if (prevView !== view) {
    setPrevView(view)
    setSelection(null)
  }

  // 快捷键挂 window:焦点在侧栏零件盒时 Delete/Ctrl+Z 也得灵(侧栏不在 .uf-page 子树里);
  // .uf-page 内的事件先被 div 拦截并 preventDefault,window 这里靠 defaultPrevented 去重
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => handleUndoKey(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 回起步页(新建方案/换模板)时把浮层状态收干净,免得回画布时库面板还盖着
  const [prevStarted, setPrevStarted] = useState(started)
  if (prevStarted !== started) {
    setPrevStarted(started)
    if (!started) {
      workbenchActions.setLibraryOpen(false)
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

  // 复制适配主题到剪贴板(§13.5):与导出包内的 adapters/ 文件同一份生成器
  const copyAdapter = async (kind: 'tailwind' | 'rn' | 'flutter'): Promise<void> => {
    const text =
      kind === 'tailwind'
        ? tailwindThemeCss(doc)
        : kind === 'flutter'
          ? flutterThemeDart(doc)
          : reactNativeThemeTs(doc)
    try {
      await navigator.clipboard.writeText(text)
      schemeActions.flash(
        kind === 'tailwind'
          ? 'Tailwind v4 @theme 主题已复制到剪贴板'
          : kind === 'flutter'
            ? 'Flutter ThemeData 主题已复制到剪贴板'
            : 'React Native 主题对象已复制到剪贴板'
      )
    } catch {
      schemeActions.flash('剪贴板不可用:请到导出的规格包里取 adapters/ 下的同名文件')
    }
    setExportMenuOpen(false)
  }

  return (
    <div className="uf-page" onKeyDown={handleUndoKey}>
      <div className="uf-toolbar" role="toolbar" aria-label="UI 框架工具条">
        <div className="uf-tb-group">
          <button
            type="button"
            className="btn btn-ghost uf-scheme-name"
            title="打开方案库"
            onClick={() => workbenchActions.setLibraryOpen(true)}
          >
            {doc.name}
            {schemeId === null && <span className="uf-chip">未入库</span>}
          </button>
          <select
            className="uf-select"
            aria-label="平台"
            value={doc.platform}
            onChange={(e) => {
              docActions.setPlatform(e.target.value as UiPlatform)
              setSelection(null)
            }}
          >
            {PLATFORMS.map(([p, label]) => (
              <option key={p} value={p}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="uf-select"
            aria-label="设备尺寸"
            value={deviceFor(doc).id}
            onChange={(e) => docActions.setDevice(e.target.value)}
          >
            {devicesFor(doc.platform).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <div className="uf-seg" role="group" aria-label="视图">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                className={`uf-seg-btn${view === v ? ' is-on' : ''}`}
                aria-pressed={view === v}
                onClick={() => workbenchActions.setView(v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`uf-seg-btn${chrome ? ' is-on' : ''}`}
            aria-pressed={chrome}
            title={doc.platform === 'phone' ? '机身外框(状态栏/灵动岛/手势条)' : '窗口外框'}
            onClick={() => setChrome(!chrome)}
          >
            外框
          </button>
          {doc.platform === 'phone' && (
            <button
              type="button"
              className={`uf-seg-btn${safeArea ? ' is-on' : ''}`}
              aria-pressed={safeArea}
              title="安全区参考线"
              onClick={() => setSafeArea(!safeArea)}
            >
              安全区
            </button>
          )}
          <button
            type="button"
            className={`uf-seg-btn uf-rules-btn${rulesOpen ? ' is-on' : ''}`}
            aria-pressed={rulesOpen}
            title="平台适配检查(实时提醒,不影响导出)"
            onClick={() => setRulesOpen(!rulesOpen)}
          >
            检查
            <span className={`uf-badge${issues.length ? ' is-warn' : ''}`}>{issues.length}</span>
          </button>
          {view === 'bench' && doc.placed.length === 0 && (
            <div className="uf-seg" role="group" aria-label="示例页">
              {pagesFor(doc.platform).map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className={`uf-seg-btn${(pageId ?? pagesFor(doc.platform)[0].id) === p.id ? ' is-on' : ''}`}
                  aria-pressed={(pageId ?? pagesFor(doc.platform)[0].id) === p.id}
                  title={`底板躺「${p.title}」(${p.htmlPath})`}
                  onClick={() => workbenchActions.setPage(i === 0 ? null : p.id)}
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
          {view === 'bench' && (
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
          {view === 'bench' && (
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
        </div>
        <div className="uf-tb-group uf-tb-actions">
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
            恢复默认
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy === 'save'}
            onClick={onSave}
          >
            {busy === 'save' ? '正在保存……' : '保存方案'}
          </button>
          <div className="uf-export">
            <button
              type="button"
              className="btn btn-primary uf-export-main"
              disabled={exporter.state.kind === 'saving'}
              onClick={() => void exporter.run(doc)}
            >
              {exporter.state.kind === 'saving' ? '正在导出……' : '导出给 AI'}
            </button>
            <button
              type="button"
              className="btn btn-primary uf-export-caret"
              aria-label="更多导出方式"
              aria-expanded={exportMenuOpen}
              title="复制主题到剪贴板(Tailwind / React Native)"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
            >
              ▾
            </button>
            {exportMenuOpen && (
              <div className="uf-copy-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => void copyAdapter('tailwind')}>
                  复制 Tailwind v4 主题(@theme)
                </button>
                <button type="button" role="menuitem" onClick={() => void copyAdapter('rn')}>
                  复制 React Native 主题对象
                </button>
                <button type="button" role="menuitem" onClick={() => void copyAdapter('flutter')}>
                  复制 Flutter 主题(ThemeData)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="uf-strip">
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
        {rulesOpen && (
          <UiFrameRules
            issues={issues}
            onPick={(target) => {
              // 变量条目跳变量板并选中该行;组件条目跳零件墙
              if (target.startsWith('组件:')) {
                workbenchActions.jump({ kind: 'component', id: target.slice(3) })
              } else {
                workbenchActions.jump({ kind: 'token', name: target })
              }
            }}
            onClose={() => setRulesOpen(false)}
          />
        )}
      </div>
      <div className="uf-main">
        <UiFrameCanvas
          doc={doc}
          view={view}
          theme={theme}
          fit={fit}
          chrome={chrome}
          safeArea={safeArea}
          selection={selection}
          onSelect={setSelection}
          onCommit={docActions.setToken}
          onKey={handleUndoKey}
        />
        <UiFrameInspector doc={doc} selection={selection} placedSel={placedSel} />
      </div>
      {libraryOpen && <UiFrameLibrary onClose={() => workbenchActions.setLibraryOpen(false)} />}
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
