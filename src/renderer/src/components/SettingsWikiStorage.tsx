// 「AI 设置」页的「仓库 Wiki 存储」卡:位置、语种、占用与一键清理。
// 数据与动作都在 useWikiStorage;这里只摆行与确认弹窗。
import { useEffect, useState } from 'react'
import { formatSize } from '@shared/fsMessages'
import { TRANSLATE_LANGS } from '@shared/translateLangs'
import { DEFAULT_WIKI_LANGUAGE } from '@shared/wikiTypes'
import { useWikiStorage } from '../useWikiStorage'
import { CfgRow } from './CfgRow'
import { Notice } from './Notice'
import { TreeIcon } from './Icons'

export function SettingsWikiStorage(): React.JSX.Element {
  const wiki = useWikiStorage()
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!confirmOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmOpen])

  if (wiki.loading) {
    return (
      <CfgRow label="存放位置" hint="读取 Wiki 存储设置中……">
        <span />
      </CfgRow>
    )
  }

  const location = wiki.settings?.location ?? null
  const scan = wiki.scan
  const damaged = scan?.damaged.length ?? 0
  const usage =
    location === null
      ? '还没开始生成。'
      : scan === null
        ? '还在统计……'
        : `${scan.projects} 个项目 · ${scan.files} 篇文档 · ${formatSize(scan.bytes)}`

  return (
    <>
      <CfgRow
        label="存放位置"
        hint={location ?? '还没选,第一次生成前会先请你选一个仓库外的文件夹。'}
      >
        <button
          type="button"
          className="cfg-btn"
          disabled={wiki.busy}
          onClick={() => void wiki.chooseLocation()}
        >
          更改位置
        </button>
      </CfgRow>
      <div className="cfg-divider" />
      <CfgRow label="当前语种" hint="只影响 Wiki 正文,不改界面语言。">
        <select
          className="cfg-select"
          aria-label="Wiki 语种"
          value={wiki.settings?.language ?? DEFAULT_WIKI_LANGUAGE}
          disabled={wiki.settings === null || wiki.busy}
          onChange={(e) => void wiki.setLanguage(e.target.value)}
        >
          {TRANSLATE_LANGS.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </CfgRow>
      <div className="cfg-divider" />
      <CfgRow label="已生成内容" hint={usage}>
        <button
          type="button"
          className="cfg-btn"
          disabled={location === null}
          onClick={() => void wiki.openLocation()}
        >
          打开所在文件夹
        </button>
      </CfgRow>
      <div className="cfg-divider" />
      <CfgRow label="清理全部" hint="只删除应用生成的文档,你自己放进去的文件不会动。">
        <button
          type="button"
          className="cfg-btn"
          disabled={scan === null || scan.projects === 0 || damaged > 0 || wiki.busy}
          onClick={() => setConfirmOpen(true)}
        >
          一键清理
        </button>
      </CfgRow>

      {(wiki.error !== null || wiki.notice !== null || damaged > 0) && (
        <div className="settings-wiki-notices">
          {wiki.error !== null && <Notice kind="error">{wiki.error}</Notice>}
          {wiki.notice !== null && (
            <Notice kind="info">
              {wiki.notice}
              <button
                type="button"
                className="wiki-notice-close"
                aria-label="关闭提示"
                onClick={wiki.dismissNotice}
              >
                ×
              </button>
            </Notice>
          )}
          {damaged > 0 && (
            <Notice kind="warn">
              有 {damaged} 个项目的记账损坏,清理会整体拒绝;先手动处理这些目录。
            </Notice>
          )}
        </div>
      )}

      {confirmOpen && scan !== null && (
        <div
          className="wiki-dialog-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false)
          }}
        >
          <div className="wiki-dialog" role="dialog" aria-label="清理全部 Wiki">
            <div className="wiki-dialog-head">
              <b>清理全部 Wiki</b>
              <button
                type="button"
                className="wiki-dialog-close"
                aria-label="关闭"
                onClick={() => setConfirmOpen(false)}
              >
                <TreeIcon name="x" size={14} mono />
              </button>
            </div>
            <div className="wiki-dialog-body">
              <p>
                将删除 {scan.projects} 个项目、{scan.files} 篇文档(约 {formatSize(scan.bytes)})。
              </p>
              <p>只删除本应用生成的文档,你自己放进去的文件不会动。删除后不可恢复,可重新生成。</p>
            </div>
            <div className="wiki-dialog-foot">
              <div className="wiki-dialog-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  autoFocus
                  onClick={() => setConfirmOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setConfirmOpen(false)
                    void wiki.cleanupAll()
                  }}
                >
                  清理
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
