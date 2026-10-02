// 「UI 框架」起步页(§5.2):选平台 → 选起点(模板 / 空白 / 我的方案 / 导入)。
// 模板卡按平台过滤;我的方案列出库清单(缩略图、平台、风格、最后修改时间);导入归 M1-d。
import { useEffect, useState } from 'react'
import { TEMPLATES } from '@shared/uiFrame/templates'
import type { SchemeMeta, UiPlatform } from '@shared/uiFrame/types'
import { BLANK_ID, schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import { Notice } from '../Notice'
import { SchemeCard } from './UiFrameSchemes'

const PLATFORMS: Array<[UiPlatform, string]> = [
  ['desktop', '电脑端'],
  ['phone', '手机端']
]

export function UiFrameStart(): React.JSX.Element {
  const { schemes, busy, error } = useSchemeState()
  const [platform, setPlatform] = useState<UiPlatform>('desktop')

  useEffect(() => {
    if (schemes === null) void schemeActions.refresh()
  }, [schemes])

  const templates = TEMPLATES.filter((t) => t.platform === platform)

  return (
    <div className="uf-start">
      <div className="uf-start-head">
        <h2 className="uf-start-title">选个起点</h2>
        <p className="uf-hint">
          模板是一套调好风格的完整方案,在它的基础上改数值;也可以从空白或你已存的方案开始。
        </p>
      </div>

      <div className="uf-seg" role="group" aria-label="目标平台">
        {PLATFORMS.map(([p, label]) => (
          <button
            key={p}
            type="button"
            className={`uf-seg-btn${platform === p ? ' is-on' : ''}`}
            aria-pressed={platform === p}
            onClick={() => setPlatform(p)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="uf-start-section" aria-label="内置模板">
        <div className="uf-card-grid">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="uf-card"
              aria-label={t.name}
              onClick={() => schemeActions.startFresh(t.id, platform)}
            >
              <span className="uf-card-name">{t.name}</span>
              <span className="uf-card-meta">{t.style}</span>
              <span className="uf-card-blurb">{t.blurb}</span>
            </button>
          ))}
          <button
            type="button"
            className="uf-card uf-card-dashed"
            aria-label="空白起步"
            onClick={() => schemeActions.startFresh(BLANK_ID, platform)}
          >
            <span className="uf-card-name">空白起步</span>
            <span className="uf-card-blurb">中性默认值,从零自己调</span>
          </button>
          <button
            type="button"
            className="uf-card uf-card-dashed"
            aria-label="导入方案"
            disabled
            title="下个里程碑接入"
          >
            <span className="uf-card-name">导入方案</span>
            <span className="uf-card-blurb">方案文件夹 / DTCG 变量 / CSS 变量(即将上线)</span>
          </button>
        </div>
      </section>

      <section className="uf-start-section" aria-label="我的方案">
        <h3 className="uf-section-title">我的方案</h3>
        {error && <Notice kind="error">{error}</Notice>}
        {schemes === null && busy === 'list' && <p className="uf-hint">正在读取方案库……</p>}
        {schemes !== null && schemes.length === 0 && (
          <p className="uf-hint">
            还没有保存过的方案。从上面的模板或空白起步,改完在工具条点「保存」就进这里。
          </p>
        )}
        {schemes !== null && schemes.length > 0 && (
          <div className="uf-card-grid">
            {schemes.map((meta: SchemeMeta) => (
              <SchemeCard key={meta.id} meta={meta} onOpen={(id) => void schemeActions.open(id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
