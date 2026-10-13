// UI 工作台(实验分支):用户以最小可复用单位拼装自己的 app 界面,导出 token JSON + 可插拔适配器产物。
// 版式对照 Figma UI3:左侧栏占用全局侧栏(UiWorkbenchSidebar);页签内 = 画布(标尺 + 底板 + 画板)
// + 底部浮动工具栏 + 右侧属性面板。Figma UI3 无顶栏,顶部由应用页签带承担;面板顶栏放导出与缩放。
// 没选中时属性面板显示画板设置;选中节点时换成该节点的属性(Figma 同款)。
import { useMemo } from 'react'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import { artboardPrefsActions, useArtboardPrefs } from '../../uiWorkbench/artboardPrefsStore'
import { selectedNode, selectedNodes, useDocState } from '../../uiWorkbench/documentStore'
import { useCanvasTools } from '../../uiWorkbench/useCanvasTools'
import { useCanvasViewport } from '../../uiWorkbench/useCanvasViewport'
import { ArtboardPanel } from './ArtboardPanel'
import { CanvasStage } from './CanvasStage'
import { ExportMenu } from './ExportMenu'
import { RectPanel } from './RectPanel'
import { WorkbenchToolbar } from './WorkbenchToolbar'

const ZOOM_TIP =
  'Ctrl+滚轮 缩放 · 滚轮 平移 · 空格或中键拖动 平移\nCtrl+0 回到 100% · Shift+1 适配窗口'

export function UiWorkbench(): React.JSX.Element {
  // 画板尺寸存本机偏好:关掉再打开沿用上次的尺寸
  const prefs = useArtboardPrefs()
  const board = prefs.last
  const viewport = useCanvasViewport(board)
  const tools = useCanvasTools(viewport, board)
  const docState = useDocState()
  const selected = selectedNode(docState)
  const selectedAll = selectedNodes(docState)
  const doc = useMemo(() => ({ artboard: board, nodes: docState.nodes }), [board, docState.nodes])

  function changeBoard(next: ArtboardSize): void {
    artboardPrefsActions.record(next)
    viewport.refit(next)
  }

  return (
    <section className="ui-workbench" aria-label="UI 工作台">
      <div className="uwb-stage">
        <CanvasStage
          board={board}
          doc={doc}
          selectedNodes={selectedAll}
          viewport={viewport}
          tools={tools}
        />
        <WorkbenchToolbar tool={tools.tool} onPick={tools.setTool} />
      </div>
      <aside className="uwb-inspector" aria-label="属性面板">
        <div className="uwb-inspector-head">
          <ExportMenu doc={doc} />
          <span className="uwb-zoom" data-tip={ZOOM_TIP} aria-label="画布缩放比例">
            {`${Math.round(viewport.view.zoom * 100)}%`}
          </span>
        </div>
        <div className="uwb-inspector-body">
          {selected ? (
            <RectPanel node={selected} />
          ) : selectedAll.length > 1 ? (
            <div className="uwb-multi" role="status">
              {`已选 ${selectedAll.length} 个对象`}
              <span className="uwb-multi-hint">可整组移动 / 删除 / 复制粘贴,Esc 取消选择</span>
            </div>
          ) : (
            <ArtboardPanel
              board={board}
              prefs={prefs}
              onChange={changeBoard}
              onSavePreset={(name) => artboardPrefsActions.savePreset(name, board)}
              onRemovePreset={artboardPrefsActions.removePreset}
            />
          )}
        </div>
      </aside>
    </section>
  )
}
