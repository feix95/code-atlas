// 会话复现(Obsidian 式):关机前的工作区 + 页签布局(组分屏/激活签/钉住脸)记进本机,
// 下次开 app 原样摆回。存 localStorage —— 和 recents/layoutPrefs 一个户口。
// 序列化/解析/水合全是纯函数(自测好喂);存档垃圾整条扔,绝不炸启动。
// 不存的:对话内容(纯内存账,钉住的探针签复活成空场)、settingsReq 这类一次性请求。
import { readPref, writePref } from '../../shared/localPrefs.ts'
import type { ScanDirNode } from '@shared/types'
import { findDir, findFile } from './scanTreeTools.ts'
import { nextTabId, type PaneGroup, type PaneTab } from './paneTabs.ts'
import { KIND_ICONS, KIND_LABELS, type PaneKind } from './paneKinds.ts'

const SESSION_KEY = 'atlas.session'

const KNOWN_KINDS: readonly PaneKind[] = [
  'overview',
  'chat',
  'preview',
  'graph',
  'settings',
  'peek'
]

/** 存档里的一张页签:字段名照抄 PaneTab;on = 这组正亮着的那张(用标记不用序号,掉签后不错位) */
export interface SessionTab {
  kind: PaneKind
  relPath: string
  name: string
  icon: string
  pinned: boolean
  scopeRoot?: string
  on?: boolean
}

export interface SessionGroupState {
  tabs: SessionTab[]
  on?: boolean // 激活组标记:掉组后照样指得准
}

export interface SessionState {
  v: 1
  /** 上次开着的工作区根;null = 关机时停在首页 */
  folder: string | null
  /** 最后选中的节点 relPath;null = 没选过 */
  sel: string | null
  groups: SessionGroupState[]
}

// ── 写账 ──

/** 把活账本压成存档(纯函数):激活签/激活组换成 on 标记 —— 还原时有签掉了也不指错 */
export function serializeSession(
  folder: string | null,
  groups: PaneGroup[],
  activeGroupId: string | null,
  sel: string | null
): SessionState {
  return {
    v: 1,
    folder,
    sel,
    groups: groups.map((g) => ({
      on: g.id === activeGroupId ? true : undefined,
      tabs: g.tabs.map((t) => ({
        kind: t.kind,
        relPath: t.relPath,
        name: t.name,
        icon: t.icon,
        pinned: t.pinned,
        scopeRoot: t.scopeRoot,
        on: t.id === g.activeId ? true : undefined
      }))
    }))
  }
}

// ── 读账 ──

function parseTab(raw: unknown): SessionTab | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (typeof t['kind'] !== 'string' || !(KNOWN_KINDS as string[]).includes(t['kind'])) return null
  const kind = t['kind'] as PaneKind
  const relPath = typeof t['relPath'] === 'string' ? t['relPath'] : ''
  // 钉住的签存固化门面;跟随签存的是品类名牌,坏了也能回名牌兜底
  const name = typeof t['name'] === 'string' && t['name'] !== '' ? t['name'] : KIND_LABELS[kind]
  const icon = typeof t['icon'] === 'string' && t['icon'] !== '' ? t['icon'] : KIND_ICONS[kind]
  return {
    kind,
    relPath,
    name,
    icon,
    pinned: t['pinned'] === true,
    scopeRoot:
      typeof t['scopeRoot'] === 'string' && t['scopeRoot'] !== '' ? t['scopeRoot'] : undefined,
    on: t['on'] === true ? true : undefined
  }
}

/** 存档 → 干净账(纯函数,自测覆盖):垃圾条目整条扔,一版以外的存档当没存过 */
export function parseSession(raw: unknown): SessionState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (s['v'] !== 1) return null
  const folder = typeof s['folder'] === 'string' && s['folder'] !== '' ? s['folder'] : null
  const sel = typeof s['sel'] === 'string' && s['sel'] !== '' ? s['sel'] : null
  const groups: SessionGroupState[] = []
  if (Array.isArray(s['groups'])) {
    for (const g of s['groups']) {
      if (g === null || typeof g !== 'object' || Array.isArray(g)) continue
      const gg = g as Record<string, unknown>
      if (!Array.isArray(gg['tabs'])) continue
      const tabs = gg['tabs'].map(parseTab).filter((t): t is SessionTab => t !== null)
      if (tabs.length === 0) continue
      groups.push({ tabs, on: gg['on'] === true ? true : undefined })
    }
  }
  return { v: 1, folder, sel, groups }
}

export function loadSession(): SessionState | null {
  return parseSession(readPref<unknown>(SESSION_KEY, null))
}

export function saveSession(s: SessionState): void {
  writePref(SESSION_KEY, s)
}

// ── 水合:存档 → 活账本 ──

/**
 * 存档 → 页签组(纯函数):id 换新发号;relPath 指向工作区的签要验货 ——
 * 节点在新树上还活着才还原,死签(文件被删了)直接扔;掉光的组也扔。
 * tree = null(没工作区)时只有不挂节点的签能活(设置/图谱这类 app 级房间 + peek)。
 * 全扔完了回 null —— 调用方让默认页签接管,不硬摆空场。
 */
export function hydrateSession(
  s: SessionState,
  tree: ScanDirNode | null
): { groups: PaneGroup[]; activeGroupId: string | null } | null {
  const groups: PaneGroup[] = []
  let activeGroupId: string | null = null
  for (const sg of s.groups) {
    const live = sg.tabs.filter(
      (t) =>
        t.relPath === '' ||
        t.scopeRoot !== undefined || // peek 的读根是盘符,不归工作区树验
        (tree !== null && (findFile(tree, t.relPath) !== null || findDir(tree, t.relPath) !== null))
    )
    if (live.length === 0) continue
    const tabs: PaneTab[] = live.map((t) => ({
      id: nextTabId(),
      kind: t.kind,
      relPath: t.relPath,
      name: t.name,
      icon: t.icon,
      pinned: t.pinned,
      scopeRoot: t.scopeRoot
    }))
    const onIdx = live.findIndex((t) => t.on)
    const group: PaneGroup = {
      id: `pane:${nextTabId()}`,
      tabs,
      activeId: (onIdx >= 0 ? tabs[onIdx] : tabs[tabs.length - 1]).id
    }
    groups.push(group)
    if (sg.on) activeGroupId = group.id
  }
  if (groups.length === 0) return null
  return { groups, activeGroupId: activeGroupId ?? groups[0].id }
}
