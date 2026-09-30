// 设置导航的共享户口(Obsidian 式侧栏接管):分类键与条目表收在这里,
// 侧栏(WorkspaceSidebar)和页面(SettingsPage)两边认同一本账。
// 左侧一项 = 右侧一整页(不滚动翻节):键同时是页键。

export type SectionKey = 'appearance' | 'ai' | 'net' | 'about'

export const NAV_ITEMS: Array<{ key: SectionKey; icon: string; name: string }> = [
  { key: 'appearance', icon: 'palette', name: '外观' },
  { key: 'ai', icon: 'bot', name: 'AI 设置' },
  { key: 'net', icon: 'shield', name: '联网与隐私' },
  { key: 'about', icon: 'info', name: '关于' }
]

/** 侧栏设置导航的图标旋钮:条目共享一个大小,跟别处互不相关 */
export const NAV_ICON_SIZE = 15
