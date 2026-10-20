import assert from 'node:assert/strict'
import { TRANSLATE_LANGS, translateLang } from '../src/shared/translateLangs.ts'
import { translateSystemPrompt, translateUserPrompt } from '../src/shared/translatePrompt.ts'

const zh = translateLang('zh-CN')
assert.ok(zh)
const prompt = translateSystemPrompt(zh)

// XML 根与分级:任务 → 规则 / 输出格式
assert.match(prompt, /^<translation_task>/)
assert.match(prompt, /<\/translation_task>$/)
assert.match(prompt, /<target_language>Simplified Chinese<\/target_language>/)
assert.match(prompt, /<rules>[\s\S]*<rule id="1">[\s\S]*<\/rules>/)
assert.match(prompt, /<output_format>[\s\S]*<requirement>[\s\S]*<\/output_format>/)

// 纯英文:提示词里不出现中日韩文字(语言名也走英文名)
assert.equal(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(prompt), false)

// 不设人设:不出现 "you are" 这类身份句
assert.equal(/you are/i.test(prompt), false)

// 关键口径都在:引号示例要翻、括号禁令、代码不动、frontmatter 只翻值
assert.match(prompt, /quoted example strings/i)
assert.match(prompt, /Quoted interface copy/i)
assert.match(prompt, /Never add parentheses/i)
assert.match(prompt, /code blocks, inline code/i)
assert.match(prompt, /YAML frontmatter/i)
assert.match(prompt, /source_markdown tags/i)

// user 消息只包一层来源标签,正文原样
const body = '# Title\n\n"Email must include @"'
const user = translateUserPrompt(body)
assert.match(user, /^<source_markdown>\n/)
assert.match(user, /<\/source_markdown>$/)
assert.ok(user.includes(body))

// 八种语种都用纯英文语言名,且互不相同
assert.equal(TRANSLATE_LANGS.length, 8)
assert.equal(new Set(TRANSLATE_LANGS.map((l) => l.enName)).size, 8)
assert.ok(TRANSLATE_LANGS.every((l) => /^[A-Za-z ]+$/.test(l.enName)))
assert.equal(
  translateSystemPrompt(TRANSLATE_LANGS[0]).includes(
    '<target_language>Simplified Chinese</target_language>'
  ),
  true
)

console.log('translateprompt: 全部通过')
