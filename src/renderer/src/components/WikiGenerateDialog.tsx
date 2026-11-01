// 生成确认弹窗:开跑前把模型、语种、位置和本次工作量摆清楚。
// 位置没选、模型没配或在线 API 未确认隐私时,「开始生成」保持禁用。
import { useCallback, useContext, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { DepGraphResult, ScanResult } from '@shared/types'
import { PROVIDER_SHORT_LABEL } from '@shared/aiSetup'
import { TRANSLATE_LANGS } from '@shared/translateLangs'
import { AiSetupContext } from '../aiSetupContext'
import { useWikiGenerate } from '../useWikiGenerate'
import { assembleWikiPages } from '../wikiProgressModel'
import { CfgRow } from './CfgRow'
import { Notice } from './Notice'
import { TreeIcon } from './Icons'

export function WikiGenerateDialog({
  result,
  graph,
  onClose,
  onStarted
}: {
  result: ScanResult
  graph: DepGraphResult
  onClose: () => void
  onStarted: () => void
}): React.JSX.Element {
  const pages = useMemo(() => assembleWikiPages(result, graph), [result, graph])
  const api = useWikiGenerate(result.rootPath, pages)
  const setup = useContext(AiSetupContext)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !api.busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api.busy, onClose])

  const handleStart = useCallback(async (): Promise<void> => {
    if (await api.start()) onStarted()
  }, [api, onStarted])

  const model = api.model
  const modelText =
    model === null
      ? '读取中……'
      : model.modelName.trim() === ''
        ? '还没有选择模型'
        : `${PROVIDER_SHORT_LABEL[model.provider]} · ${model.modelName}`
  const planText =
    api.plan.total === 0
      ? '还没有可生成的篇目。'
      : `${api.plan.total} 篇;已生成 ${api.plan.cached} 篇直接跳过,本次请求 ${api.plan.toGenerate} 篇。`

  return createPortal(
    <div
      className="wiki-dialog-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !api.busy) onClose()
      }}
    >
      <div className="wiki-dialog" role="dialog" aria-modal="true" aria-label="生成仓库 Wiki">
        <div className="wiki-dialog-head">
          <b>生成仓库 Wiki</b>
          <button
            type="button"
            className="wiki-dialog-close"
            aria-label="关闭"
            disabled={api.busy}
            onClick={onClose}
          >
            <TreeIcon name="x" size={14} mono />
          </button>
        </div>

        <div className="wiki-dialog-body">
          {api.loading ? (
            <p className="wiki-dialog-loading">读取配置中……</p>
          ) : (
            <>
              <CfgRow label="模型" hint="逐篇生成时使用这个模型。">
                <span className="wiki-dialog-value">{modelText}</span>
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow label="语种" hint="只影响 Wiki 正文,不改界面语言。">
                <select
                  className="cfg-select"
                  aria-label="Wiki 语种"
                  value={api.language}
                  disabled={api.busy}
                  onChange={(e) => void api.setLanguage(e.target.value)}
                >
                  {TRANSLATE_LANGS.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow
                label="存放位置"
                hint={api.settings?.location ?? '还没选。必须先选一个仓库外的文件夹才能生成。'}
              >
                <button
                  type="button"
                  className="cfg-btn"
                  disabled={api.busy}
                  onClick={() => void api.chooseLocation()}
                >
                  选择位置
                </button>
              </CfgRow>
              <div className="cfg-divider" />
              <CfgRow label="本次计划" hint={planText} />
              {api.plan.total === 0 && (
                <Notice kind="warn">图谱还没算好,暂时没有可生成的篇目。</Notice>
              )}
              {model?.provider === 'cloud' && (
                <Notice kind="warn">
                  在线 API 会把代码摘录发送到远端服务。
                  {api.cloudBlocked && '还没完成隐私确认,确认后才能生成。'}
                  {api.cloudBlocked && setup !== null && (
                    <button
                      type="button"
                      className="wiki-dialog-link"
                      onClick={() => {
                        onClose()
                        setup.openSettings()
                      }}
                    >
                      去 AI 设置
                    </button>
                  )}
                </Notice>
              )}
              {api.damaged && (
                <Notice kind="error">这个项目的 Wiki 记账损坏,先到设置里清理重建,再生成。</Notice>
              )}
              {api.error !== null && <Notice kind="error">{api.error}</Notice>}
              {api.notice !== null && (
                <Notice kind="info">
                  {api.notice}
                  <button
                    type="button"
                    className="wiki-notice-close"
                    aria-label="关闭提示"
                    onClick={api.dismissNotice}
                  >
                    ×
                  </button>
                </Notice>
              )}
            </>
          )}
        </div>

        <div className="wiki-dialog-foot">
          <p className="wiki-dialog-note">同名文档会整体覆盖,已生成且内容没变的篇目会跳过。</p>
          <div className="wiki-dialog-actions">
            <button
              type="button"
              className="btn btn-ghost"
              autoFocus
              disabled={api.busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!api.canStart}
              onClick={() => void handleStart()}
            >
              {api.busy ? '处理中……' : '开始生成'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
