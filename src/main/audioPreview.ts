// ── 音频预览支路:ipcScan 的 readPreview 配套小文件 ──
// 只读文件头验魔数,整文件不进内存;真身字节由 atlas-media 协议按需流给 <audio>。

import { promises as fs } from 'node:fs'
import { accessDeniedMessage } from '../shared/fsMessages.ts'
import { audioMimeOf } from '../shared/fileKinds.ts'
import { sniffAudio } from '../shared/audioMeta.ts'
import type { FilePreviewResult } from '../shared/types.ts'

/** 魔数只需开头这点:WAV 12 字节,MP3 的 ID3/帧同步更短 */
const HEAD_BYTES = 16

/**
 * 文件头到手的后半程(纯函数,自测覆盖):后缀与字节必须对上同一种;
 * 对不上(改名冒充)回 binary 说人话。
 */
export function audioResultFromHead(
  name: string,
  sizeBytes: number,
  head: Uint8Array
): FilePreviewResult {
  const want = audioMimeOf(name)
  const got = sniffAudio(head)
  if (want === null || got === null || want !== got) {
    return {
      status: 'binary',
      text: '',
      totalLines: 0,
      reason: '这个文件的后缀是音频,但内容不是有效的 MP3/WAV —— 多半是别的文件改了名,预览不了'
    }
  }
  return {
    status: 'audio',
    text: '',
    totalLines: 0,
    reason: '这是一支音频,没有可当文本看或引用的内容',
    audio: { mime: got, bytes: sizeBytes }
  }
}

/**
 * 音频支路的异步半截:只读文件头。absPath 必须由 joinRoot 拼好递进来。
 */
export async function readAudioPreview(opts: {
  absPath: string
  relPath: string
  sizeBytes: number
}): Promise<FilePreviewResult> {
  const name = opts.relPath.split('/').pop() ?? opts.relPath
  let handle: fs.FileHandle
  try {
    handle = await fs.open(opts.absPath, 'r')
  } catch (err) {
    throw new Error(accessDeniedMessage(err as NodeJS.ErrnoException, '文件', opts.relPath), {
      cause: err
    })
  }
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0)
    return audioResultFromHead(name, opts.sizeBytes, head.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
