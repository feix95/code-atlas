import type { ReactNode } from 'react'

/**
 * 迷你 Markdown 渲染(第一百零七锤):AI 爱用 # 标题、**加粗**、- 列表、``` 代码块说话,
 * 这里把这一小撮语法翻成真正的排版,不再整段甩原文。
 * 刻意手写小解析器而不是上重型库:支持的语法就这几样,渲染成 React 元素,
 * 不碰 dangerouslySetInnerHTML,模型吐什么都不会变成可执行内容。
 */

/** 行内语法:`代码`、**加粗**、[文字](链接);链接只标注不跳转,防止窗口被带跑 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={k++}>{m[2]}</strong>)
    else out.push(
      <span key={k++} className="md-link" title={m[4]}>
        {m[3]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function parseBlocks(text: string): ReactNode[] {
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
    // 围栏代码块:原样进 pre,一个字不动
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
          {inline(h[2])}
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
            <li key={j}>{inline(it)}</li>
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
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      )
      continue
    }
    if (t.startsWith('>')) {
      out.push(<blockquote key={k++}>{inline(t.replace(/^>\s?/, ''))}</blockquote>)
      i++
      continue
    }
    out.push(<p key={k++}>{inline(lines[i].trimEnd())}</p>)
    i++
  }
  return out
}

/** 用法:<MiniMD text={回答} />;流式生成中传 caret 在末尾挂光标 */
export function MiniMD({ text, caret }: { text: string; caret?: boolean }): React.JSX.Element {
  return (
    <div className="md">
      {parseBlocks(text)}
      {caret && <span className="stream-caret">▌</span>}
    </div>
  )
}
