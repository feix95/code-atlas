// UI 框架的随包资源:lucide 图标数据与搜索标签、许可证全文、字体清单与字体文件地址。
// 全部由 Vite 在构建期打进渲染层(lucide-static / fontsource 是开发依赖,不随 node_modules 进安装包)。
import iconNodesJson from 'lucide-static/icon-nodes.json'
import tagsJson from 'lucide-static/tags.json'
import lucideLicense from 'lucide-static/LICENSE?raw'
import interLicense from '@fontsource-variable/inter/LICENSE?raw'
import notoLicense from '@fontsource-variable/noto-sans-sc/LICENSE?raw'
import interCss from '@fontsource-variable/inter/index.css?raw'
import notoCss from '@fontsource-variable/noto-sans-sc/index.css?raw'
import { fontsCss, type FontSource } from '@shared/uiFrame/fonts'
import type { PackageAssets } from '@shared/uiFrame/exportPackage'
import type { FontPlan, IconLookup, IconNode } from '@shared/uiFrame/types'

const ICON_NODES = iconNodesJson as unknown as Record<string, IconNode>
const ICON_TAGS = tagsJson as unknown as Record<string, string[]>

export const ICON_NAMES: string[] = Object.keys(ICON_NODES).sort()

export const iconLookup: IconLookup = (name) => ICON_NODES[name]

export function iconTags(name: string): string[] {
  return ICON_TAGS[name] ?? []
}

export const FONT_SOURCES: FontSource[] = [
  { dir: 'inter', css: interCss },
  { dir: 'noto-sans-sc', css: notoCss }
]

// 画布用的字体地址:构建期把 woff2 打成资源文件,按文件名查地址
const INTER_URLS = import.meta.glob<string>(
  '../../../../node_modules/@fontsource-variable/inter/files/*-wght-normal.woff2',
  { query: '?url', import: 'default', eager: true }
)
const NOTO_URLS = import.meta.glob<string>(
  '../../../../node_modules/@fontsource-variable/noto-sans-sc/files/*-wght-normal.woff2',
  { query: '?url', import: 'default', eager: true }
)

function byFileName(map: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(map).map(([path, url]) => [path.split('/').pop() ?? path, url]))
}

const FONT_URLS: Record<FontPlan['dir'], Map<string, string>> = {
  inter: byFileName(INTER_URLS),
  'noto-sans-sc': byFileName(NOTO_URLS)
}

/** 画布 iframe 的 fonts.css:与规格包同一份字体面清单,只换文件地址 */
export function canvasFontsCss(): string {
  return fontsCss(FONT_SOURCES, (dir, file) => {
    const url = FONT_URLS[dir].get(file)
    return url ? new URL(url, document.baseURI).href : `./${dir}/${file}`
  })
}

/** 规格包组装要的全部资源;stamp = 导出时刻 */
export function packageAssets(now: Date): PackageAssets {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return {
    lookup: iconLookup,
    fontSources: FONT_SOURCES,
    licenses: { lucide: lucideLicense, inter: interLicense, notoSansSc: notoLicense },
    stamp
  }
}
