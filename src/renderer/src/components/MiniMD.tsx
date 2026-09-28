import { memo, type ReactNode } from 'react'
import { findFileLinks, type FileLinkTarget } from '@shared/fileLinks'
import { parseMarkdown, type MdBlock, type MdInline, type MdList } from '@shared/markdown'

/**
 * 迷你 Markdown 渲染(第一百零七锤起;阅读模式锤拆成 解析/描画 两层):
 * 语法拆解在 src/shared/markdown.ts(纯数据 AST,能进自测),这里只把 AST 画成 React 元素。
 * 刻意手写小解析器而不是上重型库:渲染成 React 元素,不碰 dangerouslySetInnerHTML,
 * 模型/文件吐什么都不会变成可执行内容。
 *
 * 文件链接:传了 fileLinks 时,普通文字里对上户口的文件引用画成可点的链接;
 * 围栏代码块和行内代码里的字一律不动 —— 那是在展示代码,不是在递文件。
 */

/** 一段纯文本里对上户口的文件引用画成可点链接;key 走共享计数器,谁先算完谁先领号 */
function fileNodes(t: string, links: FileLinkTarget | undefined, kc: { n: number }): ReactNode[] {
  if (!links) return [t]
  const spans = findFileLinks(t, links.index)
  if (spans.length === 0) return [t]
  const out: ReactNode[] = []
  let last = 0
  for (const s of spans) {
    if (s.start > last) out.push(t.slice(last, s.start))
    out.push(
      <button
        key={kc.n++}
        type="button"
        className="md-file-link"
        onClick={() => links.onOpen(s.relPath, s.line)}
        onContextMenu={(e) => {
          if (!links.onMenu) return
          e.preventDefault()
          links.onMenu(s.relPath, e.clientX, e.clientY, e.currentTarget.ownerDocument)
        }}
        data-tip={`打开预览:${s.relPath}${s.line !== undefined ? ` 第 ${s.line} 行` : ''};右键:复制路径 / 在资源管理器中显示`}
      >
        {s.relPath}
        {s.line !== undefined ? `:${s.line}` : ''}
      </button>
    )
    last = s.end
  }
  if (last < t.length) out.push(t.slice(last))
  return out
}

/** 行内 token → 元素;text/bold/em 的内文仍过文件链接对账(与旧行为持平) */
function renderInline(
  nodes: MdInline[],
  links: FileLinkTarget | undefined,
  kc: { n: number }
): ReactNode[] {
  return nodes.map((n) => {
    switch (n.t) {
      case 'code':
        return <code key={kc.n++}>{n.text}</code>
      case 'bold':
        return <strong key={kc.n++}>{fileNodes(n.text, links, kc)}</strong>
      case 'em':
        return <em key={kc.n++}>{fileNodes(n.text, links, kc)}</em>
      case 'del':
        return <del key={kc.n++}>{n.text}</del>
      case 'mark':
        return (
          <mark key={kc.n++} className="md-mark">
            {n.text}
          </mark>
        )
      case 'link':
        return (
          <span key={kc.n++} className="md-link" data-tip={n.href}>
            {n.label}
          </span>
        )
      default:
        // text 叶子:整片文件链接对账后包一个 span 领号(切片们是裸字符串,没自己 key)
        return <span key={kc.n++}>{fileNodes(n.text, links, kc)}</span>
    }
  })
}

function renderListNode(
  list: MdList,
  links: FileLinkTarget | undefined,
  kc: { n: number }
): ReactNode {
  const Tag = list.ordered ? 'ol' : 'ul'
  return (
    <Tag key={kc.n++}>
      {list.items.map((it) => {
        const sub = it.sub ? renderListNode(it.sub, links, kc) : null
        if (it.done === undefined) {
          return (
            <li key={kc.n++}>
              {renderInline(it.content, links, kc)}
              {sub}
            </li>
          )
        }
        return (
          <li key={kc.n++} className="md-task">
            <input type="checkbox" disabled checked={it.done} readOnly />
            <span>{renderInline(it.content, links, kc)}</span>
            {sub}
          </li>
        )
      })}
    </Tag>
  )
}

function renderBlock(b: MdBlock, links: FileLinkTarget | undefined, kc: { n: number }): ReactNode {
  switch (b.t) {
    case 'code':
      return (
        <pre key={kc.n++} className="md-pre">
          <code>{b.text}</code>
        </pre>
      )
    case 'heading':
      return (
        <div key={kc.n++} className={`md-h md-h${b.level}`}>
          {renderInline(b.content, links, kc)}
        </div>
      )
    case 'hr':
      return <hr key={kc.n++} className="md-hr" />
    case 'table':
      return (
        <div key={kc.n++} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j} style={{ textAlign: b.aligns[j] ?? 'left' }}>
                    {renderInline(c, links, kc)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.body.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} style={{ textAlign: b.aligns[j] ?? 'left' }}>
                      {renderInline(c, links, kc)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'list':
      return renderListNode(b, links, kc)
    case 'quote':
      return <blockquote key={kc.n++}>{renderBlocks(b.children, links, kc)}</blockquote>
    case 'callout':
      return (
        <div key={kc.n++} className={`md-callout is-${b.kind}`}>
          <div className="md-callout-title">{b.title}</div>
          <div className="md-callout-body">{renderBlocks(b.children, links, kc)}</div>
        </div>
      )
    default:
      return <p key={kc.n++}>{renderInline(b.content, links, kc)}</p>
  }
}

function renderBlocks(
  blocks: MdBlock[],
  links: FileLinkTarget | undefined,
  kc: { n: number }
): ReactNode[] {
  return blocks.map((b) => renderBlock(b, links, kc))
}

/** 用法:<MiniMD text={回答} />;流式生成中传 caret 在末尾挂光标;传 fileLinks 让文件名变可点;
 * 传 title 会在正文顶上摆文档内联标题(Obsidian 式:阅读模式显示文件名)。
 * memo(2026-09-13):每条消息的正文不变就不重画 —— 流式吐字时只有 busy 那条动,
 * 旧消息的解析一遍都不跑;聊得再多,画面上的工作量也只跟「这一屏」挂钩 */
export const MiniMD = memo(function MiniMD({
  text,
  caret,
  fileLinks,
  title
}: {
  text: string
  caret?: boolean
  fileLinks?: FileLinkTarget
  /** 文档内联标题(阅读模式喂文件名);不传不摆 */
  title?: string
}): React.JSX.Element {
  return (
    <div className="md">
      {title !== undefined && title !== '' && <div className="md-title">{title}</div>}
      {renderBlocks(parseMarkdown(text), fileLinks, { n: 0 })}
      {caret && <span className="stream-caret">▌</span>}
    </div>
  )
})
