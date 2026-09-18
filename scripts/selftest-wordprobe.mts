// 划词问一问自测:组合键校验/录制、档位存档认读、抓取判定,全是纯函数,不碰真剪贴板不碰真热键。
import assert from 'node:assert/strict'
import {
  validateAccelerator,
  parseWordProbePrefs,
  acceleratorFromKeyEvent,
  isFreshGrab,
  createHotkeyBinder,
  WORD_PROBE_DEFAULT
} from '../src/shared/wordProbe.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('组合键校验:必须带 Ctrl/Alt 等够格修饰 + 合法主键', () => {
  assert.equal(validateAccelerator('Alt+Q'), true, 'Alt+Q 合法')
  assert.equal(validateAccelerator('Control+Shift+X'), true, 'Ctrl+Shift+X 合法')
  assert.equal(validateAccelerator('Super+F5'), true, 'Win+F5 合法')
  assert.equal(validateAccelerator('Shift+Q'), false, 'Shift 单独打字不算快捷键')
  assert.equal(validateAccelerator('Q'), false, '单键会抢死系统,不收')
  assert.equal(validateAccelerator('Alt+:'), false, '标点主键不收')
  assert.equal(validateAccelerator('Alt+中文'), false, '中文主键不收')
  assert.equal(validateAccelerator(''), false, '空串不收')
})

check('录制按键:修饰键归一、主键转大写、单按修饰键不算数、Esc 取消', () => {
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, key: 'q' }), 'Alt+Q')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, key: 'x' }), 'Control+Shift+X')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'F5' }), 'Control+F5')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, key: ' ' }), 'Alt+Space')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, key: 'ArrowUp' }), 'Alt+Up')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, key: 'q' }), null, '只有 Shift 不收')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, key: 'Shift' }), null, '单按修饰键不构成组合')
  assert.equal(acceleratorFromKeyEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: 'Escape' }), null, 'Esc 取消录制')
})

check('档位存档:坏档回出厂默认,半好半坏也不缝补', () => {
  assert.deepEqual(parseWordProbePrefs({ enabled: false, accelerator: 'Control+B' }), { enabled: false, accelerator: 'Control+B' }, '干净档原样认')
  assert.deepEqual(parseWordProbePrefs('垃圾'), WORD_PROBE_DEFAULT)
  assert.deepEqual(parseWordProbePrefs(null), WORD_PROBE_DEFAULT)
  assert.deepEqual(parseWordProbePrefs({ enabled: 'yes', accelerator: 'Alt+Q' }), WORD_PROBE_DEFAULT, '开关不是布尔不收')
  assert.deepEqual(parseWordProbePrefs({ enabled: true, accelerator: 'Q' }), WORD_PROBE_DEFAULT, '不合法的组合键不收')
  assert.deepEqual(parseWordProbePrefs({}), WORD_PROBE_DEFAULT, '空对象回默认')
})

check('抓取判定:非空且不同于备份才算「真抓到了」,其余当没选中、完全无反应', () => {
  assert.equal(isFreshGrab('新抓的', '备份'), true)
  assert.equal(isFreshGrab('备份', '备份'), false, '没选中(Ctrl+C 没改变剪贴板):无反应')
  assert.equal(isFreshGrab('   ', ''), false, '抓到空白:无反应')
  assert.equal(isFreshGrab('', ''), false, '什么都没有:无反应')
})

check('热键账房:换键摘旧键、关闭摘干净、注册失败不留账不瞎摘(幽灵热键修复)', () => {
  const calls: string[] = []
  let failNext = false
  const ops = {
    register: (acc: string): boolean => {
      calls.push(`+${acc}`)
      if (failNext) {
        failNext = false
        return false
      }
      return true
    },
    unregister: (acc: string): void => {
      calls.push(`-${acc}`)
    }
  }
  const fails: string[] = []
  const bind = createHotkeyBinder(ops, (acc) => fails.push(acc))
  const noop = (): void => {}

  bind({ enabled: true, accelerator: 'Alt+Q' }, noop) // 挂默认
  bind({ enabled: true, accelerator: 'Control+Shift+X' }, noop) // 换键:摘 Alt+Q 挂新键
  bind({ enabled: false, accelerator: 'Control+Shift+X' }, noop) // 关闭:摘干净不再挂
  bind({ enabled: true, accelerator: 'Alt+W' }, noop) // 重开:当前无账,直接挂
  failNext = true
  bind({ enabled: true, accelerator: 'Alt+E' }, noop) // 新键被占:摘旧账,注册失败不留账
  bind({ enabled: true, accelerator: 'Alt+R' }, noop) // 再换:无旧账可摘,不瞎摘

  assert.deepEqual(
    calls,
    ['+Alt+Q', '-Alt+Q', '+Control+Shift+X', '-Control+Shift+X', '+Alt+W', '-Alt+W', '+Alt+E', '+Alt+R'],
    '每次换键必须精确摘掉上一只,失败不留账'
  )
  assert.deepEqual(fails, ['Alt+E'], '只有注册失败的那次进失败账')
})

console.log('✅ 划词问一问自测全部通过')
