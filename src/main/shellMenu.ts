// ── 资源管理器右键菜单(右键问一问,2026-09-18)──
// 解压软件、WPS 那条路:写注册表 HKCU\Software\Classes\<键>\shell\<名字>。
// 用户级注册,不需要管理员权限;只写 HKCU,绝不碰 HKLM。
// 两个菜单项:
//   文件右键 → 「问问小探针」(*\shell,通配所有文件类型)
//   文件夹右键 → 「用 CodeAtlas 打开」(Directory\shell)
// 点击后的行为由路径类型决定(文件=问一问,文件夹=打开),command 写法统一是
// `"exe路径" "%1"`,主进程拿到路径自己分辨。纯逻辑住这儿,reg 执行是薄封装,
// 自测只碰纯函数,绝不真写注册表。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 「问问小探针」的注册表键:*\shell 通配所有文件类型 */
export const SHELL_ASK_KEY = 'HKCU\\Software\\Classes\\*\\shell\\CodeAtlasAsk'
/** 「用 CodeAtlas 打开」的注册表键:文件夹右键 */
export const SHELL_OPEN_KEY = 'HKCU\\Software\\Classes\\Directory\\shell\\CodeAtlasOpen'

export const SHELL_ASK_LABEL = '问问小探针'
export const SHELL_OPEN_LABEL = '用 CodeAtlas 打开'

/**
 * 一个菜单项的完整 reg 写入清单(纯函数,自测覆盖)。
 * 每项是一条 reg add 的参数数组:默认值 = 菜单显示文字,Icon = 菜单图标,
 * command 子键 = 点击时拉起 exe 并把被右键路径当 %1 传进来。
 * execFile 数组参数不吃 shell 转义,exe 路径带空格也稳;command 值里的引号
 * 是注册表侧的语义(路径整体加引号),不是 shell 转义。
 */
export function shellMenuAddCommands(key: string, label: string, exePath: string): string[][] {
  return [
    ['add', key, '/ve', '/d', label, '/f'],
    ['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', exePath, '/f'],
    ['add', `${key}\\command`, '/ve', '/d', `"${exePath}" "%1"`, '/f']
  ]
}

/** 一个菜单项的 reg 删除清单(纯函数,自测覆盖):删父键,command 跟着走 */
export function shellMenuDeleteCommands(key: string): string[][] {
  return [['delete', key, '/f']]
}

/** 两个菜单一起的写入清单 */
export function allShellMenuAddCommands(exePath: string): string[][] {
  return [...shellMenuAddCommands(SHELL_ASK_KEY, SHELL_ASK_LABEL, exePath), ...shellMenuAddCommands(SHELL_OPEN_KEY, SHELL_OPEN_LABEL, exePath)]
}

/** 两个菜单一起的删除清单 */
export function allShellMenuDeleteCommands(): string[][] {
  return [...shellMenuDeleteCommands(SHELL_ASK_KEY), ...shellMenuDeleteCommands(SHELL_OPEN_KEY)]
}

/** reg 查询单键存在与否:退出码 0 = 在;1 = 没有;其他输出不算数 */
export function regQueryArgs(key: string): string[] {
  return ['query', key]
}

/** 菜单开关当前是不是「开」:两个键的查询结果都活着才算开(纯函数,自测覆盖) */
export function shellMenuEnabledFromQueries(results: Array<{ ok: boolean }>): boolean {
  return results.every((r) => r.ok)
}

async function reg(args: string[]): Promise<{ ok: boolean }> {
  try {
    await run('reg', args, { windowsHide: true })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 读现状:两个键都在 = 开。查询失败当没有(注册表被手动清过也不谎报) */
export async function readShellMenuEnabled(): Promise<boolean> {
  const results = await Promise.all([reg(regQueryArgs(SHELL_ASK_KEY)), reg(regQueryArgs(SHELL_OPEN_KEY))])
  return shellMenuEnabledFromQueries(results)
}

/** 开/关注册表右键菜单:开 = 逐条写入;关 = 删键。即时生效,不用重启资源管理器 */
export async function writeShellMenu(on: boolean, exePath: string): Promise<void> {
  const batches = on ? allShellMenuAddCommands(exePath) : allShellMenuDeleteCommands()
  for (const args of batches) {
    const r = await reg(args)
    if (!r.ok) throw new Error(`注册表操作没成功(reg ${args[0]})`)
  }
}
