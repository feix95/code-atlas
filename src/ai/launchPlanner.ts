// 启动方案装配间:把「机器探头 + 文件登记 + 结构档案」三份 I/O 收齐,
// 交给 shared/launchPlan.ts 的纯算盘出方案。启动器(builtinLaunch)和设置卡(ipcLaunchPlan)共用。
import { statSync } from 'node:fs'
import { planLaunch } from '../shared/launchPlan.ts'
import type { LaunchOverrides, LaunchPlan, MachineProfile } from '../shared/launchPlan.ts'
import type { GgufShape } from '../shared/types.ts'
import { readModelShape } from './modelShape.ts'
import { queryMachineProfile } from './machineProbe.ts'

/** 出方案要用的全部原料;哪个字段拿不到就给 null,算盘自己能兜 */
export interface LaunchFacts {
  machine: MachineProfile
  modelBytes: number | null
  shape: GgufShape | null
  mmprojFile: string | null
  mmprojBytes: number | null
  isMoe: boolean
}

function statBytes(path: string | null): number | null {
  if (!path) return null
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** 收齐原料;mmprojFile 由调用方先按 findMmprojFor 配对好(降级重试那路直接给 null) */
export async function probeLaunchFacts(
  modelPath: string,
  mmprojFile: string | null
): Promise<LaunchFacts> {
  const machine = await queryMachineProfile()
  const shape = await readModelShape(modelPath)
  return {
    machine,
    modelBytes: statBytes(modelPath),
    shape,
    mmprojFile,
    mmprojBytes: statBytes(mmprojFile),
    isMoe: (shape?.expertCount ?? 0) > 1
  }
}

/** 真出方案:收原料 → 纯算盘;模型文件读不到时 modelBytes=0,算盘照常给(反正引擎会死在 spawn 那步) */
export async function buildLaunchPlan(
  modelPath: string,
  requestedContext: number,
  mmprojFile: string | null,
  overrides?: LaunchOverrides
): Promise<{ plan: LaunchPlan; facts: LaunchFacts }> {
  const facts = await probeLaunchFacts(modelPath, mmprojFile)
  const plan = planLaunch({
    machine: facts.machine,
    modelBytes: facts.modelBytes ?? 0,
    mmprojBytes: facts.mmprojBytes,
    shape: facts.shape,
    requestedContext,
    overrides
  })
  return { plan, facts }
}
