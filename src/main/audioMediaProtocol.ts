// atlas-media 协议:给音频预览流文件。必须先 registerSchemesAsPrivileged(app ready 前),
// 再在 ready 后 handle。自己回 Content-Type / Content-Length / Range:
// 转手 net.fetch(file://) 常常不带长度,Chromium 量不出时长,进度条就钉死在 0。

import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { joinRoot } from '../shared/paths.ts'
import { audioMimeOf, isAudioFile } from '../shared/fileKinds.ts'
import { AUDIO_MEDIA_SCHEME, audioMediaReply, parseAudioMediaUrl } from '../shared/audioMedia.ts'

export function registerAudioMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function installAudioMediaProtocol(): void {
  protocol.handle(AUDIO_MEDIA_SCHEME, (request) => serveAudioPreview(request))
}

function fileStream(abs: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream<Uint8Array>
}

async function serveAudioPreview(request: Request): Promise<Response> {
  const parsed = parseAudioMediaUrl(request.url)
  if (!parsed) return new Response(null, { status: 400 })
  const name = parsed.rel.split('/').pop() ?? parsed.rel
  if (!isAudioFile(name)) return new Response(null, { status: 415 })
  const mime = audioMimeOf(name)
  if (mime === null) return new Response(null, { status: 415 })
  let abs: string
  try {
    abs = joinRoot(parsed.root, parsed.rel)
  } catch {
    // 越界路径只回 403,不把 joinRoot 的人话抛给 Chromium 当网络错误
    return new Response(null, { status: 403 })
  }
  let size: number
  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) return new Response(null, { status: 404 })
    size = st.size
  } catch {
    // 文件中途被删/无权读:当 404,播放器走 error 态
    return new Response(null, { status: 404 })
  }
  const reply = audioMediaReply(mime, size, request.headers.get('Range'))
  if (size === 0) return new Response(null, { status: reply.status, headers: reply.headers })
  return new Response(fileStream(abs, reply.start, reply.end), {
    status: reply.status,
    headers: reply.headers
  })
}
