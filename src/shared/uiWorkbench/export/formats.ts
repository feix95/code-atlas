// 导出格式登记表:导出菜单按此顺序列出。新增目标平台只在这里追加一个 ExportFormat。
import { HTML_FORMAT } from './cssAdapter.ts'
import { SVG_FORMAT } from './svgAdapter.ts'
import { TOKENS_FORMAT } from './tokensDtcg.ts'
import type { ExportFormat } from './types.ts'

export const EXPORT_FORMATS: readonly ExportFormat[] = [TOKENS_FORMAT, HTML_FORMAT, SVG_FORMAT]
