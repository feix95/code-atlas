import type { ContextBill } from '@shared/contextBill'
import type { PersonalizationConfig } from '@shared/personalization'
import type { AiConfig, ModelFitVerdict } from '@shared/types'
import { SettingsModel } from './SettingsModel.tsx'
import { SettingsVoice } from './SettingsVoice.tsx'

/**
 * 「AI 设置」页(一导航一页):页内两个模块两张灰卡 ——
 * 「模型」管加载方式与连接配置,「回复风格」管说话的口气。
 */
export function SettingsAi({
  config,
  onConfigChange,
  isBuiltin,
  pickModel,
  shelfOpen,
  setShelfOpen,
  onShelfModelReady,
  modelPath,
  fitNote,
  models,
  modelsBusy,
  modelsNote,
  listModels,
  contextRaw,
  setContextRaw,
  onContextBlur,
  contextNotches,
  commitContextValue,
  ctxBill,
  personal,
  updatePersonal,
  chatSuggestionsOn,
  onChatSuggestionsChange
}: {
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
  isBuiltin: boolean
  pickModel: () => Promise<void>
  shelfOpen: boolean
  setShelfOpen: React.Dispatch<React.SetStateAction<boolean>>
  onShelfModelReady: () => void
  modelPath: string
  fitNote: ModelFitVerdict | null
  models: string[]
  modelsBusy: boolean
  modelsNote: string | null
  listModels: () => Promise<void>
  contextRaw: string
  setContextRaw: React.Dispatch<React.SetStateAction<string>>
  onContextBlur: () => void
  contextNotches: number[]
  commitContextValue: (v: number) => void
  ctxBill: ContextBill | null
  personal: PersonalizationConfig
  updatePersonal: (patch: Partial<PersonalizationConfig>) => void
  chatSuggestionsOn: boolean
  onChatSuggestionsChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className="cfg-pane">
      <h3 className="cfg-subhead">模型</h3>
      <div className="cfg-panel">
        <SettingsModel
          config={config}
          onConfigChange={onConfigChange}
          isBuiltin={isBuiltin}
          pickModel={pickModel}
          shelfOpen={shelfOpen}
          setShelfOpen={setShelfOpen}
          onShelfModelReady={onShelfModelReady}
          modelPath={modelPath}
          fitNote={fitNote}
          models={models}
          modelsBusy={modelsBusy}
          modelsNote={modelsNote}
          listModels={listModels}
          contextRaw={contextRaw}
          setContextRaw={setContextRaw}
          onContextBlur={onContextBlur}
          contextNotches={contextNotches}
          commitContextValue={commitContextValue}
          ctxBill={ctxBill}
        />
      </div>
      <h3 className="cfg-subhead">回复风格</h3>
      <div className="cfg-panel">
        <SettingsVoice
          config={config}
          personal={personal}
          updatePersonal={updatePersonal}
          chatSuggestionsOn={chatSuggestionsOn}
          onChatSuggestionsChange={onChatSuggestionsChange}
        />
      </div>
    </div>
  )
}
