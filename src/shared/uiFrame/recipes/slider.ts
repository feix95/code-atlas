// 滑块配方:<input type="range" class="sld"> —— 用原生 range,轨道与滑块靠伪元素样式。
// 演示态:is-hover/is-focus 模拟滑块放大与焦点环。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const sld = (cls: string, value: string, disabled = false): PageNode => ({
  tag: 'input',
  cls: `sld${cls ? ` ${cls}` : ''}`,
  part: 'sld',
  attrs: {
    type: 'range',
    value,
    min: '0',
    max: '100',
    ...(disabled ? { disabled: '' } : {})
  }
})

export const SLIDER: ComponentRecipe = {
  id: 'slider',
  label: '滑块',
  group: 'sld',
  stateNames: ['默认', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.sld',
      decls: [
        ['appearance', 'none'],
        ['width', v('sld-width')],
        ['height', v('sld-thumb')],
        ['margin', '0'],
        ['background', 'transparent'],
        ['cursor', 'pointer'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.sld::-webkit-slider-runnable-track',
      decls: [
        ['height', v('sld-track-h')],
        ['border-radius', v('radius-full')],
        ['background', v('sld-track-bg')]
      ]
    },
    {
      sel: '.sld::-webkit-slider-thumb',
      decls: [
        ['appearance', 'none'],
        ['width', v('sld-thumb')],
        ['height', v('sld-thumb')],
        // 滑块相对轨道垂直居中:上提值 = (轨道高 - 滑块尺寸) / 2,与 sld-track-h/sld-thumb 联动调
        ['margin-top', v('sld-thumb-raise')],
        ['border-radius', v('radius-full')],
        ['background', v('sld-thumb-bg')],
        ['box-shadow', v('sld-thumb-shadow')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.sld::-moz-range-track',
      decls: [
        ['height', v('sld-track-h')],
        ['border-radius', v('radius-full')],
        ['background', v('sld-track-bg')]
      ]
    },
    {
      sel: '.sld::-moz-range-thumb',
      decls: [
        ['width', v('sld-thumb')],
        ['height', v('sld-thumb')],
        ['border', 'none'],
        ['border-radius', v('radius-full')],
        ['background', v('sld-thumb-bg')],
        ['box-shadow', v('sld-thumb-shadow')],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.sld:disabled',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.sld:disabled::-webkit-slider-thumb',
      decls: [['cursor', 'not-allowed']]
    },
    {
      sel: '.sld:disabled::-moz-range-thumb',
      decls: [['cursor', 'not-allowed']]
    }
  ],
  states: [
    {
      base: '.sld',
      state: 'hover',
      real: ':hover:not(:disabled)::-webkit-slider-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('sld-hover-ring')} ${v('sld-hover-bg')}`
        ]
      ]
    },
    {
      base: '.sld',
      state: 'focus',
      real: ':focus-visible::-webkit-slider-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`
        ]
      ]
    },
    {
      base: '.sld',
      state: 'active',
      real: ':active:not(:disabled)::-webkit-slider-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('sld-active-ring')} ${v('sld-hover-bg')}`
        ]
      ]
    },
    // firefox 轨道态(导出文件用真实伪类;演示态类只在 _demo.css 起作用)
    {
      base: '.sld',
      state: 'hover',
      real: ':hover:not(:disabled)::-moz-range-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('sld-hover-ring')} ${v('sld-hover-bg')}`
        ]
      ]
    },
    {
      base: '.sld',
      state: 'active',
      real: ':active:not(:disabled)::-moz-range-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('sld-active-ring')} ${v('sld-hover-bg')}`
        ]
      ]
    },
    {
      base: '.sld',
      state: 'focus',
      real: ':focus-visible::-moz-range-thumb',
      decls: [
        [
          'box-shadow',
          `${v('sld-thumb-shadow')}, 0 0 0 ${v('focus-ring-width')} ${v('color-focus')}`
        ]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const row = demoRow([
      demoLabel('值'),
      sld('', '30'),
      sld(DEMO_STATE_CLASS.hover, '60'),
      sld(DEMO_STATE_CLASS.focus, '80'),
      sld('', '45', true)
    ])
    return demoSection(theme, '滑块', [row])
  }
}
