// 自测:规划输入装配。图节点与事实结构合并、根文档筛选、清单脚本透传,全用假依赖。
import assert from 'node:assert/strict'
import { assembleWikiPlanInput } from '../src/wiki/wikiPlanInput.ts'

const input = await assembleWikiPlanInput('/proj', 'demo', {
  buildGraph: async () => ({
    nodes: [
      { relPath: 'src/a.ts', languageId: 'typescript', inCount: 2, outCount: 1 },
      { relPath: 'src/b.ts', languageId: 'typescript', inCount: 1, outCount: 0 }
    ],
    edges: [{ from: 'src/a.ts', to: 'src/b.ts' }]
  }),
  listFiles: async () => ['src/b.ts', 'README.md', 'src/a.ts', 'docs/guide.md', 'logo.png'],
  fileSize: async (_root, relPath) => relPath.length * 10,
  structureOf: (relPath) =>
    relPath === 'src/a.ts'
      ? {
          languageId: 'typescript',
          exports: ['runA'],
          functions: ['runA'],
          classes: [],
          reactComponents: []
        }
      : null,
  readManifest: async () => ({ path: 'package.json', scripts: ['dev', 'build'] })
})

assert.equal(input.projectName, 'demo')
assert.deepEqual(
  input.files.map((file) => file.relPath),
  ['README.md', 'docs/guide.md', 'logo.png', 'src/a.ts', 'src/b.ts'],
  '文件按路径排序'
)
const a = input.files.find((file) => file.relPath === 'src/a.ts')!
assert.deepEqual(a.exports, ['runA'])
assert.equal(a.inCount, 2)
assert.equal(a.outCount, 1)
const logo = input.files.find((file) => file.relPath === 'logo.png')!
assert.equal(logo.languageId, '', '图外文件语言为空串')
assert.equal(logo.inCount, 0)
assert.deepEqual(input.rootDocs, ['README.md'], '根文档只取根目录 Markdown')
assert.equal(input.manifestPath, 'package.json')
assert.deepEqual(input.manifestScripts, ['dev', 'build'])
assert.equal(input.edges.length, 1)

const bare = await assembleWikiPlanInput('/proj', 'bare', {
  buildGraph: async () => ({ nodes: [], edges: [] }),
  listFiles: async () => [],
  fileSize: async () => 0,
  structureOf: () => null,
  readManifest: async () => null
})
assert.equal(bare.manifestPath, null)
assert.deepEqual(bare.manifestScripts, [])

console.log('selftest-wikiplaninput ok')
