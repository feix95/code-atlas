import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ChatCodeRef, ScanFileNode } from '@shared/types'
import { Notice } from './Notice'
import { ImagePreview } from './ImagePreview'
import { AudioPreview } from './AudioPreview'
import { ProgressDots } from './ProgressDots'
import { TreeIcon } from './Icons'
import { MiniMD } from './MiniMD'
import { InlineTitle } from './InlineTitle'
import { LinkedMdView } from './LinkedMdView'
import { LinkedPlainView } from './LinkedPlainView'
import { splitTranslateBlocks } from '@shared/translateBlocks'
import { usesPlainTranslateView } from '@shared/translateGate'
import {
  hoveredBlockOf,
  isMdLinked,
  mdFileKey,
  setHoveredBlock,
  subscribeMdHover
} from '../mdHoverLink'
import { registerMdScroll } from '../mdScrollSync'
import { openContextMenu } from './contextMenuStore'
import { SourceEditor } from './SourceEditor'
import type { FileLinkTarget } from '@shared/fileLinks'
import { applyViewFlags, getViewFlagsBits, subscribeViewFlags, viewFlags } from '../viewState'
import { fileBaseName, type RenameOutcome } from '@shared/fileRename'
import { getCodeWrapOn, subscribeCodeWrap, toggleCodeWrap } from '../codePrefs'
import { bindDocZoomWheel, useDocZoom } from '../docZoom'
import { usePreviewDoc } from '../usePreviewDoc'

/** 头部折行/模式开关图标(19.2px = 1.2rem) */
const WRAP_ICON_SIZE = 19.2
/**
 * 折行模式的行数闸(老规矩留档):虚拟滚动时代折行要全量上 DOM 才有的闸,
 * 编辑器自己就是虚拟渲染,闸现在只当「巨型文件默认不折行」的保守策略。
 */
const WRAP_MAX_LINES = 5000

// 渲染域隔离:预览签被拖进子窗后,选区/事件都活在子窗 document 里 ——
// 一律经元素的 ownerDocument 这族取,别摸全局 window(那是主窗的,子窗里选不中、监不到)
function viewOf(el: HTMLElement | null): Window | null {
  return el?.ownerDocument.defaultView ?? null
}

/**
 * 代码预览/编辑:树上右键「预览文件」后,左栏装这扇文本窗。
 * 源码档 = CodeMirror 6 编辑器:所有文本文件打开就能改,停手 1 秒自动落盘;
 * 行号/撤销/选区/搜索键位全是编辑器自带的。分色仍吃主进程 tree-sitter 的段落账,
 * 存盘后重算换新;选区引用(右键菜单/直拖)照老规矩,角标美术随新引擎退役。
 * 阅读档(md 系)还是 MiniMD 渲染稿;切档时编辑器把最新文稿经 onTextChange 留在父层。
 * 不可预览的情况(二进制/超大/读不了)老实说明白,绝不硬塞一屏乱码。
 */
export function CodePreview({
  rootPath,
  file,
  canAddRef,
  refLimit,
  onAddRef,
  jump,
  fileLinks,
  onRenameFile
}: {
  rootPath: string
  file: ScanFileNode
  /** 引用额度还没用满(满了菜单就说清楚,不装作没反应) */
  canAddRef: boolean
  /** 一轮最多引几段(跟主进程同一个数) */
  refLimit: number
  onAddRef: (ref: ChatCodeRef) => void
  /** 跳到第几行(聊天里的文件链接点的):正文载入后滚过去,行号越界夹到文件边缘;seq 变了再跳一次 */
  jump?: { line: number; seq: number } | null
  /** 阅读模式里的文件链接通道:工作区签传它,md 里对得上登记的文件名渲染成可点链接 */
  fileLinks?: FileLinkTarget | null
  /** 内联标题改名通道:递新主名进回调,拿 RenameOutcome 回执;
      不传 = 标题只展示(live/阅读两档共用) */
  onRenameFile?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  const codeViewRef = useRef<HTMLDivElement>(null)
  // 按文件记账(读稿/编辑稿/提示/改名回执)全在 usePreviewDoc
  const {
    result,
    err,
    diskText,
    colors,
    text,
    total,
    copiedAll,
    renameErr,
    onTextChange,
    requestRename,
    copyAll
  } = usePreviewDoc({ rootPath, relPath: file.relPath, onRenameFile })
  /**
   * 折行开关(全局默认开):一个开关管所有文件,存 localStorage 重启不失忆;
   * 超行数闸的文件摁不动(巨型文件默认不折行的保守策略)。
   */
  // 折行账读全局可订阅小状态表(页签右键菜单也能拨这颗开关,不止本件的 Alt+Z)
  const wrapOn = useSyncExternalStore(subscribeCodeWrap, getCodeWrapOn)
  const wrapAllowed = total > 0 && total <= WRAP_MAX_LINES
  const wrap = wrapAllowed && wrapOn
  // 预览显示开关(排版显示 × 只读)是全局一档:账在 codePrefs,拨一下所有签就地翻面 ——
  // 订阅只为触发重渲,读数照旧走 viewFlags 换算口
  useSyncExternalStore(subscribeViewFlags, getViewFlagsBits)
  const flags = viewFlags(file.relPath)
  const canMd = flags.canRender
  // md 渲染态两个分支:reading=排版+只读(MiniMD 上妆全文),live=排版+可编辑(编辑器里上妆/卸妆);
  // 排版关或非 md 都是裸源码编辑器(只读照常生效)
  const reading = canMd && flags.render && flags.readOnly
  const live = canMd && flags.render && !flags.readOnly
  // 对照联动:开着翻译镜像时切成同号块视图。md 仍要阅读档;文档族没有阅读档,有镜像就切。
  const mdKey = mdFileKey(rootPath, file.relPath)
  const linkedMd = useSyncExternalStore(subscribeMdHover, () => isMdLinked(mdKey))
  const linkedHovered = useSyncExternalStore(subscribeMdHover, () => hoveredBlockOf(mdKey))
  const linkedPlain = linkedMd && usesPlainTranslateView(file.relPath)
  const showLinked = linkedMd && (reading || linkedPlain)
  const sourceBlocks = useMemo(
    () => (showLinked ? splitTranslateBlocks(text, file.relPath) : []),
    [showLinked, text, file.relPath]
  )
  // 滚动联动:原文栏在滚时,译文栏按同一块号跟到同一高度(只认滚动,不认单纯移鼠标)
  useEffect(() => {
    const el = codeViewRef.current
    if (!showLinked || sourceBlocks.length === 0 || el === null) return
    return registerMdScroll(mdKey, 'source', el)
  }, [showLinked, sourceBlocks.length, mdKey])
  // 文档字号缩放:系数落 --doc-zoom,正文各行 font-size 乘它
  const docZoom = useDocZoom()

  // Ctrl+滚轮 = 文档字号缩放:监听器挂预览元素本身,子窗 realm-safe;编辑器滚轮照冒泡上来。
  useEffect(() => {
    const view = codeViewRef.current
    if (!view) return
    return bindDocZoomWheel(view)
  }, [result, reading, linkedPlain])

  /** 折行开关的大文件闸门:行数超闸的文件摁不动(全局状态唯一写口在 codePrefs,
      页签右键菜单那条路不设闸 —— 菜单拨的是「想要不要」,给不给闸说了算) */
  const toggleWrap = useCallback((): void => {
    if (!wrapAllowed) return
    toggleCodeWrap()
  }, [wrapAllowed])

  function onPaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return
    // Alt+Z 切自动换行(VS Code 同款键位):编辑器内有它自己的键位账,这里是栏外/阅读档的口
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      toggleWrap()
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
    e.preventDefault()
    copyAll(text)
  }

  /** 阅读模式的右键:渲染态里没有行号账,选中了就给「复制选中段」一口 */
  function onReadContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    const el = codeViewRef.current
    const s = viewOf(el)?.getSelection()
    if (!el || !s || s.isCollapsed || s.rangeCount === 0 || !el.contains(s.anchorNode)) return
    const picked = s.toString()
    if (picked.trim() === '') return
    e.preventDefault()
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      doc: el.ownerDocument,
      items: [
        {
          label: '复制选中段',
          icon: 'copy',
          run: () =>
            navigator.clipboard
              .writeText(picked)
              .then(() => '已复制 ✓')
              .catch(() => '没复制成,剪贴板被顶住了')
        }
      ]
    })
  }

  /**
   * 只读锁单钮(所有文件通用):图标亮「当前状态」—— 锁着是合上的锁,可编辑是开着的锁;
   * 提示语说全「现在…,点击后…」。排版显示等其他选项收进页签右键菜单的开关,页头不堆兄弟。
   */
  const lockTip = flags.readOnly ? '现在已锁定为只读,点击解除锁定' : '现在可以编辑,点击锁定为只读'
  const lockBtn: React.JSX.Element = (
    <button
      type="button"
      className="code-mode-btn"
      aria-label={lockTip}
      aria-pressed={flags.readOnly}
      data-tip={lockTip}
      onClick={() => applyViewFlags({ readOnly: !flags.readOnly })}
    >
      <TreeIcon name={flags.readOnly ? 'lock' : 'lockOpen'} size={WRAP_ICON_SIZE} mono />
    </button>
  )

  return (
    <div className="code-pane soft-in" onKeyDown={onPaneKeyDown}>
      {/* 页头栏:文件读成了才立,右对齐一颗只读锁钮;文件名不摆 ——
          签条上已有名字。阅读档的内联标题是文档正文的title,跟页头 chrome 不冲突。
          折行钮退役进页签右键菜单(渐进披露),快捷键 Alt+Z 和全局偏好照旧 */}
      {result?.status === 'ok' && <div className="code-pane-head">{lockBtn}</div>}
      {err && <Notice kind="error">{err}</Notice>}
      {!err && !result && (
        <div className="card-waiting">
          <ProgressDots />
          正在读文件……
        </div>
      )}
      {!err &&
        result &&
        result.status !== 'ok' &&
        result.status !== 'image' &&
        result.status !== 'audio' && <p className="code-pane-note">{result.reason}</p>}
      {/* 图片签:JPG/PNG 验过魔数直接看图,代码那套锁/引用/折行一概不出场;
          image 账没带回来(不该发生)就老实按 reason 说明 */}
      {!err && result?.status === 'image' && (
        <>
          {renameErr && <p className="code-pane-note is-warn">{renameErr}</p>}
          {result.image ? (
            <ImagePreview
              key={file.relPath}
              fileName={file.relPath.split(/[\\/]/).pop() ?? file.relPath}
              image={result.image}
              onRename={onRenameFile ? requestRename : undefined}
            />
          ) : (
            <p className="code-pane-note">{result.reason || '这张图片的信息没带回来,预览不了'}</p>
          )}
        </>
      )}
      {!err && result?.status === 'audio' && (
        <>
          {renameErr && <p className="code-pane-note is-warn">{renameErr}</p>}
          {result.audio ? (
            <AudioPreview
              key={file.relPath}
              rootPath={rootPath}
              relPath={file.relPath}
              fileName={file.relPath.split(/[\\/]/).pop() ?? file.relPath}
              audio={result.audio}
              onRename={onRenameFile ? requestRename : undefined}
            />
          ) : (
            <p className="code-pane-note">{result.reason || '这支音频的信息没带回来,预览不了'}</p>
          )}
        </>
      )}
      {!err && result?.status === 'ok' && (
        <>
          {copiedAll && <p className="code-pane-note">全文已复制到剪贴板</p>}
          {renameErr && <p className="code-pane-note is-warn">{renameErr}</p>}
          {reading ? (
            /* 阅读档:md 系签的渲染态 —— MiniMD 排版进可读栏,吃编辑器留下的最新文稿 */
            <div
              className="code-view is-reading"
              ref={codeViewRef}
              tabIndex={0}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
              aria-label={`${file.relPath} 的阅读模式,全文可滚;按 Ctrl+A 复制全文`}
              onContextMenu={onReadContextMenu}
            >
              <article className="code-reading">
                {/* 内联标题(Obsidian 同款):文件名掐尾去扩展名,摆正文顶上;
                    接了改名通道就能点进去改(live/阅读同一条) */}
                {sourceBlocks.length > 0 ? (
                  <>
                    <InlineTitle
                      title={fileBaseName(file.relPath.split(/[\\/]/).pop() ?? '')}
                      onRename={onRenameFile ? requestRename : undefined}
                    />
                    <LinkedMdView
                      blocks={sourceBlocks}
                      texts={sourceBlocks.map((b) => b.text)}
                      hovered={linkedHovered}
                      onHover={(block) => setHoveredBlock(mdKey, block)}
                      fileLinks={fileLinks ?? undefined}
                    />
                  </>
                ) : (
                  <MiniMD
                    text={text}
                    fileLinks={fileLinks ?? undefined}
                    title={fileBaseName(file.relPath.split(/[\\/]/).pop() ?? '')}
                    onRenameTitle={onRenameFile ? requestRename : undefined}
                  />
                )}
              </article>
            </div>
          ) : linkedPlain && sourceBlocks.length > 0 ? (
            /* 文档族对照:没有阅读档,有镜像时原文切到与译文同号的纯文本块视图 */
            <div
              className="code-view is-reading"
              ref={codeViewRef}
              tabIndex={0}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
              aria-label={`${file.relPath} 的对照阅读,全文可滚;按 Ctrl+A 复制全文`}
              onContextMenu={onReadContextMenu}
            >
              <article className="code-reading">
                <InlineTitle
                  title={fileBaseName(file.relPath.split(/[\\/]/).pop() ?? '')}
                  onRename={onRenameFile ? requestRename : undefined}
                />
                <LinkedPlainView
                  blocks={sourceBlocks}
                  texts={sourceBlocks.map((b) => b.text)}
                  hovered={linkedHovered}
                  onHover={(block) => setHoveredBlock(mdKey, block)}
                />
              </article>
            </div>
          ) : (
            /* 实时预览/源码档:同一台 CodeMirror 编辑器,live 档位多挂 markdown 语法树+上妆管线;
               key 带档位 —— 切档重立编辑器,老编辑器的收尾写盘先把最新稿保下来 */
            <div
              className={`code-view is-editing${live ? ' is-live' : ''}`}
              ref={codeViewRef}
              style={{ '--doc-zoom': docZoom } as React.CSSProperties}
            >
              <SourceEditor
                key={`${file.relPath}:${live ? 'live' : 'source'}:${flags.readOnly ? 'ro' : 'rw'}`}
                rootPath={rootPath}
                live={live}
                readOnly={flags.readOnly}
                relPath={file.relPath}
                initialText={text}
                /* 文稿和盘上对得上才给初始色:对不上是带着未存改动,旧色错位不如不给 */
                initialColors={text === diskText ? colors : undefined}
                wrap={wrap}
                canAddRef={canAddRef}
                refLimit={refLimit}
                onAddRef={onAddRef}
                onTextChange={onTextChange}
                onToggleWrap={toggleWrap}
                onRenameFile={onRenameFile ? requestRename : undefined}
                jump={jump}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
