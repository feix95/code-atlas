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
 */
export function DetailHeader({
  crumbs,
  icon,
  title,
  subtitle,
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
  badges?: Array<{ label: string; tone: BadgeTone }>
  tabs?: DetailTabDef[]
  activeTab?: string
  onTabChange?: (key: string) => void
  onClose: () => void
}): React.JSX.Element {
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
          {subtitle && <p>{subtitle}</p>}
        </div>
        {badges?.map((b) => (
          <span key={b.label} className={`badge badge-${b.tone}`}>
            {b.label}
          </span>
        ))}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭详情,回到项目概览">
          ×
        </button>
      </div>
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
