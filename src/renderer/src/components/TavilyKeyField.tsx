import { useState } from 'react'
import { looksLikeTavilyKey, tavilyUsageText, type TavilyProbeResult } from '@shared/tavily'
import { friendlyErr } from '../errText'
import { TreeIcon } from './Icons'

/** 「测一下」的结论文案(2026-09-17):Tavily 给的状态码翻成人话,别让用户对着码猜。
 *  结论是「能用」时随身报本月用量(2026-09-17 小葵提议:/usage 零成本捎带的) */
function probeText(result: TavilyProbeResult): { cls: string; text: string } {
  switch (result.verdict) {
    case 'ok':
      return {
        cls: 'is-ok',
        text: result.usage
          ? `这个 Key 能用 · ${tavilyUsageText(result.usage)}。联网搜索会走 Tavily 打头。`
          : '这个 Key 能用,联网搜索会走 Tavily 打头。'
      }
    case 'bad-key':
      return { cls: 'is-bad', text: 'Tavily 不认这个 Key:可能抄漏了一段,也可能这个 Key 被删了。' }
    case 'quota':
      return {
        cls: 'is-warn',
        text: 'Key 是对的,但这个月的搜索额度用完了(免费档每月 1000 次,下个月自动回血)。'
      }
    case 'busy':
      return { cls: 'is-warn', text: 'Tavily 说请求太频繁,过一会儿再测。' }
    case 'server':
      return {
        cls: 'is-warn',
        text: `Tavily 那边自己出状况了(状态码 ${result.status ?? '?'}),等会儿再试。`
      }
    case 'unreachable':
      return { cls: 'is-bad', text: '连不上 Tavily:检查网络或代理 —— 这不一定是 Key 的问题。' }
    default:
      return {
        cls: 'is-warn',
        text: `没测出结论(状态码 ${result.status ?? '?'}):回应看不懂,可能网络被中间拦了。`
      }
  }
}

/**
 * Tavily Key 输入块(2026-09-17):可选的搜索加速 Key —— 小眼睛看明文、「测一下」真打官方接口验货、
 * 形状不像 tvly- 开头给黄字提醒但**不拦**(将来 Tavily 改格式或用户走中转,硬拦会把人挡门外)。
 * 自成一小块:眼睛和体检结果都是它自己的事,不占大弹窗的状态位;结论随身带着被测的那把 Key,
 * 框里字一改旧结论自动作废,不用手动清。
 */
export function TavilyKeyField({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [probe, setProbe] = useState<{
    key: string
    result: TavilyProbeResult | null
    busy: boolean
    err: string | null
  }>({
    key: '',
    result: null,
    busy: false,
    err: null
  })
  const draft = value.trim()
  const shapeOdd = draft !== '' && !looksLikeTavilyKey(draft)
  const fresh = probe.key === draft
  const line = fresh && probe.result ? probeText(probe.result) : null
  const errLine = fresh ? probe.err : null

  async function test(): Promise<void> {
    if (draft === '' || probe.busy) return
    setProbe({ key: draft, result: null, busy: true, err: null })
    try {
      const result = await window.atlas.aiTestTavily(draft)
      setProbe({ key: draft, result, busy: false, err: null })
    } catch (err) {
      setProbe({ key: draft, result: null, busy: false, err: friendlyErr(err) })
    }
  }

  return (
    <div className="cfg-tavily-block">
      <div className="cfg-field-head">
        <label htmlFor="cfg-tavily-key">Tavily 搜索 Key(可选)</label>
        <span>填了搜索更快更稳</span>
      </div>
      <div className="cfg-path-input">
        <TreeIcon name="globe" size={13} mono />
        <input
          id="cfg-tavily-key"
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder="tvly- 开头;不填也能用(自动走免费源)"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          title="拿这把 Key 查一次官方用量:验证 Key 有没有效,顺手报本月还剩多少次 —— 不花搜索额度"
          disabled={probe.busy || draft === ''}
          onClick={() => void test()}
        >
          {probe.busy ? '测试中…' : '测一下'}
        </button>
        <button
          type="button"
          className="cfg-eye-btn"
          aria-label={visible ? '隐藏 Key' : '显示 Key'}
          aria-pressed={visible}
          title={visible ? '隐藏' : '显示'}
          onClick={() => setVisible(!visible)}
        >
          <TreeIcon name={visible ? 'eyeOff' : 'eye'} size={13} mono />
        </button>
      </div>
      {shapeOdd && !line && !errLine && (
        <p className="cfg-field-help is-warn">
          提示:Tavily 的 Key 是 tvly- 开头的,这个看着不像 —— 存是能存,但多半用不上。
        </p>
      )}
      {(line || errLine) && (
        <p className={`cfg-field-help ${line ? line.cls : 'is-bad'}`}>
          {line ? line.text : errLine}
        </p>
      )}
      <p className="cfg-field-help">
        去 tavily.com 免费注册一个账号就能拿到(每月 1000 次搜索免费,不用绑卡)。Key
        只存这台电脑的配置文件里,绝不进代码仓库。
      </p>
    </div>
  )
}
