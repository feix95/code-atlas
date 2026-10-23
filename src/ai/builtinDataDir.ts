// 应用数据目录(userData)的落点:main 进程启动时注入,热身账与引擎 PID 档都住这里。
import { join } from 'node:path'

let warmupDir: string | null = null

export function setBuiltinWarmupDir(dir: string): void {
  warmupDir = dir
}

/** 数据目录下的某个文件;目录还没注入就回 null(该落盘的就跳过) */
export function builtinDataFile(name: string): string | null {
  return warmupDir ? join(warmupDir, name) : null
}

/** 数据目录本身(没注入就给空串,调用方按「没有」处理) */
export function builtinDataDir(): string {
  return warmupDir ?? ''
}
