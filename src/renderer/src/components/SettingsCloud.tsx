import { useState } from 'react'
import {
  CLOUD_CONTEXT_CHOICES,
  CLOUD_DEFAULT_CONTEXT,
  CLOUD_VENDORS,
  findCloudVendor,
  sanitizeCloudVendorId
} from '@shared/cloudVendors'
import type { AiCloudSettings } from '@shared/types'
import { TreeIcon } from './Icons'
import { CfgRow } from './CfgRow'
import { ModelNameRow } from './ModelNameRow.tsx'

/** 「AI 来源 = 在线 API」时的连接配置:服务商 / 服务地址 / API Key / 模型名 / 上下文窗口 */
export function SettingsCloud({
  cloud,
  onCloudChange,
  models,
  modelsBusy,
  modelsNote,
  listModels
}: {
  cloud: AiCloudSettings
  onCloudChange: (next: AiCloudSettings) => void
  models: string[]
  modelsBusy: boolean
  modelsNote: string | null
  listModels: () => Promise<void>
}): React.JSX.Element {
  const [keyVisible, setKeyVisible] = useState(false)
  const vendor = findCloudVendor(cloud.vendor)
  const patch = (p: Partial<AiCloudSettings>): void => onCloudChange({ ...cloud, ...p })

  return (
    <>
      <div className="cfg-divider" />
      <CfgRow label="服务商" hint="选择购买 API 的平台；不在列表里选「自定义」。">
        <select
          className="cfg-select"
          aria-label="服务商"
          value={cloud.vendor}
          onChange={(e) => {
            const next = sanitizeCloudVendorId(e.target.value)
            // 换服务商:地址跟着换(自定义保留当前地址供修改),模型名各家不通用,清空
            patch({
              vendor: next,
              baseUrl: findCloudVendor(next)?.baseUrl || cloud.baseUrl,
              model: ''
            })
          }}
        >
          {CLOUD_VENDORS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </CfgRow>
      <div className="cfg-divider" />
      <CfgRow label="服务地址" hint="OpenAI 兼容接口地址；选择服务商后自动填写。">
        <input
          className="cfg-input cfg-url-input"
          value={cloud.baseUrl}
          placeholder="https://…/v1"
          spellCheck={false}
          aria-label="服务地址"
          onChange={(e) => patch({ baseUrl: e.target.value })}
        />
      </CfgRow>
      <div className="cfg-divider" />
      <CfgRow label="API Key" hint="加密保存在本机，只发送给所选服务商。">
        <div className="cfg-ctlcol">
          <div className="cfg-keyrow">
            <div className="cfg-key-wrap">
              <input
                type={keyVisible ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={cloud.apiKey}
                placeholder="粘贴服务商提供的 Key"
                aria-label="API Key"
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
              <button
                type="button"
                className="cfg-eye-btn"
                aria-label={keyVisible ? '隐藏 Key' : '显示 Key'}
                aria-pressed={keyVisible}
                data-tip={keyVisible ? '隐藏' : '显示'}
                onClick={() => setKeyVisible(!keyVisible)}
              >
                <TreeIcon name={keyVisible ? 'eyeOff' : 'eye'} size={13} mono />
              </button>
            </div>
          </div>
          {vendor?.docsUrl && (
            <div className="cfg-key-foot">
              <a className="cfg-linklike" href={vendor.docsUrl} target="_blank" rel="noreferrer">
                {vendor.label} 接入文档 ↗
              </a>
            </div>
          )}
        </div>
      </CfgRow>
      <div className="cfg-divider" />
      <ModelNameRow
        value={cloud.model}
        onChange={(model) => patch({ model })}
        models={models}
        modelsBusy={modelsBusy}
        modelsNote={modelsNote}
        listModels={listModels}
      />
      <div className="cfg-divider" />
      <CfgRow label="上下文窗口" hint="越大可带的参考材料越多，每次提问消耗的 token 也越多。">
        <select
          className="cfg-select"
          aria-label="上下文窗口"
          value={cloud.contextSize}
          onChange={(e) => patch({ contextSize: Number(e.target.value) })}
        >
          {CLOUD_CONTEXT_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n / 1024}k{n === CLOUD_DEFAULT_CONTEXT ? '(默认)' : ''}
            </option>
          ))}
        </select>
      </CfgRow>
      <div className="cfg-privacy">
        <TreeIcon name="shield" size={12} mono />
        提问涉及的代码片段会发送到所选服务商，按其计费规则扣费。
      </div>
    </>
  )
}
