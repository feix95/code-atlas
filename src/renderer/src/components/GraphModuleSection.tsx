// 侧栏的模块区块:模块色块、成员文件(按文件夹分组)、相关自测、附挂样式、与其他模块的连线。
// 每一块拆成独立小节,给「显示项」的拖动排序按小节重排正文用。
import type { ModuleDetails, ModuleLinkView } from '../graph/moduleDetails'

export function ModuleChip({
  name,
  color
}: {
  name: string
  /** 模块颜色(CSS 颜色值,见 moduleSwatchCss) */
  color: string
}): React.JSX.Element {
  return (
    <span className="graph-chip">
      <span className="graph-swatch" style={{ background: color }} aria-hidden="true" />
      <span className="graph-chip-name">{name}</span>
    </span>
  )
}

function FileRow({ label, note }: { label: string; note?: string }): React.JSX.Element {
  return (
    <li>
      <div className="graph-file">
        <span className="graph-file-name">{label}</span>
        {note && <span className="graph-file-note">{note}</span>}
      </div>
    </li>
  )
}

const ROLE_NOTE = { member: undefined, attached: '附挂', test: '自测' } as const

export function ModuleFilesSection({ details }: { details: ModuleDetails }): React.JSX.Element {
  const count = details.module.files.length
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">模块文件({count})</h3>
      {details.groups.map((g) => (
        <div key={g.folder} className="graph-folder-group">
          <p className="graph-folder-name">{g.folder === '' ? '根目录' : g.folder}</p>
          <ul className="graph-file-list">
            {g.files.map((f) => (
              <FileRow
                key={f.path}
                label={f.name}
                note={f.isElsewhere ? '在其他文件夹' : ROLE_NOTE[f.role]}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function ModuleTestsSection({
  details
}: {
  details: ModuleDetails
}): React.JSX.Element | null {
  if (details.tests.length === 0) return null
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">相关自测({details.tests.length})</h3>
      <ul className="graph-file-list">
        {details.tests.map((t) => (
          <FileRow key={t} label={t} />
        ))}
      </ul>
    </section>
  )
}

export function ModuleStylesSection({
  details
}: {
  details: ModuleDetails
}): React.JSX.Element | null {
  if (details.styles.length === 0) return null
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">附挂样式({details.styles.length})</h3>
      <ul className="graph-file-list">
        {details.styles.map((s) => (
          <FileRow key={s} label={s} />
        ))}
      </ul>
    </section>
  )
}

export function ModuleLinksSection({
  title,
  links,
  colorOf
}: {
  title: string
  links: ModuleLinkView[]
  colorOf: (moduleId: string) => string
}): React.JSX.Element | null {
  if (links.length === 0) return null
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">{title}</h3>
      <ul className="graph-file-list">
        {links.map((l) => (
          <li key={l.moduleId}>
            <div className="graph-file">
              <ModuleChip name={l.name} color={colorOf(l.moduleId)} />
              <span className="graph-file-note">{l.weight} 条引用</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
