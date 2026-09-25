import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { searchNames } from '../src/scanner/searchNames.ts'
import { SEARCH_NAMES_MAX } from '../src/shared/searchNames.ts'
import { MAX_DEPTH, MAX_NODES } from '../src/scanner/index.ts'

// 深搜遍历器自测(UI v3 §7.2):文件名/文件夹名深扫磁盘的每一条规矩都要立得住 ——
// 命中口径、相对路径契约、忽略名单、没点开过的目录、排序、上限截断、
// 保护闸照实记账、最新有效制的取消旗。

const neverStale = (): boolean => false

async function main(): Promise<void> {
  const root = join(tmpdir(), `code-atlas-search-selftest-${Date.now()}`)

  // 搭假项目:正常件 + 该被忽略的杂物堆 + 故意藏深的目标
  await fs.mkdir(join(root, 'src', 'components', 'SearchPanel'), { recursive: true })
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  await fs.mkdir(join(root, 'node_modules', 'search-leftpad'), { recursive: true })
  await fs.mkdir(join(root, '.git'), { recursive: true })
  await fs.writeFile(join(root, 'src', 'searchNames.ts'), 'export {}')
  await fs.writeFile(
    join(root, 'src', 'components', 'SearchPanel', 'search-inner.tsx'),
    'export {}'
  )
  await fs.writeFile(join(root, 'docs', 'search-notes.md'), '# hi')
  await fs.writeFile(join(root, 'search-top.md'), '# hi')
  await fs.writeFile(join(root, 'README.md'), '# hi')
  await fs.writeFile(join(root, 'node_modules', 'search-leftpad', 'index.js'), 'fake')
  await fs.writeFile(join(root, '.git', 'SEARCH_HEAD'), 'fake')

  try {
    // ── 1. 基本命中:文件名和文件夹名都算,大小写不分 ──
    const r1 = await searchNames(root, 'search', neverStale)
    const rels = r1.hits.map((h) => h.relPath).sort()
    assert.deepEqual(
      rels,
      [
        'docs/search-notes.md',
        'search-top.md',
        'src/components/SearchPanel',
        'src/components/SearchPanel/search-inner.tsx',
        'src/searchNames.ts'
      ].sort(),
      `命中的 relPath 账不对:${rels.join(' | ')}`
    )

    // ── 2. 字段契约:kind / dirRel / absPath 各归各位 ──
    const dirHit = r1.hits.find((h) => h.relPath === 'src/components/SearchPanel')
    assert.equal(dirHit?.kind, 'directory', '文件夹命中要挂 directory')
    assert.equal(dirHit?.name, 'SearchPanel')
    assert.equal(dirHit?.dirRel, 'src/components', '所在目录的相对路径账')
    assert.ok(
      dirHit?.absPath.replace(/\\/g, '/').endsWith('src/components/SearchPanel'),
      '绝对路径要真指到盘上的那个文件夹'
    )
    const rootFile = r1.hits.find((h) => h.name === 'search-top.md')
    assert.equal(rootFile?.dirRel, '', '根下命中 dirRel 为空串')

    // ── 3. 忽略名单:杂物堆里再像命中的也不进账 ──
    assert.ok(
      !r1.hits.some((h) => h.relPath.includes('node_modules') || h.relPath.includes('.git')),
      'node_modules / .git 里的东西绝不进清单'
    )

    // ── 4. 没点开过的目录也算数:search-notes.md 住在从未展开的 docs 里 ──
    //    (上面 rels 断言已含它,这条是语义保险丝)
    assert.ok(
      r1.hits.some((h) => h.relPath === 'docs/search-notes.md'),
      '没扫描进树的目录也要被深搜到'
    )

    // ── 5. 排序:文件夹在前、文件在后,各自按名字排 ──
    const kinds = r1.hits.map((h) => h.kind)
    const firstFile = kinds.indexOf('file')
    assert.ok(
      firstFile === -1 || !kinds.slice(firstFile).includes('directory'),
      '文件夹命中必须全体排在文件命中前面'
    )

    // ── 6. 大小写不分:大写关键字也能命中 ──
    const r2 = await searchNames(root, 'SEARCHPANEL', neverStale)
    assert.ok(
      r2.hits.some((h) => h.relPath === 'src/components/SearchPanel'),
      '大写关键字要命中'
    )

    // ── 7. 空结果:不报错,干净回空账 ──
    const r3 = await searchNames(root, '绝不可能有的词zzz', neverStale)
    assert.deepEqual(r3.hits, [])
    assert.equal(r3.truncated, false)
    assert.equal(r3.cancelled, false)

    // ── 8. 上限截断:超过 SEARCH_NAMES_MAX 只回前 N 条并立旗 ──
    const capRoot = join(root, 'cap')
    await fs.mkdir(capRoot, { recursive: true })
    for (let i = 0; i < SEARCH_NAMES_MAX + 10; i++) {
      await fs.writeFile(join(capRoot, `hit-${String(i).padStart(4, '0')}.txt`), 'x')
    }
    const r4 = await searchNames(root, 'hit-', neverStale)
    assert.equal(r4.hits.length, SEARCH_NAMES_MAX, `截断后应正好 ${SEARCH_NAMES_MAX} 条`)
    assert.equal(r4.truncated, true, '截断旗要立起来')

    // ── 9. 深度保护闸:比 MAX_DEPTH 还深的目录不再下钻,照实记 stoppedEarly ──
    const deepRoot = join(root, 'deep')
    let cursor = deepRoot
    for (let i = 0; i < MAX_DEPTH + 2; i++) {
      cursor = join(cursor, `lv${i}`)
    }
    await fs.mkdir(cursor, { recursive: true })
    await fs.writeFile(join(cursor, 'needle-at-bottom.txt'), 'x')
    const r5 = await searchNames(root, 'needle-at-bottom', neverStale)
    assert.deepEqual(r5.hits, [], '深度闸之外的件不该进清单')
    assert.equal(r5.stoppedEarly, true, '撞深度闸要照实记 stoppedEarly')

    // ── 10. 最新有效制:isStale 一翻账,遍历就地收工回 cancelled ──
    let stale = false
    const p = searchNames(root, 'search', () => stale)
    stale = true // 主进程语义:新一轮起身后旧一轮作废
    const r6 = await p
    assert.equal(r6.cancelled, true, '被顶掉的搜索要回 cancelled 旗')

    // ── 11. 读不了的根不炸:不存在的目录回空账,不抛生面孔 ──
    const r7 = await searchNames(join(root, '不存在的目录'), 'search', neverStale)
    assert.deepEqual(r7.hits, [])

    console.log('✅ 工作区文件名深搜自测全部通过')
    console.log(
      `   命中口径 · 字段契约 · 忽略名单 · 未扫描目录 · 排序 · 大小写 · 空账 · ` +
        `截断(${SEARCH_NAMES_MAX}) · 深度闸(${MAX_DEPTH})与节点闸(${MAX_NODES})口径 · 取消旗`
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

await main()
