// 会话复现(Obsidian 式):开机把上次关门前的工作区+页签布局原样摆回;
// 账目(工作区/页签/选中)一变就防抖落账,关窗前再补一次同步写(防抖尾巴可能赶不上退出)。
// 存档读写与(反)序列化在 sessionState.ts,这里只管生命周期接线。
import { useEffect, useRef } from 'react'
import type { ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import { hydrateSession, loadSession, saveSession, serializeSession } from './sessionState'
import type { PaneGroup } from './paneTabs'
import { dirChainOf, findDir, findFile } from './scanTreeTools'

/**
 * 会话复现的进程级闸口:每开一次窗只还原一趟。
 * 闸口用模块级旗不用 ref —— StrictMode 双跑时 ref 是同一个,热更 remount 也会带着旧值,
 * 模块旗只在进程里活一次(HMR 重执行模块时自动归零,冷启动天然单次)
 */
let bootRestoreTried = false

export function useSessionRestore(deps: {
  folder: string | null
  groups: PaneGroup[]
  activeGroupId: string | null
  selectedFile: ScanFileNode | null
  selectedFolder: ScanDirNode | null
  setGroups: (groups: PaneGroup[]) => void
  setActiveGroupId: (id: string | null) => void
  setSelectedFile: (f: ScanFileNode | null) => void
  setSelectedFolder: (d: ScanDirNode | null) => void
  setRevealPaths: (paths: Set<string>) => void
  scanPath: (dir: string) => Promise<ScanResult | null>
}): void {
  const {
    folder,
    groups,
    activeGroupId,
    selectedFile,
    selectedFolder,
    setGroups,
    setActiveGroupId,
    setSelectedFile,
    setSelectedFolder,
    setRevealPaths,
    scanPath
  } = deps
  const sessionReady = useRef(false)

  useEffect(() => {
    // 整段挪进回调跑(setState 不许同步躺在 effect 体里);闸口也在回调里——
    // StrictMode 第一遍排的活会被清理撤掉,闸口闩在 effect 体里就把真上岗的第二遍也挡了
    const t = setTimeout(() => {
      if (bootRestoreTried) return
      bootRestoreTried = true
      const s = loadSession()
      const done = (): void => {
        sessionReady.current = true
      }
      if (!s) return done()
      if (!s.folder) {
        // 关机时停在首页:只有不挂工作区的签能回来(设置/图谱/peek 这些 app 级房间)
        const h = hydrateSession(s, null)
        if (h) {
          setGroups(h.groups)
          setActiveGroupId(h.activeGroupId)
        }
        return done()
      }
      void scanPath(s.folder).then((scanned) => {
        done()
        if (!scanned) return
        const h = hydrateSession(s, scanned.tree)
        if (!h) return
        setGroups(h.groups)
        setActiveGroupId(h.activeGroupId)
        // 上次选中的节点也照亮:选中状态+父链展开滚到可见,树回到离开时的样子
        if (s.sel) {
          const f = findFile(scanned.tree, s.sel)
          const d = f ? null : findDir(scanned.tree, s.sel)
          if (f) setSelectedFile(f)
          else if (d) setSelectedFolder(d)
          if (f || d) setRevealPaths(new Set(dirChainOf(scanned.tree, s.sel)))
        }
      })
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 开机单跑一次,deps 全是最新初值
  }, [])

  // 落账:工作区/页签/选中账一变就防抖写本机
  useEffect(() => {
    if (!sessionReady.current) return
    const t = setTimeout(() => {
      saveSession(
        serializeSession(
          folder,
          groups,
          activeGroupId,
          selectedFile?.relPath ?? selectedFolder?.relPath ?? null
        )
      )
    }, 400)
    return () => clearTimeout(t)
  }, [folder, groups, activeGroupId, selectedFile, selectedFolder])

  useEffect(() => {
    const flush = (): void => {
      if (!sessionReady.current) return
      saveSession(
        serializeSession(
          folder,
          groups,
          activeGroupId,
          selectedFile?.relPath ?? selectedFolder?.relPath ?? null
        )
      )
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [folder, groups, activeGroupId, selectedFile, selectedFolder])
}
