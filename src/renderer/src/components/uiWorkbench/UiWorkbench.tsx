// UI 工作台(实验分支):用户以最小可复用单位拼装自己的 app 界面,导出 token JSON + 可插拔适配器产物。
// 版式对照 Figma UI3:左侧栏占用全局侧栏(UiWorkbenchSidebar);页签内 = 画布(标尺 + 底板 + 画板)
// + 底部浮动工具栏 + 右侧属性面板。Figma UI3 无顶栏,顶部由应用页签带承担;面板顶栏放导出与缩放。
// 没选中时属性面板显示页面(画布底色);选中节点时换成该节点的属性(Figma 同款);画板是页面里的普通对象。
import { useEffect, useMemo, useRef } from 'react'
import { pageExportTargets } from '@shared/uiWorkbench/export/frameDocument'
import { contentBox } from '@shared/uiWorkbench/scene'
import { useArtboardPrefs } from '../../uiWorkbench/artboardPrefsStore'
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
import { CanvasStage } from './CanvasStage'
import { ExportMenu } from './ExportMenu'
import { FramePanel } from './FramePanel'
import { LinePanel } from './LinePanel'
import { NewLinePanel } from './NewLinePanel'
import { NewRectPanel } from './NewRectPanel'
import { PagePanel } from './PagePanel'
import { RectPanel } from './RectPanel'
import { WorkbenchToolbar } from './WorkbenchToolbar'

export function UiWorkbench(): React.JSX.Element {
  const docState = useDocState()
  // 适配窗口的目标 = 当前页全部可见内容的外接框;页面是空的就取一块上次用过的画板尺寸大小的空地
  const lastSize = useArtboardPrefs().last
  const fitTarget = contentBox(docState.nodes) ?? { x: 0, y: 0, ...lastSize }
  const fitRef = useRef(fitTarget)
  useEffect(() => {
    fitRef.current = fitTarget
  })
  const viewport = useCanvasViewport(fitTarget)
  const tools = useCanvasTools(viewport)
  const { refit } = viewport
  // 只在切页时重新适配(编辑内容不该让视图跳动)
  useEffect(() => {
    refit(fitRef.current)
  }, [docState.activePageId, refit])
  const selected = selectedNode(docState)
  const selectedAll = selectedNodes(docState)
  const styles = useStyles()
  const lineStyles = useLineStyles()
  // 导出清单带上样式库:token 适配器按「定义+引用」发出,其余适配器忽略该字段
  const exportTargets = useMemo(
    () => pageExportTargets(docState.nodes, { styles, lineStyles }),
    [docState.nodes, styles, lineStyles]
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

  return (
    <section className="ui-workbench" aria-label="UI 工作台">
      <div className="uwb-stage">
        <CanvasStage
          background={docState.activePage.background}
          nodes={docState.nodes}
          selectedNodes={selectedAll}
          viewport={viewport}
          tools={tools}
        />
        <WorkbenchToolbar tool={tools.tool} onPick={tools.setTool} />
      </div>
      <aside className="uwb-inspector" aria-label="属性面板">
        <div className="uwb-inspector-head">
          <ExportMenu targets={exportTargets} />
          <span className="uwb-zoom" aria-label="画布缩放比例">
            {`${Math.round(viewport.view.zoom * 100)}%`}
          </span>
        </div>
        <div className="uwb-inspector-body">
          {selected ? (
            selected.type === 'rect' ? (
              <RectPanel node={selected} />
            ) : selected.type === 'frame' ? (
              <FramePanel node={selected} />
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
            <PagePanel page={docState.activePage} />
          )}
        </div>
      </aside>
    </section>
  )
}
