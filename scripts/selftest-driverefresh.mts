// 「这台电脑」刷新结果摘要:盘符增减、无变化、首次(无旧列表)都要说人话。
import assert from 'node:assert/strict'
import type { DriveInfo } from '../src/shared/types.ts'
import { describeDriveChange } from '../src/renderer/src/driveRefresh.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

const drive = (letter: string): DriveInfo => ({ letter, root: `${letter}:\\` }) as DriveInfo

check('盘符没变:明说没有变化', () => {
  assert.equal(
    describeDriveChange([drive('C'), drive('D')], [drive('C'), drive('D')]),
    '已刷新,盘符没有变化'
  )
})

check('插入新盘:报新增盘符', () => {
  assert.equal(describeDriveChange([drive('C')], [drive('C'), drive('E')]), '已刷新:新增 E:\\')
})

check('拔掉盘:报已移除盘符', () => {
  assert.equal(describeDriveChange([drive('C'), drive('E')], [drive('C')]), '已刷新:已移除 E:\\')
})

check('同时插拔:两段都报', () => {
  assert.equal(
    describeDriveChange([drive('C'), drive('E')], [drive('C'), drive('F')]),
    '已刷新:新增 F:\\,已移除 E:\\'
  )
})

check('旧列表还没读到:全部算新增', () => {
  assert.equal(describeDriveChange(null, [drive('C')]), '已刷新:新增 C:\\')
})
