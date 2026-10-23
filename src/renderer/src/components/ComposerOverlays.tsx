// 输入舱上方的两块浮层:斜杠命令补全 + 「+」能力菜单。
import { TreeIcon } from './Icons'

export function SlashPalette({
  matches,
  active,
  onHover,
  onPick
}: {
  matches: Array<{ name: string; desc: string }>
  active: number
  onHover: (index: number) => void
  onPick: (name: string) => void
}): React.JSX.Element {
  return (
    <div className="slash-palette" id="slash-palette" role="listbox" aria-label="斜杠命令">
      {matches.map((c, i) => (
        <button
          key={c.name}
          type="button"
          role="option"
          id={`slash-opt-${c.name.slice(1)}`}
          aria-selected={i === active}
          className={`slash-item${i === active ? ' is-active' : ''}`}
          title={`${c.name} ${c.desc}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(c.name)}
        >
          <span className="slash-name">{c.name}</span>
          <span className="slash-desc">{c.desc}</span>
        </button>
      ))}
    </div>
  )
}

/** 「+」能力菜单:思考/翻文件/联网三个开关 + 添加附件(动作放最下、离「+」钮最近),iOS 拨钮式 */
export function CapabilityMenu({
  thinking,
  agent,
  webOn,
  onToggleThinking,
  onToggleAgent,
  onToggleWeb,
  onPickAttach
}: {
  thinking: boolean
  agent: boolean
  webOn: boolean
  onToggleThinking: (on: boolean) => void
  onToggleAgent: (on: boolean) => void
  onToggleWeb: () => void
  onPickAttach: () => void
}): React.JSX.Element {
  return (
    <div className="fc-menu" role="menu" aria-label="能力开关">
      <button
        type="button"
        className={`fc-mrow${thinking ? ' is-on' : ''}`}
        onClick={() => onToggleThinking(!thinking)}
        aria-pressed={thinking}
      >
        <span className="fc-mi">
          <TreeIcon name="brain" size={14} mono />
        </span>
        思考模式
        <span className="fc-sw" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`fc-mrow${agent ? ' is-on' : ''}`}
        onClick={() => onToggleAgent(!agent)}
        aria-pressed={agent}
      >
        <span className="fc-mi">
          <TreeIcon name="folderSearch" size={14} mono />
        </span>
        自己翻文件
        <span className="fc-sw" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`fc-mrow${webOn ? ' is-on' : ''}`}
        onClick={onToggleWeb}
        aria-pressed={webOn}
      >
        <span className="fc-mi">
          <TreeIcon name="globe" size={14} mono />
        </span>
        联网查询
        <span className="fc-sw" aria-hidden="true" />
      </button>
      {/* 添加附件:图片/文件共用一个口,挑完按类分流 —— 图片走看图那条链,其余文本文件读原文 */}
      <button type="button" className="fc-mrow" onClick={onPickAttach}>
        <span className="fc-mi">
          <TreeIcon name="clip" size={14} mono />
        </span>
        添加附件
      </button>
    </div>
  )
}
