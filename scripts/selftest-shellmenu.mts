// 右键问一问自测:注册表菜单的键位/命令拼装 + 启动参数里的路径转交,全用假数据和临时文件。
// 铁则:自测绝不真写注册表 —— reg 执行是主进程的事,这里只验纯函数拼出来的东西对不对。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  SHELL_ASK_KEY,
  SHELL_OPEN_KEY,
  SHELL_ASK_LABEL,
  SHELL_OPEN_LABEL,
  shellMenuAddCommands,
  shellMenuDeleteCommands,
  allShellMenuAddCommands,
  allShellMenuDeleteCommands,
  regQueryArgs,
  shellMenuEnabledFromQueries
} from '../src/main/shellMenu.ts'
import { extractLaunchPath } from '../src/main/launchPath.ts'

function check(name: string, fn: () => void): void {
  fn()
  console.log(`✓ ${name}`)
}

check('注册表键位:文件问一问走 *\\shell,文件夹打开走 Directory\\shell,只写 HKCU', () => {
  assert.ok(SHELL_ASK_KEY.startsWith('HKCU\\Software\\Classes\\*\\shell\\'), '文件键在通配壳下')
  assert.ok(SHELL_OPEN_KEY.startsWith('HKCU\\Software\\Classes\\Directory\\shell\\'), '文件夹键在 Directory 壳下')
  assert.ok(!SHELL_ASK_KEY.includes('HKLM') && !SHELL_OPEN_KEY.includes('HKLM'), '绝不碰 HKLM')
  assert.equal(SHELL_ASK_LABEL, '问问小探针')
  assert.equal(SHELL_OPEN_LABEL, '用 CodeAtlas 打开')
})

check('写入清单:默认值=菜单文字、Icon=exe、command 带 %1 且 exe 整体加引号', () => {
  const cmds = shellMenuAddCommands('HKCU\\Software\\Classes\\*\\shell\\CodeAtlasAsk', '问问小探针', 'C:\\Program Files\\CodeAtlas\\CodeAtlas.exe')
  assert.equal(cmds.length, 3)
  assert.deepEqual(cmds[0], ['add', 'HKCU\\Software\\Classes\\*\\shell\\CodeAtlasAsk', '/ve', '/d', '问问小探针', '/f'])
  assert.ok(cmds[1].includes('Icon') && cmds[1].includes('C:\\Program Files\\CodeAtlas\\CodeAtlas.exe'), 'Icon 指向 exe(带空格的路径原样进参数)')
  const command = cmds[2]!.join(' ')
  assert.ok(command.includes('"C:\\Program Files\\CodeAtlas\\CodeAtlas.exe" "%1"'), 'command 里 exe 加引号、%1 传被右键路径')
})

check('删除清单:删父键一条,command 跟着走;两菜单一共两条', () => {
  assert.equal(shellMenuDeleteCommands('HKCU\\X').length, 1)
  assert.equal(allShellMenuDeleteCommands().length, 2)
  assert.ok(allShellMenuDeleteCommands().every((c) => c[0] === 'delete' && c[2] === '/f'))
})

check('写入清单成对:两个菜单 × 3 条 = 6 条', () => {
  assert.equal(allShellMenuAddCommands('C:\\x.exe').length, 6)
})

check('状态判断:两个键都在才算开,缺一个就是关', () => {
  assert.equal(shellMenuEnabledFromQueries([{ ok: true }, { ok: true }]), true)
  assert.equal(shellMenuEnabledFromQueries([{ ok: true }, { ok: false }]), false)
  assert.equal(shellMenuEnabledFromQueries([]), true, '空清单按「都在」算(纯逻辑口径,实际读档永远查两个键)')
})

check('查询参数:reg query 认键名', () => {
  assert.deepEqual(regQueryArgs('HKCU\\X'), ['query', 'HKCU\\X'])
})

check('路径转交:从 argv 里认出真实存在的路径,跳过 exe 和开关', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-shellmenu-'))
  try {
    const exe = join(dir, 'CodeAtlas.exe')
    const file = join(dir, 'main.ts')
    const subdir = join(dir, 'sub')
    writeFileSync(exe, 'x')
    writeFileSync(file, 'x')
    mkdirSync(subdir)
    // 正常右键文件:argv = [exe, 文件路径]
    assert.deepEqual(extractLaunchPath([exe, file]), { path: file, kind: 'file' })
    // 右键文件夹
    assert.deepEqual(extractLaunchPath([exe, subdir]), { path: subdir, kind: 'directory' })
    // 普通双击:没有目标
    assert.equal(extractLaunchPath([exe]), null)
    // 开关参数和消失的文件不认
    assert.deepEqual(extractLaunchPath([exe, '-v', join(dir, '没这个.file'), file]), { path: file, kind: 'file' })
    // 空串防御
    assert.equal(extractLaunchPath([exe, '']), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log('✅ 右键问一问自测全部通过')
