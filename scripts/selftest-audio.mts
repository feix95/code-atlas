// 音频预览自测:后缀名单、魔数验身、协议 URL 往返、分支判定。
// 样本字节全在内存里构造,仓库里不放任何音频文件。
import assert from 'node:assert/strict'
import { AUDIO_EXTS, isAudioFile, audioMimeOf, canPreviewFile } from '../src/shared/fileKinds.ts'
import { sniffAudio, formatAudioClock, audioSeekPercent } from '../src/shared/audioMeta.ts'
import {
  previewAudioSrc,
  parseAudioMediaUrl,
  parseAudioByteRange,
  audioMediaReply
} from '../src/shared/audioMedia.ts'
import { audioResultFromHead } from '../src/main/audioPreview.ts'

function wavHead(): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x00, 0x00, 0x00, 0x00
  ])
}

function mp3Id3(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
}

function mp3Frame(): Uint8Array {
  return new Uint8Array([0xff, 0xfb, 0x90, 0x00])
}

function main(): void {
  assert.deepEqual([...AUDIO_EXTS].sort(), ['.mp3', '.wav'], '名单就这两种')
  assert.equal(isAudioFile('a.mp3'), true, 'mp3 是音频')
  assert.equal(isAudioFile('B.WAV'), true, '大写后缀也算')
  assert.equal(isAudioFile('c.flac'), false, 'flac 不在预览名单')
  assert.equal(isAudioFile('noext'), false, '没后缀不算')
  assert.equal(isAudioFile('.mp3'), false, '隐藏文件式的名字不算')

  assert.equal(audioMimeOf('a.mp3'), 'audio/mpeg', 'mp3 → mpeg')
  assert.equal(audioMimeOf('a.wav'), 'audio/wav', 'wav → wav')
  assert.equal(audioMimeOf('a.WAV'), 'audio/wav', '大写 wav 也认')
  assert.equal(audioMimeOf('a.flac'), null, '名单外回 null')

  assert.equal(canPreviewFile('song.mp3'), true, 'mp3 能开预览签')
  assert.equal(canPreviewFile('take.wav'), true, 'wav 能开预览签')
  assert.equal(canPreviewFile('shot.psd'), false, 'psd 仍不能开')

  assert.equal(sniffAudio(wavHead()), 'audio/wav', 'RIFF/WAVE 认 wav')
  assert.equal(sniffAudio(mp3Id3()), 'audio/mpeg', 'ID3 认 mp3')
  assert.equal(sniffAudio(mp3Frame()), 'audio/mpeg', '帧同步认 mp3')
  assert.equal(sniffAudio(new Uint8Array([0x00, 0x01, 0x02])), null, '乱字节不认')
  assert.equal(sniffAudio(new Uint8Array()), null, '空缓冲不认')

  const ok = audioResultFromHead('a.wav', 100, wavHead())
  assert.equal(ok.status, 'audio', '真 wav 回 audio')
  assert.equal(ok.audio?.mime, 'audio/wav')
  assert.equal(ok.audio?.bytes, 100)

  const fake = audioResultFromHead('a.mp3', 8, new TextEncoder().encode('not audio!!'))
  assert.equal(fake.status, 'binary', '假冒 mp3 回 binary')
  assert.equal(fake.audio, undefined)

  const mismatch = audioResultFromHead('a.mp3', 16, wavHead())
  assert.equal(mismatch.status, 'binary', '后缀 mp3 内容 wav 不认')

  const src = previewAudioSrc('G:\\插画', 'sfx/hit.wav')
  const back = parseAudioMediaUrl(src)
  assert.ok(back, '协议 URL 能拆回')
  assert.equal(back.root, 'G:\\插画', '中文盘符路径不丢')
  assert.equal(back.rel, 'sfx/hit.wav')
  assert.equal(parseAudioMediaUrl('https://example/x'), null, '别的协议不认')
  assert.equal(parseAudioMediaUrl('atlas-media://preview/'), null, '缺参不认')

  assert.equal(formatAudioClock(0), '0:00')
  assert.equal(formatAudioClock(65), '1:05')
  assert.equal(formatAudioClock(NaN), '0:00', 'NaN 不上屏')
  assert.equal(formatAudioClock(-1), '0:00')
  assert.equal(audioSeekPercent(30, 120), 25, '四分之一')
  assert.equal(audioSeekPercent(0, 0), 0, '时长未知钉在 0')
  assert.equal(audioSeekPercent(10, NaN), 0, 'NaN 时长钉在 0')

  assert.deepEqual(parseAudioByteRange('bytes=0-99', 200), { start: 0, end: 99 })
  assert.deepEqual(parseAudioByteRange('bytes=50-', 200), { start: 50, end: 199 })
  assert.equal(parseAudioByteRange(null, 200), null, '没 Range 不是切片')
  const whole = audioMediaReply('audio/wav', 1000, null)
  assert.equal(whole.status, 200)
  assert.equal(whole.headers['Content-Length'], '1000', '整段必须带长度,播放器才量得出时长')
  assert.equal(whole.headers['Content-Type'], 'audio/wav')
  const part = audioMediaReply('audio/mpeg', 1000, 'bytes=0-1')
  assert.equal(part.status, 206)
  assert.equal(part.headers['Content-Range'], 'bytes 0-1/1000')

  console.log('✅ 音频预览自测全部通过')
  console.log(
    '   名单 · 后缀→MIME · WAV/MP3 魔数 · 假冒与错配 · 协议 URL 往返 · 进度钟 · Range/时长头'
  )
}

main()
