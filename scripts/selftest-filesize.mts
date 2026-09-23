// 单文件行数棘轮闸:src/ 内手写源码超 MAX_LINES 即红灯;
// 白名单内现存超限文件按基线只降不升,瘦回线内提醒毕业除名
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '..', 'src')
const MAX_LINES = 1000
const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|css)$/

// 现存超限文件登记处:值 = 当前行数基线,只降不许升;瘦到 MAX_LINES 以内就该除名
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
    if (lines > baseline) violations.push(`${rel} 超过基线:${baseline} → ${lines}(只降不升)`)
    else if (lines <= MAX_LINES) graduated.push(`${rel} 已回落 ${lines} 行,可从白名单除名`)
    continue
  }
  if (lines > MAX_LINES) violations.push(`${rel} 新增超限文件:${lines} 行 > ${MAX_LINES}`)
}

for (const rel of Object.keys(GIANTS)) {
  if (!seen.has(rel)) violations.push(`${rel} 登记在册但文件不在了——若已拆没请除名`)
}

for (const v of violations) console.error(`✗ ${v}`)
for (const g of graduated) console.log(`◎ ${g}`)
assert.equal(violations.length, 0, '单文件行数棘轮闸有红灯')

console.log('✅ 单文件行数棘轮闸全绿')
