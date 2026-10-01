import { CfgRow } from './CfgRow'

/**
 * 「模型名」行(LM Studio 与在线 API 共用):读到清单就给下拉,没读到给输入框可手填;
 * 「读取模型」兼任连接测试,结果/报错挂在下方小字。
 */
export function ModelNameRow({
  value,
  onChange,
  models,
  modelsBusy,
  modelsNote,
  listModels
}: {
  value: string
  onChange: (model: string) => void
  models: string[]
  modelsBusy: boolean
  modelsNote: string | null
  listModels: () => Promise<void>
}): React.JSX.Element {
  return (
    <CfgRow label="模型名" hint="从服务读取的模型列表中选择，也可手动填写。">
      <div className="cfg-ctlcol">
        <div className="cfg-file">
          {models.length > 0 ? (
            <select
              className="cfg-select"
              aria-label="模型名"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {!models.includes(value) && <option value={value} hidden />}
            </select>
          ) : (
            <input
              className="cfg-input"
              value={value}
              placeholder="点「读取模型」自动填充"
              spellCheck={false}
              aria-label="模型名"
              onChange={(e) => onChange(e.target.value)}
            />
          )}
          <button
            type="button"
            className="cfg-btn"
            onClick={() => void listModels()}
            disabled={modelsBusy}
          >
            {modelsBusy ? '连接中……' : '读取模型'}
          </button>
        </div>
        {modelsNote && <p className="cfg-note is-warn">{modelsNote}</p>}
      </div>
    </CfgRow>
  )
}
