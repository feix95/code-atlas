// 页签组区(UI v3):页签带已上顶栏(TopBarTabs),这里只剩正文分屏 ——
// 一到两组正文,中间分割条调比例;页签拖拽的落点判定在 TopBarTabs 引擎,
// 这里只管照 dropMark 亮提示:中心 = 拆两栏/挪组,左右缘 = 定向拆半屏。
import { Fragment } from 'react'
import type { PaneGroup, PaneTab } from '../paneTabs'
import { PaneEmptyBoard } from './TabBody'

export function PaneGroups({
  groups,
  setActiveGroupId,
  dropMark,
  onPaneSashDown,
  applyPaneSplit,
  paneSplit,
  renderTabBody
}: {
  groups: PaneGroup[]
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  /** 引擎只在「松手有动作」的落点上设它:中心 = 拆两栏/挪组,左右缘 = 定向拆半屏 */
  dropMark: { groupId: string; zone: 'center' | 'left' | 'right' } | null
  onPaneSashDown: (e: React.PointerEvent<HTMLDivElement>) => void
  applyPaneSplit: (v: number) => void
  paneSplit: number
  renderTabBody: (tab: PaneTab) => React.ReactNode
}): React.JSX.Element {
  // 一扇窗名下一张签都没了(全挪去别窗/全关光):大 logo 底板顶班,
  // 主窗拖空留空板、子窗拖空由壳层自裁,两边都不露死白
  if (groups.length === 0) {
    return (
      <div className="pane-groups">
        <PaneEmptyBoard />
      </div>
    )
  }
  return (
    <div className="pane-groups">
      {groups.map((g, gi) => {
        const act = g.tabs.find((t) => t.id === g.activeId) ?? null
        return (
          <Fragment key={g.id}>
            {gi > 0 && (
              <div
                className="pane-sash"
                role="separator"
                aria-orientation="vertical"
                aria-label="两组分割条:拖动调比例,双击回对半"
                tabIndex={0}
                onPointerDown={onPaneSashDown}
                onDoubleClick={() => applyPaneSplit(0.5)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    applyPaneSplit(paneSplit + (e.key === 'ArrowRight' ? 0.05 : -0.05))
                  }
                }}
              />
            )}
            <div
              className="pane-group"
              /* 占比用 flex 缩写传:.pane-group 的 CSS 是 flex:1(basis 钉死 0%),
                 内联 width 会被 flex 布局无视 —— 拖分割条账本在变、画面纹丝不动(小葵报的案)。
                 第一组 0 0 定死占比,第二组照旧 flex:1 吃剩余 */
              style={
                groups.length === 2 && gi === 0
                  ? { flex: `0 0 ${(paneSplit * 100).toFixed(2)}%` }
                  : undefined
              }
              onPointerDown={() => setActiveGroupId(g.id)}
            >
              <div className="pane-body" data-group-id={g.id}>
                {act && act.kind !== 'settings' ? (
                  // 每组正房只住一个房间(VS Code 的克制);设置签走下面的保活层
                  renderTabBody(act)
                ) : !act ? (
                  // 这组没有亮着的页签(还没开签/全关光):大 logo 底板
                  <PaneEmptyBoard />
                ) : null}
                {dropMark?.groupId === g.id && dropMark.zone === 'center' && (
                  <div className="pane-drop-hint" aria-hidden="true">
                    {groups.length === 1 ? '松手,拆成两栏' : '松手,挪到这一组'}
                  </div>
                )}
                {/* 边缘分屏许诺:亮贴近的那半边(分组只长横排,只许左右缘 —— 小葵的二期手势) */}
                {dropMark?.groupId === g.id &&
                  (dropMark.zone === 'left' || dropMark.zone === 'right') && (
                    <div className={`pane-drop-edge is-${dropMark.zone}`} aria-hidden="true">
                      {dropMark.zone === 'left' ? '松手,拆到左半屏' : '松手,拆到右半屏'}
                    </div>
                  )}
                {/* 设置签保活层:切去别的页签只藏不拆 —— 改到一半的草稿(配色/缩放/AI 配置)
                    还得在;关掉页签才卸载,卸载清理把预览退回存档(SettingsPage 里兜底) */}
                {g.tabs
                  .filter((t) => t.kind === 'settings')
                  .map((t) => (
                    <div
                      key={t.id}
                      className={`pane-keep-alive${t.id === g.activeId ? '' : ' is-hidden'}`}
                    >
                      {renderTabBody(t)}
                    </div>
                  ))}
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
