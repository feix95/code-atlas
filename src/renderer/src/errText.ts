// 把主进程/IPC 抛上来的错误,统一翻译成有温度的大白话。
// 各组件共用一份口径,防止有的地方吐技术堆栈吓到用户。

/** 剥掉 Electron IPC 包裹的错误前缀,只留人话部分 */
export function cleanErrMsg(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/**
 * 渲染进程热更新了、但底层(preload/主进程)还是旧版时,新方法不存在,
 * 会抛「xx is not a function」。这种错重启就好,要给人话引导,别吓人。
 */
export function friendlyErr(err: unknown): string {
  const msg = cleanErrMsg(err)
  if (/is not a function|is not available/i.test(msg)) {
    return '应用的底层零件还是上一版,还不会这个新动作 —— 把应用整个关掉,重新跑一次 npm run dev 就好。要是重启了还这样,把这段话截图留存,发给能帮你修的人。'
  }
  return msg
}
