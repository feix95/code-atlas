// 单选配方:<label class="rdo"><input class="rdo__in" type="radio"><span class="rdo__dot"></span></label>
// 选中态走真实 checked 属性;一组选项用同 name 的多个 label 并排。
import type { PageNode, ThemeName } from '../types.ts'
import {
  DEMO_STATE_CLASS,
  demoLabel,
  demoRow,
  demoSection,
  v,
  type ComponentRecipe
} from './kit.ts'

const rdo = (cls: string, on: boolean, disabled: boolean, part = 'rdo'): PageNode => {
  const input: PageNode = {
    tag: 'input',
    cls: 'rdo__in',
    attrs: { type: 'radio', name: 'demo' }
  }
  if (on) input.attrs!['checked'] = ''
  if (disabled) input.attrs!['disabled'] = ''
  return {
    tag: 'label',
    cls: `rdo${cls ? ` ${cls}` : ''}`,
    part,
    children: [input, { tag: 'span', cls: 'rdo__dot' }]
  }
}

export const RADIO: ComponentRecipe = {
  id: 'radio',
  label: '单选',
  group: 'rdo',
  stateNames: ['默认', '选中', '悬停', '焦点', '禁用'],
  rules: [
    {
      sel: '.rdo',
      decls: [
        ['position', 'relative'],
        ['display', 'inline-flex'],
        ['align-items', 'center'],
        ['justify-content', 'center'],
        ['width', v('rdo-size-md')],
        ['height', v('rdo-size-md')],
        ['border-radius', v('radius-full')],
        ['border', `${v('rdo-border-width')} solid ${v('rdo-off-border')}`],
        ['background', v('color-surface')],
        ['box-sizing', 'border-box'],
        ['cursor', 'pointer'],
        ['vertical-align', 'middle']
      ]
    },
    {
      sel: '.rdo__in',
      decls: [
        ['position', 'absolute'],
        ['inset', '0'],
        ['margin', '0'],
        ['opacity', '0'],
        ['cursor', 'pointer']
      ]
    },
    {
      sel: '.rdo__dot',
      decls: [
        ['display', 'block'],
        ['width', v('rdo-dot-md')],
        ['height', v('rdo-dot-md')],
        ['margin', 'auto'],
        ['border-radius', v('radius-full')],
        ['background', 'transparent'],
        // 居中:相对盒宽定位
        ['position', 'absolute'],
        ['inset', '0']
      ]
    },
    {
      sel: '.rdo--sm',
      decls: [
        ['width', v('rdo-size-sm')],
        ['height', v('rdo-size-sm')]
      ]
    },
    {
      sel: '.rdo--sm .rdo__dot',
      decls: [
        ['width', v('rdo-dot-sm')],
        ['height', v('rdo-dot-sm')]
      ]
    },
    {
      sel: '.rdo:has(.rdo__in:checked)',
      decls: [['border-color', v('color-primary')]]
    },
    {
      sel: '.rdo:has(.rdo__in:checked) .rdo__dot',
      decls: [['background', v('color-primary')]]
    },
    {
      sel: '.rdo:has(.rdo__in:disabled)',
      decls: [
        ['opacity', v('opacity-disabled')],
        ['cursor', 'not-allowed']
      ]
    },
    {
      sel: '.rdo:has(.rdo__in:disabled) .rdo__in',
      decls: [['cursor', 'not-allowed']]
    }
  ],
  states: [
    {
      base: '.rdo',
      state: 'hover',
      real: ':hover:not(:has(.rdo__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.rdo',
      state: 'active',
      real: ':active:not(:has(.rdo__in:disabled))',
      decls: [['border-color', v('color-text-secondary')]]
    },
    {
      base: '.rdo',
      state: 'focus',
      real: ':has(.rdo__in:focus-visible)',
      decls: [
        ['outline', `${v('focus-ring-width')} solid ${v('color-focus')}`],
        ['outline-offset', v('focus-ring-offset')]
      ]
    }
  ],
  demo(theme: ThemeName): PageNode {
    const main = demoRow([
      demoLabel('中'),
      rdo('', true, false),
      rdo('', false, false),
      rdo(DEMO_STATE_CLASS.hover, false, false),
      rdo(DEMO_STATE_CLASS.focus, true, false),
      rdo('', false, true),
      rdo('', true, true)
    ])
    const small = demoRow([
      demoLabel('小'),
      rdo('rdo--sm', true, false, 'rdo-sm'),
      rdo('rdo--sm', false, false, 'rdo-sm')
    ])
    return demoSection(theme, '单选', [main, small])
  }
}
