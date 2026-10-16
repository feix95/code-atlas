// 引擎包检验室(第 4 期):下载下来的 zip 在这过安检 ——
// 字节数/sha256 对户口,tar 条目先过一遍安检(.. 越级/绝对路径整包拒收,防 zip slip),
// 干净才解压。跟安装器(engineInstaller)分家:那边管下载编排,这边管「包能不能信」。
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TAR_TIMEOUT_MS = 120_000

export function runCommand(
  file: string,
  args: string[],
  timeout: number
): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => res({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}` })
    )
  })
}

/** 文件 sha256(流式算,550MB 的包不整读进内存) */
async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d: Buffer) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })
}

/** zip 条目名是否安全:.. 越级、盘符/斜杠开头的绝对路、UNC 一律拒收(纯函数,自测覆盖) */
export function isZipEntrySafe(entry: string): boolean {
  const p = entry.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('//')) return false
  return !p.split('/').some((seg) => seg === '..')
}

/**
 * 校验 + 解压一个包:sha256/字节数对不上就删包报错;解压前 tar -tf 过一遍条目,
 * 有越级(..)/绝对路径的就整包拒收,不让 zip slip 落盘。
 */
export async function verifyAndExtract(
  zipPath: string,
  expected: { bytes: number; sha256: string },
  destDir: string
): Promise<void> {
  const size = statSync(zipPath).size
  if (size !== expected.bytes) {
    rmSync(zipPath, { force: true })
    throw new Error(`下载的文件大小不对(${size} ≠ ${expected.bytes}),已删除,请重试`)
  }
  const hash = await sha256File(zipPath)
  if (hash !== expected.sha256) {
    rmSync(zipPath, { force: true })
    throw new Error('下载的文件校验没通过,已删除,请重试')
  }
  const list = await runCommand('tar', ['-tf', zipPath], TAR_TIMEOUT_MS)
  if (!list.ok) {
    rmSync(zipPath, { force: true })
    throw new Error('下载的包读不开,已删除,请重试')
  }
  const bad = list.out.split(/\r?\n/).find((e) => e.trim() && !isZipEntrySafe(e.trim()))
  if (bad) {
    rmSync(zipPath, { force: true })
    throw new Error('下载的包里有不安全的文件路径,已删除;请反馈给开发者')
  }
  mkdirSync(destDir, { recursive: true })
  const un = await runCommand('tar', ['-xf', zipPath, '-C', destDir], TAR_TIMEOUT_MS)
  if (!un.ok) throw new Error(`解压失败:${un.out.trim() || '原因不明'},请重试`)
}

/** 解压目录里找 llama-server.exe(发行包结构变了就在子目录里翻,只翻一层深) */
export function findExtractedExe(dir: string): string | null {
  const walk = (d: string, depth: number): string | null => {
    if (depth > 2) return null
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isFile() && e.name.toLowerCase() === 'llama-server.exe') return p
      if (e.isDirectory()) {
        const hit = walk(p, depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(dir, 0)
}
