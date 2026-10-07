import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { saveTextFile } from '../src/main/fileEdit.ts'
import { FileWatchRegistry, type FileWatchSignal } from '../src/main/fileWatch.ts'

/** 等事件落袋:watcher 防抖 150ms,等 450ms 足够核完账 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const parent = join(tmpdir(), `atlas-fileedit-${Date.now()}`)
  const root = join(parent, 'code atlas')
  await fs.mkdir(root, { recursive: true })

  const signals: FileWatchSignal[] = []
  const registry = new FileWatchRegistry((sig) => signals.push(sig), 60)

  try {
    // ── 一、saveTextFile 准入与保真 ──
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

    // 越界/非文件/巨物 三道闸
    await assert.rejects(() => saveTextFile(root, '../outside.txt', 'x'), /越界|不合法/)
    await fs.mkdir(join(root, 'dir'), { recursive: true })
    await assert.rejects(() => saveTextFile(root, 'dir', 'x'), /不是一个文件/)
    await assert.rejects(() => saveTextFile(root, 'a.ts', 'x'.repeat(11 * 1024 * 1024)), /上限/)
    await assert.rejects(() => saveTextFile(root, 1 as unknown as string, 'a.ts', 'x'), /不合法/)

    // ── 二、监视账:外部改动通报、自家人写盘不响 ──
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

    // 双户口:同一文件两张签 → remove 一次还活着,再 remove 才收工
    registry.add(root, 'a.ts', absA)
    registry.remove(absA)
    assert.equal(registry.size, 1, '减一口户口监工还在')
    registry.remove(absA)
    assert.equal(registry.size, 0, '户口归零监工收工')

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

    console.log('✅ 文件编辑地基自测全部通过')
    console.log('   saveFile:UTF-8 回写 · CRLF/BOM 保真 · 越界/目录/超闸全拦')
    console.log('   watchFile:外部改写通报 · 自家人写盘不响 · 户口计数 · 删除通报')
  } finally {
    registry.dispose()
    await fs.rm(parent, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
