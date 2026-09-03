// AST 分析器自测:npm run test:analyzer(首次加载语法 wasm 约需几秒)
import assert from 'node:assert/strict'
import { analyzeSource, isAnalysisSupported } from '../src/analyzer/index.ts'

const TS_SOURCE = `
import { useState } from 'react'
import path from "node:path"
const fs = require('fs')

export interface Timer {
  seconds: number
}

export type Mode = 'focus' | 'break'

export const startTimer = (): void => {
  console.log('start')
}

const pauseTimer = (): void => {
  console.log('pause')
}

export class TimerStore {
  tick(): void {}
  reset(): void {}
}

function helper(): void {}
export default helper
`

const TSX_SOURCE = `
import { useState } from 'react'

export const TimerPanel = (): JSX.Element => {
  const [seconds] = useState(0)
  return <div className="timer">{seconds}</div>
}

function SmallButton() {
  return <button>ok</button>
}

const notAComponent = (): number => 42
`

const PY_SOURCE = `
import os
from pathlib import Path

class Timer:
    def start(self):
        pass

def pause_timer():
    pass

def _internal():
    pass
`

function assertContains(list: string[], expected: string[], label: string): void {
  for (const item of expected) {
    assert.ok(list.includes(item), `${label}: 应包含 ${item},实际 [${list.join(', ')}]`)
  }
}

async function main(): Promise<void> {
  // ── 一、TypeScript ──
  const ts = await analyzeSource(TS_SOURCE, 'typescript')
  assert.ok(ts, 'TypeScript 应可分析')
  assertContains(ts!.imports, ['react', 'node:path', 'fs'], 'TS imports')
  assertContains(ts!.functions, ['startTimer', 'pauseTimer', 'helper'], 'TS functions')
  assertContains(ts!.classes, ['TimerStore'], 'TS classes')
  assertContains(ts!.interfaces, ['Timer', 'Mode'], 'TS interface + type 别名')
  assertContains(ts!.exports, ['startTimer', 'TimerStore', 'helper'], 'TS exports')
  assert.ok(ts!.reactComponents.length === 0, '纯 TS 无 React 组件')

  // ── 二、TypeScript React:组件识别 ──
  const tsx = await analyzeSource(TSX_SOURCE, 'typescript-react')
  assert.ok(tsx, 'TSX 应可分析')
  assertContains(tsx!.reactComponents, ['TimerPanel', 'SmallButton'], 'TSX 组件(大写开头 + 文件含 JSX)')
  assert.ok(!tsx!.reactComponents.includes('notAComponent'), '小写箭头函数不算组件')
  assertContains(tsx!.imports, ['react'], 'TSX imports')

  // ── 三、Python ──
  const py = await analyzeSource(PY_SOURCE, 'python')
  assert.ok(py, 'Python 应可分析')
  assertContains(py!.imports, ['os', 'pathlib'], 'Py imports')
  assertContains(py!.functions, ['start', 'pause_timer', '_internal'], 'Py functions(含方法)')
  assertContains(py!.classes, ['Timer'], 'Py classes')

  // ── 四、能力边界:不支持的语言诚实返回 null ──
  assert.equal(isAnalysisSupported('go'), false, 'Go 暂不支持')
  assert.equal(await analyzeSource('anything', 'go'), null, '不支持的语言返回 null')
  assert.equal(await analyzeSource('anything', 'unknown'), null, '未知语言返回 null')

  // ── 五、坏代码不崩:解析器带 ERROR 节点也能提取出能提的 ──
  const broken = await analyzeSource('function broken( { const x = ', 'typescript')
  assert.ok(broken, '语法残缺也应返回结构')

  console.log('✅ AST 分析器自测全部通过')
  console.log(`   TS: 函数${ts!.functions.length} 类${ts!.classes.length} 接口${ts!.interfaces.length}`)
  console.log(`   TSX: 组件 [${tsx!.reactComponents.join(', ')}]`)
  console.log(`   Py: 函数${py!.functions.length} 类${py!.classes.length}`)
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
