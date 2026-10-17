// 引擎目录(第 4 期):钉死的发行版户口 —— 每个后端有哪几个包、多大、
// sha256 指纹是什么。数字与 ggml-org/llama.cpp 的 release API 交叉核对过,
// 升版只改这一份目录;纯数据 + 纯函数,不碰文件/网络。
export const ENGINE_TAG = 'b11685'

export type EngineBackend = 'cuda' | 'vulkan' | 'cpu'

export interface EngineAsset {
  /** release 资产文件名(也用作 .part 临时文件名) */
  file: string
  url: string
  bytes: number
  sha256: string
}

export interface EngineBackendInfo {
  id: EngineBackend
  displayName: string
  /** 一句话人话说明(给用户看) */
  oneLine: string
  /** 本后端要下载的全部包;cuda 两个包解进同一文件夹(cudart 是它的运行库) */
  assets: EngineAsset[]
}

const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_TAG}`

function asset(file: string, bytes: number, sha256: string): EngineAsset {
  return { file, url: `${BASE}/${file}`, bytes, sha256 }
}

export const ENGINE_CATALOG: Record<EngineBackend, EngineBackendInfo> = {
  cuda: {
    id: 'cuda',
    displayName: 'CUDA 加速',
    oneLine: 'NVIDIA 显卡专用，速度最快；约 550MB。',
    assets: [
      asset(
        `llama-${ENGINE_TAG}-bin-win-cuda-13.4-x64.zip`,
        154_609_646,
        'ebba1772945975ac86ebe72cce028e2770dfc42ed7c1d0dce890434d5032bf7b'
      ),
      asset(
        'cudart-llama-bin-win-cuda-13.4-x64.zip',
        423_535_356,
        '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668'
      )
    ]
  },
  vulkan: {
    id: 'vulkan',
    displayName: 'Vulkan 通用加速',
    oneLine: '各家显卡通用，比 CUDA 稍慢；约 31MB。',
    assets: [
      asset(
        `llama-${ENGINE_TAG}-bin-win-vulkan-x64.zip`,
        32_209_499,
        'f08862ea8be9e3487f2012ba9c2ce9c2ad99f358332a546e156a0076d4f09dda'
      )
    ]
  },
  cpu: {
    id: 'cpu',
    displayName: 'CPU 兼容模式',
    oneLine: '无显卡时可用，速度最慢；约 19MB。',
    assets: [
      asset(
        `llama-${ENGINE_TAG}-bin-win-cpu-x64.zip`,
        19_565_071,
        '3ac857118b17b5403feca3aaa9e02d3048b51e9d00630dccd965b224a474b4ec'
      )
    ]
  }
}

/** 后端优先级:挑「最好用的已装引擎」时按这个顺序往下走(vendor 兜底在最后) */
export const BACKEND_PREFERENCE: readonly EngineBackend[] = ['cuda', 'vulkan', 'cpu']

/** 用户设置里可填的引擎选择(含「自动」) */
export type EngineBackendChoice = 'auto' | EngineBackend

/** 引擎安家目录:<userData>/engines/<tag>/<backend>/llama-server.exe */
export function enginesRoot(userDataDir: string): string {
  return `${userDataDir}\\engines`
}
export function engineDirFor(userDataDir: string, backend: EngineBackend): string {
  return `${enginesRoot(userDataDir)}\\${ENGINE_TAG}\\${backend}`
}
export function engineExeFor(userDataDir: string, backend: EngineBackend): string {
  return `${engineDirFor(userDataDir, backend)}\\llama-server.exe`
}

/** 某个后端全部包的合计字节数(下载条进度、磁盘体检都用) */
export function backendTotalBytes(backend: EngineBackend): number {
  return ENGINE_CATALOG[backend].assets.reduce((sum, a) => sum + a.bytes, 0)
}

/** 约多少 MB(界面上「约 N MB」的口径,按 10^6 取整) */
export function approxDownloadMB(backend: EngineBackend): number {
  return Math.round(backendTotalBytes(backend) / 1_000_000)
}

/** 设置档白名单清洗:不认识的值一律当「自动」 */
export function sanitizeBackendChoice(raw: unknown): EngineBackendChoice {
  return raw === 'cuda' || raw === 'vulkan' || raw === 'cpu' || raw === 'auto' ? raw : 'auto'
}

// ── IPC 报单形状(引擎状态/安装进度;main 组装、preload/renderer 共用类型)──

export type EngineInstallStage = 'download' | 'verify' | 'extract' | 'check' | 'done'

export interface EngineInstallProgressInfo {
  backend: EngineBackend
  stage: EngineInstallStage
  percent: number
  bytesDone?: number
  bytesTotal?: number
}

/** atlas:engine-state 的返回 */
export interface EngineStateInfo {
  recommended: { backend: EngineBackend; reason: string } | null
  installed: EngineBackend[]
  active: {
    kind: 'custom' | 'installed' | 'vendor' | 'none'
    backend: EngineBackend | null
    label: string
    version: string | null
  } | null
  wantInstall: EngineBackend | null
  userChoice: EngineBackendChoice
  installing: { backend: EngineBackend; percent: number; stage: EngineInstallStage } | null
}
