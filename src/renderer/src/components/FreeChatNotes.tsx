import { memo, useState } from 'react'
import type { AgentSearchCard } from '@shared/types'
import { findFileLinks, type FileLinkTarget } from '@shared/fileLinks'

/**
 * 自由对话的「程序递话」件:程序垫的灰字(轨迹行/摘要/通知)与命中清单卡。
 * 这些不是谁说出口的话,是旁边有人递了份新材料 —— 都从 FreeChatPanel 拆出来,
 * 纯搬家不改行为。
 */

/**
 * 程序垫的灰字(轨迹行/摘要/通知)里的文件链接:这些文字是 app 自己记的,
 * 路径百分百真实,同一套检测顺手让它们也可点。没传 fileLinks 就原样纯文字。
 */
export const FileNoteText = memo(function FileNoteText({
  text,
  fileLinks
}: {
  text: string
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  if (!fileLinks) return <>{text}</>
  const spans = findFileLinks(text, fileLinks.index)
  if (spans.length === 0) return <>{text}</>
  const nodes: React.ReactNode[] = []
  let last = 0
  spans.forEach((s, i) => {
    if (s.start > last) nodes.push(text.slice(last, s.start))
    nodes.push(
      <button
        key={i}
        type="button"
        className="md-file-link"
        onClick={() => fileLinks.onOpen(s.relPath, s.line)}
        onContextMenu={(e) => {
          if (!fileLinks.onMenu) return
          e.preventDefault()
          fileLinks.onMenu(s.relPath, e.clientX, e.clientY, e.currentTarget.ownerDocument)
        }}
        data-tip={`打开预览:${s.relPath}${s.line !== undefined ? ` 第 ${s.line} 行` : ''};右键:复制路径 / 在资源管理器中显示`}
      >
        {s.relPath}
        {s.line !== undefined ? `:${s.line}` : ''}
      </button>
    )
    last = s.end
  })
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
})

/** 命中清单卡默认收几条:命中一多全铺开会把消息区顶到天上去,多的点开再看 */
const MATCH_PREVIEW_COUNT = 8

/**
 * 命中清单卡(LLM 优化锤):search_content 搜到的结构化命中,程序摆卡直说,
 * 不劳模型转手抄写 —— 一条不丢、行号一个不错。「文件:行号」整块可点,
 * 点了左边开预览直达那一行(和聊天里 AI 提到文件的可点链接同一去处)。
 * 数据是主进程程序自己产的真货,路径不用再过 findFileLinks 的户口检查。
 */
export const MatchListCard = memo(function MatchListCard({
  card,
  fileLinks
}: {
  card: AgentSearchCard
  fileLinks?: FileLinkTarget | null
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? card.items : card.items.slice(0, MATCH_PREVIEW_COUNT)
  return (
    <div className="chat-note is-matches" role="status">
      <p className="chat-matches-head">
        搜「{card.keyword}」命中 {card.items.length} 处
        {card.truncated ? '(命中太多,只收了前 50 条)' : ''}
      </p>
      <ul className="chat-matches-list">
        {shown.map((it, i) => (
          <li key={`${it.relPath}:${it.line}:${i}`}>
            <button
              type="button"
              className="chat-match-loc"
              onClick={() =>
                fileLinks?.onOpen(it.relPath, it.kind === 'path' ? undefined : it.line)
              }
              onContextMenu={(e) => {
                if (!fileLinks?.onMenu) return
                e.preventDefault()
                fileLinks.onMenu(it.relPath, e.clientX, e.clientY, e.currentTarget.ownerDocument)
              }}
              data-tip={
                fileLinks ? `打开预览:${it.relPath};右键:复制路径 / 在资源管理器中显示` : it.relPath
              }
            >
              {it.kind === 'path' ? it.relPath : `${it.relPath}:${it.line}`}
            </button>
            <span className="chat-match-text" data-tip={it.text}>
              {it.text}
            </span>
          </li>
        ))}
      </ul>
      {card.items.length > MATCH_PREVIEW_COUNT && (
        <button
          type="button"
          className="chat-matches-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? '收起' : `展开全部 ${card.items.length} 条`}
        </button>
      )}
    </div>
  )
})
