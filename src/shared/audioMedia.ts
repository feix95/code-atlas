// 音频预览的自定义协议:渲染层不碰 file://(隔离页里播不了),
// <audio src> 走 atlas-media://,主进程 joinRoot 验完再按文件流回。

export const AUDIO_MEDIA_SCHEME = 'atlas-media'

/** 渲染层给 <audio> 的地址:root/rel 进查询串,Windows 盘符与中文都能过 encode */
export function previewAudioSrc(rootPath: string, relPath: string): string {
  const url = new URL(`${AUDIO_MEDIA_SCHEME}://preview/`)
  url.searchParams.set('root', rootPath)
  url.searchParams.set('rel', relPath)
  return url.href
}

/** 主进程从请求 URL 拆回 root/rel;协议不对或缺参回 null,不抛 */
export function parseAudioMediaUrl(url: string): { root: string; rel: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${AUDIO_MEDIA_SCHEME}:`) return null
  const root = parsed.searchParams.get('root')
  const rel = parsed.searchParams.get('rel')
  if (root === null || root === '' || rel === null || rel === '') return null
  return { root, rel }
}

/** 解析 Range: bytes=start-end / bytes=start- / bytes=-suffix;不合规矩回 null */
export function parseAudioByteRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (header === null || header === '' || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!m) return null
  if (m[1] === '' && m[2] === '') return null
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Number(m[2])
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

/** 给协议回包用的状态/头/字节窗:有 Range 回 206,整段 200。Chromium 要 Content-Length 才量得出时长 */
export function audioMediaReply(
  mime: string,
  size: number,
  rangeHeader: string | null
): { status: number; headers: Record<string, string>; start: number; end: number } {
  const range = parseAudioByteRange(rangeHeader, size)
  if (range === null) {
    return {
      status: 200,
      start: 0,
      end: Math.max(0, size - 1),
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    }
  }
  return {
    status: 206,
    start: range.start,
    end: range.end,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  }
}
