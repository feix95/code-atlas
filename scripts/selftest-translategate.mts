// 翻译门自测:谁能出「翻译成…」、程序文件碰巧叫 .txt 的挡掉、与排版显示拆开。
import assert from 'node:assert/strict'
import {
  canTranslate,
  translateFamilyOf,
  usesPlainTranslateView
} from '../src/shared/translateGate.ts'
import { canReadingMode } from '../src/renderer/src/paneTabs.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('md 系可翻,族是 markdown', () => {
  assert.equal(translateFamilyOf('docs/guide.md'), 'markdown')
  assert.equal(translateFamilyOf('a.markdown'), 'markdown')
  assert.equal(translateFamilyOf('page.mdx'), 'markdown')
  assert.equal(canTranslate('README.MD'), true)
  assert.equal(usesPlainTranslateView('README.md'), false)
})

check('txt/rst/adoc/asciidoc 可翻,对照走纯文本', () => {
  assert.equal(translateFamilyOf('notes.txt'), 'plaintext')
  assert.equal(translateFamilyOf('docs\\index.rst'), 'markup')
  assert.equal(translateFamilyOf('README.adoc'), 'markup')
  assert.equal(translateFamilyOf('book.asciidoc'), 'markup')
  assert.equal(usesPlainTranslateView('notes.txt'), true)
  assert.equal(usesPlainTranslateView('index.rst'), true)
})

check('LICENSE.txt 给人读,允许翻译', () => {
  assert.equal(canTranslate('LICENSE.txt'), true)
  assert.equal(canTranslate('license.TXT'), true)
})

check('程序文件碰巧叫 txt:不出翻译菜单', () => {
  for (const p of [
    'requirements.txt',
    'constraints.txt',
    'CMakeLists.txt',
    'robots.txt',
    'requirements-dev.txt',
    'dev-requirements.txt',
    'constraints-prod.txt',
    'test-constraints.txt'
  ]) {
    assert.equal(canTranslate(p), false, p)
    assert.equal(translateFamilyOf(p), null, p)
  }
})

check('源码配置图片音频没有翻译门', () => {
  for (const p of ['src/main.ts', 'package.json', '.env', 'photo.png', 'clip.mp3', 'a.html']) {
    assert.equal(canTranslate(p), false, p)
  }
})

check('翻译门与排版显示拆开:txt 能翻但不能排版', () => {
  assert.equal(canTranslate('notes.txt'), true)
  assert.equal(canReadingMode('notes.txt'), false)
  assert.equal(canReadingMode('guide.md'), true)
  assert.equal(canTranslate('guide.md'), true)
})

console.log('translategate: 全部通过')
