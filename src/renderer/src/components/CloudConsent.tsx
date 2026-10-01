import { TreeIcon } from './Icons'

/** 首次切到「在线 API」的隐私确认:说清数据去向与计费,确认后才写入配置 */
export function CloudConsent({
  onAccept,
  onCancel
}: {
  onAccept: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="cfg-consent" role="alertdialog" aria-label="使用在线 API 前确认">
      <p className="cfg-consent-title">
        <TreeIcon name="shield" size={12} mono />
        使用在线 API 前请确认
      </p>
      <ul className="cfg-consent-list">
        <li>提问时，相关代码片段和项目结构会发送到你选择的服务商。</li>
        <li>服务商按 token 计费，费用从你的账户扣除。</li>
        <li>API Key 加密保存在本机。</li>
      </ul>
      <div className="cfg-consent-actions">
        <button type="button" className="cfg-btn is-ghost" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="cfg-btn" onClick={onAccept} autoFocus>
          我已了解，继续
        </button>
      </div>
    </div>
  )
}
