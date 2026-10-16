// 画布 iframe 内的整页渲染:一张铺满视口的透明 iframe,里面放根容器,平移缩放的 transform 挂在根上;
// 顶层画板各自一个裁切容器(尺寸/填充来自 pageLayout,与导出同源),直接放在页面上的对象按页面坐标定位。
// iframe 本身不接收指针(pointer-events: none),交互全部走视口坐标换算。
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  FRAME_BOX_PREFIX,
  pageLayout,
  PAGE_ROOT_CLASS
} from '@shared/uiWorkbench/export/pageLayout'
import type { SceneNode } from '@shared/uiWorkbench/scene'
import type { Viewport } from '../../uiWorkbench/viewport'

/** 画板在画布上的投影:iframe 里读不到应用的 CSS 变量,这里单独登记(只用于画布,不进导出) */
const CANVAS_FRAME_SHADOW = '0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.12)'

export function PageNodes({
  body,
  nodes,
  view
}: {
  body: HTMLBodyElement
  nodes: readonly SceneNode[]
  view: Viewport
}): React.JSX.Element {
  const layout = useMemo(() => pageLayout(nodes), [nodes])
  return createPortal(
    <>
      <style>{`html, body { margin: 0; overflow: hidden; background: transparent; }\n.${PAGE_ROOT_CLASS} { position: absolute; left: 0; top: 0; transform-origin: 0 0; }\n[class^="${FRAME_BOX_PREFIX}"] { box-shadow: ${CANVAS_FRAME_SHADOW}; }\n${layout.css}`}</style>
      <div
        className={PAGE_ROOT_CLASS}
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
      >
        {layout.items.map((item) =>
          item.rootClass === null ? (
            <div key={item.id} className={item.id} />
          ) : (
            <div key={item.id} style={{ position: 'absolute', left: item.x, top: item.y }}>
              <div className={item.rootClass}>
                {item.childIds.map((id) => (
                  <div key={id} className={id} />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </>,
    body
  )
}
