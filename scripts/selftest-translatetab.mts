// 译文签命名自测:开镜像签与就地换语种共用 translationTabName ——
// 签脸只认文件名(目录不进脸),语种中文名只认 shared/translateLangs 的登记。
import assert from 'node:assert/strict'
import { translationTabName } from '../src/renderer/src/paneTabs.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('translationTabName:文件名 + 语种中文名', () => {
  assert.equal(translationTabName('docs/guide.md', 'ja'), 'guide.md · 日本語')
})

check('translationTabName:Windows 分隔符也认,目录不进签脸', () => {
  assert.equal(translationTabName('docs\\deep\\a.md', 'zh-CN'), 'a.md · 中文（简体）')
})

check('translationTabName:不认识的语种代号原样兜底', () => {
  assert.equal(translationTabName('a.md', 'xx'), 'a.md · xx')
})
