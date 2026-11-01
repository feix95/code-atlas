// 标签颜色的记账规则:存档键与标签显示文本分开,首尾空白与大小写不另算一个标签。
export const TAG_COLOR_KEY = 'atlas.graph.tag-colors'

export function tagColorKey(tag: string): string {
  return tag.trim().toLowerCase()
}
