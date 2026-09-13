import type { FileStructure } from '@shared/types'

interface StructureSection {
  key: string
  title: string
  items: string[]
}

// 把 FileStructure 的六个数组摆成小节;空数组整节藏掉,不摆空架子
function buildSections(structure: FileStructure): StructureSection[] {
  return [
    { key: 'functions', title: '函数', items: structure.functions },
    { key: 'classes', title: '类', items: structure.classes },
    { key: 'interfaces', title: '接口/类型', items: structure.interfaces },
    { key: 'components', title: 'React 组件', items: structure.reactComponents },
    { key: 'exports', title: '导出', items: structure.exports },
    { key: 'imports', title: '引入', items: structure.imports }
  ].filter((section) => section.items.length > 0)
}

/** 「结构」卡(概览垫底模组)的正文:本地 AST 解析出的零件清单,选中后自动算好。
 * 判空在外层(FileOverview):六节全空的文件整卡不摆,这里只会拿到有零件的结构 */
export function StructureGrid({ structure }: { structure: FileStructure }): React.JSX.Element {
  const sections = buildSections(structure)
  return (
    <div className="structure-grid">
      {sections.map((section) => (
        <div key={section.key} className="structure-section">
          <div className="structure-section-title">
            {section.title}
            <span className="structure-section-count">{section.items.length}</span>
          </div>
          <div className="structure-chips">
            {section.items.map((item) => (
              <span key={item} className="chip chip-sm mono">
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
