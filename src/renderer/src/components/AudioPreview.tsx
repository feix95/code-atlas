import { useEffect, useRef, useState } from 'react'
import type { FilePreviewAudio } from '@shared/types'
import type { RenameOutcome } from '@shared/fileRename'
import { formatSize } from '@shared/fsMessages'
import { audioSeekPercent, formatAudioClock } from '@shared/audioMeta'
import { previewAudioSrc } from '@shared/audioMedia'
import { ImageFileName } from './ImageFileName'
import { Notice } from './Notice'
import { ProgressDots } from './ProgressDots'

type AudioPhase = 'loading' | 'ready' | 'error'

/**
 * 音频预览:MP3/WAV 文件签的正文。
 * 魔数验过之后走 atlas-media 流式播放;播放/暂停、拖进度、显示时长。
 * 底栏文件名同款芯片,双击改主名。不碰代码那套只读/引用/折行。
 */
export function AudioPreview({
  rootPath,
  relPath,
  fileName,
  audio,
  onRename
}: {
  rootPath: string
  relPath: string
  fileName: string
  audio: FilePreviewAudio
  onRename?: (base: string) => Promise<RenameOutcome>
}): React.JSX.Element {
  const elRef = useRef<HTMLAudioElement | null>(null)
  const [phase, setPhase] = useState<AudioPhase>('loading')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const src = previewAudioSrc(rootPath, relPath)
  const canSeek = Number.isFinite(duration) && duration > 0
  const progress = `${audioSeekPercent(current, duration)}%`

  function syncFromEl(el: HTMLAudioElement): void {
    setCurrent(el.currentTime)
    if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
  }

  useEffect(() => {
    const el = elRef.current
    return () => {
      el?.pause()
    }
  }, [src])

  function toggle(): void {
    const el = elRef.current
    if (!el || phase !== 'ready') return
    if (el.paused) void el.play()
    else el.pause()
  }

  function onSeek(raw: string): void {
    const el = elRef.current
    if (!el || !canSeek) return
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    el.currentTime = next
    setCurrent(next)
  }

  return (
    <div className="audio-pane">
      <div className="audio-stage">
        <audio
          ref={elRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            syncFromEl(e.currentTarget)
            setPhase('ready')
          }}
          onDurationChange={(e) => syncFromEl(e.currentTarget)}
          onTimeUpdate={(e) => syncFromEl(e.currentTarget)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setPhase('error')}
        />
        {phase === 'error' ? (
          <Notice kind="warn">这支音频打不开 —— 文件可能已损坏,或内容不是有效的 MP3/WAV</Notice>
        ) : phase === 'loading' ? (
          <div className="audio-wait">
            <ProgressDots />
            正在读取音频……
          </div>
        ) : (
          <div className="audio-player">
            <button
              type="button"
              className="audio-play"
              aria-label={playing ? '暂停' : '播放'}
              onClick={toggle}
            >
              {playing ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="2" width="4" height="12" rx="1" />
                  <rect x="9" y="2" width="4" height="12" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 2.5v11l10-5.5z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              className="audio-seek"
              min={0}
              max={canSeek ? duration : 0}
              step={0.01}
              value={canSeek ? current : 0}
              disabled={!canSeek}
              aria-label="播放进度"
              style={{ '--p': progress } as React.CSSProperties}
              onChange={(e) => onSeek(e.currentTarget.value)}
            />
            <span className="audio-clock">
              {formatAudioClock(current)} / {formatAudioClock(duration)}
            </span>
          </div>
        )}
      </div>
      <div className="image-info">
        <ImageFileName fileName={fileName} onRename={onRename} />
        <span className="image-chip image-info-meta">{formatSize(audio.bytes)}</span>
      </div>
    </div>
  )
}
