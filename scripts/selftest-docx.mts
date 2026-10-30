// Word 预览自测:后缀名单、zip 目录账、门禁(改名冒充/坏包/解压炸弹/超大)、
// mammoth 转换(标题/表格/图片落临时文件换令牌地址)、链接与图片的消毒把关。
// 后台线程、任务调度、图片登记处另见 selftest-docxjobs。
// 样本 .docx 全在内存里拼(scripts/docx-fixture.mts),仓库里不放任何二进制样本。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import {
  DOCX_EXTS,
  canPreviewFile,
  isBinaryFile,
  isDocxFile,
  isImageFile
} from '../src/shared/fileKinds.ts'
import { DOCX_PREVIEW_MAX_BYTES, DOCX_UNZIPPED_MAX_BYTES } from '../src/shared/preview.ts'
import { readZipDirectory } from '../src/main/zipDirectory.ts'
import { docxGateFromBytes } from '../src/main/docxGate.ts'
import { convertDocxBytes } from '../src/main/docxConvert.ts'
import { readDocxPreview } from '../src/main/docxPreview.ts'
import { DOCX_REASONS } from '../src/main/docxWorkerProtocol.ts'
import {
  docxLinkAction,
  finishDocxDom,
  isInlineImageSrc,
  sanitizeDocxHtml
} from '../src/renderer/src/docxSanitize.ts'
import { TINY_PNG, buildDocx, buildSampleDocx, buildZip, docxXml } from './docx-fixture.mts'

const TOKEN_SRC = /src="atlas-media:\/\/docx-image\/([0-9a-f]{32})"/
const SAMPLE_TOKEN = 'atlas-media://docx-image/0123456789abcdef0123456789abcdef'

/** 每个用例一个临时目录(图片落盘用),用完就删 */
async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(process.env.CODE_ATLAS_TMP ?? tmpdir(), 'docx-selftest-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function htmlOf(bytes: Buffer): Promise<string> {
  return withTempDir(async (dir) => {
    const res = await convertDocxBytes(bytes, dir)
    assert.equal(res.kind, 'ok')
    return res.kind === 'ok' ? res.html : ''
  })
}

function checkNames(): void {
  assert.deepEqual([...DOCX_EXTS], ['.docx'], '名单只收 .docx')
  assert.equal(isDocxFile('plan.docx'), true)
  assert.equal(isDocxFile('PLAN.DOCX'), true, '大写后缀也算')
  assert.equal(isDocxFile('old.doc'), false, '.doc 老格式不收')
  assert.equal(isDocxFile('.docx'), false, '隐藏文件式的名字不算')
  assert.equal(isBinaryFile('plan.docx'), true, '.docx 仍按二进制记账')
  assert.equal(canPreviewFile('plan.docx'), true, '.docx 能开预览签')
  assert.equal(canPreviewFile('old.doc'), false, '.doc 仍不能开预览签')
  assert.equal(canPreviewFile('sheet.xlsx'), false, '.xlsx 不受牵连')
  assert.equal(isImageFile('a.png'), true, '图片判定照旧')
  assert.equal(canPreviewFile('notes.md'), true, '文本判定照旧')
}

function checkZipDirectory(): void {
  const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }])
  assert.deepEqual(readZipDirectory(zip), { entries: 1, uncompressedBytes: 5 })
  assert.equal(readZipDirectory(zip.subarray(0, zip.length - 4)), null, '截断的尾部读不出')
  assert.equal(readZipDirectory(Buffer.from('PK')), null, '太短的不是 zip')
  const bomb = buildZip([
    { name: 'word/document.xml', data: Buffer.from('x'), declaredSize: DOCX_UNZIPPED_MAX_BYTES + 1 }
  ])
  assert.equal(docxGateFromBytes(bomb), DOCX_REASONS.bomb, '登记解压后超标 = 解压炸弹')
  const zip64 = buildZip([{ name: 'a', data: Buffer.from('x'), declaredSize: 0xffffffff }])
  assert.equal(readZipDirectory(zip64)?.uncompressedBytes, Infinity, 'zip64 占位值按无穷大算')
}

async function checkConversion(): Promise<void> {
  await withTempDir(async (dir) => {
    const ok = await convertDocxBytes(buildSampleDocx(), dir)
    assert.equal(ok.kind, 'ok', '真 docx 转得出来')
    if (ok.kind !== 'ok') return
    assert.match(ok.html, /<h1>Quarterly plan<\/h1>/, '标题转成 h1')
    assert.match(ok.html, /<table>.*Illustrator.*<\/table>/s, '表格保留')
    assert.doesNotMatch(ok.html, /data:image/, '图片不再内嵌进网页')
    const token = TOKEN_SRC.exec(ok.html)?.[1]
    assert.ok(token, '图片换成令牌地址')
    assert.match(ok.html, /width="1" height="1"/, '按字节量出的宽高写进网页,懒加载前占位')
    assert.deepEqual(ok.images, [{ token, mime: 'image/png', bytes: TINY_PNG.byteLength }])
    assert.deepEqual(await readdir(dir), [token], '图片按令牌落盘,别无他物')
    assert.deepEqual(await readFile(join(dir, token)), TINY_PNG, '落盘字节原样')
  })

  await withTempDir(async (dir) => {
    const svgDoc = buildDocx({
      body: [docxXml.image('rIdSvg')],
      images: { rIdSvg: 'a.png' },
      imageData: { 'a.png': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }
    })
    const res = await convertDocxBytes(svgDoc, dir)
    assert.ok(res.kind === 'ok' && res.images.length === 0, '名单外的图(冒充 png 的 svg)不落盘')
    assert.deepEqual(await readdir(dir), [])
  })

  const rejectReason = async (bytes: Buffer): Promise<string> =>
    withTempDir(async (dir) => {
      const res = await convertDocxBytes(bytes, dir)
      return res.kind === 'rejected' ? res.reason : ''
    })
  assert.equal(await rejectReason(Buffer.from('just some text')), DOCX_REASONS.fake, '改名冒充')
  const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)])
  assert.equal(await rejectReason(broken), DOCX_REASONS.corrupt, '坏掉的压缩包')
  const notWord = buildZip([{ name: 'readme.txt', data: Buffer.from('not a word file') }])
  assert.equal(await rejectReason(notWord), DOCX_REASONS.unreadable, '缺正文的 zip 不抛生面孔')
  assert.equal(await htmlOf(buildDocx({ body: [] })), '', '空文档转出空网页')
}

/**
 * 标题样式认不认(大纲只认真标题):中文 Word 的内置标题在 styles.xml 里存的是
 * styleId="1" + name="heading 1"(界面才显示「标题 1」);WPS/旧模板另建的样式名字直接存成「标题 1」。
 */
async function checkHeadingStyles(): Promise<void> {
  const cases: Array<[string, Array<{ id: string; name: string }>]> = [
    [
      '中文 Word 内置',
      [
        { id: '1', name: 'heading 1' },
        { id: '2', name: 'heading 2' }
      ]
    ],
    [
      '名字存成中文',
      [
        { id: 'a1', name: '标题 1' },
        { id: 'a2', name: '标题 2' }
      ]
    ],
    [
      '英文 Word 内置',
      [
        { id: 'Heading1', name: 'heading 1' },
        { id: 'Heading2', name: 'heading 2' }
      ]
    ]
  ]
  for (const [label, styles] of cases) {
    const bytes = buildDocx({
      body: [docxXml.heading('第一章', styles[0].id), docxXml.heading('第一节', styles[1].id)],
      styles
    })
    const res = await withTempDir((dir) => convertDocxBytes(bytes, dir))
    assert.ok(res.kind === 'ok')
    assert.equal(res.html, '<h1>第一章</h1><h2>第一节</h2>', `${label}:标题样式转成 h1/h2`)
    assert.equal(res.warnings, 0, `${label}:不该报认不出的样式`)
  }
  const plain = await htmlOf(
    buildDocx({
      body: [docxXml.heading('只是加粗', 'Strong')],
      styles: [{ id: 'Strong', name: 'Strong' }]
    })
  )
  assert.equal(plain, '<p>只是加粗</p>', '不是标题样式的段落不升格')
}

async function checkReadFromDisk(): Promise<void> {
  const big = await readDocxPreview({
    absPath: 'never-read.docx',
    relPath: 'big.docx',
    sizeBytes: DOCX_PREVIEW_MAX_BYTES + 1
  })
  assert.equal(big.status, 'too-big', '超拒绝路径先挡,不读盘')
  assert.match(big.reason, /^文件过大\(.+\),超出预览上限 /, '超大提示:先说结论,再给上限')

  await withTempDir(async (dir) => {
    const file = join(dir, 'plan.docx')
    const bytes = buildSampleDocx()
    await writeFile(file, bytes)
    const disk = await readDocxPreview({
      absPath: file,
      relPath: 'plan.docx',
      sizeBytes: bytes.length
    })
    assert.equal(disk.status, 'docx', '真 docx 开 Word 签')
    assert.deepEqual(disk.docx, { bytes: bytes.length }, '快路径只带体积,不转换')
    const fakeFile = join(dir, 'fake.docx')
    await writeFile(fakeFile, 'plain text')
    const fake = await readDocxPreview({ absPath: fakeFile, relPath: 'fake.docx', sizeBytes: 10 })
    assert.equal(fake.status, 'binary', '快路径就挡下改名冒充的')
    assert.equal(fake.reason, DOCX_REASONS.fake)
  })
}

function checkSanitizer(): void {
  assert.deepEqual(docxLinkAction('#docx-footnote-1'), { kind: 'anchor', id: 'docx-footnote-1' })
  assert.deepEqual(docxLinkAction('https://example.com/'), {
    kind: 'external',
    url: 'https://example.com/'
  })
  assert.deepEqual(docxLinkAction('mailto:a@example.com').kind, 'external')
  assert.equal(docxLinkAction('javascript:alert(1)').kind, 'none', 'javascript: 不放行')
  assert.equal(docxLinkAction(' JavaScript:alert(1)').kind, 'none', '大小写/空格伪装不放行')
  assert.equal(docxLinkAction('file:///C:/Windows/notepad.exe').kind, 'none', 'file: 不放行')
  assert.equal(docxLinkAction('#').kind, 'none', '空锚点不动')
  assert.equal(docxLinkAction(null).kind, 'none')

  assert.equal(isInlineImageSrc(SAMPLE_TOKEN), true, '登记格式的令牌地址放行')
  assert.equal(isInlineImageSrc('data:image/png;base64,iVBORw0KGgo='), false, 'data: 不再放行')
  assert.equal(isInlineImageSrc(`${SAMPLE_TOKEN}?x=1`), false, '令牌后面夹带查询串不放行')
  assert.equal(isInlineImageSrc('atlas-media://docx-image/../preview'), false, '跳路径不放行')
  assert.equal(
    isInlineImageSrc('atlas-media://preview/?root=C:&rel=a.png'),
    false,
    '音频分路不放行'
  )
  assert.equal(isInlineImageSrc('https://example.com/a.png'), false, '外链图片不放行')
  assert.equal(isInlineImageSrc('file:///C:/a.png'), false)
  assert.equal(isInlineImageSrc(''), false, '空地址不算')
  assert.equal(isInlineImageSrc(null), false)

  const { document } = parseHTML('<!doctype html><html><body><div id="box"></div></body></html>')
  const box = document.getElementById('box')
  assert.ok(box)
  box.innerHTML =
    '<h1>T</h1><h3>S</h3><table><tr><td>x</td></tr></table>' +
    '<a href="javascript:alert(1)">bad</a><a href="https://example.com/">ok</a>' +
    '<img src="https://evil.example/track.png" width="9"><img src="data:image/png;base64,AAAA">' +
    `<img src="${SAMPLE_TOKEN}" width="640" height="x480">`
  finishDocxDom(box as unknown as Element)
  assert.equal(box.querySelector('h1')?.className, 'md-h md-h1', '标题挂阅读档类名')
  assert.equal(box.querySelector('h3')?.className, 'md-h md-h3')
  const table = box.querySelector('table')
  assert.equal(table?.className, 'md-table', '表格挂阅读档类名')
  assert.equal(table?.parentElement?.className, 'md-table-wrap', '表格包进横滚壳')
  const [bad, ok] = box.querySelectorAll('a')
  assert.equal(bad.hasAttribute('href'), false, '不放行的链接拆掉地址')
  assert.equal(ok.getAttribute('class'), 'md-link', '放行的链接挂链接样式')
  const [tracker, dataUri, local] = box.querySelectorAll('img')
  assert.equal(tracker.hasAttribute('src'), false, '外链图片拆掉地址,绝不外联')
  assert.equal(tracker.hasAttribute('width'), false, '拆掉地址的图不留占位尺寸')
  assert.match(tracker.getAttribute('alt') ?? '', /不支持预览/)
  assert.equal(dataUri.hasAttribute('src'), false, 'data: 图片同样拆掉')
  assert.equal(local.getAttribute('src'), SAMPLE_TOKEN, '令牌图片原样保留')
  assert.equal(local.getAttribute('loading'), 'lazy', '令牌图片懒加载')
  assert.equal(local.getAttribute('decoding'), 'async')
  assert.equal(local.getAttribute('width'), '640', '纯像素宽度保留')
  assert.equal(local.hasAttribute('height'), false, '不是纯像素数的尺寸拿掉')

  // DOMPurify 在没有真浏览器的环境里跑不起来:必须拒绝出稿,不能把原样网页递出去
  assert.equal(
    sanitizeDocxHtml('<p onclick="x()">hi</p>', document as unknown as Document),
    null,
    '消毒器不可用时宁可不显示'
  )
}

async function main(): Promise<void> {
  checkNames()
  checkZipDirectory()
  await checkConversion()
  await checkHeadingStyles()
  await checkReadFromDisk()
  checkSanitizer()
  console.log('✅ Word 预览自测全部通过')
  console.log(
    '   名单 · zip 目录账 · 改名冒充/坏包/缺正文/解压炸弹/超大 · 标题表格 · 图片落盘换令牌 · 链接图片把关 · 消毒器失效拒稿'
  )
}

await main()
