// 个性化(说话方式)的自测(第一百一十三锤,一百一十八锤补改为「语气+自订指令」两件套):
// 拼出来的提示词要准,「默认即友善」的口径要钉死。纯函数,不碰配置读写也不碰界面。
import assert from 'node:assert/strict'
import {
  buildPersonalizationPrompt,
  CUSTOM_MAX,
  DEFAULT_PERSONALIZATION,
  HONESTY_TAIL,
  sanitizePersonalization,
  TONE_OPTIONS,
  withPersonalization
} from '../src/shared/personalization.ts'
import type { PersonalizationConfig } from '../src/shared/personalization.ts'

/** 在默认基础上改几项,省得每次写全 */
function withPatch(patch: Partial<PersonalizationConfig>): PersonalizationConfig {
  return { ...DEFAULT_PERSONALIZATION, ...patch }
}

function main(): void {
  // ── 1. 默认即友善:语气没有空档,拼出来永远带基调 ──
  assert.ok(buildPersonalizationPrompt(DEFAULT_PERSONALIZATION).includes('温暖'), '默认就是友善档:全默认也要带友善的人设')
  assert.equal(withPersonalization('人设在此', ''), '人设在此', '没有风格段时人设逐字不变')
  assert.ok(!withPersonalization('人设在此', '').includes(HONESTY_TAIL), '没个性化就不该多一句铁律尾')

  // ── 2. 语气:三档人设各说各的话,互不串味 ──
  for (const opt of TONE_OPTIONS) {
    const text = buildPersonalizationPrompt(withPatch({ tone: opt.key }))
    assert.ok(text.includes('【这个用户偏好的说话方式】'), `语气「${opt.label}」要成段`)
  }
  const friendly = buildPersonalizationPrompt(withPatch({ tone: 'friendly' }))
  assert.ok(friendly.includes('温暖'), '友善要有对应的说法')
  assert.ok(!friendly.includes('专业导师'), '选了友善就不该同时冒出专业那句')
  const professional = buildPersonalizationPrompt(withPatch({ tone: 'professional' }))
  assert.ok(professional.includes('专业导师'), '专业要有对应的说法')
  const humorous = buildPersonalizationPrompt(withPatch({ tone: 'humorous' }))
  assert.ok(humorous.includes('活人感'), '幽默档要有对应的说法(小葵的新版人设)')
  assert.ok(!humorous.includes('专业导师'), '选了幽默就不该同时冒出专业那句')

  // ── 3. 自订指令:裁空白、空白等于没写、超长裁到上限 ──
  assert.equal(
    buildPersonalizationPrompt(withPatch({ custom: '   ' })),
    buildPersonalizationPrompt(DEFAULT_PERSONALIZATION),
    '只写空白等于没写(剩下的就是基调那段)'
  )
  const custom = buildPersonalizationPrompt(withPatch({ custom: '  叫我小葵,你可以自称哥  ' }))
  assert.ok(custom.includes('叫我小葵,你可以自称哥'), '自订指令要原样进去')
  assert.ok(!custom.includes('  叫我小葵'), '首尾空白要裁掉')
  const longCustom = buildPersonalizationPrompt(withPatch({ custom: '很'.repeat(CUSTOM_MAX + 300) }))
  assert.ok(longCustom.includes('很'.repeat(CUSTOM_MAX)), '该收的字一个不少')
  assert.ok(!longCustom.includes('很'.repeat(CUSTOM_MAX + 1)), '超长的部分要裁掉')

  // ── 4. 顺序就是优先级:人设 → 风格 → 铁律尾(自订指令也在铁律尾前面)──
  const styled = withPersonalization('人设在此', buildPersonalizationPrompt(withPatch({ tone: 'friendly', custom: '叫我小葵' })))
  assert.ok(styled.startsWith('人设在此'), '人设永远在最前面')
  assert.ok(styled.indexOf('温暖') < styled.indexOf('叫我小葵'), '语气排在自订指令之前')
  assert.ok(styled.indexOf('叫我小葵') < styled.indexOf(HONESTY_TAIL), '铁律尾排在自订指令之后 —— 顺序就是优先级')
  assert.ok(HONESTY_TAIL.includes('不改事实') && HONESTY_TAIL.includes('不许编造'), '铁律尾必须点到「不改事实」和「不许编造」')

  // ── 5. 读档清洗:脏数据一律回默认 ──
  assert.deepEqual(sanitizePersonalization(null), DEFAULT_PERSONALIZATION, 'null 回默认')
  assert.deepEqual(sanitizePersonalization('乱传的'), DEFAULT_PERSONALIZATION, '字符串回默认')
  assert.deepEqual(sanitizePersonalization([1, 2]), DEFAULT_PERSONALIZATION, '数组回默认')
  assert.deepEqual(sanitizePersonalization({ tone: '暴躁', warmth: 'MORE' }), DEFAULT_PERSONALIZATION, '认不出的键值回默认')
  const mixed = sanitizePersonalization({ tone: 'humorous', warmth: 'more', custom: '  x  ', 乱七八糟: true })
  assert.equal(mixed.tone, 'humorous', '认得出的语气留着')
  assert.equal(sanitizePersonalization({ tone: 'direct' }).tone, 'friendly', '下架的旧语气回默认档(现在是友善)')
  assert.equal(mixed.custom, 'x', '自订指令裁空白')
  assert.equal('warmth' in mixed, false, '下架的特质键不许混进配置')
  assert.ok(!('乱七八糟' in mixed), '多出来的键不许混进配置')

  // ── 6. 界面按这张表排控件:数量变了说明有人动过,提醒一句 ──
  assert.equal(TONE_OPTIONS.length, 3, '语气三档(小葵定的三档人设,没有默认档)')
  for (const t of TONE_OPTIONS) assert.ok(t.label && t.hint, '每档都要有档名和介绍(参考图的两行式)')

  console.log('✅ 个性化自测全部通过')
  console.log('   默认即友善 · 语气三档人设 · 自订指令裁长 · 顺序即优先级 · 脏存档清洗')
}

main()
