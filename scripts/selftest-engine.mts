// 引擎后端自测
// 跑法:npm run test:engine
// 钉死的账:engineCatalog 登记完整(每包有真 sha256/大小,URL 对得上钉的版本);
// recommendBackend / resolveEngineChoice 的推荐与退路矩阵;安装器的纯函数件
// (进度折算、zip 条目安检、verifyAndExtract 的错 sha/截短/zip-slip 拒收);
// config 的 backend 落盘口径;builtin 对账键把 backend 算进签名。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  approxDownloadMB,
  backendTotalBytes,
  ENGINE_CATALOG,
  ENGINE_TAG,
  sanitizeBackendChoice
} from '../src/shared/engineCatalog.ts'
import { recommendBackend, resolveEngineChoice } from '../src/shared/enginePick.ts'
import { downloadPercent, installBackend, listInstalled } from '../src/ai/engineInstaller.ts'
import { findExtractedExe, isZipEntrySafe, verifyAndExtract } from '../src/ai/enginePackage.ts'
import { settingsKey } from '../src/ai/builtin.ts'
import { loadAiConfig, saveAiConfig } from '../src/ai/config.ts'
import type { MachineProfile } from '../src/shared/launchPlan.ts'
import type { AiConfig } from '../src/shared/types.ts'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(name: string, actual: unknown, want: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(want), `got ${JSON.stringify(actual)}`)
}

const M = (over: Partial<MachineProfile>): MachineProfile => ({
  ramBytes: 32e9,
  vramBytes: 16e9,
  vramFreeBytes: 15e9,
  gpuName: 'RTX 5060 Ti',
  gpuVendor: 'nvidia',
  gpuComputeCap: 12.0,
  driverVersion: '596.36',
  ...over
})

// 目录登记完整性 
console.log(' 引擎目录完整性')
{
  for (const b of ['cuda', 'vulkan', 'cpu'] as const) {
    const info = ENGINE_CATALOG[b]
    check(`${b} 有显示名与人话`, !!info.displayName && !!info.oneLine)
    check(`${b} 至少一个包`, info.assets.length >= 1)
    for (const a of info.assets) {
      check(
        `${a.file} URL 对得上版本`,
        a.url.includes(`/download/${ENGINE_TAG}/`) && a.url.endsWith(a.file)
      )
      check(`${a.file} sha256 是 64 位 hex`, /^[0-9a-f]{64}$/.test(a.sha256))
      check(`${a.file} 大小>0`, a.bytes > 0)
    }
    check(
      `${b} 合计大小=逐包相加`,
      backendTotalBytes(b) === info.assets.reduce((s, x) => s + x.bytes, 0)
    )
    check(`${b} 约 MB 合理`, approxDownloadMB(b) >= 10)
  }
  check('cuda 两包(主包+cudart)', ENGINE_CATALOG.cuda.assets.length === 2)
}

// 后端推荐矩阵 
console.log(' recommendBackend 矩阵')
eq('RTX 5060 Ti(cc 12.0)→ cuda', recommendBackend(M({})).backend, 'cuda')
eq('GTX 1060(cc 6.1)→ vulkan', recommendBackend(M({ gpuComputeCap: 6.1 })).backend, 'vulkan')
eq('cc 7.5 边缘 → cuda', recommendBackend(M({ gpuComputeCap: 7.5 })).backend, 'cuda')
eq(
  'RX 7900(amd)→ vulkan',
  recommendBackend(M({ gpuVendor: 'amd', gpuName: 'RX 7900 XTX', gpuComputeCap: null })).backend,
  'vulkan'
)
eq(
  'Intel Arc → vulkan',
  recommendBackend(M({ gpuVendor: 'intel', gpuName: 'Intel Arc A770', gpuComputeCap: null }))
    .backend,
  'vulkan'
)
eq(
  '不认厂商但有卡名 → vulkan',
  recommendBackend(M({ gpuVendor: 'unknown', gpuName: '怪卡', gpuComputeCap: null })).backend,
  'vulkan'
)
eq(
  '没认出显卡 → cpu',
  recommendBackend(M({ gpuVendor: null, gpuName: null, vramBytes: null, gpuComputeCap: null }))
    .backend,
  'cpu'
)
eq(
  'N 卡但 cc 问不到 → cuda(先信,装完跑不动会退)',
  recommendBackend(M({ gpuComputeCap: null })).backend,
  'cuda'
)

// 引擎选择矩阵 
console.log(' resolveEngineChoice 矩阵')
{
  const r = (userChoice: 'auto' | 'cuda' | 'vulkan' | 'cpu', installed: string[], vendor = true) =>
    resolveEngineChoice({
      recommended: 'cuda',
      userChoice,
      installed: new Set(installed) as Set<'cuda' | 'vulkan' | 'cpu'>,
      vendorAvailable: vendor
    })
  eq('auto+推荐已装 → installed/cuda', r('auto', ['cuda']).use, {
    kind: 'installed',
    backend: 'cuda'
  })
  {
    const x = r('auto', ['vulkan'])
    eq('auto+推荐没装有别的 → installed/vulkan', x.use, { kind: 'installed', backend: 'vulkan' })
    eq('wantInstall=cuda', x.wantInstall, 'cuda')
  }
  {
    const x = r('auto', [])
    eq('auto+啥都没装+有 vendor → vendor', x.use, { kind: 'vendor' })
    eq('wantInstall=cuda', x.wantInstall, 'cuda')
  }
  {
    const x = r('auto', [], false)
    eq('auto+啥都没装+没 vendor → none', x.use, { kind: 'none' })
    eq('wantInstall=cuda', x.wantInstall, 'cuda')
  }
  eq('显式 cpu 已装 → installed/cpu', r('cpu', ['cpu', 'cuda']).use, {
    kind: 'installed',
    backend: 'cpu'
  })
  {
    const x = r('cuda', ['vulkan'])
    eq('显式没装 → 顶上能用的 + wantInstall=cuda', x.use, { kind: 'installed', backend: 'vulkan' })
    eq('wantInstall=cuda', x.wantInstall, 'cuda')
  }
  {
    const x = r('vulkan', ['cpu'])
    eq('显式 vulkan 没装只装 cpu → installed/cpu', x.use, { kind: 'installed', backend: 'cpu' })
    eq('wantInstall=vulkan', x.wantInstall, 'vulkan')
  }
  {
    const x = r('cpu', [])
    eq('显式 cpu 没装有 vendor → vendor', x.use, { kind: 'vendor' })
    eq('wantInstall=cpu', x.wantInstall, 'cpu')
  }
  eq('auto+cuda 没装但 cpu/vulkan 装了 → 取更优的 vulkan', r('auto', ['cpu', 'vulkan']).use, {
    kind: 'installed',
    backend: 'vulkan'
  })
}
eq('sanitizeBackendChoice 白名单', ['auto', 'cuda', 'junk', undefined].map(sanitizeBackendChoice), [
  'auto',
  'cuda',
  'auto',
  'auto'
])

// 安装器纯函数件 
console.log(' 安装器纯件(进度折算 / zip 安检)')
eq('下载进度:两包下完一半', downloadPercent([100, 300], [50, 150]), 45)
eq('下载进度:全下完 = 90(尾巴留给校验解压)', downloadPercent([100, 300], [100, 300]), 90)
eq('下载进度:越界数字被夹住', downloadPercent([100], [999]), 90)
eq('下载进度:零起步', downloadPercent([100], [0]), 0)
check('zip 安检:.. 越级拒', !isZipEntrySafe('../evil.txt'))
check('zip 安检:嵌套 .. 拒', !isZipEntrySafe('a/../evil.txt'))
check('zip 安检:盘符拒', !isZipEntrySafe('C:/evil.txt'))
check('zip 安检:斜杠开头拒', !isZipEntrySafe('/etc/passwd'))
check('zip 安检:UNC 拒', !isZipEntrySafe('\\\\share\\x'))
check('zip 安检:正常条目收', isZipEntrySafe('./llama-server.exe') && isZipEntrySafe('bin/x.dll'))
check('zip 安检:反斜杠 .. 拒', !isZipEntrySafe('a\\..\\evil.txt'))

// verifyAndExtract 全谱 
console.log(' verifyAndExtract(真 tar,错 sha / 截短 / zip-slip)')
{
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eng-'))
  try {
    // 造一个真 zip(tar -a),里放一个假 llama-server.exe
    const src = join(dir, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'llama-server.exe'), 'not a real exe')
    const zip = join(dir, 'pkg.zip')
    execFileSync('tar', ['-a', '-c', '-f', zip, '-C', src, '.'])
    const realSha = createHash('sha256').update(readFileSync(zip)).digest('hex')
    const realBytes = statSync(zip).size
    const dest = join(dir, 'out')

    // 正例:校验过、解出来、exe 在
    await verifyAndExtract(zip, { bytes: realBytes, sha256: realSha }, dest)
    check('合法包解出 llama-server.exe', findExtractedExe(dest) !== null)
    check('正例后包还在(不删)', existsSync(zip))

    // 错 sha:拒 + 删包
    const bad = join(dir, 'bad.zip')
    writeFileSync(bad, readFileSync(zip))
    await verifyAndExtract(bad, { bytes: realBytes, sha256: '0'.repeat(64) }, join(dir, 'o2')).then(
      () => check('错 sha 拒收', false),
      (e) => check('错 sha 拒收', String(e.message).includes('校验'))
    )
    check('错 sha 后包被删', !existsSync(bad))

    // 截短:拒 + 删包
    const trunc = join(dir, 'trunc.zip')
    writeFileSync(trunc, readFileSync(zip).subarray(0, realBytes - 7))
    await verifyAndExtract(trunc, { bytes: realBytes, sha256: realSha }, join(dir, 'o3')).then(
      () => check('截短包拒收', false),
      (e) => check('截短包拒收', String(e.message).includes('大小'))
    )
    check('截短后包被删', !existsSync(trunc))

    // zip slip:手工缝一个带 ..\evil.txt 条目的真 zip
    const evil = join(dir, 'evil.zip')
    writeFileSync(evil, makeZip([{ name: '..\\evil.txt', data: Buffer.from('pwn') }]))
    const slipDest = join(dir, 'slip-out')
    await verifyAndExtract(
      evil,
      {
        bytes: statSync(evil).size,
        sha256: createHash('sha256').update(readFileSync(evil)).digest('hex')
      },
      slipDest
    ).then(
      () => check('zip slip 拒收', false),
      (e) =>
        check(
          'zip slip 拒收',
          String(e.message).includes('不安全') || String(e.message).includes('读不开')
        )
    )
    check('slip 后包被删', !existsSync(evil))
    check('目标目录外没有 evil.txt', !existsSync(join(dir, 'evil.txt')))

    // 没 exe 的解包目录:findExtractedExe 老实回 null
    const emptyDir = join(dir, 'empty')
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(emptyDir, 'readme.txt'), 'x')
    eq('没 exe 的目录 → null', findExtractedExe(emptyDir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 缝一个最小合法 zip(stored 不压缩,单/多条目)—— 专喂 zip-slip 与安检测试 */
function makeZip(entries: { name: string; data: Buffer }[]): Buffer {
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

// installBackend(本地 fetch 喂假包:下载→校验→解压→试跑全链走一遍)
console.log(' installBackend 失败谱(假 exe 跑不动 → 清理 + 人话)')
{
  const dir = mkdtempSync(join(tmpdir(), 'atlas-enginst-'))
  try {
    // fetchImpl 喂「字节数正好、内容全错」的流(cpu 包 19,565,071 字节):
    // 下载段会收下,sha256 校验必须出手拦
    const garbage = Readable.toWeb(
      Readable.from([Buffer.alloc(ENGINE_CATALOG.cpu.assets[0].bytes, 7)])
    )
    const fetchImpl = async () => new Response(garbage as ReadableStream, { status: 200 })
    const r = await installBackend('cpu', {
      userDataDir: join(dir, 'ud'),
      fetchImpl
    }).then(
      () => ({ ok: true as const }),
      (e: Error) => ({ ok: false as const, err: e.message })
    )
    check('垃圾包过下载被 sha 校验拦下', !r.ok && String(r.err).includes('校验'))
    eq('失败后没留下半截安装', listInstalled(join(dir, 'ud')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// config 的 backend 落盘 
console.log(' config backend round-trip')
{
  const dir = mkdtempSync(join(tmpdir(), 'atlas-cfgb-'))
  try {
    const cfg = (await loadAiConfig(dir)) as AiConfig
    cfg.builtin.backend = 'cuda'
    await saveAiConfig(dir, cfg)
    eq('cuda 落盘读回', (await loadAiConfig(dir)).builtin.backend, 'cuda')
    cfg.builtin.backend = 'auto'
    await saveAiConfig(dir, cfg)
    eq('auto 不落盘(读回 undefined)', (await loadAiConfig(dir)).builtin.backend, undefined)
    cfg.builtin.backend = 'vulkan'
    await saveAiConfig(dir, cfg)
    eq('vulkan 落盘读回', (await loadAiConfig(dir)).builtin.backend, 'vulkan')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 对账键把后端算进签名 
console.log(' settingsKey 签名含后端')
{
  const base = { serverPath: '', modelPath: 'f:\\m.gguf' }
  check(
    '改后端 = 签名变',
    settingsKey({ ...base, backend: 'cuda' }) !== settingsKey({ ...base, backend: 'vulkan' })
  )
  check('undefined 与 auto 同签名', settingsKey(base) === settingsKey({ ...base, backend: 'auto' }))
  check(
    '同后端签名同',
    settingsKey({ ...base, backend: 'cpu' }) === settingsKey({ ...base, backend: 'cpu' })
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
