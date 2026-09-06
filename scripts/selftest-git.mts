// git 修改翻译自测:现场 git init 一个临时仓库,真实提交、真实改动,
// 把「收改动 → 取 diff → 拼提示词 → 假模型服务」整条链打穿。不 mock git。
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  DIFF_SYSTEM_PROMPT,
  REPORT_SYSTEM_PROMPT,
  REPORT_ROW_LIMIT,
  buildDiffPrompt,
  buildReportPrompt,
  explainWithMessages,
  explainWithModel,
  gitKindName
} from '../src/ai/index.ts'
import {
  DIFF_CHAR_LIMIT,
  collectGitChanges,
  collectRecentSubjects,
  getChangeDiff,
  gitChangesSignature,
  normalizeNumstatPath,
  parsePorcelainZ,
  pickKind
} from '../src/git/index.ts'
import type { AiConfig, GitChange } from '../src/shared/types.ts'

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error(`git ${args.join(' ')} 失败:${err.message}`))
      else resolve(stdout)
    })
  })
}

/** 造一个有首次提交的临时仓库:a.ts / src/b.ts / e.ts / f.ts 已入库 */
async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codeatlas-git-'))
  await git(root, 'init')
  await git(root, 'config', 'user.name', 'test')
  await git(root, 'config', 'user.email', 'test@test')
  await writeFile(join(root, 'a.ts'), 'line1\nline2\nline3\n', 'utf8')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'b.ts'), 'alpha\nbeta\ngamma\n', 'utf8')
  await writeFile(join(root, 'e.ts'), 'goodbye\n', 'utf8')
  await writeFile(join(root, 'f.ts'), 'rename me\n', 'utf8')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-m', 'init')
  return root
}

/** 制造 7 种真实改动:改/暂存改/新文件/暂存新增/删除/重命名/中文名新文件 */
async function makeChanges(root: string): Promise<void> {
  await writeFile(join(root, 'a.ts'), 'line1\nline2-改\nline2.5 新\nline3\n', 'utf8') // +2 −1,未暂存
  await writeFile(join(root, 'src', 'b.ts'), 'alpha\nbeta\ngamma\ndelta 新\n', 'utf8') // +1
  await git(root, 'add', 'src/b.ts')
  await writeFile(join(root, 'c.ts'), 'brand new file\n', 'utf8') // untracked
  await writeFile(join(root, 'd.ts'), 'added staged\n', 'utf8')
  await git(root, 'add', 'd.ts') // 新增已暂存
  await unlink(join(root, 'e.ts')) // 工作区删除
  await git(root, 'mv', 'f.ts', 'g.ts') // 重命名(已暂存)
  await writeFile(join(root, '中文笔记.md'), '# 你好\n', 'utf8') // 中文名:验 quotepath
}

function findChange(changes: GitChange[], relPath: string): GitChange {
  const hit = changes.find((c) => c.relPath === relPath)
  assert.ok(hit, `改动清单里应有 ${relPath}`)
  return hit
}

async function main(): Promise<void> {
  // ── 1. 纯函数小单测:porcelain 解析 / 状态映射 / numstat 重命名路径 ──
  const entries = parsePorcelainZ('M  a.ts\0 D e.ts\0R  new.ts\0old.ts\0?? c.ts\0')
  assert.equal(entries.length, 4, 'porcelain -z 应解析出 4 个条目')
  assert.equal(entries[2]?.path, 'new.ts')
  assert.equal(entries[2]?.oldPath, 'old.ts', '重命名条目要带旧路径')
  assert.equal(pickKind('?', '?').kind, 'untracked')
  assert.equal(pickKind(' ', 'D').kind, 'deleted')
  assert.equal(pickKind('M', ' ').staged, true)
  assert.equal(normalizeNumstatPath('a => b'), 'b')
  assert.equal(normalizeNumstatPath('pre/{x => y}/suf.js'), 'pre/y/suf.js')

  // ── 2. 真仓库:收改动总览 ──
  const root = await makeRepo()
  let notRepoDir = ''
  try {
    await makeChanges(root)
    const r = await collectGitChanges(root)
    assert.equal(r.isGitRepo, true, '真仓库应被认出')
    assert.ok(r.branch.length > 0, '分支名应有值')

    const a = findChange(r.changes, 'a.ts')
    assert.equal(a.kind, 'modified')
    assert.equal(a.staged, false)
    assert.equal(a.additions, 2, 'a.ts 应 +2 行')
    assert.equal(a.deletions, 1, 'a.ts 应 −1 行')

    const b = findChange(r.changes, 'src/b.ts')
    assert.equal(b.kind, 'modified')
    assert.equal(b.staged, true, 'b.ts 的改动应标记为已暂存')
    assert.equal(b.additions, 1)

    const c = findChange(r.changes, 'c.ts')
    assert.equal(c.kind, 'untracked')
    assert.equal(c.staged, false)

    const d = findChange(r.changes, 'd.ts')
    assert.equal(d.kind, 'added')
    assert.equal(d.staged, true)

    const e = findChange(r.changes, 'e.ts')
    assert.equal(e.kind, 'deleted')
    assert.equal(e.deletions, 1)

    const g = findChange(r.changes, 'g.ts')
    assert.equal(g.kind, 'renamed')
    assert.equal(g.staged, true)
    assert.equal(g.oldPath, 'f.ts', '重命名要记录旧路径')

    const zh = findChange(r.changes, '中文笔记.md')
    assert.equal(zh.kind, 'untracked', '中文文件名要原样显示(不被转义)')

    assert.equal(r.stats.changed, 7)
    assert.equal(r.stats.additions, 4, '总新增应为 2+1+1')
    assert.equal(r.stats.deletions, 2, '总删除应为 1+1')
    for (const change of r.changes) {
      assert.ok(!change.relPath.includes('\\'), 'relPath 必须是 / 分隔')
      assert.ok(!change.relPath.includes(root), 'relPath 不能带绝对路径(路径契约)')
    }

    // ── 3. 用户选的是仓库子目录:只报子目录里的,relPath 相对子目录 ──
    const sub = await collectGitChanges(join(root, 'src'))
    assert.equal(sub.isGitRepo, true)
    assert.equal(sub.changes.length, 1, '子目录场景只应看到 src 下的改动')
    assert.equal(sub.changes[0]?.relPath, 'b.ts', '子目录里 relPath 要相对子目录')
    assert.equal(sub.changes[0]?.staged, true)

    // ── 4. 单文件 diff:暂存/未暂存/新文件/删除/重命名 ──
    const diffA = await getChangeDiff(root, a)
    assert.ok(diffA, 'a.ts 应能取到 diff')
    assert.ok(diffA.diff.includes('-line2'), '应含被删的行')
    assert.ok(diffA.diff.includes('+line2-改'), '应含新增的行')
    assert.ok(diffA.diff.includes('工作区'), '未暂存改动应标「工作区」')
    assert.ok(!diffA.diff.includes('暂存区'), '不应混入暂存区标记')

    const diffB = await getChangeDiff(root, b)
    assert.ok(diffB && diffB.diff.includes('+delta 新') && diffB.diff.includes('暂存区'), '已暂存改动应标「暂存区」')

    const diffC = await getChangeDiff(root, c)
    assert.ok(diffC && diffC.diff.includes('brand new file') && diffC.diff.includes('新文件'), '新文件应读全部内容当新增')

    const diffE = await getChangeDiff(root, e)
    assert.ok(diffE && diffE.diff.includes('-goodbye'), '删除文件应显示被删内容')

    const diffG = await getChangeDiff(root, g)
    assert.ok(diffG && diffG.diff.length > 0, '重命名应能取到 diff')

    // ── 5. 大文件边界:> 200KB 拒讲;中等文件截断并注明 ──
    const hugePath = join(root, 'huge.ts')
    await writeFile(hugePath, 'x'.repeat(250_000), 'utf8')
    const bigList = await collectGitChanges(root)
    const big = findChange(bigList.changes, 'huge.ts')
    assert.equal(await getChangeDiff(root, big), null, '超大新文件应拒讲')
    await unlink(hugePath)

    const midPath = join(root, 'mid.ts')
    await writeFile(midPath, `${'y'.repeat(50_000)}\n`, 'utf8')
    const midList = await collectGitChanges(root)
    const mid = findChange(midList.changes, 'mid.ts')
    const midDiff = await getChangeDiff(root, mid)
    assert.ok(midDiff, '中等文件应能取到 diff')
    assert.ok(midDiff.diff.length <= DIFF_CHAR_LIMIT + 100, '超长 diff 要截断到上限内')
    assert.ok(midDiff.note.includes('截断'), '截断要写进备注')
    await unlink(midPath)

    // ── 6. 不是 git 仓库:老实说不是,不炸 ──
    notRepoDir = await mkdtemp(join(tmpdir(), 'codeatlas-nogit-'))
    const nr = await collectGitChanges(notRepoDir)
    assert.equal(nr.isGitRepo, false)
    assert.equal(nr.changes.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
    if (notRepoDir) await rm(notRepoDir, { recursive: true, force: true })
  }

  // ── 6.5 干活报告的家底:提交主题 / 缓存签名 / 报告提示词 ──
  const reportRoot = await makeRepo()
  let emptyRepo = ''
  try {
    await writeFile(join(reportRoot, 'a.ts'), 'line1-改\nline2\nline3\n', 'utf8')
    await git(reportRoot, 'commit', '-am', '修复窗口圆角的渲染逻辑')
    const subjects = await collectRecentSubjects(reportRoot)
    assert.equal(subjects.length, 2, '仓库应有 2 条提交主题(init + 测试提交)')
    assert.ok(subjects[0]?.includes('窗口圆角'), '提交主题按新到旧排,第一条应是测试提交')
    assert.equal(subjects[1], 'init', '第二条应是造仓库时的 init')

    // 还没有任何提交的仓库:安静回空数组,不炸
    emptyRepo = await mkdtemp(join(tmpdir(), 'codeatlas-emptyrepo-'))
    await git(emptyRepo, 'init')
    assert.deepEqual(await collectRecentSubjects(emptyRepo), [], '没有提交应回空数组')

    const changesNow = await collectGitChanges(reportRoot)
    assert.equal(changesNow.changes.length, 0, '刚提交完,账本应是干净的')
    const sig = gitChangesSignature(changesNow, subjects)
    assert.equal(gitChangesSignature(changesNow, [...subjects]), sig, '同一份账本签名要稳定')
    assert.notEqual(gitChangesSignature(changesNow, ['换个主题']), sig, '提交主题变了签名要变')
    await writeFile(join(reportRoot, 'a.ts'), '又改了一行\nline2\nline3\n', 'utf8')
    const changesNew = await collectGitChanges(reportRoot)
    assert.equal(changesNew.changes.length, 1, '改一行后应有 1 笔改动')
    assert.notEqual(gitChangesSignature(changesNew, subjects), sig, '账本变了签名要变')

    const rp = buildReportPrompt({
      branch: 'main',
      changes: changesNew.changes,
      stats: changesNew.stats,
      recentSubjects: subjects
    })
    assert.ok(rp.includes('分支:main'), '提示词应含分支')
    assert.ok(rp.includes('a.ts'), '提示词应含改动文件')
    assert.ok(rp.includes('+1 −1') || rp.includes('+0 −1') || rp.includes('+2') || rp.includes('+1'), '提示词应含行数账')
    assert.ok(rp.includes('窗口圆角'), '提示词应含提交主题线索')
    assert.ok(!rp.includes(reportRoot), '提示词不许带绝对路径(路径契约)')

    // 行数封顶:100 个文件的改动只摆 80 行,剩下的按零碎改动一笔带过
    const many: GitChange[] = Array.from({ length: 100 }, (_, i) => ({
      relPath: `f${i}.ts`,
      kind: 'modified' as const,
      staged: false,
      additions: 1,
      deletions: 0,
      binary: false
    }))
    const capped = buildReportPrompt({ branch: 'main', changes: many, stats: { additions: 100, deletions: 0 }, recentSubjects: [] })
    assert.equal(capped.split('\n').filter((l) => l.startsWith('- 修改')).length, REPORT_ROW_LIMIT, '清单行数要封顶')
    assert.ok(capped.includes('还有 20 个小改动'), '封顶后要注明还有多少零碎改动')
    const binaryRow = buildReportPrompt({
      branch: 'main',
      changes: [{ relPath: 'pic.png', kind: 'modified', staged: true, additions: -1, deletions: -1, binary: true }],
      stats: { additions: 0, deletions: 0 },
      recentSubjects: []
    })
    assert.ok(binaryRow.includes('二进制'), '二进制改动不许报假行数')
    assert.ok(binaryRow.includes('(已暂存)'), '已暂存要标出来')
  } finally {
    await rm(reportRoot, { recursive: true, force: true })
    if (emptyRepo) await rm(emptyRepo, { recursive: true, force: true })
  }

  // ── 7. 提示词:证据进去了、类型是人话、空 diff 提醒别编造 ──
  const dp = buildDiffPrompt({ relPath: 'src/app.ts', kind: 'modified', diff: '+加了一行配置' })
  assert.ok(dp.includes('src/app.ts'), '提示词应含文件路径')
  assert.ok(dp.includes('修改'), '改动类型应是人话')
  assert.ok(dp.includes('+加了一行配置'), '提示词应含 diff 证据')
  const emptyDp = buildDiffPrompt({ relPath: 'x.ts', kind: 'deleted', diff: '' })
  assert.ok(emptyDp.includes('不要编造'), '空 diff 要提醒模型别编造')
  assert.equal(gitKindName('untracked'), '新文件')
  assert.equal(gitKindName('renamed'), '重命名')

  // ── 8. 假模型服务:验证改动翻译官的人设真的换上去了 ──
  const received: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      received.push(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '这次改动加了一行配置。' } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object', '假服务应监听在端口上')
  try {
    const config: AiConfig = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'fake-model', apiKey: '' }
    const res2 = await explainWithModel(config, dp, DIFF_SYSTEM_PROMPT)
    assert.equal(res2.status, 'supported', '假服务应返回成功')
    const sent = JSON.parse(received[0] ?? '{}') as { messages: Array<{ role: string; content: string }>; max_tokens?: number }
    assert.ok(sent.messages[0]?.content.includes('改动翻译官'), '系统人设应是「改动翻译官」')
    assert.ok(sent.messages[1]?.content.includes('src/app.ts'), '用户提示词应是改动内容')

    // 干活报告:审计官人设真的挂上去,生成上限真的放宽(报告三段式,500 不够用)
    const reportRes = await explainWithMessages(
      config,
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: 'Given:一轮代码改动的完整账本。' }
      ],
      undefined,
      undefined,
      900
    )
    assert.equal(reportRes.status, 'supported', '报告假服务应返回成功')
    const reportSent = JSON.parse(received[1] ?? '{}') as { messages: Array<{ role: string; content: string }>; max_tokens?: number }
    assert.ok(reportSent.messages[0]?.content.includes('干活审计官'), '系统人设应是「干活审计官」')
    assert.equal(reportSent.max_tokens, 900, '报告的生成上限应是 900')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log('✅ git 修改翻译自测全部通过')
  console.log('   真仓库改动收集 · 子目录场景 · 五种 diff · 大文件边界 · 非仓库兜底 · 提示词固定 · 改动翻译官人设 · 干活报告(主题/签名/封顶/审计官人设)')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
