// journey 的 Word 大文档一段:现造一份约 80 MB 的截图笔记(落在本轮 journey 的临时目录,不进仓库),
// 真 Electron 里验 —— 转换期间有进度行、主进程照常应答、界面照常响应点击;转好后图片走令牌地址
// 并懒加载;没登记的令牌加载不出;关掉页签后临时图片目录被删。量到的数字回给主脚本打印。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { buildImageHeavyDocx } from './docx-fixture-large.mts'

export const LARGE_DOCX = 'study-notes-large.docx'
/** 40 张约 2 MB 的噪点截图 ≈ 80 MB,接近小葵真实笔记的体积 */
const HEAVY = { images: 40, width: 1024, height: 680 }
const CONVERT_TIMEOUT_MS = 120_000
/** 转换期间主进程一次往返的上限:后台线程在转,主线程应当随叫随到 */
const MAX_MAIN_PING_MS = 500
/** 转换期间点一下文件夹,展开状态翻面的上限 */
const MAX_CLICK_MS = 1000
const POLL_MS = 50
const TOKEN_SRC = /^atlas-media:\/\/docx-image\/[0-9a-f]{32}$/

export async function writeLargeDocx(project: string): Promise<void> {
  await writeFile(join(project, LARGE_DOCX), buildImageHeavyDocx(HEAVY))
}

export interface LargeDocxNumbers {
  convertMs: number
  maxMainPingMs: number
  pings: number
  clickMs: number
}

/** 图片能不能从这个地址加载出来(load / error) */
async function imageLoads(page: Page, src: string): Promise<boolean> {
  return page.evaluate(
    (url) =>
      new Promise<boolean>((resolve) => {
        const img = new Image()
        img.onload = () => resolve(true)
        img.onerror = () => resolve(false)
        img.src = url
      }),
    src
  )
}

/** 临时图片目录里,装着 count 张图的那个任务目录 */
async function jobDirWith(tempDir: string, count: number): Promise<string | null> {
  for (const cache of (await readdir(tempDir)).filter((n) => n.startsWith('CodeAtlas-docx-'))) {
    for (const job of await readdir(join(tempDir, cache))) {
      const dir = join(tempDir, cache, job)
      if ((await readdir(dir)).length === count) return dir
    }
  }
  return null
}

async function checkWhileConverting(
  page: Page,
  electron: ElectronApplication
): Promise<{ clickMs: number; maxMainPingMs: number; pings: number }> {
  const loading = page.locator('.docx-loading')
  await loading.waitFor({ timeout: 5000 })
  // 界面:转换期间点文件夹,展开状态应当马上翻面(再点一次还原)
  const folder = page.locator('.tree-row.is-dir .tree-main').filter({ hasText: 'docs' }).first()
  const before = await folder.getAttribute('aria-expanded')
  const clickStart = performance.now()
  await folder.click()
  await page.waitForFunction(
    (was) =>
      [...document.querySelectorAll('.tree-row.is-dir .tree-main')]
        .find((el) => el.textContent?.includes('docs'))
        ?.getAttribute('aria-expanded') !== was,
    before
  )
  const clickMs = Math.round(performance.now() - clickStart)
  assert.ok(await loading.isVisible(), 'the folder click must land while the docx is converting')
  await folder.click()
  // 主进程:转换期间反复往返一次,记最慢的那次
  let maxMainPingMs = 0
  let pings = 0
  while (await loading.isVisible()) {
    const t = performance.now()
    await electron.evaluate(() => 0)
    maxMainPingMs = Math.max(maxMainPingMs, performance.now() - t)
    pings++
    await page.waitForTimeout(POLL_MS)
  }
  assert.ok(clickMs < MAX_CLICK_MS, `UI must respond during conversion (${clickMs} ms)`)
  assert.ok(
    maxMainPingMs < MAX_MAIN_PING_MS,
    `main process must stay responsive (${maxMainPingMs} ms)`
  )
  return { clickMs, maxMainPingMs: Math.round(maxMainPingMs), pings }
}

/**
 * 故意加载失败的那几次(伪造/已释放的令牌)会让 Chromium 记一条「Failed to load resource」,
 * 这是预期内的,从渲染层报错清单里摘掉;别的报错原样留给主脚本去拦。
 */
async function expectFailedLoad(page: Page, src: string, errors: string[]): Promise<boolean> {
  const mark = errors.length
  const loaded = await imageLoads(page, src)
  await page.waitForTimeout(POLL_MS * 4)
  const extra = errors.splice(mark)
  errors.push(...extra.filter((msg) => !/Failed to load resource/.test(msg)))
  return loaded
}

export async function checkLargeDocx(
  page: Page,
  electron: ElectronApplication,
  ctx: { tempDir: string; errors: string[]; shot: (name: string) => Promise<unknown> }
): Promise<LargeDocxNumbers> {
  const { tempDir, errors, shot } = ctx
  const started = performance.now()
  await page.locator('.tree-row.is-file .tree-main').filter({ hasText: LARGE_DOCX }).click()
  const during = await checkWhileConverting(page, electron)
  const imgs = page.locator('.docx-body:visible img')
  await imgs.nth(HEAVY.images - 1).waitFor({ state: 'attached', timeout: CONVERT_TIMEOUT_MS })
  const convertMs = Math.round(performance.now() - started)
  const facts = await imgs.evaluateAll((els) =>
    els.map((el) => {
      const img = el as HTMLImageElement
      return { src: img.getAttribute('src') ?? '', lazy: img.loading, loaded: img.naturalWidth > 0 }
    })
  )
  assert.equal(facts.length, HEAVY.images, 'every screenshot must be in the body')
  assert.ok(
    facts.every((f) => TOKEN_SRC.test(f.src)),
    'images must use registered token URLs'
  )
  assert.ok(
    facts.every((f) => f.lazy === 'lazy'),
    'images must load lazily'
  )
  await page.waitForTimeout(POLL_MS * 10)
  const loadedNow = (
    await imgs.evaluateAll((els) => els.filter((el) => (el as HTMLImageElement).naturalWidth > 0))
  ).length
  assert.ok(
    loadedNow >= 1 && loadedNow < HEAVY.images,
    `far images must wait (${loadedNow} loaded)`
  )
  await imgs.last().scrollIntoViewIfNeeded()
  await page.waitForFunction(() => {
    const all = document.querySelectorAll<HTMLImageElement>('.docx-body img')
    return (all[all.length - 1]?.naturalWidth ?? 0) > 0
  })
  await page.locator('.doc-outline-item').filter({ hasText: 'Chapter 8' }).first().waitFor()
  await shot('docx-large')
  const token = facts[0].src
  assert.equal(await imageLoads(page, token), true, 'a registered token must load')
  const forged = `atlas-media://docx-image/${'0'.repeat(32)}`
  assert.equal(
    await expectFailedLoad(page, forged, errors),
    false,
    'an unregistered token must not load'
  )
  const jobDir = await jobDirWith(tempDir, HEAVY.images)
  assert.ok(jobDir, 'images must live in a per-conversion temp folder')
  await page.getByRole('button', { name: `关闭 ${LARGE_DOCX}` }).click()
  for (let i = 0; existsSync(jobDir) && i < POLL_MS; i++) await page.waitForTimeout(POLL_MS)
  assert.equal(existsSync(jobDir), false, 'closing the tab must delete its temp images')
  // 释放后主进程对这枚令牌回 404 由 selftest-docxjobs 覆盖;这里再加载同一地址只会命中
  // Chromium 自己的内存图片缓存(同一页面同一地址),验不到主进程,故不在 journey 里断言
  return { convertMs, ...during }
}
