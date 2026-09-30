import type { AiConfig } from '@shared/types'
import { TreeIcon } from './Icons'
import { CfgRow } from './CfgRow'
import { TavilyKeyField } from './TavilyKeyField.tsx'

/** 「联网与隐私」页:联网搜索开关 / Tavily Key / 数据范围渐进披露(纯展示,状态在 SettingsPage) */
export function SettingsNet({
  config,
  onConfigChange,
  privacyOpen,
  setPrivacyOpen
}: {
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
  privacyOpen: boolean
  setPrivacyOpen: React.Dispatch<React.SetStateAction<boolean>>
}): React.JSX.Element {
  return (
    <div className="cfg-pane">
      <div className="cfg-panel">
        {!config ? (
          <CfgRow label="联网搜索" hint="读取配置中……">
            <span />
          </CfgRow>
        ) : (
          <>
            <CfgRow label="联网搜索" hint="查询公开资料修正回答；仅发送搜索词。">
              <button
                type="button"
                role="switch"
                aria-checked={config.webLookup}
                aria-label="联网搜索"
                className={`cfg-switch${config.webLookup ? ' is-on' : ''}`}
                onClick={() => onConfigChange({ ...config, webLookup: !config.webLookup })}
              >
                <span />
              </button>
            </CfgRow>
            <div className="cfg-divider" />
            {/* Tavily 搜索 Key(可选,2026-09-17 小葵拍板):填了源队列 Tavily 打头,不填走免费链。
                眼睛、体检、黄字提醒都住在 TavilyKeyField 里 */}
            <TavilyKeyField
              value={config.tavilyKey ?? ''}
              onChange={(v) => onConfigChange({ ...config, tavilyKey: v })}
            />
            {/* 隐私条(Obsidian 式):不染色纯文字行,「数据范围」文字链开查询链详情 */}
            <div className="cfg-privacy">
              <TreeIcon name="shield" size={12} mono />
              仅发送检索词；关闭后完全离线。
              <button
                type="button"
                className="cfg-linklike"
                onClick={() => setPrivacyOpen(!privacyOpen)}
              >
                {privacyOpen ? '收起' : '数据范围'}
              </button>
            </div>
            {privacyOpen && (
              <div className="cfg-privacy-more">
                查询链：Tavily → DuckDuckGo → 中文维基百科 → 英文维基百科；单次 5
                秒超时，未命中回退本地推测。
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
