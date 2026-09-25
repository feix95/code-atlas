// 页签组区(UI v3):页签带已上顶栏(TopBarTabs),这里只剩正文分屏 ——
// 一到两组正文,中间分割条调比例;页签拖到正文中心 = 分屏/挪组。
import { Fragment } from 'react'
import type { ChatCodeRef, FreechatHost, ScanResult } from '@shared/types'
import { DRAG_MIME_TAB } from '@shared/dragTypes'
import type { FileLinkTarget } from '@shared/fileLinks'
import type { PaneGroup, PaneTab } from '../paneTabs'
import { PaneEmptyBoard, PinnedChatPane } from './TabBody'

export function PaneGroups({
  groups,
  freechatHost,
  moveTab,
  setActiveGroupId,
  dropMark,
  setDropMark,
  draggingTab,
  onPaneSashDown,
  applyPaneSplit,
  paneSplit,
  showDropHint,
  result,
  previewRefs,
  removePreviewRef,
  handleDropNode,
  fileLinks,
  chatSuggestionsOn,
  renderTabBody
}: {
  groups: PaneGroup[]
  freechatHost: FreechatHost
  /** 页签拖到正文中心松手 = 分屏/挪组(顶栏页签带过来的拖,落点在正文) */
  moveTab: (id: string, toGroup: 'sibling' | null, atIndex: number | null) => void
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  dropMark: { groupId: string; center: boolean } | null
  setDropMark: React.Dispatch<React.SetStateAction<{ groupId: string; center: boolean } | null>>
  draggingTab: string | null
  onPaneSashDown: (e: React.PointerEvent<HTMLDivElement>) => void
  applyPaneSplit: (v: number) => void
  paneSplit: number
  showDropHint: (groupId: string) => boolean
  result: ScanResult
  previewRefs: ChatCodeRef[]
  removePreviewRef: (index: number) => void
  handleDropNode: (kind: 'file' | 'folder', relPath: string) => Promise<void>
  fileLinks: FileLinkTarget | null
  chatSuggestionsOn: boolean
  renderTabBody: (tab: PaneTab) => React.ReactNode
}): React.JSX.Element {
  return (
    <div className="pane-groups">
      {groups.map((g, gi) => {
        // 激活页签要是刚飞出去的那张小探针:正房也算空的,底板顶班
        // (act 从全量 tabs 找,页签栏藏掉还不够,互斥铁律两边都不留分身)
        const actRaw = g.tabs.find((t) => t.id === g.activeId) ?? null
        const act =
          actRaw && freechatHost === 'pet' && actRaw.kind === 'chat' && !actRaw.pinned
            ? null
            : actRaw
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
              <div
                className={`pane-body${dropMark?.groupId === g.id && dropMark.center ? ' is-drop-center' : ''}`}
                onDragOver={(e) => {
                  // 只认页签拖拽;树里拖文件挂引用走的是另一个 mime,不掺和
                  if (!e.dataTransfer.types.includes(DRAG_MIME_TAB)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const host = e.currentTarget.getBoundingClientRect()
                  // 中心判定(小葵拍的):横竖各取正中一半,松手在这儿才分屏
                  const inCenter =
                    e.clientX > host.left + host.width * 0.25 &&
                    e.clientX < host.right - host.width * 0.25 &&
                    e.clientY > host.top + host.height * 0.25 &&
                    e.clientY < host.bottom - host.height * 0.25
                  setDropMark((prev) =>
                    prev?.groupId === g.id && prev.center === inCenter
                      ? prev
                      : { groupId: g.id, center: inCenter }
                  )
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropMark(null)
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DRAG_MIME_TAB) || draggingTab
                  const center = dropMark?.groupId === g.id && dropMark.center
                  const fromG = id ? groups.find((grp) => grp.tabs.some((t) => t.id === id)) : null
                  setDropMark(null)
                  if (!id || !center || !fromG) return
                  // 中心松手 = 分屏判定(小葵拍的):别组页签拖来 = 挪来这一组;
                  // 自己组页签 + 只有单组 = 拆成两栏;两组还往自己组中心拖 = 什么也不发生
                  if (fromG.id !== g.id || groups.length === 1) moveTab(id, 'sibling', null)
                }}
              >
                {act && !(act.kind === 'chat' && act.pinned) ? (
                  // 每组正房只住一个房间(VS Code 的克制);钉住的对话走下面的保活层
                  renderTabBody(act)
                ) : !act ? (
                  // 这组没有亮着的页签(品类全被取消勾选):大 logo 底板,右键空白处能勾回来
                  <PaneEmptyBoard />
                ) : null}
                {dropMark?.groupId === g.id && dropMark.center && showDropHint(g.id) && (
                  <div className="pane-drop-hint" aria-hidden="true">
                    {groups.length === 1 ? '松手,拆成两栏' : '松手,挪到这一组'}
                  </div>
                )}
                {/* 钉住的对话保活层(跟着组走):账本各自长,切页签只藏不拆 —— 一拆,那场对话就真没了 */}
                {result &&
                  g.tabs
                    .filter((t) => t.kind === 'chat' && t.pinned)
                    .map((t) => (
                      <div
                        key={t.id}
                        className={`pinned-chat-host${t.id === g.activeId ? '' : ' is-hidden'}`}
                      >
                        <PinnedChatPane
                          tab={t}
                          result={result}
                          refs={previewRefs}
                          onRemoveRef={removePreviewRef}
                          onDropNode={handleDropNode}
                          fileLinks={fileLinks}
                          suggestionsOn={chatSuggestionsOn}
                        />
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
