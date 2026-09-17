// 模型货架的拉货手(主进程):从抱抱脸拉实时 GGUF 榜,渲染层经 IPC 看。
// 双源:直连 huggingface.co(8 秒超时),不通自动换国内镜像 hf-mirror.com(同一路径)——
// 国内直连 HF 经常连不上,镜像兜底是标配,不是可选项。
// 缓存只在内存里留 5 分钟,重启即清、零落盘:货架是浏览用的,不给用户电脑留垃圾。
import {
  sanitizeRepoFiles,
  sanitizeShelfList,
  type RepoFile,
  type ShelfResult
} from '../shared/modelShelf.ts'
import { queryMachineSpec } from './builtin.ts'

/** 拉货源:主源直连,备源国内镜像;镜像与 HF 的 API 路径同构,只换域名 */
const HF_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'] as const

/** 货架一次拉几行 */
export const SHELF_LIMIT = 60
/** 内存缓存放多久(毫秒) */
const SHELF_CACHE_MS = 5 * 60 * 1000

let cache: { at: number; result: ShelfResult } | null = null

/** 排序与筛选都在 API 侧按 downloads 定榜(最稳的公共口径),本地的 applyShelfQuery 再筛 */
async function fetchFromHost(host: string, timeoutMs: number): Promise<unknown> {
  const url =
    `${host}/api/models?filter=gguf&sort=downloads&direction=-1&limit=${SHELF_LIMIT}` +
    `&expand%5B%5D=downloads&expand%5B%5D=likes&expand%5B%5D=lastModified&expand%5B%5D=pipeline_tag&expand%5B%5D=gguf` +
    // tags 供准入过滤(conversational 兜底)和能力章(vision/tool-use/reasoning 线索),2026-09-18 补
    `&expand%5B%5D=tags`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HF API ${res.status}`)
  return res.json()
}

export async function fetchModelShelf(): Promise<ShelfResult> {
  if (cache && Date.now() - cache.at < SHELF_CACHE_MS) return cache.result

  // 先试直连(短超时,连不上别拖累界面),失败换镜像
  let raw: unknown
  let source: ShelfResult['source'] = 'huggingface'
  try {
    raw = await fetchFromHost(HF_HOSTS[0], 8_000)
  } catch {
    raw = await fetchFromHost(HF_HOSTS[1], 15_000)
    source = 'mirror'
  }

  const spec = await queryMachineSpec()
  const result: ShelfResult = {
    entries: sanitizeShelfList(raw),
    spec: { ramBytes: spec.ramBytes, vramBytes: spec.vramBytes ?? null },
    source
  }
  cache = { at: Date.now(), result }
  return result
}

/** 点开某行:拉该仓库的文件清单(tree 接口,带精确大小);同样双源 */
export async function fetchRepoFiles(repoId: string): Promise<RepoFile[]> {
  // 仓库名只该是「作者/模型名」两段;防注入式怪输入,白名单字符之外直接拒
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoId)) {
    throw new Error('模型名不合法')
  }
  const path = `/api/models/${repoId}/tree/main?recursive=true`
  for (let i = 0; i < HF_HOSTS.length; i++) {
    try {
      const res = await fetch(`${HF_HOSTS[i]}${path}`, { signal: AbortSignal.timeout(i === 0 ? 8_000 : 15_000) })
      if (!res.ok) throw new Error(`HF API ${res.status}`)
      return sanitizeRepoFiles(await res.json())
    } catch (err) {
      if (i === HF_HOSTS.length - 1) throw err
    }
  }
  return [] // 到不了(循环内要么 return 要么 throw),类型安抚
}
