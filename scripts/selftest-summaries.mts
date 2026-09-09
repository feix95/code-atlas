import assert from 'node:assert/strict'
import { annotateSummaries } from '../src/summarizer/index.ts'
import type { LanguageTag, ScanDirNode, ScanFileNode } from '../src/shared/types.ts'

let fileSeq = 0

function file(name: string, language?: LanguageTag, docTitle?: string): ScanFileNode {
  fileSeq++
  const dot = name.lastIndexOf('.')
  return {
    type: 'file',
    name,
    relPath: `f${fileSeq}/${name}`,
    ext: dot > 0 ? name.slice(dot).toLowerCase() : '',
    ...(language ? { language } : {}),
    ...(docTitle ? { docTitle } : {})
  }
}

function dir(name: string, children: ScanFileNode[] | ScanDirNode[] = [], extra: Partial<ScanDirNode> = {}): ScanDirNode {
  return { type: 'directory', name, relPath: name, children, ...extra }
}

const TS: LanguageTag = { id: 'typescript', name: 'TypeScript', source: 'extension' }
const CSS: LanguageTag = { id: 'css', name: 'CSS', source: 'extension' }
const KOTLIN: LanguageTag = { id: 'kotlin', name: 'Kotlin', source: 'extension' }

function textOf(node: ScanFileNode | ScanDirNode): string {
  return node.summary ? `${node.summary.emoji} ${node.summary.text}` : '(无)'
}

async function main(): Promise<void> {
  // ── 1. 名人文件字典:档位2直说是什么,档位3带行动 + sticky(豁免降噪) ──
  const pkg = file('package.json')
  const readme = file('README.MD')
  const gitignore = file('.gitignore')
  const lock = file('package-lock.json')
  const envFile = file('.env.local')
  annotateSummaries(dir('proj', [pkg, readme, gitignore, lock, envFile]))
  assert.ok(textOf(pkg).includes('项目配置'), `package.json → 项目配置,实际:${textOf(pkg)}`)
  assert.ok(textOf(readme).includes('项目说明'), 'README 大写也得认出来')
  assert.ok(textOf(gitignore).includes('不会被提交'), '.gitignore 说清后果')
  assert.ok(textOf(lock).includes('不要手动改') && lock.summary?.sticky === true, '锁定文件:风险句 + sticky 豁免降噪')
  assert.ok(textOf(envFile).includes('不要外传') && envFile.summary?.sticky === true, '.env:风险句带"不要外传" + sticky')

  // ── 2. 名字模式规则:tsconfig 两代 / prettier 家族 / eslint / env / 打包流水线 ──
  const cases: Array<[ScanFileNode, string]> = [
    [file('tsconfig.node.json'), '编译配置'],
    [file('tsconfig.json'), '编译配置'],
    [file('.prettierrc.json'), '格式配置'],
    [file('.prettierrc'), '格式配置'],
    [file('eslint.config.mjs'), '代码检查'],
    [file('electron.vite.config.ts'), '打包配置'],
    [file('vite.config.js'), '打包配置'],
    [file('CLAUDE.md'), 'AI 说明'],
    [file('foo.test.ts'), '验证代码对不对'],
    [file('bar.spec.js'), '验证代码对不对'],
    [file('selftest-ai.mts'), '验证代码对不对'],
    [file('types.d.ts'), '类型说明'],
    [file('something.config.yaml'), '配置文件']
  ]
  for (const [node, keyword] of cases) {
    annotateSummaries(dir('p', [node]))
    assert.ok(textOf(node).includes(keyword), `${node.name} 应提到「${keyword}」,实际:${textOf(node)}`)
  }

  // ── 3. 档位1:类型标签已说清的不写字;黑话后缀给范畴词;诚实话兜底 ──
  const entry = file('index.ts', TS)
  const cssFile = file('index.css', CSS) // css 不是代码语言,不该被当成入口
  const kt = file('mystery.kt', KOTLIN)
  const plainTs = file('util.ts', TS)
  const docMd = file('note.md')
  const photo = file('photo.png')
  const silentTxt = file('notes.txt')
  const zipFile = file('bundle.zip')
  const unknownExt = file('blob.xyz')
  const noExt = file('deploy')
  annotateSummaries(dir('p', [entry, cssFile, kt, plainTs, docMd, photo, silentTxt, zipFile, unknownExt, noExt]))
  assert.ok(textOf(entry).includes('入口'), '代码语言的 index.ts 是入口(档位2,真信息)')
  assert.ok(textOf(cssFile).includes('样式'), 'index.css → 范畴词「样式」')
  assert.equal(kt.summary, undefined, '任意 .kt:名字查不出词,老实闭嘴')
  assert.ok(textOf(plainTs).includes('工具'), 'util.ts → 词根词典给「工具」(第九十九锤)')
  assert.equal(textOf(docMd), '📖 文档', '.md → 范畴词「文档」')
  assert.equal(photo.summary, undefined, '.png 家喻户晓,沉默名单不写字')
  assert.equal(silentTxt.summary, undefined, '.txt 沉默名单不写字')
  assert.ok(textOf(zipFile).includes('压缩包'), '.zip → 范畴词「压缩包」')
  assert.ok(textOf(unknownExt).includes('未知类型'), '陌生后缀诚实说未知')
  assert.ok(textOf(noExt).includes('没有后缀'), '无后缀诚实说')

  // ── 4. 目录名字典:正脸直说 ≤14 字,无人物拟人;风险目录带 sticky ──
  const src = dir('src', [file('a.ts', TS)])
  const insp = dir('inspiration', [file('idea.md')])
  const vendor = dir('vendor', [file('lib.so')])
  const tests = dir('tests', [file('x.test.ts', TS)])
  const nm = dir('node_modules', [file('left-pad.js')])
  const dist = dir('dist', [file('bundle.js')])
  annotateSummaries(dir('proj', [src, insp, vendor, tests, nm, dist]))
  assert.ok(textOf(src).includes('项目全部源代码'), 'src 直说源代码')
  assert.ok(textOf(insp).includes('参考资料'), 'inspiration → 参考资料')
  assert.ok(textOf(vendor).includes('第三方代码') && textOf(vendor).includes('不修改'), 'vendor 说清只借不改')
  assert.ok(textOf(tests).includes('测试代码'), 'tests → 测试代码')
  assert.ok(textOf(nm).includes('删了能重装') && nm.summary?.sticky === true, 'node_modules 风险句(定稿文案)')
  assert.ok(textOf(dist).includes('打包产物') && dist.summary?.sticky === true, 'dist 风险句')

  // ── 5. scripts 目录看内容改口:大半是测试就报数量 ──
  const selftests = dir('scripts', [
    file('selftest-scanner.mts'),
    file('selftest-parser.mts'),
    file('selftest-analyzer.mts'),
    file('selftest-paths.mts'),
    file('selftest-depgraph.mts'),
    file('selftest-ai.mts'),
    file('selftest-git.mts')
  ])
  annotateSummaries(dir('proj', [selftests]))
  assert.ok(textOf(selftests).includes('7 个测试脚本'), `全自测的 scripts 要报数量,实际:${textOf(selftests)}`)

  const mixedScripts = dir('scripts', [file('deploy.ps1'), file('build.sh')])
  annotateSummaries(dir('proj', [mixedScripts]))
  assert.ok(textOf(mixedScripts).includes('自动化脚本'), '不含自测的 scripts 说自动化脚本')

  // ── 6. 内容兜底:没名字线索时看装了啥 ──
  const mysteryCode = dir('mystery', Array.from({ length: 5 }, (_, i) => file(`m${i}.ts`, TS)))
  const notes = dir('notes', [file('a.md'), file('b.txt')])
  const empty = dir('empty')
  const drawers = dir('drawers', [dir('x'), dir('y'), dir('z')])
  annotateSummaries(dir('proj', [mysteryCode, notes, empty, drawers]))
  assert.ok(textOf(mysteryCode).includes('5 个文件') && textOf(mysteryCode).includes('TypeScript'), '内容兜底要说数量和主语言')
  assert.ok(textOf(notes).includes('全是文档') && textOf(notes).includes('2 份'), '全文档目录如实报份数')
  assert.ok(textOf(empty).includes('空的，还没有内容'), '空目录像日志一样播报')
  assert.ok(textOf(drawers).includes('只含子文件夹，3 个'), '只有子目录要说清结构')

  // ── 7. 根节点聚合:子孙家底全算进来;目录个个有标签,档位1文件可留空 ──
  const root = dir('code-atlas', [
    dir('src', [file('a.ts', TS), file('b.ts', TS), file('index.ts', TS)]),
    dir('docs', [file('guide.md'), file('faq.md')]),
    file('package.json')
  ])
  annotateSummaries(root)
  assert.ok(textOf(root).includes('6 个文件'), '根的家底要含全部子孙(3+2+1)')
  assert.ok(textOf(root).includes('TypeScript'), '根的主语言要看全部子孙')
  assert.ok(textOf(root.children[0]).includes('项目全部源代码'), '子目录各自有标签')
  const allDirsTagged = (n: ScanDirNode): boolean =>
    n.summary !== undefined && n.children.every((c) => (c.type === 'directory' ? allDirsTagged(c) : true))
  assert.ok(allDirsTagged(root), '整棵树每个目录都有速览标签(文件允许档位1留空)')

  // ── 8. 分级扫描占位:没展开的要老实说,不许装成空文件夹;名字认得出的保留身份 ──
  const lazyPlain = dir('mystery-plain', [], { lazy: true })
  const lazyVideos = dir('videos', [], { lazy: true })
  annotateSummaries(dir('proj', [lazyPlain, lazyVideos]))
  assert.ok(textOf(lazyPlain).includes('还没展开，点击查看'), '没名字线索的未展开目录要老实说')
  assert.ok(textOf(lazyVideos).startsWith('🎬'), '名字认得出的未展开目录保留身份标签(媒体文件)')

  // ── 8.5 打开被拒的空目录(系统保护区):像日志一样播报 ──
  const locked = dir('locked-vault', [], { truncated: true })
  annotateSummaries(dir('proj', [locked]))
  assert.ok(textOf(locked).includes('系统保护目录'), `被锁的空目录要说系统保护,实际:${textOf(locked)}`)

  // ── 9. 事实压过绰号 + 残账说"至少":空抽屉不喊绰号,截断的家底不报成总数 ──
  const emptyConfig = dir('config')
  annotateSummaries(dir('proj', [emptyConfig]))
  assert.ok(textOf(emptyConfig).includes('空的，还没有内容'), `探空的 config 要老实说空,实际:${textOf(emptyConfig)}`)

  const cutRoot = dir('huge', Array.from({ length: 3 }, (_, i) => file(`f${i}.ts`, TS)), { truncated: true })
  annotateSummaries(dir('proj', [cutRoot]))
  assert.ok(textOf(cutRoot).includes('至少 3 个文件'), `截断的家底要说「至少」,实际:${textOf(cutRoot)}`)

  const cutNotes = dir('notes', [file('a.md'), file('b.md'), file('c.md')], { truncated: true })
  annotateSummaries(dir('proj', [cutNotes]))
  assert.ok(textOf(cutNotes).includes('至少 3 份'), `截断的文档目录也要说「至少」,实际:${textOf(cutNotes)}`)

  // ── 10. 风险句标记:sticky 是数据标记(风险提示句),渲染层一律文字标注,不做 emoji 降噪 ──
  const stickyLock = file('yarn.lock')
  annotateSummaries(dir('proj', [stickyLock]))
  assert.ok(stickyLock.summary?.sticky === true && textOf(stickyLock).includes('不要手动改'), '风险句保留 sticky 标记')

  // ── 11. 词根词典(第九十九锤):名字拆词查表,业务起的名也有身份 ──
  const scannerFile = file('scanner.ts', TS)
  const gitFile = file('GitFileStatus.tsx')
  const askHook = file('useAiAsk.ts', TS)
  const dataUtil = file('dataUtils.ts', TS)
  const cssIndex = file('index.css', CSS)
  const sumDir = dir('summarizer', [file('index.ts', TS)])
  const graphDir = dir('dep_graph', [file('a.ts', TS)])
  annotateSummaries(dir('proj', [scannerFile, gitFile, askHook, dataUtil, cssIndex, sumDir, graphDir]))
  assert.ok(textOf(scannerFile).includes('扫描器'), `scanner → 扫描器,实际:${textOf(scannerFile)}`)
  assert.ok(textOf(gitFile).includes('git') && textOf(gitFile).includes('状态'), `GitFileStatus → git状态,实际:${textOf(gitFile)}`)
  assert.ok(textOf(askHook).includes('AI'), `useAiAsk → AI 询问,实际:${textOf(askHook)}`)
  assert.ok(textOf(dataUtil).includes('数据'), `dataUtils → 数据工具,实际:${textOf(dataUtil)}`)
  assert.ok(textOf(cssIndex).includes('样式') && !textOf(cssIndex).includes('索引'), 'index.css 不给「索引」空话')
  assert.ok(textOf(sumDir).includes('摘要器'), 'summarizer 目录 → 摘要器')
  assert.ok(textOf(graphDir).includes('依赖'), 'dep_graph 目录 → 依赖图')
  const genericApp = file('App.tsx', TS)
  annotateSummaries(dir('proj', [genericApp]))
  assert.equal(genericApp.summary, undefined, 'App.tsx 只剩「应用」空话,老实闭嘴')

  // ── 12. 文档读开头(第一百锤):有真标题亮真名,标题过长掐头留省略号 ──
  const titledDoc = file('a.md', undefined, '安装指南')
  const longDoc = file('b.md', undefined, '这是一个特别特别特别长的文档标题超出了预算')
  const titledTxt = file('c.txt', undefined, '随手记')
  const plainMd = file('d.md')
  annotateSummaries(dir('proj', [titledDoc, longDoc, titledTxt, plainMd]))
  assert.equal(textOf(titledDoc), '📖 文档：安装指南', `md 真标题亮真名,实际:${textOf(titledDoc)}`)
  assert.ok(textOf(longDoc).includes('…') && textOf(longDoc).length <= 24, `超长标题掐头留省略号,实际:${textOf(longDoc)}`)
  assert.equal(textOf(titledTxt), '📖 文档：随手记', 'txt 有标题也算文档')
  assert.equal(textOf(plainMd), '📖 文档', '没标题的 md 照旧范畴词')

  console.log('✅ 全树速览自测全部通过')
  console.log('   三档词条(沉默/说明/风险+行动) · 模式规则 · 范畴词与诚实话 · 目录正脸 · scripts 报数 · 家底聚合 · 未展开占位 · 锁定目录 · 事实压绰号 · 残账至少 · 风险句标记 · 词根词典')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
