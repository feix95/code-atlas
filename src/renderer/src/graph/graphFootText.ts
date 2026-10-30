// 关系图谱底栏说明文字
import type { DepGraphResult } from '@shared/types'

const FOOT_EDGES =
  '连线表示代码里的引用(支持 JS/TS、Python、Go、Java、Rust);没有连线的文件暂未发现引用关系'
const FOOT_WHEEL =
  '滚轮缩放;放大或双击文件夹可展开;鼠标停在节点上滚动滚轮切换看法;Ctrl+滚轮进出文件夹'

/** 底栏说明:模块数据缺席或为空时说清楚;模块着色开着时补一句轮廓的含义;末尾附滚轮操作 */
export function footText(graph: DepGraphResult | null, modulesOn: boolean): string {
  if (graph && graph.modules === null) return `模块划分没算出来,先按原始结构显示。${FOOT_WHEEL}`
  if (graph?.modules && graph.modules.modules.length === 0)
    return `未发现可划分的代码模块。${FOOT_WHEEL}`
  const edges = modulesOn ? `${FOOT_EDGES};彩色轮廓圈出程序划分的模块` : FOOT_EDGES
  return `${edges}。${FOOT_WHEEL}`
}
