import { TreeIcon } from './Icons'

/** 页签条(页签地基):一张页签 = 图标 + 名字 + 悬停才出现的 ×(学 VS Code 的克制)。
 *  未钉住的页签名字斜体(VS Code 预览模式的规矩):它是临时的,点别的文件会被顶替,
 *  双击它或回树里双击文件都能钉住。中键点页签 = 关闭。页签多了横向滚。 */
export function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onPin
}: {
  tabs: Array<{ id: string; name: string; icon: string; pinned: boolean }>
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onPin: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="tabbar" role="tablist" aria-label="已打开的页签">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          tabIndex={0}
          aria-selected={t.id === activeId}
          className={`tabbar-tab${t.id === activeId ? ' is-active' : ''}${t.pinned ? '' : ' is-temp'}`}
          title={t.pinned ? t.name : `${t.name} —— 临时页签,双击钉住;点别的文件会被顶替`}
          onClick={() => onActivate(t.id)}
          onDoubleClick={() => onPin(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate(t.id)
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(t.id)
            }
          }}
        >
          <span className="tabbar-icon" aria-hidden="true">
            <TreeIcon name={t.icon} />
          </span>
          <span className="tabbar-name">{t.name}</span>
          <button
            type="button"
            className="tabbar-close"
            aria-label={`关闭 ${t.name}`}
            title="关闭"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
