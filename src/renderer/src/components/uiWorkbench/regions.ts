// UI 工作台版式分区(对照 Figma UI3):还没放工具的区域,占位提示的名字与用途说明只在这里登记。
// 区域放进工具后,对应条目随占位一起退役。
export type WorkbenchRegionKey = 'sidebar' | 'toolbar'

export interface WorkbenchRegion {
  name: string
  hint: string
}

export const WORKBENCH_REGIONS: Record<WorkbenchRegionKey, WorkbenchRegion> = {
  sidebar: { name: '左侧栏', hint: '图层、组件、变量、AI 对话' },
  toolbar: { name: '工具栏', hint: '积木与画布工具' }
}
