// 属性面板:选中部件的可拖参数与全部参数,数值输入即改;图标部件附图标选择器。
// 变量板点选的基础变量(data-uf-part="tok:<名>")走单变量编辑:数字、取色、阴影分量、字体名。
import { useState } from 'react'
import { PARTS, type HandleDef } from '@shared/uiFrame/handles'
import { PART_MAP } from '@shared/uiFrame/parts'
import { literalCss, resolveValue } from '@shared/uiFrame/resolve'
import { nudgeValue } from '@shared/uiFrame/tweak'
import type { IconSlot, TokenDef, TokenValue, UiFrameDoc } from '@shared/uiFrame/types'
import { describePx } from '@shared/uiFrame/units'
import { editTarget, refTargetOf, tokenUsage } from '@shared/uiFrame/usage'
import { docActions, isTokenEdited } from '../../uiFrame/docStore'
import type { CanvasSelection } from '../../uiFrame/useCanvasFrame'
import { workbenchActions } from '../../uiFrame/workbenchStore'
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
  hot,
  bounds
}: {
  doc: UiFrameDoc
  name: string
  hot: boolean
  /** 手柄带的上下限(第 5.6 节 键盘微调同样吃它);没手柄的变量不给 */
  bounds?: { min: number; max: number }
}): React.JSX.Element {
  const def = doc.tokens[name]
  // ref 变量的「写哪」:shared = 改变量本身(波及全部引用处),local = 只改这一处(断开支用专属值)
  const [scope, setScope] = useState<'shared' | 'local'>('local')
  const refTarget = refTargetOf(def.value)
  const writeTo = editTarget(name, scope, doc.tokens)
  const resolved = resolveValue(doc.tokens, writeTo)
  const mode = editable(resolved)
  const current = numberOf(resolved)
  const [draft, setDraft] = useState<string | null>(null)
  // 影响面:ref 变量数它引用的目标被多少处用;字面量变量数多少处引用它
  const shared = refTarget ? tokenUsage(doc.tokens, refTarget) : tokenUsage(doc.tokens, name)
  const writeEdited = writeTo === name ? isTokenEdited(doc, name) : isTokenEdited(doc, writeTo)
  const shown =
    mode === 'px'
      ? describePx(current, doc.rootFontPx)
      : literalCss(resolved, 'light', doc.rootFontPx)
  const write = (value: TokenValue): void => docActions.setToken(writeTo, value)
  const commit = (): void => {
    if (draft === null) return
    const n = Number(draft)
    setDraft(null)
    if (Number.isFinite(n) && n !== current) write(withNumber(resolved, n))
  }
  // 第 5.6 节 键盘微调:方向键 ±1 步长,Shift + 方向键 ±4 步长,吃手柄上下限
  const nudge = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const next = nudgeValue(
      resolved,
      e.key === 'ArrowUp' ? 1 : -1,
      e.shiftKey ? 4 : 1,
      bounds?.min ?? -Infinity,
      bounds?.max ?? Infinity
    )
    if (next) write(next)
  }
  return (
    <div className={`uf-row${hot ? ' is-hot' : ''}`}>
      <div className="uf-row-head">
        <span className="uf-row-label">{def.label}</span>
        {writeEdited && (
          <button type="button" className="uf-link" onClick={() => docActions.resetToken(writeTo)}>
            恢复默认
          </button>
        )}
      </div>
      {refTarget && (
        <div className="uf-share-hint">
          <span className="uf-share-count">
            绑在 --{refTarget} 上,它同时影响 {shared.total} 处
          </span>
          <span className="uf-seg uf-share-scope" role="group" aria-label="改动范围">
            <button
              type="button"
              className={`uf-seg-btn${scope === 'local' ? ' is-on' : ''}`}
              aria-pressed={scope === 'local'}
              title="断开引用,这个参数改用专属值,其它地方不受影响"
              onClick={() => setScope('local')}
            >
              只改这一处
            </button>
            <button
              type="button"
              className={`uf-seg-btn${scope === 'shared' ? ' is-on' : ''}`}
              aria-pressed={scope === 'shared'}
              title={`改 --${refTarget} 本身,引用它的 ${shared.total} 处一起变`}
              onClick={() => setScope('shared')}
            >
              改变量本身
            </button>
          </span>
        </div>
      )}
      {!refTarget && shared.refs.length > 0 && (
        <p className="uf-share-note">共用变量:{shared.refs.length} 个变量引用它,改动会一起生效</p>
      )}
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
                else if (e.key === 'Escape') setDraft(null)
                else nudge(e)
              }}
            />
            {mode === 'px' && <span className="uf-unit">px</span>}
          </label>
        ) : null}
        <span className="uf-row-value mono">{shown}</span>
      </div>
      <span className="uf-row-ref mono">
        --{name}
        {refTarget
          ? ` → --${refTarget}${scope === 'shared' ? '(改它)' : '(断开,专属值)'}`
          : ' · 自定义值'}
      </span>
    </div>
  )
}

/** 变量板选中项的标题行:变量名 + 恢复默认 */
function TokenHead({
  doc,
  name,
  def
}: {
  doc: UiFrameDoc
  name: string
  def: TokenDef
}): React.JSX.Element {
  return (
    <div className="uf-row-head">
      <span className="uf-row-label">{def.label}</span>
      <span className="uf-row-ref mono">--{name}</span>
      {isTokenEdited(doc, name) && (
        <button type="button" className="uf-link" onClick={() => docActions.resetToken(name)}>
          恢复默认
        </button>
      )}
    </div>
  )
}

/** 颜色变量:亮 / 暗两个取色器(#RRGGBB);只限 base 层的字面颜色 */
function ColorEditor({
  name,
  value
}: {
  name: string
  value: Extract<TokenValue, { kind: 'color' }>
}): React.JSX.Element {
  const pick = (theme: 'light' | 'dark', hex: string): void =>
    docActions.setToken(name, { ...value, [theme]: hex })
  return (
    <div className="uf-row-body">
      {(['light', 'dark'] as const).map((t) => (
        <label key={t} className="uf-color">
          <input
            type="color"
            value={value[t]}
            aria-label={t === 'light' ? '亮色值' : '暗色值'}
            onChange={(e) => pick(t, e.target.value)}
          />
          <span className="uf-row-value mono">{value[t]}</span>
          <span className="uf-unit">{t === 'light' ? '亮' : '暗'}</span>
        </label>
      ))}
    </div>
  )
}

/** 阴影变量:x/y/模糊/扩散 数字 + 亮暗色文本(rgba 不便用取色器) */
function ShadowEditor({
  name,
  value
}: {
  name: string
  value: Extract<TokenValue, { kind: 'shadow' }>
}): React.JSX.Element {
  const setNum = (key: 'x' | 'y' | 'blur' | 'spread', raw: string): void => {
    const n = Number(raw)
    if (Number.isFinite(n)) docActions.setToken(name, { ...value, [key]: n })
  }
  const setColor = (theme: 'light' | 'dark', raw: string): void =>
    docActions.setToken(name, { ...value, [theme]: raw })
  const NUMS: Array<[key: 'x' | 'y' | 'blur' | 'spread', label: string]> = [
    ['x', '水平'],
    ['y', '垂直'],
    ['blur', '模糊'],
    ['spread', '扩散']
  ]
  return (
    <div className="uf-row-body uf-shadow-edit">
      {NUMS.map(([key, label]) => (
        <label key={key} className="uf-num">
          <input
            className="uf-input"
            type="number"
            step={1}
            value={value[key]}
            aria-label={label}
            onChange={(e) => setNum(key, e.target.value)}
          />
          <span className="uf-unit">{label}</span>
        </label>
      ))}
      {(['light', 'dark'] as const).map((t) => (
        <label key={t} className="uf-shadow-color">
          <input
            className="uf-input"
            type="text"
            value={value[t]}
            aria-label={t === 'light' ? '亮色阴影' : '暗色阴影'}
            onChange={(e) => setColor(t, e.target.value)}
          />
          <span className="uf-unit">{t === 'light' ? '亮' : '暗'}</span>
        </label>
      ))}
    </div>
  )
}

/** 字体变量:逗号分隔的字族名文本 */
function FamilyEditor({
  name,
  value
}: {
  name: string
  value: Extract<TokenValue, { kind: 'fontFamily' }>
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const families = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(null)
    if (families.length) docActions.setToken(name, { kind: 'fontFamily', families })
  }
  return (
    <div className="uf-row-body">
      <label className="uf-num uf-family">
        <input
          className="uf-input"
          type="text"
          value={draft ?? value.families.join(', ')}
          aria-label="字体族"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      </label>
    </div>
  )
}

/** 变量板点选「tok:<名>」 → 单变量编辑(第 5.5 节 直接改变量) */
function TokenInspector({ doc, name }: { doc: UiFrameDoc; name: string }): React.JSX.Element {
  const def = doc.tokens[name]
  if (!def) {
    return (
      <aside className="uf-inspector" aria-label="属性">
        <p className="uf-hint">变量不存在:{name}</p>
      </aside>
    )
  }
  const resolved = resolveValue(doc.tokens, name)
  const value = def.value
  return (
    <aside className="uf-inspector" aria-label="属性">
      <h2 className="uf-panel-title">变量</h2>
      <section className="uf-section">
        {resolved.kind === 'color' && value.kind === 'color' ? (
          <div className="uf-row is-hot">
            <TokenHead doc={doc} name={name} def={def} />
            <ColorEditor name={name} value={value} />
          </div>
        ) : resolved.kind === 'shadow' && value.kind === 'shadow' ? (
          <div className="uf-row is-hot">
            <TokenHead doc={doc} name={name} def={def} />
            <ShadowEditor name={name} value={value} />
          </div>
        ) : resolved.kind === 'fontFamily' && value.kind === 'fontFamily' ? (
          <div className="uf-row is-hot">
            <TokenHead doc={doc} name={name} def={def} />
            <FamilyEditor name={name} value={value} />
          </div>
        ) : (
          <TokenRow doc={doc} name={name} hot={false} />
        )}
        <p className="uf-hint">改动立刻生效在画布上;Ctrl+Z 撤销,工具条可恢复模板。</p>
      </section>
    </aside>
  )
}

export function UiFrameInspector({
  doc,
  selection,
  placedSel
}: {
  doc: UiFrameDoc
  selection: CanvasSelection | null
  /** 底板选中的零件实例 id(M3-a) */
  placedSel: string | null
}): React.JSX.Element {
  // 变量板条目:part 为 "tok:<变量名>",不走部件配方
  const tok = selection?.part.startsWith('tok:') ? selection.part.slice(4) : null
  const part = selection && !tok ? PARTS[selection.part] : undefined
  if (tok) return <TokenInspector doc={doc} name={tok} />
  // 底板零件实例:挪位置靠拖,删按 Delete;数值细节去零件墙对应节调
  if (placedSel && !part) {
    const placed = doc.placed.find((p) => p.id === placedSel)
    const def = placed ? PART_MAP[placed.recipe] : undefined
    return (
      <aside className="uf-inspector" aria-label="属性">
        <h2 className="uf-panel-title">零件 · {def?.label ?? placed?.recipe ?? '已消失'}</h2>
        {placed ? (
          <>
            <section className="uf-section">
              <h3 className="uf-section-title">位置</h3>
              <p className="uf-hint">
                x {placed.x} · y {placed.y}
              </p>
              <p className="uf-hint">在底板上直接拖它挪位置;按 Delete 删掉,Esc 取消选中。</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  docActions.removePlaced(placed.id)
                  workbenchActions.selectPlaced(null)
                }}
              >
                从底板删掉
              </button>
            </section>
            <section className="uf-section">
              <h3 className="uf-section-title">数值</h3>
              <p className="uf-hint">
                零件的尺寸、颜色、状态样式在「零件墙」对应节统一调;
                <button
                  type="button"
                  className="uf-link"
                  onClick={() => workbenchActions.jump({ kind: 'component', id: placed.recipe })}
                >
                  去调{def?.label ?? '它'}
                </button>
              </p>
            </section>
          </>
        ) : (
          <p className="uf-hint">这个零件已经不在底板上了。</p>
        )}
      </aside>
    )
  }
  if (!selection || !part) {
    return (
      <aside className="uf-inspector" aria-label="属性">
        <h2 className="uf-panel-title">属性</h2>
        <p className="uf-hint">
          点选画布里的按钮、卡片、图标或页面区块,在这里调整数值;选中后也可以直接拖动蓝色手柄。
        </p>
        <p className="uf-hint">底板上的零件可以直接拖位置;零件盒里的组件拖上来或双击即可上板。</p>
        <p className="uf-hint">拖动默认按 0.125rem 吸附,靠近已有变量会自动吸上;按住 Alt 自由拖。</p>
        <p className="uf-hint">
          选中数值后方向键微调一步,Shift + 方向键四步;按住空格看修改前的样子。
        </p>
      </aside>
    )
  }
  const hot = new Map(part.handles.map((h: HandleDef) => [h.token, h]))
  const names = Object.keys(doc.tokens).filter((n) => doc.tokens[n].path[0] === part.group)
  const ordered = [...names.filter((n) => hot.has(n)), ...names.filter((n) => !hot.has(n))]
  const slot: IconSlot | null = selection.iconSlot
  return (
    <aside className="uf-inspector" aria-label="属性">
      <h2 className="uf-panel-title">{part.label}</h2>
      {slot && (
        <section className="uf-section">
          <h3 className="uf-section-title">图标</h3>
          <IconPicker
            current={doc.icons[slot]}
            custom={doc.customIcons}
            onPick={(name) => docActions.setIcon(slot, name)}
            onCustom={(name, svg) => docActions.addCustomIcon(slot, name, svg)}
          />
        </section>
      )}
      <section className="uf-section">
        <h3 className="uf-section-title">参数</h3>
        {ordered.map((n) => (
          // key 不带 value:方向键微调每按一次就提交,key 带值会重挂载丢焦点,连按就废
          <TokenRow
            key={n}
            doc={doc}
            name={n}
            hot={hot.has(n)}
            bounds={hot.get(n) ? { min: hot.get(n)!.min, max: hot.get(n)!.max } : undefined}
          />
        ))}
      </section>
    </aside>
  )
}
