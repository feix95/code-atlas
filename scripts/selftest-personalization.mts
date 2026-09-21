// 个性化(说话方式)的自测(第一百一十三锤,一百一十八锤补改为「语气+自订指令」两件套):
// 拼出来的提示词要准,「默认档不垫语气」的口径要钉死。纯函数,不碰配置读写也不碰界面。
import assert from 'node:assert/strict'
import {
  buildPersonalizationPrompt,
  CUSTOM_MAX,
  DEFAULT_PERSONALIZATION,
  sanitizePersonalization,
  TEACHING_OPTIONS,
  TONE_OPTIONS,
  withPersonalization
} from '../src/shared/personalization.ts'
import type { PersonalizationConfig } from '../src/shared/personalization.ts'

/** 在默认基础上改几项,省得每次写全 */
function withPatch(patch: Partial<PersonalizationConfig>): PersonalizationConfig {
  return { ...DEFAULT_PERSONALIZATION, ...patch }
}

function main(): void {
  // ── 1. 默认档不垫语气(第一百五十一锤小葵定):全默认时风格段是空串,人设一字不加 ──
  assert.equal(buildPersonalizationPrompt(DEFAULT_PERSONALIZATION), '', '全默认 = 空风格段:不垫语气人设,模型原汁原味')
  assert.equal(withPersonalization('人设在此', ''), '人设在此', '没有风格段时人设逐字不变')
  const defaultWithCustom = buildPersonalizationPrompt(withPatch({ custom: '叫我小葵' }))
  assert.ok(defaultWithCustom.includes('叫我小葵'), '默认语气 + 自订指令:风格段照常成段')
  assert.ok(defaultWithCustom.includes('<style_preference>') && defaultWithCustom.includes('<custom_request>'), '风格段和自订指令都要包 XML 标签(2.0)')
  assert.ok(!defaultWithCustom.includes('温暖'), '默认档不该漏出任何语气人设句')

  // ── 2. 语气:默认档空着,三档人设各说各的话,互不串味 ──
  for (const opt of TONE_OPTIONS) {
    const text = buildPersonalizationPrompt(withPatch({ tone: opt.key }))
    if (opt.key === 'default') assert.equal(text, '', '默认档 = 不垫语气')
    else assert.ok(text.includes('<style_preference>'), `语气「${opt.label}」要成段(2.0 起包 style_preference 标签)`)
  }
  // 语气三档的新稿(提示词体系重写第二批,逐字稿 J):各认各的招牌词,互不串味
  const friendly = buildPersonalizationPrompt(withPatch({ tone: 'friendly' }))
  assert.ok(friendly.includes('好朋友'), '友善档要像跟好朋友聊天')
  assert.ok(!friendly.includes('沉稳克制'), '选了友善就不该同时冒出专业那句')
  const professional = buildPersonalizationPrompt(withPatch({ tone: 'professional' }))
  assert.ok(professional.includes('沉稳克制'), '专业档要沉稳克制')
  assert.ok(!professional.includes('好朋友'), '选了专业就不该同时冒出友善那句')
  const humorous = buildPersonalizationPrompt(withPatch({ tone: 'humorous' }))
  assert.ok(humorous.includes('大白话'), '幽默档要爱说大白话')
  assert.ok(!humorous.includes('沉稳克制'), '选了幽默就不该同时冒出专业那句')

  // ── 3. 自订指令:裁空白、空白等于没写、超长裁到上限 ──
  assert.equal(
    buildPersonalizationPrompt(withPatch({ custom: '   ' })),
    buildPersonalizationPrompt(DEFAULT_PERSONALIZATION),
    '只写空白等于没写(剩下的就是默认那段)'
  )
  const custom = buildPersonalizationPrompt(withPatch({ custom: '  叫我小葵,你可以自称哥  ' }))
  assert.ok(custom.includes('叫我小葵,你可以自称哥'), '自订指令要原样进去')
  assert.ok(!custom.includes('  叫我小葵'), '首尾空白要裁掉')
  const longCustom = buildPersonalizationPrompt(withPatch({ custom: '很'.repeat(CUSTOM_MAX + 300) }))
  assert.ok(longCustom.includes('很'.repeat(CUSTOM_MAX)), '该收的字一个不少')
  assert.ok(!longCustom.includes('很'.repeat(CUSTOM_MAX + 1)), '超长的部分要裁掉')

  // ── 4. 顺序就是结构:人设 → 风格段(<style_preference> 里语气在前、自订指令在后、收尾划线)──
  // 2.0 换了内核:旧铁律尾引用的「不编造/不假装干过活」已不在内核,尾巴整个删掉;
  // 风格段收尾改垫一句「以上只改你说话的方式」,把自订指令的权力圈回说话方式上
  const styled = withPersonalization('人设在此', buildPersonalizationPrompt(withPatch({ tone: 'friendly', custom: '叫我小葵' })))
  assert.ok(styled.startsWith('人设在此'), '人设永远在最前面')
  assert.ok(styled.indexOf('温暖') < styled.indexOf('叫我小葵'), '语气排在自订指令之前')
  assert.ok(styled.indexOf('<custom_request>') < styled.indexOf('以上只改你说话的方式'), '自订指令之后要跟收尾划线')
  assert.ok(styled.endsWith('</style_preference>'), '风格段闭合标签收尾')
  assert.ok(!styled.includes('«') && !styled.includes('»'), '旧的 «» 包裹不许残留(2.0 全换 XML)')

  // 风格段和讲法是两路(提示词体系重写第二批):讲解深度不住进风格段 ——
  // 教学切片在 prompts.ts,换 teaching 不该往 withPersonalization 的输出里漏教学文本
  const deepStyled = withPersonalization('人设在此', buildPersonalizationPrompt(withPatch({ teaching: 'deep' })))
  assert.ok(!deepStyled.includes('<teaching_style>') && !deepStyled.includes('名词小课堂'), 'teaching 非 brief 时风格段也不掺教学文本')

  // ── 5. 读档清洗:脏数据一律回默认 ──
  assert.deepEqual(sanitizePersonalization(null), DEFAULT_PERSONALIZATION, 'null 回默认')
  assert.deepEqual(sanitizePersonalization('乱传的'), DEFAULT_PERSONALIZATION, '字符串回默认')
  assert.deepEqual(sanitizePersonalization([1, 2]), DEFAULT_PERSONALIZATION, '数组回默认')
  assert.deepEqual(sanitizePersonalization({ tone: '暴躁', warmth: 'MORE' }), DEFAULT_PERSONALIZATION, '认不出的键值回默认')
  const mixed = sanitizePersonalization({ tone: 'humorous', warmth: 'more', custom: '  x  ', 乱七八糟: true })
  assert.equal(mixed.tone, 'humorous', '认得出的语气留着')
  assert.equal(sanitizePersonalization({ tone: 'direct' }).tone, 'default', '下架的旧语气回默认档')
  assert.equal(mixed.custom, 'x', '自订指令裁空白')
  assert.equal('warmth' in mixed, false, '下架的特质键不许混进配置')
  assert.ok(!('乱七八糟' in mixed), '多出来的键不许混进配置')

  // ── 6. 讲解深度(教学三档):默认精简,脏值回默认,三档都认 ──
  assert.equal(DEFAULT_PERSONALIZATION.teaching, 'brief', '讲解深度默认「精简」(老用户升上来行为不变)')
  assert.equal(sanitizePersonalization({}).teaching, 'brief', '存档没写过这个字段 → 默认精简')
  assert.equal(sanitizePersonalization({ teaching: '啰嗦' }).teaching, 'brief', '认不出的深度回默认')
  assert.equal(sanitizePersonalization({ teaching: 42 }).teaching, 'brief', '非字符串的深度回默认')
  for (const opt of TEACHING_OPTIONS) {
    assert.equal(sanitizePersonalization({ teaching: opt.key }).teaching, opt.key, `深度「${opt.key}」要认得`)
  }
  assert.equal(sanitizePersonalization({ teaching: 'deep' }).teaching, 'deep', '详细档存读一个来回不丢')
  // 教学切片的提示词文本住 ai/prompts.ts(第二批),不进 buildPersonalizationPrompt —— 风格段照旧不掺教学
  assert.equal(
    buildPersonalizationPrompt(withPatch({ teaching: 'deep' })),
    buildPersonalizationPrompt(withPatch({ teaching: 'off' })),
    '讲解深度不拼进风格段:三档拼出来的风格段要一模一样'
  )

  // ── 7. 界面按这张表排控件:数量变了说明有人动过,提醒一句 ──
  assert.equal(TONE_OPTIONS.length, 4, '语气四档(默认 + 小葵定的三档人设)')
  for (const t of TONE_OPTIONS) assert.ok(t.label && t.hint, '每档都要有档名和介绍(参考图的两行式)')
  assert.equal(TEACHING_OPTIONS.length, 3, '讲解深度三档(简洁/精简/详细)')
  for (const t of TEACHING_OPTIONS) assert.ok(t.label && t.hint, '每档都要有档名和介绍(参考图的两行式)')

  console.log('✅ 个性化自测全部通过')
  console.log('   默认档不垫语气 · 语气三档人设 · 讲解深度三档 · 自订指令裁长 · 顺序即优先级 · 脏存档清洗')
}

main()
