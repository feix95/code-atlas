// 零件盒(§5.3 左栏):UI 框架签激活时占住全局侧栏,把「组件/变量/风格/图标/我的方案」放在手边。
// 组件行两种上板方式(M3-a):拖到底板 / 双击直接落一块;单击仍是跳零件墙定位调数值。
import { useEffect } from 'react'
import { GROUPS } from '@shared/uiFrame/board'
import { pageFor } from '@shared/uiFrame/documents'
import { iconSlotsOf } from '@shared/uiFrame/markup'
import { PART_DEFS } from '@shared/uiFrame/parts'
import { BLANK_ID, TEMPLATES, type TemplateMeta } from '@shared/uiFrame/templates'
import type { IconSlot } from '@shared/uiFrame/types'
import { iconLookup } from '../../uiFrame/assets'
import { docActions, useUiFrameDoc } from '../../uiFrame/docStore'
import { schemeActions, useSchemeState } from '../../uiFrame/schemeStore'
import { useWorkbench, workbenchActions } from '../../uiFrame/workbenchStore'
import { LucideGlyph } from './IconPicker'

/** 图标槽位 → 人话名(零件盒清单用) */
const SLOT_LABEL: Record<IconSlot, string> = {
  'hero-cta': '首屏按钮',
  'feature-1': '卡片图标 · 一',
  'feature-2': '卡片图标 · 二',
  'feature-3': '卡片图标 · 三',
  'app-back': '返回',
  'app-bell': '通知',
  'app-search': '搜索框',
  'app-row-1': '列表图标 · 一',
  'app-row-2': '列表图标 · 二',
  'app-row-3': '列表图标 · 三',
  'app-arrow': '行尾箭头',
  'demo-button': '按钮图标',
  'demo-ibtn': '图标按钮',
  'demo-check': '复选勾',
  'demo-input': '输入框图标',
  'demo-li': '列表前置',
  'demo-arrow': '列表尾部箭头',
  'demo-card': '卡片图标',
  'demo-search': '搜索图标',
  'demo-down': '下拉箭头'
}

const PLATFORM_LABEL = { desktop: '电脑', phone: '手机' } as const

function IconRow({ slot, icon }: { slot: IconSlot; icon: string }): React.JSX.Element {
  const node = iconLookup(icon)
  return (
    <button
      type="button"
      className="uf-part-row"
      title={`在画布上定位并换图标(${slot})`}
      onClick={() => workbenchActions.jump({ kind: 'icon', slot })}
    >
      <span className="uf-part-ico">{node ? <LucideGlyph node={node} size="1rem" /> : null}</span>
      <span className="uf-part-name">{SLOT_LABEL[slot]}</span>
      <code className="uf-part-meta">{icon}</code>
    </button>
  )
}

/** 侧栏顶块:「工作台」+ 当前方案名(对齐设置模式的侧栏头) */
export function UiFramePartsTitle(): React.JSX.Element {
  const { doc } = useUiFrameDoc()
  const { started } = useSchemeState()
  return (
    <div className="sidebar-top cfg-snav-head">
      <span className="cfg-snav-title">工作台{started ? ` · ${doc.name}` : ''}</span>
    </div>
  )
}

export function UiFrameParts(): React.JSX.Element {
  const { doc } = useUiFrameDoc()
  const { started, schemes, schemeId } = useSchemeState()
  const { blankExample } = useWorkbench()

  useEffect(() => {
    if (schemes === null) void schemeActions.refresh()
  }, [schemes])

  const applyStyle = (t: TemplateMeta): void => {
    docActions.applyTemplateStyle(t.id)
    schemeActions.flash(`已套用「${t.style}」风格;不满意按 Ctrl+Z 撤销`)
  }

  const benchSlots = iconSlotsOf(pageFor(doc.platform).body)
  const demoSlots: IconSlot[] = [
    'demo-button',
    'demo-ibtn',
    'demo-check',
    'demo-input',
    'demo-li',
    'demo-arrow',
    'demo-card'
  ]
  const blankBench = doc.template === BLANK_ID && !blankExample

  return (
    <div className="uf-parts">
      {!started && (
        <p className="uf-hint uf-parts-hint">先在中间选一个起点;零件和工具在这里待命。</p>
      )}
      {started && (
        <>
          <details open>
            <summary>组件</summary>
            {PART_DEFS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="uf-part-row"
                draggable
                title="拖到底板上摆,或双击直接落一块;单击去零件墙调数值"
                onClick={() => workbenchActions.jump({ kind: 'component', id: p.id })}
                onDoubleClick={() => {
                  // 双击兜底:级联落位,免得不会拖的人放不上去
                  workbenchActions.setView('bench')
                  const n = doc.placed.length
                  const id = docActions.addPlaced(p.id, 24 + (n % 8) * 20, 24 + (n % 8) * 20)
                  workbenchActions.selectPlaced(id)
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-uiframe-part', p.id)
                  e.dataTransfer.effectAllowed = 'copy'
                  workbenchActions.setView('bench')
                  workbenchActions.setDragPart(p.id)
                }}
                onDragEnd={() => workbenchActions.setDragPart(null)}
              >
                <span className="uf-part-name">{p.label}</span>
              </button>
            ))}
            <p className="uf-hint uf-parts-hint">
              拖到底板上摆,或双击直接落一块;点名字去零件墙调数值。
            </p>
          </details>
          <details open>
            <summary>变量</summary>
            {GROUPS.map(([group, title]) => (
              <button
                key={group}
                type="button"
                className="uf-part-row"
                title="去变量板改这组"
                onClick={() => workbenchActions.jump({ kind: 'boardGroup', group })}
              >
                <span className="uf-part-name">{title}</span>
              </button>
            ))}
          </details>
          <details open>
            <summary>风格</summary>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`uf-part-row${doc.template === t.id ? ' is-on' : ''}`}
                title={`${t.blurb} · 一键套用到当前方案(可撤销)`}
                onClick={() => applyStyle(t)}
              >
                <span className="uf-part-name">{t.style}</span>
                <code className="uf-part-meta">{PLATFORM_LABEL[t.platform]}</code>
              </button>
            ))}
            <p className="uf-hint uf-parts-hint">套用会覆盖整套变量;Ctrl+Z 可退回。</p>
          </details>
          <details>
            <summary>图标</summary>
            {blankBench ? (
              <p className="uf-hint uf-parts-hint">
                空白底板还没内容;填入示例页后这里列出页面图标。
              </p>
            ) : (
              benchSlots.map((slot) => <IconRow key={slot} slot={slot} icon={doc.icons[slot]} />)
            )}
            <p className="uf-part-sub">组件图标</p>
            {demoSlots.map((slot) => (
              <IconRow key={slot} slot={slot} icon={doc.icons[slot]} />
            ))}
          </details>
        </>
      )}
      <details open>
        <summary>我的方案</summary>
        {(schemes ?? []).map((meta) => (
          <button
            key={meta.id}
            type="button"
            className={`uf-part-row${meta.id === schemeId ? ' is-on' : ''}`}
            title="打开这个方案"
            onClick={() => void schemeActions.open(meta.id)}
          >
            <span className="uf-part-name">{meta.name}</span>
            <code className="uf-part-meta">
              {PLATFORM_LABEL[meta.platform]} · {meta.style}
            </code>
          </button>
        ))}
        {schemes !== null && schemes.length === 0 && (
          <p className="uf-hint uf-parts-hint">方案库是空的;调完点工具条「保存」收进来。</p>
        )}
        <button
          type="button"
          className="uf-part-row uf-part-row-action"
          onClick={() => void schemeActions.backToStart()}
        >
          <span className="uf-part-name">+ 新建方案</span>
        </button>
        <button
          type="button"
          className="uf-part-row uf-part-row-action"
          onClick={() => workbenchActions.setLibraryOpen(true)}
        >
          <span className="uf-part-name">管理方案库…</span>
        </button>
      </details>
    </div>
  )
}
