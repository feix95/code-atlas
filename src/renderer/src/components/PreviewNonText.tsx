import type { FilePreviewResult } from '@shared/types'
import type { RenameOutcome } from '@shared/fileRename'
import { ImagePreview } from './ImagePreview'
import { AudioPreview } from './AudioPreview'
import { DocxPreview } from './DocxPreview'

type MediaStatus = 'image' | 'audio' | 'docx'

/** 专属预览的账没带回来(不该发生)时,老实按 reason 说明的兜底话 */
const MISSING_PAYLOAD: Record<MediaStatus, string> = {
  image: '这张图片的信息没带回来,预览不了',
  audio: '这支音频的信息没带回来,预览不了',
  docx: '未获取到文档内容,无法预览'
}

function isMediaStatus(status: FilePreviewResult['status']): status is MediaStatus {
  return Object.hasOwn(MISSING_PAYLOAD, status)
}

interface NonTextProps {
  rootPath: string
  relPath: string
  result: FilePreviewResult
  renameErr: string | null
  /** 可滚动的正文容器:Word 签把它挂到自己的阅读栏上,父层的缩放/右键照常生效 */
  viewRef: React.RefObject<HTMLDivElement | null>
  docZoom: number
  onReadContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
  onRename?: (base: string) => Promise<RenameOutcome>
  /** 页签 id 与当前停靠位:Word 签的大纲浮窗靠它们决定让不让位给左栏 */
  outlineOwner?: string
  outlineDockOwner?: string | null
}

function mediaBody(props: NonTextProps, fileName: string): React.JSX.Element | null {
  const { result, relPath, onRename } = props
  if (result.status === 'image' && result.image) {
    return (
      <ImagePreview key={relPath} fileName={fileName} image={result.image} onRename={onRename} />
    )
  }
  if (result.status === 'audio' && result.audio) {
    return (
      <AudioPreview
        key={relPath}
        rootPath={props.rootPath}
        relPath={relPath}
        fileName={fileName}
        audio={result.audio}
        onRename={onRename}
      />
    )
  }
  if (result.status === 'docx' && result.docx) {
    return (
      <DocxPreview
        key={relPath}
        rootPath={props.rootPath}
        relPath={relPath}
        fileName={fileName}
        docx={result.docx}
        viewRef={props.viewRef}
        docZoom={props.docZoom}
        onContextMenu={props.onReadContextMenu}
        onRename={onRename}
        outlineOwner={props.outlineOwner}
        outlineDockOwner={props.outlineDockOwner}
      />
    )
  }
  return null
}

/**
 * 不是文本稿的预览正文:图片看图、音频听音、Word 读稿(都验过身才到这儿),
 * 代码那套锁/引用/折行一概不出场;二进制/超大这类只给一句 reason。
 */
export function PreviewNonText(props: NonTextProps): React.JSX.Element {
  const { result, renameErr } = props
  if (!isMediaStatus(result.status)) return <p className="code-pane-note">{result.reason}</p>
  const fileName = props.relPath.split(/[\\/]/).pop() ?? props.relPath
  return (
    <>
      {renameErr && <p className="code-pane-note is-warn">{renameErr}</p>}
      {mediaBody(props, fileName) ?? (
        <p className="code-pane-note">{result.reason || MISSING_PAYLOAD[result.status]}</p>
      )}
    </>
  )
}
