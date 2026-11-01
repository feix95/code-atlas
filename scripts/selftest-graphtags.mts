// 图谱标签改色自测:存档键独立于模块色、标签键按文本归一(首尾空白与大小写)、
// 改色与恢复默认仍走通用存档规则,非法颜色不落账。
import assert from 'node:assert/strict'
import { sanitizeColorPrefs, setColorIn } from '../src/renderer/src/graph/colorPrefs.ts'
import { TAG_COLOR_KEY, tagColorKey } from '../src/renderer/src/graph/tagColors.ts'

assert.equal(TAG_COLOR_KEY, 'atlas.graph.tag-colors', '标签色用独立存档键')
assert.equal(tagColorKey('  UI  '), 'ui', '首尾空白与大小写不另算标签')
assert.equal(tagColorKey('性能'), '性能')
assert.equal(tagColorKey(' '), '')

let prefs = setColorIn({}, '/proj', tagColorKey(' UI '), '#12A594')
assert.deepEqual(prefs, { '/proj': { ui: '#12a594' } })
prefs = setColorIn(prefs, '/proj', tagColorKey('ui'), '#FF0000')
assert.deepEqual(prefs, { '/proj': { ui: '#ff0000' } }, '同标签覆盖不新增条目')
prefs = setColorIn(prefs, '/other', tagColorKey('性能'), '#00FF00')
assert.deepEqual(prefs['/proj'], { ui: '#ff0000' }, '按项目分开存')
prefs = setColorIn(prefs, '/proj', tagColorKey('UI'), 'green')
assert.equal(prefs['/proj'], undefined, '非法颜色按恢复默认处理并清掉空项目')
prefs = setColorIn(prefs, '/proj', tagColorKey('UI'), null)
assert.equal(prefs['/proj'], undefined, '恢复默认后仍为空')

assert.deepEqual(
  sanitizeColorPrefs({ '/p': { 性能: '#00FF00', bad: 'red' }, broken: [1] }),
  { '/p': { 性能: '#00ff00' } },
  '读存档保留中文标签键、丢弃非法颜色'
)

console.log('✅ 图谱标签颜色自测全部通过')
