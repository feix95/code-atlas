// 巨石棘轮闸:src/ 内手写源码单文件行数红线——非白名单文件超 MAX_LINES 即红灯;
// 白名单巨石按基线只许瘦不许胖,瘦回线内会提醒毕业除名
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '..', 'src')
const MAX_LINES = 1000
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|css)$/

// 现存巨石登记处:值 = 当前行数基线,只降不许升;瘦到 MAX_LINES 以内就该除名
const GIANTS: Record<string, number> = {
  'main/index.ts': 3299,
  'renderer/src/App.tsx': 2279,
  'renderer/src/assets/main.css': 6508,
  'ai/index.ts': 1618,
  'renderer/src/components/SettingsDialog.tsx': 1588
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (CODE_EXT.test(entry.name)) out.push(p)
  }
  return out
}

const violations: string[] = []
const graduated: string[] = []
const seen = new Set<string>()

for (const file of walk(SRC_DIR)) {
  const rel = file.slice(SRC_DIR.length + 1).replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split('\n').length
  const baseline = GIANTS[rel]
  if (baseline !== undefined) {
    seen.add(rel)
    if (lines > baseline) violations.push(`${rel} 长胖了:${baseline} → ${lines}(只许瘦不许胖)`)
    else if (lines <= MAX_LINES) graduated.push(`${rel} 瘦回 ${lines} 行,可从白名单除名`)
    continue
  }
  if (lines > MAX_LINES) violations.push(`${rel} 新巨石:${lines} 行 > ${MAX_LINES}`)
}

for (const rel of Object.keys(GIANTS)) {
  if (!seen.has(rel)) violations.push(`${rel} 登记在册但文件不在了——若已拆没请除名`)
}

for (const v of violations) console.error(`✗ ${v}`)
for (const g of graduated) console.log(`◎ ${g}`)
assert.equal(violations.length, 0, '巨石棘轮闸有红灯')

console.log('✅ 巨石棘轮闸全绿')
