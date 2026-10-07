// 填表指令(第 14 节):生成一份给用户自有 AI agent 的说明书,让它从用户项目代码里
// 提取设计数值、写成 CodeAtlas 能直接导入的 design.json(DTCG + 出处扩展)。
// 纯文本生成,与导出包/导入器共用同一套变量名口径。
import { resolveValue } from './resolve.ts'
import type { UiFrameDoc } from './types.ts'

const KIND_HINT: Record<string, string> = {
  color: '颜色(给 hex 或 rgba 文本)',
  dimension: '尺寸(给数字,单位 px;rem 按根字号换算)',
  em: '倍数(给数字)',
  number: '数字',
  fontWeight: '字重(100~900 的数字)',
  fontFamily: '字体族(给字符串数组,按回退顺序)',
  shadow: '阴影(给 {offsetX,offsetY,blur,spread,color} 对象)',
  ref: '引用(给 {组.名} 形式的字符串)'
}

const DTCG_TYPE: Record<string, string> = {
  color: 'color',
  dimension: 'dimension',
  em: 'number',
  number: 'number',
  fontWeight: 'fontWeight',
  fontFamily: 'fontFamily',
  shadow: 'shadow',
  ref: 'dimension'
}

/** 把变量名折回 DTCG 分组路径:第一段为组,其余用点连接(token 名里的 - 保留) */
function dtcgPath(name: string): string {
  const i = name.indexOf('-')
  return i < 0 ? name : `${name.slice(0, i)}.${name.slice(i + 1)}`
}

/** 填表指令全文(第 14 节):用户整段复制给自己的 agent,产出 design.json 后回 CodeAtlas 导入 */
export function fillInInstruction(doc: UiFrameDoc): string {
  const groups = new Map<string, string[]>()
  for (const [name, def] of Object.entries(doc.tokens)) {
    const v = def.value.kind === 'ref' ? resolveValue(doc.tokens, name) : def.value
    const kind = v.kind
    const line = `  - \`${dtcgPath(name)}\`($type: ${DTCG_TYPE[kind] ?? 'other'})— ${KIND_HINT[kind] ?? kind}`
    const g = def.path[0] ?? name.split('-')[0]!
    groups.set(g, [...(groups.get(g) ?? []), line])
  }
  const checklist = [...groups.entries()]
    .map(([g, lines]) => `- **${g}** 组:\n${lines.join('\n')}`)
    .join('\n')

  return [
    '# 从现有 app 提取 UI 数值(CodeAtlas 填表指令)',
    '',
    '你在我的项目代码里读取界面数值,产出一份 `design.json`。规则如下,逐条遵守:',
    '',
    '## 1. 输出格式(DTCG token JSON + 出处扩展)',
    '',
    '- 用嵌套对象表达变量路径:`"color": {"primary": {...}}` 即变量 `color.primary`。',
    '- 每个变量是叶子对象,必须带 `$value` 与 `$type`。',
    '- `$type` 取值:`color` / `dimension` / `fontWeight` / `fontFamily` / `number` / `shadow`。',
    '- 颜色 `$value` 给对象:`{"colorSpace":"srgb","components":[r,g,b],"alpha":0~1,"hex":"#rrggbb"}`。',
    '- 尺寸 `$value` 给对象:`{"value": 数字, "unit": "px"}`(rem 先按根字号换算成 px)。',
    '- 字重给数字;字体族给字符串数组;阴影给 `{"offsetX":{"value":0,"unit":"px"},"offsetY":…,"blur":…,"spread":…,"color":{颜色对象}}`。',
    '- 引用别的变量时 `$value` 给字符串 `"{color.primary}"`。',
    '',
    '## 2. 出处(必填,防编造核对用)',
    '',
    '每个变量带上你读到它的位置,放在 `$extensions["com.codeatlas.uiframe"].source`:',
    '',
    '```json',
    '"color": {',
    '  "primary": {',
    '    "$type": "color",',
    '    "$value": {"colorSpace":"srgb","components":[0.145,0.388,0.922],"alpha":1,"hex":"#2563EB"},',
    '    "$extensions": {',
    '      "com.codeatlas.uiframe": {',
    '        "source": {"file":"src/theme.css","line":12,"value":"#2563EB","confidence":"实测"}',
    '      }',
    '    }',
    '  }',
    '}',
    '```',
    '',
    '- `file`:相对项目根的路径;`line`:1 起始行号;`value`:该行里的字面原文。',
    '- `confidence`:`实测`(代码里明确写了)或 `推算`(从类名/计算推出来)。',
    '- 找不到出处的数值宁可不填,也不要编造。',
    '',
    '## 3. 要填的变量清单',
    '',
    checklist,
    '',
    '## 4. 交付',
    '',
    '把结果写成 `design.json` 交还给我;回 CodeAtlas 的「导入 → DTCG / design.json 文件」即可套用到我的方案。',
    ''
  ].join('\n')
}
