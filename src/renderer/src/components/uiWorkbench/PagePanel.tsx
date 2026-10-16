// 属性面板 · 页面分区:没选中任何对象时显示(Figma 的 Page 区块):画布底色、不透明度、显隐。
// 底色属于页面,不是对象、不进导出;取色器预览期间的批次由 ColorField 管,整段挑色合成一步撤销。
import { parseIntegerInput } from '@shared/uiWorkbench/numberInput'
import type { Page } from '@shared/uiWorkbench/page'
import { docActions } from '../../uiWorkbench/documentStore'
import { TreeIcon } from '../Icons'
import { ColorField } from './ColorField'
import { NumberField } from './NumberField'

const OPACITY_MIN = 0
const OPACITY_MAX = 100
const PAGE_ICON_SIZE = 14

export function PagePanel({ page }: { page: Page }): React.JSX.Element {
  const { background } = page
  const patchBackground = (patch: Partial<Page['background']>): void =>
    docActions.patchPage(page.id, { background: patch })

  return (
    <section className="uwb-section" aria-label="页面">
      <h3 className="uwb-section-title">页面</h3>
      <div className="uwb-field-row">
        <ColorField
          label="画布底色"
          value={background.color}
          onCommit={(color) => patchBackground({ color })}
        />
        <button
          type="button"
          className="uwb-field-btn"
          aria-label={background.visible ? '隐藏画布底色' : '显示画布底色'}
          aria-pressed={!background.visible}
          data-tip={background.visible ? '隐藏画布底色' : '显示画布底色'}
          onClick={() => patchBackground({ visible: !background.visible })}
        >
          <TreeIcon name={background.visible ? 'eye' : 'eyeOff'} size={PAGE_ICON_SIZE} mono />
        </button>
      </div>
      <div className="uwb-field-row">
        <NumberField
          label="不透明度"
          unit="%"
          value={background.opacity}
          parse={(raw) => parseIntegerInput(raw, OPACITY_MIN, OPACITY_MAX)}
          onCommit={(opacity) => patchBackground({ opacity })}
        />
      </div>
    </section>
  )
}
