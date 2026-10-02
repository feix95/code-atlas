// 属性面板:选中部件的可拖参数与全部参数,数值输入即改;图标部件附图标选择器。
import { useState } from 'react'
import { PARTS } from '@shared/uiFrame/handles'
import { literalCss, resolveValue } from '@shared/uiFrame/resolve'
import type { IconSlot, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { describePx } from '@shared/uiFrame/units'
import { docActions, isTokenEdited } from '../../uiFrame/docStore'
import type { CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { IconPicker } from './IconPicker'

/** 可在面板里直接输数字的变量类型 */
function editable(value: TokenValue): 'px' | 'number' | null {
  if (value.kind === 'dimension') return 'px'
  if (value.kind === 'number' || value.kind === 'fontWeight' || value.kind === 'em') return 'number'
  return null
}

function numberOf(value: TokenValue): number {
  if (value.kind === 'dimension') return value.px
  if (value.kind === 'number' || value.kind === 'fontWeight' || value.kind === 'em')
    return value.value
  return 0
}

function withNumber(value: TokenValue, n: number): TokenValue {
  if (value.kind === 'dimension') return { kind: 'dimension', px: n }
  if (value.kind === 'em') return { kind: 'em', value: n }
  if (value.kind === 'fontWeight') return { kind: 'fontWeight', value: n }
  return { kind: 'number', value: n }
}

function TokenRow({
  doc,
  name,
  hot
}: {
  doc: UiFrameDoc
  name: string
  hot: boolean
}): React.JSX.Element {
  const def = doc.tokens[name]
  const resolved = resolveValue(doc.tokens, name)
  const mode = editable(resolved)
  const current = numberOf(resolved)
  const [draft, setDraft] = useState<string | null>(null)
  const shown =
    mode === 'px'
      ? describePx(current, doc.rootFontPx)
      : literalCss(resolved, 'light', doc.rootFontPx)
  const commit = (): void => {
    if (draft === null) return
    const n = Number(draft)
    setDraft(null)
    if (Number.isFinite(n) && n !== current) docActions.setToken(name, withNumber(resolved, n))
  }
  return (
    <div className={`uf-row${hot ? ' is-hot' : ''}`}>
      <div className="uf-row-head">
        <span className="uf-row-label">{def.label}</span>
        {isTokenEdited(doc, name) && (
          <button type="button" className="uf-link" onClick={() => docActions.resetToken(name)}>
            恢复默认
          </button>
        )}
      </div>
      <div className="uf-row-body">
        {mode ? (
          <label className="uf-num">
            <input
              className="uf-input"
              type="number"
              step={mode === 'px' ? 1 : 0.01}
              value={draft ?? String(current)}
              aria-label={`${def.label}${mode === 'px' ? '(像素)' : ''}`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setDraft(null)
              }}
            />
            {mode === 'px' && <span className="uf-unit">px</span>}
          </label>
        ) : null}
        <span className="uf-row-value mono">{shown}</span>
      </div>
      <span className="uf-row-ref mono">
        --{name}
        {def.value.kind === 'ref' ? ` → --${def.value.ref}` : ' · 自定义值'}
      </span>
    </div>
  )
}

export function UiFrameInspector({
  doc,
  selection
}: {
  doc: UiFrameDoc
  selection: CanvasSelection | null
}): React.JSX.Element {
  const part = selection ? PARTS[selection.part] : undefined
  if (!selection || !part) {
    return (
      <aside className="uf-inspector" aria-label="属性">
        <h2 className="uf-panel-title">属性</h2>
        <p className="uf-hint">
          点选画布里的按钮、卡片、图标或页面区块,在这里调整数值;选中后也可以直接拖动蓝色手柄。
        </p>
        <p className="uf-hint">拖动默认按 0.125rem 吸附,靠近已有变量会自动吸上;按住 Alt 自由拖。</p>
      </aside>
    )
  }
  const hot = new Set(part.handles.map((h) => h.token))
  const names = Object.keys(doc.tokens).filter((n) => doc.tokens[n].path[0] === part.group)
  const ordered = [...names.filter((n) => hot.has(n)), ...names.filter((n) => !hot.has(n))]
  const slot: IconSlot | null = selection.iconSlot
  return (
    <aside className="uf-inspector" aria-label="属性">
      <h2 className="uf-panel-title">{part.label}</h2>
      {slot && (
        <section className="uf-section">
          <h3 className="uf-section-title">图标</h3>
          <IconPicker current={doc.icons[slot]} onPick={(name) => docActions.setIcon(slot, name)} />
        </section>
      )}
      <section className="uf-section">
        <h3 className="uf-section-title">参数</h3>
        {ordered.map((n) => (
          <TokenRow
            key={`${n}:${JSON.stringify(doc.tokens[n].value)}`}
            doc={doc}
            name={n}
            hot={hot.has(n)}
          />
        ))}
      </section>
    </aside>
  )
}
