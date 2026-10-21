import assert from 'node:assert/strict'
import { TRANSLATE_LANGS, translateLang } from '../src/shared/translateLangs.ts'
import {
  titleLineOf,
  translateDocSystemPrompt,
  translateDocUserPrompt,
  translateSystemPrompt,
  translateTitleSystemPrompt,
  translateTitleUserPrompt,
  translateUserPrompt
} from '../src/shared/translatePrompt.ts'

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

// 内联标题:另开一份手册,不当文件路径,必须译
const titlePrompt = translateTitleSystemPrompt(zh)
assert.match(titlePrompt, /^<translation_task>/)
assert.match(titlePrompt, /<\/translation_task>$/)
assert.match(titlePrompt, /<target_language>Simplified Chinese<\/target_language>/)
assert.match(titlePrompt, /human-readable heading/i)
assert.match(titlePrompt, /not a file path/i)
assert.match(titlePrompt, /camelCase/i)
assert.equal(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(titlePrompt), false)
assert.equal(/you are/i.test(titlePrompt), false)
const titleUser = translateTitleUserPrompt('SKILL')
assert.match(titleUser, /^<source_title>\n/)
assert.match(titleUser, /<\/source_title>$/)
assert.ok(titleUser.includes('SKILL'))
assert.equal(titleLineOf('  「スキル」  \nnote'), 'スキル')
assert.equal(titleLineOf('"Guide"'), 'Guide')
assert.equal(titleLineOf('README'), 'README')
assert.equal(titleLineOf(''), '')

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

// 文档族入口:不设人设、不复用 source_markdown、rst 要保留标记
{
  const plain = translateDocSystemPrompt(zh, 'plaintext')
  const markup = translateDocSystemPrompt(zh, 'markup')
  assert.match(plain, /^<translation_task>/)
  assert.equal(/you are/i.test(plain), false)
  assert.equal(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(plain), false)
  assert.match(plain, /URLs, file paths, version numbers/i)
  assert.match(plain, /source_plaintext tags/)
  assert.equal(plain.includes('source_markdown'), false)
  assert.match(markup, /directives, roles, anchors/i)
  const user = translateDocUserPrompt('hello')
  assert.match(user, /^<source_plaintext>\n/)
  assert.match(user, /<\/source_plaintext>$/)
  assert.ok(user.includes('hello'))
}

console.log('translateprompt: 全部通过')
