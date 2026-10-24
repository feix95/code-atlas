import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { renameTextFile, saveTextFile } from '../src/main/fileEdit.ts'
import { FileWatchRegistry, type FileWatchSignal } from '../src/main/fileWatch.ts'
import { fileBaseError, fileBaseName } from '../src/shared/fileRename.ts'

/** 等事件落袋:watcher 防抖 150ms,等 450ms 足够核完账 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const parent = join(tmpdir(), `atlas-fileedit-${Date.now()}`)
  const root = join(parent, 'code atlas')
  await fs.mkdir(root, { recursive: true })

  const signals: FileWatchSignal[] = []
  const registry = new FileWatchRegistry((sig) => signals.push(sig), 60)

  try {
    // 一、saveTextFile 准入与保真 
    await fs.writeFile(join(root, 'a.ts'), 'const a = 1\n')
    const r1 = await saveTextFile(root, 'a.ts', 'const a = 2\nlet b = 3\n')
    assert.ok(r1.mtimeMs > 0, 'saveFile 应回写后 mtime')
    assert.equal(await fs.readFile(join(root, 'a.ts'), 'utf8'), 'const a = 2\nlet b = 3\n')

    // CRLF 文件:编辑器内存里是 LF,落盘要换回 CRLF
    await fs.writeFile(join(root, 'win.txt'), 'x\r\ny\r\n')
    await saveTextFile(root, 'win.txt', 'x\ny\nz\n')
    assert.equal(
      await fs.readFile(join(root, 'win.txt'), 'utf8'),
      'x\r\ny\r\nz\r\n',
      'CRLF 应被保留'
    )

    // BOM 文件:带 BOM 的 UTF-8 不许丢签名、也不许双份
    await fs.writeFile(join(root, 'bom.md'), '﻿# 标题\n')
    await saveTextFile(root, 'bom.md', '# 标题\n多一行\n')
    const bomOut = await fs.readFile(join(root, 'bom.md'))
    assert.deepEqual([...bomOut.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 应保留且只有一份')

    // 越界/非文件/巨型文件 三道闸
    await assert.rejects(() => saveTextFile(root, '../outside.txt', 'x'), /越界|不合法/)
    await fs.mkdir(join(root, 'dir'), { recursive: true })
    await assert.rejects(() => saveTextFile(root, 'dir', 'x'), /不是一个文件/)
    await assert.rejects(() => saveTextFile(root, 'a.ts', 'x'.repeat(11 * 1024 * 1024)), /上限/)
    await assert.rejects(() => saveTextFile(root, 1 as unknown as string, 'a.ts', 'x'), /不合法/)

    // 二、监视账:外部改动通报、自家人写盘不响 
    const absA = join(root, 'a.ts')
    assert.equal(registry.add(root, 'a.ts', absA), true)
    assert.equal(registry.size, 1)

    // 我们自己写:saveFile → noteOwnWrite → 之后 150ms+ 不该有信号
    const own = await saveTextFile(root, 'a.ts', 'const a = 9\n')
    registry.noteOwnWrite(absA, own.mtimeMs)
    await sleep(400)
    assert.equal(signals.length, 0, `自己写盘不该通报(收到 ${signals.length} 条)`)

    // 外部程序直接改写:该通报,带 rootPath/relPath/mtime
    await fs.writeFile(absA, 'const a = 42\n')
    await sleep(400)
    assert.equal(signals.length, 1, '外部改写应通报一次')
    assert.equal(signals[0].relPath, 'a.ts')
    assert.equal(signals[0].rootPath, root)
    assert.ok(typeof signals[0].mtimeMs === 'number' && signals[0].mtimeMs > 0)

    // 再来一次外部改写(防「吞一次就再也收不到」)
    await sleep(50)
    await fs.writeFile(absA, 'const a = 43\n')
    await sleep(400)
    assert.equal(signals.length, 2, '第二次外部改写也应通报')

    // 双登记:同一文件两张签 → remove 一次还活着,再 remove 才收工
    registry.add(root, 'a.ts', absA)
    registry.remove(absA)
    assert.equal(registry.size, 1, '减一份登记监工还在')
    registry.remove(absA)
    assert.equal(registry.size, 0, '登记归零监工收工')

    // 收工后再改不许通报
    signals.length = 0
    await fs.writeFile(absA, 'const a = 44\n')
    await sleep(400)
    assert.equal(signals.length, 0, '收工后不许再通报')

    // 被删通报 mtimeMs=null
    registry.add(root, 'a.ts', absA)
    await fs.rm(absA)
    await sleep(400)
    assert.equal(signals.length, 1, '删除应通报')
    assert.equal(signals[0].mtimeMs, null, '删除的 mtime 应是 null')
    registry.dispose()
    assert.equal(registry.size, 0)

    // 挂在不存在的文件上:老实回 false,不抛不崩
    assert.equal(registry.add(root, 'ghost.ts', join(root, 'ghost.ts')), false)

    // 三、内联标题改名:renameTextFile 准入与换登记 
    // 基础名/扩展名分家(内联标题显示的配方)
    assert.equal(fileBaseName('notes.md'), 'notes')
    assert.equal(fileBaseName('archive.tar.gz'), 'archive.tar')
    assert.equal(fileBaseName('.env'), '')
    assert.equal(fileBaseError('好名字'), null)
    assert.ok(fileBaseError('a/b') !== null)
    assert.ok(fileBaseError('') !== null)
    assert.ok(fileBaseError('name.') !== null)
    assert.ok(fileBaseError('..') !== null)

    // 根级改名:内容原样带走,旧名消失,回执报新登记
    await fs.writeFile(join(root, 'old.md'), '# 正文\n')
    const rn = await renameTextFile(root, 'old.md', 'new')
    assert.equal(rn.relPath, 'new.md')
    assert.equal(rn.name, 'new.md')
    assert.equal(await fs.readFile(join(root, 'new.md'), 'utf8'), '# 正文\n')
    await assert.rejects(() => fs.stat(join(root, 'old.md')), undefined, '旧名应已消失')

    // 嵌套目录改名:relPath 只换尾段
    await fs.mkdir(join(root, 'sub'), { recursive: true })
    await fs.writeFile(join(root, 'sub', 'x.md'), 'x')
    const rnSub = await renameTextFile(root, 'sub/x.md', 'y')
    assert.equal(rnSub.relPath, 'sub/y.md')

    // 扩展名保原样(大小写都不动)
    await fs.writeFile(join(root, 'Doc.MD'), 'd')
    const rnExt = await renameTextFile(root, 'Doc.MD', 'Note')
    assert.equal(rnExt.name, 'Note.MD')

    // 主名里带点是合法登记:archive.tar.gz 的主名是 archive.tar
    await fs.writeFile(join(root, 'archive.tar.gz'), 'z')
    const rnDot = await renameTextFile(root, 'archive.tar.gz', 'my.pack')
    assert.equal(rnDot.name, 'my.pack.gz')

    // 撞名拦下:目标已存在(文件/目录同闸),绝不顶替
    await fs.writeFile(join(root, 'taken.md'), 't')
    await fs.writeFile(join(root, 'taker.md'), 's')
    await fs.mkdir(join(root, 'asdir.md'), { recursive: true })
    await assert.rejects(() => renameTextFile(root, 'taker.md', 'taken'), /已经存在/)
    await assert.rejects(() => renameTextFile(root, 'taker.md', 'asdir'), /已经存在/)

    // 非法名字/坏登记逐一拦
    await assert.rejects(() => renameTextFile(root, 'taker.md', ''), /不能是空的/)
    await assert.rejects(() => renameTextFile(root, 'taker.md', 'a/b'), /不认的字符/)
    await assert.rejects(() => renameTextFile(root, 'taker.md', 'dot.'), /结尾/)
    await assert.rejects(() => renameTextFile(root, 'ghost.md', 'g'), /不存在/)
    await assert.rejects(() => renameTextFile(root, 'sub', 'd2'), /不是一个文件/)
    await assert.rejects(() => renameTextFile(root, '../o.md', 'x'), /越界|不合法/)

    // 同名提交 = 不出刀的直通(大小写改名照常放行)
    const rnSame = await renameTextFile(root, 'new.md', 'new')
    assert.equal(rnSame.relPath, 'new.md')
    const rnCase = await renameTextFile(root, 'new.md', 'NEW')
    assert.equal(rnCase.name, 'NEW.md')

    // 监视登记迁移:挂监工 → 改名迁登记 → 改名本身不响,
    // 之后外部动新路径照常通报(且报的是新 relPath)
    signals.length = 0
    const absM = join(root, 'm.ts')
    await fs.writeFile(absM, 'const m = 1\n')
    assert.equal(registry.add(root, 'm.ts', absM), true)
    const mv = await renameTextFile(root, 'm.ts', 'm2')
    registry.move(absM, join(root, 'm2.ts'), 'm2.ts', mv.mtimeMs)
    await sleep(400)
    assert.equal(signals.length, 0, `改名迁登记不该通报(收到 ${signals.length} 条)`)
    await fs.writeFile(join(root, 'm2.ts'), 'const m = 2\n')
    await sleep(400)
    assert.equal(signals.length, 1, '迁登记后外部改写应通报')
    assert.equal(signals[0].relPath, 'm2.ts')
    registry.dispose()

    console.log('✅ 文件编辑地基自测全部通过')
    console.log('   saveFile:UTF-8 回写 · CRLF/BOM 保真 · 越界/目录/超闸全拦')
    console.log('   watchFile:外部改写通报 · 自家人写盘不响 · 登记计数 · 删除通报')
    console.log('   renameFile:同目录改名 · 扩展名保留 · 撞名/非法/越界全拦 · 监视登记迁移')
  } finally {
    registry.dispose()
    await fs.rm(parent, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
