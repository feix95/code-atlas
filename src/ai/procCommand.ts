// 跑一条外部命令拿它的 stdout(收尸/queries 共用):10 秒不回来就当它死了。
import { execFile } from 'node:child_process'

export function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolvePromise(stdout)
    })
  })
}
