// 会话复现自测:存档垃圾不炸、活账能压回存档、死签/死组被扔、激活标记不错位
import assert from 'node:assert/strict'
import type { ScanDirNode } from '../src/shared/types.ts'
import type { PaneGroup } from '../src/renderer/src/paneTabs.ts'
import {
  hydrateSession,
  parseSession,
  serializeSession,
  type SessionState
} from '../src/renderer/src/sessionState.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const tree: ScanDirNode = {
  type: 'directory',
  name: 'root',
  relPath: '',
  children: [
    { type: 'file', name: 'a.ts', relPath: 'a.ts', ext: '.ts' },
    {
      type: 'directory',
      name: 'src',
      relPath: 'src',
      children: [{ type: 'file', name: 'b.ts', relPath: 'src/b.ts', ext: '.ts' }]
    }
  ]
}

check('parseSession:没存过/垃圾/别版存档一概回 null', () => {
  for (const junk of [null, 'x', 42, [], {}, { v: 2, folder: 'C:\\a', sel: null, groups: [] }]) {
    assert.equal(parseSession(junk), null, `垃圾应回 null:${JSON.stringify(junk)}`)
  }
  // 缺页签账不算死罪:工作区照还原,页签回默认(页签是附属账,不该连累工作区)
  const partial = parseSession({ v: 1, folder: 'C:\\a' })
  assert.equal(partial?.folder, 'C:\\a')
  assert.equal(partial?.groups.length, 0)
})

check('serializeSession→parseSession 往返:字段原样认回,激活标记落在 on 上', () => {
  const groups: PaneGroup[] = [
    {
      id: 'pane:1',
      activeId: 'tab:2',
      tabs: [
        {
          id: 'tab:1',
          kind: 'overview',
          relPath: '',
          name: '概览',
          icon: 'navigation',
          pinned: false
        },
        {
          id: 'tab:2',
          kind: 'preview',
          relPath: 'src/b.ts',
          name: 'b.ts',
          icon: 'ts',
          pinned: true
        }
      ]
    },
    {
      id: 'pane:2',
      activeId: 'tab:3',
      tabs: [
        { id: 'tab:3', kind: 'chat', relPath: '', name: 'Atlas 小探针', icon: 'bot', pinned: false }
      ]
    }
  ]
  const s = serializeSession('C:\\work\\demo', groups, 'pane:2', 'src/b.ts')
  assert.equal(s.groups[0].tabs[1].on, true)
  assert.equal(s.groups[1].on, true)
  const back = parseSession(JSON.parse(JSON.stringify(s)))
  assert.ok(back)
  assert.equal(back.folder, 'C:\\work\\demo')
  assert.equal(back.sel, 'src/b.ts')
  assert.equal(back.groups.length, 2)
  assert.equal(back.groups[0].tabs[1].on, true)
})

check('hydrateSession:死签扔掉、活签换新 id、激活标记不错位', () => {
  const s: SessionState = {
    v: 1,
    folder: 'C:\\work\\demo',
    sel: 'a.ts',
    groups: [
      {
        on: true,
        tabs: [
          { kind: 'preview', relPath: 'gone.ts', name: 'gone.ts', icon: 'ts', pinned: true }, // 文件没了
          { kind: 'overview', relPath: '', name: '概览', icon: 'navigation', pinned: false },
          {
            kind: 'preview',
            relPath: 'src/b.ts',
            name: 'b.ts',
            icon: 'ts',
            pinned: true,
            on: true
          }
        ]
      },
      { tabs: [{ kind: 'preview', relPath: 'gone2.ts', name: 'x', icon: 'x', pinned: true }] } // 整组死光
    ]
  }
  const h = hydrateSession(s, tree)
  assert.ok(h)
  assert.equal(h.groups.length, 1, '死光的组不还原')
  const g = h.groups[0]
  assert.equal(g.tabs.length, 2, '死签不入账')
  assert.equal(g.activeId, g.tabs[1].id, '激活标记跟签不跟序号')
  assert.equal(g.tabs[1].pinned, true)
  assert.equal(g.tabs[1].name, 'b.ts', '钉住签的固化门面原样回')
  assert.equal(h.activeGroupId, g.id, '激活组标记跟组不跟序号')
})

check('hydrateSession:无工作区只有 app 级房间能活;全死回 null', () => {
  const s: SessionState = {
    v: 1,
    folder: null,
    sel: null,
    groups: [
      {
        tabs: [
          { kind: 'settings', relPath: '', name: '设置', icon: 'settings2', pinned: false },
          { kind: 'preview', relPath: 'a.ts', name: 'a.ts', icon: 'ts', pinned: true },
          {
            kind: 'peek',
            relPath: 'Windows/x.dll',
            name: 'x.dll',
            icon: 'file',
            pinned: true,
            scopeRoot: 'C:\\'
          }
        ]
      }
    ]
  }
  const h = hydrateSession(s, null)
  assert.ok(h)
  assert.equal(h.groups[0].tabs.length, 2, '工作区绑定的签没树可验=死签')
  assert.equal(h.groups[0].tabs[1].kind, 'peek', 'peek 读根在盘符,没工作区也活')

  const dead: SessionState = { v: 1, folder: null, sel: null, groups: [] }
  assert.equal(hydrateSession(dead, null), null, '一张都活不了就不硬摆')
})

check('serializeSession:激活指针没指到任何签时,on 不落、还原兜底末张', () => {
  const groups: PaneGroup[] = [
    {
      id: 'pane:1',
      activeId: null,
      tabs: [
        { id: 'tab:1', kind: 'chat', relPath: '', name: 'Atlas 小探针', icon: 'bot', pinned: false }
      ]
    }
  ]
  const s = serializeSession(null, groups, null, null)
  assert.equal(s.groups[0].tabs[0].on, undefined)
  const h = hydrateSession(parseSession(JSON.parse(JSON.stringify(s)))!, null)
  assert.ok(h)
  assert.equal(h.groups[0].activeId, h.groups[0].tabs[0].id, '没标记就亮末张')
})

console.log('✅ 会话复现自测全绿')
