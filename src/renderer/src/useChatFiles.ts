import { useEffect, useRef, useState } from 'react'
import {
  CHAT_FILE_CHARS_MAX,
  CHAT_FILES_MAX,
  clipTextToLines,
  type ChatFileAttachment
} from '@shared/chatFiles'
import { isBinaryFile, isImageFile } from '@shared/fileKinds'
import { clipPreview, looksBinary, PREVIEW_MAX_BYTES } from '@shared/preview'
import { formatSize } from '@shared/fsMessages'

/**
 * 待发文件的小状态表(对齐 Claude Code 的 @文件):三个入口
 * (「+」菜单「添加附件」选文件、从系统拖文件进来、从文件树拖文件进来)都汇到 addFiles ——
 * 同一份校验口径:只收文本文件(后缀名单先挡纯二进制,开头字节有 NUL 再挡一道)、
 * 单份不超 10MB、最多 3 个;收进来的正文按行裁到静态上限,行账(第 1-N 行 / 共 M 行)留给界面和模型看。
 * 跟图片不一样:文字模型也能读文件,所以没有能力闸;发送后不清空 ——
 * 文件像引用原子一样常驻输入框、每轮都带上,要换就点 ×。
 * 文件树拖来的只有 relPath,由 addFromRelPath 走 readPreview 读盘,不另开秤。
 * 系统拖/选进来的另留本机绝对路径(absPath),主进程凭它发本次运行的续读授权令牌(拖入即授权);
 * 拿不到路径的(剪切板/网页来源)照旧只读这一轮,不给假承诺。
 */
export interface ChatFilesApi {
  files: ChatFileAttachment[]
  addFiles: (files: Iterable<File>) => Promise<void>
  /** 文件树拖来的文件(只有 relPath):读盘 → 收编进同同一数据源 */
  addFromRelPath: (rootPath: string, relPath: string) => Promise<void>
  removeFile: (id: string) => void
  clear: () => void
}

/** 拖/粘/选进来的一堆文件按类分流:图片走图片那条链,其余走文件附件 */
export function partitionAttachFiles(files: Iterable<File>): { images: File[]; files: File[] } {
  const images: File[] = []
  const rest: File[] = []
  for (const f of files) (isImageFile(f.name) ? images : rest).push(f)
  return { images, files: rest }
}

/** 系统文件对象 → 本机绝对路径(拖入即授权的凭据);拿不到(剪切板/网页来源)或样子
 *  不对就回 undefined —— 那种文件照旧只能读这一轮,不给续读的假承诺 */
function fileAbsPath(file: File): string | undefined {
  try {
    const path = window.atlas.getPathForFile(file).trim()
    return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path) ? path : undefined
  } catch {
    return undefined
  }
}

/** 文件 → 收编好的 ChatFileAttachment(正文裁到行边界);不合格就回一句拒收的人话 */
async function fileToChatFile(file: File): Promise<ChatFileAttachment | string> {
  const name = file.name.trim() || '文件'
  const fail = (why: string): string => `「${name}」${why}`
  if (file.size > PREVIEW_MAX_BYTES)
    return fail(`太大(超过 ${formatSize(PREVIEW_MAX_BYTES)}),没带进来`)
  if (isBinaryFile(name)) return fail('不是文本文件(图片/压缩包这类读不出文字),没带进来')
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail('读不出来,没带进来')
  }
  if (looksBinary(bytes.subarray(0, 8192))) return fail('不是文本文件(内容里是二进制数据),没带进来')
  const clip = clipPreview(new TextDecoder().decode(bytes))
  if (clip.text.trim() === '') return fail('是空文件,带进来也没内容')
  const cut = clipTextToLines(clip.text, CHAT_FILE_CHARS_MAX)
  return {
    id: crypto.randomUUID(),
    name,
    absPath: fileAbsPath(file),
    text: cut.text,
    totalLines: clip.totalLines,
    size: file.size
  }
}

export function useChatFiles(
  /** 垫灰字的口(渲染层的 note):拒收/满额都走它跟人交代 */
  note: (text: string) => void
): ChatFilesApi {
  const [files, setFiles] = useState<ChatFileAttachment[]>([])
  const noteRef = useRef(note)
  const filesRef = useRef(files)
  // ref 只能在渲染外更新(React 规矩):状态表会话内顺手镜像,addFiles/删账都读 ref 不看旧快照
  useEffect(() => {
    noteRef.current = note
    filesRef.current = files
  })

  async function addFiles(incoming: Iterable<File>): Promise<void> {
    for (const file of incoming) {
      if (filesRef.current.length >= CHAT_FILES_MAX) {
        noteRef.current(`一次最多带 ${CHAT_FILES_MAX} 个文件,多出的没加进来`)
        break
      }
      const name = file.name.trim() || '文件'
      if (filesRef.current.some((f) => f.name === name && f.size === file.size)) {
        noteRef.current(`「${name}」已经带进来了`)
        continue
      }
      const result = await fileToChatFile(file)
      if (typeof result === 'string') {
        noteRef.current(result)
        continue
      }
      filesRef.current = [...filesRef.current, result]
      setFiles(filesRef.current)
    }
  }

  /** 文件树拖来的文件:readPreview 读盘验身份(拒绝路径/越界/错误话术全复用它), 收编进同同一数据源 */
  async function addFromRelPath(rootPath: string, relPath: string): Promise<void> {
    const name = relPath.split('/').pop() ?? relPath
    if (filesRef.current.length >= CHAT_FILES_MAX) {
      noteRef.current(`一次最多带 ${CHAT_FILES_MAX} 个文件,想换新的先摘一个`)
      return
    }
    if (filesRef.current.some((f) => f.relPath === relPath)) {
      noteRef.current(`「${name}」已经带进来了`)
      return
    }
    const readFailed = `「${name}」读不出来,没带进来`
    const res = await window.atlas.readPreview(rootPath, relPath).catch(() => null)
    if (!res) {
      noteRef.current(readFailed)
      return
    }
    if (res.status !== 'ok') {
      noteRef.current(
        res.status === 'binary'
          ? `「${name}」不是文本文件(图片/压缩包这类读不出文字),没带进来`
          : res.status === 'too-big'
            ? `「${name}」太大(超过 ${formatSize(PREVIEW_MAX_BYTES)}),没带进来`
            : res.status === 'image'
              ? `「${name}」是图片,拖进来会进图片那条路`
              : res.status === 'audio'
                ? `「${name}」是音频,不能当文本附件带进来`
                : res.reason || readFailed
      )
      return
    }
    if (res.text.trim() === '') {
      noteRef.current(`「${name}」是空文件,带进来也没内容`)
      return
    }
    const cut = clipTextToLines(res.text, CHAT_FILE_CHARS_MAX)
    filesRef.current = [
      ...filesRef.current,
      {
        id: crypto.randomUUID(),
        name,
        relPath,
        text: cut.text,
        totalLines: res.totalLines,
        size: 0
      }
    ]
    setFiles(filesRef.current)
  }

  function removeFile(id: string): void {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      filesRef.current = next
      return next
    })
  }

  function clear(): void {
    filesRef.current = []
    setFiles([])
  }

  return { files, addFiles, addFromRelPath, removeFile, clear }
}
