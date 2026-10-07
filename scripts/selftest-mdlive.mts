import assert from 'node:assert/strict'
import { planLiveDecosForText, type LiveDeco } from '../src/renderer/src/editor/markdownLive.ts'

/**
 * Live Preview 装饰清单自测(md 三档锤):
 * 对 planLiveDecosForText 出的「装饰清单」对账 —— 每条清单都会落成 CM 装饰,
 * 清单对 = 脸上对。核心口径:光标不在的地方上妆,光标所在的块卸妆露源码。
 */

function has(plan: LiveDeco[], pred: (d: LiveDeco) => boolean, label: string): void {
  assert.ok(plan.some(pred), `应有一条: ${label}`)
}
function lacks(plan: LiveDeco[], pred: (d: LiveDeco) => boolean, label: string): void {
  assert.ok(!plan.some(pred), `不该有: ${label}`)
}
const isHide = (d: LiveDeco): d is Extract<LiveDeco, { t: 'hide' }> => d.t === 'hide'
const ofType =
  <T extends LiveDeco['t']>(t: T) =>
  (d: LiveDeco): d is Extract<LiveDeco, { t: T }> =>
    d.t === t

function main(): void {
  // ── 一、标题:# 化妆成大字行,记号藏起来 ──
  // '# 标题' 占 0~4;光标放后面段落 = 标题不在场
  let text = '# 标题\n\n正文段落\n'
  let plan = planLiveDecosForText(text, 9, 9)
  has(plan, (d) => d.t === 'line' && d.from === 0 && d.cls === 'cm-live-h1', '一级标题行皮')
  has(plan, (d) => d.t === 'hide' && d.from === 0 && d.to === 2, '"# " 连空格藏掉')
  // 光标进标题行 = 卸妆:# 记号露出,行皮照留(Obsidian 同款)
  plan = planLiveDecosForText(text, 2, 2)
  has(plan, (d) => d.t === 'line' && d.cls === 'cm-live-h1', '在场标题行皮照留')
  lacks(plan, ofType('hide'), '在场标题不该藏记号')

  // ── 二、行内件:**粗** *斜* ~~删~~ `代码` [链](址) ──
  text = '一段 **粗体** 和 *斜体* 和 ~~删除~~ 和 `code` 和 [文档](doc.md)\n\n收尾行\n'
  const tail = text.length // 光标钉尾 = 上面全不在场
  plan = planLiveDecosForText(text, tail, tail)
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-strong', '粗体染色')
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-em', '斜体染色')
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-del', '删除线染色')
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-code', '行内代码药丸皮')
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-link', '链接染主题色')
  // 记号全藏:粗体两对 **(4 个 mark 位)、斜体 2、删线 2、反引号 2、链接括号+url 一段
  assert.ok(plan.filter(isHide).length >= 9, '记号藏账至少 9 笔(*/**各两、~~两、``两、链接一串)')
  // 光标怼进粗体里 = 那块的 ** 露出来,别的记号照藏
  const strongAt = text.indexOf('粗体')
  plan = planLiveDecosForText(text, strongAt, strongAt)
  lacks(plan, (d) => isHide(d) && d.from >= strongAt - 2 && d.to <= strongAt + 4, '在场粗体不藏 **')
  has(plan, (d) => isHide(d) && text.slice(d.from, d.to) === '~~', '别处记号照藏')

  // ── 三、列表:无序换圆点、有序染号、待办换真框 ──
  text = '- 苹果\n1. 第一\n- [ ] 没干\n- [x] 干了\n\n完事\n'
  const end = text.length
  plan = planLiveDecosForText(text, end, end)
  assert.equal(plan.filter(ofType('bullet')).length, 3, '三个无序记号换圆点')
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-num', '有序号染主题色')
  const tasks = plan.filter(ofType('task'))
  assert.deepEqual(
    tasks.map((d) => d.checked),
    [false, true],
    '[ ]/[x] 换成复选框,勾态认字'
  )
  // 光标踩进待办行 = 那一项卸妆,记号回原形
  plan = planLiveDecosForText(text, text.indexOf('没'), text.indexOf('没'))
  lacks(plan, (d) => d.t === 'task' && d.from === text.indexOf('[ ]'), '在场待办不换框')

  // ── 四、块级件:引用 / 代码块 / 分割线 / 表格 ──
  text = '前文\n\n> 引用一行\n> 又一行\n\n下文\n'
  plan = planLiveDecosForText(text, end, end)
  assert.equal(
    plan.filter((d) => d.t === 'line' && d.cls === 'cm-live-quote').length,
    2,
    '引用两行都上竖条皮'
  )
  assert.equal(plan.filter(isHide).length, 2, '两个 > 记号藏掉')

  text = '前文\n\n```js\nlet a = 1\n```\n\n后文\n'
  plan = planLiveDecosForText(text, text.length, text.length)
  assert.equal(
    plan.filter((d) => d.t === 'line' && d.cls.includes('cm-live-codeblock')).length,
    3,
    '围栏三行(含```行)都铺代码底'
  )
  assert.equal(
    plan.filter((d) => d.t === 'line' && d.cls.includes('cm-live-fence')).length,
    2,
    '首尾 ``` 行压暗'
  )

  text = '上段\n\n---\n\n下段\n'
  plan = planLiveDecosForText(text, text.length, text.length)
  has(plan, ofType('hr'), '分割线换真横线')
  // 光标压分割线上 = 露源码
  plan = planLiveDecosForText(text, text.indexOf('---'), text.indexOf('---'))
  lacks(plan, ofType('hr'), '在场分割线不换横线')

  text = '前文\n\n| 名 | 价 |\n| --- | --- |\n| 苹果 | 3 |\n\n后文\n'
  plan = planLiveDecosForText(text, text.length, text.length)
  const tbl = plan.find(ofType('table'))
  assert.ok(tbl, '表格整块换真表格')
  assert.ok(text.slice(tbl!.from, tbl!.to).includes('| 苹果 | 3 |'), '表格替身要罩住整段源码')
  // 光标进表格 = 整段露源码(不是只露一行)
  plan = planLiveDecosForText(text, text.indexOf('苹果'), text.indexOf('苹果'))
  lacks(plan, ofType('table'), '在场表格不换装')

  // ── 五、下划线标题(Setext):本体行上妆,=== 行收摊 ──
  text = '标题字\n===\n\n正文\n'
  plan = planLiveDecosForText(text, text.length, text.length)
  has(plan, (d) => d.t === 'line' && d.from === 0 && d.cls === 'cm-live-h1', 'setext 标题行皮')
  has(plan, (d) => d.t === 'line' && d.cls === 'cm-live-setext', '=== 行收摊成零高')

  // ── 六、裸 URL 与图片:Autolink 本体不藏,图片记号收 ──
  text = '<https://x.y> 和 ![图](p.png)\n\n尾\n'
  plan = planLiveDecosForText(text, text.length, text.length)
  lacks(
    plan,
    (d) => isHide(d) && text.slice(d.from, d.to).includes('https://x.y'),
    'Autolink 的 URL 是内容本体,不许藏'
  )
  has(plan, (d) => d.t === 'mark' && d.cls === 'cm-live-img', '图片染哑灰')

  console.log('✅ Live Preview 装饰清单自测全部通过')
  console.log('   标题行皮/记号卸妆 · 行内五件 · 列表三态 · 引用/围栏/hr/表格 · setext 收摊')
}

main()
