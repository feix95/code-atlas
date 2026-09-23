import { accessDeniedMessage, formatSize } from './aiEvidence.ts'
import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { scanDirectory } from '../scanner/index.ts'
import { annotateSummaries } from '../summarizer/index.ts'
import { analyzeSource, isAnalysisSupported } from '../analyzer/index.ts'
import { buildDependencyGraph } from '../depgraph/index.ts'
import { isBinaryFile } from '../shared/fileKinds.ts'
import { joinRoot } from '../shared/paths.ts'
import { clipPreview, looksBinary, PREVIEW_MAX_BYTES } from '../shared/preview.ts'
import { highlightSource } from '../highlight/index.ts'
import { SOURCE_PARSE_MAX_BYTES } from '../shared/analysisLimits.ts'
import { CH } from '../shared/ipcChannels.ts'
import type { FilePreviewResult } from '../shared/types.ts'

export function registerScanIpc(): void {
  // 扫描指定文件夹,返回目录树 + 统计;顺手给每个节点打大白话速览标签
  ipcMain.handle(CH.scanFolder, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || folderPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    const root = folderPath.trim()
    // 地址栏手输的路径先验明正身:不存在 / 填的是文件,都得说人话,别吐 ENOENT 生面孔
    const stat = await fs.stat(root).catch((err: NodeJS.ErrnoException) => err)
    if (stat instanceof Error) {
      if (stat.code === 'ENOENT') {
        throw new Error(
          `找不到这个文件夹:${root} —— 检查一下盘符、拼写和斜杠方向;不确定的话,用「选择文件夹」点一个最稳`
        )
      }
      throw new Error(accessDeniedMessage(stat, '文件夹', root))
    }
    if (!stat.isDirectory()) {
      // 手滑填了文件路径:顺手把上一层文件夹指给他看
      const parent = root.replace(/[\\/]+[^\\/]+$/, '') || root
      throw new Error(`这个路径是一个文件,不是文件夹 —— 要填装它的那层文件夹,比如:${parent}`)
    }
    const result = scanDirectory(root)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // 分级扫描:点开某个还没探的子文件夹,只探这一层(预算内收工),返回子树 + 这一份统计
  ipcMain.handle(CH.scanSubdir, (_event, rootPath: unknown, relPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '' || typeof relPath !== 'string') {
      throw new Error('参数不合法')
    }
    // 路径契约:绝对路径拼接只走 joinRoot;子树 relPath 必须带全项目前缀,拼回大树才不断链
    const result = scanDirectory(joinRoot(rootPath, relPath), relPath)
    return result.then((r) => {
      annotateSummaries(r.tree)
      return r
    })
  })

  // AST 分析单个文件;不支持的语言/超大文件返回 null(诚实的能力边界,不是出错)
  // 路径契约:收 (rootPath, relPath),绝对路径只能由 joinRoot 在这儿解析
  ipcMain.handle(
    CH.analyzeFile,
    async (_event, rootPath: unknown, relPath: unknown, languageId: unknown) => {
      if (
        typeof rootPath !== 'string' ||
        typeof relPath !== 'string' ||
        typeof languageId !== 'string'
      ) {
        throw new Error('参数不合法')
      }
      if (!isAnalysisSupported(languageId)) return null
      const absPath = joinRoot(rootPath, relPath) // relPath 想越界(.. 上跳、盘符注入)会在这里被拦
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件', relPath))
      }
      if (!stat.isFile()) {
        throw new Error(`这个路径不是一个文件:${relPath}`)
      }
      if (stat.size > SOURCE_PARSE_MAX_BYTES) return null // 超过上限的源码不解析,避免卡顿
      const code = await fs.readFile(absPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
        throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
      })
      return analyzeSource(code, languageId)
    }
  )

  // 代码预览读文件(第一百一十锤):右键「预览文件」用的那条通道。
  // 路径契约同 analyze-file —— 收 (rootPath, relPath),绝对路径只经 joinRoot 解析,
  // relPath 越界(.. 上跳、盘符注入)在这儿被拦。守卫三道:二进制不受理、超大不受理、
  // 能读的也只给前一段(行数/字数双封顶),账目如实回给界面,绝不静默腰斩。
  ipcMain.handle(
    CH.readPreview,
    async (_event, rootPath: unknown, relPath: unknown): Promise<FilePreviewResult> => {
      if (typeof rootPath !== 'string' || typeof relPath !== 'string') {
        throw new Error('参数不合法')
      }
      const absPath = joinRoot(rootPath, relPath)
      const stat = await fs.stat(absPath).catch((err: NodeJS.ErrnoException) => err)
      if (stat instanceof Error) {
        throw new Error(accessDeniedMessage(stat, '文件', relPath), { cause: stat })
      }
      if (!stat.isFile()) {
        throw new Error(`这个路径不是一个文件:${relPath}`)
      }
      const name = relPath.split('/').pop() ?? relPath
      // 后缀一看就是二进制/媒体的,连读都不用读
      if (isBinaryFile(name)) {
        return {
          status: 'binary',
          text: '',
          totalLines: 0,
          reason:
            '这是二进制或媒体文件,里面没有能当文本看的字;想了解它的话,右栏的小探针可以按类型给你讲'
        }
      }
      if (stat.size > PREVIEW_MAX_BYTES) {
        return {
          status: 'too-big',
          text: '',
          totalLines: 0,
          reason: `这个文件有 ${formatSize(stat.size)},太大了,预览只伺候 ${formatSize(PREVIEW_MAX_BYTES)} 以内的文本`
        }
      }
      // 读内容也可能撞上独占/上锁(EBUSY/EPERM),走人话口径,不吐生面孔
      const buf = await fs.readFile(absPath).catch((err: NodeJS.ErrnoException) => {
        throw new Error(accessDeniedMessage(err, '文件', relPath), { cause: err })
      })
      // 后缀骗人的(改名的二进制)在这儿补一道:开头有 NUL 字节就不是文本
      if (looksBinary(buf.subarray(0, 8192))) {
        return {
          status: 'binary',
          text: '',
          totalLines: 0,
          reason: '这个文件的内容不是文本(开头就是二进制数据),预览不了'
        }
      }
      const clip = clipPreview(buf.toString('utf8'))
      // 预览分色(这锤):顺手让 tree-sitter 把代码过一遍。超闸、不认识的语言、
      // 解析出错都老实回 null —— 界面白字照常,分色永远不拖累预览本身。
      const colors = await highlightSource(clip.text, name)
      return {
        status: 'ok',
        text: clip.text,
        totalLines: clip.totalLines,
        colors: colors ?? undefined,
        reason: ''
      }
    }
  )

  // 项目关系图:全项目谁引用谁。路径契约同 analyze-file,读文件只走 joinRoot
  ipcMain.handle(CH.depGraph, (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      throw new Error('路径不能为空')
    }
    return buildDependencyGraph(rootPath)
  })
}
