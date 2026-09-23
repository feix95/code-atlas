// 模型下载器(主进程):货架上点了文件就往 userData/models/ 拉.gguf,拉完自动填进 AI 配置。
// 三条命根子:
// 1. 断点续传 —— .part 记进度,断网/关软件后再点同一个,从断掉的字节接着下,不从头再来;
// 2. 双源 —— 直连 HF 的 resolve 链接,连不上换 hf-mirror 镜像(与货架同款兜底);
// 3. 进度广播 —— 主进程边下边喊,渲染层画进度条;取消保留 .part,下次接着来。
// 只写 userData 自己的地盘,绝不碰用户项目目录(这不是项目文件,不涉及 joinRoot)。
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { HF_HOSTS, type ModelDownloadProgress } from '../shared/modelShelf.ts'
import { CH } from '../shared/ipcChannels.ts'
import { loadAiConfig, saveAiConfig } from './config.ts'

/** 下载落点:userData/models/<仓库名>/<文件名>。目录归咱管,用户只看到结果路径 */
export function modelsRoot(userDataDir: string): string {
  return join(userDataDir, 'models')
}

/** 仓库名/文件路径的白名单校验:防路径穿越,防注入式怪输入(与货架拉取同款家规) */
function safeTarget(userDataDir: string, repoId: string, filePath: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId)) throw new Error('模型名不合法')
  if (!/^[A-Za-z0-9][A-Za-z0-9/_. -]*\.gguf$/i.test(filePath)) throw new Error('文件名不合法')
  if (filePath.includes('..')) throw new Error('文件名不合法')
  const dir = join(modelsRoot(userDataDir), repoId.split('/')[1])
  return join(dir, basename(filePath))
}

/** resolve 链接:直连与镜像同构,只换域名;域名表和货架拉取共用(shared/modelShelf 的 HF_HOSTS) */
function resolveUrls(repoId: string, filePath: string): string[] {
  return HF_HOSTS.map((host) => `${host}/${repoId}/resolve/main/${filePath}`)
}

let current: { controller: AbortController } | null = null

function announce(win: BrowserWindow | null, p: ModelDownloadProgress): void {
  win?.webContents.send(CH.modelDownloadProgress, p)
}

/** 把 web 响应体一段段追加进 .part 文件;取消/断流时抛错,.part 留着给下次续传 */
async function streamToFile(
  body: ReadableStream<Uint8Array>,
  targetPath: string,
  signal: AbortSignal,
  onChunk: (bytes: number) => Promise<void>
): Promise<void> {
  const out = createWriteStream(targetPath, { flags: 'a' })
  const reader = body.getReader()
  try {
    while (true) {
      if (signal.aborted) throw new Error('CANCELLED')
      const { done, value } = await reader.read()
      if (done) break
      await new Promise<void>((resolve, reject) => {
        out.write(value, (err) => (err ? reject(err) : resolve()))
      })
      await onChunk(value.byteLength)
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()))
    reader.releaseLock()
  }
}

/** 发起下载(同一时间只跑一个);resolve = 最终文件路径;进度经 win 广播 */
export async function startModelDownload(opts: {
  win: BrowserWindow | null
  userDataDir: string
  repoId: string
  filePath: string
}): Promise<string> {
  if (current) throw new Error('已经有一个模型在下着了,等它完事儿或者先取消')
  const targetPath = safeTarget(opts.userDataDir, opts.repoId, opts.filePath)
  await fs.mkdir(join(targetPath, '..'), { recursive: true })

  const controller = new AbortController()
  current = { controller }

  try {
    const urls = resolveUrls(opts.repoId, opts.filePath)
    let lastError: Error | null = null

    // 两源各试两轮;每轮都从 .part 现状续传
    for (let round = 0; round < 4; round++) {
      if (controller.signal.aborted) break
      const url = urls[round % urls.length]
      const offset = existsSync(targetPath) ? statSync(targetPath).size : 0

      // 问一次文件总大小,算百分比;问不到就退化成「已下 X」
      let totalBytes: number | null = null
      try {
        const head = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow'
        })
        const len = head.headers.get('content-length')
        if (len) totalBytes = Number(len)
      } catch {
        // HEAD 挂了不拦下载
      }

      try {
        const res = await fetch(url, {
          headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
          signal: controller.signal,
          redirect: 'follow'
        })
        if (res.status === 416) {
          // 起点超出文件头(远端文件变过了):旧 .part 不可信,从头再来
          await fs.rm(targetPath, { force: true })
          continue
        }
        if (!res.ok || !res.body) throw new Error(`下载服务回了 ${res.status}`)
        // Range 响应的 Content-Length 是剩余量;总量 = 起点 + 剩余
        if (res.headers.get('content-length')) {
          totalBytes = offset + Number(res.headers.get('content-length'))
        }
        let received = offset
        await streamToFile(res.body, targetPath, controller.signal, async (bytes) => {
          received += bytes
          announce(opts.win, {
            repoId: opts.repoId,
            filePath: opts.filePath,
            receivedBytes: received,
            totalBytes,
            finalPath: null,
            error: null,
            cancelled: false
          })
        })
        // 下完:报最终路径
        announce(opts.win, {
          repoId: opts.repoId,
          filePath: opts.filePath,
          receivedBytes: 0,
          totalBytes: null,
          finalPath: targetPath,
          error: null,
          cancelled: false
        })
        return targetPath
      } catch (err) {
        if (controller.signal.aborted) break
        lastError = err as Error
        // 换源/重试;.part 保留,下轮续传
      }
    }

    const cancelled = controller.signal.aborted
    announce(opts.win, {
      repoId: opts.repoId,
      filePath: opts.filePath,
      receivedBytes: existsSync(targetPath) ? statSync(targetPath).size : 0,
      totalBytes: null,
      finalPath: null,
      error: cancelled ? null : (lastError?.message ?? '两个源都没通'),
      cancelled
    })
    throw new Error(cancelled ? '已取消' : `下载失败:${lastError?.message ?? '两个源都没通'}`)
  } finally {
    current = null
  }
}

export function cancelModelDownload(): boolean {
  if (!current) return false
  current.controller.abort()
  return true
}

export function isDownloading(): boolean {
  return current !== null
}

/** 下载完成后自动填 AI 配置:内置引擎指向新模型,顺手把当前 Provider 切到内置 —— 点了货架就是走内置这条线 */
export async function pointConfigAtModel(userDataDir: string, modelPath: string): Promise<void> {
  const config = await loadAiConfig(userDataDir)
  await saveAiConfig(userDataDir, {
    ...config,
    provider: 'builtin',
    builtin: { ...config.builtin, modelPath }
  })
}
