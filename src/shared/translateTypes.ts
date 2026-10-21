/** 文件翻译的 IPC 载荷与事件(主进程算、渲染层画,两边共用同一份形状) */

export interface TranslateStartRequest {
  /** 一次翻译任务的号:取消与事件路由都认它 */
  requestId: string
  /** 原文全文(渲染层已经读过盘,主进程不再碰文件) */
  text: string
  /** 目标语种代号(见 translateLangs) */
  lang: string
  /** 内联标题原文(掐尾去扩展名);不传或空串 = 不翻不摆 */
  title?: string
}

/** 块的处理方式:prose 送模型翻,code/meta 原样保留 */
export type TranslateBlockKind = 'prose' | 'code' | 'meta' | 'frontmatter'

export type TranslateEvent =
  | {
      requestId: string
      type: 'plan'
      total: number
      kinds: TranslateBlockKind[]
    }
  | {
      requestId: string
      type: 'title'
      text: string
    }
  | {
      requestId: string
      type: 'block'
      index: number
      text: string
      /** true = 这类块不送模型,原文照搬 */
      kept: boolean
    }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; index: number | null; message: string }
