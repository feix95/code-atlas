import { useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import type { AiConfig, ChatCodeRef } from '@shared/types'
import { COMPACT_COMMAND, isCompactCommand } from '@shared/compact'
import { TreeIcon } from './Icons'
import { openContextMenu, type ContextMenuItem } from './contextMenuStore'
import { REF_ONLY_QUESTION, type AiChatApi } from '../useAiChat'
import { AiSetupContext } from '../aiSetupContext'
import {
  CHAT_ACTION_ICON_SIZE,
  INPUT_CAP_LINES,
  INPUT_EXPAND_LINES,
  INPUT_TOGGLE_ICON_SIZE
} from '../inputMetrics'

/**
 * 一体化输入舱(对话页改版定稿):一行胶囊 = 「+」能力菜单 | 内嵌引用原子+文字 | 发送/停一停;
 * 写到两行起往上长,控件自然落到第二行;满五行封顶出拨杆,拨上去多撑五行。
 * 空场时整颗舱挂在 hero 居中,聊开了沉到底栏 —— 同一颗舱两处坐席。
 * 从 FreeChatPanel 拆出,纯搬家不改行为:草稿/菜单/斜杠补全/弹性长高都是舱自己的家务。
 */

/** 斜杠命令清单(输入框打 / 浮出的补全卡):命令名 + 一句话说明;新命令往这儿加一行就成 */
const SLASH_COMMANDS: Array<{ name: string; desc: string }> = [
  { name: COMPACT_COMMAND, desc: '把前面聊过的压成摘要，省出上下文' }
]

export function FreeChatComposer({
  chat,
  refs,
  onRemoveRef,
  onWillSend
}: {
  chat: AiChatApi
  /** 已引用的代码段(第一百一十一锤):预览模式下由左栏选中攒出来 */
  refs: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
  /** 发送/压缩前先回底:自己的话自己得看见,发出去这一眼不被上翻状态挡住 */
  onWillSend: () => void
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const draftRefs = refs
  const [draft, setDraft] = useState('')
  // 高度拨杆(小葵点名):到五行才亮,拨上去多撑五行空白,拨回来;文字退回五行内自动归位
  const [expanded, setExpanded] = useState(false)
  // 「+」能力菜单:思考/翻文件两个开关收进这颗钮里;点舱外任何地方收摊
  const [menuOpen, setMenuOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const doc = formRef.current?.ownerDocument ?? document
    function onPointerDown(e: MouseEvent): void {
      if (!formRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    doc.addEventListener('mousedown', onPointerDown)
    return () => doc.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])
  // 「+」菜单里的联网开关 = 设置页「联网查证」总闸的快捷位:读一份当前配置存 ref,
  // 拨一下就把整份配置 + webLookup 翻转存回去,返回什么就以什么为准
  const [webOn, setWebOn] = useState(false)
  const cfgRef = useRef<AiConfig | null>(null)
  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (!alive) return
        cfgRef.current = c
        setWebOn(c.webLookup === true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  function toggleWeb(): void {
    const cur = cfgRef.current
    if (!cur) return
    const next = !webOn
    setWebOn(next)
    void window.atlas
      .aiConfigSave({ ...cur, webLookup: next })
      .then((c) => {
        cfgRef.current = c
        setWebOn(c.webLookup === true)
      })
      .catch(() => setWebOn(!next))
  }
  // 现在文字占了几行(按实际渲染量出来的,换行/自动折行都算);一行 = 单行胶囊
  const [lineCount, setLineCount] = useState(1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 斜杠命令补全(打 / 浮出的命令清单):Esc 关面板只是藏起来,输入框内容不动;
  // 内容一变(draft 易手)就重新能冒头 —— 关掉后接着打字照样过滤
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  // 只在「以 / 开头且还没敲空格」时出面,继续打字按前缀过滤;一条不匹配就整个不开
  const slashMatches =
    draft.startsWith('/') && !/\s/.test(draft)
      ? SLASH_COMMANDS.filter((c) => c.name.startsWith(draft.toLowerCase()))
      : []
  const slashOpen = !slashDismissed && slashMatches.length > 0
  const slashActive = Math.min(slashIndex, slashMatches.length - 1)

  function submit(e: FormEvent): void {
    e.preventDefault()
    sendDraft()
  }

  function sendDraft(): void {
    if (setup && setup.configured !== true) {
      if (setup.configured === false) setup.openSettings()
      return
    }
    const q = draft.trim()
    // /compact 手动压缩命令(第一百四十二锤):不当问题发,拦下来直接压缩;
    // 忙着回答时不接,跟发消息一个规矩
    if (isCompactCommand(q)) {
      if (chat.busy) return
      onWillSend()
      chat.compact()
      setDraft('')
      if (expanded) setExpanded(false)
      return
    }
    // 挂了引用就允许空着发:这时替他说一句「讲讲选中的这段代码」,不让他对着空气发呆
    const text = q || (draftRefs.length > 0 ? REF_ONLY_QUESTION : '')
    if (!text || chat.busy) return
    onWillSend()
    chat.send(text, draftRefs)
    setDraft('')
    if (expanded) setExpanded(false)
  }

  /** 选中一条斜杠命令:填成「/xxx 」带一个尾空格,光标落在尾空格后面接着写参数
   *  (React 重画时会按旧选区还原光标,可能把光标留回半截命令上 —— 重画完手动把它摁到末尾) */
  function pickSlash(name: string): void {
    const next = `${name} `
    setDraft(next)
    setSlashIndex(0)
    const el = inputRef.current
    if (el) {
      el.focus()
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = next.length
      })
    }
  }

  /** 回车发送,Shift+回车换行;输入法选词的那下回车不是发送(第一百一十八锤补);
   *  斜杠补全开着时,键盘先伺候面板:上下挑、回车/Tab 选定(不是发消息)、Esc 只收面板 */
  function onDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape' && menuOpen) {
      e.preventDefault()
      setMenuOpen(false)
      return
    }
    // 内嵌引用原子:光标顶在文字最前头时再敲退格,删掉最后挂上的那颗
    if (e.key === 'Backspace' && draftRefs.length > 0) {
      const el = e.currentTarget
      if (el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault()
        onRemoveRef?.(draftRefs.length - 1)
        return
      }
    }
    if (slashOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setSlashIndex((slashActive + dir + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickSlash(slashMatches[slashActive].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    sendDraft()
  }

  /**
   * 输入框右键编辑菜单:Electron 没有原生编辑菜单,按预览选区同款规格自己摆一张。
   * 选中态在开菜单前定格(右键落点即光标位);粘贴先探剪贴板,空的就把行摆灰。
   */
  function onDraftContextMenu(e: React.MouseEvent<HTMLTextAreaElement>): void {
    e.preventDefault()
    const el = e.currentTarget
    const doc = el.ownerDocument
    const start = el.selectionStart
    const end = el.selectionEnd
    const picked = draft.slice(start, end)
    const x = e.clientX
    const y = e.clientY
    /** 在右键落点插字/删字:受控组件走 setDraft,光标摁到插完的位置接着写 */
    const splice = (inserted: string): void => {
      const next = draft.slice(0, start) + inserted + draft.slice(end)
      setDraft(next)
      el.focus()
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + inserted.length
      })
    }
    const buildItems = (clip: string): ContextMenuItem[] => [
      {
        label: '复制',
        disabled: !picked,
        run: () =>
          navigator.clipboard
            .writeText(picked)
            .then(() => {
              el.focus()
              return '已复制 ✓'
            })
            .catch(() => '没复制成,剪贴板被顶住了')
      },
      { label: '粘贴', disabled: clip === '', run: () => splice(clip) }
    ]
    const open = (clip: string): void =>
      openContextMenu({ x, y, doc, compact: true, preferRight: true, items: buildItems(clip) })
    void navigator.clipboard
      .readText()
      .then(open)
      .catch(() => open(''))
  }

  // 弹性长高的账(小葵点名):空 = 一行;有一到四行长到几行;五行封顶,
  // 拨杆拨上去多给五行(共十行),超出的舱内自己滚;文字退回五行内拨杆自动归位。
  // 防抖(小葵报的病):文字卡在换行临界点时,打一个字涨两行、删一个字缩一行,舱来回蹦。
  // 治法是「涨快缩慢」:涨按实际行数,缩要富余 —— 量行宽时右侧多留一截,
  // 文字连这一截都省出来才准缩回一行。另外单行/多行两种布局的行宽不一样
  // (单行舱文字让着按钮排,多行舱铺满),量行数时给多行舱补上按钮排的地盘,
  // 两种布局按同一个尺度量,免得「多行里量着放得下、缩回单行立刻又放不下」来回打架。
  const BAR_RESERVE = '13rem' // 单行舱右侧按钮排的地盘(俩图标胶囊+发送钮,忙时还有「停一停」,往宽了备)
  const COLLAPSE_SLACK = '4rem' // 缩回一行的富余:比按钮排还宽出这么多才缩
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = Number.parseFloat(cs.lineHeight) || 24
    // border-box 账:style.height 写的是含内边距的总高 —— 漏加 padding 的话
    // 文字盒被 padding 吃掉一截,overflow:hidden 上下裁字(UI 放得越大裁得越狠)
    const padY = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom)
    const multi = lineCount >= 2
    el.style.height = 'auto'
    // 统一量尺:多行舱里临时把右侧按按钮排地盘收窄,量出来的行数和单行舱一个尺度
    el.style.paddingRight = multi ? BAR_RESERVE : ''
    const realLines = Math.max(1, Math.round(el.scrollHeight / line))
    // 收缩判定:在统一量尺上再加一截富余,连富余都省出来还是一行,才真缩
    el.style.paddingRight = multi ? `calc(${BAR_RESERVE} + ${COLLAPSE_SLACK})` : COLLAPSE_SLACK
    const slackLines = Math.max(1, Math.round(el.scrollHeight / line))
    el.style.paddingRight = ''
    const shown = realLines >= 2 ? realLines : slackLines >= 2 ? 2 : 1
    // 十行锁死(小葵点名):展开就是十行高,内容超了右侧滚条翻看,舱绝不跟着内容再长
    el.style.height = `${
      (expanded ? INPUT_EXPAND_LINES * line : Math.min(shown * line, INPUT_CAP_LINES * line)) + padY
    }px`
    setLineCount(shown)
    if (expanded && realLines < INPUT_CAP_LINES) setExpanded(false)
  }, [draft, expanded, lineCount])
  const capped = lineCount >= INPUT_CAP_LINES || expanded

  return (
    <form
      ref={formRef}
      className={`chat-input${lineCount >= 2 ? ' is-multiline' : ''}${capped ? ' is-capped' : ''}`}
      onSubmit={submit}
    >
      {/* 斜杠命令补全:打 / 浮在输入舱上方,上下键挑、回车/Tab 选定、Esc 收掉、鼠标点也算数 */}
      {slashOpen && (
        <div className="slash-palette" id="slash-palette" role="listbox" aria-label="斜杠命令">
          {slashMatches.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              id={`slash-opt-${c.name.slice(1)}`}
              aria-selected={i === slashActive}
              className={`slash-item${i === slashActive ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => pickSlash(c.name)}
            >
              <span className="slash-name">{c.name}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      {/* 「+」能力菜单:思考/翻文件/联网三个开关,iOS 拨钮式;点舱外或 Esc 收 */}
      {menuOpen && (
        <div className="fc-menu" role="menu" aria-label="能力开关">
          <button
            type="button"
            className={`fc-mrow${chat.thinking ? ' is-on' : ''}`}
            onClick={() => chat.setThinking(!chat.thinking)}
            aria-pressed={chat.thinking}
          >
            <span className="fc-mi">
              <TreeIcon name="brain" size={14} mono />
            </span>
            思考模式
            <span className="fc-sw" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`fc-mrow${chat.agent ? ' is-on' : ''}`}
            onClick={() => chat.setAgent(!chat.agent)}
            aria-pressed={chat.agent}
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
            onClick={toggleWeb}
            aria-pressed={webOn}
          >
            <span className="fc-mi">
              <TreeIcon name="globe" size={14} mono />
            </span>
            联网查询
            <span className="fc-sw" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="fc-line">
        <button
          type="button"
          className={`fc-plus${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="能力开关"
          aria-expanded={menuOpen}
          data-tip="思考 / 翻文件开关"
        >
          <TreeIcon name="plus" size={CHAT_ACTION_ICON_SIZE} mono />
        </button>
        <div className="fc-field">
          {/* 内嵌引用原子(小葵拍板,Devin 式):图标+底色躺在文字流里,光标顶头退格删最后一颗 */}
          {draftRefs.map((r, i) => (
            <span
              key={`${r.relPath}-${r.startLine}-${r.endLine}-${i}`}
              className="fc-ref"
              data-tip={`${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}
            >
              <svg
                className="fc-ref-ic"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
                <path d="m10 8-3 3 3 3" />
                <path d="m14 14 3-3-3-3" />
              </svg>
              <span className="fc-ref-text mono">
                {r.relPath.split('/').pop()}:{r.startLine}-{r.endLine}
              </span>
              <button
                type="button"
                className="fc-ref-x"
                onClick={() => onRemoveRef?.(i)}
                aria-label={`移除引用 ${r.relPath} 第 ${r.startLine}-${r.endLine} 行`}
                data-tip="移除这段引用"
              >
                ✕
              </button>
            </span>
          ))}
          <textarea
            ref={inputRef}
            value={draft}
            // 引用原子一上桌,舱里就有东西了 —— 占位字该让位,别跟原子抢排面
            placeholder={
              refs.length > 0
                ? ''
                : chat.busy
                  ? '正在回答上一个问题……'
                  : '问项目的事,或者随便聊聊……'
            }
            aria-label="输入自由对话"
            aria-expanded={slashOpen}
            aria-controls="slash-palette"
            aria-activedescendant={
              slashOpen ? `slash-opt-${slashMatches[slashActive].name.slice(1)}` : undefined
            }
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value)
              // 内容一变,补全重新能冒头(Esc 的「先别出」只管当下这句)
              setSlashDismissed(false)
              setSlashIndex(0)
            }}
            onKeyDown={onDraftKeyDown}
            onContextMenu={onDraftContextMenu}
            // 点输入区 = 要打字了,「+」菜单顺手收摊(点在舱内的外点判定管不到这层)
            onFocus={() => setMenuOpen(false)}
          />
        </div>
        {chat.busy ? (
          <button
            type="button"
            className="fc-send is-stop"
            onClick={chat.cancel}
            aria-label="停一停"
            data-tip="停一停"
          >
            <span className="fc-sq" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="fc-send" aria-label="发送" data-tip="发送">
            <TreeIcon name="arrowUp" size={CHAT_ACTION_ICON_SIZE} strokeWidth={4} mono />
          </button>
        )}
      </div>
      {capped && (
        <button
          type="button"
          className="composer-expand"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? '收合输入框' : '展开输入框'}
          data-tip={expanded ? '收合' : '多撑五行'}
        >
          <TreeIcon name={expanded ? 'collapse' : 'expand'} size={INPUT_TOGGLE_ICON_SIZE} />
        </button>
      )}
    </form>
  )
}
