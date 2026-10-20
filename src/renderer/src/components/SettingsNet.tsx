import type { AiConfig } from '@shared/types'
import { CfgQ, CfgRow } from './CfgRow'
import { TavilyKeyField } from './TavilyKeyField.tsx'

/** 「联网与隐私」页:联网搜索开关 / Tavily Key;数据范围说明收进标题旁的悬停(渐进披露) */
export function SettingsNet({
  config,
  onConfigChange
}: {
  config: AiConfig | null
  onConfigChange: (next: AiConfig) => void
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
            <CfgRow
              label={
                <>
                  联网搜索
                  <CfgQ
                    tip={
                      '仅发送检索词；关闭后完全离线。\n查询链：Tavily → DuckDuckGo → 中文维基百科 → 英文维基百科；单次 5 秒超时，未命中回退本地推测。'
                    }
                  />
                </>
              }
              hint="查询公开资料修正回答；仅发送搜索词。"
            >
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
            {/* Tavily 搜索 Key(可选,2026-09-17 产品裁定):填了源队列 Tavily 打头,不填走免费链。
                眼睛、体检、黄字提醒都住在 TavilyKeyField 里 */}
            <TavilyKeyField
              value={config.tavilyKey ?? ''}
              onChange={(v) => onConfigChange({ ...config, tavilyKey: v })}
            />
          </>
        )}
      </div>
    </div>
  )
}
