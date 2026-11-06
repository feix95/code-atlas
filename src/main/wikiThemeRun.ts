// 主题目录的模型入口:生成前确保缓存,以及「只规划目录」不写正文。
import { basename } from 'node:path'
import { ipcMain } from 'electron'
import { explainWithMessages } from '../ai/explain.ts'
import type { ChatTarget } from '../shared/types.ts'
import { CH } from '../shared/ipcChannels.ts'
import { translateLang } from '../shared/translateLangs.ts'
import type { WikiEvent, WikiPlanCatalogResult } from '../shared/wikiTypes.ts'
import { buildWikiPlan } from '../wiki/wikiPlan.ts'
import { assembleWikiPlanInput } from '../wiki/wikiPlanInput.ts'
import { ensureWikiCatalog, type ThemeComplete } from '../wiki/wikiThemeModel.ts'
import { loadWikiSettings } from '../wiki/wikiSettings.ts'
import { ensureWikiRootMarker, resolveWikiLocation } from '../wiki/wikiLocation.ts'
import { resolveProjectDir } from '../wiki/wikiProjectDir.ts'
import { userDataDir } from './paths.ts'
import { parseProjectRoot } from './wikiRequest.ts'
import { wikiPlanSourceDeps } from './wikiPlanSource.ts'
import { resolveChatTargetOrError } from './aiEvidence.ts'

export function catalogCompleter(target: ChatTarget, signal?: AbortSignal): ThemeComplete {
  return async (system, user, schema) => {
    const result = await explainWithMessages(
      target,
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      undefined,
      signal,
      2000,
      {
        temperature: 0,
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'wiki_catalog', strict: true, schema }
        }
      }
    )
    return result.status === 'supported' ? result.text : null
  }
}

export function registerWikiCatalogIpc(): void {
  ipcMain.handle(
    CH.wikiPlanCatalog,
    async (event, raw: unknown): Promise<WikiPlanCatalogResult> => {
      if (typeof raw !== 'object' || raw === null) return { ok: false, error: '请求不完整' }
      const record = raw as Record<string, unknown>
      const projectRoot = parseProjectRoot(record.projectRoot)
      const language = typeof record.language === 'string' ? record.language : ''
      if (projectRoot === null || translateLang(language) === null)
        return { ok: false, error: '请求不完整' }
      const location = loadWikiSettings(userDataDir()).location
      if (location === null) return { ok: false, error: '还没选 Wiki 存放位置' }
      const resolved = await resolveWikiLocation({ chosen: location, projectRoots: [projectRoot] })
      if (!resolved.ok) return { ok: false, error: resolved.reason }
      await ensureWikiRootMarker(resolved.location)
      const projectDir = await resolveProjectDir(resolved.location, projectRoot)
      const chat = await resolveChatTargetOrError()
      const planInput = await assembleWikiPlanInput(
        projectRoot,
        basename(projectRoot),
        wikiPlanSourceDeps(projectRoot)
      )
      let calls = 0
      const send = (done: number, total: number): void => {
        calls = done
        if (event.sender.isDestroyed()) return
        const payload: WikiEvent = {
          type: 'progress',
          source: 'v2',
          projectRoot,
          language,
          total,
          processed: done,
          page: {
            pageId: 'wiki-catalog',
            kind: 'overview',
            name: `规划目录 ${done}/${total}`,
            status: 'running'
          }
        }
        event.sender.send(CH.wikiEvent, payload)
      }
      const catalog =
        'error' in chat
          ? null
          : await ensureWikiCatalog({
              projectDir,
              input: planInput,
              model: chat.target.model,
              force: record.force === true,
              complete: catalogCompleter(chat.target),
              onProgress: send
            }).catch(() => null)
      const plan = buildWikiPlan(planInput, catalog)
      return {
        ok: true,
        leaves: plan.stats.leafPages,
        overviews: plan.stats.overviewPages,
        chapters: plan.topics.map((topic) => topic.title),
        cached: calls === 0,
        modelCalls: calls
      }
    }
  )
}
