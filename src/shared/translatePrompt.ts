/** 翻译专用提示词:纯英文 XML 执行手册,不设人设,只给规则与输出格式。
 *
 * 为什么用 XML:小模型容易把「提示词里的说明」和「要翻译的正文」搅在一起;
 * 用带层级的标签把任务、规则、输出格式分开,再把待翻文本包进 <source_markdown>,
 * 模型照着结构干活,不会把指令当正文复述。
 */
import type { TranslateLang } from './translateLangs'

export function translateSystemPrompt(lang: TranslateLang): string {
  return [
    '<translation_task>',
    `  <target_language>${lang.enName}</target_language>`,
    '  <objective>Translate the Markdown block in the user message into the target language.</objective>',
    '  <rules>',
    '    <rule id="1">Translate all natural language: headings, paragraphs, list items, table cells, blockquotes, and quoted example strings. Quoted interface copy and example sentences are content, not code; translate them and keep the quotation marks.</rule>',
    '    <rule id="2">Preserve Markdown structure exactly: heading marks, list markers and indentation, blockquote marks, table pipes and separator rows, emphasis marks, link and image syntax.</rule>',
    '    <rule id="3">Do not translate or modify code blocks, inline code, file paths, commands, URLs, identifiers, variable names, or version numbers.</rule>',
    '    <rule id="4">Do not add, remove, summarize, or expand content. Never add parentheses, annotations, alternative terms, or explanations that are absent from the source; if the source has no parentheses, the output must contain none.</rule>',
    '    <rule id="5">Use standard technical terminology. Keep product names, protocol names, and API names in their original form, without parenthetical glosses.</rule>',
    '    <rule id="6">If the block is YAML frontmatter between --- lines, translate only the values; keep keys, indentation, quotes, and --- markers unchanged.</rule>',
    '  </rules>',
    '  <output_format>',
    '    <requirement>Return only the translated Markdown block.</requirement>',
    '    <requirement>Do not wrap the whole answer in a code fence.</requirement>',
    '    <requirement>Do not output source_markdown tags or any XML tag from these instructions.</requirement>',
    '    <requirement>Do not add explanations, prefaces, notes, or labels.</requirement>',
    '  </output_format>',
    '</translation_task>'
  ].join('\n')
}

/** 待翻块原样进 user 角色,只加一层来源标签;外面不写任何指令,避免模型照着复述 */
export function translateUserPrompt(text: string): string {
  return `<source_markdown>\n${text}\n</source_markdown>`
}
