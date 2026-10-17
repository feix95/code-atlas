import { useState } from 'react'
import { looksLikeTavilyKey, type TavilyProbeResult } from '@shared/tavily'
import { friendlyErr } from '../errText'
import { TreeIcon } from './Icons'
import { CfgQ, CfgRow } from './CfgRow'

/** 「测试」的结论文案(2026-09-17):Tavily 给的状态码翻成人话,别让用户对着码猜。
 *  一句说完就够 —— 结论挂在行的说明位,超一行会把全表行距撑破;
 *  结论是「能用」时随身报本月用量(2026-09-17 小葵提议:/usage 零成本捎带的) */
function probeText(result: TavilyProbeResult): { cls: string; text: string } {
  switch (result.verdict) {
    case 'ok':
      return {
        cls: 'is-ok',
        text: result.usage
          ? result.usage.limit === null
            ? `Key 有效 · 本月已用 ${result.usage.used} 次。`
            : `Key 有效 · 本月已用 ${result.usage.used}/${result.usage.limit} 次。`
          : 'Key 有效。'
      }
    case 'bad-key':
      return { cls: 'is-bad', text: '这个 Key 不对：抄漏了，或被删了。' }
    case 'quota':
      return { cls: 'is-warn', text: '本月额度已用完，下月自动回血。' }
    case 'busy':
      return { cls: 'is-warn', text: '请求太频繁，过一会儿再测。' }
    case 'server':
      return {
        cls: 'is-warn',
        text: `Tavily 出状况了(状态码 ${result.status ?? '?'})，等会儿再试。`
      }
    case 'unreachable':
      return { cls: 'is-bad', text: '连不上 Tavily：检查网络或代理。' }
    default:
      return { cls: 'is-warn', text: `没测出结论(状态码 ${result.status ?? '?'})。` }
  }
}

const TAVILY_PH = 'tvly- 开头；留空走免费源'
const TAVILY_URL = 'https://tavily.com'

/**
 * Tavily Key 行(2026-09-17 小葵验收):可选的搜索加速 Key —— 眼睛嵌进框内、「测试」真打官方接口验货、
 * 形状不像 tvly- 开头给黄字提醒但**不拦**(将来 Tavily 改格式或用户走中转,硬拦会把人挡门外)。
 * 「请先输入 Key」用占位符呈现:框空着才催,敲字即消,不占版面。
 * 结论随身带着被测的那把 Key,框里字一改旧结论自动作废;结论/领取链接都住进行说明位(一行说完,不破全表行距)。
 */
export function TavilyKeyField({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [needKey, setNeedKey] = useState(false)
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
    if (probe.busy) return
    if (draft === '') {
      // 框空着点测试:借占位符当场催(橙、不占行),敲字即消
      setNeedKey(true)
      return
    }
    setProbe({ key: draft, result: null, busy: true, err: null })
    try {
      const result = await window.atlas.aiTestTavily(draft)
      setProbe({ key: draft, result, busy: false, err: null })
    } catch (err) {
      setProbe({ key: draft, result: null, busy: false, err: friendlyErr(err) })
    }
  }

  return (
    <CfgRow
      label={
        <>
          Tavily 搜索 Key<em className="cfg-tag">可选</em>
          <CfgQ tip="面向 AI 的搜索服务。官网免费注册，每月 1000 次免费额度。" />
        </>
      }
      hint={
        probe.busy ? (
          <span className="cfg-hint is-warn">测试中……</span>
        ) : line || errLine ? (
          <span className={`cfg-hint ${line ? line.cls : 'is-bad'}`}>
            {line ? line.text : errLine}
          </span>
        ) : shapeOdd ? (
          <span className="cfg-hint is-warn">Key 通常以 tvly- 开头。</span>
        ) : (
          <>
            仅保存在本机；
            <a className="cfg-linklike" href={TAVILY_URL} target="_blank" rel="noreferrer">
              领取免费 Key ↗
            </a>
          </>
        )
      }
    >
      <div className="cfg-keyrow">
        <div className={`cfg-key-wrap${needKey ? ' is-warn' : ''}`}>
          <input
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={needKey ? '请先输入 Key。' : TAVILY_PH}
            aria-label="Tavily Key"
            onChange={(e) => {
              onChange(e.target.value)
              setNeedKey(false)
            }}
          />
          <button
            type="button"
            className="cfg-eye-btn"
            aria-label={visible ? '隐藏 Key' : '显示 Key'}
            aria-pressed={visible}
            data-tip={visible ? '隐藏' : '显示'}
            onClick={() => setVisible(!visible)}
          >
            <TreeIcon name={visible ? 'eyeOff' : 'eye'} size={13} mono />
          </button>
        </div>
        <button type="button" className="cfg-btn" disabled={probe.busy} onClick={() => void test()}>
          {probe.busy ? '测试中…' : '测试'}
        </button>
      </div>
    </CfgRow>
  )
}
