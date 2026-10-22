import { useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatCodeRef } from '@shared/types'
import { COMPACT_COMMAND, isCompactCommand } from '@shared/compact'
import { TreeIcon } from './Icons'
import { openTextEditMenu } from './textEditMenu'
import { REF_ONLY_QUESTION, type AiChatApi } from '../useAiChat'
import { partitionAttachFiles, type ChatFilesApi } from '../useChatFiles'
import type { ChatImagesApi } from '../useChatImages'
import { AiSetupContext } from '../aiSetupContext'
import { CHAT_ACTION_ICON_SIZE, INPUT_TOGGLE_ICON_SIZE } from '../inputMetrics'
import { ComposerAtoms } from './ComposerAtoms'
import { CapabilityMenu, SlashPalette } from './ComposerOverlays'
import { useComposerAutosize } from '../useComposerAutosize'
import { useWebLookupToggle } from '../useWebLookupToggle'

/**
 * 一体化输入舱(对话页改版定稿):一行胶囊 = 「+」能力菜单 | 内嵌引用原子+文字 | 发送/停一停;
 * 写到两行起往上长,控件自然落到第二行;满五行封顶出拨杆,拨上去多撑五行。
 * 空场时整颗舱挂在 hero 居中,聊开了沉到底栏 —— 同一颗舱两处坐席。
 * 拆分登记:待发原子 → ComposerAtoms;两块浮层 → ComposerOverlays;
 * 弹性长高 → useComposerAutosize;联网开关 → useWebLookupToggle。
 */

/** 斜杠命令清单(输入框打 / 浮出的补全卡):命令名 + 一句话说明;新命令往这儿加一行就成 */
const SLASH_COMMANDS: Array<{ name: string; desc: string }> = [
  { name: COMPACT_COMMAND, desc: '把前面聊过的压成摘要，省出上下文' }
]

export function FreeChatComposer({
  chat,
  refs,
  onRemoveRef,
  chatImages,
  chatFiles,
  onWillSend
}: {
  chat: AiChatApi
  /** 已引用的代码段:预览模式下由左栏选中攒出来 */
  refs: ChatCodeRef[]
  onRemoveRef?: (index: number) => void
  /** 待发图片状态:选文件/粘贴/拖入都汇进它,能力闸也在它手里 */
  chatImages: ChatImagesApi
  /** 待发文件状态(对齐 Claude Code 的 @文件):选文件/拖入都汇进它 */
  chatFiles: ChatFilesApi
  /** 发送/压缩前先回底:自己的话自己得看见,发出去这一眼不被上翻状态挡住 */
  onWillSend: () => void
}): React.JSX.Element {
  const setup = useContext(AiSetupContext)
  const draftRefs = refs
  const [draft, setDraft] = useState('')
  // 高度拨杆(产品指定):到五行才亮,拨上去多撑五行空白,拨回来;文字退回五行内自动归位
  const [expanded, setExpanded] = useState(false)
  // 「+」能力菜单:思考/翻文件两个开关收进这颗钮里;点舱外任何地方关闭
  const [menuOpen, setMenuOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  // 「添加附件」的隐藏文件筐(图片/文件共用一个口):菜单点了它弹系统选择框,挑完按类分流
  const attachInputRef = useRef<HTMLInputElement>(null)
  const { inputRef, lineCount, capped } = useComposerAutosize(draft, expanded, setExpanded)
  const { webOn, toggleWeb } = useWebLookupToggle()

  useEffect(() => {
    if (!menuOpen) return
    const doc = formRef.current?.ownerDocument ?? document
    function onPointerDown(e: MouseEvent): void {
      if (!formRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    doc.addEventListener('mousedown', onPointerDown)
    return () => doc.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

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
    // /compact 手动压缩命令:不当问题发,拦下来直接压缩;忙着回答时不接,跟发消息一个规矩
    if (isCompactCommand(q)) {
      if (chat.busy) return
      onWillSend()
      chat.compact()
      setDraft('')
      if (expanded) setExpanded(false)
      return
    }
    // 挂了引用就允许空着发,带图/带文件也一样(图和文件本身就是题目,主进程给兜底问法)
    const pendingImages = chatImages.images
    const pendingFiles = chatFiles.files
    const text = q || (draftRefs.length > 0 ? REF_ONLY_QUESTION : '')
    if ((!text && pendingImages.length === 0 && pendingFiles.length === 0) || chat.busy) return
    onWillSend()
    chat.send(text, draftRefs, pendingImages, pendingFiles)
    // 图片发送后清账(数据大、一次性);文件常驻输入框(像引用原子一样,多轮都带上,要换点 ×)
    if (pendingImages.length > 0) chatImages.clear()
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

  /** 回车发送,Shift+回车换行;输入法选词的那下回车不是发送;
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

  /** 输入框右键编辑菜单(复制/粘贴)走共用实现,和 workspace 路径栏同一套 */
  function onDraftContextMenu(e: React.MouseEvent<HTMLTextAreaElement>): void {
    openTextEditMenu({ event: e, value: draft, setValue: setDraft })
  }

  return (
    <form
      ref={formRef}
      className={`chat-input${lineCount >= 2 ? ' is-multiline' : ''}${capped ? ' is-capped' : ''}`}
      onSubmit={submit}
    >
      {/* 斜杠命令补全:打 / 浮在输入舱上方,上下键挑、回车/Tab 选定、Esc 收掉、鼠标点也算数 */}
      {slashOpen && (
        <SlashPalette
          matches={slashMatches}
          active={slashActive}
          onHover={setSlashIndex}
          onPick={pickSlash}
        />
      )}
      {/* 「+」能力菜单:思考/翻文件/联网三个开关 + 添加附件,点舱外或 Esc 收 */}
      {menuOpen && (
        <CapabilityMenu
          thinking={chat.thinking}
          agent={chat.agent}
          webOn={webOn}
          onToggleThinking={(on) => chat.setThinking(on)}
          onToggleAgent={(on) => chat.setAgent(on)}
          onToggleWeb={toggleWeb}
          onPickAttach={() => {
            setMenuOpen(false)
            attachInputRef.current?.click()
          }}
        />
      )}
      <div className="fc-line">
        <button
          type="button"
          className={`fc-plus${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="能力开关"
          aria-expanded={menuOpen}
          data-tip="能力开关"
        >
          <TreeIcon name="plus" size={CHAT_ACTION_ICON_SIZE} mono />
        </button>
        <div className="fc-field">
          {/* 隐藏文件筐:「添加附件」点它弹系统选择框;挑到的按类分流(图片进图片链,其余进文件链) */}
          <input
            ref={attachInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              if (picked.length === 0) return
              const parts = partitionAttachFiles(picked)
              if (parts.images.length > 0) void chatImages.addFiles(parts.images)
              if (parts.files.length > 0) void chatFiles.addFiles(parts.files)
            }}
          />
          <ComposerAtoms
            chatFiles={chatFiles}
            chatImages={chatImages}
            refs={draftRefs}
            onRemoveRef={onRemoveRef}
          />
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
            // 粘贴剪贴板文件(图片走图片链;复制的文本文件走文件链):纯文本粘贴照旧走默认行为
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length === 0) return
              e.preventDefault()
              const parts = partitionAttachFiles(files)
              if (parts.images.length > 0) void chatImages.addFiles(parts.images)
              if (parts.files.length > 0) void chatFiles.addFiles(parts.files)
            }}
            // 点输入区 = 要打字了,「+」菜单顺手关闭
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
