// UI 工作台(实验分支):用户以最小可复用单位拼装自己的 app 界面,导出 token JSON + 可插拔适配器产物。
// 版式对照 Figma UI3:左侧栏占用全局侧栏(UiWorkbenchSidebar);页签内 = 画布(标尺 + 底板 + 画板)
// + 底部浮动工具栏 + 右侧属性面板。Figma UI3 无顶栏,顶部由应用页签带承担;面板顶栏放导出与缩放。
// 没选中时属性面板显示页面(画布底色)与画板设置;选中节点时换成该节点的属性(Figma 同款)。
import { useEffect, useMemo } from 'react'
import type { ArtboardSize } from '@shared/uiWorkbench/artboard'
import { visibleNodes } from '@shared/uiWorkbench/scene'
import { artboardPrefsActions, useArtboardPrefs } from '../../uiWorkbench/artboardPrefsStore'
import {
  docActions,
  selectedNode,
  selectedNodes,
  useDocState
} from '../../uiWorkbench/documentStore'
import { useLineStyles } from '../../uiWorkbench/lineStyleStore'
import { newRectDefaultsActions } from '../../uiWorkbench/newRectDefaultsStore'
import { useStyles } from '../../uiWorkbench/styleStore'
import { useCanvasTools } from '../../uiWorkbench/useCanvasTools'
import { useCanvasViewport } from '../../uiWorkbench/useCanvasViewport'
import { ArtboardPanel } from './ArtboardPanel'
import { CanvasStage } from './CanvasStage'
import { ExportMenu } from './ExportMenu'
import { LinePanel } from './LinePanel'
import { NewLinePanel } from './NewLinePanel'
import { NewRectPanel } from './NewRectPanel'
import { PagePanel } from './PagePanel'
import { RectPanel } from './RectPanel'
import { WorkbenchToolbar } from './WorkbenchToolbar'

const ZOOM_TIP =
  'Ctrl+滚轮 缩放 · 滚轮 平移 · 空格或中键拖动 平移\nCtrl+0 回到 100% · Shift+1 适配窗口'

export function UiWorkbench(): React.JSX.Element {
  // 画板尺寸归当前页(Figma 里 Frame 属于 Page);本机偏好只管「最近用过」「我的预设」与新文档的初始尺寸
  const prefs = useArtboardPrefs()
  const docState = useDocState()
  const board = docState.activePage.artboard
  const viewport = useCanvasViewport(board)
  const tools = useCanvasTools(viewport, board)
  const { refit } = viewport
  // 切页或画板尺寸变了(改尺寸、撤销/重做)都重新适配窗口
  useEffect(() => {
    refit({ width: board.width, height: board.height })
  }, [docState.activePageId, board.width, board.height, refit])
  const selected = selectedNode(docState)
  const selectedAll = selectedNodes(docState)
  const styles = useStyles()
  const lineStyles = useLineStyles()
  // 导出 doc 带上样式库:token 适配器按「定义+引用」发出,其余适配器忽略该字段
  const doc = useMemo(
    () => ({ artboard: board, nodes: visibleNodes(docState.nodes), styles, lineStyles }),
    [board, docState.nodes, styles, lineStyles]
  )

  /** 多选态:把某个样式整组应用(写定义值+挂 styleId,合成一笔撤销);选「无样式」= 整组脱钩 */
  function applyStyleToSelection(styleId: string): void {
    const s = styles.find((it) => it.id === styleId)
    docActions.beginBatch()
    try {
      // 样式只属于矩形;选集里的直线跳过
      for (const n of selectedAll) {
        if (n.type !== 'rect') continue
        docActions.dispatch({
          type: 'update',
          id: n.id,
          patch: s
            ? {
                fill: s.fill,
                stroke: s.stroke,
                radii: [...s.radii] as typeof n.radii,
                styleId: s.id
              }
            : { styleId: null }
        })
      }
    } finally {
      docActions.endBatch()
    }
    newRectDefaultsActions.rememberStyle(s?.id ?? null, s)
  }

  function changeBoard(next: ArtboardSize): void {
    docActions.patchPage(docState.activePageId, { artboard: next })
    artboardPrefsActions.record(next)
  }

  return (
    <section className="ui-workbench" aria-label="UI 工作台">
      <div className="uwb-stage">
        <CanvasStage
          board={board}
          background={docState.activePage.background}
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
            selected.type === 'rect' ? (
              <RectPanel node={selected} />
            ) : (
              <LinePanel node={selected} />
            )
          ) : selectedAll.length > 1 ? (
            <div className="uwb-multi" role="status">
              {`已选 ${selectedAll.length} 个对象`}
              <select
                className="cfg-select uwb-select"
                aria-label="整组应用样式"
                value=""
                onChange={(e) => applyStyleToSelection(e.target.value)}
              >
                <option value="" disabled>
                  整组应用样式…
                </option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">无样式(整组脱钩)</option>
              </select>
              <span className="uwb-multi-hint">可整组移动 / 删除 / 复制粘贴,Esc 取消选择</span>
            </div>
          ) : tools.tool === 'rect' ? (
            <NewRectPanel />
          ) : tools.tool === 'line' ? (
            <NewLinePanel />
          ) : (
            <>
              <PagePanel page={docState.activePage} />
              <ArtboardPanel
                board={board}
                prefs={prefs}
                onChange={changeBoard}
                onSavePreset={(name) => artboardPrefsActions.savePreset(name, board)}
                onRemovePreset={artboardPrefsActions.removePreset}
              />
            </>
          )}
        </div>
      </aside>
    </section>
  )
}
