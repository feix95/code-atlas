import { useId, useState } from 'react'
import type { WebLookupLink } from '@shared/types'
import { TreeIcon } from './Icons'

/** 网址的站点名:折叠区每条链接的第二行用,畸形地址原样交回 */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function WebLinkGroup({
  title,
  links
}: {
  title: string
  links: WebLookupLink[]
}): React.JSX.Element {
  return (
    <div className="chat-weblinks-group">
      <div className="chat-weblinks-head">
        {title} · {links.length}
      </div>
      <ul className="chat-weblinks-list">
        {links.map((link) => (
          <li key={link.url}>
            <a
              className="chat-weblink"
              href={link.url}
              target="_blank"
              rel="noreferrer"
              data-tip={link.url}
            >
              <span className="chat-weblink-title">{link.title}</span>
              <span className="chat-weblink-host">{linkHost(link.url)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 联网足迹:默认收起,点三角展开看搜到/打开过的链接;没有链接就不占地方 */
export function ChatWebLinks({ links }: { links: WebLookupLink[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  if (links.length === 0) return null
  const opened = links.filter((link) => link.opened)
  const searched = links.filter((link) => !link.opened)
  return (
    <>
      <button
        type="button"
        className={`chat-weblinks-toggle${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span className="cv" aria-hidden="true">
          <TreeIcon name="chevron" size={11} mono />
        </span>
        {open ? '收起链接' : `搜过 ${links.length} 个链接`}
      </button>
      {open && (
        <div className="chat-weblinks" id={bodyId}>
          {opened.length > 0 && <WebLinkGroup title="打开过的页面" links={opened} />}
          {searched.length > 0 && <WebLinkGroup title="搜到的链接" links={searched} />}
        </div>
      )}
    </>
  )
}
