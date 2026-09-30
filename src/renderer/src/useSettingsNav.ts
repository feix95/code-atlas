// 设置导航的中枢(第二步 · Obsidian 式侧栏接管):单例签开关 + 分类跳转请求 +
// 「当前是不是设置模式」判定 + 收起态进出账,一扇门全走这里。
import { useEffect, useRef, useState } from 'react'
import { groupHost, MAIN_HOST, type PaneGroup } from './paneTabs'
import type { SectionKey } from './settingsNav'

export function useSettingsNav({
  activeGroup,
  openSingletonTab,
  sidebarCollapsed,
  toggleSidebarCollapsed
}: {
  /** 全局激活组(跨主窗/子窗唯一);它落在主窗且激活签是设置页才算设置模式 */
  activeGroup: PaneGroup | null
  openSingletonTab: (kind: 'settings' | 'graph' | 'overview' | 'chat') => void
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
}): {
  settingsMode: boolean
  /** 侧栏导航高亮哪页:openSettings 直接落账,设置页切页时也回报同一本 */
  settingsSection: SectionKey
  setSettingsSection: (key: SectionKey) => void
  /** 跳转请求:seq 每 +1 页内就滚一次到目标节(同节重复点也灵) */
  settingsReq: { section: SectionKey; seq: number } | undefined
  openSettings: (section?: SectionKey) => void
  openAiSettings: () => void
} {
  const [settingsReq, setSettingsReq] = useState<{ section: SectionKey; seq: number } | undefined>(
    undefined
  )
  // 侧栏导航亮哪节 = 这本;滚动间谍写它,侧栏点击走 settingsReq 发命令,两本账各管一头
  const [settingsSection, setSettingsSection] = useState<SectionKey>('appearance')

  // 「AI 设置」直达的翻页请求:每点一次入口 seq +1,设置页签照着切到指定页
  // (设置是单例页签,不是弹窗 —— 开在页签区里,没开工作区也能用)
  function openSettings(section: SectionKey = 'appearance'): void {
    openSingletonTab('settings')
    setSettingsSection(section)
    setSettingsReq((prev) => ({ section, seq: (prev?.seq ?? 0) + 1 }))
  }

  function openAiSettings(): void {
    openSettings('ai')
  }

  // 设置模式:全局激活组落在主窗、且它的激活签是设置页 → 侧栏换脸成设置导航。
  // 分屏下认全局激活组不认「某组里还开着设置」:点去别的组,侧栏就回文件树(跟着焦点走)
  const settingsMode =
    activeGroup !== null &&
    groupHost(activeGroup) === MAIN_HOST &&
    activeGroup.tabs.find((t) => t.id === activeGroup.activeId)?.kind === 'settings'

  // 进设置时侧栏收着就先掀开(藏着的导航等于没有),走时无条件还原进门前那一下的收起态
  const sidebarCollapsedOnEnter = useRef<boolean | null>(null)
  useEffect(() => {
    if (settingsMode) {
      if (sidebarCollapsedOnEnter.current === null) {
        sidebarCollapsedOnEnter.current = sidebarCollapsed
        if (sidebarCollapsed) toggleSidebarCollapsed()
      }
    } else if (sidebarCollapsedOnEnter.current !== null) {
      const wasCollapsed = sidebarCollapsedOnEnter.current
      sidebarCollapsedOnEnter.current = null
      if (wasCollapsed !== sidebarCollapsed) toggleSidebarCollapsed()
    }
  }, [settingsMode, sidebarCollapsed, toggleSidebarCollapsed])

  return {
    settingsMode,
    settingsSection,
    setSettingsSection,
    settingsReq,
    openSettings,
    openAiSettings
  }
}
