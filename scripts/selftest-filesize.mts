// 单文件有效代码行闸:≤CODE_MAX 通过,≥CODE_MAX+1 红灯;
// 纯数据表/图标册/跨进程契约登 CODE_CAPS,过各自上限即红灯。
// 只扫 src/ 下 ts/tsx/mts/cts/js/jsx/css;*.d.ts 与 scripts/ 自测不扫。
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '..', 'src')
const CODE_MAX = 300
const WARN_NEAR = 10
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|css)$/

// 允许超过 CODE_MAX 的文件 → 有效代码上限。未登记的一律 CODE_MAX。
// key 必须是 src/ 下相对路径,分隔符只用 /;Windows 的 \ 要先换成 / 再查表。
const CODE_CAPS: Record<string, number> = {
  'renderer/src/components/Icons.tsx': 1000,
  'summarizer/words.ts': 500,
  'summarizer/dictionary.ts': 500,
  'shared/types.ts': 400,
  'renderer/src/assets/css/tokens.css': 400
}

function isGatedName(name: string): boolean {
  if (name.endsWith('.d.ts')) return false
  return CODE_EXT.test(name)
}

/** src/ 相对路径,分隔符统一成 / */
function srcRel(abs: string): string {
  return abs.slice(SRC_DIR.length + 1).replaceAll('\\', '/')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (isGatedName(entry.name)) out.push(p)
  }
  return out
}

/** 去掉块注释、整行 // 注释和空行后的有效代码行;判空行先 trim(CRLF 行尾一并去掉) */
function codeLineCount(src: string): number {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock.split('\n').filter((line) => {
    const t = line.trim()
    return t !== '' && !t.startsWith('//')
  }).length
}

assert.equal(srcRel(join(SRC_DIR, 'highlight', 'index.ts')), 'highlight/index.ts')
assert.equal(srcRel(join(SRC_DIR, 'depgraph', 'index.ts')), 'depgraph/index.ts')
assert.notEqual(
  srcRel(join(SRC_DIR, 'highlight', 'index.ts')),
  srcRel(join(SRC_DIR, 'preload', 'index.ts')),
  '同名文件按相对路径区分,不能只按文件名登记'
)
assert.equal(isGatedName('env.d.ts'), false, '*.d.ts 不扫')
assert.equal(isGatedName('types.ts'), true)
assert.equal(codeLineCount('const u = "http://x.com"\n'), 1, '字符串里的 // 不算注释')
assert.equal(codeLineCount('const x = 1 /* tmp */\n'), 1, '一行代码带块注释仍算一行')
assert.equal(codeLineCount('const a = 1\n/*\nskip\nme\n*/\nconst b = 2\n'), 2, '多行块注释中间几行去掉')
assert.equal(codeLineCount('}\n'), 1, '单独的 } 算代码')
assert.equal(codeLineCount('const x = 1\r\n\r\n// hi\r\n}\r\n'), 2, 'CRLF 空行与注释行去掉')

const violations: string[] = []
const near: string[] = []

for (const file of walk(SRC_DIR)) {
  const rel = srcRel(file)
  const src = readFileSync(file, 'utf8')
  const cap = CODE_CAPS[rel] ?? CODE_MAX
  const code = codeLineCount(src)
  if (code > cap) {
    const hint =
      rel in CODE_CAPS
        ? `CODE_CAPS 上限 ${cap}`
        : `默认 ${CODE_MAX};数据表/图标册/跨进程契约登 CODE_CAPS 并写明上限,其余按职责拆文件`
    violations.push(`${rel} 有效代码 ${code} 行 > ${hint}`)
  } else if (code >= cap - WARN_NEAR) {
    near.push(`${rel} 有效代码 ${code} / ${cap}`)
  }
}

for (const rel of Object.keys(CODE_CAPS)) {
  const abs = join(SRC_DIR, rel)
  try {
    readFileSync(abs)
  } catch {
    violations.push(`${rel} 登记在 CODE_CAPS 但文件不在了——若已拆没请除名`)
  }
}

if (near.length) {
  console.log('⚠️ 快贴线(不红灯,先拆再追加):')
  for (const n of near) console.log(`  ${n}`)
}

for (const v of violations) console.error(`✗ ${v}`)
assert.equal(violations.length, 0, '单文件行数闸有红灯')

console.log('✅ 单文件行数闸全绿')
