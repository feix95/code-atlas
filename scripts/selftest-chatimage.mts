// 自测:图片的估算/预算/能力闸/收编/消息装配/历史标记,一把全摁住。
// 跑法: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/selftest-chatimage.mts
// 样本字节全在内存里构造,仓库里不放任何二进制图片;不碰盘不碰网。
import assert from 'node:assert/strict'
import {
  CHAT_IMAGES_MAX,
  contentTextLen,
  estimateImageTokens,
  imageGate,
  planImageBudget,
  sanitizeChatImages,
  type ChatImage
} from '../src/shared/chatImage.ts'
import { buildFreeChatMessages } from '../src/ai/chat.ts'
import { collectHistoryRounds } from '../src/shared/chatHistory.ts'
import { IMAGE_PREVIEW_MAX_BYTES } from '../src/shared/preview.ts'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 造一张内存里的最小 PNG:签名 + IHDR 段头(指定宽高) */
function pngBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    ...PNG_SIG,
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR 段长 13
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    0x08,
    0x06,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00
  ])
}

/** 造一段内存里的最小 JPEG:SOI + APP0 + SOF0(指定宽高) + EOI */
function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...new Array(14).fill(0x00),
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    ...new Array(9).fill(0x00),
    0xff,
    0xd9
  ])
}

function toDataUrl(mime: 'image/png' | 'image/jpeg', bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}

function makeImage(
  name: string,
  mime: 'image/png' | 'image/jpeg',
  w: number,
  h: number
): ChatImage {
  const bytes = mime === 'image/png' ? pngBytes(w, h) : jpegBytes(w, h)
  return { id: `id-${name}`, name, mime, dataUrl: toDataUrl(mime, bytes), width: w, height: h }
}

// estimateImageTokens:28px 块口径,64 下限,宁高勿低
assert.equal(estimateImageTokens(128, 128), 64, '小图吃下限 64(5×5 块=25 < 64)')
assert.equal(estimateImageTokens(28, 28), 64, '一块图也是 64')
assert.equal(estimateImageTokens(1024, 768), 37 * 28, '1024×768 → 37×28=1036')
assert.equal(estimateImageTokens(1025, 768), 37 * 28, '多 1px 也多占一块(向上取整)')
assert.equal(estimateImageTokens(0, 0), 64, '坏尺寸按 1px 算,下限兜底')
assert.equal(estimateImageTokens(4096, 4096), 147 * 147, '4K 大图 21609 个块')

// imageGate:纯文本拦,视觉放,拿不准放行带提醒
assert.deepEqual(imageGate('text-only', 1), {
  allow: false,
  reason: '当前模型是纯文本模型,看不了图片'
})
assert.deepEqual(imageGate('vision', 3), { allow: true })
const unknownGate = imageGate('unknown', 1)
assert.equal(unknownGate.allow, true, 'unknown 放行')
assert.equal(unknownGate.hint, '没法确认这个模型能不能看图')
assert.deepEqual(imageGate(undefined, 1).allow, true, '没报能力 = unknown 口径')
assert.deepEqual(imageGate('text-only', 0), { allow: true }, '不带图不用过闸')

// planImageBudget:16K 上下文窗口(16384),人设+问题约 1000,回答预留 512
const CTX16K = { ctxTokens: 16384, replyTokens: 512, otherTokens: 1000 }

// 一张大图(4096²,原生约 21609):上限 min(8192, 14872)=8192,缩到能坐进 8192
{
  const plan = planImageBudget({ ...CTX16K, images: [{ width: 4096, height: 4096 }] })
  assert.ok(plan.ok, '一张大图在 16K 下坐得下')
  assert.equal(plan.items.length, 1)
  assert.ok(plan.items[0].tokens <= 8192, `估算 ${plan.items[0].tokens} 不超配额 8192`)
  assert.ok(Math.max(plan.items[0].width, plan.items[0].height) <= 4096, '只缩不放大')
  assert.ok(Math.max(plan.items[0].width, plan.items[0].height) >= 256, '不缩穿底线')
}

// 两张大图:各分一半(4096),都缩
{
  const plan = planImageBudget({
    ...CTX16K,
    images: [
      { width: 4096, height: 4096 },
      { width: 3000, height: 2000 }
    ]
  })
  assert.ok(plan.ok, '两张大图坐得下')
  const total = plan.items.reduce((s, it) => s + it.tokens, 0)
  assert.ok(total <= 8192, `总账 ${total} ≤ 8192`)
}

// 三张大图:各分 2730,都缩但保长边≥256
{
  const plan = planImageBudget({
    ...CTX16K,
    images: [
      { width: 4096, height: 4096 },
      { width: 4096, height: 4096 },
      { width: 2048, height: 2048 }
    ]
  })
  assert.ok(plan.ok, '三张大图坐得下')
  for (const it of plan.items) assert.ok(Math.max(it.width, it.height) >= 256, '长边保 256')
  const total = plan.items.reduce((s, it) => s + it.tokens, 0)
  assert.ok(total <= 8192, `总账 ${total} ≤ 8192`)
}

// 小图原样不动:512² 约 361,低于份子不动刀
{
  const plan = planImageBudget({ ...CTX16K, images: [{ width: 512, height: 512 }] })
  assert.ok(plan.ok)
  assert.deepEqual([plan.items[0].width, plan.items[0].height], [512, 512], '装得下的图一寸不缩')
}

// 极端:固定开销把上下文占满,连下限都装不下 → ok:false 说人话
{
  const full = planImageBudget({
    ctxTokens: 16384,
    replyTokens: 512,
    otherTokens: 16200,
    images: [{ width: 512, height: 512 }]
  })
  assert.equal(full.ok, false, '上下文已满直接拒,不静默丢图')
  if (!full.ok) assert.match(full.reason, /调大|裁小|配额/)
}
{
  const tight = planImageBudget({
    ctxTokens: 16384,
    replyTokens: 512,
    otherTokens: 15850, // 剩 22 个配额:连一张图 64 下限都装不下
    images: [{ width: 100, height: 100 }]
  })
  assert.equal(tight.ok, false, '22 个配额装不下一张图 → 拒')
}
// 空列表直接过
assert.deepEqual(planImageBudget({ ...CTX16K, images: [] }), { ok: true, items: [] })

// sanitizeChatImages:收编洗白
// 合法 PNG / JPEG
{
  const r = sanitizeChatImages([
    makeImage('a.png', 'image/png', 2, 3),
    makeImage('b.jpg', 'image/jpeg', 64, 32)
  ])
  assert.equal(r.images.length, 2, '合法的都收')
  assert.equal(r.rejected.length, 0)
  assert.equal(r.images[0].width, 2)
  assert.equal(r.images[0].height, 3)
  assert.equal(r.images[1].mime, 'image/jpeg')
}
// 声明 jpeg 装的却是 PNG:魔数对账,拒
{
  const r = sanitizeChatImages([
    { ...makeImage('fake.jpg', 'image/png', 2, 3), mime: 'image/jpeg' as const }
  ])
  assert.equal(r.images.length, 0, '魔数与声明不符 → 拒')
  assert.ok(r.rejected[0]?.includes('对不上') || r.rejected[0]?.includes('不一致'))
}
// GIF 冒充 PNG
{
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00])
  const r = sanitizeChatImages([
    { id: 'g', name: 'g.png', mime: 'image/png', dataUrl: toDataUrl('image/png', gif) }
  ])
  assert.equal(r.images.length, 0, 'GIF 字节不收')
  assert.ok(r.rejected.length > 0)
}
// WebP 声明成 jpeg 也一样拒
{
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  const r = sanitizeChatImages([
    { id: 'w', name: 'w.jpg', mime: 'image/jpeg', dataUrl: toDataUrl('image/jpeg', webp) }
  ])
  assert.equal(r.images.length, 0, 'WebP 不收')
}
// 超大:字节数超 IMAGE_PREVIEW_MAX_BYTES → 拒
{
  const big = new Uint8Array(IMAGE_PREVIEW_MAX_BYTES + 8)
  big.set(pngBytes(2, 3), 0)
  const r = sanitizeChatImages([
    { id: 'big', name: 'big.png', mime: 'image/png', dataUrl: toDataUrl('image/png', big) }
  ])
  assert.equal(r.images.length, 0, '超上限的图拒收')
  assert.match(r.rejected[0] ?? '', /太大/)
}
// 超数量:4 张只收前 3 张,多出的留理由
{
  const r = sanitizeChatImages([
    makeImage('1.png', 'image/png', 2, 3),
    makeImage('2.png', 'image/png', 2, 3),
    makeImage('3.png', 'image/png', 2, 3),
    makeImage('4.png', 'image/png', 2, 3)
  ])
  assert.equal(r.images.length, CHAT_IMAGES_MAX, '最多收 3 张')
  assert.match(r.rejected.join(''), /最多带 3 张/)
}
// 非 data URL(http 链接冒充)
{
  const r = sanitizeChatImages([
    { id: 'x', name: 'x.png', mime: 'image/png', dataUrl: 'https://example.com/x.png' }
  ])
  assert.equal(r.images.length, 0, '非 data URL 不收')
}
// 坏 base64(字符集过得了但 atob 炸)
{
  const r = sanitizeChatImages([
    { id: 'b', name: 'b.png', mime: 'image/png', dataUrl: 'data:image/png;base64,A' }
  ])
  assert.equal(r.images.length, 0, '坏 base64 不收')
}
// 声明 webp mime → 白名单外,拒
{
  const img = makeImage('w.webp', 'image/png', 2, 3)
  const r = sanitizeChatImages([{ ...img, mime: 'image/webp' }])
  assert.equal(r.images.length, 0, 'mime 白名单外不收')
}
// 非数组/空 → 空账,无抱怨
assert.deepEqual(sanitizeChatImages(undefined), { images: [], rejected: [] })
assert.deepEqual(sanitizeChatImages('str'), { images: [], rejected: [] })

// buildFreeChatMessages:无图 = 字符串(老路径零变化);有图 = 仅尾条多模态
const attachment = {
  targetType: 'file' as const,
  name: 'a.ts',
  relPath: 'src/a.ts',
  summary: 'a.ts 摘要',
  details: '文件内容细节'
}
const refs = [{ relPath: 'src/a.ts', startLine: 1, endLine: 5, code: 'const x = 1' }]

// 无图:内容还是字符串,和历史一个口径
{
  const msgs = buildFreeChatMessages(
    '人设',
    attachment,
    [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' }
    ],
    '现在的问题',
    null,
    [],
    'brief'
  )
  const tail = msgs[msgs.length - 1]
  assert.equal(typeof tail.content, 'string', '无图时 tail 仍是字符串')
  assert.ok((tail.content as string).includes('现在的问题'))
  for (const m of msgs)
    assert.equal(typeof m.content === 'string' || Array.isArray(m.content), true)
  assert.ok(
    msgs.every((m) => typeof m.content === 'string'),
    '全列表纯字符串'
  )
}

// 有图:仅尾条是数组,带文字段+图片段;历史仍是纯字符串
{
  const msgs = buildFreeChatMessages(
    '人设',
    attachment,
    [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' }
    ],
    '看看这个',
    null,
    [],
    'brief',
    undefined,
    [makeImage('p.png', 'image/png', 2, 3)]
  )
  const tail = msgs[msgs.length - 1]
  assert.ok(Array.isArray(tail.content), '带图时 tail 是分段数组')
  const parts = tail.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  assert.equal(parts[0].type, 'text')
  assert.ok(parts[0].text?.includes('看看这个'))
  assert.equal(parts[1].type, 'image_url')
  assert.ok(parts[1].image_url?.url.startsWith('data:image/png;base64,'), '图片段是 data URL')
  // 只有尾条多模态:其余全是字符串
  assert.ok(
    msgs.slice(0, -1).every((m) => typeof m.content === 'string'),
    '历史与附件仍是纯字符串'
  )
}

// 带图 + 摘要 + 引用 + 联网材料并存:尾条仍只有一条多模态
{
  const msgs = buildFreeChatMessages(
    '人设',
    attachment,
    [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' }
    ],
    '看看',
    { query: 'Q', material: '联网资料' },
    refs,
    'brief',
    '旧摘要',
    [makeImage('p.png', 'image/png', 2, 3), makeImage('q.jpg', 'image/jpeg', 64, 32)]
  )
  const tail = msgs[msgs.length - 1]
  assert.ok(Array.isArray(tail.content), '尾条多模态')
  const parts = tail.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  assert.equal(parts.filter((p) => p.type === 'image_url').length, 2, '两张图都挂上')
  assert.ok(parts[0].text?.includes('看看'))
  assert.ok(parts[0].text?.includes('联网资料'), '联网资料照常垫在文字段尾巴')
  // 摘要、引用、附件各自还是字符串消息
  const strCount = msgs.filter((m) => typeof m.content === 'string').length
  assert.ok(strCount >= 3, '附件/摘要/引用各自还在(字符串)')
}

// contentTextLen:字符串照字数,分段数文字段+图片占位字
assert.equal(contentTextLen('abc'), 3)
assert.equal(
  contentTextLen([
    { type: 'text', text: 'ab' },
    { type: 'image_url', image_url: { url: 'data:...' } }
  ]),
  2 + 4
)

// collectHistoryRounds:附图轮在历史里留一句话交代,图片本体不进
{
  const hist = collectHistoryRounds([
    { role: 'user', text: '这图什么色', images: [{}, {}], state: 'done' },
    { role: 'assistant', text: '红色', state: 'done' }
  ])
  assert.equal(hist.length, 2)
  assert.equal(hist[0].role, 'user')
  assert.ok(hist[0].content.includes('这图什么色'))
  assert.ok(hist[0].content.includes('(这一轮附了 2 张图片,图片本身不在当前上下文里)'))
  assert.ok(!hist[0].content.includes('data:'), '历史里不许出现 data URL')
}
// 只发图不发字的轮,历史里按标记句留下
{
  const hist = collectHistoryRounds([
    { role: 'user', text: '', images: [{}], state: 'done' },
    { role: 'assistant', text: '看到了', state: 'done' }
  ])
  assert.equal(hist.length, 2, '纯图轮也进历史')
  assert.equal(hist[0].content, '(这一轮附了 1 张图片,图片本身不在当前上下文里)')
}

console.log('✅ 自测全部通过')
