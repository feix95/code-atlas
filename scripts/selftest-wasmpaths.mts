// wasm 寻路员的自测:纯 node 直跑(项目根),不碰 electron。
// 覆盖:开发态回退 node_modules(文件真实存在)、打包态认文件切换、目录没货老实回退、
// 两家模块实际用到的语法字典在 node_modules 里一件不缺(新加语言忘了带行李当场报警)。
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineWasmPath, grammarWasmDir } from '../src/native/wasmPaths.ts'
import { GRAMMAR_WASM, LANG_TO_GRAMMAR } from '../src/shared/grammarWasm.ts'
import { GRAMMAR_FILES as HL_FILES } from '../src/highlight/index.ts'
import { GRAMMAR_FILES as ANALYZER_FILES } from '../src/analyzer/index.ts'

let passed = 0
const failed: string[] = []
function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed.push(name)
    console.log(`  ✗ ${name}`)
  }
}

const CWD = process.cwd()

console.log('── 开发态(resourcesPath 没有或没货)→ 回退 node_modules ──')
{
  const engine = engineWasmPath({ resourcesPath: undefined, cwd: CWD })
  const grammars = grammarWasmDir({ resourcesPath: undefined, cwd: CWD })
  ok(
    engine.endsWith('node_modules\\web-tree-sitter\\tree-sitter.wasm') ||
      engine.includes('web-tree-sitter'),
    '引擎路径指向 node_modules 的 web-tree-sitter'
  )
  ok(existsSync(engine), '引擎 wasm 真实存在(dev 家底在)')
  ok(grammars.includes('tree-sitter-wasms'), '字典目录指向 node_modules 的 tree-sitter-wasms')
  ok(existsSync(grammars), '字典目录真实存在')

  // dev 态 Electron 也会挂 resourcesPath(指向 electron 发行包),但那里没咱的货 → 照样回退
  const fakeRes = join(tmpdir(), 'code-atlas-selftest-empty-res')
  mkdirSync(fakeRes, { recursive: true })
  const engine2 = engineWasmPath({ resourcesPath: fakeRes, cwd: CWD })
  ok(
    engine2.includes('web-tree-sitter'),
    'resourcesPath 有值但没行李 → 仍走 node_modules(不瞎信环境)'
  )
  rmSync(fakeRes, { recursive: true, force: true })
}

console.log('── 打包态(resources/wasm/ 里引擎真在)→ 切行李箱 ──')
{
  const fake = mkdtempSync(join(tmpdir(), 'code-atlas-wasmpaths-'))
  const wasmDir = join(fake, 'wasm')
  mkdirSync(wasmDir, { recursive: true })
  writeFileSync(join(wasmDir, 'tree-sitter.wasm'), 'fake engine')

  ok(
    engineWasmPath({ resourcesPath: fake, cwd: CWD }) === join(wasmDir, 'tree-sitter.wasm'),
    '引擎路径切到 resources/wasm/'
  )
  ok(
    grammarWasmDir({ resourcesPath: fake, cwd: CWD }) === wasmDir,
    '字典目录切到 resources/wasm/(平铺)'
  )

  rmSync(join(wasmDir, 'tree-sitter.wasm'))
  ok(
    engineWasmPath({ resourcesPath: fake, cwd: CWD }).includes('web-tree-sitter'),
    '行李箱里引擎被拿走 → 回退 node_modules(认文件不认环境)'
  )

  rmSync(fake, { recursive: true, force: true })
}

console.log('── 行李清单对账:两家用到的语法字典,electron-builder.yml 的 filter 必须全带上 ──')
{
  const yml = readFileSync(join(CWD, 'electron-builder.yml'), 'utf8')
  const allFiles = new Set([...Object.values(HL_FILES), ...Object.values(ANALYZER_FILES)])
  const missing = [...allFiles].filter((file) => !yml.includes(file))
  ok(
    missing.length === 0,
    `两家用到的 ${allFiles.size} 个语法字典全在打包清单里${missing.length ? `(缺:${missing.join('、')})` : ''}`
  )

  // 语法总账自洽:户口本→语法的桥,每个目的地在语法账里都有行李;两家用的件都是账上的
  const badBridges = Object.entries(LANG_TO_GRAMMAR).filter(
    ([, g]) => GRAMMAR_WASM[g] === undefined
  )
  ok(
    badBridges.length === 0,
    `LANG_TO_GRAMMAR 每座桥都通语法账${badBridges.length ? `(断桥:${badBridges.map(([id]) => id).join('、')})` : ''}`
  )
  const offLedger = [...allFiles].filter(
    (f) => typeof f !== 'string' || !f.endsWith('.wasm') || !Object.values(GRAMMAR_WASM).includes(f)
  )
  ok(
    offLedger.length === 0,
    `两家用的字典全在语法账上${offLedger.length ? `(账外:${offLedger.join('、')})` : ''}`
  )

  // dev 家底也在:node_modules 里这些文件真实存在,不然自测跑不了真解析
  const grammarsDir = grammarWasmDir({ resourcesPath: undefined, cwd: CWD })
  const absentOnDisk = [...allFiles].filter((file) => !existsSync(join(grammarsDir, file)))
  ok(
    absentOnDisk.length === 0,
    `dev 家底 ${allFiles.size} 件字典真实在盘上${absentOnDisk.length ? `(缺:${absentOnDisk.join('、')})` : ''}`
  )
}

console.log(`\n${passed} 项通过,${failed.length} 项失败`)
if (failed.length > 0) {
  console.error('失败清单:', failed)
  process.exit(1)
}
