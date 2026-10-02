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
import { defaultDeviceId } from '@shared/uiFrame/devices'
import type { QuizPrefill } from '@shared/quiz/prefill'
import type {
  ProvenanceCheckItem,
  ProvenanceClaim,
  ProvenanceVerdict,
  SchemeMeta,
  UiFrameDoc,
  UiPlatform
} from '@shared/uiFrame/types'
import { literalCss, resolveValue } from '@shared/uiFrame/resolve'
import { canvasHtml } from './canvasDoc'
import { currentDoc, docActions } from './docStore'
import { workbenchActions } from './workbenchStore'

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
  /** 本次导入带出的出处声明(§14);空表 = 没出处可核 */
  claims: ProvenanceClaim[]
  /** 出处核对结果;null = 还没核对 */
  verify: ProvenanceVerdict[] | null
}

let state: SchemeState = {
  started: false,
  schemeId: null,
  schemes: null,
  busy: null,
  error: null,
  notice: null,
  claims: [],
  verify: null
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
  return canvasHtml(doc, 'bench')
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
    workbenchActions.docReplaced()
    emit({ started: true, schemeId: null, error: null })
  },
  /** 问卷预填起步(§2 入口 A → 第二步):模板/平台/密度/主色/加强档按答案铺好;
   *  模板与问卷平台不一致时以问卷平台为准(风格变量照样套) */
  startFromQuiz(
    prefill: QuizPrefill,
    opts: { productName?: string; techStack?: string } = {}
  ): void {
    const doc = templateDoc(prefill.templateId ?? BLANK_ID, prefill.platform)
    if (doc.platform !== prefill.platform) {
      doc.platform = prefill.platform
      doc.device = defaultDeviceId(prefill.platform)
    }
    for (const [name, value] of Object.entries(prefill.overrides)) {
      const def = doc.tokens[name]
      if (def) doc.tokens[name] = { ...def, value }
    }
    if (opts.productName?.trim()) doc.name = opts.productName.trim()
    if (prefill.a11yEnhanced) doc.a11yEnhanced = true
    if (opts.techStack?.trim()) doc.targetStack = opts.techStack.trim()
    docActions.replaceDoc(doc)
    workbenchActions.docReplaced()
    emit({ started: true, schemeId: null, error: null })
  },
  /** 打开库里的方案 */
  async open(id: string): Promise<void> {
    await runBusy('open', async () => {
      const bundle = await window.atlas.uiFrameSchemeOpen(id)
      docActions.replaceDoc(parseDoc(bundle.design))
      workbenchActions.docReplaced()
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
      workbenchActions.docReplaced()
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
    source: 'scheme-folder' | 'uiframe-file' | 'dtcg-file' | 'css-file' | 'css-text',
    pastedText?: string
  ): Promise<ImportResult | null> {
    if (state.busy) return null
    emit({ busy: 'open', error: null })
    try {
      let result: ImportResult
      if (source === 'uiframe-file') {
        const f = await window.atlas.uiFrameImportUiframe()
        if (!f) {
          emit({ busy: null })
          return null
        }
        result = importSchemeFiles(f.manifest, f.design, f.name)
        // 自定义图标兜底:design.json 没收录时,从 zip 的 assets/icons/custom-*.svg 回补
        for (const [file, svg] of Object.entries(f.icons ?? {})) {
          const m = /^custom-([\w一-龥.-]{1,40})\.svg$/.exec(file)
          if (m && !result.doc.customIcons[m[1]!]) result.doc.customIcons[m[1]!] = svg
        }
      } else if (source === 'css-text') {
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
      workbenchActions.docReplaced()
      const skippedNote =
        result.skipped.length > 0 ? `;没对上的 ${result.skipped.length} 个已跳过` : ''
      const claimsNote =
        result.claims.length > 0 ? `;带了 ${result.claims.length} 条出处,可在导入面板核对` : ''
      emit({
        busy: null,
        started: true,
        schemeId: null,
        claims: result.claims,
        verify: null,
        notice: `${result.sourceLabel}导入完成:套用了 ${result.applied} 个变量${skippedNote}${claimsNote}。方案未入库,调完点「保存」收进我的方案。`
      })
      return result
    } catch (error) {
      emit({ error: humanError('导入', error), busy: null })
      return null
    }
  },
  /** §14 防编造:把本次导入带的出处送主进程,只读逐项比对所选项目文件夹 */
  async verifyClaims(): Promise<void> {
    const doc = currentDoc()
    const items: ProvenanceCheckItem[] = state.claims.map((cl) => {
      const def = doc.tokens[cl.name]
      const v = def
        ? def.value.kind === 'ref'
          ? resolveValue(doc.tokens, cl.name)
          : def.value
        : null
      const expect = cl.value ?? (v ? literalCss(v, 'light', doc.rootFontPx) : '')
      return { name: cl.name, file: cl.file, line: cl.line, expect }
    })
    emit({ busy: 'open', error: null })
    try {
      const verdicts = await window.atlas.uiFrameVerify(items)
      if (verdicts === null) {
        emit({ busy: null })
        return
      }
      const ok = verdicts.filter((v) => v.status === 'matched').length
      const off = verdicts.filter((v) => v.status === 'line-off').length
      const bad = verdicts.filter((v) => v.status === 'mismatch' || v.status === 'nofile').length
      emit({
        busy: null,
        verify: verdicts,
        notice: `出处核对:${ok} 项已核对,${off} 项行号对偏,${bad} 项对不上。`
      })
    } catch (error) {
      emit({ error: humanError('核对出处', error), busy: null })
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
