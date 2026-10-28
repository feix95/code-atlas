import { useRef, useSyncExternalStore } from 'react'
import { outlineDepths, type OutlineItem } from '../docOutline'
import { getDocOutlineOpen, subscribeDocOutlineOpen, toggleDocOutlineOpen } from '../codePrefs'
import { useOutlinePlacement } from '../useOutlinePlacement'
import { TreeIcon } from './Icons'

/** 收起态圆钮里的图标(20px = 1.25rem) */
const TOGGLE_ICON_SIZE = 20

/**
 * 文档大纲浮窗:半透明磨砂底,默认浮在阅读栏右上角,不占版面宽度。
 * 坞贴在预览面板顶端(阅读栏外),浮窗跟着面板钉住,能拖到面板里任何位置 —— 往上能压住页头那条锁钮栏。
 * 宽高紧包条目;没有标题栏,指针扫到上缘那一窄条就浮出一层薄灰底,露出点阵抓手和收起横线,
 * 按住能拖(方向键也能挪)。右下角拉手能拉宽拉高(双击或回车回到自适应);
 * 拉得比内容还宽、还高,松手就平滑吸回内容尺寸,不留空白。位置、尺寸、开合都是全局偏好,重启不失忆。
 * 收起后只剩一个正圆开关钮,留在浮窗原来的位置;点一下展开,按住挪够 4px 就是拖动(松手不展开)。条目是真按钮:Tab 能走到、Enter/空格就跳。
 * 小葵要求整个浮窗不出悬停提示(条目超长只靠省略号),说明一律走 aria-label 给读屏。
 */
export function DocOutline({
  viewRef,
  items,
  activeId,
  onJump
}: {
  /** 预览栏(滚动容器):浮窗的下缘、左缘按它算,上缘能一直挪到面板顶 */
  viewRef: React.RefObject<HTMLDivElement | null>
  items: OutlineItem[]
  activeId: string | null
  onJump: (id: string) => void
}): React.JSX.Element {
  const isOpen = useSyncExternalStore(subscribeDocOutlineOpen, getDocOutlineOpen)
  const dockRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const { style, isDragging, isSnapping, consumeDrag, grip, resizer } = useOutlinePlacement(
    { viewRef, dockRef, panelRef },
    isOpen,
    items
  )
  const depths = outlineDepths(items)
  const label = isOpen ? '收起大纲' : '展开大纲,按住可拖动位置'
  const panelClass = `doc-outline${isOpen ? ' is-open' : ''}${isDragging ? ' is-dragging' : ''}${isSnapping ? ' is-snapping' : ''}`
  return (
    <div className="doc-outline-dock" ref={dockRef}>
      <nav className={panelClass} ref={panelRef} style={style} aria-label="文档大纲">
        {/* 上缘热区:与拖动条同地盘,悬停即带出薄灰底(纯 CSS),须排在拖动条之前 */}
        {isOpen && <div className="doc-outline-hotzone" aria-hidden="true" />}
        <div className="doc-outline-bar">
          {isOpen && (
            <button
              type="button"
              className="doc-outline-grip"
              aria-label="移动大纲,可用方向键微调"
              {...grip}
            />
          )}
          <button
            type="button"
            className="doc-outline-toggle"
            aria-expanded={isOpen}
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            {...(isOpen ? {} : grip)}
            onClick={() => {
              // 收起态的圆钮也是拖动把手:拖完松手不算点开
              if (consumeDrag()) return
              toggleDocOutlineOpen()
            }}
          >
            {!isOpen && <TreeIcon name="textAlignStart" size={TOGGLE_ICON_SIZE} mono />}
          </button>
        </div>
        {isOpen && (
          <ol className="doc-outline-list">
            {items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`doc-outline-item${item.id === activeId ? ' is-active' : ''}`}
                  style={{ '--outline-depth': depths[i] } as React.CSSProperties}
                  aria-current={item.id === activeId ? 'location' : undefined}
                  onClick={() => onJump(item.id)}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ol>
        )}
        {isOpen && (
          <button
            type="button"
            className="doc-outline-resize"
            aria-label="调整大纲大小,可用方向键微调;双击或按 Enter 恢复自动大小"
            {...resizer}
          />
        )}
      </nav>
    </div>
  )
}
