// 导出流程状态机:组装规格包 → 体检(错误级阻止导出)→ 主进程写盘与截图 → 结果。
import { useState } from 'react'
import { buildPackage } from '@shared/uiFrame/exportPackage'
import { hasErrors, lintPackage } from '@shared/uiFrame/lint'
import { HOME_PAGE } from '@shared/uiFrame/page'
import type { LintIssue, UiFrameDoc } from '@shared/uiFrame/types'
import { packageAssets } from './assets'

export type ExportState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'blocked'; issues: LintIssue[] }
  | { kind: 'done'; path: string; warnings: LintIssue[]; unloadedFonts: string[] }
  | { kind: 'error'; message: string }

/** 页面规格文件 → 结构树(体检逐页检查标签与属性) */
const PAGES = { 'pages/home.md': HOME_PAGE.body }

export function useUiFrameExport(): {
  state: ExportState
  run: (doc: UiFrameDoc) => Promise<void>
  dismiss: () => void
} {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })

  async function run(doc: UiFrameDoc): Promise<void> {
    setState({ kind: 'saving' })
    try {
      const pkg = buildPackage(doc, packageAssets(new Date()))
      const issues = lintPackage(pkg, PAGES)
      if (hasErrors(issues)) {
        setState({ kind: 'blocked', issues })
        return
      }
      const result = await window.atlas.uiFrameExport(pkg)
      if (result.status === 'canceled') {
        setState({ kind: 'idle' })
        return
      }
      setState({
        kind: 'done',
        path: result.path,
        warnings: issues.filter((i) => i.level === 'warn'),
        unloadedFonts: result.unloadedFontPreviews
      })
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(err)
      setState({ kind: 'error', message: `导出规格包失败(方案「${doc.name}」):${message}` })
    }
  }

  return { state, run, dismiss: () => setState({ kind: 'idle' }) }
}
