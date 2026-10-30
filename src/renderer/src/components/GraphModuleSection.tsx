// 侧栏的模块区块:模块名(色块)、成员文件(按文件夹分组)、相关自测、附挂样式、与其他模块的连线。
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
      {name}
    </span>
  )
}
function FileButton({
  path,
  label,
  note,
  onFocusFile
}: {
  path: string
  label: string
  note?: string
  onFocusFile: (relPath: string) => void
}): React.JSX.Element {
  return (
    <li>
      <button type="button" className="graph-file" title={path} onClick={() => onFocusFile(path)}>
        <span className="graph-file-name">{label}</span>
        {note && <span className="graph-file-note">{note}</span>}
      </button>
    </li>
  )
}

function LinkList({
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
            <div className="graph-file graph-file-static">
              <ModuleChip name={l.name} color={colorOf(l.moduleId)} />
              <span className="graph-file-note">{l.weight} 条引用</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
const ROLE_NOTE = { member: undefined, attached: '附挂', test: '自测' } as const

export function GraphModuleSection({
  details,
  colorOf,
  onFocusFile
}: {
  details: ModuleDetails
  colorOf: (moduleId: string) => string
  onFocusFile: (relPath: string) => void
}): React.JSX.Element {
  const count = details.module.files.length
  return (
    <>
      <section className="graph-panel-section">
        <h3 className="graph-panel-h">模块文件({count})</h3>
        {details.groups.map((g) => (
          <div key={g.folder} className="graph-folder-group">
            <p className="graph-folder-name">{g.folder === '' ? '根目录' : g.folder}</p>
            <ul className="graph-file-list">
              {g.files.map((f) => (
                <FileButton
                  key={f.path}
                  path={f.path}
                  label={f.name}
                  note={f.isElsewhere ? '在其他文件夹' : ROLE_NOTE[f.role]}
                  onFocusFile={onFocusFile}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
      {details.tests.length > 0 && (
        <section className="graph-panel-section">
          <h3 className="graph-panel-h">相关自测({details.tests.length})</h3>
          <ul className="graph-file-list">
            {details.tests.map((t) => (
              <FileButton key={t} path={t} label={t} onFocusFile={onFocusFile} />
            ))}
          </ul>
        </section>
      )}
      {details.styles.length > 0 && (
        <section className="graph-panel-section">
          <h3 className="graph-panel-h">附挂样式({details.styles.length})</h3>
          <ul className="graph-file-list">
            {details.styles.map((s) => (
              <FileButton key={s} path={s} label={s} onFocusFile={onFocusFile} />
            ))}
          </ul>
        </section>
      )}
      <LinkList title="依赖的模块" links={details.dependsOn} colorOf={colorOf} />
      <LinkList title="被这些模块使用" links={details.usedBy} colorOf={colorOf} />
    </>
  )
}
