import { userDataDir } from './paths.ts'
import { broadcastModelStatus, probeLmStudioStatus, refreshModelStatus } from './modelStatus.ts'
import { electronGetJson } from './aiEvidence.ts'
import { ipcMain, BrowserWindow, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { DEFAULT_CONTEXT_SIZE } from '../ai/index.ts'
import { probeTavilyKey } from '../ai/weblookup.ts'
import { loadAiConfig, saveAiConfig } from '../ai/config.ts'
import { fetchModelShelf, fetchRepoFiles } from '../ai/modelShelf.ts'
import { cancelModelDownload, pointConfigAtModel, startModelDownload } from '../ai/modelDownload.ts'
import {
  builtinContextDiffers,
  builtinNeedsRestart,
  builtinIdleStatus,
  ensureBuiltinServer,
  isBuiltinRunning,
  judgeModelFit,
  lastBuiltinStatus,
  queryMachineSpec,
  readModelShape,
  stopBuiltinServer
} from '../ai/builtin.ts'
import { sanitizePersonalization } from '../shared/personalization.ts'
import { addDevLog } from '../shared/devlog.ts'
import { pickPathDialog } from './atlasWindow.ts'
import { CONTEXT_SIZE_MIN, PROBE_MODELS_MS } from '../shared/aiDefaults.ts'
import { CH } from '../shared/ipcChannels.ts'
import { fetchWithTimeout } from '../ai/http.ts'
import { loadAppearanceFileSync, saveAppearanceFile } from './appearanceStore.ts'
import { sanitizeAppearance } from '../shared/appearancePrefs.ts'
import { sanitizeTavilyKey } from '../shared/tavily.ts'
import type { AiConfig, ModelContextInfo, ModelFitVerdict, ModelStatus } from '../shared/types.ts'

export function registerModelIpc(): void {
  // 外观偏好:读 / 存(2026-09-16 起从 localStorage 搬进 appearance.json —— 那份按
  // localhost 端口分仓、端口一挤就出厂设置的存档方式退役)。同步读通道是给 preload
  // 首帧用的:页面脚本跑之前就得定外观,不然先按默认画一帧再换皮,界面会闪。
  ipcMain.on(CH.appearanceGetSync, (event) => {
    event.returnValue = loadAppearanceFileSync(userDataDir())
  })
  ipcMain.handle(CH.appearanceSave, (_event, raw: unknown) => {
    const a = sanitizeAppearance(raw)
    return saveAppearanceFile(userDataDir(), a)
  })

  // 模型货架:实时榜(只读抱抱脸公开 API,零落盘)+ 某仓库的文件清单。拉货手在 ai/modelShelf
  ipcMain.handle(CH.modelShelf, () => fetchModelShelf())
  ipcMain.handle(CH.modelFiles, (_event, repoId: unknown) => {
    if (typeof repoId !== 'string' || repoId === '') throw new Error('参数不合法')
    return fetchRepoFiles(repoId)
  })

  // 模型下载(一键到位):货架点文件 → 断点续传拉到 userData/models → 自动填进 AI 配置。
  // 下载是长活,进度走事件推送;窗口可能还没建好/已关,win 取当下最新的主窗,拿不到就静默下
  ipcMain.handle(CH.modelDownloadStart, async (_event, args: unknown) => {
    if (typeof args !== 'object' || args === null) throw new Error('参数不合法')
    const { repoId, filePath } = args as Record<string, unknown>
    if (typeof repoId !== 'string' || typeof filePath !== 'string') throw new Error('参数不合法')
    const win = BrowserWindow.getAllWindows()[0] ?? null
    const finalPath = await startModelDownload({
      win,
      userDataDir: userDataDir(),
      repoId,
      filePath
    })
    await pointConfigAtModel(userDataDir(), finalPath)
    return finalPath
  })
  ipcMain.handle(CH.modelDownloadCancel, () => cancelModelDownload())

  // AI 配置:读 / 存(双 Provider:lmstudio 与 builtin 两个分支都收)
  ipcMain.handle(CH.aiConfigGet, () => loadAiConfig(userDataDir()))
  ipcMain.handle(CH.aiConfigSave, async (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) throw new Error('配置不合法')
    const c = config as Partial<AiConfig>
    const lm = c.lmstudio
    const bi = c.builtin
    if (
      !lm ||
      typeof lm.baseUrl !== 'string' ||
      typeof lm.model !== 'string' ||
      !bi ||
      typeof bi.serverPath !== 'string' ||
      typeof bi.modelPath !== 'string'
    ) {
      throw new Error('配置不合法:缺 lmstudio / builtin 设置')
    }
    const previous = await loadAiConfig(userDataDir())
    const saved = await saveAiConfig(userDataDir(), {
      provider: c.provider === 'builtin' ? 'builtin' : 'lmstudio',
      lmstudio: { baseUrl: lm.baseUrl, model: lm.model, apiKey: lm.apiKey ?? '' },
      builtin: { serverPath: bi.serverPath, modelPath: bi.modelPath },
      webLookup: c.webLookup === true,
      // Tavily Key(可选,2026-09-17):设置页填了才进档;saveAiConfig 里会洗(trim,空白当没填)
      tavilyKey: typeof c.tavilyKey === 'string' ? c.tavilyKey : undefined,
      // 个性化(第一百一十三锤)也得跟着进档:上一版在这一步被弄丢,设置完下次打开就打回原形
      personalization: sanitizePersonalization(c.personalization),
      // 手动上下文(留空 = 自动探测):上一版在这一步被弄丢,设置页填了也白填
      contextSize:
        typeof c.contextSize === 'number' && c.contextSize >= CONTEXT_SIZE_MIN
          ? c.contextSize
          : undefined
    })
    // 垃圾不白占:切走了内置模式,或换了模型/引擎设置,旧子进程就地解散,
    // 下次用到 AI 时按新配置重新拉起 —— 不然讲着旧模型的旧账
    if (previous.provider === 'builtin' && saved.provider !== 'builtin' && isBuiltinRunning()) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    if (
      saved.provider === 'builtin' &&
      (builtinNeedsRestart(saved.builtin) ||
        builtinContextDiffers(saved.contextSize ?? DEFAULT_CONTEXT_SIZE))
    ) {
      stopBuiltinServer()
      broadcastModelStatus(builtinIdleStatus(saved.builtin.modelPath))
    }
    // 换了 provider 或模型,状态栏立刻照新配置报话,不等下一轮轮询
    void refreshModelStatus().catch(() => {})
    return saved
  })

  // ── 模型状态栏(第七十锤):界面随时来问当前状态;按「取消/卸下」就地解散引擎 ──
  ipcMain.handle(CH.modelStatusGet, async (): Promise<ModelStatus> => {
    const config = await loadAiConfig(userDataDir())
    if (config.provider === 'builtin') {
      // 引擎播报员有最新账就照账说;还没开播报过就拿配置兜底(上次用的模型 + 文件大小)
      return lastBuiltinStatus() ?? builtinIdleStatus(config.builtin.modelPath)
    }
    return probeLmStudioStatus(config)
  })
  ipcMain.handle(CH.modelEject, async (): Promise<{ ok: boolean; message?: string }> => {
    const config = await loadAiConfig(userDataDir())
    if (config.provider !== 'builtin') {
      return { ok: false, message: '外接模型的装卸归 LM Studio 管,这边只看状态' }
    }
    const wasRunning = isBuiltinRunning()
    stopBuiltinServer()
    broadcastModelStatus(builtinIdleStatus(config.builtin.modelPath))
    return {
      ok: true,
      message: wasRunning ? '模型卸下了,内存腾出来了;下次提问会重新热身' : '模型本来就没在跑'
    }
  })
  // 「装载」= 主动叫醒内置引擎:和首次提问走的是同一条单飞闸门(连点不双生),
  // 热身进度照旧走状态播报;外接模型的装载归 LM Studio 管
  ipcMain.handle(CH.modelLoad, async (): Promise<{ ok: boolean; message?: string }> => {
    const config = await loadAiConfig(userDataDir())
    if (config.provider !== 'builtin') {
      return { ok: false, message: '外接模型的装载归 LM Studio 管,这边只看状态' }
    }
    try {
      await ensureBuiltinServer(config.builtin, config.contextSize, config.contextSize ?? null)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  // 量尺(第七十三锤):选模型那一刻就拿块头比机器尺寸,带不动当场说,不让用户白等
  ipcMain.handle(CH.modelFitCheck, async (_event, modelPath: unknown): Promise<ModelFitVerdict> => {
    if (typeof modelPath !== 'string' || !modelPath.trim()) {
      return { level: 'empty', title: '', detail: '', sizeBytes: null }
    }
    const sizeBytes = await fs
      .stat(modelPath.trim())
      .then((s) => s.size)
      .catch(() => null)
    if (sizeBytes === null) {
      return {
        level: 'missing',
        title: '文件不存在',
        detail: '这个路径找不到文件:检查一下盘符和文件名',
        sizeBytes: null
      }
    }
    const spec = await queryMachineSpec()
    // 上下文缓存跟着配置走(第八十六锤):手动填了按手动的,没填按默认窗口(DEFAULT_CONTEXT_SIZE)
    const config = await loadAiConfig(userDataDir())
    const ctx =
      typeof config.contextSize === 'number' && config.contextSize >= CONTEXT_SIZE_MIN
        ? config.contextSize
        : DEFAULT_CONTEXT_SIZE
    return { ...judgeModelFit(sizeBytes, spec.ramBytes, spec.vramBytes, ctx), sizeBytes }
  })

  // 模型档案(上下文档位的账本):出厂上下文上限、层数头数、机器家底,一次端给设置页;
  // 档案翻不出来各条目就是 null,设置页自己退到粗估,不报错不拦人
  ipcMain.handle(
    CH.modelContextInfo,
    async (_event, modelPath: unknown): Promise<ModelContextInfo | null> => {
      if (typeof modelPath !== 'string' || !modelPath.trim()) return null
      const p = modelPath.trim()
      const sizeBytes = await fs
        .stat(p)
        .then((s) => s.size)
        .catch(() => null)
      const shape = await readModelShape(p)
      if (sizeBytes === null && shape === null) return null
      const spec = await queryMachineSpec()
      return {
        sizeBytes,
        nativeContext: shape?.contextLength ?? null,
        shape,
        ramBytes: spec.ramBytes,
        vramBytes: spec.vramBytes
      }
    }
  )

  // 渲染层的报错小纸条:window.onerror / unhandledrejection 抓到的都送进后台账本 ——
  // 渲染层就算当场断气,主进程的账本还活着,下回排查有现场可看
  ipcMain.on(CH.rendererError, (_event, text: unknown) => {
    if (typeof text === 'string' && text.trim()) {
      console.log(`[renderer] 页面报错:${text.slice(0, 300)}`)
      addDevLog('system', `页面报错:${text.slice(0, 500)}`)
    }
  })

  // 「AI 设置」选模型文件:引擎已内置,用户只需要挑一个 GGUF 模型(弹窗认准来叫它的窗,同上)
  ipcMain.handle(CH.aiPickFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'GGUF 模型', extensions: ['gguf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    return pickPathDialog(win, options)
  })

  // 连接测试 + 列出本地模型:叫 LM Studio 报告它加载了哪些模型
  ipcMain.handle(CH.aiListModels, async (_event, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('地址不能为空')
    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    // 没应答就当没通(耐心档位在 shared/aiDefaults 的 PROBE_MODELS_MS):卡死时别让界面跟着无限转圈
    const res = await fetchWithTimeout(url, PROBE_MODELS_MS).catch(() => null)
    if (!res || !res.ok) {
      throw new Error(`连不上模型服务,检查 LM Studio 是否已启动(${baseUrl})`)
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  })

  // Tavily Key 体检(2026-09-17):设置里点「测一下」→ 拿框里那把 Key 查一次官方用量。
  // 打 /usage 不花搜索额度,Key 有效还能白带回本月剩余次数;只回结论,绝不回显 Key 本身
  // (报错信息里也不留);结果只在内存里给界面看,不落盘。
  ipcMain.handle(CH.aiTestTavily, (_event, key: unknown) => {
    const cleaned = sanitizeTavilyKey(key)
    if (!cleaned) throw new Error('Key 还是空的,先填一个再测。')
    return probeTavilyKey(cleaned, electronGetJson)
  })
}
