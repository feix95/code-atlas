import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { scanDirectory } from '../src/scanner/index.ts'

async function main(): Promise<void> {
  const root = join(tmpdir(), `code-atlas-selftest-${Date.now()}`)

  // 搭假项目:正常文件 + 该被忽略的杂物
  await fs.mkdir(join(root, 'src', 'components'), { recursive: true })
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  await fs.mkdir(join(root, 'node_modules', 'leftpad'), { recursive: true })
  await fs.mkdir(join(root, '.git'), { recursive: true })
  await fs.writeFile(join(root, 'src', 'index.ts'), 'export {}')
  await fs.writeFile(join(root, 'src', 'components', 'Button.tsx'), 'export {}')
  await fs.writeFile(join(root, 'docs', 'readme.md'), '# hi')
  await fs.writeFile(join(root, 'package.json'), '{}')
  await fs.writeFile(join(root, 'photo.PNG'), 'fake') // 大写后缀,考验归一化
  await fs.writeFile(join(root, 'node_modules', 'leftpad', 'index.js'), 'fake')
  await fs.writeFile(join(root, '.git', 'HEAD'), 'fake')

  try {
    const result = await scanDirectory(root)

    // 1. 数量对:5 个真文件、3 个真文件夹
    assert.equal(result.stats.fileCount, 5, `文件数应为5,实际${result.stats.fileCount}`)
    assert.equal(result.stats.dirCount, 3, `文件夹数应为3,实际${result.stats.dirCount}`)

    // 2. node_modules 和 .git 被忽略
    assert.equal(result.stats.ignoredCount, 2, '应忽略 node_modules 和 .git 两项')
    const childNames = result.tree.children.map((c) => c.name)
    assert.ok(!childNames.includes('node_modules'), 'node_modules 不该出现在树里')
    assert.ok(!childNames.includes('.git'), '.git 不该出现在树里')

    // 3. 扩展名归一化:.PNG 计入 .png
    assert.equal(result.stats.byExt['.png'], 1, '大写 .PNG 应归一化为 .png')
    assert.equal(result.stats.byExt['.ts'], 1)
    assert.equal(result.stats.byExt['.tsx'], 1)

    // 4. 树的结构:文件夹在前,且层级正确
    assert.deepEqual(childNames, ['docs', 'src', 'package.json', 'photo.PNG'], '文件夹应排在文件前')
    const src = result.tree.children.find((c) => c.name === 'src')
    assert.equal(src?.type, 'directory')
    assert.deepEqual(src?.children.map((c) => c.name), ['components', 'index.ts'])

    // 5. 元信息
    assert.equal(result.rootName, root.split(/[\\/]/).pop(), '根目录名应正确')
    assert.ok(result.durationMs >= 0)

    // 6. 错误处理:不存在的路径要抛错,文件路径也要抛错
    await assert.rejects(() => scanDirectory(join(root, '不存在')), /不存在或无法访问/)
    await assert.rejects(() => scanDirectory(join(root, 'package.json')), /这不是一个文件夹/)

    console.log('✅ 目录扫描器自测全部通过')
    console.log(`   文件 ${result.stats.fileCount} · 文件夹 ${result.stats.dirCount} · 耗时 ${result.durationMs}ms`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }

  // ── 7. 大文件夹防线:视频壳、超大文件、海量小文件,扫描都要秒过且内存有界 ──
  const bigRoot = join(tmpdir(), `code-atlas-big-selftest-${Date.now()}`)
  await fs.mkdir(join(bigRoot, 'videos'), { recursive: true })
  await fs.mkdir(join(bigRoot, 'pile'), { recursive: true })

  // 一把视频壳:内容就算是文本,也走二进制黑名单零 I/O 放过,绝不读文件
  for (const name of ['a.mp4', 'b.mkv', 'c.avi', 'd.mov', 'e.webm']) {
    await fs.writeFile(join(bigRoot, 'videos', name), 'fake video shell, just text')
  }
  // 海量无后缀小文件:每个都得现场嗅探,考验并发限流不炸
  const MANY = 2000
  for (let i = 0; i < MANY; i++) {
    await fs.writeFile(join(bigRoot, 'pile', `f${i}`), `console.log(${i})\n`)
  }
  // 稀疏文件撑出 64MB 大文件:老实现会整只读进内存,新实现只准碰开头 4KB
  await fs.writeFile(join(bigRoot, 'mystery-big'), 'const answer: number = 42\n')
  await fs.truncate(join(bigRoot, 'mystery-big'), 64 * 1024 * 1024)

  try {
    const before = process.memoryUsage().external
    const big = await scanDirectory(bigRoot)
    const externalGrew = process.memoryUsage().external - before

    assert.equal(big.stats.fileCount, MANY + 6, `文件数应为 ${MANY + 6}(2000 小文件 + 5 视频壳 + 1 大文件)`)
    assert.equal(big.stats.byExt['.mp4'], 1, '视频壳照常按后缀计数')

    const videos = big.tree.children.find((c) => c.name === 'videos')
    assert.ok(
      videos?.type === 'directory' && videos.children.every((c) => c.type === 'file' && c.language === undefined),
      '视频壳一律无语言标签(黑名单零 I/O 放过)'
    )
    const mystery = big.tree.children.find((c) => c.name === 'mystery-big')
    assert.ok(
      mystery?.type === 'file' && mystery.language === undefined,
      '超大文件不嗅探,诚实认不出(哪怕开头是代码)'
    )

    assert.ok(big.durationMs < 30_000, `海量小文件应秒级扫完,实际 ${big.durationMs}ms`)
    assert.ok(
      externalGrew < 16 * 1024 * 1024,
      `嗅探内存必须与大文件体积无关:外部内存涨了 ${(externalGrew / 1024 / 1024).toFixed(1)}MB(红线 16MB)`
    )
    console.log(`✅ 大文件夹防线自测通过:${big.stats.fileCount} 个文件 · ${big.durationMs}ms · 外部内存增量 ${(externalGrew / 1024 / 1024).toFixed(2)}MB`)
  } finally {
    await fs.rm(bigRoot, { recursive: true, force: true })
  }

  // ── 8. 分级扫描:节点预算用尽就收,没探到的目录挂"点开再扫"占位 ──
  const tierRoot = join(tmpdir(), `code-atlas-tier-selftest-${Date.now()}`)
  await fs.mkdir(join(tierRoot, 'big'), { recursive: true })
  await fs.mkdir(join(tierRoot, 'small'))
  for (let i = 0; i < 4200; i++) {
    await fs.writeFile(join(tierRoot, 'big', `f${i}.txt`), 'x')
  }

  try {
    const tier = await scanDirectory(tierRoot)
    assert.ok(tier.stats.fileCount <= 4000, `预算内必须收工,实际探了 ${tier.stats.fileCount} 个文件`)
    assert.ok(tier.tree.lazy !== true, '根节点自己就是这张图,不挂"还没探"')

    const bigNode = tier.tree.children.find((c) => c.name === 'big')
    assert.ok(
      bigNode?.type === 'directory' && bigNode.lazy === true && bigNode.truncated === true,
      '装不下的目录要挂"点开再探"标记'
    )
    assert.ok(bigNode && bigNode.children.length < 4200, '大目录只探到一部分')

    const smallNode = tier.tree.children.find((c) => c.name === 'small')
    assert.ok(
      smallNode?.type === 'directory',
      '顶层目录必须都看得见(真扫完或挂"还没探"占位,不许凭空消失)'
    )
    assert.ok(tier.stats.lazyCount >= 1, `没探的目录要记账,实际 ${tier.stats.lazyCount}`)

    console.log(`✅ 分级扫描自测通过:预算内探了 ${tier.stats.fileCount} 个文件 · ${tier.stats.lazyCount} 个目录挂"还没探"`)
  } finally {
    await fs.rm(tierRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
