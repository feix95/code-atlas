// 模型货架自测:清洗/判定/筛选/人话格式化,纯函数直跑。
// 「带不动」的阈值账在此固化:内存预算 = 总内存 × 0.7,贴线 70% 起算提醒。
import assert from 'node:assert/strict'
import {
  applyShelfQuery,
  formatDownloads,
  formatGgufSize,
  formatRelativeDays as rel,
  isChatCapable,
  judgeRun,
  modalityLabel,
  parseParamScale,
  parseQuantNote,
  runVerdictLabel,
  sanitizeRepoFiles,
  sanitizeShelfEntry,
  sanitizeShelfList,
  type ShelfEntry
} from '../src/shared/modelShelf.ts'

let passed = 0
const failed: string[] = []
function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed.push(name)
    console.log(`  ✗ ${name}`)
  }
}

const GB = 1024 ** 3

console.log('── 模态标签:多模态组合优先,认不出老实说「其他」──')
{
  ok(modalityLabel({ tags: ['gguf', 'text-generation'] }) === '文本', '纯文本模型 → 文本')
  ok(modalityLabel({ tags: ['image-text-to-text', 'text-generation'] }) === '文本+图像', '图文模型 → 文本+图像')
  ok(modalityLabel({ tags: ['audio-text-to-text'] }) === '文本+语音', '音文模型 → 文本+语音')
  ok(modalityLabel({ pipeline_tag: 'feature-extraction' }) === '向量(不适合聊天)', '嵌入模型 → 向量(明示不适合聊天)')
  ok(modalityLabel({ tags: ['gguf'] }) === '其他', '没线索 → 其他,不硬猜')
  ok(modalityLabel({ tags: '垃圾' }) === '其他', 'tags 不是数组 → 不炸,回其他')
}

console.log('── 参数量级:从仓库名解析最大的 N B,解析不出老实 null ──')
{
  ok(parseParamScale('mradermacher/Ornith-1.5-9B-uncensored-GGUF') === '9B', '1.5 不吃(B 只跟数字),取 9B')
  ok(parseParamScale('unsloth/Qwen3-4B-Instruct-GGUF') === '4B', '常见命名 → 4B')
  ok(parseParamScale('Qwen3.8-27B') === '27B', '多个数字取最大 → 27B')
  ok(parseParamScale('mixtral-8x7B-Instruct') === '56B', 'MoE 乘数 8x7B → 56B(算术事实)')
  ok(parseParamScale('zai-org/GLM-4.5-GGUF') === null, '名字没写参数 → null,不硬猜')
  ok(parseParamScale('model-4bit-tensor') === null, '4bit 是位宽不是参数,不吃')
  ok(parseParamScale('DeepSeek-R1-0528-GGUF') === null, '日期数字后没 B → null')
  ok(parseParamScale('') === null, '空串 → null')
}

console.log('── 量化等级:文件名解析 + 技术翻译,认不出 null ──')
{
  ok(parseQuantNote('Ornith-1.5-9B-uncensored.Q8_0.gguf') === '几乎无损', 'Q8_0 → 几乎无损')
  ok(parseQuantNote('Qwen3-Q4_K_M.gguf') === '大小和质量平衡的主流选择', 'Q4_K_M → 主流之选')
  ok(parseQuantNote('model-f16.gguf') === '全精度,质量不打折', 'f16 → 全精度')
  ok(parseQuantNote('BF16/model-00001-of-00002.gguf') === '全精度,质量不打折', 'BF16 → 全精度')
  ok(parseQuantNote('Qwen3-7B-Q6_K.gguf') === '接近无损', 'Q6_K → 接近无损')
  ok(parseQuantNote('Qwen3-7B-Q5_K_M.gguf') === '损失很小', 'Q5_K_M → 损失很小')
  ok(parseQuantNote('model-IQ4_XS.gguf') === '再小一号,质量略降', 'IQ4_XS → 再小一号')
  ok(parseQuantNote('model-IQ2_XS.gguf') === '体积很小,智力损失明显', 'IQ2_XS → 智力损失明显')
  ok(parseQuantNote('model-Q2_K.gguf') === '体积很小,智力损失明显', 'Q2_K → 智力损失明显')
  ok(parseQuantNote('model-Q3_K_M.gguf') === '体积小不少,智力开始掉', 'Q3_K_M → 智力开始掉')
  ok(parseQuantNote('9B-uncensored.gguf') === null, '9B 不是量化标记,不吃')
  ok(parseQuantNote('Qwen2.5-7B.gguf') === null, 'Qwen 的 Q 后面不是数字,不吃')
  ok(parseQuantNote('readme.md') === null, '非量化命名 → null')
  ok(parseQuantNote('model-Q9_custom.gguf') === null, '认不出的档位(Q9) → null,不硬猜')
}

console.log('── 货架准入:不是文本打底的一律过滤(2026-09-18 小葵定)──')
{
  ok(isChatCapable({ pipeline_tag: 'text-generation' }), '文本生成 → 上架')
  ok(isChatCapable({ pipeline_tag: 'image-text-to-text' }), '图文 → 上架(视觉是产品能力)')
  ok(isChatCapable({ tags: ['conversational'] }), '没标任务但带聊天模板 → 上架(HF 大量量化仓不标任务,别误杀)')
  ok(isChatCapable({ tags: ['text-generation'] }), '任务标签藏在 tags 里也算')
  ok(!isChatCapable({ pipeline_tag: 'feature-extraction' }), '向量检索 → 滤')
  ok(!isChatCapable({ pipeline_tag: 'audio-text-to-text' }), '语音模型 → 滤(产品只要文字/工具/视觉)')
  ok(!isChatCapable({ pipeline_tag: 'text-to-speech' }), 'TTS → 滤')
  ok(!isChatCapable({ pipeline_tag: 'image-to-video' }), '视频生成 → 滤')
  ok(!isChatCapable({}), '什么线索都没有 → 滤,不赌')
}

console.log('── 清洗:烂条目/不达标条目不进列表 ──')
{
  const good = sanitizeShelfEntry({
    id: 'unsloth/Qwen3-4B-GGUF',
    downloads: 12817609,
    likes: 1022,
    lastModified: '2026-01-30T06:29:38.000Z',
    pipeline_tag: 'image-text-to-text',
    tags: ['gguf', 'base_model:Qwen/Qwen3-4B', 'license:apache-2.0'],
    gguf: { total: 4.2 * GB }
  })
  ok(good !== null && good.ggufTotalBytes === 4.2 * GB && good.modalityLabel === '文本+图像', '合法条目各字段落位')
  ok(good?.paramScale === '4B' && good.likes === 1022, '参数量级与收藏就地洗好,渲染层直接用')
  ok(good?.baseModel === 'Qwen/Qwen3-4B' && good.license === 'apache-2.0', '底座/协议从 tags 捞出来,原样不加工')
  ok(
    sanitizeShelfEntry({ id: 'a/b', pipeline_tag: 'text-generation' })?.baseModel === null,
    '没标底座 → null(档案卡整格不显示)'
  )
  ok(sanitizeShelfEntry(null) === null, 'null → null')
  ok(sanitizeShelfEntry({ id: '' }) === null, '没名字 → null')
  ok(
    sanitizeShelfEntry({ id: 'a/b', pipeline_tag: 'text-generation', gguf: { total: '很大' } })?.ggufTotalBytes === null,
    '大小字段烂 → null(界面显示未知)'
  )
  ok(sanitizeShelfEntry({ id: 'a/b', pipeline_tag: 'feature-extraction' }) === null, '向量模型在清洗层就被滤,不进货架')
  ok(sanitizeShelfList('垃圾').length === 0, '响应不是数组 → 空列表')
  ok(sanitizeShelfList([{ id: 'a/b', tags: ['conversational'] }, '垃圾', null]).length === 1, '混着烂条目 → 只留干净那条')
}

console.log('── 带不动判定:内存预算 = 总内存 × 0.7,贴线提醒 ──')
{
  const spec16 = { ramBytes: 16 * GB, vramBytes: null }
  ok(judgeRun(4 * GB, spec16) === 'yes', '16G 内存跑 4G 模型 → 宽裕')
  ok(judgeRun(10 * GB, spec16) === 'tight', '16G 内存跑 10G 模型 → 贴线提醒(预算 11.2G,10G > 70%)')
  ok(judgeRun(12 * GB, spec16) === 'no', '16G 内存跑 12G 模型 → 带不动')
  ok(judgeRun(null, spec16) === 'yes', '大小未知 → 不拦,老实不拦')
  ok(judgeRun(4 * GB, { ramBytes: 0, vramBytes: null }) === 'yes', '内存拿不到 → 不拦')
  ok(runVerdictLabel('no') === '超出内存预算', 'no 的一句话(2026-09-18 小葵拍板专业简短风)')
  ok(runVerdictLabel('tight') === '接近内存预算', 'tight 的一句话,跟 no 对仗')
  ok(runVerdictLabel('yes') === '', 'yes 不带话,不啰嗦')
}

console.log('── 筛选与排序 ──')
{
  const mk = (id: string, gb: number, downloads: number, daysAgo: number): ShelfEntry => ({
    id,
    modalityLabel: '文本',
    ggufTotalBytes: gb * GB,
    downloads,
    likes: 0,
    lastModified: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    paramScale: null,
    baseModel: null,
    license: null
  })
  const entries = [mk('a/big', 40, 100, 1), mk('b/small', 4, 3000, 30), mk('c/mid', 8, 500, 10)]
  ok(applyShelfQuery(entries, { maxBytes: 16 * GB, sortBy: 'downloads', desc: true }).map((e) => e.id).join(','), '只留 ≤16G 的三条中的两条')
  assert.equal(applyShelfQuery(entries, { maxBytes: 16 * GB, sortBy: 'downloads', desc: true }).length, 2)
  assert.equal(applyShelfQuery(entries, { maxBytes: 16 * GB, sortBy: 'downloads', desc: true })[0].id, 'b/small')
  ok(applyShelfQuery(entries, { maxBytes: null, sortBy: 'downloads', desc: false })[0].id === 'a/big', '按下载量正序,最冷的排最前')
  ok(applyShelfQuery(entries, { maxBytes: null, sortBy: 'lastModified', desc: true })[0].id === 'a/big', '按时间倒序,最新的排最前')
  ok(applyShelfQuery(entries, { maxBytes: 1 * GB, sortBy: 'downloads', desc: true }).length === 0, '卡太死 → 空,界面有话接')
}

console.log('── 仓库文件清洗:只留 gguf,大小认 lfs ──')
{
  const files = sanitizeRepoFiles([
    { path: '.gitattributes' },
    { path: 'Q4/Qwen3-Q4_K_M.gguf', size: 2.4 * GB },
    { path: 'BF16/model-00001-of-00002.gguf', lfs: { size: 30 * GB } },
    { path: 'readme.md', size: 1024 }
  ])
  ok(files.length === 2, '非 gguf 全剔')
  ok(files[0]?.sizeBytes === 2.4 * GB, '直挂 size 的认到')
  ok(files[0]?.quantNote === '大小和质量平衡的主流选择', '文件名里的量化就地翻译')
  ok(files[1]?.sizeBytes === 30 * GB, 'lfs.size 的认到')
  ok(files[1]?.quantNote === '全精度,质量不打折', 'BF16 目录下的分卷也认出量化')
  ok(sanitizeRepoFiles(null).length === 0, '烂响应 → 空')
}

console.log('── 人话格式化 ──')
{
  ok(formatGgufSize(4.24 * GB) === '4.2 GB', '小数 GB 保留一位')
  ok(formatGgufSize(30.4 * GB) === '30 GB', '两位数 GB 取整,不虚张')
  ok(formatGgufSize(null) === '未知', '拿不到 → 未知')
  ok(formatDownloads(12817609) === '1281.8 万', '千万级 → 万')
  ok(formatDownloads(1234) === '1234', '小数字原样')
  ok(formatDownloads(234_500_000) === '2.3 亿', '亿级 → 亿')
  ok(rel('2026-01-30T06:29:38.000Z').endsWith('前'), 'ISO 时间 → N 天/个月前')
  ok(rel('垃圾') === '未知', '烂时间 → 未知')
  ok(rel(null) === '未知', '没时间 → 未知')
}

console.log(`\n${passed} 项通过,${failed.length} 项失败`)
if (failed.length > 0) {
  console.error('失败清单:', failed)
  process.exit(1)
}
