// 引擎程序定位:用户不该知道 llama-server 是啥,填了就听填的,没填就找 app 自带的。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 引擎自动定位:用户不该知道 llama-server 是啥。
 * 设置里填了程序路径就用填的(高级用法);没填就找 app 自带的引擎
 * (dev 模式在项目根 vendor/llama-cpp/,打包后在 resources/llama-cpp/)。
 * 都找不到 → 人话错误,按运行环境分一句可执行的指引:
 * 开发版(defaultApp)指去 vendor/llama-cpp 放引擎;正式版引擎是打包自带的,
 * 丢了等于安装坏了,让重装。两条都附 LM Studio 退路,不暴露路径给小白猜。
 */
export function resolveServerProgram(configuredPath: string): string {
  const configured = configuredPath.trim()
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error('找不到 llama-server 程序:去「AI 设置」重新选一下程序路径')
    }
    return configured
  }
  const candidates: string[] = [join(process.cwd(), 'vendor', 'llama-cpp', 'llama-server.exe')]
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string') {
    candidates.push(join(resourcesPath, 'llama-cpp', 'llama-server.exe'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const isDev = (process as { defaultApp?: boolean }).defaultApp === true
  throw new Error(
    isDev
      ? '没找到内置 AI 引擎,内置模型暂时用不了。请把引擎文件(llama-server.exe)放进项目根目录的 vendor\\llama-cpp\\ 文件夹;或打开「设置 → 高级选项」改用 LM Studio。'
      : '没找到内置 AI 引擎,内置模型暂时用不了。请重新安装应用;或打开「设置 → 高级选项」改用 LM Studio。'
  )
}
