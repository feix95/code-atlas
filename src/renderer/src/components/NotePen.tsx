/** 备注小笔(第九十八锤):细线单色,跟设置齿轮、git 分支一家 —— 不用彩色 emoji(小葵裁定) */
export function NotePen({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      className="note-pen"
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
    </svg>
  )
}
