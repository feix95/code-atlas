// 后退/前进(第八十三锤):浏览过的位置串成一条线,游标挪到哪站就把界面摆回哪站。
// 跳转要调动扫描/选中/页签三路兵马 —— 那些都在调用方手里,经 deps 递进来。
import { useRef, useState } from 'react'
import type { ScanDirNode, ScanFileNode, ScanResult } from '@shared/types'
import { pushNavLocation, stepNavIndex, type NavLocation } from './navHistory'
import { findDir, findFile } from './scanTreeTools'

export function useNavStack(deps: {
  folder: string | null
  result: ScanResult | null
  scanning: boolean
  scanPath: (dir: string) => Promise<ScanResult | null>
  goHome: () => void
  followFile: (file: ScanFileNode) => Promise<void>
  followDir: (node: ScanDirNode) => void
  clearSelection: () => void
}) {
  const { folder, result, scanning, scanPath, goHome, followFile, followDir, clearSelection } = deps

  // 后退/前进(第八十三锤):浏览过的位置(首页/项目/选中的文件文件夹)串成一条线,按钮挪游标
  const [nav, setNav] = useState<{ stack: NavLocation[]; index: number }>(() => ({
    stack: [{ folder: null, file: null, dir: null }],
    index: 0
  }))
  // 后退/前进跳转途中记录器闭嘴:恢复旧位置引发的一串选中不许再记新账
  const navTravelingRef = useRef(false)

  // 记一站(第八十三锤):开项目/选文件/选文件夹/回家时喊一声;后退前进途中有铃铛拦着,自动闭嘴
  function pushNav(loc: NavLocation): void {
    if (navTravelingRef.current) return
    setNav((prev) => pushNavLocation(prev.stack, prev.index, loc))
  }

  // 后退/前进本体:游标挪一步,再按那站的样子把界面摆回去 —— 换项目就重扫,还在本项目就恢复选中
  async function goNav(delta: number): Promise<void> {
    if (navTravelingRef.current || scanning) return
    const target = stepNavIndex(nav.index, delta, nav.stack.length)
    if (target === nav.index) return
    navTravelingRef.current = true
    try {
      const loc = nav.stack[target]
      if (!loc.folder) {
        goHome()
      } else if (loc.folder !== folder) {
        applyNavSelection(await scanPath(loc.folder), loc)
      } else {
        applyNavSelection(result, loc)
      }
      setNav((prev) => ({ ...prev, index: target }))
    } finally {
      navTravelingRef.current = false
    }
  }

  // 把某一站的样子摆回界面:文件还在树上就选中,节点没了(重扫过)就老实清空选中
  function applyNavSelection(scanned: ScanResult | null, loc: NavLocation): void {
    if (!scanned) return
    if (loc.file) {
      const f = findFile(scanned.tree, loc.file)
      if (f) {
        followFile(f)
        return
      }
    }
    if (loc.dir) {
      const d = findDir(scanned.tree, loc.dir)
      if (d) {
        followDir(d)
        return
      }
    }
    clearSelection()
  }

  return { nav, pushNav, goNav }
}
