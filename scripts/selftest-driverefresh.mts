// 「这台电脑」刷新结果摘要:磁盘增减、无变化、首次(无旧列表)都要说人话。
import assert from 'node:assert/strict'
import type { DriveInfo } from '../src/shared/types.ts'
import { describeDriveChange } from '../src/renderer/src/driveRefresh.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const drive = (letter: string): DriveInfo => ({ letter, root: `${letter}:\\` }) as DriveInfo

check('磁盘没变:明说没有变化', () => {
  assert.equal(
    describeDriveChange([drive('C'), drive('D')], [drive('C'), drive('D')]),
    '已刷新，无变化'
  )
})

check('插入新盘:报新磁盘', () => {
  assert.equal(describeDriveChange([drive('C')], [drive('C'), drive('E')]), '发现新磁盘 E:\\')
})

check('拔掉盘:报断开的磁盘', () => {
  assert.equal(describeDriveChange([drive('C'), drive('E')], [drive('C')]), '磁盘 E:\\ 已断开')
})

check('同时插拔:两段都报', () => {
  assert.equal(
    describeDriveChange([drive('C'), drive('E')], [drive('C'), drive('F')]),
    '发现新磁盘 F:\\，磁盘 E:\\ 已断开'
  )
})

check('旧列表还没读到:全部算新增', () => {
  assert.equal(describeDriveChange(null, [drive('C')]), '发现新磁盘 C:\\')
})
