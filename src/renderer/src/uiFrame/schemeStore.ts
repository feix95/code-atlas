// 「我的方案」渲染层账本:当前方案在库里的户口 + 库清单缓存 + 起步状态。
// 与 docStore 分工:docStore 管「文档内容 + 撤销栈」,这里管「这份文档是哪个方案 + 库操作」。
// 模块级单例:关页签再开不丢;落盘全部走 preload 的 uiFrameScheme* 通道(主进程写 userData)。
import { useSyncExternalStore } from 'react'
import {
  importCssVars,
  importDtcg,
  importSchemeFiles,
  type ImportResult
} from '@shared/uiFrame/importDoc'
import { parseDoc } from '@shared/uiFrame/scheme'
import { BLANK_ID, templateDoc } from '@shared/uiFrame/templates'
import type { SchemeMeta, UiFrameDoc, UiPlatform } from '@shared/uiFrame/types'
import { canvasHtml } from './canvasDoc'
import { docActions } from './docStore'

interface SchemeState {
  /** 是否已选过起步(本运行期内).false = 还在起步页 */
  started: boolean
  /** 当前文档对应的库方案 id;null = 未保存的临时方案(模板/空白刚起步) */
  schemeId: string | null
  /** 库清单;null = 还没拉过 */
  schemes: SchemeMeta[] | null
  /** 正在跑的库操作(按钮置灰用);null = 空闲 */
  busy: 'save' | 'open' | 'list' | null
  /** 最近一次库操作的人话报错;null = 无 */
  error: string | null
  /** 导入后的一句话战报(套用 N 个变量、跳过 M 个);null = 无 */
  notice: string | null
}

let state: SchemeState = {
  started: false,
  schemeId: null,
  schemes: null,
  busy: null,
  error: null,
  notice: null
}
const listeners = new Set<() => void>()

function emit(patch: Partial<SchemeState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function humanError(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `${action}失败:${detail}`
}

/** 缩略图:示例页的内联样式 HTML,主进程离屏截成 thumbnail.png */
function thumbHtml(doc: UiFrameDoc): string {
  return canvasHtml(doc, 'page')
}

async function runBusy<T>(busy: SchemeState['busy'], job: () => Promise<T>): Promise<T | null> {
  if (state.busy) return null
  emit({ busy, error: null })
  try {
    const result = await job()
    emit({ busy: null })
    return result
  } catch (error) {
    emit({ error: humanError('操作', error), busy: null })
    return null
  }
}

export const schemeActions = {
  /** 拉库清单(起步页与方案库面板共用) */
  async refresh(): Promise<void> {
    if (state.busy) return
    emit({ busy: 'list', error: null })
    try {
      emit({ schemes: await window.atlas.uiFrameSchemeList(), busy: null })
    } catch (error) {
      emit({ error: humanError('读取方案库', error), busy: null })
    }
  },
  /** 起步:模板(id ∈ TEMPLATES)或空白(BLANK_ID);platform 仅空白起步时用 */
  startFresh(templateId: string, platform: UiPlatform): void {
    docActions.replaceDoc(templateDoc(templateId, platform))
    emit({ started: true, schemeId: null, error: null })
  },
  /** 打开库里的方案 */
  async open(id: string): Promise<void> {
    await runBusy('open', async () => {
      const bundle = await window.atlas.uiFrameSchemeOpen(id)
      docActions.replaceDoc(parseDoc(bundle.design))
      emit({ started: true, schemeId: id })
    })
  },
  /** 保存当前方案:有户口覆盖存,没户口按 name 新建;成功后记快照在主进程已写 */
  async save(doc: UiFrameDoc, name?: string): Promise<string | null> {
    const result = await runBusy('save', async () => {
      const docToSave = name ? { ...doc, name } : doc
      const saved = await window.atlas.uiFrameSchemeSave({
        id: state.schemeId,
        name: docToSave.name,
        doc: docToSave,
        thumbHtml: thumbHtml(docToSave)
      })
      if (name && name !== doc.name) docActions.renameDoc(name)
      return saved.id
    })
    if (result) {
      emit({ schemeId: result })
      void schemeActions.refresh()
    }
    return result
  },
  /** 另存为:不管当前有没有户口,都新建一份 */
  async saveAs(doc: UiFrameDoc, name: string): Promise<string | null> {
    const result = await runBusy('save', async () => {
      const docToSave = { ...doc, name }
      const saved = await window.atlas.uiFrameSchemeSave({
        id: null,
        name,
        doc: docToSave,
        thumbHtml: thumbHtml(docToSave)
      })
      return saved.id
    })
    if (result) {
      docActions.renameDoc(name)
      emit({ schemeId: result })
      void schemeActions.refresh()
    }
    return result
  },
  async rename(id: string, name: string, doc: UiFrameDoc): Promise<void> {
    await runBusy(null, async () => {
      await window.atlas.uiFrameSchemeRename(id, name)
      if (state.schemeId === id && doc.name !== name) docActions.renameDoc(name)
    })
    await schemeActions.refresh()
  },
  async remove(id: string): Promise<void> {
    await runBusy(null, async () => {
      await window.atlas.uiFrameSchemeDelete(id)
      if (state.schemeId === id) emit({ schemeId: null })
    })
    await schemeActions.refresh()
  },
  /** 复制方案:读出 → 换名另存(库操作,不动当前文档) */
  async copy(id: string, name: string): Promise<void> {
    await runBusy(null, async () => {
      const bundle = await window.atlas.uiFrameSchemeOpen(id)
      await window.atlas.uiFrameSchemeSave({
        id: null,
        name,
        doc: parseDoc(bundle.design),
        thumbHtml: ''
      })
    })
    await schemeActions.refresh()
  },
  snapshots(id: string): Promise<string[]> {
    return window.atlas.uiFrameSchemeSnapshots(id)
  },
  async restore(id: string, stamp: string): Promise<void> {
    await runBusy('open', async () => {
      const design = await window.atlas.uiFrameSchemeRestore(id, stamp)
      docActions.replaceDoc(parseDoc(design))
      emit({ started: true, schemeId: id })
    })
  },
  exportScheme(id: string): Promise<unknown> {
    return window.atlas.uiFrameSchemeExport(id)
  },
  /** 回到起步页(换平台/换模板/开别的方案) */
  backToStart(): void {
    emit({ started: false })
  },
  dismissNotice(): void {
    emit({ notice: null })
  },
  /** 轻量反馈(复制到剪贴板等):借 notice 横幅展示 */
  flash(text: string): void {
    emit({ notice: text })
  },
  /**
   * 导入(§14):三种来源解析出的 doc 以「未入库」身份上画布;
   * 战报(套用/跳过计数)挂 notice 由页面横幅展示。
   */
  async importDoc(
    source: 'scheme-folder' | 'dtcg-file' | 'css-file' | 'css-text',
    pastedText?: string
  ): Promise<ImportResult | null> {
    if (state.busy) return null
    emit({ busy: 'open', error: null })
    try {
      let result: ImportResult
      if (source === 'css-text') {
        result = importCssVars(pastedText ?? '', '粘贴的变量')
      } else if (source === 'css-file') {
        const f = await window.atlas.uiFrameImportFile('css')
        if (!f) {
          emit({ busy: null })
          return null
        }
        result = importCssVars(f.text, f.name.replace(/\.css$/i, ''))
      } else if (source === 'dtcg-file') {
        const f = await window.atlas.uiFrameImportFile('json')
        if (!f) {
          emit({ busy: null })
          return null
        }
        result = importDtcg(f.text, f.name.replace(/\.json$/i, ''))
      } else {
        const folder = await window.atlas.uiFrameImportFolder()
        if (!folder) {
          emit({ busy: null })
          return null
        }
        result = importSchemeFiles(folder.manifest, folder.design, folder.name)
      }
      docActions.replaceDoc(result.doc)
      const skippedNote =
        result.skipped.length > 0 ? `;没对上的 ${result.skipped.length} 个已跳过` : ''
      emit({
        busy: null,
        started: true,
        schemeId: null,
        notice: `${result.sourceLabel}导入完成:套用了 ${result.applied} 个变量${skippedNote}。方案未入库,调完点「保存」收进我的方案。`
      })
      return result
    } catch (error) {
      emit({ error: humanError('导入', error), busy: null })
      return null
    }
  }
}

export { BLANK_ID }

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSchemeState(): SchemeState {
  return useSyncExternalStore(subscribe, () => state)
}
