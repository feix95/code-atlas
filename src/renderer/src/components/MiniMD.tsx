import type { ReactNode } from 'react'
import { findFileLinks, type FileLinkTarget } from '@shared/fileLinks'

/**
 * 迷你 Markdown 渲染(第一百零七锤):AI 爱用 # 标题、**加粗**、- 列表、``` 代码块说话,
 * 这里把这一小撮语法翻成真正的排版,不再整段甩原文。
 * 刻意手写小解析器而不是上重型库:支持的语法就这几样,渲染成 React 元素,
 * 不碰 dangerouslySetInnerHTML,模型吐什么都不会变成可执行内容。
 *
 * 文件链接:传了 fileLinks(目录树索引 + 点击去处)时,普通文字里凡是对上户口的
 * 文件引用就画成可点的链接;围栏代码块和行内代码里的字一律不动 ——
 * 那是在展示代码,不是在递文件。
 */

/** 文件链接拆出来的节点;key 走共享计数器,谁先算完谁先领号 */
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
        title={`打开预览:${s.relPath}${s.line !== undefined ? ` 第 ${s.line} 行` : ''}`}
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

/** 行内语法:`代码`、**加粗**、[文字](链接);链接只标注不跳转,防止窗口被带跑 */
function inline(text: string, links?: FileLinkTarget): ReactNode[] {
  const out: ReactNode[] = []
  const kc = { n: 0 }
  // 第一刀:行内代码 `...` 先摘走,里面的字一个不动
  const codeRe = /`([^`]+)`/g
  let codeLast = 0
  let m: RegExpExecArray | null
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > codeLast) pushMd(text.slice(codeLast, m.index))
    out.push(<code key={kc.n++}>{m[1]}</code>)
    codeLast = m.index + m[0].length
  }
  if (codeLast < text.length) pushMd(text.slice(codeLast))
  return out

  // 第二刀:**加粗** 和 [文字](链接);两样都不碰的普通字才轮到文件检测
  function pushMd(t: string): void {
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g
    let last = 0
    while ((m = re.exec(t)) !== null) {
      if (m.index > last) out.push(...fileNodes(t.slice(last, m.index), links, kc))
      if (m[1] !== undefined) out.push(<strong key={kc.n++}>{fileNodes(m[1], links, kc)}</strong>)
      else
        out.push(
          <span key={kc.n++} className="md-link" title={m[3]}>
            {m[2]}
          </span>
        )
      last = m.index + m[0].length
    }
    if (last < t.length) out.push(...fileNodes(t.slice(last), links, kc))
  }
}

function parseBlocks(text: string, links?: FileLinkTarget): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '') {
      i++
      continue
    }
    // 围栏代码块:原样进 pre,一个字不动(文件检测也不进来)
    if (t.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++
      out.push(
        <pre key={k++} className="md-pre">
          <code>{buf.join('\n')}</code>
        </pre>
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t)
    if (h) {
      const level = h[1].length
      out.push(
        <div key={k++} className={`md-h md-h${level}`}>
          {inline(h[2], links)}
        </div>
      )
      i++
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      out.push(<hr key={k++} className="md-hr" />)
      i++
      continue
    }
    if (/^[-*•]\s+/.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''))
        i++
      }
      out.push(
        <ul key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, links)}</li>
          ))}
        </ul>
      )
      continue
    }
    if (/^\d+[.、)]\s+/.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+[.、)]\s+/, ''))
        i++
      }
      out.push(
        <ol key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, links)}</li>
          ))}
        </ol>
      )
      continue
    }
    if (t.startsWith('>')) {
      out.push(<blockquote key={k++}>{inline(t.replace(/^>\s?/, ''), links)}</blockquote>)
      i++
      continue
    }
    out.push(<p key={k++}>{inline(lines[i].trimEnd(), links)}</p>)
    i++
  }
  return out
}

/** 用法:<MiniMD text={回答} />;流式生成中传 caret 在末尾挂光标;传 fileLinks 让文件名变可点 */
export function MiniMD({
  text,
  caret,
  fileLinks
}: {
  text: string
  caret?: boolean
  fileLinks?: FileLinkTarget
}): React.JSX.Element {
  return (
    <div className="md">
      {parseBlocks(text, fileLinks)}
      {caret && <span className="stream-caret">▌</span>}
    </div>
  )
}
