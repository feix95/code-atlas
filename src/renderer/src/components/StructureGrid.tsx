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

/** 「结构」Tab 的正文:本地 AST 解析结果,选中后自动算好摆在这儿 */
export function StructureGrid({ structure }: { structure: FileStructure }): React.JSX.Element {
  const sections = buildSections(structure)
  // 六节全空说明这文件里没有可辨认的结构(比如纯常量脚本),得给个说法
  if (sections.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">这个文件里没找到函数、类、组件之类的结构</p>
        <p className="empty-hint">多半是配置、常量或纯数据文件</p>
      </div>
    )
  }
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
