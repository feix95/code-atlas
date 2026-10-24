// 模型档案读取:GGUF 头翻结构档案,词表会被头尺寸自动跳过。
// 无 Electron 依赖,纯 node fs —— ipcModel / launchPlanner / builtin.ts 三处共用这一份。
import { open } from 'node:fs/promises'
import { parseGgufHeader } from '../shared/gguf.ts'
import type { GgufShape } from '../shared/types.ts'

// 词表元数据常在头部偏后:先读 2MB,读不完(截断)逐级加码到 16MB/128MB,还不够就认输
const GGUF_HEAD_SIZES = [2 * 1024 * 1024, 16 * 1024 * 1024, 128 * 1024 * 1024]

/**
 * 翻模型档案(GGUF 头):出厂上下文上限、层数、头数、架构名、专家数 —— 档位滑块拿它封顶,
 * 黑板账拿它精算,启动方案拿它认 MoE。翻不出来(不是 GGUF / 头部超长 / 读失败)老实回 null,不拦人。
 */
export async function readModelShape(modelPath: string): Promise<GgufShape | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(modelPath, 'r')
    const fileSize = (await handle.stat()).size
    for (const size of GGUF_HEAD_SIZES) {
      const len = Math.min(size, fileSize)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await handle.read(buf, 0, len, 0)
      if (bytesRead < len) return null
      const parsed = parseGgufHeader(buf)
      if (parsed.status === 'ok') return parsed.shape
      if (parsed.status === 'bad') return null
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}
