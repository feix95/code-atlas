// 侧栏的 Wiki 说明区块:一句话简介、标签、摘要、关键文件、生成信息与文档入口。
// 散件文件多一行所属散件组;过期、缺失与失败只给提示,重新生成在进度页做。
// 标签右键可改色,颜色只上标签芯片,不参与画布模块着色。
import { useState, type MouseEvent } from 'react'
import type { WikiPanelPage, WikiPanelStatus } from '@shared/wikiTypes'
import { isHexColor } from '../graph/colorPrefs'
import { tagColorKey } from '../graph/tagColors'
import { setTagColor, useTagColorOverrides } from '../graph/tagColorStore'
import { openContextMenu } from './contextMenuStore'
import { ModuleColorPicker } from './ModuleColorPicker'

export interface GraphWikiSectionProps {
  page: WikiPanelPage | null
  /** 散件组的程序名;模块文件为 null */
  groupName: string | null
  /** 记账损坏:读不到说明 */
  damaged: boolean
  /** 在系统文件管理器中定位这篇 Markdown */
  revealDoc: (file: string) => void
  /** 项目根:标签颜色按项目分开存 */
  rootPath: string
  /** 点标签 = 以该标签搜索 */
  onSearchTag?: (tag: string) => void
}

interface TagPickTarget {
  tag: string
  /** 视口坐标:取色浮层固定在打开处 */
  x: number
  y: number
  /** 没改过色时取色器回显的中性色 */
  base: string
}

function neutralHex(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--graph-module-neutral')
    .trim()
  return isHexColor(value) ? value : '#888888'
}

const STATUS_NOTE: Partial<Record<WikiPanelStatus, string>> = {
  stale: '代码已变化,可重新生成',
  missing: '文档已被移动或删除,可重新生成',
  failed: '上次生成失败,可重新生成',
  cancelled: '上次生成中断,可重新生成'
}

function formatGeneratedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}` : iso
}

export function GraphWikiSection({
  page,
  groupName,
  damaged,
  revealDoc,
  rootPath,
  onSearchTag
}: GraphWikiSectionProps): React.JSX.Element {
  const tagColors = useTagColorOverrides(rootPath)
  const [tagTarget, setTagTarget] = useState<TagPickTarget | null>(null)
  const aiName = page?.name ? page.name : groupName
  const status = page?.status ?? 'none'
  const note = STATUS_NOTE[status]
  const hasMeta = page !== null && status !== 'none' && page.generatedAt !== ''
  const openTagMenu = (e: MouseEvent<HTMLButtonElement>, tag: string): void => {
    e.preventDefault()
    const doc = e.currentTarget.ownerDocument
    const x = e.clientX
    const y = e.clientY
    openContextMenu({
      x,
      y,
      doc,
      noTips: true,
      compact: true,
      items: [
        {
          label: '更改标签颜色',
          run: () => setTagTarget({ tag, x, y, base: neutralHex() })
        }
      ]
    })
  }
  const picker = tagTarget ? (
    <ModuleColorPicker
      fixed
      target={{
        id: tagTarget.tag,
        name: tagTarget.tag,
        x: tagTarget.x,
        y: tagTarget.y,
        current: tagColors.get(tagColorKey(tagTarget.tag)) ?? tagTarget.base,
        isCustom: tagColors.has(tagColorKey(tagTarget.tag))
      }}
      onPick={(color, keepOpen) => {
        setTagColor(rootPath, tagTarget.tag, color)
        if (!keepOpen || color === null) setTagTarget(null)
      }}
      onClose={() => setTagTarget(null)}
    />
  ) : null
  return (
    <section className="graph-panel-section">
      <h3 className="graph-panel-h">Wiki 说明</h3>
      {groupName !== null && (
        <div className="graph-file graph-wiki-owner">
          <span className="graph-file-name">{aiName}</span>
          <span className="graph-file-note">散件组</span>
        </div>
      )}
      {damaged && <p className="graph-panel-note">Wiki 记录损坏,暂时读不到说明</p>}
      {note !== undefined && <p className="graph-panel-note">{note}</p>}
      {!damaged && status === 'none' && groupName !== null && (
        <p className="graph-panel-note">这个散件组还没生成说明,可在卡片墙里生成</p>
      )}
      {!damaged && page !== null && status !== 'none' && (
        <>
          {page.summary !== '' && <p className="graph-wiki-summary">{page.summary}</p>}
          {page.tags.length > 0 && (
            <ul className="graph-wiki-tags">
              {page.tags.map((tag) => {
                const color = tagColors.get(tagColorKey(tag))
                return (
                  <li key={tag}>
                    <button
                      type="button"
                      className="graph-wiki-tag"
                      onClick={() => onSearchTag?.(tag)}
                      onContextMenu={(e) => openTagMenu(e, tag)}
                    >
                      {color !== undefined && (
                        <span
                          className="graph-swatch"
                          style={{ background: color }}
                          aria-hidden="true"
                        />
                      )}
                      {tag}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {page.excerpt !== '' && <p className="graph-wiki-excerpt">{page.excerpt}</p>}
          {page.keyFiles.length > 0 && (
            <div className="graph-wiki-block">
              <p className="graph-folder-name">关键文件</p>
              <ul className="graph-file-list">
                {page.keyFiles.map((file) => (
                  <li key={file}>
                    <div className="graph-file">
                      <span className="graph-file-name">{file}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasMeta && (
            <p className="graph-panel-note graph-wiki-meta">
              生成于 {formatGeneratedAt(page.generatedAt)} · {page.model}
            </p>
          )}
          {page.file !== '' && status !== 'missing' && (
            <button
              type="button"
              className="graph-panel-btn graph-wiki-open"
              onClick={() => revealDoc(page.file)}
            >
              打开说明文档
            </button>
          )}
        </>
      )}
      {picker}
    </section>
  )
}
