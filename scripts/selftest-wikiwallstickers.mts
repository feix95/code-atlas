// 自测:线索桌用户便签与图片。存档清洗挡坏值、贴卡判定与跟卡、拖动后重判、叠放次序、
// 图片只认文件头、落盘读写与坏存档备份、未引用图片回收、只有便签存档的目录能认回原项目。
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WALL_STICKERS_MAX,
  linkWallSticker,
  moveWallSticker,
  nextStickerZ,
  placeWallSticker,
  sanitizeWallStickers,
  sniffWallImage,
  sortWallStickers,
  wallAttachTarget,
  wallStickerSize,
  type WallNote,
  type WallSticker
} from '../src/shared/wikiWallNotes.ts'
import {
  WALL_DIR,
  isWallOwner,
  readWallImage,
  readWallStickers,
  saveWallImage,
  writeWallStickers
} from '../src/wiki/wikiWallNotesStore.ts'
import { resolveProjectDir } from '../src/wiki/wikiProjectDir.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const UUID_PNG = '0b3c5c1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e.png'

function note(id: string, x: number, y: number, extra: Partial<WallNote> = {}): WallNote {
  return { id, kind: 'note', color: 'yellow', text: '', x, y, z: 0, attach: null, ...extra }
}

// ---- 清洗 ----
{
  const clean = sanitizeWallStickers([
    note('a', 10, 20, { text: 'hi', color: 'pink' }),
    { ...note('b', -5, 1e9), color: 'purple', text: 'x'.repeat(900) },
    { id: 'bad id!', kind: 'note', x: 0, y: 0 },
    { id: 'c', kind: 'photo', file: '../../etc/passwd', x: 0, y: 0 },
    { id: 'd', kind: 'photo', file: UUID_PNG, size: 'xl', ratio: 99, caption: 'c', x: 1, y: 2 },
    note('a', 0, 0),
    { id: 'e', kind: 'note', x: Number.NaN, y: 3, attach: { pageId: 'p', dx: 99999, dy: 'q' } },
    null,
    'junk'
  ])
  assert.deepEqual(
    clean.map((s) => s.id),
    ['a', 'b', 'd', 'e'],
    '坏 id、路径穿越的图片名、重复 id、非对象都要丢掉'
  )
  const b = clean[1] as WallNote
  assert.equal(b.color, 'yellow', '不认识的颜色回落黄色')
  assert.equal(b.text.length, 500, '便签字数截到上限')
  assert.deepEqual([b.x, b.y], [-5, 50_000], '坐标夹到范围内,负数照收(能贴到左上方)')
  const d = clean[2]
  assert.ok(d.kind === 'photo' && d.size === 'm' && d.ratio === 4, '图片大小与比例夹到合法值')
  assert.deepEqual(clean[3].attach, { pageId: 'p', dx: 20000, dy: 0 }, '贴卡偏移夹到范围内')
  assert.deepEqual(sanitizeWallStickers({ not: 'array' }), [])
  const many = Array.from({ length: WALL_STICKERS_MAX + 20 }, (_, i) => note(`n${i}`, i, i))
  assert.equal(sanitizeWallStickers(many).length, WALL_STICKERS_MAX, '条数有上限')
}

// ---- 贴卡判定、跟卡、拖动重判 ----
{
  const cards = [
    { pageId: 'p1', x: 100, y: 100, w: 200, h: 140 },
    { pageId: 'p2', x: 320, y: 100, w: 200, h: 140 }
  ]
  const size = wallStickerSize(note('a', 0, 0))
  assert.equal(wallAttachTarget({ x: 0, y: -200, ...size }, cards), null, '不压卡就不贴')
  assert.equal(
    wallAttachTarget({ x: 100 - size.w + 10, y: 100, ...size }, cards)?.pageId,
    'p1',
    '蹭到一点边也算贴'
  )
  assert.equal(
    wallAttachTarget({ x: 100 - size.w - 2, y: 100, ...size }, cards),
    null,
    '差几像素没压到边就不贴'
  )
  assert.equal(
    wallAttachTarget({ x: 100 + 200 + 4, y: 100 - size.h - 2, ...size }, cards),
    null,
    '斜对角挨得很近但没压到也不贴'
  )
  const hit = wallAttachTarget({ x: 140, y: 130, ...size }, cards)
  assert.deepEqual(hit, { pageId: 'p1', dx: 40, dy: 30 }, '压在卡上就贴,记相对卡的偏移')
  const both = wallAttachTarget({ x: 250, y: 120, ...size }, cards)
  assert.equal(both?.pageId, 'p2', '同时压两张卡贴压得多的那张')

  const stuck = note('a', 250, 150, { attach: { pageId: 'p1', dx: 150, dy: 50 } })
  const moved = new Map([['p1', { x: 600, y: 300 }]])
  assert.deepEqual(
    (({ x, y, attachedTo }) => ({ x, y, attachedTo }))(placeWallSticker(stuck, moved)),
    { x: 750, y: 350, attachedTo: 'p1' },
    '卡被拖走,便签跟着走'
  )
  const gone = placeWallSticker(stuck, new Map())
  assert.deepEqual([gone.x, gone.y, gone.attachedTo], [250, 150, null], '卡不见了回落绝对位置')

  const list: WallSticker[] = [stuck, note('b', 0, 0, { z: 5 })]
  const off = moveWallSticker(list, 'a', 900, 600, cards)
  assert.equal(off[0].attach, null, '自动贴上的拖到空白处就取下来')
  assert.equal(off[0].z, 6, '拖过的浮到最上面')
  assert.equal(off[1], list[1], '别的便签原样不动')
  const on = moveWallSticker(off, 'a', 420, 130, cards)
  assert.equal(on[0].attach?.pageId, 'p2', '拖到另一张卡上就改贴那张')
  const free = moveWallSticker([note('c', 0, 0)], 'c', 900, 600, cards)
  assert.equal(free[0].attach, null, '本来没关联的拖到空白处还是自由的')
  const cut = linkWallSticker(on, 'a', null, cards)
  assert.deepEqual([cut[0].x, cut[0].y, cut[0].attach], [420, 130, null], '叉掉关联,便签留在原地')
  const far = linkWallSticker(cut, 'a', 'p1', cards)
  assert.deepEqual(
    far[0].attach,
    { pageId: 'p1', dx: 320, dy: 30, manual: true },
    '离得远也能手动关联'
  )
  const kept = moveWallSticker(far, 'a', 900, 600, cards)
  assert.deepEqual(
    kept[0].attach,
    { pageId: 'p1', dx: 800, dy: 500, manual: true },
    '手动关联的拖到空白处还在,只更新偏移'
  )
  const swap = moveWallSticker(kept, 'a', 420, 130, cards)
  assert.equal(swap[0].attach?.pageId, 'p2', '手动关联的拖到别的卡旁边改成自动贴那张')
  assert.equal(swap[0].attach?.manual, undefined)
  assert.equal(sanitizeWallStickers([far[0]])[0].attach?.manual, true, '手动标记存盘读回来还在')
  assert.equal(linkWallSticker(cut, 'a', 'nope', cards)[0].attach, null, '关联不存在的卡等于不关联')
  assert.equal(nextStickerZ([]), 1)
  assert.deepEqual(
    sortWallStickers([note('x', 0, 0, { z: 3 }), note('y', 0, 0, { z: 1 })]).map((s) => s.id),
    ['y', 'x']
  )
}

// ---- 文件头 ----
{
  assert.equal(sniffWallImage(PNG), 'png')
  assert.equal(sniffWallImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
  assert.equal(sniffWallImage(new TextEncoder().encode('GIF89a')), 'gif')
  assert.equal(sniffWallImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'webp')
  assert.equal(sniffWallImage(new TextEncoder().encode('<svg onload=alert(1)>')), null, 'SVG 不收')
  assert.equal(sniffWallImage(new Uint8Array([])), null)
}

// ---- 落盘 ----
const base = process.env.CODE_ATLAS_TMP ?? tmpdir()
const root = await fs.mkdtemp(join(base, 'wallstickers-'))
try {
  const projectDir = join(root, 'demo')
  const projectRoot = join(root, 'src', 'demo')
  assert.deepEqual(await readWallStickers(projectDir), { projectRoot: null, stickers: [] })

  const saved = await saveWallImage(projectDir, PNG)
  assert.ok(saved.ok, '合法 PNG 能存')
  assert.match(saved.ok ? saved.file : '', /^[0-9a-f-]{36}\.png$/)
  assert.deepEqual(await saveWallImage(projectDir, new TextEncoder().encode('hello')), {
    ok: false,
    error: '只支持 PNG、JPG、GIF、WebP 图片'
  })
  assert.equal((await saveWallImage(projectDir, 'nope')).ok, false)
  assert.equal((await saveWallImage(projectDir, new Uint8Array(10 * 1024 * 1024 + 1))).ok, false)

  const file = saved.ok ? saved.file : ''
  const read = await readWallImage(projectDir, file)
  assert.ok(read.ok && read.url.startsWith('data:image/png;base64,'), '读回 data URL')
  assert.equal((await readWallImage(projectDir, '../stickers.json')).ok, false, '挡路径穿越')
  assert.equal((await readWallImage(projectDir, UUID_PNG)).ok, false, '文件不在就报不见了')

  const photo = {
    id: 'ph',
    kind: 'photo',
    file,
    caption: '截图',
    size: 'l',
    ratio: 0.5,
    x: 1,
    y: 2,
    z: 1,
    attach: null
  }
  await writeWallStickers(projectDir, projectRoot, [
    note('n1', 5, 6, { text: '记得改' }),
    photo,
    { bad: 1 }
  ])
  const back = await readWallStickers(projectDir)
  assert.equal(back.projectRoot, projectRoot)
  assert.deepEqual(
    back.stickers.map((s) => s.id),
    ['n1', 'ph'],
    '写入前也清洗'
  )
  assert.equal(await isWallOwner(projectDir, projectRoot), true)
  assert.equal(await isWallOwner(projectDir, join(root, 'other')), false)

  // 只有线索桌存档、还没生成过 Wiki 的目录,解析时要认回原项目,不另开新目录
  assert.equal(await resolveProjectDir(root, projectRoot), projectDir)

  // 未引用的图片:刚存的先不收,放久了才收;引用中的不收
  const orphan = await saveWallImage(projectDir, PNG)
  const orphanPath = join(projectDir, WALL_DIR, 'images', orphan.ok ? orphan.file : '')
  await writeWallStickers(projectDir, projectRoot, back.stickers)
  await fs.access(orphanPath)
  const old = new Date(Date.now() - 60 * 60 * 1000)
  await fs.utimes(orphanPath, old, old)
  await fs.utimes(join(projectDir, WALL_DIR, 'images', file), old, old)
  await writeWallStickers(projectDir, projectRoot, back.stickers)
  await assert.rejects(fs.access(orphanPath), '放久了没人用的图片要回收')
  await fs.access(join(projectDir, WALL_DIR, 'images', file))

  // 坏存档:读时当空,写前先另存一份
  const stickersFile = join(projectDir, WALL_DIR, 'stickers.json')
  await fs.writeFile(stickersFile, '{ broken', 'utf8')
  assert.deepEqual((await readWallStickers(projectDir)).stickers, [])
  await writeWallStickers(projectDir, projectRoot, [])
  const names = await fs.readdir(join(projectDir, WALL_DIR))
  assert.ok(
    names.some((n) => n.startsWith('stickers.json.bad-')),
    '坏存档要先备份'
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('selftest-wikiwallstickers: ok')
