// 预览引用与文件链接:选段挂卡、拖文件挂整份、AI 提到的绿字点开跳行、右键菜单。
// 对外全靠 ref 传话(openFileLink 身份稳定),账本本体住在这个钩子里。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatCodeRef, ScanResult } from '@shared/types'
import { buildFileLinkIndex, type FileLinkTarget } from '@shared/fileLinks'
import { CODE_REFS_MAX } from '@shared/aiDefaults'
import { planWholeFileRef } from '@shared/preview'
import type { NoteMap } from '@shared/notes'
import { openFilePathMenuFor } from './components/filePathMenuStore'
import { collectRelPaths, findFile } from './scanTreeTools'
import type { AiChatApi } from './useAiChat'
import type { PaneGroup } from './paneTabs'

export function usePreviewRefs(deps: {
  result: ScanResult | null
  folder: string | null
  notes: NoteMap
  chat: AiChatApi
  chatRef: React.RefObject<AiChatApi>
  openPreview: (relPath: string) => void
  groups: PaneGroup[]
  activeGroup: PaneGroup | null
  markFlash: (id: string) => void
  editNoteFromTree: (relPath: string) => void
  saveNote: (relPath: string, text: string) => void
}) {
  const {
    result,
    folder,
    notes,
    chat,
    chatRef,
    openPreview,
    groups,
    activeGroup,
    markFlash,
    editNoteFromTree,
    saveNote
  } = deps

  // 预览里选中的代码段(第一百一十一锤):挂到右栏输入框上,和问题一起发;换预览文件即清
  const [previewRefs, setPreviewRefs] = useState<ChatCodeRef[]>([])
  // 聊天文件链接的跳行目标:点了带行号的链接,预览窗滚到那一行;seq 计数让同一行连点也能再跳
  const [previewJump, setPreviewJump] = useState<{ line: number; seq: number } | null>(null)
  const jumpSeqRef = useRef(0)
  // 文件链接索引:扫描树一变就重建,AI 提到的文件拿它查户口;查得到的才画成可点链接
  const fileLinkIndex = useMemo(
    () => (result ? buildFileLinkIndex(collectRelPaths(result.tree)) : null),
    [result]
  )

  // 点聊天里的文件链接:树上查到就选中+开预览,带行号的连滚带跳直达那一行;
  // 查不到(刚被删/改名)就老实垫一句,绝不点了个寂寞。
  // 用 refs 持有最新的 result/chat/openPreview,让这个动作身份永远稳定 —— MiniMD 的 memo 才守得住:
  // 流式输出时只有正在吐字的那条消息重画,别的消息一个字都不动(聊多了也不给画面上强度)
  // (chatRef 在上方公用场声明处统一维护,这里直接拿来用)
  const resultRef = useRef(result)
  useEffect(() => {
    resultRef.current = result
  })
  const openPreviewRef = useRef(openPreview)
  useEffect(() => {
    openPreviewRef.current = openPreview
  })
  const openFileLink = useCallback(
    (relPath: string, line?: number): void => {
      const cur = resultRef.current
      if (!cur) return
      if (!findFile(cur.tree, relPath)) {
        chatRef.current.note(`${relPath} 现在不在目录树里了(可能刚被删掉或改名),开不了预览`)
        return
      }
      jumpSeqRef.current += 1
      // 引用就地清账 —— 行号是跟着文件走的
      setPreviewRefs([])
      setPreviewJump(line !== undefined ? { line, seq: jumpSeqRef.current } : null)
      openPreviewRef.current(relPath)
    },
    [chatRef]
  )

  // 文件链接上下文:索引 + 点击去处 + 右键菜单;没扫出树(还在首页)就没有链接这回事。
  // 备注三件套的活口(菜单统一大锤):每次渲染同步最新账,菜单回调经 ref 取用 ——
  // 身份一个用到底,fileLinks 的 useMemo 不用陪着 notes 每次换新
  const noteMenuRef = useRef<{
    hasNote: (relPath: string) => boolean
    onEdit: (relPath: string) => void
    onRemove: (relPath: string) => void
  }>({ hasNote: () => false, onEdit: () => {}, onRemove: () => {} })
  useEffect(() => {
    noteMenuRef.current = {
      hasNote: (relPath) => notes[relPath] !== undefined,
      onEdit: (relPath) => editNoteFromTree(relPath),
      onRemove: (relPath) => saveNote(relPath, '')
    }
  })
  const openFileLinkMenu = useCallback((relPath: string, x: number, y: number): void => {
    const cur = resultRef.current
    if (!cur) return
    const nm = noteMenuRef.current
    openFilePathMenuFor(cur.rootPath, relPath, x, y, {
      note: {
        hasNote: nm.hasNote(relPath),
        onEdit: () => nm.onEdit(relPath),
        onRemove: () => nm.onRemove(relPath)
      }
    })
  }, [])
  const fileLinks: FileLinkTarget | null = useMemo(
    () =>
      fileLinkIndex
        ? { index: fileLinkIndex, onOpen: openFileLink, onMenu: openFileLinkMenu }
        : null,
    [fileLinkIndex, openFileLink, openFileLinkMenu]
  )

  // 引用一段选中代码(第一百一十一锤):额度满了就不收(浮钮那边也会说清)
  function addPreviewRef(ref: ChatCodeRef): void {
    setPreviewRefs((prev) => (prev.length >= CODE_REFS_MAX ? prev : [...prev, ref]))
    // 引用卡如今住在探针页签的输入框上(预览拆了伴聊):闪一下那张页签,告诉用户挂哪儿了
    const probeGroup =
      groups.find((g) => g === activeGroup && g.tabs.some((t) => t.kind === 'chat' && !t.pinned)) ??
      groups.find((g) => g.tabs.some((t) => t.kind === 'chat' && !t.pinned))
    const probe = probeGroup?.tabs.find((t) => t.kind === 'chat' && !t.pinned)
    if (probe) markFlash(probe.id)
  }

  function removePreviewRef(index: number): void {
    setPreviewRefs((prev) => prev.filter((_, i) => i !== index))
  }

  // 拖文件进聊天挂引用(第一百二十五锤):读一份 → 按「整份引用」的账裁好 → 挂卡;
  // 文件夹和读不了的垫灰字指路,不装死。引用额度满了也照实说
  async function handleDropNode(kind: 'file' | 'folder', relPath: string): Promise<void> {
    if (!result || !folder) return
    if (kind === 'folder') {
      chat.note('文件夹挂不上引用——点它一下,就能给探针换参考资料')
      return
    }
    if (previewRefs.length >= CODE_REFS_MAX) {
      chat.note(`一轮最多引用 ${CODE_REFS_MAX} 段,想换新的先摘一段`)
      return
    }
    const f = findFile(result.tree, relPath)
    if (!f) return
    try {
      const res = await window.atlas.readPreview(folder, relPath)
      if (res.status !== 'ok') {
        chat.note(res.reason)
        return
      }
      const plan = planWholeFileRef({ text: res.text, refLimit: CODE_REFS_MAX, canAddRef: true })
      if (plan.code.trim() === '') {
        chat.note('这个文件是空的,挂了也没东西可讲')
        return
      }
      addPreviewRef({
        relPath: f.relPath,
        startLine: plan.startLine,
        endLine: plan.endLine,
        code: plan.code
      })
    } catch {
      chat.note('这个文件读不了(可能被系统占用),挂不上引用')
    }
  }

  return {
    previewRefs,
    setPreviewRefs,
    previewJump,
    fileLinks,
    addPreviewRef,
    removePreviewRef,
    handleDropNode
  }
}
