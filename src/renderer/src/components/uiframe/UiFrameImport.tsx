// 「导入」浮层(第 14 节):来源 —— .uiframe 方案文件、旧方案文件夹、DTCG/design.json、
// CSS 变量(文件或粘贴)、Tailwind @theme(走 CSS 变量入口自动识别)。
// 另有两件 M3-d 装备:「复制填表指令」给用户自有 agent 从现有 app 提数值;
// 带出处(agent 声称的 file+line)的导入完成后可就地核对(主进程只读比对)。
// 导入只读所选内容,解析出的方案以「未入库」身份上画布;战报由 schemeStore.notice 展示。
import { useEffect, useState } from 'react'
import { fillInInstruction } from '@shared/uiFrame/fillInstruction'
import { useUiFrameDoc } from '../../uiFrame/docStore'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import { Notice } from '../Notice'

const VERDICT_LABEL: Record<string, string> = {
  matched: '已核对',
  'line-off': '行号偏了',
  mismatch: '对不上',
  nofile: '文件找不到'
}

export function UiFrameImport({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { busy, error, claims, verify } = useSchemeState()
  const { doc } = useUiFrameDoc()
  const [cssText, setCssText] = useState('')
  const loading = busy !== null

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const copyInstruction = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(fillInInstruction(doc))
      schemeActions.flash('填表指令已复制:把它交给你的 AI,它产出的 design.json 回本面板导入')
    } catch {
      schemeActions.flash('剪贴板不可用')
    }
  }

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
            CSS 变量 / Tailwind @theme 文件
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={loading}
            title="生成一份交给你的 AI 的说明书,让它从现有 app 代码里提取数值"
            onClick={() => void copyInstruction()}
          >
            复制填表指令(让 AI 从现有 app 提数值)
          </button>
        </div>
        <label className="uf-import-paste">
          <span className="uf-card-meta">
            或者直接粘贴 CSS 变量(形如 --color-primary: #2563EB;Tailwind @theme 也行)
          </span>
          <textarea
            className="uf-input uf-import-area"
            value={cssText}
            aria-label="粘贴 CSS 变量"
            placeholder="--color-primary: #2563EB;&#10;--space-md: 1rem;"
            onChange={(e) => setCssText(e.target.value)}
          />
        </label>
        {claims.length > 0 && (
          <section className="uf-provenance" aria-label="出处核对">
            <div className="uf-lib-head">
              <h4 className="uf-panel-title">出处核对(这次导入带 {claims.length} 条)</h4>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading}
                title="选一个项目文件夹,只读比对每条出处是否真有该数值"
                onClick={() => void schemeActions.verifyClaims()}
              >
                选择项目文件夹核对
              </button>
            </div>
            <ul className="uf-provenance-list">
              {claims.slice(0, 30).map((cl) => {
                const v = verify?.find((x) => x.name === cl.name && x.file === cl.file)
                return (
                  <li key={`${cl.name}:${cl.file}:${cl.line}`} className="uf-provenance-item">
                    <code>{cl.name}</code>
                    <span className="uf-card-meta">
                      {cl.file}:{cl.line || '?'}
                      {cl.confidence ? ` · ${cl.confidence}` : ''}
                    </span>
                    {v && (
                      <span className={`uf-verdict uf-verdict-${v.status}`} title={v.detail}>
                        {VERDICT_LABEL[v.status] ?? v.status}
                      </span>
                    )}
                  </li>
                )
              })}
              {claims.length > 30 && (
                <li className="uf-card-meta">……还有 {claims.length - 30} 条未列出</li>
              )}
            </ul>
          </section>
        )}
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
