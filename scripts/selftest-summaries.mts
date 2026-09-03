import assert from 'node:assert/strict'
import { annotateSummaries } from '../src/summarizer/index.ts'
import type { LanguageTag, ScanDirNode, ScanFileNode } from '../src/shared/types.ts'

let fileSeq = 0

function file(name: string, language?: LanguageTag): ScanFileNode {
  fileSeq++
  const dot = name.lastIndexOf('.')
  return {
    type: 'file',
    name,
    relPath: `f${fileSeq}/${name}`,
    ext: dot > 0 ? name.slice(dot).toLowerCase() : '',
    ...(language ? { language } : {})
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
  // ── 1. 文件名字典:大小写不敏感 ──
  const pkg = file('package.json')
  const readme = file('README.MD')
  const gitignore = file('.gitignore')
  annotateSummaries(dir('proj', [pkg, readme, gitignore]))
  assert.ok(textOf(pkg).includes('身份证'), 'package.json 是项目身份证')
  assert.ok(textOf(readme).includes('门面'), 'README 大写也得认出来')
  assert.ok(textOf(gitignore).startsWith('🚫'), '.gitignore 用 🚫')

  // ── 2. 名字模式规则:tsconfig 变体 / eslint / env / 打包流水线 ──
  const cases: Array<[ScanFileNode, string]> = [
    [file('tsconfig.node.json'), 'TypeScript 的尺子'],
    [file('eslint.config.mjs'), '体检医生'],
    [file('.env.local'), '环境变量'],
    [file('electron.vite.config.ts'), '打包流水线'],
    [file('vite.config.js'), '打包流水线'],
    [file('CLAUDE.md'), 'AI 说明书'],
    [file('package-lock.json'), '别手改'],
    [file('foo.test.ts'), '考卷'],
    [file('bar.spec.js'), '考卷'],
    [file('selftest-ai.mts'), '考卷'],
    [file('types.d.ts'), '类型说明书'],
    [file('something.config.yaml'), '配置文件']
  ]
  for (const [node, keyword] of cases) {
    annotateSummaries(dir('p', [node]))
    assert.ok(textOf(node).includes(keyword), `${node.name} 应提到「${keyword}」,实际:${textOf(node)}`)
  }

  // ── 3. 角色与内容兜底:入口 / 后缀字典 / 语言 / 诚实话 ──
  const entry = file('index.ts', TS)
  const cssFile = file('index.css', CSS) // css 不是代码语言,不该被当成入口
  const kt = file('mystery.kt', KOTLIN)
  const unknownExt = file('blob.xyz')
  const noExt = file('deploy')
  annotateSummaries(dir('p', [entry, cssFile, kt, unknownExt, noExt]))
  assert.ok(textOf(entry).includes('入口'), '代码语言的 index.ts 是入口')
  assert.ok(textOf(cssFile).startsWith('🎨'), 'index.css 走样式,不是入口')
  assert.ok(textOf(kt).includes('Kotlin 源代码'), '认不出的名字靠语言兜底')
  assert.ok(textOf(unknownExt).includes('.xyz'), '陌生后缀要诚实说没认出')
  assert.ok(textOf(noExt).includes('没有后缀名'), '无后缀要诚实说')

  // ── 4. 目录名字典:src / 灵感箱 / 外来户 / 测试 ──
  const src = dir('src', [file('a.ts', TS)])
  const insp = dir('inspiration', [file('idea.md')])
  const vendor = dir('vendor', [file('lib.so')])
  const tests = dir('tests', [file('x.test.ts', TS)])
  annotateSummaries(dir('proj', [src, insp, vendor, tests]))
  assert.ok(textOf(src).includes('本体所在'), 'src 是本体')
  assert.ok(textOf(insp).includes('灵感收集箱'), 'inspiration 是灵感箱')
  assert.ok(textOf(vendor).includes('外来户'), 'vendor 是外来户')
  assert.ok(textOf(tests).startsWith('🧪'), 'tests 是测试')

  // ── 5. scripts 目录看内容改口:大半是自测就说自测工具箱(带数量) ──
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
  assert.ok(textOf(selftests).includes('自测工具箱'), '全自测的 scripts 要改口')
  assert.ok(textOf(selftests).includes('7 个测试脚本'), '要说清有几个测试脚本')

  const mixedScripts = dir('scripts', [file('deploy.ps1'), file('build.sh')])
  annotateSummaries(dir('proj', [mixedScripts]))
  assert.ok(textOf(mixedScripts).includes('工具脚本'), '不含自测的 scripts 说工具脚本')

  // ── 6. 内容兜底:没名字线索时看装了啥 ──
  const mysteryCode = dir('mystery', Array.from({ length: 5 }, (_, i) => file(`m${i}.ts`, TS)))
  const notes = dir('notes', [file('a.md'), file('b.txt')])
  const empty = dir('empty')
  const drawers = dir('drawers', [dir('x'), dir('y'), dir('z')])
  annotateSummaries(dir('proj', [mysteryCode, notes, empty, drawers]))
  assert.ok(textOf(mysteryCode).includes('5 个文件') && textOf(mysteryCode).includes('TypeScript'), '内容兜底要说数量和主语言')
  assert.ok(textOf(notes).startsWith('📚') && textOf(notes).includes('资料间'), '全文档目录是资料间')
  assert.ok(textOf(empty).includes('空文件夹'), '空目录老实说空')
  assert.ok(textOf(drawers).includes('3 个子文件夹'), '只有子目录要说抽屉数')

  // ── 7. 根节点聚合:子孙的家底全算进来,每个节点都有标签 ──
  const root = dir('code-atlas', [
    dir('src', [file('a.ts', TS), file('b.ts', TS), file('index.ts', TS)]),
    dir('docs', [file('guide.md'), file('faq.md')]),
    file('package.json')
  ])
  annotateSummaries(root)
  assert.ok(textOf(root).includes('6 个文件'), '根的家底要含全部子孙(3+2+1)')
  assert.ok(textOf(root).includes('TypeScript'), '根的主语言要看全部子孙')
  assert.ok(textOf(root.children[0]).includes('本体所在'), '子目录各自有标签')
  const allTagged = (n: ScanDirNode): boolean =>
    n.summary !== undefined && n.children.every((c) => (c.type === 'directory' ? allTagged(c) : c.summary !== undefined))
  assert.ok(allTagged(root), '整棵树每个节点都有速览标签')

  // ── 8. 分级扫描占位:没探过的目录要老实说"还没探",不许装成空文件夹 ──
  const lazyPlain = dir('mystery-plain', [], { lazy: true })
  const lazyVideos = dir('videos', [], { lazy: true })
  annotateSummaries(dir('proj', [lazyPlain, lazyVideos]))
  assert.ok(textOf(lazyPlain).includes('还没探'), '没名字线索的未探目录要老实说还没探,不是空')
  assert.ok(textOf(lazyVideos).startsWith('🖼️'), '名字认得出的未探目录保留字典标签(素材库)')

  console.log('✅ 全树速览自测全部通过')
  console.log('   文件名字典 · 模式规则 · 角色与内容兜底 · 目录名字典 · scripts 看内容改口 · 家底聚合 · 整树全覆盖 · 未探占位')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
