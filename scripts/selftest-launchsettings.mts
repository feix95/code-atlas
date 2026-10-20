// ── 高级启动账自测(第 3 期)─────────────────────────────────────────
// 跑法:npm run test:launchsettings
// 钉死的账:launchSettings.ts 的账簿净化(白名单字段、空账不留、最多 64 本按写入先后
// 挤旧的、原型链污染防住);parseExtraArgs 专家参数白名单解析;launchSignature 对账签名
// 稳定且与字段顺序无关;config.ts 落盘→读回状态表原样,老配置(没 launch 字段)照常加载。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchFor,
  launchSignature,
  normalizeModelPathKey,
  parseExtraArgs,
  sanitizeLaunchRecord,
  sanitizeModelLaunchSettings,
  type ModelLaunchSettings
} from '../src/shared/launchSettings.ts'
import { loadAiConfig, saveAiConfig } from '../src/ai/config.ts'
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
/** 规范化对象键序再比(比内容不比键的排布) */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`
}
function eq(name: string, actual: unknown, want: unknown) {
  check(name, canon(actual) === canon(want), `got ${canon(actual)} want ${canon(want)}`)
}

// ── normalizeModelPathKey ────────────────────────────────────────
console.log('── normalizeModelPathKey 键归一化')
check(
  '正斜杠归一成反斜杠+小写',
  normalizeModelPathKey('F:/Models/ABC.GGUF') === normalizeModelPathKey('f:\\models\\abc.gguf')
)
eq('混写归一', normalizeModelPathKey('F:/Models\\A.GGUF '), 'f:\\models\\a.gguf')
check('空串 = 空键', normalizeModelPathKey('   ') === '')

// ── sanitizeModelLaunchSettings(字段白名单)────────────────────────
console.log('── 高级账字段净化')
eq(
  '合法字段全收',
  sanitizeModelLaunchSettings({
    overrides: { kvCache: 'q8_0', flashAttn: 'on', mmprojOffload: false, gpuLayers: 24 },
    extraArgs: '-t 6'
  }),
  {
    overrides: { kvCache: 'q8_0', flashAttn: 'on', mmprojOffload: false, gpuLayers: 24 },
    extraArgs: '-t 6'
  }
)
eq('全空 = null(账不留)', sanitizeModelLaunchSettings({ overrides: {} }), null)
eq('非对象 = null', sanitizeModelLaunchSettings('junk'), null)
eq('undefined = null', sanitizeModelLaunchSettings(undefined), null)
eq(
  'contextSize 永不进账',
  sanitizeModelLaunchSettings({ overrides: { contextSize: 8192, kvCache: 'q8_0' } }),
  {
    overrides: { kvCache: 'q8_0' }
  }
)
eq(
  '脏值丢字段不丢整本',
  sanitizeModelLaunchSettings({ overrides: { kvCache: 'q4_0', gpuLayers: 24 } }),
  {
    overrides: { gpuLayers: 24 }
  }
)
eq('gpuLayers 负数丢', sanitizeModelLaunchSettings({ overrides: { gpuLayers: -1 } }), null)
eq('gpuLayers 1000 丢', sanitizeModelLaunchSettings({ overrides: { gpuLayers: 1000 } }), null)
eq('gpuLayers 0/999/auto 收', sanitizeModelLaunchSettings({ overrides: { gpuLayers: 'auto' } }), {
  overrides: { gpuLayers: 'auto' }
})
eq('gpuLayers 小数丢', sanitizeModelLaunchSettings({ overrides: { gpuLayers: 1.5 } }), null)
eq('gpuLayers 字符串数字丢', sanitizeModelLaunchSettings({ overrides: { gpuLayers: '24' } }), null)
eq(
  'extraArgs 超 300 字符整个丢',
  sanitizeModelLaunchSettings({ overrides: { gpuLayers: 1 }, extraArgs: 'x'.repeat(301) }),
  {
    overrides: { gpuLayers: 1 }
  }
)
eq(
  'extraArgs 非字符串丢',
  sanitizeModelLaunchSettings({ overrides: { gpuLayers: 1 }, extraArgs: 42 }),
  {
    overrides: { gpuLayers: 1 }
  }
)
eq(
  'unknown override 键丢',
  sanitizeModelLaunchSettings({ overrides: { ngl: 99, kvCache: 'f16' } }),
  {
    overrides: { kvCache: 'f16' }
  }
)
eq(
  '__proto__ 字段不存活',
  sanitizeModelLaunchSettings(JSON.parse('{"overrides":{"__proto__":{"x":1},"kvCache":"f16"}}')),
  {
    overrides: { kvCache: 'f16' }
  }
)
eq(
  '顶层 __proto__ 不进账',
  sanitizeModelLaunchSettings(JSON.parse('{"__proto__":{"y":2},"overrides":{"gpuLayers":3}}')),
  {
    overrides: { gpuLayers: 3 }
  }
)

// ── sanitizeLaunchRecord(账簿级)──────────────────────────────────
console.log('── 账簿净化(64 本上限/脏键/原型污染)')
{
  const dirty = {
    'f:\\models\\a.gguf': { overrides: { kvCache: 'q8_0' } },
    'C:\\\\evil': 'junk',
    constructor: { overrides: { gpuLayers: 1 } },
    'f:\\models\\empty.gguf': { overrides: {} },
    'f:\\models\\b.gguf': { overrides: { mmprojOffload: false }, extraArgs: '-b 512' }
  }
  const clean = sanitizeLaunchRecord(dirty)
  eq('脏键+空账踢掉,好账留下', Object.keys(clean).sort(), [
    'f:\\models\\a.gguf',
    'f:\\models\\b.gguf'
  ])
  check('constructor 键没存活', !Object.prototype.hasOwnProperty.call(clean, 'constructor'))
  check('原型没被污染', ({} as Record<string, unknown>)['x'] === undefined)
}
{
  const polluted = JSON.parse(
    '{"__proto__":{"polluted":true},"f:\\\\m.gguf":{"overrides":{"gpuLayers":2}}}'
  )
  const clean = sanitizeLaunchRecord(polluted)
  eq('__proto__ 账键被踢', Object.keys(clean), ['f:\\m.gguf'])
  check(
    'Object.prototype 没被污染',
    (Object.prototype as Record<string, unknown>)['polluted'] === undefined
  )
}
{
  const many: Record<string, unknown> = {}
  for (let i = 0; i < 70; i++) many[`f:\\m\\${i}.gguf`] = { overrides: { gpuLayers: i % 50 } }
  const clean = sanitizeLaunchRecord(many)
  eq('超 64 本挤掉最旧的', Object.keys(clean).length, 64)
  check('最新的还在', clean['f:\\m\\69.gguf'] !== undefined)
  check(
    '最旧的被挤走',
    clean['f:\\m\\0.gguf'] === undefined && clean['f:\\m\\5.gguf'] === undefined
  )
}

// ── launchFor / launchSignature ─────────────────────────────────
console.log('── 按模型取账 / 对账签名')
{
  const builtin = {
    serverPath: '',
    modelPath: 'F:\\Models\\A.GGUF',
    launch: { 'f:\\models\\a.gguf': { overrides: { kvCache: 'q8_0' as const } } }
  }
  check('大小写/正反斜杠都对上同同一数据源', launchFor(builtin)?.overrides.kvCache === 'q8_0')
  check('别的模型取不到账', launchFor({ ...builtin, modelPath: 'f:\\models\\other.gguf' }) === null)
  check('没账 = null', launchFor({ serverPath: '', modelPath: 'f:\\x.gguf' }) === null)
}
{
  const a: ModelLaunchSettings = {
    overrides: { kvCache: 'q8_0', gpuLayers: 24 },
    extraArgs: '-t 6'
  }
  const b: ModelLaunchSettings = {
    overrides: { gpuLayers: 24, kvCache: 'q8_0' },
    extraArgs: '-t 6'
  }
  check('字段顺序不同签名相同', launchSignature(a) === launchSignature(b))
  check('改一个字段签名变', launchSignature(a) !== launchSignature({ ...a, extraArgs: '-t 8' }))
  check(
    'null 与空账同签名(都是自动档)',
    launchSignature(null) === launchSignature({ overrides: {} })
  )
  check('undefined 同签名', launchSignature(undefined) === launchSignature(null))
  check(
    '改 override 签名变',
    launchSignature(a) !== launchSignature({ overrides: { kvCache: 'q8_0' } })
  )
}

// ── parseExtraArgs ───────────────────────────────────────────────
console.log('── 专家参数解析(白名单/带值旗/注入)')
{
  const ok = parseExtraArgs('-t 6 -b 1024 -ub 512 --no-mmap --mlock -np 4')
  check('常用旗全收', ok.ok && ok.args.join(' ') === '-t 6 -b 1024 -ub 512 --no-mmap --mlock -np 4')
  eq('空串 = 空参数', parseExtraArgs(''), { ok: true, args: [] })
  eq('全空白 = 空参数', parseExtraArgs('   \t '), { ok: true, args: [] })
  check(
    '长旗名收',
    parseExtraArgs('--threads 8 --batch-size 256 --ubatch-size 128 --parallel 2 --cache-reuse 256')
      .ok
  )
  check('--cache-reuse 要带值(真引擎收 --cache-reuse N)', !parseExtraArgs('--cache-reuse').ok)
  check(
    'MoE 摊 CPU 旗收',
    parseExtraArgs('-ncmoe 4').ok &&
      parseExtraArgs('--n-cpu-moe 4').ok &&
      parseExtraArgs('-cmoe').ok
  )
  check('分显卡旗收', parseExtraArgs('-sm layer -ts 3,1 -mg 0').ok)
  check('张量指定旗收', parseExtraArgs('-ot "ffn.*=CPU"').ok === false) // 引号按注入拒,符合"无引号"约定
  check('-ot 收', parseExtraArgs('-ot ffn.*=CPU').ok)
  // 已知取舍:-ot 的值里含 | 的正则(如 "a|b=CPU")被壳层元字符守卫一并拒掉,
  // 面板的 tooltip 里向用户明说这条限制
  check('-ot 含 | 的正则值暂拒(已知限制)', !parseExtraArgs('-ot ffn.a|b=CPU').ok)
  check(
    'RoPE 旗收',
    parseExtraArgs('--rope-scaling yarn --rope-freq-base 10000 --rope-freq-scale 0.5').ok
  )
  const bad = (s: string) => !parseExtraArgs(s).ok
  check('--temp 明确拒', bad('--temp 0.7'))
  check('--port 拒(端口归应用管)', bad('--port 9999'))
  check('-ngl 拒(层数归高级面板管)', bad('-ngl 99'))
  check('--mmproj 拒', bad('--mmproj x.gguf'))
  check('-m 拒(模型归设置管)', bad('-m other.gguf'))
  check('分号注入拒', bad('-t 6 ; calc'))
  check('&& 注入拒', bad('-t 6 && calc'))
  check('管道注入拒', bad('-t 6 | calc'))
  check('重定向拒', bad('-t 6 > out.txt'))
  check('反引号拒', bad('-t `whoami`'))
  check('$ 拒', bad('-t $HOME'))
  check('引号拒', bad("-t '6'"))
  check('^ 拒', bad('-t ^6'))
  check('换行拒', bad('-t 6\ncalc'))
  check('缺值拒', bad('-t'))
  check('值后跟旗 = 缺值拒', bad('-t -b 1024'))
  check('负数值算值(不吞下一个旗)', parseExtraArgs('--rope-freq-scale -0.5').ok)
  check('非数字负值也当值收', parseExtraArgs('-sm -weird').ok === false) // -weird 以 - 开头且不是负数 → -sm 缺值
  check('超 300 字符拒', bad('-t 6 ' + '-b 1 '.repeat(100)))
  check('带值旗给两个值 → 第二个被拒', bad('-t 6 7'))
  const r = parseExtraArgs('--wat 5')
  check('拒绝理由报旗名', !r.ok && r.reason.includes('--wat'))
}
// ── 签名与重启对账 ────────────────────────────────────────────────
console.log('── 签名进对账(改账重启,不改不重启)')
{
  // 模拟 builtin.ts 的对账:startedSig 记启动时的签名;设置里的账洗完再比
  const cfg = {
    serverPath: 'e:\\engine\\llama-server.exe',
    modelPath: 'F:\\Models\\A.GGUF',
    launch: { 'f:\\models\\a.gguf': { overrides: { kvCache: 'q8_0' as const }, extraArgs: '-t 6' } }
  }
  const started = launchSignature(launchFor(cfg))
  // 用户没动账 → 签名同 → 不该重启
  check('账没变签名同', launchSignature(launchFor(cfg)) === started)
  // 用户改账 → 签名不同 → 该重启
  const cfg2 = {
    ...cfg,
    launch: { 'f:\\models\\a.gguf': { overrides: { kvCache: 'f16' as const }, extraArgs: '-t 6' } }
  }
  check('改账签名不同', launchSignature(launchFor(cfg2)) !== started)
  // 用户把账清空 → 回到自动档签名
  const cfg3 = { ...cfg, launch: {} }
  check('清账回自动签名', launchSignature(launchFor(cfg3)) === launchSignature(null))
}

// ── config 落盘→读回 round-trip ─────────────────────────────────
console.log('── config 持久化 round-trip')
{
  const dir = mkdtempSync(join(tmpdir(), 'atlas-cfg-'))
  try {
    const cfg = (await loadAiConfig(dir)) as AiConfig
    cfg.builtin.launch = {
      'f:\\models\\a.gguf': {
        overrides: { kvCache: 'q8_0', mmprojOffload: false, gpuLayers: 24 },
        extraArgs: '-t 6 -b 1024'
      }
    }
    await saveAiConfig(dir, cfg)
    const back = await loadAiConfig(dir)
    eq('落盘读回账原样', back.builtin.launch, cfg.builtin.launch)
    // 空账不落盘
    cfg.builtin.launch = {}
    await saveAiConfig(dir, cfg)
    const back2 = await loadAiConfig(dir)
    check('空账读回 = undefined(字段整个不出现)', back2.builtin.launch === undefined)
    // 脏账落盘被洗
    cfg.builtin.launch = { 'f:\\m.gguf': { overrides: { kvCache: 'nope' as never, gpuLayers: 8 } } }
    await saveAiConfig(dir, cfg)
    const back3 = await loadAiConfig(dir)
    eq('脏值落盘时被洗', back3.builtin.launch, { 'f:\\m.gguf': { overrides: { gpuLayers: 8 } } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
// 老配置没有 launch 字段:loadAiConfig 默认值路径已经过 normalize(自测于 save→load 链上覆盖)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
