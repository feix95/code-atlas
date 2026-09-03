import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  buildExplainPrompt,
  buildFolderPrompt,
  buildGuessPrompt,
  explainWithModel,
  GUESS_SYSTEM_PROMPT,
  isBinaryFile
} from '../src/ai/index.ts'
import { aiConfigPath, defaultAiConfig, loadAiConfig, resolveAiTarget, saveAiConfig } from '../src/ai/config.ts'
import { parseListenerPids, parseTasklistImage, resolveServerProgram } from '../src/ai/builtin.ts'
import type { AiConfig, FileStructure } from '../src/shared/types.ts'

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

function lmConfig(model: string, baseUrl = 'http://127.0.0.1:1234/v1'): AiConfig {
  return {
    provider: 'lmstudio',
    lmstudio: { baseUrl, model, apiKey: '' },
    builtin: { serverPath: '', modelPath: '' }
  }
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

  // ── 2. 文件夹提示词:清单全进证据、根目录与截断都有人话 ──
  const fp = buildFolderPrompt({
    relPath: 'src/main',
    name: 'main',
    subdirs: ['utils'],
    files: ['index.ts', 'server.ts'],
    languages: { TypeScript: 12, Python: 3 }
  })
  assert.ok(fp.includes('src/main'), '文件夹提示词应含路径')
  assert.ok(fp.includes('utils'), '应含子文件夹名')
  assert.ok(fp.includes('index.ts'), '应含文件名')
  assert.ok(fp.includes('TypeScript×12'), '应含语言分布')

  const fpRoot = buildFolderPrompt({ relPath: '', name: 'code-atlas', subdirs: [], files: [], languages: {} })
  assert.ok(fpRoot.includes('项目根目录'), '根目录要有说明')
  assert.ok(fpRoot.includes('没有可识别的代码文件'), '空清单要老实说')

  const manyFiles = Array.from({ length: 150 }, (_, i) => `f${i}.ts`)
  const fpBig = buildFolderPrompt({ relPath: 'big', name: 'big', subdirs: [], files: manyFiles, languages: {} })
  assert.ok(fpBig.includes('还有 50 个没列出'), '超量文件要注明截断')
  assert.ok(!fpBig.includes('f149.ts'), '没列出的文件不许混进提示词')

  // ── 3. 猜猜官提示词:名字 + 片段进证据、读不了/空文件有人话 ──
  const gp = buildGuessPrompt({
    relPath: 'tools/deploy.sh',
    name: 'deploy.sh',
    languageName: 'Shell',
    preview: 'echo start\ncp -r dist /var/www'
  })
  assert.ok(gp.includes('deploy.sh'), '应含文件名')
  assert.ok(gp.includes('cp -r dist'), '应含内容片段')
  assert.ok(gp.includes('Shell'), '应含语言名')

  const gpNull = buildGuessPrompt({ relPath: 'x', name: 'x', languageName: '', preview: null })
  assert.ok(gpNull.includes('读不出文本内容'), '读不了内容要明说')
  const gpEmpty = buildGuessPrompt({ relPath: 'e', name: 'e', languageName: '', preview: '' })
  assert.ok(gpEmpty.includes('空文件'), '空文件要明说')

  // ── 4. 二进制判断:媒体/二进制不算代码,svg 与无后缀不算二进制 ──
  assert.ok(isBinaryFile('photo.PNG'), '大小写不敏感')
  assert.ok(isBinaryFile('app.exe'), '可执行文件是二进制')
  assert.ok(!isBinaryFile('logo.svg'), 'svg 是文本')
  assert.ok(!isBinaryFile('.gitignore'), '隐藏文件不算二进制')
  assert.ok(!isBinaryFile('Makefile'), '无后缀不算二进制')

  // ── 5. 配置读写往返(新双 Provider 格式)+ 老格式自动搬家 ──
  const dir = await mkdtemp(join(tmpdir(), 'codeatlas-ai-'))
  try {
    const fallback = defaultAiConfig()
    assert.equal(fallback.provider, 'lmstudio', '默认 Provider 应为 LM Studio')
    assert.equal(fallback.lmstudio.baseUrl, 'http://127.0.0.1:1234/v1', '默认地址应为 LM Studio 本地服务')
    assert.equal(fallback.builtin.serverPath, '', '内置 Provider 默认未配置')

    const saved = await saveAiConfig(dir, {
      provider: 'builtin',
      lmstudio: { baseUrl: '  http://127.0.0.1:1234/v1  ', model: 'Qwen3.8-27B', apiKey: '' },
      builtin: { serverPath: ' D:\\tools\\llama-server.exe ', modelPath: 'F:\\models\\qwen.gguf' }
    })
    assert.equal(saved.provider, 'builtin', 'Provider 应保存')
    assert.equal(saved.lmstudio.baseUrl, 'http://127.0.0.1:1234/v1', 'baseUrl 应去掉首尾空格')
    assert.equal(saved.builtin.serverPath, 'D:\\tools\\llama-server.exe', 'serverPath 应去掉首尾空格')
    const loaded = await loadAiConfig(dir)
    assert.equal(loaded.provider, 'builtin', '重新读回 Provider')
    assert.equal(loaded.lmstudio.model, 'Qwen3.8-27B', '重新读回模型名')
    assert.equal(loaded.builtin.modelPath, 'F:\\models\\qwen.gguf', '重新读回模型文件路径')

    // 老版本配置是扁平的 {baseUrl, model, apiKey}:load 时要自动搬进 lmstudio 分支
    await writeFile(
      aiConfigPath(dir),
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1234/v1', model: '老配置模型', apiKey: 'sk-old' }),
      'utf8'
    )
    const migrated = await loadAiConfig(dir)
    assert.equal(migrated.provider, 'lmstudio', '老配置迁移后 Provider 应为 lmstudio')
    assert.equal(migrated.lmstudio.model, '老配置模型', '老配置的模型名应搬进 lmstudio 分支')
    assert.equal(migrated.lmstudio.apiKey, 'sk-old', '老配置的 apiKey 应保留')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // ── 6. resolveAiTarget:两个 Provider 收敛成同一个 ChatTarget ──
  const lmOk = resolveAiTarget(lmConfig('gpt-本地'))
  assert.ok(lmOk.ok, 'LM Studio 配好模型应解析成功')
  assert.equal(lmOk.ok && lmOk.target.baseUrl, 'http://127.0.0.1:1234/v1', '目标地址来自 lmstudio 设置')
  assert.equal(lmOk.ok && lmOk.target.model, 'gpt-本地', '目标模型名来自 lmstudio 设置')

  const lmNoModel = resolveAiTarget(lmConfig(''))
  assert.ok(!lmNoModel.ok, 'LM Studio 没选模型应解析失败')
  assert.ok(!lmNoModel.ok && lmNoModel.message.includes('AI 设置'), '失败要给人话指引')

  const biMissing = resolveAiTarget({ ...lmConfig(''), provider: 'builtin' })
  assert.ok(!biMissing.ok, '内置 Provider 没选模型应解析失败')
  assert.ok(!biMissing.ok && biMissing.message.includes('还没选模型'), '失败要指向选模型这个动作')

  const biOk = resolveAiTarget({ ...lmConfig(''), provider: 'builtin' }, { baseUrl: 'http://127.0.0.1:8766/v1', model: 'qwen-7b' })
  assert.ok(biOk.ok, '内置 Provider 有运行时应解析成功')
  assert.equal(biOk.ok && biOk.target.baseUrl, 'http://127.0.0.1:8766/v1', '目标地址来自子进程运行时')
  assert.equal(biOk.ok && biOk.target.model, 'qwen-7b', '目标模型名来自子进程报告')

  // ── 6.5 引擎自动定位:填了就用填的;没填找 app 自带的;都没有给人话错误 ──
  const exeDir = await mkdtemp(join(tmpdir(), 'codeatlas-builtin-'))
  try {
    const exePath = join(exeDir, 'llama-server.exe')
    await writeFile(exePath, 'fake engine')
    assert.equal(resolveServerProgram(`  ${exePath}  `), exePath.trim(), '手动填的路径应去掉空格原样使用')

    let threw = ''
    try {
      resolveServerProgram('D:\\不存在\\llama-server.exe')
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err)
    }
    assert.ok(threw.includes('找不到'), '不存在的程序路径要给人话错误')

    // 没填路径时回退到 app 自带引擎;引擎没下载就跳过这条(dev 机器上通常已就位)
    const bundled = join(process.cwd(), 'vendor', 'llama-cpp', 'llama-server.exe')
    if (existsSync(bundled)) {
      assert.equal(resolveServerProgram(''), bundled, '没填路径应自动用内置引擎')
    }
  } finally {
    await rm(exeDir, { recursive: true, force: true })
  }

  // ── 6.6 孤儿收尸的纯函数:netstat / tasklist 输出解析(端口认领要精确,击杀要验明正身) ──
  const netstatSample = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:8766         0.0.0.0:0              LISTENING       1234',
    '  TCP    [::]:8766              [::]:0                 LISTENING       5678',
    '  TCP    127.0.0.1:18766        0.0.0.0:0              LISTENING       99',
    '  TCP    127.0.0.1:8765         1.2.3.4:5555           ESTABLISHED     42'
  ].join('\n')
  assert.deepEqual(parseListenerPids(netstatSample, 8766), [1234, 5678], '应找出监听 8766 的 PID(18766/8765/非监听都不算)')
  assert.deepEqual(parseListenerPids('  TCP    0.0.0.0:8766    0.0.0.0:0    LISTENING    not-a-pid', 8766), [], 'PID 不是数字就不收')
  assert.deepEqual(parseListenerPids('', 8766), [], '空输出给空清单')
  assert.equal(
    parseTasklistImage('"llama-server.exe","1234","Console","1","123,456 K"'),
    'llama-server.exe',
    'tasklist CSV 应抠出映像名'
  )
  assert.equal(parseTasklistImage('INFO: 没有运行的任务匹配指定的标准。'), '', '查无此进程应得空串,绝不凭空杀人')

  // ── 7. 用本地假模型服务验证整条 fetch → 解析链路(非流式 + SSE 流式) ──
  const receivedBodies: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      receivedBodies.push(body)
      const wantsStream = body.includes('"stream":true')
      if (wantsStream) {
        // SSE 流式:分三帧发,中间夹一个心跳注释,最后一帧 [DONE]
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: {"choices":[{"delta":{"content":"这个文件是应用的"}}]}\n\n')
        res.write(': keep-alive 心跳,不是数据帧\n\n')
        res.write('data: {"choices":[{"delta":{"content":"入口,负责启动主界面。"}}]}\n\n')
        res.end('data: [DONE]\n\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '这个文件是应用的入口,负责启动主界面。' } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object', '假服务应监听在端口上')
  const port = address.port
  const target = { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fake-model' }

  try {
    // 非流式:老行为不变
    const result = await explainWithModel(target, prompt)
    assert.equal(result.status, 'supported', '应成功拿到解释')
    assert.ok(result.text.includes('入口'), '解析出的内容应是模型回复')
    assert.equal(result.model, 'fake-model', '回显所用模型')

    // 请求体断言:模型名与消息结构要对,且非流式请求不带 stream:true
    const sent = JSON.parse(receivedBodies[0] ?? '') as { model: string; messages: Array<{ role: string; content: string }>; stream?: boolean }
    assert.equal(sent.model, 'fake-model', '发出去的模型名应是配置里的')
    assert.equal(sent.messages.length, 2, '应有两段消息(system + user)')
    assert.equal(sent.messages[0]?.role, 'system', '第一段是系统人设')
    assert.equal(sent.messages[1]?.role, 'user', '第二段是用户提示词')
    assert.notEqual(sent.stream, true, '没传 onDelta 就不该请求流式')

    // 流式:onDelta 逐段推送,拼起来 = 最终全文
    const pieces: string[] = []
    const streamRes = await explainWithModel(target, prompt, undefined, (t) => pieces.push(t))
    assert.equal(streamRes.status, 'supported', '流式请求应成功')
    assert.equal(streamRes.text, pieces.join(''), '流式增量拼起来应等于最终全文')
    assert.ok(streamRes.text.includes('入口'), '流式内容应是模型回复')
    assert.ok(pieces.length >= 2, '增量应分多段到达(边生成边显示)')
    assert.ok(receivedBodies[receivedBodies.length - 1]?.includes('"stream":true'), '传了 onDelta 就应请求流式')

    // 猜猜官人设:同一管道,换系统提示词后发出去的人设要跟着换
    const guessRes = await explainWithModel(target, gp, GUESS_SYSTEM_PROMPT)
    assert.equal(guessRes.status, 'supported', '猜猜官链路应通')
    const allBodies = receivedBodies.join('\n')
    assert.ok(allBodies.includes('猜猜官'), '猜猜官人设应发到服务')
    assert.ok(allBodies.includes('tools/deploy.sh'), '猜猜官提示词应带上文件证据')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  // ── 8. 服务连不上:应返回 error 状态而不是抛异常 ──
  const down = await explainWithModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x' }, prompt)
  assert.equal(down.status, 'error', '连不上服务时状态应为 error')
  assert.ok(down.text.includes('连不上'), '错误信息要提示检查模型服务')

  console.log('✅ AI 人话解释自测全部通过')
  console.log('   提示词固定不编造 · 文件夹/猜猜官提示词就位 · 二进制边界清楚 · 双 Provider 配置与老格式迁移 · resolveAiTarget 收敛 · 非流式与 SSE 流式链路通 · 人设随场景切换')
}

main().catch((err) => {
  console.error('❌ 自测失败:', err)
  process.exit(1)
})
