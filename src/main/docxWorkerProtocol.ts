// 主进程 ↔ Word 转换后台线程的约定(纯类型 + 常量,两边共用)

import { formatSize } from '../shared/fsMessages.ts'
import { DOCX_CONVERT_TIMEOUT_MS, DOCX_UNZIPPED_MAX_BYTES } from '../shared/preview.ts'
import type { DocxImageEntry } from '../shared/docxMedia.ts'

const MS_PER_MINUTE = 60 * 1000

/** 进度最多多久报一次(毫秒):图片成百上千张时不刷屏 */
export const DOCX_PROGRESS_EVERY_MS = 200

export interface DocxWorkerJob {
  absPath: string
  relPath: string
  /** 本次转换的图片落盘目录(主进程建好、转完登记、作废即删) */
  outDir: string
}

export type DocxWorkerMessage =
  { type: 'progress'; images: number } | { type: 'done'; outcome: DocxConvertOutcome }

export type DocxConvertOutcome =
  | { kind: 'ok'; html: string; warnings: number; images: DocxImageEntry[] }
  | { kind: 'rejected'; reason: string }

/** Word 预览的各种拒绝/失败提示(界面原样显示) */
export const DOCX_REASONS = {
  fake: '文件内容不是有效的 .docx,可能是其他格式的文件改了扩展名,无法预览',
  corrupt: '文档已损坏(压缩结构不完整),无法预览,可尝试用 Word 打开并修复',
  bomb: `文档解压后超过 ${formatSize(DOCX_UNZIPPED_MAX_BYTES)},超出预览上限`,
  unreadable: '无法解析此文档,文件可能已损坏或并非 Word 格式',
  tooMuchText: '文档内容过多,无法预览',
  timeout: `文档转换超时(超过 ${DOCX_CONVERT_TIMEOUT_MS / MS_PER_MINUTE} 分钟),已停止预览`,
  outOfMemory: '文档过大,转换时内存不足,无法预览'
} as const
