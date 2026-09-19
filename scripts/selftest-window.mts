// 窗口尺寸记事本自测(第七十八锤):存档的认读、贴屏落位的各种旧世界,全用假屏幕数据
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import {
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  parseWindowState,
  placeWindowBox,
  readWindowState,
  writeWindowState
} from '../src/main/window-state.ts'
import { MASCOT_SIZE, mainPanelMenuLabel, mascotCursorInside, mascotMenuLabel, parseMascotState, placeMascotBox, readMascotState, writeMascotState } from '../src/main/mascotState.ts'
import { MainPanelController } from '../src/main/mainPanel.ts'

/** 本机假定的工作区:主屏 2560×1400,左边挂一块 1920×1040(负坐标) */
const WORK_AREAS = [
  { x: 0, y: 0, width: 2560, height: 1400 },
  { x: -1920, y: 0, width: 1920, height: 1040 }
]

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('parseWindowState:干净存档原样认回(负坐标多屏也认)', () => {
  const saved = parseWindowState({ box: { x: -1920, y: 0, width: 1200, height: 800 }, maximized: false })
  assert.deepEqual(saved, { box: { x: -1920, y: 0, width: 1200, height: 800 }, maximized: false })
})

check('parseWindowState:小数就地取整', () => {
  const saved = parseWindowState({ box: { x: 10.4, y: -3.6, width: 1000.6, height: 700.2 }, maximized: true })
  assert.equal(saved!.box.x, 10)
  assert.equal(saved!.box.y, -4)
  assert.equal(saved!.box.width, 1001)
  assert.equal(saved!.box.height, 700)
  assert.equal(saved!.maximized, true)
})

check('parseWindowState:垃圾一概不认', () => {
  for (const junk of [null, 'x', 42, [], { box: null }, { box: 'x' }, { box: {} }, { box: { x: 0, y: 0, width: 'a', height: 800 } }, { box: { x: 0, y: 0, width: NaN, height: 800 } }, { box: { x: Infinity, y: 0, width: 1000, height: 700 } }, { box: { x: 0, y: 0, width: 1000 } }]) {
    assert.equal(parseWindowState(junk), null, `应回 null:${JSON.stringify(junk)}`)
  }
})

check('parseWindowState:块头小于窗口下限就夹到下限;maximized 缺省当 false', () => {
  const saved = parseWindowState({ box: { x: 0, y: 0, width: 400, height: 100 } })
  assert.equal(saved!.box.width, WINDOW_MIN_WIDTH)
  assert.equal(saved!.box.height, WINDOW_MIN_HEIGHT)
  assert.equal(saved!.maximized, false)
})

check('placeWindowBox:完好存档原样落位', () => {
  assert.deepEqual(placeWindowBox({ x: 100, y: 50, width: 1200, height: 800 }, WORK_AREAS), {
    x: 100,
    y: 50,
    width: 1200,
    height: 800
  })
})

check('placeWindowBox:超大存档夹到最大那块屏的块头', () => {
  const placed = placeWindowBox({ x: 0, y: 0, width: 4000, height: 2000 }, WORK_AREAS)
  assert.equal(placed.width, 2560)
  assert.equal(placed.height, 1400)
  assert.equal(placed.x, 0)
})

check('placeWindowBox:完全出屏的窗拽回主屏', () => {
  assert.deepEqual(placeWindowBox({ x: 5000, y: 5000, width: 1200, height: 800 }, WORK_AREAS), {
    x: 32,
    y: 32,
    width: 1200,
    height: 800
  })
})

check('placeWindowBox:只露 60px 的窄边也当看不见,拽回', () => {
  const placed = placeWindowBox({ x: 2500, y: 0, width: 1200, height: 800 }, WORK_AREAS)
  assert.equal(placed.x, 32)
  assert.equal(placed.y, 32)
})

check('placeWindowBox:左屏的旧记忆落回左屏,不被主屏抢走', () => {
  assert.deepEqual(placeWindowBox({ x: -1920, y: 0, width: 1000, height: 700 }, WORK_AREAS), {
    x: -1920,
    y: 0,
    width: 1000,
    height: 700
  })
})

check('placeWindowBox:露 200px 的半悬窗保得住位置', () => {
  const placed = placeWindowBox({ x: -1000, y: 0, width: 1200, height: 800 }, WORK_AREAS)
  assert.equal(placed.x, -1000)
})

check('placeWindowBox:竖方向只露 10px 也拽回', () => {
  const placed = placeWindowBox({ x: 100, y: 1390, width: 1200, height: 800 }, WORK_AREAS)
  assert.equal(placed.y, 32)
})

check('placeWindowBox:没有屏幕时只给块头,坐标交给系统居中', () => {
  const placed = placeWindowBox({ x: 50, y: 50, width: 1200, height: 800 }, [])
  assert.equal(placed.width, 1200)
  assert.equal(placed.height, 800)
  assert.equal(placed.x, undefined)
  assert.equal(placed.y, undefined)
})

// ── 桌宠的位置存档(桌宠托管第二锤):口径跟窗口记事本同门 ──
const MASCOT_AREAS = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: -1920, y: 0, width: 1920, height: 1040 }
]

check('parseMascotState:干净存档认回,小数取整,垃圾不认', () => {
  assert.deepEqual(parseMascotState({ x: 12.4, y: -7.6 }), { x: 12, y: -8 })
  assert.equal(parseMascotState({ x: NaN, y: 0 }), null)
  assert.equal(parseMascotState({ x: 1 }), null)
  assert.equal(parseMascotState('垃圾'), null)
  assert.equal(parseMascotState(null), null)
})

check('placeMascotBox:没存档落主屏右下角,离边留空当', () => {
  const placed = placeMascotBox(null, MASCOT_AREAS)
  assert.equal(placed.width, MASCOT_SIZE)
  assert.equal(placed.height, MASCOT_SIZE)
  assert.equal(placed.x, 1920 - MASCOT_SIZE - 24)
  assert.equal(placed.y, 1040 - MASCOT_SIZE - 24)
})

check('placeMascotBox:完好存档原样落位,负坐标多屏认得自家屏', () => {
  assert.deepEqual(placeMascotBox({ x: 500, y: 300 }, MASCOT_AREAS), {
    x: 500,
    y: 300,
    width: MASCOT_SIZE,
    height: MASCOT_SIZE
  })
  assert.deepEqual(placeMascotBox({ x: -1500, y: 800 }, MASCOT_AREAS), {
    x: -1500,
    y: 800,
    width: MASCOT_SIZE,
    height: MASCOT_SIZE
  })
})

check('placeMascotBox:屏变小了把桌宠夹回屏内', () => {
  const placed = placeMascotBox({ x: 5000, y: 5000 }, MASCOT_AREAS)
  assert.ok(placed.x! + MASCOT_SIZE <= MASCOT_AREAS[0].x + MASCOT_AREAS[0].width, 'x 夹回右边缘内')
  assert.ok(placed.y! + MASCOT_SIZE <= MASCOT_AREAS[0].y + MASCOT_AREAS[0].height, 'y 夹回下边缘内')
})

check('placeMascotBox:没有屏幕时只给块头,坐标交给系统', () => {
  const placed = placeMascotBox({ x: 10, y: 10 }, [])
  assert.equal(placed.width, MASCOT_SIZE)
  assert.equal(placed.x, undefined)
  assert.equal(placed.y, undefined)
})

// ── 桌宠「摸没摸到」判定(拖不动修复→主仓趟平版):主进程轮询光标位置自己判 ──
check('mascotCursorInside:身上算摸到,四角透明区和窗外算没摸到,离开信号算没摸到', () => {
  // 窗 140 落 (100,100);判定区 = 身体 96 + 放宽 8×2 = 112 居中 → (114,114)-(226,226)
  const win = { x: 100, y: 100, width: MASCOT_SIZE, height: MASCOT_SIZE }
  assert.equal(mascotCursorInside(win, { x: 170, y: 170 }), true, '身体正中')
  assert.equal(mascotCursorInside(win, { x: 114, y: 114 }), true, '判定区边角也算摸到(放宽生效)')
  assert.equal(mascotCursorInside(win, { x: 226, y: 226 }), true, '判定区右下边角')
  assert.equal(mascotCursorInside(win, { x: 105, y: 170 }), false, '窗内四角透明区 → 穿透点桌面')
  assert.equal(mascotCursorInside(win, { x: 500, y: 500 }), false, '窗外远处')
  assert.equal(mascotCursorInside(win, null), false, 'mouseleave 报的 null → 算没摸到')
  assert.equal(mascotCursorInside(win, { x: 'abc', y: 1 }), false, '脏坐标不认')
  assert.equal(mascotCursorInside(win, { x: 170 }), false, '缺一条腿不认')
})

// ── 右键菜单第一项看主面板状态下菜(小葵验收点的名)──
check('mainPanelMenuLabel:主面板在屏上给「藏起」,不在给「叫它出来」', () => {
  assert.equal(mainPanelMenuLabel(true), '隐藏主面板')
  assert.equal(mainPanelMenuLabel(false), '显示主面板')
})

check('mascotMenuLabel:藏着给「叫它出来」,露着给「藏起它」', () => {
  assert.equal(mascotMenuLabel(true), '显示桌宠')
  assert.equal(mascotMenuLabel(false), '隐藏桌宠')
})

class FakeMainPanelWindow extends EventEmitter {
  visible = false
  minimized = false
  destroyed = false
  readonly calls: string[] = []
  readonly webContents = {
    invalidate: () => {
      this.calls.push('invalidate')
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
  isVisible(): boolean {
    return this.visible
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.calls.push('restore')
    this.minimized = false
    this.emit('restore')
  }
  show(): void {
    this.calls.push('show')
    this.visible = true
    this.emit('show')
  }
  hide(): void {
    this.calls.push('hide')
    this.visible = false
    this.emit('hide')
  }
  focus(): void {
    this.calls.push('focus')
  }
}

check('MainPanelController:初始露着但最小化记成不在屏;restore/show/hide/minimize 事件翻账本', () => {
  const win = new FakeMainPanelWindow()
  win.visible = true
  win.minimized = true
  const controller = new MainPanelController(win as unknown as BrowserWindow)
  assert.equal(controller.isShown(), false, '初始:露着但最小化 → 不算在屏')
  win.restore()
  assert.equal(controller.isShown(), true, 'restore 事件 → 记回在屏')
  win.hide()
  assert.equal(controller.isShown(), false, 'hide 事件 → 记下不在屏')
  win.show()
  assert.equal(controller.isShown(), true, 'show 事件 → 记回在屏')
  win.minimized = true
  win.emit('minimize')
  assert.equal(controller.isShown(), false, 'minimize 事件 → 记下不在屏')
  win.restore()
  assert.equal(controller.isShown(), true)
  win.emit('closed')
  assert.equal(controller.isShown(), false, 'closed 事件 → 账本清零')
})

check('MainPanelController:底层谎报「露着」其实最小化时,show() 照样 restore→show→invalidate→focus', () => {
  const win = new FakeMainPanelWindow()
  win.visible = true
  win.minimized = true
  const controller = new MainPanelController(win as unknown as BrowserWindow)
  controller.show()
  assert.deepEqual(win.calls, ['restore', 'show', 'invalidate', 'focus'])
  assert.equal(controller.isShown(), true)
})

check('MainPanelController:翻账才喊旁听,重复状态不吵(托盘菜单靠它换文案)', () => {
  const win = new FakeMainPanelWindow()
  const controller = new MainPanelController(win as unknown as BrowserWindow)
  const seen: boolean[] = []
  controller.onShownChange = (v) => seen.push(v)
  win.show()
  win.show()
  win.hide()
  assert.deepEqual(seen, [true, false])
})

check('MainPanelController:hide() 收窗记账;窗销毁后 show/hide 都不再碰窗', () => {
  const win = new FakeMainPanelWindow()
  win.visible = true
  const controller = new MainPanelController(win as unknown as BrowserWindow)
  controller.hide()
  assert.deepEqual(win.calls, ['hide'])
  assert.equal(controller.isShown(), false)
  win.destroyed = true
  win.calls.length = 0
  controller.show()
  controller.hide()
  assert.deepEqual(win.calls, [])
  assert.equal(controller.isShown(), false)
})

async function main(): Promise<void> {
  // ── IO 落盘回环:写得进、读得出;垃圾内容和不存在的档都安静回 null ──
  const dir = mkdtempSync(join(tmpdir(), 'atlas-window-state-'))
  try {
    check('readWindowState:没记过回 null', () => {
      assert.equal(readWindowState(dir), null)
    })

    check('writeWindowState → readWindowState 原样回环', () => {
      writeWindowState(dir, { box: { x: 8, y: 9, width: 1100, height: 750 }, maximized: false })
      assert.deepEqual(readWindowState(dir), { box: { x: 8, y: 9, width: 1100, height: 750 }, maximized: false })
      const raw = JSON.parse(readFileSync(join(dir, 'window-state.json'), 'utf8'))
      assert.equal(raw.box.width, 1100)
    })

    check('readWindowState:文件内容是垃圾回 null,不抛', () => {
      writeFileSync(join(dir, 'window-state.json'), '{哎呀', 'utf8')
      assert.equal(readWindowState(dir), null)
      writeFileSync(join(dir, 'window-state.json'), JSON.stringify({ box: { width: 1 } }), 'utf8')
      assert.equal(readWindowState(dir), null)
      assert.ok(existsSync(join(dir, 'window-state.json')))
    })

    // ── 桌宠存档 IO 回环(桌宠托管第二锤) ──
    check('readMascotState:没记过回 null;写读回环;垃圾内容安静回 null', () => {
      assert.equal(readMascotState(dir), null)
      writeMascotState(dir, { x: -300, y: 66 })
      assert.deepEqual(readMascotState(dir), { x: -300, y: 66 })
      writeFileSync(join(dir, 'mascot-state.json'), '{哎呀', 'utf8')
      assert.equal(readMascotState(dir), null)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('✅ 窗口记事本自测全绿(含桌宠位置存档)')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
