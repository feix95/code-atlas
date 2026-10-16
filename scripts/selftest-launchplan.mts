// 智能启动方案的自测:纯算盘 planLaunch 全内存断言,不碰真文件/真引擎。
// 覆盖:显存预算/梯子降档顺序/MoE 容忍/无卡口径/手动指定照原样/-ngl 只在显式层数才出/
// 上下文地板/OOM 记号检测/重启对账钥匙(记用户档不记降后档)。
// 跑法: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/selftest-launchplan.mts
import assert from 'node:assert/strict'
import {
  bookkeepingContextSize,
  planCaveat,
  planLaunch,
  type MachineProfile
} from '../src/shared/launchPlan.ts'
import { engineLogHasOom } from '../src/ai/builtinLaunch.ts'
import { parseNvidiaSmiProfile, vendorFromGpuName } from '../src/ai/machineProbe.ts'
import type { GgufShape } from '../src/shared/types.ts'

const GB = 1024 ** 3

const gpu = (
  vramGB: number,
  freeGB: number,
  name = 'NVIDIA GeForce RTX 5060 Ti'
): MachineProfile => ({
  ramBytes: 32 * GB,
  vramBytes: vramGB * GB,
  vramFreeBytes: freeGB * GB,
  gpuName: name,
  gpuVendor: 'nvidia'
})
const M16 = gpu(16, 15)
const M8 = gpu(8, 8)
const M24 = gpu(24, 24)
const NO_GPU: MachineProfile = {
  ramBytes: 32 * GB,
  vramBytes: null,
  vramFreeBytes: null,
  gpuName: null,
  gpuVendor: null
}

/** Gemma-4-26B-A4B 的真实档案:30 层、8 KV 头(数组取最大)、128 专家 MoE */
const GEMMA4_SHAPE: GgufShape = {
  contextLength: 262144,
  blockCount: 30,
  headCount: 16,
  kvHeadCount: 8,
  embeddingLength: 2816,
  architecture: 'gemma4',
  expertCount: 128,
  expertUsedCount: 8
}
const GEMMA_BYTES = 13.4 * GB
const MMPROJ_BYTES = 1.19 * GB

const baseInput = (over: Partial<Parameters<typeof planLaunch>[0]>) => ({
  machine: M16,
  modelBytes: 4 * GB,
  mmprojBytes: null,
  shape: null,
  requestedContext: 16384,
  ...over
})

function main(): void {
  // ── 1. 基本盘:小模型 16GB 卡,默认档装得下 ──
  let plan = planLaunch(baseInput({}))
  assert.equal(plan.rung, 0, '4GB 模型 16GB 卡 → 默认档就够')
  assert.equal(plan.estimate.verdict, 'ok')
  assert.deepEqual(plan.args, ['-c', '16384'], '默认档参数只有 -c')
  assert.equal(plan.params.gpuLayers, 'auto', '层数交给引擎 --fit')
  assert.equal(plan.mmprojUsed, false)

  // 8GB 模型也装得下
  plan = planLaunch(baseInput({ modelBytes: 8 * GB }))
  assert.equal(plan.estimate.verdict, 'ok', '8GB 模型 16GB 卡装得下')
  assert.equal(plan.rung, 0)

  // ── 2. args 铁律:auto 绝不出 -ngl,显式层数才出 ──
  assert.ok(!plan.args.includes('-ngl'), 'auto 层数不出 -ngl(--fit 靠缺省生效)')
  const forced = planLaunch(baseInput({ overrides: { gpuLayers: 20 } }))
  assert.deepEqual(
    forced.args.slice(forced.args.indexOf('-ngl')),
    ['-ngl', '20'],
    '手动指定层数才发 -ngl N'
  )
  assert.ok(!forced.args.includes('-ngl') || forced.params.gpuLayers === 20)

  // ── 3. 梯子顺序:先摘投影仪,再降黑板,最后砍上下文 ──
  // 4.5GB 模型 + 0.7GB 投影仪,8GB 卡:rung0 超预算,rung1 摘掉投影仪装下
  const t1 = planLaunch(baseInput({ machine: M8, modelBytes: 4.5 * GB, mmprojBytes: 0.7 * GB }))
  assert.equal(t1.rung, 1, '第一档:投影仪放内存')
  assert.equal(t1.params.mmprojOffload, false)
  assert.ok(t1.args.includes('--no-mmproj-offload'), '发 --no-mmproj-offload')
  assert.ok(!t1.args.includes('-ctk'), '还没轮到降黑板')
  assert.equal(t1.estimate.verdict, 'ok')
  assert.ok(
    t1.reasons.some((r) => r.includes('视觉文件放在内存')),
    '得说清楚投影仪为什么放内存'
  )

  // 6GB 模型(不带投影仪)8GB 卡:rung1 跳档 → q8+fa → 还不够 → 砍上下文
  const t3 = planLaunch(baseInput({ machine: M8, modelBytes: 6 * GB }))
  assert.equal(t3.rung, 3, '4GB 级模型 8GB 卡要连降三档')
  assert.equal(t3.params.kvCache, 'q8_0')
  assert.equal(t3.params.flashAttn, 'on')
  assert.equal(t3.params.contextSize, 8192, '16384 砍半')
  assert.deepEqual(
    t3.args,
    ['-c', '8192', '-ctk', 'q8_0', '-ctv', 'q8_0', '-fa', 'on'],
    '参数串带全套省显存旗'
  )
  assert.ok(t3.reasons.some((r) => r.includes('上下文从 16384 调到 8192')))

  // ── 4. Gemma-4-26B MoE + 投影仪,16GB 卡(真机实测那台)──
  const gemma = planLaunch(
    baseInput({ modelBytes: GEMMA_BYTES, mmprojBytes: MMPROJ_BYTES, shape: GEMMA4_SHAPE })
  )
  // 显存超预算,但 MoE 专家可挪内存 → tight 收工,不停梯子
  assert.equal(gemma.rung, 0, 'MoE 容忍:模型+黑板在显存+一半内存内 → rung0 收')
  assert.equal(gemma.estimate.verdict, 'tight')
  assert.equal(gemma.params.mmprojOffload, true, '投影仪留显卡(实测装得下)')
  assert.equal(gemma.mmprojUsed, true)
  assert.ok(
    gemma.reasons.some((r) => r.includes('MoE')),
    'MoE 妥协要说明白'
  )
  assert.ok(!gemma.args.includes('-ngl'))

  // 同样模型放 24GB 卡:从容装下
  const gemma24 = planLaunch(
    baseInput({
      machine: M24,
      modelBytes: GEMMA_BYTES,
      mmprojBytes: MMPROJ_BYTES,
      shape: GEMMA4_SHAPE
    })
  )
  assert.equal(gemma24.estimate.verdict, 'ok', '24GB 卡装 Gemma-26B MoE 从容')
  assert.equal(gemma24.rung, 0)

  // ── 5. 装不下的结局:稠密 13.4GB 16GB 卡连降到底还是超 → too-big ──
  const dense13 = planLaunch(baseInput({ modelBytes: 13.4 * GB, mmprojBytes: MMPROJ_BYTES }))
  assert.equal(dense13.estimate.verdict, 'too-big', '稠密 13.4GB+投影仪 16GB 卡降到底也装不下')
  assert.equal(dense13.rung, 3, '梯子走到头')
  assert.equal(dense13.params.contextSize, 8192)
  assert.ok(dense13.reasons.some((r) => r.includes('装不下')))

  // 30GB MoE:超了「显存+一半内存」的 MoE 容忍线 → too-big(不被误判成 tight)
  const moe30 = planLaunch(baseInput({ modelBytes: 30 * GB, shape: GEMMA4_SHAPE }))
  assert.equal(moe30.estimate.verdict, 'too-big', '30GB MoE 连内存一起匀也匀不开')

  // 40GB 稠密 24GB 卡 → too-big
  const dense40 = planLaunch(baseInput({ machine: M24, modelBytes: 40 * GB }))
  assert.equal(dense40.estimate.verdict, 'too-big')

  // ── 6. 没认出显卡:默认档 + 内存口径 + 人话 ──
  const noGpu = planLaunch(baseInput({ machine: NO_GPU, modelBytes: 4 * GB }))
  assert.equal(noGpu.rung, 0, '无卡不玩梯子')
  assert.equal(noGpu.estimate.vramBytes, null)
  assert.equal(noGpu.estimate.verdict, 'ok', '4GB 模型 32GB 内存跑得动')
  assert.ok(noGpu.reasons.some((r) => r.includes('没认出显卡')))
  const noGpuBig = planLaunch(baseInput({ machine: NO_GPU, modelBytes: 30 * GB }))
  assert.equal(noGpuBig.estimate.verdict, 'too-big', '30GB 模型 32GB 内存装不下')

  // ── 7. AMD 卡走同一本账(vendor 不当门槛) ──
  const amd = planLaunch(
    baseInput({
      machine: { ...M8, gpuName: 'AMD Radeon RX 7800 XT', gpuVendor: 'amd' },
      modelBytes: 4 * GB
    })
  )
  assert.equal(amd.estimate.verdict, 'ok')

  // ── 8. 手动指定照原样,梯子不碰 ──
  const ovCtx = planLaunch(baseInput({ overrides: { contextSize: 8192 } }))
  assert.equal(ovCtx.params.contextSize, 8192)
  assert.ok(!ovCtx.reasons.some((r) => r.includes('上下文从')), '用户自己填的档,不归账到梯子头上')
  assert.ok(ovCtx.reasons.some((r) => r.includes('手动指定')))

  const ovMm = planLaunch(
    baseInput({ mmprojBytes: MMPROJ_BYTES, overrides: { mmprojOffload: false } })
  )
  assert.equal(ovMm.params.mmprojOffload, false)
  assert.ok(ovMm.args.includes('--no-mmproj-offload'))
  assert.ok(
    !ovMm.reasons.some((r) => r.includes('视觉文件放在内存')),
    '用户自己选的放内存,梯子不抢功'
  )

  // 全字段都手动 → 梯子原地解散,参数逐字照用(哪怕装不下也是用户的意思)
  const ovAll = planLaunch(
    baseInput({
      machine: M8,
      modelBytes: 13 * GB,
      overrides: {
        gpuLayers: 10,
        contextSize: 32768,
        kvCache: 'f16',
        flashAttn: 'on',
        mmprojOffload: true
      }
    })
  )
  assert.equal(ovAll.rung, 0)
  assert.deepEqual(ovAll.params, {
    gpuLayers: 10,
    contextSize: 32768,
    kvCache: 'f16',
    flashAttn: 'on',
    mmprojOffload: true
  })

  // 部分指定:黑板格式被钉死 f16,梯子只能砍上下文不能再降黑板
  const ovKv = planLaunch(
    baseInput({ machine: M8, modelBytes: 6 * GB, overrides: { kvCache: 'f16' } })
  )
  assert.equal(ovKv.params.kvCache, 'f16', '指定的 f16 不许被梯子改掉')
  assert.equal(ovKv.params.contextSize, 8192, '黑板动不了就往上下文降')

  // ── 9. 上下文地板:低于 8192 的不许再砍 ──
  const lowCtx = planLaunch(baseInput({ machine: M8, modelBytes: 6 * GB, requestedContext: 4096 }))
  assert.equal(lowCtx.params.contextSize, 4096, '请求 4096 不再往下砍')
  const atFloor = planLaunch(baseInput({ machine: M8, modelBytes: 6 * GB, requestedContext: 8192 }))
  assert.equal(atFloor.params.contextSize, 8192, '8192 是地板,砍不动')

  // ── 10. 重启对账钥匙:账上记用户档,不记计划降下去的档 ──
  // dense 6GB 8GB 卡计划降到 8192;若账记 8192,用户档 16384 下一轮永远对不上 → 重启死循环
  assert.equal(bookkeepingContextSize(16384), 16384)
  assert.notEqual(
    bookkeepingContextSize(16384),
    t3.params.contextSize,
    '账本键与用户档一致,不许记成计划降后的数'
  )
  assert.equal(t3.params.contextSize, 8192, '上面这个计划确实降过档')

  // ── 11. 就绪播报摘句:上下文降了 > 投影仪放内存 > 黑板降格 ──
  assert.ok(planCaveat(t3, 16384)!.includes('上下文'), '砍了上下文先说它')
  assert.ok(planCaveat(t1, 16384)!.includes('视觉文件'), '投影仪放内存报这个')
  assert.equal(planCaveat(planLaunch(baseInput({})), 16384), null, '没妥协没话说')
  const q8Only = planLaunch(baseInput({ machine: M8, modelBytes: 5 * GB, requestedContext: 8192 }))
  // 5GB 8GB 卡 ctx 8192: rung0=5+1+0.6=6.6 ok? estimateKvBytes(8192, 5GB)=8192*128K=1GB → 6.6 ≤ 7.36 → rung0
  if (q8Only.params.kvCache === 'q8_0') {
    assert.ok(planCaveat(q8Only, 8192)!.includes('黑板'))
  } else {
    assert.equal(planCaveat(q8Only, 8192), null)
  }

  // ── 12. OOM 记号检测(保险丝话术用) ──
  assert.ok(engineLogHasOom('ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory'))
  assert.ok(engineLogHasOom('llama_model_load: error: out of memory'))
  assert.ok(engineLogHasOom('ggml_cuda_host_malloc: failed to allocate 1024.00 MiB'))
  assert.ok(engineLogHasOom('CUDA error: cudaMalloc failed'))
  assert.ok(!engineLogHasOom('llama_context: n_ctx = 16384'))
  assert.ok(!engineLogHasOom('模型加载完成'))
  assert.ok(!engineLogHasOom(''))

  // ── 13. nvidia-smi 行解析与厂商名识别 ──
  const nv = parseNvidiaSmiProfile('NVIDIA GeForce RTX 5060 Ti, 16311 MiB, 15174 MiB')
  assert.equal(nv?.gpuName, 'NVIDIA GeForce RTX 5060 Ti')
  assert.equal(nv?.vramBytes, 16311 * 1024 * 1024)
  assert.equal(nv?.vramFreeBytes, 15174 * 1024 * 1024)
  // nounits 模式是真机实测的输出口径:裸数字不带 MiB(冒烟时这个格式曾把解析绊倒)
  const nvBare = parseNvidiaSmiProfile('NVIDIA GeForce RTX 5060 Ti, 16311, 15174')
  assert.equal(nvBare?.vramBytes, 16311 * 1024 * 1024, 'nounits 裸数字也认')
  assert.equal(parseNvidiaSmiProfile('garbage line'), null, '坏行不硬猜')
  assert.equal(parseNvidiaSmiProfile(''), null)
  assert.equal(vendorFromGpuName('NVIDIA GeForce RTX 5060 Ti'), 'nvidia')
  assert.equal(vendorFromGpuName('AMD Radeon RX 7800 XT'), 'amd')
  assert.equal(vendorFromGpuName('Intel Arc A750 Graphics'), 'intel')
  assert.equal(vendorFromGpuName('Intel(R) UHD Graphics 770'), 'intel')
  assert.equal(vendorFromGpuName('ASPEED Graphics Family'), 'unknown')

  // ── 14. 预算口径:有空闲显存按空闲算,没有按总量算 ──
  const freeLow = planLaunch(baseInput({ machine: gpu(16, 9), modelBytes: 8 * GB }))
  // 9GB 空闲 → 预算 8.28GB;8GB 模型 + 黑板 2GB + 缓冲 0.6 = 10.6 > 8.28 → 降档
  assert.notEqual(freeLow.rung, 0, '按空闲显存算,占了半张卡就得降档')
  const noFree = planLaunch(
    baseInput({ machine: { ...M16, vramFreeBytes: null }, modelBytes: 8 * GB })
  )
  // 问不到空闲按总量 16*0.92=14.7 算 → 装得下
  assert.equal(noFree.estimate.verdict, 'ok')

  console.log('selftest-launchplan: 全部通过')
}

main()
