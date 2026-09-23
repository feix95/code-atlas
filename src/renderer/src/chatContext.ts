import type { ChatContextAttachment, FileStructure, ScanDirNode, ScanFileNode } from '@shared/types'
import { ATTACHMENT_DETAILS_MAX } from '@shared/aiDefaults'
import { TAG } from '@shared/promptTags'

/**
 * 自由对话的「资料附件」构建器:从扫描树里现场整理当前选中对象的资料。
 * 附件只是参考信息挂件,不是对话历史 —— 每次发请求都带当下最新的这份,
 * 切换对象时旧资料不会混进新对话。
 * 附件正文上限的户口在 shared/aiDefaults(ATTACHMENT_DETAILS_MAX):渲染层整理时按它截,
 * 主进程洗附件按它验,一把尺。
 */

/** 逐行拼正文,超长就地截断,绝不静默丢一半句子 */
function clipDetails(lines: string[]): string {
  let text = ''
  for (const line of lines) {
    if (text.length + line.length + 1 > ATTACHMENT_DETAILS_MAX) {
      return `${text}\n……${TAG.programNote.open}资料太长,只取了前面一部分${TAG.programNote.close}`
    }
    text += text ? `\n${line}` : line
  }
  return text
}

/** 每类名单最多摆多少个,超了注明"没列全",不静默装完整 */
const MAX_LIST = 30

/** 文件的资料附件:路径/类型 + 结构骨架(点开过文件才有结构;没有就只摆基本盘) */
export function buildFileAttachment(
  file: ScanFileNode,
  structure: FileStructure | null
): ChatContextAttachment {
  const lines = [
    `相对路径:${file.relPath}`,
    `类型:${file.language ? file.language.name : '(没认出类型)'}`
  ]
  if (structure) {
    if (structure.functions.length > 0)
      lines.push(`函数:${structure.functions.slice(0, MAX_LIST).join(', ')}`)
    if (structure.classes.length > 0)
      lines.push(`类:${structure.classes.slice(0, MAX_LIST).join(', ')}`)
    if (structure.interfaces.length > 0)
      lines.push(`接口/类型:${structure.interfaces.slice(0, MAX_LIST).join(', ')}`)
    if (structure.reactComponents.length > 0)
      lines.push(`React 组件:${structure.reactComponents.slice(0, MAX_LIST).join(', ')}`)
    if (structure.imports.length > 0)
      lines.push(`导入:${structure.imports.slice(0, MAX_LIST).join(', ')}`)
    if (structure.exports.length > 0)
      lines.push(`导出:${structure.exports.slice(0, MAX_LIST).join(', ')}`)
  }
  return {
    targetType: 'file',
    name: file.name,
    relPath: file.relPath,
    summary: file.summary?.text ?? (file.language ? `${file.language.name} 文件` : '文件'),
    details: clipDetails(lines)
  }
}

/**
 * 文件夹的资料附件:子文件夹/文件名单 + 通用后缀分布(什么文件都数,
 * .exe/.dll/.log 这些是认出系统文件夹的关键证据)。
 * 分级扫描没探开的目录(lazy)老实说明只知名字,不装作看过里面。
 */
export function buildFolderAttachment(
  dir: ScanDirNode,
  displayName: string
): ChatContextAttachment {
  const lines: string[] = [`相对路径:${dir.relPath || '(项目根目录)'}`]
  if (dir.lazy) {
    lines.push('(这个文件夹还没点开扫描,目前只知道名字和位置,里面有什么还没看)')
  } else {
    const subdirs: string[] = []
    const files: string[] = []
    const extCounts = new Map<string, number>()
    for (const child of dir.children) {
      if (child.type === 'directory') {
        subdirs.push(child.name)
        continue
      }
      files.push(child.name)
      const ext = child.ext !== '' ? child.ext : '(无后缀)'
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
    }
    const extLines = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([ext, count]) => `${ext}×${count}`)
    lines.push(
      `- 子文件夹(${subdirs.length} 个):${subdirs.slice(0, MAX_LIST).join(', ')}${subdirs.length > MAX_LIST ? ' ……(没列全)' : ''}`,
      `- 文件(${files.length} 个):${files.slice(0, MAX_LIST).join(', ')}${files.length > MAX_LIST ? ' ……(没列全)' : ''}`,
      `- 文件类型分布:${extLines.length > 0 ? extLines.join(', ') : '(这个文件夹没有文件)'}`
    )
  }
  return {
    targetType: dir.relPath === '' ? 'project' : 'folder',
    name: displayName,
    relPath: dir.relPath,
    summary: dir.summary?.text ?? '文件夹',
    details: clipDetails(lines)
  }
}
