// 个性化(说话方式)的自测(第一百一十三锤):拼出来的提示词要准,「全默认零改动」的承诺要钉死。
// 纯函数,不碰配置读写也不碰界面 —— 跑起来就是几行字符串的事。
import assert from 'node:assert/strict'
import {
  buildPersonalizationPrompt,
  CUSTOM_MAX,
  DEFAULT_PERSONALIZATION,
  HONESTY_TAIL,
  LEVEL_OPTIONS,
  sanitizePersonalization,
  TONE_OPTIONS,
  TRAITS,
  withPersonalization
} from '../src/shared/personalization.ts'
import type { PersonalizationConfig } from '../src/shared/personalization.ts'

/** 在默认基础上改几项,省得每次写全 */
function withPatch(patch: Partial<PersonalizationConfig>): PersonalizationConfig {
  return { ...DEFAULT_PERSONALIZATION, ...patch }
}

function main(): void {
  // ── 1. 全默认 = 一个字都不加(老用户升级后行为不变的保证)──
  assert.equal(buildPersonalizationPrompt(DEFAULT_PERSONALIZATION), '', '全默认拼出来是空串')
  assert.equal(withPersonalization('人设在此', ''), '人设在此', '没有风格段时人设逐字不变')
  assert.ok(!withPersonalization('人设在此', '').includes(HONESTY_TAIL), '没个性化就不该多一句铁律尾')

  // ── 2. 语气:选了才出,不选不出 ──
  for (const opt of TONE_OPTIONS) {
    const text = buildPersonalizationPrompt(withPatch({ tone: opt.key }))
    if (opt.key === 'default') assert.equal(text, '', `语气「${opt.label}」不该加任何字`)
    else assert.ok(text.includes('【这个用户偏好的说话方式】'), `语气「${opt.label}」要成段`)
  }
  const friendly = buildPersonalizationPrompt(withPatch({ tone: 'friendly' }))
  assert.ok(friendly.includes('随和'), '友善要有对应的说法')
  assert.ok(!friendly.includes('不寒暄'), '选了友善就不该同时冒出专业那句')

  // ── 3. 四个特质:每档都认,默认档不出声 ──
  for (const trait of TRAITS) {
    assert.equal(buildPersonalizationPrompt(withPatch({ [trait.key]: 'default' })), '', `特质「${trait.label}」默认档不该加字`)
    const more = buildPersonalizationPrompt(withPatch({ [trait.key]: 'more' }))
    const less = buildPersonalizationPrompt(withPatch({ [trait.key]: 'less' }))
    assert.ok(more.length > 0, `特质「${trait.label}」更多档要有说法`)
    assert.ok(less.length > 0, `特质「${trait.label}」更少档要有说法`)
    assert.notEqual(more, less, `特质「${trait.label}」两档说法不能一样`)
  }
  // 产品决定钉在这条断言上:「标题和列表」调小不许把名词小课堂一起掐掉(那是学习功能,不是排版花活)
  assert.ok(
    buildPersonalizationPrompt(withPatch({ structure: 'less' })).includes('名词小课堂'),
    '「标题和列表」更少时必须写明名词小课堂照旧保留'
  )
  assert.ok(buildPersonalizationPrompt(withPatch({ emoji: 'less' })).includes('不要用表情符号'), '表情更少就是不许用')
  assert.ok(buildPersonalizationPrompt(withPatch({ emoji: 'more' })).includes('表情符号'), '表情更多要放开口子')

  // ── 4. 自订指令:裁空白、空白等于没写、超长裁到上限 ──
  assert.equal(buildPersonalizationPrompt(withPatch({ custom: '   ' })), '', '只写空白等于没写')
  const custom = buildPersonalizationPrompt(withPatch({ custom: '  叫我小葵,你可以自称哥  ' }))
  assert.ok(custom.includes('叫我小葵,你可以自称哥'), '自订指令要原样进去')
  assert.ok(!custom.includes('  叫我小葵'), '首尾空白要裁掉')
  const longCustom = buildPersonalizationPrompt(withPatch({ custom: '很'.repeat(CUSTOM_MAX + 300) }))
  assert.ok(longCustom.includes('很'.repeat(CUSTOM_MAX)), '该收的字一个不少')
  assert.ok(!longCustom.includes('很'.repeat(CUSTOM_MAX + 1)), '超长的部分要裁掉')

  // ── 5. 顺序就是优先级:人设 → 风格 → 铁律尾(自订指令也在铁律尾前面)──
  const styled = withPersonalization('人设在此', buildPersonalizationPrompt(withPatch({ tone: 'friendly', custom: '叫我小葵' })))
  assert.ok(styled.startsWith('人设在此'), '人设永远在最前面')
  assert.ok(styled.indexOf('随和') < styled.indexOf('叫我小葵'), '语气排在自订指令之前')
  assert.ok(styled.indexOf('叫我小葵') < styled.indexOf(HONESTY_TAIL), '铁律尾排在自订指令之后 —— 顺序就是优先级')
  assert.ok(HONESTY_TAIL.includes('不改事实') && HONESTY_TAIL.includes('不许编造'), '铁律尾必须点到「不改事实」和「不许编造」')

  // ── 6. 读档清洗:脏数据一律回默认 ──
  assert.deepEqual(sanitizePersonalization(null), DEFAULT_PERSONALIZATION, 'null 回默认')
  assert.deepEqual(sanitizePersonalization('乱传的'), DEFAULT_PERSONALIZATION, '字符串回默认')
  assert.deepEqual(sanitizePersonalization([1, 2]), DEFAULT_PERSONALIZATION, '数组回默认')
  assert.deepEqual(sanitizePersonalization({ tone: '暴躁', warmth: 'MORE' }), DEFAULT_PERSONALIZATION, '认不出的键值回默认')
  const mixed = sanitizePersonalization({ tone: 'direct', structure: 'less', custom: '  x  ', 乱七八糟: true })
  assert.equal(mixed.tone, 'direct', '认得出的语气留着')
  assert.equal(mixed.structure, 'less', '认得出的档位留着')
  assert.equal(mixed.custom, 'x', '自订指令裁空白')
  assert.equal(mixed.warmth, 'default', '没提到的项保持默认')
  assert.ok(!('乱七八糟' in mixed), '多出来的键不许混进配置')

  // ── 7. 界面按这几张表排控件:数量变了说明有人动过,提醒一句 ──
  assert.equal(TONE_OPTIONS.length, 5, '语气五个选项')
  assert.equal(LEVEL_OPTIONS.length, 3, '档位三个(更少/默认/更多)')
  assert.deepEqual(
    LEVEL_OPTIONS.map((o) => o.label),
    ['更少', '默认', '更多'],
    '档位顺序照界面习惯排'
  )
  assert.equal(TRAITS.length, 4, '四个特质')
  assert.equal(new Set(TRAITS.map((t) => t.key)).size, 4, '特质键不许重复')
  for (const t of TRAITS) assert.ok(t.label && t.hint, `特质「${t.key}」的标签和说明都要有`)

  console.log('✅ 个性化自测全部通过')
  console.log('   全默认零改动 · 语气五档 · 特质四档(名词小课堂不被排版档掐掉) · 自订指令裁长 · 顺序即优先级 · 脏存档清洗')
}

main()
