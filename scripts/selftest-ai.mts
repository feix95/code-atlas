import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { buildExplainPrompt, explainWithModel, isExplainable } from '../src/ai/index.ts'
import { defaultAiConfig, loadAiConfig, saveAiConfig } from '../src/ai/config.ts'
import type { FileStructure, AiConfig } from '../src/shared/types.ts'

function sampleStructure(): FileStructure {
  return {
    languageId: 'typescript',
    imports: ['react'],
    exports: ['App'],
    functions: ['main'],
    classes: [],
    interfaces: [],
    reactComponents: []
  }
}

function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  // ── 1. 提示词构建:固定、把证据摆进去、绝不引入结构外的内容 ──
  const prompt = buildExplainPrompt({
    relPath: 'src/main.tsx',
    name: 'main.tsx',
    languageName: 'typescript-react',
    structure: sampleStructure(),
    graph: null
  })
  const p = cleanPrompt(prompt)
  assert.ok(p.includes('src/main.tsx'), '提示词应含文件路径')
  assert.ok(p.includes('main'), '提示词应含函数名')
  assert.ok(p.includes('App'), '提示词应含导出名')
  assert.ok(p.includes('react'), '提示词应含导入')
  assert.ok(!p.includes('不存在的函数'), '提示词不能夹带结构外的东西')

  // 空结构的边界:模型要被明确警告别编造
  const emptyPrompt = cleanPrompt(
    buildExplainPrompt({
      relPath: 'x.ts',
      name: 'x.ts',
      languageName: 'typescript',
      structure: { languageId: 'typescript', imports: [], exports: [], functions: [], classes: [], interfaces: [], reactComponents: [] },
      graph: null
    })
  )
  assert.ok(emptyPrompt.includes('不要编造'), '空结构要提醒模型别编造')

  // ── 2. isExplainable:支持/不支持边界 ──
  assert.ok(isExplainable('python'), 'python 应可解释')
  assert.ok(!isExplainable('json'), 'json 应不可解释(没结构)')

  // ── 3. 配置读写往返 ──
  const dir = await mkdtemp(join(tmpdir(), 'codeatlas-ai-'))
  try {
    const fallback = defaultAiConfig()
    assert.equal(fallback.baseUrl, 'http://127.0.0.1:1234/v1', '默认地址应为 LM Studio 本地服务')

    const saved = await saveAiConfig(dir, { baseUrl: '  http://127.0.0.1:1234/v1  ', model: 'Qwen3.8-27B', apiKey: '' })
    assert.equal(saved.baseUrl, 'http://127.0.0.1:1234/v1', 'baseUrl 应去掉首尾空格')
    const loaded = await loadAiConfig(dir)
    assert.equal(loaded.model, 'Qwen3.8-27B', '重新读回模型名')
    assert.equal(loaded.baseUrl, 'http://127.0.0.1:1234/v1', '重新读回地址')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // ── 4. 用本地假模型服务验证整条 fetch → 解析链路 ──
  const received: Uint8Array[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      received.push(chunk)
    })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '这个文件是应用的入口,负责启动主界面。' } }] }))
      void body
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object', '假服务应监听在端口上')
  const port = address.port
  const config: AiConfig = { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fake-model', apiKey: '' }

  try {
    const result = await explainWithModel(config, prompt)
    assert.equal(result.status, 'supported', '应成功拿到解释')
    assert.ok(result.text.includes('入口'), '解析出的内容应是模型回复')
    assert.equal(result.model, 'fake-model', '回显所用模型')

    // 请求体断言:模型名与消息结构要对
    const sent = JSON.parse(Buffer.concat(received).toString('utf8')) as { model: string; messages: Array<{ role: string; content: string }> }
    assert.equal(sent.model, 'fake-model', '发出去的模型名应是配置里的')
    assert.equal(sent.messages.length, 2, '应有两段消息(system + user)')
    assert.equal(sent.messages[0]?.role, 'system', '第一段是系统人设')
    assert.equal(sent.messages[1]?.role, 'user', '第二段是用户提示词')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  // ── 5. 服务连不上:应返回 error 状态而不是抛异常 ──
  const down = await explainWithModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x', apiKey: '' }, prompt)
  assert.equal(down.status, 'error', '连不上服务时状态应为 error')
  assert.ok(down.text.includes('连不上'), '错误信息要提示检查 LM Studio')

  console.log('✅ AI 人话解释自测全部通过')
  console.log('   提示词固定不编造 · 配置往返正常 · 本地假模型链路通 · 服务不可达有兜底')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
