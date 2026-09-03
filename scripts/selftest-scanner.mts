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
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
