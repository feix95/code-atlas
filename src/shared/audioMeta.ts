// 音频字节验身(纯函数,自测覆盖)
// 预览音频不靠后缀认亲:WAV 看 RIFF/WAVE,MP3 看 ID3 或帧同步。
// 只判「是不是这种货」,时长交给 <audio> 的 metadata,主进程不解码。

/** 预览认得的音频 MIME(与 AUDIO_EXTS 一一对应) */
export type AudioMime = 'audio/mpeg' | 'audio/wav'

const RIFF = [0x52, 0x49, 0x46, 0x46]
const WAVE = [0x57, 0x41, 0x56, 0x45]
const ID3 = [0x49, 0x44, 0x33]

function matchAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (offset + expected.length > bytes.length) return false
  return expected.every((b, i) => bytes[offset + i] === b)
}

function isWav(bytes: Uint8Array): boolean {
  return matchAt(bytes, 0, RIFF) && matchAt(bytes, 8, WAVE)
}

function isMp3(bytes: Uint8Array): boolean {
  if (matchAt(bytes, 0, ID3)) return true
  if (bytes.length < 2) return false
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}

/** 开头这段字节是 MP3 还是 WAV;都不是回 null(改名冒充 / 截断太短) */
export function sniffAudio(bytes: Uint8Array): AudioMime | null {
  if (isWav(bytes)) return 'audio/wav'
  if (isMp3(bytes)) return 'audio/mpeg'
  return null
}

/** 进度条已走比例 0–100;时长未知时钉在 0,不拿 NaN 去画 */
export function audioSeekPercent(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, (current / duration) * 100))
}

/** 进度钟:分:秒;非法值回 0:00,不拿 NaN 上屏 */
export function formatAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
