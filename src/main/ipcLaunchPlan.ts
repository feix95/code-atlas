// 「本机运行方案」通道:给设置卡端齐一份只读报单 ——
// 机器规格 + 当前内置模型的启动方案 + 已存高级账 + 自动档对照参数。
// draft 参数 = 界面上还没存盘的草稿,按草稿出预览方案(不动存档)。纯查询,不启动引擎。
import { ipcMain } from 'electron'
import { CH } from '../shared/ipcChannels.ts'
import { DEFAULT_CONTEXT_SIZE } from '../shared/aiDefaults.ts'
import type { LaunchPlanInfo } from '../shared/launchPlan.ts'
import { planLaunch } from '../shared/launchPlan.ts'
import { launchFor, parseExtraArgs, sanitizeModelLaunchSettings } from '../shared/launchSettings.ts'
import { loadAiConfig } from '../ai/config.ts'
import { builtinIdleFacts } from '../ai/builtin.ts'
import { engineVersionFor, locateEngine } from '../ai/engineLocator.ts'
import { probeLaunchFacts } from '../ai/launchPlanner.ts'
import { findMmprojFor } from '../ai/mmproj.ts'
import { queryMachineProfile } from '../ai/machineProbe.ts'
import { userDataDir } from './paths.ts'

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/**
 * 只读报单:当前配置的内置模型 + 机器规格 + 启动方案。
 * 没配模型回 plan:null;模型文件失踪也一样(plan 算不出有意义的账)。
 * draft 传了按草稿算(预览),没传按已存账算。
 */
async function launchPlanInfo(draft: unknown): Promise<LaunchPlanInfo> {
  const dir = userDataDir()
  const config = await loadAiConfig(dir)
  const modelPath = config.builtin.modelPath.trim()
  const mmprojFile = modelPath ? findMmprojFor(modelPath) : null
  // 机器规格随模型原料一起拿:一次 nvidia-smi 够用,别为同一轮报单上下各探一遍;
  // 卡片会定期重取,省下的这趟探测按周期累计
  const facts = modelPath ? await probeLaunchFacts(modelPath, mmprojFile) : null
  const machine = facts?.machine ?? (await queryMachineProfile())
  // 当前引擎登记:定位 + --version;查不到就给 null,不挡方案报单
  const engine = await locateEngine(config.builtin, dir).catch(() => null)
  const engineVersion = engine?.exePath ? await engineVersionFor(engine.exePath) : null
  const activeEngine = engine
    ? {
        kind: engine.kind,
        backend: engine.backend,
        label: engine.label,
        version: engineVersion
      }
    : null
  const empty: LaunchPlanInfo = {
    machine,
    modelName: null,
    modelBytes: null,
    isMoe: false,
    mmprojFile: null,
    plan: null,
    autoParams: null,
    saved: null,
    extraArgs: null,
    activeEngine
  }
  if (!modelPath || !facts) return empty

  if (facts.modelBytes == null) {
    // 文件失踪:报上名字(按路径的档案名),方案算不出
    return { ...empty, modelName: builtinIdleFacts(modelPath).modelName, mmprojFile }
  }
  const requestedContext = config.contextSize ?? DEFAULT_CONTEXT_SIZE
  const saved = launchFor(config.builtin, modelPath)
  // 草稿传了(含 null)按草稿预览;没传字段按已存账
  const draftSettings = draft === undefined ? undefined : sanitizeModelLaunchSettings(draft)
  const effective = draft === undefined ? saved : draftSettings
  const base = {
    machine: facts.machine,
    modelBytes: facts.modelBytes,
    mmprojBytes: facts.mmprojBytes,
    shape: facts.shape,
    requestedContext
  }
  const autoPlan = planLaunch({ ...base, overrides: undefined })
  const plan = planLaunch({ ...base, overrides: effective?.overrides })
  const extra = parseExtraArgs(effective?.extraArgs ?? '')
  return {
    machine: facts.machine,
    modelName: builtinIdleFacts(modelPath).modelName ?? basename(modelPath),
    modelBytes: facts.modelBytes,
    isMoe: facts.isMoe,
    mmprojFile: facts.mmprojFile,
    plan,
    autoParams: autoPlan.params,
    saved,
    extraArgs: extra.ok && extra.args.length > 0 ? extra.args : null,
    activeEngine
  }
}

export function registerLaunchPlanIpc(): void {
  ipcMain.handle(CH.aiLaunchPlan, (_event, draft?: unknown) =>
    launchPlanInfo(draft).catch(() => null)
  )
}
