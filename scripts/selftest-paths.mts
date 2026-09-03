import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { scanDirectory } from '../src/scanner/index.ts'
import { analyzeSource } from '../src/analyzer/index.ts'
import { joinRoot } from '../src/shared/paths.ts'
import type { ScanResult, ScanTreeNode } from '../src/shared/types.ts'

/** 深度优先收齐树里所有节点(relPath → 节点) */
function collectNodes(node: ScanTreeNode, into: Map<string, ScanTreeNode>): void {
  into.set(node.relPath, node)
  if (node.type === 'directory') for (const child of node.children) collectNodes(child, into)
}

/** 完整复刻主进程 atlas:analyze-file 的链路:joinRoot → stat → 读文件 → AST */
async function analyzeViaContract(result: ScanResult, relPath: string): Promise<unknown> {
  const absPath = joinRoot(result.rootPath, relPath)
  const stat = await fs.stat(absPath)
  assert.ok(stat.isFile(), `joinRoot 结果应是文件:${absPath}`)
  const code = await fs.readFile(absPath, 'utf8')
  return analyzeSource(code, 'typescript')
}

async function main(): Promise<void> {
  // ── 第一幕:拿真实项目根当靶子(npm test 时 cwd 就是项目根) ──
  const result = await scanDirectory(process.cwd())
  const nodes = new Map<string, ScanTreeNode>()
  collectNodes(result.tree, nodes)

  // 1. 回归核心:三个真实文件必须以精确的 relPath 存在,根名绝不能混进路径
  const targets = ['electron.vite.config.ts', 'src/main/index.ts', 'src/analyzer/index.ts']
  for (const relPath of targets) {
    assert.ok(nodes.has(relPath), `树里应能按 '${relPath}' 找到文件(找不到 = relPath 契约又坏了)`)
  }

  // 2. 重复拼接回归:任何节点的 relPath 都不许以根名开头,也不许含反斜杠
  for (const relPath of nodes.keys()) {
    assert.ok(!relPath.startsWith(`${result.rootName}/`), `relPath 混入了根名(重复拼接复发):${relPath}`)
    assert.ok(!relPath.includes('\\'), `relPath 分隔符必须是 '/':${relPath}`)
  }
  assert.equal(result.tree.relPath, '', '根节点 relPath 应为空字符串')

  // 3. 全链路:joinRoot → stat → 读 → AST,对三个靶子逐一走一遍
  for (const relPath of targets) {
    const structure = (await analyzeViaContract(result, relPath)) as { functions: string[] } | null
    assert.ok(structure, `AST 分析不应返回 null:${relPath}`)
    assert.ok(Array.isArray(structure.functions), `AST 结果应有 functions 数组:${relPath}`)
  }

  // 4. 越界拦截:上跳、绝对路径注入都不许溜出去
  assert.throws(() => joinRoot(result.rootPath, '../outside.txt'), /越界/, '../ 上跳未被拦截')
  assert.throws(() => joinRoot(result.rootPath, '/etc/passwd'), /越界/, '绝对路径注入未被拦截')
  if (process.platform === 'win32') {
    assert.throws(() => joinRoot(result.rootPath, 'C:\\Windows\\win.ini'), /越界/, '盘符注入未被拦截')
  }

  // ── 第二幕:中文 + 空格路径的临时项目 ──
  const fancyParent = join(tmpdir(), `中文 目录 ${Date.now()}`)
  const fancyRoot = join(fancyParent, 'code atlas')
  await fs.mkdir(join(fancyRoot, '深 处'), { recursive: true })
  await fs.writeFile(join(fancyRoot, '深 处', '小工具.ts'), 'export function 你好(): void {}')
  await fs.writeFile(join(fancyRoot, '配置文件.json'), '{}')
  try {
    const fancy = await scanDirectory(fancyRoot)
    const fancyNodes = new Map<string, ScanTreeNode>()
    collectNodes(fancy.tree, fancyNodes)
    const nested = fancyNodes.get('深 处/小工具.ts')
    assert.ok(nested && nested.type === 'file', `中文+空格路径应能精确定位:'深 处/小工具.ts'`)
    const absPath = joinRoot(fancy.rootPath, '深 处/小工具.ts')
    assert.ok((await fs.stat(absPath)).isFile(), '中文+空格路径经 joinRoot 后应能访问')
    const structure = await analyzeSource(await fs.readFile(absPath, 'utf8'), 'typescript')
    assert.deepEqual(structure?.functions, ['你好'], '中文函数名也应被 AST 认出来')
  } finally {
    await fs.rm(fancyParent, { recursive: true, force: true })
  }

  console.log('✅ 路径契约自测全部通过')
  console.log(`   靶子 ${targets.length} 个(根/一层/两层) · 越界样本全拦 · 中文空格路径 OK`)
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
