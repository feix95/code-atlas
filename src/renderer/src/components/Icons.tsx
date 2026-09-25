/* ── 图标配色(图标册 v5 落地):一图一色,实线稿无填充。
 *  --ic  深底色(直接存)
 *  --ic-l 浅底色(同色相、明度 ×0.58,跟 v5 预览页同一公式换算)
 *  默认吃 --ic-l(浅色主题),:root[data-theme='dark'] 时切 --ic —— 规则在 main.css .ticon
 *  设计决定(DRY 审计 P2-7):这套 pastel 调色板自成一局,不进 design token 体系 ——
 *  彩色图标永远 pastel 是刻意的辨识度设计;mono 开关已让单色场景走 token。哪天要让
 *  彩色跟主题走,再映射 token,现在别动。 ── */
const ICON_COLORS: Record<string, string> = {
  file: '#8fa8cc',
  folder: '#eab75c',
  doc: '#63aef2',
  config: '#b28ef2',
  style: '#f2789f',
  terminal: '#5fd49a',
  image: '#a78bfa',
  audio: '#4fd0c0',
  video: '#f2807a',
  font: '#96a8f0',
  archive: '#d9a06c',
  test: '#5fd0a0',
  entry: '#5ec98a',
  lock: '#e5b960',
  key: '#f2cd6b',
  package: '#e8936b',
  code: '#56c8ea',
  database: '#7aa8f0',
  globe: '#62bcd9',
  component: '#6fd3a7',
  table: '#6bc4c4',
  wrench: '#9fb0c3',
  data: '#f0c75e',
  gear: '#b6aee6',
  bulb: '#f5d060',
  clip: '#9fb0c3',
  copy: '#9fb0c3',
  pin: '#f27676',
  arrowUp: '#6aaef5',
  expand: '#9fb0c3',
  collapse: '#9fb0c3',
  folderSearch: '#eab75c',
  brain: '#f292b8',
  markStart: '#56c8ea',
  markEnd: '#56c8ea',
  bot: '#f5a35f',
  help: '#7aa8f0',
  check: '#a78bfa',
  cpu: '#f08fa8',
  arrows: '#93a6c4',
  arrowLeft: '#93a6c4',
  arrowRight: '#93a6c4',
  refresh: '#4fd0a8',
  notepen: '#d9b26b'
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const to = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(hue(h + 1 / 3))}${to(hue(h))}${to(hue(h - 1 / 3))}`
}

/** 给 svg 挂双主题色令牌:深底 --ic、浅底 --ic-l(明度×0.58) */
function tint(hex: string): React.CSSProperties {
  const [h, s, l] = hexToHsl(hex)
  return {
    '--ic': hex,
    '--ic-l': hslToHex(h, Math.min(1, s * 1.06), l * 0.58)
  } as React.CSSProperties
}

/** 备注小笔(v5 换 Lucide pencil-line 官方稿,顺带从 16 栅格升 24):
 *  「is-tapping」时以笔尖为轴轻磕一下并从笔尖划出一道笔迹淡出 */
export function NotePen({
  size = 12,
  tapping = false
}: {
  size?: number
  tapping?: boolean
}): React.JSX.Element {
  return (
    <svg
      className={`note-pen ticon${tapping ? ' is-tapping' : ''}`}
      style={tint(ICON_COLORS.notepen)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="note-pen-trail" d="M13 21h8" />
      <path d="m15 5 4 4" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  )
}

/** 顶栏线稿图标家族(第一百零三锤;v5 上色:跟文件树一套令牌;
 *  mono=true 时去色吃 currentColor —— 顶栏那组走单色,聊天/Git 面板的同款照旧彩色) */
export function IconArrowLeft({
  size = 14,
  mono = false,
  strokeWidth = 2
}: {
  size?: number
  mono?: boolean
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      className={mono ? 'top-icon' : 'top-icon ticon'}
      style={mono ? undefined : tint(ICON_COLORS.arrowLeft)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  )
}

export function IconArrowRight({
  size = 14,
  mono = false,
  strokeWidth = 2
}: {
  size?: number
  mono?: boolean
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      className={mono ? 'top-icon' : 'top-icon ticon'}
      style={mono ? undefined : tint(ICON_COLORS.arrowRight)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

export function IconRefresh({
  size = 14,
  mono = false,
  strokeWidth = 2
}: {
  size?: number
  mono?: boolean
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      className={mono ? 'top-icon' : 'top-icon ticon'}
      style={mono ? undefined : tint(ICON_COLORS.refresh)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {BOOK.refresh}
    </svg>
  )
}

/* 「打开项目」钮上的文件夹不吃彩色:它坐在 accent 底上,得跟按钮文字同色(accent-ink)保住对比度 */
export function IconFolder({
  size = 14,
  strokeWidth = 2
}: {
  size?: number
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      className="top-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  )
}

/* ── 树图标册:一图一义、24 线稿、一图一色(v5:小葵手改稿 + Lucide 官方稿混编) ── */

function Line({
  children,
  size = 13,
  strokeWidth = 2,
  color
}: {
  children: React.ReactNode
  size?: number
  strokeWidth?: number
  color?: string
}): React.JSX.Element {
  return (
    <svg
      className={color ? 'ticon' : undefined}
      style={color ? tint(color) : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 图标册:名字 → 线稿。新词条先查册领图,一图一义,不许一个图顶两个岗 */
const BOOK: Record<string, React.ReactNode> = {
  // 兜底文件(v5 换 Lucide file-question-mark):认不出的文件就画个问号
  file: (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M12 17h.01" />
      <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
    </>
  ),
  // 文件夹(小葵稿):加一道盒盖横线
  folder: (
    <>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M2 10.5h20" />
    </>
  ),
  doc: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
    </>
  ),
  config: (
    <>
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </>
  ),
  // 样式(v5 换 Lucide paint-roller):刷样式=刷漆
  style: (
    <>
      <rect width="16" height="6" x="2" y="2" rx="2" />
      <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect width="4" height="6" x="8" y="16" rx="1" />
    </>
  ),
  terminal: (
    <>
      <path d="M4 17l6-5-6-5" />
      <path d="M12 19h8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
      <path d="M21 15l-4.5-4.5L6 21" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8Z" />
    </>
  ),
  font: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  // 测试(v5 换 Lucide file-check 角标版):文件折角 + 右下角对勾
  test: (
    <>
      <path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m14 20 2 2 4-4" />
    </>
  ),
  // 入口(小葵稿):箭头尾部分一长一短两截
  entry: (
    <>
      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <path d="M10.4 8.6l3.9 3.4-3.9 3.4" />
      <path d="M3 12h6" />
      <path d="M7.6 12h1.9" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  // 密钥(v5 换 Lucide key-round):圆环在右上,齿朝左下
  key: (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  // 依赖清单(v5 换 Lucide package 官方稿):顶面一道胶带
  package: (
    <>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <path d="m7.5 4.27 9 5.15" />
    </>
  ),
  code: (
    <>
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </>
  ),
  // 数据库(v5 换 Lucide server):两层机架盒 + 左侧指示灯
  database: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
      <path d="M2 12h20" />
    </>
  ),
  // 组件(v5 换 Lucide blocks):积木块
  component: (
    <>
      <path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
      <rect x="14" y="2" width="8" height="8" rx="1" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M12 3v18" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8.5 12.5l2.5 2.5 5-6" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M12 9V5" />
      <path d="M9 5h6" />
      <path d="M9 14v.01" />
      <path d="M15 14v.01" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M9 2v2" />
      <path d="M15 20v2" />
      <path d="M9 20v2" />
      <path d="M2 9h2" />
      <path d="M2 15h2" />
      <path d="M20 9h2" />
      <path d="M20 15h2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  arrows: (
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  clip: (
    <>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  gitbranch: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="12" r="3" />
      <path d="M6 9v6" />
      <path d="M15 6a6 6 0 0 1 3 6" />
    </>
  ),
  // .json 花括号(v5 新户口):summarizer 发 'data',以前一直落文件兜底
  data: (
    <>
      <path d="M9 3.5c-2.2 0-3 1.1-3 2.8v3c0 1.2-.9 1.9-2 2.2 1.1.3 2 1 2 2.2v3c0 1.7.8 2.8 3 2.8" />
      <path d="M15 3.5c2.2 0 3 1.1 3 2.8v3c0 1.2.9 1.9 2 2.2-1.1.3-2 1-2 2.2v3c0 1.7-.8 2.8-3 2.8" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // 齿轮(v5 新户口,Lucide settings):设置钮 + *.config.*/config 目录的 '⚙️' 统一改发 'gear'
  gear: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 选区首尾的一对角括号(第一百一十四锤):一正一反,读作「从这里开始 / 到这里结束」
  markStart: <path d="M15 3H8v18h7" />,
  markEnd: <path d="M9 3h7v18H9" />,
  // 思考模式(第一百一十八锤):小葵给的参考图是颗脑子,线稿照脑回的双瓣画
  brain: (
    <>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    </>
  ),
  // 发送(第一百一十八锤):小葵点名要「向上的箭头」
  arrowUp: (
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>
  ),
  // 输入框展开/收合(小葵给的参考图):两角外扩 / 收回
  expand: (
    <>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </>
  ),
  collapse: (
    <>
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="M14 10l7-7" />
      <path d="M3 21l7-7" />
    </>
  ),
  // 翻文件(第一百二十八锤):文件夹上搁一枚放大镜 —— 自己动手翻项目
  folderSearch: (
    <>
      <path d="M4 20V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v3" />
      <circle cx="17" cy="17" r="3.5" />
      <path d="m19.8 19.8 2.2 2.2" />
    </>
  ),
  // 钉住(页签改版):一枚图钉 —— 双击页签把它钉住,树里换文件它不动
  pin: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-2 3h8l-2-3V3" />
      <path d="M12 12v8" />
    </>
  ),
  // 刷新/重来(设置页原名 rotate,和顶栏 IconRefresh 同一支笔)
  refresh: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  // ── 设置页收编(P2-8:第二本 ICON_PATHS 并册,全是 Lucide 线稿,走 mono 单色斑) ──
  settings2: (
    <>
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  palette: (
    <>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7h2c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z" />
    </>
  ),
  gauge: (
    <>
      <path d="M12 15l3.5-3.5" />
      <path d="M20.2 15.5a8.5 8.5 0 1 0-16.4 0" />
    </>
  ),
  sliders: (
    <>
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </>
  ),
  monitor: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 眯眼(小葵点的小眼睛,2026-09-17):睁眼看得见 Key,眯眼看不见
  eyeOff: (
    <>
      <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-3.1 3.9" />
      <path d="M6.1 6.1A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4-.9" />
      <path d="m2 2 20 20" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z" />,
  drive: (
    <>
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  save: (
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  sparkles: (
    <path d="M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  // 裸对勾(不带圈):预设卡角上的「选中了」小标记
  checkBare: <path d="M20 6 9 17l-5-5" />,
  // ── UI v3 框架件(小葵供稿,lucide 线稿;框架图标一律 mono 吃 currentColor,不给户口色)──
  // 搜索框放大镜(lucide search,规格 §5.3)
  search: (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  // 收起侧栏钮(lucide panel-left,规格 §5 槽位1)
  panelLeft: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  // 关系图谱(lucide view,规格 §6 槽位1)
  view: (
    <>
      <path d="M21 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2" />
      <path d="M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2" />
      <circle cx="12" cy="12" r="1" />
      <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
    </>
  ),
  // 概览(lucide navigation,规格 §6 槽位2)
  navigation: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  // AI 状态三态(规格 §6.1):就绪绿勾圈 / 加载中蓝弧(旋转靠 CSS) / 未加载灰插头
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 9-5.5 5.5L8 12" />
    </>
  ),
  loaderCircle: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  unplug: (
    <>
      <path d="m19 5 3-3" />
      <path d="m2 22 3-3" />
      <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="M7.5 13.5 10 11" />
      <path d="M10.5 16.5 13 14" />
      <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
    </>
  ),
  // 回「这台电脑」(lucide house):workspace 栏右的回家钮,B5 换成菜单 ⇅
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  )
}

/** 按册画图:查无此图时老实回「文件」底样,不空手;strokeWidth 供个别图加粗(发送箭头);
 *  mono=true 去色吃 currentColor(顶栏那种单色岗用),不传照旧一图一色 */
export function TreeIcon({
  name,
  size = 13,
  strokeWidth,
  mono = false
}: {
  name: string
  size?: number
  strokeWidth?: number
  mono?: boolean
}): React.JSX.Element {
  const key = name in BOOK ? name : 'file'
  return (
    <Line size={size} strokeWidth={strokeWidth} color={mono ? undefined : ICON_COLORS[key]}>
      {BOOK[key]}
    </Line>
  )
}
