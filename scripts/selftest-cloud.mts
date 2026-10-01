// 在线 API(cloud Provider)自测:配置存取与 Key 加密落盘、目标收敛、上下文、报错人话、
// 读取模型(mock 网络,不访问真实服务)、设置完成度判定。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aiConfigPath,
  defaultAiConfig,
  loadAiConfig,
  resolveAiTarget,
  sanitizeProviderKind,
  saveAiConfig
} from '../src/ai/config.ts'
import { setSecretCodec, type SecretCodec } from '../src/ai/secretCodec.ts'
import { friendlyHttpError } from '../src/ai/http.ts'
import { probeContextSize, resolveContextSize } from '../src/ai/contextProbe.ts'
import { listRemoteModels, parseModelIds, type FetchLike } from '../src/ai/remoteModels.ts'
import { isAiConfigured } from '../src/shared/aiSetup.ts'
import {
  CLOUD_DEFAULT_CONTEXT,
  CLOUD_VENDORS,
  sanitizeCloudContext,
  sanitizeCloudVendorId
} from '../src/shared/cloudVendors.ts'
import type { AiCloudSettings, AiConfig } from '../src/shared/types.ts'

const SECRET = 'sk-test-0123456789'

/** 假加密器:可逆变换 + 前缀,足以验证「落盘不是明文、读回是明文」 */
const fakeCodec: SecretCodec = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString('base64'),
  decrypt: (cipher) => {
    const text = Buffer.from(cipher, 'base64').toString()
    return text.startsWith('enc:') ? text.slice(4) : null
  }
}

function cloudConfig(patch: Partial<AiCloudSettings> = {}): AiConfig {
  const base = defaultAiConfig()
  return {
    ...base,
    provider: 'cloud',
    cloud: {
      ...base.cloud,
      baseUrl: 'https://api.example.com/v1',
      model: 'example-chat',
      apiKey: SECRET,
      consented: true,
      ...patch
    }
  }
}

// ── 1. 预设表与清洗 ──
{
  const ids = CLOUD_VENDORS.map((v) => v.id)
  assert.equal(new Set(ids).size, ids.length, '服务商 id 不得重复')
  assert.ok(ids.includes('custom'), '必须保留「自定义」兜底')
  for (const v of CLOUD_VENDORS) {
    if (v.id === 'custom') assert.equal(v.baseUrl, '', '自定义不预填地址')
    else assert.match(v.baseUrl, /^https:\/\//, `${v.label} 地址必须是 https`)
  }
  assert.equal(sanitizeCloudVendorId('不存在'), 'deepseek', '认不出的服务商回默认')
  assert.equal(sanitizeCloudContext(12345), 12345, '任意合法值原样保留(在线 API 可自由填写)')
  assert.equal(sanitizeCloudContext(524288), 524288, '1M 以内的档位可用')
  assert.equal(sanitizeCloudContext(1048576), 1048576, '1M 封顶值可用')
  assert.equal(sanitizeCloudContext(9999999), CLOUD_DEFAULT_CONTEXT, '超 1M 回默认')
  assert.equal(sanitizeCloudContext(100), CLOUD_DEFAULT_CONTEXT, '低于下限回默认')
  assert.equal(sanitizeCloudContext('128k'), CLOUD_DEFAULT_CONTEXT, '非数字回默认')
  assert.equal(sanitizeProviderKind('cloud'), 'cloud')
  assert.equal(sanitizeProviderKind(undefined), 'lmstudio', '缺字段沿用历史兜底 lmstudio')
}

// ── 2. 存取往返:有加密器 → 落盘为密文,读回为明文 ──
const dir = await mkdtemp(join(tmpdir(), 'codeatlas-cloud-'))
try {
  setSecretCodec(fakeCodec)
  const saved = await saveAiConfig(dir, cloudConfig({ apiKey: `  ${SECRET}  ` }))
  assert.equal(saved.cloud.apiKey, SECRET, '返回值为去空白后的明文')
  const disk = await readFile(aiConfigPath(dir), 'utf8')
  assert.ok(!disk.includes(SECRET), '落盘文件不得出现明文 Key')
  assert.ok(disk.includes('apiKeyEnc'), '落盘应为 apiKeyEnc 密文字段')
  const loaded = await loadAiConfig(dir)
  assert.equal(loaded.provider, 'cloud', 'Provider 读回 cloud')
  assert.equal(loaded.cloud.apiKey, SECRET, '读回时解密成明文')
  assert.equal(loaded.cloud.consented, true, '隐私确认状态读回')
  assert.equal(loaded.cloud.model, 'example-chat')

  // 解密失败(换机器):Key 变空,其余设置保留
  setSecretCodec({ encrypt: fakeCodec.encrypt, decrypt: () => null })
  const broken = await loadAiConfig(dir)
  assert.equal(broken.cloud.apiKey, '', '解不开的密文 → Key 为空,请用户重填')
  assert.equal(broken.cloud.model, 'example-chat', '解密失败不影响其他字段')

  // 加密不可用:退回明文落盘(仍能用)
  setSecretCodec({ encrypt: () => null, decrypt: () => null })
  await saveAiConfig(dir, cloudConfig())
  assert.equal((await loadAiConfig(dir)).cloud.apiKey, SECRET, '加密不可用时按明文存取')

  // 老配置没有 cloud 分支:全默认,行为不变
  setSecretCodec(fakeCodec)
  await writeFile(
    aiConfigPath(dir),
    JSON.stringify({
      provider: 'lmstudio',
      lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: '' },
      builtin: { serverPath: '', modelPath: '' }
    }),
    'utf8'
  )
  const legacy = await loadAiConfig(dir)
  assert.equal(legacy.provider, 'lmstudio', '老配置 Provider 不变')
  assert.equal(legacy.cloud.consented, false, '老配置默认未确认在线 API')
  assert.equal(legacy.cloud.apiKey, '', '老配置无 Key')
  assert.equal(legacy.cloud.contextSize, CLOUD_DEFAULT_CONTEXT)
} finally {
  setSecretCodec(null)
  await rm(dir, { recursive: true, force: true })
}

// ── 3. resolveAiTarget:在线 API 缺项各给指路话,齐全则盖章 cloud ──
{
  const ok = resolveAiTarget(cloudConfig())
  assert.ok(ok.ok, '配置齐全应解析成功')
  assert.equal(ok.ok && ok.target.engine, 'cloud')
  assert.equal(ok.ok && ok.target.apiKey, SECRET, 'Key 随目标带上')
  assert.equal(ok.ok && ok.target.timings, undefined, '不带内置引擎专属参数')
  const cases: Array<[Partial<AiCloudSettings>, string]> = [
    [{ consented: false }, '确认'],
    [{ baseUrl: '' }, '服务地址'],
    [{ apiKey: '' }, 'API Key'],
    [{ model: '' }, '模型']
  ]
  for (const [patch, word] of cases) {
    const r = resolveAiTarget(cloudConfig(patch))
    assert.ok(!r.ok && r.message.includes(word), `缺项提示应包含「${word}」`)
  }
}

// ── 4. 上下文:在线 API 不探测,用设置里选的档 ──
{
  assert.equal(resolveContextSize('cloud', 65536, null), 65536, '在线 API 用选定档位')
  assert.equal(resolveContextSize('cloud', 1048576, null), 1048576, '在线 API 可到 1M')
  let fetched = false
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetched = true
    return new Response('{}')
  }) as typeof fetch
  try {
    const probed = await probeContextSize(
      { baseUrl: 'https://api.example.com/v1', model: 'x', engine: 'cloud' },
      'cloud'
    )
    assert.equal(probed, null, '在线 API 探测直接回 null')
    assert.equal(fetched, false, '在线 API 不发探测请求')
  } finally {
    globalThis.fetch = realFetch
  }
}

// ── 5. 报错人话:只对在线 API 翻译状态码,本地两路行为不变 ──
{
  assert.ok(friendlyHttpError(401, '', 'cloud')?.includes('API Key'))
  assert.ok(friendlyHttpError(402, '', 'cloud')?.includes('余额'))
  assert.ok(friendlyHttpError(429, '', 'cloud')?.includes('频繁'))
  assert.ok(friendlyHttpError(503, '', 'cloud')?.includes('服务商'))
  assert.ok(friendlyHttpError(400, 'context length exceeded', 'cloud')?.includes('上下文窗口'))
  assert.equal(friendlyHttpError(418, '', 'cloud'), null, '未登记的状态码透传原文')
  assert.equal(friendlyHttpError(401, '', 'lmstudio'), null, 'LM Studio 行为不变')
  assert.equal(friendlyHttpError(500, '', 'builtin'), null, '内置引擎行为不变')
}

// ── 6. 读取模型:带 Key、翻译报错、连不上、空 Key 拦截(mock 网络) ──
{
  assert.deepEqual(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }, { x: 1 }] }), ['b', 'a'])
  assert.deepEqual(parseModelIds(null), [], '认不出回空数组')

  let seen: { url: string; auth: string | undefined } | null = null
  const okFetch: FetchLike = async (url, init) => {
    seen = { url, auth: (init.headers as Record<string, string>).Authorization }
    return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
  }
  const ids = await listRemoteModels(
    { baseUrl: 'https://api.example.com/v1/', apiKey: ` ${SECRET} `, provider: 'cloud' },
    okFetch
  )
  assert.deepEqual(ids, ['m1'])
  assert.deepEqual(
    seen,
    { url: 'https://api.example.com/v1/models', auth: `Bearer ${SECRET}` },
    '请求 /models 并带 Bearer Key(去掉尾斜杠与空白)'
  )

  const status401: FetchLike = async () => new Response('bad key', { status: 401 })
  await assert.rejects(
    listRemoteModels({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'cloud' }, status401),
    /API Key/,
    '401 翻成 Key 问题'
  )
  const down: FetchLike = async () => {
    throw new Error('ECONNREFUSED')
  }
  await assert.rejects(
    listRemoteModels({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'cloud' }, down),
    /连不上服务商/,
    '断网说清楚是网络问题'
  )
  await assert.rejects(
    listRemoteModels({ baseUrl: 'https://x/v1', apiKey: ' ', provider: 'cloud' }, okFetch),
    /API Key/,
    '在线 API 没填 Key 直接拦下,不发请求'
  )
  const lmIds = await listRemoteModels(
    { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', provider: 'lmstudio' },
    async (_url, init) => {
      assert.deepEqual(init.headers, {}, 'LM Studio 无 Key 时不带鉴权头')
      return new Response(JSON.stringify({ data: [{ id: 'local' }] }))
    }
  )
  assert.deepEqual(lmIds, ['local'])
}

// ── 7. 设置完成度:在线 API 需确认 + Key + 模型 + http(s) 地址 ──
{
  assert.equal(isAiConfigured(cloudConfig()), true)
  assert.equal(isAiConfigured(cloudConfig({ consented: false })), false)
  assert.equal(isAiConfigured(cloudConfig({ apiKey: '' })), false)
  assert.equal(isAiConfigured(cloudConfig({ model: ' ' })), false)
  assert.equal(isAiConfigured(cloudConfig({ baseUrl: 'file:///x' })), false)
}

console.log('在线 API 自测全部通过')
