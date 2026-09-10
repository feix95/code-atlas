// 代码预览取数规矩的自测(第一百一十锤):裁剪账目要准,界面上说的话才不撒谎。
// 纯函数,不碰任何系统东西 —— 跑起来就是几行字符串的事。
import assert from 'node:assert/strict'
import { clipPreview, looksBinary, PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from '../src/shared/preview.ts'
import { clampButtonX, refButtonLabel, selectionGeometry } from '../src/renderer/src/selectionMarks.ts'

function main(): void {
  // ── 1. 正常文本:账目老实 ──
  const plain = clipPreview('a\nb\nc')
  assert.equal(plain.text, 'a\nb\nc', '没超上限就原样给')
  assert.equal(plain.totalLines, 3, '三行')
  assert.equal(plain.truncated, false, '没裁就别喊狼来了')

  // 结尾的换行符造出来的空尾巴不算一行(不然「共 N 行」会多报一行)
  const trailing = clipPreview('a\nb\n')
  assert.equal(trailing.totalLines, 2, '结尾换行不算新的一行')

  // ── 2. 换行符归一:CRLF / 裸 CR 都收成 LF,界面上不留半个回车 ──
  assert.equal(clipPreview('a\r\nb').text, 'a\nb', 'CRLF 归一成 LF')
  assert.equal(clipPreview('a\rb').text, 'a\nb', '老 Mac 的裸 CR 也归一')
  assert.equal(clipPreview('a\r\nb').totalLines, 2, '归一只影响显示,行数照实')

  // ── 3. 空文件:零行零字,不是一行空 ──
  const empty = clipPreview('')
  assert.equal(empty.totalLines, 0, '空文件没有行')
  assert.equal(empty.truncated, false, '空文件不算截断')

  // ── 4. 行数触顶:只给前一段,如实标截断,总行数照实报 ──
  const long = clipPreview(['1', '2', '3', '4', '5'].join('\n'), 3)
  assert.equal(long.text, '1\n2\n3', '只留前三行')
  assert.equal(long.totalLines, 5, '总行数照实报,界面才对得上「共 N 行」')
  assert.equal(long.truncated, true, '裁了就标截断')

  // ── 5. 字数触顶:单行超长(压缩过的 js / 一行几千字的 md)走第二道闸 ──
  const wide = clipPreview('x'.repeat(500), 2000, 100)
  assert.equal(wide.text.length, 100, '字数闸生效')
  assert.equal(wide.truncated, true, '字数闸裁了也要标截断')
  assert.equal(wide.totalLines, 1, '一行还是那一行')

  // 字数正好卡在上限:不算截断(边界不许误报)
  assert.equal(clipPreview('x'.repeat(100), 2000, 100).truncated, false, '刚好到上限不算裁')

  // ── 6. 默认上限:常量本身不能是离谱的数 ──
  assert.ok(PREVIEW_MAX_LINES >= 500 && PREVIEW_MAX_LINES <= 5000, '默认行数上限在合理区间')
  assert.ok(PREVIEW_MAX_CHARS >= 20_000, '默认字数上限够看懂一段真代码')

  // ── 7. 二进制嗅探:有 NUL 字节就不是文本 ──
  assert.equal(looksBinary(new Uint8Array([0x61, 0x62, 0x63])), false, '纯 ASCII 不是二进制')
  assert.equal(looksBinary(new TextEncoder().encode('中文也照样是文本')), false, 'UTF-8 中文不是二进制')
  assert.equal(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), true, 'PNG 头里的 NUL 抓得住')
  assert.equal(looksBinary(new Uint8Array([])), false, '空的一段不冤枉')

  // ── 8. 选区几何(第一百一十四锤):首尾标记、左缘竖线、浮钮锚点 ──
  assert.equal(selectionGeometry([]), null, '一行都没有就不画标记')
  const oneLine = selectionGeometry([{ left: 40, top: 100, right: 180, bottom: 118 }])
  assert.ok(oneLine, '单行选区要算得出来')
  assert.equal(oneLine?.startX, 40, '首标记在第一行左缘')
  assert.equal(oneLine?.endX, 180, '末标记在最后一行右缘')
  assert.equal(oneLine?.startY, 109, '首标记垂直居中于那一行')
  assert.equal(oneLine?.barHeight, 18, '只有一行时竖线就是那一行的高度')
  assert.equal(oneLine?.buttonX, 180, '单行时浮钮锚在行右缘')
  const threeLines = selectionGeometry([
    { left: 40, top: 100, right: 300, bottom: 118 },
    { left: 40, top: 118, right: 260, bottom: 136 },
    { left: 40, top: 136, right: 120, bottom: 154 }
  ])
  assert.equal(threeLines?.startX, 40, '多行:首标记看第一行')
  assert.equal(threeLines?.endX, 120, '多行:末标记看最后一行 —— 不是包围盒的右边')
  assert.equal(threeLines?.barHeight, 54, '竖线从第一行顶贯到最后一行底')
  assert.equal(threeLines?.buttonX, 120, '浮钮锚在最后一行右上,不飘到整块中间')
  assert.equal(threeLines?.buttonY, 136, '浮钮跟着最后一行')
  // 竖线最短也得看得见(空行也可能是 0 高)
  assert.equal(selectionGeometry([{ left: 0, top: 50, right: 10, bottom: 50 }])?.barHeight, 2, '零高选区竖线给最小可见高度')

  // ── 9. 浮钮文案(第一百一十四锤):额度满了说额度,选太长了照实说会截断 ──
  const base = { canAddRef: true, refLimit: 6, charCap: 2000, startLine: 1, endLine: 20, charCount: 300 }
  assert.equal(refButtonLabel(base), '引用到对话(第 1-20 行)', '正常选区就报行号')
  assert.equal(refButtonLabel({ ...base, canAddRef: false }), '最多引用 6 段', '额度满了直说')
  const tooLong = refButtonLabel({ ...base, charCount: 2001 })
  assert.ok(tooLong.includes('太长') && tooLong.includes('2000'), '选太长要说清只会带前 2000 字,不许装看不见')
  assert.equal(refButtonLabel({ ...base, charCount: 2000 }), '引用到对话(第 1-20 行)', '刚好到上限不算太长')

  // ── 10. 浮钮横向夹紧(第一百一十四锤):贴着栏边的选区,别让钮跨到隔壁去 ──
  assert.equal(clampButtonX(500, 0, 600), 500, '在中间就照原样')
  assert.equal(clampButtonX(20, 0, 600), 90, '太靠左拉回来')
  assert.equal(clampButtonX(590, 0, 600), 510, '太靠右拉回来')
  assert.equal(clampButtonX(10, 0, 100), 50, '栏太窄就居中,别把钮挤没')

  console.log('✅ 代码预览自测全部通过')
  console.log('   裁剪账目(行数/字数双闸/总行数照实) · 换行归一 · 空文件 · 边界不误报 · 二进制嗅探 · 选区几何与浮钮文案')
}

main()
