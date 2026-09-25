// 「这台电脑」下钻浏览的账本(UI v3 §7.1):盘符为根、一层层懒加载的轻树。
// 手势规格【给定】:单击目录 = 原地展开/收起(没探过的先去主进程列一层),
// 双击目录 = 打开为工作区,单击文件 = 开「瞄一眼」预览页签 —— 后两个动作
// 不在本钩子,由组件把节点报给 App 层(开工作区走 scanPath,预览走 peek 页签)。
// 浏览树只活在这份 state 里:不是工作区、不进导航账、不写盘,随手逛不留痕。
import { useState } from 'react'
import type { BrowseEntry, DriveInfo } from '@shared/types'
import { cleanErrMsg } from './errText'

export interface BrowseDir {
  type: 'directory'
  name: string
  /** 相对盘根的路径('/' 分隔;盘根本身 = ''):peek 页签的 relPath,也是树的唯一定位键 */
  relPath: string
  /** 主进程回传的绝对路径:往更深列一层/打开为工作区都原样回传,不手拼 */
  absPath: string
  open: boolean
  /** 正在列这一层(图标位转圈) */
  loading: boolean
  /** 这层打不开的人话(权限/路径没了):挂在行的次文位照实说,不是应用级错误 */
  error: string | null
  /** null = 还没探过这层;空数组 = 探过了,这层是空的 */
  children: BrowseNode[] | null
}

export interface BrowseFile {
  type: 'file'
  name: string
  relPath: string
  absPath: string
}

export type BrowseNode = BrowseDir | BrowseFile

function freshRoot(d: DriveInfo): BrowseDir {
  return {
    type: 'directory',
    name: `${d.letter}:\\`,
    relPath: '',
    absPath: d.root,
    open: false,
    loading: false,
    error: null,
    children: null
  }
}

/** 在浏览树里按 relPath 找目录(树内唯一键;文件不进查找目标 —— 文件不开孩子) */
function findDir(tree: BrowseDir, relPath: string): BrowseDir | null {
  if (tree.relPath === relPath) return tree
  for (const c of tree.children ?? []) {
    if (c.type !== 'directory') continue
    const hit = findDir(c, relPath)
    if (hit) return hit
  }
  return null
}

/** 不可变修树:找到 relPath 那个目录换成 patch 的结果,其他枝原样引用 */
function patchDir(dir: BrowseDir, relPath: string, patch: (d: BrowseDir) => BrowseDir): BrowseDir {
  if (dir.relPath === relPath) return patch(dir)
  if (!dir.children) return dir
  return {
    ...dir,
    children: dir.children.map((c) => (c.type === 'directory' ? patchDir(c, relPath, patch) : c))
  }
}

export function useDriveBrowser(): {
  /** key = 盘根路径;没点过的盘还没树,渲染侧用 freshRoot 兜底画行 */
  trees: Record<string, BrowseDir>
  /** 单击目录行:已探过 = 开合;没探过 = 列一层再张开 */
  toggleDir: (d: DriveInfo, relPath: string) => Promise<void>
} {
  const [trees, setTrees] = useState<Record<string, BrowseDir>>({})

  function patch(root: string, relPath: string, p: (d: BrowseDir) => BrowseDir): void {
    setTrees((prev) => {
      const tree = prev[root]
      if (!tree) return prev
      return { ...prev, [root]: patchDir(tree, relPath, p) }
    })
  }

  async function toggleDir(d: DriveInfo, relPath: string): Promise<void> {
    // 盘上第一次点:先立根账,再按行走
    if (!trees[d.root]) {
      setTrees((prev) => (prev[d.root] ? prev : { ...prev, [d.root]: freshRoot(d) }))
    }
    const tree = trees[d.root] ?? freshRoot(d)
    const target = findDir(tree, relPath)
    if (!target) return
    if (target.children !== null) {
      patch(d.root, relPath, (x) => ({ ...x, open: !x.open }))
      return
    }
    if (target.loading) return
    patch(d.root, relPath, (x) => ({ ...x, loading: true, error: null }))
    try {
      const entries: BrowseEntry[] = await window.atlas.browseDir(target.absPath)
      const children: BrowseNode[] = entries.map((e): BrowseNode => {
        const rel = target.relPath === '' ? e.name : `${target.relPath}/${e.name}`
        return e.dir
          ? {
              type: 'directory',
              name: e.name,
              relPath: rel,
              absPath: e.absPath,
              open: false,
              loading: false,
              error: null,
              children: null
            }
          : { type: 'file', name: e.name, relPath: rel, absPath: e.absPath }
      })
      patch(d.root, relPath, (x) => ({ ...x, loading: false, open: true, children }))
    } catch (err) {
      patch(d.root, relPath, (x) => ({ ...x, loading: false, error: cleanErrMsg(err) }))
    }
  }

  return { trees, toggleDir }
}
