// 设置导航的共享户口(Obsidian 式侧栏接管):分类键与条目表收在这里,
// 侧栏(WorkspaceSidebar)和页面(SettingsPage)两边认同一本账。

export type SectionKey = 'appearance' | 'ai' | 'personal' | 'advanced'

export const NAV_ITEMS: Array<{ key: SectionKey; icon: string; name: string }> = [
  { key: 'appearance', icon: 'palette', name: '外观' },
  { key: 'personal', icon: 'sparkles', name: '个性化' },
  { key: 'ai', icon: 'bot', name: '智能辅助' },
  { key: 'advanced', icon: 'sliders', name: '高级选项' }
]

/** 侧栏设置导航的图标旋钮:条目共享一个大小,跟别处互不相关 */
export const NAV_ICON_SIZE = 18
