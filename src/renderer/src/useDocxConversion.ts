// Word 预览签的转换现场:挂载即向主进程要一次转换(后台线程跑),换文件/文件被改/关签就作废。
// 账按「这一次读到的结果对象」记 —— 旧任务迟到的回执、旧任务的进度,一律当没看见。
import { useEffect, useState } from 'react'
import type { FilePreviewDocx } from '@shared/types'
import { friendlyErr } from './errText'

export type DocxView =
  | { phase: 'converting'; images: number }
  | { phase: 'ready'; html: string; warnings: number }
  | { phase: 'failed'; reason: string }

const STARTING: DocxView = { phase: 'converting', images: 0 }

export function useDocxConversion(
  rootPath: string,
  relPath: string,
  /** readPreview 这一次的回执:文件被外部改动后会换新对象,借它触发重转 */
  revision: FilePreviewDocx
): DocxView {
  const [state, setState] = useState<{ owner: FilePreviewDocx | null; view: DocxView }>({
    owner: null,
    view: STARTING
  })

  useEffect(() => {
    const jobId = crypto.randomUUID()
    let alive = true
    const show = (view: DocxView): void => {
      if (alive) setState({ owner: revision, view })
    }
    const off = window.atlas.onDocxProgress((p) => {
      if (p.jobId === jobId) show({ phase: 'converting', images: p.images })
    })
    window.atlas
      .convertDocx(rootPath, relPath, jobId)
      .then((r) => {
        if (r.status === 'ok') show({ phase: 'ready', html: r.html, warnings: r.warnings })
        else if (r.status === 'rejected') show({ phase: 'failed', reason: r.reason })
      })
      .catch((e) => show({ phase: 'failed', reason: friendlyErr(e) }))
    return () => {
      alive = false
      off()
      // 作废:还在转就停掉后台线程,转完了就把这份的图片连账清掉
      void window.atlas.releaseDocx(jobId).catch(() => {})
    }
  }, [rootPath, relPath, revision])

  return state.owner === revision ? state.view : STARTING
}
