// 菜单点外关闭:看图舞台会 preventDefault pointerdown,浏览器不发 mousedown。
// 自测不挂 React —— 只验 bindMenuDismiss 的事件账。
import assert from 'node:assert/strict'
import { bindMenuDismiss, type MenuDismissDoc } from '../src/renderer/src/useMenuDismiss.ts'

type Listener = (e: Event) => void

function fakeDoc(): MenuDismissDoc & {
  emit: (type: string, target: unknown, extra?: Record<string, unknown>) => void
  types: () => string[]
} {
  const map = new Map<string, Listener[]>()
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
      const list = map.get(type) ?? []
      list.push(fn)
      map.set(type, list)
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
      map.set(
        type,
        (map.get(type) ?? []).filter((item) => item !== fn)
      )
    },
    emit(type: string, target: unknown, extra: Record<string, unknown> = {}): void {
      const event = { target, ...extra } as Event
      for (const fn of map.get(type) ?? []) fn(event)
    },
    types: () => [...map.keys()].sort()
  }
}

const outside = { closest: (): null => null }
const inside = {
  closest: (sel: string): object | null => (sel === '.file-path-menu' ? {} : null)
}

function check(name: string, fn: () => void): void {
  fn()
  console.log(`  ✓ ${name}`)
}

function main(): void {
  check('挂上 pointerdown:看图 preventDefault 后仍能点外关闭', () => {
    const doc = fakeDoc()
    bindMenuDismiss(doc, () => undefined, '.file-path-menu')
    assert.ok(doc.types().includes('pointerdown'))
    assert.ok(doc.types().includes('mousedown'))
  })

  check('只来 pointerdown、不来 mousedown:点外面要关(看图复现)', () => {
    const doc = fakeDoc()
    let closed = 0
    bindMenuDismiss(
      doc,
      () => {
        closed += 1
      },
      '.file-path-menu'
    )
    doc.emit('pointerdown', outside)
    assert.equal(closed, 1)
  })

  check('点在菜单内部:pointerdown 不关', () => {
    const doc = fakeDoc()
    let closed = 0
    bindMenuDismiss(
      doc,
      () => {
        closed += 1
      },
      '.file-path-menu'
    )
    doc.emit('pointerdown', inside)
    doc.emit('mousedown', inside)
    assert.equal(closed, 0)
  })

  check('Esc 关;卸监听后 pointerdown 不再关', () => {
    const doc = fakeDoc()
    let closed = 0
    const unbind = bindMenuDismiss(
      doc,
      () => {
        closed += 1
      },
      '.file-path-menu'
    )
    doc.emit('keydown', outside, { key: 'Escape' })
    assert.equal(closed, 1)
    unbind()
    doc.emit('pointerdown', outside)
    assert.equal(closed, 1)
  })
}

main()
console.log('selftest-menudismiss: ok')
