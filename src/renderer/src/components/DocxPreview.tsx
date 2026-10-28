import { useMemo, useRef } from 'react'
import type { FilePreviewDocx } from '@shared/types'
import { fileBaseName, type RenameOutcome } from '@shared/fileRename'
import { docxLinkAction, sanitizeDocxHtml } from '../docxSanitize'
import { useDocxConversion, type DocxView } from '../useDocxConversion'
import { InlineTitle } from './InlineTitle'
import { ProgressDots } from './ProgressDots'
import { ReadingShell } from './ReadingShell'

function convertingText(images: number): string {
  return images > 0 ? `正在转换文档,已处理 ${images} 张图片` : '正在转换文档'
}

/** 还没转好 / 转不了时正文位置的那一行 */
function DocxStatus({ view }: { view: Exclude<DocxView, { phase: 'ready' }> }): React.JSX.Element {
  if (view.phase === 'failed') return <p className="code-pane-note is-warn">{view.reason}</p>
  return (
    <p className="code-pane-note docx-loading" role="status">
      <ProgressDots />
      {convertingText(view.images)}
    </p>
  )
}

/**
 * Word 预览:.docx 文件签的正文,只读。
 * 转换在主进程的后台线程里跑(useDocxConversion),转的时候显示进度行,界面照常可操作;
 * 转好的网页先过 docxSanitize 消毒,再套阅读档排版(.code-reading .md),图片滚到附近才加载;
 * 字体/颜色/分页/页眉页脚不还原 —— 这里看的是「写了什么」,不是「Word 长什么样」。
 * 链接一律拦下:文内锚点就地滚动,http(s)/mailto 经主窗 window.open 总闸交系统浏览器,
 * 其余什么都不做,应用自己绝不跳走。
 */
export function DocxPreview({
  rootPath,
  relPath,
  fileName,
  docx,
  viewRef,
  docZoom,
  onContextMenu,
  onRename
}: {
  rootPath: string
  relPath: string
  fileName: string
  docx: FilePreviewDocx
  /** 可滚动的正文容器:父层拿它挂 Ctrl+滚轮缩放与右键「复制选中段」 */
  viewRef: React.RefObject<HTMLDivElement | null>
  docZoom: number
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
  onRename?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const view = useDocxConversion(rootPath, relPath, docx)
  const rawHtml = view.phase === 'ready' ? view.html : null
  const html = useMemo(() => (rawHtml === null ? null : sanitizeDocxHtml(rawHtml)), [rawHtml])

  function onBodyClick(e: React.MouseEvent<HTMLDivElement>): void {
    const link = (e.target as Element).closest('a')
    const body = bodyRef.current
    if (!link || !body?.contains(link)) return
    e.preventDefault()
    const action = docxLinkAction(link.getAttribute('href'))
    if (action.kind === 'anchor') {
      body.querySelector(`[id="${CSS.escape(action.id)}"]`)?.scrollIntoView({ block: 'start' })
    } else if (action.kind === 'external') {
      // 故意用主窗的 window:子窗没装 window.open 总闸,从那开会弹出应用内新窗
      window.open(action.url, '_blank')
    }
  }

  /** Ctrl+A 只选文档正文(不让外层的「复制全文」接走 —— Word 签没有文本稿可复制) */
  function onBodyKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
    const body = bodyRef.current
    const selection = body?.ownerDocument.getSelection()
    if (!body || !selection) return
    e.preventDefault()
    e.stopPropagation()
    selection.selectAllChildren(body)
  }

  return (
    <ReadingShell
      viewRef={viewRef}
      docZoom={docZoom}
      label={`${fileName} 的 Word 预览,可滚动阅读全文`}
      outlineKey={html ?? undefined}
      onContextMenu={onContextMenu}
      onKeyDown={onBodyKeyDown}
    >
      <InlineTitle title={fileBaseName(fileName)} onRename={onRename} />
      {view.phase !== 'ready' ? (
        <DocxStatus view={view} />
      ) : (
        <>
          {view.warnings > 0 && (
            <p className="code-pane-note">
              {view.warnings} 处格式无法还原(如特殊样式或域代码),已按普通文本显示
            </p>
          )}
          {html === null ? (
            <p className="code-pane-note is-warn">文档无法安全显示,已停止预览</p>
          ) : html.trim() === '' ? (
            <p className="code-pane-note">文档中没有可显示的文字或图片</p>
          ) : (
            <div
              className="md docx-body"
              ref={bodyRef}
              onClick={onBodyClick}
              onAuxClick={onBodyClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </>
      )}
    </ReadingShell>
  )
}
