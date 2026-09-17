// 模型货架自测:清洗/判定/筛选/人话格式化,纯函数直跑。
// 「带不动」的阈值账在此固化:内存预算 = 总内存 × 0.7,贴线 70% 起算提醒。
import assert from 'node:assert/strict'
import {
  applyShelfQuery,
  formatDownloads,
  formatGgufSize,
  formatRelativeDays as rel,
  judgeRun,
  modalityKind,
  modalityLabel,
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

console.log('── 模态图标档位:界面能力章按它画,判定只认 label 那句话 ──')
{
  ok(modalityKind('文本') === 'text', '纯文本 → text(灰文档章)')
  ok(modalityKind('文本+图像') === 'vision', '图文 → vision(amber 眼)')
  ok(modalityKind('文本+语音') === 'audio', '音文 → audio(green 音符)')
  ok(modalityKind('文本+图像+语音') === 'vision-audio', '图音文全都要 → 双章齐亮')
  ok(modalityKind('向量(不适合聊天)') === 'embed', '向量 → embed(灰数据库章)')
  ok(modalityKind('其他') === 'other', '其他 → other(灰问号章)')
  ok(modalityKind('天书') === 'other', '认不出的标签 → other,不硬猜')
}

console.log('── 清洗:烂条目不进列表 ──')
{
  const good = sanitizeShelfEntry({
    id: 'unsloth/Qwen3-4B-GGUF',
    downloads: 12817609,
    likes: 1022,
    lastModified: '2026-01-30T06:29:38.000Z',
    pipeline_tag: 'text-generation',
    gguf: { total: 4.2 * GB }
  })
  ok(good !== null && good.ggufTotalBytes === 4.2 * GB && good.modalityLabel === '文本', '合法条目各字段落位')
  ok(sanitizeShelfEntry(null) === null, 'null → null')
  ok(sanitizeShelfEntry({ id: '' }) === null, '没名字 → null')
  ok(sanitizeShelfEntry({ id: 'a/b', gguf: { total: '很大' } })?.ggufTotalBytes === null, '大小字段烂 → null(界面显示未知)')
  ok(sanitizeShelfList('垃圾').length === 0, '响应不是数组 → 空列表')
  ok(sanitizeShelfList([{ id: 'a/b' }, '垃圾', null]).length === 1, '混着烂条目 → 只留干净那条')
}

console.log('── 带不动判定:内存预算 = 总内存 × 0.7,贴线提醒 ──')
{
  const spec16 = { ramBytes: 16 * GB, vramBytes: null }
  ok(judgeRun(4 * GB, spec16) === 'yes', '16G 内存跑 4G 模型 → 宽裕')
  ok(judgeRun(10 * GB, spec16) === 'tight', '16G 内存跑 10G 模型 → 贴线提醒(预算 11.2G,10G > 70%)')
  ok(judgeRun(12 * GB, spec16) === 'no', '16G 内存跑 12G 模型 → 带不动')
  ok(judgeRun(null, spec16) === 'yes', '大小未知 → 不拦,老实不拦')
  ok(judgeRun(4 * GB, { ramBytes: 0, vramBytes: null }) === 'yes', '内存拿不到 → 不拦')
  ok(runVerdictLabel('no') === '你这机器带不动', 'no 的一句话')
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
    lastModified: new Date(Date.now() - daysAgo * 86_400_000).toISOString()
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
  ok(files[1]?.sizeBytes === 30 * GB, 'lfs.size 的认到')
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
