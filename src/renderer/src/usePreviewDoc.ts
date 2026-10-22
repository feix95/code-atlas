// 预览签的按文件记账:读到什么、编辑稿、一闪而过的提示、改名回执 —— 账都记在文件名下,绝不串台。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilePreviewResult } from '@shared/types'
import type { RenameOutcome } from '@shared/fileRename'
import { friendlyErr } from './errText'

/** 「一闪而过」小开关的亮灯时长:整条复制提示停久一点 */
const COPIED_ALL_MS = 2000

export function usePreviewDoc(deps: {
  rootPath: string
  relPath: string
  /** 内联标题改名通道:递新主名进回调,拿 RenameOutcome 回执;不传 = 标题只展示 */
  onRenameFile?: (base: string) => Promise<RenameOutcome>
}): {
  result: FilePreviewResult | null
  err: string | null
  diskText: string
  colors: number[][][] | undefined
  text: string
  total: number
  copiedAll: boolean
  renameErr: string | null
  patchUi: (patch: Partial<{ copiedAll: boolean; renameErr: string | null }>) => void
  onTextChange: (t: string) => void
  requestRename: (base: string) => Promise<RenameOutcome>
  copyAll: (text: string) => void
} {
  const { rootPath, relPath, onRenameFile } = deps

  // ── 换文件就地复位:App 不挂 key={relPath} 强制重挂,复位收编在这里 ——
  //    所有现场按文件名记账,哪份文件的账归哪份用;对不上号,当场回出厂 ──
  /** 读文件这笔账:读到什么/出什么错,记在哪个文件名下 */
  const [loadedAt, setLoadedAt] = useState<{
    file: string
    result: FilePreviewResult | null
    err: string | null
  }>({ file: '', result: null, err: null })
  /** 「已复制」一闪而过小开关 + 改名报错条的账 */
  const [uiAt, setUiAt] = useState<{
    file: string
    copiedAll: boolean
    renameErr: string | null
  }>({ file: '', copiedAll: false, renameErr: null })
  /**
   * 编辑中的最新文稿(state 账):编辑器一打字就更新,切阅读档时按它渲染 ——
   * 每键一渲的账很轻;按文件名记账,别份文件的稿子绝不冒名顶替。
   */
  const [editAt, setEditAt] = useState<{ file: string; text: string } | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const result = loadedAt.file === relPath ? loadedAt.result : null
  const err = loadedAt.file === relPath ? loadedAt.err : null
  const copiedAll = uiAt.file === relPath && uiAt.copiedAll
  const renameErr = uiAt.file === relPath ? uiAt.renameErr : null

  /** 改小开关:只动当前文件的账;换了文件才姗姗来迟的开关(迟到定时器),当没看见 */
  const patchUi = useCallback(
    (patch: Partial<{ copiedAll: boolean; renameErr: string | null }>): void => {
      setUiAt((prev) => (prev.file === relPath ? { ...prev, ...patch } : prev))
    },
    [relPath]
  )

  const onTextChange = useCallback(
    (t: string): void => {
      setEditAt({ file: relPath, text: t })
    },
    [relPath]
  )

  /**
   * 内联标题改名通道:回执一到,读稿/草稿的账就地换成新路径 ——
   * 等 App 换完扫描树与页签,relPath 落到新值,两边正好接上,不闪「正在读文件」;
   * 败了把报错挂上提示条(账跟着文件名,换文件自动消)。
   */
  const requestRename = useCallback(
    async (base: string): Promise<RenameOutcome> => {
      if (!onRenameFile) return { ok: false, error: '改名通道没接上' }
      const r = await onRenameFile(base)
      if (r.ok) {
        setLoadedAt((prev) =>
          prev.file === relPath ? { file: r.relPath, result: prev.result, err: prev.err } : prev
        )
        setEditAt((prev) => (prev?.file === relPath ? { file: r.relPath, text: prev.text } : prev))
        patchUi({ renameErr: null })
      } else {
        patchUi({ renameErr: r.error })
      }
      return r
    },
    [onRenameFile, relPath, patchUi]
  )

  // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径是主进程的事。
  // 账记在文件名下:新文件还没回话时,旧文件的内容一秒都不冒名顶替
  useEffect(() => {
    let alive = true
    window.atlas
      .readPreview(rootPath, relPath)
      .then((res) => {
        if (alive) setLoadedAt({ file: relPath, result: res, err: null })
      })
      .catch((e) => {
        if (alive) setLoadedAt({ file: relPath, result: null, err: friendlyErr(e) })
      })
    return () => {
      alive = false
    }
  }, [rootPath, relPath])

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  const diskText = result?.status === 'ok' ? result.text : ''
  /** 分色账:主进程按行给好的段落;没有 = 这份不上色,白字照常 */
  const colors = result?.status === 'ok' ? result.colors : undefined
  /** 编辑器手里的最新文稿:没动过字 = 盘上那份,动过 = 编辑稿 */
  const text = editAt?.file === relPath ? editAt.text : diskText
  /** 行数闸用打开时的行数(编辑中跨线的概率低,巨型文件保守策略不跟着抖) */
  const total = useMemo(() => (diskText === '' ? 0 : diskText.split('\n').length), [diskText])

  /** Ctrl+A 复制全文:提示闪一下就走 */
  const copyAll = useCallback(
    (body: string): void => {
      if (body === '') return
      void navigator.clipboard
        .writeText(body)
        .then(() => {
          patchUi({ copiedAll: true })
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = setTimeout(() => patchUi({ copiedAll: false }), COPIED_ALL_MS)
        })
        .catch(() => {})
    },
    [patchUi]
  )

  return {
    result,
    err,
    diskText,
    colors,
    text,
    total,
    copiedAll,
    renameErr,
    patchUi,
    onTextChange,
    requestRename,
    copyAll
  }
}
