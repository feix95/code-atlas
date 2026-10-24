// 自测:纯函数全摊平 
// 跑法: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/selftest-vision.mts
// 覆盖:
// pickMmproj(ai/mmproj.ts)        —— 无/单个/多只候选、大小写、前缀并列、精度序、字母序
// parseLlamaPropsVision           —— /props 的 modalities.vision:true/false/缺字段/坏数据
// parseLmStudioModelVision        —— /api/v0/models 条目 type:vlm/llm/其他/查无此模
// cloudVisionOf(shared/visionModels.ts) —— 在线模型名正则表正反例
// sameModelStatus(shared/statusCompare.ts) —— vision 纳入去重比对
// 全内存断言,不碰盘不碰网,别让这条链变哑铃。

import assert from 'node:assert/strict'
import { pickMmproj, shouldRetryWithoutMmproj } from '../src/ai/mmproj.ts'
import { parseLlamaPropsVision, parseLmStudioModelVision } from '../src/ai/visionProbe.ts'
import { cloudVisionOf } from '../src/shared/visionModels.ts'
import { sameModelStatus } from '../src/shared/statusCompare.ts'
import type { ModelStatus } from '../src/shared/types.ts'

// pickMmproj 
const MODEL = 'X:/models/Qwen2-VL-7B-Q8_0.gguf'

// 零候选:没有 mmproj / 有 mmproj 但不是 .gguf / 只认文件名含 mmproj
assert.equal(pickMmproj(MODEL, []), null)
assert.equal(pickMmproj(MODEL, ['notes.txt', 'other-Q8_0.gguf']), null)
assert.equal(pickMmproj(MODEL, ['mmproj-readme.txt']), null)

// 单候选直接用
assert.equal(pickMmproj(MODEL, ['mmproj-model-f16.gguf', 'random.gguf']), 'mmproj-model-f16.gguf')

// 大小写不认账:.GGUF 与 MMPROJ 都中
assert.equal(pickMmproj(MODEL, ['MMProj-Model-F16.GGUF']), 'MMProj-Model-F16.GGUF')

// 多只候选:跟模型名公共前缀最长的赢(后缀式命名家门对得上,别家的 f16 也抢不走)
assert.equal(
  pickMmproj('X:/models/gemma-4-26b-a4b-it-qat-q4_0.gguf', [
    'mmproj-other-model-f16.gguf',
    'gemma-4-26b-a4b-mmproj-bf16.gguf'
  ]),
  'gemma-4-26b-a4b-mmproj-bf16.gguf'
)
// 前缀式命名(mmproj-xxx)跟模型名的公共前缀都是 0,落精度序:f16 压 bf16
assert.equal(
  pickMmproj('X:/models/gemma-4-26b-a4b-it-qat-q4_0.gguf', [
    'mmproj-other-model-f16.gguf',
    'mmproj-gemma-4-26b-a4b-it-qat-bf16.gguf'
  ]),
  'mmproj-other-model-f16.gguf'
)

// 前缀并列 → 精度 f16 > bf16 > f32 > 其他
assert.equal(pickMmproj(MODEL, ['mmproj-x-bf16.gguf', 'mmproj-x-f16.gguf']), 'mmproj-x-f16.gguf')
assert.equal(pickMmproj(MODEL, ['mmproj-x-f32.gguf', 'mmproj-x-bf16.gguf']), 'mmproj-x-bf16.gguf')
assert.equal(pickMmproj(MODEL, ['mmproj-x-q8.gguf', 'mmproj-x-f32.gguf']), 'mmproj-x-f32.gguf')
// bf16 名字里含子串 "f16" 也不能冒领 f16 的分
assert.equal(pickMmproj(MODEL, ['mmproj-x-bf16.gguf', 'mmproj-x-f32.gguf']), 'mmproj-x-bf16.gguf')

// 精度再并列 → 字母序
assert.equal(pickMmproj(MODEL, ['mmproj-x-b.gguf', 'mmproj-x-a.gguf']), 'mmproj-x-a.gguf')

// 歧义防线:多模型平铺目录 
// 单模型目录:一只 mmproj 名字再陌生也直接用(它就是这模型的眼睛)
assert.equal(
  pickMmproj('X:/models/minicpm-v-4_6-q8_0.gguf', [
    'minicpm-v-4_6-q8_0.gguf',
    'mmproj-model-f16.gguf'
  ]),
  'mmproj-model-f16.gguf'
)
// 多模型目录 + 别家 mmproj(名字零亲缘)→ null,宁可纯文本也不给引擎塞错眼睛
assert.equal(
  pickMmproj('X:/models/qwen2-vl-7b-instruct-q8_0.gguf', [
    'qwen2-vl-7b-instruct-q8_0.gguf',
    'llava-v1.5-7b-q4_k_m.gguf',
    'mmproj-llava-f16.gguf'
  ]),
  null
)
// 多模型目录 + 同家 mmproj:前缀式(mmproj-<模型名>-精度)认得出
assert.equal(
  pickMmproj('X:/models/qwen2-vl-7b-instruct-q8_0.gguf', [
    'qwen2-vl-7b-instruct-q8_0.gguf',
    'llava-v1.5-7b-q4_k_m.gguf',
    'mmproj-qwen2-vl-f16.gguf'
  ]),
  'mmproj-qwen2-vl-f16.gguf'
)
// 后缀式(<模型名>-mmproj-精度)也认得出
assert.equal(
  pickMmproj('X:/models/minicpm-v-4_6-q8_0.gguf', [
    'minicpm-v-4_6-q8_0.gguf',
    'ornith-9b-q8_0.gguf',
    'minicpm-v-4_6-mmproj-f16.gguf'
  ]),
  'minicpm-v-4_6-mmproj-f16.gguf'
)
// 多模型多 mmproj:只认自家那只,别家的排不进候选
assert.equal(
  pickMmproj('X:/models/gemma-4-26b-a4b-it-qat-q4_0.gguf', [
    'gemma-4-26b-a4b-it-qat-q4_0.gguf',
    'minicpm-v-4_6-q8_0.gguf',
    'mmproj-minicpm-v-f16.gguf',
    'mmproj-gemma-4-26b-a4b-it-qat-bf16.gguf'
  ]),
  'mmproj-gemma-4-26b-a4b-it-qat-bf16.gguf'
)
// 精度词不冒领家名:模型名里的 q8_0/q4_k_m 不算亲缘词
assert.equal(
  pickMmproj('X:/models/aaa-model-q8_0.gguf', [
    'aaa-model-q8_0.gguf',
    'bbb-model-q4_k_m.gguf',
    'mmproj-q4-k-m.gguf'
  ]),
  null
)

// 保险丝判定:该不该摘掉 mmproj 降级重拉 
// 带了投影仪 + 引擎自己退了 → 重拉一次
assert.equal(shouldRetryWithoutMmproj('D:/models/mmproj-f16.gguf', true), true)
// 没带投影仪的失败(模型坏/显存不够)→ 不重试,重拉也白搭
assert.equal(shouldRetryWithoutMmproj(null, true), false)
// 带了投影仪但不是退出型故障 → 不重试
assert.equal(shouldRetryWithoutMmproj('D:/models/mmproj-f16.gguf', false), false)
assert.equal(shouldRetryWithoutMmproj(null, false), false)

// parseLlamaPropsVision 
assert.equal(parseLlamaPropsVision({ modalities: { vision: true } }), 'vision')
assert.equal(parseLlamaPropsVision({ modalities: { vision: false } }), 'text-only')
// 字段缺失/类型不对/坏数据一律 unknown
assert.equal(parseLlamaPropsVision({ modalities: {} }), 'unknown')
assert.equal(parseLlamaPropsVision({}), 'unknown')
assert.equal(parseLlamaPropsVision(null), 'unknown')
assert.equal(parseLlamaPropsVision({ modalities: { vision: 'yes' } }), 'unknown')

// parseLmStudioModelVision 
const lmList = {
  data: [
    { id: 'minicpm-v', type: 'vlm', state: 'loaded' },
    { id: 'qwen-coder', type: 'llm', state: 'not-loaded' },
    { id: 'weird', type: 'embedding' }
  ]
}
assert.equal(parseLmStudioModelVision(lmList, 'minicpm-v'), 'vision')
assert.equal(parseLmStudioModelVision(lmList, 'qwen-coder'), 'text-only')
assert.equal(parseLmStudioModelVision(lmList, 'weird'), 'unknown')
assert.equal(parseLmStudioModelVision(lmList, '查无此模'), 'unknown')
assert.equal(parseLmStudioModelVision(null, 'minicpm-v'), 'unknown')
// 老版本回数组直给的形状也认
assert.equal(parseLmStudioModelVision([{ id: 'x', type: 'vlm' }], 'x'), 'vision')

// cloudVisionOf:在线 API 名字认账 
// 命中已知视觉系 → vision
for (const name of [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-5',
  'o4-mini',
  'chatgpt-4o-latest',
  'claude-3-5-sonnet-20241022',
  'claude-sonnet-4-20250514',
  'claude-opus-4-1',
  'claude-haiku-4-5',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'qwen-vl-max',
  'qwen2-vl-7b-instruct',
  'qwen2.5-vl-72b',
  'glm-4v',
  'glm-4v-plus',
  'grok-2-vision-1212',
  'grok-vision-beta',
  'grok-4',
  'llava-v1.6-34b',
  'pixtral-12b',
  'deepseek-vl2',
  'internvl3-78b'
]) {
  assert.equal(cloudVisionOf(name), 'vision', `${name} 应认出视觉`)
}
// 名单外一律 unknown —— 不冒充 text-only
for (const name of [
  '',
  '   ',
  'gpt-3.5-turbo',
  'deepseek-chat',
  'qwen2.5-coder-7b-instruct',
  'claude-2',
  'gemini-1.0-pro',
  'llama-3.1-70b',
  'mistral-7b-instruct',
  'some-random-model'
]) {
  assert.equal(cloudVisionOf(name), 'unknown', `${name} 不该冒认`)
}

// sameModelStatus:vision 纳入去重 
const base: ModelStatus = {
  provider: 'builtin',
  state: 'ready',
  modelName: 'x.gguf',
  sizeBytes: 1,
  progress: 100
}
// 能力变了必须广播:同一份状态 vision 不同 → 不同账
assert.equal(sameModelStatus(base, { ...base, vision: 'vision' }), false)
assert.equal(
  sameModelStatus({ ...base, vision: 'vision' }, { ...base, vision: 'text-only' }),
  false
)
// 缺省与 'unknown' 同义 —— 老账没这字段不该刷出新播报
assert.equal(sameModelStatus(base, { ...base, vision: 'unknown' }), true)
assert.equal(sameModelStatus(base, { ...base }), true)
assert.equal(sameModelStatus(null, base), false)

console.log('✅ 视觉能力批次自测全部通过')
