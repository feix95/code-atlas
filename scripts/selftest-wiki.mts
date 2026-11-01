// Wiki 存储自测:设置默认值/坏值回退/读写往返;位置校验(空、不存在、文件、仓库内、空目录直接用、
// 非空无标记改用子目录、已带标记直接用);Windows 路径大小写不敏感。
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  sanitizeWikiSettings,
  loadWikiSettings,
  saveWikiSettings,
  wikiSettingsFilePath
} from '../src/wiki/wikiSettings.ts'
import { isInsideRoot, resolveWikiLocation } from '../src/wiki/wikiLocation.ts'
import { DEFAULT_WIKI_LANGUAGE, WIKI_MARKER_FILE, WIKI_SUBDIRECTORY } from '../src/shared/wikiTypes.ts'

function checkSettings(base: string): void {
  const defaults = {
    location: null,
    language: DEFAULT_WIKI_LANGUAGE,
    hasChosenLocation: false
  }
  assert.deepEqual(sanitizeWikiSettings(null), defaults, '没存过时用默认值')
  assert.deepEqual(
    sanitizeWikiSettings({ location: '   ', language: 'xx', hasChosenLocation: true }),
    defaults,
    '空白位置与不认识的语种都回落默认'
  )
  const chosen = sanitizeWikiSettings({
    location: join(base, 'wiki'),
    language: 'ja',
    hasChosenLocation: false
  })
  assert.equal(chosen.language, 'ja', '认识的语种要保留')
  assert.equal(chosen.hasChosenLocation, true, '有位置就视为用户已选过,不认自相矛盾的旧字段')

  const userData = join(base, 'user-data')
  assert.deepEqual(loadWikiSettings(userData), defaults, '没写过配置文件时回默认')
  saveWikiSettings(userData, { location: join(base, 'wiki'), language: 'fr', hasChosenLocation: true })
  assert.deepEqual(
    loadWikiSettings(userData),
    { location: join(base, 'wiki'), language: 'fr', hasChosenLocation: true },
    '写进去的值要能原样读回'
  )
  assert.ok(wikiSettingsFilePath(userData).endsWith('wiki-settings.json'), '配置文件名固定')
  assert.equal(
    loadWikiSettings(join(base, 'missing-user-data')).location,
    null,
    '配置文件读不到时不抛错'
  )
}

async function checkLocation(base: string): Promise<void> {
  const project = join(base, 'project')
  const empty = join(base, 'empty')
  const busy = join(base, 'busy')
  const marked = join(base, 'marked')
  await fs.mkdir(join(project, 'src'), { recursive: true })
  await fs.mkdir(empty, { recursive: true })
  await fs.mkdir(busy, { recursive: true })
  await fs.mkdir(marked, { recursive: true })
  await fs.writeFile(join(busy, 'user.txt'), 'mine', 'utf8')
  await fs.writeFile(join(marked, WIKI_MARKER_FILE), '{}', 'utf8')
  const projectRoots = [project]

  const reject = async (chosen: string, why: string): Promise<void> => {
    const result = await resolveWikiLocation({ chosen, projectRoots })
    assert.equal(result.ok, false, why)
    if (!result.ok) assert.ok(result.reason.length > 0, `${why}: 要说明原因`)
  }
  await reject('', '空路径应拒绝')
  await reject(join(base, 'never-created'), '不存在的文件夹应拒绝')
  await reject(join(project, 'src'), '仓库内的文件夹应拒绝')
  await reject(join(project, 'src', '..', '..', 'project', 'src'), '带 .. 的仓库内路径同样应拒绝')

  const emptyResult = await resolveWikiLocation({ chosen: empty, projectRoots })
  assert.ok(emptyResult.ok, '空文件夹可以直接用')
  if (emptyResult.ok) {
    assert.equal(emptyResult.location, await fs.realpath(empty), '空文件夹用用户选的原位置')
    assert.equal(emptyResult.usedSubdirectory, false, '空文件夹不建子目录')
  }

  const busyResult = await resolveWikiLocation({ chosen: busy, projectRoots })
  assert.ok(busyResult.ok, '非空但无标记的文件夹也应接受')
  if (busyResult.ok) {
    assert.equal(
      busyResult.location,
      join(await fs.realpath(busy), WIKI_SUBDIRECTORY),
      '非空且没有应用标记时改用其下 CodeAtlasWiki'
    )
    assert.equal(busyResult.usedSubdirectory, true, '要告诉界面换了子目录')
  }

  const markedResult = await resolveWikiLocation({ chosen: marked, projectRoots })
  assert.ok(markedResult.ok, '已带标记的文件夹直接可用')
  if (markedResult.ok) {
    assert.equal(markedResult.location, await fs.realpath(marked), '有标记就不再套子目录')
    assert.equal(markedResult.usedSubdirectory, false, '有标记不算换目录')
  }

  if (process.platform === 'win32') {
    await reject(project.toUpperCase(), 'Windows 下大小写不同的仓库内路径也应拒绝')
    assert.equal(isInsideRoot('C:\\Work\\Proj\\src', 'c:\\work\\proj'), true, '包含判断不分大小写')
    assert.equal(isInsideRoot('C:\\Work\\ProjTwo', 'C:\\Work\\Proj'), false, '同前缀的兄弟目录不算包含')
  }
  assert.equal(isInsideRoot('/a/b/c', '/a/b'), true, '子路径算包含')
  assert.equal(isInsideRoot('/a/bc', '/a/b'), false, '只是前缀相同不算包含')
}

async function main(): Promise<void> {
  const base = join(tmpdir(), `codeatlas-wiki-${Date.now()}`)
  await fs.mkdir(base, { recursive: true })
  try {
    checkSettings(base)
    await checkLocation(base)
    console.log('✅ Wiki 存储自测全部通过')
    console.log('   设置默认值与回退 · 配置读写往返 · 仓库内拒绝 · 非空无标记改用子目录 · 大小写不敏感')
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('❌ Wiki 存储自测失败:', err)
  process.exit(1)
})
