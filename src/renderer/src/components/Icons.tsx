/** 备注小笔(第九十八锤):细线单色,跟设置齿轮、git 分支一家 —— 不用彩色 emoji(小葵裁定)。
 *  第一百零九锤补:写字动画 —— 「is-tapping」时以笔尖为轴轻磕一下并从笔尖划出一道笔迹淡出 */
export function NotePen({ size = 12, tapping = false }: { size?: number; tapping?: boolean }): React.JSX.Element {
  return (
    <svg
      className={`note-pen${tapping ? ' is-tapping' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.3 2.5a1.9 1.9 0 0 1 2.7 2.7L5.6 13.6l-3.4.9.9-3.4Z" />
      <path d="m9.9 3.9 2.7 2.7" />
      <path className="note-pen-trail" d="M2 15.5h5" />
    </svg>
  )
}

/** 顶栏线稿图标家族(第一百零三锤):跟备注小笔一家 —— 细线单色,currentColor 吃主题色 */
export function IconArrowLeft({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg className="top-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}

export function IconArrowRight({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg className="top-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

export function IconRefresh({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg className="top-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  )
}

export function IconFolder({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg className="top-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

/* ── 树图标册(第一百零六锤):一图一义,全部 24 线稿、currentColor、随主题换装 ── */

function Line({ children, size = 13 }: { children: React.ReactNode; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** 图标册:名字 → 线稿。新词条先查册领图,一图一义,不许一个图顶两个岗 */
const BOOK: Record<string, React.ReactNode> = {
  file: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /></>,
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  doc: <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h8" /></>,
  config: <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  style: <path d="M12 2.7s-6.5 6.6-6.5 11a6.5 6.5 0 0 0 13 0c0-4.4-6.5-11-6.5-11Z" />,
  terminal: <><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-4.5-4.5L6 21" /></>,
  audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 8l-6 4 6 4V8Z" /></>,
  font: <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>,
  archive: <><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>,
  test: <><path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9.5V2" /><path d="M8.5 2h7" /><path d="M7 16h10" /></>,
  entry: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  key: <><circle cx="7.5" cy="15.5" r="3.5" /><path d="M21 2l-9.6 9.6" /><path d="M15.5 7.5l3 3L22 7l-3-3" /></>,
  package: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.27 6.96 12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></>,
  code: <><path d="M16 18l6-6-6-6" /><path d="M8 6l-6 6 6 6" /></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" /><path d="M2 12h20" /></>,
  component: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 3v18" /></>,
  check: <><circle cx="12" cy="12" r="10" /><path d="M8.5 12.5l2.5 2.5 5-6" /></>,
  bot: <><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M12 9V5" /><path d="M9 5h6" /><path d="M9 14v.01" /><path d="M15 14v.01" /></>,
  bulb: <><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></>,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />,
  cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M15 2v2" /><path d="M9 2v2" /><path d="M15 20v2" /><path d="M9 20v2" /><path d="M2 9h2" /><path d="M2 15h2" /><path d="M20 9h2" /><path d="M20 15h2" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  arrows: <><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="M16 21l4-4-4-4" /><path d="M20 17H4" /></>,
  clip: <><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  gitbranch: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="12" r="3" /><path d="M6 9v6" /><path d="M15 6a6 6 0 0 1 3 6" /></>,
  // 选区首尾的一对角括号(第一百一十四锤):一正一反,读作「从这里开始 / 到这里结束」
  markStart: <path d="M15 3H8v18h7" />,
  markEnd: <path d="M9 3h7v18H9" />
}

/** 按册画图:查无此图时老实回「文件」底样,不空手 */
export function TreeIcon({ name, size = 13 }: { name: string; size?: number }): React.JSX.Element {
  return <Line size={size}>{BOOK[name] ?? BOOK['file']}</Line>
}
