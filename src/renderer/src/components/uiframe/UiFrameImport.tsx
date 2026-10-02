// 「导入」浮层(§14):三条来源 —— 方案文件夹、DTCG token JSON、CSS 变量(文件或粘贴)。
// 导入只读所选内容,解析出的方案以「未入库」身份上画布;战报由 schemeStore.notice 展示。
import { useEffect, useState } from 'react'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import { Notice } from '../Notice'

export function UiFrameImport({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { busy, error } = useSchemeState()
  const [cssText, setCssText] = useState('')
  const loading = busy !== null

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="uf-modal-back" role="presentation" onClick={onClose}>
      <div
        className="uf-modal uf-lib"
        role="dialog"
        aria-label="导入方案"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uf-lib-head">
          <h3 className="uf-panel-title">导入</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <p className="uf-hint">
          只改写名字对得上的变量,对不上的会跳过并在导入后报告名单。导入的方案不进「我的方案」,要收进去请再点「保存方案」。
        </p>
        <div className="uf-import-ops">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void schemeActions.importDoc('uiframe-file')}
          >
            方案文件(.uiframe)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void schemeActions.importDoc('scheme-folder')}
          >
            方案文件夹(旧格式)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void schemeActions.importDoc('dtcg-file')}
          >
            DTCG / design.json 文件
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void schemeActions.importDoc('css-file')}
          >
            CSS 变量文件
          </button>
        </div>
        <label className="uf-import-paste">
          <span className="uf-card-meta">
            或者直接粘贴 CSS 变量(形如 --color-primary: #2563EB;)
          </span>
          <textarea
            className="uf-input uf-import-area"
            value={cssText}
            aria-label="粘贴 CSS 变量"
            placeholder="--color-primary: #2563EB;&#10;--space-md: 1rem;"
            onChange={(e) => setCssText(e.target.value)}
          />
        </label>
        <div className="uf-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !cssText.trim()}
            onClick={() => void schemeActions.importDoc('css-text', cssText)}
          >
            {loading ? '导入中……' : '解析粘贴内容'}
          </button>
        </div>
      </div>
    </div>
  )
}
